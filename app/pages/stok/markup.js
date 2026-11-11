// stok page markup (template string). Memakai pw-topbar dari shared nav; tema diatur
// global oleh shared nav. Class card/dropzone/activity-table/confirm-* berasal dari
// pnm-universal.css; semua override halaman ini ada di style.css (scoped #app-root).
//
// Tidak ada inline onclick/onchange/oninput (semua wiring addEventListener di
// index.js), jadi tidak ada fungsi yang perlu diekspos ke window.*.
//
// Visibilitas elemen dikendalikan atribut `hidden`, di-toggle dari index.js lewat
// `el.hidden = true/false`. Aturan `[hidden]` di style.css memastikan atribut ini
// menang atas `display:flex/grid` milik class.
//
// Satu judul halaman saja: breadcrumb topbar. Status sinkron terakhir adalah satu
// baris teks (bukan kartu) karena isinya sama dengan baris pertama riwayat upload.

export const STOK_MARKUP = `
<div id="app-root">
<div class="pw-topbar">
  <div class="pw-topbar-crumb"><strong>Stock Inventory</strong></div>
</div>
<main>
  <!-- STATUS SINKRON TERAKHIR (diisi renderLastStatus di index.js) -->
  <div class="sync-line" id="last-status-body" role="status">Memuat status terakhir…</div>

  <!-- UPLOAD -->
  <section class="card" aria-labelledby="upload-title">
    <div class="card-head">
      <div class="card-head-text">
        <h2 id="upload-title">Upload stok</h2>
        <p>File Excel dengan kolom <b>KODEASLI</b> dan <b>QTY</b>. Isi file menggantikan seluruh data stok yang ada.</p>
      </div>
    </div>
    <label class="dropzone" id="dropzone">
      <div class="dropzone-title">Tarik file Excel ke sini, atau klik untuk memilih</div>
      <div class="dropzone-sub">.xlsx atau .xls, maksimal 50 MB</div>
      <input type="file" id="stok-file" accept=".xlsx,.xls" aria-label="Pilih file stok Excel"/>
    </label>
    <div class="file-row" id="file-chip" hidden>
      <div class="finfo">
        <div class="fname" id="file-chip-name"></div>
        <div class="fmeta" id="file-chip-meta"></div>
      </div>
      <button class="mini-btn" id="file-chip-remove" type="button">Hapus</button>
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
      <div class="precheck" role="group" aria-label="Hasil pra-periksa file">
        <div><b id="stat-total">0</b><span>baris di file</span></div>
        <div><b id="stat-match">0</b><span>akan diperbarui</span></div>
        <div class="warn"><b id="stat-skip">0</b><span>dilewati (belum terdaftar)</span></div>
      </div>
      <div class="skip-panel" id="skip-panel" hidden>
        <div class="skip-head">
          <div class="skip-head-title">Kode belum terdaftar, stoknya tidak akan tersimpan</div>
          <div class="skip-actions">
            <button class="mini-btn" id="copy-skip-btn" type="button">Salin</button>
            <button class="mini-btn" id="export-skip-btn" type="button">Export CSV</button>
          </div>
        </div>
        <p class="skip-note">Kode ini ada di file tetapi belum ada di <b>master_produk</b>. Teruskan ke tim pendaftaran produk bila seharusnya sudah terdaftar.</p>
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
      <button id="stok-upload-btn" class="btn-primary-lg" type="button" disabled>Upload stok</button>
    </div>
    <div id="stok-status-msg" role="status" aria-live="polite"></div>
  </section>

  <!-- KELENGKAPAN STOK SET (diisi kelengkapan.js) -->
  <section class="card" id="kelengkapan-card" aria-labelledby="kel-title"></section>

  <!-- SIAP TAYANG: ada link e-Katalog + stok ready (diisi siap-tayang.js) -->
  <section class="card" id="siap-card" aria-labelledby="siap-title"></section>

  <!-- RIWAYAT -->
  <section class="card" aria-labelledby="riwayat-title">
    <div class="card-head">
      <div class="card-head-text">
        <h2 id="riwayat-title">Riwayat upload</h2>
      </div>
      <div class="card-head-action card-head-actions">
        <button class="mini-btn" id="refresh-history-btn" type="button">Muat ulang</button>
        <button class="mini-btn" id="show-more-btn" type="button" hidden>Lihat semua</button>
      </div>
    </div>
    <div class="table-scroll">
      <table class="activity-table">
        <thead>
          <tr><th scope="col">Waktu</th><th scope="col">Pengguna</th><th scope="col" class="num">Diperbarui</th><th scope="col" class="num">Dilewati</th><th scope="col">File</th><th scope="col">Kode dilewati</th></tr>
        </thead>
        <tbody id="history-tbody">
          <tr><td colspan="6" class="activity-empty">Memuat riwayat…</td></tr>
        </tbody>
      </table>
    </div>
    <div id="history-empty" class="activity-empty" hidden>Belum ada riwayat upload.</div>
    <div id="history-msg" role="status" aria-live="polite"></div>
    <p class="local-note" id="local-note-text">Memuat riwayat…</p>
  </section>
</main>
<!-- Dialog konfirmasi: pakai .confirm-overlay/.confirm-card/.confirm-actions dari
     pnm-universal.css. Judul/pesan/tombol diisi dinamis lewat stokConfirm() di
     index.js. role=alertdialog karena ini konfirmasi aksi destruktif; fokus, Esc,
     dan jebakan Tab ditangani di index.js. -->
<div class="confirm-overlay" id="stokConfirmOverlay">
  <div class="confirm-card" id="stokConfirmCard" role="alertdialog" aria-modal="true" aria-labelledby="stokConfirmTitle" aria-describedby="stokConfirmMsg" tabindex="-1">
    <h3 id="stokConfirmTitle">Konfirmasi</h3>
    <p id="stokConfirmMsg"></p>
    <div class="confirm-actions">
      <button class="btn btn-ghost" id="stokConfirmCancelBtn" type="button">Batal</button>
      <button class="btn btn-accent" id="stokConfirmOkBtn" type="button">Lanjutkan</button>
    </div>
  </div>
</div>
</div>
`;