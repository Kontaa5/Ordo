// Markdown → HTML with Obsidian flavour: [[wikilinks]], ![[embeds|300]],
// #tags, ==highlights==, callouts, task lists, frontmatter, page breaks.
// Every block carries data-line so pages can be mapped back to source lines.

import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
import type { StateInline, StateCore, Token } from 'markdown-it';
import { resolve, fileURL, IMAGE_EXT, parseSize, basename } from './vault';
import { mathPlugin } from './math';
import { highlightToHTML } from './app/editor/code';
import { ICONS } from './app/icons';

let currentPath = '';

const md = MarkdownIt({ html: true, linkify: true, breaks: true, typographer: false });

function esc(s: string) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

// ---------- [[wikilinks]] and ![[embeds]] ----------
function wikilink(state: StateInline, silent: boolean) {
  const src = state.src;
  let pos = state.pos;
  const embed = src.charCodeAt(pos) === 0x21; // !
  if (embed) pos++;
  if (src.charCodeAt(pos) !== 0x5b || src.charCodeAt(pos + 1) !== 0x5b) return false;
  const end = src.indexOf(']]', pos + 2);
  if (end < 0) return false;
  const inner = src.slice(pos + 2, end);
  if (inner.includes('\n') || inner.includes('[[')) return false;
  if (!silent) {
    const tok = state.push('html_inline', '', 0);
    tok.content = renderWikilink(inner, embed);
  }
  state.pos = end + 2;
  return true;
}

export function renderWikilink(inner: string, embed: boolean): string {
  const bar = inner.indexOf('|');
  const targetFull = bar >= 0 ? inner.slice(0, bar) : inner;
  const alias = bar >= 0 ? inner.slice(bar + 1) : '';
  const [target] = targetFull.split('#');
  const resolved = target ? resolve(target, currentPath) : currentPath;

  if (embed && IMAGE_EXT.test(target)) {
    const { w, h } = parseSize(alias);
    const style = [w ? `width:${w}px` : '', h ? `height:${h}px` : ''].filter(Boolean).join(';');
    if (!resolved) return `<span class="missing-embed">${esc(target)} nicht gefunden</span>`;
    const flex = w ? ` style="flex:0 1 ${w}px"` : '';
    return `<span class="internal-embed media-embed image-embed is-loaded"${flex}><img class="ordo-img" decoding="async" src="${fileURL(resolved)}" data-path="${esc(resolved)}" alt="${esc(basename(target))}"${style ? ` style="${style}"` : ''}></span>`;
  }
  if (embed) {
    return `<div class="embed-note" data-href="${esc(targetFull)}"><span class="embed-title">${esc(alias || targetFull)}</span></div>`;
  }
  const label = alias || targetFull.replace(/#/, ' › ');
  const cls = resolved ? 'internal-link' : 'internal-link is-unresolved';
  return `<a class="${cls}" data-href="${esc(targetFull)}">${esc(label)}</a>`;
}

// ---------- #tags ----------
const TAG_CHAR = /[\p{L}\p{N}_\-/]/u;
function tag(state: StateInline, silent: boolean) {
  const src = state.src;
  const start = state.pos;
  if (src.charCodeAt(start) !== 0x23) return false;
  if (start > 0 && !/[\s(,;]/.test(src[start - 1])) return false;
  let p = start + 1;
  while (p < src.length && TAG_CHAR.test(src[p])) p++;
  const name = src.slice(start + 1, p);
  if (!name || /^\d+$/.test(name)) return false;
  if (!silent) {
    const tok = state.push('html_inline', '', 0);
    tok.content = `<a class="tag" data-tag="${esc(name)}">#${esc(name)}</a>`;
  }
  state.pos = p;
  return true;
}

// ---------- ==highlight== ----------
function highlight(state: StateInline, silent: boolean) {
  const src = state.src;
  const start = state.pos;
  if (src.charCodeAt(start) !== 0x3d || src.charCodeAt(start + 1) !== 0x3d) return false;
  const end = src.indexOf('==', start + 2);
  if (end < 0 || end === start + 2) return false;
  if (!silent) {
    state.push('mark_open', 'mark', 1);
    const oldMax = state.posMax;
    state.pos = start + 2;
    state.posMax = end;
    state.md.inline.tokenize(state);
    state.posMax = oldMax;
    state.push('mark_close', 'mark', -1);
  }
  state.pos = end + 2;
  return true;
}

md.use(mathPlugin);
md.inline.ruler.before('link', 'wikilink', wikilink);
md.inline.ruler.before('emphasis', 'highlight', highlight);
md.inline.ruler.push('tag', tag);

// ---------- callouts:  > [!note] Title  →  Obsidian's .callout structure ----------
export const COPY_ICON = `<svg viewBox="0 0 256 256" fill="currentColor" class="svg-icon">${ICONS.copy}</svg>`;
export const CHECK_ICON = `<svg viewBox="0 0 256 256" fill="currentColor" class="svg-icon">${ICONS.check}</svg>`;
const svg = (name: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" class="svg-icon">${ICONS[name]}</svg>`;
// icon per callout type (aliases like Obsidian); unknown types get the pencil of "note"
const CALLOUT_ICONS: Record<string, string> = {
  info: 'info', todo: 'list-checks', abstract: 'list', summary: 'list', tldr: 'list',
  tip: 'highlighter', hint: 'highlighter', important: 'highlighter',
  success: 'check', check: 'check', done: 'check', question: 'help', help: 'help', faq: 'help',
  warning: 'alert', caution: 'alert', attention: 'alert', failure: 'x', fail: 'x', missing: 'x',
  danger: 'alert', error: 'alert', bug: 'alert', example: 'list', quote: 'quote', cite: 'quote',
};
md.core.ruler.before('inline', 'callouts', (state: StateCore) => {
  const toks = state.tokens;
  for (let i = 0; i < toks.length - 2; i++) {
    if (toks[i].type !== 'blockquote_open') continue;
    const para = toks[i + 1], inline = toks[i + 2];
    if (para?.type !== 'paragraph_open' || inline?.type !== 'inline') continue;
    const m = /^\[!([\w-]+)\]([+-]?)[ \t]*([^\n]*)\n?/.exec(inline.content);
    if (!m) continue;
    const kind = m[1].toLowerCase();
    const title = m[3] || kind.charAt(0).toUpperCase() + kind.slice(1);
    // find the matching close
    let depth = 0, close = -1;
    for (let j = i; j < toks.length; j++) {
      if (toks[j].type === 'blockquote_open') depth++;
      else if (toks[j].type === 'blockquote_close' && --depth === 0) { close = j; break; }
    }
    if (close < 0) continue;
    const open = new state.Token('html_block', '', 0);
    // [!type]- starts folded, [!type]+ starts open; both fold by clicking the title
    const fold = m[2] ? ` is-collapsible${m[2] === '-' ? ' is-collapsed' : ''}` : '';
    const chevron = m[2] ? `<div class="callout-fold">${svg('chevron-down')}</div>` : '';
    open.content = `<div class="callout${fold}" data-callout="${esc(kind)}"${m[2] ? ` data-callout-fold="${m[2]}"` : ''} data-line="${toks[i].map?.[0] ?? 0}"><div class="callout-title"><div class="callout-icon">${svg(CALLOUT_ICONS[kind] ?? 'pencil')}</div><div class="callout-title-inner">${esc(title)}</div>${chevron}</div><div class="callout-content">\n`;
    const end = new state.Token('html_block', '', 0);
    end.content = '</div></div>\n';
    inline.content = inline.content.slice(m[0].length);
    if (!inline.content.trim()) { toks.splice(i + 1, 3); close -= 3; }
    toks[close] = end;
    toks[i] = open;
  }
});

// ---------- task lists ----------
md.core.ruler.after('inline', 'tasks', (state: StateCore) => {
  const toks = state.tokens;
  for (let i = 2; i < toks.length; i++) {
    const inline = toks[i];
    if (inline.type !== 'inline' || toks[i - 1].type !== 'paragraph_open' || toks[i - 2].type !== 'list_item_open') continue;
    const m = /^\[([ xX\/-])\]\s/.exec(inline.content);
    if (!m || !inline.children?.length) continue;
    const first = inline.children[0];
    if (first.type !== 'text') continue;
    first.content = first.content.replace(/^\[[ xX\/-]\]\s?/, '');
    const checked = m[1] !== ' ';
    const line = toks[i - 2].map?.[0] ?? -1;
    const box = new state.Token('html_inline', '', 0);
    box.content = `<input type="checkbox" class="task-list-item-checkbox" data-task="${m[1]}" data-task-line="${line}"${checked ? ' checked' : ''}>`;
    inline.children.unshift(box);
    toks[i - 2].attrJoin('class', 'task-list-item' + (checked ? ' is-checked' : ''));
    toks[i - 2].attrSet('data-task', m[1]);
  }
});

// ---------- \pagebreak / \newpage lines ----------
md.core.ruler.after('inline', 'pagebreaks', (state: StateCore) => {
  const toks = state.tokens;
  for (let i = 0; i < toks.length - 2; i++) {
    if (toks[i].type === 'paragraph_open' && toks[i + 1].type === 'inline' && /^\\(pagebreak|newpage)\s*$/.test(toks[i + 1].content)) {
      const t = new state.Token('html_block', '', 0);
      t.content = '<div class="page-break"></div>\n';
      t.map = toks[i].map;
      toks.splice(i, 3, t);
    }
  }
});

// ---------- source line numbers on every block ----------
md.core.ruler.push('data_line', (state: StateCore) => {
  for (const t of state.tokens) {
    if (t.map && (t.nesting === 1 || (t.nesting === 0 && t.type !== 'inline' && t.type !== 'html_block'))) {
      t.attrSet('data-line', String(t.map[0]));
    }
  }
});

md.renderer.rules.fence = (tokens: Token[], idx) => {
  const t = tokens[idx];
  const lang = (t.info || '').trim().split(/\s+/)[0];
  const code = lang ? highlightToHTML(t.content.replace(/\n$/, ''), lang) : esc(t.content.replace(/\n$/, ''));
  const cls = lang ? ` class="language-${esc(lang)}"` : '';
  return `<pre${cls} data-line="${t.map?.[0] ?? 0}"><code${cls}>${code}</code><button class="copy-code-button" aria-label="Kopieren" title="Kopieren">${COPY_ICON}</button></pre>\n`;
};

// links: internal markdown links and external links
const defaultLinkOpen = md.renderer.rules.link_open ?? ((tokens, idx, opts, _env, self) => self.renderToken(tokens, idx, opts));
md.renderer.rules.link_open = (tokens: Token[], idx, opts, env, self) => {
  const t = tokens[idx];
  const href = String(t.attrGet('href') ?? '');
  if (/^[a-z][\w+.-]*:/i.test(href)) {
    t.attrSet('class', 'external-link');
  } else {
    t.attrSet('class', 'internal-link');
    let target = href; try { target = decodeURIComponent(href); } catch { /* keep raw */ }
    t.attrSet('data-href', target);
    t.attrs = (t.attrs ?? []).filter(([k]) => k !== 'href');
  }
  return defaultLinkOpen(tokens, idx, opts, env, self);
};

// markdown images: ![alt|300](path)
md.renderer.rules.image = (tokens: Token[], idx) => {
  const t = tokens[idx];
  const src = String(t.attrGet('src') ?? '');
  const altRaw = t.content;
  const bar = altRaw.lastIndexOf('|');
  const { w, h } = parseSize(bar >= 0 ? altRaw.slice(bar + 1) : undefined);
  const alt = bar >= 0 ? altRaw.slice(0, bar) : altRaw;
  let url = src, path = '';
  if (!/^[a-z][\w+.-]*:/i.test(src)) {
    const r = resolve(src, currentPath);
    if (r) { url = fileURL(r); path = r; }
  }
  const style = [w ? `width:${w}px;flex:0 1 ${w}px` : '', h ? `height:${h}px` : ''].filter(Boolean).join(';');
  return `<img class="ordo-img" decoding="async" src="${esc(url)}" data-path="${esc(path)}" alt="${esc(alt)}"${style ? ` style="${style}"` : ''}>`;
};

// a paragraph made only of 2+ images on one line → row, side by side
md.core.ruler.push('image_rows', (state: StateCore) => {
  const toks = state.tokens;
  for (let i = 1; i < toks.length - 1; i++) {
    if (toks[i].type !== 'inline' || toks[i - 1].type !== 'paragraph_open') continue;
    const kids = toks[i].children ?? [];
    let images = 0, other = false;
    for (const k of kids) {
      if (k.type === 'image' || (k.type === 'html_inline' && k.content.includes('image-embed'))) images++;
      else if (!(k.type === 'text' && !k.content.trim())) { other = true; break; }
    }
    if (!other && images >= 2) toks[i - 1].attrJoin('class', 'ordo-image-row' + (images > 3 ? ' is-wrapped' : ''));
  }
});

export function splitFrontmatter(text: string): { fm: string | null; body: string; lines: number } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(text);
  if (!m) return { fm: null, body: text, lines: 0 };
  const lines = m[0].split('\n').length - (m[2] ? 1 : 0);
  return { fm: m[1], body: text.slice(m[0].length), lines };
}

function renderProperties(fm: string) {
  const rows = fm.split('\n').filter(l => l.trim()).map(l => {
    const m = /^([\w\- ]+):\s*(.*)$/.exec(l);
    if (!m) return `<tr><td></td><td>${esc(l.trim())}</td></tr>`;
    return `<tr><td class="prop-key">${esc(m[1])}</td><td>${esc(m[2])}</td></tr>`;
  }).join('');
  return `<table class="properties" data-line="0">${rows}</table>`;
}

export interface RenderOpts { path: string; showProperties?: boolean }

export function render(text: string, opts: RenderOpts): string {
  currentPath = opts.path;
  const { fm, body, lines } = splitFrontmatter(text);
  // keep line numbers aligned with the source by padding the stripped frontmatter
  const html = md.render('\n'.repeat(lines) + body);
  return sanitize((fm && opts.showProperties !== false ? renderProperties(fm) : '') + html);
}

// Notes may contain raw HTML (Obsidian does too), but a note must never run code in
// the app: no <script>, no on…= handlers, no iframes/forms, no javascript: links.
// ordo: stays allowed for the vault's own pictures.
const SAFE_URI = /^(?:(?:https?|mailto|tel|ordo|obsidian):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;
/** Click on the title of a foldable callout: open / close it. True if it was one. */
export function toggleCallout(target: EventTarget | null): boolean {
  const callout = (target as HTMLElement | null)?.closest?.('.callout.is-collapsible > .callout-title')?.parentElement;
  if (!callout) return false;
  callout.classList.toggle('is-collapsed');
  return true;
}

export function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_URI_REGEXP: SAFE_URI,
    FORBID_TAGS: ['style', 'form', 'iframe', 'frame', 'object', 'embed', 'base', 'meta', 'link'],
    ADD_ATTR: ['data-line', 'data-href', 'data-path', 'data-tex', 'data-display', 'data-callout', 'data-callout-fold'],
  });
}
