// crud-produk/atribut.js
// Koreksi MANUAL atribut produk: Keluarga set, Kategori, Spesialisasi. Ketiganya tetap punya nilai OTOMATIS dari database
// (fn_keluarga_set + cache klasifikasi katalog); modul ini hanya menyimpan dan membaca koreksi yang menimpanya, per produk.
// Kolom null = "ikut otomatis", jadi menghapus koreksi = kembali ke nilai otomatis.
//
// Tabel & RPC: supabase/2026-11-21_atribut_produk_manual.sql
//   produk_atribut_manual (produk_id, keluarga, kategori, spes)      -> dibaca langsung (tabel kecil, dimuat penuh sekali)
//   set_produk_atribut_manual(p_ids bigint[], p_patch jsonb)          -> satu-satunya jalan tulis; hanya kunci yang ada di patch yang diubah
//
// Sengaja tanpa ketergantungan DOM dan TIDAK pernah throw: semua fungsi async mengembalikan { ok, error }, supaya bisa diuji
// dengan Supabase tiruan (atribut.test.mjs) dan halaman Produk tetap jalan kalau migrasinya belum dijalankan (koreksi
// dianggap kosong; hanya kontrol edit yang memberi tahu migrasinya belum ada).
// Modul lain (keluarga.js) hanya MEMBACA cache lewat manualOf()/manualMap(); pemuatannya urusan index.js. Kategori & spes: trigger DB menyalin koreksi ke kolom produk (supabase/2026-11-22_klasifikasi_kolom_produk.sql).

export const TABEL = 'produk_atribut_manual';
export const RPC_SET = 'set_produk_atribut_manual';
/** Nilai spes yang berarti "sengaja tanpa spesialisasi" (beda dengan null = ikut otomatis). */
export const SPES_TANPA = 'TANPA';
export const FIELDS = ['keluarga', 'kategori', 'spes'];

const PAGE = 1000;                 // batas baris PostgREST per request
const MAX_IDS = 2000;              // sama dengan batas RPC
const TTL_MS = 30 * 60 * 1000;

const EMPTY = new Map();
let cache = null;                  // { map: Map<produk_id, { keluarga, kategori, spes }>, t }
let inflight = null;

/** Nama keluarga baku: spasi dirapikan + huruf besar (sama dengan yang dilakukan RPC). Kosong -> null. */
export function normKeluarga(s) {
  const v = String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toUpperCase();
  return v || null;
}

export function belumTerpasang(err) {
  if (!err) return false;
  if (['PGRST205', 'PGRST202', '42P01', '42883'].includes(err.code)) return true;
  return /could not find the (?:table|function)|relation .* does not exist|function .* does not exist/i.test(err.message || '');
}
export function pesanAtribut(err) {
  if (belumTerpasang(err)) return 'Koreksi atribut belum aktif di database. Jalankan supabase/2026-11-21_atribut_produk_manual.sql di Supabase SQL Editor, lalu muat ulang.';
  if (err && (err.code === '28000' || /perlu login/i.test(err.message || ''))) return 'Sesi login habis. Login ulang lalu coba lagi.';
  return 'Gagal menyimpan / memuat koreksi atribut: ' + ((err && err.message) || err);
}

const bersih = (r) => ({
  keluarga: r.keluarga || null,
  kategori: r.kategori || null,
  spes: r.spes || null,
});

/**
 * Muat seluruh koreksi (sekali; panggilan berikutnya memakai cache). -> { ok, error, belumTerpasang }
 * Gagal TIDAK menghapus cache lama. belumTerpasang=true: tabelnya belum ada -> pemanggil cukup menganggap tidak ada koreksi.
 */
export async function muatManual(sb, { force = false } = {}) {
  if (!force && cache && Date.now() - cache.t < TTL_MS) return { ok: true, error: null, belumTerpasang: false };
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const map = new Map();
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await sb.from(TABEL).select('produk_id, keluarga, kategori, spes').order('produk_id').range(from, from + PAGE - 1);
        if (error) return { ok: false, error, belumTerpasang: belumTerpasang(error) };
        (data || []).forEach((r) => map.set(r.produk_id, bersih(r)));
        if (!data || data.length < PAGE) break;
      }
      cache = { map, t: Date.now() };
      return { ok: true, error: null, belumTerpasang: false };
    } catch (e) {
      return { ok: false, error: e, belumTerpasang: belumTerpasang(e) };
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Peta lengkap produk_id -> { keluarga, kategori, spes } (Map kosong kalau belum dimuat). Jangan diubah dari luar. */
export const manualMap = () => (cache ? cache.map : EMPTY);
export const manualOf = (id) => (cache ? cache.map.get(id) : undefined);
export const manualTerisi = () => !!cache;
export function resetManual() { cache = null; inflight = null; }

/** Rapikan patch dari UI: hanya kunci yang dikenal, keluarga dinormalkan, string kosong -> null (= kembali ke otomatis). */
export function rapikanPatch(patch) {
  const out = {};
  FIELDS.forEach((k) => {
    if (!patch || !Object.prototype.hasOwnProperty.call(patch, k)) return;
    const v = patch[k];
    out[k] = k === 'keluarga' ? normKeluarga(v) : (String(v == null ? '' : v).trim().toUpperCase() || null);
  });
  return out;
}

/**
 * Simpan koreksi untuk sekumpulan produk. patch = { keluarga?, kategori?, spes? }; kunci yang tidak ada tidak diubah, nilai
 * null / '' = kembalikan ke otomatis. -> { ok, error, hasil: { diubah, keluarga_dilewati } }
 * Sukses -> cache dimuat ulang (tabelnya kecil), jadi tampilan lain langsung konsisten dengan database.
 */
export async function simpanManual(sb, ids, patch) {
  const uniq = [...new Set((ids || []).filter((x) => x != null))];
  const p = rapikanPatch(patch);
  if (!uniq.length) return { ok: false, error: { message: 'Tidak ada produk dipilih' }, hasil: null };
  if (!Object.keys(p).length) return { ok: false, error: { message: 'Tidak ada yang diubah' }, hasil: null };
  if (uniq.length > MAX_IDS) return { ok: false, error: { message: `Maksimal ${MAX_IDS} produk per simpan` }, hasil: null };
  try {
    const { data, error } = await sb.rpc(RPC_SET, { p_ids: uniq, p_patch: p });
    if (error) return { ok: false, error, hasil: null };
    const seg = await muatManual(sb, { force: true });
    if (!seg.ok) return { ok: false, error: seg.error, hasil: data || null };
    return { ok: true, error: null, hasil: { diubah: Number((data && data.diubah) || 0), keluarga_dilewati: Number((data && data.keluarga_dilewati) || 0) } };
  } catch (e) {
    return { ok: false, error: e, hasil: null };
  }
}
