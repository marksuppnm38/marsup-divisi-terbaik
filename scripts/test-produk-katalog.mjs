// Tes kontrak produk-katalog.js (tanpa DOM, tanpa jaringan): `npm run test:katalog`
// Fokus: bug "Produk tidak bisa dimuat ke Clipboard" — produk yang dimuat dari katalog (BUKAN dari hasil pencarian)
// harus bisa dipasang ke Clipboard, dan tiap alasan gagal harus kembali sebagai data (tanpa toast).
import test from 'node:test';
import assert from 'node:assert/strict';
import { installProdukKatalog } from '../app/pages/konversian/produk-katalog.js';

function buatS(katalog = {}) {
  const S = {
    lastResults: [], produkLookup: new Map(), clipboard: [],
    modeSwasta: false, modeSwastaOutput: false,
    isProdukFirm: (r) => !r.catatan,
    rpcCalls: 0, rpcError: null,
    async findProdukByKodeExact(kode) {
      S.rpcCalls++;
      await new Promise(r => setTimeout(r, 1));
      if (S.rpcError) return { produk: null, errMsg: S.rpcError };
      const hit = Object.values(katalog).find(p => p.kode_produk.toLowerCase() === kode.toLowerCase());
      return { produk: hit ? { ...hit } : null, errMsg: null };
    },
    async enrichResultsWithStok(rows) { rows.forEach(r => { r.stok_status = 'READY'; r.stok_qty = 5; }); },
    // Tiruan kontrak S.tambahProdukKeClip milik clipboard.js (urutan: dup → aturan tolak → tambah)
    tambahProdukKeClip(r, opts) {
      if (S.clipboard.some(c => c.kode_produk === r.kode_produk)) return opts && opts.noToggle ? 'dup' : 'removed';
      const tolak = S.alasanTolakProduk(r);
      if (tolak) return tolak;
      S.clipboard.push({ kode_produk: r.kode_produk, stok_status: r.stok_status });
      return 'added';
    }
  };
  installProdukKatalog(S);
  return S;
}
const P = (kode, extra) => ({ kode_produk: kode, nama_produk: kode, ...extra });

test('REGRESI: produk dari katalog (tidak ada di lastResults) bisa dipasang', async () => {
  const S = buatS({ a: P('RB-1') });
  const h = await S.pasangKeClipboard('RB-1');
  assert.deepEqual([h.ok, h.status, h.kode], [true, 'added', 'RB-1']);
  assert.equal(S.clipboard.length, 1);
  assert.equal(S.lastResults.length, 0, 'tidak boleh menyelip ke panel Cari Produk');
});

test('stok ikut terisi untuk produk yang dimuat dari katalog', async () => {
  const S = buatS({ a: P('RB-1') });
  await S.pasangKeClipboard('RB-1');
  assert.equal(S.clipboard[0].stok_status, 'READY');
});

test('kode sudah dimuat tidak menembak RPC lagi; memasang dua kali = sukses (dup), tidak dikeluarkan', async () => {
  const S = buatS({ a: P('RB-1') });
  await S.pasangKeClipboard('RB-1');
  const h2 = await S.pasangKeClipboard('RB-1');
  assert.equal(h2.ok, true); assert.equal(h2.status, 'dup');
  assert.equal(S.clipboard.length, 1); assert.equal(S.rpcCalls, 1);
});

test('huruf besar/kecil kode tidak bikin gagal; kunci cache = kode kanonik', async () => {
  const S = buatS({ a: P('RB-1') });
  const h = await S.pasangKeClipboard('rb-1');
  assert.equal(h.ok, true); assert.equal(h.kode, 'RB-1');
  assert.ok(S.getProduk('RB-1'));
});

test('produk yang sedang tampil di hasil pencarian dipakai dulu (tanpa RPC)', async () => {
  const S = buatS();
  S.lastResults = [P('RB-9', { stok_status: 'INDENT' })];
  const h = await S.pasangKeClipboard('RB-9');
  assert.equal(h.ok, true); assert.equal(S.rpcCalls, 0);
});

test('kode yang sama dimuat bersamaan = satu RPC', async () => {
  const S = buatS({ a: P('RB-1') });
  await Promise.all([S.pasangKeClipboard('RB-1'), S.pasangKeClipboard('RB-1'), S.muatProduk('RB-1')]);
  assert.equal(S.rpcCalls, 1); assert.equal(S.clipboard.length, 1);
});

test('alasan gagal kembali sebagai data: tidak_ditemukan, galat, firm, stok', async () => {
  const S = buatS({ a: P('RB-F', { catatan: 'x' }) });
  assert.equal((await S.pasangKeClipboard('NOPE')).status, 'tidak_ditemukan');
  S.rpcError = 'timeout';
  const g = await S.pasangKeClipboard('RB-1');
  assert.deepEqual([g.ok, g.status, g.detail], [false, 'galat', 'timeout']);
  S.rpcError = null;
  assert.equal((await S.pasangKeClipboard('RB-F')).status, 'firm');
  S.lastResults = [P('RB-S', { stok_pending: true })];
  assert.equal((await S.pasangKeClipboard('RB-S')).status, 'stok');
  assert.equal(S.clipboard.length, 0);
});

test('mode Swasta (panel cari ATAU output) melonggarkan aturan firm di semua jalur', async () => {
  for (const flag of ['modeSwasta', 'modeSwastaOutput']) {
    const S = buatS({ a: P('RB-F', { catatan: 'x' }) });
    S[flag] = true;
    assert.equal((await S.pasangKeClipboard('RB-F')).ok, true, flag);
  }
});

test('pasangBanyak: berurutan, yang gagal tidak menghentikan yang lain', async () => {
  const S = buatS({ a: P('RB-1'), b: P('RB-2'), c: P('RB-F', { catatan: 'x' }) });
  const { ok, gagal } = await S.pasangBanyakKeClipboard(['RB-1', 'RB-F', 'NOPE', 'RB-2']);
  assert.deepEqual(ok, ['RB-1', 'RB-2']);
  assert.deepEqual(gagal.map(g => g.status), ['firm', 'tidak_ditemukan']);
});

test('ringkasGagalClip: satu = rinci, banyak = dikelompokkan', () => {
  const S = buatS();
  assert.equal(S.ringkasGagalClip([]), '');
  assert.match(S.ringkasGagalClip([{ status: 'firm', kode: 'RB-1' }]), /^RB-1: belum firm/);
  const r = S.ringkasGagalClip([{ status: 'firm' }, { status: 'firm' }, { status: 'tidak_ditemukan' }]);
  assert.match(r, /2× belum firm/); assert.match(r, /1× tidak ada di katalog/);
});
