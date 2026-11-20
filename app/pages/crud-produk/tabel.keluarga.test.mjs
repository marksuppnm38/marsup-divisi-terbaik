// Jalankan: node --test app/pages/crud-produk/kolom-tabel.keluarga.test.mjs
// Kolom "Keluarga set" di kolom-tabel.js: ikut export, dimuat lazy, dan gagal-muat terdeteksi (bukan kolom kosong diam-diam).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTableColumns } from './kolom-tabel.js';

const noop = () => {};
function fakeSb(rows, error = null) {
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
const helpers = { selBox: () => '', btn: () => '', recent: () => '', verified: () => '', seal: () => '', akdNoOf: () => [], stokCell: () => '', moreCell: () => '', extraOf: () => null, stokOf: () => null, stokLabel: {}, sealLabel: () => '', isVerified: () => false };
const make = (sb) => createTableColumns({ sb, headRow: { innerHTML: '' }, tableBody: { addEventListener: noop, removeEventListener: noop }, helpers, onChange: noop, onPreset: noop });

test('preset "Per keluarga": kolom Keluarga Set ada di export, urut sesudah Nama', () => {
  const kit = make(fakeSb([]));
  assert.ok(kit.presets().some((p) => p.id === 'keluarga' && p.label === 'Per keluarga'));
  kit.applyPreset('keluarga');
  const labels = kit.exportColumns().map((c) => c.label);
  assert.deepEqual(labels, ['Kode Produk', 'Nama Produk', 'Keluarga Set', 'Brand', 'Link V6', 'Aktif']);
  assert.ok(kit.exportUses().has('keluarga'));
});

test('loadNeeds memuat keluarga lewat view, exportRow mengisinya; non-SET kosong; id yang sama tidak ditanya ulang', async () => {
  const sb = fakeSb([{ id: 1, keluarga: 'MAYOR S' }, { id: 2, keluarga: 'MAYOR VAGINAL S' }]);
  const kit = make(sb);
  kit.applyPreset('keluarga');
  const rows = [
    { id: 1, kode_produk: 'A', nama_produk: 'MAYOR S. 2', is_active: true },
    { id: 2, kode_produk: 'B', nama_produk: 'MAYOR VAGINAL S. 2', is_active: true },
    { id: 3, kode_produk: 'C', nama_produk: 'NEEDLE HOLDER 14.5', is_active: true }, // instrumen: bukan SET
  ];
  assert.equal(await kit.loadNeeds(rows.map((r) => r.id)), true);
  const col = kit.exportColumns().findIndex((c) => c.label === 'Keluarga Set');
  assert.deepEqual(rows.map((r) => kit.exportRow(r, {})[col]), ['MAYOR S', 'MAYOR VAGINAL S', null]);
  await kit.loadNeeds([1, 2, 3]);
  assert.equal(sb.calls.length, 1); // cache: tidak query ulang
});

test('baris yang sudah membawa keluarga (jalur filter Keluarga) dipakai langsung', () => {
  const kit = make(fakeSb([]));
  kit.applyPreset('keluarga');
  const col = kit.exportColumns().findIndex((c) => c.label === 'Keluarga Set');
  assert.equal(kit.exportRow({ id: 9, kode_produk: 'X', nama_produk: 'X S. 2', keluarga: 'X S' }, {})[col], 'X S');
});

test('view belum terpasang: loadNeeds false + pesan yang menyebut file migrasi (export bisa dibatalkan)', async () => {
  const kit = make(fakeSb([], { code: 'PGRST205', message: 'Could not find the table' }));
  kit.applyPreset('keluarga');
  assert.equal(await kit.loadNeeds([1]), false);
  assert.match(kit.needsError(), /03_keluarga_set\.sql/);
});

test('kolom Keluarga tidak ikut kalau tidak dipilih: tidak ada query ke view', async () => {
  const sb = fakeSb([]);
  const kit = make(sb); // standar
  assert.equal(await kit.loadNeeds([1, 2]), true);
  assert.equal(sb.calls.length, 0);
});