// Tes chip kesiapan jual (link V6/AKD) untuk baris varian & alternatif: `npm test`
import test from 'node:test';
import assert from 'node:assert/strict';
import { siapChipsHtml, firmChipHtml, labelKurang } from '../app/pages/konversian/auto-konversi/siap.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

test('siap.ok → satu chip "Link ✓" hijau', () => {
  const h = siapChipsHtml({ ok: true, kurang: [] }, esc);
  assert.match(h, /kb-siap ok/); assert.match(h, />Link ✓</);
});

test('tidak dicek (undefined / bentuk tak dikenal) → tidak ada chip, bukan tebakan', () => {
  assert.equal(siapChipsHtml(undefined, esc), '');
  assert.equal(siapChipsHtml(null, esc), '');
  assert.equal(siapChipsHtml({}, esc), '');
});

test('belum siap → satu chip kuning per kekurangan, label singkat + judul lengkap', () => {
  const h = siapChipsHtml({ ok: false, kurang: ['link V6 belum dibuat', 'AKD belum ada'] }, esc);
  assert.equal((h.match(/kb-siap warn/g) || []).length, 2);
  assert.match(h, />Belum ada link</); assert.match(h, />AKD belum ada</);
  assert.match(h, /title="link V6 belum dibuat"/);
});

test('label kurang: semua kosakata firm.js dikenali, yang asing apa adanya', () => {
  assert.equal(labelKurang('belum firm (link V6 ada catatan)'), 'Link ada catatan');
  assert.equal(labelKurang('link V6 bukan URL'), 'Link bukan URL');
  assert.equal(labelKurang('AKD belum bisa dicek'), 'AKD belum bisa dicek');
  assert.equal(labelKurang('hal baru'), 'hal baru');
});

test('teks dari data di-escape', () => {
  const h = siapChipsHtml({ ok: false, kurang: ['<img onerror=x>'] }, esc);
  assert.ok(!h.includes('<img'));
});

test('firm boolean: true hijau, false kuning, selain itu kosong', () => {
  assert.match(firmChipHtml(true, esc), /kb-siap ok/);
  assert.match(firmChipHtml(false, esc), /kb-siap warn/);
  assert.equal(firmChipHtml(undefined, esc), '');
  assert.equal(firmChipHtml(null, esc), '');
});
