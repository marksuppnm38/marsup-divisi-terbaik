// Tes izin per-akun (modul + submodul) lapisan UI. Menjalankan KODE ASLI:
//   shared/auth-session.js (PNMAuth.canView) lewat vm, dan app/pages/nav/perm-view.js lewat import.
// Jalankan: node --test scripts/test-izin-akun.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const ROOT = new URL('../', import.meta.url);

// Muat auth-session.js sungguhan dengan supabase palsu yang mengembalikan baris izin yang kita tentukan.
async function loginAs(row) {
  const sb = { from() { const q = { select() { return q; }, eq() { return q; }, maybeSingle: async () => ({ data: row, error: null }) }; return q; } };
  const win = { pnmSupabase: sb, console }; win.window = win;
  vm.runInNewContext(fs.readFileSync(new URL('shared/auth-session.js', ROOT), 'utf8'), win);
  await win.PNMAuth.loadPerms('x@x');
  globalThis.window = win; // perm-view.js membaca window.PNMAuth saat dipanggil
}
const perm = await import(new URL('app/pages/nav/perm-view.js', ROOT).href);
const { isModuleAllowed, visibleSubs, firstAllowedSub, navModules, navPermSignature, canonHidden, knownPermIds, SUBNAV } = perm;
const ids = () => navModules().map((m) => m.id);
const staff = (hidden) => ({ role: 'staff', is_superuser: false, boleh_hapus: false, boleh_hapus_sesi: false, modul_tersembunyi: hidden });

test('modul disembunyikan: tidak di menu, tidak bisa dibuka, modul lain normal', async () => {
  await loginAs(staff(['rekon-meeting']));
  assert.equal(isModuleAllowed('rekon-meeting'), false);
  assert.equal(ids().includes('rekon-meeting'), false);
  assert.ok(ids().includes('konversian') && ids().includes('dashboard'));
  assert.equal(isModuleAllowed('pengaturan'), false);
});

test('submodul disembunyikan: modulnya tetap ada, submodul itu saja yang hilang dan terblokir', async () => {
  await loginAs(staff(['konversian/riwayat', 'crud-produk/akd']));
  assert.equal(isModuleAllowed('konversian'), true);
  assert.equal(isModuleAllowed('konversian', 'riwayat'), false);
  assert.equal(isModuleAllowed('konversian', 'cari'), true);
  assert.equal(isModuleAllowed('crud-produk', 'akd'), false);
  assert.equal(visibleSubs('konversian').some((s) => s.id === 'riwayat'), false);
  assert.equal(visibleSubs('konversian').length, SUBNAV.konversian.length - 1);
  assert.equal(visibleSubs('dashboard'), null); // modul tanpa submodul
});

test('submodul bawaan disembunyikan: URL tanpa sub diarahkan ke submodul pertama yang boleh', async () => {
  await loginAs(staff(['konversian/cari']));
  assert.equal(SUBNAV.konversian[0].id, 'cari'); // asumsi router: bawaan = urutan pertama
  assert.equal(firstAllowedSub('konversian'), 'sesi');
  await loginAs(staff([]));
  assert.equal(firstAllowedSub('konversian'), 'cari');
});

test('semua submodul disembunyikan satu per satu = modul tertutup', async () => {
  await loginAs(staff(SUBNAV.konversian.map((s) => `konversian/${s.id}`)));
  assert.equal(isModuleAllowed('konversian'), false);
  assert.equal(ids().includes('konversian'), false);
  assert.equal(firstAllowedSub('konversian'), null);
});

test('modul tersembunyi menutup semua submodulnya walau id submodul tidak dicantumkan', async () => {
  await loginAs(staff(['konversian']));
  for (const s of SUBNAV.konversian) assert.equal(isModuleAllowed('konversian', s.id), false);
});

test('id basi / ngawur di daftar tidak berefek', async () => {
  await loginAs(staff(['konversian/tidak-ada', 'modul-hantu', 7, null]));
  assert.equal(isModuleAllowed('konversian'), true);
  assert.equal(visibleSubs('konversian').length, SUBNAV.konversian.length);
});

test('admin selalu melihat semua + Pengaturan, walau kolomnya berisi modul', async () => {
  await loginAs({ role: 'admin', is_superuser: true, modul_tersembunyi: ['rekon-meeting', 'konversian/riwayat'] });
  assert.equal(isModuleAllowed('rekon-meeting'), true);
  assert.equal(isModuleAllowed('konversian', 'riwayat'), true);
  assert.equal(isModuleAllowed('pengaturan'), true);
  assert.ok(ids().includes('pengaturan'));
});

test('izin gagal dimuat (null): tidak melarang modul, tapi /pengaturan tertutup', async () => {
  await loginAs(null);
  assert.equal(isModuleAllowed('rekon-meeting'), true);
  assert.equal(isModuleAllowed('pengaturan'), false);
});

test('sidik jari berubah saat izin berubah (pemicu render ulang sidebar)', async () => {
  await loginAs(staff([])); const a = navPermSignature();
  await loginAs(staff(['rekon-meeting'])); const b = navPermSignature();
  await loginAs(staff(['konversian/riwayat'])); const c = navPermSignature();
  assert.notEqual(a, b); assert.notEqual(a, c); assert.notEqual(b, c);
  await loginAs(staff([])); assert.equal(navPermSignature(), a);
});

test('canonHidden: baku, deduplikasi, urut', () => {
  const all = SUBNAV.konversian.map((s) => `konversian/${s.id}`);
  assert.deepEqual(canonHidden(all), ['konversian']);                          // semua sub = modul
  assert.deepEqual(canonHidden(['konversian', 'konversian/riwayat']), ['konversian']); // sub redundan dibuang
  assert.deepEqual(canonHidden(['konversian/riwayat', 'a-modul']), ['a-modul', 'konversian/riwayat']);
  assert.deepEqual(canonHidden([]), []);
});

test('knownPermIds memuat modul dan submodul, dan setiap id lolos format constraint database', () => {
  const k = knownPermIds();
  assert.ok(k.has('rekon-meeting') && k.has('konversian/riwayat') && k.has('crud-produk/orphan'));
  const fmt = /^[a-z0-9-]{1,40}(\/[a-z0-9-]{1,40})?$/; // sama dengan izin_modul_valid() di SQL
  for (const id of k) assert.match(id, fmt, id);
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// Halaman Pengaturan > User Management (app/pages/pengaturan/): logika murni state.js + sel tabel table.js
// ════════════════════════════════════════════════════════════════════════════════════════════
const st = await import(new URL('app/pages/pengaturan/state.js', ROOT).href);
const tbl = await import(new URL('app/pages/pengaturan/table.js', ROOT).href);
const FMT = /^[a-z0-9-]{1,40}(\/[a-z0-9-]{1,40})?$/; // izin_modul_valid() di SQL
const baseRow = (o = {}) => st.normalizeRow({ email: 'a@x.id', role: 'staff', is_superuser: false, boleh_hapus: false, boleh_hapus_sesi: false, modul_tersembunyi: [], ...o });
const K = SUBNAV.konversian.map((s) => s.id);

test('Pengaturan bukan modul yang bisa disembunyikan: tidak ada id pengaturan di knownPermIds', () => {
  for (const id of knownPermIds()) assert.ok(!id.startsWith('pengaturan'), id);
  assert.equal(SUBNAV.pengaturan, undefined);
});

test('normalizeRow: id basi dibuang, hasil baku, tipe dipaksa', () => {
  const r = st.normalizeRow({ email: 'a@x.id', is_superuser: 1, boleh_hapus: null, modul_tersembunyi: ['modul-hantu', 'konversian/tidak-ada', 'konversian/riwayat', 7, null, 'rekon-meeting'] });
  assert.deepEqual(r.modul_tersembunyi, ['konversian/riwayat', 'rekon-meeting']);
  assert.equal(r.is_superuser, true);
  assert.equal(r.boleh_hapus, false);
  assert.deepEqual(st.normalizeRow({ email: 'b@x.id', modul_tersembunyi: 'bukan-array' }).modul_tersembunyi, []);
});

test('setMod / setSub: hasil selalu baku, modulnya tidak bocor ke id lain, dan tidak memutasi argumen', () => {
  const f0 = st.rowToForm(baseRow());
  const frozen = JSON.stringify(f0);
  const off = st.setMod(f0, 'konversian', false);
  assert.deepEqual(off.hidden, ['konversian']);
  assert.equal(JSON.stringify(f0), frozen);
  assert.deepEqual(st.setMod(off, 'konversian', true).hidden, []);

  // satu submodul dimatikan -> sebagian
  const one = st.setSub(f0, 'konversian', 'riwayat', false);
  assert.deepEqual(one.hidden, ['konversian/riwayat']);
  const m = st.modState(one, 'konversian');
  assert.deepEqual([m.on, m.partial, m.count, m.total], [true, true, K.length - 1, K.length]);

  // modul mati seluruhnya lalu SATU submodul dinyalakan: 'konversian' diurai, hanya yang dinyalakan yang tampil
  const back = st.setSub(off, 'konversian', 'cari', true);
  assert.equal(back.hidden.includes('konversian'), false);
  assert.equal(st.isSubOn(back, 'konversian', 'cari'), true);
  assert.equal(st.isSubOn(back, 'konversian', 'riwayat'), false);
  assert.equal(st.modState(back, 'konversian').count, 1);

  // semua submodul dimatikan satu per satu -> kembali jadi 'konversian' (bentuk baku)
  let f = f0;
  for (const s of K) f = st.setSub(f, 'konversian', s, false);
  assert.deepEqual(f.hidden, ['konversian']);
  assert.equal(st.modState(f, 'konversian').on, false);

  // submodul yang tidak ada diabaikan
  assert.equal(st.setSub(f0, 'konversian', 'tidak-ada', false), f0);
  assert.equal(st.setIzin(f0, 'is_superuser', true), f0); // hanya dua kunci izin yang boleh
});

test('modul tanpa submodul: modState 1/1 atau 0/1', () => {
  const f = st.setMod(st.rowToForm(baseRow()), 'rekon-meeting', false);
  assert.deepEqual(st.modState(f, 'rekon-meeting'), { on: false, partial: false, count: 0, total: 1 });
  assert.equal(st.modState(st.rowToForm(baseRow()), 'rekon-meeting').on, true);
});

test('diffForm: satuan = satu modul (berapa pun submodulnya) + tiap izin hapus; tanpa perubahan = 0', () => {
  const row = baseRow();
  assert.equal(st.diffForm(row, st.rowToForm(row)).count, 0);
  assert.equal(st.isDirty(row, st.rowToForm(row)), false);

  const matiModul = st.setMod(st.rowToForm(row), 'konversian', false); // 7 submodul tertutup = 1 perubahan
  assert.equal(st.diffForm(row, matiModul).count, 1);
  assert.deepEqual(st.diffForm(row, matiModul).items, ['Conversion Workspace']);

  const dua = st.setSub(st.setSub(st.rowToForm(row), 'konversian', 'riwayat', false), 'crud-produk', 'akd', false);
  assert.equal(st.diffForm(row, dua).count, 2);

  const izin = st.setIzin(st.setIzin(matiModul, 'boleh_hapus', true), 'boleh_hapus_sesi', true);
  assert.equal(st.diffForm(row, izin).count, 3);

  // nyala lalu dimatikan lagi = kembali bersih
  const rt = st.setMod(st.setMod(st.rowToForm(row), 'konversian', false), 'konversian', true);
  assert.equal(st.diffForm(row, rt).count, 0);
});

test('buildPayload: hanya kolom yang berubah; kosong kalau tidak ada perubahan; hasil lolos format constraint DB', () => {
  const row = baseRow({ modul_tersembunyi: ['rekon-meeting'] });
  assert.deepEqual(st.buildPayload(row, st.rowToForm(row)), {});

  const izinSaja = st.setIzin(st.rowToForm(row), 'boleh_hapus', true);
  assert.deepEqual(st.buildPayload(row, izinSaja), { boleh_hapus: true }); // modul_tersembunyi TIDAK ikut dikirim

  const modulSaja = st.setSub(st.rowToForm(row), 'konversian', 'riwayat', false);
  const p = st.buildPayload(row, modulSaja);
  assert.deepEqual(Object.keys(p), ['modul_tersembunyi']);
  assert.deepEqual(p.modul_tersembunyi, ['konversian/riwayat', 'rekon-meeting']);
  for (const id of p.modul_tersembunyi) assert.match(id, FMT);
  assert.ok(p.modul_tersembunyi.length <= 64);
});

test('buildPayload: admin tidak pernah menulis modul_tersembunyi, izin hapusnya tetap bisa diubah', () => {
  const admin = baseRow({ is_superuser: true, modul_tersembunyi: ['rekon-meeting'] });
  const f = st.setIzin(st.setMod(st.rowToForm(admin), 'konversian', false), 'boleh_hapus', true);
  assert.deepEqual(st.buildPayload(admin, f), { boleh_hapus: true });
  assert.equal(st.diffForm(admin, st.setMod(st.rowToForm(admin), 'konversian', false)).count, 0); // kontrol modul terkunci
});

test('needsDeleteConfirm: hanya saat Hapus data dinyalakan, bukan saat dimatikan atau sudah menyala', () => {
  const off = baseRow(); const on = baseRow({ boleh_hapus: true });
  assert.equal(st.needsDeleteConfirm(off, st.setIzin(st.rowToForm(off), 'boleh_hapus', true)), true);
  assert.equal(st.needsDeleteConfirm(on, st.setIzin(st.rowToForm(on), 'boleh_hapus', false)), false);
  assert.equal(st.needsDeleteConfirm(on, st.rowToForm(on)), false);
  assert.equal(st.needsDeleteConfirm(off, st.setIzin(st.rowToForm(off), 'boleh_hapus_sesi', true)), false);
});

test('sameServerState: deteksi konflik membandingkan tiga kolom, urutan id tidak berpengaruh', () => {
  const a = baseRow({ modul_tersembunyi: ['rekon-meeting', 'konversian/riwayat'] });
  assert.equal(st.sameServerState(a, baseRow({ modul_tersembunyi: ['konversian/riwayat', 'rekon-meeting'] })), true);
  assert.equal(st.sameServerState(a, baseRow({ modul_tersembunyi: ['rekon-meeting'] })), false);
  assert.equal(st.sameServerState(a, baseRow({ modul_tersembunyi: a.modul_tersembunyi, boleh_hapus: true })), false);
  assert.equal(st.sameServerState(a, baseRow({ modul_tersembunyi: a.modul_tersembunyi, boleh_hapus_sesi: true })), false);
  assert.equal(st.sameServerState(a, null), false);
});

test('ringkasan tabel: izin hapus efektif, ringkasan modul, filter role dari data, pencarian', () => {
  assert.equal(st.hapusLevel(baseRow()), 'Tidak');
  assert.equal(st.hapusLevel(baseRow({ boleh_hapus_sesi: true })), 'Clipboard');
  assert.equal(st.hapusLevel(baseRow({ boleh_hapus_sesi: true, boleh_hapus: true })), 'Penuh');
  assert.equal(st.modulSummary(baseRow({ is_superuser: true })), 'Akses penuh');
  assert.equal(st.modulSummary(baseRow()), 'Semua tampil');
  assert.equal(st.modulSummary(baseRow({ modul_tersembunyi: ['rekon-meeting', 'konversian/riwayat'] })), '2 disembunyikan');
  assert.deepEqual(st.roleOptions([baseRow({ role: 'staff' }), baseRow({ role: 'developer' }), baseRow({ role: '' }), baseRow({ role: 'staff' })]), ['developer', 'staff']);
  assert.equal(st.matchSearch(baseRow({ email: 'Hannan@X.id' }), '  hANN '), true);
  assert.equal(st.matchSearch(baseRow({ role: 'developer' }), 'devel'), true);
  assert.equal(st.matchSearch(baseRow(), 'zzz'), false);
  assert.equal(st.matchSearch(baseRow(), ''), true);
});

test('riwayat: label modul ramah, selisih disembunyikan/ditampilkan, boolean dan nilai kosong', () => {
  assert.equal(st.idLabel('konversian/riwayat'), 'Conversion Workspace › Riwayat');
  assert.equal(st.idLabel('rekon-meeting'), 'Rekon Meeting');
  assert.equal(st.idLabel('modul-hantu'), 'modul-hantu');
  const d = st.diffHiddenAudit('konversian/riwayat, rekon-meeting', 'rekon-meeting, stok');
  assert.deepEqual(d, { disembunyikan: ['Stok'], ditampilkan: ['Conversion Workspace › Riwayat'] });
  assert.equal(st.describeAudit({ kolom: 'boleh_hapus', nilai_lama: 'false', nilai_baru: 'true' }), 'Hapus data: tidak → ya');
  assert.equal(st.describeAudit({ kolom: 'modul_tersembunyi', nilai_lama: '', nilai_baru: 'stok' }), 'Modul disembunyikan: Stok');
  assert.equal(st.describeAudit({ kolom: 'akun', nilai_lama: null, nilai_baru: 'ditambahkan' }), 'Akun: — → ditambahkan');
  assert.equal(st.describeAudit({ kolom: 'kolom-baru', nilai_lama: 'a', nilai_baru: 'b' }), 'kolom-baru: a → b');
});

test('XSS: email/role dari database selalu di-escape di semua sel tabel', () => {
  const evil = st.normalizeRow({ email: '<img src=x onerror=alert(1)>@x.id', role: '"><script>alert(1)</script>', is_superuser: true, modul_tersembunyi: [] });
  const cols = tbl.buildColumns({ getRows: () => [evil], getMe: () => evil.email.toLowerCase() });
  const html = cols.map((c) => (c.render ? c.render(evil) : '')).join('');
  assert.ok(!html.includes('<img'), html);
  assert.ok(!html.includes('<script'), html);
  assert.ok(html.includes('&lt;img'));
  assert.equal(tbl.escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
});


// ── Fase 2: preset izin & salin dari akun lain ───────────────────────────────────────────────
const pr = await import(new URL('app/pages/pengaturan/presets.js', ROOT).href);
const formOf = (o = {}) => ({ boleh_hapus: false, boleh_hapus_sesi: false, hidden: [], ...o });

test('preset: id unik dan semua id di `tampil` dikenal (preset tidak menunjuk modul hantu)', () => {
  const known = knownPermIds();
  assert.equal(new Set(pr.PRESETS.map((p) => p.id)).size, pr.PRESETS.length);
  assert.ok(!pr.PRESETS.some((p) => p.id === pr.CUSTOM_ID), '"custom" dicadangkan untuk keadaan terhitung');
  for (const p of pr.PRESETS) {
    if (p.tampil === '*') continue;
    for (const id of p.tampil) assert.ok(known.has(id), `${p.id}: id tidak dikenal "${id}"`);
  }
});

test('preset -> hidden: "*" tidak menyembunyikan apa pun; modul utuh menyembunyikan semua modul lain (bentuk baku)', () => {
  assert.deepEqual(pr.presetHidden({ tampil: '*' }), []);
  const h = pr.presetHidden({ tampil: ['konversian'] });
  const mods = [...knownPermIds()].filter((id) => !id.includes('/'));
  assert.deepEqual(h, canonHidden(mods.filter((m) => m !== 'konversian'))); // modul lain tersembunyi utuh, tanpa id submodulnya
  assert.ok(!h.some((id) => id === 'konversian' || id.startsWith('konversian/')));
  assert.ok(!h.some((id) => id.includes('/')), 'modul yang tersembunyi utuh tidak mencantumkan submodulnya');
  assert.deepEqual(canonHidden(h), h); // sudah baku: round-trip tidak berubah
});

test('preset -> hidden: sebagian submodul saja = modul tetap tampil, submodul lain tersembunyi', () => {
  const h = pr.presetHidden({ tampil: ['konversian/cari'] });
  assert.ok(!h.includes('konversian'));
  assert.ok(!h.includes('konversian/cari'));
  for (const s of SUBNAV.konversian.filter((x) => x.id !== 'cari')) assert.ok(h.includes(`konversian/${s.id}`), s.id);
  assert.ok(h.includes('stok'));
});

test('preset -> hidden: id basi di `tampil` diabaikan, tidak error dan tidak menyembunyikan lebih', () => {
  assert.deepEqual(pr.presetHidden({ tampil: ['konversian', 'modul-hantu', 'konversian/hantu'] }), pr.presetHidden({ tampil: ['konversian'] }));
});

test('applyPreset: mengisi ketiga kolom, tidak memutasi form asal; matchPreset mengenalinya', () => {
  const before = formOf({ boleh_hapus_sesi: true, hidden: ['stok'] });
  const snapshot = JSON.stringify(before);
  for (const p of pr.PRESETS) {
    const next = pr.applyPreset(before, p);
    assert.equal(next.boleh_hapus, !!p.boleh_hapus);
    assert.equal(next.boleh_hapus_sesi, !!p.boleh_hapus_sesi);
    assert.deepEqual(next.hidden, pr.presetHidden(p));
    assert.equal(pr.matchPreset(next), p.id);
  }
  assert.equal(JSON.stringify(before), snapshot);
});

test('matchPreset: Custom dihitung (null) begitu form menyimpang dari preset mana pun', () => {
  const konversi = pr.PRESETS.find((p) => p.id === 'konversi');
  const f = pr.applyPreset(formOf(), konversi);
  assert.equal(pr.matchPreset(f), 'konversi');
  assert.equal(pr.matchPreset(st.setSub(f, 'konversian', 'riwayat', false)), null);   // ubah submodul
  assert.equal(pr.matchPreset(st.setMod(f, 'stok', true)), null);                      // tampilkan modul lain
  assert.equal(pr.matchPreset(st.setIzin(f, 'boleh_hapus_sesi', true)), null);         // ubah izin hapus
  assert.equal(pr.matchPreset(formOf({ hidden: ['stok'] })), null);
});

test('preset + diffForm/buildPayload: hanya kolom yang berubah ditulis; admin tidak pernah menulis modul_tersembunyi', () => {
  const konversi = pr.PRESETS.find((p) => p.id === 'konversi');
  const row = baseRow();
  const payload = st.buildPayload(row, pr.applyPreset(st.rowToForm(row), konversi));
  assert.deepEqual(Object.keys(payload), ['modul_tersembunyi']); // izin hapus sudah sama (mati) -> tidak ikut
  assert.deepEqual(payload.modul_tersembunyi, pr.presetHidden(konversi));
  const adminRow = baseRow({ is_superuser: true });
  assert.ok(!('modul_tersembunyi' in st.buildPayload(adminRow, pr.applyPreset(st.rowToForm(adminRow), konversi))));
});

test('preset yang menyalakan Hapus data wajib lewat konfirmasi (needsDeleteConfirm), yang mematikannya tidak', () => {
  const penuh = pr.PRESETS.find((p) => p.boleh_hapus);
  if (!penuh) return; // tidak ada preset yang menyalakan Hapus data
  const off = baseRow();
  assert.equal(st.needsDeleteConfirm(off, pr.applyPreset(st.rowToForm(off), penuh)), true);
  const on = baseRow({ boleh_hapus: true });
  assert.equal(st.needsDeleteConfirm(on, pr.applyPreset(st.rowToForm(on), penuh)), false);
  const konversi = pr.PRESETS.find((p) => p.id === 'konversi');
  assert.equal(st.needsDeleteConfirm(on, pr.applyPreset(st.rowToForm(on), konversi)), false);
});

test('salin dari akun: menyalin tiga kolom; sumber admin = semua tampil; tidak memutasi sumber maupun form', () => {
  const src = baseRow({ email: 'b@x.id', boleh_hapus: true, boleh_hapus_sesi: true, modul_tersembunyi: ['stok', 'konversian/riwayat'] });
  const snapshot = JSON.stringify(src);
  const next = pr.applyCopy(formOf({ hidden: ['rekon-meeting'] }), src);
  assert.deepEqual(next, { boleh_hapus: true, boleh_hapus_sesi: true, hidden: src.modul_tersembunyi });
  next.hidden.push('x');
  assert.equal(JSON.stringify(src), snapshot, 'hidden hasil salinan bukan referensi yang sama dengan sumber');
  const admin = baseRow({ email: 'adm@x.id', is_superuser: true, boleh_hapus: true, modul_tersembunyi: ['stok'] });
  assert.deepEqual(pr.applyCopy(formOf({ hidden: ['rekon-meeting'] }), admin), { boleh_hapus: true, boleh_hapus_sesi: false, hidden: [] });
});

test('copySources: semua akun selain diri sendiri (tak peka huruf besar/kecil), urut email', () => {
  const rows = ['c@x.id', 'A@x.id', 'b@x.id'].map((email) => baseRow({ email }));
  assert.deepEqual(pr.copySources(rows, 'a@X.id').map((r) => r.email), ['b@x.id', 'c@x.id']);
  assert.deepEqual(pr.copySources([], 'a@x.id'), []);
});
