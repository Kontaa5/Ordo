// Settings › Wörterbuch: the words Ordo keeps (added to the macOS dictionary, ignored, or kept after ⌘Z on a correction).
// View, search, change, delete. Words other Mac apps added to the macOS dictionary are not listed (macOS cannot list them).

import { Modal } from '../ui/modal';
import { h, iconButton } from '../dom';
import { notice } from '../ui/notice';
import { keptWords, forgetWord, changeWord } from '../editor/autocorrect';
import { t } from '../i18n';

const VALID = /^[\p{L}'’-]{1,64}$/u;

export class DictionaryModal extends Modal {
  private filter = '';
  constructor() { super('ordo-dictionary'); this.setTitle(t('Wörterbuch')); }

  async onOpen() {
    const words = await keptWords();
    const search = h('input', { type: 'search', placeholder: t('Suchen …'), spellcheck: 'false', value: this.filter });
    const list = h('div', { cls: 'ordo-sort-list ordo-dict-list' });
    const render = () => {
      const q = this.filter.toLowerCase();
      const shown = words.filter(w => w.word.toLowerCase().includes(q));
      list.replaceChildren(...shown.map(w => this.row(w)));
      if (!shown.length) list.append(h('div', { cls: 'ordo-sort-row setting-item-description', text: words.length ? t('Keine Treffer') : t('Noch keine Wörter. Rechtsklick auf ein unterstrichenes Wort › „Zum Wörterbuch hinzufügen“ oder „Ignorieren“.') }));
    };
    search.addEventListener('input', () => { this.filter = search.value; render(); });
    render();
    this.contentEl.replaceChildren(
      h('div', { cls: 'setting-item-description', text: t('{n} Wörter. „macOS“ = auch im Wörterbuch des Mac (gilt in allen Apps). Wörter, die du in anderen Apps gelernt hast, zeigt macOS hier nicht an.', { n: words.length }) }),
      search, list);
    search.focus();
  }

  private row(w: { word: string; learned: boolean }) {
    const input = h('input', { type: 'text', value: w.word, spellcheck: 'false', cls: 'ordo-dict-word' });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
    input.addEventListener('change', async () => {
      const v = input.value.trim();
      if (v === w.word) return;
      if (!VALID.test(v)) { notice(t('Nur ein einzelnes Wort (Buchstaben, - und \')')); input.value = w.word; return; }
      await changeWord(w.word, v, w.learned);
      this.onOpen();
    });
    return h('div', { cls: 'ordo-sort-row' }, input,
      w.learned ? h('span', { cls: 'ordo-dict-badge', text: 'macOS' }) : null,
      iconButton('trash', t('Löschen'), async () => { await forgetWord(w.word); notice(t('„{w}“ entfernt', { w: w.word }), { timeout: 1500 }); this.onOpen(); }));
  }
}
