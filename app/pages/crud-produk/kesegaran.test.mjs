// Jalankan: node --test app/pages/crud-produk/kesegaran.test.mjs
// Penanda data basi: reload terjadi saat tampilannya kembali terlihat, sekali saja, dan tidak saat modal masih terbuka.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStaleTracker } from './kesegaran.js';

function make() {
  const log = [];
  const t = createStaleTracker({
    invalidate: () => log.push('invalidate'),
    reloadProduk: () => log.push('reloadProduk'),
    reloadDistinct: () => log.push('reloadDistinct'),
    reloadAkd: () => log.push('reloadAkd'),
  });
  return { t, log };
}

test('mark membuang cache seketika, tapi list belum dimuat ulang', () => {
  const { t, log } = make();
  t.mark();
  assert.deepEqual(log, ['invalidate']);
  assert.equal(t.isStale('produk'), true);
});

test('tanpa mark, flush tidak melakukan apa-apa', () => {
  const { t, log } = make();
  assert.deepEqual(t.flush('produk', false), []);
  assert.deepEqual(t.flush('akd', false), []);
  assert.deepEqual(log, []);
});

test('modal edit masih terbuka: tunda; setelah ditutup: reload Produk sekali', () => {
  const { t, log } = make();
  t.mark(); // mis. tambah harga di modal
  assert.deepEqual(t.flush('produk', true), []);
  assert.deepEqual(t.flush('produk', false), ['produk']);
  assert.deepEqual(t.flush('produk', false), []); // sudah terlayani
  assert.deepEqual(log, ['invalidate', 'reloadProduk']);
});

test('perubahan dari tab lain menunggu sampai tab Produk dibuka', () => {
  const { t, log } = make();
  t.mark(); // mis. Set Management / Sync dari Sheet
  assert.deepEqual(t.flush('set', false), []);
  assert.deepEqual(t.flush('sync', false), []);
  assert.deepEqual(t.flush('produk', false), ['produk']);
  assert.equal(log.filter((x) => x === 'reloadProduk').length, 1);
});

test('banyak mark berturut-turut = satu reload', () => {
  const { t, log } = make();
  t.mark(); t.mark(); t.mark();
  t.flush('produk', false);
  assert.equal(log.filter((x) => x === 'reloadProduk').length, 1);
});

test('opsi dropdown (distinct) ikut dimuat ulang hanya kalau diminta', () => {
  const a = make();
  a.t.mark();
  assert.deepEqual(a.t.flush('produk', false), ['produk']);
  const b = make();
  b.t.mark({ distinct: true });
  assert.deepEqual(b.t.flush('produk', false), ['produk', 'distinct']);
  assert.deepEqual(b.log.slice(-2), ['reloadProduk', 'reloadDistinct']);
});

test('AKD basi dimuat ulang saat tab AKD dibuka, terpisah dari Produk', () => {
  const { t, log } = make();
  t.mark({ akd: true });
  assert.deepEqual(t.flush('akd', false), ['akd']);
  assert.deepEqual(t.flush('akd', false), []);
  assert.deepEqual(t.flush('produk', false), ['produk']); // Produk tetap menunggu gilirannya
  assert.deepEqual(log.filter((x) => x.startsWith('reload')), ['reloadAkd', 'reloadProduk']);
});

test('settle: muat ulang penuh yang sudah berjalan menghapus tanda (tidak reload dobel)', () => {
  const { t, log } = make();
  t.mark({ akd: true });
  t.settle('produk'); t.settle('akd');
  assert.deepEqual(t.flush('produk', false), []);
  assert.deepEqual(t.flush('akd', false), []);
  assert.deepEqual(log, ['invalidate']);
});

test('distinct berdiri sendiri: list sudah dimuat ulang (settle), opsi dropdown tetap menunggu tab Produk', () => {
  const { t, log } = make();
  t.mark({ distinct: true }); // mis. Bulk Edit mengisi brand baru lalu langsung loadProduk()
  t.settle('produk');
  assert.deepEqual(t.flush('bulk', false), []);
  assert.deepEqual(t.flush('produk', true), []);          // modal terbuka: tunda
  assert.deepEqual(t.flush('produk', false), ['distinct']); // list tidak dimuat dobel
  assert.deepEqual(log.filter((x) => x.startsWith('reload')), ['reloadDistinct']);
});
