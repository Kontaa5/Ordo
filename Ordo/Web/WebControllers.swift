import Foundation
import WebKit
import SwiftUI

#if os(macOS)
/// Web view of the app shell. Handles window dragging on the (web-drawn) title
/// bar and delivers bound keyboard shortcuts to the web app reliably.
final class OrdoWebView: WKWebView {
    /// Rects (web coordinates) that behave like a title bar.
    var dragRects: [CGRect] = []
    /// pageZoom: web coordinates are scaled by it.
    var zoom: CGFloat = 1
    /// Shortcuts the web app has bound, e.g. "Mod+N", "Ctrl+T".
    var boundHotkeys: Set<String> = []
    var onHotkey: ((String) -> Void)?

    override func mouseDown(with event: NSEvent) {
        let p = convert(event.locationInWindow, from: nil)
        let webPoint = CGPoint(x: p.x, y: isFlipped ? p.y : bounds.height - p.y)
        let cssPoint = CGPoint(x: webPoint.x / zoom, y: webPoint.y / zoom)
        if dragRects.contains(where: { $0.contains(cssPoint) }), let window {
            if event.clickCount == 2 { window.performZoom(nil) } else { window.performDrag(with: event) }
            return
        }
        super.mouseDown(with: event)
    }

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if event.type == .keyDown, let combo = Self.combo(for: event), boundHotkeys.contains(combo) {
            onHotkey?(combo)
            return true
        }
        return super.performKeyEquivalent(with: event)
    }

    static func combo(for event: NSEvent) -> String? {
        let f = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        var parts: [String] = []
        if f.contains(.command) { parts.append("Mod") }
        if f.contains(.control) { parts.append("Ctrl") }
        if f.contains(.option) { parts.append("Alt") }
        if f.contains(.shift) { parts.append("Shift") }
        guard f.contains(.command) || f.contains(.control) else { return nil }
        let special: [UInt16: String] = [48: "Tab", 36: "Enter", 51: "Backspace", 53: "Escape", 123: "ArrowLeft", 124: "ArrowRight", 125: "ArrowDown", 126: "ArrowUp", 49: "Space"]
        let key: String
        if let s = special[event.keyCode] { key = s }
        else if let ch = event.characters(byApplyingModifiers: []), !ch.isEmpty { key = ch.uppercased() }
        else { return nil }
        return (parts + [key]).joined(separator: "+")
    }
}
#endif

/// Base for the long-lived web views: queues calls until the page reports
/// `ready`, answers requests from the page.
@MainActor
class WebController: NSObject, WKScriptMessageHandlerWithReply, WKNavigationDelegate {
    let webView: WKWebView
    private var ready = false
    private var queue: [String] = []
    private let schemeHandler = SchemeHandler()

    init(page: String) {
        let proxy = MessageProxy()
        let config = SchemeHandler.configuration(handler: proxy, schemeHandler: schemeHandler)
        #if os(macOS)
        webView = OrdoWebView(frame: CGRect(x: 0, y: 0, width: 1200, height: 800), configuration: config)
        #else
        webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 400, height: 800), configuration: config)
        #endif
        super.init()
        proxy.target = self
        webView.navigationDelegate = self
        if #available(macOS 13.3, iOS 16.4, *) { webView.isInspectable = true }
        #if os(macOS)
        webView.setValue(false, forKey: "drawsBackground")
        webView.allowsMagnification = false
        #else
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.bounces = false
        #endif
        webView.load(URLRequest(url: SchemeHandler.appURL(page)))
    }

    var isReady: Bool { ready }

    func call(_ js: String) {
        if ready { webView.evaluateJavaScript(js, completionHandler: nil) } else { queue.append(js) }
    }

    func callJSON(_ fn: String, _ arg: Any) {
        guard let data = try? JSONSerialization.data(withJSONObject: arg, options: [.fragmentsAllowed]),
              let json = String(data: data, encoding: .utf8) else { return }
        call("\(fn)(\(json))")
    }

    func markReady() {
        ready = true
        let pending = queue
        queue = []
        for js in pending { webView.evaluateJavaScript(js, completionHandler: nil) }
    }

    func handle(_ type: String, _ body: [String: Any]) async throws -> Any? { nil }
    func didBecomeReady() {}

    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { replyHandler(nil, nil); return }
        if type == "ready" { markReady(); didBecomeReady(); replyHandler(nil, nil); return }
        Task { @MainActor in
            do { replyHandler(Self.jsonSafe(try await self.handle(type, body)), nil) }
            catch { replyHandler(nil, error.localizedDescription) }
        }
    }

    /// WebKit can only pass plist-like values back.
    static func jsonSafe(_ v: Any?) -> Any? {
        guard let v else { return nil }
        if v is NSNull { return nil }
        return v
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        ready = false
        webView.reload()
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
        guard let url = action.request.url else { return .cancel }
        if url.scheme == SchemeHandler.scheme { return .allow }
        if action.navigationType == .linkActivated { openExternal(url) }
        return .cancel
    }
}

/// Avoids a retain cycle between WKUserContentController and the controller.
private final class MessageProxy: NSObject, WKScriptMessageHandlerWithReply {
    weak var target: WKScriptMessageHandlerWithReply?
    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void) {
        target?.userContentController(ucc, didReceive: message, replyHandler: replyHandler)
    }
}

@MainActor
func openExternal(_ url: URL) {
    #if os(macOS)
    NSWorkspace.shared.open(url)
    #else
    UIApplication.shared.open(url)
    #endif
}

// MARK: - SwiftUI hosting

#if os(macOS)
final class WebContainer: NSView {
    override func layout() {
        super.layout()
        subviews.first?.frame = bounds
    }
}

struct WebViewHost: NSViewRepresentable {
    let webView: WKWebView
    func makeNSView(context: Context) -> WebContainer {
        let container = WebContainer()
        attach(to: container)
        return container
    }
    func updateNSView(_ view: WebContainer, context: Context) {
        if webView.superview !== view { attach(to: view) }
    }
    private func attach(to container: WebContainer) {
        webView.removeFromSuperview()
        container.addSubview(webView)
        webView.frame = container.bounds
        container.needsLayout = true
    }
}
#else
final class WebContainer: UIView {
    override func layoutSubviews() {
        super.layoutSubviews()
        subviews.first?.frame = bounds
    }
}

struct WebViewHost: UIViewRepresentable {
    let webView: WKWebView
    func makeUIView(context: Context) -> WebContainer {
        let container = WebContainer()
        container.backgroundColor = .clear
        attach(to: container)
        return container
    }
    func updateUIView(_ view: WebContainer, context: Context) {
        if webView.superview !== view { attach(to: view) }
    }
    private func attach(to container: WebContainer) {
        webView.removeFromSuperview()
        container.addSubview(webView)
        webView.frame = container.bounds
        container.setNeedsLayout()
    }
}
#endif
