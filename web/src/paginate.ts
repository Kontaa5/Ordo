// Splits a continuously laid-out .print-body into page slices.
// The same routine drives the page markers in the editor, the page view in
// reading mode and the PDF export, so what you see is where the PDF breaks.

import type { PageGeom } from './vault';

export interface Slice { top: number; height: number; line: number | null }

const SPLITTABLE = new Set(['UL', 'OL', 'BLOCKQUOTE', 'TABLE', 'TBODY', 'THEAD', 'LI', 'DIV', 'SECTION', 'DETAILS']);
const HEADING = /^H[1-6]$/;

interface Atom { el: HTMLElement; top: number; bottom: number; forced: boolean; heading: boolean }

export function contentSize(g: PageGeom) {
  return { w: g.pageW - g.ml - g.mr, h: g.pageH - g.mt - g.mb };
}

function isBreakMarker(el: HTMLElement) {
  if (el.classList.contains('page-break') || el.classList.contains('note-start')) return true;
  const s = el.getAttribute('style') ?? '';
  return /page-break-(after|before)\s*:\s*always|break-(after|before)\s*:\s*page/.test(s);
}

function collect(el: HTMLElement, base: number, H: number, out: Atom[]) {
  for (const child of Array.from(el.children) as HTMLElement[]) {
    if (isBreakMarker(child)) {
      if (child.classList.contains('note-start')) {
        out.push({ el: child, top: child.getBoundingClientRect().top - base, bottom: 0, forced: true, heading: false });
        out[out.length - 1].bottom = out[out.length - 1].top;
        collect(child, base, H, out);
      } else {
        const r = child.getBoundingClientRect();
        out.push({ el: child, top: r.bottom - base, bottom: r.bottom - base, forced: true, heading: false });
      }
      continue;
    }
    const r = child.getBoundingClientRect();
    if (r.height === 0 && r.width === 0) continue;
    if (r.height > H && SPLITTABLE.has(child.tagName) && child.children.length > 0) {
      collect(child, base, H, out);
      continue;
    }
    out.push({ el: child, top: r.top - base, bottom: r.bottom - base, forced: false, heading: HEADING.test(child.tagName) });
  }
}

function lineOf(el: HTMLElement): number | null {
  const own = el.closest('[data-line]');
  if (own) return +own.getAttribute('data-line')!;
  let prev = el.previousElementSibling;
  while (prev) {
    const l = prev.getAttribute('data-line');
    if (l != null) return +l;
    prev = prev.previousElementSibling;
  }
  return null;
}

/** Compute page slices for `container`, whose width must equal the page content width. */
export function paginate(container: HTMLElement, H: number): Slice[] {
  const base = container.getBoundingClientRect().top;
  const total = container.scrollHeight;
  const atoms: Atom[] = [];
  collect(container, base, H, atoms);

  const starts: { top: number; line: number | null }[] = [{ top: 0, line: 0 }];
  let pageTop = 0;
  let firstOnPage = true;
  for (let i = 0; i < atoms.length; i++) {
    const a = atoms[i];
    if (a.forced) {
      if (!firstOnPage || a.el.classList.contains('page-break')) {
        const next = atoms[i + 1];
        const top = next ? next.top : a.bottom;
        if (top > pageTop) {
          starts.push({ top, line: next ? lineOf(next.el) : null });
          pageTop = top;
          firstOnPage = true;
        }
      }
      continue;
    }
    if (a.bottom - pageTop <= H) { firstOnPage = false; continue; }

    if (!firstOnPage) {
      // keep headings with the following block
      let breakAt = i;
      if (i > 0 && atoms[i - 1].heading && atoms[i - 1].top > pageTop) breakAt = i - 1;
      const b = atoms[breakAt];
      starts.push({ top: b.top, line: lineOf(b.el) });
      pageTop = b.top;
      i = breakAt - 1;
      firstOnPage = true;
      continue;
    }

    // a single block taller than the page: cut it at line boundaries
    const lh = parseFloat(getComputedStyle(a.el).lineHeight) || 16;
    while (a.bottom - pageTop > H) {
      const cut = pageTop + Math.max(lh, Math.floor(H / lh) * lh);
      starts.push({ top: cut, line: lineOf(a.el) });
      pageTop = cut;
    }
    firstOnPage = false;
  }

  const slices: Slice[] = [];
  for (let i = 0; i < starts.length; i++) {
    const top = starts[i].top;
    const end = i + 1 < starts.length ? starts[i + 1].top : total;
    if (end - top <= 0.5 && i > 0) continue;
    slices.push({ top, height: Math.min(H, Math.max(0, end - top)), line: starts[i].line });
  }
  return slices;
}

export function applyGeomVars(el: HTMLElement, g: PageGeom) {
  const { w, h } = contentSize(g);
  el.style.setProperty('--content-w', w + 'px');
  el.style.setProperty('--content-h', h + 'px');
  el.style.setProperty('--print-font', g.fontSize + 'px');
}

export function whenImagesLoaded(el: HTMLElement): Promise<void> {
  const imgs = Array.from(el.querySelectorAll('img'));
  return Promise.all(imgs.map(img => img.complete ? Promise.resolve() :
    new Promise<void>(r => { img.addEventListener('load', () => r(), { once: true }); img.addEventListener('error', () => r(), { once: true }); })))
    .then(() => undefined);
}
