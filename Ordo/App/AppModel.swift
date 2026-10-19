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
            lastRevision = store.revision
            shell.callJSON("ordo.host.vaultOpened", vaultInfo(store))
            #if os(macOS)
            startGit()
            #endif
        }
        refreshTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(3))
                guard let self, let v = self.vault, v === store else { return }
                await v.refresh()
                self.pushIndexIfNeeded()
            }
        }
    }

    #if os(macOS)
    // MARK: Git-Sync (Mac only; the iPhone gets everything through iCloud)

    @ObservationIgnored var git: GitSync?
    @ObservationIgnored private var gitTask: Task<Void, Never>?

    /// (Re)starts Git-Sync for the open vault according to its settings.
    func startGit() {
        gitTask?.cancel(); gitTask = nil; git = nil
        guard let store = vault, store.settings.gitEnabled, GitSync.gitAvailable() else { pushGitStatus(); return }
        let g = GitSync(root: store.root)
        git = g
        g.onChange = { [weak self] in self?.pushGitStatus() }
        gitTask = Task { [weak self] in
            guard await g.prepare(remote: store.settings.gitRemote) else { return }
            let today = { (d: Date?) in Calendar.current.isDateInToday(d ?? .distantPast) }
            let pull = store.settings.gitPull
            if pull == "everyStart" || (pull == "dailyStart" && !today(g.lastPull)) {
                if await g.pull() { self?.refreshNow() }
            }
            await g.refreshStatus()
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(60))
                guard let self, let v = self.vault, v === store, v.settings.gitEnabled else { return }
                let st = v.settings
                let quiet = Date().timeIntervalSince(v.lastWrite) > 600          // 10 min without typing
                let changedSince = v.lastWrite > (g.lastCommit ?? .distantPast)
                let stale = Date().timeIntervalSince(g.lastCommit ?? .distantPast) > 3600   // picks up iPhone edits too
                var committed = 0
                if st.gitCommit == "auto", quiet, changedSince || stale { committed = await g.commit() }
                if st.gitCommit == "daily", !today(g.lastCommit) { committed = await g.commit() }
                if st.gitPush == "afterCommit", committed > 0 { _ = await g.push() }
                if st.gitPush == "daily", !today(g.lastPush) {
                    if st.gitCommit != "manual" { await g.commit() }
                    if g.unpushed > 0 { _ = await g.push() }
                }
                await g.refreshStatus()
            }
        }
    }

    func pushGitStatus() {
        shell.callJSON("ordo.host.gitStatus", git?.statusJSON ?? ["state": vault?.settings.gitEnabled == true && !GitSync.gitAvailable() ? "nogit" : "off"])
    }
    #endif

    func closeVault(notify: Bool = true) {
        #if os(macOS)
        gitTask?.cancel(); gitTask = nil; git = nil
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
        ]
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
