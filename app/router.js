// Minimal path router. Zero-build: native <script type="module">, native import().
// Each route lazily imports a page module exposing mount(container) / unmount()
// (and optionally setSubroute(sub)). To add a page, register it in ROUTES below.
//
// AUTH: router.js gates ALL routing behind ONE shared login (shared/auth-gate.js) --
// popstate/DOMContentLoaded listeners aren't even attached, and no page module is
// ever mount()ed, until initAuthGate()'s onReady() fires. Page modules have no
// login gate of their own, and the allowed_users whitelist check also lives only
// in the shared gate.
//
// SUB-ROUTES: route format is `/module` OR `/module/sub` (e.g. `/crud-produk/kfa`),
// so the sidebar accordion (app/pages/nav/) can link straight to a module's
// sub-view with a real, bookmarkable, back-button-safe URL. A page opts in by
// exporting an optional `setSubroute(sub)` alongside mount()/unmount() (see
// crud-produk/index.js and konversian/index.js). render() only calls it when it
// exists; for pages without it (dashboard/populasi/stok/kompres-pdf/export-gambar) the sub
// segment is simply ignored.
//
// CLEAN URLS: real path (location.pathname) + History API (pushState/popstate),
// no hash routing. Two things work together so nav clicks don't cause full reloads:
//   1. Deep links / refreshes hit the server for a path that has no real file
//      behind it (e.g. GET /konversian/cari), so vercel.json has a catch-all
//      rewrite back to /index.html (see its own comment); serve.json has the
//      equivalent for local `serve` testing.
//   2. In-app navigation (sidebar + sub-nav + nav search box) uses real
//      <a href="/module"> links. nav.js intercepts clicks on its own links only
//      (this file deliberately does NOT install a blanket document-wide click
//      listener) and dispatches a `pnm:navigate` CustomEvent; this file listens
//      for it and does the pushState + render() itself. Genuine cross-module
//      full-page navigations (konversian's navigateToEditProduk(), crud-produk's
//      "Kembali ke Konversi" button) are real window.location.href navigations on
//      purpose: they need a fresh load so the target page's mount() sees
//      window.location.search cleanly.

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
// module NOT in SUBROUTES below (dashboard/populasi/stok/kompres-pdf/export-gambar)
// simply has no legitimate sub-routes at all -- see isValidSub().
import { CRUD_PRODUK_SUBNAV } from './pages/crud-produk/subnav.js';
import { KONVERSIAN_SUBNAV } from './pages/konversian/subnav.js';

const ROUTES = {
  'kompres-pdf': () => import('./pages/kompres-pdf/index.js'),
  'export-gambar': () => import('./pages/export-gambar/index.js'),
  'uploader-wiki': () => import('./pages/uploader-wiki/index.js'),
  'spek-maker': () => import('./pages/spek-maker/index.js'),
  'rekon-meeting': () => import('./pages/rekon-meeting/index.js'),
  'konversian': () => import('./pages/konversian/index.js'),
  'crud-produk': () => import('./pages/crud-produk/index.js'),
  'dashboard': () => import('./pages/dashboard/index.js'),
  'populasi': () => import('./pages/populasi/index.js'),
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

// "REMEMBER LAST MODULE" (polishing job -- user report: buka app dari tab
// baru/bookmark ke root selalu jatuh ke Dashboard, jadi harus navigasi ulang
// ke modul yang lagi dikerjain tiap kali). Cuma dipakai buat SATU celah: path
// kosong ("/") pas render() pertama kali jalan di load ini (lihat flag
// `hasResolvedInitialRoute` di currentRoute()). Sengaja TIDAK dipakai untuk:
//   - Deep link eksplisit (/konversian/cari, dst) -- itu HARUS selalu apa
//     adanya, gak boleh dioverride riwayat, sama seperti bookmark/share link
//     manapun.
//   - render() sesudahnya dalam sesi yang sama (popstate/klik nav) -- kalau
//     enggak, nge-back ke "/" via tombol back browser bakal nyangkut balik ke
//     modul yang sama, gak pernah beneran nyampe root.
//   - Re-login setelah logout (stopRouting -> startRouting) -- pathname saat
//     itu sudah apa adanya milik sesi user, bukan sesuatu yang perlu ditimpa.
// Sama seperti NOT_FOUND_HITS_KEY di bawah, dibungkus try/catch: localStorage
// bisa gak kebaca (private mode/quota) -- kalau gitu ya cuma gak keinget,
// bukan error yang gagalin routing.
const LAST_ROUTE_KEY = 'pnm_last_route';

function readLastRoute() {
  try { return localStorage.getItem(LAST_ROUTE_KEY) || null; } catch (err) { return null; }
}

function saveLastRoute(module, sub) {
  try { localStorage.setItem(LAST_ROUTE_KEY, module + (sub ? '/' + sub : '')); } catch (err) { /* localStorage unavailable -- gak fatal, ya cuma gak keinget kali ini */ }
}

const container = document.getElementById('app');
const navContainer = document.getElementById('app-nav');
let currentPage = null; // the mounted module, so we can call .unmount()
let currentModule = null; // which top-level module id currentPage is (separate from route's module -- see render())
let routingEnabled = false; // false while the gate is showing (logged out / not yet authed)
let currentMounted = false; // true hanya setelah mount() halaman aktif selesai (jalur setSubroute tidak boleh menyentuh halaman setengah jadi)
let renderSeq = 0; // penanda render terbaru: render() lama yang tertinggal (klik nav cepat) harus berhenti, bukan ikut mount
let hasResolvedInitialRoute = false; // lihat LAST_ROUTE_KEY di atas -- cuma render() PERTAMA yang boleh substitusi path kosong

// ── PERCEPTED-SPEED: CSS halaman "diparkir", bukan dibuang ───────────────────────────────
// Tiap halaman memasang <link>/<style> miliknya di mount() dan membuangnya di unmount()
// (supaya selector-nya gak bocor ke halaman lain). Akibatnya SETIAP kembali ke modul yang
// pernah dibuka, mount() harus menunggu stylesheet diunduh/di-parse ulang dulu sebelum
// kontennya muncul. Di sini .remove() elemen style halaman, KHUSUS selama unmount() jalan,
// diganti jadi media="not all" (stylesheet tetap ter-parse di memori tapi tidak berlaku ->
// perilaku visual sama persis dengan dibuang). Begitu modul itu di-mount lagi, media
// dikembalikan SEBELUM mount() dipanggil; loadLink() halaman melihat elemennya sudah ada
// dan langsung lanjut -- tanpa fetch, tanpa flash tanpa-gaya. Tidak ada file halaman yang
// perlu diubah. Elemen 'shared-*' tidak pernah disentuh (memang permanen).
const parkedStyles = new Map(); // moduleId -> elemen <link>/<style> yang diparkir

function isParkableStyle(el) {
  return !!el && el.parentNode === document.head && !!el.id && !el.id.startsWith('shared-') &&
    ((el.tagName === 'LINK' && /stylesheet/i.test(el.rel || '')) || el.tagName === 'STYLE');
}

function unmountPage(page, moduleId, label) {
  if (!page || typeof page.unmount !== 'function') return;
  const nativeRemove = Element.prototype.remove;
  const parked = [];
  Element.prototype.remove = function () {
    if (isParkableStyle(this)) {
      if (!this.hasAttribute('data-pnm-media')) this.setAttribute('data-pnm-media', this.getAttribute('media') || '');
      this.setAttribute('media', 'not all');
      parked.push(this);
      return undefined;
    }
    return nativeRemove.call(this);
  };
  try {
    page.unmount();
  } catch (err) {
    console.error(label || 'unmount gagal:', err);
  } finally {
    Element.prototype.remove = nativeRemove;
  }
  if (moduleId && parked.length) {
    const list = parkedStyles.get(moduleId) || [];
    parked.forEach((el) => { if (!list.includes(el)) list.push(el); });
    parkedStyles.set(moduleId, list);
  }
}

function unparkStyles(moduleId) {
  const list = parkedStyles.get(moduleId);
  if (!list) return;
  parkedStyles.delete(moduleId);
  list.forEach((el) => {
    if (!el.isConnected) return;
    const orig = el.getAttribute('data-pnm-media');
    if (orig) el.setAttribute('media', orig); else el.removeAttribute('media');
    el.removeAttribute('data-pnm-media');
  });
}

// ── PERCEPTED-SPEED: skeleton instan selama chunk/CSS/data modul baru belum siap ──────────
// Muncul hanya kalau mount() belum menaruh apa-apa setelah 120 ms (navigasi cepat tidak
// berkedip). Otomatis tertimpa oleh container.innerHTML milik halaman.
const SKEL_STYLE_ID = 'pnm-route-skel-style';
function ensureSkelStyle() {
  if (document.getElementById(SKEL_STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = SKEL_STYLE_ID;
  st.textContent = '.pnm-route-skel{padding:28px 32px;display:flex;flex-direction:column;gap:14px}' +
    '.pnm-route-skel i{display:block;border-radius:10px;background:var(--border,#e2e4e9);opacity:.45;animation:pnm-skel 1.2s ease-in-out infinite}' +
    '.pnm-route-skel i:nth-child(1){height:28px;width:34%}' +
    '.pnm-route-skel i:nth-child(2){height:84px}' +
    '.pnm-route-skel i:nth-child(n+3){height:44px}' +
    '@keyframes pnm-skel{0%,100%{opacity:.28}50%{opacity:.55}}' +
    '@media (prefers-reduced-motion:reduce){.pnm-route-skel i{animation:none}}';
  document.head.appendChild(st);
}
function scheduleSkeleton(seq) {
  return setTimeout(() => {
    if (seq !== renderSeq || currentMounted || container.childElementCount) return;
    ensureSkelStyle();
    container.innerHTML = '<div class="pnm-route-skel" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>';
  }, 120);
}
function clearSkeleton(timer) {
  clearTimeout(timer);
  container.querySelector(':scope > .pnm-route-skel')?.remove();
}

function currentRoute() {
  let path = location.pathname.replace(/^\/+/, '').replace(/\/+$/, '').trim();
  if (!path && !hasResolvedInitialRoute) {
    const last = readLastRoute();
    if (last) {
      // Validasi dulu sebelum dipakai -- kalau route yang keinget udah gak
      // valid lagi (misal modulnya sempat dibongkar dari ROUTES di rilis
      // berikutnya), mending diam-diam jatuh ke DEFAULT_ROUTE kayak biasa
      // daripada nyeret user ke halaman 404 gara-gara riwayat lama, apalagi
      // itu juga bakal naikin escalateMessage()'s NOT_FOUND_HITS_KEY counter
      // buat sesuatu yang bukan salah ketik user.
      const [lastModule, lastSub] = last.split('/');
      if (ROUTES[lastModule] && isValidSub(lastModule, lastSub || null)) {
        path = last;
        // Refleksikan balik ke address bar juga (replaceState, bukan
        // pushState -- ini bukan navigasi baru, cuma nunjukin di mana
        // sebenarnya kita "ada") supaya refresh/share URL selanjutnya
        // konsisten sama apa yang kelihatan di layar, bukan diam-diam
        // nunjuk root sementara isinya modul lain.
        history.replaceState({}, '', '/' + path);
      }
    }
  }
  hasResolvedInitialRoute = true;
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
  const mySeq = ++renderSeq;
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
    unmountPage(currentPage, currentModule);
    currentPage = null;
    currentModule = null;
    container.innerHTML = '';
    renderNotFound(container);
    return;
  }

  // module/sub sudah lolos validasi di atas -- titik ini satu-satunya yang
  // kena dua jalur di bawah (setSubroute fast-path MAUPUN mount penuh), jadi
  // paling pas buat "diinget" LAST_ROUTE_KEY. Route 404/tampered di atas
  // sengaja gak pernah nyampe sini -- gak mau nyimpen route yang salah.
  saveLastRoute(module, sub);

  // Nav is mounted ONCE (idempotent — navMount() no-ops on repeat calls with
  // the same container, see nav.js), not per-route like page modules — it's
  // meant to survive across navigations (not per-page). Active-
  // item highlight still updates every render() via navSetActive().
  if (navContainer) {
    await navMount(navContainer, module, sub);
    if (mySeq !== renderSeq) return; // sudah ada navigasi yang lebih baru
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
  if (currentMounted && currentModule === module && currentPage && typeof currentPage.setSubroute === 'function') {
    currentPage.setSubroute(sub);
    return;
  }

  unmountPage(currentPage, currentModule);
  currentPage = null;
  currentModule = null;
  container.innerHTML = '';
  const skelTimer = scheduleSkeleton(mySeq);

  let mod;
  try {
    mod = await load();
  } catch (err) {
    clearSkeleton(skelTimer);
    // Chunk gagal diunduh (koneksi putus / versi baru baru saja dideploy): beri tahu, jangan layar kosong.
    console.error(`gagal memuat modul "${module}":`, err);
    if (mySeq === renderSeq) {
      container.innerHTML = `<div style="max-width:520px;margin:60px auto;font-family:sans-serif;">
      <p>Halaman "${module}" gagal diunduh. Cek koneksi internet, lalu muat ulang halaman.</p>
    </div>`;
    }
    return;
  }
  if (mySeq !== renderSeq) { clearTimeout(skelTimer); return; } // user sudah pindah lagi selagi chunk diunduh -> jangan mount halaman ini

  // currentPage/currentModule diisi SEBELUM mount() selesai: kalau user pindah lagi selagi mount() masih
  // berjalan, render() berikutnya bisa meng-unmount halaman ini (dulu: tertinggal terpasang tanpa pegangan).
  currentPage = mod;
  currentModule = module;
  currentMounted = false;
  unparkStyles(module); // CSS halaman ini (kalau pernah dibuka) dipasang lagi dari memori, sebelum mount()
  try {
    await mod.mount(container, sub);
    if (currentPage === mod) currentMounted = true;
    clearSkeleton(skelTimer);
  } catch (err) {
    clearSkeleton(skelTimer);
    console.error(`mount gagal untuk modul "${module}":`, err);
    try { mod.unmount?.(); } catch (unmountErr) { console.error('unmount (setelah mount gagal) juga gagal:', unmountErr); }
    if (currentPage === mod) { currentPage = null; currentModule = null; }
    if (mySeq === renderSeq) {
      container.innerHTML = `<div style="max-width:520px;margin:60px auto;font-family:sans-serif;">
      <p>Halaman "${module}" gagal dimuat karena error internal.</p>
      <p>Coba muat ulang halaman. Kalau masih gagal, hubungi admin.</p>
    </div>`;
    }
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
  startIdlePrefetch();
}

function stopRouting() {
  renderSeq++; // batalkan render() yang masih menunggu (logout di tengah navigasi)
  routingEnabled = false; // render() now no-ops on any popstate/pnm:navigate until startRouting() again
  // Logout while a page was mounted: tear it down and hide nav/content so
  // nothing stale sits behind the gate when it reappears.
  unmountPage(currentPage, currentModule, 'unmount gagal (logout):');
  currentPage = null;
  currentModule = null;
  container.innerHTML = '';
  if (navContainer) navContainer.style.display = 'none';
}

// PREFETCH SPEKULATIF halaman yang hampir pasti dibuka berikutnya. Tanpa ini chunk
// halaman baru mulai diunduh SETELAH gate login + cek allowed_users selesai (rantai
// serial). Di sini import() dipanggil sekarang, paralel dengan proses auth; hasilnya
// di-cache modul-loader, jadi import() di render() nanti langsung selesai. Aman:
// scope modul semua halaman cuma deklarasi (mount() yang bekerja), dan chunk-nya
// file statis publik. Cuma jalan kalau browser ini punya sesi tersimpan (user yang
// akan langsung masuk) -- yang belum login dapat gate login tanpa download ekstra.
function prefetchLikelyRoute() {
  try {
    // Sesi disimpan di COOKIE (shared/supabase-client.js), bukan localStorage -- dulu cek ini selalu gagal.
    if (!document.cookie.split('; ').some((c) => c.startsWith('pnm_auth_session='))) return;
    let mod = location.pathname.replace(/^\/+|\/+$/g, '').split('/')[0];
    if (!mod) { const last = readLastRoute(); mod = last ? last.split('/')[0] : DEFAULT_ROUTE; }
    if (RETIRED_REDIRECTS[mod]) mod = RETIRED_REDIRECTS[mod];
    const load = ROUTES[mod];
    if (load) load().catch(() => {});
  } catch (err) { /* prefetch cuma optimasi -- gagal ya diam */ }
}
prefetchLikelyRoute();

// PREFETCH saat hover/fokus/sentuh link sidebar: chunk modul tujuan mulai diunduh sebelum klik
// selesai (import() di-cache modul-loader, jadi render() nanti langsung dapat). Listener
// dipasang di container sidebar saja, bukan document-wide.
function prefetchRoute(mod) {
  if (RETIRED_REDIRECTS[mod]) mod = RETIRED_REDIRECTS[mod];
  const load = ROUTES[mod];
  if (load) load().catch(() => {});
}
function prefetchFromEvent(e) {
  const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
  if (!a) return;
  try {
    const u = new URL(a.getAttribute('href'), location.origin);
    if (u.origin !== location.origin) return;
    prefetchRoute(u.pathname.replace(/^\/+/, '').split('/')[0]);
  } catch (err) { /* href aneh -- abaikan */ }
}
if (navContainer) {
  navContainer.addEventListener('pointerover', prefetchFromEvent, { passive: true });
  navContainer.addEventListener('focusin', prefetchFromEvent);
  navContainer.addEventListener('touchstart', prefetchFromEvent, { passive: true });
}

// PREFETCH IDLE: setelah halaman pertama tampil, sisa chunk modul diunduh satu per satu saat
// browser menganggur (modul yang paling sering dipakai duluan). Dilewati di mode hemat data /
// koneksi 2G. Cuma dipanggil setelah login lolos (dari startRouting), bukan untuk tamu.
let idlePrefetchStarted = false;
function startIdlePrefetch() {
  if (idlePrefetchStarted) return;
  idlePrefetchStarted = true;
  try {
    const c = navigator.connection;
    if (c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || ''))) return;
  } catch (err) { /* abaikan */ }
  const first = ['populasi', 'crud-produk', 'konversian', 'dashboard', 'stok'];
  const queue = first.concat(Object.keys(ROUTES).filter((m) => !first.includes(m))).filter((m) => ROUTES[m]);
  const idle = window.requestIdleCallback ? (fn) => window.requestIdleCallback(fn, { timeout: 4000 }) : (fn) => setTimeout(fn, 500);
  const step = () => {
    const m = queue.shift();
    if (!m) return;
    ROUTES[m]().catch(() => {});
    idle(step);
  };
  setTimeout(() => idle(step), 1500);
}

window.addEventListener('DOMContentLoaded', () => {
  initNoAutofillGuard();
  initAuthGate({ onReady: startRouting, onLoggedOut: stopRouting });
});