// Static markup for the export-gambar page, extracted from export-gambar-gabungan.html.
// Kept as a plain template string (zero-build: no bundler to import .html as text).
export const EXPORT_GAMBAR_MARKUP = `

<!-- AUTH GATE -->
<div class="gate-wrap" id="gateWrap">
  <div class="gate-card">
    <div class="gate-card-inner">
      <div class="gate-title" id="gateTitle">Masuk dulu ya</div>
      <div class="gate-desc" id="gateDesc">Khusus tim internal — pakai akun yang sama seperti Konversian/Produk.</div>

      <form id="loginFormWrap">
        <div class="field">
          <label for="loginEmail">Email</label>
          <input type="text" id="loginEmail" placeholder="nama@email.com" autocomplete="email">
        </div>
        <div class="field">
          <label for="loginPassword">Password</label>
          <input type="password" id="loginPassword" placeholder="••••••••" autocomplete="current-password">
        </div>
        <button class="btn btn-primary" id="loginBtn" type="submit">
          <span class="btn-text">Masuk</span>
        </button>
      </form>

      <div class="gate-msg" id="gateMsg"></div>
      <div class="gate-footer">Akses dibatasi hanya untuk email yang terdaftar di tim.</div>
    </div>
  </div>
</div>

<!-- APP SHELL -->
<div class="page" id="appWrap" style="display:none;">

  <div class="eyebrow"><span class="dot"></span>Image Compositing Tool</div>
  <h1>Merge &amp; <span class="accent">Export</span></h1>
  <p class="lede">Gabungkan gambar dari daftar file kamu ke dalam satu template, lalu unduh hasilnya sebagai PNG dalam beberapa klik.</p>

  <!-- SELECTION MODULE -->
  <div class="bezel">
    <div class="bezel-inner">
      <div class="module-label">Pilih File</div>

      <div class="field">
        <label for="bulkInput">Input cepat <span class="field-hint">(1 kode per baris, tekan Enter)</span></label>
        <textarea id="bulkInput" placeholder="Contoh:&#10;MY001&#10;MY002&#10;MY003&#10;MY004" aria-label="Input kode file, satu per baris"></textarea>
        <button type="button" class="btn btn-ghost" onclick="applyBulkInput()">
          <span class="btn-text">Terapkan Kode</span>
          <span class="btn-icon" aria-hidden="true">⏎</span>
        </button>
      </div>

      <div class="module-label">atau pilih manual</div>

      <div class="field">
        <label for="searchInput">Cari nama file</label>
        <input type="text" id="searchInput" placeholder="Ketik untuk mencari..." oninput="renderFileList()" aria-label="Cari nama file">
      </div>

      <div class="field">
        <label>Pilih gambar <span class="field-hint">(1–4 gambar)</span></label>
        <div id="fileList" class="file-list" role="listbox" aria-multiselectable="true" aria-label="Daftar file"></div>
        <div id="selectedChips" class="chips"></div>
      </div>

      <button id="previewBtn" class="btn btn-primary" onclick="mergeAndPreview()" aria-label="Tampilkan preview hasil merge">
        <span class="btn-text">Tampilkan Preview</span>
        <span class="btn-icon" aria-hidden="true">↗</span>
      </button>
    </div>
  </div>

  <!-- PREVIEW MODULE -->
  <div id="previewContainer" class="bezel image-container">
    <div class="bezel-inner">
      <div class="module-label">Hasil Merge</div>

      <canvas id="finalCanvas" role="img" aria-label="Preview hasil gambar gabungan"></canvas>

      <div class="meta-grid" role="status" aria-live="polite">
        <div class="meta-item"><span class="k">Status</span><span class="v">Rendered</span></div>
        <div class="meta-item"><span class="k">Format</span><span class="v">PNG</span></div>
        <div class="meta-item"><span class="k">Mode</span><span class="v">Alpha Mask</span></div>
        <div class="meta-item"><span class="k">Gambar</span><span class="v" id="metaCount">0</span></div>
      </div>

      <button id="exportBtn" class="btn btn-confirm" onclick="exportCanvasAsPNG()" style="display:none;" aria-label="Export hasil sebagai file PNG">
        <span class="btn-text">Export sebagai PNG</span>
        <span class="btn-icon" aria-hidden="true">↓</span>
      </button>
    </div>
  </div>

  <footer>© Merge Systems</footer>

</div>

<div id="toastRoot" aria-live="assertive"></div>
`;
