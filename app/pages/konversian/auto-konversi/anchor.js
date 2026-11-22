// auto-konversi/anchor.js
// ══════════════════════════════════════════
// "Anchor": produk yang SUDAH DIPILIH staf untuk satu item. Sistem menawarkan seluruh variannya (SC basic / complete / pediatric, dst).
//
// Semua klasifikasi (prosedur, kualifier, tier), saringan firm (link V6 bersih, AKD ada, bukan SINGLE USE), aktif, dan brand dikerjakan
// di DB lewat RPC auto_konversi_tawarkan / auto_konversi_tawarkan_hitung. Modul ini hanya MEMANGGIL dan MEMBENTUK ULANG baris untuk tampilan:
// tidak menyaring, tidak mengurutkan ulang, tidak menebak varian. Murni (tanpa DOM/Supabase): rpc disuntikkan (S.rpc di browser).
//
// Kontrak baris (urut dari DB, anchor di baris pertama):
//   kode_produk, nama_produk, tipe, anchor, ditawarkan, alasan_tolak, sinyal[], skor, tingkat, firm, brand, tier, nomor, ukuran_cm, ujung,
//   orientasi, kunci, prosedur, keluarga, spes, kategori
// Level: 1 keluarga | 2 (default) + prosedur/inti = varian sungguhan | 3 + spesialisasi & kategori = barang sejenis.
// ══════════════════════════════════════════

export const ANCHOR_LEVEL = { KELUARGA: 1, VARIAN: 2, SEJENIS: 3 };
export const ANCHOR_BATAS = 50;

export const TIER_LABEL = { basic: 'Basic', standar: 'Standar', complete: 'Complete', inst: 'Instrument', kit: 'Kit' };
// Badge "kenapa ditawarkan" — satu per isi `sinyal` dari DB. Sinyal yang tidak dikenal tampil apa adanya (jangan dibuang diam-diam).
export const SINYAL_LABEL = {
  keluarga: 'Satu keluarga',
  prosedur: 'Prosedur sama',
  inti: 'Instrumen sama',
  kualifier: 'Kualifier sama',
  spesialisasi: 'Spesialisasi sama',
  kategori: 'Kategori sama'
};
export const labelSinyal = (s) => SINYAL_LABEL[s] || String(s);

// Label singkat tier + nomor untuk daftar: "Basic S.2", "Complete", "Standar".
export function labelOpsi(o) {
  const t = TIER_LABEL[o.tier] || o.tier || '';
  return o.nomor != null ? `${t} S.${o.nomor}` : t;
}

const normBrand = (b) => String(b || 'ROBUST').trim().toUpperCase();

// Satu panggilan RPC -> { anchor, opsi }.
//   anchor : baris anchor (selalu ikut dari DB walau tidak firm; ditawarkan=false + alasan_tolak = TANDA, bukan pilihan) | null
//   opsi   : baris lain apa adanya, urutan dari DB
// Lempar Error bila RPC gagal (pemanggil yang menampilkan "Coba lagi").
// sertakanDitolak=true hanya untuk mode admin/debug: baris ditawarkan=false ikut dikembalikan dan JANGAN dijadikan pilihan.
export async function tawarkan(rpc, kode, { brand, level = ANCHOR_LEVEL.VARIAN, batas = ANCHOR_BATAS, sertakanDitolak = false } = {}) {
  const { data, error } = await rpc('auto_konversi_tawarkan', {
    p_kode: kode, p_brand: normBrand(brand), p_sertakan_ditolak: !!sertakanDitolak, p_batas: batas, p_level: level
  });
  if (error) throw new Error((error && (error.message || error.hint)) || 'auto_konversi_tawarkan gagal');
  const rows = Array.isArray(data) ? data : [];
  const anchor = rows.find((r) => r.anchor) || null;
  const opsi = rows.filter((r) => !r.anchor && (sertakanDitolak || r.ditawarkan !== false));
  return { anchor, opsi };
}

// Jumlah varian per anchor, untuk chip "+N lain" (n TIDAK termasuk anchor). Map kode -> n.
export async function hitung(rpc, kodes, { brand, level = ANCHOR_LEVEL.VARIAN } = {}) {
  const daftar = [...new Set((kodes || []).filter(Boolean))];
  if (!daftar.length) return new Map();
  const { data, error } = await rpc('auto_konversi_tawarkan_hitung', { p_kodes: daftar, p_brand: normBrand(brand), p_level: level });
  if (error) throw new Error((error && (error.message || error.hint)) || 'auto_konversi_tawarkan_hitung gagal');
  const out = new Map(daftar.map((k) => [k, 0]));
  (Array.isArray(data) ? data : []).forEach((r) => out.set(r.kode_produk, Number(r.n) || 0));
  return out;
}
