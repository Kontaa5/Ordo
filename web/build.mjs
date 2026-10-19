import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const out = new URL('../Ordo/Resources/Web/', import.meta.url).pathname;
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(new URL('./public/', import.meta.url).pathname, out, { recursive: true });
const katex = new URL('./node_modules/katex/dist/', import.meta.url).pathname;
cpSync(katex + 'katex.min.css', out + 'katex.min.css');
cpSync(katex + 'fonts', out + 'fonts', { recursive: true, filter: f => !/\.(ttf|woff)$/.test(f) });

await esbuild.build({
  entryPoints: { app: 'src/app/app.ts', export: 'src/export.ts' },
  bundle: true,
  format: 'iife',
  target: ['safari16'],
  minify: !process.argv.includes('--dev'),
  sourcemap: process.argv.includes('--dev') ? 'inline' : false,
  outdir: out,
  logLevel: 'info',
});
