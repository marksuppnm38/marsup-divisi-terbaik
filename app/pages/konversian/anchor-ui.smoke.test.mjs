// Smoke test UI anchor + counter: menjalankan installPermintaanRs() dengan DOM palsu (BUKAN browser sungguhan —
// memeriksa logika render/handler, bukan tampilan). Jalankan: node --test anchor-ui.smoke.test.mjs
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

// Katalog palsu di sisi DB: anchor K1 (SC) punya varian K2/K3 (firm, brand diminta); K4 brand lain TIDAK ikut karena DB yang menyaring.
// L1 (Laparatomy) punya satu varian L2. Level 3 menambah barang sejenis X9.
const DB = {
  K1: [['K1', true, 'SECTIO CAESAREAN S.', 'standar', null, ['keluarga']], ['K2', false, 'BASIC SECTIO CAESAREAN S. 1', 'basic', 1, ['keluarga', 'prosedur']], ['K3', false, 'BASIC SECTIO CAESAREAN S. 2', 'basic', 2, ['keluarga', 'prosedur']]],
  L1: [['L1', true, 'BASIC LAPAROTOMY S. 3', 'basic', 3, ['keluarga']], ['L2', false, 'LAPAROTOMY S.', 'standar', null, ['keluarga', 'prosedur']]]
};
const rpcCalls = [];
const rpc = async (fn, a) => {
  rpcCalls.push([fn, a]);
  if (fn === 'auto_konversi_tawarkan_hitung') return { data: a.p_kodes.map((k) => ({ kode_produk: k, n: (DB[k] || []).length - 1 })), error: null };
  if (fn === 'auto_konversi_tawarkan') {
    const rows = (DB[a.p_kode] || []).map(([kode_produk, anchor, nama_produk, tier, nomor, sinyal]) => ({ kode_produk, anchor, nama_produk, tier, nomor, sinyal, ditawarkan: true, alasan_tolak: null }));
    if (a.p_level === 3) rows.push({ kode_produk: 'X9', anchor: false, nama_produk: 'ALAT SEJENIS', tier: 'standar', nomor: null, sinyal: ['kategori'], ditawarkan: true, alasan_tolak: null });
    return { data: rows, error: null };
  }
  return { data: null, error: { message: 'rpc tak dikenal ' + fn } };
};

const kbList = { innerHTML: '', handlers: {}, addEventListener(t, f) { (this.handlers[t] ||= []).push(f); }, querySelector: () => null, querySelectorAll: () => [], contains: () => false };
const toasts = [];
const store = {
  checklistItems: [], checklistSections: [], activeSectionTab: null, checklistNamaRs: 'RS X', checklistPagu: null,
  clipboard: [{ kode_produk: 'K1', produk_id: 1 }], dictSuggestionCache: {}, kbList, selectedBrand: 'ROBUST', modeSwastaOutput: true,
  SUPABASE_URL: 'http://x', ANON_KEY: 'k', getFreshToken: async () => 't', rupiah: (n) => 'Rp ' + n, qtyButuh: (n) => n || 1,
  showToast: (m, k, o) => toasts.push(m), sesiFetch: async () => ({ ok: true, status: 200, json: async () => [] }), rpc,
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

test('UI anchor: chip dari RPC batch, panel, badge sinyal, centang, pasang, undo, terpakai-item-lain, sejenis', async () => {
  store.checklistItems = [
    { id: 1, raw_text: 'Sectio caesarian set', qty_diminta: 2, status: 'TERPENUHI', matched_items: [{ produk_id: 1, kode_produk: 'K1', qty_alokasi: 2 }] },
    { id: 2, raw_text: 'Laparatomy set', qty_diminta: 1, status: 'TERPENUHI', matched_items: [{ produk_id: null, kode_produk: 'L1', qty_alokasi: 1 }] }
  ];
  S.renderChecklist();
  ok(!/anchor-open/.test(kbList.innerHTML), 'sebelum angka datang: belum ada chip (tidak crash)');
  await sleep(50);
  S.renderChecklist();
  const hit = rpcCalls.filter(([f]) => f === 'auto_konversi_tawarkan_hitung');
  ok(hit.length === 1 && hit[0][1].p_kodes.join() === 'K1,L1' && hit[0][1].p_brand === 'ROBUST', 'satu RPC batch untuk semua anchor, brand ROBUST');
  ok(/\+2 set lain/.test(kbList.innerHTML), 'chip item Sectio: +2 set lain (K2,K3) — sama dengan baris non-anchor');
  ok(/\+1 set lain/.test(kbList.innerHTML), 'chip item Laparatomy: +1 set lain (L2)');

  store.checklistExpandedId = 1;
  await click('anchor-open', 1);
  await sleep(30);
  let h = kbList.innerHTML;
  ok(/data-anchor-check="1" data-kode="K2" checked/.test(h) && /data-kode="K3" checked/.test(h), 'panel terbuka: K2,K3 tercentang default');
  ok(!/data-kode="K4"/.test(h), 'brand lain tidak muncul sama sekali (disaring DB)');
  ok(/pilihanmu/.test(h) && /Pasang 3 opsi/.test(h), 'anchor K1 ditandai pilihanmu; tombol "Pasang 3 opsi"');
  ok(/data-sinyal="prosedur"/.test(h) && /Prosedur sama/.test(h), 'sinyal tampil sebagai badge');

  for (const f of kbList.handlers.change) f({ target: { closest: (sel) => (sel === 'input[data-anchor-check]' ? { dataset: { anchorCheck: '1', kode: 'K3' }, checked: false } : null) } });
  S.renderChecklist();
  ok(/Pasang 2 opsi/.test(kbList.innerHTML) && !/data-kode="K3" checked/.test(kbList.innerHTML), 'centang tersimpan di state dan bertahan saat render ulang');

  await click('anchor-sejenis', 1);
  await sleep(30);
  h = kbList.innerHTML;
  ok(rpcCalls.some(([f, a]) => f === 'auto_konversi_tawarkan' && a.p_level === 3), 'tampilkan sejenis: RPC dipanggil ulang dengan p_level 3');
  ok(/data-kode="X9"/.test(h) && !/data-kode="X9" checked/.test(h), 'barang sejenis muncul tapi tidak tercentang');
  ok(/Pasang 2 opsi/.test(h) && !/data-kode="K3" checked/.test(h), 'centang staf dipertahankan setelah naik level');

  await click('anchor-apply', 1);
  const it = store.checklistItems[0];
  ok(it.matched_items.map((l) => l.kode_produk).join() === 'K1,K2', 'apply: K1+K2 terpasang → ' + it.matched_items.map((l) => l.kode_produk));
  ok(it.matched_items.every((l) => l.qty_alokasi === 2), 'tiap opsi @ qty diminta (2)');
  ok(store.clipboard.some((c) => c.kode_produk === 'K2') && !store.clipboard.some((c) => c.kode_produk === 'K3'), 'K2 ditambah ke Clipboard, K3 tidak');
  ok(fetchCalls.some(([u]) => u.includes('update_permintaan_item_multi')), 'ditulis lewat RPC update_permintaan_item_multi');

  store.checklistExpandedId = 1; S.renderChecklist();
  ok(/anchor-undo/.test(kbList.innerHTML) && !/anchor-open/.test(kbList.innerHTML.split('data-id="2"')[0]), 'sesudah apply: ada "Kembalikan ke 1 produk", tidak ada tawaran ganda');
  await click('anchor-undo', 1);
  ok(it.matched_items.length === 1 && it.matched_items[0].kode_produk === 'K1', 'undo: kembali ke 1 produk (anchor K1)');

  // item lain memakai K2 → K2 tetap tampil tapi tidak tercentang, dengan alasan
  store.checklistItems.push({ id: 3, raw_text: 'sc basic', status: 'TERPENUHI', matched_items: [{ kode_produk: 'K2' }] });
  store.checklistExpandedId = 1;
  await click('anchor-open', 1);
  await sleep(30);
  h = kbList.innerHTML;
  ok(/data-kode="K2"/.test(h) && !/data-kode="K2" checked/.test(h) && /Sudah dipakai di kebutuhan lain/.test(h), 'K2 dipakai item lain: tampil, tidak tercentang, ada alasan');
});
