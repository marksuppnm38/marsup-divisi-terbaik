// crud-produk/bulk-registry.js
// SATU sumber untuk "Edit massal" (bulk.js / bulk-edit.js): daftar atribut yang bisa ditempel, label (= label tabel /
// Export Excel), alias header, dan aturan baca tiap sel. Modul ini murni (tanpa DOM, tanpa Supabase) supaya bisa diuji.
//
// ATURAN DASAR (keputusan user):
//   - Sel KOSONG = jangan ubah. Tidak ada token pengosong; menghapus nilai dilakukan lewat form produk, bukan bulk.
//   - Informasi kurang / format salah = BARIS GAGAL dengan alasan yang jelas (tampil di preview), bukan dilewati diam-diam.
//   - Kolom turunan (dihitung sistem) di paste ditandai "turunan, diabaikan".
//
// parse(sel) -> { v: nilaiUntukServer, show: teksUntukPreview } | { err: 'alasan' }
import { parseLinkV6 } from './ui-utils.js';

export const TIPE_PRODUK = ['INSTRUMENT', 'SET', 'UNIT'];
export const TIPE_AKD = ['satuan', 'set', 'unit'];
export const KATEGORI_OK = ['SET', 'INSTRUMEN SATUAN', 'ELEKTROMEDIS', 'ALAT LABORATORIUM', 'PENUNJANG MEDIS', 'BMHP', 'UNIT'];

// huruf kecil, buang semua selain a-z0-9: "Link E-Katalog (V6)" -> "linkekatalogv6"
export const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '');

// ---------- pembaca nilai ----------
const ok = (v, show) => ({ v, show: show == null ? String(v) : show });
const bad = (err) => ({ err });
const rapi = (s) => String(s).replace(/\s+/g, ' ').trim();

// Angka gaya Indonesia/Inggris: "1.250.000", "1,250,000", "1.250,5", "1250.5"
export function parseAngka(raw) {
  let t = String(raw).replace(/[Rr][Pp]\.?/g, '').replace(/\s/g, '');
  if (!t || !/^[0-9.,]+$/.test(t)) return NaN;
  const d = t.includes('.'), k = t.includes(',');
  if (d && k) {
    const dec = t.lastIndexOf('.') > t.lastIndexOf(',') ? '.' : ',';
    const rib = dec === '.' ? ',' : '.';
    t = t.split(rib).join('').replace(dec, '.');
  } else if (d || k) {
    const sep = d ? '.' : ',';
    if (new RegExp('^\\d{1,3}(\\' + sep + '\\d{3})+$').test(t)) t = t.split(sep).join('');
    else if ((t.match(new RegExp('\\' + sep, 'g')) || []).length > 1) return NaN;
    else t = t.replace(sep, '.');
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

const BULAN = { januari: 1, februari: 2, maret: 3, april: 4, mei: 5, juni: 6, juli: 7, agustus: 8, september: 9, oktober: 10, november: 11, desember: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, agu: 8, agt: 8, ags: 8, sep: 9, okt: 10, nov: 11, des: 12 };
const iso = (y, m, d) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};
// YYYY-MM-DD | DD/MM/YYYY | DD-MM-YYYY | "10 Juli 2026"
export function parseTanggal(raw) {
  const t = rapi(raw).toLowerCase();
  let m;
  if ((m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return iso(+m[1], +m[2], +m[3]);
  if ((m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) return iso(+m[3], +m[2], +m[1]);
  if ((m = t.match(/^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/)) && BULAN[m[2]]) return iso(+m[3], BULAN[m[2]], +m[1]);
  return null;
}

const teks = (max = 2000) => (s) => { const t = rapi(s); return t.length > max ? bad(`Terlalu panjang (${t.length} > ${max} karakter)`) : ok(t); };
const huruf = (s) => ok(rapi(s).toUpperCase());
const tgl = (s) => { const d = parseTanggal(s); return d ? ok(d) : bad(`Tanggal "${rapi(s)}" tidak dikenali — pakai YYYY-MM-DD, DD/MM/YYYY, atau "10 Juli 2026"`); };
const daftar = (s) => [...new Set(String(s).split(';').map(rapi).filter(Boolean))];
const urlOk = (u) => /^https?:\/\/\S+$/i.test(u) && u.length <= 2048;

const pTipeProduk = (s) => {
  const t = rapi(s).toUpperCase();
  if (TIPE_PRODUK.includes(t)) return ok(t);
  return bad(`Tipe "${rapi(s)}" tidak dikenal — pakai INSTRUMENT, SET, atau UNIT`);
};
const pKodeAsli = (s) => {
  const t = rapi(s);
  if (t.length > 60) return bad('Kode asli lebih dari 60 karakter');
  if (/[\n\r$/]/.test(String(s)) || t.includes('..')) return bad('Kode asli mengandung karakter terlarang (\\ n r $ / ..)');
  if (t.toUpperCase() === 'TEMPLATE_THUMBNAIL_ROBUST') return bad('Kode asli "TEMPLATE_THUMBNAIL_ROBUST" tidak valid');
  return ok(t);
};
const pAngkaPositif = (nama, desimal) => (s) => {
  const n = parseAngka(s);
  if (!Number.isFinite(n)) return bad(`${nama} "${rapi(s)}" bukan angka`);
  if (n <= 0) return bad(`${nama} harus lebih dari 0`);
  if (!desimal && !Number.isInteger(n)) return bad(`${nama} harus bilangan bulat`);
  return ok(n, n.toLocaleString('id-ID'));
};
const pTahun = (s) => {
  const n = parseAngka(s);
  if (!Number.isInteger(n) || n < 2000 || n > 2100) return bad(`Tahun "${rapi(s)}" tidak valid (2000–2100)`);
  return ok(n);
};
const pAktif = (s) => {
  const t = rapi(s).toLowerCase();
  if (['ya', 'y', 'aktif', 'true', '1', 'yes'].includes(t)) return ok(true, 'Aktif');
  if (['tidak', 't', 'nonaktif', 'non aktif', 'non-aktif', 'false', '0', 'no'].includes(t)) return ok(false, 'Nonaktif');
  return bad(`Aktif "${rapi(s)}" tidak dikenal — pakai Ya atau Tidak`);
};
const pLink = (s) => {
  const L = parseLinkV6(s);
  if (L.state === 'bersih') return L.url.length <= 2048 ? ok(L.url) : bad('Link lebih dari 2048 karakter');
  if (L.state === 'catatan') return bad(`Link ada catatan "${L.catatan.slice(0, 40)}" — pisahkan dari URL`);
  return bad('Bukan URL (harus diawali http:// atau https://)');
};
const pKategori = (s) => {
  const t = rapi(s).toUpperCase();
  return KATEGORI_OK.includes(t) ? ok(t) : bad(`Kategori "${rapi(s)}" tidak dikenal — pilihan: ${KATEGORI_OK.join(', ')}`);
};
const pNoAkd = (s) => { const l = daftar(s); return l.length ? ok(l, l.join('; ')) : bad('Tidak ada No. AKD terbaca'); };
const pUrlList = (nama) => (s) => {
  const l = daftar(s);
  if (!l.length) return bad(`Tidak ada URL ${nama} terbaca`);
  const jelek = l.find((u) => !urlOk(u));
  return jelek ? bad(`${nama} bukan URL valid: "${jelek.slice(0, 50)}"`) : ok(l, l.join('; '));
};
// "RB-001 x2; RB-014 x1" — qty WAJIB eksplisit (tanpa qty = informasi kurang = gagal)
const pIsiSet = (s) => {
  const parts = daftar(s);
  if (!parts.length) return bad('Isi set kosong');
  const out = [], seen = new Set();
  for (const p of parts) {
    const m = p.match(/^(.+?)\s*[x×*]\s*(\d+)$/i);
    if (!m) return bad(`Isi set "${p.slice(0, 40)}" tidak terbaca — format: KODE x2; KODE x1 (qty wajib)`);
    const kode = m[1].trim(), qty = parseInt(m[2], 10);
    if (qty < 1) return bad(`Qty "${kode}" harus minimal 1`);
    if (seen.has(kode.toLowerCase())) return bad(`Kode "${kode}" muncul dua kali di isi set`);
    seen.add(kode.toLowerCase());
    out.push({ kode, qty });
  }
  return ok(out, out.map((x) => `${x.kode} x${x.qty}`).join('; '));
};
const pVerified = (s) => {
  const t = rapi(s).toLowerCase();
  if (['ya', 'y', 'true', '1', 'yes', 'verified'].includes(t)) return ok(true, 'Ya');
  return bad(`Verified "${rapi(s)}" tidak dikenal — hanya "Ya" yang bisa lewat bulk (mencabut badge lewat form produk)`);
};
const pTipeAkd = (s) => {
  const t = rapi(s).toLowerCase();
  return TIPE_AKD.includes(t) ? ok(t) : bad(`Tipe AKD "${rapi(s)}" tidak dikenal — pakai satuan, set, atau unit`);
};

// ---------- definisi atribut ----------
// key   : nama kunci yang dikirim ke RPC (di dalam `set`)
// label : label SAMA dengan tabel / Export Excel
// kind  : 'skalar' | 'banyak' (banyak nilai dalam satu sel, dipisah ';', punya mode tambah/timpa)
// mode  : nama kunci mode di RPC (hanya kind banyak); modes: pilihan yang tampil
// table : key kolom di TABLE_COLS (kolom-tabel.js) yang dicakup atribut ini (dipakai tes "cover semua")
// form  : id field form yang dicakup (f_*, m_*, k_*, md_*, a_*) — dipakai tes "cover semua"
const P = 'produk', A = 'akd';
export const ATTRS = [
  // Info dasar
  { entity: P, group: 'Info dasar', key: 'nama_produk', label: 'Nama Produk', aliases: ['nama'], kind: 'skalar', parse: teks(500), table: 'nama', form: ['f_nama_produk'] },
  { entity: P, group: 'Info dasar', key: 'tipe', label: 'Tipe', aliases: [], kind: 'skalar', parse: pTipeProduk, table: 'tipe', form: ['f_tipe'] },
  { entity: P, group: 'Info dasar', key: 'kode_asli', label: 'Kode asli', aliases: ['kodeasli'], kind: 'skalar', parse: pKodeAsli, form: ['f_kode_asli'] },
  { entity: P, group: 'Info dasar', key: 'brand', label: 'Brand', aliases: [], kind: 'skalar', parse: huruf, table: 'brand', form: ['f_brand'] },
  { entity: P, group: 'Info dasar', key: 'berat_gram', label: 'Berat (g)', aliases: ['berat gram', 'berat', 'beratgram'], kind: 'skalar', parse: pAngkaPositif('Berat', true), form: ['f_berat_gram'],
    catatan: 'Untuk SET berat dihitung otomatis dari isi set; kiriman untuk SET ditolak di server.' },
  { entity: P, group: 'Info dasar', key: 'spesifikasi', label: 'Spesifikasi', aliases: [], kind: 'skalar', parse: teks(4000), form: ['f_spesifikasi'] },
  { entity: P, group: 'Info dasar', key: 'is_active', label: 'Aktif', aliases: ['isactive'], kind: 'skalar', parse: pAktif, table: 'aktif', form: ['f_is_active'] },
  // Master (per kode asli)
  { entity: P, group: 'Master (kode asli)', key: 'deskripsi_vendor', label: 'Deskripsi vendor', aliases: [], kind: 'skalar', parse: teks(4000), form: ['m_deskripsi_vendor'],
    catatan: 'Butuh Kode asli (di baris ini atau yang sudah ada di produk).' },
  { entity: P, group: 'Master (kode asli)', key: 'family', label: 'Family', aliases: [], kind: 'skalar', parse: teks(200), form: ['m_family'],
    catatan: 'Butuh Kode asli (di baris ini atau yang sudah ada di produk).' },
  // Klasifikasi
  { entity: P, group: 'Klasifikasi', key: 'keluarga', label: 'Keluarga set', aliases: ['keluarga'], kind: 'skalar', parse: huruf, table: 'keluarga', form: ['f_klas_keluarga'],
    catatan: 'Hanya berlaku untuk tipe SET.' },
  { entity: P, group: 'Klasifikasi', key: 'kategori', label: 'Kategori', aliases: [], kind: 'skalar', parse: pKategori, table: 'kategori', form: ['f_klas_kategori'] },
  { entity: P, group: 'Klasifikasi', key: 'spes', label: 'Spesialisasi', aliases: ['spes'], kind: 'skalar', parse: huruf, table: 'spes', form: ['f_klas_spes'] },
  // Harga & link
  { entity: P, group: 'Harga & link', key: 'harga_ekat', label: 'Harga E-Katalog', aliases: ['harga ekat', 'hargaekat', 'ekat'], kind: 'skalar', parse: pAngkaPositif('Harga', false), table: 'ekat',
    catatan: 'Harga Swasta (×1,3) dan Upload (÷1,11) dihitung otomatis. Tahun kosong = tahun berjalan.' },
  { entity: P, group: 'Harga & link', key: 'tahun', label: 'Tahun Harga', aliases: ['tahun'], kind: 'skalar', parse: pTahun, table: 'tahun',
    catatan: 'Harus bersama Harga E-Katalog.' },
  { entity: P, group: 'Harga & link', key: 'link_v6', label: 'Link E-Katalog (V6)', aliases: ['link v6', 'linkv6', 'link'], kind: 'skalar', parse: pLink, table: 'link', form: ['f_link_v6'],
    catatan: 'Hanya URL bersih; link berisi catatan ditolak.' },
  // AKD
  { entity: P, group: 'AKD', key: 'no_akd', label: 'No. AKD', aliases: ['no akd', 'noakd'], kind: 'banyak', mode: 'akd', modes: ['tambah', 'timpa'], parse: pNoAkd, table: 'no_akd', form: ['f_no_akd'],
    catatan: 'Beberapa AKD dipisah ";". AKD dicari berdasar No. AKD + tipe produk (satuan/set/unit); yang tidak ketemu = baris gagal.' },
  // KFA (1:1 dengan produk)
  { entity: P, group: 'KFA', key: 'kode_kfa', label: 'Kode KFA', aliases: ['kfa'], kind: 'skalar', parse: teks(100), form: ['f_kode_kfa', 'k_kode_kfa'] },
  { entity: P, group: 'KFA', key: 'kode_cangkang', label: 'Kode cangkang', aliases: [], kind: 'skalar', parse: teks(100), form: ['f_kode_cangkang', 'k_kode_cangkang'] },
  { entity: P, group: 'KFA', key: 'nama_cangkang', label: 'Nama cangkang', aliases: [], kind: 'skalar', parse: teks(500), form: ['f_nama_cangkang', 'k_nama_cangkang'] },
  { entity: P, group: 'KFA', key: 'no_akd_rujukan', label: 'No. AKD rujukan', aliases: [], kind: 'skalar', parse: teks(200), form: ['k_no_akd_rujukan'] },
  { entity: P, group: 'KFA', key: 'tanggal_verifikasi', label: 'Tgl verifikasi', aliases: ['tanggal verifikasi', 'tglverifikasi'], kind: 'skalar', parse: tgl, form: ['k_tanggal_verifikasi'] },
  { entity: P, group: 'KFA', key: 'kfa_catatan', label: 'Catatan KFA', aliases: ['catatan'], kind: 'skalar', parse: teks(2000), form: ['k_catatan'] },
  // Media
  { entity: P, group: 'Media', key: 'gambar', label: 'Gambar (URL)', aliases: ['gambar'], kind: 'banyak', mode: 'gambar', modes: ['tambah', 'timpa'], parse: pUrlList('Gambar'), form: ['md_url', 'md_jenis', 'md_judul', 'md_urutan', 'md_primary'],
    catatan: 'URL pertama = utama bila timpa. Beberapa URL dipisah ";".' },
  { entity: P, group: 'Media', key: 'brosur', label: 'Brosur (URL)', aliases: ['brosur'], kind: 'banyak', mode: 'brosur', modes: ['tambah', 'timpa'], parse: pUrlList('Brosur') },
  // Komposisi
  { entity: P, group: 'Komposisi', key: 'isi_set', label: 'Isi set', aliases: ['isiset', 'komposisi'], kind: 'banyak', mode: 'isi_set', modes: ['gabung', 'timpa'], parse: pIsiSet,
    catatan: 'Format: KODE x2; KODE x1. Qty wajib. Hanya untuk tipe SET; set di dalam set ditolak.' },
  // Status
  { entity: P, group: 'Status', key: 'verified', label: 'Verified INAPROC', aliases: ['verified'], kind: 'skalar', parse: pVerified, table: 'verified', form: ['f_verified'],
    catatan: 'Hanya "Ya" (tandai manual). Mencabut badge lewat form produk.' },

  // ---- Entitas AKD (master) ----
  { entity: A, group: 'AKD', key: 'nama_akd', label: 'Nama AKD', aliases: [], kind: 'skalar', parse: teks(500), form: ['a_nama_akd'] },
  { entity: A, group: 'AKD', key: 'nama_database', label: 'Nama database', aliases: [], kind: 'skalar', parse: teks(500), form: ['a_nama_database'] },
  { entity: A, group: 'AKD', key: 'kode_set', label: 'Kode set', aliases: [], kind: 'skalar', parse: teks(200), form: ['a_kode_set'] },
  { entity: A, group: 'AKD', key: 'kategori_set', label: 'Kategori set', aliases: [], kind: 'skalar', parse: teks(200), form: ['a_kategori_set'] },
  { entity: A, group: 'AKD', key: 'penanda_kode', label: 'Penanda kode', aliases: [], kind: 'skalar', parse: teks(200), form: ['a_penanda_kode'] },
  { entity: A, group: 'AKD', key: 'golongan', label: 'Golongan', aliases: [], kind: 'skalar', parse: teks(100), form: ['a_golongan'],
    catatan: 'Produk terkait ikut di-sinkron otomatis.' },
  { entity: A, group: 'AKD', key: 'masa_berlaku', label: 'Masa berlaku', aliases: [], kind: 'skalar', parse: tgl, form: ['a_masa_berlaku'],
    catatan: 'Produk terkait ikut di-sinkron otomatis.' },
  { entity: A, group: 'AKD', key: 'tgl_maju_mas_munir', label: 'Tgl maju Mas Munir', aliases: ['tglmajumasmunir'], kind: 'skalar', parse: tgl, form: ['a_tgl_maju_mas_munir'] },
  { entity: A, group: 'AKD', key: 'status_terupdate', label: 'Status terupdate', aliases: [], kind: 'skalar', parse: teks(200), form: ['a_status_terupdate'] },
  { entity: A, group: 'AKD', key: 'link_dokumen', label: 'Link dokumen', aliases: [], kind: 'skalar', parse: (s) => { const t = rapi(s); return urlOk(t) ? ok(t) : bad('Link dokumen bukan URL (harus diawali http:// atau https://)'); }, form: ['a_link_dokumen'] },
  { entity: A, group: 'AKD', key: 'update_progres', label: 'Update progres', aliases: [], kind: 'skalar', parse: teks(2000), form: ['a_update_progres'] },
  { entity: A, group: 'Pemetaan upload', key: 'upload_kategori2', label: 'Upload kategori 2', aliases: [], kind: 'skalar', parse: teks(200) },
  { entity: A, group: 'Pemetaan upload', key: 'upload_kategori3', label: 'Upload kategori 3', aliases: [], kind: 'skalar', parse: teks(200) },
  { entity: A, group: 'Pemetaan upload', key: 'upload_kbki', label: 'Upload KBKI', aliases: [], kind: 'skalar', parse: teks(200) },
];

// Kolom KUNCI per entitas (selalu di depan, tidak bisa dihapus dari chip)
export const KEYS = {
  produk: [{ key: 'kode_produk', label: 'Kode Produk', aliases: ['kode', 'kodeproduk'] }],
  akd: [
    { key: 'no_akd', label: 'No. AKD', aliases: ['no akd', 'noakd'] },
    { key: 'tipe_akd', label: 'Tipe AKD', aliases: ['tipe', 'tipeakd'], parse: pTipeAkd },
  ],
};

// Kolom TURUNAN (dihitung sistem). Ditempel = ditandai "turunan, diabaikan". `table` = key TABLE_COLS yang dicakup.
// `aliases` mencakup label tabel + label Export Excel (xl) supaya round-trip Export -> paste balik tidak error.
export const DERIVED_PRODUK = [
  { label: 'Golongan', table: 'golongan' },
  { label: 'Jenis (instrumen)', aliases: ['jenis'], table: 'jenis' },
  { label: 'Sumber klasifikasi', aliases: ['sumber klasifikasi', 'klasifikasi perlu dicek'], table: 'klas_sumber' },
  { label: 'AKD', aliases: ['status akd'], table: 'akd' },
  { label: 'Nama AKD', table: 'nama_akd' },
  { label: 'Harga Swasta', aliases: ['harga upload'], table: 'swasta' },
  { label: 'Status INAPROC', table: 'status_inaproc' },
  { label: 'Stok', aliases: ['status stok', 'qty stok'], table: 'stok' },
  { label: 'Nilai Stok', table: 'nilai' },
  { label: 'Perlu dicek', table: 'flags' },
  { label: 'Terakhir Diubah', table: 'updated' },
  { label: 'No', aliases: ['no.', 'nomor', '#'] },
  { label: 'Alasan gagal', aliases: ['alasan', 'keterangan'] }, // kolom tambahan di file "Unduh baris error"
];
// Entitas AKD: kolom turunan = jumlah produk terkait dsb. (tidak ada di form) — hanya penanda umum.
export const DERIVED_AKD = [
  { label: 'Terakhir Diubah' }, { label: 'Dipetakan oleh', aliases: ['upload map by', 'uploadmapby'] }, { label: 'Dipetakan pada', aliases: ['upload map at', 'uploadmapat'] },
  { label: 'No', aliases: ['no.', 'nomor', '#'] },
  { label: 'Alasan gagal', aliases: ['alasan', 'keterangan'] },
];

// ---------- pencarian ----------
export const attrsOf = (entity) => ATTRS.filter((a) => a.entity === entity);
export const attrByKey = (entity, key) => ATTRS.find((a) => a.entity === entity && a.key === key) || null;

function indexFor(entity) {
  const idx = new Map();
  const put = (n, v) => { if (n && !idx.has(n)) idx.set(n, v); };
  KEYS[entity].forEach((k) => { [k.label, k.key, ...k.aliases].forEach((x) => put(norm(x), { type: 'key', def: k })); });
  attrsOf(entity).forEach((a) => { [a.label, a.key, ...a.aliases].forEach((x) => put(norm(x), { type: 'attr', def: a })); });
  (entity === 'akd' ? DERIVED_AKD : DERIVED_PRODUK).forEach((d) => { [d.label, ...(d.aliases || [])].forEach((x) => put(norm(x), { type: 'derived', def: d })); });
  return idx;
}
const INDEX = { produk: indexFor('produk'), akd: indexFor('akd') };

// -> { type:'key'|'attr'|'derived'|'blank'|'unknown', def?, text }
export function resolveHeader(cell, entity) {
  const text = rapi(cell == null ? '' : cell);
  if (!text) return { type: 'blank', text };
  const hit = INDEX[entity].get(norm(text));
  return hit ? { ...hit, text } : { type: 'unknown', text };
}

// Preset chip
export const PRESETS = {
  produk: [
    { id: 'harga_link', label: 'Harga & Link', keys: ['harga_ekat', 'tahun', 'link_v6'] },
    { id: 'info', label: 'Info dasar', keys: ['nama_produk', 'tipe', 'brand', 'kode_asli', 'berat_gram', 'spesifikasi'] },
    { id: 'klasifikasi', label: 'Klasifikasi', keys: ['kategori', 'spes', 'keluarga'] },
    { id: 'akd', label: 'AKD', keys: ['no_akd'] },
    { id: 'kfa', label: 'KFA', keys: ['kode_kfa', 'kode_cangkang', 'nama_cangkang', 'no_akd_rujukan', 'tanggal_verifikasi', 'kfa_catatan'] },
    { id: 'keluarga_set', label: 'Keluarga set', keys: ['tipe', 'nama_produk', 'keluarga', 'isi_set'] },
  ],
  akd: [
    { id: 'dokumen', label: 'Dokumen & masa berlaku', keys: ['masa_berlaku', 'golongan', 'link_dokumen', 'status_terupdate'] },
    { id: 'upload', label: 'Pemetaan upload', keys: ['upload_kategori2', 'upload_kategori3', 'upload_kbki'] },
  ],
};

// Pemetaan key TABLE_COLS (pilihan kolom tabel user) -> key atribut, untuk preset "Seperti tampilan tabel saya"
export function attrKeysFromTableCols(tableKeys) {
  const out = [];
  for (const tk of tableKeys) {
    const a = ATTRS.find((x) => x.entity === 'produk' && x.table === tk);
    if (a && !out.includes(a.key)) out.push(a.key);
  }
  return out;
}