// Search, tags, backlinks, outgoing links, outline and the folder-automation
// pane – in Obsidian's markup (.search-result, .tag-pane-tag, .tree-item …).

import { h, icon, iconButton, debounce, noteName, dirname, tooltip } from '../dom';
import { request, on, emit } from '../host';
import { vault } from '../store';
import { workspace, SidePane } from '../workspace';
import { Menu } from '../ui/menu';
import { getActiveMarkdownView, setPinned } from '../views/markdown';
import { TagSpellingModal, applyTagSpellings } from '../modals/tagSpelling';
import { TagRuleModal } from '../modals/tagRule';

import { t, tn } from '../i18n';
import { notice } from '../ui/notice';
// ---------- search ----------

interface SearchHit { path: string; matches: { line: number; text: string; ranges: number[][] }[] }

export class SearchPane implements SidePane {
  id = 'search'; title = t('Suche'); icon = 'search';
  el: HTMLElement;
  input = h('input', { type: 'search', placeholder: t('Suchen …'), spellcheck: 'false', enterkeyhint: 'search' });
  private results = h('div', { cls: 'search-results-children' });
  private info = h('div', { cls: 'search-results-info' });
  private caseSensitive = false;
  private collapsed = false;
  private seq = 0;
  private lastHits: SearchHit[] = [];

  constructor() {
    // own clear button: the built-in one sat under the Aa button and couldn't be clicked
    const clearBtn = iconButton('x', t('Suche leeren'), () => { this.input.value = ''; this.run(); this.input.focus(); }, 'search-input-clear-button');
    const exportBtn = iconButton('file-down', t('Treffer als PDF exportieren …'), () => this.exportHits(), 'search-result-export');
    const caseBtn = iconButton('type', t('Groß-/Kleinschreibung beachten'), () => { this.caseSensitive = !this.caseSensitive; caseBtn.classList.toggle('is-active', this.caseSensitive); this.run(); }, 'input-right-decorator');
    const help = h('div', { cls: 'search-help', text: t('Tipps: tag:#4klasse  path:Schule  file:Mathe  "genauer Satz"') });
    this.el = h('div', { cls: 'workspace-leaf-content', 'data-type': 'search' },
      h('div', { cls: 'search-row' }, h('div', { cls: 'search-input-container' }, this.input, clearBtn, caseBtn)),
      help,
      h('div', { cls: 'search-result-container mod-global-search' },
        h('div', { cls: 'search-results-info-row' }, this.info, exportBtn,
          iconButton('collapse-all', t('Treffer einklappen'), () => { this.collapsed = !this.collapsed; this.el.classList.toggle('ordo-collapsed-results', this.collapsed); }, 'search-result-collapse')),
        this.results));
    this.input.addEventListener('input', debounce(() => this.run(), 200));
    this.input.addEventListener('keydown', e => {
      if (e.key === 'Enter') this.run();
      if (e.key === 'Escape' && this.input.value) { e.preventDefault(); e.stopPropagation(); this.input.value = ''; this.run(); }
    });
    on('open-tag', (tag: string) => { this.setQuery(`tag:#${tag}`); workspace.showSidePane('left', 'search'); });
  }

  setQuery(q: string) { this.input.value = q; this.run(); }

  /** Export what was found: a pure "tag:#x tag:#y" search opens the export with those hashtags (presets work), anything else with the files. */
  private exportHits() {
    if (!this.lastHits.length) return;
    const q = this.input.value.trim();
    const tags = /^(tag:#?[\p{L}\p{N}_\-/]+\s*)+$/u.test(q) ? [...q.matchAll(/tag:#?([\p{L}\p{N}_\-/]+)/gu)].map(m => m[1]) : [];
    if (tags.length) emit('export', { tags });
    else emit('export', { paths: this.lastHits.map(x => x.path) });
  }
  onShow() { setTimeout(() => this.input.focus()); }

  async run() {
    const q = this.input.value.trim();
    const seq = ++this.seq;
    this.el.classList.toggle('has-query', !!q);
    if (!q) { this.lastHits = []; this.el.classList.remove('has-hits'); this.results.replaceChildren(); this.info.textContent = ''; return; }
    const hits = await request<SearchHit[]>('search', { query: q, caseSensitive: this.caseSensitive }).catch(() => [] as SearchHit[]);
    if (seq !== this.seq) return;
    this.lastHits = hits;
    this.el.classList.toggle('has-hits', hits.length > 0);
    const total = hits.reduce((s, x) => s + x.matches.length, 0);
    this.info.textContent = total ? t('{n} Dateien · {m} Treffer', { n: hits.length, m: total }) : (hits.length === 1 ? t('1 Datei') : t('{n} Dateien', { n: hits.length }));
    this.results.replaceChildren(...hits.map(hit => this.renderHit(hit)));
  }

  private renderHit(hit: SearchHit) {
    const item = h('div', { cls: 'tree-item search-result' });
    const title = h('div', { cls: 'tree-item-self search-result-file-title is-clickable' },
      h('div', { cls: 'tree-item-icon collapse-icon' }, icon('chevron-down')),
      h('div', { cls: 'tree-item-inner', text: noteName(hit.path) }),
      h('div', { cls: 'tree-item-flair-outer' }, h('span', { cls: 'tree-item-flair', text: hit.matches.length ? String(hit.matches.length) : '' })));
    tooltip(title, hit.path, 'right');
    title.addEventListener('click', e => {
      if ((e.target as HTMLElement).closest('.collapse-icon')) { item.classList.toggle('is-collapsed'); return; }
      workspace.openFile(hit.path, { newLeaf: e.metaKey || e.ctrlKey });
    });
    const matches = h('div', { cls: 'search-result-file-matches' });
    for (const m of hit.matches) {
      const el = h('div', { cls: 'search-result-file-match tappable' });
      let last = 0;
      const text = m.text;
      const ranges = [...m.ranges].sort((a, b) => a[0] - b[0]);
      const start = Math.max(0, (ranges[0]?.[0] ?? 0) - 60);
      if (start > 0) el.append('…');
      last = start;
      for (const [a, b] of ranges) {
        if (a < last) continue;
        el.append(text.slice(last, a), h('span', { cls: 'search-result-file-matched-text', text: text.slice(a, b) }));
        last = b;
      }
      el.append(text.slice(last, last + 160));
      el.addEventListener('click', e => workspace.openFile(hit.path, { newLeaf: e.metaKey || e.ctrlKey, line: m.line }));
      matches.appendChild(el);
    }
    item.append(title, matches);
    return item;
  }
}

// ---------- tags ----------

interface TagNode { name: string; full: string; count: number; children: Map<string, TagNode> }

export class TagsPane implements SidePane {
  id = 'tags'; title = t('Tags'); icon = 'tags';
  el: HTMLElement;
  private container = h('div', { cls: 'tag-container' });
  private sortByCount = false;
  private open = new Set<string>();

  constructor() {
    this.el = h('div', { cls: 'workspace-leaf-content', 'data-type': 'tag' },
      h('div', { cls: 'nav-header' }, h('div', { cls: 'nav-buttons-container' },
        iconButton('sort', t('Sortierung'), () => { this.sortByCount = !this.sortByCount; this.render(); }, 'nav-action-button'),
        iconButton('folder-tree', t('Hashtags → Ordner einstellen'), () => new TagRuleModal('').open(), 'nav-action-button'))),
      this.container);
    on('vault-changed', () => this.render());
    on('settings-changed', () => this.render());
  }

  onShow() { this.render(); }

  render() {
    const root: TagNode = { name: '', full: '', count: 0, children: new Map() };
    for (const [tag, count] of Object.entries(vault.tagCounts)) {
      let node = root;
      let full = '';
      for (const part of tag.split('/')) {
        full = full ? full + '/' + part : part;
        if (!node.children.has(part.toLowerCase())) node.children.set(part.toLowerCase(), { name: part, full, count: 0, children: new Map() });
        node = node.children.get(part.toLowerCase())!;
      }
      node.count += count;
    }
    const sum = (n: TagNode): number => n.count + [...n.children.values()].reduce((s, c) => s + sum(c), 0);
    const renderNode = (n: TagNode, depth: number): HTMLElement => {
      const kids = [...n.children.values()].sort((a, b) => this.sortByCount ? sum(b) - sum(a) : a.name.localeCompare(b.name, 'de'));
      const isOpen = this.open.has(n.full);
      const rule = vault.settings?.tagRules?.[n.full.toLowerCase()];
      const isFolder = rule ? rule.mode !== 'ignore' : vault.settings?.allTagsAreFolders !== false;
      const self = h('div', { cls: 'tree-item-self tag-pane-tag is-clickable' + (kids.length ? ' mod-collapsible' : '') },
        kids.length ? h('div', { cls: 'tree-item-icon collapse-icon' + (isOpen ? '' : ' is-collapsed') }, icon('chevron-down')) : null,
        h('div', { cls: 'tree-item-inner' }, h('span', { cls: 'tree-item-inner-text', text: '#' + n.name })),
        isFolder ? h('span', { cls: 'ordo-tag-folder', 'aria-label': rule?.folder ? t('Ordner: ') + rule.folder : t('wird Ordner') }, icon('folder'), rule?.folder ? h('span', { text: rule.folder }) : null) : null,
        h('div', { cls: 'tree-item-flair-outer' }, h('span', { cls: 'tree-item-flair tag-pane-tag-count', text: String(sum(n)) })));
      self.addEventListener('click', e => {
        if ((e.target as HTMLElement).closest('.collapse-icon')) { isOpen ? this.open.delete(n.full) : this.open.add(n.full); this.render(); return; }
        emit('open-tag', n.full);
      });
      self.addEventListener('contextmenu', e => {
        const m = new Menu();
        m.addItem({ title: t('Notizen suchen'), icon: 'search', onClick: () => emit('open-tag', n.full) });
        m.addItem({ title: t('Alle mit #{tag} exportieren …', { tag: n.full }), icon: 'file-down', onClick: () => emit('export', { tags: [n.full] }) });
        // several spellings in use (#sew, #SEW): pick the one for all notes
        const variants = [...(vault.tagVariants.get(n.full.toLowerCase())?.keys() ?? [])];
        if (variants.length > 1) {
          m.addSeparator();
          m.addItem({ title: t('Schreibweise'), icon: 'type', submenu: variants.map(v => ({
            title: '#' + v + (v === n.full ? '  ✓' : ''),
            onClick: async () => {
              await vault.saveSettings({ tagSpellings: { ...(vault.settings.tagSpellings ?? {}), [n.full.toLowerCase()]: v } });
              const k = await applyTagSpellings(new Map([[n.full.toLowerCase(), v]]));
              notice(tn(k, 'Notiz angepasst.', 'Notizen angepasst.'));
            },
          })) });
        }
        m.addSeparator();
        m.addItem({ title: t('Ordner-Einstellung …'), icon: 'folder-tree', onClick: () => new TagRuleModal(n.full).open() });
        m.addItem({
          title: isFolder ? t('Kein Ordner') : t('Als Ordner verwenden'), icon: isFolder ? 'x' : 'folder',
          onClick: () => vault.saveSettings({ tagRules: { ...vault.settings.tagRules, [n.full.toLowerCase()]: { mode: isFolder ? 'ignore' : 'folderAndSubfolder', folder: rule?.folder ?? '' } } }),
        });
        m.showAtMouseEvent(e);
      });
      const item = h('div', { cls: 'tree-item' + (isOpen ? '' : ' is-collapsed') }, self);
      if (kids.length && isOpen) item.appendChild(h('div', { cls: 'tree-item-children' }, ...kids.map(k => renderNode(k, depth + 1))));
      return item;
    };
    const tops = [...root.children.values()].sort((a, b) => this.sortByCount ? sum(b) - sum(a) : a.name.localeCompare(b.name, 'de'));
    const conflicts = vault.spellingConflicts();
    const banner = conflicts.length ? h('div', { cls: 'ordo-tag-hint', onclick: () => new TagSpellingModal().open() },
      icon('type'), h('span', { text: tn(conflicts.length, 'Hashtag in mehreren Schreibweisen', 'Hashtags in mehreren Schreibweisen') }), h('span', { cls: 'ordo-tag-hint-action', text: t('Vereinheitlichen') })) : null;
    this.container.replaceChildren(...(banner ? [banner] : []), ...(tops.length ? tops.map(t => renderNode(t, 0)) : [h('div', { cls: 'pane-empty', text: t('Noch keine Tags.') })]));
  }
}

// ---------- right side: backlinks / outgoing / outline / automation ----------

function currentPath() { return getActiveMarkdownView()?.path ?? ''; }

export class BacklinksPane implements SidePane {
  id = 'backlinks'; title = t('Rückverweise'); icon = 'link';
  el = h('div', { cls: 'workspace-leaf-content', 'data-type': 'backlink' });
  private seq = 0;
  constructor() {
    const re = debounce(() => this.render(), 150);
    on('file-open', re); on('vault-changed', re); on('active-leaf-change', re);
  }
  onShow() { this.render(); }
  async render() {
    const path = currentPath();
    const seq = ++this.seq;
    if (!path) { this.el.replaceChildren(h('div', { cls: 'pane-empty', text: t('Keine Notiz aktiv.') })); return; }
    const links = vault.backlinks(path);
    const list = h('div', { cls: 'search-results-children' });
    const name = noteName(path);
    for (const b of links) {
      const text = await request<string>('read', { path: b.path }).catch(() => '');
      if (seq !== this.seq) return;
      const lines = text.split('\n').map((l, i) => ({ l, i })).filter(({ l }) => l.toLowerCase().includes(name.toLowerCase()) || l.includes(path)).slice(0, 5);
      const item = h('div', { cls: 'tree-item search-result' },
        h('div', { cls: 'tree-item-self search-result-file-title is-clickable', onclick: (e: MouseEvent) => workspace.openFile(b.path, { newLeaf: e.metaKey || e.ctrlKey }) },
          h('div', { cls: 'tree-item-inner', text: noteName(b.path) }),
          h('div', { cls: 'tree-item-flair-outer' }, h('span', { cls: 'tree-item-flair', text: String(b.count) }))),
        h('div', { cls: 'search-result-file-matches' }, ...lines.map(({ l, i }) => {
          const el = h('div', { cls: 'search-result-file-match tappable' });
          const idx = l.toLowerCase().indexOf(name.toLowerCase());
          if (idx >= 0) el.append(l.slice(Math.max(0, idx - 60), idx), h('span', { cls: 'search-result-file-matched-text', text: l.slice(idx, idx + name.length) }), l.slice(idx + name.length, idx + name.length + 100));
          else el.append(l.slice(0, 160));
          el.addEventListener('click', () => workspace.openFile(b.path, { line: i }));
          return el;
        })));
      list.appendChild(item);
    }
    if (seq !== this.seq) return;
    this.el.replaceChildren(
      h('div', { cls: 'backlink-pane' },
        h('div', { cls: 'tree-item-self is-clickable' }, h('div', { cls: 'tree-item-inner', text: t('Verlinkte Erwähnungen') }), h('div', { cls: 'tree-item-flair-outer' }, h('span', { cls: 'tree-item-flair', text: String(links.length) }))),
        links.length ? list : h('div', { cls: 'search-empty-state', text: t('Keine Rückverweise gefunden.') })));
  }
}

export class OutgoingPane implements SidePane {
  id = 'outgoing'; title = t('Ausgehende Links'); icon = 'arrow-up-right';
  el = h('div', { cls: 'workspace-leaf-content', 'data-type': 'outgoing-link' });
  constructor() { const re = debounce(() => this.render(), 150); on('file-open', re); on('vault-changed', re); on('active-leaf-change', re); }
  onShow() { this.render(); }
  render() {
    const path = currentPath();
    const meta = vault.notes.get(path);
    if (!meta) { this.el.replaceChildren(h('div', { cls: 'pane-empty', text: t('Keine Notiz aktiv.') })); return; }
    const targets = [...new Set([...meta.links, ...meta.embeds])];
    const resolved = targets.map(t => ({ t, p: vault.resolve(t, path) }));
    const row = (t: string, p: string | null) => h('div', { cls: 'tree-item-self is-clickable outgoing-link-item' + (p ? '' : ' is-unresolved'), onclick: (e: MouseEvent) => import('../views/markdown').then(m => m.openLinkText(t, path, e.metaKey || e.ctrlKey)) },
      h('div', { cls: 'tree-item-icon' }, icon(p ? (/\.md$/i.test(p) ? 'file-text' : 'image') : 'file-plus')),
      h('div', { cls: 'tree-item-inner', text: p ? noteName(p) : t }));
    const ok = resolved.filter(x => x.p), missing = resolved.filter(x => !x.p);
    this.el.replaceChildren(...[
      h('div', { cls: 'tree-item-self' }, h('div', { cls: 'tree-item-inner', text: t('Links') }), h('div', { cls: 'tree-item-flair-outer' }, h('span', { cls: 'tree-item-flair', text: String(ok.length) }))),
      ...ok.map(x => row(x.t, x.p)),
      missing.length ? h('div', { cls: 'tree-item-self' }, h('div', { cls: 'tree-item-inner', text: t('Nicht erstellt') }), h('div', { cls: 'tree-item-flair-outer' }, h('span', { cls: 'tree-item-flair', text: String(missing.length) }))) : null,
      ...missing.map(x => row(x.t, null)),
      !targets.length ? h('div', { cls: 'pane-empty', text: t('Keine ausgehenden Links.') }) : null].filter(Boolean) as HTMLElement[]);
  }
}

export class OutlinePane implements SidePane {
  id = 'outline'; title = t('Gliederung'); icon = 'outline';
  el = h('div', { cls: 'workspace-leaf-content', 'data-type': 'outline' });
  constructor() { const re = debounce(() => this.render(), 200); on('file-open', re); on('vault-changed', re); on('active-leaf-change', re); }
  onShow() { this.render(); }
  render() {
    const path = currentPath();
    const hs = vault.notes.get(path)?.headings ?? [];
    if (!hs.length) { this.el.replaceChildren(h('div', { cls: 'pane-empty', text: path ? t('Keine Überschriften.') : t('Keine Notiz aktiv.') })); return; }
    const min = Math.min(...hs.map(x => x.level));
    this.el.replaceChildren(...hs.map(hd => h('div', {
      cls: 'tree-item-self is-clickable outline-item', style: { paddingInlineStart: `${12 + (hd.level - min) * 16}px` },
      onclick: () => getActiveMarkdownView()?.scrollToLine(hd.line),
    }, h('div', { cls: 'tree-item-inner', text: hd.text }))));
  }
}

export class AutomationPane implements SidePane {
  id = 'automation'; title = t('Ordner-Automatik'); icon = 'wand';
  el = h('div', { cls: 'workspace-leaf-content ordo-automation', 'data-type': 'ordo-automation' });
  private seq = 0;
  constructor() { const re = debounce(() => this.render(), 200); on('file-open', re); on('vault-changed', re); on('active-leaf-change', re); on('settings-changed', re); }
  onShow() { this.render(); }
  async render() {
    const path = currentPath();
    const seq = ++this.seq;
    if (!path) { this.el.replaceChildren(h('div', { cls: 'pane-empty', text: t('Keine Notiz aktiv.') })); return; }
    const info = await request<{ autoSort: boolean; pinned: boolean; target: string; resolvedTarget: string }>('sortInfo', { path }).catch(() => null);
    if (seq !== this.seq || !info) return;
    const meta = vault.notes.get(path);
    const folder = dirname(path) || t('Hauptordner');
    const rows: (HTMLElement | null)[] = [
      h('div', { cls: 'ordo-auto-row' }, h('span', { cls: 'ordo-auto-label', text: t('Liegt in') }), h('span', { text: folder })),
    ];
    if (!info.autoSort) rows.push(h('p', { cls: 'setting-item-description', text: t('Automatisches Einsortieren ist in den Einstellungen aus.') }));
    else if (info.pinned) {
      rows.push(h('p', { cls: 'setting-item-description', text: t('Von Hand abgelegt – Hashtags verschieben diese Notiz nicht.') }));
      rows.push(h('button', { text: t('Wieder nach Hashtags einsortieren'), onclick: () => setPinned(path, false) }));
    } else if (info.target) {
      const here = info.resolvedTarget.toLowerCase() === dirname(path).toLowerCase();
      rows.push(h('div', { cls: 'ordo-auto-row' }, h('span', { cls: 'ordo-auto-label', text: t('Ziel') }), h('span', { text: info.target + (here ? ' ✓' : '') })));
      if (!here) rows.push(h('p', { cls: 'setting-item-description', text: t('Wird beim Verlassen der Notiz dorthin verschoben.') }));
      rows.push(h('button', { text: t('Hier festpinnen'), onclick: () => setPinned(path, true) }));
    } else {
      rows.push(h('p', { cls: 'setting-item-description', text: t('Kein Ordner-Hashtag. Der 1. Ordner-Hashtag wird zum Ordner, der 2. zum Unterordner.') }));
    }
    const tags = meta?.tags ?? [];
    if (tags.length) {
      rows.push(h('div', { cls: 'ordo-auto-label', text: t('Hashtags dieser Notiz') }));
      for (const tg of tags) {
        const rule = vault.settings.tagRules[tg.toLowerCase()] ?? vault.settings.tagRules[tg.toLowerCase().split('/')[0]];
        const isFolder = rule ? rule.mode !== 'ignore' : vault.settings.allTagsAreFolders;
        rows.push(h('div', { cls: 'ordo-auto-tag' },
          h('a', { cls: 'tag', text: '#' + tg, onclick: () => emit('open-tag', tg) }),
          h('span', { cls: 'ordo-auto-tag-mode', text: isFolder ? '→ ' + (rule?.folder || tg) : t('kein Ordner') }),
          iconButton('settings', t('Ordner-Einstellung'), () => new TagRuleModal(tg).open())));
      }
    }
    this.el.replaceChildren(...rows.filter(Boolean) as HTMLElement[]);
  }
}
