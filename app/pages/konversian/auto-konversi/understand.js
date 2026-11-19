// auto-konversi/understand.js
// ══════════════════════════════════════════
// PAHAMI deskripsi produk dari SUMBER MANA PUN — istilah customer ("klem bengkok"), deskripsi vendor
// ("MAYO OPERATING SCISSORS STR BL/BL 17CM."), maupun nama katalog sendiri
// ("OPERATING SCISSORS, SH/BL, STR., 16.5 CM") — ke bentuk yang SAMA:
//
//   { norm, inti, tokens, attrs: { ukuran_cm, mm[], orientasi, ujung, gigi, nomor, fig } }
//
//   attrs = hal yang MEMBEDAKAN varian dalam satu jenis produk (ukuran, ujung, bentuk, gigi, nomor).
//   inti/tokens = sisanya: JENIS + eponim + istilah aneh ("KORENTANG", "BABCOCK"). Modul ini sengaja TIDAK
//                 tahu arti kata-kata itu — pengetahuan jenis datang dari riwayat (lexicon.js), bukan dihardcode.
//
// Karena kedua sisi (permintaan & kandidat) lewat fungsi yang sama, membandingkan atribut tidak butuh
// kamus per-vendor: compareAttrs() cukup membandingkan hasil understand() kiri dan kanan.
//
// PURE: tanpa DOM / Supabase.
// ══════════════════════════════════════════
import { TYPO_FIXES } from './aliases.js';

const toNum = (s) => parseFloat(String(s).replace(',', '.'));
const spaces = (s) => String(s == null ? '' : s).replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();

// Kata ujung instrumen (gunting/klem): runcing vs tumpul. Pasangan dinormalkan: SH/SH, SH/BL, BL/BL (urutan SH dulu, seperti di katalog).
// (S/S sengaja TIDAK dikenali: itu lazimnya "stainless steel".)
const TIP = '(SH|SHARP|TAJAM|BL|BLUNT|TUMPUL)';
const TIP_PAIR = new RegExp(`\\b${TIP}\\s*[/\\-]\\s*${TIP}\\b|\\b(TAJAM|TUMPUL|SHARP|BLUNT)\\s+(TAJAM|TUMPUL|SHARP|BLUNT)\\b`);
const tipCode = (w) => (/^(SH|SHARP|TAJAM)$/.test(w) ? 'SH' : 'BL');

const ORIENT_STR = /\b(STR|STRAIGHT|LURUS)\b\.?/;
const ORIENT_CVD = /\b(CVD|CURVED|CURVE|MELENGKUNG|BENGKOK)\b\.?/;

export function understand(text) {
  let t = spaces(String(text == null ? '' : text).toUpperCase());
  for (const [re, rep] of TYPO_FIXES) t = t.replace(re, rep);
  const attrs = { ukuran_cm: null, ukuran_inferred: false, mm: [], orientasi: null, ujung: null, gigi: null, nomor: null, fig: null };
  let bengkokWord = false;
  const eat = (re, fn) => { const m = t.match(re); if (!m) return null; fn(m); t = spaces(t.slice(0, m.index) + ' ' + t.slice(m.index + m[0].length)); return m; };

  // desimal pakai koma ("14,5") → titik, supaya koma pemisah daftar ("SH/BL, STR.") tidak terganggu
  t = t.replace(/(\d),(\d)/g, '$1.$2');

  eat(/(\d+(?:\.\d+)?(?:\s*X\s*\d+(?:\.\d+)?)*)\s*MM\b\.?/, (m) => { attrs.mm = m[1].split(/\s*X\s*/).map(toNum); });
  if (!eat(/(\d+(?:\.\d+)?)\s*CM\b\.?/, (m) => { attrs.ukuran_cm = toNum(m[1]); })) {
    // "NEEDELHOLDER 14.5" — desimal polos di rentang panjang instrumen hampir pasti cm
    const bare = t.match(/(?:^|\s)(\d{1,2}\.\d)(?=\s|$)/);
    if (bare) {
      const v = toNum(bare[1]);
      if (v >= 8 && v <= 60) { attrs.ukuran_cm = v; attrs.ukuran_inferred = true; t = spaces(t.replace(bare[0], ' ')); }
    }
  }
  eat(TIP_PAIR, (m) => {
    const a = m[1] || m[3], b = m[2] || m[4];
    attrs.ujung = [tipCode(a), tipCode(b)].sort((x, y) => (x === 'SH' ? 0 : 1) - (y === 'SH' ? 0 : 1)).join('/');
  });
  eat(/\b(\d)\s*[:X]\s*(\d)\s*(?:T\b|TEETH|GIGI)/, (m) => { attrs.gigi = `${m[1]}:${m[2]}`; });
  eat(/\bFIG\.?\s*(\d+(?:\s*\+\s*\d+)*)/, (m) => { attrs.fig = m[1].replace(/\s+/g, ''); });
  eat(/\b(?:NO|NOMOR)\.?\s*(\d+)\b/, (m) => { attrs.nomor = parseInt(m[1], 10); });
  if (!eat(ORIENT_STR, () => { attrs.orientasi = 'lurus'; })) {
    eat(ORIENT_CVD, (m) => { attrs.orientasi = 'bengkok'; bengkokWord = m[1] === 'BENGKOK'; });
  }

  let tokens = t.replace(/[,;()]+/g, ' ').replace(/\s*\.\s*/g, ' ').split(/\s+/).filter((w) => w && /[A-Z0-9]/.test(w));

  // "BENGKOK" yang berdiri sendiri (tanpa kata jenis lain) adalah NAMA produk, bukan sifat bentuk.
  // Contoh: "KLEM BENGKOK" → jenis KLEM + orientasi bengkok; "BENGKOK" saja → istilah produk.
  if (bengkokWord && !tokens.length) { attrs.orientasi = null; tokens = ['BENGKOK']; }

  return { norm: spaces(String(text == null ? '' : text).toUpperCase()), inti: tokens.join(' '), tokens, attrs };
}

// ── Bandingkan atribut yang DIMINTA vs yang dimiliki KANDIDAT ──
// Hasil per atribut: cocok | dekat (ukuran saja) | beda | tak_ada (diminta tapi kandidat tidak menyebut) | tak_diminta
// `beda` = atribut PENENTU yang berselisih (bukan ukuran): ujung, orientasi, gigi, nomor, mm, fig.
export const DECISIVE = ['ujung', 'orientasi', 'gigi', 'nomor', 'mm', 'fig'];
const same = (a, b) => (Array.isArray(a) ? a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 0.01) : a === b);
const has = (v) => (Array.isArray(v) ? v.length > 0 : v != null);

export function compareAttrs(minta, ada) {
  const out = { per: {}, beda: [], tak_ada: [], ukuran: 'tidak_diminta', selisih: null, ukuran_ada: ada.ukuran_cm };
  for (const k of DECISIVE) {
    if (!has(minta[k])) { out.per[k] = 'tak_diminta'; continue; }
    if (!has(ada[k])) { out.per[k] = 'tak_ada'; out.tak_ada.push(k); continue; }
    if (same(minta[k], ada[k])) out.per[k] = 'cocok';
    else { out.per[k] = 'beda'; out.beda.push(k); }
  }
  if (minta.ukuran_cm != null) {
    if (ada.ukuran_cm == null) out.ukuran = 'tak_diketahui';
    else {
      out.selisih = Math.round(Math.abs(ada.ukuran_cm - minta.ukuran_cm) * 100) / 100;
      out.ukuran = out.selisih === 0 ? 'cocok' : out.selisih <= 0.5 ? 'dekat' : 'beda';
    }
  }
  return out;
}

const SHOW = { ujung: 'ujung', orientasi: 'bentuk', gigi: 'gigi', nomor: 'nomor', mm: 'mm', fig: 'fig' };
const fmt = (v) => (Array.isArray(v) ? v.join('×') : String(v));
// Daftar beda yang enak dibaca: ["ujung: minta BL/BL, produk SH/BL", ...]
export function describeDiff(minta, ada, fit) {
  return fit.beda.map((k) => `${SHOW[k]}: minta ${fmt(minta[k])}, produk ${fmt(ada[k])}`);
}
