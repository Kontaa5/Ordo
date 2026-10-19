// Image editor, focused on cropping: the crop frame is active right away and
// covers the whole picture; drag its corners or move it. Rotate and an aspect
// ratio are the only extras. Saving overwrites the file or writes a copy.

import { request, blobToBase64 } from './bridge';
import { ICONS } from './app/icons';
import { vault } from './app/store';

import { t } from './app/i18n';
type Aspect = number | null;

const ico = (name: string) => `<svg viewBox="0 0 256 256" fill="currentColor" class="svg-icon">${ICONS[name] ?? ''}</svg>`;

/** Notes that embed this picture. */
function notesUsing(path: string): string[] {
  const out: string[] = [];
  for (const n of vault.notes.values()) if (n.embeds.some(e => vault.resolve(e.split('|')[0].split('#')[0], n.path) === path)) out.push(n.path);
  return out;
}

export function openImageEditor(path: string, src: string, onSaved: (newPath: string, copy: boolean) => void) {
  if (document.querySelector('body > .img-editor')) return;   // never two editors on top of each other
  // default: crop the original. Used by several notes → keep the original for the others and save a copy.
  const users = notesUsing(path).length;
  const shared = users > 1;
  const overlay = document.createElement('div');
  overlay.className = 'img-editor';
  overlay.innerHTML = `
    <div class="ie-bar">
      <div class="ie-group">
        <button data-act="rotl" class="ie-icon" title="${t('Links drehen')}" aria-label="${t('Links drehen')}">${ico('undo')}</button>
        <select data-role="aspect" title="${t('Seitenverhältnis')}">
          <option value="">${t('Frei')}</option><option value="1">1:1</option><option value="1.3333">4:3</option>
          <option value="0.75">3:4</option><option value="1.7778">16:9</option><option value="0.5625">9:16</option>
        </select>
        <button data-act="reset">${t('Zurücksetzen')}</button>
      </div>
      <div class="ie-group">
        <button data-act="cancel">${t('Abbrechen')}</button>
        <button data-act="${shared ? 'save' : 'copy'}">${shared ? t('Original überschreiben') : t('Als Kopie')}</button>
        <button data-act="${shared ? 'copy' : 'save'}" class="primary" title="Enter">${shared ? t('Als Kopie speichern') : t('Speichern')}</button>
      </div>
    </div>
    <div class="ie-stage"><canvas></canvas><div class="ie-dim"></div><div class="ie-dim"></div><div class="ie-dim"></div><div class="ie-dim"></div><div class="ie-crop">
      <span data-h="nw"></span><span data-h="ne"></span><span data-h="sw"></span><span data-h="se"></span>
    </div></div>
    <div class="ie-status"></div>`;
  document.body.appendChild(overlay);

  const view = overlay.querySelector('canvas')!;
  const stage = overlay.querySelector('.ie-stage') as HTMLElement;
  const cropBox = overlay.querySelector('.ie-crop') as HTMLElement;
  const dims = [...overlay.querySelectorAll<HTMLElement>('.ie-dim')];
  const aspectSel = overlay.querySelector('[data-role=aspect]') as HTMLSelectElement;
  const status = overlay.querySelector('.ie-status') as HTMLElement;

  let original: HTMLCanvasElement | null = null;
  let work: HTMLCanvasElement = document.createElement('canvas');
  let crop = { x: 0, y: 0, w: 0, h: 0 }; // in display pixels
  let disp = { scale: 1, ox: 0, oy: 0 };
  let busy = false;
  const mime = /\.png$/i.test(path) ? 'image/png' : /\.webp$/i.test(path) ? 'image/webp' : 'image/jpeg';

  const img = new Image();
  img.onload = () => {
    work.width = img.naturalWidth; work.height = img.naturalHeight;
    work.getContext('2d')!.drawImage(img, 0, 0);
    original = copyOf(work);
    draw(); fullCrop();
  };
  img.onerror = () => { status.textContent = t('Bild konnte nicht geladen werden.'); };
  img.src = src;

  function blank(w: number, h: number) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function copyOf(c: HTMLCanvasElement) { const n = blank(c.width, c.height); n.getContext('2d')!.drawImage(c, 0, 0); return n; }

  function draw() {
    const sw = stage.clientWidth - 48, sh = stage.clientHeight - 48;
    const s = Math.min(1, sw / work.width, sh / work.height);
    const dpr = window.devicePixelRatio || 1;
    view.width = Math.round(work.width * s * dpr); view.height = Math.round(work.height * s * dpr);
    view.style.width = work.width * s + 'px'; view.style.height = work.height * s + 'px';
    const ctx = view.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(work, 0, 0, view.width, view.height);
    const r = view.getBoundingClientRect(), sr = stage.getBoundingClientRect();
    const old = disp.scale;
    disp = { scale: s, ox: r.left - sr.left, oy: r.top - sr.top };
    if (old !== s && crop.w) { const f = s / old; crop = { x: crop.x * f, y: crop.y * f, w: crop.w * f, h: crop.h * f }; }
    layoutCrop();
  }

  const W = () => work.width * disp.scale, H = () => work.height * disp.scale;
  function fullCrop() { crop = { x: 0, y: 0, w: W(), h: H() }; constrain(); layoutCrop(); }
  const isFull = () => crop.x < 1 && crop.y < 1 && crop.w > W() - 1 && crop.h > H() - 1;

  function rotate() {
    const c = blank(work.height, work.width);
    const ctx = c.getContext('2d')!;
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(work, -work.width / 2, -work.height / 2);
    work = c; draw(); fullCrop();
  }

  // ----- crop frame -----
  const aspect = (): Aspect => aspectSel.value ? +aspectSel.value : null;
  function constrain(anchor?: string) {
    const a = aspect();
    if (a) {
      if (crop.w / crop.h > a) crop.w = crop.h * a; else crop.h = crop.w / a;
      if (anchor?.includes('w')) crop.x = Math.min(crop.x, W() - crop.w);
    }
    crop.w = Math.max(16, Math.min(crop.w, W())); crop.h = Math.max(16, Math.min(crop.h, H()));
    crop.x = Math.max(0, Math.min(crop.x, W() - crop.w)); crop.y = Math.max(0, Math.min(crop.y, H() - crop.h));
  }
  // the frame is positioned with transforms and the darkening is four plain boxes:
  // no layout, no huge shadow to repaint while dragging
  function layoutCrop() {
    const x = disp.ox + crop.x, y = disp.oy + crop.y, iw = W(), ih = H();
    cropBox.style.transform = `translate(${x}px, ${y}px)`;
    cropBox.style.width = crop.w + 'px'; cropBox.style.height = crop.h + 'px';
    const box = (el: HTMLElement, l: number, t: number, w: number, h: number) => { el.style.transform = `translate(${l}px, ${t}px)`; el.style.width = Math.max(0, w) + 'px'; el.style.height = Math.max(0, h) + 'px'; };
    box(dims[0], disp.ox, disp.oy, iw, crop.y);                                         // above
    box(dims[1], disp.ox, y + crop.h, iw, ih - crop.y - crop.h);                         // below
    box(dims[2], disp.ox, y, crop.x, crop.h);                                            // left
    box(dims[3], x + crop.w, y, iw - crop.x - crop.w, crop.h);                           // right
    const s = disp.scale || 1;
    status.textContent = isFull() ? `${work.width} × ${work.height} px`
      : `${work.width} × ${work.height} px  →  ${Math.round(crop.w / s)} × ${Math.round(crop.h / s)} px`;
    if (shared) status.textContent += '   ·   ' + t('In {n} Notizen verwendet – wird als Kopie gespeichert', { n: users });
  }
  aspectSel.addEventListener('change', () => {
    // centre the new ratio in the current frame
    const cx = crop.x + crop.w / 2, cy = crop.y + crop.h / 2;
    constrain();
    crop.x = cx - crop.w / 2; crop.y = cy - crop.h / 2;
    constrain(); layoutCrop();
  });

  let drag: { mode: string; sx: number; sy: number; c: typeof crop } | null = null;
  let frame = 0;
  cropBox.addEventListener('pointerdown', e => {
    e.preventDefault();
    try { cropBox.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    drag = { mode: (e.target as HTMLElement).dataset.h ?? 'move', sx: e.clientX, sy: e.clientY, c: { ...crop } };
  });
  cropBox.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy, c = drag.c;
    if (drag.mode === 'move') { crop.x = c.x + dx; crop.y = c.y + dy; }
    else {
      const m = drag.mode;
      let { x, y, w, h } = c;
      if (m.includes('e')) w = c.w + dx;
      if (m.includes('s')) h = c.h + dy;
      if (m.includes('w')) { x = c.x + dx; w = c.w - dx; }
      if (m.includes('n')) { y = c.y + dy; h = c.h - dy; }
      const a = aspect();
      if (a) { h = w / a; if (m.includes('n')) y = c.y + c.h - h; }
      crop = { x, y, w, h };
    }
    constrain(drag.mode);
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; layoutCrop(); });   // at most once per screen refresh
  });
  const endDrag = () => { drag = null; };
  cropBox.addEventListener('pointerup', endDrag);
  cropBox.addEventListener('pointercancel', endDrag);

  function cropped(): HTMLCanvasElement {
    if (isFull()) return work;
    const s = disp.scale;
    const sx = Math.round(crop.x / s), sy = Math.round(crop.y / s);
    const sw = Math.round(crop.w / s), sh = Math.round(crop.h / s);
    const c = blank(sw, sh);
    c.getContext('2d')!.drawImage(work, sx, sy, sw, sh, 0, 0, sw, sh);
    return c;
  }

  async function save(copy: boolean) {
    if (busy) return;
    busy = true;
    status.textContent = t('Speichere …');
    const out = cropped();
    const outMime = mime === 'image/png' || mime === 'image/webp' ? mime : 'image/jpeg';
    const blob: Blob | null = await new Promise(r => out.toBlob(r, outMime, 0.92));
    if (!blob) { status.textContent = t('Konnte Bild nicht erzeugen.'); busy = false; return; }
    try {
      const data = await blobToBase64(blob);
      const res = await request<{ path: string }>({ type: 'saveImage', path, data, mime: outMime, copy });
      close();
      onSaved(res.path, copy);
    } catch (err) {
      status.textContent = t('Fehler beim Speichern: ') + err;
      busy = false;
    }
  }

  const close = () => { ro.disconnect(); overlay.remove(); window.removeEventListener('resize', draw); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); save(shared); }   // Enter = the highlighted button
  };
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', draw);
  // the stage can change size after the first draw (status line, toolbar wrap): keep the frame on the picture
  let stageSize = '';
  const ro = new ResizeObserver(() => {
    const size = stage.clientWidth + 'x' + stage.clientHeight;
    if (size !== stageSize && work.width) { stageSize = size; draw(); }
  });
  ro.observe(stage);

  // pointerdown, not click: a button reacts even if the pointer moves a little while pressed
  overlay.querySelector('.ie-bar')!.addEventListener('pointerdown', e => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    e.preventDefault();
    switch (b.dataset.act) {
      case 'rotl': rotate(); break;
      case 'reset': if (original) { work = copyOf(original); aspectSel.value = ''; draw(); fullCrop(); } break;
      case 'cancel': close(); break;
      case 'save': save(false); break;
      case 'copy': save(true); break;
    }
  });
}
