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
// Jaring pengaman biar textbox biasa (search, form field, dst) gak
// disodorin saran password/email tersimpan sama password manager
// browser/extension -- lihat komentar panjang di shared/no-autofill.js
// buat penjelasan root cause-nya. Dipanggil sekali di bawah, sebelum
// initAuthGate() supaya sudah aktif dari gate pertama kali muncul.
import { initNoAutofillGuard } from '../shared/no-autofill.js';
// Same two registries nav-markup.js already imports to draw the sidebar
// accordion (see app/pages/nav/nav-markup.js's SUBNAV) -- reused here as
// the single source of truth for "is this sub-route real", so router.js
// never has its own separate, driftable copy of the 5/6 valid ids. Any
// module NOT in SUBROUTES below (dashboard/stok/kompres-pdf/export-gambar)
// simply has no legitimate sub-routes at all -- see isValidSub().
import { CRUD_PRODUK_SUBNAV } from './pages/crud-produk/subnav.js';
import { KONVERSIAN_SUBNAV } from './pages/konversian/subnav.js';

const ROUTES = {
  'kompres-pdf': () => import('./pages/kompres-pdf/index.js'),
  'export-gambar': () => import('./pages/export-gambar/index.js'),
  'konversian': () => import('./pages/konversian/index.js'),
  'crud-produk': () => import('./pages/crud-produk/index.js'),
  'dashboard': () => import('./pages/dashboard/index.js'),
  'stok': () => import('./pages/stok/index.js'),
};

const SUBROUTES = {
  'crud-produk': CRUD_PRODUK_SUBNAV.map((s) => s.id),
  'konversian': KONVERSIAN_SUBNAV.map((s) => s.id),
};

// A sub-route is legitimate only if: no sub was requested at all, OR the
// module has a registry above AND the requested sub is actually in it.
// Anything else -- a module with no sub-routes getting one anyway, or a
// sub id that isn't one of the real ones -- is treated the same as a
// dead top-level route (see `tampered` in render()).
function isValidSub(module, sub) {
  if (!sub) return true;
  const allowed = SUBROUTES[module];
  return !!allowed && allowed.includes(sub);
}

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
  const [module, sub, ...rest] = (path || DEFAULT_ROUTE).split('/');
  // `rest` is anything past the module/sub pair -- e.g. the
  // "RB999-KE878-B089-U09" in /crud-produk/produk/RB999-KE878-B089-U09.
  // No route in this app is ever 3 segments deep on purpose (see ROUTES +
  // SUBROUTES above), so any non-empty `rest` is someone hand-editing the
  // URL bar looking for a page that isn't there, same as an unknown module
  // or sub id -- render() treats all three identically as `tampered`.
  return { module, sub: sub || null, extra: rest.length > 0 };
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
  clearPendingKick(); // any earlier "you're about to be logged out" from a previous bad URL no longer applies
  let { module, sub, extra } = currentRoute();
  if (RETIRED_REDIRECTS[module]) {
    module = RETIRED_REDIRECTS[module];
    navigate('/' + module + (sub ? '/' + sub : ''), { replace: true });
    return; // navigate() above already re-runs render() with the new route
  }
  const load = ROUTES[module];

  // FIX ("mbalik dengan aman ke crud"): this check used to not exist at
  // all -- an unknown top-level module fell through to the `!load` 404
  // below, but a KNOWN module with a bogus/extra sub-path (e.g.
  // /crud-produk/produk/RB999-KE878-B089-U09) never got that far. It hit
  // the `setSubroute` fast-path right below instead, which only ever reads
  // the module+sub pair and silently ignores anything past it -- so it just
  // quietly re-rendered crud-produk's real "produk" view as if nothing had
  // been typed after it. Checked BEFORE that fast-path (and before nav even
  // mounts) so a tampered URL can never reach it. Same treatment for all
  // three cases -- unknown module, invalid sub, or extra depth -- an
  // unrecognized destination is an unrecognized destination.
  const tampered = !load || extra || !isValidSub(module, sub);
  if (tampered) {
    if (currentPage && typeof currentPage.unmount === 'function') {
      try { currentPage.unmount(); } catch (err) { console.error('unmount gagal:', err); }
    }
    currentPage = null;
    currentModule = null;
    container.innerHTML = '';
    renderNotFound(container);
    return;
  }

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
  // to the normal mount/unmount below exactly as before. `sub` is
  // guaranteed valid for this module by the `tampered` check above.
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

// 404 (sesi lanjutan -- "stop being polite about it"): the old fallback for
// an unrecognized module ("Halaman X belum dipindah ke SPA" + a link to a
// legacy .html that in most cases no longer exists either) read as if the
// app was still mid-migration and apologizing for it. It isn't anymore --
// ROUTES/SUBROUTES above cover every real route. Anything that lands here
// now is either a stale bookmark or someone hand-editing the URL bar to go
// spelunking for hidden pages/IDs, so the message doesn't need to be gentle
// about it -- AND (sesi lanjutan lagi, per report: known module + fake
// sub-path just quietly re-showed the real page, "mbalik dengan aman ke
// crud") it now ends the session instead of just scolding, same rule for
// every module. escalateMessage() keeps a per-browser counter (localStorage,
// survives reloads/new tabs, resets never -- that's the point) and gets
// progressively less patient the more times the SAME browser hits a
// nonexistent route. escapeHtml() exists because the attempted path is
// attacker/user-controlled (comes straight from location.pathname) and the
// old code interpolated it into innerHTML raw.
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

const NOT_FOUND_HITS_KEY = 'pnm_404_hits';
const KICK_SECONDS = 3; // how long the countdown/message shows before logout() actually fires

function escalateMessage(hits) {
  const lines = [
    'Halaman ini tidak ada. Belum pernah ada. Tidak akan pernah ada.',
    'Masih di sini? Sudah dicoba, sudah tidak ada, tetap tidak ada.',
    'Ini percobaan ketiga. URL bar bukan menu rahasia.',
    'Oke, ini mulai personal. Halaman ini benar-benar, sungguh-sungguh tidak ada.',
    'Kita sudah sejauh ini bersama. Halamannya tetap tidak ada.',
  ];
  const idx = Math.min(hits - 1, lines.length - 1);
  return lines[idx];
}

// Single timer pair for the pending auto-logout, so a second bad URL (or a
// real navigation away, via clearPendingKick() at the top of render())
// cancels whatever a PREVIOUS bad URL had scheduled instead of stacking
// multiple logout() calls / countdowns fighting over the same DOM node.
let kickTimeout = null;
let kickInterval = null;

function clearPendingKick() {
  if (kickTimeout) { clearTimeout(kickTimeout); kickTimeout = null; }
  if (kickInterval) { clearInterval(kickInterval); kickInterval = null; }
}

function renderNotFound(container) {
  let hits = 1;
  try {
    hits = (parseInt(localStorage.getItem(NOT_FOUND_HITS_KEY) || '0', 10) || 0) + 1;
    localStorage.setItem(NOT_FOUND_HITS_KEY, String(hits));
  } catch (err) { /* localStorage unavailable (private mode/quota) -- just don't escalate */ }

  const attemptedPath = escapeHtml(location.pathname);
  const attemptNote = hits > 1
    ? `<p class="pnm-404-count">Percobaan ke-${hits} di URL yang gak ada. Sistem mencatat.</p>`
    : '';

  container.innerHTML = `
    <div class="pnm-404">
      <div class="pnm-404-code">404</div>
      <h1 class="pnm-404-title">Tidak ada apa-apa di "${attemptedPath}"</h1>
      <p class="pnm-404-msg">${escalateMessage(hits)}</p>
      ${attemptNote}
      <p class="pnm-404-kick">Karena mengutak-atik URL, kamu bakal di-logout otomatis dalam <span id="pnm-404-countdown">${KICK_SECONDS}</span> detik.</p>
      <button type="button" class="pnm-404-btn" id="pnm-404-back">Kembali ke Dashboard sekarang</button>
    </div>
    <style>
      .pnm-404 {
        max-width: 480px;
        margin: 90px auto;
        padding: 40px 32px;
        text-align: center;
        font-family: 'Inter', system-ui, sans-serif;
        background: var(--surface, #fff);
        border: 1px solid var(--border, #e2e4e9);
        border-radius: 16px;
      }
      .pnm-404-code {
        font-family: 'JetBrains Mono', monospace;
        font-size: 64px;
        font-weight: 700;
        line-height: 1;
        color: var(--danger, #b91c1c);
        letter-spacing: -2px;
      }
      .pnm-404-title {
        margin: 16px 0 8px;
        font-size: 18px;
        font-weight: 600;
        color: var(--text, #0b1220);
        word-break: break-word;
      }
      .pnm-404-msg {
        margin: 0 0 8px;
        font-size: 14px;
        color: var(--text-secondary, #334155);
      }
      .pnm-404-count {
        margin: 0 0 20px;
        font-size: 12px;
        color: var(--text-muted, #64748b);
        font-style: italic;
      }
      .pnm-404-kick {
        margin: 0 0 20px;
        font-size: 13px;
        font-weight: 600;
        color: var(--danger, #b91c1c);
      }
      .pnm-404-btn {
        margin-top: 4px;
        padding: 10px 20px;
        font-size: 14px;
        font-weight: 600;
        color: #fff;
        background: var(--accent, #007AFF);
        border: none;
        border-radius: 8px;
        cursor: pointer;
      }
      .pnm-404-btn:hover { background: var(--accent-hover, #0060df); }
    </style>
  `;

  // Clicking through to Dashboard is a normal navigate() -- render() clears
  // this same pending kick at its top, so choosing to leave cancels the
  // logout. Anyone who just sits on the page (or keeps trying more URLs)
  // still gets thrown out once the countdown below hits zero.
  container.querySelector('#pnm-404-back')?.addEventListener('click', () => {
    navigate('/' + DEFAULT_ROUTE);
  });

  clearPendingKick();
  let remaining = KICK_SECONDS;
  const countdownEl = container.querySelector('#pnm-404-countdown');
  kickInterval = setInterval(() => {
    remaining -= 1;
    if (countdownEl) countdownEl.textContent = String(Math.max(remaining, 0));
  }, 1000);
  kickTimeout = setTimeout(async () => {
    clearPendingKick();
    try {
      await window.PNMAuth?.logout(); // triggers auth-gate's onAuthStateChange -> onLoggedOut -> stopRouting()
    } catch (err) {
      console.error('auto-logout (URL tampering) gagal:', err);
    }
  }, KICK_SECONDS * 1000);
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
  initNoAutofillGuard();
  initAuthGate({ onReady: startRouting, onLoggedOut: stopRouting });
});