// spek-maker/struktur-ui.js -- tab "Struktur Harga" di Document Maker.
//
// Alur: kode (satu per baris) -> RPC get_struktur_harga_data -> daftar item
// yang bisa dikoreksi (entitas, merek, harga EKATALOG, nama) -> Preview / Unduh
// (1 kode = 1 PDF, >1 = ZIP). Logika angka di struktur-harga.js, layout PDF di
// struktur-pdf.js. Dependensi umum (toast, loadScript, token, dst) disuntik dari
// index.js lewat `deps` supaya gak ada kode helper yang digandakan.

import { buildStrukturPdf } from './struktur-pdf.js';
import { DEFAULT_ISIAN, buatItem, hitungStruktur, periksaItem, fmtAngka } from './struktur-harga.js';
import { fileSafeName } from './pdf.js';

const MAX_CODES = 50;
const YA_TIDAK = ['Ya', 'Tidak'];

const MARKUP = `
  <div class="card">
    <div class="card-head">
      <div class="icon-box orange"><i class="ti ti-receipt-2"></i></div>
      <div class="card-head-text">
        <h2>Kode Produk</h2>
        <p>Nama tayang, harga EKATALOG, AKD &amp; masa berlakunya diambil dari database.</p>
      </div>
    </div>
    <label class="field-label" for="shCodes">Kode <span class="sm-field-hint">satu per baris, maks ${MAX_CODES} &middot; satuan, SET, atau unit</span></label>
    <textarea id="shCodes" class="field-input sm-textarea" placeholder="RBM-KEA-B048-U7R&#10;RB999-KE921-B99-U09" aria-label="Kode produk, satu per baris"></textarea>
    <button id="shResolveBtn" type="button" class="btn btn-accent sm-mt-16" data-sh="resolve">
      <i class="ti ti-search" aria-hidden="true"></i> Ambil Data
    </button>
  </div>

  <div id="shIsianCard" class="card sm-mt-16" style="display:none;">
    <div class="card-head">
      <div class="icon-box blue"><i class="ti ti-adjustments"></i></div>
      <div class="card-head-text">
        <h2>Isian Bagian B</h2>
        <p>Berlaku untuk semua dokumen di bawah. Ubah kalau ada produk yang beda (mis. alat besar butuh instalasi).</p>
      </div>
    </div>
    <div class="sm-grid">
      <label class="sm-f"><span>Edukasi berkelanjutan</span><select class="field-input" data-isian="edukasi"></select></label>
      <label class="sm-f"><span>Pelatihan khusus</span><select class="field-input" data-isian="pelatihan"></select></label>
      <label class="sm-f"><span>Instalasi</span><select class="field-input" data-isian="instalasi"></select></label>
      <label class="sm-f"><span>Garansi</span><select class="field-input" data-isian="garansi"></select></label>
      <label class="sm-f"><span>Purna jual</span><select class="field-input" data-isian="purnaJual"></select></label>
      <label class="sm-f"><span>Estimasi penjualan / tahun</span><input class="field-input" data-isian="estimasi" type="text"></label>
    </div>
    <label class="field-label sm-mt-16" for="shCatatan">Catatan di bawah "Pembulatan Harga Tayang" <span class="sm-field-hint">opsional, satu butir per baris</span></label>
    <textarea id="shCatatan" class="field-input sm-textarea" style="min-height:56px" data-isian="catatan" placeholder="- Harga termasuk pemasangan"></textarea>
  </div>

  <div id="shListCard" class="card sm-mt-16" style="display:none;">
    <div class="card-head">
      <div class="icon-box green"><i class="ti ti-list-check"></i></div>
      <div class="card-head-text">
        <h2>Hasil</h2>
        <p id="shListSummary"></p>
      </div>
    </div>
    <div id="shList" class="sm-list"></div>
    <div class="sm-actions sm-mt-16">
      <button type="button" class="btn btn-ghost" data-sh="preview-first"><i class="ti ti-eye" aria-hidden="true"></i> Preview</button>
      <button id="shDownloadBtn" type="button" class="btn btn-primary" data-sh="download-all">
        <i class="ti ti-download" aria-hidden="true"></i> <span id="shDownloadLabel">Unduh PDF</span>
      </button>
    </div>
  </div>

  <div id="shPreviewCard" class="card sm-mt-16" style="display:none;">
    <div class="card-head">
      <div class="icon-box blue"><i class="ti ti-photo"></i></div>
      <div class="card-head-text"><h2 id="shPreviewTitle">Preview</h2></div>
    </div>
    <iframe id="shPreviewFrame" class="sm-preview" title="Preview PDF struktur harga"></iframe>
  </div>
`;

export function mountStruktur(panel, deps) {
  const { toast, loadScript, getToken, el, triggerDownload, cfg } = deps;
  panel.innerHTML = MARKUP;

  let alive = true;
  let items = [];
  let nextId = 1;
  let previewUrl = null;
  let runId = 0;
  const isian = { ...DEFAULT_ISIAN };
  const offs = [];
  const $ = (id) => panel.querySelector('#' + id);
  const listen = (t, type, fn) => { t.addEventListener(type, fn); offs.push(() => t.removeEventListener(type, fn)); };

  // isi <select> Ya/Tidak
  panel.querySelectorAll('select[data-isian]').forEach((sel) => {
    YA_TIDAK.forEach((v) => sel.appendChild(new Option(v, v)));
    sel.value = isian[sel.dataset.isian];
  });
  panel.querySelector('input[data-isian="estimasi"]').value = isian.estimasi;

  // ---- data ----
  async function fetchData(codes) {
    const token = await getToken();
    const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/get_struktur_harga_data`, {
      method: 'POST',
      headers: { apikey: cfg.ANON_KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_kodes: codes }),
    });
    if (res.status === 401) throw new Error('Sesi login habis, silakan masuk lagi.');
    if (res.status === 404) throw new Error('RPC get_struktur_harga_data belum ada di database (jalankan sql/struktur_harga_rpc.sql).');
    if (!res.ok) throw new Error('Gagal mengambil data (HTTP ' + res.status + ')');
    return res.json();
  }

  // ---- render ----
  function tag(cls, text) {
    const t = el('span', 'sm-tag' + (cls ? ' ' + cls : ''));
    t.appendChild(el('span', 'dot'));
    t.appendChild(el('span', '', text));
    return t;
  }

  function field(label, node) {
    const w = el('label', 'sm-f');
    w.appendChild(el('span', '', label));
    w.appendChild(node);
    return w;
  }
  function input(value, field_, type = 'text') {
    const i = document.createElement('input');
    i.type = type;
    i.className = 'field-input';
    i.value = value == null ? '' : value;
    i.dataset.f = field_;
    return i;
  }

  function buildRow(it) {
    const row = el('div', 'sm-row');
    row.dataset.id = String(it.id);

    const thumb = el('div', 'sm-thumb');
    const ic = el('i', 'ti ' + (it.tipe === 'SET' ? 'ti-box-multiple' : it.tipe === 'UNIT' ? 'ti-device-desktop' : 'ti-receipt-2'));
    ic.setAttribute('aria-hidden', 'true');
    thumb.appendChild(ic);

    const main = el('div', 'sm-row-main');
    const head = el('div', 'sm-row-head');
    head.appendChild(el('span', 'sm-kode', it.kode));
    if (it.tipe) head.appendChild(tag('', it.tipe));
    const warns = periksaItem(it);
    if (warns.length) head.appendChild(tag('warn', warns.join(' · ')));
    else head.appendChild(tag('ok', 'Siap dicetak'));

    const hs = hitungStruktur(it.hargaEkat);
    const grid = el('div', 'sm-grid');
    grid.appendChild(field('Nama tayang v6', input(it.nama, 'nama')));
    grid.appendChild(field('Merek', input(it.merek, 'merek')));
    grid.appendChild(field('Harga EKATALOG (Rp, incl. PPN)', input(it.hargaEkat, 'hargaEkat', 'number')));
    grid.appendChild(field('No. AKD', input(it.nie, 'nie')));
    grid.appendChild(field('Kadaluarsa AKD', input(it.nieExp, 'nieExp')));

    const info = el('div', 'sm-tag', hs ? `Pengajuan Harga Tayang: Rp ${fmtAngka(hs.pengajuan)}` : 'Pengajuan Harga Tayang: -');
    info.style.fontFamily = 'var(--mono)';

    const tools = el('div', 'sm-row-tools');
    const mk = (action, icon, label, extra) => {
      const b = el('button', 'sm-link-btn' + (extra ? ' ' + extra : ''));
      b.type = 'button';
      b.dataset.sh = action;
      b.dataset.id = String(it.id);
      const i = el('i', 'ti ' + icon);
      i.setAttribute('aria-hidden', 'true');
      b.appendChild(i);
      b.appendChild(document.createTextNode(' ' + label));
      return b;
    };
    tools.appendChild(mk('preview-item', 'ti-eye', 'Preview'));
    tools.appendChild(mk('remove-item', 'ti-x', 'Hapus', 'danger'));

    main.append(head, grid, info, tools);
    row.append(thumb, main);
    return row;
  }

  // Render ulang SATU baris tapi jaga fokus (user lagi ngetik).
  function renderRow(it, keepFocus) {
    const list = $('shList');
    const old = list && list.querySelector(`.sm-row[data-id="${it.id}"]`);
    if (!old) return;
    const a = document.activeElement;
    const f = keepFocus && old.contains(a) ? a.dataset.f : null;
    const caret = f && a.selectionStart != null ? a.selectionStart : null;
    const fresh = buildRow(it);
    old.replaceWith(fresh);
    if (f) {
      const n = fresh.querySelector(`[data-f="${f}"]`);
      if (n) { n.focus(); if (caret != null && n.setSelectionRange) try { n.setSelectionRange(caret, caret); } catch { /* type=number */ } }
    }
  }

  function renderList() {
    $('shListCard').style.display = items.length ? '' : 'none';
    $('shIsianCard').style.display = items.length ? '' : 'none';
    $('shList').replaceChildren(...items.map(buildRow));
    const found = items.filter((i) => i.found).length;
    $('shListSummary').textContent = `${items.length} kode · ${found} ditemukan di database`;
    $('shDownloadLabel').textContent = items.length > 1 ? 'Unduh ZIP' : 'Unduh PDF';
    if (!items.length) hidePreview();
  }

  const itemById = (id) => items.find((i) => String(i.id) === String(id));

  // ---- PDF ----
  async function makeDoc(it) {
    await loadScript(cfg.JSPDF_SRC, cfg.JSPDF_SRI);
    return buildStrukturPdf(window.jspdf.jsPDF, it);
  }
  function hidePreview() {
    const f = $('shPreviewFrame');
    if (f) f.removeAttribute('src');
    const c = $('shPreviewCard');
    if (c) c.style.display = 'none';
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
  }
  async function previewItem(it) {
    if (!it) return;
    try {
      const doc = await makeDoc(it);
      if (!alive) return;
      const url = URL.createObjectURL(doc.output('blob'));
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = url;
      $('shPreviewFrame').src = url;
      $('shPreviewTitle').textContent = 'Preview · ' + it.kode;
      const card = $('shPreviewCard');
      card.style.display = '';
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      toast(err.message || 'Gagal membuat preview', 'error');
    }
  }
  const nameFor = (it) => fileSafeName(it.kode + '_struktur-harga');

  async function downloadAll() {
    if (!items.length) return;
    const btn = $('shDownloadBtn');
    const bermasalah = items.filter((i) => periksaItem(i).length).length;
    btn.disabled = true;
    try {
      if (items.length === 1) {
        triggerDownload((await makeDoc(items[0])).output('blob'), nameFor(items[0]));
      } else {
        await loadScript(cfg.JSZIP_SRC, cfg.JSZIP_SRI);
        const zip = new window.JSZip();
        const used = new Set();
        for (const it of items) {
          const doc = await makeDoc(it);
          let name = nameFor(it);
          for (let n = 2; used.has(name); n++) name = fileSafeName(it.kode + '_struktur-harga_' + n);
          used.add(name);
          zip.file(name, doc.output('arraybuffer'));
        }
        const d = new Date();
        const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
        triggerDownload(await zip.generateAsync({ type: 'blob' }), `struktur-harga-${stamp}.zip`);
      }
      if (bermasalah) toast(`Terunduh. Perhatian: ${bermasalah} dokumen masih punya data kosong/peringatan.`, 'error');
      else toast('PDF terunduh');
    } catch (err) {
      toast(err.message || 'Gagal membuat PDF', 'error');
    } finally {
      btn.disabled = false;
    }
  }

  // ---- actions ----
  function parseCodes(raw) {
    const seen = new Set();
    const out = [];
    for (const c of String(raw).split(/[\s,;]+/)) {
      const code = c.trim();
      const k = code.toUpperCase();
      if (code && !seen.has(k)) { seen.add(k); out.push(code); }
    }
    return out;
  }

  async function resolveCodes() {
    const btn = $('shResolveBtn');
    let codes = parseCodes($('shCodes').value);
    if (!codes.length) { toast('Isi minimal satu kode.', 'error'); return; }
    if (codes.length > MAX_CODES) { toast(`Maksimal ${MAX_CODES} kode, sisanya diabaikan.`, 'error'); codes = codes.slice(0, MAX_CODES); }
    const myRun = ++runId;
    btn.disabled = true;
    try {
      const rows = await fetchData(codes);
      if (!alive || myRun !== runId) return;
      const byKode = new Map((rows || []).map((r) => [String(r.kode_produk).toUpperCase(), r]));
      items = codes.map((c) => {
        const it = buatItem(byKode.get(c.toUpperCase()), c, nextId++);
        it.isian = { ...isian };
        return it;
      });
      hidePreview();
      renderList();
    } catch (err) {
      toast(err.message || 'Gagal mengambil data', 'error');
    } finally {
      btn.disabled = false;
    }
  }

  // klik
  listen(panel, 'click', (e) => {
    const b = e.target.closest('[data-sh]');
    if (!b || !panel.contains(b)) return;
    switch (b.dataset.sh) {
      case 'resolve': resolveCodes(); break;
      case 'preview-first': previewItem(items[0]); break;
      case 'preview-item': previewItem(itemById(b.dataset.id)); break;
      case 'download-all': downloadAll(); break;
      case 'remove-item':
        items = items.filter((i) => String(i.id) !== b.dataset.id);
        renderList();
        break;
      default: break;
    }
  });

  // edit field per baris (input = update state, tanpa render ulang supaya fokus aman;
  // change = render ulang baris biar peringatan & "Pengajuan" ikut update)
  function applyField(it, f, node) {
    const v = node.value;
    if (f === 'hargaEkat') it.hargaEkat = v === '' ? null : Number(v);
    else it[f] = v;
  }
  listen(panel, 'input', (e) => {
    const n = e.target;
    if (n.dataset.isian) {            // isian global -> salin ke semua item
      isian[n.dataset.isian] = n.value;
      items.forEach((it) => { it.isian[n.dataset.isian] = n.value; });
      return;
    }
    const f = n.dataset.f;
    const it = f && itemById(n.closest('.sm-row')?.dataset.id);
    if (it) applyField(it, f, n);
  });
  listen(panel, 'change', (e) => {
    const n = e.target;
    if (n.dataset.isian) { isian[n.dataset.isian] = n.value; items.forEach((it) => { it.isian[n.dataset.isian] = n.value; }); return; }
    const f = n.dataset.f;
    const it = f && itemById(n.closest('.sm-row')?.dataset.id);
    if (!it) return;
    applyField(it, f, n);
    renderRow(it, true);
  });
  listen(panel, 'keydown', (e) => {
    if (e.target.id === 'shCodes' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); resolveCodes(); }
  });

  return function unmountStruktur() {
    alive = false;
    runId++;
    offs.forEach((off) => off());
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
    items = [];
  };
}
