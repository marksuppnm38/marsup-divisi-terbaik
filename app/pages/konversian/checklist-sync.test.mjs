// Test checklist-sync.js — jalankan: node --test checklist-sync.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createItemWriteTracker, mergeChecklistSnapshot } from './checklist-sync.js';

const mk = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, raw_text: 'item ' + i, status: 'PENDING', matched_items: [] }));
const dari = (ids) => ids.map((id) => ({ id, raw_text: 'item ' + (id - 1), status: 'TERPENUHI', matched_items: [{ kode_produk: 'K' + id }] }));
const done = (arr) => arr.filter((i) => i.status === 'TERPENUHI').length;

function clock() { let t = 1000; return { now: () => t, tick: (d = 10) => { t += d; return t; } }; }

test('REGRESI counter: 7 terpenuhi lalu snapshot basi tiba -> tetap 7 (dulu jatuh ke 1)', () => {
  const c = clock();
  const tr = createItemWriteTracker({ now: c.now });
  const local = mk(21);
  // item 1 selesai ditulis SEBELUM fetch berangkat
  tr.begin(1); c.tick(); local[0].status = 'TERPENUHI'; tr.end(1); c.tick();
  const t0 = c.now();                              // fetch reload otomatis berangkat di sini
  const snapshotBasi = [...dari([1]), ...mk(21).slice(1)]; // server saat itu: hanya item 1 terpenuhi
  // "Pakai N yang cocok" terus menulis item 2..7 selagi fetch di jalan
  for (let id = 2; id <= 7; id++) { tr.begin(id); c.tick(); local[id - 1].status = 'TERPENUHI'; tr.end(id); c.tick(); }
  assert.equal(done(local), 7);
  c.tick(200);                                     // balasan fetch baru tiba

  // Perilaku LAMA (ganti total): hitungan jatuh ke 1 — inilah bug di screenshot.
  assert.equal(done(snapshotBasi.map((x) => ({ ...x }))), 1);

  // Perilaku BARU: item 2..7 dilindungi karena ditulis setelah t0.
  const merged = mergeChecklistSnapshot(local, snapshotBasi, tr, t0);
  assert.equal(done(merged), 7);
  assert.equal(merged.length, 21);
});

test('tulisan yang masih berjalan (inflight) dipertahankan, objek item tidak diganti (referensi tetap hidup)', async () => {
  const c = clock();
  const tr = createItemWriteTracker({ now: c.now });
  const local = mk(3);
  const ref = local[1];
  const t0 = c.now();
  tr.begin(2);                                  // tulisan item 2 sedang berjalan
  const merged = mergeChecklistSnapshot(local, mk(3), tr, t0); // server masih PENDING (basi)
  assert.equal(merged[1], ref, 'identitas objek dipertahankan');
  ref.status = 'TERPENUHI'; tr.end(2);           // loop pemanggil menulis ke objek yang sama
  assert.equal(merged[1].status, 'TERPENUHI');
  assert.equal(done(merged), 1);
});

test('item yang tidak kotor mengikuti server (perubahan rekan masuk, field teks ikut berubah)', () => {
  const c = clock();
  const tr = createItemWriteTracker({ now: c.now });
  const local = mk(2);
  c.tick(5000);
  const server = [{ ...local[0], status: 'TERPENUHI', matched_items: [{ kode_produk: 'Z' }], raw_text: 'diedit rekan' }, { ...local[1] }];
  const merged = mergeChecklistSnapshot(local, server, tr, c.now());
  assert.equal(merged[0].status, 'TERPENUHI');
  assert.equal(merged[0].raw_text, 'diedit rekan');
});

test('perubahan rekan lewat note() juga melindungi dari snapshot yang berangkat lebih dulu', () => {
  const c = clock();
  const tr = createItemWriteTracker({ now: c.now });
  const local = mk(2);
  const t0 = c.now();
  c.tick();
  local[0].status = 'TERPENUHI'; tr.note(1);      // broadcast rekan tiba setelah fetch berangkat
  const merged = mergeChecklistSnapshot(local, mk(2), tr, t0);
  assert.equal(merged[0].status, 'TERPENUHI');
});

test('item baru dari server masuk, item yang dihapus di server hilang, urutan mengikuti server', () => {
  const tr = createItemWriteTracker();
  const local = mk(3);
  const server = [{ id: 3, raw_text: 'c', status: 'PENDING' }, { id: 9, raw_text: 'baru', status: 'PENDING' }];
  const merged = mergeChecklistSnapshot(local, server, tr, Date.now() + 1);
  assert.deepEqual(merged.map((i) => i.id), [3, 9]);
});

test('server format lama (tanpa matched_items) tidak mewariskan matched_items lokal yang basi', () => {
  const tr = createItemWriteTracker();
  const local = [{ id: 1, status: 'TERPENUHI', matched_items: [{ kode_produk: 'LAMA' }] }];
  const merged = mergeChecklistSnapshot(local, [{ id: 1, status: 'PENDING' }], tr, Date.now() + 1);
  assert.equal('matched_items' in merged[0], false);
});

test('track(): selalu end() walau fn melempar; entri dibersihkan setelah keepMs', async () => {
  const c = clock();
  const tr = createItemWriteTracker({ now: c.now, keepMs: 100 });
  await assert.rejects(tr.track(5, async () => { throw new Error('x'); }));
  assert.equal(tr.isDirty(5, c.now() + 1), false);
  assert.equal(tr.isDirty(5, c.now() - 1), true);
  c.tick(500); tr.begin(6); tr.end(6);            // prune berjalan di end()
  assert.equal(tr.size(), 1);
});
