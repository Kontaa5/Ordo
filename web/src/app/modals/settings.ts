// Settings modal in Obsidian's layout (.mod-settings, .vertical-tab-*, .setting-item).

import { Modal } from '../ui/modal';
import { h, icon, iconButton } from '../dom';
import { vault } from '../store';
import { request, emit, on, isMac } from '../host';
import { gitStatus, gitSyncNow, gitPullNow, when, GitStatus } from '../git';
import { appState } from '../state';
import { notice } from '../ui/notice';
import { getScheme, setScheme, getZoom, setZoom, appearance, saveAppearance, applyAll, applyAccent, applyFonts, applyTheme, applySnippets, applyStyleSettings, communityThemes, installCommunityTheme, CommunityTheme } from '../appearance';
import { executeCommand, getCommands, hotkeysFor, displayHotkey, setHotkey, eventCombo, Hotkey, Modifier } from '../commands';
import { TagRuleModal } from './tagRule';
import { SortAllModal } from './sortAll';
import { setting } from './tagRule';

import { t, lang, setLang, Lang } from '../i18n';
type Tab = { id: string; name: string; group: string; render: (el: HTMLElement) => void | Promise<void> };

export class SettingsModal extends Modal {
  private nav = h('div', { cls: 'vertical-tab-header' });
  private content = h('div', { cls: 'vertical-tab-content' });
  private tabs: Tab[];
  private active: string;
  private onCloseHooks: (() => void)[] = [];
  onClose() { this.onCloseHooks.forEach(f => f()); }

  constructor(start = 'general') {
    super('mod-settings mod-sidebar-layout');
    this.modalEl.replaceChildren(
      h('div', { cls: 'modal-close-button', onclick: () => this.close() }, icon('x')),
      h('div', { cls: 'vertical-tabs-container' }, this.nav, h('div', { cls: 'vertical-tab-content-container' }, this.content)));
    this.tabs = [
      { id: 'general', name: t('Allgemein'), group: t('Optionen'), render: el => this.general(el) },
      { id: 'editor', name: t('Editor'), group: t('Optionen'), render: el => this.editor(el) },
      { id: 'files', name: t('Dateien & Links'), group: t('Optionen'), render: el => this.files(el) },
      { id: 'folders', name: t('Ordner-Automatik'), group: t('Optionen'), render: el => this.folders(el) },
      { id: 'appearance', name: t('Darstellung'), group: t('Optionen'), render: el => this.appearance(el) },
      { id: 'hotkeys', name: t('Tastenkürzel'), group: t('Optionen'), render: el => this.hotkeys(el) },
      { id: 'pdf', name: t('Seite & PDF'), group: t('Optionen'), render: el => this.pdf(el) },
      ...(isMac ? [{ id: 'git', name: t('Git-Sync'), group: t('Optionen'), render: (el: HTMLElement) => this.git(el) }] : []),
    ];
    this.active = start;
    const group = h('div', { cls: 'vertical-tab-header-group' }, h('div', { cls: 'vertical-tab-header-group-title', text: t('Optionen') }));
    const items = h('div', { cls: 'vertical-tab-header-group-items' });
    for (const t of this.tabs) items.appendChild(h('div', { cls: 'vertical-tab-nav-item', 'data-tab': t.id, text: t.name, onclick: () => this.show(t.id) }));
    group.appendChild(items);
    this.nav.appendChild(group);
    this.show(start);
  }

  private show(id: string) {
    this.active = id;
    this.nav.querySelectorAll('.vertical-tab-nav-item').forEach(n => n.classList.toggle('is-active', (n as HTMLElement).dataset.tab === id));
    this.content.replaceChildren();
    this.content.scrollTop = 0;
    this.tabs.find(t => t.id === id)?.render(this.content);
  }
  private refresh() { const s = this.content.scrollTop; this.show(this.active); this.content.scrollTop = s; }

  // ---------- controls ----------

  private toggle(value: boolean, onChange: (v: boolean) => void) {
    const el = h('div', { cls: 'checkbox-container' + (value ? ' is-enabled' : '') });
    el.addEventListener('click', () => { const v = !el.classList.contains('is-enabled'); el.classList.toggle('is-enabled', v); onChange(v); });
    return el;
  }
  private dropdown(options: [string, string][], value: string, onChange: (v: string) => void) {
    const s = h('select', { cls: 'dropdown' }, ...options.map(([v, l]) => h('option', { value: v, text: l, selected: v === value })));
    s.addEventListener('change', () => onChange(s.value));
    return s;
  }
  private text(value: string, placeholder: string, onChange: (v: string) => void, list?: string) {
    const i = h('input', { type: 'text', value, placeholder, spellcheck: 'false', list });
    i.addEventListener('change', () => onChange(i.value.trim()));
    return i;
  }
  private heading(el: HTMLElement, title: string) { el.appendChild(h('div', { cls: 'setting-item setting-item-heading' }, h('div', { cls: 'setting-item-info' }, h('div', { cls: 'setting-item-name', text: title })))); }
  private folderOptions(): [string, string][] { return [['', t('Hauptordner (/)')], ...[...vault.folders].sort().map(f => [f, f] as [string, string])]; }
  private save(patch: any) { return vault.saveSettings(patch); }

  // ---------- tabs ----------

  private general(el: HTMLElement) {
    el.append(
      setting(t('Sprache'), t('Sprache der Oberfläche (pro Gerät). Deine Notizen werden nie übersetzt.'),
        this.dropdown([['de', 'Deutsch'], ['en', 'English']], lang, v => { setLang(v as Lang); request('setLanguage', { lang: v }).catch(() => {}); location.reload(); })),
      setting(t('Vault'), vault.path, h('button', { text: t('Anderen Vault öffnen …'), onclick: () => { this.close(); emit('show-vault-picker'); } })),
      setting(t('Im Finder zeigen'), t('Öffnet den Vault-Ordner.'), h('button', { text: t('Öffnen'), onclick: () => request('reveal', { path: '' }) })),
      setting(t('Parallel mit Obsidian'), t('Ordo liest dieselben Markdown-Dateien wie Obsidian und schreibt nie in den .obsidian-Ordner. Themes, Snippets und Darstellung werden von Obsidian übernommen.')),
      setting(t('Ordo'), t('Notizen in Markdown, die sich nach Hashtags selbst einsortieren.')),
    );
  }

  private editor(el: HTMLElement) {
    const s = vault.settings;
    el.append(
      setting(t('Standardansicht für neue Tabs'), t('Neue Notizen öffnen sich immer im Bearbeiten-Modus.'),
        this.dropdown([['edit', t('Bearbeiten (Live-Vorschau)')], ['read', t('Lesen')]], s.defaultMode, v => this.save({ defaultMode: v }))),
      setting(t('Lesbare Zeilenlänge'), t('Begrenzt die Zeilenbreite für bessere Lesbarkeit.'), this.toggle(s.readableLineWidth, v => this.save({ readableLineWidth: v }))),
      setting(t('Rechtschreibprüfung'), t('Wirkt für neu geöffnete Notizen.'), this.toggle(appState.spellcheck, v => { appState.spellcheck = v; })),
      setting(t('Seitenumbrüche anzeigen'), t('Zeigt, wo beim PDF-Export eine neue Seite beginnt. Die Linie lässt sich nach oben ziehen; \\pagebreak erzwingt einen Umbruch.'),
        this.toggle(appState.showPageBreaks, v => { appState.showPageBreaks = v; })),
    );
  }

  private files(el: HTMLElement) {
    const s = vault.settings;
    el.append(
      setting(t('Speicherort für neue Notizen'), t('Wird eine Notiz mit Hashtags versehen, wandert sie automatisch in ihren Ordner.'),
        this.dropdown(this.folderOptions(), s.newNoteFolder, v => this.save({ newNoteFolder: v }))));
    el.append(setting(t('Papierkorb leeren nach'), t('Gelöschte Notizen und Bilder bleiben so lange im Papierkorb (Symbol unten neben ⚙) und werden dann endgültig gelöscht.'),
      this.dropdown([['7', t('7 Tagen')], ['30', t('30 Tagen')], ['90', t('90 Tagen')], ['0', t('nie')]], String(s.trashDays ?? 30), v => this.save({ trashDays: +v }).then(() => emit('trash-changed')))));
    this.heading(el, t('Bilder & Anhänge'));
    el.append(
      setting(t('Ablage für Anhänge'), t('Wohin eingefügte Fotos und Dateien gespeichert werden.'),
        this.dropdown([['folder', t('In einem festen Ordner')], ['besideNote', t('Im Ordner der Notiz')], ['subfolderOfNote', t('In einem Unterordner neben der Notiz')]], s.attachmentLocation, v => { this.save({ attachmentLocation: v }).then(() => this.refresh()); })));
    if (s.attachmentLocation === 'folder') {
      el.append(setting(t('Anhang-Ordner'), t('Jedes Foto kommt in diesen Ordner.'), this.text(s.attachmentFolder, t('Anhänge'), v => this.save({ attachmentFolder: v }), 'ordo-settings-folders')));
    } else if (s.attachmentLocation === 'subfolderOfNote') {
      el.append(setting(t('Name des Unterordners'), '', this.text(s.attachmentSubfolderName, t('Anhänge'), v => this.save({ attachmentSubfolderName: v }))));
    }
    el.append(
      h('datalist', { id: 'ordo-settings-folders' }, ...[...vault.folders].sort().map(f => h('option', { value: f }))),
      setting(t('Link-Format'), t('Wie eingefügte Bilder verlinkt werden.'), this.dropdown([['wiki', t('Wikilink  ![[bild.png]]')], ['markdown', t('Markdown  ![](bild.png)')]], s.linkStyle, v => this.save({ linkStyle: v }))),
      setting(t('Fotos verkleinern'), t('Große Handyfotos werden beim Einfügen verkleinert (spart iCloud-Speicher).'),
        this.dropdown([['0', t('Originalgröße')], ['1600', '1600 px'], ['2400', '2400 px'], ['3200', '3200 px']], String(s.maxImageDimension), v => this.save({ maxImageDimension: +v }))),
      setting(t('HEIC in JPEG umwandeln'), t('iPhone-Fotos werden überall lesbar (auch in Obsidian unter Windows).'), this.toggle(s.convertHEIC, v => this.save({ convertHEIC: v }))),
      setting(t('Große Bilder komprimieren'), t('Bilder über 1 MB werden beim Einfügen platzsparend neu gespeichert (spart iCloud- und iPhone-Speicher).'), this.toggle(s.compressImages ?? true, v => this.save({ compressImages: v }))),
      setting(t('Vorhandene Bilder verkleinern'), t('Bilder über 1 MB, die schon im Vault liegen. Dateinamen und Links bleiben gleich.'), h('button', { text: t('Prüfen …'), onclick: () => executeCommand('ordo:compress-images') })),
    );
  }

  private folders(el: HTMLElement) {
    const s = vault.settings;
    el.append(
      setting(t('Notizen nach Hashtags einsortieren'), t('Der 1. Ordner-Hashtag ist der Ordner, der 2. der Unterordner (#4klasse #medt → 4klasse/medt). Ohne Ordner-Hashtag wandert die Notiz beim Verlassen zurück in den Basisordner. Von Hand verschobene Notizen bleiben, wo sie sind.'),
        this.toggle(s.autoSort, v => this.save({ autoSort: v }))),
      setting(t('Jeder Hashtag wird ein Ordner'), t('Aus: nur die unten eingetragenen Hashtags werden zu Ordnern – alle anderen (#4sem, #wichtig …) bleiben Schlagwörter.'),
        this.toggle(s.allTagsAreFolders, v => this.save({ allTagsAreFolders: v }).then(() => this.refresh()))),
      setting(t('Basisordner'), t('Alle Hashtag-Ordner entstehen darunter (leer = Hauptordner).'), this.dropdown(this.folderOptions(), s.sortBaseFolder, v => this.save({ sortBaseFolder: v }))),
      setting(t('Jetzt einsortieren'), t('Zeigt vorher, welche Notizen wohin wandern.'), h('button', { cls: 'mod-cta', text: t('Alle Notizen einsortieren …'), onclick: () => new SortAllModal().open() })),
    );
    this.heading(el, t('Hashtags → Ordner'));
    const rules = Object.entries(s.tagRules).sort(([a], [b]) => a.localeCompare(b, 'de'));
    for (const [tag, rule] of rules) {
      const desc = rule.mode === 'ignore' ? t('kein Ordner') : `→ ${rule.folder || tag}${rule.mode === 'folderOnly' ? t(' (ohne Unterordner)') : ''}`;
      el.append(setting('#' + tag, desc,
        iconButton('pencil', t('Bearbeiten'), () => { const m = new TagRuleModal(tag); m.onClose = () => this.refresh(); m.open(); }),
        iconButton('trash', t('Entfernen'), async () => { const r = { ...vault.settings.tagRules }; delete r[tag]; await this.save({ tagRules: r }); this.refresh(); })));
    }
    if (!rules.length) el.append(h('div', { cls: 'setting-item-description ordo-pad', text: t('Noch keine Regeln. Beispiel: #serw → Softwareentwicklung, #4sem → kein Ordner.') }));
    el.append(setting('', '', h('button', { cls: 'mod-cta', text: t('Hashtag-Regel hinzufügen …'), onclick: () => { const m = new TagRuleModal(''); m.onClose = () => this.refresh(); m.open(); } })));
  }

  private async appearance(el: HTMLElement) {
    const persist = () => saveAppearance();
    el.append(
      setting(t('Farbschema'), t('Hell, dunkel oder wie das System.'), this.dropdown([['system', t('Wie System')], ['light', t('Hell')], ['dark', t('Dunkel')]], getScheme(), v => setScheme(v as any))),
      setting(t('Zoom'), t('Größe der ganzen Oberfläche.'), (() => {
        const r = h('input', { type: 'range', min: '0.8', max: '1.2', step: '0.05', value: String(getZoom()), cls: 'slider' });
        const out = h('span', { cls: 'ordo-zoom-value', text: Math.round(getZoom() * 100) + ' %' });
        r.addEventListener('input', () => { out.textContent = Math.round(+r.value * 100) + ' %'; });
        r.addEventListener('change', () => setZoom(+r.value));
        return h('div', { cls: 'ordo-row' }, out, r);
      })()),
      setting(t('Akzentfarbe'), t('Farbe für Links, Auswahl, Buttons.'), (() => {
        const c = h('input', { type: 'color', value: appearance.accentColor || '#7c5cff' });
        c.addEventListener('input', () => { appearance.accentColor = c.value; applyAccent(); });
        c.addEventListener('change', persist);
        const reset = iconButton('reset', t('Zurücksetzen'), () => { appearance.accentColor = ''; applyAccent(); persist(); this.refresh(); });
        return h('div', { cls: 'ordo-row' }, reset, c);
      })()),
    );
    this.heading(el, t('Themes'));
    const themes = await request<{ name: string; source: string }[]>('themes').catch(() => []);
    el.append(
      setting(t('Theme'), themes.length ? t('Aus deinem Obsidian-Vault (.obsidian/themes) und Ordo (.ordo/themes).') : t('Keine Themes installiert – durchsuche die Community-Themes.'),
        this.dropdown([['', t('Standard')], ...themes.map(t => [t.name, t.name + (t.source === 'obsidian' ? ' (Obsidian)' : '')] as [string, string])], appearance.cssTheme, async v => {
          appearance.cssTheme = v; await applyTheme(); await applyStyleSettings(); persist();
        }),
        h('button', { text: t('Durchsuchen …'), onclick: () => new ThemeBrowser(() => this.refresh()).open() })),
    );
    this.heading(el, t('CSS-Snippets'));
    const snippets = await request<string[]>('snippets').catch(() => []);
    el.append(setting(t('Snippets'), t('Eigene CSS-Dateien aus .obsidian/snippets und .ordo/snippets.'),
      iconButton('refresh', t('Neu laden'), async () => { await applySnippets(); this.refresh(); }),
      iconButton('folder-open', t('Snippet-Ordner öffnen'), () => request('openSnippetsFolder'))));
    for (const sn of snippets) {
      el.append(setting(sn, '', this.toggle(appearance.enabledCssSnippets.includes(sn), async v => {
        appearance.enabledCssSnippets = v ? [...appearance.enabledCssSnippets, sn] : appearance.enabledCssSnippets.filter(x => x !== sn);
        await applySnippets(); persist();
      })));
    }
    this.heading(el, t('Schrift'));
    const fonts = await request<string[]>('fonts').catch(() => []);
    const fontInput = (key: 'interfaceFontFamily' | 'textFontFamily' | 'monospaceFontFamily', ph: string) =>
      this.text(appearance[key], ph, v => { appearance[key] = v; applyFonts(); persist(); }, 'ordo-font-list');
    el.append(
      h('datalist', { id: 'ordo-font-list' }, ...fonts.map(f => h('option', { value: f }))),
      setting(t('Oberflächenschrift'), t('Schrift der Oberfläche (leer = Theme-Standard).'), fontInput('interfaceFontFamily', 'z. B. Inter')),
      setting(t('Textschrift'), t('Schrift im Editor und im Lesemodus.'), fontInput('textFontFamily', 'z. B. Inter')),
      setting(t('Monospace-Schrift'), t('Für Code und Eigenschaften.'), fontInput('monospaceFontFamily', 'z. B. SF Mono')),
      setting(t('Schriftgröße'), `${appearance.baseFontSize} px`, (() => {
        const r = h('input', { type: 'range', min: '10', max: '30', step: '1', value: String(appearance.baseFontSize), cls: 'slider' });
        r.addEventListener('input', () => { appearance.baseFontSize = +r.value; applyFonts(); (r.closest('.setting-item')!.querySelector('.setting-item-description') as HTMLElement).textContent = `${r.value} px`; });
        r.addEventListener('change', persist);
        return r;
      })()),
    );
  }

  private hotkeys(el: HTMLElement) {
    const filter = h('input', { type: 'search', placeholder: t('Befehl suchen …'), cls: 'ordo-hotkey-filter' });
    const list = h('div');
    const render = () => {
      const q = filter.value.toLowerCase();
      list.replaceChildren(...getCommands().filter(c => !q || c.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name, 'de')).map(cmd => {
        const keys = hotkeysFor(cmd.id);
        const ctl = h('div', { cls: 'setting-command-hotkeys' },
          ...keys.map((k, i) => h('span', { cls: 'setting-hotkey' }, displayHotkey(k),
            h('span', { cls: 'setting-hotkey-icon setting-delete-hotkey', 'aria-label': t('Entfernen'), onclick: () => { const next = keys.filter((_, j) => j !== i); setHotkey(cmd.id, next); saveAppearance(); render(); } }, icon('x', 12)))),
          iconButton('plus', t('Tastenkürzel festlegen'), () => record(cmd.id, ctl)),
          iconButton('reset', t('Standard'), () => { setHotkey(cmd.id, null); saveAppearance(); render(); }));
        return setting(cmd.name, '', ctl);
      }));
    };
    const record = (id: string, ctl: HTMLElement) => {
      const tag = h('span', { cls: 'setting-hotkey mod-active', text: t('Taste drücken …') });
      ctl.prepend(tag);
      const onKey = (e: KeyboardEvent) => {
        e.preventDefault(); e.stopPropagation();
        if (e.key === 'Escape') { done(); render(); return; }
        const combo = eventCombo(e);
        if (!combo || ['Shift', 'Alt'].includes(combo)) return;
        const parts = combo.split('+');
        const key = parts.pop()!;
        if (!parts.length) return;
        const hk: Hotkey = { modifiers: parts as Modifier[], key };
        setHotkey(id, [...hotkeysFor(id), hk]);
        saveAppearance();
        done(); render();
      };
      const done = () => document.removeEventListener('keydown', onKey, true);
      document.addEventListener('keydown', onKey, true);
    };
    filter.addEventListener('input', render);
    el.append(filter, list);
    render();
  }

  private git(el: HTMLElement) {
    const s = vault.settings;
    el.append(h('p', { cls: 'setting-item-description', text: t('Zusätzlich zu iCloud: ein Verlauf deiner Notizen als Backup in einem Git-Repository (z. B. privat auf GitHub). Gesichert werden nur Änderungen. Die Git-Daten liegen lokal auf diesem Mac, nicht in iCloud – keine Datei liegt doppelt.') }));
    el.append(setting(t('Git-Sync verwenden'), t('Nur auf dem Mac. Das iPhone bekommt alles weiter über iCloud.'), this.toggle(!!s.gitEnabled, v => this.save({ gitEnabled: v }).then(() => this.refresh()))));
    if (!s.gitEnabled) return;
    const remote = this.text(s.gitRemote ?? '', 'git@github.com:name/notizen.git', v => this.save({ gitRemote: v.trim() }));
    const result = h('div', { cls: 'setting-item-description ordo-git-test' });
    const test = h('button', { text: t('Verbindung testen'), onclick: async () => {
      result.textContent = t('Teste …');
      const r = await request<{ ok: boolean; message: string }>('gitTest', { remote: (remote as HTMLInputElement).value }).catch(e => ({ ok: false, message: String(e) }));
      result.textContent = r.ok ? t('✓ Verbindung klappt.') : r.message;
      result.classList.toggle('is-error', !r.ok);
    } });
    el.append(setting(t('Repository-Adresse'), t('Leeres, privates Repository anlegen und die SSH-Adresse hier eintragen.'), h('div', { cls: 'ordo-git-remote' }, remote, test)), result);
    el.append(h('p', { cls: 'setting-item-description', text: t('Ordo lädt nie von selbst hoch oder herunter – nur mit „Sichern & hochladen“ bzw. „Holen“ (hier oder über den Punkt unten in der Statusleiste). Gleich geänderte Notizen gehen beim Holen nicht verloren: die andere Version landet als „Name (Konflikt)“ daneben.') }));
    const status = h('div', { cls: 'setting-item-description' });
    const show = (st: GitStatus) => {
      status.textContent = st.state === 'nogit' ? t('Git ist auf diesem Mac nicht installiert. Im Terminal „xcode-select --install“ ausführen.')
        : t('Zuletzt gesichert: {c} · hochgeladen: {p} · geholt: {l}', { c: when(st.lastCommit), p: when(st.lastPush), l: when(st.lastPull) })
          + (st.state === 'error' && st.message ? '\n⚠ ' + st.message : '');
    };
    show(gitStatus);
    const off = on('git-status', show);
    this.onCloseHooks.push(off);
    el.append(setting(t('Jetzt'), '', h('div', { cls: 'ordo-git-remote' },
      h('button', { cls: 'mod-cta', text: t('Sichern & hochladen'), onclick: () => gitSyncNow() }),
      h('button', { text: t('Holen'), onclick: () => gitPullNow() }))), status);
    el.append(h('details', { cls: 'ordo-git-help' }, h('summary', { text: t('Anmeldung bei GitHub einrichten') }),
      h('p', { text: t('Ordo nutzt die Git-Anmeldung deines Macs und speichert selbst keine Passwörter. Am einfachsten mit der GitHub CLI: im Terminal „brew install gh“ und „gh auth login“ (SSH wählen). Danach ein privates, leeres Repository anlegen und dessen SSH-Adresse oben eintragen.') })));
  }

  private pdf(el: HTMLElement) {
    const p = vault.settings.page;
    const upd = (patch: any) => this.save({ page: { ...vault.settings.page, ...patch } }).then(() => emit('page-breaks-changed'));
    const num = (val: number, min: number, max: number, step: number, f: (v: number) => void) => {
      const i = h('input', { type: 'number', value: String(val), min: String(min), max: String(max), step: String(step), cls: 'ordo-number' });
      i.addEventListener('change', () => f(Math.max(min, Math.min(max, +i.value || val))));
      return i;
    };
    el.append(
      setting(t('Papierformat'), t('Bestimmt auch, wo die Seitenumbrüche im Editor angezeigt werden.'), this.dropdown([['a4', 'A4'], ['a5', 'A5'], ['letter', t('US Letter')]], p.paper, v => upd({ paper: v }))),
      setting(t('Querformat'), '', this.toggle(p.landscape, v => upd({ landscape: v }))),
      setting(t('Ränder (mm)'), '', num(p.marginMM, 5, 40, 1, v => upd({ marginMM: v }))),
      setting(t('Schriftgröße (pt)'), '', num(p.fontSize, 8, 18, 0.5, v => upd({ fontSize: v }))),
      setting(t('Seitenzahlen'), '', this.toggle(p.pageNumbers, v => upd({ pageNumbers: v }))),
    );
    this.heading(el, t('Export-Vorlagen'));
    const presets = vault.settings.exportPresets ?? [];
    if (!presets.length) el.append(h('div', { cls: 'setting-item-description ordo-pad', text: t('Im Export-Dialog „Als Vorlage sichern“ – dann hier verwalten.') }));
    for (const pr of presets) {
      el.append(setting(pr.name, pr.tags.map(t => '#' + t).join(' ') + (pr.combined ? t(' · eine PDF') : t(' · eine PDF pro Notiz')),
        h('button', { text: t('Exportieren'), onclick: () => { this.close(); emit('export', { preset: pr }); } }),
        iconButton('trash', t('Löschen'), async () => { await this.save({ exportPresets: presets.filter(x => x.id !== pr.id) }); this.refresh(); })));
    }
  }
}

class ThemeBrowser extends Modal {
  constructor(private done: () => void) { super('ordo-theme-browser'); this.setTitle(t('Community-Themes')); }
  async onOpen() {
    const search = h('input', { type: 'search', placeholder: t('Theme suchen …') });
    const grid = h('div', { cls: 'ordo-theme-grid' });
    this.contentEl.append(search, grid);
    grid.textContent = t('Lade Liste …');
    let list: CommunityTheme[] = [];
    try { list = await communityThemes(); } catch (e) { grid.textContent = t('Konnte die Theme-Liste nicht laden (Internet?).'); return; }
    const installed = new Set((await request<{ name: string }[]>('themes').catch(() => [])).map(t => t.name));
    const render = () => {
      const q = search.value.toLowerCase();
      grid.replaceChildren(...list.filter(th => !q || th.name.toLowerCase().includes(q) || th.author.toLowerCase().includes(q)).slice(0, 120).map(th => {
        const btn = h('button', { cls: installed.has(th.name) ? '' : 'mod-cta', text: installed.has(th.name) ? t('Verwenden') : t('Installieren') });
        btn.addEventListener('click', async () => {
          try {
            if (!installed.has(th.name)) { btn.textContent = t('Lade …'); await installCommunityTheme(th); installed.add(th.name); }
            appearance.cssTheme = th.name;
            await applyTheme(); await applyStyleSettings(); saveAppearance();
            notice(t('Theme „{name}“ aktiv.', { name: th.name }));
            this.close(); this.done();
          } catch (e) { btn.textContent = t('Fehler'); notice(t('Theme konnte nicht installiert werden: ') + e); }
        });
        return h('div', { cls: 'ordo-theme-card' },
          h('img', { src: `https://raw.githubusercontent.com/${th.repo}/HEAD/${th.screenshot}`, loading: 'lazy', alt: '' }),
          h('div', { cls: 'ordo-theme-name', text: th.name }),
          h('div', { cls: 'setting-item-description', text: `${t('von {author}', { author: th.author })} · ${(th.modes ?? []).join(', ')}` }),
          btn);
      }));
    };
    search.addEventListener('input', render);
    render();
    setTimeout(() => search.focus());
  }
}

export { applyAll };
