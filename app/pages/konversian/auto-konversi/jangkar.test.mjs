// Test jangkar.js — jalankan: node --test auto-konversi/jangkar.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { buatIndeks } from './prosedur.js';
import { understand } from './understand.js';
import { saudaraJangkar, hitungSaudara, susunTawaran, adaSpesifik, labelOpsi, JANGKAR_MAX } from './jangkar.js';

const rows = [
  ['K1', 'SECTIO CAESAREAN S.'], ['K2', 'BASIC SECTIO CAESAREAN S. 1'], ['K3', 'BASIC SECTIO CAESAREAN S. 2'], ['K4', 'COMPLETE SECTIO CAESAREAN S.'],
  ['L1', 'BASIC LAPAROTOMY S. 3'], ['L2', 'LAPAROTOMY S.'],
  ['M1', 'MINOR S.'], ['M2', 'MINOR VAGINAL S.'], ['M3', 'BASIC MINOR S. 2'], ['Z1', 'HISTEROSKOPI S.']
].map(([kode, nama]) => ({ kode, nama }));
const pros = buatIndeks(rows, {});

test('saudara = anggota se-prosedur, jangkar tidak ikut, urut tier lalu nomor', () => {
  const s = saudaraJangkar('K1', pros);
  assert.deepEqual(s.saudara.map((m) => m.kode), ['K2', 'K3', 'K4']); // basic S.1, basic S.2, complete
  assert.equal(s.kunci, 'SECTIO CAESAREAN');
});

test('prosedur lain & kualifier lain tidak bocor', () => {
  const k = saudaraJangkar('K1', pros).saudara.map((m) => m.kode);
  assert.ok(!k.includes('L1') && !k.includes('L2'));
  const m = saudaraJangkar('M1', pros).saudara.map((x) => x.kode);
  assert.deepEqual(m, ['M3']);            // MINOR VAGINAL (M2) bukan saudara MINOR
  assert.equal(saudaraJangkar('M2', pros), null); // sendirian di kunci MINOR + VAGINAL
});

test('bukan set berprosedur / tanpa saudara / tanpa indeks -> null, tidak melempar', () => {
  assert.equal(saudaraJangkar('TIDAK-ADA', pros), null);
  assert.equal(saudaraJangkar('Z1', pros), null);
  assert.equal(saudaraJangkar('K1', null), null);
  assert.equal(saudaraJangkar(null, pros), null);
  assert.equal(hitungSaudara('K1', null), 0);
});

test('terpakai ditandai & tidak dihitung, tapi tidak dibuang dari daftar', async () => {
  const terpakai = new Set(['K2']);
  assert.equal(hitungSaudara('K1', pros, { terpakai }), 2);
  const t = await susunTawaran('K1', pros, { terpakai });
  const k2 = t.opsi.find((o) => o.kode === 'K2');
  assert.equal(k2.pilih, false);
  assert.match(k2.alasan, /dipakai/);
  assert.equal(k2.terkunci, false);       // masih boleh dicentang sadar
});

test('jangkar selalu pertama, tercentang, terkunci', async () => {
  const t = await susunTawaran('K3', pros, {});
  assert.equal(t.opsi[0].kode, 'K3');
  assert.deepEqual([t.opsi[0].jangkar, t.opsi[0].pilih, t.opsi[0].terkunci], [true, true, true]);
  assert.deepEqual(t.opsi.slice(1).map((o) => o.kode), ['K2', 'K1', 'K4']);
  assert.ok(t.opsi.slice(1).every((o) => o.pilih && !o.terkunci));
});

test('cek brand/firm: terkunci tidak bisa dicentang, belum-siap tidak tercentang tapi bisa dipaksa', async () => {
  const cek = async () => new Map([
    ['K2', { ok: false, alasan: 'Brand ADLER, konversi ini ROBUST', terkunci: true }],
    ['K4', { ok: false, alasan: 'Belum siap dijual: link V6' }]
  ]);
  const t = await susunTawaran('K1', pros, { cek });
  const by = Object.fromEntries(t.opsi.map((o) => [o.kode, o]));
  assert.deepEqual([by.K2.pilih, by.K2.terkunci], [false, true]);
  assert.deepEqual([by.K4.pilih, by.K4.terkunci], [false, false]);
  assert.equal(by.K3.pilih, true);
});

test('cek melempar -> gagal tertutup: tidak ada saudara yang tercentang, jangkar tetap', async () => {
  const t = await susunTawaran('K1', pros, { cek: async () => { throw new Error('offline'); } });
  assert.equal(t.belumDicek, true);
  assert.equal(t.opsi[0].pilih, true);
  assert.ok(t.opsi.slice(1).every((o) => !o.pilih && /belum bisa dicek/.test(o.alasan)));
});

test('spesifikasi permintaan bentrok -> tidak tercentang dengan alasan', async () => {
  const fake = {
    info: (k) => ({ A: { kode: 'A', nama: 'KLEM BL/BL S.', tier: 'standar', nomor: null, prosedur: 'KLEM', kualifier: '', kunci: 'KLEM' } }[k] || null),
    anggota: () => [
      { kode: 'A', nama: 'KLEM BL/BL S.', tier: 'standar', nomor: null },
      { kode: 'B', nama: 'KLEM SH/BL S.', tier: 'standar', nomor: null },
      { kode: 'C', nama: 'KLEM BL/BL COMPLETE S.', tier: 'complete', nomor: null }
    ]
  };
  const itemAttrs = { ...understand('KLEM BL/BL').attrs };
  assert.equal(adaSpesifik(itemAttrs), true);
  const t = await susunTawaran('A', fake, { itemAttrs });
  const by = Object.fromEntries(t.opsi.map((o) => [o.kode, o]));
  assert.equal(by.B.pilih, false);
  assert.match(by.B.alasan, /Spesifikasi beda/);
  assert.equal(by.C.pilih, true);
  // permintaan umum -> tidak ada penyaringan atribut
  assert.equal(adaSpesifik(understand('Sectio caesarian set').attrs), false);
});

test('batas JANGKAR_MAX: jangkar dihitung, sisanya dipotong & dilaporkan', async () => {
  const banyak = Array.from({ length: 30 }, (_, i) => ({ kode: 'X' + i, nama: 'ABC SET ' + i, tier: 'standar', nomor: i }));
  const fake = { info: (k) => (k === 'X0' ? { ...banyak[0], prosedur: 'ABC', kualifier: '', kunci: 'ABC' } : null), anggota: () => banyak };
  const t = await susunTawaran('X0', fake, {});
  assert.equal(t.opsi.length, JANGKAR_MAX);
  assert.equal(t.terpotong, 30 - JANGKAR_MAX);
  assert.equal(t.opsi[0].kode, 'X0');
});

test('labelOpsi', () => {
  assert.equal(labelOpsi({ tier: 'basic', nomor: 2 }), 'Basic S.2');
  assert.equal(labelOpsi({ tier: 'complete', nomor: null }), 'Complete');
});

// ── Firm saja (info firm/brand ikut di indeks dari view v_produk_varian) ──
const rowsFirm = [
  { kode: 'R1', nama: 'SECTIO CAESAREAN S.', brand: 'ROBUST', firm: true },
  { kode: 'R2', nama: 'BASIC SECTIO CAESAREAN S. 1', brand: 'ROBUST', firm: true },
  { kode: 'R3', nama: 'BASIC SECTIO CAESAREAN S. 2', brand: 'ROBUST', firm: false, firmAlasan: 'link V6 belum dibuat' },
  { kode: 'A1', nama: 'COMPLETE SECTIO CAESAREAN S.', brand: 'ADLER', firm: true },
  { kode: 'R4', nama: 'COMPLETE SECTIO CAESAREAN S. 3', brand: 'ROBUST', firm: true },
];
const prosFirm = buatIndeks(rowsFirm, {});

test('firm saja: brand lain & belum firm TIDAK ditawarkan, hanya dihitung di disembunyikan', () => {
  const s = saudaraJangkar('R1', prosFirm, { brand: 'ROBUST' });
  assert.deepEqual(s.saudara.map((m) => m.kode), ['R2', 'R4']);
  assert.deepEqual(s.disembunyikan.map((m) => m.kode).sort(), ['A1', 'R3']);
  assert.match(s.disembunyikan.find((m) => m.kode === 'R3').alasan, /link V6/);
  assert.match(s.disembunyikan.find((m) => m.kode === 'A1').alasan, /Brand ADLER/);
  assert.equal(hitungSaudara('R1', prosFirm, { brand: 'ROBUST' }), 2); // chip = panel
});

test('susunTawaran firm saja: tidak ada baris terkunci, cek async tidak dipanggil (info firm sudah ada)', async () => {
  let dipanggil = 0;
  const t = await susunTawaran('R1', prosFirm, { brand: 'ROBUST', cek: async () => { dipanggil++; return new Map(); } });
  assert.equal(dipanggil, 0);
  assert.deepEqual(t.opsi.map((o) => o.kode), ['R1', 'R2', 'R4']);
  assert.ok(t.opsi.slice(1).every((o) => o.pilih && !o.terkunci));
  assert.equal(t.disembunyikan.length, 2);
});

test('mode Swasta (hanyaFirm:false): belum firm ikut, brand tetap disaring', () => {
  const s = saudaraJangkar('R1', prosFirm, { brand: 'ROBUST', hanyaFirm: false });
  assert.deepEqual(s.saudara.map((m) => m.kode), ['R2', 'R3', 'R4']);
});

test('semua saudara tersaring -> null (chip tidak muncul, bukan tawaran kosong)', () => {
  const p = buatIndeks([{ kode: 'X1', nama: 'MINOR S.', brand: 'ROBUST', firm: true }, { kode: 'X2', nama: 'BASIC MINOR S. 2', brand: 'ROBUST', firm: false }], {});
  assert.equal(saudaraJangkar('X1', p, { brand: 'ROBUST' }), null);
});

test('ejaan beda (EMBRIOTOMI vs EMBRIOTOMY) = satu prosedur; nama brand bukan kualifier', () => {
  const p = buatIndeks([
    { kode: 'E1', nama: 'EMBRIOTOMY S.', brand: 'ROBUST', firm: true },
    { kode: 'E2', nama: 'BASIC EMBRIOTOMY INSTRUMENT S.', brand: 'ROBUST', firm: true },
    { kode: 'E3', nama: 'ADLER EMBRIOTOMI S.', brand: 'ADLER', firm: true },
  ], {});
  assert.equal(p.info('E3').kunci, p.info('E1').kunci);
  const s = saudaraJangkar('E3', p, { brand: 'ROBUST' }); // jangkar boleh brand lain; yang ditawarkan hanya ROBUST
  assert.deepEqual(s.saudara.map((m) => m.kode).sort(), ['E1', 'E2']);
  assert.equal(p.cari('Embriotomi set').kunci, p.info('E1').kunci);
});
