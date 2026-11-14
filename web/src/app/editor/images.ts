// Image embeds. Off the cursor line an embed shows only the picture (like
// Obsidian); on the cursor line the source is visible and the picture sits
// below it. Pictures can be resized by dragging; the new link is shown while
// dragging and written as `|width` on release.

import { EditorState, Range, StateEffect, StateField } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { resolve, fileURL, IMAGE_EXT, parseImageOpts, ImageAlign } from '../../vault';
import { editorHost } from './host';
import { emit } from '../host';
import { Menu } from '../ui/menu';
import { icon } from '../dom';

import { t } from '../i18n';
export interface Embed {
  from: number; to: number; target: string; path: string | null; width?: number; align?: ImageAlign;
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
    const o = parseImageOpts(m[2]);
    out.push({ from: lineFrom + m.index!, to: lineFrom + m.index! + m[0].length, target: m[1], path, width: o.w, align: o.align, kind, syntax: 'wiki' });
  }
  for (const m of lineText.matchAll(MD)) {
    const alt = m[1], src = m[2];
    const bar = alt.indexOf('|');
    const o = bar >= 0 ? parseImageOpts(alt.slice(bar + 1)) : { w: undefined, align: undefined };
    const remote = /^[a-z][\w+.-]*:/i.test(src);
    let dec = src;
    try { dec = decodeURIComponent(src); } catch { /* raw */ }
    out.push({
      from: lineFrom + m.index!, to: lineFrom + m.index! + m[0].length, target: src,
      path: remote ? null : resolve(dec, notePath), width: o.w, align: o.align,
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

/** Rewrite size and/or alignment of an image reference (w null = original size, align 'left' = default). Alt text stays. */
export function withOpts(src: string, set: { w?: number | null; align?: ImageAlign }): string {
  const build = (alt: string[], cur: ReturnType<typeof parseImageOpts>) => {
    const w = set.w === undefined ? cur.w : set.w;
    const align = set.align ?? cur.align;
    return [...alt, align && align !== 'left' ? align : '', w ? String(w) : ''].filter(Boolean);
  };
  const wiki = /^!\[\[([^\[\]|]+?)(?:\|([^\]]*))?\]\]$/.exec(src);
  if (wiki) {
    const cur = parseImageOpts(wiki[2]);
    return `![[${[wiki[1], ...build(cur.alt, cur)].join('|')}]]`;
  }
  const md = /^!\[([^\]]*)\]\((.*)\)$/.exec(src);
  if (!md) return src;
  const bar = md[1].indexOf('|');
  const first = bar >= 0 ? md[1].slice(0, bar) : md[1];
  const cur = parseImageOpts(bar >= 0 ? md[1].slice(bar + 1) : undefined);
  return `![${[first, ...build(cur.alt, cur)].join('|')}](${md[2]})`;
}
export function withWidth(src: string, w: number | null): string { return withOpts(src, { w }); }


// While a picture is resized (or pressed anywhere but its grip) no native drag may start – not of the picture,
// not of the editor text around it. Otherwise WebKit drags a snapshot over the page (it goes dark),
// the pointer events turn to nonsense and the width snaps to a few pixels.
let resizing = false;
let gripHeld = false;
document.addEventListener('dragstart', e => {
  const t = e.target instanceof Element ? e.target : null;
  if (resizing || (!gripHeld && t?.closest('.ordo-image-box, .image-embed'))) e.preventDefault();
}, true);
const EDGE = 30;   // px at the right edge of a picture that resize it (easy to hit with the trackpad)

export class ImageWidget extends WidgetType {
  readonly version: number;
  constructor(readonly target: string, readonly path: string | null, readonly width: number | undefined,
              readonly from: number, readonly to: number, readonly block: boolean, readonly align?: ImageAlign) {
    super();
    this.version = path ? imageVersions.get(path) ?? 0 : 0;
  }

  eq(o: ImageWidget) {
    return o.target === this.target && o.path === this.path && o.width === this.width && o.block === this.block && o.version === this.version && o.align === this.align;
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
    if (this.align && this.align !== 'left') wrap.classList.add('ordo-align-' + this.align);   // no effect inside an image row
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
    // the picture is painted as the box background, the <img> only sizes it (invisible): macOS Live Text only analyses
    // visible <img> elements and otherwise lays its own layer over them, which swallows clicks, drags and the buttons
    box.style.backgroundImage = `url("${url.replace(/["\\\n\r]/g, c => encodeURIComponent(c))}")`;
    // macOS Live Text: on a picture with text WebKit lays a text layer over the <img> that swallows clicks and drags
    // (buttons do nothing, dragging selects text). The <img> is never hit (CSS pointer-events: none) – the box takes the clicks.
    // centred: the picture grows to both sides (2× the pointer move); right-aligned: the grip is the LEFT edge
    const inRow = () => !!wrap.closest('.ordo-image-row');
    const rightAligned = () => this.align === 'right' && !inRow();
    if (this.align === 'right') box.classList.add('is-right');
    const isControl = (e: Event) => (e.target as HTMLElement).closest('.ordo-image-handle, .ordo-image-tools, .ordo-image-grip');
    let downAt = [0, 0];
    box.addEventListener('mousedown', e => { downAt = [e.clientX, e.clientY]; if (!isControl(e)) { e.preventDefault(); e.stopPropagation(); } });   // no text selection from the picture
    box.addEventListener('click', e => {
      if (isControl(e) || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;   // a drag is no click
      const r = box.getBoundingClientRect();
      if (rightAligned() ? e.clientX < r.left + EDGE : e.clientX > r.right - EDGE) return;   // the resize edge never opens the picture
      e.preventDefault(); e.stopPropagation();
      host?.openImage(this.path ?? '', url);
    });

    const handle = document.createElement('span');
    handle.className = 'ordo-image-handle';
    handle.title = t('Antippen oder ziehen zum Skalieren');
    const label = document.createElement('span');
    label.className = 'ordo-image-source';

    // trackpad: a second finger during the drag is a right click – no context menu, no restart of the resize
    box.addEventListener('contextmenu', e => {
      if (box.classList.contains('is-resizing') || (e.target as HTMLElement).closest('.ordo-image-handle')) { e.preventDefault(); e.stopPropagation(); }
    }, true);
    const alignItems = () => (['left', 'center', 'right'] as ImageAlign[]).map(a => ({
      title: t(a === 'left' ? 'Linksbündig' : a === 'center' ? 'Zentriert' : 'Rechtsbündig'), icon: 'align-' + a,
      checked: (this.align ?? 'left') === a, onClick: () => commitOpts(view, this.from, this.to, this.target, { align: a }),
    }));
    // right click on the picture: alignment + the picture's actions
    box.addEventListener('contextmenu', e => {
      if (e.defaultPrevented) return;
      e.preventDefault(); e.stopPropagation();
      const m = new Menu();
      for (const it of alignItems()) m.addItem(it);
      m.addSeparator();
      if (this.path) m.addItem({ title: t('Bearbeiten'), icon: 'pencil', onClick: () => host?.editImage(this.path!, url) });
      if (this.width) m.addItem({ title: t('Originalgröße'), icon: 'reset', onClick: () => commitWidth(view, this.from, this.to, this.target, null) });
      m.addItem({ title: t('Link zeigen'), icon: 'link', onClick: () => { view.dispatch({ selection: { anchor: this.to } }); view.focus(); } });
      m.showAtMouseEvent(e);
    });
    handle.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });   // no native drag / text selection from the edge
    // Resize: drag the right edge – or, on a trackpad, just TAP the edge: then the width follows the pointer
    // without holding anything, and the next tap / click sets it (Esc cancels). No long press needed.
    handle.addEventListener('pointerdown', e => {
      if (e.button !== 0 || box.classList.contains('is-resizing')) return;   // follow mode ends on the document handler
      wrap.draggable = false;
      delete wrap.dataset.grip;
      e.preventDefault();
      e.stopPropagation();
      try { handle.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
      const startX = e.clientX, startW = img.getBoundingClientRect().width;
      const max = view.contentDOM.clientWidth;
      let w = Math.round(startW), moved = false;
      const factor = inRow() ? 1 : this.align === 'center' ? 2 : this.align === 'right' ? -1 : 1;
      resizing = true;
      box.classList.add('is-resizing');
      label.textContent = `${w} px`;
      const apply = (x: number) => {
        w = Math.round(Math.max(40, Math.min(max, startW + factor * (x - startX))));
        img.style.width = w + 'px';
        wrap.style.flex = `0 1 ${w}px`;   // in an image row the slot follows right away
        label.textContent = `${w} px`;
      };
      const finish = (commit: boolean) => {
        resizing = false;
        box.classList.remove('is-resizing');
        if (!commit) { img.style.width = startW + 'px'; wrap.style.flex = ''; return; }
        if (Math.abs(w - startW) >= 2) commitWidth(view, this.from, this.to, this.target, w);
      };
      // 1) dragging with the button held
      const move = (ev: PointerEvent) => {
        if (ev.clientX === 0 && ev.clientY === 0) return;   // no real position – never snap to 40 px
        if (Math.abs(ev.clientX - startX) > 3) moved = true;
        apply(ev.clientX);
      };
      let done = false;
      const up = () => {
        if (done) return;
        done = true;
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        handle.removeEventListener('lostpointercapture', up);
        if (moved) { finish(true); return; }
        // 2) only a tap: follow the pointer until the next tap
        const follow = (ev: PointerEvent | MouseEvent) => { if (ev.clientX || ev.clientY) apply(ev.clientX); };
        const stop = (ev: Event, commit: boolean) => {
          ev.preventDefault(); ev.stopPropagation();
          document.removeEventListener('pointermove', follow, true);
          document.removeEventListener('mousemove', follow, true);
          document.removeEventListener('pointerdown', onDown, true);
          document.removeEventListener('keydown', onKey, true);
          // swallow the click that belongs to the finishing tap (it would open the picture / move the cursor)
          if (ev.type === 'pointerdown') document.addEventListener('click', ce => { ce.preventDefault(); ce.stopPropagation(); }, { capture: true, once: true });
          finish(commit);
        };
        const onDown = (ev: PointerEvent) => stop(ev, ev.button === 0);
        const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') stop(ev, false); else if (ev.key === 'Enter') stop(ev, true); };
        document.addEventListener('pointermove', follow, true);
        document.addEventListener('mousemove', follow, true);
        document.addEventListener('pointerdown', onDown, true);
        document.addEventListener('keydown', onKey, true);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
      handle.addEventListener('lostpointercapture', up);
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
    if (this.path && /\.(jpe?g|png)$/i.test(this.path)) mk(t('Komprimieren'), () => emit('compress-image', {
      path: this.path,
      share: Math.min(1, img.getBoundingClientRect().width / Math.max(1, view.contentDOM.clientWidth)),   // part of the text width it fills
      pixels: img.naturalWidth,
    }));
    {
      const b = document.createElement('button');
      b.className = 'ordo-image-align';
      b.title = t('Ausrichtung');
      b.appendChild(icon('align-' + (this.align ?? 'left'), 14));
      b.addEventListener('mousedown', e => {
        e.preventDefault(); e.stopPropagation();
        const m = new Menu();
        for (const it of alignItems()) m.addItem(it);
        m.showAtElement(b);
      });
      tools.appendChild(b);
    }
    if (this.width) mk(t('Originalgröße'), () => commitWidth(view, this.from, this.to, this.target, null));
    mk(t('Link zeigen'), () => { view.dispatch({ selection: { anchor: this.to } }); view.focus(); });

    // moving a picture (next to another one) only from this grip: a click on the picture never starts a drag
    const grip = document.createElement('span');
    grip.className = 'ordo-image-grip';
    grip.textContent = '⠿';
    grip.title = t('Ziehen, um das Bild zu verschieben');
    // draggable only while the grip is held: released anywhere (not only on the grip) ends it,
    // otherwise the next press on the picture or a button would start moving the picture
    grip.addEventListener('mousedown', () => {
      wrap.draggable = true;
      wrap.dataset.grip = '1';
      gripHeld = true;
      const off = () => { wrap.draggable = false; delete wrap.dataset.grip; gripHeld = false; };
      document.addEventListener('mouseup', off, { once: true, capture: true });
      wrap.addEventListener('dragend', off, { once: true });
    });
    box.append(img, handle, label, tools, grip);
    wrap.appendChild(box);
    return wrap;
  }
  ignoreEvent() { return true; }

  /** Drag the picture onto another one (left/right half) to place them side by side. */
  private makeDraggable(view: EditorView, wrap: HTMLElement) {
    wrap.draggable = false;   // switched on by the grip
    wrap.addEventListener('dragstart', e => {
      // only a drag that started on the grip moves the picture – never while resizing, never from the edge or a button
      if (wrap.dataset.grip !== '1' || wrap.querySelector('.is-resizing') || (e.target as HTMLElement).closest?.('.ordo-image-handle, .ordo-image-tools')) { e.preventDefault(); return; }
      const src = view.state.sliceDoc(this.from, this.to);
      e.dataTransfer?.setData(DRAG_TYPE, JSON.stringify({ from: this.from, to: this.to, src }));
      e.dataTransfer?.setData('text/plain', src);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      wrap.classList.add('is-dragging');
    });
    wrap.addEventListener('dragend', () => { wrap.classList.remove('is-dragging'); wrap.draggable = false; });
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

function commitWidth(view: EditorView, from: number, to: number, target: string, w: number | null) {
  commitOpts(view, from, to, target, { w });
}

/** Positions may have shifted since the widget was drawn: find the embed again. */
function commitOpts(view: EditorView, from: number, to: number, target: string, set: { w?: number | null; align?: ImageAlign }) {
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
  const next = withOpts(src, set);
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
        const items = row.map(e => new ImageWidget(e.target, e.path, e.width, e.from, e.to, false, e.align));
        decos.push(Decoration.widget({ widget: new ImageRowWidget(items), block: true, side: 1 }).range(line.to));
        continue;
      }
      for (const e of findEmbeds(line.text, line.from, path)) {
        if (e.kind !== 'image') continue;
        decos.push(Decoration.widget({ widget: new ImageWidget(e.target, e.path, e.width, e.from, e.to, true, e.align), block: true, side: 1 }).range(line.to));
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
