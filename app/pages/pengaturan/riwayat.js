// Tampilan "Riwayat Perubahan" (sub-route /pengaturan/riwayat): semua perubahan izin akun, terbaru di atas.
//
// Data = tabel izin_audit, ditulis otomatis oleh trigger database; view ini hanya membaca. Sort/filter/paging
// dikerjakan SERVER-SIDE (log terus bertambah, tidak boleh dimuat penuh ke browser). Filter lewat judul kolom
// (shared/data-table.js): Waktu (rentang tanggal), Oleh, Akun, Yang diubah. Penyusunan query ada di audit.js.
//
// Dibuat malas: tidak ada query sebelum tampilan ini dibuka. Listener ada di dalam container (ikut hilang saat
// router mengosongkan container) kecuali popover data-table, yang dilepas lewat destroy().
import { createDataTable, NIL_HTML } from '../../../shared/data-table.js';
import { escapeHtml } from './table.js';
import { describeAudit, KOLOM_LABEL } from './state.js';
import { AUDIT_PAGE_SIZE, KOLOM_OPTIONS, fetchAuditPage, formatWaktu, waktuPresets } from './audit.js';

function buildHistColumns() {
  return [
    {
      key: 'waktu', label: 'Waktu', type: 'date', locked: true, fillFilter: false, datePresets: waktuPresets(),
      td: 'pg-td-waktu',
      render: (r) => `<time datetime="${escapeHtml(r.waktu)}">${escapeHtml(formatWaktu(r.waktu))}</time>`,
    },
    {
      key: 'oleh', label: 'Oleh', type: 'text', locked: true, fillFilter: false,
      render: (r) => (r.oleh ? escapeHtml(r.oleh) : NIL_HTML),
    },
    {
      key: 'email_target', label: 'Akun', type: 'text', locked: true, fillFilter: false,
      render: (r) => (r.email_target ? escapeHtml(r.email_target) : NIL_HTML),
    },
    {
      key: 'kolom', label: 'Yang diubah', type: 'enum', locked: true, fillFilter: false, options: KOLOM_OPTIONS,
      render: (r) => escapeHtml(KOLOM_LABEL[r.kolom] || r.kolom || ''),
    },
    {
      key: 'perubahan', label: 'Perubahan', locked: true, sortable: false, filterable: false, td: 'pg-td-ubah',
      render: (r) => escapeHtml(describeAudit(r)),
    },
  ];
}

// root = elemen #pgViewRiwayat. Mengembalikan { show, hide, destroy }.
export function createRiwayat({ root }) {
  const $ = (sel) => root.querySelector(sel);
  const columns = buildHistColumns();
  let dt = null;
  let page = 1;
  let total = 0;
  let seq = 0;

  function setStatus(text, isError) {
    const el = $('#pgHistStatus');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('is-error', !!isError);
  }

  function renderPager() {
    const pager = $('#pgHistPager');
    const count = $('#pgHistCount');
    const hasRows = total > 0;
    pager.hidden = !hasRows;
    count.hidden = !hasRows;
    count.textContent = String(total);
    if (!hasRows) return;
    const from = (page - 1) * AUDIT_PAGE_SIZE + 1;
    const to = Math.min(page * AUDIT_PAGE_SIZE, total);
    $('#pgHistPagerInfo').textContent = `${from}–${to} dari ${total}`;
    pager.querySelector('[data-pg-page="prev"]').disabled = page <= 1;
    pager.querySelector('[data-pg-page="next"]').disabled = page * AUDIT_PAGE_SIZE >= total;
  }

  async function load() {
    if (!dt) return;
    const my = ++seq;
    const tbody = $('#pgHistBody');
    setStatus('');
    dt.setLoading(tbody);
    const res = await fetchAuditPage(window.pnmSupabase, { state: dt.getState(), columns, page });
    if (my !== seq || !dt || !root.isConnected) return; // sudah pindah halaman / filter lain / tampilan ditutup

    if (res.error) {
      // PGRST103 = halaman di luar jangkauan (mis. baris berkurang sejak terakhir dimuat): kembali ke halaman 1.
      if (page > 1 && res.error.code === 'PGRST103') { page = 1; load(); return; }
      // 42P01 = tabel tidak ada: migrasi izin akun belum dijalankan.
      const hilang = res.error.code === '42P01' || /izin_audit/.test(res.error.message || '');
      setStatus(hilang
        ? 'Riwayat belum tersedia. Jalankan migrasi izin akun (supabase/2026-11-26_izin_akun_modul.sql) di Supabase SQL Editor, lalu muat ulang halaman ini.'
        : 'Gagal memuat riwayat: ' + (res.error.message || res.error), true);
      tbody.innerHTML = '';
      total = 0;
      renderPager();
      return;
    }

    total = res.total;
    renderPager();
    if (!res.rows.length) {
      dt.showState(tbody, dt.hasFilters() ? 'Tidak ada perubahan yang cocok dengan filter.' : 'Belum ada perubahan izin yang tercatat.', { reset: dt.hasFilters() });
      return;
    }
    dt.renderBody(tbody, res.rows);
  }

  const onPagerClick = (e) => {
    const b = e.target.closest && e.target.closest('[data-pg-page]');
    if (!b || b.disabled) return;
    page += b.dataset.pgPage === 'next' ? 1 : -1;
    load();
    root.querySelector('#pgHistCard')?.scrollIntoView?.({ block: 'nearest' });
  };

  function init() {
    dt = createDataTable({
      id: 'pengaturan-riwayat',
      columns,
      headRow: $('#pgHistHeadRow'),
      bar: $('#pgHistBar'),     // penampung saja: tombol "Kolom" tidak dipakai (semua kolom terkunci)
      chips: $('#pgHistChips'), // chip filter aktif + Reset
      defaultSort: { key: 'waktu', dir: 'desc' },
      onChange: () => { page = 1; load(); },
      emptyText: 'Belum ada perubahan izin yang tercatat.',
      emptyFilteredText: 'Tidak ada perubahan yang cocok dengan filter.',
    });
    $('#pgHistPager').addEventListener('click', onPagerClick);
  }

  return {
    // Dibuka (pertama kali maupun kembali dari tampilan lain): muat ulang, karena akun mungkin baru disimpan.
    show() {
      root.hidden = false;
      if (!dt) init();
      load();
    },
    hide() {
      seq++; // batalkan permintaan yang masih jalan
      root.hidden = true;
    },
    destroy() {
      seq++;
      if (dt) { dt.destroy(); dt = null; }
    },
  };
}
