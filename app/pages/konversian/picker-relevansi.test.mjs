// Jalankan: node --test app/pages/konversian/picker-relevansi.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { tokensRelevansi, urutkanPicker } from './picker-relevansi.js';

const P = (kode, nama) => ({ kode_produk: kode, nama_produk: nama });
const kodes = (arr) => arr.map((x) => x.c.kode_produk);

test('tokens: "S." sendirian = SET, huruf tunggal lain dibuang, tanda baca & duplikat dirapikan', () => {
  assert.deepEqual(tokensRelevansi('Minor S.'), ['MINOR', 'SET']);
  assert.deepEqual(tokensRelevansi('Gunting Mayo, curved 17 cm'), ['GUNTING', 'MAYO', 'CURVED', '17CM']);
  assert.deepEqual(tokensRelevansi('  '), []);
  assert.deepEqual(tokensRelevansi(null), []);
});

test('MINOR: MINOR S. di atas, MAYOR S. tidak lagi di urutan teratas (hanya cocok lewat token lemah SET → Lainnya)', () => {
  const clip = [P('RB-MAYOR', 'MAYOR S.'), P('RB-MINOR', 'MINOR S.'), P('RB-GUNTING', 'GUNTING MAYO')];
  const r = urutkanPicker('Minor S.', clip);
  assert.deepEqual(kodes(r.cocok), ['RB-MINOR']);
  assert.deepEqual(kodes(r.lainnya), ['RB-MAYOR', 'RB-GUNTING']);
});

test('urutan Cocok = skor menurun, seri mengikuti urutan clipboard', () => {
  const clip = [P('A', 'GUNTING METZENBAUM'), P('B', 'GUNTING MAYO CURVED'), P('C', 'GUNTING MAYO'), P('D', 'GUNTING IRIS')];
  const r = urutkanPicker('Gunting Mayo Curved', clip);
  assert.deepEqual(kodes(r.cocok), ['B', 'C', 'A', 'D']);
  assert.equal(r.lainnya.length, 0);
});

test('produk yang sudah terpasang selalu Cocok dan paling atas, skor aslinya tetap dilaporkan', () => {
  const clip = [P('X1', 'MINOR S.'), P('SET-PACHO', 'SET PACHO'), P('X3', 'MAYOR S.')];
  const r = urutkanPicker('All Set Mata', clip, ['SET-PACHO']);
  assert.equal(kodes(r.cocok)[0], 'SET-PACHO');
  assert.ok(r.cocok[0].skor < 10);
});

test('angka polos dan kata jenis tidak bisa meloloskan produk sendirian', () => {
  const r = urutkanPicker('Scalpel handle no 3', [P('H4', 'SCALPEL HANDLE NO 4'), P('Z', 'PINSET 3 SET')]);
  assert.deepEqual(kodes(r.cocok), ['H4']);
  assert.deepEqual(kodes(r.lainnya), ['Z']);
});

test('permintaan tanpa token kuat: token lemah boleh menentukan; tanpa token sama sekali: semua ke Lainnya', () => {
  const clip = [P('A', 'MINOR S.'), P('B', 'GUNTING')];
  assert.deepEqual(kodes(urutkanPicker('Set', clip).cocok), ['A']);
  const kosong = urutkanPicker('', clip);
  assert.equal(kosong.cocok.length, 0);
  assert.deepEqual(kodes(kosong.lainnya), ['A', 'B']);
});

test('awalan kata ≥ 4 huruf cocok ("FORCEP" dibetulkan typo-nya jadi FORCEPS); clipboard kosong / bukan array aman', () => {
  assert.deepEqual(kodes(urutkanPicker('Forcep arteri', [P('F', 'ARTERY FORCEPS')]).cocok), ['F']);
  assert.deepEqual(urutkanPicker('x', []), { cocok: [], lainnya: [] });
  assert.deepEqual(urutkanPicker('minor', null), { cocok: [], lainnya: [] });
});

test('urutan clipboard asli tidak dimutasi', () => {
  const clip = [P('B', 'MAYOR S.'), P('A', 'MINOR S.')];
  urutkanPicker('minor', clip);
  assert.deepEqual(clip.map((c) => c.kode_produk), ['B', 'A']);
});
