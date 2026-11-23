// Jalankan: node --test app/route-params.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { splitRest, isValidParam } from './route-params.js';

const UUID = '3f9c1a7e-5b2d-4c8a-9e61-0a7d2b4c8f10';

test('splitRest: tanpa sisa path -> tidak ada param, tidak ada extra', () => {
  assert.deepEqual(splitRest([]), { param: null, extra: false });
  assert.deepEqual(splitRest(undefined), { param: null, extra: false });
});

test('splitRest: satu segmen = param, dua atau lebih = extra', () => {
  assert.deepEqual(splitRest([UUID]), { param: UUID, extra: false });
  assert.deepEqual(splitRest([UUID, 'x']), { param: null, extra: true });
  assert.deepEqual(splitRest(['', UUID]), { param: null, extra: true });
});

test('isValidParam: UUID sah di crud-produk/set dan crud-produk/produk', () => {
  assert.equal(isValidParam('crud-produk', 'set', UUID), true);
  assert.equal(isValidParam('crud-produk', 'set', UUID.toUpperCase()), true);
  assert.equal(isValidParam('crud-produk', 'produk', UUID), true);
  assert.equal(isValidParam('crud-produk', 'produk', UUID.toUpperCase()), true);
});

test('isValidParam: sub/modul lain tetap menolak param apa pun (perilaku lama)', () => {
  assert.equal(isValidParam('crud-produk', 'akd', UUID), false);
  assert.equal(isValidParam('crud-produk', 'kfa', UUID), false);
  assert.equal(isValidParam('crud-produk', 'bulk', UUID), false);
  assert.equal(isValidParam('crud-produk', 'sync', UUID), false);
  assert.equal(isValidParam('crud-produk', 'orphan', UUID), false);
  assert.equal(isValidParam('crud-produk', null, UUID), false);
  assert.equal(isValidParam('konversian', 'cari', UUID), false);
  assert.equal(isValidParam('dashboard', null, UUID), false);
});

test('isValidParam: kode produk yang urut / bentuk ngawur ditolak', () => {
  assert.equal(isValidParam('crud-produk', 'set', 'AD999-KE921-B099-U01'), false);
  assert.equal(isValidParam('crud-produk', 'set', '123'), false);
  assert.equal(isValidParam('crud-produk', 'set', '75192'), false); // produk.id angka urut tidak boleh jadi URL
  assert.equal(isValidParam('crud-produk', 'set', ''), false);
  assert.equal(isValidParam('crud-produk', 'set', UUID + 'x'), false);
  assert.equal(isValidParam('crud-produk', 'set', "' or 1=1 --"), false);
  assert.equal(isValidParam('crud-produk', 'set', null), false);
});

test('isValidParam: crud-produk/produk menolak id angka, kode produk urut, dan injeksi (sama ketatnya dengan /set)', () => {
  for (const bad of ['75192', '123', 'AD999-KE921-B099-U01', 'RB999-KE878-B089-U09', '', UUID + 'x', 'x' + UUID, "' or 1=1 --", '../set/' + UUID, null, undefined, 42]) {
    assert.equal(isValidParam('crud-produk', 'produk', bad), false, String(bad));
  }
});
