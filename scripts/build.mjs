// scripts/build.mjs
// ══════════════════════════════════════════
// Production-only build. Runs on Vercel (npm run build) via vercel.json's
// buildCommand. NEVER needed for local dev -- keep editing files directly
// and serving the repo root as-is (see serve.json), exactly like before.
//
// What changed vs. the old per-file-transform version, and why:
//
//   The old build only ran esbuild's per-file `transform` (minify one file
//   at a time, no bundling). That kept every file at its original path, so
//   DevTools > Sources still showed the full app/pages/<name>/... folder
//   tree and file names -- minifying the *contents* of a file does nothing
//   to hide *where* it lives or *what it's part of*.
//
//   This version actually bundles the app/router.js import graph (real
//   esbuild `build`, with `splitting: true`) into a handful of hashed
//   chunk files (chunks/<page>-<hash>.js). Every page's index.js,
//   markup.js, subnav.js, etc. -- and shared/*.js -- get inlined into one
//   opaque per-page bundle. There is no folder structure left to see.
//
//   This was verified safe for this specific codebase before adopting it:
//   - Every internal cross-file reference in app/ and shared/ is a real
//     ESM `import`/`import()` (bundler-visible), confirmed by grepping the
//     whole tree for dynamic `<script>` tags and string-based loads.
//   - The only `document.createElement('script'); s.src = ...` calls found
//     load third-party CDN vendor scripts (e.g. jsDelivr's supabase-js),
//     never local app files -- bundling doesn't touch those, so they're
//     unaffected either way.
//   - The one non-bundler-visible pattern in the source is each page doing
//     `new URL('./style.css', import.meta.url).href` to lazy-load its own
//     stylesheet. esbuild does NOT auto-follow that pattern (confirmed by
//     a real test build, not assumed) -- left alone, it would break after
//     bundling, because the relative path would resolve against the new
//     bundled chunk's location instead of the original source folder.
//     Fixed via the `cssUrlRewritePlugin` below: page CSS files are
//     content-hashed and copied to dist/assets/<hash>.css ourselves, and
//     an esbuild onLoad hook rewrites each `new URL(...).href` call (only
//     in esbuild's in-memory copy of the source -- nothing on disk in the
//     repo is touched) to a plain string literal pointing at that hashed
//     path. Confirmed working end-to-end against a real build + a local
//     static server serving the output.
//
// Everything else keeps the previous behavior:
//   - Dev-only folders/files (docs, tooling scripts, console snippets,
//     config not part of the served app) are skipped entirely.
//   - Every other non-JS file (html, css, images, favicon, manifest, etc.)
//     is copied through, with HTML/CSS comments stripped so internal notes
//     don't ship to production.
//   - No source maps are emitted, so DevTools > Sources can't reconstruct
//     original source from the production build.
//
// Output goes to dist/ (vercel.json's outputDirectory). Nothing under the
// repo root is modified -- all rewriting happens in esbuild's in-memory
// load hook and this script's own copy step, never on the actual files.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

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

// Paths (relative to ROOT, forward-slash) that are handled by the esbuild
// bundle step instead of the generic copy walk below. Copying these too
// would both be redundant and would leak the exact folder tree bundling
// is meant to hide.
const BUNDLED_PATHS = new Set(['app/router.js']);
function isBundledPath(rel) {
  const norm = rel.split(path.sep).join('/');
  if (BUNDLED_PATHS.has(norm)) return true;
  if (norm.startsWith('app/pages/')) return true;
  if (norm.startsWith('shared/')) return true;
  return false;
}

function shouldSkipFile(name) {
  if (EXCLUDE_FILES.has(name)) return true;
  if (name.endsWith('.bak')) return true; // e.g. index.js.PRE-BREAKUP.bak
  if (name.endsWith('.md')) return true;
  return false;
}

function stripHtmlComments(src) {
  return src.replace(/<!--[\s\S]*?-->/g, '');
}

function stripCssComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '');
}

function hashOf(content) {
  return crypto.createHash('sha1').update(content).digest('hex').slice(0, 10);
}

// ─── Step 1: find every page-local CSS file loaded via
// new URL('./x.css', import.meta.url), content-hash it, and copy it to
// dist/assets/<hash>.css. Returns a Map of absolute source path -> public
// URL, used by the esbuild plugin below.
async function buildCssMap() {
  const cssMap = new Map();
  const assetsDir = path.join(OUT, 'assets');
  await fs.mkdir(assetsDir, { recursive: true });

  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.name.endsWith('.css')) continue;
      const raw = await fs.readFile(full, 'utf8');
      const minified = stripCssComments(raw).replace(/\s+/g, ' ').trim();
      const hash = hashOf(minified);
      const outName = `${hash}.css`;
      await fs.writeFile(path.join(assetsDir, outName), minified);
      cssMap.set(full, `/assets/${outName}`);
    }
  }

  await walk(path.join(ROOT, 'app'));
  return cssMap;
}

// ─── Step 2: esbuild plugin that rewrites
// `new URL('./whatever.css', import.meta.url).href` to the hashed public
// path from cssMap. Only touches esbuild's in-memory read of the file --
// nothing on disk in the repo is ever modified.
function cssUrlRewritePlugin(cssMap) {
  return {
    name: 'css-url-rewrite',
    setup(b) {
      b.onLoad({ filter: /\.js$/ }, async (args) => {
        if (!args.path.startsWith(ROOT)) return null;
        const raw = await fs.readFile(args.path, 'utf8');
        const dir = path.dirname(args.path);
        let changed = false;
        const rewritten = raw.replace(
          /new URL\(\s*['"]\.\/([\w.-]+\.css)['"]\s*,\s*import\.meta\.url\s*\)\.href/g,
          (match, cssFileName) => {
            const cssAbsPath = path.join(dir, cssFileName);
            const publicUrl = cssMap.get(cssAbsPath);
            if (!publicUrl) {
              console.warn(
                'WARNING: no CSS asset found for',
                path.relative(ROOT, cssAbsPath),
                'referenced in',
                path.relative(ROOT, args.path),
                '-- leaving as-is (will likely 404 in production, check this)'
              );
              return match;
            }
            changed = true;
            return JSON.stringify(publicUrl);
          }
        );
        if (!changed) return null;
        return { contents: rewritten, loader: 'js' };
      });
    },
  };
}

// ─── Step 3: bundle app/router.js (and everything it imports) into hashed
// chunks under dist/chunks/. Returns the public URL of the router entry
// chunk, so index.html's <script src="/app/router.js"> can be corrected.
async function bundleApp(cssMap) {
  const result = await build({
    entryPoints: [path.join(ROOT, 'app/router.js')],
    bundle: true,
    splitting: true,
    format: 'esm',
    outdir: OUT,
    minify: true,
    target: 'es2020',
    legalComments: 'none',
    sourcemap: false,
    entryNames: 'chunks/[name]-[hash]',
    chunkNames: 'chunks/[name]-[hash]',
    metafile: true,
    plugins: [cssUrlRewritePlugin(cssMap)],
    logLevel: 'info',
  });

  for (const [file, info] of Object.entries(result.metafile.outputs)) {
    if (info.entryPoint === 'app/router.js') {
      return '/' + path.relative(OUT, path.resolve(file)).split(path.sep).join('/');
    }
  }
  throw new Error('Could not find router.js entry chunk in esbuild output -- bundling misconfigured');
}

// ─── Step 4: generic copy walk for everything NOT handled by the bundler
// above (html, images, favicon, the shared root pnm-universal.css, docs
// exclusions, etc.), stripping comments from html/css as it goes.
async function copyStaticFiles(routerPublicUrl) {
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.isDirectory()) continue;
      const fullPath = path.join(dir, entry.name);
      const rel = path.relative(ROOT, fullPath);

      if (entry.isDirectory()) {
        if (EXCLUDE_DIRS.has(entry.name)) continue;
        if (isBundledPath(rel + '/')) continue; // e.g. app/pages, shared
        await walk(fullPath);
        continue;
      }

      if (shouldSkipFile(entry.name)) continue;
      if (isBundledPath(rel)) continue; // e.g. app/router.js

      const outPath = path.join(OUT, rel);
      await fs.mkdir(path.dirname(outPath), { recursive: true });

      if (entry.name.endsWith('.html')) {
        let html = await fs.readFile(fullPath, 'utf8');
        html = stripHtmlComments(html);
        html = html.replaceAll('/app/router.js', routerPublicUrl);
        await fs.writeFile(outPath, html);
      } else if (entry.name.endsWith('.css')) {
        // Root-level shared CSS (e.g. pnm-universal.css) referenced by a
        // fixed absolute path in multiple places -- keep its path stable,
        // just strip comments.
        const css = await fs.readFile(fullPath, 'utf8');
        await fs.writeFile(outPath, stripCssComments(css));
      } else {
        await fs.copyFile(fullPath, outPath);
      }
    }
  }

  await walk(ROOT);
}

async function main() {
  await fs.rm(OUT, { recursive: true, force: true });
  await fs.mkdir(OUT, { recursive: true });

  const cssMap = await buildCssMap();
  const routerPublicUrl = await bundleApp(cssMap);
  await copyStaticFiles(routerPublicUrl);

  console.log('Build complete ->', OUT);
  console.log('Router entry ->', routerPublicUrl);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
