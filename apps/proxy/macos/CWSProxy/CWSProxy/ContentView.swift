import AppKit
import SwiftUI
import WebKit

struct ContentView: View {
  @ObservedObject var session: ProxySession

  var body: some View {
    VStack(spacing: 0) {
      ZStack {
        Color(red: 7 / 255, green: 8 / 255, blue: 10 / 255).ignoresSafeArea()
        if let message = session.errorMessage {
          Text(message)
            .font(.system(.body, design: .monospaced))
            .foregroundStyle(Color(red: 1, green: 92 / 255, blue: 122 / 255))
            .padding(24)
        } else if session.ready, let url = session.uiURL {
          WebView(url: nativeURL(url))
        } else {
          Text("Starting…")
            .font(.system(.body, design: .monospaced))
            .foregroundStyle(Color(red: 124 / 255, green: 132 / 255, blue: 145 / 255))
        }
      }
      NativeDock(
        onStart: { session.requestStart() },
        onStop: { session.requestStop() }
      )
    }
    .frame(minWidth: 420, minHeight: 740)
  }
}

private func nativeURL(_ url: URL) -> URL {
  var parts = URLComponents(url: url, resolvingAgainstBaseURL: false) ?? URLComponents()
  var items = parts.queryItems ?? []
  if items.contains(where: { $0.name == "native" }) == false {
    items.append(URLQueryItem(name: "native", value: "1"))
  }
  parts.queryItems = items
  return parts.url ?? url
}

struct NativeDock: View {
  let onStart: () -> Void
  let onStop: () -> Void

  var body: some View {
    HStack(spacing: 8) {
      dockButton("Start", color: Color(red: 1, green: 90 / 255, blue: 31 / 255), action: onStart)
      dockButton("Stop", color: Color(red: 1, green: 92 / 255, blue: 122 / 255), action: onStop)
    }
    .padding(.horizontal, 12)
    .padding(.top, 10)
    .padding(.bottom, 12)
    .background(Color(red: 14 / 255, green: 16 / 255, blue: 20 / 255))
  }

  private func dockButton(_ title: String, color: Color, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Text(title)
        .font(.system(size: 14, weight: .semibold))
        .foregroundStyle(Color(red: 10 / 255, green: 12 / 255, blue: 16 / 255))
        .frame(maxWidth: .infinity, minHeight: 48)
        .contentShape(Rectangle())
        .background(color)
        .clipShape(RoundedRectangle(cornerRadius: 2))
    }
    .buttonStyle(.plain)
  }
}

struct WebView: NSViewRepresentable {
  let url: URL

  func makeNSView(context: Context) -> ProxyWebView {
    let view = ProxyWebView(frame: .zero)
    view.setValue(true, forKey: "drawsBackground")
    view.wantsLayer = true
    view.layer?.isOpaque = true
    view.underPageBackgroundColor = NSColor(red: 7 / 255, green: 8 / 255, blue: 10 / 255, alpha: 1)
    if #available(macOS 13.3, *) {
      view.isInspectable = true
    }
    view.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData))
    return view
  }

  func updateNSView(_ view: ProxyWebView, context: Context) {
    if view.url != url {
      view.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData))
    }
  }
}

final class ProxyWebView: WKWebView {
  override var isOpaque: Bool { true }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool {
    true
  }
}
