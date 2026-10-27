// Git-Sync in the interface: the status dot in the status bar and its menu.
// The work itself happens natively (Ordo/Core/GitSync.swift).

import { h, tooltip } from './dom';
import { request, on, emit, isMac } from './host';
import { Menu } from './ui/menu';
import { notice } from './ui/notice';
import { t, lang } from './i18n';

export interface GitStatus { state: 'off' | 'nogit' | 'idle' | 'working' | 'error'; message?: string; uncommitted?: number; unpushed?: number; lastCommit?: number; lastPush?: number; lastPull?: number }

export let gitStatus: GitStatus = { state: 'off' };

export function when(ts?: number): string {
  if (!ts) return t('noch nie');
  const d = new Date(ts * 1000), now = new Date();
  const time = d.toLocaleTimeString(lang === 'de' ? 'de-AT' : 'en-US', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return t('heute {time}', { time });
  return d.toLocaleDateString(lang === 'de' ? 'de-AT' : 'en-US', { day: 'numeric', month: 'short' }) + ' ' + time;
}

export async function gitSyncNow() {
  notice(t('Sichern und hochladen …'));
  const ok = await request<boolean | 'nothing'>('gitSync').catch(() => false);
  notice(ok === 'nothing' ? t('Nichts Neues – alles ist schon hochgeladen.') : ok ? t('Gesichert und hochgeladen.') : (gitStatus.message || t('Hochladen hat nicht geklappt.')));
}

export async function gitPullNow() {
  const ok = await request<boolean>('gitPull').catch(() => false);
  notice(ok ? t('Änderungen geholt.') : (gitStatus.message || t('Holen hat nicht geklappt.')));
}

/** Status dot: green = everything uploaded, orange = changes not uploaded yet, red = never uploaded or a problem. */
export function gitStatusItem(): HTMLElement {
  const dot = h('span', { cls: 'ordo-git-dot' });
  const label = h('span', { cls: 'ordo-git-label' });
  const item = h('div', { cls: 'status-bar-item plugin-ordo-git mod-clickable' }, dot, label);
  const render = () => {
    const s = gitStatus;
    item.style.display = !isMac || s.state === 'off' ? 'none' : '';
    const pending = (s.uncommitted ?? 0) > 0 || (s.unpushed ?? 0) > 0;
    // green whenever everything is on the server – however long ago the last upload was
    const cls = s.state === 'error' || s.state === 'nogit' || !s.lastPush ? 'is-error' : s.state === 'working' ? 'is-working' : pending ? 'is-pending' : 'is-ok';
    dot.className = 'ordo-git-dot ' + cls;
    label.textContent = s.state === 'working' ? (s.message ?? '') : '';
    const tip = s.state === 'nogit' ? t('Git ist auf diesem Mac nicht installiert.')
      : s.state === 'error' ? s.message ?? ''
      : pending ? t('Noch nicht hochgeladen · zuletzt hochgeladen: {w}', { w: when(s.lastPush) })
      : t('Alles gesichert · zuletzt hochgeladen: {w}', { w: when(s.lastPush) });
    item.setAttribute('aria-label', 'Git: ' + tip);
  };
  tooltip(item, () => item.getAttribute('aria-label') ?? '', 'top');
  item.addEventListener('click', () => {
    const m = new Menu();
    m.addItem({ title: t('Jetzt sichern & hochladen'), icon: 'refresh', onClick: () => gitSyncNow() });
    m.addItem({ title: t('Änderungen holen'), icon: 'download', onClick: () => gitPullNow() });
    m.addSeparator();
    m.addItem({ title: t('Git-Sync einstellen …'), icon: 'settings', onClick: () => emit('open-settings', 'git') });
    m.showAboveElement(item);
  });
  on('git-status', (s: GitStatus) => { gitStatus = s; render(); });
  render();
  request<GitStatus>('gitStatus').then(s => { if (s) { gitStatus = s; render(); } }).catch(() => {});
  return item;
}
