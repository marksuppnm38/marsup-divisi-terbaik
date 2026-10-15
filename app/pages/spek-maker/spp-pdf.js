// spek-maker/spp-pdf.js -- builder PDF "Surat Permohonan Presentasi" (SPP).
//
// Meniru PDF contoh "SPP - RSUD dr. H. Moch. Ansari Saleh Banjarmasin.pdf"
// (hasil export Google Docs, A4 596x842pt, font Calibri 12pt). Semua angka di
// LAYOUT di bawah DIUKUR LANGSUNG dari PDF itu (pdfplumber: x0/x1 tiap baris,
// baseline dari matriks teks, posisi gambar), bukan ditebak -- sama pendekatan
// dengan pdf.js (lembar spesifikasi). Kalau template-nya berubah, cukup edit
// konstanta di sini.
//
// Beda dari SPH (konversian/sph.js): SPP cuma surat pengantar permohonan demo
// produk. TIDAK ADA nomor surat, tabel, kode/deskripsi/harga/link, ketentuan,
// maupun lampiran. Produk cuma disebut sebagai butir daftar (teks bebas, mis.
// "ROBUST SURGICAL DRILL", "SET ROBUST ...") sehingga cakupannya luas.
//
// File ini sengaja TIDAK menyentuh DOM / Supabase / auth. Semua input (jsPDF,
// font, aset kop/footer/ttd) disuntik dari luar, supaya bisa dites di Node dan
// spp-ui.js tinggal urus form + pengambilan aset.

// ---- Layout (pt, origin kiri-ATAS; nilai "y" = BASELINE teks) -------------
export const LAYOUT = {
  page: { w: 595.28, h: 841.89 },
  fontSize: 12,
  marginL: 45,
  marginR: 553.28,          // tepi kanan teks (tanggal rata-kanan + batas justify)
  dateBaseline: 75.35,
  rowPitch: 24.85,          // jarak antar baris "Hal/Lamp./Kepada/alamat" (spasi 1.5 + 2.9)
  blockGap: 49.69,          // jarak antar blok (Lamp->Kepada, alamat->Dengan hormat)
  lineH: 21.97,             // jarak antar baris dalam paragraf
  paraGap: 29.97,           // baris terakhir paragraf -> baris pertama paragraf/butir berikut
  halColonX: 112.5,         // ':' pada baris "Hal"
  bullet: { cx: 62.1, dy: -3.73, r: 2.7, textX: 76.5 }, // bulatan '●' (ArialMT) digambar manual
  sign: {
    labelX: 364.5,
    nameX: 397.5,
    nameGap: 74.54,         // baseline label -> baseline nama
    img: { x: 379.5, w: 123.8, dy: 2.6 }, // komposit logo+ttd; dy = atas gambar relatif ke baseline label
  },
  safeBottom: 754,          // batas bawah konten sebelum footer
  // Docs memakai kerning, jsPDF tidak -> teks yang sama bisa terukur sampai ~0.6pt
  // lebih lebar di jsPDF (terukur di baris "dilaksanakan ... dengan"). Tanpa
  // toleransi ini pemenggalan baris bisa beda dari contoh.
  wrapTol: 1,
};

// Posisi kop per perusahaan. SMY: kop (batang ijo + logo) diukur dari PDF contoh --
// batang ijo di x 42.5..155.8, y 10.8; teks tanggal mulai tepat di bawah logo.
// Perusahaan lain: kop lebar penuh (sama seperti SPH, 170mm) di bawah margin atas.
export const HEADER_LAYOUT = {
  smy: { x: 40.4, y: 9.0, w: 117.7 },
  _wide: { x: 45, y: 36, w: 482 },
};

// Footer: di PDF contoh layer footer sedikit lebih besar dari halaman (x 4.5..608.2)
// dan menempel di dasar halaman. Perusahaan lain: lebar halaman penuh (seperti SPH).
export const FOOTER_LAYOUT = {
  smy: { x: 4.5, w: 603.7 },
  _wide: { x: 0, w: 595.28 },
};

export const SPP_COMPANIES = {
  smy: {
    label: 'PT Samaya Medika Indonesia (SMY)',
    namaPt: 'PT Samaya Medika Indonesia',
    header: '/assets/HEADER_SAMAYA.png',
    footer: '/assets/FOOTER_SAMAYA.png',
    ttd: '/assets/TTD_SAMAYA.png', // sudah komposit logo+ttd
    headerLayout: 'smy',
    footerLayout: 'smy',
  },
  pnm: {
    label: 'PT Pionir Nusantara Manufacturing (PNM)',
    namaPt: 'PT Pionir Nusantara Manufacturing',
    header: null, // belum ada file kop PNM di assets/ -- upload manual
    footer: null,
    ttd: null,
    headerLayout: '_wide',
    footerLayout: '_wide',
  },
  meto: {
    label: 'PT Meto Cahaya Abadi (METO)',
    namaPt: 'PT Meto Cahaya Abadi',
    header: '/assets/header_meto.png',
    footer: '/assets/FOOTER_METO.png',
    ttd: null, // belum ada TTD default METO
    headerLayout: '_wide',
    footerLayout: '_wide',
  },
};

// ---- Font ----------------------------------------------------------------
// PDF asli: Calibri. Calibri berlisensi -> diganti Carlito (metrik identik,
// OFL), diambil dari paket npm @expo-google-fonts lewat jsDelivr (TTF -- jsPDF
// gak bisa pakai woff2), versi di-pin sama seperti pdf.js.
export const FONT_URLS = {
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

// Balikin {carlito} (base64) atau null kalau gagal diunduh -- pemanggil lalu
// jatuh ke Helvetica bawaan jsPDF (lebar huruf beda tipis, tata letak tetap).
export function loadSppFonts() {
  if (!fontCache) {
    fontCache = (async () => {
      try {
        const res = await fetch(FONT_URLS.carlito);
        if (!res.ok) throw new Error('font carlito HTTP ' + res.status);
        return { carlito: bufferToBase64(await res.arrayBuffer()) };
      } catch (err) {
        console.warn('spp: font gagal dimuat, pakai Helvetica:', err);
        fontCache = null;
        return null;
      }
    })();
  }
  return fontCache;
}

function registerFonts(doc, fonts) {
  if (!fonts || !fonts.carlito) return 'helvetica';
  doc.addFileToVFS('Carlito-Regular.ttf', fonts.carlito);
  doc.addFont('Carlito-Regular.ttf', 'Carlito', 'normal');
  return 'Carlito';
}

// ---- Util ----------------------------------------------------------------
const MONTH_NAMES_ID = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

export function formatTanggalIndo(date) {
  const dd = String(date.getDate()).padStart(2, '0');
  return `${dd} ${MONTH_NAMES_ID[date.getMonth()]} ${date.getFullYear()}`;
}

// Nama file output: "spp-<nama rs>.pdf". Karakter selain huruf/angka/spasi
// dibuang (pola sama dengan sphBuildFileBaseName di SPH).
export function sppFileName(namaRs) {
  const clean = String(namaRs || 'RS').replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim() || 'RS';
  return `SPP - ${clean}.pdf`;
}

// ---- Builder -------------------------------------------------------------
// jsPDF : konstruktor (window.jspdf.jsPDF di browser)
// opts  : { tanggalSurat, namaRs, alamat: string[], produk: string[],
//           namaPenandatangan, namaPt,
//           assets: { header, footer, ttd }  -> tiap {dataUrl, w, h} | null
//           headerLayout / footerLayout: kunci HEADER_LAYOUT / FOOTER_LAYOUT,
//           fonts: hasil loadSppFonts() atau null }
export function buildSppPdf(jsPDF, opts) {
  const {
    tanggalSurat = '', namaRs = '', alamat = [], produk = [],
    namaPenandatangan = '', namaPt = '', assets = {}, headerLayout = 'smy', footerLayout = 'smy', fonts = null,
  } = opts;
  const L = LAYOUT;
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
  const fontName = registerFonts(doc, fonts);
  const textW = L.marginR - L.marginL;

  const setBody = () => {
    doc.setFont(fontName, 'normal');
    doc.setFontSize(L.fontSize);
    doc.setTextColor(0, 0, 0);
  };

  // -- kop & footer -------------------------------------------------------
  const HL = HEADER_LAYOUT[headerLayout] || HEADER_LAYOUT._wide;
  let headerBottom = 0;
  if (assets.header) {
    const h = (assets.header.h / assets.header.w) * HL.w;
    headerBottom = HL.y + h;
  }
  // Tanggal mulai tepat di bawah kop (di PDF contoh: bawah logo = atas teks tanggal).
  // Tanpa kop / kop pendek, posisi ikut contoh (dy = 0).
  const dy = headerBottom ? Math.max(0, headerBottom + 9.05 - L.dateBaseline) : 0;

  function drawChrome() {
    if (assets.footer) {
      const FL = FOOTER_LAYOUT[footerLayout] || FOOTER_LAYOUT._wide;
      const fh = (assets.footer.h / assets.footer.w) * FL.w;
      try { doc.addImage(assets.footer.dataUrl, 'PNG', FL.x, L.page.h - fh, FL.w, fh); } catch (e) { /* aset rusak -- lewati */ }
    }
    if (assets.header) {
      const h = (assets.header.h / assets.header.w) * HL.w;
      try { doc.addImage(assets.header.dataUrl, 'PNG', HL.x, HL.y, HL.w, h); } catch (e) { /* aset rusak -- lewati */ }
    }
  }

  drawChrome();
  setBody();

  let y = L.dateBaseline + dy;
  const startY = y;

  function ensure(needed) {
    if (y + needed > L.safeBottom) {
      doc.addPage();
      drawChrome();
      setBody();
      y = startY;
    }
  }

  // Satu baris dengan justify (rata kiri-kanan, seperti contoh). Operator Tw
  // (word spacing) bawaan jsPDF TIDAK jalan untuk font TrueType yang di-embed
  // (Identity-H, 2 byte per glyph -- Tw hanya berlaku untuk kode 1-byte 32),
  // jadi tiap kata digambar sendiri dengan jarak antar-kata yang dihitung agar
  // baris pas selebar `width`. Baris terakhir paragraf dan baris satu kata
  // digambar rata kiri biasa (utuh satu string).
  function drawLine(ln, x, width, justify) {
    const words = ln.split(' ');
    if (!justify || words.length < 2) { doc.text(ln, x, y); return; }
    const wordsW = words.reduce((sum, w) => sum + doc.getTextWidth(w), 0);
    const gap = (width - wordsW) / (words.length - 1);
    let cx = x;
    words.forEach((w) => {
      doc.text(w, cx, y);
      cx += doc.getTextWidth(w) + gap;
    });
  }

  function drawJustified(lines, x, width) {
    lines.forEach((ln, i) => {
      ensure(L.lineH);
      drawLine(ln, x, width, i < lines.length - 1);
      if (i < lines.length - 1) y += L.lineH;
    });
  }

  const wrap = (text, width) => doc.splitTextToSize(String(text), width + L.wrapTol);

  function paragraph(text, gapBefore) {
    const lines = wrap(text, textW);
    y += gapBefore;
    ensure(L.lineH);
    drawJustified(lines, L.marginL, textW);
  }

  // -- tanggal (rata kanan) ----------------------------------------------
  doc.text(`Yogyakarta, ${tanggalSurat}`, L.marginR, y, { align: 'right' });

  // -- Hal / Lamp. --------------------------------------------------------
  y += 24.85;
  doc.text('Hal', L.marginL, y);
  doc.text(': Permohonan Presentasi Produk Alat Kesehatan', L.halColonX, y);
  y += L.rowPitch;
  doc.text('Lamp. : -', L.marginL, y);

  // -- Kepada Yth. --------------------------------------------------------
  y += L.blockGap;
  doc.text('Kepada Yth.', L.marginL, y);
  y += L.rowPitch;
  doc.splitTextToSize(`Direktur ${namaRs}`, textW).forEach((ln, i) => {
    if (i > 0) { y += L.rowPitch; ensure(L.rowPitch); }
    doc.text(ln, L.marginL, y);
  });
  for (const raw of alamat) {
    const wrapped = doc.splitTextToSize(String(raw), textW);
    for (const w of wrapped) {
      y += L.rowPitch;
      ensure(L.rowPitch);
      doc.text(w, L.marginL, y);
    }
  }

  // -- salam + paragraf pembuka ------------------------------------------
  y += L.blockGap;
  doc.text('Dengan hormat,', L.marginL, y);
  y += L.rowPitch;
  const intro = `Sehubungan dengan komitmen kami dalam mendukung dunia kesehatan Indonesia melalui penyediaan alat-alat kesehatan berkualitas tinggi, bersama ini kami dari ${namaPt} bermaksud untuk mengajukan permohonan kesempatan melakukan demo produk alat kesehatan kepada pihak manajemen ${namaRs}. Adapun produk yang ingin kami perkenalkan adalah sebagai berikut:`;
  drawJustified(wrap(intro, textW), L.marginL, textW);

  // -- daftar produk (butir) ---------------------------------------------
  const B = L.bullet;
  const bulletW = L.marginR - B.textX;
  produk.forEach((p, i) => {
    const lines = doc.splitTextToSize(String(p), bulletW);
    y += i === 0 ? L.paraGap : L.lineH;
    ensure(L.lineH);
    doc.setFillColor(0, 0, 0);
    doc.circle(B.cx, y + B.dy, B.r, 'F');
    lines.forEach((ln, li) => {
      if (li > 0) { y += L.lineH; ensure(L.lineH); }
      doc.text(ln, B.textX, y);
    });
  });

  // -- paragraf penutup ---------------------------------------------------
  paragraph('Kami sangat berharap Bapak/Ibu berkenan memberikan waktu dan tempat agar presentasi ini dapat dilaksanakan sesuai jadwal yang ditentukan oleh pihak rumah sakit. Kami siap menyesuaikan diri dengan ketentuan dan prosedur yang berlaku di rumah sakit.', L.paraGap);
  paragraph('Demikian surat permohonan ini kami sampaikan. Atas perhatian dan kerja sama yang diberikan, kami ucapkan terima kasih.', L.paraGap);

  // -- tanda tangan -------------------------------------------------------
  // label + ttd + nama dijaga satu halaman
  y += L.paraGap;
  ensure(L.sign.nameGap + 12);
  const S = L.sign;
  doc.text(`${namaPt},`, S.labelX, y);
  if (assets.ttd) {
    const w = S.img.w;
    const h = (assets.ttd.h / assets.ttd.w) * w;
    try { doc.addImage(assets.ttd.dataUrl, 'PNG', S.img.x, y + S.img.dy, w, h); } catch (e) { /* aset rusak -- lewati */ }
  }
  const nama = String(namaPenandatangan || '').trim();
  if (nama) {
    const nx = Math.min(S.nameX, L.marginR - doc.getTextWidth(nama));
    doc.text(nama, nx, y + S.nameGap);
  }

  doc.setProperties({ title: `SPP - ${namaRs}`, creator: 'PNM-BARE TOOLS' });
  return doc;
}
