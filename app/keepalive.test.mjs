// Tes logika murni tempat parkir keep-alive (tanpa DOM). Jalankan: node --test app/keepalive.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createParkingLot, DEFAULT_MAX_PARKED, DEFAULT_TTL_MS } from './keepalive.js';

// Jam palsu supaya TTL bisa dites tanpa menunggu.
function fakeClock(start = 1_000_000) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => { t += ms; };
  return now;
}

test('bawaan: maks 3 modul, TTL 30 menit', () => {
  assert.equal(DEFAULT_MAX_PARKED, 3);
  assert.equal(DEFAULT_TTL_MS, 30 * 60 * 1000);
});

test('park + take: nilai kembali sekali, lalu hilang dari tempat parkir', () => {
  const lot = createParkingLot({ now: fakeClock() });
  assert.deepEqual(lot.park('a', { n: 1 }), []);
  assert.equal(lot.has('a'), true);
  assert.deepEqual(lot.take('a'), { n: 1 });
  assert.equal(lot.has('a'), false);
  assert.equal(lot.take('a'), null);
});

test('LRU: entri bersih paling lama dibuang saat melebihi batas', () => {
  const now = fakeClock();
  const lot = createParkingLot({ max: 3, now });
  lot.park('a', 'A'); now.advance(10);
  lot.park('b', 'B'); now.advance(10);
  lot.park('c', 'C'); now.advance(10);
  const evicted = lot.park('d', 'D');
  assert.deepEqual(evicted, [{ id: 'a', value: 'A' }]);
  assert.deepEqual(lot.ids().sort(), ['b', 'c', 'd']);
});

test('LRU: parkir ulang dihitung baru dipakai (a diambil lalu diparkir lagi tidak jadi korban)', () => {
  const now = fakeClock();
  const lot = createParkingLot({ max: 3, now });
  lot.park('a', 'A'); now.advance(10);
  lot.park('b', 'B'); now.advance(10);
  lot.park('c', 'C'); now.advance(10);
  assert.equal(lot.take('a'), 'A'); now.advance(10);
  lot.park('a', 'A2'); now.advance(10);
  const evicted = lot.park('d', 'D');
  assert.deepEqual(evicted, [{ id: 'b', value: 'B' }]);
});

test('LRU: waktu parkir sama dipecah oleh urutan parkir', () => {
  const lot = createParkingLot({ max: 2, now: () => 5 });
  lot.park('a', 'A');
  lot.park('b', 'B');
  assert.deepEqual(lot.park('c', 'C'), [{ id: 'a', value: 'A' }]);
});

test('draft: entri dirty tidak dibuang LRU, yang bersih tertua yang dibuang', () => {
  const now = fakeClock();
  const lot = createParkingLot({ max: 3, now });
  lot.park('a', 'A', { isDirty: () => true }); now.advance(10); // tertua tapi dirty
  lot.park('b', 'B'); now.advance(10);
  lot.park('c', 'C'); now.advance(10);
  const evicted = lot.park('d', 'D');
  assert.deepEqual(evicted, [{ id: 'b', value: 'B' }]);
  assert.deepEqual(lot.ids().sort(), ['a', 'c', 'd']);
});

test('draft: kalau semua kandidat dirty, batas boleh terlampaui dan tidak ada yang dibuang', () => {
  const now = fakeClock();
  const lot = createParkingLot({ max: 2, now });
  lot.park('a', 'A', { isDirty: () => true }); now.advance(10);
  lot.park('b', 'B', { isDirty: () => true }); now.advance(10);
  const evicted = lot.park('c', 'C', { isDirty: () => true });
  assert.deepEqual(evicted, []);
  assert.equal(lot.size, 3);
});

test('entri yang baru diparkir tidak jadi korban LRU pada park() yang sama', () => {
  const now = fakeClock();
  const lot = createParkingLot({ max: 2, now });
  lot.park('a', 'A', { isDirty: () => true }); now.advance(10);
  lot.park('b', 'B', { isDirty: () => true }); now.advance(10);
  const evicted = lot.park('c', 'C'); // c bersih tapi baru: tidak boleh langsung dibuang
  assert.deepEqual(evicted, []);
  assert.equal(lot.has('c'), true);
});

test('isDirty dievaluasi dinamis: entri yang tadinya dirty dan sekarang bersih bisa dibuang', () => {
  const now = fakeClock();
  let dirty = true;
  const lot = createParkingLot({ max: 2, now });
  lot.park('a', 'A', { isDirty: () => dirty }); now.advance(10);
  lot.park('b', 'B'); now.advance(10);
  dirty = false;
  assert.deepEqual(lot.park('c', 'C'), [{ id: 'a', value: 'A' }]);
});

test('isDirty yang melempar error dianggap dirty (draft tidak hilang karena bug)', () => {
  const now = fakeClock();
  const lot = createParkingLot({ max: 2, ttlMs: 100, now });
  lot.park('a', 'A', { isDirty: () => { throw new Error('boom'); } });
  now.advance(10);
  lot.park('b', 'B'); now.advance(10);
  assert.deepEqual(lot.park('c', 'C'), [{ id: 'b', value: 'B' }]);
  now.advance(1000);
  assert.deepEqual(lot.sweep().map((e) => e.id), ['c']);
  assert.equal(lot.has('a'), true);
  assert.deepEqual(lot.dirtyIds(), ['a']);
});

test('TTL: entri bersih kedaluwarsa setelah melewati batas, tepat di batas masih hidup', () => {
  const now = fakeClock();
  const lot = createParkingLot({ ttlMs: 1000, now });
  lot.park('a', 'A');
  now.advance(1000);
  assert.deepEqual(lot.sweep(), []); // tepat 1000 ms: belum lewat
  now.advance(1);
  assert.deepEqual(lot.sweep(), [{ id: 'a', value: 'A' }]);
  assert.equal(lot.size, 0);
});

test('TTL: entri dirty tidak pernah kedaluwarsa, yang bersih tetap', () => {
  const now = fakeClock();
  const lot = createParkingLot({ ttlMs: 1000, now });
  lot.park('a', 'A', { isDirty: () => true });
  lot.park('b', 'B');
  now.advance(DEFAULT_TTL_MS * 10);
  assert.deepEqual(lot.sweep(), [{ id: 'b', value: 'B' }]);
  assert.deepEqual(lot.ids(), ['a']);
});

test('TTL dihitung dari parkir terakhir, bukan parkir pertama', () => {
  const now = fakeClock();
  const lot = createParkingLot({ ttlMs: 1000, now });
  lot.park('a', 'A');
  now.advance(900);
  assert.equal(lot.take('a'), 'A');
  lot.park('a', 'A');
  now.advance(900);
  assert.deepEqual(lot.sweep(), []);
});

test('dirtyIds: hanya modul terparkir yang punya draft', () => {
  const lot = createParkingLot({ now: fakeClock() });
  lot.park('a', 'A', { isDirty: () => true });
  lot.park('b', 'B');
  lot.park('c', 'C', { isDirty: () => true });
  assert.deepEqual(lot.dirtyIds().sort(), ['a', 'c']);
});

test('clear (logout): membuang SEMUA entri termasuk yang dirty, dan mengembalikannya', () => {
  const lot = createParkingLot({ now: fakeClock() });
  lot.park('a', 'A', { isDirty: () => true });
  lot.park('b', 'B');
  const all = lot.clear();
  assert.deepEqual(all.map((e) => e.id).sort(), ['a', 'b']);
  assert.equal(lot.size, 0);
  assert.deepEqual(lot.dirtyIds(), []);
});

test('park id yang sama menggantikan entri lama (tidak menggandakan)', () => {
  const lot = createParkingLot({ now: fakeClock() });
  lot.park('a', 'A1');
  lot.park('a', 'A2');
  assert.equal(lot.size, 1);
  assert.equal(lot.take('a'), 'A2');
});

// ---- posisi scroll ----
import { collectScrollSpots, applyScrollSpots } from './keepalive.js';

test('scroll: hanya elemen yang benar-benar tergulir yang dicatat', () => {
  const a = { scrollTop: 120, scrollLeft: 0 };
  const b = { scrollTop: 0, scrollLeft: 0 };
  const c = { scrollTop: 0, scrollLeft: 30 };
  const spots = collectScrollSpots([a, b, c, null]);
  assert.deepEqual(spots.map((s) => [s.node, s.top, s.left]), [[a, 120, 0], [c, 0, 30]]);
});

test('scroll: pemulihan mengembalikan posisi ke elemen yang sama', () => {
  const a = { scrollTop: 120, scrollLeft: 5 };
  const spots = collectScrollSpots([a]);
  a.scrollTop = 0; a.scrollLeft = 0; // meniru reset saat dilepas dari dokumen
  applyScrollSpots(spots);
  assert.equal(a.scrollTop, 120);
  assert.equal(a.scrollLeft, 5);
});

test('scroll: satu elemen yang gagal diatur tidak menghentikan yang lain', () => {
  const bad = { scrollLeft: 1 };
  Object.defineProperty(bad, 'scrollTop', { get: () => 10, set: () => { throw new Error('detached'); } });
  const good = { scrollTop: 50, scrollLeft: 0 };
  const spots = collectScrollSpots([bad, good]);
  good.scrollTop = 0;
  applyScrollSpots(spots);
  assert.equal(good.scrollTop, 50);
});

test('scroll: applyScrollSpots tahan undefined / daftar kosong', () => {
  assert.doesNotThrow(() => applyScrollSpots(undefined));
  assert.doesNotThrow(() => applyScrollSpots([]));
  assert.deepEqual(collectScrollSpots([]), []);
});
