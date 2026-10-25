import Foundation

final class NodeProcess {
  private var process: Process?
  private(set) var lastOutput = ""

  var isRunning: Bool {
    process?.isRunning == true
  }

  func start(hidSocket: String, bleSocket: String, uiURL: URL) throws {
    stop()
    killStaleListeners(port: uiURL.port ?? 8788)
    guard let resources = Bundle.main.resourceURL else {
      throw HidError.listenFailed("missing Resources")
    }
    let main = resources.appendingPathComponent("proxy/main.cjs")
    let nodePath = resources.appendingPathComponent("proxy/node_modules").path
    let ui = resources.appendingPathComponent("ui").path
    guard FileManager.default.fileExists(atPath: main.path) else {
      throw HidError.listenFailed("bundled proxy missing at \(main.path)")
    }
    guard let node = resolveNode(in: resources) else {
      throw HidError.listenFailed("node binary not found (bundled or /opt/homebrew/bin/node)")
    }

    let child = Process()
    child.executableURL = node
    child.arguments = [main.path, "--ui-port", "\(uiURL.port ?? 8788)"]
    var env = ProcessInfo.processInfo.environment
    env["CWS_HID_SOCKET"] = hidSocket
    env["CWS_BLE_SOCKET"] = bleSocket
    env["CWS_NO_OPEN"] = "1"
    env["CWS_UI_DIR"] = ui
    env["NODE_PATH"] = nodePath
    child.environment = env
    child.currentDirectoryURL = resources

    let pipe = Pipe()
    child.standardOutput = pipe
    child.standardError = pipe
    pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
      let data = handle.availableData
      if data.isEmpty {
        return
      }
      if let text = String(data: data, encoding: .utf8), !text.isEmpty {
        fputs(text, stderr)
        DispatchQueue.main.async {
          self?.lastOutput += text
          if self?.lastOutput.count ?? 0 > 8_000 {
            self?.lastOutput = String(self!.lastOutput.suffix(4_000))
          }
        }
      }
    }
    child.terminationHandler = { _ in
      pipe.fileHandleForReading.readabilityHandler = nil
    }
    try child.run()
    process = child
  }

  func stop() {
    guard let child = process else {
      return
    }
    process = nil
    if child.isRunning {
      child.terminate()
      let deadline = Date().addingTimeInterval(2)
      while child.isRunning, Date() < deadline {
        Thread.sleep(forTimeInterval: 0.05)
      }
      if child.isRunning {
        kill(child.processIdentifier, SIGKILL)
      }
    }
  }

  deinit {
    stop()
  }

  private func killStaleListeners(port: Int) {
    let task = Process()
    task.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
    task.arguments = ["-t", "-nP", "-iTCP:\(port)", "-sTCP:LISTEN"]
    let pipe = Pipe()
    task.standardOutput = pipe
    task.standardError = Pipe()
    do {
      try task.run()
      task.waitUntilExit()
    } catch {
      return
    }
    let text = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
    let selfPid = ProcessInfo.processInfo.processIdentifier
    for line in text.split(whereSeparator: \.isNewline) {
      guard let pid = Int32(line.trimmingCharacters(in: .whitespacesAndNewlines)), pid > 0, pid != selfPid else {
        continue
      }
      kill(pid, SIGTERM)
    }
    let deadline = Date().addingTimeInterval(1)
    while Date() < deadline {
      Thread.sleep(forTimeInterval: 0.05)
    }
    for line in text.split(whereSeparator: \.isNewline) {
      guard let pid = Int32(line.trimmingCharacters(in: .whitespacesAndNewlines)), pid > 0, pid != selfPid else {
        continue
      }
      kill(pid, SIGKILL)
    }
  }

  private func resolveNode(in resources: URL) -> URL? {
    let bundled = resources.appendingPathComponent("node")
    let candidates = [
      bundled,
      URL(fileURLWithPath: "/opt/homebrew/bin/node"),
      URL(fileURLWithPath: "/usr/local/bin/node"),
    ]
    return candidates.first { FileManager.default.isExecutableFile(atPath: $0.path) }
  }
}
