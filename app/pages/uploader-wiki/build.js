// uploader-wiki / build.js
// Logika MURNI (tanpa DOM, tanpa Supabase) yang mengubah baris database jadi
// baris MASTER.xlsx -- file "peta" yang dibaca script Tampermonkey
// "INAPROC Upload Produk V6" (parseTable di script itu mencocokkan kolom lewat NAMA header).
//
// Dipisah dari index.js supaya bisa dites di Node: lihat tests/uploader-wiki.test.mjs.
//
// Sumber tiap kolom MASTER (31 kolom, urutan & ejaan header = seed.json, disalin dari
// MASTER.xlsx yang sudah terbukti jalan di script):
//   KODE / Daftar_Produk_Sektoral ........ produk.kode_produk
//   KODE_ASLI ............................ produk.kode_asli
//   Nama_Produk / Deskripsi .............. produk.nama_produk (spasi & newline dirapikan)
//   Upload_Foto_Produk ................... <kode_asli>.png         (folder THUMBNAILS)
//   Spesifikasi_Produk_Filename .......... <KODE>.pdf              (folder SPEK)
//   Struktur_Harga_Filename .............. <KODE>.pdf              (folder STRUKTUR_HARGA)
//   Nomor_Izin_Edar_(NIE)_Filename ....... AKD <produk.no_akd>.pdf (folder AKD)
//   Harga_Produk ......................... produk_harga jenis UPLOAD, tahun terbaru
//                                          (fallback: EKATALOG / ppnDivisor, diberi flag)
//   Berat_Produk ......................... produk.berat_gram (fallback konstanta seed)
//   KATEGORI_2/3, Kode_Kbki, Jumlah_Stok . seed.json (per KODE, dari MASTER lama) ->
//                                          kalau SKU baru: aturan family (RULES) / default, diberi flag
//   sisanya (merek, TKDN, dropdown spesifikasi, nama file dokumen statis) = konstanta seed.

export const DEFAULTS = {
  ppnDivisor: 1.11,        // harga EKATALOG (sudah PPN) -> harga sebelum pajak. Hanya dipakai bila jenis UPLOAD tidak ada.
  stokDefault: 500,
  stokBesar: 3000,         // keranjang / container sterilisasi
  stokBesarRegex: /STERILIZATION|\bCONTAINERS?\b/i,
  stokBesarKodePrefix: 'RBA-',
};

// Indeks kolom MASTER (urutan header di seed.json).
export const COL = {
  kode: 0, kodeAsli: 1, kat1: 2, kat2: 3, kat3: 4, merek: 5, sektoral: 6, nama: 7, foto: 8, deskripsi: 9,
  kbki: 10, kbkiFallback: 11, tkdn: 12, harga: 20, stok: 21, satuan: 22, berat: 23,
  fSpek: 24, fNie: 25, fStruktur: 30,
};

// Kategori untuk SKU yang tidak ada di seed. Dicocokkan ke master_produk.family + sub_family.
// kat2 harus persis salah satu nilai seed.kat2. Urutan = prioritas.
export const KATEGORI_RULES = [
  { re: /gigi|dental/i,                               kat2: 'Peralatan Gigi' },
  { re: /\bmata\b|ophthalm|\beye\b/i,                 kat2: 'Peralatan Mata' },
  { re: /neuro/i,                                      kat2: 'Peralatan Neurologi' },
  { re: /obstetri|ginekolog|gyneco?l/i,                kat2: 'Peralatan Obstetrik dan Ginekologi' },
  { re: /ortop/i,                                      kat2: 'Peralatan Ortopedi' },
  { re: /\btht\b|telinga|hidung|tenggorok|\bent\b|\bear\b|nasal/i, kat2: 'Peralatan Telinga, Hidung dan Tenggorokan' },
  { re: /gastro|urolog/i,                              kat2: 'Peralatan Gastroenterologi-Urologi' },
];
export const KATEGORI_DEFAULT = 'Peralatan Bedah Umum dan Bedah Plastik';

export const collapse = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

// "AKD 11103420271" / "11103420271" / "AKD11103420271.pdf" -> "AKD 11103420271.pdf"; tidak ada angka -> ''.
export function nieFileName(noAkd) {
  const m = String(noAkd == null ? '' : noAkd).match(/\d{8,}/);
  return m ? `AKD ${m[0]}.pdf` : '';
}

// rows = baris produk_harga milik SATU produk. Return {harga, sumber} | null.
export function pickHarga(rows, ppnDivisor = DEFAULTS.ppnDivisor) {
  const byJenis = (j) => (rows || [])
    .filter((r) => String(r.jenis || '').toUpperCase() === j && Number(r.harga) > 0)
    .sort((a, b) => Number(b.tahun) - Number(a.tahun));
  const up = byJenis('UPLOAD');
  if (up.length) return { harga: Math.round(Number(up[0].harga) * 100) / 100, sumber: 'UPLOAD' };
  const ek = byJenis('EKATALOG');
  if (ek.length) return { harga: Math.round((Number(ek[0].harga) / ppnDivisor) * 100) / 100, sumber: 'EKATALOG/' + ppnDivisor };
  return null;
}

// Satu produk -> {row, flags, skip}. ctx = {seed, hargaByProduk (Map id -> rows), masterByKodeAsli (Map -> {family, sub_family}), opts}
export function buildRow(p, ctx) {
  const { seed, hargaByProduk, masterByKodeAsli } = ctx;
  const opts = Object.assign({}, DEFAULTS, ctx.opts || {});
  const kode = collapse(p.kode_produk);
  const kodeAsli = collapse(p.kode_asli);
  const nama = collapse(p.nama_produk);
  const flags = [];   // {lvl: 'WARN'|'INFO', msg}
  const skip = [];    // alasan baris tidak dibuat

  if (!kode) skip.push('kode_produk kosong');
  if (!nama) skip.push('nama_produk kosong');
  if (!kodeAsli) skip.push('kode_asli kosong');

  const h = pickHarga(hargaByProduk.get(p.id), opts.ppnDivisor);
  if (!h) skip.push('tidak ada harga UPLOAD maupun EKATALOG');
  else if (h.sumber !== 'UPLOAD') flags.push({ lvl: 'WARN', msg: `harga dari ${h.sumber} (belum ada harga UPLOAD)` });

  const nie = nieFileName(p.no_akd);
  if (!nie) skip.push('no_akd kosong / tidak ada angka -> nama file NIE tidak bisa dibentuk');

  if (skip.length) return { row: null, flags, skip, kode };

  const s = seed.rows[kode];            // [idxKat2, idxKat3, idxKbki, stok]
  let kat2; let kat3; let kbki; let stok;
  if (s) {
    kat2 = seed.kat2[s[0]]; kat3 = seed.kat3[s[1]]; kbki = seed.kbki[s[2]]; stok = s[3];
  } else {
    const m = masterByKodeAsli.get(kodeAsli) || {};
    const text = `${m.family || ''} ${m.sub_family || ''}`;
    const rule = KATEGORI_RULES.find((r) => r.re.test(text));
    kat2 = rule ? rule.kat2 : KATEGORI_DEFAULT;
    const i2 = seed.kat2.indexOf(kat2);
    // kat3 & KBKI: ambil pasangan yang paling sering dipakai seed untuk kat2 yang sama
    const pair = seed.pairs && seed.pairs[kat2];
    kat3 = pair ? seed.kat3[pair[0]] : `${kat2} Bedah`;
    kbki = pair ? seed.kbki[pair[1]] : '';
    if (i2 < 0) flags.push({ lvl: 'WARN', msg: `kategori "${kat2}" tidak ada di seed` });
    flags.push({
      lvl: 'WARN',
      msg: rule
        ? `SKU baru (tidak ada di seed): kategori dari family "${collapse(text)}" -> ${kat2}. Cek KBKI.`
        : `SKU baru (tidak ada di seed) & family "${collapse(text)}" tidak cocok aturan -> default ${kat2}. CEK MANUAL kategori & KBKI.`,
    });
    const besar = opts.stokBesarRegex.test(nama) || kode.startsWith(opts.stokBesarKodePrefix);
    stok = besar ? opts.stokBesar : opts.stokDefault;
  }

  const row = seed.headers.map((_, i) => (seed.constants[i] !== undefined ? seed.constants[i] : ''));
  row[COL.kode] = kode;
  row[COL.kodeAsli] = kodeAsli;
  row[COL.kat2] = kat2;
  row[COL.kat3] = kat3;
  row[COL.sektoral] = kode;
  row[COL.nama] = nama;
  row[COL.foto] = `${kodeAsli}.png`;
  row[COL.deskripsi] = nama;
  row[COL.kbki] = kbki;
  row[COL.harga] = h.harga;
  row[COL.stok] = stok;
  const berat = Number(p.berat_gram);
  if (berat > 0) row[COL.berat] = berat;
  else { row[COL.berat] = Number(seed.constants[COL.berat]) || 275; flags.push({ lvl: 'INFO', msg: 'berat_gram kosong -> pakai default seed' }); }
  row[COL.fSpek] = `${kode}.pdf`;
  row[COL.fNie] = nie;
  row[COL.fStruktur] = `${kode}.pdf`;
  return { row, flags, skip, kode };
}

// Bagi n baris jadi `parts` potongan berurutan dengan ukuran selisih maksimal 1.
export function splitBatches(rows, parts) {
  const n = Math.max(1, Math.min(parts | 0 || 1, rows.length || 1));
  const base = Math.floor(rows.length / n);
  const extra = rows.length % n;
  const out = [];
  let at = 0;
  for (let i = 0; i < n; i += 1) {
    const size = base + (i < extra ? 1 : 0);
    out.push(rows.slice(at, at + size));
    at += size;
  }
  return out;
}

// Pasangan (kat3, kbki) yang paling sering untuk tiap kat2 dari seed -> dipakai SKU baru.
export function derivePairs(seed) {
  const cnt = {};
  Object.values(seed.rows).forEach(([a, b, c]) => {
    const k = seed.kat2[a];
    cnt[k] = cnt[k] || {};
    const key = `${b}|${c}`;
    cnt[k][key] = (cnt[k][key] || 0) + 1;
  });
  const pairs = {};
  Object.keys(cnt).forEach((k) => {
    const best = Object.entries(cnt[k]).sort((x, y) => y[1] - x[1])[0][0].split('|').map(Number);
    pairs[k] = best;
  });
  return pairs;
}

// Array-of-arrays siap ditulis ke sheet "MASTER": header seed + OPERATOR + BATCH_ID (script Tampermonkey mengabaikan kolom tak dikenal).
export function toAoa(seed, rows, { operator = '', batchId = '' } = {}) {
  return [seed.headers.concat(['OPERATOR', 'BATCH_ID'])].concat(rows.map((r) => r.concat([operator, batchId])));
}