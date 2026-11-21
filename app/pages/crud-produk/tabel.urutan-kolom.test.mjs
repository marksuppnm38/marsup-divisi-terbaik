// Jalankan: node --test app/pages/crud-produk/tabel.urutan-kolom.test.mjs
// Kolom tambahan dari filter aktif tidak boleh memindahkan kolom yang sudah tampil.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTableColumns } from './kolom-tabel.js';

const noop = () => {};
const helpers = { selBox: () => '', btn: () => '', recent: () => '', verified: () => '', seal: () => '', akdNoOf: () => [], stokCell: () => '', moreCell: () => '', extraOf: () => null, stokOf: () => null, stokLabel: {}, sealLabel: () => '', isVerified: () => false };
const LS = 'pnm_crud_produk_tbl_cols_v1';
function make(visible) {
  const store = { [LS]: JSON.stringify({ order: visible, visible, hidden: [], follow: true }) };
  globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
  return createTableColumns({ sb: {}, headRow: { innerHTML: '' }, tableBody: { addEventListener: noop, removeEventListener: noop }, helpers, onChange: noop, onPreset: noop });
}
const labels = (kit) => kit.exportColumns().map((c) => c.label);

test('filter Harga: Swasta & Tahun masuk setelah E-Katalog, Link tetap di ujung', () => {
  const kit = make(['nama', 'ekat', 'link']);
  const sebelum = labels(kit);
  kit.setAuto(['ekat', 'swasta', 'tahun']);
  assert.deepEqual(labels(kit), ['Kode Produk', 'Nama Produk', 'Harga E-Katalog', 'Harga Swasta', 'Tahun Harga', 'Link V6']);
  kit.setAuto([]);
  assert.deepEqual(labels(kit), sebelum); // filter dilepas -> kembali persis seperti semula
});

test('kolom yang sudah tampil tidak berpindah relatif satu sama lain', () => {
  const kit = make(['nama', 'status_inaproc', 'ekat', 'stok']);
  const urutan = ['Nama Produk', 'Status INAPROC', 'Harga E-Katalog'];
  kit.setAuto(['tipe', 'golongan', 'brand', 'swasta', 'link', 'aktif']);
  const l = labels(kit).filter((x) => urutan.includes(x));
  assert.deepEqual(l, urutan);
  assert.equal(labels(kit)[0], 'Kode Produk');
});

test('kolom tambahan tanpa kolom awal yang lebih dulu: masuk di depan, bukan hilang', () => {
  const kit = make(['ekat']);
  kit.setAuto(['golongan']);
  assert.deepEqual(labels(kit), ['Kode Produk', 'Golongan', 'Harga E-Katalog']);
});

test('kolom yang sengaja disembunyikan user tidak dipaksa muncul', () => {
  const store = { [LS]: JSON.stringify({ order: ['nama', 'ekat'], visible: ['nama', 'ekat'], hidden: ['swasta'], follow: true }) };
  globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: () => {} };
  const kit = createTableColumns({ sb: {}, headRow: { innerHTML: '' }, tableBody: { addEventListener: noop, removeEventListener: noop }, helpers, onChange: noop, onPreset: noop });
  kit.setAuto(['ekat', 'swasta', 'tahun']);
  assert.deepEqual(labels(kit), ['Kode Produk', 'Nama Produk', 'Harga E-Katalog', 'Tahun Harga']);
});
