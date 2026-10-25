// uploader-wiki / bundle.js
// Membuat PAKET UPLOAD per operator (zip) dengan generator yang SAMA dengan tab Bulk di Document Maker:
//   SPEK/<KODE>.pdf, STRUKTUR_HARGA/<KODE>.pdf  (spek-maker/pdf.js, struktur-pdf.js, struktur-harga.js)
//   THUMBNAILS/<kode_asli>.png                   thumbnail GABUNGAN (template + gambar produk) -- dirender dengan
//                                                export-gambar/render-core.js, identik dengan hasil Export Gambar
//   MASTER.xlsx                                  (build.js)  + AKD_DIBUTUHKAN.txt + BACA_DULU.txt + (opsional) script Tampermonkey
// AKD/ dan STATIC_DOC/ TIDAK bisa dibuat web app -> user mengunduhnya dari Drive (dijelaskan di BACA_DULU.txt).
//
// Helper umum (loadScript, token, logo, loader gambar bucket) diambil dari spek-maker/index.js lewat getBulkDeps().

import { buildSpekPdf, loadSpekFonts } from '../spek-maker/pdf.js';
import { buildStrukturPdf, loadStrukturFonts } from '../spek-maker/struktur-pdf.js';
import { buatItem } from '../spek-maker/struktur-harga.js';
import { toAoa, akdNeeded, staticFilesNeeded, readmeText } from './build.js';
import { TEMPLATES, THUMBNAILS_BUCKET, loadImageWithRetry, renderThumbnailBlob } from '../export-gambar/render-core.js';

const RPC_CHUNK = 50;
const RPC_CONCURRENCY = 3;
const IMG_CHECK_CONCURRENCY = 6;
const PDF_CONCURRENCY = 3;
const SHEETJS_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
// Nama file di dalam paket (yang dipasang user) vs nama file di server. Di server memakai .txt dan ditaruh di assets/ (root repo):
// build produksi menyalin assets/ apa adanya, tapi TIDAK menyalin file non-JS dari app/pages/** dan bisa mengutak-atik file .js.
export const SCRIPT_FILE = 'inaproc-upload-v6.user.js';
export const SCRIPT_ASSET = 'inaproc-upload-v6.user.txt';

export async function getDeps() {
  const mod = await import('../spek-maker/index.js');
  return mod.getBulkDeps();
}

async function pool(list, n, fn, stop) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => {
    while (i < list.length && !(stop && stop())) await fn(list[i++]);
  }));
}
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

function loadPlainScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src; s.onload = () => resolve(); s.onerror = () => reject(new Error('Gagal memuat ' + src));
    document.head.appendChild(s);
  });
}

// RPC yang sama dengan tab Struktur Harga: no_akd, harga_ekatalog, masa_berlaku, nama_tayang, ...
// Return Map(KODE_UPPER -> baris).
export async function fetchRpcMap(deps, codes, { onProgress, stop } = {}) {
  const token = await deps.getToken();
  const out = new Map();
  const parts = chunk(codes, RPC_CHUNK);
  let done = 0;
  await pool(parts, RPC_CONCURRENCY, async (part) => {
    const res = await fetch(`${deps.cfg.SUPABASE_URL}/rest/v1/rpc/get_struktur_harga_data`, {
      method: 'POST',
      headers: { apikey: deps.cfg.ANON_KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_kodes: part }),
    });
    if (res.status === 401) throw new Error('Sesi login habis, silakan masuk lagi.');
    if (res.status === 404) throw new Error('RPC get_struktur_harga_data belum ada di database.');
    if (!res.ok) throw new Error('Gagal mengambil data struktur (HTTP ' + res.status + ')');
    ((await res.json()) || []).forEach((r) => out.set(String(r.kode_produk).toUpperCase(), r));
    done += 1;
    if (onProgress) onProgress(done, parts.length);
  }, stop);
  return out;
}

// Cek ada/tidaknya thumbnail di bucket TANPA mengunduh isinya. Return Set(kode_asli yang ada).
export async function checkThumbs(deps, kodeAsliList, { onProgress, stop } = {}) {
  const ok = new Set();
  let done = 0;
  await pool(kodeAsliList, IMG_CHECK_CONCURRENCY, async (key) => {
    try {
      if (!key || /[\/\\]/.test(key) || key.includes('..')) return;
      const url = await window.PNM_getSignedUrl('thumbnails', key + '.png');
      if (!url) return;
      let res;
      try { res = await fetch(url, { method: 'HEAD' }); } catch { res = await fetch(url, { headers: { Range: 'bytes=0-0' } }); }
      if (res.ok) ok.add(key);
    } catch { /* dianggap tidak ada */ } finally {
      done += 1;
      if (onProgress && (done % 5 === 0 || done === kodeAsliList.length)) onProgress(done, kodeAsliList.length);
    }
  }, stop);
  return ok;
}

export async function fetchScriptText() {
  try {
    const res = await fetch('/assets/' + SCRIPT_ASSET);
    if (!res.ok) return null;
    const t = await res.text();
    return /==UserScript==/.test(t) ? t : null;
  } catch { return null; }
}

// Siapkan jsPDF + font + logo + gambar template thumbnail SEKALI untuk seluruh paket.
export async function prepareRenderer(deps, settings = {}) {
  await deps.loadScript(deps.cfg.JSPDF_SRC, deps.cfg.JSPDF_SRI);
  await deps.loadScript(deps.cfg.JSZIP_SRC, deps.cfg.JSZIP_SRI);
  await loadPlainScript(SHEETJS_SRC);
  const [spekFonts, strukturFonts, logos] = await Promise.all([loadSpekFonts(), loadStrukturFonts(), deps.ensureLogos()]);
  const tpl = TEMPLATES[settings.thumbTemplate] || TEMPLATES.robust;
  let templateImg;
  try {
    templateImg = await loadImageWithRetry(await window.PNM_getSignedUrl(THUMBNAILS_BUCKET, tpl.file));
  } catch (e) {
    throw new Error(`Template thumbnail ${tpl.label} (${tpl.file}) tidak bisa dimuat dari bucket "${THUMBNAILS_BUCKET}".`);
  }
  return { jsPDF: window.jspdf.jsPDF, spekFonts, strukturFonts, logos, tpl, templateImg };
}

// records: [{ p, rpc, row }]  (hanya yang lolos pemeriksaan). Return { blob, name, ok: [...row], gagal: [...teks] }.
export async function buildOperatorZip(deps, rend, { label, batchId, records, seed, settings, scriptText, onProgress, stop }) {
  const zip = new window.JSZip();
  const okRows = [];
  const gagal = [];
  let done = 0;
  let idSeq = 1;
  await pool(records, PDF_CONCURRENCY, async (rec) => {
    const kode = rec.row[0];
    const kodeAsli = rec.row[1];
    try {
      const url = await window.PNM_getSignedUrl('thumbnails', kodeAsli + '.png');
      const res = await fetch(url);
      if (!res.ok) throw new Error('thumbnail tidak bisa diunduh (HTTP ' + res.status + ')');
      const blob = await res.blob();
      const image = await deps.blobToPngImage(blob);   // untuk PDF Spesifikasi (sama dengan tab Bulk Spesifikasi)

      // THUMBNAILS/: render gabungan template + gambar produk dengan fungsi yang SAMA dengan Export Gambar.
      const objUrl = URL.createObjectURL(blob);
      let thumb;
      try { thumb = await renderThumbnailBlob(rend.templateImg, await loadImageWithRetry(objUrl), rend.tpl.box); } finally { URL.revokeObjectURL(objUrl); }

      const spek = buildSpekPdf(rend.jsPDF, { kode, deskripsi: String(rec.p.nama_produk || '').trim(), image, logos: rend.logos, fonts: rend.spekFonts });
      const item = buatItem(rec.rpc, kode, idSeq++);
      const struktur = buildStrukturPdf(rend.jsPDF, item, rend.strukturFonts);

      zip.file('SPEK/' + rec.row[24], spek.output('arraybuffer'));
      zip.file('STRUKTUR_HARGA/' + rec.row[30], struktur.output('arraybuffer'));
      zip.file('THUMBNAILS/' + rec.row[8], thumb);
      okRows.push(rec.row);
    } catch (err) {
      gagal.push(`${kode}: ${err.message || 'gagal'}`);
    }
    done += 1;
    if (onProgress) onProgress(done, records.length);
  }, stop);
  if (stop && stop()) return null;

  // MASTER hanya berisi SKU yang SEMUA berkasnya berhasil dibuat; urutan sama dengan urutan input.
  const order = new Map(records.map((r, i) => [r.row[0], i]));
  okRows.sort((a, b) => order.get(a[0]) - order.get(b[0]));

  const wb = window.XLSX.utils.book_new();
  const ws = window.XLSX.utils.aoa_to_sheet(toAoa(seed, okRows, { operator: label, batchId }));
  ws['!cols'] = seed.headers.concat(['OPERATOR', 'BATCH_ID']).map((h) => ({ wch: Math.min(40, Math.max(12, h.length)) }));
  window.XLSX.utils.book_append_sheet(wb, ws, 'MASTER');   // nama sheet WAJIB "MASTER"
  zip.file('MASTER.xlsx', window.XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));

  const akd = akdNeeded(okRows);
  zip.file('AKD_DIBUTUHKAN.txt', akd.join('\r\n') + '\r\n');
  zip.file('BACA_DULU.txt', readmeText({ operator: label, batchId, count: okRows.length, staticFiles: staticFilesNeeded(settings), hasScript: !!scriptText }));
  if (scriptText) zip.file(SCRIPT_FILE, scriptText);
  if (gagal.length) zip.file('GAGAL_DIBUAT.txt', gagal.join('\r\n') + '\r\n');

  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  const safe = String(label).replace(/[^A-Za-z0-9_-]+/g, '_');
  return { blob, name: `PAKET-${safe}-${batchId}.zip`, ok: okRows, gagal, akd };
}