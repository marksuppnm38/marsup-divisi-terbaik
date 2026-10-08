// Static markup untuk halaman Spek Maker.
// Pola SAMA dengan export-gambar/markup.js: pw-topbar + .page-head + .card/
// .card-head/.icon-box dari pnm-universal.css, tanpa token/warna baru.
// Semua CSS khusus halaman ini di style.css, di-scope di bawah `.sm-page`.
export const SPEK_MAKER_MARKUP = `
<div class="sm-page">
  <div class="pw-topbar">
    <div class="pw-topbar-crumb"><strong>Spek Maker</strong></div>
  </div>

  <main>
    <div class="sm-col">
      <div class="page-head">
        <h1>Spek Maker</h1>
        <p>Buat lembar spesifikasi PDF dari kode produk.</p>
      </div>

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
  </main>

  <input type="file" id="smFileInput" accept="image/*" hidden>
</div>

<div id="smToastRoot" class="sm-toast-root" aria-live="assertive"></div>
`;