// Markdown view: inline title + live-preview editor (CodeMirror 6) and the
// reading view, with Obsidian's DOM classes.

import { EditorState, Extension, EditorSelection, Prec } from '@codemirror/state';
import { EditorView, keymap, drawSelection, dropCursor, rectangularSelection, crosshairCursor } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo, selectAll } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxHighlighting, indentOnInput, bracketMatching, indentUnit } from '@codemirror/language';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, CompletionContext, acceptCompletion } from '@codemirror/autocomplete';
import { search, searchKeymap, highlightSelectionMatches, openSearchPanel } from '@codemirror/search';

import { View, Leaf, ViewState, registerView, workspace } from '../workspace';
import { h, icon, iconButton, debounce, noteName, dirname, basename } from '../dom';
import { request, on, emit } from '../host';
import { vault } from '../store';
import { notice } from '../ui/notice';
import { Menu } from '../ui/menu';
import { hotkeyLabel, executeCommand } from '../commands';
import { editorHost, EditorHost } from '../editor/host';
import { livePreview } from '../editor/livePreview';
import { renderedBlocksField } from '../editor/blocks';
import { arrows } from '../editor/arrows';
import { tagCase } from '../editor/tagCase';
import { wrapOnType } from '../editor/wrap';
import { blockDrag, unwrapColumnsChange, sideBySideBlocksChange } from '../editor/blockDrag';
import { imagesBelowField, imageDrop, refreshImages, bumpImage, versionedURL, sideBySideChange, stackedChange } from '../editor/images';
import { pageBreakField, setPageBreaks } from '../editor/pageBreaks';
import { codeLanguage, codeHighlightStyle } from '../editor/code';
import { mathCompletion } from '../modals/mathPalette';
import { render, COPY_ICON, CHECK_ICON } from '../../markdown';
import { paginate, applyGeomVars, contentSize, whenImagesLoaded } from '../../paginate';
import { pasteText, inCodeBlock, selectionToMarkdown, ORDO_MD } from '../../clipboard';
import { openLightbox } from '../../lightbox';
import { openImageEditor } from '../../imageEditor';
import { blobToBase64 } from '../../bridge';
import { getIndex, IMAGE_EXT } from '../../vault';
import { appState } from '../state';
import { t } from '../i18n';

export class MarkdownView extends View {
  path = '';
  mode: 'source' | 'preview' = 'source';
  editor: EditorView;
  sourceEl: HTMLElement;
  readingEl: HTMLElement;
  previewEl: HTMLElement;
  inlineTitle: HTMLElement;
  breadcrumbEl: HTMLElement;
  titleTextEl: HTMLElement;
  modeButton: HTMLElement;
  private dirty = false;
  private loaded = false;
  private offs: (() => void)[] = [];
  private lastSaved = '';
  private pages: number | null = null;

  constructor(leaf: Leaf) {
    super(leaf);
    this.breadcrumbEl = h('div', { cls: 'view-header-title-parent' });
    this.titleTextEl = h('div', { cls: 'view-header-title', tabindex: '-1' });
    this.titleEl.append(this.breadcrumbEl, this.titleTextEl);
    this.titleTextEl.addEventListener('click', () => this.focusTitle());

    const more = iconButton('more-vertical', t('Weitere Optionen'), e => this.moreMenu(e), 'view-action');
    this.modeButton = iconButton('book-open', t('Lesemodus'), () => this.toggleMode(), 'view-action');
    this.actionsEl.append(this.modeButton, more);

    this.inlineTitle = h('div', { cls: 'inline-title', contenteditable: 'true', spellcheck: 'false', 'data-placeholder': t('Unbenannt') });
    this.inlineTitle.addEventListener('keydown', e => {
      if (e.key === 'Enter' || (e.key === 'ArrowDown' && !e.shiftKey)) {
        e.preventDefault();
        e.stopPropagation();
        this.commitTitle();
        if (this.mode === 'source') { this.editor.focus(); this.editor.dispatch({ selection: { anchor: 0 } }); }
      } else if (e.key === 'Escape') { this.inlineTitle.textContent = noteName(this.path); this.inlineTitle.blur(); }
    });
    this.inlineTitle.addEventListener('blur', () => this.commitTitle());
    this.inlineTitle.addEventListener('paste', e => {
      e.preventDefault();
      document.execCommand('insertText', false, (e.clipboardData?.getData('text/plain') ?? '').replace(/\n/g, ' '));
    });

    this.editor = new EditorView({ state: this.makeState(''), parent: undefined });
    // the title lives above the editor content (like Obsidian's .cm-sizer), not inside CodeMirror
    this.editor.scrollDOM.insertBefore(this.inlineTitle, this.editor.contentDOM);
    this.sourceEl = h('div', { cls: 'markdown-source-view cm-s-obsidian mod-cm6 is-live-preview is-folding show-properties node-insert-event' }, this.editor.dom);
    this.previewEl = h('div', { cls: 'markdown-preview-view markdown-rendered node-insert-event allow-fold-headings show-indentation-guide allow-fold-lists show-properties' });
    this.readingEl = h('div', { cls: 'markdown-reading-view' }, this.previewEl);
    this.readingEl.style.display = 'none';
    this.contentEl.append(this.sourceEl, this.readingEl);
    this.contentEl.addEventListener('contextmenu', e => this.contextMenu(e));
    this.wireReading();
    this.applyReadable();

    this.offs.push(
      on('renamed', ({ from, to }: { from: string; to: string }) => { if (from === this.path) this.setPath(to); }),
      on('external-change', ({ path, text }: { path: string; text: string }) => { if (path === this.path) this.externalChange(text); }),
      on('deleted', (path: string) => { if (path === this.path) this.leaf.ws.closeLeaf(this.leaf); }),
      on('settings-changed', () => { this.applyReadable(); this.schedulePages(); }),
      on('page-breaks-changed', () => this.schedulePages(true)),
      on('vault-changed', () => { this.editor.dispatch({ effects: refreshImages.of(null) }); this.updateBreadcrumb(); }),
      on('flush', () => this.flush()),
      // pictures were re-saved (cropped, made smaller): reload them
      on('images-changed', () => { this.editor.dispatch({ effects: refreshImages.of(null) }); if (this.mode === 'preview') this.renderPreview(); }),
    );
  }

  getViewType() { return 'markdown'; }
  getDisplayText() { return noteName(this.path) || t('Unbenannt'); }
  getIcon() { return 'file-text'; }
  getState(): ViewState { return { type: 'markdown', path: this.path, mode: this.mode }; }

  async setState(s: ViewState) {
    if (s.type !== 'markdown') return;
    if (s.path !== this.path) {
      if (this.path) await this.leave();
      this.path = s.path;
      this.loaded = false;
      const text = await request<string>('read', { path: s.path });
      this.lastSaved = text;
      this.editor.setState(this.makeState(text));
      // start below the frontmatter so the properties render as a box
      const fm = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/.exec(text);
      if (fm) this.editor.dispatch({ selection: { anchor: Math.min(text.length, fm[0].length) } });
      this.dirty = false;
      this.loaded = true;
      request('noteOpened', { path: s.path }).catch(() => {});
      this.updateTitle();
      // on the phone notes are mostly read: open them in reading view (new notes ask for 'source')
      this.mode = s.mode ?? (vault.settings?.defaultMode === 'read' || document.body.classList.contains('is-mobile') ? 'preview' : 'source');
      this.applyMode();
      emit('file-open', this.path);
    } else if (s.mode && s.mode !== this.mode) {
      this.mode = s.mode;
      this.applyMode();
    }
    if (s.line != null) this.scrollToLine(s.line);
    this.schedulePages(true);
    this.emitStats();
  }

  onClose() {
    this.leave();
    this.offs.forEach(f => f());
    this.editor.destroy();
  }

  focus() { if (this.mode === 'source') this.editor.focus(); }

  focusTitle() {
    this.inlineTitle.focus();
    const r = document.createRange();
    r.selectNodeContents(this.inlineTitle);
    const sel = getSelection(); sel?.removeAllRanges(); sel?.addRange(r);
  }

  // ---------- editor state ----------

  private host(): EditorHost {
    return {
      path: () => this.path,
      openLink: (target, newLeaf) => openLinkText(target, this.path, newLeaf),
      openTag: tag => emit('open-tag', tag),
      openImage: (path, url) => this.openImage(path, url),
      editImage: (path, url) => this.editImage(path, url),
      readNote: target => request('readNote', { target, from: this.path }),
    };
  }

  private makeState(doc: string): EditorState {
    return EditorState.create({ doc, extensions: this.extensions() });
  }

  private extensions(): Extension[] {
    return [
      editorHost.of(this.host()),
      history(),
      drawSelection(),
      dropCursor(),
      rectangularSelection(),
      crosshairCursor(),
      indentOnInput(),
      indentUnit.of('    '),
      EditorState.tabSize.of(4),
      bracketMatching(),
      closeBrackets(),
      highlightSelectionMatches(),
      markdown({ base: markdownLanguage, codeLanguages: codeLanguage, addKeymap: true }),
      syntaxHighlighting(codeHighlightStyle),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ spellcheck: appState.spellcheck ? 'true' : 'false', autocorrect: 'off', autocapitalize: 'sentences' }),
      livePreview,
      renderedBlocksField,
      imagesBelowField,
      imageDrop,
      blockDrag,
      arrows,
      pageBreakField,
      autocompletion({ override: [wikiCompletion, tagCompletion, mathCompletion], icons: false, activateOnTyping: true }),
      search({ top: true }),
      Prec.high(keymap.of([{ key: 'Tab', run: acceptCompletion }])),   // Tab takes the suggestion; without a list it indents as usual
      tagCase,
      wrapOnType,
      keymap.of([...closeBracketsKeymap, ...completionKeymap, ...searchKeymap, ...historyKeymap, ...defaultKeymap, indentWithTab]),
      EditorView.updateListener.of(u => {
        if (u.docChanged && this.loaded) { this.dirty = true; this.scheduleSave(); this.schedulePages(); }
        if (u.docChanged || u.selectionSet) this.emitStatsSoon();   // counting words of a long note on every key would slow typing
      }),
      EditorView.domEventHandlers({
        paste: (e, view) => this.onPaste(e, view),
        copy: (e, view) => this.onCopy(e, view, false),
        cut: (e, view) => this.onCopy(e, view, true),
        drop: (e, view) => {
          const files = Array.from(e.dataTransfer?.files ?? []);
          if (!files.length) return false;
          e.preventDefault();
          this.insertFiles(files, view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.selection.main.head);
          return true;
        },
      }),
    ];
  }

  // ---------- saving ----------

  private scheduleSave = debounce(() => this.save(), 450);
  private emitStatsSoon = debounce(() => this.emitStats(), 150);

  private async save() {
    if (!this.path || !this.loaded) return;
    const text = this.editor.state.doc.toString();
    const path = this.path;
    if (text === this.lastSaved) { this.dirty = false; return; }
    this.lastSaved = text;
    this.dirty = false;
    try {
      const res = await request<{ path: string; moved: boolean; from: string }>('write', { path, text, typingTag: cursorInTag(this.editor.state) });
      if (res?.moved) announceMove(res.from, res.path);
    } catch (e) { notice(t('Speichern fehlgeschlagen: ') + e); this.dirty = true; }
  }

  flush() { if (this.dirty) { this.scheduleSave.cancel(); this.save(); } }

  private async leave() {
    if (!this.path) return;
    this.scheduleSave.cancel();
    const text = this.editor.state.doc.toString();
    try {
      if (text !== this.lastSaved) { this.lastSaved = text; await request('write', { path: this.path, text, typingTag: true }); }
      const res = await request<{ path: string; moved: boolean; from: string }>('leave', { path: this.path });
      if (res?.moved) announceMove(res.from, res.path);
    } catch { /* closed vault */ }
  }

  private externalChange(text: string) {
    if (this.dirty || text === this.editor.state.doc.toString()) return;
    const head = Math.min(this.editor.state.selection.main.head, text.length);
    this.loaded = false;
    this.editor.dispatch({ changes: { from: 0, to: this.editor.state.doc.length, insert: text }, selection: { anchor: head } });
    this.loaded = true;
    this.lastSaved = text;
    if (this.mode === 'preview') this.renderPreview();
  }

  setPath(p: string) {
    this.path = p;
    this.updateTitle();
    this.leaf.ws.updateTabHeader(this.leaf);
    this.leaf.ws.requestSave();
    emit('file-open', p);
  }

  private updateTitle() {
    if (document.activeElement !== this.inlineTitle) this.inlineTitle.textContent = noteName(this.path);
    this.titleTextEl.textContent = noteName(this.path);
    this.updateBreadcrumb();
    this.leaf.ws.updateTabHeader(this.leaf);
  }

  private updateBreadcrumb() {
    const parts = dirname(this.path).split('/').filter(Boolean);
    this.breadcrumbEl.replaceChildren(...parts.flatMap((p, i) => [
      h('span', { cls: 'view-header-breadcrumb', text: p, onclick: () => emit('reveal-folder', parts.slice(0, i + 1).join('/')) }),
      h('span', { cls: 'view-header-breadcrumb-separator', text: '/' }),
    ]));
  }

  private renaming = false;
  private async commitTitle() {
    if (this.renaming) return;
    const name = (this.inlineTitle.textContent ?? '').replace(/[\\/:]/g, '-').replace(/\s+/g, ' ').trim();
    if (!name || name === noteName(this.path)) { this.inlineTitle.textContent = noteName(this.path); return; }
    const target = (dirname(this.path) ? dirname(this.path) + '/' : '') + name + '.md';
    if (target.toLowerCase() !== this.path.toLowerCase() && vault.notes.has(target)) {
      notice(t('Name existiert bereits') + `: „${name}“`);
      this.inlineTitle.textContent = noteName(this.path);
      return;
    }
    this.renaming = true;
    try {
      const dest = await request<string>('rename', { path: this.path, name });
      if (dest && dest !== this.path) this.setPath(dest);
    } catch (e) { notice(t('Umbenennen fehlgeschlagen') + ': ' + e); this.inlineTitle.textContent = noteName(this.path); }
    finally { this.renaming = false; }
  }

  // ---------- modes ----------

  toggleMode() { this.mode = this.mode === 'source' ? 'preview' : 'source'; this.applyMode(); this.leaf.ws.requestSave(); }

  private applyMode() {
    const src = this.mode === 'source';
    this.sourceEl.style.display = src ? '' : 'none';
    this.readingEl.style.display = src ? 'none' : '';
    this.containerEl.dataset.mode = src ? 'source' : 'preview';
    this.modeButton.replaceChildren(icon(src ? 'book-open' : 'pencil'));
    this.modeButton.setAttribute('aria-label', src ? t('Lesemodus') : t('Bearbeiten'));
    if (src) { this.editor.requestMeasure(); } else this.renderPreview();
    this.emitStats();
    emit('mode-change', this);
  }

  private applyReadable() {
    const readable = vault.settings?.readableLineWidth ?? true;
    this.sourceEl.classList.toggle('is-readable-line-width', readable);
    this.previewEl.classList.toggle('is-readable-line-width', readable);
  }

  // ---------- reading view ----------

  async renderPreview() {
    const text = this.editor.state.doc.toString();
    const paged = appState.showPageBreaks;
    this.previewEl.classList.toggle('ordo-paged', paged);
    const title = h('div', { cls: 'inline-title', text: noteName(this.path) });
    if (!paged) {
      const sizer = h('div', { cls: 'markdown-preview-sizer markdown-preview-section' });
      sizer.innerHTML = render(text, { path: this.path });
      sizer.prepend(title);
      this.previewEl.replaceChildren(sizer);
      this.fillEmbeds(sizer);
      return;
    }
    const slices = await measurePages(text, this.path);
    const g = pageGeom();
    const { w } = contentSize(g);
    const scale = Math.min(1.45, Math.max(0.4, (this.previewEl.clientWidth - 48) / g.pageW));
    const html = measureEl().innerHTML;
    const frag = document.createDocumentFragment();
    slices.forEach((s, i) => {
      const page = h('div', { cls: 'ordo-sheet', style: { width: g.pageW * scale + 'px', height: g.pageH * scale + 'px' } });
      page.innerHTML = `<div class="ordo-sheet-inner" style="transform:scale(${scale});width:${g.pageW}px;height:${g.pageH}px">
        <div class="ordo-sheet-clip" style="left:${g.ml}px;top:${g.mt}px;width:${w}px;height:${s.height}px">
          <div class="print-body markdown-rendered" style="position:absolute;top:${-s.top}px;--content-w:${w}px;--print-font:${g.fontSize}px">${html}</div>
        </div>
        <div class="ordo-sheet-num" style="bottom:${Math.max(12, g.mb / 2 - 6)}px">${i + 1} / ${slices.length}</div></div>`;
      frag.appendChild(page);
    });
    this.previewEl.replaceChildren(frag);
    this.pages = slices.length;
    this.emitStats();
  }

  private async fillEmbeds(root: HTMLElement, depth = 0) {
    if (depth > 1) return;
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('.embed-note:not(.loaded)'))) {
      el.classList.add('loaded', 'internal-embed', 'markdown-embed');
      const res = await request<{ path: string; text: string } | null>('readNote', { target: el.dataset.href, from: this.path }).catch(() => null);
      if (!res) { el.classList.add('is-unresolved'); continue; }
      const body = h('div', { cls: 'markdown-embed-content markdown-rendered' });
      body.innerHTML = render(res.text, { path: res.path, showProperties: false });
      el.appendChild(body);
      this.fillEmbeds(body, depth + 1);
    }
  }

  private wireReading() {
    this.previewEl.addEventListener('copy', e => {
      const sel = window.getSelection();
      const md = sel && selectionToMarkdown(sel);
      if (!md || !e.clipboardData) return;
      e.preventDefault();
      this.fillClipboard(e.clipboardData, md, sel);
    });
    this.previewEl.addEventListener('click', e => {
      const el = e.target as HTMLElement;
      const link = el.closest('a.internal-link, .embed-title') as HTMLElement | null;
      if (link) {
        e.preventDefault();
        openLinkText(link.dataset.href ?? link.closest<HTMLElement>('.embed-note')?.dataset.href ?? '', this.path, e.metaKey || e.ctrlKey);
        return;
      }
      const ext = el.closest('a.external-link') as HTMLAnchorElement | null;
      if (ext) { e.preventDefault(); request('external', { url: ext.getAttribute('href') }); return; }
      const tag = el.closest('a.tag') as HTMLElement | null;
      if (tag) { e.preventDefault(); emit('open-tag', tag.dataset.tag); return; }
      const copy = el.closest('.copy-code-button') as HTMLElement | null;
      if (copy) {
        navigator.clipboard?.writeText(copy.parentElement?.querySelector('code')?.textContent ?? '');
        copy.innerHTML = CHECK_ICON; copy.classList.add('is-copied');
        setTimeout(() => { copy.innerHTML = COPY_ICON; copy.classList.remove('is-copied'); }, 1200);
        return;
      }
      if (el instanceof HTMLImageElement && el.classList.contains('ordo-img')) { this.openImage(el.dataset.path ?? '', el.src); return; }
      if (el instanceof HTMLInputElement && el.classList.contains('task-list-item-checkbox')) {
        const ln = +(el.dataset.taskLine ?? -1);
        if (ln < 0 || ln >= this.editor.state.doc.lines) return;
        const line = this.editor.state.doc.line(ln + 1);
        const m = /^(\s*(?:[-*+]|\d+[.)])\s+\[)(.)\]/.exec(line.text);
        if (!m) return;
        const at = line.from + m[1].length;
        this.editor.dispatch({ changes: { from: at, to: at + 1, insert: m[2] === ' ' ? 'x' : ' ' } });
      }
    });
  }

  // ---------- images ----------

  openImage(path: string, url: string) {
    openLightbox(url, path ? basename(path) : '', path ? () => this.editImage(path, url) : undefined);
  }

  editImage(path: string, url: string) {
    openImageEditor(path, url, (newPath, copy) => {
      if (copy) {
        const text = this.editor.state.doc.toString();
        const next = text.split(basename(path)).join(basename(newPath));
        if (next !== text) this.editor.dispatch({ changes: { from: 0, to: text.length, insert: next } });
      }
      bumpImage(newPath);
      emit('images-changed');   // every open note showing this picture reloads it
    });
  }

  async insertFiles(files: File[], pos: number) {
    const links: string[] = [];
    for (const f of files) {
      try {
        const data = await blobToBase64(f);
        const res = await request<{ link: string }>('saveAttachment', { data, mime: f.type, name: f.name, notePath: this.path });
        links.push(res.link);
      } catch (err) { notice(t('Datei konnte nicht gespeichert werden: ') + err); }
    }
    if (links.length) this.insertAt(pos, links.join('\n'), true);
  }

  async pickAttachments() {
    const links = await request<string[]>('pickAttachments', { notePath: this.path }).catch(() => [] as string[]);
    if (links?.length) this.insertAt(this.editor.state.selection.main.head, links.join('\n'), true);
  }

  insertAt(pos: number, text: string, ownLine = false) {
    const line = this.editor.state.doc.lineAt(pos);
    let insert = text;
    if (ownLine) {
      if (pos > line.from && line.text.slice(0, pos - line.from).trim()) insert = '\n' + insert;
      insert += '\n';
    }
    this.editor.dispatch({ changes: { from: pos, insert }, selection: { anchor: pos + insert.length }, scrollIntoView: true });
    this.editor.focus();
  }

  insertText(text: string) {
    const sel = this.editor.state.selection.main;
    this.editor.dispatch({ changes: { from: sel.from, to: sel.to, insert: text }, selection: { anchor: sel.from + text.length }, scrollIntoView: true });
    this.editor.focus();
  }

  /** Markdown for Ordo/Obsidian, formatted HTML for Mail, Pages, Word … */
  private fillClipboard(dt: DataTransfer, md: string, sel?: Selection) {
    const div = document.createElement('div');
    if (sel) for (let i = 0; i < sel.rangeCount; i++) div.appendChild(sel.getRangeAt(i).cloneContents());
    else div.innerHTML = render(md, { path: this.path, showProperties: false });
    div.querySelectorAll('button, .copy-code-button, .katex-mathml, table.properties').forEach(el => el.remove());
    dt.setData('text/plain', md);
    dt.setData('text/html', div.innerHTML);
    dt.setData(ORDO_MD, md);
  }

  private onCopy(e: ClipboardEvent, view: EditorView, cut: boolean) {
    const ranges = view.state.selection.ranges.filter(r => !r.empty);
    if (!ranges.length || !e.clipboardData) return false;   // empty selection: CodeMirror copies the whole line
    e.preventDefault();
    this.fillClipboard(e.clipboardData, ranges.map(r => view.state.sliceDoc(r.from, r.to)).join(view.state.lineBreak));
    if (cut) view.dispatch({ changes: ranges, userEvent: 'delete.cut', scrollIntoView: true });
    return true;
  }

  private onPaste(e: ClipboardEvent, view: EditorView) {
    const dt = e.clipboardData;
    if (!dt) return false;
    const files = Array.from(dt.files ?? []);
    const plain = dt.getData('text/plain');
    const html = dt.getData('text/html');
    if (files.length && !plain) {
      e.preventDefault();
      this.insertFiles(files, view.state.selection.main.head);
      return true;
    }
    if (!plain && !html) return false;
    e.preventDefault();
    const text = dt.getData(ORDO_MD) || pasteText(plain, html, inCodeBlock(view.state, view.state.selection.main.head));
    const sel = view.state.selection.main;
    const line = view.state.doc.lineAt(sel.from);
    const before = view.state.sliceDoc(line.from, sel.from);
    const after = view.state.sliceDoc(sel.to, view.state.doc.lineAt(sel.to).to);
    let insert = text;
    if (/^\s*(```|~~~)/.test(insert) && before.trim()) insert = '\n' + insert;
    if (/(```|~~~)\s*$/.test(insert) && after.trim()) insert += '\n';
    if (/^\s*(```|~~~)/.test(after) && !insert.endsWith('\n')) insert += '\n';
    view.dispatch({ changes: { from: sel.from, to: sel.to, insert }, selection: { anchor: sel.from + insert.length }, userEvent: 'input.paste', scrollIntoView: true });
    return true;
  }

  // ---------- page breaks ----------

  private pageTimer: number | undefined;
  schedulePages(now = false) {
    clearTimeout(this.pageTimer);
    this.pageTimer = window.setTimeout(() => this.updatePages(), now ? 50 : 700);
  }

  private async updatePages() {
    if (!appState.showPageBreaks) {
      this.pages = null;
      this.editor.dispatch({ effects: setPageBreaks.of([]) });
      if (this.mode === 'preview' && this.previewEl.classList.contains('ordo-paged')) this.renderPreview();
      this.emitStats();
      return;
    }
    if (this.mode === 'preview') { this.renderPreview(); return; }
    if (this.leaf.ws.activeLeaf !== this.leaf) return;
    const slices = await measurePages(this.editor.state.doc.toString(), this.path);
    this.pages = slices.length;
    this.editor.dispatch({ effects: setPageBreaks.of(slices.slice(1).map((s, i) => ({ line: s.line ?? 0, page: i + 2 }))) });
    this.emitStats();
  }

  // ---------- misc ----------

  scrollToLine(line: number) {
    if (this.mode === 'preview') {
      this.previewEl.querySelector(`[data-line="${line}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      return;
    }
    const l = this.editor.state.doc.line(Math.max(1, Math.min(this.editor.state.doc.lines, line + 1)));
    this.editor.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: 'start', yMargin: 60 }) });
    this.editor.focus();
  }

  emitStats() {
    if (this.leaf.ws?.activeLeaf !== this.leaf) return;
    const st = this.editor.state;
    const sel = st.selection.main;
    const text = sel.empty ? st.doc.toString() : st.sliceDoc(sel.from, sel.to);
    emit('editor-stats', {
      words: countWords(text), chars: text.length, selection: !sel.empty, pages: appState.showPageBreaks ? this.pages : null, path: this.path, mode: this.mode,
    });
  }

  private moreMenu(e: MouseEvent) {
    const m = new Menu();
    m.addItem({ title: this.mode === 'source' ? t('Lesemodus') : t('Bearbeiten'), icon: this.mode === 'source' ? 'book-open' : 'pencil', hotkey: hotkeyLabel('markdown:toggle-preview'), onClick: () => this.toggleMode() });
    m.addItem({ title: t('Seitenumbrüche anzeigen'), icon: 'page-break', checked: appState.showPageBreaks, hotkey: hotkeyLabel('ordo:toggle-page-breaks'), onClick: () => executeCommand('ordo:toggle-page-breaks') });
    m.addSeparator();
    m.addItem({ title: t('Als PDF exportieren …'), icon: 'file-down', onClick: () => executeCommand('ordo:export') });
    m.addItem({ title: t('Umbenennen …'), icon: 'pencil', onClick: () => this.focusTitle() });
    m.addItem({ title: t('Verschieben nach …'), icon: 'folder-input', onClick: () => emit('move-file', this.path) });
    const pinned = vault.notes.get(this.path)?.pinned;
    m.addItem({ title: pinned ? t('Wieder automatisch einsortieren') : t('Hier festpinnen'), icon: pinned ? 'wand' : 'pin', onClick: () => setPinned(this.path, !pinned) });
    m.addSeparator();
    m.addItem({ title: t('In Notiz suchen'), icon: 'search', hotkey: hotkeyLabel('editor:open-search'), onClick: () => this.openSearch() });
    m.addItem({ title: t('Rückverweise'), icon: 'link', onClick: () => workspace.showSidePane('right', 'backlinks') });
    m.addItem({ title: t('Gliederung'), icon: 'outline', onClick: () => workspace.showSidePane('right', 'outline') });
    m.addItem({ title: t('Im Finder zeigen'), icon: 'folder-open', onClick: () => request('reveal', { path: this.path }) });
    m.addItem({ title: t('Pfad kopieren'), icon: 'copy', onClick: () => navigator.clipboard?.writeText(this.path) });
    m.addSeparator();
    m.addItem({ title: t('Notiz löschen'), icon: 'trash', warning: true, onClick: () => emit('trash-file', this.path) });
    m.showAtMouseEvent(e);
  }

  openSearch() { if (this.mode === 'source') openSearchPanel(this.editor); }

  private contextMenu(e: MouseEvent) {
    if (this.mode !== 'source' || !this.sourceEl.contains(e.target as Node)) return;
    e.preventDefault();
    const v = this.editor;
    const sel = v.state.selection.main;
    const m = new Menu();
    m.addItem({ title: t('Ausschneiden'), icon: 'scissors', disabled: sel.empty, onClick: () => { navigator.clipboard?.writeText(v.state.sliceDoc(sel.from, sel.to)); v.dispatch({ changes: { from: sel.from, to: sel.to } }); } });
    m.addItem({ title: t('Kopieren'), icon: 'copy', disabled: sel.empty, onClick: () => navigator.clipboard?.writeText(v.state.sliceDoc(sel.from, sel.to)) });
    m.addItem({ title: t('Einfügen'), icon: 'paste', onClick: async () => { const t = await navigator.clipboard?.readText(); if (t) this.insertText(t); } });
    m.addSeparator();
    m.addItem({ title: t('Formatierung'), icon: 'type', submenu: [
      { title: t('Fett'), icon: 'bold', hotkey: hotkeyLabel('editor:toggle-bold'), onClick: () => format(v, 'bold') },
      { title: t('Kursiv'), icon: 'italic', hotkey: hotkeyLabel('editor:toggle-italics'), onClick: () => format(v, 'italic') },
      { title: t('Durchgestrichen'), icon: 'strikethrough', onClick: () => format(v, 'strike') },
      { title: t('Hervorheben'), icon: 'highlighter', hotkey: hotkeyLabel('editor:toggle-highlight'), onClick: () => format(v, 'highlight') },
      { title: t('Code'), icon: 'code', hotkey: hotkeyLabel('editor:toggle-code'), onClick: () => format(v, 'code') },
      'separator',
      { title: t('Aufgabe'), icon: 'list-checks', hotkey: hotkeyLabel('editor:toggle-checklist-status'), onClick: () => format(v, 'task') },
      { title: t('Aufzählung'), icon: 'list', onClick: () => format(v, 'list') },
      { title: t('Zitat'), icon: 'quote', onClick: () => format(v, 'quote') },
    ] });
    m.addItem({ title: t('Einfügen …'), icon: 'plus', submenu: [
      { title: t('Interner Link'), icon: 'link', hotkey: hotkeyLabel('editor:insert-wikilink'), onClick: () => format(v, 'link') },
      { title: t('Bild / Datei …'), icon: 'image', onClick: () => this.pickAttachments() },
      { title: t('Formel …'), icon: 'sigma', hotkey: hotkeyLabel('ordo:insert-math'), onClick: () => executeCommand('ordo:insert-math') },
      { title: t('Tabelle'), icon: 'table', onClick: () => this.insertAt(v.state.selection.main.head, '| Spalte 1 | Spalte 2 |\n| --- | --- |\n|  |  |', true) },
      { title: t('Codeblock'), icon: 'file-code', onClick: () => this.insertAt(v.state.selection.main.head, '```\n\n```', true) },
      { title: t('Callout'), icon: 'info', onClick: () => this.insertAt(v.state.selection.main.head, '> [!note] Titel\n> Inhalt', true) },
      { title: t('Zwei Spalten'), icon: 'split', onClick: () => this.insertAt(v.state.selection.main.head, `> [!multi-column]\n>\n>> [!blank]\n>> ${t('Linke Spalte')}\n>\n>> [!blank]\n>> ${t('Rechte Spalte')}`, true) },
      { title: t('Seitenumbruch'), icon: 'page-break', onClick: () => this.insertAt(v.state.selection.main.head, '\\pagebreak', true) },
    ] });
    const onImage = (e.target as Element).closest?.('.image-embed');
    const at = onImage ? v.posAtDOM(onImage) : sel.head;
    const row = sideBySideChange(v.state, sel.from, sel.to), stack = stackedChange(v.state, at);
    const unwrap = unwrapColumnsChange(v.state, at);
    const cols = sel.empty ? null : sideBySideBlocksChange(v.state, sel.from, sel.to);
    if (row || stack || unwrap || cols) m.addSeparator();
    if (cols) m.addItem({ title: t('Nebeneinander (Spalten)'), icon: 'split', onClick: () => v.dispatch({ changes: cols }) });
    if (unwrap) m.addItem({ title: t('Spalten auflösen'), icon: 'list', onClick: () => v.dispatch({ changes: unwrap }) });
    if (row) m.addItem({ title: t('Bilder nebeneinander'), icon: 'layers', onClick: () => v.dispatch({ changes: row }) });
    if (stack) m.addItem({ title: t('Bilder untereinander'), icon: 'list', onClick: () => v.dispatch({ changes: stack }) });
    m.addSeparator();
    m.addItem({ title: t('Alles auswählen'), onClick: () => selectAll(v) });
    m.showAtMouseEvent(e);
  }
}

// ---------- helpers shared with commands ----------

export function getActiveMarkdownView(): MarkdownView | null {
  const v = workspace?.activeView;
  return v instanceof MarkdownView ? v : null;
}

export function cursorInTag(state: EditorState) {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  return /(^|[\s(,;])#[\p{L}\p{N}_\-/]+$/u.test(line.text.slice(0, head - line.from));
}

export function countWords(text: string) {
  const m = text.replace(/```[\s\S]*?```/g, ' ').match(/[\p{L}\p{N}][\p{L}\p{N}'’\-_]*/gu);
  return m ? m.length : 0;
}

export async function openLinkText(target: string, from: string, newLeaf: boolean) {
  const [name, heading] = target.split('#');
  if (!name && heading) {
    const v = getActiveMarkdownView();
    const hd = vault.notes.get(from)?.headings.find(x => x.text.toLowerCase() === heading.toLowerCase());
    if (v && hd) v.scrollToLine(hd.line);
    return;
  }
  if (/^[a-z][\w+.-]*:/i.test(name)) { request('external', { url: target }); return; }
  let path = vault.resolve(name, from);
  if (!path) {
    // like Obsidian: following an unresolved link creates the note
    const folder = name.includes('/') ? dirname(name) : vault.settings.newNoteFolder;
    path = await request<string>('create', { folder, title: basename(name) });
  }
  const line = heading ? vault.notes.get(path)?.headings.find(x => x.text.toLowerCase() === heading.toLowerCase())?.line : undefined;
  if (!/\.md$/i.test(path) && IMAGE_EXT.test(path)) { openLightbox(versionedURL(path), basename(path)); return; }
  await workspace.openFile(path, { newLeaf, line });
}

export function announceMove(from: string, to: string) {
  const folder = dirname(to) || t('Hauptordner');
  notice(t('„{name}“ → {folder}', { name: noteName(to), folder }), {
    action: t('Hier lassen'),
    onAction: async () => {
      await request('move', { path: to, folder: dirname(from), manual: true });
      notice(t('Bleibt in {folder} – Automatik für diese Notiz aus.', { folder: dirname(from) || t('Hauptordner') }));
    },
  });
}

export async function setPinned(path: string, pinned: boolean) {
  const res = await request<{ path: string; moved: boolean; from: string }>('setPinned', { path, pinned });
  if (res?.moved) announceMove(res.from, res.path);
  else notice(pinned ? t('Festgepinnt – Hashtags verschieben diese Notiz nicht mehr.') : t('Wird wieder nach Hashtags einsortiert.'));
}

export function format(view: EditorView, kind: string) {
  const wrap = (open: string, close = open) => {
    view.dispatch(view.state.changeByRange(range => {
      const text = view.state.sliceDoc(range.from, range.to);
      const before = view.state.sliceDoc(range.from - open.length, range.from);
      const after = view.state.sliceDoc(range.to, range.to + close.length);
      if (before === open && after === close) {
        return { changes: [{ from: range.from - open.length, to: range.from }, { from: range.to, to: range.to + close.length }], range: EditorSelection.range(range.from - open.length, range.to - open.length) };
      }
      return { changes: { from: range.from, to: range.to, insert: open + text + close }, range: EditorSelection.range(range.from + open.length, range.to + open.length) };
    }));
  };
  const prefix = (p: string, re: RegExp) => {
    const changes: { from: number; to?: number; insert?: string }[] = [];
    const seen = new Set<number>();
    for (const r of view.state.selection.ranges) {
      for (let pos = r.from; pos <= r.to;) {
        const line = view.state.doc.lineAt(pos);
        if (!seen.has(line.number)) {
          seen.add(line.number);
          const m = re.exec(line.text);
          if (m) changes.push({ from: line.from, to: line.from + m[0].length, insert: m[0].startsWith(p) ? '' : p });
          else changes.push({ from: line.from, insert: p });
        }
        pos = line.to + 1;
      }
    }
    view.dispatch({ changes });
  };
  switch (kind) {
    case 'bold': wrap('**'); break;
    case 'italic': wrap('*'); break;
    case 'strike': wrap('~~'); break;
    case 'highlight': wrap('=='); break;
    case 'code': wrap('`'); break;
    case 'math': wrap('$'); break;
    case 'link': wrap('[[', ']]'); break;
    case 'tag': view.dispatch(view.state.replaceSelection('#')); break;
    case 'task': {
      // toggle checkbox state if already a task, otherwise make it one
      const line = view.state.doc.lineAt(view.state.selection.main.head);
      const m = /^(\s*[-*+]\s+\[)(.)\]/.exec(line.text);
      if (m) { const at = line.from + m[1].length; view.dispatch({ changes: { from: at, to: at + 1, insert: m[2] === ' ' ? 'x' : ' ' } }); }
      else prefix('- [ ] ', /^(\s*)([-*+]\s+)?/);
      break;
    }
    case 'list': prefix('- ', /^- /); break;
    case 'quote': prefix('> ', /^> /); break;
    case 'heading': {
      const line = view.state.doc.lineAt(view.state.selection.main.head);
      const m = /^(#{1,6})\s/.exec(line.text);
      const next = !m ? '# ' : m[1].length >= 6 ? '' : '#'.repeat(m[1].length + 1) + ' ';
      view.dispatch({ changes: { from: line.from, to: line.from + (m ? m[0].length : 0), insert: next } });
      break;
    }
    case 'undo': undo(view); break;
    case 'redo': redo(view); break;
  }
  view.focus();
}

// ---------- completions ----------

function wikiCompletion(ctx: CompletionContext) {
  const m = ctx.matchBefore(/!?\[\[[^\[\]\n|]*/);
  if (!m) return null;
  const embed = m.text.startsWith('!');
  const from = m.from + (embed ? 3 : 2);
  const closeAfter = ctx.state.sliceDoc(ctx.pos, ctx.pos + 2) === ']]';
  const idx = getIndex();
  const opt = (label: string, detail: string, type: string) => ({ label, detail, type, apply: closeAfter ? label : label + ']]' });
  const notes = idx.notes.map(n => opt(n.name, dirname(n.path), 'text'));
  const files = idx.files.map(f => opt(basename(f), dirname(f), IMAGE_EXT.test(f) ? 'variable' : 'constant'));
  return { from, options: embed ? [...files, ...notes] : [...notes, ...files], validFor: /^[^\[\]\n|]*$/ };
}

function tagCompletion(ctx: CompletionContext) {
  const m = ctx.matchBefore(/#[\p{L}\p{N}_\-/]*/u);
  if (!m) return null;
  const before = m.from > 0 ? ctx.state.sliceDoc(m.from - 1, m.from) : '';
  if (before && !/[\s(,;]/.test(before)) return null;
  if (m.text.length < 2 && !ctx.explicit) return null;   // the list appears after "#" + 1 letter
  if (inCodeBlock(ctx.state, ctx.pos)) return null;
  const typed = m.text.slice(1).toLowerCase();
  // own matching, ignoring case (the built-in fuzzy matcher ranks #serw above #SEW for "se"):
  // tags starting with the text first, then containing it; within that by use, then the shorter one
  const ranked = vault.sortedTags().map(tag => {
    const l = tag.toLowerCase(), at = l.indexOf(typed);
    return { tag, at, n: vault.tagCounts[tag] ?? 0 };
  }).filter(x => x.at >= 0)
    .sort((a, b) => (a.at === 0 ? 0 : 1) - (b.at === 0 ? 0 : 1) || b.n - a.n || a.tag.length - b.tag.length || a.tag.localeCompare(b.tag, 'de'));
  return {
    from: m.from + 1,
    filter: false,
    options: ranked.slice(0, 50).map((x, i) => ({ label: x.tag, type: 'keyword', detail: String(x.n || ''), boost: 99 - Math.min(i, 198) })),
  };
}

// ---------- page measurement (shared, hidden) ----------

let measure: HTMLElement | null = null;
function measureEl() {
  if (!measure) {
    measure = h('div', { cls: 'print-body markdown-rendered ordo-measure', 'aria-hidden': 'true' });
    document.body.appendChild(measure);
  }
  return measure;
}

export function pageGeom() {
  const p = vault.settings?.page ?? { paper: 'a4', landscape: false, marginMM: 20, fontSize: 11 };
  const sizes: Record<string, [number, number]> = { a4: [595.28, 841.89], a5: [419.53, 595.28], letter: [612, 792] };
  let [w, hgt] = sizes[p.paper] ?? sizes.a4;
  if (p.landscape) [w, hgt] = [hgt, w];
  const m = p.marginMM * 72 / 25.4;
  return { pageW: w, pageH: hgt, mt: m, mr: m, mb: m, ml: m, fontSize: p.fontSize };
}

async function measurePages(text: string, path: string) {
  const el = measureEl();
  const g = pageGeom();
  applyGeomVars(el, g);
  el.innerHTML = render(text, { path, showProperties: false });
  await whenImagesLoaded(el);
  return paginate(el, contentSize(g).h);
}

registerView('markdown', leaf => new MarkdownView(leaf));
