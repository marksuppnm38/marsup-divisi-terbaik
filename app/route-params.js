// Segmen ketiga URL ("param") yang SAH, dan cuma untuk kombinasi modul/sub yang terdaftar di bawah.
// Contoh: /crud-produk/set/3f9c1a7e-5b2d-4c8a-9e61-0a7d2b4c8f10 (detail satu set),
//         /crud-produk/produk/3f9c1a7e-5b2d-4c8a-9e61-0a7d2b4c8f10 (modal edit satu produk UNIT / INSTRUMENT).
//
// Kenapa token UUID (kolom produk.url_token), bukan produk.id atau kode produk: produk.id itu angka
// urut (/set/75192 -> /set/75193) dan kode produk juga urut (AD999-KE921-B099-U01, U02, U03...), jadi
// keduanya gampang ditebak / di-enumerasi dari address bar. UUID v4 acak 122 bit.
// CATATAN: URL yang tak bisa ditebak itu cuma lapis tambahan. Yang benar-benar menolak akses adalah
// RLS Supabase; lookup keberadaan (resolveRoute di halaman) jalan pakai sesi user, jadi baris yang
// tidak boleh dibaca user itu otomatis dianggap "tidak ada" -- sama persis dengan baris yang memang tidak ada.
//
// File ini sengaja kecil dan tanpa DOM / jaringan supaya bisa dites langsung dengan node --test.

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 'modul/sub' -> aturan bentuk param. Menambah detail-URL baru cukup menambah satu baris di sini
// (+ hook resolveRoute di modulnya).
const PARAM_RULES = {
  'crud-produk/set': UUID_RE,
  'crud-produk/produk': UUID_RE,
};

/**
 * Pisahkan sisa path setelah modul/sub.
 * Tepat satu segmen = param (belum tentu sah, lihat isValidParam). Dua segmen atau lebih = extra,
 * yang tetap dianggap tampered seperti sebelumnya.
 */
export function splitRest(rest) {
  const list = Array.isArray(rest) ? rest : [];
  return { param: list.length === 1 ? list[0] : null, extra: list.length > 1 };
}

/** Bentuk param sah untuk modul/sub ini? (Cek bentuk saja, TIDAK menyentuh database.) */
export function isValidParam(module, sub, param) {
  const rule = PARAM_RULES[module + '/' + sub];
  return !!rule && typeof param === 'string' && rule.test(param);
}
