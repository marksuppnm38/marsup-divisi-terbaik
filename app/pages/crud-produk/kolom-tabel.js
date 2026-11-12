// crud-produk/kolom-tabel.js
// Kolom tabel list Produk yang bisa diatur sendiri: pilih kolom apa yang tampil, atur urutannya,
// atau pakai preset ("Harga & Link", "AKD lengkap", dst). Pilihan disimpan per browser (localStorage).
//
// Pola sama dengan copy.js: tanpa state global index.js. Semua yang butuh data/helper index.js
// dioper lewat `helpers`. Modul ini hanya tahu cara menggambar header, sel baris, dan popover pilihan.
//
// Kolom "Kode Produk" selalu tampil dan selalu pertama: kotak pilih (checkbox salin) dan penanda
// "baru diubah" menempel di sel itu. Tombol "Salin" di ujung baris juga selalu ada.
//
// Sumber data TIDAK diduplikasi:
//   - kolom yang ada di baris list (kode, nama, tipe, golongan, link_v6, status_inaproc, is_active, updated_at)
//     dibaca langsung dari baris yang sudah dimuat loadProduk()
//   - harga & No. AKD: cache milik copy.js (helpers.extraOf / helpers.akdNoOf), sudah dimuat sebelum render
//   - stok: helpers.stokCell (cache stok index.js)
//   - Nama AKD (deskripsi AKD): satu-satunya data baru, diambil modul ini sendiri HANYA kalau kolomnya tampil.
import { parseLinkV6, sembunyikanAkdPlaceholder } from './ui-utils.js';

const LS_KEY = 'pnm_crud_produk_tbl_cols_v1';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const dash = '<span class="stok stok-none">—</span>';
const rupiah = (v) => (v == null || v === '' || !Number.isFinite(Number(v))) ? dash : 'Rp ' + Number(v).toLocaleString('id-ID');
const tglPendek = (iso) => {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return dash;
  return `<span title="${esc(d.toLocaleString('id-ID'))}">${esc(d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }))}</span>`;
};

// ctx tiap sel: { h: helpers, x: harga/AKD (atau null), akdNama: [{no, nama}], flags: html "Perlu dicek" }
// td: kelas tambahan sel; num: rata kanan angka; locked: tidak bisa disembunyikan/dipindah.
export const TABLE_COLS = [
  { key: 'kode', label: 'Kode Produk', locked: true, td: 'kode-cell',
    render: (p, c) => `${c.h.selBox(p)}${esc(p.kode_produk)}${c.h.btn('kode', 'Salin kode produk')}${c.h.recent(p.updated_at)}` },
  { key: 'nama', label: 'Nama Produk', td: 'nama-cell',
    render: (p, c) => `${esc(p.nama_produk || '—')}${c.h.btn('nama', 'Salin nama produk')}${c.h.verified(p.id)}` },
  { key: 'tipe', label: 'Tipe', td: 'tipe-cell',
    render: (p) => esc(p.tipe || '—') },
  { key: 'golongan', label: 'Golongan', td: 'tipe-cell',
    render: (p, c) => p.golongan ? `${esc(p.golongan)}${c.h.btn('golongan', 'Salin golongan')}` : '—' },
  { key: 'akd', label: 'AKD', td: 'akd-cell',
    render: (p, c) => `${c.h.seal(p)}${c.h.akdNoOf(p.id).length ? c.h.btn('akd', 'Salin No. AKD') : ''}` },
  { key: 'no_akd', label: 'No. AKD', td: 'mono-cell',
    render: (p, c) => { const l = c.h.akdNoOf(p.id); return l.length ? `<span title="${esc(l.join(', '))}">${esc(l.join(', '))}</span>${c.h.btn('akd', 'Salin No. AKD')}` : '—'; } },
  { key: 'nama_akd', label: 'Nama AKD', td: 'wrap-cell', needs: 'akdNama',
    render: (p, c) => c.akdNama.length ? c.akdNama.map((a) => `<div title="${esc(a.no)}">${esc(a.nama || a.no)}</div>`).join('') : '—' },
  { key: 'ekat', label: 'Harga E-Katalog', num: true, td: 'harga-cell',
    render: (p, c) => { const v = c.x && c.x.ekatalog; return rupiah(v) + (v != null ? c.h.btn('ekat', 'Salin harga E-Katalog') : ''); } },
  { key: 'swasta', label: 'Harga Swasta', num: true, td: 'harga-cell',
    render: (p, c) => { const v = c.x && c.x.swasta; return rupiah(v) + (v != null ? c.h.btn('swasta', 'Salin harga swasta') : ''); } },
  { key: 'tahun', label: 'Tahun Harga', td: 'tipe-cell',
    render: (p, c) => (c.x && c.x.tahun != null) ? esc(c.x.tahun) : '—' },
  { key: 'link', label: 'Link E-Katalog (V6)', td: 'link-cell',
    render: (p, c) => {
      const l = parseLinkV6(p.link_v6);
      if (l.state === 'kosong') return '—';
      if (!l.url) return `<span class="link-bad" title="${esc(l.catatan)}">Bukan URL</span>`;
      const label = l.url.replace(/^https?:\/\//i, '');
      return `<a class="link-v6" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" title="${esc(p.link_v6)}">${esc(label)}</a>${c.h.btn('link', 'Salin link V6')}`;
    } },
  { key: 'status_inaproc', label: 'Status INAPROC', td: 'tipe-cell',
    render: (p) => esc(p.status_inaproc || '—') },
  { key: 'stok', label: 'Stok', num: true,
    render: (p, c) => c.h.stokCell(p.id) },
  { key: 'flags', label: 'Perlu dicek', td: 'flag-cell',
    render: (p, c) => c.flags },
  { key: 'aktif', label: 'Aktif', td: 'tipe-cell',
    render: (p) => p.is_active ? 'Aktif' : '<span class="flag flag-mute">Nonaktif</span>' },
  { key: 'updated', label: 'Terakhir Diubah', td: 'tipe-cell',
    render: (p) => tglPendek(p.updated_at) },
];
const COL_BY_KEY = Object.fromEntries(TABLE_COLS.map((c) => [c.key, c]));
const MOVABLE = TABLE_COLS.filter((c) => !c.locked).map((c) => c.key);

export const COL_PRESETS = [
  { id: 'standar', label: 'Standar', cols: ['nama', 'tipe', 'akd', 'stok', 'flags'] },
  { id: 'harga', label: 'Harga & Link', cols: ['nama', 'ekat', 'swasta', 'link'] },
  { id: 'akd', label: 'AKD lengkap', cols: ['nama', 'no_akd', 'nama_akd', 'status_inaproc'] },
];
const DEFAULT_VISIBLE = COL_PRESETS[0].cols;

// state = { order: [key...] (semua kolom non-locked, termasuk yang disembunyikan), visible: Set }
function defaultState() { return orderFrom(DEFAULT_VISIBLE); }
function orderFrom(visibleKeys) {
  const vis = visibleKeys.filter((k) => MOVABLE.includes(k));
  return { order: [...vis, ...MOVABLE.filter((k) => !vis.includes(k))], visible: new Set(vis) };
}
function readState() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (raw && Array.isArray(raw.order) && Array.isArray(raw.visible)) {
      const seen = raw.order.filter((k, i) => MOVABLE.includes(k) && raw.order.indexOf(k) === i);
      // kolom baru (ditambah di versi kode berikutnya) otomatis masuk di ujung, tersembunyi
      const order = [...seen, ...MOVABLE.filter((k) => !seen.includes(k))];
      return { order, visible: new Set(raw.visible.filter((k) => MOVABLE.includes(k))) };
    }
  } catch { /* storage diblok / isi rusak -> default */ }
  return defaultState();
}

/**
 * opts: {
 *   sb, headRow (<tr> di <thead>), tableBody,
 *   helpers: { selBox(p), btn(key,label), recent(updatedAt), verified(id), seal(p), akdNoOf(id) -> [no],
 *              stokCell(id), moreCell(p) },
 *   onChange(): dipanggil setelah pilihan kolom berubah (index.js menggambar ulang header + baris)
 * }
 */
export function createTableColumns(opts) {
  const { sb, headRow, tableBody, helpers: h, onChange } = opts;
  let state = readState();
  const akdNamaCache = new Map(); // produk_id -> [{ no, nama }]
  let pop = null, popAnchor = null, popCleanup = null;

  const save = () => {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ order: state.order, visible: [...state.visible] })); } catch { /* abaikan */ }
  };
  const visibleCols = () => [COL_BY_KEY.kode, ...state.order.filter((k) => state.visible.has(k)).map((k) => COL_BY_KEY[k])];

  // Klik link V6 jangan ikut membuka modal edit baris (listener klik per-baris ada di index.js).
  const onLinkClick = (e) => { if (e.target.closest && e.target.closest('a.link-v6')) e.stopPropagation(); };
  tableBody.addEventListener('click', onLinkClick, true);

  // ---------- data tambahan: Nama AKD ----------
  async function loadAkdNama(ids) {
    const need = ids.filter((id) => !akdNamaCache.has(id));
    const CHUNK = 300;
    for (let i = 0; i < need.length; i += CHUNK) {
      const chunk = need.slice(i, i + CHUNK);
      const { data, error } = await sb.from('produk_akd').select('produk_id, akd:akd_id(no_akd, nama_akd)').in('produk_id', chunk);
      if (error) { console.warn('kolom-tabel: gagal ambil Nama AKD', error.message); return false; }
      chunk.forEach((id) => akdNamaCache.set(id, []));
      (data || []).forEach((l) => {
        if (!l.akd) return;
        akdNamaCache.get(l.produk_id).push({ no: l.akd.no_akd || '', nama: l.akd.nama_akd || '' });
      });
      chunk.forEach((id) => akdNamaCache.set(id, sembunyikanAkdPlaceholder(akdNamaCache.get(id), (a) => a.no)));
    }
    return true;
  }

  // ---------- gambar tabel ----------
  function renderHead() {
    headRow.innerHTML = visibleCols().map((c) => `<th${c.num ? ' class="num"' : ''}>${esc(c.label)}</th>`).join('')
      + '<th class="c-act"><span class="sr-only">Salin</span></th>';
  }
  function rowHtml(p, extraCtx) {
    const ctx = { h, x: h.extraOf(p.id), akdNama: akdNamaCache.get(p.id) || [], flags: '', ...extraCtx };
    return visibleCols().map((c) => `<td class="${[c.num ? 'num' : '', c.td || ''].filter(Boolean).join(' ')}">${c.render(p, ctx)}</td>`).join('')
      + h.moreCell(p);
  }

  // ---------- popover pilihan kolom ----------
  function closePicker(restoreFocus) {
    if (popCleanup) popCleanup();
    if (pop) pop.remove();
    const back = popAnchor;
    if (back) back.setAttribute('aria-expanded', 'false');
    pop = popAnchor = popCleanup = null;
    if (restoreFocus && back && back.isConnected) back.focus({ preventScroll: true });
  }

  function paintList(el, focusSel) {
    const rows = [
      `<div class="col-row is-locked"><label class="cp-check"><input type="checkbox" checked disabled/><span>${esc(COL_BY_KEY.kode.label)}</span></label><i class="ti ti-lock col-lock" title="Selalu tampil, selalu pertama"></i></div>`,
      ...state.order.map((k, i) => {
        const c = COL_BY_KEY[k], on = state.visible.has(k);
        return `<div class="col-row${on ? '' : ' is-off'}"><label class="cp-check"><input type="checkbox" data-key="${k}"${on ? ' checked' : ''}/><span>${esc(c.label)}</span></label>`
          + `<span class="col-mv"><button type="button" data-mv="up" data-key="${k}" aria-label="Geser ${esc(c.label)} ke atas" title="Geser ke atas"${i === 0 ? ' disabled' : ''}><i class="ti ti-chevron-up"></i></button>`
          + `<button type="button" data-mv="down" data-key="${k}" aria-label="Geser ${esc(c.label)} ke bawah" title="Geser ke bawah"${i === state.order.length - 1 ? ' disabled' : ''}><i class="ti ti-chevron-down"></i></button></span></div>`;
      }),
    ];
    el.querySelector('.col-list').innerHTML = rows.join('');
    if (focusSel) (el.querySelector(focusSel + ':not(:disabled)') || el.querySelector('.col-list input[data-key]'))?.focus({ preventScroll: true });
  }

  const commit = (el, focusSel) => { save(); onChange(); if (el) paintList(el, focusSel); };

  function openPicker(anchor) {
    if (pop && popAnchor === anchor) { closePicker(true); return; }
    closePicker();
    const el = document.createElement('div');
    el.className = 'cp-pop col-pop';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Kolom tabel Produk');
    el.innerHTML =
      `<div class="cp-title cp-title-txt">Kolom tabel</div>` +
      `<div class="col-presets">${COL_PRESETS.map((p) => `<button type="button" class="col-preset" data-preset="${p.id}">${esc(p.label)}</button>`).join('')}</div>` +
      `<div class="col-list"></div>` +
      `<div class="cp-sep" role="separator"></div>` +
      `<button type="button" class="cp-item" data-act="reset"><span class="cp-lbl">Kembalikan standar</span></button>`;
    paintList(el);

    el.addEventListener('change', (e) => {
      const k = e.target.dataset && e.target.dataset.key;
      if (!k) return;
      if (e.target.checked) state.visible.add(k); else state.visible.delete(k);
      commit(el, `input[data-key="${k}"]`);
    });
    el.addEventListener('click', (e) => {
      const mv = e.target.closest('[data-mv]');
      if (mv) {
        const i = state.order.indexOf(mv.dataset.key), j = mv.dataset.mv === 'up' ? i - 1 : i + 1;
        if (i < 0 || j < 0 || j >= state.order.length) return;
        [state.order[i], state.order[j]] = [state.order[j], state.order[i]];
        commit(el, `[data-mv="${mv.dataset.mv}"][data-key="${mv.dataset.key}"]`);
        return;
      }
      const pr = e.target.closest('[data-preset]');
      if (pr) { state = orderFrom(COL_PRESETS.find((p) => p.id === pr.dataset.preset).cols); commit(el); return; }
      if (e.target.closest('[data-act="reset"]')) { state = defaultState(); commit(el); }
    });
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePicker(true); } });

    document.body.appendChild(el);
    pop = el; popAnchor = anchor;
    anchor.setAttribute('aria-expanded', 'true');
    const r = anchor.getBoundingClientRect(), w = el.offsetWidth, hh = el.offsetHeight;
    let top = r.bottom + 4;
    if (top + hh > window.innerHeight - 8) top = Math.max(8, window.innerHeight - hh - 8);
    el.style.left = Math.min(Math.max(8, r.right - w), Math.max(8, window.innerWidth - w - 8)) + 'px';
    el.style.top = top + 'px';

    const onDown = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) closePicker(); };
    const onResize = () => closePicker();
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('resize', onResize);
    popCleanup = () => { document.removeEventListener('pointerdown', onDown, true); window.removeEventListener('resize', onResize); };
    el.querySelector('input[data-key]')?.focus({ preventScroll: true });
  }

  return {
    renderHead,
    rowHtml,
    /** jumlah kolom di tabel (kolom data + kolom aksi) -> untuk colspan baris status */
    span() { return visibleCols().length + 1; },
    /** Muat data tambahan yang dibutuhkan kolom yang sedang tampil (saat ini: Nama AKD). */
    async loadNeeds(ids) {
      if (visibleCols().some((c) => c.needs === 'akdNama')) return loadAkdNama(ids);
      return true;
    },
    /** Dibuang tiap loadProduk() supaya Nama AKD tidak basi setelah edit. */
    invalidate() { akdNamaCache.clear(); },
    openPicker,
    destroy() { closePicker(); tableBody.removeEventListener('click', onLinkClick, true); akdNamaCache.clear(); },
  };
}