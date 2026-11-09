// app/pages/populasi/export.js
// Pembuat file Excel halaman "Populasi". MODUL MURNI: tidak menyentuh DOM, state halaman, atau jaringan.
// index.js memberi ExcelJS, foto data (ctx), dan pilihan pembaca (sel); modul ini mengembalikan ArrayBuffer xlsx.
//
// File ini adalah DOKUMEN BISNIS yang berdiri sendiri (lampiran SPH, bahan presentasi, laporan internal),
// bukan salinan mentah database. Prinsip:
//  - Satu export, beberapa tujuan: PRESET memilih sheet dan kelompok kolom; pembaca bisa menyesuaikan.
//  - Sheet berurutan dari yang paling dibaca: Ringkasan > Daftar RS > Per Produk > Per Provinsi >
//    RS per Kategori > Rincian Pesanan > Wilayah Belum Diketahui > Catatan & Kamus.
//  - Integritas data: nilai tidak diisi/ditebak. Kosong di sumber tetap kosong (angka/tanggal) atau
//    "Tidak tersedia" (teks), "Belum diketahui" untuk wilayah, dan setiap hitungan perkiraan / belum dihitung
//    diberi penanda + dijelaskan di Catatan & Kamus. Kolom yang seluruhnya kosong tidak ditampilkan (dicatat).
//  - Angka tetap angka (bisa difilter/dijumlah); 0 tampil "–"; baris Total = SUBTOTAL(109) sehingga
//    mengikuti filter pembaca. Sheet ringkasan (Per Produk, Per Provinsi, dst) adalah SNAPSHOT saat unduh.
//  - Siap cetak: A4, muat satu halaman lebar, header tabel berulang, nomor halaman.

// ── konstanta tampilan ───────────────────────────────────────────────────────
const XL = {
  navy: 'FF1B2A4A', ink: 'FF0B1220', soft: 'FF64748B', line: 'FFE2E4E9',
  band: 'FFF5F6F8', hint: 'FFEAF2FF', warn: 'FFB45309', warnBg: 'FFFEF3C7', white: 'FFFFFFFF',
  tabMain: 'FF1B2A4A', tabData: 'FF3B6EA5', tabRef: 'FF94A3B8',
};
const XL_NUM = '#,##0';
const XL_NUMZ = '#,##0;-#,##0;"–"';     // nol tampil strip, supaya angka yang ada langsung terlihat
const XL_DATE = 'dd mmm yyyy';
const NA = 'Tidak tersedia';              // teks untuk data yang memang tidak tercatat
const BELUM = 'Belum diketahui';          // wilayah yang belum bisa ditentukan
const xlFill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const xlLine = { style: 'thin', color: { argb: XL.line } };
const n0 = (v) => Number(v) || 0;

// ── katalog: preset, sheet, kelompok kolom ───────────────────────────────────
export const XL_PRESETS = [
  {
    id: 'sph', nama: 'Lampiran SPH',
    desc: 'Ringkas dan rapi untuk dikirim ke calon pembeli: daftar RS, populasi per produk, dan per provinsi. Tanpa nomor PO/RMP dan data teknis.',
    sheets: ['rs', 'rincianrs', 'produk', 'provinsi'],
    grp: { wil: 1, jml: 1, status: 0, waktu: 1, produk: 1, dok: 0, cat: 0, tek: 0 },
  },
  {
    id: 'presentasi', nama: 'Presentasi dan diskusi',
    desc: 'Gambaran cepat untuk dibicarakan: per provinsi, per produk, per kategori, dan daftar RS. Tanpa data teknis.',
    sheets: ['provinsi', 'produk', 'matriks', 'rs', 'rincianrs'],
    grp: { wil: 1, jml: 1, status: 0, waktu: 1, produk: 1, dok: 0, cat: 1, tek: 0 },
  },
  {
    id: 'internal', nama: 'Laporan dan analisis internal',
    desc: 'Lengkap: semua sheet termasuk rincian pesanan, nomor PO/RMP, dan kolom teknis. Hanya untuk internal.',
    sheets: ['rs', 'produk', 'provinsi', 'matriks', 'pesanan', 'belum'],
    grp: { wil: 1, jml: 1, status: 1, waktu: 1, produk: 1, dok: 1, cat: 1, tek: 1 },
  },
  {
    id: 'kustom', nama: 'Kustom',
    desc: 'Pilih sendiri sheet dan kolom yang diperlukan.',
    sheets: null, grp: null,
  },
];

export const XL_GRUP = {
  id: 'Identitas', wil: 'Wilayah', jml: 'Jumlah', status: 'Terkirim dan dalam proses terpisah',
  waktu: 'Tanggal dan status', produk: 'Detail produk', dok: 'Dokumen (No. PO, No. RMP)',
  cat: 'Keterangan data', tek: 'Data teknis',
};
// Kelompok yang hanya untuk internal: dipakai untuk peringatan di dialog.
export const XL_GRUP_INTERNAL = ['dok', 'tek'];

export const XL_SHEETS = [
  { id: 'ringkasan', nama: 'Ringkasan', lock: true,
    desc: 'Satu halaman: jawaban singkat, angka utama, RS dan produk terbanyak, filter yang dipakai.' },
  { id: 'rs', nama: 'Daftar RS', cols: true,
    desc: 'Satu baris per rumah sakit/instansi: wilayah, jumlah, dan produk yang dipesan.' },
  { id: 'rincianrs', nama: 'Produk per RS',
    desc: 'Satu baris per rumah sakit dan produk: jumlah yang dipesan. Bisa difilter per RS atau per produk.' },
  { id: 'produk', nama: 'Per Produk', cols: true,
    desc: 'Populasi per produk atau jenis set: jumlah, berapa RS, berapa provinsi.' },
  { id: 'provinsi', nama: 'Per Provinsi', when: (i) => !i.provinsiDipilih,
    desc: 'Jumlah RS dan unit per provinsi.' },
  { id: 'matriks', nama: 'RS per Kategori', when: (i) => i.multiKategori,
    desc: 'Perbandingan jumlah tiap RS per kategori produk.' },
  { id: 'pesanan', nama: 'Rincian Pesanan', cols: true,
    desc: 'Satu baris per pesanan dan produk: tanggal, status, nomor PO/RMP. Bahan penelusuran.' },
  { id: 'belum', nama: 'Wilayah Belum Diketahui', when: (i) => i.adaBelum,
    desc: 'RS yang provinsinya belum diketahui, sehingga belum masuk angka provinsi.' },
  { id: 'catatan', nama: 'Catatan & Kamus', lock: true,
    desc: 'Cara membaca angka, kualitas data, dan arti tiap kolom, supaya file dipahami tanpa membuka aplikasi.' },
];
const ORDER = XL_SHEETS.map((s) => s.id);

// Definisi kolom. k = kunci di item, grp = kelompok, req = selalu ikut, drop = disembunyikan bila seluruhnya kosong,
// na = teks "Tidak tersedia" untuk sel kosong (hanya bila kolomnya punya isi), when(info) = relevan atau tidak.
const COLS = {
  rs: [
    { id: 'no', h: 'No', k: 'no', w: 5, fmt: XL_NUM, align: 'center', grp: 'id', req: 1, desc: 'Nomor urut di sheet ini.' },
    { id: 'customer', h: 'Rumah sakit / instansi', k: 'customer', w: 44, grp: 'id', req: 1, desc: 'Nama customer seperti tercatat di data pesanan. Bisa rumah sakit, puskesmas, dinas kesehatan, atau institusi lain.' },
    { id: 'kab', h: 'Kab/Kota', k: 'kab', w: 22, grp: 'wil', drop: 1, na: 1, desc: 'Kabupaten/kota. Diisi hanya bila tercatat; “Tidak tersedia” berarti belum ada datanya.' },
    { id: 'provinsi', h: 'Provinsi', k: 'provinsi', w: 20, grp: 'wil', desc: 'Provinsi. “Belum diketahui” berarti wilayah belum bisa ditentukan.' },
    { id: 'set_t', h: 'Set terkirim', k: 'set_t', w: 11, fmt: XL_NUMZ, grp: 'status', when: (i) => i.hasSet && i.semuaStatus, desc: 'Jumlah set pada pesanan yang sudah terkirim.' },
    { id: 'set_p', h: 'Set dalam proses', k: 'set_p', w: 11, fmt: XL_NUMZ, grp: 'status', when: (i) => i.hasSet && i.semuaStatus, desc: 'Jumlah set pada pesanan yang masih dalam proses.' },
    { id: 'set', h: 'Jumlah set', k: 'set', w: 12, fmt: XL_NUMZ, grp: 'jml', req: 1, when: (i) => i.hasSet, desc: 'Jumlah set instrumen utuh. Pesanan set yang belum dihitung tidak termasuk.' },
    { id: 'pcs_t', h: 'Unit/pcs terkirim', k: 'pcs_t', w: 12, fmt: XL_NUMZ, grp: 'status', when: (i) => i.hasPcs && i.semuaStatus, desc: 'Jumlah barang satuan pada pesanan yang sudah terkirim.' },
    { id: 'pcs_p', h: 'Unit/pcs dalam proses', k: 'pcs_p', w: 12, fmt: XL_NUMZ, grp: 'status', when: (i) => i.hasPcs && i.semuaStatus, desc: 'Jumlah barang satuan pada pesanan yang masih dalam proses.' },
    { id: 'pcs', h: 'Jumlah unit/pcs', k: 'pcs', w: 12, fmt: XL_NUMZ, grp: 'jml', req: 1, when: (i) => i.hasPcs, desc: 'Jumlah barang satuan (instrumen satuan, elektromedis, alat laboratorium, dan sejenisnya).' },
    { id: 'pesanan', h: 'Jumlah pesanan', k: 'pesanan', w: 11, fmt: XL_NUMZ, grp: 'jml', desc: 'Jumlah pesanan dari RS ini menurut aplikasi.' },
    { id: 'pertama', h: 'Pesanan pertama', k: 'pertama', w: 14, fmt: XL_DATE, grp: 'waktu', desc: 'Tanggal pesanan paling awal pada hasil ini. Kosong bila tidak ada tanggal tercatat.' },
    { id: 'terakhir', h: 'Pesanan terakhir', k: 'terakhir', w: 14, fmt: XL_DATE, grp: 'waktu', desc: 'Tanggal pesanan paling baru. Kosong bila tidak ada tanggal tercatat.' },
    { id: 'rincian', h: 'Jenis yang dipesan', k: 'rincian', w: 62, wrap: 1, grp: 'produk', desc: 'Produk atau jenis set yang dipesan, diikuti ×jumlahnya.' },
    { id: 'ket', h: 'Keterangan', k: 'ket', w: 40, wrap: 1, warn: 1, drop: 1, grp: 'cat', desc: 'Catatan khusus: jumlah berupa perkiraan, pesanan belum dihitung, atau wilayah belum diketahui.' },
    { id: 'sumber', h: 'Dasar wilayah', k: 'sumber', w: 18, tech: 1, drop: 1, grp: 'tek', desc: 'Asal data wilayah: koreksi manual oleh tim, atau deteksi otomatis dari alamat pengiriman (bisa keliru).' },
  ],
  produk: [
    { id: 'no', h: 'No', k: 'no', w: 5, fmt: XL_NUM, align: 'center', grp: 'id', req: 1, desc: 'Nomor urut di sheet ini.' },
    { id: 'nama', h: 'Produk / jenis set', k: 'nama', w: 52, wrap: 1, grp: 'id', req: 1, desc: 'Nama produk (barang satuan) atau jenis set, seperti tercatat di data pesanan.' },
    { id: 'kode', h: 'Kode produk', k: 'kode', w: 16, grp: 'produk', drop: 1, na: 1, desc: 'Kode produk di database. “Tidak tersedia” berarti tidak tercatat.' },
    { id: 'kategori', h: 'Kategori', k: 'kategori', w: 18, grp: 'produk', desc: 'Kategori produk menurut klasifikasi aplikasi.' },
    { id: 'spes', h: 'Spesialisasi', k: 'spes', w: 20, grp: 'produk', drop: 1, desc: 'Spesialisasi instrumen, bila tercatat.' },
    { id: 'set_t', h: 'Set terkirim', k: 'set_t', w: 11, fmt: XL_NUMZ, grp: 'status', when: (i) => i.hasSet && i.semuaStatus, desc: 'Jumlah set pada pesanan yang sudah terkirim.' },
    { id: 'set_p', h: 'Set dalam proses', k: 'set_p', w: 11, fmt: XL_NUMZ, grp: 'status', when: (i) => i.hasSet && i.semuaStatus, desc: 'Jumlah set pada pesanan yang masih dalam proses.' },
    { id: 'set', h: 'Jumlah set', k: 'set', w: 12, fmt: XL_NUMZ, grp: 'jml', req: 1, when: (i) => i.adaSet, desc: 'Jumlah set untuk produk ini. Pesanan yang belum dihitung tidak termasuk.' },
    { id: 'pcs_t', h: 'Unit/pcs terkirim', k: 'pcs_t', w: 12, fmt: XL_NUMZ, grp: 'status', when: (i) => i.hasPcs && i.semuaStatus, desc: 'Jumlah barang satuan pada pesanan yang sudah terkirim.' },
    { id: 'pcs_p', h: 'Unit/pcs dalam proses', k: 'pcs_p', w: 12, fmt: XL_NUMZ, grp: 'status', when: (i) => i.hasPcs && i.semuaStatus, desc: 'Jumlah barang satuan pada pesanan yang masih dalam proses.' },
    { id: 'pcs', h: 'Jumlah unit/pcs', k: 'pcs', w: 12, fmt: XL_NUMZ, grp: 'jml', req: 1, when: (i) => i.adaPcs, desc: 'Jumlah barang satuan untuk produk ini. Pesanan yang belum dihitung tidak termasuk.' },
    { id: 'rs', h: 'Jumlah RS', k: 'rs', w: 10, fmt: XL_NUMZ, grp: 'jml', desc: 'Berapa RS/instansi berbeda yang memesan produk ini (hanya pesanan yang dihitung).' },
    { id: 'prov', h: 'Jumlah provinsi', k: 'prov', w: 11, fmt: XL_NUMZ, grp: 'wil', when: (i) => !i.provinsiDipilih, desc: 'Berapa provinsi berbeda; RS yang wilayahnya belum diketahui tidak dihitung.' },
    { id: 'pesanan', h: 'Jumlah pesanan', k: 'pesanan', w: 11, fmt: XL_NUMZ, grp: 'jml', desc: 'Jumlah baris pesanan (kombinasi PO dan produk) di sheet Rincian Pesanan untuk produk ini, termasuk yang belum dihitung.' },
    { id: 'pertama', h: 'Pesanan pertama', k: 'pertama', w: 14, fmt: XL_DATE, grp: 'waktu', desc: 'Tanggal pesanan paling awal. Kosong bila tidak ada tanggal tercatat.' },
    { id: 'terakhir', h: 'Pesanan terakhir', k: 'terakhir', w: 14, fmt: XL_DATE, grp: 'waktu', desc: 'Tanggal pesanan paling baru. Kosong bila tidak ada tanggal tercatat.' },
    { id: 'ket', h: 'Keterangan', k: 'ket', w: 40, wrap: 1, warn: 1, drop: 1, grp: 'cat', desc: 'Catatan khusus: ada pesanan perkiraan atau belum dihitung.' },
  ],
  pesanan: [
    { id: 'customer', h: 'Rumah sakit / instansi', k: 'customer', w: 40, grp: 'id', req: 1, desc: 'Nama customer seperti tercatat di data pesanan.' },
    { id: 'kab', h: 'Kab/Kota', k: 'kab', w: 20, grp: 'wil', drop: 1, na: 1, desc: 'Kabupaten/kota. “Tidak tersedia” berarti belum ada datanya.' },
    { id: 'provinsi', h: 'Provinsi', k: 'provinsi', w: 18, grp: 'wil', desc: 'Provinsi. “Belum diketahui” berarti wilayah belum bisa ditentukan.' },
    { id: 'kategori', h: 'Kategori', k: 'kategori', w: 18, grp: 'produk', desc: 'Kategori produk menurut klasifikasi aplikasi.' },
    { id: 'jenis', h: 'Produk / jenis set', k: 'jenis', w: 50, wrap: 1, grp: 'id', req: 1, desc: 'Nama produk (barang satuan) atau jenis set.' },
    { id: 'kode', h: 'Kode produk', k: 'kode', w: 16, grp: 'produk', drop: 1, na: 1, desc: 'Kode produk di database. “Tidak tersedia” berarti tidak tercatat.' },
    { id: 'spes', h: 'Spesialisasi', k: 'spes', w: 20, grp: 'produk', drop: 1, desc: 'Spesialisasi instrumen, bila tercatat.' },
    { id: 'jenisInstr', h: 'Jenis instrumen', k: 'jenisInstr', w: 18, grp: 'produk', drop: 1, desc: 'Jenis instrumen, bila tercatat.' },
    { id: 'mikro', h: 'Mikro', k: 'mikro', w: 8, grp: 'produk', drop: 1, desc: '“Ya” bila instrumen ditandai mikrosurgery.' },
    { id: 'set', h: 'Jumlah set', k: 'set', w: 11, fmt: XL_NUMZ, grp: 'jml', req: 1, when: (i) => i.adaSet, desc: 'Jumlah set pada baris ini. Kosong bila pesanan belum dihitung.' },
    { id: 'pcs', h: 'Jumlah unit/pcs', k: 'pcs', w: 12, fmt: XL_NUMZ, grp: 'jml', req: 1, when: (i) => i.adaPcs, desc: 'Jumlah barang satuan pada baris ini. Kosong bila pesanan belum dihitung.' },
    { id: 'status', h: 'Status', k: 'status', w: 14, grp: 'waktu', desc: 'Terkirim atau Dalam proses.' },
    { id: 'tanggal', h: 'Tanggal pesanan', k: 'tanggal', w: 14, fmt: XL_DATE, grp: 'waktu', desc: 'Tanggal pesanan seperti tercatat. Kosong bila tidak tercatat.' },
    { id: 'rmp', h: 'No. RMP', k: 'rmp', w: 24, grp: 'dok', drop: 1, desc: 'Nomor RMP internal.' },
    { id: 'po', h: 'No. PO', k: 'po', w: 24, grp: 'dok', drop: 1, na: 1, desc: 'Nomor PO sesuai data pesanan. “Tidak tersedia” berarti tidak tercatat.' },
    { id: 'shitung', h: 'Status hitungan', k: 'shitung', w: 22, grp: 'cat', desc: 'Dasar angka pada baris ini: Sesuai isi set, Sesuai dengan penyesuaian, Perkiraan, Belum dihitung (set), atau Jumlah sesuai pesanan (barang satuan).' },
    { id: 'ket', h: 'Keterangan', k: 'ket', w: 44, wrap: 1, warn: 1, drop: 1, grp: 'cat', desc: 'Penjelasan bila angka berupa perkiraan, ada penyesuaian, atau belum dihitung.' },
    { id: 'family', h: 'Family', k: 'family', w: 24, tech: 1, drop: 1, grp: 'tek', desc: 'Pengelompokan produk (family) di database produk.' },
    { id: 'baris', h: 'Jumlah baris di FPB', k: 'baris', w: 12, fmt: XL_NUM, tech: 1, grp: 'tek', desc: 'Banyaknya baris di data sumber (FPB) yang digabung menjadi baris ini.' },
    { id: 'sheet', h: 'Sheet sumber', k: 'sheet', w: 18, tech: 1, drop: 1, grp: 'tek', desc: 'Nama sheet sumber data.' },
    { id: 'asli', h: 'Nama set di sheet', k: 'asli', w: 28, tech: 1, drop: 1, grp: 'tek', desc: 'Nama set asli di sheet sebelum dialihkan ke populasi set lain.' },
  ],
};
// Sheet kecil yang kolomnya tetap (tidak ada pemilihan kolom).
const COLS_PROV = [
  { id: 'no', h: 'No', k: 'no', w: 5, fmt: XL_NUM, align: 'center', desc: 'Nomor urut.' },
  { id: 'provinsi', h: 'Provinsi', k: 'provinsi', w: 28, desc: 'Provinsi. “Belum diketahui” = wilayah RS belum bisa ditentukan.' },
  { id: 'rs', h: 'Jumlah RS', k: 'rs', w: 11, fmt: XL_NUMZ, desc: 'Jumlah RS/instansi di provinsi ini.' },
  { id: 'set', h: 'Jumlah set', k: 'set', w: 12, fmt: XL_NUMZ, when: (i) => i.hasSet, desc: 'Jumlah set.' },
  { id: 'pcs', h: 'Jumlah unit/pcs', k: 'pcs', w: 14, fmt: XL_NUMZ, when: (i) => i.hasPcs, desc: 'Jumlah barang satuan.' },
  { id: 'pesanan', h: 'Jumlah pesanan', k: 'pesanan', w: 12, fmt: XL_NUMZ, desc: 'Jumlah pesanan menurut aplikasi.' },
  { id: 'terakhir', h: 'Pesanan terakhir', k: 'terakhir', w: 14, fmt: XL_DATE, desc: 'Tanggal pesanan paling baru. Kosong bila tidak ada tanggal tercatat.' },
];

const usable = (c, info) => !c.when || c.when(info);
const sheetAvail = (s, info) => !s.when || s.when(info);

// Untuk dialog: daftar sheet + kolom yang relevan pada filter ini.
export function xlCatalog(info) {
  return XL_SHEETS.filter((s) => sheetAvail(s, info)).map((s) => ({
    id: s.id, nama: s.nama, desc: s.desc, lock: !!s.lock,
    cols: s.cols ? COLS[s.id].filter((c) => usable(c, info)).map((c) => ({ id: c.id, h: c.h, grp: c.grp, req: !!c.req })) : null,
  }));
}

// Informasi turunan filter aktif. lines boleh null (dialog belum memuat baris pesanan).
export function xlInfo({ data, unmapped, st, lines }) {
  const s = (data && data.ringkasan) || {};
  const hasSet = n0(s.set_total) > 0 || n0(s.set_cek) > 0;
  const hasPcs = n0(s.pcs_total) > 0;
  return {
    hasSet, hasPcs,
    adaSet: lines ? lines.some((l) => l.kind === 'SET') : hasSet,
    adaPcs: lines ? lines.some((l) => l.kind !== 'SET') : hasPcs,
    semuaStatus: st.status === 'ALL',
    provinsiDipilih: !!st.provinsi,
    multiKategori: st.kelompok.length !== 1,
    adaBelum: !!(st.provinsi && unmapped && unmapped.length),
  };
}

// Pilihan awal untuk satu preset. 'kustom' tanpa simpanan = mulai dari preset internal.
export function xlDefaultSel(presetId, info) {
  const p = XL_PRESETS.find((x) => x.id === presetId && x.sheets) || XL_PRESETS.find((x) => x.id === 'internal');
  const sheets = p.sheets.filter((id) => sheetAvail(XL_SHEETS.find((s) => s.id === id), info));
  const cols = {};
  Object.keys(COLS).forEach((sid) => {
    cols[sid] = COLS[sid].filter((c) => usable(c, info) && (c.req || p.grp[c.grp])).map((c) => c.id);
  });
  return { preset: presetId === 'kustom' ? 'kustom' : p.id, sheets, cols, untuk: '', oleh: '', catatan: '', tanpaCek: false };
}

// ── util ─────────────────────────────────────────────────────────────────────
function perkiraanBaris(text, width) {
  return String(text == null ? '' : text).split('\n')
    .reduce((a, p) => a + Math.max(1, Math.ceil(p.length / Math.max(1, width * 1.05))), 0);
}
const kosong = (v) => v === null || v === undefined || v === '';
const dihitung = (l) => !(l.kind === 'SET' && l.status_hitung === 'cek');

function labelHitung(l) {
  if (l.kind !== 'SET') return 'Jumlah sesuai pesanan';
  return { ok: 'Sesuai isi set', ok_beda: 'Sesuai, ada penyesuaian', estimasi: 'Perkiraan', cek: 'Belum dihitung' }[l.status_hitung] || 'Tidak diketahui';
}
// Keterangan per baris pesanan, dalam bahasa yang bisa dipahami pembaca luar.
function ketBaris(l) {
  if (l.kind !== 'SET') return '';
  if (l.status_hitung === 'cek') return 'Belum dihitung: jumlah item tidak sesuai isi set, perlu dicek';
  if (l.status_hitung === 'ok_beda') return 'Dihitung dari item yang sesuai isi set; ada item pengganti atau di luar isi set';
  if (l.status_hitung === 'estimasi') return l.set_kode ? 'Perkiraan: isi di sheet tidak lengkap atau berbeda dari isi set' : 'Perkiraan: isi set ini belum terdaftar di database produk';
  return '';
}

// ── pembangun workbook ───────────────────────────────────────────────────────
// ctx: { rows, data, unmapped, lines, st, h, now? }
//   h = { katName, spesNama, jenisNama, kategoriText(st), periodeText(st), fmtDate, fmt, toDate, localISODate, urutKategori[] }
// sel: hasil xlDefaultSel / pilihan pembaca.  Mengembalikan ArrayBuffer (xlsx).
export async function buildWorkbook(ExcelJS, ctx, sel) {
  const { rows: R, data: D, st, unmapped: U, h } = ctx;
  const { katName, spesNama, jenisNama, fmt, fmtDate } = h;
  const now = ctx.now || new Date();
  const preset = XL_PRESETS.find((p) => p.id === sel.preset) || XL_PRESETS[3];
  // Preset SPH dibaca pembeli: tanpa istilah teknis (perkiraan, deteksi alamat, belum dihitung, "Tidak tersedia", nama aplikasi).
  // Angka tetap sama; hanya cara menyampaikannya yang dibersihkan.
  const sph = preset.id === 'sph';
  const belumLabel = sph ? 'Lainnya' : BELUM;
  const xlDate = (s) => { const d = h.toDate(s); return d ? new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) : null; };

  // Provinsi/Kab-Kota ikut ke tiap baris pesanan supaya sheet Rincian bisa difilter per wilayah.
  const wil = new Map(R.map((x) => [x.customer, x]));
  const semuaLines = ctx.lines.map((b) => {
    const w = wil.get(b.customer) || {};
    return Object.assign({}, b, { provinsi: b.provinsi || w.provinsi || '', kab_kota: b.kab_kota || w.kab_kota || '' });
  });
  const belumDihitungN = semuaLines.filter((l) => !dihitung(l)).length;
  const lines = sel.tanpaCek ? semuaLines.filter(dihitung) : semuaLines;
  const info = xlInfo({ data: D, unmapped: U, st, lines });

  const s = D.ringkasan || {};
  const { hasSet, hasPcs, semuaStatus, provinsiDipilih } = info;
  const lokasi = st.provinsi || 'Semua provinsi';
  const kategori = h.kategoriText(st);
  const statusText = semuaStatus ? 'terkirim dan dalam proses' : 'terkirim saja';
  const subLine = `${kategori} · ${lokasi} · ${statusText} · data per ${fmtDate(D.data_per)}`;
  const diunduhPendek = now.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  const footTxt = `Populasi ${kategori} - ${lokasi} - diunduh ${h.localISODate(now)}`.replace(/&/g, '&&');
  const FOOT = { oddFooter: `&L&8${footTxt}&R&8Halaman &P dari &N` };
  const page = (orientation) => ({
    paperSize: 9, orientation, fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Populasi PNM';
  wb.created = now;
  wb.title = `Populasi ${kategori} - ${lokasi}`;
  wb.subject = `${preset.nama} · ${subLine}`;
  wb.description = sph ? 'Lampiran populasi produk.' : 'Dibuat dari aplikasi Populasi. Arti kolom dan cara membaca angka ada di sheet "Catatan & Kamus".';

  // ═══ BAHAN TURUNAN ═══════════════════════════════════════════════════════════
  const peta = {};                 // customer -> {pertama, estimasi}
  lines.forEach((l) => {
    const o = peta[l.customer] || (peta[l.customer] = { pertama: '', estimasi: 0 });
    if (l.tanggal && (!o.pertama || l.tanggal < o.pertama)) o.pertama = l.tanggal;
    if (l.kind === 'SET' && l.status_hitung === 'estimasi') o.estimasi += n0(l.nilai);
  });

  const sumberTxt = (x) => (x.sumber_wilayah === 'manual' ? 'Koreksi manual' : (x.sumber_wilayah === 'alamat' ? 'Deteksi alamat' : ''));
  const itemsRs = R.map((x, i) => {
    const o = peta[x.customer] || { pertama: '', estimasi: 0 };
    const ket = [];
    if (o.estimasi > 0) ket.push(`${fmt(o.estimasi)} set berupa perkiraan`);
    if (n0(x.set_cek) > 0) ket.push(`${fmt(x.set_cek)} pesanan set belum dihitung (perlu dicek)`);
    if (!x.provinsi) ket.push('wilayah belum diketahui');
    return {
      no: i + 1, customer: x.customer, kab: x.kab_kota || '', provinsi: x.provinsi || (sph ? '' : BELUM),
      set_t: n0(x.set_terkirim), set_p: n0(x.set_proses), set: x.set,
      pcs_t: n0(x.pcs_terkirim), pcs_p: n0(x.pcs_proses), pcs: x.pcs,
      pesanan: n0(x.jumlah_pesanan), pertama: xlDate(o.pertama), terakhir: xlDate(x.terakhir),
      rincian: '', _rinc: x.rincian || [],
      ket: sph ? '' : ket.join('; '), sumber: sumberTxt(x),
    };
  });

  // Per produk. Kunci: set = kategori + nama set; barang satuan = kode + nama (nama tidak diubah).
  const pm = new Map();
  lines.forEach((l) => {
    const isSet = l.kind === 'SET';
    const nama = isSet ? l.label : l.produk;
    const key = isSet ? `S|${l.kelompok}|${nama}` : `P|${l.kode_produk || ''}|${nama}`;
    const o = pm.get(key) || {
      nama: nama || '', kode: isSet ? '' : (l.kode_produk || ''), kategori: katName(l.kelompok),
      spes: new Set(), set_t: 0, set_p: 0, pcs_t: 0, pcs_p: 0, rs: new Set(), prov: new Set(),
      pesanan: 0, pertama: '', terakhir: '', est: 0, cek: 0, isSet,
    };
    if (l.spes) o.spes.add(spesNama(l.spes));
    o.pesanan += 1;
    if (l.tanggal) {
      if (!o.pertama || l.tanggal < o.pertama) o.pertama = l.tanggal;
      if (!o.terakhir || l.tanggal > o.terakhir) o.terakhir = l.tanggal;
    }
    if (dihitung(l)) {
      const v = n0(l.nilai);
      const kirim = l.status === 'TERKIRIM';
      const f = (isSet ? 'set' : 'pcs') + (kirim ? '_t' : '_p');
      o[f] += v;
      o.rs.add(l.customer);
      if (l.provinsi) o.prov.add(l.provinsi);
    } else o.cek += 1;
    if (isSet && l.status_hitung === 'estimasi') o.est += 1;
    pm.set(key, o);
  });
  const itemsProduk = Array.from(pm.values()).map((o) => {
    const ket = [];
    if (o.est) ket.push(`${fmt(o.est)} pesanan berupa perkiraan`);
    if (o.cek) ket.push(`${fmt(o.cek)} pesanan belum dihitung`);
    return {
      nama: o.nama, kode: o.kode, kategori: o.kategori, spes: Array.from(o.spes).join(' / '),
      set_t: o.isSet ? o.set_t : null, set_p: o.isSet ? o.set_p : null, set: o.isSet ? o.set_t + o.set_p : null,
      pcs_t: o.isSet ? null : o.pcs_t, pcs_p: o.isSet ? null : o.pcs_p, pcs: o.isSet ? null : o.pcs_t + o.pcs_p,
      rs: o.rs.size, prov: o.prov.size, pesanan: o.pesanan,
      pertama: xlDate(o.pertama), terakhir: xlDate(o.terakhir), ket: sph ? '' : ket.join('; '),
    };
  }).sort((a, b) => (n0(b.set) + n0(b.pcs)) - (n0(a.set) + n0(a.pcs)) || String(a.nama).localeCompare(String(b.nama), 'id'))
    .filter((o) => !sph || n0(o.set) + n0(o.pcs) > 0)   // SPH: produk yang tidak punya angka tidak ditampilkan
    .map((o, i) => Object.assign(o, { no: i + 1 }));

  // Per provinsi (dari baris RS dari server, supaya angkanya sama dengan Daftar RS).
  const gp = new Map();
  R.forEach((x) => {
    const k = x.provinsi || belumLabel;
    const o = gp.get(k) || { provinsi: k, rs: 0, set: 0, pcs: 0, pesanan: 0, terakhir: '' };
    o.rs += 1; o.set += x.set; o.pcs += x.pcs; o.pesanan += n0(x.jumlah_pesanan);
    if (x.terakhir && x.terakhir > o.terakhir) o.terakhir = x.terakhir;
    gp.set(k, o);
  });
  const itemsProv = Array.from(gp.values())
    .sort((a, b) => ((a.provinsi === belumLabel) - (b.provinsi === belumLabel)) || (b.set + b.pcs) - (a.set + a.pcs) || a.provinsi.localeCompare(b.provinsi, 'id'))
    .map((o, i) => Object.assign({}, o, { no: i + 1, terakhir: xlDate(o.terakhir) }));

  // Rincian pesanan
  const ord = new Map(R.map((x, i) => [x.customer, i]));
  const sorted = lines.slice().sort((a, b) =>
    ((ord.get(a.customer) || 0) - (ord.get(b.customer) || 0)) ||
    String(b.tanggal || '').localeCompare(String(a.tanggal || '')) ||
    String(a.kode_rmp || '').localeCompare(String(b.kode_rmp || ''), 'id'));
  const itemsPesanan = sorted.map((l) => {
    const ok = dihitung(l);
    return {
      _dim: !ok,
      customer: l.customer, kab: l.kab_kota || '', provinsi: l.provinsi || BELUM, kategori: katName(l.kelompok),
      jenis: l.kind === 'SET' ? l.label : l.produk, kode: l.kind === 'SET' ? '' : (l.kode_produk || ''),
      spes: l.spes ? spesNama(l.spes) : '', jenisInstr: l.jenis ? jenisNama(l.jenis) : '', mikro: l.mikro ? 'Ya' : '',
      // Jumlah dikosongkan untuk pesanan yang tidak dihitung, supaya total kolom sama dengan Daftar RS.
      set: l.kind === 'SET' && ok ? n0(l.nilai) : null, pcs: l.kind !== 'SET' && ok ? n0(l.nilai) : null,
      status: l.status === 'TERKIRIM' ? 'Terkirim' : 'Dalam proses', tanggal: xlDate(l.tanggal),
      rmp: l.kode_rmp || '', po: l.po || '', shitung: labelHitung(l), ket: ketBaris(l),
      family: l.family || '', baris: n0(l.jumlah_baris), sheet: l.sumber_sheet || '', asli: l.label_asli || '',
    };
  });

  // RS per kategori
  const urut = (h.urutKategori || []).concat('ISI SET');
  const present = urut.filter((id) => lines.some((l) => l.kelompok === id && dihitung(l) && n0(l.nilai) > 0));
  const by = new Map();
  lines.forEach((l) => {
    if (!dihitung(l)) return;
    const o = by.get(l.customer) || { customer: l.customer, provinsi: l.provinsi || '', kab: l.kab_kota || '', v: {} };
    o.v[l.kelompok] = (o.v[l.kelompok] || 0) + n0(l.nilai);
    by.set(l.customer, o);
  });

  // ═══ RENCANA SHEET ═══════════════════════════════════════════════════════════
  const pilih = new Set(sel.sheets || []);
  const dilewati = [];
  const plan = ORDER.filter((id) => {
    const def = XL_SHEETS.find((x) => x.id === id);
    if (def.lock) return true;
    if (!pilih.has(id) || !sheetAvail(def, info)) return false;
    if (id === 'matriks' && present.length < 2) { dilewati.push('RS per Kategori: hasilnya hanya memuat satu kategori.'); return false; }
    if ((id === 'pesanan' || id === 'produk' || id === 'rincianrs') && !lines.length) { dilewati.push(`${def.nama}: tidak ada baris pesanan.`); return false; }
    return true;
  });

  // "Jenis yang dipesan": satu produk per baris. Bila ada sheet "Produk per RS", cukup 5 teratas di sini supaya sel tidak jadi satu blok panjang.
  const adaRincianRs = plan.includes('rincianrs');
  itemsRs.forEach((it) => {
    const r = it._rinc.map((j) => `${j.label} ×${fmt(j.nilai)}`);
    it.rincian = adaRincianRs && r.length > 5
      ? r.slice(0, 5).concat(`+ ${r.length - 5} jenis lainnya (lengkapnya di sheet “Produk per RS”)`).join('\n')
      : r.join('\n');
  });

  const dibuang = [];              // kolom terpilih tetapi seluruhnya kosong
  const kamus = [];                // [sheet, kolom, arti] untuk Catatan & Kamus

  // Kolom yang dipakai satu sheet: relevan + dipilih (atau wajib) + tidak kosong total bila drop.
  function pickCols(sid, items) {
    const dipilih = new Set((sel.cols && sel.cols[sid]) || []);
    return COLS[sid].filter((c) => usable(c, info) && (c.req || dipilih.has(c.id))).filter((c) => {
      if (c.drop && items.every((it) => kosong(it[c.k]))) { dibuang.push(`${XL_SHEETS.find((x) => x.id === sid).nama}: ${c.h}`); return false; }
      return true;
    });
  }

  // ═══ PENULIS SHEET BERBENTUK DOKUMEN (Ringkasan, Catatan) ════════════════════
  function docWriter(ws, widths) {
    const nc = widths.length;
    const chars = Math.floor(widths.reduce((a, b) => a + b, 0) * 0.9);
    ws.columns = widths.map((w) => ({ width: w }));
    let r = 1;
    const api = {
      cell: (c) => ws.getCell(r, c),
      skip: (k = 1) => { r += k; },
      wide(text, o = {}) {
        ws.mergeCells(r, 1, r, nc);
        const c = ws.getCell(r, 1);
        c.value = text;
        c.font = { size: o.size || 11, bold: !!o.bold, color: { argb: o.color || XL.ink } };
        c.alignment = { wrapText: true, vertical: 'middle', horizontal: 'left', indent: o.indent || 0 };
        if (o.fill) c.fill = xlFill(o.fill);
        ws.getRow(r).height = o.height || Math.max(18, perkiraanBaris(text, chars / ((o.size || 11) / 11)) * 15 + 4);
        r++;
      },
      section(t) {
        r++;
        const row = ws.getRow(r);
        for (let i = 1; i <= nc; i++) row.getCell(i).border = { bottom: { style: 'medium', color: { argb: XL.navy } } };
        row.getCell(1).value = t;
        row.getCell(1).font = { bold: true, size: 12, color: { argb: XL.navy } };
        row.height = 22;
        r++;
      },
      // kv: label di kolom 1, nilai di kolom 2 (merge sampai akhir bila merge=true supaya teks panjang terbaca).
      kv(k, v, f, note, merge) {
        const row = ws.getRow(r);
        row.getCell(1).value = k;
        row.getCell(1).font = { color: { argb: XL.soft } };
        row.getCell(1).alignment = { vertical: 'top' };
        let hgt = 18;
        if (merge) {
          ws.mergeCells(r, 2, r, nc);
          const c = row.getCell(2);
          c.value = v;
          c.font = { bold: true, color: { argb: XL.ink } };
          c.alignment = { wrapText: true, vertical: 'top', horizontal: 'left' };
          hgt = Math.max(18, perkiraanBaris(v, widths.slice(1).reduce((a, b) => a + b, 0) * 0.9) * 15 + 4);
        } else {
          const c = row.getCell(2);
          c.value = v;
          c.font = { bold: true, color: { argb: XL.ink } };
          c.alignment = { horizontal: 'left' };
          if (f) c.numFmt = f;
          if (note) { row.getCell(3).value = note; row.getCell(3).font = { size: 10, color: { argb: XL.soft } }; }
        }
        row.height = hgt;
        r++;
      },
      // daftar "nama + penjelasan": nama di kolom 1, penjelasan digabung kolom 2..akhir.
      item(nama, desc) {
        const row = ws.getRow(r);
        row.getCell(1).value = nama;
        row.getCell(1).font = { bold: true, color: { argb: XL.ink } };
        row.getCell(1).alignment = { vertical: 'top' };
        ws.mergeCells(r, 2, r, nc);
        row.getCell(2).value = desc;
        row.getCell(2).font = { color: { argb: XL.soft } };
        row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
        row.height = Math.max(18, perkiraanBaris(desc, widths.slice(1).reduce((a, b) => a + b, 0) * 0.9) * 15 + 4);
        r++;
      },
      table(heads, aligns, body) {
        const hr = ws.getRow(r++);
        hr.height = 22;
        heads.forEach((t, i) => {
          const c = hr.getCell(i + 1);
          c.value = t;
          c.font = { bold: true, size: 10.5, color: { argb: XL.white } };
          c.fill = xlFill(XL.navy);
          c.alignment = { vertical: 'middle', horizontal: aligns[i] };
        });
        body.forEach((vals) => {
          const row = ws.getRow(r++);
          let lines2 = 1;
          vals.forEach((v, i) => {
            const c = row.getCell(i + 1);
            c.value = v;
            c.border = { bottom: xlLine };
            c.alignment = { vertical: 'middle', horizontal: aligns[i], wrapText: typeof v === 'string' };
            if (typeof v === 'number') c.numFmt = XL_NUMZ;
            if (v === NA) c.font = { italic: true, color: { argb: XL.soft } };
            if (typeof v === 'string') lines2 = Math.max(lines2, perkiraanBaris(v, widths[i]));
          });
          row.height = Math.max(18, lines2 * 15 + 4);
        });
      },
    };
    return api;
  }

  // ═══ SHEET BERBENTUK TABEL ═══════════════════════════════════════════════════
  // Baris 1 judul, baris 2 keterangan, baris 4 header (beku), data mulai baris 5.
  const HEAD = 4;
  function tableSheet(name, o) {
    const ws = wb.addWorksheet(name, {
      views: [{ state: 'frozen', xSplit: o.freeze || 0, ySplit: HEAD, showGridLines: false }],
      pageSetup: Object.assign({ printTitlesRow: `${HEAD}:${HEAD}` }, page('landscape')),
      headerFooter: FOOT,
      properties: { tabColor: { argb: XL.tabData } },
    });
    const cols = o.cols;
    const alignOf = (c) => c.align || (c.fmt === XL_DATE ? 'center' : (c.fmt ? 'right' : 'left'));
    cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.w; });

    ws.getCell(1, 1).value = o.title;
    ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: XL.ink } };
    ws.getRow(1).height = 24;
    ws.getCell(2, 1).value = o.sub;
    ws.getCell(2, 1).font = { size: 10, color: { argb: XL.soft } };
    if (o.note) {
      ws.getCell(3, 1).value = o.note;
      ws.getCell(3, 1).font = { size: 9.5, italic: true, color: { argb: XL.soft } };
    }

    const hr = ws.getRow(HEAD);
    hr.height = 32;
    cols.forEach((c, i) => {
      const cell = hr.getCell(i + 1);
      cell.value = c.h;
      cell.font = { bold: true, size: 10.5, color: { argb: c.tech ? XL.soft : XL.white } };
      cell.fill = xlFill(c.tech ? XL.line : XL.navy);
      cell.alignment = { vertical: 'middle', horizontal: alignOf(c), wrapText: true };
    });

    o.items.forEach((it, ri) => {
      const row = ws.getRow(HEAD + 1 + ri);
      let maxLines = 1;
      cols.forEach((c, i) => {
        const cell = row.getCell(i + 1);
        let v = it[c.k];
        const tidakAda = !o.bersih && c.na && kosong(v);
        if (tidakAda) v = NA;
        cell.value = v === undefined ? null : v;
        if (c.fmt) cell.numFmt = c.fmt;
        cell.alignment = { vertical: 'middle', horizontal: alignOf(c), wrapText: !!c.wrap };
        cell.border = { bottom: xlLine };
        const muted = c.tech || it._dim || tidakAda;
        cell.font = { color: { argb: c.warn && v ? XL.warn : (muted ? XL.soft : XL.ink) }, size: c.tech ? 10 : 11, italic: tidakAda };
        if (c.wrap && v) maxLines = Math.max(maxLines, perkiraanBaris(v, c.w));
      });
      row.height = Math.min(409, Math.max(18, maxLines * 15 + 4));
    });

    const last = HEAD + o.items.length;
    if (o.totals && o.items.length) {
      const tr = ws.getRow(last + 1);
      tr.height = 22;
      cols.forEach((c, i) => {
        const cell = tr.getCell(i + 1);
        cell.fill = xlFill(XL.band);
        cell.border = { top: { style: 'thin', color: { argb: XL.navy } } };
        cell.font = { bold: true, color: { argb: XL.ink } };
      });
      const labelCol = Math.max(1, cols.findIndex((c) => c.k === o.labelKey) + 1);
      tr.getCell(labelCol).value = o.bersih ? 'Total' : 'Total (mengikuti filter)';
      o.totals.forEach((k) => {
        const idx = cols.findIndex((c) => c.k === k);
        if (idx < 0) return;
        const L = ws.getColumn(idx + 1).letter;
        const cell = tr.getCell(idx + 1);
        // SUBTOTAL(109) mengabaikan baris yang tersaring, jadi total ikut berubah saat pembaca memfilter.
        cell.value = { formula: `SUBTOTAL(109,${L}${HEAD + 1}:${L}${last})`, result: o.items.reduce((a, it) => a + n0(it[k]), 0) };
        cell.numFmt = XL_NUMZ;
        cell.alignment = { horizontal: 'right' };
      });
    }
    ws.autoFilter = { from: { row: HEAD, column: 1 }, to: { row: HEAD + Math.max(1, o.items.length), column: cols.length } };
    cols.forEach((c) => kamus.push([name, c.h, c.desc || '']));
    return ws;
  }

  const sumTot = (cols, ks) => ks.filter((k) => cols.some((c) => c.k === k));
  const teknisAda = (cols) => cols.some((c) => c.tech);
  const subTek = (cols) => (teknisAda(cols) ? '  ·  kolom abu-abu di kanan = data teknis' : '');
  const NOTE_KOSONG0 = 'Sel kosong = tidak tercatat di sumber data. “–” = nol. “Tidak tersedia” / “Belum diketahui” = data belum ada. Arti kolom: sheet “Catatan & Kamus”.';
  const NOTE_KOSONG = sph ? '' : NOTE_KOSONG0;

  // ═══ 1) RINGKASAN ════════════════════════════════════════════════════════════
  const w0 = wb.addWorksheet('Ringkasan', {
    views: [{ showGridLines: false }], pageSetup: page('portrait'), headerFooter: FOOT,
    properties: { tabColor: { argb: XL.tabMain } },
  });
  const W0 = [46, 22, 16, 16, 16];
  const d0 = docWriter(w0, W0);

  d0.cell(1).value = `Populasi ${kategori}`;
  d0.cell(1).font = { bold: true, size: 18, color: { argb: XL.ink } };
  w0.getRow(1).height = 30;
  d0.skip();
  d0.cell(1).value = `${lokasi}  ·  data per ${fmtDate(D.data_per)}  ·  diunduh ${diunduhPendek}`;
  d0.cell(1).font = { size: 10.5, color: { argb: XL.soft } };
  w0.getRow(2).height = 18;
  d0.skip();
  const untukOleh = [sel.untuk && sel.untuk.trim() ? `Disiapkan untuk: ${sel.untuk.trim()}` : '', sel.oleh && sel.oleh.trim() ? `Disiapkan oleh: ${sel.oleh.trim()}` : ''].filter(Boolean).join('   ·   ');
  if (untukOleh) d0.wide(untukOleh, { size: 10.5, bold: true, color: XL.navy });
  d0.skip();

  const angka = [];
  if (hasSet) angka.push(`${fmt(s.set_total)} set`);
  if (hasPcs) angka.push(`${fmt(s.pcs_total)} unit/pcs`);
  const jawaban = angka.length
    ? `${angka.join(' dan ')} di ${fmt(s.jumlah_rs)} rumah sakit/instansi ${provinsiDipilih ? 'di ' + st.provinsi : 'di semua provinsi'}, ` +
      (semuaStatus ? 'termasuk pesanan yang masih dalam proses.' : 'hanya pesanan yang sudah terkirim.')
    : 'Tidak ada pesanan yang cocok dengan filter ini.';
  d0.wide(jawaban, { size: 13, bold: true, fill: XL.hint, height: Math.max(40, perkiraanBaris(jawaban, 85) * 19 + 8) });
  if (sel.catatan && sel.catatan.trim()) d0.wide(sel.catatan.trim(), { size: 10.5, color: XL.ink });

  // Perhatian: hal yang mengubah cara membaca angka, ditaruh di halaman pertama.
  const perhatian = [];
  if (!sph && hasSet && n0(s.set_estimasi) > 0) perhatian.push(`${fmt(s.set_estimasi)} set berupa perkiraan (isi set belum terdaftar atau isi di sheet tidak lengkap).`);
  if (!sph && hasSet && n0(s.set_cek) > 0) perhatian.push(`${fmt(s.set_cek)} pesanan set belum dihitung karena jumlah itemnya tidak sesuai isi set.`);
  if (!sph && info.adaBelum) perhatian.push(`${fmt(U.length)} RS lain belum diketahui wilayahnya dan belum termasuk dalam angka ${st.provinsi}.`);
  if (perhatian.length) {
    d0.skip();
    perhatian.forEach((t) => d0.wide('⚠  ' + t, { size: 10.5, color: XL.warn, fill: XL.warnBg }));
  }

  d0.section('Hasil');
  d0.kv('Rumah sakit / instansi', n0(s.jumlah_rs), XL_NUM);
  if (hasSet) d0.kv('Set', n0(s.set_total), XL_NUM, !sph && n0(s.set_estimasi) > 0 ? `${fmt(s.set_estimasi)} di antaranya perkiraan` : '');
  if (hasSet && semuaStatus) { d0.kv('   sudah terkirim', n0(s.set_terkirim), XL_NUM); d0.kv('   masih dalam proses', n0(s.set_proses), XL_NUM); }
  if (hasPcs) d0.kv('Unit/pcs', n0(s.pcs_total), XL_NUM);
  if (hasPcs && semuaStatus) { d0.kv('   sudah terkirim', n0(s.pcs_terkirim), XL_NUM); d0.kv('   masih dalam proses', n0(s.pcs_proses), XL_NUM); }
  d0.kv('Jumlah pesanan', n0(s.jumlah_pesanan), XL_NUM);
  if (itemsProduk.length) d0.kv('Jumlah produk / jenis set', itemsProduk.length, XL_NUM);
  const terakhir = R.reduce((m, x) => (x.terakhir && x.terakhir > m ? x.terakhir : m), '');
  if (terakhir) d0.kv('Pesanan terakhir', xlDate(terakhir), XL_DATE);

  const kolUnit = (hSet, hPcs) => [].concat(hasSet ? [hSet] : [], hasPcs ? [hPcs] : []);
  const alUnit = [].concat(hasSet ? ['right'] : [], hasPcs ? ['right'] : []);
  if (R.length > 5) {
    d0.section(`${Math.min(10, R.length)} rumah sakit/instansi dengan jumlah terbanyak`);
    const top = R.slice().sort((a, b) => b.total - a.total || a.customer.localeCompare(b.customer, 'id')).slice(0, 10);
    const adaKab = top.some((x) => x.kab_kota);   // kolom kosong total dibuang; sebagian kosong = "Tidak tersedia"
    d0.table(['Rumah sakit / instansi'].concat(adaKab ? ['Kab/Kota'] : [], kolUnit('Set', 'Unit/pcs')), ['left'].concat(adaKab ? ['left'] : [], alUnit),
      top.map((x) => [x.customer].concat(adaKab ? [x.kab_kota || (sph ? '' : NA)] : [], hasSet ? [x.set] : [], hasPcs ? [x.pcs] : [])));
    if (plan.includes('rs')) d0.wide('Daftar lengkap ada di sheet “Daftar RS”.', { size: 10, color: XL.soft });
  }
  if (itemsProduk.length > 1) {
    d0.section(`${Math.min(10, itemsProduk.length)} produk / jenis set terbanyak`);
    d0.table(['Produk / jenis set', 'Kategori'].concat(kolUnit('Set', 'Unit/pcs')), ['left', 'left'].concat(alUnit),
      itemsProduk.slice(0, 10).map((x) => [x.nama, x.kategori].concat(hasSet ? [x.set] : [], hasPcs ? [x.pcs] : [])));
    if (plan.includes('produk')) d0.wide('Daftar lengkap ada di sheet “Per Produk”.', { size: 10, color: XL.soft });
  }
  if (!provinsiDipilih && R.length && !plan.includes('provinsi')) {
    d0.section('Per provinsi');
    d0.table(['Provinsi', 'Jumlah RS'].concat(kolUnit('Set', 'Unit/pcs')), ['left', 'right'].concat(alUnit),
      itemsProv.map((o) => [o.provinsi, o.rs].concat(hasSet ? [o.set] : [], hasPcs ? [o.pcs] : [])));
  }

  d0.section('Filter yang dipakai');
  d0.kv('Provinsi', lokasi);
  d0.kv('Kategori', kategori);
  if (st.spes.length) d0.kv('Spesialisasi', st.spes.map(spesNama).join(', '));
  if (st.jenis.length) d0.kv('Jenis instrumen', st.jenis.map(jenisNama).join(', '));
  if (st.mikro) d0.kv('Hanya mikrosurgery', 'Ya');
  if (st.produk.trim()) d0.kv('Nama produk mengandung', st.produk.trim());
  if (st.produk.trim() && !sph) d0.kv('Isi set ikut dihitung', st.isiSet ? 'Ya' : 'Tidak');
  if (st.rs.trim()) d0.kv('Rumah sakit', st.rs.trim());
  d0.kv('Status pesanan', statusText.charAt(0).toUpperCase() + statusText.slice(1));
  d0.kv('Periode', h.periodeText(st));
  if (!sph) d0.kv('Cakupan data', st.cakupan === 'SEMUA' ? 'Semua pesanan non-sample (termasuk retail)' : 'INAPROC dan pembelian langsung (tanpa retail, konsinyasi, sample)');
  else if (st.cakupan !== 'SEMUA') d0.kv('Cakupan data', 'INAPROC dan pembelian langsung');

  d0.section('Isi file ini');
  plan.filter((id) => id !== 'ringkasan').forEach((id) => {
    const def = XL_SHEETS.find((x) => x.id === id);
    if (sph && id === 'catatan') d0.item('Catatan', 'Cara membaca angka.');
    else d0.item(def.nama, def.desc);
  });

  // ═══ 2-7) SHEET DATA ═════════════════════════════════════════════════════════
  if (plan.includes('rs')) {
    const cols = pickCols('rs', itemsRs);
    tableSheet('Daftar RS', {
      bersih: sph,
      title: 'Daftar rumah sakit / instansi', sub: subLine + subTek(cols), note: NOTE_KOSONG,
      cols, freeze: 2, labelKey: 'customer',
      totals: sumTot(cols, ['set_t', 'set_p', 'set', 'pcs_t', 'pcs_p', 'pcs', 'pesanan']), items: itemsRs,
    });
  }
  if (plan.includes('rincianrs')) {
    const pr = new Map();
    lines.forEach((l) => {
      if (!dihitung(l)) return;
      const isSet = l.kind === 'SET';
      const nama = isSet ? l.label : l.produk;
      const key = `${l.customer}|${isSet ? 'S' : 'P'}|${isSet ? l.kelompok : (l.kode_produk || '')}|${nama}`;
      const o = pr.get(key) || { customer: l.customer, nama: nama || '', kategori: katName(l.kelompok), set: 0, pcs: 0, isSet };
      o[isSet ? 'set' : 'pcs'] += n0(l.nilai);
      pr.set(key, o);
    });
    const items = Array.from(pr.values())
      .sort((a, b) => ((ord.get(a.customer) || 0) - (ord.get(b.customer) || 0)) || (n0(b.set) + n0(b.pcs)) - (n0(a.set) + n0(a.pcs)) || String(a.nama).localeCompare(String(b.nama), 'id'))
      .map((o) => {
        const w = wil.get(o.customer) || {};
        return { customer: o.customer, kab: w.kab_kota || '', provinsi: w.provinsi || (sph ? '' : BELUM), nama: o.nama, kategori: o.kategori, set: o.isSet ? o.set : null, pcs: o.isSet ? null : o.pcs };
      });
    const cols = [
      { h: 'Rumah sakit / instansi', k: 'customer', w: 40, desc: 'Nama customer.' },
      { h: 'Kab/Kota', k: 'kab', w: 20, na: 1, desc: 'Kabupaten/kota.' },
      { h: 'Provinsi', k: 'provinsi', w: 18, desc: 'Provinsi.' },
      { h: 'Produk / jenis set', k: 'nama', w: 52, wrap: 1, desc: 'Nama produk atau jenis set.' },
      { h: 'Kategori', k: 'kategori', w: 18, desc: 'Kategori produk.' },
      { h: 'Jumlah set', k: 'set', w: 11, fmt: XL_NUMZ, desc: 'Jumlah set.' },
      { h: 'Jumlah unit/pcs', k: 'pcs', w: 12, fmt: XL_NUMZ, desc: 'Jumlah barang satuan.' },
    ].filter((c) => !((c.k === 'kab' || c.k === 'provinsi') && items.every((it) => kosong(it[c.k]))))
     .filter((c) => !(c.k === 'set' && !items.some((it) => it.set !== null)) && !(c.k === 'pcs' && !items.some((it) => it.pcs !== null)));
    tableSheet('Produk per RS', {
      bersih: sph, title: 'Produk yang dipesan per rumah sakit / instansi', sub: subLine,
      note: 'Satu baris per rumah sakit dan produk. Gunakan filter di judul kolom untuk melihat satu RS atau satu produk.',
      cols, freeze: 1, labelKey: 'customer', totals: sumTot(cols, ['set', 'pcs']), items,
    });
  }
  if (plan.includes('produk')) {
    const cols = pickCols('produk', itemsProduk);
    tableSheet('Per Produk', {
      bersih: sph,
      title: 'Populasi per produk / jenis set', sub: subLine + subTek(cols),
      note: sph ? 'Jumlah set dan unit/pcs dipisah karena satuannya berbeda.' : 'Hanya pesanan yang dihitung; jumlah set dan unit/pcs dipisah karena satuannya berbeda. ' + NOTE_KOSONG,
      cols, freeze: 2, labelKey: 'nama',
      totals: sumTot(cols, ['set_t', 'set_p', 'set', 'pcs_t', 'pcs_p', 'pcs']), items: itemsProduk,   // 'Jumlah pesanan' tidak dijumlah: satu PO berisi beberapa produk
    });
  }
  if (plan.includes('provinsi')) {
    const cols = COLS_PROV.filter((c) => usable(c, info));
    tableSheet('Per Provinsi', {
      bersih: sph,
      title: 'Populasi per provinsi', sub: subLine,
      note: sph ? '' : 'Provinsi mengikuti data wilayah RS (koreksi manual, atau deteksi dari alamat bila belum dikoreksi). ' + NOTE_KOSONG,
      cols, freeze: 2, labelKey: 'provinsi', totals: sumTot(cols, ['rs', 'set', 'pcs', 'pesanan']), items: itemsProv,
    });
  }
  if (plan.includes('matriks')) {
    const mCols = [
      { h: 'Rumah sakit / instansi', k: 'customer', w: 44, desc: 'Nama customer.' },
      { h: 'Kab/Kota', k: 'kab', w: 22, na: 1, desc: 'Kabupaten/kota; “Tidak tersedia” bila tidak tercatat.' },
      { h: 'Provinsi', k: 'provinsi', w: 20, desc: 'Provinsi; “Belum diketahui” bila wilayah belum bisa ditentukan.' },
    ].concat(present.map((id, i) => ({
      h: `${katName(id)} (${id === 'SET' ? 'set' : 'unit/pcs'})`, k: 'c' + i, w: 18, fmt: XL_NUMZ,
      desc: `Jumlah ${id === 'SET' ? 'set' : 'unit/pcs'} kategori ${katName(id)} pada RS ini (hanya pesanan yang dihitung).`,
    })));
    const items = Array.from(by.values()).sort((a, b) => a.customer.localeCompare(b.customer, 'id')).map((o) => {
      const row = { customer: o.customer, kab: o.kab, provinsi: o.provinsi || BELUM };
      present.forEach((id, i) => { row['c' + i] = o.v[id] || null; });
      return row;
    });
    const cols = mCols.filter((c) => !(c.k === 'kab' && items.every((it) => kosong(it.kab))));
    tableSheet('RS per Kategori', {
      bersih: sph,
      title: 'Jumlah per rumah sakit / instansi menurut kategori', sub: subLine, note: NOTE_KOSONG,
      cols, freeze: 1, labelKey: 'customer', totals: present.map((id, i) => 'c' + i), items,
    });
  }
  if (plan.includes('pesanan')) {
    const cols = pickCols('pesanan', itemsPesanan);
    tableSheet('Rincian Pesanan', {
      bersih: sph,
      title: 'Rincian pesanan', sub: subLine + subTek(cols), note: NOTE_KOSONG,
      cols, freeze: 1, labelKey: 'customer', totals: sumTot(cols, ['set', 'pcs']), items: itemsPesanan,
    });
  }
  if (plan.includes('belum')) {
    tableSheet('Wilayah Belum Diketahui', {
      bersih: sph,
      title: 'Rumah sakit / instansi yang wilayahnya belum diketahui',
      sub: `Belum termasuk dalam angka ${st.provinsi} di sheet lain  ·  data per ${fmtDate(D.data_per)}`, note: NOTE_KOSONG,
      cols: [
        { h: 'Rumah sakit / instansi', k: 'customer', w: 48, desc: 'Nama customer.' },
        { h: 'Jumlah set', k: 'set', w: 12, fmt: XL_NUMZ, desc: 'Jumlah set.' },
        { h: 'Jumlah unit/pcs', k: 'pcs', w: 14, fmt: XL_NUMZ, desc: 'Jumlah barang satuan.' },
        { h: 'Jumlah pesanan', k: 'pesanan', w: 14, fmt: XL_NUMZ, desc: 'Jumlah pesanan menurut aplikasi.' },
      ],
      freeze: 1, labelKey: 'customer', totals: ['set', 'pcs', 'pesanan'],
      items: U.map((u) => ({ customer: u.customer, set: n0(u.set_total), pcs: n0(u.pcs_total), pesanan: n0(u.jumlah_pesanan) })),
    });
  }

  // ═══ 8) CATATAN & KAMUS ══════════════════════════════════════════════════════
  const wc = wb.addWorksheet(sph ? 'Catatan' : 'Catatan & Kamus', {
    views: [{ showGridLines: false }], pageSetup: page('landscape'), headerFooter: FOOT,
    properties: { tabColor: { argb: XL.tabRef } },
  });
  const dc = docWriter(wc, [34, 30, 92]);
  if (sph) {
    // Versi untuk pembaca luar: singkat, tanpa asal-usul data atau kualitas data internal.
    dc.cell(1).value = 'Catatan';
    dc.cell(1).font = { bold: true, size: 16, color: { argb: XL.ink } };
    wc.getRow(1).height = 28;
    dc.skip(); dc.skip();
    dc.section('Tentang file ini');
    dc.kv('Judul', `Populasi ${kategori}`, null, null, true);
    dc.kv('Data per', fmtDate(D.data_per), null, null, true);
    if (sel.untuk && sel.untuk.trim()) dc.kv('Disiapkan untuk', sel.untuk.trim(), null, null, true);
    if (sel.oleh && sel.oleh.trim()) dc.kv('Disiapkan oleh', sel.oleh.trim(), null, null, true);
    if (sel.catatan && sel.catatan.trim()) dc.kv('Catatan', sel.catatan.trim(), null, null, true);
    dc.section('Cara membaca angka');
    const bacaan = [];
    if (hasSet) bacaan.push('Set = jumlah set instrumen lengkap.');
    if (hasPcs) bacaan.push('Unit/pcs = jumlah barang satuan (instrumen satuan, elektromedis, alat laboratorium, dan sejenisnya).');
    if (hasSet && hasPcs) bacaan.push('Jumlah set dan unit/pcs tidak dijumlahkan karena satuannya berbeda.');
    bacaan.push(st.cakupan === 'SEMUA' ? 'Data mencakup seluruh pesanan.' : 'Data mencakup pesanan melalui INAPROC dan pembelian langsung.');
    bacaan.forEach((t) => dc.wide('•  ' + t));
    return wb.xlsx.writeBuffer();
  }
  dc.cell(1).value = 'Catatan dan kamus kolom';
  dc.cell(1).font = { bold: true, size: 16, color: { argb: XL.ink } };
  wc.getRow(1).height = 28;
  dc.skip();
  dc.cell(1).value = 'Supaya file ini bisa dipahami tanpa membuka aplikasi: dari mana angkanya, bagaimana dihitung, dan seberapa lengkap datanya.';
  dc.cell(1).font = { size: 10.5, color: { argb: XL.soft } };
  dc.skip();

  dc.section('Tentang file ini');
  dc.kv('Judul', `Populasi ${kategori}`, null, null, true);
  dc.kv('Jenis file', preset.nama, null, null, true);
  dc.kv('Data per', fmtDate(D.data_per), null, null, true);
  dc.kv('Diunduh', now.toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }), null, null, true);
  dc.kv('Sumber', 'Aplikasi Populasi PNM, dari database pesanan. File ini adalah salinan pada saat diunduh dan tidak diperbarui otomatis.', null, null, true);
  if (sel.untuk && sel.untuk.trim()) dc.kv('Disiapkan untuk', sel.untuk.trim(), null, null, true);
  if (sel.oleh && sel.oleh.trim()) dc.kv('Disiapkan oleh', sel.oleh.trim(), null, null, true);
  if (sel.catatan && sel.catatan.trim()) dc.kv('Catatan', sel.catatan.trim(), null, null, true);

  dc.section('Cara membaca angka');
  const cara = [];
  if (hasSet) cara.push('Set = jumlah set instrumen utuh. Dihitung dari isi set di database produk: jumlah item yang dipesan dibagi jumlah item itu di dalam satu set.');
  if (hasSet && n0(s.set_estimasi) > 0) cara.push(`${fmt(s.set_estimasi)} set berupa perkiraan karena isi setnya belum terdaftar di database produk atau isi di sheet tidak lengkap. Baris terkait diberi keterangan.`);
  if (hasSet && n0(s.set_cek) > 0) cara.push(`${fmt(s.set_cek)} pesanan set belum dihitung karena jumlah itemnya tidak sesuai isi set, jadi tidak masuk angka set.` +
    (sel.tanpaCek ? ' Pesanan tersebut sengaja tidak dicantumkan di file ini.'
      : (plan.includes('pesanan') ? ' Pesanannya tetap tercantum di Rincian Pesanan dengan keterangan.' : ' Pesanannya tidak dirinci di file ini; jumlahnya dicatat di Per Produk dan Daftar RS pada kolom Keterangan.')));
  if (hasPcs) cara.push('Unit/pcs = total jumlah barang satuan (instrumen satuan, elektromedis, alat laboratorium, dan sejenisnya). Jumlah set dan unit/pcs tidak dijumlahkan karena satuannya berbeda.');
  cara.push(st.cakupan === 'SEMUA'
    ? 'Cakupan: semua pesanan non-sample, termasuk retail.'
    : 'Cakupan: pesanan lewat INAPROC dan pembelian langsung. Retail, konsinyasi, dan sample tidak dihitung.');
  cara.push('Wilayah RS memakai koreksi manual bila ada. Bila tidak, wilayah dideteksi dari alamat pengiriman sehingga ada kemungkinan keliru.');
  if (info.adaBelum) cara.push(`${fmt(U.length)} RS lain belum diketahui wilayahnya dan tidak masuk angka ${st.provinsi}. Daftarnya ada di sheet “Wilayah Belum Diketahui”${plan.includes('belum') ? '' : ' (tidak disertakan di file ini)'}.`);
  cara.push('Sheet Ringkasan, Per Produk, Per Provinsi, dan RS per Kategori adalah hasil hitung pada saat diunduh. Bila Daftar RS atau Rincian Pesanan difilter, hanya baris Total di sheet itu yang ikut berubah.');
  cara.forEach((t) => dc.wide('•  ' + t));

  dc.section('Kualitas data pada hasil ini');
  const cnt = (f) => lines.filter(f).length;
  const wManual = R.filter((x) => x.provinsi && x.sumber_wilayah === 'manual').length;
  const wAlamat = R.filter((x) => x.provinsi && x.sumber_wilayah === 'alamat').length;
  const wBelum = R.filter((x) => !x.provinsi).length;
  const kabAda = R.filter((x) => x.kab_kota).length;
  const q = [
    ['Rumah sakit / instansi', R.length, 'Jumlah baris di Daftar RS.'],
    ['   wilayah: koreksi manual', wManual, 'Wilayah sudah dikoreksi oleh tim.'],
    ['   wilayah: deteksi alamat', wAlamat, 'Wilayah dideteksi otomatis dari alamat pengiriman; belum diverifikasi dan bisa keliru.'],
    ['   wilayah: belum diketahui', wBelum, 'Provinsi belum bisa ditentukan (tampil sebagai “Belum diketahui”).'],
    ['   kab/kota tercatat', kabAda, `Dari ${fmt(R.length)} RS; sisanya tidak tercatat.`],
  ];
  if (lines.length) {
    q.push(['Baris pesanan', lines.length, 'Jumlah baris di Rincian Pesanan (kombinasi PO dan produk).']);
    if (lines.some((l) => l.kind === 'SET')) {
      q.push(['   set: sesuai isi set', cnt((l) => l.kind === 'SET' && l.status_hitung === 'ok'), 'Jumlah item cocok dengan isi set.']);
      q.push(['   set: sesuai, ada penyesuaian', cnt((l) => l.kind === 'SET' && l.status_hitung === 'ok_beda'), 'Dihitung dari item yang cocok; ada item pengganti atau di luar isi set.']);
      q.push(['   set: perkiraan', cnt((l) => l.kind === 'SET' && l.status_hitung === 'estimasi'), 'Jumlah set diperkirakan dari QTY; belum diverifikasi terhadap isi set.']);
      q.push(['   set: belum dihitung', cnt((l) => l.kind === 'SET' && l.status_hitung === 'cek'), 'Tidak masuk hitungan set; perlu dicek.']);
    }
    if (lines.some((l) => l.kind !== 'SET')) q.push(['   barang satuan', cnt((l) => l.kind !== 'SET'), 'Jumlah sesuai yang tercatat di pesanan.']);
    q.push(['   tanpa tanggal pesanan', cnt((l) => !l.tanggal), 'Tanggal tidak tercatat; sel tanggal dibiarkan kosong.']);
  }
  if (sel.tanpaCek && belumDihitungN) q.push(['Pesanan tidak dicantumkan', belumDihitungN, 'Pesanan set yang belum dihitung, dikeluarkan dari Rincian Pesanan dan Per Produk atas pilihan saat unduh.']);
  dc.table(['Item', 'Jumlah', 'Arti'], ['left', 'right', 'left'], q);

  if (dibuang.length || dilewati.length) {
    dc.section('Yang tidak ditampilkan');
    dilewati.forEach((t) => dc.wide('•  Sheet tidak dibuat — ' + t));
    if (dibuang.length) dc.wide('•  Kolom berikut tidak ditampilkan karena tidak ada datanya pada hasil ini: ' + dibuang.join('; ') + '.');
  }

  dc.section('Tanda dalam sel');
  [
    'Sel kosong = tidak tercatat di sumber data. Tidak diisi atau ditebak.',
    '“Tidak tersedia” (huruf miring abu-abu) = kolom ini punya data untuk sebagian baris, tetapi tidak untuk baris ini.',
    '“Belum diketahui” = wilayah RS belum bisa ditentukan.',
    '“–” pada kolom angka = nol.',
    'Teks oranye = perlu perhatian (perkiraan atau belum dihitung). Baris abu-abu di Rincian Pesanan = pesanan yang belum dihitung.',
  ].forEach((t) => dc.wide('•  ' + t));

  dc.section('Arti kolom');
  const seen = new Set();
  const kamusU = kamus.filter(([sh, kol]) => { const k = sh + '|' + kol; if (seen.has(k)) return false; seen.add(k); return true; });
  dc.table(['Sheet', 'Kolom', 'Arti'], ['left', 'left', 'left'], kamusU);

  // Sheet dibuat berurutan sesuai ORDER (Ringkasan pertama, Catatan & Kamus terakhir), jadi urutan tab sudah benar.
  return wb.xlsx.writeBuffer();
}