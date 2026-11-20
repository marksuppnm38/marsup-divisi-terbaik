// auto-konversi/firm.js
// ══════════════════════════════════════════
// Kesiapan jual per produk: dipisah dari "cocok" (resolver.js). Hasilnya TIGA tingkat:
//   OK        : boleh dijual & dipasang otomatis (tidak muncul di Map hasil).
//   BISA DIPERBAIKI (`kurang` terisi): produk tetap jadi kandidat/usulan, tapi TIDAK boleh AUTO.
//                  - AKD belum ada   : tidak ada baris produk_akd, atau cuma placeholder "TIDAK ADA".
//                                      Wajib untuk SEMUA tipe (SET/INSTRUMENT/UNIT): semua yang dijual harus punya izin edar.
//                  - link V6 belum dibuat / bukan URL
//                  - belum firm      : link_v6 ada URL + catatan tim (aturan sama dgn S.isProdukFirm di index.js)
//   KERAS (`keras` terisi): tidak bisa diperbaiki → tetap dibuang dari kandidat.
//                  - SINGLE USE      : perusahaan tidak menjual produk sekali pakai. Ditangkap juga kalau cell-nya cuma
//                                      "SINGLE USE" tanpa URL (state 'invalid' di parseLinkV6).
//                  - tidak ada di katalog : kode dari riwayat Dictionary yang produknya sudah dihapus.
// Kenapa dipisah: dulu "belum siap" ikut membuang kandidat, jadi produk yang BENAR tapi belum didaftarkan
// hilang diam-diam dan item tampil "tidak ketemu" / diganti produk lain. Sekarang cuma syarat AUTO.
// Murni (tanpa DOM/Supabase): parseLinkV6 & fetchRows disuntikkan dari permintaan-rs.js / test.
// ══════════════════════════════════════════

// Placeholder "TIDAK ADA" di tabel akd = memang tidak punya AKD (sama dgn isAkdPlaceholder di crud-produk/ui-utils.js;
// disalin karena modul ini tidak boleh mengimpor kode UI).
const isPlaceholderAkd = (no) => /^\s*tidak\s+ada\s*$/i.test(String(no == null ? '' : no));

// row: { link_v6, akd }. akd = array nomor AKD; undefined = tidak dicek (fetchRows lupa mengisi) → TIDAK dianggap aman.
// Return { keras: string|null, kurang: string[] }.
export function assessProduk(row, parseLinkV6) {
  const raw = String(row && row.link_v6 != null ? row.link_v6 : '');
  if (/single[\s_-]*use/i.test(raw)) return { keras: 'SINGLE USE', kurang: [] };
  const kurang = [];
  const state = parseLinkV6(raw).state;
  if (state === 'catatan') kurang.push('belum firm (link V6 ada catatan)');
  else if (state === 'kosong') kurang.push('link V6 belum dibuat');
  else if (state === 'invalid') kurang.push('link V6 bukan URL');
  const akd = row && row.akd;
  if (!Array.isArray(akd)) kurang.push('AKD belum bisa dicek'); // gagal tertutup: jangan AUTO kalau datanya tidak ada
  else if (!akd.some(no => String(no == null ? '' : no).trim() && !isPlaceholderAkd(no))) kurang.push('AKD belum ada');
  return { keras: null, kurang };
}

// Hasilnya fungsi async (kodes) -> Map(kode -> { keras, kurang }) berisi HANYA kode yang TIDAK OK
// (keras ATAU ada kurang). Satu request per 80 kode; hasil di-cache. Kalau fetchRows melempar error, error
// diteruskan (resolver menandainya "belum terverifikasi") dan cache tidak teracuni.
export function makeFirmCheck({ fetchRows, parseLinkV6, chunk = 80 }) {
  const cache = new Map(); // kode -> { keras, kurang } (kurang kosong & keras null = OK)
  const check = async (kodes) => {
    const all = (kodes || []).filter(Boolean);
    const need = [...new Set(all)].filter(k => !cache.has(k));
    for (let i = 0; i < need.length; i += chunk) {
      const part = need.slice(i, i + chunk);
      const rows = await fetchRows(part);
      const seen = new Set();
      (rows || []).forEach(r => { seen.add(r.kode_produk); cache.set(r.kode_produk, assessProduk(r, parseLinkV6)); });
      part.forEach(k => { if (!seen.has(k)) cache.set(k, { keras: 'tidak ada di katalog', kurang: [] }); });
    }
    const out = new Map();
    all.forEach(k => { const r = cache.get(k); if (r && (r.keras || r.kurang.length)) out.set(k, r); });
    return out;
  };
  check.clear = () => cache.clear();
  return check;
}