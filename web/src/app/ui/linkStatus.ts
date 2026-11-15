// Hover over a link: where it leads, small in the bottom left corner (like a browser's status bubble).
// Event-driven (mouseover/mouseout), text only – the target is never rendered as HTML.

import { resolve } from '../../vault';
import { getActiveMarkdownView } from '../views/markdown';
import { t } from '../i18n';

const LINK = '.workspace-leaf [data-href], .workspace-leaf [data-target], .workspace-leaf a[href]';

function targetOf(el: HTMLElement): string {
  const raw = el.dataset.href ?? el.dataset.target ?? el.getAttribute('href') ?? '';
  if (!raw) return '';
  if (/^(https?|mailto):/i.test(raw)) return raw;
  // a note in the vault: its path (or that it would be created)
  const base = raw.split('#')[0];
  const heading = raw.includes('#') ? ' › ' + raw.slice(raw.indexOf('#') + 1) : '';
  if (!base) return heading.slice(3);
  const path = resolve(base, getActiveMarkdownView()?.path ?? '');
  return path ? path.replace(/\.md$/i, '') + heading : t('Neue Notiz: {n}', { n: base });
}

export function initLinkStatus() {
  const bubble = document.createElement('div');
  bubble.className = 'ordo-link-status';
  bubble.hidden = true;
  document.body.appendChild(bubble);
  document.addEventListener('mouseover', e => {
    const el = (e.target as HTMLElement).closest?.(LINK) as HTMLElement | null;
    const target = el ? targetOf(el) : '';
    bubble.textContent = target;
    bubble.hidden = !target;
    if (el && target) {   // bottom left corner of the note the link is in, not over the sidebar
      const r = el.closest('.workspace-leaf')!.getBoundingClientRect();
      bubble.style.left = `${r.left + 8}px`;
      bubble.style.bottom = `${window.innerHeight - r.bottom + 8}px`;
    }
  });
  document.addEventListener('mouseout', e => {
    const to = (e.relatedTarget as HTMLElement | null)?.closest?.(LINK);
    if (!to) bubble.hidden = true;
  });
}
