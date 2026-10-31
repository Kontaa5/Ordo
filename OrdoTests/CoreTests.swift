import XCTest
import ImageIO
import UniformTypeIdentifiers

final class MarkdownParsingTests: XCTestCase {
    func testTagsInOrderOfAppearance() {
        let p = MarkdownParsing.parse("Text #4klasse und #medt sowie #4Klasse doppelt")
        XCTAssertEqual(p.tags, ["4klasse", "medt"])
    }

    func testFrontmatterTagsComeFirst() {
        let text = """
        ---
        tags: [schule, mathe]
        ---
        # Titel
        Inhalt #extra
        """
        XCTAssertEqual(MarkdownParsing.parse(text).tags, ["schule", "mathe", "extra"])
    }

    func testBodyTagsExcludeFrontmatter() {
        let p = MarkdownParsing.parse("---\ntags: [schule]\n---\nText #5sem #serw")
        XCTAssertEqual(p.bodyTags, ["5sem", "serw"])
        XCTAssertEqual(p.tags, ["schule", "5sem", "serw"])
    }

    func testFrontmatterBlockList() {
        let text = "---\ntags:\n  - a\n  - \"#b\"\n---\nx"
        XCTAssertEqual(MarkdownParsing.parse(text).tags, ["a", "b"])
    }

    func testHeadingsNumbersCodeAndLinksAreNotTags() {
        let text = """
        # Überschrift
        ## Zweite
        Jahr #2024 ist keine Zahl-Tag
        `#code` im Code
        ```
        #auchnicht
        ```
        [[Notiz#Abschnitt]] und [Link](#anker) und https://x.at/#frag
        echter #tag
        """
        let p = MarkdownParsing.parse(text)
        XCTAssertEqual(p.tags, ["tag"])
        XCTAssertEqual(p.headings.map(\.text), ["Überschrift", "Zweite"])
    }

    func testNestedTagsAndUmlauts() {
        XCTAssertEqual(MarkdownParsing.parse("#schule/mathe #Übung").tags, ["schule/mathe", "Übung"])
    }

    func testLinksAndEmbeds() {
        let p = MarkdownParsing.parse("Siehe [[Mathe|Alias]], [[Physik#Teil]] und ![[bild.png|300]] und [md](Ordner/Notiz%20A.md) ![](a.jpg) [ext](https://x.at)")
        XCTAssertEqual(p.links, ["Mathe", "Physik", "Ordner/Notiz A.md"])
        XCTAssertEqual(p.embeds, ["bild.png", "a.jpg"])
    }
}

final class FolderRulesTests: XCTestCase {
    func testFirstTagFolderSecondSubfolder() {
        XCTAssertEqual(FolderRules.targetFolder(tags: ["4klasse", "medt"], rules: [:]), "4klasse/medt")
    }

    func testOnlyOneTag() {
        XCTAssertEqual(FolderRules.targetFolder(tags: ["4klasse"], rules: [:]), "4klasse")
    }

    func testNoTags() {
        XCTAssertNil(FolderRules.targetFolder(tags: [], rules: [:]))
    }

    func testFolderOnlyRule() {
        XCTAssertEqual(FolderRules.targetFolder(tags: ["rezepte", "vegan"], rules: ["rezepte": TagRule(mode: .folderOnly)]), "rezepte")
    }

    func testIgnoredTagsAreSkipped() {
        XCTAssertEqual(FolderRules.targetFolder(tags: ["wichtig", "4klasse", "todo", "medt"], rules: ["wichtig": TagRule(mode: .ignore), "todo": TagRule(mode: .ignore)]), "4klasse/medt")
        XCTAssertNil(FolderRules.targetFolder(tags: ["wichtig"], rules: ["wichtig": TagRule(mode: .ignore)]))
    }

    func testRuleIsCaseInsensitive() {
        XCTAssertEqual(FolderRules.targetFolder(tags: ["Rezepte", "vegan"], rules: ["rezepte": TagRule(mode: .folderOnly)]), "Rezepte")
    }

    func testNestedTagBecomesNestedFolder() {
        XCTAssertEqual(FolderRules.targetFolder(tags: ["schule/mathe", "test"], rules: [:]), "schule/mathe/test")
        XCTAssertEqual(FolderRules.targetFolder(tags: ["schule/mathe", "test"], rules: ["schule": TagRule(mode: .folderOnly)]), "schule/mathe")
    }

    func testBaseFolder() {
        XCTAssertEqual(FolderRules.targetFolder(tags: ["a", "b"], rules: [:], base: "Notizen"), "Notizen/a/b")
    }

    func testMappedFolderName() {
        let rules = ["serw": TagRule(folder: "Softwareentwicklung"), "4sem": TagRule(mode: .ignore)]
        XCTAssertEqual(FolderRules.targetFolder(tags: ["4sem", "serw"], rules: rules), "Softwareentwicklung")
        XCTAssertEqual(FolderRules.targetFolder(tags: ["5sem", "serw"], rules: rules, allTagsAreFolders: false), "Softwareentwicklung")
        XCTAssertEqual(FolderRules.targetFolder(tags: ["serw", "übung"], rules: rules), "Softwareentwicklung/übung")
    }

    func testOnlyListedTagsAreFolders() {
        let rules = ["serw": TagRule(folder: "Softwareentwicklung"), "uebung": TagRule()]
        XCTAssertNil(FolderRules.targetFolder(tags: ["5sem", "wichtig"], rules: rules, allTagsAreFolders: false))
        XCTAssertEqual(FolderRules.targetFolder(tags: ["5sem", "serw", "wichtig", "uebung"], rules: rules, allTagsAreFolders: false), "Softwareentwicklung/uebung")
    }

    func testMappedParentKeepsNestedPart() {
        XCTAssertEqual(FolderRules.targetFolder(tags: ["serw/java"], rules: ["serw": TagRule(folder: "Softwareentwicklung")]), "Softwareentwicklung/java")
    }
}

final class ImageProcessingTests: XCTestCase {
    /// Random pixels compress badly, so these files are reliably over 1 MB.
    private func noise(_ w: Int, _ h: Int, as type: UTType, quality: Double = 1) -> Data {
        var bytes = [UInt8](repeating: 255, count: w * h * 4)
        for i in stride(from: 0, to: bytes.count, by: 4) { bytes[i] = .random(in: 0...255); bytes[i + 1] = .random(in: 0...255); bytes[i + 2] = .random(in: 0...255) }
        let ctx = CGContext(data: &bytes, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                            space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
        let out = NSMutableData()
        let dest = CGImageDestinationCreateWithData(out, type.identifier as CFString, 1, nil)!
        CGImageDestinationAddImage(dest, ctx.makeImage()!, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
        CGImageDestinationFinalize(dest)
        return out as Data
    }

    func testBigJPEGGetsSmaller() {
        let data = noise(1600, 1200, as: .jpeg)
        XCTAssertGreaterThan(data.count, ImageProcessing.compressThreshold)
        let (out, ext) = ImageProcessing.process(data, ext: "jpg", maxDim: 2400, convertHEIC: true)
        XCTAssertEqual(ext, "jpg")
        XCTAssertLessThan(out.count, data.count)
    }

    func testBigOpaquePNGBecomesJPEG() {
        let data = noise(1000, 800, as: .png)
        let (out, ext) = ImageProcessing.process(data, ext: "png", maxDim: 2400, convertHEIC: true)
        XCTAssertEqual(ext, "jpg")
        XCTAssertLessThan(out.count, data.count)
    }

    func testSmallImageUntouched() {
        let data = noise(100, 80, as: .jpeg, quality: 0.7)
        let (out, ext) = ImageProcessing.process(data, ext: "jpg", maxDim: 2400, convertHEIC: true)
        XCTAssertEqual(ext, "jpg")
        XCTAssertEqual(out, data)
    }

    func testCompressionCanBeTurnedOff() {
        let data = noise(1600, 1200, as: .jpeg)
        let (out, _) = ImageProcessing.process(data, ext: "jpg", maxDim: 2400, convertHEIC: true, compress: false)
        XCTAssertEqual(out, data)
    }
}

final class VaultPathTests: XCTestCase {
    func testPathsNeverLeaveTheVault() {
        XCTAssertEqual(FolderRules.insideVault("../../etc/passwd"), "etc/passwd")
        XCTAssertEqual(FolderRules.insideVault("/etc/passwd"), "etc/passwd")
        XCTAssertEqual(FolderRules.insideVault("a/../../b"), "a/b")
        XCTAssertEqual(FolderRules.insideVault("./../x.md"), "x.md")
        XCTAssertEqual(FolderRules.insideVault("INSY/Aufgabe 01.md"), "INSY/Aufgabe 01.md")
        XCTAssertEqual(FolderRules.insideVault(""), "")
    }
}

final class SecurityTests: XCTestCase {
    func testNamesCannotBeDotDot() {
        XCTAssertEqual(FolderRules.sanitize(".."), "")
        XCTAssertEqual(FolderRules.sanitize("."), "")
        XCTAssertEqual(FolderRules.sanitize("Notiz"), "Notiz")
    }

    func testSymlinksOutOfTheVaultAreRejected() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("ordo-sec-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        try "x".write(to: root.appendingPathComponent("ok.md"), atomically: true, encoding: .utf8)
        try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("out.md"), withDestinationURL: URL(fileURLWithPath: "/etc/hosts"))
        XCTAssertTrue(FolderRules.isInside(root.appendingPathComponent("ok.md"), root: root))
        XCTAssertFalse(FolderRules.isInside(root.appendingPathComponent("out.md"), root: root))
        // a new file below a symlinked folder, and a symlinked .trash
        let outside = FileManager.default.temporaryDirectory.appendingPathComponent("ordo-out-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: outside, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: outside) }
        try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("INSY"), withDestinationURL: outside)
        try FileManager.default.createSymbolicLink(at: root.appendingPathComponent(".trash"), withDestinationURL: outside)
        XCTAssertFalse(FolderRules.isInside(root.appendingPathComponent("INSY/neu/Notiz.md"), root: root))
        XCTAssertTrue(FolderRules.isInside(root.appendingPathComponent("Neu/Notiz.md"), root: root))
        XCTAssertEqual(FolderRules.ownFolder(root, ".trash"), FolderRules.blocked)
        XCTAssertEqual(FolderRules.ownFolder(root, ".ordo"), root.appendingPathComponent(".ordo", isDirectory: true))
    }

    /// `.ordo/snippets → somewhere else` (a shared or copied vault): Ordo must not write or read there.
    @MainActor
    func testOwnFilesNotThroughSymlinkedSubfolder() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("ordo-sec-\(UUID().uuidString)")
        let outside = FileManager.default.temporaryDirectory.appendingPathComponent("ordo-out-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root.appendingPathComponent(".ordo"), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: outside, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: outside) }
        try FileManager.default.createSymbolicLink(at: root.appendingPathComponent(".ordo/snippets"), withDestinationURL: outside)
        try "body{}".write(to: outside.appendingPathComponent("fremd.css"), atomically: true, encoding: .utf8)
        let store = VaultStore(root: root)
        store.saveCustomCSS("a{}")
        XCTAssertFalse(FileManager.default.fileExists(atPath: outside.appendingPathComponent("eigenes.css").path))
        XCTAssertNil(store.snippetCSS("fremd"))
        store.writeOwn(Data("x".utf8), to: root.appendingPathComponent(".ordo/ok.json"))
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent(".ordo/ok.json").path))
    }

    func testGitRemoteMustBeARealAddress() {
        for ok in ["git@github.com:Kontaa5/Ordo.git", "https://github.com/a/b.git", "ssh://git@host/x.git", "/Volumes/USB/vault.git"] {
            XCTAssertTrue(GitSync.isValidRemote(ok), ok)
        }
        for bad in ["--upload-pack=touch /tmp/x", "-c", "ext::sh -c touch% /tmp/x", "fd::3", "https://a b", "git@host:x;rm", "", "http://insecure"] {
            XCTAssertFalse(GitSync.isValidRemote(bad), bad)
        }
    }

    func testInsertedPhotosLoseTheirLocation() {
        func photo(_ w: Int) -> Data {
            let ctx = CGContext(data: nil, width: w, height: w, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
            ctx.setFillColor(CGColor(red: 0.2, green: 0.5, blue: 0.8, alpha: 1)); ctx.fill(CGRect(x: 0, y: 0, width: w, height: w))
            let out = NSMutableData()
            let dest = CGImageDestinationCreateWithData(out, UTType.jpeg.identifier as CFString, 1, nil)!
            let gps: [CFString: Any] = [kCGImagePropertyGPSLatitude: 48.2, kCGImagePropertyGPSLatitudeRef: "N", kCGImagePropertyGPSLongitude: 16.37, kCGImagePropertyGPSLongitudeRef: "E"]
            CGImageDestinationAddImage(dest, ctx.makeImage()!, [kCGImagePropertyGPSDictionary: gps] as CFDictionary)
            CGImageDestinationFinalize(dest)
            return out as Data
        }
        func hasGPS(_ d: Data) -> Bool {
            let src = CGImageSourceCreateWithData(d as CFData, nil)!
            return (CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any])?[kCGImagePropertyGPSDictionary] != nil
        }
        for size in [200, 3000] {   // small (untouched) and big (scaled) picture
            let original = photo(size)
            XCTAssertTrue(hasGPS(original), "test photo needs a location")
            let (out, _) = ImageProcessing.process(original, ext: "jpg", maxDim: 2400, convertHEIC: true)
            XCTAssertFalse(hasGPS(out), "size \(size)")
        }
    }
}

final class TrashTests: XCTestCase {
    /// An old note in the trash without Ordo's record (e.g. moved there by Obsidian) must not be purged right away.
    @MainActor
    func testOldFileWithoutRecordIsNotPurged() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("ordo-trash-\(UUID().uuidString)")
        let trash = root.appendingPathComponent(".trash")
        try FileManager.default.createDirectory(at: trash, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let file = trash.appendingPathComponent("Alt.md")
        try "x".write(to: file, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.modificationDate: Date().addingTimeInterval(-90 * 86_400)], ofItemAtPath: file.path)
        let store = VaultStore(root: root)
        XCTAssertEqual(store.purgeTrash(), 0)
        XCTAssertTrue(FileManager.default.fileExists(atPath: file.path))
    }

    /// Deleting an old note in Ordo, then the start-up clean-up: the note must stay in the trash.
    @MainActor
    func testDeletedOldNoteSurvivesPurge() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("ordo-trash-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent("Alt.md")
        try "x".write(to: file, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.modificationDate: Date().addingTimeInterval(-90 * 86_400)], ofItemAtPath: file.path)
        let store = VaultStore(root: root)
        await store.refresh()
        try store.trash("Alt.md")
        XCTAssertEqual(store.purgeTrash(), 0)
        XCTAssertEqual(VaultStore(root: root).purgeTrash(), 0)   // e.g. the app started again
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent(".trash/Alt.md").path))
    }

    /// iCloud marks moved files as hidden – they must still show up in the trash.
    @MainActor
    func testHiddenFlagStillListed() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("ordo-trash-\(UUID().uuidString)")
        let trash = root.appendingPathComponent(".trash")
        try FileManager.default.createDirectory(at: trash, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        var file = trash.appendingPathComponent("Versteckt.md")
        try "x".write(to: file, atomically: true, encoding: .utf8)
        var v = URLResourceValues(); v.isHidden = true
        try file.setResourceValues(v)
        let names = VaultStore(root: root).listTrash().compactMap { $0["name"] as? String }
        XCTAssertEqual(names, ["Versteckt.md"])
    }

    /// Note actions never reach hidden folders – above all .obsidian, where Obsidian runs plugin code.
    @MainActor
    func testHiddenFoldersAreNoTarget() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("ordo-dot-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root.appendingPathComponent(".obsidian/plugins/x"), withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = VaultStore(root: root)
        for bad in [".obsidian/plugins/x/main.js", "Ordner/.git/config", ".trash/a.md", "../.obsidian/app.json"] {
            XCTAssertEqual(store.url(bad), FolderRules.blocked, bad)
        }
        XCTAssertEqual(store.url("Ordner/Notiz.md").path, root.appendingPathComponent("Ordner/Notiz.md").path)
        // a tampered trash record cannot restore into .obsidian
        let trash = root.appendingPathComponent(".trash")
        try FileManager.default.createDirectory(at: trash, withIntermediateDirectories: true)
        try "evil".write(to: trash.appendingPathComponent("main.js"), atomically: true, encoding: .utf8)
        try #"{"main.js":{"from":".obsidian/plugins/x/main.js","date":0}}"#.write(to: trash.appendingPathComponent(".ordo-trash.json"), atomically: true, encoding: .utf8)
        let restored = expectation(description: "restore")
        Task { @MainActor in
            _ = try? await store.restoreFromTrash("main.js")
            restored.fulfill()
        }
        wait(for: [restored], timeout: 5)
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent(".obsidian/plugins/x/main.js").path))
    }
}

/// Git with a local remote only (never SSH): a conflicting picture is kept byte for byte, an older conflict copy stays.
final class GitConflictTests: XCTestCase {
    @MainActor
    func testBinaryConflictCopyIntact() async throws {
        let fm = FileManager.default
        let base = fm.temporaryDirectory.appendingPathComponent("ordo-git-\(UUID().uuidString)")
        let bare = base.appendingPathComponent("remote.git"), a = base.appendingPathComponent("A"), b = base.appendingPathComponent("B")
        try fm.createDirectory(at: a, withIntermediateDirectories: true); try fm.createDirectory(at: b, withIntermediateDirectories: true)
        func sh(_ args: [String]) { let p = Process(); p.executableURL = URL(fileURLWithPath: "/usr/bin/git"); p.arguments = args; try? p.run(); p.waitUntilExit() }
        sh(["init", "--bare", "-b", "main", bare.path])
        let ga = GitSync(root: a), gb = GitSync(root: b)
        defer { try? fm.removeItem(at: base); try? fm.removeItem(at: ga.gitDir); try? fm.removeItem(at: gb.gitDir) }
        let img: (UInt8) -> Data = { v in Data([0x89, 0x50, 0x4E, 0x47, 0xFF, 0x00, 0xC3, v, 0x80]) }
        try img(1).write(to: a.appendingPathComponent("bild.png"))
        _ = await ga.prepare(remote: bare.path); _ = await ga.backupAndUpload()
        _ = await gb.prepare(remote: bare.path); _ = await gb.pull()
        try img(2).write(to: a.appendingPathComponent("bild.png")); _ = await ga.backupAndUpload()
        try img(3).write(to: b.appendingPathComponent("bild.png")); try "alt".write(to: b.appendingPathComponent("bild (Konflikt).png"), atomically: true, encoding: .utf8)
        let ok = await gb.pull()
        XCTAssertTrue(ok)
        XCTAssertEqual(try Data(contentsOf: b.appendingPathComponent("bild.png")), img(3))
        XCTAssertEqual(try Data(contentsOf: b.appendingPathComponent("bild (Konflikt 2).png")), img(2))
        XCTAssertEqual(try String(contentsOf: b.appendingPathComponent("bild (Konflikt).png"), encoding: .utf8), "alt")
    }
}
