// kelengkapan.js — kartu "Kelengkapan Stok Set" di modul Stok.
//
// Jawab pertanyaan "dari seluruh katalog, komponen mana yang belum punya data
// stok, dan set mana yang cuma kurang satu-dua komponen?". Pelengkap popover
// hover di Konversian (yang jawab pertanyaan sama tapi per-set, pas lagi
// konversi).
//
// Sumber data = 2 view di stok_kelengkapan_views.sql (v_komponen_bolong,
// v_set_kelengkapan) + hitungan status dari v_stok_status_set + upload
// terakhir di stok_upload_log (buat nebak ALASAN kenapa kode belum ada stok).
//
// Kartu ringkasan = tombol filter (klik "Siap rakit" → daftar set siap rakit, dst).
// Tautan silang: klik angka "set terblokir" / kode komponen di daftar set →
// langsung lihat set yang bolong di kode itu.
//
// Output ramah Sheets/Excel: Salin ke Sheets (TSV, tinggal Ctrl+V di sel A1),
// Download .xlsx (kolom kode = sel teks, gak ke-auto-convert jadi tanggal/angka),
// Download CSV (UTF-8 BOM), dan Salin kode saja (satu kode per baris).
// Yang disalin/di-download = SEMUA baris hasil filter, bukan cuma yang tampil.
//
// Dipanggil dari index.js: mountKelengkapan() di mount(), refreshKelengkapan()
// abis upload sukses, unmountKelengkapan() di unmount(). Style di-inject dari
// sini (scoped ke #kelengkapan-card) — style.css gak disentuh.

const STYLE_ID = 'kel-style';
const PAGE_STEP = 200;

let S = null; // state modul; null = gak termount

const CSS = `
#kelengkapan-card .kel-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:14px}
#kelengkapan-card .kel-stat{display:block;width:100%;text-align:left;background:transparent;font-family:inherit;border:1px solid var(--border);border-radius:var(--radius-md);padding:10px 12px;cursor:pointer;transition:border-color .12s,background .12s}
#kelengkapan-card .kel-stat:hover{border-color:var(--accent)}
#kelengkapan-card .kel-stat:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
#kelengkapan-card .kel-stat.active{border-color:var(--accent);background:var(--accent-soft,rgba(80,120,255,.08))}
#kelengkapan-card .kel-stat .n{font-family:var(--font-mono,monospace);font-size:20px;font-weight:600;color:var(--text);line-height:1.2}
#kelengkapan-card .kel-stat .l{font-size:11px;color:var(--text-muted);margin-top:2px}
#kelengkapan-card .kel-stat.warn .n{color:var(--warn-text,#b45309)}
#kelengkapan-card .kel-banner{border:1px solid var(--warn,#d97706);background:var(--warn-soft,#fffbeb);color:var(--warn-text,#b45309);border-radius:var(--radius-sm);padding:9px 12px;font-size:12px;margin-bottom:12px;line-height:1.5}
#kelengkapan-card .kel-banner code{font-family:var(--font-mono,monospace);font-size:11.5px}
#kelengkapan-card .kel-tabs{display:flex;gap:4px;border-bottom:1px solid var(--border);margin-bottom:12px;flex-wrap:wrap}
#kelengkapan-card .kel-tab{background:none;border:0;border-bottom:2px solid transparent;padding:8px 12px;font-family:inherit;font-size:12.5px;font-weight:600;color:var(--text-muted);cursor:pointer;margin-bottom:-1px}
#kelengkapan-card .kel-tab:hover{color:var(--text)}
#kelengkapan-card .kel-tab.active{color:var(--text);border-bottom-color:var(--accent)}
#kelengkapan-card .kel-toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px}
#kelengkapan-card .kel-toolbar input,#kelengkapan-card .kel-toolbar select{height:33px;padding:0 10px;font-size:12px;border:1px solid var(--border-strong);border-radius:var(--radius-sm);background:var(--surface);color:var(--text);font-family:inherit}
#kelengkapan-card .kel-toolbar input{flex:1 1 200px;min-width:160px}
#kelengkapan-card .kel-btns{display:flex;gap:6px;flex-wrap:wrap}
#kelengkapan-card .kel-wrap{max-height:460px;overflow:auto;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface)}
#kelengkapan-card .kel-table{width:100%;border-collapse:collapse;font-size:12px}
#kelengkapan-card .kel-table th{position:sticky;top:0;background:var(--surface-2);text-align:left;padding:7px 11px;font-weight:600;color:var(--text-secondary);border-bottom:1px solid var(--border);white-space:nowrap}
#kelengkapan-card .kel-table td{padding:7px 11px;border-bottom:1px solid var(--border);color:var(--text);vertical-align:top}
#kelengkapan-card .kel-table tr:last-child td{border-bottom:0}
#kelengkapan-card .kel-mono{font-family:var(--font-mono,monospace);white-space:nowrap}
#kelengkapan-card .kel-num{text-align:right;white-space:nowrap}
#kelengkapan-card .kel-bar{display:inline-block;width:56px;height:5px;border-radius:3px;background:var(--surface-3,#eee);vertical-align:middle;margin-left:8px;overflow:hidden}
#kelengkapan-card .kel-bar i{display:block;height:100%;background:var(--warning-dot,#d97706)}
#kelengkapan-card .kel-tag{display:inline-block;font-size:11px;padding:2px 7px;border-radius:999px;border:1px solid var(--border);color:var(--text-secondary)}
#kelengkapan-card .kel-tag.skip{border-color:var(--warn,#d97706);color:var(--warn-text,#b45309)}
#kelengkapan-card .kel-tag.mirip{border-color:var(--accent);color:var(--accent-text)}
#kelengkapan-card .kel-tag.ok{border-color:var(--success-dot,#16a34a);color:var(--success-text,#15803d)}
#kelengkapan-card .kel-muted{color:var(--text-muted)}
#kelengkapan-card .kel-link{background:none;border:0;padding:0;margin:0;font:inherit;color:var(--accent-text);cursor:pointer;text-decoration:underline dotted;text-underline-offset:3px}
#kelengkapan-card .kel-link:hover{text-decoration-style:solid}
#kelengkapan-card .kel-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px;font-size:11.5px;color:var(--text-muted);flex-wrap:wrap}
#kelengkapan-card .kel-empty{padding:22px;text-align:center;color:var(--text-muted);font-size:12.5px}
#kelengkapan-card .kel-list{margin:0;padding:0;list-style:none}
#kelengkapan-card .kel-list li{padding:1px 0}
`;

const SHELL = `
<div class="card-head">
  <div class="icon-box green"><i class="ti ti-checklist"></i></div>
  <div class="card-head-text">
    <h2>Kelengkapan Stok Set</h2>
    <p>Komponen set yang belum punya data stok, dan set yang tinggal kurang sedikit lagi.</p>
  </div>
  <div class="card-head-action">
    <button class="mini-btn" data-kel="refresh" title="Muat ulang"><i class="ti ti-refresh"></i>Refresh</button>
  </div>
</div>
<div class="kel-stats" data-kel-region="stats"></div>
<div class="kel-banner" data-kel-region="banner" style="display:none"></div>
<div class="kel-tabs" data-kel-region="tabs"></div>
<div class="kel-toolbar">
  <input type="text" data-kel="q" placeholder="Cari kode / nama…" autocomplete="off"/>
  <select data-kel="filter"></select>
  <div class="kel-btns" data-kel-region="btns"></div>
</div>
<div class="kel-wrap"><table class="kel-table"><thead data-kel-region="thead"></thead><tbody data-kel-region="tbody"></tbody></table></div>
<div class="kel-foot" data-kel-region="foot"></div>
`;

// ───────── util ─────────
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function norm(s) { return String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function fmtN(n) { return Number(n || 0).toLocaleString('id-ID'); }
function fmtDate(iso) {
  try { return new Date(iso).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return ''; }
}
function today() { return new Date().toISOString().slice(0, 10); }
function region(name) { return S.host.querySelector(`[data-kel-region="${name}"]`); }

// ───────── API ─────────
// DIAGNOSA "memuat terus": tanpa timeout, token/fetch yang menggantung gak
// pernah reject -> gak ada error di console & spinner selamanya. Sekarang
// keduanya dibatasi waktu, jadi hang berubah jadi banner error yang jelas.
function withTimeout(p, ms, label) {
  let t;
  const timeout = new Promise((_, rej) => {
    t = setTimeout(() => rej(Object.assign(
      new Error(label + ' tidak merespons setelah ' + (ms / 1000) + ' detik'), { code: 'TIMEOUT' })), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(t));
}

async function api(ctx, path, extra) {
  const label = path.split('?')[0];
  const t0 = performance.now();
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
    if (e.name === 'AbortError') {
      throw Object.assign(new Error('Query ' + label + ' lebih dari 20 detik (view terlalu berat?)'), { code: 'TIMEOUT' });
    }
    throw e;
  } finally { clearTimeout(timer); }
  console.debug('[kelengkapan]', label, res.status, Math.round(performance.now() - t0) + 'ms');
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

// PostgREST (Supabase) batasi 1000 baris/request → ambil per halaman pakai Range.
async function fetchAll(ctx, path) {
  const out = [];
  const step = 1000;
  for (let from = 0; ; from += step) {
    const res = await api(ctx, path, { Range: `${from}-${from + step - 1}`, 'Range-Unit': 'items' });
    if (res.status === 416) break; // lewat batas = habis
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < step) break;
  }
  return out;
}

async function countStatus(ctx, status) {
  const res = await api(ctx, `v_stok_status_set?select=produk_id&status=eq.${status}`,
    { Prefer: 'count=exact', Range: '0-0', 'Range-Unit': 'items' });
  const cr = res.headers.get('content-range') || '';
  return Number(cr.split('/')[1]) || 0;
}

async function loadCounts(ctx) {
  const [ready, indent, tidakLengkap] = await Promise.all([
    countStatus(ctx, 'READY'), countStatus(ctx, 'INDENT'), countStatus(ctx, 'DATA_TIDAK_LENGKAP')
  ]);
  return { ready, indent, tidakLengkap, total: ready + indent + tidakLengkap };
}

async function loadLastLog(ctx) {
  try {
    const res = await api(ctx, 'stok_upload_log?select=uploaded_at,file_name,skipped_count,skipped_codes&order=uploaded_at.desc&limit=1');
    const rows = await res.json();
    return rows[0] || null;
  } catch { return null; } // tabel log belum ada → alasan jatuh ke default
}

// ───────── alasan ─────────
function buildSkipIndex(log) {
  const codes = (log && Array.isArray(log.skipped_codes)) ? log.skipped_codes.map(String) : [];
  const exact = new Set(codes);
  const byNorm = new Map();
  codes.forEach(c => { const n = norm(c); if (n && !byNorm.has(n)) byNorm.set(n, c); });
  return { exact, byNorm, partial: !!log && Number(log.skipped_count || 0) > codes.length };
}

// skipped_codes = kode di file stok yang gak ada di master_produk.
function alasanFor(k, skip) {
  const kode = k.kode_asli;
  if (!kode) return { type: 'kosong', text: 'kode_asli kosong di katalog' };
  if (skip.exact.has(kode)) return { type: 'skip', text: 'Ter-skip saat upload (belum ada di master_produk)' };
  const m = skip.byNorm.get(norm(kode));
  if (m) return { type: 'mirip', text: 'Mirip kode ter-skip: ' + m };
  return { type: 'absen', text: 'Tidak ada di file stok' };
}

// ───────── load ─────────
async function loadAll() {
  const ctx = S;
  if (!ctx) return;
  ctx.loading = true; ctx.error = null; ctx.warn = null;
  renderAll();
  try {
    const [counts, komponen, log] = await Promise.all([
      loadCounts(ctx),
      fetchAll(ctx, 'v_komponen_bolong?select=produk_id,kode_produk,kode_asli,nama_produk,set_terblokir&order=set_terblokir.desc,produk_id.asc'),
      loadLastLog(ctx)
    ]);
    if (S !== ctx) return;
    ctx.counts = counts;
    ctx.skip = buildSkipIndex(log);
    ctx.logMeta = log ? { file: log.file_name, at: log.uploaded_at } : null;
    komponen.forEach(k => { k._alasan = alasanFor(k, ctx.skip); });
    ctx.komponen = komponen;
    if (counts.tidakLengkap > 0 && komponen.length === 0) {
      ctx.warn = `Ada ${fmtN(counts.tidakLengkap)} set dengan data stok tidak lengkap, tapi <code>v_komponen_bolong</code> kosong. Kemungkinan view belum bisa dibaca (cek grant/RLS) atau definisinya beda dari <code>v_stok_status_set</code>.`;
    }
    if (ctx.sets !== null) await loadSets(ctx); // tab set pernah dibuka → ikut dimuat ulang
  } catch (e) {
    if (S !== ctx) return;
    ctx.error = e;
  } finally {
    if (S === ctx) { ctx.loading = false; renderAll(); }
  }
}

async function loadSets(ctx) {
  ctx.setsLoading = true;
  if (S === ctx) renderList();
  try {
    // Status/bisa-rakit dari v_stok_status_set (sumber kebenaran status), detail komponen
    // bolong dari v_set_kelengkapan — digabung di sini lewat id set. ~500 baris, murah.
    const [stat, kel] = await Promise.all([
      fetchAll(ctx, 'v_stok_status_set?select=produk_id,kode_produk,nama_produk,jumlah_komponen,jumlah_komponen_terdata,buildable_qty,status&order=produk_id.asc'),
      fetchAll(ctx, 'v_set_kelengkapan?select=set_id,jumlah_bolong,bolong_kode,bolong_nama&jumlah_bolong=gt.0&order=set_id.asc')
    ]);
    if (S !== ctx) return;
    const kelById = new Map(kel.map(k => [k.set_id, k]));
    const rank = { DATA_TIDAK_LENGKAP: 0, INDENT: 1, READY: 2 };
    ctx.sets = stat.map(r => {
      const k = kelById.get(r.produk_id);
      const total = Number(r.jumlah_komponen) || 0, terdata = Number(r.jumlah_komponen_terdata) || 0;
      return {
        set_id: r.produk_id, kode_produk: r.kode_produk, nama_produk: r.nama_produk, status: r.status,
        jumlah_komponen: total, jumlah_terdata: terdata,
        jumlah_bolong: k ? Number(k.jumlah_bolong) : Math.max(0, total - terdata),
        bolong_kode: (k && k.bolong_kode) || [], bolong_nama: (k && k.bolong_nama) || [],
        buildable_qty: r.buildable_qty == null ? null : Number(r.buildable_qty)
      };
    }).sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9)
      || a.jumlah_bolong - b.jumlah_bolong
      || String(a.kode_produk).localeCompare(String(b.kode_produk)));
  } catch (e) {
    if (S !== ctx) return;
    ctx.error = e;
  } finally {
    ctx.setsLoading = false;
    if (S === ctx) renderAll();
  }
}

function ensureSets() {
  if (S.sets === null && !S.setsLoading) loadSets(S);
}

// ───────── filter ─────────
function filtered() {
  const q = S.q.trim().toLowerCase();
  if (S.tab === 'komponen') {
    return (S.komponen || []).filter(k => {
      if (S.fKomp !== 'all' && k._alasan.type !== S.fKomp) return false;
      if (!q) return true;
      return (k.kode_asli || '').toLowerCase().includes(q)
        || (k.kode_produk || '').toLowerCase().includes(q)
        || (k.nama_produk || '').toLowerCase().includes(q);
    });
  }
  const f = S.fSet; // all | READY | INDENT | TL (semua tidak lengkap) | TL1 | TL2 | TL3
  return (S.sets || []).filter(s => {
    if (f === 'READY' || f === 'INDENT') {
      if (s.status !== f) return false;
    } else if (f.startsWith('TL')) {
      if (s.status !== 'DATA_TIDAK_LENGKAP') return false;
      if (f !== 'TL' && s.jumlah_bolong > Number(f.slice(2))) return false;
    }
    if (!q) return true;
    return (s.kode_produk || '').toLowerCase().includes(q)
      || (s.nama_produk || '').toLowerCase().includes(q)
      || (s.bolong_kode || []).join(' ').toLowerCase().includes(q)
      || (s.bolong_nama || []).join(' ').toLowerCase().includes(q);
  });
}

// ───────── render ─────────
function renderAll() {
  if (!S) return;
  renderStats(); renderBanner(); renderTabs(); syncToolbar(); renderList();
}

function statActive(key) {
  if (key === 'komp') return S.tab === 'komponen';
  if (S.tab !== 'set') return false;
  if (key === 'total') return S.fSet === 'all';
  if (key === 'ready') return S.fSet === 'READY';
  if (key === 'indent') return S.fSet === 'INDENT';
  return S.fSet.startsWith('TL');
}

function renderStats() {
  const c = S.counts;
  const v = (n) => (c ? fmtN(n) : '…');
  const card = (key, num, label, warn, hint) =>
    `<button type="button" class="kel-stat${warn ? ' warn' : ''}${statActive(key) ? ' active' : ''}" data-kel="stat" data-stat="${key}" aria-pressed="${statActive(key)}" title="${hint}">` +
    `<div class="n">${num}</div><div class="l">${label}</div></button>`;
  region('stats').innerHTML =
    card('total', v(c && c.total), 'Total set', false, 'Tampilkan semua set') +
    card('ready', v(c && c.ready), 'Siap rakit', false, 'Filter: set siap rakit') +
    card('indent', v(c && c.indent), 'Indent', false, 'Filter: set indent') +
    card('tl', v(c && c.tidakLengkap), 'Data stok tidak lengkap', true, 'Filter: set dengan komponen tanpa data stok') +
    card('komp', S.komponen ? fmtN(S.komponen.length) : '…', 'Komponen tanpa data', true, 'Lihat daftar komponen yang bolong');
}

function renderBanner() {
  const el = region('banner');
  let html = '';
  if (S.error) {
    const missing = S.error.code === 'PGRST205' || S.error.code === '42P01' || S.error.code === '404';
    html = missing
      ? 'View belum dibuat di database. Jalankan <code>stok_kelengkapan_views.sql</code> di Supabase SQL Editor, lalu klik Refresh.'
      : 'Gagal memuat data: ' + esc(S.error.message || S.error);
  } else if (S.warn) {
    html = S.warn;
  }
  el.innerHTML = html;
  el.style.display = html ? 'block' : 'none';
}

function renderTabs() {
  const nKomp = S.komponen ? fmtN(S.komponen.length) : '…';
  const nSet = S.counts ? fmtN(S.counts.total) : '…';
  region('tabs').innerHTML =
    `<button class="kel-tab ${S.tab === 'komponen' ? 'active' : ''}" data-kel="tab" data-tab="komponen">Komponen bolong (${nKomp})</button>` +
    `<button class="kel-tab ${S.tab === 'set' ? 'active' : ''}" data-kel="tab" data-tab="set">Daftar set (${nSet})</button>`;
}

function syncToolbar() {
  const sel = S.host.querySelector('[data-kel="filter"]');
  const qIn = S.host.querySelector('[data-kel="q"]');
  if (qIn.value !== S.q) qIn.value = S.q; // sinkron kalau q di-set dari klik kartu/tautan
  const opts = S.tab === 'komponen'
    ? [['all', 'Semua alasan'], ['absen', 'Tidak ada di file stok'], ['skip', 'Ter-skip saat upload'], ['mirip', 'Mirip kode ter-skip'], ['kosong', 'kode_asli kosong']]
    : [['all', 'Semua status'], ['READY', 'Siap rakit'], ['INDENT', 'Indent'], ['TL', 'Tidak lengkap · semua'],
       ['TL1', 'Tidak lengkap · kurang 1 komponen'], ['TL2', 'Tidak lengkap · maks. 2 bolong'], ['TL3', 'Tidak lengkap · maks. 3 bolong']];
  const cur = S.tab === 'komponen' ? S.fKomp : S.fSet;
  sel.innerHTML = opts.map(([v, l]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`).join('');
  region('btns').innerHTML =
    `<button class="mini-btn" data-kel="copy" title="Salin sebagai tabel — tinggal Ctrl+V di Google Sheets / Excel"><i class="ti ti-copy"></i>Salin ke Sheets</button>` +
    `<button class="mini-btn" data-kel="xlsx"><i class="ti ti-file-spreadsheet"></i>.xlsx</button>` +
    `<button class="mini-btn" data-kel="csv"><i class="ti ti-download"></i>CSV</button>` +
    (S.tab === 'komponen' ? `<button class="mini-btn" data-kel="codes" title="Satu kode per baris, buat dikirim ke Logistik"><i class="ti ti-list"></i>Salin kode saja</button>` : '');
}

function renderList() {
  if (!S) return;
  const thead = region('thead'), tbody = region('tbody'), foot = region('foot');
  const isKomp = S.tab === 'komponen';
  const busy = S.loading || (!isKomp && (S.setsLoading || S.sets === null));
  thead.innerHTML = isKomp
    ? '<tr><th>Kode Asli</th><th>Nama Komponen</th><th class="kel-num">Set terblokir</th><th>Alasan</th></tr>'
    : '<tr><th>Kode Set</th><th>Nama Set</th><th>Status</th><th class="kel-num">Terdata</th><th>Detail</th></tr>';
  const cols = isKomp ? 4 : 5;
  if (S.error && !S.komponen) { tbody.innerHTML = `<tr><td colspan="${cols}"><div class="kel-empty">Data belum bisa ditampilkan.</div></td></tr>`; foot.innerHTML = ''; return; }
  if (busy) { tbody.innerHTML = `<tr><td colspan="${cols}"><div class="kel-empty">Memuat…</div></td></tr>`; foot.innerHTML = ''; return; }

  const rows = filtered();
  const shown = rows.slice(0, S.limit);
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="${cols}"><div class="kel-empty">${S.q ? 'Tidak ada yang cocok dengan pencarian.' : 'Tidak ada data untuk filter ini 🎉'}</div></td></tr>`;
  } else if (isKomp) {
    const max = (S.komponen[0] && S.komponen[0].set_terblokir) || 1;
    tbody.innerHTML = shown.map(k => {
      const a = k._alasan;
      return `<tr>
        <td class="kel-mono">${esc(k.kode_asli || '—')}</td>
        <td>${esc(k.nama_produk)}</td>
        <td class="kel-num">${k.kode_asli
          ? `<button type="button" class="kel-link" data-kel="blocked" data-kode="${esc(k.kode_asli)}" title="Lihat set yang terblokir komponen ini"><b>${fmtN(k.set_terblokir)}</b></button>`
          : `<b>${fmtN(k.set_terblokir)}</b>`}<span class="kel-bar"><i style="width:${Math.max(3, Math.round(k.set_terblokir / max * 100))}%"></i></span></td>
        <td><span class="kel-tag ${a.type === 'skip' ? 'skip' : a.type === 'mirip' ? 'mirip' : ''}">${esc(a.text)}</span></td>
      </tr>`;
    }).join('');
  } else {
    const STATUS = {
      READY: ['ok', 'Siap rakit'],
      INDENT: ['', 'Indent'],
      DATA_TIDAK_LENGKAP: ['skip', 'Data tidak lengkap']
    };
    tbody.innerHTML = shown.map(s => {
      const kode = s.bolong_kode || [], nama = s.bolong_nama || [];
      const st = STATUS[s.status] || ['', s.status || '-'];
      let detail;
      if (s.status === 'DATA_TIDAK_LENGKAP') {
        detail = '<ul class="kel-list">' + kode.map((c, i) =>
          `<li><button type="button" class="kel-link kel-mono" data-kel="blocked" data-kode="${esc(c)}" title="Cari set lain yang bolong di kode ini">${esc(c)}</button> · ${esc(nama[i] || '')}</li>`).join('') + '</ul>';
      } else {
        const n = s.buildable_qty;
        detail = `<span class="kel-muted">${s.status === 'INDENT' ? 'Stok komponen belum cukup' : 'Semua komponen cukup'}${n != null ? ` · bisa rakit ${fmtN(n)} set` : ''}</span>`;
      }
      return `<tr>
        <td class="kel-mono">${esc(s.kode_produk)}</td>
        <td>${esc(s.nama_produk)}</td>
        <td><span class="kel-tag ${st[0]}">${esc(st[1])}</span></td>
        <td class="kel-num">${fmtN(s.jumlah_terdata)}/${fmtN(s.jumlah_komponen)}</td>
        <td>${detail}</td>
      </tr>`;
    }).join('');
  }

  let note = '';
  if (isKomp && S.logMeta) {
    note = `Alasan dibaca dari upload terakhir: ${esc(S.logMeta.file || '-')} (${esc(fmtDate(S.logMeta.at))})`
      + (S.skip.partial ? ' — daftar kode ter-skip di log terpotong, sebagian komponen mungkin salah terbaca "Tidak ada di file stok".' : '.');
  }
  foot.innerHTML = `<span>Menampilkan ${fmtN(shown.length)} dari ${fmtN(rows.length)}${note ? ' · ' + note : ''}</span>`
    + (rows.length > shown.length ? `<button class="mini-btn" data-kel="more">Tampilkan ${fmtN(Math.min(PAGE_STEP, rows.length - shown.length))} lagi</button>` : '');
}

// ───────── export ─────────
function tableData(rows) {
  if (S.tab === 'komponen') {
    return {
      name: 'komponen-bolong',
      widths: [18, 60, 14, 48],
      aoa: [['Kode Asli', 'Nama Komponen', 'Set Terblokir', 'Alasan']].concat(
        rows.map(k => [String(k.kode_asli || ''), String(k.nama_produk || ''), Number(k.set_terblokir) || 0, k._alasan.text]))
    };
  }
  const label = { READY: 'Siap rakit', INDENT: 'Indent', DATA_TIDAK_LENGKAP: 'Data tidak lengkap' };
  return {
    name: 'daftar-set',
    widths: [24, 50, 18, 12, 10, 10, 14, 40, 70],
    aoa: [['Kode Set', 'Nama Set', 'Status', 'Jumlah Komponen', 'Terdata', 'Bolong', 'Bisa Rakit (set)', 'Kode Komponen Bolong', 'Nama Komponen Bolong']].concat(
      rows.map(s => [String(s.kode_produk || ''), String(s.nama_produk || ''), label[s.status] || String(s.status || ''),
        Number(s.jumlah_komponen) || 0, Number(s.jumlah_terdata) || 0, Number(s.jumlah_bolong) || 0,
        s.buildable_qty == null ? '' : Number(s.buildable_qty),
        (s.bolong_kode || []).join('; '), (s.bolong_nama || []).join('; ')]))
  };
}

// Rapikan sel buat TSV/CSV: tab & newline → spasi (biar baris gak pecah),
// awalan = + - @ diberi ' (cegah dieksekusi sebagai formula di Sheets/Excel).
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
    flash(btn, ok ? `<i class="ti ti-check"></i>${fmtN(rows.length)} baris tersalin` : 'Gagal menyalin');
  } else if (kind === 'codes') {
    const kode = rows.map(k => k.kode_asli).filter(Boolean);
    const ok = await copyText(kode.join('\n'));
    flash(btn, ok ? `<i class="ti ti-check"></i>${fmtN(kode.length)} kode tersalin` : 'Gagal menyalin');
  } else if (kind === 'csv') {
    download(new Blob(['\uFEFF' + toCSV(aoa)], { type: 'text/csv;charset=utf-8;' }), file + '.csv');
  } else if (kind === 'xlsx') {
    if (!window.XLSX) { flash(btn, 'Library .xlsx belum siap'); return; }
    const X = window.XLSX;
    const ws = X.utils.aoa_to_sheet(aoa); // string tetap sel teks → kode gak ke-convert jadi tanggal/angka
    ws['!cols'] = widths.map(w => ({ wch: w }));
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws, 'Data');
    X.writeFile(wb, file + '.xlsx');
  }
}

// ───────── events ─────────
// Satu pintu buat semua perubahan tab/filter/pencarian (kartu, tab, tautan silang).
function go({ tab, fSet, fKomp, q }) {
  if (tab) S.tab = tab;
  if (fSet !== undefined) S.fSet = fSet;
  if (fKomp !== undefined) S.fKomp = fKomp;
  if (q !== undefined) S.q = q;
  S.limit = PAGE_STEP;
  renderStats(); renderTabs(); syncToolbar();
  if (S.tab === 'set') ensureSets();
  renderList();
}

const STAT_TARGET = {
  total:  { tab: 'set', fSet: 'all' },
  ready:  { tab: 'set', fSet: 'READY' },
  indent: { tab: 'set', fSet: 'INDENT' },
  tl:     { tab: 'set', fSet: 'TL' },
  komp:   { tab: 'komponen', fKomp: 'all' }
};

function onClick(e) {
  const t = e.target.closest('[data-kel]');
  if (!t || !S) return;
  const act = t.dataset.kel;
  if (act === 'stat') {
    // pindah ke daftar yang dituju; pencarian lama dibersihkan biar hasilnya sesuai angka di kartu
    go(Object.assign({ q: '' }, STAT_TARGET[t.dataset.stat]));
  } else if (act === 'blocked') {
    go({ tab: 'set', fSet: 'TL', q: t.dataset.kode });
  } else if (act === 'tab') {
    go({ tab: t.dataset.tab });
  } else if (act === 'refresh') {
    loadAll();
  } else if (act === 'more') {
    S.limit += PAGE_STEP; renderList();
  } else if (act === 'copy' || act === 'xlsx' || act === 'csv' || act === 'codes') {
    doExport(act, t);
  }
}
function onInput(e) {
  if (!S || !e.target.matches('[data-kel="q"]')) return;
  S.q = e.target.value; S.limit = PAGE_STEP; renderList();
}
function onChange(e) {
  if (!S || !e.target.matches('[data-kel="filter"]')) return;
  if (S.tab === 'komponen') S.fKomp = e.target.value; else S.fSet = e.target.value;
  S.limit = PAGE_STEP; renderStats(); renderList();
}

// ───────── lifecycle ─────────
export function mountKelengkapan({ supabaseUrl, anonKey }) {
  const host = document.getElementById('kelengkapan-card');
  if (!host) return;
  if (!document.getElementById(STYLE_ID)) {
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  S = {
    url: supabaseUrl, key: anonKey, host,
    tab: 'komponen', q: '', fKomp: 'all', fSet: 'TL1', limit: PAGE_STEP,
    counts: null, komponen: null, sets: null, setsLoading: false,
    skip: buildSkipIndex(null), logMeta: null,
    loading: true, error: null, warn: null
  };
  host.innerHTML = SHELL;
  host.addEventListener('click', onClick);
  host.addEventListener('input', onInput);
  host.addEventListener('change', onChange);
  loadAll();
}

export function refreshKelengkapan() {
  if (S) loadAll();
}

export function unmountKelengkapan() {
  document.getElementById(STYLE_ID)?.remove();
  S = null; // callback async yang masih jalan otomatis di-abaikan (cek S !== ctx)
}