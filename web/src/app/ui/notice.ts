// Obsidian-style notices (top right), optionally with an action button.

import { h } from '../dom';

let container: HTMLElement | null = null;

export function notice(message: string, opts: { timeout?: number; action?: string; onAction?: () => void } = {}) {
  if (!container) { container = h('div', { cls: 'notice-container' }); document.body.appendChild(container); }
  const el = h('div', { cls: 'notice' }, h('div', { cls: 'notice-message', text: message }));
  if (opts.action) {
    el.appendChild(h('button', {
      cls: 'notice-action', text: opts.action,
      onclick: (e: MouseEvent) => { e.stopPropagation(); opts.onAction?.(); close(); },
    }));
  }
  const close = () => { el.classList.add('mod-hiding'); setTimeout(() => el.remove(), 180); };
  el.addEventListener('click', close);
  container.appendChild(el);
  setTimeout(close, opts.timeout ?? (opts.action ? 7000 : 4000));
  return { close, setMessage: (m: string) => { (el.querySelector('.notice-message') as HTMLElement).textContent = m; } };
}
