// crud-produk/bulk-parse.js
// Parsing murni untuk "Edit massal": baris TSV (hasil parsePasteLines) -> daftar kolom -> item siap kirim ke RPC.
// Tanpa DOM/Supabase supaya bisa diuji (bulk-parse.test.mjs).
//
// Aturan:
//   - Sel kosong TIDAK dikirim (= tidak diubah). Tidak ada token pengosong.
//   - Sel terisi tapi tidak valid / kurang informasi -> baris `errors` terisi, baris TIDAK dikirim, alasannya tampil di preview.
//   - Header: bila baris pertama memuat kolom kunci (mis. "Kode Produk") dianggap baris header dan SEMUA kolom ditentukan
//     header itu (round-trip Export -> sheet -> paste). Kalau bukan, kolom mengikuti chip yang dipilih (selectedKeys).
import { KEYS, attrByKey, resolveHeader } from './bulk-registry.js';

// Apakah baris pertama baris header? (minimal satu sel dikenali sebagai kolom kunci)
export function isHeaderRow(row, entity) {
  const first = row.map((c) => resolveHeader(c, entity));
  return first.some((h) => h.type === 'key');
}

// Susun daftar kolom dari baris header.
// -> { cols: [{ idx, type, def, text }], unknown: [text], derived: [text], missingKeys: [label], dupAttrs: [label] }
export function columnsFromHeader(row, entity) {
  const cols = [], unknown = [], derived = [], dupAttrs = [];
  const seen = new Set();
  row.forEach((cell, idx) => {
    const h = resolveHeader(cell, entity);
    if (h.type === 'blank') return;
    if (h.type === 'unknown') { unknown.push(h.text); return; }
    if (h.type === 'derived') { derived.push(h.text); cols.push({ idx, type: 'derived', def: h.def, text: h.text }); return; }
    const id = h.type + ':' + h.def.key;
    if (seen.has(id)) { dupAttrs.push(h.def.label); return; }
    seen.add(id);
    cols.push({ idx, type: h.type, def: h.def, text: h.text });
  });
  const have = new Set(cols.filter((c) => c.type === 'key').map((c) => c.def.key));
  const missingKeys = KEYS[entity].filter((k) => !have.has(k.key)).map((k) => k.label);
  return { cols, unknown, derived, missingKeys, dupAttrs };
}

// Susun daftar kolom dari chip terpilih (tanpa baris header): kunci dulu, lalu atribut sesuai urutan klik.
export function columnsFromSelection(selectedKeys, entity) {
  const cols = [];
  let idx = 0;
  KEYS[entity].forEach((k) => cols.push({ idx: idx++, type: 'key', def: k, text: k.label }));
  selectedKeys.forEach((key) => {
    const a = attrByKey(entity, key);
    if (a) cols.push({ idx: idx++, type: 'attr', def: a, text: a.label });
  });
  return { cols, unknown: [], derived: [], missingKeys: [], dupAttrs: [] };
}

// Cek lintas-kolom setelah semua sel baris dibaca (info kurang = gagal)
function crossCheck(entity, set, errors) {
  if (entity !== 'produk') return;
  if ('tahun' in set && !('harga_ekat' in set)) errors.push('Tahun Harga diisi tapi Harga E-Katalog kosong — tahun saja tidak mengubah apa pun');
  if ('keluarga' in set && 'tipe' in set && set.tipe !== 'SET') errors.push('Keluarga set hanya untuk tipe SET');
  if ('isi_set' in set && 'tipe' in set && set.tipe !== 'SET') errors.push('Isi set hanya untuk tipe SET');
  if ('berat_gram' in set && 'tipe' in set && set.tipe === 'SET') errors.push('Berat SET dihitung otomatis dari isi set — kosongkan kolom Berat');
}

// rows: baris DATA (tanpa header). modes: { akd:'tambah'|'timpa', gambar:..., brosur:..., isi_set:'gabung'|'timpa' }
// -> { items, metas, valid }
//   items : untuk RPC (hanya baris tanpa error)  [{ ord, kode_produk | no_akd+tipe_akd, set, mode }]
//   metas : per baris untuk preview [{ ord, line, kode, errors[], parsed:{ key:{ v, show } }, sent:bool }]
export function buildRows(rows, cols, entity, modes = {}, firstLine = 1) {
  const keyCols = cols.filter((c) => c.type === 'key');
  const attrCols = cols.filter((c) => c.type === 'attr');
  const metas = [];
  const seenKey = new Map(); // kunci -> [ord,...] untuk deteksi duplikat

  rows.forEach((row, i) => {
    const ord = i + 1;
    const errors = [];
    const parsed = {};
    const cell = (c) => (row[c.idx] == null ? '' : String(row[c.idx]).trim());

    // kolom lebih banyak dari header & berisi -> info ambigu, gagal
    const maxIdx = cols.reduce((m, c) => Math.max(m, c.idx), -1);
    if (row.slice(maxIdx + 1).some((x) => String(x || '').trim() !== '')) errors.push('Ada sel berisi di luar kolom header — kolom tidak sejajar?');

    // kunci
    const keyVals = {};
    for (const kc of keyCols) {
      const raw = cell(kc);
      if (!raw) { errors.push(`${kc.def.label} kosong`); continue; }
      if (kc.def.parse) {
        const r = kc.def.parse(raw);
        if (r.err) { errors.push(r.err); continue; }
        keyVals[kc.def.key] = r.v;
      } else keyVals[kc.def.key] = raw.replace(/\s+/g, ' ').trim();
    }

    // atribut
    const set = {};
    let adaIsi = false;
    for (const c of attrCols) {
      const raw = cell(c);
      if (!raw) continue; // kosong = tidak diubah
      adaIsi = true;
      const r = c.def.parse(raw);
      if (r.err) { errors.push(`${c.def.label}: ${r.err}`); continue; }
      set[c.def.key] = r.v;
      parsed[c.def.key] = r;
    }
    if (!adaIsi && !errors.length) errors.push('Semua sel atribut kosong — tidak ada yang diubah');
    crossCheck(entity, set, errors);

    const kode = entity === 'akd' ? [keyVals.no_akd, keyVals.tipe_akd].filter(Boolean).join(' · ') : (keyVals.kode_produk || '');
    const dupKey = entity === 'akd' ? (keyVals.no_akd && keyVals.tipe_akd ? (keyVals.no_akd + '|' + keyVals.tipe_akd).toLowerCase() : null) : (keyVals.kode_produk ? keyVals.kode_produk.toLowerCase() : null);
    if (dupKey) { if (!seenKey.has(dupKey)) seenKey.set(dupKey, []); seenKey.get(dupKey).push(ord); }

    metas.push({ ord, line: firstLine + i, kode, keyVals, errors, parsed, set, sent: false });
  });

  // duplikat di paste: SEMUA kemunculan gagal (tidak ada yang bisa dipastikan benar)
  for (const ords of seenKey.values()) {
    if (ords.length < 2) continue;
    ords.forEach((o) => {
      const m = metas[o - 1];
      m.errors.push(`Kunci muncul ${ords.length}× di paste (baris ke-${ords.join(', ')}) — sisakan satu`);
    });
  }

  const items = [];
  metas.forEach((m) => {
    if (m.errors.length) return;
    const mode = {};
    for (const c of attrCols) {
      if (c.def.kind === 'banyak' && c.def.key in m.set) mode[c.def.mode] = modes[c.def.mode] || c.def.modes[0];
    }
    const base = entity === 'akd'
      ? { ord: m.ord, no_akd: m.keyVals.no_akd, tipe_akd: m.keyVals.tipe_akd, set: m.set }
      : { ord: m.ord, kode_produk: m.keyVals.kode_produk, set: m.set, mode };
    items.push(base);
    m.sent = true;
  });
  return { items, metas, valid: items.length };
}

// Gabungkan hasil server (baris[]) ke metas. Baris yang tidak dikembalikan server -> error eksplisit.
// Hasil: tiap meta punya `status` (baru|ubah|sama|error), `diff`, `alasan`.
export function applyReport(metas, baris) {
  const byOrd = new Map((baris || []).map((b) => [b.ord, b]));
  metas.forEach((m) => {
    if (m.errors.length) { m.status = 'error'; m.alasan = m.errors.join(' · '); m.diff = null; return; }
    const b = byOrd.get(m.ord);
    if (!b) { m.status = 'error'; m.alasan = 'Server tidak mengembalikan hasil untuk baris ini'; m.diff = null; return; }
    m.status = b.status;
    m.alasan = b.alasan || null;
    m.diff = b.diff || {};
  });
  return metas;
}

export const hitungStatus = (metas) => metas.reduce((o, m) => { o[m.status] = (o[m.status] || 0) + 1; return o; }, { baru: 0, ubah: 0, sama: 0, error: 0 });

// TSV aman untuk sheet: sel yang berisi tab/newline/kutip dibungkus kutip.
export const tsvCell = (v) => { const s = v == null ? '' : String(v); return /[\t\n\r"]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
export const toTsv = (rows) => rows.map((r) => r.map(tsvCell).join('\t')).join('\n');