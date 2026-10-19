// File explorer in Obsidian's structure (.nav-header, .nav-files-container,
// .tree-item.nav-folder / .nav-file) so themes style it like Obsidian.

import { h, icon, iconButton, tooltip, noteName, dirname, basename, debounce } from '../dom';
import { request, on, emit } from '../host';
import { vault, TreeFolder, SortOrder } from '../store';
import { Menu } from '../ui/menu';
import { notice } from '../ui/notice';
import { confirmDialog } from '../ui/modal';
import { workspace, workspaceExtras, SidePane } from '../workspace';
import { executeCommand, hotkeyLabel } from '../commands';
import { setPinned } from '../views/markdown';
import { FolderSuggestModal } from '../modals/fileModals';

import { t, tn } from '../i18n';
import { TrashModal, trashCount } from '../modals/trash';
const SORT_LABELS: [SortOrder, string][] = [
  ['name-asc', t('Dateiname (A bis Z)')], ['name-desc', t('Dateiname (Z bis A)')],
  ['mtime-desc', t('Bearbeitet (neu → alt)')], ['mtime-asc', t('Bearbeitet (alt → neu)')],
  ['ctime-desc', t('Erstellt (neu → alt)')], ['ctime-asc', t('Erstellt (alt → neu)')],
];

export class FileExplorer implements SidePane {
  id = 'files';
  title = t('Dateien');
  icon = 'files';
  el: HTMLElement;
  private list: HTMLElement;
  private activePath = '';
  private expanded: Set<string>;
  private renaming: string | null = null;

  constructor() {
    this.expanded = new Set(workspaceExtras.expanded ?? []);
    const buttons = h('div', { cls: 'nav-buttons-container' },
      iconButton('square-pen', t('Neue Notiz') + (hotkeyLabel('file:new-note') ? ' (' + hotkeyLabel('file:new-note') + ')' : ''), () => this.newNote(this.currentFolder()), 'nav-action-button'),
      iconButton('folder-plus', t('Neuer Ordner'), () => this.newFolder(this.currentFolder()), 'nav-action-button'),
      iconButton('sort', t('Sortierung ändern'), e => this.sortMenu(e), 'nav-action-button'),
      iconButton('collapse-all', t('Alle einklappen'), () => this.toggleAll(), 'nav-action-button ordo-collapse-all'),
      iconButton('wand', t('Nach Hashtags einsortieren …'), () => executeCommand('ordo:sort-all'), 'nav-action-button'));
    this.list = h('div', { cls: 'nav-files-container node-insert-event' });
    // trash is always reachable at the bottom
    const trashCountEl = h('span', { cls: 'ordo-trash-count' });
    const trashEntry = h('div', { cls: 'ordo-trash-entry', onclick: () => new TrashModal().open() }, icon('trash'), h('span', { text: t('Papierkorb') }), trashCountEl);
    const updateTrash = async () => { const n = await trashCount(); trashCountEl.textContent = n ? String(n) : ''; trashEntry.classList.toggle('is-empty', !n); };
    on('trash-changed', updateTrash); on('vault-opened', updateTrash); on('vault-changed', debounce(updateTrash, 500));
    updateTrash();
    this.el = h('div', { cls: 'workspace-leaf-content', 'data-type': 'file-explorer' },
      h('div', { cls: 'nav-header' }, buttons),
      this.list, trashEntry);

    // drop on empty area = vault root
    this.list.addEventListener('dragover', e => { if (e.dataTransfer?.types.includes('text/ordo-path')) { e.preventDefault(); this.list.classList.add('is-being-dragged-over'); } });
    this.list.addEventListener('dragleave', e => { if (e.target === this.list) this.list.classList.remove('is-being-dragged-over'); });
    this.list.addEventListener('drop', e => { this.list.classList.remove('is-being-dragged-over'); this.dropOn(e, ''); });
    this.list.addEventListener('contextmenu', e => {
      if ((e.target as HTMLElement).closest('.tree-item-self')) return;
      this.folderMenu(e, '');
    });

    on('vault-changed', () => this.render());
    on('file-open', (path: string) => { this.activePath = path; this.reveal(path); this.markActive(); });
    on('reveal-folder', (folder: string) => { this.expandTo(folder + '/x'); this.render(); workspace.showSidePane('left', 'files'); });
    on('active-leaf-change', ({ leaf }: any) => {
      const s = leaf?.view?.getState();
      this.activePath = s && 'path' in s ? s.path : '';
      this.markActive();
    });
  }

  private get order(): SortOrder { return workspaceExtras.sortOrder ?? 'name-asc'; }

  private currentFolder() {
    return this.activePath ? dirname(this.activePath) : '';
  }

  render() {
    const scroll = this.list.scrollTop;
    const tree = vault.tree(this.order);
    const root = h('div', { cls: 'tree-item nav-folder mod-root' });
    const children = h('div', { cls: 'tree-item-children nav-folder-children' });
    this.renderFolder(tree, children, 0);
    root.appendChild(children);
    this.list.replaceChildren(root);
    this.list.scrollTop = scroll;
    const anyOpen = this.expanded.size > 0;
    const btn = this.el.querySelector('.ordo-collapse-all') as HTMLElement | null;
    if (btn) { btn.replaceChildren(icon(anyOpen ? 'collapse-all' : 'expand-all')); btn.setAttribute('aria-label', anyOpen ? t('Alle einklappen') : t('Alle ausklappen')); }
  }

  private renderFolder(folder: TreeFolder, into: HTMLElement, depth: number) {
    for (const f of folder.folders) {
      const open = this.expanded.has(f.path);
      const item = h('div', { cls: 'tree-item nav-folder' + (open ? '' : ' is-collapsed') });
      const collapse = h('div', { cls: 'tree-item-icon collapse-icon nav-folder-collapse-indicator' + (open ? '' : ' is-collapsed') }, icon('chevron-down'));
      const name = h('div', { cls: 'tree-item-inner nav-folder-title-content', text: f.name });
      const self = h('div', { cls: 'tree-item-self nav-folder-title is-clickable mod-collapsible', 'data-path': f.path, draggable: 'true' }, collapse, name);
      const files = f.files.length, sub = f.folders.length;
      tooltip(self, `${tn(files, 'Datei_', 'Dateien_')}, ${tn(sub, 'Ordner1_', 'Ordner_')}`, 'right');
      self.addEventListener('click', () => { this.toggle(f.path); });
      self.addEventListener('contextmenu', e => this.folderMenu(e, f.path));
      this.dragSource(self, f.path);
      this.dropTarget(self, f.path);
      item.appendChild(self);
      if (open) {
        const children = h('div', { cls: 'tree-item-children nav-folder-children' });
        this.renderFolder(f, children, depth + 1);
        item.appendChild(children);
      }
      into.appendChild(item);
    }
    for (const file of folder.files) {
      const meta = file.isNote ? vault.notes.get(file.path) : null;
      const self = h('div', {
        cls: 'tree-item-self nav-file-title tappable is-clickable' + (file.path === this.activePath ? ' is-active' : '') + (meta?.placeholder ? ' is-unresolved' : ''),
        'data-path': file.path, draggable: 'true',
      },
        h('div', { cls: 'tree-item-inner nav-file-title-content', text: file.name.replace(/\.md$/i, '') }),
        !file.isNote ? h('div', { cls: 'nav-file-tag', text: file.ext.toUpperCase() }) : null,
        meta?.pinned ? h('div', { cls: 'nav-file-tag ordo-pin', 'aria-label': t('Festgepinnt') }, icon('pin')) : null,
      );
      if (meta?.placeholder) tooltip(self, t('Wird aus iCloud geladen …'), 'right');
      self.addEventListener('click', e => this.openFile(file.path, e));
      self.addEventListener('auxclick', e => { if (e.button === 1) this.openFile(file.path, e, true); });
      self.addEventListener('contextmenu', e => this.fileMenu(e, file.path));
      this.dragSource(self, file.path);
      into.appendChild(h('div', { cls: 'tree-item nav-file' }, self));
    }
  }

  private openFile(path: string, e: MouseEvent, forceNew = false) {
    if (this.renaming === path) return;
    workspace.openFile(path, { newLeaf: forceNew || e.metaKey || e.ctrlKey });
  }

  private markActive() {
    this.list.querySelectorAll('.nav-file-title').forEach(el => el.classList.toggle('is-active', (el as HTMLElement).dataset.path === this.activePath));
  }

  private toggle(path: string) {
    if (this.expanded.has(path)) this.expanded.delete(path); else this.expanded.add(path);
    this.persist();
    this.render();
  }

  private toggleAll() {
    if (this.expanded.size) this.expanded.clear();
    else vault.folders.forEach(f => this.expanded.add(f));
    this.persist();
    this.render();
  }

  private expandTo(path: string) {
    let f = dirname(path);
    while (f) { this.expanded.add(f); f = dirname(f); }
    this.persist();
  }

  reveal(path: string) {
    const before = this.expanded.size;
    this.expandTo(path);
    if (this.expanded.size !== before) this.render();
    requestAnimationFrame(() => {
      const el = this.list.querySelector(`[data-path="${CSS.escape(path)}"]`);
      el?.scrollIntoView({ block: 'nearest' });
    });
  }

  private persist() {
    workspaceExtras.expanded = [...this.expanded];
    workspace.requestSave();
  }

  // ---------- drag & drop ----------

  private dragSource(el: HTMLElement, path: string) {
    el.addEventListener('dragstart', e => {
      e.dataTransfer!.effectAllowed = 'move';
      e.dataTransfer!.setData('text/ordo-path', path);
      const isNote = /\.md$/i.test(path);
      e.dataTransfer!.setData('text/plain', vault.folders.has(path) ? path : isNote ? `[[${noteName(path)}]]` : `![[${basename(path)}]]`);
      const ghost = h('div', { cls: 'drag-ghost' }, h('div', { cls: 'drag-ghost-self' }, icon(vault.folders.has(path) ? 'folder' : 'file-text'), h('span', { text: vault.folders.has(path) ? basename(path) : noteName(path) })));
      document.body.appendChild(ghost);
      e.dataTransfer!.setDragImage(ghost, 0, 0);
      setTimeout(() => ghost.remove());
      el.classList.add('is-being-dragged');
    });
    el.addEventListener('dragend', () => el.classList.remove('is-being-dragged'));
  }

  private dropTarget(el: HTMLElement, folder: string) {
    let timer: number | undefined;
    el.addEventListener('dragover', e => {
      if (!e.dataTransfer?.types.includes('text/ordo-path')) return;
      e.preventDefault();
      e.stopPropagation();
      el.classList.add('is-being-dragged-over');
      if (!this.expanded.has(folder) && !timer) timer = window.setTimeout(() => { this.expanded.add(folder); this.render(); }, 900);
    });
    el.addEventListener('dragleave', () => { el.classList.remove('is-being-dragged-over'); clearTimeout(timer); timer = undefined; });
    el.addEventListener('drop', e => { e.stopPropagation(); el.classList.remove('is-being-dragged-over'); clearTimeout(timer); this.dropOn(e, folder); });
  }

  private async dropOn(e: DragEvent, folder: string) {
    const path = e.dataTransfer?.getData('text/ordo-path');
    if (!path) return;
    e.preventDefault();
    if (dirname(path) === folder || path === folder || folder.startsWith(path + '/')) return;
    await moveTo(path, folder);
  }

  // ---------- create / rename ----------

  async newNote(folder: string) {
    const path = await request<string>('create', { folder });
    await workspace.openFile(path, { mode: 'source' });
    const v = workspace.activeView as any;
    v?.focusTitle?.();
  }

  async newFolder(parent: string) {
    const path = await request<string>('createFolder', { path: (parent ? parent + '/' : '') + t('Unbenannter Ordner') });
    if (parent) this.expanded.add(parent);
    this.persist();
    setTimeout(() => this.startRename(path), 80);
  }

  startRename(path: string) {
    const self = this.list.querySelector(`[data-path="${CSS.escape(path)}"]`) as HTMLElement | null;
    if (!self) { setTimeout(() => this.startRename(path), 120); return; }
    const inner = self.querySelector('.tree-item-inner') as HTMLElement;
    const original = inner.textContent ?? '';
    this.renaming = path;
    self.classList.add('is-being-renamed');
    inner.contentEditable = 'plaintext-only';
    inner.focus();
    const r = document.createRange(); r.selectNodeContents(inner);
    const sel = getSelection(); sel?.removeAllRanges(); sel?.addRange(r);
    const done = async (commit: boolean) => {
      inner.removeEventListener('keydown', key);
      inner.removeEventListener('blur', blur);
      inner.contentEditable = 'false';
      self.classList.remove('is-being-renamed');
      this.renaming = null;
      const name = (inner.textContent ?? '').trim();
      if (!commit || !name || name === original) { inner.textContent = original; return; }
      try { await request('rename', { path, name }); }
      catch (err) { notice(t('Umbenennen fehlgeschlagen: ') + err); inner.textContent = original; }
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); done(true); }
      else if (e.key === 'Escape') { e.preventDefault(); done(false); }
    };
    const blur = () => done(true);
    inner.addEventListener('keydown', key);
    inner.addEventListener('blur', blur);
  }

  // ---------- menus ----------

  private sortMenu(e: MouseEvent) {
    const m = new Menu();
    for (const [o, label] of SORT_LABELS) m.addItem({ title: label, checked: this.order === o, onClick: () => { workspaceExtras.sortOrder = o; workspace.requestSave(); this.render(); } });
    m.showAtMouseEvent(e);
  }

  private folderMenu(e: MouseEvent, folder: string) {
    e.preventDefault();
    const m = new Menu();
    m.addItem({ title: t('Neue Notiz'), icon: 'square-pen', onClick: () => this.newNote(folder) });
    m.addItem({ title: t('Neuer Ordner'), icon: 'folder-plus', onClick: () => this.newFolder(folder) });
    if (folder) {
      m.addSeparator();
      m.addItem({ title: t('Ordner als PDF exportieren …'), icon: 'file-down', onClick: () => emit('export', { paths: [...vault.notes.keys()].filter(p => p.startsWith(folder + '/')).sort() }) });
      m.addSeparator();
      m.addItem({ title: t('Verschieben nach …'), icon: 'folder-input', onClick: () => new FolderSuggestModal(f => moveTo(folder, f), folder).open() });
      m.addItem({ title: t('Umbenennen …'), icon: 'pencil', onClick: () => this.startRename(folder) });
      m.addItem({ title: t('Im Finder zeigen'), icon: 'folder-open', onClick: () => request('reveal', { path: folder }) });
      m.addItem({ title: t('Pfad kopieren'), icon: 'copy', onClick: () => navigator.clipboard?.writeText(folder) });
      m.addSeparator();
      m.addItem({ title: t('Löschen'), icon: 'trash', warning: true, onClick: () => trashPath(folder) });
    }
    m.showAtMouseEvent(e);
  }

  private fileMenu(e: MouseEvent, path: string) {
    e.preventDefault();
    const isNote = /\.md$/i.test(path);
    const meta = vault.notes.get(path);
    const m = new Menu();
    m.addItem({ title: t('In neuem Tab öffnen'), icon: 'file-plus', onClick: () => workspace.openFile(path, { newLeaf: true }) });
    m.addSeparator();
    if (isNote) {
      m.addItem({ title: meta?.pinned ? t('Wieder nach Hashtags einsortieren') : t('Hier festpinnen'), icon: meta?.pinned ? 'wand' : 'pin', onClick: () => setPinned(path, !meta?.pinned) });
      m.addItem({ title: t('Als PDF exportieren …'), icon: 'file-down', onClick: () => emit('export', { paths: [path] }) });
      m.addSeparator();
    }
    m.addItem({ title: t('Verschieben nach …'), icon: 'folder-input', onClick: () => new FolderSuggestModal(f => moveTo(path, f), path).open() });
    m.addItem({ title: t('Umbenennen …'), icon: 'pencil', onClick: () => this.startRename(path) });
    m.addItem({ title: t('Im Finder zeigen'), icon: 'folder-open', onClick: () => request('reveal', { path }) });
    m.addItem({ title: t('Pfad kopieren'), icon: 'copy', onClick: () => navigator.clipboard?.writeText(path) });
    m.addSeparator();
    m.addItem({ title: t('Löschen'), icon: 'trash', warning: true, onClick: () => trashPath(path) });
    m.showAtMouseEvent(e);
  }

  onShow() { this.render(); }
}

/** Manual moves pin notes: the hashtag automation leaves them where you put them. */
export async function moveTo(path: string, folder: string) {
  try {
    const dest = await request<string>('move', { path, folder, manual: true });
    if (/\.md$/i.test(path)) notice(t('„{name}“ nach {folder} verschoben – bleibt dort.', { name: noteName(dest), folder: folder || t('Hauptordner') }));
  } catch (err) { notice(t('Verschieben fehlgeschlagen: ') + err); }
}

/** Deleting always asks first; everything goes to the trash and can be restored there. */
export async function trashPath(path: string) {
  const isFolder = vault.folders.has(path);
  const name = /\.md$/i.test(path) ? noteName(path) : basename(path);
  const n = isFolder ? [...vault.notes.keys()].filter(p => p.startsWith(path + '/')).length : 0;
  const msg = isFolder ? t('„{name}“ mit {n} Notizen in den Papierkorb verschieben?', { name, n }) : t('„{name}“ in den Papierkorb verschieben?', { name });
  if (!(await confirmDialog(t('Bist du sicher?'), msg + ' ' + t('Du kannst es dort wiederherstellen.'), t('Löschen'), true))) return;
  try { await request('trash', { path }); notice(t('In den Papierkorb verschoben.')); emit('trash-changed'); }
  catch (err) { notice(t('Löschen fehlgeschlagen: ') + err); }
}

on('move-file', (path: string) => new FolderSuggestModal(f => moveTo(path, f), path).open());
on('trash-file', (path: string) => trashPath(path));
