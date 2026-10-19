#!/usr/bin/env python3
"""Ordo demo vault: school notes with hashtags, links, code, math, columns and pictures.
Usage: python3 tools/demo/make_vault.py "<vault folder>"   (pictures: tools/demo/make_images.swift)"""
import json, os, sys

root = sys.argv[1]

notes = {
# ---------- no hashtag (graph: "Ohne Hashtag") ----------
"Willkommen.md": """# Willkommen in Ordo

Das ist ein **Demo-Vault**. Hier kannst du alles gefahrlos ausprobieren.

> [!tip] Zum Testen
> - **Hashtag → Ordner:** Schreib in [[Ideen]] den Hashtag `#serw` (ohne die Striche) – beim Verlassen wandert sie nach *Softwareentwicklung*.
> - **Graph:** ⌘G → oben *Global / Lokal*, im Dropdown z. B. *INSY* oder *Ohne Hashtag*.
> - **Bilder nebeneinander:** in [[Filmanalyse]] ein Bild auf ein anderes ziehen.
> - **Zuschneiden:** Bild anklicken › *Bearbeiten*. [[ER-Modell Konto]] nutzt ein Bild doppelt → wird als Kopie gespeichert.
> - **Absätze als Spalten:** in [[Notizen ohne Ordnung]] zwei Absätze markieren › Rechtsklick › *Nebeneinander*.
> - **Seitenumbrüche & PDF:** [[Erörterung Social Media]] › Rechtsklick auf den Tab › *Als PDF exportieren*.
> - **Bilder verkleinern:** in [[Filmanalyse]] Maus aufs große Foto › *Verkleinern* (zeigt Pixel und DPI vorher/nachher).
> - **Hashtag-Vorschlag:** `#ins` tippen, Tab drückt es zu `#INSY`.

Ordner-Regeln (Einstellungen › Ordner): `#serw` → Softwareentwicklung, `#4Klasse` und `#5sem` sind nur Schlagwörter.
""",
"Ideen.md": """# Ideen

- App für den Stundenplan
- Lerngruppe für Mathe organisieren
- [[Lernplan Matura]] überarbeiten
""",
"Einkaufsliste.md": """# Einkaufsliste

- [ ] Collegeblock
- [x] Textmarker
- [ ] Taschenrechner-Batterien
""",
"Lernplan Matura.md": """# Lernplan Matura

| Woche | Fach | Thema |
| --- | --- | --- |
| 1 | INSY | [[Aufgabe 13 - Transaktionen]] |
| 2 | Mathe | [[Integralrechnung]] |
| 3 | Deutsch | [[Erörterung Social Media]] |
| 4 | Wirtschaft | [[Bilanzanalyse]] |
""",
"Notizen ohne Ordnung.md": """# Notizen ohne Ordnung

Erster Absatz: Markiere diesen und den nächsten Absatz, dann Rechtsklick › *Nebeneinander (Spalten)*.

Zweiter Absatz: Danach stehen beide nebeneinander. Mit Rechtsklick › *Spalten auflösen* geht es zurück.

Dritter Absatz: Oder fahr mit der Maus links neben einen Absatz und zieh den Griff ⋮⋮ an den rechten Rand eines anderen Absatzes.
""",

# ---------- INSY ----------
"INSY/Aufgabe 01 - Normalformen.md": """#INSY #4Klasse

# Normalformen

| Normalform | Bedingung |
| --- | --- |
| 1NF | Alle Attribute atomar |
| 2NF | 1NF + keine partiellen Abhängigkeiten |
| 3NF | 2NF + keine transitiven Abhängigkeiten |

Siehe auch [[ER-Modell Konto]].
""",
"INSY/Aufgabe 13 - Transaktionen.md": """#INSY #4Klasse

# Lost Update

Zwei Sitzungen ändern gleichzeitig dasselbe Konto:

> [!multi-column]
>
>> [!blank]
>> **S1**
>> ```sql
>> BEGIN;
>> SELECT saldo FROM konten
>> WHERE konto_id = 1;  -- liest 1050
>> UPDATE konten SET saldo = saldo + 100
>> WHERE konto_id = 1;
>> COMMIT;
>> ```
>
>> [!blank]
>> **S2**
>> ```sql
>> BEGIN;
>> SELECT saldo FROM konten
>> WHERE konto_id = 1;  -- blockiert
>> UPDATE konten SET saldo = saldo + 50
>> WHERE konto_id = 1;
>> COMMIT;
>> ```

Lösung: [[Aufgabe 14 - Isolationsstufen]].
""",
"INSY/Aufgabe 14 - Isolationsstufen.md": """#INSY #4Klasse

# Isolationsstufen

> [!info] Merksatz
> Je höher die Stufe, desto weniger Anomalien – aber desto mehr Sperren.

1. Read Uncommitted
2. Read Committed
3. Repeatable Read
4. Serializable

Zurück zu [[Aufgabe 13 - Transaktionen]] · [[ACID]]
""",
"INSY/ACID.md": """#INSY

# ACID

- **A**tomicity
- **C**onsistency
- **I**solation → [[Aufgabe 14 - Isolationsstufen]]
- **D**urability
""",
"INSY/ER-Modell Konto.md": """#INSY #4Klasse

# ER-Modell Konto

![[ER-Diagramm.png|500]]

Das gleiche Bild wird in [[Datenbank Wiederholung]] verwendet – beim Zuschneiden wird deshalb eine Kopie gespeichert.
""",
"INSY/Datenbank Wiederholung.md": """#INSY

# Datenbank Wiederholung

![[ER-Diagramm.png|300]]

- [[Aufgabe 01 - Normalformen]]
- [[ACID]]
""",

# ---------- Softwareentwicklung (#serw → Softwareentwicklung) ----------
"Softwareentwicklung/Java Basics.md": """#serw #5sem

# Java Basics

```java
public class Main {
    public static void main(String[] args) {
        System.out.println("Hallo");
    }
}
```

Weiter mit [[OOP Muster]] und [[Streams]].
""",
"Softwareentwicklung/OOP Muster.md": """#serw #5sem

# OOP Muster

- Singleton
- Factory
- Observer → siehe [[Streams]]
""",
"Softwareentwicklung/Streams.md": """#serw

# Streams

```java
List<String> namen = personen.stream()
    .filter(p -> p.alter() >= 18)
    .map(Person::name)
    .toList();
```
""",
"Softwareentwicklung/Exceptions.md": """#serw

# Exceptions

> [!warning] Nie leer fangen
> `catch (Exception e) {}` versteckt Fehler.

Zurück zu [[Java Basics]].
""",

# ---------- Mathe (2. Hashtag = Unterordner) ----------
"Mathe/Analysis/Integralrechnung.md": """#mathe #analysis #4Klasse

# Integralrechnung

$$
\\int_a^b f(x)\\,dx = F(b) - F(a)
$$

Beispiel: $\\int_0^1 x^2\\,dx = \\tfrac{1}{3}$

Vorher: [[Ableitungen]]
""",
"Mathe/Analysis/Ableitungen.md": """#mathe #analysis #4Klasse

# Ableitungen

- $(x^n)' = n \\cdot x^{n-1}$
- $(\\sin x)' = \\cos x$
- Kettenregel: $(f(g(x)))' = f'(g(x)) \\cdot g'(x)$
""",
"Mathe/Statistik.md": """#mathe

# Statistik

Mittelwert: $\\bar{x} = \\frac{1}{n}\\sum_{i=1}^{n} x_i$
""",

# ---------- Wirtschaft und Recht ----------
"Wirtschaft und Recht/Doppik.md": """#Wirtschaft-Recht #4Klasse

# Doppik

Jeder Geschäftsfall wird **doppelt** gebucht: Soll an Haben.

Siehe [[Bilanzanalyse]] und [[Kostenrechnung]].
""",
"Wirtschaft und Recht/Bilanzanalyse.md": """#Wirtschaft-Recht #4Klasse

# Bilanzanalyse

| Kennzahl | Formel |
| --- | --- |
| Eigenkapitalquote | EK / GK |
| Liquidität 2. Grades | (UV − Vorräte) / kurzfr. FK |
""",
"Wirtschaft und Recht/Kostenrechnung.md": """#Wirtschaft-Recht

# Kostenrechnung

- Fixkosten
- Variable Kosten
- Deckungsbeitrag = Erlös − variable Kosten
""",

# ---------- Deutsch ----------
"Deutsch/Literatur Basics.md": """#Deutsch #4Klasse

# Literatur Basics

- Epik, Lyrik, Dramatik
- [[Erörterung Social Media]]
""",
"Deutsch/Erörterung Social Media.md": """---
tags: [schule, matura]
---
#Deutsch #4Klasse

# Erörterung: Social Media

Die Tags im Frontmatter (oben) bestimmen **keinen** Ordner – nur die Hashtags im Text.

## Einleitung

""" + "\n\n".join(["Soziale Netzwerke prägen den Alltag von Jugendlichen. " * 6] * 4) + """

\\pagebreak

## Hauptteil

""" + "\n\n".join(["Ein Argument dafür ist der schnelle Austausch, ein Argument dagegen der Druck durch ständige Erreichbarkeit. " * 5] * 6) + """

## Schluss

Abwägen statt verbieten.
""",

# ---------- Medienproduktion (Bilder) ----------
"Medienproduktion/Filmanalyse.md": """#Medienproduktion #4Klasse

# Filmanalyse

Drei Einstellungen nebeneinander (zieh eines auf ein anderes, um die Reihenfolge zu ändern):

![[Szene 1.jpg]] ![[Szene 2.jpg]] ![[Szene 3.jpg]]

Einzeln, auf 400 px skaliert:

![[Szene 2.jpg|400]]
""",
"Medienproduktion/Tafelbilder.md": """#Medienproduktion

# Tafelbilder

Vier Bilder in einer Zeile → 3 + 1:

![[Tafelbild 1.png]] ![[Tafelbild 2.png]] ![[Tafelbild 3.png]] ![[Tafelbild 4.png]]

Großes Foto (über 1 MB) zum Testen von *Große Bilder verkleinern*:

![[Klassenfoto groß.jpg]]
""",
}

# kept small on purpose: one or two notes per feature
KEEP = ["Willkommen.md", "Ideen.md", "Lernplan Matura.md", "Notizen ohne Ordnung.md",
        "INSY/Aufgabe 13 - Transaktionen.md", "INSY/ACID.md", "INSY/ER-Modell Konto.md", "INSY/Datenbank Wiederholung.md",
        "Softwareentwicklung/Java Basics.md", "Mathe/Analysis/Integralrechnung.md",
        "Deutsch/Erörterung Social Media.md", "Medienproduktion/Filmanalyse.md"]
FIX = {  # links to notes that are no longer part of the demo
    "[[Aufgabe 14 - Isolationsstufen]]": "[[ACID]]", "[[Aufgabe 01 - Normalformen]]": "[[Aufgabe 13 - Transaktionen]]",
    "Weiter mit [[OOP Muster]] und [[Streams]].": "Siehe auch [[Lernplan Matura]].", "Vorher: [[Ableitungen]]": "",
    "| 4 | Wirtschaft | [[Bilanzanalyse]] |\n": "",
}
notes["Medienproduktion/Filmanalyse.md"] += """
Großes Foto (über 1 MB) zum Testen von *Bilder verkleinern* (Maus aufs Bild › Verkleinern):

![[Klassenfoto groß.jpg]]
"""
notes = {k: v for k, v in notes.items() if k in KEEP}
for k in notes:
    for a, b in FIX.items(): notes[k] = notes[k].replace(a, b)

import re
for path, text in notes.items():
    # the file name is the title (shown above the text), so no extra "# Title" heading
    text = re.sub(r'(?m)^# [^\n]*\n\n?', '', text, count=1)
    full = os.path.join(root, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w") as f:
        f.write(text)

settings = {
    "allTagsAreFolders": False,
    "attachmentFolder": "Anhänge", "attachmentLocation": "folder", "attachmentSubfolderName": "Anhänge",
    "autoSort": True, "compressImages": True, "convertHEIC": True, "defaultMode": "edit", "editorFontSize": 16,
    "exportPresets": [], "linkStyle": "wiki", "maxImageDimension": 2400, "newNoteFolder": "",
    "page": {"fontSize": 11, "landscape": False, "marginMM": 20, "pageNumbers": True, "paper": "a4"},
    "readableLineWidth": True, "sortBaseFolder": "",
    "tagRules": {
        "serw": {"mode": "folderOnly", "folder": "Softwareentwicklung"},
        "insy": {"mode": "folderOnly", "folder": "INSY"},
        "wirtschaft-recht": {"mode": "folderOnly", "folder": "Wirtschaft und Recht"},
        "deutsch": {"mode": "folderOnly", "folder": "Deutsch"},
        "medienproduktion": {"mode": "folderOnly", "folder": "Medienproduktion"},
        "mathe": {"mode": "folderAndSubfolder", "folder": "Mathe"},
        "analysis": {"mode": "folderAndSubfolder", "folder": "Analysis"},
        "4klasse": {"mode": "ignore", "folder": ""},
        "5sem": {"mode": "ignore", "folder": ""},
    },
}
os.makedirs(os.path.join(root, ".ordo"), exist_ok=True)
with open(os.path.join(root, ".ordo", "settings.json"), "w") as f:
    json.dump(settings, f, ensure_ascii=False, indent=2)
print(len(notes), "Notizen")
