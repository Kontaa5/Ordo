# Ordo – Hinweise für KI-Assistenten

Lies das zuerst. Es beschreibt, wie der Besitzer arbeiten will, wie das Projekt läuft und was schon entschieden ist.
Bauen, Release und Aufbau stehen auch in [docs/Entwicklung.md](docs/Entwicklung.md).

## Wie ich arbeiten will

- **Antworten kurz, auf Deutsch, in Stichworten.** Keine langen Texte.
- **Immer als Checkliste berichten**, auch zwischendurch:
  🔄 mache gerade · ✅ erledigt (+ wie geprüft) · ⚠️ Problem (+ Ursache) · ⏳ offen / brauche dich · 🔒 Security (nach jeder Code-Änderung: was geprüft, was offen)
- **Nie „geht nicht“ ohne Prozentzahl.** Erst prüfen, dann behaupten. Sonst: „70 % sicher, weil …“ + wie man es prüfen würde.
- **Selbst testen statt mich fragen.** Nachstellen, Fix bauen, im Test-Vault beweisen.
- **Security ist extrem wichtig.** Ordo darf meinen Mac nie beschädigen (Details unten).
- **Keine SSH-/Remote-Befehle von selbst** (`ssh -T`, `git ls-remote`, clone/fetch/pull per SSH). Jeder Zugriff löst Touch ID aus (Secretive).
  - Pushen nur, wenn ich es sage: einmal, ohne Zusatzprüfungen.
  - Prüfen über öffentliches HTTPS (`curl https://raw.githubusercontent.com/…`).
- **Nie Schlüsselbund, Passwörter oder Systemeinstellungen anfassen**, auch keine Abfrage, die ein Passwort-Popup auslöst.
- **Keine Endlosschleifen / kein Polling**, wenn es ein Ereignis gibt (Dateimeldung, App wird aktiv). Performance zählt.
- Wenn ich „push“ sage: committen + pushen. Wenn ich die neue Version testen will: Release machen (siehe unten). Ich update dann per brew, oder du machst `brew update && echo y | brew upgrade --cask ordo`.

## Wie ich Ordo nutze

- **Mac: Ordo** (wegen Hashtag-Sortierung und meinen Verbesserungen). **iPhone: Obsidian.**
- Die iPhone-Version von Ordo ist auf Jahre nicht relevant (kein Apple-Developer-Account). Dafür nichts bauen, aber auch nichts kaputt machen (`#if os(iOS)` bleibt).
- Mein Vault liegt im iCloud-Ordner von Obsidian, Git-Sync zu einem privaten GitHub-Repo.
- **Nie meinen echten Vault zum Testen verwenden.** Immer einen Test-Vault im Scratch-/Temp-Ordner anlegen (siehe Testen).

## Verhalten, das so gewollt ist (nicht zurückbauen)

**Hashtag → Ordner (Auto-Sortierung)**
- 3 s nach dem letzten Tastendruck wandert eine Notiz in den Ordner ihres Hashtags. Das gilt auch, wenn der Cursor noch direkt hinter dem Tag steht. (`scheduleSort` in `web/src/app/views/markdown.ts`, Anfrage `sort`)
- Beim Speichern selbst wird nicht verschoben, solange der Cursor im Tag steht. So wandert eine halb getippte Notiz nicht schon unterwegs.
- **Von Hand verschoben ⇒ kein 📌.** Die Notiz bleibt trotzdem liegen, bis sich ihr Hashtag ändert (`moveNote(manual:)` merkt sich den aktuellen Tag).
- In der Statusleiste steht **kein** „📌 festgepinnt“. Der Pin ist nur noch in der Dateiliste und im Kontextmenü zu sehen.

**Git-Sync (nur Mac)**
- Das Repository liegt außerhalb von iCloud (Application Support, `--git-dir`). Der Vault ist nur der Work-Tree.
- **Kein Polling.** Der Status wird geprüft: 2 s nach einer Dateiänderung (gebündelt) und wenn Ordo nach vorne kommt.
- „Einmal am Tag hochladen“ (Einstellung `gitDailyUpload`): höchstens ein Versuch pro Kalendertag, geprüft beim Start und beim Aktivieren.
- **Erst committen. Pushen nur, wenn der Server etwas noch nicht hat.** Gibt es nichts zu pushen, gibt es auch keinen Push, keine Touch-ID-Abfrage und die Meldung „Nichts Neues“.
- Status-Punkt: **grün** = nichts offen (egal wie lange her) · **orange** = Änderungen nicht gesichert/hochgeladen · **rot** = Fehler oder noch nie hochgeladen.
- Beim Beenden während eines Uploads: Ordo fragt nach.

**Vault laden**
- `refresh()` verwirft parallele Aufrufe nicht, sondern wartet und scannt danach noch einmal.
- Die Anfrage `index` wartet auf den ersten Scan (`untilLoaded`). Sonst baut die Oberfläche auf einer leeren Liste auf und verwirft offene Tabs.
- Mac: keine Abfrage-Schleife, nur FSEvents (`FileWatcher`). Die 30-s-Schleife läuft nur, wenn der Watcher nicht startet. iOS fragt alle 3 s ab (bewusst so gelassen).

## Security-Regeln (gelten für jede Änderung)

- Fremde oder Notiz-Daten nie ungeprüft in HTML (`innerHTML`), Shell, `eval` oder SQL.
  - Markdown → `sanitize()` (DOMPurify) in `web/src/markdown.ts`.
  - Eigenes HTML immer mit `esc()`.
- Pfade aus der Oberfläche oder aus Vault-Daten **immer** über `VaultStore.url()`. Diese Funktion entfernt `..`, sperrt versteckte Ordner (`.obsidian`, `.git`, `.ordo`, `.trash`) und Symlinks, die aus dem Vault herausführen.
- Vault-Dateien sind Daten, nie Code:
  - `SchemeHandler` liefert HTML und Skripte als `text/plain` aus, mit CSP-Sandbox.
  - Die CSP der App-Seite erlaubt Skripte nur von `ordo://local/app/`.
- Nur die App-Seite selbst darf die Bridge benutzen (`isMainFrame` + `isAppPage`).
- Nach außen öffnen: nur `http`, `https`, `mailto` (`openExternal`). Netzwerk-Download nur von `raw.githubusercontent.com` (Themes).
- Git:
  - Remote nur über `GitSync.isValidRemote` (kein `-…`, kein `ext::`).
  - Immer `GIT_TERMINAL_PROMPT=0` und SSH im `BatchMode`.
  - Konfliktkopien nur innerhalb des Vaults.
- Nichts endgültig löschen. Alles geht in `.trash` bzw. in den System-Papierkorb (wiederherstellbar).
- Debug-Hilfen nur in `#if DEBUG`.

## Testen (so beweist du, dass es geht)

```bash
# Debug-Build
xcodebuild -project Ordo.xcodeproj -scheme Ordo -configuration Debug -destination 'platform=macOS' -derivedDataPath build.noindex/dd build
# Unit-Tests
xcodebuild -project Ordo.xcodeproj -scheme OrdoTests -destination 'platform=macOS' -derivedDataPath build.noindex/dd test
# Oberfläche nach Änderungen in web/src
cd web && npm run build
```

App automatisiert prüfen, mit einem **Test-Vault**, nie dem echten:

```bash
ORDO_DEBUG_SCRIPT=/pfad/steps.json build.noindex/dd/Build/Products/Debug/Ordo.app/Contents/MacOS/Ordo --vault /pfad/TestVault
```

- `steps.json` = `[{"js": "...", "wait": 2, "snap": "name"}]`.
  - JS läuft im Seiten-Kontext; `window.ordo.debug` bietet `request`, `vault`, `workspace()`, `getActiveMarkdownView()`.
  - Ergebnisse landen als `DBG …` in stdout, Screenshots neben der Datei.
- `--vault` merkt sich den Ordner nicht (überschreibt nicht den zuletzt geöffneten Vault).
- Einstellungen des Test-Vaults: `.ordo/settings.json`, z. B. `{"autoSort": true, "tagRules": {"sew": {"folder": "Softwareentwicklung", "mode": "folderAndSubfolder"}}}`.
- Git testen nur mit lokalem Remote (`git init --bare …`), nie per SSH. Danach die Test-Repos in `~/Library/Application Support/Ordo/git/` wieder löschen.
- Hinweis: In zsh ist `log` ein Builtin, für Systemlogs also `/usr/bin/log show …` verwenden.

## Release (damit ich per brew testen kann)

```bash
tools/release.sh 0.1.12        # baut, Zip auf Branch "releases", Cask-Version + sha256
git add Casks/ordo.rb project.yml Ordo.xcodeproj Ordo/Resources/Web && git commit -m "Ordo 0.1.12" && git push
```

- Vorher die eigentliche Änderung als eigenen Commit.
- Prüfen über HTTPS: `curl -sI https://raw.githubusercontent.com/Kontaa5/Ordo/releases/Ordo-<v>.zip`.
- Der Tap wird über HTTPS geholt. Falls brew noch die alte Version anbietet: `n`, kurz warten, `brew update` nochmal.

## Commits

- Commit-Messages auf Deutsch: kurze Zeile, was und warum.
- Nicht mitcommitten: gelöschte Dateien unter `Ordo Demo/` (lokal, absichtlich).

## Verlauf (zuletzt)

- 0.1.8: Vault beim Start nicht mehr leer (Scan-Race), Auto-Sortierung 3 s nach dem Tippen, kein Pin beim Verschieben von Hand
- 0.1.9: „festgepinnt“ aus der Statusleiste raus, Git-Punkt grün, wenn nichts offen ist
- 0.1.10: Git-Status ereignisgesteuert statt jede Minute, kein Push, wenn nichts hochzuladen ist
- 0.1.11: Mac ohne Abfrage-Schleife, Skripte nur aus der App (CSP), leerer Papierkorb-Name abgefangen
