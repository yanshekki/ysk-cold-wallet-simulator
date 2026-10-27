import Darwin
import Foundation

enum BleOp: String, Codable {
  case scan
  case found
  case scanDone
  case connect
  case write
  case notify
  case close
  case ok
  case error
  case disconnected
}

struct BleFrame: Codable {
  var op: BleOp
  var id: String?
  var name: String?
  var services: [String]?
  var writeUuid: String?
  var notifyUuid: String?
  var packet: String?
  var timeoutMs: Int?
  var message: String?
}

final class BleServer {
  let socketPath: String
  private let lock = NSLock()
  private let sendLock = NSLock()
  private var listenFd: Int32 = -1
  private var clientFd: Int32 = -1
  private var running = false
  private var incoming = Data()
  private var scanSeq = 0
  private let central = BleCentral()

  init(socketPath: String) {
    self.socketPath = socketPath
    central.onNotify = { [weak self] data in
      self?.send(BleFrame(op: .notify, packet: data.base64EncodedString()))
    }
    central.onDisconnected = { [weak self] in
      self?.send(BleFrame(op: .disconnected))
    }
  }

  func start() throws {
    unlink(socketPath)
    let fd = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
    if fd < 0 {
      throw HidError.listenFailed("ble socket: \(String(cString: strerror(errno)))")
    }
    var addr = sockaddr_un()
    addr.sun_family = sa_family_t(AF_UNIX)
    let pathLimit = MemoryLayout.size(ofValue: addr.sun_path)
    let copied: Bool = socketPath.withCString { src in
      withUnsafeMutablePointer(to: &addr.sun_path) { dest in
        dest.withMemoryRebound(to: CChar.self, capacity: pathLimit) { cDest in
          if strnlen(src, pathLimit) >= pathLimit {
            return false
          }
          strncpy(cDest, src, pathLimit - 1)
          return true
        }
      }
    }
    if !copied {
      Darwin.close(fd)
      throw HidError.listenFailed("ble socket path too long")
    }
    let bindSize = socklen_t(MemoryLayout<sockaddr_un>.size)
    let bound = withUnsafePointer(to: &addr) { pointer in
      pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPtr in
        Darwin.bind(fd, sockaddrPtr, bindSize)
      }
    }
    if bound != 0 {
      Darwin.close(fd)
      throw HidError.listenFailed("ble bind: \(String(cString: strerror(errno)))")
    }
    if Darwin.listen(fd, 1) != 0 {
      Darwin.close(fd)
      throw HidError.listenFailed("ble listen: \(String(cString: strerror(errno)))")
    }
    lock.lock()
    listenFd = fd
    running = true
    lock.unlock()
    Thread.detachNewThread { [weak self] in
      self?.acceptLoop()
    }
  }

  func stop() {
    lock.lock()
    running = false
    let listen = listenFd
    listenFd = -1
    let client = clientFd
    clientFd = -1
    lock.unlock()
    central.disconnect()
    if listen >= 0 {
      Darwin.shutdown(listen, SHUT_RDWR)
      Darwin.close(listen)
    }
    if client >= 0 {
      Darwin.shutdown(client, SHUT_RDWR)
      Darwin.close(client)
    }
    unlink(socketPath)
  }

  func dropLink() {
    central.disconnect()
  }

  private func acceptLoop() {
    while true {
      lock.lock()
      let listen = listenFd
      let alive = running
      lock.unlock()
      if !alive || listen < 0 {
        break
      }
      let fd = Darwin.accept(listen, nil, nil)
      if fd < 0 {
        continue
      }
      lock.lock()
      if !running {
        lock.unlock()
        Darwin.close(fd)
        continue
      }
      let previous = clientFd
      clientFd = fd
      incoming.removeAll(keepingCapacity: true)
      lock.unlock()
      if previous >= 0 && previous != fd {
        Darwin.shutdown(previous, SHUT_RDWR)
        Darwin.close(previous)
      }
      Thread.detachNewThread { [weak self] in
        self?.readLoop(fd)
      }
    }
  }

  private func readLoop(_ fd: Int32) {
    while true {
      lock.lock()
      let alive = running && clientFd == fd
      lock.unlock()
      if !alive {
        return
      }
      var chunk = [UInt8](repeating: 0, count: 4096)
      let n = Darwin.recv(fd, &chunk, chunk.count, 0)
      if n <= 0 {
        dropClient(fd)
        return
      }
      lock.lock()
      incoming.append(contentsOf: chunk.prefix(n))
      do {
        let frames = try take(from: &incoming)
        lock.unlock()
        for frame in frames {
          handle(frame)
        }
      } catch {
        lock.unlock()
        send(BleFrame(op: .error, message: error.localizedDescription))
        dropClient(fd)
        return
      }
    }
  }

  private func handle(_ frame: BleFrame) {
    switch frame.op {
    case .scan:
      lock.lock()
      scanSeq += 1
      let seq = scanSeq
      lock.unlock()
      let timeout = frame.timeoutMs ?? 4_000
      Task { [weak self] in
        guard let self else {
          return
        }
        do {
          let hits = try await self.central.scan(timeoutMs: timeout)
          guard seq == self.scanSeq else {
            return
          }
          for hit in hits {
            self.send(
              BleFrame(
                op: .found,
                id: hit.id,
                name: hit.name,
                services: hit.services
              )
            )
          }
          self.send(BleFrame(op: .scanDone))
        } catch {
          guard seq == self.scanSeq else {
            return
          }
          self.send(BleFrame(op: .error, message: error.localizedDescription))
        }
      }
    case .connect:
      Task { [weak self] in
        guard let self else {
          return
        }
        do {
          try await self.central.connect(
            id: frame.id ?? "",
            writeUuid: frame.writeUuid ?? "",
            notifyUuid: frame.notifyUuid ?? ""
          )
          self.send(BleFrame(op: .ok, writeUuid: self.central.boundWriteUuid))
        } catch {
          self.send(BleFrame(op: .error, message: error.localizedDescription))
        }
      }
    case .write:
      guard let raw = frame.packet, let data = Data(base64Encoded: raw) else {
        send(BleFrame(op: .error, message: "missing packet"))
        return
      }
      Task { [weak self] in
        guard let self else {
          return
        }
        do {
          try await self.central.write(data)
          self.send(BleFrame(op: .ok))
        } catch {
          self.send(BleFrame(op: .error, message: error.localizedDescription))
        }
      }
    case .close:
      central.disconnect()
      send(BleFrame(op: .ok))
    default:
      break
    }
  }

  private func send(_ frame: BleFrame) {
    guard let data = try? encode(frame) else {
      return
    }
    lock.lock()
    let fd = clientFd
    lock.unlock()
    guard fd >= 0 else {
      return
    }
    sendLock.lock()
    defer { sendLock.unlock() }
    data.withUnsafeBytes { raw in
      guard let base = raw.bindMemory(to: UInt8.self).baseAddress else {
        return
      }
      var sent = 0
      while sent < data.count {
        let n = Darwin.send(fd, base + sent, data.count - sent, 0)
        if n <= 0 {
          return
        }
        sent += n
      }
    }
  }

  private func dropClient(_ expected: Int32) {
    lock.lock()
    guard clientFd == expected else {
      lock.unlock()
      return
    }
    clientFd = -1
    incoming.removeAll(keepingCapacity: false)
    lock.unlock()
    if expected >= 0 {
      Darwin.close(expected)
    }
    central.disconnect()
  }

  private func encode(_ frame: BleFrame) throws -> Data {
    let body = try JSONEncoder().encode(frame)
    var header = Data(count: 4)
    var size = UInt32(body.count).bigEndian
    header.replaceSubrange(0..<4, with: Data(bytes: &size, count: 4))
    return header + body
  }

  private func take(from buffer: inout Data) throws -> [BleFrame] {
    let decoder = JSONDecoder()
    var frames: [BleFrame] = []
    while buffer.count >= 4 {
      let size = Int(
        UInt32(buffer[buffer.startIndex]) << 24
          | UInt32(buffer[buffer.startIndex + 1]) << 16
          | UInt32(buffer[buffer.startIndex + 2]) << 8
          | UInt32(buffer[buffer.startIndex + 3])
      )
      if size > HidCodec.maxFrame {
        throw HidError.frameTooLarge(size)
      }
      if buffer.count < 4 + size {
        break
      }
      let json = buffer.subdata(in: 4..<(4 + size))
      buffer.removeSubrange(0..<(4 + size))
      frames.append(try decoder.decode(BleFrame.self, from: json))
    }
    return frames
  }
}
