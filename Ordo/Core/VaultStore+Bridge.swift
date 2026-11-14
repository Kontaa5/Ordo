import Foundation

/// Data the web interface needs: index snapshots, search, and the
/// appearance files (themes, snippets) shared with Obsidian.
extension VaultStore {
    private static func ms(_ d: Date?) -> Double { ((d ?? .distantPast).timeIntervalSince1970 * 1000).rounded() }

    func indexSnapshot() -> [String: Any] {
        let notesOut: [[String: Any]] = notes.values.map { m in
            let st = stats[m.path]
            return [
                "path": m.path,
                "tags": m.parsed.tags,
                "links": m.parsed.links,
                "embeds": m.parsed.embeds,
                "headings": m.parsed.headings.map { ["level": $0.level, "text": $0.text, "line": $0.line] },
                "mtime": Self.ms(st?.mtime), "ctime": Self.ms(st?.ctime), "size": st?.size ?? 0,
                "placeholder": m.isPlaceholder,
                "pinned": isPinned(m.path),
            ]
        }
        let filesOut: [[String: Any]] = files.map { f in
            let st = stats[f]
            return ["path": f, "mtime": Self.ms(st?.mtime), "ctime": Self.ms(st?.ctime), "size": st?.size ?? 0]
        }
        return [
            "name": name,
            "notes": notesOut,
            "files": filesOut,
            "folders": folders.sorted(),
            "tagCounts": tagCounts,
            "revision": revision,
        ]
    }

    func settingsJSON() -> Any {
        guard let data = try? JSONEncoder().encode(settings), let obj = try? JSONSerialization.jsonObject(with: data) else { return [:] }
        return obj
    }

    func applySettingsJSON(_ obj: Any) {
        guard let data = try? JSONSerialization.data(withJSONObject: obj),
              let s = try? JSONDecoder().decode(VaultSettings.self, from: data) else { return }
        settings = s
    }

    // MARK: search

    struct SearchQuery: Sendable {
        var words: [String] = []
        var tags: [String] = []
        var paths: [String] = []
        var files: [String] = []
        var caseSensitive = false

        init(_ raw: String, caseSensitive: Bool) {
            self.caseSensitive = caseSensitive
            var tokens: [String] = []
            var cur = "", quoted = false
            for ch in raw {
                if ch == "\"" { quoted.toggle(); continue }
                if ch == " " && !quoted { if !cur.isEmpty { tokens.append(cur) }; cur = "" } else { cur.append(ch) }
            }
            if !cur.isEmpty { tokens.append(cur) }
            for t in tokens {
                let lower = t.lowercased()
                if lower.hasPrefix("tag:") { tags.append(MarkdownParsing.normalizeTag(String(t.dropFirst(4)))) }
                else if lower.hasPrefix("path:") { paths.append(String(t.dropFirst(5))) }
                else if lower.hasPrefix("file:") { files.append(String(t.dropFirst(5))) }
                else if t.hasPrefix("#") && t.count > 1 { tags.append(MarkdownParsing.normalizeTag(t)) }
                else { words.append(t) }
            }
            // the rest is ONE phrase: "der w" finds exactly "der w" (case-insensitive), not every "der" and every "w"
            if words.count > 1 { words = [words.joined(separator: " ")] }
        }
    }

    /// Full-text search. Only the candidate list is built here (main actor); the scan over all texts runs in the
    /// background, so typing in the search field never stalls the app. A newer search cancels the running one.
    func search(_ raw: String, caseSensitive: Bool, limit: Int = 300) async -> [[String: Any]] {
        let q = SearchQuery(raw, caseSensitive: caseSensitive)
        guard !(q.words.isEmpty && q.tags.isEmpty && q.paths.isEmpty && q.files.isEmpty) else { return [] }
        var candidates = q.tags.isEmpty ? Array(notes.keys) : notes(withTags: q.tags, matchAll: true)
        candidates = candidates.filter { p in
            q.paths.allSatisfy { p.localizedCaseInsensitiveContains($0) } &&
            q.files.allSatisfy { Paths.noteName(p).localizedCaseInsensitiveContains($0) }
        }
        let texts = contents   // copy-on-write snapshot, nothing is copied unless the vault changes meanwhile
        searchTask?.cancel()
        let task = Task.detached(priority: .userInitiated) { Self.scan(q, candidates.sorted(), texts, limit) }
        searchTask = task
        let hits = await task.value
        return hits.map { h in
            ["path": h.path, "matches": h.matches.map { ["line": $0.line, "text": $0.text, "ranges": $0.ranges] as [String: Any] }]
        }
    }

    struct SearchHit: Sendable {
        struct Match: Sendable { let line: Int; let text: String; let ranges: [[Int]] }
        let path: String; let matches: [Match]; let score: Int
    }

    nonisolated static func scan(_ q: SearchQuery, _ candidates: [String], _ texts: [String: String], _ limit: Int) -> [SearchHit] {
        let opts: String.CompareOptions = q.caseSensitive ? [] : [.caseInsensitive, .diacriticInsensitive]
        var out: [SearchHit] = []
        for path in candidates {
            if Task.isCancelled { return [] }
            let text = texts[path] ?? ""
            let name = Paths.noteName(path)
            var ok = true
            for w in q.words where name.range(of: w, options: opts) == nil && text.range(of: w, options: opts) == nil { ok = false; break }
            guard ok else { continue }
            var matches: [SearchHit.Match] = []
            var nameHit = false
            if !q.words.isEmpty {
                for w in q.words where name.range(of: w, options: opts) != nil { nameHit = true }
                var lineNo = 0
                text.enumerateLines { line, stop in
                    var ranges: [[Int]] = []
                    for w in q.words {
                        var search = line.startIndex..<line.endIndex
                        while let r = line.range(of: w, options: opts, range: search) {
                            // UTF-16 offsets: the page slices the text with JavaScript string indices
                            ranges.append([r.lowerBound.utf16Offset(in: line), r.upperBound.utf16Offset(in: line)])
                            search = r.upperBound..<line.endIndex
                        }
                    }
                    if !ranges.isEmpty {
                        matches.append(.init(line: lineNo, text: String(line.prefix(400)), ranges: ranges))
                        if matches.count >= 20 { stop = true }
                    }
                    lineNo += 1
                }
            }
            out.append(.init(path: path, matches: matches, score: (nameHit ? 1000 : 0) + matches.count))
            if out.count >= limit { break }
        }
        return out.sorted { $0.score > $1.score }
    }

    // MARK: appearance (Obsidian-compatible)

    private var ordoDir: URL { FolderRules.ownFolder(root, ".ordo") }
    private var obsidianDir: URL { FolderRules.ownFolder(root, ".obsidian") }

    /// Themes, snippets, settings: only from inside the vault, never through a symlinked subfolder.
    private func readOwn(_ url: URL) -> Data? {
        FolderRules.isInside(url, root: root) ? Self.coordinatedRead(url) : nil
    }

    /// Appearance settings; imported once from Obsidian's appearance.json.
    func appearance() -> [String: Any] {
        let own = ordoDir.appendingPathComponent("appearance.json")
        if let data = readOwn(own), let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] { return obj }
        var out: [String: Any] = [:]
        if let data = readOwn(obsidianDir.appendingPathComponent("appearance.json")),
           let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            out = obj
            out["importedFromObsidian"] = true
        }
        return out
    }

    func saveAppearance(_ obj: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: obj, options: [.prettyPrinted, .sortedKeys]) else { return }
        writeOwn(data, to: ordoDir.appendingPathComponent("appearance.json"))
    }

    private func subfolders(_ dir: URL) -> [String] {
        ((try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.isDirectoryKey])) ?? [])
            .filter { (try? $0.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true }
            .map(\.lastPathComponent)
    }

    private func cssFiles(_ dir: URL) -> [String] {
        ((try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? [])
            .filter { $0.lowercased().hasSuffix(".css") }
            .map { String($0.dropLast(4)) }
    }

    /// Installed themes: Obsidian's `.obsidian/themes` plus Ordo's own `.ordo/themes`.
    func themes() -> [[String: String]] {
        var seen = Set<String>()
        var out: [[String: String]] = []
        for (dir, source) in [(ordoDir.appendingPathComponent("themes"), "ordo"), (obsidianDir.appendingPathComponent("themes"), "obsidian")] {
            for name in subfolders(dir).sorted() where FileManager.default.fileExists(atPath: dir.appendingPathComponent(name).appendingPathComponent("theme.css").path) {
                if seen.insert(name).inserted { out.append(["name": name, "source": source]) }
            }
        }
        return out
    }

    func themeCSS(_ name: String) -> String? {
        for dir in [ordoDir.appendingPathComponent("themes"), obsidianDir.appendingPathComponent("themes")] {
            let url = dir.appendingPathComponent(FolderRules.sanitize(Paths.file(name))).appendingPathComponent("theme.css")   // name comes from appearance.json: no ../
            if let data = readOwn(url) { return String(decoding: data, as: UTF8.self) }
        }
        return nil
    }

    func installTheme(name: String, css: String) {
        let safe = FolderRules.sanitize(name.replacingOccurrences(of: "/", with: "-"))
        writeOwn(Data(css.utf8), to: ordoDir.appendingPathComponent("themes").appendingPathComponent(safe).appendingPathComponent("theme.css"))
    }

    func snippets() -> [String] {
        Array(Set(cssFiles(obsidianDir.appendingPathComponent("snippets")) + cssFiles(ordoDir.appendingPathComponent("snippets")))).sorted()
    }

    func snippetCSS(_ name: String) -> String? {
        for dir in [ordoDir.appendingPathComponent("snippets"), obsidianDir.appendingPathComponent("snippets")] {
            if let data = readOwn(dir.appendingPathComponent(FolderRules.sanitize(Paths.file(name)) + ".css")) { return String(decoding: data, as: UTF8.self) }
        }
        return nil
    }

    /// Values of the "Style Settings" plugin (used heavily by themes like Minimal).
    func styleSettings() -> Any? {
        let own = ordoDir.appendingPathComponent("style-settings.json")
        let obs = obsidianDir.appendingPathComponent("plugins/obsidian-style-settings/data.json")
        for url in [own, obs] {
            if let data = readOwn(url), let obj = try? JSONSerialization.jsonObject(with: data) { return obj }
        }
        return nil
    }

    func folderSnippetsPath() -> URL { ordoDir.appendingPathComponent("snippets") }

    /// "Eigenes CSS" from the settings: an ordinary snippet in .ordo/snippets.
    func saveCustomCSS(_ css: String) {
        writeOwn(Data(css.utf8), to: folderSnippetsPath().appendingPathComponent("eigenes.css"))
    }
}
