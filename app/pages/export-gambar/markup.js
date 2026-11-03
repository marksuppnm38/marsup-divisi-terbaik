// Static markup for the export-gambar page ("Merge & Export").
//
// UX (rewrite): satu layar, dua panel -- sama pola dengan Konversi (topbar
// breadcrumb + toolbar tipis + workspace):
//   [1 Pilih gambar]  kode produk ditempel -> terbaca OTOMATIS (tanpa tombol
//                     "Terapkan"), 4 slot tetap menunjukkan urutan gambar.
//   [2 Hasil]         preview ikut berubah OTOMATIS (tanpa tombol "Preview");
//                     ganti template cukup klik, lalu "Unduh PNG".
// Tab Bulk memakai kerangka dua panel yang sama (lihat bulk-thumb.js).
//
// Semua CSS di-scope di bawah `.eg-page` (style.css). Tidak ada login gate di
// sini; router.js baru mount() setelah shared/auth-gate.js lolos.
export const EXPORT_GAMBAR_MARKUP = `
<div class="eg-page">
  <div class="pw-topbar">
    <div class="pw-topbar-crumb">Merge &amp; Export <span class="pw-topbar-crumb-sep">/</span> <strong id="egCrumb">Satuan</strong></div>
  </div>

  <div class="eg-toolbar">
    <div class="eg-seg" role="tablist" aria-label="Mode">
      <button type="button" class="eg-seg-btn eg-tab active" role="tab" aria-selected="true" data-action="tab" data-tab="single"><i class="ti ti-layout-grid" aria-hidden="true"></i> Satuan</button>
      <button type="button" class="eg-seg-btn eg-tab" role="tab" aria-selected="false" data-action="tab" data-tab="bulk"><i class="ti ti-stack-2" aria-hidden="true"></i> Bulk</button>
    </div>
    <span class="eg-toolbar-hint" id="egHint">Gabungkan sampai 4 gambar produk jadi satu PNG.</span>
  </div>

  <main>
    <div class="eg-wrap">

      <!-- ═════════ SATUAN ═════════ -->
      <div id="egPanelSingle" role="tabpanel">
        <div class="eg-split">

          <!-- 1. PILIH GAMBAR -->
          <section class="card eg-src" aria-labelledby="egH1">
            <div class="eg-step">
              <span class="eg-step-n" aria-hidden="true">1</span>
              <div class="eg-step-t"><h2 id="egH1">Pilih gambar</h2><p>Tempel kode produk, gambar langsung terbaca.</p></div>
            </div>

            <label class="field-label" for="bulkInput">Kode produk <span class="eg-field-hint">satu per baris, maks 4</span></label>
            <textarea id="bulkInput" class="field-input eg-textarea" spellcheck="false" autocomplete="off" placeholder="RB32-KE861-B002-U07&#10;RB32-KE861-B003-U07" aria-label="Kode produk, satu per baris"></textarea>
            <p id="codeStatus" class="eg-status" role="status" aria-live="polite"></p>

            <span class="field-label eg-mt-16">Urutan di gambar</span>
            <div id="selectedChips" class="eg-slots" aria-label="Gambar terpilih"></div>

            <div class="eg-drop eg-mt-16">
              <i class="ti ti-clipboard-plus" aria-hidden="true"></i>
              <span>Punya gambar sendiri? Tempel (Ctrl+V), seret ke sini, atau</span>
              <button type="button" class="eg-link-btn" data-action="pick-image">pilih file</button>
              <input type="file" id="imageFileInput" accept="image/*" multiple hidden>
            </div>

            <details class="eg-browse eg-mt-16">
              <summary><i class="ti ti-list-search" aria-hidden="true"></i> Cari manual dari daftar file</summary>
              <input type="text" id="searchInput" class="field-input eg-mt-8" placeholder="Ketik untuk mencari..." aria-label="Cari nama file" autocomplete="off">
              <div id="fileList" class="eg-file-list eg-mt-8" role="listbox" aria-multiselectable="true" aria-label="Daftar file"></div>
            </details>
          </section>

          <!-- 2. HASIL -->
          <section class="card eg-out" aria-labelledby="egH2">
            <div class="eg-step">
              <span class="eg-step-n" aria-hidden="true">2</span>
              <div class="eg-step-t"><h2 id="egH2">Hasil</h2><p id="egPrevState" role="status" aria-live="polite">Belum ada gambar dipilih</p></div>
              <div class="eg-seg eg-step-r" role="radiogroup" aria-label="Template">
                <button type="button" role="radio" aria-checked="true" class="eg-seg-btn active" data-action="set-template" data-template="robust">Robust</button>
                <button type="button" role="radio" aria-checked="false" class="eg-seg-btn" data-action="set-template" data-template="adler">Adler</button>
              </div>
            </div>

            <div id="egStage" class="eg-stage is-empty">
              <canvas id="finalCanvas" class="eg-canvas" role="img" aria-label="Preview hasil gambar gabungan"></canvas>
              <div class="eg-empty">
                <i class="ti ti-photo-plus" aria-hidden="true"></i>
                <strong>Preview muncul di sini</strong>
                <span>Tempel kode produk di kiri. Tidak perlu klik apa-apa.</span>
              </div>
              <div class="eg-loading" aria-hidden="true"><span class="eg-spin"></span></div>
            </div>

            <div class="eg-out-foot">
              <div class="eg-fname-wrap">
                <span class="eg-fname-label">Nama file</span>
                <code id="egFileName" class="eg-fname">—</code>
              </div>
              <button id="exportBtn" type="button" class="btn btn-primary" data-action="export-canvas-png" disabled aria-label="Unduh hasil sebagai file PNG">
                <i class="ti ti-download" aria-hidden="true"></i> Unduh PNG
              </button>
            </div>
          </section>

        </div>
      </div>

      <!-- ═════════ BULK (diisi bulk-thumb.js) ═════════ -->
      <div id="egPanelBulk" role="tabpanel" style="display:none;"></div>
    </div>
  </main>
</div>

<div id="toastRoot" class="eg-toast-root" aria-live="assertive"></div>
`;