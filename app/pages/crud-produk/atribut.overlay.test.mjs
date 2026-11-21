// Jalankan: node --test app/pages/crud-produk/atribut.overlay.test.mjs
// Koreksi manual MENIMPA nilai otomatis di tiga tempat yang dibaca UI: klasifikasi (klasOf / filter / opsi) dan keluarga
// (opsi filter, peta per produk, baris per keluarga). Tanpa koreksi, perilaku tidak boleh berubah (dijaga test lama).
import test from 'node:test';
import assert from 'node:assert/strict';
import { muatManual, resetManual, SPES_TANPA } from './atribut.js';
import {
  muatKlasifikasi, resetKlasifikasi, klasOf, klasAuto, cocokKlas, idsKlasFilter, opsiKlasifikasi, perluCek, sumberLabel, spesTeks, SPES_NONE,
} from './klasifikasi.js';
import { fetchKeluargaOptions, fetchKeluargaMap, fetchRowsByKeluarga, fetchKeluargaAuto } from './keluarga.js';

// ---------- fake: klasifikasi + koreksi ----------
const baris = (id, o = {}) => ({ produk_id: id, tipe: 'SET', kode_produk: 'K' + id, nama_produk: 'P' + id, kategori: 'SET', kategori_sumber: 'golongan',
  spes: 'BEDAH UMUM', spes_sumber: 'peta', jenis: null, mikro: false, golongan: null, ...o });

function sbKlas(rows) {
  return { async rpc(name, args) {
    if (name === 'get_katalog_kategori_ringkasan') return { data: { dihitung_at: '2026-11-20T00:00:00Z', total: rows.length }, error: null };
    return { data: { rows: rows.slice(args.p_offset, args.p_offset + args.p_batas), total: rows.length }, error: null };
  } };
}
const sbManual = (manual) => ({ from() {
  const chain = { select: () => chain, order: () => chain, range: (a, b) => { chain.r = [a, b]; return chain; },
    then: (res, rej) => Promise.resolve({ data: manual.slice(chain.r[0], chain.r[1] + 1), error: null }).then(res, rej) };
  return chain;
} });
const m = (produk_id, o = {}) => ({ produk_id, keluarga: null, kategori: null, spes: null, ...o });

async function siapKlas(rows, manual) {
  resetKlasifikasi(); resetManual();
  await muatKlasifikasi(sbKlas(rows));
  await muatManual(sbManual(manual));
}
const F = (dim, ...values) => ({ dim, values });
const ids = (...f) => idsKlasFilter(f).sort((a, b) => a - b);

// ---------- klasifikasi ----------
test('klasOf: kategori & spes manual menimpa otomatis, sumber jadi Dikoreksi, tidak lagi "perlu dicek"', async () => {
  await siapKlas([baris(1, { spes: 'OBGYN', spes_sumber: 'isi' }), baris(2)], [m(1, { kategori: 'UNIT', spes: 'THT' })]);
  const e = klasOf(1);
  assert.equal(e.kategori, 'UNIT');
  assert.equal(e.kategoriSumber, 'koreksi');
  assert.equal(e.spes, 'THT');
  assert.equal(e.spesSumber, 'manual');
  assert.equal(perluCek(e), false);                       // dugaan 'isi' sudah dikoreksi
  assert.equal(sumberLabel(klasOf(1)), 'Dikoreksi');      // kategori UNIT = alat -> label golongan/koreksi
  assert.equal(klasOf(2).kategori, 'SET');                // produk tanpa koreksi tak berubah
  assert.equal(klasOf(2), klasAuto(2));                   // objek yang sama: tidak ada salinan percuma
});

test('klasAuto tetap nilai otomatis walau ada koreksi (untuk hint "Otomatis: ...")', async () => {
  await siapKlas([baris(1, { kategori: 'SET', spes: 'OBGYN' })], [m(1, { kategori: 'BMHP', spes: 'THT' })]);
  assert.equal(klasAuto(1).kategori, 'SET');
  assert.equal(klasAuto(1).spes, 'OBGYN');
  assert.equal(klasOf(1).kategori, 'BMHP');
});

test('koreksi parsial: hanya kategori -> spes tetap otomatis, dan sebaliknya', async () => {
  await siapKlas([baris(1, { spes: 'OBGYN' }), baris(2, { spes: 'OBGYN' })], [m(1, { kategori: 'UNIT' }), m(2, { spes: 'THT' })]);
  assert.equal(klasOf(1).kategori, 'UNIT'); assert.equal(klasOf(1).spes, 'OBGYN'); assert.equal(klasOf(1).spesSumber, 'peta');
  assert.equal(klasOf(2).kategori, 'SET');  assert.equal(klasOf(2).kategoriSumber, 'golongan'); assert.equal(klasOf(2).spes, 'THT');
});

test('spes TANPA = sengaja tanpa spesialisasi (null), dan cocok dengan filter "Tanpa spesialisasi"', async () => {
  await siapKlas([baris(1, { spes: 'OBGYN' }), baris(2, { spes: 'OBGYN' })], [m(1, { spes: SPES_TANPA })]);
  assert.equal(klasOf(1).spes, null);
  assert.equal(spesTeks(klasOf(1)), 'Tanpa spesialisasi');
  assert.deepEqual(ids(F('spes', SPES_NONE)), [1]);
  assert.deepEqual(ids(F('spes', 'OBGYN')), [2]);
});

test('filter kategori / spes memakai nilai efektif (produk yang dikoreksi pindah kelompok)', async () => {
  await siapKlas([baris(1), baris(2), baris(3, { tipe: 'UNIT', kategori: 'ELEKTROMEDIS', spes: null })], [m(2, { kategori: 'ELEKTROMEDIS' }), m(1, { spes: 'OBGYN' })]);
  assert.deepEqual(ids(F('kategori', 'SET')), [1]);
  assert.deepEqual(ids(F('kategori', 'ELEKTROMEDIS')), [2, 3]);
  assert.deepEqual(ids(F('spes', 'OBGYN')), [1]);
  assert.equal(cocokKlas(F('kategori', 'ELEKTROMEDIS'), { id: 2 }), true);
});

test('opsiKlasifikasi: jumlah per nilai ikut koreksi', async () => {
  await siapKlas([baris(1), baris(2), baris(3)], [m(1, { kategori: 'BMHP' }), m(2, { spes: 'THT' })]);
  const o = opsiKlasifikasi();
  assert.deepEqual(o.kategori.map((x) => [x.value, x.n]).sort(), [['BMHP', 1], ['SET', 2]]);
  assert.deepEqual(Object.fromEntries(o.spes.map((x) => [x.value, x.n])), { 'BEDAH UMUM': 2, THT: 1 });
});

test('membatalkan koreksi (cache koreksi kosong) langsung mengembalikan nilai otomatis', async () => {
  await siapKlas([baris(1, { kategori: 'SET' })], [m(1, { kategori: 'BMHP' })]);
  assert.equal(klasOf(1).kategori, 'BMHP');
  await muatManual(sbManual([]), { force: true });
  assert.equal(klasOf(1).kategori, 'SET');
});

test('koreksi untuk produk yang tidak ada di cache klasifikasi (nonaktif) tetap tampil dan ikut filter', async () => {
  await siapKlas([baris(1)], [m(777, { kategori: 'BMHP' })]);
  assert.equal(klasOf(777).kategori, 'BMHP');
  assert.equal(klasOf(777).kategoriSumber, 'koreksi');
  assert.deepEqual(ids(F('kategori', 'BMHP')), [777]);
  assert.equal(klasOf(778), undefined); // tanpa koreksi & tanpa cache -> tetap kosong
});

// ---------- keluarga ----------
function sbKel({ ref = [], view = [] }) {
  return { from(name) {
    const q = { f: [], r: null };
    const chain = { select: () => chain, order: () => chain,
      in(c, v) { q.f.push([c, v]); return chain; }, range(a, b) { q.r = [a, b]; return chain; },
      then(res, rej) {
        let rows = name === 'v_keluarga_set' ? ref : view;
        q.f.forEach(([c, v]) => { rows = rows.filter((r) => v.includes(r[c])); });
        if (q.r) rows = rows.slice(q.r[0], q.r[1] + 1);
        return Promise.resolve({ data: rows.map((r) => ({ ...r })), error: null }).then(res, rej);
      } };
    return chain;
  } };
}
const view = [
  { id: 1, keluarga: 'MAYOR S', nama_produk: 'MAYOR S.' }, { id: 2, keluarga: 'MAYOR S', nama_produk: 'MAYOR S. 2' },
  { id: 3, keluarga: 'MAYOR VAGINAL S', nama_produk: 'MAYOR VAGINAL S.' }, { id: 4, keluarga: 'MINOR S', nama_produk: 'MINOR S.' },
];
const ref = [{ keluarga: 'MAYOR S', jumlah_varian: 2 }, { keluarga: 'MAYOR VAGINAL S', jumlah_varian: 1 }, { keluarga: 'MINOR S', jumlah_varian: 1 }];

test('fetchKeluargaMap: koreksi manual menang atas keluarga otomatis', async () => {
  resetManual(); await muatManual(sbManual([m(2, { keluarga: 'MINOR S' })]));
  const { map, error } = await fetchKeluargaMap(sbKel({ view }), [1, 2, 3]);
  assert.equal(error, null);
  assert.equal(map.get(1), 'MAYOR S'); assert.equal(map.get(2), 'MINOR S'); assert.equal(map.get(3), 'MAYOR VAGINAL S');
  resetManual();
});

test('fetchKeluargaAuto: nilai otomatis apa adanya, tanpa koreksi', async () => {
  resetManual(); await muatManual(sbManual([m(2, { keluarga: 'MINOR S' })]));
  const { map } = await fetchKeluargaAuto(sbKel({ view }), [2]);
  assert.equal(map.get(2), 'MAYOR S');
  resetManual();
});

test('fetchKeluargaOptions: set dipindah -> jumlah varian kedua keluarga menyesuaikan; keluarga kosong dibuang; keluarga baru muncul', async () => {
  resetManual();
  await muatManual(sbManual([m(2, { keluarga: 'MINOR S' }), m(3, { keluarga: 'KELUARGA BARU' }), m(4, { keluarga: 'MINOR S' })]));
  const { rows, error } = await fetchKeluargaOptions(sbKel({ ref, view }));
  assert.equal(error, null);
  const o = Object.fromEntries(rows.map((r) => [r.keluarga, r.n]));
  assert.deepEqual(o, { 'MAYOR S': 1, 'KELUARGA BARU': 1, 'MINOR S': 2 }); // MAYOR VAGINAL S kosong -> hilang; id 4 sama dengan otomatis -> tidak dihitung dobel
  assert.deepEqual(rows.map((r) => r.keluarga), ['KELUARGA BARU', 'MAYOR S', 'MINOR S']);                  // urut nama
  resetManual();
});

test('fetchKeluargaOptions tanpa koreksi: tidak ada query tambahan ke view', async () => {
  resetManual(); await muatManual(sbManual([]));
  let viewDipanggil = false;
  const base = sbKel({ ref, view });
  const sb = { from(n) { if (n === 'v_produk_keluarga') viewDipanggil = true; return base.from(n); } };
  const { rows } = await fetchKeluargaOptions(sb);
  assert.equal(rows.length, 3);
  assert.equal(viewDipanggil, false);
  resetManual();
});

test('fetchRowsByKeluarga: set yang dipindah KELUAR tidak ikut, yang dipindah MASUK ikut (dengan keluarga barunya), tetap urut', async () => {
  resetManual();
  await muatManual(sbManual([m(2, { keluarga: 'MINOR S' }), m(3, { keluarga: 'MAYOR S' })]));
  const sb = sbKel({ ref, view });
  const mayor = await fetchRowsByKeluarga(sb, ['MAYOR S'], 'id, keluarga, nama_produk');
  assert.deepEqual(mayor.rows.map((r) => r.id), [1, 3]);                       // 2 keluar, 3 masuk
  assert.ok(mayor.rows.every((r) => r.keluarga === 'MAYOR S'));
  const minor = await fetchRowsByKeluarga(sb, ['MINOR S'], 'id, keluarga, nama_produk');
  assert.deepEqual(minor.rows.map((r) => r.id).sort(), [2, 4]);
  assert.equal(minor.rows.find((r) => r.id === 2).keluarga, 'MINOR S');
  const keduanya = await fetchRowsByKeluarga(sb, ['MAYOR S', 'MINOR S'], 'id, keluarga, nama_produk');
  assert.deepEqual(keduanya.rows.map((r) => r.id).sort(), [1, 2, 3, 4]);      // dua keluarga dipilih: tidak ada yang hilang atau dobel
  resetManual();
});

test('fetchRowsByKeluarga: keluarga yang hanya ada lewat koreksi bisa difilter', async () => {
  resetManual(); await muatManual(sbManual([m(1, { keluarga: 'KELUARGA BARU' })]));
  const r = await fetchRowsByKeluarga(sbKel({ ref, view }), ['KELUARGA BARU'], 'id, keluarga, nama_produk');
  assert.deepEqual(r.rows.map((x) => [x.id, x.keluarga]), [[1, 'KELUARGA BARU']]);
  resetManual();
});
