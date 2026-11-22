// auto-konversi/jangkar.js
// ══════════════════════════════════════════
// "Jangkar": produk yang SUDAH DIPILIH staf untuk satu item -> tawarkan saudara se-prosedur sebagai bundle.
//
// Beda dengan bundle resolver.js (buildBundle):
//   - Pemicunya keputusan staf, bukan klasifikasi mesin. Permintaan yang typo / REVIEW / "perkiraan" tetap dapat tawaran
//     begitu staf memilih produknya ("Sectio caesarian set" -> SECTIO CAESAREAN S. -> tawarkan semua set Sectio Caesarean).
//   - Sumbernya indeks prosedur (prosedur.js: kunci = prosedur + kualifier), bukan hanya riwayat Dictionary.
//     Kualifier menjaga batas: jangkar MINOR tidak menyeret MINOR VAGINAL.
//   - FIRM SAJA: tawaran hanya berisi produk yang benar-benar bisa dijual (brand sama, link V6 bersih, AKD asli, bukan SINGLE USE).
//     Yang tidak lolos TIDAK ditawarkan sama sekali (tidak ada baris terkunci/abu-abu); hanya dihitung di `disembunyikan` supaya
//     staf tahu ada yang disaring. Sumber status firm = kolom firm/brand dari view v_produk_varian yang ikut di indeks
//     (supabase/2026-11-22_varian_produk.sql), jadi chip "+N set lain" dan panel memakai angka yang sama, tanpa RPC per klik.
//     Anggota tanpa info firm (indeks lama / test) tetap lewat opts.cek (async) seperti sebelumnya.
//   - Kecocokan spesifikasi (ukuran/ujung/...) bukan soal firm: yang bentrok tetap tampil tapi tidak tercentang, dengan alasannya.
//   - Tidak pernah dipasang otomatis: ini tawaran, staf yang mencentang dan mengklik.
//
// Murni (tanpa DOM/Supabase). Pengecekan brand/firm disuntik lewat opts.cek.
// ══════════════════════════════════════════

import { understand, compareAttrs, describeDiff, DECISIVE } from './understand.js';

export const JANGKAR_MAX = 20;
const TIER_URUT = { basic: 0, standar: 1, complete: 2, inst: 3, kit: 4 };
export const TIER_LABEL = { basic: 'Basic', standar: 'Standar', complete: 'Complete', inst: 'Instrument', kit: 'Kit' };

const urutSaudara = (a, b) =>
  (TIER_URUT[a.tier] ?? 9) - (TIER_URUT[b.tier] ?? 9)
  || (a.nomor == null ? 0 : a.nomor) - (b.nomor == null ? 0 : b.nomor)
  || String(a.nama).localeCompare(String(b.nama));

// Permintaan menyebut spesifikasi penentu (ukuran/ujung/nomor/...)? Kalau ya, saudara yang bentrok tidak dicentang.
export function adaSpesifik(itemAttrs) {
  if (!itemAttrs) return false;
  const hasVal = (v) => (Array.isArray(v) ? v.length > 0 : v != null);
  return itemAttrs.ukuran_cm != null || DECISIVE.some((k) => hasVal(itemAttrs[k]));
}

// Layak ditawarkan? Hanya memakai info yang ikut di indeks (firm/brand dari v_produk_varian). Info tidak ada (undefined) = belum
// diketahui -> lolos di sini, dicek lewat opts.cek di susunTawaran. firm === false atau brand beda = tidak layak.
export function layakDitawarkan(m, { brand, hanyaFirm = true } = {}) {
  if (hanyaFirm && m.firm === false) return { ok: false, alasan: m.firmAlasan || 'Belum firm.' };
  const target = brand ? String(brand).trim().toUpperCase() : '';
  if (target && m.brand !== undefined) {
    const b = String(m.brand == null ? '' : m.brand).trim().toUpperCase();
    if (b !== target) return { ok: false, alasan: `Brand ${b || '(kosong)'}, konversi ini ${target}.` };
  }
  return { ok: true, alasan: null };
}

// Sinkron & murah (tanpa RPC): saudara se-prosedur dari produk jangkar. Dipakai untuk chip "+N set lain".
// terpakai: Set kode yang sudah dipakai item LAIN di permintaan yang sama (ditandai, tidak dibuang).
// brand / hanyaFirm: saringan firm (lihat layakDitawarkan). Yang tersaring masuk `disembunyikan`, bukan `saudara`.
// Mengembalikan null bila jangkar bukan set berprosedur atau tidak punya saudara yang layak.
export function saudaraJangkar(kodeJangkar, pros, { terpakai, brand, hanyaFirm } = {}) {
  if (!kodeJangkar || !pros) return null;
  const info = pros.info(kodeJangkar);
  if (!info) return null;
  const saudara = [], disembunyikan = [];
  pros.anggota(info.kunci)
    .filter((m) => m.kode !== kodeJangkar)
    .sort(urutSaudara)
    .forEach((m) => {
      const l = layakDitawarkan(m, { brand, hanyaFirm: hanyaFirm !== false });
      if (l.ok) saudara.push({ ...m, terpakai: !!(terpakai && terpakai.has(m.kode)) });
      else disembunyikan.push({ kode: m.kode, nama: m.nama, alasan: l.alasan });
    });
  if (!saudara.length) return null;
  return { kunci: info.kunci, prosedur: info.prosedur, kualifier: info.kualifier, jangkar: info, saudara, disembunyikan };
}

// Jumlah saudara yang layak ditawarkan (belum dipakai item lain). 0 = tidak ada tawaran.
export function hitungSaudara(kodeJangkar, pros, opts) {
  const s = saudaraJangkar(kodeJangkar, pros, opts);
  return s ? s.saudara.filter((m) => !m.terpakai).length : 0;
}

// Susun tawaran lengkap. opts:
//   itemAttrs : atribut permintaan (understand().attrs + ukuran_cm)
//   terpakai  : Set kode yang dipakai item lain
//   brand     : brand konversi (ROBUST/ADLER); hanyaFirm: false = mode Swasta (tidak disaring firm)
//   cek       : async (kodes) => Map(kode -> { ok, alasan, terkunci }) — HANYA dipanggil untuk anggota yang info firm-nya belum ada
//               di indeks. Boleh melempar -> gagal tertutup.
//   max       : batas jumlah opsi (default JANGKAR_MAX, jangkar dihitung)
// Hasil: { kunci, prosedur, kualifier, jangkar, belumDicek, terpotong, disembunyikan:[{kode,nama,alasan}], opsi:[{kode,nama,tier,nomor,jangkar,pilih,terkunci,alasan}] } | null
export async function susunTawaran(kodeJangkar, pros, opts = {}) {
  const sd = saudaraJangkar(kodeJangkar, pros, { terpakai: opts.terpakai, brand: opts.brand, hanyaFirm: opts.hanyaFirm });
  if (!sd) return null;
  const max = opts.max || JANGKAR_MAX;
  const dipotong = Math.max(0, sd.saudara.length + 1 - max);
  const saudara = sd.saudara.slice(0, Math.max(0, max - 1));

  let cek = new Map();
  let belumDicek = false;
  const perluCek = saudara.filter((m) => m.firm === undefined);
  if (opts.cek && perluCek.length) {
    try { cek = (await opts.cek(perluCek.map((m) => m.kode))) || new Map(); }
    catch (_) { belumDicek = true; }
  }

  const spesifik = adaSpesifik(opts.itemAttrs);
  const opsi = [{
    kode: sd.jangkar.kode, nama: sd.jangkar.nama, tier: sd.jangkar.tier, nomor: sd.jangkar.nomor,
    jangkar: true, pilih: true, terkunci: true, alasan: null
  }];
  saudara.forEach((m) => {
    let pilih = true, terkunci = false, alasan = null;
    const c = cek.get(m.kode);
    if (belumDicek && m.firm === undefined) { pilih = false; alasan = 'Status brand/firm belum bisa dicek — cek manual.'; }
    else if (c && c.ok === false) { pilih = false; terkunci = !!c.terkunci; alasan = c.alasan || 'Tidak siap dipakai.'; }
    if (pilih && m.terpakai) { pilih = false; alasan = 'Sudah dipakai di kebutuhan lain pada permintaan ini.'; }
    if (pilih && spesifik) {
      const attrs = understand(m.nama).attrs;
      const fit = compareAttrs(opts.itemAttrs, attrs);
      if (fit.beda.length) { pilih = false; alasan = `Spesifikasi beda — ${describeDiff(opts.itemAttrs, attrs, fit).join('; ')}.`; }
    }
    opsi.push({ kode: m.kode, nama: m.nama, tier: m.tier, nomor: m.nomor, jangkar: false, pilih, terkunci, alasan });
  });

  return { kunci: sd.kunci, prosedur: sd.prosedur, kualifier: sd.kualifier, jangkar: sd.jangkar, belumDicek: belumDicek && perluCek.length > 0, terpotong: dipotong, disembunyikan: sd.disembunyikan, opsi };
}

// Label singkat tier + nomor untuk daftar: "Basic S.2", "Complete", "Standar".
export function labelOpsi(o) {
  const t = TIER_LABEL[o.tier] || o.tier || '';
  return o.nomor != null ? `${t} S.${o.nomor}` : t;
}
