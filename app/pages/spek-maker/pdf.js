// spek-maker/pdf.js -- builder PDF "lembar spesifikasi" satu halaman.
//
// Meniru PDF contoh RBB-KEC-B076-U1R.pdf (hasil export Google Sheets,
// Letter 612x792pt). Semua angka di LAYOUT di bawah DIUKUR LANGSUNG dari PDF
// itu (pdfplumber: garis tabel, posisi gambar, baseline teks), bukan
// ditebak -- jadi kalau template-nya berubah, cukup edit konstanta di sini.
//
// File ini sengaja TIDAK menyentuh DOM / Supabase / auth. Semua input
// (jsPDF, font, logo, gambar produk) disuntik dari luar, supaya bisa dites
// di Node dan index.js tinggal urus UI + pengambilan data.

// ---- Layout (pt, origin kiri-ATAS seperti hasil ukur) ---------------------
export const LAYOUT = {
  page: { w: 612, h: 792 },
  box: { x0: 49.7, x1: 561.6, top: 53.5, bottom: 561.6 },
  // garis horizontal di dalam kotak: bawah header, bawah baris Kode,
  // bawah baris Spesifikasi, atas footer
  hLines: [158.1, 193.3, 236.7, 497.7],
  // garis vertikal: pemisah label|nilai (baris Kode + Spesifikasi) dan
  // kolom kosong di kanan baris Kode (ada di template asli)
  vLabel: { x: 191.8, from: 158.1, to: 236.7 },
  vExtra: { x: 431.1, from: 158.1, to: 193.3 },
  lineWidth: 0.68,
  logoRobust: { x: 75.5, y: 67.3, w: 306.4, aspect: 2048 / 243 },
  logoPnm: { x: 443.0, y: 506.2, w: 93.5, aspect: 726 / 321 },
  tagline: { text: 'Surgical Instruments', x: 61.07, baseline: 141.54, size: 17.6 },
  labelX: 52.43,
  valueX: 194.13,
  valueRight: 556, // batas kanan teks nilai (kotak berakhir di 561.6)
  rowKode: { top: 158.1, bottom: 193.3, labelBaseline: 180.76, valueBaseline: 179.7 },
  rowSpek: { top: 193.3, bottom: 236.7, labelBaseline: 220.08 },
  labelSize: 16.7,
  valueSize: 11.5,
  labelColor: [221, 85, 14], // oranye label (#DD550E, dari PDF asli)
  // area gambar produk: gambar di-fit (rasio dijaga) ke dalam kotak ini,
  // diletakkan di tengah area antara garis ke-3 dan ke-4. Lebar 240pt = lebar
  // gambar di PDF contoh (238.6pt); tinggi 190pt buat gambar yang lebih tegak
  imageArea: { x0: 49.7, x1: 561.6, top: 236.7, bottom: 497.7 },
  imageMax: { w: 240, h: 190 },
};

// Template asli punya teks putih (tak terlihat) "TAK ISI BIAR BISA SELECT ALL"
// di header & footer -- trik supaya Ctrl+A di PDF viewer menyeleksi seluruh
// halaman. Dipertahankan apa adanya biar perilaku PDF baru = PDF lama.
export const HIDDEN_FILLER = true;

// ---- Font ----------------------------------------------------------------
// PDF asli: Nunito Bold (label), Calibri Bold (nilai), Roboto Italic (tagline).
// Calibri berlisensi -> diganti Carlito (metrik identik, OFL). Ketiganya
// diambil dari paket npm @expo-google-fonts lewat jsDelivr (TTF -- jsPDF gak
// bisa pakai woff2). Versi di-pin biar hasil stabil.
export const FONT_URLS = {
  nunitoBold: 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/nunito@0.4.2/700Bold/Nunito_700Bold.ttf',
  robotoItalic: 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/roboto@0.4.3/400Regular_Italic/Roboto_400Regular_Italic.ttf',
  carlitoBold: 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/carlito@0.4.1/700Bold/Carlito_700Bold.ttf',
};

let fontCache = null; // Promise<{nunitoBold, robotoItalic, carlitoBold}|null>

function bufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

// Balikin {nunitoBold, robotoItalic, carlitoBold} (base64) atau null kalau
// salah satu gagal diunduh -- pemanggil lalu jatuh ke Helvetica bawaan jsPDF.
// Cuma sukses yang di-cache; kegagalan boleh dicoba lagi di generate berikutnya.
export function loadSpekFonts() {
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
        console.warn('spek-maker: font gagal dimuat, pakai Helvetica:', err);
        fontCache = null;
        return null;
      }
    })();
  }
  return fontCache;
}

function registerFonts(doc, fonts) {
  if (!fonts) return { label: ['helvetica', 'bold'], value: ['helvetica', 'bold'], tag: ['helvetica', 'italic'] };
  doc.addFileToVFS('Nunito-Bold.ttf', fonts.nunitoBold);
  doc.addFont('Nunito-Bold.ttf', 'Nunito', 'bold');
  doc.addFileToVFS('Roboto-Italic.ttf', fonts.robotoItalic);
  doc.addFont('Roboto-Italic.ttf', 'Roboto', 'italic');
  doc.addFileToVFS('Carlito-Bold.ttf', fonts.carlitoBold);
  doc.addFont('Carlito-Bold.ttf', 'Carlito', 'bold');
  return { label: ['Nunito', 'bold'], value: ['Carlito', 'bold'], tag: ['Roboto', 'italic'] };
}

// ---- Util ----------------------------------------------------------------
// Nama file aman: kode produk -> "<kode>.pdf" (sama pola dengan PDF contoh).
export function fileSafeName(kode, ext = 'pdf') {
  const base = String(kode || 'spesifikasi')
    .normalize('NFKC')
    .replace(/[^\w.-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '') || 'spesifikasi';
  return base + '.' + ext;
}

// Pilih ukuran font terbesar (<= start, >= min) di mana teks muat dalam
// maxLines baris selebar `width`. Kalau tetap gak muat di ukuran min, teks
// dipotong dan baris terakhir diberi "...".
function fitLines(doc, text, width, start, min, maxLines) {
  for (let size = start; size >= min; size -= 0.5) {
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(text, width);
    if (lines.length <= maxLines) return { lines, size };
  }
  doc.setFontSize(min);
  const lines = doc.splitTextToSize(text, width).slice(0, maxLines);
  const last = lines.length - 1;
  while (last >= 0 && lines[last].length > 1 && doc.getTextWidth(lines[last] + '...') > width) {
    lines[last] = lines[last].slice(0, -1);
  }
  if (last >= 0) lines[last] = lines[last].replace(/\s+$/, '') + '...';
  return { lines, size: min };
}

// Rasio asli PNG dibaca dari header IHDR (lebar/tinggi di byte 16-23), supaya
// logo tetap proporsional walau file di /assets diganti dengan ukuran lain.
// Gagal baca -> pakai rasio bawaan di LAYOUT.
function pngAspect(dataUrl, fallback) {
  try {
    const head = atob(String(dataUrl).split(',')[1].slice(0, 44));
    const u32 = (o) => ((head.charCodeAt(o) << 24) | (head.charCodeAt(o + 1) << 16) | (head.charCodeAt(o + 2) << 8) | head.charCodeAt(o + 3)) >>> 0;
    const w = u32(16);
    const h = u32(20);
    return w > 0 && h > 0 ? w / h : fallback;
  } catch { return fallback; }
}

// ---- Builder -------------------------------------------------------------
// jsPDF   : konstruktor (window.jspdf.jsPDF di browser)
// opts    : { kode, deskripsi,
//             image: { dataUrl, width, height } | null   (PNG/JPEG data URL + ukuran piksel)
//             logos: { robust: dataUrl, pnm: dataUrl },
//             fonts: hasil loadSpekFonts() atau null }
export function buildSpekPdf(jsPDF, opts) {
  const { kode = '', deskripsi = '', image = null, logos = {}, fonts = null } = opts;
  const L = LAYOUT;
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
  const F = registerFonts(doc, fonts);

  // -- kotak & garis tabel
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(L.lineWidth);
  const { x0, x1, top, bottom } = L.box;
  doc.rect(x0, top, x1 - x0, bottom - top, 'S');
  L.hLines.forEach((y) => doc.line(x0, y, x1, y));
  doc.line(L.vLabel.x, L.vLabel.from, L.vLabel.x, L.vLabel.to);
  doc.line(L.vExtra.x, L.vExtra.from, L.vExtra.x, L.vExtra.to);

  // -- teks putih tak terlihat (trik "select all", lihat HIDDEN_FILLER)
  if (HIDDEN_FILLER) {
    doc.setTextColor(255, 255, 255);
    doc.setFont(F.label[0], F.label[1]);
    doc.setFontSize(11.5);
    doc.text('TAK ISI BIAR BISA', 71.42, 86.32);
    doc.text('SELECT ALL', 89.05, 99.74);
    doc.setFontSize(L.labelSize);
    doc.text('TAK ISI BIAR BISA SELECT ALL', L.labelX, 534.66);
    doc.setTextColor(0, 0, 0);
  }

  // -- logo
  if (logos.robust) {
    const g = L.logoRobust;
    const asp = pngAspect(logos.robust, g.aspect);
    doc.addImage(logos.robust, 'PNG', g.x, g.y + (g.w / g.aspect - g.w / asp) / 2, g.w, g.w / asp, undefined, 'FAST');
  }
  if (logos.pnm) {
    const g = L.logoPnm;
    const asp = pngAspect(logos.pnm, g.aspect);
    doc.addImage(logos.pnm, 'PNG', g.x, g.y, g.w, g.w / asp, undefined, 'FAST');
  }

  // -- tagline
  doc.setTextColor(0, 0, 0);
  doc.setFont(F.tag[0], F.tag[1]);
  doc.setFontSize(L.tagline.size);
  doc.text(L.tagline.text, L.tagline.x, L.tagline.baseline);

  // -- label (oranye)
  doc.setFont(F.label[0], F.label[1]);
  doc.setFontSize(L.labelSize);
  doc.setTextColor(...L.labelColor);
  doc.text('Kode:', L.labelX, L.rowKode.labelBaseline);
  doc.text('Spesifikasi Item:', L.labelX, L.rowSpek.labelBaseline);

  // -- nilai Kode (satu baris; font dikecilkan kalau kepanjangan)
  doc.setTextColor(0, 0, 0);
  doc.setFont(F.value[0], F.value[1]);
  const kodeMaxW = L.vExtra.x - L.valueX - 6;
  let kodeSize = L.valueSize;
  doc.setFontSize(kodeSize);
  while (doc.getTextWidth(kode) > kodeMaxW && kodeSize > 7) {
    kodeSize -= 0.5;
    doc.setFontSize(kodeSize);
  }
  doc.text(String(kode), L.valueX, L.rowKode.valueBaseline);

  // -- nilai Spesifikasi (rata tengah vertikal di barisnya; maks 3 baris)
  const specW = L.valueRight - L.valueX;
  const { lines, size } = fitLines(doc, String(deskripsi), specW, L.valueSize, 8, 3);
  doc.setFontSize(size);
  const rowMid = (L.rowSpek.top + L.rowSpek.bottom) / 2; // 215.0
  const lead = lines.length === 1 ? 0 : lines.length === 2 ? 14 : 12.5;
  // baseline baris pertama: pusat blok teks, + ~0.35em turun ke baseline
  const firstBaseline = rowMid - ((lines.length - 1) * lead) / 2 + size * 0.35;
  lines.forEach((ln, i) => doc.text(ln, L.valueX, firstBaseline + i * lead));

  // -- gambar produk (fit ke imageMax, rasio dijaga, di tengah area)
  if (image && image.dataUrl && image.width > 0 && image.height > 0) {
    const a = L.imageArea;
    const scale = Math.min(L.imageMax.w / image.width, L.imageMax.h / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    const cx = (a.x0 + a.x1) / 2;
    const cy = (a.top + a.bottom) / 2;
    const fmt = /^data:image\/jpe?g/i.test(image.dataUrl) ? 'JPEG' : 'PNG';
    doc.addImage(image.dataUrl, fmt, cx - w / 2, cy - h / 2, w, h, undefined, 'FAST');
  }

  doc.setProperties({ title: String(kode || 'Spesifikasi'), creator: 'PNM-BARE TOOLS' });
  return doc;
}