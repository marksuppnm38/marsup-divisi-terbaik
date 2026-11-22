import test from 'node:test';
import assert from 'node:assert/strict';
import { buatIndeks, uraiNama } from './prosedur.js';
import { resolveItem } from './resolver.js';
import { parseRequestText } from './parser.js';

// Nama set nyata (cuplikan hasil query v_produk_keluarga) — brand TIDAK dipakai di sini.
const SAMPLE = `RB999-U93|MINOR S.
RB999-U681|MINOR S. 10
RB999-U103|MINOR S. 3
RB999-U407|MINOR S. 6
RB999-U12|MINOR BASIC S.
RB999-U340|MINOR BASIC S. 2
AD999-U61|MINOR INST S.
RB999-U711|MINOR INST. S. 6
AD999-U48|MINOR KIT AS
RB999-U670|MINOR ANAK S.
RB999-U95|MINOR VAGINAL S.
RB999-U499|MINOR SURGERY (OPHTALMOLOGY) S.
AD999-U34|BASIC MINOR AS.
RB999-U518|BASIC MINOR IBS S.
RB999-U302|BASIC MINOR INFANT S.
RB999-U591|BASIC MINOR MATA (MINOR EYE) S.
RB999-U718|BASIC MINOR THT S.
AD999-U76|BASIC MINOR DENTAL AS.
RB999-U176|BASIC REKONSTRUKSI MINOR S.
RB999-U177|BASIC REKONSTRUKSI MINOR S. 2
RB999-U02|MAYOR S.
RB999-U69|MAYOR S. 3
RB999-U453|MAYOR S. 10
RB999-U23|MAYOR VAGINAL S.
RB999-U91|MAYOR VAGINAL S. 2
RB999-U301|BASIC MAYOR PEDIATRIC S.
RB999-U517|BASIC MAYOR IBS S.
AD999-U73|BASIC MAYOR AS.
AD999-U62|MAYOR INST S.
RB999-U506|MAYOR INST S. 2
AD999-U59|MAYOR KIT AS. 2
RB999-U699|MAYOR BASIC INST S. 2
RB999-U89|LAPAROTOMY S. 2
RB999-U101|LAPAROTOMY S. 3
RB999-U450|LAPARATOMY S. 4
RB999-U469|LAPARATOMY S. 6
RB999-U152|BASIC LAPARATOMY S.
AD999-U77|BASIC LAPAROTOMY AS.
AD999-U01|LAPAROTOMY AS.
RB999-U342|LAPAROTOMY PEDIATRIC S.
AD999-U74|BASIC LAPAROTOMY PEDIATRIC AS.
RB999-U28|LAPARATOMY ANAK S.
AD999-U03|LAPARATOMY ANAK AS.
RB999-U370|LAPAROTOMY SC S.
RB999-U689|LAPAROTOMY SURGERY S. 2
RB999-U708|LAPAROTOMY SURGERY INSTS. S.
RB999-U181|MINI LAPARATOMY S. 2 (OBGYN)
RB999-U22|TRACHEOSTOMY S.
RB999-U106|TRACHEOSTOMY S. 3
RB999-U71|Traceotomy S. 2
RB999-U707|TRACHEOSTOMY INST. S.
RB999-U171|CATARACT S. 2
RB999-U344|CATARACT S. 3
RB999-U684|CATARACT INST. S.
RB999-U153|BASIC CATARACT S.
AD999-U78|BASIC CATARACT AS.
RB999-U210|BASIC PACHO (CATARACT) S.
RB999-U352|BASIC PACHO S. 2
RB999-U685|PACHO INST. S.
RB999-U15|CURETTAGE S.
RB999-U135|CURETTAGE S. 2
AD999-U66|CURETTAGE AS. 2
AD999-U28|BASIC CURETTAGE AS.
RB999-U77|CURETTAGE & DILATATION S. 2
RB999-U375|CURETTAGE & DILATATION S. 3
AD999-U25|BASIC CURETTAGE AND DILATATION AS.
RB999-U185|DILATATION S.
RB999-U261|DILATATION S. 2
RB999-U04|SECTIO CAESAREAN S.
RB999-U65|SECTIO CAESAREAN S. 2
RB999-U343|SECTIO CAESAREAN AKRETA S.
RB999-U257|BASIC SECTIO CAESAREAN AKRETA S.
AD999-U35|BASIC SECTIO CAESAREAN AS.
RB999-U471|SECTIO CAESAREAN INSTRUMENTS S.
RB999-U698|SC INST. S.
RB999-U544|STERIL SC S.
RB999-U128|TOCOLOGIST S. 2
RB999-U314|TOCOLOGY S. 3
RB999-U125|BASIC TOCOLOGY S.
RB999-U06|HERNIA S.
AD999-U60|HERNIA S.
RB999-U510|HERNIA S. 2
RB999-U133|HERNIA & APPENDIX S.
RB999-U139|BASIC HERNIA & APPENDIX S.
RB999-U07|APPENDIX S.
RB999-U17|CIRCUMSISI S.
AD999-U23|BASIC CIRCUMCISION AS.
RB999-U10|HECTING S.
RB999-U83|HECTING S. 2
AD999-U30|HECTING AS.
AD999-U46|BASIC HECTING AS.
RB999-U170|BASIC HORDEOLUM S.
RB999-U148|HORDEOLUM S.
RB999-U682|HORDEOLUM INST. S.`.split('\n').map((l) => { const [kode, nama] = l.split('|'); return { kode, nama }; });
const SINONIM = { CIRCUMSISI: 'CIRCUMCISION', TOCOLOGIST: 'TOCOLOGY', PACHO: 'CATARACT', SC: 'SECTIO CAESAREAN' };
const idx = buatIndeks(SAMPLE, SINONIM);
const kunciDari = (nama) => idx.info(SAMPLE.find((r) => r.nama === nama).kode).kunci;

test('uraiNama: nomor, tier, kata jenis, kurung', () => {
  assert.deepEqual(uraiNama('MINOR S. 10'), { nomor: 10, tier: 'standar', toks: ['MINOR'], extra: [] });
  assert.equal(uraiNama('BASIC CATARACT AS.').tier, 'basic');
  assert.equal(uraiNama('MINOR INST. S. 6').tier, 'inst');
  assert.deepEqual(uraiNama('MINOR SURGERY (OPHTALMOLOGY) S.').extra, ['OPHTALMOLOGY']);
  assert.deepEqual(uraiNama('SET MINOR').toks, ['MINOR']);
});

test('MINOR umum tidak membawa MAYOR / kualifier / spesialis', () => {
  const m = idx.cari('SET MINOR');
  assert.equal(m.kunci, 'MINOR');
  const nama = idx.anggota('MINOR').map((x) => x.nama);
  assert.ok(nama.includes('MINOR S.') && nama.includes('MINOR BASIC S. 2') && nama.includes('MINOR INST S.'));
  assert.ok(nama.every((n) => !/MAYOR|VAGINAL|THT|MATA|DENTAL|IBS|INFANT|ANAK|REKONSTRUKSI|OPHTALMOLOGY/.test(n)), nama.join(' | '));
  assert.equal(kunciDari('MINOR VAGINAL S.'), 'MINOR + VAGINAL');
  assert.equal(kunciDari('BASIC MINOR THT S.'), 'MINOR + THT');
  assert.equal(kunciDari('MINOR SURGERY (OPHTALMOLOGY) S.'), 'MINOR + OPHTALMOLOGY');
  assert.equal(kunciDari('BASIC REKONSTRUKSI MINOR S.'), 'MINOR + REKONSTRUKSI');
});

test('MAYOR: S. 1..n satu prosedur, MAYOR VAGINAL prosedur+kualifier sendiri', () => {
  assert.equal(idx.cari('MAYOR').kunci, 'MAYOR');
  assert.equal(idx.cari('MAYOR VAGINAL').kunci, 'MAYOR + VAGINAL');
  assert.deepEqual(idx.anggota('MAYOR + VAGINAL').map((x) => x.nomor).sort(), [null, 2].sort());
  assert.equal(kunciDari('BASIC MAYOR IBS S.'), 'MAYOR + IBS');
});

test('ejaan & sinonim: typo dilebur otomatis, sinonim dari data', () => {
  assert.equal(kunciDari('LAPARATOMY S. 4'), kunciDari('LAPAROTOMY S. 2'));     // typo (edit distance)
  assert.equal(kunciDari('Traceotomy S. 2'), kunciDari('TRACHEOSTOMY S.'));     // typo (edit distance)
  assert.equal(kunciDari('CIRCUMSISI S.'), kunciDari('BASIC CIRCUMCISION AS.')); // sinonim (data)
  assert.equal(kunciDari('TOCOLOGIST S. 2'), kunciDari('TOCOLOGY S. 3'));
  assert.equal(kunciDari('BASIC PACHO S. 2'), kunciDari('CATARACT S. 2'));
  assert.equal(kunciDari('SC INST. S.'), kunciDari('SECTIO CAESAREAN S.'));
  assert.equal(kunciDari('LAPAROTOMY SC S.'), 'LAPAROTOMY + SECTIO CAESAREAN'); // kepala nama menang
  assert.equal(idx.cari('SC').kunci, 'SECTIO CAESAREAN');
  // tanpa sinonim: tidak dilebur (sinonim memang harus datang dari data)
  const polos = buatIndeks(SAMPLE, {});
  assert.notEqual(polos.info(SAMPLE.find((r) => r.nama === 'BASIC PACHO S. 2').kode).kunci, polos.info(SAMPLE.find((r) => r.nama === 'CATARACT S. 2').kode).kunci);
});

test('gabungan "A & B" tetap satu prosedur; permintaan yang tidak dikenal -> null', () => {
  assert.equal(kunciDari('CURETTAGE & DILATATION S. 2'), 'CURETTAGE & DILATATION');
  assert.equal(kunciDari('BASIC CURETTAGE AND DILATATION AS.'), 'CURETTAGE & DILATATION');
  assert.equal(kunciDari('HERNIA & APPENDIX S.'), 'HERNIA & APPENDIX');
  assert.equal(idx.cari('KORENTANG'), null);
});

// ── resolver: bundel dari prosedur ──
const row = (o) => ({ istilah: 'X', tier: 'exact', skor: 1, ukuran: 'tidak_diminta', freq: 10, is_set: true, ...o });
const rpcDict = (rows) => async (fn) => (fn === 'suggest_dictionary' ? { data: rows, error: null } : { data: [], error: null });
test('bundel "MINOR" = semua set se-prosedur (bukan cuma riwayat), tanpa MAYOR/kualifier, 1 brand', async () => {
  const peta = { 'RB999-U93': 'ROBUST', 'RB999-U103': 'ROBUST', 'RB999-U12': 'ROBUST', 'RB999-U340': 'ROBUST', 'RB999-U407': 'ROBUST', 'RB999-U681': 'ROBUST',
    'AD999-U61': 'ADLER', 'AD999-U48': 'ADLER', 'RB999-U711': 'ROBUST', 'AD999-U34': 'ADLER' };
  // riwayat Dictionary "MINOR": 2 minor + substitusi MAYOR + minor vaginal (semua exact)
  const rpc = rpcDict([
    row({ istilah: 'MINOR', kode_produk: 'RB999-U93', nama_produk: 'MINOR S.', freq: 11 }),
    row({ istilah: 'MINOR', kode_produk: 'RB999-U12', nama_produk: 'MINOR BASIC S.', freq: 6 }),
    row({ istilah: 'MINOR', kode_produk: 'RB999-U02', nama_produk: 'MAYOR S.', freq: 4 }),
    row({ istilah: 'MINOR', kode_produk: 'RB999-U95', nama_produk: 'MINOR VAGINAL S.', freq: 3 })]);
  const it = parseRequestText('MINOR\t1').items[0];
  const brandOf = async (ks) => new Map(ks.map((k) => [k, peta[k] || (k.startsWith('AD') ? 'ADLER' : 'ROBUST')]));
  const h = await resolveItem(it, rpc, { prosedur: idx, brand: 'ROBUST', brandOf });
  const kodes = h.bundle.map((b) => b.kode);
  assert.ok(['RB999-U93', 'RB999-U103', 'RB999-U12', 'RB999-U340', 'RB999-U407', 'RB999-U681', 'RB999-U711'].every((k) => kodes.includes(k)), kodes.join());
  assert.ok(!kodes.includes('RB999-U02') && !kodes.includes('RB999-U95'));       // MAYOR & MINOR VAGINAL tidak ikut
  assert.ok(kodes.every((k) => k.startsWith('RB')));                              // 1 brand
  assert.equal(h.prosedur.kunci, 'MINOR');
});
