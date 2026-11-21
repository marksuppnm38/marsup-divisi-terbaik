// Jalankan: node --test app/pages/crud-produk/tabel.klasifikasi.test.mjs
// Kolom Kategori / Spesialisasi / Jenis / Sumber klasifikasi di kolom-tabel.js: ikut export, dimuat lazy
// (sekali per id), dan gagal-muat terdeteksi (bukan kolom kosong diam-diam di file yang jadi dasar pengajuan izin edar).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTableColumns, TABLE_COLS, COL_PRESETS } from './kolom-tabel.js';
import { resetKlasifikasi } from './klasifikasi.js';

const noop = () => {};
const baris = (id, o = {}) => ({ id, tipe: 'INSTRUMENT', kode_produk: 'K' + id, nama_produk: 'P' + id, kategori: 'INSTRUMEN SATUAN',
  kategori_sumber: 'golongan', spes: 'OBGYN', spes_sumber: 'peta', klas_jenis: null, klas_mikro: false, golongan: 'ALAT BEDAH', ...o });

// Supabase tiruan: kolom klasifikasi dibaca dari tabel produk per id (.from('produk').select().in('id', ...)).
function fakeSb(rows, { selErr = null } = {}) {
  const calls = [];
  return {
    calls,
    from(t) {
      if (t !== 'produk') throw new Error('kolom klasifikasi hanya boleh query tabel produk, bukan ' + t);
      const q = { ids: [] };
      const chain = { select() { return chain; }, in(c, v) { q.ids = v; return chain; },
        then(res, rej) { calls.push(q.ids); return Promise.resolve(selErr ? { data: null, error: selErr } : { data: rows.filter((r) => q.ids.includes(r.id)), error: null }).then(res, rej); } };
      return chain;
    },
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

test('loadNeeds memuat klasifikasi sekali per id; exportRow mengisi kolomnya; produk belum diklasifikasi kosong', async () => {
  const sb = fakeSb([
    baris(1, { spes: 'OBGYN', spes_sumber: 'peta' }),
    baris(2, { spes: 'BEDAH UMUM', spes_sumber: 'isi', klas_jenis: 'GUNTING' }),                        // dugaan -> perlu dicek
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
  assert.equal(sb.calls.length, n); // sudah dibaca: tidak query ulang
});

test('sel tabel: penanda "dicek" untuk dugaan, chip mikro, dan "—" untuk yang tidak ada', async () => {
  const kit = make(fakeSb([baris(1, { spes_sumber: 'peta?', klas_mikro: true }), baris(2, { spes_sumber: 'peta' })]));
  kit.applyPreset('klasifikasi');
  await kit.loadNeeds([1, 2]);
  const html1 = kit.rowHtml(produk(1)), html2 = kit.rowHtml(produk(2)), html9 = kit.rowHtml(produk(9));
  assert.match(html1, /flag-warn[^>]*>dicek</);
  assert.match(html1, /tipe-chip">mikro</);
  assert.doesNotMatch(html2, /flag-warn[^>]*>dicek</);
  assert.match(html2, /Peta kode/);
  assert.match(html9, /<td data-col="kategori" class="tipe-cell">—<\/td>/); // belum ada klasifikasi
});

test('kolom Kelompok set (Minor/Mayor/Vaginal) sudah dihapus: tidak ada di daftar kolom maupun header export', () => {
  assert.ok(!TABLE_COLS.some((c) => c.key === 'kelompok'));
  assert.ok(!TABLE_COLS.some((c) => /kelompok/i.test(c.label)));
  const kit = make(fakeSb([]));
  kit.setAuto(['kelompok']); // key lama (mis. sisa localStorage / filter lama) harus diabaikan, bukan error
  assert.equal(colIdx(kit, 'Kelompok Set'), -1);
});

test('kolom belum ada di database: loadNeeds false + pesan menyebut file migrasi (export dibatalkan, bukan kolom kosong diam-diam)', async () => {
  const kit = make(fakeSb([], { selErr: { code: '42703', message: 'column produk.kategori does not exist' } }));
  kit.applyPreset('klasifikasi');
  assert.equal(await kit.loadNeeds([1]), false);
  assert.match(kit.needsError(), /2026-11-22_klasifikasi_kolom_produk\.sql/);
});

test('error lain saat memuat: loadNeeds false + pesan gagal memuat', async () => {
  const kit = make(fakeSb([], { selErr: { message: 'timeout' } }));
  kit.applyPreset('klasifikasi');
  assert.equal(await kit.loadNeeds([1]), false);
  assert.match(kit.needsError(), /Gagal memuat kategori & spesialisasi: timeout/);
});

test('kolom klasifikasi tidak dipilih: tidak ada request sama sekali (preset standar)', async () => {
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
  const baru = ['kategori', 'spes', 'jenis', 'klas_sumber'];
  baru.forEach((k) => assert.ok(TABLE_COLS.find((c) => c.key === k).xl.length >= 1, k));
  assert.deepEqual(TABLE_COLS.map((c) => c.key).filter((k) => !baru.includes(k)),
    ['kode', 'nama', 'tipe', 'golongan', 'keluarga', 'brand', 'akd', 'no_akd', 'nama_akd', 'ekat', 'swasta', 'tahun', 'link', 'status_inaproc', 'stok', 'nilai', 'flags', 'aktif', 'verified', 'updated']);
  assert.deepEqual(COL_PRESETS.map((p) => p.id), ['standar', 'harga', 'akd', 'keluarga', 'klasifikasi', 'audit']);
});
