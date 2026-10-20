// Graph view (tab), force-directed like Obsidian's. Colours are read from
// Obsidian's .graph-view.color-* classes so themes colour the graph too.

import { forceSimulation, forceLink, forceManyBody, forceCenter, forceX, forceY, forceCollide, Simulation, SimulationNodeDatum, SimulationLinkDatum } from 'd3-force';
import { zoom, zoomIdentity, ZoomTransform, D3ZoomEvent, ZoomBehavior } from 'd3-zoom';
import { select } from 'd3-selection';
import { View, Leaf, ViewState, registerView, workspace } from '../workspace';
import { h, debounce, noteName, dirname, basename, iconButton } from '../dom';
import { on, emit } from '../host';
import { vault } from '../store';
import { getActiveMarkdownView, openLinkText } from './markdown';

import { t } from '../i18n';
interface GNode extends SimulationNodeDatum { id: string; name: string; folder: string; kind: 'note' | 'tag' | 'missing' | 'file'; deg: number }
interface GLink extends SimulationLinkDatum<GNode> { source: string | GNode; target: string | GNode }

const defaults = { search: '', showTags: true, onlyOrphans: false, showOrphans: true, showMissing: false, showFiles: false, view: 'global' as 'global' | 'tag', tag: '', repel: 260, linkDist: 90, nodeSize: 1, textFade: 1.1, colorFolders: false };
type Opts = typeof defaults;

const STORE = 'ordo:graph2';   // new key: tags-as-hubs became the default
function loadOpts(): Opts { try { return { ...defaults, ...JSON.parse(localStorage.getItem(STORE) ?? '{}'), search: '' }; } catch { return { ...defaults }; } }

const views = new Set<GraphView>();
/** Change a graph option from outside (e.g. the "notes without links" command). */
export function setGraphOption<K extends keyof Opts>(key: K, value: Opts[K]) {
  const o = loadOpts(); o[key] = value;
  const { search, ...rest } = o; localStorage.setItem(STORE, JSON.stringify(rest));
  views.forEach(v => v.applyOption(key, value));
}

/** Local view of the notes without any hashtag. */
export const NONE_ID = '#\u0000none';
const NO_TAG = '\u0000none';
const noneLabel = () => t('Ohne Hashtag');

const MAX_LABEL = 30;
const short = (s: string) => (s.length > MAX_LABEL ? s.slice(0, MAX_LABEL - 1).trimEnd() + '…' : s);

export class GraphView extends View {
  private canvas = h('canvas', { cls: 'ordo-graph-canvas' });
  private ctx = this.canvas.getContext('2d')!;
  private panel: HTMLElement;
  private opts = loadOpts();
  private nodes: GNode[] = [];
  private links: GLink[] = [];
  private neighbors = new Map<string, Set<string>>();
  private sim: Simulation<GNode, GLink> | null = null;
  private transform: ZoomTransform = zoomIdentity;
  private hover: GNode | null = null;
  private current = '';
  private W = 0; private H = 0;
  private colors: Record<string, string> = {};
  private zoomer!: ZoomBehavior<HTMLCanvasElement, unknown>;
  private offs: (() => void)[] = [];
  private ro: ResizeObserver;
  private toggles = new Map<string, HTMLElement>();
  private labelW = new Map<string, number>();
  private rings: number[] = [];
  /** The user zoomed or panned: don't re-fit automatically any more. */
  private userMoved = false;
  private modeBar!: { global: HTMLElement; local: HTMLElement; select: HTMLSelectElement };

  getViewType() { return 'graph'; }
  getDisplayText() { return 'Graph'; }
  getIcon() { return 'graph'; }
  getState(): ViewState { return { type: 'graph' }; }

  constructor(leaf: Leaf) {
    super(leaf);
    this.titleEl.replaceChildren(h('div', { cls: 'view-header-title', text: 'Graph' }));
    this.panel = this.buildPanel();
    const colorProbe = h('div', { cls: 'ordo-graph-colors', style: { display: 'none' } },
      ...['color-fill', 'color-line', 'color-fill-tag', 'color-fill-unresolved', 'color-fill-attachment', 'color-fill-focused', 'color-text', 'color-circle', 'color-line-highlight', 'color-fill-highlight', 'color-arrow']
        .map(c => h('div', { cls: 'graph-view ' + c, 'data-c': c })));
    this.contentEl.classList.add('ordo-graph');
    this.contentEl.append(this.canvas, this.panel, this.buildModeBar(), colorProbe);
    this.setupInteraction();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.contentEl);
    const rebuild = debounce(() => this.build(), 300);
    this.offs.push(on('vault-changed', rebuild), on('appearance-changed', () => { this.readColors(); this.draw(); }), on('color-scheme-changed', () => setTimeout(() => { this.readColors(); this.draw(); }, 50)),
      on('active-leaf-change', () => { const v = getActiveMarkdownView(); if (v) { this.current = v.path; this.draw(); } }), on('settings-changed', () => this.draw()));
    const v = getActiveMarkdownView();
    this.current = v?.path ?? '';
    views.add(this);
  }

  applyOption(key: keyof Opts, value: unknown) {
    (this.opts as any)[key] = value;
    this.toggles.get(key)?.classList.toggle('is-enabled', !!value);
    this.build();
    setTimeout(() => this.fit(), 700);
  }

  async setState() { setTimeout(() => { this.readColors(); this.resize(); this.build(); setTimeout(() => this.fit(), 900); }, 30); }
  onClose() { views.delete(this); this.sim?.stop(); this.offs.forEach(f => f()); this.ro.disconnect(); }

  private muted = '#888';
  private font = 'system-ui';
  private readColors() {
    this.contentEl.querySelectorAll<HTMLElement>('.ordo-graph-colors > div').forEach(el => { this.colors[el.dataset.c!] = getComputedStyle(el).color; });
    this.font = getComputedStyle(document.body).getPropertyValue('--font-interface').trim() || 'system-ui';
    const cs = getComputedStyle(this.contentEl);
    this.muted = cs.getPropertyValue('--text-muted').trim() || '#888';
  }

  private folderColor(folder: string) {
    if (!folder || !this.opts.colorFolders) return this.colors['color-fill'];
    let hh = 0;
    for (const ch of folder.split('/')[0]) hh = (hh * 31 + ch.charCodeAt(0)) >>> 0;
    return `hsl(${hh % 360} 55% 58%)`;
  }

  private graphData() {
    const nodes: Omit<GNode, 'deg'>[] = [];
    const links: { source: string; target: string }[] = [];
    const fileNodes = new Set<string>(), missing = new Set<string>(), tags = new Set<string>();
    for (const n of vault.notes.values()) {
      nodes.push({ id: n.path, name: noteName(n.path), folder: dirname(n.path), kind: 'note' });
      const seen = new Set<string>();
      for (const t of [...n.links, ...n.embeds]) {
        const r = vault.resolve(t, n.path);
        const id = r ?? 'missing:' + t;
        if (id === n.path || seen.has(id)) continue;
        seen.add(id);
        if (r && !/\.md$/i.test(r)) fileNodes.add(r);
        if (!r) missing.add(t);
        links.push({ source: n.path, target: id });
      }
      for (const t of n.tags) { tags.add(t); links.push({ source: n.path, target: '#' + t }); }
    }
    fileNodes.forEach(f => nodes.push({ id: f, name: basename(f), folder: dirname(f), kind: 'file' }));
    missing.forEach(m => nodes.push({ id: 'missing:' + m, name: m, folder: '', kind: 'missing' }));
    tags.forEach(t => nodes.push({ id: '#' + t, name: '#' + t, folder: '', kind: 'tag' }));
    return { nodes, links };
  }

  build() {
    const o = this.opts;
    const full = this.graphData();
    let ns = full.nodes.filter(n => (n.kind !== 'tag' || o.showTags) && (n.kind !== 'missing' || o.showMissing) && (n.kind !== 'file' || o.showFiles));
    let ids = new Set(ns.map(n => n.id));
    let ls = full.links.filter(l => ids.has(l.source) && ids.has(l.target));
    if (o.onlyOrphans) {
      // notes without any link to or from another note (tags don't count)
      const linked = new Set<string>();
      for (const l of full.links) if (!l.target.startsWith('#')) { linked.add(l.source); linked.add(l.target); }
      const keep = new Set(ns.filter(n => n.kind === 'note' && !linked.has(n.id)).map(n => n.id));
      ls = ls.filter(l => keep.has(l.source) && l.target.startsWith('#'));
      ls.forEach(l => keep.add(l.target));
      ns = ns.filter(n => keep.has(n.id)); ids = keep;
    }
    const deg = new Map<string, number>();
    for (const l of ls) { deg.set(l.source, (deg.get(l.source) ?? 0) + 1); deg.set(l.target, (deg.get(l.target) ?? 0) + 1); }
    if (!o.showOrphans) ns = ns.filter(n => (deg.get(n.id) ?? 0) > 0 || n.id === this.current);
    const q = o.search.trim().toLowerCase();
    if (q) { const match = new Set(ns.filter(n => n.name.toLowerCase().includes(q) || n.id.toLowerCase().includes(q)).map(n => n.id)); ns = ns.filter(n => match.has(n.id)); ls = ls.filter(l => match.has(l.source) && match.has(l.target)); }
    const old = new Map(this.nodes.map(n => [n.id, n]));
    this.nodes = ns.map(n => { const p = old.get(n.id); return { ...n, deg: deg.get(n.id) ?? 0, x: p?.x, y: p?.y, vx: p?.vx, vy: p?.vy }; });
    this.links = ls.map(l => ({ ...l }));
    this.neighbors = new Map();
    for (const l of ls) { (this.neighbors.get(l.source) ?? this.neighbors.set(l.source, new Set()).get(l.source)!).add(l.target); (this.neighbors.get(l.target) ?? this.neighbors.set(l.target, new Set()).get(l.target)!).add(l.source); }
    this.sim?.stop();
    cancelAnimationFrame(this.layoutAnim);
    if (o.view === 'tag') { this.buildTagView(full); return; }
    this.rings = [];
    this.syncModeBar();
    this.sim = forceSimulation<GNode, GLink>(this.nodes)
      .force('link', forceLink<GNode, GLink>(this.links).id(d => d.id).distance(o.linkDist).strength(0.6))
      .force('charge', forceManyBody<GNode>().strength(-o.repel).distanceMax(900))
      .force('center', forceCenter(0, 0).strength(0.05))
      .force('x', forceX<GNode>(0).strength(0.04)).force('y', forceY<GNode>(0).strength(0.04))
      .force('collide', forceCollide<GNode>(d => this.radius(d) + 2))
      .alpha(old.size ? 0.4 : 1)
      .alphaDecay(0.04)   // settles in ~3 s instead of ~10 s
      .on('tick', () => this.draw())
      .on('end', () => { if (!this.userMoved) this.fit(); });
  }

  /** Tags of the vault, most used first. */
  private allTags(): string[] {
    const c = new Map<string, number>();
    for (const n of vault.notes.values()) for (const tg of n.tags) c.set(tg, (c.get(tg) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tg]) => tg);
  }

  /** Local view: one hashtag in the middle, its notes on a ring, notes they link to further out. */
  private buildTagView(full: { nodes: Omit<GNode, 'deg'>[]; links: { source: string; target: string }[] }) {
    const o = this.opts;
    const tags = this.allTags();
    if (o.tag !== NO_TAG && (!o.tag || !tags.includes(o.tag))) o.tag = vault.notes.get(this.current)?.tags[0] ?? tags[0] ?? NO_TAG;
    this.syncModeBar();
    const center = '#' + o.tag;
    this.centerId = center;
    const byId = new Map(full.nodes.map(n => [n.id, n]));
    if (o.tag === NO_TAG) {
      // pseudo group in the middle: every note without a hashtag hangs on it
      byId.set(NONE_ID, { id: NONE_ID, name: NONE_ID, folder: '', kind: 'tag' });
      full = { nodes: full.nodes, links: [...full.links, ...[...vault.notes.values()].filter(n => !n.tags.length).map(n => ({ source: n.path, target: NONE_ID }))] };
    }
    // notes on the ring are grouped by their other hashtags (subject), so related notes sit together
    const rank = new Map(tags.map((tg, i) => [tg, i]));
    const groupOf = (id: string) => {
      const other = (vault.notes.get(id)?.tags ?? []).filter(tg => tg !== o.tag).sort((a, b) => (rank.get(a) ?? 1e9) - (rank.get(b) ?? 1e9));
      return other[0] ?? '\uffff';
    };
    const ring1 = full.links.filter(l => l.target === center).map(l => l.source)
      .sort((a, b) => groupOf(a).localeCompare(groupOf(b), 'de') || noteName(a).localeCompare(noteName(b), 'de'));
    const in1 = new Set(ring1);
    const ring2: string[] = [];
    const ls: { source: string; target: string }[] = ring1.map(id => ({ source: id, target: center }));
    for (const l of full.links) {
      if (l.target.startsWith('#') || l.target.startsWith('missing:')) continue;
      const a = in1.has(l.source), b = in1.has(l.target);
      if (a && b) ls.push(l);
      else if (a || b) {
        const other = a ? l.target : l.source;
        if (!byId.has(other) || byId.get(other)!.kind !== 'note') continue;
        if (!ring2.includes(other)) ring2.push(other);
        ls.push(l);
      }
    }
    const deg = new Map<string, number>();
    for (const l of ls) { deg.set(l.source, (deg.get(l.source) ?? 0) + 1); deg.set(l.target, (deg.get(l.target) ?? 0) + 1); }
    const r1 = Math.max(130, ring1.length * 46 / (2 * Math.PI)), r2 = r1 + 130;
    const pos = new Map<string, [number, number]>([[center, [0, 0]]]);
    ring1.forEach((id, i) => { const a = -Math.PI / 2 + i * 2 * Math.PI / Math.max(1, ring1.length); pos.set(id, [Math.cos(a) * r1, Math.sin(a) * r1]); });
    // outer notes sit near the inner note they are linked with
    const angleOf = (id: string) => { const p = pos.get(id)!; return Math.atan2(p[1], p[0]); };
    const want = ring2.map(id => {
      const nb = ls.filter(l => (l.source === id && in1.has(l.target)) || (l.target === id && in1.has(l.source))).map(l => (l.source === id ? l.target : l.source));
      const ax = nb.reduce((s, n) => s + Math.cos(angleOf(n)), 0), ay = nb.reduce((s, n) => s + Math.sin(angleOf(n)), 0);
      return { id, a: Math.atan2(ay, ax) };
    }).sort((x, y) => x.a - y.a);
    const minGap = 52 / r2;
    want.forEach((w, i) => { if (i && w.a - want[i - 1].a < minGap) w.a = want[i - 1].a + minGap; pos.set(w.id, [Math.cos(w.a) * r2, Math.sin(w.a) * r2]); });
    const ids = [center, ...ring1, ...ring2];
    const prev = new Map(this.nodes.filter(n => n.x != null).map(n => [n.id, [n.x!, n.y!] as [number, number]]));
    this.nodes = ids.filter(id => byId.has(id)).map(id => { const n = byId.get(id)!; const [x, y] = pos.get(id)!; return { ...n, deg: deg.get(id) ?? 0, x, y, fx: null, fy: null }; });
    this.links = ls.map(l => ({ ...l }));
    this.neighbors = new Map();
    for (const l of ls) { (this.neighbors.get(l.source) ?? this.neighbors.set(l.source, new Set()).get(l.source)!).add(l.target); (this.neighbors.get(l.target) ?? this.neighbors.set(l.target, new Set()).get(l.target)!).add(l.source); }
    this.rings = ring1.length ? (ring2.length ? [r1, r2] : [r1]) : [];
    // no forces: positions are the layout; the simulation only resolves link ids and supports dragging
    this.sim = forceSimulation<GNode, GLink>(this.nodes).force('link', forceLink<GNode, GLink>(this.links).id(d => d.id).strength(0)).alpha(0).stop();
    // camera to the final layout, then the dots glide there from where they were
    this.fit(true);
    const target = new Map(this.nodes.map(n => [n.id, [n.x!, n.y!] as [number, number]]));
    this.layoutPos = target;
    for (const n of this.nodes) { const p = prev.get(n.id); n.x = p ? p[0] : 0; n.y = p ? p[1] : 0; }
    const start = performance.now(), ms = 550;
    cancelAnimationFrame(this.layoutAnim);
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / ms), e = 1 - Math.pow(1 - p, 3);
      for (const n of this.nodes) { const tgt = target.get(n.id); if (!tgt) continue; const [tx, ty] = tgt, q = prev.get(n.id) ?? [0, 0]; n.x = q[0] + (tx - q[0]) * e; n.y = q[1] + (ty - q[1]) * e; }
      this.draw();
      if (p < 1) this.layoutAnim = requestAnimationFrame(step);
    };
    this.layoutAnim = requestAnimationFrame(step);
  }

  private radius(n: GNode) { return n.kind === 'tag' ? (4 + Math.sqrt(n.deg) * 2) * this.opts.nodeSize : (3 + Math.sqrt(n.deg) * 1) * this.opts.nodeSize; }

  private resize() {
    const dpr = window.devicePixelRatio || 1;
    const oldW = this.W, oldH = this.H;
    this.W = this.contentEl.clientWidth; this.H = this.contentEl.clientHeight;
    // keep the graph centred when the view changes size (origin = top-left of the canvas)
    if (this.zoomer && this.W) {
      const t = this.transform, dx = (this.W - oldW) / 2, dy = (this.H - oldH) / 2;
      if (dx || dy) select(this.canvas).call(this.zoomer.transform, zoomIdentity.translate(t.x + dx, t.y + dy).scale(t.k));
    }
    this.canvas.width = this.W * dpr; this.canvas.height = this.H * dpr;
    this.canvas.style.width = this.W + 'px'; this.canvas.style.height = this.H + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  draw() {
    const { ctx, transform: t, W, H, colors: c } = this;
    if (!W) return;
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    ctx.translate(t.x, t.y);   // transform maps graph → screen directly, so zoom stays under the cursor
    ctx.scale(t.k, t.k);
    // hover highlight fades in and out (f = 0…1) instead of switching hard
    const focus = this.hover ?? this.fadeFrom;
    const f = focus ? this.hoverT : 0;
    const near = focus ? this.neighbors.get(focus.id) ?? new Set<string>() : null;
    const mix = (a: number, b: number) => a + (b - a) * f;
    if (this.rings.length) {
      ctx.save(); ctx.setLineDash([3 / t.k, 5 / t.k]); ctx.strokeStyle = c['color-line']; ctx.globalAlpha = 0.5; ctx.lineWidth = 1 / t.k;
      for (const r of this.rings) { ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke(); }
      ctx.restore();
    }
    ctx.lineWidth = 0.8 / t.k;
    // links in batches (one path per colour/opacity) instead of one stroke per link
    const buckets = new Map<string, { style: string; alpha: number; segs: number[] }>();
    for (const l of this.links) {
      const s = l.source as GNode, tg = l.target as GNode;
      if (s.x == null || tg.x == null) continue;
      const active = !!focus && (s.id === focus.id || tg.id === focus.id);
      const style = active && f > 0.5 ? c['color-line-highlight'] || c['color-fill-focused'] : c['color-line'];
      const base = s.kind === 'tag' || tg.kind === 'tag' ? 0.28 : 0.5;
      const alpha = !focus ? base : active ? mix(base, 0.9) : mix(base, 0.06);
      const key = style + '|' + alpha.toFixed(3);
      let b = buckets.get(key);
      if (!b) buckets.set(key, b = { style, alpha, segs: [] });
      b.segs.push(s.x, s.y!, tg.x, tg.y!);
    }
    for (const b of buckets.values()) {
      ctx.strokeStyle = b.style; ctx.globalAlpha = b.alpha;
      ctx.beginPath();
      for (let i = 0; i < b.segs.length; i += 4) { ctx.moveTo(b.segs[i], b.segs[i + 1]); ctx.lineTo(b.segs[i + 2], b.segs[i + 3]); }
      ctx.stroke();
    }
    for (const n of this.nodes) {
      if (n.x == null) continue;
      ctx.globalAlpha = focus && n.id !== focus.id && !near!.has(n.id) ? mix(1, 0.18) : 1;
      ctx.fillStyle = n.id === focus?.id && f > 0.5 ? (c['color-fill-highlight'] || c['color-fill-focused'])
        : n.id === this.current ? c['color-fill-focused']
        : n.kind === 'tag' ? c['color-fill-tag'] : n.kind === 'missing' ? c['color-fill-unresolved'] : n.kind === 'file' ? c['color-fill-attachment'] : this.folderColor(n.folder);
      ctx.beginPath(); ctx.arc(n.x, n.y!, this.radius(n), 0, Math.PI * 2);
      if (n.id === NONE_ID) ctx.fillStyle = this.muted;
      ctx.fill();
    }
    // labels: tags always, notes when zoomed in; most important first, overlapping ones are skipped
    const labelAlpha = Math.max(0, Math.min(1, (t.k - (0.9 - this.opts.textFade * 0.4)) * 2));
    const font = this.font;   // read once in readColors(): getComputedStyle every frame forces a style recalc
    const fs = 12 / Math.max(t.k, 0.6);
    const rank = (n: GNode) => (n.id === focus?.id ? 0 : near?.has(n.id) ? 1 : n.kind === 'tag' ? 2 : n.id === this.current ? 3 : 4) * 1e6 - n.deg;
    const order = this.nodes.filter(n => n.x != null).sort((a, b) => rank(a) - rank(b));
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const cell = 80, grid = new Map<string, number[]>();
    const keyOf = (cx: number, cy: number) => cx + ',' + cy;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const n of order) {
      const isFocus = !!focus && (n.id === focus.id || near!.has(n.id));
      const isTag = n.kind === 'tag';
      const normal = isTag ? Math.max(labelAlpha, t.k > 0.25 ? 0.9 : 0) : labelAlpha;
      let a = !focus ? normal : isFocus ? mix(normal, 1) : mix(normal, normal * 0.12);
      if (a <= 0.02) continue;
      // type hierarchy: centre of the local view > groups (hashtags, accent, semibold, no "#") > active note > notes (muted)
      const isCenter = this.rings.length > 0 && n.id === this.centerId;
      const isCurrent = n.id === this.current;
      const size = isCenter ? fs * 1.5 : isTag ? fs * 1.12 : fs * 0.95;
      const weight = isCenter ? 700 : isTag ? 600 : isCurrent || isFocus ? 500 : 400;
      const name = n.id === NONE_ID ? noneLabel() : isTag ? n.name.slice(1) : short(n.name);
      // widths are measured once at 100 px and scaled, so zooming never re-measures
      const wKey = weight + '|' + name;
      let w100 = this.labelW.get(wKey);
      if (w100 == null) { ctx.font = `${weight} 100px ${font}`; w100 = ctx.measureText(name).width; this.labelW.set(wKey, w100); }
      const w = w100 * size / 100;
      ctx.font = `${weight} ${size}px ${font}`;
      // local view: labels point outwards beside the dot; otherwise centred below it
      const radial = this.rings.length > 0 && n.id !== this.centerId;
      let lx = n.x!, y = n.y! + this.radius(n) + 3, align: CanvasTextAlign = 'center';
      if (radial) {
        const a = Math.atan2(n.y!, n.x!), d = this.radius(n) + 5;
        lx = n.x! + Math.cos(a) * d; y = n.y! + Math.sin(a) * d - size / 2;
        align = Math.abs(Math.cos(a)) < 0.2 ? 'center' : Math.cos(a) > 0 ? 'left' : 'right';
        if (align === 'center') y += Math.sin(a) > 0 ? size / 2 : -size / 2;
      }
      // screen-space box for the overlap test
      const sx = lx * t.k, sy = y * t.k, sw = w * t.k, sh = size * t.k;
      const bx0 = align === 'left' ? sx : align === 'right' ? sx - sw : sx - sw / 2;
      const box = { x0: bx0 - 2, y0: sy - 1, x1: bx0 + sw + 2, y1: sy + sh + 1 };
      const c0 = Math.floor(box.x0 / cell), c1 = Math.floor(box.x1 / cell), r0 = Math.floor(box.y0 / cell), r1 = Math.floor(box.y1 / cell);
      let hit = false;
      for (let cx = c0; cx <= c1 && !hit; cx++) for (let cy = r0; cy <= r1 && !hit; cy++)
        for (const i of grid.get(keyOf(cx, cy)) ?? []) { const p = placed[i]; if (box.x0 < p.x1 && box.x1 > p.x0 && box.y0 < p.y1 && box.y1 > p.y0) { hit = true; break; } }
      if (hit && !isFocus && !isTag) continue;   // tags always keep their name
      const idx = placed.push(box) - 1;
      for (let cx = c0; cx <= c1; cx++) for (let cy = r0; cy <= r1; cy++) (grid.get(keyOf(cx, cy)) ?? grid.set(keyOf(cx, cy), []).get(keyOf(cx, cy))!).push(idx);
      ctx.globalAlpha = a;
      ctx.fillStyle = n.id === NONE_ID ? this.muted : isTag ? c['color-fill-tag'] : isCurrent || isFocus ? c['color-text'] : this.muted;
      ctx.textAlign = align;
      ctx.fillText(name, lx, y);
    }
    ctx.restore();
  }

  private toGraph(px: number, py: number) { return { x: (px - this.transform.x) / this.transform.k, y: (py - this.transform.y) / this.transform.k }; }
  private nodeAt(px: number, py: number): GNode | null {
    const p = this.toGraph(px, py);
    let best: GNode | null = null, bestD = Infinity;
    for (const n of this.nodes) { if (n.x == null) continue; const d = Math.hypot(n.x - p.x, n.y! - p.y); if (d < this.radius(n) + 6 / this.transform.k && d < bestD) { best = n; bestD = d; } }
    return best;
  }

  private setupInteraction() {
    const canvas = this.canvas;
    this.zoomer = zoom<HTMLCanvasElement, unknown>().scaleExtent([0.08, 8])
      .filter((e: any) => { if (e.type === 'wheel') return true; const r = canvas.getBoundingClientRect(); const pt = e.touches?.[0] ?? e; return !this.nodeAt(pt.clientX - r.left, pt.clientY - r.top); })
      .on('zoom', (e: D3ZoomEvent<HTMLCanvasElement, unknown>) => { if (e.sourceEvent) { this.userMoved = true; cancelAnimationFrame(this.zoomAnim); } this.transform = e.transform; this.draw(); });
    select(canvas).call(this.zoomer).on('dblclick.zoom', null);
    let drag: GNode | null = null, moved = false, down = { x: 0, y: 0 };
    canvas.addEventListener('pointerdown', e => {
      const r = canvas.getBoundingClientRect();
      const n = this.nodeAt(e.clientX - r.left, e.clientY - r.top);
      if (!n) return;
      drag = n; moved = false; down = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
      this.setHover(n);
    });
    canvas.addEventListener('pointermove', e => {
      const r = canvas.getBoundingClientRect();
      if (drag) {
        if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 3) moved = true;
        if (moved) {
          const p = this.toGraph(e.clientX - r.left, e.clientY - r.top);
          // local view has no forces: move the dot directly; global: pin it and let the forces follow
          if (this.opts.view === 'tag') { drag.x = p.x; drag.y = p.y; this.draw(); }
          else { drag.fx = p.x; drag.fy = p.y; this.sim?.alphaTarget(0.25).restart(); }
        }
        return;
      }
      const n = this.nodeAt(e.clientX - r.left, e.clientY - r.top);
      if (n !== this.hover) { this.setHover(n); canvas.style.cursor = n ? 'pointer' : 'default'; }
    });
    canvas.addEventListener('pointerup', e => {
      if (!drag) return;
      const n = drag; drag = null;
      if (this.opts.view !== 'tag') this.sim?.alphaTarget(0);
      n.fx = null; n.fy = null;
      if (moved) { if (this.opts.view === 'tag') this.springBack(n); return; }
      if (n.id === NONE_ID) return;
      if (n.kind === 'tag') {
        // global: a hashtag opens its local view; local: the centre opens the tag search
        if (this.opts.view === 'tag' && this.opts.tag === n.name.slice(1)) emit('open-tag', n.name.slice(1));
        else this.setView('tag', n.name.slice(1));
      }
      else if (n.kind === 'missing') openLinkText(n.name, '', e.metaKey || e.ctrlKey);
      else workspace.openFile(n.id, { newLeaf: e.metaKey || e.ctrlKey });
    });
    canvas.addEventListener('pointerleave', () => { if (!drag && this.hover) this.setHover(null); });
  }

  fit(animate = true) {
    if (!this.nodes.length || !this.W) return;
    const xs = this.nodes.map(n => n.x ?? 0), ys = this.nodes.map(n => n.y ?? 0);
    // room for the labels below and beside the outer nodes
    const mx = this.rings.length ? 170 : 70, my = this.rings.length ? 30 : 20;   // local view: labels point outwards
    const minX = Math.min(...xs) - mx, maxX = Math.max(...xs) + mx, minY = Math.min(...ys) - my, maxY = Math.max(...ys) + my + 10;
    const k = Math.min(3, 0.85 * Math.min(this.W / Math.max(40, maxX - minX), this.H / Math.max(40, maxY - minY)));
    const target = zoomIdentity.translate(this.W / 2 - (minX + maxX) / 2 * k, this.H / 2 - (minY + maxY) / 2 * k).scale(k);
    if (animate) this.animateTo(target); else select(this.canvas).call(this.zoomer.transform, target);
  }

  private hoverT = 0;
  private fadeFrom: GNode | null = null;
  private hoverAnim = 0;
  /** Hover highlight with a short fade (150 ms in, 200 ms out). */
  private setHover(n: GNode | null) {
    const prev = this.hover;
    this.hover = n;
    if (!n && prev) this.fadeFrom = prev;
    if (n) this.fadeFrom = null;
    const from = this.hoverT, to = n ? 1 : 0, ms = n ? 150 : 200, start = performance.now();
    cancelAnimationFrame(this.hoverAnim);
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      this.hoverT = from + (to - from) * p;
      this.draw();
      if (p < 1) this.hoverAnim = requestAnimationFrame(step);
      else if (!n) this.fadeFrom = null;
    };
    this.hoverAnim = requestAnimationFrame(step);
  }

  private zoomAnim = 0;
  private layoutAnim = 0;
  private centerId = '';
  private layoutPos = new Map<string, [number, number]>();
  /** Local view has a fixed layout: a dragged dot glides back to its place. */
  private springBack(n: GNode) {
    const to = this.layoutPos.get(n.id);
    if (!to) return;
    const from = [n.x!, n.y!], start = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / 300), e = 1 - Math.pow(1 - p, 3);
      n.x = from[0] + (to[0] - from[0]) * e; n.y = from[1] + (to[1] - from[1]) * e;
      this.draw();
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  /** Smooth camera move: zoom in log space, the centre on a straight line, eased. */
  private animateTo(target: ZoomTransform, ms = 550) {
    cancelAnimationFrame(this.zoomAnim);
    const a = this.transform, W2 = this.W / 2, H2 = this.H / 2;
    const c0 = { x: (W2 - a.x) / a.k, y: (H2 - a.y) / a.k }, c1 = { x: (W2 - target.x) / target.k, y: (H2 - target.y) / target.k };
    const start = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / ms), e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      const k = a.k * Math.pow(target.k / a.k, e), cx = c0.x + (c1.x - c0.x) * e, cy = c0.y + (c1.y - c0.y) * e;
      select(this.canvas).call(this.zoomer.transform, zoomIdentity.translate(W2 - cx * k, H2 - cy * k).scale(k));
      if (p < 1) this.zoomAnim = requestAnimationFrame(step);
    };
    this.zoomAnim = requestAnimationFrame(step);
  }

  setView(view: 'global' | 'tag', tag?: string) {
    this.userMoved = false;
    this.opts.view = view;
    if (tag) this.opts.tag = tag;
    const { search, ...rest } = this.opts; localStorage.setItem(STORE, JSON.stringify(rest));
    this.build();
    if (view === 'global') setTimeout(() => this.fit(), 700);
  }

  /** "Global | Lokal" switch and the hashtag picker of the local view. */
  private buildModeBar() {
    const mk = (label: string, view: 'global' | 'tag') => h('button', { cls: 'ordo-seg-btn', text: label, onclick: () => this.setView(view) });
    const global = mk(t('Global'), 'global'), local = mk(t('Lokal'), 'tag');
    const select = h('select', { cls: 'dropdown ordo-graph-tag-select' }) as HTMLSelectElement;
    select.addEventListener('change', () => this.setView('tag', select.value));
    this.modeBar = { global, local, select };
    return h('div', { cls: 'ordo-graph-modes' }, h('div', { cls: 'ordo-seg' }, global, local), select);
  }

  private syncModeBar() {
    if (!this.modeBar) return;
    const { global, local, select } = this.modeBar, o = this.opts;
    global.classList.toggle('is-active', o.view !== 'tag'); local.classList.toggle('is-active', o.view === 'tag');
    select.hidden = o.view !== 'tag';
    if (o.view === 'tag') {
      const tags = this.allTags();
      const values = [NO_TAG, ...tags];
      if (select.options.length !== values.length || [...select.options].some((op, i) => op.value !== values[i]))
        select.replaceChildren(h('option', { value: NO_TAG, text: t('Ohne Hashtag') }), ...tags.map(tg => h('option', { value: tg, text: '#' + tg })));
      select.value = o.tag;
    }
  }

  private buildPanel() {
    const o = this.opts;
    const save = () => { const { search, ...rest } = o; localStorage.setItem(STORE, JSON.stringify(rest)); };
    const check = (key: keyof Opts, label: string) => {
      const t = h('div', { cls: 'checkbox-container' + (o[key] ? ' is-enabled' : '') });
      this.toggles.set(key, t);
      t.addEventListener('click', () => { (o as any)[key] = !o[key]; t.classList.toggle('is-enabled', !!o[key]); save(); this.build(); });
      return h('div', { cls: 'setting-item mod-toggle' }, h('div', { cls: 'setting-item-info' }, h('div', { cls: 'setting-item-name', text: label })), h('div', { cls: 'setting-item-control' }, t));
    };
    const slider = (key: keyof Opts, label: string, min: number, max: number, step: number, rebuild = true) => {
      const r = h('input', { type: 'range', cls: 'slider', min: String(min), max: String(max), step: String(step), value: String(o[key]) });
      r.addEventListener('input', () => { (o as any)[key] = +r.value; save(); rebuild ? this.build() : this.draw(); });
      return h('div', { cls: 'setting-item mod-slider' }, h('div', { cls: 'setting-item-info' }, h('div', { cls: 'setting-item-name', text: label })), h('div', { cls: 'setting-item-control' }, r));
    };
    const search = h('input', { type: 'search', placeholder: t('Dateien filtern …') });
    search.addEventListener('input', debounce(() => { o.search = search.value; this.build(); }, 200));
    const section = (title: string, ...items: HTMLElement[]) => {
      const body = h('div', { cls: 'tree-item-children' }, ...items);
      const head = h('div', { cls: 'graph-control-section-header', text: title, onclick: () => sec.classList.toggle('is-collapsed') });
      const sec = h('div', { cls: 'tree-item graph-control-section' }, head, body);
      return sec;
    };
    const panel = h('div', { cls: 'graph-controls is-close' },
      h('div', { cls: 'graph-controls-button mod-close' }, iconButton('x', t('Schließen'), () => panel.classList.add('is-close'))),
      h('div', { cls: 'graph-controls-button mod-open' }, iconButton('settings', t('Graph-Einstellungen'), () => panel.classList.remove('is-close'))),
      h('div', { cls: 'graph-controls-button mod-fit' }, iconButton('expand-all', t('Einpassen'), () => this.fit())),
      section(t('Filter'), search, check('showTags', t('Tags')), check('showFiles', t('Anhänge')), check('showMissing', t('Nicht existierende Dateien')), check('showOrphans', t('Waisen')), check('onlyOrphans', t('Nur Notizen ohne Verbindungen'))),
      section(t('Darstellung'), check('colorFolders', t('Nach Ordner einfärben')), slider('nodeSize', t('Knotengröße'), 0.5, 3, 0.1, false), slider('textFade', t('Text einblenden'), 0, 2, 0.1, false)),
      section(t('Kräfte'), slider('repel', t('Abstoßung'), 30, 800, 10), slider('linkDist', t('Linkdistanz'), 20, 250, 5)));
    return panel;
  }
}

registerView('graph', leaf => new GraphView(leaf));
