// Jalankan: node --test app/pages/crud-produk/tabel.klasifikasi.test.mjs
// Kolom Kategori / Spesialisasi / Jenis / Sumber klasifikasi / Kelompok set di kolom-tabel.js: ikut export, dimuat lazy
// (satu kali), dan gagal-muat terdeteksi (bukan kolom kosong diam-diam di file yang jadi dasar pengajuan izin edar).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTableColumns, TABLE_COLS, COL_PRESETS } from './kolom-tabel.js';
import { resetKlasifikasi } from './klasifikasi.js';

const noop = () => {};
const DIHITUNG = '2026-11-20T10:15:00Z';
const baris = (id, o = {}) => ({ produk_id: id, tipe: 'INSTRUMENT', kode_produk: 'K' + id, nama_produk: 'P' + id, kategori: 'INSTRUMEN SATUAN',
  kategori_sumber: 'golongan', spes: 'OBGYN', spes_sumber: 'peta', jenis: null, mikro: false, golongan: 'ALAT BEDAH', ...o });

function fakeSb(rows, { dihitung = DIHITUNG, ringErr = null } = {}) {
  const calls = [];
  return {
    calls,
    async rpc(name, args) {
      calls.push(name);
      if (name === 'get_katalog_kategori_ringkasan') return ringErr ? { data: null, error: ringErr } : { data: { dihitung_at: dihitung }, error: null };
      return { data: { rows: rows.slice(args.p_offset, args.p_offset + args.p_batas), total: rows.length }, error: null };
    },
    from() { throw new Error('kolom klasifikasi tidak boleh query tabel lain'); },
  };
}
const helpers = { selBox: () => '', btn: () => '', recent: () => '', verified: () => '', seal: () => '', akdNoOf: () => [], stokCell: () => '', moreCell: () => '', extraOf: () => null, stokOf: () => null, stokLabel: {}, sealLabel: () => '', isVerified: () => false };
const make = (sb) => createTableColumns({ sb, headRow: { innerHTML: '' }, tableBody: { addEventListener: noop, removeEventListener: noop }, helpers, onChange: noop, onPreset: noop });
const produk = (id, o = {}) => ({ id, kode_produk: 'K' + id, nama_produk: 'P' + id, tipe: 'INSTRUMENT', is_active: true, ...o });
const colIdx = (kit, label) => kit.exportColumns().findIndex((c) => c.label === label);

test.beforeEach(() => resetKlasifikasi());

test('preset "Kategori & spesialisasi": urutan kolom export + kebutuhan data klas', () => {
  const kit = make(fakeSb([]));
  assert.ok(kit.presets().some((p) => p.id === 'klasifikasi' && p.label === 'Kategori & spesialisasi'));
  kit.applyPreset('klasifikasi');
  assert.deepEqual(kit.exportColumns().map((c) => c.label),
    ['Kode Produk', 'Nama Produk', 'Tipe', 'Kategori', 'Spesialisasi', 'Jenis', 'Golongan', 'Sumber Klasifikasi', 'Klasifikasi Perlu Dicek']);
  assert.ok(kit.exportUses().has('klas'));
  assert.equal(COL_PRESETS.find((p) => p.id === 'klasifikasi').siapJual, false); // bukan preset pricelist: opsi "siap jual" mati
});

test('loadNeeds memuat klasifikasi sekali; exportRow mengisi kolomnya; produk tanpa klasifikasi (nonaktif) kosong', async () => {
  const sb = fakeSb([
    baris(1, { spes: 'OBGYN', spes_sumber: 'peta' }),
    baris(2, { spes: 'BEDAH UMUM', spes_sumber: 'isi', jenis: 'GUNTING' }),                        // dugaan -> perlu dicek
    baris(3, { kategori: 'ELEKTROMEDIS', spes: null, spes_sumber: null, kategori_sumber: 'bawaan', tipe: 'UNIT' }),
  ]);
  const kit = make(sb);
  kit.applyPreset('klasifikasi');
  assert.equal(await kit.loadNeeds([1, 2, 3, 4]), true);
  const rows = [produk(1), produk(2), produk(3, { tipe: 'UNIT' }), produk(4, { is_active: false })];
  const g = (label) => rows.map((r) => kit.exportRow(r, {})[colIdx(kit, label)]);
  assert.deepEqual(g('Kategori'), ['Instrumen satuan', 'Instrumen satuan', 'Elektromedis', null]);
  assert.deepEqual(g('Spesialisasi'), ['OBGYN', 'Bedah Umum', null, null]);          // unit & alat: kosong, bukan "Tanpa spesialisasi"
  assert.deepEqual(g('Jenis'), [null, 'Gunting', null, null]);
  assert.deepEqual(g('Sumber Klasifikasi'), ['Peta kode', 'Dugaan dari isi set', 'Golongan belum dipetakan', null]);
  assert.deepEqual(g('Klasifikasi Perlu Dicek'), [null, 'Ya', 'Ya', null]);
  const n = sb.calls.length;
  await kit.loadNeeds([1, 2, 3]);
  assert.equal(sb.calls.length, n); // cache: tidak memanggil RPC ulang
});

test('sel tabel: penanda "dicek" untuk dugaan, chip mikro, dan "—" untuk yang tidak ada', async () => {
  const kit = make(fakeSb([baris(1, { spes_sumber: 'peta?', mikro: true }), baris(2, { spes_sumber: 'peta' })]));
  kit.applyPreset('klasifikasi');
  await kit.loadNeeds([1, 2]);
  const html1 = kit.rowHtml(produk(1)), html2 = kit.rowHtml(produk(2)), html9 = kit.rowHtml(produk(9));
  assert.match(html1, /flag-warn[^>]*>dicek</);
  assert.match(html1, /tipe-chip">mikro</);
  assert.doesNotMatch(html2, /flag-warn[^>]*>dicek</);
  assert.match(html2, /Peta kode/);
  assert.match(html9, /<td class="tipe-cell">—<\/td>/); // belum ada klasifikasi
});

test('kolom Kelompok set tidak butuh data: terisi dari nama set tanpa memuat klasifikasi', async () => {
  const sb = fakeSb([]);
  const kit = make(sb);
  // pilih kolom lewat preset buatan sendiri: tampilkan hanya kelompok via autoKeys (filter Kelompok set aktif)
  kit.setAuto(['kelompok']);
  assert.equal(await kit.loadNeeds([1]), true);
  assert.equal(sb.calls.length, 0);
  const col = colIdx(kit, 'Kelompok Set');
  assert.ok(col >= 0);
  assert.equal(kit.exportRow(produk(1, { tipe: 'SET', nama_produk: 'MINOR VAGINAL S.' }), {})[col], 'Minor vaginal');
  assert.equal(kit.exportRow(produk(2, { tipe: 'SET', nama_produk: 'HECTING S.' }), {})[col], null);
  assert.equal(kit.exportRow(produk(3, { nama_produk: 'MINOR SCISSOR' }), {})[col], null); // bukan SET
  assert.ok(!kit.exportUses().has('klas'));
});

test('klasifikasi belum dihitung: loadNeeds false + pesan yang menyebut refresh_katalog_klasifikasi (export dibatalkan)', async () => {
  const kit = make(fakeSb([baris(1)], { dihitung: null }));
  kit.applyPreset('klasifikasi');
  assert.equal(await kit.loadNeeds([1]), false);
  assert.match(kit.needsError(), /refresh_katalog_klasifikasi/);
});

test('RPC belum terpasang: loadNeeds false + pesan menyebut file migrasi', async () => {
  const kit = make(fakeSb([], { ringErr: { code: 'PGRST202', message: 'Could not find the function' } }));
  kit.applyPreset('klasifikasi');
  assert.equal(await kit.loadNeeds([1]), false);
  assert.match(kit.needsError(), /20261110_kategori_spes_katalog\.sql/);
});

test('kolom klasifikasi tidak dipilih: tidak ada RPC sama sekali (preset standar)', async () => {
  const sb = fakeSb([baris(1)]);
  const kit = make(sb);
  assert.equal(await kit.loadNeeds([1, 2]), true);
  assert.equal(sb.calls.length, 0);
});

test('kolom dinamis dari filter (autoKeys) ikut memuat data klasifikasi', async () => {
  const sb = fakeSb([baris(1)]);
  const kit = make(sb);
  kit.setAuto(['spes', 'klas_sumber']);
  assert.ok(kit.exportUses().has('klas'));
  assert.equal(await kit.loadNeeds([1]), true);
  assert.ok(sb.calls.length > 0);
  assert.deepEqual(kit.autoKeys(), ['spes', 'klas_sumber']);
});

test('definisi kolom: semua kolom klas punya xl (ikut export) dan kolom lama tidak berubah urutannya', () => {
  const baru = ['kelompok', 'kategori', 'spes', 'jenis', 'klas_sumber'];
  baru.forEach((k) => assert.ok(TABLE_COLS.find((c) => c.key === k).xl.length >= 1, k));
  assert.deepEqual(TABLE_COLS.map((c) => c.key).filter((k) => !baru.includes(k)),
    ['kode', 'nama', 'tipe', 'golongan', 'keluarga', 'brand', 'akd', 'no_akd', 'nama_akd', 'ekat', 'swasta', 'tahun', 'link', 'status_inaproc', 'stok', 'nilai', 'flags', 'aktif', 'verified', 'updated']);
  assert.deepEqual(COL_PRESETS.map((p) => p.id), ['standar', 'harga', 'akd', 'keluarga', 'klasifikasi', 'audit']);
});
