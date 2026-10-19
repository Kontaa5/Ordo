import Foundation

/// Reads an existing Obsidian vault configuration so Ordo behaves the same
/// way (attachment folder, link style, new-note folder). Ordo never writes to
/// `.obsidian`, so both apps can be used side by side on the same vault.
enum ObsidianImport {
    static func isObsidianVault(_ root: URL) -> Bool {
        FileManager.default.fileExists(atPath: root.appendingPathComponent(".obsidian").path)
    }

    static func settings(vault root: URL) -> VaultSettings? {
        let appJSON = root.appendingPathComponent(".obsidian/app.json")
        guard isObsidianVault(root) else { return nil }
        var s = VaultSettings()
        guard let data = VaultStore.coordinatedRead(appJSON),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return s }

        if let att = obj["attachmentFolderPath"] as? String {
            if att == "/" || att.isEmpty {
                s.attachmentLocation = .folder
                s.attachmentFolder = ""
            } else if att == "./" || att == "." {
                s.attachmentLocation = .besideNote
            } else if att.hasPrefix("./") {
                s.attachmentLocation = .subfolderOfNote
                s.attachmentSubfolderName = String(att.dropFirst(2))
            } else {
                s.attachmentLocation = .folder
                s.attachmentFolder = att
            }
        }
        if let md = obj["useMarkdownLinks"] as? Bool { s.linkStyle = md ? .markdown : .wiki }
        if obj["newFileLocation"] as? String == "folder", let f = obj["newFileFolderPath"] as? String {
            s.newNoteFolder = f
        }
        if let readable = obj["readableLineLength"] as? Bool { s.readableLineWidth = readable }
        if obj["defaultViewMode"] as? String == "preview" { s.defaultMode = .read }
        return s
    }

    #if os(macOS)
    /// Vaults known to the Obsidian desktop app on this Mac.
    static func knownVaults() -> [URL] {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let config = home.appendingPathComponent("Library/Application Support/obsidian/obsidian.json")
        guard let data = try? Data(contentsOf: config),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let vaults = obj["vaults"] as? [String: [String: Any]] else { return [] }
        return vaults.values
            .sorted { ($0["ts"] as? Double ?? 0) > ($1["ts"] as? Double ?? 0) }
            .compactMap { $0["path"] as? String }
            .map { URL(fileURLWithPath: $0, isDirectory: true) }
    }
    #else
    static func knownVaults() -> [URL] { [] }
    #endif
}
