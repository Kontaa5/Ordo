import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, rmSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';

const out = new URL('../Ordo/Resources/Web/', import.meta.url).pathname;
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(new URL('./public/', import.meta.url).pathname, out, { recursive: true });
const katex = new URL('./node_modules/katex/dist/', import.meta.url).pathname;
cpSync(katex + 'katex.min.css', out + 'katex.min.css');
cpSync(katex + 'fonts', out + 'fonts', { recursive: true, filter: f => !/\.(ttf|woff)$/.test(f) });

const result = await esbuild.build({
  entryPoints: { app: 'src/app/app.ts', export: 'src/export.ts' },
  bundle: true,
  format: 'iife',
  target: ['safari16'],
  minify: !process.argv.includes('--dev'),
  sourcemap: process.argv.includes('--dev') ? 'inline' : false,
  outdir: out,
  logLevel: 'info',
  metafile: true,
});

// licence texts of every package that ends up in the bundle (MIT/ISC/Apache ask for it)
const pkgs = new Set(Object.keys(result.metafile.inputs).map(f => /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(f)?.[1]).filter(Boolean));
pkgs.add('katex');   // its CSS and fonts are copied as files
const notice = [...pkgs].sort().map(name => {
  const dir = `node_modules/${name}/`;
  const pkg = JSON.parse(readFileSync(dir + 'package.json', 'utf8'));
  const file = readdirSync(dir).find(f => /^(licen[cs]e|copying)(\.|$)/i.test(f));
  const text = file ? readFileSync(dir + file, 'utf8').trim() : `License: ${pkg.license}`;
  return `${name} ${pkg.version} (${pkg.license})\n${'-'.repeat(60)}\n${text}\n`;
}).join('\n\n') + `\n\nPhosphor Icons (MIT) – icon paths in src/app/icons.ts
${'-'.repeat(60)}
MIT License

Copyright (c) 2023 Phosphor Icons

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
`;
writeFileSync(out + 'THIRD-PARTY-LICENSES.txt', `Ordo bundles the following open source software.\n\n${notice}`);
writeFileSync('../THIRD-PARTY-LICENSES.txt', `Ordo bundles the following open source software.\n\n${notice}`);
