// Kerangka statis halaman Rekon Meeting. Isi dinamisnya (status, ringkasan, daftar)
// digambar index.js ke #rkStatus / #rkBody.
export const RK_MARKUP = `
<div class="pw-topbar">
  <div class="pw-topbar-crumb"><strong>Rekon Meeting</strong></div>
  <div class="pw-topbar-actions">
    <button class="rk-btn rk-btn-primary" id="rkExport" type="button" disabled>
      <i class="ti ti-download"></i><span>Unduh laporan.xlsx</span>
    </button>
  </div>
</div>

<div class="rk-main">
  <div class="rk-wrap">

    <div class="rk-head">
      <h1>Rekon Meeting</h1>
      <p>Bandingkan <b>kata meeting</b> (recap Excel) dengan <b>kata data</b> (sesi, record, dan SPH di sistem).
         Alat bantu mandiri: file dibaca di browser, data sistem hanya dibaca, dan tidak ada yang disimpan ke database.</p>
    </div>

    <section class="rk-drop" id="rkDrop" aria-label="Unggah recap meeting">
      <input type="file" id="rkFile" accept=".xlsx,.xlsm,.xls" hidden>
      <i class="ti ti-file-spreadsheet rk-drop-ico"></i>
      <div class="rk-drop-txt">
        <strong>Taruh recap meeting (.xlsx) di sini</strong>
        <span>atau <button type="button" class="rk-link" data-act="pick">pilih file</button>.
              Sheet <em>Semua Hot Prospek (Master)</em> dibaca otomatis.</span>
      </div>
    </section>

    <div id="rkStatus" class="rk-status" hidden></div>

    <div id="rkBody" hidden>
      <div id="rkTools" class="rk-tools"></div>
      <div id="rkSummary" class="rk-summary"></div>
      <div id="rkTabs" class="rk-tabs" role="tablist"></div>
      <div id="rkPane"></div>
    </div>

  </div>
</div>
`;
