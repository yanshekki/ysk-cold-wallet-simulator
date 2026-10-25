import AppKit
import Combine
import Foundation

@MainActor
final class ProxySession: ObservableObject {
  @Published var uiURL: URL?
  @Published var errorMessage: String?
  @Published var ready = false

  let uiPort = 8788
  private var started = false
  private var hid: HidServer?
  private var ble: BleServer?
  private let node = NodeProcess()

  var socketPath: String {
    let tmp = FileManager.default.temporaryDirectory.path
    return "\(tmp)/cws-hid.sock"
  }

  var bleSocketPath: String {
    let tmp = FileManager.default.temporaryDirectory.path
    return "\(tmp)/cws-ble.sock"
  }

  func start() {
    if started {
      return
    }
    started = true
    NotificationCenter.default.addObserver(
      forName: NSApplication.willTerminateNotification,
      object: nil,
      queue: .main
    ) { [weak self] _ in
      Task { @MainActor in
        self?.stop()
      }
    }
    do {
      let hid = HidServer(socketPath: socketPath)
      let ble = BleServer(socketPath: bleSocketPath)
      try hid.start()
      try ble.start()
      self.hid = hid
      self.ble = ble
      let url = URL(string: "http://127.0.0.1:\(uiPort)/")!
      try node.start(hidSocket: socketPath, bleSocket: bleSocketPath, uiURL: url)
      Task { await waitForUi(url) }
    } catch {
      errorMessage = error.localizedDescription
    }
  }

  func stop() {
    node.stop()
    hid?.stop()
    ble?.stop()
    hid = nil
    ble = nil
    started = false
    ready = false
  }

  func requestStart() {
    post("start")
  }

  func requestStop() {
    hid?.dropDevice()
    ble?.dropLink()
    post("stop") { [weak self] ok in
      if !ok {
        self?.recoverNode()
      }
    }
  }

  private func recoverNode() {
    let url = uiURL ?? URL(string: "http://127.0.0.1:\(uiPort)/")!
    node.stop()
    do {
      try node.start(hidSocket: socketPath, bleSocket: bleSocketPath, uiURL: url)
      Task { await waitForUi(url) }
    } catch {
      errorMessage = error.localizedDescription
    }
  }

  private func post(_ path: String, done: ((Bool) -> Void)? = nil) {
    guard let url = URL(string: "http://127.0.0.1:\(uiPort)/\(path)") else {
      done?(false)
      return
    }
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.timeoutInterval = 1.5
    URLSession.shared.dataTask(with: request) { _, response, _ in
      let ok = (response as? HTTPURLResponse)?.statusCode == 200
      DispatchQueue.main.async {
        done?(ok)
      }
    }.resume()
  }

  private func waitForUi(_ url: URL) async {
    for _ in 0..<50 {
      if Task.isCancelled {
        return
      }
      if let (_, response) = try? await URLSession.shared.data(from: url),
         (response as? HTTPURLResponse)?.statusCode == 200 {
        uiURL = url
        ready = true
        errorMessage = nil
        return
      }
      try? await Task.sleep(nanoseconds: 200_000_000)
    }
    let extra = node.lastOutput.trimmingCharacters(in: .whitespacesAndNewlines)
    errorMessage = extra.isEmpty
      ? "proxy UI did not start on \(url.absoluteString)"
      : extra
  }
}
