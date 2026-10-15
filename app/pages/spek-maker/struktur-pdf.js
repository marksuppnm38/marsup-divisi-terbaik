// spek-maker/struktur-pdf.js -- builder PDF "Struktur Harga" satu halaman A4.
//
// Meniru tampilan template Google Sheet (kolom No | Deskripsi Biaya |
// Keterangan | Besaran Biaya; bagian A Informasi Umum, B Informasi Produk,
// C Harga Bahan Baku). Lebar kolom diambil dari lebar kolom sheet
// (3.4 : 56.4 : 29.4 : 11.6). Seperti pdf.js, file ini TIDAK menyentuh
// DOM/Supabase: jsPDF & data disuntik dari luar, jadi bisa dites di Node.
//
// Font pakai Helvetica bawaan jsPDF (template asli Calibri; gak worth
// nambah 1 download font cuma buat dokumen tabel).

import { RINCIAN, GUDANG, hitungStruktur, fmtAngka, fmtPct } from './struktur-harga.js';

const PAGE = { w: 595.28, h: 841.89 };
const M = { x: 50, top: 48 };
const COLS_UNIT = [3.4, 56.4, 29.4, 11.6];
const TABLE_W = PAGE.w - M.x * 2;
const SUM_UNIT = COLS_UNIT.reduce((a, b) => a + b, 0);
const COL_W = COLS_UNIT.map((u) => (u / SUM_UNIT) * TABLE_W);
const COL_X = COL_W.reduce((acc, w, i) => { acc.push(i ? acc[i - 1] + COL_W[i - 1] : M.x); return acc; }, []);

const FS = 8.4;          // font isi
const LEAD = 10;         // tinggi baris teks
const PAD_Y = 3;         // padding vertikal sel
const PAD_X = 3;
const GREY = [217, 217, 217];
const SECTION = [242, 242, 242];

// Susun semua baris tabel dari data item -> [{type, ...}]
export function susunBaris(it, hs) {
  const rows = [];
  const kv = (label, value, bold = false) => rows.push({ type: 'kv', label, value: String(value ?? ''), bold });
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
  hs.baris.forEach((b) => rows.push({ type: 'biaya', label: b.label, rp: fmtAngka(b.nilai), pct: fmtPct(b.pct) }));
  rows.push({ type: 'blank' });
  rows.push({ type: 'biaya', label: 'HARGA TOTAL', rp: fmtAngka(hs.total), pct: fmtPct(hs.totalPct), bold: true });
  rows.push({ type: 'biaya', label: 'HARGA + PPN 12%', rp: fmtAngka(hs.plusPpn), pct: '' });
  const labelBulat = 'Pembulatan Harga Tayang (Harga + Ppn 12%)' + (q.catatan ? '\n' + q.catatan : '');
  rows.push({ type: 'biaya', label: labelBulat, rp: fmtAngka(hs.pembulatan), pct: '', bold: true });
  return rows;
}

// Teks nilai bisa panjang (nama produk) -> hitung tinggi baris dari jumlah baris teks.
function wrap(doc, text, width) {
  return String(text || '').split('\n').flatMap((ln) => (ln === '' ? [''] : doc.splitTextToSize(ln, width)));
}

export function buildStrukturPdf(jsPDF, it) {
  const hs = hitungStruktur(it.hargaEkat);
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
  doc.setProperties({ title: 'Struktur Harga ' + (it.kode || ''), creator: 'PNM-BARE TOOLS' });
  doc.setLineWidth(0.5);
  doc.setDrawColor(0, 0, 0);

  // ---- kepala dokumen
  let y = M.top;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('STRUKTUR HARGA', M.x + (COL_W[0] + COL_W[1] + COL_W[2]) / 2, y + 8, { align: 'center' });
  y += 28;

  const valX = COL_X[2];
  const valW = COL_W[2] + COL_W[3];
  doc.setFontSize(FS + 0.6);
  const head = (label, draw) => { doc.setFont('helvetica', 'bold'); doc.text(label, COL_X[1], y); draw(); };

  const namaLines = wrap(doc, it.nama, valW);
  head('Penamaan Tayang di Ekatalog versi 6 :', () => {
    doc.setFont('helvetica', 'normal');
    namaLines.forEach((ln, i) => doc.text(ln, valX, y + i * LEAD));
  });
  y += Math.max(1, namaLines.length) * LEAD + 6;

  head('Kode :', () => { doc.setFont('helvetica', 'normal'); doc.text(String(it.kode || ''), valX, y); });
  y += LEAD + 6;

  head('Pengajuan Harga Tayang :', () => {
    doc.setFont('helvetica', 'normal');
    doc.text('Rp', valX, y);
    doc.text(hs ? fmtAngka(hs.pengajuan) : '-', valX + COL_W[2] - PAD_X, y, { align: 'right' });
  });
  y += 18;

  if (!hs) { // harga kosong: tetap hasilkan kerangka dokumen supaya bisa diperiksa
    doc.setTextColor(200, 0, 0);
    doc.text('HARGA EKATALOG KOSONG -- isi harga lalu buat ulang', COL_X[1], y);
    doc.setTextColor(0, 0, 0);
    return doc;
  }

  // ---- header tabel
  const headerH = 22;
  doc.setFillColor(...GREY);
  doc.rect(M.x, y, TABLE_W, headerH, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FS);
  [['NO.'], ['DESKRIPSI BIAYA'], ['KETERANGAN'], ['BESARAN', 'BIAYA']].forEach((lines, i) => {
    const top = y + headerH / 2 + 3 - ((lines.length - 1) * LEAD) / 2;
    lines.forEach((t, j) => doc.text(t, COL_X[i] + COL_W[i] / 2, top + j * LEAD, { align: 'center' }));
  });
  COL_X.slice(1).forEach((x) => doc.line(x, y, x, y + headerH));
  y += headerH;

  // ---- isi tabel
  const rows = susunBaris(it, hs);
  rows.forEach((r) => {
    let h = LEAD + PAD_Y * 2;
    let labelLines = null;
    let valueLines = null;
    doc.setFont('helvetica', r.bold ? 'bold' : 'normal');
    doc.setFontSize(FS);
    if (r.type === 'kv') {
      labelLines = wrap(doc, r.label, COL_W[1] - PAD_X * 2);
      valueLines = wrap(doc, r.value, COL_W[2] + COL_W[3] - PAD_X * 2);
      h = Math.max(labelLines.length, valueLines.length) * LEAD + PAD_Y * 2;
    } else if (r.type === 'biaya') {
      labelLines = wrap(doc, r.label, COL_W[1] - PAD_X * 2);
      h = labelLines.length * LEAD + PAD_Y * 2;
    }

    if (y + h > PAGE.h - 40) { // jaga-jaga: kalau catatan terlalu panjang -> halaman baru
      doc.addPage();
      y = M.top;
    }

    if (r.type === 'section') {
      doc.setFillColor(...SECTION);
      doc.rect(M.x, y, TABLE_W, h, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.text(r.no, COL_X[0] + COL_W[0] / 2, y + PAD_Y + LEAD - 2, { align: 'center' });
      doc.text(r.title, COL_X[1] + PAD_X, y + PAD_Y + LEAD - 2);
    } else {
      doc.rect(M.x, y, TABLE_W, h, 'S');
      // baris kv: nilai melebar ke kolom Besaran, jadi garis C|D tidak digambar
      (r.type === 'kv' ? COL_X.slice(1, 3) : COL_X.slice(1)).forEach((x) => doc.line(x, y, x, y + h));
      const base = y + PAD_Y + LEAD - 2;
      doc.setFont('helvetica', r.bold ? 'bold' : 'normal');
      if (r.type === 'kv') {
        labelLines.forEach((ln, i) => doc.text(ln, COL_X[1] + PAD_X, base + i * LEAD));
        // nilai di kolom Keterangan, rata tengah (sama dengan sheet) -- melebar ke kolom Besaran
        const cx = COL_X[2] + (COL_W[2] + COL_W[3]) / 2;
        valueLines.forEach((ln, i) => doc.text(ln, cx, base + i * LEAD, { align: 'center' }));
      } else if (r.type === 'biaya') {
        labelLines.forEach((ln, i) => doc.text(ln, COL_X[1] + PAD_X, base + i * LEAD));
        doc.text('Rp', COL_X[2] + PAD_X, base);
        doc.text(r.rp, COL_X[3] - PAD_X, base, { align: 'right' });
        if (r.pct) doc.text(r.pct, COL_X[3] + COL_W[3] - PAD_X, base, { align: 'right' });
      }
    }
    y += h;
  });

  return doc;
}
