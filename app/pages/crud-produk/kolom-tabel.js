// crud-produk/kolom-tabel.js
// Kolom tabel list Produk yang bisa diatur sendiri: pilih kolom apa yang tampil, atur urutannya,
// atau pakai preset ("Harga & Link", "AKD lengkap", dst). Pilihan disimpan per browser (localStorage).
//
// Pola sama dengan copy.js: tanpa state global index.js. Semua yang butuh data/helper index.js
// dioper lewat `helpers`. Modul ini hanya tahu cara menggambar header, sel baris, dan popover pilihan.
//
// Export ("Export tampilan ini") memakai definisi kolom yang SAMA: tiap kolom punya `xl` (kolom Excel yang
// dihasilkan: label, format, lebar, cara ambil nilai). Satu kolom bisa jadi >1 kolom Excel (Stok -> Status + Qty).
// Jadi yang diexport = persis kolom & urutan yang terlihat di layar; tidak ada daftar kolom kedua yang bisa melenceng.
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

const rawNum = (v) => (v == null || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);
// Nilai stok = qty x harga E-Katalog; hanya ada kalau qty > 0 dan harga ada (definisi sama dengan export lama).
const nilaiOf = (p, c) => {
  const sk = c.h.stokOf(p.id), ekat = rawNum(c.x && c.x.ekatalog);
  const qty = sk && sk.qty != null ? Number(sk.qty) : null;
  return qty != null && Number.isFinite(qty) && qty > 0 && ekat != null ? qty * ekat : null;
};

// ctx tiap sel: { h: helpers, x: harga/AKD (atau null), akdNama: [{no, nama}], flags: html "Perlu dicek" }
// td: kelas tambahan sel; num: rata kanan angka; locked: tidak bisa disembunyikan/dipindah.
export const TABLE_COLS = [
  { key: 'kode', label: 'Kode Produk', locked: true, td: 'kode-cell',
    render: (p, c) => `${c.h.selBox(p)}${esc(p.kode_produk)}${c.h.btn('kode', 'Salin kode produk')}${c.h.recent(p.updated_at)}`,
    xl: [{ id: 'kode', label: 'Kode Produk', w: 22, get: (p) => p.kode_produk }] },
  { key: 'nama', label: 'Nama Produk', td: 'nama-cell',
    render: (p, c) => `${esc(p.nama_produk || '—')}${c.h.btn('nama', 'Salin nama produk')}${c.h.verified(p.id)}`,
    xl: [{ id: 'nama', label: 'Nama Produk', w: 45, get: (p) => p.nama_produk }] },
  { key: 'tipe', label: 'Tipe', td: 'tipe-cell',
    render: (p) => esc(p.tipe || '—'),
    xl: [{ label: 'Tipe', fmt: 'center', w: 12, get: (p) => p.tipe }] },
  { key: 'golongan', label: 'Golongan', td: 'tipe-cell',
    render: (p, c) => p.golongan ? `${esc(p.golongan)}${c.h.btn('golongan', 'Salin golongan')}` : '—',
    xl: [{ label: 'Golongan', w: 18, get: (p) => p.golongan }] },
  { key: 'akd', label: 'AKD', td: 'akd-cell',
    render: (p, c) => `${c.h.seal(p)}${c.h.akdNoOf(p.id).length ? c.h.btn('akd', 'Salin No. AKD') : ''}`,
    xl: [{ label: 'Status AKD', fmt: 'status', w: 15, get: (p, c) => c.h.sealLabel(p.status_akd) }] },
  { key: 'no_akd', label: 'No. AKD', td: 'mono-cell', uses: ['extra'],
    render: (p, c) => { const l = c.h.akdNoOf(p.id); return l.length ? `<span title="${esc(l.join(', '))}">${esc(l.join(', '))}</span>${c.h.btn('akd', 'Salin No. AKD')}` : '—'; },
    xl: [{ label: 'No. AKD', w: 24, get: (p, c) => c.h.akdNoOf(p.id).join(', ') }] },
  { key: 'nama_akd', label: 'Nama AKD', td: 'wrap-cell', needs: 'akdNama',
    render: (p, c) => c.akdNama.length ? c.akdNama.map((a) => `<div title="${esc(a.no)}">${esc(a.nama || a.no)}</div>`).join('') : '—',
    xl: [{ label: 'Nama AKD', w: 38, get: (p, c) => c.akdNama.map((a) => a.nama || a.no).join('; ') }] },
  { key: 'ekat', label: 'Harga E-Katalog', num: true, td: 'harga-cell', uses: ['extra'],
    render: (p, c) => { const v = c.x && c.x.ekatalog; return rupiah(v) + (v != null ? c.h.btn('ekat', 'Salin harga E-Katalog') : ''); },
    xl: [{ id: 'ekat', label: 'Harga E-Katalog', fmt: 'rp', w: 16, get: (p, c) => rawNum(c.x && c.x.ekatalog) }] },
  { key: 'swasta', label: 'Harga Swasta', num: true, td: 'harga-cell', uses: ['extra'],
    render: (p, c) => { const v = c.x && c.x.swasta; return rupiah(v) + (v != null ? c.h.btn('swasta', 'Salin harga swasta') : ''); },
    xl: [{ label: 'Harga Swasta', fmt: 'rp', w: 16, get: (p, c) => rawNum(c.x && c.x.swasta) }] },
  { key: 'tahun', label: 'Tahun Harga', td: 'tipe-cell', uses: ['extra'],
    render: (p, c) => (c.x && c.x.tahun != null) ? esc(c.x.tahun) : '—',
    xl: [{ label: 'Tahun Harga', fmt: 'center', w: 11, get: (p, c) => (c.x && c.x.tahun != null ? c.x.tahun : null) }] },
  { key: 'link', label: 'Link E-Katalog (V6)', td: 'link-cell',
    render: (p, c) => {
      const l = parseLinkV6(p.link_v6);
      if (l.state === 'kosong') return '—';
      if (!l.url) return `<span class="link-bad" title="${esc(l.catatan)}">Bukan URL</span>`;
      const label = l.url.replace(/^https?:\/\//i, '');
      return `<a class="link-v6" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" title="${esc(p.link_v6)}">${esc(label)}</a>${c.h.btn('link', 'Salin link V6')}`;
    },
    xl: [{ label: 'Link V6', fmt: 'link', w: 40, get: (p) => p.link_v6 }] },
  { key: 'status_inaproc', label: 'Status INAPROC', td: 'tipe-cell',
    render: (p) => esc(p.status_inaproc || '—'),
    xl: [{ label: 'Status INAPROC', fmt: 'status', w: 16, get: (p) => p.status_inaproc }] },
  { key: 'stok', label: 'Stok', num: true, uses: ['stok'],
    render: (p, c) => c.h.stokCell(p.id),
    xl: [
      { label: 'Status Stok', fmt: 'status', w: 18, get: (p, c) => { const sk = c.h.stokOf(p.id); return (sk && c.h.stokLabel[sk.status]) || null; } },
      { id: 'qty', label: 'Qty Stok', fmt: 'int', w: 10, get: (p, c) => { const sk = c.h.stokOf(p.id); return sk ? rawNum(sk.qty) : null; } },
    ] },
  { key: 'nilai', label: 'Nilai Stok', num: true, uses: ['extra', 'stok'],
    render: (p, c) => { const v = nilaiOf(p, c); return v == null ? dash : rupiah(v); },
    // Di Excel jadi rumus Qty x Harga E-Katalog (bisa diaudit) kalau dua kolom itu ikut diexport.
    xl: [{ id: 'nilai', label: 'Nilai Stok', fmt: 'rp', w: 18, get: nilaiOf, f: (L, r) => (L('qty') && L('ekat') ? `${L('qty')}${r}*${L('ekat')}${r}` : null) }] },
  { key: 'flags', label: 'Perlu dicek', td: 'flag-cell', uses: ['extra'],
    render: (p, c) => c.flags,
    xl: [{ label: 'Perlu dicek', w: 34, get: (p, c) => c.flagsText || null }] },
  { key: 'aktif', label: 'Aktif', td: 'tipe-cell',
    render: (p) => p.is_active ? 'Aktif' : '<span class="flag flag-mute">Nonaktif</span>',
    xl: [{ label: 'Aktif', fmt: 'center', w: 8, get: (p) => (p.is_active ? 'Ya' : 'Tidak') }] },
  { key: 'verified', label: 'Verified INAPROC', td: 'tipe-cell',
    render: (p, c) => c.h.verified(p.id) || dash,
    xl: [{ label: 'Verified INAPROC', fmt: 'center', w: 16, get: (p, c) => (c.h.isVerified(p.id) ? 'Ya' : null) }] },
  { key: 'updated', label: 'Terakhir Diubah', td: 'tipe-cell',
    render: (p) => tglPendek(p.updated_at),
    xl: [{ label: 'Terakhir Diubah', fmt: 'center', w: 16, get: (p) => { const d = p.updated_at ? new Date(p.updated_at) : null; return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : null; } }] },
];
const COL_BY_KEY = Object.fromEntries(TABLE_COLS.map((c) => [c.key, c]));
const MOVABLE = TABLE_COLS.filter((c) => !c.locked).map((c) => c.key);

export const COL_PRESETS = [
  { id: 'standar', label: 'Standar', cols: ['nama', 'tipe', 'akd', 'stok', 'flags'] },
  { id: 'harga', label: 'Pricelist sales', cols: ['nama', 'golongan', 'ekat', 'swasta', 'tahun', 'link'] },
  { id: 'akd', label: 'AKD lengkap', cols: ['nama', 'no_akd', 'nama_akd', 'status_inaproc'] },
  { id: 'audit', label: 'Audit lengkap', cols: ['nama', 'tipe', 'golongan', 'no_akd', 'akd', 'status_inaproc', 'ekat', 'swasta', 'tahun', 'stok', 'nilai', 'aktif', 'link', 'verified'] },
];
const DEFAULT_VISIBLE = COL_PRESETS[0].cols;

// state = {
//   order  : [key...] semua kolom non-locked (termasuk yang tidak tampil)
//   visible: Set kolom yang dipilih user
//   hidden : Set kolom yang SENGAJA dimatikan user -> tidak akan ditambahkan otomatis oleh filter
//   follow : true = filter aktif boleh menambah kolom yang relevan (kolom dinamis)
// }
function defaultState() { return orderFrom(DEFAULT_VISIBLE, true); }
function orderFrom(visibleKeys, follow) {
  const vis = visibleKeys.filter((k) => MOVABLE.includes(k));
  return { order: [...vis, ...MOVABLE.filter((k) => !vis.includes(k))], visible: new Set(vis), hidden: new Set(), follow };
}
function readState() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (raw && Array.isArray(raw.order) && Array.isArray(raw.visible)) {
      const seen = raw.order.filter((k, i) => MOVABLE.includes(k) && raw.order.indexOf(k) === i);
      // kolom baru (ditambah di versi kode berikutnya) otomatis masuk di ujung, tersembunyi
      const order = [...seen, ...MOVABLE.filter((k) => !seen.includes(k))];
      return {
        order,
        visible: new Set(raw.visible.filter((k) => MOVABLE.includes(k))),
        hidden: new Set((Array.isArray(raw.hidden) ? raw.hidden : []).filter((k) => MOVABLE.includes(k))),
        follow: raw.follow !== false,
      };
    }
  } catch { /* storage diblok / isi rusak -> default */ }
  return defaultState();
}

/**
 * opts: {
 *   sb, headRow (<tr> di <thead>), tableBody,
 *   helpers: { selBox(p), btn(key,label), recent(updatedAt), verified(id), seal(p), akdNoOf(id) -> [no],
 *              stokCell(id), moreCell(p),
 *              (khusus export, data mentah:) extraOf(id), stokOf(id) -> {status, qty}, stokLabel {READY:'Siap',..},
 *              sealLabel(status_akd) -> teks, isVerified(id) -> bool },
 *   onChange(): dipanggil setelah pilihan kolom berubah (index.js menggambar ulang header + baris)
 * }
 */
export function createTableColumns(opts) {
  const { sb, headRow, tableBody, helpers: h, onChange } = opts;
  let state = readState();
  const akdNamaCache = new Map(); // produk_id -> [{ no, nama }]
  let pop = null, popAnchor = null, popCleanup = null;

  const save = () => {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ order: state.order, visible: [...state.visible], hidden: [...state.hidden], follow: state.follow })); } catch { /* abaikan */ }
  };
  let autoKeys = [];   // kolom yang diminta filter aktif (diisi index.js lewat setAuto)
  // Kolom dinamis: filter menambah kolom yang relevan tepat setelah Nama. Hanya menambah -- pilihan user
  // jadi dasar, dan kolom yang sengaja dimatikan user tidak dipaksa muncul.
  const autoExtra = () => (state.follow ? autoKeys.filter((k) => !state.visible.has(k) && !state.hidden.has(k)) : []);
  const isOn = (k) => state.visible.has(k) || autoExtra().includes(k);
  const visibleCols = () => {
    const keys = state.order.filter((k) => state.visible.has(k));
    const at = keys.includes('nama') ? keys.indexOf('nama') + 1 : 0;
    keys.splice(at, 0, ...autoExtra());
    return [COL_BY_KEY.kode, ...keys.map((k) => COL_BY_KEY[k])];
  };

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
  const ctxOf = (p, extraCtx) => ({ h, x: h.extraOf(p.id), akdNama: akdNamaCache.get(p.id) || [], flags: '', flagsText: '', ...extraCtx });
  const xcols = () => visibleCols().flatMap((c) => (c.xl || []).map((x) => ({ ...x, key: c.key })));
  function rowHtml(p, extraCtx) {
    const ctx = ctxOf(p, extraCtx);
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
        const c = COL_BY_KEY[k], on = isOn(k), viaFilter = on && !state.visible.has(k);
        return `<div class="col-row${on ? '' : ' is-off'}"><label class="cp-check"><input type="checkbox" data-key="${k}"${on ? ' checked' : ''}/><span>${esc(c.label)}</span>${viaFilter ? '<em class="col-auto" title="Ditambahkan otomatis oleh filter yang aktif">filter</em>' : ''}</label>`
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
      `<label class="cp-check" title="Filter yang aktif menambah kolom yang relevan (mis. filter Harga menampilkan kolom harga)"><input type="checkbox" data-follow${state.follow ? ' checked' : ''}/><span>Ikuti filter (kolom ditambah otomatis)</span></label>` +
      `<button type="button" class="cp-item" data-act="reset"><span class="cp-lbl">Kembalikan standar</span></button>`;
    paintList(el);

    el.addEventListener('change', (e) => {
      if (e.target.hasAttribute && e.target.hasAttribute('data-follow')) {
        state.follow = e.target.checked;
        commit(el, 'input[data-follow]');
        return;
      }
      const k = e.target.dataset && e.target.dataset.key;
      if (!k) return;
      if (e.target.checked) { state.visible.add(k); state.hidden.delete(k); }
      else { state.visible.delete(k); state.hidden.add(k); } // dimatikan sengaja -> filter tidak memaksa muncul lagi
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
      if (pr) { state = orderFrom(COL_PRESETS.find((p) => p.id === pr.dataset.preset).cols, state.follow); commit(el); return; }
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
    // ---------- export: "yang terlihat di tabel = yang diexport" ----------
    /** Kolom Excel sesuai kolom yang tampil sekarang (urutan sama): [{ id?, key, label, fmt, w, f? }]. */
    exportColumns() { return xcols().map(({ get, ...rest }) => rest); },
    /** Nilai satu baris, sejajar dengan exportColumns(). extraCtx: { flagsText }. */
    exportRow(p, extraCtx) { const ctx = ctxOf(p, extraCtx); return xcols().map((x) => x.get(p, ctx)); },
    /** Data apa yang harus dimuat dulu supaya semua kolom yang tampil terisi: Set('extra' | 'stok' | 'akdNama'). */
    exportUses() {
      const u = new Set();
      visibleCols().forEach((c) => { (c.uses || []).forEach((k) => u.add(k)); if (c.needs) u.add(c.needs); });
      return u;
    },
    /** Label kolom yang tampil (untuk ringkasan di menu Export). */
    visibleLabels() { return visibleCols().map((c) => c.label); },
    /** Dibuang tiap loadProduk() supaya Nama AKD tidak basi setelah edit. */
    invalidate() { akdNamaCache.clear(); },
    /** Kolom yang diminta filter aktif (urutan = urutan tampil). Panggil sebelum renderHead(). */
    setAuto(keys) { autoKeys = (keys || []).filter((x) => MOVABLE.includes(x)); },
    openPicker,
    destroy() { closePicker(); tableBody.removeEventListener('click', onLinkClick, true); akdNamaCache.clear(); },
  };
}