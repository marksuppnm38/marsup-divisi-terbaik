// spek-maker/bulk-ui.js -- tab "Bulk" di Document Maker.
//
// Alur: tempel ratusan kode -> "Periksa" (data DB + cek gambar bucket, TANPA
// membuat PDF) -> daftar status per kode (siap / dilewati + alasan) ->
// "Proses" membuat PDF hanya untuk yang siap, dipecah jadi beberapa ZIP.
//
// Hemat memori: gambar TIDAK disimpan saat pemeriksaan (cuma dicek ada/tidaknya);
// gambar baru dimuat sesaat ketika PDF Spesifikasi dibuat, lalu dibuang.
// Dependensi umum disuntik dari index.js lewat `deps` (sama seperti tab lain).

import { buildSpekPdf, loadSpekFonts, fileSafeName } from './pdf.js';
import { buildStrukturPdf, loadStrukturFonts } from './struktur-pdf.js';
import { buatItem, periksaItem } from './struktur-harga.js';

const DESC_FIELD = 'nama_produk';
const DB_CHUNK = 50;        // kode per request ke database
const DB_CONCURRENCY = 3;
const IMG_CHECK_CONCURRENCY = 6;
const PDF_CONCURRENCY = 4;

const MARKUP = `
<div class="sm-bulk">
  <div class="card">
    <div class="card-head">
      <div class="icon-box orange"><i class="ti ti-stack-2"></i></div>
      <div class="card-head-text">
        <h2>Bulk</h2>
        <p>Tempel banyak kode sekaligus (mis. kolom KODE dari MASTER.xlsx). Diperiksa dulu, PDF hanya dibuat untuk yang siap.</p>
      </div>
    </div>
    <label class="field-label" for="bkCodes">Kode <span class="sm-field-hint">satu per baris, tanpa batas</span></label>
    <textarea id="bkCodes" class="field-input sm-textarea" style="min-height:140px" placeholder="RBB-KEC-B076-U1R&#10;RBB-KEC-B077-U1R" aria-label="Kode produk, satu per baris"></textarea>
    <div class="sm-bulk-types">
      <label class="sm-bulk-check"><input type="checkbox" id="bkSpek" checked> Spesifikasi <span class="sm-field-hint">butuh gambar</span></label>
      <label class="sm-bulk-check"><input type="checkbox" id="bkStruktur" checked> Struktur Harga</label>
    </div>
    <div class="sm-actions sm-mt-16">
      <span id="bkStatus" class="sm-status"></span>
      <button id="bkCheckBtn" type="button" class="btn btn-accent" data-bk="check"><i class="ti ti-search" aria-hidden="true"></i> Periksa</button>
    </div>
    <progress id="bkProgress" class="sm-bulk-progress" value="0" max="1" style="display:none"></progress>
  </div>

  <div id="bkListCard" class="card sm-mt-16" style="display:none;">
    <div class="card-head">
      <div class="icon-box green"><i class="ti ti-list-check"></i></div>
      <div class="card-head-text">
        <h2>Hasil Pemeriksaan</h2>
        <p id="bkSummary"></p>
      </div>
    </div>
    <div class="sm-bulk-filters" role="group" aria-label="Filter">
      <button type="button" class="sm-bulk-chip active" data-bk="filter" data-v="all">Semua <b id="bkCntAll"></b></button>
      <button type="button" class="sm-bulk-chip" data-bk="filter" data-v="ok">Siap <b id="bkCntOk"></b></button>
      <button type="button" class="sm-bulk-chip" data-bk="filter" data-v="skip">Dilewati <b id="bkCntSkip"></b></button>
    </div>
    <div id="bkList" class="sm-bulk-list"></div>
    <div class="sm-actions sm-mt-16">
      <button type="button" class="btn btn-ghost" data-bk="csv"><i class="ti ti-file-spreadsheet" aria-hidden="true"></i> Laporan CSV</button>
      <button id="bkCopyBtn" type="button" class="btn btn-ghost" data-bk="copy-noimg"><i class="ti ti-copy" aria-hidden="true"></i> Salin kode tanpa gambar</button>
    </div>
    <div class="sm-bulk-run sm-mt-16">
      <label class="sm-f"><span>Isi per ZIP</span>
        <select id="bkBatch" class="field-input">
          <option value="50">50 file</option>
          <option value="100" selected>100 file</option>
          <option value="200">200 file</option>
          <option value="100000">Satu ZIP</option>
        </select>
      </label>
      <label class="sm-bulk-check"><input type="checkbox" id="bkSkipWarn"> Lewati yang ada peringatan <span class="sm-field-hint">mis. AKD / tgl kadaluarsa kosong</span></label>
      <div class="sm-actions">
        <button id="bkCancelBtn" type="button" class="btn btn-ghost" data-bk="cancel" style="display:none">Batal</button>
        <button id="bkRunBtn" type="button" class="btn btn-primary" data-bk="run"><i class="ti ti-download" aria-hidden="true"></i> <span id="bkRunLabel">Proses yang siap</span></button>
      </div>
    </div>
  </div>
</div>
`;

const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function pool(list, n, fn, shouldStop) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => {
    while (i < list.length && !(shouldStop && shouldStop())) await fn(list[i++]);
  }));
}

function parseCodes(raw) {
  const seen = new Set();
  const out = [];
  for (const c of String(raw).split(/[\s,;]+/)) {
    const code = c.trim();
    const k = code.toUpperCase();
    if (!code || k === 'KODE' || seen.has(k)) continue; // header kolom ikut ke-paste -> abaikan
    seen.add(k);
    out.push(code);
  }
  return out;
}

export function mountBulk(panel, deps) {
  const { toast, loadScript, getToken, el, triggerDownload, loadBucketImage, ensureLogos, cfg } = deps;
  panel.innerHTML = MARKUP;

  let alive = true;
  let busy = false;
  let cancel = false;
  let runId = 0;
  let records = [];
  let checkedTypes = { spek: false, struktur: false };
  let filter = 'all';
  const offs = [];
  const $ = (id) => panel.querySelector('#' + id);
  const listen = (t, type, fn) => { t.addEventListener(type, fn); offs.push(() => t.removeEventListener(type, fn)); };
  const selected = () => ({ spek: $('bkSpek').checked, struktur: $('bkStruktur').checked });
  const selTypes = () => Object.entries(selected()).filter(([, v]) => v).map(([k]) => k);

  function setProgress(done, total, text) {
    const p = $('bkProgress');
    p.style.display = total ? '' : 'none';
    p.max = total || 1;
    p.value = done;
    $('bkStatus').textContent = text || '';
  }
  function setBusy(b) {
    busy = b;
    $('bkCheckBtn').disabled = b;
    $('bkRunBtn').disabled = b;
    $('bkCancelBtn').style.display = b ? '' : 'none';
  }

  // ---- data ----
  async function restProduk(codes) {
    const token = await getToken();
    const list = codes.map((c) => '"' + c.replace(/["\\]/g, '') + '"').join(',');
    const select = ['kode_produk', 'kode_asli', 'nama_produk', 'spesifikasi'].join(',');
    const res = await fetch(
      `${cfg.SUPABASE_URL}/rest/v1/produk?kode_produk=in.(${encodeURIComponent(list)})&select=${select}&limit=${codes.length}`,
      { headers: { apikey: cfg.ANON_KEY, Authorization: 'Bearer ' + token } }
    );
    if (res.status === 401) throw new Error('Sesi login habis, silakan masuk lagi.');
    if (!res.ok) throw new Error('Gagal mengambil data produk (HTTP ' + res.status + ')');
    return res.json();
  }
  async function rpcStruktur(codes) {
    const token = await getToken();
    const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/get_struktur_harga_data`, {
      method: 'POST',
      headers: { apikey: cfg.ANON_KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_kodes: codes }),
    });
    if (res.status === 401) throw new Error('Sesi login habis, silakan masuk lagi.');
    if (res.status === 404) throw new Error('RPC get_struktur_harga_data belum ada di database.');
    if (!res.ok) throw new Error('Gagal mengambil data struktur (HTTP ' + res.status + ')');
    return res.json();
  }

  // Cek ada/tidaknya gambar di bucket TANPA mengunduh isinya.
  async function imageExists(r) {
    const key = String(r.kodeAsli || r.kode).trim();
    if (!key || /[\/\\]/.test(key) || key.includes('..')) return false;
    if (typeof window.PNM_getSignedUrl !== 'function') throw new Error('PNM_getSignedUrl belum tersedia');
    let url;
    try { url = await window.PNM_getSignedUrl('thumbnails', key + '.png'); } catch { return false; }
    if (!url) return false;
    try {
      return (await fetch(url, { method: 'HEAD' })).ok;
    } catch {
      try { return (await fetch(url, { headers: { Range: 'bytes=0-0' } })).ok; } catch { return false; }
    }
  }

  // ---- status per dokumen ----
  function spekStatus(r) {
    const reasons = [];
    if (!r.produk) reasons.push('tidak ada di database');
    else {
      if (!r.deskripsi.trim()) reasons.push('deskripsi kosong');
      if (r.imgOk === false) reasons.push('gambar belum ada');
      if (r.imgFail) reasons.push('gagal memuat gambar');
    }
    return { s: reasons.length ? 'block' : 'ok', reasons };
  }
  function strukturStatus(r) {
    const it = r.sItem;
    const block = [];
    if (!it.found) block.push('tidak ada di database');
    else {
      if (!it.nama) block.push('nama tayang kosong');
      if (!(it.hargaEkat > 0)) block.push('harga EKATALOG kosong');
    }
    if (block.length) return { s: 'block', reasons: block };
    const warn = periksaItem(it);
    return { s: warn.length ? 'warn' : 'ok', reasons: warn };
  }
  function refreshStatus(r) {
    r.spek = checkedTypes.spek ? spekStatus(r) : null;
    r.struktur = checkedTypes.struktur ? strukturStatus(r) : null;
  }
  const isBlocked = (r) => selTypes().some((t) => r[t] && r[t].s === 'block');

  // ---- render ----
  function badge(label, st) {
    const t = el('span', 'sm-bk-tag ' + (st.s === 'block' ? 'warn' : st.s === 'warn' ? 'caution' : 'ok'));
    t.appendChild(el('span', 'dot'));
    let txt;
    if (st.s === 'ok') txt = label + ': siap';
    else if (st.s === 'warn') txt = label + ': siap · ' + st.reasons.join(', ');
    else txt = label + ': dilewati · ' + st.reasons.join(', ');
    t.appendChild(el('span', '', txt));
    return t;
  }
  function buildRow(r) {
    const row = el('div', 'sm-bulk-row');
    row.dataset.id = String(r.id);
    const top = el('div', 'sm-bulk-top');
    top.appendChild(el('span', 'sm-kode', r.kode));
    top.appendChild(el('span', 'sm-bulk-desc', r.deskripsi || (r.sItem && r.sItem.nama) || ''));
    const tags = el('div', 'sm-bulk-tags');
    if (r.spek && selected().spek) tags.appendChild(badge('Spek', r.spek));
    if (r.struktur && selected().struktur) tags.appendChild(badge('Struktur', r.struktur));
    row.append(top, tags);
    row.dataset.blocked = isBlocked(r) ? '1' : '0';
    return row;
  }
  function applyFilter() {
    panel.querySelectorAll('.sm-bulk-chip').forEach((c) => c.classList.toggle('active', c.dataset.v === filter));
    panel.querySelectorAll('.sm-bulk-row').forEach((row) => {
      const blocked = row.dataset.blocked === '1';
      row.hidden = (filter === 'ok' && blocked) || (filter === 'skip' && !blocked);
    });
  }
  function renderAll() {
    $('bkListCard').style.display = records.length ? '' : 'none';
    $('bkList').replaceChildren(...records.map(buildRow));
    const blocked = records.filter(isBlocked).length;
    $('bkCntAll').textContent = records.length;
    $('bkCntOk').textContent = records.length - blocked;
    $('bkCntSkip').textContent = blocked;
    const parts = [];
    for (const t of selTypes()) {
      if (!checkedTypes[t]) continue;
      const ok = records.filter((r) => r[t] && r[t].s !== 'block').length;
      parts.push(`${t === 'spek' ? 'Spesifikasi' : 'Struktur Harga'}: ${ok} siap, ${records.length - ok} dilewati`);
    }
    $('bkSummary').textContent = `${records.length} kode · ` + parts.join(' · ');
    applyFilter();
  }

  // ---- periksa ----
  async function check() {
    const types = selTypes();
    if (!types.length) { toast('Pilih minimal satu jenis dokumen.', 'error'); return; }
    const codes = parseCodes($('bkCodes').value);
    if (!codes.length) { toast('Isi minimal satu kode.', 'error'); return; }
    const myRun = ++runId;
    setBusy(true);
    cancel = false;
    try {
      const stale = () => !alive || myRun !== runId || cancel;
      const batches = chunk(codes, DB_CHUNK);
      const prodMap = new Map();
      const strukMap = new Map();
      let done = 0;
      const steps = batches.length * types.length;
      setProgress(0, steps, 'Mengambil data dari database...');
      const tick = () => { done++; setProgress(done, steps, `Mengambil data dari database... ${done}/${steps}`); };
      await pool(batches, DB_CONCURRENCY, async (b) => {
        if (types.includes('spek')) { (await restProduk(b)).forEach((r) => prodMap.set(String(r.kode_produk).toUpperCase(), r)); tick(); }
        if (types.includes('struktur')) { ((await rpcStruktur(b)) || []).forEach((r) => strukMap.set(String(r.kode_produk).toUpperCase(), r)); tick(); }
      }, stale);
      if (stale()) { setProgress(0, 0, 'Dibatalkan.'); return; }

      let nextId = 1;
      records = codes.map((c) => {
        const k = c.toUpperCase();
        const p = prodMap.get(k) || null;
        const row = strukMap.get(k) || null;
        const id = nextId++;
        return {
          id,
          kode: p ? p.kode_produk : (row ? row.kode_produk : c),
          kodeAsli: p ? (p.kode_asli || '') : '',
          produk: p,
          deskripsi: p ? String(p[DESC_FIELD] || p.nama_produk || '') : '',
          imgOk: null,
          imgFail: false,
          sItem: types.includes('struktur') ? buatItem(row, c, id) : null,
        };
      });
      checkedTypes = { spek: types.includes('spek'), struktur: types.includes('struktur') };

      if (checkedTypes.spek) {
        const need = records.filter((r) => r.produk);
        let n = 0;
        setProgress(0, need.length, 'Memeriksa gambar... 0/' + need.length);
        await pool(need, IMG_CHECK_CONCURRENCY, async (r) => {
          r.imgOk = await imageExists(r);
          n++;
          if (n % 5 === 0 || n === need.length) setProgress(n, need.length, `Memeriksa gambar... ${n}/${need.length}`);
        }, stale);
        if (stale()) { setProgress(0, 0, 'Dibatalkan.'); return; }
      }
      records.forEach(refreshStatus);
      renderAll();
      setProgress(0, 0, '');
    } catch (err) {
      setProgress(0, 0, '');
      toast(err.message || 'Gagal memeriksa kode', 'error');
    } finally {
      setBusy(false);
    }
  }

  // ---- proses ----
  const stamp = () => {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  };

  async function run() {
    if (!records.length) return;
    const types = selTypes();
    if (!types.length) { toast('Pilih minimal satu jenis dokumen.', 'error'); return; }
    if (types.some((t) => !checkedTypes[t])) { toast('Jenis dokumen berubah sejak pemeriksaan, klik Periksa lagi.', 'error'); return; }
    const skipWarn = $('bkSkipWarn').checked;
    const size = Number($('bkBatch').value) || 100;
    const myRun = runId;
    cancel = false;
    setBusy(true);
    try {
      await loadScript(cfg.JSPDF_SRC, cfg.JSPDF_SRI);
      await loadScript(cfg.JSZIP_SRC, cfg.JSZIP_SRI);
      const jsPDF = window.jspdf.jsPDF;
      const gagal = [];
      let berhasil = 0;
      const stop = () => !alive || cancel;

      for (const t of types) {
        if (stop()) break;
        const list = records.filter((r) => r[t] && r[t].s !== 'block' && !(skipWarn && r[t].s === 'warn'));
        if (!list.length) continue;
        const label = t === 'spek' ? 'spek' : 'struktur-harga';
        const nice = t === 'spek' ? 'Spesifikasi' : 'Struktur Harga';
        const fonts = t === 'spek' ? await loadSpekFonts() : await loadStrukturFonts();
        const logos = t === 'spek' ? await ensureLogos() : null;
        const parts = chunk(list, size);
        let done = 0;
        for (let pi = 0; pi < parts.length; pi++) {
          if (stop()) break;
          const zip = new window.JSZip();
          const used = new Set();
          await pool(parts[pi], PDF_CONCURRENCY, async (r) => {
            try {
              let doc;
              let name;
              if (t === 'spek') {
                const image = await loadBucketImage({ kode: r.kode, kodeAsli: r.kodeAsli });
                doc = buildSpekPdf(jsPDF, { kode: r.kode, deskripsi: r.deskripsi.trim(), image, logos, fonts });
                name = fileSafeName(r.kode);
              } else {
                doc = buildStrukturPdf(jsPDF, r.sItem, fonts);
                name = fileSafeName(r.kode);
              }
              for (let n = 2; used.has(name); n++) name = fileSafeName(r.kode + '_' + n);
              used.add(name);
              zip.file(name, doc.output('arraybuffer'));
              berhasil++;
            } catch (err) {
              if (t === 'spek') r.imgFail = true;
              gagal.push(`${nice} ${r.kode}: ${err.message || 'gagal'}`);
            }
            done++;
            setProgress(done, list.length, `${nice}: ${done}/${list.length} (ZIP ${pi + 1}/${parts.length})`);
          }, stop);
          if (stop()) break;
          if (!used.size) continue;
          const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
          const part = parts.length > 1 ? `-bagian${pi + 1}` : '';
          triggerDownload(blob, `${label}-bulk-${stamp()}${part}.zip`);
          await sleep(800); // jeda supaya browser tidak memblokir unduhan beruntun
        }
      }

      if (alive && myRun === runId) {
        records.forEach(refreshStatus);
        renderAll();
      }
      setProgress(0, 0, '');
      if (cancel) toast(`Dibatalkan. ${berhasil} PDF sempat dibuat.`, 'error');
      else if (gagal.length) toast(`Selesai: ${berhasil} PDF, ${gagal.length} gagal (ditandai di daftar).`, 'error');
      else toast(`Selesai: ${berhasil} PDF terunduh`);
      if (gagal.length) console.warn('bulk gagal:', gagal);
    } catch (err) {
      setProgress(0, 0, '');
      toast(err.message || 'Gagal memproses', 'error');
    } finally {
      setBusy(false);
    }
  }

  // ---- laporan ----
  const csvCell = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  function downloadCsv() {
    if (!records.length) return;
    const st = (x) => (x ? (x.s === 'block' ? 'DILEWATI' : x.s === 'warn' ? 'SIAP (peringatan)' : 'SIAP') : '-');
    const rs = (x) => (x ? x.reasons.join('; ') : '');
    const lines = [['kode', 'deskripsi', 'spek', 'alasan_spek', 'struktur', 'alasan_struktur'].join(',')];
    records.forEach((r) => lines.push([r.kode, r.deskripsi || (r.sItem && r.sItem.nama) || '', st(r.spek), rs(r.spek), st(r.struktur), rs(r.struktur)].map(csvCell).join(',')));
    triggerDownload(new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), `laporan-bulk-${stamp()}.csv`);
  }
  async function copyNoImage() {
    const codes = records.filter((r) => r.produk && r.imgOk === false).map((r) => r.kode);
    if (!codes.length) { toast('Tidak ada kode tanpa gambar.'); return; }
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      toast(`${codes.length} kode tanpa gambar disalin`);
    } catch { toast('Gagal menyalin ke clipboard', 'error'); }
  }

  listen(panel, 'click', (e) => {
    const b = e.target.closest('[data-bk]');
    if (!b || !panel.contains(b)) return;
    switch (b.dataset.bk) {
      case 'check': if (!busy) check(); break;
      case 'run': if (!busy) run(); break;
      case 'cancel': cancel = true; break;
      case 'filter': filter = b.dataset.v; applyFilter(); break;
      case 'csv': downloadCsv(); break;
      case 'copy-noimg': copyNoImage(); break;
      default: break;
    }
  });
  // ganti pilihan jenis dokumen -> status & ringkasan ikut berubah
  listen(panel, 'change', (e) => {
    if ((e.target.id === 'bkSpek' || e.target.id === 'bkStruktur') && records.length) renderAll();
  });
  listen(panel, 'keydown', (e) => {
    if (e.target.id === 'bkCodes' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (!busy) check(); }
  });

  return function unmountBulk() {
    alive = false;
    cancel = true;
    runId++;
    offs.forEach((off) => off());
    records = [];
  };
}