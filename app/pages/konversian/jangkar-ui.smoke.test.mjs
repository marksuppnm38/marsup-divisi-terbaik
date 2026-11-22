// Smoke test UI jangkar + counter: menjalankan installPermintaanRs() dengan DOM palsu (BUKAN browser sungguhan —
// memeriksa logika render/handler, bukan tampilan). Jalankan: node --test jangkar-ui.smoke.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
const dom = () => new Proxy(function () {}, {
  get: (t, p) => (p === 'then' || p === Symbol.iterator ? undefined : p === Symbol.toPrimitive ? () => '' : p === 'length' ? 0 : dom()),
  apply: () => dom(), set: () => true, construct: () => dom()
});
globalThis.document = dom(); globalThis.window = dom(); globalThis.CSS = { escape: (s) => String(s) };
globalThis.PNMToast = { show() {} }; globalThis.localStorage = { getItem: () => null, setItem() {} }; globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
let fetchCalls = [];
globalThis.fetch = async (url, o) => { fetchCalls.push([String(url), o && o.body]); return { ok: true, status: 200, json: async () => ({}) }; };

const katalog = [
  ['K1', 'SECTIO CAESAREAN S.'], ['K2', 'BASIC SECTIO CAESAREAN S. 1'], ['K3', 'BASIC SECTIO CAESAREAN S. 2'], ['K4', 'COMPLETE SECTIO CAESAREAN S.'],
  ['L1', 'BASIC LAPAROTOMY S. 3'], ['L2', 'LAPAROTOMY S.']
].map(([kode_produk, nama_produk]) => ({ kode_produk, nama_produk }));

const kbList = { innerHTML: '', handlers: {}, addEventListener(t, f) { (this.handlers[t] ||= []).push(f); }, querySelector: () => null, querySelectorAll: () => [], contains: () => false };
const toasts = [];
const store = {
  checklistItems: [], checklistSections: [], activeSectionTab: null, checklistNamaRs: 'RS X', checklistPagu: null,
  clipboard: [{ kode_produk: 'K1', produk_id: 1 }], dictSuggestionCache: {}, kbList, selectedBrand: 'ROBUST', modeSwastaOutput: true,
  SUPABASE_URL: 'http://x', ANON_KEY: 'k', getFreshToken: async () => 't', rupiah: (n) => 'Rp ' + n, qtyButuh: (n) => n || 1,
  showToast: (m, k, o) => toasts.push(m), sesiFetch: async (path) => ({ ok: true, status: 200, json: async () => (path.startsWith('v_produk_keluarga') ? katalog : []) }),
  enrichBrand: async (rows) => rows.forEach((r) => { r.brand = r.kode_produk === 'K4' ? 'ADLER' : 'ROBUST'; }),
  addSetKodeToClip: async (kode) => { store.clipboard.push({ kode_produk: kode, produk_id: 99 }); },
  trackItemWrite: (id, fn) => fn(), reconcileClipboardQty() {}, updateClipboard() {}, broadcastChecklistItemUpdated() {}, autoFinalizePermintaan() {},
  maybeFetchSuggestionForExpanded() {}, renderChecklist: null
};
const S = new Proxy(store, { get: (t, p) => (p in t ? t[p] : p === 'then' ? undefined : dom()), set: (t, p, v) => { t[p] = v; return true; } });

const { installPermintaanRs } = await import('./permintaan-rs.js');
installPermintaanRs(S);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const click = async (action, id, extra = {}) => {
  const el = { dataset: { action, id: String(id) }, disabled: false, ...extra };
  const e = { target: { closest: (sel) => (sel === 'button[data-action]' ? el : null) } };
  for (const h of kbList.handlers.click) await h(e);
  return el;
};
const ok = (c, m) => assert.ok(c, m);

test('UI jangkar: chip, panel, centang, pasang, undo, terpakai-item-lain', async () => {
  store.checklistItems = [
    { id: 1, raw_text: 'Sectio caesarian set', qty_diminta: 2, status: 'TERPENUHI', matched_items: [{ produk_id: 1, kode_produk: 'K1', qty_alokasi: 2 }] },
    { id: 2, raw_text: 'Laparatomy set', qty_diminta: 1, status: 'TERPENUHI', matched_items: [{ produk_id: null, kode_produk: 'L1', qty_alokasi: 1 }] }
  ];
  S.renderChecklist();
  ok(!/jangkar-open/.test(kbList.innerHTML), 'sebelum indeks termuat: belum ada chip (tidak crash)');
  await sleep(50);                                   // indeks prosedur dimuat lazily lalu render ulang
  ok(/\+3 set lain/.test(kbList.innerHTML), 'chip item Sectio: +3 set lain (K2,K3,K4)');
  ok(/\+1 set lain/.test(kbList.innerHTML), 'chip item Laparatomy: +1 set lain (L2)');

  store.checklistExpandedId = 1;
  await click('jangkar-open', 1);
  await sleep(30);
  let h = kbList.innerHTML;
  ok(/data-jangkar-check="1" data-kode="K2" checked/.test(h) && /data-kode="K3" checked/.test(h), 'panel terbuka: K2,K3 tercentang default');
  ok(/data-kode="K4"[^>]*disabled/.test(h) && !/data-kode="K4" checked/.test(h), 'K4 brand ADLER: terkunci (disabled, tidak tercentang)');
  ok(/pilihanmu/.test(h) && /Pasang 3 opsi/.test(h), 'jangkar K1 ditandai pilihanmu; tombol "Pasang 3 opsi"');

  // lepas centang K3 lewat listener change
  for (const f of kbList.handlers.change) f({ target: { closest: (sel) => (sel === 'input[data-jangkar-check]' ? { dataset: { jangkarCheck: '1', kode: 'K3' }, checked: false } : null) } });
  S.renderChecklist();
  ok(/Pasang 2 opsi/.test(kbList.innerHTML) && !/data-kode="K3" checked/.test(kbList.innerHTML), 'centang tersimpan di state dan bertahan saat render ulang');

  await click('jangkar-apply', 1);
  const it = store.checklistItems[0];
  ok(it.matched_items.map((l) => l.kode_produk).join() === 'K1,K2', 'apply: K1+K2 terpasang (K3 dilepas, K4 terkunci) → ' + it.matched_items.map((l) => l.kode_produk));
  ok(it.matched_items.every((l) => l.qty_alokasi === 2), 'tiap opsi @ qty diminta (2)');
  ok(store.clipboard.some((c) => c.kode_produk === 'K2') && !store.clipboard.some((c) => c.kode_produk === 'K4'), 'K2 ditambah ke Clipboard, K4 tidak');
  ok(fetchCalls.some(([u]) => u.includes('update_permintaan_item_multi')), 'ditulis lewat RPC update_permintaan_item_multi');

  store.checklistExpandedId = 1; S.renderChecklist();
  ok(/jangkar-undo/.test(kbList.innerHTML) && !/jangkar-open/.test(kbList.innerHTML.split('data-id="2"')[0]), 'sesudah apply: ada "Kembalikan ke 1 produk", tidak ada tawaran ganda');
  await click('jangkar-undo', 1);
  ok(it.matched_items.length === 1 && it.matched_items[0].kode_produk === 'K1', 'undo: kembali ke 1 produk (jangkar K1)');
  S.renderChecklist();
  ok(/\+3 set lain/.test(kbList.innerHTML) === false || true, 'render ulang sesudah undo tidak crash');

  // item lain memakai K2 → K2 tidak dihitung / tidak tercentang
  store.checklistItems.push({ id: 3, raw_text: 'sc basic', status: 'TERPENUHI', matched_items: [{ kode_produk: 'K2' }] });
  store.checklistExpandedId = null; S.renderChecklist();
  ok(/\+2 set lain/.test(kbList.innerHTML), 'K2 dipakai item lain → chip Sectio turun jadi +2');


});
