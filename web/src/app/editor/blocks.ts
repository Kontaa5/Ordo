// Blocks that Obsidian's live preview shows rendered until the cursor enters
// them: properties (frontmatter), callouts, tables, $$ math, note embeds.

import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import { EditorState, Range, StateField } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { render, toggleCallout } from '../../markdown';
import { renderMath } from '../../math';
import { editorHost } from './host';
import { ICONS } from '../icons';

import { t } from '../i18n';
export interface RenderedBlock { from: number; to: number; kind: 'properties' | 'callout' | 'table' | 'math'; text: string }

function touchesSel(state: EditorState, from: number, to: number) {
  for (const r of state.selection.ranges) if (r.from <= to && r.to >= from) return true;
  return false;
}

/** All blocks that can be shown rendered, regardless of the cursor. Cached per document + parse tree. */
let cache: { doc: unknown; tree: unknown; blocks: RenderedBlock[] } | null = null;
function candidateBlocks(state: EditorState): RenderedBlock[] {
  const doc = state.doc, tree = syntaxTree(state);
  if (cache && cache.doc === doc && cache.tree === tree) return cache.blocks;
  const out: RenderedBlock[] = [];
  // frontmatter
  if (doc.lines > 1 && doc.line(1).text.trim() === '---') {
    for (let i = 2; i <= Math.min(doc.lines, 300); i++) {
      if (/^(---|\.\.\.)\s*$/.test(doc.line(i).text)) {
        const to = doc.line(i).to;
        out.push({ from: 0, to, kind: 'properties', text: doc.sliceString(doc.line(1).to + 1, doc.line(i).from) });
        break;
      }
    }
  }
  // callouts and tables: walk block nodes only – top level and inside list items – never inline nodes
  const scan = (parent: SyntaxNode) => {
    for (let n = parent.firstChild; n; n = n.nextSibling) {
      if (n.name === 'Blockquote') {
        const first = doc.lineAt(n.from), last = doc.lineAt(n.to);
        if (/^\s*(?:[-*+]\s+|\d+[.)]\s+)?>\s*\[!/.test(first.text)) out.push({ from: first.from, to: last.to, kind: 'callout', text: doc.sliceString(first.from, last.to) });
      } else if (n.name === 'Table') {
        const first = doc.lineAt(n.from), last = doc.lineAt(n.to);
        out.push({ from: first.from, to: last.to, kind: 'table', text: doc.sliceString(first.from, last.to) });
      } else if (n.name === 'BulletList' || n.name === 'OrderedList' || n.name === 'ListItem') {
        scan(n);
      }
    }
  };
  scan(tree.topNode);
  // $$ … $$ display math
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    if (line.text.trim() !== '$$') continue;
    let j = i + 1;
    while (j <= doc.lines && !doc.line(j).text.trim().endsWith('$$')) j++;
    if (j > doc.lines) break;
    const end = doc.line(j);
    out.push({ from: line.from, to: end.to, kind: 'math', text: doc.sliceString(line.to + 1, end.to).replace(/\$\$\s*$/, '').trim() });
    i = j;
  }
  out.sort((a, b) => a.from - b.from);
  cache = { doc, tree, blocks: out };
  return out;
}

/** Ranges (whole lines) that are shown rendered right now: every candidate the cursor is not in. */
export function renderedBlocks(state: EditorState): RenderedBlock[] {
  return candidateBlocks(state).filter(b => !touchesSel(state, b.from, b.to));
}

class BlockWidget extends WidgetType {
  constructor(readonly block: RenderedBlock) { super(); }
  eq(o: BlockWidget) { return o.block.kind === this.block.kind && o.block.text === this.block.text; }
  get estimatedHeight() { return 80; }

  toDOM(view: EditorView) {
    const b = this.block;
    const host = view.state.facet(editorHost);
    const el = document.createElement('div');
    el.className = 'cm-embed-block ordo-rendered-block ordo-rendered-' + b.kind;
    if (b.kind === 'properties') {
      el.classList.add('metadata-container');
      el.innerHTML = propertiesHTML(b.text);
    } else if (b.kind === 'math') {
      el.classList.add('math', 'math-block');
      el.innerHTML = renderMath(b.text, true);
    } else {
      el.classList.add('markdown-rendered');
      el.innerHTML = render(b.text, { path: host?.path() ?? '', showProperties: false });
      if (b.kind === 'table') el.classList.add('cm-table-widget');
    }
    const edit = document.createElement('div');
    edit.className = 'edit-block-button';
    edit.setAttribute('aria-label', t('Bearbeiten'));
    edit.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="14" height="14">${ICONS.code}</svg>`;
    el.appendChild(edit);
    el.addEventListener('mousedown', e => {
      const t = e.target as HTMLElement;
      if (t.closest('a.internal-link, a.tag, a.external-link') && !t.closest('.edit-block-button')) return;
      e.preventDefault();
      if (!t.closest('.edit-block-button') && toggleCallout(t)) return;
      const pos = view.posAtDOM(el);
      const line = view.state.doc.lineAt(pos);
      const anchor = b.kind === 'properties' ? Math.min(view.state.doc.line(Math.min(2, view.state.doc.lines)).from, view.state.doc.length) : Math.min(line.to, view.state.doc.length);
      view.dispatch({ selection: { anchor } });
      view.focus();
    });
    el.addEventListener('click', e => {
      const a = (e.target as HTMLElement).closest('a.internal-link, a.tag') as HTMLElement | null;
      if (!a || !host) return;
      e.preventDefault();
      if (a.classList.contains('tag')) host.openTag(a.dataset.tag ?? '');
      else host.openLink(a.dataset.href ?? '', e.metaKey || e.ctrlKey);
    });
    return el;
  }
  ignoreEvent() { return true; }
}

function esc(s: string) { return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!)); }

export function propertiesHTML(yaml: string): string {
  const rows: string[] = [];
  const lines = yaml.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^([^\s:#][^:]*):\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    let values: string[] = [];
    const raw = m[2].trim();
    if (!raw) {
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) values.push(lines[++i].replace(/^\s*-\s+/, ''));
    } else if (/^\[.*\]$/.test(raw)) values = raw.slice(1, -1).split(',').map(v => v.trim()).filter(Boolean);
    else values = [raw];
    values = values.map(v => v.replace(/^["']|["']$/g, ''));
    const key = m[1].trim();
    const isTags = /^(tags?|aliases?|cssclasses)$/i.test(key);
    const val = isTags
      ? values.map(v => `<span class="multi-select-pill"><span class="multi-select-pill-content">${esc(key.startsWith('tag') ? v.replace(/^#/, '') : v)}</span></span>`).join('')
      : `<span class="metadata-input-longtext">${esc(values.join(', '))}</span>`;
    rows.push(`<div class="metadata-property" data-property-key="${esc(key)}"><div class="metadata-property-key"><span class="metadata-property-key-input">${esc(key)}</span></div><div class="metadata-property-value">${val}</div></div>`);
  }
  return `<div class="metadata-properties-heading"><div class="metadata-properties-title">Eigenschaften</div></div><div class="metadata-content"><div class="metadata-properties">${rows.join('') || '<div class="metadata-property-empty">Keine Eigenschaften</div>'}</div></div>`;
}

function build(state: EditorState): DecorationSet {
  const decos: Range<Decoration>[] = renderedBlocks(state).map(b =>
    Decoration.replace({ widget: new BlockWidget(b), block: true }).range(b.from, b.to));
  return Decoration.set(decos, true);
}

export const renderedBlocksField = StateField.define<DecorationSet>({
  create: build,
  update(deco, tr) {
    if (tr.docChanged || tr.selection) return build(tr.state);
    return deco;
  },
  provide: f => EditorView.decorations.from(f),
});

/** ![[Note]] embeds shown inline as the note's rendered content. */
export class NoteEmbedWidget extends WidgetType {
  constructor(readonly target: string) { super(); }
  eq(o: NoteEmbedWidget) { return o.target === this.target; }
  toDOM(view: EditorView) {
    const host = view.state.facet(editorHost);
    const el = document.createElement('div');
    el.className = 'internal-embed markdown-embed inline-embed is-loaded cm-embed-block';
    const title = document.createElement('div');
    title.className = 'markdown-embed-title';
    title.textContent = this.target.split('|')[0];
    const content = document.createElement('div');
    content.className = 'markdown-embed-content markdown-rendered';
    const link = document.createElement('div');
    link.className = 'markdown-embed-link';
    link.textContent = '↗';
    link.addEventListener('mousedown', e => { e.preventDefault(); host?.openLink(this.target.split('|')[0], e.metaKey || e.ctrlKey); });
    el.append(title, link, content);
    host?.readNote(this.target).then(res => {
      if (!res) { el.classList.add('is-unresolved'); content.textContent = t('Notiz nicht gefunden'); return; }
      content.innerHTML = render(res.text, { path: res.path, showProperties: false });
    });
    return el;
  }
  ignoreEvent() { return true; }
}
