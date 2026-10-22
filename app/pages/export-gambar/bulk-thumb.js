// export-gambar/bulk-thumb.js -- tab "Bulk" di Merge & Export.
//
// Satu BARIS = satu thumbnail. Baris isi 1 kode -> thumbnail 1 gambar; baris
// isi beberapa kode (pisah koma / spasi, maks 4) -> thumbnail gabungan seperti
// mode satuan. Alur: Periksa (cocokkan kode ke file di bucket "thumbnails",
// TANPA mengunduh gambar) -> overview siap / gambar belum ada -> Proses (render
// PNG hanya untuk baris yang siap, dipecah jadi beberapa ZIP).
//
// Cara cek "gambar ada": daftar file bucket sudah dimuat index.js (satu kali
// list, bukan HEAD per gambar), jadi pemeriksaan 900+ kode hampir instan.
// Kode yang tidak langsung cocok dengan nama file dicari di tabel `produk`
// (kode_produk -> kode_asli), karena file di bucket dinamai kode_asli.
//
// Fungsi render/gambar dipakai ulang dari index.js lewat `deps` -- hasil bulk
// identik dengan mode satuan. Gambar TIDAK di-cache di sini (hemat memori).

const JSZIP_SRC = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
const JSZIP_SRI = 'sha384-+mbV2IY1Zk/X1p/nWllGySJSUN8uMs+gUAN10Or95UBH0fpj6GfKgPmgC5EXieXG';

const DB_CHUNK = 50;
const RENDER_CONCURRENCY = 3;

const MARKUP = `
<div class="eg-bulk">
  <div class="card">
    <div class="card-head">
      <div class="icon-box orange"><i class="ti ti-stack-2"></i></div>
      <div class="card-head-text">
        <h2>Bulk Thumbnail</h2>
        <p>Satu baris = satu thumbnail. Diperiksa dulu, PNG hanya dibuat untuk yang gambarnya ada.</p>
      </div>
    </div>
    <label class="field-label" for="btCodes">Kode <span class="eg-field-hint">satu per baris &middot; gabungan: pisah dengan koma/spasi, maks 4</span></label>
    <textarea id="btCodes" class="field-input eg-textarea" style="min-height:140px" placeholder="RBB-KEC-B076-U1R&#10;RBB-KEC-B077-U1R&#10;MY001, MY002" aria-label="Kode produk, satu thumbnail per baris"></textarea>
    <span class="field-label eg-mt-16">Template</span>
    <div class="eg-bulk-types">
      <label class="eg-bulk-check"><input type="checkbox" id="btRobust" checked> Robust</label>
      <label class="eg-bulk-check"><input type="checkbox" id="btAdler"> Adler</label>
    </div>
    <div class="eg-bulk-actions eg-mt-16">
      <span id="btStatus" class="eg-bulk-status"></span>
      <button id="btCheckBtn" type="button" class="btn btn-accent" data-bt="check"><i class="ti ti-search" aria-hidden="true"></i> Periksa</button>
    </div>
    <progress id="btProgress" class="eg-bulk-progress" value="0" max="1" style="display:none"></progress>
  </div>

  <div id="btListCard" class="card eg-mt-16" style="display:none;">
    <div class="card-head">
      <div class="icon-box green"><i class="ti ti-list-check"></i></div>
      <div class="card-head-text">
        <h2>Hasil Pemeriksaan</h2>
        <p id="btSummary"></p>
      </div>
    </div>
    <div class="eg-bulk-filters" role="group" aria-label="Filter">
      <button type="button" class="eg-bulk-chip active" data-bt="filter" data-v="all">Semua <b id="btCntAll"></b></button>
      <button type="button" class="eg-bulk-chip" data-bt="filter" data-v="ok">Siap <b id="btCntOk"></b></button>
      <button type="button" class="eg-bulk-chip" data-bt="filter" data-v="skip">Belum bisa <b id="btCntSkip"></b></button>
    </div>
    <div id="btList" class="eg-bulk-list"></div>
    <div class="eg-bulk-actions eg-mt-16">
      <button type="button" class="btn btn-ghost" data-bt="csv"><i class="ti ti-file-spreadsheet" aria-hidden="true"></i> Laporan CSV</button>
      <button type="button" class="btn btn-ghost" data-bt="copy-missing"><i class="ti ti-copy" aria-hidden="true"></i> Salin kode tanpa gambar</button>
    </div>
    <div class="eg-bulk-run eg-mt-16">
      <label class="eg-bulk-field"><span>Isi per ZIP</span>
        <select id="btBatch" class="field-input">
          <option value="25">25 file</option>
          <option value="50" selected>50 file</option>
          <option value="100">100 file</option>
          <option value="100000">Satu ZIP</option>
        </select>
      </label>
      <div class="eg-bulk-actions">
        <button id="btCancelBtn" type="button" class="btn btn-ghost" data-bt="cancel" style="display:none">Batal</button>
        <button id="btRunBtn" type="button" class="btn btn-primary" data-bt="run"><i class="ti ti-download" aria-hidden="true"></i> Proses yang siap</button>
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
const stripExt = (s) => String(s).trim().toLowerCase().replace(/\.[a-z0-9]{2,5}$/i, '');
const safeName = (s) => (String(s).normalize('NFKC').replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '') || 'thumbnail');
const mk = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

let jszipPromise = null;
function loadJsZip() {
  if (window.JSZip) return Promise.resolve();
  if (!jszipPromise) {
    jszipPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = JSZIP_SRC;
      s.integrity = JSZIP_SRI;
      s.crossOrigin = 'anonymous';
      s.onload = () => resolve();
      s.onerror = () => { jszipPromise = null; reject(new Error('Gagal memuat JSZip')); };
      document.head.appendChild(s);
    });
  }
  return jszipPromise;
}

function triggerDownload(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function parseLines(raw, maxImages) {
  const seen = new Set();
  const out = [];
  for (const line of String(raw).split(/\r?\n/)) {
    const tokens = [...new Set(line.split(/[\s,;+]+/).map((t) => t.trim()).filter(Boolean))];
    if (!tokens.length) continue;
    if (tokens.length === 1 && tokens[0].toUpperCase() === 'KODE') continue; // header kolom ikut ke-paste
    const key = tokens.map((t) => t.toUpperCase()).join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ tokens, tooMany: tokens.length > maxImages });
  }
  return out;
}

export function mountBulkThumb(panel, deps) {
  const {
    toast, TEMPLATES, getTemplateImage, loadImageWithRetry, removeBackgroundHighQuality,
    getImageUrl, drawMergedCanvas, getFiles, reloadFiles, getSession, supabaseUrl, anonKey,
    isMounted, maxImages,
  } = deps;
  panel.innerHTML = MARKUP;

  let busy = false;
  let cancel = false;
  let runId = 0;
  let rows = [];
  let filter = 'all';
  let alive = true;
  const offs = [];
  const $ = (id) => panel.querySelector('#' + id);
  const listen = (t, type, fn) => { t.addEventListener(type, fn); offs.push(() => t.removeEventListener(type, fn)); };
  const selTemplates = () => [['robust', 'btRobust'], ['adler', 'btAdler']].filter(([, id]) => $(id).checked).map(([k]) => k);
  const live = () => alive && isMounted();

  function setProgress(done, total, text) {
    const p = $('btProgress');
    p.style.display = total ? '' : 'none';
    p.max = total || 1;
    p.value = done;
    $('btStatus').textContent = text || '';
  }
  function setBusy(b) {
    busy = b;
    $('btCheckBtn').disabled = b;
    $('btRunBtn').disabled = b;
    $('btCancelBtn').style.display = b ? '' : 'none';
  }

  // kode_produk -> kode_asli (file di bucket dinamai kode_asli)
  async function lookupKodeAsli(codes) {
    const s = await getSession();
    if (!s) throw new Error('Sesi login habis, silakan masuk lagi.');
    const map = new Map();
    for (const part of chunk(codes, DB_CHUNK)) {
      const list = part.map((c) => '"' + c.replace(/["\\]/g, '') + '"').join(',');
      const res = await fetch(
        `${supabaseUrl}/rest/v1/produk?kode_produk=in.(${encodeURIComponent(list)})&select=kode_produk,kode_asli&limit=${part.length}`,
        { headers: { apikey: anonKey, Authorization: 'Bearer ' + s.access_token } }
      );
      if (res.status === 401) throw new Error('Sesi login habis, silakan masuk lagi.');
      if (!res.ok) throw new Error('Gagal mengambil data produk (HTTP ' + res.status + ')');
      (await res.json()).forEach((r) => map.set(String(r.kode_produk).toUpperCase(), r));
    }
    return map;
  }

  // ---- render ----
  function badge(cls, text) {
    const t = mk('span', 'eg-bk-tag ' + cls);
    t.appendChild(mk('span', 'dot'));
    t.appendChild(mk('span', '', text));
    return t;
  }
  function buildRow(r) {
    const row = mk('div', 'eg-bulk-row');
    row.dataset.blocked = r.ok ? '0' : '1';
    const top = mk('div', 'eg-bulk-top');
    top.appendChild(mk('span', 'eg-bulk-kode', r.tokens.join(' + ')));
    const tags = mk('div', 'eg-bulk-tags');
    if (r.ok) tags.appendChild(badge('ok', r.tokens.length > 1 ? `siap · ${r.tokens.length} gambar` : 'siap · gambar ada'));
    else r.reasons.forEach((x) => tags.appendChild(badge('warn', x)));
    row.append(top, tags);
    return row;
  }
  function applyFilter() {
    panel.querySelectorAll('.eg-bulk-chip').forEach((c) => c.classList.toggle('active', c.dataset.v === filter));
    panel.querySelectorAll('.eg-bulk-row').forEach((row) => {
      const blocked = row.dataset.blocked === '1';
      row.hidden = (filter === 'ok' && blocked) || (filter === 'skip' && !blocked);
    });
  }
  function renderAll() {
    $('btListCard').style.display = rows.length ? '' : 'none';
    $('btList').replaceChildren(...rows.map(buildRow));
    const ok = rows.filter((r) => r.ok).length;
    const noImg = rows.filter((r) => r.states.some((s) => s.state === 'noimg')).length;
    const unknown = rows.filter((r) => r.states.some((s) => s.state === 'unknown')).length;
    $('btCntAll').textContent = rows.length;
    $('btCntOk').textContent = ok;
    $('btCntSkip').textContent = rows.length - ok;
    $('btSummary').textContent = `${rows.length} thumbnail · ${ok} siap · ${noImg} gambar belum ada · ${unknown} kode tidak dikenal`;
    applyFilter();
  }

  // ---- periksa ----
  async function check() {
    const parsed = parseLines($('btCodes').value, maxImages);
    if (!parsed.length) { toast('Isi minimal satu kode.', 'error'); return; }
    const myRun = ++runId;
    cancel = false;
    setBusy(true);
    try {
      setProgress(0, 1, 'Memuat daftar gambar dari bucket...');
      const okList = await reloadFiles();
      if (!live() || myRun !== runId) return;
      if (!okList) { toast('Daftar gambar gagal dimuat, coba lagi.', 'error'); return; }
      const fileMap = new Map(getFiles().map((f) => [stripExt(f.id), f.id]));

      // 1) cocok langsung ke nama file di bucket
      const unresolved = new Set();
      parsed.forEach((p) => p.tokens.forEach((t) => { if (!fileMap.has(stripExt(t))) unresolved.add(t); }));

      // 2) sisanya: cari di tabel produk (kode_produk -> kode_asli)
      let produk = new Map();
      if (unresolved.size) {
        setProgress(0, 1, `Mencocokkan ${unresolved.size} kode ke database...`);
        produk = await lookupKodeAsli([...unresolved]);
        if (!live() || myRun !== runId) return;
      }

      rows = parsed.map((p, i) => {
        const states = p.tokens.map((t) => {
          const direct = fileMap.get(stripExt(t));
          if (direct) return { token: t, state: 'ok', file: direct };
          const pr = produk.get(t.toUpperCase());
          if (!pr) return { token: t, state: 'unknown', file: null };
          const asli = pr.kode_asli ? fileMap.get(stripExt(pr.kode_asli)) : null;
          return asli ? { token: t, state: 'ok', file: asli } : { token: t, state: 'noimg', file: null };
        });
        const reasons = [];
        if (p.tooMany) reasons.push(`maks ${maxImages} kode per baris`);
        const noimg = states.filter((s) => s.state === 'noimg').map((s) => s.token);
        const unk = states.filter((s) => s.state === 'unknown').map((s) => s.token);
        if (noimg.length) reasons.push('gambar belum ada: ' + noimg.join(', '));
        if (unk.length) reasons.push('kode tidak dikenal: ' + unk.join(', '));
        return { id: i + 1, tokens: p.tokens, states, reasons, ok: reasons.length === 0 };
      });
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
    const list = rows.filter((r) => r.ok);
    if (!list.length) { toast('Tidak ada baris yang siap diproses.', 'error'); return; }
    const templates = selTemplates();
    if (!templates.length) { toast('Pilih minimal satu template.', 'error'); return; }
    const size = Number($('btBatch').value) || 50;
    cancel = false;
    setBusy(true);
    try {
      await loadJsZip();
      const stop = () => !live() || cancel;
      const gagal = [];
      let berhasil = 0;

      for (const key of templates) {
        if (stop()) break;
        const tpl = TEMPLATES[key];
        let templateImg;
        try { templateImg = await getTemplateImage(tpl); } catch {
          toast(`Template ${tpl.label} gagal dimuat (${tpl.file}).`, 'error', 6000);
          continue;
        }
        const parts = chunk(list, size);
        let done = 0;
        for (let pi = 0; pi < parts.length; pi++) {
          if (stop()) break;
          const zip = new window.JSZip();
          const used = new Set();
          await pool(parts[pi], RENDER_CONCURRENCY, async (r) => {
            try {
              const overlays = [];
              for (const s of r.states) {
                const img = await loadImageWithRetry(await getImageUrl(s.file));
                overlays.push(await removeBackgroundHighQuality(img));
              }
              const canvas = document.createElement('canvas');
              drawMergedCanvas(templateImg, overlays, tpl.box, canvas);
              const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
              if (!blob) throw new Error('gagal membuat PNG');
              const base = safeName(r.states.map((s) => s.file).join('_')); // nama file = kode_asli (sama dengan nama di bucket)
              let name = base + '.png';
              for (let n = 2; used.has(name); n++) name = `${base}_${n}.png`;
              used.add(name);
              zip.file(name, blob);
              berhasil++;
              canvas.width = canvas.height = 0; // bebaskan memori
            } catch (err) {
              r.reasons = ['gagal memuat/merender: ' + (err.message || 'error')];
              r.ok = false;
              gagal.push(r.tokens.join('+'));
            }
            done++;
            setProgress(done, list.length, `${tpl.label}: ${done}/${list.length} (ZIP ${pi + 1}/${parts.length})`);
          }, stop);
          if (stop()) break;
          if (!used.size) continue;
          const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
          const part = parts.length > 1 ? `-bagian${pi + 1}` : '';
          triggerDownload(blob, `thumbnail-${key}-bulk-${stamp()}${part}.zip`);
          await sleep(800); // jeda supaya browser tidak memblokir unduhan beruntun
        }
      }

      if (live()) renderAll();
      setProgress(0, 0, '');
      if (cancel) toast(`Dibatalkan. ${berhasil} PNG sempat dibuat.`, 'error');
      else if (gagal.length) toast(`Selesai: ${berhasil} PNG, ${gagal.length} gagal (ditandai di daftar).`, 'error', 6000);
      else toast(`Selesai: ${berhasil} PNG terunduh`, 'success');
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
    if (!rows.length) return;
    const lines = [['no', 'kode', 'status', 'alasan', 'file_gambar'].join(',')];
    rows.forEach((r) => lines.push([
      r.id, r.tokens.join(' + '), r.ok ? 'SIAP' : 'BELUM BISA', r.reasons.join('; '),
      r.states.map((s) => s.file || '').join(' + '),
    ].map(csvCell).join(',')));
    triggerDownload(new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), `laporan-thumbnail-${stamp()}.csv`);
  }
  async function copyMissing() {
    const codes = [...new Set(rows.flatMap((r) => r.states.filter((s) => s.state === 'noimg').map((s) => s.token)))];
    if (!codes.length) { toast('Tidak ada kode tanpa gambar.', 'success'); return; }
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      toast(`${codes.length} kode tanpa gambar disalin`, 'success');
    } catch { toast('Gagal menyalin ke clipboard', 'error'); }
  }

  listen(panel, 'click', (e) => {
    const b = e.target.closest('[data-bt]');
    if (!b || !panel.contains(b)) return;
    switch (b.dataset.bt) {
      case 'check': if (!busy) check(); break;
      case 'run': if (!busy) run(); break;
      case 'cancel': cancel = true; break;
      case 'filter': filter = b.dataset.v; applyFilter(); break;
      case 'csv': downloadCsv(); break;
      case 'copy-missing': copyMissing(); break;
      default: break;
    }
  });
  listen(panel, 'keydown', (e) => {
    if (e.target.id === 'btCodes' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (!busy) check(); }
  });

  return function unmountBulkThumb() {
    alive = false;
    cancel = true;
    runId++;
    offs.forEach((off) => off());
    rows = [];
  };
}