// Jalankan: node --test app/pages/crud-produk/keluarga-pilih.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { kunciKeluarga, statusKeluarga } from './keluarga-pilih.js';

const ADA = ['BASIC MINOR S. 2', 'MAYOR S. 2', 'MAYOR S. 3', 'AS.', 'BASIC OBGYN (GYNAECOLOGICAL) AS'];

test('kunciKeluarga mengabaikan tanda baca, spasi, huruf besar-kecil', () => {
  assert.equal(kunciKeluarga('Basic Minor S. 2'), 'BASICMINORS2');
  assert.equal(kunciKeluarga('basic-minor s 2'), 'BASICMINORS2');
  assert.equal(kunciKeluarga(null), '');
  assert.equal(kunciKeluarga('...'), '');
});

test('statusKeluarga: kosong', () => {
  assert.equal(statusKeluarga('', ADA).jenis, 'kosong');
  assert.equal(statusKeluarga('   ', ADA).jenis, 'kosong');
  assert.equal(statusKeluarga(null, ADA).nilai, null);
});

test('statusKeluarga: ada (dirapikan + huruf besar)', () => {
  const s = statusKeluarga('  mayor   s. 2 ', ADA);
  assert.equal(s.jenis, 'ada');
  assert.equal(s.nilai, 'MAYOR S. 2');
});

test('statusKeluarga: mirip = beda tanda baca/spasi saja, saran memakai nama yang sudah ada', () => {
  const a = statusKeluarga('AS', ADA);
  assert.equal(a.jenis, 'mirip');
  assert.deepEqual(a.saran, ['AS.']);
  const b = statusKeluarga('basic minor s 2', ADA);
  assert.equal(b.jenis, 'mirip');
  assert.deepEqual(b.saran, ['BASIC MINOR S. 2']);
});

test('statusKeluarga: nomor varian berbeda BUKAN mirip (keluarga baru yang sah)', () => {
  const s = statusKeluarga('MAYOR S. 4', ADA);
  assert.equal(s.jenis, 'baru');
  assert.deepEqual(s.saran, []);
});

test('statusKeluarga: daftar kosong / null -> baru', () => {
  assert.equal(statusKeluarga('XYZ', []).jenis, 'baru');
  assert.equal(statusKeluarga('XYZ', null).jenis, 'baru');
});

test('statusKeluarga: saran maksimal 3 dan unik', () => {
  const s = statusKeluarga('AS', ['AS.', 'AS.', 'A.S', 'A S', 'A-S']);
  assert.equal(s.jenis, 'mirip');
  assert.ok(s.saran.length <= 3);
  assert.equal(new Set(s.saran).size, s.saran.length);
});
