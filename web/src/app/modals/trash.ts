// Papierkorb: everything deleted in Ordo (and Obsidian) lands in the vault's
// .trash folder. Here it can be put back where it was or deleted for good.

import { Modal, confirmDialog } from '../ui/modal';
import { h, icon, iconButton, noteName, dirname } from '../dom';
import { request, emit } from '../host';
import { notice } from '../ui/notice';
import { workspace } from '../workspace';
import { when } from '../git';

import { t, tn } from '../i18n';

export interface TrashItem { name: string; from: string; date: number; folder: boolean; size: number }

export async function trashCount(): Promise<number> {
  return (await request<TrashItem[]>('trashList').catch(() => [] as TrashItem[]))?.length ?? 0;
}

export class TrashModal extends Modal {
  constructor() { super('ordo-sort-all ordo-trash'); this.setTitle(t('Papierkorb')); }

  async onOpen() { await this.load(); }

  private async load() {
    const items = await request<TrashItem[]>('trashList').catch(() => [] as TrashItem[]);
    if (!items.length) {
      this.contentEl.replaceChildren(h('p', { cls: 'setting-item-description', text: t('Der Papierkorb ist leer.') }),
        h('div', { cls: 'modal-button-container' }, h('button', { cls: 'mod-cta', text: 'OK', onclick: () => this.close() })));
      return;
    }
    const rows = items.map(it => {
      const folder = dirname(it.from);
      const name = it.folder ? it.name : noteName(it.from) || it.name;
      return h('div', { cls: 'ordo-sort-row ordo-trash-row' },
        icon(it.folder ? 'folder' : /\.md$/i.test(it.from) ? 'file-text' : 'image'),
        h('div', { cls: 'ordo-trash-info' },
          h('div', { text: name }),
          h('div', { cls: 'setting-item-description', text: t('aus {folder} · gelöscht {when}', { folder: folder || t('Hauptordner'), when: when(it.date) }) })),
        h('button', { text: t('Wiederherstellen'), onclick: async () => {
          const path = await request<string>('trashRestore', { name: it.name }).catch(e => { notice(String(e)); return null; });
          if (!path) return;
          notice(t('„{name}“ ist wieder da.', { name }));
          if (/\.md$/i.test(path)) workspace.openFile(path);
          emit('trash-changed');
          this.load();
        } }),
        iconButton('trash', t('Endgültig löschen'), async () => {
          if (!(await confirmDialog(t('Endgültig löschen?'), t('„{name}“ wird endgültig gelöscht. Das lässt sich nicht rückgängig machen.', { name }), t('Endgültig löschen'), true))) return;
          await request('trashDelete', { name: it.name }).catch(e => notice(String(e)));
          emit('trash-changed');
          this.load();
        }, 'ordo-trash-delete'));
    });
    this.contentEl.replaceChildren(
      h('div', { cls: 'setting-item-description', text: t('Gelöschte Notizen und Bilder liegen hier, bis du sie wiederherstellst oder den Papierkorb leerst.') }),
      h('div', { cls: 'ordo-sort-list' }, ...rows),
      h('div', { cls: 'modal-button-container' },
        h('button', { cls: 'mod-warning', text: t('Papierkorb leeren'), onclick: async () => {
          if (!(await confirmDialog(t('Papierkorb leeren?'), tn(items.length, 'Element', 'Elemente') + ' ' + (items.length === 1 ? t('wird endgültig gelöscht. Das lässt sich nicht rückgängig machen.') : t('werden endgültig gelöscht. Das lässt sich nicht rückgängig machen.')), t('Leeren'), true))) return;
          await request('trashEmpty').catch(e => notice(String(e)));
          emit('trash-changed');
          this.load();
        } }),
        h('button', { text: t('Schließen'), onclick: () => this.close() })));
  }
}
