// Page-break markers in the editor ("Seite 2"). They come from the same
// paginator as the PDF export; dragging one upwards inserts a \\pagebreak.

import { Range, StateEffect, StateField } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, WidgetType } from '@codemirror/view';


import { t } from '../i18n';
export const setPageBreaks = StateEffect.define<{ line: number; page: number }[]>();

class PageBreakWidget extends WidgetType {
  constructor(readonly page: number) { super(); }
  eq(o: PageBreakWidget) { return o.page === this.page; }
  toDOM(view: EditorView) {
    const d = document.createElement('div');
    d.className = 'cm-page-break';
    d.innerHTML = `<span>${t('Seite {n}', { n: this.page })}</span>`;
    d.title = t('Nach oben ziehen, um die Seite früher umzubrechen');
    d.addEventListener('pointerdown', e => {
      e.preventDefault();
      d.setPointerCapture(e.pointerId);
      const ghost = document.createElement('div');
      ghost.className = 'cm-page-break-ghost';
      document.body.appendChild(ghost);
      const content = view.contentDOM.getBoundingClientRect();
      const place = (y: number) => {
        const pos = view.posAtCoords({ x: content.left + 4, y });
        if (pos == null) return null;
        const line = view.state.doc.lineAt(pos);
        const top = view.coordsAtPos(line.from)?.top ?? y;
        Object.assign(ghost.style, { top: top - 2 + 'px', left: content.left + 'px', width: content.width + 'px' });
        return line;
      };
      place(e.clientY);
      const move = (ev: PointerEvent) => place(ev.clientY);
      const up = (ev: PointerEvent) => {
        d.removeEventListener('pointermove', move);
        d.removeEventListener('pointerup', up);
        ghost.remove();
        const line = place(ev.clientY);
        if (!line || Math.abs(ev.clientY - e.clientY) < 6 || line.number <= 1) return;
        view.dispatch({ changes: { from: line.from, insert: '\\pagebreak\n' }, userEvent: 'input.pagebreak' });
      };
      d.addEventListener('pointermove', move);
      d.addEventListener('pointerup', up);
    });
    return d;
  }
  ignoreEvent() { return true; }
}

export const pageBreakField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setPageBreaks)) continue;
      const decos: Range<Decoration>[] = [];
      for (const { line, page } of e.value) {
        if (line < 0 || line >= tr.state.doc.lines) continue;
        const pos = tr.state.doc.line(line + 1).from;
        decos.push(Decoration.widget({ widget: new PageBreakWidget(page), block: true, side: -1 }).range(pos));
      }
      deco = Decoration.set(decos, true);
    }
    return deco;
  },
  provide: f => EditorView.decorations.from(f),
});

