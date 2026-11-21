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

import { understand, compareAttrs, describeDiff, DECISIVE } from './understand.js';
import { buildQueryLadder, lexiconHits, punyaPenentu, queryTanpaJenis } from './lexicon.js';

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
  if (c.namaPersis) return 'kuat'; // nama produk = teks permintaan (lihat namaKey); tidak perlu riwayat berulang
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
// Dominan = minimal 3× dipakai DAN (≥ 70% pemakaian ATAU ≥ 2× pemakaian keluarga runner-up).
// Kenapa ada jalur "unggul 2×": permintaan umum ("SET MINOR") memang tidak menunjuk satu produk dan ini konversi, bukan
// pencocokan 1:1 — kalau satu pilihan jelas paling sering dipakai (mis. 11× vs 4× vs 3×), pasang itu; yang lain tetap tampil
// sebagai alternatif. Ambigu sungguhan (10× vs 8×) tetap REVIEW.
export function isAmbiguous(cands, best) {
  if (!best) return false;
  const sameTerm = cands.filter(c => c.istilah === best.istilah && c.src === 'riwayat');
  if (sameTerm.length <= 1) return false;
  const fam = new Map();
  sameTerm.forEach(c => { const f = familyOf(c.kode, c.isSet); fam.set(f, (fam.get(f) || 0) + c.freq); });
  if (fam.size <= 1) return false;
  const total = [...fam.values()].reduce((a, b) => a + b, 0);
  const myFam = familyOf(best.kode, best.isSet);
  const top = fam.get(myFam);
  const runnerUp = Math.max(0, ...[...fam.entries()].filter(([f]) => f !== myFam).map(([, n]) => n));
  return !(top >= 3 && total > 0 && (top / total >= 0.7 || top >= 2 * runnerUp));
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
async function viaCatalog(rpc, text, wantedCm, qi = 0, maxRows = 60, tipe = null) {
  const { data, error } = await rpc('search_produk_dengan_harga', { q: text, p_tipe: tipe || null, only_akd: false, only_kfa: false });
  if (error) throw new Error(error.message || error.hint || 'search_produk_dengan_harga gagal');
  return (data || []).slice(0, maxRows).map((p) => ({
    kode: p.kode_produk, nama: p.nama_produk || '', tier: 'katalog', ukuran: ukuranLabel(wantedCm, p.nama_produk),
    istilah: text, skor: 1 - qi * 0.05, freq: 0, isSet: p.tipe === 'SET', src: 'katalog',
    // search_produk_dengan_harga: skor = jumlah skor token + 80 bila SEMUA token cocok, -200 bila tidak.
    // Jadi skor > 0 ~ semua kata query ada di indeks; skor < 0 = kecocokan sebagian yang berisik. null = tidak diketahui (mock/test).
    full: p.score == null ? null : Number(p.score) > 0
  }));
}

// Kunci perbandingan nama: huruf besar, tanpa awalan merek "ROBUST" (merek kita, sering ikut tertulis di permintaan RS),
// tanda baca/spasi diratakan. Dua teks dengan kunci sama = nama produk yang sama persis.
export const namaKey = (s) => String(s == null ? '' : s).toUpperCase().replace(/^\s*ROBUST\b/, ' ').replace(/[^A-Z0-9]+/g, ' ').trim();

// Nilai tiap kandidat terhadap atribut yang diminta. Kedua sisi lewat understand() yang sama.
// Juga menandai `namaPersis`: nama produk = teks permintaan. Itu bukti terkuat bahwa ini produk yang dimaksud, jadi tidak perlu
// menunggu riwayat berulang (produk yang baru sekali dipakai pun cocok kuat). Kalau LEBIH DARI SATU kandidat bernama sama
// persis, tanda dicabut: mesin tidak bisa memilih di antara kembar.
function annotate(cands, itemAttrs, itemKey) {
  cands.forEach((c) => {
    c.attrs = understand(c.nama).attrs;
    c.fit = compareAttrs(itemAttrs, c.attrs);
    c.diff = describeDiff(itemAttrs, c.attrs, c.fit);
    // Nama SET di katalog berakhiran "S." ("DENTAL COMPLETE S.", "SECTIO CAESAREAN S."): akhiran itu bukan bagian dari
    // istilah customer, jadi untuk SET dibandingkan tanpa " S" di ujung.
    const nk = namaKey(c.nama);
    c.namaPersis = !!itemKey && (nk === itemKey || (c.isSet && nk.replace(/ S$/, '') === itemKey));
  });
  if (cands.filter((c) => c.namaPersis).length > 1) cands.forEach((c) => { c.namaPersis = false; });
}

// Pilih terbaik: kandidat dengan beda atribut paling sedikit dulu, baru aturan lama (skor istilah teratas, ukuran, freq).
function pickBestFit(cands) {
  if (!cands.length) return null;
  const nb = (c) => (c.fit ? c.fit.beda.length : 0);
  const min = Math.min(...cands.map(nb));
  const sepadan = cands.filter((c) => nb(c) === min);
  // Nama persis = bukti terkuat; jangan kalah dari non-SET hanya karena pickBestCand membuang SET pada skor sama.
  const persis = sepadan.filter((c) => c.namaPersis);
  return pickBestCand(persis.length ? persis : sepadan);
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

// Pemeriksaan acak (audit): sebagian kecil usulan AUTO sengaja diturunkan jadi REVIEW supaya staff benar-benar memeriksanya.
// Tanpa ini AUTO dipasang massal ("Pakai N yang cocok") dan log selalu mencatat 'diterima' -> akurasi AUTO terlihat 100% padahal
// tidak ada yang memeriksa. Deterministik per teks (hash), jadi menjalankan ulang Auto-Match tidak bisa "mencari" sampel yang enak.
export function auditPick(text, rate) {
  if (!(rate > 0)) return false;
  let h = 2166136261;
  const s = String(text == null ? '' : text).trim().toUpperCase();
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return (h % 10000) / 10000 < rate;
}

// ── Bundle "skenario" untuk permintaan UMUM ──
// Permintaan yang tidak menunjuk spesifikasi apa pun (mis. "SET MINOR": tanpa ukuran/ujung/bentuk/gigi/nomor) bukan
// pertanyaan "produk mana?" melainkan "apa saja yang kita punya?". Jawabannya satu BUNDLE: semua produk yang pernah dipakai
// untuk istilah itu, masing-masing ditawarkan dengan qty diminta (skenario anggaran: "kalau dibelikan A segini, B segini").
// Hanya yang SIAP dijual (siap.ok) yang masuk — yang belum siap tetap tampil di kartu sebagai kandidat, tapi tidak ikut ditawarkan.
// Sumber = riwayat yang kuat (exact/urutan), bukan seluruh katalog: katalog bisa meledak jadi puluhan dan belum teruji.
export const BUNDLE_MAX = 12;
export function buildBundle(best, cands, itemAttrs) {
  if (!best || candConf(best) !== 'kuat') return null;
  const hasVal = (v) => (Array.isArray(v) ? v.length > 0 : v != null);
  if (itemAttrs.ukuran_cm != null || DECISIVE.some((k) => hasVal(itemAttrs[k]))) return null; // ada yang diminta spesifik → bukan umum
  const ok = (c) => c.src === 'riwayat' && (c.tier === 'exact' || c.tier === 'urutan') && !attrBeda(c) && (!c.siap || c.siap.ok);
  const list = cands.filter(ok).sort((a, b) => b.freq - a.freq).slice(0, BUNDLE_MAX);
  return list.length >= 2 ? list.map((c) => ({ kode: c.kode, nama: c.nama, freq: c.freq, isSet: c.isSet })) : null;
}

// ── Putuskan untuk SATU item ──
export async function resolveItem(item, rpc, opts = {}) {
  const u = item.understood || understand(item.nama || item.deskripsi || '');
  const wantedCm = item.specs ? item.specs.ukuran_cm : u.attrs.ukuran_cm;
  const itemAttrs = { ...u.attrs, ukuran_cm: wantedCm };
  const itemKey = namaKey(item.nama || item.deskripsi || '');
  const dictQueries = opts.queries || item.variants || [item.nama];
  // Rencana query katalog. Query TANPA kata jenis (+ p_tipe) paling dulu; tangga lama tetap sebagai fallback (p_tipe null).
  // opts.queries meng-override semuanya.
  const jq = opts.queries ? null : queryTanpaJenis(u);
  const catPlan = opts.queries
    ? opts.queries.map((q) => ({ q, tipe: null }))
    : [...(jq ? [jq] : []), ...buildQueryLadder(item, u, opts.lexicon).map((q) => ({ q, tipe: null }))];
  // Ada kata penentu selain kata jenis -> Dictionary tier 'umum' (istilah generik, mis. "SET") tidak boleh jadi best.
  const penentu = punyaPenentu(u);
  const isUmum = (c) => c.tier === 'umum';
  let umumCands = [];
  const tried = [];
  let dictCands = [];
  let catCands = [];
  let error = null;

  // Kesiapan jual — opts.firmCheck, lihat firm.js. Dipasang di SETIAP sumber kandidat sebelum dinilai.
  //   keras  (SINGLE USE / sudah dihapus) : dibuang -> `blocked`, supaya tidak sempat jadi "terbaik" dan menghentikan
  //                                         pencarian (break di loop Dictionary) sebelum kandidat lain ketemu.
  //   kurang (AKD/link V6/firm)           : TETAP jadi kandidat, diberi `siap: { ok:false, kurang }`. Produk yang benar tapi
  //                                         belum disiapkan tidak boleh hilang; ia cuma tidak boleh AUTO (lihat keputusan di bawah).
  const blocked = new Map();
  let unverified = false;
  const usable = async (list) => {
    if (!opts.firmCheck || !list.length) return list;
    try {
      const bl = await opts.firmCheck(list.map(x => x.kode));
      const keep = [];
      list.forEach(x => {
        const r = bl.get(x.kode);
        if (r && r.keras) { blocked.set(x.kode, { kode: x.kode, nama: x.nama, alasan: r.keras }); return; }
        x.siap = { ok: !(r && r.kurang.length), kurang: r ? r.kurang.slice() : [] };
        keep.push(x);
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
        let c = await usable(await viaDictionary(rpc, q, opts.excludeItemId != null ? opts.excludeItemId : item.excludeId));
        tried.push({ q, via: 'dictionary', n: c.length });
        if (penentu) { umumCands.push(...c.filter(isUmum)); c = c.filter((x) => !isUmum(x)); }
        if (c.length) {
          annotate(c, itemAttrs, itemKey);
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
    for (let qi = 0; qi < catPlan.length; qi++) {
      const { q, tipe } = catPlan[qi];
      try {
        const c = (await usable(await viaCatalog(rpc, q, wantedCm, qi, opts.catalogRows || 60, tipe))).filter(x => !seen.has(x.kode));
        tried.push({ q, via: 'katalog', ...(tipe ? { tipe } : {}), n: c.length });
        annotate(c, itemAttrs, itemKey);
        c.forEach(x => { seen.add(x.kode); catCands.push(x); });
        // Pencarian katalog mengembalikan sampai 150 baris berperingkat teks (bukan atribut): ambil banyak, nilai sendiri per atribut.
        if (c.some(x => x.full !== false && !x.fit.beda.length && (x.ukuran === 'cocok' || x.ukuran === 'tidak_diminta'))) break;
      } catch (e) { error = e.message; tried.push({ q, via: 'katalog', ...(tipe ? { tipe } : {}), error: e.message }); }
    }
  }

  // Atribut cocok (STR, 24 CM) bukan bukti produknya relevan: hasil sebagian (kata kuncinya tak ada di katalog) hanya
  // kebetulan punya atribut yang sama. Bila ada yang penuh, buang yang sebagian; bila semuanya sebagian, anggap tidak dikenal.
  let hanyaSebagian = 0;
  if (catCands.some(x => x.full === true)) catCands = catCands.filter(x => x.full !== false);
  else if (catCands.length && catCands.every(x => x.full === false)) { hanyaSebagian = catCands.length; catCands = []; }

  // Kembar nama persis bisa tersebar di dua sumber (Dictionary + katalog): cabut tanda kalau totalnya > 1.
  { const kembar = [...dictCands, ...catCands].filter(x => x.namaPersis); if (kembar.length > 1) kembar.forEach(x => { x.namaPersis = false; }); }
  const bestDict = pickBestFit(dictCands);
  const bestCat = pickBestFit(catCands);
  const best = bestCat && (!bestDict || compScore(bestCat) < compScore(bestDict)) ? bestCat : bestDict;
  // Kandidat 'umum' yang dibuang dari pemilihan best tetap tampil di AKHIR sebagai alternatif.
  annotate(umumCands, itemAttrs, itemKey); umumCands.forEach((x) => { x.namaPersis = false; });
  const cands = [best, ...dictCands, ...catCands.slice().sort((a, b) => compScore(a) - compScore(b)), ...umumCands]
    .filter((c, i, a) => c && a.findIndex(x => x.kode === c.kode) === i);
  const conf = candConf(best);
  const bundle = buildBundle(best, [...dictCands, ...catCands], itemAttrs); // sebelum cands dipotong 6
  let status, reason, reasonKey, ukuranDefault = false, audit = false, reasonKeyAsli = null;

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
  } else if (best.siap && !best.siap.ok) {
    // Cocok kuat tapi belum siap dijual: usulan TETAP tampil (bukan hilang), cuma tidak dipasang otomatis.
    status = 'REVIEW'; reasonKey = 'belum_siap';
    reason = `Cocok, tapi belum siap dijual: ${best.siap.kurang.join(', ')}. Tidak dipasang otomatis — siapkan dulu, atau pakai manual kalau memang disengaja.`;
  } else if (unverified) {
    status = 'REVIEW'; reasonKey = 'firm_belum_dicek';
    reason = 'Status firm / AKD / SINGLE USE belum bisa dicek — cek manual sebelum dipakai.';
  } else if (blocked.size) {
    // Ada produk lain untuk istilah ini yang dibuang (SINGLE USE / sudah dihapus): yang tersisa belum tentu
    // pengganti yang tepat, jadi jangan AUTO.
    status = 'REVIEW'; reasonKey = 'ada_dibuang';
    reason = `Ada usulan lain yang dibuang (${[...blocked.values()].slice(0, 2).map(x => `${x.kode}: ${x.alasan}`).join(', ')}) — pastikan produk ini pengganti yang tepat.`;
  } else {
    status = 'AUTO';
    ukuranDefault = best.ukuran === 'tidak_diminta' && cands.some(c => c.kode !== best.kode && familyOf(c.kode, c.isSet) === familyOf(best.kode, best.isSet));
    const persisSaja = best.namaPersis && !(best.tier === 'exact' || best.tier === 'urutan');
    reasonKey = attrBeda(best) ? 'riwayat_berulang_beda_spek' : persisSaja ? 'nama_persis' : 'riwayat_kuat';
    reason = persisSaja ? 'Nama produk sama persis dengan permintaan.'
      : `Pernah dipakai persis${best.freq ? ` (${best.freq}×)` : ''}, ${ukuranDefault ? 'ukuran default (yang paling sering dipakai)' : 'ukuran cocok'}.`;
    if (attrBeda(best)) reason += ` Spesifikasi tampak beda (${best.diff.join('; ')}), tapi staff sudah berulang kali memutuskan begini.`;
    if (auditPick(item.nama || item.deskripsi || '', opts.auditRate)) {
      audit = true; reasonKeyAsli = reasonKey; status = 'REVIEW'; reasonKey = 'audit_acak';
      reason = `Pemeriksaan acak: usulan ini sebenarnya sudah yakin (${reason}) — dicek untuk mengukur akurasi. Cukup konfirmasi bila benar.`;
    }
  }

  return {
    status, reason, reason_key: reasonKey, reason_key_asli: reasonKeyAsli, audit, confidence: conf, ukuran_default: ukuranDefault,
    family: best ? familyOf(best.kode, best.isSet) : null,
    kode_produk: best ? best.kode : null,
    nama_produk: best ? best.nama : null,
    diff: best ? best.diff : [],
    attrs: itemAttrs,
    lexicon_hits: lexiconHits(u, opts.lexicon),
    candidates: cands.slice(0, 6),
    siap: best ? (best.siap || null) : null, bundle, blocked: [...blocked.values()], unverified,
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