// Jalankan: node --test app/pages/crud-produk/bulk-registry.test.mjs
// Menjamin "cover semua": setiap kolom tabel, kolom Export Excel, dan field form punya padanan chip ATAU penanda turunan.
// Kolom/field baru yang lupa didaftarkan di bulk-registry.js akan membuat tes ini gagal.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TABLE_COLS } from './kolom-tabel.js';
import { ATTRS, DERIVED_PRODUK, KEYS, resolveHeader, attrsOf, PRESETS, parseAngka, parseTanggal } from './bulk-registry.js';

const dir = new URL('.', import.meta.url);

test('setiap kolom TABLE_COLS punya chip atau penanda turunan', () => {
  const dicakup = new Set([
    ...ATTRS.filter((a) => a.entity === 'produk' && a.table).map((a) => a.table),
    ...DERIVED_PRODUK.filter((d) => d.table).map((d) => d.table),
    'kode', // kolom kunci
  ]);
  const hilang = TABLE_COLS.map((c) => c.key).filter((k) => !dicakup.has(k));
  assert.deepEqual(hilang, [], 'kolom tabel tanpa padanan bulk: ' + hilang.join(', '));
});

test('label tabel & SEMUA label Export Excel dikenali sebagai header (round-trip)', () => {
  const tak = [];
  for (const c of TABLE_COLS) {
    for (const lbl of [c.label, ...(c.xl || []).map((x) => x.label)]) {
      const h = resolveHeader(lbl, 'produk');
      if (!['key', 'attr', 'derived'].includes(h.type)) tak.push(lbl);
    }
  }
  assert.deepEqual(tak, [], 'header tak dikenal: ' + tak.join(', '));
});

test('label tabel yang editable menunjuk atribut yang benar', () => {
  for (const c of TABLE_COLS) {
    const a = ATTRS.find((x) => x.entity === 'produk' && x.table === c.key);
    if (!a) continue;
    const h = resolveHeader(c.label, 'produk');
    assert.equal(h.type, 'attr', c.label);
    assert.equal(h.def.key, a.key, c.label);
  }
});

test('setiap field form (produk, master, KFA, media, AKD) punya chip atau dikecualikan', () => {
  const markup = fs.readFileSync(new URL('markup.js', dir), 'utf8');
  const ids = [...new Set([...markup.matchAll(/id="((?:f|m|k|md|a)_[A-Za-z0-9_]+)"/g)].map((m) => m[1]))];
  // bukan atribut yang ditulis lewat bulk: kunci, datalist, kolom turunan di form
  const kecuali = new Set(['f_kode_produk', 'f_brand_list', 'f_klas_keluarga_list', 'f_golongan', 'f_masa_berlaku', 'a_tipe_akd', 'a_no_akd']);
  const dicakup = new Set(ATTRS.flatMap((a) => a.form || []));
  const hilang = ids.filter((id) => !kecuali.has(id) && !dicakup.has(id));
  assert.deepEqual(hilang, [], 'field form tanpa chip: ' + hilang.join(', '));
});

test('tidak ada alias bentrok dalam satu entitas', () => {
  for (const ent of ['produk', 'akd']) {
    const seen = new Map();
    for (const a of attrsOf(ent)) {
      assert.equal(new Set(attrsOf(ent).map((x) => x.key)).size, attrsOf(ent).length);
      const h = resolveHeader(a.label, ent);
      assert.equal(h.def.key, a.key, `${ent}:${a.label}`);
      seen.set(a.key, 1);
    }
  }
});

test('kolom kunci terdaftar & preset hanya memuat atribut yang ada', () => {
  assert.equal(KEYS.produk[0].key, 'kode_produk');
  assert.deepEqual(KEYS.akd.map((k) => k.key), ['no_akd', 'tipe_akd']);
  for (const [ent, list] of Object.entries(PRESETS)) {
    for (const p of list) for (const k of p.keys) assert.ok(attrsOf(ent).some((a) => a.key === k), `${ent}/${p.id}/${k}`);
  }
});

test('parseAngka: format Indonesia & Inggris', () => {
  assert.equal(parseAngka('1.250.000'), 1250000);
  assert.equal(parseAngka('1,250,000'), 1250000);
  assert.equal(parseAngka('1.250,5'), 1250.5);
  assert.equal(parseAngka('1250.5'), 1250.5);
  assert.equal(parseAngka('Rp 1.500.000'), 1500000);
  assert.ok(Number.isNaN(parseAngka('abc')));
  assert.ok(Number.isNaN(parseAngka('1.2.3')));
});

test('parseTanggal', () => {
  assert.equal(parseTanggal('2026-07-10'), '2026-07-10');
  assert.equal(parseTanggal('10/07/2026'), '2026-07-10');
  assert.equal(parseTanggal('10 Juli 2026'), '2026-07-10');
  assert.equal(parseTanggal('31/02/2026'), null);
  assert.equal(parseTanggal('besok'), null);
});