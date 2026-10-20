// Client-side view of the vault: index from the native side, link resolution,
// backlinks, tags and the folder tree.

import { on, emit, request } from './host';
import { setIndex as setResolverIndex, resolve as resolveLink } from '../vault';
import { basename, dirname, noteName, extname } from './dom';

export interface Heading { level: number; text: string; line: number }
export interface NoteMeta {
  /** tags in their one spelling per tag; rawTags = as written in the note */
  path: string; tags: string[]; rawTags?: string[]; links: string[]; embeds: string[]; headings: Heading[];
  mtime: number; ctime: number; size: number; placeholder: boolean; pinned: boolean;
}
export interface FileMeta { path: string; mtime: number; ctime: number; size: number }

export interface TreeFolder { path: string; name: string; folders: TreeFolder[]; files: TreeFile[]; count: number }
export interface TreeFile { path: string; name: string; ext: string; isNote: boolean; mtime: number; ctime: number }

export type SortOrder = 'name-asc' | 'name-desc' | 'mtime-desc' | 'mtime-asc' | 'ctime-desc' | 'ctime-asc';

export interface PageSettings { paper: 'a4' | 'a5' | 'letter'; landscape: boolean; marginMM: number; fontSize: number; pageNumbers: boolean }
export interface TagRule { mode: 'folderAndSubfolder' | 'folderOnly' | 'ignore'; folder: string }
export interface ExportPreset { id: string; name: string; tags: string[]; matchAll: boolean; combined: boolean; tableOfContents: boolean; titleHeadings: boolean; page: PageSettings }
export interface VaultSettings {
  attachmentLocation: 'folder' | 'besideNote' | 'subfolderOfNote';
  attachmentFolder: string; attachmentSubfolderName: string; linkStyle: 'wiki' | 'markdown';
  maxImageDimension: number; convertHEIC: boolean; compressImages: boolean;
  autoSort: boolean; sortBaseFolder: string; tagRules: Record<string, TagRule>; allTagsAreFolders: boolean; tagSpellings?: Record<string, string>;
  trashDays?: number;
  gitEnabled?: boolean; gitRemote?: string; gitCommit?: 'auto' | 'daily' | 'manual'; gitPush?: 'daily' | 'afterCommit' | 'manual'; gitPull?: 'dailyStart' | 'everyStart' | 'manual';
  newNoteFolder: string; defaultMode: 'edit' | 'read'; editorFontSize: number; readableLineWidth: boolean;
  page: PageSettings; exportPresets: ExportPreset[];
}

class Vault {
  name = '';
  path = '';
  open = false;
  notes = new Map<string, NoteMeta>();
  files = new Map<string, FileMeta>();
  folders = new Set<string>();
  tagCounts: Record<string, number> = {};
  settings!: VaultSettings;
  private resolvedCache = new Map<string, string[]>();

  setIndex(snap: any) {
    this.name = snap.name ?? this.name;
    this.notes = new Map((snap.notes as NoteMeta[]).map(n => [n.path, n]));
    this.files = new Map((snap.files as FileMeta[]).map(f => [f.path, f]));
    this.folders = new Set(snap.folders as string[]);
    this.computeSpellings(snap.tagCounts ?? {});
    this.resolvedCache.clear();
    setResolverIndex({
      notes: [...this.notes.keys()].map(p => ({ path: p, name: noteName(p) })),
      files: [...this.files.keys()],
      tags: Object.keys(this.tagCounts).sort((a, b) => a.localeCompare(b)),
      attachmentFolder: this.settings?.attachmentFolder ?? '',
    });
    emit('vault-changed');
  }

  /** lowercased tag → every spelling used, with counts */
  tagVariants = new Map<string, Map<string, number>>();
  /** lowercased tag → the one spelling */
  private canonical = new Map<string, string>();

  /**
   * One spelling per hashtag (#sew = #SEW): the one set in the tag pane, else the
   * most used, on a tie the one from the oldest note. Notes, counts, graph and
   * export all see that spelling; rawTags keeps what is written in the note.
   */
  private computeSpellings(raw: Record<string, number>) {
    const firstSeen = new Map<string, number>();
    for (const n of this.notes.values()) for (const tg of n.rawTags ?? n.tags) if (!firstSeen.has(tg) || n.ctime < firstSeen.get(tg)!) firstSeen.set(tg, n.ctime);
    this.tagVariants = new Map();
    for (const [tg, c] of Object.entries(raw)) {
      const k = tg.toLowerCase();
      (this.tagVariants.get(k) ?? this.tagVariants.set(k, new Map()).get(k)!).set(tg, c);
    }
    const chosen = this.settings?.tagSpellings ?? {};
    this.canonical = new Map();
    for (const [k, vars] of this.tagVariants) {
      const pick = chosen[k] && [...vars.keys()].includes(chosen[k]) ? chosen[k]
        : [...vars.entries()].sort((a, b) => b[1] - a[1] || (firstSeen.get(a[0]) ?? 0) - (firstSeen.get(b[0]) ?? 0))[0][0];
      this.canonical.set(k, pick);
    }
    this.tagCounts = {};
    for (const [k, vars] of this.tagVariants) this.tagCounts[this.canonical.get(k)!] = [...vars.values()].reduce((s, c) => s + c, 0);
    for (const n of this.notes.values()) {
      n.rawTags = n.rawTags ?? n.tags;
      n.tags = [...new Set(n.rawTags.map(tg => this.canonical.get(tg.toLowerCase()) ?? tg))];
    }
  }

  /** The one spelling of a hashtag, or null if the vault doesn't use it yet. */
  canonicalTag(tag: string): string | null { return this.canonical.get(tag.toLowerCase()) ?? null; }

  /** Hashtags written in more than one way. */
  spellingConflicts(): { key: string; canonical: string; variants: [string, number][] }[] {
    return [...this.tagVariants].filter(([, v]) => v.size > 1)
      .map(([key, v]) => ({ key, canonical: this.canonical.get(key)!, variants: [...v.entries()].sort((a, b) => b[1] - a[1]) }));
  }

  async loadSettings() {
    this.settings = await request<VaultSettings>('getSettings');
    emit('settings-changed');
  }

  async saveSettings(patch: Partial<VaultSettings>) {
    this.settings = { ...this.settings, ...patch };
    this.settings = await request<VaultSettings>('setSettings', { settings: this.settings });
    if (patch.tagSpellings) { this.computeSpellings(Object.fromEntries([...this.tagVariants.values()].flatMap(v => [...v]))); emit('vault-changed'); }
    emit('settings-changed');
  }

  resolve(target: string, from = ''): string | null { return resolveLink(target, from); }

  /** Notes linking to `path` (with number of links). */
  backlinks(path: string): { path: string; count: number }[] {
    const out: { path: string; count: number }[] = [];
    for (const n of this.notes.values()) {
      if (n.path === path) continue;
      const count = this.outgoingResolved(n.path).filter(p => p === path).length;
      if (count) out.push({ path: n.path, count });
    }
    return out.sort((a, b) => noteName(a.path).localeCompare(noteName(b.path)));
  }

  outgoingResolved(path: string): string[] {
    let r = this.resolvedCache.get(path);
    if (!r) {
      const n = this.notes.get(path);
      r = n ? [...n.links, ...n.embeds].map(t => this.resolve(t, path)).filter((x): x is string => !!x) : [];
      this.resolvedCache.set(path, r);
    }
    return r;
  }

  notesWithTags(tags: string[], matchAll: boolean): string[] {
    const want = tags.map(t => t.toLowerCase());
    if (!want.length) return [];
    return [...this.notes.values()].filter(n => {
      const have = n.tags.map(t => t.toLowerCase());
      const hit = (w: string) => have.some(t => t === w || t.startsWith(w + '/'));
      return matchAll ? want.every(hit) : want.some(hit);
    }).map(n => n.path);
  }

  sortedTags() { return Object.keys(this.tagCounts).sort((a, b) => a.localeCompare(b, 'de')); }

  exists(path: string) { return this.notes.has(path) || this.files.has(path) || this.folders.has(path); }

  tree(order: SortOrder): TreeFolder {
    const root: TreeFolder = { path: '', name: this.name, folders: [], files: [], count: 0 };
    const byPath = new Map<string, TreeFolder>([['', root]]);
    const folder = (p: string): TreeFolder => {
      if (!p || p === '.') return root;
      let f = byPath.get(p);
      if (f) return f;
      const parent = folder(dirname(p));
      f = { path: p, name: basename(p), folders: [], files: [], count: 0 };
      parent.folders.push(f);
      byPath.set(p, f);
      return f;
    };
    [...this.folders].sort().forEach(folder);
    for (const n of this.notes.values()) folder(dirname(n.path)).files.push({ path: n.path, name: noteName(n.path), ext: 'md', isNote: true, mtime: n.mtime, ctime: n.ctime });
    for (const f of this.files.values()) folder(dirname(f.path)).files.push({ path: f.path, name: basename(f.path), ext: extname(f.path), isNote: false, mtime: f.mtime, ctime: f.ctime });
    const cmpName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'de', { numeric: true, sensitivity: 'base' });
    const cmp = (a: TreeFile, b: TreeFile) => {
      switch (order) {
        case 'name-desc': return -cmpName(a, b);
        case 'mtime-desc': return b.mtime - a.mtime;
        case 'mtime-asc': return a.mtime - b.mtime;
        case 'ctime-desc': return b.ctime - a.ctime;
        case 'ctime-asc': return a.ctime - b.ctime;
        default: return cmpName(a, b);
      }
    };
    const finish = (f: TreeFolder) => {
      f.folders.sort((a, b) => (order === 'name-desc' ? -cmpName(a, b) : cmpName(a, b)));
      f.files.sort(cmp);
      f.folders.forEach(finish);
      f.count = f.files.length + f.folders.reduce((s, c) => s + c.count, 0);
    };
    finish(root);
    return root;
  }
}

export const vault = new Vault();

on('index', snap => vault.setIndex(snap));
