import { t } from './app/i18n';
// Full-size image viewer: pinch / wheel to zoom, drag to pan, Esc or tap to close.
// With a gallery (all pictures of a note) ‹ › and the arrow keys step through them.

export interface LightboxItem { src: string; caption: string; onEdit?: () => void }

export function openLightbox(src: string, caption = '', onEdit?: () => void, gallery?: { items: LightboxItem[]; index: number }) {
  const items: LightboxItem[] = gallery && gallery.items.length ? gallery.items : [{ src, caption, onEdit }];
  let index = gallery && gallery.items.length ? Math.max(0, Math.min(items.length - 1, gallery.index)) : 0;
  const many = items.length > 1;
  const overlay = document.createElement('div');
  overlay.className = 'lightbox';
  overlay.innerHTML = `
    <div class="lightbox-bar">
      <span class="lightbox-caption"></span>
      <span class="lightbox-actions">
        <button data-act="edit" title="${t('Bearbeiten')}">${t('Bearbeiten')}</button>
        <button data-act="fit" title="${t('Einpassen')}">${t('Einpassen')}</button>
        <button data-act="close" title="${t('Schließen')}">✕</button>
      </span>
    </div>
    <div class="lightbox-stage"><img draggable="false"></div>
    ${many ? `<button class="lightbox-nav is-prev" data-act="prev" title="${t('Vorheriges Bild')}">‹</button><button class="lightbox-nav is-next" data-act="next" title="${t('Nächstes Bild')}">›</button>` : ''}`;
  const captionEl = overlay.querySelector('.lightbox-caption') as HTMLElement;
  const editBtn = overlay.querySelector('[data-act="edit"]') as HTMLElement;
  const img = overlay.querySelector('img')!;
  const stage = overlay.querySelector('.lightbox-stage') as HTMLElement;

  let scale = 1, x = 0, y = 0;
  const apply = () => { img.style.transform = `translate(${x}px, ${y}px) scale(${scale})`; };
  const reset = () => { scale = 1; x = 0; y = 0; apply(); };
  const show = (i: number) => {
    index = (i + items.length) % items.length;
    const it = items[index];
    img.src = it.src;
    captionEl.textContent = many ? `${it.caption}  ·  ${index + 1} / ${items.length}` : it.caption;
    editBtn.style.display = it.onEdit ? '' : 'none';
    reset();
  };
  show(index);

  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (many && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); e.stopPropagation(); show(index + (e.key === 'ArrowLeft' ? -1 : 1)); }
  };
  document.addEventListener('keydown', onKey, true);

  overlay.addEventListener('click', e => {
    const act = (e.target as HTMLElement).closest('button')?.dataset.act;
    if (act === 'close') close();
    else if (act === 'fit') reset();
    else if (act === 'edit') { const fn = items[index].onEdit; close(); fn?.(); }
    else if (act === 'prev') show(index - 1);
    else if (act === 'next') show(index + 1);
    else if (e.target === stage) close();
  });

  stage.addEventListener('wheel', e => {
    e.preventDefault();
    const f = Math.exp(-e.deltaY * 0.0025);
    scale = Math.min(12, Math.max(0.2, scale * f));
    apply();
  }, { passive: false });

  img.addEventListener('dblclick', () => { if (scale > 1.01) reset(); else { scale = 2.5; apply(); } });

  const pointers = new Map<number, { x: number; y: number }>();
  let pinchDist = 0, pinchScale = 1;
  img.addEventListener('pointerdown', e => {
    img.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y); pinchScale = scale;
    }
  });
  img.addEventListener('pointermove', e => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      scale = Math.min(12, Math.max(0.2, pinchScale * Math.hypot(a.x - b.x, a.y - b.y) / (pinchDist || 1)));
    } else {
      x += e.clientX - prev.x; y += e.clientY - prev.y;
    }
    apply();
  });
  const up = (e: PointerEvent) => { pointers.delete(e.pointerId); };
  img.addEventListener('pointerup', up);
  img.addEventListener('pointercancel', up);

  document.body.appendChild(overlay);
}
