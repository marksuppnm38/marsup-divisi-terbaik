// uploader-wiki page module: mount(container) / unmount().
// Membangun MASTER.xlsx (peta untuk script Tampermonkey "INAPROC Upload Produk V6") dari Supabase.
// Logika baris ada di build.js (murni, dites di tests/uploader-wiki.test.mjs); file ini hanya UI + fetch + download.

import { UPLOADER_WIKI_MARKUP } from './markup.js';
import { buildRow, splitBatches, derivePairs, toAoa, collapse } from './build.js';

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const VENDOR_SCRIPTS = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  '/shared/supabase-client.js',
  '/shared/auth-session.js',
];
const LIB_XLSX = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
const LIB_JSZIP = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';

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
    vendorReady = VENDOR_SCRIPTS.reduce((chain, src) => chain.then(() => loadScript(src)), Promise.resolve());
  }
  return vendorReady;
}
function ensureStyle() {
  return new Promise((resolve) => {
    if (document.getElementById('page-uploader-wiki-style')) return resolve();
    const link = document.createElement('link');
    link.id = 'page-uploader-wiki-style';
    link.rel = 'stylesheet';
    link.href = new URL('./style.css', import.meta.url).href;
    link.onload = () => resolve();
    link.onerror = () => resolve();
    document.head.appendChild(link);
  });
}

let isMounted = false;
let mountedContainer = null;
let clickHandler = null;
let inputHandler = null;

const PAGE = 1000;
// Baca semua baris (PostgREST membatasi 1000/permintaan).
async function fetchAll(makeQuery) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await makeQuery().range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}
async function fetchIn(table, select, column, values, size = 150) {
  const out = [];
  for (let i = 0; i < values.length; i += size) {
    const chunk = values.slice(i, i + size);
    const rows = await fetchAll(() => window.pnmSupabase.from(table).select(select).in(column, chunk).order(column));
    out.push(...rows);
  }
  return out;
}

export async function mount(container) {
  isMounted = true;
  mountedContainer = container;
  container.innerHTML = UPLOADER_WIKI_MARKUP;
  await Promise.all([ensureStyle(), ensureVendorScripts()]);
  if (!isMounted) return;

  const $ = (id) => container.querySelector(`#${id}`);
  const sb = () => window.pnmSupabase;
  const S = { produk: [], pickInaproc: new Set(), pickV6: new Set(), filtered: [], built: null, seed: null };

  async function getSeed() {
    if (S.seed) return S.seed;
    const res = await fetch(new URL('./seed.json', import.meta.url));
    if (!res.ok) throw new Error('seed.json tidak bisa dimuat');
    S.seed = await res.json();
    S.seed.pairs = derivePairs(S.seed);
    return S.seed;
  }

  function counts(values) {
    const m = new Map();
    values.forEach((v) => { const k = v == null || v === '' ? '(kosong)' : String(v); m.set(k, (m.get(k) || 0) + 1); });
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }
  function renderChips(el, entries, picked, group) {
    el.innerHTML = entries.map(([v, n]) =>
      `<span class="uw-chip${picked.has(v) ? ' on' : ''}" data-group="${group}" data-val="${escapeHtml(v)}">${escapeHtml(v)} · ${n}</span>`).join('');
  }
  function applyFilters() {
    const q = collapse($('uwSearch').value).toLowerCase();
    const val = (v) => (v == null || v === '' ? '(kosong)' : String(v));
    S.filtered = S.produk.filter((p) => {
      if (S.pickInaproc.size && !S.pickInaproc.has(val(p.status_inaproc))) return false;
      if (S.pickV6.size && !S.pickV6.has(val(p.status_v6))) return false;
      if (q && !`${p.kode_produk} ${p.nama_produk}`.toLowerCase().includes(q)) return false;
      return true;
    });
    $('uwFilterCount').textContent = `${S.filtered.length} dari ${S.produk.length} produk lolos filter.`;
    $('uwBuildCard').hidden = S.filtered.length === 0;
  }

  async function onLoad() {
    const btn = $('uwLoad');
    btn.disabled = true;
    $('uwLoadInfo').textContent = 'Memuat...';
    try {
      const onlyActive = $('uwActive').checked;
      const noLink = $('uwNoLink').checked;
      let rows = await fetchAll(() => {
        let q = sb().from('produk')
          .select('id,kode_produk,kode_asli,nama_produk,no_akd,berat_gram,status_inaproc,status_v6,link_v6,is_active')
          .order('kode_produk');
        if (onlyActive) q = q.eq('is_active', true);
        return q;
      });
      if (noLink) rows = rows.filter((p) => !collapse(p.link_v6));
      if (!isMounted) return;
      S.produk = rows;
      S.pickInaproc.clear();
      S.pickV6.clear();
      renderChips($('uwStatusInaproc'), counts(rows.map((p) => p.status_inaproc)), S.pickInaproc, 'inaproc');
      renderChips($('uwStatusV6'), counts(rows.map((p) => p.status_v6)), S.pickV6, 'v6');
      $('uwFilters').hidden = false;
      $('uwLoadInfo').textContent = `${rows.length} produk dimuat.`;
      applyFilters();
    } catch (e) {
      $('uwLoadInfo').textContent = 'Gagal: ' + e.message;
    } finally {
      btn.disabled = false;
    }
  }

  async function onBuild() {
    const btn = $('uwBuild');
    btn.disabled = true;
    try {
      const seed = await getSeed();
      const list = S.filtered.slice();
      const ids = list.map((p) => p.id);
      $('uwBuildInfo').textContent = 'Mengambil harga...';
      const hargaRows = await fetchIn('produk_harga', 'produk_id,tahun,jenis,harga', 'produk_id', ids);
      const hargaByProduk = new Map();
      hargaRows.forEach((r) => { if (!hargaByProduk.has(r.produk_id)) hargaByProduk.set(r.produk_id, []); hargaByProduk.get(r.produk_id).push(r); });

      // master_produk hanya dibutuhkan untuk SKU yang TIDAK ada di seed (kategori dari family).
      const unseeded = Array.from(new Set(list.filter((p) => !seed.rows[collapse(p.kode_produk)]).map((p) => collapse(p.kode_asli)).filter(Boolean)));
      $('uwBuildInfo').textContent = 'Mengambil family...';
      const masters = unseeded.length ? await fetchIn('master_produk', 'kode_asli,family,sub_family', 'kode_asli', unseeded) : [];
      const masterByKodeAsli = new Map(masters.map((m) => [m.kode_asli, m]));
      if (!isMounted) return;

      const ctx = { seed, hargaByProduk, masterByKodeAsli };
      const rows = []; const skipped = []; const flagged = [];
      list.forEach((p) => {
        const r = buildRow(p, ctx);
        if (!r.row) { skipped.push({ kode: r.kode || p.kode_produk || `(id ${p.id})`, why: r.skip.join('; ') }); return; }
        rows.push(r.row);
        r.flags.filter((f) => f.lvl === 'WARN').forEach((f) => flagged.push({ kode: r.kode, why: f.msg }));
      });

      const n = Math.max(1, Math.min(20, parseInt($('uwOps').value, 10) || 1));
      const names = $('uwNames').value.split(',').map((s) => collapse(s)).filter(Boolean);
      const d = new Date(); const pad = (x) => String(x).padStart(2, '0');
      const batchId = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
      const parts = splitBatches(rows, n);
      S.built = { seed, parts, names, batchId, skipped, flagged, total: rows.length };
      renderResult();
      $('uwBuildInfo').textContent = '';
    } catch (e) {
      $('uwBuildInfo').textContent = 'Gagal: ' + e.message;
    } finally {
      btn.disabled = false;
    }
  }

  function renderResult() {
    const b = S.built;
    $('uwResultCard').hidden = false;
    $('uwStats').innerHTML = [
      `${b.total} baris siap`, `${b.parts.length} file operator`, `${b.skipped.length} dilewati`, `${b.flagged.length} perlu dicek`, `batch ${b.batchId}`,
    ].map((t) => `<span class="stat-pill">${escapeHtml(t)}</span>`).join('');
    const block = (title, arr) => arr.length
      ? `<div class="uw-issues-title">${escapeHtml(title)} (${arr.length})</div><div class="uw-issues">${arr.slice(0, 200).map((x) => escapeHtml(`${x.kode}: ${x.why}`)).join('\n')}${arr.length > 200 ? `\n...dan ${arr.length - 200} lagi (lengkapnya di file laporan)` : ''}</div>`
      : '';
    $('uwIssues').innerHTML = block('Dilewati (tidak masuk MASTER)', b.skipped) + block('Perlu dicek manual', b.flagged);
  }

  function opLabel(i) { return (S.built.names[i] || `OP${i + 1}`); }
  function tsv(arr) { return ['kode\talasan'].concat(arr.map((x) => `${x.kode}\t${String(x.why).replace(/[\t\r\n]+/g, ' ')}`)).join('\n'); }
  function save(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  async function onDownload() {
    const b = S.built; if (!b) return;
    const btn = $('uwDownload'); btn.disabled = true;
    try {
      await Promise.all([loadScript(LIB_XLSX), loadScript(LIB_JSZIP)]);
      const files = b.parts.map((rows, i) => {
        const label = opLabel(i);
        const wb = window.XLSX.utils.book_new();
        const ws = window.XLSX.utils.aoa_to_sheet(toAoa(b.seed, rows, { operator: label, batchId: b.batchId }));
        ws['!cols'] = b.seed.headers.concat(['OPERATOR', 'BATCH_ID']).map((h) => ({ wch: Math.min(40, Math.max(12, h.length)) }));
        window.XLSX.utils.book_append_sheet(wb, ws, 'MASTER');   // nama sheet WAJIB "MASTER" (dicari script)
        const safe = label.replace(/[^A-Za-z0-9_-]+/g, '_');
        return { name: `MASTER-${safe}-${b.batchId}.xlsx`, data: window.XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) };
      });
      if (files.length === 1 && !b.skipped.length && !b.flagged.length) {
        save(new Blob([files[0].data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), files[0].name);
      } else {
        const zip = new window.JSZip();
        files.forEach((f) => zip.file(f.name, f.data));
        if (b.skipped.length) zip.file('DILEWATI.tsv', tsv(b.skipped));
        if (b.flagged.length) zip.file('PERLU_DICEK.tsv', tsv(b.flagged));
        save(await zip.generateAsync({ type: 'blob' }), `MASTER-${b.batchId}.zip`);
      }
      $('uwDownloadInfo').textContent = 'Selesai.';
    } catch (e) {
      $('uwDownloadInfo').textContent = 'Gagal: ' + e.message;
    } finally {
      btn.disabled = false;
    }
  }

  clickHandler = (ev) => {
    const chip = ev.target.closest('.uw-chip');
    if (chip) {
      const set = chip.dataset.group === 'v6' ? S.pickV6 : S.pickInaproc;
      const v = chip.dataset.val;
      if (set.has(v)) set.delete(v); else set.add(v);
      chip.classList.toggle('on');
      applyFilters();
      return;
    }
    const id = ev.target.closest('button')?.id;
    if (id === 'uwLoad') onLoad();
    else if (id === 'uwBuild') onBuild();
    else if (id === 'uwDownload') onDownload();
  };
  inputHandler = (ev) => { if (ev.target.id === 'uwSearch') applyFilters(); };
  container.addEventListener('click', clickHandler);
  container.addEventListener('input', inputHandler);
}

export function unmount() {
  isMounted = false;
  if (mountedContainer) {
    if (clickHandler) mountedContainer.removeEventListener('click', clickHandler);
    if (inputHandler) mountedContainer.removeEventListener('input', inputHandler);
  }
  clickHandler = null; inputHandler = null; mountedContainer = null;
  document.getElementById('page-uploader-wiki-style')?.remove();
}