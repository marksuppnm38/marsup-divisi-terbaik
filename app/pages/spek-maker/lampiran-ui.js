// spek-maker/lampiran-ui.js -- tab "Lampiran Set" di Document Maker.
//
// Alur: kode SET (satu per baris) -> komposisi set (produk_set_item) + gambar
// instrumen dari bucket 'thumbnails' -> daftar yang bisa dikoreksi (judul,
// deskripsi, qty, urutan, gambar) -> Preview / Unduh (1 set = 1 PDF, >1 = ZIP).
// Layout PDF (1:1 dengan BASIC_TUMOR_MAMAE_S.pdf) ada di lampiran-pdf.js.
// Dependensi umum (toast, loadScript, token, logo, loader gambar, dst) disuntik
// dari index.js lewat `deps` supaya gak ada helper yang digandakan.

import { buildLampiranPdf, loadLampiranFonts, lampiranFileName, totalQty } from './lampiran-pdf.js';
import { fileSafeName } from './pdf.js';

const MAX_CODES = 20;
const IMG_CONCURRENCY = 6;
const SORTS = [['db', 'Urutan di database'], ['kode', 'Kode A–Z'], ['nama', 'Deskripsi A–Z']];

const MARKUP = `
  <div class="card">
    <div class="card-head">
      <div class="icon-box orange"><i class="ti ti-list-details"></i></div>
      <div class="card-head-text">
        <h2>Kode Set</h2>
        <p>Isi set (kode, deskripsi, qty) dan gambar tiap instrumen diambil otomatis dari database.</p>
      </div>
    </div>
    <label class="field-label" for="lpCodes">Kode SET <span class="sm-field-hint">satu per baris, maks ${MAX_CODES}</span></label>
    <textarea id="lpCodes" class="field-input sm-textarea" placeholder="RB-SET-TUMOR-MAMAE-01" aria-label="Kode SET, satu per baris"></textarea>
    <button id="lpResolveBtn" type="button" class="btn btn-accent sm-mt-16" data-lp="resolve">
      <i class="ti ti-search" aria-hidden="true"></i> Ambil Data
    </button>
  </div>

  <div id="lpListCard" class="card sm-mt-16" style="display:none;">
    <div class="card-head">
      <div class="icon-box green"><i class="ti ti-list-check"></i></div>
      <div class="card-head-text">
        <h2>Hasil</h2>
        <p id="lpListSummary"></p>
      </div>
    </div>
    <div id="lpSets"></div>
    <div class="sm-actions sm-mt-16">
      <button type="button" class="btn btn-ghost" data-lp="preview-first"><i class="ti ti-eye" aria-hidden="true"></i> Preview</button>
      <button id="lpDownloadBtn" type="button" class="btn btn-primary" data-lp="download-all">
        <i class="ti ti-download" aria-hidden="true"></i> <span id="lpDownloadLabel">Unduh PDF</span>
      </button>
    </div>
  </div>

  <div id="lpPreviewCard" class="card sm-mt-16" style="display:none;">
    <div class="card-head">
      <div class="icon-box blue"><i class="ti ti-photo"></i></div>
      <div class="card-head-text"><h2 id="lpPreviewTitle">Preview</h2></div>
    </div>
    <iframe id="lpPreviewFrame" class="sm-preview" title="Preview PDF lampiran set"></iframe>
  </div>

  <input type="file" id="lpFileInput" accept="image/*" hidden>
`;

export function mountLampiran(panel, deps) {
  const {
    toast, loadScript, getToken, el, triggerDownload, cfg,
    loadBucketImage, blobToPngImage, ensureLogos,
  } = deps;
  panel.innerHTML = MARKUP;

  let alive = true;
  let sets = [];
  let nextId = 1;
  let runId = 0;
  let previewUrl = null;
  let pendingReplace = null; // { setId, itemId }
  const offs = [];
  const $ = (id) => panel.querySelector('#' + id);
  const listen = (t, type, fn) => { t.addEventListener(type, fn); offs.push(() => t.removeEventListener(type, fn)); };

  // ---- data ----
  async function rest(path) {
    const token = await getToken();
    const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/${path}`, {
      headers: { apikey: cfg.ANON_KEY, Authorization: 'Bearer ' + token },
    });
    if (res.status === 401) throw new Error('Sesi login habis, silakan masuk lagi.');
    if (!res.ok) throw new Error('Gagal mengambil data (HTTP ' + res.status + ')');
    return res.json();
  }

  async function fetchSets(codes) {
    const list = codes.map((c) => '"' + c.replace(/["\\]/g, '') + '"').join(',');
    const produk = await rest(`produk?kode_produk=in.(${encodeURIComponent(list)})&select=id,kode_produk,nama_produk,tipe&limit=${codes.length}`);
    const ids = produk.map((p) => p.id);
    let rows = [];
    if (ids.length) {
      rows = await rest(`produk_set_item?set_id=in.(${ids.join(',')})&select=id,set_id,qty,item:produk_id(kode_produk,kode_asli,nama_produk)&order=id.asc&limit=5000`);
    }
    return { produk, rows };
  }

  // Judul bawaan: nama set tanpa awalan "SET"/"ROBUST" (logo ROBUST sudah ada di kop). Bisa diedit.
  function judulBawaan(nama) {
    return String(nama || '').trim().replace(/^(SET\s+)?ROBUST\s+/i, '').replace(/^SET\s+/i, '');
  }

  function makeItem(r) {
    const it = r.item || {};
    return {
      id: nextId++,
      kode: it.kode_produk || '(tanpa kode)',
      kodeAsli: it.kode_asli || '',
      deskripsi: String(it.nama_produk || ''),
      qty: r.qty > 0 ? Number(r.qty) : 1,
      dbOrder: r.id,
      image: null,
      imgState: 'loading',
      imgSource: null,
    };
  }

  async function loadImagesFor(list, myRun) {
    let idx = 0;
    const worker = async () => {
      while (idx < list.length) {
        const { set, it } = list[idx++];
        try {
          const img = await loadBucketImage(it);
          if (!alive || myRun !== runId) return;
          it.image = img; it.imgState = 'ok'; it.imgSource = 'bucket';
        } catch (err) {
          if (!alive || myRun !== runId) return;
          it.image = null; it.imgState = 'missing';
        }
        renderRow(set, it);
        updateMeta(set);
      }
    };
    await Promise.all(Array.from({ length: Math.min(IMG_CONCURRENCY, list.length) }, worker));
  }

  // ---- render ----
  const setById = (id) => sets.find((s) => String(s.id) === String(id));
  const itemOf = (set, id) => set && set.items.find((i) => String(i.id) === String(id));

  function tag(cls, text) {
    const t = el('span', 'sm-tag' + (cls ? ' ' + cls : ''));
    t.appendChild(el('span', 'dot'));
    t.appendChild(el('span', '', text));
    return t;
  }

  function setWarnings(set) {
    const w = [];
    if (!set.found) w.push('kode tidak ada di database');
    else if (set.tipe && set.tipe !== 'SET') w.push('bukan tipe SET');
    if (set.found && !set.items.length) w.push('komposisi set kosong');
    const noImg = set.items.filter((i) => i.imgState !== 'ok' && i.imgState !== 'loading').length;
    if (noImg) w.push(`${noImg} gambar belum ada`);
    const noDesc = set.items.filter((i) => !i.deskripsi.trim()).length;
    if (noDesc) w.push(`${noDesc} tanpa deskripsi`);
    const noQty = set.items.filter((i) => !(Number(i.qty) > 0)).length;
    if (noQty) w.push(`${noQty} qty kosong`);
    if (!set.judul.trim()) w.push('judul kosong');
    return w;
  }

  function metaText(set) {
    const n = set.items.length;
    const pages = Math.max(1, Math.ceil(n / 5));
    return `${n} item · total qty ${totalQty(set.items)} · ${pages} halaman`;
  }

  function updateMeta(set) {
    const card = panel.querySelector(`.sm-set[data-set="${set.id}"]`);
    if (!card) return;
    card.querySelector('.lp-meta').textContent = metaText(set);
    const status = card.querySelector('.lp-status');
    const w = setWarnings(set);
    status.replaceChildren(w.length ? tag('warn', w.join(' · ')) : tag('ok', 'Siap dicetak'));
  }

  function field(label, node, cls) {
    const w = el('label', 'sm-f' + (cls ? ' ' + cls : ''));
    w.appendChild(el('span', '', label));
    w.appendChild(node);
    return w;
  }
  function input(value, f, type = 'text') {
    const i = document.createElement('input');
    i.type = type;
    i.className = 'field-input';
    i.value = value == null ? '' : value;
    i.dataset.f = f;
    if (type === 'number') { i.min = '1'; i.step = '1'; }
    return i;
  }

  function buildRow(set, it, index) {
    const row = el('div', 'sm-row');
    row.dataset.item = String(it.id);

    const thumb = el('div', 'sm-thumb');
    if (it.image) {
      const img = document.createElement('img');
      img.src = it.image.dataUrl;
      img.alt = '';
      thumb.appendChild(img);
    } else {
      const ic = el('i', it.imgState === 'loading' ? 'ti ti-loader-2' : 'ti ti-photo-off');
      ic.setAttribute('aria-hidden', 'true');
      thumb.appendChild(ic);
    }

    const main = el('div', 'sm-row-main');
    const head = el('div', 'sm-row-head');
    head.appendChild(el('span', 'sm-kode', `${index + 1}. ${it.kode}`));
    if (it.imgState === 'loading') head.appendChild(tag('', 'Memuat gambar...'));
    else if (it.imgState === 'ok') head.appendChild(tag('ok', it.imgSource === 'manual' ? 'Gambar manual' : 'Gambar dari bucket'));
    else head.appendChild(tag('warn', 'Gambar belum ada'));

    const grid = el('div', 'sm-lp-fields');
    grid.appendChild(field('Deskripsi', input(it.deskripsi, 'deskripsi'), 'sm-lp-desc'));
    grid.appendChild(field('Qty', input(it.qty, 'qty', 'number'), 'sm-lp-qty'));

    const tools = el('div', 'sm-row-tools');
    const mk = (action, icon, label, extra, disabled) => {
      const b = el('button', 'sm-link-btn' + (extra ? ' ' + extra : ''));
      b.type = 'button';
      b.dataset.lp = action;
      b.dataset.set = String(set.id);
      b.dataset.item = String(it.id);
      if (disabled) b.disabled = true;
      const i = el('i', 'ti ' + icon);
      i.setAttribute('aria-hidden', 'true');
      b.appendChild(i);
      b.appendChild(document.createTextNode(' ' + label));
      return b;
    };
    tools.appendChild(mk('replace-image', 'ti-photo-up', 'Ganti gambar'));
    tools.appendChild(mk('move-up', 'ti-arrow-up', 'Naik', '', index === 0));
    tools.appendChild(mk('move-down', 'ti-arrow-down', 'Turun', '', index === set.items.length - 1));
    tools.appendChild(mk('remove-item', 'ti-x', 'Hapus', 'danger'));

    main.append(head, grid, tools);
    row.append(thumb, main);
    return row;
  }

  function renderRow(set, it) {
    const card = panel.querySelector(`.sm-set[data-set="${set.id}"]`);
    const old = card && card.querySelector(`.sm-row[data-item="${it.id}"]`);
    if (!old) return;
    const a = document.activeElement;
    const f = old.contains(a) ? a.dataset.f : null;
    const caret = f && a.selectionStart != null && a.type === 'text' ? a.selectionStart : null;
    const fresh = buildRow(set, it, set.items.indexOf(it));
    old.replaceWith(fresh);
    if (f) {
      const n = fresh.querySelector(`[data-f="${f}"]`);
      if (n) { n.focus(); if (caret != null) try { n.setSelectionRange(caret, caret); } catch { /* ignore */ } }
    }
  }

  function renderRows(set) {
    const card = panel.querySelector(`.sm-set[data-set="${set.id}"]`);
    if (!card) return;
    const list = card.querySelector('.sm-list');
    list.replaceChildren(...set.items.map((it, i) => buildRow(set, it, i)));
    if (!set.items.length) list.appendChild(el('div', 'sm-lp-empty', 'Belum ada item di set ini.'));
    updateMeta(set);
  }

  function buildSet(set) {
    const card = el('div', 'sm-set');
    card.dataset.set = String(set.id);

    const head = el('div', 'sm-set-head');
    const title = el('div', 'sm-set-title');
    const ic = el('i', 'ti ti-stack-2');
    ic.setAttribute('aria-hidden', 'true');
    title.append(ic, el('span', 'sm-kode', set.kode), el('span', 'lp-status'), el('span', 'sm-tag lp-meta'));

    const judul = input(set.judul, 'judul');
    judul.placeholder = 'Judul di bawah logo ROBUST';
    const judulF = field('Judul lampiran', judul, 'sm-lp-judul');

    const sortSel = document.createElement('select');
    sortSel.className = 'field-input';
    sortSel.dataset.sort = String(set.id);
    SORTS.forEach(([v, l]) => sortSel.appendChild(new Option(l, v)));
    sortSel.value = set.sort;
    const sortF = field('Urutan', sortSel, 'sm-lp-sort');

    const tools = el('div', 'sm-row-tools');
    const mk = (action, icon, label, extra) => {
      const b = el('button', 'sm-link-btn' + (extra ? ' ' + extra : ''));
      b.type = 'button';
      b.dataset.lp = action;
      b.dataset.set = String(set.id);
      const i = el('i', 'ti ' + icon);
      i.setAttribute('aria-hidden', 'true');
      b.append(i, document.createTextNode(' ' + label));
      return b;
    };
    tools.append(mk('preview-set', 'ti-eye', 'Preview'), mk('remove-set', 'ti-x', 'Hapus set', 'danger'));

    head.append(title, el('div', 'sm-lp-controls'), tools);
    head.querySelector('.sm-lp-controls').append(judulF, sortF);
    card.append(head, el('div', 'sm-list'));
    return card;
  }

  function renderAll() {
    $('lpListCard').style.display = sets.length ? '' : 'none';
    $('lpSets').replaceChildren(...sets.map(buildSet));
    sets.forEach(renderRows);
    const found = sets.filter((s) => s.found).length;
    $('lpListSummary').textContent = `${sets.length} kode · ${found} ditemukan di database`;
    $('lpDownloadLabel').textContent = sets.length > 1 ? 'Unduh ZIP' : 'Unduh PDF';
    if (!sets.length) hidePreview();
  }

  function applySort(set) {
    if (set.sort === 'kode') set.items.sort((a, b) => a.kode.localeCompare(b.kode, 'en', { numeric: true }));
    else if (set.sort === 'nama') set.items.sort((a, b) => a.deskripsi.localeCompare(b.deskripsi, 'en', { numeric: true }));
    else set.items.sort((a, b) => (a.dbOrder > b.dbOrder ? 1 : a.dbOrder < b.dbOrder ? -1 : 0));
  }

  // ---- PDF ----
  async function makeDoc(set) {
    await loadScript(cfg.JSPDF_SRC, cfg.JSPDF_SRI);
    const [fonts, logos] = await Promise.all([loadLampiranFonts(), ensureLogos()]);
    return buildLampiranPdf(window.jspdf.jsPDF, {
      judul: set.judul.trim(),
      items: set.items.map((i) => ({ kode: i.kode, deskripsi: i.deskripsi.trim(), qty: Number(i.qty) || 0, image: i.image })),
      logos,
      fonts,
    });
  }

  function hidePreview() {
    const f = $('lpPreviewFrame');
    if (f) f.removeAttribute('src');
    const c = $('lpPreviewCard');
    if (c) c.style.display = 'none';
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
  }

  async function previewSet(set) {
    if (!set) return;
    try {
      const doc = await makeDoc(set);
      if (!alive) return;
      const url = URL.createObjectURL(doc.output('blob'));
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = url;
      $('lpPreviewFrame').src = url;
      $('lpPreviewTitle').textContent = 'Preview · ' + set.kode;
      const card = $('lpPreviewCard');
      card.style.display = '';
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      toast(err.message || 'Gagal membuat preview', 'error');
    }
  }

  async function downloadAll() {
    if (!sets.length) return;
    const btn = $('lpDownloadBtn');
    const bermasalah = sets.filter((s) => setWarnings(s).length).length;
    btn.disabled = true;
    try {
      if (sets.length === 1) {
        triggerDownload((await makeDoc(sets[0])).output('blob'), lampiranFileName(sets[0].judul || sets[0].kode));
      } else {
        await loadScript(cfg.JSZIP_SRC, cfg.JSZIP_SRI);
        const zip = new window.JSZip();
        const used = new Set();
        for (const s of sets) {
          const doc = await makeDoc(s);
          let name = lampiranFileName(s.judul || s.kode);
          for (let n = 2; used.has(name); n++) name = fileSafeName(`${s.judul || s.kode}_${n}`);
          used.add(name);
          zip.file(name, doc.output('arraybuffer'));
        }
        const d = new Date();
        const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
        triggerDownload(await zip.generateAsync({ type: 'blob' }), `lampiran-set-${stamp}.zip`);
      }
      if (bermasalah) toast(`Terunduh. Perhatian: ${bermasalah} set masih punya peringatan (gambar/deskripsi/qty kosong).`, 'error');
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
    const btn = $('lpResolveBtn');
    let codes = parseCodes($('lpCodes').value);
    if (!codes.length) { toast('Isi minimal satu kode SET.', 'error'); return; }
    if (codes.length > MAX_CODES) { toast(`Maksimal ${MAX_CODES} kode, sisanya diabaikan.`, 'error'); codes = codes.slice(0, MAX_CODES); }
    const myRun = ++runId;
    btn.disabled = true;
    try {
      const { produk, rows } = await fetchSets(codes);
      if (!alive || myRun !== runId) return;
      const byKode = new Map(produk.map((p) => [String(p.kode_produk).toUpperCase(), p]));
      sets = codes.map((c) => {
        const p = byKode.get(c.toUpperCase());
        const items = p ? rows.filter((r) => String(r.set_id) === String(p.id)).map(makeItem) : [];
        const set = {
          id: nextId++, kode: p ? p.kode_produk : c, found: !!p, tipe: p ? String(p.tipe || '').toUpperCase() : '',
          judul: p ? judulBawaan(p.nama_produk) : '', sort: 'db', items,
        };
        applySort(set);
        return set;
      });
      hidePreview();
      renderAll();
      await loadImagesFor(sets.flatMap((set) => set.items.map((it) => ({ set, it }))), myRun);
    } catch (err) {
      toast(err.message || 'Gagal mengambil data', 'error');
    } finally {
      btn.disabled = false;
    }
  }

  async function onFilePicked(file) {
    const p = pendingReplace;
    pendingReplace = null;
    const set = p && setById(p.setId);
    const it = itemOf(set, p && p.itemId);
    if (!it || !file) return;
    try {
      it.image = await blobToPngImage(file);
      it.imgState = 'ok';
      it.imgSource = 'manual';
      renderRow(set, it);
      updateMeta(set);
    } catch (err) {
      toast(err.message || 'Gagal membaca gambar', 'error');
    }
  }

  function move(set, it, delta) {
    const i = set.items.indexOf(it);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= set.items.length) return;
    set.items.splice(i, 1);
    set.items.splice(j, 0, it);
    set.sort = 'manual';
    const sel = panel.querySelector(`select[data-sort="${set.id}"]`);
    if (sel) { if (![...sel.options].some((o) => o.value === 'manual')) sel.appendChild(new Option('Urutan manual', 'manual')); sel.value = 'manual'; }
    renderRows(set);
  }

  listen(panel, 'click', (e) => {
    const b = e.target.closest('[data-lp]');
    if (!b || !panel.contains(b) || b.disabled) return;
    const set = setById(b.dataset.set);
    const it = itemOf(set, b.dataset.item);
    switch (b.dataset.lp) {
      case 'resolve': resolveCodes(); break;
      case 'preview-first': previewSet(sets[0]); break;
      case 'preview-set': previewSet(set); break;
      case 'download-all': downloadAll(); break;
      case 'replace-image':
        if (!it) break;
        pendingReplace = { setId: set.id, itemId: it.id };
        $('lpFileInput').click();
        break;
      case 'move-up': if (it) move(set, it, -1); break;
      case 'move-down': if (it) move(set, it, 1); break;
      case 'remove-item':
        if (!it) break;
        set.items = set.items.filter((x) => x !== it);
        renderRows(set);
        break;
      case 'remove-set':
        sets = sets.filter((s) => s !== set);
        renderAll();
        break;
      default: break;
    }
  });

  // edit field: update state tanpa render ulang supaya fokus aman
  listen(panel, 'input', (e) => {
    const n = e.target;
    const f = n.dataset && n.dataset.f;
    if (!f) return;
    const set = setById(n.closest('.sm-set')?.dataset.set);
    if (!set) return;
    if (f === 'judul') { set.judul = n.value; updateMeta(set); return; }
    const it = itemOf(set, n.closest('.sm-row')?.dataset.item);
    if (!it) return;
    if (f === 'qty') it.qty = n.value === '' ? 0 : Number(n.value);
    else it[f] = n.value;
    updateMeta(set);
  });

  listen(panel, 'change', (e) => {
    const n = e.target;
    if (n.id === 'lpFileInput') { onFilePicked(n.files && n.files[0]); n.value = ''; return; }
    if (n.dataset && n.dataset.sort) {
      const set = setById(n.dataset.sort);
      if (!set || n.value === 'manual') return;
      set.sort = n.value;
      applySort(set);
      renderRows(set);
    }
  });

  listen(panel, 'keydown', (e) => {
    if (e.target.id === 'lpCodes' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); resolveCodes(); }
  });

  return function unmountLampiran() {
    alive = false;
    runId++;
    offs.forEach((off) => off());
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
    sets = [];
    pendingReplace = null;
  };
}