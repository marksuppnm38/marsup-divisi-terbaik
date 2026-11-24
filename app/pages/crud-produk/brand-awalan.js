// Brand <-> awalan kode produk. Logika murni (tanpa DOM / database) supaya bisa dites.
// Hanya awalan yang POLANYA SUDAH PASTI yang dipetakan (data: RB -> ROBUST, AD -> ADLER, tidak ada yang bertentangan; PX -> PICMA atas keputusan pemilik).
// Awalan lain (SK, BA, BS, ...) sengaja belum dipetakan: itu keputusan bisnis + backfill terpisah.
export const BRAND_AWALAN = Object.freeze({ AD: 'ADLER', RB: 'ROBUST', PX: 'PICMA' });

/** Brand yang diturunkan dari awalan kode, atau null kalau awalannya belum dipetakan. */
export function brandDariKode(kode){
  const awalan = String(kode ?? '').trim().slice(0, 2).toUpperCase();
  return BRAND_AWALAN[awalan] || null;
}

const norm = (b) => String(b ?? '').trim().replace(/\s+/g, ' ').toUpperCase();

/**
 * Peringatan non-blokir di bawah field Brand.
 * Mengembalikan { pesan, saran } atau null (tidak ada yang perlu dikatakan).
 * - awalan belum dipetakan -> null (tidak ada dasar untuk menegur)
 * - brand kosong / beda dari yang diharapkan awalan -> saran = brand yang diharapkan
 */
export function peringatanBrand(kode, brand){
  const harapan = brandDariKode(kode);
  if (!harapan) return null;
  const sekarang = norm(brand);
  if (sekarang === harapan) return null;
  const awalan = String(kode).trim().slice(0, 2).toUpperCase();
  return {
    saran: harapan,
    pesan: sekarang
      ? `Kode berawalan ${awalan} biasanya ${harapan}, bukan ${sekarang}.`
      : `Kode berawalan ${awalan} biasanya ${harapan}. Brand masih kosong.`,
  };
}

/** Opsi untuk select brand: brand yang ada di data (unik, UPPERCASE, urut) + nilai yang sedang dipakai kalau belum ada di data. */
export function opsiBrand(daftar, nilaiSekarang){
  const set = new Set((daftar || []).map(norm).filter(Boolean));
  const cur = norm(nilaiSekarang);
  if (cur) set.add(cur);
  return [...set].sort();
}
