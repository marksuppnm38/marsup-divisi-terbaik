// Jalankan: node --test auto-konversi/anchor.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { tawarkan, hitung, labelOpsi, labelSinyal, ANCHOR_LEVEL } from './anchor.js';

const baris = (o) => ({ kode_produk: 'X', nama_produk: 'X', anchor: false, ditawarkan: true, alasan_tolak: null, sinyal: [], tier: 'standar', nomor: null, ...o });

test('tawarkan: memanggil RPC dengan kontrak yang benar dan membiarkan urutan DB', async () => {
  let args;
  const rpc = async (fn, p) => { args = [fn, p]; return { data: [baris({ kode_produk: 'A', anchor: true }), baris({ kode_produk: 'C' }), baris({ kode_produk: 'B' })], error: null }; };
  const r = await tawarkan(rpc, 'A', { brand: 'adler' });
  assert.deepEqual(args, ['auto_konversi_tawarkan', { p_kode: 'A', p_brand: 'ADLER', p_sertakan_ditolak: false, p_batas: 50, p_level: 2 }]);
  assert.equal(r.anchor.kode_produk, 'A');
  assert.deepEqual(r.opsi.map((o) => o.kode_produk), ['C', 'B']); // tidak diurutkan ulang
});

test('tawarkan: anchor tidak firm tetap jadi tanda, bukan opsi; baris ditawarkan=false tidak jadi pilihan', async () => {
  const rpc = async () => ({ data: [baris({ kode_produk: 'A', anchor: true, ditawarkan: false, alasan_tolak: 'link V6 belum dibuat' }), baris({ kode_produk: 'B' }), baris({ kode_produk: 'Z', ditawarkan: false })], error: null });
  const r = await tawarkan(rpc, 'A', {});
  assert.equal(r.anchor.alasan_tolak, 'link V6 belum dibuat');
  assert.deepEqual(r.opsi.map((o) => o.kode_produk), ['B']);
  const debug = await tawarkan(rpc, 'A', { sertakanDitolak: true });
  assert.deepEqual(debug.opsi.map((o) => o.kode_produk), ['B', 'Z']); // mode admin/debug
});

test('tawarkan: level dan brand default; error RPC dilempar', async () => {
  let p;
  await tawarkan(async (f, a) => { p = a; return { data: [], error: null }; }, 'A', { level: ANCHOR_LEVEL.SEJENIS });
  assert.equal(p.p_level, 3); assert.equal(p.p_brand, 'ROBUST');
  await assert.rejects(tawarkan(async () => ({ data: null, error: { message: 'boom' } }), 'A', {}), /boom/);
});

test('hitung: n per anchor (tanpa anchor), kode tanpa baris = 0, satu RPC batch', async () => {
  let n = 0, args;
  const rpc = async (fn, a) => { n++; args = [fn, a]; return { data: [{ kode_produk: 'A', n: 3 }], error: null }; };
  const m = await hitung(rpc, ['A', 'B', 'A', null], { brand: 'robust' });
  assert.equal(n, 1);
  assert.deepEqual(args, ['auto_konversi_tawarkan_hitung', { p_kodes: ['A', 'B'], p_brand: 'ROBUST', p_level: 2 }]);
  assert.equal(m.get('A'), 3); assert.equal(m.get('B'), 0);
  assert.equal((await hitung(rpc, [], {})).size, 0); assert.equal(n, 1); // kosong: tidak memanggil RPC
  await assert.rejects(hitung(async () => ({ data: null, error: { message: 'x' } }), ['A'], {}), /x/);
});

test('label: tier+nomor dan sinyal (sinyal asing tampil apa adanya)', () => {
  assert.equal(labelOpsi({ tier: 'basic', nomor: 2 }), 'Basic S.2');
  assert.equal(labelOpsi({ tier: 'complete', nomor: null }), 'Complete');
  assert.equal(labelSinyal('prosedur'), 'Prosedur sama');
  assert.equal(labelSinyal('baru'), 'baru');
});
