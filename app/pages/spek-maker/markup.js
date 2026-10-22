// Static markup untuk halaman Spek Maker.
// Pola SAMA dengan export-gambar/markup.js: pw-topbar + .page-head + .card/
// .card-head/.icon-box dari pnm-universal.css, tanpa token/warna baru.
// Semua CSS khusus halaman ini di style.css, di-scope di bawah `.sm-page`.
export const SPEK_MAKER_MARKUP = `
<div class="sm-page">
  <div class="pw-topbar">
    <div class="pw-topbar-crumb"><strong>Document Maker</strong></div>
  </div>

  <main>
    <div class="sm-col">
      <div class="page-head">
        <h1>Document Maker</h1>
        <p>Buat dokumen PDF: lembar spesifikasi dan struktur harga dari kode produk, lampiran isi set, serta surat permohonan presentasi (SPP).</p>
      </div>

      <div class="sm-tabs" role="tablist" aria-label="Jenis dokumen">
        <button type="button" class="sm-tab active" role="tab" aria-selected="true" data-action="tab" data-tab="spek"><i class="ti ti-file-description" aria-hidden="true"></i> Spesifikasi</button>
        <button type="button" class="sm-tab" role="tab" aria-selected="false" data-action="tab" data-tab="struktur"><i class="ti ti-receipt-2" aria-hidden="true"></i> Struktur Harga</button>
        <button type="button" class="sm-tab" role="tab" aria-selected="false" data-action="tab" data-tab="spp"><i class="ti ti-presentation" aria-hidden="true"></i> SPP</button>
        <button type="button" class="sm-tab" role="tab" aria-selected="false" data-action="tab" data-tab="lampiran"><i class="ti ti-list-details" aria-hidden="true"></i> Lampiran Set</button>
        <button type="button" class="sm-tab" role="tab" aria-selected="false" data-action="tab" data-tab="bulk"><i class="ti ti-stack-2" aria-hidden="true"></i> Bulk</button>
      </div>

      <div id="smPanelSpek" role="tabpanel">

      <!-- INPUT -->
      <div class="card">
        <div class="card-head">
          <div class="icon-box blue"><i class="ti ti-file-description"></i></div>
          <div class="card-head-text">
            <h2>Kode Produk</h2>
            <p>Deskripsi dan gambar diambil otomatis dari database.</p>
          </div>
        </div>
        <label class="field-label" for="smCodes">Kode <span class="sm-field-hint">satu per baris, maks 50</span></label>
        <textarea id="smCodes" class="field-input sm-textarea" placeholder="RBB-KEC-B076-U1R&#10;RBB-KEC-B077-U1R" aria-label="Kode produk, satu per baris"></textarea>
        <button id="smResolveBtn" type="button" class="btn btn-accent sm-mt-16" data-action="resolve-codes">
          <i class="ti ti-search" aria-hidden="true"></i> Ambil Data
        </button>
      </div>

      <!-- DAFTAR -->
      <div id="smListCard" class="card sm-mt-16" style="display:none;">
        <div class="card-head">
          <div class="icon-box green"><i class="ti ti-list-check"></i></div>
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
          <div class="icon-box blue"><i class="ti ti-photo"></i></div>
          <div class="card-head-text"><h2 id="smPreviewTitle">Preview</h2></div>
        </div>
        <iframe id="smPreviewFrame" class="sm-preview" title="Preview PDF spesifikasi"></iframe>
      </div>
      </div>

      <div id="smPanelStruktur" role="tabpanel" style="display:none;"></div>

      <div id="smPanelSpp" role="tabpanel" style="display:none;"></div>

      <div id="smPanelLampiran" role="tabpanel" style="display:none;"></div>

      <div id="smPanelBulk" role="tabpanel" style="display:none;"></div>
    </div>
  </main>

  <input type="file" id="smFileInput" accept="image/*" hidden>
</div>

<div id="smToastRoot" class="sm-toast-root" aria-live="assertive"></div>
`;