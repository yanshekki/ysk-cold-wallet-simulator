import SwiftUI

@main
struct CWSProxyApp: App {
  @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
  @StateObject private var session = ProxySession()

  var body: some Scene {
    WindowGroup("CWS Proxy") {
      ContentView(session: session)
        .onAppear { session.start() }
    }
    .windowResizability(.automatic)
    .defaultSize(width: 430, height: 820)
  }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    true
  }
}
