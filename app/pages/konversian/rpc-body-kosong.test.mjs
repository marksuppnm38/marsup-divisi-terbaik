// Jalankan: node --test app/pages/konversian/rpc-body-kosong.test.mjs
// rpc() hidup di dalam closure clipboard.js, jadi fungsinya diambil dari teks sumber (anchor hilang = test gagal keras).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('./clipboard.js', import.meta.url), 'utf8');
const a = src.indexOf('async function rpc(fn, params)');
const b = src.indexOf('S.rpc = rpc;', a);
assert.ok(a > 0 && b > a, 'anchor rpc() di clipboard.js tidak ditemukan');
const fnSrc = src.slice(a, b);

const bikinRpc = (status, body) => {
  const sesiFetch = async () => ({ ok: status >= 200 && status < 300, status, text: async () => body });
  return new Function('sesiFetch', `${fnSrc}; return rpc;`)(sesiFetch);
};

test('204 / body kosong = sukses (RPC void), bukan SyntaxError', async () => {
  assert.deepEqual(await bikinRpc(204, '')('update_permintaan_pagu', {}), { data: null, error: null });
  assert.deepEqual(await bikinRpc(200, '  ')('x', {}), { data: null, error: null });
});
test('200 JSON biasa tetap terbaca (termasuk null dan array)', async () => {
  assert.deepEqual(await bikinRpc(200, '{"a":1}')('x', {}), { data: { a: 1 }, error: null });
  assert.deepEqual(await bikinRpc(200, '[1,2]')('x', {}), { data: [1, 2], error: null });
  assert.deepEqual(await bikinRpc(200, 'null')('x', {}), { data: null, error: null });
});
test('error JSON dari PostgREST diteruskan apa adanya (callers baca error.message/hint)', async () => {
  const err = { code: 'PGRST202', message: 'Could not find the function', hint: 'cek migration' };
  assert.deepEqual(await bikinRpc(404, JSON.stringify(err))('x', {}), { data: null, error: err });
});
test('404 HTML / teks biasa -> error terbaca dengan status dan potongan isi', async () => {
  const r = await bikinRpc(404, 'File not found')('x', {});
  assert.equal(r.data, null);
  assert.match(r.error.message, /^HTTP 404: File not found$/);
  const r2 = await bikinRpc(502, '')('x', {});
  assert.equal(r2.error.message, 'HTTP 502');
});
test('200 tapi bukan JSON -> error "bukan JSON", isi dipotong 160 karakter', async () => {
  const r = await bikinRpc(200, '<html>' + 'x'.repeat(400) + '</html>')('x', {});
  assert.match(r.error.message, /^Respons server bukan JSON \(HTTP 200\): <html>/);
  assert.ok(r.error.message.length < 230);
});
