// Test mock-akd.js — jalankan: node --test mock-akd.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseKodeSet, gabungkanSet, hitungQty, mockFileName } from './mock-akd.js';

const it = (kode, qty = 1, deskripsi = 'desk ' + kode) => ({ kode, deskripsi, qty });
const mayo1 = { kode: 'SET-MAYO-1', items: [it('A', 2), it('B', 1), it('C', 1)] };
const mayo2 = { kode: 'SET-MAYO-2', items: [it('B', 1), it('C', 3), it('D', 1)] };
const mayo3 = { kode: 'SET-MAYO-3', items: [it('A', 2), it('D', 1), it('E', 4)] };

test('parseKodeSet: pisah baris/spasi/koma, buang duplikat tanpa peduli huruf besar', () => {
  assert.deepEqual(parseKodeSet('SET-1\nset-2, SET-3;  SET-1\n\n'), ['SET-1', 'set-2', 'SET-3']);
  assert.deepEqual(parseKodeSet(''), []);
  assert.deepEqual(parseKodeSet(null), []);
});

test('gabung 3 set: tiap item unik cuma sekali, urutan kemunculan pertama', () => {
  const { items, stat } = gabungkanSet([mayo1, mayo2, mayo3]);
  assert.deepEqual(items.map((i) => i.kode), ['A', 'B', 'C', 'D', 'E']);
  assert.equal(stat.jumlahSet, 3);
  assert.equal(stat.barisAsli, 9);
  assert.equal(stat.itemUnik, 5);
  assert.equal(stat.duplikat, 4);
});

test('qty default = terbesar antar set', () => {
  const { items } = gabungkanSet([mayo1, mayo2, mayo3]);
  const q = Object.fromEntries(items.map((i) => [i.kode, i.qty]));
  assert.deepEqual(q, { A: 2, B: 1, C: 3, D: 1, E: 4 });
});

test('strategi jumlah & pertama', () => {
  const jml = Object.fromEntries(gabungkanSet([mayo1, mayo2, mayo3], { qty: 'jumlah' }).items.map((i) => [i.kode, i.qty]));
  assert.deepEqual(jml, { A: 4, B: 2, C: 4, D: 2, E: 4 });
  const prt = Object.fromEntries(gabungkanSet([mayo1, mayo2, mayo3], { qty: 'pertama' }).items.map((i) => [i.kode, i.qty]));
  assert.deepEqual(prt, { A: 2, B: 1, C: 1, D: 1, E: 4 });
});

test('sumber, qtyBeda, dan disemuaSet terisi benar', () => {
  const { items, stat } = gabungkanSet([mayo1, mayo2, mayo3]);
  const c = items.find((i) => i.kode === 'C');
  assert.deepEqual(c.sumber, [{ set: 'SET-MAYO-1', qty: 1 }, { set: 'SET-MAYO-2', qty: 3 }]);
  assert.equal(c.qtyBeda, true);
  assert.equal(items.find((i) => i.kode === 'A').qtyBeda, false);
  assert.equal(items.find((i) => i.kode === 'E').disemuaSet, false);
  assert.equal(stat.qtyBeda, 1);
});

test('kode sama beda huruf besar/kecil & spasi dianggap satu item', () => {
  const { items } = gabungkanSet([
    { kode: 'S1', items: [it(' rb-01 ', 1)] },
    { kode: 'S2', items: [it('RB-01', 2)] },
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].qty, 2);
});

test('baris kembar di satu set dijumlahkan dulu (komposisi set itu sendiri)', () => {
  const { items, stat } = gabungkanSet([
    { kode: 'S1', items: [it('X', 1), it('X', 2)] },
    { kode: 'S2', items: [it('X', 2)] },
  ]);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].sumber, [{ set: 'S1', qty: 3 }, { set: 'S2', qty: 2 }]);
  assert.equal(items[0].qty, 3);
  assert.equal(stat.barisAsli, 3);
});

test('deskripsi kosong di set pertama diisi dari set berikutnya', () => {
  const { items } = gabungkanSet([
    { kode: 'S1', items: [{ kode: 'Z', deskripsi: '', qty: 1 }] },
    { kode: 'S2', items: [{ kode: 'Z', deskripsi: 'Gunting Z', qty: 1 }] },
  ]);
  assert.equal(items[0].deskripsi, 'Gunting Z');
});

test('item tanpa kode tidak menyatu satu sama lain (kunci = deskripsi)', () => {
  const { items } = gabungkanSet([{ kode: 'S1', items: [
    { kode: '', deskripsi: 'Alat satu', qty: 1 },
    { kode: '(tanpa kode)', deskripsi: 'Alat dua', qty: 1 },
  ] }]);
  assert.equal(items.length, 2);
});

test('qty kosong / 0 / negatif dianggap 1; input kosong aman', () => {
  assert.equal(hitungQty([{ set: 'a', qty: 0 }, { set: 'b', qty: -3 }], 'max'), 1);
  assert.equal(hitungQty([], 'max'), 1);
  const r = gabungkanSet([]);
  assert.deepEqual(r.items, []);
  assert.equal(r.stat.itemUnik, 0);
});

test('mockFileName', () => {
  assert.equal(mockFileName('MAYO 1 + 2 + 3'), 'MOCK_AKD_MAYO_1_2_3.pdf');
  assert.equal(mockFileName(''), 'MOCK_AKD_set-gabungan.pdf');
});
