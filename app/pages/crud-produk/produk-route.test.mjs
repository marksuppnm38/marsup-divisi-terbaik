// Jalankan: node --test app/pages/crud-produk/produk-route.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { produkPath, isProdukDetailPath, tokenQuery } from './produk-route.js';

const UUID = '3f9c1a7e-5b2d-4c8a-9e61-0a7d2b4c8f10';

test('produkPath: /crud-produk/produk/<token>', () => {
  assert.equal(produkPath(UUID), '/crud-produk/produk/' + UUID);
});

test('produkPath: karakter khusus di-encode, tidak bisa menyisipkan segmen path baru', () => {
  assert.equal(produkPath('a/b'), '/crud-produk/produk/a%2Fb');
  assert.equal(produkPath('x?y=1#z'), '/crud-produk/produk/x%3Fy%3D1%23z');
});

test('isProdukDetailPath: hanya /crud-produk/produk/<uuid> (slash penutup boleh, huruf besar boleh)', () => {
  assert.equal(isProdukDetailPath('/crud-produk/produk/' + UUID), true);
  assert.equal(isProdukDetailPath('/crud-produk/produk/' + UUID + '/'), true);
  assert.equal(isProdukDetailPath('/crud-produk/produk/' + UUID.toUpperCase()), true);
});

test('isProdukDetailPath: daftar, sub lain, set, dan bentuk ngawur = false', () => {
  for (const p of ['/crud-produk', '/crud-produk/', '/crud-produk/produk', '/crud-produk/produk/', '/crud-produk/set/' + UUID,
    '/crud-produk/kfa/' + UUID, '/konversian/produk/' + UUID, '/crud-produk/produk/123', '/crud-produk/produk/AD999-KE921-B099-U01',
    '/crud-produk/produk/' + UUID + '/extra', '/crud-produk/produk/' + UUID + 'x', '/produk/' + UUID, '', '/']) {
    assert.equal(isProdukDetailPath(p), false, p);
  }
  assert.equal(isProdukDetailPath(null), false);
  assert.equal(isProdukDetailPath(undefined), false);
});

// Supabase tiruan: mencatat rantai builder.
function fakeSb() {
  const calls = [];
  const chain = new Proxy({}, { get: (_, name) => (...args) => { calls.push([name, ...args]); return chain; } });
  return { calls, from: (t) => { calls.push(['from', t]); return chain; } };
}

test("tokenQuery('set'): hanya tipe SET, token di-lowercase", () => {
  const sb = fakeSb();
  tokenQuery(sb, 'set', UUID.toUpperCase());
  assert.deepEqual(sb.calls, [['from', 'produk'], ['select', 'id, kode_produk'], ['eq', 'url_token', UUID], ['eq', 'tipe', 'SET']]);
});

test("tokenQuery('produk'): bukan SET (tipe kosong ikut), tidak pernah memakai eq tipe SET", () => {
  const sb = fakeSb();
  tokenQuery(sb, 'produk', UUID);
  assert.deepEqual(sb.calls, [['from', 'produk'], ['select', 'id, kode_produk'], ['eq', 'url_token', UUID], ['or', 'tipe.is.null,tipe.neq.SET']]);
});
