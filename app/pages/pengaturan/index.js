// pengaturan page module: mount(container) / unmount().
//
// Halaman admin "User Management": tabel akun (allowed_users) + drawer detail izin per akun (modul/submodul yang
// tampil, izin hapus, riwayat). Hanya untuk is_superuser. Pembatasan di sini LAPISAN UI; yang sungguh-sungguh
// melarang adalah RLS di database (supabase/2026-11-26_izin_akun_modul.sql: can_manage_izin(), policy
// izin_admin_select/izin_admin_update, hak UPDATE per kolom, trigger allowed_users_guard). Akun non-admin yang
// memanggil API langsung tetap ditolak, halaman ini terbuka atau tidak.
//
// Pembagian file:
//   state.js   logika murni (form <-> baris, hitung perubahan, payload, label riwayat)  -> dites node --test
//   table.js   definisi kolom tabel (shared/data-table.js, mode client)
//   drawer.js  drawer izin + riwayat, alur simpan (cek konflik, UPDATE kolom yang berubah)
//   index.js   mount/unmount, muat data, pencarian, pintasan keyboard
//
// Yang boleh ditulis halaman ini cuma tiga kolom: boleh_hapus, boleh_hapus_sesi, modul_tersembunyi.
// email, role, is_superuser tidak bisa diubah lewat API (hak kolom dicabut), itu tetap lewat SQL Editor.
//
// AUTH: router.js baru mount() setelah shared/auth-gate.js lolos, jadi window.pnmSupabase dan PNMAuth sudah ada.
// Keduanya dibaca di dalam fungsi, bukan di module scope (modul ini di-import() sebelum login selesai).
//
// Listener dipasang di elemen di dalam container (ikut hilang saat router mengosongkan container), kecuali
// keydown pintasan (shared/shortcuts.js) dan popover data-table: dua-duanya dilepas di unmount().

import { PENGATURAN_MARKUP } from './markup.js';
import { createDataTable, filterRows, sortRows } from '../../../shared/data-table.js';
import { installShortcuts, applyShortcutHints } from '../../../shared/shortcuts.js';
import { IZIN_COLS, normalizeRow, matchSearch } from './state.js';
import { buildColumns, escapeHtml } from './table.js';
import { createDrawer } from './drawer.js';

const SHARED_LINKS = [
  { id: 'shared-google-fonts', href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400&display=swap' },
  { id: 'shared-pnm-universal-css', href: '/pnm-universal.css?v=20260813b' },
];

function loadLink(id, href) {
  if (document.getElementById(id)) return Promise.resolve();
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = () => resolve();
    link.onerror = () => resolve();
    document.head.appendChild(link);
  });
}

function ensureStyle() {
  return Promise.all([
    ...SHARED_LINKS.map(({ id, href }) => loadLink(id, href)),
    loadLink('page-pengaturan-style', new URL('./style.css', import.meta.url).href),
  ]);
}

let mountedContainer = null;
let root = null;
let rows = [];          // keadaan terakhir yang diketahui server, satu objek per akun
let meEmail = '';       // email akun yang sedang login (huruf kecil)
let query = '';         // isi kotak cari
let selectedEmail = null;
let dt = null;
let drawer = null;
let shortcutsDispose = null;
let loadSeq = 0;

const $ = (sel) => (root ? root.querySelector(sel) : null);

function setStatus(text, isError) {
  const el = $('#pgStatus');
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('is-error', !!isError);
}

// ── Tabel ────────────────────────────────────────────────────────────────────────────────────

let COLUMNS = [];

function visibleRows() {
  const st = dt.getState();
  const list = rows.filter((r) => matchSearch(r, query));
  return sortRows(filterRows(list, st.filters, COLUMNS), st.sort, COLUMNS, 'email');
}

function markRows(list) {
  const tbody = $('#pgBody');
  if (!tbody) return;
  Array.from(tbody.querySelectorAll('tr:not(.state-row)')).forEach((tr, i) => {
    const r = list[i];
    if (!r) return;
    tr.dataset.email = r.email;
    tr.classList.toggle('is-selected', r.email === selectedEmail);
    tr.setAttribute('aria-label', `Atur izin ${r.email}`);
  });
}

function refreshTable() {
  if (!root || !dt) return;
  const tbody = $('#pgBody');
  const list = visibleRows();
  const count = $('#pgCount');
  count.hidden = rows.length === 0;
  count.textContent = list.length === rows.length ? String(rows.length) : `${list.length}/${rows.length}`;

  if (!rows.length) { dt.showState(tbody, 'Belum ada akun di allowed_users.'); return; }
  if (!list.length) {
    const cari = query.trim();
    tbody.innerHTML = `<tr class="state-row"><td colspan="${COLUMNS.length}">${cari ? `Tidak ada akun yang cocok dengan “${escapeHtml(cari)}”.` : 'Tidak ada akun yang cocok dengan filter.'} <button type="button" class="dt-link" data-pg="reset">Reset</button></td></tr>`;
    return;
  }
  dt.renderBody(tbody, list);
  markRows(list);
}

// ── Muat data ────────────────────────────────────────────────────────────────────────────────

async function loadRows() {
  const seq = ++loadSeq;
  setStatus('Memuat akun…');
  let data = null;
  let error = null;
  try {
    ({ data, error } = await window.pnmSupabase.from('allowed_users').select(IZIN_COLS).order('email'));
  } catch (e) {
    error = e;
  }
  if (!root || !root.isConnected || seq !== loadSeq) return;
  if (error) {
    // 42703 = kolom tidak ada: migrasi belum dijalankan.
    const kolomHilang = error.code === '42703' || /modul_tersembunyi|boleh_hapus_sesi/.test(error.message || '');
    setStatus(kolomHilang
      ? 'Kolom izin belum ada di database. Jalankan migrasi izin akun (supabase/2026-11-26_izin_akun_modul.sql) di Supabase SQL Editor, lalu muat ulang halaman ini.'
      : 'Gagal memuat akun: ' + (error.message || error), true);
    const tbody = $('#pgBody');
    if (tbody) tbody.innerHTML = '';
    return;
  }
  rows = (data || []).map((r) => normalizeRow(r));
  setStatus('');
  refreshTable();
}

// ── Event ────────────────────────────────────────────────────────────────────────────────────

function openAccount(email, trigger) {
  selectedEmail = email;
  markRows(visibleRows());
  return drawer.open(email, trigger);
}

function onBodyClick(e) {
  if (e.target.closest && e.target.closest('[data-pg="reset"]')) {
    query = '';
    const input = $('#pgSearch');
    if (input) input.value = '';
    dt.reset(); // memicu onChange -> refreshTable
    refreshTable();
  }
}

function onSearchInput(e) {
  query = e.target.value;
  refreshTable();
}

function onSearchKey(e) {
  if (e.key === 'Escape' && e.target.value) { e.target.value = ''; query = ''; refreshTable(); e.stopPropagation(); }
}

function focusSearch() {
  const input = $('#pgSearch');
  if (!input) return false;
  input.focus();
  input.select();
  return true;
}

// ── Mount / unmount ──────────────────────────────────────────────────────────────────────────

export async function mount(container) {
  mountedContainer = container;
  await ensureStyle();
  container.classList.add('pg-page');
  container.innerHTML = PENGATURAN_MARKUP;
  root = container.querySelector('#pgRoot');

  // router.js sudah menolak non-admin sebelum sampai sini; ini sabuk kedua kalau halaman di-mount dari jalur lain.
  if (!window.PNMAuth?.isAdmin?.()) {
    setStatus('Halaman ini hanya untuk admin.', true);
    $('#pgTableCard').hidden = true;
    return;
  }

  try {
    const user = await window.PNMAuth.getUser();
    meEmail = String(user?.email || '').toLowerCase();
  } catch (_) { meEmail = ''; }
  if (!root || !root.isConnected) return;

  COLUMNS = buildColumns({ getRows: () => rows, getMe: () => meEmail });
  dt = createDataTable({
    id: 'pengaturan-akun',
    columns: COLUMNS,
    headRow: $('#pgHeadRow'),
    bar: $('#pgDtBar'),     // tombol "Kolom" tidak dipakai (semua kolom terkunci); bar hanya penampung
    chips: $('#pgDtChips'), // chip filter aktif + Reset
    defaultSort: { key: 'email', dir: 'asc' },
    tieBreak: 'email',
    onChange: () => refreshTable(),
    onRowClick: (r, _ctx) => {
      const tr = Array.from($('#pgBody').querySelectorAll('tr')).find((x) => x.dataset.email === r.email);
      openAccount(r.email, tr || null);
    },
    emptyText: 'Belum ada akun di allowed_users.',
    emptyFilteredText: 'Tidak ada akun yang cocok dengan filter.',
  });

  drawer = createDrawer({
    overlay: $('#pgOverlay'),
    confirmHost: $('#pgConfirm'),
    getRows: () => rows,
    getMe: () => meEmail,
    onRowUpdated: (saved) => {
      rows = rows.map((r) => (r.email === saved.email ? saved : r));
      refreshTable();
    },
    onClosed: () => {
      selectedEmail = null;
      markRows(visibleRows());
    },
  });

  $('#pgBody').addEventListener('click', onBodyClick);
  const search = $('#pgSearch');
  search.addEventListener('input', onSearchInput);
  search.addEventListener('keydown', onSearchKey);

  // Pintasan: "/" fokus ke cari (menang atas "/" milik sidebar), Esc menutup drawer (dengan pengaman perubahan).
  shortcutsDispose = installShortcuts('pengaturan', {
    'pengaturan.search': () => focusSearch(),
    'pengaturan.close': () => {
      if (!drawer || drawer.hasConfirm()) return false; // Esc milik dialog konfirmasi
      return drawer.escape();
    },
  });
  try { applyShortcutHints({ '#pgSearch': { ids: ['pengaturan.search'], base: 'Cari akun atau role' } }, root); } catch (_) { /* petunjuk pintasan bukan hal yang boleh menggagalkan halaman */ }

  await loadRows();
}

export function unmount() {
  // Yang dipasang di luar container harus dilepas: listener keydown pintasan, popover/listener data-table,
  // dialog konfirmasi yang masih terbuka. Listener di dalam container hilang bersama container.innerHTML = ''.
  loadSeq++;
  if (shortcutsDispose) { shortcutsDispose(); shortcutsDispose = null; }
  if (drawer) { drawer.destroy(); drawer = null; }
  if (dt) { dt.destroy(); dt = null; }
  mountedContainer?.classList.remove('pg-page');
  mountedContainer = null;
  root = null;
  rows = [];
  meEmail = '';
  query = '';
  selectedEmail = null;
  COLUMNS = [];
  // style.css halaman ini dilepas di sini (router memarkirnya, bukan membuangnya). Semua selector sudah di bawah `.pg-page`.
  document.getElementById('page-pengaturan-style')?.remove();
}
