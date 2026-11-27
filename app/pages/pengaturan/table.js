// Tabel akun halaman Pengaturan: definisi kolom untuk shared/data-table.js (mode client: semua akun sudah
// dimuat penuh, jadi sortRows/filterRows dipakai di browser) + penggambar sel. Penegakan izin TIDAK di sini:
// tabel hanya menampilkan apa yang boleh dibaca akun admin ini lewat RLS.
import { NIL_HTML } from '../../../shared/data-table.js';
import { modulCategory, modulSummary, hapusLevel, initialOf, roleOptions } from './state.js';
import { localStamp, formatWaktu } from './audit.js';

export const escapeHtml = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

// ctx: { getRows(): row[], getMe(): string, getTerakhir(): Map|null }  -- diambil saat render, bukan saat modul di-load.
// getTerakhir() = email huruf kecil -> instan perubahan terakhir (view izin_audit_terakhir). null = view belum ada /
// tidak terbaca: kolom "Terakhir diubah" TIDAK dibuat sama sekali (bukan diisi "—", yang terbaca "belum pernah diubah").
// Dipanggil sesudah getTerakhir() terisi (index.js memuatnya sebelum membangun kolom).
export function buildColumns(ctx) {
  const terakhirOf = (r) => { const m = ctx.getTerakhir && ctx.getTerakhir(); return m ? (m.get(r.email.toLowerCase()) || null) : null; };
  const terakhirCol = ctx.getTerakhir && ctx.getTerakhir() ? [{
    key: 'terakhir', label: 'Terakhir diubah', type: 'date', locked: true,
    get: (r) => localStamp(terakhirOf(r)), // zona waktu browser, supaya filter tanggal tidak bergeser dini hari WIB
    render: (r) => { const t = terakhirOf(r); return t ? `<span class="pg-when">${escapeHtml(formatWaktu(t))}</span>` : NIL_HTML; },
  }] : [];
  const HAPUS_LEVELS = ['Penuh', 'Clipboard', 'Tidak'];
  return [
    {
      key: 'email', label: 'Akun', type: 'text', locked: true,
      render: (r) => {
        const me = r.email.toLowerCase() === ctx.getMe();
        return `<span class="pg-acct"><span class="pg-avatar" aria-hidden="true">${escapeHtml(initialOf(r.email))}</span>`
          + `<span class="pg-acct-email">${escapeHtml(r.email)}</span>${me ? '<span class="pg-tag pg-tag-me">Kamu</span>' : ''}</span>`;
      },
    },
    {
      key: 'role', label: 'Role', type: 'enum', locked: true,
      options: () => roleOptions(ctx.getRows()),
      render: (r) => {
        const role = r.role ? `<span class="pg-role">${escapeHtml(r.role)}</span>` : NIL_HTML;
        return `${role}${r.is_superuser ? ' <span class="pg-tag pg-tag-admin">Admin</span>' : ''}`;
      },
    },
    {
      key: 'modul', label: 'Modul', type: 'enum', locked: true,
      get: modulCategory,
      options: ['Akses penuh', 'Semua tampil', 'Sebagian disembunyikan'],
      fillFilter: false,
      render: (r) => {
        const partial = !r.is_superuser && r.modul_tersembunyi.length > 0;
        return `<span class="pg-sum${partial ? ' is-partial' : ''}">${escapeHtml(modulSummary(r))}</span>`;
      },
    },
    {
      key: 'hapus', label: 'Izin hapus', type: 'enum', locked: true,
      get: hapusLevel,
      options: HAPUS_LEVELS,
      fillFilter: false,
      render: (r) => {
        const lv = hapusLevel(r);
        return `<span class="pg-hapus pg-hapus-${lv.toLowerCase()}">${lv === 'Penuh' ? '<i class="ti ti-alert-triangle" aria-hidden="true"></i>' : ''}${escapeHtml(lv)}</span>`;
      },
    },
    ...terakhirCol,
    {
      key: 'aksi', label: '', locked: true, sortable: false, filterable: false, td: 'pg-td-aksi',
      render: () => '<i class="ti ti-chevron-right pg-chev" aria-hidden="true"></i>',
    },
  ];
}
