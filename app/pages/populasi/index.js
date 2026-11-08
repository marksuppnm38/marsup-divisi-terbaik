// app/pages/populasi/index.js -- mount(container) / unmount().
// Halaman "Populasi": menjawab "kategori/produk apa, di RS mana saja, di provinsi X",
// dan hasilnya bisa diunduh sebagai Excel (xlsx) yang siap dipakai.
//
// DATA: RPC (definisi di populasi_v2.sql)
//   get_populasi_v2         -> seluruh halaman dalam SATU panggilan (daftar RS, ringkasan,
//                              opsi provinsi/kategori, RS yang wilayahnya belum terpetakan, data_per)
//   get_populasi_v2_baris   -> baris per PO/produk: rincian satu RS (saat baris dibuka)
//                              dan bahan seluruh sheet Excel
//   set_rs_wilayah          -> simpan koreksi wilayah satu RS (tidak berubah)
//   get_produk_kelompok / set_produk_kelompok / hapus_produk_kelompok -> koreksi kategori produk (sql/01)
//   get_set_grup / set_set_grup / hapus_set_grup -> alihkan set custom ke populasi set lain (sql/07)
//   (data sheet TIDAK disentuh; keduanya hanya mengubah nama/kategori yang dihitung)
// Pola mount/unmount/auth/rpc() sama dengan dashboard/index.js (PNMAuth, token diambil
// fresh tiap request, delegasi event di container).
//
// "Perlu dicek" / "perkiraan" (state.tinjau): kartu angka itu membuka DAFTAR PESANAN-nya
// (dari get_populasi_v2_baris, filter yang sama dengan tabel) lengkap dengan alasan per pesanan.
// Angka kartu selalu disamakan dengan daftar yang tampil (lihat renderReview).
//
// Semua nilai dari DB yang masuk ke innerHTML WAJIB lewat esc() -- data orderan datang dari
// sheet yang bisa diedit banyak orang, bukan input tepercaya.

import { POPULASI_MARKUP } from './markup.js';

const VENDOR_CHAIN = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  '/shared/supabase-client.js',
  '/shared/auth-session.js',
];
// Dimuat hanya saat tombol Excel ditekan (library ini cukup besar).
const EXCELJS_SRC = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';

const scriptPromises = new Map();
function loadScript(src) {
  if (scriptPromises.has(src)) return scriptPromises.get(src);
  if (document.querySelector(`script[src="${src}"]`)) return Promise.resolve();
  const p = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => { s.remove(); reject(new Error('Gagal memuat ' + src)); };
    document.head.appendChild(s);
  });
  scriptPromises.set(src, p);
  p.catch(() => scriptPromises.delete(src));   // boleh dicoba lagi
  return p;
}

let vendorReady = null;
function ensureVendorScripts() {
  if (window.PNMAuth && window.pnmSupabase) return Promise.resolve();
  if (!vendorReady) {
    vendorReady = VENDOR_CHAIN.reduce((p, src) => p.then(() => loadScript(src)), Promise.resolve());
  }
  return vendorReady;
}

// id+href sama persis dgn dashboard/konversian supaya <link> dipakai bersama.
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

// style.css halaman ini dimuat di mount() dan dilepas di unmount() (pola sama dgn halaman lain).
function ensureStyle() {
  return Promise.all([
    ...SHARED_LINKS.map(({ id, href }) => loadLink(id, href)),
    loadLink('page-populasi-style', new URL('./style.css', import.meta.url).href),
  ]);
}

const SUPABASE_URL = 'https://ptkkbsemihcyndisjoor.supabase.co';
const RPC_TIMEOUT_MS = 25000;
const EXPORT_TIMEOUT_MS = 60000;
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB0a2tic2VtaWhjeW5kaXNqb29yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0Njc4MzgsImV4cCI6MjA5ODA0MzgzOH0.QsCqmcqQcXvz1f8bLkagvMbAGUBbBP-3Wa5Aore5OMo';
const LS_PROV = 'pnm_populasi_set_provinsi';
const DEFAULT_PROV = 'Jawa Tengah';
const STALE_DAYS = 7;     // lewat ini, tampilkan peringatan "data di DB tertinggal"

// Kategori = kelompok dari label satuan_or_set (public.fn_kelompok_baris di populasi_v2.sql).
const KELOMPOK = [
  { id: 'SET',               nama: 'Set instrumen' },
  { id: 'INSTRUMEN SATUAN',  nama: 'Instrumen satuan' },
  { id: 'ELEKTROMEDIS',      nama: 'Elektromedis' },
  { id: 'ALAT LABORATORIUM', nama: 'Alat laboratorium' },
  { id: 'UNIT',              nama: 'Unit lainnya' },
  { id: 'PENUNJANG MEDIS',   nama: 'Penunjang medis' },
  { id: 'BMHP',              nama: 'BMHP' },
];
const KEL = Object.fromEntries(KELOMPOK.map((k) => [k.id, k]));
const katName = (id) => (id === 'ISI SET' ? 'Isi set' : (KEL[id] ? KEL[id].nama : (id || '—')));

let mountedContainer = null;
let handlers = null;
let searchTimer = null;
let reqId = 0;

const state = {
  provinsi: DEFAULT_PROV, status: 'DELIVERED', cakupan: 'POPULASI',
  kelompok: ['SET'], produk: '', rs: '', isiSet: false, dari: '', sampai: '',
  sort: { k: 'total', dir: 'desc' },
  tinjau: '',                       // '' | 'cek' | 'estimasi' -> tabel berganti jadi daftar pesanan
};

let data = null;                    // respons get_populasi_v2 terakhir
let rows = [];                      // data.rows (+ field turunan set/pcs/total), urutan = tampilan
let unmapped = [];                  // data.belum_terpetakan
const detailCache = new Map();      // kunci -> baris satu RS (dibersihkan tiap load)
let linesAll = null;                // {key, list}: seluruh baris pesanan pada filter aktif (bahan daftar tinjau)
let recon = {};                     // angka kartu yang disamakan dengan daftar (kosong = pakai angka server)
let reviewReq = 0;

// ── util ────────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const num = (v) => Number(v) || 0;
function fmt(n) { return Number(n || 0).toLocaleString('id-ID'); }
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
// 'YYYY-MM-DD' dibaca sebagai tanggal LOKAL (new Date('2026-01-05') itu UTC -> bisa geser sehari).
function toDate(s) {
  if (!s) return null;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) : new Date(s);
  return isNaN(d) ? null : d;
}
function fmtDate(s) {
  const d = toDate(s);
  return d ? d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
}
function localISODate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function showError(msg) { $('err-text').textContent = msg; $('err-banner').classList.add('show'); }
function clearError() { $('err-banner').classList.remove('show'); }
function showToast(msg, type = 'success') {
  const c = $('toast-container');
  if (!c) return;
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  const ic = document.createElement('i');
  ic.className = `ti ti-${type === 'success' ? 'check-circle' : 'warning-circle'}`;
  t.appendChild(ic);
  t.appendChild(document.createTextNode(' ' + msg));
  c.appendChild(t);
  setTimeout(() => { t.classList.add('fade-out'); setTimeout(() => t.remove(), 250); }, 2600);
}
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* abaikan */ } }

// Token diambil FRESH tiap request (bukan variabel lokal yang bisa basi) -- sama dgn dashboard.
// Cache stale-while-revalidate untuk get_populasi_v2 (module-scope: selamat dari unmount/mount,
// jadi kembali ke modul ini langsung menampilkan hasil terakhir, lalu disegarkan di belakang).
// Setiap RPC tulis (bukan get_*) mengosongkan cache supaya data basi tidak pernah tampil
// setelah suntingan.
const SWR_MAX = 12;
const swrCache = new Map(); // JSON(params) -> { res, json }

async function rpc(fn, params, timeoutMs = RPC_TIMEOUT_MS) {
  if (!/^get_/.test(fn)) swrCache.clear();
  const accessToken = await window.PNMAuth.getAccessToken();
  if (!accessToken) {
    window.PNMAuth.logout();
    throw new Error('unauthorized: no access token');
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + accessToken },
      body: JSON.stringify(params || {}),
      signal: ctrl.signal,
    });
  } catch (err) {
    throw new Error(err.name === 'AbortError' ? `RPC ${fn} timeout (>${timeoutMs / 1000}s)` : err.message);
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401) { window.PNMAuth.logout(); throw new Error('unauthorized'); }
  const out = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error((out && (out.message || out.error_description)) || `RPC ${fn} gagal (HTTP ${res.status})`);
    err.status = res.status;
    err.code = out && out.code;   // PGRST202 = fungsi belum ada di schema cache
    throw err;
  }
  return out;
}

function filterParams() {
  return {
    p_provinsi: state.provinsi || null,
    p_status: state.status,
    p_cakupan: state.cakupan,
    p_dari: state.dari || null,
    p_sampai: state.sampai || null,
    p_kelompok: state.kelompok.length ? state.kelompok : null,
    p_produk: state.produk.trim() || null,
    p_rs: state.rs.trim() || null,
    p_isi_set: !!(state.isiSet && state.produk.trim()),
  };
}

function kategoriText(st = state) {
  const k = st.kelompok.map(katName);
  return k.length ? k.join(', ') : 'Semua kategori';
}
function periodeText(st = state) {
  if (!st.dari && !st.sampai) return 'Semua tanggal';
  return `${st.dari ? fmtDate(st.dari) : 'awal'} s/d ${st.sampai ? fmtDate(st.sampai) : 'sekarang'}`;
}

// ── muat data ───────────────────────────────────────────────────────────────
async function load() {
  const my = ++reqId;
  $('ps-table').classList.add('ps-busy');
  $('ps-stats').classList.add('ps-busy');
  clearError();
  renderCats();
  renderActive();
  try {
    const params = filterParams();
    const key = JSON.stringify(params);
    const hit = swrCache.get(key);
    const applyResult = (res) => {
      data = res || {};
      rows = (data.rows || []).map((r) => {
        const set = num(r.set_terkirim) + num(r.set_proses);
        const pcs = num(r.pcs_terkirim) + num(r.pcs_proses);
        return Object.assign({}, r, { set, pcs, total: set + pcs });
      });
      unmapped = data.belum_terpetakan || [];
      detailCache.clear();
      linesAll = null;
      recon = {};
      applySort();
      render();
    };
    if (hit) applyResult(hit.res);      // tampilkan hasil terakhir seketika, lalu segarkan di belakang
    const res = await rpc('get_populasi_v2', params);
    if (my !== reqId) return;           // respons telat tidak boleh menimpa yang lebih baru
    const json = JSON.stringify(res || {});
    swrCache.delete(key);
    swrCache.set(key, { res, json });
    while (swrCache.size > SWR_MAX) swrCache.delete(swrCache.keys().next().value);
    if (!hit || hit.json !== json) applyResult(res);   // data sama -> tidak render ulang (baris terbuka tetap)
  } catch (e) {
    if (my !== reqId || String(e.message).startsWith('unauthorized')) return;
    const missing = e.code === 'PGRST202' || e.status === 404;
    const msg = missing
      ? 'RPC get_populasi_v2 belum terpasang. Jalankan populasi_v2.sql di Supabase SQL Editor.'
      : 'Gagal memuat data: ' + e.message;
    showError(msg);
    if (!data) {
      renderHead({ set: false, pcs: false, n: 5 });
      $('ps-body').innerHTML = `<tr><td colspan="5" class="ps-empty ps-empty-err">${esc(msg)}<br><button type="button" class="btn btn-ghost ps-retry" data-action="ps-reload">Coba lagi</button></td></tr>`;
    }
  } finally {
    if (my === reqId) { $('ps-table').classList.remove('ps-busy'); $('ps-stats').classList.remove('ps-busy'); }
  }
}

// ── urutan ──────────────────────────────────────────────────────────────────
function applySort() {
  const { k, dir } = state.sort;
  const m = dir === 'asc' ? 1 : -1;
  const val = (r) => {
    if (k === 'customer') return r.customer.toLowerCase();
    if (k === 'wilayah') return ((r.provinsi || '~') + ' ' + (r.kab_kota || '')).toLowerCase();
    if (k === 'terakhir') return r.terakhir || '';
    if (k === 'set') return r.set;
    if (k === 'pcs') return r.pcs;
    return r.total;
  };
  rows.sort((a, b) => {
    const x = val(a), y = val(b);
    if (x < y) return -m;
    if (x > y) return m;
    return a.customer.localeCompare(b.customer, 'id');
  });
}

// ── render ──────────────────────────────────────────────────────────────────
function render() {
  if (state.tinjau && angkaServer(state.tinjau) <= 0) state.tinjau = '';   // masalahnya sudah tidak ada pada filter ini
  renderProvinsi();
  renderCats();
  renderFreshness();
  renderSummary();
  renderTable();
  renderUnmapped();
}

function renderProvinsi() {
  const opsi = data.opsi_provinsi || [];
  const names = new Set(opsi.map((o) => o.provinsi));
  let html = '<option value="">Semua provinsi</option>' +
    opsi.map((o) => `<option value="${esc(o.provinsi)}">${esc(o.provinsi)} (${fmt(o.jumlah_rs)} RS)</option>`).join('');
  if (state.provinsi && !names.has(state.provinsi)) {
    html += `<option value="${esc(state.provinsi)}">${esc(state.provinsi)} (0 RS)</option>`;
  }
  const sel = $('ps-provinsi');
  sel.innerHTML = html;
  sel.value = state.provinsi;
}

// Chip kategori: angka kecil = jumlah RS yang punya kategori itu pada filter lain yang aktif.
function renderCats() {
  const el = $('ps-cats');
  if (!el) return;
  const cnt = {};
  ((data && data.opsi_kelompok) || []).forEach((o) => { cnt[o.kelompok] = o; });
  const all = !state.kelompok.length;
  let html = `<button type="button" class="filter-btn ps-cat${all ? ' active' : ''}" aria-pressed="${all}" data-action="ps-cat" data-k="">Semua</button>`;
  html += KELOMPOK.map((k) => {
    const on = state.kelompok.includes(k.id);
    const n = cnt[k.id] ? num(cnt[k.id].jumlah_rs) : 0;
    const dim = data && !n ? ' dim' : '';
    const badge = data ? `<span class="ps-cat-n" title="${fmt(n)} RS">${fmt(n)}</span>` : '';
    return `<button type="button" class="filter-btn ps-cat${on ? ' active' : ''}${dim}" aria-pressed="${on}" data-action="ps-cat" data-k="${esc(k.id)}">${esc(k.nama)}${badge}</button>`;
  }).join('');
  el.innerHTML = html;
}

// Filter yang sedang aktif, masing-masing bisa dilepas (atau lepas semua sekaligus).
function renderActive() {
  const el = $('ps-active');
  if (!el) return;
  const a = [];
  if (state.produk.trim()) a.push({ k: 'produk', t: `Cari: ${state.produk.trim()}` });
  if (state.produk.trim() && state.isiSet) a.push({ k: 'isi', t: 'Termasuk isi set' });
  if (state.rs.trim()) a.push({ k: 'rs', t: `RS: ${state.rs.trim()}` });
  if (state.dari || state.sampai) a.push({ k: 'periode', t: `Periode: ${periodeText()}` });
  if (state.cakupan === 'SEMUA') a.push({ k: 'cakupan', t: 'Termasuk retail' });
  el.hidden = !a.length;
  el.innerHTML = a.map((c) =>
    `<span class="ps-chip">${esc(c.t)}<button type="button" data-action="ps-clear" data-k="${c.k}" aria-label="Lepas filter ${esc(c.t)}"><i class="ti ti-x"></i></button></span>`
  ).join('') + (a.length > 1 ? '<button type="button" class="btn-clear-all" data-action="ps-clear" data-k="semua">Lepas semua</button>' : '');
}

// Data di DB bisa tertinggal dari Google Sheet (sinkron berjalan terpisah) -- jangan disembunyikan.
function renderFreshness() {
  const dp = toDate(data.data_per);
  $('ps-data-per').textContent = dp ? 'Data per ' + fmtDate(data.data_per) : 'Data per —';
  const note = $('ps-stale');
  const days = dp ? Math.floor((Date.now() - dp.getTime()) / 86400000) : null;
  if (days !== null && days > STALE_DAYS) {
    note.hidden = false;
    note.innerHTML = `Data di database terakhir diperbarui <b>${fmt(days)} hari lalu</b> ` +
      `(${esc(fmtDate(data.data_per))}); PO terbaru yang tercatat ${esc(fmtDate(data.po_terbaru))}. ` +
      `Isi Google Sheet bisa lebih baru dari yang tampil di sini.`;
  } else {
    note.hidden = true;
    note.textContent = '';
  }
}

// ── daftar tinjau: "perlu dicek", "perkiraan" ──────────────────
// Tiap kunci = satu angka di halaman yang bisa dibuka daftarnya. Predikat memakai aturan yang sama
// dengan detail per RS dan Excel (status_hitung).
const TIP = {
  cek: 'QTY di sheet tidak sepakat dengan isi set, atau ada item di luar isi set. Belum dihitung sebagai set.',
  estimasi: 'Set ini tidak ada di daftar produk, jadi jumlahnya dihitung dari perkiraan QTY.',
  ok_beda: 'Dihitung dari item yang cocok dengan isi set. Ada item di sheet yang tidak ada di isi set (mis. substitusi produk).',
};
const TINJAU = {
  cek:      { tabel: 'Pesanan set perlu dicek', frasa: 'perlu dicek', pred: (l) => l.kind === 'SET' && l.status_hitung === 'cek' },
  estimasi: { tabel: 'Pesanan set dengan hitungan perkiraan', frasa: 'dengan hitungan perkiraan', pred: (l) => l.kind === 'SET' && l.status_hitung === 'estimasi' },
};
// Angka dari server (ringkasan). cek = jumlah pesanan; estimasi = jumlah SET perkiraan.
function angkaServer(k) {
  const s = (data && data.ringkasan) || {};
  return num(k === 'cek' ? s.set_cek : s.set_estimasi);
}
// Angka yang ditampilkan di kartu: angka server, kecuali sudah dicocokkan dengan daftar.
const angka = (k) => (recon[k] !== undefined ? recon[k] : angkaServer(k));

// Kartu ringkasan. Kartu yang bisa diklik adalah <button> sungguhan (o.tinjau = daftar yang dibuka);
// kartu lain murni angka dan tidak diberi gaya klik.
function statCard(val, label, o = {}) {
  const sub = o.sub ? `<div class="stat-sub">${esc(o.sub)}</div>` : '';
  const inner = `<div class="stat-val">${val}</div><div class="stat-label">${esc(label)}</div>${sub}${o.subHtml || ''}`;
  if (o.tinjau) {
    return `<button type="button" class="stat-card ps-stat-act${o.warn ? ' ps-stat-warn' : ''}${o.on ? ' on' : ''}" data-action="ps-tinjau" data-k="${o.tinjau}" aria-pressed="${!!o.on}" title="${esc(TIP[o.tinjau])}">${inner}<div class="ps-stat-go">${o.on ? 'Sedang ditampilkan' : 'Lihat daftar'}</div></button>`;
  }
  return `<div class="stat-card">${inner}</div>`;
}

function linkBtn(k, teks) {
  const on = state.tinjau === k;
  return `<button type="button" class="ps-linkbtn${on ? ' on' : ''}" data-action="ps-tinjau" data-k="${k}" aria-pressed="${on}" title="${esc(TIP[k])}">${esc(teks)}</button>`;
}

function renderSummary() {
  const s = data.ringkasan || {};
  const hasSet = num(s.set_total) > 0 || num(s.set_cek) > 0;
  const hasPcs = num(s.pcs_total) > 0;
  const lokasi = state.provinsi || 'Semua provinsi';
  const status = state.status === 'ALL';

  $('ps-sum-main').innerHTML = `<b>${esc(kategoriText())}</b> <span class="ps-sep">·</span> ${esc(lokasi)}`;

  const cards = [statCard(fmt(s.jumlah_rs), 'Rumah sakit', { sub: rows.length ? '' : 'tidak ada yang cocok' })];
  if (hasSet) {
    const perk = angka('estimasi');
    cards.push(statCard(fmt(s.set_total), 'Set', {
      sub: status ? `${fmt(s.set_terkirim)} terkirim · ${fmt(s.set_proses)} proses` : '',
      subHtml: perk > 0 ? linkBtn('estimasi', `${fmt(perk)} di antaranya perkiraan`) : '',
    }));
  }
  if (hasPcs) {
    cards.push(statCard(fmt(s.pcs_total), 'Unit/pcs', { sub: status ? `${fmt(s.pcs_terkirim)} terkirim · ${fmt(s.pcs_proses)} proses` : '' }));
  }
  if (hasSet || hasPcs) {
    const last = rows.reduce((m, r) => (r.terakhir && r.terakhir > m ? r.terakhir : m), '');
    cards.push(statCard(fmt(s.jumlah_pesanan), 'Pesanan', { sub: last ? 'terakhir ' + fmtDate(last) : '' }));
  }
  const cek = angka('cek');
  if (cek > 0) cards.push(statCard(fmt(cek), 'Pesanan set perlu dicek', { sub: 'belum dihitung sebagai set', warn: true, tinjau: 'cek', on: state.tinjau === 'cek' }));
  $('ps-stats').innerHTML = cards.join('');

  // Tidak ada catatan hitungan tambahan: semua pesanan masuk hitungan atau tampil sebagai "perlu dicek".
  const cv = $('ps-caveats');
  cv.hidden = true;
  cv.innerHTML = '';

  const xl = document.querySelector('[data-action="ps-xlsx"]');
  if (xl) xl.disabled = !rows.length;
}

function rincianText(r, sep = ', ') {
  return (r.rincian || []).map((j) => `${j.label} ×${fmt(j.nilai)}`).join(sep);
}

function sortTh(key, label, cls) {
  const on = state.sort.k === key;
  const aria = on ? (state.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
  const icon = on ? (state.sort.dir === 'asc' ? 'ti-sort-ascending' : 'ti-sort-descending') : 'ti-arrows-sort';
  return `<th class="${cls}" aria-sort="${aria}"><button type="button" class="ps-sort${on ? ' on' : ''}" data-action="ps-sort" data-k="${key}" title="Urutkan menurut ${esc(label.toLowerCase())}">${esc(label)}<i class="ti ${icon}" aria-hidden="true"></i></button></th>`;
}

function renderHead(cols) {
  $('ps-thead').innerHTML = '<tr>' +
    sortTh('customer', 'Rumah sakit', '') +
    sortTh('wilayah', 'Wilayah', '') +
    (cols.set ? sortTh('set', 'Set', 'ps-th-num') : '') +
    (cols.pcs ? sortTh('pcs', 'Unit/pcs', 'ps-th-num') : '') +
    '<th>Rincian</th>' +
    sortTh('terakhir', 'Terakhir', '') +
    '<th class="ps-col-act"><span class="ps-sr">Aksi</span></th>' +
    '</tr>';
}

function colsInfo() {
  const s = (data && data.ringkasan) || {};
  const set = num(s.set_total) > 0 || num(s.set_cek) > 0;
  const pcs = num(s.pcs_total) > 0;
  return { set, pcs, n: 5 + (set ? 1 : 0) + (pcs ? 1 : 0) };
}

function emptyMessage() {
  const tips = [];
  const p = state.produk.trim();
  if (p && !state.isiSet) tips.push('Coba centang “Termasuk isi set”.');
  if (p) tips.push('Coba kata kunci yang lebih pendek.');
  if (p && state.kelompok.length) tips.push('Coba lepas pilihan kategori.');
  if (state.status !== 'ALL') tips.push('Coba tambahkan pesanan yang masih dalam proses.');
  if (state.provinsi) tips.push('Coba pilih semua provinsi.');
  if (state.provinsi && unmapped.length) tips.push(`Ada ${fmt(unmapped.length)} RS yang wilayahnya belum diketahui (lihat bagian bawah).`);
  return 'Tidak ada RS yang cocok dengan filter ini.' + (tips.length ? '<br>' + esc(tips.join(' ')) : '');
}

// Penanda hitungan: SATU komponen (.ps-tag) dipakai di baris RS, baris pesanan, dan daftar tinjau.
// warn = perlu tindakan; polos = informasi.
function tagHitung(d) {
  if (d.kind !== 'SET') return '';
  if (d.status_hitung === 'cek') return `<span class="ps-tag warn" title="${esc(TIP.cek)}">Perlu dicek</span>`;
  if (d.status_hitung === 'estimasi') return `<span class="ps-tag" title="${esc(TIP.estimasi)}">Perkiraan</span>`;
  if (d.status_hitung === 'ok_beda') return `<span class="ps-tag" title="${esc(TIP.ok_beda)}">Isi beda</span>`;
  return '';
}

function renderTable() {
  if (state.tinjau) { renderReview(); return; }
  reviewReq++;                                  // batalkan daftar tinjau yang masih memuat
  $('ps-review-bar').hidden = true;
  $('ps-actions').hidden = false;
  const cols = colsInfo();
  renderHead(cols);
  $('ps-tbl-title').textContent = rows.length ? `${fmt(rows.length)} rumah sakit` : 'Rumah sakit';
  const body = $('ps-body');
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="${cols.n}" class="ps-empty">${emptyMessage()}</td></tr>`;
    return;
  }
  body.innerHTML = rows.map((r, i) => {
    // Wilayah hasil deteksi alamat adalah kondisi biasa (tanpa penanda); yang diberi penanda hanya
    // wilayah yang sudah dikoreksi manual dan wilayah yang belum diketahui.
    let wilayah;
    if (r.provinsi || r.kab_kota) {
      wilayah = esc([r.kab_kota, state.provinsi ? '' : r.provinsi].filter(Boolean).join(' · ') || r.provinsi);
      if (r.sumber_wilayah === 'manual') {
        wilayah += ' <span class="ps-tag ps-tag-inline" title="Wilayah ini sudah dikoreksi manual oleh tim">dikoreksi</span>';
      }
    } else {
      wilayah = '<span class="ps-tag warn" title="Wilayah RS ini belum diketahui. Arahkan ke baris lalu klik Ubah wilayah.">Belum diketahui</span>';
    }
    const editTip = r.sumber_wilayah === 'alamat'
      ? 'Wilayah terdeteksi otomatis dari alamat dan bisa salah. Klik untuk mengoreksi'
      : 'Ubah provinsi dan kab/kota rumah sakit ini';

    const rinci = r.rincian || [];
    const items = rinci.map((j, k) =>
      `<span class="ps-it"${k >= 2 ? ' hidden data-rest="1"' : ''}>${esc(j.label)} ×${fmt(j.nilai)}</span>`).join('');
    const more = rinci.length > 2
      ? `<button type="button" class="ps-more-btn" data-action="ps-more" data-n="${rinci.length - 2}" aria-expanded="false">+${rinci.length - 2} lainnya</button>`
      : '';

    const subSet = num(r.set_proses) > 0 ? `<span class="ps-sub">${fmt(r.set_terkirim)} terkirim, ${fmt(r.set_proses)} proses</span>` : '';
    const subCek = num(r.set_cek) > 0
      ? `<span class="ps-tag warn" title="${esc(TIP.cek + ' Buka baris untuk memeriksa isinya.')}">${fmt(r.set_cek)} perlu dicek</span>` : '';
    const subPcs = num(r.pcs_proses) > 0 ? `<span class="ps-sub">${fmt(r.pcs_terkirim)} terkirim, ${fmt(r.pcs_proses)} proses</span>` : '';
    const cell = (v, sub) => (v ? `<b>${fmt(v)}</b>${sub}` : '<span class="ps-muted">—</span>');
    return `
      <tr class="ps-row${num(r.set_cek) > 0 ? ' has-cek' : ''}" data-action="ps-toggle" data-idx="${i}">
        <td class="ps-col-rs"><button type="button" class="ps-rs-btn" data-action="ps-toggle" data-idx="${i}" aria-expanded="false" title="Lihat PO dan isinya"><i class="ti ti-chevron-right ps-chev" aria-hidden="true"></i><span class="ps-rs">${esc(r.customer)}</span></button></td>
        <td class="ps-col-wil">${wilayah}</td>
        ${cols.set ? `<td class="ps-num">${cell(r.set, subSet)}${subCek}</td>` : ''}
        ${cols.pcs ? `<td class="ps-num">${cell(r.pcs, subPcs)}</td>` : ''}
        <td class="ps-jenis"><div class="ps-jenis-list">${items}</div>${more}</td>
        <td class="ps-date">${esc(fmtDate(r.terakhir))}</td>
        <td class="ps-col-act"><button type="button" class="ps-rowact" data-action="ps-edit-wil" data-idx="${i}" title="${esc(editTip)}" aria-label="Ubah wilayah ${esc(r.customer)}"><i class="ti ti-pencil" aria-hidden="true"></i> Ubah wilayah</button></td>
      </tr>`;
  }).join('');
}

// ── daftar tinjau (mengganti tabel RS selama state.tinjau aktif) ─────────────
// Sumber: get_populasi_v2_baris pada filter yang sama dengan tabel, dibatasi ke RS yang tampil
// (sama dengan Excel). Angka kartu = jumlah baris daftar ini; kalau angka server berbeda,
// kartu disamakan dengan daftar dan selisihnya ditulis di bilah status (bukan disembunyikan).
async function fetchLines() {
  const params = filterParams();
  const key = JSON.stringify(params);
  if (linesAll && linesAll.key === key) return linesAll.list;
  const res = await rpc('get_populasi_v2_baris', params, EXPORT_TIMEOUT_MS);
  const dipilih = new Set(rows.map((x) => x.customer));
  const list = (res || []).filter((b) => dipilih.has(b.customer));
  linesAll = { key, list };
  return list;
}

const isiStat = (d) => {
  const isi = Array.isArray(d.isi) ? d.isi : [];
  // rasio yang paling sering muncul dianggap "acuan"; yang lain ditandai beda
  const freq = new Map();
  isi.forEach((x) => { if (x.rasio != null && num(x.dipesan) > 0) freq.set(num(x.rasio), (freq.get(num(x.rasio)) || 0) + 1); });
  let acuan = null, best = 0;
  freq.forEach((c, v) => { if (c > best) { best = c; acuan = v; } });
  const luar = isi.filter((x) => x.qty_set == null).length;
  const kurang = isi.filter((x) => x.qty_set != null && num(x.dipesan) === 0).length;
  const beda = isi.filter((x) => x.qty_set != null && num(x.dipesan) !== 0 && acuan != null && num(x.rasio) !== acuan).length;
  return { isi, acuan, luar, kurang, beda };
};

// Alasan satu pesanan, dalam kalimat biasa.
function alasanText(d) {
  if (d.kind !== 'SET') return '';
  if (d.status_hitung === 'estimasi') return 'Set tidak ada di daftar produk, jadi jumlahnya dihitung dari perkiraan QTY.';
  if (d.status_hitung === 'ok_beda') return 'Ada item di sheet yang tidak ada di isi set (mis. substitusi produk). Dihitung dari item yang cocok.';
  if (d.status_hitung === 'cek') {
    const st = isiStat(d);
    const rinci = [
      st.kurang ? `${st.kurang} item set tidak ada di sheet` : '',
      st.luar ? `${st.luar} item di sheet tidak ada di isi set` : '',
      st.beda ? 'QTY antar item tidak sepakat' : '',
    ].filter(Boolean);
    return 'Isi set beda dari yang dipesan' + (rinci.length ? ': ' + rinci.join('; ') : '') + '. Belum dihitung sebagai set.';
  }
  return '';
}

function jmlText(d) {
  const isSet = d.kind === 'SET';
  const sh = isSet ? d.status_hitung : '';
  return isSet ? ((sh === 'cek') ? '—' : `${fmt(d.nilai)} set`) : `${fmt(d.nilai)} pcs`;
}

function setTinjau(k) {
  state.tinjau = (!k || state.tinjau === k || !TINJAU[k]) ? '' : k;
  if (!data) return;
  renderSummary();
  renderTable();
  if (state.tinjau) { const bar = $('ps-review-bar'); if (bar && bar.scrollIntoView) bar.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
}

async function renderReview() {
  const k = state.tinjau;
  const cfg = TINJAU[k];
  const my = ++reviewReq;
  const reset = '<button type="button" class="btn btn-ghost" data-action="ps-tinjau-reset">Tampilkan semua rumah sakit</button>';
  const bar = $('ps-review-bar');
  const body = $('ps-body');
  $('ps-actions').hidden = true;
  $('ps-tbl-title').textContent = cfg.tabel;
  $('ps-thead').innerHTML = '<tr><th>Rumah sakit</th><th>No. RMP</th><th>Set / produk</th><th class="ps-th-num">Jumlah</th><th>Alasan</th><th>Tanggal</th></tr>';
  bar.hidden = false;
  bar.innerHTML = `<span class="ps-review-msg">Memuat pesanan ${esc(cfg.frasa)}…</span>${reset}`;
  body.innerHTML = '<tr><td colspan="6" class="ps-empty" role="status">Memuat pesanan…</td></tr>';

  let list;
  try {
    list = await fetchLines();
  } catch (e) {
    if (my !== reviewReq || String(e.message).startsWith('unauthorized')) return;
    bar.innerHTML = `<span class="ps-review-msg">Gagal memuat daftar pesanan.</span>${reset}`;
    body.innerHTML = `<tr><td colspan="6" class="ps-empty ps-empty-err">Gagal memuat daftar: ${esc(e.message)}</td></tr>`;
    return;
  }
  if (my !== reviewReq || state.tinjau !== k) return;

  const items = list.filter(cfg.pred).sort((a, b) =>
    String(a.customer).localeCompare(String(b.customer), 'id') ||
    String(b.tanggal || '').localeCompare(String(a.tanggal || '')) ||
    String(a.kode_rmp || '').localeCompare(String(b.kode_rmp || ''), 'id'));
  const hitung = k === 'estimasi' ? items.reduce((a, l) => a + num(l.nilai), 0) : items.length;
  const server = angkaServer(k);
  const sebelum = angka(k);
  if (hitung !== server) recon[k] = hitung; else delete recon[k];
  if (angka(k) !== sebelum) renderSummary();

  const msg = k === 'estimasi'
    ? `Menampilkan <b>${fmt(items.length)}</b> pesanan ${esc(cfg.frasa)} · <b>${fmt(hitung)}</b> set`
    : `Menampilkan <b>${fmt(items.length)}</b> pesanan ${esc(cfg.frasa)}`;
  const note = hitung !== server
    ? `<span class="ps-review-note">Ringkasan awal menyebut ${fmt(server)}; angka kartu sudah disesuaikan dengan daftar ini.</span>` : '';
  bar.innerHTML = `<span class="ps-review-msg">${msg}</span>${note}${reset}`;

  if (!items.length) {
    body.innerHTML = '<tr><td colspan="6" class="ps-empty">Tidak ada pesanan yang cocok pada filter ini.</td></tr>';
    return;
  }
  const wil = new Map(rows.map((x) => [x.customer, x]));
  body.innerHTML = items.map((l) => {
    const w = wil.get(l.customer) || {};
    const lokasi = [w.kab_kota || l.kab_kota, state.provinsi ? '' : (w.provinsi || l.provinsi)].filter(Boolean).join(' · ');
    const nama = l.kind === 'SET' ? l.label : l.produk;
    const asal = l.kind === 'SET' && l.label_asli ? `<span class="ps-sub">Dialihkan dari: ${esc(l.label_asli)}</span>` : '';
    return `
      <tr class="ps-rev-row">
        <td class="ps-col-rs"><span class="ps-rs">${esc(l.customer)}</span>${lokasi ? `<span class="ps-sub">${esc(lokasi)}</span>` : ''}</td>
        <td><span class="kode-text">${esc(l.kode_rmp || '—')}</span></td>
        <td>${esc(nama)}${asal}</td>
        <td class="ps-num">${esc(jmlText(l))}</td>
        <td class="ps-alasan">${tagHitung(l)}<span class="ps-alasan-t">${esc(alasanText(l))}</span>${isiHtml(l)}</td>
        <td class="ps-date">${esc(fmtDate(l.tanggal))}</td>
      </tr>`;
  }).join('');
}

function renderUnmapped() {
  const box = $('ps-unmapped');
  // Saat "semua provinsi", RS tanpa wilayah sudah ada di tabel (kolom Wilayah: Belum diketahui).
  if (!unmapped.length || !state.provinsi) { box.hidden = true; return; }
  const totSet = unmapped.reduce((a, u) => a + num(u.set_total), 0);
  const totPcs = unmapped.reduce((a, u) => a + num(u.pcs_total), 0);
  const tot = [totSet ? `${fmt(totSet)} set` : '', totPcs ? `${fmt(totPcs)} unit/pcs` : ''].filter(Boolean).join(' + ');
  box.hidden = false;
  $('ps-unm-title').innerHTML =
    `${fmt(unmapped.length)} RS belum diketahui wilayahnya ` +
    `(${esc(tot)}), <b>belum ikut</b> hasil per provinsi di atas`;
  $('ps-unm-list').innerHTML = `
    <table class="ps-unm-table"><tbody>
      ${unmapped.map((u, i) => {
        const v = [num(u.set_total) ? `${fmt(u.set_total)} set` : '', num(u.pcs_total) ? `${fmt(u.pcs_total)} unit/pcs` : ''].filter(Boolean).join(' + ');
        return `
        <tr>
          <td>${esc(u.customer)}</td>
          <td class="ps-num">${esc(v)}</td>
          <td class="ps-col-act"><button type="button" class="btn btn-ghost" data-action="ps-edit-unm" data-idx="${i}" aria-label="Tetapkan wilayah ${esc(u.customer)}">Tetapkan wilayah</button></td>
        </tr>`;
      }).join('')}
    </tbody></table>`;
}

// ── rincian satu RS ──────────────────────────────────────────────────────────
// Isi set di DB produk vs yang dipesan di sheet, supaya hitungan bisa dicek sendiri.
function isiHtml(d) {
  if (d.kind !== 'SET') return '';
  const { isi, acuan, luar, kurang } = isiStat(d);
  if (!isi.length) return '';
  const body = isi.map((x) => {
    const isLuar = x.qty_set == null;
    const isKurang = !isLuar && num(x.dipesan) === 0;
    const beda = !isLuar && !isKurang && acuan != null && num(x.rasio) !== acuan;
    const cls = isLuar ? 'ps-isi-luar' : (isKurang ? 'ps-isi-kurang' : (beda ? 'ps-isi-beda' : ''));
    const cat = isLuar ? 'tidak ada di isi set' : (isKurang ? 'tidak ada di sheet' : (beda ? 'tidak sepakat' : ''));
    return `<tr class="${cls}">
      <td><span class="kode-text">${esc(x.kode || '—')}</span></td>
      <td>${esc(x.nama || '')}</td>
      <td class="ps-num">${isLuar ? '—' : fmt(x.qty_set)}</td>
      <td class="ps-num">${isKurang ? '—' : fmt(x.dipesan)}</td>
      <td class="ps-num">${x.rasio == null || isKurang ? '—' : fmt(Math.round(num(x.rasio) * 100) / 100)}</td>
      <td class="ps-isi-cat">${cat}</td></tr>`;
  }).join('');
  const ringkas = [
    d.set_kode ? `acuan ${esc(d.set_kode)}` : '',
    kurang ? `${kurang} item set tidak ada di sheet` : '',
    luar ? `${luar} item sheet di luar isi set` : '',
  ].filter(Boolean).join(' · ');
  return `<details class="ps-isi"><summary>Isi set vs dipesan${ringkas ? ` <span class="ps-muted">(${ringkas})</span>` : ''}</summary>
    <table class="ps-isi-t"><thead><tr><th>Kode item</th><th>Nama item</th>
      <th class="ps-th-num">Isi/set</th><th class="ps-th-num">Dipesan</th><th class="ps-th-num">= set</th><th></th></tr></thead>
    <tbody>${body}</tbody></table></details>`;
}

// Sel "Kategori" di rincian PO: nama kategori + penanda "dikoreksi" (hanya di layar internal;
// Excel dan teks salinan tidak memuatnya).
function kelKategoriCell(d) {
  let h = esc(katName(d.kelompok));
  if (d.dikoreksi) {
    h += ` <span class="ps-tag ps-tag-inline" title="${esc('Kategori sudah dikoreksi tim. Menurut label di sheet: ' + katName(d.kelompok_asal))}">dikoreksi</span>`;
  }
  return h;
}

// SATU jalur koreksi per baris pesanan, bertuliskan jelas dan muncul saat baris di-hover/fokus:
//  • set  -> "Alihkan set"   (hitung set ini sebagai populasi set lain)
//  • pcs  -> "Ubah kategori" (pindahkan produk ini ke kategori lain)
// Keduanya membuka dialog Kelola produk, sudah terarah ke produk/set ini (editor yang sama dengan
// tombol Kelola produk di bawah halaman; tidak ada editor kedua).
function koreksiBtn(d, nama) {
  if (d.kind === 'SET') {
    const q = d.label_asli || d.label;
    const tip = d.label_asli ? 'Ubah atau lepas alihan set ini' : 'Hitung set ini sebagai populasi set lain. Jumlah set tidak berubah';
    return `<button type="button" class="ps-rowact" data-action="ps-kel-edit-row" data-tab="set" data-q="${esc(q)}" title="${esc(tip)}" aria-label="Alihkan set ${esc(q)}"><i class="ti ti-pencil" aria-hidden="true"></i> Alihkan set</button>`;
  }
  if (d.kind === 'PCS' && d.kelompok !== 'ISI SET' && d.kode_produk) {
    return `<button type="button" class="ps-rowact" data-action="ps-kel-edit-row" data-tab="kat" data-q="${esc(d.kode_produk)}" title="Pindahkan produk ini ke kategori lain" aria-label="Ubah kategori ${esc(nama)}"><i class="ti ti-pencil" aria-hidden="true"></i> Ubah kategori</button>`;
  }
  return '';
}

function detailHtml(list) {
  if (!list || !list.length) return '<div class="ps-detail-empty">Tidak ada pesanan pada filter ini.</div>';
  return `
    <table class="ps-dt">
      <thead><tr>
        <th>No. RMP</th><th>No. PO</th><th>Kategori</th><th>Jenis set / produk</th>
        <th class="ps-th-num">Jumlah</th><th>Hitungan</th><th>Status</th><th>Tanggal</th><th>Sheet</th>
        <th class="ps-col-act"><span class="ps-sr">Koreksi</span></th>
      </tr></thead>
      <tbody>
        ${list.map((d) => {
          const isSet = d.kind === 'SET';
          const nama = isSet ? d.label : d.produk;
          const sub = !isSet && (d.family || d.kode_produk)
            ? `<span class="ps-sub">${esc(d.family || d.kode_produk)}</span>`
            : (isSet && d.label_asli ? `<span class="ps-sub">Dialihkan dari: ${esc(d.label_asli)}</span>` : '');
          const cek = isSet && d.status_hitung === 'cek';
          return `
          <tr class="${cek ? 'is-cek' : ''}">
            <td><span class="kode-text">${esc(d.kode_rmp || '—')}</span></td>
            <td>${esc(d.po || '—')}</td>
            <td>${kelKategoriCell(d)}</td>
            <td>${esc(nama)}${sub}${isiHtml(d)}</td>
            <td class="ps-num">${esc(jmlText(d))}</td>
            <td>${tagHitung(d)}</td>
            <td><span class="ps-st">${d.status === 'TERKIRIM' ? 'Terkirim' : 'Proses'}</span></td>
            <td class="ps-date">${esc(fmtDate(d.tanggal))}</td>
            <td class="ps-date">${esc(d.sumber_sheet || '—')}</td>
            <td class="ps-col-act">${koreksiBtn(d, nama)}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

async function toggleDetail(idx) {
  const tr = document.querySelector(`tr.ps-row[data-idx="${idx}"]`);
  const r = rows[idx];
  if (!tr || !r) return;
  const next = tr.nextElementSibling;
  if (next && next.classList.contains('ps-detail-row')) {
    next.remove();
    const b0 = tr.querySelector('.ps-rs-btn');
    if (b0) b0.setAttribute('aria-expanded', 'false');
    tr.classList.remove('open');
    return;
  }
  const dtr = document.createElement('tr');
  dtr.className = 'ps-detail-row';
  dtr.innerHTML = `<td colspan="${colsInfo().n}"><div class="ps-detail ps-detail-loading" role="status"><i class="ti ti-loader-2 spinner" aria-hidden="true"></i> Memuat rincian…</div></td>`;
  tr.after(dtr);
  const b1 = tr.querySelector('.ps-rs-btn');
  if (b1) b1.setAttribute('aria-expanded', 'true');
  tr.classList.add('open');

  const params = Object.assign(filterParams(), { p_customer: r.customer });
  const key = JSON.stringify(params);
  const slot = dtr.querySelector('.ps-detail');
  try {
    let list = detailCache.get(key);
    if (!list) {
      list = await rpc('get_populasi_v2_baris', params);
      detailCache.set(key, list);
    }
    if (!dtr.isConnected) return;       // baris sudah dirender ulang / ditutup
    slot.innerHTML = detailHtml(list);
  } catch (e) {
    if (String(e.message).startsWith('unauthorized') || !dtr.isConnected) return;
    slot.innerHTML = `<div class="ps-detail-empty ps-empty-err">Gagal memuat rincian: ${esc(e.message)}</div>`;
  }
}

// ── koreksi wilayah ──────────────────────────────────────────────────────────
function editWilayah(customer, provinsi, kab) {
  const overlay = $('ps-wil-overlay');
  const sel = $('ps-wil-prov');
  const kabEl = $('ps-wil-kab');
  const err = $('ps-wil-err');
  const ok = $('ps-wil-ok');
  const cancel = $('ps-wil-cancel');
  const list = (data && data.provinsi_semua) || [];

  $('ps-wil-rs').textContent = customer;
  sel.innerHTML = '<option value="">— pilih provinsi —</option>' +
    list.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
  sel.value = provinsi || '';
  kabEl.value = kab || '';
  err.style.display = 'none';
  err.textContent = '';

  function close() {
    overlay.classList.remove('open');
    ok.removeEventListener('click', save);
    cancel.removeEventListener('click', close);
    overlay.removeEventListener('click', onOverlay);
    overlay.removeEventListener('keydown', onKey);
  }
  function onOverlay(e) { if (e.target === overlay) close(); }
  function onKey(e) {
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'Enter' && e.target.tagName !== 'SELECT') { e.preventDefault(); save(); }
  }
  async function save() {
    if (!sel.value) { err.textContent = 'Pilih provinsi dulu.'; err.style.display = 'block'; sel.focus(); return; }
    ok.disabled = true;
    try {
      await rpc('set_rs_wilayah', { p_customer: customer, p_provinsi: sel.value, p_kab_kota: kabEl.value.trim() || null });
      close();
      showToast(`Wilayah ${customer} disimpan`);
      await load();
    } catch (e) {
      if (String(e.message).startsWith('unauthorized')) return;
      err.textContent = e.message;
      err.style.display = 'block';
    } finally {
      ok.disabled = false;
    }
  }

  ok.addEventListener('click', save);
  cancel.addEventListener('click', close);
  overlay.addEventListener('click', onOverlay);
  overlay.addEventListener('keydown', onKey);
  overlay.classList.add('open');
  setTimeout(() => sel.focus(), 30);
}

// ── kelola produk: kategori produk + alihkan set ─────────────────────────────
// Dua tab di satu dialog, pola yang sama: cari, daftar, pensil -> form di bawah baris, Simpan/Batal.
//  • Kategori produk: koreksi kategori per PRODUK (kunci = kode tanpa spasi, nol di depan angka dibuang).
//  • Alihkan set: set custom yang sudah tidak dijual dihitung sebagai populasi set lain. Jumlah set tidak berubah.
// Data Google Sheet tidak diubah. Semua nilai dari DB lewat esc() / textContent.
const KAT_TARGET = KELOMPOK.filter((k) => k.id !== 'SET');
const kel = { tab: 'kat', q: '', kelompok: '', hanya: false, list: [], total: 0, tanpaKode: 0, edit: -1, draft: '', saran: [], match: '', opener: null };
let kelTimer = null;
let kelSaranTimer = null;
let kelReq = 0;
let kelKeyHandler = null;

const katAsal = (r) => (r.kelompok_asal || []).map(katName).join(', ');
const kelIsKat = () => kel.tab === 'kat';
const kelRow = () => kel.list[kel.edit];
const kelKodeKat = (r) => (r.ejaan && r.ejaan[0]) || r.kode_key;   // ejaan nyata dari sheet; server menormalkannya lagi

const KEL_TEKS = {
  kat: {
    sub: 'Betulkan kategori produk yang salah tag di sheet. Berlaku di hasil Populasi, Excel, dan teks salinan.',
    cari: 'Cari kode atau nama produk', hanya: 'Hanya yang dikoreksi',
    kosong: 'Tidak ada produk yang cocok.', kosongHanya: 'Belum ada koreksi.',
  },
  set: {
    sub: 'Set custom yang sudah tidak dijual bisa dihitung sebagai populasi set lain. Jumlah setnya tidak berubah; hanya nama set yang dihitung.',
    cari: 'Cari nama set, mis. kit atau dental', hanya: 'Hanya yang dialihkan',
    kosong: 'Tidak ada set yang cocok.', kosongHanya: 'Belum ada set yang dialihkan.',
  },
};

function katOptions(selected, placeholder) {
  return (placeholder ? '<option value="">Pilih kategori…</option>' : '') +
    KAT_TARGET.map((k) => `<option value="${esc(k.id)}"${k.id === selected ? ' selected' : ''}>${esc(k.nama)}</option>`).join('');
}

// Bagian dialog yang berubah menurut tab: judul tab, kolom, kotak cari, filter.
function kelRenderChrome() {
  const t = KEL_TEKS[kel.tab];
  ['kat', 'set'].forEach((k) => {
    const b = $('ps-kel-tab-' + k);
    b.setAttribute('aria-selected', String(k === kel.tab));
    b.tabIndex = k === kel.tab ? 0 : -1;
  });
  $('ps-kel-sub').textContent = t.sub;
  $('ps-kel-q').placeholder = t.cari;
  $('ps-kel-q').setAttribute('aria-label', t.cari);
  $('ps-kel-q').value = kel.q;
  $('ps-kel-hanya-t').textContent = t.hanya;
  $('ps-kel-hanya').checked = kel.hanya;
  const sel = $('ps-kel-kelompok');
  sel.hidden = !kelIsKat();
  if (kelIsKat()) {
    sel.innerHTML = '<option value="">Semua kategori</option>' +
      KAT_TARGET.map((k) => `<option value="${esc(k.id)}">${esc(k.nama)}</option>`).join('');
    sel.value = kel.kelompok;
  }
  $('ps-kel-thead').innerHTML = kelIsKat()
    ? '<tr><th>Produk</th><th>Kategori</th><th class="ps-kel-num">Pesanan</th><th class="ps-kel-act"><span class="ps-kel-sr">Ubah</span></th></tr>'
    : '<tr><th>Set</th><th>Dihitung sebagai</th><th class="ps-kel-num">Populasi</th><th class="ps-kel-act"><span class="ps-kel-sr">Ubah</span></th></tr>';
}

function kelRenderMeta() {
  const unit = kelIsKat() ? 'produk' : 'set';
  let t = kel.total > kel.list.length
    ? `${fmt(kel.list.length)} dari ${fmt(kel.total)} ${unit}, urut menurut jumlah RS`
    : `${fmt(kel.total)} ${unit}`;
  if (kelIsKat() && kel.tanpaKode > 0) t += ` · ${fmt(kel.tanpaKode)} baris pesanan tanpa kode tidak bisa dikoreksi`;
  $('ps-kel-meta').textContent = t;
}

function kelRowKat(r, i, open) {
  const sekarang = r.kelompok || [];
  const ej = r.ejaan || [];
  const ejHtml = (ej.length > 1 || (ej[0] && ej[0] !== r.kode_key))
    ? `<span class="ps-kel-sub">Di sheet: ${ej.slice(0, 3).map((e) => '“' + esc(e) + '”').join(' · ')}${ej.length > 3 ? ' +' + (ej.length - 3) : ''}</span>` : '';
  const nm = r.nama || [];
  let kelHtml = `<span class="ps-kel-strong">${esc(sekarang.map(katName).join(' / '))}</span>`;
  if (r.dikoreksi) kelHtml += `<span class="ps-kel-sub">Dikoreksi · di sheet: ${esc(katAsal(r))}</span>`;
  else if (sekarang.length > 1) kelHtml += '<span class="ps-kel-warn" title="Baris-baris produk ini diberi label kategori berbeda di sheet. Menyimpan koreksi menyeragamkan semuanya.">Label di sheet tidak konsisten</span>';
  return `<tr class="ps-kel-row${open ? ' is-open' : ''}" data-i="${i}">
    <td><span class="ps-kel-strong">${esc(nm[0] || r.kode_key)}</span><span class="ps-kel-sub"><span class="kode-text">${esc(r.kode_key)}</span></span>${ejHtml}</td>
    <td>${kelHtml}</td>
    <td class="ps-kel-num">${esc(fmt(r.baris))} baris<span class="ps-kel-sub">${esc(fmt(r.qty))} pcs · ${esc(fmt(r.jumlah_rs))} RS</span></td>
    <td class="ps-kel-act"><button type="button" class="ps-rowact" data-action="ps-kel-edit" data-i="${i}" aria-expanded="${open}" title="${open ? 'Tutup' : 'Pindahkan produk ini ke kategori lain'}" aria-label="Ubah kategori ${esc(r.kode_key)}">${open ? 'Tutup' : '<i class="ti ti-pencil" aria-hidden="true"></i> Ubah kategori'}</button></td>
  </tr>`;
}

function kelRowSet(r, i, open) {
  const v = (r.varian || []).filter((x) => x !== r.label);
  const sub = [
    v.length ? `<span class="ps-kel-sub">Ditulis juga: ${v.slice(0, 3).map(esc).join(' · ')}${v.length > 3 ? ' +' + (v.length - 3) : ''}</span>` : '',
    num(r.jumlah_asal) > 0 ? `<span class="ps-kel-sub">Menampung ${fmt(r.jumlah_asal)} set yang dialihkan ke sini</span>` : '',
  ].join('');
  const tujuan = r.target
    ? `<span class="ps-kel-strong">${esc(r.target)}</span><span class="ps-kel-sub">Dialihkan</span>`
    : '<span class="ps-kel-muted">Dihitung sendiri</span>';
  const cek = num(r.perlu_cek) > 0 ? `<span class="ps-kel-warn" title="${esc(TIP.cek)}">${fmt(r.perlu_cek)} pesanan perlu dicek</span>` : '';
  return `<tr class="ps-kel-row${open ? ' is-open' : ''}" data-i="${i}">
    <td><span class="ps-kel-strong">${esc(r.label)}</span>${sub}</td>
    <td>${tujuan}</td>
    <td class="ps-kel-num">${esc(fmt(r.jumlah_set))} set<span class="ps-kel-sub">${esc(fmt(r.jumlah_rs))} RS · ${esc(fmt(r.pesanan))} pesanan</span>${cek}</td>
    <td class="ps-kel-act"><button type="button" class="ps-rowact" data-action="ps-kel-edit" data-i="${i}" aria-expanded="${open}" title="${open ? 'Tutup' : 'Hitung set ini sebagai populasi set lain'}" aria-label="Alihkan set ${esc(r.label)}">${open ? 'Tutup' : '<i class="ti ti-pencil" aria-hidden="true"></i> Alihkan set'}</button></td>
  </tr>`;
}

function kelEditor(r) {
  const kat = kelIsKat();
  const kontrol = kat
    ? `<label class="ps-kel-lbl" for="ps-kel-draft">Pindahkan ke kategori</label>
       <select id="ps-kel-draft" class="field-input">${katOptions(kel.draft, !kel.draft)}</select>`
    : `<label class="ps-kel-lbl" for="ps-kel-draft">Hitung sebagai populasi set</label>
       <input id="ps-kel-draft" class="field-input" type="text" list="ps-kel-dl" autocomplete="off" placeholder="Ketik nama set tujuan, mis. dental" value="${esc(kel.draft)}">
       <datalist id="ps-kel-dl">${kelSaranHtml()}</datalist>`;
  const lepas = kat ? r.dikoreksi : !!r.target;
  return `<tr class="ps-kel-edit"><td colspan="4"><div class="ps-kel-form">
    ${kontrol}
    <p class="ps-kel-impact" id="ps-kel-impact"></p>
    <p class="ps-kel-err" id="ps-kel-err" role="alert" hidden></p>
    <div class="ps-kel-btns">
      ${lepas ? `<button type="button" class="btn btn-ghost" data-action="ps-kel-reset">${kat ? 'Kembalikan ke label sheet' : 'Lepas alihan'}</button>` : ''}
      <span class="ps-kel-grow"></span>
      <button type="button" class="btn btn-ghost" data-action="ps-kel-batal">Batal</button>
      <button type="button" class="btn btn-accent" id="ps-kel-ok" data-action="ps-kel-save" disabled>Simpan</button>
    </div>
  </div></td></tr>`;
}

function kelSaranHtml() {
  return kel.saran.map((x) => `<option value="${esc(x.label)}">${esc(fmt(x.jumlah_rs))} RS · ${esc(fmt(x.jumlah_set))} set</option>`).join('');
}

function kelRender() {
  const body = $('ps-kel-body');
  if (!kel.list.length) {
    const t = KEL_TEKS[kel.tab];
    body.innerHTML = `<tr><td colspan="4" class="ps-kel-empty">${esc(kel.hanya && !kel.q.trim() ? t.kosongHanya : t.kosong)}</td></tr>`;
    kelRenderMeta();
    return;
  }
  body.innerHTML = kel.list.map((r, i) => {
    const open = i === kel.edit;
    return (kelIsKat() ? kelRowKat(r, i, open) : kelRowSet(r, i, open)) + (open ? kelEditor(r) : '');
  }).join('');
  kelRenderMeta();
  if (kel.edit >= 0) kelEditSync();
}

// Dampak dan status tombol Simpan mengikuti isian; ditulis lewat textContent.
function kelEditSync() {
  const r = kelRow();
  const ok = $('ps-kel-ok');
  const imp = $('ps-kel-impact');
  if (!r || !ok || !imp) return;
  const d = kel.draft.trim();
  let changed = false;
  let teks = '';
  if (kelIsKat()) {
    const cur = (r.kelompok || []).length === 1 ? r.kelompok[0] : '';
    changed = !!d && d !== cur;
    if (changed) teks = `Seluruh baris produk ini (${fmt(r.baris)} baris, ${fmt(r.qty)} pcs, ${fmt(r.jumlah_rs)} RS) akan masuk ke ${katName(d)}.`;
  } else {
    changed = !!d && d.toLowerCase() !== String(r.target || '').toLowerCase();
    if (changed) teks = `${fmt(r.jumlah_set)} set di ${fmt(r.jumlah_rs)} RS akan dihitung sebagai “${d}”. Jumlah set tidak berubah dan isi setnya tidak dibandingkan dengan set tujuan.`;
  }
  ok.disabled = !changed;
  imp.textContent = teks;
}

function kelEditOpen(i, fokus) {
  const r = kel.list[i];
  if (!r) return;
  kel.edit = i;
  kel.draft = kelIsKat() ? ((r.kelompok || []).length === 1 ? r.kelompok[0] : '') : (r.target || '');
  kel.saran = [];
  kelRender();
  if (!kelIsKat()) kelCariSaran(kel.draft);
  if (fokus) setTimeout(() => { const el = $('ps-kel-draft'); if (el) el.focus(); }, 0);
}

function kelEditClose() {
  kel.edit = -1;
  kel.draft = '';
  clearTimeout(kelSaranTimer);
  kelRender();
}

// Saran set tujuan: set yang belum dialihkan, kecuali set ini sendiri. Memperbarui datalist tanpa merender ulang (fokus tetap).
async function kelCariSaran(teks) {
  const r = kelRow();
  if (!r || kelIsKat()) return;
  const idx = kel.edit;
  try {
    const res = await rpc('get_set_grup', { p_cari: teks.trim() || null, p_hanya_alih: false, p_untuk_tujuan: true, p_batas: 8 });
    if (kel.edit !== idx || kelRow() !== r) return;
    kel.saran = ((res && res.rows) || []).filter((x) => x.label_key !== r.label_key);
    const dl = $('ps-kel-dl');
    if (dl) dl.innerHTML = kelSaranHtml();
  } catch (e) { /* saran bersifat tambahan; kegagalan tidak perlu mengganggu pengisian */ }
}

async function kelLoad() {
  const my = ++kelReq;
  $('ps-kel-meta').textContent = 'Memuat…';
  try {
    const res = kelIsKat()
      ? await rpc('get_produk_kelompok', { p_cari: kel.q.trim() || null, p_kelompok: kel.kelompok || null, p_hanya_koreksi: !!kel.hanya, p_batas: 200 })
      : await rpc('get_set_grup', { p_cari: kel.q.trim() || null, p_hanya_alih: !!kel.hanya, p_untuk_tujuan: false, p_batas: 200 });
    if (my !== kelReq) return;
    kel.list = (res && res.rows) || [];
    kel.total = num(res && res.total);
    kel.tanpaKode = num(res && res.tanpa_kode);
    kel.edit = -1;
    kel.draft = '';
    let buka = -1;
    if (kel.match) {
      buka = kel.list.findIndex((r) => ((kelIsKat() ? r.ejaan : r.varian) || []).includes(kel.match));
      kel.match = '';
    }
    kelRender();
    if (buka >= 0) kelEditOpen(buka, true);
  } catch (e) {
    if (my !== kelReq || String(e.message).startsWith('unauthorized')) return;
    const hilang = e.code === 'PGRST202' || e.status === 404;
    kel.list = [];
    $('ps-kel-meta').textContent = '';
    const pesan = hilang
      ? (kelIsKat() ? 'RPC kategori produk belum terpasang. Jalankan 01_tabel_dan_rpc.sql.' : 'RPC alihkan set belum terpasang. Jalankan 07_alihkan_set.sql.')
      : 'Gagal memuat: ' + e.message;
    $('ps-kel-body').innerHTML = `<tr><td colspan="4" class="ps-kel-empty ps-kel-bad">${esc(pesan)}</td></tr>`;
  }
}

function kelOpen(opts = {}) {
  const ov = $('ps-kel-overlay');
  if (!ov) return;
  kel.opener = document.activeElement;
  kel.tab = opts.tab === 'set' ? 'set' : 'kat';
  kel.q = opts.q || '';
  kel.match = (opts.q || '').trim();
  kel.kelompok = '';
  kel.hanya = false;
  kel.edit = -1;
  kel.draft = '';
  kelRenderChrome();
  ov.classList.add('open');
  kelKeyHandler = (e) => { if (e.key === 'Escape') { e.stopPropagation(); kelClose(); } };
  ov.addEventListener('keydown', kelKeyHandler);
  setTimeout(() => { const q = $('ps-kel-q'); if (q) q.focus(); }, 30);   // bila editor terbuka otomatis, fokus berpindah ke sana
  kelLoad();
}

function kelClose() {
  const ov = $('ps-kel-overlay');
  if (!ov) return;
  ov.classList.remove('open');
  if (kelKeyHandler) { ov.removeEventListener('keydown', kelKeyHandler); kelKeyHandler = null; }
  clearTimeout(kelTimer);
  clearTimeout(kelSaranTimer);
  kelReq++;
  const o = kel.opener;
  kel.opener = null;
  if (o && o.isConnected && o.focus) o.focus();
}

function kelSetTab(tab) {
  if (tab === kel.tab) return;
  kel.tab = tab;
  kel.q = '';
  kel.kelompok = '';
  kel.hanya = false;
  kel.match = '';
  kel.edit = -1;
  kel.draft = '';
  kelRenderChrome();
  kelLoad();
}

function kelError(teks) {
  const el = $('ps-kel-err');
  if (!el) return;
  el.textContent = teks;
  el.hidden = !teks;
}

async function kelSimpan(reset) {
  const r = kelRow();
  if (!r) return;
  const ok = $('ps-kel-ok');
  const tombol = document.querySelectorAll('#ps-kel-body .ps-kel-btns button');
  const d = kel.draft.trim();
  if (!reset && !d) return;
  tombol.forEach((b) => { b.disabled = true; });
  kelError('');
  try {
    let pesan;
    if (kelIsKat()) {
      if (reset) { await rpc('hapus_produk_kelompok', { p_kode: kelKodeKat(r) }); pesan = `${r.kode_key} dikembalikan ke kategori di sheet`; }
      else { await rpc('set_produk_kelompok', { p_kode: kelKodeKat(r), p_kelompok: d, p_catatan: null }); pesan = `${r.kode_key} dipindah ke ${katName(d)}`; }
    } else if (reset) {
      await rpc('hapus_set_grup', { p_label: r.label }); pesan = `Alihan “${r.label}” dilepas`;
    } else {
      const res = await rpc('set_set_grup', { p_label: r.label, p_target: d, p_catatan: null });
      pesan = `“${r.label}” dihitung sebagai “${(res && res.target_label) || d}”`;
    }
    showToast(pesan);
    await kelLoad();
    load();                               // hasil Populasi di belakang dialog ikut diperbarui
  } catch (e) {
    if (String(e.message).startsWith('unauthorized')) return;
    kelError(e.message);
    tombol.forEach((b) => { b.disabled = false; });
    if (ok) kelEditSync();
  }
}

// Daftar koreksi (Excel) supaya yang meng-input di sheet bisa memperbaiki sumbernya.
async function kelUnduh(btn) {
  if (btn.disabled) return;
  btn.disabled = true;
  try {
    const aman = (p) => p.catch((e) => { if (String(e.message).startsWith('unauthorized')) throw e; return null; });
    const [rk, rs] = await Promise.all([
      aman(rpc('get_produk_kelompok', { p_cari: null, p_kelompok: null, p_hanya_koreksi: true, p_batas: 500 })),
      aman(rpc('get_set_grup', { p_cari: null, p_hanya_alih: true, p_untuk_tujuan: false, p_batas: 500 })),
    ]);
    const lk = (rk && rk.rows) || [];
    const ls = (rs && rs.rows) || [];
    if (!lk.length && !ls.length) { showToast('Belum ada koreksi atau alihan untuk diunduh', 'error'); return; }
    await loadScript(EXCELJS_SRC);
    if (!window.ExcelJS) throw new Error('library Excel tidak termuat');
    const wb = new window.ExcelJS.Workbook();
    const waktu = (v) => (v ? new Date(v).toLocaleString('id-ID') : '');
    const lembar = (nama, cols, rows) => {
      const ws = wb.addWorksheet(nama);
      ws.columns = cols;
      rows.forEach((x) => ws.addRow(x));
      ws.getRow(1).font = { bold: true };
      ws.views = [{ state: 'frozen', ySplit: 1 }];
    };
    if (lk.length) {
      lembar('Koreksi kategori', [
        { header: 'Kode produk', key: 'kode', width: 24 }, { header: 'Ejaan kode di sheet', key: 'ejaan', width: 34 },
        { header: 'Nama produk', key: 'nama', width: 48 }, { header: 'Kategori di sheet', key: 'asal', width: 26 },
        { header: 'Dikoreksi menjadi', key: 'ke', width: 22 }, { header: 'Baris pesanan', key: 'baris', width: 14 },
        { header: 'Jumlah (pcs)', key: 'qty', width: 14 }, { header: 'Jumlah RS', key: 'rs', width: 11 },
        { header: 'Diubah oleh', key: 'oleh', width: 28 }, { header: 'Waktu ubah', key: 'pada', width: 20 },
        { header: 'Catatan', key: 'catatan', width: 30 },
      ], lk.map((r) => ({
        kode: r.kode_key, ejaan: (r.ejaan || []).join(' | '), nama: (r.nama || []).join(' | '), asal: katAsal(r),
        ke: katName(r.koreksi_ke), baris: num(r.baris), qty: num(r.qty), rs: num(r.jumlah_rs),
        oleh: r.oleh || '', pada: waktu(r.pada), catatan: r.catatan || '',
      })));
    }
    if (ls.length) {
      lembar('Alihan set', [
        { header: 'Nama set di sheet', key: 'label', width: 34 }, { header: 'Ditulis juga', key: 'varian', width: 40 },
        { header: 'Dihitung sebagai', key: 'target', width: 34 }, { header: 'Jumlah set', key: 'set', width: 12 },
        { header: 'Jumlah RS', key: 'rs', width: 11 }, { header: 'Pesanan', key: 'pesanan', width: 11 },
        { header: 'Diubah oleh', key: 'oleh', width: 28 }, { header: 'Waktu ubah', key: 'pada', width: 20 },
        { header: 'Catatan', key: 'catatan', width: 30 },
      ], ls.map((r) => ({
        label: r.label, varian: (r.varian || []).filter((x) => x !== r.label).join(' | '), target: r.target,
        set: num(r.jumlah_set), rs: num(r.jumlah_rs), pesanan: num(r.pesanan),
        oleh: r.oleh || '', pada: waktu(r.pada), catatan: r.catatan || '',
      })));
    }
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const name = `koreksi-produk-${localISODate()}.xlsx`;
    saveBlob(blob, name);
    showToast(`${name} diunduh`);
  } catch (e) {
    if (String(e.message).startsWith('unauthorized')) return;
    showToast('Gagal membuat Excel: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

// ── salin teks ───────────────────────────────────────────────────────────────
function buildText() {
  const s = data.ringkasan || {};
  const lines = [];
  lines.push(`Populasi ${kategoriText()} — ${state.provinsi || 'Semua provinsi'}`);
  let sub = state.status === 'ALL' ? 'Terkirim + dalam proses' : 'Terkirim';
  if (state.produk.trim()) sub += `, produk “${state.produk.trim()}”${state.isiSet ? ' (termasuk isi set)' : ''}`;
  if (state.dari || state.sampai) sub += `, ${periodeText()}`;
  sub += `, data per ${fmtDate(data.data_per)}`;
  lines.push(sub, '');
  rows.forEach((r, i) => {
    const jml = [r.set ? `${fmt(r.set)} set` : '', r.pcs ? `${fmt(r.pcs)} pcs` : ''].filter(Boolean).join(' + ');
    const rinci = rincianText(r);
    lines.push(`${i + 1}. ${r.customer}${r.kab_kota ? ` (${r.kab_kota})` : ''}${state.provinsi ? '' : ` [${r.provinsi || 'wilayah belum diketahui'}]`} — ${jml}${rinci ? ` (${rinci})` : ''}`);
  });
  const tot = [num(s.set_total) ? `${fmt(s.set_total)} set${num(s.set_estimasi) > 0 ? ` (${fmt(s.set_estimasi)} di antaranya estimasi)` : ''}` : '', num(s.pcs_total) ? `${fmt(s.pcs_total)} unit/pcs` : ''].filter(Boolean).join(' + ');
  lines.push('', `Total: ${fmt(s.jumlah_rs)} RS, ${tot}`);
  if (num(s.set_cek) > 0) lines.push(`Catatan: ${fmt(s.set_cek)} pesanan set perlu dicek dan belum dihitung.`);
  if (state.provinsi && unmapped.length) lines.push(`Catatan: ${fmt(unmapped.length)} RS lain belum diketahui wilayahnya, belum termasuk.`);
  return lines.join('\n');
}

async function copyText() {
  if (!data || !rows.length) { showToast('Belum ada data untuk disalin', 'error'); return; }
  try {
    await navigator.clipboard.writeText(buildText());
    showToast(`Daftar ${fmt(rows.length)} RS disalin`);
  } catch (e) {
    showToast('Gagal menyalin', 'error');
  }
}

// ── unduh Excel ──────────────────────────────────────────────────────────────
// File ini dibaca ORANG LUAR (calon pembeli), bukan tim internal. Jadi:
//  - bahasa biasa, tanpa istilah internal (FPB, RMP, "item lepas", "ok_beda", dst);
//  - sheet berurutan dari yang paling penting: Ringkasan -> Daftar RS -> Rincian Pesanan;
//  - angka tetap angka (bisa difilter/dijumlah), 0 tampil "–", total mengikuti filter;
//  - kolom teknis (kode RMP, sheet sumber, dst) dipisah ke kanan dengan header abu-abu;
//  - siap cetak: landscape, lebar muat 1 halaman, header tabel berulang, nomor halaman.

// Tanggal ke sel Excel harus UTC tengah malam, kalau tidak bergeser sehari di zona WIB.
function xlDate(s) {
  const d = toDate(s);
  return d ? new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) : null;
}

const XL = {
  navy: 'FF1B2A4A', ink: 'FF0B1220', soft: 'FF64748B', line: 'FFE2E4E9',
  band: 'FFF5F6F8', hint: 'FFEAF2FF', warn: 'FFB45309', white: 'FFFFFFFF',
};
const XL_NUM = '#,##0';
const XL_NUMZ = '#,##0;-#,##0;"–"';     // nol tampil strip, supaya angka yang ada langsung terlihat
const XL_DATE = 'dd mmm yyyy';
const xlFill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const xlLine = { style: 'thin', color: { argb: XL.line } };

// Pesanan yang tidak ikut hitungan set (sama dengan aturan di sisi database).
const dihitung = (l) => !(l.kind === 'SET' && l.status_hitung === 'cek');

// Keterangan per baris pesanan, dalam bahasa yang bisa dipahami pembaca luar.
function ketBaris(l) {
  if (l.kind !== 'SET') return '';
  if (l.status_hitung === 'cek') return 'Belum dihitung: jumlah item tidak sesuai isi set, perlu dicek';
  if (l.status_hitung === 'ok_beda') return 'Dihitung dari item yang sesuai isi set; ada item pengganti atau di luar isi set';
  if (l.status_hitung === 'estimasi') return 'Perkiraan: isi set ini belum terdaftar di database produk';
  return '';
}

// Perkiraan jumlah baris teks setelah di-wrap, untuk menentukan tinggi baris secara eksplisit
// (supaya tampilannya sama di Excel, LibreOffice, Google Sheets, dan Numbers).
function wrapLines(text, width) {
  return String(text == null ? '' : text).split('\n')
    .reduce((a, p) => a + Math.max(1, Math.ceil(p.length / Math.max(1, width * 1.05))), 0);
}

async function buildWorkbook(ctx) {
  const { rows: R, data: D, st, unmapped: U } = ctx;
  // Provinsi/Kab-Kota ikut ke tiap baris pesanan supaya sheet Rincian bisa difilter per wilayah.
  const wil = new Map(R.map((x) => [x.customer, x]));
  const lines = ctx.lines.map((b) => {
    const w = wil.get(b.customer) || {};
    return Object.assign({}, b, { provinsi: b.provinsi || w.provinsi || '', kab_kota: b.kab_kota || w.kab_kota || '' });
  });
  const ExcelJS = window.ExcelJS;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Populasi PNM';
  wb.created = new Date();
  wb.title = `Populasi ${kategoriText(st)} - ${st.provinsi || 'Semua provinsi'}`;

  const s = D.ringkasan || {};
  const hasSet = num(s.set_total) > 0 || num(s.set_cek) > 0;
  const hasPcs = num(s.pcs_total) > 0;
  const semuaStatus = st.status === 'ALL';
  const lokasi = st.provinsi || 'Semua provinsi';
  const statusText = semuaStatus ? 'terkirim dan dalam proses' : 'terkirim saja';
  const subLine = `${kategoriText(st)} · ${lokasi} · ${statusText} · data per ${fmtDate(D.data_per)}`;
  const footTxt = `Populasi ${kategoriText(st)} - ${lokasi} - diunduh ${localISODate()}`.replace(/&/g, '&&');
  const FOOT = { oddFooter: `&L&8${footTxt}&R&8Halaman &P dari &N` };
  const page = (orientation) => ({
    paperSize: 9, orientation, fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
  });

  // Bahan sheet opsional, dihitung dulu supaya Ringkasan bisa menyebut sheet mana saja yang ada.
  const urut = KELOMPOK.map((k) => k.id).concat('ISI SET');
  const present = urut.filter((id) => lines.some((l) => l.kelompok === id && dihitung(l) && num(l.nilai) > 0));
  const adaMatriks = present.length >= 2;
  const adaBelumPeta = !!(st.provinsi && U.length);

  // Perkiraan set per RS (dari rincian), untuk kolom Keterangan.
  const estimasi = new Map();
  lines.forEach((l) => {
    if (l.kind === 'SET' && l.status_hitung === 'estimasi') {
      estimasi.set(l.customer, (estimasi.get(l.customer) || 0) + num(l.nilai));
    }
  });

  // ═══ 1) RINGKASAN ═══════════════════════════════════════════════════════════
  const w0 = wb.addWorksheet('Ringkasan', { views: [{ showGridLines: false }], pageSetup: page('portrait'), headerFooter: FOOT });
  w0.columns = [{ width: 46 }, { width: 22 }, { width: 16 }, { width: 16 }, { width: 16 }];
  let r = 1;

  function wide(text, o = {}) {
    w0.mergeCells(r, 1, r, 5);
    const c = w0.getCell(r, 1);
    c.value = text;
    c.font = { size: o.size || 11, bold: !!o.bold, color: { argb: o.color || XL.ink } };
    c.alignment = { wrapText: true, vertical: 'middle', horizontal: 'left', indent: o.indent || 0 };
    if (o.fill) c.fill = xlFill(o.fill);
    w0.getRow(r).height = o.height || Math.max(18, wrapLines(text, 105 / ((o.size || 11) / 11)) * 15 + 4);
    r++;
  }
  function section(t) {
    r++;
    const row = w0.getRow(r);
    for (let i = 1; i <= 5; i++) row.getCell(i).border = { bottom: { style: 'medium', color: { argb: XL.navy } } };
    row.getCell(1).value = t;
    row.getCell(1).font = { bold: true, size: 12, color: { argb: XL.navy } };
    row.height = 22;
    r++;
  }
  function kv(k, v, f, note) {
    const row = w0.getRow(r++);
    row.getCell(1).value = k;
    row.getCell(1).font = { color: { argb: XL.soft } };
    const c = row.getCell(2);
    c.value = v;
    c.font = { bold: true, color: { argb: XL.ink } };
    c.alignment = { horizontal: 'left' };
    if (f) c.numFmt = f;
    if (note) { row.getCell(3).value = note; row.getCell(3).font = { size: 10, color: { argb: XL.soft } }; }
    row.height = 18;
  }
  function miniTable(heads, aligns, body) {
    const hr = w0.getRow(r++);
    hr.height = 22;
    heads.forEach((h, i) => {
      const c = hr.getCell(i + 1);
      c.value = h;
      c.font = { bold: true, size: 10.5, color: { argb: XL.white } };
      c.fill = xlFill(XL.navy);
      c.alignment = { vertical: 'middle', horizontal: aligns[i] };
    });
    body.forEach((vals) => {
      const row = w0.getRow(r++);
      row.height = 18;
      vals.forEach((v, i) => {
        const c = row.getCell(i + 1);
        c.value = v;
        c.border = { bottom: xlLine };
        c.alignment = { vertical: 'middle', horizontal: aligns[i] };
        if (typeof v === 'number') c.numFmt = XL_NUMZ;
      });
    });
  }

  // Judul + kalimat jawaban
  w0.getCell(r, 1).value = `Populasi ${kategoriText(st)}`;
  w0.getCell(r, 1).font = { bold: true, size: 18, color: { argb: XL.ink } };
  w0.getRow(r++).height = 30;
  w0.getCell(r, 1).value = `${lokasi}  ·  data per ${fmtDate(D.data_per)}  ·  diunduh ${new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  w0.getCell(r, 1).font = { size: 10.5, color: { argb: XL.soft } };
  w0.getRow(r++).height = 18;
  r++;

  const angka = [];
  if (hasSet) angka.push(`${fmt(s.set_total)} set`);
  if (hasPcs) angka.push(`${fmt(s.pcs_total)} unit/pcs`);
  const jawaban = angka.length
    ? `${angka.join(' dan ')} di ${fmt(s.jumlah_rs)} rumah sakit ${st.provinsi ? 'di ' + st.provinsi : 'di semua provinsi'}, ` +
      (semuaStatus ? 'termasuk pesanan yang masih dalam proses.' : 'hanya pesanan yang sudah terkirim.')
    : 'Tidak ada pesanan yang cocok dengan filter ini.';
  wide(jawaban, { size: 13, bold: true, fill: XL.hint, height: Math.max(40, wrapLines(jawaban, 85) * 19 + 8) });

  section('Hasil');
  kv('Rumah sakit', num(s.jumlah_rs), XL_NUM);
  if (hasSet) kv('Set', num(s.set_total), XL_NUM, num(s.set_estimasi) > 0 ? `${fmt(s.set_estimasi)} di antaranya perkiraan` : '');
  if (hasSet && semuaStatus) { kv('   sudah terkirim', num(s.set_terkirim), XL_NUM); kv('   masih dalam proses', num(s.set_proses), XL_NUM); }
  if (hasPcs) kv('Unit/pcs', num(s.pcs_total), XL_NUM);
  if (hasPcs && semuaStatus) { kv('   sudah terkirim', num(s.pcs_terkirim), XL_NUM); kv('   masih dalam proses', num(s.pcs_proses), XL_NUM); }
  kv('Jumlah pesanan', num(s.jumlah_pesanan), XL_NUM);
  const terakhir = R.reduce((m, x) => (x.terakhir && x.terakhir > m ? x.terakhir : m), '');
  if (terakhir) kv('Pesanan terakhir', xlDate(terakhir), XL_DATE);

  if (R.length > 5) {
    section(`${Math.min(10, R.length)} rumah sakit dengan jumlah terbanyak`);
    const top = R.slice().sort((a, b) => b.total - a.total || a.customer.localeCompare(b.customer, 'id')).slice(0, 10);
    miniTable(
      ['Rumah sakit', 'Kab/Kota'].concat(hasSet ? ['Set'] : [], hasPcs ? ['Unit/pcs'] : []),
      ['left', 'left'].concat(hasSet ? ['right'] : [], hasPcs ? ['right'] : []),
      top.map((x) => [x.customer, x.kab_kota || ''].concat(hasSet ? [x.set] : [], hasPcs ? [x.pcs] : [])));
    wide('Daftar lengkap ada di sheet “Daftar RS”.', { size: 10, color: XL.soft });
  }

  if (!st.provinsi && R.length) {
    section('Per provinsi');
    const g = new Map();
    R.forEach((x) => {
      const k = x.provinsi || 'Belum diketahui';
      const o = g.get(k) || { rs: 0, set: 0, pcs: 0 };
      o.rs += 1; o.set += x.set; o.pcs += x.pcs;
      g.set(k, o);
    });
    const body = Array.from(g.entries())
      .sort((a, b) => (b[1].set + b[1].pcs) - (a[1].set + a[1].pcs))
      .map(([k, o]) => [k, o.rs].concat(hasSet ? [o.set] : [], hasPcs ? [o.pcs] : []));
    miniTable(
      ['Provinsi', 'Jumlah RS'].concat(hasSet ? ['Set'] : [], hasPcs ? ['Unit/pcs'] : []),
      ['left', 'right'].concat(hasSet ? ['right'] : [], hasPcs ? ['right'] : []),
      body);
  }

  section('Cara membaca angka');
  const bullets = [];
  if (hasSet) bullets.push('Set = jumlah set instrumen utuh. Dihitung dari isi set di database produk: jumlah item yang dipesan dibagi jumlah item itu di dalam satu set.');
  if (hasSet && num(s.set_estimasi) > 0) bullets.push(`${fmt(s.set_estimasi)} set berupa perkiraan karena isi setnya belum terdaftar di database produk. Baris terkait diberi keterangan.`);
  if (hasSet && num(s.set_cek) > 0) bullets.push(`${fmt(s.set_cek)} pesanan set belum dihitung karena jumlah itemnya tidak sesuai isi set. Pesanannya tetap tercantum di sheet “Rincian Pesanan” dengan keterangan.`);
  if (hasPcs) bullets.push('Unit/pcs = total jumlah barang satuan (instrumen satuan, elektromedis, alat laboratorium, dan sejenisnya).');
  bullets.push(st.cakupan === 'SEMUA'
    ? 'Cakupan: semua pesanan non-sample, termasuk retail.'
    : 'Cakupan: pesanan lewat INAPROC dan pembelian langsung. Retail, konsinyasi, dan sample tidak dihitung.');
  bullets.push('Wilayah rumah sakit memakai koreksi manual bila ada. Bila tidak, wilayah dideteksi dari alamat pengiriman sehingga ada kemungkinan keliru.');
  if (adaBelumPeta) bullets.push(`${fmt(U.length)} rumah sakit lain belum diketahui wilayahnya dan belum termasuk dalam angka ${st.provinsi}. Daftarnya ada di sheet “Wilayah Belum Diketahui”.`);
  bullets.forEach((b) => wide('•  ' + b, { color: XL.ink }));

  section('Filter yang dipakai');
  kv('Provinsi', lokasi);
  kv('Kategori', kategoriText(st));
  if (st.produk.trim()) kv('Nama produk mengandung', st.produk.trim());
  if (st.produk.trim()) kv('Isi set ikut dihitung', st.isiSet ? 'Ya' : 'Tidak');
  if (st.rs.trim()) kv('Rumah sakit', st.rs.trim());
  kv('Status pesanan', statusText.charAt(0).toUpperCase() + statusText.slice(1));
  kv('Periode', periodeText(st));

  section('Isi file ini');
  const isi = [['Daftar RS', 'Satu baris per rumah sakit: wilayah, jumlah, dan jenis yang dipesan. Bisa difilter dan diurutkan; baris Total ikut berubah mengikuti filter.'],
    ['Rincian Pesanan', 'Satu baris per pesanan: nomor PO, tanggal, dan status. Kolom abu-abu di kanan adalah data teknis untuk penelusuran.']];
  if (adaMatriks) isi.push(['RS per Kategori', 'Perbandingan jumlah tiap rumah sakit per kategori produk.']);
  if (adaBelumPeta) isi.push(['Wilayah Belum Diketahui', 'Rumah sakit yang provinsinya belum diketahui, sehingga belum masuk angka provinsi.']);
  isi.forEach(([nama, desc]) => {
    const row = w0.getRow(r);
    row.getCell(1).value = nama;
    row.getCell(1).font = { bold: true, color: { argb: XL.ink } };
    row.getCell(1).alignment = { vertical: 'top' };
    w0.mergeCells(r, 2, r, 5);
    row.getCell(2).value = desc;
    row.getCell(2).font = { color: { argb: XL.soft } };
    row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
    row.height = Math.max(18, wrapLines(desc, 66) * 15 + 4);
    r++;
  });

  // ═══ SHEET BERBENTUK TABEL ══════════════════════════════════════════════════
  // Baris 1 judul, baris 2 keterangan, baris 4 header (beku), data mulai baris 5.
  const HEAD = 4;
  function tableSheet(name, o) {
    const ws = wb.addWorksheet(name, {
      views: [{ state: 'frozen', xSplit: o.freeze || 0, ySplit: HEAD, showGridLines: false }],
      pageSetup: Object.assign({ printTitlesRow: `${HEAD}:${HEAD}` }, page('landscape')),
      headerFooter: FOOT,
    });
    const cols = o.cols;
    const alignOf = (c) => c.align || (c.fmt === XL_DATE ? 'center' : (c.fmt ? 'right' : 'left'));
    cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.w; });

    ws.getCell(1, 1).value = o.title;
    ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: XL.ink } };
    ws.getRow(1).height = 24;
    ws.getCell(2, 1).value = o.sub;
    ws.getCell(2, 1).font = { size: 10, color: { argb: XL.soft } };

    const hr = ws.getRow(HEAD);
    hr.height = 32;
    cols.forEach((c, i) => {
      const cell = hr.getCell(i + 1);
      cell.value = c.h;
      cell.font = { bold: true, size: 10.5, color: { argb: c.tech ? XL.soft : XL.white } };
      cell.fill = xlFill(c.tech ? XL.line : XL.navy);
      cell.alignment = { vertical: 'middle', horizontal: alignOf(c), wrapText: true };
    });

    o.items.forEach((it, ri) => {
      const row = ws.getRow(HEAD + 1 + ri);
      let maxLines = 1;
      cols.forEach((c, i) => {
        const cell = row.getCell(i + 1);
        const v = it[c.k];
        cell.value = v === undefined ? null : v;
        if (c.fmt) cell.numFmt = c.fmt;
        cell.alignment = { vertical: 'middle', horizontal: alignOf(c), wrapText: !!c.wrap };
        cell.border = { bottom: xlLine };
        const muted = c.tech || it._dim;
        cell.font = { color: { argb: c.warn && v ? XL.warn : (muted ? XL.soft : XL.ink) }, size: c.tech ? 10 : 11 };
        if (c.wrap && v) maxLines = Math.max(maxLines, wrapLines(v, c.w));
      });
      row.height = Math.max(18, maxLines * 15 + 4);
    });

    const last = HEAD + o.items.length;
    if (o.totals && o.items.length) {
      const tr = ws.getRow(last + 1);
      tr.height = 22;
      cols.forEach((c, i) => {
        const cell = tr.getCell(i + 1);
        cell.fill = xlFill(XL.band);
        cell.border = { top: { style: 'thin', color: { argb: XL.navy } } };
        cell.font = { bold: true, color: { argb: XL.ink } };
      });
      tr.getCell(o.totalLabelCol || 1).value = 'Total (mengikuti filter)';
      o.totals.forEach((k) => {
        const idx = cols.findIndex((c) => c.k === k);
        if (idx < 0) return;
        const L = ws.getColumn(idx + 1).letter;
        const cell = tr.getCell(idx + 1);
        // SUBTOTAL(109) mengabaikan baris yang tersaring, jadi total ikut berubah saat pembaca memfilter.
        cell.value = { formula: `SUBTOTAL(109,${L}${HEAD + 1}:${L}${last})`, result: o.items.reduce((a, it) => a + num(it[k]), 0) };
        cell.numFmt = XL_NUMZ;
        cell.alignment = { horizontal: 'right' };
      });
    }
    ws.autoFilter = { from: { row: HEAD, column: 1 }, to: { row: HEAD + Math.max(1, o.items.length), column: cols.length } };
    return ws;
  }

  // ═══ 2) DAFTAR RS ═══════════════════════════════════════════════════════════
  const perCols = [
    { h: 'No', k: 'no', w: 5, fmt: XL_NUM, align: 'center' },
    { h: 'Rumah sakit', k: 'customer', w: 44 },
    { h: 'Kab/Kota', k: 'kab', w: 22 },
    { h: 'Provinsi', k: 'provinsi', w: 20 },
  ];
  if (hasSet) {
    if (semuaStatus) perCols.push({ h: 'Set terkirim', k: 'set_t', w: 11, fmt: XL_NUMZ }, { h: 'Set dalam proses', k: 'set_p', w: 11, fmt: XL_NUMZ });
    perCols.push({ h: 'Jumlah set', k: 'set', w: 12, fmt: XL_NUMZ });
  }
  if (hasPcs) {
    if (semuaStatus) perCols.push({ h: 'Unit/pcs terkirim', k: 'pcs_t', w: 12, fmt: XL_NUMZ }, { h: 'Unit/pcs dalam proses', k: 'pcs_p', w: 12, fmt: XL_NUMZ });
    perCols.push({ h: 'Jumlah unit/pcs', k: 'pcs', w: 12, fmt: XL_NUMZ });
  }
  perCols.push(
    { h: 'Jumlah pesanan', k: 'pesanan', w: 11, fmt: XL_NUMZ },
    { h: 'Pesanan terakhir', k: 'terakhir', w: 14, fmt: XL_DATE },
    { h: 'Jenis yang dipesan', k: 'rincian', w: 62, wrap: true },
    { h: 'Keterangan', k: 'ket', w: 40, wrap: true, warn: true },
    { h: 'Dasar wilayah', k: 'sumber', w: 18, tech: true });
  const perTotals = ['set_t', 'set_p', 'set', 'pcs_t', 'pcs_p', 'pcs', 'pesanan'];
  const perTeknis = perCols.some((c) => c.tech);
  tableSheet('Daftar RS', {
    title: 'Daftar rumah sakit',
    sub: subLine + (perTeknis ? '  ·  kolom abu-abu di kanan = data teknis' : ''),
    cols: perCols,
    freeze: 2,
    totals: perTotals,
    totalLabelCol: 2,
    items: R.map((x, i) => {
      const est = estimasi.get(x.customer) || 0;
      const ket = [];
      if (est > 0) ket.push(`${fmt(est)} set berupa perkiraan`);
      if (num(x.set_cek) > 0) ket.push(`${fmt(x.set_cek)} pesanan set belum dihitung (perlu dicek)`);
      if (!x.provinsi) ket.push('wilayah belum diketahui');
      return {
        no: i + 1,
        customer: x.customer,
        kab: x.kab_kota || '',
        provinsi: x.provinsi || 'Belum diketahui',
        set_t: num(x.set_terkirim), set_p: num(x.set_proses), set: x.set,
        pcs_t: num(x.pcs_terkirim), pcs_p: num(x.pcs_proses), pcs: x.pcs,
        pesanan: num(x.jumlah_pesanan),
        terakhir: xlDate(x.terakhir),
        rincian: rincianText(x, '; '),
        ket: ket.join('; '),
        sumber: x.sumber_wilayah === 'manual' ? 'Koreksi manual' : (x.sumber_wilayah === 'alamat' ? 'Deteksi alamat' : ''),
      };
    }),
  });

  // ═══ 3) RINCIAN PESANAN ═════════════════════════════════════════════════════
  const adaSet = lines.some((l) => l.kind === 'SET');
  const adaPcs = lines.some((l) => l.kind !== 'SET');
  const ord = new Map(R.map((x, i) => [x.customer, i]));
  const L2 = lines.slice().sort((a, b) =>
    ((ord.get(a.customer) || 0) - (ord.get(b.customer) || 0)) ||
    String(b.tanggal || '').localeCompare(String(a.tanggal || '')) ||
    String(a.kode_rmp || '').localeCompare(String(b.kode_rmp || ''), 'id'));
  const linCols = [
    { h: 'Rumah sakit', k: 'customer', w: 40 },
    { h: 'Kab/Kota', k: 'kab', w: 20 },
    { h: 'Provinsi', k: 'provinsi', w: 18 },
    { h: 'Kategori', k: 'kategori', w: 18 },
    { h: 'Produk / jenis set', k: 'jenis', w: 50, wrap: true },
  ];
  if (adaSet) linCols.push({ h: 'Jumlah set', k: 'set', w: 11, fmt: XL_NUMZ });
  if (adaPcs) linCols.push({ h: 'Jumlah unit/pcs', k: 'pcs', w: 12, fmt: XL_NUMZ });
  linCols.push(
    { h: 'Status', k: 'status', w: 14 },
    { h: 'Tanggal pesanan', k: 'tanggal', w: 14, fmt: XL_DATE },
    { h: 'No. RMP', k: 'rmp', w: 24 },
    { h: 'Keterangan', k: 'ket', w: 44, wrap: true, warn: true },
    { h: 'No. PO', k: 'po', w: 24, tech: true },
    { h: 'Kode produk', k: 'kode', w: 16, tech: true },
    { h: 'Family', k: 'family', w: 24, tech: true },
    { h: 'Jumlah baris di FPB', k: 'baris', w: 12, fmt: XL_NUM, tech: true },
    { h: 'Sheet sumber', k: 'sheet', w: 18, tech: true });
  if (lines.some((l) => l.label_asli)) linCols.push({ h: 'Nama set di sheet', k: 'asli', w: 28, tech: true });
  tableSheet('Rincian Pesanan', {
    title: 'Rincian pesanan',
    sub: `${subLine}  ·  kolom abu-abu di kanan = data teknis`,
    cols: linCols,
    freeze: 1,
    totals: ['set', 'pcs'],
    items: L2.map((l) => {
      const ok = dihitung(l);
      return {
        _dim: !ok,
        customer: l.customer,
        kab: l.kab_kota || '',
        provinsi: l.provinsi || '',
        kategori: katName(l.kelompok),
        jenis: l.kind === 'SET' ? l.label : l.produk,
        // Jumlah dikosongkan untuk pesanan yang tidak dihitung, supaya total kolom ini
        // sama dengan angka di sheet Daftar RS.
        set: l.kind === 'SET' && ok ? num(l.nilai) : null,
        pcs: l.kind !== 'SET' && ok ? num(l.nilai) : null,
        status: l.status === 'TERKIRIM' ? 'Terkirim' : 'Dalam proses',
        tanggal: xlDate(l.tanggal),
        po: l.po || '',
        ket: ketBaris(l),
        rmp: l.kode_rmp || '',
        kode: l.kode_produk || '',
        family: l.family || '',
        baris: num(l.jumlah_baris),
        sheet: l.sumber_sheet || '',
        asli: l.label_asli || '',
      };
    }),
  });

  // ═══ 4) RS PER KATEGORI (hanya bila hasilnya memuat lebih dari satu kategori) ═══
  if (adaMatriks) {
    const by = new Map();
    lines.forEach((l) => {
      if (!dihitung(l)) return;
      const o = by.get(l.customer) || { customer: l.customer, provinsi: l.provinsi || '', kab: l.kab_kota || '', v: {} };
      o.v[l.kelompok] = (o.v[l.kelompok] || 0) + num(l.nilai);
      by.set(l.customer, o);
    });
    const mCols = [
      { h: 'Rumah sakit', k: 'customer', w: 44 },
      { h: 'Kab/Kota', k: 'kab', w: 22 },
      { h: 'Provinsi', k: 'provinsi', w: 20 },
    ].concat(present.map((id, i) => ({ h: `${katName(id)} (${id === 'SET' ? 'set' : 'unit/pcs'})`, k: 'c' + i, w: 18, fmt: XL_NUMZ })));
    tableSheet('RS per Kategori', {
      title: 'Jumlah per rumah sakit menurut kategori',
      sub: subLine,
      cols: mCols,
      freeze: 1,
      totals: present.map((id, i) => 'c' + i),
      items: Array.from(by.values())
        .sort((a, b) => a.customer.localeCompare(b.customer, 'id'))
        .map((o) => {
          const row = { customer: o.customer, kab: o.kab, provinsi: o.provinsi || 'Belum diketahui' };
          present.forEach((id, i) => { row['c' + i] = o.v[id] || null; });
          return row;
        }),
    });
  }

  // ═══ 5) RS YANG WILAYAHNYA BELUM DIKETAHUI ══════════════════════════════════
  if (adaBelumPeta) {
    tableSheet('Wilayah Belum Diketahui', {
      title: 'Rumah sakit yang wilayahnya belum diketahui',
      sub: `Belum termasuk dalam angka ${st.provinsi} di sheet lain  ·  data per ${fmtDate(D.data_per)}`,
      cols: [
        { h: 'Rumah sakit', k: 'customer', w: 48 },
        { h: 'Jumlah set', k: 'set', w: 12, fmt: XL_NUMZ },
        { h: 'Jumlah unit/pcs', k: 'pcs', w: 14, fmt: XL_NUMZ },
        { h: 'Jumlah pesanan', k: 'pesanan', w: 14, fmt: XL_NUMZ },
      ],
      freeze: 1,
      totals: ['set', 'pcs', 'pesanan'],
      items: U.map((u) => ({ customer: u.customer, set: num(u.set_total), pcs: num(u.pcs_total), pesanan: num(u.jumlah_pesanan) })),
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// Nama file yang langsung jelas isinya saat dikirim ke orang lain, mis.
// "Populasi Set instrumen - Jawa Tengah - 2026-11-06.xlsx"
function bersihNama(s) {
  return String(s).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function namaFile() {
  let kat = state.produk.trim() ? `Produk ${state.produk.trim()}` : kategoriText();
  if (state.kelompok.length > 3) kat = 'Beberapa kategori';
  kat = bersihNama(kat).slice(0, 60);
  return `Populasi ${kat} - ${bersihNama(state.provinsi || 'Semua provinsi')} - ${localISODate()}.xlsx`;
}

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function setXlsxBusy(btn, busy) {
  if (!btn) return;
  btn.disabled = busy || !rows.length;
  const ic = btn.querySelector('i');
  if (ic) ic.className = busy ? 'ti ti-loader-2 spinner' : 'ti ti-file-spreadsheet';
  const lb = btn.querySelector('span');
  if (lb) lb.textContent = busy ? 'Menyiapkan…' : 'Unduh Excel';
}

async function downloadXlsx() {
  if (!data || !rows.length) { showToast('Belum ada data untuk diunduh', 'error'); return; }
  const btn = document.querySelector('[data-action="ps-xlsx"]');
  if (btn && btn.disabled) return;
  setXlsxBusy(btn, true);
  // Foto kondisi saat tombol ditekan; filter boleh berubah selagi file dibuat.
  const snap = {
    rows: rows.slice(),
    data,
    unmapped: unmapped.slice(),
    st: Object.assign({}, state, { kelompok: state.kelompok.slice() }),
  };
  const params = filterParams();
  const name = namaFile();
  try {
    await loadScript(EXCELJS_SRC);
    if (!window.ExcelJS) throw new Error('library Excel tidak termuat');
    const baris = await rpc('get_populasi_v2_baris', params, EXPORT_TIMEOUT_MS);
    const dipilih = new Set(snap.rows.map((x) => x.customer));
    const lines = (baris || []).filter((b) => dipilih.has(b.customer));
    const blob = await buildWorkbook(Object.assign({ lines }, snap));
    saveBlob(blob, name);
    showToast(`${name} diunduh`);
  } catch (e) {
    if (String(e.message).startsWith('unauthorized')) return;
    showToast('Gagal membuat Excel: ' + e.message, 'error');
  } finally {
    setXlsxBusy(btn, false);
  }
}

// ── kontrol ──────────────────────────────────────────────────────────────────
function syncStatusButtons() {
  document.querySelectorAll('[data-action="ps-status"]').forEach((b) => {
    const on = b.dataset.v === state.status;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

// Samakan semua kontrol dengan state (dipakai setelah lepas filter).
function syncControls() {
  const sel = $('ps-provinsi');
  if (state.provinsi && ![...sel.options].some((o) => o.value === state.provinsi)) {
    sel.add(new Option(state.provinsi, state.provinsi));
  }
  sel.value = state.provinsi;
  $('ps-produk').value = state.produk;
  $('ps-rs').value = state.rs;
  $('ps-isi-set').checked = state.isiSet;
  $('ps-isi-wrap').hidden = !state.produk.trim();
  $('ps-dari').value = state.dari;
  $('ps-sampai').value = state.sampai;
  $('ps-cakupan').value = state.cakupan;
  syncStatusButtons();
  renderCats();
}

function clearFilter(k) {
  if (k === 'semua') {
    state.produk = ''; state.isiSet = false; state.rs = '';
    state.dari = ''; state.sampai = ''; state.cakupan = 'POPULASI';
  }
  else if (k === 'produk') { state.produk = ''; state.isiSet = false; }
  else if (k === 'isi') state.isiSet = false;
  else if (k === 'rs') state.rs = '';
  else if (k === 'periode') { state.dari = ''; state.sampai = ''; }
  else if (k === 'cakupan') state.cakupan = 'POPULASI';
  syncControls();
  load();
}

export async function mount(container) {
  mountedContainer = container;
  await Promise.all([ensureStyle(), ensureVendorScripts()]);
  container.innerHTML = POPULASI_MARKUP;

  // Provinsi terakhir yang dipilih diingat; belum pernah memilih -> Jawa Tengah.
  const saved = lsGet(LS_PROV);
  Object.assign(state, {
    provinsi: saved === null ? DEFAULT_PROV : saved,
    status: 'DELIVERED', cakupan: 'POPULASI', kelompok: ['SET'],
    produk: '', rs: '', isiSet: false, dari: '', sampai: '',
    sort: { k: 'total', dir: 'desc' }, tinjau: '',
  });
  data = null; rows = []; unmapped = [];
  detailCache.clear();
  linesAll = null; recon = {};
  Object.assign(kel, { tab: 'kat', q: '', kelompok: '', hanya: false, list: [], total: 0, tanpaKode: 0, edit: -1, draft: '', saran: [], match: '', opener: null });

  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const ACTIONS = {
    'ps-reload': () => load(),
    'ps-tinjau': (el) => setTinjau(el.dataset.k),
    'ps-tinjau-reset': () => setTinjau(''),
    'ps-cat': (el) => {
      const k = el.dataset.k;
      if (!k) state.kelompok = [];
      else {
        const i = state.kelompok.indexOf(k);
        if (i >= 0) state.kelompok.splice(i, 1); else state.kelompok.push(k);
      }
      load();
    },
    'ps-status': (el) => { state.status = el.dataset.v === 'ALL' ? 'ALL' : 'DELIVERED'; syncStatusButtons(); load(); },
    'ps-sort': (el) => {
      const k = el.dataset.k;
      if (state.sort.k === k) state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
      else state.sort = { k, dir: (k === 'customer' || k === 'wilayah') ? 'asc' : 'desc' };
      if (data) { applySort(); renderTable(); }
    },
    'ps-toggle': (el) => toggleDetail(+el.dataset.idx),
    'ps-more': (el) => {
      const td = el.closest('td');
      const open = el.getAttribute('aria-expanded') !== 'true';
      td.querySelectorAll('[data-rest]').forEach((x) => { x.hidden = !open; });
      el.setAttribute('aria-expanded', String(open));
      el.textContent = open ? 'Sembunyikan' : `+${el.dataset.n} lainnya`;
    },
    'ps-edit-wil': (el) => { const r = rows[+el.dataset.idx]; if (r) editWilayah(r.customer, r.provinsi, r.kab_kota); },
    'ps-edit-unm': (el) => { const u = unmapped[+el.dataset.idx]; if (u) editWilayah(u.customer, '', ''); },
    'ps-clear': (el) => clearFilter(el.dataset.k),
    'ps-copy': () => copyText(),
    'ps-xlsx': () => downloadXlsx(),
    'ps-kel-open': () => kelOpen(),
    'ps-kel-close': () => kelClose(),
    'ps-kel-tab': (el) => kelSetTab(el.dataset.tab),
    'ps-kel-edit-row': (el) => kelOpen({ tab: el.dataset.tab, q: el.dataset.q || '' }),
    'ps-kel-edit': (el) => { const i = +el.dataset.i; if (i === kel.edit) kelEditClose(); else kelEditOpen(i, true); },
    'ps-kel-batal': () => kelEditClose(),
    'ps-kel-save': () => kelSimpan(false),
    'ps-kel-reset': () => kelSimpan(true),
    'ps-kel-unduh': (el) => kelUnduh(el),
  };
  const CHANGE_BY_ID = {
    'ps-provinsi': (t) => { state.provinsi = t.value; lsSet(LS_PROV, t.value); load(); },
    'ps-cakupan': (t) => { state.cakupan = t.value === 'SEMUA' ? 'SEMUA' : 'POPULASI'; load(); },
    'ps-dari': (t) => { state.dari = t.value; load(); },
    'ps-sampai': (t) => { state.sampai = t.value; load(); },
    'ps-isi-set': (t) => { state.isiSet = t.checked; load(); },
    'ps-kel-kelompok': (t) => { kel.kelompok = t.value; kelLoad(); },
    'ps-kel-hanya': (t) => { kel.hanya = t.checked; kelLoad(); },
    'ps-kel-draft': (t) => { kel.draft = t.value; kelEditSync(); },
  };

  function onClick(e) {
    if (e.target.id === 'ps-kel-overlay') { kelClose(); return; }   // klik di luar kartu = tutup
    const el = e.target.closest('[data-action]');
    if (!el || !container.contains(el)) return;
    if (hasOwn(ACTIONS, el.dataset.action)) ACTIONS[el.dataset.action](el, e);
  }
  function onChange(e) {
    const t = e.target;
    if (hasOwn(CHANGE_BY_ID, t.id)) CHANGE_BY_ID[t.id](t);
  }
  function onInput(e) {
    const id = e.target.id;
    if (id === 'ps-kel-q') {
      kel.q = e.target.value;
      clearTimeout(kelTimer);
      kelTimer = setTimeout(() => kelLoad(), 300);
      return;
    }
    if (id === 'ps-kel-draft' && !kelIsKat()) {
      kel.draft = e.target.value;
      kelEditSync();
      clearTimeout(kelSaranTimer);
      kelSaranTimer = setTimeout(() => kelCariSaran(kel.draft), 250);
      return;
    }
    if (id !== 'ps-produk' && id !== 'ps-rs') return;
    const v = e.target.value;
    // state langsung diperbarui (dua kolom bisa diketik berurutan), hanya muat-ulang yang ditunda.
    if (id === 'ps-produk') { state.produk = v; $('ps-isi-wrap').hidden = !v.trim(); }
    else state.rs = v;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => load(), 300);
  }
  handlers = { click: onClick, change: onChange, input: onInput };
  Object.entries(handlers).forEach(([type, fn]) => container.addEventListener(type, fn));

  // nilai awal kontrol (setelah markup terpasang)
  $('ps-provinsi').innerHTML = `<option value="">Semua provinsi</option>` +
    (state.provinsi ? `<option value="${esc(state.provinsi)}">${esc(state.provinsi)}</option>` : '');
  syncControls();
  renderHead({ set: true, pcs: false, n: 6 });

  // dipanggil paling akhir, setelah semua let/const modul terinisialisasi (hindari TDZ)
  load();
}

export function unmount() {
  if (handlers && mountedContainer) {
    Object.entries(handlers).forEach(([type, fn]) => mountedContainer.removeEventListener(type, fn));
  }
  handlers = null;
  clearTimeout(searchTimer);
  searchTimer = null;
  clearTimeout(kelTimer);
  clearTimeout(kelSaranTimer);
  kelTimer = null;
  kelSaranTimer = null;
  kelKeyHandler = null;         // overlay ikut hilang bersama markup
  kelReq++;
  reqId++;                      // batalkan respons yang masih di jalan
  reviewReq++;
  // pnm-universal.css TIDAK dilepas (permanent <link>, lihat dashboard/index.js unmount()).
  document.getElementById('page-populasi-style')?.remove();
  mountedContainer = null;
  data = null; rows = []; unmapped = [];
  detailCache.clear();
  linesAll = null; recon = {};
  state.tinjau = '';
}