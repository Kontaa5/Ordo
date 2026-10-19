# Ordo

Markdown-Notizen wie in Obsidian – mit Hashtag-Ordnern, Seitenumbruch-Vorschau und PDF-Export nach Hashtag.
App für macOS, iPhone und iPad. Die Oberfläche ist wie bei Obsidian eine Web-Oberfläche (CodeMirror 6 als Editor) mit Obsidians CSS-Klassen und -Variablen, deshalb funktionieren Obsidian-Themes und CSS-Snippets. Dateien, iCloud, PDF, Bilder und Git laufen nativ in Swift.

## Funktionen
- **Vault = normaler Ordner** mit `.md`-Dateien. Ein bestehender Obsidian-Vault lässt sich direkt öffnen; Ordo schreibt nie in `.obsidian`, beide Apps können parallel laufen.
- **Hashtag → Ordner**: 1. Hashtag = Ordner, 2. = Unterordner (`#4klasse #medt` → `4klasse/medt/`). Pro Hashtag einstellbar (eigener Ordnername, kein Unterordner, nur Schlagwort). Von Hand verschobene Notizen bleiben, wo sie sind.
- **Eine Schreibweise pro Hashtag**: `#se` + Tab → `#SEW`; `#sew` wird beim Tippen korrigiert; vorhandene Varianten lassen sich mit Vorschau vereinheitlichen.
- **Live-Vorschau** wie Obsidian, Lesemodus (⌘E), `->` wird zu →, Markierung + `` ` `` `*` `_` `=` … umschließt den Text.
- **Bilder**: Link und Foto, Größe ziehen, groß ansehen, zuschneiden (doppelt verwendete Bilder werden als Kopie gespeichert), per Drag & Drop nebeneinander (max. 3 pro Reihe), verkleinern mit Vorher/Nachher in Pixel und DPI.
- **Spalten**: Absätze markieren › Rechtsklick › *Nebeneinander* oder Blöcke am Griff ⋮⋮ neben einen anderen ziehen (`> [!multi-column]`, kompatibel mit Obsidians Modular-CSS-Layout).
- **Seitenumbrüche** (⌘⇧B) im Editor, identisch mit dem PDF. Manueller Umbruch: `\pagebreak`.
- **PDF-Export nach Hashtags** (⌘⇧E), z. B. alle mit `#4klasse` UND `#medt`, auch direkt aus Suchtreffern oder per Rechtsklick auf einen Tab.
- **Graph** (⌘G): *Global* mit Hashtags als Gruppen, *Lokal* zeigt einen Hashtag mit allen Notizen im Kreis, dazu „Ohne Hashtag“ und „Ohne Verbindungen“.
- **Darstellung wie Obsidian**: Hell/Dunkel/System, Akzentfarbe, Themes, CSS-Snippets, Schriften, Deutsch/Englisch, Zoom (⌘+ / ⌘− / ⌘0).
- **Papierkorb** unten in der Dateiliste: Löschen fragt immer nach, alles lässt sich wiederherstellen (`.trash`, wie Obsidian).
- **iCloud**: Vault in iCloud Drive ablegen und am iPhone denselben Ordner wählen.
- **Git-Sync** (Mac, Einstellungen › Git-Sync): Verlauf und Backup in einem Git-Repository. Die Git-Daten liegen lokal (nicht in iCloud), gesichert werden nur Änderungen; Hochladen z. B. einmal am Tag.

## Bauen
```bash
cd web && npm install && npm run build   # Editor-Bundle → Ordo/Resources/Web
xcodegen generate                        # Ordo.xcodeproj (nur nach neuen/gelöschten Dateien nötig)
open Ordo.xcodeproj
```
Tests: `xcodebuild -project Ordo.xcodeproj -scheme OrdoTests -destination 'platform=macOS' test`

**iPhone:** siehe [docs/iPhone-Installation.md](docs/iPhone-Installation.md) (kostenloser Apple-Account, AltStore oder direkt aus Xcode).

## Demo-Vault
`Ordo Demo/` enthält ein paar Schul-Notizen zum Ausprobieren – mit der Notiz *Willkommen* anfangen. Neu erzeugen:
```bash
rm -rf "Ordo Demo" && python3 tools/demo/make_vault.py "Ordo Demo" && swift tools/demo/make_images.swift "Ordo Demo/Anhänge"
```

## Aufbau
- `Ordo/` – Swift: App, Vault (Dateien, iCloud, Hashtag-Ordner), PDF-Export, Bilder, Git-Sync
- `web/src/` – TypeScript: Oberfläche, Editor (CodeMirror 6), Graph, Einstellungen
- `tools/` – App-Icon und Demo-Vault erzeugen, IPA bauen
