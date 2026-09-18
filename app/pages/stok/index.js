// stok page module: mount(container) / unmount().
// Per map.md bagian 4 urutan #6 -- SATU-SATUNYA sisa halaman. Beda dari 5
// halaman lain yang sudah dimigrasi: stok.html masih inline <script> (belum
// kepisah dari HTML-nya), jadi sesi ini juga ngerjain langkah restrukturisasi
// itu sekaligus (markup.js dipisah dari script, persis pola halaman lain).
//
// Dibangun SESUDAH shared nav (app/pages/nav/) sudah wired in, jadi
// pendekatannya ngikutin dashboard/index.js (halaman pertama yang dibangun
// langsung pakai pw-topbar), BUKAN pola konversian/crud-produk yang lebih
// tua (dobel sidebar/topbar internal belum dibersihin -- lihat map.md).
// Artinya: design.md checklist step 1 (structural: shared topbar) + step 7
// (wire-up logic) dikerjain sesi ini, TAPI BUKAN step 2-6 (token warna/
// spacing/icon/status-dot) -- konten card/table di dalam halaman ini MASIH
// pakai class pnm-universal.css yang lama, sama scope limit yang dashboard
// ambil (lihat komentar di dashboard/index.js buat alasan yang sama).
//
// AUTH: file asli (inline <script> di stok.html) SAMA SEKALI GAK PAKAI SDK
// Supabase -- persis pola dashboard.js asli: raw fetch() manual ke
// /auth/v1/token, token & refresh_token disimpan manual di localStorage
// (key pnm_auth_session -- KEBETULAN nama key-nya SAMA PERSIS dengan yang
// dipakai shared/supabase-client.js sekarang, jadi user yang lagi login di
// versi lama otomatis kebaca sesinya di sini, gak perlu re-login massal),
// email di-decode manual dari JWT. SELURUH auth layer di bawah diganti ke
// PNMAuth.*, sama besar perubahannya kayak dashboard punya.
//
// document.getElementById(...) TIDAK di-rescope ke container.querySelector
// (sama kayak semua halaman lain yang sudah dimigrasi) -- aman selama cuma
// satu halaman yang termount di satu waktu, dijamin router.js.
//
// TIDAK ADA inline onclick/onchange/oninput di markup aslinya (semua wiring
// addEventListener di script) -- jadi TIDAK ADA fungsi yang perlu diekspos
// ke window.* di sini, beda dari dashboard/crud-produk yang markupnya penuh
// onclick="..." lama.
//
// window.PNM_SUPABASE_URL/window.PNM_SUPABASE_ANON_KEY dipakai (bukan const
// SUPABASE_URL/ANON_KEY yang di-duplicate ulang di file ini) -- ini
// menuntaskan item checklist map.md yang secara eksplisit nyebut stok.html
// sebagai salah satu dari 2 file yang masih nge-declare ulang
// `const SUPABASE_URL = ...` (lihat map.md bagian 1). Diisi di dalam
// mount() setelah ensureVendorScripts() resolve (bukan di module scope --
// window.PNM_SUPABASE_URL belum ada di titik module ini di-import() router,
// sama alasan kenapa `const sb = window.pnmSupabase` juga gak boleh di
// module scope, lihat map.md checklist).

import { STOK_MARKUP } from './markup.js';

// SECURITY FIX: renderSkipTable() and the upload-history table below render
// `kode_asli` (parsed straight from cells in the Excel file the user
// uploads) and `fileName` (the uploaded file's own File.name) into
// innerHTML with no escaping. Both are fully attacker/user-controlled --
// a spreadsheet cell or a renamed file like `<img src=x onerror=...>`
// would execute as real HTML/JS the moment it's rendered, with this app's
// own session (same class of bug as kompres-pdf/export-gambar — see those
// files' comments for the full rationale). Used at every such
// interpolation point below.
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const VENDOR_CHAIN = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  '/shared/supabase-client.js',
  '/shared/auth-session.js',
];
// UPDATE (CSP fix): exceljs DIGANTI ke SheetJS (xlsx). exceljs.min.js@4.3.0
// nyeret dependency fast-csv -> extend -> declare.js yang manggil
// `new Function(...)` di module-init-nya (dipakai buat fitur CSV yang
// halaman ini gak pernah pakai sama sekali -- cuma baca .xlsx lewat
// .xlsx.load()) -- ke-block sama CSP script-src situs ini yang gak punya
// 'unsafe-eval' (lihat exceljs/exceljs#713 di GitHub, masih open, gak ada
// fix resmi). Efeknya BUKAN error yang keliatan pas load: script-nya
// "berhasil" di-load (makanya loadScript()'s onload tetep fire), tapi
// window.ExcelJS ke-assign gak lengkap karena crash di tengah init --
// baru ketauan pas dipakai (`Cannot read properties of undefined
// (reading 'Workbook')`). SheetJS gak punya masalah ini buat baca .xlsx
// polos kayak file stok ini (gak butuh CSV/eval-based codepath).
const INDEPENDENT_SCRIPTS = [
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
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
  if (window.PNMAuth && window.pnmSupabase && window.XLSX) return Promise.resolve();
  if (!vendorReady) {
    const chain = VENDOR_CHAIN.reduce((p, src) => p.then(() => loadScript(src)), Promise.resolve());
    vendorReady = Promise.all([chain, ...INDEPENDENT_SCRIPTS.map(loadScript)]);
  }
  return vendorReady;
}

// shared-google-fonts: id+href SAMA PERSIS kayak dashboard/index.js --
// stok.html asli kebetulan pakai font-family:'Inter' di CSS-nya tapi TIDAK
// PERNAH benar-benar load webfont-nya (gak ada <link> Google Fonts sama
// sekali di <head> aslinya, jadi diam-diam fallback ke system-ui).
// shared-phosphor-icons DIHAPUS dari sini (icon-library convergence pass):
// stok's markup/index.js no longer uses any ph-* class -- every icon was
// switched to the ti-* (Tabler) set the shared sidebar nav and most other
// modules already use, so loading Phosphor here was pure dead weight (a
// whole second icon webfont fetched for zero glyphs actually rendered).
// pnm-universal.css: pola sama kayak halaman lain (load di mount(), lepas
// di unmount(), bukan "shared selamanya").
const SHARED_LINKS = [
  { id: 'shared-google-fonts', href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400&display=swap' },
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
    link.onerror = () => resolve();
    document.head.appendChild(link);
  });
}

// SPA migration note: stok.html asli punya <style> sendiri (bukan file .css
// terpisah, langsung inline di <head>) -- TAPI setiap class di dalamnya
// (.auth-gate, .dropzone, .stat-pill, .skip-panel, .activity-table, dst,
// termasuk :root token block-nya) SUDAH ada, sudah digabung, di
// pnm-universal.css (lihat komentar "Digabung dari: ... stok.html (inline)"
// di kepala file itu). Dicek class-per-class sebelum nulis ini, bukan
// asumsi. SENGAJA TIDAK nyalin :root token block stok.html yang lama ke
// mana pun -- itu bakal jadi override :root global yang bocor ke SEMUA
// halaman lain begitu pernah dimuat (beda dari pnm-universal.css punya,
// yang dilepas lagi pas unmount()), persis kelas bug "token-leak" yang
// komentar nav.css bilang udah ketemu & difix pas nav dibangun.
//
// UPDATE (sesi retrofit design.md, sesudah dashboard): sekarang ADA
// style.css di folder ini -- design.md steps 2-6 (lihat file itu). Sama
// kayak dashboard, ini page-scoped OVERRIDE (di bawah `#app-root`, bukan
// `:root`), jadi peringatan token-leak di atas TETAP dihormati -- custom
// property baru (--success-dot dkk) di-scope ke selector `#app-root`
// (element ID), bukan `:root` (global), gak bakal bocor ke halaman lain.
function ensureStyle() {
  return Promise.all([
    ...SHARED_LINKS.map(({ id, href }) => loadLink(id, href)),
    loadLink('page-stok-style', new URL('./style.css', import.meta.url).href),
  ]);
}

let mountedContainer = null;
let SUPABASE_URL = null;
let ANON_KEY = null;

// State upload/precheck & identitas user yang lagi login -- di-reset di
// awal tiap mount() (bukan cuma dideklarasikan sekali), soalnya mount() bisa
// kepanggil berkali-kali sepanjang satu page load yang sama tiap kali user
// hash-navigate balik ke #stok; kalau gak direset, sisa state upload dari
// kunjungan sebelumnya bisa nongol lagi sebelum user pilih file baru.
let stokCurrentEmail = null;
let sharedHistoryAvailable = null;
let historyShowAll = false;
let currentFileName = null;
let stokParsedRows = null;
let stokMatchedRows = null;
let stokSkippedRows = null;

const HISTORY_KEY = 'pnm_stok_upload_history';

export async function mount(container) {
  mountedContainer = container;
  await Promise.all([ensureStyle(), ensureVendorScripts()]);
  SUPABASE_URL = window.PNM_SUPABASE_URL;
  ANON_KEY = window.PNM_SUPABASE_ANON_KEY;
  container.innerHTML = STOK_MARKUP;

  // theme-init: sama pola kayak dashboard/index.js -- stok.html asli nyetel
  // tema SENDIRI (applyTheme(getStoredTheme()) dipanggil begitu script
  // jalan, key localStorage 'pnm_theme'). Toggle-nya sendiri DIHAPUS TOTAL
  // (lihat markup.js) -- shared nav sekarang satu-satunya pemilik theming,
  // dan nav pakai key 'theme' (bukan 'pnm_theme' punya stok yang lama) buat
  // konsisten sama semua halaman lain. Baris ini cuma jaga-jaga cegah flash
  // tema salah kalau #stok kebetulan halaman PERTAMA yang ke-mount di satu
  // page load (mis. buka langsung /#stok) -- <html data-theme> ini juga
  // dibaca ulang oleh nav.js's applyThemeIcon() begitu navMount() jalan.
  (function () {
    const saved = localStorage.getItem('theme');
    const theme = saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.style.colorScheme = theme;
  })();

  // Reset state tiap mount() -- lihat komentar di deklarasi variabel di atas.
  stokCurrentEmail = null;
  sharedHistoryAvailable = null;
  historyShowAll = false;
  currentFileName = null;
  stokParsedRows = null;
  stokMatchedRows = null;
  stokSkippedRows = null;

  // ══════════════════════════════════════════
  // AUTH — sesi kesembilan belas: per-page gate (auth-gate/gate-email/
  // gate-password/gate-login-btn, showApp()/showGate(), local
  // onAuthStateChange subscription) DIHAPUS SELURUHNYA -- router.js gak
  // pernah mount() modul ini sampai shared/auth-gate.js konfirmasi sesi
  // valid + whitelisted duluan, jadi begitu mount() jalan sesi SUDAH
  // PASTI ada. stokCurrentEmail (dipakai buat catat "siapa yang upload"
  // di riwayat) sekarang diisi sekali di sini lewat PNMAuth.getUser(),
  // bukan lagi dari onAuthStateChange callback. accessToken tetap diambil
  // fresh tiap request lewat window.PNMAuth.getAccessToken() di titik-titik
  // fetch() di bawah (gak berubah dari sesi ketujuh belas).
  // ══════════════════════════════════════════
  window.PNMAuth.getUser().then((user) => { stokCurrentEmail = user?.email || null; });
  renderLastStatus();
  renderHistory();

  // ══════════════════════════════════════════
  // RIWAYAT — dibaca/ditulis ke tabel bersama `stok_upload_log` di Supabase.
  // Fallback ke localStorage per-browser kalau tabel belum ada / offline.
  // Tetap raw fetch() ke REST endpoint (bukan lewat sb.from(...)), sama
  // seperti versi asli -- cuma sumber TOKEN-nya yang diganti PNMAuth.
  // ══════════════════════════════════════════
  function readLocalHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
  }
  function pushLocalHistory(entry) {
    const hist = readLocalHistory();
    hist.unshift(entry);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(hist.slice(0, 30)));
  }
  function fmtWhen(iso) {
    const d = new Date(iso);
    return {
      date: d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }),
      time: d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
    };
  }
  function initials(email) {
    if (!email) return '?';
    return email.trim()[0].toUpperCase();
  }
  async function fetchSharedHistory(limit) {
    const accessToken = await window.PNMAuth.getAccessToken();
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/stok_upload_log?select=id,email,uploaded_at,total_rows,skipped_count,file_name&order=uploaded_at.desc&limit=${limit}`,
      { headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + accessToken } }
    );
    if (!res.ok) throw new Error('table missing or query failed');
    const rows = await res.json();
    return rows.map(r => ({ id: r.id, at: r.uploaded_at, email: r.email, total: r.total_rows, skipped: r.skipped_count, fileName: r.file_name }));
  }
  async function fetchSkippedCodesForRow(id) {
    const accessToken = await window.PNMAuth.getAccessToken();
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/stok_upload_log?select=skipped_codes&id=eq.${id}`,
      { headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + accessToken } }
    );
    if (!res.ok) throw new Error('fetch failed');
    const rows = await res.json();
    return (rows[0] && rows[0].skipped_codes) || [];
  }
  async function insertSharedHistory(entry) {
    const accessToken = await window.PNMAuth.getAccessToken();
    const res = await fetch(`${SUPABASE_URL}/rest/v1/stok_upload_log`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': ANON_KEY,
        'Authorization': 'Bearer ' + accessToken,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        email: entry.email,
        uploaded_at: entry.at,
        file_name: entry.fileName || null,
        total_rows: entry.total,
        skipped_count: entry.skipped,
        skipped_codes: (entry.skippedCodes || []).slice(0, 500)
      })
    });
    if (!res.ok) throw new Error('insert failed');
  }
  async function getHistory(limit) {
    try {
      const shared = await fetchSharedHistory(limit);
      sharedHistoryAvailable = true;
      return shared;
    } catch {
      sharedHistoryAvailable = false;
      return readLocalHistory().slice(0, limit);
    }
  }
  async function recordUpload(entry) {
    try {
      await insertSharedHistory(entry);
      sharedHistoryAvailable = true;
    } catch {
      sharedHistoryAvailable = false;
      pushLocalHistory(entry);
    }
  }
  function updateLocalNote() {
    const note = document.getElementById('local-note-text');
    if (!note) return;
    note.textContent = sharedHistoryAvailable === false
      ? 'Riwayat bersama belum aktif (tabel stok_upload_log belum ada) — sementara pakai riwayat lokal di browser ini saja.'
      : 'Riwayat ini dibagikan ke semua user divisi, diambil dari tabel stok_upload_log.';
  }
  async function renderLastStatus() {
    const body = document.getElementById('last-status-body');
    const hist = await getHistory(1);
    updateLocalNote();
    if (hist.length === 0) {
      body.innerHTML = '<div class="summary-empty">Belum ada riwayat upload.</div>';
      return;
    }
    const last = hist[0];
    const w = fmtWhen(last.at);
    body.innerHTML = `
      <div class="summary-row">
        <div class="summary-main">
          <div class="icon-box green"><i class="ti ti-trending-up"></i></div>
          <div class="summary-main-text">
            <div class="lbl">Last Sync</div>
            <div class="val">${w.date}, ${w.time}</div>
            <div class="who"><i class="ti ti-user-circle"></i>${last.email || '—'}</div>
          </div>
        </div>
        <div class="metric-group">
          <div class="metric green">
            <div class="metric-icon green"><i class="ti ti-circle-check"></i></div>
            <div><div class="num">${last.total.toLocaleString('id-ID')}</div><div class="lbl2">Updated</div></div>
          </div>
          <div class="metric amber">
            <div class="metric-icon amber"><i class="ti ti-alert-triangle"></i></div>
            <div><div class="num">${last.skipped.toLocaleString('id-ID')}</div><div class="lbl2">Skipped</div></div>
          </div>
        </div>
      </div>`;
  }
  async function renderHistory() {
    const tbody = document.getElementById('history-tbody');
    const emptyEl = document.getElementById('history-empty');
    const showMoreBtn = document.getElementById('show-more-btn');
    const hist = await getHistory(historyShowAll ? 30 : 10);
    updateLocalNote();
    if (hist.length === 0) {
      tbody.innerHTML = '';
      emptyEl.style.display = 'block';
      showMoreBtn.style.display = 'none';
      return;
    }
    emptyEl.style.display = 'none';
    const visible = historyShowAll ? hist : hist.slice(0, 5);
    showMoreBtn.style.display = hist.length > 5 ? 'inline-flex' : 'none';
    showMoreBtn.innerHTML = historyShowAll
      ? 'Ringkas <i class="ti ti-chevron-up"></i>'
      : 'Lihat Semua <i class="ti ti-chevron-right"></i>';
    tbody.innerHTML = visible.map(h => {
      const w = fmtWhen(h.at);
      return `
      <tr>
        <td class="act-when"><div class="d">${w.date}</div><div class="t">${w.time}</div></td>
        <td><div class="act-user"><div class="act-user-icon">${initials(h.email)}</div>${escapeHtml(h.email) || 'Tidak diketahui'}</div></td>
        <td class="act-num green">${h.total.toLocaleString('id-ID')}</td>
        <td class="act-num ${h.skipped > 0 ? 'amber' : ''}">${h.skipped.toLocaleString('id-ID')}</td>
        <td class="act-file" title="${escapeHtml(h.fileName || '')}">${escapeHtml(h.fileName) || '—'}</td>
        <td>
          <button class="act-dl" data-id="${h.id || ''}" data-skipped="${h.skipped}" title="${h.skipped > 0 ? 'Download kode yang dilewati' : 'Tidak ada yang dilewati'}" ${(!h.id || h.skipped === 0) ? 'disabled' : ''}>
            <i class="ti ti-download"></i>
          </button>
        </td>
      </tr>`;
    }).join('');
    tbody.querySelectorAll('.act-dl').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        if (!id) return;
        btn.disabled = true;
        try {
          const codes = await fetchSkippedCodesForRow(id);
          const csv = ['kode_asli', ...codes].join('\n');
          const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `stok-dilewati-log-${id}.csv`;
          a.click();
          URL.revokeObjectURL(url);
        } catch {} finally {
          btn.disabled = false;
        }
      });
    });
  }
  document.getElementById('show-more-btn').addEventListener('click', () => {
    historyShowAll = !historyShowAll;
    renderHistory();
  });
  const refreshHistoryBtn = document.getElementById('refresh-history-btn');
  refreshHistoryBtn.addEventListener('click', async () => {
    refreshHistoryBtn.disabled = true;
    refreshHistoryBtn.innerHTML = '<i class="ti ti-refresh" style="animation:spin .7s linear infinite"></i>Refresh';
    try {
      await renderLastStatus();
      await renderHistory();
    } finally {
      refreshHistoryBtn.disabled = false;
      refreshHistoryBtn.innerHTML = '<i class="ti ti-refresh"></i>Refresh';
    }
  });

  // ══════════════════════════════════════════
  // PARSE FILE
  // ══════════════════════════════════════════
  const dropzone = document.getElementById('dropzone');
  const stokFile = document.getElementById('stok-file');
  const fileChip = document.getElementById('file-chip');
  const fileChipName = document.getElementById('file-chip-name');
  const fileChipMeta = document.getElementById('file-chip-meta');
  const fileChipRemove = document.getElementById('file-chip-remove');
  const checkingRow = document.getElementById('checking-row');
  const checkingText = document.getElementById('checking-text');
  const progressTrack = document.getElementById('progress-track');
  const progressFill = document.getElementById('progress-fill');
  const precheckPanel = document.getElementById('precheck-panel');
  const statTotal = document.getElementById('stat-total');
  const statMatch = document.getElementById('stat-match');
  const statSkip = document.getElementById('stat-skip');
  const skipPanel = document.getElementById('skip-panel');
  const skipTbody = document.getElementById('skip-tbody');
  const skipSearch = document.getElementById('skip-search');
  const copySkipBtn = document.getElementById('copy-skip-btn');
  const exportSkipBtn = document.getElementById('export-skip-btn');
  const actionsRow = document.getElementById('actions-row');
  const stokUploadBtn = document.getElementById('stok-upload-btn');
  const stokCancelBtn = document.getElementById('stok-cancel-btn');
  const stokStatusMsg = document.getElementById('stok-status-msg');

  function fmtSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }
  function resetUploadUI() {
    stokParsedRows = null; stokMatchedRows = null; stokSkippedRows = null; currentFileName = null;
    fileChip.style.display = 'none';
    checkingRow.style.display = 'none';
    progressTrack.style.display = 'none';
    precheckPanel.style.display = 'none';
    skipPanel.style.display = 'none';
    actionsRow.style.display = 'none';
    stokUploadBtn.disabled = true;
    stokUploadBtn.innerHTML = '<i class="ti ti-upload"></i>Upload Stock';
    stokStatusMsg.innerHTML = '';
    stokFile.value = '';
  }
  fileChipRemove.addEventListener('click', resetUploadUI);
  stokCancelBtn.addEventListener('click', resetUploadUI);
  ['dragover', 'dragenter'].forEach(evt => dropzone.addEventListener(evt, e => { e.preventDefault(); dropzone.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(evt => dropzone.addEventListener(evt, e => { dropzone.classList.remove('drag'); }));
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) { stokFile.files = e.dataTransfer.files; handleFile(f); }
  });
  stokFile.addEventListener('change', () => {
    const file = stokFile.files[0];
    if (file) handleFile(file);
  });
  // ROBUSTNESS FIX: no size limit previously existed -- a very large xlsx
  // (accidental wrong file, or a pathological one) gets read fully into
  // memory via file.arrayBuffer() + XLSX.read() with no guard, which can
  // freeze the tab before any error is ever shown. Soft cap to fail fast
  // with a clear message instead.
  const MAX_XLSX_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

  async function handleFile(file) {
    resetUploadUI();
    if (file.size > MAX_XLSX_SIZE_BYTES) {
      fileChip.style.display = 'flex';
      fileChipName.textContent = file.name;
      fileChipMeta.textContent = fmtSize(file.size);
      stokStatusMsg.innerHTML = `<div class="result-banner fail">File terlalu besar (${fmtSize(file.size)}). Maksimal ${fmtSize(MAX_XLSX_SIZE_BYTES)}.</div>`;
      return;
    }
    currentFileName = file.name;
    fileChip.style.display = 'flex';
    fileChipName.textContent = file.name;
    fileChipMeta.textContent = fmtSize(file.size);
    checkingRow.style.display = 'flex';
    checkingText.textContent = 'Membaca file…';
    try {
      // SheetJS: baca sheet pertama sebagai array-of-arrays (header: 1) --
      // padanan paling dekat sama pola getRow()/getCell() ExcelJS yang lama,
      // colKode/colQty di sini 0-based (array index), BEDA dari ExcelJS yang
      // 1-based (colNumber) -- disesuaikan di pencarian header & lookup cell
      // di bawah, sisanya (dedup/skip logic) sama persis kayak sebelumnya.
      const buffer = await file.arrayBuffer();
      const wb = window.XLSX.read(buffer, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rowsAoa = window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
      const headerRow = rowsAoa[0] || [];
      let colKode = null, colQty = null;
      headerRow.forEach((cell, colIndex) => {
        const v = String(cell || '').trim().toUpperCase();
        if (v === 'KODEASLI' || v === 'KODE ASLI') colKode = colIndex;
        if (v === 'QTY') colQty = colIndex;
      });
      if (colKode === null || colQty === null) {
        throw new Error('Kolom KODEASLI dan/atau QTY tidak ditemukan di baris pertama file.');
      }
      const seen = new Map();
      let dupCount = 0;
      for (let r = 1; r < rowsAoa.length; r++) {
        const row = rowsAoa[r] || [];
        const kodeAsli = String(row[colKode] ?? '').trim();
        const qtyRaw = row[colQty];
        const qty = parseInt(qtyRaw, 10);
        if (!kodeAsli) continue;
        if (seen.has(kodeAsli)) dupCount++;
        seen.set(kodeAsli, { kode_asli: kodeAsli, qty: isNaN(qty) ? 0 : qty });
      }
      const rows = [...seen.values()];
      if (rows.length === 0) throw new Error('Tidak ada baris data yang valid di file ini.');
      stokParsedRows = rows;
      fileChipMeta.textContent = `${fmtSize(file.size)} • ${rows.length.toLocaleString('id-ID')} baris`;
      if (dupCount > 0) {
        stokStatusMsg.innerHTML = `<div class="result-banner err">Catatan: ${dupCount} kode duplikat ditemukan di file, baris terakhir untuk tiap kode yang dipakai.</div>`;
      }
      await runPrecheck(rows);
    } catch (err) {
      checkingRow.style.display = 'none';
      stokStatusMsg.innerHTML = `<div class="result-banner fail">Gagal baca file: ${err.message}</div>`;
    }
  }
  async function fetchValidKodeSet(kodeList) {
    const accessToken = await window.PNMAuth.getAccessToken();
    const valid = new Set();
    const CHUNK = 150;
    const chunks = [];
    for (let i = 0; i < kodeList.length; i += CHUNK) chunks.push(kodeList.slice(i, i + CHUNK));
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const inList = chunk.map(k => `"${k.replace(/"/g, '\\"')}"`).join(',');
      const url = `${SUPABASE_URL}/rest/v1/master_produk?select=kode_asli&kode_asli=in.(${inList})`;
      const res = await fetch(url, { headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + accessToken } });
      if (res.ok) { (await res.json()).forEach(d => valid.add(d.kode_asli)); }
      progressFill.style.width = Math.round(((i + 1) / chunks.length) * 100) + '%';
    }
    return valid;
  }
  async function runPrecheck(rows) {
    checkingRow.style.display = 'flex';
    checkingText.textContent = `Memeriksa ${rows.length.toLocaleString('id-ID')} kode ke database produk…`;
    progressTrack.style.display = 'block';
    progressFill.style.width = '0%';
    try {
      const validSet = await fetchValidKodeSet(rows.map(r => r.kode_asli));
      const matched = rows.filter(r => validSet.has(r.kode_asli));
      const skipped = rows.filter(r => !validSet.has(r.kode_asli));
      stokMatchedRows = matched;
      stokSkippedRows = skipped;
      statTotal.textContent = rows.length.toLocaleString('id-ID');
      statMatch.textContent = matched.length.toLocaleString('id-ID');
      statSkip.textContent = skipped.length.toLocaleString('id-ID');
      precheckPanel.style.display = 'block';
      skipPanel.style.display = skipped.length > 0 ? 'block' : 'none';
      if (skipped.length > 0) renderSkipTable(skipped);
      actionsRow.style.display = 'flex';
      stokUploadBtn.disabled = false;
    } catch (err) {
      stokStatusMsg.innerHTML = `<div class="result-banner fail">Gagal memeriksa database: ${err.message} — kamu tetap bisa upload, tapi laporan "dilewati" baru muncul setelah proses selesai.</div>`;
      actionsRow.style.display = 'flex';
      stokUploadBtn.disabled = false;
    } finally {
      checkingRow.style.display = 'none';
      progressTrack.style.display = 'none';
    }
  }
  function renderSkipTable(skipped, filter) {
    const q = (filter || '').trim().toLowerCase();
    const rowsToShow = q ? skipped.filter(r => r.kode_asli.toLowerCase().includes(q)) : skipped;
    skipTbody.innerHTML = rowsToShow.slice(0, 500).map(r =>
      `<tr><td>${escapeHtml(r.kode_asli)}</td><td>${escapeHtml(r.qty)}</td></tr>`
    ).join('') || '<tr><td colspan="2" style="color:var(--text-muted)">Tidak ada yang cocok.</td></tr>';
  }
  skipSearch.addEventListener('input', () => { if (stokSkippedRows) renderSkipTable(stokSkippedRows, skipSearch.value); });
  copySkipBtn.addEventListener('click', async () => {
    if (!stokSkippedRows || stokSkippedRows.length === 0) return;
    try {
      await navigator.clipboard.writeText(stokSkippedRows.map(r => r.kode_asli).join('\n'));
      copySkipBtn.innerHTML = '<i class="ti ti-check"></i>Tersalin';
      setTimeout(() => { copySkipBtn.innerHTML = '<i class="ti ti-copy"></i>Salin'; }, 1500);
    } catch {}
  });
  exportSkipBtn.addEventListener('click', () => {
    if (!stokSkippedRows || stokSkippedRows.length === 0) return;
    const csv = ['kode_asli,qty', ...stokSkippedRows.map(r => `${r.kode_asli},${r.qty}`)].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stok-dilewati-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // ══════════════════════════════════════════
  // UPLOAD FINAL
  // ══════════════════════════════════════════
  stokUploadBtn.addEventListener('click', async () => {
    if (!stokParsedRows) return;
    const accessToken = await window.PNMAuth.getAccessToken();
    if (!accessToken) { window.PNMAuth.logout(); return; }
    const skipNote = stokSkippedRows && stokSkippedRows.length > 0
      ? `${stokSkippedRows.length} kode akan DILEWATI karena belum terdaftar sebagai produk.\n\n`
      : '';
    if (!confirm(`${skipNote}Yakin timpa seluruh data stok dengan ${stokParsedRows.length} baris dari file ini?`)) return;
    stokUploadBtn.disabled = true;
    actionsRow.style.display = 'flex';
    stokCancelBtn.style.display = 'none';
    stokUploadBtn.innerHTML = '<div class="spinner" style="border-top-color:#fff;border-color:rgba(255,255,255,.35)"></div>&nbsp;Mengupload…';
    stokStatusMsg.innerHTML = '';
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/replace_stok_produk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + accessToken },
        body: JSON.stringify({ rows: stokParsedRows })
      });
      if (res.status === 401) { window.PNMAuth.logout(); return; }
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || errData.hint || 'Gagal upload stok (cek apakah email kamu terdaftar di allowed_users)');
      }
      const result = await res.json();
      const serverSkippedCount = result.skipped_count || 0;
      const serverSkippedCodes = result.skipped_codes || [];
      let msg = `Berhasil! ${result.inserted.toLocaleString('id-ID')} kode stok diperbarui.`;
      if (serverSkippedCount > 0) {
        msg += ` ${serverSkippedCount} kode DILEWATI karena belum terdaftar di master_produk: ` +
          escapeHtml(serverSkippedCodes.slice(0, 15).join(', ')) +
          (serverSkippedCodes.length > 15 ? `, dan ${serverSkippedCodes.length - 15} lainnya…` : '');
      }
      stokStatusMsg.innerHTML = `<div class="result-banner ${serverSkippedCount > 0 ? 'err' : 'ok'}">${msg}</div>`;
      await recordUpload({
        at: new Date().toISOString(),
        email: stokCurrentEmail,
        fileName: currentFileName,
        total: stokParsedRows.length,
        skipped: serverSkippedCount,
        skippedCodes: serverSkippedCodes
      });
      await renderLastStatus();
      historyShowAll = false;
      await renderHistory();
      resetUploadUI();
    } catch (err) {
      stokStatusMsg.innerHTML = `<div class="result-banner fail">Gagal: ${err.message}</div>`;
      stokUploadBtn.disabled = false;
      actionsRow.style.display = 'flex';
      stokCancelBtn.style.display = 'block';
    } finally {
      stokUploadBtn.innerHTML = '<i class="ti ti-upload"></i>Upload Stock';
    }
  });
}

export function unmount() {
  // UPDATE (jank fix): pnm-universal.css NO LONGER removed here -- see the
  // shared-pnm-universal-css comment in app/shell.html. Same "leave it
  // attached, it's cheap and other pages want it too" reasoning this
  // comment already applied to fonts/phosphor-icons now also applies to
  // pnm-universal.css itself: it's a permanent <link> loaded once by
  // shell.html/index.html, which also fixes a flash-of-unstyled-content
  // "jaggy zoom" that removing/reloading it on every navigation was causing.
  document.getElementById('page-stok-style')?.remove();

  mountedContainer = null;
}