// auto-konversi/firm.js
// ══════════════════════════════════════════
// Filter usulan: produk yang TIDAK BOLEH dipakai konversi dibuang dari kandidat SEBELUM dinilai.
//   - belum firm : link_v6 ada URL + catatan tim (aturan sama dgn S.isProdukFirm di index.js)
//   - SINGLE USE : perusahaan tidak menjual produk sekali pakai. Ditangkap juga kalau cell-nya cuma
//                  "SINGLE USE" tanpa URL — state itu 'invalid' di parseLinkV6, jadi isProdukFirm biasa
//                  menganggapnya firm.
//   - tidak ada di katalog : kode dari riwayat Dictionary yang produknya sudah dihapus.
// Murni (tanpa DOM/Supabase): parseLinkV6 & fetchRows disuntikkan dari permintaan-rs.js / test.
// ══════════════════════════════════════════

export function notUsableReason(linkV6, parseLinkV6) {
  const raw = String(linkV6 == null ? '' : linkV6);
  if (/single[\s_-]*use/i.test(raw)) return 'SINGLE USE';
  if (parseLinkV6(raw).state === 'catatan') return 'belum firm (link V6 ada catatan)';
  return null;
}

// Hasilnya fungsi async (kodes) -> Map(kode -> alasan) berisi HANYA kode yang diblokir.
// Satu request per 80 kode; hasil di-cache. Kalau fetchRows melempar error, error diteruskan
// (resolver menandainya "belum terverifikasi") dan cache tidak teracuni.
export function makeFirmCheck({ fetchRows, parseLinkV6, chunk = 80 }) {
  const cache = new Map(); // kode -> alasan | null (null = boleh dipakai)
  const check = async (kodes) => {
    const all = (kodes || []).filter(Boolean);
    const need = [...new Set(all)].filter(k => !cache.has(k));
    for (let i = 0; i < need.length; i += chunk) {
      const part = need.slice(i, i + chunk);
      const rows = await fetchRows(part);
      const seen = new Set();
      (rows || []).forEach(r => { seen.add(r.kode_produk); cache.set(r.kode_produk, notUsableReason(r.link_v6, parseLinkV6)); });
      part.forEach(k => { if (!seen.has(k)) cache.set(k, 'tidak ada di katalog'); });
    }
    const blocked = new Map();
    all.forEach(k => { const r = cache.get(k); if (r) blocked.set(k, r); });
    return blocked;
  };
  check.clear = () => cache.clear();
  return check;
}