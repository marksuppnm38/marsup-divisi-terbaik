// spek-maker page module (tampil sebagai "Document Maker"): mount(container) / unmount().
// Lima tab: Spesifikasi (file ini), Struktur Harga (struktur-ui.js), SPP --
// Surat Permohonan Presentasi (spp-ui.js, layout PDF di spp-pdf.js), Lampiran
// Set (lampiran-ui.js, layout PDF di lampiran-pdf.js), dan Bulk (bulk-ui.js).
//
// Input: kode produk (satu per baris). Per kode, halaman ini mengambil:
//   - Kode        -> produk.kode_produk
//   - Deskripsi   -> produk.nama_produk   (ganti lewat DESC_FIELD di bawah
//                    kalau yang dipakai di template ternyata kolom `spesifikasi`)
//   - Gambar      -> bucket 'thumbnails' (PRIVATE), object "<kode_asli>.png"
//                    (fallback kode_produk kalau kode_asli kosong), lewat
//                    window.PNM_getSignedUrl -- aturan yang sama persis dengan
//                    fetchImageBase64() di konversian/clipboard.js.
// Deskripsi bisa diedit dan gambar bisa diganti manual per baris; kode yang
// gak ada di database tetap bisa dibuat PDF-nya (isi manual).
//
// Output: 1 kode = 1 PDF "<kode>.pdf"; >1 kode = 1 ZIP berisi PDF per kode.
// Layout PDF ada di pdf.js (diukur dari RBB-KEC-B076-U1R.pdf).
//
// UX (polish, setara Konversian / Merge & Export):
//   - Toolbar: tab segmented + petunjuk per tab + tombol Reset (konfirmasi 2 klik).
//   - Workspace dua panel: isian di kiri, preview PDF sticky di kanan. Kartu
//     preview tiap tab dikenali lewat id yang berakhiran "PreviewCard", jadi
//     struktur-ui / spp-ui / lampiran-ui / bulk-ui TIDAK perlu diubah.
//   - State tidak hilang saat pindah modul: tab Spesifikasi dipulihkan penuh
//     (kode, daftar, gambar); tab lain dipulihkan isian formulirnya (hasil/daftar
//     di tab itu dibuat ulang dengan "Ambil Data"). Snapshot hanya hidup di
//     memori halaman dan dibuang kalau user yang login berganti.

import { SPEK_MAKER_MARKUP } from './markup.js';
import { buildSpekPdf, loadSpekFonts, fileSafeName } from './pdf.js';
import { mountStruktur } from './struktur-ui.js';
import { mountSpp } from './spp-ui.js';
import { mountLampiran } from './lampiran-ui.js';
import { mountBulk } from './bulk-ui.js';

const SUPABASE_URL = 'https://ptkkbsemihcyndisjoor.supabase.co';
// anon key publik, sama dengan yang sudah ada di konversian/index.js
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB0a2tic2VtaWhjeW5kaXNqb29yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0Njc4MzgsImV4cCI6MjA5ODA0MzgzOH0.QsCqmcqQcXvz1f8bLkagvMbAGUBbBP-3Wa5Aore5OMo';

const DESC_FIELD = 'nama_produk'; // atau 'spesifikasi'
const MAX_CODES = 50;
const IMG_MAX_SIDE = 1200;       // gambar diperkecil dulu biar PDF gak bengkak
const IMG_CONCURRENCY = 6;
const LIVE_PREVIEW_MS = 700;     // jeda sebelum preview ikut diperbarui saat deskripsi diedit
const RESET_ARM_MS = 3000;       // jendela klik kedua pada Reset

const JSPDF_SRC = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
const JSPDF_SRI = 'sha384-JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk';
const JSZIP_SRC = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
const JSZIP_SRI = 'sha384-+mbV2IY1Zk/X1p/nWllGySJSUN8uMs+gUAN10Or95UBH0fpj6GfKgPmgC5EXieXG';

const STYLE_ID = 'page-spek-maker-style';

// Logo ada di folder assets root proyek (F:\dev\assets, URL /assets/...),
// sama seperti logo-mark-pnm.png yang dipakai sidebar nav.
const LOGO_URLS = {
  robust: '/assets/robust-logo.png',
  pnm: '/assets/pnm-logo.png',
};

// ---- helper umum ---------------------------------------------------------
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

const scriptPromises = new Map();
function loadScript(src, integrity) {
  if (!scriptPromises.has(src)) {
    scriptPromises.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.integrity = integrity;
      s.crossOrigin = 'anonymous';
      s.onload = () => resolve();
      s.onerror = () => { scriptPromises.delete(src); reject(new Error('Gagal memuat ' + src)); };
      document.head.appendChild(s);
    }));
  }
  return scriptPromises.get(src);
}

async function getToken() {
  // Sengaja TANPA fallback ke ANON_KEY (hasil audit keamanan Agustus: gak
  // boleh diam-diam turun ke anon kalau sesi hilang).
  const t = await window.PNMAuth?.getAccessToken?.();
  if (!t) throw new Error('Sesi login habis, silakan masuk lagi.');
  return t;
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function icon(name, cls) {
  const i = el('i', 'ti ' + name + (cls ? ' ' + cls : ''));
  i.setAttribute('aria-hidden', 'true');
  return i;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Gagal membaca file'));
    r.readAsDataURL(blob);
  });
}

// Blob gambar apa pun -> {dataUrl (PNG), width, height}, sisi terpanjang
// dibatasi IMG_MAX_SIDE. Lewat canvas supaya webp/jpeg/png semua seragam jadi
// PNG yang dikenal jsPDF dan alpha-nya tetap.
const IMG_MAX_BYTES = 20 * 1024 * 1024;   // batas file upload manual
const IMG_MAX_PIXELS = 40 * 1000 * 1000;  // batas piksel (anti decompression bomb)

async function blobToPngImage(blob) {
  if (!blob || !/^image\//i.test(blob.type || '')) throw new Error('File harus berupa gambar');
  if (blob.size > IMG_MAX_BYTES) throw new Error('Ukuran gambar maksimal 20 MB');
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('File bukan gambar yang valid'));
      i.src = url;
    });
    if (!img.naturalWidth || !img.naturalHeight || img.naturalWidth * img.naturalHeight > IMG_MAX_PIXELS) {
      throw new Error('Dimensi gambar tidak valid atau terlalu besar');
    }
    const scale = Math.min(1, IMG_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    return { dataUrl: canvas.toDataURL('image/png'), width: w, height: h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---- state modul (di-reset di mount/unmount) ------------------------------
let alive = false;
let root = null;
let items = [];
let nextId = 1;
let runId = 0;              // naik tiap "Ambil Data" baru -> hasil lama diabaikan
let previewUrl = null;
let previewId = null;       // id item yang sedang tampil di preview (tab Spesifikasi)
let previewBusy = false;
let livePreviewTimer = null;
let pendingReplaceId = null;
let logosPromise = null;
let handlers = [];
let activeTab = 'spek';
let resetTimer = null;
let currentUid = null;
const subUnmount = {};      // nama tab -> fungsi unmount tab itu
const decor = {};           // nama tab -> fungsi bersihkan dekorasi panel

// Snapshot yang SENGAJA hidup di luar mount/unmount (module-level), supaya
// pindah modul lalu balik tidak menghapus kerjaan user. Dibuang kalau uid beda.
let saved = null;           // { uid, tab, fields, items, nextId }

const narrowMQ = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(max-width: 980px)') : { matches: false };

function toast(msg, type = 'success') {
  const host = document.getElementById('smToastRoot');
  if (!host) return;
  const t = el('div', 'toast ' + type);
  t.appendChild(el('span', 'dot'));
  t.appendChild(el('span', '', msg));
  host.appendChild(t);
  requestAnimationFrame(() => t.classList.add('in'));
  setTimeout(() => {
    t.classList.remove('in');
    setTimeout(() => t.remove(), 200);
  }, 3200);
}

// ---- data ----------------------------------------------------------------
async function fetchProduk(codes) {
  const token = await getToken();
  const list = codes.map((c) => '"' + c.replace(/["\\]/g, '') + '"').join(',');
  const select = ['kode_produk', 'kode_asli', 'nama_produk', 'spesifikasi'].join(',');
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/produk?kode_produk=in.(${encodeURIComponent(list)})&select=${select}&limit=${codes.length}`,
    { headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + token } }
  );
  if (res.status === 401) throw new Error('Sesi login habis, silakan masuk lagi.');
  if (!res.ok) throw new Error('Gagal mengambil data produk (HTTP ' + res.status + ')');
  return res.json();
}

async function loadBucketImage(it) {
  const key = String(it.kodeAsli || it.kode).trim();
  if (!key || /[\/\\]/.test(key) || key.includes('..')) throw new Error('kode tidak valid untuk nama file');
  if (typeof window.PNM_getSignedUrl !== 'function') throw new Error('PNM_getSignedUrl belum tersedia');
  const url = await window.PNM_getSignedUrl('thumbnails', key + '.png');
  const res = await fetch(url);
  if (!res.ok) throw new Error('gambar tidak ada di bucket');
  return blobToPngImage(await res.blob());
}

async function loadImagesFor(list, myRun) {
  let idx = 0;
  const worker = async () => {
    while (idx < list.length) {
      const it = list[idx++];
      try {
        const img = await loadBucketImage(it);
        if (!alive || myRun !== runId) return;
        it.image = img;
        it.imgState = 'ok';
        it.imgSource = 'bucket';
      } catch (err) {
        if (!alive || myRun !== runId) return;
        it.image = null;
        it.imgState = 'missing';
      }
      renderRow(it);
      if (previewId === it.id) schedulePreviewRefresh(it);
    }
  };
  await Promise.all(Array.from({ length: Math.min(IMG_CONCURRENCY, list.length) }, worker));
}

// ---- render --------------------------------------------------------------
function statusTag(it) {
  const t = el('span', 'sm-tag');
  const dot = el('span', 'dot');
  t.appendChild(dot);
  let label;
  if (it.imgState === 'loading') label = 'Memuat gambar...';
  else if (it.imgState === 'ok') { t.classList.add('ok'); label = it.imgSource === 'manual' ? 'Gambar manual' : 'Gambar dari bucket'; }
  else { t.classList.add('warn'); label = 'Gambar belum ada'; }
  t.appendChild(el('span', '', label));
  return t;
}

function buildRow(it) {
  const row = el('div', 'sm-row' + (it.id === previewId ? ' is-previewing' : ''));
  row.dataset.id = String(it.id);

  const thumb = el('div', 'sm-thumb');
  if (it.image) {
    const img = document.createElement('img');
    img.src = it.image.dataUrl;
    img.alt = '';
    thumb.appendChild(img);
  } else {
    thumb.appendChild(icon(it.imgState === 'loading' ? 'ti-loader-2' : 'ti-photo-off'));
  }

  const main = el('div', 'sm-row-main');
  const head = el('div', 'sm-row-head');
  head.appendChild(el('span', 'sm-kode', it.kode));
  if (!it.found) {
    const nf = el('span', 'sm-tag warn');
    nf.appendChild(el('span', 'dot'));
    nf.appendChild(el('span', '', 'Tidak ada di database, isi manual'));
    head.appendChild(nf);
  }
  head.appendChild(statusTag(it));

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'field-input';
  input.value = it.deskripsi;
  input.placeholder = 'Deskripsi / spesifikasi item';
  input.setAttribute('aria-label', 'Deskripsi untuk ' + it.kode);
  input.dataset.field = 'deskripsi';

  const tools = el('div', 'sm-row-tools');
  const mk = (action, iconName, label, extra) => {
    const b = el('button', 'sm-link-btn' + (extra ? ' ' + extra : ''));
    b.type = 'button';
    b.dataset.action = action;
    b.dataset.id = String(it.id);
    b.appendChild(icon(iconName));
    b.appendChild(document.createTextNode(' ' + label));
    return b;
  };
  tools.appendChild(mk('replace-image', 'ti-photo-up', 'Ganti gambar'));
  tools.appendChild(mk('preview-item', 'ti-eye', 'Preview'));
  tools.appendChild(mk('remove-item', 'ti-x', 'Hapus', 'danger'));

  main.append(head, input, tools);
  row.append(thumb, main);
  return row;
}

function renderRow(it) {
  const list = document.getElementById('smList');
  if (!list) return;
  const old = list.querySelector(`.sm-row[data-id="${it.id}"]`);
  if (!old) return;
  // jaga fokus kalau user lagi ngetik di input baris ini
  const focused = old.contains(document.activeElement) && document.activeElement.dataset.field === 'deskripsi';
  const caret = focused ? document.activeElement.selectionStart : null;
  const fresh = buildRow(it);
  old.replaceWith(fresh);
  if (focused) {
    const inp = fresh.querySelector('input');
    inp.focus();
    if (caret != null) inp.setSelectionRange(caret, caret);
  }
  updateSummary();
}

function updateSummary() {
  const node = document.getElementById('smListSummary');
  if (!node) return;
  const found = items.filter((i) => i.found).length;
  const missing = items.length - found;
  const loading = items.filter((i) => i.imgState === 'loading').length;
  const noImg = items.filter((i) => i.imgState !== 'loading' && !i.image).length;
  const parts = [`${items.length} kode`, `${found} ditemukan di database`];
  if (missing) parts.push(`${missing} tidak ada`);
  if (loading) parts.push(`memuat ${loading} gambar…`);
  else if (noImg) parts.push(`${noImg} tanpa gambar`);
  node.textContent = parts.join(' · ');
}

function updateDownloadLabel() {
  const l = document.getElementById('smDownloadLabel');
  if (l) l.textContent = items.length > 1 ? 'Unduh ZIP' : 'Unduh PDF';
}

function renderList() {
  const card = document.getElementById('smListCard');
  const list = document.getElementById('smList');
  if (!card || !list) return;
  card.style.display = items.length ? '' : 'none';
  list.replaceChildren(...items.map(buildRow));
  updateSummary();
  updateDownloadLabel();
  if (!items.length) hidePreview();
}

// Status di bawah textarea: jumlah kode, duplikat, dan batas maksimum.
function updateCodeStatus() {
  const node = document.getElementById('smCodeStatus');
  const input = document.getElementById('smCodes');
  if (!node || !input) return;
  const tokens = String(input.value).split(/[\s,;]+/).filter(Boolean);
  const uniq = parseCodes(input.value);
  node.classList.remove('is-warn', 'is-err');
  if (!tokens.length) { node.textContent = ''; return; }
  const dup = tokens.length - uniq.length;
  let text = `${uniq.length} kode terbaca`;
  if (dup) text += ` · ${dup} duplikat dibuang`;
  if (uniq.length > MAX_CODES) {
    text += ` · maksimal ${MAX_CODES}, sisanya diabaikan`;
    node.classList.add('is-warn');
  }
  node.textContent = text;
}

// ---- PDF -----------------------------------------------------------------
async function ensureLogos() {
  if (!logosPromise) {
    logosPromise = (async () => {
      try {
        const [robust, pnm] = await Promise.all(Object.values(LOGO_URLS).map(async (u) => {
          const res = await fetch(u);
          if (!res.ok) throw new Error('HTTP ' + res.status + ' untuk ' + u);
          return blobToDataUrl(await res.blob());
        }));
        return { robust, pnm };
      } catch (err) {
        logosPromise = null;
        throw new Error('Logo tidak ditemukan di /assets/ (robust-logo.png, pnm-logo.png) (' + err.message + ')');
      }
    })();
  }
  return logosPromise;
}

async function makeDoc(it) {
  await loadScript(JSPDF_SRC, JSPDF_SRI);
  const [fonts, logos] = await Promise.all([loadSpekFonts(), ensureLogos()]);
  return buildSpekPdf(window.jspdf.jsPDF, {
    kode: it.kode,
    deskripsi: it.deskripsi.trim(),
    image: it.image,
    logos,
    fonts,
  });
}

function markPreviewing() {
  const list = document.getElementById('smList');
  if (!list) return;
  list.querySelectorAll('.sm-row').forEach((r) => {
    r.classList.toggle('is-previewing', previewId != null && r.dataset.id === String(previewId));
  });
}

function hidePreview() {
  clearTimeout(livePreviewTimer);
  previewId = null;
  const card = document.getElementById('smPreviewCard');
  const frame = document.getElementById('smPreviewFrame');
  if (frame) frame.removeAttribute('src');
  if (card) card.style.display = 'none';
  if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
  markPreviewing();
}

async function previewItem(it, opts = {}) {
  if (!it || previewBusy) return;
  previewBusy = true;
  const btn = document.getElementById('smPreviewBtn');
  if (!opts.silent && btn) btn.classList.add('is-loading');
  try {
    const doc = await makeDoc(it);
    if (!alive) return;
    // item dihapus / diganti selama PDF dibuat -> buang hasilnya
    if (!items.includes(it)) return;
    const url = URL.createObjectURL(doc.output('blob'));
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = url;
    previewId = it.id;
    document.getElementById('smPreviewFrame').src = url;
    document.getElementById('smPreviewTitle').textContent = 'Preview · ' + it.kode;
    const card = document.getElementById('smPreviewCard');
    card.style.display = '';
    markPreviewing();
    if (!opts.silent) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    toast(err.message || 'Gagal membuat preview', 'error');
  } finally {
    previewBusy = false;
    if (btn) btn.classList.remove('is-loading');
  }
}

// Preview yang sedang tampil ikut diperbarui saat deskripsi / gambar item itu
// berubah (di-debounce), jadi user cukup mengetik lalu melihat hasilnya.
function schedulePreviewRefresh(it) {
  if (!it || previewId !== it.id) return;
  clearTimeout(livePreviewTimer);
  livePreviewTimer = setTimeout(() => {
    if (!alive || previewId !== it.id || !items.includes(it)) return;
    if (previewBusy) { schedulePreviewRefresh(it); return; }
    previewItem(it, { silent: true });
  }, LIVE_PREVIEW_MS);
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

async function downloadAll() {
  if (!items.length) return;
  const btn = document.getElementById('smDownloadBtn');
  if (!btn || btn.disabled) return;
  const label = document.getElementById('smDownloadLabel');
  const empty = items.filter((i) => !i.deskripsi.trim()).length;
  const noImg = items.filter((i) => !i.image).length;
  const batch = items.slice();
  btn.disabled = true;
  btn.classList.add('is-loading');
  try {
    if (batch.length === 1) {
      if (label) label.textContent = 'Membuat PDF…';
      const doc = await makeDoc(batch[0]);
      triggerDownload(doc.output('blob'), fileSafeName(batch[0].kode));
    } else {
      await loadScript(JSZIP_SRC, JSZIP_SRI);
      const zip = new window.JSZip();
      const used = new Set();
      let n = 0;
      for (const it of batch) {
        if (label) label.textContent = `Membuat ${++n}/${batch.length}…`;
        const doc = await makeDoc(it);
        let name = fileSafeName(it.kode);
        for (let k = 2; used.has(name); k++) name = fileSafeName(it.kode + '_' + k);
        used.add(name);
        zip.file(name, doc.output('arraybuffer'));
      }
      if (label) label.textContent = 'Mengemas ZIP…';
      const blob = await zip.generateAsync({ type: 'blob' });
      const d = new Date();
      const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
      triggerDownload(blob, `spek-${stamp}.zip`);
    }
    if (empty || noImg) {
      toast(`Terunduh. Perhatian: ${empty} tanpa deskripsi, ${noImg} tanpa gambar.`, 'error');
    } else {
      toast('PDF terunduh');
    }
  } catch (err) {
    toast(err.message || 'Gagal membuat PDF', 'error');
  } finally {
    btn.disabled = false;
    btn.classList.remove('is-loading');
    updateDownloadLabel();
  }
}

// ---- actions -------------------------------------------------------------
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

function setResolving(on) {
  const btn = document.getElementById('smResolveBtn');
  const label = document.getElementById('smResolveLabel');
  if (!btn) return;
  btn.disabled = on;
  btn.classList.toggle('is-loading', on);
  const i = btn.querySelector('i');
  if (i) i.className = 'ti ' + (on ? 'ti-loader-2' : 'ti-search');
  if (label) label.textContent = on ? 'Mengambil…' : 'Ambil Data';
}

async function resolveCodes() {
  const input = document.getElementById('smCodes');
  const btn = document.getElementById('smResolveBtn');
  if (!input || (btn && btn.disabled)) return;
  let codes = parseCodes(input.value);
  if (!codes.length) { toast('Isi minimal satu kode.', 'error'); input.focus(); return; }
  if (codes.length > MAX_CODES) {
    toast(`Maksimal ${MAX_CODES} kode, sisanya diabaikan.`, 'error');
    codes = codes.slice(0, MAX_CODES);
  }
  const myRun = ++runId;
  setResolving(true);
  try {
    const rows = await fetchProduk(codes);
    if (!alive || myRun !== runId) return;
    const byKode = new Map(rows.map((r) => [String(r.kode_produk).toUpperCase(), r]));
    items = codes.map((c) => {
      const r = byKode.get(c.toUpperCase());
      return {
        id: nextId++,
        kode: r ? r.kode_produk : c,
        kodeAsli: r ? (r.kode_asli || '') : '',
        deskripsi: r ? String(r[DESC_FIELD] || r.nama_produk || '') : '',
        found: !!r,
        image: null,
        imgState: r ? 'loading' : 'missing',
        imgSource: null,
      };
    });
    hidePreview();
    renderList();
    await loadImagesFor(items.filter((i) => i.found), myRun);
  } catch (err) {
    toast(err.message || 'Gagal mengambil data', 'error');
  } finally {
    if (alive) setResolving(false);
  }
}

function itemById(id) { return items.find((i) => String(i.id) === String(id)); }

async function onFilePicked(file) {
  const it = itemById(pendingReplaceId);
  pendingReplaceId = null;
  if (!it || !file) return;
  try {
    it.image = await blobToPngImage(file);
    it.imgState = 'ok';
    it.imgSource = 'manual';
    if (!alive) return;
    renderRow(it);
    schedulePreviewRefresh(it);
  } catch (err) {
    toast(err.message || 'Gagal membaca gambar', 'error');
  }
}

function removeItem(id) {
  const it = itemById(id);
  if (!it) return;
  if (previewId === it.id) hidePreview();
  items = items.filter((i) => i !== it);
  renderList();
  if (!items.length) document.getElementById('smCodes')?.focus();
}

function listen(target, type, fn) {
  target.addEventListener(type, fn);
  handlers.push(() => target.removeEventListener(type, fn));
}

// ---- tab -----------------------------------------------------------------
// Satu sumber kebenaran per tab: panel, teks breadcrumb, petunjuk toolbar,
// teks placeholder preview, dan (untuk tab selain Spesifikasi) fungsi mount.
const subCfg = () => ({ SUPABASE_URL, ANON_KEY, JSPDF_SRC, JSPDF_SRI, JSZIP_SRC, JSZIP_SRI });

const TABS = {
  spek: {
    panelId: 'smPanelSpek',
    crumb: 'Spesifikasi',
    hint: 'Lembar spesifikasi PDF dari kode produk. Deskripsi dan gambar diambil otomatis.',
    empty: ['Preview PDF muncul di sini', 'Ambil data, lalu klik Preview pada item mana pun. Preview ikut berubah saat deskripsi diedit.'],
  },
  struktur: {
    panelId: 'smPanelStruktur',
    crumb: 'Struktur Harga',
    hint: 'Struktur harga per kode: nama tayang, harga e-Katalog, AKD dan masa berlakunya.',
    empty: ['Preview PDF muncul di sini', 'Ambil data, koreksi isiannya kalau perlu, lalu klik Preview.'],
    mount: (panel) => mountStruktur(panel, {
      toast, loadScript, getToken, el, triggerDownload, cfg: subCfg(),
    }),
  },
  spp: {
    panelId: 'smPanelSpp',
    crumb: 'SPP',
    hint: 'Surat Permohonan Presentasi ke rumah sakit. Tanpa kode, harga, atau link.',
    empty: ['Preview surat muncul di sini', 'Isi formulir di kiri lalu klik Generate SPP.'],
    mount: (panel) => mountSpp(panel, {
      toast, loadScript, triggerDownload, cfg: { JSPDF_SRC, JSPDF_SRI },
    }),
  },
  lampiran: {
    panelId: 'smPanelLampiran',
    crumb: 'Lampiran Set',
    hint: 'Lampiran isi set: kode, deskripsi, qty, dan gambar tiap instrumen.',
    empty: ['Preview PDF muncul di sini', 'Ambil data set, koreksi isinya, lalu klik Preview.'],
    mount: (panel) => mountLampiran(panel, {
      toast, loadScript, getToken, el, triggerDownload,
      loadBucketImage, blobToPngImage, ensureLogos, cfg: subCfg(),
    }),
  },
  bulk: {
    panelId: 'smPanelBulk',
    crumb: 'Bulk',
    hint: 'Periksa ratusan kode sekaligus, lalu proses yang siap saja menjadi ZIP.',
    mount: (panel) => mountBulk(panel, {
      toast, loadScript, getToken, el, triggerDownload,
      loadBucketImage, ensureLogos, cfg: subCfg(),
    }),
  },
};
const TAB_ORDER = Object.keys(TABS);

// Kartu preview tiap tab (id berakhiran "PreviewCard") dijadikan kolom kanan
// yang sticky + diberi placeholder saat belum ada preview. Dilakukan dari sini
// supaya modul tab-nya sendiri tidak perlu diubah.
function decoratePanel(name) {
  if (decor[name]) { decor[name](); decor[name] = null; }
  const t = TABS[name];
  const panel = root && root.querySelector('#' + t.panelId);
  const card = panel && panel.querySelector('[id$="PreviewCard"]');
  if (!card) return;

  card.classList.add('sm-out');

  const empty = el('div', 'sm-preview-empty sm-out');
  empty.appendChild(icon('ti-file-search'));
  const [title, sub] = t.empty || ['Preview muncul di sini', ''];
  empty.appendChild(el('strong', '', title));
  empty.appendChild(el('span', '', sub));
  card.before(empty);

  const sync = () => { empty.hidden = card.style.display !== 'none'; };
  const mo = new MutationObserver(sync);
  mo.observe(card, { attributes: true, attributeFilter: ['style'] });
  sync();

  // Di layout dua panel preview sudah menempel di layar, jadi menggulung halaman
  // ke kartunya (perilaku lama di tiap tab) malah menggeser daftar di kiri.
  // Hanya dipakai di layout satu kolom (layar sempit), tempat preview ada di bawah.
  card.scrollIntoView = (opts) => {
    if (narrowMQ.matches) Element.prototype.scrollIntoView.call(card, opts);
  };

  decor[name] = () => { mo.disconnect(); empty.remove(); };
}

function mountSub(name) {
  const t = TABS[name];
  if (!t || !t.mount || !root) return;
  const panel = root.querySelector('#' + t.panelId);
  panel.replaceChildren();
  subUnmount[name] = t.mount(panel);
  decoratePanel(name);
}

function unmountSub(name) {
  if (subUnmount[name]) { try { subUnmount[name](); } catch (err) { console.error('unmount tab gagal:', name, err); } subUnmount[name] = null; }
  if (decor[name]) { decor[name](); decor[name] = null; }
}

function switchTab(name, opts = {}) {
  const active = TABS[name] ? name : 'spek';
  activeTab = active;
  TAB_ORDER.forEach((tab) => {
    const p = document.getElementById(TABS[tab].panelId);
    if (p) p.style.display = tab === active ? '' : 'none';
  });
  root.querySelectorAll('.sm-tab').forEach((t) => {
    const on = t.dataset.tab === active;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    if (on && opts.focus) t.focus();
  });
  const crumb = document.getElementById('smCrumb');
  if (crumb) crumb.textContent = TABS[active].crumb;
  const hint = document.getElementById('smHint');
  if (hint) { hint.textContent = TABS[active].hint; hint.title = TABS[active].hint; }
  disarmReset();
}

// Panah kiri/kanan, Home, End memindah tab (pola WAI-ARIA tabs).
function onTabKey(e) {
  const tab = e.target.closest('.sm-tab');
  if (!tab) return;
  const i = TAB_ORDER.indexOf(tab.dataset.tab);
  let j = -1;
  if (e.key === 'ArrowRight') j = (i + 1) % TAB_ORDER.length;
  else if (e.key === 'ArrowLeft') j = (i - 1 + TAB_ORDER.length) % TAB_ORDER.length;
  else if (e.key === 'Home') j = 0;
  else if (e.key === 'End') j = TAB_ORDER.length - 1;
  if (j < 0) return;
  e.preventDefault();
  switchTab(TAB_ORDER[j], { focus: true });
}

// ---- reset (klik dua kali: kerjaan user gak boleh hilang karena salah klik) --
function setResetLabel(text, armed) {
  const label = document.getElementById('smResetLabel');
  const btn = document.getElementById('smResetBtn');
  if (label) label.textContent = text;
  if (btn) btn.classList.toggle('is-armed', !!armed);
}

function disarmReset() {
  clearTimeout(resetTimer);
  resetTimer = null;
  setResetLabel('Reset', false);
}

function resetSpek() {
  runId++;
  items = [];
  nextId = 1;
  pendingReplaceId = null;
  hidePreview();
  const input = document.getElementById('smCodes');
  if (input) input.value = '';
  setResolving(false);
  renderList();
  updateCodeStatus();
  if (input) input.focus();
}

function onResetClick() {
  if (!resetTimer) {
    setResetLabel('Yakin reset?', true);
    resetTimer = setTimeout(disarmReset, RESET_ARM_MS);
    return;
  }
  disarmReset();
  const name = activeTab;
  if (name === 'spek') resetSpek();
  else {
    unmountSub(name);
    mountSub(name);
    root.querySelector('#' + TABS[name].panelId + ' textarea, #' + TABS[name].panelId + ' input[type="text"]')?.focus();
  }
  toast(`Tab ${TABS[name].crumb} di-reset`);
}

// ---- snapshot isian (bertahan saat pindah modul) -----------------------------
const SKIP_FIELD_IDS = new Set(['smFileInput', 'spTanggal']); // tanggal SPP selalu "hari ini"

function snapshotFields() {
  const fields = {};
  root.querySelectorAll('input, textarea, select').forEach((n) => {
    if (n.type === 'file' || SKIP_FIELD_IDS.has(n.id)) return;
    const key = n.id ? '#' + n.id : (n.dataset.isian ? '@' + n.dataset.isian : null);
    if (!key) return;
    fields[key] = n.type === 'checkbox' ? { c: n.checked } : { v: n.value };
  });
  return fields;
}

function restoreFields(fields) {
  Object.entries(fields || {}).forEach(([key, val]) => {
    const n = key[0] === '#'
      ? root.querySelector('#' + CSS.escape(key.slice(1)))
      : root.querySelector(`[data-isian="${CSS.escape(key.slice(1))}"]`);
    if (!n) return;
    if (n.type === 'checkbox') n.checked = !!val.c;
    else n.value = val.v;
    // modul tab menyimpan sebagian state di closure-nya sendiri (mis. perusahaan SPP,
    // isian Struktur Harga) dan membacanya lewat event -> picu event yang sama.
    n.dispatchEvent(new Event(n.tagName === 'SELECT' || n.type === 'checkbox' ? 'change' : 'input', { bubbles: true }));
  });
}

function takeSnapshot() {
  if (!root) return;
  saved = {
    uid: currentUid,
    tab: activeTab,
    fields: snapshotFields(),
    items,
    nextId,
  };
}

// ---- mount / unmount -----------------------------------------------------
export async function mount(container) {
  await loadLink(STYLE_ID, new URL('./style.css', import.meta.url).href);
  const uidPromise = Promise.resolve(window.PNMAuth?.getUser?.()).then((u) => (u && u.id) || null).catch(() => null);

  container.innerHTML = SPEK_MAKER_MARKUP;
  root = container;
  alive = true;
  items = [];
  nextId = 1;
  previewId = null;
  previewBusy = false;
  activeTab = 'spek';

  // Kartu preview tab Spesifikasi + tab lain: modul masing-masing di-mount ke panelnya.
  // Loader gambar bucket, konversi PNG, dan logo dipakai bersama lewat deps.
  decoratePanel('spek');
  TAB_ORDER.filter((n) => TABS[n].mount).forEach(mountSub);

  listen(container, 'click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || !container.contains(btn)) return;
    switch (btn.dataset.action) {
      case 'tab': switchTab(btn.dataset.tab); break;
      case 'reset-tab': onResetClick(); break;
      case 'resolve-codes': resolveCodes(); break;
      case 'preview-first': previewItem(items[0]); break;
      case 'preview-item': previewItem(itemById(btn.dataset.id)); break;
      case 'download-all': downloadAll(); break;
      case 'replace-image':
        pendingReplaceId = btn.dataset.id;
        document.getElementById('smFileInput').click();
        break;
      case 'remove-item': removeItem(btn.dataset.id); break;
      default: break;
    }
  });

  listen(container, 'keydown', (e) => {
    onTabKey(e);
    // Ctrl+Enter di textarea = Ambil Data
    if (e.target.id === 'smCodes' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      resolveCodes();
    }
  });

  // edit deskripsi: update state tanpa re-render (biar fokus gak lepas);
  // ketik di textarea kode: status jumlah kode diperbarui langsung.
  listen(container, 'input', (e) => {
    const inp = e.target;
    if (inp.id === 'smCodes') { updateCodeStatus(); return; }
    if (!(inp instanceof HTMLInputElement) || inp.dataset.field !== 'deskripsi') return;
    const it = itemById(inp.closest('.sm-row')?.dataset.id);
    if (!it) return;
    it.deskripsi = inp.value;
    schedulePreviewRefresh(it);
  });

  listen(container, 'change', (e) => {
    if (e.target.id === 'smFileInput') {
      onFilePicked(e.target.files && e.target.files[0]);
      e.target.value = '';
    }
  });

  switchTab('spek');

  // Pulihkan kerjaan sebelumnya kalau user yang login masih sama.
  currentUid = await uidPromise;
  if (!alive) return;
  const snap = saved;
  saved = null;
  if (snap && snap.uid === currentUid) {
    items = Array.isArray(snap.items) ? snap.items : [];
    nextId = snap.nextId || 1;
    restoreFields(snap.fields);
    // gambar yang tadinya masih dimuat saat user pindah modul -> lanjutkan
    const pending = items.filter((i) => i.found && i.imgState === 'loading');
    renderList();
    updateCodeStatus();
    switchTab(snap.tab);
    if (pending.length) loadImagesFor(pending, ++runId);
  }
}

export function unmount() {
  takeSnapshot();
  TAB_ORDER.forEach(unmountSub);
  if (decor.spek) { decor.spek(); decor.spek = null; }
  alive = false;
  runId++;
  clearTimeout(livePreviewTimer);
  clearTimeout(resetTimer);
  resetTimer = null;
  handlers.forEach((off) => off());
  handlers = [];
  if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
  document.getElementById('smToastRoot')?.remove();
  document.getElementById(STYLE_ID)?.remove();
  items = [];
  previewId = null;
  pendingReplaceId = null;
  root = null;
}

// Dipakai modul uploader-wiki supaya paket upload memakai generator PDF/gambar yang SAMA dengan tab Bulk
// (tanpa menyalin kode). Semua helper di atas stateless -- aman dipanggil tanpa mount() halaman ini.
export function getBulkDeps() {
  return {
    loadScript, getToken, el, triggerDownload, loadBucketImage, blobToPngImage, ensureLogos,
    cfg: { SUPABASE_URL, ANON_KEY, JSPDF_SRC, JSPDF_SRI, JSZIP_SRC, JSZIP_SRI },
  };
}