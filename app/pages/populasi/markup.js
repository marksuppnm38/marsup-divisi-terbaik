// app/pages/populasi/markup.js
// Markup halaman "Populasi" -- SATU layar untuk SATU pertanyaan:
// "kategori/produk apa, di RS mana saja, di provinsi X", dengan hasil yang bisa diunduh
// sebagai Excel. Memakai komponen bersama pnm-universal.css (section-label, stats-grid/stat-card,
// table-section/table-header, filter-btn, filter-select, search-mini, bulk-btn, btn-clear-all)
// supaya tampilannya seragam dengan Dashboard dan modul lain; override khusus ada di style.css.
// Semua id berawalan ps- kecuali err-banner/err-text/toast-container (kelas generik
// dari pnm-universal.css, sama seperti dashboard).
//
// Yang dirender lewat JS (bukan di sini): chip kategori (#ps-cats), kartu ringkasan (#ps-stats),
// header tabel (#ps-thead, kolom Set/Unit muncul sesuai isi hasil), chip filter aktif (#ps-active).
// Ikon hanya dipakai untuk aksi (muat ulang, salin, unduh, buka baris, ubah, lepas filter);
// judul bagian dan kartu tidak berikon karena ikon itu tidak membawa informasi.

export const POPULASI_MARKUP = `
<div id="app-root">
<div class="pw-topbar">
  <div class="pw-topbar-crumb"><strong>Populasi</strong></div>
  <div class="pw-topbar-actions">
    <span class="last-update" id="ps-data-per">Memuat…</span>
    <button class="toggle-btn" type="button" data-action="ps-reload" title="Ambil ulang data dari database"><i class="ti ti-rotate-clockwise" aria-hidden="true"></i> Muat ulang</button>
  </div>
</div>

<main>
  <div class="err-banner" id="err-banner" role="alert"><i class="ti ti-alert-circle"></i> <span id="err-text"></span></div>

  <div class="ps-note" id="ps-stale" hidden role="status"></div>

  <div class="section-label">Filter</div>
  <section class="ps-panel" aria-label="Filter">
    <div class="ps-quick">
      <span class="ps-lbl">Pertanyaan cepat</span>
      <button type="button" class="filter-btn" data-action="ps-preset" data-p="set-jateng">Set instrumen di Jawa Tengah</button>
      <button type="button" class="filter-btn" data-action="ps-preset" data-p="drill">Drill, semua provinsi</button>
      <button type="button" class="filter-btn" data-action="ps-preset" data-p="lab">Alat laboratorium, semua provinsi</button>
      <button type="button" class="filter-btn" data-action="ps-preset" data-p="elektromedis">Elektromedis, semua provinsi</button>
    </div>

    <div class="ps-grid">
      <label class="ps-field">
        <span class="ps-lbl">Provinsi</span>
        <select class="filter-select" id="ps-provinsi"><option value="">Semua provinsi</option></select>
      </label>
      <label class="ps-field">
        <span class="ps-lbl">Nama produk mengandung</span>
        <input class="search-mini" type="search" id="ps-produk" placeholder="mis. drill, centrifuge, dental chair" autocomplete="off">
      </label>
      <label class="ps-field">
        <span class="ps-lbl">Rumah sakit</span>
        <input class="search-mini" type="search" id="ps-rs" placeholder="mis. soetrasno" autocomplete="off">
      </label>
      <div class="ps-field">
        <span class="ps-lbl">Status pesanan</span>
        <div class="ps-seg" role="group" aria-label="Status pesanan">
          <button type="button" class="filter-btn active" data-action="ps-status" data-v="DELIVERED">Terkirim</button>
          <button type="button" class="filter-btn" data-action="ps-status" data-v="ALL">+ Dalam proses</button>
        </div>
      </div>
    </div>

    <div class="ps-field">
      <span class="ps-lbl" id="ps-lbl-kat">Kategori (boleh pilih lebih dari satu)</span>
      <div class="ps-cats" id="ps-cats" role="group" aria-labelledby="ps-lbl-kat"></div>
    </div>

    <div class="ps-opts">
      <label class="ps-check" id="ps-isi-wrap" hidden>
        <input type="checkbox" id="ps-isi-set">
        <span>Termasuk isi set</span>
      </label>
      <details class="ps-more-filters">
        <summary>Periode dan cakupan data</summary>
        <div class="ps-grid ps-more-body">
          <label class="ps-field">
            <span class="ps-lbl">Dari tanggal</span>
            <input class="search-mini" type="date" id="ps-dari">
          </label>
          <label class="ps-field">
            <span class="ps-lbl">Sampai</span>
            <input class="search-mini" type="date" id="ps-sampai">
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
    </div>

    <div class="ps-active" id="ps-active" hidden></div>
  </section>

  <div class="section-label">Hasil</div>
  <div class="ps-scope" aria-live="polite">
    <div class="ps-sum-main" id="ps-sum-main">—</div>
    <div class="ps-sum-sub" id="ps-sum-sub"></div>
  </div>
  <div class="stats-grid ps-stats" id="ps-stats">
    <div class="stat-card" aria-hidden="true"><div class="skeleton" style="width:50%;height:25px"></div><div class="skeleton" style="width:40%;margin-top:8px"></div></div>
    <div class="stat-card" aria-hidden="true"><div class="skeleton" style="width:50%;height:25px"></div><div class="skeleton" style="width:40%;margin-top:8px"></div></div>
    <div class="stat-card" aria-hidden="true"><div class="skeleton" style="width:50%;height:25px"></div><div class="skeleton" style="width:40%;margin-top:8px"></div></div>
  </div>

  <div class="ps-hint" id="ps-hint" hidden role="status"></div>

  <div class="table-section" id="ps-table">
    <div class="table-header">
      <div class="table-title"><span id="ps-tbl-title">Rumah sakit</span></div>
      <div class="filter-bar">
        <button type="button" class="bulk-btn clear" data-action="ps-copy" title="Salin daftar sebagai teks untuk ditempel ke chat atau email"><i class="ti ti-copy" aria-hidden="true"></i> Salin teks</button>
        <button type="button" class="bulk-btn export ps-xlsx" data-action="ps-xlsx" title="Unduh Excel yang siap dikirim: ringkasan, daftar RS, dan rincian pesanan"><i class="ti ti-file-spreadsheet" aria-hidden="true"></i> <span>Unduh Excel</span></button>
      </div>
    </div>
    <div class="table-scroll">
      <table>
        <thead id="ps-thead"></thead>
        <tbody id="ps-body">
          <tr class="ps-skel-row" aria-hidden="true"><td><div class="skeleton" style="width:70%;height:13px"></div></td><td><div class="skeleton" style="width:55%"></div></td><td class="ps-num"><div class="skeleton" style="width:24px;margin-left:auto"></div></td><td><div class="skeleton" style="width:80%"></div></td><td><div class="skeleton" style="width:70px"></div></td><td></td></tr>
          <tr class="ps-skel-row" aria-hidden="true"><td><div class="skeleton" style="width:60%;height:13px"></div></td><td><div class="skeleton" style="width:45%"></div></td><td class="ps-num"><div class="skeleton" style="width:24px;margin-left:auto"></div></td><td><div class="skeleton" style="width:65%"></div></td><td><div class="skeleton" style="width:70px"></div></td><td></td></tr>
          <tr class="ps-skel-row" aria-hidden="true"><td><div class="skeleton" style="width:75%;height:13px"></div></td><td><div class="skeleton" style="width:50%"></div></td><td class="ps-num"><div class="skeleton" style="width:24px;margin-left:auto"></div></td><td><div class="skeleton" style="width:72%"></div></td><td><div class="skeleton" style="width:70px"></div></td><td></td></tr>
          <tr class="ps-skel-row" aria-hidden="true"><td><div class="skeleton" style="width:65%;height:13px"></div></td><td><div class="skeleton" style="width:60%"></div></td><td class="ps-num"><div class="skeleton" style="width:24px;margin-left:auto"></div></td><td><div class="skeleton" style="width:58%"></div></td><td><div class="skeleton" style="width:70px"></div></td><td></td></tr>
          <tr class="ps-skel-note"><td colspan="6"><span class="ps-sr" role="status">Memuat data…</span></td></tr>
        </tbody>
      </table>
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
    <h3 id="ps-wil-title">Wilayah RS</h3>
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