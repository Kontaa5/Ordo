// Command registry + hotkeys (like Obsidian). Every action is a command;
// hotkeys are configurable and also reachable via the command palette.

import { request, on, isMac } from './host';
import { isModalOpen } from './ui/modal';

import { t, tn } from './i18n';
export type Modifier = 'Mod' | 'Ctrl' | 'Alt' | 'Shift';
export interface Hotkey { modifiers: Modifier[]; key: string }

export interface Command {
  id: string;
  name: string;
  icon?: string;
  hotkeys?: Hotkey[];
  /** On macOS also accept Ctrl instead of ⌘ (Strg+N, Strg+T …). */
  ctrlAlias?: boolean;
  /** Return false when the command is not available right now. */
  check?: () => boolean;
  callback: () => void;
  /** Only listed when true (e.g. editor commands while editing). */
  hidden?: boolean;
}

const commands = new Map<string, Command>();
let custom: Record<string, Hotkey[]> = {};
let comboMap = new Map<string, string>();
const listeners = new Set<() => void>();

export function addCommand(cmd: Command) {
  commands.set(cmd.id, cmd);
  scheduleRebuild();
}

export function getCommands() { return [...commands.values()]; }
export function getCommand(id: string) { return commands.get(id); }

export function hotkeysFor(id: string): Hotkey[] {
  return custom[id] ?? commands.get(id)?.hotkeys ?? [];
}

export function setCustomHotkeys(map: Record<string, Hotkey[]>) {
  custom = map ?? {};
  scheduleRebuild();
}
export function getCustomHotkeys() { return custom; }

export function setHotkey(id: string, hotkeys: Hotkey[] | null) {
  if (hotkeys == null) delete custom[id]; else custom[id] = hotkeys;
  scheduleRebuild();
  listeners.forEach(fn => fn());
}
export function onHotkeysChanged(fn: () => void) { listeners.add(fn); }

export function comboString(hk: Hotkey): string {
  const order: Modifier[] = ['Mod', 'Ctrl', 'Alt', 'Shift'];
  const mods = order.filter(m => hk.modifiers.includes(m));
  return [...mods, normalizeKey(hk.key)].join('+');
}

function normalizeKey(k: string) {
  if (k.length === 1) return k.toUpperCase();
  return k;
}

export function eventCombo(e: KeyboardEvent): string | null {
  const mods: Modifier[] = [];
  if (isMac) { if (e.metaKey) mods.push('Mod'); if (e.ctrlKey) mods.push('Ctrl'); }
  else { if (e.ctrlKey || e.metaKey) mods.push('Mod'); }
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  let key = e.key;
  if (/^Key[A-Z]$/.test(e.code) && (e.altKey || e.shiftKey)) key = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(key)) return null;
  if (key === ' ') key = 'Space';
  return [...mods, normalizeKey(key)].join('+');
}

export function displayHotkey(hk: Hotkey): string {
  const k = hk.key.length === 1 ? hk.key.toUpperCase() : ({ ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Enter: '↵', Tab: '⇥', Backspace: '⌫', Escape: t('Esc'), Space: t('Leertaste') } as Record<string, string>)[hk.key] ?? hk.key;
  if (isMac) {
    const sym: Record<Modifier, string> = { Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Mod: '⌘' };
    return (['Ctrl', 'Alt', 'Shift', 'Mod'] as Modifier[]).filter(m => hk.modifiers.includes(m)).map(m => sym[m]).join('') + k;
  }
  const name: Record<Modifier, string> = { Mod: t('Strg'), Ctrl: t('Strg'), Alt: 'Alt', Shift: t('Umschalt') };
  return [...hk.modifiers.map(m => name[m]), k].join(' + ');
}

export function hotkeyLabel(id: string) {
  const hk = hotkeysFor(id)[0];
  return hk ? displayHotkey(hk) : '';
}

let rebuildQueued = false;
function scheduleRebuild() {
  if (rebuildQueued) return;
  rebuildQueued = true;
  queueMicrotask(() => { rebuildQueued = false; rebuild(); });
}

function rebuild() {
  comboMap = new Map();
  for (const cmd of commands.values()) {
    for (const hk of hotkeysFor(cmd.id)) {
      comboMap.set(comboString(hk), cmd.id);
      if (isMac && cmd.ctrlAlias && hk.modifiers.includes('Mod') && !hk.modifiers.includes('Ctrl')) {
        comboMap.set(comboString({ modifiers: hk.modifiers.map(m => (m === 'Mod' ? 'Ctrl' : m)) as Modifier[], key: hk.key }), cmd.id);
      }
    }
  }
  // macOS: let the native view deliver these combos reliably (before menus / WebKit)
  const native = [...comboMap.keys()].filter(c => c.includes('Mod') || c.includes('Ctrl'));
  request('hotkeys', { combos: native }).catch(() => {});
}

export function executeCommand(id: string): boolean {
  const cmd = commands.get(id);
  if (!cmd) return false;
  if (cmd.check && !cmd.check()) return false;
  try { cmd.callback(); } catch (e) { console.error('command', id, e); }
  return true;
}

function runCombo(combo: string): boolean {
  const id = comboMap.get(combo);
  if (!id) return false;
  if (isModalOpen() && !id.startsWith('app:')) return false;
  return executeCommand(id);
}

export function initHotkeys() {
  document.addEventListener('keydown', e => {
    if (e.defaultPrevented || e.isComposing) return;
    const combo = eventCombo(e);
    if (!combo || !comboMap.has(combo)) return;
    const target = e.target as HTMLElement;
    const inField = target.matches?.('input, textarea, select, [contenteditable]:not(.cm-content)');
    if (inField && !/Mod|Ctrl|Alt/.test(combo)) return;
    if (runCombo(combo)) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  on('hotkey', (combo: string) => runCombo(combo));
  on('command', (id: string) => executeCommand(id));
}
