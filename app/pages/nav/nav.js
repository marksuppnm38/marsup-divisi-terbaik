// Shared sidebar nav — mount(navEl) sekali, panggil setActive(id) di tiap perubahan
// route. Lifecycle-nya SENGAJA terpisah dari pola mount()/unmount() per halaman
// (app/pages/<name>/index.js): nav bertahan lintas route, dipasang SEKALI oleh
// router.js (navMount/navSetActive dipanggil di render()), bukan di-remount tiap
// navigasi. Wrapper-nya ada di index.html (.pw-shell berisi #app-nav + #app.pw-content
// sebagai sibling).
//
// FITUR:
//   1. Sub-navigation accordion -- view tiap modul yang punya sub-route
//      (crud-produk, konversian) tampil di bawah item modulnya saat route itu aktif.
//      Registry-nya ada di <modul>/subnav.js (lihat konversian/subnav.js).
//   2. Search box -- mengindeks setiap modul + sub-itemnya (buildSearchIndex()),
//      navigasi lewat klik/Enter, seperti command palette kecil.
// setSubroute() adalah separuh lainnya -- lihat router.js.

import { navMarkup, buildSearchIndex, navPermSignature } from './nav-markup.js';

const TABLER_ID = 'shared-tabler-icons';
const TABLER_HREF = 'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.31.0/dist/tabler-icons.min.css';

function loadLink(id, href) {
  if (document.getElementById(id)) return Promise.resolve();
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = () => resolve();
    link.onerror = () => resolve();
    document.head.appendChild(link);
  });
}

function ensureStyle() {
  return Promise.all([
    loadLink(TABLER_ID, TABLER_HREF),
    loadLink('page-nav-style', new URL('./nav.css', import.meta.url).href),
  ]);
}

let navEl = null;
let lastActiveId = null;
let lastActiveSub = null;
let lastPermSig = ''; // daftar modul yang tampil saat nav terakhir dibuat (lihat navPermSignature)

// ---- Accordion submodul: state buka/tutup per modul (dikontrol user, disimpan) ----
// Dulu accordion cuma "ada" kalau modulnya aktif, dan tiap pindah modul seluruh nav dirender ulang
// (innerHTML) -> mustahil dianimasikan dan klik modul aktif tidak bisa menutup. Sekarang semua submodul
// selalu ada di DOM; buka/tutup = toggle class, jadi CSS transition jalan. Pindah modul otomatis membuka
// modul tujuan (reveal), tapi tidak menutup yang lain -- itu urusan user.
const EXPANDED_KEY = 'pnm_nav_expanded';
let expandedSet = new Set();

function loadExpanded() {
  try {
    const raw = JSON.parse(localStorage.getItem(EXPANDED_KEY) || '[]');
    return new Set(Array.isArray(raw) ? raw : []);
  } catch (e) {
    return new Set();
  }
}

function saveExpanded() {
  try { localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expandedSet])); } catch (e) { /* storage penuh / diblok: state cukup di memori */ }
}

const isGroupOpen = (id) => expandedSet.has(id);

// Ubah DOM satu grup tanpa render ulang -> inilah yang memicu transition di nav.css.
function setGroupOpen(id, open, { persist = true } = {}) {
  if (open) expandedSet.add(id); else expandedSet.delete(id);
  if (persist) saveExpanded();
  if (!navEl) return;
  const sub = navEl.querySelector(`.pw-nav-sub[data-group="${CSS.escape(id)}"]`);
  const item = navEl.querySelector(`.pw-nav-item[data-module="${CSS.escape(id)}"]`);
  if (!sub) return;
  sub.classList.toggle('open', open);
  sub.querySelector('.pw-nav-sub-clip')?.toggleAttribute('inert', !open);
  item?.setAttribute('aria-expanded', String(open));
  item?.querySelector('.pw-nav-item-chevron')?.classList.toggle('open', open);
}

// ---- Manual collapse toggle (desktop icon-only rail, persisted) ----
// Separate from the <768px auto-collapse in nav.css (that one's unconditional,
// viewport-driven, no state to track) -- this is a user choice that should
// survive reloads and route changes, same as the theme preference below.
const COLLAPSE_KEY = 'pnm_nav_collapsed';

function isNavCollapsed() {
  return localStorage.getItem(COLLAPSE_KEY) === '1';
}

function applyCollapsedState(collapsed) {
  if (!navEl) return;
  navEl.classList.toggle('collapsed', collapsed);
  const btn = document.getElementById('pwNavCollapseBtn');
  if (btn) {
    const label = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
    btn.setAttribute('aria-label', label);
    btn.setAttribute('aria-expanded', String(!collapsed));
    btn.title = label;
  }
}

function wireCollapseToggle() {
  const btn = document.getElementById('pwNavCollapseBtn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const next = !isNavCollapsed();
    localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
    applyCollapsedState(next);
  });
}

// CLEAN URLS (sesi lanjutan): this file's own links ('.pw-nav-item' /
// '.pw-nav-subitem', see nav-markup.js) are now real '/module[/sub]' paths,
// not '#module' fragments — a plain click on those would otherwise trigger
// a full-page reload. isInternalRoute()/navigateTo() below intercept ONLY
// clicks inside navEl (event delegation, wired once in navMount() — the
// listener survives navSetActive()'s innerHTML re-renders since it's on
// the container, not the <a> elements themselves) and hand the path to
// router.js via a `pnm:navigate` CustomEvent instead of following the
// href natively. router.js listens for that event and does the actual
// pushState + render() — see its own header comment for why this is an
// event rather than a direct import (would make router.js <-> nav.js a
// circular import). Legacy '.html' hrefs (not-yet-migrated modules) are
// deliberately left alone here so they keep doing a real full navigation.
function isInternalRoute(href) {
  return typeof href === 'string' && href.startsWith('/') && !/\.[a-z0-9]+$/i.test(href);
}

function navigateTo(path) {
  window.dispatchEvent(new CustomEvent('pnm:navigate', { detail: { path } }));
}

function wireInternalNav() {
  if (!navEl || navEl.dataset.navClickWired) return; // guard: navMount()/navSetActive() can both call this
  navEl.dataset.navClickWired = '1';
  navEl.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest('a');
    if (!a) return;
    // Modul bersubmenu: klik chevron = buka/tutup saja (tanpa pindah halaman); klik baris modul yang SEDANG
    // aktif = buka/tutup juga (bukan reload halaman yang sama). Klik baris modul lain = pindah modul, dan
    // navSetActive() yang membukakan accordion-nya.
    if (a.classList.contains('pw-nav-item') && a.dataset.hasSub) {
      const id = a.dataset.module;
      if (e.target.closest('.pw-nav-item-chevron') || id === lastActiveId) {
        e.preventDefault();
        setGroupOpen(id, !isGroupOpen(id));
        return;
      }
    }
    const href = a.getAttribute('href') || '';
    if (!isInternalRoute(href)) return; // legacy .html link — let the browser navigate normally
    e.preventDefault();
    navigateTo(href);
  });
}

function applyThemeIcon() {
  const icon = document.getElementById('pwNavThemeIcon');
  if (!icon) return;
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  icon.className = isDark ? 'ti ti-moon' : 'ti ti-sun';
}

// Tema dikelola SATU tempat: window.PNMTheme (shared/theme-init.js, dimuat
// sinkron di <head>). Nav cuma tombol + ikon: klik -> PNMTheme.toggle(), dan
// ikon ikut tiap tema berubah (termasuk dari toggle lain, tab lain, atau OS).
let themeIconUnsub = null;
function wireThemeToggle() {
  const toggle = document.getElementById('pwNavThemeToggle');
  toggle?.addEventListener('click', () => {
    window.PNMTheme?.toggle();
    applyThemeIcon();
  });
  if (!themeIconUnsub && window.PNMTheme) {
    themeIconUnsub = window.PNMTheme.subscribe(applyThemeIcon);
  }
}

async function fillUser() {
  const nameEl = document.getElementById('pwNavUserName');
  const avatarEl = document.getElementById('pwNavAvatar');
  if (!nameEl || !avatarEl || !window.PNMAuth) return;
  try {
    const user = await window.PNMAuth.getUser();
    const email = user?.email || '';
    if (email) {
      nameEl.textContent = email;
      avatarEl.textContent = email[0].toUpperCase();
    }
  } catch (e) {
    // not logged in yet / session not ready — leave the "—" placeholder,
    // this isn't an error state worth surfacing in the nav itself.
  }
}

// ---- Search ----
// Small, dependency-free filter+render — this is a nav-index search (a few
// dozen rows: modules + their sub-items), not a data search, so no need
// for a fuzzy-match library. Plain case-insensitive substring match on
// label+sublabel is plenty for a list this size.

let searchIndex = null; // built lazily on first focus, not at mount time (module list rarely changes mid-session, no reason to pay for it before it's needed)
let searchActiveIndex = -1; // which result row is keyboard-highlighted, -1 = none
let searchResultsCache = [];

function getSearchIndex() {
  if (!searchIndex) searchIndex = buildSearchIndex();
  return searchIndex;
}

function setSearchOverlayState(active) {
  // Direct inline styles, not a CSS class -- a class toggle depends on
  // nav.css's cascade actually winning, which the reported dark-mode bug
  // suggests it wasn't reliably doing. Setting style.visibility straight on
  // the elements is unambiguous: it always wins regardless of any other
  // rule's specificity, and there's nothing left to debug from a screenshot.
  const eyebrow = navEl?.querySelector('.pw-nav-eyebrow');
  const list = navEl?.querySelector('.pw-nav-list');
  const v = active ? 'hidden' : '';
  if (eyebrow) eyebrow.style.visibility = v;
  if (list) list.style.visibility = v;
}

function renderSearchResults(rows) {
  const resultsEl = document.getElementById('pwNavSearchResults');
  if (!resultsEl) return;
  searchResultsCache = rows;
  searchActiveIndex = rows.length ? 0 : -1;
  setSearchOverlayState(true);
  if (!rows.length) {
    resultsEl.innerHTML = `<div class="pw-nav-search-empty">Tidak ada hasil</div>`;
    resultsEl.hidden = false;
    return;
  }
  resultsEl.innerHTML = rows.map((row, i) => `
    <div class="pw-nav-search-result${i === 0 ? ' active' : ''}" data-idx="${i}">
      <i class="ti ${row.icon}"></i>
      <span class="label">${row.label}</span>
      ${row.sublabel ? `<span class="sublabel">${row.sublabel}</span>` : ''}
    </div>`).join('');
  resultsEl.hidden = false;
}

function hideSearchResults() {
  const resultsEl = document.getElementById('pwNavSearchResults');
  if (resultsEl) resultsEl.hidden = true;
  setSearchOverlayState(false);
  searchActiveIndex = -1;
}

function updateSearchActiveHighlight() {
  const resultsEl = document.getElementById('pwNavSearchResults');
  if (!resultsEl) return;
  resultsEl.querySelectorAll('.pw-nav-search-result').forEach((el, i) => {
    el.classList.toggle('active', i === searchActiveIndex);
  });
  const activeEl = resultsEl.querySelector('.pw-nav-search-result.active');
  activeEl?.scrollIntoView({ block: 'nearest' });
}

function goToSearchResult(row) {
  if (!row) return;
  // Uniform for both cases: a '/module[/sub]' value hands off to
  // router.js's pushState-based navigate() (no reload) — a '/page.html'
  // value does a real navigation. Same href every .pw-nav-item already
  // uses (see navItemHtml), just dispatched via JS instead of a native <a>
  // click since results are plain divs (need arrow-key selection, an <a>
  // list makes that fiddlier for no benefit here).
  if (isInternalRoute(row.hash)) {
    navigateTo(row.hash);
  } else {
    window.location.href = row.hash;
  }
}

function wireSearch() {
  const input = document.getElementById('pwNavSearchInput');
  const resultsEl = document.getElementById('pwNavSearchResults');
  if (!input || !resultsEl) return;

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { hideSearchResults(); return; }
    const rows = getSearchIndex().filter((row) =>
      row.label.toLowerCase().includes(q) || (row.sublabel || '').toLowerCase().includes(q)
    ).slice(0, 8);
    renderSearchResults(rows);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!searchResultsCache.length) return;
      searchActiveIndex = (searchActiveIndex + 1) % searchResultsCache.length;
      updateSearchActiveHighlight();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!searchResultsCache.length) return;
      searchActiveIndex = (searchActiveIndex - 1 + searchResultsCache.length) % searchResultsCache.length;
      updateSearchActiveHighlight();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = searchResultsCache[searchActiveIndex];
      if (row) goToSearchResult(row);
    } else if (e.key === 'Escape') {
      input.blur();
      hideSearchResults();
    }
  });

  resultsEl.addEventListener('mousedown', (e) => {
    // mousedown (not click) so this fires BEFORE the input's blur hides
    // the results — click would fire after blur already cleared them.
    const rowEl = e.target.closest('.pw-nav-search-result');
    if (!rowEl) return;
    e.preventDefault();
    const idx = Number(rowEl.dataset.idx);
    goToSearchResult(searchResultsCache[idx]);
  });

  input.addEventListener('blur', () => {
    // small delay so the mousedown handler above still gets to read
    // searchResultsCache before a click-driven blur races it
    setTimeout(hideSearchResults, 120);
  });
  input.addEventListener('focus', () => {
    if (input.value.trim()) input.dispatchEvent(new Event('input'));
  });
}

/**
 * Mount the nav ONCE into the given element. Idempotent — calling this
 * again on the same element is a no-op (guards against a future caller
 * accidentally mounting it per-route instead of once).
 *
 * activeId/activeSub determine which module (and, if that module has a
 * subnav, which sub-item) render as active AND which accordion is
 * expanded — see nav-markup.js's navItemHtml. Re-mounts are no-ops
 * (idempotent), so route changes call navSetActive() below instead of
 * this — but navSetActive() needs the accordion to already reflect the
 * CURRENT module's subnav, and that's baked into the markup at mount
 * time... see navSetActive() for how it actually re-renders when the
 * active module (not just sub) changes.
 */
export async function navMount(container, activeId, activeSub) {
  if (navEl === container) return; // already mounted here
  await ensureStyle();
  expandedSet = loadExpanded();
  if (activeId) expandedSet.add(activeId); // reveal modul aktif, kayak Obsidian buka folder file yang aktif
  saveExpanded();
  container.innerHTML = navMarkup(activeId, activeSub, isGroupOpen);
  navEl = container;
  lastActiveId = activeId;
  lastActiveSub = activeSub || null;
  lastPermSig = navPermSignature();

  applyThemeIcon();
  fillUser();
  wireThemeToggle();

  // Logout — added sesi keenam belas so pages can retire their own
  // page-specific logout button (e.g. konversian's "Keluar") in favor of
  // this one shared spot, without losing the ability to log out entirely.
  // window.PNMAuth may not be loaded yet the very first time navMount()
  // runs (nav mounts before any page's own ensureVendorScripts() resolves)
  // — check fresh at click time, not at mount time.
  const logoutBtn = document.getElementById('pwNavLogoutBtn');
  logoutBtn?.addEventListener('click', async () => {
    if (!window.PNMAuth) return;
    logoutBtn.disabled = true;
    try {
      await window.PNMAuth.logout();
    } finally {
      logoutBtn.disabled = false;
    }
  });

  applyCollapsedState(isNavCollapsed());
  wireCollapseToggle();
  wireSearch();
  wireInternalNav(); // event delegation on navEl itself, so this survives navSetActive()'s innerHTML re-renders — no need to re-call it there

  // "/" focuses the search input, same shortcut the design spec's mono "/" hint
  // implies — now actually does something, see wireSearch() above.
  const input = document.getElementById('pwNavSearchInput');
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
      e.preventDefault();
      input?.focus();
    }
  });
}

/**
 * Call on every route change so the correct nav item (and, if the module
 * has a subnav, the correct sub-item + expanded accordion) highlights.
 *
 * UPDATE (sesi lanjutan): now takes an optional `sub` param. If the
 * ACTIVE MODULE changed (not just the sub-route within the same module),
 * a full re-render is needed — the accordion markup for the newly-active
 * module doesn't exist in the DOM yet (see navItemHtml: sub-items only
 * render for the active module at all). If only `sub` changed within the
 * SAME module, a cheap class-toggle is enough, same as before.
 */
export function navSetActive(activeId, sub) {
  if (!navEl) return;
  // Akun lain login di tab yang sama tanpa reload: nav ini dibuat sekali, jadi daftar modul akun sebelumnya bisa
  // tertinggal. Sidik jari berubah -> paksa render ulang penuh dan buang indeks pencarian yang basi.
  const permSig = navPermSignature();
  const permChanged = permSig !== lastPermSig;
  lastPermSig = permSig;
  if (permChanged) searchIndex = null;
  const activeModuleChanged = activeId !== lastActiveId;
  lastActiveId = activeId;
  lastActiveSub = sub || null;

  // Pindah modul -> buka accordion modul tujuan (yang lain dibiarkan sesuai pilihan user).
  const reveal = activeModuleChanged && activeId && !isGroupOpen(activeId);

  if (permChanged) {
    // Render ulang penuh HANYA kalau daftar modul/submodul berubah (akun lain login). Pindah modul biasa
    // tidak lagi lewat sini, supaya elemen tetap hidup dan transition buka/tutup bisa berjalan.
    // Blok brand (logo + nama) TIDAK ikut dibuat ulang: elemen lama dipindah balik ke markup baru,
    // supaya logo tidak berkedip.
    if (reveal) { expandedSet.add(activeId); saveExpanded(); }
    const keptBrand = navEl.querySelector('.pw-nav-brand');
    navEl.innerHTML = navMarkup(activeId, sub, isGroupOpen);
    if (keptBrand) navEl.querySelector('.pw-nav-brand')?.replaceWith(keptBrand);
    applyThemeIcon();
    fillUser();
    // Listener yang menempel di elemen yang baru diganti harus dipasang ulang (theme/logout/collapse/search).
    // wireInternalNav() tidak perlu: delegasi di navEl sendiri.
    wireThemeToggle();
    const logoutBtn = document.getElementById('pwNavLogoutBtn');
    logoutBtn?.addEventListener('click', async () => {
      if (!window.PNMAuth) return;
      logoutBtn.disabled = true;
      try { await window.PNMAuth.logout(); } finally { logoutBtn.disabled = false; }
    });
    applyCollapsedState(isNavCollapsed());
    wireCollapseToggle();
    wireSearch();
    return;
  }

  // Update in-place: cuma pindahin class .active, tanpa menyentuh struktur DOM.
  navEl.querySelectorAll('.pw-nav-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.module === activeId);
  });
  navEl.querySelectorAll('.pw-nav-subitem').forEach((el) => {
    el.classList.toggle('active', el.dataset.module === activeId && el.dataset.sub === sub);
  });
  if (reveal) setGroupOpen(activeId, true);
}
