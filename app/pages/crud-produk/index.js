// crud-produk page module: mount(container) / unmount().
// Per map.md bagian 4 urutan #4 (auth swap + SPA wrap sekaligus, sesi
// kesebelas). Pendekatan sama kayak konversian's index.js (lihat komentar
// di file itu): body ASLI crud-produk.js TIDAK di-rescope dari
// document.getElementById(...) ke container.querySelector(...) di ratusan
// titik pemanggilan -- itu berisiko tinggi buat file sebesar ini tanpa test
// browser end-to-end. Aman karena document.getElementById tetap nemu elemen
// yang benar selama cuma SATU halaman yang termount di satu waktu (dijamin
// router.js: container.innerHTML dikosongin SEBELUM halaman baru di-mount).
//
// Yang BEDA dari konversian (yang "murni bungkus doang, auth udah PNMAuth
// penuh"): file ini SEBELUMNYA masih "setengah jalan" kayak export-gambar
// dulu -- sudah pakai window.pnmSupabase (shared client), tapi masih manggil
// sb.auth.signInWithPassword/signOut/onAuthStateChange langsung, bukan
// PNMAuth.*. Sekarang sudah diganti penuh ke PNMAuth.login/logout/
// onAuthStateChange (lihat 4 titik bertanda "SPA migration" di bawah).
// sb.auth.refreshSession() di tombol "Proses" Bulk INAPROC Tracker SENGAJA
// TETAP dipakai langsung (bukan lewat PNMAuth) -- itu forced server-verify
// sebelum batch panjang, beda dari getSession()/getAccessToken() yang cuma
// baca cache lokal; PNMAuth belum punya wrapper buat ini, sama seperti
// export-gambar sengaja mempertahankan sb.from('allowed_users') langsung.
//
// 4 patch bedah kecil lain (semua ditandai komentar "SPA migration" di
// titik masing-masing):
//   1. Listener document click (filter popover outside-click) dan window
//      resize di-nama-in + ditangkep ke var module-scope, biar unmount()
//      bisa lepas -- beda dari listener yang nempel di elemen DALAM
//      container (otomatis ke-GC pas container.innerHTML dikosongin).
//   2. Listener document keydown (Ctrl+K command palette) sama, di-nama-in.
//   3. Listener window beforeunload (warning "ada perubahan belum
//      disimpan") sama, di-nama-in -- WAJIB dilepas, kalau kebiarin bakal
//      ngecek elemen modal yang udah detached dari DOM begitu user pindah
//      ke halaman SPA lain.
//   4. `window.openEdit = async function(...)` (monkey-patch buat nyisipin
//      logic sembunyi-tab-kalau-SET) diubah jadi `openEdit = ...` tanpa
//      `window.` -- classic-script sloppy-mode ngalias `window.foo` <->
//      binding lokal `foo` buat top-level function declarations, tapi alias
//      itu HILANG begitu kode ini pindah ke dalam function scope (mount()).
//      Reassign binding lokal langsung balik kerja sama persis kayak
//      sebelumnya, karena semua pemanggil `openEdit(...)` lain sekarang satu
//      function scope yang sama.

import { CRUD_PRODUK_MARKUP } from './markup.js';
import { showToast, crudConfirm, crudAlert, renderPgBar, parseLinkV6 } from './ui-utils.js';
import { installAkdMaster } from './akd-master.js';
import { installKfa } from './kfa.js';
import { installBulk } from './bulk.js';

// supabase-js CDN -> shared/supabase-client.js -> shared/auth-session.js
// harus berurutan (tiap file bergantung ke global yang dibikin file
// sebelumnya, sama kayak export-gambar/konversian). xlsx (buat Excel export)
// dan shared/toast.js sama-sama independen dari chain itu DAN dari satu sama
// lain -- makanya dijalankan paralel, bukan ikut dirantai.
const AUTH_CHAIN_SCRIPTS = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  '/shared/supabase-client.js',
  '/shared/auth-session.js',
];
//
// xlsx-js-style (BUKAN 'xlsx' polos) -- fork MIT/gratis dari SheetJS yang
// SAMA PERSIS API-nya (masih nempelin global window.XLSX yang sama, semua
// pemanggilan XLSX.utils.*/XLSX.writeFile di bawah gak perlu diubah), tapi
// beda dari 'xlsx' community biasa: fork ini BENERAN nulis cell style
// (font.bold, fill warna) ke file .xlsx-nya. 'xlsx' versi polos diam-diam
// BUANG properti `ws[cell].s` pas nulis -- dites langsung (bikin file .xlsx
// pake keduanya, unzip, cek xl/styles.xml): versi polos cellXfs-nya cuma 1
// entry default, gak ada font bold/fill custom sama sekali biarpun
// di-set eksplisit di kode. Baru ketauan kalau file jadinya dibuka di Excel,
// bukan dari error apapun -- exportPricelistSales() di bawah butuh header
// bold+background biar "siap konsumsi sales" beneran, bukan cuma klaim.
const INDEPENDENT_SCRIPTS = [
  'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js',
  '/shared/toast.js',
];

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Gagal memuat ' + src));
    document.head.appendChild(s);
  });
}

let vendorReady = null;
function ensureVendorScripts() {
  if (window.PNMAuth && window.pnmSupabase && window.XLSX && window.PNMToast) return Promise.resolve();
  if (!vendorReady) {
    const chain = AUTH_CHAIN_SCRIPTS.reduce(
      (p, src) => p.then(() => loadScript(src)),
      Promise.resolve()
    );
    vendorReady = Promise.all([chain, ...INDEPENDENT_SCRIPTS.map(loadScript)]);
  }
  return vendorReady;
}

// pnm-universal.css: sama seperti fix di konversian/index.js (sesi
// kesembilan/kesepuluh) -- di-load pas mount(), DILEPAS pas unmount(), bukan
// "shared selamanya", biar gak bocor ke halaman lain. tabler-icons id+href
// SAMA PERSIS kayak punya konversian (versi 3.31.0) -- sengaja disamakan
// biar dua halaman ini beneran share satu <link> yang sama, bukan cuma
// kebetulan mirip. JetBrains Mono di sini beda subset weight dari yang
// dipakai konversian (400;500 vs cuma 400), jadi id-nya SENGAJA dibedain
// (shared-jetbrains-mono-crud, bukan reuse shared-google-fonts) supaya gak
// ada dua halaman yang rebutan satu <link> buat href yang beda.
const SHARED_LINKS = [
  { id: 'shared-jetbrains-mono-crud', href: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap' },
  { id: 'shared-tabler-icons', href: 'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.31.0/dist/tabler-icons.min.css' },
  { id: 'shared-pnm-universal-css', href: '/pnm-universal.css?v=20260813b' },
];

function loadLink(id, href) {
  if (document.getElementById(id)) return Promise.resolve();
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = () => resolve();
    link.onerror = () => resolve(); // don't block forever if a CDN is down
    document.head.appendChild(link);
  });
}

function ensureStyle() {
  return Promise.all([
    ...SHARED_LINKS.map(({ id, href }) => loadLink(id, href)),
    loadLink('page-crud-produk-style', new URL('./style.css', import.meta.url).href),
  ]);
}

let mountedContainer = null;
let filterPopOutsideClickHandler = null;
let resizeHandler = null;
let cmdkKeydownHandler = null;
// Module-level indirection for setSubroute() (real top-level export, see
// far below near unmount()) to reach switchView(), which stays a NESTED
// function inside mount() -- see switchView()'s own comment for why.
let _switchView = null;
let beforeUnloadHandler = null;

// ═══ COORD LOG (baca dulu sebelum edit — file ini kepakai/kesentuh 2+ sesi Claude paralel) ═══
// 2026-08-14: fix dedup bulk INAPROC tracker — status "Disetujui" menang duluan atas nomor
//   permohonan duplikat, tanggal cuma dipakai buat tie-break (dulu murni tanggal terbaru,
//   ada edge case "Disetujui" ketiban "Ditolak" dari baris duplikat bertanggal lebih baru) — Claude
// 2026-08-12: shared auth layer + navigasi konversian<->crud-produk + theme-fix + cache-busting — Claude (sesi arsitektur)
// Kalau kamu Claude/sesi lain yang mau edit file ini: tambahin baris baru di atas (jangan hapus riwayatnya), ringkas 1 baris apa yang berubah + tanggal.
// ═══════════════════════════════════════════════════════════════════════════
const SUPABASE_URL = 'https://ptkkbsemihcyndisjoor.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB0a2tic2VtaWhjeW5kaXNqb29yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0Njc4MzgsImV4cCI6MjA5ODA0MzgzOH0.QsCqmcqQcXvz1f8bLkagvMbAGUBbBP-3Wa5Aore5OMo';
// Instance client SEKARANG dari shared/supabase-client.js (satu client, satu
// storageKey pnm_auth_session, dipakai semua modul) -- bukan bikin baru lagi
// di sini. sb.from/sb.rpc/sb.storage/sb.auth di bawah SEMUA tetap jalan sama
// persis, gak ada titik lain di file ini yang perlu diubah.
// SPA migration FIX: `const sb = window.pnmSupabase` TIDAK BOLEH di module
// scope (di sini) -- module ini di-import() router.js SEBELUM
// ensureVendorScripts() sempat jalan, jadi window.pnmSupabase masih undefined
// pas baris ini dieksekusi (beda dari classic-script asli, di mana urutan
// <script> tag di <head> udah menjamin shared/supabase-client.js kelar duluan
// sebelum crud-produk.js ini dievaluasi). Sekarang di-assign di DALAM mount(),
// SETELAH await ensureVendorScripts() -- lihat di bawah.
const THUMB_BASE = 'https://ptkkbsemihcyndisjoor.supabase.co/storage/v1/object/public/thumbnails/';

const SEAL_LABELS = {
  terhubung: 'Terhubung',
  belum_diajukan: 'Perlu AKD',
  belum_firm: 'Belum Firm',
  di_luar_cakupan: 'Di Luar Cakupan'
};
function sealHtml(status){
  const s = status || 'null';
  const label = SEAL_LABELS[status] || 'Belum Ada';
  return `<span class="seal seal-${s}">${label}</span>`;
}
const TIPE_TO_AKD = { INSTRUMENT: 'satuan', SET: 'set', UNIT: 'unit' };

// BUGFIX (sesi keamanan, 15 September 2026): escapeHtml() dulu cuma
// dideklarasikan di dalam mount()'s closure (baris jauh di bawah), padahal
// renderInaprocIndikator() ini -- pemanggilnya -- ada di scope MODUL (luar
// mount()). ReferenceError: escapeHtml is not defined tiap buka detail
// produk yang punya status INAPROC. Dipindah ke sini (scope modul) supaya
// kepanggil dari mana aja, termasuk dari dalam mount() (closure bisa lihat
// ke luar, bukan sebaliknya).
function escapeHtml(s){
  return String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

// Hint live di bawah field Link V6: kuning kalau isinya bukan URL bersih.
// Cuma peringatan (gak ngeblok simpan) — data lama/sync dari Sheet bisa aja
// udah kebawa catatan, dan tim mungkin memang sengaja nandain begitu.
function renderLinkV6Hint(){
  const el = document.getElementById('linkV6Hint');
  const inp = document.getElementById('f_link_v6');
  if (!el || !inp) return;
  const L = parseLinkV6(inp.value);
  if (L.state === 'catatan') {
    el.innerHTML = '<i class="ti ti-alert-circle"></i> Link ini ada catatan tambahan (<b>' + escapeHtml(L.catatan.slice(0, 80)) + '</b>) — di Konversian TIDAK akan dilabeli "Ada di e-Katalog". Isi URL-nya doang kalau memang sudah bersih.';
    el.style.display = '';
  } else if (L.state === 'invalid') {
    el.innerHTML = '<i class="ti ti-alert-circle"></i> Isi bukan URL — dianggap belum ada link.';
    el.style.display = '';
  } else {
    el.style.display = 'none';
  }
}

function renderInaprocIndikator(statusInaproc, linkV6){
  const el = document.getElementById('inaprocIndikator');
  if (!statusInaproc) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  let cls = 'seal-null', label = statusInaproc;
  if (statusInaproc === 'Disetujui') cls = 'seal-terhubung';
  else if (statusInaproc === 'Ditolak') cls = 'seal-belum_diajukan';
  else if (statusInaproc === 'Menunggu Persetujuan') cls = 'seal-belum_firm';
  let extra = '';
  if (statusInaproc === 'Disetujui' && !linkV6) {
    extra = ' <span style="color:var(--rust-text);font-size:11.5px;">— sudah disetujui INAPROC, belum ada Link V6, siap dibuatkan!</span>';
  }
  el.innerHTML = `<span style="font-size:11px;color:var(--text-muted);">Status INAPROC:</span> <span class="seal ${cls}">${escapeHtml(label)}</span>${extra}`;
}

export async function mount(container, initialSub) {
  mountedContainer = container;
  await Promise.all([ensureStyle(), ensureVendorScripts()]);
  // sb baru bisa di-assign DI SINI, bukan module scope -- lihat catatan
  // panjang di komentar THUMB_BASE di atas. window.pnmSupabase dijamin ada
  // di titik ini karena baris di atas sudah nunggu ensureVendorScripts().
  const sb = window.pnmSupabase;
  // S: shared state buat modul hasil breakup (akd-master.js dkk), pola sama
  // kayak konversian/index.js -- installXxx(S) dipanggil di bawah, modul
  // baca/tulis ke S buat apa pun yang lintas-file (bukan window global).
  const S = { sb, escapeHtml };
  container.innerHTML = CRUD_PRODUK_MARKUP;

  // ── inline script (theme-init) — SEBELUMNYA hidup sebagai <script> inline
  // di <head>/atas <body> crud-produk.html asli (jalan sebelum body ke-parse,
  // biar gak ada flash tema salah). <script> di dalam markup HTML yang
  // di-assign lewat innerHTML gak otomatis jalan (DOM quirk), jadi logic-nya
  // dipindah ke sini sebagai kode JS beneran — posisi sama persis kayak
  // pola yang sama di konversian/index.js. ──
  (function(){
    const saved = localStorage.getItem('theme') || localStorage.getItem('pnum-theme');
    const theme = saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.style.colorScheme = theme;
    document.documentElement.setAttribute('data-theme', theme);
  })();

// ---- Theme ----
// NOTE: data-theme attribute is already set as early as possible by the
// inline script right after <body> (prevents flash of light theme before
// this external file loads). The toggle control itself now lives ONLY in
// the shared sidebar nav (app/pages/nav/nav.js) -- it already reads/writes
// the same "theme" localStorage key and the same <html data-theme>
// attribute this page's own CSS reacts to, so removing this page's own
// duplicate toggle (was: #themeToggle/#themeIcon in the topbar) needed no
// other change here. Single source of truth: <html data-theme>, not
// <body> — pnm-universal.css only reacts to the attribute on <html>.

// ---- Sidebar nav (stub views) ----
// UPDATE (sesi lanjutan -- "double nav" fix): this page's own <aside
// class="sidebar"> (5 data-view buttons + brand/collapse/user/logout) is
// GONE from markup.js -- those 5 views now live in the GLOBAL sidebar's
// accordion instead (app/pages/nav/, expands under crud-produk's item
// automatically since crud-produk/subnav.js registers them). This was
// the literal "double nav" complaint: two sidebars rendering side by
// side, one from the shared shell and one from this page. switchView()
// itself is UNCHANGED in what it does (still just toggles which
// #view<Name> block is visible) -- only the "how do I get called" side
// changed: previously a click listener on THIS page's own buttons,
// now setSubroute() (module-level, see far below) is called by router.js
// when the URL's sub-route changes, and an initial call happens at the
// bottom of mount(). See crud-produk/subnav.js + router.js for the other
// half of this.
//
// switchView() itself stays a NESTED function inside mount() (unchanged
// from before this session) rather than moving to module top-level -- it
// closes over DOM references cached earlier in mount()'s body, moving it
// out would risk breaking those. Instead, mount() hands a reference to it
// to `_switchView` (declared at true module top-level, above mount()) so
// the real top-level `export function setSubroute` below can reach it.
// (Fix: an EARLIER version of this edit put `export function setSubroute`
// directly here, nested INSIDE mount()'s body -- invalid ES module syntax,
// `export` must be top-level. node --check didn't catch it; a browser or
// any real module-aware parser -- including the TS language server, which
// is how this got caught -- does. This comment + the top-level
// `_switchView`/`setSubroute` pair below is the fix.)
// Same "Module / Page" breadcrumb pattern as konversian's switchSubTab()
// -- see that function's comment for the reasoning. Keys match
// CRUD_PRODUK_SUBNAV's ids (subnav.js) since both drive off the same
// switchView(view) values.
const CRUD_VIEW_LABELS = {
  produk: 'Produk',
  set: 'Set Management',
  akd: 'AKD',
  kfa: 'KFA Management',
  bulk: 'Bulk Edit',
  sync: 'Sync dari Sheet',
};
function switchView(view){
  ['produk','set','akd','kfa','bulk','sync'].forEach(v => {
    document.getElementById('view' + v.charAt(0).toUpperCase() + v.slice(1)).style.display = (v === view) ? 'block' : 'none';
  });
  const crumbEl = document.getElementById('pw-topbar-crumb-text');
  if (crumbEl && CRUD_VIEW_LABELS[view]) crumbEl.textContent = CRUD_VIEW_LABELS[view];
  document.getElementById('addBtn').style.display = (view === 'produk') ? '' : 'none';
  document.querySelector('.view-toggle').style.display = (view === 'produk') ? '' : 'none';
  if (view === 'akd' && !akdLoadedOnce) { akdLoadedOnce = true; S.loadAkdDistinctValues(); S.loadAkd(); }
  if (view === 'kfa' && !kfaLoadedOnce) { kfaLoadedOnce = true; S.loadKfa(); S.refreshKfaFilterCounts(); }
  // 'sync' RELOAD tiap kali masuk (bukan sekali doang kayak akd/kfa) --
  // daftar ini berubah tiap pollAndSync jalan di background (tiap 5
  // menit), jadi data basi kalau cuma dimuat sekali per mount().
  if (view === 'sync') S.loadSyncUnmatched();
  // 'set' punya semantik beda dari akd/kfa's "sekali doang" -- dipindah
  // dari listener terpisah yang tadinya nempel di tombol sidebar sendiri
  // (`.sb-item[data-view="set"]`, gak ada lagi): reload SETIAP kali masuk
  // view Set, KECUALI lagi ada detail panel yang lagi kebuka (biar gak
  // ilang begitu aja). Behavior persis sama kayak sebelumnya, cuma
  // tempat manggilnya yang pindah.
  if (view === 'set' && (!document.getElementById('setDetailWrap') || document.getElementById('setDetailWrap').style.display === 'none')) {
    loadSetList();
  }
}
let akdLoadedOnce = false;
let kfaLoadedOnce = false;
_switchView = switchView; // expose to the real top-level setSubroute() far below

// ---- Auth ----
// Sesi kesembilan belas: per-page gate (gateWrap/loginFormWrap/gateMsg,
// checkWhitelistAndShowApp(), local onAuthStateChange subscription for
// gate purposes) DIHAPUS SELURUHNYA. router.js gak pernah mount() modul
// ini sampai shared/auth-gate.js konfirmasi sesi valid + whitelisted
// duluan -- jadi begitu mount() jalan, sesi SUDAH PASTI ada dan SUDAH
// PASTI whitelisted.
//
// UPDATE (sesi lanjutan): userEmailLabel/logoutBtn (+ the PNMAuth.getUser()
// call that filled the former) DIHAPUS -- keduanya cuma dupliat dari apa
// yang GLOBAL nav udah tampilin (.pw-nav-user-name/.pw-nav-logoutBtn di
// app/pages/nav/), sekarang satu-satunya sumber begitu sidebar page ini
// sendiri dibongkar (lihat komentar switchView() di atas). Tetep langsung
// load konten seperti biasa.
//
// FIX (koreksi lagi): 3 baris ini SEMPET ditaro persis di sini (posisi
// paling awal, niatnya "fire secepat mungkin, paralel sama setup
// lainnya" -- sama kayak sebelum sesi lanjutan) -- TAPI `loadProduk()`
// baca/nulis `lastQuery`, sebuah `let` yang baru DIDEKLARASIKAN ratusan
// baris di bawah sini (lihat dekat `topSearchInput`). Manggil fungsi yang
// butuh binding `let` itu SEBELUM baris deklarasinya sendiri sempet
// jalan = `ReferenceError: Cannot access 'lastQuery' before
// initialization` (temporal dead zone) -- persis error yang user laporan
// dari browser beneran. Dipindah ke UJUNG mount() (tepat sebelum
// `switchView(initialSub || 'produk')` yang udah ada di situ) supaya
// SEMUA `let`/`const` di seluruh body mount() udah pasti kejalanin
// duluan -- satu-satunya titik yang dijamin aman dari TDZ tanpa harus
// nelusurin semua dependency loadProduk()/refreshProdukFilterCounts()/
// handleNavParamsIfAny() satu-satu. Delay-nya gak berarti (masih di
// dalam pemanggilan mount() yang sama, sinkron, bukan nunggu event loop
// balik dulu).
// ?edit=<kode_produk> otomatis buka modal edit produk itu. ?return_to=konversian
// (+ opsional &return_sesi=<id>) nampilin tombol balik yang bawa user ke
// konversian.html?resume=1&refreshed=<kode>&sesi=<id> — refresh 1 kartu +
// resume sesi lewat mekanisme ?sesi= yang emang udah ada di sana (dipakai
// fitur share WhatsApp). Semua opt-in lewat query param; kalau halaman ini
// diakses langsung (bukan dari alur ini), gak ada bedanya sama sekarang.
// ══════════════════════════════════════════
let pnmReturnCtx = null; // {to, sesi, kode} — null kalau bukan hasil navigasi dari modul lain

async function handleNavParamsIfAny() {
  const params = new URLSearchParams(window.location.search);
  const returnTo = params.get('return_to');
  const editKode = params.get('edit');

  if (returnTo === 'konversian') {
    pnmReturnCtx = { to: 'konversian', sesi: params.get('return_sesi') || null, kode: editKode || null };
    const btn = document.getElementById('btnKembaliKonversi');
    btn.style.display = 'inline-flex';
    btn.addEventListener('click', () => {
      // SPA migration (sesi kesebelas): '/app/shell.html' -> '/' (root
      // sudah jadi shell sejak sesi ketujuh; /app/shell.html masih hidup
      // sebagai alias tapi gak ada alasan lagi buat dipakai eksplisit di
      // sini). CLEAN URLS (sesi lanjutan): target sekarang '/konversian'
      // langsung (real path), bukan '/' + '#konversian' lagi. Ini genuine
      // full-page navigation (bukan in-place SPA nav) — sama persis pola
      // yang dipakai navigateToEditProduk() di konversian/index.js buat
      // arah sebaliknya.
      const url = new URL('/konversian', window.location.href);
      url.searchParams.set('resume', '1');
      if (pnmReturnCtx.kode) url.searchParams.set('refreshed', pnmReturnCtx.kode);
      if (pnmReturnCtx.sesi) url.searchParams.set('sesi', pnmReturnCtx.sesi);
      window.location.href = url.toString();
    });
  }

  if (editKode) {
    const { data, error } = await sb.from('produk').select('id').eq('kode_produk', editKode).maybeSingle();
    if (error || !data) {
      showToast('Produk dengan kode ' + editKode + ' tidak ditemukan', true);
      return;
    }
    openEdit(data.id);
  }
}

// ---- Log Aktivitas ----
const LOG_ACTION_LABELS = { INSERT: 'Tambah', UPDATE: 'Ubah', DELETE: 'Hapus' };
const LOG_TABLE_LABELS = { produk: 'Produk', produk_harga: 'Harga', produk_media: 'Media', master_produk: 'Master Produk', produk_akd: 'Relasi AKD', produk_set_item: 'Komposisi Set', akd: 'AKD' };
const logModalOverlay = document.getElementById('logModalOverlay');
document.getElementById('logToggle').addEventListener('click', () => { logModalOverlay.classList.add('open'); loadLog(1); });
document.getElementById('logModalCloseBtn').addEventListener('click', () => logModalOverlay.classList.remove('open'));
logModalOverlay.addEventListener('click', e => { if (e.target === logModalOverlay) logModalOverlay.classList.remove('open'); });
document.getElementById('log_refresh').addEventListener('click', () => loadLog(1));
document.getElementById('log_tanggal').addEventListener('change', () => loadLog(1));
document.getElementById('log_table').addEventListener('change', () => loadLog(1));
document.getElementById('log_action').addEventListener('change', () => loadLog(1));

let logPage = 1;
const LOG_PAGE_SIZE = 30;

async function loadLog(page){
  logPage = page || logPage || 1;
  const logList = document.getElementById('logList');
  logList.innerHTML = '<div style="color:var(--text-muted);padding:14px;">Memuat log...</div>';
  let query = sb.from('audit_log').select('*', { count: 'exact' }).order('changed_at', { ascending: false });
  const tgl = document.getElementById('log_tanggal').value;
  const tbl = document.getElementById('log_table').value;
  const act = document.getElementById('log_action').value;
  if (tgl) query = query.gte('changed_at', tgl + 'T00:00:00').lte('changed_at', tgl + 'T23:59:59');
  if (tbl) query = query.eq('table_name', tbl);
  if (act) query = query.eq('action', act);
  const from = (logPage - 1) * LOG_PAGE_SIZE;
  const to = from + LOG_PAGE_SIZE - 1;
  query = query.range(from, to);

  const { data, error, count } = await query;
  if (error) { logList.innerHTML = `<div style="color:var(--rust);padding:14px;">Gagal memuat log: ${escapeHtml(error.message)}</div>`; return; }
  const total = count || 0;
  renderPgBar(document.getElementById('logPagination'), {
    page: logPage, pageSize: LOG_PAGE_SIZE, total,
    onPageChange: (p) => loadLog(p)
  });
  if (!data || data.length === 0) { logList.innerHTML = '<div style="color:var(--text-muted);padding:14px;">Tidak ada aktivitas.</div>'; return; }

  logList.innerHTML = '';
  data.forEach((row, idx) => {
    const el = document.createElement('div');
    el.className = 'log-entry';
    const jam = new Date(row.changed_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    el.innerHTML = `
      <div class="log-entry-top">
        <span class="log-action ${row.action}">${LOG_ACTION_LABELS[row.action] || row.action}</span>
        <span class="log-table">${LOG_TABLE_LABELS[row.table_name] || row.table_name}</span>
        <span class="log-meta">${jam} · ${escapeHtml(row.changed_by || 'tidak diketahui')}</span>
      </div>
      <div class="log-summary">${buildLogSummary(row)}</div>
      <button class="log-diff-toggle" data-idx="${idx}">Lihat detail</button>
      <div class="log-diff" id="logdiff-${idx}">${escapeHtml(JSON.stringify({ before: row.old_data, sesudah: row.new_data }, null, 2))}</div>
    `;
    el.querySelector('.log-diff-toggle').addEventListener('click', e => {
      const diffEl = document.getElementById('logdiff-' + idx);
      diffEl.classList.toggle('open');
      e.target.textContent = diffEl.classList.contains('open') ? 'Sembunyikan detail' : 'Lihat detail';
    });
    logList.appendChild(el);
  });
}
function buildLogSummary(row){
  const label = LOG_TABLE_LABELS[row.table_name] || row.table_name;
  const idText = row.record_id ? `<span class="kode-cell">${escapeHtml(row.record_id)}</span>` : '';
  if (row.action === 'INSERT') {
    const nama = row.new_data?.nama_produk || row.new_data?.judul || row.new_data?.deskripsi_vendor || '';
    return `Menambahkan ${label} ${idText}${nama ? ' — ' + escapeHtml(nama) : ''}`;
  }
  if (row.action === 'DELETE') {
    const nama = row.old_data?.nama_produk || row.old_data?.judul || '';
    return `Menghapus ${label} ${idText}${nama ? ' — ' + escapeHtml(nama) : ''}`;
  }
  const before = row.old_data || {}, after = row.new_data || {};
  const changed = Object.keys(after).filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k]) && k !== 'updated_at');
  const fieldsText = changed.length ? changed.slice(0, 4).join(', ') + (changed.length > 4 ? `, +${changed.length - 4} lainnya` : '') : 'tidak ada field berubah';
  return `Mengubah ${label} ${idText} — field: ${escapeHtml(fieldsText)}`;
}

// ================================================================
// PRODUK LIST — search pakai RPC search_produk_dengan_harga
// ================================================================
let currentProdukId = null;
let masterExists = false;
let hargaRows = [];
let mediaRows = [];
let currentAkdLinks = [];
let currentView = localStorage.getItem('produkView') || 'table';

// showToast/crudConfirm/crudAlert/renderPgBar DIPINDAH ke ./ui-utils.js
// (breakup sesi ini — 4 fungsi ini gak nyimpen/baca state apa pun selain
// parameter + document.getElementById + window.PNMToast, jadi aman
// diekspor langsung tanpa pola installXxx(S) kayak modul konversian).
// Logic-nya TIDAK diubah, cuma dipindah lokasi + jadi named export.

const tableBody = document.getElementById('tableBody');
const cardWrap = document.getElementById('cardWrap');
const tableWrap = document.getElementById('tableWrap');
const produkCount = document.getElementById('produkCount');
const viewTableBtn = document.getElementById('viewTableBtn');
const viewCardBtn = document.getElementById('viewCardBtn');

function setView(v){
  currentView = v;
  localStorage.setItem('produkView', v);
  viewTableBtn.classList.toggle('active', v === 'table');
  viewCardBtn.classList.toggle('active', v === 'card');
  tableWrap.style.display = v === 'table' ? 'block' : 'none';
  cardWrap.style.display = v === 'card' ? 'grid' : 'none';
}
viewTableBtn.addEventListener('click', () => setView('table'));
viewCardBtn.addEventListener('click', () => setView('card'));
setView(currentView);

let lastQuery = '';
let topSearchTimer = null;
const topSearchInput = document.getElementById('topSearchInput');
const topSearchClear = document.getElementById('topSearchClear');
topSearchInput.addEventListener('input', () => {
  clearTimeout(topSearchTimer);
  topSearchClear.style.display = topSearchInput.value ? 'block' : 'none';
  topSearchTimer = setTimeout(() => {
    switchView('produk');
    loadProduk(topSearchInput.value);
  }, 300);
});
topSearchClear.addEventListener('click', () => {
  topSearchInput.value = '';
  topSearchClear.style.display = 'none';
  loadProduk('');
  topSearchInput.focus();
});

let produkPage = 1;
const PRODUK_PAGE_SIZE = 30;
let produkSearchRawRows = []; // hasil lengkap dari RPC search_produk_dengan_harga, BELUM difilter status
let produkSearchAllRows = []; // produkSearchRawRows setelah difilter status_akd/link, di-page di client

// ---- Filter status (chip bar di atas list Produk) ----
// 'all' gak butuh kondisi tambahan. Sisanya map ke kolom status_akd, kecuali
// 'disetujui_tanpa_link' yang kondisinya gabungan status_inaproc + link_v6 kosong
// (logic-nya sama persis kayak renderInaprocIndikator() di modal edit, cuma di sini
// dipakai buat nyaring list, bukan cuma nampilin di satu produk).
const PRODUK_FILTERS = {
  all: null,
  belum_diajukan: p => p.status_akd === 'belum_diajukan',
  belum_firm: p => p.status_akd === 'belum_firm',
  di_luar_cakupan: p => p.status_akd === 'di_luar_cakupan',
  terhubung: p => p.status_akd === 'terhubung',
  disetujui_tanpa_link: p => p.status_inaproc === 'Disetujui' && !p.link_v6,
};
let produkActiveFilter = 'all';
function applyProdukFilterToQuery(query, filterKey){
  if (filterKey === 'disetujui_tanpa_link') return query.eq('status_inaproc', 'Disetujui').is('link_v6', null);
  if (filterKey && filterKey !== 'all') return query.eq('status_akd', filterKey);
  return query;
}

const PRODUK_LIST_COLUMNS = 'id, kode_produk, nama_produk, tipe, golongan, is_active, status_akd, status_inaproc, link_v6, updated_at';

// ---- Filter bertumpuk ("+ Tambah Filter") — di-AND-kan di atas chip status di atas
// DAN di atas search yang lagi aktif. Sengaja dipasang di sini (Produk), bukan di
// halaman AKD, karena semua dimensinya adalah properti produk (golongan, tipe,
// is_active, status_inaproc, ketersediaan harga) — bukan properti AKD.
let produkActiveFilters = []; // [{ dim, value, label }]
let produkDistinct = { tipe: [], golongan: [], status_inaproc: [] };
let produkHargaIdSet = null; // Set<produk_id> yang SUDAH punya baris produk_harga, dimuat lazy pas dimensi "harga" dipakai
let produkCurrentFilteredFull = null; // hasil filter lengkap dari jalur search (client-side match) -> sumber Download Excel pas search aktif

const PRODUK_FILTER_DIMS = [
  { key: 'tipe', label: 'Tipe', icon: 'ti-category-2', dynamic: 'tipe', multi: true },
  { key: 'golongan', label: 'Golongan', icon: 'ti-tag', dynamic: 'golongan' },
  { key: 'is_active', label: 'Status Aktif', icon: 'ti-toggle-right', options: [
      { value: 'aktif', label: 'Aktif' },
      { value: 'nonaktif', label: 'Nonaktif' },
  ]},
  { key: 'status_inaproc', label: 'Status INAPROC', icon: 'ti-shield-check', dynamic: 'status_inaproc' },
  { key: 'harga', label: 'Ketersediaan Harga', icon: 'ti-currency-dollar', options: [
      { value: 'ada', label: 'Sudah ada harga' },
      { value: 'kosong', label: 'Belum ada harga' },
  ]},
  { key: 'link_v6', label: 'Link V6', icon: 'ti-link', options: [
      { value: 'ada', label: 'Sudah ada link' },
      { value: 'kosong', label: 'Belum ada link' },
  ]},
];

async function loadProdukDistinctValues(){
  // Dulu: 3x sb.from('produk').select(...).limit(3000) lalu di-Set() di JS --
  // rawan motong diam-diam kalau salah satu tipe/golongan jumlahnya jauh lebih
  // banyak dari yang lain (ini penyebab "Tipe" cuma nongol INSTRUMENT, SET & UNIT
  // ilang). Sekarang DISTINCT dihitung penuh di Postgres, gak ada limit baris.
  const { data, error } = await sb.rpc('get_produk_distinct_filters');
  if (error) {
    showToast('Gagal memuat opsi filter: ' + error.message, true);
    return;
  }
  produkDistinct.tipe = data?.tipe || [];
  produkDistinct.golongan = data?.golongan || [];
  produkDistinct.status_inaproc = data?.status_inaproc || [];
}

async function ensureProdukHargaSet(){
  if (produkHargaIdSet) return;
  // RPC balikin SATU baris array (bukan ribuan baris satu-satu), jadi gak
  // kena limit baris PostgREST berapapun besar produk_harga nanti tumbuh
  // -- beda dari .select('produk_id').limit(20000) yang dulu kepotong diam-diam
  // pas produk_harga sudah 22 ribu baris (2 ribu produk salah kelihatan "belum ada harga").
  const { data, error } = await sb.rpc('get_produk_harga_ids');
  if (error) {
    showToast('Gagal cek ketersediaan harga: ' + error.message, true);
    produkHargaIdSet = new Set();
    return;
  }
  produkHargaIdSet = new Set(data || []);
}
function invalidateProdukStackCache(){
  produkHargaIdSet = null;
}

function produkRowMatchesFilter(row, filt){
  switch (filt.dim) {
    case 'tipe': return filt.values ? filt.values.includes(row.tipe) : row.tipe === filt.value;
    case 'golongan': return row.golongan === filt.value;
    case 'is_active': return filt.value === 'aktif' ? !!row.is_active : !row.is_active;
    case 'status_inaproc': return row.status_inaproc === filt.value;
    case 'harga': {
      const has = produkHargaIdSet.has(row.id);
      return filt.value === 'ada' ? has : !has;
    }
    case 'link_v6': return filt.value === 'ada' ? !!row.link_v6 : !row.link_v6;
    default: return true;
  }
}

// Konversi produkActiveFilters (dipilih lewat "+ Tambah Filter") jadi parameter
// bernama buat RPC get_produk_list -- filternya dihitung penuh di Postgres
// (join EXISTS ke produk_harga buat dimensi "harga", bukan lagi cross-check
// manual ke produkHargaIdSet di client).
function buildProdukDimParams(){
  const params = { p_tipe: null, p_golongan: null, p_is_active: null, p_status_inaproc: null, p_harga: null, p_link_v6: null };
  produkActiveFilters.forEach(f => {
    if (f.dim === 'tipe') params.p_tipe = f.values || (f.value ? [f.value] : null);
    else if (f.dim === 'golongan') params.p_golongan = f.value;
    else if (f.dim === 'is_active') params.p_is_active = f.value === 'aktif';
    else if (f.dim === 'status_inaproc') params.p_status_inaproc = f.value;
    else if (f.dim === 'harga') params.p_harga = f.value;
    else if (f.dim === 'link_v6') params.p_link_v6 = f.value;
  });
  return params;
}

async function loadProduk(q, page){
  const newQ = (q ?? lastQuery ?? '').trim();
  const searchChanged = newQ !== (lastQuery ?? '').trim();
  lastQuery = newQ;
  produkPage = searchChanged ? 1 : (page || produkPage || 1);
  const qq = newQ;

  tableBody.innerHTML = `<tr class="state-row"><td colspan="5">Memuat data...</td></tr>`;
  cardWrap.innerHTML = '';
  produkCount.textContent = 'Memuat...';

  const needsHarga = produkActiveFilters.some(f => f.dim === 'harga');
  if (needsHarga) await ensureProdukHargaSet();

  let rows = [];
  let total = 0;
  if (qq) {
    // pakai RPC search yang sudah ranked (token search + trigram + fast-path exact match)
    // RPC ini ambil SEMUA hasil match sekaligus (gak dukung limit/offset dan gak dukung
    // filter status tambahan), jadi paging DAN filter status dilakukan di client dari
    // produkSearchRawRows — bukan query ulang tiap ganti halaman/filter.
    if (searchChanged) {
      const { data: rpcData, error: rpcErr } = await sb.rpc('search_produk_dengan_harga', { q: qq, p_tipe: null, only_akd: false, only_kfa: false });
      if (rpcErr) { tableBody.innerHTML = `<tr class="state-row"><td colspan="5">Gagal mencari: ${escapeHtml(rpcErr.message)}</td></tr>`; return; }
      const kodeList = (rpcData || []).map(r => r.kode_produk);
      if (kodeList.length === 0) { produkSearchRawRows = []; }
      else {
        const { data: fullRows, error: fullErr } = await sb.from('produk')
          .select(PRODUK_LIST_COLUMNS)
          .in('kode_produk', kodeList);
        if (fullErr) { tableBody.innerHTML = `<tr class="state-row"><td colspan="5">Gagal memuat: ${escapeHtml(fullErr.message)}</td></tr>`; return; }
        const byKode = Object.fromEntries((fullRows || []).map(r => [r.kode_produk, r]));
        produkSearchRawRows = kodeList.map(k => byKode[k]).filter(Boolean);
      }
    }
    const matcher = PRODUK_FILTERS[produkActiveFilter];
    let filtered = matcher ? produkSearchRawRows.filter(matcher) : produkSearchRawRows;
    produkActiveFilters.forEach(f => { filtered = filtered.filter(r => produkRowMatchesFilter(r, f)); });
    produkSearchAllRows = filtered;
    produkCurrentFilteredFull = filtered;
    total = filtered.length;
    rows = filtered.slice((produkPage - 1) * PRODUK_PAGE_SIZE, produkPage * PRODUK_PAGE_SIZE);
  } else if (produkActiveFilters.length > 0) {
    // Ada filter tambahan aktif ("+ Tambah Filter") tapi gak lagi search.
    // Dulu: full-fetch .limit(20000) sekali lalu filter+slice manual di JS --
    // sama persis pola yang pernah bikin produk_harga undercount pas datanya
    // tembus batas limit. Sekarang chip status + semua dimensi filter dihitung
    // & dipaging penuh di Postgres lewat satu RPC.
    const { data, error } = await sb.rpc('get_produk_list', {
      p_status_filter: produkActiveFilter,
      ...buildProdukDimParams(),
      p_page: produkPage,
      p_page_size: PRODUK_PAGE_SIZE,
    });
    if (error) { tableBody.innerHTML = `<tr class="state-row"><td colspan="5">Gagal memuat: ${escapeHtml(error.message)}</td></tr>`; return; }
    rows = data?.rows || [];
    total = data?.total || 0;
    produkCurrentFilteredFull = null; // gak lagi nyimpen array penuh di client -> export narik ulang lewat RPC (lihat exportProdukToExcel)
  } else {
    produkCurrentFilteredFull = null;
    const from = (produkPage - 1) * PRODUK_PAGE_SIZE;
    const to = from + PRODUK_PAGE_SIZE - 1;
    let query = sb.from('produk')
      .select(PRODUK_LIST_COLUMNS, { count: 'exact' });
    query = applyProdukFilterToQuery(query, produkActiveFilter);
    const { data, error, count } = await query
      .order('updated_at', { ascending: false })
      .range(from, to);
    if (error) { tableBody.innerHTML = `<tr class="state-row"><td colspan="5">Gagal memuat: ${escapeHtml(error.message)}</td></tr>`; return; }
    rows = data || [];
    total = count || 0;
  }

 // FIX: loadProduk() ini async dengan beberapa await ke Supabase di atas --
  // kalau user pindah halaman (menu lain) SEBELUM salah satu await itu
  // resolve, container udah dikosongin router.js dan mountedContainer di-null-
  // kan di unmount() sebelum kode di bawah ini sempet lanjut. Tanpa guard ini,
  // produkCount.textContent/tableBody.innerHTML masih "aman" (nunjuk elemen
  // lama yang cuma detached, gak throw), TAPI
  // document.getElementById('produkPagination') query FRESH dan balik null ->
  // renderPgBar(null, ...) throw. Bail out di sini daripada nunggu ketauan di
  // renderPgBar.
  if (!mountedContainer) return;
  produkCount.textContent = total + ' produk' + (qq ? ` untuk "${qq}"` : '') +
    (produkActiveFilters.length ? ` · ${produkActiveFilters.length} filter tambahan aktif` : '');
  renderPgBar(document.getElementById('produkPagination'), {
    page: produkPage, pageSize: PRODUK_PAGE_SIZE, total,
    onPageChange: (p) => loadProduk(qq, p)
  });

  if (rows.length === 0) {
    tableBody.innerHTML = `<tr class="state-row"><td colspan="5">Tidak ada produk ditemukan.</td></tr>`;
    cardWrap.innerHTML = `<div class="stub-box" style="grid-column:1/-1;">Tidak ada produk ditemukan.</div>`;
    return;
  }

  // FIX (urgent — "harga mismatch crud vs konversi"): this used to be a raw
  // `sb.from('produk_harga').select('produk_id').in('produk_id', idsOnPage)`.
  // produk_harga stores one row per (tahun x jenis) -- every price write
  // inserts 3 rows (EKATALOG/SWASTA/UPLOAD, see upsertHargaDariEkat) -- so
  // for a page of 20-50 products with any meaningful price history, that
  // query could return hundreds of rows with no .limit()/pagination.
  // PostgREST caps unbounded selects like that around 1000 rows by default,
  // so on unlucky pages the response got silently truncated and the last
  // few products' rows dropped out, making them wrongly show "belum ada
  // harga" even though konversian (which gets harga_ekat/harga_swasta
  // pre-resolved one-per-product from search_produk_dengan_harga, never a
  // raw multi-row pull) showed the price fine. This is the EXACT bug class
  // already diagnosed & fixed once in this file for the filter-dimension
  // case (see ensureProdukHargaSet()'s comment above, get_produk_harga_ids
  // RPC) -- just never applied here. Reusing that same cached, RPC-backed
  // Set instead of a fresh row-limited query fixes it the same way.
  await ensureProdukHargaSet();
  const hargaExistIds = produkHargaIdSet;
  const ONE_DAY = 24 * 60 * 60 * 1000;
  function attentionMeta(p){
    const noHarga = !hargaExistIds.has(p.id);
    const noLink = p.status_inaproc === 'Disetujui' && !p.link_v6;
    const recentlyUpdated = p.updated_at && (Date.now() - new Date(p.updated_at).getTime()) < ONE_DAY;
    return { noHarga, noLink, recentlyUpdated };
  }

  tableBody.innerHTML = '';
  cardWrap.innerHTML = '';
  rows.forEach(p => {
    const { noHarga, noLink, recentlyUpdated } = attentionMeta(p);
    const noLinkIcon = noLink ? '<i class="ti ti-link-off" title="Disetujui INAPROC, belum ada Link V6" style="color:var(--rust-text);"></i>' : '';
    const tr = document.createElement('tr');
    tr.className = 'clickable' + (noHarga || noLink ? ' row-attention' : '');
    tr.innerHTML = `
      <td class="kode-cell">${escapeHtml(p.kode_produk)}${recentlyUpdated ? '<span class="dot-updated" title="Diubah dalam 24 jam terakhir"></span>' : ''}</td>
      <td>${escapeHtml(p.nama_produk || '—')}</td>
      <td><span class="tipe-chip">${escapeHtml(p.tipe || '—')}</span></td>
      <td>${sealHtml(p.status_akd)} ${noLinkIcon}</td>
      <td style="text-align:right;color:var(--text-muted);">${noHarga ? '<i class="ti ti-currency-dollar-off" title="Belum ada harga"></i>' : ''}${p.is_active ? '' : ' <i class="ti ti-eye-off" title="Nonaktif"></i>'}</td>
    `;
    tr.addEventListener('click', () => { if (p.tipe === 'SET') { goToSetDetail(p.id); } else { openEdit(p.id); } });
    tableBody.appendChild(tr);

    const card = document.createElement('div');
    card.className = 'prod-card' + (noHarga || noLink ? ' row-attention' : '');
    card.innerHTML = `
      <div class="pc-kode">${escapeHtml(p.kode_produk)}${recentlyUpdated ? '<span class="dot-updated" title="Diubah dalam 24 jam terakhir"></span>' : ''}</div>
      <div class="pc-nama">${escapeHtml(p.nama_produk || '—')}</div>
      <div class="pc-foot"><span class="tipe-chip">${escapeHtml(p.tipe || '—')}</span>${sealHtml(p.status_akd)}${noLinkIcon}${noHarga ? '<i class="ti ti-currency-dollar-off" title="Belum ada harga" style="color:var(--amber);margin-left:4px;"></i>' : ''}</div>
    `;
    card.addEventListener('click', () => { if (p.tipe === 'SET') { goToSetDetail(p.id); } else { openEdit(p.id); } });
    cardWrap.appendChild(card);
  });
}

// ---- Klik chip filter status di atas list Produk ----
document.querySelectorAll('#produkFilterBar .filter-chip').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.filter === produkActiveFilter) return;
    produkActiveFilter = btn.dataset.filter;
    document.querySelectorAll('#produkFilterBar .filter-chip').forEach(b => b.classList.toggle('active', b === btn));
    loadProduk(lastQuery, 1);
  });
});

// ---- Filter builder ("+ Tambah Filter") — sama pola kayak yang dulu ada di AKD,
// cuma dimensinya properti Produk (golongan, tipe, aktif/nonaktif, status INAPROC,
// ketersediaan harga), dan ditumpuk di atas chip status + search yang lagi aktif.
const produkAddFilterBtn = document.getElementById('produkAddFilterBtn');
const produkAddFilterPop = document.getElementById('produkAddFilterPop');
produkAddFilterBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const willOpen = !produkAddFilterPop.classList.contains('open');
  renderProdukFilterPopStep1();
  produkAddFilterPop.classList.toggle('open');
  if (willOpen) positionAddFilterPop();
});
// SPA migration: listener document/window-level ini di-nama-in (bukan anonymous)
// dan ditangkep ke var module-scope biar unmount() bisa removeEventListener --
// kalau kebiarin anonymous, bakal nyangkut nempel ke document/window walau
// halaman ini udah gak ke-mount lagi (beda dari listener yang nempel di elemen
// dalam container, yang otomatis ke-GC pas container.innerHTML dikosongin).
filterPopOutsideClickHandler = (e) => {
  if (produkAddFilterPop.classList.contains('open') && !produkAddFilterPop.contains(e.target) && e.target !== produkAddFilterBtn) {
    produkAddFilterPop.classList.remove('open');
  }
};
document.addEventListener('click', filterPopOutsideClickHandler);
resizeHandler = () => { if (produkAddFilterPop.classList.contains('open')) positionAddFilterPop(); };
window.addEventListener('resize', resizeHandler);
function positionAddFilterPop(){
  // Popover default nempel rata kiri ke tombol; kalau bakal kepotong tepi kanan
  // layar (misal di layar sempit / tombol deket ujung), balik jadi rata kanan
  // biar seluruh isinya tetap kebaca, gak "mepet".
  produkAddFilterPop.classList.remove('align-right');
  const rect = produkAddFilterPop.getBoundingClientRect();
  if (rect.right > window.innerWidth - 12) {
    produkAddFilterPop.classList.add('align-right');
  }
}
function renderProdukFilterPopStep1(){
  produkAddFilterPop.innerHTML = `<div class="afp-step">
    <div class="afp-header">
      <div class="afp-header-text">
        <div class="afp-title">Tambah Filter</div>
        <div class="afp-subtitle">Pilih dimensi yang mau difilter</div>
      </div>
      <button class="afp-close" id="produkAfpClose" title="Tutup"><i class="ti ti-x"></i></button>
    </div>
    <div class="afp-list">
      ${PRODUK_FILTER_DIMS.map(d => `<button class="afp-dim-btn" data-dim="${d.key}">
          <span class="afp-dim-icon"><i class="ti ${d.icon || 'ti-filter'}"></i></span>
          <span class="afp-dim-label">${escapeHtml(d.label)}</span>
          <i class="ti ti-chevron-right"></i>
        </button>`).join('')}
    </div>
  </div>`;
  document.getElementById('produkAfpClose').addEventListener('click', (e) => { e.stopPropagation(); produkAddFilterPop.classList.remove('open'); });
  produkAddFilterPop.querySelectorAll('.afp-dim-btn').forEach(b => {
    b.addEventListener('click', (e) => { e.stopPropagation(); renderProdukFilterPopStep2(b.dataset.dim); });
  });
}
function renderProdukFilterPopStep2(dimKey){
  const dim = PRODUK_FILTER_DIMS.find(d => d.key === dimKey);
  let options = dim.options;
  if (dim.dynamic) {
    options = (produkDistinct[dim.dynamic] || []).map(v => ({ value: v, label: v }));
    if (!options.length) options = [{ value: '', label: '(belum ada data terisi)' }];
  }

  if (dim.multi) {
    // Pilih banyak nilai sekaligus dalam satu dimensi (misal Tipe: SET + INSTRUMENT)
    // -> hasil filter di-OR-kan di antara nilai yang dicentang, lalu di-AND-kan
    // seperti biasa dengan dimensi/chip status lain. Prefill centang dari filter
    // yang lagi aktif kalau user buka ulang dimensi yang sama buat diubah.
    const existing = produkActiveFilters.find(f => f.dim === dimKey);
    const selected = new Set(existing?.values || []);
    produkAddFilterPop.innerHTML = `<div class="afp-step">
      <div class="afp-back" id="produkAfpBack"><i class="ti ti-arrow-left"></i> Kembali</div>
      <div class="afp-header" style="border-bottom:none;margin-bottom:6px;padding-bottom:0;">
        <div class="afp-header-text">
          <div class="afp-title">${escapeHtml(dim.label)}</div>
          <div class="afp-subtitle">Bisa pilih lebih dari satu</div>
        </div>
      </div>
      <div class="afp-list">
        ${options.map(o => `<label class="afp-check-row${o.value === '' ? ' disabled' : ''}">
            <input type="checkbox" data-value="${escapeHtml(o.value)}" ${selected.has(o.value) ? 'checked' : ''} ${o.value === '' ? 'disabled' : ''}/>
            <span>${escapeHtml(o.label)}</span>
          </label>`).join('')}
      </div>
      <button class="afp-apply-btn" id="produkAfpApply">Terapkan</button>
    </div>`;
    document.getElementById('produkAfpBack').addEventListener('click', (e) => { e.stopPropagation(); renderProdukFilterPopStep1(); });
    document.getElementById('produkAfpApply').addEventListener('click', (e) => {
      e.stopPropagation();
      const values = Array.from(produkAddFilterPop.querySelectorAll('input[type="checkbox"]:checked')).map(c => c.dataset.value);
      if (values.length === 0) {
        removeProdukFilter(dimKey);
      } else {
        const labels = values.map(v => (options.find(o => o.value === v) || {}).label || v);
        addProdukFilterMulti(dimKey, values, dim.label + ': ' + labels.join(', '));
      }
      produkAddFilterPop.classList.remove('open');
    });
    return;
  }

  produkAddFilterPop.innerHTML = `<div class="afp-step">
    <div class="afp-back" id="produkAfpBack"><i class="ti ti-arrow-left"></i> Kembali</div>
    <div class="afp-header" style="border-bottom:none;margin-bottom:6px;padding-bottom:0;">
      <div class="afp-header-text"><div class="afp-title">${escapeHtml(dim.label)}</div></div>
    </div>
    <div class="afp-list">
      ${options.map(o => `<button class="afp-dim-btn" data-value="${escapeHtml(o.value)}" ${o.value === '' ? 'disabled' : ''}><span class="afp-dim-label">${escapeHtml(o.label)}</span></button>`).join('')}
    </div>
  </div>`;
  document.getElementById('produkAfpBack').addEventListener('click', (e) => { e.stopPropagation(); renderProdukFilterPopStep1(); });
  produkAddFilterPop.querySelectorAll('.afp-dim-btn[data-value]:not([disabled])').forEach(b => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      addProdukFilter(dimKey, b.dataset.value, dim.label + ': ' + b.textContent.trim());
      produkAddFilterPop.classList.remove('open');
    });
  });
}
function addProdukFilter(dim, value, label){
  produkActiveFilters = produkActiveFilters.filter(f => f.dim !== dim); // satu dimensi = satu nilai aktif, ganti kalau dipilih ulang
  produkActiveFilters.push({ dim, value, label });
  renderProdukFilterChips();
  loadProduk(lastQuery, 1);
}
function addProdukFilterMulti(dim, values, label){
  produkActiveFilters = produkActiveFilters.filter(f => f.dim !== dim);
  produkActiveFilters.push({ dim, values, label });
  renderProdukFilterChips();
  loadProduk(lastQuery, 1);
}
function removeProdukFilter(dim){
  produkActiveFilters = produkActiveFilters.filter(f => f.dim !== dim);
  renderProdukFilterChips();
  loadProduk(lastQuery, 1);
}
function renderProdukFilterChips(){
  const el = document.getElementById('produkFilterChips');
  el.innerHTML = produkActiveFilters.map(f => `<span class="adv-filter-chip" data-dim="${f.dim}">${escapeHtml(f.label)}<button title="Hapus filter ini"><i class="ti ti-x"></i></button></span>`).join('');
  el.querySelectorAll('.adv-filter-chip button').forEach(btn => {
    btn.addEventListener('click', () => removeProdukFilter(btn.parentElement.dataset.dim));
  });
}

// ---- Ambil baris yang mau di-export, respect filter+search yang lagi aktif.
// Dipakai bareng exportProdukToExcel (dump semua kolom, admin/QA) DAN
// exportPricelistSales (kolom terbatas + harga beneran, buat sales) --
// biar behavior "ikut filter chip + search yang lagi aktif" konsisten,
// gak keduplikasi/berisiko divergen di 2 tempat.
async function getRowsToExport(){
  let rowsToExport;
  if (lastQuery.trim()) {
    // Search aktif -> hasil match sudah lengkap di produkSearchAllRows (RPC search
    // gak paging), filter tambahan sudah diterapkan di client -> produkCurrentFilteredFull.
    rowsToExport = produkCurrentFilteredFull || [];
  } else {
    // Gak ada search -> tarik SEMUA baris yang cocok chip status + filter tambahan
    // langsung dari get_produk_list dengan p_page_size null (dihitung & difilter
    // penuh di Postgres). Dulu ini .limit(20000) mentah dari .from('produk'),
    // sekarang gak ada lagi angka ajaib yang bisa diam-diam motong data.
    const { data, error } = await sb.rpc('get_produk_list', {
      p_status_filter: produkActiveFilter,
      ...buildProdukDimParams(),
      p_page: 1,
      p_page_size: null,
    });
    if (error) { showToast('Gagal export: ' + error.message, true); return null; }
    rowsToExport = data?.rows || [];
  }
  return rowsToExport;
}

// ---- Deskripsi filter+search yang lagi aktif, dalam bentuk kalimat/tag pendek.
// Dipakai buat ngasih bukti visual di file export (judul + nama file) bahwa
// export-nya BENERAN ngikut filter yang lagi kepilih di layar (chip status +
// SEMUA dimensi dari "Tambah Filter" -- Tipe/Golongan/dll -- + search box),
// bukan cuma "katanya" ngikut. label chip status diambil langsung dari teks
// tombolnya di DOM (bukan map hardcoded terpisah) biar otomatis sinkron kalau
// nanti ada yang nambah/ubah teks chip di markup.js.
function describeActiveFilters(){
  const parts = [];
  if (produkActiveFilter !== 'all') {
    const chipBtn = document.querySelector(`.filter-chip[data-filter="${produkActiveFilter}"]`);
    if (chipBtn) {
      const clone = chipBtn.cloneNode(true);
      const countEl = clone.querySelector('.fc-count');
      if (countEl) countEl.remove();
      const label = clone.textContent.trim();
      if (label) parts.push(label);
    }
  }
  produkActiveFilters.forEach(f => { if (f.label) parts.push(f.label); });
  if (lastQuery.trim()) parts.push(`cari "${lastQuery.trim()}"`);
  return parts;
}
// Versi slug buat nama file (dipakai exportProdukToExcel yang sudah ada DAN
// exportPricelistSales) -- sengaja dari raw dim/filter key, bukan dari label
// describeActiveFilters() di atas (label bisa berisi spasi/simbol yang jelek
// buat nama file).
function buildFilterFilenameTag(){
  return (produkActiveFilter !== 'all' ? '_' + produkActiveFilter : '') +
    (produkActiveFilters.length ? '_' + produkActiveFilters.map(f => f.dim).join('-') : '') +
    (lastQuery.trim() ? '_search' : '');
}

// ---- Ambil harga EKATALOG & SWASTA (tahun terbaru per produk) buat sekumpulan
// produk_id sekaligus. Dipecah per-chunk (bukan satu .in() raksasa) biar gak
// kena limit panjang query PostgREST kalau id-nya ratusan/ribuan.
async function fetchHargaLatestMap(produkIds){
  const map = new Map(); // produk_id -> {tahun, ekatalog, swasta}
  const CHUNK = 300;
  for (let i = 0; i < produkIds.length; i += CHUNK) {
    const chunk = produkIds.slice(i, i + CHUNK);
    const { data, error } = await sb.from('produk_harga')
      .select('produk_id,tahun,jenis,harga')
      .in('produk_id', chunk);
    if (error) { showToast('Gagal ambil data harga: ' + error.message, true); return null; }
    (data || []).forEach(h => {
      const existing = map.get(h.produk_id);
      // EKATALOG adalah harga input manual (lihat upsertHargaDariEkat) -- SWASTA/UPLOAD
      // cuma turunan rumus di tahun yang sama, jadi "tahun terbaru" ditentukan dari
      // baris EKATALOG-nya. Kalau produk punya >1 tahun, ambil yang paling baru.
      if (!existing || h.tahun > existing.tahun) {
        map.set(h.produk_id, { tahun: h.tahun, ekatalog: null, swasta: null });
      }
      const entry = map.get(h.produk_id);
      if (h.tahun === entry.tahun) {
        if (h.jenis === 'EKATALOG') entry.ekatalog = h.harga;
        if (h.jenis === 'SWASTA') entry.swasta = h.harga;
      }
    });
  }
  return map;
}

// ---- Download Excel (hasil filter yang lagi aktif — chip status + filter tambahan
// + search, bukan cuma halaman yang lagi tampil) ----
async function exportProdukToExcel(){
  const needsHarga = produkActiveFilters.some(f => f.dim === 'harga');
  if (needsHarga) await ensureProdukHargaSet();

  const rowsToExport = await getRowsToExport();
  if (rowsToExport === null) return; // error sudah di-toast di getRowsToExport
  if (!rowsToExport.length) { showToast('Tidak ada data untuk diexport', true); return; }
  await ensureProdukHargaSet();
  const sheetData = rowsToExport.map(r => ({
    'Kode Produk': r.kode_produk || '',
    'Nama Produk': r.nama_produk || '',
    'Tipe': r.tipe || '',
    'Golongan': r.golongan || '',
    'Status AKD': SEAL_LABELS[r.status_akd] || r.status_akd || '',
    'Status INAPROC': r.status_inaproc || '',
    'Link V6': r.link_v6 || '',
    'Aktif': r.is_active ? 'Ya' : 'Tidak',
    'Sudah Ada Harga': produkHargaIdSet.has(r.id) ? 'Ya' : 'Tidak',
  }));
  const ws = XLSX.utils.json_to_sheet(sheetData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Produk');
  const dateStr = new Date().toISOString().slice(0, 10);
  const filterTag = buildFilterFilenameTag();
  XLSX.writeFile(wb, `produk_export_${dateStr}${filterTag || '_semua'}.xlsx`);
  showToast(`Excel terdownload — ${rowsToExport.length} baris`);
}
document.getElementById('produkExportBtn').addEventListener('click', exportProdukToExcel);

// ---- Export Pricelist (Sales): beda tujuan dari exportProdukToExcel di atas --
// itu dump audit/QA (semua kolom internal, flag Ya/Tidak doang buat harga, dipakai
// admin ngecek data mana yang masih bolong). Ini KHUSUS buat dikirim ke sales:
// - Cuma kolom yang relevan buat jualan (gak ada Status AKD/INAPROC yang internal).
// - Harga beneran keluar angkanya (EKATALOG & SWASTA, tahun terbaru), bukan Ya/Tidak.
// - Cuma produk yang BENERAN siap jual (ada Link V6 katalog DAN ada harga EKATALOG)
//   yang masuk -- baris "Ya" di kolom lama tapi ternyata harganya kosong (kejadian
//   sebelum fix ini, lihat produk_export_2026-09-18_harga-link_v6.xlsx yang dikirim
//   user) otomatis gak akan pernah nongol lagi, difilter di sini, bukan cuma di UI.
// - Header bold+warna & kolom harga format Rp (lihat komentar xlsx-js-style di atas
//   file -- 'xlsx' community biasa DIAM-DIAM buang style ini pas nulis file).
async function exportPricelistSales(){
  const rowsToExport = await getRowsToExport();
  if (rowsToExport === null) return;
  if (!rowsToExport.length) { showToast('Tidak ada data untuk diexport', true); return; }

  const hargaMap = await fetchHargaLatestMap(rowsToExport.map(r => r.id));
  if (hargaMap === null) return;

  const withLink = rowsToExport.filter(r => parseLinkV6(r.link_v6).state === 'bersih');
  const priced = withLink.filter(r => {
    const h = hargaMap.get(r.id);
    return h && h.ekatalog != null;
  });
  const skippedNoLink = rowsToExport.length - withLink.length;
  const skippedNoHarga = withLink.length - priced.length;

  if (!priced.length) {
    showToast('Gak ada produk yang sekaligus punya Link V6 & harga EKATALOG di hasil filter ini — gak ada yang bisa di-pricelist-kan.', true);
    return;
  }

  // Urut per Golongan lalu Nama Produk -- lebih enak dipakai sales nyari barang
  // per kategori daripada urutan kode produk mentah.
  priced.sort((a, b) => {
    const g = (a.golongan || '').localeCompare(b.golongan || '', 'id');
    if (g !== 0) return g;
    return (a.nama_produk || '').localeCompare(b.nama_produk || '', 'id');
  });

  const HEADER = ['No', 'Kode Produk', 'Nama Produk', 'Golongan', 'Harga EKATALOG', 'Harga SWASTA', 'Tahun Harga', 'Link Katalog'];
  const dateStr = new Date().toISOString().slice(0, 10);
  const filterParts = describeActiveFilters();
  const subtitle = (filterParts.length ? filterParts.join(' · ') + ' — ' : 'Semua produk — ') + `per ${dateStr} — ${priced.length} produk`;

  const aoa = [['PRICELIST PRODUK'], [subtitle], HEADER];
  priced.forEach((r, idx) => {
    const h = hargaMap.get(r.id);
    aoa.push([idx + 1, r.kode_produk || '', r.nama_produk || '', r.golongan || '', h.ekatalog, h.swasta != null ? h.swasta : '', h.tahun, r.link_v6 || '']);
  });

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const lastCol = HEADER.length - 1; // 0-based, kolom H
  const lastRow = aoa.length - 1;    // 0-based

  // Judul + subjudul: merge sepanjang kolom.
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: lastCol } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: lastCol } },
  ];
  ws['A1'].s = { font: { bold: true, sz: 15 } };
  ws['A2'].s = { font: { italic: true, sz: 10.5, color: { rgb: '666666' } } };

  // Header kolom (baris index 2 / row Excel ke-3): bold, teks putih, background
  // biru, border tipis, + autofilter (dropdown sort/filter bawaan Excel) biar
  // sales sendiri bisa sortir/filter lanjut di Excel tanpa balik minta ke kita.
  const thinBorder = { style: 'thin', color: { rgb: 'D9D9D9' } };
  const headerStyle = {
    font: { bold: true, color: { rgb: 'FFFFFF' } },
    fill: { fgColor: { rgb: '2F5496' } },
    alignment: { vertical: 'center', horizontal: 'center' },
    border: { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder },
  };
  HEADER.forEach((_, c) => {
    const addr = XLSX.utils.encode_cell({ r: 2, c });
    if (ws[addr]) ws[addr].s = headerStyle;
  });
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 2, c: 0 }, e: { r: 2, c: lastCol } }) };

  // Baris data: border tipis di semua sel + selang-seling warna (zebra) biar
  // enak dibaca pas barisnya panjang, format Rp di kolom harga, rata tengah
  // buat kolom No & Tahun.
  for (let r = 3; r <= lastRow; r++) {
    const isEven = (r - 3) % 2 === 1;
    for (let c = 0; c <= lastCol; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      if (!cell) continue;
      const style = { border: { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder } };
      if (isEven) style.fill = { fgColor: { rgb: 'F2F2F2' } };
      if (c === 0 || c === 6) style.alignment = { horizontal: 'center' }; // No, Tahun Harga
      if ((c === 4 || c === 5) && typeof cell.v === 'number') cell.z = '"Rp" #,##0'; // Harga EKATALOG/SWASTA
      cell.s = style;
    }
  }

  ws['!cols'] = [
    { wch: 5 },   // No
    { wch: 22 },  // Kode Produk
    { wch: 45 },  // Nama Produk
    { wch: 18 },  // Golongan
    { wch: 16 },  // Harga EKATALOG
    { wch: 16 },  // Harga SWASTA
    { wch: 12 },  // Tahun Harga
    { wch: 45 },  // Link Katalog
  ];
  ws['!rows'] = [{ hpt: 22 }, { hpt: 16 }, { hpt: 18 }]; // judul, subjudul, header dikasih tinggi lebih pas

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Pricelist');
  const filterTag = buildFilterFilenameTag();
  XLSX.writeFile(wb, `pricelist_sales_${dateStr}${filterTag || '_semua'}.xlsx`);

  let msg = `Pricelist terdownload — ${priced.length} produk`;
  const skippedNote = [];
  if (skippedNoLink) skippedNote.push(`${skippedNoLink} dilewati (belum ada Link V6 / link belum bersih)`);
  if (skippedNoHarga) skippedNote.push(`${skippedNoHarga} dilewati (belum ada harga EKATALOG)`);
  if (skippedNote.length) msg += ` · ${skippedNote.join(', ')}`;
  showToast(msg);
}
document.getElementById('produkExportPricelistBtn').addEventListener('click', exportPricelistSales);

// ---- Angka di tiap chip (total per kategori, independen dari search/pagination) ----
async function refreshProdukFilterCounts(){
  const defs = [
    ['all', q => q],
    ['belum_diajukan', q => q.eq('status_akd', 'belum_diajukan')],
    ['belum_firm', q => q.eq('status_akd', 'belum_firm')],
    ['di_luar_cakupan', q => q.eq('status_akd', 'di_luar_cakupan')],
    ['terhubung', q => q.eq('status_akd', 'terhubung')],
    ['disetujui_tanpa_link', q => q.eq('status_inaproc', 'Disetujui').is('link_v6', null)],
  ];
  const results = await Promise.all(defs.map(([key, apply]) =>
    apply(sb.from('produk').select('id', { count: 'exact', head: true }))
      .then(r => [key, r.error ? null : (r.count ?? 0)])
  ));
  results.forEach(([key, count]) => {
    const el = document.getElementById('fc-' + key);
    if (el) el.textContent = count === null ? '' : ` · ${count}`;
  });
}

// debounce search dari topbar? -> topbar sekarang cuma trigger command palette,
// browsing halaman utama pakai default list (tanpa query) + refresh tiap buka.
loadProduk('');
refreshProdukFilterCounts();
loadProdukDistinctValues();

// ================================================================
// COMMAND PALETTE (⌘K) — search pakai RPC yang sama
// ================================================================
const cmdkOverlay = document.getElementById('cmdkOverlay');
const cmdkInput = document.getElementById('cmdkInput');
const cmdkList = document.getElementById('cmdkList');
const cmdkTrigger = document.getElementById('cmdkTrigger');
let cmdkResults = [];
let cmdkActiveIdx = -1;
let cmdkTimer = null;

function openCmdk(){
  cmdkOverlay.classList.add('open');
  cmdkInput.value = '';
  cmdkList.innerHTML = '<div class="cmdk-empty">Ketik untuk mencari produk...</div>';
  cmdkResults = []; cmdkActiveIdx = -1;
  setTimeout(() => cmdkInput.focus(), 30);
}
function closeCmdk(){ cmdkOverlay.classList.remove('open'); }
cmdkTrigger.addEventListener('click', openCmdk);
cmdkOverlay.addEventListener('click', e => { if (e.target === cmdkOverlay) closeCmdk(); });
document.getElementById('cmdkCloseBtn').addEventListener('click', closeCmdk);

cmdkKeydownHandler = e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openCmdk(); }
  if (e.key === 'Escape' && cmdkOverlay.classList.contains('open')) closeCmdk();
};
document.addEventListener('keydown', cmdkKeydownHandler);

cmdkInput.addEventListener('input', () => {
  clearTimeout(cmdkTimer);
  const q = cmdkInput.value.trim();
  if (!q) { cmdkList.innerHTML = '<div class="cmdk-empty">Ketik untuk mencari produk...</div>'; cmdkResults = []; return; }
  cmdkTimer = setTimeout(async () => {
    const { data, error } = await sb.rpc('search_produk_dengan_harga', { q, p_tipe: null, only_akd: false, only_kfa: false });
    if (error) { cmdkList.innerHTML = `<div class="cmdk-empty">Gagal mencari: ${escapeHtml(error.message)}</div>`; return; }
    cmdkResults = (data || []).slice(0, 10);
    cmdkActiveIdx = cmdkResults.length ? 0 : -1;
    renderCmdkList();
  }, 220);
});

function renderCmdkList(){
  if (cmdkResults.length === 0) { cmdkList.innerHTML = '<div class="cmdk-empty">Tidak ada produk ditemukan.</div>'; return; }
  cmdkList.innerHTML = '';
  cmdkResults.forEach((r, idx) => {
    const el = document.createElement('div');
    el.className = 'cmdk-item' + (idx === cmdkActiveIdx ? ' active' : '');
    el.innerHTML = `<span class="ci-kode">${escapeHtml(r.kode_produk)}</span><span class="ci-nama">${escapeHtml(r.nama_produk || '—')}</span><span class="tipe-chip">${escapeHtml(r.tipe || '')}</span>`;
    el.addEventListener('click', () => selectCmdkResult(idx));
    cmdkList.appendChild(el);
  });
}
async function selectCmdkResult(idx){
  const r = cmdkResults[idx];
  if (!r) return;
  const { data, error } = await sb.from('produk').select('id').eq('kode_produk', r.kode_produk).single();
  if (error || !data) { showToast('Gagal membuka produk', true); return; }
  closeCmdk();
  if (r.tipe === 'SET') { goToSetDetail(data.id); } else { openEdit(data.id); }
}
cmdkInput.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { e.preventDefault(); cmdkActiveIdx = Math.min(cmdkActiveIdx + 1, cmdkResults.length - 1); renderCmdkList(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); cmdkActiveIdx = Math.max(cmdkActiveIdx - 1, 0); renderCmdkList(); }
  else if (e.key === 'Enter') { e.preventDefault(); if (cmdkActiveIdx >= 0) selectCmdkResult(cmdkActiveIdx); }
});

// ---- Modal open/close ----
const modalOverlay = document.getElementById('modalOverlay');
const modalTitle = document.getElementById('modalTitle');
const modalSub = document.getElementById('modalSub');
const hargaSection = document.getElementById('hargaSection');
const mediaSection = document.getElementById('mediaSection');
const deleteBtn = document.getElementById('deleteBtn');

document.getElementById('addBtn').addEventListener('click', openAdd);
document.getElementById('cancelBtn').addEventListener('click', attemptCloseModal);
document.getElementById('modalCloseBtn').addEventListener('click', attemptCloseModal);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) attemptCloseModal(); });

function closeModal(){ modalOverlay.classList.remove('open'); }

// ---- Unsaved changes guard — dipakai di modal edit produk (form yang sama
// juga dipakai buat "Set Baru" & "Edit Info Dasar" di Set Management, jadi
// otomatis kepakai di sana juga). Composition/Pricing/AKD di tab Set Detail
// TIDAK butuh guard ini karena tiap perubahan di situ sudah auto-save
// langsung ke database (lihat hint "tersimpan otomatis" di UI-nya). ----
let modalDirty = false;
const unsavedConfirmOverlay = document.getElementById('unsavedConfirmOverlay');
document.querySelector('#modalOverlay .modal-card').addEventListener('input', () => { modalDirty = true; });
document.getElementById('f_link_v6').addEventListener('input', renderLinkV6Hint);
document.querySelector('#modalOverlay .modal-card').addEventListener('change', () => { modalDirty = true; });

function attemptCloseModal(){
  if (modalDirty) { unsavedConfirmOverlay.classList.add('open'); return; }
  closeModal();
}
document.getElementById('unsavedStayBtn').addEventListener('click', () => {
  unsavedConfirmOverlay.classList.remove('open'); // balik ke form, gak jadi nutup
});
document.getElementById('unsavedDiscardBtn').addEventListener('click', () => {
  modalDirty = false;
  unsavedConfirmOverlay.classList.remove('open');
  closeModal(); // buang perubahan, form kebuang pas openAdd/openEdit berikutnya
});
document.getElementById('unsavedSaveBtn').addEventListener('click', async (e) => {
  e.currentTarget.disabled = true;
  const ok = await saveProduk();
  e.currentTarget.disabled = false;
  unsavedConfirmOverlay.classList.remove('open');
  if (ok) { modalDirty = false; closeModal(); }
  // kalau gagal (mis. validasi kode produk kosong), dialog konfirmasi ketutup
  // tapi modal edit tetap kebuka dengan toast error-nya — user bisa benerin.
});
// Nutup tab/refresh browser padahal masih ada perubahan yang belum disimpan.
// Sengaja tetap window-level (bukan sesuatu yang bisa di-scope ke container) --
// makanya WAJIB dilepas di unmount(), soalnya kalau kebiarin bakal ngecek
// modalOverlay yang udah gak ada di DOM lagi (detached node) begitu user
// pindah ke halaman SPA lain.
beforeUnloadHandler = (e) => {
  if (modalOverlay.classList.contains('open') && modalDirty) {
    e.preventDefault();
    e.returnValue = '';
  }
};
window.addEventListener('beforeunload', beforeUnloadHandler);

// ---- Tab bertahap di modal Produk (Info Dasar selalu kebuka; sisanya kekunci
// sampai Info Dasar tersimpan pertama kali, biar form gak kerasa numpuk) ----
document.querySelectorAll('.prod-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.classList.contains('locked')) { showToast('Simpan Info Dasar dulu, baru bagian ini kebuka'); return; }
    switchProdTab(btn.dataset.tab);
  });
});
function switchProdTab(tab){
  document.querySelectorAll('.prod-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.prod-tab-panel').forEach(p => p.classList.toggle('active', p.id === 'ptab-' + tab));
}
function setProdTabsLocked(locked){
  document.querySelectorAll('.prod-tab[data-tab]:not([data-tab="dasar"])').forEach(b => {
    b.classList.toggle('locked', locked);
    b.title = locked ? 'Simpan Info Dasar dulu' : '';
  });
  if (locked) switchProdTab('dasar'); // kalau lagi buka tab yang baru dikunci, balik ke Info Dasar
}

function resetForm(){
  modalDirty = false;
  document.querySelectorAll('.prod-tab.hidden-for-set').forEach(b => b.classList.remove('hidden-for-set'));
  document.getElementById('inaprocIndikator').style.display = 'none';
  ['f_kode_asli','f_kode_produk','f_nama_produk','f_no_akd','f_masa_berlaku','f_golongan',
   'f_kode_kfa','f_kode_cangkang','f_nama_cangkang','f_berat_gram','f_status_v6','f_link_v6',
   'f_spesifikasi','m_deskripsi_vendor','m_family','m_sub_family','m_manufacturer','m_capital'
  ].forEach(id => document.getElementById(id).value = '');
  // f_kode_kfa/f_kode_cangkang/f_nama_cangkang sekarang read-only (disabled),
  // sumber datanya produk_kfa -- lihat loadKfaInfoForProduk().
  document.getElementById('f_tipe').value = '';
  document.getElementById('f_is_active').checked = true;
  document.getElementById('masterFields').style.display = 'none';
  document.getElementById('masterLookupMsg').innerHTML = '';
  masterExists = false;
  hargaRows = []; renderHargaTable();
  mediaRows = []; renderMediaTable();
  currentAkdLinks = []; renderAkdCurrent();
  document.getElementById('akdBox').style.display = 'none';
  document.getElementById('akdSearchInput').value = '';
  document.getElementById('akdResults').innerHTML = '';
  document.getElementById('akdSealHolder').innerHTML = '';
  document.getElementById('md_judul').value = '';
  document.getElementById('md_url').value = '';
  document.getElementById('md_urutan').value = 1;
  document.getElementById('md_primary').checked = false;
  document.getElementById('md_jenis').value = 'brosur';
  document.getElementById('gambarInstrumenSection').style.display = 'none';
  document.getElementById('gambarInstrumenPreviewWrap').style.display = 'none';
}

// `prefill` (opsional): { kode_produk, link_v6 } -- dipakai tab "Sync dari
// Sheet" buat langsung ngisi kode & link pas buka form dari baris
// unmatched, biar gak perlu copy-paste manual. Aman dipanggil tanpa
// argumen kayak sebelumnya (addBtn/addSetBtn's listener manggil
// `openAdd(event)` / `openAdd()` -- `event?.kode_produk` selalu undefined
// jadi gak ke-trigger). link_v6 sengaja tetep di-set walau field-nya ada
// di tab "Lanjutan" yang masih locked di titik ini (setProdTabsLocked
// (true) di bawah) -- .value nempel ke elemen DOM-nya terlepas dari tab
// panel-nya lagi display:none atau enggak, jadi udah otomatis keisi pas
// user nyampe ke tab itu setelah Info Dasar pertama disimpan.
function openAdd(prefill){
  resetForm();
  currentProdukId = null;
  modalTitle.textContent = 'Tambah Produk';
  modalSub.textContent = 'Isi data produk baru';
  setProdTabsLocked(true);
  document.getElementById('prodTabDasarCheck').style.display = 'none';
  document.getElementById('saveBtn').innerHTML = '<i class="ti ti-check"></i> Simpan &amp; Lanjut';
  deleteBtn.style.display = 'none';
  document.getElementById('toggleAkdBoxBtn').style.display = 'none';
  document.getElementById('akdHint').textContent = 'Simpan produk dulu sebelum mengelola relasi AKD.';
  if (prefill?.kode_produk) document.getElementById('f_kode_produk').value = prefill.kode_produk;
  if (prefill?.link_v6) document.getElementById('f_link_v6').value = prefill.link_v6;
  renderLinkV6Hint();
  modalOverlay.classList.add('open');
}

async function openEdit(produkId){
  resetForm();
  currentProdukId = produkId;
  modalTitle.textContent = 'Edit Produk';
  modalSub.textContent = 'Memuat data...';
  setProdTabsLocked(false);
  document.getElementById('prodTabDasarCheck').style.display = 'inline';
  document.getElementById('saveBtn').innerHTML = '<i class="ti ti-check"></i> Simpan';
  deleteBtn.style.display = 'inline-flex';
  document.getElementById('toggleAkdBoxBtn').style.display = 'inline-flex';
  modalOverlay.classList.add('open');

  const { data: p, error } = await sb.from('produk').select('*').eq('id', produkId).single();
  if (error) { showToast('Gagal memuat produk: ' + error.message, true); closeModal(); return; }

  document.getElementById('f_kode_asli').value = p.kode_asli || '';
  document.getElementById('f_kode_produk').value = p.kode_produk || '';
  document.getElementById('f_nama_produk').value = p.nama_produk || '';
  document.getElementById('f_tipe').value = p.tipe || '';
  document.getElementById('f_no_akd').value = p.no_akd || '';
  document.getElementById('f_masa_berlaku').value = p.masa_berlaku || '';
  document.getElementById('f_golongan').value = p.golongan || '';
  loadKfaInfoForProduk(produkId, p.kode_produk);
  document.getElementById('f_berat_gram').value = p.berat_gram ?? '';
  document.getElementById('f_status_v6').value = p.status_v6 || '';
  document.getElementById('f_link_v6').value = p.link_v6 || '';
  renderLinkV6Hint();
  renderInaprocIndikator(p.status_inaproc, p.link_v6);
  document.getElementById('f_spesifikasi').value = p.spesifikasi || '';
  document.getElementById('f_is_active').checked = !!p.is_active;
  document.getElementById('akdSealHolder').innerHTML = sealHtml(p.status_akd);
  modalSub.textContent = 'Kode: ' + (p.kode_produk || '—');

  if (p.kode_asli) await cekMaster(p.kode_asli, true);
  await loadHarga(produkId);
  await loadMedia(produkId);
  await loadAkdLinks(produkId, p.tipe);
}

// ---- Info KFA read-only di Info Dasar (source of truth = produk_kfa) ----
let currentInfoDasarKodeProduk = '';
async function loadKfaInfoForProduk(produkId, kodeProduk){
  currentInfoDasarKodeProduk = kodeProduk || '';
  const { data } = await sb.from('produk_kfa').select('kode_kfa, kode_cangkang, nama_cangkang').eq('produk_id', produkId).maybeSingle();
  document.getElementById('f_kode_kfa').value = data?.kode_kfa || '';
  document.getElementById('f_kode_cangkang').value = data?.kode_cangkang || '';
  document.getElementById('f_nama_cangkang').value = data?.nama_cangkang || '';
}
document.getElementById('jumpToKfaLink').addEventListener('click', () => {
  closeModal();
  switchView('kfa');
  const input = document.getElementById('kfaSearchBoxInput');
  input.value = currentInfoDasarKodeProduk;
  S.jumpToKfaSearch(currentInfoDasarKodeProduk);
});

// ---- Master produk lookup ----
document.getElementById('cekMasterBtn').addEventListener('click', () => {
  const kode = document.getElementById('f_kode_asli').value.trim();
  if (!kode) { showToast('Isi kode_asli dulu', true); return; }
  cekMaster(kode, false);
});
async function cekMaster(kodeAsli, silent){
  const msgEl = document.getElementById('masterLookupMsg');
  const fieldsEl = document.getElementById('masterFields');
  if (!silent) msgEl.innerHTML = `<div class="lookup-msg">Mencari...</div>`;
  const { data, error } = await sb.from('master_produk').select('*').eq('kode_asli', kodeAsli).maybeSingle();
  if (error) { msgEl.innerHTML = `<div class="lookup-msg notfound">Gagal cek: ${escapeHtml(error.message)}</div>`; return; }
  fieldsEl.style.display = 'block';
  if (data) {
    masterExists = true;
    document.getElementById('m_deskripsi_vendor').value = data.deskripsi_vendor || '';
    document.getElementById('m_family').value = data.family || '';
    document.getElementById('m_sub_family').value = data.sub_family || '';
    document.getElementById('m_manufacturer').value = data.manufacturer || '';
    document.getElementById('m_capital').value = data.capital || '';
    msgEl.innerHTML = `<div class="lookup-msg found"><i class="ti ti-check"></i> Ditemukan di master_produk, data terisi otomatis.</div>`;
  } else {
    masterExists = false;
    msgEl.innerHTML = `<div class="lookup-msg notfound"><i class="ti ti-alert-triangle"></i> Belum ada — isi field di bawah untuk buat master baru.</div>`;
  }
  await checkGambarInstrumen();
}

// ================================================================
// GAMBAR INSTRUMEN — cek bucket 'thumbnails' by kode_asli.png, upload kalau belum ada.
// Bucket-nya udah public buat DIBACA (GET file langsung bypass RLS), tapi list & upload
// tetep lewat Storage API yang kena RLS storage.objects -> perlu policy select/insert/update
// khusus bucket ini (lihat catatan migrasi terpisah).
// ================================================================
const GAMBAR_BUCKET = 'thumbnails';
function gambarInstrumenFilename(kodeAsli){ return `${kodeAsli}.png`; }

// SECURITY FIX: kode_asli is a free-text field the user types in the form
// above and gets used AS-IS as the object key in the shared public
// "thumbnails" bucket (with upsert:true -- silently overwrites whatever
// already has that key). Two concrete risks that used to be completely
// unguarded:
//   1. Reserved filename collision -- "thumbnails" also stores
//      TEMPLATE_THUMBNAIL_ROBUST.png, the shared template every
//      export-gambar merge is built on top of (see that page's
//      EXCLUDED_FILENAMES). Typing kode_asli = "TEMPLATE_THUMBNAIL_ROBUST"
//      here (typo or otherwise) would silently replace it for every
//      product, everyone, no warning.
//   2. "/" or ".." in kode_asli -- the bucket is a flat namespace
//      elsewhere in the app (export-gambar's file list, konversian's
//      THUMB_BASE + kode + '.png' lookups all assume one flat file per
//      kode_asli), so a key containing a path separator creates a nested
//      object other code doesn't expect and can't find by kode_asli
//      anymore, or silently shadows/splits what looks like one product
//      into two different storage objects.
// This does NOT rewrite/sanitize kode_asli itself (it's a real business
// identifier used for lookups elsewhere -- silently transforming it would
// desync the stored code from what's typed) -- it only refuses to build a
// storage key from it when unsafe, with a clear error instead of a silent
// overwrite.
const RESERVED_THUMBNAIL_KEYS = new Set(['TEMPLATE_THUMBNAIL_ROBUST']);
function thumbnailKeyError(kodeAsli){
  if (!kodeAsli) return 'kode_asli kosong.';
  if (/[\/\\]/.test(kodeAsli) || kodeAsli.includes('..')) {
    return 'kode_asli tidak boleh mengandung "/", "\\", atau "..".';
  }
  const bare = kodeAsli.replace(/\.png$/i, '').toUpperCase();
  if (RESERVED_THUMBNAIL_KEYS.has(bare)) {
    return `"${kodeAsli}" adalah nama file reserved (dipakai fitur lain) -- pilih kode_asli lain.`;
  }
  return null; // aman
}

// SECURITY/ROBUSTNESS FIX: tidak ada batas ukuran sebelum ini -- file PNG
// yang sangat besar (screenshot resolusi tinggi tanpa kompresi, dsb.) bisa
// lolos tanpa peringatan dan memperlambat/boroskan storage & bandwidth
// setiap kali thumbnail itu dimuat (export-gambar, konversian, dsb.).
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB, cukup longgar utk PNG thumbnail

async function checkGambarInstrumen(){
  const tipe = document.getElementById('f_tipe').value;
  const kodeAsli = document.getElementById('f_kode_asli').value.trim();
  const section = document.getElementById('gambarInstrumenSection');
  const badge = document.getElementById('gambarInstrumenBadge');
  const hint = document.getElementById('gambarInstrumenHint');
  const previewWrap = document.getElementById('gambarInstrumenPreviewWrap');
  const uploadBtn = document.getElementById('gambarInstrumenUploadBtn');

  if (tipe !== 'INSTRUMENT' || !kodeAsli) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  badge.className = 'status-pill neutral';
  badge.textContent = 'Mengecek...';
  hint.textContent = '';
  previewWrap.style.display = 'none';

  const keyError = thumbnailKeyError(kodeAsli);
  if (keyError) {
    badge.className = 'status-pill bad';
    badge.textContent = 'kode_asli tidak valid';
    hint.textContent = keyError;
    uploadBtn.innerHTML = '<i class="ti ti-upload"></i> Upload Gambar';
    return;
  }

  const filename = gambarInstrumenFilename(kodeAsli);
  const { data, error } = await sb.storage.from(GAMBAR_BUCKET).list('', { search: kodeAsli });
  if (error) {
    badge.className = 'status-pill bad';
    badge.textContent = 'Gagal cek bucket';
    hint.textContent = error.message;
    uploadBtn.innerHTML = '<i class="ti ti-upload"></i> Upload Gambar';
    return;
  }
  const found = (data || []).some(f => f.name === filename);
  if (found) {
    badge.className = 'status-pill ok';
    badge.innerHTML = '<i class="ti ti-check"></i> Ada di bucket';
    hint.textContent = filename;
    previewWrap.style.display = '';
    document.getElementById('gambarInstrumenPreview').src = THUMB_BASE + filename + '?t=' + Date.now();
    uploadBtn.innerHTML = '<i class="ti ti-refresh"></i> Ganti Gambar';
  } else {
    badge.className = 'status-pill warn';
    badge.innerHTML = '<i class="ti ti-alert-triangle"></i> Belum ada gambar';
    hint.textContent = `Bakal disimpan sebagai ${filename}`;
    uploadBtn.innerHTML = '<i class="ti ti-upload"></i> Upload Gambar';
  }
}

document.getElementById('gambarInstrumenUploadBtn').addEventListener('click', () => {
  const kodeAsli = document.getElementById('f_kode_asli').value.trim();
  if (!kodeAsli) { showToast('Isi & cek kode_asli dulu', true); return; }
  const keyError = thumbnailKeyError(kodeAsli);
  if (keyError) { showToast(keyError, true); return; }
  document.getElementById('gambarInstrumenFileInput').click();
});

document.getElementById('gambarInstrumenFileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (file.type !== 'image/png') { showToast('File harus format PNG', true); return; }
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    showToast(`File terlalu besar (${(file.size / 1024 / 1024).toFixed(1)} MB). Maksimal ${MAX_IMAGE_SIZE_BYTES / 1024 / 1024} MB.`, true);
    return;
  }
  const kodeAsli = document.getElementById('f_kode_asli').value.trim();
  if (!kodeAsli) { showToast('Isi & cek kode_asli dulu', true); return; }
  const keyError = thumbnailKeyError(kodeAsli);
  if (keyError) { showToast(keyError, true); return; }
  const filename = gambarInstrumenFilename(kodeAsli);
  const badge = document.getElementById('gambarInstrumenBadge');
  badge.className = 'status-pill neutral';
  badge.textContent = 'Mengupload...';
  const { error } = await sb.storage.from(GAMBAR_BUCKET).upload(filename, file, { upsert: true, contentType: 'image/png' });
  if (error) { showToast('Gagal upload: ' + error.message, true); await checkGambarInstrumen(); return; }
  showToast('Gambar instrumen berhasil diupload');
  await checkGambarInstrumen();
});

document.getElementById('f_tipe').addEventListener('change', checkGambarInstrumen);

// ================================================================
// KELOLA AKD — link/unlink produk_akd, cari di tabel akd sesuai tipe
// ================================================================
const toggleAkdBoxBtn = document.getElementById('toggleAkdBoxBtn');
const akdBox = document.getElementById('akdBox');
toggleAkdBoxBtn.addEventListener('click', () => {
  akdBox.style.display = akdBox.style.display === 'none' ? 'block' : 'none';
});

async function loadAkdLinks(produkId, tipe){
  const { data, error } = await sb.from('produk_akd')
    .select('akd_id, akd:akd_id(id, no_akd, nama_akd, tipe_akd)')
    .eq('produk_id', produkId);
  if (error) { document.getElementById('akdHint').textContent = 'Gagal memuat relasi AKD: ' + error.message; return; }
  currentAkdLinks = (data || []).map(r => r.akd).filter(Boolean);
  renderAkdCurrent();
  const mapped = TIPE_TO_AKD[tipe];
  document.getElementById('akdHint').textContent = mapped
    ? `Pencarian dibatasi ke AKD tipe "${mapped}" (sesuai tipe produk "${tipe}").`
    : 'Pilih Tipe produk dulu supaya pencarian AKD terarah.';
}

function renderAkdCurrent(){
  const el = document.getElementById('akdCurrentList');
  if (currentAkdLinks.length === 0) {
    el.innerHTML = `<div class="akd-empty">Belum ada AKD terhubung ke produk ini.</div>`;
    return;
  }
  el.innerHTML = '';
  currentAkdLinks.forEach(a => {
    const chip = document.createElement('div');
    chip.className = 'akd-chip';
    chip.innerHTML = `<span class="ac-no">${escapeHtml(a.no_akd)}</span><span class="ac-nama">${escapeHtml(a.nama_akd || '')}</span><button title="Lepas relasi"><i class="ti ti-x"></i></button>`;
    chip.querySelector('button').addEventListener('click', () => unlinkAkd(a.id));
    el.appendChild(chip);
  });
}

async function unlinkAkd(akdId){
  if (!currentProdukId) return;
  if (!await crudConfirm('Lepas relasi AKD ini dari produk?', { danger: true, okLabel: 'Ya, Lepas' })) return;
  const { error } = await sb.from('produk_akd').delete().eq('produk_id', currentProdukId).eq('akd_id', akdId);
  if (error) { showToast('Gagal melepas relasi: ' + error.message, true); return; }
  showToast('Relasi AKD dilepas');
  const tipe = document.getElementById('f_tipe').value;
  await loadAkdLinks(currentProdukId, tipe);
  await refreshAkdFieldsFromDb();
}

let akdSearchTimer = null;
document.getElementById('akdSearchInput').addEventListener('input', () => {
  clearTimeout(akdSearchTimer);
  const q = document.getElementById('akdSearchInput').value.trim();
  const resEl = document.getElementById('akdResults');
  if (!q) { resEl.innerHTML = ''; return; }
  akdSearchTimer = setTimeout(async () => {
    const tipe = document.getElementById('f_tipe').value;
    const mapped = TIPE_TO_AKD[tipe];
    let query = sb.from('akd').select('id, no_akd, nama_akd, tipe_akd').or(`no_akd.ilike.%${q}%,nama_akd.ilike.%${q}%`).limit(15);
    if (mapped) query = query.eq('tipe_akd', mapped);
    const { data, error } = await query;
    if (error) { resEl.innerHTML = `<div class="akd-empty">Gagal mencari: ${escapeHtml(error.message)}</div>`; return; }
    if (!data || data.length === 0) { resEl.innerHTML = `<div class="akd-empty">Tidak ditemukan.</div>`; return; }
    resEl.innerHTML = '';
    data.forEach(a => {
      const row = document.createElement('div');
      row.className = 'akd-result-row';
      row.innerHTML = `<span class="ar-no">${escapeHtml(a.no_akd)}</span><span class="ar-nama">${escapeHtml(a.nama_akd || '')}</span>`;
      row.addEventListener('click', () => linkAkd(a.id));
      resEl.appendChild(row);
    });
  }, 250);
});

async function linkAkd(akdId){
  if (!currentProdukId) { showToast('Simpan produk dulu sebelum menghubungkan AKD', true); return; }
  const { error } = await sb.from('produk_akd').insert({ produk_id: currentProdukId, akd_id: akdId, is_primary: true });
  if (error) {
    if (error.code === '23505') { showToast('AKD ini sudah terhubung ke produk ini'); return; }
    showToast('Gagal menghubungkan AKD: ' + error.message, true); return;
  }
  showToast('AKD terhubung');
  document.getElementById('akdSearchInput').value = '';
  document.getElementById('akdResults').innerHTML = '';
  const tipe = document.getElementById('f_tipe').value;
  await loadAkdLinks(currentProdukId, tipe);
  await refreshAkdFieldsFromDb();
}

async function refreshAkdFieldsFromDb(){
  const { data: p, error } = await sb.from('produk').select('no_akd, masa_berlaku, golongan, status_akd').eq('id', currentProdukId).single();
  if (error || !p) return;
  document.getElementById('f_no_akd').value = p.no_akd || '';
  document.getElementById('f_masa_berlaku').value = p.masa_berlaku || '';
  document.getElementById('f_golongan').value = p.golongan || '';
  document.getElementById('akdSealHolder').innerHTML = sealHtml(p.status_akd);
}

// ---- Harga ----
async function loadHarga(produkId){
  const { data, error } = await sb.from('produk_harga').select('*').eq('produk_id', produkId).order('tahun', { ascending: false });
  if (error) { showToast('Gagal memuat harga: ' + error.message, true); return; }
  hargaRows = data || [];
  renderHargaTable();
}
function renderHargaTable(){
  const tbody = document.getElementById('hargaTableBody');
  renderHargaGroupInto(tbody, hargaRows, () => loadHarga(currentProdukId));
}
// EKATALOG adalah satu-satunya harga yang diinput manual -- SWASTA & UPLOAD cuma hasil rumus
// turunan (lihat upsertHargaDariEkat), jadi ditampilkan grouped per tahun: EKATALOG jadi baris
// utama yang bisa dihapus (hapus trio-nya sekaligus biar gak ada baris turunan yang jadi yatim),
// SWASTA & UPLOAD ditampilkan sebagai info read-only di bawahnya, tanpa tombol hapus sendiri.
function renderHargaGroupInto(tbody, rows, onAfterDelete){
  if (!rows || rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="color:var(--text-muted);padding:14px;">Belum ada data harga</td></tr>`;
    return;
  }
  const byTahun = new Map();
  rows.forEach(h => {
    if (!byTahun.has(h.tahun)) byTahun.set(h.tahun, {});
    byTahun.get(h.tahun)[h.jenis] = h;
  });
  const tahunList = [...byTahun.keys()].sort((a, b) => b - a);
  tbody.innerHTML = '';
  tahunList.forEach(tahun => {
    const group = byTahun.get(tahun);
    const ekat = group.EKATALOG;
    const turunan = ['SWASTA', 'UPLOAD'].filter(j => group[j])
      .map(j => `${j} Rp ${Number(group[j].harga).toLocaleString('id-ID')}`).join(' · ');
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${tahun}</td>
      <td>${ekat ? 'Rp ' + Number(ekat.harga).toLocaleString('id-ID') : '<span style="color:var(--text-muted);">— belum ada</span>'}</td>
      <td style="color:var(--text-muted);font-size:12px;">${turunan || '—'}</td>
      <td>${ekat ? `<button class="btn btn-danger-ghost btn-sm" title="Hapus EKATALOG, SWASTA & UPLOAD tahun ${tahun}"><i class="ti ti-trash"></i></button>` : ''}</td>
    `;
    const delBtn = tr.querySelector('button');
    if (delBtn) delBtn.addEventListener('click', async () => {
      if (!await crudConfirm(`Hapus harga tahun ${tahun} (EKATALOG, SWASTA & UPLOAD sekaligus)?`, { danger: true, okLabel: 'Ya, Hapus' })) return;
      const produkId = ekat.produk_id;
      const { error } = await sb.from('produk_harga').delete().eq('produk_id', produkId).eq('tahun', tahun);
      if (error) { showToast('Gagal hapus: ' + error.message, true); return; }
      // FIX (urgent — harga mismatch): same missing invalidation as
      // addHargaBtn above, but for delete.
      invalidateProdukStackCache();
      showToast('Harga tahun ' + tahun + ' dihapus');
      onAfterDelete();
    });
    tbody.appendChild(tr);
  });
}
// ---- Hitung & simpan 3 jenis harga sekaligus dari Harga EKATALOG ----
// SWASTA = EKATALOG x 1.3 ; UPLOAD = EKATALOG / 1.11 (sesuai rumus yang sudah dipakai tim)
async function upsertHargaDariEkat(produkId, tahun, hargaEkat){
  const rows = [
    { jenis: 'EKATALOG', harga: Math.round(hargaEkat) },
    { jenis: 'SWASTA', harga: Math.round(hargaEkat * 1.3) },
    { jenis: 'UPLOAD', harga: Math.round(hargaEkat / 1.11) }
  ];
  for (const r of rows) {
    const { data: existing, error: findErr } = await sb.from('produk_harga')
      .select('id').eq('produk_id', produkId).eq('tahun', tahun).eq('jenis', r.jenis).maybeSingle();
    if (findErr) { showToast('Gagal cek harga ' + r.jenis + ': ' + findErr.message, true); return false; }
    if (existing) {
      const { error } = await sb.from('produk_harga').update({ harga: r.harga }).eq('id', existing.id);
      if (error) { showToast('Gagal update harga ' + r.jenis + ': ' + error.message, true); return false; }
    } else {
      const { error } = await sb.from('produk_harga').insert({ produk_id: produkId, tahun, jenis: r.jenis, harga: r.harga });
      if (error) { showToast('Gagal tambah harga ' + r.jenis + ': ' + error.message, true); return false; }
    }
  }
  return true;
}

document.getElementById('addHargaBtn').addEventListener('click', async () => {
  if (!currentProdukId) { showToast('Simpan data produk dulu sebelum menambah harga', true); return; }
  const tahun = parseInt(document.getElementById('h_tahun').value, 10);
  const hargaEkat = parseFloat(document.getElementById('h_harga').value);
  if (!tahun || isNaN(hargaEkat)) { showToast('Lengkapi tahun dan harga EKATALOG', true); return; }
  const ok = await upsertHargaDariEkat(currentProdukId, tahun, hargaEkat);
  if (!ok) return;
  // FIX (urgent — harga mismatch): produkHargaIdSet (now also used for the
  // list-page "belum ada harga" badge, see loadProduk() above) was never
  // invalidated after adding a price, so a product could keep showing the
  // stale badge/filter result until some UNRELATED mutation happened to
  // invalidate the cache first.
  invalidateProdukStackCache();
  document.getElementById('h_tahun').value = '';
  document.getElementById('h_harga').value = '';
  showToast('Harga EKATALOG, SWASTA & UPLOAD tersimpan');
  loadHarga(currentProdukId);
});
// ---- Media ----
async function loadMedia(produkId){
  const { data, error } = await sb.from('produk_media').select('*').eq('produk_id', produkId).order('urutan', { ascending: true });
  if (error) { showToast('Gagal memuat media: ' + error.message, true); return; }
  mediaRows = data || [];
  renderMediaTable();
}
function renderMediaTable(){
  const tbody = document.getElementById('mediaTableBody');
  if (mediaRows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="color:var(--text-muted);padding:14px;">Belum ada media</td></tr>`;
    return;
  }
  tbody.innerHTML = '';
  mediaRows.forEach(m => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(m.jenis)}</td>
      <td>${escapeHtml(m.judul || '—')}</td>
      <td><a class="media-link" href="${escapeHtml(m.url)}" target="_blank" rel="noopener">${escapeHtml(m.url)}</a></td>
      <td>${m.is_primary ? '<span class="badge-primary">Utama</span>' : '—'}</td>
      <td><button class="btn btn-danger-ghost btn-sm" data-id="${m.id}"><i class="ti ti-trash"></i></button></td>
    `;
    tr.querySelector('button').addEventListener('click', () => deleteMedia(m.id));
    tbody.appendChild(tr);
  });
}
document.getElementById('addMediaBtn').addEventListener('click', async () => {
  if (!currentProdukId) { showToast('Simpan data produk dulu sebelum menambah media', true); return; }
  const jenis = document.getElementById('md_jenis').value;
  const judul = document.getElementById('md_judul').value.trim();
  const url = document.getElementById('md_url').value.trim();
  const urutan = parseInt(document.getElementById('md_urutan').value, 10) || 1;
  const is_primary = document.getElementById('md_primary').checked;
  if (!url) { showToast('URL wajib diisi', true); return; }
  const { error } = await sb.from('produk_media').insert({ produk_id: currentProdukId, jenis, judul: judul || null, url, urutan, is_primary });
  if (error) { showToast('Gagal tambah media: ' + error.message, true); return; }
  document.getElementById('md_judul').value = '';
  document.getElementById('md_url').value = '';
  document.getElementById('md_urutan').value = 1;
  document.getElementById('md_primary').checked = false;
  showToast('Media ditambahkan');
  loadMedia(currentProdukId);
});
async function deleteMedia(id){
  if (!await crudConfirm('Hapus media ini?', { danger: true, okLabel: 'Ya, Hapus' })) return;
  const { error } = await sb.from('produk_media').delete().eq('id', id);
  if (error) { showToast('Gagal hapus: ' + error.message, true); return; }
  showToast('Media dihapus');
  loadMedia(currentProdukId);
}

// ---- Save produk ----
async function saveProduk(){
  const saveBtn = document.getElementById('saveBtn');
  const saveBtnOriginalHtml = saveBtn.innerHTML;
  saveBtn.disabled = true;
  saveBtn.innerHTML = '<span class="spinner"></span> Menyimpan...';
  try {
    return await saveProdukInner();
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerHTML = saveBtnOriginalHtml;
  }
}
async function saveProdukInner(){
  const kodeAsli = document.getElementById('f_kode_asli').value.trim();
  const kodeProduk = document.getElementById('f_kode_produk').value.trim();
  const tipe = document.getElementById('f_tipe').value;
  if (!kodeProduk || !tipe) { showToast('Kode Produk dan Tipe wajib diisi', true); return false; }
  const wasNew = !currentProdukId; // dicek sebelum currentProdukId ditimpa di bawah

  if (kodeAsli) {
    const { error: mErr } = await sb.from('master_produk').upsert({
      kode_asli: kodeAsli,
      deskripsi_vendor: document.getElementById('m_deskripsi_vendor').value || null,
      family: document.getElementById('m_family').value || null,
      sub_family: document.getElementById('m_sub_family').value || null,
      manufacturer: document.getElementById('m_manufacturer').value || null,
      capital: document.getElementById('m_capital').value || null
    }, { onConflict: 'kode_asli' });
    if (mErr) { showToast('Gagal menyimpan master_produk: ' + mErr.message, true); return false; }
  }

  // no_akd/masa_berlaku/golongan sengaja TIDAK dikirim -> field itu read-only,
  // dikontrol sepenuhnya lewat relasi produk_akd + trigger sync.
  const payload = {
    kode_asli: kodeAsli || null,
    kode_produk: kodeProduk,
    nama_produk: document.getElementById('f_nama_produk').value || null,
    tipe,
    // kode_kfa/kode_cangkang/nama_cangkang SENGAJA tidak dikirim dari sini --
    // field itu read-only di Info Dasar, satu-satunya jalur tulis yang sah
    // adalah modal KFA Management (tabel produk_kfa). Trigger DB yang nyinkron
    // kode_kfa balik ke produk.kode_kfa jalan otomatis dari sana.
    berat_gram: document.getElementById('f_berat_gram').value || null,
    status_v6: document.getElementById('f_status_v6').value || null,
    link_v6: document.getElementById('f_link_v6').value || null,
    spesifikasi: document.getElementById('f_spesifikasi').value || null,
    is_active: document.getElementById('f_is_active').checked
  };

  let result;
  if (currentProdukId) {
    result = await sb.from('produk').update(payload).eq('id', currentProdukId).select().single();
  } else {
    result = await sb.from('produk').insert(payload).select().single();
  }
  if (result.error) { showToast('Gagal simpan produk: ' + result.error.message, true); return false; }

  showToast(currentProdukId ? 'Produk diperbarui' : 'Produk ditambahkan');
  modalDirty = false; // data form sekarang sudah sama persis dengan yang di database
  currentProdukId = result.data.id;

  // FIX: produk baru yang kode_produk-nya match ke tabel sync_unmatched_produk
  // (kode_produk yg kepantau di Sheet tapi belum ada di DB) sekarang langsung
  // dihapus dari sana pas produknya disimpan -- gak perlu nunggu poll/edge
  // function sync-sheet jalan lagi buat ngilangin dari daftar "Sync dari
  // Sheet". Sengaja fire-and-forget (gak di-await) biar gak nunda alur save
  // form; kalau gagal (mis. RLS) ya biarin aja, edge function tetap jadi
  // jaring pengaman di siklus poll berikutnya. loadSyncUnmatched() sendiri
  // juga udah defensif filter row yang kode_produk-nya udah ada di produk,
  // jadi walau delete ini gak sempet jalan, tab Sync tetap gak nampilin lagi.
  if (wasNew) {
    sb.from('sync_unmatched_produk').delete().eq('kode_produk', kodeProduk)
      .then(({ error: delErr }) => { if (delErr) console.warn('Gagal bersihin sync_unmatched_produk:', delErr.message); });
  }

  // SET baru: Info Dasar-nya cukup disimpan di sini, sisanya (komposisi/harga/AKD)
  // dikelola penuh di Set Management -- langsung lempar ke sana, gak usah nampilin
  // tab Harga/AKD generic di modal ini (bakal langsung dikunci ulang lain kali dibuka
  // lewat monkey-patch openEdit di bagian SET Management di bawah).
  if (wasNew && tipe === 'SET') {
    closeModal();
    invalidateProdukStackCache();
    loadProduk();
    refreshProdukFilterCounts();
    goToSetDetail(currentProdukId);
    return true;
  }

  setProdTabsLocked(false);
  document.getElementById('prodTabDasarCheck').style.display = 'inline';
  document.getElementById('saveBtn').innerHTML = '<i class="ti ti-check"></i> Simpan';
  deleteBtn.style.display = 'inline-flex';
  toggleAkdBoxBtn.style.display = 'inline-flex';
  document.getElementById('akdHint').textContent = 'Simpan berhasil — sekarang kamu bisa hubungkan AKD.';
  modalTitle.textContent = 'Edit Produk';
  modalSub.textContent = 'Kode: ' + result.data.kode_produk;
  await loadHarga(currentProdukId);
  await loadMedia(currentProdukId);
  await loadAkdLinks(currentProdukId, tipe);
  invalidateProdukStackCache();
  loadProduk();
  refreshProdukFilterCounts();
  return true;
}
document.getElementById('saveBtn').addEventListener('click', saveProduk);

// ================================================================
// SET MANAGEMENT
// ================================================================
let currentSetId = null;
let currentSetKode = '';
let compRows = [];
let lastAddedItemRowId = null;

async function goToSetDetail(produkId){
  switchView('set');
  const { data: p, error } = await sb.from('produk').select('id, kode_produk').eq('id', produkId).single();
  if (error || !p) { showToast('Gagal membuka set', true); return; }
  document.getElementById('setListWrap').style.display = 'none';
  document.getElementById('setDetailWrap').style.display = 'block';
  openSetDetail(p.id, p.kode_produk);
}

document.getElementById('addSetBtn').addEventListener('click', () => {
  openAdd();
  document.getElementById('f_tipe').value = 'SET';
});

let setListPage = 1;
const SET_LIST_PAGE_SIZE = 30;

async function loadSetList(page){
  setListPage = page || setListPage || 1;
  const wrap = document.getElementById('setListBody');
  wrap.innerHTML = '<div style="color:var(--text-muted);padding:14px;">Memuat...</div>';
  const from = (setListPage - 1) * SET_LIST_PAGE_SIZE;
  const to = from + SET_LIST_PAGE_SIZE - 1;
  const { data, error, count } = await sb.from('produk_set_ringkasan')
    .select('*', { count: 'exact' })
    .order('kode_produk')
    .range(from, to);
  if (error) { wrap.innerHTML = `<div style="color:var(--rust);padding:14px;">Gagal memuat: ${escapeHtml(error.message)}</div>`; return; }
  const total = count || 0;
  document.getElementById('setListCount').textContent = total + ' set produk';
  renderPgBar(document.getElementById('setListPagination'), {
    page: setListPage, pageSize: SET_LIST_PAGE_SIZE, total,
    onPageChange: (p) => loadSetList(p)
  });
  if (!data || data.length === 0) { wrap.innerHTML = '<div class="stub-box">Belum ada produk tipe SET.</div>'; return; }

  // FIX (urgent — same row-limit truncation bug as loadProduk() above, see
  // its comment): was a raw .select('produk_id').in('produk_id', ...) query
  // vulnerable to PostgREST's default ~1000-row cap once enough sets on a
  // page have real price history. Switched to the same cached, RPC-backed
  // produkHargaIdSet.
  await ensureProdukHargaSet();
  const hargaExistIds = produkHargaIdSet;
  const ONE_DAY = 24 * 60 * 60 * 1000;

  wrap.innerHTML = '';
  data.forEach(s => {
    const noHarga = !hargaExistIds.has(s.set_id);
    const noItem = !(s.jumlah_jenis_item > 0); // set kosong (belum ada komposisi) — sama pentingnya kayak belum ada harga
    const recentlyUpdated = s.updated_at && (Date.now() - new Date(s.updated_at).getTime()) < ONE_DAY;
    const row = document.createElement('div');
    row.className = 'set-list-row' + ((noHarga || noItem) ? ' row-attention' : '');
    row.innerHTML = `
      <span class="sl-kode">${escapeHtml(s.kode_produk)}${recentlyUpdated ? '<span class="dot-updated" title="Diubah dalam 24 jam terakhir"></span>' : ''}</span>
      <span class="sl-nama">${escapeHtml(s.nama_produk || '—')}</span>
      <span class="sl-meta">${noItem ? '<span style="color:var(--amber);">Belum ada item</span>' : `${s.jumlah_jenis_item} item · qty ${s.total_qty || 0}`}${noHarga ? ' · <span style="color:var(--amber);">belum ada harga</span>' : ''}</span>
      ${sealHtml(s.status_akd)}
    `;
    row.addEventListener('click', () => openSetDetail(s.set_id, s.kode_produk));
    wrap.appendChild(row);
  });
}

document.getElementById('setBackBtn').addEventListener('click', () => {
  document.getElementById('setDetailWrap').style.display = 'none';
  document.getElementById('setListWrap').style.display = 'block';
  loadSetList();
});

async function openSetDetail(setId, kodeProduk){
  currentSetId = setId;
  currentSetKode = kodeProduk;
  document.getElementById('setListWrap').style.display = 'none';
  document.getElementById('setDetailWrap').style.display = 'block';
  switchSetTab('composition');
  await refreshSetHeader();
  await loadComposition();
  await loadSetHarga();
  await loadSetAkd();
  await loadSetHistory();
}

async function refreshSetHeader(){
  const { data: p } = await sb.from('produk').select('*').eq('id', currentSetId).single();
  if (!p) return;
  document.getElementById('setDetailNama').textContent = p.nama_produk || p.kode_produk;
  document.getElementById('setDetailKode').textContent = p.kode_produk;
  document.getElementById('setDetailSeal').innerHTML = sealHtml(p.status_akd);

  const { data: ring } = await sb.from('produk_set_ringkasan').select('*').eq('set_id', currentSetId).maybeSingle();
  document.getElementById('setDetailJumlahItem').textContent = ring?.jumlah_jenis_item || 0;
  document.getElementById('setDetailQty').textContent = ring?.total_qty || 0;

  // EKATALOG adalah source of truth harga -- SWASTA & UPLOAD cuma hasil rumus turunan
  // (lihat upsertHargaDariEkat), jadi subtitle set harus selalu ambil baris EKATALOG,
  // bukan baris pertama apa pun yang kebetulan muncul duluan di urutan tahun.
  const { data: hargaRow } = await sb.from('produk_harga').select('harga, jenis, tahun').eq('produk_id', currentSetId)
    .eq('jenis', 'EKATALOG').order('tahun', { ascending: false }).limit(1).maybeSingle();
  document.getElementById('setDetailHarga').textContent = hargaRow ? `Rp ${Number(hargaRow.harga).toLocaleString('id-ID')} (${hargaRow.jenis} ${hargaRow.tahun})` : 'Belum ada harga';
}

document.getElementById('editSetOverviewBtn').addEventListener('click', () => openEdit(currentSetId));

// ---- Tabs ----
document.querySelectorAll('.set-tab').forEach(btn => {
  btn.addEventListener('click', () => switchSetTab(btn.dataset.tab));
});
function switchSetTab(tab){
  document.querySelectorAll('.set-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.set-tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + tab));
}

// ---- Composition ----
async function loadComposition(){
  const { data, error } = await sb.from('produk_set_item')
    .select('id, qty, produk_id, item:produk_id(id, kode_produk, nama_produk, berat_gram)')
    .eq('set_id', currentSetId);
  if (error) { document.getElementById('compList').innerHTML = `<div style="color:var(--rust);">Gagal memuat: ${escapeHtml(error.message)}</div>`; return; }
  compRows = (data || []).sort((a,b) => (a.item?.nama_produk || '').localeCompare(b.item?.nama_produk || ''));
  renderComposition();
}
function renderComposition(){
  const wrap = document.getElementById('compList');
  document.getElementById('compJumlahJenis').textContent = compRows.length;
  const totalQty = compRows.reduce((s,r) => s + (r.qty || 0), 0);
  document.getElementById('compTotalQty').textContent = totalQty;
  const estBerat = compRows.reduce((s,r) => s + ((r.item?.berat_gram || 0) * (r.qty || 0)), 0);
  document.getElementById('compEstBerat').textContent = estBerat.toLocaleString('id-ID') + ' g';

  if (compRows.length === 0) { wrap.innerHTML = '<div class="akd-empty">Belum ada item di set ini.</div>'; return; }
  wrap.innerHTML = '';
  compRows.forEach(r => {
    const row = document.createElement('div');
    row.className = 'comp-row';
    row.dataset.rowId = r.id;
    row.innerHTML = `
      <span class="cr-kode">${escapeHtml(r.item?.kode_produk || '—')}</span>
      <span class="cr-nama" data-id="${r.item?.id}">${escapeHtml(r.item?.nama_produk || '—')}</span>
      <input type="number" class="cr-qty" value="${r.qty}" min="1" data-item-row="${r.id}"/>
      <span class="cr-saved-tag" style="display:none;font-size:10.5px;color:var(--teal-ok-text);"><i class="ti ti-check"></i></span>
      <button class="cr-del" data-item-row="${r.id}" title="Hapus item ini">×</button>
    `;
    row.querySelector('.cr-nama').addEventListener('click', () => { if (r.item?.id) openEdit(r.item.id); });
    const qtyInput = row.querySelector('.cr-qty');
    const savedTag = row.querySelector('.cr-saved-tag');
    let lastValue = r.qty;
    let qtyDebounceTimer = null;

    async function commitQty(fromDebounce){
      const val = parseInt(qtyInput.value, 10);
      if (!val || val < 1) {
        if (!fromDebounce) {
          if (await crudConfirm('Qty kosong/0 — hapus item ini dari set?', { danger: true, okLabel: 'Ya, Hapus' })) { deleteCompItem(r.id); }
          else { qtyInput.value = lastValue; }
        }
        return;
      }
      if (val === lastValue) return;
      const { error } = await sb.from('produk_set_item').update({ qty: val }).eq('id', r.id);
      if (error) { showToast('Gagal update qty: ' + error.message, true); qtyInput.value = lastValue; return; }
      lastValue = val;
      r.qty = val;
      qtyInput.classList.add('saved');
      savedTag.style.display = 'inline';
      setTimeout(() => { qtyInput.classList.remove('saved'); savedTag.style.display = 'none'; }, 1200);
      document.getElementById('compTotalQty').textContent = compRows.reduce((s,x) => s + (x.qty || 0), 0);
      document.getElementById('compEstBerat').textContent = compRows.reduce((s,x) => s + ((x.item?.berat_gram || 0) * (x.qty || 0)), 0).toLocaleString('id-ID') + ' g';
      refreshSetHeader();
    }
    // autosave debounced tiap ketik (jaring pengaman kalau user pindah halaman tanpa blur)
    qtyInput.addEventListener('input', () => {
      clearTimeout(qtyDebounceTimer);
      qtyDebounceTimer = setTimeout(() => commitQty(true), 700);
    });
    qtyInput.addEventListener('blur', () => { clearTimeout(qtyDebounceTimer); commitQty(false); });
    qtyInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { clearTimeout(qtyDebounceTimer); qtyInput.blur(); }
      if (e.key === 'Escape') { clearTimeout(qtyDebounceTimer); qtyInput.value = lastValue; qtyInput.blur(); }
    });
    row.querySelector('.cr-del').addEventListener('click', async () => {
      if (await crudConfirm('Hapus item ini dari set?', { danger: true, okLabel: 'Ya, Hapus' })) deleteCompItem(r.id);
    });
    wrap.appendChild(row);
  });

  if (lastAddedItemRowId) {
    const el = wrap.querySelector(`[data-row-id="${lastAddedItemRowId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.style.transition = 'background .3s ease';
      el.style.background = 'var(--teal-ok-bg)';
      setTimeout(() => { el.style.background = ''; }, 1500);
    }
    lastAddedItemRowId = null;
  }
}
async function deleteCompItem(rowId){
  const { error } = await sb.from('produk_set_item').delete().eq('id', rowId);
  if (error) { showToast('Gagal hapus item: ' + error.message, true); return; }
  showToast('Item dihapus dari set');
  await loadComposition();
  await refreshSetHeader();
}

let compSearchTimer = null;
document.getElementById('compSearchInput').addEventListener('input', () => {
  clearTimeout(compSearchTimer);
  const q = document.getElementById('compSearchInput').value.trim();
  const resEl = document.getElementById('compSearchResults');
  if (!q) { resEl.innerHTML = ''; return; }
  compSearchTimer = setTimeout(async () => {
    const { data, error } = await sb.rpc('search_produk_dengan_harga', { q, p_tipe: null, only_akd: false, only_kfa: false });
    if (error) { resEl.innerHTML = `<div class="akd-empty">Gagal mencari: ${escapeHtml(error.message)}</div>`; return; }
    const filtered = (data || []).filter(r => r.tipe !== 'SET').slice(0, 10);
    if (filtered.length === 0) { resEl.innerHTML = '<div class="akd-empty">Tidak ditemukan (SET tidak bisa jadi isi set lain).</div>'; return; }
    resEl.innerHTML = '';
    filtered.forEach(r => {
      const row = document.createElement('div');
      row.className = 'akd-result-row';
      row.innerHTML = `<span class="ar-no">${escapeHtml(r.kode_produk)}</span><span class="ar-nama">${escapeHtml(r.nama_produk || '')}</span><span class="tipe-chip">${escapeHtml(r.tipe)}</span>`;
      row.addEventListener('click', () => addCompItem(r.kode_produk));
      resEl.appendChild(row);
    });
  }, 250);
});
async function addCompItem(kodeProduk){
  const { data: item, error: itemErr } = await sb.from('produk').select('id').eq('kode_produk', kodeProduk).single();
  if (itemErr || !item) { showToast('Gagal menemukan produk', true); return; }
  const { data: inserted, error } = await sb.from('produk_set_item').insert({ set_id: currentSetId, produk_id: item.id, qty: 1 }).select('id').single();
  if (error) {
    if (error.code === '23505') { showToast('Item ini sudah ada di set'); return; }
    showToast('Gagal tambah item: ' + error.message, true); return;
  }
  showToast('Item ditambahkan (qty default 1) — atur angkanya di daftar kalau perlu');
  document.getElementById('compSearchInput').value = '';
  document.getElementById('compSearchResults').innerHTML = '';
  lastAddedItemRowId = inserted?.id ?? null;
  await loadComposition();
  await refreshSetHeader();
}

// ---- Paste Rincian Set (dipindah dari Bulk Edit -- sekarang scoped ke SET yang lagi
// dibuka, bukan lintas-set lagi. Terima format 5-kolom apa adanya dari sheet Rincian Set
// (kode_set/nama_set diabaikan) ATAU format ringkas 2-kolom kode_item + qty. ----
let compPasteRows = [];
function parseSetKompLine(cols){
  if (cols.length >= 5) return { kodeItem: cols[2], namaItem: cols[3], qtyStr: cols[4] };
  if (cols.length >= 2) return { kodeItem: cols[0], namaItem: '', qtyStr: cols[1] };
  return { kodeItem: cols[0] || '', namaItem: '', qtyStr: '' };
}
document.getElementById('compPastePreviewBtn').addEventListener('click', async () => {
  const lines = S.parsePasteLines(document.getElementById('compPasteArea').value);
  if (lines.length === 0) { showToast('Belum ada data yang di-paste', true); return; }
  const kodeItemList = [...new Set(lines.map(l => parseSetKompLine(l).kodeItem).filter(Boolean))];
  const { data: produkRows, error } = await sb.from('produk').select('id, kode_produk, nama_produk, tipe').in('kode_produk', kodeItemList);
  if (error) { showToast('Gagal cek produk: ' + error.message, true); return; }
  const byKode = Object.fromEntries((produkRows || []).map(p => [p.kode_produk, p]));

  compPasteRows = lines.map(l => {
    const { kodeItem, namaItem, qtyStr } = parseSetKompLine(l);
    const qty = parseInt(qtyStr, 10);
    const itemProduk = byKode[kodeItem];
    let status = 'ok', msg = 'Siap diproses';
    if (!kodeItem) { status = 'err'; msg = 'Kode item kosong'; }
    else if (!itemProduk) { status = 'err'; msg = 'Kode item tidak ditemukan'; }
    else if (itemProduk.id === currentSetId) { status = 'err'; msg = 'Item gak boleh set ini sendiri'; }
    else if (itemProduk.tipe === 'SET') { status = 'err'; msg = 'Item tidak boleh SET (nested)'; }
    else if (!qty || qty < 1) { status = 'err'; msg = 'Qty tidak valid'; }
    return { kodeItem, namaItem, qty, itemProduk, status, msg };
  });

  renderCompPastePreview();
});
function renderCompPastePreview(){
  const wrap = document.getElementById('compPastePreviewWrap');
  const body = document.getElementById('compPastePreviewBody');
  const summary = document.getElementById('compPasteSummary');
  const okCount = compPasteRows.filter(r => r.status === 'ok').length;
  const errCount = compPasteRows.length - okCount;
  summary.innerHTML = `<span class="ok">${okCount} baris siap diproses</span>${errCount ? `<span class="warn">${errCount} baris bermasalah (tidak ikut diproses)</span>` : ''}`;
  wrap.style.display = 'block';
  body.innerHTML = '';
  compPasteRows.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="kode-cell">${escapeHtml(r.kodeItem)}</td>
      <td>${escapeHtml(r.namaItem || r.itemProduk?.nama_produk || '—')}</td>
      <td>${r.qty || '—'}</td>
      <td><span class="row-status ${r.status}">${r.status === 'ok' ? 'Siap' : r.msg}</span></td>
    `;
    body.appendChild(tr);
  });
  document.getElementById('compPasteProsesBtn').style.display = okCount > 0 ? 'inline-flex' : 'none';
}
document.getElementById('compPasteProsesBtn').addEventListener('click', async () => {
  const rows = compPasteRows.filter(r => r.status === 'ok');
  if (rows.length === 0) return;
  const timpaMode = document.getElementById('compPasteTimpaMode').checked;
  const btn = document.getElementById('compPasteProsesBtn');
  btn.disabled = true;
  const items = rows.map(r => ({ produk_id: r.itemProduk.id, qty: r.qty }));
  // Satu panggilan RPC = satu transaksi Postgres: kalau ada yang gagal di tengah,
  // semua di-rollback (gak ada kondisi item lama kehapus tapi item baru belum semua masuk).
  const { data, error } = await sb.rpc('save_set_composisi', {
    p_set_id: currentSetId,
    p_items: items,
    p_mode: timpaMode ? 'timpa' : 'gabung',
  });
  btn.disabled = false;
  if (error) { showToast('Gagal simpan komposisi: ' + error.message, true); return; }
  showToast(`Selesai — ${data?.processed ?? items.length} baris komposisi tersimpan`);
  document.getElementById('compPasteArea').value = '';
  document.getElementById('compPastePreviewWrap').style.display = 'none';
  document.getElementById('compPasteSummary').innerHTML = '';
  btn.style.display = 'none';
  compPasteRows = [];
  await loadComposition();
  await refreshSetHeader();
});

// ---- Pricing (tab, terpisah dari modal generic) ----
async function loadSetHarga(){
  const { data, error } = await sb.from('produk_harga').select('*').eq('produk_id', currentSetId).order('tahun', { ascending: false });
  const tbody = document.getElementById('setHargaTableBody');
  if (error) { tbody.innerHTML = `<tr><td colspan="4">Gagal memuat: ${escapeHtml(error.message)}</td></tr>`; return; }
  renderHargaGroupInto(tbody, data || [], () => { loadSetHarga(); refreshSetHeader(); });
}
document.getElementById('hitungKomposisiBtn').addEventListener('click', async () => {
  if (compRows.length === 0) { showToast('Belum ada item di komposisi set ini', true); return; }
  const btn = document.getElementById('hitungKomposisiBtn');
  const btnHtmlAsal = btn.innerHTML;
  // FIX (perf + UX): dulu query harga per item dijalanin SATU-SATU di dalam
  // loop (N round-trip berurutan ke Supabase — set isi 20 item = 20 request
  // nunggu gantian), dan tombolnya diem aja selama itu tanpa disable/spinner
  // sama sekali. Jadi kalau set-nya gede, user ngeklik terus ngira macet
  // (dan bisa aja re-klik berkali-kali numpuk request). Sekarang: (1) satu
  // query batched buat semua produk_id sekaligus, dan (2) tombolnya
  // didisable + kasih spinner + itung jumlah item selama proses jalan.
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> Menghitung ${compRows.length} item...`;
  try {
    const produkIds = compRows.map(r => r.produk_id);
    const { data: hargaRows, error } = await sb.from('produk_harga').select('produk_id, harga, tahun')
      .in('produk_id', produkIds).eq('jenis', 'EKATALOG').order('tahun', { ascending: false });
    if (error) { showToast('Gagal ambil harga item: ' + error.message, true); return; }

    // Beberapa produk bisa punya harga EKATALOG di lebih dari satu tahun --
    // karena hargaRows udah di-order tahun descending dari query di atas,
    // baris PERTAMA yang ketemu per produk_id otomatis harga tahun terbaru.
    const hargaTerbaruPerProduk = new Map();
    (hargaRows || []).forEach(h => {
      if (!hargaTerbaruPerProduk.has(h.produk_id)) hargaTerbaruPerProduk.set(h.produk_id, h.harga);
    });

    let total = 0;
    const itemTanpaHarga = [];
    for (const r of compRows) {
      const harga = hargaTerbaruPerProduk.get(r.produk_id);
      if (harga != null) { total += harga * r.qty; }
      else { itemTanpaHarga.push(r.item?.nama_produk || r.item?.kode_produk || 'item'); }
    }
    document.getElementById('sh_harga').value = Math.round(total);
    if (itemTanpaHarga.length > 0) {
      showToast(`Dihitung, tapi ${itemTanpaHarga.length} item belum punya harga EKATALOG (tidak ikut terhitung): ${itemTanpaHarga.slice(0,3).join(', ')}${itemTanpaHarga.length>3?', ...':''}`, true);
    } else {
      showToast('Harga terisi dari total komposisi — masih bisa diedit manual sebelum disimpan');
    }
  } finally {
    btn.disabled = false;
    btn.innerHTML = btnHtmlAsal;
  }
});
document.getElementById('addSetHargaBtn').addEventListener('click', async () => {
  const tahun = parseInt(document.getElementById('sh_tahun').value, 10);
  const hargaEkat = parseFloat(document.getElementById('sh_harga').value);
  if (!tahun || isNaN(hargaEkat)) { showToast('Lengkapi tahun dan harga EKATALOG', true); return; }
  const ok = await upsertHargaDariEkat(currentSetId, tahun, hargaEkat);
  if (!ok) return;
  document.getElementById('sh_tahun').value = ''; document.getElementById('sh_harga').value = '';
  showToast('Harga EKATALOG, SWASTA & UPLOAD tersimpan'); loadSetHarga(); refreshSetHeader();
});

// ---- AKD (tab, terpisah dari modal generic) ----
let setAkdLinks = [];
async function loadSetAkd(){
  const { data, error } = await sb.from('produk_akd').select('akd_id, akd:akd_id(id, no_akd, nama_akd, tipe_akd)').eq('produk_id', currentSetId);
  if (error) return;
  setAkdLinks = (data || []).map(r => r.akd).filter(Boolean);
  renderSetAkd();
}
function renderSetAkd(){
  const el = document.getElementById('setAkdCurrentList');
  if (setAkdLinks.length === 0) { el.innerHTML = '<div class="akd-empty">Belum ada AKD terhubung ke set ini.</div>'; return; }
  el.innerHTML = '';
  setAkdLinks.forEach(a => {
    const chip = document.createElement('div');
    chip.className = 'akd-chip';
    chip.innerHTML = `<span class="ac-no">${escapeHtml(a.no_akd)}</span><span class="ac-nama">${escapeHtml(a.nama_akd || '')}</span><button title="Lepas relasi"><i class="ti ti-x"></i></button>`;
    chip.querySelector('button').addEventListener('click', async () => {
      if (!await crudConfirm('Lepas relasi AKD ini dari set?', { danger: true, okLabel: 'Ya, Lepas' })) return;
      const { error } = await sb.from('produk_akd').delete().eq('produk_id', currentSetId).eq('akd_id', a.id);
      if (error) { showToast('Gagal melepas: ' + error.message, true); return; }
      showToast('Relasi AKD dilepas'); loadSetAkd(); refreshSetHeader();
    });
    el.appendChild(chip);
  });
}
let setAkdSearchTimer = null;
document.getElementById('setAkdSearchInput').addEventListener('input', () => {
  clearTimeout(setAkdSearchTimer);
  const q = document.getElementById('setAkdSearchInput').value.trim();
  const resEl = document.getElementById('setAkdResults');
  if (!q) { resEl.innerHTML = ''; return; }
  setAkdSearchTimer = setTimeout(async () => {
    const { data, error } = await sb.from('akd').select('id, no_akd, nama_akd').eq('tipe_akd', 'set').or(`no_akd.ilike.%${q}%,nama_akd.ilike.%${q}%`).limit(15);
    if (error) { resEl.innerHTML = `<div class="akd-empty">Gagal mencari: ${escapeHtml(error.message)}</div>`; return; }
    if (!data || data.length === 0) { resEl.innerHTML = '<div class="akd-empty">Tidak ditemukan.</div>'; return; }
    resEl.innerHTML = '';
    data.forEach(a => {
      const row = document.createElement('div');
      row.className = 'akd-result-row';
      row.innerHTML = `<span class="ar-no">${escapeHtml(a.no_akd)}</span><span class="ar-nama">${escapeHtml(a.nama_akd || '')}</span>`;
      row.addEventListener('click', async () => {
        const { error: linkErr } = await sb.from('produk_akd').insert({ produk_id: currentSetId, akd_id: a.id, is_primary: true });
        if (linkErr) { if (linkErr.code === '23505') { showToast('Sudah terhubung'); return; } showToast('Gagal: ' + linkErr.message, true); return; }
        showToast('AKD terhubung');
        document.getElementById('setAkdSearchInput').value = ''; resEl.innerHTML = '';
        loadSetAkd(); refreshSetHeader();
      });
      resEl.appendChild(row);
    });
  }, 250);
});

// ---- History (tab, best-effort — level produk; detail item/harga/AKD ada di Log global) ----
async function loadSetHistory(){
  const wrap = document.getElementById('setHistoryList');
  wrap.innerHTML = '<div style="color:var(--text-muted);">Memuat...</div>';
  const { data, error } = await sb.from('audit_log').select('*').eq('table_name', 'produk').eq('record_id', currentSetKode).order('changed_at', { ascending: false }).limit(30);
  if (error) { wrap.innerHTML = `<div style="color:var(--rust);">Gagal memuat: ${escapeHtml(error.message)}</div>`; return; }
  if (!data || data.length === 0) { wrap.innerHTML = '<div class="akd-empty">Belum ada riwayat perubahan level produk untuk set ini.</div>'; return; }
  wrap.innerHTML = '';
  data.forEach(row => {
    const el = document.createElement('div');
    el.className = 'log-entry';
    const jam = new Date(row.changed_at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
    el.innerHTML = `<div class="log-entry-top"><span class="log-action ${row.action}">${LOG_ACTION_LABELS[row.action] || row.action}</span><span class="log-meta">${jam} · ${escapeHtml(row.changed_by || 'tidak diketahui')}</span></div>
      <div class="log-summary">${buildLogSummary(row)}</div>`;
    wrap.appendChild(el);
  });
}
document.getElementById('openFullLogFromSetBtn').addEventListener('click', () => {
  document.getElementById('log_table').value = 'produk_set_item';
  logModalOverlay.classList.add('open');
  loadLog(1);
});

// ---- Sesuaikan modal generic: sembunyikan Harga & AKD kelola kalau tipe SET ----
// (jalur ini cuma kepakai buat "Edit Info Dasar" dari dalam Set Detail -- SET baru
// sekarang langsung dilempar ke Set Detail begitu Info Dasar tersimpan, lihat
// saveProdukInner, jadi gak pernah nyentuh tab Harga/AKD generic ini lagi)
// SPA migration: dulu `window.openEdit = ...` -- itu ngandelin kebiasaan
// classic-script sloppy-mode di mana `window.foo` dan binding lokal `foo` saling
// nge-alias otomatis buat top-level function declarations, jadi reassign
// `window.openEdit` ikut ngubah semua pemanggilan `openEdit(...)` polos di
// tempat lain di file ini juga. Begitu kode ini pindah ke dalam mount()
// (function scope, bukan lagi top-level classic-script scope), alias otomatis
// itu HILANG -- reassign ke `window.openEdit` doang gak bakal kepakai sama
// pemanggilan `openEdit(...)` yang lain. Fix: reassign binding lokalnya
// langsung (`openEdit = ...`, tanpa `window.`), yang balik kerja sama persis
// kayak sebelumnya karena semua pemanggil sekarang satu function scope yang
// sama (mount()).
const _origOpenEdit = openEdit;
openEdit = async function(produkId){
  await _origOpenEdit(produkId);
  const tipe = document.getElementById('f_tipe').value;
  const tabAkdBtn = document.querySelector('.prod-tab[data-tab="akd"]');
  const tabHargaBtn = document.querySelector('.prod-tab[data-tab="harga"]');
  if (tipe === 'SET') {
    toggleAkdBoxBtn.style.display = 'none';
    akdBox.style.display = 'none';
    document.getElementById('akdHint').textContent = '';
    tabAkdBtn.classList.add('hidden-for-set');
    tabHargaBtn.classList.add('hidden-for-set');
    if (document.getElementById('ptab-akd').classList.contains('active') || document.getElementById('ptab-harga').classList.contains('active')) {
      switchProdTab('dasar');
    }
    if (!document.getElementById('setRedirectNote')) {
      const note = document.createElement('div');
      note.id = 'setRedirectNote';
      note.className = 'akd-hint';
      note.style.marginTop = '4px';
      note.innerHTML = 'Harga & AKD untuk SET dikelola di halaman <b>Set Management</b>, bukan di sini.';
      toggleAkdBoxBtn.parentElement.appendChild(note);
    }
  } else {
    const note = document.getElementById('setRedirectNote');
    if (note) note.remove();
    toggleAkdBoxBtn.style.display = 'inline-flex';
    tabAkdBtn.classList.remove('hidden-for-set');
    tabHargaBtn.classList.remove('hidden-for-set');
  }
};

// ---- Route klik SET dari Produk list & command palette ke Set Management ----
const _origLoadProdukRowClick = null; // handled inline below via monkey-patch approach not needed; see loadProduk edits

// ---- Muat awal saat pertama masuk view Set (lazy) ----
// UPDATE (sesi lanjutan): logic ini (reload list Set setiap masuk view,
// kecuali detail panel lagi kebuka) SEKARANG hidup di dalam switchView()
// itu sendiri, dipicu dari sana -- listener terpisah yang nempel di sini
// (`.sb-item[data-view="set"]`) DIHAPUS karena tombolnya sendiri udah gak
// ada lagi di halaman ini (lihat switchView()'s komentar buat detail).

  // ---- BULK EDIT (Harga / Link V6 / Inaproc Tracker) ----
  // Dipindah ke ./bulk.js (breakup sesi ini, lanjutan akd-master.js + kfa.js).
  S.invalidateProdukStackCache = invalidateProdukStackCache;
  S.loadProduk = loadProduk;
  S.refreshProdukFilterCounts = refreshProdukFilterCounts;
  installBulk(S);

// ---- Delete produk ----
// Konstraint FK asli (dicek langsung ke Postgres, bukan asumsi):
//  - produk_harga, produk_media, produk_akd, produk_set_item.set_id -> CASCADE.
//    Rincian/komposisi SET, harga, media, & relasi AKD OTOMATIS ikut kehapus
//    barengan produk induknya di satu statement DELETE (atomic, DB yang jamin).
//  - produk_set_item.produk_id (posisi produk ini sbg ITEM di SET LAIN) -> RESTRICT.
//    Wajib dilepas manual dulu di sini, kalau nggak delete produk gagal total.
//  - inaproc_pengajuan.produk_id, permintaan_item.matched_produk_id,
//    konversi_item.produk_id -> NO ACTION. Ini riwayat lintas modul (pengajuan
//    INAPROC, Permintaan RS, konversi) yang SENGAJA kita hormati, bukan di-bypass —
//    bukan wewenang halaman Produk buat hapus diam-diam. Kalau masih ada baris di
//    situ, delete diBLOK dengan pesan jelas, bukan dibiarin gagal error Postgres mentah.
deleteBtn.addEventListener('click', async () => {
  if (!currentProdukId) return;
  const id = currentProdukId;

  const [hargaR, mediaR, akdR, komposisiSendiriR, dipakaiDiSetLainR, inaprocR, permintaanR, konversiR] = await Promise.all([
    sb.from('produk_harga').select('id', { count: 'exact', head: true }).eq('produk_id', id),
    sb.from('produk_media').select('id', { count: 'exact', head: true }).eq('produk_id', id),
    sb.from('produk_akd').select('id', { count: 'exact', head: true }).eq('produk_id', id),
    sb.from('produk_set_item').select('id', { count: 'exact', head: true }).eq('set_id', id),
    sb.from('produk_set_item').select('id', { count: 'exact', head: true }).eq('produk_id', id),
    sb.from('inaproc_pengajuan').select('id', { count: 'exact', head: true }).eq('produk_id', id),
    sb.from('permintaan_item').select('id', { count: 'exact', head: true }).eq('matched_produk_id', id),
    sb.from('konversi_item').select('id', { count: 'exact', head: true }).eq('produk_id', id),
  ]);
  const hargaCount = hargaR.count || 0, mediaCount = mediaR.count || 0, akdCount = akdR.count || 0,
        komposisiSendiri = komposisiSendiriR.count || 0, dipakaiDiSetLain = dipakaiDiSetLainR.count || 0,
        inaprocCount = inaprocR.count || 0, permintaanCount = permintaanR.count || 0, konversiCount = konversiR.count || 0;

  const blokir = [];
  if (inaprocCount) blokir.push(`${inaprocCount} riwayat pengajuan INAPROC`);
  if (permintaanCount) blokir.push(`${permintaanCount} riwayat Permintaan RS`);
  if (konversiCount) blokir.push(`${konversiCount} riwayat konversi`);
  if (blokir.length) {
    await crudAlert(`Produk ini belum bisa dihapus — masih ada ${blokir.join(', ')} yang menunjuk ke sini. Data riwayat lintas modul ini sengaja tidak dihapus otomatis dari halaman Produk; bersihkan dulu dari sumbernya kalau memang perlu.`);
    return;
  }

  const parts = [];
  if (hargaCount) parts.push(`${hargaCount} baris harga`);
  if (mediaCount) parts.push(`${mediaCount} media`);
  if (akdCount) parts.push(`${akdCount} relasi AKD`);
  if (komposisiSendiri) parts.push(`${komposisiSendiri} item komposisi set ini`);
  let pesan = 'Hapus produk ini?';
  if (parts.length) pesan += ' Ikut terhapus otomatis: ' + parts.join(', ') + '.';
  if (dipakaiDiSetLain) pesan += ` ⚠️ Produk ini masih jadi item komposisi di ${dipakaiDiSetLain} SET lain — relasinya di sana akan dilepas dulu (komposisi set-set itu berkurang satu item), baru produknya dihapus.`;
  if (!await crudConfirm(pesan, { danger: true, okLabel: 'Ya, Hapus' })) return;

  if (dipakaiDiSetLain) {
    const { error: detachErr } = await sb.from('produk_set_item').delete().eq('produk_id', id);
    if (detachErr) { showToast('Gagal melepas relasi dari set lain: ' + detachErr.message, true); return; }
  }

  // Sisanya (harga, media, relasi AKD, komposisi SET ini sendiri) ikut kehapus
  // otomatis lewat CASCADE dalam satu statement ini.
  const { error } = await sb.from('produk').delete().eq('id', id);
  if (error) { showToast('Gagal hapus produk: ' + error.message, true); return; }
  showToast('Produk dan seluruh data terkait berhasil dihapus');
  closeModal();
  invalidateProdukStackCache();
  loadProduk();
  refreshProdukFilterCounts();
});

  // ---- AKD MANAGEMENT ----
  // Dipindah ke ./akd-master.js (breakup sesi ini). Fungsi loadAkd/
  // loadAkdDistinctValues yang dulu dipanggil langsung dari switchView()
  // sekarang diakses lewat S.loadAkd()/S.loadAkdDistinctValues() (lihat
  // akd-master.js baris paling bawah, yang nempelin keduanya ke S).
  installAkdMaster(S);
  // ---- KFA MANAGEMENT + SINKRONISASI ----
  // Dipindah ke ./kfa.js (breakup sesi ini, lanjutan akd-master.js). openAdd
  // (masih di index.js -- bagian modal produk belum dipecah) dioper lewat
  // S.openAdd; loadKfa/refreshKfaFilterCounts/loadSyncUnmatched/
  // jumpToKfaSearch diakses balik lewat S (lihat switchView() & tombol
  // jumpToKfaLink di modal produk).
  S.openAdd = openAdd;
  installKfa(S);

  // Kick off the initial data load now -- moved here from near the top of
  // mount() (see the long comment by the old spot, near the auth section)
  // specifically to land after every `let`/`const` this depends on has
  // executed. Still fires synchronously within this same mount() call,
  // same as before.
  loadProduk();
  refreshProdukFilterCounts();
  handleNavParamsIfAny();

  // Initial view: whatever sub-route the URL had when this page first
  // mounted (deep link from the sidebar accordion or a bookmark/refresh),
  // defaulting to 'produk' same as before this session (previously the
  // default was implicit -- markup.js's static HTML just happened to
  // start with viewProduk visible and nothing else; now explicit since a
  // direct link to e.g. #crud-produk/kfa needs this to actually land on
  // KFA Management instead of Produk).
  switchView(initialSub || 'produk');
}

/** Dipanggil router.js tiap kali URL sub-route berubah TANPA modul-nya
 * ikut berubah (misal user klik dari "Produk" ke "KFA Management" di
 * sidebar accordion, keduanya di bawah crud-produk yang sama) -- lihat
 * router.js's render() buat kapan persisnya ini vs mount() penuh yang
 * dipanggil. Ini fungsi TOP-LEVEL beneran (bukan nested di dalam mount()
 * kayak percobaan pertama yang salah) -- lewat `_switchView` (module-level,
 * lihat deklarasinya dekat `mountedContainer`) buat nyampe ke switchView()
 * yang tetep nested di dalam mount(). */
export function setSubroute(sub) {
  _switchView?.(sub || 'produk');
}

export function unmount() {
  // Lepas semua listener document/window-level yang di-nama-in di atas --
  // listener yang nempel di elemen DALAM container udah otomatis ke-GC pas
  // router.js nge-set container.innerHTML = '' sebelum manggil unmount ini,
  // jadi cuma yang document/window-level yang perlu dilepas manual.
  if (filterPopOutsideClickHandler) document.removeEventListener('click', filterPopOutsideClickHandler);
  if (resizeHandler) window.removeEventListener('resize', resizeHandler);
  if (cmdkKeydownHandler) document.removeEventListener('keydown', cmdkKeydownHandler);
  if (beforeUnloadHandler) window.removeEventListener('beforeunload', beforeUnloadHandler);
  filterPopOutsideClickHandler = null;
  resizeHandler = null;
  cmdkKeydownHandler = null;
  beforeUnloadHandler = null;

  // UPDATE (jank fix): pnm-universal.css NO LONGER removed here. It's now
  // a permanent <link> loaded once by shell.html/index.html -- see the
  // shared-pnm-universal-css comment in app/shell.html for why (removing
  // and reloading it on every navigation caused a brief unstyled flash
  // that read as a slight "zoom" jump). Same treatment font/tabler-icons
  // already had, noted in the line above.

  // Fix (sesi kedua puluh dua, 28 Agustus 2026): style.css halaman ini
  // (page-crud-produk-style) juga TIDAK PERNAH dilepas -- kelas bug yang
  // sama dengan export-gambar/kompres-pdf, versi lebih ringan (cuma bare
  // `table`/`th`/`td`, bukan `:root`/`body`/`h1`), jadi dampaknya kebatas
  // ke elemen <table> di halaman lain kalau user pernah mampir ke sini
  // duluan. Diflag sejak sesi kedelapan belas, baru sekarang difix.
  document.getElementById('page-crud-produk-style')?.remove();

  _switchView = null; // avoid a stale closure over this mount's DOM being callable after teardown
  mountedContainer = null;
}