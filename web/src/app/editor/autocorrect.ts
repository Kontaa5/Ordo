// Spelling like in macOS apps, with the macOS spell checker (bridge, offline):
// - misspelled words get a red wavy underline (WebKit's own marks do not show in the CodeMirror editor)
// - autocorrect: a finished word (space or punctuation) is replaced by the macOS suggestion.
//   ⌘Z undoes it and Ordo remembers the word: it is neither corrected nor underlined again.

import { EditorView, ViewPlugin, ViewUpdate, Decoration, DecorationSet, keymap } from '@codemirror/view';
import { Transaction, RangeSetBuilder, StateEffect, Annotation, Prec } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { isolateHistory } from '@codemirror/commands';
import { request, isMac } from '../host';
import { appState } from '../state';

const END = /^[ .,;:!?)\]]$/;
const WORD = /[\p{L}'’]+$/u;
// code, links, URLs, tags, math, front matter, HTML: never corrected, never underlined
const SKIP = /Code|URL|Link|Hashtag|hashtag|Math|math|Frontmatter|frontmatter|HTML|Comment|Image|WikiLink|Embed/;

// ── words the user kept (undid the correction) ──
const IGNORE_KEY = 'ordo:spellIgnore';
const ignored = new Set<string>((() => { try { return JSON.parse(localStorage.getItem(IGNORE_KEY) || '[]'); } catch { return []; } })());
function ignore(word: string) {
  ignored.add(word.toLowerCase());
  try { localStorage.setItem(IGNORE_KEY, JSON.stringify([...ignored].slice(-2000))); } catch { /* private */ }
}
const isIgnored = (w: string) => ignored.has(w.toLowerCase());

function skip(view: EditorView, pos: number) {
  for (let n: any = syntaxTree(view.state).resolveInner(pos, 1); n; n = n.parent) if (SKIP.test(n.name)) return true;
  return false;
}

const corrected = Annotation.define<{ from: number; word: string; fix: string }>();
let last: { from: number; word: string; fix: string } | null = null;

/** ⌘Z right after a correction (only the space/period typed since): back to the word as typed, and keep it from now on. */
const undoCorrection = Prec.highest(keymap.of([{ key: 'Mod-z', run: view => {
  const l = last;
  if (!l) return false;
  const end = l.from + l.fix.length, head = view.state.selection.main.head;
  if (view.state.sliceDoc(l.from, end) !== l.fix || head < end || !/^[ .,;:!?)\]]{0,2}$/.test(view.state.sliceDoc(end, head))) { last = null; return false; }
  last = null;
  ignore(l.word);
  view.dispatch({ changes: { from: l.from, to: end, insert: l.word }, userEvent: 'input.autocorrect.undo' });
  return true;
} }]));

const autocorrect = EditorView.updateListener.of((u: ViewUpdate) => {
  if (!u.docChanged) return;
  // ⌘Z right on a correction: keep the word as typed, from now on
  if (last && u.transactions.some(tr => tr.isUserEvent('undo'))) {
    const l = last;
    if (u.state.sliceDoc(l.from, l.from + l.word.length) === l.word) ignore(l.word);
    last = null;
    return;
  }
  const own = u.transactions.map(tr => tr.annotation(corrected)).find(Boolean);
  if (own) { last = own; return; }
  if (!u.transactions.some(tr => tr.isUserEvent('input.type'))) return;
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
  if (isIgnored(word) || skip(view, wordFrom)) return;
  const text = before.slice(Math.max(0, before.length - 400));
  request<string | null>('correct', { text, from: text.length - word.length, to: text.length }).then(fix => {
    if (!fix || fix === word || (/\s/.test(fix) && fix.length > word.length + 3)) return;
    if (view.state.sliceDoc(wordFrom, typedAt) !== word) return;   // the user kept typing over it
    const info = { from: wordFrom, word, fix };
    view.dispatch({
      changes: { from: wordFrom, to: typedAt, insert: fix },
      userEvent: 'input.autocorrect',
      annotations: [corrected.of(info), isolateHistory.of('full'), Transaction.addToHistory.of(true)],   // own undo step
    });
  }).catch(() => {});
});

// ── red wavy underline for misspelled words ──

const misspelled = Decoration.mark({ class: 'ordo-misspelled' });
const setMarks = StateEffect.define<DecorationSet>();

const underline = ViewPlugin.fromClass(class {
  decorations: DecorationSet = Decoration.none;
  timer = 0;
  run = 0;
  constructor(readonly view: EditorView) { this.schedule(50); }
  update(u: ViewUpdate) {
    for (const tr of u.transactions) for (const e of tr.effects) if (e.is(setMarks)) this.decorations = e.value;
    if (u.docChanged) this.decorations = this.decorations.map(u.changes);
    if (u.docChanged || u.viewportChanged || u.selectionSet) this.schedule(u.docChanged ? 600 : 250);
  }
  schedule(ms: number) { clearTimeout(this.timer); this.timer = window.setTimeout(() => this.check(), ms); }   // one check after typing stops, no polling
  async check() {
    const view = this.view, { from } = view.viewport;
    const to = Math.min(view.viewport.to, from + 60000);
    const text = view.state.sliceDoc(from, to);
    const run = ++this.run, doc = view.state.doc;
    const res = await request<[number, number][]>('spelling', { text }).catch(() => null);
    if (!res || run !== this.run || view.state.doc !== doc) return;   // outdated: a newer check follows
    const head = view.state.selection.main.head, b = new RangeSetBuilder<Decoration>();
    for (const [at, len] of res) {
      const a = from + at, z = a + len, word = text.slice(at, at + len);
      if (z === head && view.hasFocus) continue;   // the word being typed right now
      if (isIgnored(word) || skip(view, a)) continue;
      b.add(a, z, misspelled);
    }
    view.dispatch({ effects: setMarks.of(b.finish()) });
  }
  destroy() { clearTimeout(this.timer); }
}, { decorations: v => v.decorations });

export const spelling = isMac ? [undoCorrection, autocorrect, ...(appState.spellcheck ? [underline] : [])] : [];
