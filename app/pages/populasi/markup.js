// app/pages/populasi/markup.js
// Markup halaman "Populasi Set per RS" -- SATU layar untuk SATU pertanyaan:
// "set instrumen apa, di RS mana saja, di provinsi X". Tidak ada kartu statistik,
// grafik, atau panel audit di jalur utama (itu yang bikin Dashboard Produk berat).
// Semua id berawalan ps- kecuali err-banner/err-text/toast-container (kelas generik
// dari pnm-universal.css, sama seperti dashboard).

export const POPULASI_MARKUP = `
<div id="app-root">
<div class="pw-topbar">
  <div class="pw-topbar-crumb"><strong>Populasi</strong></div>
  <div class="pw-topbar-actions">
    <span class="last-update"><i class="ti ti-database"></i> <span id="ps-data-per">Memuat…</span></span>
    <button class="toggle-btn" type="button" data-action="ps-reload"><i class="ti ti-rotate-clockwise"></i> Muat ulang</button>
  </div>
</div>

<main>
  <div class="err-banner" id="err-banner" role="alert"><i class="ti ti-alert-circle"></i> <span id="err-text"></span></div>

  <div class="ps-note" id="ps-stale" hidden role="status"></div>

  <section class="ps-filters" aria-label="Filter">
    <label class="ps-field">
      <span class="ps-lbl">Provinsi</span>
      <select class="filter-select" id="ps-provinsi"><option value="">Semua provinsi</option></select>
    </label>
    <div class="ps-field">
      <span class="ps-lbl">Tipe</span>
      <div class="ps-seg" role="group" aria-label="Tipe produk">
        <button type="button" class="filter-btn active" data-action="ps-tipe" data-v="SET">Set</button>
        <button type="button" class="filter-btn" data-action="ps-tipe" data-v="INSTRUMENT">Instrumen</button>
        <button type="button" class="filter-btn" data-action="ps-tipe" data-v="UNIT">Unit</button>
      </div>
    </div>
    <div class="ps-field">
      <span class="ps-lbl">Status</span>
      <div class="ps-seg" role="group" aria-label="Status pesanan">
        <button type="button" class="filter-btn active" data-action="ps-status" data-v="DELIVERED">Terkirim</button>
        <button type="button" class="filter-btn" data-action="ps-status" data-v="ALL">+ Dalam proses</button>
      </div>
    </div>
    <label class="ps-field">
      <span class="ps-lbl">Dari tanggal</span>
      <input class="ps-input" type="date" id="ps-dari">
    </label>
    <label class="ps-field">
      <span class="ps-lbl">Sampai</span>
      <input class="ps-input" type="date" id="ps-sampai">
    </label>
    <label class="ps-field">
      <span class="ps-lbl">Cakupan</span>
      <select class="filter-select" id="ps-cakupan">
        <option value="POPULASI">Populasi (INAPROC &amp; beli langsung)</option>
        <option value="SEMUA">Semua non-sample (termasuk retail)</option>
      </select>
    </label>
    <label class="ps-field ps-field-grow">
      <span class="ps-lbl" id="ps-lbl-cari">Cari RS / jenis set</span>
      <input class="ps-input" type="search" id="ps-search" placeholder="mis. soetrasno, partus…" autocomplete="off">
    </label>
  </section>

  <section class="ps-summary" aria-live="polite">
    <div>
      <div class="ps-sum-main" id="ps-sum-main">—</div>
      <div class="ps-sum-sub" id="ps-sum-sub"></div>
    </div>
    <div class="ps-sum-actions">
      <button type="button" class="bulk-btn export" data-action="ps-copy"><i class="ti ti-copy"></i> Salin teks</button>
      <button type="button" class="bulk-btn export" data-action="ps-csv"><i class="ti ti-file-type-csv"></i> Unduh CSV</button>
    </div>
  </section>

  <div class="table-section" id="ps-table">
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Rumah sakit</th>
            <th>Wilayah</th>
            <th style="text-align:right" id="ps-th-jml">Set</th>
            <th id="ps-th-jenis">Jenis set</th>
            <th>Terakhir</th>
            <th class="ps-col-act"><span class="ps-sr">Aksi</span></th>
          </tr>
        </thead>
        <tbody id="ps-body">
          <tr class="loading-row"><td colspan="6"><i class="ti ti-loader-2 spinner"></i> Memuat data…</td></tr>
        </tbody>
      </table>
    </div>
    <div class="table-footer">
      <span id="ps-foot">Jumlah set = <b>estimasi</b> dari QTY baris isi set (FPB). Pesanan dengan kurang dari 3 baris dianggap item lepas dan tidak dihitung.</span>
    </div>
  </div>

  <details class="insight-card ps-unmapped" id="ps-unmapped" hidden>
    <summary class="insight-card-title" id="ps-unm-title">—</summary>
    <div id="ps-unm-list"></div>
  </details>
</main>
</div>

<div class="toast-container" id="toast-container" aria-live="polite"></div>

<div class="confirm-overlay" id="ps-wil-overlay">
  <div class="confirm-card" role="dialog" aria-modal="true" aria-labelledby="ps-wil-title">
    <h3 id="ps-wil-title"><i class="ti ti-map-pin"></i> Wilayah RS</h3>
    <p id="ps-wil-rs" class="ps-wil-rs">—</p>
    <label class="ps-lbl" for="ps-wil-prov">Provinsi</label>
    <select id="ps-wil-prov" class="field-input"></select>
    <label class="ps-lbl" for="ps-wil-kab" style="margin-top:12px;display:block">Kab/Kota (opsional)</label>
    <input id="ps-wil-kab" class="field-input" maxlength="80" placeholder="mis. Kab. Klaten">
    <div id="ps-wil-err" class="ps-wil-err" role="alert"></div>
    <div class="confirm-actions" style="margin-top:16px">
      <button class="btn btn-ghost" id="ps-wil-cancel" type="button">Batal</button>
      <button class="btn btn-accent" id="ps-wil-ok" type="button">Simpan</button>
    </div>
  </div>
</div>
`;