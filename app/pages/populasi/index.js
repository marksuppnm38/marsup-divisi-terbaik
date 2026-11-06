// app/pages/populasi/index.js -- mount(container) / unmount().
// Halaman "Populasi Set per RS": menjawab "set instrumen apa, di RS mana saja, di provinsi X".
//
// DATA: 3 RPC saja (bukan ~17 seperti Dashboard Produk):
//   get_populasi_set_rs         -> seluruh halaman dalam SATU panggilan (daftar RS, ringkasan,
//                                  opsi provinsi, RS yang wilayahnya belum terpetakan, data_per)
//   get_populasi_set_rs_detail  -> rincian PO/RMP satu RS (saat baris dibuka)
//   set_rs_wilayah              -> simpan koreksi wilayah satu RS
// Definisinya ada di populasi_set_rs.sql. Pola mount/unmount/auth/rpc() sama dengan
// dashboard/index.js (PNMAuth, token diambil fresh tiap request, delegasi event di container).
//
// Semua nilai dari DB yang masuk ke innerHTML WAJIB lewat esc() -- data orderan datang dari
// sheet yang bisa diedit banyak orang, bukan input tepercaya.

import { POPULASI_MARKUP } from './markup.js';

const VENDOR_CHAIN = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  '/shared/supabase-client.js',
  '/shared/auth-session.js',
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
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB0a2tic2VtaWhjeW5kaXNqb29yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0Njc4MzgsImV4cCI6MjA5ODA0MzgzOH0.QsCqmcqQcXvz1f8bLkagvMbAGUBbBP-3Wa5Aore5OMo';
const LS_PROV = 'pnm_populasi_set_provinsi';
const DEFAULT_PROV = 'Jawa Tengah';
const STALE_DAYS = 7;     // lewat ini, tampilkan peringatan "data di DB tertinggal"

let mountedContainer = null;
let handlers = null;
let searchTimer = null;
let reqId = 0;

const state = { provinsi: DEFAULT_PROV, status: 'DELIVERED', cakupan: 'POPULASI', tipe: 'SET', dari: '', sampai: '', search: '' };

// Teks per tipe produk. Nilai 'jumlah_set' dari RPC = jumlah set (SET) atau total qty (INSTRUMENT/UNIT).
const TIPE = {
  SET:        { satuan: 'set',   judul: 'Populasi set instrumen',   kolom: 'Set',        jenis: 'Jenis set',       pesanan: 'pesanan set',   cari: 'RS / jenis set' },
  INSTRUMENT: { satuan: 'pcs',   judul: 'Populasi instrumen satuan', kolom: 'Qty',        jenis: 'Kategori (family)', pesanan: 'pesanan satuan', cari: 'RS / kategori' },
  UNIT:       { satuan: 'unit',  judul: 'Populasi unit',            kolom: 'Unit',       jenis: 'Jenis unit',      pesanan: 'pesanan unit',  cari: 'RS / jenis unit' },
};
const T = () => TIPE[state.tipe] || TIPE.SET;
let data = null;                    // respons get_populasi_set_rs terakhir
let rows = [];                      // data.rows
let unmapped = [];                  // data.belum_terpetakan
const detailCache = new Map();      // kunci -> daftar pesanan satu RS (dibersihkan tiap load)

// ── util ────────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
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
// CSV: quote sel yang butuh, netralkan formula injection (=,+,-,@) untuk Excel.
function csvCell(v) {
  if (v === null || v === undefined) return '';
  let t = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(t)) t = "'" + t;
  return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
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
  setTimeout(() => { t.classList.add('fade-out'); setTimeout(() => t.remove(), 250); }, 2200);
}
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* abaikan */ } }

// Token diambil FRESH tiap request (bukan variabel lokal yang bisa basi) -- sama dgn dashboard.
async function rpc(fn, params) {
  const accessToken = await window.PNMAuth.getAccessToken();
  if (!accessToken) {
    window.PNMAuth.logout();
    throw new Error('unauthorized: no access token');
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), RPC_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + accessToken },
      body: JSON.stringify(params || {}),
      signal: ctrl.signal,
    });
  } catch (err) {
    throw new Error(err.name === 'AbortError' ? `RPC ${fn} timeout (>${RPC_TIMEOUT_MS / 1000}s)` : err.message);
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
    p_tipe: state.tipe,
    p_dari: state.dari || null,
    p_sampai: state.sampai || null,
    p_search: state.search.trim() || null,
  };
}

// ── muat data ───────────────────────────────────────────────────────────────
async function load() {
  const my = ++reqId;
  $('ps-table').classList.add('ps-busy');
  clearError();
  try {
    const res = await rpc('get_populasi_set_rs', filterParams());
    if (my !== reqId) return;           // respons telat tidak boleh menimpa yang lebih baru
    data = res || {};
    rows = data.rows || [];
    unmapped = data.belum_terpetakan || [];
    detailCache.clear();
    render();
  } catch (e) {
    if (my !== reqId || String(e.message).startsWith('unauthorized')) return;
    const missing = e.code === 'PGRST202' || e.status === 404;
    const msg = missing
      ? 'RPC get_populasi_set_rs belum terpasang. Jalankan populasi_set_rs.sql di Supabase SQL Editor.'
      : 'Gagal memuat data: ' + e.message;
    showError(msg);
    if (!data) $('ps-body').innerHTML = `<tr><td colspan="6" class="ps-empty ps-empty-err">${esc(msg)}</td></tr>`;
  } finally {
    if (my === reqId) $('ps-table').classList.remove('ps-busy');
  }
}

// ── render ──────────────────────────────────────────────────────────────────
function render() {
  renderProvinsi();
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
  const lokasi = state.provinsi || 'semua provinsi';
  $('ps-sum-main').innerHTML =
    `<span class="ps-big">${fmt(s.jumlah_set)}</span> ${T().satuan} di <span class="ps-big">${fmt(s.jumlah_rs)}</span> RS` +
    ` <span class="ps-sep">·</span> <span class="ps-lokasi">${esc(lokasi)}</span>`;
  const parts = [];
  parts.push(state.status === 'ALL'
    ? `${fmt(s.set_terkirim)} terkirim · ${fmt(s.set_proses)} dalam proses`
    : 'terkirim saja');
  parts.push(`${fmt(s.jumlah_pesanan)} ${T().pesanan}`);
  if (state.tipe === 'SET' && Number(s.item_lepas) > 0) parts.push(`${fmt(s.item_lepas)} item lepas tidak dihitung`);
  $('ps-sum-sub').textContent = parts.join(' · ');
}

function jenisText(r) {
  return (r.jenis_set || []).map((j) => `${j.label} ×${fmt(j.jumlah_set)}`).join(', ');
}

function renderTable() {
  const body = $('ps-body');
  if (!rows.length) {
    const hint = unmapped.length
      ? ` Ada ${fmt(unmapped.length)} RS yang wilayahnya belum diketahui (lihat bagian bawah).`
      : '';
    body.innerHTML = `<tr><td colspan="6" class="ps-empty"><i class="ti ti-search"></i> Tidak ada RS ber-set yang cocok dengan filter ini.${esc(hint)}</td></tr>`;
    return;
  }
  body.innerHTML = rows.map((r, i) => {
    const wilayah = [r.kab_kota, state.provinsi ? '' : r.provinsi].filter(Boolean).join(' · ') || '—';
    const tag = r.sumber_wilayah === 'manual'
      ? '<span class="ps-tag" title="Wilayah ditetapkan manual">manual</span>'
      : '<span class="ps-tag ps-tag-auto" title="Wilayah terdeteksi otomatis dari alamat — bisa salah, klik pensil untuk mengoreksi">otomatis</span>';
    const jenis = r.jenis_set || [];
    const shown = jenis.slice(0, 2).map((j) => `${esc(j.label)} ×${fmt(j.jumlah_set)}`).join(', ');
    const more = jenis.length > 2 ? ` <span class="ps-more" title="${esc(jenisText(r))}">+${jenis.length - 2} lainnya</span>` : '';
    const sub = Number(r.set_proses) > 0
      ? `<span class="ps-sub">${fmt(r.set_terkirim)} terkirim · ${fmt(r.set_proses)} proses</span>` : '';
    return `
      <tr class="ps-row" role="button" tabindex="0" aria-expanded="false" data-action="ps-toggle" data-idx="${i}">
        <td><i class="ti ti-chevron-right ps-chev"></i><span class="ps-rs">${esc(r.customer)}</span></td>
        <td>${esc(wilayah)} ${tag}</td>
        <td class="ps-num"><b>${fmt(r.jumlah_set)}</b>${sub}</td>
        <td class="ps-jenis">${shown}${more}</td>
        <td class="ps-date">${esc(fmtDate(r.terakhir))}</td>
        <td class="ps-col-act"><button type="button" class="ps-iconbtn" data-action="ps-edit-wil" data-idx="${i}" title="Ubah wilayah" aria-label="Ubah wilayah ${esc(r.customer)}"><i class="ti ti-pencil"></i></button></td>
      </tr>`;
  }).join('');
}

function renderUnmapped() {
  const box = $('ps-unmapped');
  if (!unmapped.length) { box.hidden = true; return; }
  const totalSet = unmapped.reduce((a, u) => a + Number(u.jumlah_set || 0), 0);
  box.hidden = false;
  $('ps-unm-title').innerHTML =
    `<i class="ti ti-map-pin-off"></i> ${fmt(unmapped.length)} RS ber-set belum diketahui wilayahnya ` +
    `(${fmt(totalSet)} set) — <b>belum ikut</b> hasil per provinsi di atas`;
  $('ps-unm-list').innerHTML = `
    <table class="ps-unm-table"><tbody>
      ${unmapped.map((u, i) => `
        <tr>
          <td>${esc(u.customer)}</td>
          <td class="ps-num">${fmt(u.jumlah_set)} set</td>
          <td class="ps-col-act"><button type="button" class="btn btn-ghost" data-action="ps-edit-unm" data-idx="${i}"><i class="ti ti-map-pin"></i> Tetapkan wilayah</button></td>
        </tr>`).join('')}
    </tbody></table>`;
}

// ── rincian satu RS ──────────────────────────────────────────────────────────
function detailHtml(list) {
  if (!list || !list.length) return '<div class="ps-detail-empty">Tidak ada pesanan pada filter ini.</div>';
  return `
    <table class="ps-dt">
      <thead><tr>
        <th>PO</th><th>Kode RMP</th><th>${esc(T().jenis)}</th><th style="text-align:right">Jml ${esc(T().satuan)}</th>
        <th style="text-align:right">Baris</th><th style="text-align:right">QTY min–maks</th>
        <th>Status</th><th>Tanggal</th><th>Sheet</th>
      </tr></thead>
      <tbody>
        ${list.map((d) => `
          <tr${d.item_lepas ? ' class="ps-lepas"' : ''}>
            <td>${esc(d.po || '—')}</td>
            <td><span class="kode-text">${esc(d.kode_rmp || '—')}</span></td>
            <td>${esc(d.label)}${d.item_lepas ? ' <span class="ps-tag" title="Kurang dari 3 baris: bukan satu set utuh, tidak dihitung">item lepas</span>' : ''}</td>
            <td class="ps-num">${d.item_lepas ? '—' : fmt(d.jumlah_set)}</td>
            <td class="ps-num">${fmt(d.jumlah_baris)}</td>
            <td class="ps-num">${fmt(d.qty_min)}–${fmt(d.qty_max)}</td>
            <td><span class="ps-st ${d.status === 'TERKIRIM' ? 'ps-st-ok' : 'ps-st-wip'}">${d.status === 'TERKIRIM' ? 'Terkirim' : 'Proses'}</span></td>
            <td class="ps-date">${esc(fmtDate(d.tanggal))}</td>
            <td class="ps-date">${esc(d.sumber_sheet || '—')}</td>
          </tr>`).join('')}
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
  dtr.innerHTML = '<td colspan="6"><div class="ps-detail"><i class="ti ti-loader-2 spinner"></i> Memuat rincian…</div></td>';
  tr.after(dtr);
  tr.setAttribute('aria-expanded', 'true');
  tr.classList.add('open');

  const key = JSON.stringify([r.customer, state.status, state.cakupan, state.tipe, state.dari, state.sampai]);
  const slot = dtr.querySelector('.ps-detail');
  try {
    let list = detailCache.get(key);
    if (!list) {
      list = await rpc('get_populasi_set_rs_detail', {
        p_customer: r.customer, p_status: state.status, p_cakupan: state.cakupan, p_tipe: state.tipe,
        p_dari: state.dari || null, p_sampai: state.sampai || null,
      });
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

// ── salin / unduh ────────────────────────────────────────────────────────────
function buildText() {
  const s = data.ringkasan || {};
  const lines = [];
  lines.push(`${T().judul} — ${state.provinsi || 'Semua provinsi'}`);
  let sub = state.status === 'ALL' ? 'Terkirim + dalam proses' : 'Terkirim';
  if (state.dari || state.sampai) sub += ` · ${state.dari ? fmtDate(state.dari) : '…'} s/d ${state.sampai ? fmtDate(state.sampai) : '…'}`;
  sub += ` · data per ${fmtDate(data.data_per)}`;
  lines.push(sub, '');
  rows.forEach((r, i) => {
    const jenis = jenisText(r);
    lines.push(`${i + 1}. ${r.customer}${r.kab_kota ? ` (${r.kab_kota})` : ''} — ${fmt(r.jumlah_set)} ${T().satuan}${jenis ? ` [${jenis}]` : ''}`);
  });
  lines.push('', `Total: ${fmt(s.jumlah_rs)} RS, ${fmt(s.jumlah_set)} ${T().satuan}${state.tipe === 'SET' ? ' (estimasi)' : ''}`);
  if (unmapped.length) lines.push(`Catatan: ${fmt(unmapped.length)} RS lain belum diketahui wilayahnya, belum termasuk.`);
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

function downloadCsv() {
  if (!data || !rows.length) { showToast('Belum ada data untuk diunduh', 'error'); return; }
  const head = ['Rumah sakit', 'Provinsi', 'Kab/Kota', 'Sumber wilayah', `Jumlah ${T().satuan}`, `${T().kolom} terkirim`,
    `${T().kolom} proses`, 'Pesanan', 'Item lepas', T().jenis, 'Terakhir'];
  const lines = [head].concat(rows.map((r) => [
    r.customer, r.provinsi, r.kab_kota, r.sumber_wilayah, r.jumlah_set, r.set_terkirim,
    r.set_proses, r.jumlah_pesanan, r.item_lepas, jenisText(r), r.terakhir,
  ])).map((a) => a.map(csvCell).join(','));
  // BOM supaya Excel membaca UTF-8 dengan benar
  const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `populasi-${state.tipe.toLowerCase()}-${(state.provinsi || 'semua').toLowerCase().replace(/\s+/g, '-')}-${localISODate()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── event ────────────────────────────────────────────────────────────────────
function syncStatusButtons() {
  document.querySelectorAll('[data-action="ps-status"]').forEach((b) => b.classList.toggle('active', b.dataset.v === state.status));
}

// Tipe produk: tombol aktif + teks header/placeholder ikut tipe.
function syncTipe() {
  document.querySelectorAll('[data-action="ps-tipe"]').forEach((b) => b.classList.toggle('active', b.dataset.v === state.tipe));
  const set = (id, txt) => { const el = $(id); if (el) el.textContent = txt; };
  set('ps-th-jml', T().kolom);
  set('ps-th-jenis', T().jenis);
  set('ps-lbl-cari', 'Cari ' + T().cari);
  const foot = $('ps-foot');
  if (foot) {
    foot.innerHTML = state.tipe === 'SET'
      ? 'Jumlah set = <b>estimasi</b> dari QTY baris isi set (FPB). Pesanan dengan kurang dari 3 baris dianggap item lepas dan tidak dihitung.'
      : 'Jumlah = <b>total QTY</b> baris satuan pada pesanan (bukan estimasi set). Kategori diambil dari family di master produk.';
  }
}

export async function mount(container) {
  mountedContainer = container;
  await Promise.all([ensureStyle(), ensureVendorScripts()]);
  container.innerHTML = POPULASI_MARKUP;

  // Provinsi terakhir yang dipilih diingat; belum pernah memilih -> Jawa Tengah.
  const saved = lsGet(LS_PROV);
  state.provinsi = saved === null ? DEFAULT_PROV : saved;
  state.status = 'DELIVERED';
  state.cakupan = 'POPULASI';
  state.tipe = 'SET';
  state.dari = state.sampai = state.search = '';
  data = null; rows = []; unmapped = [];
  detailCache.clear();

  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const ACTIONS = {
    'ps-reload': () => load(),
    'ps-tipe': (el) => {
      state.tipe = ['INSTRUMENT', 'UNIT'].includes(el.dataset.v) ? el.dataset.v : 'SET';
      syncTipe(); load();
    },
    'ps-status': (el) => { state.status = el.dataset.v === 'ALL' ? 'ALL' : 'DELIVERED'; syncStatusButtons(); load(); },
    'ps-toggle': (el) => toggleDetail(+el.dataset.idx),
    'ps-edit-wil': (el) => { const r = rows[+el.dataset.idx]; if (r) editWilayah(r.customer, r.provinsi, r.kab_kota); },
    'ps-edit-unm': (el) => { const u = unmapped[+el.dataset.idx]; if (u) editWilayah(u.customer, '', ''); },
    'ps-copy': () => copyText(),
    'ps-csv': () => downloadCsv(),
  };
  const CHANGE_BY_ID = {
    'ps-provinsi': (t) => { state.provinsi = t.value; lsSet(LS_PROV, t.value); load(); },
    'ps-cakupan': (t) => { state.cakupan = t.value === 'SEMUA' ? 'SEMUA' : 'POPULASI'; load(); },
    'ps-dari': (t) => { state.dari = t.value; load(); },
    'ps-sampai': (t) => { state.sampai = t.value; load(); },
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
    if (e.target.id !== 'ps-search') return;
    clearTimeout(searchTimer);
    const v = e.target.value;
    searchTimer = setTimeout(() => { state.search = v; load(); }, 300);
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
  $('ps-provinsi').value = state.provinsi;
  syncStatusButtons();
  syncTipe();

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