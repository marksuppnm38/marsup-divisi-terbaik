// spek-maker/struktur-harga.js -- logika murni "Struktur Harga" (tanpa DOM / jsPDF).
//
// Menggantikan template Google Sheet `TEMPLATE STRUKTUR HARGA ...` di
// DOKUMEN_UPLOAD_V6.xlsx. Dulu isi template ditarik VLOOKUP dari sheet
// 'STRUKTUR HARGA' / 'STRUKTUR HARGA SET' / 'PL UNIT' / 'TANGGAL KADALUARSA';
// sekarang semuanya berasal dari 1 RPC: get_struktur_harga_data (sql/).
//
// Rumus (diambil apa adanya dari sheet):
//   Pengajuan Harga Tayang (DPP)  = harga EKATALOG / 1.11      (= HARGA UPLOAD V6)
//   tiap baris biaya              = Pengajuan x persentase tetap (RINCIAN)
//   HARGA TOTAL                   = SUM(baris biaya)  (= Pengajuan, karena persen = 100%)
//   "HARGA + PPN 12%"             = HARGA TOTAL x 1.11   (label di sheet "12%", faktor 1.11 --
//                                    dipertahankan persis; hasilnya = harga EKATALOG)
//   Pembulatan Harga Tayang       = ROUND(HARGA + PPN, 0)

export const FAKTOR_PPN = 1.11;

// urutan & persentase persis seperti di sheet (jumlah = 100%)
export const RINCIAN = [
  ['Raw Material', 0.42],
  ['Pelapis', 0.025],
  ['Packing', 0.005],
  ['Pendukung lainnya', 0.015],
  ['Transportasi', 0.01],
  ['Man power', 0.077],
  ['Sewa', 0.03],
  ['Listrik, wifi, apd', 0.03],
  ['Perijinan', 0.015],
  ['Administrasi', 0.02],
  ['Bunga Bank', 0.013],
  ['Depresiasi', 0.03],
  ['Promosi', 0.08],
  ['RnD', 0.03],
  ['Diskon Distributor (termasuk PPH)', 0.2],
];

// Profil perusahaan: semua dokumen struktur harga milik PNM -> statis.
export const PROFIL = {
  nama: 'PT PIONIR NUSANTARA MANUFACTURING',
  skala: 'Kecil',
  karyawan: '22 orang',
};

export const GUDANG = 'PRINCIPAL';

// Jawaban Ya/Tidak bawaan (sama di hampir semua template; PICMA X-Ray beda
// -> bisa diubah per dokumen di UI).
export const DEFAULT_ISIAN = {
  edukasi: 'Ya',
  pelatihan: 'Tidak',
  instalasi: 'Tidak',
  garansi: 'Ya',
  purnaJual: 'Ya',
  estimasi: '5 pcs',
  catatan: '',
};

// Merek bawaan: kode RB -> ROBUST, AD -> ADLER, selain itu kata pertama
// nama produk (mis. "SKYLAR BioSafety ..."). Selalu bisa diedit di UI.
export function merekBawaan(kode, nama) {
  const k = String(kode || '').toUpperCase();
  const n = String(nama || '').trim();
  if (/^RB/.test(k) || /\bROBUST\b/i.test(n)) return 'ROBUST';
  if (/^AD/.test(k)) return 'ADLER';
  return (n.split(/\s+/)[0] || '').toUpperCase();
}

// Hitung seluruh angka dokumen dari harga EKATALOG (rupiah, sudah termasuk PPN).
export function hitungStruktur(hargaEkat) {
  const ekat = Number(hargaEkat);
  if (!Number.isFinite(ekat) || ekat <= 0) return null;
  const pengajuan = ekat / FAKTOR_PPN;
  const baris = RINCIAN.map(([label, pct]) => ({ label, pct, nilai: pengajuan * pct }));
  const total = baris.reduce((s, b) => s + b.nilai, 0);
  const totalPct = RINCIAN.reduce((s, r) => s + r[1], 0);
  const plusPpn = total * FAKTOR_PPN;
  return { ekat, pengajuan, baris, total, totalPct, plusPpn, pembulatan: Math.round(plusPpn) };
}

// ---- format angka (meniru tampilan sheet: Rp di kiri, 1,234.56 di kanan) ----
export function fmtAngka(n, desimal = 2) {
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: desimal, maximumFractionDigits: desimal });
}
export function fmtPct(p) {
  return (p * 100).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
}
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// '2030-10-14' / Date -> '14-Oct-2030' (format di sheet). Gagal parse -> string asli.
export function fmtTanggal(v) {
  if (!v) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
  if (m) return `${parseInt(m[3], 10)}-${BULAN[parseInt(m[2], 10) - 1]}-${m[1]}`;
  return String(v);
}

// Baris RPC -> item siap pakai UI/PDF. Semua field teks bisa diedit user.
export function buatItem(row, kodeInput, id) {
  const found = !!row;
  const kode = found ? row.kode_produk : kodeInput;
  return {
    id,
    kode,
    found,
    tipe: found ? String(row.tipe || '').toUpperCase() : '',
    nama: found ? String(row.nama_tayang || '') : '',
    merek: merekBawaan(kode, found ? row.nama_tayang : ''),
    nie: found ? String(row.no_akd || '').trim() : '',
    nieExp: found ? fmtTanggal(row.masa_berlaku) : '',
    hargaEkat: found && row.harga_ekatalog != null ? Number(row.harga_ekatalog) : null,
    tahunHarga: found ? row.tahun_harga : null,
    profil: { ...PROFIL },
    isian: { ...DEFAULT_ISIAN },
  };
}

// Validasi sebelum cetak: daftar peringatan (bukan error -- dokumen tetap bisa dibuat).
export function periksaItem(it) {
  const w = [];
  if (!it.found) w.push('kode tidak ada di database');
  if (!it.nama) w.push('nama tayang kosong');
  if (!(it.hargaEkat > 0)) w.push('harga EKATALOG kosong');
  if (!it.nie) w.push('belum ada AKD');
  if (it.nie && !it.nieExp) w.push('tanggal kadaluarsa AKD kosong');
  if (!it.merek) w.push('merek kosong');
  return w;
}
