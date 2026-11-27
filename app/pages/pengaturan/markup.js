// pengaturan page markup (template string; zero-build, tidak ada bundler yang mengimpor .html sebagai teks).
//
// Cangkang statis saja. Dua tampilan (sub-route): User Management (#pgViewAkun) dan Riwayat Perubahan
// (#pgViewRiwayat, hidden sampai dibuka). Isi tabel (#pgBody / #pgHistBody), drawer (#pgDrawer) dan dialog
// konfirmasi (#pgConfirm) diisi oleh index.js / riwayat.js / drawer.js setelah data dari allowed_users / izin_audit tiba. Semua teks dari database
// di-escape di sana sebelum masuk innerHTML.
export const PENGATURAN_MARKUP = `
<div class="pw-topbar">
  <div class="pw-topbar-crumb">Pengaturan <span class="pw-topbar-crumb-sep">/</span> <strong id="pgCrumb">User Management</strong></div>
</div>

<div class="pg-main" id="pgRoot">
 <section id="pgViewAkun" aria-labelledby="pgTitleAkun">
  <header class="pg-head">
    <div class="pg-head-text">
      <h1 id="pgTitleAkun">User Management <span class="pg-count" id="pgCount" hidden></span></h1>
      <p>Atur modul yang tampil dan izin hapus tiap akun tim.</p>
    </div>
  </header>

  <div class="pg-toolbar">
    <label class="pg-search">
      <i class="ti ti-search" aria-hidden="true"></i>
      <input id="pgSearch" type="search" placeholder="Cari akun atau role" aria-label="Cari akun atau role" autocomplete="off" spellcheck="false">
      <kbd aria-hidden="true">/</kbd>
    </label>
    <div id="pgDtBar" hidden></div>
    <div id="pgDtChips" class="pg-chips" hidden></div>
  </div>

  <div id="pgStatus" class="pg-status" role="status" aria-live="polite"></div>

  <div class="pg-table-card" id="pgTableCard">
    <div class="pg-table-scroll">
      <table class="pg-table">
        <thead><tr id="pgHeadRow"></tr></thead>
        <tbody id="pgBody"></tbody>
      </table>
    </div>
  </div>
 </section>

 <section id="pgViewRiwayat" aria-labelledby="pgTitleRiwayat" hidden>
  <header class="pg-head">
    <div class="pg-head-text">
      <h1 id="pgTitleRiwayat">Riwayat Perubahan <span class="pg-count" id="pgHistCount" hidden></span></h1>
      <p>Siapa mengubah izin akun siapa, dan kapan. Dicatat otomatis oleh database.</p>
    </div>
  </header>

  <div class="pg-toolbar">
    <div id="pgHistBar" hidden></div>
    <div id="pgHistChips" class="pg-chips" hidden></div>
    <p class="pg-hint" id="pgHistHint">Klik judul kolom untuk menyaring menurut waktu, pelaku, akun, atau jenis perubahan.</p>
  </div>

  <div id="pgHistStatus" class="pg-status" role="status" aria-live="polite"></div>

  <div class="pg-table-card" id="pgHistCard">
    <div class="pg-table-scroll">
      <table class="pg-table pg-hist-table">
        <thead><tr id="pgHistHeadRow"></tr></thead>
        <tbody id="pgHistBody"></tbody>
      </table>
    </div>
    <div class="pg-pager" id="pgHistPager" hidden>
      <span class="pg-pager-info" id="pgHistPagerInfo" aria-live="polite"></span>
      <div class="pg-pager-btns">
        <button type="button" class="pg-btn" data-pg-page="prev" aria-label="Halaman sebelumnya"><i class="ti ti-chevron-left" aria-hidden="true"></i></button>
        <button type="button" class="pg-btn" data-pg-page="next" aria-label="Halaman berikutnya"><i class="ti ti-chevron-right" aria-hidden="true"></i></button>
      </div>
    </div>
  </div>
 </section>

  <div class="modal-overlay pg-overlay" id="pgOverlay"></div>
  <div class="confirm-overlay pg-confirm-overlay" id="pgConfirm"></div>
</div>
`;
