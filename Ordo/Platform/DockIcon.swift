#if os(macOS)
import AppKit

/// Before macOS 26 the bundle icon is static, so while Ordo runs the Dock icon follows the
/// system appearance: light tile in light mode, dark tile in dark mode. From macOS 26 on,
/// AppIcon.icon has both variants and the system picks one itself – also with Ordo closed.
@MainActor
enum DockIcon {
    private static var observation: NSKeyValueObservation?

    static func follow() {
        if #available(macOS 26, *) { return }
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
