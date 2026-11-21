// Jalankan: node --test app/pages/crud-produk/atribut.test.mjs
// Koreksi manual atribut produk: pemuatan cache, normalisasi patch, simpan lewat RPC, dan kegagalan yang tidak boleh melempar.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  muatManual, manualOf, manualMap, manualTerisi, resetManual, simpanManual, rapikanPatch, normKeluarga,
  belumTerpasang, pesanAtribut, SPES_TANPA, TABEL, RPC_SET,
} from './atribut.js';

// Supabase tiruan: tabel koreksi (paging via range) + rpc yang mencatat argumennya dan memodifikasi tabel seperti RPC sungguhan.
function fakeSb(initial = [], { loadError = null, rpcError = null, rpcData = { diubah: 1, keluarga_dilewati: 0 } } = {}) {
  const rows = initial.map((r) => ({ ...r }));
  const calls = [];
  return {
    rows, calls,
    from(name) {
      const q = { name, range: null };
      calls.push(['from', name]);
      const chain = {
        select() { return chain; }, order() { return chain; },
        range(a, b) { q.range = [a, b]; return chain; },
        then(res, rej) {
          if (loadError) return Promise.resolve({ data: null, error: loadError }).then(res, rej);
          const r = q.range ? rows.slice(q.range[0], q.range[1] + 1) : rows;
          return Promise.resolve({ data: r, error: null }).then(res, rej);
        },
      };
      return chain;
    },
    async rpc(name, args) {
      calls.push(['rpc', name, args]);
      if (rpcError) return { data: null, error: rpcError };
      args.p_ids.forEach((id) => {
        let r = rows.find((x) => x.produk_id === id);
        if (!r) { r = { produk_id: id, keluarga: null, kategori: null, spes: null }; rows.push(r); }
        Object.keys(args.p_patch).forEach((k) => { r[k] = args.p_patch[k]; });
      });
      return { data: rpcData, error: null };
    },
  };
}

test('normKeluarga: spasi dirapikan, huruf besar, kosong -> null', () => {
  assert.equal(normKeluarga('  mayor   s. '), 'MAYOR S.');
  assert.equal(normKeluarga(''), null);
  assert.equal(normKeluarga('   '), null);
  assert.equal(normKeluarga(null), null);
});

test('rapikanPatch: hanya kunci dikenal; kosong -> null (kembali ke otomatis); kunci yang tidak ada tetap tidak ada', () => {
  assert.deepEqual(rapikanPatch({ keluarga: ' mayor  s ', kategori: 'set', spes: 'obgyn', liar: 'x' }), { keluarga: 'MAYOR S', kategori: 'SET', spes: 'OBGYN' });
  assert.deepEqual(rapikanPatch({ spes: '' }), { spes: null });
  assert.deepEqual(rapikanPatch({ kategori: null }), { kategori: null });
  assert.deepEqual(rapikanPatch({}), {});
  assert.deepEqual(rapikanPatch(null), {});
  assert.equal('keluarga' in rapikanPatch({ spes: 'THT' }), false);
});

test('muatManual: memuat semua baris (paging) dan menyimpan di cache; panggilan kedua tidak query lagi', async () => {
  resetManual();
  assert.equal(manualTerisi(), false);
  const data = Array.from({ length: 1500 }, (_, i) => ({ produk_id: i + 1, keluarga: i === 0 ? 'MAYOR S' : null, kategori: null, spes: i === 1 ? SPES_TANPA : null }));
  const sb = fakeSb(data);
  const r = await muatManual(sb);
  assert.equal(r.ok, true);
  assert.equal(manualMap().size, 1500);
  assert.deepEqual(manualOf(1), { keluarga: 'MAYOR S', kategori: null, spes: null });
  assert.equal(manualOf(2).spes, SPES_TANPA);
  assert.equal(manualOf(99999), undefined);
  assert.equal(sb.calls.filter((c) => c[0] === 'from').length, 2); // 1000 + 500
  await muatManual(sb);
  assert.equal(sb.calls.filter((c) => c[0] === 'from').length, 2); // dari cache
  await muatManual(sb, { force: true });
  assert.equal(sb.calls.filter((c) => c[0] === 'from').length, 4); // force = muat ulang
  resetManual();
});

test('muatManual: tabel belum ada -> ok:false + belumTerpasang, TIDAK throw, cache lama tidak terhapus', async () => {
  resetManual();
  await muatManual(fakeSb([{ produk_id: 5, keluarga: 'A', kategori: null, spes: null }]));
  const r = await muatManual(fakeSb([], { loadError: { code: 'PGRST205', message: 'Could not find the table' } }), { force: true });
  assert.equal(r.ok, false);
  assert.equal(r.belumTerpasang, true);
  assert.equal(manualOf(5).keluarga, 'A');
  assert.match(pesanAtribut(r.error), /2026-11-21_atribut_produk_manual\.sql/);
  resetManual();
});

test('manualMap kosong dan aman dibaca sebelum dimuat', () => {
  resetManual();
  assert.equal(manualMap().size, 0);
  assert.equal(manualOf(1), undefined);
});

test('simpanManual: kirim ids unik + patch yang dirapikan ke RPC, lalu cache dimuat ulang', async () => {
  resetManual();
  const sb = fakeSb();
  const r = await simpanManual(sb, [3, 3, 4, null], { keluarga: ' mayor  s ', spes: 'obgyn' });
  assert.equal(r.ok, true);
  const rpc = sb.calls.find((c) => c[0] === 'rpc');
  assert.equal(rpc[1], RPC_SET);
  assert.deepEqual(rpc[2], { p_ids: [3, 4], p_patch: { keluarga: 'MAYOR S', spes: 'OBGYN' } });
  assert.deepEqual(manualOf(3), { keluarga: 'MAYOR S', kategori: null, spes: 'OBGYN' }); // cache sudah dimuat ulang
  assert.deepEqual(r.hasil, { diubah: 1, keluarga_dilewati: 0 });
  assert.equal(sb.calls.filter((c) => c[0] === 'from').length, 1);
  resetManual();
});

test('simpanManual: kembalikan ke otomatis = kirim null, bukan string kosong', async () => {
  resetManual();
  const sb = fakeSb([{ produk_id: 7, keluarga: 'X', kategori: 'SET', spes: null }]);
  await simpanManual(sb, [7], { kategori: '' });
  assert.deepEqual(sb.calls.find((c) => c[0] === 'rpc')[2].p_patch, { kategori: null });
  resetManual();
});

test('simpanManual: laporan keluarga_dilewati diteruskan (produk non-SET)', async () => {
  resetManual();
  const r = await simpanManual(fakeSb([], { rpcData: { diubah: 3, keluarga_dilewati: 2 } }), [1, 2, 3], { keluarga: 'A' });
  assert.deepEqual(r.hasil, { diubah: 3, keluarga_dilewati: 2 });
  resetManual();
});

test('simpanManual: input tidak valid ditolak TANPA memanggil database', async () => {
  const sb = fakeSb();
  assert.equal((await simpanManual(sb, [], { kategori: 'SET' })).ok, false);
  assert.equal((await simpanManual(sb, [1], {})).ok, false);
  assert.equal((await simpanManual(sb, Array.from({ length: 2001 }, (_, i) => i + 1), { kategori: 'SET' })).ok, false);
  assert.equal(sb.calls.length, 0);
});

test('simpanManual: error RPC dikembalikan, tidak throw, cache tidak diubah', async () => {
  resetManual();
  await muatManual(fakeSb([{ produk_id: 1, keluarga: 'A', kategori: null, spes: null }]));
  const r = await simpanManual(fakeSb([], { rpcError: { code: '28000', message: 'Perlu login' } }), [1], { keluarga: 'B' });
  assert.equal(r.ok, false);
  assert.match(pesanAtribut(r.error), /login/i);
  assert.equal(manualOf(1).keluarga, 'A');
  resetManual();
});

test('belumTerpasang mengenali tabel dan fungsi yang belum ada', () => {
  assert.equal(belumTerpasang({ code: 'PGRST205' }), true);
  assert.equal(belumTerpasang({ code: 'PGRST202' }), true);
  assert.equal(belumTerpasang({ code: '42P01' }), true);
  assert.equal(belumTerpasang({ message: 'relation "produk_atribut_manual" does not exist' }), true);
  assert.equal(belumTerpasang({ code: '23505', message: 'duplicate' }), false);
  assert.equal(belumTerpasang(null), false);
  assert.equal(TABEL, 'produk_atribut_manual');
});
