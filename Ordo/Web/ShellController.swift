import Foundation
import WebKit
import UniformTypeIdentifiers
#if os(macOS)
import AppKit
#else
import UIKit
#endif

/// The single web view that draws Ordo's whole interface (like Obsidian),
/// and the request handlers it calls via `request({type: …})`.
@MainActor
final class ShellController: WebController {
    weak var app: AppModel?
    /// Smaller versions from the last "compressPlan", written on "applyCompress".
    private var compressCache: [String: Data] = [:]
    private let exporter = PDFExporter()

    init() {
        super.init(page: "app.html")
        #if os(macOS)
        (webView as? OrdoWebView)?.onHotkey = { [weak self] combo in self?.callJSON("ordo.host.hotkey", combo) }
        #endif
    }

    /// Runs a command of the web app (used by the native menu bar).
    func command(_ id: String) { callJSON("ordo.host.command", id) }

    override func handle(_ type: String, _ body: [String: Any]) async throws -> Any? {
        guard let app else { return nil }
        let str = { (k: String) in body[k] as? String ?? "" }

        // requests that work without a vault
        switch type {
        case "boot":
            return app.bootInfo()
        case "log":
            NSLog("JS %@", str("message"))
            return nil
        case "pickVault":
            #if os(macOS)
            Platform.chooseFolder { app.openVault($0) }
            #else
            app.showFolderPicker = true
            #endif
            return nil
        case "openVault":
            let url = URL(fileURLWithPath: str("path"), isDirectory: true)
            if let rec = VaultAccess.recent.first(where: { $0.path == url.path }), let resolved = VaultAccess.resolve(rec) {
                app.openVault(resolved)
            } else {
                app.openVault(url)
            }
            return nil
        case "closeVault":
            app.closeVault()
            return nil
        case "forgetVault":
            if let rec = VaultAccess.recent.first(where: { $0.path == str("path") }) { VaultAccess.forget(rec) }
            return app.bootInfo()
        case "external":
            if let url = URL(string: str("url")) { openExternal(url) }
            return nil
        case "fonts":
            #if os(macOS)
            return NSFontManager.shared.availableFontFamilies.sorted()
            #else
            return UIFont.familyNames.sorted()
            #endif
        case "setLanguage":
            app.lang = str("lang") == "en" ? "en" : "de"
            UserDefaults.standard.set(app.lang, forKey: "lang")
            return nil
        case "setZoom":
            let z = max(0.6, min(1.6, body["zoom"] as? Double ?? 1))
            webView.pageZoom = z
            #if os(macOS)
            (webView as? OrdoWebView)?.zoom = z
            #endif
            return nil
        case "hotkeys":
            #if os(macOS)
            (webView as? OrdoWebView)?.boundHotkeys = Set(body["combos"] as? [String] ?? [])
            #endif
            return nil
        case "dragRegions":
            #if os(macOS)
            let rects = (body["rects"] as? [[Double]] ?? []).map { CGRect(x: $0[0], y: $0[1], width: $0[2], height: $0[3]) }
            (webView as? OrdoWebView)?.dragRects = rects
            #endif
            return nil
        case "fetchText":
            // community theme browser: download a stylesheet / list
            guard let url = URL(string: str("url")), url.scheme == "https" else { throw HostError(message: "Ungültige Adresse") }
            let (data, _) = try await URLSession.shared.data(from: url)
            return String(decoding: data, as: UTF8.self)
        default: break
        }

        guard let v = app.vault else { throw HostError(message: "Kein Vault geöffnet") }
        switch type {
        case "index":
            return v.indexSnapshot()
        case "read":
            return v.text(str("path")) ?? ""
        case "write":
            let path = str("path")
            v.write(path, text: str("text"))
            let dest = (body["typingTag"] as? Bool ?? false) ? nil : v.autoSort(path)
            app.pushIndexIfNeeded()
            return ["path": dest ?? path, "moved": dest != nil, "from": path]
        case "leave":
            let path = str("path")
            let dest = v.autoSort(path, leaving: true)
            app.pushIndexIfNeeded()
            return ["path": dest ?? path, "moved": dest != nil, "from": path]
        case "noteOpened":
            v.noteOpened(str("path"))
            return nil
        case "create":
            let folder = body["folder"] as? String
            let path = v.createNote(in: folder, title: body["title"] as? String, text: str("text"))
            app.pushIndexIfNeeded()
            return path
        case "createFolder":
            let path = v.uniquePath(str("path"))
            v.createFolder(path)
            app.pushIndexIfNeeded()
            return path
        case "rename":
            let path = str("path")
            let dest = Paths.isNote(path) ? try v.renameNote(path, to: str("name")) : try renameOther(v, path, str("name"))
            app.pushIndexIfNeeded()
            return dest
        case "move":
            let path = str("path"), folder = str("folder")
            var dest = path
            if v.notes[path] != nil { dest = try v.moveNote(path, toFolder: folder, manual: body["manual"] as? Bool ?? true) }
            else if v.folders.contains(path) { try v.moveFolder(path, into: folder); dest = Paths.join(folder, Paths.file(path)) }
            else { try v.moveFile(path, toFolder: folder); dest = Paths.join(folder, Paths.file(path)) }
            app.pushIndexIfNeeded()
            return dest
        case "trash":
            try v.trash(str("path"))
            app.pushIndexIfNeeded()
            return nil
        case "trashList":
            return v.listTrash()
        case "trashRestore":
            let path = try await v.restoreFromTrash(str("name"))
            app.pushIndexIfNeeded()
            return path
        case "trashDelete":
            try v.deleteFromTrash(str("name"))
            return nil
        case "trashEmpty":
            try v.emptyTrash()
            return nil
        case "setPinned":
            let path = str("path")
            let dest = v.setPinned(path, body["pinned"] as? Bool ?? true)
            app.pushIndexIfNeeded()
            return ["path": dest ?? path, "moved": dest != nil, "from": path]
        case "sortInfo":
            let path = str("path")
            return [
                "autoSort": v.settings.autoSort,
                "pinned": v.isPinned(path),
                "target": (v.targetFolder(for: path) ?? "") as Any,
                "resolvedTarget": (v.targetFolder(for: path).map { v.resolveFolder($0) } ?? "") as Any,
            ]
        case "sortAllPlan":
            return v.sortAllPlan().map { ["path": $0.path, "target": $0.target] }
        case "applySortAll":
            let items = (body["items"] as? [[String: String]] ?? []).compactMap { d -> (path: String, target: String)? in
                guard let p = d["path"], let t = d["target"] else { return nil }
                return (p, t)
            }
            let n = v.applySortAll(items)
            app.pushIndexIfNeeded()
            return n
        case "getSettings":
            return v.settingsJSON()
        case "setSettings":
            #if os(macOS)
            let before = (v.settings.gitEnabled, v.settings.gitRemote)
            #endif
            if let s = body["settings"] { v.applySettingsJSON(s) }
            #if os(macOS)
            if before != (v.settings.gitEnabled, v.settings.gitRemote) { app.startGit() }   // switched on/off or new remote
            #endif
            return v.settingsJSON()
        case "readNote":
            guard let path = v.resolve(MarkdownParsing.linkTarget(str("target")), from: str("from")),
                  Paths.isNote(path), let text = v.text(path) else { return nil }
            return ["path": path, "text": text]
        case "saveAttachment":
            guard let data = Data(base64Encoded: str("data")) else { throw HostError(message: "Ungültige Daten") }
            let res = try v.saveAttachment(data: data, mime: str("mime"), suggestedName: body["name"] as? String, notePath: str("notePath"))
            app.pushIndexIfNeeded()
            return ["path": res.path, "link": res.link]
        case "saveImage":
            guard let data = Data(base64Encoded: str("data")) else { throw HostError(message: "Ungültige Daten") }
            let written = v.saveEditedImage(path: str("path"), data: data, mime: str("mime"), copy: body["copy"] as? Bool ?? false)
            app.pushIndexIfNeeded()
            return ["path": written]
        case "gitStatus":
            #if os(macOS)
            app.pushGitStatus()
            return app.git?.statusJSON ?? ["state": v.settings.gitEnabled && !GitSync.gitAvailable() ? "nogit" : "off"]
            #else
            return ["state": "off"]
            #endif
        case "gitTest":
            #if os(macOS)
            let g = app.git ?? GitSync(root: v.root)
            let r = await g.test(remote: str("remote"))
            return ["ok": r.ok, "message": r.message]
            #else
            return ["ok": false, "message": "Nur am Mac"]
            #endif
        case "gitSync":
            #if os(macOS)
            guard let g = app.git else { return false }
            await g.commit()
            let ok = await g.push()
            return ok
            #else
            return false
            #endif
        case "gitPull":
            #if os(macOS)
            guard let g = app.git else { return false }
            let ok = await g.pull()
            if ok { app.refreshNow() }
            return ok
            #else
            return false
            #endif
        case "compressPlan":
            let plan = await v.compressPlan(maxDim: body["maxDim"] as? Int ?? v.settings.maxImageDimension, targetWidth: body["targetWidth"] as? Int ?? 0, paths: body["paths"] as? [String])
            compressCache = Dictionary(plan.map { ($0.path, $0.shrunk.data) }, uniquingKeysWith: { a, _ in a })
            return plan.map { ["path": $0.path, "old": $0.old, "new": $0.shrunk.data.count,
                               "w0": $0.shrunk.oldSize.w, "h0": $0.shrunk.oldSize.h, "w1": $0.shrunk.newSize.w, "h1": $0.shrunk.newSize.h] as [String: Any] }
        case "applyCompress":
            let paths = body["paths"] as? [String] ?? []
            v.writeCompressed(paths.compactMap { p in compressCache[p].map { (path: p, new: $0) } })
            compressCache = [:]
            return paths.count
        case "pickAttachments":
            return try await pickAttachments(v, note: str("notePath"))
        case "search":
            return v.search(str("query"), caseSensitive: body["caseSensitive"] as? Bool ?? false)
        case "appearance":
            return v.appearance()
        case "saveAppearance":
            if let obj = body["appearance"] as? [String: Any] { v.saveAppearance(obj) }
            return nil
        case "themes":
            return v.themes()
        case "themeCSS":
            return v.themeCSS(str("name"))
        case "installTheme":
            v.installTheme(name: str("name"), css: str("css"))
            return v.themes()
        case "snippets":
            return v.snippets()
        case "snippetCSS":
            return v.snippetCSS(str("name"))
        case "styleSettings":
            return v.styleSettings()
        case "openSnippetsFolder":
            let dir = v.folderSnippetsPath()
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            Platform.reveal(dir)
            return nil
        case "reveal":
            Platform.reveal(v.url(str("path")))
            return nil
        case "workspace":
            return UserDefaults.standard.string(forKey: "workspace:" + v.root.path)
        case "saveWorkspace":
            UserDefaults.standard.set(str("json"), forKey: "workspace:" + v.root.path)
            return nil
        case "export":
            return try await export(v, body)
        default:
            return nil
        }
    }

    private func renameOther(_ v: VaultStore, _ path: String, _ name: String) throws -> String {
        if v.folders.contains(path) {
            try v.renameFolder(path, to: name)
            return Paths.join(Paths.folder(path), FolderRules.sanitize(name))
        }
        let ext = Paths.ext(path)
        let base = (name as NSString).pathExtension.isEmpty ? name + "." + ext : name
        let dest = v.uniquePath(Paths.join(Paths.folder(path), FolderRules.sanitize(base)))
        try VaultStore.coordinatedMove(from: v.url(path), to: v.url(dest))
        Task { await v.refresh(); app?.pushIndexIfNeeded() }
        return dest
    }

    // MARK: attachments via native pickers

    private func pickAttachments(_ v: VaultStore, note: String) async throws -> [String] {
        var items: [(Data, String, String?)] = []
        #if os(macOS)
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.allowedContentTypes = [.image, .pdf]
        guard panel.runModal() == .OK else { return [] }
        for url in panel.urls {
            if let data = try? Data(contentsOf: url) {
                items.append((data, UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "", url.lastPathComponent))
            }
        }
        #else
        guard let model = app else { return [] }
        items = await model.pickPhotos().map { ($0.0, $0.1, nil) }
        #endif
        var links: [String] = []
        for (data, mime, name) in items {
            if let res = try? v.saveAttachment(data: data, mime: mime, suggestedName: name, notePath: note) { links.append(res.link) }
        }
        app?.pushIndexIfNeeded()
        return links
    }

    // MARK: PDF export

    private func export(_ v: VaultStore, _ body: [String: Any]) async throws -> Any? {
        let paths = body["paths"] as? [String] ?? []
        let o = body["options"] as? [String: Any] ?? [:]
        var options = ExportOptions()
        if let pageObj = o["page"], let data = try? JSONSerialization.data(withJSONObject: pageObj),
           let page = try? JSONDecoder().decode(PageSettings.self, from: data) { options.page = page }
        options.tableOfContents = o["toc"] as? Bool ?? true
        options.titleHeadings = o["titles"] as? Bool ?? true
        let combined = o["combined"] as? Bool ?? true
        let name = (o["name"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? v.name

        var files: [(String, Data)] = []
        if combined {
            files.append((name, try await exporter.export(paths: paths, vault: v, options: options) { [weak self] p in
                self?.callJSON("ordo.host.exportProgress", p)
            }))
        } else {
            for (i, p) in paths.enumerated() {
                files.append((Paths.noteName(p), try await exporter.export(paths: [p], vault: v, options: options)))
                callJSON("ordo.host.exportProgress", Double(i + 1) / Double(max(1, paths.count)))
            }
        }
        #if DEBUG && os(macOS)
        // automated checks: write straight into a folder instead of asking
        if let dir = ProcessInfo.processInfo.environment["ORDO_DEBUG_EXPORT_DIR"] {
            for (n, data) in files { try data.write(to: URL(fileURLWithPath: dir).appendingPathComponent(FolderRules.sanitize(n) + ".pdf")) }
            return true
        }
        #endif
        #if os(macOS)
        if files.count == 1 {
            return Platform.save(data: files[0].1, suggestedName: files[0].0 + ".pdf") != nil
        }
        var target: URL?
        Platform.chooseFolder(prompt: "Hier speichern", message: "Ordner für \(files.count) PDFs wählen") { target = $0 }
        guard let dir = target else { return false }
        for (n, data) in files { try data.write(to: dir.appendingPathComponent(FolderRules.sanitize(n) + ".pdf")) }
        return true
        #else
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("Ordo-Export-\(UUID().uuidString.prefix(6))")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        app?.shareURLs = try files.map { n, data in
            let url = dir.appendingPathComponent(FolderRules.sanitize(n) + ".pdf")
            try data.write(to: url)
            return url
        }
        return true
        #endif
    }
}
