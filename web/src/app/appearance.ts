// Appearance like Obsidian: base colour scheme, accent colour, community
// themes (theme.css), CSS snippets, fonts, font size, Style Settings values.
// Starts from the vault's .obsidian/appearance.json, stored in .ordo/appearance.json.

import { request, emit } from './host';
import { setCustomHotkeys, getCustomHotkeys, Hotkey } from './commands';

export interface Appearance {
  theme: 'moonstone' | 'obsidian' | 'system';   // Obsidian's names: light / dark / system
  accentColor: string;
  cssTheme: string;
  enabledCssSnippets: string[];
  interfaceFontFamily: string;
  textFontFamily: string;
  monospaceFontFamily: string;
  baseFontSize: number;
  hotkeys?: Record<string, Hotkey[]>;
  importedFromObsidian?: boolean;
  [k: string]: unknown;
}

export const appearance: Appearance = {
  theme: 'system', accentColor: '', cssTheme: '', enabledCssSnippets: [],
  interfaceFontFamily: '', textFontFamily: '', monospaceFontFamily: '', baseFontSize: 15,
};

const media = window.matchMedia('(prefers-color-scheme: dark)');
media.addEventListener('change', () => { if (getScheme() === 'system') applyColorScheme(); });

// ---------- per-device: color scheme & zoom ----------

export type Scheme = 'system' | 'light' | 'dark';
function local(key: string): string | null { try { return localStorage.getItem('ordo:' + key); } catch { return null; } }
function setLocal(key: string, v: string) { try { localStorage.setItem('ordo:' + key, v); } catch { /* private */ } }

export function getScheme(): Scheme {
  const v = local('scheme');
  return v === 'light' || v === 'dark' ? v : 'system';
}
export function setScheme(s: Scheme) { setLocal('scheme', s); applyColorScheme(); }
/** Light → dark → system → light … */
export function cycleScheme(): Scheme {
  const next: Scheme = ({ light: 'dark', dark: 'system', system: 'light' } as const)[getScheme()];
  setScheme(next);
  return next;
}

export function getZoom(): number { const z = parseFloat(local('zoom') ?? ''); return z >= 0.6 && z <= 1.6 ? z : 1; }
export function setZoom(z: number) { setLocal('zoom', String(z)); applyZoom(); }
export function applyZoom() { request('setZoom', { zoom: getZoom() }).catch(() => {}); }

function styleEl(id: string) {
  let el = document.getElementById(id) as HTMLStyleElement | null;
  if (!el) { el = document.createElement('style'); el.id = id; document.head.appendChild(el); }
  return el;
}

export async function loadAppearance() {
  const data = await request<Partial<Appearance>>('appearance').catch(() => ({}));
  Object.assign(appearance, {
    theme: 'system', accentColor: '', cssTheme: '', enabledCssSnippets: [],
    interfaceFontFamily: '', textFontFamily: '', monospaceFontFamily: '', baseFontSize: 15,
  }, data);
  setCustomHotkeys(appearance.hotkeys ?? {});
  await applyAll();
  if (data && (data as any).importedFromObsidian) {
    delete (appearance as any).importedFromObsidian;
    saveAppearance();
  }
}

export function saveAppearance() {
  appearance.hotkeys = getCustomHotkeys();
  return request('saveAppearance', { appearance: { ...appearance } }).catch(() => {});
}

export async function applyAll() {
  applyColorScheme();
  applyAccent();
  applyFonts();
  await applyTheme();
  await applySnippets();
  await applyStyleSettings();
  emit('appearance-changed');
}

export function isDark() {
  const s = getScheme();
  return s === 'dark' || (s === 'system' && media.matches);
}

export function applyColorScheme() {
  const dark = isDark();
  document.body.classList.toggle('theme-dark', dark);
  document.body.classList.toggle('theme-light', !dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  emit('color-scheme-changed', dark);
}

export function applyAccent() {
  const s = document.body.style;
  const hex = appearance.accentColor;
  if (!/^#[0-9a-f]{6}$/i.test(hex)) { s.removeProperty('--accent-h'); s.removeProperty('--accent-s'); s.removeProperty('--accent-l'); return; }
  const [hh, ss, ll] = hexToHsl(hex);
  s.setProperty('--accent-h', String(hh));
  s.setProperty('--accent-s', ss + '%');
  s.setProperty('--accent-l', ll + '%');
}

export function applyFonts() {
  const s = document.body.style;
  const set = (name: string, v: string) => (v ? s.setProperty(name, v) : s.removeProperty(name));
  set('--font-interface-override', fontList(appearance.interfaceFontFamily));
  set('--font-text-override', fontList(appearance.textFontFamily));
  set('--font-monospace-override', fontList(appearance.monospaceFontFamily));
  s.setProperty('--font-text-size', `${appearance.baseFontSize || 15}px`);
}

function fontList(v: string) {
  if (!v) return '';
  return v.split(',').map(f => f.trim()).filter(Boolean).map(f => (/^["'].*["']$/.test(f) || /^[a-z-]+$/.test(f) ? f : `"${f}"`)).join(', ');
}

export async function applyTheme() {
  const el = styleEl('ordo-theme');
  document.body.classList.toggle('ordo-default-theme', !appearance.cssTheme);
  if (!appearance.cssTheme) { el.textContent = ''; return; }
  const css = await request<string | null>('themeCSS', { name: appearance.cssTheme }).catch(() => null);
  el.textContent = css ?? '';
  document.body.dataset.theme = appearance.cssTheme;
}

/** The snippet edited under Einstellungen › Darstellung › Eigenes CSS; always applied last. */
export const CUSTOM_SNIPPET = 'eigenes';

export async function applySnippets() {
  document.querySelectorAll('style.ordo-snippet').forEach(e => e.remove());
  const names = appearance.enabledCssSnippets ?? [];
  for (const name of [...names.filter(n => n !== CUSTOM_SNIPPET), ...names.filter(n => n === CUSTOM_SNIPPET)]) {
    const css = await request<string | null>('snippetCSS', { name }).catch(() => null);
    if (!css) continue;
    const el = document.createElement('style');
    el.className = 'ordo-snippet';
    el.dataset.name = name;
    el.textContent = css;
    document.head.appendChild(el);
  }
}

let styleClasses: string[] = [];

/** Values from the "Style Settings" plugin: class toggles + CSS variables. */
export async function applyStyleSettings() {
  document.body.classList.remove(...styleClasses);
  styleClasses = [];
  const el = styleEl('ordo-style-settings');
  el.textContent = '';
  if (!appearance.cssTheme) return;
  const data = await request<Record<string, unknown> | null>('styleSettings').catch(() => null);
  if (!data || typeof data !== 'object') return;
  const base: string[] = [], light: string[] = [], dark: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    const parts = key.split('@@');
    if (parts.length < 2) continue;
    const id = parts[1], mode = parts[2];
    if (value === true) { styleClasses.push(id); continue; }
    if (value === false || value == null) continue;
    const v = String(value);
    const isCss = /^(#|rgb|hsl|var\(|-?\d|calc\()/i.test(v) || /\b(px|em|rem|%)$/.test(v) || mode;
    if (isCss) (mode === 'light' ? light : mode === 'dark' ? dark : base).push(`--${id}: ${v};`);
    else if (/^[\w-]+$/.test(v)) styleClasses.push(v);
  }
  document.body.classList.add(...styleClasses);
  el.textContent = `body { ${base.join(' ')} } body.theme-light { ${light.join(' ')} } body.theme-dark { ${dark.join(' ')} }`;
}

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let hh = 0, ss = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    ss = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: hh = (g - b) / d + (g < b ? 6 : 0); break;
      case g: hh = (b - r) / d + 2; break;
      default: hh = (r - g) / d + 4;
    }
    hh /= 6;
  }
  return [Math.round(hh * 360), Math.round(ss * 100), Math.round(l * 100)];
}

// ---------- community themes ----------

export interface CommunityTheme { name: string; author: string; repo: string; screenshot: string; modes: string[] }

let communityCache: CommunityTheme[] | null = null;
export async function communityThemes(): Promise<CommunityTheme[]> {
  if (communityCache) return communityCache;
  const text = await request<string>('fetchText', { url: 'https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-css-themes.json' });
  communityCache = JSON.parse(text);
  return communityCache!;
}

export async function installCommunityTheme(t: CommunityTheme) {
  const css = await request<string>('fetchText', { url: `https://raw.githubusercontent.com/${t.repo}/HEAD/theme.css` })
    .catch(() => request<string>('fetchText', { url: `https://raw.githubusercontent.com/${t.repo}/HEAD/obsidian.css` }));
  if (!css || css.length < 50) throw new Error('theme.css nicht gefunden');
  await request('installTheme', { name: t.name, css });
}
