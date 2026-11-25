// Jalankan: node --test app/pages/konversian/picker-kontrak.test.mjs
// Guard kontrak picker Kebutuhan RS (Fase 3) tanpa DOM: yang dibaca pick-confirm & shift-select.js tidak boleh bergeser.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rd = (f) => fs.readFileSync(new URL(f, import.meta.url), 'utf8');
const prs = rd('./permintaan-rs.js');
const css = rd('./style.css');
const a = prs.indexOf('function clipboardPickerHtml(');
const b = prs.indexOf('// Sinkronkan tampilan pilihan picker', a);
assert.ok(a > 0 && b > a, 'anchor clipboardPickerHtml tidak ditemukan');
const html = prs.slice(a, b);

test('baris tetap <label class="kb-picker-row"> dengan checkbox + qty ber-atribut sama (payload pick-confirm tidak berubah)', () => {
  assert.match(html, /<label class="kb-picker-row/);
  assert.match(html, /<input type="checkbox" class="kb-picker-cb" data-picker-check="\$\{itemId\}" data-kode="[^"]+" data-produk-id="\$\{c\.produk_id\|\|''\}"/);
  assert.match(html, /<input type="number" min="0" class="kb-picker-qty" data-picker-qty="\$\{itemId\}" data-kode=/);
  assert.match(html, /class="kb-picker-list" data-picker-list="\$\{itemId\}"/);
  assert.match(html, /data-picker-selvis="\$\{itemId\}" data-mode="on"/);
  assert.match(html, /data-bridge-for="\$\{itemId\}"/);
});

test('checkbox disembunyikan SECARA VISUAL saja: shift-select.js menyaring lewat getClientRects, jadi display:none / visibility:hidden dilarang', () => {
  const rule = css.match(/#app-root \.kb-picker-cb\{[^}]*\}/);
  assert.ok(rule, 'aturan .kb-picker-cb tidak ada');
  assert.doesNotMatch(rule[0], /display\s*:\s*none|visibility\s*:\s*hidden/);
  assert.match(rule[0], /opacity:0/);
});

test('picker tidak lagi memuat kata lama dan tidak menyentuh pnm-universal.css', () => {
  assert.doesNotMatch(prs, /Saring dari|udah kepake/);
  assert.doesNotMatch(css.slice(css.indexOf('PICKER PRODUK (Fase 3')), /^\s*\.kb-picker/m); // semua override ber-scope #app-root
});
