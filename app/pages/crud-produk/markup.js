// crud-produk page markup: the original crud-produk.html body content
// (gateWrap through kfaModalOverlay), ported verbatim as a template string.
// See index.js for the migration notes .
// Theme-init <script> and vendor <script src> tags from the original <head>/
// top-of-<body> are NOT here -- <script> elements inside HTML assigned via
// innerHTML don't execute (DOM quirk), so that logic moved into index.js's
// mount() as real JS instead. See index.js for where.
//
// UPDATE (sesi lanjutan -- "double nav" fix): this page's own <aside
// class="sidebar"> is REMOVED ENTIRELY (was: brand link, collapse button,
// 5 data-view nav buttons, Log Aktivitas toggle, user email, logout). The
// 5 nav buttons now live in the GLOBAL sidebar's accordion instead (see
// app/pages/nav/ + crud-produk/subnav.js) -- that was the actual "double
// nav" complaint, two sidebars rendering side by side. Brand/user-email/
// logout were pure duplicates of what the global nav already shows, so
// just dropped, not relocated anywhere. Log Aktivitas is the one item
// that's a real page ACTION (opens a modal), not navigation -- moved into
// `.topbar-actions` instead (see below, next to Tambah Produk), same spot
// the shared topbar pattern already uses for per-page actions.
// `.main{flex:1}` in pnm-universal.css already sizes `<main>` to fill
// 100% of `.shell` on its own with no sibling `.sidebar` present -- no
// layout CSS changed, confirmed before editing.

export const CRUD_PRODUK_MARKUP = `
<!-- AUTH: tidak ada gate per-halaman; router.js gak mount() halaman ini kecuali
     shared/auth-gate.js sudah lolos. -->

<!-- APP SHELL
     Satu lapis kepala saja: .pw-topbar (breadcrumb + aksi global) -> .content-head (judul + aksi halaman)
     -> .vtools (cari/filter) -> .vbody (satu-satunya area yang scroll) -> .pg-bar (nempel di bawah).
     Dulu ada .topbar kedua yang berisi search + tombol; di view selain Produk isinya cuma "Log Aktivitas"
     sehingga terlihat kosong dan melayang. Semua id lama dipertahankan. -->
<div class="shell" id="appWrap">
  <main class="main">
    <div class="pw-topbar">
      <div class="pw-topbar-crumb">CRUD Produk <span class="pw-topbar-crumb-sep">/</span> <strong id="pw-topbar-crumb-text">Produk</strong></div>
      <div class="pw-topbar-actions">
        <button class="btn" id="btnKembaliKonversi" style="display:none;border:1px solid var(--accent-text);color:var(--accent-text);background:var(--accent-bg)" title="Balik ke Conversion Workspace"><i class="ti ti-arrow-back"></i> Kembali ke Konversi</button>
        <button class="btn" id="logToggle" title="Log Aktivitas"><i class="ti ti-history"></i> Log Aktivitas</button>
      </div>
    </div>

    <!-- PRODUK VIEW -->
    <div class="content" id="viewProduk">
      <div class="vwrap">
        <div class="content-head">
          <div>
            <div class="content-title">Produk</div>
            <div class="content-sub" id="produkCount">Memuat...</div>
          </div>
          <div class="produk-head-actions">
            <!-- Satu export: kolom = kolom tabel yang tampil (tombol Kolom), baris = semua hasil filter + pencarian. -->
            <div class="export-menu" id="produkExportMenu">
              <button class="btn btn-accent" id="produkExportToggle" type="button" aria-haspopup="menu" aria-expanded="false"><i class="ti ti-download"></i> Export <i class="ti ti-chevron-down export-chev"></i></button>
              <div class="export-pop" id="produkExportPop" role="menu" hidden>
                <button class="export-item" id="produkExportBtn" type="button" role="menuitem">
                  <i class="ti ti-file-spreadsheet"></i>
                  <span><b>Export tampilan ini ke Excel</b><small id="produkExportInfo">Kolom dan baris persis seperti di layar</small></span>
                </button>
                <label class="export-opt">
                  <input type="checkbox" id="produkExportSiapJual"/>
                  <span><b>Hanya produk siap jual</b><small>Buang produk tanpa harga E-Katalog atau yang Link V6-nya kotor (ada catatan / bukan URL murni), urut Nama. Untuk pricelist sales.</small></span>
                </label>
                <div class="export-hint"><i class="ti ti-columns"></i><span>Atur isi file lewat tombol <b>Kolom</b>: preset <b>Pricelist sales</b> (otomatis menyalakan opsi di atas), <b>Audit lengkap</b> untuk cek data. Filter yang aktif ikut menentukan baris (dan menambah kolom otomatis).</span></div>
              </div>
            </div>
            <button class="btn btn-accent" id="addBtn"><i class="ti ti-plus"></i> Tambah Produk</button>
          </div>
        </div>

        <div class="vtools">
          <div class="top-search">
            <i class="ti ti-search"></i>
            <input type="text" id="topSearchInput" placeholder="Cari kode produk atau nama..." aria-keyshortcuts="Control+K Meta+K"/>
            <kbd class="top-search-kbd" id="topSearchKbd" aria-hidden="true"></kbd>
            <button class="clear-btn" id="topSearchClear" title="Bersihkan" aria-label="Bersihkan pencarian"><i class="ti ti-x"></i></button>
          </div>
      <div class="stacked-filters-row">
              <div class="stacked-filter-chips" id="produkFilterChips"></div>
              <div class="add-filter-wrap">
                <button class="add-filter-btn" id="produkAddFilterBtn"><i class="ti ti-plus"></i> Tambah Filter</button>
                <div class="add-filter-pop" id="produkAddFilterPop"></div>
              </div>
            </div>
          <div class="vtools-end">
            <button type="button" class="btn-cols" id="produkColsBtn" aria-haspopup="dialog" aria-expanded="false" title="Pilih & urutkan kolom tabel"><i class="ti ti-columns"></i> Kolom</button>
            <div class="view-toggle">
              <button id="viewTableBtn" class="active" title="Tampilan tabel"><i class="ti ti-list"></i></button>
              <button id="viewCardBtn" title="Tampilan kartu"><i class="ti ti-layout-grid"></i></button>
            </div>
          </div>
        </div>

        <div class="filter-bar" id="produkFilterBar">
                <button class="filter-chip active" data-filter="all">Semua<span class="fc-count" id="fc-all"></span></button>
                <button class="filter-chip" data-filter="belum_diajukan">Perlu AKD<span class="fc-count" id="fc-belum_diajukan"></span></button>
                <button class="filter-chip" data-filter="belum_firm">Belum Firm<span class="fc-count" id="fc-belum_firm"></span></button>
                <button class="filter-chip" data-filter="di_luar_cakupan">Di Luar Cakupan<span class="fc-count" id="fc-di_luar_cakupan"></span></button>
                <button class="filter-chip" data-filter="terhubung">Sudah ada AKD<span class="fc-count" id="fc-terhubung"></span></button>
                <button class="filter-chip" data-filter="disetujui_tanpa_link">Disetujui, Belum Ada Link<span class="fc-count" id="fc-disetujui_tanpa_link"></span></button>
                <button class="filter-chip" data-filter="verified"><i class="ti ti-rosette-discount-check-filled vbadge vbadge-chip"></i>Verified<span class="fc-count" id="fc-verified"></span></button>
              </div>

        <div class="vbody">
          <div class="table-card" id="tableWrap">
                  <table>
                    <thead>
                      <tr id="produkHeadRow"><th>Kode Produk</th><th>Nama Produk</th><th>Tipe</th><th>AKD</th><th class="num">Stok</th><th>Perlu dicek</th><th class="c-act"><span class="sr-only">Salin</span></th></tr>
                    </thead>
                    <tbody id="tableBody">
                      <tr class="state-row"><td colspan="7">Memuat data...</td></tr>
                    </tbody>
                  </table>
                </div>
          <div class="card-grid" id="cardWrap" style="display:none;"></div>
        </div>
        <div class="copy-bar" id="copyBar" role="region" aria-label="Salin produk terpilih" hidden>
          <span class="cb-count" id="copyBarCount" aria-live="polite"></span>
          <button type="button" class="cb-btn cb-primary" id="copyBarCopy"><i class="ti ti-copy"></i> Salin sebagai tabel</button>
          <button type="button" class="cb-btn" id="copyBarCols" aria-haspopup="dialog">Kolom</button>
          <button type="button" class="cb-link cb-page" id="copyBarPage">Pilih semua di halaman ini</button>
          <button type="button" class="cb-link" id="copyBarClear">Batal pilih</button>
        </div>
        <div class="pg-bar" id="produkPagination" style="display:none;"></div>
      </div>
    </div>

    <!-- SET MANAGEMENT VIEW -->
    <div class="content" id="viewSet" style="display:none;">
      <div class="vwrap">
        <div id="setListWrap">
          <div class="vcol">
            <div class="content-head">
              <div>
                <div class="content-title">Set Management</div>
                <div class="content-sub" id="setListCount">Memuat...</div>
                <div class="content-hint">Satu set adalah satu paket instrumen untuk satu jenis tindakan. Buka set untuk mengatur isi, harga, dan AKD-nya.</div>
              </div>
              <button class="btn btn-accent" id="addSetBtn"><i class="ti ti-plus"></i> Set Baru</button>
            </div>
            <div class="vtools">
              <div class="akd-search-box">
                <i class="ti ti-search"></i>
                <input type="text" id="setSearchInput" placeholder="Cari kode atau nama set..." autocomplete="off"/>
              </div>
            </div>
            <div class="vbody">
              <div class="set-cols" role="presentation">
                <span>Kode set</span><span>Nama set</span><span class="num">Jenis item</span><span class="num">Total qty</span><span>Harga</span><span>Status AKD</span>
              </div>
              <div id="setListBody"></div>
            </div>
            <div class="pg-bar" id="setListPagination" style="display:none;"></div>
          </div>
        </div>

        <div id="setDetailWrap" style="display:none;">
                <div class="set-back" id="setBackBtn"><i class="ti ti-arrow-left"></i> Kembali ke daftar set</div>
                <div class="set-detail-head">
                  <div>
                    <div class="set-detail-title" id="setDetailNama">—</div>
                    <div class="set-detail-meta">
                      <span class="kode-cell" id="setDetailKode"></span>
                      <span><b id="setDetailJumlahItem">0</b> item</span>
                      <span><b id="setDetailQty">0</b> total qty</span>
                      <span id="setDetailHarga">Belum ada harga</span>
                      <span id="setDetailSeal"></span>
                    </div>
                  </div>
                  <button class="btn btn-ghost" id="editSetOverviewBtn"><i class="ti ti-pencil"></i> Edit Info Dasar</button>
                </div>

                <div class="set-tabs">
                  <button class="set-tab active" data-tab="composition">Composition</button>
                  <button class="set-tab" data-tab="pricing">Pricing</button>
                  <button class="set-tab" data-tab="akd">AKD</button>
                  <button class="set-tab" data-tab="history">History</button>
                </div>

                <div class="set-tab-panel active" id="tab-composition">
                  <div class="comp-summary">
                    <span>Jenis item: <b id="compJumlahJenis">0</b></span>
                    <span>Total qty: <b id="compTotalQty">0</b></span>
                    <span>Estimasi berat: <b id="compEstBerat">0 g</b></span>
                  </div>
                  <div id="compList"></div>
                  <div id="compMissing"></div>
                  <div class="comp-add">
                    <label class="field-label">Tambah item (cari instrumen/unit)</label>
                    <input type="text" class="field-input" id="compSearchInput" placeholder="Ketik nama atau kode produk..."/>
                    <div class="akd-results" id="compSearchResults"></div>
                  </div>
                  <div class="akd-hint" style="margin-top:10px;"><i class="ti ti-device-floppy"></i> Perubahan (tambah/hapus item, ubah qty) tersimpan otomatis ke database — tidak ada tombol Simpan terpisah.</div>

                  <details class="comp-paste">
                  <summary><i class="ti ti-chevron-right"></i> Paste rincian dari sheet</summary>
                  <div class="paste-hint">
                    Paste langsung dari sheet Rincian Set kamu apa adanya (kode_set, nama_set, kode_item, nama_item, qty — kolom kode_set/nama_set diabaikan karena udah jelas set-nya set ini), atau cukup 2 kolom <code>kode_item</code> — <code>qty</code>.
                  </div>
                  <textarea class="paste-area" id="compPasteArea" placeholder="RB999-KE921-B99-U667&#9;BASIC SPINE LAMINECTOMY S.&#9;RB10-KE130-B003-U07&#9;SCALPEL HANDLE, NO. 3, 12 CM&#9;1"></textarea>
                  <div class="bulk-actions">
                    <button class="btn btn-ghost" id="compPastePreviewBtn" type="button"><i class="ti ti-eye"></i> Preview</button>
                    <label class="check-row-inline is-destructive"><input type="checkbox" id="compPasteTimpaMode"/> Mode Timpa Total (hapus item lama yang tidak disebut di paste ini)</label>
                    <button class="btn btn-accent" id="compPasteProsesBtn" type="button" style="display:none;"><i class="ti ti-check"></i> Proses Semua</button>
                  </div>
                  <div class="bulk-summary" id="compPasteSummary"></div>
                  <div class="preview-table-wrap" id="compPastePreviewWrap" style="display:none;">
                    <table>
                      <thead><tr><th>Kode Item</th><th>Nama Item</th><th>Qty</th><th>Status</th></tr></thead>
                      <tbody id="compPastePreviewBody"></tbody>
                    </table>
                  </div>
                  </details>
                </div>

                <div class="set-tab-panel" id="tab-pricing">
                  <div class="table-card">
                    <table>
                      <thead><tr><th>Tahun</th><th>Harga EKATALOG</th><th>Turunan (otomatis)</th><th></th></tr></thead>
                      <tbody id="setHargaTableBody"><tr><td colspan="4" style="color:var(--text-muted);padding:14px;">Belum ada data harga</td></tr></tbody>
                    </table>
                  </div>
                  <div class="harga-add harga-add-set">
                    <div class="f"><label>Tahun</label><input type="number" id="sh_tahun" placeholder="2026"/></div>
                    <div class="f"><label>Harga EKATALOG (Rp)</label><input type="number" step="any" id="sh_harga" placeholder="0"/></div>
                    <button class="btn btn-ghost" id="hitungKomposisiBtn" type="button" title="Isi otomatis dari jumlah (harga item × qty)"><i class="ti ti-calculator"></i> Hitung dari Komposisi</button>
                    <button class="btn btn-ghost" id="addSetHargaBtn" type="button"><i class="ti ti-plus"></i> Tambah</button>
                  </div>
                  <div class="akd-hint">SWASTA (×1,3) dan UPLOAD (÷1,11) dihitung &amp; disimpan otomatis dari Harga EKATALOG. "Hitung dari Komposisi" cuma mengisi kotak — kamu tetap bisa timpa manual (mis. buat pas-kan pagu) sebelum klik Tambah.</div>
                </div>

                <div class="set-tab-panel" id="tab-akd">
                  <div class="akd-box" style="display:block;">
                    <div class="akd-current" id="setAkdCurrentList"></div>
                    <div class="akd-search-wrap">
                      <input type="text" class="field-input" id="setAkdSearchInput" placeholder="Cari nomor AKD atau nama set..." style="padding:8px 10px;font-size:12.5px;"/>
                      <div class="akd-results" id="setAkdResults"></div>
                    </div>
                    <div class="akd-hint">Pencarian dibatasi ke AKD tipe "set".</div>
                  </div>
                </div>

                <div class="set-tab-panel" id="tab-history">
                  <div id="setHistoryList" style="display:flex;flex-direction:column;gap:8px;"></div>
                  <button class="btn btn-ghost btn-sm" id="openFullLogFromSetBtn" style="margin-top:10px;"><i class="ti ti-external-link"></i> Buka Log Aktivitas Lengkap</button>
                </div>
              </div>
      </div>
    </div>

    <!-- AKD VIEW -->
    <div class="content" id="viewAkd" style="display:none;">
      <div class="vwrap">
        <div class="content-head">
          <div>
            <div class="content-title">AKD Management</div>
            <div class="content-sub" id="akdCount">Memuat...</div>
          </div>
          <div class="produk-head-actions">
            <button class="btn btn-accent" id="addAkdBtn"><i class="ti ti-plus"></i> Tambah AKD</button>
          </div>
        </div>
        <div class="vtools">
          <div class="akd-search-box">
            <i class="ti ti-search"></i>
            <input type="text" id="akdSearchBoxInput" placeholder="Cari no. AKD, nama AKD, kode set..."/>
          </div>
        </div>
        <div class="vbody">
          <div class="table-card akd-table-scroll">
                  <table>
                    <thead>
                      <tr><th>No. AKD</th><th>Nama AKD</th><th>Tipe</th><th>Golongan</th><th>Kategori Set</th><th>Masa Berlaku</th><th>Status Terupdate</th><th>Link Dok.</th><th>Produk Terhubung</th></tr>
                    </thead>
                    <tbody id="akdTableBody">
                      <tr class="state-row"><td colspan="9">Memuat data...</td></tr>
                    </tbody>
                  </table>
                </div>
        </div>
        <div class="pg-bar" id="akdPagination" style="display:none;"></div>
      </div>
    </div>

    <!-- KFA VIEW -->
    <div class="content" id="viewKfa" style="display:none;">
      <div class="vwrap">
        <div class="content-head">
          <div>
            <div class="content-title">KFA Management</div>
            <div class="content-sub" id="kfaCount">Memuat...</div>
          </div>
          <div class="produk-head-actions">
            <button class="btn btn-accent" id="addKfaBtn"><i class="ti ti-plus"></i> Tambah Produk ke KFA</button>
          </div>
        </div>
        <div id="kfaAddBox" class="akd-box" style="display:none;margin-bottom:14px;">
                <div class="akd-search-wrap">
                  <input type="text" class="field-input" id="kfaAddSearchInput" placeholder="Cari kode/nama produk yang belum ada record KFA-nya..." style="padding:8px 10px;font-size:12.5px;"/>
                  <div class="akd-results" id="kfaAddResults"></div>
                </div>
              </div>
        <div class="vtools">
          <div class="akd-search-box">
            <i class="ti ti-search"></i>
            <input type="text" id="kfaSearchBoxInput" placeholder="Cari kode/nama produk atau kode KFA..."/>
          </div>
        </div>
        <div class="filter-bar" id="kfaFilterBar">
                <button class="filter-chip active" data-filter="all">Semua<span class="fc-count" id="fc-kfa-all"></span></button>
                <button class="filter-chip" data-filter="ada">Sudah Ada Kode<span class="fc-count" id="fc-kfa-ada"></span></button>
                <button class="filter-chip" data-filter="belum">Belum Ada Kode<span class="fc-count" id="fc-kfa-belum"></span></button>
              </div>
        <div class="vbody">
          <div class="table-card akd-table-scroll">
                  <table>
                    <thead>
                      <tr><th>Kode Produk</th><th>Nama Produk</th><th>Kode KFA</th><th>Kode Cangkang</th><th>Nama Cangkang</th><th>No. AKD Rujukan</th><th>Tgl Verifikasi</th><th>Catatan</th></tr>
                    </thead>
                    <tbody id="kfaTableBody">
                      <tr class="state-row"><td colspan="8">Memuat data...</td></tr>
                    </tbody>
                  </table>
                </div>
        </div>
        <div class="pg-bar" id="kfaPagination" style="display:none;"></div>
      </div>
    </div>

    <!-- BULK EDIT VIEW -->
    <div class="content" id="viewBulk" style="display:none;">
      <div class="vwrap">
        <div class="content-head">
          <div>
            <div class="content-title">Bulk Edit</div>
            <div class="content-sub">Tempel data dari Excel atau Google Sheets, cek hasilnya, lalu proses.</div>
          </div>
        </div>
        <div class="vbody pad">
          <div class="bulk-tabs" role="tablist">
                  <button class="bulk-tab active" data-bulk="harga">Harga massal</button>
                  <button class="bulk-tab" data-bulk="link">Link V6 massal</button>
                  <button class="bulk-tab" data-bulk="inaproc">INAPROC tracker</button>
                  <button class="bulk-tab" data-bulk="verified">Verified product</button>
                </div>

                <div class="bulk-panel active" id="bulk-harga">
                  <div class="bk-compose">
                    <div class="bk-cols" aria-label="Urutan kolom yang ditempel"><span class="bk-col"><b>A</b>kode_produk</span><span class="bk-col"><b>B</b>tahun</span><span class="bk-col"><b>C</b>harga_ekat</span></div>
                    <textarea class="paste-area" id="bulkHargaPaste" placeholder="RB999-KE921-B99-U667&#9;2026&#9;1500000&#10;RB10-KE130-B003-U07&#9;2026&#9;250000"></textarea>
                    <div class="bulk-actions">
                      <span class="bk-note">Tanpa header, dipisah tab. SWASTA (×1,3) dan UPLOAD (÷1,11) dihitung otomatis.</span>
                      <button class="btn btn-ghost" id="bulkHargaPreviewBtn"><i class="ti ti-eye"></i> Cek data</button>
                      <button class="btn btn-accent" id="bulkHargaProsesBtn" style="display:none;"><i class="ti ti-check"></i> Proses semua</button>
                    </div>
                  </div>
                  <div class="bulk-summary" id="bulkHargaSummary"></div>
                  <div class="preview-table-wrap" id="bulkHargaPreviewWrap" style="display:none;">
                    <table>
                      <thead><tr><th>Kode produk</th><th>Nama</th><th>Tahun</th><th>EKATALOG</th><th>SWASTA (auto)</th><th>UPLOAD (auto)</th><th>Status</th></tr></thead>
                      <tbody id="bulkHargaPreviewBody"></tbody>
                    </table>
                  </div>
                </div>

                <!-- BULK KOMPOSISI SET dipindah ke Set Management > tab Composition (per-set, gak lintas-set lagi) -->

                <div class="bulk-panel" id="bulk-link">
                  <div class="bk-compose">
                    <div class="bk-cols" aria-label="Urutan kolom yang ditempel"><span class="bk-col"><b>A</b>kode_produk</span><span class="bk-col"><b>B</b>link_v6</span></div>
                    <textarea class="paste-area" id="bulkLinkPaste" placeholder="RB999-KE921-B99-U667&#9;https://e-katalog.lkpp.go.id/produk/xxxxx"></textarea>
                    <div class="bulk-actions">
                      <span class="bk-note">Tanpa header, dipisah tab. link_v6 berisi URL e-katalog.</span>
                      <button class="btn btn-ghost" id="bulkLinkPreviewBtn"><i class="ti ti-eye"></i> Cek data</button>
                      <button class="btn btn-accent" id="bulkLinkProsesBtn" style="display:none;"><i class="ti ti-check"></i> Proses semua</button>
                    </div>
                  </div>
                  <div class="bulk-summary" id="bulkLinkSummary"></div>
                  <div class="preview-table-wrap" id="bulkLinkPreviewWrap" style="display:none;">
                    <table>
                      <thead><tr><th>Kode produk</th><th>Nama</th><th>Link lama</th><th>Link baru</th><th>Status</th></tr></thead>
                      <tbody id="bulkLinkPreviewBody"></tbody>
                    </table>
                  </div>
                </div>

                <div class="bulk-panel" id="bulk-inaproc">
                  <div class="bk-compose">
                    <div class="bk-cols" aria-label="Urutan kolom yang ditempel"><span class="bk-col"><b>A</b>No</span><span class="bk-col"><b>B</b>Nama</span><span class="bk-col"><b>C</b>Kategori</span><span class="bk-col"><b>D</b>Nomor Permohonan</span><span class="bk-col"><b>E</b>Tgl Pengajuan</span><span class="bk-col"><b>F</b>Status</span><span class="bk-col"><b>G</b>Alasan Ditolak</span></div>
                    <textarea class="paste-area" id="bulkInaprocPaste" placeholder="1&#9;Dental operative unit (RB-KRC-DTC.07-U01, ROBUST)&#9;Alat Kesehatan&#9;33190423&#9;10 Juli 2026&#9;Menunggu Persetujuan&#9;"></textarea>
                    <div class="bulk-actions">
                      <span class="bk-note">Tanpa header, dipisah tab, persis hasil curl INAPROC. Kode produk diambil dari kurung di kolom Nama. Tempel ulang aman: data lama (per Nomor Permohonan) di-update, tidak dobel.</span>
                      <button class="btn btn-ghost" id="bulkInaprocPreviewBtn"><i class="ti ti-eye"></i> Cek data</button>
                      <button class="btn btn-accent" id="bulkInaprocProsesBtn" style="display:none;"><i class="ti ti-check"></i> Proses semua</button>
                    </div>
                  </div>
                  <div class="bulk-summary" id="bulkInaprocSummary"></div>
                  <div class="preview-table-wrap" id="bulkInaprocPreviewWrap" style="display:none;">
                    <table>
                      <thead><tr><th>No. Permohonan</th><th>Kode terbaca</th><th>Nama</th><th>Tgl</th><th>Status</th><th>Match produk</th></tr></thead>
                      <tbody id="bulkInaprocPreviewBody"></tbody>
                    </table>
                  </div>
                </div>

                <div class="bulk-panel" id="bulk-verified">
                  <div class="vp-hint">
                    <i class="ti ti-info-circle"></i>
                    <ul>
                      <li>Paste hasil console script <code>semua-produk-tayang.js</code> (TSV, header boleh) atau pilih file <code>.tsv</code>-nya. Yang dipakai cuma <code>product_id</code>, <code>name</code>, <code>slug</code>.</li>
                      <li>Dicocokkan otomatis: UUID INAPROC &rarr; slug di Link V6 &rarr; nama. Ini <b>snapshot lengkap</b>: produk berbadge yang tidak ada di data ini kehilangan badge. Paste ulang aman.</li>
                      <li>Baris <b>Ambigu</b> (cocok ke &gt;1 produk) tidak diputuskan algoritma, kamu yang pilih lewat dropdown atau biarkan dilewati. Pilihanmu disimpan sebagai badge <i>manual</i> dan diingat di sync berikutnya.</li>
                    </ul>
                  </div>
                  <div class="bk-compose">
                    <div class="bk-cols" aria-label="Urutan kolom yang ditempel"><span class="bk-col"><b>A</b>product_id</span><span class="bk-col"><b>B</b>name</span><span class="bk-col"><b>C</b>slug</span><span class="bk-col bk-col-more">kolom lain diabaikan</span></div>
                    <div class="vp-file">
                      <label class="btn btn-ghost vp-file-btn" for="bulkVerifiedFile"><i class="ti ti-file-upload"></i> Pilih file .tsv</label>
                      <span class="vp-file-name" id="bulkVerifiedFileName">Belum ada file</span>
                      <input type="file" id="bulkVerifiedFile" accept=".tsv,.txt,.csv" hidden/>
                    </div>
                    <textarea class="paste-area" id="bulkVerifiedPaste" placeholder="product_id&#9;name&#9;slug&#9;..."></textarea>
                    <div class="bulk-actions">
                      <span class="bk-note">Header boleh ada.</span>
                      <button class="btn btn-ghost" id="bulkVerifiedPreviewBtn"><i class="ti ti-eye"></i> Cek data</button>
                      <button class="btn btn-accent" id="bulkVerifiedProsesBtn" style="display:none;"><i class="ti ti-check"></i> Sinkronkan</button>
                    </div>
                  </div>
                  <div class="bulk-summary vs-stats" id="bulkVerifiedSummary"></div>
                  <div class="preview-table-wrap" id="bulkVerifiedPreviewWrap" style="display:none;">
                    <table>
                      <colgroup><col style="width:44%"><col></colgroup>
                      <thead><tr><th>Listing INAPROC</th><th>Keputusan / catatan</th></tr></thead>
                      <tbody id="bulkVerifiedPreviewBody"></tbody>
                    </table>
                  </div>
                </div>
        </div>
      </div>
    </div>

    <!-- BULK KOMPOSISI SET dipindah ke Set Management > tab Composition (per-set, gak lintas-set lagi) -->
    <!-- (panel Verified Product disisipkan di bawah, di dalam #viewBulk) -->
    <!-- SYNC DARI SHEET VIEW: kode_produk yang kepantau di Google Sheets
         (lewat Apps Script pollAndSync -> Edge Function sync-sheet) tapi
         belum ada di tabel produk -- edge function nyatet ini ke tabel
         sync_unmatched_produk tiap poll, baris hilang sendiri dari sini
         begitu produknya dibuat.
         Susunan ikut kontrak SHELL v2: .vwrap > .content-head, .vtools, tab, filter aktif, .vbody (scroll), .pg-bar.
         Baris filter per kolom disuntik kfa.js ke <thead> (ensureSyncColFilterRow). -->
    <div class="content" id="viewSync" style="display:none;">
      <div class="vwrap">
        <div class="content-head">
          <div>
            <div class="content-title">Sync dari Sheet</div>
            <div class="content-sub" id="syncCount">Memuat...</div>
            <div class="content-hint">Kode dari Google Sheets yang belum ada di database. Tambah satu per satu lewat form, atau centang beberapa baris untuk menambah sekaligus.</div>
          </div>
          <div class="produk-head-actions">
            <button type="button" class="btn" id="syncReloadBtn"><i class="ti ti-refresh"></i> Muat ulang</button>
          </div>
        </div>
        <div class="vtools">
          <div class="akd-search-box">
            <i class="ti ti-search"></i>
            <input type="text" id="syncSearchInput" placeholder="Cari kode, deskripsi, sumber sheet, atau kode set..." aria-label="Cari di daftar sync"/>
          </div>
          <div id="syncBulkBar" class="sync-bulkbar" style="display:none;">
            <span id="syncBulkInfo" class="sync-bulk-info" aria-live="polite"></span>
            <button type="button" class="btn btn-sm" id="syncBulkClearBtn">Kosongkan</button>
            <button type="button" class="btn btn-sm btn-accent" id="syncBulkAddBtn"><i class="ti ti-plus"></i> Tambah produk</button>
          </div>
        </div>
        <div class="sync-tabs">
          <div class="filter-bar" id="syncStatusBar" role="group" aria-label="Filter status"></div>
          <div class="filter-bar" id="syncTipeBar" role="group" aria-label="Filter tipe"></div>
        </div>
        <div id="syncActiveBar" style="display:none;"></div>
        <div class="vbody">
          <div class="table-card">
            <table class="sync-table">
              <thead>
                <tr>
                  <th class="c-chk"><input type="checkbox" id="syncSelectAll" title="Pilih semua yang siap (sesuai filter)" aria-label="Pilih semua yang siap"/></th>
                  <th class="c-kode">Kode produk</th>
                  <th class="c-desk">Deskripsi</th>
                  <th class="c-link">Link V6</th>
                  <th class="c-harga num">Harga E-KAT</th>
                  <th class="c-sumber">Sumber</th>
                  <th class="c-status">Status</th>
                  <th class="c-aksi"></th>
                </tr>
              </thead>
              <tbody id="syncTableBody">
                <tr class="state-row"><td colspan="8">Memuat data...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <div class="pg-bar" id="syncPagination" style="display:none;"></div>
      </div>
    </div>

    <!-- ORPHAN / DRIFT VIEW: arah SEBALIKNYA dari Sync dari Sheet. Tab "Hilang di sheet" punya quick action
         hapus massal (RPC orphan_bulk_delete, sql/02_orphan_bulk_delete.sql) dan "Lokasi di DB" (RPC orphan_footprint,
         sql/03_orphan_footprint.sql); tab lain tetap hanya-baca. --
         yang ada di Supabase tapi sudah hilang/beda di Google Sheets (sheet = source of truth).
         Sumber: view v_sync_* + sync_orphan_produk, diisi pushManifest (Apps Script) ->
         edge function -> reverse_check_commit. -->
    <div class="content" id="viewOrphan" style="display:none;">
      <div class="vwrap">
        <div class="content-head">
          <div>
            <div class="content-title">Orphan / Drift</div>
            <div class="content-sub" id="orphanCount">Memuat...</div>
          </div>
          <div class="orph-actions">
            <button class="icon-btn" id="orphanRefreshBtn" type="button" title="Muat ulang data" aria-label="Muat ulang"><i class="ti ti-refresh"></i></button>
            <button class="btn btn-sm" id="orphanCopyBtn" type="button" title="Salin kode yang sedang tampil (sesuai filter)"><i class="ti ti-copy"></i> Salin kode</button>
            <button class="btn btn-sm" id="orphanCsvBtn" type="button" title="Unduh hasil yang sedang tampil sebagai CSV"><i class="ti ti-download"></i> Unduh CSV</button>
          </div>
        </div>
        <div class="orph-tabs" id="orphanSectionBar"></div>
        <div class="akd-toolbar">
          <div class="akd-search-box">
            <i class="ti ti-search"></i>
            <input type="text" id="orphanSearchInput" placeholder="Cari kode produk, nama, no AKD, kode set..." aria-label="Cari di tab ini"/>
          </div>
        </div>
        <div class="orph-filters" id="orphanFilterBar"></div>
        <div class="orph-quick" id="orphanQuick"></div>
        <div class="vbody">
          <div id="orphanRunInfo"></div>
          <div class="orph-stats" id="orphanStats"></div>
          <details class="orph-info">
            <summary><i class="ti ti-info-circle"></i> Cara membaca halaman ini</summary>
            <div class="orph-info-body">
              Kebalikan tab Sync: item yang <b>masih ada di database tapi sudah tidak ada / beda di Google Sheets</b>.
              Tidak ada yang dihapus otomatis. Di tab <b>Hilang di sheet</b> ada quick action hapus massal: server memeriksa ulang setiap kode
              terhadap snapshot terbaru, menolak yang masih punya riwayat atau kemungkinan cuma di-rename, dan menyimpan cadangan sebelum menghapus.
              Ikon <b>database</b> di samping kode menampilkan tabel dan kolom tempat item itu masih tercatat.
              Status <b>terkonfirmasi</b> berarti item hilang di 3 snapshot berturut-turut (antisipasi sheet sedang loading).
              Angka seperti <b>2/3</b> di kolom Status berarti item sudah hilang di 2 dari 3 snapshot yang dibutuhkan untuk terkonfirmasi.
            </div>
          </details>
          <div id="orphanBody"></div>
          <div class="orph-bulk" id="orphanBulkBar" style="display:none;">
            <span id="orphanBulkInfo"></span>
            <span class="orph-bulk-actions">
              <button class="btn btn-sm" id="orphanBulkClear" type="button">Kosongkan pilihan</button>
              <button class="btn btn-sm" id="orphanBulkCopy" type="button"><i class="ti ti-copy"></i> Salin kode terpilih</button>
              <button class="btn btn-sm" id="orphanBulkCsv" type="button"><i class="ti ti-download"></i> Unduh CSV terpilih</button>
              <button class="btn btn-sm btn-danger-ghost" id="orphanBulkDelete" type="button"><i class="ti ti-trash"></i> Hapus terpilih…</button>
            </span>
          </div>
        </div>
        <div class="pg-bar" id="orphanPagination" style="display:none;"></div>
      </div>
    </div>

    <!-- KATEGORI & SPESIALISASI VIEW -->
    <div class="content" id="viewKategori" style="display:none;">
      <div class="vwrap">
        <div class="content-head">
          <div>
            <div class="content-title">Kategori &amp; Spesialisasi</div>
            <div class="content-sub" id="katCount">Memuat...</div>
          </div>
          <div class="produk-head-actions">
            <button class="icon-btn" id="katRefreshBtn" type="button" title="Muat ulang hasil terakhir (bukan hitung ulang; lihat refresh_katalog_klasifikasi)" aria-label="Muat ulang"><i class="ti ti-refresh"></i></button>
            <button class="btn excel-export-btn" id="katExportViewBtn" style="display:none;" title="Export produk sesuai tab, filter, dan pencarian yang sedang aktif"><i class="ti ti-file-spreadsheet"></i> Export tampilan ini</button>
            <button class="btn btn-accent excel-export-btn" id="katExportAllBtn" title="Satu workbook: Ringkasan + satu sheet per spesialisasi (set &amp; instrumen) + satu sheet per kategori alat. Untuk dasar pengajuan nomor izin edar."><i class="ti ti-file-spreadsheet"></i> Export Excel (izin edar)</button>
          </div>
        </div>
        <div class="orph-tabs" id="katModeBar"></div>
        <div class="akd-toolbar" id="katToolbar" style="display:none;">
          <div class="akd-search-box">
            <i class="ti ti-search"></i>
            <input type="text" id="katSearchInput" placeholder="Cari kode, nama, golongan..."/>
          </div>
        </div>
        <div class="kat-filters" id="katChips"></div>
        <div class="vbody">
          <div id="katBody"></div>
        </div>
        <div class="pg-bar" id="katPagination" style="display:none;"></div>
      </div>
    </div>
  </main>
</div>

<!-- COMMAND PALETTE -->
<div class="cmdk-overlay" id="cmdkOverlay">
  <div class="cmdk-box">
    <div class="cmdk-input-wrap">
      <i class="ti ti-search"></i>
      <input type="text" class="cmdk-input" id="cmdkInput" placeholder="Cari kode produk atau nama..."/>
      <button class="modal-close" id="cmdkCloseBtn" type="button" title="Tutup (Esc)" aria-label="Tutup"><i class="ti ti-x"></i></button>
    </div>
    <div class="cmdk-list" id="cmdkList">
      <div class="cmdk-empty">Ketik untuk mencari produk...</div>
    </div>
    <div class="cmdk-foot">
      <span><kbd>↑↓</kbd> pilih</span>
      <span><kbd>Enter</kbd> buka</span>
      <span><kbd>Esc</kbd> tutup</span>
    </div>
  </div>
</div>

<!-- MODAL FORM PRODUK
     Urutan Info Dasar mengikuti urutan kerja: identitas (wajib) -> master/kode asli -> fisik -> tayang di INAPROC.
     Dibuang dari form (tidak ada pembaca di aplikasi): Manufacturer, Capital, Sub Family, Status V6.
     Field read-only (No. AKD, Masa Berlaku, Golongan, Kode KFA, Kode Cangkang, Nama Cangkang) pakai <output>
     -- .value tetap jalan seperti <input>, tapi tampil sebagai teks biasa, bukan kotak isian yang tidak bisa diisi. -->
<div class="modal-overlay" id="modalOverlay">
  <div class="modal-card prod-modal">
    <div class="modal-head">
      <div>
        <div class="modal-title" id="modalTitle">Tambah Produk</div>
        <div class="modal-sub" id="modalSub">Isi data produk baru</div>
      </div>
      <button class="modal-close" id="modalCloseBtn" type="button" title="Tutup" aria-label="Tutup"><i class="ti ti-x"></i></button>
    </div>

    <div class="prod-tabs" id="prodTabs" role="tablist">
      <button class="prod-tab active" data-tab="dasar" type="button">Info dasar</button>
      <button class="prod-tab locked" data-tab="akd" type="button" title="Simpan produk dulu">Legalitas AKD</button>
      <button class="prod-tab locked" data-tab="harga" type="button" title="Simpan produk dulu">Harga</button>
      <button class="prod-tab locked" data-tab="media" type="button" title="Simpan produk dulu">Media</button>
    </div>
    <div class="prod-tabs-hint" id="prodTabsHint">Legalitas AKD, harga, dan media terbuka setelah produk pertama kali disimpan.</div>

    <div class="prod-body">
      <div class="prod-tab-panel active" id="ptab-dasar">

        <section class="fs">
          <div class="fs-head">
            <h4>Identitas produk</h4>
            <label class="fs-toggle" for="f_is_active"><input type="checkbox" id="f_is_active" checked/> Produk aktif</label>
          </div>
          <div class="grid2">
            <div class="f"><label for="f_kode_produk">Kode produk *</label><input type="text" id="f_kode_produk" autocomplete="off" spellcheck="false"/></div>
            <div class="f"><label for="f_tipe">Tipe *</label>
              <select id="f_tipe">
                <option value="">Pilih tipe</option>
                <option value="UNIT">UNIT</option>
                <option value="INSTRUMENT">INSTRUMENT</option>
                <option value="SET">SET</option>
              </select>
            </div>
            <div class="f full"><label for="f_nama_produk">Nama produk</label><input type="text" id="f_nama_produk"/></div>
          </div>
        </section>

        <section class="fs">
          <div class="fs-head">
            <h4>Master produk</h4>
            <span class="fs-note">Data vendor, dicari lewat kode asli</span>
          </div>
          <div class="f">
            <label for="f_kode_asli">Kode asli</label>
            <div class="f-row">
              <input type="text" id="f_kode_asli" placeholder="mis. 35-133-06-07" autocomplete="off" spellcheck="false"/>
              <button class="btn btn-ghost btn-sm" id="cekMasterBtn" type="button"><i class="ti ti-search"></i> Cek</button>
            </div>
            <div id="masterLookupMsg"></div>
          </div>
          <div id="masterFields" style="display:none;">
            <div class="grid2">
              <div class="f full"><label for="m_deskripsi_vendor">Deskripsi vendor</label><input type="text" id="m_deskripsi_vendor"/></div>
              <div class="f"><label for="m_family">Family</label><input type="text" id="m_family"/></div>
            </div>
          </div>
        </section>

        <section class="fs">
          <div class="fs-head"><h4>Fisik &amp; spesifikasi</h4></div>
          <div class="grid2">
            <div class="f"><label for="f_berat_gram">Berat (gram)</label><input type="number" step="any" id="f_berat_gram" inputmode="decimal"/></div>
            <div class="f full"><label for="f_spesifikasi">Spesifikasi</label><textarea id="f_spesifikasi"></textarea></div>
          </div>
        </section>

        <section class="fs">
          <div class="fs-head"><h4>Tayang di INAPROC</h4></div>
          <div class="f">
            <label for="f_link_v6">Link V6</label>
            <input type="text" id="f_link_v6" placeholder="https://katalog.inaproc.id/..." autocomplete="off" spellcheck="false"/>
          </div>
          <div class="akd-hint" id="linkV6Hint" style="display:none;color:var(--amber-text);"></div>
          <div class="inaproc-status" id="inaprocIndikator" style="display:none;"></div>
          <div class="verified-row" id="verifiedRow" style="display:none;">
            <input type="checkbox" id="f_verified" disabled/>
            <label for="f_verified"><i class="ti ti-rosette-discount-check-filled vbadge" style="margin:0 6px 0 0;"></i>Verified Product (centang biru INAPROC)</label>
            <span id="verifiedSrc" class="verified-src"></span>
          </div>
        </section>

        <div id="gambarInstrumenSection" style="display:none;">
          <section class="fs">
            <div class="fs-head"><h4>Gambar instrumen</h4><span class="fs-note">Bucket thumbnails</span></div>
            <div class="img-box">
              <div id="gambarInstrumenPreviewWrap" style="display:none;flex-shrink:0;">
                <img id="gambarInstrumenPreview" alt="Preview gambar instrumen"/>
              </div>
              <div class="img-box-info">
                <span id="gambarInstrumenBadge" class="status-pill neutral">Mengecek...</span>
                <div id="gambarInstrumenHint" class="akd-hint"></div>
              </div>
              <div style="flex-shrink:0;">
                <input type="file" id="gambarInstrumenFileInput" accept="image/png" style="display:none;"/>
                <button class="btn btn-ghost btn-sm" id="gambarInstrumenUploadBtn" type="button"><i class="ti ti-upload"></i> Upload gambar</button>
              </div>
            </div>
          </section>
        </div>
      </div>

      <div class="prod-tab-panel" id="ptab-akd">
        <section class="fs">
          <div class="fs-head">
            <h4>Legalitas AKD</h4><span id="akdSealHolder"></span>
            <button class="btn btn-ghost btn-sm fs-action" id="toggleAkdBoxBtn" type="button"><i class="ti ti-link"></i> Kelola AKD</button>
          </div>
          <dl class="ro-grid">
            <div><dt>No. AKD</dt><dd><output id="f_no_akd"></output></dd></div>
            <div><dt>Masa berlaku</dt><dd><output id="f_masa_berlaku"></output></dd></div>
            <div><dt>Golongan</dt><dd><output id="f_golongan"></output></dd></div>
          </dl>
          <div class="akd-box" id="akdBox" style="display:none;">
            <div class="akd-current" id="akdCurrentList"></div>
            <div class="akd-search-wrap">
              <input type="text" class="field-input" id="akdSearchInput" placeholder="Cari nomor AKD atau nama..." style="padding:8px 10px;font-size:12.5px;"/>
              <div class="akd-results" id="akdResults"></div>
            </div>
            <div class="akd-hint" id="akdHint"></div>
          </div>
        </section>

        <section class="fs">
          <div class="fs-head">
            <h4>KFA</h4>
            <a href="javascript:void(0)" class="fs-link" id="jumpToKfaLink">Kelola di KFA Management</a>
          </div>
          <dl class="ro-grid">
            <div><dt>Kode KFA</dt><dd><output id="f_kode_kfa"></output></dd></div>
            <div><dt>Kode cangkang</dt><dd><output id="f_kode_cangkang"></output></dd></div>
            <div><dt>Nama cangkang</dt><dd><output id="f_nama_cangkang"></output></dd></div>
          </dl>
        </section>
      </div>

      <div class="prod-tab-panel" id="ptab-harga">
        <div id="hargaSection">
          <section class="fs">
            <div class="fs-head"><h4>Harga</h4></div>
            <div class="table-card">
              <table>
                <thead><tr><th>Tahun</th><th>Harga EKATALOG</th><th>Turunan (otomatis)</th><th></th></tr></thead>
                <tbody id="hargaTableBody">
                  <tr><td colspan="4" style="color:var(--text-muted);padding:14px;">Belum ada data harga</td></tr>
                </tbody>
              </table>
            </div>
            <div class="harga-add">
              <div class="f"><label>Tahun</label><input type="number" id="h_tahun" placeholder="2026"/></div>
              <div class="f"><label>Harga EKATALOG (Rp)</label><input type="number" step="any" id="h_harga" placeholder="0"/></div>
              <button class="btn btn-ghost" id="addHargaBtn" type="button"><i class="ti ti-plus"></i> Tambah</button>
            </div>
            <div class="akd-hint">SWASTA (×1,3) dan UPLOAD (÷1,11) dihitung &amp; disimpan otomatis dari Harga EKATALOG.</div>
          </section>
        </div>
      </div>

      <div class="prod-tab-panel" id="ptab-media">
        <div id="mediaSection">
          <section class="fs">
            <div class="fs-head"><h4>Brosur &amp; gambar</h4></div>
            <div class="table-card">
              <table>
                <thead><tr><th>Jenis</th><th>Judul</th><th>URL</th><th>Utama</th><th></th></tr></thead>
                <tbody id="mediaTableBody">
                  <tr><td colspan="5" style="color:var(--text-muted);padding:14px;">Belum ada media</td></tr>
                </tbody>
              </table>
            </div>
            <div class="media-add">
              <div class="f"><label>Jenis</label>
                <select id="md_jenis">
                  <option value="brosur">Brosur</option>
                  <option value="gambar">Gambar</option>
                </select>
              </div>
              <div class="f"><label>Judul</label><input type="text" id="md_judul" placeholder="Judul singkat"/></div>
              <div class="f full"><label>URL</label><input type="text" id="md_url" placeholder="https://..."/></div>
              <div class="f"><label>Urutan</label><input type="number" id="md_urutan" value="1" min="1"/></div>
              <div class="check-row" style="margin-top:20px;">
                <input type="checkbox" id="md_primary"/>
                <label for="md_primary">Jadikan utama</label>
              </div>
              <button class="btn btn-ghost" id="addMediaBtn" type="button"><i class="ti ti-plus"></i> Tambah</button>
            </div>
          </section>
        </div>
      </div>
    </div>

    <div class="modal-actions">
      <button class="btn btn-danger-ghost" id="deleteBtn" style="display:none;"><i class="ti ti-trash"></i> Hapus produk</button>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-ghost" id="cancelBtn">Batal</button>
        <button class="btn btn-accent" id="saveBtn"><i class="ti ti-check"></i> Simpan</button>
      </div>
    </div>
  </div>
</div>

<div class="toast-container" id="toastContainer"></div>

<!-- KONFIRMASI PERUBAHAN BELUM DISIMPAN -->
<div class="confirm-overlay" id="unsavedConfirmOverlay">
  <div class="confirm-card">
    <h3><i class="ti ti-alert-triangle"></i> Perubahan belum disimpan</h3>
    <p>Ada perubahan yang belum di-klik "Simpan". Kalau ditutup sekarang, perubahan itu bakal hilang.</p>
    <div class="confirm-actions">
      <button class="btn btn-ghost" id="unsavedStayBtn" type="button">Tetap Edit</button>
      <button class="btn btn-danger-ghost" id="unsavedDiscardBtn" type="button">Buang Perubahan</button>
      <button class="btn btn-accent" id="unsavedSaveBtn" type="button"><i class="ti ti-check"></i> Simpan &amp; Tutup</button>
    </div>
  </div>
</div>

<!-- KONFIRMASI GENERIC: pengganti window.confirm()/alert() bawaan browser buat
     10 aksi (lepas relasi AKD, hapus harga/media/item set/AKD/KFA/produk).
     Beda dari unsavedConfirmOverlay di atas (3 tombol, konteks fixed) --
     ini generic 2 tombol (Batal/OK), title/pesan/label diisi dinamis lewat
     crudConfirm() di index.js. Varian .danger nge-ganti ikon jadi merah +
     tombol OK jadi btn-danger-ghost, dipakai buat semua aksi hapus permanen. -->
<div class="confirm-overlay" id="orphDelOverlay">
  <div class="confirm-card danger orph-del-card" id="orphDelCard" role="dialog" aria-modal="true" aria-labelledby="orphDelTitle">
    <h3><i class="ti ti-trash"></i> <span id="orphDelTitle">Hapus produk orphan</span></h3>
    <div id="orphDelBody"></div>
    <div class="confirm-actions" id="orphDelActions"></div>
  </div>
</div>
<div class="confirm-overlay" id="genericConfirmOverlay">
  <div class="confirm-card" id="genericConfirmCard">
    <h3><i class="ti ti-alert-triangle" id="genericConfirmIcon"></i> <span id="genericConfirmTitle">Konfirmasi</span></h3>
    <p id="genericConfirmMsg"></p>
    <div class="confirm-actions">
      <button class="btn btn-ghost" id="genericConfirmCancelBtn" type="button">Batal</button>
      <button class="btn btn-accent" id="genericConfirmOkBtn" type="button">Ya, Lanjutkan</button>
    </div>
  </div>
</div>

<!-- LOG AKTIVITAS MODAL -->
<div class="modal-overlay" id="logModalOverlay">
  <div class="modal-card log-modal">
    <div class="modal-head">
      <div>
        <div class="modal-title">Log Aktivitas</div>
        <div class="modal-sub">Riwayat tambah/ubah/hapus di produk, harga, media, AKD & set</div>
      </div>
      <button class="modal-close" id="logModalCloseBtn" type="button" title="Tutup" aria-label="Tutup"><i class="ti ti-x"></i></button>
    </div>

    <div class="log-toolbar">
      <div class="f"><label>Tanggal</label><input type="date" id="log_tanggal"/></div>
      <div class="f">
        <label>Tabel</label>
        <select id="log_table">
          <option value="">Semua tabel</option>
          <option value="produk">produk</option>
          <option value="produk_harga">produk_harga</option>
          <option value="produk_media">produk_media</option>
          <option value="master_produk">master_produk</option>
          <option value="produk_akd">produk_akd</option>
          <option value="produk_set_item">produk_set_item</option>
          <option value="akd">akd</option>
        </select>
      </div>
      <div class="f">
        <label>Aksi</label>
        <select id="log_action">
          <option value="">Semua aksi</option>
          <option value="INSERT">Tambah</option>
          <option value="UPDATE">Ubah</option>
          <option value="DELETE">Hapus</option>
        </select>
      </div>
      <button class="btn btn-ghost" id="log_refresh"><i class="ti ti-refresh"></i> Muat ulang</button>
    </div>

    <div class="log-list" id="logList">
      <div style="color:var(--text-muted);padding:14px;">Memuat log...</div>
    </div>
    <div class="pg-bar" id="logPagination" style="display:none;"></div>
  </div>
</div>

<!-- AKD ADD/EDIT MODAL -->
<div class="modal-overlay" id="akdModalOverlay">
  <div class="modal-card">
    <div class="modal-head">
      <div>
        <div class="modal-title" id="akdModalTitle">Tambah AKD</div>
        <div class="modal-sub" id="akdModalSub">Isi data AKD baru</div>
      </div>
      <button class="modal-close" id="akdModalCloseBtn" type="button" title="Tutup" aria-label="Tutup"><i class="ti ti-x"></i></button>
    </div>

    <div class="sec-label">Identitas AKD</div>
    <div class="grid2">
      <div class="f"><label>Tipe AKD *</label>
        <select id="a_tipe_akd">
          <option value="">— pilih —</option>
          <option value="satuan">satuan</option>
          <option value="set">set</option>
          <option value="unit">unit</option>
        </select>
      </div>
      <div class="f"><label>No. AKD *</label><input type="text" id="a_no_akd"/></div>
      <div class="f full"><label>Nama AKD</label><input type="text" id="a_nama_akd"/></div>
      <div class="f"><label>Nama Database</label><input type="text" id="a_nama_database"/></div>
      <div class="f"><label>Kode Set</label><input type="text" id="a_kode_set" placeholder="Isi kalau tipe AKD = set"/></div>
      <div class="f"><label>Kategori Set</label><input type="text" id="a_kategori_set"/></div>
      <div class="f"><label>Penanda Kode</label><input type="text" id="a_penanda_kode"/></div>
      <div class="f"><label>Golongan</label><input type="text" id="a_golongan" list="akd_golongan_list"/><datalist id="akd_golongan_list"></datalist></div>
    </div>

    <div class="sec-label">Status &amp; Jadwal</div>
    <div class="grid2">
      <div class="f"><label>Masa Berlaku</label><input type="date" id="a_masa_berlaku"/></div>
      <div class="f"><label>Tgl Maju Mas Munir</label><input type="date" id="a_tgl_maju_mas_munir"/></div>
      <div class="f full"><label>Status Terupdate</label><input type="text" id="a_status_terupdate" list="akd_status_list"/><datalist id="akd_status_list"></datalist></div>
      <div class="f full"><label>Link Dokumen</label><input type="text" id="a_link_dokumen" placeholder="https://..."/></div>
      <div class="f full"><label>Update Progres</label><textarea id="a_update_progres" placeholder="Catatan progres..."></textarea></div>
    </div>
    <div class="akd-hint" style="margin-top:6px;"><i class="ti ti-info-circle"></i> Arti pasti kolom "Tgl Maju Mas Munir" &amp; "Status Terupdate" masih perlu dikonfirmasi ke tim — sementara ditampilkan apa adanya sesuai nama kolom di database.</div>

    <div class="sec-label" id="akdLinkedProdukLabel" style="display:none;">Produk Terhubung</div>
    <div id="akdLinkedProdukList" style="display:none;"></div>

    <div class="modal-actions">
      <button class="btn btn-danger-ghost" id="deleteAkdBtn" style="display:none;"><i class="ti ti-trash"></i> Hapus AKD</button>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-ghost" id="akdCancelBtn">Batal</button>
        <button class="btn btn-accent" id="akdSaveBtn"><i class="ti ti-check"></i> Simpan</button>
      </div>
    </div>
  </div>
</div>

<div class="modal-overlay" id="kfaModalOverlay">
  <div class="modal-card">
    <div class="modal-head">
      <div>
        <div class="modal-title" id="kfaModalTitle">Detail KFA</div>
        <div class="modal-sub" id="kfaModalSub">—</div>
      </div>
      <button class="modal-close" id="kfaModalCloseBtn" type="button" title="Tutup" aria-label="Tutup"><i class="ti ti-x"></i></button>
    </div>

    <div class="sec-label">Data KFA</div>
    <div class="grid2">
      <div class="f full"><label>Kode KFA</label><input type="text" id="k_kode_kfa" placeholder="Kosongkan kalau belum dapet kode"/></div>
      <div class="f"><label>Kode Cangkang</label><input type="text" id="k_kode_cangkang" placeholder="cth. 82xxxxxx"/></div>
      <div class="f"><label>Nama Cangkang</label><input type="text" id="k_nama_cangkang" placeholder="cth. Cangkang Bedah Ortopedi"/></div>
      <div class="f"><label>Tgl Verifikasi</label><input type="date" id="k_tanggal_verifikasi"/></div>
      <div class="f full"><label>No. AKD Rujukan</label><input type="text" id="k_no_akd_rujukan" placeholder="Dasar pengajuan KFA ini"/></div>
      <div class="f full"><label>Catatan</label><textarea id="k_catatan" placeholder="Catatan bebas..."></textarea></div>
    </div>
    <div class="akd-hint" style="margin-top:6px;"><i class="ti ti-info-circle"></i> Kode KFA di sini otomatis kesinkron ke data produk. Berlaku sama buat SET maupun instrumen satuan.</div>

    <div class="modal-actions">
      <button class="btn btn-danger-ghost" id="deleteKfaBtn"><i class="ti ti-trash"></i> Hapus Record</button>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-ghost" id="kfaCancelBtn">Batal</button>
        <button class="btn btn-accent" id="kfaSaveBtn"><i class="ti ti-check"></i> Simpan</button>
      </div>
    </div>
  </div>
</div>
`;