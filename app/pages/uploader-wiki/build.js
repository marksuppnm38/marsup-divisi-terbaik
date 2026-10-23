// uploader-wiki / build.js
// Logika MURNI (tanpa DOM, tanpa Supabase) yang mengubah data database jadi baris MASTER.xlsx --
// "peta" yang dibaca script Tampermonkey INAPROC Upload V6 (kolom dicocokkan lewat NAMA header).
// Dites di Node: tests/uploader-wiki.test.mjs.
//
// Sumber tiap kolom MASTER (31 kolom; urutan & ejaan header = seed.js, disalin dari MASTER.xlsx yang terbukti jalan):
//   KODE / Daftar_Produk_Sektoral .... produk.kode_produk
//   KODE_ASLI ........................ produk.kode_asli
//   Nama_Produk / Deskripsi .......... produk.nama_produk (spasi & newline dirapikan)
//   Upload_Foto_Produk ............... <kode_asli>.png   -> THUMBNAILS/ (bucket "thumbnails")
//   Spesifikasi_Produk_Filename ...... <KODE>.pdf        -> SPEK/            (dibuat modul bulk Spesifikasi)
//   Struktur_Harga_Filename .......... <KODE>.pdf        -> STRUKTUR_HARGA/  (dibuat modul bulk Struktur Harga)
//   Nomor_Izin_Edar_(NIE)_Filename ... AKD <no_akd>.pdf  -> AKD/             (TIDAK bisa dibuat web app: unduh dari Drive)
//   Harga_Produk ..................... harga EKATALOG / 1,11 (RPC get_struktur_harga_data) -- rumus yang SAMA dengan
//                                      dokumen Struktur Harga, jadi angka di form = angka di PDF.
//   KATEGORI_2/3, Kode_Kbki .......... diturunkan dari AKD (no_akd) lewat tabel pemetaan (seed.akdMap, bisa diedit di UI).
//                                      AKD yang belum dipetakan -> SKU dilewati & ditandai (tidak ditebak).
//   Jumlah_Stok ...................... aturan stok (pengaturan) + override per kode.
//   sisanya (merek, TKDN, dropdown spesifikasi, nama file dokumen statis) = pengaturan (default dari seed.constants).

import { FAKTOR_PPN } from '../spek-maker/struktur-harga.js';

// Indeks kolom MASTER (urutan header di seed.js).
export const COL = {
  kode: 0, kodeAsli: 1, kat1: 2, kat2: 3, kat3: 4, merek: 5, sektoral: 6, nama: 7, foto: 8, deskripsi: 9,
  kbki: 10, kbkiFallback: 11, tkdn: 12, harga: 20, stok: 21, satuan: 22, berat: 23,
  fSpek: 24, fNie: 25, fStruktur: 30,
};

// Pengaturan yang bisa diedit di UI. idx = kolom MASTER yang diisi konstanta itu.
export const SETTINGS_FIELDS = [
  { key: 'kat1', idx: 2, label: 'Kategori 1' },
  { key: 'merek', idx: 5, label: 'Nomor merek' },
  { key: 'kbkiFallback', idx: 11, label: 'Teks fallback KBKI' },
  { key: 'tkdn', idx: 12, label: 'Nomor sertifikat TKDN' },
  { key: 'distributor', idx: 13, label: 'Dropdown: Distributor ditunjuk' },
  { key: 'izin', idx: 14, label: 'Dropdown: Izin distribusi' },
  { key: 'cpakb', idx: 15, label: 'Dropdown: Sertifikat CPAKB' },
  { key: 'pib', idx: 16, label: 'Dropdown: PIB' },
  { key: 'garansi', idx: 17, label: 'Dropdown: Garansi' },
  { key: 'sparepart', idx: 18, label: 'Dropdown: Purna jual & spare part' },
  { key: 'strukturHarga', idx: 19, label: 'Dropdown: Struktur harga' },
  { key: 'satuan', idx: 22, label: 'Satuan produk' },
  { key: 'berat', idx: 23, label: 'Berat default (gram)' },
  { key: 'fDistributor', idx: 26, label: 'File statis: Distributor (STATIC_DOC)' },
  { key: 'fCpakb', idx: 27, label: 'File statis: CPAKB (STATIC_DOC)' },
  { key: 'fGaransi', idx: 28, label: 'File statis: Garansi (STATIC_DOC)' },
  { key: 'fSparepart', idx: 29, label: 'File statis: Spare part (STATIC_DOC)' },
];

export const STOK_DEFAULTS = {
  stokDefault: 500,
  stokBesar: 3000,
  stokBesarRegex: 'STERILIZATION|\\bCONTAINERS?\\b',   // nama produk (tanpa beda huruf besar/kecil)
  stokBesarPrefix: 'RBA-',                              // atau kode berawalan ini
  stokOverride: '',                                     // "KODE=jumlah" per baris; mengalahkan aturan di atas
};

export function defaultSettings(seed) {
  const s = Object.assign({}, STOK_DEFAULTS);
  SETTINGS_FIELDS.forEach((f) => { s[f.key] = seed.constants[f.idx] !== undefined ? seed.constants[f.idx] : ''; });
  return s;
}

// Sama persis dengan fileSafeName() di spek-maker/pdf.js -- nama file PDF di paket = nama yang tertulis di MASTER.
export function safeFileName(kode, ext = 'pdf') {
  const base = String(kode || '').normalize('NFKC').replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '') || 'spesifikasi';
  return `${base}.${ext}`;
}

export const collapse = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

// "AKD 11103420271.pdf" / "11103420271" / "AKD11103420271" -> "11103420271"; tidak ada -> ''.
export function akdDigits(noAkd) {
  const m = String(noAkd == null ? '' : noAkd).match(/\d{8,}/);
  return m ? m[0] : '';
}
export const nieFileName = (noAkd) => { const d = akdDigits(noAkd); return d ? `AKD ${d}.pdf` : ''; };

// Level 3 mengikuti pola MASTER: "<kat2> Bedah"; khusus Bedah Umum & Bedah Plastik -> "Peralatan Bedah".
export function deriveKat3(kat2) {
  return /^peralatan bedah umum dan bedah plastik$/i.test(collapse(kat2)) ? 'Peralatan Bedah' : `${collapse(kat2)} Bedah`;
}

export function parseOverrides(text) {
  const out = new Map();
  String(text || '').split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*([^=\s]+)\s*=\s*(\d+)\s*$/);
    if (m) out.set(m[1].toUpperCase(), Number(m[2]));
  });
  return out;
}

export function stokFor(kode, nama, st) {
  const ov = parseOverrides(st.stokOverride).get(String(kode).toUpperCase());
  if (ov !== undefined) return ov;
  let re = null;
  try { re = st.stokBesarRegex ? new RegExp(st.stokBesarRegex, 'i') : null; } catch (e) { re = null; }
  const besar = (re && re.test(nama)) || (st.stokBesarPrefix && String(kode).startsWith(st.stokBesarPrefix));
  return Number(besar ? st.stokBesar : st.stokDefault);
}

// Harga sebelum pajak = harga EKATALOG / FAKTOR_PPN (sama dengan "Pengajuan Harga Tayang (DPP)" di dokumen Struktur Harga).
export function hargaUpload(hargaEkat) {
  const e = Number(hargaEkat);
  return e > 0 ? Math.round((e / FAKTOR_PPN) * 100) / 100 : null;
}

// p = baris tabel produk; rpc = baris get_struktur_harga_data (atau null); ctx = {seed, settings, akdMap}.
// Return {row|null, skip[], flags[], akd}.
export function buildRow(p, rpc, ctx) {
  const { seed, settings, akdMap } = ctx;
  const kode = collapse(p.kode_produk);
  const kodeAsli = collapse(p.kode_asli);
  const nama = collapse(p.nama_produk);
  const skip = [];
  const flags = [];

  if (!kode) skip.push('kode_produk kosong');
  if (!kodeAsli) skip.push('kode_asli kosong (nama file thumbnail tidak bisa dibentuk)');
  if (!nama) skip.push('nama_produk kosong');
  if (!rpc) skip.push('tidak ada di RPC get_struktur_harga_data');

  const harga = rpc ? hargaUpload(rpc.harga_ekatalog) : null;
  if (rpc && harga == null) skip.push('harga EKATALOG kosong');

  const digits = rpc ? akdDigits(rpc.no_akd) : '';
  if (rpc && !digits) skip.push('no_akd kosong / tidak ada angka (file NIE tidak bisa dibentuk)');
  const map = digits ? akdMap[digits] : null;
  if (digits && !map) skip.push(`AKD ${digits} belum dipetakan ke kategori & KBKI`);
  if (map && (!collapse(map.kat2) || !collapse(map.kbki))) skip.push(`pemetaan AKD ${digits} belum lengkap (kategori 2 / KBKI kosong)`);

  if (skip.length) return { row: null, skip, flags, akd: digits };

  const row = seed.headers.map(() => '');
  SETTINGS_FIELDS.forEach((f) => { row[f.idx] = settings[f.key] != null ? settings[f.key] : ''; });
  row[COL.kode] = kode;
  row[COL.kodeAsli] = kodeAsli;
  row[COL.kat2] = collapse(map.kat2);
  row[COL.kat3] = collapse(map.kat3) || deriveKat3(map.kat2);
  row[COL.sektoral] = kode;
  row[COL.nama] = nama;
  row[COL.foto] = `${kodeAsli}.png`;
  row[COL.deskripsi] = nama;
  row[COL.kbki] = collapse(map.kbki);
  row[COL.harga] = harga;
  row[COL.stok] = stokFor(kode, nama, settings);
  const berat = Number(p.berat_gram);
  row[COL.berat] = berat > 0 ? berat : (Number(settings.berat) || 275);
  row[COL.fSpek] = safeFileName(kode);
  row[COL.fNie] = `AKD ${digits}.pdf`;
  row[COL.fStruktur] = safeFileName(kode);
  if (!(berat > 0)) flags.push('berat_gram kosong -> pakai berat default');
  return { row, skip, flags, akd: digits };
}

// Bagi n baris jadi `parts` potongan berurutan, selisih ukuran maksimal 1.
export function splitBatches(rows, parts) {
  const n = Math.max(1, Math.min(parts | 0 || 1, rows.length || 1));
  const base = Math.floor(rows.length / n);
  const extra = rows.length % n;
  const out = [];
  let at = 0;
  for (let i = 0; i < n; i += 1) {
    const size = base + (i < extra ? 1 : 0);
    out.push(rows.slice(at, at + size));
    at += size;
  }
  return out;
}

// Sheet MASTER: header seed + OPERATOR + BATCH_ID (script Tampermonkey mengabaikan kolom yang tidak dikenal).
export function toAoa(seed, rows, { operator = '', batchId = '' } = {}) {
  return [seed.headers.concat(['OPERATOR', 'BATCH_ID'])].concat(rows.map((r) => r.concat([operator, batchId])));
}

// Daftar file AKD (unik, terurut) yang dibutuhkan sekumpulan baris MASTER.
export function akdNeeded(rows) {
  return Array.from(new Set(rows.map((r) => r[COL.fNie]).filter(Boolean))).sort();
}

export function staticFilesNeeded(settings) {
  return [settings.fDistributor, settings.fCpakb, settings.fGaransi, settings.fSparepart].filter(Boolean);
}

export const DRIVE_URL = 'https://drive.google.com/drive/folders/1mu7yn3mxKTFOOfRr6jftUC00CUayZU5-?usp=drive_link';

// Teks petunjuk yang ikut masuk ke tiap paket operator.
export function readmeText({ operator, batchId, count, staticFiles, hasScript }) {
  return [
    `PAKET UPLOAD INAPROC - operator ${operator} - batch ${batchId}`,
    `Jumlah SKU: ${count}`,
    '',
    'ISI PAKET INI (dibuat otomatis oleh web app):',
    '  MASTER.xlsx         peta data untuk script Tampermonkey',
    '  SPEK/               PDF Spesifikasi, satu per SKU',
    '  STRUKTUR_HARGA/     PDF Struktur Harga, satu per SKU',
    '  THUMBNAILS/         foto produk (PNG), satu per SKU',
    '  AKD_DIBUTUHKAN.txt  daftar file AKD yang harus kamu ambil dari Drive',
    hasScript
      ? '  inaproc-upload-v6.user.js   script Tampermonkey (Tampermonkey > Create a new script > tempel isinya)'
      : '  (script Tampermonkey tidak ikut paket: minta file inaproc-upload-v6.user.js dari admin)',
    '',
    'YANG BELUM ADA DAN HARUS KAMU UNDUH SENDIRI (web app tidak bisa membuatnya):',
    `  Folder Drive: ${DRIVE_URL}`,
    '  - AKD/         dokumen izin edar per nomor AKD (lihat AKD_DIBUTUHKAN.txt)',
    '  - STATIC_DOC/  dokumen yang sama untuk semua SKU:',
    ...staticFiles.map((f) => `        ${f}`),
    '',
    'LANGKAH SETUP:',
    '  1. Ekstrak paket ini.',
    '  2. Unduh folder Drive di atas, lalu salin AKD/ dan STATIC_DOC/ ke folder hasil ekstrak, sehingga satu folder berisi 5 subfolder:',
    '       AKD, SPEK, STATIC_DOC, STRUKTUR_HARGA, THUMBNAILS',
    '     (isi AKD/ boleh lebih banyak dari yang dibutuhkan; yang penting file di AKD_DIBUTUHKAN.txt ada)',
    '  3. Buka penyedia.inaproc.id (login) dan pasang script Tampermonkey.',
    '  4. Di panel script: Load MASTER -> pilih MASTER.xlsx; Pilih Folder Dokumen -> pilih folder induk tadi; klik Cek Berkas.',
    '  5. Biarkan Dry run aktif untuk percobaan 1 SKU; kalau sudah benar, matikan Dry run lalu klik Start.',
    '  6. Selesai: klik Export Hasil dan kirim file hasilnya ke admin.',
    '',
  ].join('\r\n');
}