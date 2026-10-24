// Live preview like Obsidian's: formatting characters are only visible on the
// line (or inside the element) the cursor is in. Uses Obsidian's CSS classes
// (HyperMD-*, cm-formatting-*, cm-hashtag …) so Obsidian themes apply.

import { syntaxTree } from '@codemirror/language';
import { EditorState, Range } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from '@codemirror/view';
import { TAG_RE, IMAGE_EXT, parseSize, resolve } from '../../vault';
import { renderMath } from '../../math';
import { editorHost } from './host';
import { ImageWidget, findEmbeds, imageRow, refreshImages } from './images';
import { COPY_ICON, CHECK_ICON } from '../../markdown';
import { NoteEmbedWidget, renderedBlocks } from './blocks';

import { t } from '../i18n';
// ---------- helpers ----------

export function frontmatterRange(state: EditorState): { from: number; to: number } | null {
  const doc = state.doc;
  if (doc.lines < 2 || doc.line(1).text.trim() !== '---') return null;
  for (let i = 2; i <= Math.min(doc.lines, 300); i++) {
    if (/^(---|\.\.\.)\s*$/.test(doc.line(i).text)) return { from: 0, to: doc.line(i).to };
  }
  return null;
}

export function touches(state: EditorState, from: number, to: number) {
  for (const r of state.selection.ranges) if (r.from <= to && r.to >= from) return true;
  return false;
}

export function activeLines(state: EditorState) {
  const set = new Set<number>();
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from).number, b = state.doc.lineAt(r.to).number;
    for (let i = a; i <= b; i++) set.add(i);
  }
  return set;
}

const CODE_NODES = new Set(['FencedCode', 'CodeBlock', 'InlineCode', 'CodeText', 'URL', 'HTMLBlock', 'CommentBlock', 'Autolink']);
export function inCode(state: EditorState, pos: number) {
  for (let n: any = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) if (CODE_NODES.has(n.name)) return true;
  return false;
}

const hide = Decoration.replace({});

/** A state whose selection touches nothing (used while the editor is unfocused). */
function unfocused(state: EditorState): EditorState {
  return Object.create(state, { selection: { value: { ranges: [], main: state.selection.main } } });
}
const mark = (cls: string, attrs?: Record<string, string>) => Decoration.mark({ class: cls, attributes: attrs });
const lineCls = (cls: string, attrs?: Record<string, string>) => Decoration.line({ class: cls, attributes: attrs });

// ---------- small widgets ----------

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean, readonly char: string) { super(); }
  eq(o: CheckboxWidget) { return o.checked === this.checked && o.char === this.char; }
  toDOM(view: EditorView) {
    const label = document.createElement('label');
    label.className = 'task-list-label';
    label.contentEditable = 'false';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'task-list-item-checkbox';
    box.checked = this.checked;
    box.dataset.task = this.char;
    box.addEventListener('mousedown', e => {
      e.preventDefault();
      const pos = view.posAtDOM(label);
      if (!/^\[.\]$/.test(view.state.doc.sliceString(pos, pos + 3))) return;
      view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: this.checked ? ' ' : 'x' } });
    });
    label.appendChild(box);
    return label;
  }
  ignoreEvent() { return true; }
}

class BulletWidget extends WidgetType {
  eq() { return true; }
  toDOM() {
    const s = document.createElement('span');
    s.className = 'list-bullet';
    s.textContent = '•';
    return s;
  }
}

class HrWidget extends WidgetType {
  eq() { return true; }
  toDOM() { const d = document.createElement('div'); d.className = 'hr'; d.appendChild(document.createElement('hr')); return d; }
}

export class MathWidget extends WidgetType {
  constructor(readonly tex: string, readonly display: boolean) { super(); }
  eq(o: MathWidget) { return o.tex === this.tex && o.display === this.display; }
  toDOM(view: EditorView) {
    const el = document.createElement(this.display ? 'div' : 'span');
    el.className = 'math ' + (this.display ? 'math-block cm-embed-block' : 'math-inline is-loaded');
    el.innerHTML = renderMath(this.tex, this.display);
    el.addEventListener('mousedown', e => {
      e.preventDefault();
      const pos = view.posAtDOM(el);
      view.dispatch({ selection: { anchor: pos + (this.display ? 2 : 1) } });
      view.focus();
    });
    return el;
  }
  ignoreEvent() { return true; }
}

class FenceFlairWidget extends WidgetType {
  constructor(readonly lang: string, readonly from: number) { super(); }
  eq(o: FenceFlairWidget) { return o.lang === this.lang; }
  toDOM(view: EditorView) {
    const wrap = document.createElement('span');
    wrap.className = 'code-block-flair-container';
    if (this.lang) {
      const f = document.createElement('span');
      f.className = 'code-block-flair';
      f.textContent = this.lang;
      wrap.appendChild(f);
    }
    const copy = document.createElement('button');
    copy.className = 'copy-code-button';
    copy.innerHTML = COPY_ICON;
    copy.title = t('Kopieren');
    copy.addEventListener('mousedown', e => {
      e.preventDefault();
      e.stopPropagation();
      const pos = view.posAtDOM(wrap);
      for (let n: any = syntaxTree(view.state).resolveInner(pos + 1, 1); n; n = n.parent) {
        if (n.name !== 'FencedCode') continue;
        const text = n.getChild('CodeText');
        navigator.clipboard?.writeText(text ? view.state.sliceDoc(text.from, text.to) : '');
        copy.innerHTML = CHECK_ICON; copy.classList.add('is-copied');
        setTimeout(() => { copy.innerHTML = COPY_ICON; copy.classList.remove('is-copied'); }, 1200);
        break;
      }
    });
    wrap.appendChild(copy);
    return wrap;
  }
  ignoreEvent() { return true; }
}

class ManualBreakWidget extends WidgetType {
  eq() { return true; }
  toDOM(view: EditorView) {
    const d = document.createElement('span');
    d.className = 'ordo-manual-break';
    d.innerHTML = '<span>Seitenumbruch</span><button aria-label="Umbruch entfernen">✕</button>';
    d.querySelector('button')!.addEventListener('mousedown', e => {
      e.preventDefault();
      const line = view.state.doc.lineAt(view.posAtDOM(d));
      view.dispatch({ changes: { from: line.from, to: Math.min(line.to + 1, view.state.doc.length) } });
    });
    return d;
  }
  ignoreEvent() { return false; }
}

// ---------- build ----------

function build(view: EditorView): DecorationSet {
  const { state: realState } = view;
  // like Obsidian: markup is only revealed while the editor has focus
  const state = view.hasFocus ? realState : unfocused(realState);
  const host = state.facet(editorHost);
  const path = host?.path() ?? '';
  const decos: Range<Decoration>[] = [];
  const lines = activeLines(state);
  const fm = frontmatterRange(state);
  const taken: [number, number][] = [];
  const free = (a: number, b: number) => !taken.some(([x, y]) => a < y && b > x);
  const blocks = renderedBlocks(state);
  const inBlock = (pos: number) => blocks.some(b => pos >= b.from && pos <= b.to);
  if (fm && !blocks.some(b => b.kind === 'properties')) {
    const last = state.doc.lineAt(fm.to).number;
    for (let i = 1; i <= last; i++) {
      decos.push(lineCls('cm-hmd-frontmatter HyperMD-frontmatter' + (i === 1 ? ' HyperMD-frontmatter-begin' : i === last ? ' HyperMD-frontmatter-end' : '')).range(state.doc.line(i).from));
    }
  }

  const listLines = new Set<number>(), markLines = new Set<number>(), codeLines = new Set<number>();   // for the indentation guides

  for (const { from, to } of view.visibleRanges) {
    const startLine = state.doc.lineAt(from).number, endLine = state.doc.lineAt(to).number;

    for (let ln = startLine; ln <= endLine; ln++) {
      const line = state.doc.line(ln);
      if (fm && line.to <= fm.to) continue;
      if (inBlock(line.from)) continue;
      const text = line.text;
      if (!text) continue;
      const lineActive = lines.has(ln);

      if (/^\\(pagebreak|newpage)\s*$/.test(text) && !lineActive) {
        decos.push(Decoration.replace({ widget: new ManualBreakWidget() }).range(line.from, line.to));
        continue;
      }

      // a line of only images: rendered side by side, the spaces between them hidden
      const row = lineActive ? null : imageRow(text, line.from, path);
      if (row) {
        decos.push(Decoration.line({ class: 'ordo-image-row' + (row.length > 3 ? ' is-wrapped' : '') }).range(line.from));
        let at = line.from;
        for (const e of row) { if (e.from > at) decos.push(Decoration.replace({}).range(at, e.from)); at = e.to; }
        if (line.to > at) decos.push(Decoration.replace({}).range(at, line.to));
      }

      // embeds: images & notes – rendered unless the cursor is on the line
      for (const e of findEmbeds(text, line.from, path)) {
        if (inCode(state, e.from)) continue;
        taken.push([e.from, e.to]);
        if (!lineActive) {
          if (e.kind === 'image') {
            decos.push(Decoration.replace({ widget: new ImageWidget(e.target, e.path, e.width, e.from, e.to, false) }).range(e.from, e.to));
          } else if (e.kind === 'note') {
            decos.push(Decoration.replace({ widget: new NoteEmbedWidget(e.target) }).range(e.from, e.to));
          } else decos.push(mark('cm-formatting-embed cm-hmd-embed').range(e.from, e.to));
        } else {
          decos.push(mark('cm-formatting-embed cm-hmd-embed').range(e.from, e.to));
        }
      }

      // [[wikilinks]]
      for (const m of text.matchAll(/\[\[([^\[\]\n]+?)\]\]/g)) {
        const s = line.from + m.index!, e = s + m[0].length;
        if (!free(s, e) || inCode(state, s) || text[m.index! - 1] === '!') continue;
        taken.push([s, e]);
        const inner = m[1];
        const bar = inner.indexOf('|');
        const target = bar >= 0 ? inner.slice(0, bar) : inner;
        const base = target.split('#')[0];
        const resolved = !base || !!resolve(base, path);
        const linkCls = 'cm-hmd-internal-link' + (resolved ? '' : ' is-unresolved');
        if (touches(state, s, e)) {
          decos.push(mark('cm-formatting-link cm-formatting-link-start cm-formatting').range(s, s + 2));
          decos.push(mark(linkCls, { 'data-target': target }).range(s + 2, e - 2));
          decos.push(mark('cm-formatting-link cm-formatting-link-end cm-formatting').range(e - 2, e));
        } else {
          const visFrom = bar >= 0 ? s + 2 + bar + 1 : s + 2;
          decos.push(hide.range(s, visFrom));
          decos.push(mark(linkCls, { 'data-target': target }).range(visFrom, e - 2));
          decos.push(hide.range(e - 2, e));
        }
      }

      // $math$
      for (const m of text.matchAll(/\$\$([^$\n]+)\$\$|(?<![\\$])\$(?![\s$])([^$\n]*?[^\s\\$])\$(?![\d$])/g)) {
        const s = line.from + m.index!, e = s + m[0].length;
        if (!free(s, e) || inCode(state, s)) continue;
        taken.push([s, e]);
        if (touches(state, s, e)) { decos.push(mark('cm-math').range(s, e)); continue; }
        const display = m[1] != null;
        decos.push(Decoration.replace({ widget: new MathWidget(display ? m[1] : m[2], display) }).range(s, e));
      }

      // #tags
      for (const m of text.matchAll(TAG_RE)) {
        const s = line.from + m.index! + m[1].length, e = s + 1 + m[2].length;
        if (!free(s, e) || inCode(state, s)) continue;
        const attrs = { 'data-tag': m[2] };
        decos.push(mark('cm-formatting cm-formatting-hashtag cm-hashtag cm-hashtag-begin cm-meta', attrs).range(s, s + 1));
        decos.push(mark('cm-hashtag cm-meta cm-hashtag-end', attrs).range(s + 1, e));
      }

      // ==highlight==
      for (const m of text.matchAll(/==([^=\n]+)==/g)) {
        const s = line.from + m.index!, e = s + m[0].length;
        if (!free(s, e) || inCode(state, s)) continue;
        decos.push(mark('cm-highlight').range(s + 2, e - 2));
        if (touches(state, s, e)) {
          decos.push(mark('cm-formatting cm-formatting-highlight cm-highlight').range(s, s + 2));
          decos.push(mark('cm-formatting cm-formatting-highlight cm-highlight').range(e - 2, e));
        } else { decos.push(hide.range(s, s + 2)); decos.push(hide.range(e - 2, e)); }
      }
    }

    syntaxTree(state).iterate({
      from, to,
      enter: node => {
        if (fm && node.from <= fm.to) return node.to > fm.to ? undefined : false;
        // skip nodes that lie inside a rendered block (not the document node that merely starts there)
        if (blocks.some(b => node.from >= b.from && node.to <= b.to + 1)) return false;
        const name = node.name;
        const ln = state.doc.lineAt(node.from).number;

        const h = /^ATXHeading(\d)$/.exec(name);
        if (h) {
          const line = state.doc.lineAt(node.from);
          decos.push(lineCls(`HyperMD-header HyperMD-header-${h[1]}`).range(line.from));
          const hm = node.node.getChild('HeaderMark');
          const textFrom = hm ? Math.min(hm.to + 1, line.to) : line.from;
          if (hm && hm.from === line.from) {
            if (lines.has(ln)) decos.push(mark(`cm-formatting cm-formatting-header cm-formatting-header-${h[1]} cm-header cm-header-${h[1]}`).range(hm.from, textFrom));
            else decos.push(hide.range(hm.from, textFrom));
          }
          if (line.to > textFrom) decos.push(mark(`cm-header cm-header-${h[1]}`).range(textFrom, line.to));
          return;
        }
        const sh = /^SetextHeading(\d)$/.exec(name);
        if (sh) {
          const a = state.doc.lineAt(node.from), b = state.doc.lineAt(node.to);
          decos.push(lineCls(`HyperMD-header HyperMD-header-${sh[1]}`).range(a.from));
          if (a.to > a.from) decos.push(mark(`cm-header cm-header-${sh[1]}`).range(a.from, a.to));
          if (b.number !== a.number) decos.push(lineCls('cm-formatting-header cm-formatting-header-' + sh[1]).range(b.from));
          return;
        }

        switch (name) {
          case 'Emphasis': case 'StrongEmphasis': case 'Strikethrough': case 'InlineCode': {
            if (!free(node.from, node.to)) return false;
            const cls = { Emphasis: 'cm-em', StrongEmphasis: 'cm-strong', Strikethrough: 'cm-strikethrough', InlineCode: 'cm-inline-code' }[name]!;
            const fmt = { Emphasis: 'cm-formatting-em', StrongEmphasis: 'cm-formatting-strong', Strikethrough: 'cm-formatting-strikethrough', InlineCode: 'cm-formatting-code' }[name]!;
            const markName = { Emphasis: 'EmphasisMark', StrongEmphasis: 'EmphasisMark', Strikethrough: 'StrikethroughMark', InlineCode: 'CodeMark' }[name]!;
            const marks = node.node.getChildren(markName);
            const inner = marks.length >= 2 ? [marks[0].to, marks[marks.length - 1].from] : [node.from, node.to];
            if (inner[1] > inner[0]) decos.push(mark(cls).range(inner[0], inner[1]));
            const show = touches(state, node.from, node.to);
            for (const m of marks) decos.push(show ? mark(`cm-formatting ${fmt} ${cls}`).range(m.from, m.to) : hide.range(m.from, m.to));
            return name === 'InlineCode' ? false : undefined;
          }
          case 'Escape': {
            // \- \* \# …: like Obsidian, only the character shows; the backslash returns when the cursor is there
            if (free(node.from, node.to) && !touches(state, node.from, node.to)) decos.push(hide.range(node.from, node.from + 1));
            return;
          }
          case 'Link': {
            if (!free(node.from, node.to)) return false;
            if (state.doc.sliceString(node.from, node.from + 2) === '[!') return false;
            const marks = node.node.getChildren('LinkMark');
            const url = node.node.getChild('URL');
            if (marks.length < 2) return false;
            const textFrom = marks[0].to, textTo = marks[1].from;
            const href = url ? state.doc.sliceString(url.from, url.to) : '';
            const external = /^[a-z][\w+.-]*:/i.test(href);
            if (textTo > textFrom) decos.push(mark(external ? 'cm-link external-link' : 'cm-link cm-hmd-internal-link', { 'data-href': href }).range(textFrom, textTo));
            if (url && !touches(state, node.from, node.to)) {
              decos.push(hide.range(node.from, textFrom));
              decos.push(hide.range(textTo, node.to));
            } else {
              for (const m of marks) decos.push(mark('cm-formatting cm-formatting-link cm-link').range(m.from, m.to));
              if (url) decos.push(mark('cm-string cm-url').range(url.from, url.to));
            }
            return false;
          }
          case 'Image':
            return false;
          case 'URL':
            if (node.node.parent?.name !== t('Link') && node.node.parent?.name !== 'Image' && free(node.from, node.to))
              decos.push(mark('cm-url external-link', { 'data-href': state.doc.sliceString(node.from, node.to) }).range(node.from, node.to));
            return;
          case 'FencedCode': {
            const a = state.doc.lineAt(node.from), b = state.doc.lineAt(node.to);
            const active = touches(state, node.from, node.to);
            const info = node.node.getChild('CodeInfo');
            const lang = info ? state.doc.sliceString(info.from, info.to).trim() : '';
            for (let i = a.number; i <= b.number; i++) {
              codeLines.add(i);
              const l = state.doc.line(i);
              let cls = 'HyperMD-codeblock HyperMD-codeblock-bg';
              if (i === a.number) cls += ' HyperMD-codeblock-begin HyperMD-codeblock-begin-bg';
              if (i === b.number && b.number > a.number) cls += ' HyperMD-codeblock-end HyperMD-codeblock-end-bg';
              if (!active && (i === a.number || (i === b.number && b.number > a.number))) cls += ' ordo-fence-hidden';
              decos.push(lineCls(cls).range(l.from));
            }
            if (!active) {
              if (a.to > a.from) decos.push(hide.range(a.from, a.to));
              decos.push(Decoration.widget({ widget: new FenceFlairWidget(lang, a.from), side: 1 }).range(a.to));
              if (b.number > a.number && /^\s*(```|~~~)/.test(b.text) && b.to > b.from) decos.push(hide.range(b.from, b.to));
            } else {
              const fence = node.node.getChildren('CodeMark');
              for (const m of fence) decos.push(mark('cm-formatting cm-formatting-code-block cm-hmd-codeblock').range(m.from, m.to));
              if (info) decos.push(mark('cm-formatting cm-formatting-code-block cm-hmd-codeblock').range(info.from, info.to));
            }
            return false;
          }
          case 'CodeBlock': {
            const a = state.doc.lineAt(node.from).number, b = state.doc.lineAt(node.to).number;
            for (let i = a; i <= b; i++) { codeLines.add(i); decos.push(lineCls('HyperMD-codeblock HyperMD-codeblock-bg cm-hmd-indented-code').range(state.doc.line(i).from)); }
            return false;
          }
          case 'Blockquote': {
            const a = state.doc.lineAt(node.from).number, b = state.doc.lineAt(node.to).number;
            for (let i = a; i <= b; i++) decos.push(lineCls('HyperMD-quote HyperMD-quote-1 cm-quote').range(state.doc.line(i).from));
            return;
          }
          case 'QuoteMark':
            if (lines.has(ln)) decos.push(mark('cm-formatting cm-formatting-quote cm-formatting-quote-1 cm-quote cm-quote-1').range(node.from, node.to));
            else decos.push(hide.range(node.from, Math.min(node.to + (state.doc.sliceString(node.to, node.to + 1) === ' ' ? 1 : 0), state.doc.lineAt(node.from).to)));
            return;
          case 'HorizontalRule':
            decos.push(lineCls('HyperMD-hr HyperMD-hr-bg').range(state.doc.lineAt(node.from).from));
            if (!lines.has(ln)) decos.push(Decoration.replace({ widget: new HrWidget() }).range(node.from, node.to));
            else decos.push(mark('cm-hr cm-formatting cm-formatting-hr').range(node.from, node.to));
            return;
          case 'ListItem': {
            const line = state.doc.lineAt(node.from);
            markLines.add(line.number);
            for (let i = Math.max(line.number, startLine), last = Math.min(state.doc.lineAt(node.to).number, endLine); i <= last; i++) listLines.add(i);   // visible lines only
            const depth = (() => { let d = 0; for (let p: any = node.node.parent; p; p = p.parent) if (p.name === 'BulletList' || p.name === 'OrderedList') d++; return d; })();
            const isTask = !!node.node.getChild('Task');
            const indent = /^\s*/.exec(line.text)![0].replace(/\t/g, '    ').length;
            const markLen = (/^\s*([-*+]|\d+[.)])\s/.exec(line.text)?.[0].trimStart().length ?? 2) + (isTask ? 4 : 0);
            decos.push(lineCls(`HyperMD-list-line HyperMD-list-line-${depth}` + (isTask ? ' HyperMD-task-line' : ''), {
              style: `text-indent:-${markLen + indent * 0.5}ch;padding-inline-start:${markLen + indent * 0.5}ch`,
              ...(isTask ? { 'data-task': state.doc.sliceString(line.from, line.to).match(/\[(.)\]/)?.[1] ?? ' ' } : {}),
            }).range(line.from));
            return;
          }
          case 'ListMark': {
            const isTask = node.node.nextSibling?.name === 'Task';
            const ch = state.doc.sliceString(node.from, node.to);
            const ordered = /\d/.test(ch);
            const active = lines.has(ln);
            if (isTask && !active) {
              decos.push(hide.range(node.from, Math.min(node.to + 1, state.doc.lineAt(node.from).to)));
            } else if (!ordered && !active) {
              // the bullet takes "-" and the space after it (2ch, like the hanging indent): wrapped lines start under the text
              const end = state.sliceDoc(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to;
              decos.push(Decoration.replace({ widget: new BulletWidget() }).range(node.from, end));
            } else {
              decos.push(mark(`cm-formatting cm-formatting-list cm-formatting-list-${ordered ? 'ol' : 'ul'} cm-list-1`).range(node.from, node.to));
            }
            return;
          }
          case 'TaskMarker': {
            const char = state.doc.sliceString(node.from + 1, node.from + 2);
            const checked = char !== ' ';
            if (!touches(state, node.from, node.to)) decos.push(Decoration.replace({ widget: new CheckboxWidget(checked, char) }).range(node.from, node.to));
            else decos.push(mark('cm-formatting cm-formatting-task').range(node.from, node.to));
            return;
          }
          case 'Table': {
            const a = state.doc.lineAt(node.from).number, b = state.doc.lineAt(node.to).number;
            for (let i = a; i <= b; i++) decos.push(lineCls('HyperMD-table-row HyperMD-table-row-' + (i - a) + ' cm-hmd-table-sep-dummy').range(state.doc.line(i).from));
            return false;
          }
          case 'HTMLBlock':
            return false;
        }
      },
    });
  }
  // indentation guides (like Obsidian): every tab or 4 spaces at the start of a list line gets a thin vertical line
  for (const ln of listLines) {
    if (codeLines.has(ln)) continue;
    const line = state.doc.line(ln);
    const ws = /^[\t ]*/.exec(line.text)![0];
    // indented text below a list item: wrapped lines continue under the text, not at the left edge
    const indent = ws.replace(/\t/g, '    ').length;
    if (indent && !markLines.has(ln)) decos.push(lineCls('', { style: `text-indent:-${indent * 0.5}ch;padding-inline-start:${indent * 0.5}ch` }).range(line.from));
    let spaces = 0;
    for (let i = 0; i < ws.length; i++) {
      if (ws[i] === '\t') { spaces = 0; decos.push(mark('cm-indent').range(line.from + i, line.from + i + 1)); }
      else if (++spaces === 4) { spaces = 0; decos.push(mark('cm-indent').range(line.from + i - 3, line.from + i + 1)); }
    }
  }
  return Decoration.set(decos, true);
}

export const livePreview = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = build(view); }
  update(u: ViewUpdate) {
    if (u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged || syntaxTree(u.startState) !== syntaxTree(u.state)
      || u.transactions.some(tr => tr.effects.some(e => e.is(refreshImages)))) {   // a picture was edited: show the new version right away
      this.decorations = build(u.view);
    }
  }
}, {
  decorations: v => v.decorations,
  eventHandlers: {
    mousedown(e: MouseEvent, view: EditorView) {
      const el = (e.target as HTMLElement).closest('[data-target],[data-href],[data-tag]') as HTMLElement | null;
      const host = view.state.facet(editorHost);
      if (!el || !host) return false;
      const mod = e.metaKey || e.ctrlKey;
      // links whose markup is visible are edited, unless ⌘ is held
      const revealed = el.classList.contains('cm-hmd-internal-link') && el.previousElementSibling?.classList.contains('cm-formatting-link');
      if (el.dataset.tag) {
        if (!mod) return false;
        e.preventDefault(); host.openTag(el.dataset.tag); return true;
      }
      if (revealed && !mod) return false;
      const target = el.dataset.target ?? el.dataset.href ?? '';
      if (!target) return false;
      e.preventDefault();
      host.openLink(target, mod);
      return true;
    },
  },
});

export { IMAGE_EXT, parseSize };
