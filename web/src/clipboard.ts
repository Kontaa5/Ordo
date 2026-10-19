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

// <pre> blocks of any shape (ChatGPT, GitHub, docs): keep the code text verbatim
td.addRule('preBlock', {
  filter: node => node.nodeName === 'PRE',
  replacement: (_content, node) => {
    const pre = node as HTMLElement;
    const code = pre.querySelector('code') ?? pre;
    const text = cleanSpaces(code.textContent ?? '').replace(/\n$/, '');
    const fence = text.includes('```') ? '~~~' : '```';
    return `\n\n${fence}${langOf(code)}\n${text}\n${fence}\n\n`;
  },
});
td.addRule('mark', { filter: ['mark'], replacement: c => `==${c}==` });

// drop UI chrome that sites put next to code ("Copy code" buttons etc.)
td.remove(node => node.nodeName === 'BUTTON' || node.nodeName === 'SCRIPT' || node.nodeName === 'STYLE');

export function cleanSpaces(s: string) {
  return s.replace(/\r\n?/g, '\n').replace(/[   ]/g, ' ').replace(/​/g, '');
}

const MD_HINT = /(^|\n)\s{0,3}(```|~~~|#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s?|\|.*\|)|\*\*[^*\n]+\*\*|\[\[[^\]]+\]\]|\]\([^)]+\)|`[^`\n]+`/;
const SEMANTIC_HTML = /<(p|h[1-6]|ul|ol|li|pre|table|blockquote|strong|b|em|i|a\s|code|img|br)\b/i;
// code editors (VS Code, Xcode) put styled <div>/<span> on the clipboard – that's not prose
const EDITOR_HTML = /<meta[^>]+charset|font-family:\s*[^;"]*(menlo|monaco|consolas|courier|mono)/i;

export function inCodeBlock(state: EditorState, pos: number) {
  for (let n: any = syntaxTree(state).resolveInner(pos, -1); n; n = n.parent) {
    if (n.name === 'FencedCode' || n.name === 'CodeBlock' || n.name === 'InlineCode') return true;
  }
  return false;
}

/** Decide what text a paste should insert. */
export function pasteText(plain: string, html: string, insideCode: boolean): string {
  const text = cleanSpaces(plain);
  if (insideCode) return text;
  if (!html) return text;
  if (text && MD_HINT.test(text)) return text;           // already Markdown (Obsidian, Ordo, .md files)
  if (EDITOR_HTML.test(html) && !/<pre\b/i.test(html)) return text; // copied from a code editor
  if (!SEMANTIC_HTML.test(html)) return text;
  try {
    const md = td.turndown(html).replace(/\n{3,}/g, '\n\n').trim();
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
    p.textContent = `[!${c.dataset.callout ?? 'note'}] ${t?.textContent ?? ''}`.trim();
    if (t) t.replaceWith(p); else c.prepend(p);
  });
  const maths: string[] = [];
  div.querySelectorAll<HTMLElement>('[data-tex]').forEach(m => {
    maths.push(m.dataset.display ? `$$\n${m.dataset.tex}\n$$` : `$${m.dataset.tex}$`);
    m.replaceWith(`ORDOMATH${maths.length - 1}X`);
  });
  return td.turndown(div.innerHTML)
    .replace(/^(\s*)([-*+]|\d+\.)\s{2,}/gm, '$1$2 ')
    .replace(/\\\[([ xX]|![\w-]+)\\\]/g, '[$1]')
    .replace(/^> \n> /gm, '> ')
    .replace(/ORDOMATH(\d+)X/g, (_m, i) => maths[+i])
    .replace(/\\\[\\\[/g, '[[').replace(/\\\]\\\]/g, ']]')
    .replace(/\\#(?=[\p{L}\p{N}_])/gu, '#');
}
