// Empty tab ("Neuer Tab") and image view.

import { View, Leaf, ViewState, registerView } from '../workspace';
import { h, basename } from '../dom';
import { executeCommand, hotkeyLabel } from '../commands';
import { versionedURL } from '../editor/images';
import { openLightbox } from '../../lightbox';
import { openImageEditor } from '../../imageEditor';
import { bumpImage } from '../editor/images';

import { t, tn } from '../i18n';
export class EmptyView extends View {
  getViewType() { return 'empty'; }
  getDisplayText() { return t('Neuer Tab'); }
  getIcon() { return 'file-text'; }
  constructor(leaf: Leaf) {
    super(leaf);
    const action = (label: string, cmd: string) => h('div', { cls: 'empty-state-action tappable', onclick: () => executeCommand(cmd) },
      label, h('span', { cls: 'empty-state-hotkey', text: hotkeyLabel(cmd) ? ` (${hotkeyLabel(cmd)})` : '' }));
    this.contentEl.appendChild(h('div', { cls: 'empty-state' },
      h('div', { cls: 'empty-state-container' },
        h('div', { cls: 'empty-state-title', text: t('Keine Datei geöffnet') }),
        h('div', { cls: 'empty-state-action-list' },
          action(t('Neue Notiz erstellen'), 'file:new-note'),
          action(t('Datei öffnen'), 'switcher:open'),
          action(t('Graph ansehen'), 'graph:open'),
          action(t('Schließen'), 'workspace:close-tab')))));
  }
}

export class ImageView extends View {
  path = '';
  img = h('img', { draggable: 'false' });
  getViewType() { return 'image'; }
  getDisplayText() { return basename(this.path); }
  getIcon() { return 'image'; }
  getState(): ViewState { return { type: 'image', path: this.path }; }
  constructor(leaf: Leaf) {
    super(leaf);
    this.contentEl.appendChild(h('div', { cls: 'image-container' }, this.img));
    this.img.addEventListener('click', () => openLightbox(this.img.src, basename(this.path), () => this.edit()));
    this.addAction('pencil', t('Bild bearbeiten'), () => this.edit());
  }
  edit() {
    openImageEditor(this.path, this.img.src, newPath => {
      bumpImage(newPath);
      this.leaf.setViewState({ type: 'image', path: newPath }, false);
      this.img.src = versionedURL(newPath);
    });
  }
  async setState(s: ViewState) {
    if (s.type !== 'image') return;
    this.path = s.path;
    this.img.src = versionedURL(s.path);
    this.titleEl.replaceChildren(h('div', { cls: 'view-header-title', text: basename(s.path) }));
  }
}

registerView('empty', leaf => new EmptyView(leaf));
registerView('image', leaf => new ImageView(leaf));
