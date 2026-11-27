import test from 'node:test';
import assert from 'node:assert/strict';
import { bolehHapusPaksa, normalisasiMode, ringkasDampak, teksDampak, pesanKonfirmasi, pesanErrorHapusPaksa, kunciPratinjau } from './hapus-paksa.js';

test('bolehHapusPaksa: admin saja, dan izin hapus tidak dicabut', () => {
  assert.equal(bolehHapusPaksa({ isAdmin: () => true, can: () => true }), true);
  assert.equal(bolehHapusPaksa({ isAdmin: () => false, can: () => true }), false);
  assert.equal(bolehHapusPaksa({ isAdmin: () => true, can: () => false }), false);
  assert.equal(bolehHapusPaksa(undefined), false);
});

test('normalisasiMode: selain "hapus" jatuh ke "lepas"', () => {
  assert.equal(normalisasiMode('hapus'), 'hapus');
  assert.equal(normalisasiMode('lepas'), 'lepas');
  assert.equal(normalisasiMode('ngawur'), 'lepas');
  assert.equal(normalisasiMode(undefined), 'lepas');
});

test('ringkasDampak: hanya yang > 0, label ikut mode riwayat', () => {
  const d = { cascade: { harga: 3, media: 0, akd: 1, komposisi: 0 }, set_lain: 2,
    riwayat: { inaproc_pengajuan: 1, permintaan_item: 0, konversi_item: 0 }, mode_riwayat: 'lepas' };
  const r = ringkasDampak(d);
  assert.deepEqual(r.map((x) => x.jumlah), [3, 1, 2, 1]);
  assert.match(r.at(-1).label, /INAPROC.*dilepas/);
  assert.match(ringkasDampak({ ...d, mode_riwayat: 'hapus' }).at(-1).label, /dihapus/);
});

test('teksDampak: kosong / null aman', () => {
  assert.equal(teksDampak(null), 'tidak ada data terkait');
  assert.equal(teksDampak({}), 'tidak ada data terkait');
});

test('pesanKonfirmasi: memuat label, dampak, dan peringatan sesuai mode', () => {
  const dampak = { cascade: { harga: 2 }, riwayat: { inaproc_pengajuan: 1 }, mode_riwayat: 'hapus' };
  const t = pesanKonfirmasi({ label: 'RBP-KEO-B001-U4R', dampak });
  assert.match(t, /RBP-KEO-B001-U4R/);
  assert.match(t, /2 baris harga/);
  assert.match(t, /IKUT DIHAPUS/);
  assert.match(pesanKonfirmasi({ label: 'X', dampak: { ...dampak, mode_riwayat: 'lepas' } }), /tetap ada/);
});

test('pesanErrorHapusPaksa: kode HP_*, fungsi belum ada, dan fallback', () => {
  assert.equal(pesanErrorHapusPaksa({ message: 'HP_FORBIDDEN: hanya admin.' }), 'hanya admin.');
  assert.match(pesanErrorHapusPaksa({ message: 'Could not find the function public.hapus_produk_paksa' }), /belum terpasang/);
  assert.equal(pesanErrorHapusPaksa({ message: 'boom' }), 'boom');
  assert.equal(pesanErrorHapusPaksa(null), 'Gagal menghapus produk.');
});

test('kunciPratinjau: beda mode = beda kunci', () => {
  assert.notEqual(kunciPratinjau('a', 'lepas'), kunciPratinjau('a', 'hapus'));
  assert.equal(kunciPratinjau('a', 'x'), kunciPratinjau('a', 'lepas'));
});

test('ringkasDampak: tabel CASCADE lain & permintaan_item_produk ikut tampil', () => {
  const r = ringkasDampak({ cascade_lain: { 'produk_kfa.produk_id': 1, 'produk_varian.produk_id': 0 },
    riwayat: { permintaan_item_produk: 4 }, mode_riwayat: 'lepas' });
  assert.deepEqual(r.map((x) => x.kelompok), ['cascade_lain', 'riwayat']);
  assert.match(r[0].label, /produk_kfa\.produk_id/);
  assert.match(r[1].label, /Permintaan RS.*dilepas/);
});
