// Jalankan: node --test app/pages/crud-produk/keluarga.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchKeluargaOptions, fetchKeluargaMap, fetchRowsByKeluarga, urutKeluarga, nomorVarian,
  viewBelumTerpasang, pesanKeluarga, KELUARGA_VIEW, KELUARGA_REF,
} from './keluarga.js';

// Supabase tiruan: .from(x).select().in()/.order()/.range() -> thenable. Menyimpan panggilan supaya bisa diperiksa.
function fakeSb(tables, { error = null } = {}) {
  const calls = [];
  const sb = {
    calls,
    from(name) {
      const q = { name, filters: [], range: null };
      calls.push(q);
      const chain = {
        select() { return chain; },
        order() { return chain; },
        in(col, vals) { q.filters.push([col, vals]); return chain; },
        range(a, b) { q.range = [a, b]; return chain; },
        then(res, rej) {
          if (error) return Promise.resolve({ data: null, error }).then(res, rej);
          let rows = tables[name] || [];
          q.filters.forEach(([c, v]) => { rows = rows.filter((r) => v.includes(r[c])); });
          if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1);
          return Promise.resolve({ data: rows, error: null }).then(res, rej);
        },
      };
      return chain;
    },
  };
  return sb;
}

test('nomorVarian: varian pertama null, angka dibaca numerik', () => {
  assert.equal(nomorVarian('MAYOR S.'), null);
  assert.equal(nomorVarian('MAYOR S'), null);
  assert.equal(nomorVarian('MAYOR S. 2'), 2);
  assert.equal(nomorVarian('MAYOR S. 10'), 10);
  assert.equal(nomorVarian('ANOSCOPY AS.2'), 2);
  assert.equal(nomorVarian('PALATO PLASTY SP. 2'), 2);
  assert.equal(nomorVarian('SUPLEMENT S. 2 LAPARASCOPY'), 2);
  assert.equal(nomorVarian('TUBECTOMY S. 2 ( MINI LAPARATOMY)'), 2);
  assert.equal(nomorVarian('BIDAN KIT'), null);
});

test('urutKeluarga: per keluarga, lalu 1, 2, 10 (bukan 1, 10, 2)', () => {
  const rows = [
    { keluarga: 'MINOR S', nama_produk: 'MINOR S. 6' },
    { keluarga: 'MAYOR S', nama_produk: 'MAYOR S. 10' },
    { keluarga: 'MAYOR S', nama_produk: 'MAYOR S. 2' },
    { keluarga: 'MAYOR S', nama_produk: 'MAYOR S.' },
    { keluarga: 'MAYOR VAGINAL S', nama_produk: 'MAYOR VAGINAL S. 2' },
  ];
  assert.deepEqual(rows.sort(urutKeluarga).map((r) => r.nama_produk),
    ['MAYOR S.', 'MAYOR S. 2', 'MAYOR S. 10', 'MAYOR VAGINAL S. 2', 'MINOR S. 6']);
});

test('fetchKeluargaOptions: ambil daftar keluarga + jumlah, abaikan baris tanpa nama', async () => {
  const sb = fakeSb({ [KELUARGA_REF]: [{ keluarga: 'MAYOR S', jumlah_varian: 7 }, { keluarga: null, jumlah_varian: 1 }, { keluarga: 'MINOR S', jumlah_varian: '9' }] });
  const r = await fetchKeluargaOptions(sb);
  assert.equal(r.error, null);
  assert.deepEqual(r.rows, [{ keluarga: 'MAYOR S', n: 7 }, { keluarga: 'MINOR S', n: 9 }]);
});

test('fetchKeluargaOptions: lebih dari 1.000 keluarga dipaging, tidak kepotong', async () => {
  const many = Array.from({ length: 1500 }, (_, i) => ({ keluarga: 'K' + i, jumlah_varian: 1 }));
  const r = await fetchKeluargaOptions(fakeSb({ [KELUARGA_REF]: many }));
  assert.equal(r.rows.length, 1500);
});

test('fetchKeluargaMap: dipecah per 150 id, non-SET tidak ada di map', async () => {
  const set = Array.from({ length: 400 }, (_, i) => ({ id: i + 1, keluarga: 'K' + (i % 7) }));
  const sb = fakeSb({ [KELUARGA_VIEW]: set });
  const ids = Array.from({ length: 450 }, (_, i) => i + 1); // 50 id terakhir bukan SET
  const r = await fetchKeluargaMap(sb, ids);
  assert.equal(r.error, null);
  assert.equal(sb.calls.length, 3); // 450 id / 150
  assert.ok(sb.calls.every((c) => c.filters[0][1].length <= 150));
  assert.equal(r.map.size, 400);
  assert.equal(r.map.get(1), 'K0');
  assert.equal(r.map.has(450), false);
});

test('fetchKeluargaMap: id kosong tidak memanggil database', async () => {
  const sb = fakeSb({});
  const r = await fetchKeluargaMap(sb, []);
  assert.equal(sb.calls.length, 0);
  assert.equal(r.map.size, 0);
});

test('fetchRowsByKeluarga: hanya keluarga yang dipilih, hasil urut per keluarga lalu nomor varian', async () => {
  const rows = [
    { id: 1, keluarga: 'MAYOR S', nama_produk: 'MAYOR S. 10' },
    { id: 2, keluarga: 'MAYOR S', nama_produk: 'MAYOR S. 2' },
    { id: 3, keluarga: 'MAYOR VAGINAL S', nama_produk: 'MAYOR VAGINAL S. 2' },
    { id: 4, keluarga: 'MINOR S', nama_produk: 'MINOR S. 6' },
  ];
  const r = await fetchRowsByKeluarga(fakeSb({ [KELUARGA_VIEW]: rows }), ['MAYOR S', 'MINOR S'], 'id, keluarga, nama_produk');
  assert.equal(r.error, null);
  assert.deepEqual(r.rows.map((x) => x.id), [2, 1, 4]); // MAYOR VAGINAL S tidak ikut MAYOR S
});

test('fetchRowsByKeluarga: banyak nama dipecah per 40, baris > 1.000 dipaging', async () => {
  const rows = Array.from({ length: 2500 }, (_, i) => ({ id: i + 1, keluarga: 'K', nama_produk: 'K S. ' + (i + 1) }));
  const sb = fakeSb({ [KELUARGA_VIEW]: rows });
  const names = ['K', ...Array.from({ length: 99 }, (_, i) => 'X' + i)]; // 100 nama -> 3 chunk
  const r = await fetchRowsByKeluarga(sb, names, 'id, keluarga, nama_produk');
  assert.equal(r.rows.length, 2500);
  assert.ok(sb.calls.every((c) => c.filters[0][1].length <= 40));
});

test('error tidak pernah throw: dikembalikan, dan view belum terpasang dikenali', async () => {
  const err = { code: 'PGRST205', message: "Could not find the table 'public.v_produk_keluarga' in the schema cache" };
  const sb = fakeSb({}, { error: err });
  assert.equal((await fetchKeluargaOptions(sb)).error, err);
  assert.equal((await fetchKeluargaMap(sb, [1])).error, err);
  assert.equal((await fetchRowsByKeluarga(sb, ['A'], 'id')).error, err);
  assert.equal(viewBelumTerpasang(err), true);
  assert.equal(viewBelumTerpasang({ code: '42P01', message: 'x' }), true);
  assert.equal(viewBelumTerpasang({ code: '500', message: 'boom' }), false);
  assert.match(pesanKeluarga(err), /03_keluarga_set\.sql/);
  assert.match(pesanKeluarga({ message: 'boom' }), /boom/);
});