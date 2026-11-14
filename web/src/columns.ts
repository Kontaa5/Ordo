// Columns written so Obsidian ignores the layout: the markers are Obsidian comments (%%…%%), the text in
// between shows there as normal paragraphs one below the other. Ordo puts the parts side by side.
//
//   %%columns%%
//   left column …
//   %%column%%
//   right column …
//   %%/columns%%

export const COL_START = /^%%\s*columns\s*%%\s*$/i;
export const COL_SEP = /^%%\s*column\s*%%\s*$/i;
export const COL_END = /^%%\s*\/columns\s*%%\s*$/i;

/** Text for a columns block made of these parts. */
export function makeColumns(parts: string[]): string {
  return `%%columns%%\n${parts.map(p => p.trim()).join('\n%%column%%\n')}\n%%/columns%%`;
}

/** The parts of a columns block (text from %%columns%% to %%/columns%%), with the line each part starts on (0-based, relative). */
export function splitColumns(text: string): { text: string; line: number }[] {
  const lines = text.split('\n');
  const parts: { text: string; line: number }[] = [];
  let cur: string[] = [], start = 1;
  for (let i = 1; i < lines.length; i++) {
    if (COL_END.test(lines[i])) break;
    if (COL_SEP.test(lines[i])) { parts.push({ text: cur.join('\n'), line: start }); cur = []; start = i + 1; continue; }
    cur.push(lines[i]);
  }
  parts.push({ text: cur.join('\n'), line: start });
  return parts;
}
