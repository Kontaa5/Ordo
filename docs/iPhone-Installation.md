# Ordo aufs iPhone bringen (kostenloser Apple-Account)

Mit einem kostenlosen Apple-Account läuft eine selbst installierte App **7 Tage**.
Danach muss sie neu signiert werden. Deine Notizen liegen in iCloud Drive und
bleiben dabei immer erhalten – es geht nur um die App selbst.

## Warum nicht einfach „aus dem Internet laden“ (EU)?

Seit iOS 17.4 erlaubt Apple in der EU alternative App-Marktplätze (z. B.
AltStore PAL) und Downloads von Websites. **Aber:** Dort laufen nur Apps, die
Apple vorher *notarisiert* hat – und das geht nur mit dem bezahlten
Entwickler-Account (99 €/Jahr). Ohne den bleibt nur das Signieren mit deiner
eigenen Apple-ID, also die 7-Tage-Variante unten.

---

## Einmalig vorbereiten

1. **iOS-Plattform in Xcode installieren:** Xcode › Settings › Components ›
   iOS 26.x › Get. (Fehlt aktuell – ohne sie kann nichts fürs iPhone gebaut werden.)
2. **Apple-ID in Xcode:** Xcode › Settings › Accounts › „+“ › Apple ID.
3. **Vault in iCloud Drive:** Dein Vault-Ordner muss in iCloud Drive liegen
   (z. B. `iCloud Drive/Obsidian/Schule`). Auf dem iPhone wählst du in Ordo
   „Vault öffnen“ und dann genau diesen Ordner.

---

## Variante A – automatisch erneuern (empfohlen): AltStore

AltStore signiert Ordo mit deiner Apple-ID und **erneuert es selbst im
Hintergrund**, solange dein Mac läuft und im selben WLAN ist.

1. **AltServer** von [altstore.io](https://altstore.io) auf dem Mac installieren und starten
   (erscheint oben in der Menüleiste).
2. iPhone per Kabel anschließen › AltServer-Symbol › *Install AltStore* › iPhone wählen.
3. Am iPhone: Einstellungen › Allgemein › VPN & Geräteverwaltung › deiner Apple-ID vertrauen.
   Außerdem Einstellungen › Datenschutz & Sicherheit › **Entwicklermodus** einschalten.
4. Ordo als Datei bauen – im Projektordner:
   ```bash
   tools/build-ipa.sh
   ```
   Ergebnis: `build.noindex/Ordo.ipa`
5. `Ordo.ipa` per AirDrop aufs iPhone schicken › „Öffnen in AltStore“
   (oder in AltStore › My Apps › „+“).
6. In AltServer (Menüleiste) **„Launch at Login“** aktivieren. Fertig: AltStore
   erneuert Ordo jetzt selbst, bevor die 7 Tage ablaufen.

Grenzen des kostenlosen Accounts: höchstens 3 selbst signierte Apps gleichzeitig
(AltStore zählt mit).

**Update von Ordo:** `tools/build-ipa.sh` erneut ausführen und die neue `.ipa`
wieder in AltStore öffnen – Einstellungen und Notizen bleiben.

---

## Variante B – ohne Zusatz-App: direkt aus Xcode

1. iPhone per Kabel anschließen.
2. `Ordo.xcodeproj` öffnen › Target *Ordo* › Signing & Capabilities ›
   Team: *(Dein Name) (Personal Team)*.
3. Oben als Ziel dein iPhone wählen › ▶︎ (Run).
4. Am iPhone einmalig: Entwickler vertrauen + Entwicklermodus (wie oben, Schritt 3).

Nach 7 Tagen startet die App nicht mehr – dann einfach wieder Schritt 1–3.

---

## Mit 99 €/Jahr (falls du später willst)

Mit dem Apple Developer Program hält die App 1 Jahr, TestFlight geht, und Ordo
könnte über AltStore PAL oder eine eigene Website in der EU verteilt werden.
