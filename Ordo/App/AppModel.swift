import Foundation
import Observation
import SwiftUI
import PhotosUI

/// Native side of Ordo: owns the open vault and the web shell, and provides
/// what a web page cannot do itself (files, iCloud, pickers, PDF, sharing).
@MainActor
@Observable
final class AppModel {
    var vault: VaultStore?

    // native pickers driven by the web shell
    var showFolderPicker = false
    var showPhotoPicker = false
    var photoSelection: [PhotosPickerItem] = []
    var shareURLs: [URL] = []
    /// Interface language of the web shell ("de" / "en"), mirrored for the native menu bar.
    var lang: String = UserDefaults.standard.string(forKey: "lang") ?? (Locale.preferredLanguages.first?.hasPrefix("de") == true ? "de" : "en")

    /// Translates the native menu titles.
    func L(_ de: String, _ en: String) -> String { lang == "en" ? en : de }

    @ObservationIgnored let shell = ShellController()
    @ObservationIgnored private var refreshTask: Task<Void, Never>?
    @ObservationIgnored private var lastRevision = -1
    @ObservationIgnored private var lastPurge = Date()
    #if os(macOS)
    @ObservationIgnored private var watcher: FileWatcher?
    #endif
    @ObservationIgnored var photoContinuation: CheckedContinuation<[(Data, String)], Never>?

    init() {
        shell.app = self
    }

    // MARK: vault lifecycle

    /// `remember: false` for `--vault` launches (tests): they must not replace the vault the user last had open.
    func openVault(_ url: URL, remember: Bool = true) {
        closeVault(notify: false)
        _ = url.startAccessingSecurityScopedResource()
        let store = VaultStore(root: url)
        SchemeHandler.vaultRoot = url
        if remember { VaultAccess.remember(url) }
        store.onRename = { [weak self] old, new in self?.shell.callJSON("ordo.host.renamed", ["from": old, "to": new]) }
        store.onExternalChange = { [weak self] path, text in self?.shell.callJSON("ordo.host.externalChange", ["path": path, "text": text]) }
        store.onDelete = { [weak self] path in self?.shell.callJSON("ordo.host.deleted", path) }
        vault = store
        Task {
            await store.refresh()
            store.purgeTrash()   // old trash goes at start …
            lastRevision = store.revision
            shell.callJSON("ordo.host.vaultOpened", vaultInfo(store))
            #if os(macOS)
            startGit()
            #endif
        }
        #if os(macOS)
        // the Mac reports changes itself; the loop below is only a slow safety net
        watcher = FileWatcher(path: url.path) { [weak self] in Task { @MainActor in self?.refreshNow() } }
        let interval: Duration = .seconds(30)
        #else
        let interval: Duration = .seconds(3)
        #endif
        refreshTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: interval)
                guard let self, let v = self.vault, v === store else { return }
                await v.refresh()
                // … and once a day while Ordo stays open
                if Date().timeIntervalSince(self.lastPurge) > 86_400 { self.lastPurge = Date(); v.purgeTrash() }
                self.pushIndexIfNeeded()
            }
        }
    }

    #if os(macOS)
    // MARK: Git-Sync (Mac only; the iPhone gets everything through iCloud)

    @ObservationIgnored var git: GitSync?
    @ObservationIgnored private var gitTask: Task<Void, Never>?

    /// (Re)starts Git-Sync for the open vault. Nothing is uploaded or fetched on its own:
    /// every network step (and so every Touch-ID prompt) comes from "Jetzt sichern" / "Holen" –
    /// or, if switched on, from the daily upload (at most one try a day).
    /// There is no polling: the local status (the dot in the status bar) is checked again when
    /// a file changes and when Ordo comes to the front; the daily upload is due-checked then, too.
    func startGit() {
        gitTask?.cancel(); gitTask = nil; gitCheck?.cancel(); git = nil
        guard let store = vault, store.settings.gitEnabled, GitSync.gitAvailable() else { pushGitStatus(); return }
        let g = GitSync(root: store.root)
        git = g
        g.onChange = { [weak self] in self?.pushGitStatus() }
        gitTask = Task {
            guard await g.prepare(remote: store.settings.gitRemote) else { return }
            if store.settings.gitDailyUpload { await g.dailyUploadIfDue() }
            await g.refreshStatus()
        }
    }

    @ObservationIgnored private var gitCheck: Task<Void, Never>?

    /// Checks the git status a moment after something happened (a burst of saves becomes one `git status`).
    func gitStatusSoon() {
        guard let g = git else { return }
        gitCheck?.cancel()
        gitCheck = Task { [weak self] in
            try? await Task.sleep(for: .seconds(2))
            await self?.gitTask?.value           // the repository must be set up first
            guard !Task.isCancelled, let self, self.git === g, !g.isBusy else { return }   // a backup refreshes the status itself
            await g.refreshStatus()
        }
    }

    /// Ordo came to the front: is today's upload due (Ordo may have stayed open overnight), and is the dot current?
    func appBecameActive() {
        guard let g = git, let store = vault else { return }
        if store.settings.gitDailyUpload {
            Task { [weak self] in
                await self?.gitTask?.value
                guard self?.git === g else { return }
                await g.dailyUploadIfDue()
            }
        }
        gitStatusSoon()
    }

    func pushGitStatus() {
        shell.callJSON("ordo.host.gitStatus", git?.statusJSON ?? ["state": vault?.settings.gitEnabled == true && !GitSync.gitAvailable() ? "nogit" : "off"])
    }
    #endif

    func closeVault(notify: Bool = true) {
        #if os(macOS)
        watcher = nil
        gitTask?.cancel(); gitTask = nil; gitCheck?.cancel(); git = nil
        #endif
        refreshTask?.cancel()
        if let v = vault { v.root.stopAccessingSecurityScopedResource() }
        vault = nil
        SchemeHandler.vaultRoot = nil
        lastRevision = -1
        if notify { shell.callJSON("ordo.host.vaultClosed", bootInfo()) }
    }

    func refreshNow() {
        guard let v = vault else { return }
        Task { await v.refresh(); pushIndexIfNeeded() }
        #if os(macOS)
        gitStatusSoon()
        #endif
    }

    func pushIndexIfNeeded() {
        guard let v = vault, v.revision != lastRevision else { return }
        lastRevision = v.revision
        shell.callJSON("ordo.host.index", v.indexSnapshot())
    }

    func vaultInfo(_ v: VaultStore) -> [String: Any] {
        [
            "name": v.name,
            "path": v.root.path,
            "importedFromObsidian": v.importedFromObsidian,
            "isObsidianVault": ObsidianImport.isObsidianVault(v.root),
            "isDemo": FileManager.default.fileExists(atPath: Self.demoMarker(v.root).path),
        ]
    }

    /// `tools/demo/make_vault.py` leaves this file so the app can offer "enough seen".
    static func demoMarker(_ root: URL) -> URL { root.appendingPathComponent(".ordo/demo") }

    /// Ends the demo: `keep` turns it into a normal vault, otherwise the whole folder
    /// goes to the system trash (removed only if there is none) and the picker shows.
    func endDemo(keep: Bool) throws {
        guard let v = vault else { return }
        let root = v.root
        if keep { try? FileManager.default.removeItem(at: Self.demoMarker(root)); return }
        closeVault(notify: false)
        if let rec = VaultAccess.recent.first(where: { $0.path == root.path }) { VaultAccess.forget(rec) }
        let scoped = root.startAccessingSecurityScopedResource()
        defer { if scoped { root.stopAccessingSecurityScopedResource() }; shell.callJSON("ordo.host.vaultClosed", bootInfo()) }
        // only ever into the trash, never deleted for good (a vault could carry a stray demo marker)
        try FileManager.default.trashItem(at: root, resultingItemURL: nil)
    }

    func bootInfo() -> [String: Any] {
        #if os(macOS)
        let platform = "mac"
        let phone = false
        #else
        let platform = "ios"
        let phone = Platform.isPhone
        #endif
        return [
            "platform": platform,
            "isPhone": phone,
            "vault": vault.map(vaultInfo) ?? NSNull(),
            "recent": VaultAccess.recent.map { ["name": $0.name, "path": $0.path] },
            "obsidianVaults": ObsidianImport.knownVaults().map { ["name": $0.lastPathComponent, "path": $0.path] },
            "version": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "",
        ]
    }

    func openLastVaultIfPossible() {
        guard vault == nil else { return }
        // `Ordo --vault /path/to/folder` opens a folder directly
        let args = ProcessInfo.processInfo.arguments
        if let i = args.firstIndex(of: "--vault"), args.indices.contains(i + 1) {
            openVault(URL(fileURLWithPath: args[i + 1], isDirectory: true), remember: false)
            return
        }
        guard let last = VaultAccess.lastVault, let url = VaultAccess.resolve(last) else { return }
        openVault(url)
    }

    // MARK: photos (iOS) – the web shell awaits the result

    func pickPhotos() async -> [(Data, String)] {
        await withCheckedContinuation { c in
            photoContinuation = c
            photoSelection = []
            showPhotoPicker = true
        }
    }

    func photoPickerChanged(_ items: [PhotosPickerItem]) {
        guard !items.isEmpty, let c = photoContinuation else { return }
        photoContinuation = nil
        Task {
            var out: [(Data, String)] = []
            for item in items {
                if let data = try? await item.loadTransferable(type: Data.self) {
                    out.append((data, item.supportedContentTypes.first?.preferredMIMEType ?? "image/jpeg"))
                }
            }
            c.resume(returning: out)
        }
    }

    func photoPickerDismissed() {
        // dismissed without a selection
        Task {
            try? await Task.sleep(for: .milliseconds(400))
            if let c = photoContinuation, photoSelection.isEmpty { photoContinuation = nil; c.resume(returning: []) }
        }
    }
}
