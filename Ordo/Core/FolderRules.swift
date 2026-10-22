import Foundation

/// How a hashtag influences where its note is stored.
enum TagFolderMode: String, Codable, CaseIterable, Identifiable, Sendable {
    /// Folder; a second hashtag becomes a subfolder (default)
    case folderAndSubfolder
    /// Folder, but never a subfolder below it
    case folderOnly
    /// This tag never decides a folder (e.g. #4sem, #wichtig)
    case ignore

    var id: String { rawValue }
    var label: String {
        switch self {
        case .folderAndSubfolder: "Ordner + Unterordner"
        case .folderOnly: "Ordner, kein Unterordner"
        case .ignore: "Kein Ordner"
        }
    }
}

/// Per-hashtag setting: whether it is a folder and which folder it maps to.
struct TagRule: Codable, Equatable, Hashable, Sendable {
    var mode: TagFolderMode = .folderAndSubfolder
    /// Folder to use instead of the tag name, e.g. #serw → "Softwareentwicklung".
    var folder: String = ""

    init(mode: TagFolderMode = .folderAndSubfolder, folder: String = "") {
        self.mode = mode
        self.folder = folder
    }
}

enum FolderRules {
    /// Computes the vault-relative folder a note with these tags belongs in,
    /// or nil when no tag decides a folder.
    ///
    /// - The first tag that counts as a folder becomes the folder (its mapped
    ///   folder name if one is set; nested tags like `#schule/mathe` nest).
    /// - The second becomes a subfolder, unless the first is `.folderOnly`.
    /// - With `allTagsAreFolders == false` only tags that have a rule count.
    static func targetFolder(tags: [String], rules: [String: TagRule], allTagsAreFolders: Bool = true, base: String = "") -> String? {
        let usable = tags.filter { tag in
            let r = rule(for: tag, rules)
            if r?.mode == .ignore { return false }
            return allTagsAreFolders || r != nil
        }
        guard let first = usable.first else { return nil }
        var components = folderComponents(first, rules)
        if (rule(for: first, rules)?.mode ?? .folderAndSubfolder) == .folderAndSubfolder, usable.count > 1 {
            components += folderComponents(usable[1], rules)
        }
        components = components.map(sanitize).filter { !$0.isEmpty }
        guard !components.isEmpty else { return nil }
        let baseParts = base.split(separator: "/").map(String.init)
        return (baseParts + components).joined(separator: "/")
    }

    static func rule(for tag: String, _ rules: [String: TagRule]) -> TagRule? {
        let lower = tag.lowercased()
        if let r = rules[lower] { return r }
        // a rule on a parent tag (#schule) also applies to #schule/mathe
        if let root = lower.split(separator: "/").first, let r = rules[String(root)] {
            // a mapped parent folder keeps the nested part: #schule/mathe → <Schule>/mathe
            if !r.folder.isEmpty, lower.contains("/") {
                let rest = tag.split(separator: "/").dropFirst().joined(separator: "/")
                return TagRule(mode: r.mode, folder: r.folder + "/" + rest)
            }
            return r
        }
        return nil
    }

    static func mode(for tag: String, _ rules: [String: TagRule]) -> TagFolderMode {
        rule(for: tag, rules)?.mode ?? .folderAndSubfolder
    }

    private static func folderComponents(_ tag: String, _ rules: [String: TagRule]) -> [String] {
        let mapped = rule(for: tag, rules)?.folder.trimmingCharacters(in: .whitespaces) ?? ""
        return (mapped.isEmpty ? tag : mapped).split(separator: "/").map(String.init)
    }

    static func sanitize(_ name: String) -> String {
        let bad = CharacterSet(charactersIn: ":\\*?\"<>|")
        return name.components(separatedBy: bad).joined().trimmingCharacters(in: .whitespaces)
    }

    /// Vault-relative path without `..`, `.` and leading `/` – it can never point outside the vault.
    static func insideVault(_ rel: String) -> String {
        rel.split(separator: "/").filter { $0 != ".." && $0 != "." }.joined(separator: "/")
    }

    /// Case-insensitive comparison of folder paths.
    static func same(_ a: String, _ b: String) -> Bool {
        a.lowercased() == b.lowercased()
    }
}
