import Foundation
import CoreGraphics

/// Settings stored inside the vault (`.ordo/settings.json`) so they sync to
/// every device through iCloud together with the notes.
struct VaultSettings: Codable, Equatable, Sendable {
    enum AttachmentLocation: String, Codable, CaseIterable, Identifiable, Sendable {
        case folder          // one fixed folder for all attachments
        case besideNote      // same folder as the note
        case subfolderOfNote // a subfolder next to the note
        var id: String { rawValue }
        var label: String {
            switch self {
            case .folder: "Fester Ordner"
            case .besideNote: "Im Ordner der Notiz"
            case .subfolderOfNote: "Unterordner neben der Notiz"
            }
        }
    }

    enum LinkStyle: String, Codable, CaseIterable, Identifiable, Sendable {
        case wiki, markdown
        var id: String { rawValue }
        var label: String { self == .wiki ? "Wikilink  ![[bild.png]]" : "Markdown  ![](bild.png)" }
    }

    enum EditorMode: String, Codable, CaseIterable, Identifiable, Sendable {
        case edit, read
        var id: String { rawValue }
        var label: String { self == .edit ? "Bearbeiten" : "Lesen" }
    }

    var attachmentLocation: AttachmentLocation = .folder
    var attachmentFolder: String = "Anhänge"
    var attachmentSubfolderName: String = "Anhänge"
    var linkStyle: LinkStyle = .wiki
    /// Photos larger than this (longest side, px) are scaled down on insert. 0 = keep original.
    var maxImageDimension: Int = 2400
    var convertHEIC: Bool = true
    /// Re-encode pictures over 1 MB on insert to save space.
    var compressImages: Bool = true

    var autoSort: Bool = true
    var sortBaseFolder: String = ""
    /// Keys are lowercased tags without '#'.
    var tagRules: [String: TagRule] = [:]
    /// false = only hashtags with a rule become folders
    var allTagsAreFolders: Bool = true
    var newNoteFolder: String = ""
    /// Chosen spelling per hashtag (key: lowercased tag), e.g. "sew" → "SEW".
    var tagSpellings: [String: String] = [:]

    // Git-Sync (Mac): backup of the vault to a git remote, history kept outside iCloud
    /// Days deleted items stay in .trash before they are removed for good (0 = never).
    var trashDays: Int = 30

    var gitEnabled: Bool = false
    var gitRemote: String = ""

    var defaultMode: EditorMode = .edit
    var editorFontSize: Double = 16
    var readableLineWidth: Bool = true

    var page: PageSettings = .init()
    var exportPresets: [ExportPreset] = []

    init() {}

    // tolerate older / partial files
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let d = VaultSettings()
        attachmentLocation = (try? c.decode(AttachmentLocation.self, forKey: .attachmentLocation)) ?? d.attachmentLocation
        attachmentFolder = (try? c.decode(String.self, forKey: .attachmentFolder)) ?? d.attachmentFolder
        attachmentSubfolderName = (try? c.decode(String.self, forKey: .attachmentSubfolderName)) ?? d.attachmentSubfolderName
        linkStyle = (try? c.decode(LinkStyle.self, forKey: .linkStyle)) ?? d.linkStyle
        maxImageDimension = (try? c.decode(Int.self, forKey: .maxImageDimension)) ?? d.maxImageDimension
        convertHEIC = (try? c.decode(Bool.self, forKey: .convertHEIC)) ?? d.convertHEIC
        compressImages = (try? c.decode(Bool.self, forKey: .compressImages)) ?? d.compressImages
        autoSort = (try? c.decode(Bool.self, forKey: .autoSort)) ?? d.autoSort
        sortBaseFolder = (try? c.decode(String.self, forKey: .sortBaseFolder)) ?? d.sortBaseFolder
        if let rules = try? c.decode([String: TagRule].self, forKey: .tagRules) {
            tagRules = rules
        } else if let old = try? c.decode([String: TagFolderMode].self, forKey: .tagRules) {
            tagRules = old.mapValues { TagRule(mode: $0) }
        }
        allTagsAreFolders = (try? c.decode(Bool.self, forKey: .allTagsAreFolders)) ?? d.allTagsAreFolders
        tagSpellings = (try? c.decode([String: String].self, forKey: .tagSpellings)) ?? d.tagSpellings
        trashDays = (try? c.decode(Int.self, forKey: .trashDays)) ?? d.trashDays
        gitEnabled = (try? c.decode(Bool.self, forKey: .gitEnabled)) ?? d.gitEnabled
        gitRemote = (try? c.decode(String.self, forKey: .gitRemote)) ?? d.gitRemote
        exportPresets = (try? c.decode([ExportPreset].self, forKey: .exportPresets)) ?? d.exportPresets
        newNoteFolder = (try? c.decode(String.self, forKey: .newNoteFolder)) ?? d.newNoteFolder
        defaultMode = (try? c.decode(EditorMode.self, forKey: .defaultMode)) ?? d.defaultMode
        editorFontSize = (try? c.decode(Double.self, forKey: .editorFontSize)) ?? d.editorFontSize
        readableLineWidth = (try? c.decode(Bool.self, forKey: .readableLineWidth)) ?? d.readableLineWidth
        page = (try? c.decode(PageSettings.self, forKey: .page)) ?? d.page
    }
}

struct PageSettings: Codable, Equatable, Hashable, Sendable {
    enum Paper: String, Codable, CaseIterable, Identifiable, Hashable, Sendable {
        case a4, a5, letter
        var id: String { rawValue }
        var label: String { switch self { case .a4: "A4"; case .a5: "A5"; case .letter: "US Letter" } }
        /// size in PDF points (portrait)
        var size: CGSize {
            switch self {
            case .a4: CGSize(width: 595.28, height: 841.89)
            case .a5: CGSize(width: 419.53, height: 595.28)
            case .letter: CGSize(width: 612, height: 792)
            }
        }
    }

    var paper: Paper = .a4
    var landscape = false
    var marginMM: Double = 20
    var fontSize: Double = 11
    var pageNumbers = true

    var pageSize: CGSize {
        let s = paper.size
        return landscape ? CGSize(width: s.height, height: s.width) : s
    }
    var marginPt: Double { marginMM * 72 / 25.4 }

    /// Geometry for the web paginator (1 CSS px == 1 pt).
    var webGeom: [String: Double] {
        let s = pageSize, m = marginPt
        return ["pageW": s.width, "pageH": s.height, "mt": m, "mr": m, "mb": m, "ml": m, "fontSize": fontSize]
    }
}

/// Per-note bookkeeping for the hashtag-folder automation (`.ordo/state.json`).
struct VaultState: Codable, Sendable {
    struct NoteState: Codable, Sendable, Equatable {
        /// The folder the tags pointed to last time we looked ("" = none).
        var tagKey: String
        /// Moved by hand: the automation leaves the note alone.
        var pinned: Bool = false
    }
    var notes: [String: NoteState] = [:]
}

/// A saved export configuration ("4klasse MEDT – Handout").
struct ExportPreset: Codable, Equatable, Hashable, Identifiable, Sendable {
    var id = UUID()
    var name: String
    var tags: [String]
    var matchAll = true
    var combined = true
    var tableOfContents = true
    var titleHeadings = true
    var page = PageSettings()
}
