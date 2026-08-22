// Static markup for the kompres-pdf page, extracted from the old kompres-pdf.html.
// Kept as a plain template string (zero-build: no bundler to import .html as text).
export const KOMPRES_PDF_MARKUP = `

  <header class="page-head">
    <div class="eyebrow"><span class="dot"></span>Alat lokal &middot; tanpa unggah server</div>
    <h1>Perkakas PDF</h1>
    <p class="sub">Kompres, pisah, dan gabungkan file PDF langsung di browser Anda &mdash; tidak pernah diunggah ke server mana pun.</p>
  </header>

  <div class="tabbar" id="tabbar">
    <button class="tab active" data-tab="compress">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3l4 4-4 4M16 21l-4-4 4-4M4 7h9M20 17h-9" stroke-linecap="round" stroke-linejoin="round"/></svg>
      Kompres
    </button>
    <button class="tab" data-tab="split">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H6a2 2 0 00-2 2v14a2 2 0 002 2h2M16 3h2a2 2 0 012 2v14a2 2 0 01-2 2h-2M12 3v18" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="2 2"/></svg>
      Pisah
    </button>
    <button class="tab" data-tab="merge">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4" stroke-linecap="round" stroke-linejoin="round"/></svg>
      Gabung
    </button>
  </div>

  <!-- ================= COMPRESS PANEL ================= -->
  <div class="panel active" id="panel-compress">

  <!-- UPLOAD CARD -->
  <div class="card" id="uploadCard">

    <div class="dropzone" id="dropzone">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#6c685f" stroke-width="1.5">
        <path d="M12 3v12m0 0l-4-4m4 4l4-4" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M4 15v3a2 2 0 002 2h12a2 2 0 002-2v-3" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <div class="dz-title">Tarik &amp; letakkan file PDF di sini</div>
      <div class="dz-sub">atau klik untuk memilih &mdash; boleh pilih lebih dari satu file sekaligus</div>
      <input type="file" id="fileInput" accept="application/pdf,.pdf" multiple>
    </div>

    <div id="listBlock" class="hidden">
      <div class="list-head" style="margin-top:18px;">
        <span class="count" id="listCount">0 file</span>
        <button class="add-more" id="addMoreBtn">+ Tambah file</button>
      </div>
      <div class="file-list" id="fileList"></div>
    </div>

    <div id="optionsBlock" class="hidden">
      <div class="field">
        <div class="field-label">Mode kompresi <span class="field-hint" id="modeHint"></span></div>
        <div class="segmented" id="modeSeg">
          <button data-mode="whole" class="active">Seluruh Dokumen</button>
          <button data-mode="images">Hanya Gambar</button>
        </div>
        <div class="mode-desc" id="modeDesc"></div>
      </div>

      <div class="field">
        <div class="field-label">Tingkat kompresi <span class="field-hint" id="levelHint">Sedang</span></div>
        <div class="segmented level4" id="levelSeg">
          <button data-level="ringan">Ringan</button>
          <button data-level="sedang" class="active">Sedang</button>
          <button data-level="kuat">Kuat</button>
          <button data-level="ekstrem">Ekstrem</button>
        </div>
        <div class="gauge" id="gauge">
          <span></span><span></span><span></span><span></span>
        </div>
      </div>

      <div class="field">
        <div class="field-label">Target ukuran maksimal <span class="field-hint">Opsional</span></div>
        <div class="target-row">
          <input type="number" id="targetInput" min="0.1" step="0.1" placeholder="misal 1">
          <span class="target-unit">MB</span>
        </div>
        <div class="chip-row" id="targetChips">
          <button type="button" class="chip" data-val="0.5">0.5 MB</button>
          <button type="button" class="chip" data-val="1">1 MB</button>
          <button type="button" class="chip" data-val="2">2 MB</button>
          <button type="button" class="chip" data-val="5">5 MB</button>
          <button type="button" class="chip" data-val="">Tanpa target</button>
        </div>
        <div class="mode-desc">Jika diisi, tool akan otomatis mencoba tingkat kompresi yang lebih agresif secara bertahap sampai ukuran berada di bawah target — tanpa pernah membuat hasil lebih besar dari file asli. Jika target tidak mungkin tercapai (misalnya dokumen berisi banyak teks/vektor), Anda akan diberi tahu hasil terbaik yang bisa dicapai.</div>
      </div>

      <button class="btn" id="compressBtn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M8 3l4 4-4 4M16 21l-4-4 4-4M4 7h9M20 17h-9" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span id="compressBtnLabel">Kompres PDF</span>
      </button>
    </div>

    <div class="progress-wrap hidden" id="progressBlock">
      <div class="progress-track"><div class="progress-fill" id="progressFill"></div></div>
      <div class="progress-label">
        <span id="progressText">Memproses…</span>
        <span id="progressPct">0%</span>
      </div>
    </div>

    <div class="error-box hidden" id="errorBox">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01" stroke-linecap="round"/></svg>
      <span id="errorText"></span>
    </div>
  </div>

  <!-- RESULT CARD -->
  <div class="card hidden" id="resultCard">
    <div class="result-head">
      <div class="result-badge">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
      <div>
        <div class="result-title" id="resultTitle">Kompresi selesai</div>
        <div class="result-sub" id="resultSub">-</div>
      </div>
    </div>

    <div class="size-compare">
      <div class="size-box">
        <div class="size-value" id="origSize">-</div>
        <div class="size-tag">Sebelum</div>
      </div>
      <div class="size-arrow">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14m0 0l-6-6m6 6l-6 6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
      <div class="size-box">
        <div class="size-value after" id="newSize">-</div>
        <div class="size-tag">Sesudah</div>
      </div>
    </div>

    <div class="bar-compare">
      <div class="bar-row">
        <span class="lbl">Sebelum</span>
        <div class="bar-track"><div class="bar-fill before"></div></div>
      </div>
      <div class="bar-row">
        <span class="lbl">Sesudah</span>
        <div class="bar-track"><div class="bar-fill after" id="afterBar"></div></div>
      </div>
    </div>

    <div class="reduction-pill" id="reductionPill">-</div>

    <div id="resultFileListBlock" class="hidden">
      <div class="result-file-head">Rincian per file</div>
      <div class="file-list" id="resultFileList"></div>
    </div>

    <div class="btn-row" id="resultBtnRow">
      <button class="btn" id="downloadBtn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 21h16" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span id="downloadBtnLabel">Unduh PDF Hasil Kompresi</span>
      </button>
    </div>
    <button class="btn ghost" id="resetBtn">Kompres File Lain</button>

    <div class="note" id="resultNote"></div>
  </div>

  </div>
  <!-- ================= END COMPRESS PANEL ================= -->

  <!-- ================= SPLIT PANEL ================= -->
  <div class="panel" id="panel-split">

    <div class="card" id="splitUploadCard">
      <div class="dropzone" id="splitDropzone">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#6c685f" stroke-width="1.5">
          <path d="M12 3v12m0 0l-4-4m4 4l4-4" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M4 15v3a2 2 0 002 2h12a2 2 0 002-2v-3" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <div class="dz-title">Tarik &amp; letakkan satu file PDF di sini</div>
        <div class="dz-sub">atau klik untuk memilih file yang ingin dipisah</div>
        <input type="file" id="splitFileInput" accept="application/pdf,.pdf">
      </div>

      <div class="file-row hidden" id="splitFileRow">
        <div class="file-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6" stroke-linejoin="round"/></svg>
        </div>
        <div class="file-meta">
          <div class="file-name" id="splitFileName">-</div>
          <div class="file-size" id="splitFileMeta">-</div>
        </div>
        <button class="file-remove" id="splitFileRemove">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4v5h5M20 20v-5h-5M4 9a8 8 0 0113.66-4.66M20 15a8 8 0 01-13.66 4.66" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Ganti
        </button>
      </div>

      <div id="splitOptionsBlock" class="hidden">
        <div class="field">
          <div class="field-label">Cara membagi</div>
          <div class="segmented" id="splitModeSeg">
            <button data-mode="each" class="active">Tiap Halaman</button>
            <button data-mode="range">Rentang Kustom</button>
          </div>
          <div class="mode-desc" id="splitModeDesc">Setiap halaman akan menjadi file PDF terpisah.</div>
        </div>

        <div class="field hidden" id="splitRangeField">
          <div class="field-label">Rentang halaman</div>
          <input type="text" id="splitRangeInput" placeholder="misal: 1-3, 4, 7-10">
          <div class="mode-desc">Pisahkan tiap rentang dengan koma. Contoh "1-3, 4, 7-10" akan menghasilkan 3 file: halaman 1&ndash;3, halaman 4, dan halaman 7&ndash;10.</div>
        </div>

        <button class="btn" id="splitBtn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v18M5 8l-2 4 2 4M19 8l2 4-2 4" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Pisahkan PDF
        </button>
      </div>

      <div class="progress-wrap hidden" id="splitProgressBlock">
        <div class="progress-track"><div class="progress-fill" id="splitProgressFill"></div></div>
        <div class="progress-label"><span id="splitProgressText">Memproses…</span><span id="splitProgressPct">0%</span></div>
      </div>

      <div class="error-box hidden" id="splitErrorBox">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01" stroke-linecap="round"/></svg>
        <span id="splitErrorText"></span>
      </div>
    </div>

    <div class="card hidden" id="splitResultCard">
      <div class="result-head">
        <div class="result-badge"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
        <div>
          <div class="result-title">PDF berhasil dipisah</div>
          <div class="result-sub" id="splitResultSub">-</div>
        </div>
      </div>

      <div class="file-list" id="splitResultList"></div>

      <div class="btn-row">
        <button class="btn" id="splitDownloadAllBtn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 21h16" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span id="splitDownloadAllLabel">Unduh Semua (ZIP)</span>
        </button>
      </div>
      <button class="btn ghost" id="splitResetBtn">Pisahkan File Lain</button>
    </div>

  </div>
  <!-- ================= END SPLIT PANEL ================= -->

  <!-- ================= MERGE PANEL ================= -->
  <div class="panel" id="panel-merge">

    <div class="card" id="mergeUploadCard">
      <div class="dropzone" id="mergeDropzone">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#6c685f" stroke-width="1.5">
          <path d="M12 3v12m0 0l-4-4m4 4l4-4" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M4 15v3a2 2 0 002 2h12a2 2 0 002-2v-3" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <div class="dz-title">Tarik &amp; letakkan beberapa file PDF di sini</div>
        <div class="dz-sub">atau klik untuk memilih &mdash; urutan bisa diatur sebelum digabung</div>
        <input type="file" id="mergeFileInput" accept="application/pdf,.pdf" multiple>
      </div>

      <div id="mergeListBlock" class="hidden">
        <div class="list-head" style="margin-top:18px;">
          <span class="count" id="mergeListCount">0 file</span>
          <button class="add-more" id="mergeAddMoreBtn">+ Tambah file</button>
        </div>
        <div class="file-list" id="mergeFileList"></div>
        <div class="mode-desc" style="margin-top:10px;">Urutan file di atas menentukan urutan halaman pada PDF hasil gabungan. Gunakan panah untuk mengatur urutan.</div>

        <button class="btn" id="mergeBtn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span id="mergeBtnLabel">Gabungkan PDF</span>
        </button>
      </div>

      <div class="progress-wrap hidden" id="mergeProgressBlock">
        <div class="progress-track"><div class="progress-fill" id="mergeProgressFill"></div></div>
        <div class="progress-label"><span id="mergeProgressText">Memproses…</span><span id="mergeProgressPct">0%</span></div>
      </div>

      <div class="error-box hidden" id="mergeErrorBox">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01" stroke-linecap="round"/></svg>
        <span id="mergeErrorText"></span>
      </div>
    </div>

    <div class="card hidden" id="mergeResultCard">
      <div class="result-head">
        <div class="result-badge"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
        <div>
          <div class="result-title">PDF berhasil digabung</div>
          <div class="result-sub" id="mergeResultSub">-</div>
        </div>
      </div>
      <button class="btn" id="mergeDownloadBtn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 21h16" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Unduh PDF Gabungan
      </button>
      <button class="btn ghost" id="mergeResetBtn">Gabungkan File Lain</button>
    </div>

  </div>
  <!-- ================= END MERGE PANEL ================= -->

  <div class="privacy">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 018 0v3"/></svg>
    File Anda diproses sepenuhnya di perangkat ini dan tidak pernah diunggah.
  </div>

`;
