import Darwin
import Foundation

final class HidServer {
  let socketPath: String
  private let lock = NSLock()
  private let sendLock = NSLock()
  private var listenFd: Int32 = -1
  private var clientFd: Int32 = -1
  private var running = false
  private var hid: HidDevice?
  private var incoming = Data()

  init(socketPath: String) {
    self.socketPath = socketPath
  }

  func start() throws {
    unlink(socketPath)
    let fd = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
    if fd < 0 {
      throw HidError.listenFailed("socket: \(String(cString: strerror(errno)))")
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
      throw HidError.listenFailed("socket path too long")
    }
    let bindSize = socklen_t(MemoryLayout<sockaddr_un>.size)
    let bound = withUnsafePointer(to: &addr) { pointer in
      pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPtr in
        Darwin.bind(fd, sockaddrPtr, bindSize)
      }
    }
    if bound != 0 {
      Darwin.close(fd)
      throw HidError.listenFailed("bind: \(String(cString: strerror(errno)))")
    }
    if Darwin.listen(fd, 1) != 0 {
      Darwin.close(fd)
      throw HidError.listenFailed("listen: \(String(cString: strerror(errno)))")
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
    let device = hid
    hid = nil
    lock.unlock()
    if listen >= 0 {
      Darwin.shutdown(listen, SHUT_RDWR)
      Darwin.close(listen)
    }
    if client >= 0 {
      Darwin.shutdown(client, SHUT_RDWR)
      Darwin.close(client)
    }
    device?.close()
    unlink(socketPath)
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
      if !running || clientFd >= 0 {
        lock.unlock()
        Darwin.close(fd)
        continue
      }
      clientFd = fd
      incoming.removeAll(keepingCapacity: true)
      lock.unlock()
      Thread.detachNewThread { [weak self] in
        self?.readLoop()
      }
    }
  }

  private func readLoop() {
    while true {
      lock.lock()
      let fd = clientFd
      let alive = running
      lock.unlock()
      if !alive || fd < 0 {
        return
      }
      var chunk = [UInt8](repeating: 0, count: 4096)
      let n = Darwin.recv(fd, &chunk, chunk.count, 0)
      if n <= 0 {
        dropClient()
        return
      }
      lock.lock()
      incoming.append(contentsOf: chunk.prefix(n))
      do {
        let frames = try HidCodec.take(from: &incoming)
        lock.unlock()
        for frame in frames {
          handle(frame)
        }
      } catch {
        lock.unlock()
        send(.init(op: .error, message: error.localizedDescription))
        dropClient()
        return
      }
    }
  }

  private func handle(_ frame: HidFrame) {
    switch frame.op {
    case .open:
      dropHid()
      guard let raw = frame.descriptor, let descriptor = Data(base64Encoded: raw) else {
        send(.init(op: .error, message: HidError.missingDescriptor.localizedDescription))
        return
      }
      do {
        let device = try HidDevice(
          vid: frame.vid ?? 0,
          pid: frame.pid ?? 0,
          name: frame.name ?? "CWS",
          descriptor: descriptor
        )
        device.onHostReport = { [weak self] report in
          DispatchQueue.global(qos: .userInitiated).async {
            self?.send(.init(op: .input, report: report.base64EncodedString()))
          }
        }
        lock.lock()
        hid = device
        lock.unlock()
        send(.init(op: .ok))
      } catch {
        send(.init(op: .error, message: error.localizedDescription))
      }
    case .write:
      guard let raw = frame.report, let report = Data(base64Encoded: raw) else {
        return
      }
      lock.lock()
      let device = hid
      lock.unlock()
      do {
        try device?.writeToHost(report)
      } catch {
        send(.init(op: .error, message: error.localizedDescription))
      }
    case .close:
      dropHid()
    default:
      break
    }
  }

  private func send(_ frame: HidFrame) {
    guard let data = try? HidCodec.encode(frame) else {
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

  private func dropClient() {
    lock.lock()
    let fd = clientFd
    clientFd = -1
    incoming.removeAll(keepingCapacity: false)
    let device = hid
    hid = nil
    lock.unlock()
    if fd >= 0 {
      Darwin.close(fd)
    }
    device?.close()
  }

  func dropDevice() {
    dropHid()
  }

  private func dropHid() {
    lock.lock()
    let device = hid
    hid = nil
    lock.unlock()
    device?.close()
  }
}
