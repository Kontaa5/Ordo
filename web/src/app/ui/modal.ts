// Modals in Obsidian's structure: .modal-container > .modal-bg + .modal,
// and the suggestion prompt (.prompt) used by quick switcher & command palette.

import { h, icon } from '../dom';

import { t } from '../i18n';
const stack: Modal[] = [];

export class Modal {
  containerEl: HTMLElement;
  modalEl: HTMLElement;
  titleEl: HTMLElement;
  contentEl: HTMLElement;
  private onKey = (e: KeyboardEvent) => {
    if (stack[stack.length - 1] !== this) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); }
  };

  constructor(cls = '') {
    this.titleEl = h('div', { cls: 'modal-title' });
    this.contentEl = h('div', { cls: 'modal-content' });
    const close = h('div', { cls: 'modal-close-button', 'aria-label': t('Schließen') }, icon('x'));
    close.addEventListener('click', () => this.close());
    this.modalEl = h('div', { cls: 'modal ' + cls }, close, h('div', { cls: 'modal-header' }, this.titleEl), this.contentEl);
    const bg = h('div', { cls: 'modal-bg' });
    bg.addEventListener('click', () => this.close());
    this.containerEl = h('div', { cls: 'modal-container mod-dim' }, bg, this.modalEl);
  }

  setTitle(t: string) { this.titleEl.textContent = t; return this; }

  open() {
    document.body.appendChild(this.containerEl);
    stack.push(this);
    document.addEventListener('keydown', this.onKey, true);
    this.onOpen();
    return this;
  }

  close() {
    const i = stack.indexOf(this);
    if (i >= 0) stack.splice(i, 1);
    document.removeEventListener('keydown', this.onKey, true);
    this.containerEl.remove();
    this.onClose();
  }

  onOpen() {}
  onClose() {}
}

export function isModalOpen() { return stack.length > 0; }

export abstract class SuggestModal<T> extends Modal {
  inputEl: HTMLInputElement;
  resultsEl: HTMLElement;
  instructionsEl: HTMLElement;
  protected items: T[] = [];
  protected selected = 0;
  emptyStateText = t('Keine Treffer.');

  constructor(placeholder: string) {
    super('mod-prompt');
    this.modalEl.classList.add('prompt');
    this.modalEl.replaceChildren();
    this.inputEl = h('input', { cls: 'prompt-input', type: 'text', placeholder, spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off' });
    this.resultsEl = h('div', { cls: 'prompt-results' });
    this.instructionsEl = h('div', { cls: 'prompt-instructions' });
    this.modalEl.append(h('div', { cls: 'prompt-input-container' }, this.inputEl), this.resultsEl, this.instructionsEl);
    this.inputEl.addEventListener('input', () => this.update());
    this.inputEl.addEventListener('keydown', e => this.keydown(e));
  }

  setInstructions(list: [string, string][]) {
    this.instructionsEl.replaceChildren(...list.map(([k, t]) =>
      h('div', { cls: 'prompt-instruction' }, h('span', { cls: 'prompt-instruction-command', text: k }), h('span', { text: t }))));
  }

  abstract getSuggestions(query: string): T[];
  abstract renderSuggestion(item: T, el: HTMLElement): void;
  abstract onChoose(item: T, evt: KeyboardEvent | MouseEvent): void;
  onEmptyEnter?(query: string, evt: KeyboardEvent): void;

  onOpen() {
    this.update();
    setTimeout(() => this.inputEl.focus());
  }

  update() {
    this.items = this.getSuggestions(this.inputEl.value);
    this.selected = 0;
    this.resultsEl.replaceChildren();
    if (!this.items.length) {
      this.resultsEl.appendChild(h('div', { cls: 'suggestion-empty', text: this.emptyStateText }));
      return;
    }
    this.items.forEach((item, i) => {
      const el = h('div', { cls: 'suggestion-item' + (i === 0 ? ' is-selected' : '') });
      this.renderSuggestion(item, el);
      el.addEventListener('mousemove', () => this.setSelected(i, false));
      el.addEventListener('click', e => { this.close(); this.onChoose(item, e); });
      this.resultsEl.appendChild(el);
    });
  }

  setSelected(i: number, scroll = true) {
    const els = this.resultsEl.querySelectorAll('.suggestion-item');
    els[this.selected]?.classList.remove('is-selected');
    this.selected = (i + els.length) % Math.max(1, els.length);
    const el = els[this.selected] as HTMLElement | undefined;
    el?.classList.add('is-selected');
    if (scroll) el?.scrollIntoView({ block: 'nearest' });
  }

  keydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) { e.preventDefault(); this.setSelected(this.selected + 1); }
    else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) { e.preventDefault(); this.setSelected(this.selected - 1); }
    else if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      const item = this.items[this.selected];
      if (item && !e.shiftKey) { this.close(); this.onChoose(item, e); }
      else if (this.onEmptyEnter) { const q = this.inputEl.value; this.close(); this.onEmptyEnter(q, e); }
    }
  }
}

/** Single text input dialog. */
export function promptText(title: string, value = '', placeholder = '', cta = 'OK'): Promise<string | null> {
  return new Promise(resolve => {
    const m = new Modal('mod-prompt-text');
    m.setTitle(title);
    const input = h('input', { type: 'text', value, placeholder, spellcheck: 'false' });
    let done = false;
    const finish = (v: string | null) => { if (done) return; done = true; m.close(); resolve(v); };
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); finish(input.value); } });
    m.contentEl.append(input, h('div', { cls: 'modal-button-container' },
      h('button', { cls: 'mod-cta', text: cta, onclick: () => finish(input.value) }),
      h('button', { text: t('Abbrechen'), onclick: () => finish(null) })));
    m.onClose = () => { if (!done) { done = true; resolve(null); } };
    m.open();
    setTimeout(() => { input.focus(); input.select(); });
  });
}

export function confirmDialog(title: string, message: string, cta = 'OK', warning = false): Promise<boolean> {
  return new Promise(resolve => {
    const m = new Modal();
    m.setTitle(title);
    let done = false;
    const finish = (v: boolean) => { if (done) return; done = true; m.close(); resolve(v); };
    const ok = h('button', { cls: warning ? 'mod-warning' : 'mod-cta', text: cta, onclick: () => finish(true) });
    m.contentEl.append(h('p', { text: message }), h('div', { cls: 'modal-button-container' }, ok, h('button', { text: t('Abbrechen'), onclick: () => finish(false) })));
    m.onClose = () => { if (!done) { done = true; resolve(false); } };
    m.open();
    setTimeout(() => ok.focus());
  });
}
