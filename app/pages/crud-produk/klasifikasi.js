// crud-produk/klasifikasi.js
// Kategori & Spesialisasi sebagai ATRIBUT produk (dulu sub-modul sendiri: kategori.js, sudah dihapus).
// Atribut ini muncul di list Produk lewat mekanisme yang sama dengan Keluarga set: kolom yang bisa dipilih
// (kolom-tabel.js, ikut Export), filter di "+ Tambah Filter", dan kolom dinamis yang ditambah otomatis oleh filter.
//
// Sumber kebenaran tetap di database. Dua RPC dari migrasi 20261110_kategori_spes_katalog.sql (tidak ada di repo ini):
//   get_katalog_kategori_ringkasan -> dipakai HANYA untuk `dihitung_at` (cache klasifikasi sudah pernah dihitung atau belum)
//   get_katalog_kategori_daftar    -> daftar produk berpaginasi + kategori / spesialisasi / jenis / sumber klasifikasi
// RPC daftar tidak bisa difilter per produk_id, jadi seluruh klasifikasi dimuat SEKALI (per 1.000 baris) lalu disimpan
// di memori (TTL 30 menit). Setelah itu kolom, filter, dan opsi filter hanya membaca Map ini -- tanpa request tambahan.
// Cakupannya produk AKTIF saja (sama dengan tab lama): produk nonaktif tidak punya klasifikasi, kolomnya "—".
//
// Koreksi MANUAL (atribut.js, tabel produk_atribut_manual) menimpa nilai otomatis saat dibaca: klasOf(), filter, dan opsi memakai
// nilai EFEKTIF (manual kalau ada, otomatis kalau tidak). Dihitung saat dibaca, bukan ditulis ke cache, jadi tidak ada urutan pemuatan
// yang harus dijaga dan membatalkan koreksi langsung mengembalikan nilai otomatis. klasAuto() = nilai otomatisnya saja.
//
// Sengaja tanpa ketergantungan DOM dan TIDAK pernah throw: semua fungsi async mengembalikan { ..., error } supaya bisa
// diuji dengan Supabase tiruan (klasifikasi.test.mjs) dan halaman Produk tetap jalan kalau RPC-nya belum terpasang
// (hanya kolom / filter klasifikasi yang kosong, dengan pesan yang menjelaskan).

import { manualOf, SPES_TANPA } from './atribut.js';

export const KAT = {
  'SET': 'Set instrumen', 'INSTRUMEN SATUAN': 'Instrumen satuan', 'ELEKTROMEDIS': 'Elektromedis',
  'ALAT LABORATORIUM': 'Alat laboratorium', 'PENUNJANG MEDIS': 'Penunjang medis', 'BMHP': 'BMHP', 'UNIT': 'Unit lainnya',
};
export const KAT_ORDER = Object.keys(KAT);
// Unit & alat: tidak punya spesialisasi (belum ada sumbernya), kategorinya yang bermakna.
export const ALAT = ['ELEKTROMEDIS', 'ALAT LABORATORIUM', 'PENUNJANG MEDIS', 'BMHP', 'UNIT'];

// [label, penanda]. Penanda tidak kosong = dugaan sistem / belum ada petunjuk -> "perlu dicek".
export const SPES_SUMBER = {
  peta: ['Peta kode', ''], rmp: ['Kode RMP', ''], kata: ['Kata kunci', ''], dasar: ['Dasar', ''], manual: ['Dikoreksi', ''],
  'peta?': ['Dugaan (peta)', 'warn'], 'rmp?': ['Dugaan (RMP)', 'warn'], kosong: ['Belum ada petunjuk', 'bad'],
  label: ['Label set', ''], isi: ['Dugaan dari isi set', 'warn'],
};
const WARN_SUMBER = new Set(Object.keys(SPES_SUMBER).filter((k) => SPES_SUMBER[k][1]));

// Nilai khusus "Tanpa spesialisasi" di filter (checkbox butuh string; sama polanya dengan BRAND_NONE di index.js).
export const SPES_NONE = '__NONE__';
// Dimensi filter yang hanya dikenal client (RPC get_produk_list tidak mengenalnya) -> index.js memberinya jalur client.
export const KLAS_DIMS = ['kategori', 'spes', 'klas_cek'];
export const isKlasDim = (dim) => KLAS_DIMS.includes(dim);

export const katNama = (k) => KAT[k] || k || '—';
export const spesNama = (s) => (s == null ? 'Tanpa spesialisasi'
  : s === 'LAINNYA' ? 'Belum dikelompokkan'
  : String(s).replace(/\w\S*/g, (w) => w.charAt(0) + w.slice(1).toLowerCase()).replace(/\bTht\b/, 'THT').replace(/\bObgyn\b/, 'OBGYN'));

// ---------- RPC ----------
const RPC_RINGKASAN = 'get_katalog_kategori_ringkasan';
const RPC_DAFTAR = 'get_katalog_kategori_daftar';
const BATCH = 1000;                 // batas baris PostgREST per request
const TTL_MS = 30 * 60 * 1000;

export function rpcBelumTerpasang(err) {
  return !!err && (err.code === 'PGRST202' || err.code === '42883' || /could not find the function/i.test(err.message || ''));
}
export function pesanKlasifikasi(err) {
  if (err && err.code === 'KLAS_KOSONG') {
    return 'Klasifikasi katalog belum dihitung. Jalankan di SQL Editor Supabase: set statement_timeout = \'5min\'; select public.refresh_katalog_klasifikasi(); lalu muat ulang.';
  }
  if (rpcBelumTerpasang(err)) return 'Kategori & spesialisasi belum aktif di database. Jalankan 20261110_kategori_spes_katalog.sql di Supabase SQL Editor, lalu muat ulang.';
  return 'Gagal memuat kategori & spesialisasi: ' + ((err && err.message) || err);
}

// ---------- cache ----------
let cache = null;     // { map: Map<produk_id, entry>, info, t }
let inflight = null;

const entryDari = (r) => ({
  id: r.produk_id, tipe: r.tipe, kode: r.kode_produk, nama: r.nama_produk,
  kategori: r.kategori, kategoriSumber: r.kategori_sumber,
  spes: r.spes == null ? null : r.spes, spesSumber: r.spes_sumber,
  jenis: r.jenis || null, mikro: !!r.mikro, golongan: r.golongan || null,
});

/**
 * Muat seluruh klasifikasi (sekali; panggilan berikutnya memakai cache). -> { ok, error, info }
 * info = { dihitungAt, total, terbaca, lengkap }. lengkap=false: jumlah baris yang terbaca < total yang dilaporkan server
 * (mis. urutan RPC tidak stabil antar halaman) -> pemanggil sebaiknya memberi peringatan, bukan diam saja.
 */
export async function muatKlasifikasi(sb, { force = false } = {}) {
  if (!force && cache && Date.now() - cache.t < TTL_MS) return { ok: true, error: null, info: cache.info };
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const ring = await sb.rpc(RPC_RINGKASAN);
      if (ring.error) return { ok: false, error: ring.error, info: null };
      const dihitungAt = ring.data && ring.data.dihitung_at;
      if (!dihitungAt) return { ok: false, error: { code: 'KLAS_KOSONG', message: 'Klasifikasi belum dihitung' }, info: null };

      const map = new Map();
      let off = 0, total = Infinity;
      while (off < total) {
        const { data, error } = await sb.rpc(RPC_DAFTAR, {
          p_kategori: KAT_ORDER, p_spes: null, p_cari: null, p_perlu_cek: false, p_batas: BATCH, p_offset: off,
        });
        if (error) return { ok: false, error, info: null };
        const rows = (data && data.rows) || [];
        total = Number((data && data.total) || 0);
        if (!rows.length) break;
        rows.forEach((r) => map.set(r.produk_id, entryDari(r)));
        off += rows.length; // jumlah baris yang benar-benar kembali (jaga-jaga kalau server membatasi p_batas)
      }
      const info = { dihitungAt, total: Number.isFinite(total) ? total : map.size, terbaca: map.size, lengkap: map.size >= (Number.isFinite(total) ? total : 0) };
      cache = { map, info, t: Date.now() };
      return { ok: true, error: null, info };
    } catch (e) {
      return { ok: false, error: e, info: null };
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Buang cache (mis. unmount halaman, atau user minta muat ulang). */
export function resetKlasifikasi() { cache = null; inflight = null; }
export const klasTerisi = () => !!cache;
export const infoKlasifikasi = () => (cache ? cache.info : null);
/**
 * Nilai efektif sebuah entri cache: koreksi manual (kategori / spes) menimpa nilai otomatis. Sumbernya ikut berubah
 * ('koreksi' / 'manual') supaya tampil "Dikoreksi" dan tidak dihitung "perlu dicek". spes 'TANPA' = sengaja tanpa spesialisasi (null).
 */
export function efektif(e) {
  if (!e) return e;
  const m = manualOf(e.id);
  if (!m || (!m.kategori && !m.spes)) return e;
  const out = { ...e };
  if (m.kategori) { out.kategori = m.kategori; out.kategoriSumber = 'koreksi'; }
  if (m.spes) { out.spes = m.spes === SPES_TANPA ? null : m.spes; out.spesSumber = 'manual'; }
  return out;
}
/** Klasifikasi satu produk (nilai EFEKTIF), undefined = belum dimuat / produk nonaktif (tidak ada di cakupan). */
export const klasOf = (id) => (cache ? efektif(cache.map.get(id)) : undefined);
/** Nilai OTOMATIS saja (tanpa koreksi manual): untuk memberi tahu "Otomatis: ..." di form dan untuk membandingkan. */
export const klasAuto = (id) => (cache ? cache.map.get(id) : undefined);

// ---------- turunan per produk ----------
/** Dugaan sistem, belum ada petunjuk, atau golongan belum dipetakan (penanda ⚠ di tab lama). */
export const perluCek = (e) => !!e && (WARN_SUMBER.has(e.spesSumber) || e.kategoriSumber === 'bawaan');
export function sumberLabel(e) {
  if (!e) return '';
  if (ALAT.includes(e.kategori)) {
    return e.kategoriSumber === 'bawaan' ? 'Golongan belum dipetakan' : e.kategoriSumber === 'koreksi' ? 'Dikoreksi' : 'Golongan';
  }
  const s = SPES_SUMBER[e.spesSumber];
  return s ? s[0] : (e.spesSumber || '');
}
/** Teks spesialisasi untuk sel / Excel. Unit & alat tidak punya spesialisasi -> null (bukan "Tanpa spesialisasi"). */
export const spesTeks = (e) => (!e || ALAT.includes(e.kategori) ? null : spesNama(e.spes));

// ---------- filter ----------
const nilaiFilter = (f) => f.values || (f.value != null && f.value !== '' ? [f.value] : []);

/** Apakah `row` (baris list Produk atau entry yang dibentuk seperti baris) lolos satu filter dimensi klasifikasi. */
export function cocokKlas(filt, row) {
  const vals = nilaiFilter(filt);
  const e = klasOf(row.id);
  switch (filt.dim) {
    case 'kategori': return !!e && vals.includes(e.kategori);
    case 'spes':
      if (!e) return false;
      if (e.spes == null) return !ALAT.includes(e.kategori) && vals.includes(SPES_NONE);
      return vals.includes(e.spes);
    case 'klas_cek': return filt.value === 'ya' ? perluCek(e) : (!!e && !perluCek(e));
    default: return true;
  }
}

/** produk_id di cache yang lolos SEMUA filter klasifikasi (jalur client list Produk: id dulu, baris produknya menyusul). */
export function idsKlasFilter(filters) {
  const out = [];
  if (!cache) return out;
  cache.map.forEach((e, id) => {
    const row = { id, tipe: e.tipe, kode_produk: e.kode, nama_produk: e.nama };
    if (filters.every((f) => cocokKlas(f, row))) out.push(id);
  });
  return out;
}

/** Opsi filter dari cache: { kategori: [{ value, label, n }], spes: [{ value, label, n }] } -- urutan: terbanyak dulu, "Belum dikelompokkan" terakhir. */
export function opsiKlasifikasi() {
  const kat = new Map(), spes = new Map();
  let tanpa = 0;
  if (cache) {
    cache.map.forEach((e0) => {
      const e = efektif(e0);
      kat.set(e.kategori, (kat.get(e.kategori) || 0) + 1);
      if (e.spes != null) spes.set(e.spes, (spes.get(e.spes) || 0) + 1);
      else if (!ALAT.includes(e.kategori)) tanpa++;
    });
  }
  const urutKat = [...KAT_ORDER.filter((k) => kat.has(k)), ...[...kat.keys()].filter((k) => !KAT_ORDER.includes(k))];
  const kategori = urutKat.map((k) => ({ value: k, label: katNama(k), n: kat.get(k) }));
  const daftarSpes = [...spes.entries()]
    .sort((a, b) => (a[0] === 'LAINNYA') - (b[0] === 'LAINNYA') || b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'id'))
    .map(([v, n]) => ({ value: v, label: spesNama(v), n }));
  if (tanpa) daftarSpes.push({ value: SPES_NONE, label: spesNama(null), n: tanpa });
  return { kategori, spes: daftarSpes };
}

// ---------- baris produk by id (jalur client filter klasifikasi) ----------
const ID_CHUNK = 150;   // sama dengan chunk .in('id', ...) lain di halaman Produk (aman untuk panjang URL)
const PARALEL = 6;      // filter lebar (mis. semua Instrumen satuan) = puluhan chunk: jangan hajar PostgREST sekaligus
const ROW_TTL_MS = 2 * 60 * 1000;

const chunks = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

/**
 * Baris produk (kolom list Produk) untuk sekumpulan id. `cache` (Map id -> { t, row }) dipegang pemanggil supaya
 * pindah halaman / ganti chip tidak mengambil ulang ratusan baris; entri lebih tua dari 2 menit diambil lagi.
 * Id yang sudah tidak ada di tabel produk dibuang. -> { rows (urutan sama dengan ids), error }
 */
export async function fetchRowsByIds(sb, ids, columns, rowCache = new Map()) {
  const uniq = [...new Set((ids || []).filter((x) => x != null))];
  const now = Date.now();
  const need = uniq.filter((id) => { const c = rowCache.get(id); return !c || now - c.t > ROW_TTL_MS; });
  try {
    const parts = chunks(need, ID_CHUNK);
    for (let i = 0; i < parts.length; i += PARALEL) {
      const res = await Promise.all(parts.slice(i, i + PARALEL).map((c) => sb.from('produk').select(columns).in('id', c)));
      const bad = res.find((r) => r.error);
      if (bad) return { rows: [], error: bad.error };
      res.forEach((r) => (r.data || []).forEach((row) => rowCache.set(row.id, { t: now, row })));
    }
    return { rows: uniq.map((id) => (rowCache.get(id) || {}).row).filter(Boolean), error: null };
  } catch (e) {
    return { rows: [], error: e };
  }
}
