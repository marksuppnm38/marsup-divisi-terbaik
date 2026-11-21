// Jalankan: node --test app/pages/crud-produk/klasifikasi.test.mjs
// Kategori & Spesialisasi sebagai atribut produk: pemuatan cache, filter, opsi, dan pengambilan baris per id.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  muatKlasifikasi, resetKlasifikasi, klasOf, klasTerisi, infoKlasifikasi, cocokKlas, idsKlasFilter, opsiKlasifikasi,
  fetchRowsByIds, perluCek, sumberLabel, spesTeks, spesNama, katNama, pesanKlasifikasi,
  isKlasDim, SPES_NONE, KAT_ORDER,
} from './klasifikasi.js';

const DIHITUNG = '2026-11-20T10:15:00Z';
const baris = (id, o = {}) => ({
  produk_id: id, tipe: 'INSTRUMENT', kode_produk: 'K' + id, nama_produk: 'P' + id, kategori: 'INSTRUMEN SATUAN',
  kategori_sumber: 'golongan', spes: 'BEDAH UMUM', spes_sumber: 'peta', jenis: null, mikro: false, golongan: 'ALAT BEDAH', ...o,
});

// Supabase tiruan: rpc(ringkasan) + rpc(daftar, paginasi p_batas / p_offset). `daftar` bisa dibatasi / dirusak lewat opsi.
function fakeSb(semua, { dihitung = DIHITUNG, ringErr = null, daftarErr = null, totalOverride = null, cap = Infinity } = {}) {
  const calls = [];
  return {
    calls,
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === 'get_katalog_kategori_ringkasan') return ringErr ? { data: null, error: ringErr } : { data: { dihitung_at: dihitung, total: semua.length }, error: null };
      if (name === 'get_katalog_kategori_daftar') {
        if (daftarErr) return { data: null, error: daftarErr };
        const n = Math.min(args.p_batas, cap);
        return { data: { rows: semua.slice(args.p_offset, args.p_offset + n), total: totalOverride ?? semua.length }, error: null };
      }
      throw new Error('rpc tak dikenal: ' + name);
    },
  };
}
const muat = async (rows, opt) => { resetKlasifikasi(); const sb = fakeSb(rows, opt); const r = await muatKlasifikasi(sb); return { r, sb }; };

// ---------- muatKlasifikasi ----------
test('memuat seluruh klasifikasi per 1.000 baris, lalu klasOf membaca dari Map', async () => {
  const rows = Array.from({ length: 2500 }, (_, i) => baris(i + 1));
  const { r, sb } = await muat(rows);
  assert.equal(r.ok, true);
  assert.deepEqual(r.info, { dihitungAt: DIHITUNG, total: 2500, terbaca: 2500, lengkap: true });
  const daftar = sb.calls.filter((c) => c.name === 'get_katalog_kategori_daftar');
  assert.deepEqual(daftar.map((c) => c.args.p_offset), [0, 1000, 2000]);
  assert.ok(daftar.every((c) => c.args.p_batas === 1000 && c.args.p_spes === null && c.args.p_cari === null && c.args.p_perlu_cek === false));
  assert.deepEqual(daftar[0].args.p_kategori, KAT_ORDER); // semua kategori, bukan satu tab
  assert.equal(klasOf(2500).kode, 'K2500');
  assert.equal(klasOf(99999), undefined);
});

test('server membatasi baris per request: offset maju sesuai baris yang benar-benar kembali', async () => {
  const rows = Array.from({ length: 25 }, (_, i) => baris(i + 1));
  const { r, sb } = await muat(rows, { cap: 10 });
  assert.equal(r.info.terbaca, 25);
  assert.deepEqual(sb.calls.filter((c) => c.name.endsWith('daftar')).map((c) => c.args.p_offset), [0, 10, 20]);
});

test('klasifikasi belum pernah dihitung: ok=false, kode KLAS_KOSONG, pesan menyebut refresh_katalog_klasifikasi, daftar tidak diminta', async () => {
  const { r, sb } = await muat([baris(1)], { dihitung: null });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'KLAS_KOSONG');
  assert.match(pesanKlasifikasi(r.error), /refresh_katalog_klasifikasi/);
  assert.equal(sb.calls.length, 1);
  assert.equal(klasTerisi(), false);
});

test('RPC belum terpasang: pesan menyebut file migrasi, bukan error mentah', async () => {
  const { r } = await muat([], { ringErr: { code: 'PGRST202', message: 'Could not find the function public.get_katalog_kategori_ringkasan' } });
  assert.equal(r.ok, false);
  assert.match(pesanKlasifikasi(r.error), /20261110_kategori_spes_katalog\.sql/);
  assert.match(pesanKlasifikasi({ message: 'boom' }), /Gagal memuat kategori & spesialisasi: boom/);
});

test('error di tengah paginasi: ok=false dan cache tidak setengah terisi', async () => {
  const { r } = await muat([baris(1)], { daftarErr: { message: 'statement timeout' } });
  assert.equal(r.ok, false);
  assert.equal(klasTerisi(), false);
  assert.equal(klasOf(1), undefined);
});

test('exception dari rpc tidak pernah dilempar ke pemanggil', async () => {
  resetKlasifikasi();
  const r = await muatKlasifikasi({ rpc: async () => { throw new Error('jaringan putus'); } });
  assert.equal(r.ok, false);
  assert.match(r.error.message, /jaringan putus/);
});

test('cache: panggilan kedua tidak memanggil RPC; force memuat ulang; panggilan bersamaan digabung', async () => {
  resetKlasifikasi();
  const sb = fakeSb([baris(1), baris(2)]);
  const [a, b] = await Promise.all([muatKlasifikasi(sb), muatKlasifikasi(sb)]);
  assert.equal(a.ok && b.ok, true);
  assert.equal(sb.calls.filter((c) => c.name.endsWith('ringkasan')).length, 1);
  const n = sb.calls.length;
  await muatKlasifikasi(sb);
  assert.equal(sb.calls.length, n);
  await muatKlasifikasi(sb, { force: true });
  assert.ok(sb.calls.length > n);
});

test('jumlah baris terbaca < total server: lengkap=false (supaya pemanggil bisa memperingatkan, bukan diam)', async () => {
  const { r } = await muat([baris(1), baris(2), baris(3)], { totalOverride: 10 });
  assert.equal(r.ok, true);
  assert.equal(r.info.lengkap, false);
  assert.equal(r.info.terbaca, 3);
  assert.equal(infoKlasifikasi().total, 10);
});

test('resetKlasifikasi membuang cache', async () => {
  await muat([baris(1)]);
  assert.equal(klasTerisi(), true);
  resetKlasifikasi();
  assert.equal(klasTerisi(), false);
  assert.equal(klasOf(1), undefined);
});

// ---------- turunan per produk ----------
test('perluCek / sumberLabel / spesTeks mengikuti aturan tab lama', async () => {
  const dugaan = { kategori: 'INSTRUMEN SATUAN', spes: 'OBGYN', spesSumber: 'peta?', kategoriSumber: 'golongan' };
  const pasti = { ...dugaan, spesSumber: 'peta' };
  const kosong = { ...dugaan, spesSumber: 'kosong' };
  const alatBawaan = { kategori: 'ELEKTROMEDIS', spes: null, spesSumber: null, kategoriSumber: 'bawaan' };
  const alatKoreksi = { ...alatBawaan, kategoriSumber: 'koreksi' };
  assert.equal(perluCek(dugaan), true);
  assert.equal(perluCek(kosong), true);
  assert.equal(perluCek(pasti), false);
  assert.equal(perluCek(alatBawaan), true);
  assert.equal(perluCek(alatKoreksi), false);
  assert.equal(perluCek(undefined), false);
  assert.equal(sumberLabel(dugaan), 'Dugaan (peta)');
  assert.equal(sumberLabel(pasti), 'Peta kode');
  assert.equal(sumberLabel(alatBawaan), 'Golongan belum dipetakan');
  assert.equal(sumberLabel({ ...alatBawaan, kategoriSumber: 'golongan' }), 'Golongan');
  assert.equal(sumberLabel(undefined), '');
  assert.equal(spesTeks(pasti), spesNama('OBGYN'));
  assert.equal(spesTeks(alatBawaan), null); // unit & alat: bukan "Tanpa spesialisasi"
  assert.equal(spesTeks(undefined), null);
  assert.equal(spesNama('OBGYN'), 'OBGYN');
  assert.equal(spesNama('THT'), 'THT');
  assert.equal(spesNama('BEDAH UMUM'), 'Bedah Umum');
  assert.equal(spesNama('LAINNYA'), 'Belum dikelompokkan');
  assert.equal(katNama('SET'), 'Set instrumen');
});

// ---------- filter ----------
async function muatContoh() {
  const rows = [
    baris(1, { tipe: 'SET', kategori: 'SET', nama_produk: 'MINOR S. 2', spes: 'BEDAH UMUM', spes_sumber: 'label' }),
    baris(2, { tipe: 'SET', kategori: 'SET', nama_produk: 'MAYOR VAGINAL S.', spes: 'OBGYN', spes_sumber: 'isi' }),     // dugaan
    baris(3, { tipe: 'INSTRUMENT', kategori: 'INSTRUMEN SATUAN', spes: 'OBGYN', spes_sumber: 'peta' }),
    baris(4, { tipe: 'INSTRUMENT', kategori: 'INSTRUMEN SATUAN', spes: null, spes_sumber: 'kosong' }),                  // tanpa spesialisasi
    baris(5, { tipe: 'UNIT', kategori: 'ELEKTROMEDIS', spes: null, spes_sumber: null, kategori_sumber: 'bawaan' }),    // alat, golongan belum dipetakan
    baris(6, { tipe: 'INSTRUMENT', kategori: 'INSTRUMEN SATUAN', spes: 'LAINNYA', spes_sumber: 'kata' }),
    baris(7, { tipe: 'SET', kategori: 'SET', nama_produk: 'HECTING S.', spes: 'BEDAH UMUM', spes_sumber: 'peta' }),
  ];
  const { r } = await muat(rows);
  assert.equal(r.ok, true);
}
const F = (dim, ...values) => ({ dim, values });
const ids = (...filters) => idsKlasFilter(filters).sort((a, b) => a - b);

test('isKlasDim hanya mengenali dimensi klasifikasi', () => {
  ['kategori', 'spes', 'klas_cek'].forEach((d) => assert.equal(isKlasDim(d), true));
  ['tipe', 'keluarga', 'brand', 'stok'].forEach((d) => assert.equal(isKlasDim(d), false));
  assert.equal(isKlasDim('kelompok'), false); // Kelompok set (Minor/Mayor/Vaginal) sudah dihapus; keluarga set yang dipakai
});

test('filter kategori (multi): OR di dalam dimensi', async () => {
  await muatContoh();
  assert.deepEqual(ids(F('kategori', 'SET')), [1, 2, 7]);
  assert.deepEqual(ids(F('kategori', 'SET', 'ELEKTROMEDIS')), [1, 2, 5, 7]);
});

test('filter spesialisasi: nilai biasa, LAINNYA, dan "Tanpa spesialisasi" yang TIDAK menyertakan unit & alat', async () => {
  await muatContoh();
  assert.deepEqual(ids(F('spes', 'OBGYN')), [2, 3]);
  assert.deepEqual(ids(F('spes', 'OBGYN', 'BEDAH UMUM')), [1, 2, 3, 7]);
  assert.deepEqual(ids(F('spes', 'LAINNYA')), [6]);
  assert.deepEqual(ids(F('spes', SPES_NONE)), [4]);      // id 5 (alat, spes null) bukan "tanpa spesialisasi"
});

test('filter klasifikasi perlu dicek: ya / tidak (single-select, pakai value)', async () => {
  await muatContoh();
  assert.deepEqual(ids({ dim: 'klas_cek', value: 'ya' }), [2, 4, 5]);          // dugaan isi, kosong, golongan bawaan
  assert.deepEqual(ids({ dim: 'klas_cek', value: 'tidak' }), [1, 3, 6, 7]);
});

test('filter ditumpuk = AND; produk di luar cache (nonaktif / belum dimuat) tidak pernah lolos filter klasifikasi', async () => {
  await muatContoh();
  assert.deepEqual(ids(F('kategori', 'SET'), F('spes', 'OBGYN')), [2]);
  assert.deepEqual(ids(F('kategori', 'SET'), { dim: 'klas_cek', value: 'ya' }), [2]);
  assert.equal(cocokKlas(F('kategori', 'SET'), { id: 12345 }), false);
  assert.equal(cocokKlas({ dim: 'klas_cek', value: 'tidak' }, { id: 12345 }), false);
  assert.equal(cocokKlas({ dim: 'klas_cek', value: 'ya' }, { id: 12345 }), false);
  resetKlasifikasi();
  assert.deepEqual(idsKlasFilter([F('kategori', 'SET')]), []); // cache kosong: tidak throw
});

test('cocokKlas pada baris list Produk memakai id untuk klasifikasi; produk di luar cache tidak punya kategori', async () => {
  await muatContoh();
  const row = { id: 1, tipe: 'SET', kode_produk: 'K1', nama_produk: 'MINOR S. 2' };
  assert.equal(cocokKlas(F('kategori', 'SET'), row), true);
  const nonaktif = { id: 777, tipe: 'SET', kode_produk: 'KX', nama_produk: 'MAYOR S.' };
  assert.equal(cocokKlas(F('kategori', 'SET'), nonaktif), false);
  assert.equal(cocokKlas(F('kelompok', 'minor'), row), true); // dimensi tak dikenal = lolos (default), bukan lagi menyaring
});

// ---------- opsi filter ----------
test('opsiKlasifikasi: jumlah per nilai, urut terbanyak, LAINNYA terakhir, "Tanpa spesialisasi" hanya non-alat', async () => {
  await muatContoh();
  const o = opsiKlasifikasi();
  assert.deepEqual(o.kategori.map((k) => [k.value, k.n]), [['SET', 3], ['INSTRUMEN SATUAN', 3], ['ELEKTROMEDIS', 1]]);
  assert.equal(o.kategori[0].label, 'Set instrumen');
  assert.deepEqual(o.spes.map((s) => [s.value, s.n]), [['BEDAH UMUM', 2], ['OBGYN', 2], ['LAINNYA', 1], [SPES_NONE, 1]]);
  assert.equal(o.spes.at(-1).label, 'Tanpa spesialisasi');
  resetKlasifikasi();
  assert.deepEqual(opsiKlasifikasi(), { kategori: [], spes: [] });
});

// ---------- baris produk per id ----------
function fakeProduk(rows, { error = null } = {}) {
  const calls = [];
  return {
    calls,
    from(name) {
      const q = { name, ids: null };
      calls.push(q);
      const chain = { select() { return chain; }, in(_c, v) { q.ids = v; return chain; },
        then(res, rej) { return Promise.resolve(error ? { data: null, error } : { data: rows.filter((r) => q.ids.includes(r.id)), error: null }).then(res, rej); } };
      return chain;
    },
  };
}

test('fetchRowsByIds: chunk 150 id, urutan sesuai ids, id yang tak ada di tabel dibuang', async () => {
  const rows = Array.from({ length: 400 }, (_, i) => ({ id: i + 1, kode_produk: 'K' + (i + 1) }));
  const sb = fakeProduk(rows);
  const want = [400, 3, 99999, 1, ...Array.from({ length: 300 }, (_, i) => i + 5)];
  const { rows: out, error } = await fetchRowsByIds(sb, want, 'id, kode_produk');
  assert.equal(error, null);
  assert.deepEqual(out.slice(0, 3).map((r) => r.id), [400, 3, 1]);
  assert.equal(out.length, want.length - 1);
  assert.ok(sb.calls.every((c) => c.name === 'produk' && c.ids.length <= 150));
  assert.equal(sb.calls.length, Math.ceil(want.length / 150));
});

test('fetchRowsByIds: cache dipakai untuk id yang sama; hanya id baru yang ditanya', async () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ id: i + 1 }));
  const sb = fakeProduk(rows), cache = new Map();
  await fetchRowsByIds(sb, [1, 2, 3], 'id', cache);
  assert.equal(sb.calls.length, 1);
  await fetchRowsByIds(sb, [1, 2, 3], 'id', cache);
  assert.equal(sb.calls.length, 1);
  await fetchRowsByIds(sb, [2, 3, 4], 'id', cache);
  assert.equal(sb.calls.length, 2);
  assert.deepEqual(sb.calls[1].ids, [4]);
});

test('fetchRowsByIds: batas paralel 6 request sekaligus', async () => {
  let aktif = 0, puncak = 0;
  const sb = { from() {
    const chain = { select() { return chain; }, in() { return chain; },
      then(res, rej) { aktif++; puncak = Math.max(puncak, aktif); return new Promise((ok) => setTimeout(ok, 5)).then(() => { aktif--; return { data: [], error: null }; }).then(res, rej); } };
    return chain;
  } };
  await fetchRowsByIds(sb, Array.from({ length: 150 * 20 }, (_, i) => i + 1), 'id');
  assert.ok(puncak <= 6, 'puncak paralel ' + puncak);
  assert.ok(puncak > 1);
});

test('fetchRowsByIds: error dikembalikan (tidak dilempar), ids kosong = tanpa request', async () => {
  const sb = fakeProduk([], { error: { message: 'JWT expired' } });
  const r = await fetchRowsByIds(sb, [1, 2], 'id');
  assert.equal(r.error.message, 'JWT expired');
  assert.deepEqual(r.rows, []);
  const sb2 = fakeProduk([]);
  assert.deepEqual(await fetchRowsByIds(sb2, [], 'id'), { rows: [], error: null });
  assert.equal(sb2.calls.length, 0);
});
