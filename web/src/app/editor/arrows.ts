// Typing arrows: "->" becomes →, "<-" becomes ←, "<->" becomes ↔, "=>" becomes ⇒.
// Not inside code or math. Backspace right after a replacement brings the typed text back.

import { keymap } from '@codemirror/view';
import { EditorState, Prec, StateEffect, StateField } from '@codemirror/state';
import { inCode } from './livePreview';

const RULES: [string, string, string][] = [   // [char before, typed char, result]
  ['-', '>', '→'],
  ['<', '-', '←'],
  ['←', '>', '↔'],
  ['=', '>', '⇒'],
];

/** The last replacement, so Backspace can undo it: [position after the arrow, original text]. */
const lastArrow = StateEffect.define<[number, string] | null>();
const lastArrowField = StateField.define<[number, string] | null>({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(lastArrow)) return e.value;
    return tr.docChanged || tr.selection ? null : v;
  },
});

function inMath(state: EditorState, pos: number) {
  const line = state.doc.lineAt(pos);
  const before = line.text.slice(0, pos - line.from);
  return (before.match(/(?<!\\)\$/g)?.length ?? 0) % 2 === 1;
}

// runs on every typed character, however the browser delivered it (keys, IME, dictation)
const filter = EditorState.transactionFilter.of(tr => {
  if (!tr.docChanged || !tr.isUserEvent('input.type') || tr.state.selection.ranges.length !== 1) return tr;
  const head = tr.state.selection.main.head;
  if (head < 2) return tr;
  const two = tr.state.sliceDoc(head - 2, head);
  const rule = RULES.find(([b, c]) => b + c === two);
  const line = tr.state.doc.lineAt(head), before = line.text.slice(0, head - line.from);
  const openBacktick = (before.match(/`/g)?.length ?? 0) % 2 === 1;   // inline code still being typed
  if (!rule || openBacktick || inCode(tr.state, head - 1) || inMath(tr.state, head)) return tr;
  const original = rule[0] === '←' ? '<->' : two;
  return [tr, { changes: { from: head - 2, to: head, insert: rule[2] }, effects: lastArrow.of([head - 1, original]), sequential: true }];
});

const undoArrow = Prec.high(keymap.of([{
  key: 'Backspace',
  run: view => {
    const last = view.state.field(lastArrowField, false);
    const sel = view.state.selection.main;
    if (!last || !sel.empty || sel.head !== last[0]) return false;
    view.dispatch({ changes: { from: last[0] - 1, to: last[0], insert: last[1] }, selection: { anchor: last[0] - 1 + last[1].length } });
    return true;
  },
}]));

export const arrows = [lastArrowField, filter, undoArrow];
