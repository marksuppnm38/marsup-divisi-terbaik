// Markup dashboard. Susunan halaman:
//   1. Perlu dikerjakan (daftar kerja, elemen utama) + Konversi hari ini
//   2. Tujuh hari terakhir + Leaderboard sales
//   3. Stok berisiko habis
//   4. Populasi set + Kategori konversi
//   5. Kebutuhan customer ke SKU
//   6. Laporan dan unduhan
// Tidak ada tombol "Muat ulang": data disegarkan otomatis (lihat index.js). Status bagian yang
// sedang dimuat berupa teks biasa, bukan skeleton/loading bar. Semua isi dinamis diisi index.js
// ke elemen ber-id db-* dan #wl-count.

const BUSY = '<div class="db-busy">Memuat…</div>';

export const DASHBOARD_MARKUP = `
<div id="app-root">
<div class="pw-topbar">
  <div class="pw-topbar-crumb"><strong>Dashboard Produk</strong></div>
  <div class="pw-topbar-actions"><span class="db-fresh" id="db-fresh" aria-live="polite"></span></div>
</div>

<main>
  <div class="db-head">
    <h1 class="db-title">Ringkasan</h1>
    <span class="db-date" id="db-date"></span>
  </div>

  <section class="db-row">
    <div class="db-c7">
      <div class="db-sec-head">
        <h2 class="db-sec-title">Perlu dikerjakan</h2>
        <span class="db-sec-sub" id="wl-count"></span>
      </div>
      <div class="wl" id="db-worklist">${BUSY}</div>
    </div>
    <div class="db-c5">
      <div class="db-sec-head">
        <h2 class="db-sec-title">Konversi hari ini</h2>
        <div class="db-sec-tools"><a class="db-link" href="/konversian/riwayat" data-nav="/konversian/riwayat">Buka riwayat</a></div>
      </div>
      <div id="db-today">${BUSY}</div>
    </div>
  </section>

  <section class="db-row">
    <div class="db-c7">
      <div class="db-sec-head">
        <h2 class="db-sec-title">Tujuh hari terakhir</h2>
        <div class="db-sec-tools">
          <div class="seg" role="group" aria-label="Ukuran grafik">
            <button type="button" data-action="trend-metric" data-m="jumlah" aria-pressed="true">Jumlah</button>
            <button type="button" data-action="trend-metric" data-m="nilai" aria-pressed="false">Nilai</button>
          </div>
        </div>
      </div>
      <div id="db-trend">${BUSY}</div>
    </div>
    <div class="db-c5">
      <div class="db-sec-head">
        <h2 class="db-sec-title">Leaderboard sales</h2>
        <div class="db-sec-tools">
          <div class="seg" role="group" aria-label="Periode leaderboard">
            <button type="button" data-action="lb-period" data-days="7" aria-pressed="false">7 hari</button>
            <button type="button" data-action="lb-period" data-days="30" aria-pressed="true">30 hari</button>
            <button type="button" data-action="lb-period" data-days="90" aria-pressed="false">90 hari</button>
            <button type="button" data-action="lb-period" data-days="365" aria-pressed="false">1 tahun</button>
          </div>
        </div>
      </div>
      <div id="db-leaderboard">${BUSY}</div>
    </div>
  </section>

  <section class="db-row">
    <div class="db-c12">
      <div class="db-sec-head">
        <h2 class="db-sec-title">Stok berisiko habis</h2>
        <span class="db-sec-sub">Dihitung dari laju konversi</span>
        <div class="db-sec-tools">
          <div class="seg" role="group" aria-label="Periode analisis stok">
            <button type="button" data-action="forecast-period" data-days="7" aria-pressed="false">7 hari</button>
            <button type="button" data-action="forecast-period" data-days="30" aria-pressed="true">30 hari</button>
            <button type="button" data-action="forecast-period" data-days="90" aria-pressed="false">90 hari</button>
          </div>
          <a class="db-link" href="/stok" data-nav="/stok">Buka stok</a>
        </div>
      </div>
      <div id="db-stok">${BUSY}</div>
    </div>
  </section>

  <section class="db-row">
    <div class="db-c7">
      <div class="db-sec-head">
        <h2 class="db-sec-title">Populasi set terkirim</h2>
        <div class="db-sec-tools"><a class="db-link" href="/populasi" data-nav="/populasi">Buka populasi</a></div>
      </div>
      <div id="db-populasi">${BUSY}</div>
    </div>
    <div class="db-c5">
      <div class="db-sec-head">
        <h2 class="db-sec-title">Kategori konversi</h2>
        <span class="db-sec-sub">30 hari terakhir</span>
      </div>
      <div id="db-kategori">${BUSY}</div>
    </div>
  </section>

  <section class="db-row">
    <div class="db-c12">
      <div class="db-sec-head">
        <h2 class="db-sec-title">Distributor terbaik</h2>
        <span class="db-sec-sub">Pesanan terkirim, 10 teratas</span>
        <div class="db-sec-tools">
          <div class="seg" role="group" aria-label="Urutkan distributor menurut">
            <button type="button" data-action="dist-metric" data-m="volume" aria-pressed="true">Volume</button>
            <button type="button" data-action="dist-metric" data-m="rs" aria-pressed="false">Jumlah RS</button>
            <button type="button" data-action="dist-metric" data-m="po" aria-pressed="false">Jumlah PO</button>
          </div>
          <div class="seg" role="group" aria-label="Periode distributor">
            <button type="button" data-action="dist-period" data-days="90" aria-pressed="false">90 hari</button>
            <button type="button" data-action="dist-period" data-days="365" aria-pressed="true">1 tahun</button>
            <button type="button" data-action="dist-period" data-days="0" aria-pressed="false">Semua</button>
          </div>
          <a class="db-link" href="/populasi" data-nav="/populasi">Buka populasi</a>
        </div>
      </div>
      <div id="db-distributor">${BUSY}</div>
    </div>
  </section>

  <section class="db-row">
    <div class="db-c12">
      <div class="db-sec-head">
        <h2 class="db-sec-title">Kebutuhan customer ke SKU</h2>
        <span class="db-sec-sub">Istilah yang dipakai customer dan SKU yang akhirnya dipakai untuk memenuhinya</span>
        <div class="db-sec-tools"><a class="db-link" href="/konversian/dictionary" data-nav="/konversian/dictionary">Buka dictionary</a></div>
      </div>
      <div id="db-kebutuhan">${BUSY}</div>
    </div>
  </section>

  <section class="db-row">
    <div class="db-c12">
      <div class="db-sec-head"><h2 class="db-sec-title">Laporan dan unduhan</h2></div>
      <div class="out">
        <div class="out-item">
          <h3 class="out-title">Pricelist sales</h3>
          <p class="out-desc">Produk yang sudah punya Link V6 dan harga e-Katalog, siap dikirim ke sales.</p>
          <div class="out-actions">
            <select class="db-select" id="pricelist-tipe" aria-label="Tipe produk pricelist">
              <option value="">Semua tipe</option>
              <option value="INSTRUMENT">Instrumen</option>
              <option value="SET">Set</option>
              <option value="UNIT">Unit</option>
            </select>
            <button type="button" class="db-btn db-btn--primary" data-action="pricelist-unduh"><i class="ti ti-file-spreadsheet" aria-hidden="true"></i> Unduh Excel</button>
          </div>
        </div>
        <div class="out-item">
          <h3 class="out-title">Populasi per rumah sakit</h3>
          <p class="out-desc">Excel untuk lampiran SPH, presentasi, atau internal. Filter wilayah dan periode diatur di halaman Populasi.</p>
          <div class="out-actions"><a class="db-btn" href="/populasi" data-nav="/populasi">Buka Populasi</a></div>
        </div>
        <div class="out-item">
          <h3 class="out-title">Export produk lengkap</h3>
          <p class="out-desc">Semua kolom beserta stok, AKD, dan status INAPROC. Mengikuti filter yang diatur di CRUD Produk.</p>
          <div class="out-actions"><a class="db-btn" href="/crud-produk/produk" data-nav="/crud-produk/produk">Buka CRUD Produk</a></div>
        </div>
      </div>
    </div>
  </section>
</main>
</div>

<div class="toast-container" id="toast-container" aria-live="polite"></div>
<div class="detail-modal-overlay" id="detail-modal-overlay">
  <div class="detail-modal" id="detail-modal" role="dialog" aria-modal="true" aria-labelledby="dm-title">
    <div class="detail-modal-head">
      <div>
        <div class="detail-modal-title" id="dm-title">—</div>
        <div class="detail-modal-sub" id="dm-kode">—</div>
      </div>
      <button type="button" class="detail-modal-close" id="dm-close" aria-label="Tutup">&times;</button>
    </div>
    <div class="detail-modal-body" id="dm-body">
      <div class="detail-loading">Memuat detail…</div>
    </div>
  </div>
</div>
`;