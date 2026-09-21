// Static markup for the export-gambar page.
//
// Sesi kesembilan belas: REWRITTEN dari nol, dua alasan sekaligus:
//   1. Per-page auth-gate (gateWrap/appWrap/loginFormWrap) DIHAPUS -- lihat
//      map-history.md. router.js gak mount() halaman ini kecuali
//      shared/auth-gate.js sudah lolos.
//   2. Visual "dark glass" bespoke (gradient mesh glow, film grain, blur
//      bezel, custom Clash Display/General Sans font) DIBUANG SELURUHNYA
//      per design.md ("Vercel-flat, not AI app flat" -- no shadows, no
//      blur, no gradients, no glass, satu accent color doang). Halaman ini
//      sekarang pakai pola yang SAMA seperti dashboard/stok: struktur
//      pw-topbar + komponen dari pnm-universal.css yang udah ada
//      (.page-head, .card, .field-label/.field-input, .btn-accent/
//      .btn-ghost/.btn-primary, .stat-pill) -- BUKAN token/warna baru.
//      Sisa CSS yang bener-bener spesifik halaman ini (list file yang bisa
//      dipilih, chip dengan tombol hapus, frame canvas preview, toast)
//      pindah ke style.css yang baru, dan SEMUANYA di-scope di bawah
//      `.eg-page` (belajar dari bug yang baru difix -- style.css lama
//      punya bare `:root`/`body`/`h1`/`select` yang bocor ke modul lain;
//      kali ini nggak ada satu pun bare selector, jadi remove()-di-
//      unmount() di index.js jadi lapis pertahanan kedua, bukan satu-
//      satunya).
//
// UPDATE (visual polish pass -- "too spread out / too many words / CTA
// overload" feedback): copy trimmed everywhere (card-head intro
// paragraphs removed, field labels shortened, button labels down to 1-2
// words), the "Terapkan kode" button demoted from a bordered .btn-ghost to
// a quiet inline text link (.eg-link-btn in style.css) since it was
// visually competing with the page's one real call-to-action (Preview),
// and the 3-box PNG/Alpha/Count .stat-pill grid under the result canvas
// collapsed into a single muted meta line (.eg-meta) -- three bordered
// boxes for three words of static info was the clearest over-decoration
// on this page. Content column also capped at 640px (.eg-col) instead of
// stretching full viewport width -- see the FULLBLEED comment on
// `.eg-page main` in style.css for why that doesn't undo the earlier
// edge-to-edge request.
//
// UPDATE (card-head consistency pass): this page's two cards were the only
// ones in the app with no .card-head/.icon-box header (a bare field-label
// straight at the top of card 1, a plain .eg-card-title text node in card
// 2) -- every other module (dashboard/stok/crud-produk) uses icon-box +
// h2 + short p for every card. Added that here too (blue icon-box for the
// input card, green for the result card, matching the accent/success
// color convention used elsewhere), removed the now-unused .eg-card-title
// rule from style.css. Kept subtitles to one short line / omitted where
// redundant with the .eg-meta line below, so this doesn't reverse the
// earlier "too many words" trim pass above.
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

      <!-- SELECTION -->
      <div class="card">
        <div class="card-head">
          <div class="icon-box blue"><i class="ti ti-stack-2"></i></div>
          <div class="card-head-text">
            <h2>Pilih Gambar</h2>
            <p>Tempel kode produk atau cari manual.</p>
          </div>
        </div>
        <label class="field-label" for="bulkInput">Kode produk <span class="eg-field-hint">satu per baris, maks 4</span></label>
        <textarea id="bulkInput" class="field-input eg-textarea" placeholder="MY001&#10;MY002&#10;MY003&#10;MY004" aria-label="Input kode file, satu per baris"></textarea>
        <button type="button" class="eg-link-btn" onclick="applyBulkInput()">
          <i class="ti ti-corner-down-left" aria-hidden="true"></i> Terapkan
        </button>

        <label class="field-label eg-mt-16" for="searchInput">Atau cari nama file</label>
        <input type="text" id="searchInput" class="field-input" placeholder="Ketik untuk mencari..." oninput="renderFileList()" aria-label="Cari nama file">

        <div id="fileList" class="eg-file-list eg-mt-16" role="listbox" aria-multiselectable="true" aria-label="Daftar file"></div>
        <div id="selectedChips" class="eg-chips"></div>

        <button id="previewBtn" class="btn btn-accent eg-mt-16" onclick="mergeAndPreview()" aria-label="Tampilkan preview hasil merge">
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
        <button id="exportBtn" class="btn btn-primary" onclick="exportCanvasAsPNG()" style="display:none;width:100%;justify-content:center;" aria-label="Export hasil sebagai file PNG">
          <i class="ti ti-download" aria-hidden="true"></i> Unduh PNG
        </button>
      </div>
    </div>
  </main>
</div>

<div id="toastRoot" class="eg-toast-root" aria-live="assertive"></div>
`;