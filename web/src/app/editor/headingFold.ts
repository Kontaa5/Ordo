// Fold a heading like a folder: a small arrow left of every heading (visible on hover or when
// folded) hides everything up to the next heading of the same or a higher level.

import { EditorState, RangeSetBuilder } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType, keymap } from '@codemirror/view';
import { codeFolding, foldEffect, unfoldEffect, foldedRanges, foldKeymap, foldService, syntaxTree } from '@codemirror/language';
import { icon } from '../dom';
import { t } from '../i18n';
import { editorHost } from './host';

// ── remembered per note (like Obsidian): the folded headings by text + occurrence, so edits elsewhere don't lose them ──
const KEY = (path: string) => 'ordo-folds:' + path;
function headingKeys(state: EditorState, lineStarts: number[]): string[] {
  const seen = new Map<string, number>(), want = new Set(lineStarts), out: string[] = [];
  for (let n = 1; n <= state.doc.lines; n++) {
    const l = state.doc.line(n);
    if (!HEADING.test(l.text)) continue;
    const k = l.text.trim(), i = seen.get(k) ?? 0;
    seen.set(k, i + 1);
    if (want.has(l.from)) out.push(i ? `${k}\u0000${i}` : k);
  }
  return out;
}
function saveFolds(view: EditorView) {
  const path = view.state.facet(editorHost)?.path();
  if (!path) return;
  const starts: number[] = [];
  foldedRanges(view.state).between(0, view.state.doc.length, a => { starts.push(view.state.doc.lineAt(a).from); });
  const keys = headingKeys(view.state, starts);
  try { keys.length ? localStorage.setItem(KEY(path), JSON.stringify(keys)) : localStorage.removeItem(KEY(path)); } catch { /* storage off */ }
}
/** Fold again what was folded when the note was last open. */
export function restoreFolds(view: EditorView, path: string) {
  let keys: string[] = [];
  try { keys = JSON.parse(localStorage.getItem(KEY(path)) ?? '[]'); } catch { return; }
  if (!Array.isArray(keys) || !keys.length) return;
  const want = new Set(keys.filter(k => typeof k === 'string')), seen = new Map<string, number>(), effects = [];
  const state = view.state;
  for (let n = 1; n <= state.doc.lines; n++) {
    const l = state.doc.line(n);
    if (!HEADING.test(l.text)) continue;
    const k = l.text.trim(), i = seen.get(k) ?? 0;
    seen.set(k, i + 1);
    if (!want.has(i ? `${k}\u0000${i}` : k)) continue;
    const r = sectionAt(state, l.from);
    if (r) effects.push(foldEffect.of(r));
  }
  if (effects.length) view.dispatch({ effects });
}

/** Fold (or unfold) every heading of the note. */
export function foldAllHeadings(view: EditorView, fold: boolean) {
  const state = view.state, effects = [];
  if (!fold) {
    foldedRanges(state).between(0, state.doc.length, (from, to) => { effects.push(unfoldEffect.of({ from, to })); });
  } else {
    for (let n = 1; n <= state.doc.lines; n++) {
      const l = state.doc.line(n);
      if (!HEADING.test(l.text)) continue;
      const r = sectionAt(state, l.from);
      if (r && !isFolded(state, r.from, r.to)) effects.push(foldEffect.of(r));
    }
  }
  if (effects.length) view.dispatch({ effects });
}

const HEADING = /^(#{1,6})\s/;

/** Range a heading folds: from the end of its line to the line before the next heading of level ≤ its own. */
function sectionAt(state: EditorState, lineStart: number): { from: number; to: number } | null {
  const line = state.doc.lineAt(lineStart);
  const m = HEADING.exec(line.text);
  if (!m || inCode(state, line.from)) return null;
  const level = m[1].length;
  let end = line;
  for (let n = line.number + 1; n <= state.doc.lines; n++) {
    const l = state.doc.line(n);
    const h = HEADING.exec(l.text);
    if (h && h[1].length <= level && !inCode(state, l.from)) break;
    end = l;
  }
  while (end.number > line.number && !end.text.trim()) end = state.doc.line(end.number - 1);   // keep the blank line before the next heading
  return end.to > line.to ? { from: line.to, to: end.to } : null;
}

function inCode(state: EditorState, pos: number) {
  for (let n: any = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) if (n.name === 'FencedCode' || n.name === 'CodeBlock') return true;
  return false;
}

function isFolded(state: EditorState, from: number, to: number) {
  let found = false;
  foldedRanges(state).between(from, to, (a, b) => { if (a === from && b === to) found = true; });
  return found;
}

class FoldArrow extends WidgetType {
  constructor(readonly folded: boolean) { super(); }
  eq(o: FoldArrow) { return o.folded === this.folded; }
  toDOM(view: EditorView) {
    const b = document.createElement('span');
    b.className = 'ordo-heading-fold' + (this.folded ? ' is-folded' : '');
    b.title = this.folded ? t('Ausklappen') : t('Einklappen');
    b.appendChild(icon('chevron-down'));
    b.addEventListener('mousedown', e => {
      e.preventDefault(); e.stopPropagation();
      const range = sectionAt(view.state, view.state.doc.lineAt(view.posAtDOM(b)).from);
      if (!range) return;
      view.dispatch({ effects: (isFolded(view.state, range.from, range.to) ? unfoldEffect : foldEffect).of(range) });
    });
    return b;
  }
  ignoreEvent() { return true; }
}

function build(view: EditorView): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = view.state.doc.lineAt(pos);
      const range = HEADING.test(line.text) ? sectionAt(view.state, line.from) : null;
      if (range) b.add(line.from, line.from, Decoration.widget({ widget: new FoldArrow(isFolded(view.state, range.from, range.to)), side: -1 }));
      pos = line.to + 1;
    }
  }
  return b.finish();
}

export const headingFold = [
  foldService.of((state, lineStart) => sectionAt(state, lineStart)),   // also ⌘⌥[ / ⌘⌥] (fold keymap)
  codeFolding({
    placeholderDOM: (_view, onclick) => {
      const s = document.createElement('span');
      s.className = 'cm-foldPlaceholder ordo-fold-placeholder';
      s.textContent = '…';
      s.title = t('Ausklappen');
      s.onclick = onclick;
      return s;
    },
  }),
  keymap.of(foldKeymap),
  ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = build(view); }
    update(u: ViewUpdate) {
      const folding = u.transactions.some(tr => tr.effects.some(e => e.is(foldEffect) || e.is(unfoldEffect)));
      if (u.docChanged || u.viewportChanged || folding) this.decorations = build(u.view);
      if (folding) saveFolds(u.view);
    }
  }, { decorations: v => v.decorations }),
];

// ── reading view: the same arrow in front of every heading, hides the section below it ──

const levelOf = (el: Element) => /^H([1-6])$/.exec(el.tagName)?.[1];

/** Hide everything below a folded heading up to the next heading of the same or a higher level (nested folds too). */
function applyFolds(root: HTMLElement) {
  let hideBelow = Infinity;   // level of the folded heading that hides the current part, Infinity = visible
  for (const el of Array.from(root.children) as HTMLElement[]) {
    const lv = levelOf(el);
    if (lv && +lv <= hideBelow) hideBelow = Infinity;
    const hidden = hideBelow !== Infinity;
    el.classList.toggle('ordo-fold-hidden', hidden);
    if (lv && !hidden && el.classList.contains('is-collapsed')) hideBelow = +lv;
  }
}

export function addReadingFolds(root: HTMLElement) {
  const heads = (Array.from(root.children) as HTMLElement[]).filter(el => levelOf(el));
  for (const head of heads) {
    const next = head.nextElementSibling;
    if (!next || (levelOf(next) && +levelOf(next)! <= +levelOf(head)!)) continue;   // nothing to fold
    const b = document.createElement('span');
    b.className = 'ordo-heading-fold';
    b.title = t('Einklappen');
    b.appendChild(icon('chevron-down'));
    b.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      const folded = head.classList.toggle('is-collapsed');
      b.classList.toggle('is-folded', folded);
      b.title = folded ? t('Ausklappen') : t('Einklappen');
      applyFolds(root);
    });
    head.prepend(b);
  }
}
