// spek-maker/struktur-pdf.js -- builder PDF "Struktur Harga" satu halaman.
//
// 1:1 dengan PDF hasil export Google Sheet (STRK-RBM-KEA-B048-U7R.pdf):
// semua angka di G di bawah DIUKUR langsung dari PDF itu (pdfplumber: garis
// tabel, posisi teks, font, ukuran). Hal yang SENGAJA sama dengan aslinya:
//   - hanya 3 kolom (No | Deskripsi Biaya | Keterangan). Kolom "Besaran Biaya"
//     (persentase) tidak ikut tercetak di PDF aslinya -> tidak dicetak di sini.
//   - tanpa warna isi / shading, garis hairline hitam.
//   - label kolom B tebal, nilai biasa (Calibri 9.3pt -> Carlito, metrik identik);
//     baris Pembulatan pakai Arial Bold (-> Helvetica Bold bawaan jsPDF).
//   - angka format Indonesia (7.527.927,93), tanggal 14-Okt-2030.
// Teks putih tak terlihat di PDF asli (sisa sel "fliaugwf") tidak ditiru.
//
// File ini tidak menyentuh DOM/Supabase; jsPDF & data disuntik dari luar.

import { hitungStruktur, fmtAngka, GUDANG } from './struktur-harga.js';

export const G = {
  page: { w: 595.92, h: 842.88 },
  vx: [50.3, 69.1, 382.1, 545.2],      // garis vertikal (kiri, A|B, B|C, kanan)
  hx: [50.0, 545.6],                   // ujung garis horizontal
  top: 176.0,                          // garis atas header tabel
  pitch: 14.576,                       // tinggi 1 baris
  fs: 9.3,
  titleFs: 12,
  labelX: 71.5,
  letterX: 52.8,
  centerC: 463.65,                     // tengah kolom Keterangan
  rpX: 387.3,                          // "Rp"
  numRight: 540.0,                     // tepi kanan angka
  lead: 11.3,                          // jarak antar baris teks kalau membungkus
  baseOff: 10.7,                       // baseline = atas baris + baseOff (dikalibrasi)
  valW: 160.5,                         // lebar teks nilai maksimum sebelum membungkus
  boldCS: -0.03,                       // Carlito Bold sedikit lebih lebar dari Calibri Bold (kerning)
  lineW: 0.3,
};

export const FONT_URLS = {
  carlito: 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/carlito@0.4.1/400Regular/Carlito_400Regular.ttf',
  carlitoBold: 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/carlito@0.4.1/700Bold/Carlito_700Bold.ttf',
};

let fontCache = null;
function bufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
// {carlito, carlitoBold} base64, atau null kalau gagal (-> Helvetica; layout tetap, font beda).
export function loadStrukturFonts() {
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
        console.warn('struktur-harga: font gagal dimuat, pakai Helvetica:', err);
        fontCache = null;
        return null;
      }
    })();
  }
  return fontCache;
}

function registerFonts(doc, fonts) {
  if (!fonts) return { reg: ['helvetica', 'normal'], bold: ['helvetica', 'bold'], arial: ['helvetica', 'bold'] };
  doc.addFileToVFS('Carlito-Regular.ttf', fonts.carlito);
  doc.addFont('Carlito-Regular.ttf', 'Carlito', 'normal');
  doc.addFileToVFS('Carlito-Bold.ttf', fonts.carlitoBold);
  doc.addFont('Carlito-Bold.ttf', 'Carlito', 'bold');
  return { reg: ['Carlito', 'normal'], bold: ['Carlito', 'bold'], arial: ['helvetica', 'bold'] };
}

// Susun baris tabel -> [{type:'section'|'kv'|'biaya'|'blank', ...}]
export function susunBaris(it, hs) {
  const rows = [];
  const kv = (label, value) => rows.push({ type: 'kv', label, value: String(value ?? '') });
  const sec = (no, title) => rows.push({ type: 'section', no, title });
  const p = it.profil;
  const q = it.isian;

  sec('A', 'INFORMASI UMUM');
  kv('Nama Perusahaan', p.nama);
  kv('Kategori Skala Perusahaan', p.skala);
  kv('Jumlah Karyawan', p.karyawan);
  kv('Gudang', GUDANG);

  sec('B', 'INFORMASI PRODUK');
  kv('Merek Barang', it.merek);
  kv('Nama / Tipe Barang', it.nama);
  kv('Nomor NIE Barang', it.nie);
  kv('Tanggal Kadaluarsa NIE', it.nieExp);
  kv('Apakah memerlukan edukasi berkelanjutan? (Marketing, product, applicant)', q.edukasi);
  kv('Apakah memerlukan pelatihan khusus? (Product team)', q.pelatihan);
  kv('Apakah membutuhkan instalasi?', q.instalasi);
  kv('Apakah menyediakan garansi?', q.garansi);
  kv('Apakah menyediakan purna jual?', q.purnaJual);
  kv('Estimasi Penjualan Produk Per Tahun', q.estimasi);

  sec('C', 'HARGA BAHAN BAKU');
  hs.baris.forEach((b) => rows.push({ type: 'biaya', label: b.label, rp: fmtAngka(b.nilai) }));
  rows.push({ type: 'blank' });
  rows.push({ type: 'biaya', label: 'HARGA TOTAL', rp: fmtAngka(hs.total), bold: true });
  rows.push({ type: 'biaya', label: 'HARGA + PPN 12%', rp: fmtAngka(hs.plusPpn), bold: true });
  const labelBulat = 'Pembulatan Harga Tayang (Harga + Ppn 12%)' + (it.isian.catatan ? '\n' + it.isian.catatan : '');
  rows.push({ type: 'biaya', label: labelBulat, rp: fmtAngka(hs.pembulatan), bold: true, arial: true });
  return rows;
}

function wrap(doc, text, width) {
  return String(text || '').split('\n').flatMap((ln) => (ln === '' ? [''] : doc.splitTextToSize(ln, width)));
}

// jsPDF : konstruktor ; it : item dari buatItem() ; fonts : hasil loadStrukturFonts() atau null
export function buildStrukturPdf(jsPDF, it, fonts = null) {
  const hs = hitungStruktur(it.hargaEkat);
  const doc = new jsPDF({ unit: 'pt', format: [G.page.w, G.page.h], orientation: 'portrait' });
  doc.setProperties({ title: 'Struktur Harga ' + (it.kode || ''), creator: 'PNM-BARE TOOLS' });
  const F = registerFonts(doc, fonts);
  const set = (f, size = G.fs) => {
    doc.setFont(f[0], f[1]);
    doc.setFontSize(size);
    doc.setCharSpace(fonts && f[0] === 'Carlito' && f[1] === 'bold' ? G.boldCS : 0);
  };
  const B = G.baseOff;
  const [x0, xAB, xBC, x1] = G.vx;

  doc.setTextColor(0, 0, 0);
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(G.lineW);

  // ---- kepala dokumen (posisi tetap, diukur dari PDF asli; nilai = baseline)
  set(F.bold, G.titleFs);
  doc.text('STRUKTUR HARGA', (x0 + x1) / 2, 58.5 + 8.8, { align: 'center' });

  set(F.bold);
  doc.text('Penamaan Tayang di Ekatalog versi 6 :', G.labelX, 87.6 + 6.8);
  doc.text('Kode :', G.labelX, 107.8 + 6.8);
  doc.text('Pengajuan Harga Tayang :', G.labelX, 136.2 + 6.8);

  set(F.reg);
  const namaLines = wrap(doc, it.nama, G.valW);
  // blok nama rata bawah di baseline baris pertama versi 1 baris (81.4+6.8), tumbuh ke atas
  namaLines.forEach((ln, i) => doc.text(ln, G.centerC, 81.4 + 6.8 - (namaLines.length - 1 - i) * G.lead, { align: 'center' }));
  doc.text(String(it.kode || ''), G.centerC, 107.8 + 6.8, { align: 'center' });
  doc.text('Rp', G.rpX, 132.1 + 6.8);
  doc.text(hs ? fmtAngka(hs.pengajuan) : '-', G.numRight, 132.1 + 6.8, { align: 'right' });

  if (!hs) {
    doc.setTextColor(200, 0, 0);
    doc.text('HARGA EKATALOG KOSONG -- isi harga lalu buat ulang', G.labelX, 176 + B);
    return doc;
  }

  // ---- hitung tinggi tiap baris dulu (biar garis bisa digambar rapi)
  const rows = [{ type: 'header' }, ...susunBaris(it, hs)];
  rows.forEach((r) => {
    r.h = G.pitch;
    if (r.type === 'kv') {
      set(F.bold);
      r.labelLines = wrap(doc, r.label, xBC - G.labelX - 2);
      set(F.reg);
      r.valueLines = wrap(doc, r.value, G.valW);
      r.h = G.pitch + (Math.max(r.labelLines.length, r.valueLines.length) - 1) * G.lead;
    } else if (r.type === 'biaya') {
      set(r.arial ? F.arial : (r.bold ? F.bold : F.reg));
      r.labelLines = wrap(doc, r.label, xBC - G.labelX - 2);
      r.h = G.pitch + (r.labelLines.length - 1) * G.lead;
    }
  });

  // ---- gambar
  let y = G.top;
  const tableTop = y;
  doc.line(G.hx[0], y, G.hx[1], y);
  rows.forEach((r) => {
    const base = y + B;
    if (r.type === 'header') {
      set(F.bold);
      doc.text('N0.', (x0 + xAB) / 2, base, { align: 'center' });
      doc.text('DESKRIPSI BIAYA', (xAB + xBC) / 2, base, { align: 'center' });
      doc.text('KETERANGAN', (xBC + x1) / 2, base, { align: 'center' });
    } else if (r.type === 'section') {
      set(F.bold);
      doc.text(r.no, G.letterX, base);
      doc.text(r.title, G.labelX, base);
    } else if (r.type === 'kv') {
      set(F.bold);
      r.labelLines.forEach((ln, i) => doc.text(ln, G.labelX, base + i * G.lead));
      set(F.reg);
      r.valueLines.forEach((ln, i) => doc.text(ln, G.centerC, base + i * G.lead, { align: 'center' }));
    } else if (r.type === 'biaya') {
      const f = r.arial ? F.arial : (r.bold ? F.bold : F.reg);
      set(F.bold === f ? F.bold : f); // label
      if (!r.bold) set(F.bold);       // label baris biaya biasa tetap tebal (seperti aslinya)
      if (r.arial) set(F.arial);
      r.labelLines.forEach((ln, i) => doc.text(ln, G.labelX, base + i * G.lead));
      set(f);                         // "Rp" & angka: biasa untuk baris biaya, tebal untuk total
      doc.text('Rp', G.rpX, base);
      doc.text(r.rp, G.numRight, base, { align: 'right' });
    }
    y += r.h;
    doc.line(G.hx[0], y, G.hx[1], y);
  });
  // garis vertikal: kiri & kanan penuh, A|B penuh, B|C penuh (sama dengan aslinya)
  G.vx.forEach((x) => doc.line(x, tableTop - 0.4, x, y + 0.3));
  return doc;
}