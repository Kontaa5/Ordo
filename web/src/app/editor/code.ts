// Code block languages + highlighting with Obsidian's token classes
// (cm-keyword, cm-string, …), used by the editor and the reading view.

import { LanguageDescription, LanguageSupport, StreamLanguage, HighlightStyle, Language } from '@codemirror/language';
import { tags as t, highlightCode, tagHighlighter } from '@lezer/highlight';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { java } from '@codemirror/lang-java';
import { cpp } from '@codemirror/lang-cpp';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { sql } from '@codemirror/lang-sql';
import { php } from '@codemirror/lang-php';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { swift } from '@codemirror/legacy-modes/mode/swift';
import { csharp, kotlin, dart, scala } from '@codemirror/legacy-modes/mode/clike';
import { go } from '@codemirror/legacy-modes/mode/go';
import { rust } from '@codemirror/legacy-modes/mode/rust';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { powerShell } from '@codemirror/legacy-modes/mode/powershell';
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile';
import { r } from '@codemirror/legacy-modes/mode/r';
import { lua } from '@codemirror/legacy-modes/mode/lua';

const legacy = (m: any) => new LanguageSupport(StreamLanguage.define(m));

const defs: [string, string[], () => LanguageSupport][] = [
  ['JavaScript', ['javascript', 'js', 'jsx', 'mjs', 'cjs', 'node'], () => javascript({ jsx: true })],
  ['TypeScript', ['typescript', 'ts', 'tsx'], () => javascript({ typescript: true, jsx: true })],
  ['Python', ['python', 'py', 'python3'], python],
  ['Java', ['java'], java],
  ['C++', ['cpp', 'c++', 'c', 'h', 'hpp', 'cc', 'arduino', 'ino'], cpp],
  ['C#', ['csharp', 'cs', 'c#'], () => legacy(csharp)],
  ['HTML', ['html', 'htm', 'vue', 'svelte'], html],
  ['CSS', ['css', 'scss', 'less'], css],
  ['JSON', ['json', 'jsonc', 'json5'], json],
  ['SQL', ['sql', 'mysql', 'postgresql', 'sqlite', 'plsql', 'tsql'], sql],
  ['PHP', ['php'], () => php()],
  ['XML', ['xml', 'svg', 'plist', 'xaml'], xml],
  ['YAML', ['yaml', 'yml'], yaml],
  ['Shell', ['bash', 'sh', 'shell', 'zsh', 'console', 'terminal'], () => legacy(shell)],
  ['PowerShell', ['powershell', 'ps1', 'ps'], () => legacy(powerShell)],
  ['Swift', ['swift'], () => legacy(swift)],
  ['Kotlin', ['kotlin', 'kt'], () => legacy(kotlin)],
  ['Dart', ['dart'], () => legacy(dart)],
  ['Scala', ['scala'], () => legacy(scala)],
  ['Go', ['go', 'golang'], () => legacy(go)],
  ['Rust', ['rust', 'rs'], () => legacy(rust)],
  ['Ruby', ['ruby', 'rb'], () => legacy(ruby)],
  ['Dockerfile', ['dockerfile', 'docker'], () => legacy(dockerFile)],
  ['R', ['r'], () => legacy(r)],
  ['Lua', ['lua'], () => legacy(lua)],
];

const cache = new Map<string, LanguageSupport>();
function support(name: string): LanguageSupport | null {
  const key = name.toLowerCase().trim();
  if (cache.has(key)) return cache.get(key)!;
  const d = defs.find(([, aliases]) => aliases.includes(key));
  if (!d) return null;
  const s = d[2]();
  cache.set(key, s);
  return s;
}

/** For @codemirror/lang-markdown's `codeLanguages`. */
export function codeLanguage(info: string): Language | LanguageDescription | null {
  return support(info.split(/[\s{]/)[0])?.language ?? null;
}

const classes: [any, string][] = [
  [t.keyword, 'cm-keyword'], [[t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword, t.modifier], 'cm-keyword'],
  [[t.string, t.special(t.string), t.regexp, t.character], 'cm-string'],
  [[t.comment, t.lineComment, t.blockComment, t.docComment], 'cm-comment'],
  [[t.number, t.integer, t.float, t.bool, t.null, t.atom], 'cm-number'],
  [[t.function(t.variableName), t.function(t.propertyName), t.macroName], 'cm-def'],
  [[t.definition(t.variableName), t.definition(t.typeName), t.className], 'cm-def'],
  [[t.typeName, t.namespace, t.standard(t.typeName)], 'cm-type'],
  [[t.propertyName, t.attributeName], 'cm-property'],
  [t.variableName, 'cm-variable'],
  [[t.operator, t.derefOperator, t.arithmeticOperator, t.logicOperator, t.compareOperator, t.updateOperator], 'cm-operator'],
  [[t.punctuation, t.bracket, t.separator, t.paren, t.squareBracket, t.brace, t.angleBracket], 'cm-punctuation'],
  [[t.tagName], 'cm-tag'],
  [[t.meta, t.processingInstruction, t.annotation], 'cm-meta'],
  [[t.self, t.special(t.variableName)], 'cm-builtin'],
  [t.invalid, 'cm-error'],
];

export const codeHighlightStyle = HighlightStyle.define(classes.map(([tag, cls]) => ({ tag, class: cls })));
const htmlHighlighter = tagHighlighter(classes.map(([tag, cls]) => ({ tag, class: cls })));

function esc(s: string) { return s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!)); }

/** Static highlighting for reading view / PDF. */
export function highlightToHTML(code: string, lang: string): string {
  const s = support(lang);
  if (!s) return esc(code);
  let out = '';
  try {
    const tree = s.language.parser.parse(code);
    highlightCode(code, tree, htmlHighlighter,
      (text, cls) => { out += cls ? `<span class="${cls}">${esc(text)}</span>` : esc(text); },
      () => { out += '\n'; });
  } catch { return esc(code); }
  return out;
}
