// stok page markup (template string). Memakai pw-topbar dari shared nav; tombol
// theme-toggle halaman ini dihapus karena tema diatur global oleh shared nav.
// Card, dropzone, precheck panel, dan activity table memakai class pnm-universal.css;
// override page-scoped ada di style.css (.stat-pill .num, .metric .num, .act-num, dst).
//
// Tidak ada inline onclick/onchange/oninput (semua wiring addEventListener di
// index.js), jadi tidak ada fungsi yang perlu diekspos ke window.*.

export const STOK_MARKUP = `
<!-- AUTH: tidak ada login gate di halaman ini; router.js gak mount() halaman ini
     kecuali shared/auth-gate.js sudah lolos. -->
<div id="app-root">
<div class="pw-topbar">
  <div class="pw-topbar-crumb"><strong>Stock Inventory</strong></div>
</div>
<main>
  <div class="page-head">
    <h1>Stock Inventory</h1>
    <p>Upload &amp; perbarui stok harian untuk seluruh divisi.</p>
  </div>
  <!-- LAST SYNC / STATUS -->
  <div class="card" id="last-status-card">
    <div id="last-status-body">
      <div class="summary-empty">Memuat status terakhir…</div>
    </div>
  </div>
  <!-- UPLOAD -->
  <div class="card">
    <div class="card-head">
      <div class="icon-box blue"><i class="ti ti-cloud-upload"></i></div>
      <div class="card-head-text">
        <h2>Upload File Stok Baru</h2>
        <p>Upload file Excel harian dengan kolom <b>KODEASLI</b> dan <b>QTY</b>. Pastikan file yang diupload sudah data terbaru &amp; lengkap.</p>
      </div>
    </div>
    <label class="dropzone" id="dropzone">
      <div class="dropzone-icon"><i class="ti ti-upload"></i></div>
      <div class="dropzone-title">Drag &amp; drop file Excel di sini</div>
      <div class="dropzone-sub">atau klik untuk memilih file</div>
      <span class="dropzone-badge">Format: .xlsx, .xls</span>
      <input type="file" id="stok-file" accept=".xlsx,.xls"/>
    </label>
    <div class="file-row" id="file-chip" style="display:none">
      <div class="fico"><i class="ti ti-file-spreadsheet"></i></div>
      <div class="finfo">
        <div class="fname" id="file-chip-name"></div>
        <div class="fmeta" id="file-chip-meta"></div>
      </div>
      <button class="fdel" id="file-chip-remove" title="Hapus file"><i class="ti ti-trash"></i></button>
    </div>
    <div class="checking-row" id="checking-row" style="display:none">
      <div class="spinner"></div>
      <span id="checking-text">Membaca file…</span>
    </div>
    <div class="progress-track" id="progress-track" style="display:none">
      <div class="progress-fill" id="progress-fill" style="width:0%"></div>
    </div>
    <!-- PRA-PERIKSA -->
    <div id="precheck-panel" style="display:none">
      <div class="stat-row">
        <div class="stat-pill">
          <div class="num" id="stat-total">0</div>
          <div class="lbl">Total baris di file</div>
        </div>
        <div class="stat-pill ok">
          <div class="num" id="stat-match">0</div>
          <div class="lbl">Akan diperbarui</div>
        </div>
        <div class="stat-pill warn">
          <div class="num" id="stat-skip">0</div>
          <div class="lbl">Dilewati (belum terdaftar)</div>
        </div>
      </div>
      <div class="skip-panel" id="skip-panel" style="display:none">
        <div class="skip-head">
          <div class="skip-head-title"><i class="ti ti-alert-triangle"></i> Kode yang belum jadi produk kita, tapi ada stoknya</div>
          <div class="skip-actions">
            <button class="mini-btn" id="copy-skip-btn"><i class="ti ti-copy"></i>Salin</button>
            <button class="mini-btn" id="export-skip-btn"><i class="ti ti-download"></i>Export CSV</button>
          </div>
        </div>
        <p class="skip-note">Kode-kode ini ada di file stok tapi belum terdaftar di <b>master_produk</b> — stoknya <b>tidak akan tersimpan</b>. Teruskan ke tim yang mengelola pendaftaran produk kalau kode ini memang seharusnya sudah jadi produk.</p>
        <input type="text" class="skip-search" id="skip-search" placeholder="Cari kode…"/>
        <div class="skip-table-wrap">
          <table class="skip-table">
            <thead><tr><th>Kode Asli</th><th>Qty di file</th></tr></thead>
            <tbody id="skip-tbody"></tbody>
          </table>
        </div>
      </div>
    </div>
    <div class="actions-row" id="actions-row" style="display:none">
      <button id="stok-cancel-btn" class="btn-secondary">Batal</button>
      <button id="stok-upload-btn" class="btn-primary-lg" disabled><i class="ti ti-upload"></i>Upload Stock</button>
    </div>
    <div id="stok-status-msg"></div>
    <div class="trust-note"><i class="ti ti-shield-check"></i>Data stok akan menggantikan data stok sebelumnya. Pastikan file sudah sesuai sebelum upload.</div>
  </div>
  <!-- KELENGKAPAN STOK SET (diisi kelengkapan.js) -->
  <div class="card" id="kelengkapan-card"></div>
  <!-- RIWAYAT -->
  <div class="card">
    <div class="card-head">
      <div class="icon-box amber"><i class="ti ti-history"></i></div>
      <div class="card-head-text">
        <h2>Recent Activity</h2>
        <p>Riwayat upload stok dari seluruh divisi.</p>
      </div>
      <div class="card-head-action" style="display:flex;gap:8px">
        <button class="mini-btn" id="refresh-history-btn" title="Muat ulang riwayat"><i class="ti ti-refresh"></i>Refresh</button>
        <button class="mini-btn" id="show-more-btn" style="display:none">Lihat Semua <i class="ti ti-chevron-right"></i></button>
      </div>
    </div>
    <div style="overflow-x:auto">
      <table class="activity-table">
        <thead>
          <tr><th>Waktu</th><th>User</th><th>Updated</th><th>Skipped</th><th>File</th><th></th></tr>
        </thead>
        <tbody id="history-tbody"></tbody>
      </table>
    </div>
    <div id="history-empty" class="activity-empty" style="display:none">Belum ada riwayat upload.</div>
    <div class="local-note"><i class="ti ti-info-circle"></i><span id="local-note-text">Memuat riwayat…</span></div>
  </div>
</main>
<!-- Ganti window.confirm() bawaan browser (dialog abu-abu polos, gak ngikutin
     tema app) dengan overlay yang sama persis dipakai crud-produk buat
     "Perubahan belum disimpan" -- .confirm-overlay/.confirm-card/.confirm-actions
     sudah ada di pnm-universal.css dan generic (bukan crud-produk-only), tinggal
     dipakai ulang. Judul/pesan/tombol diisi dinamis lewat stokConfirm() di
     index.js, bukan hardcode kayak punya crud-produk, karena teksnya berubah-
     ubah (jumlah baris & kode yang dilewati beda tiap upload). -->
<div class="confirm-overlay" id="stokConfirmOverlay">
  <div class="confirm-card">
    <h3><i class="ti ti-alert-triangle" id="stokConfirmIcon"></i> <span id="stokConfirmTitle">Konfirmasi</span></h3>
    <p id="stokConfirmMsg"></p>
    <div class="confirm-actions">
      <button class="btn btn-ghost" id="stokConfirmCancelBtn" type="button">Batal</button>
      <button class="btn btn-accent" id="stokConfirmOkBtn" type="button">Lanjutkan</button>
    </div>
  </div>
</div>
</div>
`;