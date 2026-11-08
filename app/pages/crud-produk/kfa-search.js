// crud-produk/kfa-search.js
// Pencarian untuk kotak "Tambah produk ke KFA". Sengaja TANPA ketergantungan DOM supaya
// bisa diuji dengan Supabase tiruan.
//
// Jalur utama: RPC search_produk_kfa_tambah (pembungkus search_produk_dengan_harga milik
// Konversi). Produk yang SUDAH punya record KFA dibuang DI DALAM SQL, sebelum LIMIT.
// Cara lama mengambil 15 hasil lalu membuang di browser: kalau 15 teratas semuanya sudah
// punya KFA, user melihat "Semua hasil sudah punya record KFA" padahal hasil ke-16 dst.
// masih bisa ditambahkan.
//
// Cadangan: kalau RPC belum terpasang di database (migrasi 20261108_search_bersama.sql
// belum dijalankan), jatuh ke pencarian substring lama -- tapi dengan jaring lebih lebar
// (ambil lebih banyak kandidat, buang yang sudah ber-KFA, baru potong).
import { orIlike } from '../../../shared/api.js';

// PGRST202 = fungsi tidak ada di schema cache PostgREST; 42883 = undefined_function.
const RPC_TIDAK_ADA = new Set(['PGRST202', '42883']);

export function rpcBelumTerpasang(err) {
  if (!err) return false;
  if (RPC_TIDAK_ADA.has(err.code)) return true;
  return /could not find the function|function .* does not exist/i.test(err.message || '');
}

const SELESAI_ABORT = { rows: [], error: null, aborted: true };

// Mengembalikan { rows, error, aborted, via }.
//   rows    : [{ id, kode_produk, nama_produk, tipe }, ...]  (maksimal `limit`)
//   error   : objek error Supabase/PostgREST atau null (TIDAK pernah throw)
//   aborted : true kalau dibatalkan lewat `signal` -- pemanggil harus diam saja
//   via     : 'rpc' | 'cadangan'
export async function cariProdukBelumKfa(sb, q, { limit = 15, signal } = {}) {
  const dibatalkan = () => !!(signal && signal.aborted);
  const pakaiSignal = (b) => (signal ? b.abortSignal(signal) : b);

  let res;
  try {
    res = await pakaiSignal(sb.rpc('search_produk_kfa_tambah', { q, p_limit: limit }));
  } catch (e) {
    res = { data: null, error: e };
  }
  if (dibatalkan()) return { ...SELESAI_ABORT, via: 'rpc' };
  if (!res.error) return { rows: res.data || [], error: null, aborted: false, via: 'rpc' };
  if (!rpcBelumTerpasang(res.error)) return { rows: [], error: res.error, aborted: false, via: 'rpc' };

  // ---- cadangan: RPC belum terpasang ----
  try {
    const kandidat = Math.max(limit * 4, 50);
    const m = await pakaiSignal(
      sb.from('produk').select('id, kode_produk, nama_produk, tipe')
        .or(orIlike(['kode_produk', 'nama_produk'], q)).limit(kandidat)
    );
    if (dibatalkan()) return { ...SELESAI_ABORT, via: 'cadangan' };
    if (m.error) return { rows: [], error: m.error, aborted: false, via: 'cadangan' };
    const matched = m.data || [];
    if (!matched.length) return { rows: [], error: null, aborted: false, via: 'cadangan' };

    const ada = await pakaiSignal(
      sb.from('produk_kfa').select('produk_id').in('produk_id', matched.map((p) => p.id))
    );
    if (dibatalkan()) return { ...SELESAI_ABORT, via: 'cadangan' };
    if (ada.error) return { rows: [], error: ada.error, aborted: false, via: 'cadangan' };
    const sudah = new Set((ada.data || []).map((r) => r.produk_id));
    return {
      rows: matched.filter((p) => !sudah.has(p.id)).slice(0, limit),
      error: null, aborted: false, via: 'cadangan',
    };
  } catch (e) {
    if (dibatalkan()) return { ...SELESAI_ABORT, via: 'cadangan' };
    return { rows: [], error: e, aborted: false, via: 'cadangan' };
  }
}