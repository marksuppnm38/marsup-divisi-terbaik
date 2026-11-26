// Jalankan: node --test app/pages/crud-produk/urut-header.test.mjs
// Urutan kolom + pasangan "Sudah diisi / Belum diisi": bagian murni dari menu header tabel Produk.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  urutkan, ubahUrut, bandingkan, deskripsiUrut, cocokIsi, butuhJalurLangsung, opsiIsi, pasanganMenu, punyaMenuHeader,
  NILAI_ISI, NILAI_KOSONG, KOLOM_URUT,
} from './urut-header.js';
import { simpanKlasDariBaris, resetKlasifikasi } from './klasifikasi.js';

const p = (id, o = {}) => ({ id, kode_produk: 'K' + id, nama_produk: 'P' + id, tipe: 'INSTRUMENT', is_active: true, ...o });
const ids = (rows) => rows.map((r) => r.id);

test.beforeEach(() => resetKlasifikasi());

test('teks: naik / turun, kosong (null, "", spasi) SELALU di bawah', () => {
  const rows = [p(1, { brand: 'ROBUST' }), p(2, { brand: null }), p(3, { brand: 'ADLER' }), p(4, { brand: '' }), p(5, { brand: '  ' })];
  assert.deepEqual(ids(urutkan(rows, { key: 'brand', dir: 'asc' })), [3, 1, 2, 4, 5]);
  assert.deepEqual(ids(urutkan(rows, { key: 'brand', dir: 'desc' })), [1, 3, 2, 4, 5]);
});

test('seri diputuskan kode produk (stabil), bukan urutan masuk', () => {
  const rows = [p(3, { golongan: 'A' }), p(1, { golongan: 'A' }), p(2, { golongan: 'A' })];
  assert.deepEqual(ids(urutkan(rows, { key: 'golongan', dir: 'asc' })), [1, 2, 3]);
  assert.deepEqual(ids(urutkan(rows, { key: 'golongan', dir: 'desc' })), [1, 2, 3]); // seri tidak ikut terbalik
});

test('tanggal: terbaru dulu = desc; tanggal kosong di bawah', () => {
  const rows = [p(1, { updated_at: '2026-01-01T00:00:00Z' }), p(2, { updated_at: null }), p(3, { updated_at: '2026-11-01T00:00:00Z' })];
  assert.deepEqual(ids(urutkan(rows, { key: 'updated', dir: 'desc' })), [3, 1, 2]);
  assert.deepEqual(ids(urutkan(rows, { key: 'updated', dir: 'asc' })), [1, 3, 2]);
});

test('boolean Aktif: desc = aktif dulu', () => {
  const rows = [p(1, { is_active: false }), p(2, { is_active: true })];
  assert.deepEqual(ids(urutkan(rows, { key: 'aktif', dir: 'desc' })), [2, 1]);
  assert.deepEqual(ids(urutkan(rows, { key: 'aktif', dir: 'asc' })), [1, 2]);
});

test('kategori / spesialisasi dibaca dari klasifikasi; produk tanpa klasifikasi di bawah', () => {
  simpanKlasDariBaris([
    { id: 1, kategori: 'SET', spes: 'OBGYN' },
    { id: 2, kategori: 'BMHP', spes: null },
    { id: 3, kategori: 'ELEKTROMEDIS', spes: null },
  ]);
  const rows = [p(1), p(2), p(3), p(4)];
  assert.deepEqual(ids(urutkan(rows, { key: 'kategori', dir: 'asc' })), [2, 3, 1, 4]);
  assert.deepEqual(ids(urutkan(rows, { key: 'kategori', dir: 'desc' })), [1, 3, 2, 4]);
  assert.deepEqual(ids(urutkan(rows, { key: 'spes', dir: 'asc' })), [1, 2, 3, 4]); // hanya id 1 punya spes; sisanya kosong -> urut kode
});

test('urutkan tidak mengubah array asal; kolom tak dikenal / tanpa urutan = array yang sama', () => {
  const rows = [p(2, { brand: 'B' }), p(1, { brand: 'A' })];
  const out = urutkan(rows, { key: 'brand', dir: 'asc' });
  assert.deepEqual(ids(rows), [2, 1]);
  assert.deepEqual(ids(out), [1, 2]);
  assert.equal(urutkan(rows, null), rows);
  assert.equal(urutkan(rows, { key: 'harga_gaib', dir: 'asc' }), rows);
});

test('ubahUrut: pilih arah baru = pasang; pilih arah yang sedang aktif = mati; ganti kolom = pindah', () => {
  assert.deepEqual(ubahUrut(null, 'nama', 'asc'), { key: 'nama', dir: 'asc' });
  assert.deepEqual(ubahUrut({ key: 'nama', dir: 'asc' }, 'nama', 'desc'), { key: 'nama', dir: 'desc' });
  assert.equal(ubahUrut({ key: 'nama', dir: 'desc' }, 'nama', 'desc'), null);
  assert.deepEqual(ubahUrut({ key: 'nama', dir: 'desc' }, 'brand', 'asc'), { key: 'brand', dir: 'asc' });
  assert.deepEqual(ubahUrut({ key: 'nama', dir: 'asc' }, 'ekat', 'asc'), { key: 'nama', dir: 'asc' }); // kolom harga belum bisa diurutkan (fase 2)
});

test('deskripsiUrut', () => {
  assert.equal(deskripsiUrut({ key: 'nama', dir: 'asc' }, 'Nama Produk'), 'Nama Produk (A → Z)');
  assert.equal(deskripsiUrut({ key: 'updated', dir: 'desc' }, 'Terakhir Diubah'), 'Terakhir Diubah (terbaru dulu)');
  assert.equal(deskripsiUrut(null, 'x'), '');
});

test('cocokIsi: Sudah / Belum diisi untuk golongan, brand, status INAPROC; spasi saja = kosong', () => {
  const f = (dim, value) => ({ dim, value });
  assert.equal(cocokIsi(p(1, { golongan: 'ALAT' }), f('golongan', NILAI_ISI)), true);
  assert.equal(cocokIsi(p(1, { golongan: null }), f('golongan', NILAI_ISI)), false);
  assert.equal(cocokIsi(p(1, { golongan: '  ' }), f('golongan', NILAI_KOSONG)), true);
  assert.equal(cocokIsi(p(1, { brand: 'ADLER' }), f('brand', NILAI_KOSONG)), false);
  assert.equal(cocokIsi(p(1, { status_inaproc: '' }), f('status_inaproc', NILAI_KOSONG)), true);
  assert.equal(cocokIsi(p(1, { golongan: 'ALAT' }), f('golongan', 'ALAT')), null); // nilai biasa: bukan urusan fungsi ini
  assert.equal(cocokIsi(p(1), f('tipe', NILAI_KOSONG)), null);
});

test('butuhJalurLangsung: hanya yang tidak dikenal RPC (brand "kosong" tetap lewat RPC)', () => {
  const f = (dim, value) => ({ dim, value });
  assert.equal(butuhJalurLangsung(f('golongan', NILAI_KOSONG)), true);
  assert.equal(butuhJalurLangsung(f('golongan', NILAI_ISI)), true);
  assert.equal(butuhJalurLangsung(f('status_inaproc', NILAI_KOSONG)), true);
  assert.equal(butuhJalurLangsung(f('brand', NILAI_ISI)), true);
  assert.equal(butuhJalurLangsung(f('brand', NILAI_KOSONG)), false);
  assert.equal(butuhJalurLangsung(f('golongan', 'ALAT')), false);
  assert.equal(butuhJalurLangsung(f('link_v6', 'kosong')), false);
  assert.equal(butuhJalurLangsung(f('harga', 'ada')), false);
});

test('menu: wording & pasangan tiap kolom; kolom harga / link diarahkan ke filter yang sudah ada', () => {
  assert.deepEqual(opsiIsi().map((o) => o.label), ['Sudah diisi', 'Belum diisi']);
  assert.deepEqual(pasanganMenu('golongan'), [[NILAI_ISI, 'Sudah diisi'], [NILAI_KOSONG, 'Belum diisi']]);
  assert.deepEqual(pasanganMenu('link'), [['ada', 'Sudah diisi'], ['kosong', 'Belum diisi']]);
  assert.deepEqual(pasanganMenu('ekat').map((x) => x[0]), ['ada', 'kosong']);
  assert.deepEqual(pasanganMenu('tipe'), []);
  assert.ok(punyaMenuHeader('nama') && punyaMenuHeader('ekat') && punyaMenuHeader('stok'));
  assert.ok(!punyaMenuHeader('flags') && !punyaMenuHeader('akd'));
  assert.ok(!('ekat' in KOLOM_URUT) && !('stok' in KOLOM_URUT)); // urut harga / stok = fase 2 (butuh view)
});

test('butuhJalurLangsung: filter AKD selalu lewat jalur langsung (RPC tidak mengenalnya)', () => {
  assert.equal(butuhJalurLangsung({ dim: 'akd', value: 'ada' }), true);
  assert.equal(butuhJalurLangsung({ dim: 'akd', value: 'kosong' }), true);
});
