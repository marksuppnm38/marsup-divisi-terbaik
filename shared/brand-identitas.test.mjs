// Jalankan: node --test shared/brand-identitas.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { BRAND_KEY, BRAND_LOGO, kunciBrand, logoBrand, labelBrand, brandChipHtml } from './brand-identitas.js';

// escape sederhana untuk tes (sama maksudnya dengan S.escapeHtmlAttr)
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

test('kunciBrand: case-insensitive + trim', () => {
  assert.equal(kunciBrand('ROBUST'), 'robust');
  assert.equal(kunciBrand('robust'), 'robust');
  assert.equal(kunciBrand('  Adler '), 'adler');
  assert.equal(kunciBrand('PiCmA'), 'picma');
});

test('kunciBrand: brand tak bertema, kosong, null/undefined, bukan teks -> ""', () => {
  for (const b of ['SKYLAR', 'SCHAFER', 'NASHORN', '', '   ', null, undefined, 0, {}, []]) assert.equal(kunciBrand(b), '', String(b));
});

test('kunciBrand: nama properti Object.prototype tidak lolos', () => {
  for (const b of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) assert.equal(kunciBrand(b), '', b);
});

test('logoBrand: objek logo untuk brand bertema, null untuk lainnya', () => {
  assert.equal(logoBrand('ROBUST'), BRAND_LOGO.robust);
  assert.equal(logoBrand('adler').src, '/assets/adler-logo.png');
  assert.equal(logoBrand('SKYLAR'), null);
  assert.equal(logoBrand(null), null);
  assert.equal(logoBrand(undefined), null);
});

test('PICMA bertanda warna; ROBUST/ADLER tidak', () => {
  assert.equal(BRAND_LOGO.picma.warna, true);
  assert.equal(BRAND_LOGO.robust.warna, undefined);
  assert.equal(BRAND_LOGO.adler.warna, undefined);
});

test('tabel konstanta: setiap kunci punya logo lengkap dan src lokal', () => {
  for (const k of Object.values(BRAND_KEY)) {
    const l = BRAND_LOGO[k];
    assert.ok(l, k);
    assert.match(l.src, /^\/assets\/[a-z]+-logo\.png$/);
    assert.ok(l.ratio > 0 && l.h > 0 && l.hChip > 0 && l.hChip <= l.h, k);
  }
  assert.ok(Object.isFrozen(BRAND_KEY) && Object.isFrozen(BRAND_LOGO));
});

test('labelBrand: huruf awal besar, sisanya kecil', () => {
  assert.equal(labelBrand('ROBUST'), 'Robust');
  assert.equal(labelBrand(' skylar '), 'Skylar');
  assert.equal(labelBrand(''), '');
  assert.equal(labelBrand(null), '');
});

test('brandChipHtml: brand kosong -> ""', () => {
  assert.equal(brandChipHtml('', esc), '');
  assert.equal(brandChipHtml('  ', esc), '');
  assert.equal(brandChipHtml(null, esc), '');
  assert.equal(brandChipHtml(undefined, esc), '');
});

test('brandChipHtml: brand bertema -> chip logo dengan teks di aria-label/title', () => {
  const h = brandChipHtml('ROBUST', esc);
  assert.match(h, /class="mi mi-brand brand-chip"/);
  assert.match(h, /aria-label="Brand Robust"/);
  assert.match(h, /title="Brand Robust"/);
  assert.match(h, /--logo:url\(\/assets\/robust-logo\.png\)/);
  assert.match(h, /--h:8px/);
  assert.ok(!h.includes('is-warna'));
});

test('brandChipHtml: PICMA diberi is-warna dan tinggi lebih besar', () => {
  const h = brandChipHtml('picma', esc);
  assert.match(h, /brand-chip is-warna/);
  assert.match(h, /--h:14px/);
  assert.match(h, /picma-logo\.png/);
});

test('brandChipHtml: brand tanpa tema -> chip teks netral, tanpa logo', () => {
  const h = brandChipHtml('SKYLAR', esc);
  assert.match(h, /class="mi mi-brand"/);
  assert.match(h, /<span>Skylar<\/span>/);
  assert.ok(!h.includes('brand-logo-mark') && !h.includes('--logo') && !h.includes('brand-chip') && !h.includes('<i '));
});

test('brandChipHtml: brand berisi HTML/kutip tidak lolos mentah', () => {
  for (const jahat of ['<script>alert(1)</script>', '"><img src=x onerror=alert(1)>', "x' onmouseover='alert(1)"]) {
    const h = brandChipHtml(jahat, esc);
    assert.ok(!h.includes('<script'), jahat);
    assert.ok(!h.includes('<img'), jahat);
    assert.ok(!/title="Brand [^"]*"[^>]*onerror=/.test(h), jahat);
    assert.ok(!h.includes('--logo'), 'brand tak dikenal tidak boleh dapat logo: ' + jahat);
    assert.ok(!/[^&]"[^>]*onmouseover=/.test(h.replace(/class="[^"]*"|title="[^"]*"/g, '')), jahat);
  }
});

test('brandChipHtml: src logo hanya dari tabel konstanta (brand bertema + sisipan teks tak mengubah src)', () => {
  const h = brandChipHtml(' ROBUST ', esc);
  assert.equal((h.match(/url\(([^)]*)\)/) || [])[1], BRAND_LOGO.robust.src);
  assert.equal(brandChipHtml('ROBUST<x>', esc).includes('--logo'), false);
});
