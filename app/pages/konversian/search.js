// AUTO-EXTRACTED dari konversian/index.js (breakup sesuai map.md bagian 3) — Claude, 2026-09-15.
// Region asli: lihat map.md bagian 2. Semua state lintas-file diakses lewat
// objek 'S' yang dioper dari index.js (S = window.__konvBridge-style shared
// state, TAPI bukan window global — cuma dioper sebagai parameter, lihat
// index.js: const S = {}; lalu install*(S) dipanggil berurutan).
// Logic di dalam TIDAK diubah — cuma referensi ke variabel/fungsi yang
// didefinisikan di file LAIN diganti jadi S.nama (lihat COORD LOG index.js).
export function installSearch(S) {
// ══════════════════════════════════════════
// DUA PINTU: Cari Cepat (murni lookup, nol tulisan ke database) vs Konversi
// (workspace requirement↔produk yang butuh sesi). Default selalu 'cari' pas
// fresh load — itu tugas paling sering (liat design-rebase discussion), BUKAN
// diinget dari localStorage, biar predictable tiap buka app.
// Titik-titik yang MEMAKSA pindah ke 'konversi' (escalation eksplisit):
//   - openSesi() sukses (buka sesi lewat "Konversi Berjalan" atau link share)
//   - handleClipToggleClick() berhasil nambahin produk pertama ke sesi
// ══════════════════════════════════════════
let currentDoor = 'cari';
function switchDoor(door) {
  currentDoor = door;
  const appRootEl = document.getElementById('app-root');
  appRootEl.classList.toggle('door-cari', door === 'cari');
  appRootEl.classList.toggle('door-konversi', door === 'konversi');
  // door-btn-cari/door-btn-konversi (the manual toggle pair) were removed
  // from the toolbar in the shell-integration pass -- this function is
  // still the right place for door state (auto-escalation from actions
  // like openSesi()/first clipboard add still calls switchDoor('konversi')
  // below), it just no longer has a visible button pair to sync .active
  // onto. Guarded rather than deleted outright in case a manual toggle
  // ever comes back.
  const btnCari = document.getElementById('door-btn-cari');
  const btnKonversi = document.getElementById('door-btn-konversi');
  if (btnCari) btnCari.classList.toggle('active', door === 'cari');
  if (btnKonversi) btnKonversi.classList.toggle('active', door === 'konversi');
  if (door === 'cari') {
    S.switchSubTab('cari'); // pintu ini cuma nyisain 1 opsi, pastiin itu yang aktif
    if (typeof S.switchTab === 'function') S.switchTab('search'); // sinkron sama mekanisme tab mobile yang udah ada
  } else if (typeof S.switchTab === 'function') {
    S.switchTab('clip'); // default landing di workspace-nya, subtab lain (Kebutuhan RS dkk) tetep dijangkau dari situ
  }
}
S.switchDoor = switchDoor;
// door-btn-cari/door-btn-konversi click bindings removed along with the
// buttons themselves (shell-integration pass) -- switchDoor() above is
// still called from every other spot in this file exactly as before.

// ══════════════════════════════════════════
// PENCARIAN EXACT-BY-KODE (DISATUKAN): sebelumnya logika ini ada 2 salinan
// terpisah — satu di modul Converter (matchOneKode, PUNYA retry timeout),
// satu lagi di modul Cari SET Mendekati (addSetKodeToClip, TANPA retry) —
// jadi kalau backend search_produk_dengan_harga timeout, "Tambah ke
// Clipboard" di tab SET langsung gagal padahal produknya ada, sementara
// Converter otomatis coba lagi. Disatukan ke findProdukByKodeExact() +
// kodeExactCache biar (1) perilaku retry konsisten di kedua tempat, dan
// (2) kode yang sama gak nembak RPC berkali-kali kalau muncul >1x dalam
// satu proses (mis. daftar paste dari RS ada baris kode duplikat, beda
// qty tapi kode sama — 20 baris duplikat dulu = 20x round-trip RPC yang
// identik hasilnya, sekarang cukup 1x). Cache HANYA nyimpen hasil sukses
// (produk ketemu ATAU genuinely not_found) — hasil error/timeout sengaja
// TIDAK dicache, biar tombol "Proses Ulang yang Error" & percobaan
// berikutnya tetap nembak RPC baru, bukan keulang errornya dari cache. — Claude
// ══════════════════════════════════════════
const kodeExactCache = new Map(); // kode (lowercase) -> { produk: row|null } — cuma hasil sukses

async function findProdukByKodeExact(kode) {
  const cacheKey = kode.toLowerCase();
  if (kodeExactCache.has(cacheKey)) return kodeExactCache.get(cacheKey);

  let result = { produk: null, errMsg: null };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { data, error } = await S.rpc('search_produk_dengan_harga', { q: kode, p_tipe: null, only_akd: false, only_kfa: false });
      if (error) {
        const msg = error.message || JSON.stringify(error);
        if ((msg.includes('timeout') || msg.includes('canceling')) && attempt === 0) continue; // retry sekali
        result.errMsg = msg;
        return result; // error: gak dicache, sengaja
      }
      if (data && data.length) {
        result.produk = data.find(r => r.kode_produk && r.kode_produk.toLowerCase() === cacheKey) || null;
      }
      kodeExactCache.set(cacheKey, result); // sukses (ketemu atau memang not_found) → aman dicache
      return result;
    } catch (e) {
      if (attempt === 0) continue;
      result.errMsg = e.message;
      return result; // error: gak dicache
    }
  }
  return result;
}
S.findProdukByKodeExact = findProdukByKodeExact;

// Satu pencocokan kode → produk (dipakai modul Converter). Detail retry +
// cache ditangani findProdukByKodeExact() di atas.
async function matchOneKode(kode, nama_input) {
  const row = { kode, nama_input, status: 'not_found', produk: null, errMsg: null };
  if (!kode) return row;
  const { produk, errMsg } = await findProdukByKodeExact(kode);
  if (errMsg) {
    row.status = 'error';
    row.errMsg = errMsg;
    return row;
  }
  if (produk) {
    row.produk = produk;
    const namaKatalog = (produk.nama_produk || '').trim().toLowerCase();
    const namaInputNorm = nama_input.trim().toLowerCase();
    row.status = (!namaInputNorm || namaKatalog === namaInputNorm) ? 'exact' : 'code_found_name_diff';
  }
  return row;
}

async function finishConvBatch(rows) {
  const foundProduk = rows.filter(r => r.produk).map(r => r.produk);
  if (foundProduk.length) {
    S.convStatus.textContent = 'Mengambil status stok…';
    await S.enrichResultsWithStok(foundProduk);
  }
  S.convRows = rows;
  // Auto-expand baris yang butuh tindakan (gak ketemu/error), biar user
  // langsung lihat & bisa cari manual tanpa klik buka satu-satu dulu. Baris
  // yang udah ketemu tetap compact/collapsed, gak perlu perhatian.
  S.convExpandedIdx = new Set(rows.map((r, i) => r.produk ? -1 : i).filter(i => i >= 0));
  Object.values(S.convManualTimers).forEach(clearTimeout);
  S.convManualResults = {}; S.convManualQuery = {}; S.convManualTimers = {}; S.convManualSeq = {};
  S.renderConvResults(rows);
  S.updateConvSummary();
}

async function processConverter() {
  const lines = S.convInput.value.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim());
  if (!lines.length) return;
  S.btnConvProses.disabled = true;
  S.btnConvRetryErr.style.display = 'none';
  S.convActions.style.display = 'none';
  S.convResultsEl.innerHTML = '';
  const parsed = lines.map(S.parseConverterLine);
  const rows = [];
  for (let i = 0; i < parsed.length; i++) {
    S.convStatus.textContent = `Mencocokkan ${i + 1} / ${parsed.length} — ${parsed[i].kode}`;
    rows.push(await matchOneKode(parsed[i].kode, parsed[i].nama_input));
  }
  await finishConvBatch(rows);
  S.btnConvProses.disabled = false;
}

S.btnConvProses.addEventListener('click', processConverter);
S.btnConvRetryErr.addEventListener('click', async () => {
  const errIdxs = S.convRows.map((r, i) => r.status === 'error' ? i : -1).filter(i => i >= 0);
  if (!errIdxs.length) return;
  S.btnConvRetryErr.disabled = true;
  for (let n = 0; n < errIdxs.length; n++) {
    const i = errIdxs[n];
    S.convStatus.textContent = `Mengulang ${n + 1} / ${errIdxs.length} — ${S.convRows[i].kode}`;
    S.convRows[i] = await matchOneKode(S.convRows[i].kode, S.convRows[i].nama_input);
  }
  await finishConvBatch(S.convRows);
  S.btnConvRetryErr.disabled = false;
});
S.btnConvClear.addEventListener('click', () => {
  S.convInput.value = '';
  S.convResultsEl.innerHTML = '';
  S.convStatus.textContent = '';
  S.convActions.style.display = 'none';
  S.btnConvRetryErr.style.display = 'none';
  S.convRows = [];
  Object.values(S.convManualTimers).forEach(clearTimeout);
  S.convExpandedIdx = new Set();
  S.convManualResults = {}; S.convManualQuery = {}; S.convManualTimers = {}; S.convManualSeq = {};
});

// Toggle accordion + klik "Pilih" di hasil search manual.
S.convResultsEl.addEventListener('click', (e) => {
  const pickBtn = e.target.closest('.conv-manual-pick');
  if (pickBtn) {
    const i = parseInt(pickBtn.dataset.idx, 10);
    const kode = pickBtn.dataset.kode;
    const st = S.convManualResults[i];
    const produk = st && st.items && st.items.find(p => p.kode_produk === kode);
    if (!produk || !S.convRows[i]) return;
    pickBtn.disabled = true;
    S.convRows[i].produk = produk;
    S.convRows[i].status = 'manual_matched';
    S.convRows[i].errMsg = null;
    S.convExpandedIdx.delete(i);
    S.convManualResults[i] = null;
    S.convManualQuery[i] = '';
    S.enrichResultsWithStok([produk]).finally(() => { S.patchConvRow(i); S.updateConvSummary(); });
    return;
  }
  const toggleHeader = e.target.closest('.kb-item-header[data-action="conv-toggle"]');
  if (toggleHeader) {
    const i = parseInt(toggleHeader.dataset.idx, 10);
    if (!S.convRows[i] || S.convRows[i].produk) return; // cuma baris belum-ketemu yang punya detail buat dibuka
    if (S.convExpandedIdx.has(i)) S.convExpandedIdx.delete(i); else S.convExpandedIdx.add(i);
    S.patchConvRow(i);
  }
});

// Search manual, di-debounce biar gak nembak RPC tiap ketikan huruf (konsisten
// sama debounce search utama di tab Cari Cepat).
S.convResultsEl.addEventListener('input', (e) => {
  const inp = e.target.closest('.conv-manual-input');
  if (!inp) return;
  const i = parseInt(inp.dataset.idx, 10);
  S.convManualQuery[i] = inp.value;
  clearTimeout(S.convManualTimers[i]);
  S.convManualTimers[i] = setTimeout(() => S.convManualSearch(i, inp.value), 300);
});

S.btnConvAddAll.addEventListener('click', async () => {
  S.btnConvAddAll.disabled = true;
  try {
    // Konsisten sama "+ Tambahkan ke Konversi" di Cari Cepat dan submit Permintaan
    // RS: kalau ini bakal jadi sesi PERTAMA, konfirmasi dulu.
    if (!S.currentSesiId) {
      const ok = await S.showConfirmModal({
        title: 'Mulai Konversi Baru?',
        text: 'Produk-produk terpilih bakal masuk ke sesi konversi baru.',
        okText: 'Ya, Mulai Konversi'
      });
      if (!ok) { S.btnConvAddAll.disabled = false; return; }
    }
    // Pastikan sesi kebuat/kepake SEKALI dulu di sini, sebelum loop nambahin
    // item — kalau enggak, tiap item bisa manggil ensureSesi() hampir bareng
    // dan masing-masing bikin sesi barunya sendiri (race condition → numpuk
    // sesi kosong di "Konversi Berjalan").
    await S.ensureSesi();
    const checks = [...S.convResultsEl.querySelectorAll('.conv-check')];
    let added = 0, skipped = 0;
    for (const chk of checks) {
      if (!chk.checked) continue;
      const row = S.convRows[parseInt(chk.dataset.idx, 10)];
      if (!row || !row.produk) continue;
      const r = row.produk;
      if (S.clipboard.some(c => c.kode_produk === r.kode_produk)) { skipped++; continue; }
      const isSet = r.tipe && r.tipe.toLowerCase() === 'set';
      const newItem = {
        kode_produk: r.kode_produk,
        kode_asli: r.kode_asli || null,
        nama_produk: r.nama_produk,
        tipe: r.tipe,
        is_set: isSet,
        produk_id: r.id || null,
        no_akd: r.no_akd,
        kode_kfa: r.kode_kfa,
        link_v6: r.link_v6,
        harga_ekat: r.harga_ekat || null,
        tahun_harga: r.tahun_harga || null,
        harga_swasta: r.harga_swasta || null,
        tahun_harga_swasta: r.tahun_harga_swasta || null,
        stok_status: r.stok_status || null,
        stok_qty: r.stok_qty ?? null,
        qty: 1
      };
      S.clipboard.push(newItem);
      await S.persistAddItem(newItem); // ditunggu satu-satu biar gak ada race lain & gak nge-flood API
      added++;
    }
    S.updateClipboard();
    S.showToast(`${added} produk ditambahkan ke clipboard` + (skipped ? `, ${skipped} sudah ada di clipboard` : ''), added > 0 ? 'success' : 'error');
  } finally {
    S.btnConvAddAll.disabled = false;
  }
});

}
