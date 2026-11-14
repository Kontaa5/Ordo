// Smart paste & copy: keep Markdown exactly as copied, turn rich text from web
// pages into clean Markdown (code blocks with language), never touch code.

import TurndownService from 'turndown';
// @ts-ignore – no types shipped
import { gfm } from 'turndown-plugin-gfm';
import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';

const td = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '*',
  strongDelimiter: '**',
  hr: '---',
});
td.use(gfm);

function langOf(el: Element | null): string {
  for (let n: Element | null = el; n; n = n.parentElement) {
    const cls = n.getAttribute?.('class') ?? '';
    const m = /(?:^|\s)(?:language|lang|highlight-source|hljs-language)-([\w+#-]+)/.exec(cls)
      ?? /(?:^|\s)hljs\s+([\w+#-]+)/.exec(cls);
    if (m) return m[1];
    const data = n.getAttribute?.('data-language') ?? n.getAttribute?.('data-lang');
    if (data) return data;
    if (n.tagName === 'PRE') break;
  }
  return '';
}

const BLOCK_TAGS = new Set(['DIV', 'P', 'LI', 'TR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

/** Text of a code block with its line breaks: code viewers (Expressive Code, GitHub, Shiki …)
 *  often put each line into its own <div> or end it with <br> instead of a newline character. */
export function codeText(el: Node): string {
  let out = '';
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) { out += n.nodeValue ?? ''; return; }
    if (n.nodeName === 'BR') { out += '\n'; return; }
    if (n.nodeName === 'BUTTON') return;
    n.childNodes.forEach(walk);
    if (BLOCK_TAGS.has(n.nodeName) && n !== el && !out.endsWith('\n')) out += '\n';
  };
  walk(el);
  return out;
}

// <pre> blocks of any shape (ChatGPT, GitHub, docs): keep the code text verbatim
td.addRule('preBlock', {
  filter: node => node.nodeName === 'PRE',
  replacement: (_content, node) => {
    const pre = node as HTMLElement;
    const code = pre.querySelector('code') ?? pre;
    const text = cleanSpaces(codeText(code)).replace(/\n+$/, '');
    const fence = text.includes('```') ? '~~~' : '```';
    return `\n\n${fence}${langOf(code)}\n${text}\n${fence}\n\n`;
  },
});
td.addRule('notBold', {
  filter: node => (node.nodeName === 'B' || node.nodeName === 'STRONG') && NORMAL.test((node as HTMLElement).style?.cssText ?? ''),
  replacement: c => c,
});
td.addRule('styledText', {
  filter: node => node.nodeName === 'SPAN' && (BOLD.test((node as HTMLElement).style.cssText) || ITALIC.test((node as HTMLElement).style.cssText)),
  replacement: (c, node) => {
    if (!c.trim()) return c;
    const css = (node as HTMLElement).style.cssText;
    const m = (BOLD.test(css) ? '**' : '') + (ITALIC.test(css) ? '*' : '');
    const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(c)!;
    return `${lead}${m}${core}${[...m].reverse().join('')}${trail}`;
  },
});
td.addRule('mark', { filter: ['mark'], replacement: c => `==${c}==` });

// drop UI chrome that sites put next to code ("Copy code" buttons etc.)
td.remove(node => node.nodeName === 'BUTTON' || node.nodeName === 'SCRIPT' || node.nodeName === 'STYLE');

export function cleanSpaces(s: string) {
  return s.replace(/\r\n?/g, '\n').replace(/[   ]/g, ' ').replace(/​/g, '');
}

const MD_HINT = /(^|\n)\s{0,3}(```|~~~|#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s?|\|.*\|)|\*\*[^*\n]+\*\*|\[\[[^\]]+\]\]|\]\([^)]+\)|`[^`\n]+`/;
const RICH = 'p,h1,h2,h3,h4,h5,h6,ul,ol,li,pre,table,blockquote,strong,b,em,i,a[href],code,img,br,mark,s,del';
const MONO = /font-family:[^;"]*(menlo|monaco|consolas|courier|mono)/i;
const BOLD = /font-weight:\s*(bold|[6-9]00)/i, ITALIC = /font-style:\s*italic/i, NORMAL = /font-weight:\s*(normal|[1-4]00)/i;
/** Our own copies carry the Markdown source under this type. */
export const ORDO_MD = 'application/x-ordo-markdown';

/** Turndown writes "-   item"; Markdown editors write "- item". */
const tidyLists = (md: string) => md.replace(/^(\s*)([-*+]|\d+\.)\s{2,}/gm, '$1$2 ');

export function inCodeBlock(state: EditorState, pos: number) {
  for (let n: any = syntaxTree(state).resolveInner(pos, -1); n; n = n.parent) {
    if (n.name === 'FencedCode' || n.name === 'CodeBlock' || n.name === 'InlineCode') return true;
  }
  return false;
}

/** Decide what text a paste should insert. */
export function pasteText(plain: string, html: string, insideCode: boolean): string {
  const text = cleanSpaces(plain);
  if (insideCode || !html) return text;
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  const styled = [...body.querySelectorAll<HTMLElement>('[style]')];
  const rich = body.querySelector(RICH) || styled.some(el => BOLD.test(el.style.cssText) || ITALIC.test(el.style.cssText));
  if (!rich) return text;
  // code editors (VS Code …) copy styled monospace <div>/<span>s without real structure – that's code, not prose
  if (!body.querySelector('p,h1,h2,h3,h4,h5,h6,li,a[href],pre,table') && styled.some(el => MONO.test(el.style.cssText))) return text;
  // Markdown shown as styled text (an editor showing .md source): the syntax is in the HTML text itself
  if (MD_HINT.test(text) && MD_HINT.test(cleanSpaces(body.textContent ?? ''))) return text;
  try {
    const md = tidyLists(td.turndown(body)).replace(/\n{3,}/g, '\n\n').trim();
    return md || text;
  } catch { return text; }
}

/** Markdown for a DOM selection (copy in reading mode). */
export function selectionToMarkdown(sel: Selection): string | null {
  if (!sel.rangeCount || sel.isCollapsed) return null;
  const div = document.createElement('div');
  for (let i = 0; i < sel.rangeCount; i++) div.appendChild(sel.getRangeAt(i).cloneContents());
  // our own rendering: restore source forms of wikilinks, tags, images, checkboxes
  div.querySelectorAll<HTMLElement>('a.internal-link').forEach(a => a.replaceWith(`[[${a.dataset.href ?? a.textContent}]]`));
  div.querySelectorAll<HTMLElement>('a.tag').forEach(a => a.replaceWith(`#${a.dataset.tag ?? ''}`));
  div.querySelectorAll<HTMLImageElement>('img.ordo-img').forEach(img => {
    const p = img.dataset.path?.split('/').pop() ?? img.alt;
    const w = img.style.width ? '|' + parseInt(img.style.width) : '';
    img.replaceWith(`![[${p}${w}]]`);
  });
  div.querySelectorAll<HTMLInputElement>('input.task-checkbox').forEach(c => c.replaceWith(c.checked ? '[x] ' : '[ ] '));
  div.querySelectorAll('.katex-mathml, table.properties').forEach(m => m.remove());
  div.querySelectorAll<HTMLElement>('.callout').forEach(c => {
    const t = c.querySelector('.callout-title');
    const p = document.createElement('p');
    p.textContent = `[!${c.dataset.callout ?? 'note'}]${c.dataset.calloutFold ?? ''} ${t?.textContent ?? ''}`.trim();
    if (t) t.replaceWith(p); else c.prepend(p);
  });
  const maths: string[] = [];
  div.querySelectorAll<HTMLElement>('[data-tex]').forEach(m => {
    maths.push(m.dataset.display ? `$$\n${m.dataset.tex}\n$$` : `$${m.dataset.tex}$`);
    m.replaceWith(`ORDOMATH${maths.length - 1}X`);
  });
  return tidyLists(td.turndown(div.innerHTML))
    .replace(/\\\[([ xX]|![\w-]+)\\\]/g, '[$1]')
    .replace(/^> \n> /gm, '> ')
    .replace(/ORDOMATH(\d+)X/g, (_m, i) => maths[+i])
    .replace(/\\\[\\\[/g, '[[').replace(/\\\]\\\]/g, ']]')
    .replace(/\\#(?=[\p{L}\p{N}_])/gu, '#');
}

// ---------- "Kopieren als …" ----------

/**
 * Plain Markdown that any app understands: no Obsidian/Ordo extras. Comments (%%pagebreak%%, column markers)
 * go, columns become paragraphs one below the other, [[links]] become their text, ![[pictures]] standard
 * image links, sizes / alignment and ==highlights== are dropped, callouts become quotes with a bold title.
 */
export function plainMarkdown(md: string): string {
  const fence = /^\s*(```|~~~)/;
  let inFence = false;
  const out: string[] = [];
  for (const raw of md.split('\n')) {
    if (fence.test(raw)) { inFence = !inFence; out.push(raw); continue; }
    if (inFence) { out.push(raw); continue; }
    if (/^%%\s*column\s*%%\s*$/i.test(raw)) { out.push(''); continue; }   // between two columns: a paragraph break
    let line = raw.replace(/%%[\s\S]*?%%/g, '');
    if (raw.trim() && !line.trim()) continue;   // the line was only a comment
    line = line
      .replace(/!\[\[([^\[\]|\n]+?)(?:\|[^\[\]\n]*)?\]\]/g, (_m, target: string) => {
        const name = target.split('#')[0].trim();
        return /\.(png|jpe?g|gif|webp|svg|heic|bmp)$/i.test(name) ? `![${name.replace(/\.\w+$/, '')}](${encodeURI(name)})` : name;
      })
      .replace(/!\[([^\]|\n]*)\|[^\]\n]*\]\(/g, '![$1](')
      .replace(/\[\[([^\[\]|\n]+?)(?:\|([^\[\]\n]*))?\]\]/g, (_m, target: string, alias?: string) => alias || target.replace(/#/g, ' › '))
      .replace(/==([^=\n]+)==/g, '$1')
      .replace(/^(\s*>+)\s*\[!([\w-]+)\][+-]?\s*(.*)$/, (_m, q: string, kind: string, title: string) => `${q} **${title || kind.charAt(0).toUpperCase() + kind.slice(1)}**`);
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Rendered HTML for Word, Pages, Mail …: pictures embedded (not as links to files), no Ordo controls, no page-break markers. */
export async function richHTML(container: HTMLElement): Promise<string> {
  container.querySelectorAll('button, .copy-code-button, .katex-mathml, table.properties, .page-break, .edit-block-button, .ordo-heading-fold').forEach(el => el.remove());
  await Promise.all([...container.querySelectorAll('img')].map(async img => {
    try {
      const blob = await (await fetch(img.src)).blob();
      img.src = await new Promise<string>((ok, fail) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = fail; r.readAsDataURL(blob); });
      img.removeAttribute('data-path');
    } catch { /* keep the link */ }
  }));
  return container.innerHTML;
}
