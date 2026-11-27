// crud-produk/daftar-langsung.js
// Jalur "langsung ke tabel produk" untuk daftar Produk yang diurutkan dan / atau memakai filter Sudah / Belum diisi.
//
// Kenapa ada: RPC get_produk_list (tidak ada di repo ini) tidak punya parameter urutan, dan menganggap nilai filter
// teks sebagai teks biasa. Jadi kombinasi urutan + filter tidak bisa dititipkan ke sana. Pola sama dengan jalur
// filter klasifikasi (klasifikasi.js fetchRowsByKlas): baca langsung dari tabel `produk`.
//
// Dua bentuk, tergantung filter yang aktif:
//   - semua filter bisa dikerjakan server (tipe, golongan, brand, aktif, status INAPROC, link V6) ->
//     satu halaman per request: .order().range() + hitungan total dari server. Ringan.
//   - ada filter yang hanya bisa di client (Harga, Stok) -> baris yang sudah dipersempit server dibaca per 1.000 baris
//     (urutan id yang stabil), disaring dan diurutkan di client. Sama polanya dengan jalur klasifikasi.
//
// Sengaja tanpa ketergantungan DOM; tidak pernah throw (mengembalikan { error }). Diuji dengan Supabase tiruan.
import { NILAI_ISI, NILAI_KOSONG, KOLOM_URUT, adalahKolomUrut, urutkan } from './urut-header.js';

const PAGE = 1000; // batas baris PostgREST per request

// Dimensi yang bisa dipersempit di server -> kolom di tabel produk.
export const DIM_SERVER = {
  tipe: 'tipe', golongan: 'golongan', brand: 'brand', is_active: 'is_active', status_inaproc: 'status_inaproc', link_v6: 'link_v6', akd: 'status_akd',
  // Product Manager (2026-11): Status (= status_akd: belum_firm / di_luar_cakupan / belum_diajukan) dan Terakhir diubah (updated_at >= batas).
  status: 'status_akd', terakhir: 'updated_at',
};

// Filter "Terakhir diubah": nilai -> jumlah jam ke belakang. Satu sumber untuk server (batas ISO) dan client (pencocok baris).
export const JAM_TERAKHIR = { '24j': 24, '7h': 7 * 24, '30h': 30 * 24 };
/** Batas waktu (ISO) untuk nilai filter "Terakhir diubah"; null kalau nilainya tidak dikenal. `now` bisa diinjeksi untuk tes. */
export function batasTerakhir(value, now = Date.now()) {
  const jam = JAM_TERAKHIR[value];
  return jam ? new Date(now - jam * 3600 * 1000).toISOString() : null;
}
/** Apakah baris (updated_at) lolos filter "Terakhir diubah". Nilai tak dikenal = tidak ada yang lolos (bukan semua). */
export function cocokTerakhir(row, value, now = Date.now()) {
  const batas = batasTerakhir(value, now);
  const t = row && row.updated_at ? new Date(row.updated_at).getTime() : NaN;
  return !!batas && Number.isFinite(t) && t >= new Date(batas).getTime();
}

const nilaiFilter = (f) => f.values || (f.value != null && f.value !== '' ? [f.value] : []);

/** { server, klien }: filter yang dikerjakan query vs yang harus disaring di client. */
export function bagiFilter(filters) {
  const server = [], klien = [];
  (filters || []).forEach((f) => (f.dim in DIM_SERVER ? server : klien).push(f));
  return { server, klien };
}

// "Kosong" = NULL atau teks kosong; "terisi" = kebalikannya. (Spasi saja dianggap terisi di server; di client di-trim.)
const kosongServer = (q, col) => q.or(`${col}.is.null,${col}.eq.`);
const isiServer = (q, col) => q.not(col, 'is', null).neq(col, '');

export function pasangFilterServer(q, serverFilters) {
  let out = q;
  serverFilters.forEach((f) => {
    const col = DIM_SERVER[f.dim];
    if (f.dim === 'tipe') { const v = nilaiFilter(f); if (v.length) out = out.in('tipe', v); return; }
    if (f.dim === 'is_active') { out = out.eq('is_active', f.value === 'aktif'); return; }
    // AKD: "ada" = status_akd 'terhubung'; "kosong" = selain itu (termasuk NULL)
    if (f.dim === 'akd') { out = f.value === 'ada' ? out.eq('status_akd', 'terhubung') : out.or('status_akd.is.null,status_akd.neq.terhubung'); return; }
    if (f.dim === 'link_v6') { out = f.value === 'ada' ? isiServer(out, col) : kosongServer(out, col); return; }
    if (f.dim === 'terakhir') { const b = batasTerakhir(f.value); if (b) out = out.gte('updated_at', b); return; }
    if (f.dim === 'status') { if (f.value) out = out.eq('status_akd', f.value); return; }
    // golongan / brand / status_inaproc: pasangan Sudah / Belum diisi atau nilai biasa
    if (f.value === NILAI_ISI) { out = isiServer(out, col); return; }
    if (f.value === NILAI_KOSONG) { out = kosongServer(out, col); return; }
    if (f.value != null && f.value !== '') out = out.eq(col, f.value);
  });
  return out;
}

/** Urutan di server: kolom pilihan (kosong di bawah) lalu id supaya paging stabil. Tanpa urutan: terakhir diubah dulu. */
export function pasangUrutanServer(q, sort) {
  if (sort && adalahKolomUrut(sort.key)) {
    return q.order(KOLOM_URUT[sort.key].field, { ascending: sort.dir !== 'desc', nullsFirst: false }).order('id', { ascending: true });
  }
  return q.order('updated_at', { ascending: false }).order('id', { ascending: true });
}

/** Satu halaman, dihitung & diurutkan server. -> { rows, total, error } */
export async function ambilHalamanLangsung(sb, o) {
  try {
    const from = (o.page - 1) * o.pageSize;
    let q = sb.from('produk').select(o.columns, { count: 'exact' });
    if (o.chipFn) q = o.chipFn(q);
    q = pasangFilterServer(q, o.server);
    q = pasangUrutanServer(q, o.sort);
    const { data, error, count } = await q.range(from, from + o.pageSize - 1);
    if (error) return { rows: [], total: 0, error };
    return { rows: data || [], total: count || 0, error: null };
  } catch (e) {
    return { rows: [], total: 0, error: e };
  }
}

/** Semua baris yang lolos filter server (per 1.000 baris). -> { rows, error } */
export async function ambilSemuaLangsung(sb, o) {
  const rows = [];
  try {
    for (let from = 0; ; from += PAGE) {
      let q = sb.from('produk').select(o.columns);
      if (o.chipFn) q = o.chipFn(q);
      q = pasangFilterServer(q, o.server);
      q = pasangUrutanServer(q, o.sort);
      const { data, error } = await q.range(from, from + PAGE - 1);
      if (error) return { rows: [], error };
      rows.push(...(data || []));
      if (!data || data.length < PAGE) break;
    }
  } catch (e) {
    return { rows: [], error: e };
  }
  return { rows, error: null };
}

/** Id produk yang statusnya `status` di view v_produk_stok_ringkas (1 baris per produk, dibaca per 1.000). -> { ids:Set, error } */
export async function ambilIdStok(sb, status) {
  const ids = new Set();
  try {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb.from('v_produk_stok_ringkas').select('produk_id').eq('stok_status', status).order('produk_id').range(from, from + PAGE - 1);
      if (error) return { ids: new Set(), error };
      (data || []).forEach((r) => ids.add(r.produk_id));
      if (!data || data.length < PAGE) break;
    }
  } catch (e) {
    return { ids: new Set(), error: e };
  }
  return { ids, error: null };
}

/**
 * Saring di client untuk filter yang tidak bisa di server (Harga, Stok), lalu urutkan.
 * ctx = { hargaIds: Set, stokIds: Map(status -> Set) }. Urutan client memakai pembanding yang sama dengan jalur search / Verified.
 */
export function saringKlienLaluUrut(rows, klienFilters, sort, ctx) {
  let out = rows;
  klienFilters.forEach((f) => {
    if (f.dim === 'harga') out = out.filter((r) => (ctx.hargaIds.has(r.id) === (f.value === 'ada')));
    else if (f.dim === 'stok') { const s = ctx.stokIds.get(f.value); out = out.filter((r) => !!s && s.has(r.id)); }
  });
  return urutkan(out, sort);
}
