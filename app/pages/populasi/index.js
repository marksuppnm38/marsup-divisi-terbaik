// app/pages/populasi/index.js -- mount(container) / unmount().
// Halaman "Populasi": menjawab "kategori/produk apa, di RS mana saja, di provinsi X",
// dan hasilnya bisa diunduh sebagai Excel (xlsx) yang siap dipakai. Pembangun file Excel: export.js.
//
// DATA: RPC (definisi di populasi_v2.sql)
//   get_populasi_v2         -> seluruh halaman dalam SATU panggilan (daftar RS, ringkasan,
//                              opsi provinsi/kategori, RS yang wilayahnya belum terpetakan, data_per)
//   get_populasi_v2_unit    -> pemisahan Pcs (instrumen satuan) dan Unit (alat) per RS, filter sama (populasi_v2_unit.sql)
//   get_populasi_v2_baris   -> baris per PO/produk: rincian satu RS (saat baris dibuka)
//                              dan bahan seluruh sheet Excel
//   set_rs_wilayah          -> simpan koreksi wilayah satu RS (tidak berubah)
//   get_produk_kelompok / set_produk_kelompok / hapus_produk_kelompok -> koreksi kategori produk (sql/01)
//   get_set_grup / set_set_grup / hapus_set_grup -> alihkan set custom ke populasi set lain (sql/07)
//   get_produk_atribut / set_produk_atribut / hapus_produk_atribut -> spesialisasi, jenis, mikro per kode (patch 2a + 3b)
//   (data sheet TIDAK disentuh; keduanya hanya mengubah nama/kategori yang dihitung)
// Pola mount/unmount/auth/rpc() sama dengan dashboard/index.js (PNMAuth, token diambil
// fresh tiap request, delegasi event di container).
//
// MODE "Progress order" (progress.js): daftar semua project (No. RMP) yang berjalan + rekap per sales, lewat RPC
//   get_progress_order (populasi_progress_order.sql). Berdiri sendiri; index.js hanya mengganti mode dan meneruskan
//   klik/ubah/ketik berawalan pg- ke progress.js.
//
// "Perlu dicek" / "perkiraan" (state.tinjau): kartu angka itu membuka DAFTAR PESANAN-nya
// (dari get_populasi_v2_baris, filter yang sama dengan tabel) lengkap dengan alasan per pesanan.
// Angka kartu selalu disamakan dengan daftar yang tampil (lihat renderReview).
//
// Semua nilai dari DB yang masuk ke innerHTML WAJIB lewat esc() -- data orderan datang dari
// sheet yang bisa diedit banyak orang, bukan input tepercaya.

import { POPULASI_MARKUP } from './markup.js';
import { buildWorkbook, xlCatalog, xlDefaultSel, xlInfo, XL_PRESETS, XL_GRUP, XL_GRUP_INTERNAL } from './export.js';
import { createProgress } from './progress.js';

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
const LS_PAGE = 'pnm_populasi_set_page_size';
const LS_MODE = 'pnm_populasi_mode';          // 'populasi' | 'progress' (mode terakhir dipakai)
const PAGE_SIZES = [25, 50, 100];   // pilihan baris per halaman; halaman 1 selalu dimulai dari yang teratas
const DEFAULT_PROV = '';          // default: semua provinsi
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

// Satuan hitung (sisi JS). Harus sama dengan public.fn_satuan_hitung di populasi_v2_unit.sql.
//   set  = set instrumen utuh
//   pcs  = instrumen satuan (termasuk isi set dan BMHP), dihitung per buah
//   unit = alat: elektromedis, alat laboratorium, penunjang medis, unit lainnya, dihitung per unit alat
const KEL_UNIT = ['ELEKTROMEDIS', 'ALAT LABORATORIUM', 'UNIT', 'PENUNJANG MEDIS'];
const satuanKel = (id) => (id === 'SET' ? 'set' : (KEL_UNIT.includes(id) ? 'unit' : 'pcs'));
const satuanBaris = (l) => (l.kind === 'SET' ? 'set' : satuanKel(l.kelompok));
const satuanList = (arr) => { const a = Array.from(new Set((arr || []).map(satuanKel))); return a.length === 1 ? a[0] : 'pcs/unit'; };
const TIP_PCS = 'Pcs = instrumen satuan, dihitung per buah (termasuk isi set yang dipesan terpisah dan BMHP).';
const TIP_UNIT = 'Unit = alat medis, elektromedis, dan alat penunjang laboratorium, dihitung per unit alat.';

let mountedContainer = null;
let handlers = null;
let progress = null;                // pengendali mode Progress order (progress.js)
let searchTimer = null;
let reqId = 0;

const state = {
  provinsi: DEFAULT_PROV, status: 'DELIVERED', cakupan: 'POPULASI',
  kelompok: [], cari: 'produk', produk: '', pic: '', distributor: '', spes: [], jenis: [], mikro: false, rs: '', rmp: '', isiSet: false, dari: '', sampai: '',
  sort: { k: 'total', dir: 'desc' },
  page: 1,                          // halaman tabel RS (mulai 1); kembali ke 1 saat data/filter/urutan berubah
  pageSize: (() => { const v = Number(lsGet(LS_PAGE)); return PAGE_SIZES.includes(v) ? v : 50; })(),
  tinjau: '',                       // '' | 'cek' | 'estimasi' -> tabel berganti jadi daftar pesanan
  mode: 'populasi',                 // 'populasi' | 'progress'
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

// Cache persisten (localStorage): hasil terakhir tetap ada setelah tab ditutup / halaman di-refresh,
// jadi pembukaan pertama (cache DB dingin, query paling lambat) tidak lagi layar kosong.
// Hanya beberapa entri terakhir dan hanya bila ukurannya wajar; semua akses dibungkus try/catch.
const PCACHE_KEY = 'pnm_populasi_swr_v1';
const PCACHE_MAX = 4;
const PCACHE_MAX_CHARS = 1500000;
const PCACHE_TTL_MS = 3 * 24 * 3600 * 1000;   // lewat ini dibuang; tetap disegarkan di belakang selama dipakai
function pcacheAll() {
  try { return JSON.parse(lsGet(PCACHE_KEY) || '{}') || {}; } catch (e) { return {}; }
}
function pcacheGet(key) {
  const o = pcacheAll()[key];
  return o && o.res && Date.now() - (o.t || 0) < PCACHE_TTL_MS ? o.res : null;
}
function pcacheSet(key, res, json) {
  if (json.length > PCACHE_MAX_CHARS) return;
  const all = pcacheAll();
  delete all[key];
  all[key] = { t: Date.now(), res };
  const keys = Object.keys(all);
  while (keys.length > PCACHE_MAX) delete all[keys.shift()];
  lsSet(PCACHE_KEY, JSON.stringify(all));
}

// Timeout di sisi database (statement_timeout, kode 57014). Biasanya hanya terjadi pada panggilan
// pertama saat cache Postgres dingin; panggilan kedua jauh lebih cepat, jadi dicoba ulang otomatis.
const isStmtTimeout = (e) => !!e && (e.code === '57014' || /statement timeout/i.test(String(e.message || '')));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// get_populasi_v2 mengembalikan pcs_* gabungan. Pemisahan Pcs (instrumen satuan) dan Unit (alat) diambil dari
// get_populasi_v2_unit (populasi_v2_unit.sql) dengan filter yang sama, lalu digabung per customer.
const SPLIT_KEYS = ['pcs_terkirim', 'pcs_proses', 'unit_terkirim', 'unit_proses'];
function gabungUnit(res, sp) {
  if (!res) return res;
  const by = new Map(((sp && sp.rows) || []).map((x) => [x.customer, x]));
  const isi = (r) => {
    const src = by.get(r.customer) || {};
    const o = {};
    SPLIT_KEYS.forEach((k) => { o[k] = Number(src[k]) || 0; });
    o.pcs_total = o.pcs_terkirim + o.pcs_proses;
    o.unit_total = o.unit_terkirim + o.unit_proses;
    return Object.assign({}, r, o);
  };
  const out = Object.assign({}, res);
  out.rows = (res.rows || []).map(isi);
  out.belum_terpetakan = (res.belum_terpetakan || []).map(isi);
  const rg = Object.assign({}, res.ringkasan);
  SPLIT_KEYS.forEach((k) => { rg[k] = out.rows.reduce((a, r) => a + (Number(r[k]) || 0), 0); });
  rg.pcs_total = rg.pcs_terkirim + rg.pcs_proses;
  rg.unit_total = rg.unit_terkirim + rg.unit_proses;
  if (Number(res.ringkasan && res.ringkasan.pcs_total) !== rg.pcs_total + rg.unit_total) {
    console.warn('Populasi: pcs + unit (' + (rg.pcs_total + rg.unit_total) + ') berbeda dari pcs_total server (' + (res.ringkasan && res.ringkasan.pcs_total) + ')');
  }
  out.ringkasan = rg;
  return out;
}
// Daftar PIC order untuk dropdown: tidak bergantung pada filter lain, jadi cukup diambil sekali per cakupan.
// null = RPC belum terpasang (dicatat, supaya tidak ditanyakan terus tiap muat ulang).
const picOpsi = new Map();
async function ambilOpsiPic(cakupan) {
  const k = cakupan || 'POPULASI';
  if (picOpsi.has(k)) return picOpsi.get(k);
  try {
    const r = await rpc('get_populasi_v2_pic_order', { p_cakupan: k });
    const v = Array.isArray(r) ? r : null;
    if (v) picOpsi.set(k, v);
    return v;
  } catch (e) {
    if (e && (e.code === 'PGRST202' || e.status === 404)) picOpsi.set(k, null);
    return null;
  }
}

// get_populasi_v3 (populasi_v3_satu_panggilan.sql) = get_populasi_v2 + pemisahan pcs/unit dalam SATU panggilan
// (jalur lama: v2 + v2_unit = 3x evaluasi populasi_grup_v3 per muat). null = belum dicoba, false = belum terpasang.
let v3ok = null;
async function ambilPopulasi(params) {
  if (v3ok !== false) {
    try {
      const [res3, ops3] = await Promise.all([rpc('get_populasi_v3', params), ambilOpsiPic(params.p_cakupan)]);
      v3ok = true;
      const o3 = res3 || {};
      o3.opsi_pic = Array.isArray(ops3) ? ops3 : null;
      return o3;
    } catch (e) {
      if (e && (e.code === 'PGRST202' || e.status === 404) && !params.p_distributor) v3ok = false;   // belum terpasang: pakai jalur lama (kecuali yang kurang hanya p_distributor)
      else throw e;
    }
  }
  const [res, sp, ops] = await Promise.all([
    rpc('get_populasi_v2', params),
    rpc('get_populasi_v2_unit', params).catch((e) => {
      if (e && (e.code === 'PGRST202' || e.status === 404)) {
        throw new Error(params.p_pic_order
          ? 'RPC get_populasi_v2_unit belum mendukung filter PIC order. Jalankan patch SQL filter PIC order di Supabase SQL Editor.'
          : 'RPC get_populasi_v2_unit belum terpasang. Jalankan populasi_v2_unit.sql di Supabase SQL Editor.');
      }
      throw e;
    }),
    ambilOpsiPic(params.p_cakupan),    // opsional: RPC belum terpasang -> dropdown PIC order tetap tersembunyi
  ]);
  const out = gabungUnit(res, sp);
  if (out) out.opsi_pic = Array.isArray(ops) ? ops : null;
  return out;
}

async function rpc(fn, params, timeoutMs = RPC_TIMEOUT_MS) {
  // Hanya baca, dan hanya SEKALI: bila querynya memang berat (bukan cache dingin), mengulang cuma melipatgandakan beban.
  const retries = /^get_/.test(fn) ? 1 : 0;
  for (let i = 0; ; i++) {
    try {
      return await rpcOnce(fn, params, timeoutMs);
    } catch (e) {
      if (i >= retries || !isStmtTimeout(e)) throw e;
      await sleep(600 * (i + 1));
    }
  }
}

async function rpcOnce(fn, params, timeoutMs = RPC_TIMEOUT_MS) {
  if (!/^get_/.test(fn)) { swrCache.clear(); lsSet(PCACHE_KEY, '{}'); }
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

// Atribut produk (spesialisasi, jenis, mikro) -> satu parameter jsonb. null bila tidak ada pilihan.
function atributParam(st = state) {
  const a = {};
  if (st.spes.length) a.spes = st.spes.slice();
  if (st.jenis.length) a.jenis = st.jenis.slice();
  if (st.mikro) a.mikro = true;
  return Object.keys(a).length ? a : null;
}
function spesNama(s) { return rumpunNama(s); }
function jenisNama(s) { return s === 'LAINNYA' ? 'Lainnya' : rumpunNama(s); }
function atributText(st = state) {
  const p = [];
  if (st.spes.length) p.push(st.spes.map(spesNama).join(', '));
  if (st.jenis.length) p.push(st.jenis.map(jenisNama).join(', '));
  if (st.mikro) p.push('mikro');
  return p.join(' · ');
}
function toggleAtribut(key, k) {
  if (!k) state[key] = [];
  else {
    const i = state[key].indexOf(k);
    if (i >= 0) state[key].splice(i, 1); else state[key].push(k);
  }
  load();
}

function filterParams() {
  const p = {
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
  const at = atributParam();
  if (at) p.p_atribut = at;        // hanya dikirim bila dipakai
  if (state.distributor) p.p_distributor = state.distributor;   // hanya dikirim bila dipakai (RPC butuh patch SQL p_distributor)
  if (state.pic) p.p_pic_order = state.pic;   // idem: RPC lama tanpa p_pic_order tetap jalan selama filter ini tidak dipakai
  return p;
}

function kategoriText(st = state) {
  const k = st.kelompok.map(katName);
  const base = k.length ? k.join(', ') : 'Semua kategori';
  const at = atributText(st);
  return at ? `${base} (${at})` : base;
}
function periodeText(st = state) {
  if (!st.dari && !st.sampai) return 'Semua tanggal';
  return `${st.dari ? fmtDate(st.dari) : 'awal'} s/d ${st.sampai ? fmtDate(st.sampai) : 'sekarang'}`;
}

// ── muat data ───────────────────────────────────────────────────────────────
async function load() {
  const my = ++reqId;
  $('ps-table').classList.add('ps-busy');
  $('ps-table').setAttribute('aria-busy', 'true');
  $('ps-stats').classList.add('ps-busy');
  const scope = $('ps-scope');
  if (scope) scope.classList.add('ps-loading');
  clearError();
  renderCats();
  renderAtribut();
  renderActive();
  try {
    const params = filterParams();
    const key = 'u2|' + JSON.stringify(params);   // 'u2' = hasil sudah memuat pemisahan pcs/unit; cache lama tidak dipakai
    let hit = swrCache.get(key);
    if (!hit) {
      const saved = pcacheGet(key);          // cache dari kunjungan sebelumnya
      if (saved) hit = { res: saved, json: JSON.stringify(saved) };
    }
    const applyResult = (res) => {
      data = res || {};
      rows = (data.rows || []).map((r) => {
        const set = num(r.set_terkirim) + num(r.set_proses);
        const pcs = num(r.pcs_terkirim) + num(r.pcs_proses);
        const unit = num(r.unit_terkirim) + num(r.unit_proses);
        return Object.assign({}, r, { set, pcs, unit, total: set + pcs + unit });
      });
      unmapped = data.belum_terpetakan || [];
      detailCache.clear();
      linesAll = null;
      recon = {};
      state.page = 1;
      applySort();
      render();
    };
    if (hit) applyResult(hit.res);      // tampilkan hasil terakhir seketika, lalu segarkan di belakang
    const res = await ambilPopulasi(params);
    if (my !== reqId) return;           // respons telat tidak boleh menimpa yang lebih baru
    const json = JSON.stringify(res || {});
    swrCache.delete(key);
    swrCache.set(key, { res, json });
    pcacheSet(key, res, json);
    while (swrCache.size > SWR_MAX) swrCache.delete(swrCache.keys().next().value);
    if (!hit || hit.json !== json) applyResult(res);   // data sama -> tidak render ulang (baris terbuka tetap)
  } catch (e) {
    if (my !== reqId || String(e.message).startsWith('unauthorized')) return;
    const missing = e.code === 'PGRST202' || e.status === 404;
    let msg = missing
      ? (state.distributor
        ? 'RPC get_populasi_v3 belum mendukung filter distributor. Jalankan patch SQL p_distributor di Supabase SQL Editor.'
        : state.pic
        ? 'RPC get_populasi_v2 belum mendukung filter PIC order. Jalankan patch SQL filter PIC order di Supabase SQL Editor.'
        : 'RPC get_populasi_v2 belum terpasang. Jalankan populasi_v2.sql di Supabase SQL Editor.')
      : (isStmtTimeout(e)
        ? 'Database terlalu lama menjawab (sudah dicoba ulang sekali). Coba lagi sebentar, atau persempit filter (provinsi / kategori).'
        : 'Gagal memuat data: ' + e.message);
    if (data) msg = 'Gagal menyegarkan, yang tampil adalah hasil tersimpan sebelumnya. ' + msg;
    showError(msg);
    if (!data) {
      renderHead({ set: false, pcs: false, unit: false, n: 5 });
      $('ps-body').innerHTML = `<tr><td colspan="5" class="ps-empty ps-empty-err">${esc(msg)}<br><button type="button" class="btn btn-ghost ps-retry" data-action="ps-reload">Coba lagi</button></td></tr>`;
    }
  } finally {
    if (my === reqId) {
      $('ps-table').classList.remove('ps-busy');
      $('ps-table').removeAttribute('aria-busy');
      $('ps-stats').classList.remove('ps-busy');
      if (scope) scope.classList.remove('ps-loading');
    }
  }
}

// ── snapshot di database ────────────────────────────────────────────────────
// Setelah koreksi (wilayah RS, kategori, atribut, alihan set) snapshot hasil di database ditandai kotor dan
// halaman jatuh ke jalur live (±7 dtk, mepet batas 8 dtk). Karena itu snapshot dibangun ulang SEKALI sesudah
// koreksi (bukan tiap simpan), lalu hasil dimuat ulang dari snapshot yang baru. Bila pembangunan gagal atau
// RPC-nya belum terpasang, load() tetap jalan lewat jalur live seperti biasa.
let snapKotor = false;
async function segarkanSnapshot() {
  snapKotor = false;
  if (!mountedContainer) return;
  const scope = $('ps-scope');
  if (scope) scope.classList.add('ps-loading');
  try {
    await rpc('refresh_populasi_snap', {}, EXPORT_TIMEOUT_MS);
  } catch (e) {
    if (String(e.message).startsWith('unauthorized')) return;
    /* abaikan: load() di bawah memakai jalur live */
  }
  if (!mountedContainer) return;
  return load();
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
    if (k === 'unit') return r.unit;
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
  renderPic();
  renderCats();
  renderAtribut();
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

// Dropdown pic: baru muncul bila RPC get_populasi_v2_pic_order ada (atau PIC sedang terpilih, supaya bisa dilepas).
function renderPic() {
  const wrap = $('ps-pic-wrap');
  const sel = $('ps-pic');
  if (!wrap || !sel) return;
  const opsi = data && Array.isArray(data.opsi_pic) ? data.opsi_pic : null;
  if (!opsi && !state.pic) { wrap.hidden = true; return; }
  const names = new Set((opsi || []).map((o) => o.pic));
  let html = '<option value="">Semua PIC order</option>' +
    (opsi || []).map((o) => `<option value="${esc(o.pic)}" title="${esc(fmt(o.jumlah_po) + ' PO')}">${esc(o.pic)}</option>`).join('');
  if (state.pic && !names.has(state.pic)) html += `<option value="${esc(state.pic)}">${esc(state.pic)}</option>`;
  sel.innerHTML = html;
  sel.value = state.pic;
  wrap.hidden = false;
}

// Chip dirender ulang lewat innerHTML (elemen diganti), jadi fokus keyboard dipulihkan ke chip yang sama.
function keepFocus(fn) {
  const a = document.activeElement;
  const act = a && a.dataset ? a.dataset.action : null;
  const k = a && a.dataset ? a.dataset.k : undefined;
  fn();
  if (!act || k === undefined || !mountedContainer) return;
  const el = mountedContainer.querySelector(`[data-action="${act}"][data-k="${CSS.escape(k)}"]`);
  if (el && el !== document.activeElement) el.focus();
}

// Chip kategori: angka kecil = jumlah RS yang punya kategori itu pada filter lain yang aktif.
// Kategori tanpa RS tidak ditawarkan (memilihnya hanya membawa ke hasil kosong), kecuali yang sedang dipilih
// supaya tetap bisa dilepas.
function renderCats() {
  const el = $('ps-cats');
  if (!el) return;
  const opsi = (data && Array.isArray(data.opsi_kelompok) && data.opsi_kelompok.length) ? data.opsi_kelompok : null;
  const cnt = {};
  (opsi || []).forEach((o) => { cnt[o.kelompok] = o; });
  const all = !state.kelompok.length;
  keepFocus(() => {
    let html = `<button type="button" class="filter-btn ps-cat${all ? ' active' : ''}" aria-pressed="${all}" data-action="ps-cat" data-k="">Semua</button>`;
    html += KELOMPOK.map((k) => {
      const on = state.kelompok.includes(k.id);
      const n = cnt[k.id] ? num(cnt[k.id].jumlah_rs) : 0;
      if (opsi && !n && !on) return '';
      const dim = opsi && !n ? ' dim' : '';
      const badge = data ? `<span class="ps-cat-n" title="${fmt(n)} RS">${fmt(n)}</span>` : '';
      return `<button type="button" class="filter-btn ps-cat${on ? ' active' : ''}${dim}" aria-pressed="${on}" data-action="ps-cat" data-k="${esc(k.id)}">${esc(k.nama)}${badge}</button>`;
    }).join('');
    el.innerHTML = html;
  });
}

// Baris chip atribut (boleh lebih dari satu). Angka = jumlah RS pada filter lain yang aktif
// (kategori, provinsi, dan atribut LAIN), bukan pada atribut itu sendiri, jadi pilihan bernilai > 0 tidak
// pernah membawa ke hasil kosong. Pilihan bernilai 0 disembunyikan, kecuali yang sedang dipilih (agar bisa dilepas).
function renderChipRow(wrapId, elId, opsi, key, terpilih, action, nama) {
  const wrap = $(wrapId);
  const el = $(elId);
  if (!wrap || !el) return false;
  const ada = new Set(opsi.map((o) => o[key]));
  const semua = opsi.concat(terpilih.filter((s) => !ada.has(s)).map((s) => ({ [key]: s, jumlah_rs: 0 })))
    .filter((o) => num(o.jumlah_rs) > 0 || terpilih.includes(o[key]));
  wrap.hidden = !semua.length;
  if (wrap.hidden) { el.innerHTML = ''; return false; }
  const all = !terpilih.length;
  keepFocus(() => {
    let html = `<button type="button" class="filter-btn ps-cat${all ? ' active' : ''}" aria-pressed="${all}" data-action="${action}" data-k="">Semua</button>`;
    html += semua.map((o) => {
      const on = terpilih.includes(o[key]);
      const n = num(o.jumlah_rs);
      return `<button type="button" class="filter-btn ps-cat${on ? ' active' : ''}${n ? '' : ' dim'}" aria-pressed="${on}" data-action="${action}" data-k="${esc(o[key])}" title="${esc(fmt(n) + ' RS')}">${esc(nama(o[key]))}<span class="ps-cat-n">${fmt(n)}</span></button>`;
    }).join('');
    el.innerHTML = html;
  });
  return true;
}

function renderAtribut() {
  const d = data || {};
  renderChipRow('ps-spes-wrap', 'ps-spes', d.opsi_spes || [], 'spes', state.spes, 'ps-spes', spesNama);
  const adaJenis = renderChipRow('ps-jenis-det', 'ps-jenis', d.opsi_jenis || [], 'jenis', state.jenis, 'ps-jenis', jenisNama);
  const sum = $('ps-jenis-sum');
  if (sum && adaJenis) sum.textContent = 'Jenis instrumen' + (state.jenis.length ? ` (${state.jenis.length} dipilih)` : '');
  const w = $('ps-mikro-wrap');
  if (w) {
    const m = d.opsi_mikro || null;
    w.hidden = !(state.mikro || (m && num(m.jumlah_kode) > 0));
    $('ps-mikro').checked = state.mikro;
    $('ps-mikro-t').textContent = m && num(m.jumlah_rs) ? `Hanya mikrosurgery (${fmt(m.jumlah_rs)} RS)` : 'Hanya mikrosurgery';
  }
}

const rumpunNama = (r) => (r === 'LAINNYA' ? 'Belum dikelompokkan' : String(r || '').replace(/\w\S*/g, (w) => w.charAt(0) + w.slice(1).toLowerCase()).replace(/\bTht\b/, 'THT').replace(/\bObgyn\b/, 'OBGYN'));

const distributorNama = (v) => (v === 'SAMAYA' ? 'Samaya' : v === 'NON_SAMAYA' ? 'Non-Samaya' : '');
// Filter yang sedang aktif, masing-masing bisa dilepas (atau lepas semua sekaligus).
function renderActive() {
  const el = $('ps-active');
  if (!el) return;
  const a = [];
  if (state.distributor) a.push({ k: 'distributor', t: `Distributor: ${distributorNama(state.distributor)}` });
  if (state.pic) a.push({ k: 'pic', t: `PIC order: ${state.pic}` });
  if (state.spes.length) a.push({ k: 'spes', t: `Spesialisasi: ${state.spes.map(spesNama).join(', ')}` });
  if (state.jenis.length) a.push({ k: 'jenis', t: `Jenis: ${state.jenis.map(jenisNama).join(', ')}` });
  if (state.mikro) a.push({ k: 'mikro', t: 'Hanya mikrosurgery' });
  if (state.produk.trim()) a.push({ k: 'produk', t: `Produk: ${state.produk.trim()}` });
  if (state.produk.trim() && state.isiSet) a.push({ k: 'isi', t: 'Termasuk isi set' });
  if (state.rs.trim()) a.push({ k: 'rs', t: `RS / RMP: ${state.rs.trim()}` });
  if (state.rmp.trim()) a.push({ k: 'rmp', t: `No. RMP: ${state.rmp.trim()}` });
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
  estimasi: 'Jumlah set dihitung dari perkiraan QTY: set belum ada di daftar produk, atau isi di sheet tidak lengkap/berbeda dari isi set.',
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
  const tip = o.title ? ` title="${esc(o.title)}"` : '';
  const sub = o.sub ? `<div class="stat-sub">${esc(o.sub)}</div>` : '';
  const inner = `<div class="stat-val">${val}</div><div class="stat-label">${esc(label)}</div>${sub}${o.subHtml || ''}`;
  if (o.tinjau) {
    return `<button type="button" class="stat-card ps-stat-act${o.warn ? ' ps-stat-warn' : ''}${o.on ? ' on' : ''}" data-action="ps-tinjau" data-k="${o.tinjau}" aria-pressed="${!!o.on}" title="${esc(TIP[o.tinjau])}">${inner}<div class="ps-stat-go">${o.on ? 'Sedang ditampilkan' : 'Lihat daftar'}</div></button>`;
  }
  return `<div class="stat-card"${tip}>${inner}</div>`;
}

function linkBtn(k, teks) {
  const on = state.tinjau === k;
  return `<button type="button" class="ps-linkbtn${on ? ' on' : ''}" data-action="ps-tinjau" data-k="${k}" aria-pressed="${on}" title="${esc(TIP[k])}">${esc(teks)}</button>`;
}

function renderSummary() {
  const s = data.ringkasan || {};
  const hasSet = num(s.set_total) > 0 || num(s.set_cek) > 0;
  const hasPcs = num(s.pcs_total) > 0;
  const hasUnit = num(s.unit_total) > 0;
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
    cards.push(statCard(fmt(s.pcs_total), 'Pcs', { sub: status ? `${fmt(s.pcs_terkirim)} terkirim · ${fmt(s.pcs_proses)} proses` : '', title: TIP_PCS }));
  }
  if (hasUnit) {
    cards.push(statCard(fmt(s.unit_total), 'Unit', { sub: status ? `${fmt(s.unit_terkirim)} terkirim · ${fmt(s.unit_proses)} proses` : '', title: TIP_UNIT }));
  }
  if (hasSet || hasPcs || hasUnit) {
    const last = rows.reduce((m, r) => (r.terakhir && r.terakhir > m ? r.terakhir : m), '');
    cards.push(statCard(fmt(s.jumlah_pesanan), 'Pesanan', { sub: last ? 'terakhir ' + fmtDate(last) : '' }));
  }
  const cek = angka('cek');
  if (cek > 0) cards.push(statCard(fmt(cek), 'Pesanan set perlu dicek', { sub: 'belum dihitung sebagai set', warn: true, tinjau: 'cek', on: state.tinjau === 'cek' }));
  $('ps-stats').innerHTML = cards.join('');

  // Tidak ada catatan hitungan tambahan: semua pesanan masuk hitungan atau tampil sebagai "perlu dicek".
  // Satu baris keterangan satuan, hanya untuk satuan yang tampil, supaya tidak ada angka yang artinya menggantung.
  const cv = $('ps-caveats');
  const ket = [].concat(
    hasPcs ? ['<b>Pcs</b> = instrumen satuan, per buah.'] : [],
    hasUnit ? ['<b>Unit</b> = alat medis, elektromedis, dan alat penunjang lab, per unit alat.'] : []);
  cv.hidden = !ket.length;
  cv.innerHTML = ket.length ? `<span class="ps-muted">${ket.join(' ')}</span>` : '';

  const xl = document.querySelector('[data-action="ps-xlsx"]');
  if (xl) xl.disabled = !rows.length;
}

function rincianText(r, sep = ', ') {
  return (r.rincian || []).map((j) => `${j.label} ×${fmt(j.nilai)}`).join(sep);
}

function sortTh(key, label, cls, tip) {
  const on = state.sort.k === key;
  const aria = on ? (state.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
  const icon = on ? (state.sort.dir === 'asc' ? 'ti-sort-ascending' : 'ti-sort-descending') : 'ti-arrows-sort';
  return `<th class="${cls}" aria-sort="${aria}"><button type="button" class="ps-sort${on ? ' on' : ''}" data-action="ps-sort" data-k="${key}" title="${esc(tip || ('Urutkan menurut ' + label.toLowerCase()))}">${esc(label)}<i class="ti ${icon}" aria-hidden="true"></i></button></th>`;
}

function renderHead(cols) {
  $('ps-thead').innerHTML = '<tr>' +
    sortTh('customer', 'Rumah sakit', '') +
    sortTh('wilayah', 'Wilayah', '') +
    (cols.set ? sortTh('set', 'Set', 'ps-th-num') : '') +
    (cols.pcs ? sortTh('pcs', 'Pcs', 'ps-th-num', TIP_PCS + ' Klik untuk mengurutkan.') : '') +
    (cols.unit ? sortTh('unit', 'Unit', 'ps-th-num', TIP_UNIT + ' Klik untuk mengurutkan.') : '') +
    '<th>Rincian</th>' +
    sortTh('terakhir', 'Terakhir', '') +
    '<th class="ps-col-act"><span class="ps-sr">Aksi</span></th>' +
    '</tr>';
}

function colsInfo() {
  const s = (data && data.ringkasan) || {};
  const set = num(s.set_total) > 0 || num(s.set_cek) > 0;
  const pcs = num(s.pcs_total) > 0;
  const unit = num(s.unit_total) > 0;
  return { set, pcs, unit, n: 5 + (set ? 1 : 0) + (pcs ? 1 : 0) + (unit ? 1 : 0) };
}

// Hasil kosong: jelaskan, lalu tawarkan hanya langkah yang berlaku pada filter saat ini. Tiap tombol melonggarkan satu filter.
function emptyHtml() {
  const p = state.produk.trim();
  const b = (label, attrs) => `<button type="button" class="btn btn-ghost" ${attrs}>${esc(label)}</button>`;
  const act = [];
  if (p) act.push(b(`Lepas pencarian produk “${p.length > 24 ? p.slice(0, 24) + '…' : p}”`, 'data-action="ps-clear" data-k="produk"'));
  if (p && !state.isiSet) act.push(b('Cari juga di isi set', 'data-action="ps-isi-on"'));
  if (p && state.kelompok.length) act.push(b('Cari di semua kategori', 'data-action="ps-cat" data-k=""'));
  if (state.pic) act.push(b('Lepas filter PIC order', 'data-action="ps-clear" data-k="pic"'));
  if (state.distributor) act.push(b(`Lepas filter distributor (${distributorNama(state.distributor)})`, 'data-action="ps-clear" data-k="distributor"'));
  if (atributParam()) act.push(b('Lepas filter spesialisasi dan jenis', 'data-action="ps-clear" data-k="atribut"'));
  if (state.rs.trim()) act.push(b('Lepas pencarian RS', 'data-action="ps-clear" data-k="rs"'));
  if (state.dari || state.sampai) act.push(b('Lepas periode', 'data-action="ps-clear" data-k="periode"'));
  if (state.status !== 'ALL') act.push(b('Tambahkan pesanan dalam proses', 'data-action="ps-status" data-v="ALL"'));
  if (state.provinsi) act.push(b('Tampilkan semua provinsi', 'data-action="ps-prov-all"'));
  const unm = state.provinsi && unmapped.length
    ? `<br>${esc(`Ada ${fmt(unmapped.length)} RS yang wilayahnya belum diketahui (lihat bagian bawah).`)}` : '';
  return 'Tidak ada RS yang cocok dengan filter ini.' + unm + (act.length ? `<div class="ps-empty-act">${act.join('')}</div>` : '');
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
  const pg = $('ps-pager');
  if (pg) pg.hidden = true;                      // dinyalakan lagi oleh renderPager bila perlu
  if (state.tinjau) { renderReview(); return; }
  if (rmpAktif()) { renderRmp(); return; }       // cari No. RMP: tabel RS berganti jadi daftar pesanan
  reviewReq++;                                  // batalkan daftar tinjau yang masih memuat
  $('ps-review-bar').hidden = true;
  $('ps-actions').hidden = false;
  const cols = colsInfo();
  renderHead(cols);
  $('ps-tbl-title').textContent = rows.length ? `${fmt(rows.length)} rumah sakit` : 'Rumah sakit';
  const cp = document.querySelector('[data-action="ps-copy"]');
  if (cp) cp.disabled = !rows.length;                 // tidak ada yang bisa disalin
  const ur = $('ps-urut');
  if (ur) ur.disabled = rows.length < 2;              // mengurutkan satu baris tidak berarti apa-apa
  const body = $('ps-body');
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="${cols.n}" class="ps-empty">${emptyHtml()}</td></tr>`;
    return;
  }
  const pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
  if (state.page > pages) state.page = pages;
  if (state.page < 1) state.page = 1;
  const start = (state.page - 1) * state.pageSize;
  body.innerHTML = rows.slice(start, start + state.pageSize).map((r, j) => {
    const i = start + j;                         // indeks global di `rows` (dipakai data-idx)
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
    const subUnit = num(r.unit_proses) > 0 ? `<span class="ps-sub">${fmt(r.unit_terkirim)} terkirim, ${fmt(r.unit_proses)} proses</span>` : '';
    const cell = (v, sub) => (v ? `<b>${fmt(v)}</b>${sub}` : '<span class="ps-muted">—</span>');
    return `
      <tr class="ps-row${num(r.set_cek) > 0 ? ' has-cek' : ''}" data-action="ps-toggle" data-idx="${i}">
        <td class="ps-col-rs"><button type="button" class="ps-rs-btn" data-action="ps-toggle" data-idx="${i}" aria-expanded="false" title="Lihat PO dan isinya"><i class="ti ti-chevron-right ps-chev" aria-hidden="true"></i><span class="ps-rs">${esc(r.customer)}</span></button></td>
        <td class="ps-col-wil">${wilayah}</td>
        ${cols.set ? `<td class="ps-num">${cell(r.set, subSet)}${subCek}</td>` : ''}
        ${cols.pcs ? `<td class="ps-num">${cell(r.pcs, subPcs)}</td>` : ''}
        ${cols.unit ? `<td class="ps-num">${cell(r.unit, subUnit)}</td>` : ''}
        <td class="ps-jenis"><div class="ps-jenis-list">${items}</div>${more}</td>
        <td class="ps-date">${esc(fmtDate(r.terakhir))}</td>
        <td class="ps-col-act"><button type="button" class="ps-rowact" data-action="ps-edit-wil" data-idx="${i}" title="${esc(editTip)}" aria-label="Ubah wilayah ${esc(r.customer)}"><i class="ti ti-pencil" aria-hidden="true"></i> Ubah wilayah</button></td>
      </tr>`;
  }).join('');
  renderPager();
}

// ── paginasi tabel RS ──────────────────────────────────────────────────
// Daftar nomor halaman: 1, halaman sekitar yang aktif, dan terakhir; 0 = celah (…).
function pageList(cur, last) {
  const keep = new Set([1, last, cur - 1, cur, cur + 1]);
  if (cur <= 3) { keep.add(2); keep.add(3); keep.add(4); }
  if (cur >= last - 2) { keep.add(last - 1); keep.add(last - 2); keep.add(last - 3); }
  const list = [...keep].filter((p) => p >= 1 && p <= last).sort((a, b) => a - b);
  const out = [];
  list.forEach((p, k) => { if (k && p - list[k - 1] > 1) out.push(0); out.push(p); });
  return out;
}

function renderPager() {
  const pg = $('ps-pager');
  if (!pg) return;
  const total = rows.length;
  if (state.tinjau || total <= PAGE_SIZES[0]) { pg.hidden = true; pg.innerHTML = ''; return; }
  const last = Math.max(1, Math.ceil(total / state.pageSize));
  const cur = state.page;
  const from = (cur - 1) * state.pageSize + 1;
  const to = Math.min(total, cur * state.pageSize);
  const btn = (label, p, o = {}) => `<button type="button" class="filter-btn ps-pg${o.on ? ' active' : ''}" data-action="ps-page" data-p="${p}"` +
    `${o.on ? ' aria-current="page"' : ''}${o.off ? ' disabled' : ''}${o.aria ? ` aria-label="${o.aria}"` : ''}>${label}</button>`;
  const nums = pageList(cur, last).map((p) => (p ? btn(p, p, { on: p === cur, aria: `Halaman ${p}` }) : '<span class="ps-pg-gap" aria-hidden="true">…</span>')).join('');
  pg.hidden = false;
  pg.innerHTML =
    `<div class="ps-pager-info">Menampilkan <b>${fmt(from)}–${fmt(to)}</b> dari ${fmt(total)} rumah sakit</div>` +
    `<div class="ps-pager-nav">${btn('<i class="ti ti-chevron-left" aria-hidden="true"></i> Sebelumnya', cur - 1, { off: cur <= 1 })}${nums}${btn('Berikutnya <i class="ti ti-chevron-right" aria-hidden="true"></i>', cur + 1, { off: cur >= last })}</div>` +
    `<label class="ps-pager-size"><span>Baris per halaman</span><select class="filter-select" id="ps-page-size" aria-label="Baris per halaman">` +
    PAGE_SIZES.map((n) => `<option value="${n}"${n === state.pageSize ? ' selected' : ''}>${n}</option>`).join('') + '</select></label>';
}

function goPage(p, keepFocus = true) {
  const last = Math.max(1, Math.ceil(rows.length / state.pageSize));
  const to = Math.min(last, Math.max(1, Math.floor(Number(p)) || 1));
  if (to === state.page) return;
  state.page = to;
  renderTable();
  const t = $('ps-table');
  if (t && t.scrollIntoView) t.scrollIntoView({ block: 'start' });     // mulai dari atas daftar halaman baru
  if (keepFocus) { const cur = document.querySelector('#ps-pager [aria-current="page"]'); if (cur) cur.focus({ preventScroll: true }); }
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
  if (d.status_hitung === 'estimasi') return d.set_kode ? 'Isi di sheet tidak lengkap atau berbeda dari isi set, jadi jumlahnya dihitung dari perkiraan QTY.' : 'Set tidak ada di daftar produk, jadi jumlahnya dihitung dari perkiraan QTY.';
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
  return isSet ? ((sh === 'cek') ? '—' : `${fmt(d.nilai)} set`) : `${fmt(d.nilai)} ${satuanKel(d.kelompok)}`;
}

function setTinjau(k) {
  state.tinjau = (!k || state.tinjau === k || !TINJAU[k]) ? '' : k;
  if (!data) return;
  renderSummary();
  renderTable();
  if (state.tinjau) { const bar = $('ps-review-bar'); if (bar && bar.scrollIntoView) bar.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
}

// ── cari No. RMP ─────────────────────────────────────────────────────────────
// Cakupan ketiga di kotak cari. Dikerjakan di sisi klien dari get_populasi_v2_baris (baris pesanan, sama dengan
// bahan Excel dan daftar tinjau) pada filter yang sedang aktif, jadi tidak butuh RPC baru. Hasilnya daftar
// PESANAN (RS, No. RMP, No. PO, produk, jumlah, status), bukan tabel RS, karena yang dicari satu nomor RMP.
// Pencocokan longgar: huruf besar/kecil, spasi, tanda hubung dan garis miring diabaikan ("25-054" cocok dengan
// "RMP/25/054"); awalan "RMP" di ketikan boleh ada boleh tidak. Beberapa nomor dipisah koma, titik koma, atau baris baru.
const RMP_MAX = 300;      // batas baris yang digambar; sisanya diminta dipersempit
const rmpNorm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '');
function rmpTerms(q = state.rmp) {
  return String(q || '').split(/[,;|\n]+/).map(rmpNorm).filter(Boolean);
}
const rmpAktif = () => rmpTerms().length > 0;
function rmpSaring(list) {
  const t = rmpTerms();
  if (!t.length) return list;
  return list.filter((l) => {
    const hay = rmpNorm(l.kode_rmp);
    return !!hay && t.some((x) => hay.includes(x) || (x.length > 3 && x.startsWith('rmp') && hay.includes(x.slice(3))));
  });
}

// Dipanggil setelah ketikan di cakupan RMP (sudah di-debounce). Data RS sudah ada; cukup gambar ulang tabel.
function terapkanRmp() {
  if (!data) return;               // data belum datang: load() akan merender sesuai state.rmp
  renderActive();
  renderTable();
}

function rmpEmptyHtml() {
  const b = (label, attrs) => `<button type="button" class="btn btn-ghost" ${attrs}>${esc(label)}</button>`;
  const sempit = state.kelompok.length || state.provinsi || state.status !== 'ALL' || atributParam() || state.distributor || state.pic ||
    state.produk.trim() || state.rs.trim() || state.dari || state.sampai;
  const act = [];
  if (sempit) act.push(b('Cari di semua provinsi, kategori, dan status', 'data-action="ps-rmp-lebar"'));
  act.push(b('Lepas pencarian RMP', 'data-action="ps-clear" data-k="rmp"'));
  return `Tidak ada pesanan dengan No. RMP “${esc(state.rmp.trim())}” pada filter ini.` +
    '<br>Spasi, tanda hubung, dan garis miring tidak berpengaruh. Pesanan di provinsi, kategori, atau status lain tidak ikut dicari.' +
    `<div class="ps-empty-act">${act.join('')}</div>`;
}

async function renderRmp() {
  const my = ++reviewReq;
  const q = state.rmp.trim();
  const lepas = '<button type="button" class="btn btn-ghost" data-action="ps-clear" data-k="rmp">Lepas pencarian RMP</button>';
  const bar = $('ps-review-bar');
  const body = $('ps-body');
  $('ps-actions').hidden = true;
  $('ps-tbl-title').textContent = 'Pesanan menurut No. RMP';
  $('ps-thead').innerHTML = '<tr><th>Rumah sakit</th><th>No. RMP</th><th>No. PO</th><th>Set / produk</th><th class="ps-th-num">Jumlah</th><th>Status</th><th>Tanggal</th></tr>';
  bar.hidden = false;
  bar.innerHTML = `<span class="ps-review-msg">Mencari No. RMP “${esc(q)}”…</span>${lepas}`;
  body.innerHTML = '<tr><td colspan="7" class="ps-empty" role="status">Memuat pesanan…</td></tr>';

  let list;
  try {
    list = await fetchLines();
  } catch (e) {
    if (my !== reviewReq || String(e.message).startsWith('unauthorized')) return;
    bar.innerHTML = `<span class="ps-review-msg">Gagal memuat daftar pesanan.</span>${lepas}`;
    body.innerHTML = `<tr><td colspan="7" class="ps-empty ps-empty-err">Gagal memuat daftar: ${esc(e.message)}</td></tr>`;
    return;
  }
  if (my !== reviewReq || !rmpAktif()) return;     // ketikan berubah / tampilan berganti selagi memuat

  const hasil = rmpSaring(list).sort((a, b) =>
    String(b.tanggal || '').localeCompare(String(a.tanggal || '')) ||
    String(a.kode_rmp || '').localeCompare(String(b.kode_rmp || ''), 'id', { numeric: true }) ||
    String(a.customer).localeCompare(String(b.customer), 'id'));
  if (!hasil.length) {
    bar.innerHTML = `<span class="ps-review-msg">Tidak ada pesanan dengan No. RMP “${esc(q)}”.</span>${lepas}`;
    body.innerHTML = `<tr><td colspan="7" class="ps-empty">${rmpEmptyHtml()}</td></tr>`;
    return;
  }
  const tampil = hasil.slice(0, RMP_MAX);
  const nRmp = new Set(hasil.map((l) => rmpNorm(l.kode_rmp))).size;
  const nRs = new Set(hasil.map((l) => l.customer)).size;
  const potong = hasil.length > tampil.length
    ? `<span class="ps-review-note">Hanya ${fmt(tampil.length)} baris pertama yang ditampilkan. Ketik nomor lebih lengkap untuk mempersempit.</span>` : '';
  bar.innerHTML = `<span class="ps-review-msg"><b>${fmt(nRmp)}</b> No. RMP · <b>${fmt(nRs)}</b> rumah sakit · ${fmt(hasil.length)} baris pesanan</span>${potong}${lepas}`;

  const wil = new Map(rows.map((x) => [x.customer, x]));
  body.innerHTML = tampil.map((l) => {
    const w = wil.get(l.customer) || {};
    const lokasi = [w.kab_kota || l.kab_kota, state.provinsi ? '' : (w.provinsi || l.provinsi)].filter(Boolean).join(' · ');
    const nama = l.kind === 'SET' ? l.label : l.produk;
    const asal = l.kind === 'SET' && l.label_asli ? `<span class="ps-sub">Dialihkan dari: ${esc(l.label_asli)}</span>` : '';
    return `
      <tr class="ps-rev-row">
        <td class="ps-col-rs"><span class="ps-rs">${esc(l.customer)}</span>${lokasi ? `<span class="ps-sub">${esc(lokasi)}</span>` : ''}</td>
        <td><span class="kode-text">${esc(l.kode_rmp || '—')}</span></td>
        <td>${esc(l.po || '—')}</td>
        <td>${esc(nama)}${asal}</td>
        <td class="ps-num">${esc(jmlText(l))}</td>
        <td><span class="ps-st">${l.status === 'TERKIRIM' ? 'Terkirim' : 'Proses'}</span> ${tagHitung(l)}</td>
        <td class="ps-date">${esc(fmtDate(l.tanggal))}</td>
      </tr>`;
  }).join('');
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

  // Pencarian No. RMP hanya menyaring TAMPILAN; angka kartu (recon di atas) tetap dari daftar penuh.
  const tampil = rmpAktif() ? rmpSaring(items) : items;
  const hitungTampil = k === 'estimasi' ? tampil.reduce((a, l) => a + num(l.nilai), 0) : tampil.length;
  const saring = rmpAktif() ? ` dengan No. RMP “${esc(state.rmp.trim())}” (dari ${fmt(items.length)})` : '';
  const msg = k === 'estimasi'
    ? `Menampilkan <b>${fmt(tampil.length)}</b> pesanan ${esc(cfg.frasa)}${saring} · <b>${fmt(hitungTampil)}</b> set`
    : `Menampilkan <b>${fmt(tampil.length)}</b> pesanan ${esc(cfg.frasa)}${saring}`;
  const note = hitung !== server
    ? `<span class="ps-review-note">Ringkasan awal menyebut ${fmt(server)}; angka kartu sudah disesuaikan dengan daftar ini.</span>` : '';
  bar.innerHTML = `<span class="ps-review-msg">${msg}</span>${note}${reset}`;

  if (!tampil.length) {
    body.innerHTML = '<tr><td colspan="6" class="ps-empty">Tidak ada pesanan yang cocok pada filter ini.</td></tr>';
    return;
  }
  const wil = new Map(rows.map((x) => [x.customer, x]));
  body.innerHTML = tampil.map((l) => {
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
  const totUnit = unmapped.reduce((a, u) => a + num(u.unit_total), 0);
  const tot = [totSet ? `${fmt(totSet)} set` : '', totPcs ? `${fmt(totPcs)} pcs` : '', totUnit ? `${fmt(totUnit)} unit` : ''].filter(Boolean).join(' + ');
  box.hidden = false;
  $('ps-unm-title').innerHTML =
    `${fmt(unmapped.length)} RS belum diketahui wilayahnya ` +
    `(${esc(tot)}), <b>belum ikut</b> hasil per provinsi di atas`;
  $('ps-unm-list').innerHTML = `
    <table class="ps-unm-table"><tbody>
      ${unmapped.map((u, i) => {
        const v = [num(u.set_total) ? `${fmt(u.set_total)} set` : '', num(u.pcs_total) ? `${fmt(u.pcs_total)} pcs` : '', num(u.unit_total) ? `${fmt(u.unit_total)} unit` : ''].filter(Boolean).join(' + ');
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
    const kat = `<button type="button" class="ps-rowact" data-action="ps-kel-edit-row" data-tab="kat" data-q="${esc(d.kode_produk)}" title="Pindahkan produk ini ke kategori lain" aria-label="Ubah kategori ${esc(nama)}"><i class="ti ti-pencil" aria-hidden="true"></i> Ubah kategori</button>`;
    // Atribut (spesialisasi, jenis, mikro) hanya ada untuk instrumen satuan.
    const atr = d.kelompok === 'INSTRUMEN SATUAN'
      ? `<button type="button" class="ps-rowact" data-action="ps-kel-edit-row" data-tab="atr" data-q="${esc(d.kode_produk)}" title="Ubah spesialisasi, jenis, dan penanda mikro produk ini" aria-label="Ubah atribut ${esc(nama)}"><i class="ti ti-tag" aria-hidden="true"></i> Ubah atribut</button>`
      : '';
    return kat + atr;
  }
  return '';
}

function atributSub(d) {
  const p = [d.spes ? spesNama(d.spes) : '', d.jenis ? jenisNama(d.jenis) : '', d.mikro ? 'mikro' : ''].filter(Boolean);
  return p.length ? `<span class="ps-sub">${esc(p.join(' · '))}</span>` : '';
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
            ? `<span class="ps-sub">${esc(d.family || d.kode_produk)}</span>${atributSub(d)}`
            : (isSet ? [d.label_asli ? `Dialihkan dari: ${esc(d.label_asli)}` : '', d.rumpun ? `Kelompok: ${esc(rumpunNama(d.rumpun))}` : ''].filter(Boolean).map((t) => `<span class="ps-sub">${t}</span>`).join('') : '');
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
      await segarkanSnapshot();
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
// Tiga tab di satu dialog, pola yang sama: cari, daftar, pensil -> form di bawah baris, Simpan/Batal.
//  • Kategori produk: koreksi kategori per PRODUK (kunci = kode tanpa spasi, nol di depan angka dibuang).
//  • Atribut produk: spesialisasi, jenis, dan penanda mikro per KODE instrumen satuan (get_produk_atribut). Antrean awal =
//    kode dugaan + yang masih LAINNYA; kode yang sudah dikoreksi tetap tampil di antrean supaya hasilnya terlihat.
//  • Alihkan set: set custom yang sudah tidak dijual dihitung sebagai populasi set lain. Jumlah set tidak berubah.
// Data Google Sheet tidak diubah. Semua nilai dari DB lewat esc() / textContent.
const KAT_TARGET = KELOMPOK.filter((k) => k.id !== 'SET');
const kel = {
  tab: 'kat', q: '', kelompok: '', hanya: false, filter: 'cek', spesF: '', list: [], total: 0, tanpaKode: 0, edit: -1, draft: '',
  at: null, opsiSpes: [], opsiJenis: [], saran: [], match: '', opener: null,
};
let kelTimer = null;
let kelSaranTimer = null;
let kelReq = 0;
let kelKeyHandler = null;

const katAsal = (r) => (r.kelompok_asal || []).map(katName).join(', ');
const kelIsKat = () => kel.tab === 'kat';
const kelRow = () => kel.list[kel.edit];
const kelKodeKat = (r) => (r.ejaan && r.ejaan[0]) || r.kode_key;   // ejaan nyata dari sheet; server menormalkannya lagi

const KEL_TABS = ['kat', 'atr', 'set'];
const kelIsAtr = () => kel.tab === 'atr';
const up = (v) => String(v == null ? '' : v).toUpperCase();
// Sumber atribut yang masih dugaan (kolom `sumber` get_produk_atribut). Selain tiga ini, atribut sudah pasti.
const ATR_SUMBER = {
  'peta?': 'Dugaan dari peta spesialisasi',
  'rmp?': 'Dugaan dari No. RMP pesanan',
  kosong: 'Belum ada petunjuk spesialisasi',
};
const ATR_FILTER = { cek: 'perlu dicek atau dikoreksi', semua: '', koreksi: 'dikoreksi' };
const atrNama = (a) => [a.spes ? spesNama(a.spes) : '', a.jenis ? jenisNama(a.jenis) : '', a.mikro ? 'mikro' : ''].filter(Boolean).join(' · ');
const atrSama = (x, y) => up(x.spes) === up(y.spes) && up(x.jenis) === up(y.jenis) && !!x.mikro === !!y.mikro;
// Dugaan sistem yang masuk akal untuk "Benar, simpan" (bukan yang kosong atau masih LAINNYA).
const atrDugaan = (r) => !r.dikoreksi && (r.sumber === 'peta?' || r.sumber === 'rmp?') && up(r.spes) !== 'LAINNYA' && up(r.jenis) !== 'LAINNYA';
// Nama parameter mengikuti pola set_produk_kelompok. Bila patch 2a memakai nama lain, cukup ubah di sini.
const atrRpcParams = (r, a) => ({
  p_kode: kelKodeKat(r), p_spes: up(a.spes), p_jenis: up(a.jenis), p_mikro: !!a.mikro, p_catatan: String(a.catatan || '').trim() || null,
});

const KEL_TEKS = {
  kat: {
    sub: 'Betulkan kategori produk yang salah tag di sheet. Berlaku di hasil Populasi, Excel, dan teks salinan.',
    cari: 'Cari kode atau nama produk', hanya: 'Hanya yang dikoreksi',
    kosong: 'Tidak ada produk yang cocok.', kosongHanya: 'Belum ada koreksi.',
  },
  atr: {
    sub: 'Betulkan spesialisasi, jenis, dan penanda mikro per kode instrumen satuan. Antrean berisi kode dugaan dan yang masih “Belum dikelompokkan”. Berlaku di filter Populasi, Excel, dan teks salinan.',
    cari: 'Cari kode atau nama produk', hanya: '',
    kosong: 'Tidak ada kode yang cocok.', kosongHanya: 'Tidak ada kode yang cocok.',
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
  KEL_TABS.forEach((k) => {
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
  $('ps-kel-hanya').closest('label').hidden = kelIsAtr();
  const sel = $('ps-kel-kelompok');
  sel.hidden = kel.tab === 'set';
  if (kelIsKat()) {
    sel.setAttribute('aria-label', 'Kategori');
    sel.dataset.sig = '';
    sel.innerHTML = '<option value="">Semua kategori</option>' +
      KAT_TARGET.map((k) => `<option value="${esc(k.id)}">${esc(k.nama)}</option>`).join('');
    sel.value = kel.kelompok;
  } else if (kelIsAtr()) {
    sel.setAttribute('aria-label', 'Spesialisasi');
    kelIsiSpesFilter(true);
  }
  const fl = $('ps-kel-filter');
  fl.hidden = !kelIsAtr();
  fl.value = kel.filter;
  $('ps-kel-thead').innerHTML = kelIsKat()
    ? '<tr><th>Produk</th><th>Kategori</th><th class="ps-kel-num">Pesanan</th><th class="ps-kel-act"><span class="ps-kel-sr">Ubah</span></th></tr>'
    : (kelIsAtr()
      ? '<tr><th>Produk</th><th>Atribut</th><th class="ps-kel-num">Dipakai</th><th class="ps-kel-act"><span class="ps-kel-sr">Ubah</span></th></tr>'
      : '<tr><th>Set</th><th>Dihitung sebagai</th><th class="ps-kel-num">Populasi</th><th class="ps-kel-act"><span class="ps-kel-sr">Ubah</span></th></tr>');
}

// Pilihan spesialisasi untuk filter di tab Atribut produk. Diisi ulang hanya bila daftarnya berubah (fokus tidak hilang).
function kelIsiSpesFilter(paksa) {
  const sel = $('ps-kel-kelompok');
  const opsi = kel.opsiSpes.map(up).filter((s) => s !== 'LAINNYA');
  opsi.push('LAINNYA');
  if (kel.spesF && !opsi.includes(kel.spesF)) opsi.unshift(kel.spesF);
  const sig = opsi.join('|');
  if (!paksa && sel.dataset.sig === sig) { sel.value = kel.spesF; return; }
  sel.dataset.sig = sig;
  sel.innerHTML = '<option value="">Semua spesialisasi</option>' +
    opsi.map((s) => `<option value="${esc(s)}">${esc(spesNama(s))}</option>`).join('');
  sel.value = kel.spesF;
}

function kelRenderLoading() {
  $('ps-kel-body').innerHTML = '<tr><td colspan="4" class="ps-kel-empty" role="status">Memuat…</td></tr>';
}

function kelRenderMeta() {
  const unit = kelIsKat() ? 'produk' : (kelIsAtr() ? 'kode' : 'set');
  const ket = kelIsAtr() && ATR_FILTER[kel.filter] ? ' ' + ATR_FILTER[kel.filter] : '';
  let t = kel.total > kel.list.length
    ? `${fmt(kel.list.length)} dari ${fmt(kel.total)} ${unit}${ket}, urut menurut jumlah RS`
    : `${fmt(kel.total)} ${unit}${ket}`;
  if ((kelIsKat() || kelIsAtr()) && kel.tanpaKode > 0) t += ` · ${fmt(kel.tanpaKode)} baris pesanan tanpa kode tidak bisa dikoreksi`;
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
    <td class="ps-kel-num">${esc(fmt(r.baris))} baris<span class="ps-kel-sub">${esc(fmt(r.qty))} ${satuanList(r.kelompok)} · ${esc(fmt(r.jumlah_rs))} RS</span></td>
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

function atrOpsi(daftar, ...tambah) {
  const s = [];
  daftar.concat(tambah).map(up).forEach((v) => { if (v && v !== 'LAINNYA' && !s.includes(v)) s.push(v); });
  s.push('LAINNYA');
  return s;
}

function kelRowAtr(r, i, open) {
  const ej = r.ejaan || [];
  const ejHtml = (ej.length > 1 || (ej[0] && ej[0] !== r.kode_key))
    ? `<span class="ps-kel-sub">Di sheet: ${ej.slice(0, 3).map((e) => '“' + esc(e) + '”').join(' · ')}${ej.length > 3 ? ' +' + (ej.length - 3) : ''}</span>` : '';
  const nm = r.nama || [];
  let status = '';
  if (r.dikoreksi) {
    status = `<span class="ps-kel-sub" title="${esc(r.oleh ? 'Diubah oleh ' + r.oleh : '')}">Dikoreksi · otomatis: ${esc(atrNama(r.auto || {}))}</span>`;
  } else if (ATR_SUMBER[r.sumber]) {
    status = `<span class="ps-kel-warn" title="Tebakan sistem yang belum dipastikan tim. Buka untuk memastikan atau mengubahnya.">${esc(ATR_SUMBER[r.sumber])}</span>`;
  } else if (r.perlu_cek) {
    status = '<span class="ps-kel-warn" title="Spesialisasi atau jenis produk ini belum masuk kelompok mana pun">Belum dikelompokkan</span>';
  }
  if (r.catatan) status += `<span class="ps-kel-sub">Catatan: ${esc(r.catatan)}</span>`;
  return `<tr class="ps-kel-row${open ? ' is-open' : ''}" data-i="${i}">
    <td><span class="ps-kel-strong">${esc(nm[0] || r.kode_key)}</span><span class="ps-kel-sub"><span class="kode-text">${esc(r.kode_key)}</span></span>${ejHtml}</td>
    <td><span class="ps-kel-strong">${esc(atrNama(r))}</span>${status}</td>
    <td class="ps-kel-num">${esc(fmt(r.jumlah_rs))} RS<span class="ps-kel-sub">${esc(fmt(r.baris))} baris · ${esc(fmt(r.qty))} pcs</span></td>
    <td class="ps-kel-act"><button type="button" class="ps-rowact" data-action="ps-kel-edit" data-i="${i}" aria-expanded="${open}" title="${open ? 'Tutup' : 'Ubah spesialisasi, jenis, dan penanda mikro'}" aria-label="Ubah atribut ${esc(r.kode_key)}">${open ? 'Tutup' : '<i class="ti ti-pencil" aria-hidden="true"></i> Ubah atribut'}</button></td>
  </tr>`;
}

function kelEditorAtr(r) {
  const a = kel.at || {};
  const auto = r.auto || {};
  const opt = (daftar, pilih, nama) => daftar.map((v) => `<option value="${esc(v)}"${v === up(pilih) ? ' selected' : ''}>${esc(nama(v))}</option>`).join('');
  const sp = atrOpsi(kel.opsiSpes, r.spes, auto.spes);
  const jn = atrOpsi(kel.opsiJenis, r.jenis, auto.jenis);
  return `<tr class="ps-kel-edit"><td colspan="4"><div class="ps-kel-form ps-kel-form-wide">
    <div class="ps-kel-fields">
      <div><label class="ps-kel-lbl" for="ps-kel-a-spes">Spesialisasi</label>
        <select id="ps-kel-a-spes" class="field-input">${opt(sp, a.spes, spesNama)}</select></div>
      <div><label class="ps-kel-lbl" for="ps-kel-a-jenis">Jenis instrumen</label>
        <select id="ps-kel-a-jenis" class="field-input">${opt(jn, a.jenis, jenisNama)}</select></div>
      <label class="ps-kel-check ps-kel-mikro"><input type="checkbox" id="ps-kel-a-mikro"${a.mikro ? ' checked' : ''}><span>Instrumen mikrosurgery</span></label>
    </div>
    <div class="ps-kel-catatan">
      <label class="ps-kel-lbl" for="ps-kel-a-catatan">Catatan (opsional)</label>
      <input id="ps-kel-a-catatan" class="field-input" type="text" maxlength="200" autocomplete="off" placeholder="mis. dicek dengan katalog" value="${esc(a.catatan || '')}">
    </div>
    <p class="ps-kel-auto">Hitungan otomatis: ${esc(atrNama(auto) || '—')}</p>
    <p class="ps-kel-impact" id="ps-kel-impact"></p>
    <p class="ps-kel-err" id="ps-kel-err" role="alert" hidden></p>
    <div class="ps-kel-btns">
      ${r.dikoreksi ? '<button type="button" class="btn btn-ghost" data-action="ps-kel-reset">Kembalikan ke otomatis</button>' : ''}
      <span class="ps-kel-grow"></span>
      <button type="button" class="btn btn-ghost" data-action="ps-kel-batal">Batal</button>
      <button type="button" class="btn btn-accent" id="ps-kel-ok" data-action="ps-kel-save" disabled>Simpan</button>
    </div>
  </div></td></tr>`;
}

function kelEditor(r) {
  if (kelIsAtr()) return kelEditorAtr(r);
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
    const polos = !kel.q.trim();
    let msg = kel.hanya && polos ? t.kosongHanya : t.kosong;
    let act = '';
    if (kelIsAtr() && polos && !kel.spesF) {
      if (kel.filter === 'cek') {
        msg = 'Antrean kosong: tidak ada kode yang perlu dicek atau dikoreksi.';
        act = '<br><button type="button" class="btn btn-ghost ps-kel-empty-act" data-action="ps-kel-semua">Lihat semua kode</button>';
      } else if (kel.filter === 'koreksi') {
        msg = 'Belum ada atribut yang dikoreksi.';
      }
    }
    body.innerHTML = `<tr><td colspan="4" class="ps-kel-empty">${esc(msg)}${act}</td></tr>`;
    kelRenderMeta();
    return;
  }
  body.innerHTML = kel.list.map((r, i) => {
    const open = i === kel.edit;
    const baris = kelIsKat() ? kelRowKat(r, i, open) : (kelIsAtr() ? kelRowAtr(r, i, open) : kelRowSet(r, i, open));
    return baris + (open ? kelEditor(r) : '');
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
  let changed = false;
  let teks = '';
  let label = 'Simpan';
  if (kelIsAtr()) {
    const a = kel.at || {};
    const beda = !atrSama(a, r);
    const dugaan = atrDugaan(r);
    const kembali = !!r.dikoreksi && atrSama(a, r.auto || {});     // isian sama dengan hitungan otomatis
    const catatanBeda = !!r.dikoreksi && String(a.catatan || '').trim() !== String(r.catatan || '').trim();
    changed = !kembali && (beda || catatanBeda || dugaan);
    if (kembali) teks = 'Sama dengan hitungan otomatis. Pakai “Kembalikan ke otomatis” untuk melepas koreksi.';
    else if (beda) teks = `Berlaku untuk seluruh baris kode ini (${fmt(r.baris)} baris, ${fmt(r.jumlah_rs)} RS): ${atrNama(a)}.`;
    else if (dugaan) { teks = 'Dugaan sistem ini akan disimpan sebagai atribut tetap dan keluar dari daftar dugaan.'; label = 'Benar, simpan'; }
    else if (catatanBeda) teks = 'Hanya catatan yang berubah.';
  } else {
    const d = kel.draft.trim();
    if (kelIsKat()) {
      const cur = (r.kelompok || []).length === 1 ? r.kelompok[0] : '';
      changed = !!d && d !== cur;
      if (changed) teks = `Seluruh baris produk ini (${fmt(r.baris)} baris, ${fmt(r.qty)} ${satuanKel(d)}, ${fmt(r.jumlah_rs)} RS) akan masuk ke ${katName(d)}.`;
    } else {
      changed = !!d && d.toLowerCase() !== String(r.target || '').toLowerCase();
      if (changed) teks = `${fmt(r.jumlah_set)} set di ${fmt(r.jumlah_rs)} RS akan dihitung sebagai “${d}”. Jumlah set tidak berubah dan isi setnya tidak dibandingkan dengan set tujuan.`;
    }
  }
  ok.disabled = !changed;
  ok.textContent = label;
  imp.textContent = teks;
}

function kelEditOpen(i, fokus) {
  const r = kel.list[i];
  if (!r) return;
  kel.edit = i;
  if (kelIsAtr()) {
    kel.at = { spes: up(r.spes), jenis: up(r.jenis), mikro: !!r.mikro, catatan: r.catatan || '' };
    kel.draft = '';
  } else {
    kel.at = null;
    kel.draft = kelIsKat() ? ((r.kelompok || []).length === 1 ? r.kelompok[0] : '') : (r.target || '');
  }
  kel.saran = [];
  kelRender();
  if (kel.tab === 'set') kelCariSaran(kel.draft);
  if (fokus) setTimeout(() => { const el = $('ps-kel-draft') || $('ps-kel-a-spes'); if (el) el.focus(); }, 0);
}

function kelEditClose() {
  kel.edit = -1;
  kel.draft = '';
  kel.at = null;
  clearTimeout(kelSaranTimer);
  kelRender();
}

// Saran set tujuan: set yang belum dialihkan, kecuali set ini sendiri. Memperbarui datalist tanpa merender ulang (fokus tetap).
async function kelCariSaran(teks) {
  const r = kelRow();
  if (!r || kel.tab !== 'set') return;
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
  const scroll = $('ps-kel-scroll');
  if (scroll) { scroll.classList.add('is-busy'); scroll.setAttribute('aria-busy', 'true'); }
  $('ps-kel-meta').textContent = 'Memuat…';
  try {
    const cari = kel.q.trim() || null;
    let res;
    if (kelIsKat()) {
      res = await rpc('get_produk_kelompok', { p_cari: cari, p_kelompok: kel.kelompok || null, p_hanya_koreksi: !!kel.hanya, p_batas: 200 });
    } else if (kelIsAtr()) {
      res = await rpc('get_produk_atribut', { p_cari: cari, p_spes: kel.spesF || null, p_filter: kel.filter, p_batas: 200 });
    } else {
      res = await rpc('get_set_grup', { p_cari: cari, p_hanya_alih: !!kel.hanya, p_untuk_tujuan: false, p_batas: 200 });
    }
    if (my !== kelReq) return;
    kel.list = (res && res.rows) || [];
    kel.total = num(res && res.total);
    kel.tanpaKode = num(res && res.tanpa_kode);
    if (kelIsAtr()) {
      kel.opsiSpes = (res && res.opsi_spes) || [];
      kel.opsiJenis = (res && res.opsi_jenis) || [];
      kelIsiSpesFilter(false);
    }
    kel.edit = -1;
    kel.draft = '';
    kel.at = null;
    let buka = -1;
    if (kel.match) {
      buka = kel.list.findIndex((r) => ((kelIsKat() || kelIsAtr() ? r.ejaan : r.varian) || []).includes(kel.match));
      kel.match = '';
    }
    kelRender();
    if (buka >= 0) kelEditOpen(buka, true);
  } catch (e) {
    if (my !== kelReq || String(e.message).startsWith('unauthorized')) return;
    const hilang = e.code === 'PGRST202' || e.status === 404;
    kel.list = [];
    $('ps-kel-meta').textContent = '';
    let pesan = 'Gagal memuat: ' + e.message;
    if (hilang) {
      pesan = kelIsKat() ? 'RPC kategori produk belum terpasang. Jalankan 01_tabel_dan_rpc.sql.'
        : (kelIsAtr() ? 'RPC atribut produk belum terpasang. Jalankan patch 3b (get_produk_atribut).'
          : 'RPC alihkan set belum terpasang. Jalankan 07_alihkan_set.sql.');
    }
    $('ps-kel-body').innerHTML = `<tr><td colspan="4" class="ps-kel-empty ps-kel-bad">${esc(pesan)}</td></tr>`;
  } finally {
    if (my === kelReq && scroll) { scroll.classList.remove('is-busy'); scroll.removeAttribute('aria-busy'); }
  }
}

function kelOpen(opts = {}) {
  const ov = $('ps-kel-overlay');
  if (!ov) return;
  kel.opener = document.activeElement;
  kel.tab = opts.tab === 'set' ? 'set' : (opts.tab === 'atr' ? 'atr' : 'kat');
  kel.q = opts.q || '';
  kel.match = (opts.q || '').trim();
  kel.kelompok = '';
  kel.spesF = '';
  kel.hanya = false;
  kel.filter = kel.match ? 'semua' : 'cek';   // dibuka dari satu produk -> jangan tersaring antrean
  kel.edit = -1;
  kel.draft = '';
  kel.at = null;
  kel.list = [];
  kel.total = 0;
  kelRenderChrome();
  kelRenderLoading();
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
  if (snapKotor) segarkanSnapshot();
}

function kelSetTab(tab) {
  if (tab === kel.tab) return;
  kel.tab = tab;
  kel.q = '';
  kel.kelompok = '';
  kel.spesF = '';
  kel.hanya = false;
  kel.filter = 'cek';
  kel.match = '';
  kel.edit = -1;
  kel.draft = '';
  kel.at = null;
  kel.list = [];                // baris tab lama tidak boleh tampil di bawah kolom tab baru
  kel.total = 0;
  kelRenderChrome();
  kelRenderLoading();
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
  if (!reset && !kelIsAtr() && !d) return;
  tombol.forEach((b) => { b.disabled = true; });
  kelError('');
  try {
    let pesan;
    if (kelIsKat()) {
      if (reset) { await rpc('hapus_produk_kelompok', { p_kode: kelKodeKat(r) }); pesan = `${r.kode_key} dikembalikan ke kategori di sheet`; }
      else { await rpc('set_produk_kelompok', { p_kode: kelKodeKat(r), p_kelompok: d, p_catatan: null }); pesan = `${r.kode_key} dipindah ke ${katName(d)}`; }
    } else if (kelIsAtr()) {
      if (reset) { await rpc('hapus_produk_atribut', { p_kode: kelKodeKat(r) }); pesan = `${r.kode_key} dikembalikan ke atribut otomatis`; }
      else { await rpc('set_produk_atribut', atrRpcParams(r, kel.at || {})); pesan = `Atribut ${r.kode_key} disimpan: ${atrNama(kel.at || {})}`; }
    } else if (reset) {
      await rpc('hapus_set_grup', { p_label: r.label }); pesan = `Alihan “${r.label}” dilepas`;
    } else {
      const res = await rpc('set_set_grup', { p_label: r.label, p_target: d, p_catatan: null });
      pesan = `“${r.label}” dihitung sebagai “${(res && res.target_label) || d}”`;
    }
    showToast(pesan);
    await kelLoad();
    snapKotor = true;                     // hasil Populasi diperbarui sekali, saat dialog ditutup (lihat kelClose)
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
    const [rk, rs, ra] = await Promise.all([
      aman(rpc('get_produk_kelompok', { p_cari: null, p_kelompok: null, p_hanya_koreksi: true, p_batas: 500 })),
      aman(rpc('get_set_grup', { p_cari: null, p_hanya_alih: true, p_untuk_tujuan: false, p_batas: 500 })),
      aman(rpc('get_produk_atribut', { p_cari: null, p_spes: null, p_filter: 'koreksi', p_batas: 500 })),
    ]);
    const lk = (rk && rk.rows) || [];
    const ls = (rs && rs.rows) || [];
    const la = (ra && ra.rows) || [];
    if (!lk.length && !ls.length && !la.length) { showToast('Belum ada koreksi atau alihan untuk diunduh', 'error'); return; }
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
        { header: 'Jumlah', key: 'qty', width: 12 }, { header: 'Satuan', key: 'sat', width: 9 }, { header: 'Jumlah RS', key: 'rs', width: 11 },
        { header: 'Diubah oleh', key: 'oleh', width: 28 }, { header: 'Waktu ubah', key: 'pada', width: 20 },
        { header: 'Catatan', key: 'catatan', width: 30 },
      ], lk.map((r) => ({
        kode: r.kode_key, ejaan: (r.ejaan || []).join(' | '), nama: (r.nama || []).join(' | '), asal: katAsal(r),
        ke: katName(r.koreksi_ke), baris: num(r.baris), qty: num(r.qty), sat: satuanKel(r.koreksi_ke), rs: num(r.jumlah_rs),
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
    if (la.length) {
      lembar('Atribut produk', [
        { header: 'Kode produk', key: 'kode', width: 24 }, { header: 'Ejaan kode di sheet', key: 'ejaan', width: 34 },
        { header: 'Nama produk', key: 'nama', width: 48 }, { header: 'Hitungan otomatis', key: 'auto', width: 38 },
        { header: 'Dikoreksi menjadi', key: 'ke', width: 38 }, { header: 'Baris pesanan', key: 'baris', width: 14 },
        { header: 'Jumlah (pcs)', key: 'qty', width: 14 }, { header: 'Jumlah RS', key: 'rs', width: 11 },
        { header: 'Diubah oleh', key: 'oleh', width: 28 }, { header: 'Waktu ubah', key: 'pada', width: 20 },
        { header: 'Catatan', key: 'catatan', width: 30 },
      ], la.map((r) => ({
        kode: r.kode_key, ejaan: (r.ejaan || []).join(' | '), nama: (r.nama || []).join(' | '),
        auto: atrNama(r.auto || {}), ke: atrNama(r), baris: num(r.baris), qty: num(r.qty), rs: num(r.jumlah_rs),
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
  if (state.pic) sub += `, PIC order ${state.pic}`;
  if (state.distributor) sub += `, distributor ${distributorNama(state.distributor)}`;
  if (state.produk.trim()) sub += `, produk “${state.produk.trim()}”${state.isiSet ? ' (termasuk isi set)' : ''}`;
  if (state.dari || state.sampai) sub += `, ${periodeText()}`;
  sub += `, data per ${fmtDate(data.data_per)}`;
  lines.push(sub, '');
  rows.forEach((r, i) => {
    const jml = [r.set ? `${fmt(r.set)} set` : '', r.pcs ? `${fmt(r.pcs)} pcs` : '', r.unit ? `${fmt(r.unit)} unit` : ''].filter(Boolean).join(' + ');
    const rinci = rincianText(r);
    lines.push(`${i + 1}. ${r.customer}${r.kab_kota ? ` (${r.kab_kota})` : ''}${state.provinsi ? '' : ` [${r.provinsi || 'wilayah belum diketahui'}]`} — ${jml}${rinci ? ` (${rinci})` : ''}`);
  });
  const tot = [num(s.set_total) ? `${fmt(s.set_total)} set${num(s.set_estimasi) > 0 ? ` (${fmt(s.set_estimasi)} di antaranya estimasi)` : ''}` : '', num(s.pcs_total) ? `${fmt(s.pcs_total)} pcs` : '', num(s.unit_total) ? `${fmt(s.unit_total)} unit` : ''].filter(Boolean).join(' + ');
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
// Pembangun file ada di export.js (modul murni: ExcelJS + foto data + pilihan pembaca -> xlsx).
// Di sini hanya: dialog pilihan (tujuan, sheet, kolom, keterangan), foto data, dan unduhan.
// "Unduh Excel" membuka dialog; pilihan terakhir diingat (preset, kolom kustom, nama penyusun).
const LS_XL = 'pnm_populasi_xl';
const xlDlg = { sel: null, info: null, cat: [], opener: null, busy: false, keyHandler: null };

function xlHelpers() {
  return {
    katName, spesNama, jenisNama, kategoriText, periodeText, fmtDate, fmt, toDate, localISODate,
    urutKategori: KELOMPOK.map((k) => k.id),
  };
}

function xlPrefs() {
  try { return JSON.parse(lsGet(LS_XL) || 'null') || {}; } catch (e) { return {}; }
}
function xlSavePrefs() {
  const sel = xlDlg.sel;
  if (!sel) return;
  const old = xlPrefs();
  lsSet(LS_XL, JSON.stringify({
    preset: sel.preset,
    oleh: sel.oleh || '',
    kustom: sel.preset === 'kustom' ? { sheets: sel.sheets, cols: sel.cols } : (old.kustom || null),
  }));
}

// Pilihan untuk satu preset pada filter aktif. 'kustom' memulihkan simpanan terakhir (disaring ke yang masih relevan).
function xlSelFor(preset, pf) {
  const sel = xlDefaultSel(preset, xlDlg.info);
  if (preset === 'kustom' && pf && pf.kustom) {
    const ada = new Map(xlDlg.cat.map((s) => [s.id, s]));
    sel.sheets = (pf.kustom.sheets || []).filter((id) => ada.has(id) && !ada.get(id).lock);
    Object.keys(sel.cols).forEach((sid) => {
      const valid = new Set(((ada.get(sid) || {}).cols || []).map((c) => c.id));
      if (Array.isArray((pf.kustom.cols || {})[sid])) sel.cols[sid] = pf.kustom.cols[sid].filter((id) => valid.has(id));
    });
  }
  return sel;
}

function xlOpen(opener) {
  if (!data || !rows.length) { showToast('Belum ada data untuk diunduh', 'error'); return; }
  const ov = $('ps-xl-overlay');
  if (!ov) return;
  xlDlg.opener = opener || null;
  xlDlg.info = xlInfo({ data, unmapped, st: state, lines: null });
  xlDlg.cat = xlCatalog(xlDlg.info);
  const pf = xlPrefs();
  const preset = XL_PRESETS.some((p) => p.id === pf.preset) ? pf.preset : 'sph';
  xlDlg.sel = xlSelFor(preset, pf);
  xlDlg.sel.oleh = pf.oleh || '';
  $('ps-xl-untuk').value = '';
  $('ps-xl-oleh').value = xlDlg.sel.oleh;
  $('ps-xl-catatan').value = '';
  $('ps-xl-tanpacek').checked = false;
  $('ps-xl-cek-wrap').hidden = !(num((data.ringkasan || {}).set_cek) > 0);
  xlRender();
  ov.classList.add('open');
  xlDlg.keyHandler = (e) => { if (e.key === 'Escape') { e.stopPropagation(); xlClose(); } };
  ov.addEventListener('keydown', xlDlg.keyHandler);
  setTimeout(() => { const f = ov.querySelector('input[name="ps-xl-preset"]:checked') || $('ps-xl-go'); if (f) f.focus(); }, 30);
}

function xlClose() {
  const ov = $('ps-xl-overlay');
  if (!ov || xlDlg.busy) return;
  ov.classList.remove('open');
  if (xlDlg.keyHandler) { ov.removeEventListener('keydown', xlDlg.keyHandler); xlDlg.keyHandler = null; }
  const o = xlDlg.opener;
  xlDlg.opener = null;
  if (o && o.isConnected && o.focus) o.focus();
}

function xlRender() {
  const sel = xlDlg.sel;
  const ov = $('ps-xl-overlay');
  if (!sel || !ov) return;
  // Ingat detail kolom yang terbuka dan elemen yang sedang fokus, karena isi dirender ulang.
  const terbuka = new Set(Array.from(ov.querySelectorAll('details.ps-xl-cols[open]')).map((d) => d.dataset.sheet));
  const a = document.activeElement;
  const fokus = a && ov.contains(a) && a.dataset && a.dataset.xl ? { xl: a.dataset.xl, sheet: a.dataset.sheet || '', v: a.dataset.v || a.value } : null;

  $('ps-xl-sub').textContent = `${kategoriText()} · ${state.provinsi || 'Semua provinsi'} · ${fmt(rows.length)} RS. Isi file mengikuti filter yang sedang aktif.`;
  $('ps-xl-presets').innerHTML = XL_PRESETS.map((p) => {
    const on = sel.preset === p.id;
    return `<label class="ps-xl-preset${on ? ' on' : ''}"><input type="radio" name="ps-xl-preset" value="${esc(p.id)}" data-xl="preset"${on ? ' checked' : ''}>` +
      `<span class="ps-xl-pn">${esc(p.nama)}</span><span class="ps-xl-pd">${esc(p.desc)}</span></label>`;
  }).join('');

  let internal = false;
  $('ps-xl-sheets').innerHTML = xlDlg.cat.map((sh) => {
    const on = sh.lock || sel.sheets.includes(sh.id);
    let cols = '';
    if (sh.cols && on) {
      const dipilih = new Set(sel.cols[sh.id] || []);
      const grups = Array.from(new Set(sh.cols.map((c) => c.grp)));
      const jml = sh.cols.filter((c) => c.req || dipilih.has(c.id)).length;
      if (sh.cols.some((c) => XL_GRUP_INTERNAL.includes(c.grp) && dipilih.has(c.id))) internal = true;
      cols = `<details class="ps-xl-cols" data-sheet="${esc(sh.id)}"${terbuka.has(sh.id) ? ' open' : ''}><summary>Pilih kolom <span class="ps-hint">${jml} dari ${sh.cols.length}</span></summary><div class="ps-xl-colgrid">` +
        grups.map((g) => `<div class="ps-xl-grp"><div class="ps-xl-gh">${esc(XL_GRUP[g] || g)}</div>` +
          sh.cols.filter((c) => c.grp === g).map((c) =>
            `<label class="ps-check"><input type="checkbox" data-xl="col" data-sheet="${esc(sh.id)}" data-v="${esc(c.id)}"${c.req || dipilih.has(c.id) ? ' checked' : ''}${c.req ? ' disabled' : ''}><span>${esc(c.h)}</span></label>`).join('') +
          '</div>').join('') + '</div></details>';
    }
    return `<div class="ps-xl-row"><label class="ps-xl-sheet"><input type="checkbox" data-xl="sheet" data-v="${esc(sh.id)}"${on ? ' checked' : ''}${sh.lock ? ' disabled' : ''}>` +
      `<span class="ps-xl-sn">${esc(sh.nama)}</span><span class="ps-xl-sd">${esc(sh.desc)}</span></label>${cols}</div>`;
  }).join('');

  const warn = $('ps-xl-warn');
  warn.hidden = !internal;
  warn.textContent = internal ? 'Berisi kolom internal (No. PO, No. RMP, atau data teknis). Jangan dikirim ke pihak luar.' : '';

  if (fokus) {
    const sel2 = fokus.xl === 'preset' ? `[data-xl="preset"][value="${fokus.v}"]` : `[data-xl="${fokus.xl}"]${fokus.sheet ? `[data-sheet="${fokus.sheet}"]` : ''}[data-v="${fokus.v}"]`;
    const el = ov.querySelector(sel2);
    if (el && !el.disabled) el.focus();
  }
}

function xlChange(t) {
  const sel = xlDlg.sel;
  if (!sel) return;
  const kind = t.dataset.xl;
  if (kind === 'preset') {
    if (t.value === 'kustom') sel.preset = 'kustom';     // mulai dari yang sedang tercentang
    else {
      const baru = xlSelFor(t.value, null);
      Object.assign(baru, { untuk: sel.untuk, oleh: sel.oleh, catatan: sel.catatan, tanpaCek: sel.tanpaCek });
      xlDlg.sel = baru;
    }
  } else if (kind === 'sheet') {
    const i = sel.sheets.indexOf(t.dataset.v);
    if (t.checked && i < 0) sel.sheets.push(t.dataset.v);
    if (!t.checked && i >= 0) sel.sheets.splice(i, 1);
    sel.preset = 'kustom';
  } else if (kind === 'col') {
    const arr = sel.cols[t.dataset.sheet] || (sel.cols[t.dataset.sheet] = []);
    const i = arr.indexOf(t.dataset.v);
    if (t.checked && i < 0) arr.push(t.dataset.v);
    if (!t.checked && i >= 0) arr.splice(i, 1);
    sel.preset = 'kustom';
  }
  xlRender();
}

function xlSetBusy(busy) {
  xlDlg.busy = busy;
  const go = $('ps-xl-go');
  if (go) {
    go.disabled = busy;
    const ic = go.querySelector('i');
    if (ic) ic.className = busy ? 'ti ti-loader-2 spinner' : 'ti ti-file-spreadsheet';
    const lb = go.querySelector('span');
    if (lb) lb.textContent = busy ? 'Menyiapkan…' : 'Unduh Excel';
  }
  const btn = document.querySelector('[data-action="ps-xlsx"]');
  if (btn) btn.disabled = busy || !rows.length;
}

// Nama file yang langsung jelas isinya saat dikirim ke orang lain, mis.
// "Populasi Set instrumen - Jawa Tengah - 2026-11-06.xlsx". Versi internal diberi tanda supaya tidak terkirim tanpa sengaja.
function bersihNama(s) {
  return String(s).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function namaFile(presetId) {
  let kat = state.produk.trim() ? `Produk ${state.produk.trim()}` : kategoriText();
  if (state.kelompok.length > 3) kat = 'Beberapa kategori';
  kat = bersihNama(kat).slice(0, 60);
  const suf = presetId === 'internal' ? ' - INTERNAL' : '';
  const sl = (state.distributor ? ` - ${distributorNama(state.distributor)}` : '') + (state.pic ? ` - PIC ${bersihNama(state.pic).slice(0, 30)}` : '');
  return `Populasi ${kat} - ${bersihNama(state.provinsi || 'Semua provinsi')}${sl} - ${localISODate()}${suf}.xlsx`;
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

async function downloadXlsx() {
  if (xlDlg.busy || !xlDlg.sel || !data || !rows.length) return;
  const sel = JSON.parse(JSON.stringify(xlDlg.sel));
  sel.untuk = $('ps-xl-untuk').value;
  sel.oleh = $('ps-xl-oleh').value;
  sel.catatan = $('ps-xl-catatan').value;
  sel.tanpaCek = $('ps-xl-tanpacek').checked && !$('ps-xl-cek-wrap').hidden;
  xlDlg.sel.oleh = sel.oleh;
  xlSavePrefs();
  // Foto kondisi saat tombol ditekan; filter boleh berubah selagi file dibuat.
  const snap = {
    rows: rows.slice(),
    data,
    unmapped: unmapped.slice(),
    st: Object.assign({}, state, { kelompok: state.kelompok.slice(), spes: state.spes.slice(), jenis: state.jenis.slice() }),
    h: xlHelpers(),
  };
  const params = filterParams();
  const name = namaFile(sel.preset);
  xlSetBusy(true);
  try {
    await loadScript(EXCELJS_SRC);
    if (!window.ExcelJS) throw new Error('library Excel tidak termuat');
    const baris = await rpc('get_populasi_v2_baris', params, EXPORT_TIMEOUT_MS);
    const dipilih = new Set(snap.rows.map((x) => x.customer));
    const lines = (baris || []).filter((b) => dipilih.has(b.customer));
    const buf = await buildWorkbook(window.ExcelJS, Object.assign({ lines }, snap), sel);
    saveBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name);
    showToast(`${name} diunduh`);
    xlSetBusy(false);
    xlClose();
  } catch (e) {
    if (String(e.message).startsWith('unauthorized')) return;
    showToast('Gagal membuat Excel: ' + e.message, 'error');
  } finally {
    if (xlDlg.busy) xlSetBusy(false);
  }
}

// ── kontrol ──────────────────────────────────────────────────────────────────
// Dua mode, satu halaman. Panel Populasi hanya disembunyikan (state dan hasilnya tetap), Progress order memuat ulang tiap dibuka.
function setMode(m) {
  const next = m === 'progress' ? 'progress' : 'populasi';
  if (next === state.mode && ($('pg-root').hidden === (next === 'populasi'))) return;
  state.mode = next;
  lsSet(LS_MODE, next);
  clearError();
  document.querySelectorAll('[data-action="ps-mode"]').forEach((b) => {
    const on = b.dataset.v === next;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  $('ps-pop-root').hidden = next !== 'populasi';
  if (next === 'progress') {
    if (progress) progress.show();
    return;
  }
  if (progress) progress.hide();
  if (data) renderFreshness(); else load();
}

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
  const ssl = $('ps-pic');
  if (ssl) ssl.value = state.pic;
  const sdist = $('ps-distributor');
  if (sdist) sdist.value = state.distributor;
  syncCari(true);
  $('ps-isi-set').checked = state.isiSet;
  $('ps-isi-wrap').hidden = !state.produk.trim();
  $('ps-dari').value = state.dari;
  $('ps-sampai').value = state.sampai;
  $('ps-cakupan').value = state.cakupan;
  syncStatusButtons();
  renderCats();
  renderAtribut();
  syncUrut();
}

// Satu kotak cari, tiga cakupan (produk, rs, rmp). Isi tiap cakupan disimpan di state-nya sendiri (produk / rs);
// kotak hanya menampilkan yang sedang dipilih. Titik pada tombol = cakupan lain masih punya isi.
// Pencarian BARU dijalankan saat Enter (atau saat kotak dikosongkan lewat tombol x). Ketikan hanya mengisi
// draft; state (yang dipakai filterParams) tidak berubah sebelum Enter, jadi tidak ada panggilan ke database per ketikan.
const CARI = {
  produk: { ph: 'mis. drill, centrifuge, obgyn, tubectomy · tekan Enter', aria: 'Cari nama set atau produk, tekan Enter untuk mencari' },
  rs: { ph: 'mis. soetrasno · tekan Enter', aria: 'Cari rumah sakit, tekan Enter untuk mencari' },
  rmp: { ph: 'mis. 25-054 (beberapa nomor: pisahkan koma) · tekan Enter', aria: 'Cari No. RMP, tekan Enter untuk mencari' },
};
const scopeOf = (v) => (v === 'rs' || v === 'rmp' ? v : 'produk');
const cariDraft = { produk: '', rs: '', rmp: '' };
function resetCariDraft() { cariDraft.produk = state.produk; cariDraft.rs = state.rs; cariDraft.rmp = state.rmp; }
function syncCari(dariState) {
  const input = $('ps-cari');
  if (!input) return;
  if (dariState) resetCariDraft();      // state diubah dari luar (lepas filter, dst): draft ikut
  const sc = scopeOf(state.cari);
  if (input.value !== cariDraft[sc]) input.value = cariDraft[sc];
  input.placeholder = CARI[sc].ph;
  input.setAttribute('aria-label', CARI[sc].aria);
  document.querySelectorAll('[data-action="ps-cari-scope"]').forEach((b) => {
    const on = b.dataset.v === sc;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
    b.classList.toggle('has', !on && !!state[b.dataset.v].trim());
  });
}
// Terapkan isi kotak cari ke filter lalu muat data. Enter berulang pada isi yang sama = coba lagi.
function commitCari() {
  const sc = scopeOf(state.cari);
  const v = cariDraft[sc];
  state[sc] = v;
  if (sc === 'produk') $('ps-isi-wrap').hidden = !v.trim();
  syncCari();
  clearTimeout(searchTimer);
  if (sc === 'rmp') terapkanRmp(); else load();
}

// Dropdown Urutkan mengikuti state.sort (header kolom tetap bisa diklik juga).
function syncUrut() {
  const s = $('ps-urut');
  if (!s) return;
  const k = state.sort.k;
  s.value = (k === 'terakhir' || k === 'customer') ? k : 'total';
}

// Periode cepat: bulan kalender penuh, tanggal LOKAL (bukan UTC).
function periodeBulan(offset) {
  const n = new Date();
  return {
    dari: localISODate(new Date(n.getFullYear(), n.getMonth() + offset, 1)),
    sampai: localISODate(new Date(n.getFullYear(), n.getMonth() + offset + 1, 0)),
  };
}

function clearFilter(k) {
  if (k === 'rmp') {                 // hanya mengubah tampilan; data server tidak perlu dimuat ulang
    state.rmp = '';
    syncCari(true);
    renderActive();
    if (data) renderTable();
    return;
  }
  if (k === 'semua') {
    state.produk = ''; state.pic = ''; state.distributor = ''; state.spes = []; state.jenis = []; state.mikro = false; state.isiSet = false; state.rs = ''; state.rmp = '';
    state.dari = ''; state.sampai = ''; state.cakupan = 'POPULASI';
  }
  else if (k === 'produk') { state.produk = ''; state.isiSet = false; }
  else if (k === 'pic') state.pic = '';
  else if (k === 'distributor') state.distributor = '';
  else if (k === 'atribut') { state.spes = []; state.jenis = []; state.mikro = false; }
  else if (k === 'spes') state.spes = [];
  else if (k === 'jenis') state.jenis = [];
  else if (k === 'mikro') state.mikro = false;
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

  // Tiap halaman dibuka: semua provinsi dan semua kategori (tidak ada filter bawaan).
  Object.assign(state, {
    provinsi: DEFAULT_PROV,
    status: 'DELIVERED', cakupan: 'POPULASI', kelompok: [],
    cari: 'produk', produk: '', pic: '', distributor: '', spes: [], jenis: [], mikro: false, rs: '', rmp: '', isiSet: false, dari: '', sampai: '',
    sort: { k: 'total', dir: 'desc' }, tinjau: '', mode: 'populasi',
  });
  resetCariDraft();
  v3ok = null;
  data = null; rows = []; unmapped = [];
  picOpsi.clear();
  progress = createProgress({
    $, rpc, esc, fmt, fmtDate, toDate, num, showToast, showError, clearError, localISODate, periodeBulan, saveBlob, bersihNama,
    ensureExcel: async () => {
      await loadScript(EXCELJS_SRC);
      if (!window.ExcelJS) throw new Error('library Excel tidak termuat');
      return window.ExcelJS;
    },
  });
  detailCache.clear();
  linesAll = null; recon = {};
  Object.assign(kel, {
    tab: 'kat', q: '', kelompok: '', hanya: false, filter: 'cek', spesF: '', list: [], total: 0, tanpaKode: 0, edit: -1, draft: '',
    at: null, opsiSpes: [], opsiJenis: [], saran: [], match: '', opener: null,
  });

  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const ACTIONS = {
    'ps-reload': () => load(),
    'ps-mode': (el) => setMode(el.dataset.v),
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
    'ps-spes': (el) => toggleAtribut('spes', el.dataset.k || ''),
    'ps-jenis': (el) => toggleAtribut('jenis', el.dataset.k || ''),
    'ps-status': (el) => { state.status = el.dataset.v === 'ALL' ? 'ALL' : 'DELIVERED'; syncStatusButtons(); load(); },
    'ps-sort': (el) => {
      const k = el.dataset.k;
      if (state.sort.k === k) state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
      else state.sort = { k, dir: (k === 'customer' || k === 'wilayah') ? 'asc' : 'desc' };
      syncUrut();
      if (data) { state.page = 1; applySort(); renderTable(); }
    },
    'ps-toggle': (el) => toggleDetail(+el.dataset.idx),
    'ps-page': (el) => goPage(el.dataset.p),
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
    'ps-periode': (el) => {
      const p = periodeBulan(el.dataset.v === 'bulan-lalu' ? -1 : 0);
      state.dari = p.dari; state.sampai = p.sampai;
      syncControls();
      load();
    },
    'ps-cari-scope': (el) => {
      state.cari = scopeOf(el.dataset.v);
      syncCari();
      $('ps-cari').focus();               // hasil tidak berubah; hanya isi kotak yang berganti
    },
    'ps-isi-on': () => { state.isiSet = true; syncControls(); load(); },
    'ps-prov-all': () => { state.provinsi = ''; lsSet(LS_PROV, ''); syncControls(); load(); },
    'ps-rmp-lebar': () => {          // dari hasil RMP kosong: longgarkan semua filter selain pencarian RMP
      Object.assign(state, { kelompok: [], provinsi: '', status: 'ALL', produk: '', pic: '', distributor: '', rs: '', isiSet: false, spes: [], jenis: [], mikro: false, dari: '', sampai: '' });
      lsSet(LS_PROV, '');
      syncControls();
      load();
    },
    'ps-copy': () => copyText(),
    'ps-xlsx': (el) => xlOpen(el),
    'ps-xl-close': () => xlClose(),
    'ps-xl-go': () => downloadXlsx(),
    'ps-kel-open': () => kelOpen(),
    'ps-kel-close': () => kelClose(),
    'ps-kel-tab': (el) => kelSetTab(el.dataset.tab),
    'ps-kel-edit-row': (el) => kelOpen({ tab: el.dataset.tab, q: el.dataset.q || '' }),
    'ps-kel-edit': (el) => { const i = +el.dataset.i; if (i === kel.edit) kelEditClose(); else kelEditOpen(i, true); },
    'ps-kel-batal': () => kelEditClose(),
    'ps-kel-save': () => kelSimpan(false),
    'ps-kel-reset': () => kelSimpan(true),
    'ps-kel-unduh': (el) => kelUnduh(el),
    'ps-kel-semua': () => { kel.filter = 'semua'; const f = $('ps-kel-filter'); if (f) f.value = 'semua'; kelLoad(); },
  };
  const CHANGE_BY_ID = {
    'ps-provinsi': (t) => { state.provinsi = t.value; lsSet(LS_PROV, t.value); load(); },
    'ps-page-size': (t) => {
      const n = Number(t.value);
      state.pageSize = PAGE_SIZES.includes(n) ? n : 50;
      lsSet(LS_PAGE, String(state.pageSize));
      state.page = 1;
      renderTable();
    },
    'ps-pic': (t) => { state.pic = t.value; load(); },
    'ps-distributor': (t) => { state.distributor = (t.value === 'SAMAYA' || t.value === 'NON_SAMAYA') ? t.value : ''; load(); },
    'ps-cakupan': (t) => { state.cakupan = t.value === 'SEMUA' ? 'SEMUA' : 'POPULASI'; load(); },
    'ps-dari': (t) => { state.dari = t.value; load(); },
    'ps-sampai': (t) => { state.sampai = t.value; load(); },
    'ps-isi-set': (t) => { state.isiSet = t.checked; load(); },
    'ps-mikro': (t) => { state.mikro = t.checked; load(); },
    'ps-urut': (t) => {
      const k = t.value;
      state.sort = { k, dir: k === 'customer' ? 'asc' : 'desc' };
      if (data) { state.page = 1; applySort(); renderTable(); }
    },
    'ps-kel-kelompok': (t) => { if (kelIsAtr()) kel.spesF = t.value; else kel.kelompok = t.value; kelLoad(); },
    'ps-kel-filter': (t) => { kel.filter = (t.value === 'semua' || t.value === 'koreksi') ? t.value : 'cek'; kelLoad(); },
    'ps-kel-a-spes': (t) => { if (kel.at) { kel.at.spes = t.value; kelEditSync(); } },
    'ps-kel-a-jenis': (t) => { if (kel.at) { kel.at.jenis = t.value; kelEditSync(); } },
    'ps-kel-a-mikro': (t) => { if (kel.at) { kel.at.mikro = t.checked; kelEditSync(); } },
    'ps-kel-hanya': (t) => { kel.hanya = t.checked; kelLoad(); },
    'ps-kel-draft': (t) => { kel.draft = t.value; kelEditSync(); },
  };

  function onClick(e) {
    if (e.target.id === 'ps-kel-overlay') { kelClose(); return; }   // klik di luar kartu = tutup
    if (e.target.id === 'ps-xl-overlay') { xlClose(); return; }
    const el = e.target.closest('[data-action]');
    if (!el || !container.contains(el)) return;
    if (hasOwn(ACTIONS, el.dataset.action)) ACTIONS[el.dataset.action](el, e);
    else if (progress && el.dataset.action.startsWith('pg-')) progress.onClick(el);
  }
  function onChange(e) {
    const t = e.target;
    if (t.dataset && t.dataset.xl) { xlChange(t); return; }
    if (progress && t.id && t.id.startsWith('pg-')) { progress.onChange(t); return; }
    if (hasOwn(CHANGE_BY_ID, t.id)) CHANGE_BY_ID[t.id](t);
  }
  function onInput(e) {
    const id = e.target.id;
    if (id === 'pg-cari') { if (progress) progress.onInput(e.target); return; }
    if (id === 'ps-xl-untuk' || id === 'ps-xl-oleh' || id === 'ps-xl-catatan') {
      const k = { 'ps-xl-untuk': 'untuk', 'ps-xl-oleh': 'oleh', 'ps-xl-catatan': 'catatan' }[id];
      if (xlDlg.sel) xlDlg.sel[k] = e.target.value;
      return;
    }
    if (id === 'ps-kel-q') {
      kel.q = e.target.value;
      clearTimeout(kelTimer);
      kelTimer = setTimeout(() => kelLoad(), 300);
      return;
    }
    if (id === 'ps-kel-a-catatan') {
      if (kel.at) { kel.at.catatan = e.target.value; kelEditSync(); }
      return;
    }
    if (id === 'ps-kel-draft' && kel.tab === 'set') {
      kel.draft = e.target.value;
      kelEditSync();
      clearTimeout(kelSaranTimer);
      kelSaranTimer = setTimeout(() => kelCariSaran(kel.draft), 250);
      return;
    }
    if (id !== 'ps-cari') return;
    // Hanya simpan draft. Pencarian dijalankan oleh Enter (onKeyDown) atau tombol x (onSearch).
    cariDraft[scopeOf(state.cari)] = e.target.value;
  }
  function onKeyDown(e) {
    if (e.target.id !== 'ps-cari' || e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    commitCari();
  }
  // Tombol x bawaan input type=search: mengosongkan kotak = lepas pencarian, langsung diterapkan.
  function onSearch(e) {
    if (e.target.id !== 'ps-cari' || e.target.value !== '') return;
    const sc = scopeOf(state.cari);
    if (state[sc] === '') return;
    cariDraft[sc] = '';
    commitCari();
  }
  handlers = { click: onClick, change: onChange, input: onInput, keydown: onKeyDown, search: onSearch };
  Object.entries(handlers).forEach(([type, fn]) => container.addEventListener(type, fn));

  // nilai awal kontrol (setelah markup terpasang)
  $('ps-provinsi').innerHTML = `<option value="">Semua provinsi</option>` +
    (state.provinsi ? `<option value="${esc(state.provinsi)}">${esc(state.provinsi)}</option>` : '');
  syncControls();
  renderHead({ set: true, pcs: false, unit: false, n: 6 });

  // dipanggil paling akhir, setelah semua let/const modul terinisialisasi (hindari TDZ)
  load();
  if (lsGet(LS_MODE) === 'progress') setMode('progress');     // mode terakhir dipakai; data Populasi tetap dimuat di belakang
}

export function unmount() {
  if (handlers && mountedContainer) {
    Object.entries(handlers).forEach(([type, fn]) => mountedContainer.removeEventListener(type, fn));
  }
  handlers = null;
  if (progress) progress.destroy();
  progress = null;
  clearTimeout(searchTimer);
  searchTimer = null;
  clearTimeout(kelTimer);
  clearTimeout(kelSaranTimer);
  kelTimer = null;
  kelSaranTimer = null;
  kelKeyHandler = null;         // overlay ikut hilang bersama markup
  xlDlg.keyHandler = null; xlDlg.sel = null; xlDlg.busy = false; xlDlg.opener = null;
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
  state.mode = 'populasi';
  snapKotor = false;
}