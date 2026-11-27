// Tes fase 3 Pengaturan: Riwayat Perubahan global + kolom "Terakhir diubah" + sub-route admin.
// Menjalankan KODE ASLI: app/pages/pengaturan/{audit,table,markup}.js dan app/pages/nav/perm-view.js.
// Jalankan: node --test scripts/test-riwayat-izin.mjs
//
// Zona waktu dikunci ke WIB SEBELUM Date apa pun dipakai: batas hari lokal adalah inti bug yang dijaga di sini.
process.env.TZ = 'Asia/Jakarta';

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const ROOT = new URL('../', import.meta.url);
const read = (rel) => fs.readFileSync(new URL(rel, ROOT), 'utf8');
const mod = (rel) => import(new URL(rel, ROOT).href);

const audit = await mod('app/pages/pengaturan/audit.js');
const { localDayStart, waktuBounds, localStamp, applyAuditQuery, fetchAuditPage, fetchTerakhir, toTerakhirMap, waktuPresets, KOLOM_OPTIONS, AUDIT_PAGE_SIZE } = audit;

// ── Sub-route admin ──────────────────────────────────────────────────────────────────────────

async function loginAs(row) {
  const sb = { from() { const q = { select() { return q; }, eq() { return q; }, maybeSingle: async () => ({ data: row, error: null }) }; return q; } };
  const win = { pnmSupabase: sb, console }; win.window = win;
  vm.runInNewContext(read('shared/auth-session.js'), win);
  await win.PNMAuth.loadPerms('x@x');
  globalThis.window = win;
}
const perm = await mod('app/pages/nav/perm-view.js');
const person = (admin) => ({ role: admin ? 'developer' : 'staff', is_superuser: admin, boleh_hapus: false, boleh_hapus_sesi: false, modul_tersembunyi: [] });

test('ADMIN_SUBNAV tidak bocor ke pohon izin: knownPermIds / canonHidden tidak mengenal id pengaturan', () => {
  const known = [...perm.knownPermIds()];
  assert.equal(known.some((id) => id === 'pengaturan' || id.startsWith('pengaturan/')), false);
  // id pengaturan tidak ikut bentuk baku: tidak ada yang bisa "menyembunyikan" Riwayat lewat modul_tersembunyi
  assert.deepEqual(perm.canonHidden(['pengaturan/riwayat', 'pengaturan']), ['pengaturan', 'pengaturan/riwayat']);
  assert.equal(Object.keys(perm.SUBNAV).includes('pengaturan'), false);
});

test('Pengaturan: submodul tampil untuk admin saja; non-admin tidak mendapat menu maupun akses', async () => {
  await loginAs(person(true));
  assert.deepEqual(perm.visibleSubs('pengaturan').map((s) => s.id), ['user-management', 'riwayat']);
  assert.equal(perm.firstAllowedSub('pengaturan'), 'user-management');
  assert.equal(perm.isModuleAllowed('pengaturan', 'riwayat'), true);
  assert.ok(perm.navPermSignature().includes('pengaturan[user-management+riwayat]'));

  await loginAs(person(false));
  assert.equal(perm.visibleSubs('pengaturan'), null);
  assert.equal(perm.isModuleAllowed('pengaturan', 'riwayat'), false);
  assert.equal(perm.isModuleAllowed('pengaturan'), false);
});

test('router: sub-route pengaturan terdaftar dari ADMIN_SUBNAV (satu sumber), bukan salinan', () => {
  const src = read('app/router.js');
  assert.match(src, /'pengaturan': ADMIN_SUBNAV\.pengaturan\.map\(\(s\) => s\.id\)/);
});

// ── Batas hari lokal ─────────────────────────────────────────────────────────────────────────

test('localDayStart: tengah malam WIB = 17:00 UTC hari sebelumnya; input rusak -> null', () => {
  assert.equal(localDayStart('2026-11-26'), '2026-11-25T17:00:00.000Z');
  assert.equal(localDayStart('2026-12-01'), '2026-11-30T17:00:00.000Z');
  assert.equal(localDayStart('26-11-2026'), null);
  assert.equal(localDayStart(''), null);
  assert.equal(localDayStart(undefined), null);
});

test('waktuBounds: "sampai 26 Nov" mencakup SELURUH tanggal 26 (batas atas = awal tanggal 27), bukan 00:00 tanggal 26', () => {
  assert.deepEqual(waktuBounds({ op: 'sampai', value: '2026-11-26' }), { gte: null, lt: '2026-11-26T17:00:00.000Z' });
  // perubahan 26 Nov 23:30 WIB (= 16:30 UTC) harus masuk, 27 Nov 00:00 WIB (= 17:00 UTC) harus keluar
  const b = waktuBounds({ op: 'sampai', value: '2026-11-26' });
  assert.ok('2026-11-26T16:30:00.000Z' < b.lt);
  assert.ok(!('2026-11-26T17:00:00.000Z' < b.lt));
});

test('waktuBounds: "dari" memakai awal hari lokal (dini hari WIB tidak ikut hari sebelumnya); antara; batas bulan', () => {
  assert.deepEqual(waktuBounds({ op: 'dari', value: '2026-11-26' }), { gte: '2026-11-25T17:00:00.000Z', lt: null });
  assert.deepEqual(waktuBounds({ op: 'antara', value: { from: '2026-11-20', to: '2026-11-30' } }), { gte: '2026-11-19T17:00:00.000Z', lt: '2026-11-30T17:00:00.000Z' });
  assert.equal(waktuBounds({ op: 'sampai', value: '2026-12-31' }).lt, '2026-12-31T17:00:00.000Z'); // 1 Jan 2027 WIB
});

test('waktuBounds: op yang tidak dijangkau menu kolom ini, filter kosong, atau tanggal rusak -> tanpa batas', () => {
  const none = { gte: null, lt: null };
  assert.deepEqual(waktuBounds(null), none);
  assert.deepEqual(waktuBounds({ op: 'within', value: 7 }), none);
  assert.deepEqual(waktuBounds({ op: 'dari', value: 'bukan-tanggal' }), none);
  assert.deepEqual(waktuBounds({ op: 'antara', value: null }), none);
});

test('localStamp: tanggal ikut zona browser (dini hari WIB tidak mundur sehari); urutan leksikografis = urutan waktu', () => {
  assert.equal(localStamp('2026-11-25T19:00:00Z'), '2026-11-26T02:00:00');
  assert.equal(localStamp('nonsense'), null);
  assert.equal(localStamp(null), null);
  assert.ok(localStamp('2026-11-26T01:00:00Z') < localStamp('2026-11-26T09:00:00Z'));
});

test('waktuPresets: Hari ini / 7 / 30 hari terakhir dihitung dari tanggal yang diberikan', () => {
  const p = waktuPresets('2026-11-26');
  assert.deepEqual(p.map((x) => x.filter), [
    { op: 'dari', value: '2026-11-26' },
    { op: 'dari', value: '2026-11-20' },
    { op: 'dari', value: '2026-10-28' },
  ]);
});

// ── Query ────────────────────────────────────────────────────────────────────────────────────

const COLS = [
  { key: 'waktu', type: 'date' }, { key: 'oleh', type: 'text' }, { key: 'email_target', type: 'text' },
  { key: 'kolom', type: 'enum' }, { key: 'perubahan', sortable: false, filterable: false },
];
function recorder() {
  const calls = [];
  const q = new Proxy({}, { get: (_, name) => (...args) => { calls.push([name, ...args]); return q; } });
  return { q, calls };
}
const orders = (calls) => calls.filter((c) => c[0] === 'order').map((c) => `${c[1]}${c[2].ascending ? ' asc' : ' desc'}`);

test('applyAuditQuery: filter waktu jadi gte/lt batas lokal (BUKAN lte tanggal polos); filter lain lewat jalur bersama', () => {
  const { q, calls } = recorder();
  applyAuditQuery(q, {
    sort: { key: 'waktu', dir: 'desc' },
    filters: [
      { key: 'waktu', op: 'antara', value: { from: '2026-11-20', to: '2026-11-26' } },
      { key: 'email_target', op: 'contains', value: 'hannan' },
      { key: 'kolom', op: 'in', value: ['boleh_hapus', 'modul_tersembunyi'] },
    ],
  }, COLS);
  assert.deepEqual(calls.find((c) => c[0] === 'gte'), ['gte', 'waktu', '2026-11-19T17:00:00.000Z']);
  assert.deepEqual(calls.find((c) => c[0] === 'lt'), ['lt', 'waktu', '2026-11-26T17:00:00.000Z']);
  assert.equal(calls.some((c) => c[0] === 'lte'), false);
  assert.deepEqual(calls.find((c) => c[0] === 'ilike'), ['ilike', 'email_target', '%hannan%']);
  assert.deepEqual(calls.find((c) => c[0] === 'in'), ['in', 'kolom', ['boleh_hapus', 'modul_tersembunyi']]);
});

test('applyAuditQuery: urutan bawaan waktu menurun + pembeda tetap (baris satu UPDATE berbagi waktu yang sama)', () => {
  const { q, calls } = recorder();
  applyAuditQuery(q, { sort: { key: 'waktu', dir: 'desc' }, filters: [] }, COLS);
  assert.deepEqual(orders(calls), ['waktu desc', 'email_target asc', 'kolom asc', 'nilai_baru asc']);
});

test('applyAuditQuery: urut menurut kolom lain -> kolom itu dulu, lalu waktu terbaru, tanpa order ganda untuk kolom yang sama', () => {
  const a = recorder();
  applyAuditQuery(a.q, { sort: { key: 'oleh', dir: 'asc' }, filters: [] }, COLS);
  assert.deepEqual(orders(a.calls), ['oleh asc', 'waktu desc', 'email_target asc', 'kolom asc', 'nilai_baru asc']);

  const b = recorder();
  applyAuditQuery(b.q, { sort: { key: 'kolom', dir: 'desc' }, filters: [] }, COLS);
  const o = orders(b.calls);
  assert.equal(o[0], 'kolom desc');
  assert.equal(o.filter((x) => x.startsWith('kolom')).length, 1);

  const c = recorder(); // sort dihapus pengguna -> tetap deterministik, terbaru di atas
  applyAuditQuery(c.q, { sort: null, filters: [] }, COLS);
  assert.equal(orders(c.calls)[0], 'waktu desc');
});

// ── Fetch ────────────────────────────────────────────────────────────────────────────────────

function fakeClient(result) {
  const seen = { table: null, select: null, range: null };
  const q = new Proxy({}, {
    get: (_, name) => (...args) => {
      if (name === 'select') seen.select = args;
      if (name === 'range') { seen.range = args; return Promise.resolve(typeof result === 'function' ? result() : result); }
      return q;
    },
  });
  return { seen, client: { from(t) { seen.table = t; return q; } } };
}

test('fetchAuditPage: halaman 3 = range(60, 89); total dari count; hanya membaca izin_audit', async () => {
  const { client, seen } = fakeClient({ data: [{ waktu: 'x' }], error: null, count: 212 });
  const r = await fetchAuditPage(client, { state: { sort: null, filters: [] }, columns: COLS, page: 3 });
  assert.equal(seen.table, 'izin_audit');
  assert.deepEqual(seen.range, [60, 60 + AUDIT_PAGE_SIZE - 1]);
  assert.deepEqual(seen.select[1], { count: 'exact' });
  assert.equal(r.total, 212);
  assert.equal(r.rows.length, 1);
  assert.equal(r.error, null);
});

test('fetchAuditPage: error supabase maupun exception dikembalikan sebagai error, bukan dilempar', async () => {
  const a = fakeClient({ data: null, error: { code: '42P01', message: 'relation "izin_audit" does not exist' }, count: null });
  const ra = await fetchAuditPage(a.client, { state: { filters: [] }, columns: COLS });
  assert.equal(ra.error.code, '42P01');
  assert.deepEqual(ra.rows, []);

  const b = fakeClient(() => { throw new Error('jaringan putus'); });
  const rb = await fetchAuditPage(b.client, { state: { filters: [] }, columns: COLS });
  assert.match(rb.error.message, /jaringan putus/);
});

test('toTerakhirMap: email huruf kecil, terbaru menang, baris rusak dilewati', () => {
  const m = toTerakhirMap([
    { email_target: 'Hannan@X.com', terakhir: '2026-11-20T01:00:00Z' },
    { email_target: 'hannan@x.com', terakhir: '2026-11-25T01:00:00Z' },
    { email_target: 'hannan@x.com', terakhir: '2026-11-22T01:00:00Z' },
    { email_target: '', terakhir: '2026-11-25T01:00:00Z' },
    { email_target: 'rusak@x.com', terakhir: 'bukan-waktu' },
    null,
  ]);
  assert.deepEqual([...m.keys()], ['hannan@x.com']);
  assert.equal(m.get('hannan@x.com'), '2026-11-25T01:00:00Z');
});

test('fetchTerakhir: view belum ada / error / exception -> null (kolom disembunyikan, bukan diisi "—")', async () => {
  const sel = (r) => ({ from() { return { select: () => (typeof r === 'function' ? r() : Promise.resolve(r)) }; } });
  assert.equal(await fetchTerakhir(sel({ data: null, error: { code: '42P01' } })), null);
  assert.equal(await fetchTerakhir(sel(() => { throw new Error('x'); })), null);
  assert.equal(await fetchTerakhir(sel({ data: 'bukan-array', error: null })), null);
  const ok = await fetchTerakhir(sel({ data: [{ email_target: 'A@x.com', terakhir: '2026-11-25T01:00:00Z' }], error: null }));
  assert.ok(ok instanceof Map);
  assert.equal(ok.get('a@x.com'), '2026-11-25T01:00:00Z');
});

// ── Kolom tabel akun ─────────────────────────────────────────────────────────────────────────

test('buildColumns: kolom "Terakhir diubah" hanya ada kalau datanya ada; nilainya tak peka huruf besar/kecil', async () => {
  const { buildColumns } = await mod('app/pages/pengaturan/table.js');
  const base = { getRows: () => [], getMe: () => '' };

  const tanpa = buildColumns({ ...base, getTerakhir: () => null });
  assert.equal(tanpa.some((c) => c.key === 'terakhir'), false);
  assert.equal(buildColumns(base).some((c) => c.key === 'terakhir'), false); // pemanggil lama tanpa getTerakhir

  const map = new Map([['hannan@x.com', '2026-11-25T19:00:00Z']]);
  const dengan = buildColumns({ ...base, getTerakhir: () => map });
  const keys = dengan.map((c) => c.key);
  assert.deepEqual(keys, ['email', 'role', 'modul', 'hapus', 'terakhir', 'aksi']); // sebelum kolom aksi
  const col = dengan.find((c) => c.key === 'terakhir');
  assert.equal(col.get({ email: 'Hannan@X.com' }), '2026-11-26T02:00:00'); // tanggal lokal, bukan UTC
  assert.equal(col.get({ email: 'lain@x.com' }), null);
  assert.match(col.render({ email: 'lain@x.com' }), /dt-nil/); // akun yang belum pernah diubah
});

test('KOLOM_OPTIONS: sama dengan label kolom audit yang dipakai tab Riwayat di drawer', async () => {
  const { KOLOM_LABEL } = await mod('app/pages/pengaturan/state.js');
  assert.deepEqual(KOLOM_OPTIONS.map((o) => o.value), Object.keys(KOLOM_LABEL));
  assert.equal(KOLOM_OPTIONS.find((o) => o.value === 'boleh_hapus').label, 'Hapus data');
});

// ── Markup <-> JS ────────────────────────────────────────────────────────────────────────────

test('setiap #id yang dicari JS ada di markup DAN di dalam elemen yang dipakai untuk mencarinya (id tidak dobel)', async () => {
  const { PENGATURAN_MARKUP: M } = await mod('app/pages/pengaturan/markup.js');
  const defined = [...M.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(defined).size, defined.length, 'id dobel di markup');

  // `$()` di index.js = #pgRoot.querySelector. Elemen di luarnya (mis. crumb di .pw-topbar) TIDAK ketemu, dan guard
  // `if (el)` membuatnya gagal diam-diam: id-nya ada di markup, tapi kodenya tidak pernah menyentuhnya.
  const rootAt = M.indexOf('id="pgRoot"');
  assert.ok(rootAt > 0);
  const idsIn = (file, re) => [...read(file).matchAll(re)].map((m) => m[1]);
  for (const id of idsIn('app/pages/pengaturan/index.js', /[^.\w]\$\('#([A-Za-z][\w-]*)'\)/g)) {
    const at = M.indexOf(`id="${id}"`);
    assert.ok(at > rootAt, `index.js: $('#${id}') mencari di dalam #pgRoot, tapi elemennya ${at < 0 ? 'tidak ada' : 'di luar #pgRoot'}`);
  }

  // riwayat.js mencari hanya di dalam #pgViewRiwayat.
  const from = M.indexOf('id="pgViewRiwayat"');
  const section = M.slice(from, M.indexOf('</section>', from));
  const ridUsed = new Set([...idsIn('app/pages/pengaturan/riwayat.js', /\$\('#([A-Za-z][\w-]*)'\)/g), ...idsIn('app/pages/pengaturan/riwayat.js', /querySelector\('#([A-Za-z][\w-]*)'\)/g)]);
  for (const id of ridUsed) assert.ok(section.includes(`id="${id}"`), `riwayat.js mencari #${id} yang tidak ada di dalam #pgViewRiwayat`);
});
