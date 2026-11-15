// The selection inside inline code and ==highlights== (#20): CodeMirror draws the selection in a layer below
// the text, so the background of those spans hides it. The selected text there also gets a mark, innermost
// (highest precedence: CodeMirror renders it inside the other marks), which the CSS colours only inside such spans – elsewhere the normal layer shows.

import { Prec, RangeSetBuilder } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';

const sel = Decoration.mark({ class: 'ordo-sel' });

function build(view: EditorView): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  for (const r of view.state.selection.ranges) if (!r.empty) b.add(r.from, r.to, sel);
  return b.finish();
}

export const selectionMark = Prec.highest(ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = build(view); }
  update(u: ViewUpdate) { if (u.selectionSet || u.docChanged) this.decorations = build(u.view); }
}, { decorations: v => v.decorations }));
