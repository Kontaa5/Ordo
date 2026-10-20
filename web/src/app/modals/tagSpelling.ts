// "Hashtag-Schreibweisen vereinheitlichen": #sew, #Sew and #SEW become one spelling
// in every note. Shows the list first; frontmatter and code stay untouched.

import { Modal } from '../ui/modal';
import { h } from '../dom';
import { request } from '../host';
import { notice } from '../ui/notice';
import { vault } from '../store';
import { workspace } from '../workspace';
import { MarkdownView } from '../views/markdown';

import { t, tn } from '../i18n';

const TAG_IN_LINE = /(^|[\s(,;])#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/gu;

/** Text with every hashtag in `spell` (lowercased tag → spelling) rewritten; code and frontmatter untouched. */
export function rewriteTagSpellings(text: string, spell: Map<string, string>): string {
  const lines = text.split('\n');
  let fence: string | null = null, inFm = lines[0]?.trim() === '---';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (inFm) { if (i > 0 && /^(---|\.\.\.)\s*$/.test(line)) inFm = false; continue; }
    const f = /^\s*(```+|~~~+)/.exec(line);
    if (f) { fence = fence ? (line.trim().startsWith(fence) ? null : fence) : f[1]; continue; }
    if (fence) continue;
    // split off inline code spans, rewrite only the text between them
    lines[i] = line.split(/(`[^`]*`)/).map(part => part.startsWith('`') ? part
      : part.replace(TAG_IN_LINE, (all, pre: string, tag: string) => {
        const s = spell.get(tag.toLowerCase());
        return s && s !== tag ? `${pre}#${s}` : all;
      })).join('');
  }
  return lines.join('\n');
}

/** Rewrites all notes; open notes are changed in their editor. Returns the number of notes changed. */
export async function applyTagSpellings(spell: Map<string, string>): Promise<number> {
  const affected = [...vault.notes.values()].filter(n => (n.rawTags ?? n.tags).some(tg => { const s = spell.get(tg.toLowerCase()); return s && s !== tg; }));
  const open = new Map<string, MarkdownView>();
  for (const l of workspace.leaves) if (l.view instanceof MarkdownView) open.set(l.view.path, l.view);
  let changed = 0;
  for (const n of affected) {
    const view = open.get(n.path);
    if (view) {
      const doc = view.editor.state.doc.toString(), next = rewriteTagSpellings(doc, spell);
      if (next !== doc) { view.editor.dispatch({ changes: { from: 0, to: doc.length, insert: next } }); changed++; }
      continue;
    }
    const text = await request<string>('read', { path: n.path });
    const next = rewriteTagSpellings(text, spell);
    // typingTag: only the spelling changes, so don't re-sort the note into another folder
    if (next !== text) { await request('write', { path: n.path, text: next, typingTag: true }); changed++; }
  }
  return changed;
}

export class TagSpellingModal extends Modal {
  constructor() { super('ordo-sort-all'); this.setTitle(t('Hashtag-Schreibweisen vereinheitlichen')); }

  onOpen() {
    const conflicts = vault.spellingConflicts();
    if (!conflicts.length) {
      this.contentEl.replaceChildren(h('p', { text: t('Jeder Hashtag hat schon nur eine Schreibweise.') }),
        h('div', { cls: 'modal-button-container' }, h('button', { cls: 'mod-cta', text: 'OK', onclick: () => this.close() })));
      return;
    }
    const rows = conflicts.map(c => {
      const cb = h('input', { type: 'checkbox', checked: true });
      const sel = h('select', { cls: 'dropdown' }, ...c.variants.map(([v, n]) => h('option', { value: v, text: `#${v}  (${n})` }))) as HTMLSelectElement;
      sel.value = c.canonical;
      const others = () => c.variants.filter(([v]) => v !== sel.value).map(([v]) => '#' + v).join(', ');
      const desc = h('div', { cls: 'setting-item-description', text: '' });
      const upd = () => { desc.textContent = t('{others} → #{tag}', { others: others(), tag: sel.value }); };
      sel.addEventListener('change', upd); upd();
      return { c, cb, sel, el: h('label', { cls: 'ordo-sort-row' }, cb, h('div', {}, sel, desc)) };
    });
    this.contentEl.replaceChildren(
      h('div', { cls: 'setting-item-description', text: t('Alle Notizen bekommen die gewählte Schreibweise. Code und Eigenschaften (Frontmatter) bleiben unverändert.') }),
      h('div', { cls: 'ordo-sort-list' }, ...rows.map(r => r.el)),
      h('div', { cls: 'modal-button-container' },
        h('button', { text: t('Abbrechen'), onclick: () => this.close() }),
        h('button', {
          cls: 'mod-cta', text: t('Vereinheitlichen'), onclick: async () => {
            const picked = rows.filter(r => r.cb.checked);
            const spell = new Map(picked.map(r => [r.c.key, r.sel.value]));
            await vault.saveSettings({ tagSpellings: { ...(vault.settings.tagSpellings ?? {}), ...Object.fromEntries(spell) } });
            const n = await applyTagSpellings(spell);
            this.close();
            notice(tn(n, 'Notiz angepasst.', 'Notizen angepasst.'));
          },
        })));
  }
}

