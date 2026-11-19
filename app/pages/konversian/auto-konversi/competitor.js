// auto-konversi/competitor.js
// ══════════════════════════════════════════
// END-GAME (tahap PoC): baca daftar isi SET kompetitor (mis. katalog Falcon, hasil
// pdftotext -layout) -> item terstruktur -> query pencarian ke katalog kita.
//
// Beda mendasar dengan permintaan RS: kode kompetitor TIDAK ada di database kita, dan
// Dictionary (riwayat istilah customer) tidak kenal istilah katalog kompetitor. Jadi
// pencocokannya lewat NAMA JENIS + EPONIM + UKURAN (Kelly 14 cm, Metzenbaum 14.5 cm, ...),
// dan hasilnya SELALU masuk antrian review — bukan auto-accept.
//
// PURE: tanpa DOM / Supabase.
// ══════════════════════════════════════════
import { canon, cleanSpaces, extractSpecs, buildVariants } from './parser.js';
import { GENERIC_WORDS, GLOSSARY_EN_ID } from './aliases.js';

// Format baris katalog: "<no>  <kode-kompetitor>  <deskripsi>  <qty>"
//   5    06-175-14   METZENBAUM DISSECTING SCISSORS CVD BL/BL 14.5CM.   2
const ROW_WITH_CODE = /^\s*(\d+)\s+([0-9A-Z]{2,}(?:-[0-9A-Z]+){1,})\s+(.+?)\s+(\d+)\s*$/;
// Cadangan tanpa kolom kode: "<no>  <deskripsi>  <qty>"
const ROW_NO_CODE = /^\s*(\d+)\s+(.+?)\s+(\d+)\s*$/;

// Buang token yang bukan "identitas" instrumen (ukuran, lurus/bengkok, gigi, fig.) -> inti nama.
export function coreName(deskripsi) {
  let s = canon(deskripsi);
  s = s.replace(/\bFIG\.?\s*[\d+]+/g, ' ')
       .replace(/\d+(?:[.,]\d+)?(?:\s*X\s*\d+(?:[.,]\d+)?)*\s*(?:CM|MM)\b\.?/g, ' ')
       .replace(/\b\d:\d\s*(?:TEETH|T)\b/g, ' ')
       .replace(/\bBL\/BL\b|\bSTR\b|\bCVD\b|\bWIDTH\b/g, ' ')
       .replace(/\bNO\.?\s*\d+\b/g, ' ')   // "NO.3" pada scalpel handle = nomor bilah, simpan di specs, bukan di inti nama
       .replace(/\/?\s*\b(?:CHARR?|FR)\.?\s*\d+\b/g, ' ')   // ukuran Charrière suction tube ("10MM/CHARR 30")
       .replace(/\b\d+\s*X\s*\d+(?:\s*X\s*\d+)?\b/g, ' ')    // dimensi tanpa satuan ("360X180X80" pada case)
       .replace(/[().,]/g, ' ');
  return cleanSpaces(s);
}

// Pisahkan eponim (nama orang: KELLY, ADSON, MAYO-HEGAR, ...) dari kata jenis generik.
export function splitEponym(core) {
  const tokens = core.split(' ').filter(Boolean);
  const eponim = tokens.filter(t => !GENERIC_WORDS.has(t) && !/^\d/.test(t));
  const jenis = tokens.filter(t => GENERIC_WORDS.has(t));
  return { eponim: eponim.join(' '), jenis: jenis.join(' ') };
}

function translateJenis(text) {
  let t = text;
  for (const [re, rep] of GLOSSARY_EN_ID) t = t.replace(re, rep);
  return cleanSpaces(t);
}

// Query berurutan dari paling spesifik ke paling longgar, siap dikirim ke
// suggest_dictionary / search_produk_dengan_harga. Resolver berhenti di query pertama yang menghasilkan.
export function competitorQueries(item) {
  const { eponim, jenis } = splitEponym(item.core);
  const uk = item.specs.ukuran_cm != null ? `${item.specs.ukuran_cm} CM` : '';
  const mm = item.specs.mm.length ? `${item.specs.mm.join(' X ')} MM` : '';
  const q = [];
  const push = (s) => { s = cleanSpaces(s); if (s && !q.includes(s)) q.push(s); };

  // Dimensi mm (lebar spatula 30 vs 40 mm, ukuran bilah retractor) membedakan SKU yang cm-nya sama.
  if (mm) push(`${item.core} ${mm} ${uk}`);         // "ABDOMINAL SPATULA FLEXIBLE 30 MM 33 CM"
  push(`${item.core} ${uk}`);                       // "KELLY ARTERY FORCEPS 14 CM"
  push(`${eponim} ${translateJenis(jenis)} ${uk}`); // "KELLY KLEM ARTERI 14 CM"
  push(`${eponim} ${uk}`);                          // "KELLY 14 CM"
  push(item.core);
  if (eponim) push(eponim);
  return q;
}

// ── Parse teks katalog kompetitor utuh ──
// Hasil: { setName, items, totalQtyDeclared, totalQtyParsed, checks, unparsed }
export function parseCompetitorSet(text) {
  const lines = String(text == null ? '' : text).split(/\r?\n/);
  const items = [];
  const unparsed = [];
  let setName = null;
  let totalQtyDeclared = null;

  lines.forEach((raw) => {
    const line = raw.replace(/\u00a0/g, ' ');
    if (!line.trim()) return;

    let m = line.match(ROW_WITH_CODE);
    let kode = null, no, desc, qty;
    if (m) { no = +m[1]; kode = m[2]; desc = m[3]; qty = +m[4]; }
    else if ((m = line.match(ROW_NO_CODE)) && /[A-Za-z]{3,}/.test(m[2])) { no = +m[1]; desc = m[2]; qty = +m[3]; }
    else {
      const t = line.trim();
      // Header kolom tabel & judul set yang diulang di tiap halaman PDF: bukan data, bukan "gagal baca"
      if (/^NO\s+\S+\s+DESCRIPTION\s+QTY$/i.test(cleanSpaces(t)) || (setName && cleanSpaces(t) === setName)) return;
      // Judul set: baris huruf besar pertama yang memuat kata SET (muncul di header tiap halaman — ambil yang pertama)
      if (!setName && /\bSET\b/i.test(t) && !/@/.test(t) && /^[A-Z0-9 &/().,-]+$/.test(t)) { setName = cleanSpaces(t); return; }
      // Total qty di bawah tabel: baris yang isinya HANYA satu angka
      if (/^\d+$/.test(t) && totalQtyDeclared == null && items.length) { totalQtyDeclared = +t; return; }
      unparsed.push(t);
      return;
    }

    desc = cleanSpaces(desc);
    const it = {
      no, kode_kompetitor: kode, deskripsi: desc, qty,
      core: coreName(desc),
      specs: extractSpecs(desc),
      variants: buildVariants(desc)
    };
    it.queries = competitorQueries(it);
    items.push(it);
  });

  const totalQtyParsed = items.reduce((s, i) => s + i.qty, 0);
  const checks = [];
  if (totalQtyDeclared != null) {
    checks.push(totalQtyDeclared === totalQtyParsed
      ? { ok: true, msg: `Total qty cocok dengan total di dokumen (${totalQtyParsed}).` }
      : { ok: false, msg: `Total qty hasil parse ${totalQtyParsed} ≠ total di dokumen ${totalQtyDeclared} — ada baris yang salah baca.` });
  } else {
    checks.push({ ok: null, msg: 'Dokumen tidak mencantumkan total qty, jadi tidak bisa dicek silang.' });
  }
  const nos = items.map(i => i.no);
  const gaps = [];
  for (let i = 1; i <= Math.max(0, ...nos); i++) if (!nos.includes(i)) gaps.push(i);
  checks.push(gaps.length
    ? { ok: false, msg: `Nomor urut bolong: ${gaps.join(', ')} — baris itu mungkin gagal terbaca.` }
    : { ok: true, msg: `Nomor urut 1..${Math.max(0, ...nos)} lengkap.` });

  return { setName, items, totalQtyDeclared, totalQtyParsed, checks, unparsed };
}
