// Papierkorb: everything deleted in Ordo (and Obsidian) lands in the vault's
// .trash folder. Here it can be put back where it was or deleted for good.

import { Modal, confirmDialog } from '../ui/modal';
import { h, icon, iconButton, noteName, dirname, debounce } from '../dom';
import { request, emit, on } from '../host';
import { notice } from '../ui/notice';
import { workspace } from '../workspace';
import { when } from '../git';

import { t, tn } from '../i18n';

export interface TrashItem { name: string; from: string; date: number; folder: boolean; size: number }

interface TrashList { items: TrashItem[]; days: number }
const loadTrash = () => request<TrashList>('trashList').catch(() => ({ items: [], days: 30 } as TrashList));

export async function trashCount(): Promise<number> { return (await loadTrash()).items.length; }

/** " · wird in X Tagen endgültig gelöscht" */
function left(deleted: number, days: number): string {
  if (days <= 0) return '';
  const n = Math.max(0, Math.ceil(days - (Date.now() / 1000 - deleted) / 86_400));
  return ' · ' + (n <= 1 ? t('wird morgen endgültig gelöscht') : t('wird in {n} Tagen endgültig gelöscht', { n }));
}

/** Trash button for the bottom bar (next to help and settings) with the number of items. */
export function trashButton(): HTMLElement {
  const badge = h('span', { cls: 'ordo-trash-badge' });
  const btn = iconButton('trash', t('Papierkorb'), () => new TrashModal().open(), 'ordo-trash-button');
  btn.appendChild(badge);
  const update = async () => { const n = await trashCount(); badge.textContent = n ? String(n > 99 ? '99+' : n) : ''; };
  on('trash-changed', update); on('vault-opened', update); on('vault-changed', debounce(update, 800));
  update();
  return btn;
}

export class TrashModal extends Modal {
  constructor() { super('ordo-sort-all ordo-trash'); this.setTitle(t('Papierkorb')); }

  async onOpen() { await this.load(); }

  private async load() {
    const { items, days } = await loadTrash();
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
          h('div', { cls: 'setting-item-description', text: t('aus {folder} · gelöscht {when}', { folder: folder || t('Hauptordner'), when: when(it.date) }) + left(it.date, days) })),
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
      h('div', { cls: 'setting-item-description', text: days > 0 ? t('Gelöschtes bleibt {n} Tage hier und wird dann endgültig gelöscht (Einstellungen › Dateien & Links).', { n: days }) : t('Gelöschte Notizen und Bilder liegen hier, bis du sie wiederherstellst oder den Papierkorb leerst.') }),
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
