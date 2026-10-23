// Formula menu: pick LaTeX by category with a rendered preview, plus
// autocompletion for \commands while typing inside $…$.

import katex from 'katex';
import type { CompletionContext, Completion } from '@codemirror/autocomplete';
import { EditorView } from '@codemirror/view';
import { Modal } from '../ui/modal';
import { h } from '../dom';

import { t } from '../i18n';
interface Item { name: string; tex: string; snippet?: string }

export const MATH: { title: string; items: Item[] }[] = [
  { title: t('Grundlagen'), items: [
    { name: t('Bruch'), tex: '\\frac{a}{b}', snippet: '\\frac{$0}{}' },
    { name: t('Wurzel'), tex: '\\sqrt{x}', snippet: '\\sqrt{$0}' },
    { name: t('n-te Wurzel'), tex: '\\sqrt[n]{x}', snippet: '\\sqrt[$0]{}' },
    { name: t('Hochzahl'), tex: 'x^{n}', snippet: '^{$0}' },
    { name: t('Index'), tex: 'x_{i}', snippet: '_{$0}' },
    { name: t('Klammern'), tex: '\\left( x \\right)', snippet: '\\left( $0 \\right)' },
    { name: t('Betrag'), tex: '\\lvert x \\rvert', snippet: '\\lvert $0 \\rvert' },
    { name: t('Malpunkt'), tex: 'a \\cdot b', snippet: '\\cdot ' },
    { name: t('Kreuz'), tex: 'a \\times b', snippet: '\\times ' },
    { name: t('Geteilt'), tex: 'a \\div b', snippet: '\\div ' },
    { name: t('Plusminus'), tex: '\\pm', snippet: '\\pm ' },
    { name: t('Prozent'), tex: '50\\,\\%', snippet: '\\%' },
    { name: t('Grad'), tex: '90^\\circ', snippet: '^\\circ' },
    { name: t('Text'), tex: '\\text{Text}', snippet: '\\text{$0}' },
    { name: t('Einheit'), tex: '5\\,\\mathrm{m/s}', snippet: '\\,\\mathrm{$0}' },
    { name: t('Unendlich'), tex: '\\infty', snippet: '\\infty' },
  ] },
  { title: t('Griechisch'), items: [
    'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta', 'theta', 'vartheta', 'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi',
    'pi', 'rho', 'sigma', 'tau', 'upsilon', 'phi', 'varphi', 'chi', 'psi', 'omega', 'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Phi', 'Psi', 'Omega',
  ].map(n => ({ name: n, tex: '\\' + n, snippet: '\\' + n + ' ' })) },
  { title: t('Relationen'), items: [
    [t('gleich'), '='], [t('ungleich'), '\\neq'], [t('ungefähr'), '\\approx'], [t('kleiner gleich'), '\\leq'], [t('größer gleich'), '\\geq'],
    [t('viel kleiner'), '\\ll'], [t('viel größer'), '\\gg'], [t('identisch'), '\\equiv'], [t('proportional'), '\\propto'], [t('ähnlich'), '\\sim'],
    [t('Element von'), '\\in'], [t('kein Element'), '\\notin'], [t('Teilmenge'), '\\subset'], [t('Teilmenge gleich'), '\\subseteq'], [t('senkrecht'), '\\perp'], [t('parallel'), '\\parallel'],
  ].map(([name, tex]) => ({ name, tex, snippet: tex + ' ' })) },
  { title: t('Analysis'), items: [
    { name: t('Summe'), tex: '\\sum_{i=1}^{n} a_i', snippet: '\\sum_{$0}^{}' },
    { name: t('Produkt'), tex: '\\prod_{i=1}^{n} a_i', snippet: '\\prod_{$0}^{}' },
    { name: t('Integral'), tex: '\\int_{a}^{b} f(x)\\,dx', snippet: '\\int_{$0}^{} \\,dx' },
    { name: t('Doppelintegral'), tex: '\\iint_{A} f\\,dA', snippet: '\\iint_{$0} \\,dA' },
    { name: t('Kurvenintegral'), tex: '\\oint_{C} f\\,ds', snippet: '\\oint_{$0} \\,ds' },
    { name: t('Grenzwert'), tex: '\\lim_{x \\to \\infty} f(x)', snippet: '\\lim_{$0 \\to } ' },
    { name: t('Ableitung'), tex: '\\frac{d}{dx} f(x)', snippet: '\\frac{d}{dx} ' },
    { name: t('Partielle Ableitung'), tex: '\\frac{\\partial f}{\\partial x}', snippet: '\\frac{\\partial $0}{\\partial }' },
    { name: t('Strich-Ableitung'), tex: "f'(x)", snippet: "'" },
    { name: t('Nabla'), tex: '\\nabla f', snippet: '\\nabla ' },
    { name: t('Logarithmus'), tex: '\\log_{b}(x)', snippet: '\\log_{$0}' },
    { name: 'ln', tex: '\\ln x', snippet: '\\ln ' },
    { name: 'sin', tex: '\\sin x', snippet: '\\sin ' },
    { name: 'cos', tex: '\\cos x', snippet: '\\cos ' },
    { name: 'tan', tex: '\\tan x', snippet: '\\tan ' },
    { name: t('Fakultät'), tex: 'n!', snippet: '!' },
    { name: t('Binomialkoeffizient'), tex: '\\binom{n}{k}', snippet: '\\binom{$0}{}' },
  ] },
  { title: t('Pfeile'), items: [
    [t('nach'), '\\to'], [t('rechts'), '\\rightarrow'], [t('links'), '\\leftarrow'], [t('folgt'), '\\Rightarrow'], [t('äquivalent'), '\\Leftrightarrow'],
    [t('links-rechts'), '\\leftrightarrow'], [t('abbildung'), '\\mapsto'], [t('hoch'), '\\uparrow'], [t('runter'), '\\downarrow'], [t('Gleichgewicht'), '\\rightleftharpoons'],
  ].map(([name, tex]) => ({ name, tex, snippet: tex + ' ' })) },
  { title: t('Mengen & Logik'), items: [
    [t('natürliche Zahlen'), '\\mathbb{N}'], [t('ganze Zahlen'), '\\mathbb{Z}'], [t('rationale Zahlen'), '\\mathbb{Q}'], [t('reelle Zahlen'), '\\mathbb{R}'], [t('komplexe Zahlen'), '\\mathbb{C}'],
    [t('Vereinigung'), '\\cup'], [t('Schnitt'), '\\cap'], [t('ohne'), '\\setminus'], [t('leere Menge'), '\\emptyset'], [t('für alle'), '\\forall'], [t('es existiert'), '\\exists'],
    [t('nicht'), '\\neg'], [t('und'), '\\land'], [t('oder'), '\\lor'], [t('Menge'), '\\{ x \\mid x > 0 \\}'],
  ].map(([name, tex]) => ({ name, tex, snippet: tex === '\\{ x \\mid x > 0 \\}' ? '\\{ $0 \\mid  \\}' : tex + ' ' })) },
  { title: t('Matrizen & Systeme'), items: [
    { name: t('Matrix ( )'), tex: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', snippet: '\\begin{pmatrix} $0 &  \\\\  &  \\end{pmatrix}' },
    { name: t('Matrix [ ]'), tex: '\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}', snippet: '\\begin{bmatrix} $0 &  \\\\  &  \\end{bmatrix}' },
    { name: t('Determinante'), tex: '\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix}', snippet: '\\begin{vmatrix} $0 &  \\\\  &  \\end{vmatrix}' },
    { name: t('Vektor'), tex: '\\begin{pmatrix} x \\\\ y \\\\ z \\end{pmatrix}', snippet: '\\begin{pmatrix} $0 \\\\  \\\\  \\end{pmatrix}' },
    { name: t('Fallunterscheidung'), tex: 'f(x) = \\begin{cases} 1 & x > 0 \\\\ 0 & \\text{sonst} \\end{cases}', snippet: '\\begin{cases} $0 & \\\\  & \\text{sonst} \\end{cases}' },
    { name: t('Gleichungssystem'), tex: '\\begin{aligned} x + y &= 2 \\\\ x - y &= 0 \\end{aligned}', snippet: '\\begin{aligned} $0 &=  \\\\  &=  \\end{aligned}' },
  ] },
  { title: t('Akzente'), items: [
    { name: t('Vektorpfeil'), tex: '\\vec{v}', snippet: '\\vec{$0}' },
    { name: t('Strecke'), tex: '\\overline{AB}', snippet: '\\overline{$0}' },
    { name: t('Mittelwert'), tex: '\\bar{x}', snippet: '\\bar{$0}' },
    { name: t('Dach'), tex: '\\hat{x}', snippet: '\\hat{$0}' },
    { name: t('Punkt'), tex: '\\dot{x}', snippet: '\\dot{$0}' },
    { name: t('Tilde'), tex: '\\tilde{x}', snippet: '\\tilde{$0}' },
    { name: t('Klammer unten'), tex: '\\underbrace{a+b}_{n}', snippet: '\\underbrace{$0}_{}' },
    { name: t('Fett'), tex: '\\mathbf{F}', snippet: '\\mathbf{$0}' },
    { name: t('Kästchen'), tex: '\\boxed{x=1}', snippet: '\\boxed{$0}' },
  ] },
];

function katexHTML(tex: string, display = false) {
  try { return katex.renderToString(tex, { throwOnError: false, displayMode: display, output: 'html' }); }
  catch { return tex.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!)); }
}

/** Is `pos` inside $…$ or a $$ block? */
export function inMath(view: EditorView | { state: EditorView['state'] }, pos: number): boolean {
  const state = view.state;
  const line = state.doc.lineAt(pos);
  const before = line.text.slice(0, pos - line.from).replace(/\\\$/g, '');
  const dollars = (before.match(/\$/g) ?? []).length;
  if (dollars % 2 === 1) return true;
  // inside a multi-line $$ block?
  let open = false;
  for (let i = 1; i < line.number; i++) if (state.doc.line(i).text.trim() === '$$') open = !open;
  return open;
}

export function insertSnippet(view: EditorView, snippet: string, wrap: 'auto' | 'inline' | 'block' = 'auto') {
  const sel = view.state.selection.main;
  let text = snippet;
  const math = inMath(view, sel.from);
  if (!math) {
    if (wrap === 'block') text = '$$\n' + snippet + '\n$$';
    else text = '$' + snippet + '$';
  }
  const cursor = text.indexOf('$0');
  const insert = text.replace('$0', '');
  const anchor = sel.from + (cursor >= 0 ? cursor : insert.length - (math ? 0 : wrap === 'block' ? 3 : 1));
  view.dispatch({ changes: { from: sel.from, to: sel.to, insert }, selection: { anchor }, scrollIntoView: true });
  view.focus();
}

export class MathPalette extends Modal {
  private search = h('input', { type: 'search', placeholder: t('Formel suchen … (z. B. Bruch, Integral, alpha)'), spellcheck: 'false' });
  private grid = h('div', { cls: 'ordo-math-grid' });
  private preview = h('div', { cls: 'ordo-math-preview' });
  private input = h('textarea', { cls: 'ordo-math-input', rows: '2', placeholder: t('Eigene Formel (LaTeX) – Vorschau erscheint oben'), spellcheck: 'false' });
  private block = h('input', { type: 'checkbox' });

  constructor(private view: EditorView) {
    super('ordo-math-modal');
    this.setTitle(t('Formel einfügen'));
    const insertCustom = () => {
      const tex = this.input.value.trim();
      if (!tex) return;
      this.close();
      insertSnippet(this.view, tex.includes('$0') ? tex : tex + '$0', this.block.checked ? 'block' : 'auto');
    };
    this.input.addEventListener('input', () => { this.preview.innerHTML = this.input.value.trim() ? katexHTML(this.input.value, true) : ''; });
    this.input.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); insertCustom(); } });
    this.search.addEventListener('input', () => this.renderGrid());
    this.contentEl.append(
      this.search,
      this.grid,
      h('div', { cls: 'ordo-math-custom' },
        this.preview, this.input,
        h('div', { cls: 'modal-button-container' },
          h('label', { cls: 'ordo-math-block-toggle' }, this.block, t(' Als eigener Block ($$)')),
          h('button', { cls: 'mod-cta', text: t('Einfügen'), onclick: insertCustom }))));
    this.renderGrid();
  }

  onOpen() { setTimeout(() => this.search.focus()); }

  private renderGrid() {
    const q = this.search.value.trim().toLowerCase();
    this.grid.replaceChildren();
    for (const cat of MATH) {
      const items = cat.items.filter(i => !q || i.name.toLowerCase().includes(q) || i.tex.toLowerCase().includes(q));
      if (!items.length) continue;
      this.grid.appendChild(h('div', { cls: 'ordo-math-category', text: cat.title }));
      const row = h('div', { cls: 'ordo-math-items' });
      for (const it of items) {
        const cell = h('div', { cls: 'ordo-math-item', 'aria-label': it.name, title: `${it.name}  ${it.tex}` });
        cell.innerHTML = katexHTML(it.tex);
        cell.appendChild(h('div', { cls: 'ordo-math-name', text: it.name }));
        cell.addEventListener('click', e => {
          if (e.altKey) { this.input.value += it.snippet?.replace('$0', '') ?? it.tex; this.input.dispatchEvent(new Event('input')); return; }
          this.close();
          insertSnippet(this.view, it.snippet ?? it.tex, this.block.checked ? 'block' : 'auto');
        });
        row.appendChild(cell);
      }
      this.grid.appendChild(row);
    }
  }
}

const COMMANDS: Completion[] = MATH.flatMap(c => c.items)
  .filter(i => /^\\[a-zA-Z]+/.test(i.snippet ?? i.tex))
  .map(i => {
    const snippet = i.snippet ?? i.tex;
    const label = /^\\[a-zA-Z]+/.exec(snippet)![0];
    return {
      label, detail: i.name, type: 'function',
      info: () => { const d = document.createElement('div'); d.className = 'ordo-math-info'; d.innerHTML = katexHTML(i.tex, true); return d; },
      apply: (view: EditorView, _c: Completion, from: number, to: number) => {
        const insert = snippet.replace('$0', '');
        const cur = snippet.indexOf('$0');
        view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + (cur >= 0 ? cur : insert.length) } });
      },
    };
  })
  .filter((c, i, arr) => arr.findIndex(x => x.label === c.label) === i);

/** `\fr…` inside math suggests \frac with a rendered preview. */
export function mathCompletion(ctx: CompletionContext) {
  const m = ctx.matchBefore(/\\[a-zA-Z]*/);
  if (!m || !inMath({ state: ctx.state } as any, ctx.pos)) return null;
  return { from: m.from, options: COMMANDS, validFor: /^\\[a-zA-Z]*$/ };
}
