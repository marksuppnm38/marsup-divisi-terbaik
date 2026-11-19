// auto-konversi/resolver.js
// ══════════════════════════════════════════
// TAHAP 2 — RESOLVE: item hasil parse -> usulan produk Robust + tingkat keyakinan.
//
// Tidak ada AI/embedding/fuzzy baru. Sumber kandidat: (1) RPC suggest_dictionary (riwayat istilah customer),
// (2) pencarian katalog lewat tangga query dari understand() + lexicon hasil riwayat (lexicon.js).
// Tiap kandidat DINILAI per atribut (understand.js: ukuran, ujung, bentuk, gigi, nomor, mm) — kandidat yang
// berselisih di atribut penentu tidak boleh AUTO dan alasan REVIEW-nya menyebut atribut yang mana.
// Aturan keputusan AUTO / REVIEW / UNKNOWN di bawah.
//
// Prinsip: AUTO hanya kalau riwayat KUAT, TIDAK AMBIGU, dan ukuran cocok. Satu istilah
// customer yang pernah dipenuhi beberapa produk itu wajar (lihat new-feat-dictionary.md),
// jadi masuk REVIEW — bukan dianggap error dan bukan ditebak.
//
// `rpc` disuntikkan (S.rpc di app, mock di test) -> modul ini tidak tahu Supabase.
// Aturan pickBestCand/candConf SENGAJA disalin dari set-mendekati.js (di sana ada di dalam
// closure & tidak diekspor; modul lama tidak diubah).
// ══════════════════════════════════════════

import { understand, compareAttrs, describeDiff } from './understand.js';
import { buildQueryLadder, lexiconHits } from './lexicon.js';

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

// Riwayat yang kuat DAN berulang (≥3×): staff berkali-kali memutuskan begitu, termasuk kalau spesifikasinya
// tampak beda (kesetaraan yang sudah dipelajari). Selain itu, beda atribut penentu = tidak yakin.
const riwayatBerulang = (c) => (c.tier === 'exact' || c.tier === 'urutan') && (c.freq || 0) >= 3;
const attrBeda = (c) => !!(c && c.fit && c.fit.beda.length);

export function candConf(c) {
  if (!c) return 'none';
  if (c.ukuran === 'beda' || c.ukuran === 'varian') return 'lemah';
  if (attrBeda(c) && !riwayatBerulang(c)) return 'lemah';
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
  return understand(nama).attrs.ukuran_cm; // cm, atau mm panjang yang dikonversi (katalog Jerman: "140MM")
}
function ukuranLabel(wanted, nama) {
  if (wanted == null) return 'tidak_diminta';
  const have = sizeFromName(nama);
  if (have == null) return 'tidak_diketahui';
  const d = Math.abs(have - wanted);
  return d === 0 ? 'cocok' : d <= 0.5 ? 'dekat' : 'beda';
}

async function viaDictionary(rpc, text, excludeItem) {
  // p_exclude_item: item itu sendiri dikeluarkan dari riwayat (dipakai evaluasi leave-one-out; di UI item masih PENDING jadi tidak ada efeknya)
  const params = { p_text: text, p_limit: 3 };
  if (excludeItem != null) params.p_exclude_item = excludeItem;
  const { data, error } = await rpc('suggest_dictionary', params);
  if (error) throw new Error(error.message || error.hint || 'suggest_dictionary gagal');
  return candidatesFromRows(data);
}

// Cari ke katalog. Selalu 'katalog' tier -> paling banter 'sedang'. skor dibedakan per QUERY (makin longgar makin rendah),
// bukan per baris: urutan relevansi antar-baris ditentukan penilaian atribut, bukan posisi di hasil pencarian.
async function viaCatalog(rpc, text, wantedCm, qi = 0, maxRows = 60) {
  const { data, error } = await rpc('search_produk_dengan_harga', { q: text, p_tipe: null, only_akd: false, only_kfa: false });
  if (error) throw new Error(error.message || error.hint || 'search_produk_dengan_harga gagal');
  return (data || []).slice(0, maxRows).map((p) => ({
    kode: p.kode_produk, nama: p.nama_produk || '', tier: 'katalog', ukuran: ukuranLabel(wantedCm, p.nama_produk),
    istilah: text, skor: 1 - qi * 0.05, freq: 0, isSet: p.tipe === 'SET', src: 'katalog',
    // search_produk_dengan_harga: skor = jumlah skor token + 80 bila SEMUA token cocok, -200 bila tidak.
    // Jadi skor > 0 ~ semua kata query ada di indeks; skor < 0 = kecocokan sebagian yang berisik. null = tidak diketahui (mock/test).
    full: p.score == null ? null : Number(p.score) > 0
  }));
}

// Nilai tiap kandidat terhadap atribut yang diminta. Kedua sisi lewat understand() yang sama.
function annotate(cands, itemAttrs) {
  cands.forEach((c) => {
    c.attrs = understand(c.nama).attrs;
    c.fit = compareAttrs(itemAttrs, c.attrs);
    c.diff = describeDiff(itemAttrs, c.attrs, c.fit);
  });
}

// Pilih terbaik: kandidat dengan beda atribut paling sedikit dulu, baru aturan lama (skor istilah teratas, ukuran, freq).
function pickBestFit(cands) {
  if (!cands.length) return null;
  const nb = (c) => (c.fit ? c.fit.beda.length : 0);
  const min = Math.min(...cands.map(nb));
  return pickBestCand(cands.filter((c) => nb(c) === min));
}

// Skor perbandingan lintas sumber (kecil = lebih baik): beda atribut, lalu keyakinan, lalu ukuran.
const compScore = (c) => (c.fit ? c.fit.beda.length : 0) * 100 + (3 - (CONF_RANK[candConf(c)] || 0)) * 10 + (UKURAN_RANK[c.ukuran] ?? 2);

// Dua ukuran sama dekat (mis. minta 17 cm, ada 16,5 dan 17,5) = pertanyaan yang tidak bisa dijawab mesin.
function ukuranSeri(best, cands) {
  if (!best || best.ukuran !== 'dekat' || !best.fit || best.fit.selisih == null) return null;
  const fam = familyOf(best.kode, best.isSet);
  const other = cands.find((c) => c.kode !== best.kode && c.ukuran === 'dekat' && c.fit && !c.fit.beda.length
    && c.fit.selisih === best.fit.selisih && c.fit.ukuran_ada !== best.fit.ukuran_ada && familyOf(c.kode, c.isSet) === fam);
  return other ? [best.fit.ukuran_ada, other.fit.ukuran_ada].sort((a, b) => a - b) : null;
}

// ── Putuskan untuk SATU item ──
export async function resolveItem(item, rpc, opts = {}) {
  const u = item.understood || understand(item.nama || item.deskripsi || '');
  const wantedCm = item.specs ? item.specs.ukuran_cm : u.attrs.ukuran_cm;
  const itemAttrs = { ...u.attrs, ukuran_cm: wantedCm };
  const dictQueries = opts.queries || item.variants || [item.nama];
  const catQueries = opts.queries || buildQueryLadder(item, u, opts.lexicon);
  const tried = [];
  let dictCands = [];
  let catCands = [];
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
  if (opts.dictionary !== false) {
    for (const q of dictQueries) {
      try {
        const c = await usable(await viaDictionary(rpc, q, opts.excludeItemId != null ? opts.excludeItemId : item.excludeId));
        tried.push({ q, via: 'dictionary', n: c.length });
        if (c.length) {
          annotate(c, itemAttrs);
          const rank = CONF_RANK[candConf(pickBestFit(c))] || 0;
          if (rank > bestRank) { dictCands = c; bestRank = rank; }
          if (rank === CONF_RANK.kuat) break;
        }
      } catch (e) { error = e.message; tried.push({ q, via: 'dictionary', error: e.message }); }
    }
  }

  // 2) Katalog — kalau Dictionary kosong ATAU belum 'kuat'. Berhenti begitu ada kandidat yang atributnya
  //    tidak berselisih dan ukurannya cocok/tidak diminta; kalau tidak, kumpulkan sampai 6 kandidat unik.
  //    Kandidat katalog hanya mengalahkan Dictionary kalau penilaiannya LEBIH baik (lihat compScore).
  if (opts.catalogFallback !== false && bestRank < CONF_RANK.kuat) {
    const seen = new Set(dictCands.map(c => c.kode));
    for (let qi = 0; qi < catQueries.length; qi++) {
      const q = catQueries[qi];
      try {
        const c = (await usable(await viaCatalog(rpc, q, wantedCm, qi, opts.catalogRows || 60))).filter(x => !seen.has(x.kode));
        tried.push({ q, via: 'katalog', n: c.length });
        annotate(c, itemAttrs);
        c.forEach(x => { seen.add(x.kode); catCands.push(x); });
        // Pencarian katalog mengembalikan sampai 150 baris berperingkat teks (bukan atribut): ambil banyak, nilai sendiri per atribut.
        if (c.some(x => x.full !== false && !x.fit.beda.length && (x.ukuran === 'cocok' || x.ukuran === 'tidak_diminta'))) break;
      } catch (e) { error = e.message; tried.push({ q, via: 'katalog', error: e.message }); }
    }
  }

  // Atribut cocok (STR, 24 CM) bukan bukti produknya relevan: hasil sebagian (kata kuncinya tak ada di katalog) hanya
  // kebetulan punya atribut yang sama. Bila ada yang penuh, buang yang sebagian; bila semuanya sebagian, anggap tidak dikenal.
  let hanyaSebagian = 0;
  if (catCands.some(x => x.full === true)) catCands = catCands.filter(x => x.full !== false);
  else if (catCands.length && catCands.every(x => x.full === false)) { hanyaSebagian = catCands.length; catCands = []; }

  const bestDict = pickBestFit(dictCands);
  const bestCat = pickBestFit(catCands);
  const best = bestCat && (!bestDict || compScore(bestCat) < compScore(bestDict)) ? bestCat : bestDict;
  const cands = [best, ...dictCands, ...catCands.slice().sort((a, b) => compScore(a) - compScore(b))]
    .filter((c, i, a) => c && a.findIndex(x => x.kode === c.kode) === i);
  const conf = candConf(best);
  let status, reason, reasonKey, ukuranDefault = false;

  if (!best) {
    status = 'UNKNOWN';
    if (blocked.size) {
      const b = [...blocked.values()];
      reasonKey = 'diblokir';
      reason = `Produk yang cocok ada, tapi tidak boleh dipakai konversi: ${b.slice(0, 2).map(x => `${x.kode} (${x.alasan})`).join(', ')}${b.length > 2 ? `, +${b.length - 2} lagi` : ''}.`;
    } else {
      reasonKey = error ? 'error' : hanyaSebagian ? 'tak_dikenal' : 'tak_ketemu';
      reason = error ? `Gagal mencari: ${error}`
        : hanyaSebagian ? 'Kata kuncinya tidak ada di nama produk katalog mana pun — kemungkinan istilah baru. Pilih manual (pilihanmu dipelajari).'
        : 'Tidak ada di riwayat maupun katalog.';
    }
  } else if (attrBeda(best) && !riwayatBerulang(best)) {
    // Atribut penentu berselisih (mis. ujung BL/BL diminta, produk SH/BL): jangan ditebak, sebut yang mana.
    status = 'REVIEW'; reasonKey = 'atribut_beda';
    reason = `Spesifikasi beda — ${best.diff.join('; ')}.`;
  } else if (conf !== 'kuat') {
    status = 'REVIEW';
    if (best.ukuran === 'beda' || best.ukuran === 'varian') { reasonKey = 'ukuran_beda'; reason = 'Produk ketemu tapi ukurannya beda.'; }
    else if (best.src === 'katalog') { reasonKey = 'hanya_katalog'; reason = 'Hanya ketemu lewat pencarian katalog (belum pernah ada di riwayat).'; }
    else { reasonKey = 'perkiraan'; reason = 'Kecocokan perkiraan, belum pernah dipakai persis.'; }
  } else if (isAmbiguous(cands, best)) {
    status = 'REVIEW'; reasonKey = 'ambigu';
    reason = `Istilah ini pernah dipenuhi beberapa jenis produk berbeda tanpa yang dominan — pilih yang sesuai.`;
  } else if (best.ukuran === 'dekat') {
    status = 'REVIEW';
    const seri = ukuranSeri(best, cands);
    if (seri) { reasonKey = 'ukuran_seri'; reason = `Dua ukuran sama dekat dengan yang diminta (${seri.join(' dan ')} cm) — pilih yang sesuai.`; }
    else { reasonKey = 'ukuran_dekat'; reason = 'Ukuran dekat tapi tidak persis (selisih ≤ 0,5 cm).'; }
  } else if (unverified) {
    status = 'REVIEW'; reasonKey = 'firm_belum_dicek';
    reason = 'Status firm / SINGLE USE belum bisa dicek — cek manual sebelum dipakai.';
  } else if (blocked.size) {
    // Ada produk lain untuk istilah ini yang dibuang (belum firm / SINGLE USE): yang tersisa belum tentu
    // pengganti yang tepat, jadi jangan AUTO.
    status = 'REVIEW'; reasonKey = 'ada_dibuang';
    reason = `Ada usulan lain yang dibuang (${[...blocked.values()].slice(0, 2).map(x => `${x.kode}: ${x.alasan}`).join(', ')}) — pastikan produk ini pengganti yang tepat.`;
  } else {
    status = 'AUTO';
    ukuranDefault = best.ukuran === 'tidak_diminta' && cands.some(c => c.kode !== best.kode && familyOf(c.kode, c.isSet) === familyOf(best.kode, best.isSet));
    reasonKey = attrBeda(best) ? 'riwayat_berulang_beda_spek' : 'riwayat_kuat';
    reason = `Pernah dipakai persis${best.freq ? ` (${best.freq}×)` : ''}, ${ukuranDefault ? 'ukuran default (yang paling sering dipakai)' : 'ukuran cocok'}.`;
    if (attrBeda(best)) reason += ` Spesifikasi tampak beda (${best.diff.join('; ')}), tapi staff sudah berulang kali memutuskan begini.`;
  }

  return {
    status, reason, reason_key: reasonKey, confidence: conf, ukuran_default: ukuranDefault,
    family: best ? familyOf(best.kode, best.isSet) : null,
    kode_produk: best ? best.kode : null,
    nama_produk: best ? best.nama : null,
    diff: best ? best.diff : [],
    attrs: itemAttrs,
    lexicon_hits: lexiconHits(u, opts.lexicon),
    candidates: cands.slice(0, 6),
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
  const alasan = {};
  let qtyAuto = 0, qtyAll = 0;
  results.forEach(r => {
    n[r.hasil.status]++;
    const k = r.hasil.reason_key || 'lain';
    alasan[k] = (alasan[k] || 0) + 1;
    const q = r.item.qty || 0;
    qtyAll += q;
    if (r.hasil.status === 'AUTO') qtyAuto += q;
  });
  const total = results.length;
  return { ...n, alasan, total, pctAuto: total ? Math.round((n.AUTO / total) * 100) : 0, qtyAuto, qtyAll };
}