// Jalankan: node --test app/pages/crud-produk/daftar-langsung.test.mjs
// Jalur langsung ke tabel produk: urutan + filter Sudah / Belum diisi tanpa RPC get_produk_list.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bagiFilter, ambilHalamanLangsung, ambilSemuaLangsung, ambilIdStok, saringKlienLaluUrut, batasTerakhir, cocokTerakhir } from './daftar-langsung.js';
import { NILAI_ISI, NILAI_KOSONG } from './urut-header.js';

// Supabase tiruan: mencatat rantai pemanggilan; hasil = dataPages[i] untuk range ke-i.
function fakeSb(pages, { err = null, count = 0 } = {}) {
  const log = [];
  let n = 0;
  return {
    log,
    from(t) {
      const call = [['from', t]];
      const chain = new Proxy({}, {
        get(_, m) {
          if (m === 'range') return (a, b) => { call.push(['range', a, b]); log.push(call); const i = n++; return Promise.resolve(err ? { data: null, error: err, count: null } : { data: pages[i] || [], error: null, count }); };
          return (...args) => { call.push([m, ...args]); return chain; };
        },
      });
      return chain;
    },
  };
}
const f = (dim, value) => ({ dim, value });
const names = (call) => call.map((c) => c.join(':'));

test('bagiFilter: tipe / golongan / brand / aktif / INAPROC / link = server; harga & stok = client', () => {
  const { server, klien } = bagiFilter([f('tipe', 'SET'), f('harga', 'ada'), f('golongan', 'X'), f('stok', 'READY'), f('link_v6', 'ada')]);
  assert.deepEqual(server.map((x) => x.dim), ['tipe', 'golongan', 'link_v6']);
  assert.deepEqual(klien.map((x) => x.dim), ['harga', 'stok']);
});

test('halaman: filter + urutan + range dikerjakan server, total dari count server', async () => {
  const sb = fakeSb([[{ id: 1 }]], { count: 42 });
  const chipFn = (q) => q.eq('status_akd', 'terhubung');
  const r = await ambilHalamanLangsung(sb, {
    columns: 'id', chipFn, server: [f('golongan', NILAI_KOSONG), f('brand', NILAI_ISI), f('is_active', 'aktif'), f('tipe', 'x')].slice(0, 3),
    sort: { key: 'nama', dir: 'desc' }, page: 3, pageSize: 30,
  });
  assert.equal(r.error, null); assert.equal(r.total, 42); assert.deepEqual(r.rows, [{ id: 1 }]);
  assert.deepEqual(names(sb.log[0]), [
    'from:produk', 'select:id:[object Object]', 'eq:status_akd:terhubung',
    'or:golongan.is.null,golongan.eq.',
    'not:brand:is:', 'neq:brand:',
    'eq:is_active:true',
    'order:nama_produk:[object Object]', 'order:id:[object Object]', 'range:60:89',
  ]);
  assert.deepEqual(sb.log[0][8].slice(0, 2), ['order', 'id']);
});

test('tanpa urutan: terakhir diubah dulu (sama dengan daftar biasa)', async () => {
  const sb = fakeSb([[]]);
  await ambilHalamanLangsung(sb, { columns: 'id', server: [], sort: null, page: 1, pageSize: 30 });
  assert.equal(sb.log[0][2][1], 'updated_at');
  assert.equal(sb.log[0][2][2].ascending, false);
});

test('urutan server: kosong di bawah (nullsFirst:false) baik naik maupun turun', async () => {
  for (const dir of ['asc', 'desc']) {
    const sb = fakeSb([[]]);
    await ambilHalamanLangsung(sb, { columns: 'id', server: [], sort: { key: 'brand', dir }, page: 1, pageSize: 30 });
    const ord = sb.log[0].find((c) => c[0] === 'order');
    assert.equal(ord[1], 'brand'); assert.equal(ord[2].ascending, dir === 'asc'); assert.equal(ord[2].nullsFirst, false);
  }
});

test('link V6 & tipe & nilai biasa dipasang sebagai filter server', async () => {
  const sb = fakeSb([[]]);
  await ambilHalamanLangsung(sb, { columns: 'id', server: [f('link_v6', 'ada'), { dim: 'tipe', values: ['SET', 'INSTRUMENT'] }, f('golongan', 'ALAT')], sort: null, page: 1, pageSize: 30 });
  const n = names(sb.log[0]);
  assert.ok(n.includes('not:link_v6:is:') && n.includes('neq:link_v6:'));
  assert.ok(n.includes('in:tipe:SET,INSTRUMENT'));
  assert.ok(n.includes('eq:golongan:ALAT'));
});

test('semua: dibaca per 1.000 baris sampai halaman terakhir, urutan id stabil', async () => {
  const full = Array.from({ length: 1000 }, (_, i) => ({ id: i }));
  const sb = fakeSb([full, [{ id: 1000 }]]);
  const r = await ambilSemuaLangsung(sb, { columns: 'id', server: [f('golongan', NILAI_KOSONG)], sort: { key: 'kode', dir: 'asc' } });
  assert.equal(r.error, null); assert.equal(r.rows.length, 1001);
  assert.deepEqual(sb.log.map((c) => c.find((x) => x[0] === 'range').slice(1)), [[0, 999], [1000, 1999]]);
});

test('error server dikembalikan, tidak dilempar', async () => {
  const boom = { message: 'boom' };
  assert.equal((await ambilHalamanLangsung(fakeSb([], { err: boom }), { columns: 'id', server: [], page: 1, pageSize: 30 })).error, boom);
  assert.equal((await ambilSemuaLangsung(fakeSb([], { err: boom }), { columns: 'id', server: [] })).error, boom);
});

test('id stok per status dibaca dari view stok ringkas', async () => {
  const sb = fakeSb([[{ produk_id: 'a' }, { produk_id: 'b' }]]);
  const r = await ambilIdStok(sb, 'READY');
  assert.deepEqual([...r.ids], ['a', 'b']);
  assert.deepEqual(names(sb.log[0]).slice(0, 3), ['from:v_produk_stok_ringkas', 'select:produk_id', 'eq:stok_status:READY']);
});

test('saring client Harga & Stok lalu urutkan (kosong di bawah)', () => {
  const rows = [
    { id: 1, kode_produk: 'K1', brand: 'B' }, { id: 2, kode_produk: 'K2', brand: null },
    { id: 3, kode_produk: 'K3', brand: 'A' }, { id: 4, kode_produk: 'K4', brand: 'C' },
  ];
  const ctx = { hargaIds: new Set([1, 2, 3]), stokIds: new Map([['READY', new Set([2, 3, 4])]]) };
  const out = saringKlienLaluUrut(rows, [f('harga', 'ada'), f('stok', 'READY')], { key: 'brand', dir: 'asc' }, ctx);
  assert.deepEqual(out.map((r) => r.id), [3, 2]);
  const kosong = saringKlienLaluUrut(rows, [f('harga', 'kosong')], null, ctx);
  assert.deepEqual(kosong.map((r) => r.id), [4]);
});

test('filter AKD: dikerjakan server (ada = terhubung, kosong = selain terhubung)', async () => {
  const { server, klien } = bagiFilter([f('akd', 'ada'), f('harga', 'ada')]);
  assert.deepEqual(server.map((x) => x.dim), ['akd']);
  assert.deepEqual(klien.map((x) => x.dim), ['harga']);
  let sb = fakeSb([[]], { count: 0 });
  await ambilHalamanLangsung(sb, { columns: 'id', server: [f('akd', 'ada')], sort: null, page: 1, pageSize: 30 });
  assert.ok(names(sb.log[0]).includes('eq:status_akd:terhubung'));
  sb = fakeSb([[]], { count: 0 });
  await ambilHalamanLangsung(sb, { columns: 'id', server: [f('akd', 'kosong')], sort: null, page: 1, pageSize: 30 });
  assert.ok(names(sb.log[0]).includes('or:status_akd.is.null,status_akd.neq.terhubung'));
});


// ---- Product Manager (a2-02): dimensi Status & Terakhir diubah ----
test('Status & Terakhir diubah = filter server (bukan client)', () => {
  const { server, klien } = bagiFilter([f('status', 'belum_firm'), f('terakhir', '7h'), f('verified', 'ya')]);
  assert.deepEqual(server.map((x) => x.dim), ['status', 'terakhir']);
  assert.deepEqual(klien.map((x) => x.dim), ['verified']); // Verified sengaja hanya di jalur client (cache id berbadge)
});

test('Status dipasang sebagai eq status_akd; Terakhir diubah sebagai gte updated_at', async () => {
  const sb = fakeSb([[]]);
  await ambilHalamanLangsung(sb, { columns: 'id', server: [f('status', 'di_luar_cakupan'), f('terakhir', '24j'), f('akd', 'kosong')], sort: null, page: 1, pageSize: 30 });
  const n = names(sb.log[0]);
  assert.ok(n.includes('eq:status_akd:di_luar_cakupan'));
  assert.ok(n.some((x) => x.startsWith('gte:updated_at:')));
  assert.ok(n.includes('or:status_akd.is.null,status_akd.neq.terhubung')); // kombinasi dengan AKD: keduanya jalan (AND)
});

test('Terakhir diubah dengan nilai tak dikenal: tidak memasang batas (server) dan tidak meloloskan baris (client)', async () => {
  const sb = fakeSb([[]]);
  await ambilHalamanLangsung(sb, { columns: 'id', server: [f('terakhir', 'ngawur')], sort: null, page: 1, pageSize: 30 });
  assert.ok(!names(sb.log[0]).some((x) => x.startsWith('gte:')));
  assert.equal(cocokTerakhir({ updated_at: new Date().toISOString() }, 'ngawur'), false);
});

test('batasTerakhir / cocokTerakhir: 24 jam, 7 hari, 30 hari (waktu diinjeksi)', () => {
  const now = Date.parse('2026-11-27T12:00:00Z');
  assert.equal(batasTerakhir('24j', now), '2026-11-26T12:00:00.000Z');
  assert.equal(batasTerakhir('7h', now), '2026-11-20T12:00:00.000Z');
  assert.equal(batasTerakhir('30h', now), '2026-10-28T12:00:00.000Z');
  assert.equal(batasTerakhir('x', now), null);
  const jam = (h) => new Date(now - h * 3600 * 1000).toISOString();
  assert.equal(cocokTerakhir({ updated_at: jam(23) }, '24j', now), true);
  assert.equal(cocokTerakhir({ updated_at: jam(25) }, '24j', now), false);
  assert.equal(cocokTerakhir({ updated_at: jam(25) }, '7h', now), true);
  assert.equal(cocokTerakhir({ updated_at: null }, '30h', now), false);
  assert.equal(cocokTerakhir({}, '30h', now), false);
});
