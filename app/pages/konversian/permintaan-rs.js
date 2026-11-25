// Modul hasil pecahan dari konversian/index.js. State lintas-file diakses lewat objek
// 'S' yang dioper dari index.js (bukan window global; lihat `const S = {}` di mount()
// lalu install*(S) dipanggil berurutan). Referensi ke variabel/fungsi yang didefinisikan
// di file LAIN ditulis S.nama (lihat COORD LOG di index.js).
import { resolveItems, summarize, extractSpecs, buildVariants, understand, loadLexicon, makeFirmCheck, buatIndeks, KONTEKS } from './auto-konversi/index.js';
import { tawarkan as anchorTawarkan, hitung as anchorHitung, labelOpsi as anchorLabelOpsi, labelSinyal as anchorLabelSinyal, ANCHOR_LEVEL } from './auto-konversi/anchor.js';
import { bandingkan, tokensToHtml } from './auto-konversi/bandingkan.js';
import { siapChipsHtml, firmChipHtml } from './auto-konversi/siap.js';
import { suggestKonteks } from './auto-konversi/konteks-suggest.js';
import { isTyping } from '../../../shared/shortcuts.js';

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
const PR_SUB_CREATE = 'Simpan daftar permintaan RS (paste teks, upload Excel, atau screenshot). Setelah disimpan, usulan produk per item muncul di Kebutuhan RS — kamu yang memutuskan.';
const prTitleEl = document.getElementById('pr-modal-title');
const prSubEl = document.getElementById('pr-modal-sub');
const prActiveWrap = document.getElementById('pr-active-wrap');
const prActiveMeta = document.getElementById('pr-active-meta');
const prActiveList = document.getElementById('pr-active-list');
const prEditWrap = document.getElementById('pr-edit-wrap');
const prEditRows = document.getElementById('pr-edit-rows');
bindSeg(prEditRows, (seg, k) => paintSeg(seg, { value: k }));   // editor item: pilihan Jenis tersimpan di seg.dataset.value, dibaca saat simpan
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
    rvSetWide(false);
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
  const mi = (k, v, extra) => `<div class="pr-meta-item"><span class="pr-meta-k">${k}</span><b class="pr-meta-v">${v}</b>${extra || ''}</div>`;
  prActiveMeta.innerHTML =
    mi('RS / Instansi', S.escapeHtmlAttr(S.checklistNamaRs || '-')) +
    mi('Sales', S.escapeHtmlAttr(S.checklistSales || '-')) +
    mi('Tanggal', S.escapeHtmlAttr(tgl)) +
    (S.checklistPagu != null ? mi('Pagu', S.rupiah(S.checklistPagu)) : '') +
    mi('Item', `${items.length}`, `<span class="pr-meta-sub">${done} terpenuhi</span>`);
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
  reviewItems = []; rvReset();
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
function closePrModal() { S.prModal.classList.remove('show'); rvSetWide(false); }

S.btnPermintaan.addEventListener('click', () => openPrModal());
S.prCancelBtn2.addEventListener('click', () => { closePrModal(); resumeRecordAfterCancel(); });
S.prModal.addEventListener('click', (e) => { if (e.target === S.prModal) { closePrModal(); resumeRecordAfterCancel(); } });
const prCloseX = document.getElementById('pr-close-x');
if (prCloseX) prCloseX.addEventListener('click', () => { closePrModal(); resumeRecordAfterCancel(); });

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

// Satu pintu masuk di header atas: klik → openPrModal() tanpa mode. Kalau sesi sudah punya Permintaan RS
// jatuhnya ke view "active" (isi tersimpan + tombol Tambah item / Edit item); kalau belum → form Catat.
// Dulu ada chip kedua di baris tab clipboard yang membuka modal yang sama; dibuang supaya satu aksi = satu tombol.
// Status sesi (berapa item sudah terpenuhi) tampil sebagai pil kecil di tombol header.
const btnPermintaanCount = document.getElementById('btn-permintaan-count');

// Satu-satunya tempat yang nyinkronin state Permintaan RS ke tombol header. Dipanggil dari
// updateKbTabState() (jalan tiap checklist berubah/di-reset), jadi gak ada state kedua.
function updatePermintaanButton() {
  const active = hasActivePermintaan();
  const n = S.checklistItems.length;
  const done = S.checklistItems.filter(i => i.status === 'TERPENUHI').length;
  const showCount = active && n > 0;
  S.btnPermintaan.classList.toggle('on', active);
  S.btnPermintaan.title = active ? 'Lihat, tambah, atau edit Permintaan RS sesi ini' : 'Catat Permintaan RS untuk sesi ini';
  if (!btnPermintaanCount) return;
  btnPermintaanCount.hidden = !showCount;
  btnPermintaanCount.textContent = showCount ? `${done}/${n}` : '';
  btnPermintaanCount.classList.toggle('is-complete', showCount && done === n);
  const ket = showCount ? `${done} dari ${n} item terpenuhi` : '';
  btnPermintaanCount.title = ket;
  if (ket) btnPermintaanCount.setAttribute('aria-label', ket); else btnPermintaanCount.removeAttribute('aria-label');
}
S.updatePermintaanButton = updatePermintaanButton;

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
    let satuan = null; // kata satuan yang dibuang dari nama ("2 UNIT" -> UNIT); dipakai sebagai petunjuk jenis

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
      satuan = m[2].toUpperCase();
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
    return { raw_text: line, qty, pagu_satuan, satuan };
  }).filter(Boolean);

  items._skipped = skipped; // info baris yang disaring, dibaca sama pemanggil
  return items;
}
S.parseTeksPermintaan = parseTeksPermintaan; // dipakai juga oleh Cari SET (set-mendekati.js): paste teks permintaan -> baris + qty

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
  rvReset();
  reviewItems = items.map(it => rvNewItem({ raw_text: it.raw_text, qty: it.qty, pagu_satuan: it.pagu_satuan ?? null, satuan: it.satuan || null }));
  reviewSumber = sumber;
  renderReviewRows();
  S.prFormWrap.style.display = 'none';
  S.prReviewWrap.style.display = '';
  rvSetWide(true);
  // Layar review punya judul sendiri; judul/sub mode (create/add) dipulihkan lagi pas "Kembali edit".
  prTitleEl.textContent = 'Periksa item';
  prSubEl.textContent = 'Cek hasil bacaan sebelum disimpan. Jenis (SET / INSTRUMENT / UNIT) bisa diatur sekaligus lewat default, usulan, atau pilih banyak baris. Yang belum diatur tidak menghalangi simpan.';
});

// ---- Step 2: Layar Review — edit manual sebelum submit_permintaan_rs ----
let reviewItems = [];      // {raw_text, qty, pagu_satuan, konteks}  (konteks: null | 'SET' | 'INSTRUMENT' | 'UNIT')
let reviewSumber = 'TEKS';
let reviewSkipped = [];    // baris mentah yang otomatis disaring pas parsing (info doang, ditampilkan)

// ── AUTO-MATCH (auto-konversi/): state usulan produk, dipakai di Kebutuhan RS (workspace) ──
// Dulu pencocokan dikerjakan di layar "Periksa item" (modal sempit; usulan hilang saat modal ditutup,
// tidak terlihat rekan, tanpa stok/harga). Sekarang modal cuma INTAKE (baca → cek → simpan), dan pencocokan
// jalan di Kebutuhan RS setelah item tersimpan. Usulan = state lokal (amMap), TIDAK ditulis ke DB;
// yang tertulis hanya KEPUTUSAN (TERPENUHI + produk), lewat jalur yang sama dgn tombol Pakai saran Dictionary.
const amMap = new Map();   // item.id -> { hasil, kode, nama } (usulan teratas; kandidat lain di hasil.candidates)
let amRunning = false;
let amApplying = false;
let amProgress = { n: 0, t: 0 };   // n = jumlah item yang SUDAH selesai (naik terus), t = total target run ini
let amTally = { AUTO: 0, REVIEW: 0, UNKNOWN: 0 }; // hitungan hasil yang sudah masuk selama run berjalan
let amT0 = 0;              // performance.now() awal run — untuk perkiraan sisa waktu
let amAbort = null;        // { aborted } milik run yang sedang jalan; tombol Hentikan mengisinya
let amHidden = false;      // true = usulan disembunyikan dari tampilan (data di amMap TIDAK dibuang, bisa ditampilkan lagi)
let amFilter = 'all';      // 'all' | 'AUTO' | 'REVIEW' | 'UNKNOWN'
const AM_LABEL = { AUTO: 'Cocok', REVIEW: 'Cek dulu', UNKNOWN: 'Tidak ketemu' };
const AM_PREF_KEY = 'pnm.konversian.automatch';
let amAutoOn = true;       // switch di footer layar Periksa item: jalankan Auto-Match otomatis setelah simpan
try { amAutoOn = localStorage.getItem(AM_PREF_KEY) !== '0'; } catch (_) { /* storage diblok: default aktif */ }
const amBarEl = document.getElementById('kb-am-bar');
// Persentase usulan AUTO yang sengaja diminta diperiksa staff (lihat auditPick di resolver.js). Selama log masih sedikit,
// naikkan (0.15–0.3); setelah presisi AUTO stabil (view automatch_presisi_audit) turunkan ke 0.05.
const AM_AUDIT_RATE = 0.15;
// Cara keputusan diambil, ikut dicatat di log: 'bulk' = tombol "Pakai N yang cocok" (tidak ada yang memeriksa satu per satu), 'satuan' = lainnya.
let amVia = 'satuan';
let amReason = 'all';      // sub-filter alasan, hanya berlaku saat filter = REVIEW ('all' | reason_key)
let amLexicon = null;      // kamus token hasil riwayat (get_kamus_token); null = belum dimuat. Gagal muat = kosong, mesin tetap jalan.
async function getAmLexicon(force) {
  if (!amLexicon || force) amLexicon = await loadLexicon(S.rpc);
  return amLexicon;
}

// ── KEBIJAKAN AUTO-MATCH (Preferensi → Auto-Match, disimpan di S.pnmSettings) ──
// Dua sumbu yang bebas dipilih; resolver.js TIDAK berubah (status AUTO/REVIEW/UNKNOWN tetap sama), jadi mengganti mode
// langsung berlaku tanpa mencocokkan ulang. Yang berubah hanya apa yang DITAMPILKAN dan apakah AUTO dipasang sendiri.
//   amYakin : 'tombol' = AUTO dipasang lewat "Pakai N yang cocok"  |  'pasang' = AUTO langsung dipasang setelah pencocokan selesai
//   amRagu  : 'semua'  = REVIEW/UNKNOWN tampil lengkap  |  'ringkas' = produk belum siap jual dilipat jadi satu baris, bukan usulan
//             'sembunyi' = hanya AUTO yang tampil; sisanya tanpa usulan (bisa diintip sementara)
const AM_PRESET = {
  lengkap:  { amYakin: 'tombol', amRagu: 'semua' },
  seimbang: { amYakin: 'tombol', amRagu: 'ringkas' },
  agresif:  { amYakin: 'pasang', amRagu: 'sembunyi' }
};
S.AM_PRESET = AM_PRESET; // dibaca index.js (modal Preferensi) supaya tabel preset cuma ada di satu tempat
const AM_PRESET_NAMA = { lengkap: 'Lengkap', seimbang: 'Seimbang', agresif: 'Agresif', kustom: 'Kustom' };
function amPolicy() {
  const st = S.pnmSettings || {};
  return {
    yakin: st.amYakin === 'pasang' ? 'pasang' : 'tombol',
    ragu: ['semua', 'ringkas', 'sembunyi'].includes(st.amRagu) ? st.amRagu : 'ringkas'
  };
}
function amPresetKey() {
  const p = amPolicy();
  return Object.keys(AM_PRESET).find(k => AM_PRESET[k].amYakin === p.yakin && AM_PRESET[k].amRagu === p.ragu) || 'kustom';
}
let amPeek = false; // mode sembunyi: true = tampilkan sementara yang disembunyikan (hilang saat halaman dimuat ulang)
const amSembunyi = () => amPolicy().ragu === 'sembunyi' && !amPeek;
// Item yang usulannya dibuang dari tampilan oleh kebijakan (mode sembunyi, status bukan AUTO).
function amDisembunyikan(m) { return !!m && amSembunyi() && m.hasil.status !== 'AUTO'; }
// Pisahkan kandidat: siap jual vs belum siap (AKD/link V6/firm). Mode 'semua' tidak memisah.
function amSplit(h) {
  const cands = (h.candidates || []).filter((c, i, a) => a.findIndex(x => x.kode === c.kode) === i);
  if (amPolicy().ragu === 'semua') return { siap: cands, belum: [] };
  const siap = [], belum = [];
  cands.forEach(c => (c.siap && !c.siap.ok ? belum : siap).push(c));
  return { siap, belum };
}
// Usulan teratas yang BOLEH tampil/dipakai cepat: dalam mode ringkas/sembunyi, produk belum siap bukan usulan.
function amTopKode(m) {
  if (!m || !m.kode) return null;
  const { siap } = amSplit(m.hasil);
  return siap.some(c => c.kode === m.kode) ? m.kode : null;
}
const amBelumOpen = new Set(); // item.id yang lipatan "belum siap jual"-nya dibuka

// Log usulan & keputusan (tabel automatch_log, lihat README/auto-konversi-queries.sql Q4). Best-effort: gagal log
// TIDAK boleh mengganggu kerja staff, jadi semua error ditelan.
function amLog(rows) {
  if (!rows.length) return;
  try { Promise.resolve(S.rpc('log_automatch', { p_rows: rows })).catch(() => {}); } catch (_) { /* abaikan */ }
}
// Kolom tambahan log (migrasi log_automatch_v2.sql): cukup untuk menghitung akurasi per jalur, top-5, dan audit.
function amLogExtra(h) {
  const c0 = (h.candidates && h.candidates[0]) || {};
  return {
    audit: !!h.audit, reason_asli: h.reason_key_asli || null, src: c0.src || null, tier: c0.tier || null,
    family: h.family || null, ukuran_default: !!h.ukuran_default,
    cands: (h.candidates || []).slice(0, 5).map(c => c.kode),
    lexicon_hits: (h.lexicon_hits || []).map(x => x.token)
  };
}
function amLogDecision(itemId, status, links) {
  const m = amMap.get(itemId);
  if (!m) return;
  const kodes = (links || []).map(l => l.kode_produk);
  // Bundle skenario yang memuat usulan teratas = usulan DITERIMA (bukan "diganti"), supaya akurasi AUTO tidak terlihat turun.
  const aksi = status === 'TERPENUHI' ? ((kodes.length === 1 && kodes[0] === m.kode) || (m.hasil.bundle && kodes.includes(m.kode)) ? 'diterima' : 'diganti')
    : status === 'TIDAK_TERPENUHI' ? 'ditolak' : null;
  if (!aksi) return;
  const key = aksi + '|' + kodes.join(',');
  if (m.loggedKey === key) return;          // keputusan yang sama jangan dicatat dua kali
  m.loggedKey = key;
  const it = S.checklistItems.find(x => x.id === itemId);
  amLog([{
    permintaan_id: S.checklistPermintaanId != null ? String(S.checklistPermintaanId) : null, item_id: String(itemId),
    raw_text: it ? it.raw_text : '', usulan_kode: m.kode || null, status: m.hasil.status, confidence: m.hasil.confidence,
    reason_key: m.hasil.reason_key || null, diff: m.hasil.diff || [], keputusan_kode: kodes.join(',') || null, aksi,
    ...amLogExtra(m.hasil), via: amVia
  }]);
}

// Kesiapan jual usulan (lihat auto-konversi/firm.js): SINGLE USE / sudah dihapus = dibuang dari kandidat; belum firm /
// link V6 belum ada / AKD belum ada = tetap jadi usulan tapi TIDAK di-AUTO. Dua request per 80 kode (produk, lalu produk_akd —
// relasi produk_akd -> akd(no_akd) sama dgn crud-produk/index.js), di-cache per klik "Cocokkan otomatis".
// Mode Swasta (S.modeSwastaOutput) tidak difilter, sama seperti di tempat lain.
// Indeks prosedur set (auto-konversi/prosedur.js): daftar set dari v_produk_keluarga + sinonim dari tabel prosedur_sinonim.
// Dimuat sekali per sesi halaman. Gagal (view/tabel belum ada, RLS, offline) -> null: resolver jalan seperti sebelumnya, tanpa prosedur.
let prosedurIndeks = null, prosedurMuat = null;
// Status muat terakhir, dibaca penampil prosedur (prosedur-daftar.js) supaya kegagalan sinonim TIDAK diam-diam:
//   sinonim: jumlah baris yang terbaca; sinonimStatus: 'ok' | 'http <kode>' | 'error' | 'belum'.
//   RLS yang memblokir SELECT di PostgREST balas 200 + [] (bukan error) -> jumlah 0 pada tabel yang berisi = curiga RLS/grant.
let prosedurMeta = { set: 0, sinonim: 0, sinonimStatus: 'belum' };
async function getProsedurIndeks() {
  if (prosedurIndeks) return prosedurIndeks;
  if (prosedurMuat) return prosedurMuat;
  prosedurMuat = (async () => {
    try {
      // v_produk_varian membawa brand + status firm per set. Indeks ini sekarang hanya dipakai resolver Auto-Match (bundel/padanan prosedur)
      // dan penampil prosedur; tawaran anchor tidak lagi memakainya (RPC auto_konversi_tawarkan). Belum dipasang / gagal / kosong -> v_produk_keluarga.
      const baca = async (path) => {
        const out = [];
        for (let off = 0; off < 5000; off += 1000) {
          const res = await S.sesiFetch(`${path}&order=id&limit=1000&offset=${off}`);
          if (!res.ok) return null;
          const part = await res.json();
          out.push(...part);
          if (part.length < 1000) break;
        }
        return out;
      };
      let rows = [];
      const varian = await baca('v_produk_varian?select=kode_produk,nama_produk,brand,firm,firm_alasan,keluarga&tipe=eq.SET').catch(() => null);
      if (varian && varian.length) {
        rows = varian.map(r => ({ kode: r.kode_produk, nama: r.nama_produk, brand: r.brand == null ? '' : r.brand, firm: r.firm, firmAlasan: r.firm_alasan, keluarga: r.keluarga }));
      } else {
        const lama = await baca('v_produk_keluarga?select=kode_produk,nama_produk');
        if (!lama) return null;
        rows = lama.map(r => ({ kode: r.kode_produk, nama: r.nama_produk }));
      }
      let sinonim = {};
      let sinonimStatus = 'error';
      try {
        const rs = await S.sesiFetch('prosedur_sinonim?select=dari,ke');
        sinonimStatus = rs.ok ? 'ok' : 'http ' + rs.status;
        if (rs.ok) (await rs.json()).forEach(r => { if (r.dari && r.ke) sinonim[String(r.dari).toUpperCase()] = String(r.ke).toUpperCase(); });
      } catch (e) { /* tanpa sinonim: tetap jalan */ }
      prosedurMeta = { set: rows.length, sinonim: Object.keys(sinonim).length, sinonimStatus };
      prosedurIndeks = rows.length ? buatIndeks(rows, sinonim) : null;
      return prosedurIndeks;
    } catch (e) { return null; } finally { prosedurMuat = null; }
  })();
  return prosedurMuat;
}
S.getProsedurIndeks = getProsedurIndeks; // dipakai penampil prosedur (prosedur-daftar.js)
S.prosedurMeta = () => prosedurMeta;

const firmCheck = makeFirmCheck({
  parseLinkV6: (v) => S.parseLinkV6(v),
  fetchRows: async (kodes) => {
    const inList = kodes.map(k => `"${String(k).replace(/"/g, '')}"`).join(',');
    const res = await S.sesiFetch(`produk?kode_produk=in.(${encodeURIComponent(inList)})&select=id,kode_produk,link_v6`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const rows = await res.json();
    if (!rows.length) return rows;
    // Error di sini sengaja DILEMPAR (bukan dianggap "tanpa AKD"): firmCheck menandainya belum terverifikasi, bukan salah vonis.
    const resAkd = await S.sesiFetch(`produk_akd?produk_id=in.(${rows.map(r => r.id).join(',')})&select=produk_id,akd:akd_id(no_akd)`);
    if (!resAkd.ok) throw new Error('HTTP ' + resAkd.status + ' (AKD)');
    const akdBy = new Map();
    (await resAkd.json()).forEach(l => { if (l.akd && l.akd.no_akd) { if (!akdBy.has(l.produk_id)) akdBy.set(l.produk_id, []); akdBy.get(l.produk_id).push(l.akd.no_akd); } });
    return rows.map(r => ({ kode_produk: r.kode_produk, link_v6: r.link_v6, akd: akdBy.get(r.id) || [] }));
  }
});

function escapeHtmlAttr(s) {
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
S.escapeHtmlAttr = escapeHtmlAttr;

// ══════════════════════════════════════════
// ANCHOR: produk yang sudah dipilih staf untuk satu item jadi anchor → tawarkan seluruh varian sebagai bundle.
// Semua klasifikasi + saringan firm/brand/aktif ada di DB (RPC auto_konversi_tawarkan*, dibungkus auto-konversi/anchor.js);
// di sini hanya state + tampilan. Baris dirender apa adanya (sudah terurut & firm-only). TIDAK pernah dipasang otomatis —
// staf mencentang lalu klik. Beda dengan bundle Auto-Match (resolver): pemicunya pilihan staf, jadi permintaan yang typo
// / "perkiraan" pun dapat tawaran.
// State lokal saja (tidak ke-sync ke rekan): anchorOpen = panel terbuka, anchorCache = hasil tawaran + centang,
// anchorUndo = anchor asli supaya bisa "Kembalikan ke 1 produk", anchorHitungCache = angka chip "+N varian lain".
// ══════════════════════════════════════════
const anchorOpen = new Set();
const anchorCache = new Map(); // itemId -> { anchor, loading, level, hasil:{anchor,opsi}, pilih:Set, error }
const anchorUndo = new Map();  // itemId -> kode anchor asli
const anchorHitungCache = new Map(); // `${brand}|${kode}` -> { n, ts }
const ANCHOR_HITUNG_TTL = 5 * 60 * 1000;   // status firm bisa berubah; angka chip disegarkan tiap 5 menit
const ANCHOR_HITUNG_COBA_ULANG = 30 * 1000; // gagal -> jangan menembak RPC lagi tiap render
let anchorHitungJalan = false;
let anchorHitungGagal = 0;

// Anchor = item TERPENUHI dengan TEPAT satu produk. Sudah multi-produk (bundle/campuran) = keputusan staf, tidak disentuh.
function anchorKode(item) {
  if (!item || item.status !== 'TERPENUHI') return null;
  const l = item.matched_items || [];
  return l.length === 1 && l[0].kode_produk ? l[0].kode_produk : null;
}
function anchorTerpakai(item) {
  const s = new Set();
  S.checklistItems.forEach(it => {
    if (it.id !== item.id && it.status === 'TERPENUHI') (it.matched_items || []).forEach(l => { if (l.kode_produk) s.add(l.kode_produk); });
  });
  return s;
}
// Varian ditawarkan di brand produk anchor itu sendiri (anchor SKYLAR tidak boleh ditawari varian ROBUST). Cadangan: pill / ROBUST.
const anchorBrandDefault = () => String(S.selectedBrand || 'ROBUST').trim().toUpperCase();
const anchorBrandSinkron = (kode) => String((S.brandDari && S.brandDari(kode)) || anchorBrandDefault()).trim().toUpperCase();
async function anchorBrandDari(kode) {
  try { await S.enrichBrand([{ kode_produk: kode }]); } catch (e) { /* jatuh ke cadangan */ }
  return anchorBrandSinkron(kode);
}
const anchorHitungKey = (kode) => anchorBrandSinkron(kode) + '|' + kode;

// Angka chip: satu RPC batch untuk SEMUA anchor di daftar (bukan satu per item). Selama belum ada, chip belum muncul;
// begitu datang daftar dirender ulang. Gagal -> chip absen saja (fitur ini saja yang hilang), dicoba lagi setelah jeda.
function anchorHitungPicu() {
  if (anchorHitungJalan || Date.now() - anchorHitungGagal < ANCHOR_HITUNG_COBA_ULANG) return;
  const now = Date.now();
  const perlu = [...new Set(S.checklistItems.map(anchorKode).filter(Boolean))].filter((k) => {
    const c = anchorHitungCache.get(anchorHitungKey(k));
    return !c || now - c.ts > ANCHOR_HITUNG_TTL;
  });
  if (!perlu.length) return;
  anchorHitungJalan = true;
  (async () => {
    try { await S.enrichBrand(perlu.map((k) => ({ kode_produk: k }))); } catch (e) { /* brand cadangan */ }
    const perBrand = new Map(); // satu RPC per brand (RPC menerima satu brand per panggilan)
    perlu.forEach((k) => { const b = anchorBrandSinkron(k); if (!perBrand.has(b)) perBrand.set(b, []); perBrand.get(b).push(k); });
    await Promise.all([...perBrand].map(async ([brand, kodes]) => {
      const peta = await anchorHitung(S.rpc, kodes, { brand });
      peta.forEach((n, k) => anchorHitungCache.set(brand + '|' + k, { n, ts: Date.now() }));
    }));
  })()
    .catch(() => { anchorHitungGagal = Date.now(); })
    .finally(() => { anchorHitungJalan = false; renderChecklist(); });
}
function anchorN(kode) {
  const c = anchorHitungCache.get(anchorHitungKey(kode));
  return c ? c.n : null;
}

async function anchorMuat(item, kode, level) {
  const lama = anchorCache.get(item.id);
  const c = { anchor: kode, loading: true, level, hasil: null, pilih: new Set(), error: null };
  anchorCache.set(item.id, c);
  try {
    const hasil = await anchorTawarkan(S.rpc, kode, { brand: await anchorBrandDari(kode), level });
    if (anchorCache.get(item.id) !== c) return; // ditutup/diganti selagi menunggu
    if (!hasil.opsi.length) { anchorOpen.delete(item.id); anchorCache.delete(item.id); S.showToast('Tidak ada varian lain.'); return; }
    c.hasil = hasil;
    const terpakai = anchorTerpakai(item);
    // Centang awal: semua yang ditawarkan, kecuali yang sudah dipakai item lain. Saat naik ke level 3, centang staf dipertahankan
    // dan baris tambahan (barang sejenis) TIDAK dicentang — itu bukan varian sungguhan.
    const sebelumnya = lama && lama.anchor === kode && lama.hasil ? lama : null;
    const kodeLama = sebelumnya ? new Set(sebelumnya.hasil.opsi.map(o => o.kode_produk)) : null;
    hasil.opsi.forEach(o => {
      if (terpakai.has(o.kode_produk)) return;
      if (kodeLama) { if (kodeLama.has(o.kode_produk) && sebelumnya.pilih.has(o.kode_produk)) c.pilih.add(o.kode_produk); }
      else c.pilih.add(o.kode_produk);
    });
    c.pilih.add(kode);
  } catch (err) {
    if (anchorCache.get(item.id) === c) c.error = err.message || 'gagal';
  } finally {
    c.loading = false;
    if (anchorCache.get(item.id) === c || !anchorCache.has(item.id)) renderChecklist();
  }
}
// Chip di baris ketutup: "+N varian lain". Klik = buka panel di baris itu.
function anchorChipHtml(item) {
  const kode = anchorKode(item);
  if (!kode) return '';
  const n = anchorN(kode);
  if (!n) return '';
  return `<button type="button" class="kb-am-btn kb-anchor-chip" data-action="anchor-open" data-id="${item.id}" title="Tawarkan semua varian produk ini sebagai opsi">+${n} varian lain</button>`;
}
function anchorBadgesHtml(o) {
  const sinyal = Array.isArray(o.sinyal) ? o.sinyal : [];
  if (!sinyal.length) return '';
  return `<span class="kb-anchor-badges">${sinyal.map(s => `<span class="pd-tag kb-anchor-badge" data-sinyal="${escapeHtmlAttr(s)}">${escapeHtmlAttr(anchorLabelSinyal(s))}</span>`).join('')}</span>`;
}
function anchorPanelHtml(item) {
  const kode = anchorKode(item);
  if (!kode) return '';
  const c = anchorCache.get(item.id);
  const open = anchorOpen.has(item.id) && !!c && c.anchor === kode;
  const n = anchorN(kode);
  const dq = Number(item.qty_diminta);
  const qtyTxt = dq >= 1 ? escapeHtmlAttr(String(dq)) : 'qty diminta';
  if (!open) {
    if (!n) return '';
    return `<div class="kb-cmp-hint kb-anchor"><button type="button" class="kb-am-btn" data-action="anchor-open" data-id="${item.id}">Tawarkan semua varian</button> ${n} varian lain yang siap dijual — tiap opsi @ ${qtyTxt}, buat bandingan anggaran.</div>`;
  }
  if (c.loading) return `<div class="kb-cmp-hint kb-anchor" role="status">Menyiapkan opsi…</div>`;
  if (c.error) return `<div class="kb-cmp-hint kb-anchor">Gagal menyiapkan opsi: ${escapeHtmlAttr(c.error)} <button type="button" class="kb-am-link" data-action="anchor-open" data-id="${item.id}">Coba lagi</button></div>`;
  const h = c.hasil;
  if (!h) return '';
  const terpakai = anchorTerpakai(item);
  const barisAnchor = h.anchor || { kode_produk: kode, nama_produk: (item.matched_items[0] && item.matched_items[0].nama_produk) || kode };
  const baris = [barisAnchor, ...h.opsi];
  const rows = baris.map((o, i) => {
    const isAnchor = i === 0;
    const kodeO = o.kode_produk;
    const kodeEsc = escapeHtmlAttr(kodeO);
    const dipakai = !isAnchor && terpakai.has(kodeO);
    // Anchor selalu ikut sebagai tanda (terkunci). Kalau DB menandainya belum firm, alasannya ditampilkan — bukan dijadikan pilihan baru.
    const alasan = isAnchor ? (o.ditawarkan === false && o.alasan_tolak ? o.alasan_tolak : '') : (dipakai ? 'Sudah dipakai di kebutuhan lain pada permintaan ini.' : '');
    return `<label class="kb-anchor-row${isAnchor ? ' locked' : ''}">
      <input type="checkbox" data-anchor-check="${item.id}" data-kode="${kodeEsc}"${c.pilih.has(kodeO) ? ' checked' : ''}${isAnchor ? ' disabled' : ''}>
      <span class="kb-anchor-main"><span class="kb-anchor-nama">${escapeHtmlAttr(o.nama_produk)}</span>
        <span class="kb-anchor-sub"><span class="kb-cmp-kode">${kodeEsc}</span> ${escapeHtmlAttr(anchorLabelOpsi({ tier: o.tier, nomor: o.nomor }))}${isAnchor ? ' · pilihanmu' : ''} ${firmChipHtml(o.firm, escapeHtmlAttr)}</span>
        ${isAnchor ? '' : anchorBadgesHtml(o)}
        ${alasan ? `<span class="kb-anchor-alasan">${escapeHtmlAttr(alasan)}</span>` : ''}
      </span></label>`;
  }).join('');
  const nPilih = c.pilih.size;
  const sejenis = c.level >= ANCHOR_LEVEL.SEJENIS;
  const tombolSejenis = sejenis ? '' : `<button type="button" class="kb-am-link" data-action="anchor-sejenis" data-id="${item.id}">Tampilkan sejenis</button>`;
  return `<div class="kb-anchor-panel">
    <div class="kb-cmp-hint">${sejenis ? 'Varian dan barang sejenis' : 'Varian'} — centang yang mau ditawarkan, tiap opsi @ ${qtyTxt}. ${tombolSejenis}</div>
    <div class="kb-anchor-list">${rows}</div>
    <div class="kb-picker-actions">
      <button type="button" class="kb-cancel-btn" data-action="anchor-close" data-id="${item.id}">Tutup</button>
      <button type="button" class="kb-am-btn primary" data-action="anchor-apply" data-id="${item.id}"${nPilih < 2 ? ' disabled' : ''}>Pasang ${nPilih} opsi</button>
    </div>
  </div>`;
}
// Tambah ke Clipboard (berurutan, sama dengan "Pakai N yang cocok"); yang gagal dilewati. TIDAK ada toast per produk:
// pemanggil merangkum satu toast dari `gagal` lewat S.ringkasGagalClip(). Mengembalikan { ok: [kode], gagal: [hasil] }.
function pastikanDiClipboard(kodes) {
  return S.pasangBanyakKeClipboard(kodes);
}

// "Jenis" = konteks permintaan (SET / INSTRUMENT / UNIT), diisi staff saat memasukkan permintaan supaya resolver
// Auto-Match terbantu SEBELUM ada keputusan produk. Kosong = tidak diketahui (perilaku lama). Satu sumber nilai:
// KONTEKS di auto-konversi/resolver.js. Dipakai di layar Periksa item dan di editor item.
const KONTEKS_HINT = 'Jenis permintaan: SET = paket/set produk, INSTRUMENT = instrumen satuan, UNIT = alat/unit. Membantu pencocokan produk; kosongkan bila belum tahu.';
const KONTEKS_LABEL = { SET: 'SET', INSTRUMENT: 'INSTR.', UNIT: 'UNIT' };
const KONTEKS_FULL = { SET: 'SET: paket / set produk', INSTRUMENT: 'INSTRUMENT: instrumen satuan', UNIT: 'UNIT: alat / unit' };
const KONTEKS_LAST_KEY = 'pnm.konversian.konteksTerakhir';
function normKonteks(v) { return KONTEKS.includes(v) ? v : null; }

// ── Segmented control "Jenis" (pengganti <select>) ──
// Pola toolbar: <div role="group"> berisi tombol aria-pressed. Tab = satu tab-stop per grup (roving), panah = pindah
// fokus, Enter/Spasi/klik = pilih, klik tombol yang sedang aktif = lepas pilihan. Dipakai di baris Periksa item,
// editor item, default sesi, filter, dan bar aksi (kelas dasar .pr-seg / .pr-seg-opt).
function segHtml(cls, value, label, opts) {
  const o = opts || {};
  const v = normKonteks(value);
  const btns = KONTEKS.map(k => ({ k, text: KONTEKS_LABEL[k], title: KONTEKS_FULL[k] }));
  if (o.none) btns.push({ k: '', text: o.none, title: o.none });
  return `<div${o.id ? ` id="${o.id}"` : ''} class="pr-seg ${cls}" role="group" aria-label="${escapeHtmlAttr(label)}" data-value="${v || ''}">` + btns.map((b, i) =>
    `<button type="button" class="pr-seg-opt" data-k="${b.k}" aria-pressed="${b.k ? b.k === v : false}" tabindex="${i === 0 ? 0 : -1}" title="${escapeHtmlAttr(b.title)}">${escapeHtmlAttr(b.text)}</button>`).join('') + '</div>';
}
// st: { value, sug, def, last, noneActive }. sug/def/last hanya menandai tombol, tidak mengubah nilai.
function paintSeg(seg, st) {
  const v = normKonteks(st.value);
  const btns = [...seg.querySelectorAll('.pr-seg-opt')];
  btns.forEach(b => {
    const k = b.dataset.k;
    const on = k ? k === v : !!(st.noneActive && !v);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.classList.toggle('is-def', !!k && !v && k === st.def);
    b.classList.toggle('is-sug', !!k && !v && k === st.sug);
    b.classList.toggle('is-last', !!k && k === st.last);
    b.tabIndex = -1;
  });
  (btns.find(b => b.getAttribute('aria-pressed') === 'true') || btns[0]).tabIndex = 0;
  seg.dataset.value = v || '';
}
// onPick(seg, kBaru|null, tombol). Delegasi: satu listener untuk banyak grup.
function bindSeg(root, onPick) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('.pr-seg-opt');
    if (!b || !root.contains(b)) return;
    const k = b.dataset.k;
    onPick(b.closest('.pr-seg'), (k && b.getAttribute('aria-pressed') === 'true') ? null : (k || null), b);
  });
  root.addEventListener('keydown', (e) => {
    const b = e.target.closest && e.target.closest('.pr-seg-opt');
    if (!b || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const d = ({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 })[e.key];
    if (!d) return;
    e.preventDefault();
    const all = [...b.closest('.pr-seg').querySelectorAll('.pr-seg-opt')];
    const next = all[(all.indexOf(b) + d + all.length) % all.length];
    all.forEach(x => { x.tabIndex = -1; });
    next.tabIndex = 0; next.focus();
  });
}

// ── State layar Periksa item ──
// Tiap baris punya uid stabil (bukan indeks), jadi hapus/tambah baris tidak menggeser seleksi, kursor, atau undo.
// Prioritas jenis saat simpan: pilihan manual/usulan yang diterima (it.konteks) > default sesi. Usulan yang BELUM
// dikonfirmasi tidak pernah ikut tersimpan.
let reviewUid = 0;
let reviewDefault = null;          // default level sesi: null | 'SET' | 'INSTRUMENT' | 'UNIT' (sengaja tidak diingat antar sesi)
let reviewSel = new Set();         // uid baris terpilih
let reviewAnchor = null;           // uid anchor Shift+klik
let reviewCursor = null;           // uid baris aktif untuk keyboard (j/k)
let reviewFilter = 'semua';        // 'semua' | 'belum' | 'usulan' | 'diatur'
let reviewQuery = '';
let reviewUndo = [];               // tumpukan { prev:[{uid,konteks}] }
let reviewMsg = '';                // teks status aksi terakhir ("12 item → SET")
let reviewLast = null;             // jenis yang terakhir dipakai (disimpan di localStorage)
try { reviewLast = normKonteks(localStorage.getItem(KONTEKS_LAST_KEY)); } catch (_) { /* storage diblok: tidak diingat */ }

const rvEl = (id) => document.getElementById(id);
function rvNewItem(src) {
  const it = { uid: ++reviewUid, raw_text: '', qty: null, pagu_satuan: null, satuan: null, konteks: null, sug: null, ...src };
  it.konteks = normKonteks(it.konteks);
  it.sug = suggestKonteks(it.raw_text, it.satuan);
  return it;
}
const rvFind = (uid) => reviewItems.find(x => x.uid === uid) || null;
const rvEff = (it) => it.konteks || reviewDefault || null;
const rvRow = (uid) => S.prReviewRows.querySelector(`.pr-review-row[data-uid="${uid}"]`);
function rvMatches(it) {
  if (reviewFilter === 'belum' && rvEff(it)) return false;
  if (reviewFilter === 'usulan' && (it.konteks || !it.sug)) return false;
  if (reviewFilter === 'diatur' && !it.konteks) return false;
  return !reviewQuery || it.raw_text.toLowerCase().includes(reviewQuery);
}
const rvVisible = () => reviewItems.filter(rvMatches).map(x => x.uid);
const rvSay = (msg) => { const l = rvEl('pr-rv-live'); if (l) l.textContent = msg; };

function rvReset() {
  reviewDefault = null; reviewSel = new Set(); reviewAnchor = null; reviewCursor = null;
  reviewFilter = 'semua'; reviewQuery = ''; reviewUndo = []; reviewMsg = '';
  const s = rvEl('pr-rv-search'); if (s) s.value = '';
}
// Modal dilebarkan hanya di layar Periksa item (100+ baris butuh kolom yang lega).
function rvSetWide(on) {
  const box = S.prModal && S.prModal.querySelector('.pr-modal-box');
  if (box) box.classList.toggle('pr-modal-box--review', !!on);
}
const rvActive = () => S.prModal.classList.contains('show') && S.prReviewWrap.style.display !== 'none';

// Toolbar statis (default, filter, bar aksi) dibangun sekali; setelahnya hanya di-paint.
let rvToolsReady = false;
function rvInitTools() {
  if (rvToolsReady) return;
  rvToolsReady = true;
  rvEl('pr-rv-default').outerHTML = segHtml('pr-seg--tool', null, 'Jenis default sesi', { none: 'Tanpa', id: 'pr-rv-default' });
  rvEl('pr-rv-bar-seg').outerHTML = segHtml('pr-seg--bar', null, 'Set jenis ke item terpilih', { none: 'Kosongkan', id: 'pr-rv-bar-seg' });
  const f = rvEl('pr-rv-filter');
  f.innerHTML = [['semua', 'Semua'], ['belum', 'Belum'], ['usulan', 'Usulan'], ['diatur', 'Diatur']].map(([k, t], i) =>
    `<button type="button" class="pr-seg-opt" data-f="${k}" aria-pressed="${k === 'semua'}" tabindex="${i ? -1 : 0}">${t} <span class="pr-rv-n" data-n="${k}">0</span></button>`).join('');
  bindSeg(rvEl('pr-rv-default'), (seg, k) => { reviewDefault = k; rvPaintAll(); rvApplyFilter(); });
  bindSeg(rvEl('pr-rv-bar-seg'), (seg, k) => rvBulk(k));
  f.addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (b) { reviewFilter = b.dataset.f; rvApplyFilter(); rvPaintSummary(); } });
  f.addEventListener('keydown', (e) => {
    const b = e.target.closest('[data-f]'); const d = ({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 })[e.key];
    if (!b || !d || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    const all = [...f.querySelectorAll('[data-f]')]; const nx = all[(all.indexOf(b) + d + all.length) % all.length];
    all.forEach(x => { x.tabIndex = -1; }); nx.tabIndex = 0; nx.focus();
  });
  rvEl('pr-rv-search').addEventListener('input', (e) => { reviewQuery = e.target.value.trim().toLowerCase(); rvApplyFilter(); rvPaintSummary(); });
  rvEl('pr-rv-accept-all').addEventListener('click', () => rvAcceptAll());
  rvEl('pr-rv-jump').addEventListener('click', () => { reviewFilter = 'belum'; rvApplyFilter(); rvPaintSummary(); const v = rvVisible(); if (v.length) rvSetCursor(v[0], true); });
  rvEl('pr-rv-undo-btn').addEventListener('click', () => rvUndo());
  rvEl('pr-rv-filldown').addEventListener('click', () => rvFillDown());
  rvEl('pr-rv-clearsel').addEventListener('click', () => { rvClearSel(); rvPaintSummary(); });
  rvEl('pr-rv-checkall').addEventListener('click', () => rvSelectAllVisible());
  window.addEventListener('resize', () => { if (rvActive()) rvPaintBarOffset(); });
}

function rvInfoText() {
  const labelSumber = reviewSumber === 'EXCEL' ? 'Excel' : reviewSumber === 'SCREENSHOT' ? 'screenshot' : 'teks';
  let info = `${reviewItems.length} item terbaca dari ${labelSumber}. Cek hasilnya, atur jenis, lalu simpan`;
  if (reviewSkipped.length) {
    info += `. ${reviewSkipped.length} baris disaring otomatis (bukan nama produk: header/basa-basi/simbol lepas): "${reviewSkipped.slice(0, 3).map(s => escapeHtmlAttr(s)).join('", "')}"${reviewSkipped.length > 3 ? ', dst.' : ''}`;
  }
  return info;
}

function rowHtml(it, i) {
  return `
    <div class="pr-review-row" role="group" aria-label="Item ${i + 1}" data-uid="${it.uid}" tabindex="-1">
      <button type="button" class="pr-rv-check" role="checkbox" aria-checked="false" aria-label="Pilih item ${i + 1}"></button>
      <input class="pr-rv-nama" value="${escapeHtmlAttr(it.raw_text)}" placeholder="Nama item" aria-label="Nama item ${i + 1}"/>
      <input class="pr-rv-qty" inputmode="numeric" value="${it.qty != null ? it.qty : ''}" placeholder="Qty" aria-label="Qty item ${i + 1}"/>
      <input class="pr-rv-pagu" inputmode="numeric" value="${it.pagu_satuan != null ? Number(it.pagu_satuan).toLocaleString('id-ID') : ''}" placeholder="opsional" aria-label="Pagu satuan item ${i + 1}"/>
      ${segHtml('pr-rv-konteks', it.konteks, 'Jenis item ' + (i + 1))}
      <button type="button" class="pr-review-del" aria-label="Hapus baris"><i class="ti ti-trash"></i></button>
    </div>`;
}

function renderReviewRows() {
  rvInitTools();
  S.prReviewInfo.innerHTML = rvInfoText();
  S.prReviewRows.innerHTML = reviewItems.length ? reviewItems.map(rowHtml).join('')
    : '<div class="pr-review-empty">Belum ada item. Tambah baris manual di bawah, atau klik "Kembali edit".</div>';
  reviewItems.forEach(it => rvPaintRow(it.uid));
  rvApplyFilter();
  const v = rvVisible();
  if (reviewCursor == null || !v.includes(reviewCursor)) reviewCursor = v[0] ?? null;
  if (reviewCursor != null) rvSetCursor(reviewCursor, false);
  rvPaintAll();
}

// ── Paint (update DOM seperlunya, tanpa render ulang) ──
function rvPaintRow(uid) {
  const it = rvFind(uid), row = rvRow(uid);
  if (!it || !row) return;
  const eff = rvEff(it);
  row.classList.toggle('is-belum', !eff && !it.sug);
  row.classList.toggle('is-usulan', !it.konteks && !!it.sug && !reviewDefault);
  row.classList.toggle('is-sel', reviewSel.has(uid));
  const ck = row.querySelector('.pr-rv-check'); ck.setAttribute('aria-checked', reviewSel.has(uid) ? 'true' : 'false');
  paintSeg(row.querySelector('.pr-rv-konteks'), { value: it.konteks, sug: it.sug && it.sug.konteks, def: reviewDefault, last: null });
  const sugTxt = it.sug && !it.konteks ? `Usulan ${it.sug.konteks} (${it.sug.why}). Tekan a untuk menerima.` : '';
  row.querySelector('.pr-rv-konteks').title = sugTxt || KONTEKS_HINT;
}
function rvPaintSummary() {
  const n = { semua: reviewItems.length, belum: 0, usulan: 0, diatur: 0 };
  let belumBerUsulan = 0;
  reviewItems.forEach(it => { if (!rvEff(it)) { n.belum++; if (it.sug) belumBerUsulan++; } if (!it.konteks && it.sug) n.usulan++; if (it.konteks) n.diatur++; });
  document.querySelectorAll('#pr-rv-filter [data-f]').forEach(b => {
    b.setAttribute('aria-pressed', b.dataset.f === reviewFilter ? 'true' : 'false');
    b.querySelector('.pr-rv-n').textContent = n[b.dataset.f];
  });
  const sugRow = rvEl('pr-rv-sugrow');
  sugRow.hidden = !n.usulan;
  rvEl('pr-rv-sug-text').textContent = `${n.usulan} usulan dari teks, belum dikonfirmasi`;
  const warn = rvEl('pr-rv-warn');
  warn.hidden = !n.belum;
  rvEl('pr-rv-warn-text').textContent = `${n.belum} item belum dikontekskan${belumBerUsulan ? ` (${belumBerUsulan} punya usulan)` : ''}. Tidak menghalangi simpan.`;
  rvEl('pr-rv-undo').hidden = !reviewMsg;
  rvEl('pr-rv-undo-btn').hidden = !reviewUndo.length;
  rvEl('pr-rv-undo-text').textContent = reviewMsg;
  // checkbox "pilih semua yang tampil"
  const vis = rvVisible(); const nSel = vis.filter(u => reviewSel.has(u)).length;
  const ca = rvEl('pr-rv-checkall');
  ca.setAttribute('aria-checked', !nSel ? 'false' : nSel === vis.length ? 'true' : 'mixed');
  // bar aksi
  const bar = rvEl('pr-rv-bar');
  bar.hidden = !reviewSel.size;
  rvEl('pr-rv-bar-n').textContent = `${reviewSel.size} dipilih`;
  paintSeg(rvEl('pr-rv-bar-seg'), { value: null, last: reviewLast });
  if (reviewSel.size) rvPaintBarOffset();
}
function rvPaintAll() {
  rvPaintDefault();
  rvPaintSummary();
}
function rvPaintDefault() {
  paintSeg(rvEl('pr-rv-default'), { value: reviewDefault, noneActive: true });
  reviewItems.forEach(it => rvPaintRow(it.uid));
}
// Bar aksi menempel DI ATAS tombol Simpan (yang juga sticky), jadi offset-nya = tinggi baris tombol itu.
function rvPaintBarOffset() {
  const act = S.prReviewWrap.querySelector('.pr-actions');
  if (act) rvEl('pr-rv-bar').style.setProperty('--pr-actions-h', act.offsetHeight + 'px');
}

function rvApplyFilter() {
  const vis = new Set(rvVisible());
  S.prReviewRows.querySelectorAll('.pr-review-row').forEach(r => { r.hidden = !vis.has(+r.dataset.uid); });
  [...reviewSel].forEach(u => { if (!vis.has(u)) reviewSel.delete(u); });   // seleksi tidak boleh menyimpan baris yang tak tampak
  S.prReviewRows.querySelectorAll('.pr-review-row').forEach(r => { r.classList.toggle('is-sel', reviewSel.has(+r.dataset.uid)); r.querySelector('.pr-rv-check').setAttribute('aria-checked', reviewSel.has(+r.dataset.uid) ? 'true' : 'false'); });
  if (reviewCursor != null && !vis.has(reviewCursor)) { const f = rvVisible()[0]; reviewCursor = null; if (f != null) rvSetCursor(f, false); }
  const empty = S.prReviewRows.querySelector('.pr-rv-filter-empty');
  if (!vis.size && reviewItems.length && !empty) S.prReviewRows.insertAdjacentHTML('beforeend', '<div class="pr-review-empty pr-rv-filter-empty">Tidak ada item di tampilan ini.</div>');
  else if ((vis.size || !reviewItems.length) && empty) empty.remove();
}

// ── Kursor & seleksi ──
function rvSetCursor(uid, focus) {
  S.prReviewRows.querySelectorAll('.pr-review-row.is-cursor').forEach(r => { r.classList.remove('is-cursor'); r.tabIndex = -1; });
  reviewCursor = uid;
  const row = uid != null ? rvRow(uid) : null;
  if (!row) return;
  row.classList.add('is-cursor'); row.tabIndex = 0;
  if (focus) { row.focus({ preventScroll: true }); row.scrollIntoView({ block: 'nearest' }); }
}
function rvStep(dir, extend) {
  const vis = rvVisible(); if (!vis.length) return;
  const i = reviewCursor == null ? -1 : vis.indexOf(reviewCursor);
  const ni = i < 0 ? (dir > 0 ? 0 : vis.length - 1) : Math.max(0, Math.min(vis.length - 1, i + dir));
  if (extend && i >= 0) {
    if (!reviewSel.has(vis[i])) { reviewSel.add(vis[i]); reviewAnchor = vis[i]; }
    if (ni !== i) { if (reviewSel.has(vis[ni])) reviewSel.delete(vis[i]); else reviewSel.add(vis[ni]); }
    [vis[i], vis[ni]].forEach(rvPaintRow);
  }
  rvSetCursor(vis[ni], true);
  if (extend) rvPaintSummary();
}
function rvToggleSel(uid, range) {
  if (range && reviewAnchor != null && reviewAnchor !== uid) {
    const vis = rvVisible(); const a = vis.indexOf(reviewAnchor), b = vis.indexOf(uid);
    if (a >= 0 && b >= 0) vis.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(u => reviewSel.add(u));
  } else {
    if (reviewSel.has(uid)) reviewSel.delete(uid); else reviewSel.add(uid);
    reviewAnchor = uid;
  }
  reviewItems.forEach(it => rvPaintRow(it.uid));
  rvPaintSummary();
}
function rvSelectAllVisible() {
  const vis = rvVisible(); const all = vis.length && vis.every(u => reviewSel.has(u));
  if (all) reviewSel.clear(); else vis.forEach(u => reviewSel.add(u));
  reviewItems.forEach(it => rvPaintRow(it.uid));
  rvPaintSummary();
  rvSay(all ? 'Pilihan dibersihkan' : `${vis.length} item dipilih`);
}
function rvClearSel() { reviewSel.clear(); reviewAnchor = null; reviewItems.forEach(it => rvPaintRow(it.uid)); }

// ── Mutasi jenis + undo ──
// Satu aksi = SATU entri undo, berapa pun jumlah barisnya. pairs = [{ uid, k }].
function rvApplyPairs(pairs, msg) {
  const prev = [];
  pairs.forEach(({ uid, k }) => { const it = rvFind(uid); if (it && it.konteks !== k) { prev.push({ uid, konteks: it.konteks }); it.konteks = k; } });
  if (!prev.length) return 0;
  reviewUndo.push({ prev }); if (reviewUndo.length > 50) reviewUndo.shift();
  prev.forEach(p => rvPaintRow(p.uid));
  const kk = pairs.map(p => p.k).filter(Boolean).pop();
  if (kk) { reviewLast = kk; try { localStorage.setItem(KONTEKS_LAST_KEY, kk); } catch (_) { /* tidak diingat */ } }
  reviewMsg = msg ? msg(prev.length) : `${prev.length} item → ${pairs[0].k || 'tanpa jenis'}`;
  rvSay(reviewMsg);
  rvPaintSummary();
  return prev.length;
}
const rvApply = (uids, k) => rvApplyPairs(uids.map(uid => ({ uid, k })));
function rvUndo() {
  const last = reviewUndo.pop(); if (!last) return false;
  last.prev.forEach(p => { const it = rvFind(p.uid); if (it) it.konteks = p.konteks; });
  reviewMsg = `Dibatalkan: ${last.prev.length} item dikembalikan`;
  rvSay(reviewMsg);
  reviewItems.forEach(it => rvPaintRow(it.uid));
  rvApplyFilter(); rvPaintSummary();
  return true;
}
function rvBulk(k) {            // bar aksi / digit saat ada seleksi
  const n = rvApply([...reviewSel], k);
  rvClearSel(); rvApplyFilter(); rvPaintSummary();
  if (!n) rvSay('Tidak ada yang berubah');
}
function rvAcceptAll() {        // semua usulan yang belum dikonfirmasi (satu entri undo)
  const pairs = reviewItems.filter(it => !it.konteks && it.sug).map(it => ({ uid: it.uid, k: it.sug.konteks }));
  if (!pairs.length) { rvSay('Tidak ada usulan'); return; }
  rvApplyPairs(pairs, (n) => `${n} usulan diterima`);
  rvApplyFilter(); rvPaintSummary();
}
function rvAcceptCursor() {
  const targets = reviewSel.size ? [...reviewSel] : [reviewCursor];
  const pairs = targets.map(rvFind).filter(it => it && !it.konteks && it.sug).map(it => ({ uid: it.uid, k: it.sug.konteks }));
  if (!pairs.length) { rvSay('Tidak ada usulan untuk diterima'); return; }
  rvApplyPairs(pairs, (n) => `${n} usulan diterima`);
  if (reviewSel.size) { rvClearSel(); rvApplyFilter(); rvPaintSummary(); }
}
// Isi ke bawah: jenis baris aktif disalin ke baris-baris tampil di bawahnya yang masih kosong, berhenti di baris
// pertama yang sudah punya jenis (sama seperti fill-down di spreadsheet).
function rvFillDown() {
  const vis = rvVisible(); const cur = reviewCursor ?? vis[0]; const src = cur != null ? rvFind(cur) : null;
  if (!src || !src.konteks) { rvSay('Baris aktif belum punya jenis untuk disalin'); return; }
  const targets = [];
  for (let i = vis.indexOf(cur) + 1; i < vis.length; i++) { const it = rvFind(vis[i]); if (it.konteks) break; targets.push(it.uid); }
  if (!targets.length) { rvSay('Tidak ada baris kosong di bawahnya'); return; }
  rvApply(targets, src.konteks);
  rvClearSel(); rvApplyFilter(); rvPaintSummary();
}
function rvKeySet(k) {          // digit 1/2/3/0
  if (reviewSel.size) { rvBulk(k); return; }
  const vis = rvVisible(); const uid = reviewCursor ?? vis[0]; if (uid == null) return;
  rvApply([uid], k);
  const nx = vis[vis.indexOf(uid) + 1];
  rvSetCursor(nx != null ? nx : uid, true);   // maju ke baris berikutnya supaya 100 item = 100 ketukan angka
}

// ── Event baris ──
bindSeg(S.prReviewRows, (seg, k) => {
  const uid = +seg.closest('.pr-review-row').dataset.uid;
  rvApply([uid], k); rvSetCursor(uid, false);
});
S.prReviewRows.addEventListener('input', (e) => {
  if (e.target.classList.contains('pr-rv-pagu')) {
    const digits = e.target.value.replace(/\D/g, '');
    e.target.value = digits ? Number(digits).toLocaleString('id-ID') : '';
  }
});
S.prReviewRows.addEventListener('change', (e) => {
  if (!e.target.classList.contains('pr-rv-nama')) return;
  const row = e.target.closest('.pr-review-row'); const it = rvFind(+row.dataset.uid); if (!it) return;
  it.raw_text = e.target.value.trim();
  it.sug = suggestKonteks(it.raw_text, it.satuan);   // nama berubah -> usulan dihitung ulang (jenis yang sudah dipilih tidak disentuh)
  rvPaintRow(it.uid); rvPaintSummary();
});
S.prReviewRows.addEventListener('focusin', (e) => {
  const row = e.target.closest('.pr-review-row');
  if (row && +row.dataset.uid !== reviewCursor) rvSetCursor(+row.dataset.uid, false);
});
S.prReviewRows.addEventListener('click', (e) => {
  const row = e.target.closest('.pr-review-row'); if (!row) return;
  const uid = +row.dataset.uid;
  if (e.target.closest('.pr-rv-check')) { rvToggleSel(uid, e.shiftKey); return; }
  if (e.target.closest('.pr-review-del')) {
    syncReviewItemsFromDom();
    reviewItems.splice(reviewItems.findIndex(x => x.uid === uid), 1);
    reviewSel.delete(uid);
    const wasCursor = reviewCursor === uid;
    const idx = [...S.prReviewRows.querySelectorAll('.pr-review-row:not([hidden])')].indexOf(row);
    row.remove();
    S.prReviewInfo.innerHTML = rvInfoText();
    if (wasCursor) { reviewCursor = null; const v2 = rvVisible(); const nx = v2[Math.min(idx, v2.length - 1)]; if (nx != null) rvSetCursor(nx, false); }
    S.prReviewRows.querySelectorAll('.pr-review-row').forEach((r, i) => { r.setAttribute('aria-label', 'Item ' + (i + 1)); });
    rvApplyFilter(); rvPaintSummary();
  }
});

// Baca ulang isi input di DOM balik ke reviewItems (nama/qty/pagu). Jenis, uid, dan usulan dipegang state, bukan DOM.
function syncReviewItemsFromDom() {
  S.prReviewRows.querySelectorAll('.pr-review-row').forEach((row) => {
    const it = rvFind(+row.dataset.uid); if (!it) return;
    it.raw_text = row.querySelector('.pr-rv-nama').value.trim();
    const qtyRaw = row.querySelector('.pr-rv-qty').value.trim();
    const q = qtyRaw ? parseInt(qtyRaw, 10) : null;
    it.qty = (q == null || isNaN(q)) ? null : q;
    it.pagu_satuan = S.parsePaguValue(row.querySelector('.pr-rv-pagu').value);
  });
}
// Jenis yang benar-benar disimpan: pilihan eksplisit > default sesi (usulan yang belum diterima TIDAK ikut).
function reviewItemsForSave() {
  return reviewItems.filter(it => it.raw_text).map(it => ({ ...it, konteks: rvEff(it) }));
}

S.prReviewAddBtn.addEventListener('click', () => {
  syncReviewItemsFromDom();
  const it = rvNewItem({});
  reviewItems.push(it);
  reviewFilter = 'semua'; reviewQuery = ''; rvEl('pr-rv-search').value = '';   // baris baru harus kelihatan
  renderReviewRows();
  const nama = rvRow(it.uid) && rvRow(it.uid).querySelector('.pr-rv-nama');
  if (nama) { nama.focus(); nama.scrollIntoView({ block: 'nearest' }); }
});

// Pintasan layar Periksa item. Didaftarkan di shared/shortcuts.js (scope 'modal'); index.js meneruskan lewat S.prReviewKeys
// (installShortcuts jalan SEBELUM modul ini terpasang, jadi handler dicari saat tombol ditekan). Semua handler
// return false kalau layar ini tidak sedang terbuka, supaya dialog lain tidak ikut terganggu.
S.prReviewKeys = (() => {
  const on = (fn, o) => (e) => {
    if (!rvActive()) return false;
    if (o && o.noTyping && isTyping(e.target)) return false;
    fn(e); return true;
  };
  return {
    'konv.rv.next': on(() => rvStep(1)),
    'konv.rv.prev': on(() => rvStep(-1)),
    'konv.rv.extendDown': on(() => rvStep(1, true)),
    'konv.rv.extendUp': on(() => rvStep(-1, true)),
    'konv.rv.set1': on(() => rvKeySet('SET')),
    'konv.rv.set2': on(() => rvKeySet('INSTRUMENT')),
    'konv.rv.set3': on(() => rvKeySet('UNIT')),
    'konv.rv.clear': on(() => rvKeySet(null)),
    'konv.rv.select': on(() => { const u = reviewCursor ?? rvVisible()[0]; if (u != null) rvToggleSel(u, false); }),
    'konv.rv.selectAll': on(() => rvSelectAllVisible(), { noTyping: true }),
    'konv.rv.fillDown': on(() => rvFillDown()),
    'konv.rv.accept': on(() => rvAcceptCursor()),
    'konv.rv.undo': (e) => { if (!rvActive() || isTyping(e.target) || !reviewUndo.length) return false; rvUndo(); return true; },
    'konv.rv.edit': (e) => {
      // Enter hanya bila fokus di baris itu sendiri / body; di tombol chip biarkan Enter memilih.
      if (!rvActive() || (e.target.closest && e.target.closest('button, .pr-seg-opt'))) return false;
      const u = reviewCursor ?? rvVisible()[0]; const r = u != null ? rvRow(u) : null;
      if (!r) return false; r.querySelector('.pr-rv-nama').focus(); return true;
    }
  };
})();

// ══════════════════════════════════════════
// AUTO-MATCH DI KEBUTUHAN RS (workspace)
// Alur: Periksa item (cek hasil baca) → Simpan → item masuk Kebutuhan RS → usulan produk muncul per baris.
// Aturan keputusan tetap di auto-konversi/resolver.js (AUTO / REVIEW / UNKNOWN). Di sini cuma tampilan + aksi:
//  - baris belum diputuskan menampilkan usulan teratas + tombol Pakai (satu klik),
//  - baris dibuka = semua kandidat, masing-masing dengan tombol Pakai,
//  - bar di atas daftar: filter per hasil + "Pakai N yang cocok" (hanya yang AUTO, tidak pernah REVIEW/UNKNOWN).
// Tombol Pakai memakai action yang SAMA dengan saran Dictionary (use-suggestion / attach-suggestion),
// jadi tidak ada jalur tulis baru ke server.
// ══════════════════════════════════════════
const AM_EMPTY_HTML = '<div class="kb-section-empty">Tidak ada item dengan hasil ini di tampilan ini.</div>';
// Label pendek alasan REVIEW (chip sub-filter dan tag di baris). Urutan = urutan tampil.
const AM_WHY = {
  atribut_beda: 'spek beda', ukuran_seri: 'ukuran seri', ukuran_dekat: 'ukuran dekat', ukuran_beda: 'ukuran beda',
  ambigu: 'ambigu', lain_brand: 'brand lain', beda_brand: 'beda brand', padanan_prosedur: 'padanan prosedur', hanya_katalog: 'dari katalog', perkiraan: 'perkiraan', belum_siap: 'perlu disiapkan', firm_belum_dicek: 'firm belum dicek', ada_dibuang: 'ada yang dibuang',
  audit_acak: 'pemeriksaan acak'
};
const AM_UKURAN_TXT = { cocok: 'ukuran cocok', dekat: 'ukuran dekat (≤ 0,5 cm)', beda: 'ukuran beda', varian: 'varian lain' };

function amFor(item) {
  if (amHidden) return null; // disembunyikan: baris tampil polos, tapi amMap utuh untuk "Tampilkan usulan"
  return item && item.status === 'PENDING' ? (amMap.get(item.id) || null) : null;
}
// Jumlah item PENDING yang punya usulan tersimpan — dihitung langsung dari amMap, tidak lewat amFor (yang ikut mode sembunyi).
function amStoredCount() {
  let n = 0;
  S.checklistItems.forEach(it => { if (it.status === 'PENDING' && amMap.has(it.id)) n++; });
  return n;
}
// Item PENDING yang belum punya usulan (belum sempat dicocokkan: run dihentikan, atau item baru ditambah).
function amMissingIds() {
  const ids = new Set();
  S.checklistItems.forEach(it => { if (it.status === 'PENDING' && String(it.raw_text || '').trim() && !amMap.has(it.id)) ids.add(it.id); });
  return ids;
}

function amCounts() {
  const n = { AUTO: 0, REVIEW: 0, UNKNOWN: 0 };
  S.checklistItems.forEach(it => { const m = amFor(it); if (m && n[m.hasil.status] != null) n[m.hasil.status]++; });
  return n;
}

function amReasonCounts() {
  const n = {};
  S.checklistItems.forEach(it => {
    const m = amFor(it);
    if (m && m.hasil.status === 'REVIEW') { const k = m.hasil.reason_key || 'perkiraan'; n[k] = (n[k] || 0) + 1; }
  });
  return n;
}

function amFilterItems(items) {
  if (amFilter === 'all' || !amMap.size) return items;
  return items.filter(it => {
    const m = amFor(it);
    if (!m || m.hasil.status !== amFilter) return false;
    return amFilter !== 'REVIEW' || amReason === 'all' || (m.hasil.reason_key || 'perkiraan') === amReason;
  });
}

function amInClip(kode) { return S.clipboard.some(c => c.kode_produk === kode); }

// Baris usulan di bawah nama item (baris ketutup): label hasil + produk teratas, satu baris.
function amLineHtml(item) {
  const m = amFor(item);
  if (!m || amDisembunyikan(m)) return '';
  const h = m.hasil;
  const kode = amTopKode(m);
  const { belum } = amSplit(h);
  const diblokir = h.status === 'UNKNOWN' && h.blocked && h.blocked.length;
  // Semua yang cocok ternyata belum siap jual: bukan usulan, jadi katakan itu saja (satu baris, tanpa nama produk).
  const hanyaBelum = !kode && belum.length && !amSplit(h).siap.length;
  const label = hanyaBelum ? 'Belum siap' : (diblokir ? 'Tidak dipakai' : (AM_LABEL[h.status] || h.status));
  const nama = kode ? (m.nama || kode) : '';
  const isi = kode
    ? `<span class="kb-am-prod">${escapeHtmlAttr(nama)}<span class="kb-am-kode">${escapeHtmlAttr(kode)}</span></span>`
    : `<span class="kb-am-prod kb-am-none">${hanyaBelum ? `${belum.length} produk cocok, belum siap dijual` : escapeHtmlAttr(h.reason)}</span>`;
  const why = h.status === 'REVIEW' && !hanyaBelum && AM_WHY[h.reason_key] ? `<span class="kb-am-why">${AM_WHY[h.reason_key]}</span>` : '';
  const cls = hanyaBelum ? 'review' : h.status.toLowerCase();
  return `<div class="kb-am-line ${cls}" title="${escapeHtmlAttr(h.reason)}"><span class="kb-am-label">${label}</span>${why}${isi}</div>`;
}

// Tombol Pakai di header baris (hanya kalau ada produk usulan). Kelas & action = saran Dictionary.
function amQuickBtnHtml(item) {
  const m = amFor(item);
  const top = m && !amDisembunyikan(m) ? amTopKode(m) : null;
  if (!top) return '';
  const kode = escapeHtmlAttr(top);
  return amInClip(top)
    ? `<button type="button" class="kb-dict-sugg-use kb-am-use" data-action="use-suggestion" data-id="${item.id}" data-kode="${kode}" title="Pasang ${kode} ke item ini">Pakai</button>`
    : `<button type="button" class="kb-dict-sugg-attach kb-am-use" data-action="attach-suggestion" data-id="${item.id}" data-kode="${kode}" title="Belum ada di Clipboard — ditambahkan dulu, lalu dipasang ke item ini">+ Pakai</button>`;
}

// Alternatif (kandidat selain usulan teratas): buka/tutup per item, bertahan walau baris dirender ulang.
// Default terbuka hanya kalau pilihannya memang antar-setara (ambigu / ukuran seri) atau tidak ada usulan teratas.
const amAltPref = new Map(); // item.id -> boolean
function amAltOpen(item, h) {
  if (amAltPref.has(item.id)) return amAltPref.get(item.id);
  return !h.kode_produk || h.reason_key === 'ambigu' || h.reason_key === 'ukuran_seri';
}

// Teks permintaan dengan penanda selisih terhadap usulan teratas (dipakai di judul baris yang terbuka).
// null = tidak ada usulan teratas / tidak ada selisih yang perlu ditandai → pemanggil pakai teks polos.
function amRequestHtml(item) {
  const m = amFor(item);
  if (!m || amDisembunyikan(m) || !amTopKode(m)) return null;
  const top = (m.hasil.candidates || []).find(c => c.kode === m.kode);
  if (!top) return null;
  const bd = bandingkan(item.raw_text, top.nama);
  return tokensToHtml(bd.diminta, escapeHtmlAttr, 'Beda dari produk usulan');
}

// Klik "Pakai" MANUAL pada produk yang belum siap dijual: cuma peringatan (toast), TIDAK memblokir — staff kadang sengaja
// memilihnya. Blokir keras (SINGLE USE / tidak ada di katalog) tidak sampai sini: produknya memang tidak jadi usulan.
function amWarnBelumSiap(item, kode) {
  const m = amFor(item);
  const c = m && (m.hasil.candidates || []).find(x => x.kode === kode);
  if (c && c.siap && !c.siap.ok) S.showToast('Produk ini belum siap dijual', 'warning', { detail: `${kode}: ${c.siap.kurang.join(', ')}.` });
}

function amUseBtnHtml(item, kode) {
  const k = escapeHtmlAttr(kode);
  return amInClip(kode)
    ? `<button type="button" class="kb-dict-sugg-use kb-cmp-use" data-action="use-suggestion" data-id="${item.id}" data-kode="${k}" title="Pasang ${k} ke item ini">Pakai</button>`
    : `<button type="button" class="kb-dict-sugg-attach kb-cmp-use" data-action="attach-suggestion" data-id="${item.id}" data-kode="${k}" title="Belum ada di Clipboard sesi ini — ditambahkan dulu, lalu dipasang ke item ini">+ Pakai</button>`;
}

// Satu kandidat: nama produk (selisihnya ditandai), baris kecil kode + asal usulan, tombol Pakai.
function amCandRowHtml(item, c, top) {
  const bd = bandingkan(item.raw_text, c.nama);
  const judul = bd.selisih.map(x => `${x.nama}: minta ${x.minta}, produk ${x.ada}`).join('; ');
  const asal = c.src === 'katalog' ? 'dari katalog' : (c.src === 'varian' ? 'ukuran lain' : (c.freq ? `${c.freq.toLocaleString('id-ID')}× dipakai` : ''));
  // Beda spesifikasi yang tidak tertangkap penanda di nama (mis. mm, fig): tetap disebut, jangan hilang diam-diam.
  const catatan = (c.diff || []).length && !bd.adaBeda ? `<span class="kb-cmp-note">${escapeHtmlAttr(c.diff.join('; '))}</span>` : '';
  // Status link/AKD SELALU tampil per baris (siap = "Link ✓", belum = apa yang kurang), bukan cuma kalau belum siap:
  // staf harus bisa langsung melihat alternatif mana yang sudah ada linknya. Tidak dicek (mode Swasta) = tanpa chip.
  const siapNote = siapChipsHtml(c.siap, escapeHtmlAttr);
  const ukTitle = AM_UKURAN_TXT[c.ukuran] ? ` title="${escapeHtmlAttr(AM_UKURAN_TXT[c.ukuran])}"` : '';
  return `<div class="kb-cmp-row${top ? ' top' : ''}">
    <div class="kb-cmp-info">
      <div class="kb-cmp-name">${top ? '<span class="kb-cmp-arrow" aria-hidden="true">→</span>' : ''}${tokensToHtml(bd.produk, escapeHtmlAttr, judul)}</div>
      <div class="kb-cmp-sub"><span class="kb-cmp-kode"${ukTitle}>${escapeHtmlAttr(c.kode)}</span>${asal ? `<span>${escapeHtmlAttr(asal)}</span>` : ''}${catatan}${siapNote}</div>
    </div>
    ${amUseBtnHtml(item, c.kode)}
  </div>`;
}

// Isi detail baris (baris terbuka): alasan, usulan teratas, lalu alternatif (dilipat kecuali pilihannya setara).
function amCandidatesHtml(item) {
  const m = amFor(item);
  if (!m || amDisembunyikan(m)) return '';
  const h = m.hasil;
  const { siap: cands, belum } = amSplit(h);
  const top = cands.find(c => c.kode === h.kode_produk) || null;
  const alts = cands.filter(c => c !== top);
  const open = amAltOpen(item, h);
  const lex = (h.lexicon_hits || []).map(x =>
    `<div class="kb-cmp-hint">“${escapeHtmlAttr(x.token)}” dikenali dari riwayat sebagai ${escapeHtmlAttr(x.kanonik)} (${x.n}×, ${Math.round(x.share * 100)}%).</div>`).join('');
  const blk = (h.blocked && h.blocked.length)
    ? `<div class="kb-cmp-hint">${h.blocked.length} usulan tidak bisa dipakai (dibuang): ${h.blocked.slice(0, 2).map(b => escapeHtmlAttr(b.kode + ' — ' + b.alasan)).join('; ')}${h.blocked.length > 2 ? '; …' : ''}</div>` : '';
  const altToggle = alts.length && top
    ? `<button type="button" class="kb-cmp-alt-toggle" data-action="toggle-alt" data-id="${item.id}" aria-expanded="${open}"><i class="ti ti-chevron-right" aria-hidden="true"></i>${alts.length} alternatif</button>` : '';
  const altRows = alts.length && (open || !top)
    ? `<div class="kb-cmp-alts">${alts.map(c => amCandRowHtml(item, c, false)).join('')}</div>` : '';
  // Produk cocok tapi belum siap dijual: bukan usulan. Dilipat jadi satu baris; dibuka hanya kalau staff memang mau menyiapkan/memakainya.
  const belumOpen = amBelumOpen.has(item.id);
  const belumToggle = belum.length
    ? `<button type="button" class="kb-cmp-alt-toggle kb-cmp-belum" data-action="toggle-belum" data-id="${item.id}" aria-expanded="${belumOpen}"><i class="ti ti-chevron-right" aria-hidden="true"></i>${belum.length} produk belum siap dijual</button>` : '';
  const belumRows = belum.length && belumOpen
    ? `<div class="kb-cmp-alts kb-cmp-alts-belum">${belum.map(c => amCandRowHtml(item, c, false)).join('')}</div>` : '';
  // Permintaan umum: tawarkan SEMUA yang siap sebagai skenario (tiap produk @ qty diminta). Tidak pernah dipasang diam-diam
  // oleh "Pakai N yang cocok" — isi penawaran ke RS berubah, jadi harus diklik sadar.
  const nb = h.bundle && h.bundle.length >= 2 && item.status === 'PENDING' ? h.bundle.length : 0;
  const dq = Number(item.qty_diminta);
  const bundleBtn = nb ? `<div class="kb-cmp-hint"><button type="button" class="kb-am-btn" data-action="use-bundle" data-id="${item.id}" title="Pasang ${nb} opsi sekaligus, masing-masing @ qty diminta">Tawarkan semua ${nb} opsi</button> permintaan umum — tiap opsi @ ${dq >= 1 ? escapeHtmlAttr(String(dq)) : 'qty diminta'}, buat bandingan anggaran.</div>` : '';
  return `<div class="kb-cmp">
    <p class="kb-cmp-why">${escapeHtmlAttr(h.reason)}</p>${lex}
    ${top ? amCandRowHtml(item, top, true) : ''}${bundleBtn}
    ${altToggle}${altRows}${belumToggle}${belumRows}${blk}
  </div>`;
}

// ── Progres pencocokan ──
// Kerangka bar dirender SEKALI (amRunHtml); selama run hanya angka/lebar/teks yang diperbarui (paintAmProgress), dan itupun
// dibatasi satu kali per frame (queueAmPaint). 400+ item × innerHTML per item adalah salah satu penyebab UI terasa tersendat.
function amFmtSisa(detik) {
  if (detik < 60) return `± ${Math.max(5, Math.round(detik / 5) * 5)} dtk`;
  const m = Math.floor(detik / 60), d = Math.round((detik % 60) / 10) * 10;
  return d === 60 ? `± ${m + 1} mnt` : `± ${m} mnt${d ? ' ' + d + ' dtk' : ''}`;
}
function amRunHtml() {
  const { n, t } = amProgress;
  const stopping = !!(amAbort && amAbort.aborted);
  return `<div class="kb-am-row kb-am-run">
    <div class="kb-am-prog">
      <div class="kb-am-prog-line"><i class="ti ti-loader-2 kb-am-spin" aria-hidden="true"></i><span class="kb-am-prog-txt">${stopping ? 'Menghentikan… ' : 'Mencocokkan '}<b data-am-n>${n}</b> dari ${t} item</span><span class="kb-am-prog-eta" data-am-eta></span></div>
      <div class="kb-am-track" role="progressbar" aria-label="Kemajuan pencocokan" aria-valuemin="0" aria-valuemax="${t}" aria-valuenow="${n}"><span data-am-fill></span></div>
      <div class="kb-am-prog-tally" data-am-tally></div>
    </div>
    <button type="button" class="kb-am-btn" data-am="cancel"${stopping ? ' disabled' : ''}>Hentikan</button>
  </div>`;
}
function paintAmProgress() {
  if (!amBarEl || !amRunning) return;
  const nEl = amBarEl.querySelector('[data-am-n]');
  if (!nEl) return;
  const { n, t } = amProgress;
  nEl.textContent = String(n);
  const fill = amBarEl.querySelector('[data-am-fill]');
  if (fill) fill.style.width = (t ? Math.min(100, (n / t) * 100) : 0).toFixed(1) + '%';
  const track = amBarEl.querySelector('.kb-am-track');
  if (track) track.setAttribute('aria-valuenow', String(n));
  const eta = amBarEl.querySelector('[data-am-eta]');
  if (eta) {
    const detik = (performance.now() - amT0) / 1000;
    // Perkiraan baru ditampilkan setelah cukup contoh (8 item / 4 dtk); sebelum itu angkanya cuma tebakan liar.
    eta.textContent = n >= 8 && detik >= 4 && n < t ? amFmtSisa(((t - n) * detik) / n) : '';
  }
  const ty = amBarEl.querySelector('[data-am-tally]');
  if (ty) ty.innerHTML = `<span class="kb-am-t kb-am-t-auto"><b>${amTally.AUTO}</b> cocok</span><span class="kb-am-t kb-am-t-review"><b>${amTally.REVIEW}</b> cek dulu</span><span class="kb-am-t kb-am-t-unknown"><b>${amTally.UNKNOWN}</b> tidak ketemu</span>`;
}
let amPaintQueued = false;
function queueAmPaint() {
  if (amPaintQueued) return;
  amPaintQueued = true;
  requestAnimationFrame(() => { amPaintQueued = false; paintAmProgress(); });
}

// Bar di atas daftar (#kb-am-bar, di luar #kb-list supaya tidak ikut ter-scroll):
//   belum ada hasil → ajakan + tombol; jalan → progres angka; ada hasil → filter + aksi.
function renderAmBar() {
  if (!amBarEl) return;
  const pending = S.checklistItems.filter(i => i.status === 'PENDING').length;
  const n = amCounts();
  const total = n.AUTO + n.REVIEW + n.UNKNOWN;
  // Mode sembunyi: yang bukan AUTO tidak jadi chip & tidak bisa difilter; cukup satu tautan "N disembunyikan".
  const disembunyi = amSembunyi() ? n.REVIEW + n.UNKNOWN : 0;
  if (disembunyi) { n.REVIEW = 0; n.UNKNOWN = 0; if (amFilter === 'REVIEW' || amFilter === 'UNKNOWN') amFilter = 'all'; }
  if (amFilter !== 'all' && !n[amFilter]) amFilter = 'all'; // filter yang sudah kosong dilepas, bukan dibiarkan menampilkan daftar kosong
  const rc = amReasonCounts();
  if (amFilter !== 'REVIEW' || (amReason !== 'all' && !rc[amReason])) amReason = 'all';

  if (amRunning) {
    amBarEl.hidden = false;
    amBarEl.innerHTML = amRunHtml();
    paintAmProgress();
    return;
  }
  // Usulan disembunyikan (tombol mata-coret): datanya masih ada di amMap, jadi cukup satu tombol untuk memunculkannya lagi —
  // tidak perlu "Cocokkan otomatis" ulang (400+ item = menunggu lama untuk hasil yang sebenarnya sudah ada).
  if (amHidden) {
    const stored = amStoredCount();
    if (stored) {
      amBarEl.hidden = false;
      amBarEl.innerHTML = `<div class="kb-am-row">
        <span class="kb-am-status"><i class="ti ti-eye-off" aria-hidden="true"></i>${stored} usulan disembunyikan</span>
        <div class="kb-am-acts"><button type="button" class="kb-am-btn" data-am="unhide"><i class="ti ti-eye" aria-hidden="true"></i> Tampilkan usulan</button></div>
      </div>`;
      return;
    }
    amHidden = false; // tidak ada lagi yang disembunyikan (semua sudah diputuskan) — kembali ke bar biasa
  }
  if (!total) {
    if (!pending) { amBarEl.hidden = true; amBarEl.innerHTML = ''; return; }
    amBarEl.hidden = false;
    amBarEl.innerHTML = `<div class="kb-am-row">
      <span class="kb-am-status">${pending} item belum dicek</span>
      <button type="button" class="kb-am-btn" data-am="run"><i class="ti ti-wand"></i> Cocokkan otomatis</button>
    </div>`;
    return;
  }
  // Urutan = urutan kerja: yang butuh keputusan dulu. Chip kosong tidak ditampilkan (kecuali yang sedang aktif).
  const chip = (key, label, count) => (count || amFilter === key)
    ? `<button type="button" class="kb-filter-chip${amFilter === key ? ' active' : ''}" data-am="filter" data-key="${key}" aria-pressed="${amFilter === key}">${label}<span class="kb-filter-count">${count}</span></button>` : '';
  const rchip = (key, count) =>
    `<button type="button" class="kb-filter-chip${amReason === key ? ' active' : ''}" data-am="reason" data-key="${key}" aria-pressed="${amReason === key}">${AM_WHY[key] || key}<span class="kb-filter-count">${count}</span></button>`;
  const reasonRow = amFilter === 'REVIEW' && Object.keys(rc).length > 1
    ? `<div class="kb-am-chips kb-am-reasons" aria-label="Alasan perlu dicek">${Object.keys(AM_WHY).filter(k => rc[k]).map(k => rchip(k, rc[k])).join('')}</div>` : '';
  const missing = amMissingIds().size;
  amBarEl.hidden = false;
  amBarEl.innerHTML = `<div class="kb-am-row">
    <div class="kb-am-chips" role="group" aria-label="Saring hasil pencocokan">${chip('REVIEW', 'Cek dulu', n.REVIEW)}${chip('AUTO', 'Cocok', n.AUTO)}${chip('UNKNOWN', 'Tidak ketemu', n.UNKNOWN)}</div>
    <div class="kb-am-acts">
      ${missing ? `<button type="button" class="kb-am-link" data-am="run" title="Cocokkan item yang belum punya usulan (hasil yang sudah ada tidak diulang)">${missing} belum dicocokkan · lanjutkan</button>` : ''}
      ${disembunyi ? `<button type="button" class="kb-am-link" data-am="peek">${disembunyi} tanpa usulan yang yakin · lihat</button>` : (amPeek && amPolicy().ragu === 'sembunyi' ? '<button type="button" class="kb-am-link" data-am="peek">sembunyikan lagi</button>' : '')}
      <button type="button" class="kb-am-mode" data-am="settings" title="Atur seberapa agresif Auto-Match di Preferensi">${AM_PRESET_NAMA[amPresetKey()]}<i class="ti ti-adjustments-horizontal" aria-hidden="true"></i></button>
      ${n.AUTO ? `<button type="button" class="kb-am-btn primary" data-am="apply"${amApplying ? ' disabled' : ''}>${amApplying ? 'Memasang…' : `Pakai ${n.AUTO} yang cocok`}</button>` : ''}
      <button type="button" class="kb-am-ico" data-am="rerun" title="Cocokkan ulang (data produk/riwayat bisa berubah)" aria-label="Cocokkan ulang"><i class="ti ti-wand" aria-hidden="true"></i></button>
      <button type="button" class="kb-am-ico" data-am="clear" title="Sembunyikan usulan — bisa ditampilkan lagi tanpa mencocokkan ulang (keputusan yang sudah dipasang tidak berubah)" aria-label="Sembunyikan usulan"><i class="ti ti-eye-off" aria-hidden="true"></i></button>
    </div>
  </div>${reasonRow}`;
}

// Jalankan pencocokan untuk item yang BELUM diputuskan (PENDING). onlyIds (Set) = batasi ke item tertentu,
// mis. item yang baru ditambahkan. Gagal di satu item tidak menggagalkan yang lain (ditangani resolver).
async function runWorkspaceAutoMatch(onlyIds) {
  if (amRunning || amApplying) return;
  const targets = S.checklistItems.filter(it =>
    it.status === 'PENDING' && String(it.raw_text || '').trim() && (!onlyIds || onlyIds.has(it.id)));
  if (!targets.length) { S.showToast('Semua item sudah diputuskan — tidak ada yang perlu dicocokkan.'); return; }
  amRunning = true;
  amHidden = false;                       // run baru = usulan harus kelihatan
  amAbort = { aborted: false };
  const abort = amAbort;
  amTally = { AUTO: 0, REVIEW: 0, UNKNOWN: 0 };
  amT0 = performance.now();
  let berhasil = false;
  amProgress = { n: 0, t: targets.length };
  renderAmBar();
  const done = [];                        // { id, raw_text, hasil } — dikumpulkan lewat onItem, jadi Hentikan tidak membuang yang sudah beres
  try {
    // Persiapan per item (parse spesifikasi + varian query) murni CPU. Untuk 400+ item dikerjakan per potongan dengan jeda
    // ke browser, supaya tombol Hentikan dan animasi bar tetap hidup sejak detik pertama.
    const items = [];
    for (let k = 0; k < targets.length; k++) {
      const it = targets[k];
      items.push({
        nama: it.raw_text,
        qty: it.qty_diminta != null ? Number(it.qty_diminta) : null,
        specs: extractSpecs(it.raw_text),
        variants: buildVariants(it.raw_text),
        understood: understand(it.raw_text),
        konteks: it.konteks_minta || null // SET / INSTRUMENT / UNIT bila sudah diisi (lihat auto-konversi/resolver.js)
      });
      if ((k + 1) % 25 === 0) await new Promise(r => setTimeout(r, 0));
    }
    firmCheck.clear(); // link_v6 bisa berubah sejak pencocokan terakhir — ambil ulang
    const lexicon = await getAmLexicon(false);
    const res = await resolveItems(items, S.rpc, {
      lexicon,
      auditRate: AM_AUDIT_RATE,
      firmCheck: S.modeSwastaOutput ? null : firmCheck,
      // Pill brand Cari Produk dipilih = HANYA brand itu. Tanpa pill: ROBUST didahulukan, dan item yang tidak ada di ROBUST dinilai ulang di
      // brand lain (SKYLAR, ADLER, PICMA, ...; lihat resolveItemLintasBrand). Brand kosong = BUKAN brand mana pun (tidak dianggap cocok).
      brand: S.selectedBrand || 'ROBUST',
      brandLain: !S.selectedBrand,
      prosedur: await getProsedurIndeks(),
      brandOf: async (kodes) => { const rows = kodes.map(k => ({ kode_produk: k })); await S.enrichBrand(rows); return new Map(rows.map(r => [r.kode_produk, r.brand || ''])); },
      signal: abort,
      // Hasil disimpan SEGERA saat satu item selesai (bukan menunggu semua). Daftar belum digambar ulang — itu sekali di akhir.
      onItem: (i, r) => {
        const h = r.hasil;
        amMap.set(targets[i].id, { hasil: h, kode: h.kode_produk, nama: h.nama_produk });
        if (amTally[h.status] != null) amTally[h.status]++;
        done.push({ k: i, r });
      },
      // n = jumlah item SELESAI (naik terus). Digambar paling sering sekali per frame.
      onProgress: (n, t) => { amProgress = { n, t }; queueAmPaint(); }
    });
    const hasilRes = done.map(d => d.r);
    if (hasilRes.length) {
      amLog(hasilRes.map((r, j) => ({
        permintaan_id: S.checklistPermintaanId != null ? String(S.checklistPermintaanId) : null, item_id: String(targets[done[j].k].id),
        raw_text: targets[done[j].k].raw_text, usulan_kode: r.hasil.kode_produk || null, status: r.hasil.status, confidence: r.hasil.confidence,
        reason_key: r.hasil.reason_key || null, diff: r.hasil.diff || [], keputusan_kode: null, aksi: 'diusulkan',
        ...amLogExtra(r.hasil), via: null
      })));
    }
    amFilter = 'all'; amReason = 'all';
    const sm = summarize(hasilRes);
    berhasil = hasilRes.length > 0;
    if (abort.aborted) {
      S.showToast(`Auto-Match dihentikan: ${hasilRes.length} dari ${targets.length} item sudah dicocokkan`, hasilRes.length ? 'success' : 'info',
        hasilRes.length < targets.length ? { detail: 'Sisanya bisa dilanjutkan dari bar di atas daftar.' } : undefined);
    } else if (amPolicy().yakin !== 'pasang' || !sm.AUTO) {
      // Mode 'pasang': ringkasan dibungkus jadi satu toast oleh applyAllAuto di bawah; selain itu tampil seperti biasa.
      S.showToast(`Auto-Match selesai: ${sm.AUTO} cocok, ${sm.REVIEW} perlu dicek, ${sm.UNKNOWN} tidak ketemu`, 'success');
    }
  } catch (err) {
    S.showToast('Auto-Match gagal: ' + err.message, 'error',
      done.length ? { detail: `${done.length} item yang sudah selesai tetap tersimpan — lanjutkan dari bar di atas daftar.` } : undefined);
  } finally {
    amRunning = false;
    amAbort = null;
    renderChecklist();
  }
  // Yakin → langsung pasang (hanya AUTO; pemeriksaan acak tetap jalan karena sebagian AUTO sengaja diturunkan jadi REVIEW).
  // Tiap item punya tautan "Batal" di barisnya. Run yang dihentikan TIDAK memasang apa pun otomatis: staff sengaja berhenti.
  if (berhasil && !abort.aborted && amPolicy().yakin === 'pasang') await applyAllAuto();
}
S.runWorkspaceAutoMatch = runWorkspaceAutoMatch;

// "Pakai N yang cocok": HANYA usulan berstatus AUTO. Berurutan (bukan paralel) karena menambah produk ke Clipboard
// dan menulis status item lewat jalur yang sama dgn tombol Pakai satuan. Item yang sudah diputuskan rekan dilewati.
async function applyAllAuto() {
  if (amRunning || amApplying) return;
  const picks = S.checklistItems
    .map(it => ({ item: it, m: amFor(it) }))
    .filter(x => x.m && x.m.hasil.status === 'AUTO' && x.m.kode);
  if (!picks.length) return;
  amApplying = true;
  amVia = 'bulk';
  renderAmBar();
  let ok = 0;
  const gagalList = []; // hasil gagal per item → satu toast ringkasan di akhir (bukan satu toast error per item)
  try {
    for (const { item, m } of picks) {
      if (item.status !== 'PENDING') continue;
      try {
        const h = await S.pasangKeClipboard(m.kode);
        if (!h.ok) { gagalList.push(h); continue; }
        await markItemTerpenuhiWithSingleProduk(item, m.kode);
        if (item.status === 'TERPENUHI') { ok++; amMap.delete(item.id); } else gagalList.push({ ok: false, status: 'gagal_pasang', kode: m.kode });
      } catch (err) { console.error('[auto-match] gagal pasang', m.kode, err); gagalList.push({ ok: false, status: 'galat', kode: m.kode, detail: err && err.message }); }
    }
  } finally {
    amApplying = false;
    amVia = 'satuan';
    // Lanjutkan kerja di yang masih perlu keputusan: buka baris "Cek dulu" pertama (kalau ada).
    const next = S.checklistItems.find(it => { const x = amFor(it); return x && x.hasil.status === 'REVIEW'; });
    S.checklistExpandedId = next ? next.id : null;
    renderChecklist();
    if (next && typeof S.maybeFetchSuggestionForExpanded === 'function') S.maybeFetchSuggestionForExpanded();
  }
  const gagal = gagalList.length;
  S.showToast(`Auto-Match: ${ok} item terpasang`, ok ? 'success' : 'error',
    gagal ? { detail: `${gagal} item tidak terpasang (${S.ringkasGagalClip(gagalList)}) — pilih manual di Kebutuhan RS.` } : undefined);
}

if (amBarEl) amBarEl.addEventListener('click', (e) => {
  const b = e.target.closest('[data-am]');
  if (!b || b.disabled) return;
  const act = b.dataset.am;
  if (act === 'run') runWorkspaceAutoMatch(amMap.size ? amMissingIds() : undefined); // sudah ada hasil → lanjutkan yang belum saja
  else if (act === 'rerun') { amMap.clear(); amHidden = false; amFilter = 'all'; amReason = 'all'; amLexicon = null; runWorkspaceAutoMatch(); }
  // Sembunyikan ≠ buang: amMap dibiarkan utuh, jadi tombol Tampilkan usulan mengembalikan semuanya seketika.
  else if (act === 'clear') { amHidden = true; amFilter = 'all'; amReason = 'all'; renderChecklist(); }
  else if (act === 'unhide') { amHidden = false; renderChecklist(); }
  else if (act === 'cancel') { if (amAbort) { amAbort.aborted = true; renderAmBar(); } }
  else if (act === 'filter') { amFilter = (amFilter === b.dataset.key) ? 'all' : b.dataset.key; amReason = 'all'; renderChecklist(); }
  else if (act === 'reason') { amReason = (amReason === b.dataset.key) ? 'all' : b.dataset.key; renderChecklist(); }
  else if (act === 'apply') applyAllAuto();
  else if (act === 'peek') { amPeek = !amPeek; renderChecklist(); }
  else if (act === 'settings') { if (typeof S.openSettingsModal === 'function') S.openSettingsModal(); }
});
// Dipanggil index.js setiap Preferensi Auto-Match berubah: tampilan ikut berubah seketika, tanpa mencocokkan ulang.
// Preferensi diganti ke "Otomatis" saat usulan yang yakin SUDAH ada (hasil pencocokan lama / percobaan pasang yang gagal):
// pasang sekarang. Dulu auto-pasang hanya jalan di ujung pencocokan, sehingga staf tetap harus menekan tombol.
S.amSettingsChanged = () => {
  amPeek = false;
  renderChecklist();
  if (amPolicy().yakin === 'pasang' && !amRunning && !amApplying) applyAllAuto(); // tanpa usulan AUTO = langsung return
};

// Switch footer layar Periksa item: jalankan Auto-Match otomatis begitu item tersimpan? (diingat per browser)
const prAmOpt = document.getElementById('pr-am-opt');
const prAmSwitch = document.getElementById('pr-am-switch');
function paintAmSwitch() {
  if (!prAmSwitch) return;
  prAmSwitch.classList.toggle('on', amAutoOn);
  prAmSwitch.setAttribute('aria-checked', String(amAutoOn));
}
function toggleAmSwitch() {
  amAutoOn = !amAutoOn;
  try { localStorage.setItem(AM_PREF_KEY, amAutoOn ? '1' : '0'); } catch (_) { /* tidak fatal */ }
  paintAmSwitch();
}
paintAmSwitch();
if (prAmOpt) prAmOpt.addEventListener('click', toggleAmSwitch);
if (prAmSwitch) prAmSwitch.addEventListener('keydown', (e) => {
  if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleAmSwitch(); }
});

// "Kembali edit" cuma balik ke form input (teks/excel/screenshot) — item hasil
// parse yang lagi di-review dibuang, jadi kalau lanjut lagi nanti diparse ulang
// dari input aslinya (bukan dari state review yang sempat diedit).
S.prReviewBackBtn.addEventListener('click', () => {
  S.prReviewWrap.style.display = 'none';
  rvSetWide(false);
  S.prFormWrap.style.display = '';
  prSetMode(prMode, true); // pulihkan judul + sub sesuai mode (keepReview: wrap form/review tidak disentuh)
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
    pagu_satuan: it.pagu_satuan != null ? it.pagu_satuan : null,
    konteks: normKonteks(it.konteks) // diabaikan add_permintaan_items; ditulis lewat apiSetKonteksItems di bawah
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
    // Dulu satu-satu berurutan (41 item = 41 panggilan beruntun). Sekarang 6 sekaligus; RPC-nya tetap yang sama.
    const PARALEL = 6;
    for (let i = 0; i < inserted.length; i += PARALEL) {
      await Promise.all(inserted.slice(i, i + PARALEL).map(async (it) => {
        await S.rpc('move_permintaan_item_section', { p_item_id: it.id, p_section_id: sectionId });
        it.section_id = sectionId;
      }));
    }
  }

  // Jenis (konteks) item baru. add_permintaan_items belum menerimanya, jadi ditulis lewat RPC khusus. Item hasil
  // dicocokkan ke baris input lewat urutan DAN teksnya; kalau tidak yakin, dilewati (lebih baik kosong daripada salah
  // jenis, karena konteks mengubah usulan resolver). Gagal di sini TIDAK menggagalkan simpan: item sudah tersimpan.
  const norm = s => String(s == null ? '' : s).trim().toLowerCase();
  const dipakai = new Set();
  const rows = [];
  let dilewati = 0;
  payloadItems.forEach((p, i) => {
    if (!p.konteks) return;
    let tgt = inserted[i] && norm(inserted[i].raw_text) === norm(p.raw_text) ? inserted[i] : null;
    if (!tgt || dipakai.has(tgt.id)) tgt = inserted.find(x => !dipakai.has(x.id) && norm(x.raw_text) === norm(p.raw_text)) || null;
    if (!tgt) { dilewati++; return; }
    dipakai.add(tgt.id);
    rows.push({ id: tgt.id, konteks: p.konteks });
  });
  if (rows.length) {
    try {
      await apiSetKonteksItems(rows);
      rows.forEach(r => { const it = inserted.find(x => x.id === r.id); if (it) it.konteks_minta = r.konteks; });
    } catch (err) {
      dilewati += rows.length;
      console.error('[permintaan-rs] simpan jenis item gagal', err);
    }
  }
  if (dilewati) PNMToast.show(`Jenis ${dilewati} item belum tersimpan`, 'warning', { detail: 'Item sudah masuk. Atur Jenis-nya lewat Edit item.' });
  return inserted;
}

// Jenis (konteks) banyak item sekaligus: rows = [{ id, konteks }], konteks null = kosongkan. Satu RPC (lihat
// supabase/2026-11-21_konteks_saat_intake.sql), cek allowed_users di server.
async function apiSetKonteksItems(rows) {
  if (!rows.length) return;
  const { error } = await S.rpc('update_permintaan_item_konteks_multi', { p_rows: rows });
  if (error) throw new Error(error.message || error.hint || 'Gagal menyimpan jenis item (cek izin akun / RPC update_permintaan_item_konteks_multi)');
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
  const items = reviewItemsForSave();   // konteks = pilihan eksplisit, kalau kosong default sesi
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
      const beforeIds = new Set((S.checklistItems || []).map(it => it.id));
      const n = await addItemsToActivePermintaan(items);
      S.showToast(`${n} item ditambahkan ke Permintaan RS`, 'success', { detail: `Total ${S.checklistItems.length} item.` });
      closePrModal();
      S.prTeks.value = ''; S.prFile.value = '';
      // Auto-Match jalan di Kebutuhan RS, hanya untuk item yang BARU ditambahkan (tidak menunggu: modal sudah tutup).
      if (amAutoOn) {
        const baru = new Set((S.checklistItems || []).filter(it => !beforeIds.has(it.id)).map(it => it.id));
        if (baru.size) runWorkspaceAutoMatch(baru);
      }
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
      PNMToast.show('Permintaan RS terkirim, tapi belum terbaca balik', 'warning', { detail: 'Buka ulang sesi untuk memastikan.' });
    }

    S.prTeks.value = ''; S.prFile.value = '';
    closePrModal();
    if (typeof S.switchDoor === 'function') S.switchDoor('konversi');
    if (amAutoOn) runWorkspaceAutoMatch(); // semua item sesi ini baru; hasil muncul bertahap di Kebutuhan RS

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
let prEditOriginal = new Map(); // id -> {raw_text, qty_diminta, pagu_satuan, konteks_minta} saat editor dibuka
let prEditOriginalPagu = { total: null, sections: new Map() }; // pagu total + pagu per section saat editor dibuka
const prEdPaguTotal = document.getElementById('pr-ed-pagu-total');
const prEdPaguSections = document.getElementById('pr-ed-pagu-sections');
const normPagu = v => (v == null || v === '' || isNaN(Number(v))) ? null : Number(v);
const fmtPagu = v => v != null ? Number(v).toLocaleString('id-ID') : '';

function renderPrEditRows() {
  prEditOriginal = new Map(S.checklistItems.map(it => [it.id, { raw_text: it.raw_text, qty_diminta: it.qty_diminta ?? null, pagu_satuan: normPagu(it.pagu_satuan), konteks_minta: normKonteks(it.konteks_minta) }]));
  prEditRows.innerHTML = S.checklistItems.length ? S.checklistItems.map(it => `
    <div class="pr-edit-row" data-id="${it.id}">
      <input class="pr-ed-nama" value="${escapeHtmlAttr(it.raw_text)}" placeholder="Nama item"/>
      <input class="pr-ed-qty" inputmode="numeric" value="${it.qty_diminta != null ? it.qty_diminta : ''}" placeholder="Qty"/>
      <input class="pr-ed-pagusat" inputmode="numeric" value="${fmtPagu(normPagu(it.pagu_satuan))}" placeholder="opsional"/>
      ${segHtml('pr-ed-konteks', it.konteks_minta, 'Jenis item')}
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
    const konteks = normKonteks(row.querySelector('.pr-ed-konteks').dataset.value);
    if (!nama) { invalid = 'Nama item tidak boleh kosong.'; return; }
    if (qty !== null && (isNaN(qty) || qty < 1)) { invalid = `Qty "${orig.raw_text}" harus angka 1 atau lebih (atau kosongkan).`; return; }
    const fieldsChanged = nama !== orig.raw_text || qty !== (orig.qty_diminta ?? null);
    const paguSatChanged = paguSat !== orig.pagu_satuan;
    const konteksChanged = konteks !== orig.konteks_minta;
    if (fieldsChanged || paguSatChanged || konteksChanged) changes.push({ id, nama, qty, paguSat, konteks, fieldsChanged, paguSatChanged, konteksChanged, orig });
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
  // 3a) Jenis (konteks) semua baris yang berubah: satu RPC batch, terpisah dari nama/qty/pagu satuan
  const konteksRows = changes.filter(c => c.konteksChanged).map(c => ({ id: c.id, konteks: c.konteks }));
  let konteksOk = true;
  if (konteksRows.length) {
    try {
      await apiSetKonteksItems(konteksRows);
    } catch (err) { konteksOk = false; failed.push(`Jenis item: ${err.message}`); }
  }
  // 3b) Item: nama/qty (RPC lama) dan pagu satuan (RPC baru) — terpisah, jadi gagal salah satu gak nge-blok yang lain
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
      // Baris yang HANYA berubah jenisnya dihitung berhasil kalau batch jenis tadi berhasil.
      if (ch.fieldsChanged || ch.paguSatChanged || (ch.konteksChanged && konteksOk)) ok++;
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
  // Usulan Auto-Match lama dihitung dengan jenis yang lama: buang, lalu cocokkan ulang item yang masih PENDING
  // (mengikuti switch "Cocokkan setelah disimpan"). Item yang sudah diputuskan tidak disentuh.
  if (konteksOk && konteksRows.length) {
    const ids = new Set(konteksRows.map(r => r.id));
    ids.forEach(id => amMap.delete(id));
    const pending = new Set((S.checklistItems || []).filter(it => ids.has(it.id) && it.status === 'PENDING').map(it => it.id));
    if (amAutoOn && pending.size) runWorkspaceAutoMatch(pending);
    else if (ids.size) renderChecklist();
  }
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
  // Mengikuti = alokasi kosong (autofill dari qty permintaan) ATAU sama dengan qty lama. Alokasi yang sudah diatur beda = manual, tidak disentuh.
  const follows = links.length === 1 && newQty != null && (links[0].qty_alokasi == null || Number(links[0].qty_alokasi) === Number(oldQty));
  if (!follows) return `Qty "${item.raw_text}" berubah, tapi alokasi produknya tidak ikut — cek ulang di Kebutuhan RS`;
  const newLinks = [{ ...links[0], qty_alokasi: newQty }];
  S.markLocalWrite(S.PERMINTAAN_ITEM_TABLE, item.id, 'status', 'TERPENUHI');
  await S.callUpdatePermintaanItemMulti(item.id, 'TERPENUHI', newLinks);
  // item.qty_diminta sudah berisi qty BARU saat ini dipanggil → alokasi kosong di link lama dibuat eksplisit = qty lama
  const oldLinks = links.map(l => (l.qty_alokasi == null && oldQty != null ? { ...l, qty_alokasi: Number(oldQty) } : l));
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
  return markItemTerpenuhiWithProduk(item, [kode]);
}

// Satu atau BANYAK produk untuk satu item. Banyak = bundle "skenario" (Auto-Match, permintaan umum): tiap produk
// diberi qty_alokasi = qty diminta (BUKAN dibagi) — RS minta 2, tiap opsi ditawarkan 2 pcs sebagai skenario anggaran.
// Jalur tulisnya sama dengan picker manual (callUpdatePermintaanItemMulti, replace-all), jadi tidak ada RPC baru.
async function markItemTerpenuhiWithProduk(item, kodes) {
  const itemId = item.id;
  try {
    S.markLocalWrite(S.PERMINTAAN_ITEM_TABLE, itemId, 'status', 'TERPENUHI');
    // Qty mengikuti Permintaan RS (qty_diminta) — dulu selalu null, jadi qty clipboard
    // gak pernah ikut dan user harus ngisi qty dua kali. Qty diminta kosong/invalid → null
    // (qty clipboard dibiarkan apa adanya, gak dipaksa 1).
    const dq = Number(item.qty_diminta);
    const links = kodes.map(kode => {
      const clipItem = S.clipboard.find(c => c.kode_produk === kode);
      return {
        produk_id: clipItem && clipItem.produk_id != null ? clipItem.produk_id : null,
        kode_produk: kode,
        qty_alokasi: (!isNaN(dq) && dq >= 1) ? dq : null
      };
    });
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
S.markItemTerpenuhiWithProduk = markItemTerpenuhiWithProduk;


// ══════════════════════════════════════════════════════════════════════════
// CHECKLIST KEBUTUHAN RS (daftar item permintaan yang dicocokkan satu-satu ke produk):
// render checklist + tab section + rollup, picker produk, sinkron qty ke clipboard,
// auto-finalize permintaan. DIPINDAH dari dictionary.js (2026-10-27) — dulu numpang di sana karena
// waktu index.js dipecah, region ini belum punya file sendiri. Logic TIDAK diubah; cuma referensi ke
// hal yang masih tinggal di
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
  S.kbRecordStatus.textContent = '';
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
// Qty yang dipakai buat ESTIMASI STOK satu produk di picker: qty alokasi yang diisi/diketik di baris itu;
// kalau kosong → qty permintaan RS; kalau itu juga kosong → 1 (aturan: tanpa qty dianggap 1).
function pickerNeedQty(rsItem, qtyRaw) {
  const q = Number(qtyRaw);
  if (qtyRaw !== '' && qtyRaw != null && Number.isFinite(q) && q >= 1) return q;
  return S.qtyButuh(rsItem ? rsItem.qty_diminta : null);
}

// Badge Ready/Indent untuk produk clipboard `c` kalau yang diminta `need` pcs (kosong kalau stoknya belum ada datanya).
function pickerStokBadge(c, need) {
  return c && c.stok_status ? S.stokBadgeHtml(c, !!c.is_set, need) : '';
}

function clipboardPickerHtml(itemId, matchedItems) {
  const rsItem = S.checklistItems.find(i => i.id === itemId);
  const dqPick = rsItem ? Number(rsItem.qty_diminta) : NaN;
  const qtyPh = (!isNaN(dqPick) && dqPick >= 1) ? String(dqPick) : 'qty';
  const qtyTitle = qtyPh === 'qty' ? '' : ` title="Kosongkan = ikut qty permintaan (${qtyPh}) kalau cuma 1 produk dipilih"`;
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
      <span class="kb-picker-stok">${pickerStokBadge(c, pickerNeedQty(rsItem, qtyVal))}</span>
      <input type="number" min="0" class="kb-picker-qty" data-picker-qty="${itemId}" data-kode="${S.escapeHtmlAttr(c.kode_produk)}"
        placeholder="${qtyPh}"${qtyTitle} value="${qtyVal}" style="${checked ? '' : 'display:none'}">
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

// Estimasi stok ikut berubah saat qty alokasi diketik (kosong = balik ke qty permintaan RS).
S.kbList.addEventListener('input', e => {
  const qtyInput = e.target.closest('.kb-picker-qty');
  if (!qtyInput) return;
  const rsItem = S.checklistItems.find(i => String(i.id) === String(qtyInput.dataset.pickerQty));
  const c = S.clipboard.find(x => x.kode_produk === qtyInput.dataset.kode);
  const slot = qtyInput.closest('.kb-picker-row')?.querySelector('.kb-picker-stok');
  if (slot) slot.innerHTML = pickerStokBadge(c, pickerNeedQty(rsItem, qtyInput.value.trim()));
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
  const am = amFor(item);
  const cls = (isDone ? 'terpenuhi' : isNa ? 'tidak-terpenuhi' : '') + (isExpanded ? ' expanded' : ' collapsed')
    + (am ? ' am-' + am.hasil.status.toLowerCase() : '');

  const qtyTxt = item.qty_diminta ? ` · qty ${item.qty_diminta}` : '';
  const paguTxt = item.pagu_satuan != null ? ` · pagu satuan ${S.rupiah(item.pagu_satuan)}` : '';

  // ---- Baris ringkas (selalu kelihatan, ini yang diklik buat buka/tutup) ----
  const statusIcon = isDone ? '<i class="ti ti-circle-check"></i>'
    : isNa ? '<i class="ti ti-circle-x"></i>'
    : '<i class="ti ti-circle-dashed"></i>';
  // Baris terbuka yang punya usulan: teks permintaan memuat penanda selisih terhadap usulan teratas.
  const reqMarked = isExpanded && isPending ? amRequestHtml(item) : null;
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
      <div class="kb-item-text">${reqMarked || S.escapeHtmlAttr(item.raw_text)}${qtyTxt}${paguTxt}</div>
      ${!isExpanded ? compactMatchedTxt : ''}
      ${!isExpanded && isDone ? anchorChipHtml(item) : ''}
      ${!isExpanded ? amLineHtml(item) : ''}
    </div>
    ${!isExpanded ? amQuickBtnHtml(item) : ''}
    <button type="button" class="kb-item-copy" data-action="copy-text" data-id="${item.id}" title="Copy deskripsi permintaan" aria-label="Copy deskripsi permintaan"><i class="ti ti-copy"></i></button>
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
        // Estimasi aktual: stok produk ini cukup untuk qty yang diminta RS? (tanpa qty → 1)
        const clipItem = S.clipboard.find(c => c.kode_produk === l.kode_produk);
        const needLine = S.qtyButuh(effQtyAlokasi(item, l, item.matched_items) ?? item.qty_diminta);
        return `<span class="kb-matched-row">→ ${S.escapeHtmlAttr(l.kode_produk)}${nama ? ' — ' + S.escapeHtmlAttr(nama) : ''}${S.escapeHtmlAttr(qtyLineTxt)}${pickerStokBadge(clipItem, needLine)}</span>`;
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
      // Satu sumber usulan di layar: kalau Auto-Match sudah punya hasil, blok saran Dictionary (data RPC yang sama,
      // subset dari hasil Auto-Match) tidak dirender lagi. Tanpa hasil Auto-Match, blok lama tetap jadi cadangan.
      const suggHtml = am ? '' : S.renderDictSuggestionHtml(item, sugg);
      bodyHtml = `
        ${amCandidatesHtml(item)}
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
          ${isDone && anchorUndo.has(item.id) && (item.matched_items || []).length > 1 ? `<a data-action="anchor-undo" data-id="${item.id}">Kembalikan ke 1 produk</a>` : ''}
          <a class="kb-batal-link" data-action="undo" data-id="${item.id}">Batal</a>
        </div>`;
    }

    detailHtml = `<div class="kb-item-detail">
      ${sub ? `<div class="kb-item-sub">${sub}</div>` : ''}
      ${matchedHtml}
      ${isDone && !isPicking ? anchorPanelHtml(item) : ''}
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
  const pct = r.total ? Math.round((r.done / r.total) * 100) : 0;
  const prog = size === 'sm' ? ''
    : `<span class="kb-prog" role="progressbar" aria-label="Kebutuhan terpenuhi" aria-valuemin="0" aria-valuemax="${r.total}" aria-valuenow="${r.done}"><i style="width:${pct}%"></i></span>`;
  return `<div class="${cls}">
    <span class="kb-rollup-done">${size === 'sm' ? `${r.done}/${r.total}` : `<b>${r.done}</b> dari ${r.total}`} terpenuhi</span>${prog}
    <span class="kb-rollup-harga">${S.rupiah(r.harga)}${r.anyIncomplete ? '<i class="ti ti-alert-triangle" title="Ada produk match yang harganya belum kehitung (cek clipboard)"></i>' : ''}</span>
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
  const addBtn = document.getElementById('kb-add-section-btn');
  const hasSections = S.checklistSections.length > 0;
  // Belum ada section: "Semua | Tanpa section | +" cuma mengulang daftar yang sama. Cukup satu tombol kecil
  // "+ Section" (cara memulai section pertama tetap ada). Tab muncul begitu ada section.
  if (addBtn) addBtn.style.display = (S.checklistPermintaanId && !hasSections) ? '' : 'none';
  if (!S.checklistPermintaanId || !hasSections) { S.kbSectionTabs.style.display = 'none'; S.kbSectionTabs.innerHTML = ''; return; }
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

async function addSectionFlow() {
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
}
const kbAddSectionBtn = document.getElementById('kb-add-section-btn');
if (kbAddSectionBtn) kbAddSectionBtn.addEventListener('click', () => { addSectionFlow(); });

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
  if (tab === 'add') { await addSectionFlow(); return; }
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
  anchorHitungPicu(); // angka chip "+N varian lain": satu RPC batch untuk semua anchor yang belum punya angka
  updateKbCounts();
  renderAmBar(); // sebelum daftar dirender: bar yang melepas filter kosong (amFilter) harus jalan dulu
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
    const flat = amFilterItems(S.checklistItems);
    S.kbList.innerHTML = flat.length ? flat.map(renderChecklistItemHtml).join('') : (amFilter === 'all' ? '' : AM_EMPTY_HTML);
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
      const vis = amFilterItems(g.items); // filter Auto-Match hanya menyaring baris; rollup tetap dihitung dari SEMUA item section
      if (!vis.length) return '';
      const rollup = computeSectionRollup(g.items, g.section ? g.section.pagu : null);
      const title = g.section ? S.escapeHtmlAttr(g.section.nama_section) : 'Tanpa section';
      return `<div class="kb-section-group" data-section-id="${g.section ? g.section.id : 'null'}">
        <div class="kb-section-header">
          <span class="kb-section-title">${title}</span>
          ${kbRollupHtml(rollup, 'sm')}
        </div>
        <div class="kb-section-items">${vis.map(renderChecklistItemHtml).join('')}</div>
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
    ${(() => {
      const vis = amFilterItems(items);
      if (vis.length) return vis.map(renderChecklistItemHtml).join('');
      return items.length ? AM_EMPTY_HTML : '<div class="kb-section-empty">Belum ada baris di section ini. Drag baris dari tab lain ke sini, atau tambah lewat Permintaan RS.</div>';
    })()}`;
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
  renderAmBar(); // status item bisa berubah dari rekan → hitungan usulan ikut bergeser
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



// ATURAN QTY CLIPBOARD vs PERMINTAAN RS (diubah: TIDAK ada lagi penjumlahan otomatis lintas kebutuhan).
// Satu produk bisa diminta di beberapa kebutuhan/ruang sekaligus (mis. 5 di Ruang A, 3 di Ruang B).
// Dulu qty clipboard otomatis = 5+3 dan ikut berubah tiap alokasi diubah — membingungkan. Sekarang:
//  - tepat 1 kebutuhan yang meminta produk → qty clipboard ikut permintaan itu (sama seperti dulu);
//  - >1 kebutuhan → qty clipboard TIDAK dihitung ulang & tidak ditimpa; user mengaturnya sendiri, dan
//    qty per kebutuhan tetap terlihat apa adanya (badge "RS 5 + 3", baris alokasi, sheet Kebutuhan RS).
//
// Daftar qty efektif per kebutuhan yang match ke produk ini (by produk_id kalau ada, fallback kode_produk),
// satu entri per kebutuhan. Kebutuhan yang qty-nya tidak bisa ditentukan (multi-produk tanpa porsi) tidak
// ikut masuk daftar. `override` opsional: {itemId, links} — dipakai pas lagi proses konfirmasi picker,
// sebelum item.matched_items-nya sendiri kesimpen.
// Qty efektif satu link: qty_alokasi kalau diisi; kalau KOSONG dan kebutuhan itu cuma dipenuhi 1 produk
// sementara qty_diminta (Permintaan RS) sudah terisi → pakai qty_diminta (autofill). Multi-produk dengan
// alokasi kosong tetap null: porsi per varian memang tidak bisa ditebak.
function effQtyAlokasi(it, l, list) {
  if (l.qty_alokasi != null && !isNaN(l.qty_alokasi) && l.qty_alokasi >= 1) return Number(l.qty_alokasi);
  const dq = Number(it.qty_diminta);
  return ((list || []).length === 1 && !isNaN(dq) && dq >= 1) ? dq : null;
}

function rsQtyListForProduk(produkId, kode, override) {
  const out = [];
  S.checklistItems.forEach(it => {
    const list = (override && override.itemId === it.id) ? override.links : (it.matched_items || []);
    (list || []).forEach(l => {
      const sameProduk = (produkId != null && l.produk_id != null) ? l.produk_id === produkId : l.kode_produk === kode;
      if (!sameProduk) return;
      const q = effQtyAlokasi(it, l, list);
      if (q != null) out.push(q);
    });
  });
  return out;
}
S.rsQtyListForProduk = rsQtyListForProduk;

// Qty permintaan kalau PERSIS satu kebutuhan yang meminta produk ini; selain itu null
// (tidak ada yang meminta, atau diminta di beberapa kebutuhan → tidak dijumlah).
function qtyPermintaanTunggal(produkId, kode, override) {
  const list = rsQtyListForProduk(produkId, kode, override);
  return list.length === 1 ? list[0] : null;
}

// Sinkronin qty item clipboard ke qty permintaan — HANYA kalau produk ini diminta di tepat 1 kebutuhan.
// Balikin true kalau qty-nya berubah (biar caller tau perlu re-render).
function syncClipboardQtyForProduk(produkId, kode, override) {
  const clipItem = S.clipboard.find(c => c.kode_produk === kode);
  if (!clipItem) return false;
  const q = qtyPermintaanTunggal(produkId, kode, override);
  if (q != null && clipItem.qty !== q) {
    clipItem.qty = q;
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
S.qtyPermintaanTunggal = qtyPermintaanTunggal;
// Qty "sesuai Permintaan RS" untuk satu item clipboard. null = tidak ada alokasi RS, ATAU diminta di
// lebih dari satu kebutuhan (tidak dijumlah — lihat rsQtyListForClipItem buat rinciannya).
function rsQtyForClipItem(clipItem) {
  if (!clipItem || !S.checklistPermintaanId) return null;
  return qtyPermintaanTunggal(clipItem.produk_id != null ? clipItem.produk_id : null, clipItem.kode_produk);
}
S.rsQtyForClipItem = rsQtyForClipItem;
// Qty per kebutuhan RS yang meminta produk clipboard ini (mis. [5, 3] kalau diminta di dua ruang).
function rsQtyListForClipItem(clipItem) {
  if (!clipItem || !S.checklistPermintaanId) return [];
  return rsQtyListForProduk(clipItem.produk_id != null ? clipItem.produk_id : null, clipItem.kode_produk);
}
S.rsQtyListForClipItem = rsQtyListForClipItem;

// SATU titik yang nyambungin perubahan alokasi RS → qty clipboard. Dipakai jalur konfirmasi picker
// lewat Pakai/Tambah&Pakai dan edit qty RS. Dipanggil SETELAH server sukses, dengan link SEBELUM & SESUDAH.
//
// Aturan (TIDAK menjumlah lintas kebutuhan, lihat komentar di rsQtyListForProduk):
//  - setelah perubahan produk diminta di >1 kebutuhan → qty clipboard dibiarkan apa adanya; user dikasih tau
//    qty per kebutuhannya supaya tidak bingung kenapa qty clipboard tidak ikut.
//  - tepat 1 kebutuhan, dan qty clipboard MASIH mengikuti (belum ada alokasi sebelumnya, atau sama dgn
//    qty permintaan sebelumnya) → qty clipboard diset ke qty permintaan itu.
//  - qty clipboard BEDA dari yang diharapkan → override manual user: JANGAN ditimpa (badge
//    "manual · RS n" + tombol ↺ di baris clipboard buat balik sadar).
//  - tidak ada kebutuhan yang meminta lagi (alokasi dicabut) → qty clipboard dibiarkan.
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
    const prevList = rsQtyListForProduk(l.produk_id, l.kode_produk, { itemId, links: oldLinks || [] });
    const nextList = rsQtyListForProduk(l.produk_id, l.kode_produk, { itemId, links: newLinks || [] });
    if (nextList.length === 0) return;
    if (nextList.length > 1) {
      notes.push(`${l.kode_produk} diminta di ${nextList.length} kebutuhan (${nextList.join(' + ')}) — qty clipboard tidak dijumlah otomatis, atur manual`);
      return;
    }
    const next = nextList[0];
    if (clipItem.qty === next) return;
    const followsRs = prevList.length === 0 || (prevList.length === 1 && clipItem.qty === prevList[0]);
    if (!followsRs) {
      notes.push(`Qty ${l.kode_produk} tetap ${clipItem.qty} (diubah manual) — Permintaan RS: ${next}`);
      return;
    }
    const before = clipItem.qty;
    clipItem.qty = next;
    if (clipItem._sesiItemId) S.markLocalWrite(S.SESI_ITEM_TABLE, clipItem._sesiItemId, 'qty', clipItem.qty);
    S.persistUpdateQty(clipItem);
    changed = true;
    if (before !== 1 && prevList.length === 0) notes.push(`Qty ${l.kode_produk}: ${before} → ${next} (mengikuti Permintaan RS)`);
  });
  S.updateClipboard(); // selalu: badge "RS n" di baris clipboard harus ikut segar
  if (notes.length) PNMToast.show(notes.join(' · '), 'presence', { duration: 6000 });
  return changed;
}
S.reconcileClipboardQty = reconcileClipboardQty;

// Centang opsi anchor: simpan ke state dan segarkan tombol Pasang tanpa render ulang (fokus & scroll tidak loncat).
S.kbList.addEventListener('change', (e) => {
  const cb = e.target && e.target.closest ? e.target.closest('input[data-anchor-check]') : null;
  if (!cb) return;
  const itemId = parseInt(cb.dataset.anchorCheck, 10);
  const c = anchorCache.get(itemId);
  if (!c) return;
  if (cb.checked) c.pilih.add(cb.dataset.kode); else c.pilih.delete(cb.dataset.kode);
  const apply = S.kbList.querySelector(`button[data-action="anchor-apply"][data-id="${itemId}"]`);
  if (apply) { apply.textContent = `Pasang ${c.pilih.size} opsi`; apply.disabled = c.pilih.size < 2; }
});

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

  if (action === 'copy-text') {
    // Copy deskripsi permintaan RS apa adanya (tanpa qty/pagu) — buat dipaste ke search / Sheet.
    const text = String(item.raw_text || '').trim();
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (_) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
        document.body.appendChild(ta); ta.select();
        ok = document.execCommand('copy'); ta.remove();
      } catch (__) { ok = false; }
    }
    if (!ok) { S.showToast('Gagal copy — browser nolak akses clipboard', 'error'); return; }
    S.showToast('Deskripsi permintaan disalin ✓');
    const ic = btn.querySelector('i');
    if (ic) { ic.className = 'ti ti-check'; setTimeout(() => { ic.className = 'ti ti-copy'; }, 1400); }
    return;
  }

  if (action === 'toggle-expand') {
    // Kalau lagi milih produk (picker kebuka), jangan biarin ke-collapse cuma
    // gara-gara klik header-nya sendiri — user harus Batal/Konfirmasi dulu.
    if (S.checklistPickingId === itemId) return;
    S.checklistExpandedId = (S.checklistExpandedId === itemId) ? null : itemId;
    renderChecklist();
    S.maybeFetchSuggestionForExpanded();
    return;
  }

  if (action === 'toggle-alt') {
    const m = amFor(item);
    amAltPref.set(itemId, !amAltOpen(item, m ? m.hasil : {}));
    S.patchChecklistItem(itemId, {}); // render ulang baris ini saja (scroll daftar tidak loncat)
    return;
  }

  if (action === 'toggle-belum') {
    if (amBelumOpen.has(itemId)) amBelumOpen.delete(itemId); else amBelumOpen.add(itemId);
    S.patchChecklistItem(itemId, {});
    return;
  }

  if (action === 'use-suggestion') {
    // Fast-path dari saran Dictionary: langsung tandai TERPENUHI pakai produk
    // yang disaranin, TANPA buka picker — cuma valid kalau produknya emang
    // udah ada di Clipboard sesi ini (dicek dobel di sini, bukan cuma percaya
    // tombolnya beneran ke-render dengan benar).
    const kode = el.dataset.kode;
    if (!S.clipboard.some(c => c.kode_produk === kode)) return;
    amWarnBelumSiap(item, kode);
    btn.disabled = true;
    await S.markItemTerpenuhiWithSingleProduk(item, kode);
    return;
  }

  if (action === 'anchor-open' || action === 'anchor-sejenis') {
    const kode = anchorKode(item);
    if (!kode) return;
    const level = action === 'anchor-sejenis' ? ANCHOR_LEVEL.SEJENIS : ANCHOR_LEVEL.VARIAN;
    S.checklistExpandedId = itemId;
    anchorOpen.add(itemId);
    if (action === 'anchor-open') anchorCache.set(itemId, { anchor: kode, loading: true, level, hasil: null, pilih: new Set(), error: null });
    renderChecklist(); // tampilkan "Menyiapkan…" dulu; RPC jalan di belakang
    await anchorMuat(item, kode, level);
    return;
  }

  if (action === 'anchor-close') {
    anchorOpen.delete(itemId);
    renderChecklist();
    return;
  }

  if (action === 'anchor-apply') {
    const c = anchorCache.get(itemId);
    if (!c || !c.hasil || c.anchor !== anchorKode(item)) return;
    // urutan: anchor dulu, lalu urutan dari DB
    const kodes = [c.anchor, ...c.hasil.opsi.map(o => o.kode_produk)].filter(k => c.pilih.has(k));
    if (kodes.length < 2) return;
    btn.disabled = true;
    const { ok: okKodes, gagal } = await pastikanDiClipboard(kodes);
    if (okKodes.length < 2) {
      btn.disabled = false;
      S.showToast('Opsi tidak bisa dipasang', 'warning', { detail: `Kurang dari 2 produk yang berhasil masuk Clipboard${gagal.length ? ` — ${S.ringkasGagalClip(gagal)}` : ''}.` });
      return;
    }
    if (gagal.length) S.showToast(`${gagal.length} produk gagal ditambahkan`, 'warning', { detail: `${S.ringkasGagalClip(gagal)}. Sisanya tetap dipasang.` });
    anchorUndo.set(itemId, c.anchor);
    anchorOpen.delete(itemId);
    anchorCache.delete(itemId);
    await markItemTerpenuhiWithProduk(item, okKodes);
    return;
  }

  if (action === 'anchor-undo') {
    const kode = anchorUndo.get(itemId);
    if (!kode) return;
    anchorUndo.delete(itemId);
    await markItemTerpenuhiWithProduk(item, [kode]); // produk bundle yang sudah masuk Clipboard sengaja tidak dihapus
    return;
  }

  if (action === 'use-bundle') {
    // Pasang SEMUA produk bundle (Auto-Match, permintaan umum) @ qty diminta. Produk yang belum ada di Clipboard ditambahkan
    // dulu (berurutan, sama dgn "Pakai N yang cocok"); yang gagal ditambah dilewati dan diberi tahu.
    const m = amFor(item);
    const kodes = m && m.hasil.bundle ? m.hasil.bundle.map(b => b.kode) : [];
    if (kodes.length < 2) return;
    btn.disabled = true;
    const { ok: okKodes, gagal } = await pastikanDiClipboard(kodes);
    if (!okKodes.length) { btn.disabled = false; S.showToast('Bundle tidak bisa dipasang', 'error', { detail: S.ringkasGagalClip(gagal) }); return; }
    if (gagal.length) S.showToast(`${gagal.length} produk bundle gagal ditambahkan`, 'warning', { detail: `${S.ringkasGagalClip(gagal)}. Sisanya tetap dipasang.` });
    await markItemTerpenuhiWithProduk(item, okKodes);
    return;
  }

  if (action === 'attach-suggestion') {
    // Sama kayak "Pakai", tapi produknya belum ada di Clipboard — tambahin dulu
    // lewat S.pasangKeClipboard (produk-katalog.js: muat exact by kode_produk kalau belum ada di
    // katalog, lalu masukin ke Clipboard), baru abis itu jalanin fast-path yang sama kayak "Pakai".
    const kode = el.dataset.kode;
    btn.disabled = true;
    const hasil = await S.pasangKeClipboard(kode);
    if (!hasil.ok) {
      btn.disabled = false;
      S.showToast('Gagal menambahkan produk', 'error', { detail: S.ringkasGagalClip([hasil]) });
      return;
    }
    amWarnBelumSiap(item, kode);
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
    // Qty alokasi kosong + cuma 1 produk dipilih + qty permintaan RS sudah diisi → ikut qty permintaan (autofill).
    // >1 produk: dibiarkan kosong, porsi per varian tidak bisa ditebak.
    if (links.length === 1 && links[0].qty_alokasi == null) {
      const dqc = Number(item.qty_diminta);
      if (!isNaN(dqc) && dqc >= 1) links[0].qty_alokasi = dqc;
    }

    // Kalau qty_alokasi diisi di picker Kebutuhan RS, ikutin ke qty item clipboard yang sama — biar user
    // gak perlu isi qty dua kali — TAPI cuma kalau produk ini diminta di tepat 1 kebutuhan. Kalau sudah
    // diminta di kebutuhan/ruang lain juga, qty clipboard TIDAK dijumlah & tidak ditimpa (lihat komentar di
    // rsQtyListForProduk); user cukup dikasih tau qty tiap ruangnya.
    // Kalau qty_alokasi dikosongin, qty clipboard dibiarin apa adanya (gak di-reset).
    let clipQtyChanged = false;
    const touchedProduk = new Set();
    const multiNotes = [];
    links.forEach(l => {
      if (l.qty_alokasi == null || isNaN(l.qty_alokasi) || l.qty_alokasi < 1) return;
      const key = l.produk_id != null ? 'id:' + l.produk_id : 'kode:' + l.kode_produk;
      if (touchedProduk.has(key)) return; // 2 checkbox beda tapi produk sama (jarang) — cukup dihitung sekali
      touchedProduk.add(key);
      const list = rsQtyListForProduk(l.produk_id, l.kode_produk, { itemId, links });
      if (list.length > 1) { multiNotes.push(`${l.kode_produk} diminta di ${list.length} kebutuhan (${list.join(' + ')}) — qty clipboard tidak dijumlah otomatis, atur manual`); return; }
      if (syncClipboardQtyForProduk(l.produk_id, l.kode_produk, { itemId, links })) clipQtyChanged = true;
    });
    if (clipQtyChanged) S.updateClipboard();
    if (multiNotes.length) PNMToast.show(multiNotes.join(' · '), 'presence', { duration: 6000 });

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
    try {
      S.markLocalWrite(S.PERMINTAAN_ITEM_TABLE, itemId, 'status', 'TIDAK_TERPENUHI');
      await callUpdatePermintaanItemMulti(itemId, 'TIDAK_TERPENUHI', []);
      item.status = 'TIDAK_TERPENUHI';
      item.matched_items = [];
      // Qty clipboard TIDAK dihitung ulang (dulu dijumlah ulang di sini). Badge "RS n" cukup di-refresh
      // supaya ikut menunjukkan permintaan yang masih tersisa.
      S.updateClipboard();
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
    try {
      S.markLocalWrite(S.PERMINTAAN_ITEM_TABLE, itemId, 'status', 'PENDING');
      await callUpdatePermintaanItemMulti(itemId, 'PENDING', []);
      item.status = 'PENDING';
      item.matched_items = [];
      // Sama kayak 'tidak': qty clipboard tidak dihitung ulang, cuma badge "RS n" yang di-refresh.
      S.updateClipboard();
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
    S.kbRecordStatus.textContent = '';
    S.setSesiSavedStatus('Tersimpan ✓');
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
  // Semua tulisan status item lewat sini → dicatat (S.trackItemWrite, realtime.js) supaya reload checklist dari server
  // tidak menimpa tulisan yang masih berjalan / baru selesai dengan snapshot basi.
  return typeof S.trackItemWrite === 'function'
    ? S.trackItemWrite(itemId, () => callUpdatePermintaanItemMultiRaw(itemId, status, links))
    : callUpdatePermintaanItemMultiRaw(itemId, status, links);
}
async function callUpdatePermintaanItemMultiRaw(itemId, status, links) {
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
  amLogDecision(itemId, status, links); // semua jalur (Pakai, bulk, picker manual) lewat sini → satu titik pencatatan
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