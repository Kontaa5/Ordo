// Papierkorb: everything deleted in Ordo (and Obsidian) lands in the vault's
// .trash folder. Here it can be put back where it was or moved on to the system trash.

import { Modal, confirmDialog } from '../ui/modal';
import { h, icon, iconButton, dirname, debounce } from '../dom';
import { request, emit, on } from '../host';
import { notice } from '../ui/notice';
import { workspace } from '../workspace';
import { when } from '../git';

import { t, tn } from '../i18n';

export interface TrashItem { name: string; from: string; date: number; folder: boolean; size: number }

interface TrashList { items: TrashItem[]; days: number }
const loadTrash = () => request<TrashList>('trashList').catch(() => ({ items: [], days: 30 } as TrashList));

export async function trashCount(): Promise<number> { return (await loadTrash()).items.length; }

/** "noch 12 Tage" until the item is deleted for good */
function left(deleted: number, days: number): string {
  const n = Math.max(1, Math.ceil(days - (Date.now() / 1000 - deleted) / 86_400));
  return n === 1 ? t('noch 1 Tag') : t('noch {n} Tage', { n });
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
      const name = it.folder ? it.name : it.from.split('/').pop() || it.name;   // full file name, e.g. „Java Basics.md“
      const meta = h('span', { cls: 'ordo-trash-meta', text: days > 0 ? left(it.date, days) : when(it.date) });
      meta.title = t('Gelöscht {when}', { when: when(it.date) });
      return h('div', { cls: 'ordo-sort-row ordo-trash-row' },
        icon(it.folder ? 'folder' : /\.md$/i.test(it.from) ? 'file-text' : 'image'),
        h('div', { cls: 'ordo-trash-path' }, folder ? h('span', { cls: 'ordo-trash-folder', text: folder + '/' }) : '', name),
        meta,
        iconButton('undo', t('Wiederherstellen'), async () => {
          const path = await request<string>('trashRestore', { name: it.name }).catch(e => { notice(String(e)); return null; });
          if (!path) return;
          notice(t('„{name}“ ist wieder da.', { name }));
          if (/\.md$/i.test(path)) workspace.openFile(path);
          emit('trash-changed');
          this.load();
        }),
        iconButton('trash', t('In den System-Papierkorb'), async () => {
          if (!(await confirmDialog(t('In den System-Papierkorb?'), t('„{name}“ kommt in den Papierkorb des Systems (Mac: Papierkorb, iCloud: „Zuletzt gelöscht“) und lässt sich dort wiederherstellen.', { name }), t('Verschieben'), true))) return;
          await request('trashDelete', { name: it.name }).catch(e => notice(String(e)));
          emit('trash-changed');
          this.load();
        }, 'ordo-trash-delete'));
    });
    this.contentEl.replaceChildren(
      h('div', { cls: 'setting-item-description', text: days > 0 ? t('Kommt nach {n} Tagen in den System-Papierkorb.', { n: days }) : t('Bleibt hier, bis du den Papierkorb leerst.') }),
      h('div', { cls: 'ordo-sort-list' }, ...rows),
      h('div', { cls: 'modal-button-container' },
        h('button', { cls: 'mod-warning', text: t('Papierkorb leeren'), onclick: async () => {
          if (!(await confirmDialog(t('Papierkorb leeren?'), tn(items.length, 'Element', 'Elemente') + ' ' + (items.length === 1 ? t('kommt in den System-Papierkorb und lässt sich dort wiederherstellen.') : t('kommen in den System-Papierkorb und lassen sich dort wiederherstellen.')), t('Leeren'), true))) return;
          await request('trashEmpty').catch(e => notice(String(e)));
          emit('trash-changed');
          this.load();
        } })));
  }
}
