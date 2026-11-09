// Fold a heading like a folder: a small arrow left of every heading (visible on hover or when
// folded) hides everything up to the next heading of the same or a higher level.

import { EditorState, RangeSetBuilder } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType, keymap } from '@codemirror/view';
import { codeFolding, foldEffect, unfoldEffect, foldedRanges, foldKeymap, foldService, syntaxTree } from '@codemirror/language';
import { icon } from '../dom';
import { t } from '../i18n';

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
      if (u.docChanged || u.viewportChanged || u.transactions.some(tr => tr.effects.some(e => e.is(foldEffect) || e.is(unfoldEffect)))) this.decorations = build(u.view);
    }
  }, { decorations: v => v.decorations }),
];
