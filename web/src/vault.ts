// Shared vault index + link/file resolution, mirroring Obsidian's rules:
// a link target without a folder resolves by basename, preferring the
// note's own folder, otherwise the shortest path wins.

export interface NoteRef { path: string; name: string }

export interface VaultIndex {
  notes: NoteRef[];
  files: string[];          // non-markdown files, vault-relative
  tags: string[];
  attachmentFolder: string;
}

export interface PageGeom {
  pageW: number; pageH: number;
  mt: number; mr: number; mb: number; ml: number;
  fontSize: number;
}

let index: VaultIndex = { notes: [], files: [], tags: [], attachmentFolder: '' };
let byBase = new Map<string, string[]>();

export function setIndex(i: VaultIndex) {
  index = i;
  byBase = new Map();
  const add = (p: string) => {
    const base = basename(p).toLowerCase();
    const noExt = base.replace(/\.md$/, '');
    for (const k of new Set([base, noExt])) {
      const arr = byBase.get(k) ?? [];
      arr.push(p);
      byBase.set(k, arr);
    }
  };
  i.notes.forEach(n => add(n.path));
  i.files.forEach(add);
}

export function getIndex() { return index; }

export function basename(p: string) { return p.split('/').pop() ?? p; }
export function dirname(p: string) { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); }

export const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|heic|heif|avif|tiff?)$/i;

/** Resolve a link target ("Note", "folder/Note", "img.png") to a vault path. */
export function resolve(target: string, fromPath = ''): string | null {
  let t = target.trim();
  try { t = decodeURIComponent(t); } catch { /* keep raw */ }
  t = t.replace(/^\.?\//, '');
  if (!t) return null;
  const lower = t.toLowerCase();
  const all = [...index.notes.map(n => n.path), ...index.files];

  if (lower.includes('/')) {
    // relative to note folder first, then vault root, then any suffix match
    const rel = normalize(joinPath(dirname(fromPath), t)).toLowerCase();
    const cands = [rel, rel + '.md', lower, lower + '.md'];
    for (const c of cands) {
      const hit = all.find(p => p.toLowerCase() === c);
      if (hit) return hit;
    }
    const suffix = all.find(p => p.toLowerCase().endsWith('/' + lower) || p.toLowerCase().endsWith('/' + lower + '.md'));
    return suffix ?? null;
  }

  const list = byBase.get(lower);
  if (!list || list.length === 0) return null;
  if (list.length === 1) return list[0];
  const dir = dirname(fromPath).toLowerCase();
  const same = list.find(p => dirname(p).toLowerCase() === dir);
  if (same) return same;
  return [...list].sort((a, b) => a.length - b.length)[0];
}

function joinPath(a: string, b: string) { return a ? a + '/' + b : b; }
function normalize(p: string) {
  const out: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop(); else out.push(seg);
  }
  return out.join('/');
}

export function fileURL(path: string) {
  return 'ordo://local/vault/' + path.split('/').map(encodeURIComponent).join('/');
}

/** Parse "300" or "300x200" image size suffixes used by Obsidian. */
export function parseSize(s: string | undefined): { w?: number; h?: number } {
  if (!s) return {};
  const m = /^\s*(\d+)(?:\s*x\s*(\d+))?\s*$/.exec(s);
  if (!m) return {};
  return { w: +m[1], h: m[2] ? +m[2] : undefined };
}

export const TAG_RE = /(^|[\s(,;])#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/gu;
