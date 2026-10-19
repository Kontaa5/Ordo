import Foundation
import Observation
import ImageIO
import UniformTypeIdentifiers

struct NoteMeta: Identifiable, Hashable, Sendable {
    var path: String
    var parsed: ParsedNote
    var isPlaceholder = false
    var id: String { path }
    var name: String { Paths.noteName(path) }
    var folder: String { Paths.folder(path) }

    static func == (a: NoteMeta, b: NoteMeta) -> Bool { a.path == b.path && a.parsed == b.parsed && a.isPlaceholder == b.isPlaceholder }
    func hash(into h: inout Hasher) { h.combine(path) }
}

struct FolderNode: Identifiable, Hashable, Sendable {
    var path: String
    var name: String
    var folders: [FolderNode] = []
    var notes: [String] = []
    var files: [String] = []
    var id: String { path.isEmpty ? "/" : path }
}

struct SortEvent: Identifiable, Equatable {
    let id = UUID()
    let from: String
    let to: String
}

enum Paths {
    static func folder(_ p: String) -> String { (p as NSString).deletingLastPathComponent }
    static func file(_ p: String) -> String { (p as NSString).lastPathComponent }
    static func noteName(_ p: String) -> String {
        let f = file(p)
        return f.lowercased().hasSuffix(".md") ? String(f.dropLast(3)) : f
    }
    static func join(_ a: String, _ b: String) -> String { a.isEmpty ? b : (b.isEmpty ? a : a + "/" + b) }
    static func isNote(_ p: String) -> Bool { p.lowercased().hasSuffix(".md") }
    static func ext(_ p: String) -> String { (p as NSString).pathExtension.lowercased() }
    static let imageExts: Set<String> = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "heic", "heif", "avif", "tif", "tiff"]
    static func isImage(_ p: String) -> Bool { imageExts.contains(ext(p)) }
}

/// One opened vault: a plain folder of Markdown files (compatible with Obsidian).
/// Keeps an index of notes, tags and links, performs all file operations and
/// runs the hashtag → folder automation.
@MainActor
@Observable
final class VaultStore {
    let root: URL
    let name: String

    private(set) var notes: [String: NoteMeta] = [:]
    private(set) var files: Set<String> = []
    private(set) var folders: Set<String> = []
    private(set) var tree = FolderNode(path: "", name: "")
    private(set) var tagCounts: [String: Int] = [:]
    /// Increases whenever notes, tags or links change (drives index pushes).
    private(set) var revision = 0
    private(set) var isLoading = true
    private(set) var importedFromObsidian = false
    var lastSortEvent: SortEvent?

    var settings: VaultSettings { didSet { if settings != oldValue { saveSettings() } } }
    private(set) var state = VaultState()

    @ObservationIgnored private(set) var contents: [String: String] = [:]
    @ObservationIgnored private var mtimes: [String: Date] = [:]
    @ObservationIgnored private var byBase: [String: [String]] = [:]
    @ObservationIgnored private var refreshing = false
    @ObservationIgnored var stats: [String: FileStat] = [:]
    @ObservationIgnored var onExternalChange: ((String, String) -> Void)?
    @ObservationIgnored var onRename: ((String, String) -> Void)?
    @ObservationIgnored var onDelete: ((String) -> Void)?

    init(root: URL) {
        self.root = root
        self.name = root.lastPathComponent
        self.settings = VaultSettings()
        loadSettingsAndState()
    }

    // MARK: - URLs

    func url(_ rel: String) -> URL {
        rel.isEmpty ? root : root.appendingPathComponent(rel, isDirectory: false)
    }

    private var ordoDir: URL { root.appendingPathComponent(".ordo", isDirectory: true) }

    // MARK: - settings & state

    private func loadSettingsAndState() {
        let dec = JSONDecoder()
        let settingsURL = ordoDir.appendingPathComponent("settings.json")
        if let data = Self.coordinatedRead(settingsURL), let s = try? dec.decode(VaultSettings.self, from: data) {
            settings = s
        } else if let imported = ObsidianImport.settings(vault: root) {
            settings = imported
            importedFromObsidian = true
            saveSettings()
        }
        if let data = Self.coordinatedRead(ordoDir.appendingPathComponent("state.json")),
           let s = try? dec.decode(VaultState.self, from: data) {
            state = s
        }
    }

    private func saveSettings() {
        let enc = JSONEncoder()
        enc.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? enc.encode(settings) else { return }
        try? FileManager.default.createDirectory(at: ordoDir, withIntermediateDirectories: true)
        Self.coordinatedWrite(data, to: ordoDir.appendingPathComponent("settings.json"))
    }

    @ObservationIgnored private var stateSaveTask: Task<Void, Never>?
    private func saveState() {
        stateSaveTask?.cancel()
        stateSaveTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(500))
            guard let self, !Task.isCancelled else { return }
            let enc = JSONEncoder()
            enc.outputFormatting = [.sortedKeys]
            guard let data = try? enc.encode(self.state) else { return }
            try? FileManager.default.createDirectory(at: self.ordoDir, withIntermediateDirectories: true)
            Self.coordinatedWrite(data, to: self.ordoDir.appendingPathComponent("state.json"))
        }
    }

    // MARK: - scanning

    struct ScanEntry: Sendable { let modified: Date; let placeholder: Bool }
    struct FileStat: Sendable, Equatable { var mtime: Date; var ctime: Date; var size: Int }
    struct ScanResult: Sendable {
        var notes: [String: ScanEntry] = [:]
        var stats: [String: FileStat] = [:]
        var files: Set<String> = []
        var folders: Set<String> = []
        var placeholders: [URL] = []
    }

    nonisolated static func scan(root: URL) -> ScanResult {
        var r = ScanResult()
        let keys: [URLResourceKey] = [.isDirectoryKey, .contentModificationDateKey, .creationDateKey, .fileSizeKey]
        let rootPath = root.path.hasSuffix("/") ? String(root.path.dropLast()) : root.path
        guard let en = FileManager.default.enumerator(at: root, includingPropertiesForKeys: keys, options: [], errorHandler: { _, _ in true }) else { return r }
        for case let url as URL in en {
            let name = url.lastPathComponent
            guard url.path.hasPrefix(rootPath + "/") else { continue }
            let rel = String(url.path.dropFirst(rootPath.count + 1))
            let vals = try? url.resourceValues(forKeys: Set(keys))
            if vals?.isDirectory == true {
                if name.hasPrefix(".") || name == "node_modules" { en.skipDescendants(); continue }
                r.folders.insert(rel)
                continue
            }
            if name.hasPrefix(".") {
                // iCloud placeholder of a file that is not downloaded yet: ".Name.md.icloud"
                if name.hasSuffix(".icloud") {
                    let real = String(name.dropFirst().dropLast(7))
                    let realRel = Paths.join(Paths.folder(rel), real)
                    r.placeholders.append(url.deletingLastPathComponent().appendingPathComponent(real))
                    if Paths.isNote(real) { r.notes[realRel] = ScanEntry(modified: .distantPast, placeholder: true) }
                    else { r.files.insert(realRel) }
                }
                continue
            }
            r.stats[rel] = FileStat(mtime: vals?.contentModificationDate ?? .distantPast, ctime: vals?.creationDate ?? vals?.contentModificationDate ?? .distantPast, size: vals?.fileSize ?? 0)
            if Paths.isNote(name) {
                r.notes[rel] = ScanEntry(modified: vals?.contentModificationDate ?? .distantPast, placeholder: false)
            } else {
                r.files.insert(rel)
            }
        }
        return r
    }

    nonisolated static func readText(_ url: URL) -> String? {
        guard let data = coordinatedRead(url) else { return nil }
        return String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1)
    }

    /// Rescans the vault and reloads notes that changed on disk (e.g. via iCloud).
    func refresh() async {
        guard !refreshing else { return }
        refreshing = true
        defer { refreshing = false }
        let root = self.root
        let result = await Task.detached(priority: .utility) { Self.scan(root: root) }.value

        let known = mtimes
        let toLoad = result.notes.compactMap { path, entry -> String? in
            if entry.placeholder { return nil }
            return known[path] == entry.modified && notes[path] != nil && !(notes[path]?.isPlaceholder ?? false) ? nil : path
        }
        let loaded: [(String, String, ParsedNote, Date)] = await Task.detached(priority: .utility) {
            toLoad.compactMap { p in
                guard let text = Self.readText(root.appendingPathComponent(p)) else { return nil }
                return (p, text, MarkdownParsing.parse(text), result.notes[p]?.modified ?? Date())
            }
        }.value

        var structureChanged = false
        // removed notes
        for path in notes.keys where result.notes[path] == nil {
            notes[path] = nil
            contents[path] = nil
            mtimes[path] = nil
            structureChanged = true
            onDelete?(path)
        }
        // placeholders (not downloaded yet)
        for (path, entry) in result.notes where entry.placeholder && notes[path] == nil {
            notes[path] = NoteMeta(path: path, parsed: ParsedNote(), isPlaceholder: true)
            structureChanged = true
        }
        for (path, text, parsed, modified) in loaded {
            let previous = contents[path]
            mtimes[path] = modified
            if previous == text, notes[path]?.isPlaceholder == false { continue }
            contents[path] = text
            if notes[path]?.parsed != parsed || notes[path]?.isPlaceholder != false {
                notes[path] = NoteMeta(path: path, parsed: parsed)
                structureChanged = true
            }
            if let previous, previous != text { onExternalChange?(path, text) }
        }
        if files != result.files { files = result.files; structureChanged = true }
        if stats != result.stats { stats = result.stats; structureChanged = true }
        if folders != result.folders { folders = result.folders; structureChanged = true }

        for url in result.placeholders {
            try? FileManager.default.startDownloadingUbiquitousItem(at: url)
        }
        if structureChanged || isLoading { rebuildIndex() }
        isLoading = false
    }

    private func rebuildIndex() {
        // basename lookup for link resolution
        var map: [String: [String]] = [:]
        for p in notes.keys {
            map[Paths.noteName(p).lowercased(), default: []].append(p)
            map[Paths.file(p).lowercased(), default: []].append(p)
        }
        for p in files { map[Paths.file(p).lowercased(), default: []].append(p) }
        byBase = map

        var counts: [String: Int] = [:]
        for n in notes.values { for t in n.parsed.tags { counts[t, default: 0] += 1 } }
        tagCounts = counts
        tree = Self.buildTree(notes: Array(notes.keys), files: files, folders: folders)
        revision += 1
    }

    nonisolated static func buildTree(notes: [String], files: Set<String>, folders: Set<String>) -> FolderNode {
        final class Box { var node: FolderNode; var children: [String: Box] = [:]; init(_ n: FolderNode) { node = n } }
        let root = Box(FolderNode(path: "", name: ""))
        func box(for folder: String) -> Box {
            guard !folder.isEmpty && folder != "." else { return root }
            var cur = root
            var path = ""
            for comp in folder.split(separator: "/") {
                path = Paths.join(path, String(comp))
                if let next = cur.children[String(comp)] { cur = next }
                else { let b = Box(FolderNode(path: path, name: String(comp))); cur.children[String(comp)] = b; cur = b }
            }
            return cur
        }
        for f in folders { _ = box(for: f) }
        for n in notes { box(for: Paths.folder(n)).node.notes.append(n) }
        for f in files { box(for: Paths.folder(f)).node.files.append(f) }
        func finish(_ b: Box) -> FolderNode {
            var n = b.node
            n.folders = b.children.values.map(finish).sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
            n.notes.sort { Paths.noteName($0).localizedStandardCompare(Paths.noteName($1)) == .orderedAscending }
            n.files.sort { Paths.file($0).localizedStandardCompare(Paths.file($1)) == .orderedAscending }
            return n
        }
        return finish(root)
    }

    // MARK: - lookup

    func text(_ path: String) -> String? {
        if let t = contents[path] { return t }
        let t = Self.readText(url(path))
        if let t { contents[path] = t }
        return t
    }

    /// Obsidian-style link resolution (basename first, same folder preferred, shortest path wins).
    func resolve(_ rawTarget: String, from: String = "") -> String? {
        var target = rawTarget.trimmingCharacters(in: .whitespaces)
        target = target.removingPercentEncoding ?? target
        if target.hasPrefix("./") { target.removeFirst(2) }
        if target.hasPrefix("/") { target.removeFirst() }
        guard !target.isEmpty else { return nil }
        let all = Array(notes.keys) + Array(files)
        let lower = target.lowercased()
        if lower.contains("/") {
            let rel = (Paths.join(Paths.folder(from), target) as NSString).standardizingPath.lowercased()
            for cand in [rel, rel + ".md", lower, lower + ".md"] {
                if let hit = all.first(where: { $0.lowercased() == cand }) { return hit }
            }
            return all.first { $0.lowercased().hasSuffix("/" + lower) || $0.lowercased().hasSuffix("/" + lower + ".md") }
        }
        guard let list = byBase[lower], !list.isEmpty else { return nil }
        if list.count == 1 { return list[0] }
        let dir = Paths.folder(from).lowercased()
        if let same = list.first(where: { Paths.folder($0).lowercased() == dir }) { return same }
        return list.min { $0.count < $1.count }
    }

    func backlinks(to path: String) -> [(path: String, snippet: String)] {
        var out: [(String, String)] = []
        let name = Paths.noteName(path)
        for (p, meta) in notes where p != path {
            let targets = meta.parsed.links + meta.parsed.embeds
            guard targets.contains(where: { resolve($0, from: p) == path }) else { continue }
            var snippet = ""
            if let text = contents[p], let r = text.range(of: name, options: .caseInsensitive) {
                snippet = MarkdownParsing.snippet(text, around: r, radius: 50)
            }
            out.append((p, snippet))
        }
        return out.sorted { Paths.noteName($0.0).localizedStandardCompare(Paths.noteName($1.0)) == .orderedAscending }
    }

    func notes(withTags tags: [String], matchAll: Bool) -> [String] {
        let wanted = tags.map { $0.lowercased() }
        guard !wanted.isEmpty else { return [] }
        return notes.values.filter { meta in
            let have = Set(meta.parsed.tags.map { $0.lowercased() })
            // #schule also matches #schule/mathe
            let hit: (String) -> Bool = { w in have.contains(w) || have.contains { $0.hasPrefix(w + "/") } }
            return matchAll ? wanted.allSatisfy(hit) : wanted.contains(where: hit)
        }.map(\.path)
    }

    var sortedTags: [String] {
        tagCounts.keys.sorted { $0.localizedStandardCompare($1) == .orderedAscending }
    }

    /// Index handed to the web views (link resolution, autocompletion).
    var webIndex: [String: Any] {
        [
            "notes": notes.keys.sorted().map { ["path": $0, "name": Paths.noteName($0)] },
            "files": files.sorted(),
            "tags": sortedTags,
            "attachmentFolder": settings.attachmentFolder,
        ]
    }

    // MARK: - writing

    /// Last time a note was saved from Ordo (Git-Sync waits for a pause after it).
    private(set) var lastWrite = Date.distantPast

    func write(_ path: String, text: String) {
        guard contents[path] != text || notes[path] == nil else { return }
        contents[path] = text
        lastWrite = Date()
        let url = url(path)
        Self.coordinatedWrite(Data(text.utf8), to: url)
        let vals = try? url.resourceValues(forKeys: [.contentModificationDateKey, .creationDateKey, .fileSizeKey])
        mtimes[path] = vals?.contentModificationDate ?? Date()
        stats[path] = FileStat(mtime: vals?.contentModificationDate ?? Date(), ctime: vals?.creationDate ?? stats[path]?.ctime ?? Date(), size: vals?.fileSize ?? text.utf8.count)
        let parsed = MarkdownParsing.parse(text)
        if notes[path]?.parsed != parsed || notes[path] == nil {
            notes[path] = NoteMeta(path: path, parsed: parsed)
            rebuildIndex()
        }
    }

    func uniquePath(_ desired: String) -> String {
        let fm = FileManager.default
        if !fm.fileExists(atPath: url(desired).path) && notes[desired] == nil && !files.contains(desired) { return desired }
        let folder = Paths.folder(desired)
        let ext = (desired as NSString).pathExtension
        let base = ((Paths.file(desired)) as NSString).deletingPathExtension
        var i = 1
        while true {
            let cand = Paths.join(folder, ext.isEmpty ? "\(base) \(i)" : "\(base) \(i).\(ext)")
            if !fm.fileExists(atPath: url(cand).path) && notes[cand] == nil && !files.contains(cand) { return cand }
            i += 1
        }
    }

    @discardableResult
    func createNote(in folder: String? = nil, title: String? = nil, text: String = "") -> String {
        let dir = resolveFolder(folder ?? settings.newNoteFolder)
        createFolderIfNeeded(dir)
        let base = FolderRules.sanitize((title?.isEmpty == false ? title! : "Unbenannt").replacingOccurrences(of: "/", with: "-"))
        let path = uniquePath(Paths.join(dir, base + ".md"))
        write(path, text: text)
        // new notes get sorted as soon as they receive their first hashtag
        state.notes[path] = .init(tagKey: "")
        saveState()
        return path
    }

    func createFolderIfNeeded(_ folder: String) {
        guard !folder.isEmpty else { return }
        try? FileManager.default.createDirectory(at: url(folder), withIntermediateDirectories: true)
        var p = ""
        for c in folder.split(separator: "/") { p = Paths.join(p, String(c)); folders.insert(p) }
    }

    func createFolder(_ path: String) {
        createFolderIfNeeded(path)
        rebuildIndex()
    }

    /// Matches each component case-insensitively against existing folders.
    func resolveFolder(_ folder: String) -> String {
        var result = ""
        for comp in folder.split(separator: "/").map(String.init) where !comp.isEmpty {
            let cand = Paths.join(result, comp)
            if let existing = folders.first(where: { $0.lowercased() == cand.lowercased() && Paths.folder($0).lowercased() == result.lowercased() }) {
                result = existing
            } else {
                result = cand
            }
        }
        return result
    }

    @discardableResult
    func moveNote(_ path: String, toFolder folder: String, manual: Bool) throws -> String {
        let dir = resolveFolder(folder)
        let dest = uniquePath(Paths.join(dir, Paths.file(path)))
        guard dest != path else { return path }
        createFolderIfNeeded(dir)
        try Self.coordinatedMove(from: url(path), to: url(dest))
        renameIndexEntry(from: path, to: dest)
        var st = state.notes[path] ?? .init(tagKey: currentTagKey(dest))
        state.notes[path] = nil
        if manual { st.pinned = true; st.tagKey = currentTagKey(dest) }
        state.notes[dest] = st
        saveState()
        updatePathLinks(from: path, to: dest)
        rebuildIndex()
        onRename?(path, dest)
        return dest
    }

    func moveFile(_ path: String, toFolder folder: String) throws {
        let dest = uniquePath(Paths.join(resolveFolder(folder), Paths.file(path)))
        createFolderIfNeeded(Paths.folder(dest))
        try Self.coordinatedMove(from: url(path), to: url(dest))
        files.remove(path); files.insert(dest)
        rebuildIndex()
    }

    @discardableResult
    func renameNote(_ path: String, to newName: String) throws -> String {
        let clean = FolderRules.sanitize(newName.replacingOccurrences(of: "/", with: "-"))
        guard !clean.isEmpty else { return path }
        let dest = uniquePath(Paths.join(Paths.folder(path), clean + ".md"))
        guard dest != path else { return path }
        let oldName = Paths.noteName(path)
        try Self.coordinatedMove(from: url(path), to: url(dest))
        renameIndexEntry(from: path, to: dest)
        if let st = state.notes.removeValue(forKey: path) { state.notes[dest] = st; saveState() }
        rewriteWikilinks(oldName: oldName, newName: Paths.noteName(dest))
        rebuildIndex()
        onRename?(path, dest)
        return dest
    }

    func renameFolder(_ folder: String, to newName: String) throws {
        let clean = FolderRules.sanitize(newName.replacingOccurrences(of: "/", with: "-"))
        guard !clean.isEmpty else { return }
        let dest = Paths.join(Paths.folder(folder), clean)
        guard dest != folder else { return }
        try Self.coordinatedMove(from: url(folder), to: url(dest))
        remapPrefix(from: folder, to: dest)
    }

    func moveFolder(_ folder: String, into parent: String) throws {
        let dest = Paths.join(resolveFolder(parent), Paths.file(folder))
        guard dest != folder, !dest.lowercased().hasPrefix(folder.lowercased() + "/") else { return }
        createFolderIfNeeded(parent)
        try Self.coordinatedMove(from: url(folder), to: url(dest))
        remapPrefix(from: folder, to: dest)
    }

    private func remapPrefix(from old: String, to new: String) {
        let prefix = old + "/"
        let map: (String) -> String? = { p in p.hasPrefix(prefix) ? new + "/" + p.dropFirst(prefix.count) : nil }
        for p in Array(notes.keys) { if let n = map(p) { renameIndexEntry(from: p, to: n); onRename?(p, n) } }
        for (p, st) in state.notes { if let n = map(p) { state.notes[p] = nil; state.notes[n] = st } }
        files = Set(files.map { map($0) ?? $0 })
        folders = Set(folders.map { $0 == old ? new : (map($0) ?? $0) })
        saveState()
        rebuildIndex()
    }

    private func renameIndexEntry(from old: String, to new: String) {
        if var meta = notes.removeValue(forKey: old) { meta.path = new; notes[new] = meta }
        if let c = contents.removeValue(forKey: old) { contents[new] = c }
        if let m = mtimes.removeValue(forKey: old) { mtimes[new] = m }
    }

    /// Obsidian updates links when a note is renamed – so do we.
    private func rewriteWikilinks(oldName: String, newName: String) {
        let escaped = NSRegularExpression.escapedPattern(for: oldName)
        guard let re = try? NSRegularExpression(pattern: #"(\[\[)"# + escaped + #"(?=[\]|#])"#, options: [.caseInsensitive]) else { return }
        for (p, text) in contents where text.range(of: oldName, options: .caseInsensitive) != nil {
            let ns = text as NSString
            let updated = re.stringByReplacingMatches(in: text, range: NSRange(location: 0, length: ns.length), withTemplate: "$1" + NSRegularExpression.escapedTemplate(for: newName))
            if updated != text {
                write(p, text: updated)
                onExternalChange?(p, updated)
            }
        }
    }

    /// Links that spell out a folder path (`[[Ordner/Notiz]]`) are updated after moves.
    private func updatePathLinks(from old: String, to new: String) {
        let oldRef = String(old.dropLast(3)), newRef = String(new.dropLast(3))
        guard oldRef.contains("/") else { return }
        for (p, text) in contents where text.contains("[[" + oldRef) {
            let updated = text.replacingOccurrences(of: "[[" + oldRef, with: "[[" + newRef)
            write(p, text: updated)
            onExternalChange?(p, updated)
        }
    }

    /// Moves into the vault's `.trash` folder (like Obsidian), nothing is deleted for good.
    // MARK: trash (.trash, like Obsidian; remembers where things came from)

    struct TrashEntry: Codable { var from: String; var date: Date }
    private var trashDir: URL { root.appendingPathComponent(".trash", isDirectory: true) }
    private var trashRecordURL: URL { trashDir.appendingPathComponent(".ordo-trash.json") }
    private func trashRecords() -> [String: TrashEntry] {
        guard let d = Self.coordinatedRead(trashRecordURL) else { return [:] }
        return (try? JSONDecoder().decode([String: TrashEntry].self, from: d)) ?? [:]
    }
    private func saveTrashRecords(_ r: [String: TrashEntry]) {
        if let d = try? JSONEncoder().encode(r) { Self.coordinatedWrite(d, to: trashRecordURL) }
    }

    /// What is in the trash: name in .trash, original path, when it was deleted.
    func listTrash() -> [[String: Any]] {
        let record = trashRecords()
        let items = (try? FileManager.default.contentsOfDirectory(at: trashDir, includingPropertiesForKeys: [.isDirectoryKey, .contentModificationDateKey, .fileSizeKey], options: [.skipsHiddenFiles])) ?? []
        return items.map { u -> [String: Any] in
            let v = try? u.resourceValues(forKeys: [.isDirectoryKey, .contentModificationDateKey, .fileSizeKey])
            let rec = record[u.lastPathComponent]
            return ["name": u.lastPathComponent, "from": rec?.from ?? u.lastPathComponent, "date": (rec?.date ?? v?.contentModificationDate ?? Date()).timeIntervalSince1970,
                    "folder": v?.isDirectory ?? false, "size": v?.fileSize ?? 0]
        }.sorted { ($0["date"] as? Double ?? 0) > ($1["date"] as? Double ?? 0) }
    }

    /// Puts an item back where it was (next to it if that name is taken now). Returns the new path.
    func restoreFromTrash(_ name: String) async throws -> String {
        var record = trashRecords()
        let from = record[name]?.from ?? name
        let isDir = (try? trashDir.appendingPathComponent(name).resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
        var target = from
        if FileManager.default.fileExists(atPath: url(target).path) { target = isDir ? target + " (wiederhergestellt)" : uniquePath(target) }
        try FileManager.default.createDirectory(at: url(Paths.folder(target)), withIntermediateDirectories: true)
        try Self.coordinatedMove(from: trashDir.appendingPathComponent(name), to: url(target))
        record[name] = nil
        saveTrashRecords(record)
        await refresh()
        return target
    }

    /// Deletes an item from the trash for good.
    func deleteFromTrash(_ name: String) throws {
        guard !name.contains("/"), !name.hasPrefix(".") else { return }
        try FileManager.default.removeItem(at: trashDir.appendingPathComponent(name))
        var record = trashRecords(); record[name] = nil; saveTrashRecords(record)
    }

    func emptyTrash() throws {
        for item in listTrash() { if let n = item["name"] as? String { try deleteFromTrash(n) } }
    }

    func trash(_ path: String) throws {
        let trashDir = root.appendingPathComponent(".trash", isDirectory: true)
        try FileManager.default.createDirectory(at: trashDir, withIntermediateDirectories: true)
        var dest = trashDir.appendingPathComponent(Paths.file(path))
        var i = 1
        while FileManager.default.fileExists(atPath: dest.path) {
            let base = (Paths.file(path) as NSString).deletingPathExtension, ext = Paths.ext(path)
            dest = trashDir.appendingPathComponent(ext.isEmpty ? "\(base) \(i)" : "\(base) \(i).\(ext)")
            i += 1
        }
        try Self.coordinatedMove(from: url(path), to: dest)
        var record = trashRecords()
        record[dest.lastPathComponent] = TrashEntry(from: path, date: Date())
        saveTrashRecords(record)
        if notes[path] != nil {
            notes[path] = nil; contents[path] = nil; mtimes[path] = nil; state.notes[path] = nil
            onDelete?(path)
        } else if folders.contains(path) {
            let prefix = path + "/"
            for p in Array(notes.keys) where p.hasPrefix(prefix) { notes[p] = nil; contents[p] = nil; onDelete?(p) }
            files = files.filter { !$0.hasPrefix(prefix) }
            folders = folders.filter { $0 != path && !$0.hasPrefix(prefix) }
        } else {
            files.remove(path)
        }
        saveState()
        rebuildIndex()
    }

    // MARK: - hashtag → folder automation

    func currentTagKey(_ path: String) -> String {
        FolderRules.targetFolder(tags: notes[path]?.parsed.bodyTags ?? [], rules: settings.tagRules, allTagsAreFolders: settings.allTagsAreFolders, base: settings.sortBaseFolder)?.lowercased() ?? ""
    }

    func targetFolder(for path: String) -> String? {
        guard let meta = notes[path] else { return nil }
        return FolderRules.targetFolder(tags: meta.parsed.bodyTags, rules: settings.tagRules, allTagsAreFolders: settings.allTagsAreFolders, base: settings.sortBaseFolder)
    }

    func isPinned(_ path: String) -> Bool { state.notes[path]?.pinned ?? false }

    /// Remember the tag state of a note when it is opened, so only *changes*
    /// to its hashtags move it (existing vaults are never shuffled around).
    func noteOpened(_ path: String) {
        guard state.notes[path] == nil, notes[path] != nil else { return }
        state.notes[path] = .init(tagKey: currentTagKey(path))
        saveState()
    }

    /// Moves the note into its hashtag folder if its tags changed. Returns the new path.
    /// When its folder hashtags were removed it goes back to the base folder –
    /// but only when the note is left (`leaving`), so retyping a tag doesn't bounce it around.
    @discardableResult
    func autoSort(_ path: String, leaving: Bool = false) -> String? {
        guard settings.autoSort, notes[path] != nil else { return nil }
        let target = targetFolder(for: path)
        let key = target?.lowercased() ?? ""
        var st = state.notes[path] ?? .init(tagKey: key)
        guard !st.pinned, st.tagKey != key else {
            if state.notes[path] == nil { state.notes[path] = st; saveState() }
            return nil
        }
        if target == nil && !leaving { return nil }
        st.tagKey = key
        state.notes[path] = st
        saveState()
        let destFolder = resolveFolder(target ?? settings.sortBaseFolder)
        guard !FolderRules.same(Paths.folder(path), destFolder) else { return nil }
        guard let dest = try? moveNote(path, toFolder: destFolder, manual: false) else { return nil }
        lastSortEvent = SortEvent(from: path, to: dest)
        return dest
    }

    func setPinned(_ path: String, _ pinned: Bool) -> String? {
        if pinned {
            state.notes[path] = .init(tagKey: currentTagKey(path), pinned: true)
            saveState()
            return nil
        }
        state.notes[path] = .init(tagKey: "__unpinned__", pinned: false)
        saveState()
        return autoSort(path)
    }

    /// Notes that are not where their hashtags say (pinned notes excluded).
    func sortAllPlan() -> [(path: String, target: String)] {
        notes.values.compactMap { meta in
            guard !isPinned(meta.path), let target = targetFolder(for: meta.path) else { return nil }
            let resolved = resolveFolder(target)
            return FolderRules.same(meta.folder, resolved) ? nil : (meta.path, resolved)
        }.sorted { $0.path < $1.path }
    }

    func applySortAll(_ plan: [(path: String, target: String)]) -> Int {
        var moved = 0
        for item in plan where notes[item.path] != nil {
            if let dest = try? moveNote(item.path, toFolder: item.target, manual: false) {
                state.notes[dest] = .init(tagKey: currentTagKey(dest))
                moved += 1
            }
        }
        saveState()
        return moved
    }

    // MARK: - attachments

    func attachmentFolder(for notePath: String) -> String {
        switch settings.attachmentLocation {
        case .folder: return settings.attachmentFolder
        case .besideNote: return Paths.folder(notePath)
        case .subfolderOfNote: return Paths.join(Paths.folder(notePath), settings.attachmentSubfolderName)
        }
    }

    func saveAttachment(data: Data, mime: String, suggestedName: String?, notePath: String) throws -> (path: String, link: String) {
        var ext = Self.ext(forMime: mime) ?? (suggestedName.map { Paths.ext($0) } ?? "bin")
        var payload = data
        if Paths.imageExts.contains(ext) && ext != "gif" && ext != "svg" {
            (payload, ext) = ImageProcessing.process(data, ext: ext, maxDim: settings.maxImageDimension, convertHEIC: settings.convertHEIC, compress: settings.compressImages)
        }
        let generic = suggestedName == nil || ["image", "bild", "img", "photo", ""].contains(((suggestedName ?? "") as NSString).deletingPathExtension.lowercased())
        let stamp = Self.stampFormatter.string(from: Date())
        let base = generic ? "Bild \(stamp)" : FolderRules.sanitize(((suggestedName ?? "") as NSString).deletingPathExtension)
        let folder = resolveFolder(attachmentFolder(for: notePath))
        createFolderIfNeeded(folder)
        let path = uniquePath(Paths.join(folder, base + "." + ext))
        Self.coordinatedWrite(payload, to: url(path))
        files.insert(path)
        rebuildIndex()
        return (path, link(to: path, embed: Paths.isImage(path) || ext == "pdf"))
    }

    /// Pictures that can be stored smaller in the same format (dry run, nothing is written).
    /// `paths` = only these pictures (any size), else every picture over 1 MB. `maxDim` 0 = keep the resolution.
    func compressPlan(maxDim: Int, paths: [String]? = nil) async -> [(path: String, old: Int, shrunk: ImageProcessing.Shrunk)] {
        let pool = paths ?? files.filter { ["jpg", "jpeg", "png"].contains(Paths.ext($0).lowercased()) }.sorted()
        let candidates: [(String, URL)] = pool.map { ($0, url($0)) }
        let minSize = paths == nil ? ImageProcessing.compressThreshold : 0
        return await Task.detached(priority: .userInitiated) {
            var out: [(path: String, old: Int, shrunk: ImageProcessing.Shrunk)] = []
            for (path, u) in candidates {
                let size = (try? u.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
                guard size > minSize, let data = VaultStore.coordinatedRead(u),
                      let smaller = ImageProcessing.shrinkKeepingFormat(data, ext: Paths.ext(path), maxDim: maxDim) else { continue }
                out.append((path, data.count, smaller))
            }
            return out
        }.value
    }

    func writeCompressed(_ items: [(path: String, new: Data)]) {
        for it in items { Self.coordinatedWrite(it.new, to: url(it.path)) }
    }

    /// Writes an edited image (from the crop/rotate editor). Returns the path written.
    func saveEditedImage(path: String, data: Data, mime: String, copy: Bool) -> String {
        var target = path
        let ext = Self.ext(forMime: mime) ?? Paths.ext(path)
        if copy || ext != Paths.ext(path) {
            let base = (Paths.file(path) as NSString).deletingPathExtension
            target = uniquePath(Paths.join(Paths.folder(path), (copy ? base + " bearbeitet" : base) + "." + ext))
        }
        Self.coordinatedWrite(data, to: url(target))
        if !files.contains(target) { files.insert(target); rebuildIndex() }
        return target
    }

    func link(to path: String, embed: Bool) -> String {
        let bang = embed ? "!" : ""
        switch settings.linkStyle {
        case .wiki:
            let name = Paths.isNote(path) ? Paths.noteName(path) : Paths.file(path)
            let unique = (byBase[name.lowercased()]?.count ?? 1) <= 1
            let ref = unique ? name : (Paths.isNote(path) ? String(path.dropLast(3)) : path)
            return "\(bang)[[\(ref)]]"
        case .markdown:
            let encoded = path.split(separator: "/").map { $0.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? String($0) }.joined(separator: "/")
            return "\(bang)[\(embed ? "" : Paths.noteName(path))](\(encoded))"
        }
    }

    private static let stampFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyyMMddHHmmss"
        return f
    }()

    static func ext(forMime mime: String) -> String? {
        switch mime.lowercased() {
        case "image/png": "png"
        case "image/jpeg", "image/jpg": "jpg"
        case "image/gif": "gif"
        case "image/webp": "webp"
        case "image/heic": "heic"
        case "image/heif": "heif"
        case "image/svg+xml": "svg"
        case "image/tiff": "tiff"
        case "application/pdf": "pdf"
        default: UTType(mimeType: mime)?.preferredFilenameExtension
        }
    }

    // MARK: - coordinated file access (plays nicely with iCloud Drive)

    nonisolated static func coordinatedRead(_ url: URL) -> Data? {
        var result: Data?
        var err: NSError?
        NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: url, options: [.withoutChanges], error: &err) { u in
            result = try? Data(contentsOf: u)
        }
        return result
    }

    nonisolated static func coordinatedWrite(_ data: Data, to url: URL) {
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        var err: NSError?
        NSFileCoordinator(filePresenter: nil).coordinate(writingItemAt: url, options: [.forReplacing], error: &err) { u in
            try? data.write(to: u, options: .atomic)
        }
    }

    nonisolated static func coordinatedMove(from: URL, to: URL) throws {
        var coordError: NSError?
        var moveError: Error?
        let c = NSFileCoordinator(filePresenter: nil)
        c.coordinate(writingItemAt: from, options: [.forMoving], writingItemAt: to, options: [.forReplacing], error: &coordError) { a, b in
            do {
                try FileManager.default.moveItem(at: a, to: b)
                c.item(at: a, didMoveTo: b)
            } catch { moveError = error }
        }
        if let e = coordError ?? moveError { throw e }
    }
}
