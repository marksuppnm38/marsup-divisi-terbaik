// stok page markup (template string). Memakai pw-topbar dari shared nav; tombol
// theme-toggle halaman ini dihapus karena tema diatur global oleh shared nav.
// Card, dropzone, precheck panel, dan activity table memakai class pnm-universal.css;
// override page-scoped ada di style.css (.stat-pill .num, .metric .num, .act-num, dst).
//
// Tidak ada inline onclick/onchange/oninput (semua wiring addEventListener di
// index.js), jadi tidak ada fungsi yang perlu diekspos ke window.*.
//
// Visibilitas elemen dikendalikan atribut `hidden` (bukan style="display:none"),
// di-toggle dari index.js lewat `el.hidden = true/false`. Aturan `[hidden]` di
// style.css memastikan atribut ini menang atas `display:flex/grid` milik class.
//
// Satu judul halaman saja: breadcrumb topbar. Dulu h1 "Stock Inventory" +
// subjudul mengulang breadcrumb yang sama persis tepat di bawahnya.

export const STOK_MARKUP = `
<!-- AUTH: tidak ada login gate di halaman ini; router.js gak mount() halaman ini
     kecuali shared/auth-gate.js sudah lolos. -->
<div id="app-root">
<div class="pw-topbar">
  <div class="pw-topbar-crumb"><strong>Stock Inventory</strong></div>
</div>
<main>
  <!-- SINKRON TERAKHIR -->
  <section class="card" id="last-status-card" aria-label="Sinkron terakhir">
    <div id="last-status-body">
      <div class="summary-empty">Memuat status terakhir…</div>
    </div>
  </section>
  <!-- UPLOAD -->
  <section class="card" aria-labelledby="upload-title">
    <div class="card-head">
      <div class="card-head-text">
        <h2 id="upload-title">Upload stok</h2>
        <p>File Excel dengan kolom <b>KODEASLI</b> dan <b>QTY</b>. Isinya menggantikan seluruh data stok yang ada, jadi pastikan file sudah yang terbaru dan lengkap.</p>
      </div>
    </div>
    <label class="dropzone" id="dropzone">
      <div class="dropzone-icon" aria-hidden="true"><i class="ti ti-upload"></i></div>
      <div class="dropzone-title">Tarik file Excel ke sini</div>
      <div class="dropzone-sub">atau klik untuk memilih · .xlsx, .xls · maksimal 50 MB</div>
      <input type="file" id="stok-file" accept=".xlsx,.xls" aria-label="Pilih file stok Excel"/>
    </label>
    <div class="file-row" id="file-chip" hidden>
      <div class="fico" aria-hidden="true"><i class="ti ti-file-spreadsheet"></i></div>
      <div class="finfo">
        <div class="fname" id="file-chip-name"></div>
        <div class="fmeta" id="file-chip-meta"></div>
      </div>
      <button class="fdel" id="file-chip-remove" type="button" title="Hapus file" aria-label="Hapus file"><i class="ti ti-trash" aria-hidden="true"></i></button>
    </div>
    <div class="checking-row" id="checking-row" role="status" hidden>
      <div class="spinner" aria-hidden="true"></div>
      <span id="checking-text">Membaca file…</span>
    </div>
    <div class="progress-track" id="progress-track" role="progressbar" aria-label="Memeriksa kode ke database" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" hidden>
      <div class="progress-fill" id="progress-fill" style="width:0%"></div>
    </div>
    <!-- PRA-PERIKSA -->
    <div id="precheck-panel" hidden>
      <div class="stat-row" role="group" aria-label="Hasil pra-periksa file">
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
      <div class="skip-panel" id="skip-panel" hidden>
        <div class="skip-head">
          <div class="skip-head-title">Kode belum terdaftar, stoknya tidak akan tersimpan</div>
          <div class="skip-actions">
            <button class="mini-btn" id="copy-skip-btn" type="button"><i class="ti ti-copy" aria-hidden="true"></i>Salin</button>
            <button class="mini-btn" id="export-skip-btn" type="button"><i class="ti ti-download" aria-hidden="true"></i>Export CSV</button>
          </div>
        </div>
        <p class="skip-note">Kode ini ada di file tetapi belum terdaftar di <b>master_produk</b>. Teruskan ke tim yang mengelola pendaftaran produk bila kode ini seharusnya sudah terdaftar.</p>
        <input type="text" class="skip-search" id="skip-search" placeholder="Cari kode…" aria-label="Cari kode yang dilewati" autocomplete="off"/>
        <div class="skip-table-wrap">
          <table class="skip-table">
            <thead><tr><th scope="col">Kode asli</th><th scope="col" class="num">Qty di file</th></tr></thead>
            <tbody id="skip-tbody"></tbody>
          </table>
        </div>
      </div>
    </div>
    <div class="actions-row" id="actions-row" hidden>
      <button id="stok-cancel-btn" class="btn-secondary" type="button">Batal</button>
      <button id="stok-upload-btn" class="btn-primary-lg" type="button" disabled><i class="ti ti-upload" aria-hidden="true"></i>Upload stok</button>
    </div>
    <div id="stok-status-msg" role="status" aria-live="polite"></div>
  </section>
  <!-- KELENGKAPAN STOK SET (diisi kelengkapan.js) -->
  <section class="card" id="kelengkapan-card" aria-labelledby="kel-title"></section>
  <!-- RIWAYAT -->
  <section class="card" aria-labelledby="riwayat-title">
    <div class="card-head">
      <div class="card-head-text">
        <h2 id="riwayat-title">Riwayat upload</h2>
      </div>
      <div class="card-head-action card-head-actions">
        <button class="mini-btn" id="refresh-history-btn" type="button" title="Muat ulang riwayat"><i class="ti ti-refresh" aria-hidden="true"></i>Muat ulang</button>
        <button class="mini-btn" id="show-more-btn" type="button" hidden>Lihat semua <i class="ti ti-chevron-right" aria-hidden="true"></i></button>
      </div>
    </div>
    <div class="table-scroll">
      <table class="activity-table">
        <thead>
          <tr><th scope="col">Waktu</th><th scope="col">Pengguna</th><th scope="col" class="num">Diperbarui</th><th scope="col" class="num">Dilewati</th><th scope="col">File</th><th scope="col"><span class="sr-only">Unduh kode yang dilewati</span></th></tr>
        </thead>
        <tbody id="history-tbody">
          <tr><td colspan="6" class="activity-empty">Memuat riwayat…</td></tr>
        </tbody>
      </table>
    </div>
    <div id="history-empty" class="activity-empty" hidden>Belum ada riwayat upload.</div>
    <div id="history-msg" role="status" aria-live="polite"></div>
    <div class="local-note"><i class="ti ti-info-circle" aria-hidden="true"></i><span id="local-note-text">Memuat riwayat…</span></div>
  </section>
</main>
<!-- Dialog konfirmasi: pakai .confirm-overlay/.confirm-card/.confirm-actions dari
     pnm-universal.css (generic, sama dengan "Perubahan belum disimpan" di crud-produk).
     Judul/pesan/tombol diisi dinamis lewat stokConfirm() di index.js. role=alertdialog
     karena ini konfirmasi aksi destruktif; fokus, Esc, dan jebakan Tab ditangani di
     index.js. -->
<div class="confirm-overlay" id="stokConfirmOverlay">
  <div class="confirm-card" id="stokConfirmCard" role="alertdialog" aria-modal="true" aria-labelledby="stokConfirmTitle" aria-describedby="stokConfirmMsg" tabindex="-1">
    <h3><i class="ti ti-alert-triangle" id="stokConfirmIcon" aria-hidden="true"></i> <span id="stokConfirmTitle">Konfirmasi</span></h3>
    <p id="stokConfirmMsg"></p>
    <div class="confirm-actions">
      <button class="btn btn-ghost" id="stokConfirmCancelBtn" type="button">Batal</button>
      <button class="btn btn-accent" id="stokConfirmOkBtn" type="button">Lanjutkan</button>
    </div>
  </div>
</div>
</div>
`;
