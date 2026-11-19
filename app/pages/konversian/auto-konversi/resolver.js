// auto-konversi/resolver.js
// ══════════════════════════════════════════
// TAHAP 2 — RESOLVE: item hasil parse -> usulan produk Robust + tingkat keyakinan.
//
// Tidak ada AI/embedding/fuzzy baru. Mesin pencocokannya SAMA dengan yang sudah dipakai
// Kebutuhan RS & Cari SET: RPC suggest_dictionary (riwayat istilah customer) — resolver
// ini cuma menambahkan (1) coba beberapa varian ejaan, (2) fallback ke katalog,
// (3) aturan keputusan AUTO / REVIEW / UNKNOWN.
//
// Prinsip: AUTO hanya kalau riwayat KUAT, TIDAK AMBIGU, dan ukuran cocok. Satu istilah
// customer yang pernah dipenuhi beberapa produk itu wajar (lihat new-feat-dictionary.md),
// jadi masuk REVIEW — bukan dianggap error dan bukan ditebak.
//
// `rpc` disuntikkan (S.rpc di app, mock di test) -> modul ini tidak tahu Supabase.
// Aturan pickBestCand/candConf SENGAJA disalin dari set-mendekati.js (di sana ada di dalam
// closure & tidak diekspor; modul lama tidak diubah).
// ══════════════════════════════════════════

const UKURAN_RANK = { cocok: 0, tidak_diminta: 0, tidak_diketahui: 1, dekat: 1, varian: 3, beda: 4 };
const CONF_RANK = { none: 0, lemah: 1, sedang: 2, kuat: 3 };

function candidatesFromRows(rows) {
  const seen = new Set();
  const out = [];
  (rows || []).forEach(r => {
    if (!r.kode_produk || seen.has(r.kode_produk)) return;
    seen.add(r.kode_produk);
    out.push({
      kode: r.kode_produk, nama: r.nama_produk || '', tier: r.tier || '', ukuran: r.ukuran || '',
      istilah: r.istilah || '', skor: Number(r.skor) || 0, freq: Number(r.freq) || 0, isSet: !!r.is_set,
      src: r.tier === 'katalog' ? 'katalog' : (r.tier === 'varian' ? 'varian' : 'riwayat')
    });
  });
  return out;
}

// Default hanya dari istilah dengan skor teratas (jangan loncat ke istilah umum "GUNTING"
// cuma karena ukurannya kebetulan cocok), lalu ukuran terbaik, bukan SET.
export function pickBestCand(cands) {
  if (!cands.length) return null;
  const top = cands[0].skor;
  const pool = cands.filter(c => c.skor === top && !c.isSet);
  const use = pool.length ? pool : cands;
  return use.slice().sort((a, b) =>
    (UKURAN_RANK[a.ukuran] ?? 2) - (UKURAN_RANK[b.ukuran] ?? 2) || b.freq - a.freq)[0];
}

export function candConf(c) {
  if (!c) return 'none';
  if (c.ukuran === 'beda' || c.ukuran === 'varian') return 'lemah';
  if (c.tier === 'exact' || c.tier === 'urutan') return 'kuat';
  if (c.tier === 'keluarga' || c.tier === 'katalog' || c.tier === 'varian') return 'sedang';
  return 'lemah';
}

// Keluarga produk dari kode: RB11-KE830-B014-U07 -> RB11-KE830 (B014 = ukuran 14 cm).
// SET (…-B99-…) bukan keluarga — satu kode = satu produk. Kode tanpa pola B…-U… = dirinya sendiri.
export function familyOf(kode, isSet) {
  const k = String(kode || '');
  if (isSet || /-B99-/.test(k)) return k;
  return k.replace(/-B[^-]*-U.*$/, '');
}

// Ambigu = istilah teratas pernah dipenuhi >1 KELUARGA berbeda DAN tidak ada yang dominan.
// Beda ukuran dalam keluarga yang sama BUKAN ambigu (keluarga pasti, ukuran diputuskan dari teks / default).
// Dominan = ≥ 70% pemakaian dan minimal 3×.
export function isAmbiguous(cands, best) {
  if (!best) return false;
  const sameTerm = cands.filter(c => c.istilah === best.istilah && c.src === 'riwayat');
  if (sameTerm.length <= 1) return false;
  const fam = new Map();
  sameTerm.forEach(c => { const f = familyOf(c.kode, c.isSet); fam.set(f, (fam.get(f) || 0) + c.freq); });
  if (fam.size <= 1) return false;
  const total = [...fam.values()].reduce((a, b) => a + b, 0);
  const top = fam.get(familyOf(best.kode, best.isSet));
  return !(top >= 3 && total > 0 && top / total >= 0.7);
}

// ── ukuran dari nama produk (buat fallback katalog; RPC dictionary sudah kasih label sendiri) ──
function sizeFromName(nama) {
  const m = /(\d+(?:[.,]\d+)?)\s*cm(?![a-z])/i.exec(nama || '');
  return m ? parseFloat(m[1].replace(',', '.')) : null;
}
function ukuranLabel(wanted, nama) {
  if (wanted == null) return 'tidak_diminta';
  const have = sizeFromName(nama);
  if (have == null) return 'tidak_diketahui';
  const d = Math.abs(have - wanted);
  return d === 0 ? 'cocok' : d <= 0.5 ? 'dekat' : 'beda';
}

async function viaDictionary(rpc, text) {
  const { data, error } = await rpc('suggest_dictionary', { p_text: text, p_limit: 3 });
  if (error) throw new Error(error.message || error.hint || 'suggest_dictionary gagal');
  return candidatesFromRows(data);
}

// Fallback: cari langsung ke katalog. Selalu 'katalog' tier -> paling banter 'sedang'.
async function viaCatalog(rpc, text, wantedCm) {
  const { data, error } = await rpc('search_produk_dengan_harga', { q: text, p_tipe: null, only_akd: false, only_kfa: false });
  if (error) throw new Error(error.message || error.hint || 'search_produk_dengan_harga gagal');
  return (data || []).slice(0, 6).map((p, i) => ({
    kode: p.kode_produk, nama: p.nama_produk || '', tier: 'katalog', ukuran: ukuranLabel(wantedCm, p.nama_produk),
    istilah: text, skor: 1 - i * 0.01, freq: 0, isSet: p.tipe === 'SET', src: 'katalog'
  }));
}

// ── Putuskan untuk SATU item ──
export async function resolveItem(item, rpc, opts = {}) {
  const queries = opts.queries || item.variants || [item.nama];
  const wantedCm = item.specs ? item.specs.ukuran_cm : null;
  const tried = [];
  let cands = [];
  let error = null;

  // Filter produk yang tidak boleh dipakai (belum firm / SINGLE USE / sudah dihapus) — opts.firmCheck, lihat firm.js.
  // Dipasang di SETIAP sumber kandidat sebelum dinilai, supaya produk terlarang tidak sempat jadi "terbaik"
  // dan menghentikan pencarian (break di loop Dictionary) sebelum kandidat yang boleh dipakai ketemu.
  const blocked = new Map();
  let unverified = false;
  const usable = async (list) => {
    if (!opts.firmCheck || !list.length) return list;
    try {
      const bl = await opts.firmCheck(list.map(x => x.kode));
      const keep = [];
      list.forEach(x => {
        if (bl.has(x.kode)) blocked.set(x.kode, { kode: x.kode, nama: x.nama, alasan: bl.get(x.kode) });
        else keep.push(x);
      });
      return keep;
    } catch (e) {
      unverified = true; error = error || `Status firm gagal dicek: ${e.message}`;
      return list; // jangan buang diam-diam; ditandai dan tidak boleh AUTO (lihat di bawah)
    }
  };

  // 1) Dictionary, per varian. Berhenti begitu ada kandidat dengan keyakinan 'kuat'.
  //    Hasil query berikutnya (lebih longgar) hanya menggantikan kalau keyakinannya LEBIH TINGGI —
  //    kalau sama atau lebih rendah, hasil dari query yang lebih spesifik dipertahankan.
  let bestRank = 0;
  for (const q of queries) {
    try {
      const c = await usable(await viaDictionary(rpc, q));
      tried.push({ q, via: 'dictionary', n: c.length });
      if (c.length) {
        const rank = CONF_RANK[candConf(pickBestCand(c))] || 0;
        if (rank > bestRank) { cands = c; bestRank = rank; }
        if (rank === CONF_RANK.kuat) break;
      }
    } catch (e) { error = e.message; tried.push({ q, via: 'dictionary', error: e.message }); }
  }

  // 2) Fallback katalog kalau Dictionary tidak menghasilkan apa-apa
  if (!cands.length && opts.catalogFallback !== false) {
    for (const q of queries) {
      try {
        const c = await usable(await viaCatalog(rpc, q, wantedCm));
        tried.push({ q, via: 'katalog', n: c.length });
        if (c.length) { cands = c; break; }
      } catch (e) { error = e.message; tried.push({ q, via: 'katalog', error: e.message }); }
    }
  }

  const best = pickBestCand(cands);
  const conf = candConf(best);
  let status, reason, ukuranDefault = false;

  if (!best) {
    status = 'UNKNOWN';
    if (blocked.size) {
      const b = [...blocked.values()];
      reason = `Produk yang cocok ada, tapi tidak boleh dipakai konversi: ${b.slice(0, 2).map(x => `${x.kode} (${x.alasan})`).join(', ')}${b.length > 2 ? `, +${b.length - 2} lagi` : ''}.`;
    } else {
      reason = error ? `Gagal mencari: ${error}` : 'Tidak ada di riwayat maupun katalog.';
    }
  } else if (conf !== 'kuat') {
    status = 'REVIEW';
    reason = best.ukuran === 'beda' || best.ukuran === 'varian' ? 'Produk ketemu tapi ukurannya beda.'
      : best.src === 'katalog' ? 'Hanya ketemu lewat pencarian katalog (belum pernah ada di riwayat).'
      : 'Kecocokan perkiraan, belum pernah dipakai persis.';
  } else if (isAmbiguous(cands, best)) {
    status = 'REVIEW';
    reason = `Istilah ini pernah dipenuhi beberapa jenis produk berbeda tanpa yang dominan — pilih yang sesuai.`;
  } else if (best.ukuran === 'dekat') {
    status = 'REVIEW'; reason = 'Ukuran dekat tapi tidak persis (selisih ≤ 0,5 cm).';
  } else if (unverified) {
    status = 'REVIEW'; reason = 'Status firm / SINGLE USE belum bisa dicek — cek manual sebelum dipakai.';
  } else if (blocked.size) {
    // Ada produk lain untuk istilah ini yang dibuang (belum firm / SINGLE USE): yang tersisa belum tentu
    // pengganti yang tepat, jadi jangan AUTO.
    status = 'REVIEW';
    reason = `Ada usulan lain yang dibuang (${[...blocked.values()].slice(0, 2).map(x => `${x.kode}: ${x.alasan}`).join(', ')}) — pastikan produk ini pengganti yang tepat.`;
  } else {
    status = 'AUTO';
    ukuranDefault = best.ukuran === 'tidak_diminta' && cands.some(c => c.kode !== best.kode && familyOf(c.kode, c.isSet) === familyOf(best.kode, best.isSet));
    reason = `Pernah dipakai persis${best.freq ? ` (${best.freq}×)` : ''}, ${ukuranDefault ? 'ukuran default (yang paling sering dipakai)' : 'ukuran cocok'}.`;
  }

  return {
    status, reason, confidence: conf, ukuran_default: ukuranDefault,
    family: best ? familyOf(best.kode, best.isSet) : null,
    kode_produk: best ? best.kode : null,
    nama_produk: best ? best.nama : null,
    candidates: cands.slice(0, 5),
    blocked: [...blocked.values()], unverified,
    tried
  };
}

// ── Banyak item, paralel terbatas (pola sama dengan resolveSetcariEntries) ──
export async function resolveItems(items, rpc, opts = {}) {
  const out = new Array(items.length);
  const queriesFor = opts.queriesFor || (() => null);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      const q = queriesFor(items[i]);
      out[i] = { item: items[i], hasil: await resolveItem(items[i], rpc, { ...opts, queries: q || undefined }) };
      if (opts.onProgress) opts.onProgress(i + 1, items.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency || 4, items.length) }, worker));
  return out;
}

export function summarize(results) {
  const n = { AUTO: 0, REVIEW: 0, UNKNOWN: 0 };
  let qtyAuto = 0, qtyAll = 0;
  results.forEach(r => {
    n[r.hasil.status]++;
    const q = r.item.qty || 0;
    qtyAll += q;
    if (r.hasil.status === 'AUTO') qtyAuto += q;
  });
  const total = results.length;
  return { ...n, total, pctAuto: total ? Math.round((n.AUTO / total) * 100) : 0, qtyAuto, qtyAll };
}