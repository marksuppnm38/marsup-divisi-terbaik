// scripts/build.mjs
// ══════════════════════════════════════════
// Production-only build. Runs on Vercel (npm run build) via vercel.json's
// buildCommand. NEVER needed for local dev -- keep editing files directly
// and serving the repo root as-is (see serve.json), exactly like before.
//
// What it does, on purpose and nothing more:
//   1. Walks the repo, skipping dev-only folders/files (docs, tooling
//      scripts, console snippets, config that isn't part of the served
//      app).
//   2. Every .js file found is run through esbuild's per-file `transform`
//      (NOT `build`/bundle) -- this only minifies + mangles local names +
//      strips comments inside that one file. It does NOT resolve or touch
//      import specifiers, so the existing relative ESM import graph
//      (app/router.js -> app/pages/*/index.js -> ... , and the
//      /shared/*.js classic-<script> paths loaded by string) stays byte-
//      for-byte identical in shape. No bundling, no module restructuring.
//   3. No source maps are emitted, so DevTools > Sources can't reconstruct
//      the original source from the production build.
//   4. Every non-.js file (html, css, images, favicon, manifest, etc.) is
//      copied through unchanged.
//
// Output goes to dist/ (vercel.json's outputDirectory). Nothing under the
// repo root is modified.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist');

// Dev-only / documentation / tooling -- not part of the served app, never
// referenced by index.html or app/router.js's import graph.
const EXCLUDE_DIRS = new Set([
  'Archieved',
  'README',
  'Tools_Automasi',
  'data_cleaning',
  'inaproc_scrapper',
  'tools_paste_di_console',
  'node_modules',
  '.git',
  '.vercel',
  'dist',
  'scripts',
]);

const EXCLUDE_FILES = new Set([
  'map.md',
  'map history.md',
  'design.md',
  'visi-pionir-workspaces.md',
  'serve.json',
  'vercel.json',
  'package.json',
  'package-lock.json',
  '.gitignore',
]);

function shouldSkipFile(name) {
  if (EXCLUDE_FILES.has(name)) return true;
  if (name.endsWith('.bak')) return true; // e.g. index.js.PRE-BREAKUP.bak
  if (name.endsWith('.md')) return true;
  return false;
}

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.isDirectory()) continue;
    const fullPath = path.join(dir, entry.name);
    const rel = path.relative(ROOT, fullPath);

    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      await walk(fullPath);
      continue;
    }

    if (shouldSkipFile(entry.name)) continue;

    const outPath = path.join(OUT, rel);
    await fs.mkdir(path.dirname(outPath), { recursive: true });

    if (entry.name.endsWith('.js')) {
      const src = await fs.readFile(fullPath, 'utf8');
      const result = await transform(src, {
        loader: 'js',
        minify: true,
        legalComments: 'none', // strip all comments, including /*! */ license ones
        target: 'es2020',
        sourcemap: false, // no source map -> no way to recover original source in DevTools
      });
      await fs.writeFile(outPath, result.code);
    } else {
      await fs.copyFile(fullPath, outPath);
    }
  }
}

async function main() {
  await fs.rm(OUT, { recursive: true, force: true });
  await fs.mkdir(OUT, { recursive: true });
  await walk(ROOT);
  console.log('Build complete ->', OUT);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
