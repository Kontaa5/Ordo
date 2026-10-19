// PDF export page. Lays out notes at page-content width, paginates with the
// same algorithm as the editor, then shows one slice at a time so the host can
// capture each with WKWebView.createPDF and place it on a real page.

import './shared.css';
import { setIndex, VaultIndex, PageGeom } from './vault';
import { render } from './markdown';
import { paginate, applyGeomVars, contentSize, whenImagesLoaded, Slice } from './paginate';

interface ExportNote { path: string; title: string; text: string }
interface ExportOptions { geom: PageGeom; toc: boolean; titles: boolean; tocTitle: string }

const viewport = document.getElementById('viewport')!;
const tocEl = document.getElementById('toc')!;
const contentEl = document.getElementById('content')!;

let slices: { el: HTMLElement; s: Slice }[] = [];

function esc(s: string) { return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!)); }

function startsWithH1(text: string) {
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n/, '').trimStart();
  return /^#\s/.test(body);
}

const api = {
  async render(p: { index: VaultIndex; notes: ExportNote[]; options: ExportOptions }) {
    setIndex(p.index);
    const g = p.options.geom;
    const { w, h } = contentSize(g);
    document.body.style.width = w + 'px';
    for (const el of [tocEl, contentEl]) { applyGeomVars(el, g); el.style.width = w + 'px'; }

    contentEl.innerHTML = p.notes.map((n, i) => {
      const title = p.options.titles && !startsWithH1(n.text) ? `<h1 class="export-title">${esc(n.title)}</h1>` : '';
      return `<section class="note-start" data-note="${i}">${title}${render(n.text, { path: n.path, showProperties: false })}</section>`;
    }).join('');
    await whenImagesLoaded(contentEl);

    const showToc = p.options.toc && p.notes.length > 1;
    const tocRows = () => p.notes.map((n, i) =>
      `<div class="toc-row" data-line="${i}"><span class="toc-name">${esc(n.title)}</span><span class="toc-dots"></span><span class="toc-page" data-toc="${i}">0</span></div>`).join('');
    tocEl.innerHTML = showToc ? `<h1>${esc(p.options.tocTitle)}</h1>${tocRows()}` : '';
    tocEl.hidden = !showToc;

    const tocSlices = showToc ? paginate(tocEl, h) : [];
    const contentSlices = paginate(contentEl, h);
    const offset = tocSlices.length;

    // first page of each note + headings for the PDF outline
    const pageOfY = (y: number) => {
      let idx = 0;
      for (let i = 0; i < contentSlices.length; i++) if (contentSlices[i].top <= y + 0.5) idx = i;
      return idx + offset;
    };
    const base = contentEl.getBoundingClientRect().top;
    const outline: { title: string; page: number; level: number }[] = [];
    contentEl.querySelectorAll<HTMLElement>('section.note-start').forEach((sec, i) => {
      const first = sec.firstElementChild as HTMLElement | null;
      const page = pageOfY((first ?? sec).getBoundingClientRect().top - base);
      outline.push({ title: p.notes[i].title, page, level: 0 });
      const tocCell = tocEl.querySelector(`[data-toc="${i}"]`);
      if (tocCell) tocCell.textContent = String(page + 1);
      sec.querySelectorAll<HTMLElement>('h1, h2, h3').forEach(hd => {
        if (hd.classList.contains('export-title')) return;
        outline.push({ title: hd.textContent ?? '', page: pageOfY(hd.getBoundingClientRect().top - base), level: +hd.tagName[1] });
      });
    });

    slices = [...tocSlices.map(s => ({ el: tocEl, s })), ...contentSlices.map(s => ({ el: contentEl, s }))];
    return { pages: slices.length, width: w, height: h, outline };
  },

  /** Show slice i at the top-left of the viewport; returns its height. */
  show(i: number) {
    const { el, s } = slices[i];
    tocEl.style.display = el === tocEl ? '' : 'none';
    contentEl.style.display = el === contentEl ? '' : 'none';
    viewport.style.height = Math.max(1, Math.ceil(s.height)) + 'px';
    el.style.transform = `translateY(${-s.top}px)`;
    window.scrollTo(0, 0);
    return Math.max(1, s.height);
  },
};

declare global { interface Window { exporter: typeof api } }
window.exporter = api;
