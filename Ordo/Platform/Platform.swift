import SwiftUI
#if os(macOS)
import AppKit
#else
import UIKit
#endif

enum Platform {
    #if os(macOS)
    static let isPhone = false

    static func chooseFolder(prompt: String = "Öffnen", message: String = "Wähle den Ordner deines Vaults (z. B. in iCloud Drive).", completion: @escaping (URL) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.allowsMultipleSelection = false
        panel.prompt = prompt
        panel.message = message
        if panel.runModal() == .OK, let url = panel.url { completion(url) }
    }

    static func reveal(_ url: URL) { NSWorkspace.shared.activateFileViewerSelecting([url]) }

    static func save(data: Data, suggestedName: String) -> URL? {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedName
        panel.allowedContentTypes = [.pdf]
        panel.canCreateDirectories = true
        guard panel.runModal() == .OK, let url = panel.url else { return nil }
        try? data.write(to: url)
        return url
    }

    #else
    static var isPhone: Bool { UIDevice.current.userInterfaceIdiom == .phone }
    static func reveal(_ url: URL) {}
    #endif
}
