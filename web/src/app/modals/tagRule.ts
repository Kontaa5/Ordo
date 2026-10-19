// Per-hashtag folder rule: is it a folder, which folder (#serw → Softwareentwicklung).

import { Modal } from '../ui/modal';
import { h } from '../dom';
import { vault, TagRule } from '../store';
import { request } from '../host';
import { notice } from '../ui/notice';

import { t, tn } from '../i18n';
const MODES: [TagRule['mode'], string][] = [
  ['folderAndSubfolder', t('Ordner (2. Hashtag = Unterordner)')],
  ['folderOnly', t('Ordner, aber kein Unterordner')],
  ['ignore', t('Kein Ordner (nur Schlagwort)')],
];

/** Does this hashtag create a folder? (rule, else the "all tags are folders" switch) */
export function isFolderTag(tag: string): boolean {
  const rules = vault.settings?.tagRules ?? {};
  const l = tag.toLowerCase();
  const r = rules[l] ?? rules[l.split('/')[0]];
  return r ? r.mode !== 'ignore' : !!vault.settings?.allTagsAreFolders;
}

/** Same logic as the Swift side (FolderRules.targetFolder). */
export function targetFolder(tags: string[], rules: Record<string, TagRule>, allTagsAreFolders: boolean, base = ''): string | null {
  const ruleFor = (tag: string): TagRule | null => {
    const l = tag.toLowerCase();
    if (rules[l]) return rules[l];
    const root = l.split('/')[0];
    const r = rules[root];
    if (!r) return null;
    if (r.folder && l.includes('/')) return { mode: r.mode, folder: r.folder + '/' + tag.split('/').slice(1).join('/') };
    return r;
  };
  const usable = tags.filter(t => { const r = ruleFor(t); return r ? r.mode !== 'ignore' : allTagsAreFolders; });
  if (!usable.length) return null;
  const comps = (t: string) => ((ruleFor(t)?.folder || t).split('/'));
  let parts = comps(usable[0]);
  if ((ruleFor(usable[0])?.mode ?? 'folderAndSubfolder') === 'folderAndSubfolder' && usable.length > 1) parts = parts.concat(comps(usable[1]));
  parts = parts.map(p => p.replace(/[:\\*?"<>|]/g, '').trim()).filter(Boolean);
  return parts.length ? [...base.split('/').filter(Boolean), ...parts].join('/') : null;
}

export class TagRuleModal extends Modal {
  private tag = h('input', { type: 'text', placeholder: t('Hashtag, z. B. serw'), spellcheck: 'false', autocapitalize: 'off' });
  private mode = h('select', { cls: 'dropdown' }, ...MODES.map(([v, l]) => h('option', { value: v, text: l })));
  private folder = h('input', { type: 'text', placeholder: t('Ordnername (leer = wie der Hashtag)'), spellcheck: 'false', list: 'ordo-folder-list' });
  private preview = h('pre', { cls: 'ordo-rule-preview' });

  constructor(private initial: string) {
    super('ordo-tag-rule');
    this.setTitle(initial ? t('Ordner für #{tag}', { tag: initial }) : t('Hashtag-Regel'));
    const existing = vault.settings.tagRules[initial.toLowerCase()];
    this.tag.value = initial;
    if (initial) this.tag.disabled = true;
    this.mode.value = existing?.mode ?? 'folderAndSubfolder';
    this.folder.value = existing?.folder ?? '';
    const list = h('datalist', { id: 'ordo-folder-list' }, ...[...vault.folders].sort().map(f => h('option', { value: f })));
    const update = () => this.updatePreview();
    [this.tag, this.folder].forEach(i => i.addEventListener('input', update));
    this.mode.addEventListener('change', () => { this.folderRow.style.display = this.mode.value === 'ignore' ? 'none' : ''; update(); });
    this.contentEl.append(
      setting(t('Hashtag'), '', this.tag),
      setting(t('Ist ein Ordner?'), t('Semester-Tags wie #4sem auf „Kein Ordner“ stellen – dann landet „#4sem #serw“ direkt im Fach-Ordner.'), this.mode),
      this.folderRow = setting(t('Ordner'), t('Mehrere Hashtags dürfen in denselben Ordner zeigen.'), this.folder),
      list,
      h('div', { cls: 'setting-item-description', text: t('Vorschau') }), this.preview,
      h('div', { cls: 'modal-button-container' },
        existing ? h('button', { cls: 'mod-warning', text: t('Regel entfernen'), onclick: () => this.save(true) }) : null,
        h('button', { text: t('Abbrechen'), onclick: () => this.close() }),
        h('button', { cls: 'mod-cta', text: t('Sichern'), onclick: () => this.save(false) })));
    if (this.mode.value === 'ignore') this.folderRow.style.display = 'none';
    update();
  }
  private folderRow!: HTMLElement;

  onOpen() { setTimeout(() => (this.initial ? this.folder : this.tag).focus()); }

  private clean() { return this.tag.value.trim().replace(/^#+/, '').toLowerCase(); }

  private updatePreview() {
    const tg = this.clean() || 'tag';
    const rules = { ...vault.settings.tagRules, [tg]: { mode: this.mode.value as TagRule['mode'], folder: this.folder.value.trim() } };
    const all = vault.settings.allTagsAreFolders;
    const base = vault.settings.sortBaseFolder;
    const a = targetFolder([tg], rules, all, base) ?? t('bleibt, wo sie ist');
    const b = targetFolder(['4sem', tg], rules, all, base) ?? t('bleibt, wo sie ist');
    const c = targetFolder([tg, t('übung')], rules, all, base) ?? t('bleibt, wo sie ist');
    this.preview.textContent = `#${tg}              → ${a}\n#4sem #${tg}        → ${b}\n#${tg} #${t('übung')}       → ${c}`;
  }

  private async save(remove: boolean) {
    const tg = this.clean();
    if (!tg) return;
    const rules = { ...vault.settings.tagRules };
    if (remove) delete rules[tg];
    else rules[tg] = { mode: this.mode.value as TagRule['mode'], folder: this.folder.value.trim().replace(/^\/+|\/+$/g, '') };
    await vault.saveSettings({ tagRules: rules });
    this.close();
    const plan = await request<any[]>('sortAllPlan').catch(() => []);
    if (plan.length) notice(t('{n} Notizen passen nicht mehr zu ihren Hashtags.', { n: plan.length }), { action: t('Einsortieren …'), onAction: () => import('./sortAll').then(m => new m.SortAllModal().open()) });
  }
}

export function setting(name: string, desc: string, ...controls: (HTMLElement | null)[]) {
  return h('div', { cls: 'setting-item' },
    h('div', { cls: 'setting-item-info' }, h('div', { cls: 'setting-item-name', text: name }), desc ? h('div', { cls: 'setting-item-description', text: desc }) : null),
    h('div', { cls: 'setting-item-control' }, ...controls));
}
