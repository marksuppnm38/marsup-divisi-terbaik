// ══════════════════════════════════════════
// sph-module.js — Generate Surat Penawaran Harga (SPH) langsung dari item yang
// ada di Clipboard Konversian. Gak perlu Export ke Excel dulu terus upload ulang
// ke tool SPH Generator terpisah — data (dan gambar produknya di versi
// berikutnya) diambil langsung dari memory sesi yang lagi jalan.
//
// File ini di-load lewat <script src="sph-module.js"> SETELAH konversian.js,
// sebagai script classic biasa (bukan type="module") — jadi dia berbagi scope
// global yang sama dan bisa langsung pakai variabel/fungsi yang udah ada di
// konversian.js: `clipboard`, `modeSwastaOutput`, `rupiah()`, `showToast()`,
// `inpRs`, `inpSales`. Dipisah ke file sendiri biar konversian.js (udah 4000+
// baris) gak makin susah dibaca — tapi tetap satu halaman/satu app buat user.
//
// CATATAN mode harga: pakai `modeSwastaOutput` (toggle "Mode harga output" di
// clip-output-mode-row), BUKAN `modeSwasta` (itu toggle "Harga Swasta" di
// panel pencarian, cuma buat quick lookup pas browsing). Dulu modul ini
// (keliru) ikutan `modeSwasta`, dan lebih parah lagi kolom link e-Katalog
// selalu ditampilin apa pun mode-nya — padahal SPH mode swasta harusnya SAMA
// SEKALI gak nunjukin link e-katalog ke customer, sama kayak Export Excel.
// Sudah diperbaiki: link & kolom "E-Katalog v6" sekarang cuma muncul kalau
// !modeSwastaOutput, konsisten sama logic di Export ke Excel (konversian.js).
//
// CATATAN CAKUPAN (v2):
// - Yang di-generate: surat pengantar + tabel ringkasan produk + blok tanda
//   tangan + 3 jenis lampiran, SAMA PERSIS logic-nya kayak generatesph.html /
//   Export ke Excel (konversian.js), tapi dirender langsung ke jsPDF tanpa
//   file Excel perantara:
//     1. LAMPIRAN <NAMA SET> — tiap item di clipboard bertipe SET dipecah
//        jadi tabel rincian instrumen satuan di dalamnya (via getSetItems),
//        satu tabel per set (kode, deskripsi, qty, thumbnail kecil).
//     2. LAMPIRAN — ITEM SATUAN — satu tabel gabungan utk semua item
//        instrumen satuan (bukan set, bukan unit) yang ada di clipboard.
//     3. LAMPIRAN — <NAMA PRODUK> (full-page) — utk item apa pun (set,
//        satuan, atau unit) yang punya brosur PDF ter-upload/ter-set lewat
//        modal "Lampiran Produk"; tiap halaman PDF ditempel 1 halaman = 1
//        gambar penuh, bukan baris tabel (via getLampiranPagesForKode).
// - Yang BELUM dipindahin: "Record SPH" ke Supabase. Bisa nyusul di
//   iterasi berikutnya.
// ══════════════════════════════════════════

const MONTH_NAMES_ID = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
const ROMAN_MONTHS = ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'];

const SPH_PAGE_W = 210, SPH_PAGE_H = 297;
const SPH_MARGIN_X = 18;
const SPH_MARGIN_TOP = 18;
const SPH_FONT_SIZE = 11;

// Konfigurasi aset per perusahaan — PATH-BASED (assets/...), bukan base64 di
// source lagi. Hanya file yang BENERAN ada sekarang yang dicantumkan; yang
// belum ada sengaja di-null-in, bukan ditebak-tebak jadi path yang gak eksis.
// Kalau path gagal di-fetch (404 dll) juga otomatis dianggap "belum ada".
// Lihat sphRenderAssetSlots() untuk apa yang terjadi kalau kosong: user
// ditawarin upload manual buat surat itu aja (gak disimpan ke server).
const SPH_COMPANIES = {
  smy: {
    label: 'PT Samaya Medika Indonesia (SMY)',
    prefix: 'SPH-SMY',
    namaPt: 'PT Samaya Medika Indonesia',
    header: 'assets/HEADER_SAMAYA.png',
    footer: 'assets/FOOTER_SAMAYA.png',
    ttd: 'assets/TTD_SAMAYA.png', // udah komposit logo+ttd jadi satu gambar, gak perlu ditimpa manual
    headerWidthMm: 45
  },
  pnm: {
    label: 'PT Pionir Nusantara Manufacturing (PNM)',
    prefix: 'SPH-PNM',
    namaPt: 'PT Pionir Nusantara Manufacturing',
    header: null,  // belum ada file kop surat PNM di assets/ — upload manual dulu
    footer: null,  // belum ada
    ttd: null,     // belum ada
    headerWidthMm: 170
  },
  meto: {
    label: 'PT Meto Cahaya Abadi (METO)',
    prefix: 'SPH-METO',
    namaPt: 'PT Meto Cahaya Abadi',
    header: 'assets/header_meto.png',
    footer: 'assets/FOOTER_METO.png',
    ttd: null, // belum ada TTD default METO — user upload sendiri tiap generate
    headerWidthMm: 170
  }
};

// ===== STATE =====
let sphCurrentCompany = 'smy';
let sphHeaderAsset = null;   // {dataUrl, w, h} atau null
let sphFooterAsset = null;
let sphTtdAsset = null;
let sphHeaderStatus = 'loading'; // 'loading' | 'ok' | 'unconfigured' | 'error'
let sphFooterStatus = 'loading';
let sphTtdStatus = 'loading';
let sphInitialized = false;

// ===== HELPER TANGGAL/NOMOR (dipindah apa adanya dari generatesph.html) =====
function sphParseTanggalInput(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  if (!m) return new Date();
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
function sphFormatTanggalIndo(date) {
  const dd = String(date.getDate()).padStart(2, '0');
  return `${dd} ${MONTH_NAMES_ID[date.getMonth()]} ${date.getFullYear()}`;
}
function sphRomanMonthYear2(date) {
  return { roman: ROMAN_MONTHS[date.getMonth()], yy: String(date.getFullYear()).slice(-2) };
}
function sphBuildFileBaseName(nomorUrut, tanggalDate, namaRs, namaSales) {
  const { roman, yy } = sphRomanMonthYear2(tanggalDate);
  const nomorClean = (nomorUrut || '').trim() || 'SPH';
  const namaRsClean = (namaRs || 'RS').replace(/[^a-zA-Z0-9 ]/g, '').trim();
  const namaSalesClean = (namaSales || 'Marketing').replace(/[^a-zA-Z0-9 ]/g, '').trim();
  return `${nomorClean}-${roman}-${yy} - SPH ${namaRsClean} - ${namaSalesClean}`;
}

// Auto-crop padding transparan/putih di sekitar konten asli — sama persis
// logic-nya kayak generatesph.html, biar hasil komposit (terutama ttd yang
// nempel dekat teks "Marketing,") konsisten sama versi lama.
function sphTrimTransparentPadding(dataUrl) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      try {
        const cw = img.naturalWidth, ch = img.naturalHeight;
        const canvas = document.createElement('canvas');
        canvas.width = cw; canvas.height = ch;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const { data } = ctx.getImageData(0, 0, cw, ch);
        const WHITE_THRESHOLD = 245;
        let minX = cw, minY = ch, maxX = -1, maxY = -1;
        for (let yy = 0; yy < ch; yy++) {
          const rowOff = yy * cw * 4;
          for (let xx = 0; xx < cw; xx++) {
            const off = rowOff + xx * 4;
            const alpha = data[off + 3];
            const r = data[off], g = data[off + 1], b = data[off + 2];
            const isTransparent = alpha <= 10;
            const isWhiteish = r >= WHITE_THRESHOLD && g >= WHITE_THRESHOLD && b >= WHITE_THRESHOLD;
            if (!isTransparent && !isWhiteish) {
              if (xx < minX) minX = xx;
              if (xx > maxX) maxX = xx;
              if (yy < minY) minY = yy;
              if (yy > maxY) maxY = yy;
            }
          }
        }
        if (maxX < 0) { resolve({ dataUrl, w: cw, h: ch }); return; }
        const rowDensity = (yy) => { let c = 0; const off = yy * cw * 4; for (let xx = minX; xx <= maxX; xx++) { const i = off + xx * 4; if (data[i + 3] > 10 && !(data[i] >= WHITE_THRESHOLD && data[i + 1] >= WHITE_THRESHOLD && data[i + 2] >= WHITE_THRESHOLD)) c++; } return c; };
        const colDensity = (xx) => { let c = 0; for (let yy = minY; yy <= maxY; yy++) { const i = (yy * cw + xx) * 4; if (data[i + 3] > 10 && !(data[i] >= WHITE_THRESHOLD && data[i + 1] >= WHITE_THRESHOLD && data[i + 2] >= WHITE_THRESHOLD)) c++; } return c; };
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
          const r = od[i], g = od[i + 1], b = od[i + 2];
          if (r >= WHITE_THRESHOLD && g >= WHITE_THRESHOLD && b >= WHITE_THRESHOLD) od[i + 3] = 0;
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

// Baca file upload manual (fallback session-only) jadi {dataUrl, w, h}.
function sphReadFileAsAsset(file, trim) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target.result;
      if (trim) { resolve(await sphTrimTransparentPadding(dataUrl)); return; }
      const img = new Image();
      img.onload = () => resolve({ dataUrl, w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
      img.onerror = () => reject(new Error('Gagal memuat gambar'));
      img.src = dataUrl;
    };
    reader.onerror = () => reject(new Error('Gagal membaca file'));
    reader.readAsDataURL(file);
  });
}

// Ambil aset default dari folder assets/ (path-based). Sengaja dimuat lewat
// elemen <img>, BUKAN fetch() — fetch() diblokir browser kalau halamannya
// dibuka langsung dari file:// (each local file dianggap origin unik sendiri
// sama Chrome), sementara <img src="..."> tetap jalan normal baik di file://
// maupun http(s)://. Baca gambar jadi data mentah (buat di-trim / ditempel ke
// PDF) tetap butuh canvas, dan itu KADANG masih dibatasi kalau halamannya
// masih file:// — kalau itu terjadi, kita gak gagalin total, cuma jalan
// tanpa auto-crop transparansi (asset-nya tetap kepake, cuma gak dirapiin).
// Begitu halaman ini diakses lewat http(s) (Vercel, atau `npx serve` lokal),
// semuanya jalan normal termasuk trim-nya.
//
// Balikin {status, asset}:
// - 'unconfigured' — path-nya memang null (perusahaan ini belum dikasih aset itu)
// - 'error'         — file-nya beneran gak ketemu/gagal dimuat (404, dll)
// - 'ok'            — berhasil, siap dipakai (mungkin dengan/tanpa trim)
function sphLoadImage(path) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Gambar gagal dimuat: ${path}`));
    img.src = path;
  });
}
function sphImageToDataUrl(img) {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return canvas.toDataURL('image/png'); // bisa throw SecurityError kalau canvas ke-taint (khas file://)
}
async function sphFetchAsset(path, trim) {
  if (!path) return { status: 'unconfigured', asset: null };
  let img;
  try {
    img = await sphLoadImage(path);
  } catch (e) {
    console.warn(`[SPH] Gagal memuat aset "${path}":`, e);
    return { status: 'error', asset: null };
  }
  try {
    const dataUrl = sphImageToDataUrl(img);
    const asset = trim ? await sphTrimTransparentPadding(dataUrl) : { dataUrl, w: img.naturalWidth, h: img.naturalHeight };
    return { status: 'ok', asset };
  } catch (e) {
    // Gambar berhasil dimuat & bisa ditampilkan, tapi canvas-nya kebaca "unsafe"
    // (biasanya karena halaman ini masih dibuka lewat file:// langsung, bukan
    // di-serve lewat http/https). Tetap dianggap 'ok' pakai path aslinya biar
    // preview di slot tetap muncul — nanti pas Generate baru ketauan kalau
    // PDF-nya butuh di-serve lewat server buat bisa nempelin gambar ini.
    console.warn(`[SPH] "${path}" ke-load tapi canvas-nya dibatasi browser (biasanya karena dibuka lewat file:// — coba serve lewat http/https, misal "npx serve .").`, e);
    return { status: 'ok', asset: { dataUrl: path, w: img.naturalWidth || 1, h: img.naturalHeight || 1 } };
  }
}

// ===== SLOT ASET (header/footer/ttd) =====
// Satu slot per jenis aset: kalau default-nya ketemu, tampilin preview kecil +
// tombol "Ganti"; kalau enggak, tampilin ajakan upload. Upload di sini
// SESSION-ONLY (gak disimpan ke server/folder assets) — cuma buat generate
// PDF yang lagi dikerjain saat itu.
const sphAssetSlotsEl = document.getElementById('sph-asset-slots');

function sphAssetSlotHtml(kind, label, asset, status) {
  if (status === 'loading') {
    return `
      <div class="sph-asset-slot">
        <i class="ti ti-loader-2 sph-spin" style="font-size:16px"></i>
        <div class="sph-asset-label">${label} — memuat aset default…</div>
      </div>`;
  }
  if (status === 'ok' && asset) {
    return `
      <div class="sph-asset-slot ok">
        <img src="${asset.dataUrl}" alt="${label}"/>
        <div class="sph-asset-label">${label} <span style="opacity:.7">— siap dipakai</span></div>
        <input type="file" accept="image/*" id="sph-asset-${kind}-input"/>
        <button type="button" id="sph-asset-${kind}-btn">Ganti</button>
      </div>`;
  }
  if (status === 'error') {
    return `
      <div class="sph-asset-slot error">
        <i class="ti ti-alert-triangle" style="font-size:16px"></i>
        <div class="sph-asset-label">${label} — gagal dimuat dari server (cek console buat detail). Coba lagi, atau upload manual.</div>
        <input type="file" accept="image/*" id="sph-asset-${kind}-input"/>
        <button type="button" id="sph-asset-${kind}-retry">Coba lagi</button>
        <button type="button" id="sph-asset-${kind}-btn">Upload</button>
      </div>`;
  }
  // 'unconfigured' — perusahaan ini emang belum dikasih file default buat jenis aset ini.
  return `
    <div class="sph-asset-slot">
      <i class="ti ti-upload" style="font-size:16px"></i>
      <div class="sph-asset-label">${label} — belum ada default buat perusahaan ini. Upload manual (khusus surat ini aja, gak disimpan).</div>
      <input type="file" accept="image/*" id="sph-asset-${kind}-input"/>
      <button type="button" id="sph-asset-${kind}-btn">Upload</button>
    </div>`;
}

function sphRenderAssetSlots() {
  sphAssetSlotsEl.innerHTML =
    sphAssetSlotHtml('header', 'Kop Surat / Logo', sphHeaderAsset, sphHeaderStatus) +
    sphAssetSlotHtml('footer', 'Footer', sphFooterAsset, sphFooterStatus) +
    sphAssetSlotHtml('ttd', 'Tanda Tangan', sphTtdAsset, sphTtdStatus);

  ['header', 'footer', 'ttd'].forEach(kind => {
    const btn = document.getElementById(`sph-asset-${kind}-btn`);
    const input = document.getElementById(`sph-asset-${kind}-input`);
    const retryBtn = document.getElementById(`sph-asset-${kind}-retry`);
    if (btn && input) {
      btn.addEventListener('click', () => input.click());
      input.addEventListener('change', async () => {
        if (!input.files.length) return;
        try {
          const asset = await sphReadFileAsAsset(input.files[0], kind !== 'footer');
          sphSetAssetState(kind, 'ok', asset);
        } catch (err) {
          showToast('Gagal memuat file: ' + err.message, 'error');
        }
      });
    }
    if (retryBtn) {
      retryBtn.addEventListener('click', () => sphRetryAsset(kind));
    }
  });
}

function sphSetAssetState(kind, status, asset) {
  if (kind === 'header') { sphHeaderStatus = status; sphHeaderAsset = asset; }
  else if (kind === 'footer') { sphFooterStatus = status; sphFooterAsset = asset; }
  else { sphTtdStatus = status; sphTtdAsset = asset; }
  sphRenderAssetSlots();
}

async function sphRetryAsset(kind) {
  const company = SPH_COMPANIES[sphCurrentCompany];
  const pathByKind = { header: company.header, footer: company.footer, ttd: company.ttd };
  const trimByKind = { header: true, footer: false, ttd: true };
  sphSetAssetState(kind, 'loading', null);
  const { status, asset } = await sphFetchAsset(pathByKind[kind], trimByKind[kind]);
  sphSetAssetState(kind, status, asset);
}

// ===== PROFIL PERUSAHAAN =====
const sphCompanySelect = document.getElementById('sph-company');
const sphPrefixInput = document.getElementById('sph-prefix');

async function sphApplyCompanyProfile(key) {
  const company = SPH_COMPANIES[key];
  if (!company) return;
  sphCurrentCompany = key;
  sphCompanySelect.value = key;
  sphPrefixInput.value = company.prefix;

  sphHeaderAsset = null; sphFooterAsset = null; sphTtdAsset = null;
  sphHeaderStatus = 'loading'; sphFooterStatus = 'loading'; sphTtdStatus = 'loading';
  sphRenderAssetSlots(); // tampilin "memuat..." dulu, bukan "belum ada" — dua-duanya beda arti

  const [header, footer, ttd] = await Promise.all([
    sphFetchAsset(company.header, true),
    sphFetchAsset(company.footer, false),
    sphFetchAsset(company.ttd, true)
  ]);
  sphHeaderStatus = header.status; sphHeaderAsset = header.asset;
  sphFooterStatus = footer.status; sphFooterAsset = footer.asset;
  sphTtdStatus = ttd.status; sphTtdAsset = ttd.asset;
  sphRenderAssetSlots();
}
if (sphCompanySelect) sphCompanySelect.addEventListener('change', () => sphApplyCompanyProfile(sphCompanySelect.value));

// ===== ISI FORM OTOMATIS DARI SESI KONVERSIAN YANG LAGI JALAN =====
const sphNomorInput = document.getElementById('sph-nomor');
const sphTanggalInput = document.getElementById('sph-tanggal');
const sphRsInput = document.getElementById('sph-rs');
const sphSalesInput = document.getElementById('sph-sales');
const sphItemCountEl = document.getElementById('sph-item-count');
const sphValidationEl = document.getElementById('sph-validation');
const sphStatusEl = document.getElementById('sph-status');
const sphGenerateBtn = document.getElementById('sph-generate-btn');
const sphPreviewFrame = document.getElementById('sph-preview-frame');
const sphPreviewEmpty = document.getElementById('sph-preview-empty');
const sphDownloadLink = document.getElementById('sph-download-link');
const sphIncludeLampiranCheckbox = document.getElementById('sph-include-lampiran');
const sphRecordBtn = document.getElementById('sph-record-btn');

// ===== RECORD SPH (dipisah & best-effort dari "Record Konversi" di clip-panel:
// itu nyatet SESI ke konversi_record; ini nyatet SURAT SPH yang di-generate —
// dua konsep beda, sesi yang sama bisa aja gak pernah bikin SPH, atau bikin
// beberapa revisi SPH). Sama persis 2-tahap-nya kayak generatesph.html:
//   1. Supabase sph_records + sph_record_items — insight granular (query SQL).
//   2. Google Sheet (lewat sheets-webhook-proxy) — mirror, format lama dipertahankan.
// Auth & fetch-nya pakai sesiFetch()/stokAccessToken yang sudah ada di
// konversian.js (bukan pola sphRest terpisah dari generatesph.html), biar
// konsisten satu sesi login yang sama dgn seluruh app.
// SECURITY FIX 2026-08-14: sama seperti GAS_WEBHOOK_URL di konversian.js —
// dulu URL Apps Script dipanggil langsung dari browser tanpa proteksi sama
// sekali. Sekarang lewat SHEETS_PROXY_URL (Edge Function yang wajib verify
// JWT dulu), pakai konstanta SUPABASE_URL yang sudah didefinisikan global di
// konversian.js.
const SHEETS_PROXY_URL = `${SUPABASE_URL}/functions/v1/sheets-webhook-proxy`;
const recordSphModal = document.getElementById('record-sph-modal');
const rsphNomor = document.getElementById('rsph-nomor');
const rsphDistributor = document.getElementById('rsph-distributor');
const rsphTanggal = document.getElementById('rsph-tanggal');
const rsphCustomer = document.getElementById('rsph-customer');
const rsphSales = document.getElementById('rsph-sales');
const rsphDetail = document.getElementById('rsph-detail');
const rsphValue = document.getElementById('rsph-value');
const rsphNamaFile = document.getElementById('rsph-namafile');
const rsphOwner = document.getElementById('rsph-owner');
const rsphLink = document.getElementById('rsph-link');
const recordSphStatus = document.getElementById('record-sph-status');
const recordSphSubmitBtn = document.getElementById('record-sph-submit-btn');
const recordSphCancelBtn = document.getElementById('record-sph-cancel-btn');
let sphLastRecord = null; // data hasil generate terakhir, dipakai buat Record SPH
let sphAlreadySentToSheet = false;

function sphOpenRecordModal() {
  if (!sphLastRecord) return;
  rsphNomor.textContent = sphLastRecord.nomorSph;
  rsphDistributor.textContent = sphLastRecord.distributor;
  rsphTanggal.textContent = sphLastRecord.tanggalSurat;
  rsphCustomer.textContent = sphLastRecord.customer;
  rsphSales.textContent = sphLastRecord.picSales;
  rsphDetail.textContent = sphLastRecord.detailPenawaran;
  rsphValue.textContent = rupiah(sphLastRecord.totalValue);
  rsphNamaFile.textContent = sphLastRecord.namaFile;
  rsphOwner.textContent = (typeof inpMarsup !== 'undefined' && inpMarsup.value.trim()) || '(belum diisi)';
  rsphLink.value = '';
  recordSphStatus.textContent = '';
  recordSphStatus.style.color = '';
  sphAlreadySentToSheet = false;
  recordSphSubmitBtn.disabled = false;
  recordSphSubmitBtn.textContent = 'Kirim ke Sheet';
  recordSphModal.classList.add('show');
}
if (sphRecordBtn) sphRecordBtn.addEventListener('click', sphOpenRecordModal);
if (recordSphCancelBtn) recordSphCancelBtn.addEventListener('click', () => recordSphModal.classList.remove('show'));
if (recordSphModal) recordSphModal.addEventListener('click', (e) => { if (e.target === recordSphModal) recordSphModal.classList.remove('show'); });

// Tahap 1: Supabase (sph_records + sph_record_items) — fondasi wajib sukses.
async function sphRecordToSupabase(record, ownerValue) {
  const headerRes = await sesiFetch('sph_records', {
    method: 'POST',
    headers: { 'Prefer': 'return=representation' },
    body: JSON.stringify({
      no_sph: record.nomorSph,
      tanggal_surat: record.tanggalSurat,
      distributor: record.distributor,
      customer: record.customer,
      pic_sales: record.picSales,
      pic_owner: ownerValue,
      total_value: record.totalValue,
      nama_file: record.namaFile,
      status: 'Terkirim'
    })
  });
  if (!headerRes.ok) {
    const errData = await headerRes.json().catch(() => ({}));
    throw new Error(errData.message || errData.hint || 'Gagal menyimpan header sph_records');
  }
  const headerRows = await headerRes.json();
  const headerRow = Array.isArray(headerRows) ? headerRows[0] : headerRows;
  if (!headerRow || headerRow.id === undefined) throw new Error('Insert sph_records tidak mengembalikan id.');

  if (record.items && record.items.length) {
    const rows = record.items.map(i => ({
      sph_record_id: headerRow.id,
      kode_produk: i.kode_produk,
      deskripsi: i.deskripsi,
      qty: i.qty,
      harga_satuan: i.harga_satuan,
      total: i.total
    }));
    const itemRes = await sesiFetch('sph_record_items', {
      method: 'POST',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify(rows)
    });
    if (!itemRes.ok) {
      const errData = await itemRes.json().catch(() => ({}));
      throw new Error(errData.message || errData.hint || 'Header tersimpan, tapi detail item gagal (cek sph_record_items)');
    }
  }
  return headerRow.id;
}

recordSphSubmitBtn.addEventListener('click', async () => {
  if (sphAlreadySentToSheet) { recordSphModal.classList.remove('show'); return; }
  if (!sphLastRecord) return;
  const ownerValue = (typeof inpMarsup !== 'undefined' && inpMarsup.value.trim()) || '';
  if (!ownerValue) {
    recordSphStatus.textContent = 'Isi dulu "PIC Marsup" di panel Clipboard.';
    recordSphStatus.style.color = 'var(--danger)';
    return;
  }

  recordSphSubmitBtn.disabled = true;
  recordSphSubmitBtn.textContent = 'Menyimpan…';
  recordSphStatus.textContent = '';

  // ---- Tahap 1: Supabase ----
  try {
    await sphRecordToSupabase(sphLastRecord, ownerValue);
    recordSphStatus.textContent = 'Tersimpan ✓ — menyinkronkan ke Sheet…';
    recordSphStatus.style.color = 'var(--success)';
  } catch (err) {
    recordSphStatus.textContent = 'Gagal: ' + err.message;
    recordSphStatus.style.color = 'var(--danger)';
    recordSphSubmitBtn.disabled = false;
    recordSphSubmitBtn.textContent = 'Kirim ke Sheet';
    return;
  }

  // ---- Tahap 2: Google Sheet (mirror) ----
  const sheetPayload = {
    no_sph: sphLastRecord.nomorSph,
    distributor: sphLastRecord.distributor,
    tanggal_surat: sphLastRecord.tanggalSurat,
    customer: sphLastRecord.customer,
    pic_sales: sphLastRecord.picSales,
    detail_penawaran: sphLastRecord.detailPenawaran,
    total_value: sphLastRecord.totalValue,
    nama_file: sphLastRecord.namaFile,
    tanggal_file: sphLastRecord.tanggalFile,
    pic_owner: ownerValue,
    link_file: rsphLink.value.trim(),
    controller: ''
  };
  try {
    // SECURITY FIX 2026-08-14: lewat proxy + wajib token user login, bukan
    // manggil Apps Script langsung tanpa proteksi. getFreshToken() &
    // ANON_KEY dari konversian.js (satu scope global, sudah dimuat duluan).
    const uploadToken = await getFreshToken();
    if (!uploadToken || uploadToken === ANON_KEY) throw new Error('Sesi login sudah habis / belum login — silakan login ulang dulu.');
    const res = await fetch(SHEETS_PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + uploadToken
      },
      body: JSON.stringify({ target: 'sph', data: sheetPayload })
    });
    const result = await res.json();
    if (!result.ok) throw new Error(result.error || 'Gagal menyimpan ke sheet');

    recordSphStatus.textContent = 'Berhasil dicatat & disinkronkan ke Sheet ✓';
    recordSphStatus.style.color = 'var(--success)';
    sphAlreadySentToSheet = true;
    setTimeout(() => recordSphModal.classList.remove('show'), 1200);
  } catch (err) {
    // Sheet gagal bukan berarti semuanya gagal — data udah aman di Supabase.
    recordSphStatus.textContent = 'Tersimpan di sistem ✓, tapi gagal sync ke Sheet: ' + err.message;
    recordSphStatus.style.color = 'var(--danger)';
    recordSphSubmitBtn.disabled = false;
    recordSphSubmitBtn.textContent = 'Coba Sync ke Sheet Lagi';
  }
});

function sphPrefillFromSession() {
  if (!sphTanggalInput.value) sphTanggalInput.value = new Date().toISOString().slice(0, 10);
  // Cuma auto-isi kalau kolomnya masih kosong, biar gak nimpa yang udah diketik manual.
  if (!sphRsInput.value && typeof inpRs !== 'undefined' && inpRs.value) sphRsInput.value = inpRs.value;
  if (!sphSalesInput.value && typeof inpSales !== 'undefined' && inpSales.value) sphSalesInput.value = inpSales.value;
  sphItemCountEl.textContent = String(clipboard.length);
}

// FIX "isian SPH nyangkut di info SPH terakhir yang dibuat": sphPrefillFromSession()
// di atas SENGAJA cuma ngisi field yang MASIH KOSONG (biar gak nimpa ketikan manual
// user SELAMA masih di sesi yang sama) — tapi itu artinya begitu field udah keisi
// sekali, nilainya nempel SELAMANYA lintas sesi, walau sesi/RS/clipboard-nya udah
// beda total. Dipanggil dari resetChecklistUI() (titik pusat "sesi ganti") di
// konversian.js, SEBELUM sphPrefillFromSession jalan lagi pas tab SPH dibuka —
// jadi field kosong lagi dan keisi FRESH dari sesi yang baru dibuka.
window.sphFlow = {
  reset() {
    sphTanggalInput.value = '';
    sphRsInput.value = '';
    sphSalesInput.value = '';
    if (sphNomorInput) sphNomorInput.value = ''; // nomor SPH sesi lama gak relevan lagi
    sphLastRecord = null;
    sphAlreadySentToSheet = false;
    if (sphValidationEl) sphValidationEl.style.display = 'none';
    if (sphStatusEl) sphStatusEl.textContent = '';
    if (sphPreviewFrame) { sphPreviewFrame.src = ''; sphPreviewFrame.style.display = 'none'; }
    if (sphPreviewEmpty) sphPreviewEmpty.style.display = '';
    if (sphDownloadLink) sphDownloadLink.style.display = 'none';
    sphItemCountEl.textContent = String(clipboard.length);
  }
};

// Dipanggil dari switchClipTab() di konversian.js pas tab "Buat SPH" diklik.
window.onSphTabOpen = function () {
  if (!sphInitialized) {
    sphInitialized = true;
    sphApplyCompanyProfile('smy');
  }
  sphPrefillFromSession();
};

// ===== LAYOUT PDF (diadaptasi dari generatesph.html) =====
function sphGetFooterLayout() {
  if (!sphFooterAsset) return { h: 0, bottom: SPH_PAGE_H - 14 };
  const w = SPH_PAGE_W;
  const h = (sphFooterAsset.h / sphFooterAsset.w) * w;
  return { h, bottom: SPH_PAGE_H - h - 4, w };
}
function sphDrawFooter(doc) {
  if (!sphFooterAsset) return;
  const { h } = sphGetFooterLayout();
  try { doc.addImage(sphFooterAsset.dataUrl, 'PNG', 0, SPH_PAGE_H - h, SPH_PAGE_W, h); } catch (e) { }
}
function sphDrawHeader(doc, yTop) {
  if (!sphHeaderAsset) return 0;
  const company = SPH_COMPANIES[sphCurrentCompany];
  const headerW = company.headerWidthMm || 45;
  const headerH = (sphHeaderAsset.h / sphHeaderAsset.w) * headerW;
  try { doc.addImage(sphHeaderAsset.dataUrl, 'PNG', SPH_MARGIN_X, yTop, headerW, headerH); } catch (e) { }
  return headerH;
}
function sphAddPageWithFooter(doc) {
  doc.addPage();
  sphDrawFooter(doc);
  const headerH = sphDrawHeader(doc, SPH_MARGIN_TOP);
  return SPH_MARGIN_TOP + (headerH ? headerH + 6 : 0);
}

function sphValidate() {
  const errs = [];
  if (!clipboard.length) errs.push('Belum ada produk di Clipboard.');
  if (!sphNomorInput.value.trim()) errs.push('Nomor SPH wajib diisi.');
  if (!sphRsInput.value.trim()) errs.push('Nama RS / Instansi wajib diisi.');
  return errs;
}

// ===== LAMPIRAN — HELPER GAMBAR =====
// Disalin & disesuaikan (prefix SPH_/sph) dari generatesph.html, biar hasil
// akhirnya konsisten: dimensi asli dipakai buat jaga aspect ratio pas
// ditempel ke sel tabel/halaman penuh, dan tiap gambar dikompres dulu ke
// resolusi cetak (~150dpi di ukuran tampil) sebelum di-addImage, biar PDF
// gak bengkak walau sumbernya foto/scan resolusi tinggi.
function sphGetImageDimensions(dataUrl) {
  return new Promise(resolve => {
    if (!dataUrl) { resolve({ w: 1, h: 1 }); return; }
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
    img.onerror = () => resolve({ w: 1, h: 1 });
    img.src = dataUrl;
  });
}
function sphCompressImageForPdf(dataUrl, dispWmm, dispHmm, dpi = 150, quality = 0.82) {
  return new Promise(resolve => {
    if (!dataUrl) { resolve(dataUrl); return; }
    const img = new Image();
    img.onload = () => {
      try {
        const targetW = Math.max(1, Math.round((dispWmm / 25.4) * dpi));
        const targetH = Math.max(1, Math.round((dispHmm / 25.4) * dpi));
        const w = Math.min(img.naturalWidth || targetW, targetW);
        const h = Math.min(img.naturalHeight || targetH, targetH);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch (e) { resolve(dataUrl); }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

// Ambil 1 thumbnail per kode_produk UNIK, background-nya udah ditransparanin
// lewat removeBackground() — fungsi GLOBAL yang sama persis dipakai Export ke
// Excel (konversian.js) — biar tampilannya konsisten sama lampiran versi
// Excel, dan produk yang sama (muncul di beberapa set/baris) cuma di-fetch
// sekali.
async function sphFetchThumbForKodes(kodeAsliByKode, onProgress) {
  const kodes = [...kodeAsliByKode.keys()];
  const map = {};
  let done = 0;
  await Promise.all(kodes.map(async (kode) => {
    const raw = await fetchImageBase64(kodeAsliByKode.get(kode), kode);
    if (raw) {
      const clean = await removeBackground(raw);
      map[kode] = 'data:image/png;base64,' + clean;
    }
    done++;
    if (onProgress) onProgress(done, kodes.length);
  }));
  return map;
}

// ===== LAMPIRAN — TABEL ITEM + THUMBNAIL =====
// Dipakai utk lampiran per-SET (rincian instrumen satuan di dalam 1 set) dan
// lampiran ITEM SATUAN (1 tabel gabungan). Layout-nya SAMA PERSIS kayak
// halaman "LAMPIRAN <SET>" di generatesph.html: kolom NO/KODE/DESKRIPSI/QTY/
// GAMBAR, baris TOTAL qty di akhir, auto pindah halaman (header/footer
// perusahaan tetap ikut) kalau baris berikutnya gak muat.
async function sphDrawLampiranTablePage(doc, title, tableItems, safeBottom) {
  const lWidths = [10, 30, 80, 14, 40];
  const lHeaders = ['NO', 'KODE', 'DESKRIPSI', 'QTY', 'GAMBAR'];
  const tableW = lWidths.reduce((a, b) => a + b, 0);

  function drawLampHeader(yy) {
    doc.setFillColor(20, 40, 70);
    doc.rect(SPH_MARGIN_X, yy, tableW, 8.5, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(SPH_FONT_SIZE);
    let x = SPH_MARGIN_X;
    lHeaders.forEach((h, i) => { doc.text(h, x + 1.5, yy + 5.8); x += lWidths[i]; });
    doc.setTextColor(17, 24, 39);
    return yy + 8.5;
  }

  let ly = sphAddPageWithFooter(doc);
  doc.setFontSize(SPH_FONT_SIZE);
  doc.setFont('helvetica', 'bold');
  doc.text(title.toUpperCase(), SPH_PAGE_W / 2, ly, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  ly += 9;
  ly = drawLampHeader(ly);

  for (let idx = 0; idx < tableItems.length; idx++) {
    const item = tableItems[idx];
    const descLines = doc.splitTextToSize(item.deskripsi || '-', lWidths[2] - 3);
    const kodeLines = doc.splitTextToSize(item.kode_produk || '-', lWidths[1] - 3);
    const imgBoxH = 26;
    const rowH = Math.max(imgBoxH + 2, descLines.length * 5 + 3, kodeLines.length * 5 + 3);

    if (ly + rowH > safeBottom) {
      ly = sphAddPageWithFooter(doc);
      ly = drawLampHeader(ly);
    }
    if (idx % 2 === 0) { doc.setFillColor(245, 246, 248); doc.rect(SPH_MARGIN_X, ly, tableW, rowH, 'F'); }

    doc.setFontSize(SPH_FONT_SIZE);
    let x = SPH_MARGIN_X;
    doc.text(String(item.no ?? idx + 1), x + 1.5, ly + 5.2); x += lWidths[0];
    doc.text(kodeLines, x + 1.5, ly + 5.2); x += lWidths[1];
    doc.text(descLines, x + 1.5, ly + 5.2); x += lWidths[2];
    doc.text(String(item.qty ?? 1), x + lWidths[3] / 2, ly + 5.2, { align: 'center' }); x += lWidths[3];

    if (item.gambar) {
      try {
        const maxW = lWidths[4] - 4, maxH = imgBoxH - 2;
        let w = maxW, h = (item.gambarH / item.gambarW) * w;
        if (h > maxH) { h = maxH; w = (item.gambarW / item.gambarH) * h; }
        const imgX = x + (lWidths[4] - w) / 2;
        const imgY = ly + (rowH - h) / 2;
        const compressed = await sphCompressImageForPdf(item.gambar, w, h);
        doc.addImage(compressed, 'JPEG', imgX, imgY, w, h);
      } catch (e) { /* satu gambar gagal ditempel gak boleh gagalin seluruh lampiran */ }
    } else {
      doc.setFontSize(SPH_FONT_SIZE);
      doc.setTextColor(156, 163, 175);
      doc.text('Tidak ada gambar', x + lWidths[4] / 2, ly + rowH / 2 + 1, { align: 'center' });
      doc.setTextColor(17, 24, 39);
    }
    ly += rowH;
  }

  if (ly + 8.5 > safeBottom) { ly = sphAddPageWithFooter(doc); }
  doc.setFillColor(20, 40, 70);
  doc.rect(SPH_MARGIN_X, ly, tableW, 8.5, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(SPH_FONT_SIZE);
  doc.text('TOTAL', SPH_MARGIN_X + lWidths[0] + lWidths[1] + lWidths[2] - 1.5, ly + 5.8, { align: 'right' });
  const totalQty = tableItems.reduce((s, i) => s + (i.qty || 0), 0);
  doc.text(String(totalQty), SPH_MARGIN_X + lWidths[0] + lWidths[1] + lWidths[2] + lWidths[3] / 2, ly + 5.8, { align: 'center' });
  doc.setTextColor(17, 24, 39);
}

// ===== LAMPIRAN — HALAMAN PENUH (brosur PDF) =====
// SAMA PERSIS kayak lampiranUnits di generatesph.html: 1 halaman PDF brosur
// = 1 halaman penuh di dokumen SPH (bukan baris tabel). Dipakai utk item
// apa pun (set/satuan/unit) yang lampiran PDF-nya udah ter-upload/ter-set
// lewat modal "Lampiran Produk" — bukan cuma tipe UNIT, sesuai fitur
// drag&drop lampiran yang berlaku universal per kode_produk.
async function sphDrawLampiranUnitPages(doc, title, pages, safeBottom) {
  const tableW = SPH_PAGE_W - SPH_MARGIN_X * 2;
  for (let idx = 0; idx < pages.length; idx++) {
    const pg = pages[idx];
    let ly = sphAddPageWithFooter(doc);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(SPH_FONT_SIZE);
    doc.text(`LAMPIRAN — ${title}`, SPH_PAGE_W / 2, ly, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    ly += 7;

    const availW = tableW;
    const availH = Math.max(20, safeBottom - ly);
    let w = availW, h = (pg.height / pg.width) * w;
    if (h > availH) { h = availH; w = (pg.width / pg.height) * h; }
    const imgX = SPH_MARGIN_X + (availW - w) / 2;
    const imgY = ly + (availH - h) / 2;
    try {
      const dataUrl = 'data:image/jpeg;base64,' + pg.base64;
      const compressed = await sphCompressImageForPdf(dataUrl, w, h);
      doc.addImage(compressed, 'JPEG', imgX, imgY, w, h);
    } catch (e) { /* halaman brosur rusak, lanjut ke halaman berikutnya */ }
  }
}

// ===== GENERATE =====
async function sphGenerate() {
  const errs = sphValidate();
  if (errs.length) {
    sphValidationEl.style.display = 'block';
    sphValidationEl.textContent = errs.join(' ');
    return;
  }
  sphValidationEl.style.display = 'none';
  sphGenerateBtn.disabled = true;
  sphStatusEl.textContent = 'Menyusun dokumen…';
  // dokumen baru lagi disusun → hasil Record SPH sebelumnya (kalau ada) udah basi
  sphLastRecord = null;
  if (sphRecordBtn) sphRecordBtn.style.display = 'none';

  try {
    const company = SPH_COMPANIES[sphCurrentCompany];
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const tableW = SPH_PAGE_W - SPH_MARGIN_X * 2;
    const footerLayout = sphGetFooterLayout();
    const safeBottom = footerLayout.bottom;

    const namaRs = sphRsInput.value.trim();
    const namaSales = sphSalesInput.value.trim() || 'Marketing';
    const namaPt = company.namaPt;
    const tanggalDate = sphParseTanggalInput(sphTanggalInput.value);
    const { roman: bulanRomawi, yy: tahun2 } = sphRomanMonthYear2(tanggalDate);
    const nomorSph = `${sphPrefixInput.value.trim() || company.prefix} / ${sphNomorInput.value.trim()} / ${bulanRomawi} / 20${tahun2}`;
    const tanggalSurat = sphFormatTanggalIndo(tanggalDate);

    // Item diambil LANGSUNG dari clipboard yang lagi jalan di Konversian — bukan
    // dari file Excel yang diupload ulang. Ini inti bedanya dari SPH Generator lama.
    // Sumber harga ikut modeSwastaOutput (toggle "Mode harga output" di
    // clip-output-mode-row), SAMA kayak Export ke Excel — bukan modeSwasta yang
    // dipakai di panel pencarian. Pas mode swasta, link e-katalog SENGAJA
    // di-null-in (bukan cuma disembunyiin di render): dokumen buat customer
    // swasta gak boleh nunjukin link e-katalog resmi sama sekali.
    let no = 0;
    const items = clipboard.map(item => {
      no++;
      const harga = modeSwastaOutput ? (item.harga_swasta || 0) : (item.harga_ekat || 0);
      const qty = item.qty || 1;
      return {
        no,
        kode_produk: item.kode_produk || '-',
        deskripsi: item.nama_produk || '-',
        qty,
        harga,
        total: harga * qty,
        link: modeSwastaOutput ? null : (item.link_v6 || null)
      };
    });
    const grandTotal = items.reduce((s, it) => s + it.total, 0);

    sphDrawFooter(doc);
    let y = SPH_MARGIN_TOP;
    const headerH = sphDrawHeader(doc, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(SPH_FONT_SIZE);
    const dateY = y + Math.max(headerH, 8) + 6;
    doc.text(`Yogyakarta, ${tanggalSurat}`, SPH_PAGE_W - SPH_MARGIN_X, dateY, { align: 'right' });
    y = dateY + 8;

    doc.setFontSize(SPH_FONT_SIZE);
    doc.text('No.', SPH_MARGIN_X, y); doc.text(`: ${nomorSph}`, SPH_MARGIN_X + 22, y);
    y += 6.5;
    doc.text('Hal', SPH_MARGIN_X, y); doc.text(': Penawaran Harga', SPH_MARGIN_X + 22, y);
    y += 6.5;
    doc.text('Lamp.', SPH_MARGIN_X, y); doc.text(': Rincian Produk', SPH_MARGIN_X + 22, y);

    y += 12;
    doc.text('Kepada Yth.', SPH_MARGIN_X, y);
    y += 6.5;
    doc.text(`Direktur Utama ${namaRs}`, SPH_MARGIN_X, y);
    y += 6.5;
    doc.text('Di Tempat', SPH_MARGIN_X, y);

    y += 12;
    doc.text('Dengan hormat,', SPH_MARGIN_X, y);
    y += 6.5;
    const introText = `Sehubungan dengan kebutuhan alat kesehatan di ${namaRs}, bersama ini kami dari ${namaPt} menyampaikan penawaran harga untuk produk sebagai berikut:`;
    const introLines = doc.splitTextToSize(introText, tableW);
    doc.text(introLines, SPH_MARGIN_X, y);
    y += introLines.length * 5.5 + 7;

    // Kolom "E-Katalog v6" cuma ada di mode e-katalog — di mode swasta kolom ini
    // dihilangkan total (bukan cuma dikosongin isinya), sisa lebarnya dialihin ke
    // kolom Deskripsi biar tabel tetap kepake penuh. Konsisten sama sheet Ringkasan
    // di Export ke Excel yang juga ganti dari 8 kolom jadi 7 kolom pas mode swasta.
    const headers = modeSwastaOutput
      ? ['No', 'Kode', 'Deskripsi', 'Qty', 'Harga', 'Total']
      : ['No', 'Kode', 'Deskripsi', 'Qty', 'Harga', 'Total', 'E-Katalog v6'];
    const widths = modeSwastaOutput
      ? [9, 24, 74, 11, 26, 30]
      : [9, 24, 42, 11, 26, 30, 32];
    function drawTableHeader(yy) {
      doc.setFillColor(29, 91, 212);
      doc.rect(SPH_MARGIN_X, yy, tableW, 8.5, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(SPH_FONT_SIZE);
      let x = SPH_MARGIN_X;
      headers.forEach((h, i) => { doc.text(h, x + 1.5, yy + 5.8); x += widths[i]; });
      doc.setTextColor(17, 24, 39);
      return yy + 8.5;
    }
    y = drawTableHeader(y);

    items.forEach((item, idx) => {
      const descLines = doc.splitTextToSize(item.deskripsi, widths[2] - 3);
      const kodeLines = doc.splitTextToSize(item.kode_produk, widths[1] - 3);
      const rowH = Math.max(8, descLines.length * 5 + 3, kodeLines.length * 5 + 3);
      if (y + rowH > safeBottom) {
        y = sphAddPageWithFooter(doc);
        y = drawTableHeader(y);
      }
      if (idx % 2 === 0) { doc.setFillColor(245, 246, 248); doc.rect(SPH_MARGIN_X, y, tableW, rowH, 'F'); }
      doc.setFontSize(SPH_FONT_SIZE);
      let x = SPH_MARGIN_X;
      doc.text(String(item.no), x + 1.5, y + 5.2); x += widths[0];
      doc.text(kodeLines, x + 1.5, y + 5.2); x += widths[1];
      doc.text(descLines, x + 1.5, y + 5.2); x += widths[2];
      doc.text(String(item.qty), x + widths[3] / 2, y + 5.2, { align: 'center' }); x += widths[3];
      doc.text(rupiah(item.harga), x + widths[4] - 1.5, y + 5.2, { align: 'right' }); x += widths[4];
      doc.text(rupiah(item.total), x + widths[5] - 1.5, y + 5.2, { align: 'right' }); x += widths[5];
      if (!modeSwastaOutput) {
        if (item.link) {
          doc.setTextColor(29, 91, 212);
          doc.textWithLink('Lihat di e-Katalog', x + widths[6] / 2, y + 5.2, { url: item.link, align: 'center' });
          doc.setTextColor(17, 24, 39);
        } else {
          doc.setTextColor(156, 163, 175);
          doc.text('-', x + widths[6] / 2, y + 5.2, { align: 'center' });
          doc.setTextColor(17, 24, 39);
        }
      }
      y += rowH;
    });

    if (y + 8.5 > safeBottom) { y = sphAddPageWithFooter(doc); }
    doc.setFillColor(29, 91, 212);
    doc.rect(SPH_MARGIN_X, y, tableW, 8.5, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(SPH_FONT_SIZE);
    doc.text('TOTAL VALUE', SPH_MARGIN_X + widths[0] + widths[1] + widths[2] - 1.5, y + 5.8, { align: 'right' });
    doc.text(rupiah(grandTotal), SPH_MARGIN_X + widths[0] + widths[1] + widths[2] + widths[3] + widths[4] + widths[5] - 1.5, y + 5.8, { align: 'right' });
    doc.setTextColor(17, 24, 39);
    y += 15;

    doc.setFontSize(SPH_FONT_SIZE);
    const ketentuanH = 7 + 6.5 + 6.5 + 9;
    const closingText = `Kami berkomitmen menyediakan produk berkualitas dengan dukungan layanan yang responsif dan profesional. Besar harapan kami penawaran ini dapat menjadi solusi yang tepat bagi kebutuhan ${namaRs}. Apabila diperlukan diskusi lebih lanjut, kami siap untuk berkoordinasi sesuai kebutuhan. Kami menantikan kesempatan untuk dapat bekerja sama dalam waktu dekat. Atas perhatian dan kepercayaan yang diberikan, kami ucapkan terima kasih.`;
    const closingLines = doc.splitTextToSize(closingText, tableW);
    const closingH = closingLines.length * 5.5 + 14;
    const sigW = 32;
    const NAME_GAP = 14;
    const SIG_TOP_OFFSET = 3;
    const sigHForLayout = sphTtdAsset ? ((sphTtdAsset.h / sphTtdAsset.w) * sigW) : 0;
    const gapNeeded = sphTtdAsset ? (SIG_TOP_OFFSET + sigHForLayout + 2) : 0;
    const nameGapActual = Math.max(sphTtdAsset ? NAME_GAP : 20, gapNeeded);
    const signBlockH = nameGapActual + 10;
    const totalClosingBlockH = ketentuanH + closingH + signBlockH;

    if (y + totalClosingBlockH > safeBottom) { y = sphAddPageWithFooter(doc); }

    doc.text('Ketentuan penawaran:', SPH_MARGIN_X, y); y += 7;
    doc.text('•  Harga sudah termasuk PPn.', SPH_MARGIN_X + 3, y); y += 6.5;
    doc.text('•  Harga belum termasuk biaya pengiriman (ongkos kirim).', SPH_MARGIN_X + 3, y); y += 9;

    doc.text(closingLines, SPH_MARGIN_X, y);
    y += closingLines.length * 5.5 + 10;

    const signColW = Math.max(sigW, 40);
    const signColX = SPH_PAGE_W - SPH_MARGIN_X - signColW;
    const labelY = y;
    const nameY = labelY + nameGapActual;
    if (sphTtdAsset) {
      const sigH = sigHForLayout;
      const sigY = labelY + SIG_TOP_OFFSET;
      try { doc.addImage(sphTtdAsset.dataUrl, 'PNG', signColX, sigY, sigW, sigH); } catch (e) { }
    }
    doc.text('Marketing,', signColX, labelY);
    doc.setFont('helvetica', 'bold');
    doc.text(namaSales, signColX, nameY);
    doc.setFont('helvetica', 'normal');

    // ===== LAMPIRAN =====
    // Beda dari generatesph.html lama (yang narik gambar/PDF dari zip Excel
    // yang diupload ulang), di sini semuanya diambil LANGSUNG dari Supabase
    // (Storage + RPC) pakai fungsi-fungsi yang sama persis dipakai Export ke
    // Excel (getSetItems, fetchImageBase64, removeBackground,
    // getLampiranPagesForKode) — gak ada file Excel perantara. Tiga jenis
    // lampiran, urutannya ngikutin export: rincian per-SET dulu, lalu item
    // satuan gabungan, baru brosur PDF full-page.
    if (sphIncludeLampiranCheckbox && sphIncludeLampiranCheckbox.checked && clipboard.length) {
      const sets = clipboard.filter(i => i.is_set);
      const satuans = clipboard.filter(i => !i.is_set && i.tipe !== 'UNIT');

      // -- 1. rincian tiap SET (instrumen satuan di dalamnya) --
      if (sets.length) {
        sphStatusEl.textContent = `Mengambil rincian set… (0/${sets.length})`;
        const setItemsMap = {};
        for (let s = 0; s < sets.length; s++) {
          setItemsMap[sets[s].kode_produk] = await getSetItems(sets[s].kode_produk);
          sphStatusEl.textContent = `Mengambil rincian set… (${s + 1}/${sets.length})`;
        }

        const setKodeMap = new Map();
        sets.forEach(setItem => {
          (setItemsMap[setItem.kode_produk] || []).forEach(si => setKodeMap.set(si.kode_produk, si.kode_asli));
        });
        const setImgMap = await sphFetchThumbForKodes(setKodeMap, (done, total) => {
          sphStatusEl.textContent = `Mengambil foto rincian set… (${done}/${total})`;
        });
        const setImgDims = {};
        for (const kode of Object.keys(setImgMap)) {
          setImgDims[kode] = await sphGetImageDimensions(setImgMap[kode]);
        }

        for (const setItem of sets) {
          const subItems = setItemsMap[setItem.kode_produk] || [];
          if (!subItems.length) continue; // set tanpa rincian instrumen — gak bikin halaman kosong
          const tableItems = subItems.map((si, idx) => ({
            no: si.urutan ?? idx + 1,
            kode_produk: si.kode_produk,
            deskripsi: si.nama_produk,
            qty: si.qty,
            gambar: setImgMap[si.kode_produk] || null,
            gambarW: setImgDims[si.kode_produk] ? setImgDims[si.kode_produk].w : 1,
            gambarH: setImgDims[si.kode_produk] ? setImgDims[si.kode_produk].h : 1,
          }));
          sphStatusEl.textContent = `Menyusun lampiran "${setItem.nama_produk}"…`;
          await sphDrawLampiranTablePage(doc, `Lampiran ${setItem.nama_produk}`, tableItems, safeBottom);
        }
      }

      // -- 2. item satuan (instrumen non-set, non-unit) — 1 tabel gabungan --
      if (satuans.length) {
        sphStatusEl.textContent = `Mengambil foto item satuan… (0/${satuans.length})`;
        const satuanKodeMap = new Map();
        satuans.forEach(item => satuanKodeMap.set(item.kode_produk, item.kode_asli));
        const satuanImgMap = await sphFetchThumbForKodes(satuanKodeMap, (done, total) => {
          sphStatusEl.textContent = `Mengambil foto item satuan… (${done}/${total})`;
        });
        const satuanImgDims = {};
        for (const kode of Object.keys(satuanImgMap)) {
          satuanImgDims[kode] = await sphGetImageDimensions(satuanImgMap[kode]);
        }
        const tableItems = satuans.map((item, idx) => ({
          no: idx + 1,
          kode_produk: item.kode_produk,
          deskripsi: item.nama_produk,
          qty: item.qty || 1,
          gambar: satuanImgMap[item.kode_produk] || null,
          gambarW: satuanImgDims[item.kode_produk] ? satuanImgDims[item.kode_produk].w : 1,
          gambarH: satuanImgDims[item.kode_produk] ? satuanImgDims[item.kode_produk].h : 1,
        }));
        sphStatusEl.textContent = 'Menyusun lampiran item satuan…';
        await sphDrawLampiranTablePage(doc, 'Lampiran — Item Satuan', tableItems, safeBottom);
      }

      // -- 3. brosur PDF full-page, per item clipboard yang punya lampiran --
      // Dicek satu-satu tiap kode_produk top-level (bukan rincian di dalam
      // set) — sama kayak "SHEET LAMPIRAN" di export Excel.
      for (let u = 0; u < clipboard.length; u++) {
        const item = clipboard[u];
        sphStatusEl.textContent = `Mengecek lampiran brosur… (${u + 1}/${clipboard.length})`;
        const { pages } = await getLampiranPagesForKode(item.kode_produk);
        if (!pages.length) continue; // gak ada brosur buat produk ini — lewati
        sphStatusEl.textContent = `Menyusun lampiran brosur "${item.nama_produk}"…`;
        await sphDrawLampiranUnitPages(doc, item.nama_produk, pages, safeBottom);
      }
    }

    sphStatusEl.textContent = 'Menyiapkan preview…';
    const blob = doc.output('blob');
    const url = URL.createObjectURL(blob);
    sphPreviewFrame.src = url;
    sphPreviewFrame.style.display = 'block';
    sphPreviewEmpty.style.display = 'none';
    const fileName = sphBuildFileBaseName(sphNomorInput.value, tanggalDate, namaRs, namaSales) + '.pdf';
    sphDownloadLink.href = url;
    sphDownloadLink.download = fileName;
    sphDownloadLink.style.display = 'flex';
    sphStatusEl.textContent = `Siap — ${items.length} produk, total ${rupiah(grandTotal)}.`;

    // ── Simpan data buat Record SPH ──
    const detailPenawaran = items
      .map(i => `${i.deskripsi}${i.qty ? ` (x${i.qty})` : ''}`)
      .join('; ');
    sphLastRecord = {
      nomorSph,
      distributor: namaPt,
      tanggalSurat,
      customer: namaRs,
      picSales: namaSales,
      detailPenawaran,
      totalValue: grandTotal,
      namaFile: fileName,
      tanggalFile: new Date().toISOString().slice(0, 10),
      items: items.map(i => ({
        kode_produk: i.kode_produk,
        deskripsi: i.deskripsi,
        qty: i.qty || 0,
        harga_satuan: i.harga ?? null,
        total: i.total ?? null,
      }))
    };
    if (sphRecordBtn) sphRecordBtn.style.display = 'flex';
  } catch (err) {
    console.error(err);
    sphStatusEl.textContent = '';
    showToast('Gagal generate SPH: ' + err.message, 'error');
  } finally {
    sphGenerateBtn.disabled = false;
  }
}
if (sphGenerateBtn) sphGenerateBtn.addEventListener('click', sphGenerate);

// Update tombol/validasi ringan pas user ngetik nomor/RS (biar gak perlu klik
// Generate dulu baru tau ada yang kurang).
[sphNomorInput, sphRsInput].forEach(el => {
  if (el) el.addEventListener('input', () => { sphValidationEl.style.display = 'none'; });
});