import SwiftUI

@main
struct OrdoApp: App {
    @State private var model = AppModel()
    #if os(macOS)
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    #endif
    @Environment(\.scenePhase) private var scenePhase

    init() {
        #if os(macOS)
        // Ordo is a one-window app: quitting with the window closed must not
        // restore "no window" on the next launch.
        UserDefaults.standard.register(defaults: ["ApplePersistenceIgnoreState": true])
        #endif
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .task {
                    model.openLastVaultIfPossible()
                    #if os(macOS)
                    appDelegate.model = model
                    DockIcon.follow()
                    #endif
                    #if DEBUG
                    DebugScript.runIfRequested(model: model)
                    #endif
                }
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active: model.refreshNow()
            case .background, .inactive: model.shell.call("ordo.host.flush()")
            @unknown default: break
            }
        }
        #if os(macOS)
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 1280, height: 820)
        .commands { OrdoCommands(model: model) }
        #endif
    }
}

#if os(macOS)
/// Asks before quitting while Git-Sync is backing up or uploading – quitting would cut it off.
final class AppDelegate: NSObject, NSApplicationDelegate {
    weak var model: AppModel?

    @MainActor
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let model, let git = model.git, git.isBusy else { return .terminateNow }
        let alert = NSAlert()
        alert.messageText = model.L("Upload läuft noch", "Upload in progress")
        alert.informativeText = model.L("Ordo sichert gerade deinen Vault bzw. lädt ihn hoch. Wenn du jetzt beendest, wird das abgebrochen.",
                                        "Ordo is backing up or uploading your vault. Quitting now cancels it.")
        alert.addButton(withTitle: model.L("Nach dem Upload beenden", "Quit when done"))
        alert.addButton(withTitle: model.L("Nicht beenden", "Don't quit"))
        alert.addButton(withTitle: model.L("Sofort beenden", "Quit now"))
        switch alert.runModal() {
        case .alertFirstButtonReturn:
            Task { @MainActor in
                while git.isBusy { try? await Task.sleep(for: .milliseconds(500)) }
                sender.reply(toApplicationShouldTerminate: true)
            }
            return .terminateLater
        case .alertThirdButtonReturn: return .terminateNow
        default: return .terminateCancel
        }
    }
}

/// Menu bar entries (German/English); each runs the same command as the web app's hotkeys.
struct OrdoCommands: Commands {
    let model: AppModel
    private var shell: ShellController { model.shell }
    private func L(_ de: String, _ en: String) -> String { model.L(de, en) }

    var body: some Commands {
        CommandGroup(replacing: .appSettings) {
            Button(L("Einstellungen …", "Settings …")) { shell.command("app:open-settings") }.keyboardShortcut(",")
        }
        CommandGroup(replacing: .newItem) {
            Button(L("Neue Notiz", "New note")) { shell.command("file:new-note") }.keyboardShortcut("n")
            Button(L("Neuer Tab", "New tab")) { shell.command("workspace:new-tab") }.keyboardShortcut("t")
            Button(L("Vault öffnen …", "Open vault …")) { shell.command("app:open-vault") }
            Divider()
            Button(L("Tab schließen", "Close tab")) { shell.command("workspace:close-tab") }.keyboardShortcut("w")
        }
        CommandMenu(L("Gehe zu", "Go")) {
            Button(L("Schnellwechsler …", "Quick switcher …")) { shell.command("switcher:open") }.keyboardShortcut("o")
            Button(L("Befehlspalette …", "Command palette …")) { shell.command("command-palette:open") }.keyboardShortcut("p")
            Button(L("Suche", "Search")) { shell.command("search:open") }.keyboardShortcut("f", modifiers: [.command, .shift])
            Button(L("Graph", "Graph view")) { shell.command("graph:open") }.keyboardShortcut("g")
            Divider()
            Button(L("Zurück", "Back")) { shell.command("app:go-back") }.keyboardShortcut(.leftArrow, modifiers: [.command, .option])
            Button(L("Vor", "Forward")) { shell.command("app:go-forward") }.keyboardShortcut(.rightArrow, modifiers: [.command, .option])
        }
        CommandMenu(L("Notiz", "Note")) {
            Button(L("Lesen / Bearbeiten", "Reading / editing")) { shell.command("markdown:toggle-preview") }.keyboardShortcut("e")
            Button(L("Seitenumbrüche anzeigen", "Show page breaks")) { shell.command("ordo:toggle-page-breaks") }.keyboardShortcut("b", modifiers: [.command, .shift])
            Button(L("Formel einfügen …", "Insert math …")) { shell.command("ordo:insert-math") }.keyboardShortcut("m", modifiers: [.command, .shift])
            Divider()
            Button(L("Als PDF exportieren", "Export as PDF")) { shell.command("ordo:export-quick") }
            Button(L("PDF-Export …", "PDF export …")) { shell.command("ordo:export") }.keyboardShortcut("e", modifiers: [.command, .shift])
            Button(L("Alle Notizen einsortieren …", "Sort all notes …")) { shell.command("ordo:sort-all") }
        }
        CommandGroup(after: .sidebar) {
            Button(L("Hell / Dunkel / System", "Light / dark / system")) { shell.command("app:toggle-color-scheme") }.keyboardShortcut("d", modifiers: [.command, .shift])
            Button(L("Linke Seitenleiste", "Left sidebar")) { shell.command("app:toggle-left-sidebar") }
            Button(L("Rechte Seitenleiste", "Right sidebar")) { shell.command("app:toggle-right-sidebar") }
        }
    }
}
#endif
