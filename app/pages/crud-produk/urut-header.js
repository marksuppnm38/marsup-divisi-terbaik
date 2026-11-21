// crud-produk/urut-header.js
// Menu di header kolom tabel Produk (gaya Sheets): klik judul kolom -> urutkan + saring.
//
// Menu ini HANYA pintu masuk. Tidak ada sistem filter kedua: pilihan filter dari menu memakai state yang sama
// (produkActiveFilters, chip yang sama, jalur export yang sama) dengan popover "+ Tambah Filter". Yang baru di sini:
//   - state urutan (satu kolom, naik / turun / mati),
//   - pembanding urutan di client (baris kosong SELALU di bawah, apa pun arahnya),
//   - pasangan nilai "Sudah diisi" / "Belum diisi" untuk kolom yang filternya belum punya.
//
// Bagian murni (tanpa DOM) dipisah dari kontrol menu supaya bisa diuji: node --test app/pages/crud-produk/urut-header.test.mjs
import { klasOf } from './klasifikasi.js';

// ---------- urutan ----------
// field = kolom di tabel `produk` (dipakai .order() di server); jenis menentukan label arah dan cara membandingkan.
// klas = nilainya dibaca dari klasifikasi (kolom kategori / spes di tabel produk), bukan dari baris list biasa.
// Kategori & Spesialisasi diurutkan menurut KODE di database (sama di server dan di client), bukan label tampilan.
export const KOLOM_URUT = {
  kode:           { field: 'kode_produk',    jenis: 'teks' },
  nama:           { field: 'nama_produk',    jenis: 'teks' },
  tipe:           { field: 'tipe',           jenis: 'teks' },
  golongan:       { field: 'golongan',       jenis: 'teks' },
  brand:          { field: 'brand',          jenis: 'teks' },
  status_inaproc: { field: 'status_inaproc', jenis: 'teks' },
  aktif:          { field: 'is_active',      jenis: 'bool' },
  updated:        { field: 'updated_at',     jenis: 'tgl' },
  kategori:       { field: 'kategori',       jenis: 'teks', klas: true },
  spes:           { field: 'spes',           jenis: 'teks', klas: true },
};

// [label naik, label turun]
export const LABEL_ARAH = {
  teks: ['Urutkan A → Z', 'Urutkan Z → A'],
  bool: ['Nonaktif dulu', 'Aktif dulu'],
  tgl:  ['Terlama dulu', 'Terbaru dulu'],
};

export const adalahKolomUrut = (key) => Object.prototype.hasOwnProperty.call(KOLOM_URUT, key);
export const urutButuhKlas = (sort) => !!sort && adalahKolomUrut(sort.key) && !!KOLOM_URUT[sort.key].klas;

/** Teks pendek buat chip / judul export: "Nama Produk (A → Z)". */
export function deskripsiUrut(sort, labelKolom) {
  if (!sort || !adalahKolomUrut(sort.key)) return '';
  const jenis = KOLOM_URUT[sort.key].jenis;
  const arah = jenis === 'teks' ? (sort.dir === 'desc' ? 'Z → A' : 'A → Z')
    : jenis === 'tgl' ? (sort.dir === 'desc' ? 'terbaru dulu' : 'terlama dulu')
    : (sort.dir === 'desc' ? 'aktif dulu' : 'nonaktif dulu');
  return `${labelKolom || sort.key} (${arah})`;
}

/** Nilai yang dibandingkan untuk satu baris. null = kosong (selalu di bawah). */
export function nilaiUrut(row, key) {
  const def = KOLOM_URUT[key];
  if (!def || !row) return null;
  if (def.klas) {
    const e = klasOf(row.id);
    const v = e ? e[key] : null; // entri klasifikasi memakai nama yang sama: kategori / spes
    return v == null || String(v).trim() === '' ? null : String(v);
  }
  const v = row[def.field];
  if (def.jenis === 'bool') return v ? 1 : 0;
  if (def.jenis === 'tgl') { const t = v ? new Date(v).getTime() : NaN; return Number.isFinite(t) ? t : null; }
  const s = v == null ? '' : String(v).trim();
  return s === '' ? null : s;
}

const teksBanding = (a, b) => String(a).localeCompare(String(b), 'id');

/** Pembanding stabil: kosong selalu di bawah (naik maupun turun); seri diputuskan kode produk lalu id. */
export function bandingkan(a, b, sort) {
  const va = nilaiUrut(a, sort.key), vb = nilaiUrut(b, sort.key);
  if (va == null && vb != null) return 1;
  if (va != null && vb == null) return -1;
  if (va != null && vb != null && va !== vb) {
    const c = typeof va === 'number' ? va - vb : teksBanding(va, vb);
    if (c !== 0) return sort.dir === 'desc' ? -c : c;
  }
  return teksBanding(a.kode_produk || '', b.kode_produk || '') || teksBanding(a.id ?? '', b.id ?? '');
}

/** Salinan terurut; tanpa urutan (atau kolom tak dikenal) -> array yang sama. */
export function urutkan(rows, sort) {
  if (!sort || !adalahKolomUrut(sort.key)) return rows;
  return [...rows].sort((a, b) => bandingkan(a, b, sort));
}

/** Urutan berikutnya saat memilih arah di menu. Memilih arah yang sudah aktif = mematikan (seperti Sheets). */
export function ubahUrut(sortNow, key, dir) {
  if (!adalahKolomUrut(key)) return sortNow || null;
  if (sortNow && sortNow.key === key && sortNow.dir === dir) return null;
  return { key, dir };
}

// ---------- "Sudah diisi" / "Belum diisi" ----------
// Nilai khusus untuk filter yang nilainya berupa teks (checkbox / tombol butuh string). NILAI_KOSONG sama dengan BRAND_NONE
// di index.js, jadi filter "Tanpa brand" lama dan "Belum diisi" adalah satu hal yang sama.
export const NILAI_ISI = '__ISI__';
export const NILAI_KOSONG = '__NONE__';
export const LABEL_ISI = 'Sudah diisi';
export const LABEL_KOSONG = 'Belum diisi';

// Dimensi yang nilainya teks bebas dan mendapat pasangan Sudah / Belum diisi di sistem filter yang ada.
// (Harga & Link V6 sudah punya pasangan sendiri: 'ada' / 'kosong'; menu header cukup mengarahkannya ke sana.)
export const DIM_TEKS_ISI = { golongan: 'golongan', brand: 'brand', status_inaproc: 'status_inaproc' };

/** Pilihan "Sudah diisi" / "Belum diisi" yang ditaruh paling atas opsi dimensi teks. */
export const opsiIsi = () => [
  { value: NILAI_ISI, label: LABEL_ISI, chip: LABEL_ISI },
  { value: NILAI_KOSONG, label: LABEL_KOSONG, chip: LABEL_KOSONG },
];

/** true / false kalau filter ini pasangan Sudah / Belum diisi pada dimensi teks; null kalau bukan (pakai pencocok biasa). */
export function cocokIsi(row, filt) {
  const field = DIM_TEKS_ISI[filt.dim];
  if (!field || (filt.value !== NILAI_ISI && filt.value !== NILAI_KOSONG)) return null;
  const terisi = String(row[field] ?? '').trim() !== '';
  return filt.value === NILAI_ISI ? terisi : !terisi;
}

/**
 * Filter ini TIDAK bisa dikerjakan RPC get_produk_list (ia menganggap nilainya teks biasa: p_golongan = '__NONE__' -> 0 baris).
 * Satu-satunya yang dikenal RPC adalah brand "kosong". Selebihnya lewat jalur langsung ke tabel produk (daftar-langsung.js).
 */
export function butuhJalurLangsung(filt) {
  if (!filt) return false;
  if (filt.value === NILAI_ISI) return filt.dim in DIM_TEKS_ISI;
  if (filt.value === NILAI_KOSONG) return filt.dim in DIM_TEKS_ISI && filt.dim !== 'brand';
  return false;
}

// ---------- apa yang ditawarkan menu tiap kolom ----------
// dim   = kunci dimensi di PRODUK_FILTER_DIMS (state filter yang sama).
// pasang = pasangan [nilai, label] "ada / kosong" kalau dimensi itu punya pasangan sendiri.
//          dimensi teks (DIM_TEKS_ISI) memakai opsiIsi().
export const KOLOM_MENU = {
  kode:           { },
  nama:           { },
  tipe:           { dim: 'tipe' },
  golongan:       { dim: 'golongan', teksIsi: true },
  keluarga:       { dim: 'keluarga' },
  kategori:       { dim: 'kategori' },
  spes:           { dim: 'spes' },
  brand:          { dim: 'brand', teksIsi: true },
  link:           { dim: 'link_v6', pasang: [['ada', 'Sudah diisi'], ['kosong', 'Belum diisi']] },
  ekat:           { dim: 'harga', pasang: [['ada', 'Sudah ada harga'], ['kosong', 'Belum ada harga']] },
  swasta:         { dim: 'harga', pasang: [['ada', 'Sudah ada harga'], ['kosong', 'Belum ada harga']] },
  tahun:          { dim: 'harga', pasang: [['ada', 'Sudah ada harga'], ['kosong', 'Belum ada harga']] },
  status_inaproc: { dim: 'status_inaproc', teksIsi: true },
  stok:           { dim: 'stok' },
  aktif:          { dim: 'is_active' },
  updated:        { },
};
export const punyaMenuHeader = (key) => Object.prototype.hasOwnProperty.call(KOLOM_MENU, key) && (adalahKolomUrut(key) || !!KOLOM_MENU[key].dim);

/** Pasangan [nilai, label] yang ditampilkan menu untuk kolom ini ([] kalau tidak ada). */
export function pasanganMenu(key) {
  const m = KOLOM_MENU[key];
  if (!m) return [];
  if (m.pasang) return m.pasang;
  if (m.teksIsi) return [[NILAI_ISI, LABEL_ISI], [NILAI_KOSONG, LABEL_KOSONG]];
  return [];
}

// ---------- kontrol menu (DOM) ----------
/**
 * Menu kecil di bawah judul kolom. Semua perubahan state dilakukan lewat callback index.js:
 *   getSort() / setSort(sort|null)          urutan
 *   getFilters()                            produkActiveFilters (dibaca saja)
 *   labelKolom(key)                         judul kolom
 *   setFilter(dim, value, label)            pasang filter lewat addProdukFilter yang ada
 *   removeFilter(dim)                       lewat removeProdukFilter yang ada
 *   openValuePicker(dim)                    buka popover "+ Tambah Filter" langsung di dimensi itu
 */
export function createHeaderMenu(h) {
  let el = null, cleanup = null;

  function tutup() {
    if (cleanup) { cleanup(); cleanup = null; }
    if (el && el.parentNode) el.parentNode.removeChild(el);
    el = null;
  }

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  function buka(key, anchor) {
    if (el && el.dataset.col === key) { tutup(); return; } // klik judul yang sama lagi = tutup
    tutup();
    const sort = h.getSort();
    const menu = KOLOM_MENU[key] || {};
    const filters = h.getFilters();
    const aktif = menu.dim ? filters.find((f) => f.dim === menu.dim) : null;
    const items = [];

    if (adalahKolomUrut(key)) {
      const [lbNaik, lbTurun] = LABEL_ARAH[KOLOM_URUT[key].jenis];
      const on = (dir) => !!sort && sort.key === key && sort.dir === dir;
      items.push(`<button type="button" class="thm-item${on('asc') ? ' on' : ''}" data-act="sort" data-dir="asc"><i class="ti ti-sort-ascending"></i><span>${esc(lbNaik)}</span>${on('asc') ? '<i class="ti ti-check thm-check"></i>' : ''}</button>`);
      items.push(`<button type="button" class="thm-item${on('desc') ? ' on' : ''}" data-act="sort" data-dir="desc"><i class="ti ti-sort-descending"></i><span>${esc(lbTurun)}</span>${on('desc') ? '<i class="ti ti-check thm-check"></i>' : ''}</button>`);
    }

    const pasang = pasanganMenu(key);
    const adaFilterBagian = pasang.length || menu.dim;
    if (items.length && adaFilterBagian) items.push('<div class="thm-sep" role="separator"></div>');
    pasang.forEach(([nilai, label]) => {
      const on = !!aktif && aktif.value === nilai;
      items.push(`<button type="button" class="thm-item${on ? ' on' : ''}" data-act="pasang" data-value="${esc(nilai)}" data-label="${esc(label)}"><i class="ti ti-filter"></i><span>${esc(label)}</span>${on ? '<i class="ti ti-check thm-check"></i>' : ''}</button>`);
    });
    if (menu.dim) items.push(`<button type="button" class="thm-item" data-act="nilai"><i class="ti ti-list-check"></i><span>Pilih nilai…</span></button>`);
    if (aktif) items.push(`<button type="button" class="thm-item thm-danger" data-act="hapus-filter"><i class="ti ti-filter-off"></i><span>Hapus filter kolom ini</span></button>`);
    if (!items.length) return;

    el = document.createElement('div');
    el.className = 'th-menu-pop';
    el.setAttribute('role', 'menu');
    el.dataset.col = key;
    el.innerHTML = `<div class="thm-title">${esc(h.labelKolom(key))}</div>${items.join('')}`;
    document.body.appendChild(el);

    // Posisi: tepat di bawah tombol judul; kalau melewati tepi kanan layar, rata kanan ke tombol.
    const r = anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    const kiri = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    el.style.left = kiri + 'px';
    el.style.top = Math.round(r.bottom + 4) + 'px';

    el.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('.thm-item');
      if (!b) return;
      e.stopPropagation();
      const act = b.dataset.act;
      tutup();
      if (act === 'sort') h.setSort(ubahUrut(h.getSort(), key, b.dataset.dir));
      else if (act === 'pasang') {
        if (aktif && aktif.value === b.dataset.value) h.removeFilter(menu.dim); // klik pilihan yang sedang aktif = lepas
        else h.setFilter(menu.dim, b.dataset.value, b.dataset.label);
      }
      else if (act === 'nilai') h.openValuePicker(menu.dim);
      else if (act === 'hapus-filter') h.removeFilter(menu.dim);
    });

    const onDoc = (e) => { if (el && !el.contains(e.target) && !(e.target.closest && e.target.closest('.th-btn'))) tutup(); };
    const onKey = (e) => { if (e.key === 'Escape') tutup(); };
    const onScrollResize = () => tutup();
    document.addEventListener('mousedown', onDoc, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onScrollResize);
    window.addEventListener('scroll', onScrollResize, true);
    cleanup = () => {
      document.removeEventListener('mousedown', onDoc, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onScrollResize);
      window.removeEventListener('scroll', onScrollResize, true);
    };
  }

  return { buka, tutup, destroy: tutup };
}
