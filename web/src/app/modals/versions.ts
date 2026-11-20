// Einstellungen → Versionen: every backed-up version of a note (from Git-Sync), with a preview,
// and one click to put it back. What the note holds now is backed up first, so nothing gets lost.

import { h, icon, dirname } from '../dom';
import { request, emit } from '../host';
import { render } from '../../markdown';
import { notice } from '../ui/notice';
import { confirmDialog } from '../ui/modal';
import { workspace } from '../workspace';
import { vault } from '../store';
import { lang, t } from '../i18n';

interface NoteEntry { path: string; exists: boolean }
export interface Version { commit: string; date: number; path: string }

export const fullDate = (ts: number) => new Date(ts * 1000).toLocaleString(lang === 'de' ? 'de-AT' : 'en-US',
  { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fileName = (p: string) => (p.split('/').pop() ?? p).replace(/\.md$/i, '');

/** The tab. `start`: open this note's versions right away (e.g. the note that is open). */
export function renderVersions(el: HTMLElement, start?: string, commit?: string) {
  el.append(h('p', { cls: 'setting-item-description', text: t('Jede Sicherung von Git-Sync ist eine Version. Notiz wählen, Version ansehen und mit einem Klick zurückholen – auch gelöschte Notizen. Der jetzige Stand wird vorher gesichert, das Zurückholen lässt sich also selbst wieder rückgängig machen.') }));
  if (!vault.settings.gitEnabled) {
    el.append(h('p', { cls: 'setting-item-description', text: t('Dafür muss Git-Sync eingeschaltet sein (Einstellungen → Git-Sync).') }));
    return;
  }
  const box = h('div', { cls: 'ordo-versions' });
  el.append(box);
  if (start) showNote(box, start, vault.notes.has(start), '', commit); else showList(box);
}

async function showList(box: HTMLElement, query = '') {
  const input = h('input', { type: 'search', cls: 'ordo-versions-search', placeholder: t('Notiz suchen …'), spellcheck: 'false', value: query });
  const list = h('div', { cls: 'ordo-sort-list ordo-versions-list' }, h('div', { cls: 'setting-item-description ordo-pad', text: t('Lade …') }));
  box.replaceChildren(input, list);
  const notes = await request<NoteEntry[]>('versionNotes').catch(() => [] as NoteEntry[]);
  const fill = () => {
    const q = input.value.trim().toLowerCase();
    const hits = notes.filter(n => !q || n.path.toLowerCase().includes(q)).slice(0, 300);
    list.replaceChildren(...(hits.length ? hits.map(n => h('div', { cls: 'ordo-sort-row ordo-trash-row ordo-versions-row', onclick: () => showNote(box, n.path, n.exists, input.value) },
      icon('file-text'),
      h('div', { cls: 'ordo-trash-path' }, dirname(n.path) ? h('span', { cls: 'ordo-trash-folder', text: dirname(n.path) + '/' }) : '', fileName(n.path)),
      n.exists ? '' : h('span', { cls: 'ordo-trash-meta', text: t('gelöscht') })))
      : [h('div', { cls: 'setting-item-description ordo-pad', text: notes.length ? t('Keine Notiz gefunden.') : t('Noch keine Sicherung vorhanden.') })]));
  };
  input.addEventListener('input', fill);
  fill();
}

async function showNote(box: HTMLElement, path: string, exists: boolean, query = '', commit?: string) {
  const back = h('button', { text: t('← Alle Notizen'), onclick: () => showList(box, query) });
  const versions = h('div', { cls: 'ordo-versions-versions' });
  const preview = h('div', { cls: 'ordo-versions-preview markdown-rendered' });
  const restore = h('button', { cls: 'mod-cta', text: t('Diese Version wiederherstellen'), disabled: true });
  box.replaceChildren(
    h('div', { cls: 'ordo-versions-head' }, back, h('div', { cls: 'ordo-versions-title', text: fileName(path) + (exists ? '' : ' · ' + t('gelöscht')) }), restore),
    h('div', { cls: 'ordo-versions-body' }, versions, preview));
  versions.append(h('div', { cls: 'setting-item-description ordo-pad', text: t('Lade …') }));
  const list = await request<Version[]>('versionList', { path }).catch(() => [] as Version[]);
  if (!list.length) { versions.replaceChildren(h('div', { cls: 'setting-item-description ordo-pad', text: t('Von dieser Notiz gibt es noch keine Sicherung.') })); return; }

  let chosen: Version | null = null;
  const pick = async (v: Version, row: HTMLElement) => {
    chosen = v;
    versions.querySelectorAll('.is-active').forEach(r => r.classList.remove('is-active'));
    row.classList.add('is-active');
    restore.disabled = true;
    const text = await request<string>('versionText', { commit: v.commit, path: v.path }).catch(() => '');
    if (chosen !== v) return;                 // another version was clicked meanwhile
    preview.innerHTML = render(text, { path: v.path });   // render() runs DOMPurify (sanitize)
    preview.scrollTop = 0;
    restore.disabled = false;
  };
  versions.replaceChildren(...list.map((v, i) => {
    const row = h('div', { cls: 'ordo-versions-version', onclick: () => pick(v, row) },
      h('div', { text: fullDate(v.date) }),
      h('div', { cls: 'ordo-trash-meta', text: (i === 0 && exists ? t('letzte Sicherung') : '') + (v.path !== list[0].path ? (i === 0 && exists ? ' · ' : '') + t('hieß „{name}“', { name: fileName(v.path) }) : '') }));
    return row;
  }));
  const at = Math.max(0, list.findIndex(v => v.commit === commit));
  const first = versions.children[at] as HTMLElement;
  pick(list[at], first);
  first.scrollIntoView({ block: 'nearest' });

  restore.onclick = async () => {
    const v = chosen;
    if (!v) return;
    const msg = exists
      ? t('„{name}“ bekommt den Text vom {date}. Der jetzige Stand wird vorher gesichert und bleibt hier in der Liste.', { name: fileName(path), date: fullDate(v.date) })
      : t('„{name}“ wird mit dem Text vom {date} wieder angelegt.', { name: fileName(path), date: fullDate(v.date) });
    if (!(await confirmDialog(t('Version wiederherstellen?'), msg, t('Wiederherstellen')))) return;
    emit('flush');                            // unsaved typing in an open tab is saved (and so backed up) first – that request goes out before this one
    const dest = await request<string>('versionRestore', { commit: v.commit, path: v.path, target: path }).catch(e => { notice(String(e)); return null; });
    if (!dest) return;
    notice(t('„{name}“ ist wiederhergestellt.', { name: fileName(dest) }));
    workspace.openFile(dest);
    showNote(box, dest, true, query);
  };
}
