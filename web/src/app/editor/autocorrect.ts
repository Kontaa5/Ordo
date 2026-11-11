// Autocorrect like in macOS apps: when a word is finished (space or punctuation), the macOS spell checker
// (bridge "correct", language of the sentence) suggests a correction and it replaces the word – one ⌘Z undoes it.
// WebKit's own autocorrection does not work in the CodeMirror editor, so it is off.

import { EditorView, ViewUpdate } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { request, isMac } from '../host';

const END = /^[ .,;:!?)\]]$/;
const WORD = /[\p{L}'’]+$/u;
// code, links, URLs, tags, math, front matter, HTML: never correct
const SKIP = /Code|URL|Link|Hashtag|hashtag|Math|math|Frontmatter|frontmatter|HTML|Comment|Image/;

function skip(view: EditorView, pos: number) {
  for (let n: any = syntaxTree(view.state).resolveInner(pos, -1); n; n = n.parent) if (SKIP.test(n.name)) return true;
  return false;
}

export const autocorrect = isMac ? EditorView.updateListener.of((u: ViewUpdate) => {
  if (!u.docChanged || !u.transactions.some(tr => tr.isUserEvent('input.type'))) return;
  let typedAt = -1;
  u.changes.iterChanges((_fa, _ta, fromB, toB, ins) => { if (toB - fromB === 1 && END.test(ins.toString())) typedAt = fromB; });
  if (typedAt < 0) return;
  const view = u.view, line = view.state.doc.lineAt(typedAt);
  const before = line.text.slice(0, typedAt - line.from);
  const m = WORD.exec(before);
  if (!m || m[0].length < 3) return;
  const word = m[0], wordFrom = typedAt - word.length;
  const prev = before.charAt(before.length - word.length - 1);
  if (/\p{Lu}/u.test(word.slice(1)) || (prev && !/[\s(\["„'*_~=>]/.test(prev))) return;   // CamelCase, ABC, part of a path / mail / tag
  if (skip(view, wordFrom)) return;
  const ctxFrom = Math.max(0, before.length - 400);
  const text = before.slice(ctxFrom);
  request<string | null>('correct', { text, from: text.length - word.length, to: text.length }).then(fix => {
    if (!fix || fix === word || /\s/.test(fix) && fix.length > word.length + 3) return;
    if (view.state.sliceDoc(wordFrom, typedAt) !== word) return;   // the user kept typing over it
    view.dispatch({ changes: { from: wordFrom, to: typedAt, insert: fix }, userEvent: 'input.autocorrect' });
  }).catch(() => {});
}) : [];
