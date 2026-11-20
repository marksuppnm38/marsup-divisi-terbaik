// Jalankan: node --test app/pages/konversian/auto-konversi/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseRequestText, parseLine, extractSpecs, parseCompetitorSet, resolveItem, resolveItems, summarize, isAmbiguous, assessProduk, makeFirmCheck } from './index.js';

const dir = dirname(fileURLToPath(import.meta.url));
const fx = (n) => readFileSync(join(dir, 'fixtures', n), 'utf8');

// ───────────── PARSER: permintaan RS ─────────────
test('contoh permintaan RS (paste Excel, TAB) terbaca 10 item, total qty 105', () => {
  const r = parseRequestText(fx('permintaan-rs-contoh.txt'), { merge: true });
  assert.equal(r.items.length, 10);       // 14 baris, 5 baris GUNTING JARINGAN digabung
  assert.equal(r.totalQty, 105);
  assert.equal(r.skipped.length, 0);
  const by = (n) => r.items.find(i => i.nama === n);
  assert.equal(by('PINSET DURA').qty, 5);
  assert.equal(by('KLEM BENGKOK').qty, 20);
  assert.equal(by('KLEM BENGKOK PANJANG').qty, 20);
  assert.equal(by('GUNTING GIFS').qty, 1);   // spasi panjang sebelum TAB tidak mengganggu
  assert.equal(by('KOM').qty, 5);
  assert.equal(by('GUNTING JARINGAN').qty, 25);
  assert.equal(by('GUNTING JARINGAN').merged_count, 5);
  assert.ok(r.items.every(i => i.qty_source === 'tab' && !i.qty_ambiguous));
  assert.ok(r.warnings.some(w => w.includes('GUNTING JARINGAN') && w.includes('5×')));
});

test('"NEEDELHOLDER 14.5" -> ukuran 14.5 cm (inferred), qty 10 dari kolom, bukan dari angka ukuran', () => {
  const r = parseRequestText('NEEDELHOLDER 14.5\t10\nNEEDELHOLDER 20.5\t10');
  assert.equal(r.items[0].qty, 10);
  assert.equal(r.items[0].specs.ukuran_cm, 14.5);
  assert.equal(r.items[0].specs.ukuran_inferred, true);
  assert.equal(r.items[1].specs.ukuran_cm, 20.5);
  assert.deepEqual(r.items[0].variants, ['NEEDELHOLDER 14.5', 'NEEDLE HOLDER 14.5']);
});

test('typo "GUNTING GIFS" menghasilkan varian GIPS, ejaan asli tetap pertama', () => {
  const [it] = parseRequestText('GUNTING GIFS\t1').items;
  assert.deepEqual(it.variants, ['GUNTING GIFS', 'GUNTING GIPS']);
});

test('gaya WA tanpa TAB: nomor urut, bullet, satuan, harga, basa-basi', () => {
  assert.deepEqual(
    (({ nama, qty, qty_source }) => ({ nama, qty, qty_source }))(parseLine('1. Trocar 5mm 10 pcs')),
    { nama: 'Trocar 5mm', qty: 10, qty_source: 'unit' });
  const bed = parseLine('BED ICU 2 UNIT@ 134 JT');
  assert.equal(bed.nama, 'BED ICU'); assert.equal(bed.qty, 2); assert.equal(bed.pagu_satuan, 134000000);
  assert.equal(parseLine('10x Gunting Mayo').qty, 10);
  assert.equal(parseLine('Assalamualaikum').noise, true);
  assert.equal(parseLine('NO\tNAMA BARANG\tQTY').noise, true);  // header tabel hasil paste Excel
  assert.equal(parseLine('NO\tKOM\t5').noise, false);           // "NO" di kolom nomor tidak boleh membuang baris produk
});

test('angka bulat di ujung tanpa satuan = qty (tidak ambigu); setelah NO/FIG tetap bukan qty', () => {
  const p = parseLine('KLEM BENGKOK 20');
  assert.equal(p.qty, 20); assert.equal(p.qty_ambiguous, false); assert.equal(p.qty_source, 'suffix');
  const d = parseLine('NEEDELHOLDER 14.5 10');
  assert.equal(d.nama, 'NEEDELHOLDER 14.5'); assert.equal(d.qty, 10);
  const n = parseLine('SCALPEL HANDLE NO 3');
  assert.equal(n.qty, null); assert.equal(n.nama, 'SCALPEL HANDLE NO 3');
});

test('kolom "No" di depan baris TAB dibuang', () => {
  const p = parseLine('3\tGUNTING MAYO\t4');
  assert.equal(p.nama, 'GUNTING MAYO'); assert.equal(p.qty, 4);
});

test('extractSpecs: ukuran, mm, lurus/bengkok, gigi', () => {
  const s = extractSpecs('MOD. USA TISSUE FORCEPS 4:5 TEETH STR 14CM');
  assert.equal(s.ukuran_cm, 14); assert.equal(s.orientasi, 'lurus'); assert.equal(s.teeth, '4:5');
  assert.deepEqual(extractSpecs('KELLY RETRACTOR 65 X 50MM 26CM').mm, [65, 50]);
  assert.equal(extractSpecs('METZENBAUM CVD BL/BL 14.5CM.').ukuran_cm, 14.5);
  assert.equal(extractSpecs('KLEM BENGKOK PANJANG').panjang, true);
  assert.equal(extractSpecs('KLEM BENGKOK PANJANG').orientasi, 'bengkok');
});

// ───────────── PARSER: set kompetitor (Falcon) ─────────────
test('set Falcon Appendectomy & Hernia: 28 baris, total qty 61 cocok dengan dokumen', () => {
  const r = parseCompetitorSet(fx('falcon-appendectomy-hernia.txt'));
  assert.equal(r.setName, 'APPENDECTOMY AND HERNIA SET');
  assert.equal(r.items.length, 28);
  assert.equal(r.totalQtyParsed, 61);
  assert.equal(r.totalQtyDeclared, 61);
  assert.ok(r.checks.every(c => c.ok === true), JSON.stringify(r.checks));

  const metz = r.items.find(i => i.kode_kompetitor === '06-175-14');
  assert.equal(metz.qty, 2);
  assert.equal(metz.specs.ukuran_cm, 14.5);
  assert.equal(metz.specs.orientasi, 'bengkok');
  assert.equal(metz.core, 'METZENBAUM DISSECTING SCISSORS');

  const kocher = r.items.find(i => i.kode_kompetitor === '08-218-20');
  assert.equal(kocher.specs.teeth, '1:2');
  assert.equal(kocher.core, 'KOCHER OCHSNER ARTERY FORCEPS'); // "1:2 T" dan "STR" tidak ikut inti nama

  const ret = r.items.find(i => i.kode_kompetitor === '10-229-02');
  assert.deepEqual(ret.specs.mm, [36, 28]);
  assert.equal(ret.specs.ukuran_cm, 24);

  // dua ADSON beda jenis (dissecting vs tissue) tidak boleh jadi query yang sama
  const adson = r.items.filter(i => i.core.startsWith('ADSON'));
  assert.equal(adson.length, 2);
  assert.notEqual(adson[0].queries[0], adson[1].queries[0]);

  // dua spatula yang cm-nya sama (33) hanya beda lebar 30 vs 40 mm: query paling spesifik harus membedakan
  const sp = r.items.filter(i => i.core === 'ABDOMINAL SPATULA FLEXIBLE');
  assert.equal(sp.length, 2);
  assert.notEqual(sp[0].queries[0], sp[1].queries[0]);
  assert.match(sp[0].queries[0], /30 MM/); assert.match(sp[1].queries[0], /40 MM/);

  // Charrière & dimensi tanpa satuan tidak bocor ke inti nama
  assert.equal(r.items.find(i => i.kode_kompetitor === '13-184-22').core, 'POOLE SUCTION TUBE');
  assert.equal(r.items.find(i => i.kode_kompetitor === '20-111-36').core, 'STORING CASE');

  // header kolom & judul yang diulang bukan "baris gagal baca"
  assert.deepEqual(r.unparsed, []);
});

test('set kompetitor: nomor bolong / total tidak cocok dilaporkan, bukan diam-diam', () => {
  const rusak = fx('falcon-appendectomy-hernia.txt').split('\n').filter(l => !l.includes('08-137-14')).join('\n');
  const r = parseCompetitorSet(rusak);
  assert.equal(r.items.length, 27);
  assert.ok(r.checks.some(c => c.ok === false && c.msg.includes('15')));  // no. 15 hilang
  assert.ok(r.checks.some(c => c.ok === false && c.msg.includes('≠')));   // total 55 ≠ 61
});

// ───────────── RESOLVER (rpc di-mock) ─────────────
const row = (o) => ({ istilah: 'X', tier: 'exact', skor: 1, ukuran: 'tidak_diminta', freq: 10, is_set: false, ...o });
function mockRpc(table, catalog = {}) {
  const calls = [];
  const rpc = async (name, params) => {
    calls.push([name, params.p_text || params.q]);
    if (name === 'suggest_dictionary') return { data: table[params.p_text] || [] };
    if (name === 'search_produk_dengan_harga') return { data: catalog[params.q] || [] };
    return { error: { message: 'rpc tak dikenal' } };
  };
  rpc.calls = calls;
  return rpc;
}

test('resolver: riwayat kuat, satu produk, ukuran cocok -> AUTO', async () => {
  const rpc = mockRpc({ 'PINSET DURA': [row({ istilah: 'PINSET DURA', kode_produk: 'P-1', nama_produk: 'Dura Forceps 17cm', freq: 12 })] });
  const [it] = parseRequestText('PINSET DURA\t5').items;
  const h = await resolveItem(it, rpc);
  assert.equal(h.status, 'AUTO'); assert.equal(h.kode_produk, 'P-1');
});

test('resolver: istilah pernah dipenuhi 2 produk tanpa yang dominan -> REVIEW (ambigu, bukan error)', async () => {
  const rpc = mockRpc({ 'KLEM BENGKOK': [
    row({ istilah: 'KLEM BENGKOK', kode_produk: 'K-1', nama_produk: 'Kelly Curved 14cm', freq: 10 }),
    row({ istilah: 'KLEM BENGKOK', kode_produk: 'K-2', nama_produk: 'Crile Curved 14cm', freq: 8 })] });
  const [it] = parseRequestText('KLEM BENGKOK\t20').items;
  const h = await resolveItem(it, rpc);
  assert.equal(h.status, 'REVIEW'); assert.match(h.reason, /beberapa jenis produk/);
  assert.equal(h.candidates.length, 2);
});

test('resolver: satu produk dominan (≥70%, ≥3×) tetap AUTO walau ada produk lain', async () => {
  const rpc = mockRpc({ 'GUNTING BENANG': [
    row({ istilah: 'GUNTING BENANG', kode_produk: 'G-1', nama_produk: 'Gunting Benang', freq: 40 }),
    row({ istilah: 'GUNTING BENANG', kode_produk: 'G-2', nama_produk: 'Gunting Benang Lurus', freq: 4 })] });
  const [it] = parseRequestText('GUNTING BENANG\t5').items;
  assert.equal((await resolveItem(it, rpc)).status, 'AUTO');
});

test('resolver: ejaan asli tidak ketemu, varian hasil koreksi typo ketemu -> AUTO, dan kedua query tercatat', async () => {
  const rpc = mockRpc({ 'NEEDLE HOLDER 14.5': [row({ istilah: 'NEEDLE HOLDER 14.5', kode_produk: 'N-1', nama_produk: 'Mayo-Hegar 14.5cm', ukuran: 'cocok', freq: 9 })] });
  const [it] = parseRequestText('NEEDELHOLDER 14.5\t10').items;
  const h = await resolveItem(it, rpc);
  assert.equal(h.status, 'AUTO'); assert.equal(h.kode_produk, 'N-1');
  assert.deepEqual(h.tried.filter(t => t.via === 'dictionary').map(t => t.q), ['NEEDELHOLDER 14.5', 'NEEDLE HOLDER 14.5']);
});

test('resolver: ukuran beda / ukuran dekat -> REVIEW', async () => {
  const beda = mockRpc({ 'NEEDLE HOLDER 20.5': [row({ istilah: 'NEEDLE HOLDER 20.5', kode_produk: 'N-2', nama_produk: 'Mayo-Hegar 14cm', ukuran: 'beda' })] });
  const dekat = mockRpc({ 'NEEDLE HOLDER 20.5': [row({ istilah: 'NEEDLE HOLDER 20.5', kode_produk: 'N-3', nama_produk: 'Mayo-Hegar 20cm', ukuran: 'dekat' })] });
  const [it] = parseRequestText('NEEDLE HOLDER 20.5\t10').items;
  assert.equal((await resolveItem(it, beda)).status, 'REVIEW');
  assert.equal((await resolveItem(it, dekat)).status, 'REVIEW');
});

test('resolver: tidak ada di riwayat, ketemu di katalog -> REVIEW; tidak ada sama sekali -> UNKNOWN', async () => {
  const rpc = mockRpc({}, { 'GUNTING GIFS': [{ kode_produk: 'GP-1', nama_produk: 'Gunting Gips 20cm', tipe: 'INSTRUMENT' }] });
  const [gips, kom] = parseRequestText('GUNTING GIFS\t1\nKOM\t5').items;
  const a = await resolveItem(gips, rpc);
  assert.equal(a.status, 'REVIEW'); assert.equal(a.kode_produk, 'GP-1'); assert.match(a.reason, /katalog/);
  const b = await resolveItem(kom, rpc);
  assert.equal(b.status, 'UNKNOWN'); assert.equal(b.kode_produk, null);
});

test('resolver: query longgar dengan keyakinan lebih rendah TIDAK menimpa hasil query spesifik', async () => {
  const rpc = mockRpc({
    'Q SPESIFIK': [row({ tier: 'keluarga', istilah: 'Q SPESIFIK', kode_produk: 'S-1', nama_produk: 'Produk Spesifik', freq: 5 })],   // sedang
    'Q LONGGAR':  [row({ tier: 'fuzzy',    istilah: 'Q LONGGAR',  kode_produk: 'L-1', nama_produk: 'Produk Longgar',  freq: 5 })]    // lemah
  });
  const [it] = parseRequestText('KOM\t5').items;
  const h = await resolveItem(it, rpc, { queries: ['Q SPESIFIK', 'Q LONGGAR'] });
  assert.equal(h.kode_produk, 'S-1');
  assert.equal(h.tried.filter(t => t.via === 'dictionary').length, 2); // query kedua tetap dicoba (siapa tahu kuat), tapi tidak menang
});

test('resolver: error RPC tidak melempar — jadi UNKNOWN dengan alasan', async () => {
  const rpc = async () => ({ error: { message: 'boom' } });
  const [it] = parseRequestText('KOM\t5').items;
  const h = await resolveItem(it, rpc);
  assert.equal(h.status, 'UNKNOWN'); assert.match(h.reason, /boom/);
});

test('resolveItems + summarize: ringkasan AUTO/REVIEW/UNKNOWN dan cakupan qty', async () => {
  const rpc = mockRpc({
    'PINSET DURA': [row({ istilah: 'PINSET DURA', kode_produk: 'P-1', nama_produk: 'Dura Forceps', freq: 12 })],
    'KLEM BENGKOK': [
      row({ istilah: 'KLEM BENGKOK', kode_produk: 'K-1', nama_produk: 'Kelly', freq: 10 }),
      row({ istilah: 'KLEM BENGKOK', kode_produk: 'K-2', nama_produk: 'Crile', freq: 8 })]
  });
  const { items } = parseRequestText('PINSET DURA\t5\nKLEM BENGKOK\t20\nKOM\t5');
  const res = await resolveItems(items, rpc);
  const s = summarize(res);
  assert.deepEqual([s.AUTO, s.REVIEW, s.UNKNOWN, s.total], [1, 1, 1, 3]);
  assert.equal(s.pctAuto, 33); assert.equal(s.qtyAuto, 5); assert.equal(s.qtyAll, 30);
});

test('keluarga sama beda ukuran (KE100-B011/B014) -> bukan ambigu, AUTO dengan ukuran default', async () => {
  const rpc = mockRpc({ 'PINSET ANATOMIS': [
    row({ istilah: 'PINSET ANATOMIS', kode_produk: 'RB12-KE100-B011-U07', nama_produk: 'Dressing Forceps 11cm', freq: 6 }),
    row({ istilah: 'PINSET ANATOMIS', kode_produk: 'RB12-KE100-B014-U07', nama_produk: 'Dressing Forceps 14cm', freq: 2 })] });
  const [it] = parseRequestText('PINSET ANATOMIS\t5').items;
  const h = await resolveItem(it, rpc);
  assert.equal(h.status, 'AUTO'); assert.equal(h.kode_produk, 'RB12-KE100-B011-U07');
  assert.equal(h.ukuran_default, true); assert.equal(h.family, 'RB12-KE100');
});

test('keluarga berbeda tanpa dominan tetap REVIEW; SET beda kode = produk beda (bukan satu keluarga)', async () => {
  assert.ok(isAmbiguous([
    { istilah: 'X', src: 'riwayat', kode: 'RB13-KE375-B014-U07', freq: 4 },
    { istilah: 'X', src: 'riwayat', kode: 'RB13-KE411-B014-U07', freq: 3 }], { istilah: 'X', kode: 'RB13-KE375-B014-U07' }));
  assert.ok(isAmbiguous([
    { istilah: 'MINOR', src: 'riwayat', kode: 'RB999-KE921-B99-U12', freq: 9, isSet: true },
    { istilah: 'MINOR', src: 'riwayat', kode: 'RB999-KE921-B99-U93', freq: 7, isSet: true }], { istilah: 'MINOR', kode: 'RB999-KE921-B99-U12', isSet: true }));
});

test('permintaan umum (SET MINOR): satu SET unggul ≥2× dari runner-up -> bukan ambigu, AUTO; yang lain jadi alternatif', async () => {
  const mk = (kode, freq) => row({ istilah: 'SET MINOR', kode_produk: kode, nama_produk: 'Minor Set ' + kode, freq, is_set: true });
  const rpc = mockRpc({ 'SET MINOR': [mk('RB999-KE921-B99-U12', 11), mk('RB999-KE921-B99-U103', 4), mk('RB999-KE921-B99-U407', 3)] });
  const [it] = parseRequestText('SET MINOR\t2').items;
  const h = await resolveItem(it, rpc);
  assert.equal(h.status, 'AUTO'); assert.equal(h.kode_produk, 'RB999-KE921-B99-U12');
  assert.ok(h.candidates.length >= 3);                      // alternatif tetap tampil
  // 10× vs 8× tetap ambigu (tidak unggul 2×)
  assert.ok(isAmbiguous([
    { istilah: 'M', src: 'riwayat', kode: 'RB999-KE921-B99-U12', freq: 10, isSet: true },
    { istilah: 'M', src: 'riwayat', kode: 'RB999-KE921-B99-U93', freq: 8, isSet: true }], { istilah: 'M', kode: 'RB999-KE921-B99-U12', isSet: true }));
});

test('bundle skenario: permintaan umum -> semua produk riwayat yang SIAP; yang belum siap/ada spesifikasi diminta tidak ikut', async () => {
  const mk = (kode, freq) => row({ istilah: 'SET MINOR', kode_produk: kode, nama_produk: 'Minor Set ' + kode, freq, is_set: true });
  const rpc = mockRpc({ 'SET MINOR': [mk('RB999-KE921-B99-U12', 11), mk('RB999-KE921-B99-U103', 4), mk('RB999-KE921-B99-U407', 3)] });
  const [it] = parseRequestText('SET MINOR\t2').items;
  const h = await resolveItem(it, rpc, { firmCheck: fcFrom({ 'RB999-KE921-B99-U407': ['AKD belum ada'] }) });
  assert.deepEqual(h.bundle.map(b => b.kode), ['RB999-KE921-B99-U12', 'RB999-KE921-B99-U103']); // U407 belum siap → tidak ditawarkan
  assert.ok(h.candidates.some(c => c.kode === 'RB999-KE921-B99-U407'));                          // tapi tetap tampil sebagai kandidat
  // tanpa firmCheck (Swasta): semua masuk
  assert.equal((await resolveItem(it, rpc)).bundle.length, 3);
  // permintaan spesifik (ada ukuran) -> bukan bundle
  const rpc2 = mockRpc({ 'PINSET DURA 14CM': [row({ istilah: 'PINSET DURA 14CM', kode_produk: 'P-1', nama_produk: 'Dura Forceps 14cm', freq: 12 }), row({ istilah: 'PINSET DURA 14CM', kode_produk: 'P-2', nama_produk: 'Dura Forceps 14cm B', freq: 9 })] });
  const [it2] = parseRequestText('PINSET DURA 14CM\t5').items;
  assert.equal((await resolveItem(it2, rpc2)).bundle, null);
});

test('nama produk SAMA PERSIS dengan permintaan (awalan ROBUST diabaikan) -> AUTO walau baru 1× dipakai / tier lemah', async () => {
  const nama = 'TENAC. FCPS., SCHROEDER, 1X1 T., 25.5 CM';
  const q = 'ROBUST ' + nama;
  const rpc = mockRpc({ [q]: [row({ istilah: q, tier: 'keluarga', kode_produk: 'RB32-KE622-B025-U07', nama_produk: nama, freq: 1 })] });
  const h = await resolveItem({ nama: q, qty: 1, specs: extractSpecs(q), variants: [q] }, rpc);
  assert.equal(h.status, 'AUTO'); assert.equal(h.reason_key, 'nama_persis');
  // dua produk bernama sama persis -> mesin tidak bisa memilih: bukan 'nama_persis'
  const rpc2 = mockRpc({ [q]: [row({ istilah: q, tier: 'keluarga', kode_produk: 'A-1', nama_produk: nama, freq: 1 }), row({ istilah: q, tier: 'keluarga', kode_produk: 'A-2', nama_produk: nama, freq: 1 })] });
  const h2 = await resolveItem({ nama: q, qty: 1, specs: extractSpecs(q), variants: [q] }, rpc2);
  assert.notEqual(h2.reason_key, 'nama_persis');
  // nama persis tapi belum siap -> tetap REVIEW belum_siap
  const h3 = await resolveItem({ nama: q, qty: 1, specs: extractSpecs(q), variants: [q] }, rpc, { firmCheck: fcFrom({ 'RB32-KE622-B025-U07': ['AKD belum ada'] }) });
  assert.equal(h3.status, 'REVIEW'); assert.equal(h3.reason_key, 'belum_siap');
});

test('sumber kompetitor memakai keputusan yang sama: riwayat kuat + ukuran cocok -> AUTO; hanya katalog -> REVIEW', async () => {
  const set = parseCompetitorSet(fx('falcon-appendectomy-hernia.txt'));
  const kelly = set.items.find(i => i.kode_kompetitor === '08-125-14');
  const kuat = mockRpc({ 'KELLY ARTERY FORCEPS 14 CM': [row({ istilah: 'KELLY', kode_produk: 'K-1', nama_produk: 'Kelly 14cm', ukuran: 'cocok', freq: 50 })] });
  assert.equal((await resolveItem(kelly, kuat, { queries: kelly.queries })).status, 'AUTO');
  const katalog = mockRpc({}, { 'KELLY ARTERY FORCEPS 14 CM': [{ kode_produk: 'K-9', nama_produk: 'FORCEPS, KELLY, 14 CM', tipe: 'INSTRUMENT' }] });
  assert.equal((await resolveItem(kelly, katalog, { queries: kelly.queries })).status, 'REVIEW');
});

// ───────────── FILTER FIRM / SINGLE USE ─────────────
// Salinan kecil S.parseLinkV6 (index.js) — resolver sengaja tidak mengimpor kode DOM.
const parseLinkV6 = (raw) => {
  const t = String(raw == null ? '' : raw).replace(/[\u00a0\u200b-\u200d\ufeff]/g, ' ').trim();
  if (!t) return { state: 'kosong' };
  if (/^https?:\/\/\S+$/i.test(t)) return { state: 'bersih' };
  const m = t.match(/https?:\/\/\S+/i);
  return m ? { state: 'catatan' } : { state: 'invalid' };
};
const U = 'https://katalog.inaproc.id/x';
// blok: kode -> 'ALASAN KERAS' (string) | ['kurang', ...] (bisa diperbaiki). Bentuk Map sama dengan hasil makeFirmCheck.
const fcFrom = (blok) => async (ks) => new Map(ks.filter(k => blok[k]).map(k => [k, Array.isArray(blok[k]) ? { keras: null, kurang: blok[k] } : { keras: blok[k], kurang: [] }]));
const AKD = ['AKD 20401012345'];

test('assessProduk: SINGLE USE = KERAS; belum firm / link kosong / tanpa AKD = BISA DIPERBAIKI; lengkap = OK', () => {
  const ok = assessProduk({ link_v6: U, akd: AKD }, parseLinkV6);
  assert.deepEqual(ok, { keras: null, kurang: [] });
  assert.deepEqual(assessProduk({ link_v6: 'SINGLE USE', akd: AKD }, parseLinkV6), { keras: 'SINGLE USE', kurang: [] }); // tanpa URL pun keras
  assert.equal(assessProduk({ link_v6: U + ' single-use', akd: AKD }, parseLinkV6).keras, 'SINGLE USE');
  assert.equal(assessProduk({ link_v6: U + ' UPDATE HARGA', akd: AKD }, parseLinkV6).keras, null);
  assert.match(assessProduk({ link_v6: U + ' UPDATE HARGA', akd: AKD }, parseLinkV6).kurang[0], /belum firm/);
  assert.deepEqual(assessProduk({ link_v6: '', akd: AKD }, parseLinkV6).kurang, ['link V6 belum dibuat']);
  assert.deepEqual(assessProduk({ link_v6: U, akd: [] }, parseLinkV6).kurang, ['AKD belum ada']);
  assert.deepEqual(assessProduk({ link_v6: U, akd: ['TIDAK ADA'] }, parseLinkV6).kurang, ['AKD belum ada']);   // placeholder = tidak punya AKD
  assert.deepEqual(assessProduk({ link_v6: U, akd: ['TIDAK ADA', 'AKD 1'] }, parseLinkV6).kurang, []);        // ada AKD asli → placeholder diabaikan
  assert.deepEqual(assessProduk({ link_v6: '', akd: [] }, parseLinkV6).kurang, ['link V6 belum dibuat', 'AKD belum ada']);
  assert.deepEqual(assessProduk({ link_v6: U }, parseLinkV6).kurang, ['AKD belum bisa dicek']);                // gagal tertutup
});

test('makeFirmCheck: hanya yang TIDAK OK masuk Map; batch + cache; kode hilang = keras; error tidak meracuni cache', async () => {
  let calls = 0, fail = false;
  const fc = makeFirmCheck({
    parseLinkV6, chunk: 2,
    fetchRows: async (ks) => { calls++; if (fail) throw new Error('HTTP 500'); return ks.filter(k => k !== 'HILANG').map(k => ({ kode_produk: k, link_v6: k === 'SU' ? 'SINGLE USE' : U, akd: k === 'NOAKD' ? [] : AKD })); }
  });
  const bl = await fc(['A', 'SU', 'HILANG', 'NOAKD', 'A']);
  assert.deepEqual([...bl.entries()], [
    ['SU', { keras: 'SINGLE USE', kurang: [] }],
    ['HILANG', { keras: 'tidak ada di katalog', kurang: [] }],
    ['NOAKD', { keras: null, kurang: ['AKD belum ada'] }]]);
  assert.equal(calls, 2);                       // 4 kode unik, chunk 2
  await fc(['A', 'SU']); assert.equal(calls, 2); // dari cache
  fail = true;
  await assert.rejects(() => fc(['BARU']), /HTTP 500/);
  fail = false;
  assert.equal((await fc(['BARU'])).size, 0);    // diulang berhasil: tidak ada sisa error di cache
});

test('resolver+firm: kandidat teratas SINGLE USE dibuang, sisanya dinilai — tidak boleh AUTO (ada yang dibuang)', async () => {
  const rpc = mockRpc({ 'GUNTING BENANG': [
    row({ istilah: 'GUNTING BENANG', kode_produk: 'S-1', nama_produk: 'Gunting Benang Sekali Pakai', freq: 10 }),
    row({ istilah: 'GUNTING BENANG', kode_produk: 'S-2', nama_produk: 'Gunting Benang', freq: 3 })] });
  const [it] = parseRequestText('GUNTING BENANG\t5').items;
  const h = await resolveItem(it, rpc, { firmCheck: fcFrom({ 'S-1': 'SINGLE USE' }) });
  assert.equal(h.kode_produk, 'S-2');
  assert.equal(h.status, 'REVIEW');
  assert.deepEqual(h.blocked.map(b => [b.kode, b.alasan]), [['S-1', 'SINGLE USE']]);
  assert.ok(!h.candidates.some(c => c.kode === 'S-1'));
});

test('resolver+firm: semua kandidat riwayat diblokir -> jatuh ke katalog (yang boleh dipakai), bukan berhenti', async () => {
  const rpc = mockRpc(
    { 'KLEM ARTERI': [row({ istilah: 'KLEM ARTERI', kode_produk: 'X-1', nama_produk: 'Klem Lama', freq: 9 })] },
    { 'KLEM ARTERI': [{ kode_produk: 'K-9', nama_produk: 'Artery Forceps 14cm', tipe: 'INSTRUMENT' }] });
  const [it] = parseRequestText('KLEM ARTERI\t2').items;
  const h = await resolveItem(it, rpc, { firmCheck: fcFrom({ 'X-1': 'belum firm (link V6 ada catatan)' }) });
  assert.equal(h.kode_produk, 'K-9'); assert.equal(h.status, 'REVIEW');
  assert.equal(h.blocked.length, 1);
});

test('resolver+firm: semua yang cocok diblokir -> UNKNOWN dengan alasan jelas (bukan "tidak ada")', async () => {
  const rpc = mockRpc({ 'BOR ORTHO': [row({ istilah: 'BOR ORTHO', kode_produk: 'RBP-KEO-1', nama_produk: 'Drill', freq: 4 })] });
  const [it] = parseRequestText('BOR ORTHO\t1').items;
  const h = await resolveItem(it, rpc, { firmCheck: fcFrom({ 'RBP-KEO-1': 'SINGLE USE' }) });
  assert.equal(h.status, 'UNKNOWN'); assert.equal(h.kode_produk, null);
  assert.match(h.reason, /RBP-KEO-1 \(SINGLE USE\)/); assert.doesNotMatch(h.reason, /Tidak ada di riwayat/);
});

test('resolver+firm: cek status gagal -> kandidat tetap tampil tapi TIDAK boleh AUTO (unverified)', async () => {
  const rpc = mockRpc({ 'PINSET DURA': [row({ istilah: 'PINSET DURA', kode_produk: 'P-1', nama_produk: 'Dura Forceps', freq: 12 })] });
  const [it] = parseRequestText('PINSET DURA\t5').items;
  const h = await resolveItem(it, rpc, { firmCheck: async () => { throw new Error('HTTP 401'); } });
  assert.equal(h.kode_produk, 'P-1'); assert.equal(h.status, 'REVIEW'); assert.equal(h.unverified, true);
});

test('resolver+siap: cocok KUAT tapi belum siap -> TETAP jadi usulan, REVIEW belum_siap (bukan AUTO, bukan hilang) + daftar kurang', async () => {
  const rpc = mockRpc({ 'PINSET DURA': [row({ istilah: 'PINSET DURA', kode_produk: 'P-1', nama_produk: 'Dura Forceps', freq: 12 })] });
  const [it] = parseRequestText('PINSET DURA\t5').items;
  const h = await resolveItem(it, rpc, { firmCheck: fcFrom({ 'P-1': ['AKD belum ada', 'link V6 belum dibuat'] }) });
  assert.equal(h.kode_produk, 'P-1');                 // tidak dibuang
  assert.equal(h.status, 'REVIEW'); assert.equal(h.reason_key, 'belum_siap');
  assert.deepEqual(h.siap, { ok: false, kurang: ['AKD belum ada', 'link V6 belum dibuat'] });
  assert.match(h.reason, /AKD belum ada, link V6 belum dibuat/);
  assert.equal(h.blocked.length, 0);                  // bukan blokir keras
  assert.deepEqual(h.candidates[0].siap.kurang, ['AKD belum ada', 'link V6 belum dibuat']); // kartu usulan bisa menampilkannya
});

test('resolver+siap: cocok kuat + siap tetap AUTO; keras dibuang sementara yang belum-siap tetap tampil sebagai kandidat', async () => {
  const rpc = mockRpc({ 'PINSET DURA': [row({ istilah: 'PINSET DURA', kode_produk: 'P-1', nama_produk: 'Dura Forceps', freq: 12 })] });
  const [it] = parseRequestText('PINSET DURA\t5').items;
  const h = await resolveItem(it, rpc, { firmCheck: fcFrom({}) });
  assert.equal(h.status, 'AUTO'); assert.deepEqual(h.siap, { ok: true, kurang: [] });
  const rpc2 = mockRpc({ 'GUNTING BENANG': [
    row({ istilah: 'GUNTING BENANG', kode_produk: 'S-1', nama_produk: 'Gunting Benang Sekali Pakai', freq: 10 }),
    row({ istilah: 'GUNTING BENANG', kode_produk: 'S-2', nama_produk: 'Gunting Benang', freq: 3 })] });
  const [it2] = parseRequestText('GUNTING BENANG\t5').items;
  const h2 = await resolveItem(it2, rpc2, { firmCheck: fcFrom({ 'S-1': 'SINGLE USE', 'S-2': ['AKD belum ada'] }) });
  assert.deepEqual(h2.blocked.map(b => b.kode), ['S-1']);          // keras: dibuang
  assert.ok(h2.candidates.some(c => c.kode === 'S-2' && !c.siap.ok)); // belum siap: tetap kandidat
  assert.notEqual(h2.status, 'AUTO');
});

test('resolver+firm: tanpa firmCheck (mode Swasta) perilaku lama tidak berubah; produk bersih tetap AUTO', async () => {
  const rpc = mockRpc({ 'PINSET DURA': [row({ istilah: 'PINSET DURA', kode_produk: 'P-1', nama_produk: 'Dura Forceps', freq: 12 })] });
  const [it] = parseRequestText('PINSET DURA\t5').items;
  assert.equal((await resolveItem(it, rpc)).status, 'AUTO');
  assert.equal((await resolveItem(it, rpc, { firmCheck: fcFrom({}) })).status, 'AUTO');
});
// ───────────── Relevansi hasil katalog: atribut cocok ≠ produk relevan ─────────────
test('katalog hanya memberi kecocokan SEBAGIAN (score < 0): istilah asing tidak disodori produk acak', async () => {
  const [it] = parseRequestText('KORENTANG LURUS 24CM\t1').items;
  const rpc = async (fn) => fn === 'suggest_dictionary' ? { data: [] } : { data: [
    { kode_produk: 'X1', nama_produk: 'RETRACTOR, STR., 24 CM', tipe: 'INSTRUMENT', score: -120 },
    { kode_produk: 'X2', nama_produk: 'PROBE, STR., 24 CM', tipe: 'INSTRUMENT', score: -130 }] };
  const h = await resolveItem(it, rpc);
  assert.equal(h.status, 'UNKNOWN');
  assert.equal(h.reason_key, 'tak_dikenal');
  assert.equal(h.kode_produk, null);
});

test('katalog: kecocokan penuh (score > 0) menang atas yang sebagian, dan yang sebagian dibuang', async () => {
  const [it] = parseRequestText('MAYO OPERATING SCISSORS STR BL/BL 17CM\t1').items;
  const rpc = async (fn, a) => fn === 'suggest_dictionary' ? { data: [] } : { data: /MAYO/.test(a.q)
    ? [{ kode_produk: 'J1', nama_produk: 'ATR. FCPS., DE BAKEY, STR. CVD., 17 CM', tipe: 'INSTRUMENT', score: -90 }]
    : [{ kode_produk: 'G1', nama_produk: 'OPERATING SCISSORS, BL/BL, STR., 17 CM', tipe: 'INSTRUMENT', score: 140 }] };
  const h = await resolveItem(it, rpc);
  assert.equal(h.kode_produk, 'G1');
  assert.ok(!h.candidates.some(c => c.kode === 'J1'));
});

// ───────────── Audit acak: AUTO yang tidak pernah diperiksa tidak boleh dianggap akurat ─────────────
import { auditPick } from './resolver.js';

const rpcAuto = () => mockRpc({ 'NEEDLEHOLDER 14.5 CM': [row({ istilah: 'NEEDLEHOLDER 14.5 CM', kode_produk: 'RB20-KE001-B014-U07', nama_produk: 'NEEDLEHOLDER, 14.5 CM', ukuran: 'cocok', freq: 10 })] });

test('audit: rate 0 -> AUTO tetap AUTO; rate 1 -> REVIEW audit_acak, usulan sama, alasan asli dicatat', async () => {
  const [it] = parseRequestText('NEEDLEHOLDER 14.5 CM\t1').items;
  const a = await resolveItem(it, rpcAuto());
  assert.equal(a.status, 'AUTO'); assert.equal(a.audit, false);
  const b = await resolveItem(it, rpcAuto(), { auditRate: 1 });
  assert.equal(b.status, 'REVIEW'); assert.equal(b.audit, true);
  assert.equal(b.reason_key, 'audit_acak'); assert.equal(b.reason_key_asli, 'riwayat_kuat');
  assert.equal(b.kode_produk, a.kode_produk);
});

test('audit: deterministik per teks, dan sebarannya mendekati rate', () => {
  assert.equal(auditPick('klem bengkok 14 cm', 0.3), auditPick('  KLEM BENGKOK 14 CM ', 0.3));
  let n = 0; for (let i = 0; i < 2000; i++) if (auditPick('item ' + i, 0.2)) n++;
  assert.ok(n > 300 && n < 500, 'dapat ' + n);
  assert.equal(auditPick('x', 0), false);
});

test('audit: hanya menyentuh AUTO — REVIEW dan UNKNOWN tidak ikut', async () => {
  const [it] = parseRequestText('SESUATU YANG ANEH 99CM\t1').items;
  const h = await resolveItem(it, mockRpc({}), { auditRate: 1 });
  assert.equal(h.audit, false); assert.notEqual(h.reason_key, 'audit_acak');
});