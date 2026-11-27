// crud-produk/akd-placeholder.js
// Definisi "tanpa AKD" untuk pintasan Tanpa AKD / filter AKD (Product Manager, a2-03).
//
// Definisi sheet: produk "tanpa AKD" = tidak punya NOMOR AKD ASLI. Placeholder "TIDAK ADA" (record di tabel akd, lihat ui-utils.js)
// artinya memang tidak ada AKD, jadi tidak dihitung. Kolom produk.status_akd tidak cukup: produk yang hanya tertaut ke placeholder
// bisa tetap berstatus 'terhubung' (verifikasi 2026-11-27: 212 produk dari 15.793; arah sebaliknya 0).
//
// Maka: tanpa AKD asli = status_akd BUKAN 'terhubung' ATAU id-nya ada di himpunan "hanya placeholder" (dimuat di sini).
// Himpunan itu kecil (ratusan id): produk yang tertaut ke placeholder, dikurangi yang ternyata punya AKD asli.
// Murni: tanpa DOM, Supabase disuntik. Tidak pernah throw (mengembalikan { error }).
import { isAkdPlaceholder } from './ui-utils.js';

const PAGE = 1000;   // batas baris PostgREST per request
const CHUNK = 300;   // sama dengan fetchAkdNoMap di index.js: aman untuk panjang URL

/** Dari baris relasi { produk_id, akd: { no_akd } } milik kandidat -> id yang TIDAK punya AKD asli (hanya placeholder). */
export function hanyaPlaceholder(kandidatIds, linkRows) {
  const punyaAsli = new Set();
  (linkRows || []).forEach((l) => {
    const no = l && l.akd && l.akd.no_akd;
    if (no && !isAkdPlaceholder(no)) punyaAsli.add(l.produk_id);
  });
  return new Set([...kandidatIds].filter((id) => !punyaAsli.has(id)));
}

/** Apakah baris produk "tanpa AKD asli"? `hanyaPh` = Set id hasil muatHanyaPlaceholder(). */
export function tanpaAkdAsli(row, hanyaPh) {
  return row.status_akd !== 'terhubung' || (!!hanyaPh && hanyaPh.has(row.id));
}

/** Set id produk yang hanya tertaut placeholder TIDAK ADA. -> { ids:Set, error } */
export async function muatHanyaPlaceholder(sb) {
  try {
    // 1. id record placeholder di tabel akd (biasanya satu)
    const a = await sb.from('akd').select('id, no_akd').ilike('no_akd', '%tidak%ada%');
    if (a.error) return { ids: new Set(), error: a.error };
    const phIds = (a.data || []).filter((r) => isAkdPlaceholder(r.no_akd)).map((r) => r.id);
    if (!phIds.length) return { ids: new Set(), error: null };
    // 2. produk yang tertaut ke placeholder (kandidat)
    const kandidat = new Set();
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb.from('produk_akd').select('produk_id').in('akd_id', phIds).order('produk_id').range(from, from + PAGE - 1);
      if (error) return { ids: new Set(), error };
      (data || []).forEach((r) => kandidat.add(r.produk_id));
      if (!data || data.length < PAGE) break;
    }
    // 3. dari kandidat, siapa yang juga punya AKD asli (semua relasinya dibaca per potongan)
    const ids = [...kandidat];
    const links = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { data, error } = await sb.from('produk_akd').select('produk_id, akd:akd_id(no_akd)').in('produk_id', ids.slice(i, i + CHUNK));
      if (error) return { ids: new Set(), error };
      links.push(...(data || []));
    }
    return { ids: hanyaPlaceholder(kandidat, links), error: null };
  } catch (e) {
    return { ids: new Set(), error: e };
  }
}
