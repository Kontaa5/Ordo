import Foundation

/// Remembers opened vaults across launches using bookmarks
/// (security scoped on iOS, where folders come from the Files picker).
struct RecentVault: Codable, Identifiable, Hashable {
    var name: String
    var path: String
    var bookmark: Data
    var opened: Date
    var id: String { path }
}

enum VaultAccess {
    private static let key = "recentVaults"

    static var recent: [RecentVault] {
        guard let data = UserDefaults.standard.data(forKey: key),
              let list = try? JSONDecoder().decode([RecentVault].self, from: data) else { return [] }
        return list.sorted { $0.opened > $1.opened }
    }

    static func remember(_ url: URL) {
        #if os(macOS)
        let options: URL.BookmarkCreationOptions = [.withSecurityScope]
        #else
        let options: URL.BookmarkCreationOptions = []
        #endif
        let data = (try? url.bookmarkData(options: options, includingResourceValuesForKeys: nil, relativeTo: nil))
            ?? (try? url.bookmarkData())
            ?? Data()
        var list = recent.filter { $0.path != url.path }
        list.insert(RecentVault(name: url.lastPathComponent, path: url.path, bookmark: data, opened: Date()), at: 0)
        save(Array(list.prefix(8)))
    }

    static func forget(_ vault: RecentVault) {
        save(recent.filter { $0.path != vault.path })
    }

    private static func save(_ list: [RecentVault]) {
        if let data = try? JSONEncoder().encode(list) { UserDefaults.standard.set(data, forKey: key) }
    }

    /// Resolves a remembered vault and starts security-scoped access.
    static func resolve(_ vault: RecentVault) -> URL? {
        var stale = false
        #if os(macOS)
        let options: URL.BookmarkResolutionOptions = [.withSecurityScope]
        #else
        let options: URL.BookmarkResolutionOptions = []
        #endif
        let url = (try? URL(resolvingBookmarkData: vault.bookmark, options: options, relativeTo: nil, bookmarkDataIsStale: &stale))
            ?? (try? URL(resolvingBookmarkData: vault.bookmark, bookmarkDataIsStale: &stale))
            ?? URL(fileURLWithPath: vault.path, isDirectory: true)
        _ = url.startAccessingSecurityScopedResource()
        if stale { remember(url) }
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    static var lastVault: RecentVault? { recent.first }
}
