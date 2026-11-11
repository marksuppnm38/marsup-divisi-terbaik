// siap-tayang.js — kartu "Siap tayang" di modul Stok.
//
// Jawab: "barang/set mana yang SUDAH ada link e-Katalog-nya dan stoknya ready?"
// Sumber data = view v_siap_tayang (lihat stok_siap_tayang_view.sql): hanya produk
// dengan link_v6 bersih, plus stok_status (READY / INDENT / DATA_TIDAK_LENGKAP).
//
// Pola sama dengan kelengkapan.js: mountSiapTayang() di mount(), refreshSiapTayang()
// abis upload stok sukses, unmountSiapTayang() di unmount(). Style ada di style.css
// (class bersama dengan kelengkapan.js). Output: Salin ke Sheets, .xlsx, CSV, Salin kode saja —
// semuanya mengikuti SEMUA baris hasil filter, bukan cuma yang tampil.

const PAGE_STEP = 200;
let S = null;

const SHELL = `
<div class="card-head">
  <div class="card-head-text">
    <h2 id="siap-title">Siap tayang</h2>
    <p>Produk yang sudah punya link e-Katalog V6 beserta status stoknya.</p>
  </div>
  <div class="card-head-action">
    <button class="mini-btn" type="button" data-st="refresh">Muat ulang</button>
  </div>
</div>
<div class="result-banner err data-banner" data-st-region="banner" role="status" hidden></div>
<div class="toolbar">
  <input type="text" data-st="q" placeholder="Cari kode / nama…" aria-label="Cari kode atau nama" autocomplete="off"/>
  <select data-st="status" aria-label="Filter status stok"></select>
  <select data-st="tipe" aria-label="Filter tipe">
    <option value="all">Semua tipe</option><option value="SET">Set</option>
    <option value="INSTRUMENT">Instrumen</option><option value="UNIT">Unit</option>
  </select>
  <div class="btns">
    <button type="button" class="mini-btn" data-st="copy" title="Salin sebagai tabel, tinggal Ctrl+V di Google Sheets / Excel">Salin ke Sheets</button>
    <button type="button" class="mini-btn" data-st="xlsx">.xlsx</button>
    <button type="button" class="mini-btn" data-st="csv">CSV</button>
    <button type="button" class="mini-btn" data-st="codes" title="Satu kode produk per baris">Salin kode saja</button>
  </div>
</div>
<div class="data-wrap"><table class="data-table">
  <thead><tr><th scope="col">Kode produk</th><th scope="col">Nama</th><th scope="col">Tipe</th><th scope="col">Stok</th><th scope="col" class="c-num">Bisa kirim</th><th scope="col">e-Katalog</th></tr></thead>
  <tbody data-st-region="tbody"></tbody>
</table></div>
<div class="list-foot" data-st-region="foot"></div>
`;

// ───────── util ─────────
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function fmtN(n) { return Number(n || 0).toLocaleString('id-ID'); }
function today() { return new Date().toISOString().slice(0, 10); }
function region(name) { return S.host.querySelector(`[data-st-region="${name}"]`); }
function safeHref(u) { return /^https?:\/\//i.test(u || '') ? u : ''; } // cegah javascript: dsb

const STATUS = {
  READY: ['ok', 'Siap'],
  INDENT: ['', 'Indent'],
  DATA_TIDAK_LENGKAP: ['warn', 'Data tidak lengkap']
};
const TIPE = { SET: 'Set', INSTRUMENT: 'Instrumen', UNIT: 'Unit' };

// ───────── API ─────────
function withTimeout(p, ms, label) {
  let t;
  const timeout = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error(label + ' tidak merespons setelah ' + (ms / 1000) + ' detik')), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(t));
}
async function api(ctx, path, extra) {
  const token = await withTimeout(window.PNMAuth.getAccessToken(), 8000, 'PNMAuth.getAccessToken()');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  let res;
  try {
    res = await fetch(`${ctx.url}/rest/v1/${path}`, {
      headers: Object.assign({ apikey: ctx.key, Authorization: 'Bearer ' + token }, extra || {}),
      signal: ctl.signal
    });
  } catch (e) {
    if (e.name === 'AbortError') throw Object.assign(new Error('Query lebih dari 20 detik'), { code: 'TIMEOUT' });
    throw e;
  } finally { clearTimeout(timer); }
  if (res.status === 401) { window.PNMAuth.logout(); throw new Error('Sesi habis, silakan login ulang.'); }
  if (!res.ok && res.status !== 416) {
    let body = {};
    try { body = await res.json(); } catch { /* bukan JSON */ }
    const err = new Error(body.message || ('HTTP ' + res.status));
    err.code = body.code || String(res.status);
    throw err;
  }
  return res;
}
// PostgREST batasi 1000 baris/request → ambil per halaman pakai Range.
async function fetchAll(ctx, path) {
  const out = [], step = 1000;
  for (let from = 0; ; from += step) {
    const res = await api(ctx, path, { Range: `${from}-${from + step - 1}`, 'Range-Unit': 'items' });
    if (res.status === 416) break;
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < step) break;
  }
  return out;
}

async function loadAll() {
  const ctx = S;
  if (!ctx) return;
  ctx.loading = true; ctx.error = null;
  renderAll();
  try {
    const rows = await fetchAll(ctx, 'v_siap_tayang?select=produk_id,kode_produk,kode_asli,nama_produk,tipe,link_v6,stok_status,qty_ready&order=kode_produk.asc');
    if (S !== ctx) return;
    ctx.rows = rows;
  } catch (e) {
    if (S !== ctx) return;
    ctx.error = e;
  } finally {
    if (S === ctx) { ctx.loading = false; renderAll(); }
  }
}

// ───────── filter ─────────
function filtered() {
  const q = S.q.trim().toLowerCase();
  return (S.rows || []).filter(r => {
    if (S.fStatus !== 'all' && r.stok_status !== S.fStatus) return false;
    if (S.fTipe !== 'all' && r.tipe !== S.fTipe) return false;
    if (!q) return true;
    return (r.kode_produk || '').toLowerCase().includes(q)
      || (r.kode_asli || '').toLowerCase().includes(q)
      || (r.nama_produk || '').toLowerCase().includes(q);
  });
}

// ───────── render ─────────
function renderAll() { if (S) { renderBanner(); syncToolbar(); renderList(); } }

function renderBanner() {
  const el = region('banner');
  let html = '';
  if (S.error) {
    const missing = ['PGRST205', '42P01', '404'].includes(S.error.code);
    html = missing
      ? 'View belum dibuat di database. Jalankan <code>stok_siap_tayang_view.sql</code> di Supabase SQL Editor, lalu klik Muat ulang.'
      : 'Gagal memuat data: ' + esc(S.error.message || S.error) + '. Klik Muat ulang untuk mencoba lagi.';
  }
  el.innerHTML = html;
  el.hidden = !html;
}

function syncToolbar() {
  const qIn = S.host.querySelector('[data-st="q"]');
  const tipe = S.host.querySelector('[data-st="tipe"]');
  const status = S.host.querySelector('[data-st="status"]');
  if (qIn.value !== S.q) qIn.value = S.q;
  if (tipe.value !== S.fTipe) tipe.value = S.fTipe;
  const rows = S.rows;
  const n = (st) => (rows ? ` (${fmtN(st === 'all' ? rows.length : rows.filter(r => r.stok_status === st).length)})` : '');
  status.innerHTML = [['all', 'Semua status'], ['READY', 'Siap'], ['INDENT', 'Indent'], ['DATA_TIDAK_LENGKAP', 'Set data tidak lengkap']]
    .map(([v, l]) => `<option value="${v}"${v === S.fStatus ? ' selected' : ''}>${l}${n(v)}</option>`).join('');
}

function renderList() {
  const tbody = region('tbody'), foot = region('foot');
  if (S.error && !S.rows) { tbody.innerHTML = '<tr><td colspan="6"><div class="list-empty">Data belum bisa ditampilkan.</div></td></tr>'; foot.innerHTML = ''; return; }
  if (S.loading || !S.rows) { tbody.innerHTML = '<tr><td colspan="6"><div class="list-empty">Memuat…</div></td></tr>'; foot.innerHTML = ''; return; }
  const rows = filtered();
  const shown = rows.slice(0, S.limit);
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="list-empty">${S.q ? 'Tidak ada yang cocok dengan pencarian.' : 'Tidak ada data untuk filter ini.'}</div></td></tr>`;
  } else {
    tbody.innerHTML = shown.map(r => {
      const st = STATUS[r.stok_status] || ['', r.stok_status || '-'];
      const href = safeHref(r.link_v6);
      return `<tr>
        <td class="c-mono">${esc(r.kode_produk)}</td>
        <td>${esc(r.nama_produk)}</td>
        <td>${esc(TIPE[r.tipe] || r.tipe || '-')}</td>
        <td><span class="status ${st[0]}">${esc(st[1])}</span></td>
        <td class="c-num">${r.qty_ready == null ? '<span class="c-muted">—</span>' : fmtN(r.qty_ready)}</td>
        <td>${href ? `<a class="link-btn" href="${esc(href)}" target="_blank" rel="noopener noreferrer">Buka</a>` : '<span class="c-muted">—</span>'}</td>
      </tr>`;
    }).join('');
  }
  foot.innerHTML = `<span>Menampilkan ${fmtN(shown.length)} dari ${fmtN(rows.length)}</span>`
    + (rows.length > shown.length ? `<button type="button" class="mini-btn" data-st="more">Tampilkan ${fmtN(Math.min(PAGE_STEP, rows.length - shown.length))} lagi</button>` : '');
}

// ───────── export ─────────
function tableData(rows) {
  return {
    name: 'siap-tayang',
    widths: [24, 60, 12, 20, 12, 70],
    aoa: [['Kode Produk', 'Nama', 'Tipe', 'Stok', 'Bisa Kirim', 'Link e-Katalog']].concat(
      rows.map(r => [String(r.kode_produk || ''), String(r.nama_produk || ''), TIPE[r.tipe] || String(r.tipe || ''),
        (STATUS[r.stok_status] || ['', String(r.stok_status || '')])[1],
        r.qty_ready == null ? '' : Number(r.qty_ready), String(r.link_v6 || '')]))
  };
}
// tab & newline → spasi; awalan = + - @ diberi ' (cegah formula injection di Sheets/Excel)
function cell(v) {
  let s = String(v == null ? '' : v).replace(/[\t\r\n]+/g, ' ').trim();
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}
function toTSV(aoa) { return aoa.map(r => r.map(cell).join('\t')).join('\n'); }
function toCSV(aoa) {
  return aoa.map(r => r.map(v => {
    const s = cell(v);
    return /[",]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\r\n');
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* diam */ }
    ta.remove();
    return ok;
  }
}
function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function flash(btn, html) {
  const old = btn.innerHTML;
  btn.innerHTML = html;
  setTimeout(() => { if (btn.isConnected) btn.innerHTML = old; }, 1600);
}
async function doExport(kind, btn) {
  const rows = filtered();
  if (!rows.length) { flash(btn, 'Tidak ada data'); return; }
  const { name, widths, aoa } = tableData(rows);
  const file = `${name}-${today()}`;
  if (kind === 'copy') {
    const ok = await copyText(toTSV(aoa));
    flash(btn, ok ? `${fmtN(rows.length)} baris tersalin` : 'Gagal menyalin');
  } else if (kind === 'codes') {
    const kode = rows.map(r => r.kode_produk).filter(Boolean);
    const ok = await copyText(kode.join('\n'));
    flash(btn, ok ? `${fmtN(kode.length)} kode tersalin` : 'Gagal menyalin');
  } else if (kind === 'csv') {
    download(new Blob(['\uFEFF' + toCSV(aoa)], { type: 'text/csv;charset=utf-8;' }), file + '.csv');
  } else if (kind === 'xlsx') {
    if (!window.XLSX) { flash(btn, 'Library .xlsx belum siap'); return; }
    const X = window.XLSX;
    const ws = X.utils.aoa_to_sheet(aoa);
    ws['!cols'] = widths.map(w => ({ wch: w }));
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws, 'Data');
    X.writeFile(wb, file + '.xlsx');
  }
}

// ───────── events ─────────
function onClick(e) {
  const t = e.target.closest('[data-st]');
  if (!t || !S) return;
  const act = t.dataset.st;
  if (act === 'refresh') loadAll();
  else if (act === 'more') { S.limit += PAGE_STEP; renderList(); }
  else if (['copy', 'xlsx', 'csv', 'codes'].includes(act)) doExport(act, t);
}
function onInput(e) {
  if (!S || !e.target.matches('[data-st="q"]')) return;
  S.q = e.target.value; S.limit = PAGE_STEP; renderList();
}
function onChange(e) {
  if (!S) return;
  if (e.target.matches('[data-st="tipe"]')) S.fTipe = e.target.value;
  else if (e.target.matches('[data-st="status"]')) S.fStatus = e.target.value;
  else return;
  S.limit = PAGE_STEP; renderList();
}

// ───────── lifecycle ─────────
export function mountSiapTayang({ supabaseUrl, anonKey }) {
  const host = document.getElementById('siap-card');
  if (!host) return;
  S = { url: supabaseUrl, key: anonKey, host, rows: null, loading: true, error: null,
        fStatus: 'READY', fTipe: 'all', q: '', limit: PAGE_STEP };
  host.innerHTML = SHELL;
  host.addEventListener('click', onClick);
  host.addEventListener('input', onInput);
  host.addEventListener('change', onChange);
  loadAll();
}
export function refreshSiapTayang() { if (S) loadAll(); }
export function unmountSiapTayang() {
  S = null;
}