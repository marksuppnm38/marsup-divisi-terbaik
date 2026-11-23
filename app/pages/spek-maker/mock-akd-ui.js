// spek-maker/mock-akd-ui.js -- tab "Mock AKD" di Document Maker.
//
// Alur: paste kode SET (mis. MAYO 1, 2, 3) -> isi tiap set diambil dari database ->
// digabung jadi SATU daftar unik (logika di mock-akd.js) -> bisa dikoreksi (deskripsi,
// urutan, gambar, hapus item) -> Preview / Unduh PDF dengan layout Lampiran Set, TANPA
// kolom QTY dan baris TOTAL (dokumen AKD hanya butuh daftar item unik).
// Tujuannya melihat dulu seperti apa set baru sebelum diajukan AKD-nya; tidak ada
// yang ditulis ke database.
// Dependensi umum disuntik dari index.js lewat `deps` (sama seperti lampiran-ui.js).

import { buildLampiranPdf, loadLampiranFonts } from './lampiran-pdf.js';
import { parseKodeSet, gabungkanSet, judulGabungan, mockFileName } from './mock-akd.js';

const MAX_CODES = 20;
const IMG_CONCURRENCY = 6;

const MARKUP = `
  <div class="card">
    <div class="card-head">
      <div class="icon-box orange"><i class="ti ti-git-merge"></i></div>
      <div class="card-head-text">
        <h2>Gabung Set</h2>
        <p>Paste kode set yang mau digabung. Isinya disatukan jadi satu daftar unik (tanpa qty) untuk dilihat sebelum pengajuan AKD.</p>
      </div>
    </div>
    <label class="field-label" for="maCodes">Kode SET <span class="sm-field-hint">satu per baris, maks ${MAX_CODES}</span></label>
    <textarea id="maCodes" class="field-input sm-textarea" spellcheck="false" autocomplete="off" placeholder="RB-SET-MAYO-01&#10;RB-SET-MAYO-02&#10;RB-SET-MAYO-03" aria-label="Kode SET yang digabung, satu per baris"></textarea>
    <div class="sm-actions sm-mt-12">
      <span class="sm-kbd-hint"><kbd>Ctrl</kbd> + <kbd>Enter</kbd> untuk gabungkan</span>
      <button id="maResolveBtn" type="button" class="btn btn-accent" data-ma="resolve">
        <i class="ti ti-git-merge" aria-hidden="true"></i> Gabungkan
      </button>
    </div>
  </div>

  <div id="maListCard" class="card sm-mt-16" style="display:none;">
    <div class="card-head">
      <div class="icon-box green"><i class="ti ti-list-check"></i></div>
      <div class="card-head-text">
        <h2>Hasil Gabungan</h2>
        <p id="maSummary"></p>
      </div>
    </div>
    <div id="maSources" class="ma-sources"></div>
    <div class="ma-controls">
      <label class="sm-f sm-lp-judul"><span>Judul set baru</span><input id="maJudul" type="text" class="field-input" placeholder="Judul di bawah logo ROBUST"></label>
    </div>
    <div id="maStatus" class="ma-status"></div>
    <div id="maItems" class="sm-list sm-mt-12"></div>
    <div class="sm-actions sm-mt-16">
      <button type="button" class="btn btn-ghost" data-ma="preview"><i class="ti ti-eye" aria-hidden="true"></i> Preview</button>
      <button id="maDownloadBtn" type="button" class="btn btn-primary" data-ma="download">
        <i class="ti ti-download" aria-hidden="true"></i> Unduh PDF
      </button>
    </div>
  </div>

  <div id="maPreviewCard" class="card sm-mt-16" style="display:none;">
    <div class="card-head">
      <div class="icon-box blue"><i class="ti ti-photo"></i></div>
      <div class="card-head-text"><h2 id="maPreviewTitle">Preview</h2></div>
    </div>
    <iframe id="maPreviewFrame" class="sm-preview" title="Preview PDF set gabungan"></iframe>
  </div>

  <input type="file" id="maFileInput" accept="image/*" hidden>
`;

export function mountMockAkd(panel, deps) {
  const {
    toast, loadScript, getToken, el, triggerDownload, cfg,
    loadBucketImage, blobToPngImage, ensureLogos,
  } = deps;
  panel.innerHTML = MARKUP;

  let alive = true;
  let runId = 0;
  let nextId = 1;
  let items = [];        // daftar gabungan yang sedang diedit
  let dobel = 0;         // baris dobel yang dibuang saat penggabungan (tetap, tidak ikut berubah saat item dihapus)
  let sources = [];      // [{ kode, found, tipe, nama, jumlahItem }] sesuai urutan input
  let previewUrl = null;
  let pendingReplaceId = null;
  const offs = [];
  const $ = (id) => panel.querySelector('#' + id);
  const listen = (t, type, fn) => { t.addEventListener(type, fn); offs.push(() => t.removeEventListener(type, fn)); };

  // ---- data (sama dengan Lampiran Set; hanya baca) ----
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

  // Sama dengan Lampiran Set: nama set tanpa awalan "SET"/"ROBUST" (logo ROBUST sudah di kop).
  function judulBawaan(nama) {
    return String(nama || '').trim().replace(/^(SET\s+)?ROBUST\s+/i, '').replace(/^SET\s+/i, '');
  }

  async function loadImages(list, myRun) {
    let idx = 0;
    const worker = async () => {
      while (idx < list.length) {
        const it = list[idx++];
        try {
          const img = await loadBucketImage(it);
          if (!alive || myRun !== runId) return;
          it.image = img; it.imgState = 'ok'; it.imgSource = 'bucket';
        } catch (err) {
          if (!alive || myRun !== runId) return;
          it.image = null; it.imgState = 'missing';
        }
        renderRow(it);
        updateStatus();
      }
    };
    await Promise.all(Array.from({ length: Math.min(IMG_CONCURRENCY, list.length) }, worker));
  }

  // ---- render ----
  const itemById = (id) => items.find((i) => String(i.id) === String(id));

  function tag(cls, text) {
    const t = el('span', 'sm-tag' + (cls ? ' ' + cls : ''));
    t.appendChild(el('span', 'dot'));
    t.appendChild(el('span', '', text));
    return t;
  }

  function warnings() {
    const w = [];
    const hilang = sources.filter((s) => !s.found).map((s) => s.kode);
    if (hilang.length) w.push(`${hilang.length} kode tidak ada di database (${hilang.join(', ')})`);
    const bukanSet = sources.filter((s) => s.found && s.tipe && s.tipe !== 'SET').length;
    if (bukanSet) w.push(`${bukanSet} kode bukan tipe SET`);
    const kosong = sources.filter((s) => s.found && !s.jumlahItem).map((s) => s.kode);
    if (kosong.length) w.push(`komposisi kosong: ${kosong.join(', ')}`);
    const noImg = items.filter((i) => i.imgState !== 'ok' && i.imgState !== 'loading').length;
    if (noImg) w.push(`${noImg} gambar belum ada`);
    if (items.some((i) => !i.deskripsi.trim())) w.push(`${items.filter((i) => !i.deskripsi.trim()).length} tanpa deskripsi`);
    if (!$('maJudul').value.trim()) w.push('judul kosong');
    if (!items.length) w.push('belum ada item');
    return w;
  }

  function updateStatus() {
    const w = warnings();
    $('maStatus').replaceChildren(w.length ? tag('warn', w.join(' · ')) : tag('ok', 'Siap dicetak'));
    const pages = Math.max(1, Math.ceil(items.length / 5));
    $('maSummary').textContent = `${items.length} item unik · ${pages} halaman` +
      (dobel > 0 ? ` · ${dobel} item dobel antar set digabung` : '');
  }

  function renderSources() {
    const box = $('maSources');
    box.replaceChildren(...sources.map((s) => {
      const chip = el('span', 'ma-src' + (s.found ? '' : ' missing'));
      chip.appendChild(el('strong', '', s.kode));
      chip.appendChild(el('span', '', s.found ? `${s.jumlahItem} item` : 'tidak ditemukan'));
      return chip;
    }));
  }

  function sumberText(it) {
    return it.sumber.map((s) => s.set).join(' · ');
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

  function buildRow(it, index) {
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

    const asal = el('div', 'ma-asal');
    const ic = el('i', it.disemuaSet ? 'ti ti-circles-relation' : 'ti ti-circle-dot');
    ic.setAttribute('aria-hidden', 'true');
    asal.append(ic, el('span', '', (it.disemuaSet && it.sumber.length > 1 ? 'Di semua set: ' : 'Dari: ') + sumberText(it)));

    const grid = el('div', 'sm-lp-fields');
    grid.appendChild(field('Deskripsi', input(it.deskripsi, 'deskripsi'), 'sm-lp-desc'));

    const tools = el('div', 'sm-row-tools');
    const mk = (action, icon, label, extra, disabled) => {
      const b = el('button', 'sm-link-btn' + (extra ? ' ' + extra : ''));
      b.type = 'button';
      b.dataset.ma = action;
      b.dataset.item = String(it.id);
      if (disabled) b.disabled = true;
      const i = el('i', 'ti ' + icon);
      i.setAttribute('aria-hidden', 'true');
      b.append(i, document.createTextNode(' ' + label));
      return b;
    };
    tools.append(
      mk('replace-image', 'ti-photo-up', 'Ganti gambar'),
      mk('move-up', 'ti-arrow-up', 'Naik', '', index === 0),
      mk('move-down', 'ti-arrow-down', 'Turun', '', index === items.length - 1),
      mk('remove-item', 'ti-x', 'Hapus', 'danger'),
    );

    main.append(head, asal, grid, tools);
    row.append(thumb, main);
    return row;
  }

  function renderRow(it) {
    const old = panel.querySelector(`.sm-row[data-item="${it.id}"]`);
    if (!old) return;
    const a = document.activeElement;
    const f = old.contains(a) ? a.dataset.f : null;
    const caret = f && a.selectionStart != null && a.type === 'text' ? a.selectionStart : null;
    const fresh = buildRow(it, items.indexOf(it));
    old.replaceWith(fresh);
    if (f) {
      const n = fresh.querySelector(`[data-f="${f}"]`);
      if (n) { n.focus(); if (caret != null) try { n.setSelectionRange(caret, caret); } catch { /* ignore */ } }
    }
  }

  function renderRows() {
    const list = $('maItems');
    list.replaceChildren(...items.map((it, i) => buildRow(it, i)));
    if (!items.length) list.appendChild(el('div', 'sm-lp-empty', 'Belum ada item.'));
    updateStatus();
  }

  function renderAll() {
    $('maListCard').style.display = sources.length ? '' : 'none';
    renderSources();
    renderRows();
    if (!sources.length) hidePreview();
  }

  // ---- PDF ----
  async function makeDoc() {
    await loadScript(cfg.JSPDF_SRC, cfg.JSPDF_SRI);
    const [fonts, logos] = await Promise.all([loadLampiranFonts(), ensureLogos()]);
    return buildLampiranPdf(window.jspdf.jsPDF, {
      judul: $('maJudul').value.trim(),
      items: items.map((i) => ({ kode: i.kode, deskripsi: i.deskripsi.trim(), image: i.image })),
      logos,
      fonts,
      tanpaQty: true,
    });
  }

  function hidePreview() {
    const f = $('maPreviewFrame');
    if (f) f.removeAttribute('src');
    const c = $('maPreviewCard');
    if (c) c.style.display = 'none';
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
  }

  async function preview() {
    if (!items.length) { toast('Belum ada item untuk dipreview.', 'error'); return; }
    try {
      const doc = await makeDoc();
      if (!alive) return;
      const url = URL.createObjectURL(doc.output('blob'));
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = url;
      $('maPreviewFrame').src = url;
      $('maPreviewTitle').textContent = 'Preview · ' + ($('maJudul').value.trim() || 'Set gabungan');
      const card = $('maPreviewCard');
      card.style.display = '';
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      toast(err.message || 'Gagal membuat preview', 'error');
    }
  }

  async function download() {
    if (!items.length) return;
    const btn = $('maDownloadBtn');
    const bermasalah = warnings().length;
    btn.disabled = true;
    try {
      triggerDownload((await makeDoc()).output('blob'), mockFileName($('maJudul').value.trim()));
      if (bermasalah) toast('Terunduh, tapi masih ada yang belum lengkap', 'warning', { detail: warnings().join(' · ') });
      else toast('PDF terunduh');
    } catch (err) {
      toast(err.message || 'Gagal membuat PDF', 'error');
    } finally {
      btn.disabled = false;
    }
  }

  // ---- actions ----
  async function resolveCodes() {
    const btn = $('maResolveBtn');
    let codes = parseKodeSet($('maCodes').value);
    if (!codes.length) { toast('Isi minimal satu kode SET.', 'error'); return; }
    if (codes.length > MAX_CODES) { toast(`Maksimal ${MAX_CODES} kode, sisanya diabaikan.`, 'error'); codes = codes.slice(0, MAX_CODES); }
    const myRun = ++runId;
    btn.disabled = true;
    try {
      const { produk, rows } = await fetchSets(codes);
      if (!alive || myRun !== runId) return;
      const byKode = new Map(produk.map((p) => [String(p.kode_produk).toUpperCase(), p]));
      const found = [];
      sources = codes.map((c) => {
        const p = byKode.get(c.toUpperCase());
        if (!p) return { kode: c, found: false, tipe: '', nama: '', jumlahItem: 0 };
        const raw = rows
          .filter((r) => String(r.set_id) === String(p.id))
          .map((r) => {
            const x = r.item || {};
            return { kode: x.kode_produk || '', kodeAsli: x.kode_asli || '', deskripsi: x.nama_produk || '', qty: r.qty, dbOrder: r.id };
          })
          .sort((a, b) => (a.dbOrder > b.dbOrder ? 1 : a.dbOrder < b.dbOrder ? -1 : 0));
        found.push({ kode: p.kode_produk, nama: p.nama_produk, items: raw });
        return { kode: p.kode_produk, found: true, tipe: String(p.tipe || '').toUpperCase(), nama: p.nama_produk, jumlahItem: raw.length };
      });

      const hasil = gabungkanSet(found);
      dobel = hasil.stat.duplikat;
      items = hasil.items.map((g) => ({
        ...g, id: nextId++, image: null, imgState: 'loading', imgSource: null,
      }));
      $('maJudul').value = judulGabungan(found.map((f) => judulBawaan(f.nama)));
      hidePreview();
      renderAll();
      await loadImages(items.slice(), myRun);
    } catch (err) {
      toast(err.message || 'Gagal mengambil data', 'error');
    } finally {
      btn.disabled = false;
    }
  }

  async function onFilePicked(file) {
    const id = pendingReplaceId;
    pendingReplaceId = null;
    const it = itemById(id);
    if (!it || !file) return;
    try {
      it.image = await blobToPngImage(file);
      it.imgState = 'ok';
      it.imgSource = 'manual';
      renderRow(it);
      updateStatus();
    } catch (err) {
      toast(err.message || 'Gagal membaca gambar', 'error');
    }
  }

  function move(it, delta) {
    const i = items.indexOf(it);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= items.length) return;
    items.splice(i, 1);
    items.splice(j, 0, it);
    renderRows();
  }

  listen(panel, 'click', (e) => {
    const b = e.target.closest('[data-ma]');
    if (!b || !panel.contains(b) || b.disabled) return;
    const it = itemById(b.dataset.item);
    switch (b.dataset.ma) {
      case 'resolve': resolveCodes(); break;
      case 'preview': preview(); break;
      case 'download': download(); break;
      case 'replace-image':
        if (!it) break;
        pendingReplaceId = it.id;
        $('maFileInput').click();
        break;
      case 'move-up': if (it) move(it, -1); break;
      case 'move-down': if (it) move(it, 1); break;
      case 'remove-item':
        if (!it) break;
        items = items.filter((x) => x !== it);
        renderRows();
        break;
      default: break;
    }
  });

  // edit field: update state tanpa render ulang supaya fokus aman
  listen(panel, 'input', (e) => {
    const n = e.target;
    if (n.id === 'maJudul') { updateStatus(); return; }
    const f = n.dataset && n.dataset.f;
    if (!f) return;
    const it = itemById(n.closest('.sm-row')?.dataset.item);
    if (!it) return;
    it[f] = n.value;
    updateStatus();
  });

  listen(panel, 'change', (e) => {
    const n = e.target;
    if (n.id === 'maFileInput') { onFilePicked(n.files && n.files[0]); n.value = ''; return; }
  });

  listen(panel, 'keydown', (e) => {
    if (e.target.id === 'maCodes' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); resolveCodes(); }
  });

  return function unmountMockAkd() {
    alive = false;
    runId++;
    offs.forEach((off) => off());
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
    items = [];
    sources = [];
    pendingReplaceId = null;
  };
}
