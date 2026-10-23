// Markup statis halaman uploader-wiki. Semua class di-scope di bawah .uw-page (lihat style.css).
export const UPLOADER_WIKI_MARKUP = `
<div class="uw-page">
  <div class="page-head">
    <h1>Uploader Wiki</h1>
    <p>Bangun MASTER.xlsx untuk script Tampermonkey INAPROC Upload V6 dari database. Bisa dibagi ke beberapa operator.</p>
  </div>

  <div class="card uw-card">
    <div class="uw-step">1. Muat produk</div>
    <label class="uw-check"><input type="checkbox" id="uwActive" checked> Hanya produk aktif (is_active)</label>
    <label class="uw-check"><input type="checkbox" id="uwNoLink" checked> Hanya yang belum punya link_v6</label>
    <div class="uw-actions"><button class="btn btn-accent" id="uwLoad">Muat Produk</button><span class="uw-muted" id="uwLoadInfo"></span></div>
    <div id="uwFilters" hidden>
      <div class="uw-group"><span class="field-label">status_inaproc (kosong = semua)</span><div id="uwStatusInaproc" class="uw-chips"></div></div>
      <div class="uw-group"><span class="field-label">status_v6 (kosong = semua)</span><div id="uwStatusV6" class="uw-chips"></div></div>
      <div class="uw-group"><span class="field-label">Cari kode / nama (opsional)</span><input class="field-input" id="uwSearch" placeholder="mis. RBB- atau FORCEPS"></div>
      <div class="uw-muted" id="uwFilterCount"></div>
    </div>
  </div>

  <div class="card uw-card" id="uwBuildCard" hidden>
    <div class="uw-step">2. Bagi ke operator &amp; bangun</div>
    <div class="uw-row">
      <div><label class="field-label" for="uwOps">Jumlah operator (laptop)</label><input class="field-input" id="uwOps" type="number" min="1" max="20" value="1"></div>
      <div><label class="field-label" for="uwNames">Nama operator (pisah koma, opsional)</label><input class="field-input" id="uwNames" placeholder="Andi, Budi, Citra"></div>
    </div>
    <div class="uw-actions"><button class="btn btn-accent" id="uwBuild">Bangun MASTER</button><span class="uw-muted" id="uwBuildInfo"></span></div>
  </div>

  <div class="card uw-card" id="uwResultCard" hidden>
    <div class="uw-step">3. Hasil</div>
    <div class="uw-stats" id="uwStats"></div>
    <div id="uwIssues"></div>
    <div class="uw-actions"><button class="btn btn-accent" id="uwDownload">Download</button><span class="uw-muted" id="uwDownloadInfo"></span></div>
  </div>
</div>`;