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
                #if os(macOS)
                // {"type": "text"}: real key events through AppKit (text input, spelling correction), not DOM events
                if let text = step["type"] as? String, let window = model.shell.webView.window {
                    NSApp.activate(ignoringOtherApps: true)
                    window.makeKeyAndOrderFront(nil)
                    window.makeFirstResponder(model.shell.webView)
                    for ch in text {
                        let s = String(ch)
                        for type in [NSEvent.EventType.keyDown, .keyUp] {
                            if let e = NSEvent.keyEvent(with: type, location: .zero, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                                        windowNumber: window.windowNumber, context: nil, characters: s, charactersIgnoringModifiers: s,
                                                        isARepeat: false, keyCode: s == " " ? 49 : 0) {
                                window.sendEvent(e)
                            }
                        }
                        try? await Task.sleep(for: .milliseconds(120))
                    }
                }
                // {"drag": [x1, y1, x2, y2]} in page coordinates: real mouse down / drag / up through AppKit
                var drag = step["drag"] as? [Double]
                if let js = step["dragjs"] as? String {   // {"dragjs": "return [x1, y1, x2, y2]"}: coordinates computed in the page
                    drag = (try? await model.shell.webView.callAsyncJavaScript(js, contentWorld: .page)) as? [Double]
                }
                if let d = drag, d.count == 4, let window = model.shell.webView.window {
                    NSApp.activate(ignoringOtherApps: true)
                    window.makeKeyAndOrderFront(nil)
                    let web = model.shell.webView
                    func point(_ x: Double, _ y: Double) -> NSPoint {
                        let p = web.convert(NSPoint(x: x * web.pageZoom, y: y * web.pageZoom), to: nil)
                        return web.isFlipped ? p : NSPoint(x: p.x, y: web.convert(NSPoint(x: 0, y: web.bounds.height - y * web.pageZoom), to: nil).y)
                    }
                    func send(_ type: NSEvent.EventType, _ p: NSPoint) {
                        if let e = NSEvent.mouseEvent(with: type, location: p, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                                      windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: type == .leftMouseUp ? 0 : 1) {
                            window.sendEvent(e)
                        }
                    }
                    send(.mouseMoved, point(d[0], d[1]))
                    try? await Task.sleep(for: .milliseconds(150))
                    send(.leftMouseDown, point(d[0], d[1]))
                    for i in 1...12 {
                        try? await Task.sleep(for: .milliseconds(40))
                        let f = Double(i) / 12
                        send(.leftMouseDragged, point(d[0] + (d[2] - d[0]) * f, d[1] + (d[3] - d[1]) * f))
                    }
                    try? await Task.sleep(for: .milliseconds(100))
                    send(.leftMouseUp, point(d[2], d[3]))
                }
                #endif
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
            #if os(macOS)
            NSLog("DBG gestures %@", model.shell.webView.gestureRecognizers.map { String(describing: type(of: $0)) }.joined(separator: ","))
            #endif
            NSLog("DBG done")
            #if os(macOS)
            if (ProcessInfo.processInfo.environment["ORDO_DEBUG_QUIT"] ?? "1") == "1" { NSApp.terminate(nil) }
            #endif
        }
    }
}
#endif
