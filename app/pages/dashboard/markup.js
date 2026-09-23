// dashboard page markup: the original dashboard.html body content
// (auth-gate through detail-modal-overlay), ported with the structural
// change from design.md's migration checklist step 1 (old per-page
// <header> replaced by the shared pw-topbar) in sesi kelima belas.
//
// UPDATE (sesi retrofit design.md): steps 2-6 (color/spacing/icon/status
// tokens) done this session -- see style.css in this folder for the full
// rationale. The only markup.js change needed for that was stripping the
// per-instance inline `style="color:var(--success/accent/warning/purple)"`
// on prog-card-title/insight-card-title icons (design.md: icon color
// shouldn't carry per-card meaning) -- everything else (stat-card/chip/
// badge/days-pill color removal) is handled purely via CSS specificity in
// style.css, no other markup change needed.
//
// Theme-init <script> from the original <head> is NOT here -- <script>
// elements inside HTML assigned via innerHTML don't execute (DOM quirk),
// so that logic moved into index.js's mount() as real JS instead.

export const DASHBOARD_MARKUP = `
<!-- Sesi kesembilan belas: per-page auth-gate DIHAPUS -- router.js sekarang
     gak pernah mount() halaman ini kecuali shared/auth-gate.js sudah
     konfirmasi sesi valid + whitelisted, jadi #app-root gak perlu lagi
     nunggu/nge-toggle display:none -- always visible dari awal. -->
<div id="app-root">
<div class="pw-topbar">
  <div class="pw-topbar-crumb"><strong>Dashboard Produk</strong></div>
  <div class="pw-topbar-actions">
    <span class="last-update"><i class="ti ti-refresh" id="refresh-icon"></i> <span id="last-update-text">Memuat…</span></span>
    <button class="toggle-btn" id="reload-btn" title="Muat ulang"><i class="ti ti-rotate-clockwise"></i> Muat ulang</button>
  </div>
</div>

<main>

  <div class="err-banner" id="err-banner" role="alert"><i class="ti ti-alert-circle"></i> <span id="err-text"></span></div>

  <div class="section-label"><i class="ti ti-refresh"></i> Konversi Hari Ini</div>
  <div class="stats-grid" id="stats-grid-konversi">
    <div class="stat-card blue"><div class="skeleton" style="width:60%;height:25px;margin-bottom:8px"></div><div class="skeleton" style="width:40%"></div></div>
    <div class="stat-card green"><div class="skeleton" style="width:60%;height:25px;margin-bottom:8px"></div><div class="skeleton" style="width:40%"></div></div>
    <div class="stat-card purple"><div class="skeleton" style="width:60%;height:25px;margin-bottom:8px"></div><div class="skeleton" style="width:40%"></div></div>
  </div>

  <div class="section-label"><i class="ti ti-database"></i> Ringkasan Database</div>
  <div class="stats-grid" id="stats-grid">
    <div class="stat-card blue"><div class="skeleton" style="width:60%;height:25px;margin-bottom:8px"></div><div class="skeleton" style="width:40%"></div></div>
    <div class="stat-card green"><div class="skeleton" style="width:60%;height:25px;margin-bottom:8px"></div><div class="skeleton" style="width:40%"></div></div>
    <div class="stat-card warning"><div class="skeleton" style="width:60%;height:25px;margin-bottom:8px"></div><div class="skeleton" style="width:40%"></div></div>
    <div class="stat-card purple"><div class="skeleton" style="width:60%;height:25px;margin-bottom:8px"></div><div class="skeleton" style="width:40%"></div></div>
    <div class="stat-card danger"><div class="skeleton" style="width:60%;height:25px;margin-bottom:8px"></div><div class="skeleton" style="width:40%"></div></div>
  </div>

  <div class="section-label"><i class="ti ti-chart-bar"></i> Kelengkapan Data</div>
  <div class="prog-cards">
    <div class="prog-card">
      <div class="prog-card-title"><i class="ti ti-cash"></i> Harga e-Katalog</div>
      <div id="prog-harga">
        <div class="skeleton" style="height:36px;margin-bottom:9px"></div>
        <div class="skeleton" style="height:36px;margin-bottom:9px"></div>
        <div class="skeleton" style="height:36px"></div>
      </div>
    </div>
    <div class="prog-card">
      <div class="prog-card-title"><i class="ti ti-link"></i> e-Katalog v6</div>
      <div id="prog-link">
        <div class="skeleton" style="height:36px;margin-bottom:9px"></div>
        <div class="skeleton" style="height:36px"></div>
      </div>
    </div>
    <div class="prog-card">
      <div class="prog-card-title"><i class="ti ti-rosette-discount-check"></i> Nomor AKD</div>
      <div id="prog-akd">
        <div class="skeleton" style="height:36px;margin-bottom:9px"></div>
        <div class="skeleton" style="height:36px"></div>
      </div>
    </div>
  </div>
<div class="section-label"><i class="ti ti-trend-up"></i> Insight Konversi</div>
  <div class="insight-cards">
<div class="insight-grid">
    <div class="insight-col-left">
      <div class="insight-card">
        <div class="insight-card-title"><i class="ti ti-chart-bar"></i> Trend 7 Hari Terakhir <a class="insight-link" href="/konversian/riwayat" data-nav="/konversian/riwayat">Riwayat <i class="ti ti-arrow-right"></i></a></div>
        <div id="trend-chart-box"><div class="skeleton" style="height:120px"></div></div>
      </div>
      <div class="insight-card">
        <div class="insight-card-title"><i class="ti ti-chart-line"></i> Trend Value Harian (7 hari) <a class="insight-link" href="/konversian/riwayat" data-nav="/konversian/riwayat">Riwayat <i class="ti ti-arrow-right"></i></a></div>
        <div id="linechart-box"><div class="skeleton" style="height:150px"></div></div>
      </div>
      <div class="insight-card">
        <div class="insight-card-title"><i class="ti ti-chart-donut"></i> Distribusi Kategori (30 hari) <a class="insight-link" href="/konversian/riwayat" data-nav="/konversian/riwayat">Riwayat <i class="ti ti-arrow-right"></i></a></div>
        <div id="donut-chart-box"><div class="skeleton" style="height:140px"></div></div>
      </div>
    </div>
    <div class="insight-card insight-card-tall">
      <div class="insight-card-title"><i class="ti ti-trophy"></i> Leaderboard Sales
        <select class="filter-select" id="leaderboard-period-filter" style="margin-left:6px;min-width:0;font-size:11.5px;padding:2px 20px 2px 8px" title="Periode leaderboard">
          <option value="7">7 Hari</option>
          <option value="30" selected>30 Hari</option>
          <option value="90">90 Hari</option>
          <option value="365">Semua (1 Thn)</option>
        </select>
        <a class="insight-link" href="/konversian/riwayat" data-nav="/konversian/riwayat">Riwayat <i class="ti ti-arrow-right"></i></a></div>
      <div id="leaderboard-box">
        <div class="skeleton" style="height:38px;margin-bottom:8px"></div>
        <div class="skeleton" style="height:38px;margin-bottom:8px"></div>
        <div class="skeleton" style="height:38px"></div>
      </div>
    </div>
  </div>
  <div class="section-label"><i class="ti ti-hierarchy-2"></i> Peta Kebutuhan ↔ SKU</div>
  <div class="insight-card" style="margin-bottom:26px">
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:14px">
      <div class="insight-card-title" style="margin-bottom:0"><i class="ti ti-share"></i> Word Tree — Kebutuhan Customer ke SKU <a class="insight-link" href="/konversian/dictionary" data-nav="/konversian/dictionary">Dictionary <i class="ti ti-arrow-right"></i></a></div>
      <select class="filter-select" id="wordtree-root-select" style="min-width:220px"></select>
    </div>
    <div id="wordtree-box"><div class="skeleton" style="height:260px"></div></div>
  </div>
  <div class="section-label"><i class="ti ti-trending-down"></i> Forecasting Stok</div>
  <div class="insight-card" style="margin-bottom:26px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px">
      <div class="insight-card-title" style="margin-bottom:0"><i class="ti ti-alert-triangle"></i> Produk Berisiko Habis (berdasarkan laju konversi) <a class="insight-link" href="/stok" data-nav="/stok">Stok <i class="ti ti-arrow-right"></i></a></div>
      <div style="display:flex;gap:6px;align-items:center">
        <span style="font-size:11px;color:var(--text-muted)">Periode analisis:</span>
        <button class="forecast-period-btn" data-days="7" data-action="forecast-period">7 hari</button>
        <button class="forecast-period-btn active" data-days="30" data-action="forecast-period">30 hari</button>
        <button class="forecast-period-btn" data-days="90" data-action="forecast-period">90 hari</button>
      </div>
    </div>
    <div id="forecast-box"><div class="skeleton" style="height:200px"></div></div>
  </div>
  <div class="section-label"><i class="ti ti-list"></i> Daftar Produk</div>
  <div class="table-section">
    <div class="table-header">
      <div class="table-title"><i class="ti ti-filter"></i> Filter &amp; Telusuri Produk</div>
      <div class="filter-bar">
        <button class="filter-btn active" data-f="all" data-action="set-filter"><i class="ti ti-layout-grid"></i> Semua</button>
        <button class="filter-btn f-noharga" data-f="noharga" data-action="set-filter"><i class="ti ti-currency-dollar"></i> Tanpa Harga</button>
        <button class="filter-btn f-nolink" data-f="nolink" data-action="set-filter"><i class="ti ti-unlink"></i> Tanpa Link</button>
        <button class="filter-btn f-noakd" data-f="noakd" data-action="set-filter"><i class="ti ti-shield-off"></i> Tanpa AKD</button>
        <select class="filter-select" id="tipe-filter">
          <option value="">Semua Tipe</option>
          <option value="INSTRUMENT">Instrumen</option>
          <option value="SET">Set</option>
          <option value="UNIT">Unit</option>
        </select>
        <span class="search-wrap-mini" style="position:relative">
  <input class="search-mini" id="tbl-search" type="search" aria-label="Cari produk berdasarkan kode atau nama" placeholder="Cari kode / nama…" style="padding-right:24px"/>
  <i class="ti ti-loader-2 spinner search-spinner" id="search-spinner"></i>
  <div class="search-history" id="search-history"></div>
</span>
      </div>
    </div>
    <div class="table-header" style="border-top:none;padding-top:0">
      <div class="preset-bar" id="preset-bar"></div>
      <button type="button" class="preset-save-btn" data-action="save-preset"><i class="ti ti-bookmark"></i> Simpan Filter Ini</button>
      </div>
      <div class="bulk-bar" id="bulk-bar">
      <span class="bulk-bar-text"><span id="bulk-count">0</span> produk dipilih</span>
      <div class="bulk-bar-actions">
        <button type="button" class="bulk-btn export" data-action="export-selected"><i class="ti ti-file-type-csv"></i> Export CSV</button>
        <button type="button" class="bulk-btn clear" data-action="clear-selection"><i class="ti ti-x"></i> Batal</button>
      </div>
    </div>
    <div class="table-scroll">
    <table>
        <thead>
  <tr>
    <th class="checkbox-col"><input type="checkbox" class="row-checkbox" id="select-all-checkbox" aria-label="Pilih semua produk di halaman ini"/></th>
    <th>Kode Produk</th>
            <th>Nama Produk</th>
            <th>Tipe</th>
            <th>Harga e-Kat</th>
            <th>Link v6</th>
            <th>No. AKD</th>
          </tr>
        </thead>
        <tbody id="tbl-body">
          <tr class="loading-row"><td colspan="7"><i class="ti ti-loader-2 spinner"></i> Memuat data…</td></tr>
        </tbody>
      </table>
    </div>
    <div class="table-footer">
      <span id="tbl-info">—</span>
      <div class="pagination" id="pagination"></div>
    </div>
  </div>

  <div id="pop-section">
  <div class="section-label"><i class="ti ti-map"></i> Populasi Produk per Wilayah</div>
  <div class="stats-grid" id="pop-summary-grid" style="margin-bottom:14px">
    <div class="stat-card blue"><div class="skeleton" style="height:60px"></div></div>
    <div class="stat-card green"><div class="skeleton" style="height:60px"></div></div>
    <div class="stat-card purple"><div class="skeleton" style="height:60px"></div></div>
    <div class="stat-card warning"><div class="skeleton" style="height:60px"></div></div>
  </div>
  <div class="insight-card" style="margin-bottom:14px">
    <div class="insight-card-title" style="margin-bottom:0"><i class="ti ti-chart-line"></i> Tren Populasi Kumulatif (qty terkirim per bulan)</div>
    <div id="pop-trend-box"><div class="skeleton" style="height:150px"></div></div>
  </div>
  <div class="insight-card" style="margin-bottom:14px">
    <div class="insight-card-title" style="margin-bottom:0"><i class="ti ti-alert-circle"></i> Kualitas Data Populasi</div>
    <div id="pop-dq-box"><div class="skeleton" style="height:60px"></div></div>
  </div>
  <div class="insight-card" style="margin-bottom:14px">
    <div class="insight-card-title" style="margin-bottom:0"><i class="ti ti-search"></i> Rincian Asal Angka (audit — tiap baris bisa dihitung manual)</div>
    <div id="pop-audit-box"><div class="skeleton" style="height:120px"></div></div>
  </div>
  <div class="table-section">
    <div class="table-header">
      <div class="table-title"><i class="ti ti-filter"></i> Filter Populasi Produk</div>
      <div class="filter-bar">
        <select class="filter-select" id="pop-wilayah-filter">
          <option value="">Semua Wilayah</option>
        </select>
        <select class="filter-select" id="pop-entitas-filter">
          <option value="">Semua Entitas</option>
        </select>
        <select class="filter-select" id="pop-channel-filter">
          <option value="">Semua Channel</option>
        </select>
        <span class="search-wrap-mini" style="position:relative">
          <input class="search-mini" id="pop-search" type="search" aria-label="Cari populasi produk berdasarkan kode atau nama" placeholder="Cari kode / nama produk…" style="padding-right:24px;width:220px"/>
          <i class="ti ti-loader-2 spinner search-spinner" id="pop-search-spinner"></i>
        </span>
        <button type="button" class="bulk-btn export" data-action="pop-export" style="margin-left:auto">
          <i class="ti ti-file-type-csv"></i> Export CSV
        </button>
      </div>
    </div>
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Kode Produk</th>
            <th>Nama Produk</th>
            <th>Entitas</th>
            <th>Channel</th>
            <th>Wilayah</th>
            <th style="text-align:right">Total Qty</th>
            <th style="text-align:right">Jml Customer</th>
            <th style="text-align:right">Jml Dokumen</th>
            <th>Order Terakhir</th>
          </tr>
        </thead>
        <tbody id="pop-tbl-body">
          <tr class="loading-row"><td colspan="9"><i class="ti ti-loader-2 spinner"></i> Memuat data…</td></tr>
        </tbody>
      </table>
    </div>
    <div class="table-footer">
      <span id="pop-tbl-info">—</span>
      <div class="pagination" id="pop-pagination"></div>
    </div>
  </div>
  </div>
</main>
</div>
<div class="toast-container" id="toast-container" aria-live="polite"></div>
<!-- Pengganti prompt() bawaan browser buat nama preset filter (savePreset()
     di index.js) -- pakai .confirm-overlay/.confirm-card generic yang sama
     dipakai stok & crud-produk buat dialog kecil, ditambah satu .field-input
     buat teks. Bukan prompt() yang nge-freeze tab & gak ngikutin tema. -->
<div class="confirm-overlay" id="presetNameOverlay">
  <div class="confirm-card">
    <h3><i class="ti ti-bookmark"></i> Simpan Preset</h3>
    <p>Kasih nama biar gampang dikenali nanti.</p>
    <input type="text" id="presetNameInput" class="field-input" maxlength="60" placeholder='mis. &quot;Instrumen tanpa harga&quot;'>
    <div id="presetNameError" style="display:none;color:var(--danger);font-size:11.5px;margin-top:6px"></div>
    <div class="confirm-actions" style="margin-top:16px">
      <button class="btn btn-ghost" id="presetNameCancelBtn" type="button">Batal</button>
      <button class="btn btn-accent" id="presetNameOkBtn" type="button">Simpan</button>
    </div>
  </div>
</div>

<div class="detail-modal-overlay" id="detail-modal-overlay">
  <div class="detail-modal" id="detail-modal" role="dialog" aria-modal="true" aria-labelledby="dm-title">
    <div class="detail-modal-head">
      <div>
        <div class="detail-modal-title" id="dm-title">—</div>
        <div class="detail-modal-sub" id="dm-kode">—</div>
      </div>
      <button type="button" class="detail-modal-close" id="dm-close" aria-label="Tutup">&times;</button>
    </div>
    <div class="detail-modal-body" id="dm-body">
      <div class="detail-loading"><i class="ti ti-loader-2 spinner"></i> Memuat detail…</div>
    </div>
  </div>
</div>
`;