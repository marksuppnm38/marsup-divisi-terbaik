import test from 'node:test';
import assert from 'node:assert/strict';
import { perluSegarkan, adaDraft, createGlobalBindings, BATAS_SEGAR_MS } from './siklus-hidup.js';

// Target palsu: mencatat jumlah listener per jenis, tanpa DOM.
function targetPalsu() {
  const n = new Map();
  return {
    addEventListener(t, f) { n.set(t, (n.get(t) || new Set()).add(f)); },
    removeEventListener(t, f) { n.get(t)?.delete(f); },
    jumlah: (t) => (n.get(t) ? n.get(t).size : 0),
  };
}

test('perluSegarkan: tepat di batas belum, lewat batas ya', () => {
  const t0 = 1_000_000;
  assert.equal(perluSegarkan(t0, t0 + BATAS_SEGAR_MS), false);
  assert.equal(perluSegarkan(t0, t0 + BATAS_SEGAR_MS + 1), true);
  assert.equal(perluSegarkan(t0, t0 + 5_000), false);
});

test('perluSegarkan: belum pernah dimuat / nilai ngawur = tidak menyegarkan', () => {
  assert.equal(perluSegarkan(0, 9e12), false);
  assert.equal(perluSegarkan(NaN, 9e12), false);
  assert.equal(perluSegarkan(undefined, 9e12), false);
});

test('adaDraft: hanya bila modal terbuka DAN dirty', () => {
  assert.equal(adaDraft({ modalState: 'edit', modalDirty: true }), true);
  assert.equal(adaDraft({ modalState: 'add', modalDirty: true }), true);
  assert.equal(adaDraft({ modalState: 'busy', modalDirty: true }), true);
  assert.equal(adaDraft({ modalState: 'edit', modalDirty: false }), false);
  assert.equal(adaDraft({ modalState: 'closed', modalDirty: true }), false); // sisa flag tanpa modal bukan draft
  assert.equal(adaDraft({}), false);
  assert.equal(adaDraft(), false);
});

test('bindings: lepas lalu sambung memasang ulang tepat satu kali', () => {
  const doc = targetPalsu(); const win = targetPalsu();
  const gb = createGlobalBindings();
  const f1 = () => {}; const f2 = () => {};
  gb.pasang(doc, 'click', f1);
  gb.pasang(win, 'resize', f2);
  assert.equal(doc.jumlah('click'), 1);
  gb.lepas(); gb.lepas(); // idempoten
  assert.equal(doc.jumlah('click'), 0);
  assert.equal(win.jumlah('resize'), 0);
  gb.sambung(); gb.sambung(); // idempoten
  assert.equal(doc.jumlah('click'), 1);
  assert.equal(win.jumlah('resize'), 1);
});

test('bindings: pasang pasangan yang sama dua kali tidak menggandakan listener', () => {
  const doc = targetPalsu(); const f = () => {};
  const gb = createGlobalBindings();
  gb.pasang(doc, 'keydown', f); gb.pasang(doc, 'keydown', f);
  assert.equal(doc.jumlah('keydown'), 1);
  assert.equal(gb.status().length, 1);
});

test('bindings: click dan keydown dengan handler yang sama (menu Export) tercatat terpisah', () => {
  const doc = targetPalsu(); const f = () => {};
  const gb = createGlobalBindings();
  gb.pasang(doc, 'click', f); gb.pasang(doc, 'keydown', f);
  gb.lepas();
  assert.equal(doc.jumlah('click') + doc.jumlah('keydown'), 0);
  gb.sambung();
  assert.equal(doc.jumlah('click') + doc.jumlah('keydown'), 2);
});

test('bindings: beforeunload tetap terpasang saat draft, lepas saat bersih', () => {
  const win = targetPalsu(); const f = () => {}; const g = () => {};
  const gb = createGlobalBindings();
  gb.pasang(win, 'beforeunload', f, { tetapSaatDraft: true });
  gb.pasang(win, 'resize', g);
  gb.lepas({ draft: true });
  assert.equal(win.jumlah('beforeunload'), 1);
  assert.equal(win.jumlah('resize'), 0);
  gb.sambung(); // tidak menggandakan yang masih terpasang
  assert.equal(win.jumlah('beforeunload'), 1);
  gb.lepas({ draft: false });
  assert.equal(win.jumlah('beforeunload'), 0);
});

test('bindings: buang (unmount) melepas semua dan mengosongkan daftar; sambung sesudahnya tidak memasang apa-apa', () => {
  const doc = targetPalsu(); const f = () => {};
  const gb = createGlobalBindings();
  gb.pasang(doc, 'click', f);
  gb.lepas();           // unmount setelah suspend: sudah lepas, buang tidak boleh error
  gb.buang();
  gb.sambung();
  assert.equal(doc.jumlah('click'), 0);
  assert.equal(gb.status().length, 0);
});

test('bindings: buang saat masih terpasang (unmount tanpa suspend) melepas semuanya', () => {
  const doc = targetPalsu(); const f = () => {};
  const gb = createGlobalBindings();
  gb.pasang(doc, 'keydown', f);
  gb.buang();
  assert.equal(doc.jumlah('keydown'), 0);
});

test('bindings: opsi capture diteruskan sama saat pasang dan lepas', () => {
  const calls = [];
  const t = { addEventListener: (...a) => calls.push(['add', ...a]), removeEventListener: (...a) => calls.push(['rm', ...a]) };
  const f = () => {};
  const gb = createGlobalBindings();
  gb.pasang(t, 'keydown', f, { opsi: true });
  gb.lepas();
  assert.deepEqual(calls.map((c) => [c[0], c[1], c[3]]), [['add', 'keydown', true], ['rm', 'keydown', true]]);
});
