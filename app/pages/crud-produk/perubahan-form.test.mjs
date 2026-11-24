// Jalankan: node --test app/pages/crud-produk/perubahan-form.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { FIELD_PERUBAHAN, normNilai, hitungPerubahan, labelSimpan, catatanSebelumnya, perbaruiSnapshot } from './perubahan-form.js';

const SNAP = { nama_produk: 'Tang Mayor', brand: 'ROBUST', berat_gram: '120', link_v6: '', spesifikasi: 'Baja', kode_asli: '35-1', m_deskripsi: 'X', m_family: '', klas_keluarga: '', klas_kategori: '', klas_spes: '' };

test('tanpa perubahan -> 0, meski bentuk nilainya beda (null, spasi, huruf kecil, 120 vs 120.0)', () => {
  const kini = { ...SNAP, nama_produk: '  Tang   Mayor ', brand: 'robust', berat_gram: '120.0', link_v6: null, m_family: undefined };
  const r = hitungPerubahan(SNAP, kini);
  assert.equal(r.jumlah, 0);
  assert.equal(r.kunci.size, 0);
});

test('mengetik lalu mengembalikan ke nilai awal = 0 perubahan', () => {
  assert.equal(hitungPerubahan(SNAP, { ...SNAP, nama_produk: 'Tang Mayor 2' }).jumlah, 1);
  assert.equal(hitungPerubahan(SNAP, { ...SNAP, nama_produk: 'Tang Mayor' }).jumlah, 0);
});

test('menghitung per field dan menandai yang sensitif', () => {
  const r = hitungPerubahan(SNAP, { ...SNAP, nama_produk: 'Tang Minor', brand: 'ADLER', berat_gram: '150' });
  assert.equal(r.jumlah, 3);
  assert.deepEqual(r.daftar.map((d) => d.key), ['nama_produk', 'brand', 'berat_gram']);
  assert.equal(r.daftar[0].sensitif, true);
  assert.equal(r.daftar[2].sensitif, false);
  assert.equal(r.daftar[0].sebelum, 'Tang Mayor');
  assert.equal(r.daftar[0].sesudah, 'Tang Minor');
  assert.ok(r.kunci.has('brand'));
});

test('key yang belum ada di snapshot dilewati (klasifikasi / master belum selesai dimuat)', () => {
  const { klas_keluarga, klas_kategori, klas_spes, m_deskripsi, m_family, ...tanpa } = SNAP;
  const r = hitungPerubahan(tanpa, { ...SNAP, klas_keluarga: 'AS.', m_deskripsi: 'Y' });
  assert.equal(r.jumlah, 0);
  const r2 = hitungPerubahan({ ...tanpa, klas_keluarga: '' }, { ...SNAP, klas_keluarga: 'AS.' });
  assert.equal(r2.jumlah, 1);
});

test('kosong -> terisi dan terisi -> kosong sama-sama perubahan', () => {
  assert.equal(hitungPerubahan(SNAP, { ...SNAP, link_v6: 'https://x' }).jumlah, 1);
  assert.equal(hitungPerubahan(SNAP, { ...SNAP, spesifikasi: '' }).jumlah, 1);
});

test('berat: koma desimal dan angka non-numerik', () => {
  assert.equal(normNilai('berat_gram', '1,5'), '1.5');
  assert.equal(normNilai('berat_gram', ''), '');
  assert.equal(normNilai('berat_gram', null), '');
  assert.equal(hitungPerubahan({ berat_gram: '1.5' }, { berat_gram: '1,5' }).jumlah, 0);
});

test('spesifikasi: baris baru di tengah adalah isi, hanya ujung yang dipangkas', () => {
  assert.equal(hitungPerubahan({ spesifikasi: 'a\nb' }, { spesifikasi: 'a b' }).jumlah, 1);
  assert.equal(hitungPerubahan({ spesifikasi: 'a\nb' }, { spesifikasi: ' a\nb\n' }).jumlah, 0);
});

test('snapshot / form kosong tidak membuat error', () => {
  assert.equal(hitungPerubahan(null, SNAP).jumlah, 0);
  assert.equal(hitungPerubahan(SNAP, null).jumlah, 0);
});

test('labelSimpan', () => {
  assert.equal(labelSimpan(0), 'Simpan');
  assert.equal(labelSimpan(1), 'Simpan (1)');
  assert.equal(labelSimpan(4), 'Simpan (4)');
  assert.equal(labelSimpan(undefined), 'Simpan');
});

test('catatanSebelumnya: kosong eksplisit, panjang dipotong', () => {
  assert.equal(catatanSebelumnya(''), 'Sebelumnya: (kosong)');
  assert.equal(catatanSebelumnya('', 'Tanpa brand'), 'Sebelumnya: Tanpa brand');
  assert.equal(catatanSebelumnya('Tang'), 'Sebelumnya: Tang');
  const t = catatanSebelumnya('x'.repeat(100));
  assert.ok(t.endsWith('…'));
  assert.equal(t.length, 'Sebelumnya: '.length + 60);
});

test('perbaruiSnapshot: hanya bagian yang diberikan, asal tidak berubah', () => {
  const a = { nama_produk: 'A', klas_spes: 'X' };
  const b = perbaruiSnapshot(a, { nama_produk: 'B' });
  assert.equal(b.nama_produk, 'B');
  assert.equal(b.klas_spes, 'X');
  assert.equal(a.nama_produk, 'A');
});

test('setiap field punya key unik dan elId', () => {
  const keys = FIELD_PERUBAHAN.map((f) => f.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(FIELD_PERUBAHAN.every((f) => f.elId && f.label));
});
