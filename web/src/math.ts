// $inline$ and $$display$$ math via KaTeX (as in Obsidian).

import katex from 'katex';
import type { MarkdownIt } from 'markdown-it';
import type { StateInline, StateBlock } from 'markdown-it';

function esc(s: string) { return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!)); }

export function renderMath(tex: string, display: boolean): string {
  let html: string;
  try { html = katex.renderToString(tex, { displayMode: display, throwOnError: false, output: 'html', strict: 'ignore' }); }
  catch { html = `<code>${esc(tex)}</code>`; }
  return display
    ? `<div class="math math-block" data-tex="${esc(tex)}" data-display="1">${html}</div>`
    : `<span class="math math-inline" data-tex="${esc(tex)}">${html}</span>`;
}

function inlineMath(state: StateInline, silent: boolean) {
  const src = state.src, start = state.pos;
  if (src[start] !== '$' || src[start - 1] === '\\') return false;
  if (src[start + 1] === '$') {
    const end = src.indexOf('$$', start + 2);
    if (end < 0 || end === start + 2) return false;
    if (!silent) state.push('html_inline', '', 0).content = renderMath(src.slice(start + 2, end), true);
    state.pos = end + 2;
    return true;
  }
  if (/\s/.test(src[start + 1] ?? ' ')) return false;
  let end = start + 1;
  while ((end = src.indexOf('$', end)) >= 0) {
    if (src[end - 1] !== '\\' && !/\s/.test(src[end - 1]) && !/\d/.test(src[end + 1] ?? '')) break;
    end++;
  }
  if (end < 0 || end === start + 1) return false;
  if (!silent) state.push('html_inline', '', 0).content = renderMath(src.slice(start + 1, end), false);
  state.pos = end + 1;
  return true;
}

function blockMath(state: StateBlock, startLine: number, endLine: number, silent: boolean) {
  let pos = state.bMarks[startLine] + state.tShift[startLine];
  let max = state.eMarks[startLine];
  if (state.src.slice(pos, pos + 2) !== '$$') return false;
  let first = state.src.slice(pos + 2, max);
  let tex = '';
  let line = startLine;
  if (first.trim().endsWith('$$') && first.trim().length > 2) {
    tex = first.trim().slice(0, -2);
  } else {
    const lines = [first];
    let found = false;
    while (++line < endLine) {
      pos = state.bMarks[line] + state.tShift[line];
      max = state.eMarks[line];
      const t = state.src.slice(pos, max);
      if (t.trim().endsWith('$$')) { lines.push(t.trim().slice(0, -2)); found = true; break; }
      lines.push(state.src.slice(state.bMarks[line], max));
    }
    if (!found) return false;
    tex = lines.join('\n');
  }
  if (silent) return true;
  const tok = state.push('html_block', '', 0);
  tok.content = renderMath(tex.trim(), true).replace('<div ', `<div data-line="${startLine}" `) + '\n';
  tok.map = [startLine, line + 1];
  state.line = line + 1;
  return true;
}

export function mathPlugin(md: MarkdownIt) {
  md.inline.ruler.after('escape', 'math_inline', inlineMath);
  md.block.ruler.before('fence', 'math_block', blockMath, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
}
