import Foundation
import WebKit
import PDFKit
import CoreText

struct ExportOptions {
    var page = PageSettings()
    var tableOfContents = true
    var titleHeadings = true
}

/// Renders notes into a paginated PDF. Layout and page breaks come from the
/// same web paginator the editor uses for its page markers; each page slice is
/// captured with `createPDF` and placed onto a real page with margins.
@MainActor
final class PDFExporter: NSObject, WKNavigationDelegate {
    private var webView: WKWebView?
    private var loadContinuation: CheckedContinuation<Void, Error>?
    private let schemeHandler = SchemeHandler()

    func export(paths: [String], vault: VaultStore, options: ExportOptions, progress: ((Double) -> Void)? = nil) async throws -> Data {
        let page = options.page
        let size = page.pageSize
        let margin = page.marginPt
        let contentW = size.width - 2 * margin
        let contentH = size.height - 2 * margin

        let config = SchemeHandler.configuration(handler: nil, schemeHandler: schemeHandler)
        let web = WKWebView(frame: CGRect(x: 0, y: 0, width: contentW, height: contentH), configuration: config)
        web.navigationDelegate = self
        #if os(macOS)
        web.hideBackground()
        #endif
        webView = web
        defer { webView = nil }

        try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
            loadContinuation = c
            web.load(URLRequest(url: SchemeHandler.appURL("export.html")))
        }

        let notes: [[String: Any]] = paths.map { p in
            ["path": p, "title": Paths.noteName(p), "text": vault.text(p) ?? ""]
        }
        let payload: [String: Any] = [
            "index": vault.webIndex,
            "notes": notes,
            "options": [
                "geom": page.webGeom,
                "toc": options.tableOfContents,
                "titles": options.titleHeadings,
                "tocTitle": "Inhalt",
            ] as [String: Any],
        ]
        let result = try await web.callAsyncJavaScript("return await window.exporter.render(p)", arguments: ["p": payload], contentWorld: .page) as? [String: Any]
        let pageCount = result?["pages"] as? Int ?? 0
        let outline = result?["outline"] as? [[String: Any]] ?? []
        guard pageCount > 0 else { throw HostError(message: "Nichts zu exportieren.") }

        // capture each slice
        var slices: [CGPDFPage] = []
        var keep: [CGPDFDocument] = []
        for i in 0..<pageCount {
            let h = try await web.callAsyncJavaScript("const h = window.exporter.show(i); await new Promise(r => setTimeout(r, 30)); return h;", arguments: ["i": i], contentWorld: .page) as? Double ?? Double(contentH)
            let cfg = WKPDFConfiguration()
            cfg.rect = CGRect(x: 0, y: 0, width: contentW, height: max(1, min(h, contentH)))
            let data = try await web.pdf(configuration: cfg)
            guard let provider = CGDataProvider(data: data as CFData), let doc = CGPDFDocument(provider), let pg = doc.page(at: 1) else {
                throw HostError(message: "Seite \(i + 1) konnte nicht erzeugt werden.")
            }
            keep.append(doc)
            slices.append(pg)
            progress?(Double(i + 1) / Double(pageCount))
        }

        // compose real pages
        let out = NSMutableData()
        var mediaBox = CGRect(origin: .zero, size: size)
        guard let consumer = CGDataConsumer(data: out as CFMutableData),
              let ctx = CGContext(consumer: consumer, mediaBox: &mediaBox, nil) else { throw HostError(message: "PDF-Kontext fehlgeschlagen") }
        for (i, slice) in slices.enumerated() {
            ctx.beginPDFPage(nil)
            ctx.setFillColor(CGColor(gray: 1, alpha: 1))
            ctx.fill(mediaBox)
            let box = slice.getBoxRect(.mediaBox)
            let scale = contentW / max(box.width, 1)
            ctx.saveGState()
            // PDF origin is bottom-left: place the slice under the top margin
            ctx.translateBy(x: margin, y: size.height - margin - box.height * scale)
            ctx.scaleBy(x: scale, y: scale)
            ctx.translateBy(x: -box.origin.x, y: -box.origin.y)
            ctx.clip(to: box)
            ctx.drawPDFPage(slice)
            ctx.restoreGState()
            if page.pageNumbers { drawFooter("\(i + 1) / \(slices.count)", in: ctx, size: size, margin: margin) }
            ctx.endPDFPage()
        }
        ctx.closePDF()

        guard let pdf = PDFDocument(data: out as Data) else { return out as Data }
        addOutline(outline, to: pdf, pageHeight: size.height)
        return pdf.dataRepresentation() ?? (out as Data)
    }

    private func drawFooter(_ text: String, in ctx: CGContext, size: CGSize, margin: Double) {
        let font = CTFontCreateWithName("Helvetica" as CFString, 8.5, nil)
        let attrs: [NSAttributedString.Key: Any] = [
            NSAttributedString.Key(kCTFontAttributeName as String): font,
            NSAttributedString.Key(kCTForegroundColorAttributeName as String): CGColor(gray: 0.5, alpha: 1),
        ]
        let line = CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: attrs))
        let w = CTLineGetTypographicBounds(line, nil, nil, nil)
        ctx.textPosition = CGPoint(x: (size.width - w) / 2, y: max(14, margin / 2 - 4))
        CTLineDraw(line, ctx)
    }

    private func addOutline(_ items: [[String: Any]], to pdf: PDFDocument, pageHeight: Double) {
        guard !items.isEmpty else { return }
        let root = PDFOutline()
        var lastTop: PDFOutline?
        for item in items {
            guard let title = item["title"] as? String, let idx = item["page"] as? Int, let page = pdf.page(at: idx) else { continue }
            let entry = PDFOutline()
            entry.label = title
            entry.destination = PDFDestination(page: page, at: CGPoint(x: 0, y: pageHeight))
            let level = item["level"] as? Int ?? 0
            if level == 0 || lastTop == nil {
                root.insertChild(entry, at: root.numberOfChildren)
                lastTop = entry
            } else {
                lastTop!.insertChild(entry, at: lastTop!.numberOfChildren)
            }
        }
        pdf.outlineRoot = root
    }

    // MARK: navigation

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loadContinuation?.resume()
        loadContinuation = nil
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        loadContinuation?.resume(throwing: error)
        loadContinuation = nil
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        loadContinuation?.resume(throwing: error)
        loadContinuation = nil
    }
}
