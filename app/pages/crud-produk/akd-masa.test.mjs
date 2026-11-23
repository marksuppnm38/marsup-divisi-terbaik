import test from 'node:test';
import assert from 'node:assert/strict';
import { masaBerlakuInfo, AKD_WASPADA_HARI } from './akd-masa.js';

const TODAY = new Date(2026, 10, 23); // 23 Nov 2026 (waktu lokal)
const tone = (iso) => masaBerlakuInfo(iso, TODAY);

test('kosong / tidak valid -> none', () => {
  assert.equal(tone(null).tone, 'none');
  assert.equal(tone('').tone, 'none');
  assert.equal(tone('bukan tanggal').tone, 'none');
});

test('sudah lewat -> bad, dengan jumlah hari', () => {
  const r = tone('2026-11-22');
  assert.equal(r.tone, 'bad'); assert.equal(r.days, -1); assert.equal(r.hint, 'lewat 1 hari');
  assert.equal(tone('2026-10-24').hint, 'lewat 30 hari');
});

test('hari ini dan sampai 30 hari lagi -> warn (sama dengan filter "within 30" di tabel)', () => {
  assert.equal(tone('2026-11-23').tone, 'warn');
  assert.equal(tone('2026-11-23').hint, 'hari ini');
  const batas = tone('2026-12-23');
  assert.equal(batas.days, AKD_WASPADA_HARI); assert.equal(batas.tone, 'warn'); assert.equal(batas.hint, '30 hari lagi');
});

test('lebih dari 30 hari -> ok tanpa hint', () => {
  const r = tone('2026-12-24');
  assert.equal(r.tone, 'ok'); assert.equal(r.hint, '');
});

test('timestamp dengan jam tetap dibaca per tanggal', () => {
  assert.equal(tone('2026-12-24T17:00:00+00:00').tone, 'ok');
});

test('hari bertukar di batas tahun & bulan (tanpa bug zona waktu / DST)', () => {
  assert.equal(masaBerlakuInfo('2027-01-01', new Date(2026, 11, 31)).days, 1);
  assert.equal(masaBerlakuInfo('2026-03-30', new Date(2026, 2, 28)).days, 2);
});
