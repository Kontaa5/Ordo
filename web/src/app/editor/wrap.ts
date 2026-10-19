// Typing ` * _ ~ = ( [ " while text is selected wraps the selection instead of
// replacing it; the text stays selected, so typing again wraps again (``x``,
// **x**, ==x==). Without a selection every key types normally.

import { EditorSelection, Prec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

const PAIRS: Record<string, string> = { '`': '`', '*': '*', '_': '_', '~': '~', '=': '=', '(': ')', '[': ']', '"': '"' };

function wrapSelection(view: EditorView, open: string): boolean {
  const close = PAIRS[open];
  const { state } = view;
  if (!close || state.selection.ranges.some(r => r.empty)) return false;
  view.dispatch(state.changeByRange(r => ({
    changes: [{ from: r.from, insert: open }, { from: r.to, insert: close }],
    range: EditorSelection.range(r.from + open.length, r.to + open.length),
  })), { userEvent: 'input.type', scrollIntoView: true });
  return true;
}

export const wrapOnType = [
  Prec.highest(EditorView.inputHandler.of((view, _from, _to, text) => wrapSelection(view, text))),
  // German Mac keyboard: Shift + ´ is a dead key for `. It would replace the selection with
  // a provisional ` and wait for the next key – so wrap right on the key press instead.
  Prec.highest(EditorView.domEventHandlers({
    keydown(e, view) {
      if (e.key !== 'Dead' || view.state.selection.main.empty) return false;
      const ch = e.code === 'Equal' && e.shiftKey ? '`' : null;
      if (!ch) return false;
      e.preventDefault();
      return wrapSelection(view, ch);
    },
  })),
];
