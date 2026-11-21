// Jalankan: node --test app/pages/crud-produk/bulk-parse.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { isHeaderRow, columnsFromHeader, columnsFromSelection, buildRows, applyReport, hitungStatus, toTsv } from './bulk-parse.js';

const sel = (keys, ent = 'produk') => columnsFromSelection(keys, ent).cols;

test('sel kosong tidak dikirim; baris dengan semua sel kosong = gagal', () => {
  const { items, metas } = buildRows([['RB-1', '', '2026'], ['RB-2', '', '']], sel(['brand', 'tahun']), 'produk');
  // baris 1: tahun tanpa harga -> gagal (info kurang). baris 2: semua kosong -> gagal
  assert.equal(items.length, 0);
  assert.match(metas[0].errors.join(), /Tahun Harga diisi tapi Harga E-Katalog kosong/);
  assert.match(metas[1].errors.join(), /Semua sel atribut kosong/);
});

test('sel kosong di antara kolom: hanya kunci yang terisi dikirim', () => {
  const { items } = buildRows([['RB-1', '', 'adler']], sel(['nama_produk', 'brand']), 'produk');
  assert.deepEqual(items[0].set, { brand: 'ADLER' });
  assert.ok(!('nama_produk' in items[0].set));
});

test('tidak ada token pengosong: "-" diperlakukan sebagai nilai biasa (dan ditolak bila tidak valid)', () => {
  const { items, metas } = buildRows([['RB-1', '-']], sel(['harga_ekat']), 'produk');
  assert.equal(items.length, 0);
  assert.match(metas[0].errors[0], /bukan angka/);
});

test('validasi: tipe salah eja, link berisi catatan, harga/tahun, kategori, qty isi set', () => {
  const rows = [
    ['A1', 'INSTRUMEN'],
    ['A2', 'https://x.id/p/1 UPDATE HARGA'],
    ['A3', 'bukan url'],
  ];
  const r1 = buildRows([rows[0]], sel(['tipe']), 'produk');
  assert.match(r1.metas[0].errors[0], /Tipe "INSTRUMEN" tidak dikenal/);
  const r2 = buildRows([rows[1], rows[2]], sel(['link_v6']), 'produk');
  assert.match(r2.metas[0].errors[0], /ada catatan/);
  assert.match(r2.metas[1].errors[0], /Bukan URL/);
  const r3 = buildRows([['S1', 'RB-001; RB-002 x1']], sel(['isi_set']), 'produk');
  assert.match(r3.metas[0].errors[0], /qty wajib/);
  const r4 = buildRows([['S1', 'RB-001 x2; RB-014 x1']], sel(['isi_set']), 'produk', { isi_set: 'timpa' });
  assert.deepEqual(r4.items[0].set.isi_set, [{ kode: 'RB-001', qty: 2 }, { kode: 'RB-014', qty: 1 }]);
  assert.equal(r4.items[0].mode.isi_set, 'timpa');
  const r5 = buildRows([['A1', 'bedah']], sel(['kategori']), 'produk');
  assert.match(r5.metas[0].errors[0], /Kategori "bedah" tidak dikenal/);
  const r6 = buildRows([['A1', '1.250.000', '2026']], sel(['harga_ekat', 'tahun']), 'produk');
  assert.deepEqual(r6.items[0].set, { harga_ekat: 1250000, tahun: 2026 });
});

test('lintas-kolom: SET dengan berat, non-SET dengan isi set / keluarga', () => {
  const a = buildRows([['S', 'SET', '500']], sel(['tipe', 'berat_gram']), 'produk');
  assert.match(a.metas[0].errors.join(), /Berat SET dihitung otomatis/);
  const b = buildRows([['S', 'UNIT', 'RB-1 x1']], sel(['tipe', 'isi_set']), 'produk');
  assert.match(b.metas[0].errors.join(), /Isi set hanya untuk tipe SET/);
});

test('kunci duplikat di paste: semua kemunculan gagal', () => {
  const { items, metas } = buildRows([['RB-1', 'A'], ['rb-1', 'B'], ['RB-2', 'C']], sel(['brand']), 'produk');
  assert.equal(items.length, 1);
  assert.match(metas[0].errors.join(), /muncul 2×/);
  assert.match(metas[1].errors.join(), /muncul 2×/);
});

test('mode banyak-nilai ikut terkirim hanya untuk kolom yang terisi', () => {
  const { items } = buildRows([['RB-1', 'AKL 1; AKL 2', '']], sel(['no_akd', 'gambar']), 'produk', { akd: 'timpa' });
  assert.deepEqual(items[0].set.no_akd, ['AKL 1', 'AKL 2']);
  assert.deepEqual(items[0].mode, { akd: 'timpa' });
});

test('header: terdeteksi, kolom turunan diabaikan, header tak dikenal ditandai', () => {
  const header = ['Kode Produk', 'Nama Produk', 'Golongan', 'Harga E-Katalog', 'Tahun Harga', 'Branf'];
  assert.ok(isHeaderRow(header, 'produk'));
  const h = columnsFromHeader(header, 'produk');
  assert.deepEqual(h.unknown, ['Branf']);
  assert.deepEqual(h.derived, ['Golongan']);
  assert.deepEqual(h.missingKeys, []);
  const h2 = columnsFromHeader(['Nama Produk', 'Brand'], 'produk');
  assert.deepEqual(h2.missingKeys, ['Kode Produk']);
  assert.ok(!isHeaderRow(['RB-001', 'ADLER'], 'produk'));
});

test('kolom turunan di data tidak ikut dikirim', () => {
  const h = columnsFromHeader(['Kode Produk', 'Golongan', 'Brand'], 'produk');
  const { items } = buildRows([['RB-1', 'ALAT BEDAH', 'adler']], h.cols, 'produk');
  assert.deepEqual(items[0].set, { brand: 'ADLER' });
});

test('sel di luar kolom header & berisi = gagal', () => {
  const { metas } = buildRows([['RB-1', 'ADLER', 'nyasar']], sel(['brand']), 'produk');
  assert.match(metas[0].errors[0], /di luar kolom header/);
});

test('entitas AKD: kunci (no_akd, tipe_akd), tanggal, tipe salah', () => {
  const cols = sel(['masa_berlaku', 'golongan'], 'akd');
  const { items, metas } = buildRows([['AKL 123', 'satuan', '10 Juli 2027', 'A'], ['AKL 9', 'SETT', '2027-01-01', ''], ['AKL 7', 'set', '', '']], cols, 'akd');
  assert.deepEqual(items[0], { ord: 1, no_akd: 'AKL 123', tipe_akd: 'satuan', set: { masa_berlaku: '2027-07-10', golongan: 'A' } });
  assert.match(metas[1].errors.join(), /Tipe AKD "SETT" tidak dikenal/);
  assert.match(metas[2].errors.join(), /Semua sel atribut kosong/);
});

test('applyReport menggabungkan hasil server; baris tanpa hasil jadi error', () => {
  const { items, metas } = buildRows([['A', 'x'], ['B', 'y'], ['C', 'z'], ['D', '']], sel(['brand']), 'produk');
  assert.equal(items.length, 3);
  applyReport(metas, [
    { ord: 1, status: 'ubah', diff: { brand: ['OLD', 'X'] } },
    { ord: 2, status: 'error', alasan: 'tidak ditemukan' },
  ]);
  assert.deepEqual(hitungStatus(metas), { baru: 0, ubah: 1, sama: 0, error: 3 });
  assert.match(metas[2].alasan, /tidak mengembalikan/);
});

test('toTsv membungkus sel berisi tab/kutip', () => {
  assert.equal(toTsv([['a', 'b\tc', 'd"e']]), 'a\t"b\tc"\t"d""e"');
});