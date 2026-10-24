// Context menus in Obsidian's structure (.menu > .menu-item), so themes style them.

import { h, icon } from '../dom';

export interface MenuItemSpec {
  title: string;
  icon?: string;
  hotkey?: string;
  checked?: boolean;
  disabled?: boolean;
  warning?: boolean;
  onClick?: () => void;
  submenu?: (MenuItemSpec | 'separator')[];
}

let open: Menu | null = null;

export class Menu {
  private items: (MenuItemSpec | 'separator')[] = [];
  private el: HTMLElement | null = null;
  private sub: Menu | null = null;
  private onKey = (e: KeyboardEvent) => this.key(e);
  private onDown = (e: MouseEvent) => { if (this.el && !this.el.contains(e.target as Node) && !this.sub?.el?.contains(e.target as Node)) this.hide(); };
  private selected = -1;
  onHide?: () => void;

  addItem(spec: MenuItemSpec) { this.items.push(spec); return this; }
  addSeparator() { if (this.items.length && this.items[this.items.length - 1] !== 'separator') this.items.push('separator'); return this; }
  get isEmpty() { return this.items.length === 0; }

  showAtMouseEvent(e: MouseEvent) { e.preventDefault(); return this.showAtPosition(e.clientX, e.clientY); }

  showAtElement(el: HTMLElement) {
    const r = el.getBoundingClientRect();
    return this.showAtPosition(r.left, r.bottom + 4);
  }

  /** Opens above the element (e.g. in the status bar), measured, so there is no gap at any font size. */
  showAboveElement(el: HTMLElement, gap = 6) {
    const r = el.getBoundingClientRect();
    this.showAtPosition(r.left, r.top);
    if (this.el) this.el.style.top = Math.max(4, r.top - gap - this.el.offsetHeight) + 'px';
  }

  showAtPosition(x: number, y: number, isSub = false) {
    if (!isSub) { open?.hide(); open = this; }
    while (this.items[this.items.length - 1] === 'separator') this.items.pop();
    const menu = h('div', { cls: 'menu' + (isSub ? ' mod-submenu' : '') });
    const scroller = h('div', { cls: 'menu-scroll' });
    menu.appendChild(scroller);
    this.items.forEach((it, i) => {
      if (it === 'separator') { scroller.appendChild(h('div', { cls: 'menu-separator' })); return; }
      const row = h('div', { cls: 'menu-item tappable' + (it.disabled ? ' is-disabled' : '') + (it.warning ? ' is-warning' : '') + (it.submenu ? ' has-submenu' : '') },
        h('div', { cls: 'menu-item-icon' }, it.checked ? icon('check') : it.icon ? icon(it.icon) : null),
        h('div', { cls: 'menu-item-title', text: it.title }),
        it.hotkey ? h('div', { cls: 'menu-item-hotkey', text: it.hotkey }) : null,
        it.submenu ? h('div', { cls: 'menu-item-icon mod-submenu' }, icon('chevron-right')) : null,
      );
      row.dataset.index = String(i);
      row.addEventListener('mouseenter', () => { this.select(i); if (it.submenu) this.openSub(it, row); else this.closeSub(); });
      row.addEventListener('click', e => {
        e.stopPropagation();
        if (it.disabled) return;
        if (it.submenu) { this.openSub(it, row); return; }
        this.hide();
        it.onClick?.();
      });
      scroller.appendChild(row);
    });
    document.body.appendChild(menu);
    this.el = menu;
    const r = menu.getBoundingClientRect();
    const px = Math.max(4, Math.min(x, window.innerWidth - r.width - 4));
    const py = y + r.height > window.innerHeight - 4 ? Math.max(4, y - r.height) : y;
    menu.style.left = px + 'px';
    menu.style.top = py + 'px';
    if (!isSub) {
      setTimeout(() => {
        document.addEventListener('mousedown', this.onDown, true);
        document.addEventListener('keydown', this.onKey, true);
      });
      window.addEventListener('blur', () => this.hide(), { once: true });
    }
    return this;
  }

  private openSub(it: MenuItemSpec, row: HTMLElement) {
    this.closeSub();
    const m = new Menu();
    for (const s of it.submenu!) s === 'separator' ? m.addSeparator() : m.addItem(s);
    const r = row.getBoundingClientRect();
    m.showAtPosition(r.right - 4, r.top - 4, true);
    m.parent = this;
    this.sub = m;
  }
  parent: Menu | null = null;
  private closeSub() { this.sub?.hideSelf(); this.sub = null; }

  private select(i: number) {
    this.selected = i;
    this.el?.querySelectorAll('.menu-item').forEach(r => r.classList.toggle('selected', (r as HTMLElement).dataset.index === String(i)));
  }

  private key(e: KeyboardEvent) {
    const idx = this.items.map((it, i) => (it !== 'separator' && !it.disabled ? i : -1)).filter(i => i >= 0);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.hide(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); e.stopPropagation();
      const pos = idx.indexOf(this.selected);
      const next = e.key === 'ArrowDown' ? idx[(pos + 1) % idx.length] : idx[(pos - 1 + idx.length) % idx.length];
      this.select(next);
    } else if (e.key === 'Enter' && this.selected >= 0) {
      e.preventDefault(); e.stopPropagation();
      const it = this.items[this.selected] as MenuItemSpec;
      this.hide();
      it.onClick?.();
    }
  }

  private hideSelf() { this.closeSub(); this.el?.remove(); this.el = null; }

  hide() {
    if (this.parent) { this.parent.hide(); return; }
    this.hideSelf();
    document.removeEventListener('mousedown', this.onDown, true);
    document.removeEventListener('keydown', this.onKey, true);
    if (open === this) open = null;
    this.onHide?.();
  }
}

