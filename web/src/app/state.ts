// Device-local UI state (not synced).

import { emit } from './host';

function load<T>(key: string, def: T): T {
  try { const v = localStorage.getItem('ordo:' + key); return v == null ? def : JSON.parse(v); } catch { return def; }
}
function store(key: string, v: unknown) { try { localStorage.setItem('ordo:' + key, JSON.stringify(v)); } catch { /* private */ } }

export const appState = {
  get showPageBreaks(): boolean { return load('showPageBreaks', false); },
  set showPageBreaks(v: boolean) { store('showPageBreaks', v); emit('page-breaks-changed'); },
  get spellcheck(): boolean { return load('spellcheck', true); },
  set spellcheck(v: boolean) { store('spellcheck', v); },
};
