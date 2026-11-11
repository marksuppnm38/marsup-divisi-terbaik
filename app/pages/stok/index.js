// stok page module: mount(container) / unmount().
//
// Layout: markup.js (HTML) dipisah dari script; halaman memakai shared nav
// (app/pages/nav/) + pw-topbar, sama seperti dashboard/index.js. Konten card/table
// di dalam halaman masih memakai class pnm-universal.css, dengan override
// page-scoped di style.css.
//
// AUTH: tidak ada login gate di halaman ini; router.js baru mount() setelah
// shared/auth-gate.js lolos. Semua panggilan auth lewat PNMAuth.* (halaman aslinya
// dulu pakai raw fetch() ke /auth/v1/token dan token manual di localStorage; key
// sesi pnm_auth_session sama dengan yang dipakai shared/supabase-client.js).
//
// document.getElementById(...) TIDAK di-rescope ke container.querySelector -- aman
// selama cuma satu halaman yang termount di satu waktu, dijamin router.js.
//
// Tidak ada inline onclick/onchange/oninput di markup (semua wiring via
// addEventListener), jadi tidak ada fungsi yang perlu diekspos ke window.*.
//
// window.PNM_SUPABASE_URL / window.PNM_SUPABASE_ANON_KEY dipakai (bukan const
// SUPABASE_URL/ANON_KEY duplikat di file ini). Diisi di dalam mount() setelah
// ensureVendorScripts() resolve, bukan di module scope: window.PNM_SUPABASE_URL
// belum ada saat modul ini di-import() router, dan alasan yang sama berlaku untuk
// `const sb = window.pnmSupabase`.

import { STOK_MARKUP } from './markup.js';
import { mountKelengkapan, refreshKelengkapan, unmountKelengkapan } from './kelengkapan.js';
import { mountSiapTayang, refreshSiapTayang, unmountSiapTayang } from './siap-tayang.js';

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

const SRI_BY_SRC = {
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js':
    'sha384-vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw',
};

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    if (SRI_BY_SRC[src]) { s.integrity = SRI_BY_SRC[src]; s.crossOrigin = 'anonymous'; } // SRI: browser tolak file yang byte-nya beda
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

// Hanya pnm-universal.css yang dimuat di sini. Font (Inter/JetBrains) dan ikon Tabler
// sudah dimuat global oleh index.html / nav, dan halaman stok tidak lagi memakai ikon
// sama sekali, jadi tidak perlu dimuat ulang dari modul ini.
const SHARED_LINKS = [
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
// UPDATE (retrofit style, sesudah dashboard): sekarang ADA
// style.css di folder ini (lihat file itu). Sama
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

  // theme-init: DIHAPUS dari halaman ini. Toggle stok sudah dihapus (lihat
  // markup.js) dan tema sekarang dipasang global, sinkron di <head>, oleh
  // shared/theme-init.js (window.PNMTheme) -- halaman cukup membaca
  // <html data-theme>, tidak menyetelnya sendiri.

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
  mountKelengkapan({ supabaseUrl: SUPABASE_URL, anonKey: ANON_KEY });
  mountSiapTayang({ supabaseUrl: SUPABASE_URL, anonKey: ANON_KEY });

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
      body.textContent = 'Belum pernah upload stok.';
      return;
    }
    const last = hist[0];
    const w = fmtWhen(last.at);
    body.innerHTML = `
      <span>Stok terakhir diperbarui <b>${w.date}, ${w.time}</b> oleh ${escapeHtml(last.email) || 'pengguna tidak diketahui'}</span>
      <span class="nums">
        <span class="status ok">${last.total.toLocaleString('id-ID')} diperbarui</span>
        <span class="status warn">${last.skipped.toLocaleString('id-ID')} dilewati</span>
      </span>`;
  }
  async function renderHistory() {
    const tbody = document.getElementById('history-tbody');
    const emptyEl = document.getElementById('history-empty');
    const showMoreBtn = document.getElementById('show-more-btn');
    const historyMsg = document.getElementById('history-msg');
    const hist = await getHistory(historyShowAll ? 30 : 10);
    updateLocalNote();
    if (hist.length === 0) {
      tbody.innerHTML = '';
      emptyEl.hidden = false;
      showMoreBtn.hidden = true;
      return;
    }
    emptyEl.hidden = true;
    const visible = historyShowAll ? hist : hist.slice(0, 5);
    showMoreBtn.hidden = hist.length <= 5;
    showMoreBtn.textContent = historyShowAll ? 'Ringkas' : 'Lihat semua';
    tbody.innerHTML = visible.map(h => {
      const w = fmtWhen(h.at);
      return `
      <tr>
        <td class="act-when"><div class="d">${w.date}</div><div class="t">${w.time}</div></td>
        <td>${escapeHtml(h.email) || 'Tidak diketahui'}</td>
        <td class="act-num green"><span class="mlabel">Diperbarui</span>${h.total.toLocaleString('id-ID')}</td>
        <td class="act-num ${h.skipped > 0 ? 'amber' : ''}"><span class="mlabel">Dilewati</span>${h.skipped.toLocaleString('id-ID')}</td>
        <td class="act-file" title="${escapeHtml(h.fileName || '')}">${escapeHtml(h.fileName) || '—'}</td>
        <td>${(h.id && h.skipped > 0)
          ? `<button class="mini-btn act-dl" type="button" data-id="${escapeHtml(h.id)}">Unduh CSV</button>`
          : '<span class="c-muted">—</span>'}</td>
      </tr>`;
    }).join('');
    tbody.querySelectorAll('.act-dl').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        if (!id) return;
        btn.disabled = true;
        historyMsg.innerHTML = '';
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
        } catch {
          historyMsg.innerHTML = '<div class="result-banner fail">Gagal mengunduh kode yang dilewati. Coba lagi sebentar lagi.</div>';
        } finally {
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
    try {
      await renderLastStatus();
      await renderHistory();
    } finally {
      refreshHistoryBtn.disabled = false;
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

  // ══════════════════════════════════════════
  // CONFIRM DIALOG (ganti window.confirm() bawaan browser)
  // ══════════════════════════════════════════
  // Promise-based, pakai overlay .confirm-overlay/.confirm-card yang sama
  // kayak "Perubahan belum disimpan"-nya crud-produk -- CSS-nya generic
  // (bukan crud-produk-only) jadi aman dipakai ulang di sini tanpa nambah
  // style baru. Cuma satu dialog aktif dalam satu waktu (cukup buat
  // kebutuhan halaman ini), jadi resolver lama ditimpa aja kalau ada
  // panggilan baru sebelum yang sebelumnya kejawab -- overlay-nya sendiri
  // cuma bisa nunjukin satu confirm dalam satu waktu juga.
  //
  // Aksesibilitas: fokus pindah ke dialog saat dibuka (default ke "Batal" untuk
  // aksi destruktif, supaya Enter tidak langsung menimpa data), Tab berputar di
  // dalam dialog, Esc = batal, dan fokus dikembalikan ke tombol pemicu saat
  // ditutup. Klik di luar kartu juga = batal.
  const stokConfirmOverlay = document.getElementById('stokConfirmOverlay');
  const stokConfirmCard = document.getElementById('stokConfirmCard');
  const stokConfirmTitle = document.getElementById('stokConfirmTitle');
  const stokConfirmMsg = document.getElementById('stokConfirmMsg');
  const stokConfirmCancelBtn = document.getElementById('stokConfirmCancelBtn');
  const stokConfirmOkBtn = document.getElementById('stokConfirmOkBtn');
  let stokConfirmResolve = null;
  let stokConfirmReturnFocus = null;

  function stokConfirm(message, { title = 'Konfirmasi', okLabel = 'Lanjutkan', danger = false } = {}) {
    stokConfirmTitle.textContent = title;
    // pesan boleh multi-line (\n\n dari skipNote) -- konversi ke <br> karena
    // <p> gak nge-render newline mentah; escapeHtml dulu biar aman dari XSS
    // kalau suatu saat pesannya include teks dari file upload (kode produk dst).
    stokConfirmMsg.innerHTML = escapeHtml(message).replace(/\n/g, '<br>');
    stokConfirmOkBtn.textContent = okLabel;
    stokConfirmCard.classList.toggle('danger', danger);
    stokConfirmOkBtn.className = 'btn ' + (danger ? 'btn-danger-ghost' : 'btn-accent');
    stokConfirmReturnFocus = document.activeElement;
    stokConfirmOverlay.classList.add('open');
    (danger ? stokConfirmCancelBtn : stokConfirmOkBtn).focus();
    return new Promise((resolve) => {
      stokConfirmResolve = resolve;
    });
  }
  function closeStokConfirm(result) {
    stokConfirmOverlay.classList.remove('open');
    if (stokConfirmReturnFocus && typeof stokConfirmReturnFocus.focus === 'function' && stokConfirmReturnFocus.isConnected) {
      stokConfirmReturnFocus.focus();
    }
    stokConfirmReturnFocus = null;
    if (stokConfirmResolve) { stokConfirmResolve(result); stokConfirmResolve = null; }
  }
  stokConfirmCancelBtn.addEventListener('click', () => closeStokConfirm(false));
  stokConfirmOkBtn.addEventListener('click', () => closeStokConfirm(true));
  // klik di luar card / tutup kayak modal lain di app ini = batal, bukan lanjut
  stokConfirmOverlay.addEventListener('click', (e) => {
    if (e.target === stokConfirmOverlay) closeStokConfirm(false);
  });
  stokConfirmOverlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeStokConfirm(false); return; }
    if (e.key !== 'Tab') return;
    const focusables = [stokConfirmCancelBtn, stokConfirmOkBtn];
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === stokConfirmCard)) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  });

  function fmtSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }
  const UPLOAD_BTN_HTML = 'Upload stok';
  function resetUploadUI() {
    stokParsedRows = null; stokMatchedRows = null; stokSkippedRows = null; currentFileName = null;
    fileChip.hidden = true;
    checkingRow.hidden = true;
    progressTrack.hidden = true;
    precheckPanel.hidden = true;
    skipPanel.hidden = true;
    actionsRow.hidden = true;
    stokCancelBtn.hidden = false;
    stokUploadBtn.disabled = true;
    stokUploadBtn.innerHTML = UPLOAD_BTN_HTML;
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
      fileChip.hidden = false;
      fileChipName.textContent = file.name;
      fileChipMeta.textContent = fmtSize(file.size);
      stokStatusMsg.innerHTML = `<div class="result-banner fail">File terlalu besar (${fmtSize(file.size)}), batasnya ${fmtSize(MAX_XLSX_SIZE_BYTES)}. Pilih file yang lebih kecil.</div>`;
      return;
    }
    currentFileName = file.name;
    fileChip.hidden = false;
    fileChipName.textContent = file.name;
    fileChipMeta.textContent = fmtSize(file.size);
    checkingRow.hidden = false;
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
        throw new Error('Kolom KODEASLI dan/atau QTY tidak ditemukan di baris pertama file. Periksa nama kolom di header.');
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
        stokStatusMsg.innerHTML = `<div class="result-banner err">${dupCount} kode duplikat di file. Untuk tiap kode, baris terakhir yang dipakai.</div>`;
      }
      await runPrecheck(rows);
    } catch (err) {
      checkingRow.hidden = true;
      stokStatusMsg.innerHTML = `<div class="result-banner fail">Gagal membaca file: ${escapeHtml(err.message)}</div>`;
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
      const pct = Math.round(((i + 1) / chunks.length) * 100);
      progressFill.style.width = pct + '%';
      progressTrack.setAttribute('aria-valuenow', String(pct));
    }
    return valid;
  }
  async function runPrecheck(rows) {
    checkingRow.hidden = false;
    checkingText.textContent = `Memeriksa ${rows.length.toLocaleString('id-ID')} kode ke database produk…`;
    progressTrack.hidden = false;
    progressFill.style.width = '0%';
    progressTrack.setAttribute('aria-valuenow', '0');
    try {
      const validSet = await fetchValidKodeSet(rows.map(r => r.kode_asli));
      const matched = rows.filter(r => validSet.has(r.kode_asli));
      const skipped = rows.filter(r => !validSet.has(r.kode_asli));
      stokMatchedRows = matched;
      stokSkippedRows = skipped;
      statTotal.textContent = rows.length.toLocaleString('id-ID');
      statMatch.textContent = matched.length.toLocaleString('id-ID');
      statSkip.textContent = skipped.length.toLocaleString('id-ID');
      precheckPanel.hidden = false;
      skipPanel.hidden = skipped.length === 0;
      if (skipped.length > 0) renderSkipTable(skipped);
      actionsRow.hidden = false;
      stokUploadBtn.disabled = false;
    } catch (err) {
      stokStatusMsg.innerHTML = `<div class="result-banner fail">Gagal memeriksa database: ${escapeHtml(err.message)}. Kamu tetap bisa upload, tapi daftar kode yang dilewati baru muncul setelah upload selesai.</div>`;
      actionsRow.hidden = false;
      stokUploadBtn.disabled = false;
    } finally {
      checkingRow.hidden = true;
      progressTrack.hidden = true;
    }
  }
  function renderSkipTable(skipped, filter) {
    const q = (filter || '').trim().toLowerCase();
    const rowsToShow = q ? skipped.filter(r => r.kode_asli.toLowerCase().includes(q)) : skipped;
    skipTbody.innerHTML = rowsToShow.slice(0, 500).map(r =>
      `<tr><td>${escapeHtml(r.kode_asli)}</td><td class="num">${escapeHtml(r.qty)}</td></tr>`
    ).join('') || '<tr><td colspan="2" class="skip-empty">Tidak ada yang cocok.</td></tr>';
  }
  skipSearch.addEventListener('input', () => { if (stokSkippedRows) renderSkipTable(stokSkippedRows, skipSearch.value); });
  copySkipBtn.addEventListener('click', async () => {
    if (!stokSkippedRows || stokSkippedRows.length === 0) return;
    try {
      await navigator.clipboard.writeText(stokSkippedRows.map(r => r.kode_asli).join('\n'));
      copySkipBtn.textContent = 'Tersalin';
    } catch {
      copySkipBtn.textContent = 'Gagal menyalin';
    }
    setTimeout(() => { copySkipBtn.textContent = 'Salin'; }, 1500);
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
      ? `${stokSkippedRows.length.toLocaleString('id-ID')} kode akan dilewati karena belum terdaftar sebagai produk.\n\n`
      : '';
    const ok = await stokConfirm(
      `${skipNote}Seluruh data stok yang ada akan diganti dengan ${stokParsedRows.length.toLocaleString('id-ID')} baris dari file ini. Tindakan ini tidak bisa dibatalkan.`,
      { title: 'Timpa data stok?', okLabel: 'Timpa data stok', danger: true }
    );
    if (!ok) return;
    stokUploadBtn.disabled = true;
    actionsRow.hidden = false;
    stokCancelBtn.hidden = true;
    stokUploadBtn.innerHTML = '<div class="spinner" aria-hidden="true"></div>Mengupload…';
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
      let msg = `${result.inserted.toLocaleString('id-ID')} kode stok diperbarui.`;
      if (serverSkippedCount > 0) {
        msg += ` ${Number(serverSkippedCount).toLocaleString('id-ID')} kode dilewati karena belum terdaftar di master_produk: ` +
          escapeHtml(serverSkippedCodes.slice(0, 15).join(', ')) +
          (serverSkippedCodes.length > 15 ? `, dan ${serverSkippedCodes.length - 15} lainnya.` : '.');
      }
      // Disimpan dulu, dipasang SETELAH resetUploadUI() di bawah: reset itu mengosongkan
      // #stok-status-msg, jadi dulu banner sukses hilang di frame yang sama dan pengguna
      // tidak pernah melihat konfirmasi hasil upload.
      const resultHtml = `<div class="result-banner ${serverSkippedCount > 0 ? 'err' : 'ok'}">${msg}</div>`; // sec-ok: msg = angka + escapeHtml(kode), tidak ada teks mentah
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
      refreshKelengkapan(); // stok baru masuk → hitung ulang komponen bolong
      refreshSiapTayang();  // stok baru masuk → status siap/indent berubah
      resetUploadUI();
      stokStatusMsg.innerHTML = resultHtml; // sec-ok: resultHtml dibangun dari angka + escapeHtml(kode) di atas
    } catch (err) {
      stokStatusMsg.innerHTML = `<div class="result-banner fail">Upload gagal: ${escapeHtml(err.message)}</div>`;
      stokUploadBtn.disabled = false;
      actionsRow.hidden = false;
      stokCancelBtn.hidden = false;
    } finally {
      stokUploadBtn.innerHTML = UPLOAD_BTN_HTML;
    }
  });
}

export function unmount() {
  // UPDATE (jank fix): pnm-universal.css NO LONGER removed here -- see the
  // shared-pnm-universal-css comment in index.html. Same "leave it
  // attached, it's cheap and other pages want it too" reasoning this
  // comment already applied to fonts/phosphor-icons now also applies to
  // pnm-universal.css itself: it's a permanent <link> loaded once by
  // index.html, which also fixes a flash-of-unstyled-content
  // "jaggy zoom" that removing/reloading it on every navigation was causing.
  document.getElementById('page-stok-style')?.remove();
  unmountKelengkapan();
  unmountSiapTayang();

  mountedContainer = null;
}