// Typing ` * _ ~ = ( [ " while text is selected wraps the selection instead of
// replacing it; the text stays selected, so typing again wraps again (``x``,
// **x**, ==x==). Without a selection every key types normally.

import { EditorSelection, Prec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { request } from '../host';

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

/** A quote that closes an already open one (odd number of " before it on the line) is typed
 *  alone – closeBrackets would otherwise add a second one at the end of a sentence (`"Satz ""`). */
function closingQuote(view: EditorView, from: number, to: number, text: string): boolean {
  if ((text !== '"' && text !== "'") || from !== to || view.state.selection.ranges.length > 1) return false;
  if (view.state.sliceDoc(from, from + 1) === text) return false;   // closeBrackets steps over its own quote
  const line = view.state.doc.lineAt(from);
  if ((line.text.slice(0, from - line.from).split(text).length - 1) % 2 === 0) return false;
  view.dispatch({ changes: { from, insert: text }, selection: { anchor: from + 1 }, userEvent: 'input.type', scrollIntoView: true });
  return true;
}

export const wrapOnType = [
  Prec.highest(EditorView.inputHandler.of((view, from, to, text) => wrapSelection(view, text) || closingQuote(view, from, to, text))),
  // German Mac keyboard: Shift + ´ is a dead key for `. macOS would wait for the next key and
  // combine it (a → à) – so wrap right on the key press and tell macOS to forget the key.
  Prec.highest(EditorView.domEventHandlers({
    keydown(e, view) {
      if (e.key !== 'Dead' || view.state.selection.main.empty) return false;
      const ch = e.code === 'Equal' && e.shiftKey ? '`' : null;
      if (!ch) return false;
      e.preventDefault();
      const done = wrapSelection(view, ch);
      // the key is still pending in macOS (a → á, space → `): drop it, also once more after the event
      if (done) { request('discardMarkedText').catch(() => {}); setTimeout(() => request('discardMarkedText').catch(() => {}), 0); }
      return done;
    },
  })),
];
