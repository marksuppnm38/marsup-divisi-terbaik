// konversian/lampiran-pdf-download.js -- tombol "PDF" di modal rincian set.
//
// Memanggil mekanisme "Lampiran Set" milik Document Maker (spek-maker/lampiran-pdf.js:
// buildLampiranPdf) apa adanya, jadi hasilnya PERSIS sama dengan PDF dari tab
// Lampiran Set (kop logo ROBUST+PNM / ADLER, tabel biru / merah, 5 baris per halaman,
// baris TOTAL di halaman terakhir). Tidak ada layout yang digandakan di sini.
//
// Modul ini dimuat LAZY (import() dari index.js) supaya jsPDF + font PDF tidak ikut
// diunduh sampai tombolnya benar-benar dipencet.

import { buildLampiranPdf, loadLampiranFonts, lampiranFileName } from '../spek-maker/lampiran-pdf.js';

const LOGO_URLS = {
  robust: '/assets/robust-logo.png',
  pnm: '/assets/pnm-logo.png',
  adler: '/assets/adler-logo.png',
};

let logosPromise = null;
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Gagal membaca logo'));
    r.readAsDataURL(blob);
  });
}
function ensureLogos() {
  if (!logosPromise) {
    logosPromise = (async () => {
      try {
        const out = {};
        await Promise.all(Object.entries(LOGO_URLS).map(async ([k, url]) => {
          const res = await fetch(url);
          if (!res.ok) throw new Error('HTTP ' + res.status + ' untuk ' + url);
          out[k] = await blobToDataUrl(await res.blob());
        }));
        return out;
      } catch (err) {
        logosPromise = null;
        throw new Error('Logo tidak ditemukan di /assets/ (' + err.message + ')');
      }
    })();
  }
  return logosPromise;
}

// base64 PNG polos (hasil modal: fetchImageBase64 + removeBackground) -> {dataUrl,width,height}
function decodeImage(b64) {
  if (!b64) return Promise.resolve(null);
  const dataUrl = String(b64).startsWith('data:') ? b64 : 'data:image/png;base64,' + b64;
  return new Promise((resolve) => {
    const i = new Image();
    i.onload = () => resolve(i.naturalWidth > 0 && i.naturalHeight > 0
      ? { dataUrl, width: i.naturalWidth, height: i.naturalHeight }
      : null);
    i.onerror = () => resolve(null);
    i.src = dataUrl;
  });
}

// Kode di database berawalan RB; versi ADLER berawalan AD (sama dengan kodeBrand() di Lampiran Set).
const kodeBrand = (kode, brand) => (brand === 'adler' ? String(kode).replace(/^RB/i, 'AD') : String(kode));

// opts: { kodeSet, judul, brand: 'robust'|'adler', items: [{kode_produk,nama_produk,qty}],
//         imgs: [base64|null] sejajar dengan items, loadJsPdf: () => Promise }
// return: { blob, filename, tanpaGambar }
export async function buatLampiranPdfRincian(opts) {
  const { kodeSet, judul, brand: brandIn, items, imgs, loadJsPdf } = opts;
  const brand = brandIn === 'adler' ? 'adler' : 'robust';
  await loadJsPdf();
  const [fonts, logos, images] = await Promise.all([
    loadLampiranFonts(brand),
    ensureLogos(),
    Promise.all(items.map((_, i) => decodeImage(imgs[i]))),
  ]);
  const doc = buildLampiranPdf(window.jspdf.jsPDF, {
    brand,
    judul: String(judul || kodeSet || '').trim(),
    items: items.map((it, i) => ({
      kode: kodeBrand(it.kode_produk, brand),
      deskripsi: String(it.nama_produk || '').trim(),
      qty: Number(it.qty ?? 1) || 0,
      image: images[i],
    })),
    logos,
    fonts,
  });
  return {
    blob: doc.output('blob'),
    filename: lampiranFileName(judul || kodeSet),
    tanpaGambar: images.filter((x) => !x).length,
  };
}
