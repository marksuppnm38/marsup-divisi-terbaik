// crud-produk/copy.js — alur "salin dulu" untuk list Produk.
//
// Kenapa ada: ~90% kerjaan harian berujung di Excel / Google Sheets / SPH / dokumen tender.
// List Produk dipakai sebagai referensi: cari -> salin -> tempel di tempat lain.
//
// Isinya (semua lewat event delegation di tableBody/cardWrap, tanpa listener per baris):
//   1. Salin satu field  : ikon salin kecil di sel Kode & Nama (muncul saat sel di-hover).
//   2. Menu "Salin"      : tombol di ujung baris, klik kanan di baris, atau tombol ContextMenu/Shift+F10.
//                          Isinya: Salin baris (TSV) + kode, nama, tipe, golongan, No. AKD, harga, link.
//   3. Salin banyak      : pilih baris (Ctrl/Cmd+klik = pilih/lepas, Shift+klik = rentang, tombol x; layar sentuh: tombol "Pilih"),
//                          lalu bar di bawah list -> "Salin sebagai tabel". Tidak ada kotak centang di baris.
//                          Ctrl/Cmd+C di dalam tabel juga menyalin baris terpilih (atau baris yang difokus).
//   4. Kolom salinan     : WYSIWYG. Salin baris / salin banyak mengikuti kolom yang TAMPIL di tabel (urutan, judul, dan
//                          kolom dinamis hasil filter ikut), bukan daftar kolom sendiri. Definisi kolom ada di kolom-tabel.js
//                          (copyTsv); modul ini hanya mengurus pemilihan baris, memuat datanya, dan menulis ke clipboard.
//                          Satu-satunya pilihan milik salin: "Sertakan judul kolom" (disimpan di localStorage).
//
// Format baris = TSV (kolom dipisah TAB, baris dipisah newline) -> menempel ke kolom terpisah
// di Excel dan Google Sheets. Isi sel dibersihkan dari TAB/newline supaya kolom tidak bergeser.
// Angka (harga, qty) disalin polos tanpa pemisah ribuan agar terbaca sebagai angka di Excel.
//
// Sumber data TIDAK diduplikasi: kolom list (id, kode, nama, tipe, golongan, link_v6, ...) dibaca dari
// baris yang sudah dimuat loadProduk(); harga dari shared/exports/pricelist.js (fetchHargaLatestMap,
// sama dengan Export Excel); No. AKD dari fetchAkdNoMap milik index.js; stok dari cache stok index.js.
// COPY_FIELDS di bawah dipakai untuk salin SATU nilai (ikon salin di sel, item menu per field), bukan untuk salin baris.

import { fetchHargaLatestMap } from '../../../shared/exports/pricelist.js';

const LS_HDR = 'pnm_crud_copy_hdr';
const EXTRA_TTL_MS = 90 * 1000;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const clean = (v) => (v == null ? '' : String(v).replace(/[\t\r\n]+/g, ' ').trim());
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? '' : String(Number(v)));

// Nilai tunggal yang bisa disalin dari satu baris (ikon salin di sel + item menu "Salin" per baris).
// menu: tampil di menu "Salin" per baris.
// needs: data tambahan yang harus dimuat dulu ('extra' = harga + No. AKD, 'stok' = cache stok).
export const COPY_FIELDS = [
  { key: 'kode', label: 'Kode produk', menu: true, get: (p) => p.kode_produk },
  { key: 'nama', label: 'Nama produk', menu: true, get: (p) => p.nama_produk },
  { key: 'tipe', label: 'Tipe', menu: true, get: (p) => p.tipe },
  { key: 'golongan', label: 'Golongan', menu: true, get: (p) => p.golongan },
  { key: 'brand', label: 'Brand', menu: true, get: (p) => p.brand || '' },
  { key: 'akd', label: 'No. AKD', menu: true, needs: 'extra', get: (p, c) => (c.x ? c.x.akd.join(', ') : (p.no_akd || '')) },
  { key: 'status_akd', label: 'Status AKD', get: (p, c) => c.seal(p.status_akd) },
  { key: 'status_inaproc', label: 'Status INAPROC', get: (p) => p.status_inaproc },
  { key: 'ekat', label: 'Harga E-Katalog', menu: true, needs: 'extra', get: (p, c) => num(c.x && c.x.ekatalog) },
  { key: 'swasta', label: 'Harga Swasta', menu: true, needs: 'extra', get: (p, c) => num(c.x && c.x.swasta) },
  { key: 'tahun', label: 'Tahun harga', needs: 'extra', get: (p, c) => (c.x && c.x.tahun != null ? c.x.tahun : '') },
  { key: 'stok', label: 'Status stok', needs: 'stok', get: (p, c) => (c.sk && c.stokLabel[c.sk.status]) || '' },
  { key: 'qty', label: 'Qty stok', needs: 'stok', get: (p, c) => num(c.sk && c.sk.qty) },
  { key: 'aktif', label: 'Aktif', get: (p) => (p.is_active ? 'Ya' : 'Tidak') },
  { key: 'link', label: 'Link E-Katalog (V6)', menu: true, get: (p) => p.link_v6 },
];
const FIELD_BY_KEY = Object.fromEntries(COPY_FIELDS.map((f) => [f.key, f]));

function readHdr() {
  try { return localStorage.getItem(LS_HDR) === '1'; } catch { return false; }
}

async function writeClip(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* jatuh ke fallback */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:-1000px;left:0;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

/**
 * ctx: {
 *   sb, tableBody, cardWrap, showToast(msg, isError),
 *   fetchAkdNoMap(ids, {silent}) -> Map|null,
 *   stokOf(id) -> {status, qty}|undefined, ensureStok(ids) -> Promise<boolean>,
 *   stokLabel: {READY:'Siap',...}, sealLabel(status) -> string,
 *   table: {   kolom salinan baris = kolom yang tampil di tabel (kolom-tabel.js), dibaca saat dipanggil (bukan saat dibuat)
 *     labels() -> [judul kolom yang tampil],
 *     prepare(rows) -> Promise<null | string>   muat data yang dibutuhkan kolom itu; string = pesan gagal (tidak ada yang disalin),
 *     tsv(rows, header) -> { text, cols }       teks TSV persis kolom & urutan di layar
 *   },
 *   openTableColumns(anchorEl)  buka pilihan kolom tabel (tombol "Atur kolom tabel…" di popover Kolom salinan)
 *   rowActions(p) -> [{ key, label, icon, danger?, run() }]  aksi cepat di menu klik kanan (opsional; index.js)
 * }
 */
export function createCopyKit(ctx) {
  const { sb, tableBody, cardWrap, showToast } = ctx;
  const $ = (id) => document.getElementById(id);
  // ctx.ids: id elemen bar salin. Default = bar di list Produk; tampilan lain boleh memakai bar sendiri (dulu: Kelompok set di tab Kategori, sudah dilebur ke list Produk)
  // memakai bar sendiri, jadi dua instance tidak berebut elemen yang sama.
  const barIds = ctx.ids || {};
  const bar = $(barIds.bar || 'copyBar');
  const barCount = $(barIds.count || 'copyBarCount');
  const barCopy = $(barIds.copy || 'copyBarCopy');
  const barCols = $(barIds.cols || 'copyBarCols');
  const barClear = $(barIds.clear || 'copyBarClear');
  const barPage = $(barIds.page || 'copyBarPage');
  const selBtn = $(barIds.selectBtn || 'produkSelectBtn');   // mode "Pilih" untuk layar sentuh (boleh tidak ada)
  const selHint = $(barIds.hint || 'selHint');               // petunjuk satu baris di dasar tabel (boleh tidak ada)

  const extra = new Map();     // produk_id -> { t, ekatalog, swasta, tahun, akd[] }
  const inflight = new Map();  // produk_id -> Promise<boolean>
  const selected = new Map();  // produk_id -> baris list (bisa lintas halaman / search)
  const byId = new Map();      // String(id) -> baris di halaman yang tampil
  let pageRows = [];
  let lastId = null;           // anchor Shift+klik
  let selectMode = false;      // mode "Pilih" (layar sentuh): ketuk baris = toggle seleksi, bukan buka edit
  let extAnchor = null;        // anchor Shift+panah (rentang dari baris yang difokus waktu mulai)
  let extPre = null;           // seleksi SEBELUM Shift+panah mulai: rentang ditambahkan di atasnya, mengecil = ikut dilepas
  let withHeader = readHdr();
  let busy = false;
  let pop = null, popCleanup = null, popReturn = null;

  // ---------- data tambahan (harga + No. AKD) ----------
  const freshExtra = (id) => {
    const c = extra.get(id);
    return c && Date.now() - c.t < EXTRA_TTL_MS ? c : null;
  };

  async function ensureExtra(ids) {
    const waits = [];
    const need = [];
    ids.forEach((id) => {
      if (freshExtra(id)) return;
      const f = inflight.get(id);
      if (f) { if (!waits.includes(f)) waits.push(f); return; }
      need.push(id);
    });
    if (need.length) {
      const job = (async () => {
        try {
          const [hm, am] = await Promise.all([
            fetchHargaLatestMap(sb, need),
            ctx.fetchAkdNoMap(need, { silent: true }),
          ]);
          if (am === null) return false;
          const t = Date.now();
          need.forEach((id) => {
            const h = hm.get(id);
            extra.set(id, { t, ekatalog: h ? h.ekatalog : null, swasta: h ? h.swasta : null, tahun: h ? h.tahun : null, akd: am.get(id) || [] });
          });
          return true;
        } catch (e) {
          console.warn('copy: gagal ambil harga/AKD', e);
          return false;
        } finally {
          need.forEach((id) => inflight.delete(id));
        }
      })();
      need.forEach((id) => inflight.set(id, job));
      waits.push(job);
    }
    const res = await Promise.all(waits);
    return res.every(Boolean);
  }

  const cOf = (p) => ({ x: freshExtra(p.id), sk: ctx.stokOf(p.id), seal: (s) => ctx.sealLabel(s), stokLabel: ctx.stokLabel });
  const valueOf = (f, p) => clean(f.get(p, cOf(p)));
  const isReady = (f, p) => !f.needs || (f.needs === 'extra' ? !!freshExtra(p.id) : !!ctx.stokOf(p.id));

  async function prepare(rows, fields) {
    const ids = rows.map((r) => r.id);
    const jobs = [];
    if (fields.some((f) => f.needs === 'extra')) jobs.push(ensureExtra(ids));
    if (fields.some((f) => f.needs === 'stok')) jobs.push(ctx.ensureStok(ids));
    return (await Promise.all(jobs)).every(Boolean);
  }

  // ---------- aksi salin ----------
  function flash(btn) {
    if (!btn) return;
    const i = btn.querySelector('i');
    if (!i) return;
    btn.classList.add('done');
    i.classList.replace('ti-copy', 'ti-check');
    setTimeout(() => { btn.classList.remove('done'); i.classList.replace('ti-check', 'ti-copy'); }, 1200);
  }

  async function copyField(p, key, btn) {
    const f = FIELD_BY_KEY[key];
    if (!f) return;
    if (!isReady(f, p) && !(await prepare([p], [f]))) {
      showToast('Gagal mengambil data ' + f.label.toLowerCase() + ' — tidak ada yang disalin', true);
      return;
    }
    const v = valueOf(f, p);
    if (!v) { showToast(f.label + ' kosong untuk ' + p.kode_produk, true); return; }
    if (await writeClip(v)) { flash(btn); showToast(f.label + ' disalin'); }
    else showToast('Gagal menyalin — izinkan akses clipboard di browser', true);
  }

  // Salin baris = kolom yang tampil di tabel, apa adanya (urutan, kolom dinamis dari filter, judul). Lihat kolom-tabel.js copyTsv.
  async function copyRows(rows) {
    if (!rows.length) { showToast('Tidak ada baris untuk disalin', true); return false; }
    if (busy) return false;
    busy = true;
    try {
      // Kolom dibaca SESUDAH data termuat: user bisa mengganti kolom selama menunggu, yang tersalin tetap yang tampil saat teks dibuat.
      const err = await ctx.table.prepare(rows);
      if (err) { showToast(err, true); return false; }
      const { text, cols } = ctx.table.tsv(rows, withHeader);
      if (!cols) { showToast('Tidak ada kolom tabel untuk disalin', true); return false; }
      if (!(await writeClip(text))) { showToast('Gagal menyalin — izinkan akses clipboard di browser', true); return false; }
      showToast(rows.length === 1 ? `1 baris disalin (${cols} kolom)` : `${rows.length.toLocaleString('id-ID')} baris × ${cols} kolom disalin`);
      return true;
    } finally { busy = false; }
  }
  const copySelected = () => copyRows([...selected.values()]);

  // ---------- popover (menu + kolom) ----------
  function closePop(restoreFocus) {
    if (popCleanup) popCleanup();
    if (pop) pop.remove();
    const back = popReturn;
    if (back && back.hasAttribute && back.hasAttribute('aria-expanded')) back.setAttribute('aria-expanded', 'false');
    pop = popCleanup = popReturn = null;
    if (restoreFocus && back && back.isConnected) back.focus({ preventScroll: true });
  }

  function showPop(el, place, returnEl) {
    closePop();
    document.body.appendChild(el);
    pop = el;
    popReturn = returnEl || null;
    if (popReturn && popReturn.hasAttribute && popReturn.hasAttribute('aria-haspopup')) popReturn.setAttribute('aria-expanded', 'true');
    const w = el.offsetWidth, h = el.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
    let left, top;
    if (place.rect) {
      left = place.rect.right - w;
      top = place.rect.bottom + 4;
      if (top + h > vh - 8) top = place.rect.top - h - 4;
    } else {
      left = place.x;
      top = place.y;
      if (top + h > vh - 8) top = place.y - h;
    }
    el.style.left = Math.min(Math.max(8, left), Math.max(8, vw - w - 8)) + 'px';
    el.style.top = Math.max(8, top) + 'px';

    const onDown = (e) => { if (!el.contains(e.target)) closePop(); };
    const onScroll = (e) => { if (!el.contains(e.target)) closePop(); };
    const onResize = () => closePop();
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    popCleanup = () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };

    el.addEventListener('keydown', (e) => {
      const items = [...el.querySelectorAll('button:not([disabled]),input')];
      const i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
      else if (e.key === 'Home') { e.preventDefault(); items[0]?.focus(); }
      else if (e.key === 'End') { e.preventDefault(); items[items.length - 1]?.focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop(true); }
      else if (e.key === 'Tab') closePop(true);
    });
    (el.querySelector('button:not([disabled]),input') || el).focus({ preventScroll: true });
  }

  function openMenu(p, place, returnEl) {
    const el = document.createElement('div');
    el.className = 'cp-pop';
    el.setAttribute('role', 'menu');
    el.setAttribute('aria-label', 'Salin dari ' + p.kode_produk);
    const menuFields = COPY_FIELDS.filter((f) => f.menu);
    const actions = ctx.rowActions ? ctx.rowActions(p) : [];
    el.innerHTML =
      `<div class="cp-title">${esc(p.kode_produk)}</div>` +
      `<button type="button" class="cp-item cp-main" role="menuitem" data-act="row"><span class="cp-lbl">Salin baris</span><span class="cp-val" data-rowinfo></span></button>` +
      `<div class="cp-sep" role="separator"></div>` +
      menuFields.map((f) => `<button type="button" class="cp-item" role="menuitem" data-act="field" data-key="${f.key}"><span class="cp-lbl">${esc(f.label)}</span><span class="cp-val"></span></button>`).join('') +
      `<div class="cp-sep" role="separator"></div>` +
      `<button type="button" class="cp-item" role="menuitem" data-act="cols"><span class="cp-lbl">Kolom yang disalin…</span></button>` +
      (actions.length
        ? `<div class="cp-sep" role="separator"></div>` + actions.map((a) => `<button type="button" class="cp-item cp-action${a.danger ? ' cp-danger' : ''}" role="menuitem" data-act="action" data-akey="${esc(a.key)}"><span class="cp-lbl"><i class="ti ti-${esc(a.icon || 'bolt')}"></i>${esc(a.label)}</span></button>`).join('')
        : '');

    const paint = () => {
      el.querySelector('[data-rowinfo]').textContent = `${ctx.table.labels().length} kolom tabel, tab`;
      el.querySelectorAll('[data-act="field"]').forEach((b) => {
        const f = FIELD_BY_KEY[b.dataset.key];
        const val = b.querySelector('.cp-val');
        if (!isReady(f, p)) { val.textContent = '…'; b.disabled = false; return; }
        const v = valueOf(f, p);
        val.textContent = v || '—';
        val.title = v;
        b.disabled = !v;
      });
    };
    paint();

    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b || b.disabled) return;
      const act = b.dataset.act;
      if (act === 'cols') { const rect = el.getBoundingClientRect(); closePop(); openCols({ x: rect.left, y: rect.top }, returnEl); return; }
      if (act === 'action') { closePop(); const a = actions.find((x) => x.key === b.dataset.akey); if (a) a.run(); return; }
      closePop(true);
      if (act === 'row') copyRows([p]);
      else copyField(p, b.dataset.key, null);
    });

    showPop(el, place, returnEl);
    ensureExtra([p.id]).then(() => { if (pop === el) paint(); });
  }

  function openCols(place, returnEl) {
    const el = document.createElement('div');
    el.className = 'cp-pop cp-cols';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Kolom yang disalin');
    // Kolom salinan = kolom tabel yang tampil (satu sumber). Di sini hanya info + opsi judul + jalan pintas ke pilihan kolom tabel.
    el.innerHTML =
      `<div class="cp-title cp-title-txt">Yang disalin = kolom di tabel</div>` +
      `<div class="col-note">${ctx.table.labels().map(esc).join(' · ')}</div>` +
      `<div class="cp-sep" role="separator"></div>` +
      `<label class="cp-check"><input type="checkbox" data-hdr${withHeader ? ' checked' : ''}/><span>Sertakan judul kolom</span></label>` +
      `<button type="button" class="cp-item" data-act="table-cols"><span class="cp-lbl">Atur kolom tabel…</span></button>`;

    el.addEventListener('change', (e) => {
      if (!e.target.hasAttribute('data-hdr')) return;
      withHeader = e.target.checked;
      try { localStorage.setItem(LS_HDR, withHeader ? '1' : '0'); } catch { /* abaikan */ }
    });
    el.addEventListener('click', (e) => {
      if (!e.target.closest('[data-act="table-cols"]')) return;
      closePop();
      ctx.openTableColumns(returnEl);
    });
    showPop(el, place, returnEl);
  }

  // ---------- seleksi ----------
  function syncUi() {
    // Penanda baris terpilih (.is-selected): latar aksen + garis kiri, digambar CSS. Berlaku untuk baris tabel DAN kartu.
    [[tableBody, 'tr[data-id]'], [cardWrap, ':scope > [data-id]']].forEach(([root, sel]) => {
      root.querySelectorAll(sel).forEach((el) => {
        const p = byId.get(el.dataset.id);
        el.classList.toggle('is-selected', !!p && selected.has(p.id));
      });
    });
    const n = pageRows.filter((r) => selected.has(r.id)).length;
    if (barPage) barPage.hidden = !pageRows.length || n === pageRows.length;
    // Bar tampil bila ada yang dipilih, atau bila mode "Pilih" aktif (supaya user sentuh tahu sedang memilih).
    if (bar) bar.hidden = selected.size === 0 && !selectMode;
    if (barCount) barCount.textContent = selected.size
      ? `${selected.size.toLocaleString('id-ID')} produk dipilih`
      : 'Ketuk baris untuk memilih';
    // Bar hanya tampil saat ada yang dipilih; tidak menyentuh ctx.table waktu kit dibuat (colKit baru ada sesudahnya).
    if (barCols && selected.size) barCols.textContent = `Kolom (${ctx.table.labels().length})`;
    if (selHint) selHint.hidden = !pageRows.length;
    if (selBtn) {
      selBtn.classList.toggle('is-on', selectMode);
      selBtn.setAttribute('aria-pressed', selectMode ? 'true' : 'false');
      const lbl = selBtn.querySelector('[data-sel-label]');
      if (lbl) lbl.textContent = selectMode ? 'Selesai' : 'Pilih';
    }
  }

  function setSelectMode(on) {
    selectMode = !!on;
    syncUi();
  }

  function setSelected(p, on, shift) {
    extAnchor = null; extPre = null;
    if (shift && lastId != null) {
      const a = pageRows.findIndex((r) => String(r.id) === String(lastId));
      const b = pageRows.findIndex((r) => r.id === p.id);
      if (a >= 0 && b >= 0) {
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) {
          if (on) selected.set(pageRows[i].id, pageRows[i]); else selected.delete(pageRows[i].id);
        }
        lastId = p.id;
        syncUi();
        return;
      }
    }
    if (on) selected.set(p.id, p); else selected.delete(p.id);
    lastId = p.id;
    syncUi();
  }

  // ---------- event delegation ----------
  const hostOf = (el) => (el && el.closest ? el.closest('[data-id]') : null);
  const hasTextSelection = () => { const s = window.getSelection(); return !!s && !s.isCollapsed && s.toString().trim() !== ''; };

  // Capture: harus jalan SEBELUM listener klik/keydown per-baris milik index.js (buka modal edit).
  function onClick(e) {
    const t = e.target;
    const host = hostOf(t);
    if (!host) return;
    const p = byId.get(host.dataset.id);
    if (!p) return;

    // Mode "Pilih" (layar sentuh): ketuk baris/kartu = toggle seleksi, bukan buka edit. Tombol salin per field & menu "Salin" tetap jalan.
    if (selectMode && !t.closest('[data-cp],.cp-more,a,input')) {
      e.stopPropagation();
      e.preventDefault();
      setSelected(p, !selected.has(p.id), false);
      return;
    }
    // Ctrl/Cmd+klik = pilih/lepas baris, Shift+klik = rentang (cara Excel/Finder).
    if ((e.ctrlKey || e.metaKey || e.shiftKey) && !t.closest('button,a,input')) {
      e.stopPropagation();
      e.preventDefault();
      if (e.shiftKey) setSelected(p, true, true);
      else setSelected(p, !selected.has(p.id), false);
      return;
    }
    const cp = t.closest('[data-cp]');
    if (cp) { e.stopPropagation(); e.preventDefault(); copyField(p, cp.dataset.cp, cp); return; }
    const more = t.closest('.cp-more');
    if (more) { e.stopPropagation(); e.preventDefault(); openMenu(p, { rect: more.getBoundingClientRect() }, more); return; }
    // Teks sedang diblok (mau disalin manual) -> jangan buka modal edit.
    if (hasTextSelection()) e.stopPropagation();
  }

  function onKeydown(e) {
    const host = hostOf(e.target);
    // Enter/Spasi pada tombol di dalam baris jangan dibajak jadi "buka produk".
    if (host && e.target !== host && (e.key === 'Enter' || e.key === ' ')) { e.stopPropagation(); return; }

    // x = pilih/lepas baris yang sedang difokus (seperti Gmail)
    if (host && e.target === host && e.key.toLowerCase() === 'x' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const p = byId.get(host.dataset.id);
      if (p) { e.preventDefault(); setSelected(p, !selected.has(p.id), e.shiftKey); }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'c') {
      if (hasTextSelection()) return; // salin teks biasa
      if (selected.size) { e.preventDefault(); copySelected(); return; }
      const p = host && byId.get(host.dataset.id);
      if (p) { e.preventDefault(); copyRows([p]); }
      return;
    }
    if (host && (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) {
      const p = byId.get(host.dataset.id);
      if (!p) return;
      e.preventDefault();
      const r = host.getBoundingClientRect();
      openMenu(p, { x: r.left + 24, y: r.bottom }, host);
    }
  }

  function onContext(e) {
    if (e.shiftKey || hasTextSelection()) return; // Shift+klik kanan / teks terblok: menu bawaan browser
    const host = hostOf(e.target);
    const p = host && byId.get(host.dataset.id);
    if (!p) return;
    e.preventDefault();
    openMenu(p, { x: e.clientX, y: e.clientY }, host);
  }

  // Shift+klik pada teks biasanya memperluas blok teks browser; tahan supaya dipakai untuk pilih rentang.
  function onMouseDown(e) {
    if (e.shiftKey && hostOf(e.target) && !e.target.closest('input,button,a')) e.preventDefault();
  }

  [tableBody, cardWrap].forEach((root) => {
    root.addEventListener('mousedown', onMouseDown, true);
    root.addEventListener('click', onClick, true);
    root.addEventListener('keydown', onKeydown, true);
    root.addEventListener('contextmenu', onContext);
  });
  barPage?.addEventListener('click', () => {
    extAnchor = null; extPre = null;
    pageRows.forEach((r) => selected.set(r.id, r));
    lastId = null;
    syncUi();
  });
  barCopy?.addEventListener('click', copySelected);
  barCols?.addEventListener('click', () => openCols({ rect: barCols.getBoundingClientRect() }, barCols));
  barClear?.addEventListener('click', () => { selected.clear(); lastId = null; extAnchor = null; extPre = null; syncUi(); });
  selBtn?.addEventListener('click', () => setSelectMode(!selectMode));
  syncUi();

  // ---------- API untuk index.js ----------
  return {
    /** Panggil sebelum render baris (rows = baris halaman yang akan tampil; [] saat loading / kosong / error). */
    setPage(rows) {
      pageRows = rows || [];
      extAnchor = null; extPre = null;
      byId.clear();
      pageRows.forEach((r) => byId.set(String(r.id), r));
      lastId = null;
      syncUi();
    },
    /** Panggil setelah baris di-render: sinkron centang + tarik harga/AKD halaman ini di latar (senyap). */
    afterRender() {
      syncUi();
      ensureExtra(pageRows.map((r) => r.id));
    },
    /** Baris yang sedang dicentang (lintas halaman / search), dipakai aksi massal seperti Atur klasifikasi. */
    selectedRows() { return [...selected.values()]; },
    /** Gambar ulang bar salin (mis. jumlah "Kolom (n)" berubah karena kolom tabel diganti). */
    refresh() { syncUi(); },
    /** Kosongkan semua pilihan + keluar dari mode "Pilih" (dipakai tampilan yang disembunyikan, supaya bar salin tidak tertinggal). */
    clearSelection() { selected.clear(); lastId = null; extAnchor = null; extPre = null; selectMode = false; syncUi(); },
    /** Mode "Pilih" aktif? (ketuk baris = toggle seleksi). index.js tidak perlu memanggilnya; tersedia untuk tes/diagnosa. */
    isSelectMode() { return selectMode; },
    /** Salin baris-baris ini langsung (tanpa dicentang dulu), pakai kolom & judul yang sedang diatur. */
    copyRows(rows) { return copyRows(rows || []); },
    /** Data harga/AKD dibuang tiap loadProduk() supaya tidak menyalin harga lama setelah edit. */
    invalidate() { extra.clear(); },
    /** Buang produk yang sudah dihapus dari seleksi (centang lintas halaman) dan dari cache harga/AKD. */
    forget(ids) {
      const gone = new Set((Array.isArray(ids) ? ids : [ids]).map(String));
      let hit = false;
      for (const k of [...selected.keys()]) if (gone.has(String(k))) { selected.delete(k); hit = true; }
      for (const k of [...extra.keys()]) if (gone.has(String(k))) extra.delete(k);
      if (hit) { lastId = null; extAnchor = null; extPre = null; syncUi(); }
    },
    /**
     * Shift+↑/↓: pilih rentang dari baris awal (anchor) sampai baris yang kini difokus. Anchor = baris yang difokus saat
     * Shift+panah PERTAMA ditekan (fallbackAnchorId) dan tetap sampai endExtend(). Pilihan lama tetap utuh; rentang yang
     * mengecil ikut dilepas lagi (seperti Excel). Mengembalikan false kalau salah satu id bukan baris halaman ini.
     */
    extendRange(fallbackAnchorId, id) {
      if (extAnchor == null) { extAnchor = String(fallbackAnchorId); extPre = new Map(selected); }
      const a = pageRows.findIndex((r) => String(r.id) === extAnchor);
      const b = pageRows.findIndex((r) => String(r.id) === String(id));
      if (a < 0 || b < 0) { extAnchor = null; extPre = null; return false; }
      selected.clear();
      extPre.forEach((v, k) => selected.set(k, v));
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) selected.set(pageRows[i].id, pageRows[i]);
      lastId = pageRows[b].id;
      syncUi();
      return true;
    },
    /** Panah biasa (tanpa Shift) mengakhiri rentang: pilihan tetap, anchor baru dimulai di Shift+panah berikutnya. */
    endExtend() { extAnchor = null; extPre = null; },
    /** No. AKD terhubung untuk produk ini (kosong kalau belum termuat / tidak ada). */
    akdOf(id) { const c = freshExtra(id); return c ? c.akd : []; },
    /** Harga + No. AKD yang sudah termuat untuk satu produk (null kalau belum / sudah basi). Dipakai kolom-tabel.js. */
    extraOf(id) { return freshExtra(id); },
    /** Muat harga + No. AKD untuk sekumpulan id (dipakai sebelum render supaya kolom AKD langsung terisi). */
    loadExtra(ids) { return ensureExtra(ids); },
    /** Ikon salin kecil untuk satu field (muncul saat sel di-hover). */
    btn(key, label) {
      return `<button type="button" class="cp-btn" data-cp="${key}" tabindex="-1" title="${esc(label)}" aria-label="${esc(label)}"><i class="ti ti-copy"></i></button>`;
    },
    moreCell(p) {
      return `<td class="c-act"><button type="button" class="cp-more" aria-haspopup="menu" aria-label="Salin data ${esc(p.kode_produk)}" title="Salin data produk ini"><i class="ti ti-copy"></i><span>Salin</span></button></td>`;
    },
    moreBtnCard(p) {
      return `<button type="button" class="cp-more cp-more-card" aria-haspopup="menu" aria-label="Salin data ${esc(p.kode_produk)}" title="Salin data produk ini"><i class="ti ti-copy"></i></button>`;
    },
    /** Tutup menu Salin kalau terbuka (dipakai suspend(): popover ini menempel di document.body, di luar container modul). Seleksi tidak disentuh. */
    closePopover() { closePop(); },
    destroy() {
      closePop();
      extra.clear();
      selected.clear();
      selectMode = false;
    },
  };
}