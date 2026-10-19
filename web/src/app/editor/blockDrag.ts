// Drag blocks like in Notion: a grip appears left of the block under the
// mouse. Drop it on the left/right edge of another block to put both into
// columns (> [!multi-column], at most 3), or above/below a block to move it.

import { EditorState } from '@codemirror/state';
import { EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { notice } from '../ui/notice';
import { t } from '../i18n';

export interface Block { from: number; to: number }
type Zone = 'before' | 'after' | 'left' | 'right';

const DRAG_BLOCK = 'application/x-ordo-block';
const COLUMNS = /^>\s*\[!(multi-column|columns|spalten)\]/i;
export const MAX_COLUMNS = 3;

function frontmatterEnd(state: EditorState): number {
  const doc = state.doc;
  if (doc.lines < 2 || doc.line(1).text.trim() !== '---') return -1;
  for (let i = 2; i <= Math.min(doc.lines, 300); i++) if (/^(---|\.\.\.)\s*$/.test(doc.line(i).text)) return doc.line(i).to;
  return -1;
}

/** Top-level blocks (whole lines), frontmatter excluded. */
export function topBlocks(state: EditorState): Block[] {
  const out: Block[] = [];
  const fm = frontmatterEnd(state);
  const cur = syntaxTree(state).topNode.firstChild;
  for (let n = cur; n; n = n.nextSibling) {
    if (n.to <= fm) continue;
    const from = state.doc.lineAt(n.from).from, to = state.doc.lineAt(Math.max(n.from, n.to - (state.sliceDoc(n.to - 1, n.to) === '\n' ? 1 : 0))).to;
    if (!state.sliceDoc(from, to).trim()) continue;
    if (out.length && from <= out[out.length - 1].to) { out[out.length - 1].to = Math.max(out[out.length - 1].to, to); continue; }
    out.push({ from, to });
  }
  return out;
}

const blockAt = (blocks: Block[], pos: number) => blocks.find(b => pos >= b.from && pos <= b.to) ?? null;
const isColumns = (state: EditorState, b: Block) => COLUMNS.test(state.doc.lineAt(b.from).text);
const columnCount = (text: string) => text.split('\n').filter(l => /^>>\s*\[!/.test(l)).length;
const asColumn = (text: string) => '>> [!blank]\n' + text.split('\n').map(l => (l.trim() ? '>> ' + l : '>>')).join('\n');

/** Range to cut out so no run of empty lines is left behind. */
function cut(state: EditorState, b: Block) {
  const doc = state.doc;
  let to = b.to;
  // swallow the line break and one empty line after the block
  if (to < doc.length) to++;
  if (to < doc.length && doc.lineAt(to).text.trim() === '' && doc.lineAt(to).to < doc.length) to = doc.lineAt(to).to + 1;
  let from = b.from;
  if (to >= doc.length && from > 0) { from--; if (from > 0 && doc.lineAt(from).text.trim() === '') from = Math.max(0, doc.lineAt(from).from - 1); }
  return { from, to: Math.min(to, doc.length) };
}

/** The edit for dropping block `src` at `zone` of block `dst` (null = not possible). */
export function blockDropChanges(state: EditorState, src: Block, dst: Block, zone: Zone) {
  if (src.from === dst.from) return null;
  const text = state.sliceDoc(src.from, src.to);
  const del = cut(state, src);
  if (dst.from < del.to && dst.to > del.from) return null;
  let ins: { from: number; to?: number; insert: string };
  if ((zone === 'left' || zone === 'right') && COLUMNS.test(text)) zone = zone === 'left' ? 'before' : 'after';   // no columns inside columns
  if (zone === 'before') ins = { from: dst.from, insert: text + '\n\n' };
  else if (zone === 'after') ins = { from: dst.to, insert: '\n\n' + text };
  else if (isColumns(state, dst)) {
    const dstText = state.sliceDoc(dst.from, dst.to);
    if (columnCount(dstText) >= MAX_COLUMNS) return 'full' as const;
    const at = zone === 'left' ? state.doc.lineAt(dst.from).to : dst.to;
    ins = { from: at, insert: '\n>\n' + asColumn(text) };
  } else {
    const target = state.sliceDoc(dst.from, dst.to);
    const [a, b] = zone === 'left' ? [text, target] : [target, text];
    ins = { from: dst.from, to: dst.to, insert: `> [!multi-column]\n>\n${asColumn(a)}\n>\n${asColumn(b)}` };
  }
  return [del, ins];
}

/** Selected blocks (2–3, no columns among them) → one columns block, side by side. */
export function sideBySideBlocksChange(state: EditorState, from: number, to: number) {
  const sel = topBlocks(state).filter(b => b.to >= from && b.from <= to);
  if (sel.length < 2 || sel.length > MAX_COLUMNS || sel.some(b => isColumns(state, b))) return null;
  // pictures-only lines are handled by "Bilder nebeneinander"
  if (sel.every(b => /^(\s*!\[[^\n]*\s*)+$/.test(state.sliceDoc(b.from, b.to)))) return null;
  const cols = sel.map(b => asColumn(state.sliceDoc(b.from, b.to))).join('\n>\n');
  return { from: sel[0].from, to: sel[sel.length - 1].to, insert: `> [!multi-column]\n>\n${cols}` };
}

/** Columns block → its columns one after another again. */
export function unwrapColumnsChange(state: EditorState, pos: number) {
  const b = blockAt(topBlocks(state), pos);
  if (!b || !isColumns(state, b)) return null;
  const cols: string[][] = [];
  for (const line of state.sliceDoc(b.from, b.to).split('\n').slice(1)) {
    if (/^>>\s*\[!blank\]/i.test(line)) { cols.push([]); continue; }
    if (/^>>/.test(line)) { if (!cols.length) cols.push([]); cols[cols.length - 1].push(line.replace(/^>>\s?/, '')); }
  }
  const text = cols.map(c => c.join('\n').trim()).filter(Boolean).join('\n\n');
  return { from: b.from, to: b.to, insert: text };
}

const GRIP = '<svg viewBox="0 0 10 16" width="10" height="16" fill="currentColor"><circle cx="2.5" cy="3" r="1.4"/><circle cx="7.5" cy="3" r="1.4"/><circle cx="2.5" cy="8" r="1.4"/><circle cx="7.5" cy="8" r="1.4"/><circle cx="2.5" cy="13" r="1.4"/><circle cx="7.5" cy="13" r="1.4"/></svg>';

export const blockDrag = ViewPlugin.fromClass(class {
  handle: HTMLElement;
  indicator: HTMLElement;
  blocks: Block[] | null = null;
  hovered: Block | null = null;
  dragging: Block | null = null;
  hideTimer = 0;

  constructor(readonly view: EditorView) {
    this.handle = document.createElement('div');
    this.handle.className = 'ordo-block-handle';
    this.handle.innerHTML = GRIP;
    this.handle.draggable = true;
    this.handle.title = t('Ziehen: verschieben oder neben einen Block legen (Spalten)');
    this.handle.addEventListener('dragstart', e => this.dragStart(e));
    this.handle.addEventListener('dragend', () => { this.dragging = null; this.indicator.hidden = true; this.view.dom.classList.remove('is-block-dragging'); });
    this.handle.addEventListener('mouseenter', () => clearTimeout(this.hideTimer));
    this.indicator = document.createElement('div');
    this.indicator.className = 'ordo-block-drop';
    this.indicator.hidden = true;
    this.handle.hidden = true;
    view.dom.append(this.handle, this.indicator);
    view.contentDOM.addEventListener('mousemove', this.onMove);
    view.dom.addEventListener('mouseleave', this.onLeave);
    view.scrollDOM.addEventListener('scroll', this.onLeave);
    // native listeners: drops on rendered blocks (widgets) never reach CodeMirror's own handlers
    view.dom.addEventListener('dragover', this.onDragOver);
    view.dom.addEventListener('dragleave', this.onDragLeave);
    view.dom.addEventListener('drop', this.onDrop, true);
  }

  update(u: ViewUpdate) { if (u.docChanged || u.viewportChanged) { this.blocks = null; if (u.docChanged) this.hide(); } }
  destroy() {
    this.view.contentDOM.removeEventListener('mousemove', this.onMove);
    this.view.dom.removeEventListener('mouseleave', this.onLeave);
    this.view.scrollDOM.removeEventListener('scroll', this.onLeave);
    this.view.dom.removeEventListener('dragover', this.onDragOver);
    this.view.dom.removeEventListener('dragleave', this.onDragLeave);
    this.view.dom.removeEventListener('drop', this.onDrop, true);
    this.handle.remove(); this.indicator.remove();
  }

  getBlocks() { return (this.blocks ??= topBlocks(this.view.state)); }
  hide() { this.handle.hidden = true; this.hovered = null; }

  onLeave = () => { if (this.dragging) return; clearTimeout(this.hideTimer); this.hideTimer = window.setTimeout(() => this.hide(), 250); };

  onMove = (e: MouseEvent) => {
    if (this.dragging || e.buttons) return;
    clearTimeout(this.hideTimer);
    const pos = this.view.posAtCoords({ x: e.clientX, y: e.clientY }, false);
    const b = blockAt(this.getBlocks(), pos);
    if (!b) { this.hide(); return; }
    if (b === this.hovered && !this.handle.hidden) return;
    this.hovered = b;
    const c = this.view.coordsAtPos(b.from, 1);
    if (!c) return;
    const root = this.view.dom.getBoundingClientRect(), content = this.view.contentDOM.getBoundingClientRect();
    const lineH = Math.max(16, Math.min(c.bottom - c.top, 40));
    Object.assign(this.handle.style, { top: c.top - root.top + (lineH - 22) / 2 + 'px', left: content.left - root.left - 24 + 'px' });
    this.handle.hidden = false;
  };

  dragStart(e: DragEvent) {
    const b = this.hovered;
    if (!b || !e.dataTransfer) { e.preventDefault(); return; }
    this.dragging = b;
    e.dataTransfer.setData(DRAG_BLOCK, JSON.stringify(b));
    e.dataTransfer.setData('text/plain', this.view.state.sliceDoc(b.from, b.to));
    e.dataTransfer.effectAllowed = 'move';
    const ghost = document.createElement('div');
    ghost.className = 'ordo-block-ghost';
    ghost.textContent = this.view.state.sliceDoc(b.from, Math.min(b.to, b.from + 80)).split('\n')[0];
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 10, 10);
    setTimeout(() => ghost.remove(), 0);
    this.view.dom.classList.add('is-block-dragging');
  }

  /** Target block and zone under the pointer while dragging. */
  target(e: DragEvent): { block: Block; zone: Zone } | null {
    const pos = this.view.posAtCoords({ x: e.clientX, y: e.clientY }, false);
    const block = blockAt(this.getBlocks(), pos);
    if (!block) return null;
    const top = this.view.coordsAtPos(block.from, 1)?.top, bottom = this.view.coordsAtPos(block.to, -1)?.bottom;
    if (top == null || bottom == null) return null;
    const content = this.view.contentDOM.getBoundingClientRect();
    const edge = Math.min(120, content.width * 0.2);
    const zone: Zone = e.clientX < content.left + edge ? 'left' : e.clientX > content.right - edge ? 'right' : e.clientY < (top + bottom) / 2 ? 'before' : 'after';
    return { block, zone };
  }

  onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer?.types.includes(DRAG_BLOCK)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const tg = this.target(e);
    if (tg) this.showIndicator(tg.block, tg.zone); else this.indicator.hidden = true;
  };
  onDragLeave = (e: DragEvent) => { if (!this.view.dom.contains(e.relatedTarget as Node)) this.indicator.hidden = true; };
  onDrop = (e: DragEvent) => {
    const data = e.dataTransfer?.getData(DRAG_BLOCK);
    if (!data) return;
    e.preventDefault(); e.stopPropagation();
    this.indicator.hidden = true;
    const tg = this.target(e);
    if (!tg) return;
    this.drop(JSON.parse(data) as Block, tg.block, tg.zone);
  };

  drop(src: Block, dst: Block, zone: Zone) {
    const ch = blockDropChanges(this.view.state, src, dst, zone);
    if (ch === 'full') notice(t('Maximal {n} Spalten', { n: MAX_COLUMNS }));
    else if (ch) this.view.dispatch({ changes: ch, userEvent: 'move.drop' });
  }

  showIndicator(block: Block, zone: Zone) {
    const top = this.view.coordsAtPos(block.from, 1)!.top, bottom = this.view.coordsAtPos(block.to, -1)!.bottom;
    const root = this.view.dom.getBoundingClientRect(), content = this.view.contentDOM.getBoundingClientRect();
    const s = this.indicator.style;
    const side = zone === 'left' || zone === 'right';
    this.indicator.className = 'ordo-block-drop is-' + (side ? 'vertical' : 'horizontal') + (zone === 'left' ? ' is-left' : '');
    this.indicator.dataset.label = side ? t('Daneben als Spalte') : t('Hierher verschieben');
    if (zone === 'left' || zone === 'right') Object.assign(s, { top: top - root.top + 'px', height: bottom - top + 'px', width: '3px', left: (zone === 'left' ? content.left - 6 : content.right + 3) - root.left + 'px' });
    else Object.assign(s, { top: (zone === 'before' ? top - 4 : bottom + 2) - root.top + 'px', height: '3px', left: content.left - root.left + 'px', width: content.width + 'px' });
    this.indicator.hidden = false;
  }
});
