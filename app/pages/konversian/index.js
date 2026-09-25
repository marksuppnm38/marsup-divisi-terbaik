// konversian page module: mount(container) / unmount().
//
// Per map.md bagian 4 urutan #3: halaman ini paling gede (6998+1351 baris)
// tapi paling siap secara auth (satu-satunya yang udah PNMAuth penuh sebelum
// migrasi ini) — jadi kerjaan migrasi di sini murni "bungkus jadi mount/
// unmount", BUKAN benerin auth kayak export-gambar.
//
// PENDEKATAN BEDA dari export-gambar/kompres-pdf: file ini SENGAJA TIDAK
// di-rescope dari document.getElementById(...) ke container.querySelector(...)
// di ribuan titik pemanggilan. Itu berisiko tinggi buat file sebesar ini
// tanpa test browser end-to-end (lihat catatan verifikasi di map.md). Yang
// bikin ini tetap AMAN: konversian.js/sph-module.js sudah menangkap semua
// referensi elemen di awal, SETELAH markup di-inject ke container (container
// sendiri adalah child dari <div id="app"> yang notabene bagian dari
// `document`) — jadi document.getElementById tetap nemu elemen yang benar
// selama cuma SATU halaman yang termount di satu waktu (dijamin router.js:
// unmount() halaman lama dipanggil + container.innerHTML dikosongin SEBELUM
// halaman baru di-mount).
//
// Body konversian.js + sph-module.js ASLI (isi fungsi/logic) TIDAK diubah,
// kecuali 5 patch bedah kecil (semua ditandai komentar "SPA migration" di
// titik masing-masing) buat nangkep handle yang dibutuhin unmount():
//   1. konversian.js: PNMAuth.onAuthStateChange(...) return value ditangkep
//      ke __konvAuthUnsub (dulu: dibuang, sesi lama gapapa krn cuma load
//      sekali seumur hidup tab; SPA bisa mount-unmount-mount ulang).
//   2. konversian.js: refresh badge sesi ditangkep ke __konvSesiCountCleanup
//      (awalnya setInterval 30 detik biasa; sejak audit 2026-09-25 sudah
//      diganti channel Realtime + resync timer 5 menit, lihat COORD LOG di
//      bawah dan realtime.js — nama handle-nya ikut berubah tapi titik
//      tangkapan buat unmount() ini masih sama).
//   3. konversian.js: listener document click buat nutup autocomplete
//      di-nama-in (__konvDismissAcOnOutsideClick) biar bisa di-removeEventListener.
//   4. konversian.js: baris paling akhir nambahin window.__konvBridge = {...}
//      yang ngumpulin semua handle di atas + fungsi yang udah ADA di file asli
//      (updateOnlineStatus, switchTab, unsubscribeFromSesiRealtime) — dipakai
//      unmount() di bawah.
//   5. Inline script "conv-flow-ux" (dulu <script> ke-2 di konversian.html):
//      nambahin window.convFlow._cleanup() (disconnect 2 MutationObserver +
//      lepas keydown listener + clear 2 timer) — sebelumnya cuma expose
//      showSuccess/showError/reset, gak ada cara bersih-bersih dari luar.
//
// ═══════════════════════════════════════════════════════════════════════════
// SESI BREAKUP (Claude, susulan) — file ini SEKARANG SUDAH dipecah jadi
// search.js/clipboard.js/sph.js/dictionary.js/set-mendekati.js/
// permintaan-rs.js/realtime.js sesuai target struktur bagian 3 map.md.
// index.js masih pegang mount()/unmount() + bagian yang BELUM dipecah
// (auth, dropzone/lampiran/gambar modal, resize/collapse panel, preferensi,
// status koneksi, navigasi, record-ke-sheets, dual write, modul stok,
// modul converter+resolve manual) — semua bagian ini SENGAJA belum disentuh
// sesi ini (di luar 7 target file map.md), didokumentasikan di sini biar
// sesi berikutnya tau batasnya, bukan kelupaan.
//
// PENDEKATAN: mount() = 9385 baris SATU closure raksasa, 630 variabel/fungsi
// top-level di dalamnya, 276 di antaranya (45%) dipakai LINTAS lebih dari
// satu "section" — bukan modul yang kebetulan nempel 1 file, tapi state
// yang genuinely saling silang (clipboard, showToast, sesiFetch, rpc,
// checklistItems, rt, dst dipanggil dari mana-mana). Jadi TIDAK dipecah
// pakai `import`/`export` per-fungsi (bakal circular & mustahil rapi) —
// dipakai satu objek `S` (dideklarasi di baris pertama mount(), fresh tiap
// mount() dipanggil) yang dioper ke tiap install*(S), sama persis pola
// window.__konvBridge yang udah ada di file ini buat unmount(). Tiap
// install*(S) fungsi isinya statement ASLI dari section terkait (LOGIC TIDAK
// DIUBAH sama sekali), cuma referensi ke nama yang didefinisikan di file
// LAIN diganti jadi S.nama. index.js manggil install*(S) di titik yang
// PERSIS SAMA (urutan baris asli) dengan posisi section itu dulu, jadi
// urutan eksekusi runtime gak berubah.
//
// GIMANA DIVERIFIKASI (sandbox ini gak ada akses browser/Supabase beneran,
// lihat catatan verifikasi map.md yang sama berlakunya di sini):
//   1. Setiap 630 top-level binding di-klasifikasi otomatis pakai AST scope
//      analysis (eslint-scope) — bukan tebak-tebak regex/indentasi.
//   2. Isi 8 file (index.js + 7 modul) diverifikasi ESM-parse valid (espree).
//   3. Tiap file di-scan ulang pakai scope analysis buat cari referensi
//      "orphan" (nama yang ke-tinggal, resolve ke undefined) — NOL orphan
//      ditemukan setelah 1 bug shorthand-property ({ foo } yang harusnya
//      { foo: S.foo }) ketemu & diperbaiki.
//   4. Urutan eksekusi divalidasi terpisah: dicek gak ada referensi lintas-
//      region yang butuh nilai SEBELUM titik itu benar-benar sempat
//      dijalankan di urutan install*(S) yang baru — NOL kasus berisiko.
//   5. Isi 8 file di-diff balik ke isi mount() asli (per baris) — 100%
//      cocok, gak ada baris logic yang hilang/berubah/duplikat.
//   BELUM/GAK BISA diverifikasi di sini: perilaku runtime beneran (auth
//   flow, realtime channel, RPC Supabase, render DOM) — WAJIB smoke-test
//   manual di browser (buka semua tab: Cari Cepat, Konversi, Kebutuhan RS,
//   Clipboard, Buat SPH, Cari SET Mendekati, Dictionary) sebelum di-deploy
//   ke production. index.js.PRE-BREAKUP.bak disimpan di folder ini kalau
//   perlu rollback cepat.
//
// UPDATE (bug ditemukan lewat testing browser BENERAN, langsung dari user):
// versi PERTAMA breakup ini punya bug — 32 titik deklarasi (variabel yang
// di-reassign, mis. `stokAccessToken`) ke-rename DOBEL jadi `S.S.nama`
// (VALID secara syntax — makanya lolos semua pengecekan otomatis awal,
// TypeError-nya baru muncul pas runtime beneran manggil `S.S.stokAccessToken`
// yang objeknya undefined). Root cause: generator nge-rename SEMUA reference
// eslint-scope buat variabel yang direname, padahal salah satu "reference"
// itu adalah posisi deklarasi itu sendiri (`r.init === true`, node identifier
// SAMA PERSIS dengan node yang udah kena edit terpisah buat hapus keyword
// let/var + tambah prefix S.). Sudah diperbaiki di generator (skip reference
// yang `r.init` buat variabel mode full-rename) + ditambahin guard baru:
// build SEKARANG gagal keras (throw) kalau ada dua edit di posisi/baris yang
// overlap, jadi kelas bug ini gak akan lolos diam-diam lagi di masa depan.
// Semua 8 file di-generate ulang dari nol pakai generator yang sudah diperbaiki.
// Pelajaran buat sesi berikutnya: "lolos parse + scope-analysis" TIDAK CUKUP
// buat breakup gaya ini — `S.S.nama` valid secara AST/scope (cuma property
// access berantai), jadi WAJIB browser-test beneran sebelum percaya hasilnya.
// ═══════════════════════════════════════════════════════════════════════════

import { KONVERSIAN_MARKUP } from './markup.js';
import { installRealtime } from './realtime.js';
import { installClipboard } from './clipboard.js';
import { installSearch } from './search.js';
import { installDictionary } from './dictionary.js';
import { installSetMendekati } from './set-mendekati.js';
import { installPermintaanRs } from './permintaan-rs.js';
import { installSph } from './sph.js';

// Independent vendor libs — gak saling bergantung satu sama lain, aman
// di-Promise.all (pola sama kayak kompres-pdf).
//
// FIX (sesi lanjutan, bug ditemukan lewat testing browser beneran):
// /shared/toast.js, /shared/supabase-client.js, dan /shared/auth-session.js
// di bawah ini SEMPET punya suffix `?v=...` (cache-busting) yang GAK ADA di
// 4 modul lain yang juga muat file yang SAMA PERSIS (dashboard/stok/
// export-gambar/crud-produk, semua pakai URL bare tanpa versi). Selama
// navigasi antar-modul SELALU full page reload (window.location.href, cara
// lama "Kembali ke Konversi" dkk kerja), ini gak pernah kelihatan sebagai
// masalah -- tiap reload reset semua state JS dari nol. Begitu nav redesign
// bikin navigasi antar-modul jadi SPA murni (hash-based, TANPA reload),
// loadScript()'s guard (cek `document.querySelector('script[src="..."]')`,
// match STRING PERSIS) gak lagi ngenalin `/shared/toast.js` (dari
// crud-produk) sama `/shared/toast.js?v=20260813a` (dari sini) sebagai file
// yang sama -- keduanya ke-load, `const PNMToast`/`const PNMAuth` di
// declare dua kali di global scope yang sama = SyntaxError
// "Identifier ... has already been declared". Suffix `?v=...` DIHAPUS di
// sini (bukan ditambahin ke 4 modul lain) karena bare URL itu konvensi
// MAYORITAS di codebase ini -- fix yang lebih kecil/lebih aman.
const VENDOR_SCRIPTS_INDEPENDENT = [
  '/shared/toast.js',
];
// Sequential — sama alasan kayak export-gambar: tiap file bergantung ke
// global yang dibikin file sebelumnya (window.supabase -> window.pnmSupabase
// -> window.PNMAuth), gak bisa Promise.all.
const VENDOR_SCRIPTS_SEQUENTIAL = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js',
  '/shared/supabase-client.js',
  '/shared/auth-session.js',
];


// SECURITY (polishing job, hari ini): parameter kedua opsional `integrity`
// -- SRI hash (Subresource Integrity). Kalau diisi, browser sendiri yang
// nolak nge-eksekusi file itu kalau byte-nya beda dari hash yang
// diharapkan (proteksi kalau CDN-nya suatu saat "salah kirim" versi lain
// dari yang seharusnya, sengaja atau kena kompromi). Sengaja OPSIONAL
// (bukan wajib di semua panggilan `loadScript()`) karena SRI cuma valid
// buat URL yang di-pin ke versi PERSIS (mis. exceljs@4.3.0) -- kalau
// URL-nya masih pakai tag longgar (mis. @supabase/supabase-js@2, yang
// bisa diam-diam resolve ke rilis 2.x manapun kapan saja), nambahin hash
// tetap di sini bakal bikin app ini rusak total begitu paket itu rilis
// versi baru (hash lama gak lagi cocok, browser nolak load, login/semua
// fitur mati) -- itu kenapa 2 vendor lain (`@supabase/supabase-js@2`,
// `docx@8`) masih TANPA integrity di bawah, bukan kelupaan.
function loadScript(src, integrity) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    if (integrity) {
      s.integrity = integrity;
      s.crossOrigin = 'anonymous'; // wajib ada bareng integrity, atau browser blokir scriptnya
    }
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Gagal memuat ' + src));
    document.head.appendChild(s);
  });
}

// exceljs.min.js (lewat dependency regenerator-runtime yang ke-bundle di
// dalamnya) punya pola `try { regeneratorRuntime = i } catch(t) {
// Function("r","regeneratorRuntime = r")(i) }`. Karena bundle-nya jalan di
// strict mode (hasil minifikasi), assignment ke `regeneratorRuntime` yang
// belum pernah dideklarasikan di scope manapun bakal langsung throw
// ReferenceError → jatuh ke catch → fallback-nya pakai `Function(...)`
// (setara eval) buat maksa bikin global. Di CSP yang gak ngizinin
// 'unsafe-eval' (cuma 'wasm-unsafe-eval'), itu diblokir browser dan
// nge-crash separuh jalan lewat inisialisasi bundle-nya, jadi window.ExcelJS
// gak pernah keisi ("ExcelJS is not defined" pas tombol export dipencet).
// Lihat exceljs/exceljs#2345 — bug ini masih terbuka di upstream.
// Fix: predeclare `regeneratorRuntime` sebagai OWN PROPERTY di window
// SEBELUM script exceljs di-load. Begitu property-nya udah ada di objek
// global, assignment bare-identifier `regeneratorRuntime = i` di dalam
// exceljs bisa resolve ke property itu dan berhasil normal — jalur
// try-nya gak pernah gagal, jadi catch/Function(...) gak pernah kepanggil
// sama sekali. Ini BUKAN 'unsafe-eval' dan gak butuh ganti versi/library.
function ensureExceljsEvalWorkaround() {
  if (!('regeneratorRuntime' in window)) {
    window.regeneratorRuntime = undefined;
  }
}

let vendorReady = null;
function ensureVendorScripts() {
  // PERFORMANCE FIX (polishing job -- "web app kerasa lemot", terutama di
  // HP): ini DULU nge-load 5 library berat SEKALIGUS -- exceljs, pdfjs-dist,
  // tesseract.js (OCR, paling berat, ada wasm-nya), jspdf, docx -- setiap
  // kali modul Konversian di-mount, WALAU 90% kunjungan cuma buat search &
  // tambah ke clipboard, gak pernah nyentuh scan gambar/import PDF/export
  // Excel-Word sama sekali. Halaman jadi gak interaktif sampai SEMUA itu
  // kelar didownload+dieksekusi, padahal cuma butuh Supabase (buat search)
  // + toast (buat notifikasi error/sukses) buat mulai jalan.
  // Sekarang ensureVendorScripts() cuma nanggung dua itu -- yang beneran
  // dibutuhin SEMUA orang, tiap kunjungan. Lima library berat lainnya
  // dipindah ke fungsi ensureXxx() masing-masing di bawah (ensureExceljs,
  // ensurePdfJs, ensureTesseract, ensureSphExportLibs), dipanggil (dan
  // baru DI SITU didownload) persis di titik fitur yang butuh -- lihat
  // titik pemanggilannya masing-masing (S.ensureExceljs dkk) di
  // clipboard.js/permintaan-rs.js/sph.js/index.js. Kalau fiturnya emang
  // dipakai, user tetap nunggu download itu -- cuma sekarang NUNGGUNYA pas
  // beneran mau pakai fiturnya, bukan di depan buat semua orang.
  if (window.PNMAuth && window.pnmSupabase && window.PNMToast) {
    return Promise.resolve();
  }
  if (!vendorReady) {
    const independent = Promise.all(VENDOR_SCRIPTS_INDEPENDENT.map(loadScript));
    const sequential = VENDOR_SCRIPTS_SEQUENTIAL.reduce(
      (chain, src) => chain.then(() => loadScript(src)),
      Promise.resolve()
    );
    vendorReady = Promise.all([independent, sequential]);
  }
  return vendorReady;
}

// ══════════════════════════════════════════
// LAZY VENDOR LIBS -- lihat komentar panjang di ensureVendorScripts() di
// atas buat alasannya. Empat fungsi di bawah masing-masing nanggung SATU
// (atau sepasang, kalau memang selalu dipakai bareng) library berat, dan
// masing-masing baru nembak network request PERTAMA KALI dipanggil --
// bukan pas mount(). Semua idempotent (aman dipanggil berkali-kali --
// panggilan kedua dst tinggal balikin promise/cache yang sama, gak
// double-download) dan cache-nya di level MODULE (bukan di S), jadi
// sekali kepanggil di satu sesi buka halaman, gak perlu download ulang
// lagi walau modul ini di-unmount lalu di-mount balik.
// ══════════════════════════════════════════

let exceljsReady = null;
function ensureExceljs() {
  if (window.ExcelJS) return Promise.resolve();
  if (!exceljsReady) {
    ensureExceljsEvalWorkaround(); // HARUS sebelum script-nya keload, lihat komentar di atas fungsi ini
    exceljsReady = loadScript(
      'https://cdn.jsdelivr.net/npm/exceljs@4.3.0/dist/exceljs.min.js',
      'sha384-P7KKlGD3Ng66Ds7oTliLzTnol6DbK+k7PafNYXIBDQ4b5eFWtmqctplDVOxslglR'
    );
  }
  return exceljsReady;
}

let pdfJsReady = null;
function ensurePdfJs() {
  if (window.pdfjsLib) return Promise.resolve();
  if (!pdfJsReady) {
    // workerSrc dulu di-set TELANJANG di top-level module (jalan pas mount(),
    // nunjuk ke pdfjsLib yang cuma ada kalau ensureVendorScripts() udah
    // nge-load-in duluan). Sekarang jadi bagian dari .then() ini -- baru
    // di-set begitu pdf.min.js beneran kelar keload, di titik yang sama
    // dengan pemanggilnya (getPdfPagesBase64/renderPdfFromUrl), bukan lagi
    // diam-diam bergantung ke urutan load vendor scripts yang lain.
    // NOTE: pdf.worker.min.js (di bawah, workerSrc) TIDAK bisa dikasih SRI
    // lewat cara yang sama -- itu bukan <script> tag, tapi di-fetch sendiri
    // sama pdf.js lewat `new Worker(url)` pas dokumen PDF pertama dibuka,
    // dan Web Worker API gak punya atribut `integrity` sama sekali (beda
    // dari <script>/<link>). Ini keterbatasan platform browser, bukan
    // sesuatu yang bisa ditutup dari sisi app ini.
    pdfJsReady = loadScript(
      'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
      'sha384-/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e'
    ).then(() => {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    });
  }
  return pdfJsReady;
}

let tesseractReady = null;
function ensureTesseract() {
  if (window.Tesseract) return Promise.resolve();
  if (!tesseractReady) tesseractReady = loadScript(
    'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.0/dist/tesseract.min.js',
    'sha384-1zP4ZOtlk2FXAOiUArpMuWf7INJJKe/ROfYFAVSeUa11DEfXdKWGiPI3dVma2Gt0'
  );
  return tesseractReady;
}

// jspdf + docx SENGAJA satu paket: keduanya cuma dipakai bareng, di dalam
// satu alur yang sama (sphGenerate() di sph.js -- generate PDF penawaran
// SEKALIGUS versi .docx tabel itemnya, satu tombol "Generate").
let sphExportLibsReady = null;
function ensureSphExportLibs() {
  if (window.jspdf && window.docx) return Promise.resolve();
  if (!sphExportLibsReady) {
    sphExportLibsReady = Promise.all([
      loadScript(
        'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
        'sha384-JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk'
      ),
      // docx@8 (bukan versi persis, mis. @8.6.0) SENGAJA belum dikasih SRI
      // -- lihat komentar panjang di loadScript() di atas file ini kenapa.
      loadScript('https://cdn.jsdelivr.net/npm/docx@8/build/index.umd.js'),
    ]);
  }
  return sphExportLibsReady;
}


// pnm-universal.css dulu dianggap "SHARED, tetap nempel selamanya" (biar
// halaman lain yang migrasi belakangan nge-skip re-load) — tapi itu yang
// bikin bug "tema kacau"/"blink aneh" pas balik ke #home atau modul lain:
// begitu di-load sekali, dia gak pernah lepas dari <head> sepanjang sesi
// SPA, dan berisi selector bare/unscoped (header{}, .stat-val, dst — lihat
// map.md sesi keenam) yang bocor ke halaman manapun yang kebetulan mount
// setelahnya. Fix: sekarang di-treat sama kayak stylesheet page-scoped
// lainnya (page-konversian-style, kompres-pdf/style.css, dst) — di-load pas
// mount(), DILEPAS pas unmount() (lihat unmount() di bawah). Browser HTTP
// cache bikin re-load ini nyaris instant (URL persis sama, gak berubah),
// jadi gak ada biaya nyata — cuma DOM <link> tag-nya yang gak lagi nempel
// permanen. Kalau nanti crud-produk/dashboard/stok ikut dimigrasi ke SPA
// dan butuh pnm-universal.css juga, mereka pakai pola yang sama: load di
// mount(), lepas di unmount() masing-masing.
const SHARED_LINKS = [
  { id: 'shared-google-fonts', href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400&display=swap' },
  // shared-phosphor-icons REMOVED (icon-library convergence pass): every
  // ph-* class in this module -- both markup.js and this file, including
  // the dynamic dark/light knob icon in renderSettingsList() -- was
  // switched to the ti-* (Tabler) set, matching the shared sidebar nav
  // and every other module. This page no longer renders a single
  // Phosphor glyph, so loading that whole second webfont on every mount
  // was pure dead weight.
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
  // Sesi kesepuluh fix (FOUC/blank-then-flash bug — sama kelas bug yang
  // dibenerin di app/pages/home/index.js dan kompres-pdf/export-gambar):
  // dulu ensureStyle() gak nunggu satupun link ini kelar sebelum mount()
  // lanjut ke container.innerHTML — sekarang balikin Promise gabungan biar
  // mount() bisa await-nya duluan.
  return Promise.all([
    ...SHARED_LINKS.map(({ id, href }) => loadLink(id, href)),
    loadLink('page-konversian-style', new URL('./style.css', import.meta.url).href),
  ]);
}

let mountedContainer = null;
// Module-level indirection for setSubroute() (real top-level export, near
// the very bottom of this file) to reach switchSubTab(), which stays a
// NESTED function inside mount() -- same pattern/reasoning as
// crud-produk/index.js's _switchView (see that file's comment for the
// full explanation; this is the identical fix for the identical mistake,
// just caught later here because it manifested as a ReferenceError at
// call-time rather than a SyntaxError at parse-time -- the export itself
// WAS correctly placed at top-level already, switchSubTab just wasn't
// reachable from there).
let _switchSubTab = null;

export async function mount(container, initialSub) {
  const S = {}; // shared cross-module state (breakup konversian/index.js — lihat map.md bagian 3)
  // BUGFIX 2026-09-15: escapeHtmlAttr dulu cuma didefinisikan+ditempel ke S di
  // dalam installPermintaanRs(S) (lihat permintaan-rs.js), yang baru dipanggil
  // MENJELANG AKHIR mount() -- tapi installRealtime(S), yang dipanggil jauh
  // lebih awal, langsung butuh S.escapeHtmlAttr secara SINKRON lewat
  // setClipHeaderCollapsed(...) kalau CLIP_HEADER_COLLAPSE_KEY di sessionStorage
  // udah kesimpen 'collapsed' dari sesi sebelumnya (updateClipHeaderCompact()
  // manggil S.escapeHtmlAttr langsung pas install, bukan nunggu event). Efeknya:
  // "S.escapeHtmlAttr is not a function" throw SINKRON di tengah mount(), yang
  // bikin sisa mount() (termasuk installPermintaanRs/installDictionary yang
  // ngerakit window.__konvBridge) gak pernah kejalanin -- router.js manggil
  // `await mod.mount(...)` tanpa try/catch (lihat router.js render()), jadi
  // currentPage juga gak pernah keisi, dan listener document-level yang udah
  // sempet dipasang installClipboard(S) SEBELUM crash (__konvDismissAcOnOutsideClick)
  // jadi gak pernah kelepas di unmount -- nempel selamanya dan makin lama makin
  // numpuk tiap percobaan buka halaman ini gagal, tiap klik di halaman LAIN pun
  // ikut lempar error karena '.search-wrap' punya halaman ini udah gak ada lagi
  // di DOM. Fix: definisikan escapeHtmlAttr di sini, secepat mungkin setelah S
  // dibikin -- sebelum install* manapun dipanggil -- biar gak lagi bergantung ke
  // urutan install*(S). Definisi lokal di permintaan-rs.js (S.escapeHtmlAttr =
  // escapeHtmlAttr) dibiarkan; dia cuma nimpa ulang fungsi yang identik.
  S.escapeHtmlAttr = function escapeHtmlAttr(s) {
    return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  };
  // Security: field `link`/`link_v6` datang dari database (diisi manual lewat
  // form), bukan sesuatu yang bisa kita percaya begitu aja buat langsung
  // ditaruh di href. Tanpa ini, value seperti "javascript:..." bisa kesimpen
  // dan jalan pas link-nya diklik. Cuma izinkan http(s) -- skema lain (atau
  // string kosong/invalid) dianggap gak aman buat dijadiin href.
  S.isSafeHttpUrl = function isSafeHttpUrl(u) {
    return /^https?:\/\//i.test(String(u == null ? '' : u).trim());
  };
  // Klasifikasi isi kolom link_v6. isSafeHttpUrl di atas cuma ngecek PREFIX
  // http(s)://, jadi value kayak "https://katalog.inaproc.id/.../robust-mayor-s-5
  // UPDATE HARGA TAPI MASIH NYANTOL ORDERAN" (URL + catatan tim yang kebawa
  // dari Google Sheet lewat sync) ikut lolos dan ke-label "Ada di e-Katalog v6".
  // Label/hyperlink/copy/export/SPH cuma boleh nyala buat state 'bersih':
  //   kosong  -> gak ada isi
  //   invalid -> ada teks tapi bukan URL (mis. "-", "N/A")
  //   bersih  -> URL doang, tanpa teks tambahan apa pun
  //   catatan -> ada URL TAPI ada teks lain di sekitarnya (perlu dicek manual)
  S.parseLinkV6 = function parseLinkV6(raw) {
    const t = String(raw == null ? '' : raw).replace(/[\u00a0\u200b-\u200d\ufeff]/g, ' ').trim();
    if (!t) return { state: 'kosong', url: null, catatan: '' };
    if (/^https?:\/\/\S+$/i.test(t)) return { state: 'bersih', url: t, catatan: '' };
    const m = t.match(/https?:\/\/\S+/i);
    if (!m) return { state: 'invalid', url: null, catatan: t };
    const catatan = t.replace(m[0], ' ').replace(/\s+/g, ' ').trim();
    return { state: 'catatan', url: m[0], catatan };
  };
  // Shortcut: balikin URL-nya HANYA kalau bersih, selain itu null.
  // "Belum firm": link_v6 ada catatan tambahan (mis. "UPDATE HARGA ...", "SINGLE
  // USE") = produk belum final di e-Katalog -> JANGAN dipakai buat konversian.
  // Cuma berlaku di mode e-Katalog (di mode Swasta link_v6 memang gak relevan).
  // `swasta`: true = mode Swasta (gak difilter). Default ikut S.modeSwasta;
  // jalur Converter/Cari SET pakai S.modeSwastaOutput.
  S.isProdukFirm = function isProdukFirm(r) {
    return S.parseLinkV6(r && r.link_v6).state !== 'catatan';
  };
  S.filterFirm = function filterFirm(rows, swasta) {
    const modeSwasta = (swasta === undefined) ? S.modeSwasta : swasta;
    return (modeSwasta || !Array.isArray(rows)) ? rows : rows.filter(S.isProdukFirm);
  };
  S.cleanLinkV6 = function cleanLinkV6(raw) {
    const r = S.parseLinkV6(raw);
    return r.state === 'bersih' ? r.url : null;
  };
  // Lazy vendor-lib loaders (lihat komentar panjang di ensureVendorScripts()/
  // ensureExceljs() dkk di atas file ini) -- ditempel ke S di sini, sepagi
  // mungkin, biar semua install*(S) di bawah (clipboard.js, permintaan-rs.js,
  // sph.js) bisa manggil S.ensureExceljs()/S.ensurePdfJs()/S.ensureTesseract()/
  // S.ensureSphExportLibs() persis di titik fitur beratnya masing-masing
  // dipakai, bukan nunggu semuanya keload di depan buat semua orang.
  S.ensureExceljs = ensureExceljs;
  S.ensurePdfJs = ensurePdfJs;
  S.ensureTesseract = ensureTesseract;
  S.ensureSphExportLibs = ensureSphExportLibs;
  mountedContainer = container;
  await Promise.all([ensureStyle(), ensureVendorScripts()]);
  container.innerHTML = KONVERSIAN_MARKUP;

  // ── inline script #1 (theme-init) — set <html data-theme> SEBELUM app
  // kelihatan, sama kayak posisinya di konversian.html asli (di atas <body>). ──
  (function(){
  var stored = localStorage.getItem('theme') || localStorage.getItem('pnum-theme');
  var theme = stored || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.style.colorScheme = theme;
  })();

  // ── inline script #2 (conv-flow-ux) — "menumpang" di atas elemen export/
  // drive modal, gak pernah mengubah konversian.js. Diposisikan sebelum
  // konversian.js jalan, sama seperti urutan aslinya di HTML (elemen yang
  // dia pegang sudah ada di markup yang barusan di-inject, jadi urutan
  // relatif terhadap konversian.js gak masalah — dia cuma nempel listener). ──

/* ============================================================
   CONVERSION FLOW UX — loading → success/error state untuk
   Export ke Excel & Simpan ke Drive, plus nyalain centang di
   stepper #conv-steps.
   ------------------------------------------------------------
   PENTING: script ini SENGAJA gak mengubah konversian.js sama
   sekali — cuma "menumpang" di atas elemen yang sudah ada:
     • Deteksi klik #btn-export / #btn-drive-upload → tau aksi mana
       yang jalan (buat ganti judul modal & step mana yg ditandai).
     • Amati teks #progress-label ("N / N") → tau kapan proses
       selesai, lalu tampilkan state sukses di modal yang sama
       (bukan modal yang tiba-tiba hilang tanpa konfirmasi).
     • Best-effort ambil link Drive dari input #rec-link (field itu
       tampaknya keisi otomatis setelah upload) buat tombol
       "Buka di Drive". Kalau kosong, tombol itu disembunyikan —
       gak ditebak-tebak.
   Kalau mau hasil yang lebih presisi (nama file & link asli dari
   response API, bukan tebakan dari DOM), konversian.js bisa manggil
   langsung setelah request berhasil/gagal:
     window.convFlow.showSuccess('export'|'drive', { filename, driveUrl, subtitle })
     window.convFlow.showError('export'|'drive', 'pesan error')
   ============================================================ */
(function(){
  function ready(fn){ document.readyState==='loading' ? document.addEventListener('DOMContentLoaded',fn) : fn(); }

  ready(function(){
    var overlay = document.getElementById('export-modal');
    var progressLabel = document.getElementById('progress-label');
    var modalTitle = document.getElementById('modal-title');
    var viewLoading = document.getElementById('export-modal-loading');
    var viewSuccess = document.getElementById('export-modal-success');
    var viewError = document.getElementById('export-modal-error');
    if(!overlay || !progressLabel || !viewLoading || !viewSuccess) return;

    var stepExport = document.getElementById('btn-export');
    var stepDrive = document.getElementById('btn-drive-upload');
    var btnRecord = document.getElementById('btn-record');
    var btnClearAll = document.getElementById('btn-clear-all');

    var COPY = {
      export: {
        loadingTitle: 'Menyiapkan Export…',
        successTitle: 'Export berhasil',
        successSub: function(){
          var n = (document.getElementById('clip-total')||{}).textContent || '0';
          return n + ' produk sudah masuk ke file Excel.';
        },
        nextLabel: 'Lanjut: Simpan ke Drive',
        get nextTarget(){ return stepDrive; },
        get step(){ return stepExport; }
      },
      drive: {
        loadingTitle: 'Mengunggah ke Drive…',
        successTitle: 'Tersimpan ke Drive',
        successSub: function(){ return 'File sudah ada di folder Drive sesi ini.'; },
        nextLabel: 'Lanjut: Record Konversi',
        get nextTarget(){ return btnRecord; },
        get step(){ return stepDrive; }
      }
    };

    var currentAction = 'export';
    var watching = false;
    var doneShown = false;
    // Khusus step 'drive': konversian.js sekarang manggil window.convFlow.
    // showSuccess/showError('drive', ...) LANGSUNG di titik yang beneran tau
    // hasilnya (lihat uploadKonversianToDrive) — itu jalur utama & normalnya
    // selalu kepakai dalam beberapa detik. Timer di bawah ini MURNI jaring
    // pengaman kalau ternyata gak ada sinyal apa pun yang pernah datang dalam
    // waktu wajar — itu tandanya proses upload-nya malah GAK PERNAH MULAI
    // (mis. ke-block guard clause di konversian.js sebelum sempat nelpon API,
    // atau error lain yang gak ketangkep) — BUKAN tanda "kemungkinan besar
    // berhasil". Makanya di sini kita tampilin state ERROR yang jujur, bukan
    // sukses palsu.
    var driveTimeoutTimer = null;
    var DRIVE_TIMEOUT_MS = 15000;

    function resetToLoading(action){
      currentAction = action;
      doneShown = false;
      watching = true;
      if(activePollTimer){ clearInterval(activePollTimer); activePollTimer = null; }
      if(driveTimeoutTimer){ clearTimeout(driveTimeoutTimer); driveTimeoutTimer = null; }
      var locBox = document.getElementById('conv-location');
      if(locBox) locBox.style.display = 'none';
      currentLocationPath = null;
      var c = COPY[action];
      if(modalTitle) modalTitle.textContent = c.loadingTitle;
      viewLoading.style.display = '';
      viewSuccess.style.display = 'none';
      if(viewError) viewError.style.display = 'none';
      if(c.step) c.step.classList.add('is-loading');
      if(action === 'drive'){
        driveTimeoutTimer = setTimeout(function(){
          driveTimeoutTimer = null;
          if(watching && currentAction === 'drive' && !doneShown){
            window.convFlow.showError('drive', 'Gak ada konfirmasi dari proses upload setelah 15 detik — kemungkinan prosesnya gak sempat mulai (cek notifikasi toast di pojok layar buat alasannya, mis. sesi ini belum ada Permintaan RS/tanggal, atau sesi login kedaluwarsa), bukan berarti sudah pasti berhasil. Cek folder Drive-nya manual dulu sebelum coba lagi.');
          }
        }, DRIVE_TIMEOUT_MS);
      }
    }

    if(stepExport) stepExport.addEventListener('click', function(){ if(!stepExport.disabled) resetToLoading('export'); });
    if(stepDrive) stepDrive.addEventListener('click', function(){ if(!stepDrive.disabled) resetToLoading('drive'); });
    if(btnClearAll) btnClearAll.addEventListener('click', function(){
      [stepExport, stepDrive].forEach(function(el){ if(el) el.classList.remove('is-done','is-loading'); });
      if(driveTimeoutTimer){ clearTimeout(driveTimeoutTimer); driveTimeoutTimer = null; }
    });

    function ensureOpen(){
      overlay.classList.add('show');
      overlay.classList.add('open');
      overlay.style.display = 'flex';
    }
    // userClosing: dinyalain SEBELUM kita nutup overlay lewat jalur yang kita
    // kontrol sendiri (tombol Tutup, Esc, atau "Lanjut"). overlayObs di bawah
    // pakai flag ini buat bedain "user yang nutup" vs "ke-tutup sendiri" (mis.
    // konversian.js masih punya rutinitas lama yang nutup modal ini begitu
    // proses upload kelar) — kalau bukan dari flag ini, modal dibuka lagi,
    // gak boleh ilang tanpa user yang mutusin nutup.
    var userClosing = false;
    function closeModal(){
      userClosing = true;
      overlay.classList.remove('show','open');
      overlay.style.display = 'none';
      setTimeout(function(){ userClosing = false; }, 0);
    }

    var driveOpenChip = document.getElementById('conv-step-drive-open');
    var driveHintEl = document.getElementById('conv-step-drive-hint');

    // currentLocationPath: path folder yang PASTI, dikirim konversian.js lewat
    // window.convFlow.showSuccess('drive', {locationPath}) tepat pas upload
    // beneran kelar (lihat uploadKonversianToDrive di konversian.js — folder-nya
    // "{tahun dari tanggal Permintaan RS} / {Nama Sales}", BUKAN nama RS/tahun
    // sekarang). buildLocationPath() di bawah cuma fallback KALAU BELUM ADA
    // locationPath asli (mis. modal masih di fase loading, atau timeout jaga-jaga
    // di resetToLoading kepicu tanpa convFlow sempat manggil) — makanya dia juga
    // dibikin sedeket mungkin sama pola aslinya (sales + tahun), bukan RS.
    var currentLocationPath = null;
    function buildLocationPath(){
      var sales = ((document.getElementById('inp-sales')||{}).value || '').trim();
      var year = new Date().getFullYear();
      return sales ? (year + ' / ' + sales) : (year + ' / Konversi');
    }
    function resolveLocationPath(){
      return currentLocationPath || buildLocationPath();
    }

    function setLocationReady(url){
      var box = document.getElementById('conv-location');
      var status = document.getElementById('conv-location-status');
      var actions = document.getElementById('conv-location-actions');
      var openLink = document.getElementById('conv-location-open');
      box.style.display = 'block';
      status.className = 'conv-location-status is-ready';
      status.innerHTML = '<i class="ti ti-circle-check"></i> Link folder ketemu — file ada di sini.';
      actions.style.display = 'flex';
      openLink.href = url;
      if(driveOpenChip){ driveOpenChip.href = url; driveOpenChip.classList.add('show'); }
      if(driveHintEl) driveHintEl.textContent = '✓ Tersimpan · ' + resolveLocationPath();
    }

    function setLocationPending(){
      var box = document.getElementById('conv-location');
      var status = document.getElementById('conv-location-status');
      var actions = document.getElementById('conv-location-actions');
      box.style.display = 'block';
      document.getElementById('conv-location-path').textContent = resolveLocationPath();
      status.className = 'conv-location-status is-pending';
      status.innerHTML = '<i class="ti ti-loader-2"></i> Nyari link folder…';
      actions.style.display = 'none';
    }

    function setLocationUnknown(){
      var status = document.getElementById('conv-location-status');
      var actions = document.getElementById('conv-location-actions');
      status.className = 'conv-location-status is-unknown';
      status.innerHTML = '<i class="ti ti-alert-triangle"></i> Link otomatis belum ketemu — file kemungkinan sudah ada, cek langsung di folder Drive di atas.';
      actions.style.display = 'none';
      if(driveHintEl) driveHintEl.textContent = '✓ Tersimpan · ' + resolveLocationPath() + ' · link belum ketemu';
    }

    var activePollTimer = null;
    function pollForDriveLink(maxTries, intervalMs){
      var tries = 0;
      var recLink = document.getElementById('rec-link');
      if(activePollTimer) clearInterval(activePollTimer);
      activePollTimer = setInterval(function(){
        tries++;
        var val = recLink ? (recLink.value || '') : '';
        if(/^https?:\/\//.test(val)){
          clearInterval(activePollTimer); activePollTimer = null;
          setLocationReady(val);
        } else if(tries >= maxTries){
          clearInterval(activePollTimer); activePollTimer = null;
          setLocationUnknown();
        }
      }, intervalMs);
    }

    var copyBtn = document.getElementById('conv-location-copy');
    if(copyBtn) copyBtn.addEventListener('click', function(){
      var url = document.getElementById('conv-location-open').href;
      if(!url) return;
      var reset = function(){ copyBtn.classList.remove('copied'); copyBtn.innerHTML = '<i class="ti ti-copy"></i> Salin link'; };
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject())
        .then(function(){
          copyBtn.classList.add('copied');
          copyBtn.innerHTML = '<i class="ti ti-check"></i> Tersalin!';
          setTimeout(reset, 1600);
        })
        .catch(function(){ /* clipboard API gak tersedia — link tetap kelihatan & bisa diklik/disalin manual */ });
    });

    function showSuccess(){
      if(doneShown) return;
      doneShown = true;
      watching = false;
      if(driveTimeoutTimer){ clearTimeout(driveTimeoutTimer); driveTimeoutTimer = null; }
      var c = COPY[currentAction];
      if(c.step){ c.step.classList.remove('is-loading'); c.step.classList.add('is-done'); }

      document.getElementById('conv-success-title').textContent = c.successTitle;
      document.getElementById('conv-success-sub').textContent = c.successSub();
      document.getElementById('conv-success-file').style.display = 'none';

      var locBox = document.getElementById('conv-location');
      if(currentAction === 'drive'){
        var recLink = document.getElementById('rec-link');
        var val = recLink ? (recLink.value || '') : '';
        if(/^https?:\/\//.test(val)){
          document.getElementById('conv-location-path').textContent = resolveLocationPath();
          setLocationReady(val);
        } else {
          setLocationPending();
          pollForDriveLink(10, 400); // nyoba ~4 detik sebelum nyerah & bilang jujur
        }
      } else {
        locBox.style.display = 'none';
      }

      var nextBtn = document.getElementById('conv-success-next');
      if(c.nextTarget && !c.nextTarget.disabled){
        nextBtn.style.display = 'flex';
        nextBtn.innerHTML = c.nextLabel + ' <i class="ti ti-arrow-right"></i>';
        if(c.nextTarget === stepDrive){
          // Export -> Simpan ke Drive itu SATU overlay yang sama, cuma ganti
          // tahap. Sebelumnya modal ditutup dulu (closeModal) lalu nunggu
          // 150ms berharap konversian.js buka lagi buat mulai upload — kalau
          // itu telat/gak kejadian, user ngeliatnya modal "ilang abis Lanjut".
          // Sekarang kita pegang kendali penuh: pindah ke state loading di
          // overlay yang SAMA tanpa pernah nutup dulu, baru trigger klik asli
          // biar konversian.js jalanin upload beneran + isi progress-label.
          nextBtn.onclick = function(){
            resetToLoading('drive');
            ensureOpen();
            setTimeout(function(){ c.nextTarget.click(); }, 50);
          };
        } else {
          // Drive -> Record Konversi buka MODAL LAIN (#record-modal), jadi
          // overlay export-modal ini memang harus ditutup dulu.
          nextBtn.onclick = function(){ closeModal(); setTimeout(function(){ c.nextTarget.click(); }, 150); };
        }
      } else {
        nextBtn.style.display = 'none';
      }

      viewLoading.style.display = 'none';
      if(viewError) viewError.style.display = 'none';
      viewSuccess.style.display = 'flex';
      ensureOpen();
    }

    var closeBtn = document.getElementById('conv-success-close');
    if(closeBtn) closeBtn.addEventListener('click', closeModal);
    var errCloseBtn = document.getElementById('conv-error-close');
    if(errCloseBtn) errCloseBtn.addEventListener('click', function(){
      var c = COPY[currentAction];
      if(c && c.step) c.step.classList.remove('is-loading');
      closeModal();
    });

    // Esc cuma boleh nutup pas lagi nunjukin state sukses/error — di state
    // loading sengaja gak ada cara nutup (gak ada tombol Tutup juga di situ),
    // biar user gak ninggalin proses yang masih jalan ngerasa udah kelar.
    function __convFlowEscHandler(e){
      if(e.key !== 'Escape') return;
      var isOpen = overlay.style.display !== 'none' && (overlay.classList.contains('show') || overlay.classList.contains('open'));
      if(!isOpen) return;
      var onSuccess = viewSuccess.style.display !== 'none';
      var onError = viewError && viewError.style.display !== 'none';
      if(onSuccess || onError) closeModal();
    }
    document.addEventListener('keydown', __convFlowEscHandler);

    // Deteksi progres selesai lewat teks "N / N" di #progress-label
    var obs = new MutationObserver(function(){
      if(!watching) return;
      var m = (progressLabel.textContent||'').trim().match(/^(\d+)\s*\/\s*(\d+)$/);
      if(m && m[2] !== '0' && m[1] === m[2]){
        setTimeout(showSuccess, 350); // jeda dikit biar 100% kelihatan dulu
      }
    });
    obs.observe(progressLabel, {childList:true, characterData:true, subtree:true});

    // Jaring pengaman: modal ini CUMA boleh ilang lewat closeModal() kita
    // sendiri (tombol Tutup, Esc, atau "Lanjut" — semuanya set userClosing).
    // Kalau overlay ke-hide dari jalur lain (mis. konversian.js masih punya
    // rutinitas lama yang nutup modal begitu request kelar — baik SEBELUM
    // showSuccess sempat kepanggil, MAUPUN SESUDAH state sukses/error udah
    // ditampilkan), buka lagi. User yang mutusin kapan modal ini nutup, bukan
    // proses async yang kelar duluan.
    var overlayObs = new MutationObserver(function(){
      if(userClosing) return; // ini emang kita yang nutup, biarin
      var hidden = overlay.style.display === 'none' || (!overlay.classList.contains('show') && !overlay.classList.contains('open'));
      if(!hidden) return;
      if(doneShown){
        // Udah nunjukin sukses/error, tapi ke-tutup sendiri — buka lagi apa
        // adanya, jangan reset ke loading.
        ensureOpen();
        return;
      }
      if(watching){
        var m = (progressLabel.textContent||'').trim().match(/^(\d+)\s*\/\s*(\d+)$/);
        if(m && m[2] !== '0' && m[1] === m[2]) showSuccess();
      }
    });
    overlayObs.observe(overlay, {attributes:true, attributeFilter:['class','style']});

    // API publik buat konversian.js panggil langsung — INI JALUR UTAMA sekarang
    // buat step 'drive', karena gak ada sinyal DOM yang bisa dipercaya buat tau
    // kapan upload-nya kelar (lihat komentar di driveTimeoutTimer di atas).
    // opts.locationPath = path folder ASLI ("{tahun} / {namaSales}", sesuai
    // struktur folder yang beneran dipakai uploadKonversianToDrive), bukan
    // tebakan — pakai ini kalau ada, baru fallback ke buildLocationPath().
    window.convFlow = {
      showSuccess: function(action, opts){
        opts = opts || {};
        currentAction = action; watching = false; doneShown = false;
        if(opts.locationPath) currentLocationPath = opts.locationPath;
        if(opts.subtitle) COPY[action].successSub = function(){ return opts.subtitle; };
        showSuccess();
        if(opts.filename){
          document.getElementById('conv-success-filename').textContent = opts.filename;
          document.getElementById('conv-success-file').style.display = 'flex';
        }
        if(opts.driveUrl){
          if(activePollTimer){ clearInterval(activePollTimer); activePollTimer = null; } // udah tau linknya pasti, gak perlu nunggu poll rec-link lagi kelar (biar gak ke-overwrite jadi 'unknown' beberapa detik kemudian)
          document.getElementById('conv-location-path').textContent = resolveLocationPath();
          setLocationReady(opts.driveUrl);
        }
      },
      showError: function(action, message){
        currentAction = action; watching = false; doneShown = false;
        var c = COPY[action]; if(c && c.step) c.step.classList.remove('is-loading');
        var errSub = document.getElementById('conv-error-sub');
        if(errSub) errSub.textContent = message || 'Terjadi kendala saat memproses. Cek koneksi lalu ulangi.';
        viewLoading.style.display = 'none';
        viewSuccess.style.display = 'none';
        if(viewError) viewError.style.display = 'flex';
        ensureOpen();
      },
      // BUGFIX: sebelumnya stepper Export/Drive (centang is-done, teks "✓
      // Tersimpan · path", link "Buka di Drive") CUMA direset pas klik "Hapus
      // Semua" (lihat btnClearAll listener di atas) — gak pernah direset pas
      // Selesaikan Sesi / Mulai Sesi Baru / buka sesi lain / hapus sesi, jadi
      // begitu pindah ke sesi berikutnya, stepper masih nunjukin status
      // "Tersimpan" dari sesi SEBELUMNYA (lihat screenshot laporan bug).
      // reset() dipanggil dari konversian.js di titik reset terpusat yang
      // sudah ada (resetChecklistUI() — dipakai jua sama resetSsReferences()
      // & unsubscribeFromSesiRealtime()), bukan bikin titik reset baru lagi.
      reset: function(){
        currentAction = 'export';
        watching = false;
        doneShown = false;
        if(activePollTimer){ clearInterval(activePollTimer); activePollTimer = null; }
        if(driveTimeoutTimer){ clearTimeout(driveTimeoutTimer); driveTimeoutTimer = null; }
        currentLocationPath = null;
        [stepExport, stepDrive].forEach(function(el){ if(el) el.classList.remove('is-done','is-loading'); });
        var locBox = document.getElementById('conv-location');
        if(locBox) locBox.style.display = 'none';
        if(driveOpenChip){ driveOpenChip.classList.remove('show'); driveOpenChip.removeAttribute('href'); }
        if(driveHintEl) driveHintEl.textContent = 'Aktif setelah Export selesai';
        if(modalTitle) modalTitle.textContent = COPY.export.loadingTitle;
        closeModal(); // jaga-jaga kalau kepanggil pas modal masih kebuka
      },
      // Ditambahin buat SPA migration (bukan bagian asli) — dipanggil dari
      // unmount() di index.js biar observer/listener modul ini gak nyisa
      // nempel ke document/elemen yang udah kehapus pas ganti route.
      _cleanup: function(){
        document.removeEventListener('keydown', __convFlowEscHandler);
        obs.disconnect();
        overlayObs.disconnect();
        if(activePollTimer){ clearInterval(activePollTimer); activePollTimer = null; }
        if(driveTimeoutTimer){ clearTimeout(driveTimeoutTimer); driveTimeoutTimer = null; }
      }
    };
  });
})();


  // ── inline script #3 (theme toggle bind) — posisi asli di HTML ada
  // SEBELUM <script src="konversian.js">, jadi urutannya dipertahankan
  // di sini juga (gak bergantung ke apapun dari konversian.js, cuma bind
  // tombol #theme-toggle). ──

/* Theme toggle — standalone, works even if dashboard.js omits it.
   Single source of truth: <html data-theme>. Do NOT also write to
   <body> — pnm-universal.css only reacts to the attribute on <html>,
   and a second theme system used to live in konversian.js (bottom of
   file) that read/wrote <body> only; the two fought over the same
   #theme-toggle button and made the toggle look stuck. That duplicate
   block has been removed — this is now the only theme-toggle logic. */
(function(){
  function applyTheme(theme){
    theme = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem('theme', theme);
    localStorage.setItem('pnum-theme', theme);
    var icon = document.getElementById('theme-icon');
    if (icon) {
      icon.className = theme === 'dark' ? 'ti ti-sun' : 'ti ti-moon';
    }
  }
  function currentTheme(){
    return document.documentElement.getAttribute('data-theme')
      || localStorage.getItem('theme')
      || localStorage.getItem('pnum-theme')
      || 'light';
  }
  function bind(){
    var btn = document.getElementById('theme-toggle');
    if (!btn || btn.dataset.themeBound) return;
    btn.dataset.themeBound = '1';
    applyTheme(currentTheme());
    btn.addEventListener('click', function(e){
      e.preventDefault();
      applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();

  // ── konversian.js + sph-module.js (urutan asli: konversian.js dulu, baru
  // sph-module.js — sph-module.js baca fungsi/variabel dari konversian.js
  // lewat shared scope, lihat komentar di kepala sph-module.js sendiri). ──
// ═══ COORD LOG (baca dulu sebelum edit — file ini kepakai/kesentuh 2+ sesi Claude paralel) ═══
// 2026-09-25: AUDIT — badge jumlah sesi aktif (S.sesiBadge) diganti dari poll setInterval 30 detik ke channel Realtime (realtime.js: initSesiCountLive/handleSesiCountChange, channel 'konv-sesi-count', TIDAK difilter per sesi karena butuh total lintas tim) + resync REST tiap 5 menit sebagai fallback. Aman dari bug DELETE postgres_changes yang sudah didokumentasikan di file ini karena sesi 'berjalan' cuma pernah di-UPDATE (bukan di-DELETE) sampai statusnya 'selesai'. Bridge unmount() ikut berubah: heartbeatTimer -> sesiCountCleanup — Claude
// 2026-08-18: SECURITY — RLS produk/produk_harga/produk_set_item/akd/produk_akd/master_produk diketatin dari publik jadi allowed_users-only (harga_swasta sempat bisa dibaca siapa aja tanpa login). getProdukId/rpc()/getSetItems/enrichStok diganti dari ANON_KEY mentah ke sesiFetch(token sesi). Login gate sekarang juga checkWhitelist() ke allowed_users (dulu cuma cek kredensial valid, gak cek whitelist) — Claude
// 2026-08-13(7): 3 behavior fix fundamental (per diskusi manual): (a) isian tab Buat SPH nempel ke SPH terakhir — sph-module.js sekarang expose window.sphFlow.reset() dipanggil dari resetChecklistUI(); (b) nambah tombol "Keluar dari Sesi" (btn-leave-sesi) — beda dari Selesaikan Sesi, cuma bersihin tampilan lokal, GAK ngubah status server, sesi tetap 'berjalan'; (c) badge "Jadi Order"/"Ditutup Tanpa Order" di kartu riwayat dulu auto-derived dari ada-gaknya konversi_record (keliru — itu nunjukin "Record diklik", bukan "beneran jadi order"), sekarang dropdown manual hasil_order (kolom BARU sesi_konversi, perlu migration SQL manual dulu, lihat catatan terpisah), default null = "Menunggu Feedback Sales" — Claude
// 2026-08-13(6): fix "notif kolaborator (mode harga, dll) kadang muncul kadang enggak" — syncRealtimeAuth() dulu baca stokAccessToken (cache) langsung buat auth socket Realtime, dan cuma kepanggil pas event TOKEN_REFRESHED/(re)subscribe channel. Kalau tab di-background lama, timer refresh SDK bisa ke-throttle, socket kepasang token basi, dan RLS DIAM-DIAM nge-filter postgres_changes tanpa error apapun (beda dari REST yang minimal 401 kelihatan). Sekarang syncRealtimeAuth() ambil token fresh (getFreshToken()) + dipaksa kepanggil ulang pas tab balik visible (bukan cuma nunggu TOKEN_REFRESHED) — Claude
// 2026-08-13(5): fix "mode harga (Swasta/E-Katalog) gak ikut realtime" — modeSwastaOutput dulu variabel lokal per-tab doang, gak pernah ditulis/dibaca dari sesi_konversi, jadi kolaborator yang buka sesi yang sama selalu mulai dari default E-Katalog walau pembuat sesi udah set Swasta (bisa keluar harga salah di Record/Export/SPH tanpa tanda apapun). Sekarang persisted ke kolom BARU sesi_konversi.mode_harga_swasta (perlu migration SQL manual dulu sebelum dipush, lihat catatan terpisah) + disinkron lewat handleSesiRowChange() sama kayak pagu/butuh_bantuan — Claude
// 2026-08-13(4): fix duplikasi search-by-kode — matchOneKode() (Converter, ada retry timeout) dan addSetKodeToClip() (Cari SET Mendekati, TANPA retry) tadinya 2 salinan terpisah dari logika "exact match by kode via search_produk_dengan_harga", plus gak ada cache jadi kode duplikat dalam 1 batch paste = RPC berulang. Disatukan ke findProdukByKodeExact() + kodeExactCache (cache cuma hasil sukses, error tetap fresh-retry) — Claude
// 2026-08-13(3): fix "kekick ke login padahal masih kerja" — sesiFetch()/rpc-manual-berautentikasi/upload/openPrModal dulu baca variabel stokAccessToken langsung (bisa basi kalau tab sempat di-background), sekarang lewat getFreshToken() (panggil PNMAuth.getAccessToken() -> cek-dan-refresh di momen request, bukan nunggu timer) — Claude
// 2026-08-13(2): fix stepper Export/Simpan ke Drive di konversian.html nyangkut nunjukin status sesi SEBELUMNYA pas Selesaikan Sesi/Mulai Sesi Baru/buka sesi lain — window.convFlow.reset() (baru) sekarang dipanggil dari resetChecklistUI(), plus lastExportBlob dkk ikut dikosongin di titik yang sama — Claude
// 2026-08-13: fix bug "Sesi ini belum ada Permintaan RS (atau tanggalnya belum tercatat)" muncul palsu — startChecklistSession() gak pernah ngisi checklistTanggal pas Permintaan RS BARU disubmit (cuma loadChecklistForSesi yang ngisi, buat sesi yang DIBUKA ULANG). Sekarang startChecklistSession terima parameter tanggal & set checklistTanggal dari situ — Claude
// 2026-08-12: shared auth layer + navigasi konversian<->crud-produk + theme-fix (single <html data-theme>) + cache-busting — Claude (sesi arsitektur)
// Kalau kamu Claude/sesi lain yang mau edit file ini: tambahin baris baru di atas (jangan hapus riwayatnya), ringkas 1 baris apa yang berubah + tanggal.
// ═══════════════════════════════════════════════════════════════════════════
const SUPABASE_URL = 'https://ptkkbsemihcyndisjoor.supabase.co';
S.SUPABASE_URL = SUPABASE_URL;
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB0a2tic2VtaWhjeW5kaXNqb29yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0Njc4MzgsImV4cCI6MjA5ODA0MzgzOH0.QsCqmcqQcXvz1f8bLkagvMbAGUBbBP-3Wa5Aore5OMo';
S.ANON_KEY = ANON_KEY;

// ── AUTO-UPLOAD KE GOOGLE DRIVE (via Edge Function proxy, BUKAN langsung ke
// Apps Script dari client) ──
// SECURITY FIX 2026-08-14: DRIVE_UPLOAD_URL & DRIVE_UPLOAD_TOKEN dulu ada di
// sini sebagai string hardcoded — artinya siapapun yang buka devtools/view
// source bisa nyomot token itu dan manggil Apps Script langsung, bypass
// login aplikasi ini sepenuhnya. Sekarang browser cuma manggil Edge Function
// upload-drive-proxy (nempel SUPABASE_URL yg sudah ada di atas), yang baru
// verify user beneran login (JWT) lalu die-yang nempelin token rahasia ke
// Apps Script dari sisi server — token gak pernah nyampe ke client lagi.
// Rahasia yang lama (919c5bac...) SUDAH di-rotate di Code.gs, jadi walau
// masih ada di git history versi lama, sudah gak berguna lagi.
const DRIVE_PROXY_URL = `${SUPABASE_URL}/functions/v1/upload-drive-proxy`;
S.DRIVE_PROXY_URL = DRIVE_PROXY_URL;

// ══════════════════════════════════════════
// AUTH — MIGRATED TO THE SHARED GATE. This module used to own a full
// second copy of the app's login flow (own #auth-gate markup, own
// checkWhitelist() query, own onAuthStateChange handling for logout) —
// kept separate from router.js's shared/auth-gate.js because this was the
// largest/most delicate file in the app and there was no browser access to
// verify a change to its auth-critical path at the time (see
// map-history.md "sesi kesembilan belas"). Consolidated now, same pattern
// crud-produk/dashboard/stok/export-gambar already use: router.js never
// mount()s this module until the ONE shared gate confirms a session that
// is both authenticated AND allowed_users-whitelisted — so by the time
// this line runs, login (AND the whitelist check) is already done, once,
// for the whole app. "Most proper auth" here means exactly one place that
// owns that policy, not two copies of it that can silently drift apart —
// see the auth block a bit further down (was initAuth()/checkWhitelist()/
// showGate(), now just reads the session the shared gate already vetted).
// ══════════════════════════════════════════
S.stokAccessToken = null; // dipakai di seluruh app buat panggil RPC yang butuh role 'authenticated'
S.currentUser = null; // { id, email } dari Supabase Auth — basis identitas Presence/Realtime (BUKAN pic_marsup yang teks bebas)

// ══════════════════════════════════════════
// REALTIME CLIENT: cuma dipakai buat channel (postgres_changes/presence/broadcast).
// Query data TETAP lewat sesiFetch()/REST kayak biasa — SDK ini gak gantiin itu.
// `window.supabase` global dari CDN ketimpa nama var lokal manapun, makanya
// instance-nya dipegang di `rt` biar gak collide sama apa-apa yang udah ada.
// ══════════════════════════════════════════
const rt = (typeof window.supabase !== 'undefined' && window.supabase.createClient)
  ? window.supabase.createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      // POLA "THIRD-PARTY AUTH": kita login manual (fetch ke /auth/v1/token
      // langsung, bukan lewat rt.auth.signIn...), jadi rt.auth gak pernah punya
      // sesi. Realtime SDK ini manggil ULANG fungsi accessToken ini sendiri tiap
      // heartbeat/reconnect buat narik token TERBARU — beda sama rt.realtime.setAuth()
      // manual yang cuma nembak sekali terus ketiban balik ke ANON_KEY tiap heartbeat
      // jalan (itu penyebab kenapa role-nya selalu balik jadi 'anon'). Callback ini
      // baca stokAccessToken langsung dari closure, jadi otomatis dapet nilai
      // terbaru kapan pun dipanggil — gak perlu manual re-sync di titik lain lagi.
      accessToken: async () => S.stokAccessToken || ANON_KEY
    })
  : null;
S.rt = rt;
if (!rt) console.warn('Supabase Realtime SDK gagal dimuat — kolaborasi live gak aktif, app tetap jalan pakai REST biasa.');

// saveAuthSession/readAuthSession/clearAuthSession versi manual (localStorage
// langsung) SUDAH DIGANTIKAN oleh shared/auth-session.js (PNMAuth), yang
// baca-tulis via window.pnmSupabase.auth — tapi tetap ke localStorage key
// yang SAMA (pnm_auth_session, lihat shared/supabase-client.js), jadi sesi
// yang lagi aktif gak ke-invalidate pas file ini di-deploy.
// Realtime (postgres_changes yang difilter RLS + presence) butuh token user yang
// sama kayak dipakai sesiFetch() — kalau enggak, channel subscribe tapi gak pernah
// nerima row apapun (RLS nge-filter diem-diem). Dipanggil tiap kali token baru
// didapat/direfresh, sejalur sama titik-titik stokAccessToken diisi.
// FIX "notif kolaborator kadang muncul kadang enggak": dulu baca stokAccessToken
// (cache) langsung — sama kelasnya sama bug "kekick ke login" di getFreshToken()
// bawah, tapi di sini akibatnya lebih diam-diam: token basi bukan bikin error,
// cuma bikin RLS nge-filter update orang lain tanpa tanda apapun, jadi kerasanya
// "kadang jalan kadang enggak" tergantung sempat-gaknya tab di-background pas
// token mepet expired. Sekarang ambil token fresh tiap dipanggil.
async function syncRealtimeAuth() {
  if (!rt) return;
  const token = await getFreshToken();
  if (token) rt.realtime.setAuth(token);
}
S.syncRealtimeAuth = syncRealtimeAuth;

// FIX "kekick ke login padahal masih kerja": sesiFetch()/rpc-manual/upload di
// bawah dulu baca stokAccessToken (variabel cache) langsung, yang cuma
// keupdate lewat event TOKEN_REFRESHED punya SDK di background. Kalau tab ini
// sempat di-background (browser nge-throttle timer refresh SDK — kejadian
// wajar pas tab konversian dibiarin nganggur sambil kerja di Excel), token
// bisa expired duluan sebelum event itu sempat jalan, jadi request pertama
// abis balik ke tab kena 401 palsu walau sesi sebenarnya masih bisa direfresh.
// getFreshToken() manggil PNMAuth.getAccessToken() -> sb.auth.getSession(),
// yang ngecek-dan-refresh DI MOMEN ini juga (bukan nunggu timer) — sama
// persis kayak yang otomatis dilakuin sb.from()/sb.rpc() di crud-produk.js.
// Fallback ke stokAccessToken/ANON_KEY kalau PNMAuth somehow belum siap.
async function getFreshToken() {
  try {
    const t = await PNMAuth.getAccessToken();
    if (t) return t;
  } catch { /* lanjut ke fallback di bawah */ }
  return S.stokAccessToken || ANON_KEY;
}
S.getFreshToken = getFreshToken;
function showApp() {
  openSesiFromUrlIfAny();
  loadSalesOptions();
  restoreNavContext();
}

// Isi datalist "Nama Sales" dari tabel master `sales` (via RPC get_sales_aktif,
// security definer — bukan select langsung ke tabel, karena tabel sales pakai
// RLS dan query REST langsung lewat token user bisa kefilter kosong tanpa
// error kalau belum ada policy buat role 'authenticated'). Tujuannya nyegah
// varian ejaan/kapitalisasi baru (mis. "LEO" vs "Leo") terbentuk di
// konversi_record.pic_sales / sesi_konversi.nama_sales: user masih bisa ketik
// bebas, tapi begitu nama yang benar sudah terdaftar, browser akan
// menyarankan ejaan itu duluan lewat autocomplete <datalist>.
async function loadSalesOptions() {
  try {
    const { data, error } = await S.rpc('get_sales_aktif', {});
    if (error || !Array.isArray(data)) return; // gagal diam-diam, gak boleh blocking alur konversi
    const dl = document.getElementById('sales-datalist');
    if (!dl) return;
    dl.innerHTML = data.map(r => `<option value="${String(r.nama).replace(/"/g, '&quot;')}">`).join('');
  } catch {
    // koneksi gagal / token belum siap — biarkan, field tetap bisa dipakai manual
  }
}
// Kalau app dibuka lewat link yang dikirim dari tombol "Minta Bantuan" (format
// ?sesi=<id>), langsung pindah ke tab Konversi Berjalan dan buka sesinya —
// biar temen yang klik link gak perlu cari-cari manual dulu.
function openSesiFromUrlIfAny() {
  const params = new URLSearchParams(window.location.search);
  const sesiId = params.get('sesi');
  if (!sesiId) return;
  if (window.innerWidth <= 860 && typeof S.switchTab === 'function') S.switchTab('search');
  switchSubTab('sesi');
  openSesi(sesiId);
}
function buildSesiShareUrl(id) {
  return `${window.location.origin}${window.location.pathname}?sesi=${encodeURIComponent(id)}`;
}
function shareSesiToWhatsApp(id, namaRs) {
  const link = buildSesiShareUrl(id);
  const label = namaRs && namaRs.trim() ? namaRs.trim() : '(Nama RS belum diisi)';
  const text = `🙋 Butuh bantuan untuk sesi konversi "${label}":\n${link}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
}
S.shareSesiToWhatsApp = shareSesiToWhatsApp;
// Dipanggil clipboard.js/permintaan-rs.js kalau sesiFetch() balikin 401 di
// tengah kerja (token akhirnya expired, mis. tab lama nganggur). Dulu ini
// nampilin gate BAWAAN MODUL INI dengan pesan custom. Modul ini gak lagi
// punya gate sendiri — showGate() sekarang cuma toast pesannya lalu
// logout() lewat PNMAuth, yang otomatis: (1) nembak /auth/v1/logout buat
// revoke refresh token di server, (2) trigger onAuthStateChange(null) yang
// didengarkan shared/auth-gate.js (nampilin gate lagi) DAN router.js's
// onLoggedOut (unmount modul ini + bersihin container, jadi gak ada UI
// konversian basi ketinggalan di belakang gate) — pola identik 401
// handling di dashboard/index.js dan stok/index.js.
function showGate(msg) {
  S.stokAccessToken = null;
  S.currentUser = null;
  if (typeof S.unsubscribeFromSesiRealtime === 'function') S.unsubscribeFromSesiRealtime();
  if (msg && typeof S.showToast === 'function') S.showToast(msg, 'error');
  PNMAuth.logout();
}
S.showGate = showGate;

// checkWhitelist() (dulu di sini, lihat "SECURITY FIX 2026-08-18" di git
// history) SUDAH DIHAPUS — itu adalah query allowed_users KEDUA untuk
// modul ini doang, dari jaman sebelum ada gate bersama. shared/auth-gate.js
// (dipasang router.js, SEBELUM modul manapun di-mount()) sekarang sudah
// ngecek allowed_users itu untuk SETIAP modul, satu kali, sebelum routing
// bahkan dimulai — versi lokal di sini cuma nambah 1 round-trip network
// redundan tiap kali halaman ini dibuka, bukan lapisan keamanan tambahan
// (RLS server-side tetap satu-satunya pengaman beneran; ini murni UX).
// Satu kebijakan whitelist, satu tempat — bukan dua salinan yang bisa
// diam-diam beda kalau salah satu lupa diupdate.

// initAuth() disederhanakan: session yang dibalikin PNMAuth.getSession() di
// sini SUDAH PASTI ada dan SUDAH PASTI whitelisted — router.js gak akan
// pernah manggil mount() modul ini kalau belum (lihat router.js/
// shared/auth-gate.js). Jadi baris di bawah murni "ambil token/user dari
// sesi yang shared gate udah vetted", bukan verifikasi baru.
async function initAuth() {
  const session = await PNMAuth.getSession();
  S.stokAccessToken = session ? session.access_token : null;
  S.currentUser = session && session.user ? { id: session.user.id, email: session.user.email } : null;
  syncRealtimeAuth();
  showApp();
}

// PNMAuth.onAuthStateChange di sini sekarang cuma buat 1 kasus (dulu 2):
// token di-refresh otomatis oleh SDK di background -> stokAccessToken
// (dipakai seluruh sesiFetch()/rpc()/upload di file ini) otomatis
// ke-update juga, gak perlu nunggu initAuth() jalan ulang lagi. Kasus
// "sesi habis/di-signOut" TIDAK ditangani di sini lagi — itu sekarang
// jatah shared/auth-gate.js (nampilin gate) + router.js's onLoggedOut
// (manggil unmount() modul ini), sama persis kayak modul lain di app ini.
// Konversian gak perlu nge-gate dirinya sendiri lagi buat kasus itu.
const __konvAuthUnsub = PNMAuth.onAuthStateChange((event, session) => {
  if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
    if (session) S.stokAccessToken = session.access_token;
    syncRealtimeAuth();
  }
});
S.__konvAuthUnsub = __konvAuthUnsub;

// Login form (#gate-email/#gate-password/#gate-login-btn/#gate-status) DAN
// listener-listenernya DIHAPUS bareng markup-nya (markup.js) — login
// sekarang cuma lewat SATU form, milik shared/auth-gate.js, untuk seluruh
// app. #btn-logout (tombol "Keluar" di .konv-legacy-controls, disembunyikan
// lewat CSS — lihat markup.js) SENGAJA DIBIARKAN apa adanya: dia sudah
// manggil PNMAuth.logout() langsung, pintu yang SAMA dipakai tombol logout
// di sidebar global (app/pages/nav/) — jadi cuma dua tombol (satu di
// antaranya disembunyikan) yang manggil fungsi identik, bukan dua cara
// logout yang bisa berbeda perilaku.
const btnLogout = document.getElementById('btn-logout');
if (btnLogout) {
  btnLogout.addEventListener('click', async () => {
    btnLogout.disabled = true;
    try { await PNMAuth.logout(); }
    finally { btnLogout.disabled = false; }
  });
}

initAuth();
// SECURITY FIX (bucket 'thumbnails' jadi private): THUMB_BASE (URL public
// deterministik) DIHAPUS. Semua tempat yang dulu pakai THUMB_BASE + kode + '.png'
// sekarang lewat window.PNM_getSignedUrl()/window.PNM_getSignedUrls() (shared/
// supabase-client.js) -- lihat openGambarModal(), handleGambarFileDropped(),
// thumbKeyForItem()/resolveThumbUrls() di bawah, dan pemakainya di dictionary.js/
// search.js/clipboard.js (S.thumbKeyForItem/S.resolveThumbUrls, dulu S.THUMB_BASE).
//
// NOTE bucket 'lampiran-unit' (LAMPIRAN_BASE di bawah) SENGAJA BELUM disentuh --
// itu bucket TERPISAH dan masih public sama persis kayak 'thumbnails' dulu
// (URL deterministik by kode_produk.pdf, siapa aja bisa buka tanpa login kalau
// nebak/dapat linknya). Kalau itu juga mau diprivate-kan, perlu perlakuan sama
// (signed URL) di titik-titik LAMPIRAN_BASE di bawah -- belum termasuk di sesi ini.
const LAMPIRAN_BASE = 'https://ptkkbsemihcyndisjoor.supabase.co/storage/v1/object/public/lampiran-unit/';

// Regex resmi dari storage-api Supabase buat validasi object key (S3-safe chars).
// Nama file dari WA/HP sering nyelundupin karakter unicode "siluman" (nbsp,
// smart quotes, dash khusus, dll) yang kelihatan normal tapi bikin request
// upload ditolak dgn error "InvalidKey". Makanya path yg dikirim ke Storage
// WAJIB disanitasi dulu, jangan pakai file.name mentah-mentah.
function isValidStorageKey(key) {
  return /^(\w|\/|!|-|\.|\*|'|\(|\)| |&|\$|@|=|;|:|\+|,|\?)*$/.test(key);
}

// SECURITY FIX: this page uploads product thumbnails using the product's
// own kode_asli/kode_produk AS the storage key ('thumbnails' bucket, see
// handleGambarFileDropped() below), unlike lampiran uploads which go
// through sanitizeStorageFileName(). That key isn't free-typed here (it
// comes from an existing product row, set back in crud-produk -- which
// now validates this itself, see that page's thumbnailKeyError()) but
// this is a second, independent check at the point of upload: older
// product rows saved before that crud-produk fix could still carry an
// unsafe kode_asli, and this page has no visibility into whether that
// validation ran. Reserved key = TEMPLATE_THUMBNAIL_ROBUST, the shared
// template export-gambar builds every merge on top of -- overwriting it
// breaks that feature for every product, not just this one.
const RESERVED_THUMBNAIL_KEYS = new Set(['TEMPLATE_THUMBNAIL_ROBUST']);
function thumbnailKeyError(kode) {
  if (!kode) return 'Kode produk kosong.';
  if (!isValidStorageKey(kode) || /[\/\\]/.test(kode) || kode.includes('..')) {
    return 'Kode produk mengandung karakter yang tidak aman untuk nama file.';
  }
  if (RESERVED_THUMBNAIL_KEYS.has(kode.toUpperCase())) {
    return `"${kode}" adalah nama file reserved (dipakai fitur lain) -- tidak bisa dipakai sebagai kode gambar.`;
  }
  return null;
}

function sanitizeStorageFileName(name) {
  const dotIdx = name.lastIndexOf('.');
  const base = dotIdx > -1 ? name.slice(0, dotIdx) : name;
  const rawExt = dotIdx > -1 ? name.slice(dotIdx) : '';
  const cleanBase = base
    .normalize('NFKC')                              // normalisasi variasi unicode
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')    // hapus control char tak terlihat
    .replace(/[\u00A0\u200B-\u200D\uFEFF]/g, ' ')    // nbsp & zero-width -> spasi biasa
    .replace(/\s+/g, '_')                            // spasi (termasuk ganda) -> underscore
    .replace(/[^a-zA-Z0-9._-]/g, '')                 // buang sisa char di luar whitelist aman
    .replace(/_+/g, '_')                             // rapikan underscore berulang
    .replace(/^_+|_+$/g, '');                        // trim underscore di ujung
  // SECURITY FIX: dulu ekstensi (rawExt) dipakai mentah tanpa filter sama sekali —
  // kalau nama file kebetulan punya titik lain + karakter aneh/slash setelah titik
  // terakhir, itu lolos apa adanya ke storage key. Sekarang ekstensi juga disaring
  // whitelist yang sama, cuma dibolehin alnum (buat jaga-jaga kalau ada ekstensi
  // ganda semacam .tar.gz, walau di app ini praktiknya cuma .pdf/.png dst).
  const cleanExt = rawExt.toLowerCase().replace(/[^a-z0-9.]/g, '');
  let finalName = (cleanBase || 'file') + cleanExt;
  // SECURITY FIX: isValidStorageKey() sebelumnya didefinisikan tapi TIDAK PERNAH
  // dipanggil di manapun (dead code) — jadi validasi whitelist karakter S3-safe yang
  // dimaksud gak pernah benar-benar dieksekusi. Sekarang dipakai sebagai pengecekan
  // akhir; kalau karena suatu hal hasil sanitasi di atas masih lolos karakter yang
  // gak aman, fallback ke nama generik + timestamp biar upload tetap gak gagal diam-diam
  // tapi juga gak pernah kirim key yang gak divalidasi ke Storage.
  if (!isValidStorageKey(finalName)) {
    finalName = 'file_' + Date.now() + cleanExt;
  }
  return finalName;
}

// Batas ukuran file upload lampiran/gambar (client-side, defense-in-depth —
// idealnya bucket/Edge Function juga membatasi ini di sisi server).
const MAX_UPLOAD_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB
function formatFileSizeMb(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// SECURITY: cek magic bytes PDF (%PDF di awal file), bukan cuma percaya
// file.type/nama ekstensi yang gampang dispoof (rename file apa saja jadi .pdf).
async function looksLikePdf(file) {
  try {
    const head = await file.slice(0, 5).arrayBuffer();
    const bytes = new Uint8Array(head);
    const sig = String.fromCharCode(...bytes);
    return sig.startsWith('%PDF');
  } catch {
    return false;
  }
}

// upload file ke Supabase Storage bucket (dipakai fitur drag & drop brosur/gambar).
// x-upsert:true supaya kalau nama file sama, langsung ditimpa (gak perlu hapus manual dulu).
async function uploadToSupabaseStorage(bucket, path, fileOrBlob, contentType) {
  // PENTING: Authorization pakai token sesi user yg login (stokAccessToken), BUKAN ANON_KEY.
  // Kalau pakai ANON_KEY, Supabase Storage nganggep request datang dari role 'anon',
  // jadi kalau policy RLS bucket-nya butuh role 'authenticated', request selalu ditolak
  // dgn error "new row violates row-level security policy" walau bucket-nya sendiri udah bener.
  const uploadToken = await getFreshToken();
  if (!uploadToken || uploadToken === ANON_KEY) throw new Error('Sesi login sudah habis / belum login — silakan login ulang dulu.');
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${encodeURIComponent(path)}`, {
    method: 'POST',
    headers: {
      'apikey': ANON_KEY,
      'Authorization': 'Bearer ' + uploadToken,
      'Content-Type': contentType || fileOrBlob.type || 'application/octet-stream',
      'x-upsert': 'true'
    },
    body: fileOrBlob
  });
  if (!r.ok) throw new Error(await r.text());
  return true;
}

// bikin dropzone (klik utk browse + drag&drop) manggil callback dgn File yg dipilih/di-drop
function setupDropzone(zoneEl, inputEl, onFile) {
  if (!zoneEl || !inputEl) return;
  zoneEl.addEventListener('click', () => inputEl.click());
  inputEl.addEventListener('change', () => {
    if (inputEl.files && inputEl.files[0]) onFile(inputEl.files[0]);
    inputEl.value = '';
  });
  ['dragenter', 'dragover'].forEach(evt => zoneEl.addEventListener(evt, (e) => {
    e.preventDefault(); e.stopPropagation(); zoneEl.classList.add('dragover');
  }));
  ['dragleave', 'dragend'].forEach(evt => zoneEl.addEventListener(evt, (e) => {
    e.preventDefault(); e.stopPropagation(); zoneEl.classList.remove('dragover');
  }));
  zoneEl.addEventListener('drop', (e) => {
    e.preventDefault(); e.stopPropagation();
    zoneEl.classList.remove('dragover');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) onFile(f);
  });
}

// convert file gambar apapun (jpg/webp/screenshot dll) jadi PNG blob,
// biar konsisten sama konvensi penamaan thumbnail (kode_produk.png)
function imageFileToPngBlob(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Gagal memproses gambar')), 'image/png');
      };
      img.onerror = () => reject(new Error('File gambar tidak valid'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Gagal membaca file'));
    reader.readAsDataURL(file);
  });
}

// pdfjsLib.GlobalWorkerOptions.workerSrc dipindah ke dalam ensurePdfJs()
// (lihat di atas, dekat ensureVendorScripts) -- baris ini dulu jalan
// TELANJANG di sini, diam-diam bergantung ke pdfjsLib yang cuma ada kalau
// ensureVendorScripts() kebetulan udah nge-load-in duluan. Sekarang pdf.js
// baru didownload lazy pas fitur Lampiran PDF beneran dipakai (lihat
// getPdfPagesBase64/renderPdfFromUrl di bawah), jadi baris ini gak lagi
// boleh diam-diam ngarep pdfjsLib udah ada di titik ini.

const lampiranModal = document.getElementById('lampiran-modal');
const lampiranTitle = document.getElementById('lampiran-title');
const lampiranStatus = document.getElementById('lampiran-status');
const lampiranPages = document.getElementById('lampiran-pages');
const lampiranPicker = document.getElementById('lampiran-picker');
const lampiranSearchInput = document.getElementById('lampiran-search-input');
const lampiranSuggestList = document.getElementById('lampiran-suggest-list');
const lampiranSaveRow = document.getElementById('lampiran-save-row');
const lampiranSaveBtn = document.getElementById('lampiran-save-btn');
const lampiranGantiBtn = document.getElementById('lampiran-ganti-btn');
const lampiranDropzone = document.getElementById('lampiran-dropzone');
const lampiranFileInput = document.getElementById('lampiran-file-input');
const lampiranUploadStatus = document.getElementById('lampiran-upload-status');
const lampiranSetRincian = document.getElementById('lampiran-set-rincian');
const lampiranToggleBtn = document.getElementById('lampiran-toggle-btn');
document.getElementById('lampiran-close').addEventListener('click', () => lampiranModal.classList.remove('show'));
lampiranModal.addEventListener('click', (e) => { if (e.target === lampiranModal) lampiranModal.classList.remove('show'); });

// MODAL PREVIEW GAMBAR PRODUK (dipicu tombol mata di kartu hasil pencarian)
const gambarModal = document.getElementById('gambar-modal');
const gambarTitle = document.getElementById('gambar-title');
const gambarStatus = document.getElementById('gambar-status');
const gambarImg = document.getElementById('gambar-img');
const gambarGantiBtn = document.getElementById('gambar-ganti-btn');
const gambarDropzone = document.getElementById('gambar-dropzone');
const gambarFileInput = document.getElementById('gambar-file-input');
const gambarUploadStatus = document.getElementById('gambar-upload-status');
document.getElementById('gambar-close').addEventListener('click', () => gambarModal.classList.remove('show'));
gambarModal.addEventListener('click', (e) => { if (e.target === gambarModal) gambarModal.classList.remove('show'); });

// ══════════════════════════════════════════
// REFERENSI SCREENSHOT PERMINTAAN RS: dipicu tiap kali OCR (Tesseract) berhasil
// baca gambar di modal Catat Permintaan RS. Gambarnya DISIMPEN CUMA DI MEMORY TAB
// INI (object URL dari File asli) — sengaja gak diupload ke Supabase Storage,
// biar user masih bisa cek balik ke sumber kalau parsing OCR meleset (sering
// kejadian), tanpa nambah beban storage tiap konversi. Konsekuensinya: ilang
// begitu tab ditutup/direfresh — itu trade-off yang disengaja buat v1, bukan bug.
// Ditampilin di 2 tempat pake container beda (renderSsRefStrip loop keduanya):
// 1) pr-ss-ref-strip — di modal intake, biar kecek pas ngedit hasil parse.
// 2) kb-ss-ref-strip — di panel Kebutuhan RS, karena OCR yang meleset biasanya
//    baru ketauan pas proses matching, bukan pas upload.
// ══════════════════════════════════════════
let ssReferences = []; // [{id, url, filename}]
let ssRefLightboxIndex = 0;
const prSsRefStrip = document.getElementById('pr-ss-ref-strip');
const kbSsRefStrip = document.getElementById('kb-ss-ref-strip');
const ssRefModal = document.getElementById('ss-ref-modal');
const ssRefImg = document.getElementById('ss-ref-img');
const ssRefCounter = document.getElementById('ss-ref-counter');
const ssRefPrevBtn = document.getElementById('ss-ref-prev');
const ssRefNextBtn = document.getElementById('ss-ref-next');

function addSsReference(file) {
  const ref = { id: 'ss_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), url: URL.createObjectURL(file), filename: file.name };
  ssReferences.push(ref);
  renderSsRefStrip();
  return ref;
}
S.addSsReference = addSsReference;

// Dipanggil pas ganti/keluar konteks sesi (mulai sesi baru, sesi selesai, sesi
// dihapus, pindah buka sesi lain) — lihat resetChecklistUI(). Object URL WAJIB
// di-revoke di sini, kalau enggak nyangkut di memory browser sampai tab ditutup.
function resetSsReferences() {
  ssReferences.forEach(r => URL.revokeObjectURL(r.url));
  ssReferences = [];
  renderSsRefStrip();
}

function ssRefStripHtml() {
  const chips = ssReferences.map((r, idx) => `<button type="button" class="ss-ref-chip" data-idx="${idx}" title="Lihat screenshot ${idx + 1} dari ${ssReferences.length}" style="flex-shrink:0;padding:0;border:1.5px solid var(--border-strong);border-radius:8px;overflow:hidden;cursor:pointer;width:48px;height:48px;background:var(--surface-2)">
    <img src="${r.url}" alt="Screenshot ${idx + 1}" style="width:100%;height:100%;object-fit:cover;display:block;pointer-events:none"/>
  </button>`).join('');
  return `<div style="display:flex;align-items:center;gap:8px;padding:6px 2px 10px">
    <span style="font-size:11px;color:var(--text-muted);flex-shrink:0;white-space:nowrap"><i class="ti ti-photo"></i> Referensi:</span>
    <div style="display:flex;gap:6px;overflow-x:auto">${chips}</div>
  </div>`;
}

function renderSsRefStrip() {
  [prSsRefStrip, kbSsRefStrip].forEach(el => {
    if (!el) return;
    if (!ssReferences.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.innerHTML = ssRefStripHtml();
    el.style.display = 'block';
    el.querySelectorAll('.ss-ref-chip').forEach(btn => {
      btn.addEventListener('click', () => openSsRefLightbox(parseInt(btn.dataset.idx, 10)));
    });
  });
}

function openSsRefLightbox(idx) {
  if (!ssReferences.length) return;
  ssRefLightboxIndex = Math.max(0, Math.min(idx, ssReferences.length - 1));
  renderSsRefLightbox();
  ssRefModal.classList.add('show');
}

function renderSsRefLightbox() {
  const ref = ssReferences[ssRefLightboxIndex];
  if (!ref) return;
  ssRefImg.src = ref.url;
  ssRefCounter.textContent = ssReferences.length > 1 ? `Gambar ${ssRefLightboxIndex + 1} dari ${ssReferences.length}` : '';
  const multi = ssReferences.length > 1;
  ssRefPrevBtn.style.visibility = multi ? 'visible' : 'hidden';
  ssRefNextBtn.style.visibility = multi ? 'visible' : 'hidden';
}

document.getElementById('ss-ref-close').addEventListener('click', () => ssRefModal.classList.remove('show'));
ssRefModal.addEventListener('click', (e) => { if (e.target === ssRefModal) ssRefModal.classList.remove('show'); });
ssRefPrevBtn.addEventListener('click', () => { ssRefLightboxIndex = (ssRefLightboxIndex - 1 + ssReferences.length) % ssReferences.length; renderSsRefLightbox(); });
ssRefNextBtn.addEventListener('click', () => { ssRefLightboxIndex = (ssRefLightboxIndex + 1) % ssReferences.length; renderSsRefLightbox(); });

let gambarCurrentKodeForUrl = null;
// Token buat guard race condition: openGambarModal() sekarang async (nunggu
// signed URL) -- kalau user buka produk A lalu langsung buka produk B sebelum
// signed URL punya A kelar, respons telat punya A gak boleh nimpa modal B.
let gambarModalReqId = 0;

// SECURITY FIX: dulu sync (URL public deterministik langsung ditaruh di
// img.src, 404 ditangani img.onerror). Sekarang perlu minta signed URL dulu
// (async) -- kalau gagal DIBUAT (mis. file belum pernah diupload -> Supabase
// balikin error di createSignedUrl, bukan nunggu <img> gagal load), diperlakukan
// SAMA PERSIS kayak dulu 404: tampilin dropzone upload. img.onerror tetap
// dipasang juga sebagai jaring pengaman kedua (mis. signed URL kebentuk tapi
// fetch-nya sendiri gagal karena alasan lain).
async function openGambarModal(kode_asli, kode_produk, nama_produk) {
  const kodeForUrl = (kode_asli && kode_asli.trim()) ? kode_asli.trim() : kode_produk;
  gambarCurrentKodeForUrl = kodeForUrl;
  const myReq = ++gambarModalReqId;
  gambarTitle.textContent = nama_produk || 'Gambar Produk';
  gambarImg.style.display = 'none';
  gambarDropzone.style.display = 'none';
  gambarUploadStatus.style.display = 'none';
  gambarGantiBtn.style.display = 'none';
  gambarStatus.style.display = 'block';
  gambarStatus.style.color = 'var(--text-muted)';
  gambarStatus.textContent = 'Memuat gambar…';
  gambarModal.classList.add('show');

  gambarImg.onload = () => { gambarStatus.style.display = 'none'; gambarImg.style.display = 'block'; gambarDropzone.style.display = 'none'; gambarGantiBtn.style.display = 'inline-block'; };
  gambarImg.onerror = () => {
    if (myReq !== gambarModalReqId) return;
    gambarStatus.style.display = 'none';
    gambarGantiBtn.style.display = 'none';
    showGambarDropzone();
  };

  let url;
  try {
    url = await window.PNM_getSignedUrl('thumbnails', kodeForUrl + '.png');
  } catch (e) {
    if (myReq !== gambarModalReqId) return; // user udah buka produk lain / tutup modal selama nunggu
    gambarStatus.style.display = 'none';
    gambarGantiBtn.style.display = 'none';
    showGambarDropzone();
    return;
  }
  if (myReq !== gambarModalReqId) return;
  gambarImg.src = url;
}
S.openGambarModal = openGambarModal;

function showGambarDropzone() {
  gambarImg.style.display = 'none';
  gambarStatus.style.display = 'none';
  gambarUploadStatus.style.display = 'none';
  gambarDropzone.style.display = 'flex';
}
gambarGantiBtn.addEventListener('click', showGambarDropzone);

setupDropzone(gambarDropzone, gambarFileInput, handleGambarFileDropped);

// PASTE GAMBAR (Ctrl+V) — alternatif ke drag&drop/klik-pilih-file di atas, gak
// gantiin, cuma nambahin jalur ketiga. Aktif selama modal gambar produk lagi
// kebuka, baik posisi masih nunjukin dropzone kosong MAUPUN udah ada gambar
// lama ketampil (user gak perlu klik "Ganti Gambar" dulu — paste langsung
// jalan, sama kayak reflex umum "copy gambar dari WA/browser lalu Ctrl+V").
// Listener dipasang di document (bukan di gambarDropzone) karena elemen
// dropzone-nya sendiri kadang disembunyikan (display:none) pas gambar lama
// lagi ketampil, dan elemen yang disembunyikan gak bisa nerima focus/paste.
document.addEventListener('paste', (e) => {
  if (!gambarModal.classList.contains('show')) return;
  const items = e.clipboardData && e.clipboardData.items;
  if (!items || !items.length) return;
  let imageItem = null;
  for (const item of items) {
    if (item.kind === 'file' && item.type && item.type.startsWith('image/')) { imageItem = item; break; }
  }
  // bukan gambar di clipboard (mis. user paste teks) — biarin lewat begitu
  // aja, jangan preventDefault supaya paste teks normal (kalau ada input
  // lain di modal) tetap jalan seperti biasa.
  if (!imageItem) return;
  e.preventDefault();
  const pastedFile = imageItem.getAsFile();
  if (!pastedFile) return;
  if (!gambarCurrentKodeForUrl) return;
  // Clipboard paste gak punya nama file asli (browser kasih nama generik
  // kayak "image.png") — di-rename dulu jadi kode_barang.<ext> (sama kayak
  // nama akhir file gambar produk ini di Storage) SEBELUM dilempar ke
  // handleGambarFileDropped, biar teks status upload ("Mengunggah ...")
  // nampilin kode barangnya, bukan "image.png" yang gak informatif.
  const ext = (pastedFile.type && pastedFile.type.split('/')[1]) || 'png';
  const namedFile = new File([pastedFile], `${gambarCurrentKodeForUrl}.${ext}`, { type: pastedFile.type });
  handleGambarFileDropped(namedFile);
});

async function handleGambarFileDropped(file) {
  if (!gambarCurrentKodeForUrl) return;
  const keyError = thumbnailKeyError(gambarCurrentKodeForUrl);
  if (keyError) {
    S.showToast(keyError, 'error');
    return;
  }
  if (!file.type.startsWith('image/')) {
    S.showToast('File harus berupa gambar (foto/screenshot).', 'error');
    return;
  }
  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    S.showToast(`File terlalu besar (${formatFileSizeMb(file.size)}). Maksimal ${formatFileSizeMb(MAX_UPLOAD_SIZE_BYTES)}.`, 'error');
    return;
  }
  // Catatan: validasi isi file "beneran gambar" sudah otomatis terjadi di
  // imageFileToPngBlob() di bawah — file didekode lewat <img>/<canvas> dan
  // di-re-encode jadi PNG asli, jadi file non-gambar yang cuma diganti nama
  // ekstensinya akan gagal di sini (img.onerror) dan ditolak.
  const finalFilename = gambarCurrentKodeForUrl + '.png'; // nama final di Storage, dipakai di pesan sukses/gagal biar user yakin ini nyimpen ke barang yang bener
  gambarDropzone.style.display = 'none';
  // Kalau lagi paste/drop nimpa gambar yang UDAH ketampil (bukan dari dropzone
  // kosong), gambarImg gak ke-hide sampe gambar baru selesai di-load ulang di
  // bawah — dari sisi user keliatannya gambar lama diam aja "gak ngapa-ngapain"
  // selama proses upload. Redupin sementara biar ada sinyal visual "lagi
  // proses", dikembaliin lagi pas selesai (baik sukses maupun gagal).
  const wasShowingOldImg = gambarImg.style.display === 'block';
  if (wasShowingOldImg) gambarImg.style.opacity = '0.4';
  gambarUploadStatus.style.display = 'block';
  gambarUploadStatus.textContent = `Mengunggah "${file.name}"…`;
  try {
    const pngBlob = await imageFileToPngBlob(file);
    await uploadToSupabaseStorage('thumbnails', finalFilename, pngBlob, 'image/png');
    gambarUploadStatus.textContent = 'Berhasil diunggah ✓';
    gambarStatus.style.display = 'block';
    gambarStatus.style.color = 'var(--text-muted)';
    gambarStatus.textContent = 'Memuat gambar…';
    gambarImg.onload = () => { gambarStatus.style.display = 'none'; gambarUploadStatus.style.display = 'none'; gambarImg.style.opacity = '1'; gambarImg.style.display = 'block'; gambarGantiBtn.style.display = 'inline-block'; };
    gambarImg.onerror = () => { gambarImg.style.opacity = '1'; gambarUploadStatus.textContent = 'Gambar sudah diunggah, tapi gagal dimuat ulang — coba buka lagi.'; };
    // SECURITY FIX: bucket privat -- signed URL, bukan URL public + cache-busting
    // '?t='. File baru diupload barusan (upsert:true), jadi createSignedUrl-nya
    // pasti nemu objectnya -- cache-busting lama gak relevan lagi (signed URL-nya
    // sendiri sudah unik/fresh tiap kali diminta).
    try {
      gambarImg.src = await window.PNM_getSignedUrl('thumbnails', gambarCurrentKodeForUrl + '.png');
    } catch (e) {
      gambarImg.style.opacity = '1';
      gambarUploadStatus.textContent = 'Gambar tersimpan, tapi gagal membuat URL preview: ' + (e.message || e);
    }
    // Toast eksplisit di luar modal (gak cuma teks kecil di dalam modal) —
    // supaya user yang matanya udah pindah dari modal (mis. abis paste
    // langsung mau lanjut kerjaan lain) tetap kelihatan konfirmasi tegas
    // "kesimpen, dan ini nama filenya" — bukan cuma nebak-nebak dari
    // gambar yang (kalau lagi nimpa gambar lama) gak keliatan berubah.
    S.showToast(`Gambar produk tersimpan sebagai "${finalFilename}" ✓`, 'success');
  } catch (e) {
    gambarImg.style.opacity = '1';
    const errMsg = 'Gagal mengunggah "' + finalFilename + '": ' + (e.message || e);
    gambarUploadStatus.textContent = errMsg;
    S.showToast(errMsg, 'error');
    gambarDropzone.style.display = 'flex';
  }
}

let lampiranBucketFiles = null; // cache daftar file di bucket
let lampiranCurrentProdukId = null;
let lampiranCurrentKode = null;
let lampiranCurrentFilename = null;

async function getProdukId(kode_produk) {
  const r = await S.sesiFetch(`produk?kode_produk=eq.${encodeURIComponent(kode_produk)}&select=id&limit=1`);
  const data = await r.json();
  return (data && data.length) ? data[0].id : null;
}

async function getSavedBrosurUrl(produk_id) {
  // Dulu sengaja pakai ANON_KEY karena policy anon_select brosur mengizinkan itu.
  // Sekarang policy-nya sudah disempitkan ke `authenticated` saja, jadi wajib
  // pakai token sesi user yang login, konsisten sama fungsi lain di file ini.
  const token = await getFreshToken();
  if (!token) return null; // belum/nggak login — anggap saja belum ada brosur tersimpan
  const r = await fetch(`${SUPABASE_URL}/rest/v1/produk_media?produk_id=eq.${produk_id}&jenis=eq.brosur&select=url&limit=1`, {
    headers: {'apikey':ANON_KEY,'Authorization':'Bearer '+token}
  });
  const data = await r.json();
  return (data && data.length) ? data[0].url : null;
}

async function listLampiranBucket() {
  if (lampiranBucketFiles) return lampiranBucketFiles;
  // SECURITY FIX: dulu pakai ANON_KEY buat list SELURUH isi bucket — karena
  // ANON_KEY public (ada di bundle JS), ini artinya siapapun tanpa login bisa
  // enumerasi semua nama file lampiran tanpa buka aplikasi sama sekali. Bucket ini
  // memang punya URL publik utk file individual (by design), tapi listing massal
  // gak perlu ikut dibuka ke non-user — sekarang pakai token sesi user yang login.
  const listToken = await getFreshToken();
  // SECURITY FIX (round 2): fallback `|| ANON_KEY` di sini sebenarnya membatalkan
  // fix di comment lama di atas — kalau getFreshToken() balikin null (sesi habis),
  // request tetep jalan pakai anon key, jadi listing bucket bisa diakses ulang tanpa
  // login. Sekarang wajib ada token sesi; kalau nggak ada, gagal terang-terangan.
  if (!listToken) throw new Error('Sesi login sudah habis / belum login — silakan login ulang dulu.');
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/list/lampiran-unit`, {
    method: 'POST',
    headers: {'apikey':ANON_KEY,'Authorization':'Bearer '+listToken,'Content-Type':'application/json'},
    body: JSON.stringify({prefix:'', limit:1000, offset:0, sortBy:{column:'name',order:'asc'}})
  });
  const data = await r.json();
  lampiranBucketFiles = (Array.isArray(data) ? data : []).map(f => f.name).filter(n => n && n.toLowerCase().endsWith('.pdf'));
  return lampiranBucketFiles;
}

function renderSuggestList(filterText) {
  const q = (filterText||'').toLowerCase().trim();
  const files = lampiranBucketFiles || [];
  const matches = q ? files.filter(f => f.toLowerCase().includes(q)) : files;
  if (!matches.length) {
    lampiranSuggestList.innerHTML = `<div style="padding:10px;font-size:12px;color:var(--text-muted)">Tidak ada file yang cocok.</div>`;
    lampiranSuggestList.style.display = 'block';
    return;
  }
  lampiranSuggestList.innerHTML = matches.slice(0, 50).map(f =>
    `<div class="lampiran-suggest-item" data-file="${f.replace(/"/g,'&quot;')}" style="padding:8px 10px;font-size:13px;cursor:pointer;border-bottom:1px solid var(--border)">${f}</div>`
  ).join('');
  lampiranSuggestList.style.display = 'block';
  lampiranSuggestList.querySelectorAll('.lampiran-suggest-item').forEach(el => {
    el.addEventListener('mouseenter', () => el.style.background = 'var(--surface-2)');
    el.addEventListener('mouseleave', () => el.style.background = '');
    el.addEventListener('click', () => selectLampiranFile(el.dataset.file));
  });
}

async function selectLampiranFile(filename) {
  lampiranCurrentFilename = filename;
  lampiranSearchInput.value = filename;
  lampiranSuggestList.style.display = 'none';
  const url = LAMPIRAN_BASE + encodeURIComponent(filename);
  try {
    await renderPdfFromUrl(url);
    lampiranSaveRow.style.display = 'flex';
    lampiranGantiBtn.style.display = 'inline-block';
  } catch (e) {
    lampiranStatus.style.display = 'block';
    lampiranStatus.textContent = 'Gagal buka file itu: ' + (e.message||e);
  }
}

lampiranSearchInput.addEventListener('input', () => renderSuggestList(lampiranSearchInput.value));
lampiranSearchInput.addEventListener('focus', () => renderSuggestList(lampiranSearchInput.value));

async function renderPdfFromUrl(pdfUrl) {
  lampiranPages.innerHTML = '';
  lampiranStatus.style.display = 'block';
  lampiranStatus.textContent = 'Memuat PDF…';
  await ensurePdfJs(); // lazy: pdf.js baru didownload di sini, pas fitur ini beneran dipakai
  const pdf = await pdfjsLib.getDocument(pdfUrl).promise;
  lampiranStatus.textContent = `Merender ${pdf.numPages} halaman…`;
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    const img = document.createElement('img');
    img.src = canvas.toDataURL('image/jpeg', 0.85);
    img.style.cssText = 'width:100%;border:1px solid var(--border);border-radius:8px;display:block';
    lampiranPages.appendChild(img);
    lampiranStatus.textContent = `Merender halaman ${p} / ${pdf.numPages}…`;
  }
  lampiranStatus.style.display = 'none';
}

// versi headless (tanpa render ke DOM) buat dipakai di export Excel
async function getPdfPagesBase64(pdfUrl, scale = 1.5) {
  await ensurePdfJs(); // lazy: sama seperti renderPdfFromUrl() di atas
  const pdf = await pdfjsLib.getDocument(pdfUrl).promise;
  const pages = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    pages.push({
      base64: canvas.toDataURL('image/jpeg', 0.85).split(',')[1],
      width: viewport.width,
      height: viewport.height
    });
  }
  return pages;
}

// ambil halaman lampiran (PDF) suatu kode produk, pakai prioritas yg sama dgn modal: saved url -> auto match -> kosong
async function getLampiranPagesForKode(kode_produk) {
  function filenameFromUrl(url) {
    try {
      const last = url.split('/').pop().split('?')[0];
      return decodeURIComponent(last).replace(/\.pdf$/i, '');
    } catch (e) { return kode_produk; }
  }
  try {
    const produk_id = await getProdukId(kode_produk);
    if (produk_id) {
      const savedUrl = await getSavedBrosurUrl(produk_id);
      if (savedUrl) {
        try {
          const pages = await getPdfPagesBase64(savedUrl);
          return { filename: filenameFromUrl(savedUrl), pages };
        } catch (e) { /* lanjut coba auto */ }
      }
    }
  } catch (e) {}
  const autoUrl = LAMPIRAN_BASE + encodeURIComponent(kode_produk) + '.pdf';
  try {
    const pages = await getPdfPagesBase64(autoUrl);
    return { filename: filenameFromUrl(autoUrl), pages };
  } catch (e) {
    return { filename: kode_produk, pages: [] };
  }
}
S.getLampiranPagesForKode = getLampiranPagesForKode;

let lampiranCurrentIsSet = false; // dipakai toggle-btn buat tau mode "kembali" yang bener

async function openLampiranModal(kode_produk, isSet) {
  lampiranTitle.textContent = 'Lampiran — ' + kode_produk;
  lampiranPages.innerHTML = '';
  lampiranSetRincian.innerHTML = '';
  lampiranSetRincian.style.display = 'none';
  lampiranPicker.style.display = 'none';
  lampiranSuggestList.style.display = 'none';
  lampiranSearchInput.value = '';
  lampiranSaveRow.style.display = 'none';
  lampiranGantiBtn.style.display = 'none';
  lampiranToggleBtn.style.display = 'none';
  lampiranUploadStatus.style.display = 'none';
  lampiranDropzone.classList.remove('dragover');
  lampiranSaveBtn.disabled = false;
  lampiranSaveBtn.textContent = 'Simpan';
  lampiranStatus.style.display = 'block';
  lampiranStatus.textContent = 'Memuat lampiran…';
  lampiranModal.classList.add('show');
  lampiranCurrentKode = kode_produk;
  lampiranCurrentFilename = null;
  lampiranCurrentIsSet = !!isSet;

  const produk_id = await getProdukId(kode_produk);
  lampiranCurrentProdukId = produk_id;

  if (lampiranCurrentIsSet) {
    // Default buat SET: rincian isi set + gambar — "lampiran" SET pada
    // dasarnya emang dari isi komponennya (persis sheet per-set di export
    // Excel), bukan brosur terpisah yang perlu dicari/diupload. Pintu upload
    // PDF manual TETAP dibuka lewat toggle-btn, buat kasus SET yang beneran
    // punya brosur paket dari vendor.
    await renderSetRincianInLampiranModal(kode_produk);
    lampiranToggleBtn.textContent = 'Upload Lampiran PDF';
    lampiranToggleBtn.style.display = 'inline-block';
    lampiranToggleBtn.onclick = () => runPdfLookupFlow(kode_produk);
    return;
  }

  await runPdfLookupFlow(kode_produk);
}
S.openLampiranModal = openLampiranModal;

// Rincian isi set + gambar, ditampilkan sebagai tabel di modal Lampiran —
// data & foto diambil dari sumber yang SAMA dengan sheet per-set di export
// Excel (get_set_items via getSetItems + fetchImageBase64/removeBackground),
// jadi apa yang keliatan di sini bakal konsisten sama isi file export nanti.
async function renderSetRincianInLampiranModal(kode_produk) {
  lampiranPages.innerHTML = '';
  lampiranPicker.style.display = 'none';
  lampiranSaveRow.style.display = 'none';
  lampiranGantiBtn.style.display = 'none';
  lampiranSetRincian.style.display = 'none';
  lampiranStatus.style.display = 'block';
  lampiranStatus.textContent = 'Memuat rincian set…';

  let items;
  try {
    items = await S.getSetItems(kode_produk);
  } catch (e) {
    lampiranStatus.textContent = 'Gagal memuat rincian set: ' + (e.message || e);
    return;
  }
  if (!items.length) {
    lampiranStatus.textContent = 'Rincian isi set tidak ditemukan buat produk ini.';
    return;
  }
  // Jumlah item set ikut tampil di judul modal, dan masuk cache yang dipakai label tombol
  // "Lihat Lampiran · N item" (satu sumber angka, gak mungkin beda antara tombol & isi modal).
  S.setItemCountCache.set(kode_produk, items.length);
  lampiranTitle.textContent = `Lampiran — ${kode_produk} · ${items.length} item`;

  // Gambar tiap komponen diambil PARALEL (bukan satu-satu) — sama pola kayak
  // worker pool di export Excel, biar gak lelet kalau isi setnya banyak.
  const imgs = new Array(items.length);
  await Promise.all(items.map(async (it, i) => {
    const raw = await S.fetchImageBase64(it.kode_asli, it.kode_produk);
    imgs[i] = raw ? await S.removeBackground(raw) : null;
  }));

  lampiranStatus.style.display = 'none';
  const esc = (s) => String(s ?? '').replace(/</g, '&lt;');
  const rows = items.map((it, i) => `
    <tr style="border-bottom:1px solid var(--border)">
      <td style="padding:8px;text-align:center;color:var(--text-muted);font-size:12px">${it.urutan || i + 1}</td>
      <td style="padding:8px;font-family:monospace;font-size:12px;white-space:nowrap">${esc(it.kode_produk)}</td>
      <td style="padding:8px;font-size:13px">${esc(it.nama_produk)}</td>
      <td style="padding:8px;text-align:center;font-size:13px">${it.qty ?? 1}</td>
      <td style="padding:8px;text-align:center">${imgs[i]
        ? `<img src="data:image/png;base64,${imgs[i]}" style="width:56px;height:56px;object-fit:contain"/>`
        : '<span style="color:var(--text-muted);font-size:11px">—</span>'}</td>
    </tr>`).join('');

  lampiranSetRincian.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;flex-wrap:wrap">
      <div style="font-size:12px;color:var(--text-muted);flex:1 1 200px">Rincian isi set — sama seperti sheet per-set di export Excel.</div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <button id="lampiran-copy-sheet-btn" title="Copy kode, deskripsi, qty — teks doang, paling aman ke mana pun" style="border:1px solid var(--border-strong);background:var(--surface-2);color:var(--text-secondary);font-size:12px;font-weight:500;padding:5px 10px;border-radius:8px;cursor:pointer;white-space:nowrap;display:flex;align-items:center;gap:6px">
          <i class="ti ti-copy"></i><span>Copy Teks</span>
        </button>
        <button id="lampiran-copy-gambar-btn" title="Copy sebagai tabel HTML — gambarnya ikut kalau di-paste ke Excel / Word. Di Google Sheet, paste pakai Ctrl+Shift+V biar dapat rumus =IMAGE()" style="border:1px solid var(--accent-text);background:var(--accent-bg);color:var(--accent-text);font-size:12px;font-weight:600;padding:5px 10px;border-radius:8px;cursor:pointer;white-space:nowrap;display:flex;align-items:center;gap:6px">
          <i class="ti ti-photo"></i><span>Copy + Gambar</span>
        </button>
        <button id="lampiran-xlsx-btn" title="Download .xlsx — gambar beneran nempel di cell (paling pasti, tinggal copy range-nya ke file kamu)" style="border:1px solid var(--border-strong);background:var(--surface-2);color:var(--text-secondary);font-size:12px;font-weight:500;padding:5px 10px;border-radius:8px;cursor:pointer;white-space:nowrap;display:flex;align-items:center;gap:6px">
          <i class="ti ti-file-spreadsheet"></i><span>.xlsx</span>
        </button>
      </div>
    </div>
    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr style="background:var(--accent-bg);color:var(--accent-text)">
          <th style="padding:8px;text-align:center;width:36px;font-size:12px">No</th>
          <th style="padding:8px;text-align:left;font-size:12px">Kode</th>
          <th style="padding:8px;text-align:left;font-size:12px">Nama Produk</th>
          <th style="padding:8px;text-align:center;width:60px;font-size:12px">Qty</th>
          <th style="padding:8px;text-align:center;width:80px;font-size:12px">Gambar</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
  lampiranSetRincian.style.display = 'block';

  // Tombol copy: kode + deskripsi (nama_produk) + qty aja, format TSV (tab-separated)
  // biar pas di-paste ke Google Sheet langsung kepisah otomatis per kolom — gambar
  // sengaja gak diikutkan karena gambar gak bisa ditempel lewat clipboard teks biasa.
  const copyBtn = document.getElementById('lampiran-copy-sheet-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => copySetRincianToClipboard(items, copyBtn));
  }
  // Dua jalur tambahan buat bawa GAMBAR ikut kecopy — lihat komentar panjang
  // di atas copySetRincianWithImages() soal kenapa harus dua-duanya, bukan
  // cuma nambahin kolom gambar di TSV yang udah ada.
  const copyImgBtn = document.getElementById('lampiran-copy-gambar-btn');
  if (copyImgBtn) {
    copyImgBtn.addEventListener('click', () => copySetRincianWithImages(items, imgs, copyImgBtn));
  }
  const xlsxBtn = document.getElementById('lampiran-xlsx-btn');
  if (xlsxBtn) {
    xlsxBtn.addEventListener('click', () => downloadSetRincianXlsx(kode_produk, items, imgs, xlsxBtn));
  }
}

// Nama object (path) di bucket 'thumbnails' buat satu komponen set/produk.
// Sama aturannya kayak fetchImageBase64() di clipboard.js (pakai kode_asli
// kalau ada, fallback ke kode_produk). Ini path MENTAH buat storage API
// (bukan bagian URL yang perlu di-encode -- SDK Supabase yang urus encoding-
// nya sendiri pas createSignedUrl(s) dipanggil).
function thumbKeyForItem(it) {
  const kode = (it.kode_asli && String(it.kode_asli).trim()) ? String(it.kode_asli).trim() : it.kode_produk;
  return kode + '.png';
}
// SECURITY FIX (bucket 'thumbnails' privat): dulu ada thumbUrlForSetItem()
// yang sync nge-build URL public MENTAH ('.../object/public/thumbnails/KODE.png')
// buat langsung ditaruh ke <img src> / rumus =IMAGE() di clipboard export --
// Excel & Google Sheet yang nge-download gambarnya sendiri, makanya dulu gak
// butuh fetch apa pun di sisi app ini. Sekarang bucket privat, jadi Excel/Sheet
// (yang sama sekali gak punya sesi login app ini) CUMA bisa download gambar itu
// kalau URL-nya SUDAH berupa signed URL (token akses ada di URL-nya sendiri,
// bukan di header Authorization yang gak bisa dikirim <img>/=IMAGE()).
// resolveThumbUrls() di bawah minta signed URL buat SEMUA item sekaligus
// (satu request createSignedUrls, bukan N request createSignedUrl) SEBELUM
// baris-baris HTML/TSV dibangun -- lihat copySetRincianWithImages() & pemakai
// lain (search.js's Copy+Gambar) yang sekarang await ini duluan.
async function resolveThumbUrls(items) {
  return window.PNM_getSignedUrls('thumbnails', items.map(thumbKeyForItem));
}
S.thumbKeyForItem = thumbKeyForItem;
S.resolveThumbUrls = resolveThumbUrls;

// Tulis beberapa "rasa" (flavor) sekaligus ke clipboard: text/html DAN
// text/plain. Aplikasi tujuan yang milih mau pakai yang mana — Excel & Word
// ambil text/html (jadi gambar ikut), Notepad/paste-as-plain ambil text/plain.
// Fallback buat browser tanpa ClipboardItem (atau konteks non-HTTPS): bikin
// div contenteditable tak terlihat, isi HTML-nya, select, execCommand('copy')
// — cara lama ini juga kebawa sebagai rich text, bukan cuma teks polos.
async function writeRichClipboard(html, plain) {
  if (navigator.clipboard && window.ClipboardItem) {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' })
      })]);
      return true;
    } catch (e) { /* lanjut ke fallback di bawah */ }
  }
  const holder = document.createElement('div');
  holder.contentEditable = 'true';
  holder.innerHTML = html;
  holder.style.position = 'fixed';
  holder.style.left = '-9999px';
  holder.style.top = '0';
  holder.style.opacity = '0';
  document.body.appendChild(holder);
  const range = document.createRange();
  range.selectNodeContents(holder);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  sel.removeAllRanges();
  document.body.removeChild(holder);
  return ok;
}
S.writeRichClipboard = writeRichClipboard;

// COPY + GAMBAR.
// Kenapa gak cukup nambahin kolom gambar ke TSV yang udah ada: clipboard teks
// (text/plain) secara definisi cuma bisa bawa karakter — gambar gak punya
// representasi di situ. Jadi dipakai dua jalur sekaligus dalam SATU kali copy:
//
//   text/html  → tabel HTML lengkap sama <img src="https://…/object/sign/thumbnails/KODE.png?token=…">.
//                Excel (desktop) ngebaca flavor ini pas paste, nge-download
//                gambarnya, dan naruh sebagai picture di atas cell-nya. URL-nya
//                BUKAN data:base64 hasil removeBackground(), karena Excel gak
//                mau nge-render data-URI pas paste HTML — konsekuensinya
//                gambar di sini masih ada background aslinya.
//   text/plain → TSV yang kolom terakhirnya rumus =IMAGE("url"). Google Sheet
//                (dan Excel 365, yang udah punya fungsi IMAGE) bakal nge-render
//                rumus ini jadi gambar di DALAM cell. Di Google Sheet pastikan
//                paste-nya Ctrl+Shift+V (paste teks polos), soalnya kalau paste
//                biasa Sheet milih flavor HTML di atas dan <img>-nya dibuang.
// SECURITY FIX: bucket 'thumbnails' sekarang PRIVATE -- URL di atas BUKAN lagi
// URL public permanen, tapi signed URL (resolveThumbUrls(), lihat komentarnya)
// yang kadaluarsa (lihat SIGNED_URL_TTL_SECONDS di shared/supabase-client.js).
// Konsekuensi yang harus disadari tim: kalau sheet/file Excel hasil paste ini
// dibuka LAGI setelah token itu kadaluarsa DAN aplikasi tujuan coba fetch ulang
// gambarnya (Google Sheet's =IMAGE() bisa begitu), gambarnya bakal gagal muat.
// Ini trade-off yang DISENGAJA (itu tujuannya bucket di-private-kan) -- kalau
// kejadian di lapangan, solusi PALING PASTI adalah tombol .xlsx di bawah
// (downloadSetRincianXlsx), yang nge-embed gambar BENERAN ke file (bukan link),
// gak kena masalah token expired sama sekali.
async function copySetRincianWithImages(items, imgs, btnEl) {
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const clean = (s) => String(s ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ').trim();

  // SECURITY FIX: signed URL buat SEMUA item di set ini diminta SEKALIGUS
  // (satu request), sebelum baris HTML/TSV dibangun -- lihat komentar panjang
  // di resolveThumbUrls() di atas soal kenapa ini gak bisa lagi sync kayak dulu.
  let urlMap;
  try {
    urlMap = await resolveThumbUrls(items);
  } catch (e) {
    S.showToast('Gagal menyiapkan URL gambar: ' + (e.message || e), 'error');
    return;
  }

  const rowsHtml = items.map((it, i) => {
    const url = urlMap.get(thumbKeyForItem(it)) || '';
    const gambarCell = url
      ? `<img src="${esc(url)}" width="80" height="65" alt="${esc(it.kode_produk)}">`
      : ''; // kode ini belum ada gambarnya di bucket -- sel dibiarkan kosong (dulu: <img> 404/broken)
    return `<tr>` +
      `<td style="border:1px solid #000;text-align:center">${it.urutan || i + 1}</td>` +
      `<td style="border:1px solid #000">${esc(it.kode_produk)}</td>` +
      `<td style="border:1px solid #000">${esc(it.nama_produk)}</td>` +
      `<td style="border:1px solid #000;text-align:center">${it.qty ?? 1}</td>` +
      `<td style="border:1px solid #000;text-align:center">${gambarCell}</td>` +
      `</tr>`;
  }).join('');

  const html =
    `<table border="1" style="border-collapse:collapse">` +
    `<thead><tr>` +
    ['NO', 'KODE PNM', 'DESKRIPSI BARANG', 'QTY', 'GAMBAR']
      .map(h => `<th style="border:1px solid #000;background:#1D5BD4;color:#fff">${h}</th>`).join('') +
    `</tr></thead><tbody>${rowsHtml}</tbody></table>`;

  const plain = items.map((it) => {
    const url = urlMap.get(thumbKeyForItem(it)) || '';
    return [
      clean(it.kode_produk),
      clean(it.nama_produk),
      it.qty ?? 1,
      url ? `=IMAGE("${url}")` : ''
    ].join('\t');
  }).join('\n');

  const ok = await writeRichClipboard(html, plain);
  if (!ok) {
    S.showToast('Gagal copy ke clipboard — coba tombol .xlsx aja', 'error');
    return;
  }
  S.showToast(`Tersalin ${items.length} baris + gambar ✓ — paste biasa ke Excel; di Google Sheet pakai Ctrl+Shift+V`);
  if (btnEl) {
    const original = btnEl.innerHTML;
    btnEl.innerHTML = '<i class="ti ti-check"></i><span>Tersalin!</span>';
    setTimeout(() => { btnEl.innerHTML = original; }, 1800);
  }
}

// JALUR PALING PASTI: bikin file .xlsx kecil isi rincian set ini doang, dengan
// gambar BENERAN ke-embed di dalam file (bukan link, bukan rumus) — persis
// mekanisme yang dipakai sheet per-set di Export Excel (wb.addImage + ws.addImage).
// Dipakai kalau Excel-nya rewel sama paste HTML, atau kalau butuh gambar yang
// udah ke-removeBackground (base64 `imgs` di sini hasil proses itu, beda sama
// jalur copy di atas yang cuma bisa nunjuk URL mentah).
// Layout & border sengaja disamain sama sheet per-set biar user tinggal blok
// range-nya dan copy ke file konversian mereka tanpa ngerapiin ulang.
async function downloadSetRincianXlsx(kodeSet, items, imgs, btnEl) {
  const originalHtml = btnEl ? btnEl.innerHTML : null;
  if (btnEl) { btnEl.disabled = true; btnEl.innerHTML = '<i class="ti ti-loader-2"></i><span>Menyiapkan…</span>'; }
  try {
    // lazy: ExcelJS baru didownload di sini, pas tombol export ini beneran
    // dipencet -- dulu ada guard "kalau belum ke-load, suruh user refresh
    // halaman", padahal ExcelJS dulu emang udah pasti keload duluan pas
    // mount() (makanya lemot). Sekarang tinggal await di sini.
    await ensureExceljs();
    const GRID_BORDER = {
      top: { style: 'thin', color: { argb: 'FF000000' } },
      left: { style: 'thin', color: { argb: 'FF000000' } },
      bottom: { style: 'thin', color: { argb: 'FF000000' } },
      right: { style: 'thin', color: { argb: 'FF000000' } }
    };
    const wb = new ExcelJS.Workbook();
    wb.creator = 'PT Pionir Nusantara Manufacturing';
    wb.created = new Date();
    const ws = wb.addWorksheet(String(kodeSet).replace(/[\\/?*[\]:]/g, '').substring(0, 31) || 'RINCIAN SET');

    ws.getRow(1).getCell(1).value = `RINCIAN SET — ${kodeSet}`;
    ws.getRow(1).getCell(1).font = { bold: true, size: 13, color: { argb: 'FF1D5BD4' } };
    ws.getRow(1).getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF4FF' } };
    ws.mergeCells('A1:E1');
    ws.getRow(1).height = 30;

    const hdrRow = ws.getRow(2);
    ['NO', 'KODE PNM', 'DESKRIPSI BARANG', 'QTY', 'GAMBAR'].forEach((h, i) => {
      const cell = hdrRow.getCell(i + 1);
      cell.value = h;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D5BD4' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = GRID_BORDER;
    });
    hdrRow.height = 22;
    ws.columns = [{ width: 6 }, { width: 24 }, { width: 45 }, { width: 8 }, { width: 18 }];

    items.forEach((it, idx) => {
      const dataRow = 3 + idx;
      const row = ws.getRow(dataRow);
      row.height = 70;
      row.getCell(1).value = it.urutan || idx + 1;
      row.getCell(2).value = it.kode_produk;
      row.getCell(3).value = it.nama_produk;
      row.getCell(4).value = it.qty ?? 1;
      [1, 2, 3, 4, 5].forEach(c => {
        row.getCell(c).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        row.getCell(c).border = GRID_BORDER;
        if (idx % 2 === 0) row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F6F8' } };
      });
      if (imgs[idx]) {
        try {
          const imgId = wb.addImage({ base64: imgs[idx], extension: 'png' });
          ws.addImage(imgId, { tl: { col: 4.1, row: dataRow - 0.9 }, ext: { width: 80, height: 65 } });
        } catch (e) { /* satu gambar gagal jangan bikin seluruh file batal */ }
      }
    });

    const totalRow = ws.getRow(3 + items.length);
    totalRow.getCell(3).value = 'TOTAL';
    totalRow.getCell(3).font = { bold: true };
    totalRow.getCell(4).value = items.reduce((s, i) => s + (i.qty || 0), 0);
    totalRow.getCell(4).font = { bold: true };

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `RINCIAN-SET-${String(kodeSet).replace(/[^a-zA-Z0-9-]/g, '')}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    S.showToast('File rincian set siap — gambar sudah nempel di dalamnya ✓');
  } catch (e) {
    S.showToast('Gagal bikin file: ' + (e.message || e), 'error');
    console.error(e);
  } finally {
    if (btnEl) { btnEl.disabled = false; btnEl.innerHTML = originalHtml; }
  }
}

async function copySetRincianToClipboard(items, btnEl) {
  const clean = (s) => String(s ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ').trim();
  const tsv = items.map((it) => [clean(it.kode_produk), clean(it.nama_produk), it.qty ?? 1].join('\t')).join('\n');

  try {
    await navigator.clipboard.writeText(tsv);
  } catch (e) {
    // Fallback buat browser/context yang gak dukung Clipboard API (misal non-HTTPS)
    const ta = document.createElement('textarea');
    ta.value = tsv;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e2) {
      S.showToast('Gagal copy ke clipboard: ' + (e2.message || e2), 'error');
      document.body.removeChild(ta);
      return;
    }
    document.body.removeChild(ta);
  }

  S.showToast(`Tersalin ${items.length} baris (kode, deskripsi, qty) — siap paste ke Google Sheet ✓`);
  if (btnEl) {
    const original = btnEl.innerHTML;
    btnEl.innerHTML = '<i class="ti ti-check"></i><span>Tersalin!</span>';
    setTimeout(() => { btnEl.innerHTML = original; }, 1500);
  }
}

// Flow cari/render/upload PDF — sama persis kayak isi openLampiranModal yang
// lama, cuma dipisah jadi fungsi sendiri biar bisa dipanggil ULANG lewat
// toggle-btn dari mode Rincian Set (item SET) tanpa perlu buka ulang modal
// dari awal / fetch produk_id lagi.
async function runPdfLookupFlow(kode_produk) {
  lampiranPages.innerHTML = '';
  lampiranSetRincian.style.display = 'none';
  lampiranPicker.style.display = 'none';
  lampiranSuggestList.style.display = 'none';
  lampiranSaveRow.style.display = 'none';
  lampiranGantiBtn.style.display = 'none';
  lampiranStatus.style.display = 'block';
  lampiranStatus.textContent = 'Memuat lampiran…';

  if (lampiranCurrentIsSet) {
    lampiranToggleBtn.textContent = 'Lihat Rincian Set';
    lampiranToggleBtn.style.display = 'inline-block';
    lampiranToggleBtn.onclick = () => renderSetRincianInLampiranModalAndResetToggle(kode_produk);
  }

  // 1. Cek apakah sudah ada link tersimpan manual di produk_media
  if (lampiranCurrentProdukId) {
    const savedUrl = await getSavedBrosurUrl(lampiranCurrentProdukId);
    if (savedUrl) {
      try {
        await renderPdfFromUrl(savedUrl);
        lampiranGantiBtn.style.display = 'inline-block';
        return;
      }
      catch (e) { /* lanjut coba cara lain */ }
    }
  }

  // 2. Coba auto-match kode_produk.pdf
  const autoUrl = LAMPIRAN_BASE + encodeURIComponent(kode_produk) + '.pdf';
  try {
    await renderPdfFromUrl(autoUrl);
    lampiranGantiBtn.style.display = 'inline-block';
    return;
  } catch (e) {
    // 3. Gagal — tampilkan picker dengan daftar suggestion
    await showLampiranPicker();
  }
}

// Dipanggil dari toggle-btn pas lagi di mode PDF (item SET) buat balik ke
// tabel rincian — sekalian nyiapin toggle-btn lagi ke arah sebaliknya.
async function renderSetRincianInLampiranModalAndResetToggle(kode_produk) {
  await renderSetRincianInLampiranModal(kode_produk);
  lampiranToggleBtn.textContent = 'Upload Lampiran PDF';
  lampiranToggleBtn.style.display = 'inline-block';
  lampiranToggleBtn.onclick = () => runPdfLookupFlow(kode_produk);
}

async function showLampiranPicker() {
  lampiranPages.innerHTML = '';
  lampiranGantiBtn.style.display = 'none';
  lampiranUploadStatus.style.display = 'none';
  lampiranStatus.style.display = 'block';
  lampiranStatus.textContent = 'Pilih file lampiran PDF:';
  lampiranPicker.style.display = 'block';
  lampiranSearchInput.value = '';
  try {
    await listLampiranBucket();
    renderSuggestList('');
  } catch (e2) {
    lampiranStatus.textContent = 'Gagal mengambil daftar file dari bucket: ' + (e2.message||e2);
  }
}

lampiranGantiBtn.addEventListener('click', () => { showLampiranPicker(); });

setupDropzone(lampiranDropzone, lampiranFileInput, handleLampiranFileDropped);

// upload brosur baru (dari WA/HP/dll, belum ada di bucket) lalu langsung dipakai sbg lampiran
async function handleLampiranFileDropped(file) {
  // SECURITY FIX: dulu cuma cek file.type/nama ekstensi — nilai itu ditentukan
  // browser dari EKSTENSI NAMA FILE, bukan isi asli, jadi gampang dilewati (rename
  // file apapun jadi ".pdf"). Sekarang dicek juga magic bytes (%PDF di awal file)
  // sebelum diupload ke bucket publik dengan Content-Type dipaksa application/pdf.
  const extLooksLikePdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (!extLooksLikePdf) {
    S.showToast('File harus berupa PDF.', 'error');
    return;
  }
  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    S.showToast(`File terlalu besar (${formatFileSizeMb(file.size)}). Maksimal ${formatFileSizeMb(MAX_UPLOAD_SIZE_BYTES)}.`, 'error');
    return;
  }
  if (!(await looksLikePdf(file))) {
    S.showToast('File ini bukan PDF asli (isi file tidak cocok) — cek lagi atau ganti nama file yang benar.', 'error');
    return;
  }
  lampiranSuggestList.style.display = 'none';
  lampiranUploadStatus.style.display = 'block';
  lampiranUploadStatus.textContent = `Mengunggah "${file.name}"…`;

  // Nama asli dari WA/HP bisa ngandung karakter unicode "siluman" (nbsp, smart
  // quote, dash khusus, dll) yang bikin Supabase Storage nolak dgn "InvalidKey".
  // Jadi key yg dikirim ke Storage WAJIB versi yang sudah disanitasi;
  // nama asli (file.name) cuma dipakai buat teks status yg dilihat user.
  const safeName = sanitizeStorageFileName(file.name);

  try {
    await uploadToSupabaseStorage('lampiran-unit', safeName, file, 'application/pdf');
    lampiranBucketFiles = null; // reset cache biar file baru ikut muncul di daftar lain kali
    lampiranUploadStatus.textContent = safeName === file.name
      ? `Berhasil diunggah: ${file.name}`
      : `Berhasil diunggah sbg "${safeName}" (nama asli: ${file.name})`;
    await selectLampiranFile(safeName); // pakai safeName krn itu key sebenarnya di bucket
  } catch (e) {
    lampiranUploadStatus.textContent = 'Gagal mengunggah: ' + (e.message || e);
  }
}

lampiranSaveBtn.addEventListener('click', async () => {
  if (!lampiranCurrentProdukId || !lampiranCurrentFilename) return;
  lampiranSaveBtn.disabled = true;
  lampiranSaveBtn.textContent = 'Menyimpan…';
  try {
    // SECURITY FIX: dulu pakai ANON_KEY (public, ada di bundle JS) buat Authorization
    // di POST ini — artinya SIAPAPUN tanpa login bisa nembak endpoint ini langsung
    // (bypass auth-gate total) dan set produk_media.url bebas ke domain manapun kalau
    // RLS tabel ini kebetulan mengizinkan role anon nulis. Sekarang wajib pakai token
    // sesi user yang beneran login, sejalan sama uploadToSupabaseStorage() di atas.
    const writeToken = await getFreshToken();
    if (!writeToken || writeToken === ANON_KEY) throw new Error('Sesi login sudah habis / belum login — silakan login ulang dulu.');
    const url = LAMPIRAN_BASE + encodeURIComponent(lampiranCurrentFilename);
    const r = await fetch(`${SUPABASE_URL}/rest/v1/produk_media`, {
      method: 'POST',
      headers: {'apikey':ANON_KEY,'Authorization':'Bearer '+writeToken,'Content-Type':'application/json','Prefer':'return=minimal'},
      body: JSON.stringify({
        produk_id: lampiranCurrentProdukId,
        jenis: 'brosur',
        judul: lampiranCurrentFilename,
        url: url,
        is_primary: true,
        urutan: 1
      })
    });
    if (!r.ok) throw new Error(await r.text());
    lampiranSaveBtn.textContent = 'Tersimpan ✓';
  } catch (e) {
    lampiranSaveBtn.disabled = false;
    lampiranSaveBtn.textContent = 'Simpan';
    S.showToast('Gagal simpan lampiran: ' + (e.message||e), 'error');
  }
});

// STATE
S.clipboard = [];
S.acItems = [], S.acIndex = -1, S.onlyAkd = false, S.selectedTipe = null, S.acTimer = null;
S.lastResults = [];
S.modeSwasta = false; // toggle "Harga Swasta" di panel PENCARIAN — cuma preferensi quick lookup (harga & link_v6 yang ditampilin pas browsing hasil cari). JANGAN dipakai buat nentuin harga output (clipboard/record/export/SPH) — lihat modeSwastaOutput.
S.modeSwastaOutput = false; // mode harga yang BENERAN dipakai buat Clipboard total & Pagu, Record Konversi, Export ke Excel, dan Generate SPH. Sengaja dipisah dari modeSwasta di atas biar user gak kepaksa ngubah tampilan pencarian cuma buat ganti mode output — lihat toggle #com-ekat/#com-swasta di clip-output-mode-row.
S.sortMode = 'relevance';
let prioritizeLink = true; // produk yang ada link_v6 diprioritaskan (hanya berlaku saat mode e-katalog)
S.prioritizeLink = prioritizeLink;
const RESULTS_PER_PAGE = 20;
S.RESULTS_PER_PAGE = RESULTS_PER_PAGE;
S.currentPage = 1;

// ELEMENTS
const searchInput = document.getElementById('search-input');
S.searchInput = searchInput;
const clearBtn = document.getElementById('clear-btn');
S.clearBtn = clearBtn;
const acBox = document.getElementById('autocomplete');
S.acBox = acBox;
const resultsEl = document.getElementById('results');
S.resultsEl = resultsEl;
const paginationEl = document.getElementById('pagination');
S.paginationEl = paginationEl;
const metaEl = document.getElementById('meta');
S.metaEl = metaEl;
const loadingEl = document.getElementById('loading');
S.loadingEl = loadingEl;
const emptyEl = document.getElementById('empty');
S.emptyEl = emptyEl;
const hintEl = document.getElementById('hint');
S.hintEl = hintEl;
const errEl = document.getElementById('err');
S.errEl = errEl;
const tipeBtns = document.querySelectorAll('.tipe-btn');
S.tipeBtns = tipeBtns;
const takd = document.getElementById('takd');
S.takd = takd;
const tswasta = document.getElementById('tswasta');
S.tswasta = tswasta;
const comEkatBtn = document.getElementById('com-ekat');
S.comEkatBtn = comEkatBtn;
const comSwastaBtn = document.getElementById('com-swasta');
S.comSwastaBtn = comSwastaBtn;
const sortSelect = document.getElementById('sort-select');
S.sortSelect = sortSelect;
const clipList = document.getElementById('clip-list');
S.clipList = clipList;
const clipEmpty = document.getElementById('clip-empty');
S.clipEmpty = clipEmpty;
const clipTotal = document.getElementById('clip-total');
S.clipTotal = clipTotal;
const hdrCount = document.getElementById('hdr-count');
S.hdrCount = hdrCount;
const btnExport = document.getElementById('btn-export');
S.btnExport = btnExport;
const btnClearAll = document.getElementById('btn-clear-all');
S.btnClearAll = btnClearAll;
const inpRs = document.getElementById('inp-rs');
S.inpRs = inpRs;
const inpSales = document.getElementById('inp-sales');
S.inpSales = inpSales;
const inpMarsup = document.getElementById('inp-marsup');
S.inpMarsup = inpMarsup;
const btnRecord = document.getElementById('btn-record');
S.btnRecord = btnRecord;
const clipHeader = document.getElementById('clip-header');
S.clipHeader = clipHeader;
const clipHeaderToggle = document.getElementById('clip-header-toggle');
S.clipHeaderToggle = clipHeaderToggle;
const clipHeaderCompact = document.getElementById('clip-header-compact');
S.clipHeaderCompact = clipHeaderCompact;
const clipTotalHarga = document.getElementById('clip-total-harga');
S.clipTotalHarga = clipTotalHarga;
const clipBudget = document.getElementById('clip-budget');
S.clipBudget = clipBudget;

// ══════════════════════════════════════════
// RESIZE PANEL CLIPBOARD: drag manual lewat handle (pointer events, mouse+touch),
// dobel klik buat reset cepat ke lebar Normal. Lebar disimpan di localStorage
// per browser, jadi tiap orang bisa atur sesuai layar masing-masing dan gak
// ke-reset tiap refresh.
// ══════════════════════════════════════════
const CLIP_WIDTH_KEY = 'pnm_clip_width';
const CLIP_WIDTH_MIN = 300;
const CLIP_WIDTH_MAX = 640;
const CLIP_WIDTH_DEFAULT = 340;
const clipResizeHandle = document.getElementById('clip-resize-handle');

function setClipWidth(px, persist = true) {
  const clamped = Math.min(CLIP_WIDTH_MAX, Math.max(CLIP_WIDTH_MIN, Math.round(px)));
  document.documentElement.style.setProperty('--clip-width', clamped + 'px');
  if (persist) localStorage.setItem(CLIP_WIDTH_KEY, String(clamped));
  return clamped;
}

(function initClipWidth() {
  const saved = parseInt(localStorage.getItem(CLIP_WIDTH_KEY), 10);
  setClipWidth(!isNaN(saved) ? saved : CLIP_WIDTH_DEFAULT, false);
})();

// Drag manual lewat resize handle. Panel clipboard ada di sisi kanan, jadi
// menyeret handle ke kiri (dx negatif) memperlebar panel — width baru dihitung
// dari jarak kursor ke tepi kanan layar (bukan cuma delta X saja), supaya tetap
// akurat walau resize dimulai/dilepas di titik mana pun.
let clipDragPointerId = null;
function onClipResizeMove(e) {
  if (clipDragPointerId === null) return;
  const newWidth = window.innerWidth - e.clientX;
  setClipWidth(newWidth, false);
}
function endClipResize(e) {
  if (clipDragPointerId === null) return;
  clipResizeHandle.classList.remove('dragging');
  document.body.style.userSelect = '';
  try { clipResizeHandle.releasePointerCapture(clipDragPointerId); } catch {}
  clipDragPointerId = null;
  // baru persist ke localStorage di akhir drag, biar gak nulis tiap pixel gerak
  const current = getComputedStyle(document.documentElement).getPropertyValue('--clip-width');
  setClipWidth(parseInt(current, 10) || CLIP_WIDTH_DEFAULT, true);
  document.removeEventListener('pointermove', onClipResizeMove);
  document.removeEventListener('pointerup', endClipResize);
}
clipResizeHandle.addEventListener('pointerdown', (e) => {
  clipDragPointerId = e.pointerId;
  clipResizeHandle.classList.add('dragging');
  document.body.style.userSelect = 'none';
  try { clipResizeHandle.setPointerCapture(e.pointerId); } catch {}
  document.addEventListener('pointermove', onClipResizeMove);
  document.addEventListener('pointerup', endClipResize);
});
// Dobel klik handle = reset cepat ke lebar Normal, buat yang kepencet kejauhan pas drag.
clipResizeHandle.addEventListener('dblclick', () => setClipWidth(CLIP_WIDTH_DEFAULT));

// ══════════════════════════════════════════
// COLLAPSE PANEL PENCARIAN: kalau lagi fokus nyocokin clipboard, panel kiri
// bisa diciutkan jadi rail tipis biar area clipboard dapat ruang penuh.
// Status ciutan/enggak disimpan per sesi browser (sessionStorage), bukan
// selamanya — biar gak bikin bingung kalau lain kali buka lagi dari awal.
// ══════════════════════════════════════════
const PANEL_SEARCH_COLLAPSE_KEY = 'pnm_panel_search_collapsed';
const panelSearchEl = document.getElementById('panel-search');
S.panelSearchEl = panelSearchEl;
const panelSearchCollapseBtn = document.getElementById('panel-search-collapse-btn');
const panelSearchRail = document.getElementById('panel-search-rail');
function setPanelSearchCollapsed(collapsed, persist = true) {
  panelSearchEl.classList.toggle('collapsed', collapsed);
  panelSearchRail.title = 'Buka panel pencarian';
  if (persist) sessionStorage.setItem(PANEL_SEARCH_COLLAPSE_KEY, collapsed ? '1' : '0');
}
S.setPanelSearchCollapsed = setPanelSearchCollapsed;
if (panelSearchCollapseBtn && panelSearchRail) {
  panelSearchCollapseBtn.addEventListener('click', () => setPanelSearchCollapsed(true));
  panelSearchRail.addEventListener('click', () => setPanelSearchCollapsed(false));
  panelSearchRail.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPanelSearchCollapsed(false); }
  });
  setPanelSearchCollapsed(sessionStorage.getItem(PANEL_SEARCH_COLLAPSE_KEY) === '1', false);
}

// ══════════════════════════════════════════
// PREFERENSI / SETTINGS: dirancang biar gampang nambah setting baru — tinggal
// push satu entry ke SETTINGS_SCHEMA (key, label, deskripsi, default, dan
// callback onChange kalau perlu efek langsung), modal otomatis nge-render
// togglenya. Tema (Light/Dark) tetap pakai sistem localStorage yang sudah
// ada di bawah (biar gak duplikat/nabrak), tapi tetap ditampilkan sebagai
// baris pertama di modal ini biar semua preferensi ada di satu tempat.
// ══════════════════════════════════════════
const PNM_SETTINGS_KEY = 'pnm_settings';
const PNM_SETTINGS_DEFAULT = { autoComplete: true };
function loadPnmSettings() {
  try {
    return Object.assign({}, PNM_SETTINGS_DEFAULT, JSON.parse(localStorage.getItem(PNM_SETTINGS_KEY) || '{}'));
  } catch {
    return Object.assign({}, PNM_SETTINGS_DEFAULT);
  }
}
let pnmSettings = loadPnmSettings();
S.pnmSettings = pnmSettings;
function savePnmSettings() {
  localStorage.setItem(PNM_SETTINGS_KEY, JSON.stringify(pnmSettings));
}

// Tambah setting baru di sini nanti — tidak perlu ubah HTML modal.
const SETTINGS_SCHEMA = [
  {
    key: 'autoComplete',
    label: 'Auto Complete',
    desc: 'Tampilkan saran ejaan otomatis di bawah kolom pencarian sambil mengetik.',
    onChange: (val) => { if (!val) { acBox.style.display = 'none'; acBox.innerHTML = ''; } }
  }
];

const settingsModal = document.getElementById('settings-modal');
const settingsToggleBtn = document.getElementById('settings-toggle');
const settingsModalClose = document.getElementById('settings-modal-close');
const settingsListEl = document.getElementById('settings-list');

function isDarkThemeActive() {
  return document.documentElement.getAttribute('data-theme') === 'dark';
}

function renderSettingsList() {
  const dark = isDarkThemeActive();
  let html = `
    <div class="pref-row">
      <div>
        <div class="pref-row-label">Tema</div>
        <div class="pref-row-desc">Pilih tampilan terang atau gelap untuk seluruh workspace.</div>
      </div>
      <div class="pref-switch ${dark ? 'on' : ''}" id="pref-theme-switch" role="switch" aria-checked="${dark}" tabindex="0">
        <div class="knob"><i class="ti ${dark ? 'ti-moon' : 'ti-sun'}"></i></div>
      </div>
    </div>
  `;
  html += SETTINGS_SCHEMA.map(s => `
    <div class="pref-row">
      <div>
        <div class="pref-row-label">${s.label}</div>
        <div class="pref-row-desc">${s.desc}</div>
      </div>
      <div class="pref-switch ${pnmSettings[s.key] ? 'on' : ''}" data-pref-key="${s.key}" role="switch" aria-checked="${!!pnmSettings[s.key]}" tabindex="0"><div class="knob"></div></div>
    </div>
  `).join('');
  settingsListEl.innerHTML = html;

  const themeSwitch = document.getElementById('pref-theme-switch');
  themeSwitch.addEventListener('click', () => {
    // Reuse tombol theme-toggle yang sudah ada di header, biar logika
    // penyimpanan tema (localStorage 'theme'/'pnum-theme' + ikon) gak dobel.
    document.getElementById('theme-toggle').click();
    renderSettingsList();
  });

  settingsListEl.querySelectorAll('.pref-switch[data-pref-key]').forEach(el => {
    const toggle = () => {
      const key = el.dataset.prefKey;
      pnmSettings[key] = !pnmSettings[key];
      savePnmSettings();
      el.classList.toggle('on', pnmSettings[key]);
      el.setAttribute('aria-checked', String(pnmSettings[key]));
      const schema = SETTINGS_SCHEMA.find(s => s.key === key);
      if (schema && typeof schema.onChange === 'function') schema.onChange(pnmSettings[key]);
    };
    el.addEventListener('click', toggle);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  });
}

function openSettingsModal() { renderSettingsList(); settingsModal.classList.add('show'); }
function closeSettingsModal() { settingsModal.classList.remove('show'); }
if (settingsToggleBtn) settingsToggleBtn.addEventListener('click', openSettingsModal);
if (settingsModalClose) settingsModalClose.addEventListener('click', closeSettingsModal);
if (settingsModal) settingsModal.addEventListener('click', (e) => { if (e.target === settingsModal) closeSettingsModal(); });

// ══════════════════════════════════════════
// STATUS KONEKSI: banner + toast saat internet putus/nyambung lagi. Aksi yang
// gagal karena offline (search, simpan sesi, dll) tetap dikasih tau lewat toast
// error masing-masing seperti biasa — banner ini cuma indikator ambient.
// ══════════════════════════════════════════
const offlineBanner = document.getElementById('offline-banner');
function updateOnlineStatus() {
  const isOnline = navigator.onLine;
  offlineBanner.classList.toggle('show', !isOnline);
  if (isOnline && offlineBanner.dataset.wasOffline === '1') {
    S.showToast('Koneksi kembali normal ✓');
  }
  offlineBanner.dataset.wasOffline = isOnline ? '0' : '1';
}
S.updateOnlineStatus = updateOnlineStatus;
window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);
updateOnlineStatus();

// BUGFIX 2026-09-15: blok elemen Converter (convInput..btnConvAddAll) di bawah
// ini tadinya ke-taruh jauh di bawah (dekat komentar "MODUL CONVERTER" aslinya,
// setelah installRealtime(S)) — dipindah ke sini karena installSearch(S) (baris
// di bawah ini) langsung manggil S.btnConvProses.addEventListener(...) dkk SAAT
// installSearch(S) jalan, padahal deklarasi constnya baru muncul ratusan baris
// kemudian di file yang sama. Sama kelas bug persis kayak clipTabBtnKb/
// kbEmptyCta yang sempat kena fix serupa di clipboard.js/realtime.js. — Claude
const convInput = document.getElementById('conv-input');
S.convInput = convInput;
const convStatus = document.getElementById('conv-status');
S.convStatus = convStatus;
const convResultsEl = document.getElementById('conv-results');
S.convResultsEl = convResultsEl;
const convActions = document.getElementById('conv-actions');
S.convActions = convActions;
const btnConvProses = document.getElementById('btn-conv-proses');
S.btnConvProses = btnConvProses;
const btnConvRetryErr = document.getElementById('btn-conv-retry-err');
S.btnConvRetryErr = btnConvRetryErr;
const btnConvClear = document.getElementById('btn-conv-clear');
S.btnConvClear = btnConvClear;
const btnConvAddAll = document.getElementById('btn-conv-add-all');
S.btnConvAddAll = btnConvAddAll;
const btnConvCopyGambar = document.getElementById('btn-conv-copy-gambar');
S.btnConvCopyGambar = btnConvCopyGambar;
S.convRows = [];

  installClipboard(S);
  installSearch(S);
// ══════════════════════════════════════════
// NAVIGATION LAYER — konversian.html <-> crud-produk.html
// Murni URL query param, gak pakai sessionStorage sama sekali — ternyata
// ?sesi=<id> buat resume sesi konversi UDAH ADA (dipakai fitur share link
// WhatsApp, lihat openSesiFromUrlIfAny() di atas), jadi tinggal numpang
// pola yang sama, bukan bikin mekanisme baru. Nggak butuh Vite/router,
// nggak ubah cara deploy — tetap static file kayak sekarang.
// ══════════════════════════════════════════

function navigateToEditProduk(kode) {
  // SPA migration (sesi kesebelas): crud-produk sekarang juga sudah SPA
  // (map.md bagian 4 urutan #4 selesai) — target berubah dari
  // '/crud-produk.html' (file standalone) ke '/crud-produk' (clean-URL
  // route, sesi lanjutan — sebelumnya '/' + '#crud-produk', root = shell
  // sejak sesi ketujuh, hash sejak sesi lanjutan berikutnya). Query string
  // sama pola yang dipakai crud-produk/index.js's handleNavParamsIfAny()
  // (baca window.location.search) dan btnKembaliKonversi buat arah
  // sebaliknya — ini genuine full-page navigation (window.location.href),
  // bukan in-place SPA nav, biar crud-produk's mount() dapat
  // window.location.search yang valid dari fresh page load, sama persis
  // kayak konversian sendiri butuh itu buat restoreNavContext() di atas.
  const url = new URL('/crud-produk', window.location.href);
  url.searchParams.set('edit', kode);
  url.searchParams.set('return_to', 'konversian');
  if (S.currentSesiId) url.searchParams.set('return_sesi', S.currentSesiId);
  window.location.href = url.toString();
}
S.navigateToEditProduk = navigateToEditProduk;

// Dipanggil sekali dari showApp() setelah login sukses. Gak ngapa-ngapain
// kalau bukan hasil balik dari crud-produk (?resume gak ada) — aman
// dipanggil selalu, gak ganggu load biasa/link WhatsApp yang cuma bawa ?sesi=.
async function restoreNavContext() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('resume') !== '1') return;

  // ?sesi= (kalau ada) udah otomatis ke-handle sama openSesiFromUrlIfAny()
  // yang dipanggil showApp() — di sini cuma mastiin door-nya Konversi dulu,
  // soalnya default door pas fresh load itu 'cari' (lihat class awal
  // #app-root di HTML), dan subtab-row disembunyikan total di door itu.
  if (params.get('sesi')) S.switchDoor('konversi');

  const refreshedKode = params.get('refreshed');
  if (refreshedKode) refreshSingleProdukCard(refreshedKode);

  // Bersihkan query string dari address bar SETELAH dipakai, biar reload
  // manual berikutnya gak nyoba resume/refresh ulang ke state basi. Link
  // ?sesi= murni (dari WhatsApp, tanpa resume=1) sengaja gak kena ini,
  // biar tetap bisa di-bookmark/dibagi ulang seperti sebelumnya.
  // CLEAN URLS (sesi lanjutan): dulu ini juga harus nempelin balik
  // window.location.hash ('#konversian') biar gak ke-strip pas replaceState
  // -- gak perlu lagi sekarang, window.location.pathname sendiri SUDAH
  // '/konversian' (real path, bukan '/' + hash), jadi cukup pathname aja.
  window.history.replaceState({}, '', window.location.pathname);
}

// Patch 1 card produk yang lagi tampil di hasil pencarian, tanpa re-search
// semua — dipakai setelah balik dari edit produk di crud-produk (sekarang
// rute SPA #crud-produk, sebelumnya file standalone crud-produk.html).
async function refreshSingleProdukCard(kode) {
  if (!Array.isArray(S.lastResults) || !S.lastResults.some(r => r.kode_produk === kode)) return;
  try {
    const res = await S.sesiFetch(`produk?kode_produk=eq.${encodeURIComponent(kode)}&select=*&limit=1`);
    if (!res.ok) return;
    const rows = await res.json();
    if (rows && rows[0]) {
      S.lastResults = S.lastResults.map(r => r.kode_produk === kode ? rows[0] : r);
      S.renderResults(S.lastResults);
    }
  } catch (e) { console.warn('Gagal refresh kartu produk:', e); }
}

const SUBTAB_LABELS = {
  cari: 'Cari Produk',
  sesi: 'Konversi Berjalan',
  riwayat: 'Riwayat',
  converter: 'Converter',
  setcari: 'Cari SET',
  dictionary: 'Dictionary',
};
function switchSubTab(tab) {
  S.subtabCari.classList.toggle('active', tab === 'cari');
  S.subtabSesi.classList.toggle('active', tab === 'sesi');
  S.subtabRiwayat.classList.toggle('active', tab === 'riwayat');
  S.subtabConverter.classList.toggle('active', tab === 'converter');
  S.subtabSetcari.classList.toggle('active', tab === 'setcari');
  S.subtabDictionary.classList.toggle('active', tab === 'dictionary');
  S.panelBodyCari.style.display = tab === 'cari' ? 'block' : 'none';
  S.panelBodySesi.style.display = tab === 'sesi' ? 'block' : 'none';
  S.panelBodyRiwayat.style.display = tab === 'riwayat' ? 'block' : 'none';
  S.panelBodyConverter.style.display = tab === 'converter' ? 'block' : 'none';
  S.panelBodySetcari.style.display = tab === 'setcari' ? 'block' : 'none';
  S.panelBodyDictionary.style.display = tab === 'dictionary' ? 'block' : 'none';
  S.cariControls.style.display = tab === 'cari' ? 'block' : 'none';
  // Keeps the shared .pw-topbar's breadcrumb in sync with whatever's
  // actually on screen, instead of it permanently reading "Conversion
  // Workspace" (a literal copy of the sidebar's own section header for
  // this module -- see markup.js for why that was redundant).
  const crumbEl = document.getElementById('pw-topbar-crumb-text');
  if (crumbEl && SUBTAB_LABELS[tab]) crumbEl.textContent = SUBTAB_LABELS[tab];
  if (tab === 'sesi') loadSesiList();
  if (tab === 'riwayat') {
    // Sales options di-load sekali (guarded internal), lalu titipan filter
    // dari dashboard (kalau ada) diterapkan ke kedua select SEBELUM query
    // list-nya jalan, biar hasil pertama yang muncul sudah kefilter, gak
    // "kedip" nampilin data belum-difilter dulu.
    loadRiwayatSalesOptions().finally(() => {
      applyPendingRiwayatFilter();
      loadRiwayatList();
    });
    return;
  }
  if (tab === 'dictionary') S.loadDictionary();
  if (tab === 'setcari' && typeof S.updateSetcariSourceCount === 'function') S.updateSetcariSourceCount();
}
S.switchSubTab = switchSubTab;
S.subtabCari.addEventListener('click', () => switchSubTab('cari'));
S.subtabSesi.addEventListener('click', () => switchSubTab('sesi'));
S.subtabRiwayat.addEventListener('click', () => switchSubTab('riwayat'));
S.subtabConverter.addEventListener('click', () => switchSubTab('converter'));
S.subtabSetcari.addEventListener('click', () => switchSubTab('setcari'));
S.subtabDictionary.addEventListener('click', () => switchSubTab('dictionary'));
_switchSubTab = switchSubTab; // expose to the real top-level setSubroute() near the bottom of this file

function sesiTimeAgo(iso) {
  if (!iso) return '-';
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'baru saja';
  if (min < 60) return min + ' menit lalu';
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + ' jam lalu';
  return Math.floor(hr / 24) + ' hari lalu';
}
S.sesiTimeAgo = sesiTimeAgo;

function renderSesiCard(s) {
  const itemCount = (s.sesi_konversi_item && s.sesi_konversi_item[0] && s.sesi_konversi_item[0].count) || 0;
  // SECURITY FIX 2026-08-14: nama_rs/pic_marsup/nama_sales itu free-text yang
  // diketik user & disebar ke SEMUA kolaborator lewat Realtime — dulu
  // ditulis mentah ke innerHTML (stored XSS). Sekarang semua di-escape lewat
  // escapeHtmlAttr() sebelum masuk template.
  const namaSafe = S.escapeHtmlAttr(s.nama_rs || '(Nama RS belum diisi)');
  const picSafe = S.escapeHtmlAttr(s.pic_marsup || '-');
  const salesSafe = S.escapeHtmlAttr(s.nama_sales || '-');
  const bantuanBadge = s.butuh_bantuan
    ? `<span class="tipe-badge" style="background:var(--danger-bg);color:var(--danger)">🙋 Butuh bantuan</span>
       <button class="sesi-wa-btn" data-id="${s.id}" data-nama="${namaSafe}" title="Kirim link sesi ini ke WhatsApp" type="button" style="position:absolute;top:8px;right:38px;width:24px;height:24px;border:1px solid var(--success-border);border-radius:6px;background:var(--success-bg);color:var(--success);font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center"><i class="ti ti-brand-whatsapp"></i></button>`
    : '';
  // Ringkasan Permintaan RS (kalau ada) — biar temen yang lagi liat daftar
  // "Konversi Berjalan" langsung tau ada permintaan apa gak di sesi ini,
  // tanpa perlu buka satu-satu dulu.
  const p = s._permintaan;
  const permintaanChip = p
    ? `<span class="mi"><i class="ti ti-clipboard-text"></i><span>Permintaan RS: ${p.items_terpenuhi}/${p.items_total} terpenuhi${p.items_pending > 0 ? ' · ' + p.items_pending + ' belum dicek' : ''}</span></span>`
    : '';
  return `<div class="rcard sesi-card" data-id="${s.id}" style="position:relative">
    <button class="sesi-delete-btn" data-id="${s.id}" data-nama="${namaSafe}" title="Hapus sesi ini" type="button"><i class="ti ti-trash"></i></button>
    <div class="rcard-top" style="padding-right:66px">
      <div class="rcard-name">${namaSafe}</div>
      ${bantuanBadge}
    </div>
    <div class="rcard-meta">
      <span class="mi"><i class="ti ti-user"></i><span>PIC: ${picSafe}</span></span>
      <span class="mi"><i class="ti ti-users"></i><span>Sales: ${salesSafe}</span></span>
      <span class="mi"><i class="ti ti-package"></i><span>${itemCount} produk</span></span>
      ${permintaanChip}
      <span class="mi"><i class="ti ti-clock"></i><span>${sesiTimeAgo(s.updated_at)}</span></span>
    </div>
  </div>`;
}

// Kartu riwayat: sesi yang statusnya 'selesai', apapun hasilnya.
// FIX (fundamental, per diskusi): "Jadi Order"/"Ditutup Tanpa Order" DULU
// didiktein otomatis dari ada-gaknya baris konversi_record (Record Konversi
// pernah diklik atau enggak) — itu keliru, karena "pernah di-Record" beda
// sama "beneran jadi order", yang faktanya nunggu feedback sales dan bisa
// berubah lama SETELAH sesi ditutup. Sekarang hasil_order itu field manual
// (kolom baru di sesi_konversi, lihat migration terpisah) yang manusia set
// sendiri lewat dropdown di kartu ini — default null = "Menunggu Feedback
// Sales" (netral, BUKAN diasumsikan gagal). REV/grand_total/link tetap dari
// konversi_record seperti biasa, itu emang soal dokumennya sendiri, bukan
// soal hasil order.
function renderRiwayatCard(s) {
  const itemCount = (s.sesi_konversi_item && s.sesi_konversi_item[0] && s.sesi_konversi_item[0].count) || 0;
  // SECURITY FIX 2026-08-14: sama seperti renderSesiCard — escape free-text
  // sebelum masuk innerHTML (stored XSS fix).
  const namaSafe = S.escapeHtmlAttr(s.nama_rs || '(Nama RS belum diisi)');
  const picSafe = S.escapeHtmlAttr(s.pic_marsup || '-');
  const salesSafe = S.escapeHtmlAttr(s.nama_sales || '-');
  const records = s.konversi_record || [];
  const latest = records.length ? records.reduce((a, b) => (b.revisi > a.revisi ? b : a)) : null;
  const hasilOrder = s.hasil_order || null; // null | 'jadi_order' | 'tanpa_order'
  const hasilOrderCls = hasilOrder === 'jadi_order' ? 'hasil-order-jadi' : hasilOrder === 'tanpa_order' ? 'hasil-order-tanpa' : 'hasil-order-nunggu';
  const orderBadge = `<select class="hasil-order-select ${hasilOrderCls}" data-id="${s.id}" title="Hasil order ditentukan manusia, bukan otomatis — nunggu feedback sales">
      <option value="" ${!hasilOrder ? 'selected' : ''}>⏳ Menunggu Feedback Sales</option>
      <option value="jadi_order" ${hasilOrder === 'jadi_order' ? 'selected' : ''}>✅ Jadi Order</option>
      <option value="tanpa_order" ${hasilOrder === 'tanpa_order' ? 'selected' : ''}>◻️ Tidak Jadi Order</option>
    </select>${latest ? `<span class="mi" style="margin-left:4px"><i class="ti ti-file-text"></i><span>${latest.revisi > 0 ? 'REV' + latest.revisi : 'Ada Record'}${latest.grand_total != null ? ' · Rp' + Number(latest.grand_total).toLocaleString('id-ID') : ''}</span></span>` : ''}`;
  // Chip "X versi tersimpan" — dulu cuma teks statis, sekarang tombol yang
  // buka modal "Riwayat Konversi" (lihat setupKonversiRiwayatModal di bawah),
  // pola sama persis kayak sphChip/openSphRiwayatModal di bawahnya. Sengaja
  // fetch ulang per-sesi di modal (bukan pakai `records` yang udah kebawa di
  // sini) karena kartu ini cuma minta grand_total/kategori/revisi/link —
  // gak ada notes/pic/item, jadi modal butuh query sendiri yang lebih detail.
  const versiChip = records.length > 1
    ? `<button type="button" class="mi konversi-riwayat-btn" data-id="${s.id}" data-nama="${namaSafe}" style="border:none;background:none;cursor:pointer;padding:0;color:inherit;font:inherit"><i class="ti ti-versions"></i><span>${records.length} versi tersimpan</span></button>`
    : '';
  // Jumlah SPH yang pernah digenerate dari sesi ini — sekarang bisa dihitung
  // beneran (sph_records.sesi_id) bukan tebak-tebakan, lihat migration
  // migration_sph_link_sesi.sql. Cuma nongol kalau ada, biar kartu yang belum
  // pernah bikin SPH gak penuh chip kosong.
  const sphCount = (s.sph_records && s.sph_records[0] && s.sph_records[0].count) || 0;
  const sphChip = sphCount > 0
    ? `<button type="button" class="mi sph-riwayat-btn" data-id="${s.id}" data-nama="${namaSafe}" style="border:none;background:none;cursor:pointer;padding:0;color:inherit;font:inherit"><i class="ti ti-file-invoice"></i><span>${sphCount} SPH — lihat riwayat</span></button>`
    : '';
  // Link file/dokumen yang nempel di record terbaru (biasanya link Drive dari
  // "Simpan ke Drive" → auto-filled ke rec-link → ikut kesimpen di sini).
  // stopPropagation biar klik link gak ikut ngebuka sesi (card-nya sendiri
  // punya click handler buat openSesi).
  const linkChip = (latest && latest.link && S.isSafeHttpUrl(latest.link))
    ? `<a class="mi record-link-chip" href="${S.escapeHtmlAttr(latest.link)}" target="_blank" rel="noopener" style="color:var(--accent-text)"><i class="ti ti-link"></i><span>Buka file</span></a>`
    : '';
  return `<div class="rcard riwayat-card" data-id="${s.id}" style="position:relative">
    <div class="rcard-top" style="padding-right:8px">
      <div class="rcard-name">${namaSafe}</div>
      ${orderBadge}
    </div>
    <div class="rcard-meta">
      <span class="mi"><i class="ti ti-user"></i><span>PIC: ${picSafe}</span></span>
      <span class="mi"><i class="ti ti-users"></i><span>Sales: ${salesSafe}</span></span>
      <span class="mi"><i class="ti ti-package"></i><span>${itemCount} produk</span></span>
      ${versiChip}
      ${sphChip}
      ${linkChip}
      <span class="mi"><i class="ti ti-clock"></i><span>Selesai ${sesiTimeAgo(s.updated_at)}</span></span>
    </div>
  </div>`;
}

// Nulis hasil_order (manual, dari dropdown kartu riwayat) ke server. Optimistic
// UI — dropdown udah kepilih duluan pas ini jalan — jadi kalau gagal, dropdown
// dibalikin ke value lama + toast error, biar gak nampilin state yang gak
// beneran kesimpen.
async function persistHasilOrder(sesiId, value, selectEl) {
  const prevValue = selectEl.dataset.prevValue || '';
  selectEl.dataset.prevValue = value;
  selectEl.classList.remove('hasil-order-jadi', 'hasil-order-tanpa', 'hasil-order-nunggu');
  selectEl.classList.add(value === 'jadi_order' ? 'hasil-order-jadi' : value === 'tanpa_order' ? 'hasil-order-tanpa' : 'hasil-order-nunggu');
  try {
    const res = await S.sesiFetch(`${S.SESI_TABLE}?id=eq.${sesiId}`, {
      method: 'PATCH',
      body: JSON.stringify({ hasil_order: value || null, updated_at: new Date().toISOString() })
    });
    if (!res.ok) throw new Error('PATCH gagal');
  } catch (err) {
    selectEl.value = prevValue;
    selectEl.dataset.prevValue = prevValue;
    selectEl.classList.remove('hasil-order-jadi', 'hasil-order-tanpa', 'hasil-order-nunggu');
    selectEl.classList.add(prevValue === 'jadi_order' ? 'hasil-order-jadi' : prevValue === 'tanpa_order' ? 'hasil-order-tanpa' : 'hasil-order-nunggu');
    S.showToast('Gagal simpan hasil order, coba lagi', 'error');
  }
}

// Filter periode "Riwayat" — dihitung di client (bukan RPC baru), karena
// sesi_konversi.updated_at sudah cukup buat semua opsi di bawah dan gak ada
// query berat yang perlu didorong ke server. 'bulanini'/'bulanlalu' beneran
// kalender (bukan rolling N hari), beda dari leaderboard dashboard yang
// masih pakai p_days rolling (lihat daysToRiwayatPeriodKey di dashboard/index.js
// buat pemetaan pas datang dari sana).
function riwayatPeriodRange(key) {
  const now = new Date();
  const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const endOfDay = (d) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };
  if (key === '7hari') {
    const start = new Date(now); start.setDate(start.getDate() - 6);
    return { start: startOfDay(start), end: endOfDay(now) };
  }
  if (key === '30hari') {
    const start = new Date(now); start.setDate(start.getDate() - 29);
    return { start: startOfDay(start), end: endOfDay(now) };
  }
  if (key === '90hari') {
    const start = new Date(now); start.setDate(start.getDate() - 89);
    return { start: startOfDay(start), end: endOfDay(now) };
  }
  if (key === 'bulanini') {
    return { start: startOfDay(new Date(now.getFullYear(), now.getMonth(), 1)), end: endOfDay(now) };
  }
  if (key === 'bulanlalu') {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    return { start: startOfDay(start), end: endOfDay(end) };
  }
  return null; // 'semua' atau value gak dikenal
}

// Populate dropdown Sales dari nilai nama_sales yang beneran ada di
// sesi_konversi selesai — nama_sales itu free-text (ketikan manual di form,
// bukan FK ke tabel `sales`), jadi dropdown-nya diisi dari distinct value
// yang sudah kepakai, bukan dari daftar master. Dipanggil sekali (guard via
// dataset.loaded) tiap kali tab Riwayat pertama kali dibuka.
async function loadRiwayatSalesOptions() {
  if (!S.riwayatSalesFilter || S.riwayatSalesFilter.dataset.loaded === '1') return;
  try {
    const res = await S.sesiFetch(`${S.SESI_TABLE}?select=nama_sales&status=eq.selesai&nama_sales=not.is.null`);
    if (!res.ok) return;
    const rows = await res.json();
    const names = [...new Set(rows.map(r => (r.nama_sales || '').trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'id'));
    const prevVal = S.riwayatSalesFilter.value;
    S.riwayatSalesFilter.innerHTML = '<option value="">Semua Sales</option>'
      + names.map(n => `<option value="${S.escapeHtmlAttr(n)}">${S.escapeHtmlAttr(n)}</option>`).join('');
    if (prevVal) S.riwayatSalesFilter.value = prevVal;
    S.riwayatSalesFilter.dataset.loaded = '1';
  } catch (e) { console.warn('Gagal memuat daftar sales buat filter Riwayat:', e); }
}

// Titipan filter dari Dashboard (leaderboard sales, lihat
// RIWAYAT_PENDING_FILTER_KEY di app/pages/dashboard/index.js) — key sengaja
// disamain string-nya persis di kedua file. Dibaca sekali tiap tab Riwayat
// dibuka lalu langsung dihapus, biar buka tab Riwayat manual berikutnya gak
// ketiban filter basi dari kunjungan dashboard yang lama.
const RIWAYAT_PENDING_FILTER_KEY = 'pnm_riwayat_pending_filter';
function applyPendingRiwayatFilter() {
  let pending = null;
  try {
    const raw = sessionStorage.getItem(RIWAYAT_PENDING_FILTER_KEY);
    if (!raw) return;
    sessionStorage.removeItem(RIWAYAT_PENDING_FILTER_KEY);
    pending = JSON.parse(raw);
  } catch (e) { return; }
  if (!pending) return;
  if (typeof pending.sales === 'string' && S.riwayatSalesFilter) S.riwayatSalesFilter.value = pending.sales;
  if (typeof pending.period === 'string' && S.riwayatPeriodFilter) S.riwayatPeriodFilter.value = pending.period;
}

// Rekap ringkas buat baris hasil Riwayat yang lagi ditampilin (bukan query
// agregat terpisah ke server — dihitung dari `data` yang sama yang sudah
// kefetch buat render kartu, jadi zero cost tambahan). Sengaja pisah
// "jadi order" dari "total nilai tercatat": grand_total record ada di
// SEMUA sesi yang pernah di-Record, gak peduli hasil_order-nya apa (masih
// nunggu feedback sales, jadi order, atau enggak) — nyampur semuanya jadi
// satu angka "total" bakal kebaca kayak omzet padahal sebagian besar masih
// potensi/belum pasti. Ditampilin kepisah biar gak nyesatin.
function riwayatLatestRecord(s) {
  const records = s.konversi_record || [];
  return records.length ? records.reduce((a, b) => (b.revisi > a.revisi ? b : a)) : null;
}
function renderRiwayatSummary(data) {
  if (!S.riwayatSummary) return;
  if (!data.length) { S.riwayatSummary.style.display = 'none'; S.riwayatSummary.innerHTML = ''; return; }
  let jadiCount = 0, jadiValue = 0, tanpaCount = 0, nungguCount = 0, totalRecorded = 0, recordedCount = 0;
  data.forEach(s => {
    const latest = riwayatLatestRecord(s);
    const val = (latest && latest.grand_total != null) ? Number(latest.grand_total) : null;
    if (val != null) { totalRecorded += val; recordedCount++; }
    if (s.hasil_order === 'jadi_order') { jadiCount++; if (val != null) jadiValue += val; }
    else if (s.hasil_order === 'tanpa_order') tanpaCount++;
    else nungguCount++;
  });
  // limit=100 di query -- kalau pas kena 100 pas, kemungkinan masih ada baris
  // lain yang cocok filter tapi gak ketarik; angka di bawah cuma dari yang
  // tertampil, bukan klaim "semua data yang cocok filter ini".
  const cappedNote = data.length === 100
    ? ` <span title="Query dibatasi 100 baris terbaru — rekap ini cuma dari yang tertampil">(100 teratas)</span>`
    : '';
  S.riwayatSummary.innerHTML = `
    <span><b style="color:var(--text)">${data.length}</b> sesi${cappedNote}</span>
    <span style="color:var(--success)"><b>${jadiCount}</b> jadi order${jadiValue ? ' · ' + S.rupiah(jadiValue) : ''}</span>
    <span>${nungguCount} menunggu feedback</span>
    <span style="color:var(--danger)">${tanpaCount} tidak jadi order</span>
    <span style="margin-left:auto;color:var(--text)">Total nilai tercatat (${recordedCount} sesi ada record): <b>${S.rupiah(totalRecorded)}</b></span>
  `;
  S.riwayatSummary.style.display = 'flex';
}

async function loadRiwayatList() {
  S.riwayatListLoading.style.display = 'block';
  S.riwayatListError.style.display = 'none';
  S.riwayatListEmpty.style.display = 'none';
  S.riwayatList.innerHTML = '';
  if (S.riwayatSummary) S.riwayatSummary.style.display = 'none';
  try {
    // Search realtime di nama RS / PIC / Sales — pake `or=` PostgREST biar
    // kepencet satu kotak aja, gak perlu tiga filter field terpisah.
    const term = S.riwayatSearchInput ? S.riwayatSearchInput.value.trim() : '';
    let searchFilter = '';
    if (term) {
      const esc = term.replace(/[,()]/g, ' ').trim();
      searchFilter = `&or=(nama_rs.ilike.*${encodeURIComponent(esc)}*,pic_marsup.ilike.*${encodeURIComponent(esc)}*,nama_sales.ilike.*${encodeURIComponent(esc)}*)`;
    }
    const salesVal = S.riwayatSalesFilter ? S.riwayatSalesFilter.value : '';
    const salesFilter = salesVal ? `&nama_sales=eq.${encodeURIComponent(salesVal)}` : '';
    const periodVal = S.riwayatPeriodFilter ? S.riwayatPeriodFilter.value : '';
    const range = riwayatPeriodRange(periodVal);
    const dateFilter = range ? `&updated_at=gte.${range.start.toISOString()}&updated_at=lte.${range.end.toISOString()}` : '';
    const anyFilterActive = !!(term || salesVal || range);
    const res = await S.sesiFetch(`${S.SESI_TABLE}?status=eq.selesai${searchFilter}${salesFilter}${dateFilter}&select=*,${S.SESI_ITEM_TABLE}(count),konversi_record(id,grand_total,kategori,revisi,link),sph_records(count)&order=updated_at.desc&limit=100`);
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.message || errData.hint || 'Gagal memuat riwayat (cek relasi konversi_record.sesi_id → sesi_konversi.id di Supabase).');
    }
    const data = await res.json();
    if (data.length === 0) {
      S.riwayatListEmpty.querySelector('p').innerHTML = anyFilterActive
        ? `Gak ada riwayat yang cocok dengan filter ini${term ? ` ("${term.replace(/</g, '&lt;')}")` : ''}.`
        : 'Belum ada sesi yang selesai.<br>Sesi yang di-Record atau di-Selesaikan bakal muncul di sini.';
      S.riwayatListEmpty.style.display = 'block';
      return;
    }
    S.riwayatList.innerHTML = data.map(renderRiwayatCard).join('');
    renderRiwayatSummary(data);
    S.riwayatList.querySelectorAll('.riwayat-card').forEach(card => {
      card.addEventListener('click', () => openSesi(card.dataset.id));
    });
    S.riwayatList.querySelectorAll('.hasil-order-select').forEach(sel => {
      sel.addEventListener('click', (e) => e.stopPropagation());
      sel.addEventListener('mousedown', (e) => e.stopPropagation());
      sel.addEventListener('change', (e) => persistHasilOrder(sel.dataset.id, sel.value, sel));
    });
    // Dulu inline onclick="event.stopPropagation()" di linkChip -- tanpa ini klik "Buka file"
    // bakal ikut buka kartu sesi (bubbling ke card.addEventListener('click', openSesi) di atas).
    S.riwayatList.querySelectorAll('.record-link-chip').forEach(a => {
      a.addEventListener('click', (e) => e.stopPropagation());
    });
    S.riwayatList.querySelectorAll('.sph-riwayat-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        S.openSphRiwayatModal(btn.dataset.id, btn.dataset.nama);
      });
    });
    S.riwayatList.querySelectorAll('.konversi-riwayat-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        S.openKonversiRiwayatModal(btn.dataset.id, btn.dataset.nama);
      });
    });
  } catch (err) {
    S.renderListError(S.riwayatListError, err.message, loadRiwayatList);
    S.riwayatListError.style.display = 'block';
  } finally {
    S.riwayatListLoading.style.display = 'none';
  }
}
S.btnRiwayatRefresh.addEventListener('click', loadRiwayatList);

// Search realtime, di-debounce biar gak nembak Supabase tiap ketikan huruf.
S.riwayatSearchInput.addEventListener('input', () => {
  S.riwayatClearBtn.style.display = S.riwayatSearchInput.value ? 'block' : 'none';
  clearTimeout(S.riwayatSearchDebounce);
  S.riwayatSearchDebounce = setTimeout(loadRiwayatList, 300);
});
S.riwayatClearBtn.addEventListener('click', () => {
  S.riwayatSearchInput.value = '';
  S.riwayatClearBtn.style.display = 'none';
  loadRiwayatList();
});
S.riwayatSalesFilter.addEventListener('change', () => loadRiwayatList());
S.riwayatPeriodFilter.addEventListener('change', () => loadRiwayatList());


// buat seluruh daftar), lalu tempel ke masing-masing baris sesi sebagai _permintaan.
// Gagal di sini gak boleh gagalin daftar sesi — badge-nya optional.
async function attachPermintaanSummary(sesiRows) {
  if (!sesiRows.length) return sesiRows;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_permintaan_summary_by_sesi_ids`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': ANON_KEY,
        'Authorization': 'Bearer ' + (await getFreshToken())
      },
      body: JSON.stringify({ p_sesi_ids: sesiRows.map(s => s.id) })
    });
    if (!res.ok) return sesiRows;
    const summaries = await res.json();
    const bySesiId = {};
    (summaries || []).forEach(s => { bySesiId[s.sesi_id] = s; });
    sesiRows.forEach(s => { s._permintaan = bySesiId[s.id] || null; });
  } catch { /* badge permintaan opsional, diamkan kalau gagal */ }
  return sesiRows;
}

async function loadSesiList() {
  S.sesiListLoading.style.display = 'block';
  S.sesiListError.style.display = 'none';
  S.sesiListEmpty.style.display = 'none';
  S.sesiList.innerHTML = '';
  try {
    const res = await S.sesiFetch(`${S.SESI_TABLE}?status=eq.berjalan&select=*,${S.SESI_ITEM_TABLE}(count)&order=updated_at.desc`);
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.message || errData.hint || 'Tabel sesi_konversi belum tersedia di Supabase — jalankan dulu SQL setup-nya.');
    }
    const data = await res.json();
    S.sesiBadge.textContent = data.length;
    S.sesiBadge.style.display = data.length > 0 ? 'inline-block' : 'none';
    if (data.length === 0) { S.sesiListEmpty.style.display = 'block'; return; }
    await attachPermintaanSummary(data);
    S.sesiList.innerHTML = data.map(renderSesiCard).join('');
    S.sesiList.querySelectorAll('.sesi-card').forEach(card => {
      card.addEventListener('click', () => openSesi(card.dataset.id));
    });
    S.sesiList.querySelectorAll('.sesi-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation(); // jangan sampai ikut buka sesinya
        deleteSesi(btn.dataset.id, btn.dataset.nama, btn);
      });
    });
    S.sesiList.querySelectorAll('.sesi-wa-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        shareSesiToWhatsApp(btn.dataset.id, btn.dataset.nama);
      });
    });
  } catch (err) {
    S.renderListError(S.sesiListError, err.message, loadSesiList);
  } finally {
    S.sesiListLoading.style.display = 'none';
  }
}
S.loadSesiList = loadSesiList;

// Hapus sesi konversi secara permanen (beserta semua item di dalamnya).
// Kalau sesi yang dihapus adalah sesi yang sedang dibuka, layar clipboard
// ikut direset biar gak nyisa data sesi yang udah gak ada.
async function deleteSesi(id, nama, btn) {
  if (!(await S.showConfirmModal({ title: 'Hapus Sesi', text: `Hapus sesi "${nama}"? Semua produk di dalamnya ikut terhapus dan tidak bisa dikembalikan.`, okText: 'Ya, Hapus', danger: true }))) return;
  if (btn) btn.disabled = true;
  try {
    // Defense-in-depth: id di sini normalnya dataset.id dari baris DB (bukan input bebas),
    // tapi di-encode juga supaya konsisten dengan openSesi() dan gak bergantung ke asumsi itu.
    const idSafe = encodeURIComponent(id);
    await S.sesiFetch(`${S.SESI_ITEM_TABLE}?sesi_id=eq.${idSafe}`, { method: 'DELETE' });
    const res = await S.sesiFetch(`${S.SESI_TABLE}?id=eq.${idSafe}`, { method: 'DELETE' });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.message || errData.hint || 'Gagal menghapus sesi');
    }
    if (S.currentSesiId === id) {
      S.currentSesiId = null;
      S.clipboard = [];
      inpRs.value = '';
      inpSales.value = '';
      S.currentButuhBantuan = false;
      S.updateClipboard();
      S.renderResults(S.lastResults);
      S.renderButuhBantuanBtn();
      S.setSesiSavedStatus('');
      S.updateClipHeaderCompact();
      resetChecklistUI();
      S.updateEndSesiBtnState();
    }
    await loadSesiList();
  } catch (err) {
    S.showToast('Gagal hapus sesi: ' + err.message, 'error');
    if (btn) btn.disabled = false;
  }
}

async function openSesi(id) {
  try {
    resetChecklistUI(); // buang checklist Permintaan RS dari sesi sebelumnya (kalau ada) dulu
    if (typeof S.switchDoor === 'function') S.switchDoor('konversi'); // buka sesi = jelas-jelas mau lanjut kerjaan konversi
    // encodeURIComponent(id): `id` di sini bisa datang dari ?sesi=... di URL (link share
    // WhatsApp, lihat openSesiFromUrlIfAny()) -- link yang dibikin orang lain, bukan dari
    // DB. Tanpa di-encode, string berisi karakter PostgREST filter (mis. `&or=(...)`) bisa
    // menyisipkan kondisi tambahan ke query yang jalan pakai token si korban.
    const idSafe = encodeURIComponent(id);
    const [sesiRes, itemsRes] = await Promise.all([
      S.sesiFetch(`${S.SESI_TABLE}?id=eq.${idSafe}&select=*`),
      S.sesiFetch(`${S.SESI_ITEM_TABLE}?sesi_id=eq.${idSafe}&select=*`)
    ]);
    if (!sesiRes.ok || !itemsRes.ok) throw new Error('Gagal memuat sesi dari server');
    const [sesiRows, items] = await Promise.all([sesiRes.json(), itemsRes.json()]);
    const sesi = sesiRows[0];
    if (!sesi) throw new Error('Sesi tidak ditemukan (mungkin sudah dihapus/selesai)');

    S.currentSesiId = sesi.id;
    S.currentButuhBantuan = !!sesi.butuh_bantuan;
    inpRs.value = sesi.nama_rs || '';
    inpSales.value = sesi.nama_sales || '';
    if (sesi.pic_marsup) inpMarsup.value = sesi.pic_marsup;
    S.checklistPagu = (sesi.pagu != null) ? sesi.pagu : null;
    S.updateEndSesiBtnState();

    S.clipboard = items.map(S.mapSesiItemRowToClipItem);

    // Mode harga ikut sesi (ditetapkan pembuatnya), bukan default lokal —
    // setModeSwastaOutput() di bawah juga manggil updateClipboard().
    S.setModeSwastaOutput(!!sesi.mode_harga_swasta);
    if (S.lastResults.length) S.renderResults(S.lastResults);
    S.renderButuhBantuanBtn();
    S.setClipHeaderCollapsed(false);
    S.updateClipHeaderCompact();
    S.setSesiSavedStatus('Sesi dimuat ✓');
    switchSubTab('cari');
    if (window.innerWidth <= 860 && typeof S.switchTab === 'function') S.switchTab('clip');

    // Permintaan RS yang nempel di sesi ini (kalau ada) ikut dimuat & ditampilin,
    // jadi siapa pun yang buka sesi ini liat daftar permintaannya — bukan cuma
    // orang yang pertama nyatetnya.
    await S.loadChecklistForSesi(sesi.id);
    if (typeof S.subscribeToSesiRealtime === 'function') S.subscribeToSesiRealtime(S.currentSesiId);
  } catch (err) {
    S.showToast('Gagal membuka sesi: ' + err.message, 'error');
  }
}

// Reset state checklist "Kebutuhan RS" di layar (dipanggil sebelum ganti sesi,
// biar gak nyisa data dari sesi yang lain).
function resetChecklistUI() {
  // Sesi ganti total → link Drive sesi sebelumnya gak relevan lagi buat sesi
  // yang baru dibuka/dimulai (lihat lastDriveUrl & openRecordModal()).
  S.lastDriveUrl = null;
  S.checklistItems = [];
  S.checklistSections = [];
  S.activeSectionTab = null;
  S.checklistPermintaanId = null;
  S.checklistTanggal = null;
  S.checklistExpandedId = null;
  S.checklistPickingId = null;
  // Cache saran Dictionary di-key pakai item.id — item.id sesi lama gak relevan
  // lagi (dan secara teori bisa collide sama id sesi baru), buang aja.
  Object.keys(S.dictSuggestionCache).forEach(k => delete S.dictSuggestionCache[k]);
  if (typeof S.kbRefreshStatus !== 'undefined' && S.kbRefreshStatus) S.kbRefreshStatus.textContent = '';
  if (typeof S.updateKbTabState === 'function') S.updateKbTabState();
  if (typeof S.updateClipSummaryStrip === 'function') S.updateClipSummaryStrip();
  if (typeof S.switchClipTab === 'function') S.switchClipTab('list');
  // Referensi screenshot nempel ke konteks Permintaan RS yang lagi dibuka —
  // begitu pindah/tutup/hapus sesi, referensi lama gak relevan lagi.
  if (typeof resetSsReferences === 'function') resetSsReferences();
  // Channel realtime nempel ke satu sesi doang — begitu pindah/tutup/hapus sesi,
  // channel yang lama WAJIB diputus dulu (lihat subscribeToSesiRealtime di bawah).
  if (typeof S.unsubscribeFromSesiRealtime === 'function') S.unsubscribeFromSesiRealtime();
  // Konteks sesi ganti total — kalau ada penolakan "Mulai Konversi Baru?" dari
  // form sebelumnya, itu gak relevan lagi buat konteks yang baru ini.
  S.headerFieldsSesiDeclined = false;
  // BUGFIX: file Excel hasil export & status stepper "Export ✓ / Simpan ke
  // Drive ✓" nempel ke sesi SEBELUMNYA — begitu pindah/tutup/hapus sesi,
  // itu semua gak relevan lagi (mirip logika lastDriveUrl/resetSsReferences
  // di atas), tapi sebelumnya gak pernah dibersihin sampai reload halaman
  // manual. lastExportBlob dikosongin biar "Simpan ke Drive" gak bisa
  // reupload file Excel sesi lama tanpa export ulang dulu; window.convFlow.
  // reset() (konversian.html) yang beresin tampilan steppernya sendiri.
  S.lastExportBlob = null;
  S.lastExportFilename = null;
  S.lastExportNamaSales = null;
  if (typeof S.btnDriveUpload !== 'undefined' && S.btnDriveUpload) S.btnDriveUpload.disabled = true;
  if (window.convFlow && typeof window.convFlow.reset === 'function') window.convFlow.reset();
  // BUGFIX: isian tab "Buat SPH" (RS/Sales/Tanggal/Nomor/preview) nempel ke sesi
  // SEBELUMNYA — sphPrefillFromSession() di sph-module.js sengaja cuma ngisi field
  // kosong (biar gak nimpa ketikan manual DALAM 1 sesi yang sama), tapi itu bikin
  // isian gak pernah kereset begitu pindah/tutup/buka sesi lain. sphFlow.reset()
  // kosongin dulu di sini, biar sphPrefillFromSession() ngisi ulang FRESH dari
  // sesi yang baru begitu tab SPH dibuka.
  if (window.sphFlow && typeof window.sphFlow.reset === 'function') window.sphFlow.reset();
}
S.resetChecklistUI = resetChecklistUI;

  installRealtime(S);
// ══════════════════════════════════════════
// RECORD KONVERSI → GOOGLE SHEETS (Apps Script webhook)
// ══════════════════════════════════════════

// SECURITY FIX 2026-08-14: dulu manggil GAS_WEBHOOK_URL langsung dari
// browser tanpa proteksi apapun (bukan cuma token doang yang gak ada — URL
// Apps Script-nya sendiri jadi satu-satunya "kunci", padahal itu keliatan
// telanjang di bundle JS publik). Sekarang lewat Edge Function
// sheets-webhook-proxy, yang wajib verify JWT user login dulu sebelum
// nembak ke Apps Script — orang yang gak login gak bisa nyuntik baris palsu
// ke Sheet lagi. URL Apps Script asli sekarang cuma disimpan di server
// (Supabase secret), gak pernah nyampe ke client.
const SHEETS_PROXY_URL = `${SUPABASE_URL}/functions/v1/sheets-webhook-proxy`;
S.SHEETS_PROXY_URL = SHEETS_PROXY_URL;

// Ingat nama PIC Marsup di browser supaya ga perlu ketik ulang tiap buka
(function initMarsupName() {
  const saved = localStorage.getItem('pic_marsup_name');
  if (saved) inpMarsup.value = saved;
})();
inpMarsup.addEventListener('input', () => {
  localStorage.setItem('pic_marsup_name', inpMarsup.value.trim());
});

// Hitung kategori (Instrumen / Set / Unit / Campuran) + total value dari clipboard
function computeKonversiSummary() {
  const tipeSet = new Set(S.clipboard.map(i => (i.tipe || '').toUpperCase()));
  let kategori;
  if (tipeSet.size === 0) kategori = '-';
  else if (tipeSet.size > 1) kategori = 'Campuran';
  else {
    const t = [...tipeSet][0];
    kategori = t === 'INSTRUMENT' ? 'Instrumen' : t === 'SET' ? 'Set' : t === 'UNIT' ? 'Unit' : t;
  }

  let grandTotal = 0;
  S.clipboard.forEach(item => {
    const hargaPakai = S.modeSwastaOutput ? (item.harga_swasta || 0) : (item.harga_ekat || 0);
    grandTotal += hargaPakai * (item.qty || 1);
  });

  return { kategori, grandTotal };
}

function openRecordModal() {
  const namaRs = inpRs.value.trim() || 'RS';
  const namaSales = inpSales.value.trim() || 'Sales';
  const { kategori, grandTotal } = computeKonversiSummary();

  // Soft-gate: cuma nudge, gak nge-block. checklistPermintaanId keisi kalau
  // sesi ini udah pernah ada Permintaan RS (baru diisi ATAU dimuat ulang
  // lewat loadChecklistForSesi pas openSesi). Kalau kosong, kemungkinan besar
  // emang belum dicatat — 1x reminder di titik final ini nangkep kasus lupa.
  document.getElementById('pr-nudge').classList.toggle('show', !S.checklistPermintaanId);

  S.recTanggal.textContent = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
  S.recRs.textContent = namaRs;
  S.recSales.textContent = namaSales;
  S.recKategori.textContent = kategori;
  S.recValue.textContent = S.rupiah(grandTotal);
  S.recNotes.value = '';
  // Auto-filled dari link Drive sesi ini kalau udah pernah diupload (lihat
  // uploadKonversianToDrive) — JANGAN di-reset ke kosong, itu bikin link yang
  // baru aja didapat ilang lagi pas modal ini dibuka.
  S.recLink.value = S.lastDriveUrl || '';
  S.recordStatus.textContent = '';
  S.recordStatus.style.color = '';
  S.recordSubmitBtn.disabled = false;
  S.recordSubmitBtn.textContent = 'Kirim ke Sheet';
  S.recordSubmitBtn.dataset.retryRecordId = ''; // sesi/record baru — pastiin gak kebawa retry ID lama

  S.recordModal.classList.add('show');
}
S.openRecordModal = openRecordModal;

btnRecord.addEventListener('click', openRecordModal);
S.recordCancelBtn.addEventListener('click', () => S.recordModal.classList.remove('show'));
S.recordModal.addEventListener('click', (e) => { if (e.target === S.recordModal) S.recordModal.classList.remove('show'); });

// Klik "Isi Permintaan RS dulu" dari dalam nudge: pindah ke modal Permintaan RS,
// tandain biar abis submit balik lagi ke Record modal (bukan ilang ke layar lain).
S.resumeRecordAfterPr = false;
document.getElementById('pr-nudge-btn').addEventListener('click', () => {
  S.resumeRecordAfterPr = true;
  S.recordModal.classList.remove('show');
  S.openPrModal();
});

// ══════════════════════════════════════════
// DUAL WRITE: Supabase (konversi_record + konversi_item, granular, source
// of truth buat insight) dulu, baru Google Sheet (mirror, format lama tetap
// dipertahankan persis karena ada laporan lain yang gantung ke situ).
// Urutannya sengaja gak paralel: kalau Supabase gagal, seluruh operasi
// dianggap gagal (data belum "resmi" tercatat). Kalau cuma Sheet yang gagal,
// data tetap dianggap tersimpan — user bisa retry sync ke Sheet aja tanpa
// harus input ulang semuanya dari nol.
// ══════════════════════════════════════════
S.recordSubmitBtn.addEventListener('click', async () => {
  if (!inpMarsup.value.trim()) {
    S.recordStatus.textContent = 'Isi dulu nama PIC Marsup di panel clipboard.';
    S.recordStatus.style.color = 'var(--danger)';
    return;
  }

  const namaRs = inpRs.value.trim() || 'RS';
  const namaSales = inpSales.value.trim() || 'Sales';
  const { kategori, grandTotal } = computeKonversiSummary();
  const tanggalIso = new Date().toISOString().slice(0, 10);

  S.recordSubmitBtn.disabled = true;
  S.recordSubmitBtn.textContent = 'Menyimpan…';
  S.recordStatus.textContent = '';

  // ── FIX bug lama: "Coba Sync ke Sheet Lagi" dulu selalu lari ulang dari
  // Tahap 1, jadi tiap klik retry bikin konversi_record + konversi_item
  // BARU (duplikat), padahal cuma Tahap 2 (Sheet) yang gagal. Sekarang:
  // kalau retryRecordId udah keisi (dari kegagalan Tahap 2 sebelumnya),
  // Tahap 1 di-SKIP total — reuse ID lama, langsung lanjut Tahap 2 aja. ──
  const retryRecordId = S.recordSubmitBtn.dataset.retryRecordId || '';
  let newRecordId = retryRecordId || null;

  if (!retryRecordId) {
  // ---- Tahap 1: Supabase (fondasi, wajib sukses) ----
  try {
    // Cek dulu apakah sesi ini udah pernah kerekam sebelumnya (mis. sesi lama
    // yang di-reopen dari tab Riwayat lalu diubah lagi). Kalau iya, ini
    // dianggap REVISI: record baru tetap di-INSERT (bukan nimpa yang lama —
    // biar histori tiap versi kesimpen lengkap), tapi dikasih nomor revisi
    // yang naik dari yang terakhir.
    let revisiKe = 0;
    if (S.currentSesiId) {
      try {
        const cekRes = await S.sesiFetch(`konversi_record?sesi_id=eq.${S.currentSesiId}&select=revisi&order=revisi.desc&limit=1`);
        if (cekRes.ok) {
          const cekRows = await cekRes.json();
          if (cekRows.length) revisiKe = (cekRows[0].revisi || 0) + 1;
        }
      } catch { /* gagal cek → anggap revisi 0, fallback aman (bukan blocking) */ }
    }

    const recordBody = {
      sesi_id: S.currentSesiId || null,
      permintaan_id: S.checklistPermintaanId || null,
      tanggal: tanggalIso,
      nama_rs: namaRs,
      pic_sales: namaSales,
      pic_marsup: inpMarsup.value.trim(),
      pagu_total: (typeof S.checklistPagu !== 'undefined' ? S.checklistPagu : null),
      kategori: kategori,
      grand_total: grandTotal,
      revisi: revisiKe,
      notes: S.recNotes.value.trim(),
      link: S.recLink.value.trim(),
      synced_to_sheet: false
    };

    const recRes = await S.sesiFetch('konversi_record', {
      method: 'POST',
      headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify(recordBody)
    });
    if (!recRes.ok) {
      const errData = await recRes.json().catch(() => ({}));
      throw new Error(errData.message || errData.hint || 'Gagal menyimpan header konversi_record');
    }
    const recRows = await recRes.json();
    newRecordId = recRows[0].id;

    // Detail per item — ini yang bikin data granular buat insight nanti
    // (produk apa yang sering INDENT, revenue per kategori/produk, dst).
    const itemRows = S.clipboard.map(item => {
      const hargaPakai = S.modeSwastaOutput ? (item.harga_swasta || 0) : (item.harga_ekat || 0);
      return {
        konversi_record_id: newRecordId,
        produk_id: item.produk_id || null,
        kode_produk: item.kode_produk,
        nama_produk: item.nama_produk,
        qty: item.qty || 1,
        harga: hargaPakai
      };
    });

    if (itemRows.length) {
      const itemRes = await S.sesiFetch('konversi_item', {
        method: 'POST',
        body: JSON.stringify(itemRows)
      });
      if (!itemRes.ok) {
        const errData = await itemRes.json().catch(() => ({}));
        throw new Error(errData.message || errData.hint || 'Record tersimpan, tapi detail item gagal (cek konversi_item)');
      }
    }

    // Sesi ini selesai → keluar dari daftar "Konversi Berjalan". Kalau ada
    // checklist Permintaan RS yang nempel, rekap pemenuhannya ikut
    // dipastikan tersimpan di langkah yang sama.
    if (S.currentSesiId) {
      S.sesiFetch(`${S.SESI_TABLE}?id=eq.${S.currentSesiId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'selesai', updated_at: new Date().toISOString() })
      }).catch(() => {});
      // currentSesiId SENGAJA tetap dipertahankan (bukan di-null-in) — kalau
      // langsung di-null, Export yang diklik tepat setelah Record kehilangan
      // pegangan buat ngecek nomor revisi (jadi filename-nya balik polos tanpa
      // -REVx). Sesi tetap "kepegang" di layar sampai user eksplisit klik
      // "Mulai Sesi Baru" atau buka sesi lain — statusnya sendiri udah 'selesai'
      // di server, jadi tetap gak nyangkut di daftar "Konversi Berjalan".
      S.updateEndSesiBtnState();
      loadSesiList();
      if (S.subtabRiwayat.classList.contains('active')) loadRiwayatList();
    }
    if (S.checklistPermintaanId) {
      S.autoFinalizePermintaan().catch(() => {});
    }

    S.recordStatus.textContent = (revisiKe > 0 ? `Tersimpan sebagai REV${revisiKe} ✓` : 'Tersimpan ✓') + ' — menyinkronkan ke Sheet…';
    S.recordStatus.style.color = 'var(--success)';
  } catch (err) {
    S.recordStatus.textContent = 'Gagal: ' + err.message;
    S.recordStatus.style.color = 'var(--danger)';
    S.recordSubmitBtn.disabled = false;
    S.recordSubmitBtn.textContent = 'Kirim ke Sheet';
    return; // stop total — fondasi gagal, jangan lanjut ke sheet
  }
  } else {
    // Retry: Tahap 1 udah pernah sukses (record id: newRecordId), langsung
    // lompat ke Tahap 2 tanpa insert apa pun lagi.
    S.recordStatus.textContent = 'Menyinkronkan ulang ke Sheet…';
    S.recordStatus.style.color = 'var(--success)';
  }

  // ---- Tahap 2: Google Sheet (mirror, format tetap sama persis) ----
  // keyword/rekanan/customer/distributor sengaja diisi nilai yang sama —
  // itu format yang sudah dipakai sheet lain yang gantung ke kolom ini,
  // jadi TIDAK diubah.
  const sheetPayload = {
    tanggal: tanggalIso,
    pic_marsup: inpMarsup.value.trim(),
    pic_sales: namaSales,
    keyword: namaRs,
    rekanan: namaRs,
    customer: namaRs,
    distributor: namaRs,
    kategori: kategori,
    value: grandTotal,
    notes: S.recNotes.value.trim(),
    link: S.recLink.value.trim(),
    // Idempotency key buat dedupe di sisi Apps Script (lihat RecordKonversi.gs).
    // newRecordId STABIL di seluruh percobaan retry sesi ini — "Coba Sync ke
    // Sheet Lagi" reuse ID yang sama, gak pernah insert record baru ke
    // Supabase (lihat retryRecordId di atas), jadi aman dipakai buat nyocokin
    // "request ini udah pernah beneran nyampe & keproses di Sheet apa belum".
    record_id: newRecordId || null
  };

  try {
    const uploadToken = await getFreshToken();
    if (!uploadToken || uploadToken === ANON_KEY) throw new Error('Sesi login sudah habis / belum login — silakan login ulang dulu.');
    const res = await fetch(SHEETS_PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + uploadToken
      },
      body: JSON.stringify({ target: 'konversi', data: sheetPayload })
    });
    // Apps Script kadang balikin halaman HTML (bukan JSON) walau row-nya SUDAH
    // kesimpen di Sheet — biasanya karena ada kode SETELAH appendRow() di
    // doPost yang throw exception gak ke-catch, jadi Google keburu ngasih
    // halaman error bawaan sebelum sempat return JSON. Makanya res.json()
    // langsung dipanggil bisa gagal padahal datanya udah nyangkut. Baca
    // sebagai text dulu biar bisa kasih pesan yang jujur soal ini, bukan
    // "Unexpected token" yang bikin orang kira datanya ilang.
    const rawText = await res.text();
    let result;
    try {
      result = JSON.parse(rawText);
    } catch {
      const looksLikeHtml = /^\s*<(!doctype|html)/i.test(rawText);
      throw new Error(
        (looksLikeHtml
          ? 'Apps Script balikin halaman HTML, bukan JSON (kemungkinan besar ada error di script SETELAH baris tersimpan — cek Apps Script > Executions buat lihat detail errornya).'
          : 'Respons Apps Script gak valid: ' + rawText.slice(0, 120))
        + ' PENTING: baris ini kemungkinan SUDAH masuk ke Sheet meski response-nya error — cek Sheet dulu sebelum klik "Coba Sync ke Sheet Lagi", biar gak ke-duplikat.'
      );
    }
    if (!result.ok) throw new Error(result.error || 'Gagal menyimpan ke sheet');

    if (newRecordId) {
      S.sesiFetch(`konversi_record?id=eq.${newRecordId}`, {
        method: 'PATCH',
        body: JSON.stringify({ synced_to_sheet: true })
      }).catch(() => {});
    }

    S.recordStatus.textContent = 'Berhasil dicatat & disinkronkan ke Sheet ✓';
    S.recordStatus.style.color = 'var(--success)';
    S.recordSubmitBtn.dataset.retryRecordId = '';
    setTimeout(() => S.recordModal.classList.remove('show'), 1200);
  } catch (err) {
    // Sheet gagal BUKAN berarti semuanya gagal — data sudah aman di Supabase.
    S.recordStatus.textContent = 'Tersimpan di sistem ✓, tapi gagal sync ke Sheet: ' + err.message;
    S.recordStatus.style.color = 'var(--danger)';
    S.recordSubmitBtn.disabled = false;
    S.recordSubmitBtn.textContent = 'Coba Sync ke Sheet Lagi';
    S.recordSubmitBtn.dataset.retryRecordId = newRecordId || '';
  }
});

// ══════════════════════════════════════════
// MODUL STOK: login ringan, parse Excel, upload (full replace),
// dan integrasi tampilan/sort stok ke hasil search
// ══════════════════════════════════════════

// Upload/timpa stok sekarang jadi modul mandiri di stok.html (Modul 03 di
// index) — divisi lain gak perlu lagi buka Konversian buat update stok
// harian. Konversian tetap butuh status stok buat badge READY/INDENT di
// hasil search, jadi bagian read-only (enrichResultsWithStok) di bawah ini
// TETAP ada, cuma bagian upload/timpa-nya yang dipindah.

// ---- Ambil status stok buat semua kode_asli yang muncul di hasil search ----
// NOTE: SET gak punya baris di stok_produk (stoknya ditentukan dari komponen),
// makanya dipisah query-nya: item biasa pakai v_stok_status (kode_asli), SET
// pakai v_stok_status_set (kode_produk milik SET itu sendiri), lalu digabung
// balik ke object `results` yang sama supaya badge/sort/export di hilir gak
// perlu tau bedanya — cukup baca r.stok_status & r.stok_qty seperti biasa.
async function enrichResultsWithStok(results) {
  const nonSet = results.filter(r => !(r.tipe && r.tipe.toUpperCase() === 'SET'));
  const setItems = results.filter(r => r.tipe && r.tipe.toUpperCase() === 'SET');

  await Promise.all([
    enrichNonSetStok(nonSet),
    enrichSetStok(setItems)
  ]);
}
S.enrichResultsWithStok = enrichResultsWithStok;

async function enrichNonSetStok(results) {
  const kodeAsliList = [...new Set(results.map(r => r.kode_asli).filter(Boolean))];
  if (kodeAsliList.length === 0) return;

  try {
    const inList = kodeAsliList.map(k => `"${k.replace(/"/g,'')}"`).join(',');
    const res = await S.sesiFetch(`v_stok_status?kode_asli=in.(${inList})&select=kode_asli,qty,status`);
    if (!res.ok) return; // kalau gagal, biarin badge stok gak muncul, jangan blokir search
    const stokData = await res.json();
    const stokMap = new Map(stokData.map(s => [s.kode_asli, s]));

    results.forEach(r => {
      const s = r.kode_asli ? stokMap.get(r.kode_asli) : null;
      r.stok_qty = s ? s.qty : null;
      r.stok_status = s ? s.status : null; // null = belum ada data stok sama sekali buat kode ini
    });
  } catch { /* diamkan, stok cuma nice-to-have di tampilan search */ }
}

// ---- Ambil status stok rakitan buat semua produk tipe SET (bottleneck komponen) ----
async function enrichSetStok(results) {
  const kodeSetList = [...new Set(results.map(r => r.kode_produk).filter(Boolean))];
  if (kodeSetList.length === 0) return;

  try {
    const inList = kodeSetList.map(k => `"${k.replace(/"/g,'')}"`).join(',');
    const res = await S.sesiFetch(`v_stok_status_set?kode_produk=in.(${inList})&select=kode_produk,buildable_qty,status,jumlah_komponen,jumlah_komponen_terdata`);
    if (!res.ok) return;
    const stokData = await res.json();
    const stokMap = new Map(stokData.map(s => [s.kode_produk, s]));

    results.forEach(r => {
      const s = stokMap.get(r.kode_produk);
      r.stok_qty = s ? s.buildable_qty : null;         // dipakai bareng field yang sama kayak item biasa
      r.stok_status = s ? s.status : 'DATA_TIDAK_LENGKAP'; // gak ada baris di view = komponen blm ke-cek sama sekali
      r.stok_komponen_terdata = s ? s.jumlah_komponen_terdata : 0;
      r.stok_komponen_total = s ? s.jumlah_komponen : null;
    });
  } catch { /* diamkan, stok cuma nice-to-have di tampilan search */ }
}

// ══════════════════════════════════════════
// MODUL CONVERTER: paste daftar "kode<TAB>nama" (kode asli & deskripsi dari RS),
// dicocokkan EXACT ke katalog (lewat RPC search_produk_dengan_harga per kode —
// gak perlu RPC baru, tinggal exact-filter hasilnya di JS), lalu produk yang
// cocok langsung bisa ditambahkan ke clipboard sesi aktif seperti klik hasil
// pencarian biasa. Ujungnya tetap pakai alur Export/Record yang sudah ada.
// (Elemen convInput..btnConvAddAll & S.convRows dideklarasikan lebih awal,
// sebelum installSearch(S) — lihat BUGFIX 2026-09-15 di atas dekat
// installClipboard(S)/installSearch(S).)
// ══════════════════════════════════════════

// ══════════════════════════════════════════
// RESOLVE MANUAL BUAT BARIS YANG GAK KETEMU (2026-08-22): sebelum ini, baris
// "❌ Tidak ditemukan" / "🔄 Error" itu dead-end — checkbox-nya disabled dan
// gak ada jalan lain selain pindah tab buat cari manual, kehilangan konteks
// batch paste yang lagi dikerjain. Sekarang baris begitu jadi accordion
// (reuse .kb-item/.kb-item-header dari Kebutuhan RS, biar konsisten & gak
// nambah CSS baru buat struktur), auto-expanded pas hasil pertama kali keluar,
// isinya search manual ke katalog (RPC yang sama kayak search utama) — pilih
// hasil langsung nge-update row itu jadi 'manual_matched' tanpa keluar dari
// Converter. — Claude
// ══════════════════════════════════════════
S.convExpandedIdx = new Set();   // idx baris yang accordion-nya lagi kebuka
S.convManualResults = {};        // idx -> null | {loading:true} | {items:[...]} | {error:msg}
S.convManualQuery = {};          // idx -> teks yang lagi diketik, biar gak ilang pas re-render
S.convManualTimers = {};         // idx -> setTimeout handle (debounce input)
S.convManualSeq = {};            // idx -> counter, buang response basi kalau user ngetik cepat

function parseConverterLine(line) {
  const idx = line.indexOf('\t');
  if (idx !== -1) {
    return { kode: line.slice(0, idx).trim(), nama_input: line.slice(idx + 1).trim() };
  }
  // Fallback kalau tab kepencet jadi spasi pas paste (1 spasi pun cukup) —
  // aman karena kode produk kita gak pernah punya spasi di dalamnya.
  const m = line.match(/^(\S+)\s+(.+)$/);
  if (m) return { kode: m[1].trim(), nama_input: m[2].trim() };
  return { kode: line.trim(), nama_input: '' };
}
S.parseConverterLine = parseConverterLine;

// Badge/warna/sub-caption per status — satu titik dipakai baris compact
// (produk ketemu) maupun baris accordion (produk gak ketemu), biar teksnya
// gak keulang nulis beda-beda di dua tempat.
function convStatusMeta(r) {
  if (r.status === 'exact') return { badge: '✅ Cocok', color: 'var(--success)' };
  if (r.status === 'manual_matched') return { badge: '✅ Dipilih manual', color: 'var(--success)' };
  if (r.status === 'code_found_name_diff') return { badge: '⚠️ Kode ketemu, nama beda', color: 'var(--warning)' };
  if (r.status === 'error') return { badge: '🔄 Error / timeout — belum sempat dicek', color: 'var(--warning)' };
  if (r.notFirm) return { badge: '⛔ Belum firm (link V6 ada catatan) — tidak dipakai', color: 'var(--danger)' };
  return { badge: '❌ Tidak ditemukan', color: 'var(--danger)' };
}

// Hasil pencarian manual buat baris ke-i, dirender di dalam accordion.
function convManualResultsHtml(i) {
  const st = S.convManualResults[i];
  if (!st) return '';
  if (st.loading) return `<div class="conv-manual-status">Mencari…</div>`;
  if (st.error) return `<div class="conv-manual-status">Gagal mencari: ${S.escapeHtmlAttr(st.error)}</div>`;
  if (!st.items.length) return `<div class="conv-manual-status">Tidak ada hasil.</div>`;
  return st.items.map(p => `<div class="conv-manual-row">
    <div class="conv-manual-row-info">
      <span class="conv-manual-row-nama">${S.escapeHtmlAttr(p.nama_produk)}</span>
      <span class="conv-manual-row-kode">${S.escapeHtmlAttr(p.kode_produk)}</span>
    </div>
    <button type="button" class="conv-manual-pick" data-idx="${i}" data-kode="${S.escapeHtmlAttr(p.kode_produk)}">Pilih</button>
  </div>`).join('');
}

// Satu baris hasil Converter. Kalau produk-nya ketemu (exact/nama beda/manual),
// tampil compact kayak semula. Kalau enggak (not_found/error), jadi accordion
// (.kb-item, reuse style dari Kebutuhan RS) yang bisa dibuka buat search manual.
function convRowHtml(r, i) {
  const meta = convStatusMeta(r);
  const nama = r.produk ? r.produk.nama_produk : (r.nama_input || '(tanpa nama)');
  // Badge stok cuma relevan buat baris yang udah cocok ke katalog (r.produk
  // keisi) — datanya sendiri udah ADA sejak finishConvBatch() manggil
  // enrichResultsWithStok() abis batch selesai diproses (lihat search.js),
  // cuma belum ditampilin di sini. stokBadgeHtml() sama persis yang dipakai
  // Cari Cepat (lihat clipboard.js), biar Converter bisa dipakai serbaguna:
  // sekalian compile-gambar (Copy + Gambar) MAUPUN cek stok bulk dari satu
  // paste kode, tanpa perlu pindah ke tab Cari Cepat satu-satu.
  const isSet = r.produk && r.produk.tipe && r.produk.tipe.toUpperCase() === 'SET';
  const stokBadge = r.produk ? S.stokBadgeHtml(r.produk, isSet) : '';
  const metaLine = `<div class="clip-item-meta">
    <span class="clip-item-code">${S.escapeHtmlAttr(r.kode)}</span>
    <span style="color:${meta.color};font-size:11px">${meta.badge}</span>
    ${stokBadge}
  </div>`;

  if (r.produk) {
    const sub = r.status === 'code_found_name_diff'
      ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">Input: "${S.escapeHtmlAttr(r.nama_input)}" · Katalog: "${S.escapeHtmlAttr(r.produk.nama_produk)}"</div>`
      : '';
    return `<div class="clip-item" style="align-items:flex-start" data-idx="${i}">
      <input type="checkbox" class="conv-check" data-idx="${i}" checked style="margin-top:4px"/>
      <div class="clip-item-info" style="margin-left:8px">
        <div class="clip-item-name">${S.escapeHtmlAttr(nama)}</div>
        ${metaLine}
        ${sub}
      </div>
    </div>`;
  }

  const isExpanded = S.convExpandedIdx.has(i);
  const cls = 'kb-item tidak-terpenuhi' + (isExpanded ? ' expanded' : ' collapsed');
  const errSub = r.status === 'error' ? `<div class="kb-item-sub">${S.escapeHtmlAttr(r.errMsg || '')}</div>` : '';
  const headerHtml = `<div class="kb-item-header" data-action="conv-toggle" data-idx="${i}">
    <input type="checkbox" class="conv-check" data-idx="${i}" disabled style="margin-top:2px"/>
    <div class="kb-item-header-text">
      <div class="kb-item-text">${S.escapeHtmlAttr(nama)}</div>
      ${metaLine}
    </div>
    <i class="ti ti-chevron-down kb-item-chevron"></i>
  </div>`;
  const detailHtml = isExpanded ? `<div class="kb-item-detail">
    ${errSub}
    <div class="conv-manual-search">
      <input type="text" class="conv-manual-input" data-idx="${i}" placeholder="Cari produk yang benar di katalog…" value="${S.escapeHtmlAttr(S.convManualQuery[i] || '')}" autocomplete="off"/>
      <div class="conv-manual-results" data-idx="${i}">${convManualResultsHtml(i)}</div>
    </div>
  </div>` : '';

  return `<div class="${cls}" data-idx="${i}">${headerHtml}${detailHtml}</div>`;
}

function renderConvResults(rows) {
  convResultsEl.innerHTML = rows.map((r, i) => convRowHtml(r, i)).join('');
}
S.renderConvResults = renderConvResults;

// Patch 1 baris aja (dipanggil abis toggle expand / hasil search manual masuk
// / pilih produk manual) — gak perlu re-render seluruh daftar tiap kali,
// dan kalau lagi ngetik di search manual, inputnya gak kehilangan fokus tiap
// hasil baru datang. Mirip pola patchChecklistItem() di Kebutuhan RS.
function patchConvRow(i, opts = {}) {
  const old = convResultsEl.querySelector(`[data-idx="${i}"]`);
  if (!old || !S.convRows[i]) { renderConvResults(S.convRows); return; }
  const temp = document.createElement('div');
  temp.innerHTML = convRowHtml(S.convRows[i], i);
  const fresh = temp.firstElementChild;
  old.replaceWith(fresh);
  if (opts.keepFocus) {
    const inp = fresh.querySelector('.conv-manual-input');
    if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
  }
}
S.patchConvRow = patchConvRow;

// Ringkasan status (teks "Selesai — N cocok…" + tombol Tambah/Proses Ulang)
// — dipisah dari finishConvBatch() biar bisa dipanggil ulang abis user
// nyelesein satu baris lewat search manual, tanpa harus re-match semua baris.
function updateConvSummary() {
  const rows = S.convRows;
  const foundProduk = rows.filter(r => r.produk).map(r => r.produk);
  const nExact = rows.filter(r => r.status === 'exact').length;
  const nDiff = rows.filter(r => r.status === 'code_found_name_diff').length;
  const nManual = rows.filter(r => r.status === 'manual_matched').length;
  const nErr = rows.filter(r => r.status === 'error').length;
  const nNotFound = rows.filter(r => r.status === 'not_found').length;
  // Ringkasan stok, biar "paste daftar kode → langsung kelihatan mana yang
  // Ready/Indent" (cek stok bulk) gak perlu scroll baca badge satu-satu.
  // Cuma ngitung baris yang udah cocok (foundProduk) — baris not_found/error
  // gak punya data stok buat dihitung.
  const nReady = foundProduk.filter(p => p.stok_status === 'READY').length;
  const nIndent = foundProduk.filter(p => p.stok_status === 'INDENT').length;
  const stokSummary = foundProduk.length
    ? ` · Stok: ${nReady} ready, ${nIndent} indent${foundProduk.length - nReady - nIndent ? `, ${foundProduk.length - nReady - nIndent} belum ada data` : ''}`
    : '';
  convStatus.textContent = `Selesai — ${nExact} cocok penuh, ${nDiff} kode ketemu (nama beda)`
    + (nManual ? `, ${nManual} dipilih manual` : '')
    + `, ${nNotFound} tidak ditemukan`
    + (nErr ? `, ${nErr} error/timeout (klik "Proses Ulang yang Error").` : '.')
    + stokSummary;
  convActions.style.display = foundProduk.length ? 'block' : 'none';
  btnConvRetryErr.style.display = nErr ? 'inline-flex' : 'none';
}
S.updateConvSummary = updateConvSummary;

// Cari manual ke katalog buat baris ke-i, RPC sama kayak search utama biar
// hasilnya konsisten (harga/stok/link_v6 dst ikut ke-resolve pas dipilih).
async function convManualSearch(i, qRaw) {
  const q = qRaw.trim();
  if (!q) { S.convManualResults[i] = null; patchConvRow(i, { keepFocus: true }); return; }
  const mySeq = (S.convManualSeq[i] = (S.convManualSeq[i] || 0) + 1);
  S.convManualResults[i] = { loading: true };
  patchConvRow(i, { keepFocus: true });
  const { data, error } = await S.rpc('search_produk_dengan_harga', { q, p_tipe: null, only_akd: false, only_kfa: false });
  if (mySeq !== S.convManualSeq[i]) return; // udah ada ketikan baru nyusul, buang hasil basi ini
  S.convManualResults[i] = error
    ? { error: error.message || JSON.stringify(error) }
    : { items: S.filterFirm(data || [], S.modeSwastaOutput).slice(0, 6) }; // sinyal kontekstual, bukan halaman browse penuh
  patchConvRow(i, { keepFocus: true });
}
S.convManualSearch = convManualSearch;

  installPermintaanRs(S);
  installDictionary(S);
  installSetMendekati(S);
  installSph(S);

  // Restore the sub-tab the URL asked for (e.g. a refresh/direct-link on
  // /konversian/dictionary) -- mount() used to accept `initialSub` but never
  // actually applied it, so a fresh mount always landed on whatever
  // switchSubTab defaults to (Cari Produk), same class of bug crud-produk's
  // mount() already guards against via `switchView(initialSub || 'produk')`.
  switchSubTab(initialSub || 'cari');
}

/** Dipanggil router.js tiap kali URL sub-route berubah TANPA modul-nya
 * ikut berubah (user klik dari satu sub-tab konversian ke sub-tab lain
 * LEWAT sidebar accordion global, bukan lewat baris subtab bawaan
 * halaman ini yang tetap ada) -- lihat router.js's render() + switchView()
 * yang sama persis di crud-produk/index.js buat pola yang identik. */
export function setSubroute(sub) {
  _switchSubTab?.(sub || 'cari');
}

export function unmount() {
  const bridge = window.__konvBridge;
  if (bridge) {
    try { bridge.authUnsub?.(); } catch (err) { console.error('unmount konversian: authUnsub gagal', err); }
    try { bridge.sesiCountCleanup?.(); } catch (err) { console.error('unmount konversian: sesiCountCleanup gagal', err); }
    if (bridge.dismissAcOnOutsideClick) document.removeEventListener('click', bridge.dismissAcOnOutsideClick);
    if (bridge.updateOnlineStatus) {
      window.removeEventListener('online', bridge.updateOnlineStatus);
      window.removeEventListener('offline', bridge.updateOnlineStatus);
    }
    try { bridge.unsubscribeFromSesiRealtime?.(); } catch (err) { console.error('unmount konversian: unsubscribeFromSesiRealtime gagal', err); }
  }
  try { window.convFlow?._cleanup?.(); } catch (err) { console.error('unmount konversian: convFlow cleanup gagal', err); }

  // Dua modal ini di-inject langsung ke document.body (bukan container) oleh
  // setupSphRiwayatModal()/setupKonversiRiwayatModal() — kalau gak dihapus
  // di sini, mereka nyisa nempel ke body walau halaman ini udah di-unmount.
  document.getElementById('sph-riwayat-modal')?.remove();
  document.getElementById('konversi-riwayat-modal')?.remove();

  // UPDATE (jank fix, reverses the "Lepas pnm-universal.css" call this
  // comment used to describe): that removal was originally added to stop
  // pnm-universal.css's bare/unscoped selectors (header{}, .stat-val, tr/td
  // rules -- see map.md sesi keenam) leaking into whatever OTHER page
  // mounted next, back when konversian was the only module using the
  // stylesheet at all. That's no longer true -- dashboard/stok/crud-produk/
  // kompres-pdf/export-gambar have since all been migrated onto the same
  // pnm-universal.css themselves (same id, same href, same version), so
  // every routed page today already expects these rules; there's no longer
  // a page for it to leak INTO. Meanwhile the remove-then-reload on every
  // single navigation was its own bug: the OLD page's markup stays on
  // screen (unmount() doesn't clear it) for the async gap until the NEW
  // page's mount() finishes reloading this file, so during that gap the
  // still-visible old page would visibly lose its styling and snap back --
  // read as a slight "zoom" jump on every module switch. It's now a
  // permanent <link> loaded once by shell.html/index.html instead (see the
  // shared-pnm-universal-css comment there), same treatment Google Fonts/
  // Tabler icons already had.

  delete window.__konvBridge;
  delete window.switchTab;
  delete window.openLinkGenModal;
  delete window.convFlow;
  delete window.sphFlow;
  _switchSubTab = null; // avoid a stale closure over this mount's DOM being callable after teardown
  mountedContainer = null;
}