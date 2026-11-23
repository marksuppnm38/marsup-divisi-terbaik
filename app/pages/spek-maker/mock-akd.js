// spek-maker/mock-akd.js -- logika murni "Mock AKD" (tanpa DOM / Supabase / jsPDF).
//
// Tujuan: sebelum mengajukan AKD untuk SET BARU, lihat dulu seperti apa isinya.
// Set baru itu gabungan beberapa set yang sudah ada (mis. MAYO 1 + 2 + 3), jadi isinya
// = gabungan semua rincian set tersebut, tiap instrumen cukup muncul SEKALI (unique).
//
// Aturan:
//   - Kunci unik = kode item (tanpa beda huruf besar/kecil & spasi pinggir).
//   - Baris item yang sama di SATU set dijumlahkan dulu (itu komposisi set tsb).
//   - Antar set, qty item yang sama diputuskan oleh strategi (default: terbesar).
//   - Urutan = kemunculan pertama: set pertama dulu, lalu item baru dari set berikutnya.

export const STRATEGI_QTY = [
  ['max', 'Terbesar dari semua set'],
  ['jumlah', 'Dijumlahkan antar set'],
  ['pertama', 'Ikut set pertama yang memuatnya'],
];

// Teks paste -> daftar kode (dipisah spasi/baris/koma/titik koma), tanpa duplikat.
export function parseKodeSet(raw) {
  const seen = new Set();
  const out = [];
  for (const c of String(raw || '').split(/[\s,;]+/)) {
    const code = c.trim();
    const k = code.toUpperCase();
    if (code && !seen.has(k)) { seen.add(k); out.push(code); }
  }
  return out;
}

const norm = (s) => String(s == null ? '' : s).trim();
const kunciItem = (it) => {
  const k = norm(it.kode).toUpperCase();
  // item tanpa kode: jatuh ke deskripsi supaya tidak semuanya menyatu jadi satu
  return k && k !== '(TANPA KODE)' ? k : 'DESK:' + norm(it.deskripsi).toUpperCase();
};
const qtyValid = (q) => (Number(q) > 0 ? Number(q) : 1);

// sumber: [{ set, qty }] urut sesuai input -> qty akhir
export function hitungQty(sumber, strategi = 'max') {
  if (!sumber || !sumber.length) return 1;
  const qs = sumber.map((s) => qtyValid(s.qty));
  if (strategi === 'jumlah') return qs.reduce((a, b) => a + b, 0);
  if (strategi === 'pertama') return qs[0];
  return Math.max(...qs);
}

// sets: [{ kode, items: [{ kode, kodeAsli, deskripsi, qty }] }] (hanya set yang ditemukan,
// urutan = urutan input; item tiap set sudah dalam urutan yang diinginkan).
export function gabungkanSet(sets, { qty = 'max' } = {}) {
  const peta = new Map();
  let barisAsli = 0;
  let totalQtyAsli = 0;

  for (const set of sets) {
    // jumlahkan dulu baris kembar di dalam satu set
    const perSet = new Map();
    for (const it of set.items || []) {
      barisAsli++;
      totalQtyAsli += qtyValid(it.qty);
      const key = kunciItem(it);
      const cur = perSet.get(key);
      if (cur) cur.qty += qtyValid(it.qty);
      else perSet.set(key, { it, qty: qtyValid(it.qty) });
    }
    for (const [key, { it, qty: q }] of perSet) {
      let g = peta.get(key);
      if (!g) {
        g = { key, kode: norm(it.kode) || '(tanpa kode)', kodeAsli: norm(it.kodeAsli), deskripsi: norm(it.deskripsi), sumber: [] };
        peta.set(key, g);
      }
      if (!g.deskripsi && norm(it.deskripsi)) g.deskripsi = norm(it.deskripsi);
      if (!g.kodeAsli && norm(it.kodeAsli)) g.kodeAsli = norm(it.kodeAsli);
      g.sumber.push({ set: set.kode, qty: q });
    }
  }

  const items = [...peta.values()].map((g) => ({
    ...g,
    qty: hitungQty(g.sumber, qty),
    qtyBeda: new Set(g.sumber.map((s) => s.qty)).size > 1,
    disemuaSet: g.sumber.length === sets.length,
  }));

  return {
    items,
    stat: {
      jumlahSet: sets.length,
      barisAsli,
      itemUnik: items.length,
      duplikat: barisAsli - items.length,
      totalQtyAsli,
      totalQty: items.reduce((s, i) => s + i.qty, 0),
      qtyBeda: items.filter((i) => i.qtyBeda).length,
    },
  };
}

export function mockFileName(judul) {
  const base = String(judul || '').replace(/[.\s]+$/, '') || 'set-gabungan';
  return 'MOCK_AKD_' + base.replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '') + '.pdf';
}
