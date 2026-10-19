#if os(macOS)
import AppKit

/// The bundle icon is static, so while Ordo runs the Dock icon follows the
/// system appearance: light tile in light mode, dark tile in dark mode.
@MainActor
enum DockIcon {
    private static var observation: NSKeyValueObservation?

    static func follow() {
        update()
        observation = NSApp.observe(\.effectiveAppearance) { _, _ in
            Task { @MainActor in update() }
        }
    }

    private static func update() {
        let dark = NSApp.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        NSApp.applicationIconImage = NSImage(named: dark ? "DockIcon-dark" : "DockIcon-light")
    }
}
#endif
