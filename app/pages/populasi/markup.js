// app/pages/populasi/markup.js
// Markup halaman "Populasi" -- SATU layar untuk SATU pertanyaan:
// "kategori/produk apa, di RS mana saja, di provinsi X", dengan hasil yang bisa diunduh
// sebagai Excel. Tidak ada kartu statistik, grafik, atau panel audit di jalur utama.
// Semua id berawalan ps- kecuali err-banner/err-text/toast-container (kelas generik
// dari pnm-universal.css, sama seperti dashboard).
//
// Yang dirender lewat JS (bukan di sini): chip kategori (#ps-cats), header tabel (#ps-thead,
// kolom Set/Qty muncul sesuai isi hasil), chip filter aktif (#ps-active).

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

  <section class="ps-quick" aria-label="Pertanyaan cepat">
    <span class="ps-lbl">Pertanyaan cepat</span>
    <button type="button" class="ps-q" data-action="ps-preset" data-p="set-jateng">Set instrumen di Jawa Tengah</button>
    <button type="button" class="ps-q" data-action="ps-preset" data-p="drill">Drill, semua provinsi</button>
    <button type="button" class="ps-q" data-action="ps-preset" data-p="lab">Alat laboratorium, semua provinsi</button>
    <button type="button" class="ps-q" data-action="ps-preset" data-p="elektromedis">Elektromedis, semua provinsi</button>
  </section>

  <section class="ps-panel" aria-label="Filter">
    <div class="ps-row-main">
      <label class="ps-field">
        <span class="ps-lbl">Provinsi</span>
        <select class="filter-select" id="ps-provinsi"><option value="">Semua provinsi</option></select>
      </label>
      <div class="ps-field ps-field-grow">
        <span class="ps-lbl" id="ps-lbl-kat">Kategori (boleh pilih lebih dari satu)</span>
        <div class="ps-cats" id="ps-cats" role="group" aria-labelledby="ps-lbl-kat"></div>
      </div>
    </div>

    <div class="ps-row-sub">
      <label class="ps-field ps-field-grow">
        <span class="ps-lbl">Nama produk mengandung</span>
        <input class="ps-input" type="search" id="ps-produk" placeholder="mis. drill, centrifuge, dental chair" autocomplete="off">
      </label>
      <label class="ps-field ps-field-grow">
        <span class="ps-lbl">Rumah sakit</span>
        <input class="ps-input" type="search" id="ps-rs" placeholder="mis. soetrasno" autocomplete="off">
      </label>
      <div class="ps-field">
        <span class="ps-lbl">Status pesanan</span>
        <div class="ps-seg" role="group" aria-label="Status pesanan">
          <button type="button" class="filter-btn active" data-action="ps-status" data-v="DELIVERED">Terkirim</button>
          <button type="button" class="filter-btn" data-action="ps-status" data-v="ALL">+ Dalam proses</button>
        </div>
      </div>
      <label class="ps-check" id="ps-isi-wrap" hidden>
        <input type="checkbox" id="ps-isi-set">
        <span>Termasuk isi set</span>
      </label>
    </div>

    <details class="ps-more-filters">
      <summary>Periode dan cakupan data</summary>
      <div class="ps-row-sub ps-more-body">
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
      </div>
    </details>

    <div class="ps-active" id="ps-active" hidden></div>
  </section>

  <section class="ps-summary" aria-live="polite">
    <div class="ps-sum-text">
      <div class="ps-sum-main" id="ps-sum-main">—</div>
      <div class="ps-sum-sub" id="ps-sum-sub"></div>
    </div>
    <div class="ps-sum-actions">
      <button type="button" class="bulk-btn export" data-action="ps-copy"><i class="ti ti-copy"></i> Salin teks</button>
      <button type="button" class="bulk-btn export ps-xlsx" data-action="ps-xlsx"><i class="ti ti-file-spreadsheet"></i> Unduh Excel</button>
    </div>
  </section>

  <div class="ps-hint" id="ps-hint" hidden role="status"></div>

  <div class="table-section" id="ps-table">
    <div class="table-scroll">
      <table>
        <thead id="ps-thead"></thead>
        <tbody id="ps-body">
          <tr class="loading-row"><td colspan="5"><i class="ti ti-loader-2 spinner"></i> Memuat data…</td></tr>
        </tbody>
      </table>
    </div>
    <div class="table-footer">
      <span>Set = <b>estimasi</b> dari QTY baris isi set (FPB); pesanan dengan kurang dari 3 baris dianggap item lepas dan tidak dihitung. Unit/pcs = total QTY baris barang. Klik baris untuk melihat PO-nya.</span>
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