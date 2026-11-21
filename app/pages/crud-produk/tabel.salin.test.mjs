// Jalankan: node --test app/pages/crud-produk/tabel.salin.test.mjs
// Salin baris di list Produk harus WYSIWYG: yang tersalin = kolom yang TAMPIL di tabel (urutan, judul, kolom dinamis dari filter),
// bukan daftar kolom salinan terpisah. Test ini mengunci invarian itu di kolom-tabel.js (copyTsv) dan di alur copy.js (createCopyKit).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTableColumns, TABLE_COLS, COL_PRESETS, tsvCell } from './kolom-tabel.js';
import { createCopyKit } from './copy.js';

const noop = () => {};
const STOK_LABEL = { READY: 'Siap', INDENT: 'Indent', DATA_TIDAK_LENGKAP: 'Data tidak lengkap' };
const SEAL = { terhubung: 'Sudah ada AKD', belum_diajukan: 'Belum ada AKD' };

// Data per id yang "sudah termuat" (cache copy.js / stok index.js).
function world({ extra = {}, stok = {}, verified = [] } = {}) {
  const headRow = { innerHTML: '' };
  const helpers = {
    selBox: () => '', btn: () => '', recent: () => '', verified: () => '', seal: () => '', stokCell: () => '', moreCell: () => '',
    akdNoOf: (id) => (extra[id] ? extra[id].akd : []),
    extraOf: (id) => extra[id] || null,
    stokOf: (id) => stok[id],
    stokLabel: STOK_LABEL,
    sealLabel: (s) => SEAL[s] || 'Belum ada AKD',
    isVerified: (id) => verified.includes(id),
  };
  const kit = createTableColumns({ sb: {}, headRow, tableBody: { addEventListener: noop, removeEventListener: noop }, helpers, onChange: noop, onPreset: noop });
  return { kit, headRow };
}
const produk = (id, o = {}) => ({ id, kode_produk: 'K' + id, nama_produk: 'P' + id, tipe: 'INSTRUMENT', golongan: 'ALAT BEDAH', brand: 'ONEMED', is_active: true,
  status_akd: 'belum_diajukan', status_inaproc: 'Disetujui', link_v6: 'https://e-katalog.example/p/' + id, updated_at: '2020-01-01T00:00:00Z', ...o });
// Judul kolom yang dilihat user di <thead> (tanpa kolom aksi "Salin" di ujung).
const thLabels = (headRow) => [...headRow.innerHTML.matchAll(/<th(?![^>]*c-act)[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
const lines = (text) => text.split('\n').map((l) => l.split('\t'));

test('tsvCell: angka polos, TAB/newline dibuang, kosong = ""', () => {
  assert.equal(tsvCell(1500000), '1500000');
  assert.equal(tsvCell(0), '0');                 // nol bukan kosong
  assert.equal(tsvCell(null), '');
  assert.equal(tsvCell(undefined), '');
  assert.equal(tsvCell(NaN), '');
  assert.equal(tsvCell('  A\tB\r\nC  '), 'A B C');
});

test('invarian WYSIWYG: untuk SETIAP preset, judul salinan = judul kolom di layar, tiap baris selebar judul', () => {
  const rows = [produk(1), produk(2, { nama_produk: 'Gunting\tBedah\nLurus' })];
  for (const preset of COL_PRESETS) {
    const { kit, headRow } = world();
    kit.applyPreset(preset.id);
    kit.renderHead();
    const out = kit.copyTsv(rows, { header: true });
    const [head, ...body] = lines(out.text);
    assert.deepEqual(head, thLabels(headRow), `preset ${preset.id}: judul salinan harus sama dengan <thead>`);
    assert.deepEqual(head, kit.visibleLabels(), `preset ${preset.id}`);
    assert.equal(out.cols, head.length);
    body.forEach((r) => assert.equal(r.length, head.length, `preset ${preset.id}: jumlah kolom baris = judul (TAB di isi sel tidak boleh menggeser kolom)`));
    assert.equal(head[0], 'Kode Produk');        // kolom Kode selalu pertama
  }
});

test('kolom dinamis dari filter ikut tersalin, di posisi yang sama dengan layar (tepat setelah Nama)', () => {
  const { kit, headRow } = world();
  kit.applyPreset('harga'); // Nama, Brand, Harga E-Katalog, Harga Swasta, Tahun Harga, Verified INAPROC, Link
  kit.setAuto(['keluarga', 'kategori']);
  kit.renderHead();
  const out = kit.copyTsv([produk(1)], { header: true });
  const [head] = lines(out.text);
  assert.deepEqual(head.slice(0, 4), ['Kode Produk', 'Nama Produk', 'Keluarga set', 'Kategori']);
  assert.deepEqual(head, thLabels(headRow));
  assert.ok(kit.copyUses().has('keluarga') && kit.copyUses().has('klas'), 'data kolom dinamis harus ikut dimuat sebelum disalin');
});

test('kolom yang sengaja dimatikan user tidak ikut tersalin, urutan geser ikut tersalin', () => {
  const { kit, headRow } = world();
  kit.applyPreset('keluarga'); // Nama, Keluarga set, Brand, Link, Aktif
  kit.renderHead();
  const before = kit.copyTsv([produk(1)], { header: true });
  assert.deepEqual(lines(before.text)[0], ['Kode Produk', 'Nama Produk', 'Keluarga set', 'Brand', 'Link E-Katalog (V6)', 'Aktif']);
  assert.deepEqual(lines(before.text)[0], thLabels(headRow));
});

test('tanpa judul: hanya baris data; nilai sesuai kolom (angka harga polos, kosong tetap menjaga posisi kolom)', () => {
  const { kit } = world({
    extra: { 1: { ekatalog: 1500000, swasta: null, tahun: 2026, akd: [] } },
    verified: [1],
  });
  kit.applyPreset('harga');
  const out = kit.copyTsv([produk(1), produk(2)], { header: false });
  const [r1, r2] = lines(out.text);
  // Kode, Nama, Brand, Harga E-Katalog, Harga Swasta, Tahun Harga, Verified INAPROC, Link
  assert.deepEqual(r1, ['K1', 'P1', 'ONEMED', '1500000', '', '2026', 'Ya', 'https://e-katalog.example/p/1']);
  assert.deepEqual(r2, ['K2', 'P2', 'ONEMED', '', '', '', '', 'https://e-katalog.example/p/2']);
  assert.equal(out.text.split('\n').length, 2);
});

test('kolom AKD: yang disalin = nomor AKD seperti di layar (bukan label status); label hanya bila nomor belum ada', () => {
  const { kit } = world({ extra: { 1: { ekatalog: null, swasta: null, tahun: null, akd: ['AKL 20401000001', 'AKL 20401000002'] } } });
  kit.applyPreset('standar'); // Nama, Tipe, AKD, Stok, Perlu dicek
  const out = kit.copyTsv([produk(1, { status_akd: 'terhubung' }), produk(2, { status_akd: 'belum_diajukan' })], { header: true });
  const [head, r1, r2] = lines(out.text);
  const i = head.indexOf('AKD');
  assert.equal(r1[i], 'AKL 20401000001, AKL 20401000002');
  assert.equal(r2[i], 'Belum ada AKD');
  assert.ok(kit.copyUses().has('extra'), 'kolom AKD perlu data AKD dimuat dulu, kalau tidak yang tersalin label status');
});

test('kolom Stok: SATU kolom, angka bila READY, selain itu label status, kosong bila belum ada data', () => {
  const { kit } = world({ stok: { 1: { status: 'READY', qty: 12 }, 2: { status: 'INDENT', qty: 0 }, 3: { status: 'READY', qty: null } } });
  kit.applyPreset('standar');
  const out = kit.copyTsv([produk(1), produk(2), produk(3), produk(4)], { header: true });
  const [head, ...body] = lines(out.text);
  const i = head.indexOf('Stok');
  assert.deepEqual(body.map((r) => r[i]), ['12', 'Indent', 'Siap', '']);
  assert.equal(head.filter((h) => /stok/i.test(h)).length, 1, 'satu kolom Stok di layar = satu kolom Stok di hasil salinan');
  assert.ok(kit.copyUses().has('stok'));
});

test('kolom Perlu dicek: teks diambil dari extraCtx.flagsText, sama dengan jalur export', () => {
  const { kit } = world();
  kit.applyPreset('standar');
  const out = kit.copyTsv([produk(1)], { header: true, extraCtx: (p) => ({ flagsText: 'Tanpa harga, Nonaktif' }) });
  const [head, r1] = lines(out.text);
  assert.equal(r1[head.indexOf('Perlu dicek')], 'Tanpa harga, Nonaktif');
});

test('semua kolom tabel punya definisi salin (guard untuk kolom baru: tanpa ini kolom baru lolos tanpa bisa disalin)', () => {
  for (const c of TABLE_COLS) {
    assert.equal(typeof (c.cp || (c.xl && c.xl[0] && c.xl[0].get)), 'function', `kolom ${c.key} tidak punya cp / xl[0].get`);
  }
});

test('kolom yang tampil = kolom yang tersalin untuk SEMUA kolom: tiap kolom menghasilkan tepat satu kolom, tanpa melempar', () => {
  const { kit } = world();
  kit.applyPreset('audit');
  kit.setAuto(TABLE_COLS.map((c) => c.key)); // paksa semua kolom tampil sebagai kolom dinamis
  kit.renderHead();
  const out = kit.copyTsv([produk(1)], { header: true, extraCtx: () => ({ flagsText: '' }) });
  const [head, r1] = lines(out.text);
  assert.equal(head.length, kit.visibleLabels().length);
  assert.equal(r1.length, head.length);
});

// ---------------- alur copy.js (createCopyKit) ----------------
function stubBrowser({ hdr = '0' } = {}) {
  const clip = [];
  const store = { pnm_crud_copy_hdr: hdr };
  const set = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  set('document', { getElementById: () => null, createElement: () => ({}), body: { appendChild: noop } });
  set('window', { isSecureContext: true, getSelection: () => ({ isCollapsed: true, toString: () => '' }), addEventListener: noop, removeEventListener: noop, innerWidth: 1000, innerHeight: 800 });
  set('navigator', { clipboard: { writeText: async (t) => { clip.push(t); } } });
  set('localStorage', { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } });
  return clip;
}
const el = () => ({ addEventListener: noop, removeEventListener: noop, querySelectorAll: () => [], classList: { toggle: noop } });

function copyKitFor(kit, { prepare = async () => null, hdr } = {}) {
  const clip = stubBrowser({ hdr });
  const toasts = [];
  const copyKit = createCopyKit({
    sb: {}, tableBody: el(), cardWrap: el(), showToast: (m, isErr) => toasts.push({ m, err: !!isErr }),
    fetchAkdNoMap: async () => new Map(), stokOf: () => undefined, ensureStok: async () => true, stokLabel: STOK_LABEL, sealLabel: (s) => SEAL[s],
    table: { labels: () => kit.visibleLabels(), prepare, tsv: (rows, header) => kit.copyTsv(rows, { header }) },
    openTableColumns: noop,
  });
  return { copyKit, clip, toasts };
}

test('createCopyKit.copyRows menulis ke clipboard persis kolom yang tampil (bukan daftar kolom salinan lama)', async () => {
  const { kit } = world({ extra: { 1: { ekatalog: 250000, swasta: 300000, tahun: 2026, akd: [] } } });
  kit.applyPreset('harga');
  kit.setAuto(['keluarga']);
  const { copyKit, clip, toasts } = copyKitFor(kit, { hdr: '1' });
  const ok = await copyKit.copyRows([produk(1)]);
  assert.equal(ok, true);
  assert.equal(clip.length, 1);
  const [head, r1] = lines(clip[0]);
  assert.deepEqual(head, kit.visibleLabels());
  assert.ok(!head.includes('Tipe') && !head.includes('Golongan'), 'kolom default salin lama (Tipe, Golongan) tidak boleh muncul kalau tidak tampil di tabel');
  assert.equal(r1[head.indexOf('Harga E-Katalog')], '250000');
  assert.equal(r1[head.indexOf('Harga Swasta')], '300000');
  assert.match(toasts.at(-1).m, /^1 baris disalin \(9 kolom\)$/);
  assert.equal(toasts.at(-1).err, false);
});

test('createCopyKit.copyRows: data kolom gagal dimuat -> tidak ada yang disalin + pesan jelas (bukan kolom kosong diam-diam)', async () => {
  const { kit } = world();
  const { copyKit, clip, toasts } = copyKitFor(kit, { prepare: async () => 'Gagal mengambil data kolom — tidak ada yang disalin' });
  const ok = await copyKit.copyRows([produk(1)]);
  assert.equal(ok, false);
  assert.equal(clip.length, 0);
  assert.deepEqual(toasts.at(-1), { m: 'Gagal mengambil data kolom — tidak ada yang disalin', err: true });
});

test('createCopyKit.copyRows: kolom dibaca SETELAH data termuat (user ganti kolom selagi menunggu -> tersalin yang tampil sekarang)', async () => {
  const { kit } = world();
  kit.applyPreset('keluarga');
  const { copyKit, clip } = copyKitFor(kit, {
    prepare: async () => { await Promise.resolve(); kit.applyPreset('akd'); return null; }, // kolom diganti saat menunggu
    hdr: '1',
  });
  await copyKit.copyRows([produk(1)]);
  assert.deepEqual(lines(clip[0])[0], kit.visibleLabels());
  assert.ok(lines(clip[0])[0].includes('No. AKD'));
});

test('createCopyKit.copyRows: tanpa baris -> tidak menulis clipboard', async () => {
  const { kit } = world();
  const { copyKit, clip, toasts } = copyKitFor(kit);
  assert.equal(await copyKit.copyRows([]), false);
  assert.equal(clip.length, 0);
  assert.equal(toasts.at(-1).err, true);
});
