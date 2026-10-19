// spek-maker/lampiran-pdf.js -- builder PDF "Lampiran Set" (daftar isi set).
//
// Meniru PDF contoh BASIC_TUMOR_MAMAE_S.pdf (hasil export Google Sheets,
// Letter 612x792pt, 5 baris per halaman, baris TOTAL di halaman terakhir).
// Semua angka di G di bawah DIUKUR LANGSUNG dari PDF itu (pdfplumber: garis
// tabel, bbox glyph, posisi & ukuran gambar), bukan ditebak -- sama pendekatan
// dengan pdf.js (lembar spesifikasi) dan struktur-pdf.js. Kalau template-nya
// berubah, cukup edit konstanta di sini.
//
// Di PDF aslinya SEMUA teks sudah di-outline (tidak ada teks yang bisa dipilih),
// jadi font ditentukan dari bentuk glyph + lebar ink: header = Roboto Bold,
// judul set = Nunito Bold (sama dengan label oranye di lembar spesifikasi),
// isi tabel = Calibri -> diganti Carlito (metrik identik, OFL). Nomor halaman
// = Arial -> Helvetica bawaan jsPDF.
//
// File ini TIDAK menyentuh DOM / Supabase / auth. Semua input (jsPDF, font,
// logo, gambar produk) disuntik dari luar, supaya bisa dites di Node.

import { fileSafeName } from './pdf.js';

export const G = {
  page: { w: 612, h: 792 },
  rowsPerPage: 5,
  // garis vertikal tabel (NO | KODE | DESKRIPSI | QTY | GAMBAR)
  vx: [50.66, 79.37, 178.03, 404.78, 459.57, 562.55],
  hx: [50.42, 562.79],                 // ujung garis horizontal
  band: { x0: 50.28, x1: 562.8 },      // lebar isi biru header/total
  headTop: 138.72,                     // atas pita header (garis atas di 139.07)
  topLineY: 139.07,
  headBottom: 157.93,                  // garis bawah header = atas baris 1
  // garis horizontal di bawah tiap baris data (ujung bawah baris 1..5)
  rowTops: [157.93, 257.75, 357.45, 457.16, 556.97, 656.68],
  totalH: 18.98,                       // tinggi baris TOTAL (garis ke garis)
  totalBaseOff: 12.85,                 // baseline TOTAL = garis atas baris TOTAL + ini
  lineW: 0.60075,
  blue: [0, 71, 109],                  // #00476D

  headFs: 9.4,
  headBaseline: 151.76,                // baseline teks header (atas pita + 13.04)
  // pusat ink tiap judul kolom (diukur; sedikit bergeser dari pusat kolom)
  headCx: [66.34, 130.1, 292.54, 432.35, 512.32],
  headLabels: ['NO', 'KODE', 'DESKRIPSI', 'QTY', 'GAMBAR'],

  bodyFs: 7.92,
  bodyLead: 9.74,                      // jarak baris kalau deskripsi membungkus
  bodyBaseOff: 2.46,                   // baseline 1 baris = tengah baris + ini
  colCx: { no: 65.05, kode: 128.7, desk: 291.4, qty: 432.2 },
  deskMaxW: 224.5,                     // lebar maksimum teks deskripsi (kolom 226.75)
  deskMaxLines: 6,

  // kotak gambar: sel dikurangi ~0.2pt; gambar di-fit (rasio dijaga) & ditengah
  imgBox: { x0: 459.72, x1: 562.32, inset: 0.23 },

  logoRobust: { x: 81.24, y: 74.16, w: 91.32, h: 10.92, aspect: 760 / 91 },
  logoPnm: { x: 447.24, y: 66.0, w: 103.68, h: 46.32, aspect: 726 / 321 },
  title: { x: 81.24, baseline: 101.3, size: 13.75, maxRight: 436, color: [221, 85, 14] },

  pageNo: { right: 590.8, baseline: 771.16, size: 10 },
};

// ---- Font ----------------------------------------------------------------
export const FONT_URLS = {
  robotoBold: 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/roboto@0.4.3/700Bold/Roboto_700Bold.ttf',
  nunitoBold: 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/nunito@0.4.2/700Bold/Nunito_700Bold.ttf',
  carlito: 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/carlito@0.4.1/400Regular/Carlito_400Regular.ttf',
};

let fontCache = null;

function bufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

// {robotoBold, nunitoBold, carlito} (base64) atau null kalau ada yang gagal
// diunduh -- pemanggil lalu jatuh ke Helvetica (tata letak tetap, font beda).
// Cuma sukses yang di-cache.
export function loadLampiranFonts() {
  if (!fontCache) {
    fontCache = (async () => {
      try {
        const entries = await Promise.all(Object.entries(FONT_URLS).map(async ([k, url]) => {
          const res = await fetch(url);
          if (!res.ok) throw new Error('font ' + k + ' HTTP ' + res.status);
          return [k, bufferToBase64(await res.arrayBuffer())];
        }));
        return Object.fromEntries(entries);
      } catch (err) {
        console.warn('lampiran-set: font gagal dimuat, pakai Helvetica:', err);
        fontCache = null;
        return null;
      }
    })();
  }
  return fontCache;
}

function registerFonts(doc, fonts) {
  if (!fonts) return { head: ['helvetica', 'bold'], title: ['helvetica', 'bold'], body: ['helvetica', 'normal'] };
  doc.addFileToVFS('Roboto-Bold.ttf', fonts.robotoBold);
  doc.addFont('Roboto-Bold.ttf', 'Roboto', 'bold');
  doc.addFileToVFS('Nunito-Bold.ttf', fonts.nunitoBold);
  doc.addFont('Nunito-Bold.ttf', 'Nunito', 'bold');
  doc.addFileToVFS('Carlito-Regular.ttf', fonts.carlito);
  doc.addFont('Carlito-Regular.ttf', 'Carlito', 'normal');
  return { head: ['Roboto', 'bold'], title: ['Nunito', 'bold'], body: ['Carlito', 'normal'] };
}

// ---- Util ----------------------------------------------------------------
export function lampiranFileName(judul) {
  // "BASIC TUMOR MAMAE S." -> "BASIC_TUMOR_MAMAE_S.pdf" (sama dengan nama file contoh)
  const base = String(judul || '').replace(/[.\s]+$/, '') || 'lampiran-set';
  return fileSafeName(base);
}

// Rasio asli PNG dari header IHDR (supaya logo tetap proporsional walau file
// di /assets diganti ukuran lain). Gagal baca -> rasio bawaan.
function pngAspect(dataUrl, fallback) {
  try {
    const head = atob(String(dataUrl).split(',')[1].slice(0, 44));
    const u32 = (o) => ((head.charCodeAt(o) << 24) | (head.charCodeAt(o + 1) << 16) | (head.charCodeAt(o + 2) << 8) | head.charCodeAt(o + 3)) >>> 0;
    const w = u32(16);
    const h = u32(20);
    return w > 0 && h > 0 ? w / h : fallback;
  } catch { return fallback; }
}

export function totalQty(items) {
  return items.reduce((s, it) => s + (Number(it.qty) > 0 ? Number(it.qty) : 0), 0);
}

// ---- Builder -------------------------------------------------------------
// jsPDF : konstruktor (window.jspdf.jsPDF di browser)
// opts  : { judul,
//           items: [{ kode, deskripsi, qty, image: {dataUrl,width,height}|null }],
//           logos: { robust: dataUrl, pnm: dataUrl },
//           fonts: hasil loadLampiranFonts() atau null }
export function buildLampiranPdf(jsPDF, opts) {
  const { judul = '', items = [], logos = {}, fonts = null } = opts;
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
  const F = registerFonts(doc, fonts);
  const per = G.rowsPerPage;
  const pageCount = Math.max(1, Math.ceil(items.length / per));
  const total = totalQty(items);

  const setFont = (f, size) => { doc.setFont(f[0], f[1]); doc.setFontSize(size); };

  function drawChrome(pageNo) {
    // -- logo ROBUST (kiri atas) & PNM (kanan atas)
    if (logos.robust) {
      const g = G.logoRobust;
      const h = g.w / pngAspect(logos.robust, g.aspect);
      doc.addImage(logos.robust, 'PNG', g.x, g.y + (g.h - h) / 2, g.w, h, undefined, 'FAST');
    }
    if (logos.pnm) {
      const g = G.logoPnm;
      const h = g.w / pngAspect(logos.pnm, g.aspect);
      doc.addImage(logos.pnm, 'PNG', g.x, g.y + (g.h - h) / 2, g.w, h, undefined, 'FAST');
    }

    // -- judul set (oranye); font dikecilkan kalau kepanjangan
    const T = G.title;
    setFont(F.title, T.size);
    let size = T.size;
    const text = String(judul || '');
    while (doc.getTextWidth(text) > T.maxRight - T.x && size > 8) {
      size -= 0.25;
      doc.setFontSize(size);
    }
    doc.setTextColor(...T.color);
    doc.text(text, T.x, T.baseline);

    // -- nomor halaman (Arial -> Helvetica), rata kanan
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(G.pageNo.size);
    doc.text(String(pageNo), G.pageNo.right, G.pageNo.baseline, { align: 'right' });
  }

  function drawTable(rows, isLast) {
    const n = rows.length;
    const bottomLine = isLast ? G.rowTops[n] + G.totalH : G.rowTops[n];

    // -- pita biru header (+ TOTAL di halaman terakhir)
    doc.setFillColor(...G.blue);
    doc.rect(G.band.x0, G.headTop, G.band.x1 - G.band.x0, G.headBottom - G.headTop, 'F');
    if (isLast) {
      const top = G.rowTops[n] - 0.28;
      doc.rect(G.band.x0, top, G.band.x1 - G.band.x0, bottomLine + 0.42 - top, 'F');
    }

    // -- garis tabel (hitam, hairline)
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(G.lineW);
    const [hx0, hx1] = G.hx;
    doc.line(hx0, G.topLineY, hx1, G.topLineY);
    doc.line(hx0, G.headBottom, hx1, G.headBottom);
    for (let i = 1; i <= n; i++) doc.line(hx0, G.rowTops[i], hx1, G.rowTops[i]);
    if (isLast) doc.line(hx0, bottomLine, hx1, bottomLine);
    G.vx.forEach((x) => doc.line(x, G.headTop - 0.01, x, bottomLine + 0.24));

    // -- teks header (putih, Roboto Bold)
    doc.setTextColor(255, 255, 255);
    setFont(F.head, G.headFs);
    G.headLabels.forEach((lb, i) => doc.text(lb, G.headCx[i], G.headBaseline, { align: 'center' }));

    // -- baris data
    rows.forEach((it, i) => {
      const top = G.rowTops[i];
      const bot = G.rowTops[i + 1];
      const mid = (top + bot) / 2;

      doc.setTextColor(0, 0, 0);
      setFont(F.body, G.bodyFs);
      const noLabel = String(it.no);
      doc.text(noLabel, G.colCx.no, mid + G.bodyBaseOff, { align: 'center' });
      doc.text(String(it.kode || ''), G.colCx.kode, mid + G.bodyBaseOff, { align: 'center' });
      doc.text(String(Number(it.qty) > 0 ? Number(it.qty) : 0), G.colCx.qty, mid + G.bodyBaseOff, { align: 'center' });

      // deskripsi: dibungkus, rata tengah horizontal & vertikal
      const lines = doc.splitTextToSize(String(it.deskripsi || ''), G.deskMaxW).slice(0, G.deskMaxLines);
      const first = mid + G.bodyBaseOff - ((lines.length - 1) * G.bodyLead) / 2;
      lines.forEach((ln, li) => doc.text(ln, G.colCx.desk, first + li * G.bodyLead, { align: 'center' }));

      // gambar: fit ke kotak sel, rasio dijaga, di tengah
      const im = it.image;
      if (im && im.dataUrl && im.width > 0 && im.height > 0) {
        const bx0 = G.imgBox.x0, bx1 = G.imgBox.x1;
        const by0 = top + G.imgBox.inset, by1 = bot - G.imgBox.inset;
        const s = Math.min((bx1 - bx0) / im.width, (by1 - by0) / im.height);
        const w = im.width * s, h = im.height * s;
        const fmt = /^data:image\/jpe?g/i.test(im.dataUrl) ? 'JPEG' : 'PNG';
        doc.addImage(im.dataUrl, fmt, (bx0 + bx1) / 2 - w / 2, (by0 + by1) / 2 - h / 2, w, h, undefined, 'FAST');
      }
    });

    // -- baris TOTAL
    if (isLast) {
      const base = G.rowTops[n] + G.totalBaseOff;
      doc.setTextColor(255, 255, 255);
      setFont(F.head, G.headFs);
      doc.text('TOTAL', 292.6, base, { align: 'center' });
      doc.text(String(total), 431.99, base, { align: 'center' });
    }
  }

  for (let p = 0; p < pageCount; p++) {
    if (p > 0) doc.addPage('letter', 'portrait');
    const rows = items.slice(p * per, (p + 1) * per).map((it, i) => ({ ...it, no: p * per + i + 1 }));
    drawTable(rows, p === pageCount - 1);
    drawChrome(p + 1);
  }

  doc.setProperties({ title: String(judul || 'Lampiran Set'), creator: 'PNM-BARE TOOLS' });
  return doc;
}