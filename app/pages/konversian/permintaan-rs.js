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
//   edit   : koreksi nama/qty item tersimpan → hanya baris yang berubah yang ditulis
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
    prTitleEl.textContent = 'Tambah Permintaan RS';
    prSubEl.textContent = `Item baru ditambahkan ke Permintaan RS sesi ini (${n} item sudah ada). Item yang sudah ada tidak diubah atau ditimpa.`;
  } else if (mode === 'edit') {
    prTitleEl.textContent = 'Edit Permintaan RS';
    prSubEl.textContent = 'Koreksi nama atau qty item yang sudah tersimpan.';
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
const rsStripAdd = document.getElementById('rs-strip-add');
const rsStripEdit = document.getElementById('rs-strip-edit');
rsStripState.addEventListener('click', () => openPrModal());
rsStripAdd.addEventListener('click', () => openPrModal(hasActivePermintaan() ? 'add' : 'create'));
rsStripEdit.addEventListener('click', () => openPrModal('edit'));

// Satu-satunya tempat yang nyinkronin state Permintaan RS ke UI di luar modal:
// strip di panel sesi + label tombol toolbar. Dipanggil dari updateKbTabState()
// (yang udah jalan tiap checklist berubah/di-reset), jadi gak ada state kedua.
function updateRsStrip() {
  const active = hasActivePermintaan();
  const n = S.checklistItems.length;
  const done = S.checklistItems.filter(i => i.status === 'TERPENUHI').length;
  rsStripInfo.textContent = active ? `${n} item · ${done}/${n} terpenuhi` : 'belum dicatat';
  rsStripState.classList.toggle('has-data', active);
  rsStripAdd.innerHTML = active ? '<i class="ti ti-plus"></i> Tambah' : '<i class="ti ti-plus"></i> Catat';
  rsStripAdd.title = active ? 'Tambah item ke Permintaan RS sesi ini (yang lama tidak berubah)' : 'Catat Permintaan RS untuk sesi ini';
  rsStripEdit.style.display = active ? '' : 'none';
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
let prEditOriginal = new Map(); // id -> {raw_text, qty_diminta} saat editor dibuka

function renderPrEditRows() {
  prEditOriginal = new Map(S.checklistItems.map(it => [it.id, { raw_text: it.raw_text, qty_diminta: it.qty_diminta ?? null }]));
  prEditRows.innerHTML = S.checklistItems.length ? S.checklistItems.map(it => `
    <div class="pr-edit-row" data-id="${it.id}">
      <input class="pr-ed-nama" value="${escapeHtmlAttr(it.raw_text)}" placeholder="Nama item"/>
      <input class="pr-ed-qty" inputmode="numeric" value="${it.qty_diminta != null ? it.qty_diminta : ''}" placeholder="Qty"/>
    </div>`).join('') : '<div class="pr-review-empty">Belum ada item.</div>';
}

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
    if (!nama) { invalid = 'Nama item tidak boleh kosong.'; return; }
    if (qty !== null && (isNaN(qty) || qty < 1)) { invalid = `Qty "${orig.raw_text}" harus angka 1 atau lebih (atau kosongkan).`; return; }
    if (nama !== orig.raw_text || qty !== (orig.qty_diminta ?? null)) changes.push({ id, nama, qty, orig });
  });
  if (invalid) { S.prStatusMsg.style.color = 'var(--danger)'; S.prStatusMsg.textContent = invalid; return; }
  if (!changes.length) { S.prStatusMsg.style.color = 'var(--text-muted)'; S.prStatusMsg.textContent = 'Tidak ada perubahan.'; return; }

  const btn = document.getElementById('pr-edit-save-btn');
  btn.disabled = true; btn.textContent = 'Menyimpan…';
  const failed = [];
  const notes = [];
  let ok = 0;
  for (const ch of changes) {
    try {
      await apiUpdatePermintaanItem(ch.id, { raw_text: ch.nama, qty_diminta: ch.qty });
      const item = S.checklistItems.find(i => i.id === ch.id);
      if (item) {
        item.raw_text = ch.nama;
        item.qty_diminta = ch.qty;
        delete S.dictSuggestionCache[item.id]; // istilah berubah → saran Dictionary lama gak relevan
        const note = await cascadeQtyChange(item, ch.orig.qty_diminta, ch.qty);
        if (note) notes.push(note);
      }
      ok++;
    } catch (err) {
      failed.push(`${ch.orig.raw_text}: ${err.message}`);
    }
  }
  btn.disabled = false; btn.textContent = 'Simpan perubahan';

  await S.loadChecklistForSesi(S.currentSesiId, { quiet: true }); // segarkan dari server (sumber kebenaran)
  if (ok) broadcastChecklistReload();
  if (failed.length) {
    S.prStatusMsg.style.color = 'var(--danger)';
    S.prStatusMsg.textContent = `${ok} tersimpan, ${failed.length} gagal — ${failed.slice(0, 2).join('; ')}`;
    renderPrEditRows();
    return;
  }
  S.showToast(`${ok} item diperbarui`);
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

}