// "Bilder verkleinern": pictures are stored smaller in the same format (file
// names and links stay). Before/after shows pixels, file size and how sharp the
// picture still prints over the full text width, so nothing gets blurry by accident.

import { Modal } from '../ui/modal';
import { h, basename } from '../dom';
import { request, emit } from '../host';
import { notice } from '../ui/notice';
import { bumpImage, versionedURL } from '../editor/images';
import { vault } from '../store';

import { t, tn } from '../i18n';

interface PlanItem { path: string; old: number; new: number; w0: number; h0: number; w1: number; h1: number }

const mb = (bytes: number) => (bytes / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' MB';
const AUTO = -1;
const KEEP = 0;
// target print sharpness in dpi (AUTO = 300); KEEP only stores it more compactly
const DPIS: [number, string][] = [[AUTO, 'Automatisch – 300 dpi, druckscharf'], [KEEP, 'Auflösung behalten (nur komprimieren)'], [200, '200 dpi'], [150, '150 dpi'], [100, '100 dpi']];

/** Printable text width in inches (export page settings). */
function textWidthIn() {
  const page = vault.settings?.page;
  const paperMm = page?.paper === 'a5' ? 148 : page?.paper === 'letter' ? 216 : 210;
  const widthMm = (page?.landscape ? (page?.paper === 'a5' ? 210 : 297) : paperMm) - 2 * (page?.marginMM ?? 20);
  return widthMm / 25.4;
}
function sharpness(dpi: number): [string, string] {
  return dpi >= 290 ? [t('scharf'), 'is-good'] : dpi >= 150 ? [t('gut'), 'is-ok'] : [t('unscharf beim Drucken'), 'is-bad'];
}

export class CompressImagesModal extends Modal {
  private dpi = AUTO;   // default: only as small as stays sharp in print
  /** share: part of the text width the picture fills in the note (a big photo shown small prints small, so its dpi is high). */
  constructor(private paths?: string[], private share = 1, private pixels = 0) {
    super('ordo-sort-all');
    this.setTitle(paths?.length === 1 ? t('Komprimieren') : t('Große Bilder verkleinern'));
  }
  /** printed width in inches: as wide as in the note, measured on the text width of the export page */
  private printIn() { return textWidthIn() * (this.share > 0 ? this.share : 1); }
  private printDpi(px: number) { return Math.round(px / this.printIn()); }

  async onOpen() { await this.load(); }

  private async load() {
    const sizeSel = h('select', { cls: 'dropdown' }, ...DPIS.map(([v, l]) => h('option', { value: String(v), text: t(l) }))) as HTMLSelectElement;
    sizeSel.value = String(this.dpi);
    sizeSel.addEventListener('change', () => { this.dpi = +sizeSel.value; this.load(); });
    const head = h('div', { cls: 'ordo-compress-head' }, h('span', { text: t('Ziel') }), sizeSel);
    if (this.pixels > 0) head.appendChild(h('span', { cls: 'ordo-compress-hint', text: t('Aktuell: {d} dpi ({px} px, so breit wie in der Notiz gedruckt)', { d: this.printDpi(this.pixels), px: this.pixels }) }));
    if (this.dpi === AUTO) head.appendChild(h('span', { cls: 'ordo-compress-hint', text: t('Verkleinert nur so weit, dass das Bild in seiner Größe in der Notiz gedruckt noch scharf ist (300 dpi). Kleinere Bilder werden nur platzsparender gespeichert.') }));
    this.contentEl.replaceChildren(head, h('div', { cls: 'setting-item-description', text: this.paths ? t('Berechne …') : t('Suche Bilder über 1 MB …') }));
    // automatic: scale down only to the width that still prints at 300 dpi across the text width; never below
    const dpi = this.dpi === AUTO ? 300 : this.dpi;
    const size = this.dpi === KEEP ? { maxDim: 0 } : { maxDim: 0, targetWidth: Math.ceil(dpi * this.printIn()) };
    const plan = await request<PlanItem[]>('compressPlan', { ...size, ...(this.paths ? { paths: this.paths } : {}) }).catch(() => []);
    if (!plan.length) {
      this.contentEl.replaceChildren(head, h('p', { text: this.paths ? (this.dpi === AUTO ? t('Das Bild ist schon so klein, dass es ohne Qualitätsverlust nicht weiter geht.') : t('Mit dieser Größe wird das Bild kaum kleiner – nichts zu tun.')) : t('Keine großen Bilder gefunden, die sich verkleinern lassen.') }),
        h('div', { cls: 'modal-button-container' }, h('button', { cls: 'mod-cta', text: 'OK', onclick: () => this.close() })));
      return;
    }
    const boxes: HTMLInputElement[] = [];
    const count = h('div', { cls: 'setting-item-description' });
    const update = () => {
      const sel = plan.filter((_, i) => boxes[i].checked);
      const before = sel.reduce((s, p) => s + p.old, 0), after = sel.reduce((s, p) => s + p.new, 0);
      count.textContent = tn(sel.length, 'Bild', 'Bilder') + ': ' + t('{a} → {b}. Dateinamen und Links bleiben gleich.', { a: mb(before), b: mb(after) });
    };
    const list = h('div', { cls: 'ordo-sort-list' }, ...plan.map(item => {
      const d0 = this.printDpi(item.w0), d1 = this.printDpi(item.w1);
      const [label, cls] = sharpness(d1);
      // blurry after shrinking → unticked, so it only happens on purpose
      const cb = h('input', { type: 'checkbox', checked: d1 >= 150 || d1 >= d0 });
      cb.addEventListener('change', update);
      boxes.push(cb);
      return h('label', { cls: 'ordo-sort-row ordo-compress-row' }, cb,
        h('img', { cls: 'ordo-compress-thumb', src: versionedURL(item.path), loading: 'lazy', decoding: 'async' }),
        h('div', {},
          h('div', { text: basename(item.path) }),
          h('div', { cls: 'setting-item-description', text: `${item.w0} × ${item.h0}  →  ${item.w1} × ${item.h1} px  ·  ${mb(item.old)}  →  ${mb(item.new)}` }),
          h('div', { cls: 'setting-item-description' }, t('Druck: {a} → {b} dpi', { a: d0, b: d1 }), ' ', h('span', { cls: 'ordo-sharpness ' + cls, text: label }))));
    }));
    update();
    this.contentEl.replaceChildren(head, count, list, h('div', { cls: 'modal-button-container' },
      h('button', { text: t('Abbrechen'), onclick: () => this.close() }),
      h('button', {
        cls: 'mod-cta', text: t('Komprimieren'), onclick: async () => {
          const paths = plan.filter((_, i) => boxes[i].checked).map(p => p.path);
          if (!paths.length) { this.close(); return; }
          await request('applyCompress', { paths });
          paths.forEach(bumpImage);
          emit('images-changed');
          this.close();
          notice(tn(paths.length, 'Bild verkleinert.', 'Bilder verkleinert.'));
        },
      })));
  }
}
