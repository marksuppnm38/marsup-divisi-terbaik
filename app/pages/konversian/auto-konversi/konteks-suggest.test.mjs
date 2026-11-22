import assert from 'node:assert/strict';
import { suggestKonteks, suggestAll } from './konteks-suggest.js';

const k = (t, s) => (suggestKonteks(t, s) || {}).konteks || null;
assert.equal(k('MINOR SET'), 'SET');
assert.equal(k('Mayor Set'), 'SET');
assert.equal(k('SET MAYOR'), 'SET');
assert.equal(k('WHEELCHAIR'), 'UNIT');
assert.equal(k('WHEEL CHAIR'), 'UNIT');
assert.equal(k('KORENTANG'), 'INSTRUMENT');
assert.equal(k('PINSET ANATOMIS 14 CM'), 'INSTRUMENT'); // "PINSET" tidak boleh kebaca "SET"
assert.equal(k('BED SET'), null);                        // SET + UNIT: kosongkan
assert.equal(k('KLEM ARTERI', 'UNIT'), 'INSTRUMENT');    // satuan UNIT = cuma hitungan, nama instrumen menang
assert.equal(k('XYZ', 'SET'), 'SET');
assert.equal(k('XYZ', 'UNIT'), 'UNIT');
assert.equal(k('LAMPU SOROT'), null);
assert.equal(k(''), null);
assert.equal(suggestKonteks('GUNTING SET').conf, 'sedang');

// Skenario user: for loop 100 item dari 4 kata dasar
const base = ['minor set', 'mayor set', 'wheelchair', 'korentang'];
const items = Array.from({ length: 100 }, (_, i) => ({ raw_text: base[i % 4] + (i >= 4 ? ' ' + i : '') }));
const { out, cakupan } = suggestAll(items);
assert.equal(cakupan, 1);
console.log('ok · 100 item, cakupan usulan', Math.round(cakupan * 100) + '%');
