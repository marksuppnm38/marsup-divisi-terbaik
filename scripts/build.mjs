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
//   markup.js, subnav.js, etc. get inlined into one opaque per-page
//   bundle. There is no app/pages/** folder structure left to see.
//
//   This was checked against this specific codebase before adopting it,
//   including one real mistake caught only by an actual test deploy:
//
//   - Every cross-file reference *within* app/pages/** is a real ESM
//     `import`/`import()` (bundler-visible) -- those pages' own index.js,
//     markup.js, subnav.js etc. bundle safely, no special handling needed.
//
//   - shared/auth-gate.js is only ever reached via a real ESM `import` in
//     app/router.js, so it inlines into the router chunk automatically
//     and never needs to exist as a standalone file in the output.
//
//   - shared/supabase-client.js, shared/auth-session.js, and
//     shared/toast.js are each loaded a SECOND, non-ESM way: every page's
//     own VENDOR_CHAIN/INDEPENDENT_SCRIPTS array passes their exact
//     absolute path (e.g. '/shared/supabase-client.js') as a plain string
//     to a classic `document.createElement('script'); s.src = ...`
//     loader. That string is invisible to esbuild's bundler -- it isn't
//     an import specifier, so nothing tells esbuild to follow or rewrite
//     it. An earlier version of this script excluded shared/ from the
//     copy step entirely (wrongly assuming ESM import was the only path
//     in) -- that 404s those three files in production, caught by an
//     actual test deploy. A next version copied them back as plain
//     minified files at their original /shared/<name>.js path -- that
//     fixed the 404, but left the `shared` folder name and each script's
//     filename fully visible in DevTools > Sources, which defeats half
//     the point of bundling.
//
//     Fixed properly here, the same way page-local CSS is handled below:
//     these three files are content-hashed and copied to
//     dist/assets/<hash>.js, and `jsUrlRewritePlugin` rewrites each
//     hardcoded string literal ('/shared/supabase-client.js', etc.) to
//     the hashed path wherever it appears inside the bundled
//     app/pages/**/app/router.js graph -- only in esbuild's in-memory
//     read of the source, nothing on disk in the repo is ever touched.
//     No `shared/` folder ends up in the output at all.
//
//   - The only `document.createElement('script'); s.src = ...` calls that
//     do NOT hit local files load third-party CDN vendor scripts (e.g.
//     jsDelivr's supabase-js) -- bundling doesn't touch those either way,
//     they're left as absolute external URLs.
//
//   - The one non-bundler-visible pattern *inside* the bundled graph is
//     each page doing `new URL('./style.css', import.meta.url).href` to
//     lazy-load its own stylesheet. esbuild does NOT auto-follow that
//     pattern (confirmed with a real isolated test build, not assumed) --
//     left alone, it would break after bundling, because the relative
//     path would resolve against the new bundled chunk's location instead
//     of the original source folder. Fixed via `cssUrlRewritePlugin`:
//     page CSS files are content-hashed and copied to
//     dist/assets/<hash>.css, and an onLoad hook rewrites each
//     `new URL(...).href` call to a plain string literal pointing at that
//     hashed path.
//
//   Both rewrite plugins, and the bundled output as a whole, were
//   confirmed working end-to-end against a real build of this exact
//   repo -- served locally, checking that every referenced path (every
//   chunk, every hashed asset, favicons, pnm-universal.css) returns 200 --
//   not assumed from reading the source.
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
// load hooks and this script's own copy step, never on the actual files.

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

// Paths (relative to ROOT, forward-slash) fully handled by the esbuild
// bundle step or the hashed-asset pipeline below, instead of the generic
// copy walk. Copying these too would both be redundant and would leak the
// exact folder tree bundling is meant to hide.
const BUNDLED_PATHS = new Set(['app/router.js']);
function isBundledOrHandledPath(rel) {
  const norm = rel.split(path.sep).join('/');
  if (BUNDLED_PATHS.has(norm)) return true;
  if (norm.startsWith('app/pages/')) return true;
  if (norm.startsWith('shared/')) return true; // handled via hashed assets or ESM inlining, see comment above
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

// The three shared/*.js files loaded via a hardcoded classic <script>
// path (see big comment at top of file) -- everything else in shared/ is
// either pure ESM-import-only (auth-gate.js, inlined automatically) or
// doesn't exist.
const CLASSIC_SHARED_SCRIPTS = ['supabase-client.js', 'auth-session.js', 'toast.js'];

// ─── Step 1: hash + copy page-local CSS (loaded via
// `new URL('./x.css', import.meta.url)`) AND the classic-script-tag
// shared/*.js files into dist/assets/. Returns two maps used by the
// esbuild plugins below: absolute source path -> public hashed URL.
async function buildHashedAssetMaps() {
  const cssMap = new Map();
  const jsMap = new Map(); // absolute shared/<name>.js path -> '/assets/<hash>.js'
  const assetsDir = path.join(OUT, 'assets');
  await fs.mkdir(assetsDir, { recursive: true });

  async function walkCss(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walkCss(full);
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
  await walkCss(path.join(ROOT, 'app'));

  const { transform } = await import('esbuild');
  for (const name of CLASSIC_SHARED_SCRIPTS) {
    const full = path.join(ROOT, 'shared', name);
    let raw;
    try {
      raw = await fs.readFile(full, 'utf8');
    } catch {
      console.warn('WARNING: expected shared script not found, skipping:', full);
      continue;
    }
    const result = await transform(raw, {
      loader: 'js',
      minify: true,
      legalComments: 'none',
      target: 'es2020',
      sourcemap: false,
    });
    const hash = hashOf(result.code);
    const outName = `${hash}.js`;
    await fs.writeFile(path.join(assetsDir, outName), result.code);
    jsMap.set(full, `/assets/${outName}`);
  }

  return { cssMap, jsMap };
}

// ─── Step 2: esbuild plugin that rewrites, inside the bundled
// app/pages/**/app/router.js graph only:
//   - `new URL('./whatever.css', import.meta.url).href` -> hashed CSS path
//   - '/shared/<name>.js' string literals -> hashed JS path
// Only touches esbuild's in-memory read of each file -- nothing on disk
// in the repo is ever modified.
function assetUrlRewritePlugin(cssMap, jsMap) {
  return {
    name: 'asset-url-rewrite',
    setup(b) {
      b.onLoad({ filter: /\.js$/ }, async (args) => {
        if (!args.path.startsWith(ROOT)) return null;
        const raw = await fs.readFile(args.path, 'utf8');
        const dir = path.dirname(args.path);
        let changed = false;

        let rewritten = raw.replace(
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

        rewritten = rewritten.replace(
          /(['"])\/shared\/([\w.-]+\.js)\1/g,
          (match, quote, jsFileName) => {
            const jsAbsPath = path.join(ROOT, 'shared', jsFileName);
            const publicUrl = jsMap.get(jsAbsPath);
            if (!publicUrl) {
              console.warn(
                'WARNING: no hashed asset found for /shared/' + jsFileName,
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

        if (!changed) return null; // let esbuild read the file normally
        return { contents: rewritten, loader: 'js' };
      });
    },
  };
}

// ─── Step 3: bundle app/router.js (and everything it imports) into hashed
// chunks under dist/chunks/. Returns the public URL of the router entry
// chunk, so index.html's <script src="/app/router.js"> can be corrected.
async function bundleApp(cssMap, jsMap) {
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
    plugins: [assetUrlRewritePlugin(cssMap, jsMap)],
    logLevel: 'info',
  });

  for (const [file, info] of Object.entries(result.metafile.outputs)) {
    if (info.entryPoint === 'app/router.js') {
      return '/' + path.relative(OUT, path.resolve(file)).split(path.sep).join('/');
    }
  }
  throw new Error('Could not find router.js entry chunk in esbuild output -- bundling misconfigured');
}

// ─── Step 4: generic copy walk for everything NOT handled above (html,
// images, favicon, the shared root pnm-universal.css, docs exclusions,
// etc.), stripping comments from html/css as it goes.
async function copyStaticFiles(routerPublicUrl) {
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.isDirectory()) continue;
      const fullPath = path.join(dir, entry.name);
      const rel = path.relative(ROOT, fullPath);

      if (entry.isDirectory()) {
        if (EXCLUDE_DIRS.has(entry.name)) continue;
        if (isBundledOrHandledPath(rel + '/')) continue; // e.g. app/pages, shared
        await walk(fullPath);
        continue;
      }

      if (shouldSkipFile(entry.name)) continue;
      if (isBundledOrHandledPath(rel)) continue; // e.g. app/router.js, shared/*.js

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

  const { cssMap, jsMap } = await buildHashedAssetMaps();
  const routerPublicUrl = await bundleApp(cssMap, jsMap);
  await copyStaticFiles(routerPublicUrl);

  console.log('Build complete ->', OUT);
  console.log('Router entry ->', routerPublicUrl);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
