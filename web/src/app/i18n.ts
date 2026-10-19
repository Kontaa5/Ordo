// Interface language (Deutsch / English), per device. German strings are the
// keys; `t('Neue Notiz')` returns the English text when English is active.
// Placeholders: t('{n} Dateien', { n: 3 }).

import { EN } from './i18n-en';

export type Lang = 'de' | 'en';

function detect(): Lang {
  try {
    const saved = localStorage.getItem('ordo:lang');
    if (saved === 'de' || saved === 'en') return saved;
  } catch { /* private mode */ }
  return (navigator.language || 'de').toLowerCase().startsWith('de') ? 'de' : 'en';
}

export let lang: Lang = detect();
document.documentElement.lang = lang;

export function setLang(l: Lang) {
  try { localStorage.setItem('ordo:lang', l); } catch { /* ignore */ }
  lang = l;
}

export function t(de: string, vars?: Record<string, string | number>): string {
  let s = lang === 'en' ? EN[de] ?? de : de;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** German plural helper: tn(n, 'Datei', 'Dateien') → "1 Datei" / "3 Dateien". */
export function tn(n: number, one: string, many: string): string {
  return `${n.toLocaleString(lang === 'de' ? 'de-AT' : 'en-US')} ${t(n === 1 ? one : many)}`;
}
