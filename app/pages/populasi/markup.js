// app/pages/populasi/markup.js
// Markup halaman "Populasi" -- SATU layar untuk SATU pertanyaan:
// "kategori/produk apa, di RS mana saja, di provinsi X", dengan hasil yang bisa diunduh
// sebagai Excel.
//
// TATA LETAK (urutan = urutan prioritas):
//   1. Topbar: judul + kesegaran data.
//   2. Bilah cari (#ps-cari) selebar halaman, dengan tiga cakupan: Produk, Rumah sakit, dan No. RMP
//      (masing-masing isinya disimpan terpisah; No. RMP mengganti tabel RS jadi daftar pesanan).
//   3. Dua kolom: kiri = rel filter (.ps-panel: provinsi, status, kategori, spesialisasi, opsi, periode),
//      kanan = hasil (.ps-results: filter aktif, judul hasil, ringkasan satu baris, tabel + paginasi (#ps-pager), RS tanpa wilayah,
//      Kelola produk di paling bawah). Rel filter tetap terlihat saat tabel di-scroll.
//   Di layar sempit (<= 1100px) kedua kolom menumpuk dan facet kembali jadi chip.
//
// Memakai komponen bersama pnm-universal.css (stats-grid/stat-card, table-section/table-header,
// filter-btn, filter-select, search-mini, bulk-btn, btn-clear-all); override khusus ada di style.css.
// Semua id berawalan ps- kecuali err-banner/err-text/toast-container (kelas generik
// dari pnm-universal.css, sama seperti dashboard).
//
// Yang dirender lewat JS (bukan di sini): facet kategori (#ps-cats), spesialisasi (#ps-spes) dan
// jenis instrumen (#ps-jenis), ringkasan (#ps-stats),
// catatan hitungan (#ps-caveats), header tabel (#ps-thead), isi paginasi (#ps-pager), chip filter aktif (#ps-active),
// bilah "Menampilkan N pesanan ..." (#ps-review-bar).
// Dialog Kelola produk punya tiga tab: Kategori produk, Atribut produk (spesialisasi, jenis, mikro), Alihkan set.
// Dialog Unduh Excel (#ps-xl-overlay): tujuan file (preset), sheet dan kolom (dirender JS di #ps-xl-presets / #ps-xl-sheets),
// serta keterangan opsional (untuk siapa, oleh siapa, catatan). Logikanya di index.js; pembangun file di export.js.
// Ikon hanya dipakai untuk aksi yang juga punya label teks, atau yang artinya baku (cari, tutup, urutkan).

export const POPULASI_MARKUP = `
<div id="app-root">
<div class="pw-topbar">
  <div class="pw-topbar-crumb"><strong>Populasi</strong></div>
  <div class="pw-topbar-actions">
    <span class="last-update" id="ps-data-per">Memuat…</span>
  </div>
</div>

<main>
  <div class="err-banner" id="err-banner" role="alert"><i class="ti ti-alert-circle"></i> <span id="err-text"></span></div>

  <section class="ps-command" aria-label="Pencarian">
    <span class="ps-sr" id="ps-lbl-cari">Cari</span>
    <div class="ps-seg" role="group" aria-labelledby="ps-lbl-cari">
      <button type="button" class="filter-btn ps-scope-btn active" data-action="ps-cari-scope" data-v="produk" aria-pressed="true">Produk</button>
      <button type="button" class="filter-btn ps-scope-btn" data-action="ps-cari-scope" data-v="rs" aria-pressed="false">Rumah sakit</button>
      <button type="button" class="filter-btn ps-scope-btn" data-action="ps-cari-scope" data-v="rmp" aria-pressed="false">No. RMP</button>
    </div>
    <div class="ps-searchfield">
      <i class="ti ti-search" aria-hidden="true"></i>
      <input class="search-mini" type="search" id="ps-cari" autocomplete="off" aria-label="Cari nama set atau produk">
    </div>
  </section>

  <div class="ps-layout">
    <aside class="ps-panel" aria-label="Filter">
      <label class="ps-field">
        <span class="ps-lbl">Provinsi</span>
        <select class="filter-select" id="ps-provinsi"><option value="">Semua provinsi</option></select>
      </label>

      <div class="ps-field">
        <span class="ps-lbl" id="ps-lbl-status">Status pesanan</span>
        <div class="ps-seg" role="group" aria-labelledby="ps-lbl-status">
          <button type="button" class="filter-btn active" data-action="ps-status" data-v="DELIVERED">Terkirim</button>
          <button type="button" class="filter-btn" data-action="ps-status" data-v="ALL">+ Dalam proses</button>
        </div>
      </div>

      <div class="ps-field">
        <span class="ps-lbl" id="ps-lbl-kat">Kategori <span class="ps-hint">pilih satu atau lebih</span></span>
        <div class="ps-cats" id="ps-cats" role="group" aria-labelledby="ps-lbl-kat"></div>
      </div>

      <div class="ps-field" id="ps-spes-wrap" hidden>
        <span class="ps-lbl" id="ps-lbl-spes">Spesialisasi <span class="ps-hint">untuk set dan instrumen satuan</span></span>
        <div class="ps-cats" id="ps-spes" role="group" aria-labelledby="ps-lbl-spes"></div>
      </div>

      <div class="ps-opts">
        <label class="ps-check" id="ps-isi-wrap" hidden title="Isi set dihitung per komponen (pcs), bukan per set">
          <input type="checkbox" id="ps-isi-set">
          <span>Termasuk isi set</span>
        </label>
        <label class="ps-check" id="ps-mikro-wrap" hidden title="Instrumen mikro dari semua spesialisasi: gunting Vannas, forceps mikro, dan sejenisnya">
          <input type="checkbox" id="ps-mikro">
          <span id="ps-mikro-t">Hanya mikrosurgery</span>
        </label>
        <details class="ps-more-filters" id="ps-jenis-det" hidden>
          <summary id="ps-jenis-sum">Jenis instrumen</summary>
          <div class="ps-cats ps-more-body" id="ps-jenis" role="group" aria-label="Jenis instrumen"></div>
        </details>
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
            <label class="ps-field ps-span">
              <span class="ps-lbl">Cakupan</span>
              <select class="filter-select" id="ps-cakupan">
                <option value="POPULASI">Populasi (INAPROC &amp; beli langsung)</option>
                <option value="SEMUA">Semua non-sample (termasuk retail)</option>
              </select>
            </label>
          </div>
        </details>
      </div>
    </aside>

    <div class="ps-results">
      <div class="ps-active" id="ps-active" hidden></div>

      <div class="ps-note" id="ps-stale" hidden role="status"></div>

      <div class="ps-scope" id="ps-scope" aria-live="polite">
        <div class="ps-sum-main" id="ps-sum-main">—</div>
        <div class="ps-caveats" id="ps-caveats" hidden></div>
        <div class="ps-loadbar" aria-hidden="true"></div>
      </div>
      <div class="stats-grid ps-stats" id="ps-stats">
        <div class="stat-card" aria-hidden="true"><div class="skeleton" style="width:50%;height:25px"></div><div class="skeleton" style="width:40%;margin-top:8px"></div></div>
        <div class="stat-card" aria-hidden="true"><div class="skeleton" style="width:50%;height:25px"></div><div class="skeleton" style="width:40%;margin-top:8px"></div></div>
        <div class="stat-card" aria-hidden="true"><div class="skeleton" style="width:50%;height:25px"></div><div class="skeleton" style="width:40%;margin-top:8px"></div></div>
      </div>

      <div class="ps-review-bar" id="ps-review-bar" hidden role="status" aria-live="polite"></div>

      <div class="table-section" id="ps-table">
        <div class="table-header">
          <div class="table-title"><span id="ps-tbl-title">Rumah sakit</span></div>
          <div class="filter-bar" id="ps-actions">
            <label class="ps-sortsel"><span class="ps-sr">Urutkan</span>
              <select class="filter-select" id="ps-urut" aria-label="Urutkan tabel">
                <option value="total">Terbanyak</option>
                <option value="terakhir">Pesanan terbaru</option>
                <option value="customer">Nama A–Z</option>
              </select>
            </label>
            <button type="button" class="bulk-btn clear" data-action="ps-copy" title="Salin daftar sebagai teks untuk ditempel ke chat atau email"><i class="ti ti-copy" aria-hidden="true"></i> Salin teks</button>
            <button type="button" class="bulk-btn export ps-xlsx" data-action="ps-xlsx" title="Pilih tujuan file (lampiran SPH, presentasi, atau internal), lalu unduh Excel dengan sheet dan kolom yang sesuai"><i class="ti ti-file-spreadsheet" aria-hidden="true"></i> <span>Unduh Excel</span></button>
          </div>
        </div>
        <div class="table-scroll">
          <table>
            <thead id="ps-thead"></thead>
            <tbody id="ps-body">
              <tr class="ps-skel-row" aria-hidden="true"><td><div class="skeleton" style="width:70%;height:13px"></div></td><td><div class="skeleton" style="width:55%"></div></td><td class="ps-num"><div class="skeleton" style="width:24px;margin-left:auto"></div></td><td><div class="skeleton" style="width:80%"></div></td><td><div class="skeleton" style="width:70px"></div></td><td></td></tr>
              <tr class="ps-skel-row" aria-hidden="true"><td><div class="skeleton" style="width:60%;height:13px"></div></td><td><div class="skeleton" style="width:45%"></div></td><td class="ps-num"><div class="skeleton" style="width:24px;margin-left:auto"></div></td><td><div class="skeleton" style="width:65%"></div></td><td><div class="skeleton" style="width:70px"></div></td><td></td></tr>
              <tr class="ps-skel-row" aria-hidden="true"><td><div class="skeleton" style="width:75%;height:13px"></div></td><td><div class="skeleton" style="width:50%"></div></td><td class="ps-num"><div class="skeleton" style="width:24px;margin-left:auto"></div></td><td><div class="skeleton" style="width:72%"></div></td><td><div class="skeleton" style="width:70px"></div></td><td></td></tr>
              <tr class="ps-skel-note"><td colspan="6"><span class="ps-sr" role="status">Memuat data…</span></td></tr>
            </tbody>
          </table>
        </div>
        <nav class="ps-pager" id="ps-pager" aria-label="Halaman tabel" hidden></nav>
      </div>

      <details class="insight-card ps-unmapped" id="ps-unmapped" hidden>
        <summary class="insight-card-title" id="ps-unm-title">—</summary>
        <div id="ps-unm-list"></div>
      </details>

      <div class="ps-foot">
        <button type="button" class="btn btn-ghost" data-action="ps-kel-open" title="Betulkan kategori dan atribut produk (spesialisasi, jenis, mikro), atau alihkan set custom ke populasi set lain. Data di Google Sheet tidak berubah."><i class="ti ti-adjustments-horizontal" aria-hidden="true"></i> Kelola produk: kategori, atribut, dan alihan set</button>
      </div>
    </div>
  </div>
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

<div class="confirm-overlay" id="ps-kel-overlay">
  <div class="confirm-card ps-kel-card" role="dialog" aria-modal="true" aria-labelledby="ps-kel-title">
    <div class="ps-kel-head">
      <div>
        <h3 id="ps-kel-title">Kelola produk</h3>
        <p class="ps-kel-lede" id="ps-kel-sub"></p>
      </div>
      <button type="button" class="ps-kel-x" data-action="ps-kel-close" aria-label="Tutup" title="Tutup"><i class="ti ti-x" aria-hidden="true"></i></button>
    </div>
    <div class="ps-kel-tabs" role="tablist">
      <button type="button" role="tab" class="ps-kel-tab" id="ps-kel-tab-kat" data-action="ps-kel-tab" data-tab="kat">Kategori produk</button>
      <button type="button" role="tab" class="ps-kel-tab" id="ps-kel-tab-atr" data-action="ps-kel-tab" data-tab="atr">Atribut produk</button>
      <button type="button" role="tab" class="ps-kel-tab" id="ps-kel-tab-set" data-action="ps-kel-tab" data-tab="set">Alihkan set</button>
    </div>
    <div class="ps-kel-bar">
      <input id="ps-kel-q" class="field-input ps-kel-search" type="search" autocomplete="off" aria-label="Cari">
      <select id="ps-kel-kelompok" class="field-input ps-kel-sel" aria-label="Kategori"></select>
      <select id="ps-kel-filter" class="field-input ps-kel-sel" aria-label="Tampilkan" hidden>
        <option value="cek">Perlu dicek dan dikoreksi</option>
        <option value="semua">Semua kode</option>
        <option value="koreksi">Hanya yang dikoreksi</option>
      </select>
      <label class="ps-kel-check"><input type="checkbox" id="ps-kel-hanya"><span id="ps-kel-hanya-t"></span></label>
      <span class="ps-kel-meta" id="ps-kel-meta" aria-live="polite"></span>
    </div>
    <div class="ps-kel-scroll" id="ps-kel-scroll">
      <table class="ps-kel-t">
        <thead id="ps-kel-thead"></thead>
        <tbody id="ps-kel-body"></tbody>
      </table>
    </div>
    <div class="ps-kel-foot">
      <span>Data di Google Sheet tidak berubah.</span>
      <button type="button" class="btn btn-ghost" data-action="ps-kel-unduh">Unduh daftar koreksi</button>
    </div>
  </div>
</div>

<div class="confirm-overlay" id="ps-xl-overlay">
  <div class="confirm-card ps-xl-card" role="dialog" aria-modal="true" aria-labelledby="ps-xl-title">
    <div class="ps-xl-head">
      <div>
        <h3 id="ps-xl-title">Unduh Excel</h3>
        <p class="ps-xl-lede" id="ps-xl-sub"></p>
      </div>
      <button type="button" class="ps-xl-x" data-action="ps-xl-close" aria-label="Tutup" title="Tutup"><i class="ti ti-x" aria-hidden="true"></i></button>
    </div>
    <div class="ps-xl-scroll">
      <fieldset class="ps-xl-sec">
        <legend class="ps-xl-h">File ini untuk apa?</legend>
        <div class="ps-xl-presets" id="ps-xl-presets"></div>
      </fieldset>
      <div class="ps-xl-sec">
        <div class="ps-xl-h">Isi file <span class="ps-hint">centang sheet yang diperlukan; kolom bisa dipilih per sheet</span></div>
        <div class="ps-xl-sheets" id="ps-xl-sheets"></div>
      </div>
      <div class="ps-xl-sec">
        <div class="ps-xl-h">Keterangan di file <span class="ps-hint">opsional, tampil di Ringkasan dan Catatan</span></div>
        <div class="ps-xl-grid">
          <label class="ps-field"><span class="ps-lbl">Disiapkan untuk</span><input class="field-input" id="ps-xl-untuk" maxlength="120" placeholder="mis. RSUD Contoh, SPH No. 123/2026" autocomplete="off"></label>
          <label class="ps-field"><span class="ps-lbl">Disiapkan oleh</span><input class="field-input" id="ps-xl-oleh" maxlength="80" placeholder="nama atau tim" autocomplete="off"></label>
          <label class="ps-field ps-span"><span class="ps-lbl">Catatan tambahan</span><textarea class="field-input" id="ps-xl-catatan" rows="2" maxlength="400" placeholder="mis. data populasi sebagai referensi penggunaan produk"></textarea></label>
        </div>
        <label class="ps-check ps-xl-cek" id="ps-xl-cek-wrap" hidden title="Pesanan set yang jumlah itemnya tidak sesuai isi set tidak masuk hitungan. Bila dicentang, barisnya juga tidak dicantumkan di Rincian Pesanan dan Per Produk; jumlahnya tetap dicatat di Catatan &amp; Kamus.">
          <input type="checkbox" id="ps-xl-tanpacek">
          <span>Jangan cantumkan pesanan set yang belum dihitung</span>
        </label>
      </div>
    </div>
    <div class="ps-xl-foot">
      <span class="ps-xl-warn" id="ps-xl-warn" role="status" hidden></span>
      <span class="ps-xl-grow"></span>
      <button type="button" class="btn btn-ghost" data-action="ps-xl-close">Batal</button>
      <button type="button" class="btn btn-accent" id="ps-xl-go" data-action="ps-xl-go"><i class="ti ti-file-spreadsheet" aria-hidden="true"></i> <span>Unduh Excel</span></button>
    </div>
  </div>
</div>
`;