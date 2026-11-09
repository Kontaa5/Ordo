// ⌘F: a compact search box in the top right (like Obsidian) instead of CodeMirror's form row –
// match counter, previous/next, case / regex / whole word toggles, and a replace row on demand.

import { EditorView, Panel } from '@codemirror/view';
import { SearchQuery, setSearchQuery, getSearchQuery, findNext, findPrevious, replaceNext, replaceAll, closeSearchPanel } from '@codemirror/search';
import { h, icon } from '../dom';
import { t } from '../i18n';

const MAX_COUNT = 1000;

/** "3 / 12" – which match the selection is on, out of how many (counting stops at 1000). */
function countLabel(view: EditorView, query: SearchQuery): string {
  if (!query.search || !query.valid) return '';
  const sel = view.state.selection.main;
  let n = 0, cur = 0;
  const it = query.getCursor(view.state) as Iterator<{ from: number; to: number }>;
  for (let r = it.next(); !r.done; r = it.next()) {
    n++;
    if (r.value.from === sel.from && r.value.to === sel.to) cur = n;
    if (n >= MAX_COUNT) return `${MAX_COUNT}+`;
  }
  if (!n) return t('Keine Treffer');
  return cur ? `${cur} / ${n}` : `${n}`;
}

export function createSearchPanel(view: EditorView): Panel {
  let query = getSearchQuery(view.state);
  const input = h('input', { type: 'text', cls: 'ordo-search-input', placeholder: t('Suchen …'), spellcheck: 'false', 'main-field': 'true', value: query.search });
  const replace = h('input', { type: 'text', cls: 'ordo-search-input', placeholder: t('Ersetzen durch …'), spellcheck: 'false', value: query.replace });
  const count = h('span', { cls: 'ordo-search-count' });

  const toggle = (label: string, title: string, get: () => boolean, set: (v: boolean) => void) => {
    const b = h('button', { cls: 'ordo-search-toggle', text: label, title, 'aria-pressed': String(get()) });
    b.addEventListener('mousedown', e => e.preventDefault());   // keep focus in the input
    b.addEventListener('click', () => { set(!get()); b.setAttribute('aria-pressed', String(get())); commit(); });
    return b;
  };
  const btn = (name: string, title: string, run: () => void, cls = '') => {
    const b = h('button', { cls: 'ordo-search-btn clickable-icon ' + cls, title, 'aria-label': title }, icon(name));
    b.addEventListener('mousedown', e => e.preventDefault());
    b.addEventListener('click', run);
    return b;
  };

  let caseSensitive = query.caseSensitive, regexp = query.regexp, wholeWord = query.wholeWord;
  const commit = () => {
    const q = new SearchQuery({ search: input.value, replace: replace.value, caseSensitive, regexp, wholeWord });
    if (!q.eq(query)) { query = q; view.dispatch({ effects: setSearchQuery.of(q) }); }
    input.classList.toggle('is-invalid', !!q.search && !q.valid);
    count.textContent = countLabel(view, q);
  };

  const replaceRow = h('div', { cls: 'ordo-search-row ordo-replace-row' }, replace,
    h('button', { cls: 'ordo-search-text-btn', text: t('Ersetzen'), onclick: () => { commit(); replaceNext(view); commit(); } }),
    h('button', { cls: 'ordo-search-text-btn', text: t('Alle'), onclick: () => { commit(); replaceAll(view); commit(); } }));
  replaceRow.hidden = !query.replace;

  const dom = h('div', { cls: 'ordo-search' },
    h('div', { cls: 'ordo-search-row' },
      input, count,
      btn('chevron-down', t('Vorheriger Treffer') + ' (⇧↩)', () => { commit(); findPrevious(view); commit(); }, 'is-up'),
      btn('chevron-down', t('Nächster Treffer') + ' (↩)', () => { commit(); findNext(view); commit(); }),
      toggle('Aa', t('Groß-/Kleinschreibung beachten'), () => caseSensitive, v => { caseSensitive = v; }),
      toggle('W', t('Nur ganze Wörter'), () => wholeWord, v => { wholeWord = v; }),
      toggle('.*', t('Regulärer Ausdruck'), () => regexp, v => { regexp = v; }),
      btn('edit', t('Ersetzen ein/aus'), () => { replaceRow.hidden = !replaceRow.hidden; (replaceRow.hidden ? input : replace).focus(); }),
      btn('x', t('Schließen') + ' (esc)', () => { closeSearchPanel(view); view.focus(); })),
    replaceRow);

  const keys = (e: KeyboardEvent, onEnter: () => void) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); onEnter(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeSearchPanel(view); view.focus(); }
  };
  input.addEventListener('input', commit);
  replace.addEventListener('input', commit);
  input.addEventListener('keydown', e => keys(e, () => (e.shiftKey ? findPrevious : findNext)(view)));
  replace.addEventListener('keydown', e => keys(e, () => replaceNext(view)));

  return {
    dom,
    top: true,
    mount() { input.select(); commit(); },
    update(u) {
      for (const tr of u.transactions) for (const ef of tr.effects) {
        if (ef.is(setSearchQuery) && !ef.value.eq(query)) {   // ⌘F with a selection, ⌘G …
          query = ef.value; input.value = query.search; replace.value = query.replace;
          caseSensitive = query.caseSensitive; regexp = query.regexp; wholeWord = query.wholeWord;
        }
      }
      if (u.docChanged || u.selectionSet || u.transactions.some(tr => tr.effects.length)) count.textContent = countLabel(view, query);
    },
  };
}
