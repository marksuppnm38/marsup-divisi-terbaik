// Markup statis halaman uploader-wiki. Semua class di-scope di bawah .uw-page (lihat style.css).
export const UPLOADER_WIKI_MARKUP = `
<div class="uw-page">
  <div class="page-head">
    <h1>Uploader Wiki</h1>
    <p>Pilih produk, lalu web app membuatkan paket siap pakai untuk script upload INAPROC: MASTER.xlsx, Spesifikasi, Struktur Harga, dan Thumbnail. Bisa dibagi ke beberapa operator (laptop).</p>
  </div>

  <div class="card uw-card uw-note">
    <b>Penting:</b> file <b>AKD</b> dan <b>STATIC_DOC</b> (distributor, CPAKB, garansi, spare part) tidak bisa dibuat web app.
    Tiap operator harus mengunduhnya sendiri dari
    <a href="https://drive.google.com/drive/folders/1mu7yn3mxKTFOOfRr6jftUC00CUayZU5-?usp=drive_link" target="_blank" rel="noopener">folder Drive ini</a>,
    lalu menggabungkannya dengan isi paket. Langkah lengkap ada di <code>BACA_DULU.txt</code> di dalam setiap paket.
  </div>

  <div class="card uw-card">
    <div class="uw-step">1. Cari &amp; pilih produk</div>
    <label class="field-label" for="uwQuery">Kode atau nama produk <span class="uw-muted">satu baris = pencarian biasa; beberapa baris = cari semuanya sekaligus (Ctrl+Enter)</span></label>
    <textarea class="field-input uw-query" id="uwQuery" rows="3" placeholder="mis. SCALPEL HANDLE, LANDOLT, BAY., 21 CM&#10;atau tempel banyak kode / nama, satu per baris"></textarea>
    <label class="uw-check"><input type="checkbox" id="uwHideLinked" checked> Sembunyikan yang sudah punya link_v6</label>
    <div class="uw-actions"><button class="btn btn-accent" id="uwSearch">Cari</button><span class="uw-muted" id="uwSearchInfo"></span></div>
    <div id="uwHits" hidden>
      <div class="uw-actions">
        <button class="btn btn-ghost" id="uwPickAll">Pilih semua hasil</button>
        <span class="uw-muted" id="uwHitInfo"></span>
      </div>
      <div id="uwList" class="uw-list"></div>
    </div>
    <div id="uwMiss"></div>
    <div class="uw-group">
      <div class="uw-actions" style="margin-top:0"><span class="field-label" style="margin:0">Terpilih</span><span class="uw-muted" id="uwSelInfo"></span><button class="btn btn-ghost" id="uwSelNone">Kosongkan</button></div>
      <div id="uwSelList" class="uw-chips" style="margin-top:8px"></div>
    </div>
  </div>

  <details class="card uw-card" id="uwSettings">
    <summary class="uw-step uw-sum">
      <span>2. Pengaturan &amp; pemetaan AKD</span>
      <span class="uw-sum-note" id="uwSumNote">Default sudah benar. Buka kalau perlu mengubah.</span>
    </summary>

    <section class="uw-sec">
      <div class="uw-sec-head">
        <div>
          <h3 class="uw-h3">Pemetaan AKD</h3>
          <p class="uw-muted">Kategori 2, Kategori 3, dan KBKI diturunkan dari nomor AKD. AKD yang belum dipetakan dilewati, tidak ditebak.</p>
        </div>
        <span class="uw-db" id="uwAkdDb"></span>
      </div>

      <div class="uw-bar">
        <input class="field-input" id="uwAkdNew" inputmode="numeric" placeholder="Nomor AKD baru (min. 8 digit)" aria-label="Nomor AKD baru">
        <button class="btn btn-ghost" id="uwAkdAdd">Tambah</button>
        <span class="uw-bar-msg" id="uwAkdAddMsg" role="status"></span>
        <span class="uw-spacer"></span>
        <button class="btn btn-accent" id="uwAkdSaveAll" hidden>Simpan semua</button>
      </div>

      <div class="uw-akd-head" aria-hidden="true"><span>AKD</span><span>Kategori 2</span><span>Kategori 3</span><span>KBKI</span><span></span></div>
      <div id="uwAkd" class="uw-akd"></div>

      <details class="uw-sub" id="uwAkdDone" hidden>
        <summary>Sudah dipetakan <span class="uw-count" id="uwAkdDoneN"></span></summary>
        <input class="field-input uw-find" id="uwAkdFind" placeholder="Cari nomor AKD, kategori, atau KBKI" aria-label="Cari pemetaan AKD">
        <div id="uwAkdDoneList" class="uw-akd"></div>
      </details>
    </section>

    <details class="uw-sub">
      <summary>Konstanta MASTER</summary>
      <div id="uwFields" class="uw-fields"></div>
    </details>

    <details class="uw-sub">
      <summary>Lanjutan</summary>
      <div class="uw-actions">
        <button class="btn btn-ghost" id="uwAkdCopy">Salin JSON</button>
        <button class="btn btn-ghost" id="uwAkdImport">Muat dari JSON</button>
        <button class="btn btn-ghost" id="uwReset">Reset ke default</button>
      </div>
      <textarea class="field-input uw-json" id="uwAkdJson" placeholder="Tempel JSON pemetaan AKD di sini lalu klik Terapkan JSON" hidden></textarea>
    </details>
  </details>

  <div class="card uw-card" id="uwCheckCard" hidden>
    <div class="uw-step">3. Periksa</div>
    <div class="uw-row">
      <div><label class="field-label" for="uwOps">Jumlah operator (laptop)</label><input class="field-input" id="uwOps" type="number" min="1" max="20" value="1"></div>
      <div><label class="field-label" for="uwNames">Nama operator (pisah koma, opsional)</label><input class="field-input" id="uwNames" placeholder="Andi, Budi, Citra"></div>
    </div>
    <div class="uw-actions"><button class="btn btn-accent" id="uwCheck">Periksa yang dipilih</button><span class="uw-muted" id="uwCheckInfo"></span></div>
    <progress id="uwProg" value="0" max="1" hidden></progress>
    <div id="uwResult" hidden>
      <div class="uw-stats" id="uwStats"></div>
      <div id="uwIssues"></div>
    </div>
  </div>

  <div class="card uw-card" id="uwBuildCard" hidden>
    <div class="uw-step">4. Bangun &amp; unduh paket</div>
    <div class="uw-muted" id="uwScriptInfo"></div>
    <div class="uw-actions">
      <button class="btn btn-accent" id="uwBuild">Bangun &amp; unduh paket</button>
      <button class="btn btn-ghost" id="uwCancel" hidden>Batal</button>
      <span class="uw-muted" id="uwBuildInfo"></span>
    </div>
    <progress id="uwBuildProg" value="0" max="1" hidden></progress>
  </div>
</div>`;