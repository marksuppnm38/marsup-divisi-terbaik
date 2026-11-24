// Jalankan: node --test app/pages/konversian/search-operator.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { bacaKetikan } from './search-operator.js';

const w = (...xs) => xs.map(x => (typeof x === 'string' ? { w: x } : x));

// ketikan -> [adaOperator, json.must, json.not, terjemah]
const KASUS = [
  ['basic mayor', false, [w('basic'), w('mayor')], [], 'Mencari: basic DAN mayor'],
  ['mayor | laparotomy', true, [w('mayor', 'laparotomy')], [], 'Mencari: mayor ATAU laparotomy'],
  ['mayor|laparotomy', true, [w('mayor', 'laparotomy')], [], 'Mencari: mayor ATAU laparotomy'],
  ['basic mayor | laparotomy', true, [w('basic'), w('mayor', 'laparotomy')], [], 'Mencari: basic DAN (mayor ATAU laparotomy)'],
  ['a1 | b2 | c3', true, [w('a1', 'b2', 'c3')], [], 'Mencari: a1 ATAU b2 ATAU c3'],
  ['mayor -pediatric', true, [w('mayor')], w('pediatric'), 'Mencari: mayor · tanpa: pediatric'],
  ['mayor -pediatric -tc', true, [w('mayor')], w('pediatric', 'tc'), 'Mencari: mayor · tanpa: pediatric, tc'],
  ['"basic mayor"', true, [w('basic mayor')], [], 'Mencari: \u201Cbasic mayor\u201D'],
  ['"basic mayor" set', true, [w('basic mayor'), w('set')], [], 'Mencari: \u201Cbasic mayor\u201D DAN set'],
  ['spek:metzen', true, [[{ w: 'metzen', c: 'C' }]], [], 'Mencari: metzen di spesifikasi'],
  ['spesifikasi:metzen', true, [[{ w: 'metzen', c: 'C' }]], [], 'Mencari: metzen di spesifikasi'],
  ['nama:scissor kode:rb999', true, [[{ w: 'scissor', c: 'B' }], [{ w: 'rb999', c: 'A' }]], [], 'Mencari: scissor di nama DAN rb999 di kode'],
  ['spek:"dissect scissors"', true, [[{ w: 'dissect scissors', c: 'C' }]], [], 'Mencari: \u201Cdissect scissors\u201D di spesifikasi'],
  ['scissor -spek:metzen', true, [w('scissor')], [{ w: 'metzen', c: 'C' }], 'Mencari: scissor · tanpa: metzen di spesifikasi'],
  // jebakan data asli: tidak boleh dianggap operator
  ['RB999-KE921-B99-U02', false, [w('RB999-KE921-B99-U02')], [], 'Mencari: RB999-KE921-B99-U02'],
  ['Ø 80 MM', false, [w('80'), w('MM')], [], 'Mencari: 80 DAN MM'],
  ['0,14 L', false, [w('0,14')], [], 'Mencari: 0,14'],
  ['5X6 T.', false, [w('5X6')], [], 'Mencari: 5X6'],
  ['forceps 6"', false, [w('forceps')], [], 'Mencari: forceps'],
  ['"forceps 6', false, [w('"forceps')], [], 'Mencari: "forceps'],
  ['gunting - lurus', false, [w('gunting'), w('lurus')], [], 'Mencari: gunting DAN lurus'],
  ['brand:robust', false, [w('brand:robust')], [], 'Mencari: brand:robust'],
];

for (const [ketik, adaOp, must, not, terjemah] of KASUS) {
  test(`bacaKetikan: ${JSON.stringify(ketik)}`, () => {
    const r = bacaKetikan(ketik);
    assert.equal(r.adaOperator, adaOp, 'adaOperator');
    assert.deepEqual(r.json.must, must, 'must');
    assert.deepEqual(r.json.not, not, 'not');
    assert.equal(r.terjemah, terjemah, 'terjemah');
    assert.equal(r.valid, true);
  });
}

test('hanya kata kecuali -> tidak valid, ada pesan', () => {
  const r = bacaKetikan('-pediatric');
  assert.equal(r.adaOperator, true);
  assert.equal(r.valid, false);
  assert.ok(r.pesan.length > 0);
});

test('| sendirian / di ujung tidak merusak', () => {
  assert.equal(bacaKetikan('|').valid, false);
  assert.equal(bacaKetikan('|').adaOperator, false);
  const r = bacaKetikan('mayor |');
  assert.equal(r.adaOperator, false);
  assert.deepEqual(r.json.must, [w('mayor')]);
  assert.equal(bacaKetikan('| mayor').adaOperator, false);
});

test('| di sebelah -kata tidak menyambung ke kata lain', () => {
  const r = bacaKetikan('mayor | -pediatric');
  assert.deepEqual(r.json.must, [w('mayor')]);
  assert.deepEqual(r.json.not, w('pediatric'));
});

test('kosong / bukan teks aman', () => {
  for (const x of ['', '   ', null, undefined]) {
    const r = bacaKetikan(x);
    assert.equal(r.adaOperator, false);
    assert.equal(r.valid, false);
  }
});

test('kata 1 huruf dibuang seperti pencarian lama', () => {
  const r = bacaKetikan('a | b');
  assert.equal(r.valid, false);
});