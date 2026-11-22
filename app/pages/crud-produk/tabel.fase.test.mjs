// Jalankan: node --test app/pages/crud-produk/tabel.fase.test.mjs
// Tiga keadaan data tambahan (memuat / ada / gagal) di kolom-tabel.js dan patch sel per baris.
// Prinsip: selagi data belum tiba, sel TIDAK boleh menampilkan "—" / "Tanpa harga" (itu klaim "kosong"), dan patch tidak menyentuh sel lain.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTableColumns } from './kolom-tabel.js';

const noop = () => {};
const harga = { 1: { ekatalog: 1500000, swasta: 1800000, tahun: 2026 } };
const helpers = {
  selBox: () => '', btn: () => '', recent: () => '', seal: () => '', akdNoOf: () => [], stokCell: () => '<b>stok</b>', moreCell: () => '',
  verified: () => '', extraOf: (id) => harga[id] || null, stokOf: () => null, stokLabel: {}, sealLabel: () => '', isVerified: () => false,
};
const produk = (id, o = {}) => ({ id, kode_produk: 'K' + id, nama_produk: 'P' + id, tipe: 'INSTRUMENT', is_active: true, ...o });

// tableBody palsu: baris <tr data-id> dengan <td data-col> yang bisa diisi ulang (tanpa DOM sungguhan).
function fakeBody(rows, keys) {
  const trs = rows.map((p) => {
    const tds = Object.fromEntries(keys.map((k) => [k, { innerHTML: 'LAMA:' + k }]));
    return { dataset: { id: String(p.id) }, tds, querySelector: (sel) => tds[(/data-col="([^"]+)"/.exec(sel) || [])[1]] || null };
  });
  return { trs, addEventListener: noop, removeEventListener: noop, querySelectorAll: () => trs };
}
const make = (tableBody = { addEventListener: noop, removeEventListener: noop }) =>
  createTableColumns({ sb: {}, headRow: { innerHTML: '' }, tableBody, helpers, onChange: noop, onPreset: noop });

test('memuat: sel harga berisi skeleton, bukan "—"; sesudah ada, berisi nilai', () => {
  const kit = make();
  kit.applyPreset('harga');
  kit.setPhase('extra', 'loading');
  const loading = kit.rowHtml(produk(1));
  assert.match(loading, /<td data-col="ekat"[^>]*><span class="sk"/);
  assert.doesNotMatch(loading, /data-col="ekat"[^>]*>[^<]*<span class="stok stok-none">—/);
  kit.setPhase('extra', 'ok');
  assert.match(kit.rowHtml(produk(1)), /Rp 1\.500\.000/);
});

test('ada tapi memang kosong: baru boleh menampilkan "—"', () => {
  const kit = make();
  kit.applyPreset('harga');
  kit.setPhase('extra', 'ok');
  assert.match(kit.rowHtml(produk(2)), /data-col="ekat"[^>]*><span class="stok stok-none">—<\/span>/);
});

test('gagal: sel menampilkan tombol "coba lagi", bukan nilai kosong', () => {
  const kit = make();
  kit.applyPreset('harga');
  kit.setPhase('extra', 'error');
  assert.match(kit.rowHtml(produk(1)), /data-col="ekat"[^>]*><button[^>]*data-retry[^>]*>gagal, coba lagi</);
});

test('kolom yang tidak bergantung (nama, tipe, kode) tetap tampil penuh selagi data tambahan memuat', () => {
  const kit = make();
  kit.setPhase('extra', 'loading'); kit.setPhase('stok', 'loading'); kit.setPhase('harga', 'loading');
  const html = kit.rowHtml(produk(1));
  assert.match(html, /data-col="kode"[^>]*>K1</);
  assert.match(html, /data-col="nama"[^>]*>P1</);
  assert.match(html, /data-col="tipe"[^>]*>(?:<span[^>]*>)?Instrumen</);
});

test('kolom "Perlu dicek": sel tidak diganti skeleton utuh (penanda dari baris tetap tampil), bagian harga diisi pemanggil', () => {
  const kit = make();
  kit.setPhase('harga', 'loading');
  const html = kit.rowHtml(produk(1), { flags: '<span class="flag">Nonaktif</span><span class="sk sk-flag"></span>' });
  assert.match(html, /data-col="flags"[^>]*><span class="flag">Nonaktif<\/span><span class="sk sk-flag">/);
});

test('patch: hanya sel yang bergantung pada jenis data itu yang diisi ulang', () => {
  const rows = [produk(1), produk(2)];
  const body = fakeBody(rows, ['nama', 'ekat', 'stok', 'flags']);
  const kit = make(body);
  kit.applyPreset('harga');
  kit.setPhase('extra', 'ok');
  kit.patch(['extra'], (id) => rows.find((r) => String(r.id) === id), () => ({}));
  assert.match(body.trs[0].tds.ekat.innerHTML, /Rp 1\.500\.000/);
  assert.match(body.trs[1].tds.ekat.innerHTML, /—/);   // data sudah ada dan memang kosong
  assert.equal(body.trs[0].tds.nama.innerHTML, 'LAMA:nama'); // tidak ikut disentuh
  assert.equal(body.trs[0].tds.stok.innerHTML, 'LAMA:stok');
});

test('patch jenis harga hanya menyentuh kolom "Perlu dicek" dan memakai flags dari pemanggil', () => {
  const rows = [produk(1)];
  const body = fakeBody(rows, ['nama', 'ekat', 'flags']);
  const kit = make(body);
  kit.applyPreset('standar'); // nama, tipe, akd, stok, flags
  kit.patch(['harga'], () => rows[0], () => ({ flags: '<span>FLAG BARU</span>' }));
  assert.equal(body.trs[0].tds.flags.innerHTML, '<span>FLAG BARU</span>');
  assert.equal(body.trs[0].tds.nama.innerHTML, 'LAMA:nama');
});

test('patch jenis yang tidak dipakai kolom tampil: tidak ada yang berubah', () => {
  const rows = [produk(1)];
  const body = fakeBody(rows, ['nama', 'ekat']);
  const kit = make(body);
  kit.applyPreset('akd'); // no_akd, nama_akd, status_inaproc: tidak memakai stok
  kit.patch(['stok'], () => rows[0], () => ({}));
  assert.equal(body.trs[0].tds.nama.innerHTML, 'LAMA:nama');
});

test('export tidak terpengaruh fase: nilai mentah tetap dibaca dari data, bukan dari skeleton', () => {
  const kit = make();
  kit.applyPreset('harga');
  kit.setPhase('extra', 'loading');
  const idx = kit.exportColumns().findIndex((c) => c.label === 'Harga E-Katalog');
  assert.equal(kit.exportRow(produk(1))[idx], 1500000);
});
