// Jalankan: node --test app/pages/crud-produk/atribut.overlay.test.mjs
// Koreksi manual MENIMPA nilai otomatis untuk KELUARGA SET (opsi filter, peta per produk, baris per keluarga). Tanpa koreksi,
// perilaku tidak boleh berubah. Kategori & spesialisasi tidak lagi ditimpa di client: triggernya di database menyalin koreksi
// ke kolom produk (lihat supabase/2026-11-22_klasifikasi_kolom_produk.sql dan klasifikasi.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { muatManual, resetManual } from './atribut.js';
import { fetchKeluargaOptions, fetchKeluargaMap, fetchRowsByKeluarga, fetchKeluargaAuto } from './keluarga.js';

// ---------- fake: koreksi manual ----------
const sbManual = (manual) => ({ from() {
  const chain = { select: () => chain, order: () => chain, range: (a, b) => { chain.r = [a, b]; return chain; },
    then: (res, rej) => Promise.resolve({ data: manual.slice(chain.r[0], chain.r[1] + 1), error: null }).then(res, rej) };
  return chain;
} });
const m = (produk_id, o = {}) => ({ produk_id, keluarga: null, kategori: null, spes: null, ...o });

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
