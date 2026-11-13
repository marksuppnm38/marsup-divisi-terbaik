// crud-produk/copy.js — alur "salin dulu" untuk list Produk.
//
// Kenapa ada: ~90% kerjaan harian berujung di Excel / Google Sheets / SPH / dokumen tender.
// List Produk dipakai sebagai referensi: cari -> salin -> tempel di tempat lain.
//
// Isinya (semua lewat event delegation di tableBody/cardWrap, tanpa listener per baris):
//   1. Salin satu field  : ikon salin kecil di sel Kode & Nama (muncul saat sel di-hover).
//   2. Menu "Salin"      : tombol di ujung baris, klik kanan di baris, atau tombol ContextMenu/Shift+F10.
//                          Isinya: Salin baris (TSV) + kode, nama, tipe, golongan, No. AKD, harga, link.
//   3. Salin banyak      : centang baris (Shift+klik = rentang), bar di bawah list -> "Salin sebagai tabel".
//                          Ctrl/Cmd+C di dalam tabel juga menyalin baris terpilih (atau baris yang difokus).
//   4. Kolom salinan     : bisa diatur (disimpan di localStorage), urutan kolom tetap.
//
// Format baris = TSV (kolom dipisah TAB, baris dipisah newline) -> menempel ke kolom terpisah
// di Excel dan Google Sheets. Isi sel dibersihkan dari TAB/newline supaya kolom tidak bergeser.
// Angka (harga, qty) disalin polos tanpa pemisah ribuan agar terbaca sebagai angka di Excel.
//
// Sumber data TIDAK diduplikasi: kolom list (id, kode, nama, tipe, golongan, link_v6, ...) dibaca dari
// baris yang sudah dimuat loadProduk(); harga dari shared/exports/pricelist.js (fetchHargaLatestMap,
// sama dengan Export Excel); No. AKD dari fetchAkdNoMap milik index.js; stok dari cache stok index.js.

import { fetchHargaLatestMap } from '../../../shared/exports/pricelist.js';

const LS_COLS = 'pnm_crud_copy_cols';
const LS_HDR = 'pnm_crud_copy_hdr';
const EXTRA_TTL_MS = 90 * 1000;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const clean = (v) => (v == null ? '' : String(v).replace(/[\t\r\n]+/g, ' ').trim());
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? '' : String(Number(v)));

// Urutan array ini = urutan kolom di hasil salinan (sama dengan urutan Export Excel).
// menu: tampil di menu "Salin" per baris. def: kolom default.
// needs: data tambahan yang harus dimuat dulu ('extra' = harga + No. AKD, 'stok' = cache stok).
export const COPY_FIELDS = [
  { key: 'kode', label: 'Kode produk', menu: true, def: true, get: (p) => p.kode_produk },
  { key: 'nama', label: 'Nama produk', menu: true, def: true, get: (p) => p.nama_produk },
  { key: 'tipe', label: 'Tipe', menu: true, def: true, get: (p) => p.tipe },
  { key: 'golongan', label: 'Golongan', menu: true, def: true, get: (p) => p.golongan },
  { key: 'akd', label: 'No. AKD', menu: true, def: true, needs: 'extra', get: (p, c) => (c.x ? c.x.akd.join(', ') : (p.no_akd || '')) },
  { key: 'status_akd', label: 'Status AKD', get: (p, c) => c.seal(p.status_akd) },
  { key: 'status_inaproc', label: 'Status INAPROC', get: (p) => p.status_inaproc },
  { key: 'ekat', label: 'Harga E-Katalog', menu: true, def: true, needs: 'extra', get: (p, c) => num(c.x && c.x.ekatalog) },
  { key: 'swasta', label: 'Harga Swasta', menu: true, def: true, needs: 'extra', get: (p, c) => num(c.x && c.x.swasta) },
  { key: 'tahun', label: 'Tahun harga', needs: 'extra', get: (p, c) => (c.x && c.x.tahun != null ? c.x.tahun : '') },
  { key: 'stok', label: 'Status stok', needs: 'stok', get: (p, c) => (c.sk && c.stokLabel[c.sk.status]) || '' },
  { key: 'qty', label: 'Qty stok', needs: 'stok', get: (p, c) => num(c.sk && c.sk.qty) },
  { key: 'aktif', label: 'Aktif', get: (p) => (p.is_active ? 'Ya' : 'Tidak') },
  { key: 'link', label: 'Link E-Katalog (V6)', menu: true, def: true, get: (p) => p.link_v6 },
];
const FIELD_BY_KEY = Object.fromEntries(COPY_FIELDS.map((f) => [f.key, f]));
const DEFAULT_COLS = () => new Set(COPY_FIELDS.filter((f) => f.def).map((f) => f.key));

function readCols() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_COLS) || 'null');
    if (Array.isArray(raw)) {
      const ok = raw.filter((k) => FIELD_BY_KEY[k]);
      if (ok.length) return new Set(ok);
    }
  } catch { /* storage diblok / isi rusak -> pakai default */ }
  return DEFAULT_COLS();
}
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
 *   rowActions(p) -> [{ key, label, icon, danger?, run() }]  aksi cepat di menu klik kanan (opsional; index.js)
 * }
 */
export function createCopyKit(ctx) {
  const { sb, tableBody, cardWrap, showToast } = ctx;
  const $ = (id) => document.getElementById(id);
  const bar = $('copyBar');
  const barCount = $('copyBarCount');
  const barCopy = $('copyBarCopy');
  const barCols = $('copyBarCols');
  const barClear = $('copyBarClear');
  const barPage = $('copyBarPage');

  const extra = new Map();     // produk_id -> { t, ekatalog, swasta, tahun, akd[] }
  const inflight = new Map();  // produk_id -> Promise<boolean>
  const selected = new Map();  // produk_id -> baris list (bisa lintas halaman / search)
  const byId = new Map();      // String(id) -> baris di halaman yang tampil
  let pageRows = [];
  let lastId = null;           // anchor Shift+klik
  let cols = readCols();
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

  const fieldsNow = () => COPY_FIELDS.filter((f) => cols.has(f.key));
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

  async function copyRows(rows) {
    const fields = fieldsNow();
    if (!fields.length) { showToast('Pilih minimal satu kolom salinan', true); return false; }
    if (!rows.length) { showToast('Tidak ada baris untuk disalin', true); return false; }
    if (busy) return false;
    busy = true;
    try {
      if (!(await prepare(rows, fields))) {
        showToast('Gagal mengambil harga / No. AKD / stok — tidak ada yang disalin', true);
        return false;
      }
      const lines = rows.map((p) => { const c = cOf(p); return fields.map((f) => clean(f.get(p, c))).join('\t'); });
      if (withHeader) lines.unshift(fields.map((f) => f.label).join('\t'));
      if (!(await writeClip(lines.join('\n')))) { showToast('Gagal menyalin — izinkan akses clipboard di browser', true); return false; }
      showToast(rows.length === 1 ? `1 baris disalin (${fields.length} kolom)` : `${rows.length.toLocaleString('id-ID')} baris × ${fields.length} kolom disalin`);
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
      `<button type="button" class="cp-item" role="menuitem" data-act="cols"><span class="cp-lbl">Atur kolom salinan…</span></button>` +
      (actions.length
        ? `<div class="cp-sep" role="separator"></div>` + actions.map((a) => `<button type="button" class="cp-item cp-action${a.danger ? ' cp-danger' : ''}" role="menuitem" data-act="action" data-akey="${esc(a.key)}"><span class="cp-lbl"><i class="ti ti-${esc(a.icon || 'bolt')}"></i>${esc(a.label)}</span></button>`).join('')
        : '');

    const paint = () => {
      el.querySelector('[data-rowinfo]').textContent = `${cols.size} kolom, tab`;
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
    el.innerHTML =
      `<div class="cp-title cp-title-txt">Kolom yang disalin</div>` +
      COPY_FIELDS.map((f) => `<label class="cp-check"><input type="checkbox" data-key="${f.key}"${cols.has(f.key) ? ' checked' : ''}/><span>${esc(f.label)}</span></label>`).join('') +
      `<div class="cp-sep" role="separator"></div>` +
      `<label class="cp-check"><input type="checkbox" data-hdr${withHeader ? ' checked' : ''}/><span>Sertakan judul kolom</span></label>` +
      `<button type="button" class="cp-item" data-act="reset"><span class="cp-lbl">Kembalikan standar</span></button>`;

    el.addEventListener('change', (e) => {
      const i = e.target;
      if (i.hasAttribute('data-hdr')) {
        withHeader = i.checked;
        try { localStorage.setItem(LS_HDR, withHeader ? '1' : '0'); } catch { /* abaikan */ }
      } else if (i.dataset.key) {
        if (i.checked) cols.add(i.dataset.key); else cols.delete(i.dataset.key);
        try { localStorage.setItem(LS_COLS, JSON.stringify([...cols])); } catch { /* abaikan */ }
      }
      syncUi();
    });
    el.addEventListener('click', (e) => {
      if (!e.target.closest('[data-act="reset"]')) return;
      cols = DEFAULT_COLS();
      withHeader = false;
      try { localStorage.setItem(LS_COLS, JSON.stringify([...cols])); localStorage.setItem(LS_HDR, '0'); } catch { /* abaikan */ }
      el.querySelectorAll('input[data-key]').forEach((i) => { i.checked = cols.has(i.dataset.key); });
      el.querySelector('input[data-hdr]').checked = false;
      syncUi();
    });
    showPop(el, place, returnEl);
  }

  // ---------- seleksi ----------
  function syncUi() {
    tableBody.querySelectorAll('tr[data-id]').forEach((tr) => {
      const p = byId.get(tr.dataset.id);
      const on = !!p && selected.has(p.id);
      const cb = tr.querySelector('.sel-input');
      if (cb) cb.checked = on;
      tr.classList.toggle('is-selected', on);
    });
    // Kotak pilih disembunyikan sampai ada baris terpilih (lalu tampil di semua baris).
    tableBody.classList.toggle('has-sel', selected.size > 0);
    const n = pageRows.filter((r) => selected.has(r.id)).length;
    if (barPage) barPage.hidden = !pageRows.length || n === pageRows.length;
    if (bar) bar.hidden = selected.size === 0;
    if (barCount) barCount.textContent = `${selected.size.toLocaleString('id-ID')} produk dipilih`;
    if (barCols) barCols.textContent = `Kolom (${cols.size})`;
  }

  function setSelected(p, on, shift) {
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

    if (t.matches('.sel-input')) { e.stopPropagation(); setSelected(p, t.checked, e.shiftKey); return; }
    // Ctrl/Cmd+klik = pilih/lepas baris, Shift+klik = rentang (cara Excel/Finder), tanpa perlu kotak pilih.
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
    // Enter/Spasi pada tombol/checkbox di dalam baris jangan dibajak jadi "buka produk".
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
    pageRows.forEach((r) => selected.set(r.id, r));
    lastId = null;
    syncUi();
  });
  barCopy?.addEventListener('click', copySelected);
  barCols?.addEventListener('click', () => openCols({ rect: barCols.getBoundingClientRect() }, barCols));
  barClear?.addEventListener('click', () => { selected.clear(); lastId = null; syncUi(); });
  syncUi();

  // ---------- API untuk index.js ----------
  return {
    /** Panggil sebelum render baris (rows = baris halaman yang akan tampil; [] saat loading / kosong / error). */
    setPage(rows) {
      pageRows = rows || [];
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
    /** Data harga/AKD dibuang tiap loadProduk() supaya tidak menyalin harga lama setelah edit. */
    invalidate() { extra.clear(); },
    /** Kotak pilih kecil di tepi kiri sel Kode (hanya tampil saat hover / ada seleksi). */
    selBox(p) {
      return `<input type="checkbox" class="sel-input" tabindex="-1" aria-label="Pilih ${esc(p.kode_produk)}"${selected.has(p.id) ? ' checked' : ''}/>`;
    },
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
    destroy() {
      closePop();
      extra.clear();
      selected.clear();
    },
  };
}