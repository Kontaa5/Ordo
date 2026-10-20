# Entwicklung

## Bauen
```bash
cd web && npm install && npm run build   # Oberfläche → Ordo/Resources/Web
xcodegen generate                        # Ordo.xcodeproj (nach neuen/gelöschten Dateien)
open Ordo.xcodeproj
```
Tests: `xcodebuild -project Ordo.xcodeproj -scheme OrdoTests -destination 'platform=macOS' test`

## Neue Version veröffentlichen
```bash
tools/release.sh 0.2.0
git commit -am "Ordo 0.2.0" && git push
```
Das Skript baut die App (Apple Silicon + Intel), legt das Zip auf den Branch `releases` und trägt Version und Prüfsumme in `Casks/ordo.rb` ein.
Ordo ist nicht von Apple notarisiert; die Formel entfernt deshalb nach der Installation die Quarantäne-Markierung.

## Demo-Vault
```bash
rm -rf "Ordo Demo" && python3 tools/demo/make_vault.py "Ordo Demo" && swift tools/demo/make_images.swift "Ordo Demo/Anhänge"
```

## Aufbau
- `Ordo/` – Swift: App, Vault (Dateien, iCloud, Hashtag-Ordner), PDF-Export, Bilder, Git-Sync
- `web/src/` – TypeScript: Oberfläche, Editor (CodeMirror 6), Graph, Einstellungen
- `Casks/` – Homebrew-Formel
- `tools/` – Release, App-Icon, Demo-Vault, IPA fürs iPhone
