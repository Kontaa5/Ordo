# Ordo

Markdown-Editor für Mac und iPhone: Hashtags sortieren Notizen in Ordner, PDF-Export nach Hashtag, Graph, Bilder, iCloud.

![Ordo](docs/images/ordo.png)

## Installieren

Voraussetzung: macOS 14 (Sonoma) oder neuer.

**1. Homebrew** – nur falls noch nicht installiert ([brew.sh](https://brew.sh)), im Terminal:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

**2. Ordo installieren:**

```bash
brew tap kontaa5/ordo https://github.com/Kontaa5/Ordo
brew install --cask ordo
```

![Installation im Terminal](docs/images/install.png)

**3. Starten:** Ordo über Launchpad oder Spotlight öffnen, auf **Öffnen** klicken und einen Ordner mit Markdown-Dateien wählen (oder einen neuen).

![Erster Start](docs/images/start.png)

## Aktualisieren

```bash
brew upgrade --cask ordo
```

## Deinstallieren

```bash
brew uninstall --cask ordo
brew untap kontaa5/ordo
```

![Deinstallation im Terminal](docs/images/uninstall.png)

Deine Notizen bleiben erhalten – sie liegen in deinem Ordner, nicht in der App.
Auch die Einstellungen löschen: `brew uninstall --zap --cask ordo`.

## Funktionen

- 1. Hashtag = Ordner, 2. Hashtag = Unterordner (`#4klasse #medt` → `4klasse/medt/`)
- PDF-Export aller Notizen mit bestimmten Hashtags, Seitenumbrüche im Editor sichtbar
- Bilder zuschneiden, nebeneinander anordnen, ohne Qualitätsverlust verkleinern
- Graph nach Hashtags, Spalten, Themes, Hell/Dunkel, Deutsch/Englisch
- iCloud für Mac und iPhone, optional Git-Backup

iPhone: [docs/iPhone-Installation.md](docs/iPhone-Installation.md) · Entwicklung: [docs/Entwicklung.md](docs/Entwicklung.md)

## Datenschutz

- **Ordo sammelt keine Daten:** keine Konten, keine Telemetrie, keine Analyse. Notizen bleiben in deinem Ordner (und in deiner iCloud, falls er dort liegt).
- **Verbindungen ins Internet** gibt es nur in diesen Fällen:
  - beim Öffnen einer Notiz, die Bilder aus dem Web verlinkt (der jeweilige Server sieht deine IP-Adresse),
  - wenn du die Theme-Liste unter Einstellungen › Darstellung öffnest (lädt von GitHub),
  - Git-Backup zu dem Server, den du selbst einträgst.
- Fotos, die du einfügst, verlieren ihren GPS-Standort.
- **Buy Me a Coffee:** Der Knopf öffnet die Seite im Browser; dort gelten deren Datenschutzregeln.

## Unterstützen

Ordo ist kostenlos. Wenn es dir hilft: [Buy Me a Coffee](https://buymeacoffee.com/suntinger).

## Lizenz

MIT – siehe [LICENSE](LICENSE). Ohne Gewährleistung und Haftung. Eingebaute Open-Source-Bibliotheken: [THIRD-PARTY-LICENSES.txt](THIRD-PARTY-LICENSES.txt).

## Impressum

Offenlegung gemäß § 25 MedienG: Gabriel Suntinger, Villach (Österreich). Privates, nicht kommerzielles Open-Source-Projekt. Kontakt: [GitHub-Issues](https://github.com/Kontaa5/Ordo/issues).

Ordo ist ein privates Projekt ohne Verbindung zu Apple. Apple, macOS, iPhone und iCloud sind Marken von Apple Inc.
