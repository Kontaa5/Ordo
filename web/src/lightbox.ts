import { t } from './app/i18n';
// Full-size image viewer: pinch / wheel to zoom, drag to pan, Esc or tap to close.

export function openLightbox(src: string, caption = '', onEdit?: () => void) {
  const overlay = document.createElement('div');
  overlay.className = 'lightbox';
  overlay.innerHTML = `
    <div class="lightbox-bar">
      <span class="lightbox-caption"></span>
      <span class="lightbox-actions">
        ${onEdit ? `<button data-act="edit" title="${t('Bearbeiten')}">${t('Bearbeiten')}</button>` : ''}
        <button data-act="fit" title="${t('Einpassen')}">${t('Einpassen')}</button>
        <button data-act="close" title="${t('Schließen')}">✕</button>
      </span>
    </div>
    <div class="lightbox-stage"><img draggable="false"></div>`;
  (overlay.querySelector('.lightbox-caption') as HTMLElement).textContent = caption;
  const img = overlay.querySelector('img')!;
  const stage = overlay.querySelector('.lightbox-stage') as HTMLElement;
  img.src = src;

  let scale = 1, x = 0, y = 0;
  const apply = () => { img.style.transform = `translate(${x}px, ${y}px) scale(${scale})`; };
  const reset = () => { scale = 1; x = 0; y = 0; apply(); };

  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);

  overlay.addEventListener('click', e => {
    const act = (e.target as HTMLElement).closest('button')?.dataset.act;
    if (act === 'close') close();
    else if (act === 'fit') reset();
    else if (act === 'edit') { close(); onEdit?.(); }
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
