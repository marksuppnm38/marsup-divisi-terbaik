// auto-konversi/prosedur-review.js
// ══════════════════════════════════════════
// Bahan untuk PENAMPIL daftar prosedur (prosedur-daftar.js): supaya hasil urai prosedur.js di SELURUH set bisa direview,
// bukan cuma di cuplikan yang diuji. Murni (tanpa DOM/Supabase) — input = indeks dari buatIndeks().
//
//   ringkasProsedur(indeks, { urut })  -> { total, prosedur: [{ nama, nSet, kualifier: [{ kualifier, kunci, nSet, tier, nomor, anggota }] }] }
//   temuan(ringkas)                    -> [{ jenis, prosedur, kualifier, detail }]  tanda "layak dicek" (BUKAN pasti salah)
//   brandKosong(kodes, brandOf)        -> { total, kosong, grup: [{ prefix, n, kode, saran, dasar }] }
//
// Jenis temuan:
//   inti_kosong       nama set tidak menyisakan inti (semua katanya terbuang sebagai tier/kata jenis)
//   kualifier_panjang kualifier ≥ 3 kata — biasanya prosedur yang gagal dipecah, atau kata yang seharusnya sinonim
//   mirip             dua prosedur beda tipis (typo yang lolos dari peleburan ejaan, atau butuh baris di prosedur_sinonim)
//   kualifier_prosedur kualifier = nama prosedur lain yang berdiri sendiri (LAPAROTOMY + SECTIO CAESAREAN) — wajar, tapi layak dilihat
// ══════════════════════════════════════════

import { lev } from './prosedur.js';

const TIERS = ['basic', 'standar', 'complete', 'inst', 'kit'];
const cmpNomor = (a, b) => (a == null) - (b == null) || a - b;

export function ringkasProsedur(indeks, { urut = 'abjad' } = {}) {
  const peta = new Map();
  let total = 0;
  (indeks ? indeks.daftar() : []).forEach(({ kunci }) => {
    indeks.anggota(kunci).forEach((v) => {
      total++;
      if (!peta.has(v.prosedur)) peta.set(v.prosedur, { nama: v.prosedur, nSet: 0, kual: new Map() });
      const p = peta.get(v.prosedur);
      p.nSet++;
      if (!p.kual.has(v.kualifier)) p.kual.set(v.kualifier, { kualifier: v.kualifier, kunci: v.kunci, nSet: 0, tier: {}, nomor: new Set(), anggota: [] });
      const k = p.kual.get(v.kualifier);
      k.nSet++;
      k.tier[v.tier] = (k.tier[v.tier] || 0) + 1;
      k.nomor.add(v.nomor);
      k.anggota.push({ kode: v.kode, nama: v.nama, tier: v.tier, nomor: v.nomor });
    });
  });
  const tierRank = (t) => { const i = TIERS.indexOf(t); return i < 0 ? 99 : i; };
  const prosedur = [...peta.values()].map((p) => ({
    nama: p.nama,
    nSet: p.nSet,
    kualifier: [...p.kual.values()]
      .map((k) => ({
        ...k,
        nomor: [...k.nomor].sort(cmpNomor),
        anggota: k.anggota.sort((a, b) => tierRank(a.tier) - tierRank(b.tier) || cmpNomor(a.nomor, b.nomor) || a.kode.localeCompare(b.kode))
      }))
      // kualifier kosong ("umum") selalu paling atas, sisanya terbanyak dulu
      .sort((a, b) => (a.kualifier !== '') - (b.kualifier !== '') || b.nSet - a.nSet || a.kualifier.localeCompare(b.kualifier))
  }));
  prosedur.sort(urut === 'jumlah' ? (a, b) => b.nSet - a.nSet || a.nama.localeCompare(b.nama) : (a, b) => a.nama.localeCompare(b.nama));
  return { total, prosedur };
}

// Dua nama prosedur dianggap "mirip" kalau beda tipis tapi tidak sama. Ambang mengikuti petaEjaan (kata panjang boleh beda 2 huruf,
// pendek 1), tapi diterapkan ke nama utuh dan hanya untuk nama ≥ 6 huruf supaya MINOR/MAYOR tidak saling tuduh.
const miripNama = (a, b) => {
  if (a === b || Math.min(a.length, b.length) < 6) return false;
  return lev(a, b) <= (Math.min(a.length, b.length) >= 8 ? 2 : 1);
};

export function temuan(ringkas) {
  const out = [];
  const list = (ringkas && ringkas.prosedur) || [];
  const namaSet = new Set(list.map((p) => p.nama));
  list.forEach((p) => {
    if (p.nama === '') out.push({ jenis: 'inti_kosong', prosedur: p.nama, kualifier: '', detail: `${p.nSet} set tanpa inti nama` });
    p.kualifier.forEach((k) => {
      if (!k.kualifier) return;
      const nKata = k.kualifier.split(' ').length;
      if (nKata >= 3) out.push({ jenis: 'kualifier_panjang', prosedur: p.nama, kualifier: k.kualifier, detail: `kualifier ${nKata} kata` });
      if (namaSet.has(k.kualifier) && k.kualifier !== p.nama) out.push({ jenis: 'kualifier_prosedur', prosedur: p.nama, kualifier: k.kualifier, detail: `"${k.kualifier}" juga prosedur sendiri` });
    });
  });
  const nama = list.map((p) => p.nama).filter(Boolean);
  for (let i = 0; i < nama.length; i++) {
    for (let j = i + 1; j < nama.length; j++) {
      if (!miripNama(nama[i], nama[j])) continue;
      out.push({ jenis: 'mirip', prosedur: nama[i], kualifier: '', detail: `mirip "${nama[j]}"` });
      out.push({ jenis: 'mirip', prosedur: nama[j], kualifier: '', detail: `mirip "${nama[i]}"` });
    }
  }
  return out;
}

// ── Brand kosong ──
// Kode produk diawali huruf prefix (AD-MO12 -> "AD-MO", ADPND5 -> "ADPND", RB999-U93 -> "RB"). Set berbrand kosong dikelompokkan per
// prefix. Saran brand datang dari data, bukan daftar di kode: mayoritas brand set BERBRAND dengan prefix yang sama; kalau prefix itu
// belum punya set berbrand, pakai "keluarga" 2 huruf pertamanya (AD-MO -> AD). Saran hanya muncul kalau mayoritasnya jelas
// (≥ 90% dan ≥ 3 set berbrand) — selain itu null: kemungkinan memang merek lain yang kolom brand-nya belum diisi.
export const prefixKode = (kode) => { const m = String(kode || '').toUpperCase().match(/^[A-Z]+(?:-[A-Z]+)*/); return m ? m[0] : ''; };
const keluargaKode = (prefix) => prefix.replace(/[^A-Z]/g, '').slice(0, 2);

export function brandKosong(kodes, brandOf) {
  const ambil = (k) => String((brandOf && (brandOf instanceof Map ? brandOf.get(k) : brandOf[k])) || '').trim().toUpperCase();
  const hitung = (peta, kunci, brand) => {
    if (!peta.has(kunci)) peta.set(kunci, new Map());
    const m = peta.get(kunci);
    m.set(brand, (m.get(brand) || 0) + 1);
  };
  const perPrefix = new Map(), perKeluarga = new Map();
  const kosong = new Map();
  (kodes || []).forEach((kode) => {
    const b = ambil(kode);
    const pf = prefixKode(kode);
    if (!b) { if (!kosong.has(pf)) kosong.set(pf, []); kosong.get(pf).push(kode); return; }
    hitung(perPrefix, pf, b);
    hitung(perKeluarga, keluargaKode(pf), b);
  });
  const mayoritas = (m) => {
    if (!m) return null;
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    const [brand, n] = [...m].sort((a, b) => b[1] - a[1])[0];
    return total >= 3 && n / total >= 0.9 ? brand : null;
  };
  const grup = [...kosong].map(([prefix, kode]) => {
    let saran = mayoritas(perPrefix.get(prefix)), dasar = saran ? 'prefix' : null;
    if (!saran) { saran = mayoritas(perKeluarga.get(keluargaKode(prefix))); dasar = saran ? 'keluarga' : null; }
    return { prefix, n: kode.length, kode: kode.slice().sort(), saran, dasar };
  }).sort((a, b) => (!!b.saran - !!a.saran) || b.n - a.n || a.prefix.localeCompare(b.prefix));
  return { total: (kodes || []).length, kosong: grup.reduce((a, g) => a + g.n, 0), grup };
}

// Teks TSV untuk ditempel ke spreadsheet: satu baris per set.
export function keTsv(ringkas) {
  const baris = [['prosedur', 'kualifier', 'tier', 'nomor', 'kode', 'nama'].join('\t')];
  ((ringkas && ringkas.prosedur) || []).forEach((p) => p.kualifier.forEach((k) => k.anggota.forEach((a) => {
    baris.push([p.nama, k.kualifier, a.tier, a.nomor == null ? '' : a.nomor, a.kode, a.nama].join('\t'));
  })));
  return baris.join('\n');
}
