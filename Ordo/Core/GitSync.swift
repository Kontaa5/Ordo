#if os(macOS)
import Foundation
import CryptoKit

/// Git-Sync: the vault stays in iCloud (Mac ↔ iPhone); git keeps a history and a
/// backup on a remote. The repository data lives outside iCloud in Application
/// Support (`--git-dir`), the vault folder is only the work tree — so iCloud never
/// syncs git internals and no file exists twice.
@MainActor
final class GitSync {
    enum State: String { case off, idle, working, error }

    let root: URL
    let gitDir: URL
    private(set) var state: State = .idle
    private(set) var message = ""
    private(set) var uncommitted = 0
    private(set) var unpushed = 0
    var onChange: (() -> Void)?
    private var busy = false
    /// Backing up, uploading or fetching right now (quitting would cut it off).
    var isBusy: Bool { busy }

    private var defaultsKey: String { "git:" + root.path }
    var lastCommit: Date? { get { UserDefaults.standard.object(forKey: defaultsKey + ":commit") as? Date } set { UserDefaults.standard.set(newValue, forKey: defaultsKey + ":commit") } }
    var lastPush: Date? { get { UserDefaults.standard.object(forKey: defaultsKey + ":push") as? Date } set { UserDefaults.standard.set(newValue, forKey: defaultsKey + ":push") } }
    var lastPull: Date? { get { UserDefaults.standard.object(forKey: defaultsKey + ":pull") as? Date } set { UserDefaults.standard.set(newValue, forKey: defaultsKey + ":pull") } }
    private var lastAutoUpload: Date? { get { UserDefaults.standard.object(forKey: defaultsKey + ":auto") as? Date } set { UserDefaults.standard.set(newValue, forKey: defaultsKey + ":auto") } }

    /// "Einmal am Tag hochladen": when the last upload is more than a day ago. At most one try a day,
    /// so a declined Touch ID or a missing network doesn't come back every minute.
    func dailyUploadIfDue() async {
        let day: TimeInterval = 86_400
        guard !busy, lastPush.map({ Date().timeIntervalSince($0) > day }) ?? true,
              lastAutoUpload.map({ Date().timeIntervalSince($0) > day }) ?? true else { return }
        lastAutoUpload = Date()
        await commit()
        _ = await push()
    }

    init(root: URL) {
        self.root = root
        let hash = SHA256.hash(data: Data(root.standardizedFileURL.path.utf8)).prefix(8).map { String(format: "%02x", $0) }.joined()
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        gitDir = base.appendingPathComponent("Ordo/git/\(root.lastPathComponent)-\(hash).git", isDirectory: true)
    }

    // MARK: running git

    struct Result { var code: Int32; var out: String; var err: String; var ok: Bool { code == 0 } }

    nonisolated static func gitAvailable() -> Bool {
        // /usr/bin/git is only a stub until the command line tools are installed
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/xcode-select")
        p.arguments = ["-p"]
        p.standardOutput = FileHandle.nullDevice; p.standardError = FileHandle.nullDevice
        do { try p.run(); p.waitUntilExit(); return p.terminationStatus == 0 } catch { return false }
    }

    private func git(_ args: [String], workTree: Bool = true) async -> Result {
        let gitDir = self.gitDir.path, root = self.root.path
        return await Task.detached(priority: .utility) {
            let p = Process()
            p.executableURL = URL(fileURLWithPath: "/usr/bin/git")
            p.arguments = ["--git-dir=\(gitDir)"] + (workTree ? ["--work-tree=\(root)"] : []) + args
            p.currentDirectoryURL = URL(fileURLWithPath: root)
            var env = ProcessInfo.processInfo.environment
            env["GIT_TERMINAL_PROMPT"] = "0"          // never hang waiting for a password
            env["GIT_SSH_COMMAND"] = env["GIT_SSH_COMMAND"] ?? "ssh -o BatchMode=yes -o ConnectTimeout=15"
            p.environment = env
            let out = Pipe(), err = Pipe()
            p.standardOutput = out; p.standardError = err
            do { try p.run() } catch { return Result(code: -1, out: "", err: error.localizedDescription) }
            let o = out.fileHandleForReading.readDataToEndOfFile(), e = err.fileHandleForReading.readDataToEndOfFile()
            p.waitUntilExit()
            return Result(code: p.terminationStatus, out: String(decoding: o, as: UTF8.self), err: String(decoding: e, as: UTF8.self))
        }.value
    }

    private func set(_ s: State, _ msg: String = "") { state = s; message = msg; onChange?() }

    // MARK: setup

    /// Only real repository addresses: https, ssh (`git@host:repo`, `ssh://`), or a local path.
    /// The remote comes from the vault's settings file, so it must never smuggle in a git option
    /// (`--upload-pack=…` runs a command) or a transport helper (`ext::…`).
    nonisolated static func isValidRemote(_ remote: String) -> Bool {
        let r = remote.trimmingCharacters(in: .whitespaces)
        guard !r.isEmpty, !r.hasPrefix("-"), !r.contains("::"),
              r.rangeOfCharacter(from: .whitespacesAndNewlines.union(.controlCharacters)) == nil else { return false }
        if r.hasPrefix("https://") || r.hasPrefix("ssh://") || r.hasPrefix("file://") || r.hasPrefix("/") { return true }
        return r.range(of: #"^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[A-Za-z0-9._~/-]+$"#, options: .regularExpression) != nil
    }

    /// Creates the repository (outside iCloud) and points `origin` at the remote.
    func prepare(remote: String) async -> Bool {
        if !FileManager.default.fileExists(atPath: gitDir.appendingPathComponent("HEAD").path) {
            try? FileManager.default.createDirectory(at: gitDir.deletingLastPathComponent(), withIntermediateDirectories: true)
            let r = await git(["init", "-b", "main"])
            guard r.ok else { set(.error, r.err); return false }
        }
        // what never belongs into the history
        let exclude = """
        .DS_Store
        .*.icloud
        .trash/
        .ordo/state.json
        .obsidian/workspace*.json
        .obsidian/cache

        """
        try? FileManager.default.createDirectory(at: gitDir.appendingPathComponent("info"), withIntermediateDirectories: true)
        try? exclude.write(to: gitDir.appendingPathComponent("info/exclude"), atomically: true, encoding: .utf8)
        // a pulled symlink (e.g. ".trash → ~/Documents") is checked out as a plain text file
        _ = await git(["config", "core.symlinks", "false"])
        // commits need a name; use the global git identity if there is one
        if !(await git(["config", "user.name"])).ok { _ = await git(["config", "user.name", "Ordo"]) }
        if !(await git(["config", "user.email"])).ok { _ = await git(["config", "user.email", "ordo@localhost"]) }
        let current = await git(["remote", "get-url", "origin"])
        let url = remote.trimmingCharacters(in: .whitespaces)
        if !url.isEmpty, !Self.isValidRemote(url) {
            if current.ok { _ = await git(["remote", "remove", "origin"]) }
            set(.error, "Ungültige Repository-Adresse")
            return false
        }
        if url.isEmpty { if current.ok { _ = await git(["remote", "remove", "origin"]) } }
        else if !current.ok { _ = await git(["remote", "add", "origin", url]) }
        else if current.out.trimmingCharacters(in: .whitespacesAndNewlines) != url { _ = await git(["remote", "set-url", "origin", url]) }
        return true
    }

    /// Can the remote be reached with the Mac's git login (SSH key / credential helper)?
    func test(remote: String) async -> (ok: Bool, message: String) {
        guard Self.isValidRemote(remote) else { return (false, "Ungültige Adresse – erlaubt sind https://…, git@host:… oder ssh://…") }
        let r = await git(["ls-remote", "--heads", remote.trimmingCharacters(in: .whitespaces)], workTree: false)
        return r.ok ? (true, "") : (false, Self.explain(r.err))
    }

    // MARK: status

    func refreshStatus() async {
        let st = await git(["status", "--porcelain"])
        uncommitted = st.ok ? st.out.split(separator: "\n").count : 0
        // commits not on the server yet (before the first push: all of them)
        let hasRemoteBranch = (await git(["rev-parse", "--verify", "-q", "origin/main"])).ok
        let ahead = await git(["rev-list", "--count", hasRemoteBranch ? "origin/main..main" : "main"])
        unpushed = ahead.ok ? Int(ahead.out.trimmingCharacters(in: .whitespacesAndNewlines)) ?? 0 : 0
        if state != .error && state != .working { set(.idle, message) } else { onChange?() }
    }

    // MARK: commit / push / pull

    /// iCloud keeps some files only in the cloud; git cannot read them ("short read while indexing").
    /// Asks iCloud to download them and waits up to a minute. Returns what is still missing –
    /// those files are left out of this backup and come along next time.
    private func downloadFromICloud() async -> [String] {
        let root = self.root
        var left = await Task.detached(priority: .utility) { Self.notDownloaded(root) }.value
        guard !left.isEmpty else { return [] }
        set(.working, "Lade \(left.count) \(left.count == 1 ? "Datei" : "Dateien") aus iCloud …")
        for u in left { try? FileManager.default.startDownloadingUbiquitousItem(at: u) }
        // wait while files keep arriving (at most a minute); give up after 10 s without progress
        var idle = 0
        for _ in 0..<60 where !left.isEmpty && idle < 10 {
            try? await Task.sleep(for: .seconds(1))
            let now = await Task.detached(priority: .utility) { Self.notDownloaded(root) }.value
            idle = now.count < left.count ? 0 : idle + 1
            left = now
        }
        set(.working, "Sichern …")
        let base = root.standardizedFileURL.path + "/"
        return left.map { String($0.standardizedFileURL.path.dropFirst(base.count)) }
    }

    /// Files in the vault that are only in iCloud, not on this Mac. (".downloaded" – a local copy
    /// with a newer one in iCloud – is readable for git, so it does not count.)
    nonisolated static func notDownloaded(_ root: URL) -> [URL] {
        let keys: [URLResourceKey] = [.isDirectoryKey, .ubiquitousItemDownloadingStatusKey]
        guard let en = FileManager.default.enumerator(at: root, includingPropertiesForKeys: keys, options: [], errorHandler: { _, _ in true }) else { return [] }
        var out: [URL] = []
        for case let u as URL in en {
            let v = try? u.resourceValues(forKeys: Set(keys))
            if v?.isDirectory == true { if u.lastPathComponent == ".trash" { en.skipDescendants() }; continue }
            if v?.ubiquitousItemDownloadingStatus == .notDownloaded { out.append(u) }
        }
        return out
    }

    /// Commits what changed. Files iCloud only has as placeholders are never committed as deleted.
    @discardableResult
    func commit() async -> Int {
        guard !busy else { return 0 }
        busy = true; defer { busy = false }
        set(.working, "Sichern …")
        let missing = await downloadFromICloud()
        let add = await git(["add", "-A", "--", "."] + missing.map { ":(exclude,literal)" + $0 })
        if !add.ok { set(.error, Self.explain(add.err)); return 0 }
        let deleted = await git(["diff", "--cached", "--name-only", "--diff-filter=D", "-z"])
        for path in deleted.out.split(separator: "\0").map(String.init) where !path.isEmpty {
            let u = root.appendingPathComponent(path)
            let placeholder = u.deletingLastPathComponent().appendingPathComponent("." + u.lastPathComponent + ".icloud")
            if FileManager.default.fileExists(atPath: placeholder.path) {
                _ = await git(["reset", "-q", "--", path])
                try? FileManager.default.startDownloadingUbiquitousItem(at: u)
            }
        }
        let staged = await git(["diff", "--cached", "--name-only"])
        let n = staged.out.split(separator: "\n").count
        if n > 0 {
            let first = !(await git(["rev-parse", "--verify", "-q", "HEAD"])).ok
            let r = await git(["commit", "-q", "-m", first ? "Ordo: erste Sicherung (\(n) Dateien)" : "Ordo: \(n) \(n == 1 ? "Datei" : "Dateien") geändert"])
            if !r.ok { set(.error, Self.explain(r.err)); return 0 }
            lastCommit = Date()
        }
        set(.idle)
        await refreshStatus()
        return n
    }

    func push() async -> Bool {
        guard !busy else { return false }
        guard (await git(["remote", "get-url", "origin"])).ok else { set(.error, "Kein Remote eingetragen"); return false }
        busy = true; defer { busy = false }
        set(.working, "Hochladen …")
        let r = await git(["push", "-q", "-u", "origin", "main"])
        if !r.ok { set(.error, Self.explain(r.err)); return false }
        lastPush = Date()
        set(.idle)
        await refreshStatus()
        return true
    }

    /// Gets changes from the remote. If the same note changed on both sides, nothing is
    /// lost: the other version is saved next to it as "Name (Konflikt).md".
    func pull() async -> Bool {
        guard !busy else { return false }
        guard (await git(["remote", "get-url", "origin"])).ok else { return false }
        busy = true; defer { busy = false }
        set(.working, "Holen …")
        // commit local work first so the merge has something to work with
        _ = await git(["add", "-A"])
        if !(await git(["diff", "--cached", "--quiet"])).ok {
            let first = !(await git(["rev-parse", "--verify", "-q", "HEAD"])).ok
            _ = await git(["commit", "-q", "-m", first ? "Ordo: erste Sicherung" : "Ordo: vor dem Holen gesichert"])
            lastCommit = Date()
        }
        let fetch = await git(["fetch", "-q", "origin"])
        if !fetch.ok { set(.error, Self.explain(fetch.err)); return false }
        guard (await git(["rev-parse", "--verify", "-q", "origin/main"])).ok else { lastPull = Date(); set(.idle); return true }  // empty remote
        let merge = await git(["merge", "--no-edit", "-q", "origin/main"])
        if !merge.ok {
            let conflicted = await git(["diff", "--name-only", "--diff-filter=U", "-z"])
            let files = conflicted.out.split(separator: "\0").map(String.init).filter { !$0.isEmpty }
            if files.isEmpty { _ = await git(["merge", "--abort"]); set(.error, Self.explain(merge.err)); return false }
            for path in files {
                let theirs = await git(["show", ":3:\(path)"])
                let ns = path as NSString
                let copy = ns.deletingPathExtension + " (Konflikt)" + (ns.pathExtension.isEmpty ? "" : "." + ns.pathExtension)
                let dest = root.appendingPathComponent(copy)
                if theirs.ok, FolderRules.isInside(dest, root: root) { try? theirs.out.write(to: dest, atomically: true, encoding: .utf8) }
                _ = await git(["checkout", "--ours", "--", path])
                _ = await git(["add", "--", path, copy])
            }
            _ = await git(["commit", "-q", "-m", "Ordo: Konflikte gesichert (\(files.count))"])
        }
        lastPull = Date()
        set(.idle)
        await refreshStatus()
        return true
    }

    /// Short German explanation of the usual git errors.
    nonisolated static func explain(_ err: String) -> String {
        let e = err.lowercased()
        if e.contains("permission denied") || e.contains("authentication") || e.contains("could not read username") || e.contains("403") {
            return "Anmeldung fehlgeschlagen – richte auf dem Mac einen SSH-Schlüssel oder die GitHub CLI ein (siehe Einstellungen › Git-Sync)."
        }
        if e.contains("could not resolve host") || e.contains("timed out") || e.contains("network") { return "Keine Verbindung zum Server." }
        if e.contains("repository not found") || e.contains("does not appear to be a git repository") { return "Repository nicht gefunden – stimmt die Adresse?" }
        if e.contains("rejected") || e.contains("non-fast-forward") { return "Auf dem Server gibt es neuere Änderungen – erst holen, dann hochladen." }
        return err.split(separator: "\n").last.map(String.init) ?? "Git-Fehler"
    }

    var statusJSON: [String: Any] {
        [
            "state": state.rawValue, "message": message, "uncommitted": uncommitted, "unpushed": unpushed,
            "lastCommit": lastCommit?.timeIntervalSince1970 ?? 0, "lastPush": lastPush?.timeIntervalSince1970 ?? 0, "lastPull": lastPull?.timeIntervalSince1970 ?? 0,
        ]
    }
}
#endif
