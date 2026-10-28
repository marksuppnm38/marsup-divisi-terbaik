// spek-maker/spp-ui.js -- tab "SPP" (Surat Permohonan Presentasi) di Document Maker.
//
// Dibangun dengan menyalin alur modul SPH (konversian/sph.js): pilih
// perusahaan -> aset kop/footer/TTD default dimuat dari /assets (bisa diganti
// manual per surat, tidak disimpan) -> isi form -> Generate -> preview + unduh.
// Bedanya: SPP cuma surat pengantar permohonan presentasi produk. Tidak ada
// nomor surat, tabel, kode/deskripsi/harga/link, maupun lampiran -- produk
// cukup ditulis bebas satu per baris (mis. "ROBUST SURGICAL DRILL"), jadi
// cakupannya luas (set robust, instrument robust, dst). Tidak ada Record ke
// Supabase/Sheet dan tidak ada DOCX.
//
// Output: 1 surat = 1 PDF bernama "spp-<nama rs>.pdf". Layout PDF ada di
// spp-pdf.js (diukur dari PDF contoh). Dependensi umum (toast, loadScript, dst)
// disuntik dari index.js lewat `deps`, sama seperti struktur-ui.js.

import { buildSppPdf, loadSppFonts, sppFileName, formatTanggalIndo, SPP_COMPANIES } from './spp-pdf.js';

const MARKUP = `
  <div class="card">
    <div class="card-head">
      <div class="icon-box blue"><i class="ti ti-presentation"></i></div>
      <div class="card-head-text">
        <h2>Surat Permohonan Presentasi</h2>
        <p>Surat pengantar untuk minta kesempatan demo produk ke rumah sakit. Tanpa kode, harga, atau link.</p>
      </div>
    </div>

    <label class="field-label" for="spCompany">Perusahaan</label>
    <select id="spCompany" class="field-input"></select>

    <label class="field-label sm-mt-16" for="spTanggal">Tanggal Surat</label>
    <input id="spTanggal" class="field-input" type="date">

    <label class="field-label sm-mt-16" for="spRs">Nama RS / Instansi</label>
    <input id="spRs" class="field-input" type="text" autocomplete="off" placeholder="RSUD dr. H. Moch. Ansari Saleh">

    <label class="field-label sm-mt-16" for="spAlamat">Alamat <span class="sm-field-hint">satu baris cetak per baris</span></label>
    <textarea id="spAlamat" class="field-input sm-textarea" style="min-height:72px" placeholder="Jl. Brigjend H. Hasan Basri No.1, Alalak Utara, Kec. Banjarmasin Utara,&#10;Kota Banjarmasin, Kalimantan Selatan"></textarea>

    <label class="field-label sm-mt-16" for="spProduk">Produk yang dipresentasikan <span class="sm-field-hint">satu butir per baris</span></label>
    <textarea id="spProduk" class="field-input sm-textarea" style="min-height:72px" placeholder="ROBUST SURGICAL DRILL"></textarea>

    <label class="field-label sm-mt-16" for="spNama">Nama Penandatangan</label>
    <input id="spNama" class="field-input" type="text" autocomplete="off" placeholder="Bidang Setyawannegara">

    <div id="spAssetSlots" class="sm-mt-16"></div>

    <div id="spValidation" class="sm-validation" style="display:none;" role="alert"></div>

    <div class="sm-actions sm-mt-16">
      <span id="spStatus" class="sm-status"></span>
      <button id="spGenerateBtn" type="button" class="btn btn-accent" data-sp="generate">
        <i class="ti ti-file-text" aria-hidden="true"></i> Generate SPP
      </button>
    </div>
  </div>

  <div id="spPreviewCard" class="card sm-mt-16" style="display:none;">
    <div class="card-head">
      <div class="icon-box green"><i class="ti ti-eye"></i></div>
      <div class="card-head-text">
        <h2>Preview</h2>
        <p id="spFileName"></p>
      </div>
    </div>
    <iframe id="spPreviewFrame" class="sm-preview" title="Preview SPP"></iframe>
    <div class="sm-actions sm-mt-16">
      <button type="button" class="btn btn-primary" data-sp="download">
        <i class="ti ti-download" aria-hidden="true"></i> Unduh PDF
      </button>
    </div>
  </div>
`;

const ASSET_KINDS = [
  { kind: 'header', label: 'Kop Surat / Logo', trim: true },
  { kind: 'footer', label: 'Footer', trim: false },
  { kind: 'ttd', label: 'Tanda Tangan', trim: true },
];

// ---- helper gambar (disalin dari konversian/sph.js, prefix sph -> sp) -------

// Auto-crop padding transparan/putih di sekitar konten asli, lalu putih -> transparan.
// Logika sama persis dengan sphTrimTransparentPadding supaya kop/TTD yang
// dihasilkan identik dengan yang dipakai SPH.
function trimTransparentPadding(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const cw = img.naturalWidth, ch = img.naturalHeight;
        const canvas = document.createElement('canvas');
        canvas.width = cw; canvas.height = ch;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const { data } = ctx.getImageData(0, 0, cw, ch);
        const WHITE = 245;
        const inked = (i) => data[i + 3] > 10 && !(data[i] >= WHITE && data[i + 1] >= WHITE && data[i + 2] >= WHITE);
        let minX = cw, minY = ch, maxX = -1, maxY = -1;
        for (let yy = 0; yy < ch; yy++) {
          for (let xx = 0; xx < cw; xx++) {
            if (inked((yy * cw + xx) * 4)) {
              if (xx < minX) minX = xx;
              if (xx > maxX) maxX = xx;
              if (yy < minY) minY = yy;
              if (yy > maxY) maxY = yy;
            }
          }
        }
        if (maxX < 0) { resolve({ dataUrl, w: cw, h: ch }); return; }
        const rowDensity = (yy) => { let c = 0; for (let xx = minX; xx <= maxX; xx++) if (inked((yy * cw + xx) * 4)) c++; return c; };
        const colDensity = (xx) => { let c = 0; for (let yy = minY; yy <= maxY; yy++) if (inked((yy * cw + xx) * 4)) c++; return c; };
        const rowMin = Math.max(3, 0.04 * (maxX - minX + 1));
        const colMin = Math.max(3, 0.04 * (maxY - minY + 1));
        while (minY < maxY && rowDensity(minY) < rowMin) minY++;
        while (maxY > minY && rowDensity(maxY) < rowMin) maxY--;
        while (minX < maxX && colDensity(minX) < colMin) minX++;
        while (maxX > minX && colDensity(maxX) < colMin) maxX--;
        const pad = 3;
        const sx = Math.max(0, minX - pad);
        const sy = Math.max(0, minY - pad);
        const sw = Math.min(cw - sx, (maxX - minX + 1) + pad * 2);
        const sh = Math.min(ch - sy, (maxY - minY + 1) + pad * 2);
        const out = document.createElement('canvas');
        out.width = sw; out.height = sh;
        const outCtx = out.getContext('2d');
        outCtx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
        const outData = outCtx.getImageData(0, 0, sw, sh);
        const od = outData.data;
        for (let i = 0; i < od.length; i += 4) {
          if (od[i] >= WHITE && od[i + 1] >= WHITE && od[i + 2] >= WHITE) od[i + 3] = 0;
        }
        outCtx.putImageData(outData, 0, 0);
        resolve({ dataUrl: out.toDataURL('image/png'), w: sw, h: sh });
      } catch (e) {
        resolve({ dataUrl, w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
      }
    };
    img.onerror = () => resolve({ dataUrl, w: 1, h: 1 });
    img.src = dataUrl;
  });
}

// Baca file upload manual (session-only) jadi {dataUrl, w, h}.
function readFileAsAsset(file, trim) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//i.test(file.type || '')) { reject(new Error('File harus berupa gambar')); return; }
    if (file.size > 20 * 1024 * 1024) { reject(new Error('Ukuran gambar maksimal 20 MB')); return; }
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target.result;
      if (trim) { resolve(await trimTransparentPadding(dataUrl)); return; }
      const img = new Image();
      img.onload = () => resolve({ dataUrl, w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
      img.onerror = () => reject(new Error('Gagal memuat gambar'));
      img.src = dataUrl;
    };
    reader.onerror = () => reject(new Error('Gagal membaca file'));
    reader.readAsDataURL(file);
  });
}

function loadImage(path) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Gambar gagal dimuat: ' + path));
    img.src = path;
  });
}

// Balikin {status, asset}: 'unconfigured' (path null) | 'error' (gagal dimuat) | 'ok'.
async function fetchAsset(path, trim) {
  if (!path) return { status: 'unconfigured', asset: null };
  let img;
  try {
    img = await loadImage(path);
  } catch (e) {
    console.warn('[SPP] Gagal memuat aset "' + path + '":', e);
    return { status: 'error', asset: null };
  }
  try {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
    const dataUrl = canvas.toDataURL('image/png');
    const asset = trim ? await trimTransparentPadding(dataUrl) : { dataUrl, w: img.naturalWidth, h: img.naturalHeight };
    return { status: 'ok', asset };
  } catch (e) {
    console.warn('[SPP] "' + path + '" ke-load tapi canvas-nya dibatasi browser:', e);
    return { status: 'error', asset: null };
  }
}

function todayLocalISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseTanggalInput(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  if (!m) return new Date();
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

const parseLines = (raw) => String(raw || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

export function mountSpp(panel, deps) {
  const { toast, loadScript, triggerDownload, cfg } = deps;
  panel.innerHTML = MARKUP;

  let alive = true;
  let company = 'smy';
  let companyRun = 0;           // naik tiap ganti perusahaan -> hasil muat aset lama diabaikan
  let previewUrl = null;
  let lastBlob = null;
  let lastName = '';
  const assets = { header: null, footer: null, ttd: null };
  const status = { header: 'loading', footer: 'loading', ttd: 'loading' };
  const offs = [];

  const $ = (id) => panel.querySelector('#' + id);
  const listen = (t, type, fn) => { t.addEventListener(type, fn); offs.push(() => t.removeEventListener(type, fn)); };

  // ---- perusahaan ----
  const sel = $('spCompany');
  Object.entries(SPP_COMPANIES).forEach(([key, c]) => sel.appendChild(new Option(c.label, key)));
  sel.value = company;
  $('spTanggal').value = todayLocalISO();

  // ---- slot aset (kop / footer / TTD) ----
  function slotHtml({ kind, label }) {
    const st = status[kind];
    const asset = assets[kind];
    const file = `<input type="file" accept="image/*" data-sp-file="${kind}">`;
    if (st === 'loading') {
      return `<div class="sph-asset-slot"><i class="ti ti-loader-2 sph-spin" style="font-size:16px"></i><div class="sph-asset-label">${label} — memuat aset default…</div></div>`;
    }
    if (st === 'ok' && asset) {
      return `<div class="sph-asset-slot ok"><img src="${/^data:image\//i.test(asset.dataUrl) ? asset.dataUrl.replace(/"/g, '%22') : ''}" alt="${label}"><div class="sph-asset-label">${label} <span style="opacity:.7">— siap dipakai</span></div>${file}<button type="button" data-sp="asset-pick" data-kind="${kind}">Ganti</button></div>`;
    }
    if (st === 'error') {
      return `<div class="sph-asset-slot error"><i class="ti ti-alert-triangle" style="font-size:16px"></i><div class="sph-asset-label">${label} — gagal dimuat dari server (cek console buat detail). Coba lagi, atau upload manual.</div>${file}<button type="button" data-sp="asset-retry" data-kind="${kind}">Coba lagi</button><button type="button" data-sp="asset-pick" data-kind="${kind}">Upload</button></div>`;
    }
    return `<div class="sph-asset-slot"><i class="ti ti-upload" style="font-size:16px"></i><div class="sph-asset-label">${label} — belum ada default buat perusahaan ini. Upload manual (khusus surat ini aja, gak disimpan).</div>${file}<button type="button" data-sp="asset-pick" data-kind="${kind}">Upload</button></div>`;
  }

  function renderSlots() {
    $('spAssetSlots').innerHTML = ASSET_KINDS.map(slotHtml).join('');
  }

  function setAsset(kind, st, asset) {
    status[kind] = st;
    assets[kind] = asset;
    renderSlots();
  }

  async function loadKind(kind, myRun) {
    const c = SPP_COMPANIES[company];
    const meta = ASSET_KINDS.find((k) => k.kind === kind);
    const res = await fetchAsset(c[kind], meta.trim);
    if (!alive || myRun !== companyRun) return;
    status[kind] = res.status;
    assets[kind] = res.asset;
  }

  async function applyCompany(key) {
    if (!SPP_COMPANIES[key]) return;
    company = key;
    const myRun = ++companyRun;
    ASSET_KINDS.forEach(({ kind }) => { status[kind] = 'loading'; assets[kind] = null; });
    renderSlots(); // "memuat..." dulu, bukan "belum ada" -- dua-duanya beda arti
    await Promise.all(ASSET_KINDS.map(({ kind }) => loadKind(kind, myRun)));
    if (!alive || myRun !== companyRun) return;
    renderSlots();
  }

  async function retryKind(kind) {
    setAsset(kind, 'loading', null);
    const myRun = companyRun;
    await loadKind(kind, myRun);
    if (alive && myRun === companyRun) renderSlots();
  }

  // ---- validasi + generate ----
  function validate() {
    const errs = [];
    if (!$('spRs').value.trim()) errs.push('Nama RS / Instansi wajib diisi.');
    if (!parseLines($('spProduk').value).length) errs.push('Isi minimal satu produk.');
    if (!$('spNama').value.trim()) errs.push('Nama penandatangan wajib diisi.');
    return errs;
  }

  function hideValidation() { $('spValidation').style.display = 'none'; }

  async function generate() {
    const errs = validate();
    const box = $('spValidation');
    if (errs.length) {
      box.style.display = 'block';
      box.textContent = errs.join(' ');
      return;
    }
    hideValidation();
    const btn = $('spGenerateBtn');
    const stat = $('spStatus');
    btn.disabled = true;
    stat.textContent = 'Menyusun dokumen…';
    try {
      await loadScript(cfg.JSPDF_SRC, cfg.JSPDF_SRI);
      const fonts = await loadSppFonts();
      if (!fonts) toast('Font Calibri (Carlito) gagal dimuat, pakai Helvetica. Tata letak tetap sama.', 'error');
      if (!alive) return;

      const c = SPP_COMPANIES[company];
      const namaRs = $('spRs').value.trim();
      const doc = buildSppPdf(window.jspdf.jsPDF, {
        tanggalSurat: formatTanggalIndo(parseTanggalInput($('spTanggal').value)),
        namaRs,
        alamat: parseLines($('spAlamat').value),
        produk: parseLines($('spProduk').value),
        namaPenandatangan: $('spNama').value.trim(),
        namaPt: c.namaPt,
        assets: { header: assets.header, footer: assets.footer, ttd: assets.ttd },
        headerLayout: c.headerLayout,
        footerLayout: c.footerLayout,
        fonts,
      });

      lastBlob = doc.output('blob');
      lastName = sppFileName(namaRs);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(lastBlob);
      $('spPreviewFrame').src = previewUrl;
      $('spFileName').textContent = lastName;
      const card = $('spPreviewCard');
      card.style.display = '';
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      stat.textContent = '';
    } catch (err) {
      console.error(err);
      stat.textContent = '';
      toast('Gagal generate SPP: ' + (err.message || err), 'error');
    } finally {
      btn.disabled = false;
    }
  }

  function download() {
    if (!lastBlob) return;
    triggerDownload(lastBlob, lastName);
    toast('PDF terunduh');
  }

  // ---- event ----
  listen(sel, 'change', () => applyCompany(sel.value));

  listen(panel, 'click', (e) => {
    const btn = e.target.closest('[data-sp]');
    if (!btn || !panel.contains(btn)) return;
    switch (btn.dataset.sp) {
      case 'generate': generate(); break;
      case 'download': download(); break;
      case 'asset-pick': btn.parentElement.querySelector('input[type=file]')?.click(); break;
      case 'asset-retry': retryKind(btn.dataset.kind); break;
      default: break;
    }
  });

  listen(panel, 'change', async (e) => {
    const input = e.target;
    const kind = input.dataset && input.dataset.spFile;
    if (!kind) return;
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const meta = ASSET_KINDS.find((k) => k.kind === kind);
      setAsset(kind, 'ok', await readFileAsAsset(file, meta.trim));
    } catch (err) {
      toast('Gagal memuat file: ' + err.message, 'error');
    }
  });

  // validasi ringan: hilangkan pesan error begitu user mulai mengetik lagi
  listen(panel, 'input', (e) => {
    if (e.target.matches('#spRs, #spProduk, #spNama')) hideValidation();
  });

  applyCompany(company);

  return function unmountSpp() {
    alive = false;
    companyRun++;
    offs.forEach((off) => off());
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
    lastBlob = null;
  };
}
