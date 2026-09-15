// Minimal path router. Zero-build: native <script type="module">, native import().
// Each route lazily imports a page module exposing mount(container) / unmount().
// Add a page here only once it's actually migrated (see map.md bagian 4).
//
// AUTH (sesi kesembilan belas): router.js now gates ALL routing behind ONE
// shared login (shared/auth-gate.js) -- popstate/DOMContentLoaded listeners
// aren't even attached, and no page module is ever mount()ed, until
// initAuthGate()'s onReady() fires. Individual pages (dashboard/stok/
// crud-produk/export-gambar) used to each show their own login gate inside
// mount() and only reveal their content after a whitelist check passed --
// that's gone now, moved up here so it happens exactly ONCE per app session,
// not once per module visited. konversian was deferred from this at first
// (largest/most delicate file, no browser access to verify a change to its
// auth-critical path that session -- see map-history.md sesi kesembilan
// belas) but has since been migrated too: it no longer has any gate of its
// own, same as every other route here.
//
// SUB-ROUTES (sesi lanjutan -- "double nav" fix): route format is
// `/module` OR `/module/sub` (e.g. `/crud-produk/kfa`). This exists so the
// new sidebar accordion (app/pages/nav/) can link straight to a module's
// sub-page/view with a real, bookmarkable, back-button-safe URL -- before
// this, a "view" like crud-produk's KFA Management was pure in-page JS
// state, invisible to the URL entirely. A page opts into this by exporting
// an optional `setSubroute(sub)` alongside its usual mount()/unmount() --
// see crud-produk/index.js and konversian/index.js for the two that do.
// Pages that don't export it (dashboard/stok/kompres-pdf/export-gambar,
// none of which have sub-pages) are entirely unaffected -- render() below
// only ever calls setSubroute when it exists, sub is simply ignored
// otherwise, same as before this change for them.
//
// CLEAN URLS (sesi lanjutan -- "/#konversian/cari" -> "/konversian/cari"):
// switched off hash routing entirely (location.hash / hashchange) in favor
// of the real path (location.pathname) + the History API (pushState/
// popstate). Two things had to move together for this to keep working
// exactly as before, no full reloads on every nav click:
//   1. Deep links / refreshes now hit the server for a path that has no
//      real file behind it (e.g. GET /konversian/cari) -- vercel.json now
//      has a catch-all rewrite back to /index.html so that still resolves
//      to this same app shell (see vercel.json's own comment). serve.json
//      got the equivalent for local `serve` testing.
//   2. In-app navigation (sidebar + sub-nav + the nav search box) used to
//      be plain <a href="#module"> links -- the browser handles hash
//      links itself, no JS needed. A real <a href="/module"> link, left
//      alone, triggers an actual full-page navigation. So nav.js now
//      intercepts clicks on its own links (only its own -- this file does
//      NOT install a blanket document-wide click listener, deliberately,
//      same "don't touch what you can't verify in a browser" caution as
//      the rest of this codebase) and dispatches a `pnm:navigate` CustomEvent
//      instead of following the href natively. This file listens for that
//      event and does the pushState + render() itself. Genuine cross-module
//      full-page navigations (konversian's navigateToEditProduk(),
//      crud-produk's "Kembali ke Konversi" button) are UNCHANGED -- they
//      were already real window.location.href navigations on purpose (need
//      a fresh load so the target page's mount() sees window.location.search
//      cleanly), just the '#module' suffix they used to tack on is now a
//      real '/module' path instead.

import { navMount, navSetActive } from './pages/nav/nav.js';
import { initAuthGate } from '../shared/auth-gate.js';

const ROUTES = {
  'kompres-pdf': () => import('./pages/kompres-pdf/index.js'),
  'export-gambar': () => import('./pages/export-gambar/index.js'),
  'konversian': () => import('./pages/konversian/index.js'),
  'crud-produk': () => import('./pages/crud-produk/index.js'),
  'dashboard': () => import('./pages/dashboard/index.js'),
  'stok': () => import('./pages/stok/index.js'),
};

// 'home' RETIRED sesi keenam belas: with the persistent shared nav sidebar
// always showing the module list, home's own page (which was ALSO just a
// grid of the same module list, as cards) was pure duplication — user's own
// words: "pointless to show again the list of the tools". app/pages/home/
// is NOT deleted from disk (still there, unreachable/orphaned — same
// "don't delete until proven fine to" caution applied to old legacy .html
// files earlier in this migration), just disconnected from ROUTES/here.
// Old bookmarks/links to /home redirect to the new default instead of
// hitting the generic "not migrated" fallback message below (that message
// is for routes that were NEVER migrated, not one that was retired).
const RETIRED_REDIRECTS = { 'home': 'dashboard' };

const DEFAULT_ROUTE = 'dashboard';

const container = document.getElementById('app');
const navContainer = document.getElementById('app-nav');
let currentPage = null; // the mounted module, so we can call .unmount()
let currentModule = null; // which top-level module id currentPage is (separate from route's module -- see render())
let routingEnabled = false; // false while the gate is showing (logged out / not yet authed)

function currentRoute() {
  const path = location.pathname.replace(/^\/+/, '').replace(/\/+$/, '').trim();
  const [module, sub] = (path || DEFAULT_ROUTE).split('/');
  return { module, sub: sub || null };
}

// Single choke point for every in-app path change -- both the internal
// RETIRED_REDIRECTS case below and nav.js's `pnm:navigate` event (see
// listener near the bottom) go through this, so there's exactly one place
// that touches history.*State. `replace: true` swaps the current entry
// (redirects) instead of pushing a new back-button stop; the default push
// is for real navigations (clicking a module/sub-item).
function navigate(path, { replace = false } = {}) {
  if (!routingEnabled) return;
  const target = path.startsWith('/') ? path : '/' + path;
  if (!replace && target === location.pathname) return; // already there, no-op (avoids a dead history entry)
  if (replace) history.replaceState({}, '', target);
  else history.pushState({}, '', target);
  render();
}

async function render() {
  if (!routingEnabled) return; // popstate fired while logged out -- ignore, gate owns the screen
  let { module, sub } = currentRoute();
  if (RETIRED_REDIRECTS[module]) {
    module = RETIRED_REDIRECTS[module];
    navigate('/' + module + (sub ? '/' + sub : ''), { replace: true });
    return; // navigate() above already re-runs render() with the new route
  }
  const load = ROUTES[module];

  // Nav is mounted ONCE (idempotent — navMount() no-ops on repeat calls with
  // the same container, see nav.js), not per-route like page modules — it's
  // meant to survive across navigations (design.md: "not per-page"). Active-
  // item highlight still updates every render() via navSetActive().
  if (navContainer) {
    await navMount(navContainer, module, sub);
    navSetActive(module, sub);
  }

  // Same module already mounted, only the sub-route changed: let the page
  // handle it in place (crud-produk's switchView()/konversian's
  // switchSubTab() are instant, no-refetch tab switches -- a full remount
  // here would needlessly re-fetch everything from Supabase on every
  // sidebar sub-item click, a real perceived-speed regression the whole
  // point of this change shouldn't introduce). Only pages that opted in by
  // exporting setSubroute() take this path; everything else falls through
  // to the normal mount/unmount below exactly as before.
  if (currentModule === module && currentPage && typeof currentPage.setSubroute === 'function') {
    currentPage.setSubroute(sub);
    return;
  }

  if (currentPage && typeof currentPage.unmount === 'function') {
    try { currentPage.unmount(); } catch (err) { console.error('unmount gagal:', err); }
  }
  currentPage = null;
  currentModule = null;
  container.innerHTML = '';

  if (!load) {
    container.innerHTML = `<div style="max-width:520px;margin:60px auto;font-family:sans-serif;">
      <p>Halaman "${module}" belum dipindah ke SPA.</p>
      <p><a href="/${module}.html">Buka versi lama</a></p>
    </div>`;
    return;
  }

  const mod = await load();
  // FIX: mount() dulu dipanggil telanjang (gak dibungkus try/catch). Kalau
  // mount() throw di tengah jalan (misal exception sinkron dari salah satu
  // install*(S) di dalamnya), promise `render()` reject sebelum sempet nyampe
  // baris `currentPage = mod`/`currentModule = module` -- router jadi gak
  // punya pegangan buat manggil `mod.unmount()` pas user pindah halaman
  // berikutnya (lihat `if (currentPage && ...)` di atas), padahal mount() yang
  // gagal itu mungkin udah keburu masang listener document/window-level
  // (querySelector/addEventListener) SEBELUM baris yang bikin dia throw.
  // Listener itu nempel selamanya, nunjuk ke DOM container yang sebentar lagi
  // dikosongin router buat halaman lain -- persis kelas bug di balik
  // "S.escapeHtmlAttr is not a function" (installRealtime) yang nyusul lempar
  // "Cannot read properties of null (reading 'contains')" di klik BERIKUTNYA
  // di halaman lain manapun. try/catch di sini gak nyembuhin bug di dalam
  // mount() itu sendiri, tapi nyegah satu mount() yang gagal ninggalin jejak
  // permanen: tetep panggil unmount() (kalau modulnya punya) buat lepas
  // listener yang keburu kepasang, baru tampilin pesan error -- bukan
  // ninggalin currentPage/currentModule null selamanya kayak sebelumnya.
  try {
    await mod.mount(container, sub);
    currentPage = mod;
    currentModule = module;
  } catch (err) {
    console.error(`mount gagal untuk modul "${module}":`, err);
    try { mod.unmount?.(); } catch (unmountErr) { console.error('unmount (setelah mount gagal) juga gagal:', unmountErr); }
    container.innerHTML = `<div style="max-width:520px;margin:60px auto;font-family:sans-serif;">
      <p>Halaman "${module}" gagal dimuat karena error internal.</p>
      <p>Coba muat ulang halaman. Kalau masih gagal, hubungi admin.</p>
    </div>`;
  }
}

let routingStarted = false; // whether the popstate/pnm:navigate listeners have EVER been attached

function startRouting() {
  routingEnabled = true;
  if (navContainer) navContainer.style.display = '';
  if (!routingStarted) {
    routingStarted = true;
    // Back/forward buttons -- pushState (from navigate() above) doesn't
    // fire anything on its own, only the browser's own back/forward does.
    window.addEventListener('popstate', render);
    // Dispatched by nav.js when the user clicks a sidebar/sub-nav/search
    // link -- see this file's header comment ("CLEAN URLS") for why nav.js
    // can't just import navigate() directly (router.js already imports
    // nav.js; going the other way too would make it circular).
    window.addEventListener('pnm:navigate', (e) => navigate(e.detail?.path));
  }
  render(); // covers both first-ever login and re-login after a logout
}

function stopRouting() {
  routingEnabled = false; // render() now no-ops on any popstate/pnm:navigate until startRouting() again
  // Logout while a page was mounted: tear it down and hide nav/content so
  // nothing stale sits behind the gate when it reappears.
  if (currentPage && typeof currentPage.unmount === 'function') {
    try { currentPage.unmount(); } catch (err) { console.error('unmount gagal (logout):', err); }
  }
  currentPage = null;
  currentModule = null;
  container.innerHTML = '';
  if (navContainer) navContainer.style.display = 'none';
}

window.addEventListener('DOMContentLoaded', () => {
  initAuthGate({ onReady: startRouting, onLoggedOut: stopRouting });
});