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
    <span class="last-update"><i class="ph ph-arrows-clockwise" id="refresh-icon"></i> <span id="last-update-text">Memuat…</span></span>
    <button class="toggle-btn" id="reload-btn" title="Muat ulang"><i class="ph ph-arrow-clockwise"></i> Muat ulang</button>
  </div>
</div>

<main>

  <div class="err-banner" id="err-banner"><i class="ph ph-warning-circle"></i> <span id="err-text"></span></div>

  <div class="section-label"><i class="ph ph-arrows-clockwise"></i> Konversi Hari Ini</div>
  <div class="stats-grid" id="stats-grid-konversi">
    <div class="stat-card blue"><div class="skeleton" style="width:60%;height:25px;margin-bottom:8px"></div><div class="skeleton" style="width:40%"></div></div>
    <div class="stat-card green"><div class="skeleton" style="width:60%;height:25px;margin-bottom:8px"></div><div class="skeleton" style="width:40%"></div></div>
    <div class="stat-card purple"><div class="skeleton" style="width:60%;height:25px;margin-bottom:8px"></div><div class="skeleton" style="width:40%"></div></div>
  </div>

  <div class="section-label"><i class="ph ph-database"></i> Ringkasan Database</div>
  <div class="stats-grid" id="stats-grid">
    <div class="stat-card blue"><div class="skeleton" style="width:60%;height:25px;margin-bottom:8px"></div><div class="skeleton" style="width:40%"></div></div>
    <div class="stat-card green"><div class="skeleton" style="width:60%;height:25px;margin-bottom:8px"></div><div class="skeleton" style="width:40%"></div></div>
    <div class="stat-card warning"><div class="skeleton" style="width:60%;height:25px;margin-bottom:8px"></div><div class="skeleton" style="width:40%"></div></div>
    <div class="stat-card purple"><div class="skeleton" style="width:60%;height:25px;margin-bottom:8px"></div><div class="skeleton" style="width:40%"></div></div>
    <div class="stat-card danger"><div class="skeleton" style="width:60%;height:25px;margin-bottom:8px"></div><div class="skeleton" style="width:40%"></div></div>
  </div>

  <div class="section-label"><i class="ph ph-chart-bar"></i> Kelengkapan Data</div>
  <div class="prog-cards">
    <div class="prog-card">
      <div class="prog-card-title"><i class="ph ph-money"></i> Harga e-Katalog</div>
      <div id="prog-harga">
        <div class="skeleton" style="height:36px;margin-bottom:9px"></div>
        <div class="skeleton" style="height:36px;margin-bottom:9px"></div>
        <div class="skeleton" style="height:36px"></div>
      </div>
    </div>
    <div class="prog-card">
      <div class="prog-card-title"><i class="ph ph-link"></i> e-Katalog v6</div>
      <div id="prog-link">
        <div class="skeleton" style="height:36px;margin-bottom:9px"></div>
        <div class="skeleton" style="height:36px"></div>
      </div>
    </div>
    <div class="prog-card">
      <div class="prog-card-title"><i class="ph ph-seal-check"></i> Nomor AKD</div>
      <div id="prog-akd">
        <div class="skeleton" style="height:36px;margin-bottom:9px"></div>
        <div class="skeleton" style="height:36px"></div>
      </div>
    </div>
  </div>
<div class="section-label"><i class="ph ph-trend-up"></i> Insight Konversi</div>
  <div class="insight-cards">
<div class="insight-grid">
    <div class="insight-col-left">
      <div class="insight-card">
        <div class="insight-card-title"><i class="ph ph-chart-bar"></i> Trend 7 Hari Terakhir</div>
        <div id="trend-chart-box"><div class="skeleton" style="height:120px"></div></div>
      </div>
      <div class="insight-card">
        <div class="insight-card-title"><i class="ph ph-chart-line"></i> Trend Value Harian (7 hari)</div>
        <div id="linechart-box"><div class="skeleton" style="height:150px"></div></div>
      </div>
      <div class="insight-card">
        <div class="insight-card-title"><i class="ph ph-chart-donut"></i> Distribusi Kategori (30 hari)</div>
        <div id="donut-chart-box"><div class="skeleton" style="height:140px"></div></div>
      </div>
    </div>
    <div class="insight-card insight-card-tall">
      <div class="insight-card-title"><i class="ph ph-trophy"></i> Leaderboard Sales (30 hari)</div>
      <div id="leaderboard-box">
        <div class="skeleton" style="height:38px;margin-bottom:8px"></div>
        <div class="skeleton" style="height:38px;margin-bottom:8px"></div>
        <div class="skeleton" style="height:38px"></div>
      </div>
    </div>
  </div>
  <div class="section-label"><i class="ph ph-tree-structure"></i> Peta Kebutuhan ↔ SKU</div>
  <div class="insight-card" style="margin-bottom:26px">
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:14px">
      <div class="insight-card-title" style="margin-bottom:0"><i class="ph ph-share-network"></i> Word Tree — Kebutuhan Customer ke SKU</div>
      <select class="filter-select" id="wordtree-root-select" onchange="onWordtreeRootChange(this.value)" style="min-width:220px"></select>
    </div>
    <div id="wordtree-box"><div class="skeleton" style="height:260px"></div></div>
  </div>
  <div class="section-label"><i class="ph ph-chart-line-down"></i> Forecasting Stok</div>
  <div class="insight-card" style="margin-bottom:26px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px">
      <div class="insight-card-title" style="margin-bottom:0"><i class="ph ph-warning"></i> Produk Berisiko Habis (berdasarkan laju konversi)</div>
      <div style="display:flex;gap:6px;align-items:center">
        <span style="font-size:11px;color:var(--text-muted)">Periode analisis:</span>
        <button class="forecast-period-btn" data-days="7" onclick="setForecastPeriod(7,this)">7 hari</button>
        <button class="forecast-period-btn active" data-days="30" onclick="setForecastPeriod(30,this)">30 hari</button>
        <button class="forecast-period-btn" data-days="90" onclick="setForecastPeriod(90,this)">90 hari</button>
      </div>
    </div>
    <div id="forecast-box"><div class="skeleton" style="height:200px"></div></div>
  </div>
  <div class="section-label"><i class="ph ph-list"></i> Daftar Produk</div>
  <div class="table-section">
    <div class="table-header">
      <div class="table-title"><i class="ph ph-funnel"></i> Filter &amp; Telusuri Produk</div>
      <div class="filter-bar">
        <button class="filter-btn active" data-f="all" onclick="setFilter('all',this)"><i class="ph ph-squares-four"></i> Semua</button>
        <button class="filter-btn f-noharga" data-f="noharga" onclick="setFilter('noharga',this)"><i class="ph ph-currency-circle-dollar"></i> Tanpa Harga</button>
        <button class="filter-btn f-nolink" data-f="nolink" onclick="setFilter('nolink',this)"><i class="ph ph-link-break"></i> Tanpa Link</button>
        <button class="filter-btn f-noakd" data-f="noakd" onclick="setFilter('noakd',this)"><i class="ph ph-shield-slash"></i> Tanpa AKD</button>
        <select class="filter-select" id="tipe-filter" onchange="setTipe(this.value)">
          <option value="">Semua Tipe</option>
          <option value="INSTRUMENT">Instrumen</option>
          <option value="SET">Set</option>
          <option value="UNIT">Unit</option>
        </select>
        <span class="search-wrap-mini" style="position:relative">
  <input class="search-mini" id="tbl-search" type="search" placeholder="Cari kode / nama…" oninput="onSearch()" onfocus="showSearchHistory()" style="padding-right:24px"/>
  <i class="ph ph-circle-notch spinner search-spinner" id="search-spinner"></i>
  <div class="search-history" id="search-history"></div>
</span>
      </div>
    </div>
    <div class="table-header" style="border-top:none;padding-top:0">
      <div class="preset-bar" id="preset-bar"></div>
      <button class="preset-save-btn" onclick="savePreset()"><i class="ph ph-bookmark-simple"></i> Simpan Filter Ini</button>
      </div>
      <div class="bulk-bar" id="bulk-bar">
      <span class="bulk-bar-text"><span id="bulk-count">0</span> produk dipilih</span>
      <div class="bulk-bar-actions">
        <button class="bulk-btn export" onclick="exportSelected()"><i class="ph ph-file-csv"></i> Export CSV</button>
        <button class="bulk-btn clear" onclick="clearSelection()"><i class="ph ph-x"></i> Batal</button>
      </div>
    </div>
    <div class="table-scroll">
    <table>
        <thead>
  <tr>
    <th class="checkbox-col"><input type="checkbox" class="row-checkbox" id="select-all-checkbox" onchange="toggleSelectAll(this)"/></th>
    <th>Kode Produk</th>
            <th>Nama Produk</th>
            <th>Tipe</th>
            <th>Harga e-Kat</th>
            <th>Link v6</th>
            <th>No. AKD</th>
          </tr>
        </thead>
        <tbody id="tbl-body">
          <tr class="loading-row"><td colspan="7"><i class="ph ph-circle-notch spinner"></i> Memuat data…</td></tr>
        </tbody>
      </table>
    </div>
    <div class="table-footer">
      <span id="tbl-info">—</span>
      <div class="pagination" id="pagination"></div>
    </div>
  </div>

  <div id="pop-section">
  <div class="section-label"><i class="ph ph-map-trifold"></i> Populasi Produk per Wilayah</div>
  <div class="stats-grid" id="pop-summary-grid" style="margin-bottom:14px">
    <div class="stat-card blue"><div class="skeleton" style="height:60px"></div></div>
    <div class="stat-card green"><div class="skeleton" style="height:60px"></div></div>
    <div class="stat-card purple"><div class="skeleton" style="height:60px"></div></div>
    <div class="stat-card warning"><div class="skeleton" style="height:60px"></div></div>
  </div>
  <div class="table-section">
    <div class="table-header">
      <div class="table-title"><i class="ph ph-funnel"></i> Filter Populasi Produk</div>
      <div class="filter-bar">
        <select class="filter-select" id="pop-wilayah-filter" onchange="popSetWilayah(this.value)">
          <option value="">Semua Wilayah</option>
        </select>
        <select class="filter-select" id="pop-entitas-filter" onchange="popSetEntitas(this.value)">
          <option value="">Semua Entitas</option>
        </select>
        <select class="filter-select" id="pop-channel-filter" onchange="popSetChannel(this.value)">
          <option value="">Semua Channel</option>
        </select>
        <span class="search-wrap-mini" style="position:relative">
          <input class="search-mini" id="pop-search" type="search" placeholder="Cari kode / nama produk…" oninput="popOnSearch()" style="padding-right:24px;width:220px"/>
          <i class="ph ph-circle-notch spinner search-spinner" id="pop-search-spinner"></i>
        </span>
        <button class="bulk-btn export" onclick="popExportExcel(event)" style="margin-left:auto">
          <i class="ph ph-file-xls"></i> Export Excel
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
          <tr class="loading-row"><td colspan="9"><i class="ph ph-circle-notch spinner"></i> Memuat data…</td></tr>
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
<div class="toast-container" id="toast-container"></div>
<div class="detail-modal-overlay" id="detail-modal-overlay">
  <div class="detail-modal" id="detail-modal">
    <div class="detail-modal-head">
      <div>
        <div class="detail-modal-title" id="dm-title">—</div>
        <div class="detail-modal-sub" id="dm-kode">—</div>
      </div>
      <button class="detail-modal-close" id="dm-close">&times;</button>
    </div>
    <div class="detail-modal-body" id="dm-body">
      <div class="detail-loading"><i class="ph ph-circle-notch spinner"></i> Memuat detail…</div>
    </div>
  </div>
</div>
`;