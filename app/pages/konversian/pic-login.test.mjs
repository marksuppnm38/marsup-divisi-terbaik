// Jalankan: node --test app/pages/konversian/pic-login.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { picDariEmail, namaPicSaya } from './pic-login.js';

test('picDariEmail: bagian sebelum @, huruf kecil, trim', () => {
  assert.equal(picDariEmail('stephanussabd@gmail.com'), 'stephanussabd');
  assert.equal(picDariEmail('  Bakar@Pionir.CO.ID '), 'bakar');
  assert.equal(picDariEmail('nama.depan+tag@x.com'), 'nama.depan+tag');
});

test('picDariEmail: email tak valid / kosong / bukan teks -> ""', () => {
  for (const e of ['', '   ', 'tanpa-at', '@x.com', ' @x.com', null, undefined, 0, {}, []]) assert.equal(picDariEmail(e), '', String(e));
});

test('picDariEmail: hanya @ pertama yang jadi pemisah', () => {
  assert.equal(picDariEmail('a@b@c.com'), 'a');
});

test('namaPicSaya: login + nama lama, tanpa duplikat (case-insensitive)', () => {
  assert.deepEqual(namaPicSaya('bakar@x.com', 'Stephanus'), ['bakar', 'Stephanus']);
  assert.deepEqual(namaPicSaya('bakar@x.com', 'Bakar'), ['bakar']);
  assert.deepEqual(namaPicSaya('bakar@x.com', ''), ['bakar']);
  assert.deepEqual(namaPicSaya(null, ' Lama '), ['Lama']);
  assert.deepEqual(namaPicSaya(null, null), []);
});
