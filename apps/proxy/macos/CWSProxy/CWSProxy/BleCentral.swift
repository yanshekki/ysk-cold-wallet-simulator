import CoreBluetooth
import Foundation
import os.log

struct BleScanHit {
  var id: String
  var name: String
  var services: [String]
  /// dBm. Nil when CoreBluetooth reports an unknown reading (127).
  var rssi: Int?
}

private struct PendingWrite {
  let data: Data
  let cont: CheckedContinuation<Void, Error>
}

final class BleCentral: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
  private let queue = DispatchQueue(label: "hk.ysk.cws.ble")
  private var manager: CBCentralManager!
  private var readyWait: CheckedContinuation<Void, Error>?
  private var scanWait: CheckedContinuation<[BleScanHit], Never>?
  private var connectWait: CheckedContinuation<Void, Error>?
  private var scanHits: [UUID: BleScanHit] = [:]
  private var seen: [UUID: CBPeripheral] = [:]
  private var connected: CBPeripheral?
  private var writeChar: CBCharacteristic?
  private var notifyChar: CBCharacteristic?
  private var wantWrite: CBUUID?
  private var wantNotify: CBUUID?
  private var pendingServices = 0
  private var pendingWrites: [PendingWrite] = []
  private var writeInFlight = false
  private var scanToken = 0
  private var notifyArmed = false
  private var identifying = false
  private var identifyWait: CheckedContinuation<Void, Never>?
  private var identifyPeripheral: CBPeripheral?
  private var identifyToken = 0
  private var identityWritePending = false
  /// Matches `CWS_PERIPHERAL_ID.writeCharUUID` in packages/contracts. Not advertised.
  private static let identityWriteUuid = CBUUID(string: "43575300-6964-4000-8000-c057a11e7002")
  private var foundChars: [String] = []
  private var discoveredChars: [CBCharacteristic] = []
  private(set) var boundWriteUuid = ""
  private var didReceiveState = false
  var onNotify: ((Data) -> Void)?
  var onDisconnected: (() -> Void)?

  override init() {
    super.init()
    recreateManager()
  }

  private func recreateManager() {
    manager = CBCentralManager(
      delegate: self,
      queue: queue,
      options: [CBCentralManagerOptionShowPowerAlertKey: true]
    )
    didReceiveState = false
  }

  func isLinked() -> Bool {
    queue.sync { connected?.state == .connected }
  }

  func disconnect() {
    queue.async { self.resetLink() }
  }

  func scan(timeoutMs: Int) async throws -> [BleScanHit] {
    try await waitReady()
    return await withCheckedContinuation { (cont: CheckedContinuation<[BleScanHit], Never>) in
      self.queue.async {
        self.resetLink()
        self.takeScan()?.resume(returning: [])
        self.scanWait = cont
        self.scanHits.removeAll()
        self.scanToken += 1
        let token = self.scanToken
        self.manager.stopScan()
        os_log("ble scan start state=%{public}@", log: .default, type: .info, self.radioStateMessage())
        self.manager.scanForPeripherals(withServices: nil, options: [
          CBCentralManagerScanOptionAllowDuplicatesKey: true,
        ])
        self.queue.asyncAfter(deadline: .now() + .milliseconds(max(timeoutMs, 300))) {
          guard token == self.scanToken else {
            return
          }
          self.manager.stopScan()
          let hits = Array(self.scanHits.values)
          os_log(
            "ble scan done hits=%{public}d state=%{public}@",
            log: .default,
            type: .info,
            hits.count,
            self.radioStateMessage()
          )
          self.takeScan()?.resume(returning: hits)
        }
      }
    }
  }

  func connect(id: String, writeUuid: String, notifyUuid: String) async throws {
    try await waitReady()
    do {
      try await connectInner(id: id, writeUuid: writeUuid, notifyUuid: notifyUuid)
    } catch {
      disconnect()
      throw error
    }
  }

  /// Tell the phone the id this Mac uses to lock it, then drop the link.
  /// Best effort: a missing characteristic still returns.
  func identify(id: String) async {
    guard let uuid = UUID(uuidString: id) else {
      return
    }
    do {
      try await waitReady()
    } catch {
      return
    }
    await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
      self.queue.async {
        if self.connected != nil || self.connectWait != nil || self.identifying {
          cont.resume()
          return
        }
        self.identifyToken += 1
        let token = self.identifyToken
        self.identifying = true
        self.identifyWait = cont
        self.discoveredChars = []
        self.foundChars = []
        self.pendingServices = 0
        self.identityWritePending = false
        let peripheral =
          self.seen[uuid] ?? self.manager.retrievePeripherals(withIdentifiers: [uuid]).first
        guard let peripheral else {
          self.finishIdentify()
          return
        }
        self.seen[uuid] = peripheral
        self.identifyPeripheral = peripheral
        peripheral.delegate = self
        self.queue.asyncAfter(deadline: .now() + .seconds(4)) {
          guard token == self.identifyToken else {
            return
          }
          if let current = self.identifyPeripheral {
            self.manager.cancelPeripheralConnection(current)
          } else {
            self.finishIdentify()
          }
        }
        self.queue.asyncAfter(deadline: .now() + .seconds(5)) {
          guard token == self.identifyToken else {
            return
          }
          self.finishIdentify()
        }
        self.manager.connect(peripheral, options: nil)
      }
    }
  }

  func write(_ data: Data) async throws {
    try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
      self.queue.async {
        self.notifyArmed = true
        self.pendingWrites.append(PendingWrite(data: data, cont: cont))
        self.flushWrites()
      }
    }
  }

  private func connectInner(id: String, writeUuid: String, notifyUuid: String) async throws {
    guard let uuid = UUID(uuidString: id) else {
      throw HidError.listenFailed("bad BLE id")
    }
    try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
      self.queue.async {
        self.finishConnect(HidError.listenFailed("replaced"))
        self.connectWait = cont
        self.wantWrite = CBUUID(string: writeUuid)
        self.wantNotify = CBUUID(string: notifyUuid)
        self.writeChar = nil
        self.notifyChar = nil
        self.pendingServices = 0
        self.foundChars = []
        self.discoveredChars = []
        self.boundWriteUuid = ""
        let peripheral =
          self.seen[uuid] ?? self.manager.retrievePeripherals(withIdentifiers: [uuid]).first
        guard let peripheral else {
          self.finishConnect(HidError.listenFailed("unknown peripheral"))
          return
        }
        self.seen[uuid] = peripheral
        self.connected = peripheral
        peripheral.delegate = self
        self.queue.asyncAfter(deadline: .now() + .seconds(8)) {
          guard self.connectWait != nil else {
            return
          }
          self.finishConnect(HidError.listenFailed("BLE connect timed out"))
          self.resetLink()
        }
        if peripheral.state == .connected {
          peripheral.discoverServices(nil)
        } else {
          self.manager.connect(peripheral, options: nil)
        }
      }
    }
  }

  private func waitReady() async throws {
    try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
      self.queue.async {
        if self.manager.state == .poweredOn {
          cont.resume()
          return
        }
        self.takeReady()?.resume(throwing: HidError.listenFailed("replaced"))
        // Rebuilds and Google Drive hardlinks change the TCC identity. Recreate
        // the manager so a Settings toggle is picked up without Cmd+Q.
        if self.didReceiveState, self.connected == nil {
          os_log(
            "ble recreate manager %{public}@",
            log: .default,
            type: .info,
            self.radioStateMessage()
          )
          self.recreateManager()
        }
        self.readyWait = cont
        self.queue.asyncAfter(deadline: .now() + .seconds(4)) {
          guard let wait = self.takeReady() else {
            return
          }
          if self.manager.state == .poweredOn {
            wait.resume()
          } else {
            wait.resume(throwing: HidError.listenFailed(self.radioFailureMessage()))
          }
        }
      }
    }
  }

  private func radioFailureMessage() -> String {
    switch manager.state {
    case .poweredOff:
      return "Bluetooth is off (\(radioStateMessage()))"
    case .unsupported:
      return "Bluetooth unsupported (\(radioStateMessage()))"
    default:
      break
    }
    switch CBCentralManager.authorization {
    case .denied, .restricted:
      return "Bluetooth permission denied (\(radioStateMessage())). System Settings → Privacy & Security → Bluetooth → enable this CWS Proxy copy, then Stop and Start."
    default:
      return radioStateMessage()
    }
  }

  private func radioStateMessage() -> String {
    let auth: String
    switch CBCentralManager.authorization {
    case .allowedAlways: auth = "allowed"
    case .denied: auth = "denied"
    case .restricted: auth = "restricted"
    case .notDetermined: auth = "notDetermined"
    @unknown default: auth = "unknown"
    }
    let state: String
    switch manager.state {
    case .poweredOn: state = "poweredOn"
    case .poweredOff: state = "poweredOff"
    case .unauthorized: state = "unauthorized"
    case .unsupported: state = "unsupported"
    case .resetting: state = "resetting"
    default: state = "unknown"
    }
    return "ble \(state) auth=\(auth)"
  }

  private func resetLink() {
    failPendingWrites(HidError.listenFailed("disconnected"))
    notifyArmed = false
    if let peripheral = connected {
      manager.cancelPeripheralConnection(peripheral)
    }
    connected = nil
    writeChar = nil
    notifyChar = nil
    finishConnect(HidError.listenFailed("disconnected"))
  }

  private func finishConnect(_ error: Error?) {
    guard let wait = takeConnect() else {
      return
    }
    if let error {
      wait.resume(throwing: error)
    } else {
      wait.resume(returning: ())
    }
  }

  private func takeReady() -> CheckedContinuation<Void, Error>? {
    let wait = readyWait
    readyWait = nil
    return wait
  }

  private func takeScan() -> CheckedContinuation<[BleScanHit], Never>? {
    let wait = scanWait
    scanWait = nil
    return wait
  }

  private func takeConnect() -> CheckedContinuation<Void, Error>? {
    let wait = connectWait
    connectWait = nil
    return wait
  }

  private func failPendingWrites(_ error: Error) {
    writeInFlight = false
    let waiting = pendingWrites
    pendingWrites.removeAll(keepingCapacity: false)
    for item in waiting {
      item.cont.resume(throwing: error)
    }
  }

  private func finishWrite(_ error: Error?) {
    guard writeInFlight, !pendingWrites.isEmpty else {
      writeInFlight = false
      return
    }
    writeInFlight = false
    let item = pendingWrites.removeFirst()
    if let error {
      item.cont.resume(throwing: error)
    } else {
      item.cont.resume()
    }
    flushWrites()
  }

  private func flushWrites() {
    guard !writeInFlight, let next = pendingWrites.first else {
      return
    }
    guard let peripheral = connected, let characteristic = writeChar else {
      failPendingWrites(HidError.listenFailed("BLE write before connect"))
      return
    }
    let canWwr = characteristic.properties.contains(.writeWithoutResponse)
    let canWr = characteristic.properties.contains(.write)
    if canWwr, !canWr, !peripheral.canSendWriteWithoutResponse {
      return
    }
    writeInFlight = true
    if canWr {
      peripheral.writeValue(next.data, for: characteristic, type: .withResponse)
      let token = next.data
      queue.asyncAfter(deadline: .now() + .milliseconds(2_000)) {
        guard self.writeInFlight, self.pendingWrites.first?.data == token else {
          return
        }
        self.finishWrite(nil)
      }
    } else if canWwr {
      peripheral.writeValue(next.data, for: characteristic, type: .withoutResponse)
      finishWrite(nil)
    } else {
      finishWrite(HidError.listenFailed("characteristic is not writable"))
    }
  }

  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    didReceiveState = true
    os_log("ble state %{public}@", log: .default, type: .info, radioStateMessage())
    if central.state == .poweredOn {
      takeReady()?.resume()
    }
  }

  private static func sameUuid(_ left: CBUUID, _ right: CBUUID?) -> Bool {
    guard let right else {
      return false
    }
    if left == right {
      return true
    }
    let a = left.uuidString.lowercased().replacingOccurrences(of: "-", with: "")
    let b = right.uuidString.lowercased().replacingOccurrences(of: "-", with: "")
    return a == b || a.hasSuffix(b) || b.hasSuffix(a)
  }

  private static func gapLabel(_ advertised: String) -> String {
    let name = advertised.trimmingCharacters(in: .whitespacesAndNewlines)
    if let start = name.lastIndex(of: "["), let end = name.lastIndex(of: "]"), start < end {
      let inner = name[name.index(after: start)..<end]
      return inner.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    return name
  }

  func centralManager(
    _ central: CBCentralManager,
    didDiscover peripheral: CBPeripheral,
    advertisementData: [String: Any],
    rssi RSSI: NSNumber
  ) {
    seen[peripheral.identifier] = peripheral
    let previous = scanHits[peripheral.identifier]
    let gap = peripheral.name ?? ""
    let local = advertisementData[CBAdvertisementDataLocalNameKey] as? String ?? ""
    let primary = (advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID] ?? [])
      .map { $0.uuidString.lowercased() }
    let overflow = (advertisementData[CBAdvertisementDataOverflowServiceUUIDsKey] as? [CBUUID] ?? [])
      .map { $0.uuidString.lowercased() }
    // iOS often puts 128-bit CWS UUIDs in overflow while localName is in this
    // packet. Overflow also lingers after CWS stops (or after Trezor → OneKey),
    // so a Continuity advertisement can still look like a live wallet. Only
    // trust overflow when this packet still carries a GAP local name.
    let advertised: [String]
    if !primary.isEmpty {
      advertised = primary
    } else if !local.isEmpty && !overflow.isEmpty {
      advertised = overflow
    } else {
      advertised = []
    }
    var name = previous?.name ?? ""
    let previousLabel = Self.gapLabel(name)
    let localChanged = !local.isEmpty && previousLabel.compare(local, options: [.caseInsensitive]) != .orderedSame
    if !local.isEmpty {
      name = !gap.isEmpty && gap != local ? "\(gap) [\(local)]" : local
    } else if name.isEmpty || (!advertised.isEmpty && advertised != (previous?.services ?? [])) {
      name = gap
    }
    var uuids = previous?.services ?? []
    if !advertised.isEmpty {
      uuids = advertised
    } else if localChanged {
      uuids = []
    }
    let reading = RSSI.intValue
    // 127 means CoreBluetooth could not read RSSI. Keep the last real sample.
    let rssi: Int? = reading > 20 ? previous?.rssi : reading
    scanHits[peripheral.identifier] = BleScanHit(
      id: peripheral.identifier.uuidString,
      name: name,
      services: uuids,
      rssi: rssi
    )
  }

  func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    peripheral.discoverServices(nil)
  }

  func centralManager(
    _ central: CBCentralManager,
    didFailToConnect peripheral: CBPeripheral,
    error: Error?
  ) {
    if identifying || identifyPeripheral?.identifier == peripheral.identifier {
      finishIdentify()
      return
    }
    finishConnect(error ?? HidError.listenFailed("BLE connect failed"))
  }

  func centralManager(
    _ central: CBCentralManager,
    didDisconnectPeripheral peripheral: CBPeripheral,
    error: Error?
  ) {
    if identifyPeripheral?.identifier == peripheral.identifier {
      identifyPeripheral = nil
      identifying = false
      finishIdentify()
      return
    }
    if connected?.identifier == peripheral.identifier {
      connected = nil
      writeChar = nil
      notifyChar = nil
      failPendingWrites(error ?? HidError.listenFailed("BLE disconnected"))
      onDisconnected?()
    }
    finishConnect(error ?? HidError.listenFailed("BLE disconnected"))
  }

  func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    if let error {
      if identifying {
        finishIdentify()
        return
      }
      finishConnect(error)
      return
    }
    guard let services = peripheral.services, !services.isEmpty else {
      if identifying {
        finishIdentify()
        return
      }
      finishConnect(HidError.listenFailed("no GATT services"))
      return
    }
    if identifying {
      discoveredChars = []
    }
    pendingServices = services.count
    for service in services {
      peripheral.discoverCharacteristics(nil, for: service)
    }
  }

  func peripheral(
    _ peripheral: CBPeripheral,
    didDiscoverCharacteristicsFor service: CBService,
    error: Error?
  ) {
    if let error {
      if identifying {
        finishIdentify()
        return
      }
      finishConnect(error)
      return
    }
    for characteristic in service.characteristics ?? [] {
      discoveredChars.append(characteristic)
      foundChars.append("\(service.uuid.uuidString.lowercased())/\(characteristic.uuid.uuidString.lowercased())")
      if Self.sameUuid(characteristic.uuid, wantWrite) {
        writeChar = characteristic
      }
      if Self.sameUuid(characteristic.uuid, wantNotify) {
        notifyChar = characteristic
      }
    }
    pendingServices = max(0, pendingServices - 1)
    guard pendingServices == 0 else {
      return
    }
    if identifying {
      deliverIdentity(peripheral)
      return
    }
    if let identity = discoveredChars.first(where: { Self.sameUuid($0.uuid, Self.identityWriteUuid) }) {
      sendLockId(peripheral, characteristic: identity, allowResponse: false)
    }
    bindKnownChars()
    if let notifyChar {
      peripheral.setNotifyValue(true, for: notifyChar)
    } else if writeChar != nil {
      finishConnect(nil)
    } else {
      forgetStale(peripheral)
      finishConnect(HidError.listenFailed(missingWriteMessage()))
    }
  }

  func peripheral(
    _ peripheral: CBPeripheral,
    didUpdateNotificationStateFor characteristic: CBCharacteristic,
    error: Error?
  ) {
    if let error {
      finishConnect(error)
      return
    }
    if characteristic.isNotifying {
      notifyArmed = true
    }
    if writeChar != nil {
      finishConnect(nil)
    } else {
      forgetStale(peripheral)
      finishConnect(HidError.listenFailed(missingWriteMessage()))
    }
  }

  private func forgetStale(_ peripheral: CBPeripheral) {
    seen.removeValue(forKey: peripheral.identifier)
    scanHits.removeValue(forKey: peripheral.identifier)
    if connected?.identifier == peripheral.identifier {
      manager.cancelPeripheralConnection(peripheral)
    }
  }

  private func missingWriteMessage() -> String {
    let want = wantWrite?.uuidString.lowercased() ?? "?"
    let have = foundChars.isEmpty ? "none" : foundChars.joined(separator: ",")
    // Host skips this peripheral and tries the next advertiser. Do not treat
    // iOS system GATT (180a / Continuity) as a successful CWS connection.
    return "missing write characteristic want=\(want) have=\(have)"
  }

  private func bindKnownChars() {
    if writeChar == nil {
      writeChar = discoveredChars.first { Self.isKnownWrite($0.uuid) }
    }
    if notifyChar == nil {
      notifyChar = discoveredChars.first { Self.isKnownNotify($0.uuid) }
    }
    boundWriteUuid = writeChar?.uuid.uuidString.lowercased() ?? ""
  }

  private static func isKnownWrite(_ uuid: CBUUID) -> Bool {
    if sameUuid(uuid, CBUUID(string: "00000002-0000-1000-8000-00805f9b34fb")) {
      return true
    }
    if sameUuid(uuid, CBUUID(string: "8c000002-a59b-4d58-a9ad-073df69fa1b1")) {
      return true
    }
    let value = uuid.uuidString.lowercased()
    return value.hasPrefix("13d63400") && value.contains("-0002-")
  }

  private static func isKnownNotify(_ uuid: CBUUID) -> Bool {
    if sameUuid(uuid, CBUUID(string: "00000003-0000-1000-8000-00805f9b34fb")) {
      return true
    }
    if sameUuid(uuid, CBUUID(string: "8c000003-a59b-4d58-a9ad-073df69fa1b1")) {
      return true
    }
    let value = uuid.uuidString.lowercased()
    return value.hasPrefix("13d63400") && value.contains("-0001-")
  }

  func peripheral(
    _ peripheral: CBPeripheral,
    didUpdateValueFor characteristic: CBCharacteristic,
    error: Error?
  ) {
    guard notifyArmed, error == nil, let value = characteristic.value, !value.isEmpty else {
      return
    }
    onNotify?(value)
  }

  func peripheral(
    _ peripheral: CBPeripheral,
    didWriteValueFor characteristic: CBCharacteristic,
    error: Error?
  ) {
    if identityWritePending {
      identityWritePending = false
      if identifying {
        manager.cancelPeripheralConnection(peripheral)
      }
      return
    }
    finishWrite(error)
  }

  private func finishIdentify() {
    identifying = false
    identifyPeripheral = nil
    identityWritePending = false
    identifyToken += 1
    let wait = identifyWait
    identifyWait = nil
    wait?.resume()
  }

  private func deliverIdentity(_ peripheral: CBPeripheral) {
    guard let characteristic = discoveredChars.first(where: { Self.sameUuid($0.uuid, Self.identityWriteUuid) }) else {
      manager.cancelPeripheralConnection(peripheral)
      return
    }
    sendLockId(peripheral, characteristic: characteristic, allowResponse: true)
    if identityWritePending {
      return
    }
    queue.asyncAfter(deadline: .now() + .milliseconds(300)) { [weak self] in
      guard let self, self.identifying else {
        return
      }
      self.manager.cancelPeripheralConnection(peripheral)
    }
  }

  /// `uuidString` is the same value the scan list shows as 裝置識別.
  private func sendLockId(
    _ peripheral: CBPeripheral,
    characteristic: CBCharacteristic,
    allowResponse: Bool
  ) {
    guard let payload = peripheral.identifier.uuidString.data(using: .utf8), !payload.isEmpty else {
      return
    }
    let room = peripheral.maximumWriteValueLength(for: .withoutResponse)
    if characteristic.properties.contains(.writeWithoutResponse), room >= payload.count {
      if peripheral.canSendWriteWithoutResponse {
        peripheral.writeValue(payload, for: characteristic, type: .withoutResponse)
      } else {
        queue.asyncAfter(deadline: .now() + .milliseconds(150)) { [weak peripheral] in
          guard let peripheral, peripheral.state == .connected, peripheral.canSendWriteWithoutResponse else {
            return
          }
          peripheral.writeValue(payload, for: characteristic, type: .withoutResponse)
        }
      }
      return
    }
    guard allowResponse, characteristic.properties.contains(.write) else {
      return
    }
    identityWritePending = true
    peripheral.writeValue(payload, for: characteristic, type: .withResponse)
  }

  func peripheralIsReady(toSendWriteWithoutResponse peripheral: CBPeripheral) {
    flushWrites()
  }
}
