// auto-konversi/lexicon.js
// ══════════════════════════════════════════
// Dua hal, keduanya PURE (rpc disuntikkan):
//
// 1) LEXICON — pengetahuan "kata aneh → jenis produk di katalog" yang DIPELAJARI dari riwayat, bukan ditulis tangan.
//    Sumber: RPC get_kamus_token() (lihat README/auto-konversi-queries.sql, Q3). Tiap baris:
//      { token: 'KORENTANG', kanonik: 'SPONGE HOLDING FORCEPS', n: 41, share: 0.93 }
//    artinya: dari n item riwayat yang memuat kata itu, `share` di antaranya akhirnya dipenuhi produk
//    berkeluarga yang nama katalognya (tanpa ukuran/ujung/bentuk) = `kanonik`.
//    Hanya entri yang cukup sering (minN) dan cukup konsisten (minShare) yang dipakai.
//    Kalau RPC belum ada / error: lexicon kosong, mesin tetap jalan (hanya tanpa jalur ini).
//
// 2) TANGGA QUERY KATALOG — dari yang paling spesifik ke paling longgar, dibangun dari hasil understand().
//    Dipakai HANYA untuk search_produk_dengan_harga (query Dictionary tetap ejaan asli + varian typo,
//    karena riwayat menyimpan ejaan customer apa adanya).
// ══════════════════════════════════════════
import { understand } from './understand.js';
import { JENIS_WORDS } from './aliases.js';

export const EMPTY_LEXICON = Object.freeze({ size: 0, error: null, lookup: () => null });

export function makeLexicon(rows, { minShare = 0.5, minN = 3 } = {}) {
  const map = new Map();
  (rows || []).forEach((r) => {
    const token = String(r.token || '').toUpperCase();
    const share = Number(r.share), n = Number(r.n);
    if (!token || !r.kanonik || !(share >= minShare) || !(n >= minN)) return;
    const cur = map.get(token);
    if (!cur || share * Math.log(1 + n) > cur.share * Math.log(1 + cur.n)) map.set(token, { token, kanonik: String(r.kanonik).toUpperCase(), n, share });
  });
  return { size: map.size, error: null, lookup: (tok) => map.get(String(tok || '').toUpperCase()) || null };
}

export async function loadLexicon(rpc, opts) {
  try {
    const { data, error } = await rpc('get_kamus_token', {});
    if (error) return { ...EMPTY_LEXICON, error: error.message || 'get_kamus_token gagal' };
    return makeLexicon(data, opts);
  } catch (e) {
    return { ...EMPTY_LEXICON, error: e.message };
  }
}

const join = (...p) => p.filter((x) => x != null && x !== '').join(' ').replace(/\s+/g, ' ').trim();
const attrText = (a) => join(a.ujung, a.orientasi === 'lurus' ? 'STR' : a.orientasi === 'bengkok' ? 'CVD' : '', a.ukuran_cm != null ? `${a.ukuran_cm} CM` : '');

// Catatan perilaku search_produk_dengan_harga (dari definisinya): hasil bersih HANYA kalau SEMUA token query cocok (prefiks);
// kalau ada satu token yang tidak ada di katalog (mis. "MAYO", atau "BL/BL" yang tidak pernah ada), jatuh ke pencocokan
// sebagian yang berisik. Karena itu urutannya: asli → tingkat KELUARGA (inti saja, dan buang kata satu-satu, tanpa atribut)
// → baru yang memakai atribut. Atribut dinilai di sisi kita (compareAttrs), bukan dititipkan ke pencarian teks.
// Dedup, maksimum `max`.
export function buildQueryLadder(item, u, lexicon, max = 8) {
  u = u || understand(item.nama || item.deskripsi || '');
  const a = u.attrs;
  const out = [];
  const push = (q) => { q = join(q); if (q && !out.includes(q)) out.push(q); };

  (item.variants || [u.norm]).forEach(push);
  if (u.inti) {
    push(u.inti);
    if (u.tokens.length >= 3) u.tokens.forEach((_, i) => push(u.tokens.filter((__, j) => j !== i).join(' ')));
    push(join(u.inti, attrText(a)));
  }
  if (lexicon && lexicon.size) {
    u.tokens.forEach((tok) => {
      const e = lexicon.lookup(tok);
      if (!e) return;
      const rest = u.tokens.filter((t) => t !== tok).join(' ');
      push(join(e.kanonik, rest));
      push(e.kanonik);
    });
  }
  return out.slice(0, max);
}

// Kata penentu = token selain kata jenis (JENIS_WORDS). Permintaan yang isinya HANYA kata jenis ("SET") tidak punya penentu.
export function punyaPenentu(u) {
  return !!(u && u.tokens && u.tokens.some((t) => !JENIS_WORDS.has(t)));
}

// Query katalog TANPA kata jenis + p_tipe = kata jenis itu. null bila tak ada kata jenis atau tak ada token lain.
// Mis. "SET CAESAREAN" -> { q: 'CAESAREAN', tipe: 'SET' } (search_produk_dengan_harga butuh SEMUA kata cocok, padahal nama set di katalog tak memuat "SET").
export function queryTanpaJenis(u) {
  if (!u || !u.tokens) return null;
  const jenis = u.tokens.find((t) => JENIS_WORDS.has(t));
  const rest = u.tokens.filter((t) => !JENIS_WORDS.has(t));
  if (!jenis || !rest.length) return null;
  return { q: rest.join(' '), tipe: jenis };
}

// Query katalog bila staff sudah mengisi KONTEKS permintaan (SET / INSTRUMENT / UNIT): kata jenis dibuang dari query dan
// p_tipe = konteks, BUKAN kata di teks. "Set bein surgery" dengan konteks INSTRUMENT = bundle instrumen bein, bukan produk SET.
export function queryDenganKonteks(u, konteks) {
  if (!u || !u.tokens || !konteks) return null;
  const rest = u.tokens.filter((t) => !JENIS_WORDS.has(t));
  if (!rest.length) return null;
  return { q: rest.join(' '), tipe: konteks };
}

// Token mana di item ini yang dikenali lexicon (buat ditampilkan: "KORENTANG → SPONGE HOLDING FORCEPS (dari riwayat)").
export function lexiconHits(u, lexicon) {
  if (!lexicon || !lexicon.size) return [];
  return u.tokens.map((t) => lexicon.lookup(t)).filter(Boolean);
}