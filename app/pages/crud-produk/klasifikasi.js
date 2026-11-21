// crud-produk/klasifikasi.js
// Kategori & Spesialisasi sebagai ATRIBUT produk (dulu sub-modul sendiri: kategori.js, sudah dihapus).
// Atribut ini muncul di list Produk lewat mekanisme yang sama dengan Keluarga set: kolom yang bisa dipilih
// (kolom-tabel.js, ikut Export), filter di "+ Tambah Filter", dan kolom dinamis yang ditambah otomatis oleh filter.
//
// Sumber kebenaran: KOLOM di tabel `produk` (kategori, kategori_sumber, spes, spes_sumber, klas_jenis, klas_mikro),
// dari supabase/2026-11-22_klasifikasi_kolom_produk.sql. Hasil auto-mapping (katalog_klasifikasi_cache) hanya jadi
// PENGISI AWAL lewat backfill_klasifikasi_produk(); koreksi manual (form / bulk -> produk_atribut_manual) disalin ke kolom
// oleh trigger di database. Jadi browser TIDAK lagi memuat seluruh katalog: baris list membawa kolomnya sendiri
// (PRODUK_LIST_COLUMNS), baris dari RPC yang belum membawanya dilengkapi per halaman (muatKlasIds, 1 request per 150 id),
// dan opsi filter + jumlahnya dihitung database (get_klasifikasi_opsi).
//
// Sengaja tanpa ketergantungan DOM dan TIDAK pernah throw: semua fungsi async mengembalikan { ..., error } supaya bisa
// diuji dengan Supabase tiruan (klasifikasi.test.mjs) dan halaman Produk tetap jalan kalau migrasinya belum dijalankan
// (hanya kolom / filter klasifikasi yang kosong, dengan pesan yang menjelaskan).

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

// Kolom produk yang membawa klasifikasi (ditambahkan ke PRODUK_LIST_COLUMNS di index.js).
export const KLAS_COLS = 'kategori, kategori_sumber, spes, spes_sumber, klas_jenis, klas_mikro';

// ---------- RPC / pesan ----------
const RPC_OPSI = 'get_klasifikasi_opsi';
const RPC_OTOMATIS = 'get_klasifikasi_otomatis';
const TTL_MS = 30 * 60 * 1000;
const PAGE = 1000;               // batas baris PostgREST per request
const ID_CHUNK = 150;            // sama dengan chunk .in('id', ...) lain di halaman Produk (aman untuk panjang URL)
const PARALEL = 6;

export function rpcBelumTerpasang(err) {
  return !!err && (err.code === 'PGRST202' || err.code === '42883' || err.code === '42703' || err.code === 'PGRST204'
    || /could not find the function|column .*(kategori|spes|klas_).* does not exist|could not find the .*(kategori|spes|klas_)/i.test(err.message || ''));
}
export function pesanKlasifikasi(err) {
  if (rpcBelumTerpasang(err)) return 'Kategori & spesialisasi belum aktif di database. Jalankan supabase/2026-11-22_klasifikasi_kolom_produk.sql di Supabase SQL Editor (lalu backfill_klasifikasi_produk), kemudian muat ulang.';
  return 'Gagal memuat kategori & spesialisasi: ' + ((err && err.message) || err);
}

// ---------- penyimpanan di memori ----------
let store = new Map();     // produk_id -> entri | null (null = sudah dibaca, produk belum punya kategori / spesialisasi)
let opsi = null;           // { kategori: [{ value, n }], spes: [{ value, n }], tanpa, t }
let inflightOpsi = null;
let otomatis = new Map();  // produk_id -> entri OTOMATIS (cache katalog) | null: hanya untuk teks "Otomatis: ..." di form koreksi

const entryDari = (r) => {
  if (!r || (r.kategori == null && r.spes == null)) return null;
  return {
    id: r.id !== undefined ? r.id : r.produk_id, tipe: r.tipe, kode: r.kode_produk, nama: r.nama_produk,
    kategori: r.kategori == null ? null : r.kategori, kategoriSumber: r.kategori_sumber,
    spes: r.spes == null ? null : r.spes, spesSumber: r.spes_sumber,
    jenis: r.klas_jenis || null, mikro: !!r.klas_mikro, golongan: r.golongan || null,
  };
};
const punyaKolomKlas = (r) => !!r && Object.prototype.hasOwnProperty.call(r, 'kategori');

const chunks = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

/** Simpan klasifikasi dari baris produk yang SUDAH membawa kolomnya (hasil .from('produk').select(PRODUK_LIST_COLUMNS)). */
export function simpanKlasDariBaris(rows) {
  (rows || []).forEach((r) => { if (r && r.id != null && punyaKolomKlas(r)) store.set(r.id, entryDari(r)); });
}

/** Lengkapi klasifikasi untuk sekumpulan id yang belum dibaca. -> { ok, error } (tidak pernah throw) */
export async function muatKlasIds(sb, ids) {
  const need = [...new Set((ids || []).filter((x) => x != null && !store.has(x)))];
  if (!need.length) return { ok: true, error: null };
  try {
    const parts = chunks(need, ID_CHUNK);
    for (let i = 0; i < parts.length; i += PARALEL) {
      const res = await Promise.all(parts.slice(i, i + PARALEL).map((c) => sb.from('produk').select('id, ' + KLAS_COLS).in('id', c)));
      const bad = res.find((r) => r.error);
      if (bad) return { ok: false, error: bad.error };
      res.forEach((r) => (r.data || []).forEach((row) => store.set(row.id, entryDari(row))));
    }
    need.forEach((id) => { if (!store.has(id)) store.set(id, null); }); // id yang sudah tidak ada di tabel
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: e };
  }
}
/** Seperti muatKlasIds, tapi menerima baris: yang sudah membawa kolomnya dipakai langsung, sisanya ditanya per id. */
export async function attachKlas(sb, rows) {
  simpanKlasDariBaris(rows);
  return muatKlasIds(sb, (rows || []).map((r) => r && r.id));
}

/**
 * Muat opsi filter (jumlah produk per kategori / spesialisasi; dihitung database). Panggilan berikutnya memakai cache
 * 30 menit. -> { ok, error, info: null } (info tersisa supaya pemanggil lama tetap kompatibel).
 */
export async function muatKlasifikasi(sb, { force = false } = {}) {
  if (!force && opsi && Date.now() - opsi.t < TTL_MS) return { ok: true, error: null, info: null };
  if (inflightOpsi) return inflightOpsi;
  inflightOpsi = (async () => {
    try {
      const { data, error } = await sb.rpc(RPC_OPSI);
      if (error) return { ok: false, error, info: null };
      const d = data || {};
      opsi = { kategori: d.kategori || [], spes: d.spes || [], tanpa: Number(d.tanpa || 0), t: Date.now() };
      return { ok: true, error: null, info: null };
    } catch (e) {
      return { ok: false, error: e, info: null };
    } finally {
      inflightOpsi = null;
    }
  })();
  return inflightOpsi;
}

/** Nilai OTOMATIS (cache katalog) untuk beberapa produk -> { ok, error }. Dipakai form koreksi; hasil dibaca lewat klasAuto(). */
export async function muatOtomatis(sb, ids) {
  const uniq = [...new Set((ids || []).filter((x) => x != null))];
  if (!uniq.length) return { ok: true, error: null };
  try {
    const { data, error } = await sb.rpc(RPC_OTOMATIS, { p_ids: uniq });
    if (error) return { ok: false, error };
    uniq.forEach((id) => otomatis.set(id, null));
    (data || []).forEach((r) => otomatis.set(r.produk_id, entryDari({ ...r, id: r.produk_id })));
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: e };
  }
}

/** Buang semua yang dibaca (mis. unmount halaman, setelah koreksi / bulk). */
export function resetKlasifikasi() { store = new Map(); opsi = null; inflightOpsi = null; otomatis = new Map(); }
export const klasTerisi = () => store.size > 0 || !!opsi;
export const infoKlasifikasi = () => null;

/** Klasifikasi satu produk, undefined = belum dibaca / produk belum punya kategori maupun spesialisasi. */
export const klasOf = (id) => store.get(id) || undefined;
/** Nilai OTOMATIS saja (untuk "Otomatis: ..." di form). */
export const klasAuto = (id) => otomatis.get(id) || undefined;

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

/** Apakah `row` (baris list Produk) lolos satu filter dimensi klasifikasi. Klasifikasi baris harus sudah dibaca (attachKlas). */
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

/** Pra-saring di server (kasar, hanya untuk mempersempit unduhan); ketepatan akhirnya tetap cocokKlas() di client. */
function sempitkanDiServer(q, filters) {
  let out = q.not('kategori', 'is', null);
  filters.forEach((f) => {
    const vals = nilaiFilter(f);
    if (f.dim === 'kategori' && vals.length) out = out.in('kategori', vals);
    if (f.dim === 'spes' && vals.length && !vals.includes(SPES_NONE)) out = out.in('spes', vals);
  });
  return out;
}

/**
 * Baris produk (kolom `columns`, harus memuat KLAS_COLS) yang lolos filter klasifikasi. Server hanya mempersempit; baris
 * yang dikembalikan sudah dicatat klasifikasinya sehingga cocokKlas() langsung bisa dipakai pemanggil.
 * Dibaca per 1.000 baris dengan urutan id yang stabil. -> { rows, error }
 */
export async function fetchRowsByKlas(sb, filters, columns) {
  const klasF = (filters || []).filter((f) => isKlasDim(f.dim));
  const rows = [];
  try {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sempitkanDiServer(sb.from('produk').select(columns), klasF).order('id').range(from, from + PAGE - 1);
      if (error) return { rows: [], error };
      rows.push(...(data || []));
      if (!data || data.length < PAGE) break;
    }
  } catch (e) {
    return { rows: [], error: e };
  }
  simpanKlasDariBaris(rows);
  return { rows: rows.filter((r) => klasF.every((f) => cocokKlas(f, r))), error: null };
}

/** Opsi filter: { kategori: [{ value, label, n }], spes: [{ value, label, n }] } -- urutan: terbanyak dulu, "Belum dikelompokkan" terakhir. */
export function opsiKlasifikasi() {
  const o = opsi || { kategori: [], spes: [], tanpa: 0 };
  const nKat = new Map(o.kategori.map((k) => [k.value, Number(k.n)]));
  const urutKat = [...KAT_ORDER.filter((k) => nKat.has(k)), ...[...nKat.keys()].filter((k) => !KAT_ORDER.includes(k))];
  const kategori = urutKat.map((k) => ({ value: k, label: katNama(k), n: nKat.get(k) }));
  const spes = o.spes.map((s) => ({ value: s.value, n: Number(s.n) }))
    .sort((a, b) => (a.value === 'LAINNYA') - (b.value === 'LAINNYA') || b.n - a.n || String(a.value).localeCompare(String(b.value), 'id'))
    .map((s) => ({ value: s.value, label: spesNama(s.value), n: s.n }));
  if (o.tanpa) spes.push({ value: SPES_NONE, label: spesNama(null), n: o.tanpa });
  return { kategori, spes };
}
