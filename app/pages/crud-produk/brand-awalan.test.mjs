// Jalankan: node --test app/pages/crud-produk/brand-awalan.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { BRAND_AWALAN, brandDariKode, peringatanBrand, opsiBrand } from './brand-awalan.js';

test('brandDariKode: RB/AD dikenal, case-insensitive, awalan lain null', () => {
  assert.equal(brandDariKode('RB999-KE921'), 'ROBUST');
  assert.equal(brandDariKode('ad999-ke921'), 'ADLER');
  assert.equal(brandDariKode(' AD1'), 'ADLER');
  assert.equal(brandDariKode('SK123'), null);
  assert.equal(brandDariKode('3C01'), null);
  assert.equal(brandDariKode(''), null);
  assert.equal(brandDariKode(null), null);
  assert.equal(brandDariKode('A'), null);
});

test('peringatanBrand: cocok -> null; beda/kosong -> saran; awalan tak dikenal -> null', () => {
  assert.equal(peringatanBrand('AD1', 'ADLER'), null);
  assert.equal(peringatanBrand('AD1', ' adler '), null);
  const beda = peringatanBrand('AD1', 'ROBUST');
  assert.equal(beda.saran, 'ADLER');
  assert.match(beda.pesan, /AD biasanya ADLER, bukan ROBUST/);
  const kosong = peringatanBrand('RB1', '');
  assert.equal(kosong.saran, 'ROBUST');
  assert.match(kosong.pesan, /kosong/);
  assert.equal(peringatanBrand('SK1', ''), null);
  assert.equal(peringatanBrand('SK1', 'ROBUST'), null);
  assert.equal(peringatanBrand('', 'ADLER'), null);
});

test('opsiBrand: unik, uppercase, urut, nilai sekarang ikut walau belum ada di data', () => {
  assert.deepEqual(opsiBrand(['ROBUST', 'ADLER', 'Adler', ''], ''), ['ADLER', 'ROBUST']);
  assert.deepEqual(opsiBrand(['ROBUST'], 'skylar'), ['ROBUST', 'SKYLAR']);
  assert.deepEqual(opsiBrand(null, null), []);
});

test('BRAND_AWALAN beku', () => {
  assert.throws(() => { 'use strict'; BRAND_AWALAN.XX = 'Y'; });
});
