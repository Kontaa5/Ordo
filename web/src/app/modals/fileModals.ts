// Quick switcher, command palette, folder picker – Obsidian-style prompts.

import { SuggestModal } from '../ui/modal';
import { h, fuzzy, highlightMatches, noteName, dirname, basename, icon } from '../dom';
import { vault } from '../store';
import { workspace } from '../workspace';
import { request } from '../host';
import { getCommands, executeCommand, hotkeysFor, displayHotkey, Command } from '../commands';

import { t, tn } from '../i18n';
interface FileItem { path: string; name: string; score: number; matches: number[]; recent: number }

const recent: string[] = [];
export function rememberRecent(path: string) {
  const i = recent.indexOf(path);
  if (i >= 0) recent.splice(i, 1);
  recent.unshift(path);
  recent.length = Math.min(recent.length, 30);
}

export class QuickSwitcher extends SuggestModal<FileItem> {
  constructor() {
    super(t('Datei suchen oder neu anlegen …'));
    this.setInstructions([['↑↓', t('navigieren')], ['↵', t('öffnen')], ['⌘ ↵', t('in neuem Tab')], ['⇧ ↵', t('neu anlegen')], ['esc', t('schließen')]]);
    this.emptyStateText = t('Keine Treffer. ⇧↵ legt die Notiz an.');
  }

  getSuggestions(q: string): FileItem[] {
    const all = [...vault.notes.keys(), ...[...vault.files.keys()].filter(f => /\.(png|jpe?g|gif|webp|svg|pdf|heic)$/i.test(f))];
    if (!q.trim()) {
      const rec = recent.filter(p => vault.exists(p));
      const rest = all.filter(p => !rec.includes(p)).sort((a, b) => (vault.notes.get(b)?.mtime ?? 0) - (vault.notes.get(a)?.mtime ?? 0));
      return [...rec, ...rest].slice(0, 60).map((p, i) => ({ path: p, name: noteName(p), score: -i, matches: [], recent: i }));
    }
    const out: FileItem[] = [];
    for (const p of all) {
      const name = noteName(p);
      const m = fuzzy(q, name) ?? (() => { const r = fuzzy(q, p); return r ? { score: r.score - 50, matches: [] } : null; })();
      if (m) out.push({ path: p, name, score: m.score + (recent.includes(p) ? 30 : 0), matches: m.matches, recent: 0 });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 60);
  }

  renderSuggestion(it: FileItem, el: HTMLElement) {
    el.classList.add('mod-complex');
    el.append(h('div', { cls: 'suggestion-content' },
      h('div', { cls: 'suggestion-title' }, highlightMatches(it.name, it.matches)),
      dirname(it.path) ? h('div', { cls: 'suggestion-note', text: dirname(it.path) }) : null));
    if (!/\.md$/i.test(it.path)) el.appendChild(h('div', { cls: 'suggestion-aux' }, h('span', { cls: 'suggestion-flair', text: it.path.split('.').pop()!.toUpperCase() })));
  }

  onChoose(it: FileItem, e: KeyboardEvent | MouseEvent) {
    workspace.openFile(it.path, { newLeaf: e.metaKey || e.ctrlKey });
  }

  async onEmptyEnter(q: string, e: KeyboardEvent) {
    const name = q.trim();
    if (!name) return;
    const folder = name.includes('/') ? dirname(name) : vault.settings.newNoteFolder;
    const path = await request<string>('create', { folder, title: basename(name) });
    workspace.openFile(path, { newLeaf: e.metaKey || e.ctrlKey, mode: 'source' });
  }

  keydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); const q = this.inputEl.value; this.close(); this.onEmptyEnter(q, e); return; }
    super.keydown(e);
  }
}

interface CmdItem { cmd: Command; matches: number[]; score: number }

const recentCommands: string[] = [];

export class CommandPalette extends SuggestModal<CmdItem> {
  constructor() {
    super(t('Befehl eingeben …'));
    this.setInstructions([['↑↓', t('navigieren')], ['↵', t('ausführen')], ['esc', t('schließen')]]);
  }
  getSuggestions(q: string): CmdItem[] {
    const cmds = getCommands().filter(c => !c.hidden && (!c.check || c.check()));
    if (!q.trim()) {
      return cmds.map(cmd => ({ cmd, matches: [], score: -recentCommands.indexOf(cmd.id) }))
        .sort((a, b) => (recentCommands.includes(b.cmd.id) ? 1000 - recentCommands.indexOf(b.cmd.id) : 0) - (recentCommands.includes(a.cmd.id) ? 1000 - recentCommands.indexOf(a.cmd.id) : 0) || a.cmd.name.localeCompare(b.cmd.name, 'de'));
    }
    return cmds.map(cmd => { const m = fuzzy(q, cmd.name); return m ? { cmd, matches: m.matches, score: m.score } : null; })
      .filter((x): x is CmdItem => !!x).sort((a, b) => b.score - a.score);
  }
  renderSuggestion(it: CmdItem, el: HTMLElement) {
    el.classList.add('mod-complex');
    el.append(h('div', { cls: 'suggestion-content' }, h('div', { cls: 'suggestion-title' }, highlightMatches(it.cmd.name, it.matches))));
    const keys = hotkeysFor(it.cmd.id);
    if (keys.length) el.appendChild(h('div', { cls: 'suggestion-aux' }, ...keys.map(k => h('kbd', { cls: 'suggestion-hotkey', text: displayHotkey(k) }))));
  }
  onChoose(it: CmdItem) {
    const i = recentCommands.indexOf(it.cmd.id);
    if (i >= 0) recentCommands.splice(i, 1);
    recentCommands.unshift(it.cmd.id);
    executeCommand(it.cmd.id);
  }
}

export class FolderSuggestModal extends SuggestModal<{ path: string; matches: number[] }> {
  constructor(private pick: (folder: string) => void, private moving?: string) {
    super(t('Ordner wählen …'));
    this.setInstructions([['↑↓', t('navigieren')], ['↵', t('verschieben')], ['⇧ ↵', t('neuen Ordner anlegen')], ['esc', t('abbrechen')]]);
  }
  getSuggestions(q: string) {
    const folders = ['', ...[...vault.folders].sort()].filter(f => !this.moving || (f !== this.moving && !f.startsWith(this.moving + '/')));
    if (!q) return folders.map(path => ({ path, matches: [] }));
    return folders.map(path => { const m = fuzzy(q, path || '/'); return m ? { path, matches: m.matches, score: m.score } : null; })
      .filter((x): x is any => !!x).sort((a: any, b: any) => b.score - a.score);
  }
  renderSuggestion(it: { path: string; matches: number[] }, el: HTMLElement) {
    el.append(icon(it.path ? 'folder' : 'vault', 16), h('span', {}, it.path ? highlightMatches(it.path, it.matches) : document.createTextNode(t('{name} (Hauptordner)', { name: vault.name }))));
    el.classList.add('ordo-folder-suggestion');
  }
  onChoose(it: { path: string }) { this.pick(it.path); }
  onEmptyEnter(q: string) { if (q.trim()) this.pick(q.trim().replace(/^\/+|\/+$/g, '')); }
  keydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); const q = this.inputEl.value; this.close(); this.onEmptyEnter(q); return; }
    super.keydown(e);
  }
}
