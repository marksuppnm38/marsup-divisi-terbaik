// Jalankan: node --test app/pages/konversian/auto-konversi/
import test from 'node:test';
import assert from 'node:assert/strict';
import { understand, compareAttrs, describeDiff, resolveItem, resolveItems, summarize, makeLexicon, loadLexicon, buildQueryLadder, parseRequestText } from './index.js';

// ───────────── UNDERSTAND: satu bentuk untuk semua sumber ─────────────
test('understand: deskripsi vendor & nama katalog sendiri menghasilkan atribut yang bisa dibandingkan', () => {
  const vendor = understand('MAYO OPERATING SCISSORS STR BL/BL 17CM.');
  const katalog = understand('OPERATING SCISSORS, SH/BL, STR., 16.5 CM');
  assert.equal(vendor.inti, 'MAYO OPERATING SCISSORS');
  assert.equal(katalog.inti, 'OPERATING SCISSORS');
  assert.deepEqual([vendor.attrs.ujung, vendor.attrs.orientasi, vendor.attrs.ukuran_cm], ['BL/BL', 'lurus', 17]);
  assert.deepEqual([katalog.attrs.ujung, katalog.attrs.orientasi, katalog.attrs.ukuran_cm], ['SH/BL', 'lurus', 16.5]);
  const fit = compareAttrs(vendor.attrs, katalog.attrs);
  assert.deepEqual(fit.beda, ['ujung']);
  assert.equal(fit.ukuran, 'dekat');
  assert.deepEqual(describeDiff(vendor.attrs, katalog.attrs, fit), ['ujung: minta BL/BL, produk SH/BL']);
});

test('understand: istilah Indonesia (tajam/tumpul, lurus, koma desimal) dinormalkan ke kode yang sama', () => {
  const a = understand('gunting tajam tumpul lurus 14,5 cm').attrs;
  assert.deepEqual([a.ujung, a.orientasi, a.ukuran_cm], ['SH/BL', 'lurus', 14.5]);
  assert.equal(understand('GUNTING BL/SH').attrs.ujung, 'SH/BL'); // urutan tidak membedakan
});

test('understand: "bengkok" = bentuk bila ada kata jenis, tapi NAMA produk bila berdiri sendiri', () => {
  const klem = understand('KLEM BENGKOK');
  assert.equal(klem.attrs.orientasi, 'bengkok'); assert.equal(klem.inti, 'KLEM');
  const sendiri = understand('BENGKOK');
  assert.equal(sendiri.attrs.orientasi, null); assert.equal(sendiri.inti, 'BENGKOK');
});

test('understand: kata yang tidak dikenal (korentang, babcock) tetap jadi inti nama, bukan hilang', () => {
  assert.equal(understand('KORENTANG 25 CM').inti, 'KORENTANG');
  assert.equal(understand('BABCOCK 16CM').inti, 'BABCOCK');
  assert.equal(understand('TISSUE FORCEPS 1:2 TEETH NARROW STR 14.5CM').attrs.gigi, '1:2');
  assert.deepEqual(understand('KELLY RETRACTOR 65 X 50MM 26CM').attrs.mm, [65, 50]);
  assert.equal(understand('SCALPEL HANDEL NO.3 12CM').attrs.nomor, 3);
});

test('compareAttrs: atribut yang tidak diminta tidak pernah jadi beda; tidak disebut kandidat = tak_ada (bukan beda)', () => {
  const f = compareAttrs(understand('GUNTING 14 CM').attrs, understand('SCISSORS, SH/BL, STR., 14 CM').attrs);
  assert.deepEqual(f.beda, []); assert.equal(f.ukuran, 'cocok');
  const g = compareAttrs(understand('GUNTING LURUS').attrs, understand('SCISSORS 14 CM').attrs);
  assert.deepEqual(g.beda, []); assert.deepEqual(g.tak_ada, ['orientasi']);
});

// ───────────── RESOLVER: atribut, tangga katalog, lexicon ─────────────
const cat = (kode, nama) => ({ kode_produk: kode, nama_produk: nama, tipe: 'INSTRUMENT' });
// rpc fleksibel: dictionary kosong; katalog dijawab fungsi (q) -> baris. Mencatat query katalog yang dicoba.
function rpcKatalog(fn, dict = {}) {
  const rpc = async (name, p) => {
    if (name === 'suggest_dictionary') return { data: dict[p.p_text] || [] };
    if (name === 'search_produk_dengan_harga') { rpc.q.push(p.q); return { data: fn(p.q) || [] }; }
    return { error: { message: 'rpc tak dikenal' } };
  };
  rpc.q = [];
  return rpc;
}
const hit = (q, kata) => kata.every((k) => q.toUpperCase().includes(k));

test('resolver: BL/BL diminta, katalog punya SH/BL dan BL/BL -> yang BL/BL dipilih, bukan baris pertama hasil pencarian', async () => {
  const rpc = rpcKatalog((q) => hit(q, ['OPERATING', 'SCISSORS']) && [
    cat('S-SHBL-165', 'OPERATING SCISSORS, SH/BL, STR., 16.5 CM'),
    cat('S-BLBL-17', 'OPERATING SCISSORS, BL/BL, STR., 17 CM')]);
  const [it] = parseRequestText('MAYO OPERATING SCISSORS STR BL/BL 17CM.\t1').items;
  const h = await resolveItem(it, rpc);
  assert.equal(h.kode_produk, 'S-BLBL-17');
  assert.equal(h.status, 'REVIEW'); assert.equal(h.reason_key, 'hanya_katalog'); // bukti cuma katalog, tapi spesifikasinya tidak beda
  assert.deepEqual(h.diff, []);
});

test('resolver: eponim vendor tidak ada di katalog -> tangga query membuang kata satu-satu sampai ketemu', async () => {
  const rpc = rpcKatalog((q) => (q.startsWith('OPERATING SCISSORS') ? [cat('S-1', 'OPERATING SCISSORS, BL/BL, STR., 17 CM')] : []));
  const [it] = parseRequestText('MAYO OPERATING SCISSORS STR BL/BL 17CM.\t1').items;
  const h = await resolveItem(it, rpc);
  assert.equal(h.kode_produk, 'S-1');
  assert.ok(rpc.q.length > 1, 'query pertama (asli) meleset, ada query berikutnya');
});

test('resolver: hanya ada SH/BL padahal diminta BL/BL -> REVIEW alasan atribut_beda yang menyebut ujung', async () => {
  const rpc = rpcKatalog((q) => hit(q, ['SCISSORS']) && [cat('S-1', 'OPERATING SCISSORS, SH/BL, STR., 17 CM')]);
  const [it] = parseRequestText('MAYO OPERATING SCISSORS STR BL/BL 17CM.\t1').items;
  const h = await resolveItem(it, rpc);
  assert.equal(h.status, 'REVIEW'); assert.equal(h.reason_key, 'atribut_beda');
  assert.match(h.reason, /ujung: minta BL\/BL, produk SH\/BL/);
  assert.equal(h.confidence, 'lemah');
});

test('resolver: riwayat kuat + dua ukuran sama dekat -> ukuran_seri dengan kedua ukuran disebut', async () => {
  const row = (o) => ({ istilah: 'GUNTING MAYO', tier: 'exact', skor: 1, ukuran: 'dekat', freq: 9, is_set: false, ...o });
  const rpc = rpcKatalog(() => [], { 'GUNTING MAYO 17 CM': [
    row({ kode_produk: 'RB11-KE102-B016-U07', nama_produk: 'OPERATING SCISSORS, BL/BL, STR., 16.5 CM' }),
    row({ kode_produk: 'RB11-KE102-B017-U07', nama_produk: 'OPERATING SCISSORS, BL/BL, STR., 17.5 CM' })] });
  const [it] = parseRequestText('GUNTING MAYO 17 CM\t1').items;
  const h = await resolveItem(it, rpc);
  assert.equal(h.status, 'REVIEW'); assert.equal(h.reason_key, 'ukuran_seri');
  assert.match(h.reason, /16\.5 dan 17\.5 cm/);
});

test('resolver: riwayat kuat tapi spesifikasi tampak beda — baru 1× dipakai -> REVIEW; ≥3× dipakai -> AUTO dengan catatan', async () => {
  const mk = (freq) => rpcKatalog(() => [], { 'GUNTING MAYO BL/BL': [
    { istilah: 'GUNTING MAYO BL/BL', tier: 'exact', skor: 1, ukuran: 'tidak_diminta', freq, is_set: false, kode_produk: 'S-1', nama_produk: 'OPERATING SCISSORS, SH/BL, STR., 17 CM' }] });
  const [it] = parseRequestText('GUNTING MAYO BL/BL\t1').items;
  const sekali = await resolveItem(it, mk(1));
  assert.equal(sekali.status, 'REVIEW'); assert.equal(sekali.reason_key, 'atribut_beda');
  const sering = await resolveItem(it, mk(5));
  assert.equal(sering.status, 'AUTO'); assert.equal(sering.reason_key, 'riwayat_berulang_beda_spek');
  assert.match(sering.reason, /ujung/);
});

test('resolver: riwayat kuat tanpa beda spesifikasi tidak menyentuh katalog sama sekali', async () => {
  const rpc = rpcKatalog(() => [{ kode_produk: 'X' }], { 'PINSET DURA': [
    { istilah: 'PINSET DURA', tier: 'exact', skor: 1, ukuran: 'tidak_diminta', freq: 12, is_set: false, kode_produk: 'P-1', nama_produk: 'Dura Forceps' }] });
  const [it] = parseRequestText('PINSET DURA\t5').items;
  const h = await resolveItem(it, rpc);
  assert.equal(h.status, 'AUTO'); assert.equal(rpc.q.length, 0);
});

// ───────────── LEXICON: istilah aneh dari riwayat ─────────────
test('lexicon: hanya entri yang cukup sering dan konsisten yang dipakai', () => {
  const lx = makeLexicon([
    { token: 'KORENTANG', kanonik: 'SPONGE HOLDING FORCEPS', n: 41, share: 0.93 },
    { token: 'JARANG', kanonik: 'X', n: 2, share: 1 },        // terlalu sedikit
    { token: 'CAMPUR', kanonik: 'Y', n: 30, share: 0.4 }]);   // tidak konsisten
  assert.equal(lx.size, 1);
  assert.equal(lx.lookup('korentang').kanonik, 'SPONGE HOLDING FORCEPS');
  assert.equal(lx.lookup('CAMPUR'), null);
});

test('lexicon: "KORENTANG 25 CM" tidak ada di Dictionary maupun nama katalog, tapi ketemu lewat kanonik hasil riwayat', async () => {
  const lx = makeLexicon([{ token: 'KORENTANG', kanonik: 'SPONGE HOLDING FORCEPS', n: 41, share: 0.93 }]);
  const rpc = rpcKatalog((q) => (q.startsWith('SPONGE HOLDING FORCEPS') ? [cat('SH-25', 'SPONGE HOLDING FORCEPS, STR., 25 CM')] : []));
  const [it] = parseRequestText('KORENTANG 25 CM\t2').items;
  const tanpa = await resolveItem(it, rpcKatalog(() => []));
  assert.equal(tanpa.status, 'UNKNOWN');
  const h = await resolveItem(it, rpc, { lexicon: lx });
  assert.equal(h.kode_produk, 'SH-25');
  assert.equal(h.lexicon_hits[0].token, 'KORENTANG');
});

test('lexicon: RPC belum ada / error -> lexicon kosong, tidak melempar', async () => {
  const lx = await loadLexicon(async () => ({ error: { message: 'function get_kamus_token does not exist' } }));
  assert.equal(lx.size, 0); assert.match(lx.error, /get_kamus_token/);
  assert.deepEqual(buildQueryLadder({ nama: 'KORENTANG 25 CM', variants: ['KORENTANG 25 CM'] }, null, lx), ['KORENTANG 25 CM', 'KORENTANG']);
});

test('tangga query: asli dulu, tanpa duplikat, dibatasi', () => {
  const [it] = parseRequestText('MAYO OPERATING SCISSORS STR BL/BL 17CM.\t1').items;
  const q = buildQueryLadder(it, it.understood, null);
  assert.equal(q[0], 'MAYO OPERATING SCISSORS STR BL/BL 17CM.');
  assert.equal(new Set(q).size, q.length); assert.ok(q.length <= 8);
  assert.deepEqual(q.slice(1, 3), ['MAYO OPERATING SCISSORS', 'OPERATING SCISSORS']); // tingkat keluarga (inti, lalu tanpa 'MAYO') lebih dulu dari yang beratribut
  assert.match(q.at(-1), /BL\/BL STR 17 CM$/); // yang beratribut paling akhir
});

test('summarize: rincian alasan per reason_key', async () => {
  const rpc = rpcKatalog(() => []);
  const res = await resolveItems(parseRequestText('KOM\t1\nZZZ\t1').items, rpc);
  const sm = summarize(res);
  assert.equal(sm.alasan.tak_ketemu, 2);
});

// ───────────── POLA NYATA DARI KATALOG & RIWAYAT ─────────────
test('understand: katalog gaya Jerman memakai MM untuk panjang ("PEAN FORCEPS CVD 140MM") -> sama dengan 14 cm', () => {
  const a = understand('PEAN FORCEPS CVD 140MM').attrs, b = understand('Klem pean 14 cm').attrs;
  assert.equal(a.ukuran_cm, 14); assert.deepEqual(a.mm, []);
  assert.equal(compareAttrs(b, a).ukuran, 'cocok');
  assert.equal(understand('DEAVER SURGICAL SCISSORS, CURVED, STANDARD, BLUNT/BLUNT, 145 MM (5 3/4INCHI)').attrs.ukuran_cm, 14.5);
});

test('understand: mm kecil (lebar bagian) tetap mm, bukan panjang; dua dimensi tidak dikonversi', () => {
  const a = understand('ROOT ELEV. BEIN LUX. 5 MM').attrs;
  assert.equal(a.ukuran_cm, null); assert.deepEqual(a.mm, [5]);
  assert.equal(understand('KELLY RETRACTOR 65 X 50MM').attrs.ukuran_cm, null);
});

test('understand: SHARP/SHARP, BLUNT/BLUNT, ANGLED seperti di katalog; ANGLED bukan CURVED', () => {
  assert.equal(understand('SCISSORS, BLUNT/BLUNT, CURVED, 14 CM').attrs.ujung, 'BL/BL');
  assert.equal(understand('SCISSORS SHARP/SHARP STRAIGHT').attrs.ujung, 'SH/SH');
  assert.equal(understand('VASCULAR CLAMP, ANGLED, 60°').attrs.orientasi, 'sudut');
  const f = compareAttrs(understand('KLEM CVD').attrs, understand('CLAMP, ANGLED').attrs);
  assert.deepEqual(f.beda, ['orientasi']);
});

test('understand: "bengkok sedang / besar" = nama produk (nierbekken), "klem bengkok" tetap bentuk', () => {
  for (const t of ['Bengkok sedang', 'BENGKOK BESAR', 'BENGKOK 20 CM', 'bengkok']) {
    const u = understand(t);
    assert.equal(u.attrs.orientasi, null, t); assert.ok(u.tokens.includes('BENGKOK'), t);
  }
  const g = understand('gunting bengkok tipis kecil');
  assert.equal(g.attrs.orientasi, 'bengkok'); assert.ok(!g.tokens.includes('BENGKOK'));
  assert.equal(understand('KLEM BENGKOK PANJANG').attrs.orientasi, 'bengkok');
});

test('resolver: pencarian teks mengembalikan banyak baris urut teks; yang atributnya cocok di baris ke-40 tetap ditemukan', async () => {
  const noise = Array.from({ length: 45 }, (_, i) => cat(`N-${i}`, `OPERATING SCISSORS, SH/SH, CVD., ${10 + i * 0.5} CM`));
  const rows = [...noise.slice(0, 40), cat('TARGET', 'OPERATING SCISSORS, BL/BL, STR., 17 CM'), ...noise.slice(40)];
  const rpc = rpcKatalog((q) => (q === 'OPERATING SCISSORS' ? rows : []));
  const [it] = parseRequestText('MAYO OPERATING SCISSORS STR BL/BL 17CM.\t1').items;
  const h = await resolveItem(it, rpc);
  assert.equal(h.kode_produk, 'TARGET'); assert.deepEqual(h.diff, []);
});

test('resolver: excludeItemId diteruskan ke suggest_dictionary (evaluasi leave-one-out); tanpa itu parameter tidak dikirim', async () => {
  const seen = [];
  const rpc = async (name, p) => { if (name === 'suggest_dictionary') seen.push(p); return { data: [] }; };
  const [it] = parseRequestText('PINSET DURA\t1').items;
  await resolveItem(it, rpc);
  await resolveItem({ ...it, excludeId: 4242 }, rpc);
  assert.ok(!('p_exclude_item' in seen[0])); assert.equal(seen.at(-1).p_exclude_item, 4242);
});

test('resolver: produk katalog dengan ukuran MM terbaca cocok untuk permintaan CM', async () => {
  const rpc = rpcKatalog((q) => hit(q, ['PEAN']) && [cat('RBB-KEH-B042', 'PEAN FORCEPS CVD 140MM')]);
  const [it] = parseRequestText('KLEM PEAN CVD 14 CM\t1').items;
  const h = await resolveItem(it, rpc);
  assert.equal(h.kode_produk, 'RBB-KEH-B042'); assert.equal(h.candidates[0].ukuran, 'cocok');
});
