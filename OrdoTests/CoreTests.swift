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
