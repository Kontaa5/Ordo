#if DEBUG
import WebKit
#if os(macOS)
import AppKit
#endif

/// Debug builds only: `ORDO_DEBUG_SCRIPT=/path/steps.json` drives the web shell
/// for automated UI checks. Steps: {"js": "...", "wait": 1.0, "snap": "name"}.
/// Results are logged ("DBG …"), snapshots are written next to the script.
enum DebugScript {
    @MainActor static func runIfRequested(model: AppModel) {
        guard let path = ProcessInfo.processInfo.environment["ORDO_DEBUG_SCRIPT"],
              let data = try? Data(contentsOf: URL(fileURLWithPath: path)),
              let steps = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return }
        let dir = URL(fileURLWithPath: path).deletingLastPathComponent()
        Task { @MainActor in
            for _ in 0..<100 where !model.shell.isReady { try? await Task.sleep(for: .milliseconds(100)) }
            try? await Task.sleep(for: .seconds(2))
            for (i, step) in steps.enumerated() {
                if let js = step["js"] as? String {
                    do {
                        let r = try await model.shell.webView.callAsyncJavaScript(js, contentWorld: .page)
                        NSLog("DBG %d %@", i, String(describing: r ?? "nil"))
                    } catch { NSLog("DBG %d ERROR %@", i, String(describing: error)) }
                }
                if let w = step["wait"] as? Double { try? await Task.sleep(for: .seconds(w)) }
                if let name = step["snap"] as? String {
                    #if os(macOS)
                    if let img = try? await model.shell.webView.takeSnapshot(configuration: nil), let tiff = img.tiffRepresentation,
                       let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) {
                        try? png.write(to: dir.appendingPathComponent(name + ".png"))
                    }
                    #else
                    if let png = try? await model.shell.webView.takeSnapshot(configuration: nil).pngData() {
                        try? png.write(to: dir.appendingPathComponent(name + ".png"))
                    }
                    #endif
                }
            }
            NSLog("DBG done")
            #if os(macOS)
            if (ProcessInfo.processInfo.environment["ORDO_DEBUG_QUIT"] ?? "1") == "1" { NSApp.terminate(nil) }
            #endif
        }
    }
}
#endif
