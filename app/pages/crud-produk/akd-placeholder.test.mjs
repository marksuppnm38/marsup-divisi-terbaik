// Jalankan: node --test app/pages/crud-produk/akd-placeholder.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { hanyaPlaceholder, tanpaAkdAsli, muatHanyaPlaceholder } from './akd-placeholder.js';

const link = (produk_id, no_akd) => ({ produk_id, akd: { no_akd } });

test('hanyaPlaceholder: kandidat tanpa AKD asli saja; yang punya AKD asli dikeluarkan', () => {
  const links = [link(1, 'TIDAK ADA'), link(2, 'TIDAK ADA'), link(2, 'AKL 123'), link(3, ' tidak ada ')];
  assert.deepEqual([...hanyaPlaceholder(new Set([1, 2, 3]), links)].sort(), [1, 3]);
});

test('hanyaPlaceholder: relasi tanpa nomor / tanpa akd diabaikan, input kosong aman', () => {
  assert.deepEqual([...hanyaPlaceholder(new Set([1]), [{ produk_id: 1, akd: null }, { produk_id: 1 }])], [1]);
  assert.equal(hanyaPlaceholder(new Set(), null).size, 0);
});

test('tanpaAkdAsli: bukan terhubung = tanpa AKD; terhubung hanya placeholder = tanpa AKD; terhubung asli = punya', () => {
  const ph = new Set(['p']);
  assert.equal(tanpaAkdAsli({ id: 'a', status_akd: null }, ph), true);
  assert.equal(tanpaAkdAsli({ id: 'a', status_akd: 'di_luar_cakupan' }, ph), true);
  assert.equal(tanpaAkdAsli({ id: 'p', status_akd: 'terhubung' }, ph), true);
  assert.equal(tanpaAkdAsli({ id: 'q', status_akd: 'terhubung' }, ph), false);
  assert.equal(tanpaAkdAsli({ id: 'q', status_akd: 'terhubung' }, null), false); // himpunan belum dimuat: perilaku lama
});

// Supabase tiruan: tiap tabel punya fungsi yang membalas sesuai rantai.
function fakeSb(handlers) {
  return {
    from(t) {
      const ctx = { t, calls: [] };
      const chain = new Proxy({}, {
        get(_, m) {
          if (m === 'then') return undefined;
          return (...a) => {
            ctx.calls.push([m, ...a]);
            if (m === 'range' || (m === 'in' && t === 'produk_akd' && ctx.calls.some((c) => c[0] === 'select' && /akd:akd_id/.test(c[1])))) {
              return Promise.resolve(handlers[t](ctx));
            }
            if (m === 'ilike') return Promise.resolve(handlers[t](ctx));
            return chain;
          };
        },
      });
      return chain;
    },
  };
}

test('muatHanyaPlaceholder: alur 3 langkah menghasilkan id yang hanya tertaut placeholder', async () => {
  const sb = fakeSb({
    akd: () => ({ data: [{ id: 'ph', no_akd: 'TIDAK ADA' }, { id: 'x', no_akd: 'TIDAK ADA TAMBAHAN' }], error: null }),
    produk_akd: (ctx) => ctx.calls.some((c) => c[0] === 'range')
      ? { data: [{ produk_id: 1 }, { produk_id: 2 }], error: null }
      : { data: [link(1, 'TIDAK ADA'), link(2, 'TIDAK ADA'), link(2, 'AKL 9')], error: null },
  });
  const r = await muatHanyaPlaceholder(sb);
  assert.equal(r.error, null);
  assert.deepEqual([...r.ids], [1]);
});

test('muatHanyaPlaceholder: tidak ada record placeholder -> himpunan kosong; error query -> { error } tanpa throw', async () => {
  const kosong = await muatHanyaPlaceholder(fakeSb({ akd: () => ({ data: [], error: null }) }));
  assert.equal(kosong.ids.size, 0); assert.equal(kosong.error, null);
  const gagal = await muatHanyaPlaceholder(fakeSb({ akd: () => ({ data: null, error: new Error('boom') }) }));
  assert.equal(gagal.ids.size, 0); assert.ok(gagal.error);
});
