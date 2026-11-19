// auto-konversi/parser.js
// ══════════════════════════════════════════
// TAHAP 1 — PARSE: teks permintaan RS (paste dari WA/Excel) -> daftar item terstruktur.
// PURE: tanpa DOM, tanpa Supabase, jadi bisa diuji di Node (lihat auto-konversi.test.mjs).
//
// Beda dengan parseTeksPermintaan() di permintaan-rs.js (yang tetap dipakai UI lama):
//   - paham paste dari Excel/Sheet (kolom dipisah TAB, ada spasi panjang sebelum qty)
//   - qty yang cuma "tebakan" (angka di ujung tanpa satuan/tab) diberi flag qty_ambiguous
//   - baris identik digabung (qty dijumlah) dan dilaporkan, bukan diam-diam dibuang
//   - tiap item dibekali spesifikasi (ukuran cm, lurus/bengkok, ...) + varian ejaan
//     buat dicari ke Dictionary
// ══════════════════════════════════════════
import { TYPO_FIXES, NOISE_WORDS } from './aliases.js';

const UNIT_WORDS = 'UNIT|SET|PCS|PC|BUAH|BOX|PAK|LUSIN|BH|ROLL';
const QTY_CELL = new RegExp(`^(\\d+)(?:\\s*(?:${UNIT_WORDS}))?\\.?$`, 'i');

export function cleanSpaces(s) {
  return String(s == null ? '' : s).replace(/ /g, ' ').replace(/[ \t]+/g, ' ').trim();
}
export function canon(s) {
  return cleanSpaces(s).toUpperCase();
}
const toNum = (s) => parseFloat(String(s).replace(',', '.'));

// "134 JT" -> 134000000, "150rb" -> 150000, "134.000.000" -> 134000000
export function parsePriceShorthand(str) {
  const m = String(str || '').trim().match(/^([\d.,]+)\s*(jt|juta|rb|ribu|k)?$/i);
  if (!m) return null;
  let val = parseInt(m[1].replace(/[.,]/g, ''), 10);
  if (isNaN(val)) return null;
  const suf = (m[2] || '').toLowerCase();
  if (suf === 'jt' || suf === 'juta') val *= 1e6;
  else if (suf === 'rb' || suf === 'ribu' || suf === 'k') val *= 1e3;
  return val;
}

function isNoise(nama) {
  const n = canon(nama).replace(/[.,;:]+$/, '');
  if (!n) return true;
  if (!/[A-Z]/.test(n)) return true; // cuma angka/simbol
  return NOISE_WORDS.has(n);
}

// ── Satu baris mentah -> { nama, qty, qty_source, qty_ambiguous, pagu_satuan, noise } ──
export function parseLine(rawLine) {
  let line = String(rawLine == null ? '' : rawLine).replace(/ /g, ' ');

  // nomor urut list ("1. ", "2) ") dan bullet WA — bukan qty
  line = line.replace(/^\s*\d+[.)]\s+/, '').replace(/^\s*[*\-•●▪‣·]+\s*/, '');

  // harga nempel "@ 134 JT"
  let pagu_satuan = null;
  const h = line.match(/@\s*([\d.,]+\s*(?:jt|juta|rb|ribu|k)?)/i);
  if (h) { pagu_satuan = parsePriceShorthand(h[1]); line = line.slice(0, h.index); }

  let qty = null, qty_source = null, qty_ambiguous = false, nama;

  if (line.includes('\t')) {
    // Paste dari Excel/Sheet: kolom dipisah TAB. Ini jalur paling pasti — qty = sel terakhir yang angka.
    const cells = line.split('\t').map(cleanSpaces).filter(Boolean);
    // Baris header tabel ("NO ⇥ NAMA BARANG ⇥ QTY"): tiap selnya kata noise -> seluruh baris noise.
    // (Digabung jadi "NO NAMA BARANG QTY" kata itu sudah tidak ada di daftar noise.)
    if (cells.length && cells.every(c => isNoise(c))) {
      return { nama: cells.join(' '), qty: null, qty_source: null, qty_ambiguous: false, pagu_satuan, noise: true };
    }
    if (cells.length >= 3 && /^\d+$/.test(cells[0])) cells.shift(); // kolom "No"
    const last = cells[cells.length - 1];
    const m = cells.length >= 2 ? last.match(QTY_CELL) : null;
    if (m) { qty = parseInt(m[1], 10); qty_source = 'tab'; cells.pop(); }
    nama = cleanSpaces(cells.join(' '));
  } else {
    nama = cleanSpaces(line);
    let m = nama.match(new RegExp(`(\\d+)\\s*(${UNIT_WORDS})\\b\\.?`, 'i'));
    if (m) {
      // "2 UNIT", "3 SET": angkanya menempel ke kata satuan -> yakin qty
      qty = parseInt(m[1], 10); qty_source = 'unit';
      nama = cleanSpaces(nama.slice(0, m.index) + ' ' + nama.slice(m.index + m[0].length));
    } else if ((m = nama.match(/^(\d+)\s*[xX]\s*(.+)$/))) {
      qty = parseInt(m[1], 10); qty_source = 'prefix'; nama = cleanSpaces(m[2]);
    } else if ((m = nama.match(/^(\d+)\s+(.+)$/))) {
      qty = parseInt(m[1], 10); qty_source = 'prefix'; qty_ambiguous = true; nama = cleanSpaces(m[2]);
    } else if ((m = nama.match(/^(.+?)\s+(\d+)$/))) {
      // "KLEM BENGKOK 20" — angka bulat di ujung tanpa satuan = qty (konvensi RS; ukuran selalu desimal/ber-cm).
      // Satu-satunya yang ditandai ambigu: angka setelah NO/FIG/UK/SIZE/# (itu nomor/ukuran, bukan qty).
      if (/(?:\b(?:NO|NOMOR|FIG|UK|UKURAN|SIZE|SZ|TYPE|TIPE)\.?|#)$/i.test(m[1])) {
        nama = cleanSpaces(line);
      } else {
        qty = parseInt(m[2], 10); qty_source = 'suffix'; nama = cleanSpaces(m[1]);
      }
    }
  }

  return { nama, qty, qty_source, qty_ambiguous, pagu_satuan, noise: isNoise(nama) };
}

// ── Spesifikasi yang bisa dibaca dari nama (dipakai buat mencocokkan ukuran) ──
export function extractSpecs(text) {
  const t = canon(text);
  const specs = { ukuran_cm: null, ukuran_inferred: false, mm: [], orientasi: null, panjang: false, teeth: null };

  const cm = t.match(/(\d+(?:[.,]\d+)?)\s*CM\b/);
  if (cm) {
    specs.ukuran_cm = toNum(cm[1]);
  } else {
    // "NEEDELHOLDER 14.5": desimal tanpa satuan di rentang panjang instrumen -> hampir pasti cm
    const bare = t.match(/(?:^|\s)(\d{1,2}[.,]\d)(?=\s|$)/);
    if (bare) {
      const v = toNum(bare[1]);
      if (v >= 8 && v <= 60) { specs.ukuran_cm = v; specs.ukuran_inferred = true; }
    }
  }

  const mm = t.match(/(\d+(?:[.,]\d+)?(?:\s*X\s*\d+(?:[.,]\d+)?)*)\s*MM\b/);
  if (mm) specs.mm = mm[1].split(/\s*X\s*/).map(toNum);

  if (/\b(STR|STRAIGHT|LURUS)\b/.test(t)) specs.orientasi = 'lurus';
  else if (/\b(CVD|CURVED|BENGKOK|MELENGKUNG)\b/.test(t)) specs.orientasi = 'bengkok';

  specs.panjang = /\b(PANJANG|LONG)\b/.test(t);

  const teeth = t.match(/(\d):(\d)\s*(?:T\b|TEETH)/);
  if (teeth) specs.teeth = `${teeth[1]}:${teeth[2]}`;
  return specs;
}

// ── Varian ejaan buat dicari ke Dictionary. Yang asli SELALU pertama. ──
export function buildVariants(nama) {
  const base = canon(nama);
  const out = [base];
  let fixed = base;
  for (const [re, rep] of TYPO_FIXES) fixed = fixed.replace(re, rep);
  fixed = cleanSpaces(fixed);
  if (fixed !== base) out.push(fixed);
  return out;
}

function enrich(item) {
  item.specs = extractSpecs(item.nama);
  item.variants = buildVariants(item.nama);
  return item;
}

// ── Parse teks permintaan utuh ──
// opts.merge (default FALSE): baris identik dibiarkan terpisah (bisa beda section/ukuran — lihat permintaan #382);
// merge:true menjumlahkan qty baris identik. Baris identik tetap diberi peringatan.
// Hasil: { items, skipped, warnings, totalQty }
export function parseRequestText(text, opts = {}) {
  const merge = opts.merge === true;
  const skipped = [];
  const parsed = [];

  String(text == null ? '' : text).split(/\r?\n/).forEach((raw, idx) => {
    if (!raw.trim()) return;
    const p = parseLine(raw);
    if (p.noise) { skipped.push({ line_no: idx + 1, raw: raw.trim() }); return; }
    parsed.push({ line_no: idx + 1, raw: raw.trim(), ...p });
  });

  const warnings = [];
  let items;
  if (merge) {
    const byKey = new Map();
    parsed.forEach(p => {
      const key = canon(p.nama);
      const cur = byKey.get(key);
      if (!cur) {
        byKey.set(key, { ...p, source_lines: [p.line_no], merged_count: 1 });
      } else {
        cur.qty = (cur.qty == null && p.qty == null) ? null : (cur.qty || 0) + (p.qty || 0);
        cur.qty_ambiguous = cur.qty_ambiguous || p.qty_ambiguous;
        cur.source_lines.push(p.line_no);
        cur.merged_count++;
      }
    });
    items = [...byKey.values()];
    items.filter(i => i.merged_count > 1).forEach(i =>
      warnings.push(`"${i.nama}" muncul ${i.merged_count}× (baris ${i.source_lines.join(', ')}) — digabung, total qty ${i.qty}. Cek kalau itu sebenarnya beda section/ukuran.`));
  } else {
    items = parsed.map(p => ({ ...p, source_lines: [p.line_no], merged_count: 1 }));
    const seen = new Map();
    items.forEach(i => { const k = canon(i.nama); (seen.get(k) || seen.set(k, []).get(k)).push(i); });
    seen.forEach(g => { if (g.length > 1) warnings.push(`"${g[0].nama}" muncul ${g.length}× (baris ${g.map(i => i.line_no).join(', ')}) — dibiarkan terpisah; kemungkinan beda ukuran/section.`); });
  }

  items.forEach(enrich);
  items.filter(i => i.qty_ambiguous).forEach(i =>
    warnings.push(`Qty "${i.nama}" = ${i.qty} cuma tebakan (angka di ujung tanpa satuan/kolom). Bisa jadi itu ukuran — cek.`));
  items.filter(i => i.qty == null).forEach(i =>
    warnings.push(`"${i.nama}" tidak punya qty.`));

  const totalQty = items.reduce((s, i) => s + (i.qty || 0), 0);
  return { items, skipped, warnings, totalQty };
}
