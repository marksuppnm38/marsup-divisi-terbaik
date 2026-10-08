// spek-maker page module: mount(container) / unmount().
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

import { SPEK_MAKER_MARKUP } from './markup.js';
import { buildSpekPdf, loadSpekFonts, fileSafeName } from './pdf.js';

const SUPABASE_URL = 'https://ptkkbsemihcyndisjoor.supabase.co';
// anon key publik, sama dengan yang sudah ada di konversian/index.js
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB0a2tic2VtaWhjeW5kaXNqb29yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0Njc4MzgsImV4cCI6MjA5ODA0MzgzOH0.QsCqmcqQcXvz1f8bLkagvMbAGUBbBP-3Wa5Aore5OMo';

const DESC_FIELD = 'nama_produk'; // atau 'spesifikasi'
const MAX_CODES = 50;
const IMG_MAX_SIDE = 1200;       // gambar diperkecil dulu biar PDF gak bengkak
const IMG_CONCURRENCY = 6;

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
let pendingReplaceId = null;
let logosPromise = null;
let handlers = [];

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
  const row = el('div', 'sm-row');
  row.dataset.id = String(it.id);

  const thumb = el('div', 'sm-thumb');
  if (it.image) {
    const img = document.createElement('img');
    img.src = it.image.dataUrl;
    img.alt = '';
    thumb.appendChild(img);
  } else {
    const i = el('i', it.imgState === 'loading' ? 'ti ti-loader-2' : 'ti ti-photo-off');
    i.setAttribute('aria-hidden', 'true');
    thumb.appendChild(i);
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
  const mk = (action, icon, label, extra) => {
    const b = el('button', 'sm-link-btn' + (extra ? ' ' + extra : ''));
    b.type = 'button';
    b.dataset.action = action;
    b.dataset.id = String(it.id);
    const ic = el('i', 'ti ' + icon);
    ic.setAttribute('aria-hidden', 'true');
    b.appendChild(ic);
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
}

function renderList() {
  const card = document.getElementById('smListCard');
  const list = document.getElementById('smList');
  if (!card || !list) return;
  card.style.display = items.length ? '' : 'none';
  list.replaceChildren(...items.map(buildRow));
  const found = items.filter((i) => i.found).length;
  document.getElementById('smListSummary').textContent =
    `${items.length} kode · ${found} ditemukan di database`;
  document.getElementById('smDownloadLabel').textContent = items.length > 1 ? 'Unduh ZIP' : 'Unduh PDF';
  if (!items.length) hidePreview();
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

function hidePreview() {
  const card = document.getElementById('smPreviewCard');
  const frame = document.getElementById('smPreviewFrame');
  if (frame) frame.removeAttribute('src');
  if (card) card.style.display = 'none';
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
    document.getElementById('smPreviewFrame').src = url;
    document.getElementById('smPreviewTitle').textContent = 'Preview · ' + it.kode;
    const card = document.getElementById('smPreviewCard');
    card.style.display = '';
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    toast(err.message || 'Gagal membuat preview', 'error');
  }
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
  const empty = items.filter((i) => !i.deskripsi.trim()).length;
  const noImg = items.filter((i) => !i.image).length;
  btn.disabled = true;
  try {
    if (items.length === 1) {
      const doc = await makeDoc(items[0]);
      triggerDownload(doc.output('blob'), fileSafeName(items[0].kode));
    } else {
      await loadScript(JSZIP_SRC, JSZIP_SRI);
      const zip = new window.JSZip();
      const used = new Set();
      for (const it of items) {
        const doc = await makeDoc(it);
        let name = fileSafeName(it.kode);
        for (let n = 2; used.has(name); n++) name = fileSafeName(it.kode + '_' + n);
        used.add(name);
        zip.file(name, doc.output('arraybuffer'));
      }
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

async function resolveCodes() {
  const input = document.getElementById('smCodes');
  const btn = document.getElementById('smResolveBtn');
  let codes = parseCodes(input.value);
  if (!codes.length) { toast('Isi minimal satu kode.', 'error'); return; }
  if (codes.length > MAX_CODES) {
    toast(`Maksimal ${MAX_CODES} kode, sisanya diabaikan.`, 'error');
    codes = codes.slice(0, MAX_CODES);
  }
  const myRun = ++runId;
  btn.disabled = true;
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
    btn.disabled = false;
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
    renderRow(it);
  } catch (err) {
    toast(err.message || 'Gagal membaca gambar', 'error');
  }
}

function listen(target, type, fn) {
  target.addEventListener(type, fn);
  handlers.push(() => target.removeEventListener(type, fn));
}

// ---- mount / unmount -----------------------------------------------------
export async function mount(container) {
  await loadLink(STYLE_ID, new URL('./style.css', import.meta.url).href);
  container.innerHTML = SPEK_MAKER_MARKUP;
  root = container;
  alive = true;
  items = [];
  nextId = 1;

  listen(container, 'click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || !container.contains(btn)) return;
    switch (btn.dataset.action) {
      case 'resolve-codes': resolveCodes(); break;
      case 'preview-first': previewItem(items[0]); break;
      case 'preview-item': previewItem(itemById(btn.dataset.id)); break;
      case 'download-all': downloadAll(); break;
      case 'replace-image':
        pendingReplaceId = btn.dataset.id;
        document.getElementById('smFileInput').click();
        break;
      case 'remove-item':
        items = items.filter((i) => String(i.id) !== btn.dataset.id);
        renderList();
        break;
      default: break;
    }
  });

  // edit deskripsi: update state tanpa re-render (biar fokus gak lepas)
  listen(container, 'input', (e) => {
    const inp = e.target;
    if (!(inp instanceof HTMLInputElement) || inp.dataset.field !== 'deskripsi') return;
    const it = itemById(inp.closest('.sm-row')?.dataset.id);
    if (it) it.deskripsi = inp.value;
  });

  listen(container, 'change', (e) => {
    if (e.target.id === 'smFileInput') {
      onFilePicked(e.target.files && e.target.files[0]);
      e.target.value = '';
    }
  });

  // Ctrl+Enter di textarea = Ambil Data
  listen(container, 'keydown', (e) => {
    if (e.target.id === 'smCodes' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      resolveCodes();
    }
  });
}

export function unmount() {
  alive = false;
  runId++;
  handlers.forEach((off) => off());
  handlers = [];
  if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
  document.getElementById('smToastRoot')?.remove();
  document.getElementById(STYLE_ID)?.remove();
  items = [];
  pendingReplaceId = null;
  root = null;
}
