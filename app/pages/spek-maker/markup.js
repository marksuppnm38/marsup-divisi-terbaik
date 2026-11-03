// Static markup untuk halaman Document Maker (modul spek-maker).
//
// Pola SAMA dengan export-gambar/markup.js: pw-topbar breadcrumb + toolbar tipis
// (segmented tab + petunjuk + Reset) + workspace dua panel. Tanpa token/warna baru,
// semuanya dari pnm-universal.css. Semua CSS khusus halaman ini ada di style.css,
// di-scope di bawah `.sm-page`.
//
// Tab lain (Struktur Harga, SPP, Lampiran Set, Bulk) di-mount oleh index.js ke
// panel kosong di bawah; markup mereka ada di masing-masing *-ui.js.
export const SPEK_MAKER_MARKUP = `
<div class="sm-page">
  <div class="pw-topbar">
    <div class="pw-topbar-crumb">Document Maker <span class="pw-topbar-crumb-sep">/</span> <strong id="smCrumb">Spesifikasi</strong></div>
  </div>

  <div class="sm-toolbar">
    <div class="sm-seg" role="tablist" aria-label="Jenis dokumen">
      <button type="button" class="sm-tab active" id="smTab-spek" role="tab" aria-selected="true" aria-controls="smPanelSpek" tabindex="0" data-action="tab" data-tab="spek"><i class="ti ti-file-description" aria-hidden="true"></i> Spesifikasi</button>
      <button type="button" class="sm-tab" id="smTab-struktur" role="tab" aria-selected="false" aria-controls="smPanelStruktur" tabindex="-1" data-action="tab" data-tab="struktur"><i class="ti ti-receipt-2" aria-hidden="true"></i> Struktur Harga</button>
      <button type="button" class="sm-tab" id="smTab-spp" role="tab" aria-selected="false" aria-controls="smPanelSpp" tabindex="-1" data-action="tab" data-tab="spp"><i class="ti ti-presentation" aria-hidden="true"></i> SPP</button>
      <button type="button" class="sm-tab" id="smTab-lampiran" role="tab" aria-selected="false" aria-controls="smPanelLampiran" tabindex="-1" data-action="tab" data-tab="lampiran"><i class="ti ti-list-details" aria-hidden="true"></i> Lampiran Set</button>
      <button type="button" class="sm-tab" id="smTab-bulk" role="tab" aria-selected="false" aria-controls="smPanelBulk" tabindex="-1" data-action="tab" data-tab="bulk"><i class="ti ti-stack-2" aria-hidden="true"></i> Bulk</button>
    </div>
    <span class="sm-toolbar-hint" id="smHint"></span>
    <button type="button" class="sm-reset" id="smResetBtn" data-action="reset-tab" title="Kosongkan tab ini dan mulai dari awal">
      <i class="ti ti-refresh" aria-hidden="true"></i> <span id="smResetLabel">Reset</span>
    </button>
  </div>

  <main>
    <h1 class="sm-sr">Document Maker</h1>
    <div class="sm-col">

      <!-- ═════════ SPESIFIKASI ═════════ -->
      <div id="smPanelSpek" class="sm-panel" role="tabpanel" aria-labelledby="smTab-spek">

        <!-- INPUT -->
        <div class="card">
          <div class="card-head">
            <div class="icon-box blue"><i class="ti ti-file-description" aria-hidden="true"></i></div>
            <div class="card-head-text">
              <h2>Kode Produk</h2>
              <p>Deskripsi dan gambar diambil otomatis dari database.</p>
            </div>
          </div>
          <label class="field-label" for="smCodes">Kode <span class="sm-field-hint">satu per baris, maks 50</span></label>
          <textarea id="smCodes" class="field-input sm-textarea" spellcheck="false" autocomplete="off" placeholder="RBB-KEC-B076-U1R&#10;RBB-KEC-B077-U1R" aria-label="Kode produk, satu per baris" aria-describedby="smCodeStatus"></textarea>
          <p id="smCodeStatus" class="sm-code-status" role="status" aria-live="polite"></p>
          <div class="sm-actions sm-mt-12">
            <span class="sm-kbd-hint"><kbd>Ctrl</kbd> + <kbd>Enter</kbd> untuk ambil data</span>
            <button id="smResolveBtn" type="button" class="btn btn-accent" data-action="resolve-codes">
              <i class="ti ti-search" aria-hidden="true"></i> <span id="smResolveLabel">Ambil Data</span>
            </button>
          </div>
        </div>

        <!-- DAFTAR -->
        <div id="smListCard" class="card sm-mt-16" style="display:none;">
          <div class="card-head">
            <div class="icon-box green"><i class="ti ti-list-check" aria-hidden="true"></i></div>
            <div class="card-head-text">
              <h2>Hasil</h2>
              <p id="smListSummary"></p>
            </div>
          </div>
          <div id="smList" class="sm-list"></div>
          <div class="sm-actions sm-mt-16">
            <button id="smPreviewBtn" type="button" class="btn btn-ghost" data-action="preview-first">
              <i class="ti ti-eye" aria-hidden="true"></i> Preview
            </button>
            <button id="smDownloadBtn" type="button" class="btn btn-primary" data-action="download-all">
              <i class="ti ti-download" aria-hidden="true"></i> <span id="smDownloadLabel">Unduh PDF</span>
            </button>
          </div>
        </div>

        <!-- PREVIEW -->
        <div id="smPreviewCard" class="card sm-mt-16" style="display:none;">
          <div class="card-head">
            <div class="icon-box blue"><i class="ti ti-photo" aria-hidden="true"></i></div>
            <div class="card-head-text"><h2 id="smPreviewTitle">Preview</h2></div>
          </div>
          <iframe id="smPreviewFrame" class="sm-preview" title="Preview PDF spesifikasi"></iframe>
        </div>
      </div>

      <div id="smPanelStruktur" class="sm-panel" role="tabpanel" aria-labelledby="smTab-struktur" style="display:none;"></div>

      <div id="smPanelSpp" class="sm-panel" role="tabpanel" aria-labelledby="smTab-spp" style="display:none;"></div>

      <div id="smPanelLampiran" class="sm-panel" role="tabpanel" aria-labelledby="smTab-lampiran" style="display:none;"></div>

      <div id="smPanelBulk" class="sm-panel sm-panel-bulk" role="tabpanel" aria-labelledby="smTab-bulk" style="display:none;"></div>
    </div>
  </main>

  <input type="file" id="smFileInput" accept="image/*" hidden>
</div>

<div id="smToastRoot" class="sm-toast-root" aria-live="assertive"></div>
`;