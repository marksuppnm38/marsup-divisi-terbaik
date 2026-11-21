// Jalankan: node --test app/pages/crud-produk/klasifikasi.test.mjs
// Kategori & Spesialisasi sebagai KOLOM produk: baris membawa kolomnya, baris RPC dilengkapi per id, filter server + client,
// opsi filter dari database, nilai otomatis untuk form koreksi.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  muatKlasifikasi, resetKlasifikasi, klasOf, klasAuto, klasTerisi, infoKlasifikasi, cocokKlas, opsiKlasifikasi,
  simpanKlasDariBaris, muatKlasIds, attachKlas, muatOtomatis, fetchRowsByKlas, KLAS_COLS,
  perluCek, sumberLabel, spesTeks, spesNama, katNama, pesanKlasifikasi, rpcBelumTerpasang, isKlasDim, SPES_NONE,
} from './klasifikasi.js';

const prod = (id, o = {}) => ({
  id, kode_produk: 'K' + id, nama_produk: 'P' + id, tipe: 'SET', golongan: 'G',
  kategori: 'SET', kategori_sumber: 'golongan', spes: 'BEDAH UMUM', spes_sumber: 'peta', klas_jenis: null, klas_mikro: false, ...o,
});
const kosong = (id) => prod(id, { kategori: null, kategori_sumber: null, spes: null, spes_sumber: null });

// Supabase tiruan: from('produk').select().in()/.not()/.order()/.range() + rpc(opsi / otomatis). Mencatat panggilan.
function fakeSb(rows, { opsi = null, otomatis = [], opsiErr = null, selectErr = null, pageCap = Infinity } = {}) {
  const calls = [];
  return {
    calls,
    async rpc(name, args) {
      calls.push({ rpc: name, args });
      if (name === 'get_klasifikasi_opsi') return opsiErr ? { data: null, error: opsiErr } : { data: opsi, error: null };
      if (name === 'get_klasifikasi_otomatis') return { data: otomatis.filter((r) => args.p_ids.includes(r.produk_id)), error: null };
      throw new Error('rpc tak dikenal: ' + name);
    },
    from(tabel) {
      assert.equal(tabel, 'produk');
      const q = { f: [], r: null, cols: null, call: { tabel } };
      const chain = {
        select(c) { q.cols = c; return chain; },
        in(c, v) { q.f.push((r) => v.includes(r[c])); q.call['in_' + c] = v; return chain; },
        not(c, op, v) { q.f.push((r) => (op === 'is' && v === null ? r[c] != null : true)); q.call['not_' + c] = op; return chain; },
        order() { return chain; },
        range(a, b) { q.r = [a, b]; return chain; },
        then(res, rej) {
          calls.push(q.call);
          if (selectErr) return Promise.resolve({ data: null, error: selectErr }).then(res, rej);
          let out = rows.filter((r) => q.f.every((fn) => fn(r)));
          if (q.r) out = out.slice(q.r[0], Math.min(q.r[1] + 1, q.r[0] + pageCap));
          return Promise.resolve({ data: out.map((r) => ({ ...r })), error: null }).then(res, rej);
        },
      };
      return chain;
    },
  };
}

test.beforeEach(() => resetKlasifikasi());

// ---------- baris -> klasifikasi ----------
test('simpanKlasDariBaris: baris yang membawa kolom dicatat; klasOf membaca tanpa request', () => {
  simpanKlasDariBaris([prod(1, { klas_jenis: 'GUNTING', klas_mikro: true }), prod(2, { kategori: 'ELEKTROMEDIS', spes: null, kategori_sumber: 'bawaan' })]);
  const e = klasOf(1);
  assert.deepEqual([e.kategori, e.spes, e.jenis, e.mikro, e.spesSumber], ['SET', 'BEDAH UMUM', 'GUNTING', true, 'peta']);
  assert.equal(klasOf(2).kategori, 'ELEKTROMEDIS');
  assert.equal(klasOf(99), undefined);
});

test('produk tanpa kategori & spesialisasi (belum diklasifikasi) -> klasOf undefined, tapi tercatat "sudah dibaca"', async () => {
  const sb = fakeSb([]);
  simpanKlasDariBaris([kosong(7)]);
  assert.equal(klasOf(7), undefined);
  assert.deepEqual(await muatKlasIds(sb, [7]), { ok: true, error: null });
  assert.equal(sb.calls.length, 0); // tidak ditanya lagi
});

test('baris tanpa kolom klasifikasi (hasil RPC) diabaikan simpanKlasDariBaris', () => {
  simpanKlasDariBaris([{ id: 5, kode_produk: 'K5' }]);
  assert.equal(klasOf(5), undefined);
});

// ---------- muatKlasIds / attachKlas ----------
test('muatKlasIds: hanya id yang belum dibaca ditanya, per 150 id, kolom = id + KLAS_COLS', async () => {
  const rows = Array.from({ length: 400 }, (_, i) => prod(i + 1));
  const sb = fakeSb(rows);
  simpanKlasDariBaris([rows[0]]);                                        // id 1 sudah ada
  const r = await muatKlasIds(sb, rows.map((x) => x.id));
  assert.equal(r.ok, true);
  const q = sb.calls.filter((c) => c.tabel === 'produk');
  assert.equal(q.length, 3);                                              // 399 id -> 150 + 150 + 99
  assert.ok(q.every((c) => c.in_id.length <= 150));
  assert.ok(!q.some((c) => c.in_id.includes(1)));
  assert.equal(klasOf(400).kategori, 'SET');
  assert.equal(klasTerisi(), true);
});

test('muatKlasIds: id yang tak ada di tabel dicatat kosong (tidak ditanya berulang)', async () => {
  const sb = fakeSb([prod(1)]);
  await muatKlasIds(sb, [1, 2]);
  const n = sb.calls.length;
  await muatKlasIds(sb, [1, 2]);
  assert.equal(sb.calls.length, n);
  assert.equal(klasOf(2), undefined);
});

test('muatKlasIds: error select -> ok=false (tidak melempar); kolom belum ada -> rpcBelumTerpasang + pesan menyebut file migrasi', async () => {
  const err = { code: '42703', message: 'column produk.kategori does not exist' };
  const r = await muatKlasIds(fakeSb([], { selectErr: err }), [1]);
  assert.equal(r.ok, false);
  assert.equal(rpcBelumTerpasang(r.error), true);
  assert.match(pesanKlasifikasi(r.error), /2026-11-22_klasifikasi_kolom_produk\.sql/);
  assert.match(pesanKlasifikasi({ message: 'boom' }), /Gagal memuat kategori & spesialisasi: boom/);
});

test('attachKlas: baris yang sudah membawa kolom tidak ditanya; baris RPC (tanpa kolom) ditanya sekali', async () => {
  const sb = fakeSb([prod(2, { kategori: 'BMHP', spes: null })]);
  const r = await attachKlas(sb, [prod(1), { id: 2, kode_produk: 'K2' }]);
  assert.equal(r.ok, true);
  assert.deepEqual(sb.calls.map((c) => c.in_id), [[2]]);
  assert.equal(klasOf(1).kategori, 'SET');
  assert.equal(klasOf(2).kategori, 'BMHP');
});

// ---------- opsi filter ----------
test('muatKlasifikasi: opsi dari RPC get_klasifikasi_opsi, di-cache; opsiKlasifikasi urut KAT_ORDER / terbanyak, LAINNYA terakhir, + "Tanpa spesialisasi"', async () => {
  const sb = fakeSb([], { opsi: {
    kategori: [{ value: 'BMHP', n: 5 }, { value: 'SET', n: 100 }, { value: 'LAIN', n: 1 }],
    spes: [{ value: 'LAINNYA', n: 90 }, { value: 'THT', n: 10 }, { value: 'BEDAH UMUM', n: 30 }],
    tanpa: 12,
  } });
  const r = await muatKlasifikasi(sb);
  assert.deepEqual(r, { ok: true, error: null, info: null });
  await muatKlasifikasi(sb);
  assert.equal(sb.calls.length, 1);                                       // cache
  const o = opsiKlasifikasi();
  assert.deepEqual(o.kategori.map((k) => [k.value, k.n]), [['SET', 100], ['BMHP', 5], ['LAIN', 1]]);
  assert.deepEqual(o.spes.map((s) => [s.value, s.label, s.n]), [
    ['BEDAH UMUM', 'Bedah Umum', 30], ['THT', 'THT', 10], ['LAINNYA', 'Belum dikelompokkan', 90], [SPES_NONE, 'Tanpa spesialisasi', 12]]);
});

test('muatKlasifikasi: RPC belum terpasang -> ok=false + pesan; opsiKlasifikasi kosong (tidak melempar)', async () => {
  const r = await muatKlasifikasi(fakeSb([], { opsiErr: { code: 'PGRST202', message: 'Could not find the function public.get_klasifikasi_opsi' } }));
  assert.equal(r.ok, false);
  assert.match(pesanKlasifikasi(r.error), /belum aktif di database/);
  assert.deepEqual(opsiKlasifikasi(), { kategori: [], spes: [] });
});

test('infoKlasifikasi tidak lagi ada (null): tidak ada "dihitung pada" untuk atribut yang tersimpan', () => {
  assert.equal(infoKlasifikasi(), null);
});

// ---------- nilai otomatis (form koreksi) ----------
test('muatOtomatis -> klasAuto: nilai cache otomatis; produk tanpa entri (nonaktif) -> undefined', async () => {
  const sb = fakeSb([], { otomatis: [{ produk_id: 1, kategori: 'SET', kategori_sumber: 'golongan', spes: 'OBGYN', spes_sumber: 'peta' }] });
  assert.deepEqual(await muatOtomatis(sb, [1, 2]), { ok: true, error: null });
  assert.equal(klasAuto(1).spes, 'OBGYN');
  assert.equal(klasAuto(2), undefined);
  assert.equal(sb.calls[0].args.p_ids.length, 2);
});

// ---------- filter ----------
const F = (dim, ...values) => ({ dim, values });
test('cocokKlas: kategori / spes / "Tanpa spesialisasi" (alat tidak dihitung) / belum diklasifikasi', () => {
  simpanKlasDariBaris([
    prod(1), prod(2, { spes: 'OBGYN' }), prod(3, { spes: null, spes_sumber: 'kosong' }),
    prod(4, { kategori: 'ELEKTROMEDIS', spes: null }), kosong(5),
  ]);
  const ok = (f, id) => cocokKlas(f, { id });
  assert.equal(ok(F('kategori', 'SET'), 1), true);
  assert.equal(ok(F('kategori', 'SET'), 4), false);
  assert.equal(ok(F('kategori', 'SET'), 5), false);                      // belum diklasifikasi: tidak masuk kategori manapun
  assert.equal(ok(F('spes', 'OBGYN'), 2), true);
  assert.equal(ok(F('spes', SPES_NONE), 3), true);
  assert.equal(ok(F('spes', SPES_NONE), 4), false);                      // alat tidak punya spesialisasi
  assert.equal(ok(F('spes', 'OBGYN', SPES_NONE), 3), true);
  assert.equal(ok({ dim: 'klas_cek', value: 'ya' }, 3), true);           // sumber 'kosong' = perlu dicek
  assert.equal(ok({ dim: 'klas_cek', value: 'tidak' }, 1), true);
  assert.equal(ok({ dim: 'klas_cek', value: 'ya' }, 5), false);
});

test('fetchRowsByKlas: server dipersempit (kategori IN, tanpa baris belum-diklasifikasi), paging 1.000 stabil, hasil tepat via cocokKlas', async () => {
  const rows = [
    ...Array.from({ length: 2300 }, (_, i) => prod(i + 1, { kategori: i % 2 ? 'SET' : 'BMHP', spes: i % 3 ? 'THT' : null })),
    kosong(9001),
  ];
  const sb = fakeSb(rows);
  const semuaSet = await fetchRowsByKlas(sb, [F('kategori', 'SET')], 'id, ' + KLAS_COLS);
  assert.equal(semuaSet.error, null);
  const q = sb.calls.filter((c) => c.tabel === 'produk');
  assert.equal(q.length, 2);                                              // 1.150 baris SET: halaman penuh 1.000 + halaman pendek 150
  assert.ok(q.every((c) => c.not_kategori === 'is' && c.in_kategori[0] === 'SET'));
  assert.equal(semuaSet.rows.length, 1150);
  assert.equal(klasOf(semuaSet.rows[0].id).kategori, 'SET');              // dicatat untuk cocokKlas / kolom tabel

  const sempit = await fetchRowsByKlas(fakeSb(rows), [F('kategori', 'SET'), F('spes', 'THT'), { dim: 'brand', value: 'X' }], 'id, ' + KLAS_COLS);
  assert.ok(sempit.rows.length > 0 && sempit.rows.every((r) => r.kategori === 'SET' && r.spes === 'THT'));
  assert.equal(sempit.rows.some((r) => r.id === 9001), false);            // belum diklasifikasi tidak ikut
});

test('fetchRowsByKlas: "Tanpa spesialisasi" tidak dipersempit di server tapi tetap tepat di client; error select -> { rows: [], error }', async () => {
  const sb = fakeSb([prod(1, { spes: null }), prod(2), prod(3, { kategori: 'UNIT', spes: null })]);
  const r = await fetchRowsByKlas(sb, [F('spes', SPES_NONE)], KLAS_COLS + ', id');
  assert.deepEqual(r.rows.map((x) => x.id), [1]);                         // 3 = unit (alat), tidak dihitung
  assert.equal(sb.calls[0].in_spes, undefined);
  const bad = await fetchRowsByKlas(fakeSb([], { selectErr: { message: 'x' } }), [F('kategori', 'SET')], 'id');
  assert.deepEqual([bad.rows, bad.error.message], [[], 'x']);
});

// ---------- turunan per produk ----------
test('perluCek / sumberLabel / spesTeks / nama', () => {
  simpanKlasDariBaris([prod(1, { spes_sumber: 'peta?' }), prod(2, { spes_sumber: 'manual' }), prod(3, { kategori: 'BMHP', kategori_sumber: 'bawaan', spes: null })]);
  assert.equal(perluCek(klasOf(1)), true);
  assert.equal(perluCek(klasOf(2)), false);
  assert.equal(perluCek(klasOf(3)), true);                                // golongan belum dipetakan
  assert.equal(sumberLabel(klasOf(2)), 'Dikoreksi');
  assert.equal(sumberLabel(klasOf(3)), 'Golongan belum dipetakan');
  assert.equal(spesTeks(klasOf(3)), null);                                // alat: kosong
  assert.equal(spesTeks(klasOf(1)), 'Bedah Umum');
  assert.equal(spesNama('OBGYN'), 'OBGYN');
  assert.equal(katNama('SET'), 'Set instrumen');
  assert.equal(isKlasDim('spes'), true);
  assert.equal(isKlasDim('brand'), false);
});

test('resetKlasifikasi membuang semua yang dibaca (dipakai setelah edit / bulk / keluar halaman)', async () => {
  simpanKlasDariBaris([prod(1)]);
  await muatOtomatis(fakeSb([], { otomatis: [{ produk_id: 1, kategori: 'SET' }] }), [1]);
  resetKlasifikasi();
  assert.equal(klasOf(1), undefined);
  assert.equal(klasAuto(1), undefined);
  assert.equal(klasTerisi(), false);
});
