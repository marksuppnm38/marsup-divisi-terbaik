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
// Pola mount/unmount/auth/rpc() sama dengan dashboard/index.js (PNMAuth, token diambil
// fresh tiap request, delegasi event di container).
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

const PRESETS = {
  'set-jateng':   { provinsi: 'Jawa Tengah', kelompok: ['SET'], produk: '' },
  'drill':        { provinsi: '', kelompok: [], produk: 'drill' },
  'lab':          { provinsi: '', kelompok: ['ALAT LABORATORIUM'], produk: '' },
  'elektromedis': { provinsi: '', kelompok: ['ELEKTROMEDIS'], produk: '' },
};

let mountedContainer = null;
let handlers = null;
let searchTimer = null;
let reqId = 0;

const state = {
  provinsi: DEFAULT_PROV, status: 'DELIVERED', cakupan: 'POPULASI',
  kelompok: ['SET'], produk: '', rs: '', isiSet: false, dari: '', sampai: '',
  sort: { k: 'total', dir: 'desc' },
};

let data = null;                    // respons get_populasi_v2 terakhir
let rows = [];                      // data.rows (+ field turunan set/pcs/total), urutan = tampilan
let unmapped = [];                  // data.belum_terpetakan
const detailCache = new Map();      // kunci -> baris satu RS (dibersihkan tiap load)

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
function slug(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'semua';
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
async function rpc(fn, params, timeoutMs = RPC_TIMEOUT_MS) {
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
  clearError();
  renderCats();
  renderActive();
  renderHint();
  try {
    const res = await rpc('get_populasi_v2', filterParams());
    if (my !== reqId) return;           // respons telat tidak boleh menimpa yang lebih baru
    data = res || {};
    rows = (data.rows || []).map((r) => {
      const set = num(r.set_terkirim) + num(r.set_proses);
      const pcs = num(r.pcs_terkirim) + num(r.pcs_proses);
      return Object.assign({}, r, { set, pcs, total: set + pcs });
    });
    unmapped = data.belum_terpetakan || [];
    detailCache.clear();
    applySort();
    render();
  } catch (e) {
    if (my !== reqId || String(e.message).startsWith('unauthorized')) return;
    const missing = e.code === 'PGRST202' || e.status === 404;
    const msg = missing
      ? 'RPC get_populasi_v2 belum terpasang. Jalankan populasi_v2.sql di Supabase SQL Editor.'
      : 'Gagal memuat data: ' + e.message;
    showError(msg);
    if (!data) {
      renderHead({ set: false, pcs: false, n: 5 });
      $('ps-body').innerHTML = `<tr><td colspan="5" class="ps-empty ps-empty-err">${esc(msg)}</td></tr>`;
    }
  } finally {
    if (my === reqId) $('ps-table').classList.remove('ps-busy');
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
  let html = `<button type="button" class="ps-cat${all ? ' on' : ''}" aria-pressed="${all}" data-action="ps-cat" data-k="">Semua</button>`;
  html += KELOMPOK.map((k) => {
    const on = state.kelompok.includes(k.id);
    const n = cnt[k.id] ? num(cnt[k.id].jumlah_rs) : 0;
    const dim = data && !n ? ' dim' : '';
    const badge = data ? `<span class="ps-cat-n" title="${fmt(n)} RS">${fmt(n)}</span>` : '';
    return `<button type="button" class="ps-cat${on ? ' on' : ''}${dim}" aria-pressed="${on}" data-action="ps-cat" data-k="${esc(k.id)}">${esc(k.nama)}${badge}</button>`;
  }).join('');
  el.innerHTML = html;
}

// Filter yang sedang aktif, masing-masing bisa dilepas.
function renderActive() {
  const el = $('ps-active');
  if (!el) return;
  const a = [];
  if (state.produk.trim()) a.push({ k: 'produk', t: `Produk: ${state.produk.trim()}` });
  if (state.produk.trim() && state.isiSet) a.push({ k: 'isi', t: 'Termasuk isi set' });
  if (state.rs.trim()) a.push({ k: 'rs', t: `RS: ${state.rs.trim()}` });
  if (state.dari || state.sampai) a.push({ k: 'periode', t: `Periode: ${periodeText()}` });
  if (state.cakupan === 'SEMUA') a.push({ k: 'cakupan', t: 'Termasuk retail' });
  el.hidden = !a.length;
  el.innerHTML = a.map((c) =>
    `<span class="ps-chip">${esc(c.t)}<button type="button" data-action="ps-clear" data-k="${c.k}" aria-label="Lepas filter ${esc(c.t)}"><i class="ti ti-x"></i></button></span>`
  ).join('');
}

function renderHint() {
  const el = $('ps-hint');
  if (!el) return;
  const p = state.produk.trim();
  let msg = '';
  if (p && !state.isiSet) {
    msg = `Yang dihitung hanya barang bernama “${p}” yang dijual sendiri. Yang ada di dalam set belum ikut; centang “Termasuk isi set” untuk menambahkannya.`;
  } else if (p && state.isiSet) {
    msg = 'Isi set dihitung per komponen (pcs), bukan per set.';
  }
  el.hidden = !msg;
  el.textContent = msg;
}

// Data di DB bisa tertinggal dari Google Sheet (sinkron berjalan terpisah) -- jangan disembunyikan.
function renderFreshness() {
  const dp = toDate(data.data_per);
  $('ps-data-per').textContent = dp ? 'Data per ' + fmtDate(data.data_per) : 'Data per —';
  const note = $('ps-stale');
  const days = dp ? Math.floor((Date.now() - dp.getTime()) / 86400000) : null;
  if (days !== null && days > STALE_DAYS) {
    note.hidden = false;
    note.innerHTML = `<i class="ti ti-clock-exclamation"></i> Data di database terakhir diperbarui <b>${fmt(days)} hari lalu</b> ` +
      `(${esc(fmtDate(data.data_per))}); PO terbaru yang tercatat ${esc(fmtDate(data.po_terbaru))}. ` +
      `Isi Google Sheet bisa lebih baru dari yang tampil di sini.`;
  } else {
    note.hidden = true;
    note.textContent = '';
  }
}

function renderSummary() {
  const s = data.ringkasan || {};
  const hasSet = num(s.set_total) > 0;
  const hasPcs = num(s.pcs_total) > 0;
  const lokasi = state.provinsi || 'semua provinsi';
  const big = [];
  if (hasSet) big.push(`<span class="ps-big">${fmt(s.set_total)}</span> set`);
  if (hasPcs) big.push(`<span class="ps-big">${fmt(s.pcs_total)}</span> unit/pcs`);
  $('ps-sum-main').innerHTML = big.length
    ? `${big.join(' <span class="ps-sep">+</span> ')} di <span class="ps-big">${fmt(s.jumlah_rs)}</span> RS` +
      ` <span class="ps-sep">·</span> <span class="ps-lokasi">${esc(lokasi)}</span>`
    : `Belum ada RS yang cocok <span class="ps-sep">·</span> <span class="ps-lokasi">${esc(lokasi)}</span>`;

  const parts = [kategoriText()];
  parts.push(state.status === 'ALL' ? 'terkirim dan dalam proses' : 'terkirim saja');
  if (hasSet && state.status === 'ALL') parts.push(`set: ${fmt(s.set_terkirim)} terkirim, ${fmt(s.set_proses)} proses`);
  if (hasPcs && state.status === 'ALL') parts.push(`unit/pcs: ${fmt(s.pcs_terkirim)} terkirim, ${fmt(s.pcs_proses)} proses`);
  if (big.length) parts.push(`${fmt(s.jumlah_pesanan)} pesanan`);
  if (hasSet && num(s.item_lepas) > 0) parts.push(`${fmt(s.item_lepas)} item lepas tidak dihitung`);
  $('ps-sum-sub').textContent = parts.join(' · ');

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
  return `<th class="${cls}" aria-sort="${aria}"><button type="button" class="ps-sort${on ? ' on' : ''}" data-action="ps-sort" data-k="${key}">${esc(label)}<i class="ti ${icon}"></i></button></th>`;
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
  const set = num(s.set_total) > 0;
  const pcs = num(s.pcs_total) > 0;
  return { set, pcs, n: 5 + (set ? 1 : 0) + (pcs ? 1 : 0) };
}

function emptyMessage() {
  const tips = [];
  const p = state.produk.trim();
  if (p && !state.isiSet) tips.push('Coba centang “Termasuk isi set”.');
  if (p) tips.push('Coba kata kunci yang lebih pendek.');
  if (state.status !== 'ALL') tips.push('Coba tambahkan pesanan yang masih dalam proses.');
  if (state.provinsi) tips.push('Coba pilih semua provinsi.');
  if (state.provinsi && unmapped.length) tips.push(`Ada ${fmt(unmapped.length)} RS yang wilayahnya belum diketahui (lihat bagian bawah).`);
  return 'Tidak ada RS yang cocok dengan filter ini.' + (tips.length ? '<br>' + esc(tips.join(' ')) : '');
}

function renderTable() {
  const cols = colsInfo();
  renderHead(cols);
  const body = $('ps-body');
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="${cols.n}" class="ps-empty"><i class="ti ti-search"></i> ${emptyMessage()}</td></tr>`;
    return;
  }
  body.innerHTML = rows.map((r, i) => {
    let wilayah;
    if (r.provinsi || r.kab_kota) {
      wilayah = esc([r.kab_kota, state.provinsi ? '' : r.provinsi].filter(Boolean).join(' · ') || r.provinsi);
    } else {
      wilayah = '<span class="ps-muted">Belum diketahui</span>';
    }
    const tag = r.sumber_wilayah === 'manual'
      ? '<span class="ps-tag" title="Wilayah ditetapkan manual">manual</span>'
      : r.sumber_wilayah === 'alamat'
        ? '<span class="ps-tag ps-tag-auto" title="Wilayah terdeteksi otomatis dari alamat, bisa salah. Klik pensil untuk mengoreksi">otomatis</span>'
        : '';
    const rinci = r.rincian || [];
    const shown = rinci.slice(0, 2).map((j) => `${esc(j.label)} ×${fmt(j.nilai)}`).join(', ');
    const more = rinci.length > 2 ? ` <span class="ps-more" title="${esc(rincianText(r))}">+${rinci.length - 2} lainnya</span>` : '';
    const subSet = num(r.set_proses) > 0 ? `<span class="ps-sub">${fmt(r.set_terkirim)} terkirim, ${fmt(r.set_proses)} proses</span>` : '';
    const subPcs = num(r.pcs_proses) > 0 ? `<span class="ps-sub">${fmt(r.pcs_terkirim)} terkirim, ${fmt(r.pcs_proses)} proses</span>` : '';
    return `
      <tr class="ps-row" role="button" tabindex="0" aria-expanded="false" data-action="ps-toggle" data-idx="${i}">
        <td><i class="ti ti-chevron-right ps-chev"></i><span class="ps-rs">${esc(r.customer)}</span></td>
        <td>${wilayah} ${tag}</td>
        ${cols.set ? `<td class="ps-num">${r.set ? `<b>${fmt(r.set)}</b>${subSet}` : '<span class="ps-muted">—</span>'}</td>` : ''}
        ${cols.pcs ? `<td class="ps-num">${r.pcs ? `<b>${fmt(r.pcs)}</b>${subPcs}` : '<span class="ps-muted">—</span>'}</td>` : ''}
        <td class="ps-jenis">${shown}${more}</td>
        <td class="ps-date">${esc(fmtDate(r.terakhir))}</td>
        <td class="ps-col-act"><button type="button" class="ps-iconbtn" data-action="ps-edit-wil" data-idx="${i}" title="Ubah wilayah" aria-label="Ubah wilayah ${esc(r.customer)}"><i class="ti ti-pencil"></i></button></td>
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
    `<i class="ti ti-map-pin-off"></i> ${fmt(unmapped.length)} RS belum diketahui wilayahnya ` +
    `(${esc(tot)}), <b>belum ikut</b> hasil per provinsi di atas`;
  $('ps-unm-list').innerHTML = `
    <table class="ps-unm-table"><tbody>
      ${unmapped.map((u, i) => {
        const v = [num(u.set_total) ? `${fmt(u.set_total)} set` : '', num(u.pcs_total) ? `${fmt(u.pcs_total)} unit/pcs` : ''].filter(Boolean).join(' + ');
        return `
        <tr>
          <td>${esc(u.customer)}</td>
          <td class="ps-num">${esc(v)}</td>
          <td class="ps-col-act"><button type="button" class="btn btn-ghost" data-action="ps-edit-unm" data-idx="${i}"><i class="ti ti-map-pin"></i> Tetapkan wilayah</button></td>
        </tr>`;
      }).join('')}
    </tbody></table>`;
}

// ── rincian satu RS ──────────────────────────────────────────────────────────
function detailHtml(list) {
  if (!list || !list.length) return '<div class="ps-detail-empty">Tidak ada pesanan pada filter ini.</div>';
  return `
    <table class="ps-dt">
      <thead><tr>
        <th>PO</th><th>Kode RMP</th><th>Kategori</th><th>Jenis set / produk</th>
        <th class="ps-th-num">Jumlah</th><th>Status</th><th>Tanggal</th><th>Sheet</th>
      </tr></thead>
      <tbody>
        ${list.map((d) => {
          const isSet = d.kind === 'SET';
          const nama = isSet ? d.label : d.produk;
          const sub = !isSet && (d.family || d.kode_produk)
            ? `<span class="ps-sub">${esc(d.family || d.kode_produk)}</span>` : '';
          const jml = isSet ? (d.item_lepas ? '—' : `${fmt(d.nilai)} set`) : `${fmt(d.nilai)} pcs`;
          return `
          <tr${d.item_lepas ? ' class="ps-lepas"' : ''}>
            <td>${esc(d.po || '—')}</td>
            <td><span class="kode-text">${esc(d.kode_rmp || '—')}</span></td>
            <td>${esc(katName(d.kelompok))}</td>
            <td>${esc(nama)}${d.item_lepas ? ' <span class="ps-tag" title="Kurang dari 3 baris: bukan satu set utuh, tidak dihitung">item lepas</span>' : ''}${sub}</td>
            <td class="ps-num">${esc(jml)}</td>
            <td><span class="ps-st ${d.status === 'TERKIRIM' ? 'ps-st-ok' : 'ps-st-wip'}">${d.status === 'TERKIRIM' ? 'Terkirim' : 'Proses'}</span></td>
            <td class="ps-date">${esc(fmtDate(d.tanggal))}</td>
            <td class="ps-date">${esc(d.sumber_sheet || '—')}</td>
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
    tr.setAttribute('aria-expanded', 'false');
    tr.classList.remove('open');
    return;
  }
  const dtr = document.createElement('tr');
  dtr.className = 'ps-detail-row';
  dtr.innerHTML = `<td colspan="${colsInfo().n}"><div class="ps-detail"><i class="ti ti-loader-2 spinner"></i> Memuat rincian…</div></td>`;
  tr.after(dtr);
  tr.setAttribute('aria-expanded', 'true');
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
  const tot = [num(s.set_total) ? `${fmt(s.set_total)} set${state.produk.trim() ? '' : ' (estimasi)'}` : '', num(s.pcs_total) ? `${fmt(s.pcs_total)} unit/pcs` : ''].filter(Boolean).join(' + ');
  lines.push('', `Total: ${fmt(s.jumlah_rs)} RS, ${tot}`);
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
// Tanggal ke sel Excel harus UTC tengah malam, kalau tidak bergeser sehari di zona WIB.
function xlDate(s) {
  const d = toDate(s);
  return d ? new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) : null;
}

async function buildWorkbook(ctx) {
  const { lines, rows: R, data: D, st, unmapped: U } = ctx;
  const ExcelJS = window.ExcelJS;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Populasi PNM';
  wb.created = new Date();

  const s = D.ringkasan || {};
  const hasSet = num(s.set_total) > 0;
  const hasPcs = num(s.pcs_total) > 0;
  const NUM = '#,##0';
  const DATE = 'dd-mmm-yyyy';
  const ink = 'FF1F2937';
  const soft = 'FF6B7280';
  const headFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9EBEF' } };
  const thin = { style: 'thin', color: { argb: 'FF9CA3AF' } };

  // Sheet berbentuk tabel: header beku, filter di tiap kolom, angka tetap angka.
  function tableSheet(name, cols, items, freezeCols) {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', xSplit: freezeCols || 0, ySplit: 1 }] });
    ws.columns = cols.map((c) => ({ header: c.h, key: c.k, width: c.w }));
    items.forEach((it) => ws.addRow(it));
    ws.eachRow((row, rn) => {
      cols.forEach((c, i) => {
        const cell = row.getCell(i + 1);
        if (rn === 1) {
          cell.font = { bold: true, color: { argb: ink } };
          cell.fill = headFill;
          cell.border = { bottom: thin };
          cell.alignment = { vertical: 'middle', horizontal: c.fmt ? 'right' : 'left', wrapText: true };
        } else if (c.fmt) {
          cell.numFmt = c.fmt;
          cell.alignment = { horizontal: c.fmt === DATE ? 'left' : 'right' };
        }
      });
    });
    ws.getRow(1).height = 22;
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
    return ws;
  }

  // 1) Ringkasan: apa yang ditanyakan dan apa jawabannya, supaya file ini bisa berdiri sendiri.
  const w0 = wb.addWorksheet('Ringkasan', { views: [{ showGridLines: false }] });
  w0.columns = [{ width: 34 }, { width: 18 }, { width: 18 }, { width: 18 }];
  let r = 1;
  const title = (t) => { const c = w0.getCell(r, 1); c.value = t; c.font = { bold: true, size: 14, color: { argb: ink } }; w0.getRow(r).height = 24; r++; };
  const subline = (t) => { const c = w0.getCell(r, 1); c.value = t; c.font = { color: { argb: soft } }; r++; };
  const section = (t) => {
    r++;
    const row = w0.getRow(r);
    for (let i = 1; i <= 4; i++) row.getCell(i).border = { bottom: thin };
    row.getCell(1).value = t;
    row.getCell(1).font = { bold: true, color: { argb: ink } };
    r++;
  };
  const kv = (k, v, f) => {
    const row = w0.getRow(r++);
    row.getCell(1).value = k;
    row.getCell(1).font = { color: { argb: soft } };
    const c = row.getCell(2);
    c.value = v;
    c.alignment = { horizontal: 'left' };
    if (f) c.numFmt = f;
  };
  const note = (t) => {
    w0.mergeCells(r, 1, r, 4);
    const c = w0.getCell(r, 1);
    c.value = t;
    c.alignment = { wrapText: true, vertical: 'top' };
    c.font = { color: { argb: soft } };
    w0.getRow(r).height = Math.ceil(t.length / 90) * 15 + 3;
    r++;
  };

  title(`Populasi ${kategoriText(st)}: ${st.provinsi || 'semua provinsi'}`);
  subline(`Data per ${fmtDate(D.data_per)}. Diunduh ${new Date().toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}.`);

  section('Filter yang dipakai');
  kv('Provinsi', st.provinsi || 'Semua provinsi');
  kv('Kategori', kategoriText(st));
  kv('Nama produk mengandung', st.produk.trim() || '—');
  kv('Rumah sakit', st.rs.trim() || '—');
  kv('Status pesanan', st.status === 'ALL' ? 'Terkirim dan dalam proses' : 'Terkirim saja');
  kv('Cakupan', st.cakupan === 'SEMUA' ? 'Semua non-sample (termasuk retail)' : 'Populasi (INAPROC dan beli langsung)');
  kv('Periode', periodeText(st));
  kv('Isi set ikut dihitung', st.produk.trim() ? (st.isiSet ? 'Ya' : 'Tidak') : '—');

  section('Hasil');
  kv('Jumlah RS', num(s.jumlah_rs), NUM);
  if (hasSet) {
    kv('Set (estimasi)', num(s.set_total), NUM);
    if (st.status === 'ALL') { kv('   terkirim', num(s.set_terkirim), NUM); kv('   dalam proses', num(s.set_proses), NUM); }
  }
  if (hasPcs) {
    kv('Unit/pcs', num(s.pcs_total), NUM);
    if (st.status === 'ALL') { kv('   terkirim', num(s.pcs_terkirim), NUM); kv('   dalam proses', num(s.pcs_proses), NUM); }
  }
  kv('Jumlah pesanan', num(s.jumlah_pesanan), NUM);
  if (hasSet) kv('Item lepas (tidak dihitung)', num(s.item_lepas), NUM);

  if (!st.provinsi && R.length) {
    section('Per provinsi');
    const hr = w0.getRow(r++);
    const heads = ['Provinsi', 'Jumlah RS'].concat(hasSet ? ['Set'] : [], hasPcs ? ['Unit/pcs'] : []);
    heads.forEach((h, i) => {
      const c = hr.getCell(i + 1);
      c.value = h;
      c.font = { bold: true, color: { argb: ink } };
      c.fill = headFill;
      c.alignment = { horizontal: i === 0 ? 'left' : 'right' };
    });
    const g = new Map();
    R.forEach((x) => {
      const k = x.provinsi || '(wilayah belum diketahui)';
      const o = g.get(k) || { rs: 0, set: 0, pcs: 0 };
      o.rs += 1; o.set += x.set; o.pcs += x.pcs;
      g.set(k, o);
    });
    Array.from(g.entries()).sort((a, b) => (b[1].set + b[1].pcs) - (a[1].set + a[1].pcs)).forEach(([k, o]) => {
      const row = w0.getRow(r++);
      const vals = [k, o.rs].concat(hasSet ? [o.set] : [], hasPcs ? [o.pcs] : []);
      vals.forEach((v, i) => {
        const c = row.getCell(i + 1);
        c.value = v;
        if (i > 0) { c.numFmt = NUM; c.alignment = { horizontal: 'right' }; }
      });
    });
  }

  section('Catatan membaca angka');
  if (hasSet) note('Set adalah estimasi dari QTY baris isi set pada FPB (pembagi bersama terbesar dari QTY per baris). Pesanan set dengan kurang dari 3 baris dianggap item lepas dan tidak dihitung; barisnya tetap tampil di sheet Rincian.');
  if (hasPcs) note('Unit/pcs adalah total QTY baris barang (instrumen satuan, elektromedis, alat laboratorium, dan sejenisnya), bukan estimasi.');
  note('Wilayah ditentukan dari koreksi manual bila ada, kalau tidak dari deteksi alamat pengiriman. Kolom Sumber wilayah di sheet Per RS menunjukkan mana yang dipakai; yang otomatis bisa salah.');

  // 2) Per RS
  const perCols = [
    { h: 'No', k: 'no', w: 5, fmt: NUM },
    { h: 'Rumah sakit', k: 'customer', w: 44 },
    { h: 'Provinsi', k: 'provinsi', w: 20 },
    { h: 'Kab/Kota', k: 'kab', w: 20 },
    { h: 'Sumber wilayah', k: 'sumber', w: 17 },
  ];
  if (hasSet) perCols.push(
    { h: 'Set terkirim', k: 'set_t', w: 12, fmt: NUM },
    { h: 'Set proses', k: 'set_p', w: 12, fmt: NUM },
    { h: 'Set total', k: 'set', w: 12, fmt: NUM });
  if (hasPcs) perCols.push(
    { h: 'Unit/pcs terkirim', k: 'pcs_t', w: 14, fmt: NUM },
    { h: 'Unit/pcs proses', k: 'pcs_p', w: 14, fmt: NUM },
    { h: 'Unit/pcs total', k: 'pcs', w: 14, fmt: NUM });
  perCols.push({ h: 'Pesanan', k: 'pesanan', w: 10, fmt: NUM });
  if (hasSet) perCols.push({ h: 'Item lepas', k: 'lepas', w: 10, fmt: NUM });
  perCols.push({ h: 'Terakhir', k: 'terakhir', w: 14, fmt: DATE }, { h: 'Rincian', k: 'rincian', w: 90 });
  tableSheet('Per RS', perCols, R.map((x, i) => ({
    no: i + 1,
    customer: x.customer,
    provinsi: x.provinsi || '(belum diketahui)',
    kab: x.kab_kota || '',
    sumber: x.sumber_wilayah === 'manual' ? 'Manual' : (x.sumber_wilayah === 'alamat' ? 'Otomatis (alamat)' : ''),
    set_t: num(x.set_terkirim), set_p: num(x.set_proses), set: x.set,
    pcs_t: num(x.pcs_terkirim), pcs_p: num(x.pcs_proses), pcs: x.pcs,
    pesanan: num(x.jumlah_pesanan),
    lepas: num(x.item_lepas),
    terakhir: xlDate(x.terakhir),
    rincian: rincianText(x, '; '),
  })), 2);

  // 3) Rincian: satu baris per PO/produk, bahan untuk pivot sendiri.
  tableSheet('Rincian', [
    { h: 'Rumah sakit', k: 'customer', w: 40 },
    { h: 'Provinsi', k: 'provinsi', w: 18 },
    { h: 'Kab/Kota', k: 'kab', w: 18 },
    { h: 'PO', k: 'po', w: 24 },
    { h: 'Kode RMP', k: 'rmp', w: 16 },
    { h: 'Kategori', k: 'kategori', w: 18 },
    { h: 'Jenis set / produk', k: 'jenis', w: 52 },
    { h: 'Kode produk', k: 'kode', w: 16 },
    { h: 'Family', k: 'family', w: 26 },
    { h: 'Jumlah', k: 'jumlah', w: 10, fmt: NUM },
    { h: 'Satuan', k: 'satuan', w: 8 },
    { h: 'Baris FPB', k: 'baris', w: 10, fmt: NUM },
    { h: 'Status', k: 'status', w: 14 },
    { h: 'Tanggal', k: 'tanggal', w: 14, fmt: DATE },
    { h: 'Sheet sumber', k: 'sheet', w: 18 },
    { h: 'Catatan', k: 'catatan', w: 40 },
  ], lines.map((l) => ({
    customer: l.customer,
    provinsi: l.provinsi || '',
    kab: l.kab_kota || '',
    po: l.po || '',
    rmp: l.kode_rmp || '',
    kategori: katName(l.kelompok),
    jenis: l.kind === 'SET' ? l.label : l.produk,
    kode: l.kode_produk || '',
    family: l.family || '',
    jumlah: num(l.nilai),
    satuan: l.kind === 'SET' ? 'set' : 'pcs',
    baris: num(l.jumlah_baris),
    status: l.status === 'TERKIRIM' ? 'Terkirim' : 'Dalam proses',
    tanggal: xlDate(l.tanggal),
    sheet: l.sumber_sheet || '',
    catatan: l.item_lepas ? 'Item lepas (kurang dari 3 baris), tidak dihitung' : '',
  })), 1);

  // 4) Matriks RS x kategori (hanya kalau hasilnya memuat lebih dari satu kategori)
  const order = KELOMPOK.map((k) => k.id).concat('ISI SET');
  const present = order.filter((id) => lines.some((l) => l.kelompok === id && !l.item_lepas && num(l.nilai) > 0));
  if (present.length >= 2) {
    const by = new Map();
    lines.forEach((l) => {
      if (l.item_lepas) return;
      const o = by.get(l.customer) || { customer: l.customer, provinsi: l.provinsi || '', v: {} };
      o.v[l.kelompok] = (o.v[l.kelompok] || 0) + num(l.nilai);
      by.set(l.customer, o);
    });
    const mCols = [{ h: 'Rumah sakit', k: 'customer', w: 44 }, { h: 'Provinsi', k: 'provinsi', w: 20 }]
      .concat(present.map((id, i) => ({ h: `${katName(id)} (${id === 'SET' ? 'set' : 'pcs'})`, k: 'c' + i, w: 18, fmt: NUM })));
    const mItems = Array.from(by.values())
      .sort((a, b) => a.customer.localeCompare(b.customer, 'id'))
      .map((o) => {
        const row = { customer: o.customer, provinsi: o.provinsi };
        present.forEach((id, i) => { row['c' + i] = o.v[id] || null; });
        return row;
      });
    tableSheet('RS x Kategori', mCols, mItems, 2);
  }

  // 5) RS yang wilayahnya belum diketahui
  if (st.provinsi && U.length) {
    tableSheet('Belum terpetakan', [
      { h: 'Rumah sakit', k: 'customer', w: 48 },
      { h: 'Set', k: 'set', w: 10, fmt: NUM },
      { h: 'Unit/pcs', k: 'pcs', w: 10, fmt: NUM },
      { h: 'Pesanan', k: 'pesanan', w: 10, fmt: NUM },
    ], U.map((u) => ({ customer: u.customer, set: num(u.set_total), pcs: num(u.pcs_total), pesanan: num(u.jumlah_pesanan) })), 1);
  }

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

function namaFile() {
  const kat = state.produk.trim() ? slug(state.produk) : (state.kelompok.length ? state.kelompok.map(slug).join('-') : 'semua-kategori');
  return `populasi_${kat}_${slug(state.provinsi || 'semua-provinsi')}_${localISODate()}.xlsx`;
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
    showToast(`Excel ${fmt(snap.rows.length)} RS diunduh`);
  } catch (e) {
    if (String(e.message).startsWith('unauthorized')) return;
    showToast('Gagal membuat Excel: ' + e.message, 'error');
  } finally {
    setXlsxBusy(btn, false);
  }
}

// ── kontrol ──────────────────────────────────────────────────────────────────
function syncStatusButtons() {
  document.querySelectorAll('[data-action="ps-status"]').forEach((b) => b.classList.toggle('active', b.dataset.v === state.status));
}

// Samakan semua kontrol dengan state (dipakai setelah preset / lepas filter).
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

function applyPreset(id) {
  const p = PRESETS[id];
  if (!p) return;
  state.provinsi = p.provinsi;
  state.kelompok = p.kelompok.slice();
  state.produk = p.produk;
  state.rs = '';
  state.isiSet = false;
  syncControls();
  load();
}

function clearFilter(k) {
  if (k === 'produk') { state.produk = ''; state.isiSet = false; }
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
    sort: { k: 'total', dir: 'desc' },
  });
  data = null; rows = []; unmapped = [];
  detailCache.clear();

  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const ACTIONS = {
    'ps-reload': () => load(),
    'ps-preset': (el) => applyPreset(el.dataset.p),
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
    'ps-edit-wil': (el) => { const r = rows[+el.dataset.idx]; if (r) editWilayah(r.customer, r.provinsi, r.kab_kota); },
    'ps-edit-unm': (el) => { const u = unmapped[+el.dataset.idx]; if (u) editWilayah(u.customer, '', ''); },
    'ps-clear': (el) => clearFilter(el.dataset.k),
    'ps-copy': () => copyText(),
    'ps-xlsx': () => downloadXlsx(),
  };
  const CHANGE_BY_ID = {
    'ps-provinsi': (t) => { state.provinsi = t.value; lsSet(LS_PROV, t.value); load(); },
    'ps-cakupan': (t) => { state.cakupan = t.value === 'SEMUA' ? 'SEMUA' : 'POPULASI'; load(); },
    'ps-dari': (t) => { state.dari = t.value; load(); },
    'ps-sampai': (t) => { state.sampai = t.value; load(); },
    'ps-isi-set': (t) => { state.isiSet = t.checked; load(); },
  };

  function onClick(e) {
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
    if (id !== 'ps-produk' && id !== 'ps-rs') return;
    const v = e.target.value;
    // state langsung diperbarui (dua kolom bisa diketik berurutan), hanya muat-ulang yang ditunda.
    if (id === 'ps-produk') { state.produk = v; $('ps-isi-wrap').hidden = !v.trim(); }
    else state.rs = v;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => load(), 300);
  }
  function onKeydown(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const t = e.target;
    if (t.matches('input, select, textarea, button, a')) return;   // kontrol native menangani sendiri
    if (t.matches('tr.ps-row')) {
      e.preventDefault();
      toggleDetail(+t.dataset.idx);
    }
  }
  handlers = { click: onClick, change: onChange, input: onInput, keydown: onKeydown };
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
  reqId++;                      // batalkan respons yang masih di jalan
  // pnm-universal.css TIDAK dilepas (permanent <link>, lihat dashboard/index.js unmount()).
  document.getElementById('page-populasi-style')?.remove();
  mountedContainer = null;
  data = null; rows = []; unmapped = [];
  detailCache.clear();
}