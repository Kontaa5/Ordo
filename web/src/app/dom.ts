// Tiny DOM helpers + the Lucide icon set (the same icons Obsidian uses).

import { ICONS } from './icons';

const SVG = 'http://www.w3.org/2000/svg';

export function icon(name: string, size?: number): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('xmlns', SVG);
  svg.setAttribute('viewBox', '0 0 256 256');
  svg.setAttribute('fill', 'currentColor');
  if (size) { svg.setAttribute('width', String(size)); svg.setAttribute('height', String(size)); }
  svg.classList.add('svg-icon', 'ph-' + name);
  if (name === 'panel-right') svg.style.transform = 'scaleX(-1)';
  svg.innerHTML = ICONS[name] ?? '';
  return svg;
}

type Child = Node | string | null | undefined | false;
type Attrs = Record<string, any> & { cls?: string; text?: string; onclick?: (e: MouseEvent) => void };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'cls') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

/** Obsidian-style `.clickable-icon` button. */
export function iconButton(name: string, label: string, onClick: (e: MouseEvent) => void, cls = ''): HTMLDivElement {
  const b = h('div', { cls: 'clickable-icon ' + cls, 'aria-label': label, role: 'button', tabindex: '-1' }, icon(name));
  b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); onClick(e); });
  tooltip(b, label);
  return b;
}

let tipEl: HTMLElement | null = null;
let tipTimer: number | undefined;
export function tooltip(el: HTMLElement, text: string | (() => string), placement: 'bottom' | 'top' | 'right' = 'bottom') {
  el.addEventListener('mouseenter', () => {
    clearTimeout(tipTimer);
    tipTimer = window.setTimeout(() => {
      const t = typeof text === 'function' ? text() : text;
      if (!t || !el.isConnected) return;
      tipEl?.remove();
      tipEl = h('div', { cls: 'tooltip mod-' + placement, text: t });
      document.body.appendChild(tipEl);
      const r = el.getBoundingClientRect(), tr = tipEl.getBoundingClientRect();
      let x = r.left + r.width / 2 - tr.width / 2, y = r.bottom + 6;
      if (placement === 'top') y = r.top - tr.height - 6;
      if (placement === 'right') { x = r.right + 8; y = r.top + r.height / 2 - tr.height / 2; }
      x = Math.max(6, Math.min(window.innerWidth - tr.width - 6, x));
      tipEl.style.left = x + 'px';
      tipEl.style.top = y + 'px';
    }, 600);
  });
  const hide = () => { clearTimeout(tipTimer); tipEl?.remove(); tipEl = null; };
  el.addEventListener('mouseleave', hide);
  el.addEventListener('mousedown', hide);
}

export function debounce<T extends (...a: any[]) => void>(fn: T, ms: number) {
  let t: number | undefined;
  const d = (...a: Parameters<T>) => { clearTimeout(t); t = window.setTimeout(() => fn(...a), ms); };
  d.cancel = () => clearTimeout(t);
  return d as T & { cancel(): void };
}

export function basename(p: string) { return p.split('/').pop() ?? p; }
export function dirname(p: string) { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); }
export function noteName(p: string) { return basename(p).replace(/\.md$/i, ''); }
export function extname(p: string) { const b = basename(p); const i = b.lastIndexOf('.'); return i < 0 ? '' : b.slice(i + 1).toLowerCase(); }

export function fuzzy(query: string, target: string): { score: number; matches: number[] } | null {
  const q = query.toLowerCase(), t = target.toLowerCase();
  if (!q) return { score: 0, matches: [] };
  const idx = t.indexOf(q);
  if (idx >= 0) {
    const m = Array.from({ length: q.length }, (_, i) => idx + i);
    return { score: 1000 - idx * 2 - t.length * 0.1 + (idx === 0 || /[\s/_-]/.test(t[idx - 1]) ? 200 : 0), matches: m };
  }
  let score = 0, ti = 0, streak = 0;
  const matches: number[] = [];
  for (const c of q) {
    if (c === ' ') continue;
    let found = false;
    while (ti < t.length) {
      if (t[ti] === c) {
        matches.push(ti);
        streak = matches.length > 1 && matches[matches.length - 2] === ti - 1 ? streak + 1 : 0;
        score += 10 + streak * 8 + (ti === 0 || /[\s/_-]/.test(t[ti - 1]) ? 15 : 0);
        ti++; found = true; break;
      }
      ti++;
    }
    if (!found) return null;
  }
  return { score: score - t.length * 0.1, matches };
}

export function highlightMatches(text: string, matches: number[]): DocumentFragment {
  const f = document.createDocumentFragment();
  const set = new Set(matches);
  let buf = '', inHit = false;
  const flush = () => {
    if (!buf) return;
    f.append(inHit ? h('span', { cls: 'suggestion-highlight', text: buf }) : document.createTextNode(buf));
    buf = '';
  };
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i);
    if (hit !== inHit) { flush(); inHit = hit; }
    buf += text[i];
  }
  flush();
  return f;
}

