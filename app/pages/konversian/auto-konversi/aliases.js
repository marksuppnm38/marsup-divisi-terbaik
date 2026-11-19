// auto-konversi/aliases.js
// ══════════════════════════════════════════
// DATA, bukan logika — sengaja dipisah supaya gampang diedit tanpa nyentuh parser.
// Semua isi di sini SEED AWAL. Sesuaikan dengan penamaan asli di tabel produk kamu
// (cek hasilnya lewat query di README/auto-konversi-queries.sql).
// ══════════════════════════════════════════

// Salah ketik / kata nempel yang umum di permintaan RS & PDF kompetitor.
// Dipakai buat BIKIN VARIAN pencarian (teks asli tetap dicoba duluan, karena riwayat
// Dictionary menyimpan ejaan customer apa adanya — "NEEDELHOLDER" bisa saja sudah ada di riwayat).
export const TYPO_FIXES = [
  [/\bNEEDEL\s*HOLDER\b/g, 'NEEDLE HOLDER'],
  [/\bNEEDLEHOLDER\b/g, 'NEEDLE HOLDER'],
  [/\bNEDLE\s*HOLDER\b/g, 'NEEDLE HOLDER'],
  [/\bGIFS\b/g, 'GIPS'],
  [/\bGYPS\b/g, 'GIPS'],
  [/\bHANDEL\b/g, 'HANDLE'],            // "SCALPEL HANDEL" di katalog Falcon
  [/ARTERYFORCEPS/g, 'ARTERY FORCEPS'], // kata nempel hasil ekstraksi PDF
  [/USATISSUE/g, 'USA TISSUE'],
  [/SPATULAFLEXIBLE/g, 'SPATULA FLEXIBLE'],
  [/\bFORCEP\b/g, 'FORCEPS']
];

// Kata generik instrumen (bukan nama orang / eponim). Dipakai buat memisahkan
// "KELLY" (eponim) dari "ARTERY FORCEPS" (jenis) pada deskripsi kompetitor.
export const GENERIC_WORDS = new Set([
  'OPERATING', 'DISSECTING', 'TISSUE', 'ARTERY', 'FORCEPS', 'SCISSORS', 'RETRACTOR',
  'NEEDLE', 'HOLDER', 'TOWEL', 'CLAMP', 'SPONGE', 'HOLDING', 'SUCTION', 'TUBE',
  'SCALPEL', 'HANDLE', 'SPATULA', 'ABDOMINAL', 'FLEXIBLE', 'WIDTH', 'SET', 'STORING',
  'CASE', 'MOD', 'INT', 'NARROW', 'STANDARD', 'USA'
]);

// Terjemahan jenis EN -> ID untuk varian query ke katalog kita. Urutan penting:
// frasa panjang dulu. SEED — verifikasi dengan nama_produk sebenarnya.
export const GLOSSARY_EN_ID = [
  [/\bARTERY FORCEPS\b/g, 'KLEM ARTERI'],
  [/\bNEEDLE HOLDER\b/g, 'NEEDLE HOLDER'],
  [/\bSCISSORS\b/g, 'GUNTING'],
  [/\bFORCEPS\b/g, 'PINSET'],
  [/\bRETRACTOR\b/g, 'RETRACTOR']
];

// Baris yang jelas BUKAN nama produk. EXACT MATCH setelah dirapikan.
// (Salinan dari PR_NOISE_WORDS di permintaan-rs.js — kalau modul ini dipakai beneran,
// sebaiknya kedua tempat import dari satu sumber.)
export const NOISE_WORDS = new Set([
  'NO', 'NO.', 'NAMA', 'NAMA BARANG', 'NAMA ITEM', 'ITEM', 'BARANG',
  'QTY', 'QUANTITY', 'JUMLAH', 'JML', 'HARGA', 'SATUAN', 'KETERANGAN',
  'TOTAL', 'TANGGAL', 'TGL', 'PERIHAL', 'SUBJEK', 'LAMPIRAN', 'NO ITEM',
  'DESCRIPTION', 'DESKRIPSI', 'FALCON',
  'ASSALAMUALAIKUM', 'ASSALAMUALAIKUM WR WB', 'WAALAIKUMSALAM',
  'TERIMA KASIH', 'MAKASIH', 'THANKS', 'THANK YOU',
  'SIAP', 'NOTED', 'OK', 'OKE', 'OKAY', 'BAIK', 'IYA', 'YA',
  'MOHON DICEK', 'MOHON DIBANTU', 'MOHON BANTUANNYA',
  'SELAMAT PAGI', 'SELAMAT SIANG', 'SELAMAT SORE', 'SELAMAT MALAM'
]);
