// auto-konversi/bandingkan.js
// ══════════════════════════════════════════
// PEMBANDING SELISIH — bahan tampilan "Diminta vs Usulan" di Kebutuhan RS.
//
// Membandingkan teks permintaan RS dengan nama produk usulan token demi token, lalu menandai HANYA yang
// berbeda supaya staff cukup melihat selisihnya, bukan membaca dua kalimat penuh:
//   'beda'   = sisi yang sama-sama menyebut hal sejenis (ukuran, ujung, bentuk, nomor) tapi nilainya berselisih.
//              Ditandai di KEDUA sisi: 17 cm (diminta) vs 17.5 (produk), BL/BL vs SH/BL.
//   'hilang' = kata di permintaan yang tidak ada di nama produk (mis. eponim "MAYO"). Hanya sisi permintaan.
//   kata tambahan di nama produk yang tidak diminta TIDAK ditandai: itu bukan selisih, hanya produknya lebih lengkap.
//
// Ini murni PRESENTASI. Keputusan AUTO / REVIEW / UNKNOWN tetap di resolver.js (understand.js + compareAttrs).
// PURE: tanpa DOM / Supabase, aman dites di Node.
// ══════════════════════════════════════════
import { TYPO_FIXES } from './aliases.js';

const SYN = {
  STRAIGHT: 'STR', LURUS: 'STR',
  CURVED: 'CVD', CURVE: 'CVD', MELENGKUNG: 'CVD', BENGKOK: 'CVD',
  ANGLED: 'ANG',
  SHARP: 'SH', TAJAM: 'SH', BLUNT: 'BL', TUMPUL: 'BL'
};
const TIP = '(?:SH|SHARP|TAJAM|BL|BLUNT|TUMPUL)';
const TIP_PAIR = new RegExp(`^(${TIP})[/-](${TIP})$`);
const UNITS = new Set(['CM', 'MM']);
const NAMA_KELAS = { size: 'ukuran', tip: 'ujung', orient: 'bentuk', nomor: 'nomor' };

const num = (s) => String(parseFloat(s));
const fixTypo = (w) => TYPO_FIXES.reduce((t, [re, rep]) => t.replace(re, rep), w);

// Satu kata → { pre, core, post, keys[], cls }. pre/post = tanda baca di tepi (hanya buat tampilan).
function parseWord(word) {
  const m = String(word).match(/^([(\[]*)(.*?)([),;.\]]*)$/);
  const pre = m[1], core = m[2], post = m[3];
  const up = fixTypo(core.toUpperCase());
  let keys = [], cls = null, mm;
  if (!/[A-Z0-9]/.test(up)) return { pre, core, post, keys, cls };
  if ((mm = up.match(/^(\d+(?:\.\d+)?)(CM|MM)$/))) { keys = [num(mm[1]), mm[2]]; cls = 'size'; }
  else if ((mm = up.match(TIP_PAIR))) {
    const [a, b] = [SYN[mm[1]] || mm[1], SYN[mm[2]] || mm[2]].sort((x, y) => (x === 'SH' ? 0 : 1) - (y === 'SH' ? 0 : 1));
    keys = [`${a}/${b}`]; cls = 'tip';
  }
  else if ((mm = up.match(/^(NO|NOMOR)\.?(\d+)$/))) { keys = ['NO', num(mm[2])]; cls = 'nomor'; }
  else if (/^\d+(?:\.\d+)?$/.test(up)) keys = [num(up)];
  else {
    const k = SYN[up] || up;
    keys = [k];
    if (k === 'STR' || k === 'CVD' || k === 'ANG') cls = 'orient';
  }
  return { pre, core, post, keys, cls };
}

export function tokenize(teks) {
  const toks = String(teks == null ? '' : teks).replace(/(\d),(\d)/g, '$1.$2').split(/\s+/).filter(Boolean).map(parseWord);
  // angka polos: kelas ditentukan tetangganya ("17.5 CM" → ukuran, "NO. 3" → nomor)
  toks.forEach((t, i) => {
    if (t.cls || t.keys.length !== 1 || !/^\d+(?:\.\d+)?$/.test(t.keys[0])) return;
    const next = toks[i + 1], prev = toks[i - 1];
    if (next && next.keys.length === 1 && UNITS.has(next.keys[0])) t.cls = 'size';
    else if (prev && prev.keys.length === 1 && prev.keys[0] === 'NO') t.cls = 'nomor';
  });
  return toks;
}

const bagOf = (toks) => new Set(toks.flatMap((t) => t.keys.filter((k) => !UNITS.has(k))));
const adaDi = (t, bag) => t.keys.filter((k) => !UNITS.has(k)).every((k) => bag.has(k));
const nilai = (toks) => toks.map((t) => t.pre + t.core + t.post).join(' ').replace(/[,;]+$/g, '').trim();

// diminta & produk: teks bebas. Hasil: token tampilan + tandanya, dan daftar selisih untuk tooltip.
export function bandingkan(diminta, produk) {
  const a = tokenize(diminta), b = tokenize(produk);
  const bagA = bagOf(a), bagB = bagOf(b);
  const selisih = new Map(); // kelas -> { minta:[token], ada:[token] }
  const catat = (kelas, sisi, t) => {
    if (!selisih.has(kelas)) selisih.set(kelas, { minta: [], ada: [] });
    selisih.get(kelas)[sisi].push(t);
  };
  const tandaiA = a.map((t) => {
    if (!t.keys.length || adaDi(t, bagB)) return { ...t, mark: null };
    if (t.cls && b.some((x) => x.cls === t.cls)) { catat(t.cls, 'minta', t); return { ...t, mark: 'beda' }; }
    return { ...t, mark: 'hilang' };
  });
  const tandaiB = b.map((t) => {
    if (!t.keys.length || adaDi(t, bagA)) return { ...t, mark: null };
    if (t.cls && a.some((x) => x.cls === t.cls)) { catat(t.cls, 'ada', t); return { ...t, mark: 'beda' }; }
    return { ...t, mark: null };
  });
  const ringkas = [...selisih].map(([kelas, v]) => ({
    kelas, nama: NAMA_KELAS[kelas] || kelas, minta: nilai(v.minta), ada: nilai(v.ada)
  }));
  return { diminta: tandaiA, produk: tandaiB, selisih: ringkas, adaBeda: ringkas.length > 0 };
}

// Token → HTML. `esc` disuntikkan (escapeHtmlAttr dari permintaan-rs.js) supaya modul ini tidak tahu soal DOM.
// Teks bebas hasil paste/OCR: SELALU lewat esc (lihat catatan stored XSS di permintaan-rs.js).
export function tokensToHtml(tokens, esc, judulBeda) {
  return tokens.map((t) => {
    const isi = `${esc(t.pre)}${esc(t.core)}${esc(t.post)}`;
    if (!t.mark) return isi;
    const judul = t.mark === 'beda' ? (judulBeda || 'Beda dari yang diminta') : 'Tidak ada di nama produk';
    return `${esc(t.pre)}<span class="kb-tok ${t.mark}" title="${esc(judul)}">${esc(t.core)}</span>${esc(t.post)}`;
  }).join(' ');
}