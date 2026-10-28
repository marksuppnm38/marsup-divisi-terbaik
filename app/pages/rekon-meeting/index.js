// rekon-meeting page module: mount(container) / unmount().
//
// ALAT BANTU MANDIRI — bukan bagian dari alur Konversi:
//   input  : recap meeting (.xlsx) yang diunggah user (dibaca di browser, tidak dikirim ke mana pun)
//   proses : baca sesi_konversi / konversi_record / sph_records (HANYA GET), cocokkan, hitung selisih
//   output : layar rekonsiliasi + laporan.xlsx
// Tidak ada tabel baru, tidak ada tulis ke database. Satu-satunya yang disimpan: koreksi user
// (kata kunci, centang sesi, penjelasan) di localStorage browser ini, itu pun opsional.
// Dibuang total = hapus folder ini + 3 baris (router.js ROUTES, home/markup.js MODULES, nav-markup.js NAV_ICONS).
//
// Logika ada di core.js (murni, bisa diuji di Node). File ini cuma DOM + fetch + export.
// Pola mount/auth/vendor-load disalin dari app/pages/stok/index.js: router.js baru mount() setelah
// shared/auth-gate.js memastikan sesi valid + whitelisted, jadi di sini PNMAuth sudah pasti ada.

import { RK_MARKUP } from './markup.js';
import * as C from './core.js';

const VENDOR_CHAIN = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  '/shared/supabase-client.js',
  '/shared/auth-session.js',
];
const INDEPENDENT_SCRIPTS = ['https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'];
const SHARED_LINKS = [
  { id: 'shared-google-fonts', href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400&display=swap' },
  { id: 'shared-tabler-icons', href: 'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.31.0/dist/tabler-icons.min.css' },
  { id: 'shared-pnm-universal-css', href: '/pnm-universal.css?v=20260813b' },
];

const SRI_BY_SRC = {
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js':
    'sha384-vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw',
};

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    if (SRI_BY_SRC[src]) { s.integrity = SRI_BY_SRC[src]; s.crossOrigin = 'anonymous'; } // SRI: browser tolak file yang byte-nya beda
    s.src = src; s.onload = () => resolve(); s.onerror = () => reject(new Error('Gagal memuat ' + src));
    document.head.appendChild(s);
  });
}
let vendorReady = null;
function ensureVendorScripts() {
  if (window.PNMAuth && window.pnmSupabase && window.XLSX) return Promise.resolve();
  if (!vendorReady) {
    const chain = VENDOR_CHAIN.reduce((p, src) => p.then(() => loadScript(src)), Promise.resolve());
    vendorReady = Promise.all([chain, ...INDEPENDENT_SCRIPTS.map(loadScript)]).catch((e) => { vendorReady = null; throw e; });
  }
  return vendorReady;
}
function loadLink(id, href) {
  if (document.getElementById(id)) return Promise.resolve();
  return new Promise((resolve) => {
    const l = document.createElement('link');
    l.id = id; l.rel = 'stylesheet'; l.href = href; l.onload = () => resolve(); l.onerror = () => resolve();
    document.head.appendChild(l);
  });
}
const ensureStyle = () => Promise.all([
  ...SHARED_LINKS.map(({ id, href }) => loadLink(id, href)),
  loadLink('page-rekon-meeting-style', new URL('./style.css', import.meta.url).href),
]);

// ── state ───────────────────────────────────────────────────────────────────
const LS_KEY = 'pnm_rekon_meeting_koreksi_v1';
const MAX_FILE = 10 * 1024 * 1024;
let root = null;
let S = null;

const $ = (sel) => root && root.querySelector(sel);
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function freshState() {
  return {
    fileName: null, parsed: null, sysLoadedAt: null, sessions: null, analysis: null,
    ov: loadOv(), tim: {}, belumHari: 60, belumMin: 100_000_000, belumRekanan: true,
    tab: 'rekon', filter: 'all', sort: 'recap', q: '', open: new Set(), busy: false,
  };
}
function loadOv() {
  try { const o = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); return { kw: {}, inc: {}, hit: {}, pen: {}, ...o }; } catch { return { kw: {}, inc: {}, hit: {}, pen: {} }; }
}
function saveOv() { try { localStorage.setItem(LS_KEY, JSON.stringify(S.ov)); } catch { /* private mode / kuota: abaikan, bukan blocking */ } }

// ── data sistem (HANYA GET) ─────────────────────────────────────────────────
async function sbAll(path) {
  const url = window.PNM_SUPABASE_URL, key = window.PNM_SUPABASE_ANON_KEY, out = [];
  for (let off = 0; off < 10000; off += 1000) {
    const token = await window.PNMAuth.getAccessToken();
    const res = await fetch(`${url}/rest/v1/${path}&limit=1000&offset=${off}`, { headers: { apikey: key, Authorization: 'Bearer ' + token } });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.message || `Gagal membaca ${path.split('?')[0]} (HTTP ${res.status})`);
    }
    const part = await res.json();
    out.push(...part);
    if (part.length < 1000) break;
  }
  return out;
}
async function loadSystem() {
  const [sesi, recs, sphs] = await Promise.all([
    sbAll('sesi_konversi?select=id,nama_rs,nama_sales,hasil_order,status,updated_at,created_at&status=eq.selesai&order=updated_at.desc'),
    sbAll('konversi_record?select=sesi_id,grand_total,revisi,kategori&sesi_id=not.is.null&order=id.asc'),
    sbAll('sph_records?select=id,no_sph,customer,pic_sales,total_value,sesi_id,revisi,created_at&sesi_id=not.is.null&order=id.asc'),
  ]);
  S.sessions = C.prepareSessions(sesi, recs, sphs);
  S.sysLoadedAt = new Date();
  S.sysCounts = { sesi: sesi.length, rec: recs.length, sph: sphs.length };
}

// ── alur utama ──────────────────────────────────────────────────────────────
async function handleFile(file) {
  if (!file) return;
  if (!/\.(xlsx|xlsm|xls)$/i.test(file.name)) return setStatus('error', 'File harus berformat Excel (.xlsx).');
  if (file.size > MAX_FILE) return setStatus('error', `File terlalu besar (${(file.size / 1048576).toFixed(1)} MB). Maksimal 10 MB.`);
  try {
    setStatus('busy', 'Membaca recap…');
    const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const sheets = wb.SheetNames.map((name) => ({ name, rows: window.XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null }) }));
    const parsed = C.parseRecap(sheets);
    if (!parsed.prospects.length) return setStatus('error', parsed.warnings.join(' ') || 'Tidak ada baris prospek yang terbaca.');
    S.fileName = file.name; S.parsed = parsed;
    const tims = [...new Set(parsed.prospects.map((p) => p.tim))];
    S.tim = {}; tims.forEach((t) => { S.tim[t] = tims.includes('Samaya') ? t === 'Samaya' : true; });
    S.open = new Set(); S.filter = 'all'; S.q = ''; S.tab = 'rekon';
    if (!S.sessions) { setStatus('busy', 'Membaca data sistem (hanya baca)…'); await loadSystem(); }
    recompute();
  } catch (err) {
    console.error('[rekon-meeting]', err);
    setStatus('error', 'Gagal: ' + (err && err.message ? err.message : err));
  }
}
async function reloadSystem() {
  if (!S.parsed) return;
  try { setStatus('busy', 'Memuat ulang data sistem…'); await loadSystem(); recompute(); }
  catch (err) { setStatus('error', 'Gagal memuat data sistem: ' + err.message); }
}
function recompute() {
  S.analysis = C.analyze(S.parsed.prospects, S.sessions, S.ov, {
    today: new Date(),
    timDibandingkan: Object.keys(S.tim).filter((t) => S.tim[t]).map((t) => t.toLowerCase()),
    belumDibahasHari: S.belumHari, belumDibahasMinNilai: S.belumMin,
  });
  renderAll();
}

// ── render ──────────────────────────────────────────────────────────────────
function setStatus(kind, msg, extraHtml = '') {
  const el = $('#rkStatus'); if (!el) return;
  el.hidden = false;
  el.className = 'rk-status' + (kind === 'error' ? ' is-error' : kind === 'busy' ? ' is-busy' : '');
  el.innerHTML = (kind === 'busy' ? '<i class="ti ti-loader-2"></i> ' : kind === 'error' ? '<i class="ti ti-alert-triangle"></i> ' : '') + esc(msg) + extraHtml;
}
function renderAll() {
  const drop = $('#rkDrop'); drop.classList.add('is-compact');
  const m = S.parsed.meetingDate;
  setStatus('ok', '', '');
  $('#rkStatus').innerHTML =
    `<span><i class="ti ti-file-spreadsheet"></i> <b>${esc(S.fileName)}</b></span>` +
    `<span>Meeting: <b>${m ? C.fmtTgl(m) : 'tanggal tak terbaca'}</b></span>` +
    `<span>${S.parsed.prospects.length} prospek · sheet “${esc(S.parsed.sheetDipakai.join(', '))}”</span>` +
    `<span>Sistem: ${S.sysCounts.sesi} sesi selesai · ${S.sysCounts.rec} record · ${S.sysCounts.sph} SPH (dibaca ${S.sysLoadedAt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })})</span>` +
    `<span class="rk-sp"></span>` +
    `<button class="rk-btn" type="button" data-act="reload"><i class="ti ti-refresh"></i> Muat ulang data sistem</button>` +
    `<button class="rk-btn" type="button" data-act="pick"><i class="ti ti-upload"></i> Ganti file</button>`;
  $('#rkBody').hidden = false;
  $('#rkExport').disabled = false;
  renderTools(); renderSummary(); renderTabs(); renderPane();
}
function renderTools() {
  const tims = Object.keys(S.tim);
  $('#rkTools').innerHTML = `<span><b>Bandingkan tim:</b></span>` + tims.map((t) => {
    const nSistem = t === 'Samaya';
    return `<label class="rk-check"><input type="checkbox" data-tim="${esc(t)}" ${S.tim[t] ? 'checked' : ''}> ${esc(t)}` +
      `${nSistem ? '' : ' <small>(datanya belum dikumpulkan di sistem ini)</small>'}</label>`;
  }).join('');
}
function renderSummary() {
  const s = S.analysis.summary;
  const card = (k, v, sub, cls = '') => `<div class="rk-card ${cls}"><div class="rk-k">${k}</div><div class="rk-v">${v}</div>${sub ? `<div class="rk-s">${sub}</div>` : ''}</div>`;
  $('#rkSummary').innerHTML =
    card('Kata meeting', C.fmtRp(s.nilaiMeeting), `${s.dibandingkan} prospek dibandingkan`) +
    card('Kata data', C.fmtRp(s.nilaiSistem), 'jumlah sesi tertaut') +
    card('Klop', s.klop, 'tidak ada selisih', 'is-ok') +
    card('Ada selisih', s.selisih, 'nilai, PIC, atau target', s.selisih ? 'is-warn' : '') +
    card('Tanpa jejak', s.tanpaJejak, 'tak ada di sistem', s.tanpaJejak ? 'is-bad' : '') +
    card('Belum dibahas', s.belumDibahas, `${C.fmtRp(s.nilaiBelumDibahas)} di sistem`, s.belumDibahas ? 'is-warn' : '') +
    (s.tidakDibandingkan ? card('Tidak dibandingkan', s.tidakDibandingkan, `${C.fmtRp(s.nilaiTidakDibandingkan)} (tim lain)`) : '');
}
function renderTabs() {
  const s = S.analysis.summary;
  const t = (id, label, n) => `<button class="rk-tab ${S.tab === id ? 'is-active' : ''}" role="tab" data-act="tab" data-v="${id}">${label}<span class="rk-n">${n}</span></button>`;
  $('#rkTabs').innerHTML = t('rekon', 'Meeting vs sistem', s.dibandingkan) + t('belum', 'Ada di sistem, tak dibahas', s.belumDibahas);
}
function renderPane() {
  const pane = $('#rkPane');
  if (S.tab === 'belum') {
    const opt = (v, cur, label) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${label}</option>`;
    pane.innerHTML =
      `<div class="rk-bar">` +
      `<label>Aktif dalam <select class="rk-sel" data-belum="hari">${[30, 60, 90, 180].map((v) => opt(v, S.belumHari, v + ' hari terakhir')).join('')}</select></label>` +
      `<label>Nilai minimal <select class="rk-sel" data-belum="min">${[50, 100, 250, 500].map((v) => opt(v * 1e6, S.belumMin, 'Rp ' + v + ' jt')).join('')}</select></label>` +
      `<label class="rk-check"><input type="checkbox" data-belum="rekanan" ${S.belumRekanan ? 'checked' : ''}> tampilkan sesi atas nama rekanan</label>` +
      `</div><div id="rkList"></div>`;
    return renderBelum();
  }
  const f = (id, label) => `<button class="rk-pill ${S.filter === id ? 'is-active' : ''}" data-act="filter" data-v="${id}">${label}</button>`;
  const s = S.analysis.summary;
  pane.innerHTML =
    `<div class="rk-bar">` +
    f('all', `Semua ${s.dibandingkan}`) + f('selisih', `Ada selisih ${s.selisih}`) + f('cek', `Perlu dicek ${s.cek}`) + f('klop', `Klop ${s.klop}`) +
    `<input class="rk-input rk-grow" id="rkSearch" type="search" placeholder="Cari instansi, PIC, atau item…" value="${esc(S.q)}" autocomplete="off">` +
    `<select class="rk-sel" id="rkSort"><option value="recap" ${S.sort === 'recap' ? 'selected' : ''}>Urutan recap</option>` +
    `<option value="masalah" ${S.sort === 'masalah' ? 'selected' : ''}>Paling bermasalah dulu</option>` +
    `<option value="nilai" ${S.sort === 'nilai' ? 'selected' : ''}>Nilai meeting terbesar</option></select>` +
    `</div><div id="rkList" class="rk-list"></div>`;
  renderList();
}

const VERDICT_LABEL = { klop: 'Klop', info: 'Perlu dicek', warn: 'Ada selisih', bad: 'Selisih besar' };
const SEV = { bad: 3, warn: 2, info: 1, klop: 0 };

function renderList() {
  const el = $('#rkList'); if (!el) return;
  const q = S.q.trim().toLowerCase();
  let rows = S.analysis.results.filter((r) => r.dibandingkan);
  rows = rows.filter((r) => {
    if (S.filter === 'selisih' && !(r.verdict === 'warn' || r.verdict === 'bad')) return false;
    if (S.filter === 'cek' && r.verdict !== 'info') return false;
    if (S.filter === 'klop' && r.verdict !== 'klop') return false;
    return !q || [r.p.instansi, r.p.pic, r.p.item, r.p.mitra].join(' ').toLowerCase().includes(q);
  });
  const idx = new Map(S.analysis.results.map((r, i) => [r, i]));
  if (S.sort === 'masalah') rows.sort((a, b) => SEV[b.verdict] - SEV[a.verdict] || b.p.nilai - a.p.nilai);
  else if (S.sort === 'nilai') rows.sort((a, b) => b.p.nilai - a.p.nilai);
  else rows.sort((a, b) => idx.get(a) - idx.get(b));
  el.innerHTML = rows.length ? rows.map(rowHtml).join('') : `<div class="rk-empty">Tidak ada prospek yang cocok dengan filter ini.</div>`;
}

function rowHtml(r) {
  const p = r.p, open = S.open.has(p.key);
  const label = r.chips.some((c) => c.id === 'tanpa-jejak') ? 'Tanpa jejak' : VERDICT_LABEL[r.verdict];
  let diff = '<div class="rk-diff">—</div>';
  if (r.selisihPct != null) {
    const a = Math.abs(r.selisihPct), cls = a <= C.DEFAULTS.nilaiTolPct ? 'is-ok' : a > 100 ? 'is-bad' : 'is-warn';
    diff = `<div class="rk-diff ${cls}">${r.selisihPct > 0 ? '+' : ''}${r.selisihPct.toFixed(0)}%<small>${esc(C.fmtSigned(r.selisih))}</small></div>`;
  }
  const sys = r.tertaut.length
    ? `<div class="rk-big" title="${esc(r.nilaiSum == null ? '' : 'Rp ' + r.nilaiSum.toLocaleString('id-ID'))}">${C.fmtRp(r.nilaiSum)}</div>` +
      `<div class="rk-sub"><span class="rk-st rk-st-${r.statusSistem}">${esc(C.STATUS_LABEL[r.statusSistem])}</span>` +
      `<span>${r.tertaut.length} sesi${r.nSph ? ` · ${r.nSph} SPH` : ''}</span><span>update ${esc(C.fmtTgl(r.update))}</span></div>` +
      (r.nilaiMax != null && r.tertaut.length > 1 ? `<div class="rk-quote">sesi terbesar ${C.fmtRp(r.nilaiMax)}</div>` : '')
    : `<div class="rk-big">—</div><div class="rk-sub">${r.cands.length ? `${r.cands.length} sesi mirip, belum ditautkan` : 'tidak ada sesi yang cocok'}</div>`;
  const why = r.chips.map((c) => `<div class="rk-why-i"><span class="rk-chip l-${c.level}">${esc(c.label)}</span><span>${esc(c.detail)}</span></div>`).join('');
  return `<article class="rk-row v-${r.verdict}" data-key="${esc(p.key)}">
    <div class="rk-row-h">
      <div class="rk-title"><span class="rk-no">${esc(p.tim)}${p.ta ? ' · TA ' + p.ta : ''}</span><strong>${esc(p.instansi)}</strong><span class="rk-pic">${esc(p.pic || '—')}</span></div>
      <span class="rk-verdict">${esc(label)}</span>
    </div>
    <div class="rk-cols">
      <div><div class="rk-lbl">Kata meeting</div><div class="rk-big" title="Rp ${p.nilai.toLocaleString('id-ID')}">${C.fmtRp(p.nilai)}</div>
        <div class="rk-sub"><span>Target klik: ${esc(p.est || '—')}</span></div>
        ${p.status ? `<div class="rk-quote">“${esc(p.status)}”</div>` : ''}</div>
      <div><div class="rk-lbl">Kata data</div>${sys}</div>
      ${diff}
    </div>
    ${why ? `<div class="rk-why">${why}</div>` : ''}
    ${r.nilaiNote ? `<div class="rk-note-ok"><i class="ti ti-info-circle"></i> ${esc(r.nilaiNote)}</div>` : ''}
    ${r.penjelasan && !open ? `<div class="rk-note-ok"><i class="ti ti-message"></i> Penjelasan: ${esc(r.penjelasan)}</div>` : ''}
    <div class="rk-more"><button class="rk-link" type="button" data-act="toggle" data-key="${esc(p.key)}">${open ? 'Tutup detail' : 'Detail, tautan sesi, dan penjelasan'}</button></div>
    ${open ? detailHtml(r) : ''}
  </article>`;
}

function detailHtml(r) {
  const p = r.p, key = esc(p.key);
  const manual = S.ov.kw[p.key];
  const kwVal = manual != null && String(manual).trim() ? manual : C.keywordLabel(C.autoKeywords(p.instansi));
  const cands = r.cands.map((c) => {
    const s = c.s, off = !c.include;
    const tags = [`<span class="rk-tag ${c.conf === 'tinggi' ? 't-hi' : c.conf === 'rendah' ? 't-lo' : ''}">cocok ${esc(c.conf)}</span>`];
    if (s.kind === 'pricelist') tags.push('<span class="rk-tag t-lo">pricelist / cek stok</span>');
    else if (s.kind === 'rekanan') tags.push('<span class="rk-tag">atas nama rekanan</span>');
    if (c.dobel) tags.push(`<span class="rk-tag t-lo">dipakai: ${esc(c.dobel)}</span>`);
    if (s.nSph) tags.push(`<span class="rk-tag">${s.nSph} SPH${s.noSph ? ' · ' + esc(s.noSph) : ''}</span>`);
    return `<tr class="${off ? 'is-off' : ''}">
      <td><input type="checkbox" data-inc data-key="${key}" data-sid="${esc(s.id)}" ${c.include ? 'checked' : ''} aria-label="Tautkan sesi"></td>
      <td><input type="checkbox" data-hit data-key="${key}" data-sid="${esc(s.id)}" ${c.hitung ? 'checked' : ''} ${c.include ? '' : 'disabled'} aria-label="Ikut dihitung"></td>
      <td class="nm">${esc(s.nama)}<div>${tags.join('')}</div></td>
      <td>${esc(s.sales || '—')}</td>
      <td><span class="rk-st rk-st-${s.status}">${esc(C.STATUS_LABEL[s.status])}</span></td>
      <td class="num">${s.nilai != null ? C.fmtRp(s.nilai) + `<div class="rk-hint">${esc(s.nilaiSumber)}</div>` : '—'}</td>
      <td class="num">${esc(C.fmtTgl(s.updated))}</td></tr>`;
  }).join('');
  return `<div class="rk-detail">
    <div><h4>Kata kunci pencarian sesi</h4>
      <div class="rk-kwrow"><input class="rk-input" data-kw data-key="${key}" value="${esc(kwVal)}" placeholder="mis. gmm, global mitra" autocomplete="off">
        <button class="rk-btn" type="button" data-act="kw" data-key="${key}">Cari ulang</button>
        <button class="rk-link" type="button" data-act="reset" data-key="${key}">Kembalikan ke otomatis</button></div>
      <div class="rk-hint">${r.kwManual ? 'Memakai kata kunci buatanmu.' : 'Otomatis dari nama instansi.'} Pisahkan dengan koma; kata dalam satu item harus muncul bersamaan.${
        !r.kwManual && r.kw.sec && r.kw.sec.length ? ` Kata di dalam tanda kurung (${esc(r.kw.sec.map((k) => k.alts[0]).join(', '))}) dipakai sebagai cadangan, hanya kalau nama utamanya sama sekali tidak ada di sistem.` : ''}</div></div>
    <div><h4>Sesi di sistem yang mirip (${r.cands.length})</h4>
      ${r.cands.length ? `<div class="rk-tblwrap"><table class="rk-tbl"><thead><tr><th>Tautkan</th><th>Hitung</th><th>Nama di sistem</th><th>Sales</th><th>Status</th><th class="num">Nilai</th><th class="num">Update</th></tr></thead><tbody>${cands}</tbody></table></div>
      <div class="rk-hint">“Hitung” = ikut dijumlah ke nilai sistem. Iterasi bernama sama otomatis hanya diambil yang terbaru. Nilai = SPH terbaru, kalau tak ada pakai record terbaru.</div>` : '<div class="rk-empty">Tidak ada sesi yang cocok. Coba kata kunci lain di atas.</div>'}</div>
    <div><h4>Penjelasan selisih (ikut ke laporan.xlsx)</h4>
      <textarea class="rk-area" data-pen data-key="${key}" placeholder="mis. nilai di meeting sudah termasuk tambahan paket dari negosiasi offline">${esc(r.penjelasan)}</textarea></div>
  </div>`;
}

function renderBelum() {
  const el = $('#rkList'); if (!el) return;
  const rows = S.analysis.belum.filter((b) => S.belumRekanan || b.kind !== 'rekanan');
  if (!rows.length) { el.innerHTML = `<div class="rk-empty">Tidak ada sesi yang memenuhi batas ini di luar prospek yang dibahas.</div>`; return; }
  el.innerHTML = `<div class="rk-hint" style="margin-bottom:8px">Sesi selesai di sistem, nilainya besar, aktif belakangan ini, tapi tidak cocok dengan prospek mana pun di recap. Nama sesi yang sama digabung (iterasi). Sesi atas nama rekanan belum diketahui RS tujuannya.</div>
  <div class="rk-tblwrap"><table class="rk-tbl"><thead><tr><th>#</th><th>Nama di sistem</th><th>Sales</th><th>Status</th><th class="num">Nilai</th><th class="num">Update</th><th class="num">Iterasi</th></tr></thead><tbody>` +
    rows.map((b, i) => `<tr><td>${i + 1}</td><td class="nm">${esc(b.nama)}<div>${b.kind === 'rekanan' ? '<span class="rk-tag">atas nama rekanan</span>' : ''}${b.nSph ? `<span class="rk-tag">${b.nSph} SPH${b.noSph ? ' · ' + esc(b.noSph) : ''}</span>` : ''}</div></td>
      <td>${esc(b.sales || '—')}</td><td><span class="rk-st rk-st-${b.status}">${esc(C.STATUS_LABEL[b.status])}</span></td>
      <td class="num">${C.fmtRp(b.nilai)}<div class="rk-hint">${esc(b.nilaiSumber)}</div></td><td class="num">${esc(C.fmtTgl(b.updated))}</td><td class="num">${b.iterasi}</td></tr>`).join('') +
    `</tbody></table></div>`;
}

// ── export ──────────────────────────────────────────────────────────────────
function exportXlsx() {
  if (!S.analysis) return;
  const rep = C.buildReport(S.analysis, S.parsed.meetingDate);
  const XL = window.XLSX, wb = XL.utils.book_new();
  const add = (name, aoa, widths) => { const ws = XL.utils.aoa_to_sheet(aoa); ws['!cols'] = widths.map((w) => ({ wch: w })); XL.utils.book_append_sheet(wb, ws, name); };
  add('Rekonsiliasi', rep.rekon, [4, 8, 6, 38, 16, 18, 20, 20, 16, 10, 14, 14, 24, 60, 60, 50, 40]);
  add('Belum Dibahas', rep.belum, [4, 44, 12, 12, 14, 16, 12, 14, 10, 22]);
  add('Ringkasan', rep.ringkasan, [34, 22]);
  const d = S.parsed.meetingDate || new Date();
  XL.writeFile(wb, `rekon-meeting-${d.toISOString().slice(0, 10)}.xlsx`);
}

// ── event ───────────────────────────────────────────────────────────────────
function findResult(key) { return S.analysis && S.analysis.results.find((r) => r.p.key === key); }
function applyKeywords(key) {
  const inp = root.querySelector(`[data-kw][data-key="${CSS.escape(key)}"]`); if (!inp) return;
  const v = inp.value.trim(), auto = C.keywordLabel(C.autoKeywords(findResult(key).p.instansi));
  if (!v || v === auto) delete S.ov.kw[key]; else S.ov.kw[key] = v;
  delete S.ov.inc[key]; delete S.ov.hit[key]; // kandidat berubah, pilihan lama tak relevan
  saveOv(); recompute();
}
function onClick(e) {
  const a = e.target.closest('[data-act]'); if (!a || !root.contains(a)) return;
  const act = a.dataset.act, key = a.dataset.key;
  if (act === 'pick') return $('#rkFile').click();
  if (act === 'reload') return reloadSystem();
  if (act === 'tab') { S.tab = a.dataset.v; renderTabs(); return renderPane(); }
  if (act === 'filter') { S.filter = a.dataset.v; renderPane(); return; }
  if (act === 'toggle') { S.open.has(key) ? S.open.delete(key) : S.open.add(key); return renderList(); }
  if (act === 'kw') return applyKeywords(key);
  if (act === 'reset') { delete S.ov.kw[key]; delete S.ov.inc[key]; delete S.ov.hit[key]; saveOv(); return recompute(); }
}
function onChange(e) {
  const t = e.target;
  if (t.id === 'rkFile') { const f = t.files && t.files[0]; t.value = ''; return handleFile(f); }
  if (t.dataset.tim != null) { S.tim[t.dataset.tim] = t.checked; return recompute(); }
  if (t.dataset.belum) {
    if (t.dataset.belum === 'hari') S.belumHari = +t.value; else if (t.dataset.belum === 'min') S.belumMin = +t.value; else S.belumRekanan = t.checked;
    return recompute();
  }
  if (t.id === 'rkSort') { S.sort = t.value; return renderList(); }
  if (t.dataset.inc != null || t.dataset.hit != null) {
    const bucket = t.dataset.inc != null ? 'inc' : 'hit', key = t.dataset.key;
    (S.ov[bucket][key] = S.ov[bucket][key] || {})[t.dataset.sid] = t.checked;
    saveOv(); return recompute();
  }
  if (t.dataset.pen != null) {
    const key = t.dataset.key, v = t.value.trim();
    if (v) S.ov.pen[key] = v; else delete S.ov.pen[key];
    const r = findResult(key); if (r) r.penjelasan = v; // tanpa recompute: jaga fokus ketikan
    saveOv();
  }
}
function onInput(e) { if (e.target.id === 'rkSearch') { S.q = e.target.value; renderList(); } }
function onKeydown(e) { if (e.key === 'Enter' && e.target.dataset && e.target.dataset.kw != null) { e.preventDefault(); applyKeywords(e.target.dataset.key); } }

// ── mount / unmount ─────────────────────────────────────────────────────────
export async function mount(container) {
  root = container;
  await Promise.all([ensureStyle(), ensureVendorScripts()]);
  root.classList.add('rk-page');
  root.innerHTML = RK_MARKUP;
  S = freshState();

  // jaga-jaga flash tema salah kalau halaman ini yang pertama ke-mount (pola sama kayak stok/dashboard)
  (function () {
    const saved = localStorage.getItem('theme');
    const theme = saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.style.colorScheme = theme;
  })();

  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  root.addEventListener('input', onInput);
  root.addEventListener('keydown', onKeydown);
  $('#rkExport').addEventListener('click', exportXlsx);
  const drop = $('#rkDrop');
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('is-over'); }));
  drop.addEventListener('drop', (e) => handleFile(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]));
}

export function unmount() {
  if (root) {
    root.removeEventListener('click', onClick);
    root.removeEventListener('change', onChange);
    root.removeEventListener('input', onInput);
    root.removeEventListener('keydown', onKeydown);
    root.classList.remove('rk-page');
  }
  document.getElementById('page-rekon-meeting-style')?.remove();
  root = null; S = null;
}
