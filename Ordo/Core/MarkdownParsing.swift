import Foundation

/// Extracts the Obsidian-relevant structure of a note: tags (in order of
/// appearance, frontmatter first), links, embeds and headings.
struct ParsedNote: Equatable, Sendable {
    var tags: [String] = []
    /// Hashtags written in the text (not frontmatter) – these decide the folder.
    var bodyTags: [String] = []
    var links: [String] = []      // link targets without alias/heading
    var embeds: [String] = []
    var headings: [Heading] = []
}

struct Heading: Equatable, Hashable, Sendable {
    var level: Int
    var text: String
    var line: Int   // 0-based source line
}

enum MarkdownParsing {
    private static let tagRegex = try! NSRegularExpression(
        pattern: #"(?:^|(?<=[\s(,;]))#([\p{L}\p{N}_/\-]*[\p{L}_/\-][\p{L}\p{N}_/\-]*)"#,
        options: [.anchorsMatchLines])
    private static let wikiRegex = try! NSRegularExpression(pattern: #"(!?)\[\[([^\[\]\n]+?)\]\]"#)
    private static let mdLinkRegex = try! NSRegularExpression(pattern: #"(!?)\[[^\]\n]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)"#)
    private static let inlineCodeRegex = try! NSRegularExpression(pattern: #"`[^`\n]*`"#)

    static func parse(_ text: String) -> ParsedNote {
        var result = ParsedNote()
        let (frontmatter, bodyStartLine) = splitFrontmatter(text)
        var fmTags: [String] = []
        if let fm = frontmatter { fmTags = frontmatterTags(fm) }
        var tags: [String] = []

        let lines = text.components(separatedBy: "\n")
        var inFence = false
        var fenceMarker = ""
        var prose: [String] = []
        for (i, rawLine) in lines.enumerated() where i >= bodyStartLine {
            let line = rawLine.hasSuffix("\r") ? String(rawLine.dropLast()) : rawLine
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~") {
                let marker = String(trimmed.prefix(3))
                if !inFence { inFence = true; fenceMarker = marker }
                else if marker == fenceMarker { inFence = false }
                prose.append("")
                continue
            }
            if inFence { prose.append(""); continue }
            if let h = heading(line) { result.headings.append(Heading(level: h.0, text: h.1, line: i)) }
            prose.append(line)
        }

        var body = prose.joined(separator: "\n")
        body = replace(inlineCodeRegex, in: body, with: " ")

        // links & embeds
        let ns = body as NSString
        for m in wikiRegex.matches(in: body, range: NSRange(location: 0, length: ns.length)) {
            let embed = ns.substring(with: m.range(at: 1)) == "!"
            let target = linkTarget(ns.substring(with: m.range(at: 2)))
            guard !target.isEmpty else { continue }
            if embed { result.embeds.append(target) } else { result.links.append(target) }
        }
        for m in mdLinkRegex.matches(in: body, range: NSRange(location: 0, length: ns.length)) {
            let embed = ns.substring(with: m.range(at: 1)) == "!"
            var target = ns.substring(with: m.range(at: 2))
            if target.range(of: #"^[a-zA-Z][\w+.-]*:"#, options: .regularExpression) != nil || target.hasPrefix("#") { continue }
            target = target.removingPercentEncoding ?? target
            target = String(target.split(separator: "#", maxSplits: 1, omittingEmptySubsequences: false).first ?? "")
            guard !target.isEmpty else { continue }
            if embed { result.embeds.append(target) } else { result.links.append(target) }
        }

        // tags: ignore link targets and wikilink contents
        var tagSource = replace(wikiRegex, in: body, with: " ")
        tagSource = replace(mdLinkRegex, in: tagSource, with: " ")
        let ts = tagSource as NSString
        for m in tagRegex.matches(in: tagSource, range: NSRange(location: 0, length: ts.length)) {
            tags.append(ts.substring(with: m.range(at: 1)))
        }
        result.bodyTags = dedupe(tags.map(normalizeTag).filter { !$0.isEmpty })
        result.tags = dedupe((fmTags + tags).map(normalizeTag).filter { !$0.isEmpty })
        return result
    }

    static func normalizeTag(_ tag: String) -> String {
        var t = tag.trimmingCharacters(in: .whitespacesAndNewlines)
        while t.hasPrefix("#") { t.removeFirst() }
        while t.hasSuffix("/") { t.removeLast() }
        return t
    }

    static func dedupe(_ tags: [String]) -> [String] {
        var seen = Set<String>()
        return tags.filter { seen.insert($0.lowercased()).inserted }
    }

    static func linkTarget(_ inner: String) -> String {
        let beforeAlias = inner.split(separator: "|", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? inner
        let beforeHeading = beforeAlias.split(separator: "#", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? beforeAlias
        return beforeHeading.trimmingCharacters(in: .whitespaces)
    }

    /// Returns the frontmatter body (without fences) and the first line of the note body.
    static func splitFrontmatter(_ text: String) -> (String?, Int) {
        let lines = text.components(separatedBy: "\n")
        guard lines.count > 1, lines[0].trimmingCharacters(in: .whitespaces) == "---" else { return (nil, 0) }
        for i in 1..<min(lines.count, 400) {
            let l = lines[i].trimmingCharacters(in: .whitespaces)
            if l == "---" || l == "..." {
                return (lines[1..<i].joined(separator: "\n"), i + 1)
            }
        }
        return (nil, 0)
    }

    static func frontmatterTags(_ fm: String) -> [String] {
        var out: [String] = []
        let lines = fm.components(separatedBy: "\n")
        var i = 0
        while i < lines.count {
            let line = lines[i]
            let lower = line.lowercased()
            if lower.hasPrefix("tags:") || lower.hasPrefix("tag:") {
                let value = line[line.index(after: line.firstIndex(of: ":")!)...].trimmingCharacters(in: .whitespaces)
                if value.isEmpty {
                    var j = i + 1
                    while j < lines.count {
                        let item = lines[j].trimmingCharacters(in: .whitespaces)
                        guard item.hasPrefix("-") else { break }
                        out.append(cleanYAML(String(item.dropFirst())))
                        j += 1
                    }
                    i = j
                    continue
                }
                let inner = value.hasPrefix("[") && value.hasSuffix("]") ? String(value.dropFirst().dropLast()) : value
                let parts = inner.contains(",") ? inner.split(separator: ",").map(String.init) : inner.split(separator: " ").map(String.init)
                out += parts.map(cleanYAML)
            }
            i += 1
        }
        return out.filter { !$0.isEmpty }
    }

    private static func cleanYAML(_ s: String) -> String {
        var v = s.trimmingCharacters(in: .whitespaces)
        if (v.hasPrefix("\"") && v.hasSuffix("\"")) || (v.hasPrefix("'") && v.hasSuffix("'")), v.count >= 2 {
            v = String(v.dropFirst().dropLast())
        }
        return normalizeTag(v)
    }

    static func heading(_ line: String) -> (Int, String)? {
        var level = 0
        var idx = line.startIndex
        while idx < line.endIndex, line[idx] == "#", level < 7 { level += 1; idx = line.index(after: idx) }
        guard (1...6).contains(level), idx < line.endIndex, line[idx] == " " else { return nil }
        let text = line[idx...].trimmingCharacters(in: .whitespaces)
        return text.isEmpty ? nil : (level, text)
    }

    private static func replace(_ re: NSRegularExpression, in s: String, with r: String) -> String {
        re.stringByReplacingMatches(in: s, range: NSRange(location: 0, length: (s as NSString).length), withTemplate: r)
    }
}
