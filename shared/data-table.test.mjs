// node --test shared/data-table.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyToQuery, needsInner, sortUsesJoin, normalizeFilter, filterRows, sortRows, resolveColumns, nextSort, describeFilter, addDaysISO } from './data-table.js';
import { setTablePreset, consumeTablePreset } from './table-preset.js';

// Query palsu: mencatat urutan pemanggilan supaya kita bisa memastikan apa yang dikirim ke Supabase.
const fake = () => { const calls = []; const q = new Proxy({}, { get: (_, name) => (...args) => { calls.push([name, ...args]); return q; } }); return { q, calls }; };

const COLS = [
  { key: 'no_akd', label: 'No. AKD', locked: true },
  { key: 'masa_berlaku', label: 'Masa Berlaku', type: 'date' },
  { key: 'golongan', label: 'Golongan', type: 'enum', options: ['A', 'B'] },
  { key: 'kode_produk', label: 'Kode Produk', field: 'produk.kode_produk' },
  { key: 'catatan', label: 'Catatan', sortable: false },
  { key: 'extra', label: 'Extra', hidden: true },
];
const TODAY = '2026-11-23';

test('within: hari ini s/d +N hari (sama dengan hitungan dashboard)', () => {
  const { q, calls } = fake();
  applyToQuery(q, { filters: [{ key: 'masa_berlaku', op: 'within', value: 30 }], sort: null }, COLS, { today: TODAY });
  assert.deepEqual(calls, [['gte', 'masa_berlaku', '2026-11-23'], ['lte', 'masa_berlaku', '2026-12-23']]);
});
test('expired: kurang dari hari ini', () => {
  const { q, calls } = fake();
  applyToQuery(q, { filters: [{ key: 'masa_berlaku', op: 'expired' }] }, COLS, { today: TODAY });
  assert.deepEqual(calls, [['lt', 'masa_berlaku', TODAY]]);
});
test('urut: kosong selalu di bawah + tie-break', () => {
  const { q, calls } = fake();
  applyToQuery(q, { filters: [], sort: { key: 'masa_berlaku', dir: 'asc' } }, COLS, { tieBreak: 'id' });
  assert.deepEqual(calls, [['order', 'masa_berlaku', { ascending: true, nullsFirst: false }], ['order', 'id', { ascending: true }]]);
});
test('urut turun + kolom relasi memakai sintaks embed', () => {
  const { q, calls } = fake();
  applyToQuery(q, { filters: [], sort: { key: 'kode_produk', dir: 'desc' } }, COLS, {});
  assert.deepEqual(calls, [['order', 'produk(kode_produk)', { ascending: false, nullsFirst: false }]]);
});
test('kolom tak dikenal / sortable:false diabaikan', () => {
  const { q, calls } = fake();
  applyToQuery(q, { filters: [{ key: 'hantu', op: 'isi' }], sort: { key: 'catatan', dir: 'asc' } }, COLS, {});
  assert.deepEqual(calls, []);
});
test('contains: karakter LIKE di-escape', () => {
  const { q, calls } = fake();
  applyToQuery(q, { filters: [{ key: 'no_akd', op: 'contains', value: '50%_x' }] }, COLS, {});
  assert.deepEqual(calls, [['ilike', 'no_akd', '%50\\%\\_x%']]);
});
test('kosong teks = NULL atau string kosong; kolom relasi cukup NULL', () => {
  let r = fake(); applyToQuery(r.q, { filters: [{ key: 'no_akd', op: 'kosong' }] }, COLS, {});
  assert.deepEqual(r.calls, [['or', 'no_akd.is.null,no_akd.eq.']]);
  r = fake(); applyToQuery(r.q, { filters: [{ key: 'kode_produk', op: 'kosong' }] }, COLS, {});
  assert.deepEqual(r.calls, [['is', 'produk.kode_produk', null]]);
});
test('needsInner / sortUsesJoin', () => {
  assert.equal(needsInner({ filters: [{ key: 'kode_produk', op: 'isi' }] }, COLS), true);
  assert.equal(needsInner({ filters: [{ key: 'golongan', op: 'in', value: ['A'] }] }, COLS), false);
  assert.equal(sortUsesJoin({ sort: { key: 'kode_produk', dir: 'asc' } }, COLS), true);
  assert.equal(sortUsesJoin({ sort: { key: 'golongan', dir: 'asc' } }, COLS), false);
});
test('normalizeFilter menolak input ngawur (preset dari luar tak tepercaya)', () => {
  const c = COLS[1];
  assert.equal(normalizeFilter(c, { op: 'within', value: -1 }), null);
  assert.equal(normalizeFilter(c, { op: 'within', value: 'abc' }), null);
  assert.equal(normalizeFilter(c, { op: 'contains', value: 'x' }), null); // op tidak berlaku untuk date
  assert.equal(normalizeFilter(c, { op: 'dari', value: '2026-13' }), null);
  assert.deepEqual(normalizeFilter(c, { op: 'antara', value: { from: '2026-12-01', to: '2026-01-01' } }), { key: 'masa_berlaku', op: 'antara', value: { from: '2026-01-01', to: '2026-12-01' } });
  assert.equal(normalizeFilter(COLS[4], { op: 'isi' })?.op, 'isi');
  assert.equal(normalizeFilter({ key: 'x', filterable: false }, { op: 'isi' }), null);
});
test('mode client: filter + urut, kosong di bawah', () => {
  const rows = [{ id: 1, masa_berlaku: '2026-12-01' }, { id: 2, masa_berlaku: null }, { id: 3, masa_berlaku: '2026-11-25' }, { id: 4, masa_berlaku: '2026-10-01' }];
  const c = [COLS[1]];
  assert.deepEqual(filterRows(rows, [{ key: 'masa_berlaku', op: 'within', value: 30 }], c, TODAY).map((r) => r.id), [1, 3]);
  assert.deepEqual(filterRows(rows, [{ key: 'masa_berlaku', op: 'expired' }], c, TODAY).map((r) => r.id), [4]);
  assert.deepEqual(sortRows(rows, { key: 'masa_berlaku', dir: 'asc' }, c, 'id').map((r) => r.id), [4, 3, 1, 2]);
  assert.deepEqual(sortRows(rows, { key: 'masa_berlaku', dir: 'desc' }, c, 'id').map((r) => r.id), [1, 3, 4, 2]);
});
test('resolveColumns: bawaan hidden, kolom baru, locked tetap depan', () => {
  assert.deepEqual([...resolveColumns(COLS, null).hidden], ['extra']);
  const r = resolveColumns(COLS, { order: ['golongan', 'ghost', 'masa_berlaku'], hidden: ['masa_berlaku'] });
  assert.deepEqual(r.order, ['no_akd', 'golongan', 'masa_berlaku', 'kode_produk', 'catatan', 'extra']);
  assert.deepEqual([...r.hidden].sort(), ['extra', 'masa_berlaku']); // extra belum pernah tersimpan -> ikut bawaan
  assert.equal(resolveColumns(COLS, { order: [], hidden: [] }).order[0], 'no_akd');
});
test('nextSort: memilih arah aktif = mematikan', () => {
  assert.deepEqual(nextSort(null, 'a', 'asc'), { key: 'a', dir: 'asc' });
  assert.equal(nextSort({ key: 'a', dir: 'asc' }, 'a', 'asc'), null);
  assert.deepEqual(nextSort({ key: 'a', dir: 'asc' }, 'a', 'desc'), { key: 'a', dir: 'desc' });
});
test('describeFilter + addDaysISO (lintas bulan/tahun)', () => {
  assert.equal(describeFilter(COLS[1], { op: 'within', value: 30 }), '≤ 30 hari lagi');
  assert.equal(describeFilter(COLS[2], { op: 'in', value: ['A', 'B', 'C'] }), 'A, B +1');
  assert.equal(addDaysISO('2026-12-20', 30), '2027-01-19');
});
test('preset: sekali pakai, milik tabel lain tidak dihapus, kedaluwarsa 60 dtk', () => {
  const store = new Map();
  globalThis.sessionStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  setTablePreset({ table: 'akd', filters: [{ key: 'masa_berlaku', op: 'expired' }], sort: { key: 'masa_berlaku', dir: 'desc' } });
  assert.equal(consumeTablePreset('kfa'), null);
  const p = consumeTablePreset('akd');
  assert.equal(p.filters[0].op, 'expired'); assert.equal(p.sort.dir, 'desc');
  assert.equal(consumeTablePreset('akd'), null); // sudah habis
  setTablePreset({ table: 'akd', filters: [] });
  assert.equal(consumeTablePreset('akd', Date.now() + 61000), null); // basi
});
