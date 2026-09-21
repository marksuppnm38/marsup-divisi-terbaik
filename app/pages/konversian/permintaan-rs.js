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

async function openPrModal() {
  S.prStatusMsg.textContent = '';
  prTeksFromOcr = false;
  prShowTab('teks');
  reviewItems = [];
  S.prReviewWrap.style.display = 'none';
  S.prFormWrap.style.display = '';
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
  S.prModal.classList.add('show');
}
S.openPrModal = openPrModal;
function closePrModal() { S.prModal.classList.remove('show'); }

S.btnPermintaan.addEventListener('click', openPrModal);
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
    S.prReviewSaveBtn.textContent = 'Simpan & mulai sesi';
  }
});

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
    const links = [{ produk_id: null, kode_produk: kode, qty_alokasi: null }];
    await S.callUpdatePermintaanItemMulti(itemId, 'TERPENUHI', links);
    item.status = 'TERPENUHI';
    item.matched_items = links;
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