import CoreBluetooth
import Foundation

struct BleScanHit {
  var id: String
  var name: String
  var services: [String]
}

final class BleCentral: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
  private let queue = DispatchQueue(label: "hk.ysk.cws.ble")
  private var manager: CBCentralManager!
  private var readyWait: CheckedContinuation<Void, Never>?
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
  private var pendingWrites: [Data] = []
  private var scanToken = 0
  private var notifyArmed = false
  var onNotify: ((Data) -> Void)?
  var onDisconnected: (() -> Void)?

  override init() {
    super.init()
    manager = CBCentralManager(delegate: self, queue: queue)
  }

  func isLinked() -> Bool {
    queue.sync { connected?.state == .connected }
  }

  func disconnect() {
    queue.async { self.resetLink() }
  }

  func scan(timeoutMs: Int) async -> [BleScanHit] {
    await waitReady()
    return await withCheckedContinuation { (cont: CheckedContinuation<[BleScanHit], Never>) in
      self.queue.async {
        self.resetLink()
        self.takeScan()?.resume(returning: Array(self.scanHits.values))
        self.scanWait = cont
        self.scanHits.removeAll()
        self.scanToken += 1
        let token = self.scanToken
        self.manager.stopScan()
        self.manager.scanForPeripherals(withServices: nil, options: [
          CBCentralManagerScanOptionAllowDuplicatesKey: true,
        ])
        self.queue.asyncAfter(deadline: .now() + .milliseconds(max(timeoutMs, 300))) {
          guard token == self.scanToken else {
            return
          }
          self.manager.stopScan()
          let hits = Array(self.scanHits.values)
          self.takeScan()?.resume(returning: hits)
        }
      }
    }
  }

  func connect(id: String, writeUuid: String, notifyUuid: String) async throws {
    await waitReady()
    do {
      try await connectInner(id: id, writeUuid: writeUuid, notifyUuid: notifyUuid)
    } catch {
      disconnect()
      throw error
    }
  }

  func write(_ data: Data) {
    queue.async {
      self.notifyArmed = true
      self.pendingWrites.append(data)
      self.flushWrites()
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

  private func waitReady() async {
    await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
      self.queue.async {
        if self.manager.state == .poweredOn {
          cont.resume()
          return
        }
        self.readyWait = cont
        self.queue.asyncAfter(deadline: .now() + .seconds(5)) {
          self.takeReady()?.resume()
        }
      }
    }
  }

  private func resetLink() {
    pendingWrites.removeAll(keepingCapacity: false)
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

  private func takeReady() -> CheckedContinuation<Void, Never>? {
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

  private func flushWrites() {
    guard let peripheral = connected, let characteristic = writeChar else {
      return
    }
    let canWwr = characteristic.properties.contains(.writeWithoutResponse)
    let canWr = characteristic.properties.contains(.write)
    while let data = pendingWrites.first {
      if canWwr, !canWr, !peripheral.canSendWriteWithoutResponse {
        return
      }
      pendingWrites.removeFirst()
      if canWr {
        peripheral.writeValue(data, for: characteristic, type: .withResponse)
      } else if canWwr {
        peripheral.writeValue(data, for: characteristic, type: .withoutResponse)
      }
    }
  }

  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    if central.state == .poweredOn {
      takeReady()?.resume()
    }
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
    var name = previous?.name ?? ""
    if !gap.isEmpty, !local.isEmpty, gap != local {
      name = "\(gap) [\(local)]"
    } else if !local.isEmpty, !gap.isEmpty, !name.contains("[") {
      name = "\(gap) [\(local)]"
    } else if name.isEmpty {
      name = gap.isEmpty ? local : gap
    }
    var uuids = previous?.services ?? []
    let advertised =
      (advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID] ?? [])
      + (advertisementData[CBAdvertisementDataOverflowServiceUUIDsKey] as? [CBUUID] ?? [])
    for uuid in advertised.map({ $0.uuidString.lowercased() }) where !uuids.contains(uuid) {
      uuids.append(uuid)
    }
    scanHits[peripheral.identifier] = BleScanHit(
      id: peripheral.identifier.uuidString,
      name: name,
      services: uuids
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
    finishConnect(error ?? HidError.listenFailed("BLE connect failed"))
  }

  func centralManager(
    _ central: CBCentralManager,
    didDisconnectPeripheral peripheral: CBPeripheral,
    error: Error?
  ) {
    if connected?.identifier == peripheral.identifier {
      connected = nil
      writeChar = nil
      notifyChar = nil
      pendingWrites.removeAll(keepingCapacity: false)
      onDisconnected?()
    }
    finishConnect(error ?? HidError.listenFailed("BLE disconnected"))
  }

  func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    if let error {
      finishConnect(error)
      return
    }
    guard let services = peripheral.services, !services.isEmpty else {
      finishConnect(HidError.listenFailed("no GATT services"))
      return
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
      finishConnect(error)
      return
    }
    for characteristic in service.characteristics ?? [] {
      if characteristic.uuid == wantWrite {
        writeChar = characteristic
      }
      if characteristic.uuid == wantNotify {
        notifyChar = characteristic
      }
    }
    pendingServices = max(0, pendingServices - 1)
    guard pendingServices == 0 else {
      return
    }
    if let notifyChar {
      peripheral.setNotifyValue(true, for: notifyChar)
    } else if writeChar != nil {
      finishConnect(nil)
    } else {
      finishConnect(HidError.listenFailed("missing write characteristic"))
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
    if writeChar != nil {
      finishConnect(nil)
    } else {
      finishConnect(HidError.listenFailed("missing write characteristic"))
    }
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
    _ = error
  }

  func peripheralIsReady(toSendWriteWithoutResponse peripheral: CBPeripheral) {
    flushWrites()
  }
}
