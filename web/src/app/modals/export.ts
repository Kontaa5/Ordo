// PDF export like "Better Export PDF": pick hashtags (#4klasse #medt), review
// and order the notes, one combined PDF or one per note, saved presets.

import { Modal } from '../ui/modal';
import { h, icon, noteName, dirname, fuzzy } from '../dom';
import { vault, PageSettings, ExportPreset } from '../store';
import { request, on } from '../host';
import { notice } from '../ui/notice';
import { promptText, confirmDialog } from '../ui/modal';
import { setting } from './tagRule';

import { t, tn } from '../i18n';
type Sort = 'name' | 'mtime' | 'folder' | 'manual';

export class ExportModal extends Modal {
  private tags: string[] = [];
  private paths: string[] = [];
  private include = new Map<string, boolean>();
  private matchAll = true;
  private combined = true;
  private toc = true;
  private titles = true;
  private sort: Sort = 'name';
  private page: PageSettings;
  private fixedPaths: boolean;
  private body = h('div', { cls: 'ordo-export' });
  private progressEl = h('div', { cls: 'ordo-export-progress' });

  constructor(opts: { tags?: string[]; paths?: string[]; preset?: ExportPreset } = {}) {
    super('ordo-export-modal');
    this.setTitle(t('Als PDF exportieren'));
    this.page = { ...vault.settings.page };
    this.tags = opts.tags ?? [];
    this.fixedPaths = !!opts.paths?.length && !opts.tags?.length;
    if (opts.paths?.length) { this.paths = opts.paths; if (opts.paths.length === 1) this.toc = false; }
    if (opts.preset) this.applyPreset(opts.preset);
    this.contentEl.append(this.body);
    this.rebuild();
  }

  private applyPreset(p: ExportPreset) {
    this.tags = [...p.tags]; this.matchAll = p.matchAll; this.combined = p.combined; this.toc = p.tableOfContents; this.titles = p.titleHeadings; this.page = { ...p.page };
    this.fixedPaths = false;
  }

  private notes(): string[] {
    let list = this.fixedPaths ? this.paths : vault.notesWithTags(this.tags, this.matchAll);
    if (this.sort === 'manual') {
      const order = this.paths.filter(p => list.includes(p));
      list = [...order, ...list.filter(p => !order.includes(p))];
    } else {
      list = [...list].sort((a, b) => {
        if (this.sort === 'mtime') return (vault.notes.get(b)?.mtime ?? 0) - (vault.notes.get(a)?.mtime ?? 0);
        if (this.sort === 'folder') return a.localeCompare(b, 'de', { numeric: true });
        return noteName(a).localeCompare(noteName(b), 'de', { numeric: true });
      });
    }
    this.paths = list;
    return list;
  }

  private rebuild() {
    const notes = this.notes();
    const presets = vault.settings.exportPresets ?? [];

    // presets
    const presetRow = h('div', { cls: 'ordo-export-presets' },
      ...presets.map(p => {
        const b = h('button', { cls: 'ordo-chip', text: p.name, onclick: () => { this.applyPreset(p); this.rebuild(); } });
        b.addEventListener('contextmenu', async e => {
          e.preventDefault();
          if (await confirmDialog(t('Vorlage löschen'), t('Vorlage „{name}“ löschen?', { name: p.name }), t('Löschen'), true)) { await vault.saveSettings({ exportPresets: presets.filter(x => x.id !== p.id) }); this.rebuild(); }
        });
        return b;
      }),
      h('button', { cls: 'ordo-chip mod-add', disabled: !this.tags.length, onclick: () => this.savePreset() }, icon('plus', 14), t(' Als Vorlage sichern')));

    // tag picker
    const tagInput = h('input', { type: 'text', placeholder: this.tags.length ? t('weiteren Hashtag hinzufügen …') : t('Hashtag eingeben, z. B. 4klasse'), spellcheck: 'false', autocapitalize: 'off' });
    const sugg = h('div', { cls: 'ordo-tag-suggestions' });
    const renderSugg = () => {
      const q = tagInput.value.replace(/^#/, '').trim();
      const all = vault.sortedTags().filter(t => !this.tags.includes(t));
      const list = (q ? all.map(t => ({ t, m: fuzzy(q, t) })).filter(x => x.m).sort((a, b) => b.m!.score - a.m!.score).map(x => x.t) : all.sort((a, b) => (vault.tagCounts[b] ?? 0) - (vault.tagCounts[a] ?? 0))).slice(0, 24);
      sugg.replaceChildren(...list.map(t => h('button', { cls: 'ordo-chip mod-suggest', text: `#${t}`, onclick: () => { this.addTag(t); } })));
    };
    tagInput.addEventListener('input', renderSugg);
    tagInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); const first = sugg.querySelector('button')?.textContent?.slice(1) ?? tagInput.value.replace(/^#/, '').trim(); if (first) this.addTag(first); }
      if (e.key === 'Backspace' && !tagInput.value && this.tags.length) { this.tags.pop(); this.fixedPaths = false; this.rebuild(); }
    });
    renderSugg();
    const chips = h('div', { cls: 'ordo-tag-chips' },
      ...this.tags.map(t => h('span', { cls: 'ordo-chip mod-tag' }, '#' + t, h('span', { cls: 'ordo-chip-x', onclick: () => { this.tags = this.tags.filter(x => x !== t); this.fixedPaths = false; this.rebuild(); } }, icon('x', 12)))),
      tagInput);

    const matchSel = h('select', { cls: 'dropdown', disabled: this.tags.length < 2 },
      h('option', { value: 'all', text: t('mit allen Hashtags'), selected: this.matchAll }),
      h('option', { value: 'any', text: t('mit mindestens einem'), selected: !this.matchAll }));
    matchSel.addEventListener('change', () => { this.matchAll = matchSel.value === 'all'; this.rebuild(); });

    // notes list
    const sortSel = h('select', { cls: 'dropdown' }, ...(['name', 'mtime', 'folder', 'manual'] as Sort[]).map(s => h('option', { value: s, text: { name: t('Name'), mtime: t('Zuletzt bearbeitet'), folder: t('Ordner'), manual: t('Manuell (ziehen)') }[s], selected: this.sort === s })));
    sortSel.addEventListener('change', () => { this.sort = sortSel.value as Sort; this.rebuild(); });
    const list = h('div', { cls: 'ordo-export-list' });
    notes.forEach(p => {
      const cb = h('input', { type: 'checkbox', checked: this.include.get(p) !== false });
      cb.addEventListener('change', () => { this.include.set(p, cb.checked); counter.textContent = this.countText(); });
      const row = h('label', { cls: 'ordo-export-row', draggable: 'true' }, h('span', { cls: 'ordo-drag', text: '⋮⋮' }), cb,
        h('span', { cls: 'ordo-export-name', text: noteName(p) }), h('span', { cls: 'ordo-export-folder', text: dirname(p) }));
      row.addEventListener('dragstart', e => e.dataTransfer?.setData('text/ordo-export', p));
      row.addEventListener('dragover', e => { if (e.dataTransfer?.types.includes('text/ordo-export')) { e.preventDefault(); row.classList.add('is-drop-target'); } });
      row.addEventListener('dragleave', () => row.classList.remove('is-drop-target'));
      row.addEventListener('drop', e => {
        const from = e.dataTransfer?.getData('text/ordo-export');
        if (!from || from === p) return;
        e.preventDefault();
        const order = this.paths.filter(x => x !== from);
        order.splice(order.indexOf(p), 0, from);
        this.paths = order; this.sort = 'manual'; this.rebuild();
      });
      list.appendChild(row);
    });
    const counter = h('div', { cls: 'setting-item-description', text: this.countText() });

    // options
    const toggle = (val: boolean, set: (v: boolean) => void, disabled = false) => {
      const t = h('div', { cls: 'checkbox-container' + (val ? ' is-enabled' : '') + (disabled ? ' is-disabled' : '') });
      t.addEventListener('click', () => { if (disabled) return; set(!val); this.rebuild(); });
      return t;
    };
    const fileSel = h('select', { cls: 'dropdown' }, h('option', { value: '1', text: t('Eine PDF'), selected: this.combined }), h('option', { value: '0', text: t('Eine PDF pro Notiz'), selected: !this.combined }));
    fileSel.addEventListener('change', () => { this.combined = fileSel.value === '1'; this.rebuild(); });
    const paper = h('select', { cls: 'dropdown' }, ...(['a4', 'a5', 'letter'] as const).map(p => h('option', { value: p, text: { a4: 'A4', a5: 'A5', letter: t('US Letter') }[p], selected: this.page.paper === p })));
    paper.addEventListener('change', () => { this.page.paper = paper.value as any; });
    const num = (val: number, min: number, max: number, step: number, set: (v: number) => void) => {
      const i = h('input', { type: 'number', value: String(val), min: String(min), max: String(max), step: String(step), cls: 'ordo-number' });
      i.addEventListener('change', () => set(Math.max(min, Math.min(max, +i.value || val))));
      return i;
    };

    const exportBtn = h('button', { cls: 'mod-cta', text: t('Exportieren'), onclick: () => this.run(exportBtn) });
    this.body.replaceChildren(...[
      presets.length || this.tags.length ? h('div', { cls: 'ordo-export-section' }, h('div', { cls: 'ordo-section-title', text: t('Vorlagen') }), presetRow) : null,
      h('div', { cls: 'ordo-export-section' }, h('div', { cls: 'ordo-section-title', text: t('Hashtags') }), chips, sugg, setting(t('Notizen'), '', matchSel)),
      h('div', { cls: 'ordo-export-section' },
        h('div', { cls: 'ordo-section-head' }, h('div', { cls: 'ordo-section-title', text: t('Notizen ({n})', { n: notes.length }) }), sortSel,
          h('button', { cls: 'mod-small', text: t('Alle'), onclick: () => { notes.forEach(p => this.include.set(p, true)); this.rebuild(); } }),
          h('button', { cls: 'mod-small', text: t('Keine'), onclick: () => { notes.forEach(p => this.include.set(p, false)); this.rebuild(); } })),
        notes.length ? list : h('div', { cls: 'pane-empty', text: t('Wähle Hashtags – oder exportiere aus einer Notiz / einem Ordner.') }),
        counter),
      h('div', { cls: 'ordo-export-section' }, h('div', { cls: 'ordo-section-title', text: t('Ausgabe') }),
        setting(t('Dateien'), '', fileSel),
        setting(t('Inhaltsverzeichnis'), '', toggle(this.toc && this.combined, v => (this.toc = v), !this.combined)),
        setting(t('Notiztitel als Überschrift'), '', toggle(this.titles, v => (this.titles = v))),
        setting(t('Seitenzahlen'), '', toggle(this.page.pageNumbers, v => (this.page.pageNumbers = v))),
        setting(t('Papier'), '', paper, toggle(this.page.landscape, v => (this.page.landscape = v)), h('span', { cls: 'setting-item-description', text: t(' quer') })),
        setting(t('Ränder (mm)'), '', num(this.page.marginMM, 5, 40, 1, v => (this.page.marginMM = v))),
        setting(t('Schriftgröße (pt)'), '', num(this.page.fontSize, 8, 18, 0.5, v => (this.page.fontSize = v)))),
      this.progressEl,
      h('div', { cls: 'modal-button-container' }, h('button', { text: t('Abbrechen'), onclick: () => this.close() }), exportBtn)].filter(Boolean) as HTMLElement[]);
    setTimeout(() => { if (!this.fixedPaths && document.activeElement === document.body) tagInput.focus(); });
  }

  private addTag(t: string) {
    if (!this.tags.includes(t)) this.tags.push(t);
    this.fixedPaths = false;
    this.rebuild();
    setTimeout(() => (this.body.querySelector('.ordo-tag-chips input') as HTMLInputElement | null)?.focus());
  }

  private countText() {
    const n = this.paths.filter(p => this.include.get(p) !== false).length;
    return t('{k} von {n} Notizen werden exportiert.', { k: n, n: this.paths.length });
  }

  private async savePreset() {
    const name = await promptText('Vorlage sichern', this.tags.map(t => '#' + t).join(' '), t('Name, z. B. 4klasse MEDT – Handout'), t('Sichern'));
    if (!name) return;
    const preset: ExportPreset = { id: crypto.randomUUID?.() ?? String(Date.now()), name, tags: this.tags, matchAll: this.matchAll, combined: this.combined, tableOfContents: this.toc, titleHeadings: this.titles, page: { ...this.page } };
    await vault.saveSettings({ exportPresets: [...(vault.settings.exportPresets ?? []), preset] });
    notice(t('Vorlage „{name}“ gesichert.', { name }));
    this.rebuild();
  }

  private async run(btn: HTMLButtonElement) {
    const paths = this.paths.filter(p => this.include.get(p) !== false);
    if (!paths.length) { notice(t('Keine Notizen ausgewählt.')); return; }
    btn.disabled = true;
    this.progressEl.textContent = t('Erzeuge PDF …');
    const off = on('export-progress', (p: number) => { this.progressEl.textContent = `Erzeuge PDF … ${Math.round(p * 100)} %`; });
    try {
      const name = this.tags.length ? this.tags.join(' ') : paths.length === 1 ? noteName(paths[0]) : vault.name;
      const ok = await request<boolean>('export', { paths, options: { page: this.page, toc: this.toc && this.combined, titles: this.titles, combined: this.combined, name } });
      if (ok) { this.close(); notice(t('PDF exportiert.')); }
      else this.progressEl.textContent = '';
    } catch (e) {
      this.progressEl.textContent = t('Fehler: ') + e;
    } finally { off(); btn.disabled = false; }
  }
}
