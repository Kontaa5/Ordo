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
        // like VaultStore.url(): nothing from hidden folders (.obsidian, .ordo, .trash, .git)
        guard let fileURL, !rest.contains(".."), area != "vault" || !parts.dropFirst().contains(where: { $0.hasPrefix(".") }),
              area != "vault" || Self.vaultRoot.map({ FolderRules.isInside(fileURL, root: $0) }) == true,
              let data = VaultStore.coordinatedRead(fileURL) else {
            if let fileURL { try? FileManager.default.startDownloadingUbiquitousItem(at: fileURL) }
            return fail(task, url)
        }
        var headers = [
            "Content-Type": Self.mime(fileURL, fromVault: area == "vault"),
            "Content-Length": String(data.count),
            "Cache-Control": area == "vault" ? "no-cache" : "max-age=60",
            "X-Content-Type-Options": "nosniff",
        ]
        // Vault files are data, never code: an .html/.svg in a note folder must not
        // run script with access to the app (it would share the app's origin).
        if area == "vault" { headers["Content-Security-Policy"] = "sandbox; default-src 'none'; img-src ordo: data:; style-src 'unsafe-inline'; media-src ordo:" }
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

    /// Media types the app needs from the vault (pictures, PDFs, audio/video, fonts);
    /// everything else – HTML, scripts, XML … – goes out as plain text.
    static func mime(_ file: URL, fromVault: Bool) -> String {
        let type = UTType(filenameExtension: file.pathExtension)
        let mime = type?.preferredMIMEType ?? "application/octet-stream"
        guard fromVault else { return mime }
        if let type, [UTType.image, .audiovisualContent, .pdf, .font].contains(where: { type.conforms(to: $0) }) { return mime }
        return "text/plain; charset=utf-8"
    }

    /// The only pages allowed to talk to the app: its own bundled shell and export view.
    static func isAppPage(_ url: URL?) -> Bool {
        guard let url, url.scheme == scheme, url.host == "local" else { return false }
        return ["/app/app.html", "/app/export.html"].contains(url.path)
    }

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
