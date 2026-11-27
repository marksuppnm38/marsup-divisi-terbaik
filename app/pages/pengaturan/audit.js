// Riwayat perubahan izin (tabel izin_audit): logika murni + pengambil data, dipakai view Riwayat global
// (riwayat.js) dan kolom "Terakhir diubah" di tabel akun (table.js / index.js).
//
// izin_audit ditulis OTOMATIS oleh trigger allowed_users_audit; halaman ini hanya MEMBACA. Baca dibatasi RLS ke
// admin (can_manage_izin()), jadi filter di sini cuma soal tampilan, bukan penegakan.
//
// Bagian murni (tanpa DOM / jaringan) dites oleh scripts/test-riwayat-izin.mjs. Fungsi fetch* menerima client
// supabase sebagai argumen, jadi tidak menyentuh window saat modul di-import.
import { isoDate, addDaysISO, applyToQuery } from '../../../shared/data-table.js';
import { KOLOM_LABEL } from './state.js';

export const AUDIT_COLS = 'waktu, oleh, email_target, kolom, nilai_lama, nilai_baru';
export const AUDIT_PAGE_SIZE = 30;

// Opsi filter kolom "Yang diubah", urutan sama dengan KOLOM_LABEL (satu sumber label dengan tab Riwayat di drawer).
export const KOLOM_OPTIONS = Object.entries(KOLOM_LABEL).map(([value, label]) => ({ value, label }));

// ── Waktu ────────────────────────────────────────────────────────────────────────────────────

const parseDay = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  return m ? [Number(m[1]), Number(m[2]) - 1, Number(m[3])] : null;
};

/**
 * 'YYYY-MM-DD' (tanggal yang dipilih admin di browser) -> instan UTC (ISO) saat hari itu DIMULAI di zona waktu browser.
 * Wajib begini: waktu di izin_audit itu timestamptz, jadi membandingkannya dengan '2026-11-26' polos dibaca sebagai
 * 00:00 UTC. Akibatnya "sampai 26 Nov" membuang semua perubahan tanggal 26 dan "dari 26 Nov" ikut menyertakan
 * dini hari tanggal 26 WIB yang sebenarnya masih tanggal 25 UTC.
 */
export function localDayStart(iso) {
  const p = parseDay(iso);
  if (!p) return null;
  const d = new Date(p[0], p[1], p[2]); // tengah malam LOKAL
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Filter tanggal data-table (op dari / sampai / antara) -> batas pada kolom waktu: { gte, lt } (keduanya bisa null).
 * Batas atas eksklusif di awal hari BERIKUTNYA, jadi "sampai 26 Nov" mencakup seluruh tanggal 26.
 * Op lain tidak dijangkau menu kolom ini (hanya dari/sampai/antara + pintasan yang juga memakai dari), jadi diabaikan.
 */
export function waktuBounds(f) {
  if (!f) return { gte: null, lt: null };
  const next = (iso) => (parseDay(iso) ? localDayStart(addDaysISO(iso, 1)) : null);
  switch (f.op) {
    case 'dari': return { gte: localDayStart(f.value), lt: null };
    case 'sampai': return { gte: null, lt: next(f.value) };
    case 'antara': return { gte: localDayStart(f.value && f.value.from), lt: next(f.value && f.value.to) };
    default: return { gte: null, lt: null };
  }
}

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * Instan -> 'YYYY-MM-DDTHH:mm:ss' di zona waktu BROWSER. Dipakai sebagai nilai sort/filter kolom "Terakhir diubah"
 * (mode client memotong 10 karakter pertama sebagai tanggal): string ISO UTC mentah akan menggeser tanggal
 * untuk perubahan dini hari WIB. Urutan leksikografis tetap sama dengan urutan waktu.
 */
export function localStamp(value) {
  const d = new Date(value);
  if (!value || Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

export function formatWaktu(value) {
  const t = new Date(value);
  return Number.isNaN(t.getTime()) ? String(value || '') : t.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

// Pintasan di menu kolom Waktu. Dihitung saat kolom dibangun (mount halaman), bukan saat modul di-import.
export function waktuPresets(today = isoDate()) {
  return [
    { label: 'Hari ini', filter: { op: 'dari', value: today } },
    { label: '7 hari terakhir', filter: { op: 'dari', value: addDaysISO(today, -6) } },
    { label: '30 hari terakhir', filter: { op: 'dari', value: addDaysISO(today, -29) } },
  ];
}

// ── Query ────────────────────────────────────────────────────────────────────────────────────

// Beberapa baris audit lahir dari SATU UPDATE dan berbagi nilai `waktu` yang sama (now() di trigger). Urut hanya
// menurut waktu membuat baris bertukar tempat / terlewat / dobel di batas halaman, jadi ditambah pembeda berurutan.
// (Skema izin_audit tidak menjamin ada kolom id, jadi pembedanya kolom yang pasti ada.)
const TIE_BREAK = ['email_target', 'kolom', 'nilai_baru'];

/**
 * Pasang filter + urutan data-table ke query izin_audit. Filter selain `waktu` lewat applyToQuery (bersama);
 * `waktu` dikerjakan di sini karena butuh batas hari lokal (lihat localDayStart).
 */
export function applyAuditQuery(query, state, columns) {
  const filters = (state && state.filters) || [];
  let q = applyToQuery(query, { sort: state && state.sort, filters: filters.filter((f) => f.key !== 'waktu') }, columns);
  for (const f of filters.filter((x) => x.key === 'waktu')) {
    const b = waktuBounds(f);
    if (b.gte) q = q.gte('waktu', b.gte);
    if (b.lt) q = q.lt('waktu', b.lt);
  }
  const primary = state && state.sort && state.sort.key;
  if (primary !== 'waktu') q = q.order('waktu', { ascending: false });
  for (const k of TIE_BREAK) if (k !== primary) q = q.order(k, { ascending: true });
  return q;
}

/** Satu halaman riwayat global. -> { rows, total, error } (error = objek error supabase / Error, atau null). */
export async function fetchAuditPage(client, { state, columns, page = 1, pageSize = AUDIT_PAGE_SIZE }) {
  try {
    let q = client.from('izin_audit').select(AUDIT_COLS, { count: 'exact' });
    q = applyAuditQuery(q, state, columns);
    const from = (page - 1) * pageSize;
    const { data, error, count } = await q.range(from, from + pageSize - 1);
    if (error) return { rows: [], total: 0, error };
    return { rows: data || [], total: typeof count === 'number' ? count : (data || []).length, error: null };
  } catch (e) {
    return { rows: [], total: 0, error: e };
  }
}

// ── Terakhir diubah (per akun) ───────────────────────────────────────────────────────────────

/** Baris { email_target, terakhir } -> Map(email huruf kecil -> instan terbaru). Baris rusak dilewati. */
export function toTerakhirMap(rows) {
  const out = new Map();
  for (const r of rows || []) {
    const email = String((r && r.email_target) || '').trim().toLowerCase();
    const t = new Date(r && r.terakhir).getTime();
    if (!email || Number.isNaN(t)) continue;
    const cur = out.get(email);
    if (!cur || t > new Date(cur).getTime()) out.set(email, r.terakhir);
  }
  return out;
}

/**
 * Baca view izin_audit_terakhir (supabase/2026-11-26_izin_audit_terakhir.sql). PostgREST tidak punya GROUP BY, jadi
 * agregatnya dibuat di view. Mengembalikan null kalau view belum ada / tidak terbaca: pemanggil MENYEMBUNYIKAN
 * kolomnya, bukan menampilkan "—" yang akan terbaca sebagai "tidak pernah diubah" padahal sebenarnya tidak diketahui.
 */
export async function fetchTerakhir(client) {
  try {
    const { data, error } = await client.from('izin_audit_terakhir').select('email_target, terakhir');
    if (error || !Array.isArray(data)) return null;
    return toTerakhirMap(data);
  } catch (_) {
    return null;
  }
}
