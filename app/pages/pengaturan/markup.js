// pengaturan page markup (template string; zero-build, tidak ada bundler yang mengimpor .html sebagai teks).
//
// Cangkang statis saja. Isi tabel (#pgBody), drawer (#pgDrawer) dan dialog konfirmasi (#pgConfirm) diisi
// oleh index.js / drawer.js setelah data dari allowed_users / izin_audit tiba. Semua teks dari database
// di-escape di sana sebelum masuk innerHTML.
export const PENGATURAN_MARKUP = `
<div class="pw-topbar">
  <div class="pw-topbar-crumb"><strong>Pengaturan</strong></div>
</div>

<div class="pg-main" id="pgRoot">
  <header class="pg-head">
    <div class="pg-head-text">
      <h1>User Management <span class="pg-count" id="pgCount" hidden></span></h1>
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

  <div class="modal-overlay pg-overlay" id="pgOverlay"></div>
  <div class="confirm-overlay pg-confirm-overlay" id="pgConfirm"></div>
</div>
`;
