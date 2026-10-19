// One spelling per hashtag: a tag typed as #sew while the vault uses #SEW is
// corrected as soon as it is finished (space, punctuation, Enter) or when the
// cursor leaves the line. Never inside code.

import { EditorState, Transaction, TransactionSpec } from '@codemirror/state';
import { vault } from '../store';
import { inCode } from './livePreview';

const TAG_CHAR = /[\p{L}\p{N}_\-/]/u;
const TAG_IN_LINE = /(^|[\s(,;])#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/gu;

/** Fixes for every hashtag in [from, to) of a line that isn't in its one spelling. */
function fixesInLine(state: EditorState, lineFrom: number, text: string, upTo = text.length) {
  const out: { from: number; to: number; insert: string }[] = [];
  for (const m of text.slice(0, upTo).matchAll(TAG_IN_LINE)) {
    const start = lineFrom + m.index! + m[1].length + 1, tag = m[2];
    const ticks = text.slice(0, m.index! + m[1].length).match(/`/g)?.length ?? 0;
    if (ticks % 2 === 1 || inCode(state, start)) continue;   // inside `code`
    const canon = vault.canonicalTag(tag);
    if (canon && canon !== tag) out.push({ from: start, to: start + tag.length, insert: canon });
  }
  return out;
}

export const tagCase = EditorState.transactionFilter.of((tr: Transaction): Transaction | readonly (Transaction | TransactionSpec)[] => {
  if (!vault.notes?.size) return tr;
  // 1) a character that ends a tag was typed right after it
  if (tr.docChanged && tr.isUserEvent('input')) {
    let pos = -1, ch = '';
    tr.changes.iterChanges((_fa, _ta, fromB, _tb, ins) => { if (pos < 0 && ins.length) { pos = fromB; ch = ins.sliceString(0, 1); } });
    if (pos > 0 && ch && !TAG_CHAR.test(ch)) {
      const line = tr.state.doc.lineAt(pos);
      const fixes = fixesInLine(tr.state, line.from, line.text, pos - line.from)
        .filter(f => f.to === pos);   // only the tag that was just finished
      if (fixes.length) return [tr, { changes: fixes, sequential: true }];
    }
  }
  // 2) the cursor left a line: fix all tags on the line it came from
  if (!tr.docChanged && tr.selection && tr.startState.selection.ranges.length === 1) {
    const before = tr.startState.doc.lineAt(tr.startState.selection.main.head);
    const after = tr.state.doc.lineAt(tr.state.selection.main.head);
    if (before.number !== after.number) {
      const fixes = fixesInLine(tr.startState, before.from, before.text);
      if (fixes.length) return [tr, { changes: fixes, sequential: true }];
    }
  }
  return tr;
});
