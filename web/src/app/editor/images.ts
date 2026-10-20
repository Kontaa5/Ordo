// Image embeds. Off the cursor line an embed shows only the picture (like
// Obsidian); on the cursor line the source is visible and the picture sits
// below it. Pictures can be resized by dragging; the new link is shown while
// dragging and written as `|width` on release.

import { EditorState, Range, StateEffect, StateField } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { resolve, fileURL, IMAGE_EXT, parseSize } from '../../vault';
import { editorHost } from './host';
import { emit } from '../host';

import { t } from '../i18n';
export interface Embed {
  from: number; to: number; target: string; path: string | null; width?: number;
  kind: 'image' | 'note' | 'other'; syntax: 'wiki' | 'md';
}

const imageVersions = new Map<string, number>();
export function bumpImage(path: string) { imageVersions.set(path, Date.now()); }
export function versionedURL(path: string) {
  const v = imageVersions.get(path);
  return fileURL(path) + (v ? `?v=${v}` : '');
}

const WIKI = /!\[\[([^\[\]|\n]+?)(?:\|([^\[\]\n]*))?\]\]/g;
const MD = /!\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

export function findEmbeds(lineText: string, lineFrom: number, notePath: string): Embed[] {
  const out: Embed[] = [];
  for (const m of lineText.matchAll(WIKI)) {
    const target = m[1].split('#')[0];
    const path = resolve(target, notePath);
    const kind = IMAGE_EXT.test(target) ? 'image' : (/\.\w{2,4}$/.test(target) && !/\.md$/i.test(target) ? 'other' : 'note');
    out.push({ from: lineFrom + m.index!, to: lineFrom + m.index! + m[0].length, target: m[1], path, width: parseSize(m[2]).w, kind, syntax: 'wiki' });
  }
  for (const m of lineText.matchAll(MD)) {
    const alt = m[1], src = m[2];
    const bar = alt.lastIndexOf('|');
    const remote = /^[a-z][\w+.-]*:/i.test(src);
    let dec = src;
    try { dec = decodeURIComponent(src); } catch { /* raw */ }
    out.push({
      from: lineFrom + m.index!, to: lineFrom + m.index! + m[0].length, target: src,
      path: remote ? null : resolve(dec, notePath), width: bar >= 0 ? parseSize(alt.slice(bar + 1)).w : undefined,
      kind: 'image', syntax: 'md',
    });
  }
  return out.sort((a, b) => a.from - b.from);
}

/** A line made only of 2+ images (and spaces) is shown as a row, side by side. */
export function imageRow(lineText: string, lineFrom: number, notePath: string): Embed[] | null {
  if (!lineText.includes('![')) return null;
  const embeds = findEmbeds(lineText, lineFrom, notePath);
  if (embeds.length < 2 || embeds.some(e => e.kind !== 'image')) return null;
  let rest = lineText;
  for (const e of [...embeds].reverse()) rest = rest.slice(0, e.from - lineFrom) + rest.slice(e.to - lineFrom);
  return rest.trim() ? null : embeds;
}

function imagesOnly(text: string, from: number): Embed[] | null {
  const embeds = findEmbeds(text, from, '');
  if (!embeds.length || embeds.some(e => e.kind !== 'image')) return null;
  let rest = text;
  for (const e of [...embeds].reverse()) rest = rest.slice(0, e.from - from) + rest.slice(e.to - from);
  return rest.trim() ? null : embeds;
}

/** Change that puts the images of lines a..b on one line (null if not possible). */
export function sideBySideChange(state: EditorState, a: number, b: number) {
  const la = state.doc.lineAt(a), lb = state.doc.lineAt(b);
  const srcs: string[] = [];
  for (let n = la.number; n <= lb.number; n++) {
    const l = state.doc.line(n);
    if (!l.text.trim()) continue;
    const e = imagesOnly(l.text, l.from);
    if (!e) return null;
    srcs.push(...e.map(x => state.sliceDoc(x.from, x.to)));
  }
  if (srcs.length < 2 || la.number === lb.number) return null;
  return { from: la.from, to: lb.to, insert: srcs.join(' ') };
}

/** Change that puts each image of an image row on its own line (null if not a row). */
export function stackedChange(state: EditorState, pos: number) {
  const l = state.doc.lineAt(pos);
  const e = imagesOnly(l.text, l.from);
  if (!e || e.length < 2) return null;
  return { from: l.from, to: l.to, insert: e.map(x => state.sliceDoc(x.from, x.to)).join('\n') };
}

/** Rewrite the size part of an image reference (null = original size). */
export function withWidth(src: string, w: number | null): string {
  const wiki = /^!\[\[([^\[\]|]+?)(?:\|([^\]]*))?\]\]$/.exec(src);
  if (wiki) return w == null ? `![[${wiki[1]}]]` : `![[${wiki[1]}|${w}]]`;
  const md = /^!\[([^\]]*)\]\((.*)\)$/.exec(src);
  if (!md) return src;
  const alt = md[1].replace(/\|\s*\d+(x\d+)?\s*$/, '');
  return w == null ? `![${alt}](${md[2]})` : `![${alt}|${w}](${md[2]})`;
}

export class ImageWidget extends WidgetType {
  readonly version: number;
  constructor(readonly target: string, readonly path: string | null, readonly width: number | undefined,
              readonly from: number, readonly to: number, readonly block: boolean) {
    super();
    this.version = path ? imageVersions.get(path) ?? 0 : 0;
  }

  eq(o: ImageWidget) {
    return o.target === this.target && o.path === this.path && o.width === this.width && o.block === this.block && o.version === this.version;
  }
  get estimatedHeight() { return this.block ? 260 : -1; }

  toDOM(view: EditorView) {
    const host = view.state.facet(editorHost);
    const remote = /^[a-z][\w+.-]*:/i.test(this.target);
    const wrap = document.createElement(this.block ? 'div' : 'span');
    wrap.className = 'internal-embed media-embed image-embed is-loaded' + (this.block ? ' cm-embed-block ordo-image-below' : ' ordo-image-inline');
    wrap.setAttribute('contenteditable', 'false');
    wrap.setAttribute('src', this.target);
    // only takes effect inside an image row: keep the chosen width, shrink if needed
    if (this.width) wrap.style.flex = `0 1 ${this.width}px`;
    if (!this.path && !remote) {
      wrap.classList.add('is-unresolved');
      wrap.textContent = t('„{name}“ nicht gefunden', { name: this.target.split('|')[0] });
      return wrap;
    }
    const url = this.path ? versionedURL(this.path) : this.target;
    this.makeDraggable(view, wrap);
    const box = document.createElement('span');
    box.className = 'ordo-image-box';
    const img = document.createElement('img');
    img.decoding = 'async';   // decode big photos off the main thread, typing stays smooth
    img.src = url;
    img.draggable = false;
    img.alt = this.target.split('|')[0];
    if (this.width) img.style.width = this.width + 'px';
    img.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); host?.openImage(this.path ?? '', url); });

    const handle = document.createElement('span');
    handle.className = 'ordo-image-handle';
    handle.title = t('Ziehen zum Skalieren');
    const label = document.createElement('span');
    label.className = 'ordo-image-source';

    handle.addEventListener('pointerdown', e => {
      e.preventDefault();
      e.stopPropagation();
      handle.setPointerCapture(e.pointerId);
      const startX = e.clientX, startW = img.getBoundingClientRect().width;
      const max = view.contentDOM.clientWidth;
      const src = view.state.sliceDoc(this.from, this.to);
      let w = Math.round(startW);
      box.classList.add('is-resizing');
      label.textContent = withWidth(src, w);
      const move = (ev: PointerEvent) => {
        w = Math.round(Math.max(40, Math.min(max, startW + ev.clientX - startX)));
        img.style.width = w + 'px';
        wrap.style.flex = `0 1 ${w}px`;   // in an image row the slot follows the drag right away
        label.textContent = withWidth(src, w);
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        box.classList.remove('is-resizing');
        if (Math.abs(w - startW) < 2) return;
        commitWidth(view, this.from, this.to, this.target, w);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });

    const tools = document.createElement('span');
    tools.className = 'ordo-image-tools';
    const mk = (text: string, fn: () => void) => {
      const b = document.createElement('button');
      b.textContent = text;
      b.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); fn(); });
      tools.appendChild(b);
    };
    if (this.path) mk(t('Bearbeiten'), () => host?.editImage(this.path!, url));
    if (this.path && /\.(jpe?g|png)$/i.test(this.path)) mk(t('Verkleinern'), () => emit('compress-image', this.path));
    if (this.width) mk(t('Originalgröße'), () => commitWidth(view, this.from, this.to, this.target, null));
    mk(t('Link zeigen'), () => { view.dispatch({ selection: { anchor: this.to } }); view.focus(); });

    box.append(img, handle, label, tools);
    wrap.appendChild(box);
    return wrap;
  }
  ignoreEvent() { return true; }

  /** Drag the picture onto another one (left/right half) to place them side by side. */
  private makeDraggable(view: EditorView, wrap: HTMLElement) {
    wrap.draggable = true;
    wrap.addEventListener('dragstart', e => {
      if ((e.target as HTMLElement).closest?.('.ordo-image-handle, .ordo-image-tools')) { e.preventDefault(); return; }
      const src = view.state.sliceDoc(this.from, this.to);
      e.dataTransfer?.setData(DRAG_TYPE, JSON.stringify({ from: this.from, to: this.to, src }));
      e.dataTransfer?.setData('text/plain', src);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      wrap.classList.add('is-dragging');
    });
    wrap.addEventListener('dragend', () => wrap.classList.remove('is-dragging'));
    const side = (e: DragEvent) => { const r = wrap.getBoundingClientRect(); return e.clientX < r.left + r.width / 2 ? 'before' : 'after'; };
    const clear = () => wrap.classList.remove('drop-before', 'drop-after');
    wrap.addEventListener('dragover', e => {
      if (!e.dataTransfer?.types.includes(DRAG_TYPE)) return;
      e.preventDefault(); e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      const s = side(e);
      wrap.classList.toggle('drop-before', s === 'before'); wrap.classList.toggle('drop-after', s === 'after');
    });
    wrap.addEventListener('dragleave', clear);
    wrap.addEventListener('drop', e => {
      const data = e.dataTransfer?.getData(DRAG_TYPE);
      clear();
      if (!data) return;
      e.preventDefault(); e.stopPropagation();
      moveEmbed(view, JSON.parse(data), { at: side(e) === 'before' ? this.from : this.to, joinBefore: side(e) === 'before' });
    });
  }
}

const DRAG_TYPE = 'application/x-ordo-embed';
interface DragData { from: number; to: number; src: string }

/** Where the dragged embed currently is (positions may have shifted). */
function locate(state: EditorState, d: DragData): { from: number; to: number } | null {
  if (state.sliceDoc(d.from, d.to) === d.src) return d;
  const i = state.doc.toString().indexOf(d.src);
  return i < 0 ? null : { from: i, to: i + d.src.length };
}

/** Range to delete so no empty line or double space is left behind. */
function removal(state: EditorState, from: number, to: number) {
  const line = state.doc.lineAt(from);
  if (!(line.text.slice(0, from - line.from) + line.text.slice(to - line.from)).trim()) {
    return line.to < state.doc.length ? { from: line.from, to: line.to + 1 } : { from: Math.max(0, line.from - 1), to: line.to };
  }
  if (state.sliceDoc(to, to + 1) === ' ') return { from, to: to + 1 };
  if (state.sliceDoc(from - 1, from) === ' ') return { from: from - 1, to };
  return { from, to };
}

/**
 * Move an image embed. `target.at` + joinBefore: next to another image on its
 * line; `target.line`: onto its own line after that line.
 */
export function moveEmbed(view: EditorView, d: DragData, target: { at: number; joinBefore: boolean } | { line: number }) {
  const state = view.state;
  const cur = locate(state, d);
  if (!cur) return false;
  let insert: { from: number; insert: string };
  if ('at' in target) {
    if (target.at >= cur.from && target.at <= cur.to) return false;   // dropped on itself
    insert = { from: target.at, insert: target.joinBefore ? d.src + ' ' : ' ' + d.src };
  } else {
    const line = state.doc.line(target.line);
    if (cur.from >= line.from && cur.to <= line.to) return false;
    insert = { from: line.to, insert: '\n' + d.src };
  }
  const del = removal(state, cur.from, cur.to);
  if (insert.from > del.from && insert.from < del.to) return false;
  view.dispatch({ changes: [del, insert], userEvent: 'move.drop' });
  return true;
}

/** Dropping a picture between lines puts it on its own line there. */
export const imageDrop = EditorView.domEventHandlers({
  dragover(e) { if (e.dataTransfer?.types.includes(DRAG_TYPE)) { e.preventDefault(); return true; } return false; },
  drop(e, view) {
    const data = e.dataTransfer?.getData(DRAG_TYPE);
    if (!data) return false;
    e.preventDefault();
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
    if (pos != null) moveEmbed(view, JSON.parse(data), { line: view.state.doc.lineAt(pos).number });
    return true;
  },
});

/** Positions may have shifted since the widget was drawn: find the embed again. */
function commitWidth(view: EditorView, from: number, to: number, target: string, w: number | null) {
  const state = view.state;
  let a = from, b = to;
  const current = state.sliceDoc(a, b);
  if (!current.startsWith('![') || !current.includes(target.split('|')[0])) {
    const line = state.doc.lineAt(Math.min(from, state.doc.length));
    const e = findEmbeds(line.text, line.from, '').find(x => x.target.split('|')[0] === target.split('|')[0]);
    if (!e) return;
    a = e.from; b = e.to;
  }
  const src = state.sliceDoc(a, b);
  const next = withWidth(src, w);
  if (next !== src) view.dispatch({ changes: { from: a, to: b, insert: next } });
}

/** Several pictures of one line, side by side below the source. */
class ImageRowWidget extends WidgetType {
  constructor(readonly items: ImageWidget[]) { super(); }
  eq(o: ImageRowWidget) { return o.items.length === this.items.length && o.items.every((w, i) => w.eq(this.items[i])); }
  get estimatedHeight() { return 260; }
  toDOM(view: EditorView) {
    const row = document.createElement('div');
    row.className = 'cm-embed-block ordo-image-below ordo-image-row' + (this.items.length > 3 ? ' is-wrapped' : '');
    row.setAttribute('contenteditable', 'false');
    for (const w of this.items) row.appendChild(w.toDOM(view));
    return row;
  }
  ignoreEvent() { return true; }
}

export const refreshImages = StateEffect.define<null>();

/** Pictures below the cursor line (where the source is visible). */
function buildBelow(state: EditorState): DecorationSet {
  const host = state.facet(editorHost);
  const path = host?.path() ?? '';
  const decos: Range<Decoration>[] = [];
  const seen = new Set<number>();
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from).number, b = state.doc.lineAt(r.to).number;
    for (let i = a; i <= b; i++) {
      if (seen.has(i)) continue;
      seen.add(i);
      const line = state.doc.line(i);
      if (!line.text.includes('![')) continue;
      const row = imageRow(line.text, line.from, path);
      if (row) {
        const items = row.map(e => new ImageWidget(e.target, e.path, e.width, e.from, e.to, false));
        decos.push(Decoration.widget({ widget: new ImageRowWidget(items), block: true, side: 1 }).range(line.to));
        continue;
      }
      for (const e of findEmbeds(line.text, line.from, path)) {
        if (e.kind !== 'image') continue;
        decos.push(Decoration.widget({ widget: new ImageWidget(e.target, e.path, e.width, e.from, e.to, true), block: true, side: 1 }).range(line.to));
      }
    }
  }
  return Decoration.set(decos, true);
}

export const imagesBelowField = StateField.define<DecorationSet>({
  create: buildBelow,
  update(deco, tr) {
    if (tr.docChanged || tr.selection || tr.effects.some(e => e.is(refreshImages))) return buildBelow(tr.state);
    return deco;
  },
  provide: f => EditorView.decorations.from(f),
});
