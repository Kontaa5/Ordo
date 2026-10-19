// Ordo web shell: boots the workspace, registers commands & hotkeys, ribbon,
// status bar, vault switcher, vault picker and the mobile layout.

import './ui.css';
import '../shared.css';
import { h, icon, iconButton, tooltip, basename, noteName, dirname } from './dom';
import { request, on, emit, isMac, isIOS } from './host';
import { vault } from './store';
import { addCommand, initHotkeys, executeCommand, hotkeyLabel } from './commands';
import { createWorkspace, workspace, Workspace, setFileMenuProvider } from './workspace';
import { loadAppearance, applyColorScheme, cycleScheme, applyZoom, getZoom, setZoom } from './appearance';
import { appState } from './state';
import { Menu } from './ui/menu';
import { notice } from './ui/notice';
import { FileExplorer } from './panes/fileExplorer';
import { SearchPane, TagsPane, BacklinksPane, OutgoingPane, OutlinePane, AutomationPane } from './panes/sidePanes';
import { QuickSwitcher, CommandPalette, rememberRecent } from './modals/fileModals';
import { SettingsModal } from './modals/settings';
import { ExportModal } from './modals/export';
import { SortAllModal } from './modals/sortAll';
import { CompressImagesModal } from './modals/compressImages';
import { TagSpellingModal } from './modals/tagSpelling';
import { TrashModal } from './modals/trash';
import { gitStatusItem, gitSyncNow, gitPullNow } from './git';
import { MathPalette } from './modals/mathPalette';
import { getActiveMarkdownView, format, MarkdownView } from './views/markdown';
import { sideBySideChange, stackedChange } from './editor/images';
import { sideBySideBlocksChange } from './editor/blockDrag';
import './views/simple';
import { setGraphOption } from './views/graph';
import { isModalOpen } from './ui/modal';
import { post } from '../bridge';

import { t, tn, lang } from './i18n';
interface Boot { platform: 'mac' | 'ios'; isPhone: boolean; vault: { name: string; path: string; importedFromObsidian?: boolean; isObsidianVault?: boolean } | null; recent: { name: string; path: string }[]; obsidianVaults: { name: string; path: string }[]; version: string }

let boot: Boot;
let started = '';
let explorer: FileExplorer;
let searchPane: SearchPane;

// ---------- commands ----------

function editorCmd(id: string, name: string, kind: string, hotkey?: [string[], string], icon?: string) {
  addCommand({
    id, name, icon, hotkeys: hotkey ? [{ modifiers: hotkey[0] as any, key: hotkey[1] }] : [],
    check: () => { const v = getActiveMarkdownView(); return !!v && v.mode === 'source'; },
    callback: () => { const v = getActiveMarkdownView(); if (v) format(v.editor, kind); },
  });
}

function registerCommands() {
  const M = (k: string, ...mods: string[]) => [{ modifiers: ['Mod', ...mods] as any, key: k }];
  addCommand({ id: 'file:new-note', name: t('Neue Notiz erstellen'), icon: 'square-pen', hotkeys: M('N'), ctrlAlias: true, callback: () => newNote() });
  addCommand({ id: 'workspace:new-tab', name: t('Neuer Tab'), icon: 'plus', hotkeys: M('T'), ctrlAlias: true, callback: () => workspace.newTab() });
  addCommand({ id: 'workspace:close-tab', name: t('Aktuellen Tab schließen'), icon: 'x', hotkeys: M('W'), ctrlAlias: true, callback: () => { if (workspace.activeLeaf) workspace.closeLeaf(workspace.activeLeaf); } });
  addCommand({ id: 'workspace:next-tab', name: t('Nächster Tab'), hotkeys: [{ modifiers: ['Ctrl'], key: 'Tab' }], callback: () => workspace.cycleTabs(1) });
  addCommand({ id: 'workspace:previous-tab', name: t('Vorheriger Tab'), hotkeys: [{ modifiers: ['Ctrl', 'Shift'], key: 'Tab' }], callback: () => workspace.cycleTabs(-1) });
  for (let i = 1; i <= 9; i++) addCommand({ id: `workspace:goto-tab-${i}`, name: t('Zu Tab {n} wechseln', { n: i }), hidden: true, hotkeys: M(String(i)), callback: () => { const l = i === 9 ? workspace.leaves[workspace.leaves.length - 1] : workspace.leaves[i - 1]; if (l) workspace.setActiveLeaf(l); } });
  addCommand({ id: 'switcher:open', name: t('Schnellwechsler öffnen'), icon: 'search', hotkeys: M('O'), ctrlAlias: true, callback: () => new QuickSwitcher().open() });
  addCommand({ id: 'command-palette:open', name: t('Befehlspalette öffnen'), icon: 'command', hotkeys: M('P'), ctrlAlias: true, callback: () => new CommandPalette().open() });
  addCommand({ id: 'graph:open', name: t('Graph öffnen'), icon: 'graph', hotkeys: M('G'), ctrlAlias: true, callback: () => { setGraphOption('onlyOrphans', false); openGraph(); } });
  addCommand({ id: 'graph:untagged', name: t('Notizen ohne Hashtag anzeigen'), icon: 'graph', callback: () => { setGraphOption('onlyOrphans', false); setGraphOption('tag', '\u0000none'); setGraphOption('view', 'tag'); openGraph(); } });
  addCommand({ id: 'graph:orphans', name: t('Notizen ohne Verbindungen anzeigen'), icon: 'graph', callback: () => { setGraphOption('onlyOrphans', true); openGraph(); } });
  addCommand({ id: 'search:open', name: t('In allen Dateien suchen'), icon: 'search', hotkeys: M('F', 'Shift'), ctrlAlias: true, callback: () => openSearch() });
  const imgCmd = (fn: (st: any, sel: any) => any) => () => {
    const v = getActiveMarkdownView()?.editor;
    const c = v && fn(v.state, v.state.selection.main);
    if (v && c) v.dispatch({ changes: c }); else notice(t('Markiere mehrere Zeilen mit Bildern bzw. eine Bilderzeile.'));
  };
  addCommand({ id: 'ordo:blocks-side-by-side', name: t('Markierte Absätze nebeneinander (Spalten)'), icon: 'split', check: () => !!getActiveMarkdownView(), callback: () => {
    const v = getActiveMarkdownView()?.editor, c = v && sideBySideBlocksChange(v.state, v.state.selection.main.from, v.state.selection.main.to);
    if (v && c) v.dispatch({ changes: c }); else notice(t('Markiere 2 oder 3 Absätze, die nebeneinander stehen sollen.'));
  } });
  addCommand({ id: 'ordo:images-side-by-side', name: t('Bilder nebeneinander'), icon: 'layers', check: () => !!getActiveMarkdownView(), callback: imgCmd((st, sel) => sideBySideChange(st, sel.from, sel.to)) });
  addCommand({ id: 'ordo:images-stacked', name: t('Bilder untereinander'), icon: 'list', check: () => !!getActiveMarkdownView(), callback: imgCmd((st, sel) => stackedChange(st, sel.head)) });
  addCommand({ id: 'editor:open-search', name: t('In aktueller Datei suchen'), icon: 'search', hotkeys: M('F'), check: () => !!getActiveMarkdownView(), callback: () => getActiveMarkdownView()?.openSearch() });
  addCommand({ id: 'markdown:toggle-preview', name: t('Lese-/Bearbeitungsmodus umschalten'), icon: 'book-open', hotkeys: M('E'), ctrlAlias: true, check: () => !!getActiveMarkdownView(), callback: () => getActiveMarkdownView()?.toggleMode() });
  addCommand({ id: 'app:open-settings', name: t('Einstellungen öffnen'), icon: 'settings', hotkeys: M(','), ctrlAlias: true, callback: () => new SettingsModal().open() });
  addCommand({ id: 'app:open-vault', name: t('Anderen Vault öffnen'), icon: 'vault', callback: () => showVaultPicker() });
  addCommand({ id: 'app:toggle-left-sidebar', name: t('Linke Seitenleiste ein/aus'), icon: 'panel-left', hotkeys: M('\\'), callback: () => workspace.toggleSide('left') });
  addCommand({ id: 'app:toggle-right-sidebar', name: t('Rechte Seitenleiste ein/aus'), icon: 'panel-right', hotkeys: M('\\', 'Shift'), callback: () => workspace.toggleSide('right') });
  addCommand({ id: 'app:go-back', name: t('Zurück'), icon: 'arrow-left', hotkeys: M('ArrowLeft', 'Alt'), callback: () => workspace.activeLeaf?.goBack() });
  addCommand({ id: 'app:go-forward', name: t('Vor'), icon: 'arrow-right', hotkeys: M('ArrowRight', 'Alt'), callback: () => workspace.activeLeaf?.goForward() });
  addCommand({ id: 'file:rename', name: t('Datei umbenennen'), icon: 'pencil', hotkeys: [{ modifiers: [], key: 'F2' }], check: () => !!getActiveMarkdownView(), callback: () => getActiveMarkdownView()?.focusTitle() });
  addCommand({ id: 'file:reveal', name: t('Aktive Datei im Dateibaum zeigen'), icon: 'files', check: () => !!getActiveMarkdownView(), callback: () => { workspace.showSidePane('left', 'files'); explorer.reveal(getActiveMarkdownView()!.path); } });
  addCommand({ id: 'file:move', name: t('Datei verschieben nach …'), icon: 'folder-input', check: () => !!getActiveMarkdownView(), callback: () => emit('move-file', getActiveMarkdownView()!.path) });
  addCommand({ id: 'file:delete', name: t('Aktuelle Datei löschen'), icon: 'trash', check: () => !!getActiveMarkdownView(), callback: () => emit('trash-file', getActiveMarkdownView()!.path) });
  addCommand({ id: 'app:show-backlinks', name: t('Rückverweise anzeigen'), icon: 'link', callback: () => workspace.showSidePane('right', 'backlinks') });
  addCommand({ id: 'app:show-outline', name: t('Gliederung anzeigen'), icon: 'outline', callback: () => workspace.showSidePane('right', 'outline') });
  addCommand({ id: 'app:show-tags', name: t('Tags anzeigen'), icon: 'tags', callback: () => workspace.showSidePane('left', 'tags') });

  editorCmd('editor:toggle-bold', t('Fett'), 'bold', [['Mod'], 'B'], 'bold');
  editorCmd('editor:toggle-italics', t('Kursiv'), 'italic', [['Mod'], 'I'], 'italic');
  editorCmd('editor:toggle-highlight', t('Hervorheben'), 'highlight', [['Mod', 'Shift'], 'H'], 'highlighter');
  editorCmd('editor:toggle-strikethrough', t('Durchgestrichen'), 'strike', [['Mod', 'Shift'], 'X'], 'strikethrough');
  editorCmd('editor:toggle-code', t('Inline-Code'), 'code', [['Mod', 'Shift'], 'C'], 'code');
  editorCmd('editor:toggle-checklist-status', t('Aufgabe umschalten'), 'task', [['Mod'], 'L'], 'list-checks');
  editorCmd('editor:insert-wikilink', t('Internen Link einfügen'), 'link', [['Mod'], 'K'], 'link');
  editorCmd('editor:toggle-bullet-list', t('Aufzählung'), 'list', undefined, 'list');
  editorCmd('editor:toggle-blockquote', t('Zitat'), 'quote', undefined, 'quote');
  editorCmd('editor:cycle-heading', t('Überschrift-Ebene wechseln'), 'heading', [['Mod', 'Shift'], 'T'], 'heading');
  editorCmd('editor:toggle-inline-math', t('Inline-Formel ($…$)'), 'math', undefined, 'sigma');

  addCommand({ id: 'ordo:insert-math', name: t('Formel einfügen …'), icon: 'sigma', hotkeys: M('M', 'Shift'), check: () => getActiveMarkdownView()?.mode === 'source', callback: () => { const v = getActiveMarkdownView(); if (v) new MathPalette(v.editor).open(); } });
  addCommand({ id: 'ordo:insert-attachment', name: t('Bild oder Datei einfügen …'), icon: 'image', hotkeys: M('I', 'Shift'), check: () => getActiveMarkdownView()?.mode === 'source', callback: () => getActiveMarkdownView()?.pickAttachments() });
  addCommand({ id: 'ordo:insert-pagebreak', name: t('Seitenumbruch einfügen'), icon: 'page-break', hotkeys: M('Enter', 'Shift'), check: () => getActiveMarkdownView()?.mode === 'source', callback: () => { const v = getActiveMarkdownView()!; v.insertAt(v.editor.state.selection.main.head, '\\pagebreak', true); } });
  addCommand({ id: 'ordo:toggle-page-breaks', name: t('Seitenumbrüche anzeigen/ausblenden'), icon: 'page-break', hotkeys: M('B', 'Shift'), callback: () => { appState.showPageBreaks = !appState.showPageBreaks; notice(appState.showPageBreaks ? t('Seitenumbrüche sichtbar') : t('Seitenumbrüche ausgeblendet'), { timeout: 1500 }); } });
  addCommand({ id: 'ordo:export', name: t('Als PDF exportieren …'), icon: 'file-down', hotkeys: M('E', 'Shift'), callback: () => { const v = getActiveMarkdownView(); emit('export', v ? { paths: [v.path] } : {}); } });
  addCommand({ id: 'ordo:export-quick', name: t('Als PDF exportieren'), icon: 'file-down', check: () => !!getActiveMarkdownView(), callback: () => quickExport(getActiveMarkdownView()!.path) });
  // ⌘+ / ⌘− / ⌘0: the whole app bigger/smaller (same setting as the zoom slider); German "+" key and US "=" key
  const zoomBy = (d: number) => { const z = d ? Math.round(Math.max(0.6, Math.min(1.6, getZoom() + d)) * 10) / 10 : 1; setZoom(z); notice(t('Zoom {n} %', { n: Math.round(z * 100) })); };
  addCommand({ id: 'app:zoom-in', name: t('Ansicht vergrößern'), icon: 'plus', hotkeys: [...M('+'), ...M('='), ...M('+', 'Shift'), ...M('=', 'Shift')], callback: () => zoomBy(0.1) });
  addCommand({ id: 'app:zoom-out', name: t('Ansicht verkleinern'), hotkeys: M('-'), callback: () => zoomBy(-0.1) });
  addCommand({ id: 'app:zoom-reset', name: t('Ansicht in Originalgröße'), hotkeys: M('0'), callback: () => zoomBy(0) });
  addCommand({ id: 'app:toggle-color-scheme', name: t('Farbschema wechseln'), icon: 'color-scheme', hotkeys: M('D', 'Shift'), ctrlAlias: true, callback: () => {
    const s = cycleScheme();
    notice(t('Farbschema: {mode}', { mode: t(s === 'light' ? 'Hell' : s === 'dark' ? 'Dunkel' : 'Wie System') }), { timeout: 1500 });
  } });
  addCommand({ id: 'ordo:export-tags', name: t('Nach Hashtags als PDF exportieren …'), icon: 'file-down', callback: () => emit('export', {}) });
  for (const p of vault.settings?.exportPresets ?? []) addCommand({ id: 'ordo:preset-' + p.id, name: t('Export-Vorlage: {name}', { name: p.name }), icon: 'file-down', callback: () => emit('export', { preset: p }) });
  addCommand({ id: 'git:sync', name: t('Git: jetzt sichern & hochladen'), icon: 'refresh', check: () => isMac, callback: () => gitSyncNow() });
  addCommand({ id: 'git:pull', name: t('Git: Änderungen holen'), icon: 'download', check: () => isMac, callback: () => gitPullNow() });
  addCommand({ id: 'app:open-trash', name: t('Papierkorb öffnen'), icon: 'trash', callback: () => new TrashModal().open() });
  addCommand({ id: 'ordo:tag-spellings', name: t('Hashtag-Schreibweisen vereinheitlichen …'), icon: 'type', callback: () => new TagSpellingModal().open() });
  addCommand({ id: 'ordo:compress-images', name: t('Große Bilder verkleinern …'), icon: 'image', callback: () => new CompressImagesModal().open() });
  addCommand({ id: 'ordo:sort-all', name: t('Alle Notizen nach Hashtags einsortieren …'), icon: 'wand', callback: () => new SortAllModal().open() });
  addCommand({ id: 'ordo:toggle-pin', name: t('Notiz festpinnen / automatisch einsortieren'), icon: 'pin', check: () => !!getActiveMarkdownView(), callback: () => { const v = getActiveMarkdownView()!; import('./views/markdown').then(m => m.setPinned(v.path, !vault.notes.get(v.path)?.pinned)); } });
}

/** Export right away with the default page settings – only asks where to save. */
async function quickExport(path: string) {
  const n = notice(t('Erzeuge PDF …'), { timeout: 60000 });
  try {
    const ok = await request<boolean>('export', { paths: [path], options: { page: vault.settings.page, toc: false, titles: true, combined: true, name: noteName(path) } });
    n.close();
    if (ok) notice(t('PDF exportiert.'));
  } catch (e) { n.close(); notice(t('Fehler: ') + e); }
}

async function newNote(folder?: string) {
  const path = await request<string>('create', { folder: folder ?? (vault.settings.newNoteFolder || '') });
  const leaf = workspace.activeLeaf;
  const reuse = leaf && leaf.view.getViewType() === 'empty';
  await workspace.openFile(path, { mode: 'source', newLeaf: !reuse && !!leaf && leaf.view.getViewType() !== 'empty' && false });
  setTimeout(() => (workspace.activeView as MarkdownView | null)?.focusTitle?.(), 30);
}

function openGraph() {
  const existing = workspace.leaves.find(l => l.view?.getViewType() === 'graph');
  if (existing) { workspace.setActiveLeaf(existing); return; }
  const leaf = workspace.activeLeaf;
  if (leaf && leaf.view.getViewType() === 'empty') leaf.setViewState({ type: 'graph' });
  else workspace.newTab({ type: 'graph' });
}

function openSearch() {
  workspace.showSidePane('left', 'search');
  const v = getActiveMarkdownView();
  const sel = v ? v.editor.state.sliceDoc(v.editor.state.selection.main.from, v.editor.state.selection.main.to) : '';
  if (sel && !sel.includes('\n')) searchPane.setQuery(sel);
  setTimeout(() => searchPane.input.focus());
}

// ---------- chrome: ribbon, vault profile, status bar ----------

function buildRibbon(ws: Workspace) {
  const add = (iconName: string, label: string, cmd: string) => {
    const b = iconButton(iconName, label + (hotkeyLabel(cmd) ? ` (${hotkeyLabel(cmd)})` : ''), () => executeCommand(cmd), 'side-dock-ribbon-action');
    ws.ribbonActions.appendChild(b);
  };
  add('search', t('Schnellwechsler öffnen'), 'switcher:open');
  add('graph', t('Graph öffnen'), 'graph:open');
  add('file-down', t('Als PDF exportieren'), 'ordo:export-tags');
  add('wand', t('Nach Hashtags einsortieren'), 'ordo:sort-all');
  add('sigma', t('Formel einfügen'), 'ordo:insert-math');
  add('command', t('Befehlspalette öffnen'), 'command-palette:open');
  add('color-scheme', t('Farbschema wechseln'), 'app:toggle-color-scheme');
}

function buildVaultProfile(ws: Workspace) {
  const switcher = h('div', { cls: 'workspace-drawer-vault-switcher' },
    h('div', { cls: 'workspace-drawer-vault-switcher-icon' }, icon('expand-all')),
    h('div', { cls: 'workspace-drawer-vault-name', text: vault.name }));
  switcher.addEventListener('click', e => {
    const m = new Menu();
    for (const r of boot.recent.filter(r => r.path !== vault.path).slice(0, 8)) m.addItem({ title: r.name, icon: 'vault', onClick: () => request('openVault', { path: r.path }) });
    if (boot.recent.length > 1) m.addSeparator();
    m.addItem({ title: t('Vaults verwalten …'), icon: 'settings', onClick: () => showVaultPicker() });
    m.addItem({ title: t('Ordner als Vault öffnen …'), icon: 'folder-open', onClick: () => request('pickVault') });
    m.showAtPosition(switcher.getBoundingClientRect().left, switcher.getBoundingClientRect().top - 8 - 36 * (Math.min(8, boot.recent.length) + 2));
  });
  tooltip(switcher, vault.path, 'top');
  ws.vaultProfile.replaceChildren(switcher,
    h('div', { cls: 'workspace-drawer-vault-actions' },
      iconButton('help', t('Hilfe & Tastenkürzel'), () => showHelp()),
      iconButton('settings', t('Einstellungen') + (hotkeyLabel('app:open-settings') ? ` (${hotkeyLabel('app:open-settings')})` : ''), () => executeCommand('app:open-settings'))));
}

function buildStatusBar(ws: Workspace) {
  const backlinks = h('div', { cls: 'status-bar-item plugin-backlink mod-clickable', onclick: () => workspace.showSidePane('right', 'backlinks') });
  const mode = h('div', { cls: 'status-bar-item plugin-editor-status mod-clickable', onclick: () => executeCommand('markdown:toggle-preview') });
  const pages = h('div', { cls: 'status-bar-item plugin-ordo-pages mod-clickable', onclick: () => executeCommand('ordo:toggle-page-breaks') });
  const words = h('div', { cls: 'status-bar-item plugin-word-count' });
  const sort = h('div', { cls: 'status-bar-item plugin-ordo-sort mod-clickable', onclick: () => workspace.showSidePane('right', 'automation') });
  ws.statusBar.append(gitStatusItem(), sort, backlinks, mode, pages, words);
  tooltip(mode, t('Lesen / Bearbeiten'), 'top');
  on('editor-stats', (s: { words: number; chars: number; selection: boolean; pages: number | null; path: string; mode: string }) => {
    words.replaceChildren(
      h('span', { cls: 'status-bar-item-segment', text: `${s.words.toLocaleString(lang === 'de' ? 'de-AT' : 'en-US')} ${s.words === 1 ? t('Wort') : t('Wörter')}` }),
      h('span', { cls: 'status-bar-item-segment', text: `${s.chars.toLocaleString(lang === 'de' ? 'de-AT' : 'en-US')} ${t('Zeichen')}${s.selection ? t(' markiert') : ''}` }));
    mode.replaceChildren(icon(s.mode === 'source' ? 'pencil' : 'book-open'));
    pages.textContent = s.pages ? `${s.pages} ${s.pages === 1 ? t('Seite') : t('Seiten')}` : '';
    pages.style.display = s.pages ? '' : 'none';
    const n = vault.backlinks(s.path).length;
    backlinks.textContent = `${n} ${n === 1 ? t('Rückverweis') : t('Rückverweise')}`;
    const meta = vault.notes.get(s.path);
    sort.textContent = meta?.pinned ? t('📌 festgepinnt') : '';
    sort.style.display = meta?.pinned ? '' : 'none';
    ws.statusBar.style.display = '';
  });
  on('active-leaf-change', ({ leaf }: any) => {
    const isMd = leaf?.view?.getViewType() === 'markdown';
    ws.statusBar.classList.toggle('ordo-no-file', !isMd);
    if (isMd) (leaf.view as MarkdownView).emitStats();
  });
}

function showHelp() {
  const m = new Menu();
  const keys: [string, string][] = [[t('Neue Notiz'), 'file:new-note'], [t('Neuer Tab'), 'workspace:new-tab'], [t('Schnellwechsler'), 'switcher:open'], [t('Befehlspalette'), 'command-palette:open'], ['Graph', 'graph:open'], [t('Lesen/Bearbeiten'), 'markdown:toggle-preview'], [t('Formel einfügen'), 'ordo:insert-math'], [t('Seitenumbrüche'), 'ordo:toggle-page-breaks'], [t('PDF-Export'), 'ordo:export']];
  for (const [t, c] of keys) m.addItem({ title: t, hotkey: hotkeyLabel(c), onClick: () => executeCommand(c) });
  m.addSeparator();
  m.addItem({ title: t('Alle Tastenkürzel …'), icon: 'keyboard', onClick: () => new SettingsModal('hotkeys').open() });
  const btn = document.querySelector('.workspace-drawer-vault-actions') as HTMLElement;
  const r = btn.getBoundingClientRect();
  m.showAtPosition(r.left, r.top - 380);
}

// ---------- mobile ----------

function buildMobile(ws: Workspace) {
  document.body.classList.add('is-mobile', 'is-phone');
  const nav = h('div', { cls: 'mobile-navbar' },
    h('div', { cls: 'mobile-navbar-actions' },
      iconButton('menu', t('Dateien'), () => ws.toggleSide('left'), 'mobile-navbar-action'),
      iconButton('arrow-left', t('Zurück'), () => ws.activeLeaf?.goBack(), 'mobile-navbar-action'),
      iconButton('square-pen', t('Neue Notiz'), () => executeCommand('file:new-note'), 'mobile-navbar-action mod-cta'),
      iconButton('search', t('Suchen'), () => executeCommand('switcher:open'), 'mobile-navbar-action'),
      iconButton('more', t('Mehr'), e => mobileMenu(e), 'mobile-navbar-action')));
  const toolbar = h('div', { cls: 'mobile-toolbar' });
  const tb = (name: string, label: string, fn: () => void) => toolbar.appendChild(h('button', { cls: 'mobile-toolbar-option', 'aria-label': label, onmousedown: (e: MouseEvent) => { e.preventDefault(); fn(); } }, icon(name)));
  const fmt = (k: string) => () => { const v = getActiveMarkdownView(); if (v) format(v.editor, k); };
  tb('hash', t('Tag'), fmt('tag')); tb('link', t('Link'), fmt('link')); tb('list-checks', t('Aufgabe'), fmt('task')); tb('list', t('Liste'), fmt('list'));
  tb('heading', t('Überschrift'), fmt('heading')); tb('bold', t('Fett'), fmt('bold')); tb('italic', t('Kursiv'), fmt('italic')); tb('highlighter', t('Markieren'), fmt('highlight'));
  tb('sigma', t('Formel'), () => executeCommand('ordo:insert-math')); tb('image', t('Foto'), () => executeCommand('ordo:insert-attachment'));
  tb('undo', t('Rückgängig'), fmt('undo')); tb('redo', t('Wiederholen'), fmt('redo'));
  tb('keyboard', t('Tastatur ausblenden'), () => (document.activeElement as HTMLElement)?.blur());
  document.body.append(nav, toolbar);
  const vv = window.visualViewport;
  const place = () => {
    if (!vv) return;
    const kb = window.innerHeight - vv.height - vv.offsetTop;
    const open = kb > 80;
    document.body.classList.toggle('is-keyboard-open', open);
    toolbar.style.bottom = open ? `${kb}px` : '';
  };
  vv?.addEventListener('resize', place);
  vv?.addEventListener('scroll', place);
}

function mobileMenu(e: MouseEvent) {
  const m = new Menu();
  m.addItem({ title: 'Tabs', icon: 'files', submenu: workspace.leaves.map(l => ({ title: l.getDisplayText(), checked: l === workspace.activeLeaf, onClick: () => workspace.setActiveLeaf(l) })) });
  m.addItem({ title: 'Graph', icon: 'graph', onClick: () => executeCommand('graph:open') });
  m.addItem({ title: t('Rückverweise & Gliederung'), icon: 'panel-right', onClick: () => workspace.toggleSide('right', true) });
  m.addItem({ title: t('Lesen / Bearbeiten'), icon: 'book-open', onClick: () => executeCommand('markdown:toggle-preview') });
  m.addItem({ title: t('Als PDF exportieren …'), icon: 'file-down', onClick: () => executeCommand('ordo:export') });
  m.addItem({ title: t('Einstellungen'), icon: 'settings', onClick: () => executeCommand('app:open-settings') });
  m.addItem({ title: t('Tab schließen'), icon: 'x', onClick: () => executeCommand('workspace:close-tab') });
  m.showAtMouseEvent(e);
}

// ---------- vault picker (no vault open) ----------

function showVaultPicker() {
  const close = () => wrap.remove();
  const list = h('div', { cls: 'recent-vaults-list' });
  const renderList = () => {
    list.replaceChildren(...boot.recent.map(r => {
      const item = h('div', { cls: 'recent-vaults-list-item' + (r.path === vault.path ? ' is-active' : '') },
        h('div', { cls: 'recent-vaults-list-item-name', text: r.name }),
        h('div', { cls: 'recent-vaults-list-item-path', text: prettyPath(r.path) }));
      item.addEventListener('click', () => { if (r.path === vault.path && started) close(); else request('openVault', { path: r.path }); });
      item.addEventListener('contextmenu', e => {
        const m = new Menu();
        m.addItem({ title: t('Aus Liste entfernen'), icon: 'x', onClick: async () => { boot = { ...boot, ...(await request<Boot>('forgetVault', { path: r.path })) }; renderList(); } });
        m.showAtMouseEvent(e);
      });
      return item;
    }));
  };
  renderList();
  const obsidian = boot.obsidianVaults.filter(o => !boot.recent.some(r => r.path === o.path));
  const wrap = h('div', { cls: 'ordo-vault-picker' + (started ? ' mod-overlay' : '') },
    h('div', { cls: 'ordo-vault-picker-inner' },
      h('div', { cls: 'ordo-vault-picker-left' }, h('div', { cls: 'titlebar-drag ordo-picker-drag' }), list),
      h('div', { cls: 'ordo-vault-picker-right' },
        started ? h('div', { cls: 'modal-close-button', onclick: close }, icon('x')) : null,
        h('div', { cls: 'ordo-logo' }, h('div', { cls: 'ordo-logo-mark' }, icon('hash', 40)), h('div', { cls: 'ordo-logo-name', text: t('Ordo') }), h('div', { cls: 'ordo-logo-version', text: t('Version ') + boot.version })),
        h('div', { cls: 'ordo-vault-actions' },
          setting(t('Ordner als Vault öffnen'), isIOS ? t('Wähle in „Dateien“ einen Ordner in iCloud Drive – z. B. den Obsidian-Ordner. So siehst du dieselben Notizen am Mac und am iPhone.') : t('Ein Vault ist ein normaler Ordner mit Markdown-Dateien. Liegt er in iCloud Drive, ist er auf allen Geräten gleich.'),
            h('button', { cls: 'mod-cta', text: t('Öffnen'), onclick: () => request('pickVault') })),
          ...obsidian.map(o => setting(`Obsidian-Vault „${o.name}“`, prettyPath(o.path) + t(' – parallel zu Obsidian nutzbar.'), h('button', { text: t('Öffnen'), onclick: () => request('openVault', { path: o.path }) })))))));
  document.body.appendChild(wrap);
  workspace?.reportDragRegions();
}

function setting(name: string, desc: string, ...ctl: HTMLElement[]) {
  return h('div', { cls: 'setting-item' }, h('div', { cls: 'setting-item-info' }, h('div', { cls: 'setting-item-name', text: name }), h('div', { cls: 'setting-item-description', text: desc })), h('div', { cls: 'setting-item-control' }, ...ctl));
}

function prettyPath(p: string) {
  return p.replace(/^\/Users\/[^/]+/, '~').replace('/Library/Mobile Documents/com~apple~CloudDocs', '/iCloud Drive').replace('/Library/Mobile Documents/iCloud~md~obsidian/Documents', '/iCloud Drive/Obsidian');
}

// ---------- start ----------

async function start(info: NonNullable<Boot['vault']>) {
  if (started === info.path) {
    // same vault again (e.g. after the initial scan finished): just refresh data
    vault.setIndex(await request('index'));
    return;
  }
  if (started) { location.reload(); return; }
  started = info.path;
  document.querySelector('.ordo-vault-picker')?.remove();
  vault.name = info.name;
  vault.path = info.path;
  vault.open = true;
  await vault.loadSettings();
  await loadAppearance();
  registerCommands();
  const ws = createWorkspace();
  document.body.appendChild(ws.el);

  explorer = new FileExplorer();
  searchPane = new SearchPane();
  ws.left.add(explorer);
  ws.left.add(searchPane);
  ws.left.add(new TagsPane());
  ws.right.add(new BacklinksPane());
  ws.right.add(new OutgoingPane());
  ws.right.add(new OutlinePane());
  ws.right.add(new AutomationPane());
  buildRibbon(ws);
  buildVaultProfile(ws);
  buildStatusBar(ws);
  if (ws.isMobile) buildMobile(ws);

  vault.setIndex(await request('index'));
  explorer.render();
  await ws.restore(p => vault.exists(p));
  if (info.importedFromObsidian) notice(t('Obsidian-Vault erkannt: Einstellungen und Darstellung übernommen. Obsidian kann parallel weiterlaufen.'), { timeout: 8000 });
}

on('vault-opened', (info: Boot['vault']) => { if (info) start(info); });
on('vault-closed', async (b: Boot) => { boot = b; if (started) location.reload(); else showVaultPicker(); });
on('show-vault-picker', () => showVaultPicker());
on('export', (opts: any) => new ExportModal(opts).open());
on('open-settings', (tab: string) => new SettingsModal(tab).open());
on('compress-image', (path: string) => new CompressImagesModal([path]).open());
on('file-open', (path: string) => rememberRecent(path));
on('settings-changed', () => { if (started) for (const p of vault.settings?.exportPresets ?? []) addCommand({ id: 'ordo:preset-' + p.id, name: t('Export-Vorlage: {name}', { name: p.name }), icon: 'file-down', callback: () => emit('export', { preset: p }) }); });

// open links with ⌘ etc. never navigate the shell
document.addEventListener('click', e => {
  const a = (e.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
  if (a && /^https?:/.test(a.href)) { e.preventDefault(); request('external', { url: a.href }); }
});
// keep drag regions current after layout changes
document.addEventListener('transitionend', () => workspace?.reportDragRegions());
window.addEventListener('blur', () => getActiveMarkdownView()?.flush());

window.addEventListener('error', e => post({ type: 'log', message: `${e.message} @ ${e.filename}:${e.lineno}:${e.colno}` }));
window.addEventListener('unhandledrejection', e => post({ type: 'log', message: 'Promise: ' + (e.reason?.stack ?? e.reason) }));

(async () => {
  post({ type: 'ready' });
  document.body.classList.add(isMac ? 'mod-macos' : isIOS ? 'mod-ios' : 'mod-windows', 'is-frameless', 'is-hidden-frameless', 'obsidian-app', 'show-inline-title', 'show-view-header');
  applyColorScheme();
  initHotkeys();
  boot = await request<Boot>('boot');
  request('setLanguage', { lang }).catch(() => {});
  applyZoom();
  setFileMenuProvider((m, path) => {
    if (!/\.md$/i.test(path)) {
      m.addItem({ title: t('Im Finder zeigen'), icon: 'folder-open', onClick: () => request('reveal', { path }) });
      m.addItem({ title: t('Pfad kopieren'), icon: 'copy', onClick: () => navigator.clipboard?.writeText(path) });
      return;
    }
    m.addItem({ title: t('Als PDF exportieren'), icon: 'file-down', onClick: () => quickExport(path) });
    m.addItem({ title: t('PDF-Export …'), icon: 'sliders', onClick: () => emit('export', { paths: [path] }) });
    m.addSeparator();
    m.addItem({ title: t('Umbenennen …'), icon: 'pencil', onClick: () => {
      const v = workspace.leaves.find(l => (l.view as any)?.path === path)?.view as MarkdownView | undefined;
      if (v) { workspace.setActiveLeaf(v.leaf); setTimeout(() => v.focusTitle(), 30); }
    } });
    m.addItem({ title: t('Verschieben nach …'), icon: 'folder-input', onClick: () => emit('move-file', path) });
    m.addItem({ title: t('Im Finder zeigen'), icon: 'folder-open', onClick: () => request('reveal', { path }) });
    m.addItem({ title: t('Pfad kopieren'), icon: 'copy', onClick: () => navigator.clipboard?.writeText(path) });
  });
  if (boot.isPhone) document.body.classList.add('is-phone');
  if (boot.vault) await start(boot.vault);
  else showVaultPicker();
  (window as any).ordo.debug = { workspace: () => workspace, vault, request, executeCommand, getActiveMarkdownView, isModalOpen, appearance: () => import('./appearance') };
})();
