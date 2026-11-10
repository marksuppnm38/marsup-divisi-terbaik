// dashboard page markup: the original dashboard.html body content
// (auth-gate through detail-modal-overlay), ported with the structural
// change of swapping the old per-page <header> for the shared
// pw-topbar.
//
// UPDATE (style retrofit): color/spacing/icon/status tokens done --
// see style.css in this folder for the full
// rationale. The only markup.js change needed for that was stripping the
// per-instance inline `style="color:var(--success/accent/warning/purple)"`
// on prog-card-title/insight-card-title icons (icon color
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

  <div class="section-label">Perlu dikerjakan</div>
  <div class="worklist" id="worklist">
    <div class="skeleton" style="height:64px"></div>
    <div class="skeleton" style="height:64px"></div>
    <div class="skeleton" style="height:64px"></div>
  </div>

  <div class="section-label">Konversi hari ini</div>
  <div class="stats-grid" id="stats-grid-konversi">
    <div class="stat-card"><div class="skeleton" style="width:60%;height:25px;margin-bottom:8px"></div><div class="skeleton" style="width:40%"></div></div>
    <div class="stat-card"><div class="skeleton" style="width:60%;height:25px;margin-bottom:8px"></div><div class="skeleton" style="width:40%"></div></div>
    <div class="stat-card"><div class="skeleton" style="width:60%;height:25px;margin-bottom:8px"></div><div class="skeleton" style="width:40%"></div></div>
  </div>

<div class="section-label">Tren konversi</div>
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
  <div class="section-label">Populasi set</div>
  <div class="insight-card" style="margin-bottom:26px">
    <div class="insight-card-title">Rumah sakit dengan set terkirim terbanyak <a class="insight-link" href="/populasi" data-nav="/populasi">Populasi <i class="ti ti-arrow-right"></i></a></div>
    <div id="populasi-box"><div class="skeleton" style="height:150px"></div></div>
  </div>
  <div class="section-label">Kebutuhan customer ke SKU</div>
  <div class="insight-card" style="margin-bottom:26px">
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:14px">
      <div class="insight-card-title" style="margin-bottom:0"><i class="ti ti-share"></i> Istilah customer dan SKU yang cocok <a class="insight-link" href="/konversian/dictionary" data-nav="/konversian/dictionary">Dictionary <i class="ti ti-arrow-right"></i></a></div>
      <select class="filter-select" id="wordtree-root-select" style="min-width:220px"></select>
    </div>
    <div id="wordtree-box"><div class="skeleton" style="height:260px"></div></div>
  </div>
  <div class="section-label">Stok berisiko habis</div>
  <div class="insight-card" style="margin-bottom:26px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px">
      <div class="insight-card-title" style="margin-bottom:0"><i class="ti ti-alert-triangle"></i> Berdasarkan laju konversi <a class="insight-link" href="/stok" data-nav="/stok">Stok <i class="ti ti-arrow-right"></i></a></div>
      <div style="display:flex;gap:6px;align-items:center">
        <span style="font-size:11px;color:var(--text-muted)">Periode analisis:</span>
        <button class="forecast-period-btn" data-days="7" data-action="forecast-period">7 hari</button>
        <button class="forecast-period-btn active" data-days="30" data-action="forecast-period">30 hari</button>
        <button class="forecast-period-btn" data-days="90" data-action="forecast-period">90 hari</button>
      </div>
    </div>
    <div id="forecast-box"><div class="skeleton" style="height:200px"></div></div>
  </div>
  <div class="section-label">Laporan dan unduhan</div>
  <div class="out-grid">
    <div class="out-card">
      <div class="out-title">Pricelist sales</div>
      <p class="out-desc">Produk yang sudah punya Link V6 dan harga e-Katalog, siap dikirim ke sales.</p>
      <div class="out-actions">
        <select class="filter-select" id="pricelist-tipe" aria-label="Tipe produk pricelist">
          <option value="">Semua tipe</option>
          <option value="INSTRUMENT">Instrumen</option>
          <option value="SET">Set</option>
          <option value="UNIT">Unit</option>
        </select>
        <button type="button" class="btn btn-accent" id="pricelist-btn" data-action="pricelist-unduh"><i class="ti ti-file-spreadsheet"></i> Unduh Excel</button>
      </div>
      <a class="out-more" href="/crud-produk/produk" data-nav="/crud-produk/produk">Filter lebih detail di CRUD Produk</a>
    </div>
    <div class="out-card">
      <div class="out-title">Populasi set per rumah sakit</div>
      <p class="out-desc">Unduh Excel untuk lampiran SPH, presentasi, atau internal, atau salin sebagai teks. Filter wilayah dan periode diatur di halamannya.</p>
      <div class="out-actions">
        <a class="btn btn-ghost" href="/populasi" data-nav="/populasi">Buka Populasi</a>
      </div>
    </div>
    <div class="out-card">
      <div class="out-title">Export produk lengkap</div>
      <p class="out-desc">Semua kolom plus stok, AKD, dan status INAPROC. Ikut filter berlapis yang diatur di CRUD Produk.</p>
      <div class="out-actions">
        <a class="btn btn-ghost" href="/crud-produk/produk" data-nav="/crud-produk/produk">Buka CRUD Produk</a>
      </div>
    </div>
  </div>

</main>
</div>
<div class="toast-container" id="toast-container" aria-live="polite"></div>
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