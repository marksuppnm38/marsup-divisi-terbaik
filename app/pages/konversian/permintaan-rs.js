// AUTO-EXTRACTED dari konversian/index.js (breakup sesuai map.md bagian 3) — Claude, 2026-09-15.
// Region asli: lihat map.md bagian 2. Semua state lintas-file diakses lewat
// objek 'S' yang dioper dari index.js (S = window.__konvBridge-style shared
// state, TAPI bukan window global — cuma dioper sebagai parameter, lihat
// index.js: const S = {}; lalu install*(S) dipanggil berurutan).
// Logic di dalam TIDAK diubah — cuma referensi ke variabel/fungsi yang
// didefinisikan di file LAIN diganti jadi S.nama (lihat COORD LOG index.js).
export function installPermintaanRs(S) {
// ══════════════════════════════════════════
// MODUL PERMINTAAN RS: catat permintaan (teks/Excel), cocokkan ke katalog,
// tampilkan mana yang match vs tidak. Pure data collection, bukan auto-konversi.
// ══════════════════════════════════════════

// ── STATE MODAL: 4 mode yang eksplisit, biar user gak perlu nebak data lama hilang atau enggak ──
//   create : sesi BELUM punya Permintaan RS  → form "Catat Permintaan RS" (perilaku lama)
//   active : sesi SUDAH punya               → ringkasan isi yang tersimpan + tombol Tambah / Edit
//   add    : nambah item ke yang sudah ada  → form input, header RS dikunci, yang lama TIDAK berubah
//   edit   : koreksi nama/qty/pagu satuan item tersimpan + pagu total/section → hanya yang berubah yang ditulis
// Model produk: 1 sesi = 1 Permintaan RS (server: get_permintaan_by_sesi ngembaliin satu objek;
// section/finalize/Drive semua keyed ke permintaan_id). Jadi "buka lagi" TIDAK pernah bikin
// Permintaan RS kedua di sesi yang sama.
let prMode = 'create';
const PR_SUB_CREATE = 'Simpan daftar permintaan RS (paste teks atau upload Excel), otomatis dicocokkan ke katalog produk. Ini murni buat data insight — bukan proses konversi otomatis.';
const prTitleEl = document.getElementById('pr-modal-title');
const prSubEl = document.getElementById('pr-modal-sub');
const prActiveWrap = document.getElementById('pr-active-wrap');
const prActiveMeta = document.getElementById('pr-active-meta');
const prActiveList = document.getElementById('pr-active-list');
const prEditWrap = document.getElementById('pr-edit-wrap');
const prEditRows = document.getElementById('pr-edit-rows');
const prHeaderFields = document.getElementById('pr-header-fields');

function hasActivePermintaan() { return !!S.checklistPermintaanId; }

function prSaveLabel() {
  return prMode === 'add' ? 'Tambah ke Permintaan RS' : 'Simpan & mulai sesi';
}

// keepReview: true kalau kita cuma ganti mode di tengah layar Review (kasus "ternyata
// sesi udah punya Permintaan RS" — baris review yang udah diketik jangan hilang).
function prSetMode(mode, keepReview) {
  prMode = mode;
  const n = S.checklistItems.length;
  prActiveWrap.style.display = mode === 'active' ? '' : 'none';
  prEditWrap.style.display = mode === 'edit' ? '' : 'none';
  const showInput = mode === 'create' || mode === 'add';
  if (!keepReview) {
    S.prFormWrap.style.display = showInput ? '' : 'none';
    S.prReviewWrap.style.display = 'none';
  }
  prHeaderFields.style.display = mode === 'create' ? '' : 'none';
  if (mode === 'create') {
    prTitleEl.textContent = 'Catat Permintaan RS';
    prSubEl.textContent = PR_SUB_CREATE;
  } else if (mode === 'active') {
    prTitleEl.textContent = 'Permintaan RS Sesi Ini';
    prSubEl.textContent = 'Tersimpan di sesi ini — tidak hilang saat modal ditutup atau sesi dibuka ulang.';
  } else if (mode === 'add') {
    prTitleEl.textContent = 'Tambah Item ke Permintaan RS';
    prSubEl.textContent = `Ini BUKAN Permintaan RS baru — item di bawah ditambahkan ke daftar sesi ini (${n} item sudah ada). Yang sudah ada tidak diubah atau ditimpa.`;
  } else if (mode === 'edit') {
    prTitleEl.textContent = 'Edit Permintaan RS';
    prSubEl.textContent = 'Koreksi nama, qty, atau pagu (total, per section, per item) yang sudah tersimpan.';
  }
  S.prReviewSaveBtn.textContent = prSaveLabel();
}

function prStatusChip(status) {
  if (status === 'TERPENUHI') return '<span class="pr-active-status ok">bisa dipenuhi</span>';
  if (status === 'TIDAK_TERPENUHI') return '<span class="pr-active-status no">tidak bisa</span>';
  return '<span class="pr-active-status">belum dicek</span>';
}

function renderPrActiveView() {
  const items = S.checklistItems;
  const done = items.filter(i => i.status === 'TERPENUHI').length;
  let tgl = '—';
  if (S.checklistTanggal) {
    const d = new Date(S.checklistTanggal);
    tgl = isNaN(d) ? String(S.checklistTanggal) : d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  prActiveMeta.innerHTML = `
    <span>RS: <b>${S.escapeHtmlAttr(S.checklistNamaRs || '-')}</b></span>
    <span>Sales: <b>${S.escapeHtmlAttr(S.checklistSales || '-')}</b></span>
    <span>Tanggal: <b>${S.escapeHtmlAttr(tgl)}</b></span>
    ${S.checklistPagu != null ? `<span>Pagu: <b>${S.rupiah(S.checklistPagu)}</b></span>` : ''}
    <span><b>${items.length}</b> item · ${done} terpenuhi</span>`;
  prActiveList.innerHTML = items.length ? items.map((it, i) => `
    <div class="pr-active-row">
      <span class="pr-active-name"><span class="pr-active-no">${i + 1}.</span> ${S.escapeHtmlAttr(it.raw_text)}</span>
      <span class="pr-active-qty">${it.qty_diminta ? '× ' + it.qty_diminta : '—'}</span>
      ${prStatusChip(it.status)}
    </div>`).join('') : '<div class="pr-review-empty">Belum ada item di Permintaan RS ini.</div>';
}

async function openPrModal(requestedMode) {
  S.prStatusMsg.textContent = '';
  prTeksFromOcr = false;
  prShowTab('teks');
  reviewItems = [];
  if (!S.prTanggal.value) S.prTanggal.value = new Date().toISOString().slice(0,10);

  // Satu login di gerbang awal sudah cukup — kalau token expired, balik ke gerbang.
  // Pakai getFreshToken() (bukan baca stokAccessToken langsung) biar gak salah
  // nendang ke login gara-gara token cache basi padahal sebenarnya masih bisa direfresh.
  const prModalToken = await S.getFreshToken();
  if (!prModalToken || prModalToken === S.ANON_KEY) {
    closePrModal();
    S.showGate('Sesi kamu habis, silakan masuk lagi.');
    return;
  }

  // Tentukan mode. Aturan keras: kalau sesi udah punya Permintaan RS, gak boleh jatuh
  // ke mode "create" (itu yang dulu nge-bikin Permintaan RS kedua & ngeganti daftar lama).
  const active = hasActivePermintaan();
  let mode = typeof requestedMode === 'string' ? requestedMode : (active ? 'active' : 'create');
  if (!active) mode = 'create';
  else if (mode === 'create') mode = 'active';

  if (mode === 'add') { S.prTeks.value = ''; S.prFile.value = ''; }
  prSetMode(mode);
  if (mode === 'active') renderPrActiveView();
  if (mode === 'edit') renderPrEditRows();
  S.prModal.classList.add('show');
}
S.openPrModal = (m) => openPrModal(m);
function closePrModal() { S.prModal.classList.remove('show'); }

S.btnPermintaan.addEventListener('click', () => openPrModal());
S.prCancelBtn2.addEventListener('click', () => { closePrModal(); resumeRecordAfterCancel(); });
S.prModal.addEventListener('click', (e) => { if (e.target === S.prModal) { closePrModal(); resumeRecordAfterCancel(); } });

// Kalau modal PR dibuka dari nudge tapi dibatalin (bukan submit), tetap balik
// ke Record modal — user cuma ngecek/mikir ulang, bukan mau kabur dari flow.
function resumeRecordAfterCancel() {
  if (S.resumeRecordAfterPr) {
    S.resumeRecordAfterPr = false;
    S.openRecordModal();
  }
}

// ---- Tombol di view "aktif" + strip Permintaan RS di panel sesi ----
document.getElementById('pr-active-close-btn').addEventListener('click', () => { closePrModal(); resumeRecordAfterCancel(); });
document.getElementById('pr-active-add-btn').addEventListener('click', () => openPrModal('add'));
document.getElementById('pr-active-edit-btn').addEventListener('click', () => openPrModal('edit'));

const rsStripState = document.getElementById('rs-strip-state');
const rsStripInfo = document.getElementById('rs-strip-info');
// Satu pintu masuk aja: klik strip → openPrModal() tanpa mode. Kalau sesi udah punya Permintaan RS
// jatuhnya ke view "active" (isi tersimpan + tombol Tambah item / Edit item); kalau belum → form Catat.
// Dulu ada tombol "+ Tambah"/"Edit" terpisah di strip yang loncat langsung ke form input, jadi
// kelihatan kayak bikin Permintaan RS baru — dibuang.
rsStripState.addEventListener('click', () => openPrModal());

// Satu-satunya tempat yang nyinkronin state Permintaan RS ke UI di luar modal:
// strip di panel sesi + label tombol toolbar. Dipanggil dari updateKbTabState()
// (yang udah jalan tiap checklist berubah/di-reset), jadi gak ada state kedua.
function updateRsStrip() {
  const active = hasActivePermintaan();
  const n = S.checklistItems.length;
  const done = S.checklistItems.filter(i => i.status === 'TERPENUHI').length;
  rsStripInfo.textContent = active ? `${n} item · ${done}/${n} terpenuhi` : 'Catat Permintaan RS';
  rsStripState.classList.toggle('has-data', active);
  rsStripState.title = active ? 'Lihat / tambah item / edit Permintaan RS sesi ini' : 'Catat Permintaan RS untuk sesi ini';
  const lbl = S.btnPermintaan.querySelector('.toggle-btn-label');
  if (lbl) lbl.textContent = active ? `Permintaan RS · ${n}` : 'Permintaan RS';
  S.btnPermintaan.title = active ? 'Lihat / tambah / edit Permintaan RS sesi ini' : 'Catat Permintaan RS';
}
S.updateRsStrip = updateRsStrip;

// ---- Tab switch Teks / Excel / Screenshot ----
let prTeksFromOcr = false;
S.prTeks.addEventListener('input', () => { prTeksFromOcr = false; });
const prTabSs = document.getElementById('pr-tab-ss');
const prSsWrap = document.getElementById('pr-ss-wrap');
const prSsFile = document.getElementById('pr-ss-file');
const prSsRunBtn = document.getElementById('pr-ss-run-btn');
const prSsStatus = document.getElementById('pr-ss-status');

let prActiveTab = 'teks';
function prShowTab(which) {
  prActiveTab = which;
  S.prTabTeks.classList.toggle('active', which === 'teks');
  S.prTabExcel.classList.toggle('active', which === 'excel');
  prTabSs.classList.toggle('active', which === 'ss');
  S.prTeksWrap.style.display = which === 'teks' ? 'block' : 'none';
  S.prExcelWrap.style.display = which === 'excel' ? 'block' : 'none';
  prSsWrap.style.display = which === 'ss' ? 'block' : 'none';
}
S.prTabTeks.addEventListener('click', () => prShowTab('teks'));
S.prTabExcel.addEventListener('click', () => prShowTab('excel'));
prTabSs.addEventListener('click', () => prShowTab('ss'));

// ---- OCR screenshot pakai Tesseract.js (gratis, jalan di browser, gak ada API key) ----
prSsRunBtn.addEventListener('click', async () => {
  const file = prSsFile.files[0];
  if (!file) {
    prSsStatus.textContent = 'Pilih file gambar dulu.';
    prSsStatus.style.color = 'var(--danger)';
    return;
  }
  prSsRunBtn.disabled = true;
  prSsStatus.style.color = 'var(--text-muted)';
  try {
    prSsStatus.textContent = 'Menyiapkan OCR…';
    await S.ensureTesseract(); // lazy: Tesseract.js (paling berat, ada wasm-nya) baru didownload di sini, pas OCR beneran dijalankan
    const result = await Tesseract.recognize(file, 'ind+eng', {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          prSsStatus.textContent = `Membaca gambar… ${Math.round((m.progress || 0) * 100)}%`;
        } else {
          prSsStatus.textContent = 'Menyiapkan OCR…';
        }
      }
    });
    const text = (result.data && result.data.text || '').trim();
    if (!text) {
      prSsStatus.style.color = 'var(--danger)';
      prSsStatus.textContent = 'Gak ada teks yang kebaca dari gambar ini. Coba ketik manual di tab Paste Teks.';
      return;
    }
    // Simpen gambarnya sebagai referensi (RAM-only, lihat addSsReference) — biar
    // user bisa cek balik ke sumber kalau nanti ternyata ada baris yang salah kebaca.
    S.addSsReference(file);
    // Hasil OCR ditaruh ke textarea Paste Teks, biar user cek/edit dulu sebelum simpan —
    // sama sekali gak langsung disimpan otomatis dari OCR.
    S.prTeks.value = (S.prTeks.value ? S.prTeks.value + '\n' : '') + text;
    prTeksFromOcr = true;
    prShowTab('teks');
    prSsStatus.textContent = '';
  } catch (err) {
    prSsStatus.style.color = 'var(--danger)';
    prSsStatus.textContent = 'Gagal baca gambar: ' + err.message;
  } finally {
    prSsRunBtn.disabled = false;
  }
});

// ---- Blocklist baris yang jelas BUKAN nama produk (header tabel yang ke-copy
// ikut, basa-basi/salam chat). Dipakai buat nyaring otomatis pas paste teks WA.
// EXACT MATCH setelah dirapikan — bukan "mengandung" — supaya nama produk yang
// kebetulan memuat kata ini (mis. "SC SET") tidak ikut kesaring.
const PR_NOISE_WORDS = new Set([
  'NO', 'NO.', 'NAMA', 'NAMA BARANG', 'NAMA ITEM', 'ITEM', 'BARANG',
  'QTY', 'QUANTITY', 'JUMLAH', 'JML', 'HARGA', 'SATUAN', 'KETERANGAN',
  'TOTAL', 'TANGGAL', 'TGL', 'PERIHAL', 'SUBJEK', 'LAMPIRAN', 'NO ITEM',
  'ASSALAMUALAIKUM', 'ASSALAMUALAIKUM WR WB', 'WAALAIKUMSALAM',
  'TERIMA KASIH', 'MAKASIH', 'THANKS', 'THANK YOU',
  'SIAP', 'NOTED', 'OK', 'OKE', 'OKAY', 'BAIK', 'IYA', 'YA',
  'MOHON DICEK', 'MOHON DIBANTU', 'MOHON BANTUANNYA',
  'SELAMAT PAGI', 'SELAMAT SIANG', 'SELAMAT SORE', 'SELAMAT MALAM'
]);

function prIsNoiseLine(text) {
  const norm = text.toUpperCase().replace(/\s+/g, ' ').trim().replace(/[.,;:]+$/, '');
  if (!norm) return true;
  if (!/[A-Za-z]/.test(norm)) return true; // cuma angka/simbol, gak ada huruf sama sekali
  return PR_NOISE_WORDS.has(norm);
}

// Harga singkat ala chat: "134 JT" -> 134000000, "150rb"/"150 ribu" -> 150000,
// "134.000.000" (sudah lengkap, gak ada singkatan) -> 134000000 apa adanya.
function prParsePriceShorthand(str) {
  const m = (str || '').trim().match(/^([\d.,]+)\s*(jt|juta|rb|ribu|k)?$/i);
  if (!m) return null;
  const digits = m[1].replace(/[.,]/g, ''); // titik/koma dianggap pemisah ribuan
  let val = parseInt(digits, 10);
  if (isNaN(val)) return null;
  const suffix = (m[2] || '').toLowerCase();
  if (suffix === 'jt' || suffix === 'juta') val *= 1000000;
  else if (suffix === 'rb' || suffix === 'ribu' || suffix === 'k') val *= 1000;
  return val;
}

// ---- Parsing teks paste: 1 baris = 1 item, qty boleh di depan/belakang/nempel
// ke kata satuan, harga boleh nempel pakai "@". Baris yang jelas bukan nama
// produk (header tabel, basa-basi chat, baris kosong angka/simbol doang)
// otomatis disaring — TAPI dilaporkan jumlahnya, bukan diam-diam dibuang,
// biar staff tetap sadar kalau ada baris yang "hilang" dari hasil paste. ----
function parseTeksPermintaan(teks) {
  const skipped = [];
  const items = teks.split('\n').map(line => line.trim()).filter(Boolean).map(rawLine => {
    let line = rawLine;

    // 1. Nomor urut list ("1. ", "2) ") — INI BUKAN qty, cuma nomor urut.
    //    Dipisah dari deteksi qty asli di bawah, supaya "1. Trocar 5mm" tidak
    //    kekunci qty=1 buat setiap baris hanya karena nomor urutnya kebetulan "1".
    line = line.replace(/^\d+[.)]\s+/, '');

    // 2. Bullet WA yang suka ke-copy ikut pas paste ("* ", "- ", "• ", dst)
    line = line.replace(/^[*\-•●▪‣·]+\s*/, '').trim();

    let qty = null;
    let pagu_satuan = null;

    // 3. Harga nempel pakai "@", contoh "BED ICU 2 UNIT@ 134 JT"
    const hargaMatch = line.match(/@\s*([\d.,]+\s*(?:jt|juta|rb|ribu|k)?)/i);
    if (hargaMatch) {
      pagu_satuan = prParsePriceShorthand(hargaMatch[1]);
      line = line.slice(0, hargaMatch.index).trim();
    }

    // 4. Qty nempel ke kata satuan, contoh "2 UNIT", "3 SET", "5 PCS"
    let m = line.match(/(\d+)\s*(UNIT|SET|PCS|BUAH|BOX|PAK|LUSIN)\b\.?/i);
    if (m) {
      qty = parseInt(m[1], 10);
      line = (line.slice(0, m.index) + ' ' + line.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
    } else {
      // 5. Qty di depan ("10 Trocar" / "10x Trocar") atau di belakang ("Trocar 10")
      m = line.match(/^(\d+)\s*[xX]?\s*(.+)$/);
      if (m) { qty = parseInt(m[1], 10); line = m[2].trim(); }
      else {
        m = line.match(/^(.+?)\s+(\d+)$/);
        if (m) { qty = parseInt(m[2], 10); line = m[1].trim(); }
      }
    }

    if (prIsNoiseLine(line)) { skipped.push(rawLine); return null; }
    return { raw_text: line, qty, pagu_satuan };
  }).filter(Boolean);

  items._skipped = skipped; // info baris yang disaring, dibaca sama pemanggil
  return items;
}

// ---- Parsing Excel: cari kolom nama barang & qty secara fleksibel ----
async function parseExcelPermintaan(file) {
  await S.ensureExceljs(); // lazy: ExcelJS baru didownload di sini, pas user beneran upload file Excel
  const buffer = await file.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];

  const headerRow = ws.getRow(1);
  let colNama = null, colQty = null;
  headerRow.eachCell((cell, colNumber) => {
    const v = String(cell.value || '').trim().toUpperCase();
    if (!colNama && /NAMA|BARANG|ITEM|PRODUK|DESKRIPSI/.test(v)) colNama = colNumber;
    if (!colQty && /QTY|JUMLAH|QUANTITY/.test(v)) colQty = colNumber;
  });
  // fallback: kolom 1 = nama, kolom 2 = qty kalau header gak ketebak
  if (!colNama) colNama = 1;
  if (!colQty) colQty = 2;

  const rows = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const namaBarang = String(row.getCell(colNama).value || '').trim();
    if (!namaBarang) continue;
    const qtyRaw = row.getCell(colQty).value;
    const qty = parseInt(qtyRaw, 10);
    rows.push({ raw_text: namaBarang, qty: isNaN(qty) ? null : qty });
  }
  return rows;
}

S.prSubmitBtn.addEventListener('click', async () => {
  S.prStatusMsg.textContent = '';

  let items = [];
  let sumber = 'TEKS';
  try {
    if (prActiveTab === 'teks') {
      items = parseTeksPermintaan(S.prTeks.value);
      sumber = prTeksFromOcr ? 'SCREENSHOT' : 'TEKS';
    } else if (prActiveTab === 'excel') {
      const file = S.prFile.files[0];
      if (!file) throw new Error('Pilih file Excel dulu.');
      items = await parseExcelPermintaan(file);
      sumber = 'EXCEL';
    } else {
      throw new Error('Klik "Baca Teks dari Gambar" dulu, hasilnya akan dicek di tab Paste Teks sebelum disimpan.');
    }
  } catch (err) {
    S.prStatusMsg.textContent = 'Gagal baca input: ' + err.message;
    S.prStatusMsg.style.color = 'var(--danger)';
    return;
  }

  // Baris yang otomatis disaring pas parsing teks WA (header tabel, basa-basi,
  // dsb.) — dilaporkan ke staff, bukan diam-diam hilang. Kalau ternyata ada
  // yang kesaring padahal itu nama produk beneran, staff bisa tambah manual
  // lewat "+ Tambah baris" di layar Review.
  reviewSkipped = items._skipped || [];

  if (items.length === 0) {
    S.prStatusMsg.textContent = reviewSkipped.length
      ? `Semua ${reviewSkipped.length} baris kebaca sebagai noise (header/basa-basi), gak ada nama produk yang kedeteksi.`
      : 'Gak ada baris permintaan yang terbaca.';
    S.prStatusMsg.style.color = 'var(--danger)';
    return;
  }

  // Belum manggil API sama sekali di sini — hasil parse dibawa dulu ke layar
  // Review biar staff bisa cek/edit nama, qty, dan isi pagu satuan per item
  // (opsional) sebelum benar-benar disimpan ke server.
  reviewItems = items.map(it => ({ raw_text: it.raw_text, qty: it.qty, pagu_satuan: it.pagu_satuan ?? null }));
  reviewSumber = sumber;
  renderReviewRows();
  S.prFormWrap.style.display = 'none';
  S.prReviewWrap.style.display = '';
});

// ---- Step 2: Layar Review — edit manual sebelum submit_permintaan_rs ----
let reviewItems = [];      // {raw_text, qty, pagu_satuan}
let reviewSumber = 'TEKS';
let reviewSkipped = [];    // baris mentah yang otomatis disaring pas parsing (info doang, ditampilkan)

function escapeHtmlAttr(s) {
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
S.escapeHtmlAttr = escapeHtmlAttr;

function renderReviewRows() {
  const labelSumber = reviewSumber === 'EXCEL' ? 'Excel' : reviewSumber === 'SCREENSHOT' ? 'screenshot' : 'teks';
  let info = `${reviewItems.length} item terbaca dari ${labelSumber} — cek dan lengkapi sebelum disimpan`;
  if (reviewSkipped.length) {
    info += `. ${reviewSkipped.length} baris disaring otomatis (bukan nama produk — header/basa-basi/simbol lepas): "${reviewSkipped.slice(0, 3).map(s => escapeHtmlAttr(s)).join('", "')}"${reviewSkipped.length > 3 ? ', dst.' : ''}`;
  }
  S.prReviewInfo.innerHTML = info;
  S.prReviewRows.innerHTML = reviewItems.length ? reviewItems.map((it, idx) => `
    <div class="pr-review-row" data-idx="${idx}">
      <input class="pr-rv-nama" value="${escapeHtmlAttr(it.raw_text)}" placeholder="Nama item"/>
      <input class="pr-rv-qty" inputmode="numeric" value="${it.qty != null ? it.qty : ''}" placeholder="Qty"/>
      <input class="pr-rv-pagu" inputmode="numeric" value="${it.pagu_satuan != null ? Number(it.pagu_satuan).toLocaleString('id-ID') : ''}" placeholder="opsional"/>
      <button type="button" class="pr-review-del" data-idx="${idx}" aria-label="Hapus baris"><i class="ti ti-trash"></i></button>
    </div>
  `).join('') : '<div class="pr-review-empty">Belum ada item. Tambah baris manual di bawah, atau klik "Kembali edit".</div>';
}

// Baca ulang isi input di DOM balik ke array reviewItems — dipanggil sebelum
// nambah/hapus baris (biar re-render gak nge-hapus ketikan yang belum sempat
// nyantol) dan sebelum submit final.
function syncReviewItemsFromDom() {
  const rows = S.prReviewRows.querySelectorAll('.pr-review-row');
  rows.forEach((row) => {
    const idx = parseInt(row.dataset.idx, 10);
    if (!reviewItems[idx]) return;
    const nama = row.querySelector('.pr-rv-nama').value.trim();
    const qtyRaw = row.querySelector('.pr-rv-qty').value.trim();
    const paguRaw = row.querySelector('.pr-rv-pagu').value;
    reviewItems[idx] = {
      raw_text: nama,
      qty: qtyRaw ? parseInt(qtyRaw, 10) : null,
      pagu_satuan: S.parsePaguValue(paguRaw)
    };
  });
}

// Format input Pagu satuan per baris jadi "150.000.000" sambil ngetik, sama
// kayak field Pagu utama di atas.
S.prReviewRows.addEventListener('input', (e) => {
  if (e.target.classList.contains('pr-rv-pagu')) {
    const digits = e.target.value.replace(/\D/g, '');
    e.target.value = digits ? Number(digits).toLocaleString('id-ID') : '';
  }
});

S.prReviewRows.addEventListener('click', (e) => {
  const btn = e.target.closest('.pr-review-del');
  if (!btn) return;
  syncReviewItemsFromDom();
  const idx = parseInt(btn.dataset.idx, 10);
  reviewItems.splice(idx, 1);
  renderReviewRows();
});

S.prReviewAddBtn.addEventListener('click', () => {
  syncReviewItemsFromDom();
  reviewItems.push({ raw_text: '', qty: null, pagu_satuan: null });
  renderReviewRows();
  const lastNama = S.prReviewRows.querySelector('.pr-review-row:last-child .pr-rv-nama');
  if (lastNama) lastNama.focus();
});

// "Kembali edit" cuma balik ke form input (teks/excel/screenshot) — item hasil
// parse yang lagi di-review dibuang, jadi kalau lanjut lagi nanti diparse ulang
// dari input aslinya (bukan dari state review yang sempat diedit).
S.prReviewBackBtn.addEventListener('click', () => {
  S.prReviewWrap.style.display = 'none';
  S.prFormWrap.style.display = '';
});

// ── TULIS KE SERVER: item Permintaan RS (tambah / koreksi) ──
// PENTING: permintaan_item TIDAK BOLEH ditulis lewat REST langsung — dicek di
// Supabase, authenticated cuma punya policy SELECT dan gak ada grant INSERT/
// UPDATE ke tabel ini. Semua tulis-menulis di app ini (lihat submit_permintaan_rs,
// update_permintaan_item_multi) lewat RPC SECURITY DEFINER yang cek whitelist
// allowed_users sendiri. Dua fungsi di bawah manggil RPC yang MENGIKUTI POLA
// YANG SAMA (lihat rpc-baru-permintaan-item.sql) — bukan REST langsung ke tabel.
async function apiInsertPermintaanItems(items) {
  const payloadItems = items.map(it => ({
    raw_text: it.raw_text,
    qty: it.qty != null ? it.qty : null,
    pagu_satuan: it.pagu_satuan != null ? it.pagu_satuan : null
  }));
  const { data, error } = await S.rpc('add_permintaan_items', {
    p_permintaan_id: S.checklistPermintaanId,
    p_items: payloadItems
  });
  if (error) throw new Error(error.message || error.hint || 'Gagal menambah item (cek izin akun / RPC add_permintaan_items)');
  const inserted = (data && Array.isArray(data.items)) ? data.items : [];
  if (inserted.length !== payloadItems.length) throw new Error('Server tidak mengonfirmasi semua item tersimpan');

  // Assign ke section yang lagi dibuka (kalau ada) — pakai RPC section yang SUDAH
  // ADA (move_permintaan_item_section), biar logic assignment section gak
  // diduplikasi di RPC baru.
  const sectionId = (typeof S.activeSectionTab === 'number') ? S.activeSectionTab : null;
  if (sectionId != null) {
    for (const it of inserted) {
      await S.rpc('move_permintaan_item_section', { p_item_id: it.id, p_section_id: sectionId });
      it.section_id = sectionId;
    }
  }
  return inserted;
}

async function apiUpdatePermintaanItem(itemId, fields) {
  const { data, error } = await S.rpc('update_permintaan_item_fields', {
    p_item_id: itemId,
    p_raw_text: fields.raw_text,
    p_qty_diminta: fields.qty_diminta
  });
  if (error) throw new Error(error.message || error.hint || 'Gagal mengubah item (cek izin akun / RPC update_permintaan_item_fields)');
  return data;
}

// Pagu satuan per item — RPC terpisah (update_permintaan_item_fields cuma nerima nama+qty).
// Lihat edit_pagu_permintaan_migration.sql.
async function apiUpdatePermintaanItemPaguSatuan(itemId, paguSatuan) {
  const { data, error } = await S.rpc('update_permintaan_item_pagu_satuan', {
    p_item_id: itemId,
    p_pagu_satuan: paguSatuan
  });
  if (error) throw new Error(error.message || error.hint || 'Gagal mengubah pagu satuan (cek RPC update_permintaan_item_pagu_satuan)');
  return data;
}

// Pagu total Permintaan RS — satu RPC yang nulis permintaan_rs.pagu DAN sesi_konversi.pagu
// sekaligus (dua-duanya dibaca UI: get_permintaan_by_sesi vs baris sesi), biar gak saling timpa.
async function apiUpdatePermintaanPagu(permintaanId, pagu) {
  const { data, error } = await S.rpc('update_permintaan_pagu', {
    p_permintaan_id: permintaanId,
    p_pagu: pagu
  });
  if (error) throw new Error(error.message || error.hint || 'Gagal mengubah pagu total (cek RPC update_permintaan_pagu)');
  return data;
}

// Kabari kolaborator yang lagi buka sesi yang sama: daftar item berubah (tambah/edit),
// mereka tinggal muat ulang dari server. Pola sama kayak checklist_item_updated.
function broadcastChecklistReload() {
  if (typeof S.broadcastChecklistReload === 'function') S.broadcastChecklistReload();
}

// ---- Mode ADD: tambah item ke Permintaan RS yang sudah ada ----
async function addItemsToActivePermintaan(items) {
  const before = S.checklistItems.length;
  await apiInsertPermintaanItems(items);
  // Sumber kebenaran = server: muat ulang, bukan nambal state lokal.
  const pid = await S.loadChecklistForSesi(S.currentSesiId, { quiet: true });
  if (pid == null || S.checklistItems.length < before + items.length) {
    throw new Error('Item terkirim tapi belum kebaca dari server — klik refresh di tab Kebutuhan RS untuk memastikan');
  }
  broadcastChecklistReload();
  return items.length;
}

S.prReviewSaveBtn.addEventListener('click', async () => {
  S.prStatusMsg.textContent = '';
  syncReviewItemsFromDom();

  // Baris manual yang ditambah tapi nama-nya gak jadi diisi, dibuang diam-diam
  // (bukan error) — daripada ganjel submit gara-gara baris kosong.
  const items = reviewItems.filter(it => it.raw_text);
  if (items.length === 0) {
    S.prStatusMsg.style.color = 'var(--danger)';
    S.prStatusMsg.textContent = 'Gak ada item tersisa buat disimpan.';
    return;
  }

  S.prReviewSaveBtn.disabled = true;
  S.prReviewSaveBtn.textContent = 'Menyimpan…';

  try {
    // ── MODE ADD: nambah ke Permintaan RS yang sudah ada. Gak nyentuh header, gak bikin permintaan baru. ──
    if (prMode === 'add') {
      const n = await addItemsToActivePermintaan(items);
      S.showToast(`${n} item ditambahkan ke Permintaan RS (total ${S.checklistItems.length})`);
      closePrModal();
      S.prTeks.value = ''; S.prFile.value = '';
      if (S.resumeRecordAfterPr) { S.resumeRecordAfterPr = false; S.openRecordModal(); }
      return;
    }

    // ── MODE CREATE ──
    // Permintaan RS ini nempel ke sesi konversi yang lagi aktif (bikin baru
    // kalau belum ada), jadi kalau temen buka sesi yang sama, daftar
    // permintaannya ikut kelihatan — bukan cuma tersimpan di layar sendiri.
    // Sama kayak "+ Tambahkan ke Konversi" di Cari Cepat: kalau ini bakal jadi
    // sesi PERTAMA, konfirmasi dulu biar bikin row sesi_konversi itu keputusan
    // sadar, bukan efek samping submit form.
    const isFirstCommit = !S.currentSesiId;
    if (isFirstCommit) {
      const ok = await S.showConfirmModal({
        title: 'Mulai Konversi Baru?',
        text: 'Permintaan RS ini bakal disimpan ke sesi konversi baru.',
        okText: 'Ya, Mulai Konversi'
      });
      if (!ok) return; // finally di bawah tetap jalan, ngebalikin tombol ke state semula
    } else {
      // Jaga-jaga race: temen bisa aja nyatet Permintaan RS buat sesi ini SEBELUM kita submit
      // (layar kita belum tau). Cek ke server dulu — kalau udah ada, jangan bikin yang kedua.
      const existingId = await S.loadChecklistForSesi(S.currentSesiId, { quiet: true });
      if (existingId != null) {
        prSetMode('add', true);
        S.prStatusMsg.style.color = 'var(--danger)';
        S.prStatusMsg.textContent = 'Sesi ini ternyata sudah punya Permintaan RS (baru dicatat). Item di layar ini belum disimpan — klik "Tambah ke Permintaan RS" kalau mau menambahkannya.';
        return;
      }
    }
    const sesiId = await S.ensureSesi();
    const namaRsTrim = S.prNamaRs.value.trim();
    const picSalesTrim = S.prPicSales.value.trim();
    if (namaRsTrim || picSalesTrim) {
      await S.sesiFetch(`${S.SESI_TABLE}?id=eq.${sesiId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          nama_rs: namaRsTrim || null,
          nama_sales: picSalesTrim || null,
          updated_at: new Date().toISOString()
        })
      });
    }

    const res = await fetch(`${S.SUPABASE_URL}/rest/v1/rpc/submit_permintaan_rs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': S.ANON_KEY,
        'Authorization': 'Bearer ' + (await S.getFreshToken())
      },
      body: JSON.stringify({
        p_tanggal: S.prTanggal.value || null,
        p_nama_rs: S.prNamaRs.value.trim() || null,
        p_pic_sales: S.prPicSales.value.trim() || null,
        p_sumber: reviewSumber,
        p_pagu: S.parsePaguValue(S.prPagu.value),
        p_items: items,
        p_sesi_id: sesiId
      })
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.message || errData.hint || 'Gagal simpan (cek login/whitelist)');
    }
    const result = await res.json();

    S.startChecklistSession(result, S.prNamaRs.value.trim(), S.prPicSales.value.trim(), S.parsePaguValue(S.prPagu.value), S.prTanggal.value || null);

    // VERIFIKASI persist: baca balik dari server lewat jalur yang SAMA dipakai pas
    // sesi dibuka ulang (get_permintaan_by_sesi). Kalau yang kebaca beda/kosong, user
    // dikasih tau sekarang — bukan baru sadar nanti pas reopen bahwa datanya "hilang".
    const persistedId = await S.loadChecklistForSesi(sesiId);
    if (persistedId == null || persistedId !== result.permintaan_id) {
      PNMToast.show('Permintaan RS terkirim, tapi belum terbaca balik dari sesi ini. Coba buka ulang sesi untuk memastikan.', 'error', { duration: 6000 });
    }

    S.prTeks.value = ''; S.prFile.value = '';
    closePrModal();
    if (typeof S.switchDoor === 'function') S.switchDoor('konversi');

    // Kalau tadi masuk ke sini lewat nudge di Record modal, balik lagi ke situ
    // biar user lanjut dari titik yang sama (bukan ilang, harus klik Record lagi).
    if (S.resumeRecordAfterPr) {
      S.resumeRecordAfterPr = false;
      S.openRecordModal();
    }
  } catch (err) {
    S.prStatusMsg.style.color = 'var(--danger)';
    S.prStatusMsg.textContent = 'Gagal: ' + err.message;
  } finally {
    S.prReviewSaveBtn.disabled = false;
    S.prReviewSaveBtn.textContent = prSaveLabel();
  }
});

// ---- Mode EDIT: koreksi nama/qty item yang sudah tersimpan ----
let prEditOriginal = new Map(); // id -> {raw_text, qty_diminta, pagu_satuan} saat editor dibuka
let prEditOriginalPagu = { total: null, sections: new Map() }; // pagu total + pagu per section saat editor dibuka
const prEdPaguTotal = document.getElementById('pr-ed-pagu-total');
const prEdPaguSections = document.getElementById('pr-ed-pagu-sections');
const normPagu = v => (v == null || v === '' || isNaN(Number(v))) ? null : Number(v);
const fmtPagu = v => v != null ? Number(v).toLocaleString('id-ID') : '';

function renderPrEditRows() {
  prEditOriginal = new Map(S.checklistItems.map(it => [it.id, { raw_text: it.raw_text, qty_diminta: it.qty_diminta ?? null, pagu_satuan: normPagu(it.pagu_satuan) }]));
  prEditRows.innerHTML = S.checklistItems.length ? S.checklistItems.map(it => `
    <div class="pr-edit-row" data-id="${it.id}">
      <input class="pr-ed-nama" value="${escapeHtmlAttr(it.raw_text)}" placeholder="Nama item"/>
      <input class="pr-ed-qty" inputmode="numeric" value="${it.qty_diminta != null ? it.qty_diminta : ''}" placeholder="Qty"/>
      <input class="pr-ed-pagusat" inputmode="numeric" value="${fmtPagu(normPagu(it.pagu_satuan))}" placeholder="opsional"/>
    </div>`).join('') : '<div class="pr-review-empty">Belum ada item.</div>';

  // Pagu total + (kalau ada) pagu per section
  prEditOriginalPagu = { total: normPagu(S.checklistPagu), sections: new Map(S.checklistSections.map(s => [s.id, normPagu(s.pagu)])) };
  prEdPaguTotal.value = fmtPagu(prEditOriginalPagu.total);
  prEdPaguSections.innerHTML = S.checklistSections.length ? S.checklistSections.map(s => `
    <div class="pr-edit-pagu-sec">
      <span>Pagu section: <b>${escapeHtmlAttr(s.nama_section)}</b></span>
      <input class="pr-ed-pagu-sec" data-section-id="${s.id}" inputmode="numeric" value="${fmtPagu(normPagu(s.pagu))}" placeholder="belum diisi"/>
    </div>`).join('') : '';
}

// Format ribuan sambil ngetik (pagu total, pagu section, pagu satuan per item)
prEditWrap.addEventListener('input', e => {
  const t = e.target;
  if (!t.matches('#pr-ed-pagu-total, .pr-ed-pagu-sec, .pr-ed-pagusat')) return;
  const digits = t.value.replace(/\D/g, '');
  t.value = digits ? Number(digits).toLocaleString('id-ID') : '';
});

document.getElementById('pr-edit-back-btn').addEventListener('click', () => { S.prStatusMsg.textContent = ''; prSetMode('active'); renderPrActiveView(); });

document.getElementById('pr-edit-save-btn').addEventListener('click', async () => {
  S.prStatusMsg.textContent = '';
  const changes = [];
  let invalid = null;
  prEditRows.querySelectorAll('.pr-edit-row').forEach(row => {
    const id = parseInt(row.dataset.id, 10);
    const orig = prEditOriginal.get(id);
    if (!orig) return;
    const nama = row.querySelector('.pr-ed-nama').value.trim();
    const qtyRaw = row.querySelector('.pr-ed-qty').value.trim();
    const qty = qtyRaw === '' ? null : parseInt(qtyRaw, 10);
    const paguSat = S.parsePaguValue(row.querySelector('.pr-ed-pagusat').value);
    if (!nama) { invalid = 'Nama item tidak boleh kosong.'; return; }
    if (qty !== null && (isNaN(qty) || qty < 1)) { invalid = `Qty "${orig.raw_text}" harus angka 1 atau lebih (atau kosongkan).`; return; }
    const fieldsChanged = nama !== orig.raw_text || qty !== (orig.qty_diminta ?? null);
    const paguSatChanged = paguSat !== orig.pagu_satuan;
    if (fieldsChanged || paguSatChanged) changes.push({ id, nama, qty, paguSat, fieldsChanged, paguSatChanged, orig });
  });
  if (invalid) { S.prStatusMsg.style.color = 'var(--danger)'; S.prStatusMsg.textContent = invalid; return; }

  // Pagu total & pagu per section
  const newTotal = S.parsePaguValue(prEdPaguTotal.value);
  const totalChanged = newTotal !== prEditOriginalPagu.total;
  const secChanges = [];
  prEdPaguSections.querySelectorAll('.pr-ed-pagu-sec').forEach(inp => {
    const id = parseInt(inp.dataset.sectionId, 10);
    const v = S.parsePaguValue(inp.value);
    if (prEditOriginalPagu.sections.has(id) && v !== prEditOriginalPagu.sections.get(id)) secChanges.push({ id, v });
  });

  if (!changes.length && !totalChanged && !secChanges.length) { S.prStatusMsg.style.color = 'var(--text-muted)'; S.prStatusMsg.textContent = 'Tidak ada perubahan.'; return; }

  const btn = document.getElementById('pr-edit-save-btn');
  btn.disabled = true; btn.textContent = 'Menyimpan…';
  const failed = [];
  const notes = [];
  let ok = 0;
  let paguOk = 0;

  // 1) Pagu total (permintaan_rs + sesi_konversi sekaligus, 1 RPC)
  if (totalChanged) {
    try {
      if (S.checklistPermintaanId == null) throw new Error('Permintaan RS belum termuat');
      if (S.currentSesiId) S.markLocalWrite(S.SESI_TABLE, S.currentSesiId, 'pagu', newTotal);
      await apiUpdatePermintaanPagu(S.checklistPermintaanId, newTotal);
      paguOk++;
    } catch (err) { failed.push(`Pagu total: ${err.message}`); }
  }
  // 2) Pagu per section (RPC yang sama dengan edit inline di tab Kebutuhan RS)
  for (const ch of secChanges) {
    const sec = S.checklistSections.find(s => s.id === ch.id);
    try {
      const { error } = await S.rpc('update_permintaan_section_pagu', { p_section_id: ch.id, p_pagu: ch.v });
      if (error) throw new Error(error.message || error.hint || 'error');
      paguOk++;
    } catch (err) { failed.push(`Pagu section ${sec ? sec.nama_section : ch.id}: ${err.message}`); }
  }
  // 3) Item: nama/qty (RPC lama) dan pagu satuan (RPC baru) — terpisah, jadi gagal salah satu gak nge-blok yang lain
  for (const ch of changes) {
    try {
      const item = S.checklistItems.find(i => i.id === ch.id);
      if (ch.fieldsChanged) {
        await apiUpdatePermintaanItem(ch.id, { raw_text: ch.nama, qty_diminta: ch.qty });
        if (item) {
          item.raw_text = ch.nama;
          item.qty_diminta = ch.qty;
          delete S.dictSuggestionCache[item.id]; // istilah berubah → saran Dictionary lama gak relevan
          const note = await cascadeQtyChange(item, ch.orig.qty_diminta, ch.qty);
          if (note) notes.push(note);
        }
      }
      if (ch.paguSatChanged) {
        await apiUpdatePermintaanItemPaguSatuan(ch.id, ch.paguSat);
        if (item) item.pagu_satuan = ch.paguSat;
      }
      ok++;
    } catch (err) {
      failed.push(`${ch.orig.raw_text}: ${err.message}`);
    }
  }
  btn.disabled = false; btn.textContent = 'Simpan perubahan';

  await S.loadChecklistForSesi(S.currentSesiId, { quiet: true }); // segarkan dari server (sumber kebenaran)
  // loadChecklistForSesi cuma menimpa checklistPagu kalau dari server != null, jadi pagu yang
  // sengaja dikosongkan perlu diset manual biar UI gak nyangkut di angka lama.
  if (totalChanged && !failed.some(m => m.startsWith('Pagu total'))) {
    S.checklistPagu = newTotal;
    if (typeof S.updateClipAggregates === 'function') S.updateClipAggregates();
    if (typeof S.renderChecklist === 'function') S.renderChecklist();
  }
  if (ok || paguOk) broadcastChecklistReload();
  if (failed.length) {
    S.prStatusMsg.style.color = 'var(--danger)';
    S.prStatusMsg.textContent = `${ok + paguOk} tersimpan, ${failed.length} gagal — ${failed.slice(0, 2).join('; ')}`;
    renderPrEditRows();
    return;
  }
  const parts = [];
  if (ok) parts.push(`${ok} item`);
  if (paguOk) parts.push(`${paguOk} pagu`);
  S.showToast(`${parts.join(' + ')} diperbarui`);
  if (notes.length) PNMToast.show(notes.join(' · '), 'presence', { duration: 6500 });
  prSetMode('active');
  renderPrActiveView();
});

// Qty Permintaan RS berubah → alokasi produk & qty clipboard ikut kalau (dan cuma kalau)
// alokasinya memang "mengikuti" permintaan: 1 produk dengan qty_alokasi == qty lama.
// Selain itu (multi-produk / alokasi sudah diatur manual) gak disentuh — dikasih tau, bukan ditebak.
async function cascadeQtyChange(item, oldQty, newQty) {
  if ((oldQty ?? null) === (newQty ?? null)) return '';
  const links = item.matched_items || [];
  if (item.status !== 'TERPENUHI' || !links.length) return '';
  const follows = links.length === 1 && newQty != null && links[0].qty_alokasi != null && Number(links[0].qty_alokasi) === Number(oldQty);
  if (!follows) return `Qty "${item.raw_text}" berubah, tapi alokasi produknya tidak ikut — cek ulang di Kebutuhan RS`;
  const newLinks = [{ ...links[0], qty_alokasi: newQty }];
  S.markLocalWrite(S.PERMINTAAN_ITEM_TABLE, item.id, 'status', 'TERPENUHI');
  await S.callUpdatePermintaanItemMulti(item.id, 'TERPENUHI', newLinks);
  const oldLinks = links;
  item.matched_items = newLinks;
  S.reconcileClipboardQty(item.id, oldLinks, newLinks);
  S.broadcastChecklistItemUpdated(item);
  return '';
}

// ══════════════════════════════════════════
// KEBUTUHAN RS: nempel di sidebar clipboard, bagian dari alur konversi yang sama.
// "Bisa Dipenuhi" itu penilaian tim marsup sendiri (bukan matching otomatis) —
// tujuannya cuma ngumpulin data insight (mana kebutuhan RS yang sering gak bisa
// kita penuhi), bukan proses konversi. Konversi produk tetap manual lewat search+clipboard.
// ══════════════════════════════════════════
S.checklistItems = [];       // [{id, raw_text, qty_diminta, status, section_id}]
S.checklistSections = [];    // [{id, nama_section, urutan, pagu}] — [] = belum ada section (Permintaan RS lama/single-sheet)
S.checklistNamaRs = '';
S.checklistSales = '';
S.checklistPagu = null;
S.checklistPermintaanId = null;
S.checklistTanggal = null; // dipakai buat nentuin folder tahun di Drive — diisi loadChecklistForSesi()
S.checklistPickingId = null; // id item yang lagi nampilin dropdown pilih produk (null = gak ada)
// Accordion master-detail: cuma SATU requirement yang "kebuka" nunjukin detail
// penuh dalam satu waktu, sisanya nyusut jadi baris ringkas — biar kerasa kayak
// fokus per-requirement, bukan 20-50 baris yang semuanya "berteriak" bareng.
S.checklistExpandedId = null;
// Abis 1 requirement diputusin (bisa/tidak), otomatis buka yang PENDING
// berikutnya — biar alur kerja "putusin, lanjut, putusin, lanjut" gak perlu
// klik cari-cari baris berikutnya manual tiap kali.
function advanceToNextPending(afterId) {
  const idx = S.checklistItems.findIndex(i => i.id === afterId);
  for (let i = idx + 1; i < S.checklistItems.length; i++) {
    if (S.checklistItems[i].status === 'PENDING') return S.checklistItems[i].id;
  }
  for (let i = 0; i < idx; i++) { // muter dari awal, jaga-jaga ada yang kelewat di atas
    if (S.checklistItems[i].status === 'PENDING') return S.checklistItems[i].id;
  }
  return null; // udah gak ada yang PENDING lagi
}
S.advanceToNextPending = advanceToNextPending;

// Fast-path "tandai TERPENUHI pakai 1 produk spesifik" — dipake bareng sama
// action 'use-suggestion' (produk udah ada di Clipboard) dan 'attach-suggestion'
// (produk baru aja ditambahin ke Clipboard). Satu titik biar dua jalur itu gak
// duplikasi logic konfirmasi status.
async function markItemTerpenuhiWithSingleProduk(item, kode) {
  const itemId = item.id;
  try {
    S.markLocalWrite(S.PERMINTAAN_ITEM_TABLE, itemId, 'status', 'TERPENUHI');
    // Qty mengikuti Permintaan RS (qty_diminta) — dulu selalu null, jadi qty clipboard
    // gak pernah ikut dan user harus ngisi qty dua kali. Qty diminta kosong/invalid → null
    // (qty clipboard dibiarkan apa adanya, gak dipaksa 1).
    const dq = Number(item.qty_diminta);
    const clipItem = S.clipboard.find(c => c.kode_produk === kode);
    const links = [{
      produk_id: clipItem && clipItem.produk_id != null ? clipItem.produk_id : null,
      kode_produk: kode,
      qty_alokasi: (!isNaN(dq) && dq >= 1) ? dq : null
    }];
    const oldLinks = item.matched_items || [];
    await S.callUpdatePermintaanItemMulti(itemId, 'TERPENUHI', links);
    item.status = 'TERPENUHI';
    item.matched_items = links;
    S.reconcileClipboardQty(itemId, oldLinks, links);
    S.checklistExpandedId = advanceToNextPending(itemId);
    S.renderChecklist();
    S.maybeFetchSuggestionForExpanded();
    S.broadcastChecklistItemUpdated(item);
    S.autoFinalizePermintaan();
  } catch (err) {
    S.showToast('Gagal update: ' + err.message, 'error');
    S.renderChecklist();
  }
}
S.markItemTerpenuhiWithSingleProduk = markItemTerpenuhiWithSingleProduk;


// ══════════════════════════════════════════════════════════════════════════
// CHECKLIST KEBUTUHAN RS (daftar item permintaan yang dicocokkan satu-satu ke produk):
// render checklist + tab section + rollup, picker produk, sinkron qty ke clipboard,
// auto-finalize permintaan. DIPINDAH dari dictionary.js (2026-10-27) — dulu numpang di sana karena
// waktu konversian.js dipecah, region ini gak punya file sendiri (map.md bagian 3 menaruhnya di
// permintaan-rs.js: section 18-19). Logic TIDAK diubah; cuma referensi ke hal yang masih tinggal di
// dictionary.js diganti jadi S.nama (S.dictSuggestionCache, S.renderDictSuggestionHtml,
// S.maybeFetchSuggestionForExpanded) + S.showConfirmModal/S.showSectionNameModal (modal generik).
// ══════════════════════════════════════════════════════════════════════════

function startChecklistSession(submitResult, namaRs, picSales, pagu, tanggal) {
  S.checklistItems = Array.isArray(submitResult.items) ? submitResult.items : [];
  S.checklistItems.forEach(it => { it.matched_items = normalizeMatchedItems(it); });
  S.checklistNamaRs = namaRs || '(tanpa nama RS)';
  S.checklistSales = picSales || '(tanpa nama sales)';
  S.checklistPagu = (pagu === undefined) ? null : pagu;
  S.checklistPermintaanId = submitResult.permintaan_id;
  // BUGFIX: dulu checklistTanggal gak pernah di-set di sini (cuma di-set di
  // loadChecklistForSesi buat sesi yang DIBUKA ULANG), jadi begitu Permintaan
  // RS BARU disubmit, tombol "Simpan ke Drive" langsung nganggep sesi ini
  // "belum ada Permintaan RS" walau permintaan_id-nya jelas keisi — soalnya
  // pengecekannya butuh checklistTanggal juga (lihat listener btnDriveUpload),
  // bukan cuma checklistPermintaanId. Sekarang diisi dari tanggal yang barusan
  // disubmit di form (prTanggal.value), fallback ke submitResult.tanggal kalau
  // RPC submit_permintaan_rs ternyata ikut mengembalikannya.
  S.checklistTanggal = tanggal || submitResult.tanggal || null;
  // Sama kayak loadChecklistForSesi: buka otomatis requirement PENDING pertama.
  const firstPending = S.checklistItems.find(i => i.status === 'PENDING');
  S.checklistExpandedId = firstPending ? firstPending.id : null;

  // Auto-isi Nama RS / Sales di clipboard, biar gak perlu diketik ulang —
  // ini satu sesi konversi yang sama, bukan dua langkah terpisah.
  if (namaRs) S.inpRs.value = namaRs;
  if (picSales) S.inpSales.value = picSales;
  S.updateClipboard();
  S.setClipHeaderCollapsed(true);

  S.kbSection.classList.remove('kb-collapsed');
  S.kbRecordStatus.textContent = 'Tingkat pemenuhan tersimpan otomatis tiap item ditandai.';
  S.kbRefreshStatus.textContent = '';
  renderChecklist();
  S.maybeFetchSuggestionForExpanded();
  S.switchClipTab('kb');

  // pastikan panel clipboard kelihatan (termasuk di mobile, yang defaultnya nampilin tab search)
  if (window.innerWidth <= 860 && typeof S.switchTab === 'function') S.switchTab('clip');
  S.clipTabRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
S.startChecklistSession = startChecklistSession;

// Daftar checkbox produk diambil dari clipboard sesi ini (bukan search baru) —
// karena konteksnya emang produk yang lagi diproses di sesi konversi yang sama.
// Satu kebutuhan sekarang boleh dicentang lebih dari satu SKU sekaligus (mis.
// "All Set Mata" -> Set Pacho + Cataract Minor Set), makanya checkbox bukan
// dropdown single-select lagi. Qty per-SKU opsional, dipakai kalau kebutuhan
// dipenuhi campuran beberapa varian dengan porsi qty berbeda.
function clipboardPickerHtml(itemId, matchedItems) {
  const rows = S.clipboard.map(c => {
    const link = (matchedItems || []).find(l => l.kode_produk === c.kode_produk);
    const checked = link ? ' checked' : '';
    const qtyVal = (link && link.qty_alokasi != null) ? link.qty_alokasi : '';
    // data-search dipake filter client-side di bawah — cocokin ke kode ATAU nama,
    // biar ketik "scalpel" nemu meski yang diinget cuma sebagian nama produknya.
    const haystack = `${c.kode_produk} ${c.nama_produk}`.toLowerCase();
    return `<label class="kb-picker-row" data-search="${S.escapeHtmlAttr(haystack)}">
      <input type="checkbox" data-picker-check="${itemId}" data-kode="${S.escapeHtmlAttr(c.kode_produk)}" data-produk-id="${c.produk_id||''}"${checked}>
      <span class="kb-picker-name">${S.escapeHtmlAttr(c.kode_produk)} — ${S.escapeHtmlAttr(c.nama_produk)}</span>
      <input type="number" min="0" class="kb-picker-qty" data-picker-qty="${itemId}" data-kode="${S.escapeHtmlAttr(c.kode_produk)}"
        placeholder="qty" value="${qtyVal}" style="${checked ? '' : 'display:none'}">
    </label>`;
  }).join('');
  // Quick-pick dari pool sesi ini (clipboard) itu jalur UTAMA — kebanyakan
  // komponen (scalpel, gunting, forcep) kepake berulang lintas banyak baris
  // kebutuhan dalam 1 sesi, jadi begitu udah pernah dicari sekali, baris-baris
  // lain tinggal klik, gak perlu ngetik ulang. Search box di sini cuma nyaring
  // pool yang UDAH ada (client-side, instan) — bukan search DB baru. Kalau
  // yang dicari beneran belum pernah muncul di sesi ini, tombol "Cari di
  // katalog" jadi jalan pintas ke search utama (bukan search kedua yang
  // duplikat) — biar gak ada 2 search engine keliatan beda tapi
  // sebenernya nyari hal yang sama.
  return `<div class="kb-picker-wrap">
    <input type="text" class="kb-picker-filter" data-filter-for="${itemId}"
      placeholder="Saring dari ${S.clipboard.length} produk yang udah kepake di sesi ini…" ${S.clipboard.length ? '' : 'disabled'}>
    <div class="kb-picker-list" data-picker-list="${itemId}">${rows}</div>
    <div class="kb-picker-empty" data-picker-empty="${itemId}" style="${S.clipboard.length ? 'display:none' : ''}">
      ${S.clipboard.length ? 'Gak ada yang cocok di pool sesi ini.' : 'Belum ada produk yang kepake di sesi ini.'}
      <button type="button" class="kb-picker-bridge" data-bridge-for="${itemId}">Cari di katalog →</button>
    </div>
  </div>`;
}

// Filter pool secara instan (client-side, sembunyi/tampil baris, BUKAN
// re-render/refetch) — didelegasikan dari kbList biar picker yang baru muncul
// abis re-render (expand item lain, dst) otomatis ikut kefilter juga.
S.kbList.addEventListener('input', e => {
  const filterInput = e.target.closest('.kb-picker-filter');
  if (!filterInput) return;
  const itemId = filterInput.dataset.filterFor;
  const list = S.kbList.querySelector(`.kb-picker-list[data-picker-list="${CSS.escape(itemId)}"]`);
  const emptyEl = S.kbList.querySelector(`.kb-picker-empty[data-picker-empty="${CSS.escape(itemId)}"]`);
  if (!list) return;
  const q = filterInput.value.trim().toLowerCase();
  let anyVisible = false;
  list.querySelectorAll('.kb-picker-row').forEach(row => {
    const match = !q || row.dataset.search.includes(q);
    row.style.display = match ? '' : 'none';
    if (match) anyVisible = true;
  });
  if (emptyEl) {
    emptyEl.style.display = anyVisible ? 'none' : '';
    const bridgeBtn = emptyEl.querySelector('.kb-picker-bridge');
    if (bridgeBtn) bridgeBtn.dataset.bridgeQuery = q;
  }
});

// Jalan pintas "Cari di katalog" — buka/fokusin search utama, prefill teks
// yang tadi diketik di filter picker, biar gak perlu ngetik query yang sama
// dua kali di dua tempat.
S.kbList.addEventListener('click', e => {
  const bridgeBtn = e.target.closest('.kb-picker-bridge');
  if (!bridgeBtn) return;
  const query = bridgeBtn.dataset.bridgeQuery
    || S.kbList.querySelector(`.kb-picker-filter[data-filter-for="${CSS.escape(bridgeBtn.dataset.bridgeFor)}"]`)?.value.trim()
    || '';
  if (S.panelSearchEl && S.panelSearchEl.classList.contains('collapsed')) S.setPanelSearchCollapsed(false, false);
  if (query) { S.searchInput.value = query; S.searchInput.dispatchEvent(new Event('input')); }
  S.searchInput.focus();
});

// Cari nama produk buat ditampilin di baris item yang udah TERPENUHI & ke-link
// ke suatu produk. Kalau produknya kebetulan udah gak ada di clipboard (misal
// dihapus lagi), tetep tampilin kode-nya aja tanpa nama.
function namaProdukByKode(kode) {
  const c = S.clipboard.find(c => c.kode_produk === kode);
  return c ? c.nama_produk : null;
}

function updateKbCounts() {
  const pending = S.checklistItems.filter(i => i.status === 'PENDING').length;
  const done = S.checklistItems.filter(i => i.status === 'TERPENUHI').length;
  const na = S.checklistItems.filter(i => i.status === 'TIDAK_TERPENUHI').length;
  S.kbTitle.textContent = 'Kebutuhan RS';
  S.kbCount.textContent = `${pending} belum dicek · ${done} bisa dipenuhi · ${na} tidak bisa`;
  S.updateKbTabState();
  S.updateClipSummaryStrip();
}

// Template satu baris Kebutuhan RS — dipakai render awal (renderChecklist) MAUPUN
// patch realtime (patchChecklistItem), biar markup-nya gak dobel definisi.
function renderChecklistItemHtml(item) {
  const isPending = item.status === 'PENDING';
  const isDone = item.status === 'TERPENUHI';
  const isNa = item.status === 'TIDAK_TERPENUHI';
  const isPicking = S.checklistPickingId === item.id;
  // Picker butuh ruang penuh buat checkbox-list-nya, jadi kalau lagi milih
  // produk, item ini otomatis kebuka juga — gak masuk akal ada picker di
  // dalam baris yang keciutin.
  const isExpanded = isPicking || S.checklistExpandedId === item.id;
  const cls = (isDone ? 'terpenuhi' : isNa ? 'tidak-terpenuhi' : '') + (isExpanded ? ' expanded' : ' collapsed');

  const qtyTxt = item.qty_diminta ? ` · qty ${item.qty_diminta}` : '';
  const paguTxt = item.pagu_satuan != null ? ` · pagu satuan ${S.rupiah(item.pagu_satuan)}` : '';

  // ---- Baris ringkas (selalu kelihatan, ini yang diklik buat buka/tutup) ----
  const statusIcon = isDone ? '<i class="ti ti-circle-check" style="color:var(--success)"></i>'
    : isNa ? '<i class="ti ti-circle-x" style="color:var(--danger)"></i>'
    : '<i class="ti ti-circle-dashed" style="color:var(--text-muted)"></i>';
  let compactMatchedTxt = '';
  if (isDone && item.matched_items && item.matched_items.length) {
    const first = item.matched_items[0];
    const namaFirst = namaProdukByKode(first.kode_produk) || first.kode_produk;
    const more = item.matched_items.length - 1;
    compactMatchedTxt = `<div class="kb-item-compact-matched">→ ${namaFirst}${more > 0 ? ` +${more} lainnya` : ''}</div>`;
  }
  // SECURITY FIX 2026-08-14: raw_text itu teks bebas hasil paste/OCR user
  // (Permintaan RS) yang disimpan ke DB & ditampilin ke semua kolaborator —
  // wajib di-escape sebelum masuk innerHTML (stored XSS fix).
  const headerHtml = `<div class="kb-item-header" data-action="toggle-expand" data-id="${item.id}">
    <span class="kb-item-status-icon">${statusIcon}</span>
    <div class="kb-item-header-text">
      <div class="kb-item-text">${S.escapeHtmlAttr(item.raw_text)}${qtyTxt}${paguTxt}</div>
      ${!isExpanded ? compactMatchedTxt : ''}
    </div>
    <i class="ti ti-chevron-down kb-item-chevron"></i>
  </div>`;

  // ---- Detail (cuma dirender kalau lagi expanded — hemat DOM buat 20-50 baris) ----
  let detailHtml = '';
  if (isExpanded) {
    let sub = '';
    if (isDone) sub = `✓ Bisa dipenuhi`;
    else if (isNa) sub = `✕ Tidak bisa dipenuhi`;

    let matchedHtml = '';
    if (isDone && item.matched_items && item.matched_items.length) {
      matchedHtml = `<div class="kb-item-matched">${item.matched_items.map(l => {
        const nama = namaProdukByKode(l.kode_produk);
        const qtyLineTxt = l.qty_alokasi != null ? ` · qty ${l.qty_alokasi}` : '';
        return `<span class="kb-matched-row">→ ${l.kode_produk}${nama ? ' — ' + nama : ''}${qtyLineTxt}</span>`;
      }).join('')}</div>`;
    }

    let bodyHtml;
    if (isPicking) {
      // Mode pilih produk: checkbox multi-select dari clipboard (bisa dicentang
      // lebih dari satu buat kebutuhan yang dipenuhi campuran beberapa SKU) +
      // Konfirmasi/Batal. Muncul baik dari klik "Bisa Dipenuhi" (item PENDING)
      // maupun dari klik "Ubah produk" (item yang udah TERPENUHI).
      bodyHtml = `
        <div class="kb-picker">
          ${clipboardPickerHtml(item.id, item.matched_items)}
          <div class="kb-picker-error" data-picker-error="${item.id}" style="display:none">Pilih minimal 1 produk dulu.</div>
          <div class="kb-picker-actions">
            <button class="kb-cancel-btn" data-action="pick-cancel" data-id="${item.id}">Batal</button>
            <button class="kb-confirm-btn" data-action="pick-confirm" data-id="${item.id}">Konfirmasi</button>
          </div>
        </div>`;
    } else if (isPending) {
      const sugg = S.dictSuggestionCache[item.id];
      const suggHtml = S.renderDictSuggestionHtml(item, sugg);
      bodyHtml = `
        ${suggHtml}
        <div class="kb-item-actions">
          <button class="kb-bisa-btn" data-action="bisa" data-id="${item.id}">✓ Bisa Dipenuhi</button>
          <button class="kb-tidak-btn" data-action="tidak" data-id="${item.id}">✕ Tidak Bisa</button>
        </div>`;
    } else {
      // Sudah dikonfirmasi (TERPENUHI/TIDAK_TERPENUHI): status kekunci, tapi
      // tetep bisa diubah/dibatalkan lewat dua link kecil ini.
      bodyHtml = `
        <div class="kb-item-links">
          ${isDone ? `<a data-action="change" data-id="${item.id}">Ubah produk</a>` : ''}
          <a class="kb-batal-link" data-action="undo" data-id="${item.id}">Batal</a>
        </div>`;
    }

    detailHtml = `<div class="kb-item-detail">
      ${sub ? `<div class="kb-item-sub">${sub}</div>` : ''}
      ${matchedHtml}
      ${bodyHtml}
    </div>`;
  }

  return `<div class="kb-item ${cls}" data-id="${item.id}" draggable="true">
    ${headerHtml}
    ${detailHtml}
  </div>`;
}

// Harga satu baris kebutuhan = jumlah (harga_ekat produk × qty_alokasi) dari
// semua matched_items-nya. Lookup harga lewat clipboard (harga_ekat = source
// of truth, sama kayak dipakai di updateClipAggregates). Kalau produk match
// udah gak ada di clipboard sesi ini (kepencet hapus dsb), baris itu gak ikut
// disenilai — floor aman, gak bikin summary keliatan lebih murah dari nyatanya
// (mending "belum kehitung" daripada 0 yang bisa disalahartikan tuntas).
function hargaKebutuhan(item) {
  if (!item.matched_items || !item.matched_items.length) return { harga: 0, complete: item.status !== 'TERPENUHI' };
  let harga = 0, complete = true;
  item.matched_items.forEach(l => {
    const c = S.clipboard.find(c => (l.produk_id != null && c.produk_id != null) ? c.produk_id === l.produk_id : c.kode_produk === l.kode_produk);
    if (!c || c.harga_ekat == null) { complete = false; return; }
    harga += Number(c.harga_ekat) * Number(l.qty_alokasi || 1);
  });
  return { harga, complete };
}

// Rollup 1 section (atau grup "Tanpa section"): pagu vs total harga item
// yang matched di section itu, plus progress pemenuhan.
function computeSectionRollup(items, pagu) {
  let harga = 0, anyIncomplete = false;
  const done = items.filter(i => i.status === 'TERPENUHI').length;
  items.forEach(it => {
    if (it.status !== 'TERPENUHI') return;
    const h = hargaKebutuhan(it);
    harga += h.harga;
    if (!h.complete) anyIncomplete = true;
  });
  return {
    done, total: items.length, harga,
    pagu: pagu != null ? Number(pagu) : null,
    selisih: pagu != null ? Number(pagu) - harga : null,
    anyIncomplete
  };
}

function kbRollupHtml(r, size) {
  const cls = size === 'sm' ? 'kb-section-rollup' : 'kb-global-rollup';
  const selisihCls = r.selisih == null ? '' : (r.selisih >= 0 ? 'positif' : 'negatif');
  return `<div class="${cls}">
    <span>${r.done}/${r.total} terpenuhi</span>
    <span>${S.rupiah(r.harga)}${r.anyIncomplete ? '<i class="ti ti-alert-triangle" title="Ada produk match yang harganya belum kehitung (cek clipboard)"></i>' : ''}</span>
    ${r.pagu != null ? `<span>pagu ${S.rupiah(r.pagu)}</span><span class="kb-selisih ${selisihCls}">${r.selisih >= 0 ? 'sisa ' : 'lebih '}${S.rupiah(Math.abs(r.selisih))}</span>` : ''}
  </div>`;
}

// Section = tab sheet Excel: 1 aktif keliatan penuh dalam satu waktu (persis
// kayak buka 1 sheet), bukan semua digelar sekaligus grid — biar interaksinya
// kerasa kayak Sheets (klik tab ganti konteks), bukan cuma datanya doang yang
// section-aware. "Semua" = tab semu, nampilin rekap tiap section berurutan
// (dipake juga sebagai satu-satunya tampilan kalau belum ada section sama
// sekali, fallback lama tetap jalan).
S.activeSectionTab = null; // null = "Semua"; angka = id permintaan_section

function renderSectionTabs() {
  // Dulu: kalau belum ada section sama sekali, tab bar (termasuk tombol "+")
  // ikut disembunyiin — bug, bikin gak ada cara mulai bikin section pertama
  // dari UI. Sekarang: selalu tampil begitu ada Permintaan RS aktif ("Semua"
  // + "+" minimal selalu ada), biar bisa bootstrap section pertama kapan pun.
  if (!S.checklistPermintaanId) { S.kbSectionTabs.style.display = 'none'; return; }
  S.kbSectionTabs.style.display = 'flex';
  const countBySection = new Map(S.checklistSections.map(s => [s.id, 0]));
  countBySection.set(null, 0);
  S.checklistItems.forEach(it => {
    const key = countBySection.has(it.section_id) ? it.section_id : null;
    countBySection.set(key, (countBySection.get(key) || 0) + 1);
  });
  const orphanCount = countBySection.get(null) || 0;

  const tabs = [`<button type="button" class="kb-tab ${S.activeSectionTab === null ? 'active' : ''}" data-tab="semua">Semua</button>`];
  tabs.push(...S.checklistSections.map(s => `<button type="button" class="kb-tab ${S.activeSectionTab === s.id ? 'active' : ''}"
      draggable="true" data-tab="${s.id}" title="Klik: buka. Dobel-klik: rename. Drag: urutin atau pindahin baris ke sini.">
    ${S.escapeHtmlAttr(s.nama_section)} <span class="kb-tab-count">${countBySection.get(s.id) || 0}</span>
    <span class="kb-tab-delete" data-delete-section="${s.id}" title="Hapus section (baris di dalamnya pindah ke Tanpa section, gak ikut kehapus)"><i class="ti ti-x"></i></span>
  </button>`));
  if (orphanCount) tabs.push(`<button type="button" class="kb-tab ${S.activeSectionTab === 'orphan' ? 'active' : ''}" data-tab="orphan">Tanpa section <span class="kb-tab-count">${orphanCount}</span></button>`);
  tabs.push(`<button type="button" class="kb-tab kb-tab-add" data-tab="add" title="Tambah section"><i class="ti ti-plus"></i></button>`);
  S.kbSectionTabs.innerHTML = tabs.join('');
}

S.kbSectionTabs.addEventListener('click', async e => {
  const deleteBtn = e.target.closest('.kb-tab-delete');
  if (deleteBtn) {
    const sectionId = Number(deleteBtn.dataset.deleteSection);
    const section = S.checklistSections.find(s => s.id === sectionId);
    if (!section) return;
    const itemCount = S.checklistItems.filter(i => i.section_id === sectionId).length;
    const ok = await S.showConfirmModal({
      title: `Hapus section "${section.nama_section}"?`,
      text: itemCount
        ? `${itemCount} baris di dalamnya bakal pindah ke "Tanpa section" (baris-nya sendiri gak ikut kehapus).`
        : 'Section ini belum ada isinya.',
      okText: 'Ya, Hapus',
      danger: true
    });
    if (!ok) return;
    const { error } = await S.rpc('delete_permintaan_section', { p_section_id: sectionId });
    if (error) { PNMToast.error('Gagal hapus section: ' + (error.message || 'error')); return; }
    S.checklistSections = S.checklistSections.filter(s => s.id !== sectionId);
    S.checklistItems.forEach(it => { if (it.section_id === sectionId) it.section_id = null; });
    if (S.activeSectionTab === sectionId) S.activeSectionTab = null; // section yang lagi dibuka kehapus → balik ke "Semua"
    renderChecklist();
    return;
  }
  const btn = e.target.closest('.kb-tab');
  if (!btn) return;
  const tab = btn.dataset.tab;
  if (tab === 'add') {
    const nama = await S.showSectionNameModal({
      mode: 'add',
      existingNames: S.checklistSections.map(s => s.nama_section)
    });
    if (!nama) return;
    const { data, error } = await S.rpc('add_permintaan_section', { p_permintaan_id: S.checklistPermintaanId, p_nama_section: nama });
    if (error) { PNMToast.error('Gagal nambah section: ' + (error.message || 'error')); return; }
    const row = Array.isArray(data) ? data[0] : data;
    S.checklistSections.push(row);
    S.activeSectionTab = row.id;
    renderChecklist();
    return;
  }
  S.activeSectionTab = tab === 'semua' ? null : (tab === 'orphan' ? 'orphan' : Number(tab));
  renderChecklist();
});

S.kbSectionTabs.addEventListener('dblclick', async e => {
  const btn = e.target.closest('.kb-tab');
  if (!btn || !/^\d+$/.test(btn.dataset.tab)) return; // cuma section beneran, bukan Semua/Tanpa section/+
  const section = S.checklistSections.find(s => s.id === Number(btn.dataset.tab));
  if (!section) return;
  const nama = await S.showSectionNameModal({
    mode: 'rename',
    initialValue: section.nama_section,
    existingNames: S.checklistSections.map(s => s.nama_section)
  });
  if (!nama || nama === section.nama_section) return;
  const { error } = await S.rpc('rename_permintaan_section', { p_section_id: section.id, p_nama_section: nama });
  if (error) { PNMToast.error('Gagal rename: ' + (error.message || 'error')); return; }
  section.nama_section = nama;
  renderChecklist();
});

// --- Drag & drop: reorder tab (tab-ke-tab) ATAU pindahin baris kebutuhan ke
// section lain (kb-item-ke-tab). Dibedain dari isi dataTransfer di dragstart. ---
let dragPayload = null; // {type:'tab', id} | {type:'item', id}

S.kbSectionTabs.addEventListener('dragstart', e => {
  if (e.target.closest('.kb-tab-delete')) { e.preventDefault(); return; } // klik "×" gak boleh ke-trigger jadi drag tab
  const tabBtn = e.target.closest('.kb-tab[data-tab]');
  if (tabBtn && /^\d+$/.test(tabBtn.dataset.tab)) {
    dragPayload = { type: 'tab', id: Number(tabBtn.dataset.tab) };
    tabBtn.classList.add('dragging');
  }
});
S.kbSectionTabs.addEventListener('dragend', e => {
  e.target.closest('.kb-tab')?.classList.remove('dragging');
});
S.kbSectionTabs.addEventListener('dragover', e => {
  const tabBtn = e.target.closest('.kb-tab[data-tab]');
  if (!tabBtn || !dragPayload) return;
  const targetIsSection = /^\d+$/.test(tabBtn.dataset.tab);
  if (!targetIsSection) return; // gak bisa drop ke Semua/+/Tanpa section
  e.preventDefault();
  tabBtn.classList.add('drop-target');
});
S.kbSectionTabs.addEventListener('dragleave', e => {
  e.target.closest('.kb-tab')?.classList.remove('drop-target');
});
S.kbSectionTabs.addEventListener('drop', async e => {
  const tabBtn = e.target.closest('.kb-tab[data-tab]');
  S.kbSectionTabs.querySelectorAll('.drop-target').forEach(n => n.classList.remove('drop-target'));
  if (!tabBtn || !dragPayload || !/^\d+$/.test(tabBtn.dataset.tab)) { dragPayload = null; return; }
  e.preventDefault();
  const targetSectionId = Number(tabBtn.dataset.tab);

  if (dragPayload.type === 'item') {
    const item = S.checklistItems.find(i => i.id === dragPayload.id);
    if (item && item.section_id !== targetSectionId) {
      item.section_id = targetSectionId; // optimistic
      renderChecklist();
      const { error } = await S.rpc('move_permintaan_item_section', { p_item_id: dragPayload.id, p_section_id: targetSectionId });
      if (error) PNMToast.error('Gagal pindahin baris: ' + (error.message || 'error'));
    }
  } else if (dragPayload.type === 'tab' && dragPayload.id !== targetSectionId) {
    const fromIdx = S.checklistSections.findIndex(s => s.id === dragPayload.id);
    const toIdx = S.checklistSections.findIndex(s => s.id === targetSectionId);
    if (fromIdx > -1 && toIdx > -1) {
      const [moved] = S.checklistSections.splice(fromIdx, 1);
      S.checklistSections.splice(toIdx, 0, moved);
      renderSectionTabs();
      const { error } = await S.rpc('reorder_permintaan_sections', {
        p_permintaan_id: S.checklistPermintaanId,
        p_ordered_ids: S.checklistSections.map(s => s.id)
      });
      if (error) PNMToast.error('Gagal urutin section: ' + (error.message || 'error'));
    }
  }
  dragPayload = null;
});

// kb-item juga bisa di-drag (draggable="true" di renderChecklistItemHtml) buat
// di-drop ke salah satu tab section — didelegasikan dari kbList, bukan per-node,
// biar kb-item yang baru muncul abis re-render otomatis ikut bisa didrag juga.
S.kbList.addEventListener('dragstart', e => {
  const itemEl = e.target.closest('.kb-item[data-id]');
  if (!itemEl || !S.checklistSections.length) return; // drag antar-section gak relevan kalau belum ada section
  dragPayload = { type: 'item', id: Number(itemEl.dataset.id) };
});

function renderChecklist() {
  updateKbCounts();
  renderSectionTabs();

  const globalPagu = S.checklistSections.length
    ? S.checklistSections.reduce((s, sec) => s + (sec.pagu != null ? Number(sec.pagu) : 0), 0) || null
    : S.checklistPagu;
  const globalRollup = computeSectionRollup(S.checklistItems, globalPagu);

  // SECURITY FIX 2026-08-14: checklistNamaRs juga free-text, escape dulu.
  S.kbSummary.innerHTML = `
    <div class="kb-summary-row"><span>Nama RS</span><b>${S.escapeHtmlAttr(S.checklistNamaRs || '-')}</b></div>
    ${kbRollupHtml(globalRollup, 'lg')}
  `;

  if (!S.checklistSections.length) {
    // Belum ada section (Permintaan RS single-sheet, atau RPC belum di-update
    // buat ngirim field sections) — tampilin flat kayak sebelumnya, gak ada regresi.
    S.kbList.innerHTML = S.checklistItems.map(renderChecklistItemHtml).join('');
    return;
  }

  const bySection = new Map(S.checklistSections.map(s => [s.id, []]));
  bySection.set(null, []); // item tanpa section_id (mis. ditambah manual di luar import)
  S.checklistItems.forEach(it => {
    const key = bySection.has(it.section_id) ? it.section_id : null;
    bySection.get(key).push(it);
  });

  if (S.activeSectionTab === null) {
    // Tab "Semua": rekap tiap section berurutan, kayak scroll ngeliatin semua
    // sheet sekilas — buat overview, bukan tempat kerja detail (itu di tab masing-masing).
    const groups = S.checklistSections.map(s => ({ section: s, items: bySection.get(s.id) }));
    if (bySection.get(null).length) groups.push({ section: null, items: bySection.get(null) });
    S.kbList.innerHTML = groups.map(g => {
      if (!g.items.length) return '';
      const rollup = computeSectionRollup(g.items, g.section ? g.section.pagu : null);
      const title = g.section ? S.escapeHtmlAttr(g.section.nama_section) : 'Tanpa section';
      return `<div class="kb-section-group" data-section-id="${g.section ? g.section.id : 'null'}">
        <div class="kb-section-header">
          <span class="kb-section-title">${title}</span>
          ${kbRollupHtml(rollup, 'sm')}
        </div>
        <div class="kb-section-items">${g.items.map(renderChecklistItemHtml).join('')}</div>
      </div>`;
    }).join('');
    return;
  }

  // Tab section spesifik (atau "orphan"): cuma nampilin baris section itu,
  // full-width, kayak buka 1 sheet doang — ini "tempat kerja"-nya.
  const items = S.activeSectionTab === 'orphan' ? bySection.get(null) : (bySection.get(S.activeSectionTab) || []);
  const section = S.activeSectionTab === 'orphan' ? null : S.checklistSections.find(s => s.id === S.activeSectionTab);
  const rollup = computeSectionRollup(items, section ? section.pagu : null);
  // formatRibuan: "90000000" → "90.000.000" — dipake buat nilai awal input DAN
  // live-reformat pas ngetik (listener 'input' di bawah), biar gampang keliatan
  // salah nol tanpa nunggu blur/submit dulu buat sadar.
  const paguRow = section
    ? `<div class="kb-section-pagu-row">Pagu section: <input type="text" inputmode="numeric" id="kb-section-pagu-input" data-section-id="${section.id}"
         value="${section.pagu != null ? formatRibuan(section.pagu) : ''}" placeholder="belum diisi"></div>`
    : '';
  S.kbList.innerHTML = `<div class="kb-active-section-head">
      ${kbRollupHtml(rollup, 'sm')}
      ${paguRow}
    </div>
    ${items.length ? items.map(renderChecklistItemHtml).join('') : '<div class="kb-section-empty">Belum ada baris di section ini. Drag baris dari tab lain ke sini, atau tambah lewat Permintaan RS.</div>'}`;
}
S.renderChecklist = renderChecklist;

function formatRibuan(numOrStr) {
  const digits = String(numOrStr).replace(/[^\d]/g, '');
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

// Live-reformat sambil ngetik — strip semua non-digit, pasang titik ribuan
// ulang, taro kursor di akhir. Simpel (gak pertahanin posisi kursor persis di
// tengah angka), tapi buat input angka pendek kayak pagu ini cukup nyaman.
S.kbList.addEventListener('input', e => {
  const input = e.target.closest('#kb-section-pagu-input');
  if (!input) return;
  const formatted = formatRibuan(input.value);
  if (formatted !== input.value) input.value = formatted;
});

// Edit pagu section langsung dari tab yang lagi aktif (bukan modal terpisah).
S.kbList.addEventListener('change', async e => {
  const input = e.target.closest('#kb-section-pagu-input');
  if (!input) return;
  const raw = input.value.replace(/[^\d]/g, '');
  const pagu = raw ? Number(raw) : null;
  const sectionId = Number(input.dataset.sectionId);
  const section = S.checklistSections.find(s => s.id === sectionId);
  if (!section) return;
  section.pagu = pagu; // optimistic
  input.value = pagu != null ? formatRibuan(pagu) : ''; // normalisasi tampilan (jaga-jaga ada titik nyasar dari paste manual)
  refreshRollupHeadersOnly();
  const { error } = await S.rpc('update_permintaan_section_pagu', { p_section_id: sectionId, p_pagu: pagu });
  if (error) PNMToast.error('Gagal simpan pagu: ' + (error.message || 'error'));
});

// ---- Patch granular buat 1 item Kebutuhan RS (dipakai realtime UPDATE dari
// kolaborator lain) — gak nge-rebuild seluruh daftar kayak renderChecklist(). ----
function patchChecklistItem(id, changes) {
  const item = S.checklistItems.find(i => i.id === id);
  if (!item) return;
  if (S.checklistPickingId === id) return; // lagi dipilihin produknya sama user lokal, jangan diganggu dulu
  Object.assign(item, changes);
  updateKbCounts();
  const node = S.kbList.querySelector(`.kb-item[data-id="${CSS.escape(String(id))}"]`);
  if (node) {
    const temp = document.createElement('div');
    temp.innerHTML = renderChecklistItemHtml(item);
    const newNode = temp.firstElementChild;
    newNode.classList.add('rt-pulse');
    node.replaceWith(newNode);
    // Status/matched_items item ini ganti → rollup section-nya (dan rollup
    // global di kbSummary) kemungkinan besar ikut geser. Re-render header aja
    // (bukan renderChecklist() penuh) biar gak ngerender ulang semua baris.
    refreshRollupHeadersOnly();
  } else {
    renderChecklist(); // fallback aman kalau node-nya gak ketemu (harusnya jarang)
  }
}
S.patchChecklistItem = patchChecklistItem;

// Update angka-angka rollup (kbSummary + tiap kb-section-header) tanpa
// nyentuh/re-render baris kb-item satu pun — dipanggil abis patchChecklistItem
// atau abis clipboard berubah (harga produk match bisa geser rollup walau
// status item-nya sendiri gak berubah).
function refreshRollupHeadersOnly() {
  const globalPagu = S.checklistSections.length
    ? S.checklistSections.reduce((s, sec) => s + (sec.pagu != null ? Number(sec.pagu) : 0), 0) || null
    : S.checklistPagu;
  const globalRollupNode = S.kbSummary.querySelector('.kb-global-rollup');
  if (globalRollupNode) {
    const temp = document.createElement('div');
    temp.innerHTML = kbRollupHtml(computeSectionRollup(S.checklistItems, globalPagu), 'lg');
    globalRollupNode.replaceWith(temp.firstElementChild);
  }
  if (!S.checklistSections.length) return;
  const bySection = new Map(S.checklistSections.map(s => [s.id, []]));
  bySection.set(null, []);
  S.checklistItems.forEach(it => {
    const key = bySection.has(it.section_id) ? it.section_id : null;
    bySection.get(key).push(it);
  });

  if (S.activeSectionTab !== null) {
    // Tab section spesifik aktif: cuma 1 rollup node (.kb-active-section-head), bukan .kb-section-group.
    const items = S.activeSectionTab === 'orphan' ? bySection.get(null) : (bySection.get(S.activeSectionTab) || []);
    const section = S.activeSectionTab === 'orphan' ? null : S.checklistSections.find(s => s.id === S.activeSectionTab);
    const rollupNode = S.kbList.querySelector('.kb-active-section-head .kb-section-rollup');
    if (rollupNode) {
      const temp = document.createElement('div');
      temp.innerHTML = kbRollupHtml(computeSectionRollup(items, section ? section.pagu : null), 'sm');
      rollupNode.replaceWith(temp.firstElementChild);
    }
    return;
  }
  S.kbList.querySelectorAll('.kb-section-group').forEach(groupEl => {
    const idAttr = groupEl.dataset.sectionId;
    const g = idAttr === 'null' ? null : S.checklistSections.find(s => String(s.id) === idAttr);
    const items = g ? bySection.get(g.id) : bySection.get(null);
    if (!items) return;
    const rollupNode = groupEl.querySelector('.kb-section-rollup');
    if (!rollupNode) return;
    const temp = document.createElement('div');
    temp.innerHTML = kbRollupHtml(computeSectionRollup(items, g ? g.pagu : null), 'sm');
    rollupNode.replaceWith(temp.firstElementChild);
  });
}
S.refreshRollupHeadersOnly = refreshRollupHeadersOnly;



// Total qty_alokasi dari SEMUA item Kebutuhan RS yang match ke produk yang sama
// (by produk_id kalau ada, fallback ke kode_produk) — dipake buat sinkronin qty
// clipboard biar akurat kalau >1 item Permintaan RS dipenuhi dari produk yang
// sama persis (harus DIJUMLAH, bukan ketimpa sama yang terakhir dikonfirm).
// `override` opsional: {itemId, links} — dipake pas lagi proses konfirmasi
// picker, sebelum item.matched_items-nya sendiri kesimpen.
function sumQtyAlokasiForProduk(produkId, kode, override) {
  let total = 0;
  let hasAny = false;
  S.checklistItems.forEach(it => {
    const list = (override && override.itemId === it.id) ? override.links : (it.matched_items || []);
    (list || []).forEach(l => {
      const sameProduk = (produkId != null && l.produk_id != null) ? l.produk_id === produkId : l.kode_produk === kode;
      if (!sameProduk) return;
      if (l.qty_alokasi == null || isNaN(l.qty_alokasi) || l.qty_alokasi < 1) return;
      total += Number(l.qty_alokasi);
      hasAny = true;
    });
  });
  return hasAny ? total : null;
}

// Sinkronin qty item clipboard ke total qty_alokasi teragregasi (lihat fungsi
// di atas). Balikin true kalau qty-nya berubah (biar caller tau perlu re-render).
function syncClipboardQtyForProduk(produkId, kode, override) {
  const clipItem = S.clipboard.find(c => c.kode_produk === kode);
  if (!clipItem) return false;
  const total = sumQtyAlokasiForProduk(produkId, kode, override);
  if (total != null && clipItem.qty !== total) {
    clipItem.qty = total;
    S.persistUpdateQty(clipItem);
    return true;
  }
  return false;
}

// DIPULIHKAN 2026-10-26: dua fungsi ini ikut kehapus waktu dictionary.js ditulis ulang di commit
// c4cfe6a ("inline dictionary yang lebih baik"), padahal masih dipanggil dari permintaan-rs.js
// (markItemTerpenuhiWithSingleProduk / cascadeQtyChange) dan clipboard.js (badge "RS n").
// Akibatnya "Pakai"/"Tambah & Pakai" dari saran Dictionary gagal di S.reconcileClipboardQty
// (undefined) SETELAH server sukses -> qty clipboard gak ikut qty permintaan + toast "Gagal update".
S.sumQtyAlokasiForProduk = sumQtyAlokasiForProduk;
// Qty "sesuai Permintaan RS" untuk satu item clipboard (null = gak ada alokasi RS).
function rsQtyForClipItem(clipItem) {
  if (!clipItem || !S.checklistPermintaanId) return null;
  return sumQtyAlokasiForProduk(clipItem.produk_id != null ? clipItem.produk_id : null, clipItem.kode_produk);
}
S.rsQtyForClipItem = rsQtyForClipItem;

// SATU titik yang nyambungin perubahan alokasi RS → qty clipboard. Dipakai semua
// jalur (konfirmasi picker, Pakai/Tambah&Pakai, Tidak Bisa, Batal, edit qty RS).
// Dipanggil SETELAH server sukses, dengan link SEBELUM & SESUDAH untuk item itu.
//
// Aturan qty clipboard (source of truth = Permintaan RS, override manual dihormati):
//  - total RS baru ada, dan qty clipboard MASIH mengikuti RS (== total lama, atau
//    belum pernah ada alokasi) → qty clipboard diset ke total RS baru.
//  - qty clipboard BEDA dari total RS lama → itu override manual user: JANGAN
//    ditimpa. Badge "manual · RS n" di baris clipboard yang nunjukin selisihnya.
//  - total RS baru gak ada (alokasi dicabut) → qty clipboard dibiarkan, gak di-reset.
function reconcileClipboardQty(itemId, oldLinks, newLinks) {
  const seen = new Set();
  const notes = [];
  let changed = false;
  [...(oldLinks || []), ...(newLinks || [])].forEach(l => {
    const key = l.produk_id != null ? 'id:' + l.produk_id : 'kode:' + l.kode_produk;
    if (seen.has(key)) return;
    seen.add(key);
    const clipItem = S.clipboard.find(c => c.kode_produk === l.kode_produk);
    if (!clipItem) return;
    const prev = sumQtyAlokasiForProduk(l.produk_id, l.kode_produk, { itemId, links: oldLinks || [] });
    const next = sumQtyAlokasiForProduk(l.produk_id, l.kode_produk, { itemId, links: newLinks || [] });
    if (next == null || clipItem.qty === next) return;
    const followsRs = prev == null || clipItem.qty === prev;
    if (!followsRs) {
      notes.push(`Qty ${l.kode_produk} tetap ${clipItem.qty} (diubah manual) — Permintaan RS: ${next}`);
      return;
    }
    const before = clipItem.qty;
    clipItem.qty = next;
    if (clipItem._sesiItemId) S.markLocalWrite(S.SESI_ITEM_TABLE, clipItem._sesiItemId, 'qty', clipItem.qty);
    S.persistUpdateQty(clipItem);
    changed = true;
    if (before !== 1 && prev == null) notes.push(`Qty ${l.kode_produk}: ${before} → ${next} (mengikuti Permintaan RS)`);
  });
  S.updateClipboard(); // selalu: badge "RS n" di baris clipboard harus ikut segar
  if (notes.length) PNMToast.show(notes.join(' · '), 'presence', { duration: 6000 });
  return changed;
}
S.reconcileClipboardQty = reconcileClipboardQty;

S.kbList.addEventListener('click', async (e) => {
  const link = e.target.closest('a[data-action]');
  const btn = e.target.closest('button[data-action]');
  const header = e.target.closest('.kb-item-header[data-action]');
  const el = link || btn || header;
  if (!el) return;
  const itemId = parseInt(el.dataset.id, 10);
  const action = el.dataset.action;
  const item = S.checklistItems.find(i => i.id === itemId);
  if (!item) return;

  if (action === 'toggle-expand') {
    // Kalau lagi milih produk (picker kebuka), jangan biarin ke-collapse cuma
    // gara-gara klik header-nya sendiri — user harus Batal/Konfirmasi dulu.
    if (S.checklistPickingId === itemId) return;
    S.checklistExpandedId = (S.checklistExpandedId === itemId) ? null : itemId;
    renderChecklist();
    S.maybeFetchSuggestionForExpanded();
    return;
  }

  if (action === 'use-suggestion') {
    // Fast-path dari saran Dictionary: langsung tandai TERPENUHI pakai produk
    // yang disaranin, TANPA buka picker — cuma valid kalau produknya emang
    // udah ada di Clipboard sesi ini (dicek dobel di sini, bukan cuma percaya
    // tombolnya beneran ke-render dengan benar).
    const kode = el.dataset.kode;
    if (!S.clipboard.some(c => c.kode_produk === kode)) return;
    btn.disabled = true;
    await S.markItemTerpenuhiWithSingleProduk(item, kode);
    return;
  }

  if (action === 'attach-suggestion') {
    // Sama kayak "Pakai", tapi produknya belum ada di Clipboard — tambahin dulu
    // (reuse addSetKodeToClip yang udah dipakai tab Cari SET buat kasus yang
    // sama persis: cari exact by kode_produk, masukin ke lastResults, addToClip
    // — fungsi itu juga yang ngurus disabled/text state tombolnya sendiri),
    // baru abis itu jalanin fast-path yang sama kayak "Pakai".
    const kode = el.dataset.kode;
    await S.addSetKodeToClip(kode, btn);
    if (!S.clipboard.some(c => c.kode_produk === kode)) return; // gagal, addSetKodeToClip udah nampilin toast errornya
    await S.markItemTerpenuhiWithSingleProduk(item, kode);
    return;
  }

  if (action === 'bisa' || action === 'change') {
    // Buka mode pilih produk, belum manggil API sama sekali.
    S.checklistPickingId = itemId;
    S.checklistExpandedId = itemId;
    renderChecklist();
    return;
  }

  if (action === 'pick-cancel') {
    S.checklistPickingId = null;
    renderChecklist();
    return;
  }

  if (action === 'pick-confirm') {
    // Kumpulin semua checkbox yang dicentang buat item ini -> jadi array link.
    const checks = S.kbList.querySelectorAll(`input[data-picker-check="${itemId}"]:checked`);
    if (checks.length === 0) {
      const errEl = S.kbList.querySelector(`[data-picker-error="${itemId}"]`);
      if (errEl) errEl.style.display = 'block';
      return;
    }
    const links = Array.from(checks).map(chk => {
      const kode = chk.dataset.kode;
      const produkId = chk.dataset.produkId ? parseInt(chk.dataset.produkId, 10) : null;
      const qtyInput = S.kbList.querySelector(`input[data-picker-qty="${itemId}"][data-kode="${CSS.escape(kode)}"]`);
      const qtyVal = qtyInput && qtyInput.value.trim() ? Number(qtyInput.value) : null;
      return { produk_id: produkId, kode_produk: kode, qty_alokasi: qtyVal };
    });

    // Kalau qty_alokasi diisi di picker Kebutuhan RS, ikutin ke qty item clipboard
    // yang sama — biar user gak perlu isi qty dua kali (di clipboard & di sini).
    // Kalau ada >1 item Permintaan RS yang dipenuhi dari produk yang sama, qty-nya
    // DIJUMLAH (bukan ketimpa sama yang terakhir dikonfirm) — agregasi per produk
    // (produk_id kalau ada, fallback kode_produk), lewat sumQtyAlokasiForProduk().
    // Kalau qty_alokasi dikosongin, qty clipboard dibiarin apa adanya (gak di-reset).
    let clipQtyChanged = false;
    const touchedProduk = new Set();
    links.forEach(l => {
      if (l.qty_alokasi == null || isNaN(l.qty_alokasi) || l.qty_alokasi < 1) return;
      const key = l.produk_id != null ? 'id:' + l.produk_id : 'kode:' + l.kode_produk;
      if (touchedProduk.has(key)) return; // 2 checkbox beda tapi produk sama (jarang) — cukup dihitung sekali
      touchedProduk.add(key);
      if (syncClipboardQtyForProduk(l.produk_id, l.kode_produk, { itemId, links })) clipQtyChanged = true;
    });
    if (clipQtyChanged) S.updateClipboard();

    btn.disabled = true;
    try {
      S.markLocalWrite(S.PERMINTAAN_ITEM_TABLE, itemId, 'status', 'TERPENUHI');
      await callUpdatePermintaanItemMulti(itemId, 'TERPENUHI', links);
      item.status = 'TERPENUHI';
      item.matched_items = links;
      S.checklistPickingId = null;
      S.checklistExpandedId = S.advanceToNextPending(itemId); // langsung buka yang PENDING berikutnya
      renderChecklist();
      S.maybeFetchSuggestionForExpanded();
      S.broadcastChecklistItemUpdated(item);
      autoFinalizePermintaan();
    } catch (err) {
      S.showToast('Gagal update: ' + err.message, 'error');
      renderChecklist();
    }
    return;
  }

  if (action === 'tidak') {
    btn.closest('.kb-item-actions').querySelectorAll('button').forEach(b => b.disabled = true);
    const prevMatched = item.matched_items || [];
    try {
      S.markLocalWrite(S.PERMINTAAN_ITEM_TABLE, itemId, 'status', 'TIDAK_TERPENUHI');
      await callUpdatePermintaanItemMulti(itemId, 'TIDAK_TERPENUHI', []);
      item.status = 'TIDAK_TERPENUHI';
      item.matched_items = [];
      // Produk yang tadinya kepakai item ini kehilangan kontribusinya ke total —
      // kalkulasi ulang qty clipboard biar gak nyangkut kelebihan dari sebelumnya.
      let clipQtyChanged = false;
      const touchedProduk = new Set();
      prevMatched.forEach(l => {
        const key = l.produk_id != null ? 'id:' + l.produk_id : 'kode:' + l.kode_produk;
        if (touchedProduk.has(key)) return;
        touchedProduk.add(key);
        if (syncClipboardQtyForProduk(l.produk_id, l.kode_produk)) clipQtyChanged = true;
      });
      if (clipQtyChanged) S.updateClipboard();
      S.checklistExpandedId = S.advanceToNextPending(itemId);
      renderChecklist();
      S.maybeFetchSuggestionForExpanded();
      S.broadcastChecklistItemUpdated(item);
      autoFinalizePermintaan();
    } catch (err) {
      S.showToast('Gagal update: ' + err.message, 'error');
      renderChecklist();
    }
    return;
  }

  if (action === 'undo') {
    const prevMatched = item.matched_items || [];
    try {
      S.markLocalWrite(S.PERMINTAAN_ITEM_TABLE, itemId, 'status', 'PENDING');
      await callUpdatePermintaanItemMulti(itemId, 'PENDING', []);
      item.status = 'PENDING';
      item.matched_items = [];
      // Sama kayak 'tidak': produk yang kepakai item ini kehilangan kontribusinya,
      // jadi total qty clipboard dihitung ulang biar tetap akurat.
      let clipQtyChanged = false;
      const touchedProduk = new Set();
      prevMatched.forEach(l => {
        const key = l.produk_id != null ? 'id:' + l.produk_id : 'kode:' + l.kode_produk;
        if (touchedProduk.has(key)) return;
        touchedProduk.add(key);
        if (syncClipboardQtyForProduk(l.produk_id, l.kode_produk)) clipQtyChanged = true;
      });
      if (clipQtyChanged) S.updateClipboard();
      S.checklistPickingId = null;
      renderChecklist();
      S.broadcastChecklistItemUpdated(item);
      autoFinalizePermintaan();
    } catch (err) {
      S.showToast('Gagal membatalkan: ' + err.message, 'error');
      renderChecklist();
    }
    return;
  }
});

// Centang/uncentang checkbox produk di picker -> qty input muncul/hilang
// ngikutin, dan pesan error "pilih minimal 1" ilang begitu ada yang dicentang.
S.kbList.addEventListener('change', (e) => {
  const chk = e.target.closest('input[data-picker-check]');
  if (!chk) return;
  const kode = chk.dataset.kode;
  const qtyInput = S.kbList.querySelector(`input[data-picker-qty="${chk.dataset.pickerCheck}"][data-kode="${CSS.escape(kode)}"]`);
  if (qtyInput) qtyInput.style.display = chk.checked ? '' : 'none';
  const errEl = S.kbList.querySelector(`[data-picker-error="${chk.dataset.pickerCheck}"]`);
  if (errEl && chk.checked) errEl.style.display = 'none';
});

const KB_COLLAPSE_KEY = 'pnm_kb_collapsed';
S.kbCollapseBtn.addEventListener('click', () => {
  const collapsed = S.kbSection.classList.toggle('kb-collapsed');
  S.kbCollapseBtn.title = collapsed ? 'Buka daftar' : 'Ciutkan daftar';
  sessionStorage.setItem(KB_COLLAPSE_KEY, collapsed ? '1' : '0');
});
// Kalau sebelumnya diciutkan di sesi browser yang sama, biarkan tetap ciutan
// begitu daftar Kebutuhan RS pertama kali muncul.
if (sessionStorage.getItem(KB_COLLAPSE_KEY) === '1') {
  S.kbSection.classList.add('kb-collapsed');
  S.kbCollapseBtn.title = 'Buka daftar';
}

// Kerja bareng dalam satu sesi yang sama bisa jalan bersamaan (bukan cuma
// gantian) — tombol ini nge-tarik ulang status checklist dari server, biar
// item yang barusan ditandai temen langsung kelihatan tanpa buka-tutup sesi.
S.kbRefreshBtn.addEventListener('click', async () => {
  if (!S.currentSesiId) return;
  S.kbRefreshBtn.disabled = true;
  S.kbRefreshStatus.textContent = 'Memuat ulang…';
  await S.loadChecklistForSesi(S.currentSesiId);
  S.kbRefreshBtn.disabled = false;
});

// Dulu ini tombol "Record Sesi Ini" terpisah yang harus diklik manual.
// Sekarang otomatis: tiap kali item dicentang (bisa/tidak), tingkat pemenuhan
// langsung dihitung ulang & disimpan di background — gak nunggu diklik, dan
// otomatis ke-cover juga saat "Record Konversi" ditekan di akhir.
async function autoFinalizePermintaan() {
  if (!S.checklistPermintaanId) return;
  const total = S.checklistItems.length;
  const done = S.checklistItems.filter(i => i.status === 'TERPENUHI').length;
  const tingkatPemenuhan = total > 0 ? Math.round((done / total) * 1000) / 10 : 0; // 1 desimal

  S.kbRecordStatus.style.color = 'var(--text-muted)';
  S.kbRecordStatus.textContent = 'Menyimpan…';
  try {
    const res = await fetch(`${S.SUPABASE_URL}/rest/v1/rpc/finalize_permintaan_rs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': S.ANON_KEY,
        'Authorization': 'Bearer ' + (await S.getFreshToken())
      },
      body: JSON.stringify({
        p_permintaan_id: S.checklistPermintaanId,
        p_tingkat_pemenuhan: tingkatPemenuhan,
        p_items_terpenuhi: done,
        p_items_total: total
      })
    });
    if (!res.ok) throw new Error('Gagal simpan rekap');
    S.kbRecordStatus.style.color = 'var(--success)';
    S.kbRecordStatus.textContent = `Tersimpan otomatis ✓ ${tingkatPemenuhan}% terpenuhi (${done}/${total} item)`;
  } catch {
    S.kbRecordStatus.style.color = 'var(--danger)';
    S.kbRecordStatus.textContent = 'Gagal simpan rekap otomatis (gak masalah, dicoba lagi pas item berikutnya ditandai)';
  }
}
S.autoFinalizePermintaan = autoFinalizePermintaan;

// p_links: array of {produk_id, kode_produk, qty_alokasi} — boleh kosong ([])
// kalau statusnya PENDING/TIDAK_TERPENUHI. Ganti total (replace-all) per item,
// bukan nambah satu-satu, jadi konsisten sama isi checkbox picker di layar.
async function callUpdatePermintaanItemMulti(itemId, status, links) {
  const res = await fetch(`${S.SUPABASE_URL}/rest/v1/rpc/update_permintaan_item_multi`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': S.ANON_KEY,
      'Authorization': 'Bearer ' + (await S.getFreshToken())
    },
    body: JSON.stringify({ p_item_id: itemId, p_status: status, p_links: links || [] })
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.message || errData.hint || 'Gagal update item');
  }
}
S.callUpdatePermintaanItemMulti = callUpdatePermintaanItemMulti;

// Item yang datang dari server (get_permintaan_by_sesi) atau dari sesi lama
// mungkin masih format 1:1 (matched_produk_id/matched_kode_produk doang, belum
// ada matched_items array). Normalisasi di sini biar sisa kode UI cuma perlu
// tau satu bentuk: item.matched_items = [{produk_id, kode_produk, qty_alokasi}].
function normalizeMatchedItems(item) {
  if (Array.isArray(item.matched_items)) return item.matched_items;
  if (item.matched_kode_produk) {
    return [{ produk_id: item.matched_produk_id ?? null, kode_produk: item.matched_kode_produk, qty_alokasi: null }];
  }
  return [];
}
S.normalizeMatchedItems = normalizeMatchedItems;

}