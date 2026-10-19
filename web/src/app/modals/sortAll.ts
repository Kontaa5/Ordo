// "Alle Notizen einsortieren": preview of moves, pick which ones to apply.

import { Modal } from '../ui/modal';
import { h, noteName, dirname } from '../dom';
import { request } from '../host';
import { notice } from '../ui/notice';

import { t, tn } from '../i18n';
export class SortAllModal extends Modal {
  constructor() { super('ordo-sort-all'); this.setTitle(t('Nach Hashtags einsortieren')); }

  async onOpen() {
    this.contentEl.replaceChildren(h('div', { cls: 'setting-item-description', text: t('Berechne …') }));
    const plan = await request<{ path: string; target: string }[]>('sortAllPlan').catch(() => []);
    if (!plan.length) {
      this.contentEl.replaceChildren(h('p', { text: t('Alles aufgeräumt – jede Notiz liegt im Ordner ihrer Hashtags (festgepinnte ausgenommen).') }),
        h('div', { cls: 'modal-button-container' }, h('button', { cls: 'mod-cta', text: 'OK', onclick: () => this.close() })));
      return;
    }
    const boxes: HTMLInputElement[] = [];
    const count = h('div', { cls: 'setting-item-description' });
    const updateCount = () => { count.textContent = t('{k} von {n} Notizen werden verschoben. Links bleiben gültig; Notizen ohne Ordner-Hashtag und festgepinnte bleiben, wo sie sind.', { k: boxes.filter(b => b.checked).length, n: plan.length }); };
    const list = h('div', { cls: 'ordo-sort-list' }, ...plan.map(item => {
      const cb = h('input', { type: 'checkbox', checked: true });
      cb.addEventListener('change', updateCount);
      boxes.push(cb);
      return h('label', { cls: 'ordo-sort-row' }, cb,
        h('div', {}, h('div', { text: noteName(item.path) }), h('div', { cls: 'setting-item-description', text: `${dirname(item.path) || t('Hauptordner')}  →  ${item.target}` })));
    }));
    updateCount();
    this.contentEl.replaceChildren(count, list, h('div', { cls: 'modal-button-container' },
      h('button', { text: t('Abbrechen'), onclick: () => this.close() }),
      h('button', {
        cls: 'mod-cta', text: t('Einsortieren'), onclick: async () => {
          const items = plan.filter((_, i) => boxes[i].checked);
          const n = await request<number>('applySortAll', { items });
          this.close();
          notice(t('{n} Notizen einsortiert.', { n }));
        },
      })));
  }
}
