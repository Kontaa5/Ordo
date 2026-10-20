// Workspace layout in Obsidian's DOM structure: ribbon, left/right side docks
// with their own tabs, the root tab group (leaves), status bar.

import { h, icon, iconButton, tooltip, debounce, noteName } from './dom';
import { request, emit, on, isMac, isIOS } from './host';
import { Menu } from './ui/menu';
import { hotkeyLabel, executeCommand } from './commands';

import { t } from './i18n';
export type ViewState =
  | { type: 'markdown'; path: string; mode?: 'source' | 'preview'; line?: number }
  | { type: 'graph' }
  | { type: 'image'; path: string }
  | { type: 'empty' };

export abstract class View {
  containerEl: HTMLElement;
  headerEl: HTMLElement;
  titleEl: HTMLElement;
  actionsEl: HTMLElement;
  contentEl: HTMLElement;
  navBack: HTMLElement;
  navForward: HTMLElement;

  constructor(public leaf: Leaf) {
    this.navBack = iconButton('arrow-left', t('Zurück'), () => leaf.goBack(), 'view-header-nav-button');
    this.navForward = iconButton('arrow-right', t('Vor'), () => leaf.goForward(), 'view-header-nav-button');
    this.titleEl = h('div', { cls: 'view-header-title-container mod-at-start' });
    this.actionsEl = h('div', { cls: 'view-actions' });
    this.headerEl = h('div', { cls: 'view-header' },
      h('div', { cls: 'view-header-left' }, h('div', { cls: 'view-header-nav-buttons' }, this.navBack, this.navForward)),
      this.titleEl, this.actionsEl);
    this.contentEl = h('div', { cls: 'view-content' });
    this.containerEl = h('div', { cls: 'workspace-leaf-content', 'data-type': this.getViewType() }, this.headerEl, this.contentEl);
    this.headerEl.addEventListener('contextmenu', e => {
      if ((e.target as HTMLElement).closest('.view-actions, .view-header-nav-buttons')) return;
      leaf.ws.showLeafMenu(leaf, e);
    });
  }

  abstract getViewType(): string;
  abstract getDisplayText(): string;
  getIcon() { return 'file-text'; }
  getState(): ViewState { return { type: 'empty' }; }
  async setState(_s: ViewState): Promise<void> {}
  onClose() {}
  focus() {}
  addAction(iconName: string, label: string, fn: (e: MouseEvent) => void) {
    const b = iconButton(iconName, label, fn, 'view-action');
    this.actionsEl.prepend(b);
    return b;
  }
  updateNav() {
    this.navBack.classList.toggle('is-disabled', !this.leaf.history.length);
    this.navForward.classList.toggle('is-disabled', !this.leaf.forward.length);
  }
}

type ViewFactory = (leaf: Leaf, state: ViewState) => View;
const factories = new Map<string, ViewFactory>();
export function registerView(type: string, f: ViewFactory) { factories.set(type, f); }

let leafCounter = 0;

export class Leaf {
  id = ++leafCounter;
  view!: View;
  history: ViewState[] = [];
  forward: ViewState[] = [];
  containerEl = h('div', { cls: 'workspace-leaf' });
  tabHeaderEl!: HTMLElement;
  pinned = false;

  constructor(public ws: Workspace) {}

  async setViewState(state: ViewState, push = true) {
    if (this.view) {
      const cur = this.view.getState();
      if (sameState(cur, state)) { if (state.type === 'markdown' && state.line != null) await this.view.setState(state); return; }
      if (push && cur.type !== 'empty') { this.history.push(cur); this.forward = []; }
    }
    if (!this.view || this.view.getViewType() !== state.type) {
      this.view?.onClose();
      this.view = (factories.get(state.type) ?? factories.get('empty')!)(this, state);
      this.containerEl.replaceChildren(this.view.containerEl);
    }
    await this.view.setState(state);
    this.view.updateNav();
    this.ws.updateTabHeader(this);
    this.ws.requestSave();
    emit('leaf-changed', this);
  }

  async goBack() {
    const prev = this.history.pop();
    if (!prev) return;
    this.forward.push(this.view.getState());
    await this.setViewState(prev, false);
  }

  async goForward() {
    const next = this.forward.pop();
    if (!next) return;
    this.history.push(this.view.getState());
    await this.setViewState(next, false);
  }

  getDisplayText() { return this.view?.getDisplayText() ?? t('Neuer Tab'); }
}

function sameState(a: ViewState, b: ViewState) {
  if (a.type !== b.type) return false;
  if ((a.type === 'markdown' || a.type === 'image') && (b.type === 'markdown' || b.type === 'image')) return a.path === b.path;
  return a.type === b.type;
}

export interface SidePane {
  id: string;
  title: string;
  icon: string;
  el: HTMLElement;
  onShow?(): void;
}

class SideDock {
  el: HTMLElement;
  headerInner: HTMLElement;
  container: HTMLElement;
  panes: SidePane[] = [];
  active = '';

  constructor(public side: 'left' | 'right', public ws: Workspace) {
    this.headerInner = h('div', { cls: 'workspace-tab-header-container-inner' });
    const toggle = iconButton(side === 'left' ? 'panel-left' : 'panel-right', side === 'left' ? t('Linke Seitenleiste schließen') : t('Rechte Seitenleiste schließen'),
      () => ws.toggleSide(side), 'sidebar-toggle-button mod-' + side);
    const header = h('div', { cls: 'workspace-tab-header-container titlebar-drag' },
      side === 'right' ? toggle : null, this.headerInner, h('div', { cls: 'workspace-tab-header-spacer titlebar-drag' }), side === 'left' ? toggle : null);
    this.container = h('div', { cls: 'workspace-tab-container' });
    const tabs = h('div', { cls: `workspace-tabs mod-top mod-top-${side}-space` }, header, this.container);
    this.el = h('div', { cls: `workspace-split mod-horizontal mod-sidedock mod-${side}-split` }, tabs);
  }

  add(p: SidePane) {
    this.panes.push(p);
    const tab = h('div', { cls: 'workspace-tab-header clickable-icon', 'aria-label': p.title, 'data-pane': p.id },
      h('div', { cls: 'workspace-tab-header-inner' }, h('div', { cls: 'workspace-tab-header-inner-icon' }, icon(p.icon))));
    tooltip(tab, p.title);
    tab.addEventListener('click', () => this.show(p.id));
    this.headerInner.appendChild(tab);
    const leaf = h('div', { cls: 'workspace-leaf', 'data-pane': p.id }, p.el);
    leaf.style.display = 'none';
    this.container.appendChild(leaf);
    if (!this.active) this.show(p.id);
  }

  show(id: string) {
    this.active = id;
    for (const t of this.headerInner.children) t.classList.toggle('is-active', (t as HTMLElement).dataset.pane === id);
    for (const l of this.container.children) (l as HTMLElement).style.display = (l as HTMLElement).dataset.pane === id ? '' : 'none';
    this.panes.find(p => p.id === id)?.onShow?.();
    this.ws.requestSave();
  }
}

export class Workspace {
  el: HTMLElement;
  leaves: Leaf[] = [];
  activeLeaf: Leaf | null = null;
  left: SideDock;
  right: SideDock;
  leftOpen = true;
  rightOpen = false;
  leftWidth = 260;
  rightWidth = 280;
  ribbon: HTMLElement;
  ribbonActions: HTMLElement;
  rootTabs: HTMLElement;
  tabHeaderInner: HTMLElement;
  tabContainer: HTMLElement;
  statusBar: HTMLElement;
  vaultProfile: HTMLElement;
  rootSplit: HTMLElement;
  private restoring = false;
  readonly isMobile = isIOS && Math.min(screen.width, screen.height) < 700;

  constructor() {
    this.left = new SideDock('left', this);
    this.right = new SideDock('right', this);

    this.ribbonActions = h('div', { cls: 'side-dock-actions' });
    this.ribbon = h('div', { cls: 'workspace-ribbon side-dock-ribbon mod-left' },
      h('div', { cls: 'side-dock-ribbon-top titlebar-drag' }),
      this.ribbonActions,
      h('div', { cls: 'side-dock-settings' }));

    this.vaultProfile = h('div', { cls: 'workspace-sidedock-vault-profile' });
    this.left.el.appendChild(this.vaultProfile);

    this.tabHeaderInner = h('div', { cls: 'workspace-tab-header-container-inner' });
    const newTab = h('div', { cls: 'workspace-tab-header-new-tab' }, iconButton('plus', t('Neuer Tab'), () => executeCommand('workspace:new-tab')));
    const tabList = h('div', { cls: 'workspace-tab-header-tab-list' }, iconButton('chevron-down', t('Alle Tabs'), e => this.showTabList(e)));
    const leftToggle = iconButton('panel-left', t('Linke Seitenleiste öffnen'), () => this.toggleSide('left'), 'sidebar-toggle-button mod-left mod-root');
    const rightToggle = iconButton('panel-right', t('Rechte Seitenleiste öffnen'), () => this.toggleSide('right'), 'sidebar-toggle-button mod-right mod-root');
    const tabHeader = h('div', { cls: 'workspace-tab-header-container titlebar-drag' },
      leftToggle, this.tabHeaderInner, newTab, h('div', { cls: 'workspace-tab-header-spacer titlebar-drag' }), tabList, rightToggle);
    tabHeader.addEventListener('dblclick', e => { if ((e.target as HTMLElement).classList.contains('workspace-tab-header-spacer')) executeCommand('workspace:new-tab'); });
    this.tabContainer = h('div', { cls: 'workspace-tab-container' });
    this.rootTabs = h('div', { cls: 'workspace-tabs mod-top mod-active' }, tabHeader, this.tabContainer);
    this.rootSplit = h('div', { cls: 'workspace-split mod-vertical mod-root' }, this.rootTabs);

    const leftHandle = this.resizer('left');
    const rightHandle = this.resizer('right');
    const workspace = h('div', { cls: 'workspace' }, this.ribbon, this.left.el, leftHandle, this.rootSplit, rightHandle, this.right.el);
    this.statusBar = h('div', { cls: 'status-bar' });
    this.el = h('div', { cls: 'app-container' }, h('div', { cls: 'horizontal-main-container' }, workspace), this.statusBar);

    if (this.isMobile) {
      this.leftOpen = false;
      this.rightOpen = false;
      for (const dock of [this.left, this.right]) {
        dock.el.addEventListener('click', e => {
          if ((e.target as HTMLElement).closest('.nav-file-title, .tree-item-self.is-clickable:not(.nav-folder-title), .search-result-file-match, .search-result-file-title'))
            setTimeout(() => this.closeDrawers(), 50);
        });
      }
      const cover = h('div', { cls: 'workspace-drawer-backdrop', onclick: () => this.closeDrawers() });
      workspace.appendChild(cover);
    }
    this.applySides();
    window.addEventListener('resize', debounce(() => this.reportDragRegions(), 100));
    new ResizeObserver(debounce(() => this.reportDragRegions(), 100)).observe(document.body);
    new MutationObserver(() => this.reportDragRegions()).observe(document.body, { childList: true });
  }

  // ---------- side docks ----------

  private resizer(side: 'left' | 'right') {
    const el = h('hr', { cls: 'workspace-leaf-resize-handle mod-' + side });
    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      const startX = e.clientX, startW = side === 'left' ? this.leftWidth : this.rightWidth;
      document.body.classList.add('is-grabbing');
      const move = (ev: PointerEvent) => {
        const d = side === 'left' ? ev.clientX - startX : startX - ev.clientX;
        const w = Math.max(180, Math.min(window.innerWidth * 0.5, startW + d));
        if (side === 'left') this.leftWidth = w; else this.rightWidth = w;
        this.applySides();
      };
      const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); document.body.classList.remove('is-grabbing'); this.requestSave(); this.reportDragRegions(); };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
    });
    return el;
  }

  toggleSide(side: 'left' | 'right', open?: boolean) {
    if (side === 'left') this.leftOpen = open ?? !this.leftOpen; else this.rightOpen = open ?? !this.rightOpen;
    if (this.isMobile && (side === 'left' ? this.leftOpen : this.rightOpen)) {
      if (side === 'left') this.rightOpen = false; else this.leftOpen = false;
    }
    this.applySides();
    this.requestSave();
    setTimeout(() => this.reportDragRegions(), 260);
  }

  closeDrawers() { if (this.leftOpen || this.rightOpen) { this.leftOpen = false; this.rightOpen = false; this.applySides(); } }

  showSidePane(side: 'left' | 'right', id: string) {
    (side === 'left' ? this.left : this.right).show(id);
    this.toggleSide(side, true);
  }

  private applySides() {
    const ws = this.el.querySelector('.workspace') as HTMLElement | null;
    document.body.classList.toggle('is-left-sidedock-open', this.leftOpen);
    document.body.classList.toggle('is-right-sidedock-open', this.rightOpen);
    ws?.classList.toggle('is-left-sidedock-open', this.leftOpen);
    ws?.classList.toggle('is-right-sidedock-open', this.rightOpen);
    this.left.el.classList.toggle('is-sidedock-collapsed', !this.leftOpen);
    this.right.el.classList.toggle('is-sidedock-collapsed', !this.rightOpen);
    if (!this.isMobile) {
      this.left.el.style.width = this.leftOpen ? this.leftWidth + 'px' : '0px';
      this.right.el.style.width = this.rightOpen ? this.rightWidth + 'px' : '0px';
    }
  }

  // ---------- leaves / tabs ----------

  get activeView(): View | null { return this.activeLeaf?.view ?? null; }

  createLeaf(after?: Leaf): Leaf {
    const leaf = new Leaf(this);
    const idx = after ? this.leaves.indexOf(after) + 1 : this.leaves.length;
    this.leaves.splice(idx, 0, leaf);
    leaf.tabHeaderEl = this.makeTabHeader(leaf);
    const ref = this.tabHeaderInner.children[idx] ?? null;
    this.tabHeaderInner.insertBefore(leaf.tabHeaderEl, ref);
    this.tabContainer.appendChild(leaf.containerEl);
    return leaf;
  }

  private makeTabHeader(leaf: Leaf) {
    const title = h('div', { cls: 'workspace-tab-header-inner-title' });
    const close = h('div', { cls: 'workspace-tab-header-inner-close-button', 'aria-label': t('Schließen') }, icon('x'));
    close.addEventListener('click', e => { e.stopPropagation(); this.closeLeaf(leaf); });
    const el = h('div', { cls: 'workspace-tab-header tappable', draggable: 'true' },
      h('div', { cls: 'workspace-tab-header-inner' },
        h('div', { cls: 'workspace-tab-header-inner-icon' }),
        title,
        h('div', { cls: 'workspace-tab-header-status-container' }),
        close));
    el.addEventListener('mousedown', e => { if (e.button === 1) { e.preventDefault(); this.closeLeaf(leaf); } });
    el.addEventListener('click', () => this.setActiveLeaf(leaf));
    el.addEventListener('contextmenu', e => this.showLeafMenu(leaf, e));
    // reorder by drag
    el.addEventListener('dragstart', e => { e.dataTransfer?.setData('text/ordo-tab', String(leaf.id)); el.classList.add('is-dragging'); });
    el.addEventListener('dragend', () => el.classList.remove('is-dragging'));
    el.addEventListener('dragover', e => { if (e.dataTransfer?.types.includes('text/ordo-tab')) { e.preventDefault(); el.classList.add('is-drop-target'); } });
    el.addEventListener('dragleave', () => el.classList.remove('is-drop-target'));
    el.addEventListener('drop', e => {
      el.classList.remove('is-drop-target');
      const id = Number(e.dataTransfer?.getData('text/ordo-tab'));
      const moving = this.leaves.find(l => l.id === id);
      if (!moving || moving === leaf) return;
      e.preventDefault();
      this.leaves.splice(this.leaves.indexOf(moving), 1);
      this.leaves.splice(this.leaves.indexOf(leaf), 0, moving);
      this.tabHeaderInner.insertBefore(moving.tabHeaderEl, leaf.tabHeaderEl);
      this.requestSave();
    });
    tooltip(el, () => { const s = leaf.view?.getState(); return s && 'path' in s ? s.path : ''; });
    return el;
  }

  /** Right-click menu of a tab (also used for the header bar above a note). */
  showLeafMenu(leaf: Leaf, e: MouseEvent) {
    e.preventDefault();
    const m = new Menu();
    m.addItem({ title: t('Schließen'), icon: 'x', hotkey: hotkeyLabel('workspace:close-tab'), onClick: () => this.closeLeaf(leaf) });
    m.addItem({ title: t('Andere Tabs schließen'), icon: 'x', onClick: () => this.leaves.filter(l => l !== leaf).forEach(l => this.closeLeaf(l)) });
    m.addItem({ title: t('Tabs rechts schließen'), icon: 'arrow-right', onClick: () => this.leaves.slice(this.leaves.indexOf(leaf) + 1).forEach(l => this.closeLeaf(l)) });
    m.addItem({ title: leaf.pinned ? t('Lösen') : t('Anheften'), icon: leaf.pinned ? 'pin-off' : 'pin', onClick: () => { leaf.pinned = !leaf.pinned; this.updateTabHeader(leaf); this.requestSave(); } });
    const st = leaf.view?.getState();
    if (st && 'path' in st && fileMenuProvider) { m.addSeparator(); fileMenuProvider(m, st.path, leaf); }
    m.showAtMouseEvent(e);
  }

  updateTabHeader(leaf: Leaf) {
    const t = leaf.tabHeaderEl;
    if (!t) return;
    (t.querySelector('.workspace-tab-header-inner-title') as HTMLElement).textContent = leaf.getDisplayText();
    const ic = t.querySelector('.workspace-tab-header-inner-icon') as HTMLElement;
    ic.replaceChildren(icon(leaf.view?.getIcon() ?? 'file-text'));
    t.setAttribute('aria-label', leaf.getDisplayText());
    t.dataset.type = leaf.view?.getViewType() ?? 'empty';
    t.classList.toggle('is-pinned', leaf.pinned);
    if (leaf === this.activeLeaf) this.updateWindowTitle();
  }

  setActiveLeaf(leaf: Leaf, focus = true) {
    if (this.activeLeaf === leaf) { if (focus) leaf.view?.focus(); return; }
    const prev = this.activeLeaf;
    this.activeLeaf = leaf;
    for (const l of this.leaves) {
      const active = l === leaf;
      l.containerEl.classList.toggle('mod-active', active);
      l.containerEl.style.display = active ? '' : 'none';
      l.tabHeaderEl.classList.toggle('is-active', active);
      l.tabHeaderEl.classList.toggle('mod-active', active);
    }
    leaf.tabHeaderEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    emit('active-leaf-change', { leaf, prev });
    this.updateWindowTitle();
    if (focus) setTimeout(() => leaf.view?.focus());
    this.requestSave();
  }

  closeLeaf(leaf: Leaf) {
    const idx = this.leaves.indexOf(leaf);
    if (idx < 0) return;
    leaf.view?.onClose();
    leaf.tabHeaderEl.remove();
    leaf.containerEl.remove();
    this.leaves.splice(idx, 1);
    if (this.activeLeaf === leaf) {
      this.activeLeaf = null;
      if (!this.leaves.length) {
        const empty = this.createLeaf();
        empty.setViewState({ type: 'empty' });
        this.setActiveLeaf(empty);
      } else this.setActiveLeaf(this.leaves[Math.min(idx, this.leaves.length - 1)]);
    }
    this.requestSave();
  }

  newTab(state: ViewState = { type: 'empty' }): Leaf {
    const leaf = this.createLeaf(this.activeLeaf ?? undefined);
    leaf.setViewState(state);
    this.setActiveLeaf(leaf);
    return leaf;
  }

  /** Open a file like Obsidian: in the active tab unless it's pinned or a new tab is asked for. */
  async openFile(path: string, opts: { newLeaf?: boolean; mode?: 'source' | 'preview'; line?: number; active?: boolean } = {}) {
    const isNote = /\.md$/i.test(path);
    const state: ViewState = isNote ? { type: 'markdown', path, mode: opts.mode, line: opts.line } : { type: 'image', path };
    const existing = this.leaves.find(l => { const s = l.view?.getState(); return s && 'path' in s && s.path === path; });
    if (existing && !opts.newLeaf) {
      this.setActiveLeaf(existing);
      if (opts.line != null || opts.mode) await existing.setViewState(state, false);
      return existing;
    }
    let leaf = this.activeLeaf;
    if (!leaf || opts.newLeaf || leaf.pinned) leaf = this.createLeaf(leaf ?? undefined);
    await leaf.setViewState(state);
    if (opts.active !== false) this.setActiveLeaf(leaf);
    if (this.isMobile) this.closeDrawers();
    return leaf;
  }

  cycleTabs(dir: 1 | -1) {
    if (!this.activeLeaf || this.leaves.length < 2) return;
    const i = this.leaves.indexOf(this.activeLeaf);
    this.setActiveLeaf(this.leaves[(i + dir + this.leaves.length) % this.leaves.length]);
  }

  private showTabList(e: MouseEvent) {
    const m = new Menu();
    for (const l of this.leaves) m.addItem({ title: l.getDisplayText(), icon: l.view?.getIcon(), checked: l === this.activeLeaf, onClick: () => this.setActiveLeaf(l) });
    m.addSeparator();
    m.addItem({ title: t('Alle schließen'), icon: 'x', onClick: () => [...this.leaves].forEach(l => this.closeLeaf(l)) });
    m.showAtMouseEvent(e);
  }

  updateWindowTitle() {
    const v = this.activeView;
    document.title = v ? `${v.getDisplayText()} – Ordo` : t('Ordo');
  }

  // ---------- persistence ----------

  requestSave = debounce(() => this.save(), 500);

  private save() {
    if (this.restoring) return;
    const tabs = this.leaves.map(l => ({ state: l.view?.getState() ?? { type: 'empty' }, pinned: l.pinned }));
    const data = {
      tabs, active: this.activeLeaf ? this.leaves.indexOf(this.activeLeaf) : 0,
      leftOpen: this.leftOpen, rightOpen: this.rightOpen, leftWidth: this.leftWidth, rightWidth: this.rightWidth,
      leftTab: this.left.active, rightTab: this.right.active, extra: workspaceExtras,
    };
    request('saveWorkspace', { json: JSON.stringify(data) }).catch(() => {});
  }

  async restore(exists: (path: string) => boolean) {
    this.restoring = true;
    let data: any = null;
    try { const raw = await request<string | null>('workspace'); data = raw ? JSON.parse(raw) : null; } catch { /* fresh */ }
    for (const l of [...this.leaves]) { l.view?.onClose(); l.tabHeaderEl.remove(); l.containerEl.remove(); }
    this.leaves = [];
    this.activeLeaf = null;
    if (data) {
      if (!this.isMobile) {
        this.leftOpen = data.leftOpen ?? true; this.rightOpen = data.rightOpen ?? false;
      }
      this.leftWidth = data.leftWidth ?? 260; this.rightWidth = data.rightWidth ?? 280;
      if (data.leftTab) this.left.show(data.leftTab);
      if (data.rightTab) this.right.show(data.rightTab);
      Object.assign(workspaceExtras, data.extra ?? {});
      for (const t of data.tabs ?? []) {
        const st = t.state as ViewState;
        if ((st.type === 'markdown' || st.type === 'image') && !exists(st.path)) continue;
        const leaf = this.createLeaf();
        leaf.pinned = !!t.pinned;
        await leaf.setViewState(st, false);
      }
    }
    if (!this.leaves.length) { const l = this.createLeaf(); await l.setViewState({ type: 'empty' }); }
    this.applySides();
    this.restoring = false;
    this.setActiveLeaf(this.leaves[Math.min(data?.active ?? 0, this.leaves.length - 1)] ?? this.leaves[0], false);
    this.reportDragRegions();
  }

  /** macOS: empty title-bar areas drag the window (it has no native title bar). */
  reportDragRegions() {
    if (!isMac) return;
    const rects: number[][] = [];
    // an overlay (image editor, lightbox, dialog) covers the title bar: its buttons must get every click
    if (document.querySelector('body > .img-editor, body > .lightbox, body > .modal-container')) { request('dragRegions', { rects }).catch(() => {}); return; }
    document.querySelectorAll<HTMLElement>('.titlebar-drag').forEach(el => {
      if (!el.offsetParent && el !== document.body) return;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      // exclude interactive children
      const kids = [...el.querySelectorAll<HTMLElement>('.clickable-icon, .workspace-tab-header, button, input')].map(k => k.getBoundingClientRect());
      if (!kids.length || el.classList.contains('workspace-tab-header-spacer') || el.classList.contains('side-dock-ribbon-top')) { rects.push([r.left, r.top, r.width, r.height]); return; }
      // split the bar into gaps between children
      let x = r.left;
      for (const k of kids.sort((a, b) => a.left - b.left)) {
        if (k.left > x + 2) rects.push([x, r.top, k.left - x, r.height]);
        x = Math.max(x, k.right);
      }
      if (r.right > x + 2) rects.push([x, r.top, r.right - x, r.height]);
    });
    request('dragRegions', { rects }).catch(() => {});
  }
}

/** Small per-device settings stored with the workspace (expanded folders, sort order …). */
export const workspaceExtras: Record<string, any> = {};

/** Adds file actions (export, rename, move …) to tab menus; set by the app. */
export let fileMenuProvider: ((m: Menu, path: string, leaf: Leaf) => void) | null = null;
export function setFileMenuProvider(f: typeof fileMenuProvider) { fileMenuProvider = f; }

export let workspace: Workspace;
export function createWorkspace() { workspace = new Workspace(); return workspace; }

on('renamed', ({ from, to }: { from: string; to: string }) => {
  if (!workspace) return;
  for (const l of workspace.leaves) {
    l.history = l.history.map(s => ('path' in s && s.path === from ? { ...s, path: to } : s));
    l.forward = l.forward.map(s => ('path' in s && s.path === from ? { ...s, path: to } : s));
  }
});

export { noteName };
