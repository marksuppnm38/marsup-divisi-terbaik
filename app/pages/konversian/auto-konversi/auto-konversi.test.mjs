// Jalankan: node --test app/pages/konversian/auto-konversi/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseRequestText, parseLine, extractSpecs, parseCompetitorSet, resolveItem, resolveItems, summarize, isAmbiguous } from './index.js';

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

test('sumber kompetitor memakai keputusan yang sama: riwayat kuat + ukuran cocok -> AUTO; hanya katalog -> REVIEW', async () => {
  const set = parseCompetitorSet(fx('falcon-appendectomy-hernia.txt'));
  const kelly = set.items.find(i => i.kode_kompetitor === '08-125-14');
  const kuat = mockRpc({ 'KELLY ARTERY FORCEPS 14 CM': [row({ istilah: 'KELLY', kode_produk: 'K-1', nama_produk: 'Kelly 14cm', ukuran: 'cocok', freq: 50 })] });
  assert.equal((await resolveItem(kelly, kuat, { queries: kelly.queries })).status, 'AUTO');
  const katalog = mockRpc({}, { 'KELLY ARTERY FORCEPS 14 CM': [{ kode_produk: 'K-9', nama_produk: 'FORCEPS, KELLY, 14 CM', tipe: 'INSTRUMENT' }] });
  assert.equal((await resolveItem(kelly, katalog, { queries: kelly.queries })).status, 'REVIEW');
});
