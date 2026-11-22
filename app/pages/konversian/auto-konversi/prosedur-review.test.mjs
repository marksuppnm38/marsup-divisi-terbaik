import test from 'node:test';
import assert from 'node:assert/strict';
import { buatIndeks } from './prosedur.js';
import { ringkasProsedur, temuan, brandKosong, prefixKode, keTsv } from './prosedur-review.js';

const rows = (txt) => txt.trim().split('\n').map((l) => { const [kode, nama] = l.split('|'); return { kode, nama }; });

const MINI = rows(`RB1|MINOR S.
RB2|MINOR S. 3
RB3|MINOR BASIC S.
RB4|MINOR VAGINAL S.
RB5|MAYOR S.
RB6|MAYOR VAGINAL S. 2
RB7|BASIC MAYOR S.`);

test('ringkasProsedur: dikelompokkan prosedur -> kualifier, dengan hitungan tier & nomor', () => {
  const r = ringkasProsedur(buatIndeks(MINI));
  assert.equal(r.total, 7);
  assert.deepEqual(r.prosedur.map((p) => p.nama), ['MAYOR', 'MINOR']); // abjad
  const minor = r.prosedur.find((p) => p.nama === 'MINOR');
  assert.equal(minor.nSet, 4);
  assert.deepEqual(minor.kualifier.map((k) => k.kualifier), ['', 'VAGINAL']); // "umum" paling atas
  assert.deepEqual(minor.kualifier[0].tier, { standar: 2, basic: 1 });
  assert.deepEqual(minor.kualifier[0].nomor, [3, null]); // null (tanpa nomor) di belakang
  assert.deepEqual(minor.kualifier[0].anggota.map((a) => a.kode), ['RB3', 'RB2', 'RB1']); // urut tier (basic dulu), lalu nomor; tanpa nomor di belakang
});

test('ringkasProsedur: urut jumlah & indeks kosong/null tidak melempar', () => {
  assert.deepEqual(ringkasProsedur(buatIndeks(MINI), { urut: 'jumlah' }).prosedur.map((p) => p.nama), ['MINOR', 'MAYOR']);
  assert.deepEqual(ringkasProsedur(null), { total: 0, prosedur: [] });
  assert.deepEqual(ringkasProsedur(buatIndeks([])), { total: 0, prosedur: [] });
});

test('temuan: data bersih tidak menghasilkan tanda', () => {
  assert.deepEqual(temuan(ringkasProsedur(buatIndeks(MINI))), []);
});

test('temuan: mirip, kualifier panjang, kualifier = prosedur lain, inti kosong', () => {
  const idx = buatIndeks(rows(`A1|HERNIA S.
A2|HERNIAS S.
A3|MINOR S.
A4|MINOR GIGI TETAP BAWAH S.
A5|SECTIO S.
A6|LAPAROTOMY S.
A7|LAPAROTOMY SECTIO S.
A8|BASIC S.`));
  const t = temuan(ringkasProsedur(idx));
  const jenis = (j) => t.filter((x) => x.jenis === j);
  assert.deepEqual(jenis('mirip').map((x) => x.prosedur).sort(), ['HERNIA', 'HERNIAS']);
  assert.deepEqual(jenis('kualifier_panjang').map((x) => [x.prosedur, x.kualifier]), [['MINOR', 'GIGI TETAP BAWAH']]);
  assert.deepEqual(jenis('kualifier_prosedur').map((x) => [x.prosedur, x.kualifier]), [['LAPAROTOMY', 'SECTIO']]);
  assert.equal(jenis('inti_kosong').length, 1);
  assert.equal(jenis('inti_kosong')[0].prosedur, '');
});

test('temuan: nama pendek (MINOR/MAYOR) tidak saling dituduh mirip', () => {
  const t = temuan(ringkasProsedur(buatIndeks(MINI)));
  assert.equal(t.filter((x) => x.jenis === 'mirip').length, 0);
});

test('prefixKode: huruf awal + potongan berstrip, angka & sisanya dibuang', () => {
  assert.equal(prefixKode('AD-MO12'), 'AD-MO');
  assert.equal(prefixKode('ADPND5'), 'ADPND');
  assert.equal(prefixKode('rb999-U93'), 'RB');
  assert.equal(prefixKode('123'), '');
  assert.equal(prefixKode(null), '');
});

test('brandKosong: saran brand dari mayoritas prefix/keluarga; merek lain tanpa saran', () => {
  const brand = {};
  const kodes = [];
  const tambah = (k, b) => { kodes.push(k); brand[k] = b; };
  for (let i = 1; i <= 5; i++) tambah('AD' + i, 'ADLER');
  for (let i = 1; i <= 4; i++) tambah('RB' + i, 'ROBUST');
  ['AD-MO1', 'AD-MO2', 'AD-MO3', 'ADPND1', 'RB-CT1', 'RB-CT2'].forEach((k) => tambah(k, ''));
  ['SKY-1', 'SKY-2'].forEach((k) => tambah(k, ''));
  // keluarga campur 50:50 -> tidak ada saran
  for (let i = 1; i <= 3; i++) { tambah('XA' + i, 'ADLER'); tambah('XB' + i, 'ROBUST'); }
  tambah('XC1', '');
  const r = brandKosong(kodes, new Map(Object.entries(brand)));
  assert.equal(r.total, kodes.length);
  assert.equal(r.kosong, 9); // 3 AD-MO + 1 ADPND + 2 RB-CT + 2 SKY + 1 XC
  const g = (p) => r.grup.find((x) => x.prefix === p);
  assert.deepEqual([g('AD-MO').saran, g('AD-MO').dasar, g('AD-MO').n], ['ADLER', 'keluarga', 3]);
  assert.deepEqual([g('ADPND').saran, g('ADPND').n], ['ADLER', 1]);
  assert.deepEqual([g('RB-CT').saran, g('RB-CT').n], ['ROBUST', 2]);
  assert.equal(g('SKY').saran, null);
  assert.equal(g('XC').saran, null);
  // yang punya saran tampil duluan
  const iPertamaTanpa = r.grup.findIndex((x) => !x.saran);
  assert.ok(r.grup.slice(0, iPertamaTanpa).every((x) => x.saran));
  assert.ok(r.grup.slice(iPertamaTanpa).every((x) => !x.saran));
});

test('brandKosong: tidak ada brand kosong / masukan kosong', () => {
  assert.deepEqual(brandKosong([], new Map()), { total: 0, kosong: 0, grup: [] });
  assert.equal(brandKosong(['AD1'], { AD1: 'adler ' }).kosong, 0); // brand dinormalkan
  assert.equal(brandKosong(['AD1'], {}).kosong, 1);
});

test('keTsv: satu baris per set + header', () => {
  const tsv = keTsv(ringkasProsedur(buatIndeks(MINI))).split('\n');
  assert.equal(tsv.length, 8);
  assert.equal(tsv[0], 'prosedur\tkualifier\ttier\tnomor\tkode\tnama');
  assert.ok(tsv.some((l) => l === 'MAYOR\tVAGINAL\tstandar\t2\tRB6\tMAYOR VAGINAL S. 2'));
});
