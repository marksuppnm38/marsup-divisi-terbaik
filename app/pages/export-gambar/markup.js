// Static markup for the export-gambar page.
//
// Struktur: pw-topbar + komponen shared pnm-universal.css (.page-head, .card,
// .field-label/.field-input, .btn-accent/.btn-ghost/.btn-primary, .stat-pill), sama
// seperti dashboard/stok. CSS khusus halaman (list file, chip dengan tombol hapus,
// frame canvas preview, toast) ada di style.css dan SEMUANYA di-scope di bawah
// `.eg-page` (nol bare selector supaya tidak bocor ke modul lain; remove() di
// unmount() index.js hanya lapis pertahanan kedua).
//
// Tidak ada login gate di markup ini; router.js baru mount() setelah
// shared/auth-gate.js lolos.
//
// Catatan desain: copy sengaja ringkas (label pendek, tombol 1-2 kata). Tombol
// "Terapkan kode" adalah inline text link (.eg-link-btn) supaya tidak bersaing dengan
// CTA utama (Preview); metadata hasil satu baris (.eg-meta), bukan 3 kotak; kolom
// konten dibatasi 640px (.eg-col) -- lihat komentar FULLBLEED pada `.eg-page main` di
// style.css. Tiap card punya .card-head/.icon-box (biru untuk input, hijau untuk
// hasil), subtitle satu baris atau dihilangkan bila redundan dengan .eg-meta.
export const EXPORT_GAMBAR_MARKUP = `
<div class="eg-page">
  <div class="pw-topbar">
    <div class="pw-topbar-crumb"><strong>Merge &amp; Export</strong></div>
  </div>

  <main>
    <div class="eg-col">
      <div class="page-head">
        <h1>Merge &amp; Export</h1>
        <p>Gabungkan sampai 4 gambar produk jadi satu file PNG.</p>
      </div>

      <div class="eg-tabs" role="tablist" aria-label="Mode">
        <button type="button" class="eg-tab active" role="tab" aria-selected="true" data-action="tab" data-tab="single"><i class="ti ti-layout-grid" aria-hidden="true"></i> Satuan</button>
        <button type="button" class="eg-tab" role="tab" aria-selected="false" data-action="tab" data-tab="bulk"><i class="ti ti-stack-2" aria-hidden="true"></i> Bulk</button>
      </div>

      <div id="egPanelSingle" role="tabpanel">

      <!-- SELECTION -->
      <div class="card">
        <div class="card-head">
          <div class="icon-box blue"><i class="ti ti-stack-2"></i></div>
          <div class="card-head-text">
            <h2>Pilih Gambar</h2>
            <p>Tempel kode produk atau cari manual.</p>
          </div>
        </div>
        <span class="field-label" id="templateLabel">Template</span>
        <div class="eg-seg" role="radiogroup" aria-labelledby="templateLabel">
          <button type="button" role="radio" aria-checked="true" class="eg-seg-btn active" data-action="set-template" data-template="robust">Robust</button>
          <button type="button" role="radio" aria-checked="false" class="eg-seg-btn" data-action="set-template" data-template="adler">Adler</button>
        </div>

        <label class="field-label eg-mt-16" for="bulkInput">Kode produk <span class="eg-field-hint">satu per baris, maks 4</span></label>
        <textarea id="bulkInput" class="field-input eg-textarea" placeholder="MY001&#10;MY002&#10;MY003&#10;MY004" aria-label="Input kode file, satu per baris"></textarea>
        <button type="button" class="eg-link-btn" data-action="apply-bulk-input">
          <i class="ti ti-corner-down-left" aria-hidden="true"></i> Terapkan
        </button>

        <label class="field-label eg-mt-16" for="searchInput">Atau cari nama file</label>
        <input type="text" id="searchInput" class="field-input" placeholder="Ketik untuk mencari..." aria-label="Cari nama file">

        <div id="fileList" class="eg-file-list eg-mt-16" role="listbox" aria-multiselectable="true" aria-label="Daftar file"></div>
        <div class="eg-drop eg-mt-16">
          <i class="ti ti-clipboard-plus" aria-hidden="true"></i>
          <span>Tempel gambar (Ctrl+V) atau seret ke sini &middot;</span>
          <button type="button" class="eg-link-btn" data-action="pick-image">pilih file</button>
          <input type="file" id="imageFileInput" accept="image/*" multiple hidden>
        </div>
        <div id="selectedChips" class="eg-chips"></div>

        <button id="previewBtn" class="btn btn-accent eg-mt-16" data-action="merge-and-preview" aria-label="Tampilkan preview hasil merge">
          <i class="ti ti-layout-grid" aria-hidden="true"></i> Preview
        </button>
      </div>

      <!-- PREVIEW -->
      <div id="previewContainer" class="card eg-mt-16" style="display:none;">
        <div class="card-head">
          <div class="icon-box green"><i class="ti ti-photo"></i></div>
          <div class="card-head-text">
            <h2>Hasil</h2>
          </div>
        </div>
        <canvas id="finalCanvas" class="eg-canvas" role="img" aria-label="Preview hasil gambar gabungan"></canvas>
        <p class="eg-meta" role="status" aria-live="polite">PNG &middot; latar transparan &middot; <span id="metaCount">0</span> gambar</p>
        <button id="exportBtn" class="btn btn-primary" data-action="export-canvas-png" style="display:none;width:100%;justify-content:center;" aria-label="Export hasil sebagai file PNG">
          <i class="ti ti-download" aria-hidden="true"></i> Unduh PNG
        </button>
      </div>
      </div>

      <div id="egPanelBulk" role="tabpanel" style="display:none;"></div>
    </div>
  </main>
</div>

<div id="toastRoot" class="eg-toast-root" aria-live="assertive"></div>
`;