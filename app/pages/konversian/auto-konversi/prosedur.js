// auto-konversi/prosedur.js
// ══════════════════════════════════════════
// Atribut PROSEDUR untuk SET, diturunkan dari nama set — tanpa daftar alias di kode.
//   prosedur  : inti kanonik (MINOR, LAPAROTOMY, SECTIO CAESAREAN)
//   kualifier : pembeda di dalam prosedur (VAGINAL, THT, MATA, PEDIATRIC, AKRETA …) — kosong = set "umum"
//   tier      : basic / standar / complete / inst / kit        (BASIC, COMPLETE, INST(RUMENT)(S), KIT dibuang dari inti)
//   nomor     : "S. 3" -> 3
// Brand BUKAN bagian dari sini (kolom produk.brand; konversi selalu 1 brand — lihat resolver.js).
//
// Cara belajar dari katalog sendiri:
//   1. Kata yang cuma beda ejaan (edit distance kecil, kata panjang) dilebur ke bentuk yang paling sering muncul.
//   2. Yang tidak bisa ditebak dari ejaan (sinonim/singkatan) datang dari data: `sinonim` { DARI: 'KE KATA' } (tabel prosedur_sinonim).
//   3. Prosedur "mandiri" = inti yang berdiri sendiri di katalog. Nama yang memuat prosedur mandiri lebih pendek = prosedur + kualifier
//      (MAYOR VAGINAL -> MAYOR + VAGINAL). Kepala nama (kata pertama) menang bila ada dua kandidat. Gabungan "A & B" tetap satu prosedur.
//   4. Isi dalam tanda kurung ikut jadi kualifier (BASIC MINOR MATA (MINOR EYE), MINOR SURGERY (OPHTALMOLOGY)) supaya tidak bocor ke yang umum.
// Murni (tanpa DOM/Supabase). Indeks dibangun sekali dari daftar set { kode, nama }.
// ══════════════════════════════════════════

import { JENIS_WORDS } from './aliases.js';

const TIER = { BASIC: 'basic', COMPLETE: 'complete', KIT: 'kit', INST: 'inst', INSTRUMENT: 'inst', INSTRUMENTS: 'inst', INSTS: 'inst', INTRUMENTS: 'inst' };
const FILLER = new Set(['SURGERY']);

const bersih = (s) => String(s == null ? '' : s).toUpperCase().replace(/[.,/]/g, ' ').replace(/\bAND\b/g, '&').replace(/\s+/g, ' ').trim();
const kata = (s) => bersih(s).split(' ').filter(Boolean);

// Nama set / teks permintaan -> { nomor, tier, toks (inti), extra (isi kurung) }.
export function uraiNama(teks) {
  const parenToks = [];
  let s = String(teks == null ? '' : teks).toUpperCase().replace(/\(([^)]*)\)/g, (m, x) => { parenToks.push(...kata(x)); return ' '; });
  s = bersih(s);
  let nomor = null;
  s = s.replace(/\s+(AS|SP|S)\s*(\d+)?(\s+.*)?$/, (m, suf, n, rest) => { nomor = n ? Number(n) : null; return rest || ''; }).trim();
  s = s.replace(/\s+SET$/, '');
  let tier = null;
  const buang = (t) => { if (TIER[t]) { tier = tier || TIER[t]; return true; } return FILLER.has(t) || JENIS_WORDS.has(t); };
  const toks = s.split(' ').filter(Boolean).filter((t) => !buang(t));
  const extra = parenToks.filter((t) => !buang(t));
  return { nomor, tier: tier || 'standar', toks, extra };
}

export const lev = (a, b) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
};

// Kata yang beda ejaan dilebur ke yang paling sering muncul. Kata pendek hanya boleh beda 1 huruf.
function petaEjaan(parsed) {
  const freq = new Map();
  parsed.forEach((r) => r.toks.forEach((t) => freq.set(t, (freq.get(t) || 0) + 1)));
  const words = [...freq.keys()].filter((w) => w.length >= 7).sort((a, b) => freq.get(b) - freq.get(a) || a.localeCompare(b));
  const peta = new Map();
  const kanon = [];
  words.forEach((w) => {
    const hit = kanon.find((c) => c[0] === w[0] && lev(c, w) <= (Math.min(c.length, w.length) >= 8 ? 2 : 1));
    if (hit) peta.set(w, hit); else { peta.set(w, w); kanon.push(w); }
  });
  return peta;
}

const kunciDari = (prosedur, kualifier) => prosedur + (kualifier ? ' + ' + kualifier : '');

export function buatIndeks(rows, sinonim = {}) {
  const parsed = (rows || []).filter((r) => r && r.kode && r.nama).map((r) => ({ kode: r.kode, nama: r.nama, ...uraiNama(r.nama) }));
  const ejaan = petaEjaan(parsed);
  const kanon = (toks) => toks.map((t) => ejaan.get(t) || t).flatMap((t) => (sinonim[t] ? String(sinonim[t]).toUpperCase().split(' ') : [t]));
  parsed.forEach((r) => { r.toks = kanon(r.toks); r.extra = kanon(r.extra); });
  const mandiri = new Set(parsed.map((r) => r.toks.join(' ')).filter(Boolean));

  const klasifikasi = (toks, extra) => {
    const inti = toks.join(' ');
    let prosedur = inti, rem = [];
    if (!toks.includes('&')) {
      const subs = [...mandiri].filter((m) => m !== inti && m.split(' ').every((t) => toks.includes(t)));
      subs.sort((a, b) => (b.split(' ').includes(toks[0]) - a.split(' ').includes(toks[0])) || b.length - a.length); // kepala nama menang, lalu terpanjang
      if (subs.length) { prosedur = subs[0]; const p = new Set(subs[0].split(' ')); rem = toks.filter((t) => !p.has(t)); }
    }
    const core = new Set([...prosedur.split(' '), ...rem]);
    const kualifier = [...rem, ...extra.filter((t) => !core.has(t))].join(' ');
    return { prosedur, kualifier, kunci: kunciDari(prosedur, kualifier) };
  };

  const info = new Map();
  const grup = new Map();
  parsed.forEach((r) => {
    const k = klasifikasi(r.toks, r.extra);
    const v = { kode: r.kode, nama: r.nama, tier: r.tier, nomor: r.nomor, ...k };
    info.set(r.kode, v);
    if (!grup.has(k.kunci)) grup.set(k.kunci, []);
    grup.get(k.kunci).push(v);
  });

  return {
    size: parsed.length,
    info: (kode) => info.get(kode) || null,
    anggota: (kunci) => (grup.get(kunci) || []).slice(),
    // Teks permintaan ("SET MINOR", "MAYOR VAGINAL") -> { prosedur, kualifier, kunci } bila ada di katalog; selain itu null.
    cari: (teks) => {
      const u = uraiNama(teks);
      const toks = kanon(u.toks);
      if (!toks.length) return null;
      const k = klasifikasi(toks, kanon(u.extra));
      return grup.has(k.kunci) ? k : null;
    },
    daftar: () => [...grup].map(([kunci, v]) => ({ kunci, n: v.length })).sort((a, b) => a.kunci.localeCompare(b.kunci)),
  };
}
