import Foundation
import WebKit
import UniformTypeIdentifiers

/// Serves `ordo://local/app/…` from the bundled web UI and `ordo://local/vault/…`
/// from the open vault. One origin for both keeps canvas image editing untainted.
final class SchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "ordo"
    static func appURL(_ file: String) -> URL { URL(string: "\(scheme)://local/app/\(file)")! }

    /// Set by the app model whenever a vault is opened.
    nonisolated(unsafe) static var vaultRoot: URL?

    nonisolated(unsafe) static var webRoot: URL = Bundle.main.resourceURL!.appendingPathComponent("Web", isDirectory: true)

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        let parts = url.path.split(separator: "/", omittingEmptySubsequences: true).map { String($0).removingPercentEncoding ?? String($0) }
        guard let area = parts.first else { return fail(task, url) }
        let rest = parts.dropFirst().joined(separator: "/")
        let fileURL: URL?
        switch area {
        case "app": fileURL = Self.webRoot.appendingPathComponent(rest)
        case "vault": fileURL = Self.vaultRoot?.appendingPathComponent(rest)
        default: fileURL = nil
        }
        guard let fileURL, !rest.contains(".."), let data = VaultStore.coordinatedRead(fileURL) else {
            if let fileURL { try? FileManager.default.startDownloadingUbiquitousItem(at: fileURL) }
            return fail(task, url)
        }
        let mime = UTType(filenameExtension: fileURL.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: [
            "Content-Type": mime,
            "Content-Length": String(data.count),
            "Cache-Control": area == "vault" ? "no-cache" : "max-age=60",
            "Access-Control-Allow-Origin": "*",
        ])!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

    private func fail(_ task: WKURLSchemeTask, _ url: URL) {
        let r = HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: nil)!
        task.didReceive(r)
        task.didReceive(Data())
        task.didFinish()
    }

    static func configuration(handler: WKScriptMessageHandlerWithReply?, schemeHandler: SchemeHandler) -> WKWebViewConfiguration {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(schemeHandler, forURLScheme: scheme)
        if let handler {
            config.userContentController.addScriptMessageHandler(handler, contentWorld: .page, name: "ordo")
        }
        #if os(iOS)
        config.dataDetectorTypes = []
        #endif
        return config
    }
}
