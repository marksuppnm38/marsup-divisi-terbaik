// AUTO-EXTRACTED dari konversian/index.js (breakup sesuai map.md bagian 3) — Claude, 2026-09-15.
// Region asli: lihat map.md bagian 2. Semua state lintas-file diakses lewat
// objek 'S' yang dioper dari index.js (S = window.__konvBridge-style shared
// state, TAPI bukan window global — cuma dioper sebagai parameter, lihat
// index.js: const S = {}; lalu install*(S) dipanggil berurutan).
// Logic di dalam TIDAK diubah — cuma referensi ke variabel/fungsi yang
// didefinisikan di file LAIN diganti jadi S.nama (lihat COORD LOG index.js).
export function installClipboard(S) {
// ══════════════════════════════════════════
// SESI KONVERSI: bikin "clipboard" jadi objek yang tersimpan di server,
// bukan array lokal doang. Satu sesi = satu konversi yang lagi dikerjakan,
// bisa dibuka lagi (dan dibantu tim lain) dari daftar "Konversi Berjalan".
// ══════════════════════════════════════════
const SESI_TABLE = 'sesi_konversi';
S.SESI_TABLE = SESI_TABLE;
const SESI_ITEM_TABLE = 'sesi_konversi_item';
S.SESI_ITEM_TABLE = SESI_ITEM_TABLE;
const PERMINTAAN_ITEM_TABLE = 'permintaan_item'; // tabel mentah di balik RPC get_permintaan_by_sesi/update_permintaan_item_multi — dipakai buat filter postgres_changes
S.PERMINTAAN_ITEM_TABLE = PERMINTAAN_ITEM_TABLE;
S.currentSesiId = null;
S.currentButuhBantuan = false;

const subtabCari = document.getElementById('subtab-cari');
S.subtabCari = subtabCari;
const subtabSesi = document.getElementById('subtab-sesi');
S.subtabSesi = subtabSesi;
const subtabRiwayat = document.getElementById('subtab-riwayat');
S.subtabRiwayat = subtabRiwayat;
const subtabConverter = document.getElementById('subtab-converter');
S.subtabConverter = subtabConverter;
const subtabSetcari = document.getElementById('subtab-setcari');
S.subtabSetcari = subtabSetcari;
const subtabDictionary = document.getElementById('subtab-dictionary');
S.subtabDictionary = subtabDictionary;
const cariControls = document.getElementById('cari-controls');
S.cariControls = cariControls;
const panelBodyCari = document.getElementById('panel-body-cari');
S.panelBodyCari = panelBodyCari;
const panelBodySesi = document.getElementById('panel-body-sesi');
S.panelBodySesi = panelBodySesi;
const panelBodyRiwayat = document.getElementById('panel-body-riwayat');
S.panelBodyRiwayat = panelBodyRiwayat;
const panelBodyConverter = document.getElementById('panel-body-converter');
S.panelBodyConverter = panelBodyConverter;
const panelBodySetcari = document.getElementById('panel-body-setcari');
S.panelBodySetcari = panelBodySetcari;
const panelBodyDictionary = document.getElementById('panel-body-dictionary');
S.panelBodyDictionary = panelBodyDictionary;
const setcariBadge = document.getElementById('setcari-badge');
S.setcariBadge = setcariBadge;
// BUGFIX 2026-09-15: blok kb-*/clipTab* ini tadinya ke-taruh di realtime.js
// (breakup sesi hari ini) — sengaja dipindah ke sini karena switchClipTab()
// (di bawah, dipasang lewat installClipboard) langsung manggil
// S.clipTabBtnKb.addEventListener(...) dkk SAAT installClipboard(S) jalan,
// padahal index.js manggil installClipboard(S) SEBELUM installRealtime(S).
// Elemen ini murni DOM refs buat tab Clipboard/Kebutuhan RS, bukan sesuatu
// yang realtime-specific — sama alasan/pola kayak komentar setcari di bawah
// ini (temporal dead zone kalau const-nya dideklarasikan belakangan). — Claude
const kbSection = document.getElementById('clip-kebutuhan-section');
S.kbSection = kbSection;
const kbEmptyState = document.getElementById('kb-empty-state');
S.kbEmptyState = kbEmptyState;
const kbEmptyCta = document.getElementById('kb-empty-cta');
S.kbEmptyCta = kbEmptyCta;
const kbRealContent = document.getElementById('kb-real-content');
S.kbRealContent = kbRealContent;
const kbTitle = document.getElementById('kb-title');
S.kbTitle = kbTitle;
const kbCount = document.getElementById('kb-count');
S.kbCount = kbCount;
const kbList = document.getElementById('kb-list');
S.kbList = kbList;
const kbSectionTabs = document.getElementById('kb-section-tabs');
S.kbSectionTabs = kbSectionTabs;
const kbSummary = document.getElementById('kb-summary');
S.kbSummary = kbSummary;
const kbRecordStatus = document.getElementById('kb-record-status');
S.kbRecordStatus = kbRecordStatus;
const kbCollapseBtn = document.getElementById('kb-collapse-btn');
S.kbCollapseBtn = kbCollapseBtn;
const kbRefreshBtn = document.getElementById('kb-refresh-btn');
S.kbRefreshBtn = kbRefreshBtn;
const kbRefreshStatus = document.getElementById('kb-refresh-status');
S.kbRefreshStatus = kbRefreshStatus;
const clipTabRow = document.getElementById('clip-tab-row');
S.clipTabRow = clipTabRow;
const clipTabBtnKb = document.getElementById('clip-tab-btn-kb');
S.clipTabBtnKb = clipTabBtnKb;
const clipTabBtnList = document.getElementById('clip-tab-btn-list');
S.clipTabBtnList = clipTabBtnList;
const clipTabBtnSph = document.getElementById('clip-tab-btn-sph');
S.clipTabBtnSph = clipTabBtnSph;
const clipTabBadgeKb = document.getElementById('clip-tab-badge-kb');
S.clipTabBadgeKb = clipTabBadgeKb;
const clipTabBadgeList = document.getElementById('clip-tab-badge-list');
S.clipTabBadgeList = clipTabBadgeList;
const clipTabPanelKb = document.getElementById('clip-tab-panel-kb');
S.clipTabPanelKb = clipTabPanelKb;
const clipTabPanelList = document.getElementById('clip-tab-panel-list');
S.clipTabPanelList = clipTabPanelList;
const clipTabPanelSph = document.getElementById('clip-tab-panel-sph');
S.clipTabPanelSph = clipTabPanelSph;
const clipSummaryStrip = document.getElementById('clip-summary-strip');
S.clipSummaryStrip = clipSummaryStrip;
// Refs modul "Cari SET Mendekati" — dideklarasikan di sini (bukan di dekat
// fungsi-fungsinya di bawah) karena updateClipboard() manggil
// updateSetcariSourceCount() sejak load pertama; kalau const-nya baru
// dideklarasikan belakangan, ini ReferenceError (temporal dead zone).
const setcariSearchBtn = document.getElementById('setcari-search-btn');
S.setcariSearchBtn = setcariSearchBtn;
const setcariStatus = document.getElementById('setcari-status');
S.setcariStatus = setcariStatus;
const setcariEmpty = document.getElementById('setcari-empty');
S.setcariEmpty = setcariEmpty;
const setcariList = document.getElementById('setcari-list');
S.setcariList = setcariList;
const setcariSourceLabel = document.getElementById('setcari-source-label');
S.setcariSourceLabel = setcariSourceLabel;
const setcariSrcClip = document.getElementById('setcari-src-clip');
S.setcariSrcClip = setcariSrcClip;
const setcariSrcPaste = document.getElementById('setcari-src-paste');
S.setcariSrcPaste = setcariSrcPaste;
const setcariPasteWrap = document.getElementById('setcari-paste-wrap');
S.setcariPasteWrap = setcariPasteWrap;
const setcariPasteInput = document.getElementById('setcari-paste-input');
S.setcariPasteInput = setcariPasteInput;
S.setcariSourceMode = 'clip'; // 'clip' | 'paste' — pintu sumber kode buat Cari SET Mendekati
const riwayatList = document.getElementById('riwayat-list');
S.riwayatList = riwayatList;
const riwayatListEmpty = document.getElementById('riwayat-list-empty');
S.riwayatListEmpty = riwayatListEmpty;
const riwayatListLoading = document.getElementById('riwayat-list-loading');
S.riwayatListLoading = riwayatListLoading;
const riwayatListError = document.getElementById('riwayat-list-error');
S.riwayatListError = riwayatListError;
const btnRiwayatRefresh = document.getElementById('btn-riwayat-refresh');
S.btnRiwayatRefresh = btnRiwayatRefresh;
const riwayatSearchInput = document.getElementById('riwayat-search-input');
S.riwayatSearchInput = riwayatSearchInput;
const riwayatClearBtn = document.getElementById('riwayat-clear-btn');
S.riwayatClearBtn = riwayatClearBtn;
S.riwayatSearchDebounce = null;
const riwayatSalesFilter = document.getElementById('riwayat-sales-filter');
S.riwayatSalesFilter = riwayatSalesFilter;
const riwayatPeriodFilter = document.getElementById('riwayat-period-filter');
S.riwayatPeriodFilter = riwayatPeriodFilter;
const sesiBadge = document.getElementById('sesi-badge');
S.sesiBadge = sesiBadge;
const sesiList = document.getElementById('sesi-list');
S.sesiList = sesiList;
const sesiListEmpty = document.getElementById('sesi-list-empty');
S.sesiListEmpty = sesiListEmpty;
const sesiListLoading = document.getElementById('sesi-list-loading');
S.sesiListLoading = sesiListLoading;
const sesiListError = document.getElementById('sesi-list-error');
S.sesiListError = sesiListError;
const btnSesiBaru = document.getElementById('btn-sesi-baru');
const btnSesiRefresh = document.getElementById('btn-sesi-refresh');
const btnButuhBantuan = document.getElementById('btn-butuh-bantuan');
const sesiSaveStatus = document.getElementById('sesi-save-status');
const sessionIndicator = document.getElementById('session-indicator');
S.sessionIndicator = sessionIndicator;
const sessionIndicatorDot = document.getElementById('session-indicator-dot');
const sessionIndicatorText = document.getElementById('session-indicator-text');
S.sessionIndicatorText = sessionIndicatorText;
const btnEndSesi = document.getElementById('btn-end-sesi');
const btnLeaveSesi = document.getElementById('btn-leave-sesi');
const toastContainer = document.getElementById('toast-container');
const APP_TITLE_BASE = document.title; // "Conversion Workspace — PT Pionir Nusantara Manufacturing"
S.APP_TITLE_BASE = APP_TITLE_BASE;

// Notifikasi kecil yang muncul-hilang sendiri — dipakai buat kasih feedback instan
// untuk aksi yang sebelumnya senyap (bikin sesi, selesaikan sesi), biar user gak
// ragu-ragu apakah aksinya beneran kejadian atau enggak.
function showToast(msg, type = 'success') {
  // Body delegate ke shared/toast.js — signature & 32 titik panggil di file
  // ini sama sekali gak berubah, cuma implementasinya yang sekarang satu
  // sumber sama crud-produk.js (lihat shared/toast.js buat detail/alasan).
  PNMToast.show(msg, type);
}
S.showToast = showToast;

// Render pesan error yang seragam buat daftar (Sesi/Riwayat/Dictionary), lengkap
// sama tombol "Coba lagi" — biar user gak harus pindah tab/refresh cuma buat
// nyoba ulang satu request yang gagal (misal gara-gara koneksi sempat putus).
function renderListError(el, msg, retryFn) {
  el.innerHTML = `<div>${msg}</div><button type="button" class="list-error-retry-btn" style="margin-top:8px;background:none;border:1px solid var(--danger-border);color:var(--danger);border-radius:6px;padding:4px 10px;font-size:11.5px;font-weight:600;cursor:pointer;font-family:inherit">Coba lagi</button>`;
  el.style.display = 'block';
  const btn = el.querySelector('.list-error-retry-btn');
  if (btn) btn.addEventListener('click', retryFn);
}
S.renderListError = renderListError;

// Tombol "Selesaikan Sesi"/"Keluar dari Sesi" cuma boleh aktif kalau memang
// lagi ada sesi yang berjalan di server (currentSesiId keisi) — jadi state-nya
// selalu nyambung sama kenyataan, gak pernah nampilin tombol aktif buat sesi
// yang gak ada.
function updateEndSesiBtnState() {
  btnEndSesi.disabled = !S.currentSesiId;
  if (btnLeaveSesi) btnLeaveSesi.disabled = !S.currentSesiId;
}
S.updateEndSesiBtnState = updateEndSesiBtnState;

function setSesiSavedStatus(text, isError) {
  sesiSaveStatus.textContent = text || '';
  sesiSaveStatus.style.color = isError ? 'var(--danger)' : 'var(--text-muted)';
  // Dot di badge sesi (header global) ngikutin status simpan yang sama —
  // biar "draft belum tersimpan" vs "sudah tersimpan" kebaca dari satu titik
  // yang selalu kelihatan, bukan cuma teks kecil ini yang gampang kelewat scroll.
  sessionIndicatorDot.classList.remove('dot-saving', 'dot-saved', 'dot-error');
  if (isError) sessionIndicatorDot.classList.add('dot-error');
  else if (text === 'Menyimpan…') sessionIndicatorDot.classList.add('dot-saving');
  else if (text) sessionIndicatorDot.classList.add('dot-saved');
  // text kosong (belum ada aktivitas sama sekali) → dot netral, biarin default abu-abu
}
S.setSesiSavedStatus = setSesiSavedStatus;
sessionIndicator.addEventListener('click', () => {
  // Was just switchSubTab('sesi') -- with the door-switch buttons gone,
  // this status pill is now the ONLY way to reach the full workspace view
  // from a fresh page load, so it needs to actually escalate the door too
  // (door-cari mode hides .subtab-row/.panel-clip with !important; without
  // this, clicking here while still in the default minimal view would
  // switch the active tab to "sesi" underneath a hidden tab strip).
  S.switchDoor('konversi');
  if (window.innerWidth <= 860 && typeof switchTab === 'function') switchTab('search');
  S.switchSubTab('sesi');
});

// Semua panggilan REST ke Supabase buat modul sesi lewat sini, supaya kalau
// token expired di tengah jalan, langsung ditendang balik ke gerbang login.
async function sesiFetch(path, options = {}) {
  const token = await S.getFreshToken();
  const res = await fetch(`${S.SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'apikey': S.ANON_KEY,
      'Authorization': 'Bearer ' + token,
      ...(options.headers || {})
    }
  });
  if (res.status === 401) { S.showGate('Sesi kamu habis, silakan masuk lagi.'); throw new Error('Sesi login habis'); }
  return res;
}
S.sesiFetch = sesiFetch;

async function touchSesiUpdatedAt(id) {
  if (!id) return;
  try {
    await sesiFetch(`${SESI_TABLE}?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ updated_at: new Date().toISOString() })
    });
  } catch { /* diamkan, bukan blocking */ }
}

// Bikin baris sesi baru di server begitu ada aktivitas pertama (isi form atau
// tambah produk), kalau belum ada sesi yang lagi dibuka.
async function ensureSesi() {
  if (S.currentSesiId) return S.currentSesiId;
  const body = {
    nama_rs: S.inpRs.value.trim() || null,
    nama_sales: S.inpSales.value.trim() || null,
    pic_marsup: S.inpMarsup.value.trim() || null,
    pagu: (typeof S.checklistPagu !== 'undefined' ? S.checklistPagu : null),
    status: 'berjalan',
    butuh_bantuan: S.currentButuhBantuan,
    mode_harga_swasta: S.modeSwastaOutput
  };
  const res = await sesiFetch(SESI_TABLE, {
    method: 'POST',
    headers: { 'Prefer': 'return=representation' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.message || errData.hint || 'Gagal membuat sesi baru (cek tabel sesi_konversi di Supabase)');
  }
  const rows = await res.json();
  S.currentSesiId = rows[0].id;
  updateEndSesiBtnState();
  S.updateClipHeaderCompact(); // refresh indikator header (ikut currentSesiId, bukan cuma nama RS)
  if (typeof S.subscribeToSesiRealtime === 'function') S.subscribeToSesiRealtime(S.currentSesiId);
  return S.currentSesiId;
}
S.ensureSesi = ensureSesi;

async function persistAddItem(item) {
  setSesiSavedStatus('Menyimpan…');
  try {
    const sesiId = await ensureSesi();
    const res = await sesiFetch(SESI_ITEM_TABLE, {
      method: 'POST',
      headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify({
        sesi_id: sesiId,
        kode_produk: item.kode_produk,
        kode_asli: item.kode_asli,
        nama_produk: item.nama_produk,
        tipe: item.tipe,
        is_set: item.is_set,
        produk_id: item.produk_id,
        no_akd: item.no_akd,
        kode_kfa: item.kode_kfa,
        link_v6: item.link_v6,
        harga_ekat: item.harga_ekat,
        tahun_harga: item.tahun_harga,
        harga_swasta: item.harga_swasta,
        tahun_harga_swasta: item.tahun_harga_swasta,
        stok_status: item.stok_status,
        stok_qty: item.stok_qty,
        qty: item.qty
      })
    });
    if (res.ok) {
      const rows = await res.json();
      item._sesiItemId = rows[0] && rows[0].id;
    }
    await touchSesiUpdatedAt(sesiId);
    setSesiSavedStatus('Tersimpan ✓');
  } catch (err) {
    setSesiSavedStatus('Gagal simpan: ' + err.message, true);
  }
}
S.persistAddItem = persistAddItem;

async function persistRemoveItem(item) {
  if (!S.currentSesiId) return;
  setSesiSavedStatus('Menyimpan…');
  try {
    if (item._sesiItemId) {
      await sesiFetch(`${SESI_ITEM_TABLE}?id=eq.${item._sesiItemId}`, { method: 'DELETE' });
    } else {
      await sesiFetch(`${SESI_ITEM_TABLE}?sesi_id=eq.${S.currentSesiId}&kode_produk=eq.${encodeURIComponent(item.kode_produk)}`, { method: 'DELETE' });
    }
    await touchSesiUpdatedAt(S.currentSesiId);
    // WORKAROUND: postgres_changes event DELETE ternyata gak reliable di Supabase
    // Realtime (dikonfirmasi manual: SQL DELETE langsung pun gak ngirim event apa-apa
    // buat tabel ini — publication/RLS/replica identity semua udah benar, ini murni
    // limitation di sisi Supabase, bukan config kita). Makanya penghapusan disiarin
    // manual lewat Broadcast begitu REST DELETE-nya sukses, bukan nunggu postgres_changes.
    if (typeof S.broadcastItemRemoved === 'function') S.broadcastItemRemoved(item);
    setSesiSavedStatus('Tersimpan ✓');
  } catch (err) {
    setSesiSavedStatus('Gagal hapus: ' + err.message, true);
  }
}

let qtySaveTimer = null;
function persistUpdateQty(item) {
  if (!S.currentSesiId || !item._sesiItemId) return;
  setSesiSavedStatus('Menyimpan…');
  clearTimeout(qtySaveTimer);
  qtySaveTimer = setTimeout(async () => {
    try {
      await sesiFetch(`${SESI_ITEM_TABLE}?id=eq.${item._sesiItemId}`, {
        method: 'PATCH',
        body: JSON.stringify({ qty: item.qty })
      });
      await touchSesiUpdatedAt(S.currentSesiId);
      setSesiSavedStatus('Tersimpan ✓');
    } catch (err) {
      setSesiSavedStatus('Gagal simpan qty: ' + err.message, true);
    }
  }, 400);
}
S.persistUpdateQty = persistUpdateQty;

// Nama RS / Sales / PIC diketik → sesi ikut keupdate (bikin baru kalau belum ada)
let headerSaveTimer = null;
// Kalau belum ada sesi & user nolak konfirmasi "Mulai Konversi Baru?" pas ngetik
// di field ini, jangan nanya ULANG tiap debounce nembak lagi (bisa tiap keystroke-
// pause) — cukup sekali per "sesi ngetik form" ini. Direset begitu ada sesi baru
// beneran kebentuk di tempat lain (lihat resetChecklistUI()).
S.headerFieldsSesiDeclined = false;
[S.inpRs, S.inpSales, S.inpMarsup].forEach(inp => {
  inp.addEventListener('input', () => {
    clearTimeout(headerSaveTimer);
    setSesiSavedStatus('Menyimpan…');
    headerSaveTimer = setTimeout(async () => {
      if (!S.currentSesiId) {
        if (S.headerFieldsSesiDeclined) { setSesiSavedStatus(''); return; }
        const ok = await S.showConfirmModal({
          title: 'Mulai Konversi Baru?',
          text: 'Isian ini bakal disimpan ke sesi konversi baru.',
          okText: 'Ya, Mulai Konversi'
        });
        if (!ok) { S.headerFieldsSesiDeclined = true; setSesiSavedStatus(''); return; }
      }
      try {
        const sesiId = await ensureSesi();
        const namaRs = S.inpRs.value.trim() || null;
        const namaSales = S.inpSales.value.trim() || null;
        const picMarsup = S.inpMarsup.value.trim() || null;
        S.markLocalWrite(SESI_TABLE, sesiId, 'nama_rs', namaRs);
        S.markLocalWrite(SESI_TABLE, sesiId, 'nama_sales', namaSales);
        S.markLocalWrite(SESI_TABLE, sesiId, 'pic_marsup', picMarsup);
        await sesiFetch(`${SESI_TABLE}?id=eq.${sesiId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            nama_rs: namaRs,
            nama_sales: namaSales,
            pic_marsup: picMarsup,
            updated_at: new Date().toISOString()
          })
        });
        setSesiSavedStatus('Tersimpan ✓');
      } catch (err) {
        setSesiSavedStatus('Gagal simpan: ' + err.message, true);
      }
    }, 700);
  });
});

// ---- Editing indicator: broadcast 'editing' pas fokus di salah satu field header,
// biar kolaborator lain liat "lagi diedit siapa" — ini SOFT-locking (cuma sinyal),
// bukan hard lock; semua tetep bisa ngedit bareng kapan aja. ----
const RT_FIELD_MAP = [[S.inpRs, 'nama_rs'], [S.inpSales, 'nama_sales'], [S.inpMarsup, 'pic_marsup']];
S.editingBroadcastTimer = null;
RT_FIELD_MAP.forEach(([inp, field]) => {
  inp.addEventListener('focus', () => {
    broadcastEditing(field);
    clearInterval(S.editingBroadcastTimer);
    S.editingBroadcastTimer = setInterval(() => broadcastEditing(field), 3000); // di-refresh berkala selama fokus, biar kolaborator lain tau masih diedit
  });
  inp.addEventListener('blur', () => {
    clearInterval(S.editingBroadcastTimer);
    broadcastEditingStop(field);
  });
});
function broadcastEditing(field) {
  if (!S.sesiPresenceChannel) return;
  S.sesiPresenceChannel.send({ type: 'broadcast', event: 'editing', payload: { field, nama: S.currentDisplayName() } }).catch(() => {});
}
function broadcastEditingStop(field) {
  if (!S.sesiPresenceChannel) return;
  S.sesiPresenceChannel.send({ type: 'broadcast', event: 'editing_stop', payload: { field } }).catch(() => {});
}
const editingBadgeTimers = {}; // field -> timeout id
S.editingBadgeTimers = editingBadgeTimers;
function handleEditingBroadcast({ payload }) {
  if (!payload || !payload.field) return;
  const badge = document.getElementById('editing-badge-' + payload.field);
  if (!badge) return;
  badge.textContent = `· ${payload.nama} sedang mengedit`;
  badge.classList.add('show');
  clearTimeout(editingBadgeTimers[payload.field]);
  // Safety net: kalau broadcast 'editing_stop' gak nyampe (tab ditutup paksa,
  // koneksi putus), badge tetep ke-auto-hide sendiri abis beberapa detik gak
  // di-refresh — refresh berkala di atas (tiap 3 detik) yang jaga ini tetep nyala
  // selama beneran masih diedit.
  editingBadgeTimers[payload.field] = setTimeout(() => badge.classList.remove('show'), 5000);
}
S.handleEditingBroadcast = handleEditingBroadcast;
function handleEditingStopBroadcast({ payload }) {
  if (!payload || !payload.field) return;
  const badge = document.getElementById('editing-badge-' + payload.field);
  if (!badge) return;
  clearTimeout(editingBadgeTimers[payload.field]);
  badge.classList.remove('show');
}
S.handleEditingStopBroadcast = handleEditingStopBroadcast;

function renderButuhBantuanBtn() {
  btnButuhBantuan.classList.toggle('on', S.currentButuhBantuan);
  btnButuhBantuan.textContent = S.currentButuhBantuan ? '🙋 Butuh Bantuan' : '🙋 Minta Bantuan';
}
S.renderButuhBantuanBtn = renderButuhBantuanBtn;
btnButuhBantuan.addEventListener('click', async () => {
  S.currentButuhBantuan = !S.currentButuhBantuan;
  renderButuhBantuanBtn();
  try {
    const sesiId = await ensureSesi();
    S.markLocalWrite(SESI_TABLE, sesiId, 'butuh_bantuan', S.currentButuhBantuan);
    await sesiFetch(`${SESI_TABLE}?id=eq.${sesiId}`, {
      method: 'PATCH',
      body: JSON.stringify({ butuh_bantuan: S.currentButuhBantuan, updated_at: new Date().toISOString() })
    });
    // Baru minta bantuan (bukan batalin) → langsung tawarin kirim link sesinya ke WA,
    // biar temen yang dihubungi bisa langsung klik & buka sesi yang sama.
    if (S.currentButuhBantuan && await S.showConfirmModal({ title: 'Minta Bantuan', text: 'Kirim link sesi ini ke WhatsApp sekarang?', okText: 'Ya, Kirim' })) {
      S.shareSesiToWhatsApp(sesiId, S.inpRs.value);
    }
  } catch (err) {
    showToast('Gagal update status bantuan: ' + err.message, 'error');
  }
});
renderButuhBantuanBtn();

// Mulai konversi baru dari nol (sesi lama tetap tersimpan, bisa dibuka lagi lewat daftar).
// Beda sama sebelumnya: begitu diklik, baris sesi langsung dibikin di server saat
// itu juga (bukan nunggu user isi form/nambah produk dulu) — biar "Mulai Sesi Baru"
// beneran berarti sesi udah mulai, dan langsung muncul di daftar Konversi Berjalan.
async function startNewSesi() {
  if (S.clipboard.length && !(await S.showConfirmModal({ title: 'Mulai Sesi Baru', text: 'Sesi yang sedang dibuka akan ditinggalkan — datanya tetap tersimpan, bisa dibuka lagi lewat daftar Konversi Berjalan.', okText: 'Ya, Mulai Baru' }))) return;
  S.currentSesiId = null;
  S.currentButuhBantuan = false;
  S.clipboard = [];
  S.inpRs.value = '';
  S.inpSales.value = '';
  updateClipboard();
  renderResults(S.lastResults);
  S.setClipHeaderCollapsed(false);
  S.updateClipHeaderCompact();
  renderButuhBantuanBtn();
  setSesiSavedStatus('');
  S.resetChecklistUI();
  updateEndSesiBtnState();
  S.switchSubTab('cari');

  btnSesiBaru.disabled = true;
  try {
    await ensureSesi();
    updateEndSesiBtnState();
    setSesiSavedStatus('Tersimpan ✓');
    showToast('Sesi baru dibuat ✓');
    S.loadSesiList();
  } catch (err) {
    showToast('Gagal bikin sesi baru: ' + err.message, 'error');
  } finally {
    btnSesiBaru.disabled = false;
  }
}
btnSesiBaru.addEventListener('click', startNewSesi);

// Nutup sesi yang lagi dibuka tanpa harus lewat Record — buat kasus sesi cuma
// dipakai cek-cek/diskusi dan gak jadi ada transaksi, tapi user tetap mau
// "beresin" biar gak numpuk di daftar Konversi Berjalan.
// FIX (fundamental, per diskusi): dulu SATU-SATUNYA cara keluar dari sesi
// adalah "Selesaikan Sesi" — yang "mahal" karena ngubah status:'selesai' di
// server (sesi ilang dari Konversi Berjalan, otomatis dianggap tertutup buat
// keperluan riwayat). Ini nambah opsi "murah": Keluar dari Sesi — cuma
// bersihin TAMPILAN lokal browser ini doang, gak nyentuh server sama sekali.
// Sesi tetap 'berjalan', tetap di daftar Konversi Berjalan, kolaborator lain
// (kalau ada) sama sekali gak keganggu — bisa dibuka lagi kapan aja lanjut
// dari kondisi terakhir, gak ada state yang keubah/ke-reset di server.
btnLeaveSesi.addEventListener('click', () => {
  if (!S.currentSesiId) return;
  S.currentSesiId = null;
  S.currentButuhBantuan = false;
  S.clipboard = [];
  S.inpRs.value = '';
  S.inpSales.value = '';
  updateClipboard();
  renderResults(S.lastResults);
  S.setClipHeaderCollapsed(false);
  S.updateClipHeaderCompact();
  renderButuhBantuanBtn();
  setSesiSavedStatus('');
  S.resetChecklistUI();
  updateEndSesiBtnState();
  showToast('Keluar dari sesi — sesi tetap berjalan, bisa dibuka lagi lewat daftar Konversi Berjalan');
  S.loadSesiList();
});
btnEndSesi.addEventListener('click', async () => {
  if (!S.currentSesiId) return;
  const namaAktif = S.inpRs.value.trim() || '(Nama RS belum diisi)';
  const ok = await S.showConfirmModal({
    title: 'Selesaikan Sesi',
    text: `Selesaikan sesi "${namaAktif}"? Sesi akan keluar dari daftar Konversi Berjalan, tapi datanya tetap tersimpan.`,
    okText: 'Ya, Selesaikan'
  });
  if (!ok) return;
  btnEndSesi.disabled = true;
  try {
    await sesiFetch(`${SESI_TABLE}?id=eq.${S.currentSesiId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'selesai', updated_at: new Date().toISOString() })
    });
    S.currentSesiId = null;
    S.currentButuhBantuan = false;
    S.clipboard = [];
    S.inpRs.value = '';
    S.inpSales.value = '';
    updateClipboard();
    renderResults(S.lastResults);
    S.setClipHeaderCollapsed(false);
    S.updateClipHeaderCompact();
    renderButuhBantuanBtn();
    setSesiSavedStatus('');
    S.resetChecklistUI();
    showToast('Sesi diselesaikan ✓');
    S.loadSesiList();
  } catch (err) {
    showToast('Gagal selesaikan sesi: ' + err.message, 'error');
  } finally {
    updateEndSesiBtnState();
  }
});
btnSesiRefresh.addEventListener('click', S.loadSesiList);

// ══════════════════════════════════════════
// TAB CLIPBOARD PANEL: Kebutuhan RS (mapping permintaan↔produk) vs Clipboard
// (hasil final) vs Buat SPH (generate surat penawaran langsung dari Clipboard).
// Ini gantiin versi lama yang numpuk dua-duanya vertikal dalam satu kolom
// sempit — sekarang yang lagi aktif dapat tinggi penuh panel.
// ══════════════════════════════════════════
let clipActiveTab = 'list';
const panelClipEl = document.getElementById('panel-clip');
// Tab "Buat SPH" gak butuh panel pencarian produk (item diambil dari
// Clipboard yang udah jadi, bukan dicari lagi), jadi search diciutkan
// otomatis begitu tab ini dibuka — form + preview PDF (SPH) atau tabel
// Kebutuhan RS bersection (kb) dapet ruang lebih lega tanpa user harus
// mencet tombol ciutkan manual dulu. Balik ke tab "list" (Cari Produk/
// Clipboard, yang justru BUTUH panel-search kebuka) otomatis ngembaliin
// panel search ke kondisi semula, TAPI cuma kalau kita sendiri yang nyiutin
// di sini — kalau user emang udah nyiutin duluan (manual) sebelum pindah
// tab, biarin tetap ciut, jangan maksa kebuka.
// Kenapa 'kb' ikut di-treat kayak 'sph': tabel Kebutuhan RS (section-grouped,
// per baris ada nama kebutuhan + N produk match) butuh lebar kanvas, bukan
// sidebar 340px. Picker produknya sendiri milih dari `clipboard` yang udah
// ke-add (bukan live-search), jadi gak butuh panel-search kebuka pas milih —
// aman di-collapse bareng.
let panelAutoCollapsedByTab = false;
function switchClipTab(tab) {
  clipActiveTab = tab;
  S.clipTabBtnKb.classList.toggle('active', tab === 'kb');
  S.clipTabBtnList.classList.toggle('active', tab === 'list');
  S.clipTabBtnSph.classList.toggle('active', tab === 'sph');
  S.clipTabPanelKb.style.display = tab === 'kb' ? 'flex' : 'none';
  S.clipTabPanelList.style.display = tab === 'list' ? 'flex' : 'none';
  S.clipTabPanelSph.style.display = tab === 'sph' ? 'flex' : 'none';
  if (panelClipEl) {
    panelClipEl.classList.toggle('tab-sph-active', tab === 'sph');
    panelClipEl.classList.toggle('tab-kb-active', tab === 'kb');
  }
  updateClipSummaryStrip();

  // 2026-09-14: 'kb' DICABUT dari daftar wide-canvas — auto-collapse search
  // panel di tab Kebutuhan RS itu keputusan salah (lihat percakapan), bikin
  // search bar ilang total pas lagi butuh nyari produk buat di-attach. SPH
  // tetap collapse karena panel itu emang form+preview PDF, gak butuh search.
  const wantsWideCanvas = (tab === 'sph');
  if (wantsWideCanvas) {
    if (S.panelSearchEl && !S.panelSearchEl.classList.contains('collapsed')) {
      panelAutoCollapsedByTab = true;
      S.setPanelSearchCollapsed(true, false);
    }
  } else if (panelAutoCollapsedByTab) {
    panelAutoCollapsedByTab = false;
    S.setPanelSearchCollapsed(false, false);
  }

  if (tab === 'sph' && typeof window.onSphTabOpen === 'function') window.onSphTabOpen();
}
S.switchClipTab = switchClipTab;
S.clipTabBtnKb.addEventListener('click', () => switchClipTab('kb'));
S.clipTabBtnList.addEventListener('click', () => switchClipTab('list'));
S.clipTabBtnSph.addEventListener('click', () => switchClipTab('sph'));
S.kbEmptyCta.addEventListener('click', () => S.openPrModal());

// Toggle antara empty-state ("belum ada Permintaan RS") dan konten checklist
// beneran di dalam tab Kebutuhan RS, plus update badge jumlah item pending
// di tab-nya sendiri biar kelihatan dari tab Clipboard tanpa perlu pindah.
function updateKbTabState() {
  const hasChecklist = !!S.checklistPermintaanId && S.checklistItems.length > 0;
  S.kbEmptyState.style.display = hasChecklist ? 'none' : 'flex';
  S.kbRealContent.style.display = hasChecklist ? 'flex' : 'none';
  if (hasChecklist) {
    const pending = S.checklistItems.filter(i => i.status === 'PENDING').length;
    S.clipTabBadgeKb.textContent = pending;
    S.clipTabBadgeKb.style.display = 'inline-block';
    S.clipTabBadgeKb.classList.toggle('warn', pending > 0);
  } else {
    S.clipTabBadgeKb.style.display = 'none';
  }
}
S.updateKbTabState = updateKbTabState;

// Strip ringkasan yang tetap kelihatan di kedua tab — biar progress pencocokan
// & total belanja tetap ke-track walau lagi buka tab yang lain.
function updateClipSummaryStrip() {
  const parts = [];
  const onKbTab = panelClipEl && panelClipEl.classList.contains('tab-kb-active');
  if (!onKbTab && S.checklistPermintaanId && S.checklistItems.length > 0) {
    const done = S.checklistItems.filter(i => i.status === 'TERPENUHI').length;
    parts.push(`Kebutuhan RS: <b>${done}/${S.checklistItems.length}</b> terpenuhi`);
  }
  if (S.clipboard.length > 0) {
    parts.push(`Clipboard: <b>${S.clipboard.length}</b> produk`);
    if (S.clipTotalHarga.textContent) parts.push(`<b>${S.clipTotalHarga.textContent}</b>`);
  }
  if (!parts.length) { S.clipSummaryStrip.style.display = 'none'; return; }
  S.clipSummaryStrip.style.display = 'flex';
  S.clipSummaryStrip.innerHTML = parts.map(p => `<span>${p}</span>`).join('');
}
S.updateClipSummaryStrip = updateClipSummaryStrip;
const progressFill = document.getElementById('progress-fill');
const progressLabel = document.getElementById('progress-label');
const modalSub = document.getElementById('modal-sub');

// DARK MODE: theme init + toggle binding lives in konversian.html (inline
// script near the end of <body>) and targets <html data-theme> only, which
// is what pnm-universal.css reacts to. A second, independent theme system
// used to live here — it read/wrote document.body's data-theme (ignored by
// the CSS) and attached its own click listener to the SAME #theme-toggle
// button as the one in konversian.html, so every click ran both handlers
// and they fought over the state, making the toggle look stuck/inconsistent.
// Removed. Use isDarkThemeActive() above (reads document.documentElement)
// if you need to know the current theme from this file.

// SUPABASE
async function rpc(fn, params) {
  const res = await sesiFetch(`rpc/${fn}`, {
    method: 'POST',
    body: JSON.stringify(params)
  });
  const data = await res.json();
  if (!res.ok) return {data:null, error:data};
  return {data, error:null};
}
S.rpc = rpc;

function rupiah(n) {
  if (!n && n !== 0) return '—';
  return 'Rp ' + Number(n).toLocaleString('id-ID');
}
S.rupiah = rupiah;

// Badge status stok — SATU sumber dipakai renderResults (Cari Cepat) DAN
// convRowHtml (Converter, lihat index.js), biar kalau logikanya berubah gak
// perlu diubah di 2 tempat yang gampang ketinggalan sinkron. `r` butuh
// stok_status/stok_qty (dan stok_komponen_terdata/total buat SET) — field ini
// diisi enrichResultsWithStok(), dipanggil abis runSearch() DAN abis
// finishConvBatch() di Converter.
function stokBadgeHtml(r, isSet) {
  return isSet
    ? (r.stok_status === 'READY'
        ? `<span class="mi stok-ready"><i class="ti ti-circle-check"></i><span>Ready · bisa rakit ${r.stok_qty} set</span></span>`
        : r.stok_status === 'INDENT'
          ? `<span class="mi stok-indent"><i class="ti ti-clock"></i><span>Indent${r.stok_qty ? ' · bisa rakit '+r.stok_qty+' set' : ''}</span></span>`
          : `<span class="mi stok-warn" title="${r.stok_komponen_terdata||0}/${r.stok_komponen_total||'?'} komponen sudah ada data stok"><i class="ti ti-alert-circle"></i><span>Data stok komponen blm lengkap</span></span>`)
    : (r.stok_status === 'READY'
        ? `<span class="mi stok-ready"><i class="ti ti-circle-check"></i><span>Ready · ${r.stok_qty} pcs</span></span>`
        : r.stok_status === 'INDENT'
          ? `<span class="mi stok-indent"><i class="ti ti-clock"></i><span>Indent${r.stok_qty ? ' · '+r.stok_qty+' pcs' : ''}</span></span>`
          : `<span class="mi stok-unknown"><i class="ti ti-help"></i><span>Stok: -</span></span>`);
}
S.stokBadgeHtml = stokBadgeHtml;

// MAX_THUMB_PX: dimensi maksimum sisi terpanjang thumbnail sebelum di-embed ke Excel.
// Gambar di sheet cuma ditampilkan ±80x65px, jadi resolusi sumber (kadang 800px+/gambar
// dari server) jauh lebih besar dari kebutuhan tampilan. Downscale di sini adalah
// pengurang ukuran file paling besar karena berat PNG kira-kira sebanding kuadrat dimensi.
const MAX_THUMB_PX = 240;

async function removeBackground(base64) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      // hitung ukuran target, downscale kalau sumbernya lebih besar dari MAX_THUMB_PX
      const scale = Math.min(1, MAX_THUMB_PX / Math.max(img.width, img.height));
      const targetW = Math.max(1, Math.round(img.width * scale));
      const targetH = Math.max(1, Math.round(img.height * scale));

      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, targetW, targetH);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = data.data;
      // ambil warna pojok kiri atas sebagai warna background
      const bgR = d[0], bgG = d[1], bgB = d[2];
      const threshold = 30;
      for (let i = 0; i < d.length; i += 4) {
        const dr = Math.abs(d[i] - bgR);
        const dg = Math.abs(d[i+1] - bgG);
        const db = Math.abs(d[i+2] - bgB);
        if (dr < threshold && dg < threshold && db < threshold) {
          d[i+3] = 0; // transparan
        }
      }
      ctx.putImageData(data, 0, 0);
      resolve(canvas.toDataURL('image/png').split(',')[1]);
    };
    img.onerror = () => resolve(base64);
    img.src = 'data:image/png;base64,' + base64;
  });
}
S.removeBackground = removeBackground;

// FETCH IMAGE AS BASE64
async function fetchImageBase64(kode_asli, kode_produk) {
  const kodeForUrl = (kode_asli && kode_asli.trim()) ? kode_asli.trim() : kode_produk;
  try {
    const url = S.THUMB_BASE + kodeForUrl + '.png';
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result.split(',')[1]);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch { return null; }
}
S.fetchImageBase64 = fetchImageBase64;

// AUTOCOMPLETE — reuses lastResults from runSearch, no separate API call needed.
// Dikurangin dari 6 ke 4 item: dropdown ini ngambang di atas list produk yang
// sebenarnya udah kelihatan di bawahnya, jadi makin sedikit & padat makin gak
// berasa nutup-nutupin — 4 quick-pick tercepat udah cukup, sisanya toh masih
// kebaca lewat scroll di list produk itu sendiri. (lihat juga max-height di
// pnm-konversian-rebase.css yang dikunci senada sama jumlah ini)
function renderAutocomplete(data) {
  if (!S.searchInput.value.trim() || !data || !data.length) {
    S.acBox.style.display = 'none'; S.acItems = []; S.acIndex = -1; return;
  }
  S.acItems = data.slice(0, 4);
  S.acIndex = -1;
  S.acBox.innerHTML = S.acItems.map(r => {
    const t = (r.tipe || '').toUpperCase();
    const tipeLabel = t === 'SET' ? 'Set' : t === 'UNIT' ? 'Unit' : 'Instrumen';
    return `<div class="ac-item"><span class="ac-name">${r.nama_produk}</span><span class="ac-code">${r.kode_produk || ''}</span><span class="ac-badge">${tipeLabel}</span></div>`;
  }).join('');
  S.acBox.querySelectorAll('.ac-item').forEach((el, i) => {
    el.addEventListener('click', () => {
      S.searchInput.value = S.acItems[i].nama_produk;
      S.acBox.style.display = 'none';
      runSearch();
    });
  });
  S.acBox.style.display = 'block';
}

function renderSkeletons(count) {
  const widths = [62, 75, 50, 68, 40, 80, 55, 45];
  S.loadingEl.innerHTML = Array.from({length: count}, (_, i) => {
    const w1 = widths[i % widths.length];
    const w2 = widths[(i + 3) % widths.length] * 0.6;
    return `<div class="skel-card"><div class="skeleton skel-bar" style="width:${w1}%"></div><div class="skeleton skel-bar" style="width:${w2}%;height:9px"></div></div>`;
  }).join('');
}

// SEARCH
let searchSeq = 0;
async function runSearch() {
  const q = S.searchInput.value.trim();
  if (!q) { reset(); return; }
  const mySeq = ++searchSeq; // request lama yang telat balik nanti diabaikan, bukan nimpa hasil yang lebih baru
  S.errEl.style.display = 'none';
  S.hintEl.style.display = 'none';
  renderSkeletons(Math.min(S.lastResults.length || 6, S.RESULTS_PER_PAGE));
  S.loadingEl.style.display = 'block';
  S.resultsEl.innerHTML = '';
  S.emptyEl.style.display = 'none';
  S.metaEl.textContent = '';
  const {data, error} = await rpc('search_produk_dengan_harga', {
    q, p_tipe: S.selectedTipe, only_akd: S.onlyAkd, only_kfa: false
  });
  if (mySeq !== searchSeq) return; // sudah ada pencarian lebih baru — buang hasil basi ini

  S.loadingEl.style.display = 'none'; // FIX: matikan loading begitu response datang (sebelum branching)

  if (error) {
    S.acBox.style.display = 'none';
    const msg = error.message || JSON.stringify(error);
    if (msg.includes('timeout') || msg.includes('canceling')) {
      S.emptyEl.style.display='block';
      S.metaEl.textContent='Pencarian timeout — coba kata kunci lebih spesifik';
    } else {
      const offlineHint = (!navigator.onLine) ? ' Sepertinya koneksi internet kamu sedang terputus.' : '';
      S.errEl.innerHTML = `<div>Gagal mencari: ${msg}.${offlineHint}</div><button type="button" id="err-retry-btn" style="margin-top:6px;background:none;border:1px solid var(--danger-border);color:var(--danger);border-radius:6px;padding:4px 10px;font-size:11.5px;font-weight:600;cursor:pointer;font-family:inherit">Coba lagi</button>`;
      S.errEl.style.display='block';
      const retryBtn = document.getElementById('err-retry-btn');
      if (retryBtn) retryBtn.addEventListener('click', () => { S.errEl.style.display='none'; runSearch(); });
    }
    return;
  }
  if (!data || !data.length) { S.emptyEl.style.display='block'; S.metaEl.textContent='Tidak ada hasil untuk "'+q+'"'; S.acBox.style.display='none'; return; }
  S.lastResults = data;
  await S.enrichResultsWithStok(S.lastResults);
  S.sortSelect.style.display = 'inline-block';
  applySort();
  S.currentPage = 1;
  S.metaEl.textContent = data.length + ' produk ditemukan — klik untuk tambah ke clipboard';
  renderResults(S.lastResults);
  if (S.pnmSettings.autoComplete) {
    renderAutocomplete(S.lastResults);
  } else {
    S.acBox.style.display = 'none';
    S.acBox.innerHTML = '';
    S.acItems = []; S.acIndex = -1;
  }
}

// SORT
function applySort() {
  const useLinkPriority = S.prioritizeLink && !S.modeSwasta;

  if (S.sortMode === 'relevance') {
    if (useLinkPriority) {
      S.lastResults = [...S.lastResults].sort((a, b) => {
        const aHas = a.link_v6 ? 0 : 1;
        const bHas = b.link_v6 ? 0 : 1;
        return aHas - bHas; // stable sort: urutan relevansi asli tetap terjaga di tiap grup
      });
    }
    return; // urutan asli dari backend (score DESC), atau sudah dipartisi link_v6 di atas
  }

  if (S.sortMode === 'stok_ready_dulu' || S.sortMode === 'stok_indent_dulu') {
    // urutan: READY -> INDENT -> tanpa data stok (paling bawah), lalu tie-break by qty desc
    const rank = (status) => status === 'READY' ? 0 : status === 'INDENT' ? 1 : 2;
    const dirFlip = S.sortMode === 'stok_indent_dulu';
    S.lastResults.sort((a, b) => {
      let ra = rank(a.stok_status), rb = rank(b.stok_status);
      if (dirFlip) {
        // tukar urutan READY/INDENT, tapi "tanpa data" tetap paling bawah
        if (ra < 2) ra = ra === 0 ? 1 : 0;
        if (rb < 2) rb = rb === 0 ? 1 : 0;
      }
      if (ra !== rb) return ra - rb;
      return (b.stok_qty || 0) - (a.stok_qty || 0);
    });
    return;
  }

  const field = S.modeSwasta ? 'harga_swasta' : 'harga_ekat';
  const dir = S.sortMode === 'harga_asc' ? 1 : -1;
  S.lastResults.sort((a, b) => {
    if (useLinkPriority) {
      const aHas = a.link_v6 ? 0 : 1;
      const bHas = b.link_v6 ? 0 : 1;
      if (aHas !== bHas) return aHas - bHas;
    }
    const av = a[field], bv = b[field];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;  // produk tanpa harga ditaruh paling bawah
    if (bv == null) return -1;
    return (av - bv) * dir;
  });
}

function renderResults(data) {
  // clamp currentPage kalau data berubah (misal abis filter) jadi lebih pendek dari halaman aktif
  const totalPages = Math.max(1, Math.ceil(data.length / S.RESULTS_PER_PAGE));
  if (S.currentPage > totalPages) S.currentPage = totalPages;
  if (S.currentPage < 1) S.currentPage = 1;
  const start = (S.currentPage - 1) * S.RESULTS_PER_PAGE;
  const pageData = data.slice(start, start + S.RESULTS_PER_PAGE);

  S.resultsEl.innerHTML = pageData.map((r, i) => {
    const inClip = S.clipboard.some(c => c.kode_produk === r.kode_produk);
    const isSet = r.tipe && r.tipe.toUpperCase() === 'SET';
    const tipeClass = isSet ? 'tipe-set' : (r.tipe && r.tipe.toUpperCase() === 'UNIT') ? 'tipe-unit' : 'tipe-other';
    const hargaTampil = S.modeSwasta ? r.harga_swasta : r.harga_ekat;
    const tahunTampil = S.modeSwasta ? r.tahun_harga_swasta : r.tahun_harga;
    const labelHarga = S.modeSwasta ? 'Harga Swasta' : 'Harga belum ada';
    const stokBadge = S.stokBadgeHtml(r, isSet);
    // SECURITY FIX 2026-08-14 (+ diperluas hari ini): konsisten dengan
    // renderClipItemHtml — escape SEMUA field yang datang dari DB (bisa
    // diisi manual lewat CRUD Produk oleh staf manapun) sebelum masuk
    // innerHTML/atribut, bukan cuma nama_produk. kode_produk/kode_asli/
    // no_akd/kode_kfa/tipe semuanya kolom teks bebas di database — kalau
    // salah satunya kebetulan diisi karakter HTML (sengaja atau gak),
    // tanpa escape ini bakal jadi stored XSS yang nyerang SEMUA user lain
    // yang buka hasil pencarian yang sama, bukan cuma yang ngisi datanya.
    const kode = S.escapeHtmlAttr(r.kode_produk||'');
    const kodeAsli = S.escapeHtmlAttr(r.kode_asli||'');
    const namaEsc = S.escapeHtmlAttr(r.nama_produk||'');
    const noAkdEsc = S.escapeHtmlAttr(r.no_akd||'');
    const kodeKfaEsc = S.escapeHtmlAttr(r.kode_kfa||'');
    const tipeEsc = S.escapeHtmlAttr(r.tipe||'');
    return `<div class="rcard${inClip?' selected':''}" data-kode="${kode}">
      <div class="rcard-top">
        <span class="rcard-name">${namaEsc||'—'}</span>
        ${r.tipe?`<span class="tipe-badge ${tipeClass}">${tipeEsc}</span>`:''}
      </div>
      <div class="rcard-meta">
        <span class="mi"><i class="ti ti-barcode"></i><span>${kode||'—'}</span></span>
        ${r.no_akd?`<span class="mi"><i class="ti ti-certificate"></i><span>${noAkdEsc}</span></span>`:''}
        ${r.kode_kfa?`<span class="mi"><i class="ti ti-tag"></i><span>${kodeKfaEsc}</span></span>`:''}
        ${hargaTampil?`<span class="mi harga"><i class="ti ti-coin-rupee"></i><span>${rupiah(hargaTampil)}${tahunTampil?' · '+tahunTampil:''}</span></span>`:`<span class="mi"><i class="ti ti-coin-rupee"></i><span style="color:var(--text-muted)">${S.modeSwasta?'Harga swasta belum ada':'Harga belum ada'}</span></span>`}
        ${stokBadge}
      </div>
      <div style="margin-top:6px;display:flex;align-items:center;flex-wrap:wrap;justify-content:space-between;gap:8px">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          ${S.modeSwasta ? '' : (r.link_v6 && S.isSafeHttpUrl(r.link_v6)
            ?`<a href="${S.escapeHtmlAttr(r.link_v6)}" target="_blank" rel="noopener" class="badge-katalog-yes" data-role="link-katalog"><i class="ti ti-circle-check" style="font-size:12px"></i> Ada di e-Katalog v6</a>`
            : r.status_inaproc === 'Disetujui'
              ?`<span class="badge-katalog-no" style="color:var(--rust-text,#8F3620);border-color:var(--rust,#B8492F);background:var(--rust-bg,#FBE8E2)"><i class="ti ti-alert-triangle" style="font-size:12px"></i> Disetujui INAPROC — siap dibuatkan Link V6!</span>`
              :`<span class="badge-katalog-no"><i class="ti ti-circle-x" style="font-size:12px"></i> Belum ada di e-Katalog</span>`
          )}
          <button class="btn-preview-gambar btn-lihat-gambar" data-kode="${kode}" data-kode-asli="${kodeAsli}" data-nama="${namaEsc}"><i class="ti ti-eye" style="font-size:12px"></i> Lihat Gambar</button>
          <button class="btn-preview-gambar btn-copy-produk" data-kode="${kode}"><i class="ti ti-copy" style="font-size:12px"></i> Copy</button>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          ${isSet?`<span style="font-size:11px;color:var(--success);display:flex;align-items:center;gap:3px"><i class="ti ti-packages" style="font-size:12px"></i> Set</span>`:''}
          <button class="btn-lampiran" data-kode="${kode}" data-is-set="${isSet}" style="font-size:11px;color:var(--accent-text);background:var(--accent-bg);border:1px solid var(--accent-text);border-radius:20px;padding:2px 8px;display:flex;align-items:center;gap:4px;cursor:pointer"><i class="ti ti-file-text" style="font-size:12px"></i> Lihat Lampiran</button>
          <button class="btn-edit-produk" data-kode="${kode}" title="Edit produk ini" style="font-size:11px;color:var(--text-secondary);background:var(--surface-2);border:1px solid var(--border-strong);border-radius:20px;padding:2px 8px;display:flex;align-items:center;gap:4px;cursor:pointer"><i class="ti ti-settings" style="font-size:12px"></i></button>
          ${inClip
            ? `<button class="btn-clip-toggle in-clip" data-kode="${kode}" data-action="remove"><i class="ti ti-circle-check" style="font-size:12px"></i> Di Konversi</button>`
            : `<button class="btn-clip-toggle" data-kode="${kode}" data-action="add"><i class="ti ti-circle-plus" style="font-size:12px"></i> Tambahkan ke Konversi</button>`}
        </div>
      </div>
    </div>`;
  }).join('');
  // Card body SENGAJA gak punya click listener lagi (dulu klik di mana aja
  // langsung commit ke Konversi/bikin row database — lihat diskusi rebase UI).
  // Cari Cepat sekarang murni baca: lihat, Copy, atau eksplisit "Tambahkan ke
  // Konversi" lewat tombol di bawah ini, gak ada jalan lain yang nulis ke server.
  S.resultsEl.querySelectorAll('.btn-clip-toggle').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleClipToggleClick(btn.dataset.kode, btn.dataset.action);
    });
  });
  S.resultsEl.querySelectorAll('.btn-edit-produk').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      S.navigateToEditProduk(btn.dataset.kode);
    });
  });
  S.resultsEl.querySelectorAll('.btn-lampiran').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      S.openLampiranModal(btn.dataset.kode, btn.dataset.isSet === 'true');
    });
  });
  S.resultsEl.querySelectorAll('[data-role="link-katalog"]').forEach(a => {
    a.addEventListener('click', (e) => { e.stopPropagation(); });
  });
  S.resultsEl.querySelectorAll('.btn-lihat-gambar').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      S.openGambarModal(btn.dataset.kodeAsli, btn.dataset.kode, btn.dataset.nama);
    });
  });
  S.resultsEl.querySelectorAll('.btn-copy-produk').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      copyProdukToClipboard(btn.dataset.kode);
    });
  });
  renderPagination(data.length);
}
S.renderResults = renderResults;

// COPY SATU PRODUK: kode, deskripsi, harga, link — siap paste ke WA.
// Link e-Katalog cuma relevan di mode e-Katalog — di mode Swasta link_v6
// gak ikut kecopy, konsisten sama badge katalog (baris di atas), sheet
// SUMMARY, dan sheet Kebutuhan RS di Export Excel yang juga nyembunyiin
// kolom Link pas modeSwastaOutput true.
function copyProdukToClipboard(kode) {
  const r = S.lastResults.find(x => x.kode_produk === kode);
  if (!r) return;
  const harga = S.modeSwasta ? r.harga_swasta : r.harga_ekat;
  const lines = [
    r.kode_produk || '-',
    r.nama_produk || '-',
    harga ? rupiah(harga) : 'Harga belum ada',
    S.modeSwasta ? '' : (r.link_v6 || '')
  ];
  const text = lines.join('\t');

  function fallbackCopy(str) {
    const ta = document.createElement('textarea');
    ta.value = str;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showToast('Disalin ke clipboard ✓');
    }).catch(() => {
      if (fallbackCopy(text)) showToast('Disalin ke clipboard ✓');
      else showToast('Gagal menyalin, coba lagi', 'error');
    });
  } else {
    if (fallbackCopy(text)) showToast('Disalin ke clipboard ✓');
    else showToast('Gagal menyalin, coba lagi', 'error');
  }
} // <- INI PENUTUP FUNCTION-NYA, PASTIKAN ADA
// PAGINATION
function renderPagination(totalItems) {
  const totalPages = Math.max(1, Math.ceil(totalItems / S.RESULTS_PER_PAGE));
  if (totalPages <= 1) { S.paginationEl.innerHTML = ''; S.paginationEl.classList.add('hidden'); return; }
  S.paginationEl.classList.remove('hidden');

  function pageBtn(p, label, disabled=false) {
    const active = p === S.currentPage;
    return `<button class="page-btn${active?' active':''}" data-page="${p}"${disabled?' disabled':''}>${label}</button>`;
  }

  // selalu tampilin halaman 1, halaman terakhir, dan sekitar halaman aktif; sisanya "…"
  const pagesToShow = [...new Set([1, totalPages, S.currentPage-1, S.currentPage, S.currentPage+1])]
    .filter(p => p >= 1 && p <= totalPages)
    .sort((a,b) => a-b);

  let numberBtns = '';
  let prevP = null;
  pagesToShow.forEach(p => {
    if (prevP !== null && p - prevP > 1) numberBtns += `<span class="page-info">…</span>`;
    numberBtns += pageBtn(p, p);
    prevP = p;
  });

  const startItem = (S.currentPage - 1) * S.RESULTS_PER_PAGE + 1;
  const endItem = Math.min(S.currentPage * S.RESULTS_PER_PAGE, totalItems);

  S.paginationEl.innerHTML = `
    <span class="page-info">${startItem}–${endItem} dari ${totalItems}</span>
    ${pageBtn(S.currentPage - 1, '<i class="ti ti-chevron-left"></i>', S.currentPage === 1)}
    ${numberBtns}
    ${pageBtn(S.currentPage + 1, '<i class="ti ti-chevron-right"></i>', S.currentPage === totalPages)}
  `;

  S.paginationEl.querySelectorAll('.page-btn[data-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = parseInt(btn.dataset.page, 10);
      if (!p || p < 1 || p > totalPages || p === S.currentPage) return;
      S.currentPage = p;
      renderResults(S.lastResults);
      panelBodyCari.scrollTop = 0;
    });
  });
}
// CLIPBOARD
// Satu-satunya jalan masuk dari Cari Cepat yang boleh nulis ke database — dipicu
// CUMA dari klik eksplisit tombol "Tambahkan ke Konversi" (lihat renderResults),
// gak pernah dari klik kartu. Kalau belum ada sesi jalan, konfirmasi dulu biar
// bikin row sesi_konversi itu keputusan sadar, bukan efek samping diam-diam.
async function handleClipToggleClick(kode, action) {
  if (action === 'remove') { removeFromClip(kode); return; }
  const isFirstCommit = !S.currentSesiId; // ini yang nentuin apa perlu konfirmasi DAN apa perlu eskalasi pintu
  if (isFirstCommit) {
    const ok = await S.showConfirmModal({
      title: 'Mulai Konversi Baru?',
      text: 'Produk ini bakal masuk ke sesi konversi baru. Kalau cuma mau cari info produk (harga/link/gambar) buat dikirim ke pelanggan, gak perlu ini — tombol Copy di kartu udah cukup.',
      okText: 'Ya, Mulai Konversi'
    });
    if (!ok) return;
  }
  addToClip(kode);
  // Cuma pindah pintu pas KOMIT PERTAMA (baru mulai sesi) — kalau sesi udah
  // jalan dan orang lagi nambahin produk lagi dari Cari Cepat, biarin tetep di
  // situ (mungkin lagi nyari beberapa produk sekaligus sebelum balik ke Konversi).
  if (isFirstCommit && typeof S.switchDoor === 'function') S.switchDoor('konversi');
}

function addToClip(kode) {
  const r = S.lastResults.find(x => x.kode_produk === kode);
  if (!r) return;
  if (S.clipboard.some(c => c.kode_produk === r.kode_produk)) { removeFromClip(r.kode_produk); return; }
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
  updateClipboard();
  renderResults(S.lastResults);
  persistAddItem(newItem); // simpan ke sesi (async, gak nunggu biar UI tetep responsif)
}
S.addToClip = addToClip;
function removeFromClip(kode) {
  const removed = S.clipboard.find(c => c.kode_produk === kode);
  S.clipboard = S.clipboard.filter(c => c.kode_produk !== kode);
  updateClipboard();
  renderResults(S.lastResults);
  if (removed) persistRemoveItem(removed);
}
function updateClipAggregates() {
  if (S.checklistPermintaanId && S.checklistItems.length) S.refreshRollupHeadersOnly();
  const n = S.clipboard.length;
  S.hdrCount.textContent = n;
  S.clipTotal.textContent = n;
  S.btnExport.disabled = n === 0;
  S.btnRecord.disabled = n === 0;
  S.clipEmpty.style.display = n === 0 ? 'block' : 'none';
  const tabBadge = document.getElementById('tab-badge');
  if (tabBadge) { tabBadge.textContent = n; tabBadge.style.display = n > 0 ? 'inline-block' : 'none'; }
  S.clipTabBadgeList.textContent = n;
  S.clipTabBadgeList.style.display = n > 0 ? 'inline-block' : 'none';

  // Total harga clipboard + bandingin sama Pagu (kalau ada sesi Kebutuhan RS aktif)
  let totalHargaClip = 0;
  let adaHargaKosong = false;
  S.clipboard.forEach(item => {
    const h = S.modeSwastaOutput ? item.harga_swasta : item.harga_ekat;
    if (h) totalHargaClip += h * item.qty;
    else adaHargaKosong = true;
  });
  if (n === 0) {
    S.clipTotalHarga.textContent = '';
  } else {
    S.clipTotalHarga.textContent = rupiah(totalHargaClip) + (adaHargaKosong ? ' +' : '');
  }
  updateClipSummaryStrip();
  if (typeof S.updateSetcariSourceCount === 'function') S.updateSetcariSourceCount();
  if (n > 0 && typeof S.checklistPagu !== 'undefined' && S.checklistPagu != null) {
    const sisa = S.checklistPagu - totalHargaClip;
    S.clipBudget.classList.add('show');
    if (sisa >= 0) {
      S.clipBudget.classList.remove('over');
      S.clipBudget.classList.add('under');
      S.clipBudget.innerHTML = `<span>Sisa pagu</span><b>${rupiah(sisa)}</b>`;
    } else {
      S.clipBudget.classList.remove('under');
      S.clipBudget.classList.add('over');
      S.clipBudget.innerHTML = `<span>Lebih dari pagu</span><b>${rupiah(Math.abs(sisa))}</b>`;
    }
  } else {
    S.clipBudget.classList.remove('show');
  }
}
S.updateClipAggregates = updateClipAggregates;

// Template satu baris clipboard — dipakai render awal (updateClipboard) MAUPUN
// patch realtime (insertClipItem/patchClipItem), biar markup-nya gak dobel definisi.
function renderClipItemHtml(item) {
  const isSet = item.is_set;
  const tipeColor = isSet ? 'background:var(--success-bg);color:var(--success)' : 'background:var(--accent-bg);color:var(--accent-text)';
  const hargaTampil = S.modeSwastaOutput ? item.harga_swasta : item.harga_ekat;
  const totalHarga = hargaTampil ? hargaTampil * item.qty : null;
  // SECURITY FIX 2026-08-14: nama_produk ditampilin mentah — escape jaga-jaga
  // (produk-produk ini biasa dari katalog terkontrol, tapi tetap defense in
  // depth kalau ada nama produk yang mengandung karakter HTML).
  return `<div class="clip-item" data-kode="${item.kode_produk}">
      <div class="clip-item-info">
        <div class="clip-item-name">${S.escapeHtmlAttr(item.nama_produk)}</div>
        <div class="clip-item-meta">
          <span class="clip-item-code">${item.kode_produk}</span>
          <span class="clip-item-tipe" style="${tipeColor}">${item.tipe||'—'}</span>
          ${hargaTampil?`<span class="clip-item-harga">${rupiah(totalHarga)}</span>`:'<span class="clip-item-code" style="color:var(--text-muted)">Harga N/A</span>'}
        </div>
      </div>
      <div class="clip-item-right">
        <div class="qty-ctrl">
          <button class="qty-btn" data-kode="${item.kode_produk}" data-d="-1" title="Kurangi qty" aria-label="Kurangi qty">−</button>
          <input
            class="qty-input"
            type="number"
            min="1"
            step="1"
            inputmode="numeric"
            value="${item.qty}"
            data-kode="${item.kode_produk}"
            aria-label="Jumlah qty"
          />
          <button class="qty-btn" data-kode="${item.kode_produk}" data-d="1" title="Tambah qty" aria-label="Tambah qty">+</button>
          <button class="clip-remove" data-kode="${item.kode_produk}" title="Hapus dari clipboard" aria-label="Hapus dari clipboard">×</button>
        </div>
      </div>
    </div>`;
}

// Pasang event listener buat satu subtree (satu node .clip-item ATAU seluruh
// clipList) — dipisah dari render biar bisa dipanggil ulang cuma buat node yang
// baru di-insert/di-patch, bukan query-ulang seluruh daftar tiap kali.
function bindClipItemEvents(scopeEl) {
  scopeEl.querySelectorAll('.clip-remove').forEach(btn => {
    btn.addEventListener('click', () => removeFromClip(btn.dataset.kode));
  });
  scopeEl.querySelectorAll('.qty-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = S.clipboard.find(c => c.kode_produk === btn.dataset.kode);
      if (!item) return;
      item.qty = Math.max(1, item.qty + parseInt(btn.dataset.d));
      if (item._sesiItemId) S.markLocalWrite(SESI_ITEM_TABLE, item._sesiItemId, 'qty', item.qty);
      patchClipItem(item.kode_produk, { qty: item.qty });
      persistUpdateQty(item);
    });
  });
  // FIX: handler untuk input qty yang diketik manual
  scopeEl.querySelectorAll('.qty-input').forEach(input => {
    // update saat user selesai ngetik (blur) atau tekan Enter
    const commit = () => {
      const item = S.clipboard.find(c => c.kode_produk === input.dataset.kode);
      if (!item) return;
      let val = parseInt(input.value, 10);
      if (isNaN(val) || val < 1) val = 1;
      item.qty = val;
      if (item._sesiItemId) S.markLocalWrite(SESI_ITEM_TABLE, item._sesiItemId, 'qty', item.qty);
      patchClipItem(item.kode_produk, { qty: item.qty });
      persistUpdateQty(item);
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    });
    // supaya klik di input tidak ikut trigger event lain di parent (kalau ada)
    input.addEventListener('click', (e) => e.stopPropagation());
  });
}

function updateClipboard() {
  updateClipAggregates();
  S.clipList.innerHTML = S.clipboard.map(renderClipItemHtml).join('');
  bindClipItemEvents(S.clipList);
}
S.updateClipboard = updateClipboard;

// ---- Patch granular (dipakai realtime DAN aksi lokal qty +/-/ketik) ----
// Bedanya sama updateClipboard(): ini cuma nyentuh SATU baris + angka agregat,
// gak nge-rebuild innerHTML seluruh daftar — biar baris lain gak ikut kedip
// dan scroll position/fokus input orang lain gak keganggu.
function patchClipItem(kode, changes) {
  const item = S.clipboard.find(c => c.kode_produk === kode);
  if (!item) return;
  Object.assign(item, changes);
  const node = S.clipList.querySelector(`.clip-item[data-kode="${CSS.escape(kode)}"]`);
  if (node) {
    const temp = document.createElement('div');
    temp.innerHTML = renderClipItemHtml(item);
    const newNode = temp.firstElementChild;
    newNode.classList.add('rt-pulse');
    node.replaceWith(newNode);
    bindClipItemEvents(newNode);
  }
  updateClipAggregates();
}
S.patchClipItem = patchClipItem;

function insertClipItem(item) {
  if (S.clipboard.some(c => c.kode_produk === item.kode_produk)) { patchClipItem(item.kode_produk, item); return; }
  S.clipboard.push(item);
  const temp = document.createElement('div');
  temp.innerHTML = renderClipItemHtml(item);
  const newNode = temp.firstElementChild;
  newNode.classList.add('rt-fade-in');
  S.clipList.prepend(newNode); // item baru dari kolaborator muncul paling atas, biar kelihatan
  bindClipItemEvents(newNode);
  updateClipAggregates();
}
S.insertClipItem = insertClipItem;

function removeClipItemDom(kode) {
  const idx = S.clipboard.findIndex(c => c.kode_produk === kode);
  if (idx === -1) return;
  S.clipboard.splice(idx, 1);
  const node = S.clipList.querySelector(`.clip-item[data-kode="${CSS.escape(kode)}"]`);
  if (node) {
    node.classList.add('rt-removing');
    setTimeout(() => node.remove(), 260);
  }
  updateClipAggregates();
}
S.removeClipItemDom = removeClipItemDom;

// Mapping baris sesi_konversi_item (REST maupun payload postgres_changes, bentuknya
// sama) → shape objek clipboard lokal. Satu titik doang, dipakai openSesi() DAN
// handleItemRowChange() — biar gak ada 2 tempat yang bisa beda kalau kolomnya nambah.
function mapSesiItemRowToClipItem(it) {
  return {
    kode_produk: it.kode_produk, kode_asli: it.kode_asli, nama_produk: it.nama_produk,
    tipe: it.tipe, is_set: it.is_set, produk_id: it.produk_id, no_akd: it.no_akd,
    kode_kfa: it.kode_kfa, link_v6: it.link_v6, harga_ekat: it.harga_ekat, tahun_harga: it.tahun_harga,
    harga_swasta: it.harga_swasta, tahun_harga_swasta: it.tahun_harga_swasta,
    stok_status: it.stok_status, stok_qty: it.stok_qty, qty: it.qty, _sesiItemId: it.id
  };
}
S.mapSesiItemRowToClipItem = mapSesiItemRowToClipItem;

// PROGRESS
function setProgress(current, total, label) {
  const pct = total > 0 ? Math.round((current/total)*100) : 0;
  progressFill.style.width = pct + '%';
  progressLabel.textContent = `${current} / ${total}`;
  if (label) modalSub.textContent = label;
}

// GET SET ITEMS
async function getSetItems(kode_produk) {
  const r1 = await sesiFetch(`produk?kode_produk=eq.${encodeURIComponent(kode_produk)}&select=id&limit=1`);
  const prodList = await r1.json();
  if (!prodList || !prodList.length) return [];
  const set_id = prodList[0].id;

  const r2 = await sesiFetch(`rpc/get_set_items`, {
    method: 'POST',
    body: JSON.stringify({p_set_id: set_id})
  });
  const data = await r2.json();
  return data || [];
}
S.getSetItems = getSetItems;

// ── SIMPAN KE DRIVE (manual, lewat tombol — bukan otomatis pas Export) ──
// Export ke Excel cuma nyiapin file + download lokal seperti biasa. Blob hasil
// export terakhir disimpan di sini, biar tombol "Simpan ke Drive" (terpisah,
// diklik kapan aja setelah export) bisa reupload tanpa nge-generate ulang file.
S.lastExportBlob = null;
S.lastExportFilename = null;
S.lastExportNamaSales = null;
// Link Drive terakhir yang beneran didapat dari upload sukses (result.fileUrl),
// buat auto-fill #rec-link pas modal Record dibuka — sebelumnya link ini cuma
// nyampe ke modal sukses convFlow (visual doang), gak pernah ditulis balik ke
// field record-nya, jadi openRecordModal() nge-reset ke kosong lagi. Direset
// balik ke null di resetChecklistUI() tiap kali sesi ganti/dibuka ulang.
S.lastDriveUrl = null;
const btnDriveUpload = document.getElementById('btn-drive-upload');
S.btnDriveUpload = btnDriveUpload;

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function uploadKonversianToDrive(blob, fileName, tahun, namaSalesForFolder) {
  try {
    const fileBase64 = await blobToBase64(blob);
    // Lewat Edge Function sekarang (server-to-server ke Apps Script), jadi
    // gak ada masalah preflight CORS yang dulu diakalin pakai text/plain —
    // Authorization di sini pakai token SESI USER (buat verifikasi di Edge
    // Function), BUKAN token rahasia Drive lagi.
    const uploadToken = await S.getFreshToken();
    if (!uploadToken || uploadToken === S.ANON_KEY) throw new Error('Sesi login sudah habis / belum login — silakan login ulang dulu.');
    const res = await fetch(S.DRIVE_PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + uploadToken
      },
      body: JSON.stringify({
        jenis: 'konversian',
        tahun: String(tahun),
        namaSales: namaSalesForFolder,
        fileName,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        fileBase64
      })
    });
    const result = await res.json();
    if (!result.success) throw new Error(result.error || 'Upload gagal');
    showToast(`Tersimpan ke Drive ✓ (KONVERSI ${tahun} / ${namaSalesForFolder})`, 'success');
    // Apps Script-nya udah balikin fileUrl (link file yang baru diupload) dan
    // folderPath (path Drive yang BENERAN dipakai, termasuk penyesuaian nama
    // folder kalau ternyata udah ada sebelumnya lewat findOrCreateFolder yang
    // case-insensitive) — pakai itu, bukan tebak-tebak lagi.
    // Simpan & langsung isi #rec-link juga di sini — INI titik yang beneran
    // tau linknya, jangan nunggu openRecordModal() atau poll DOM convFlow yang
    // cuma best-effort. lastDriveUrl dipakai openRecordModal() biar gak
    // ke-reset ke kosong pas modal Record dibuka setelahnya.
    if (result.fileUrl) {
      S.lastDriveUrl = result.fileUrl;
      if (S.recLink) S.recLink.value = result.fileUrl;
    }
    if (window.convFlow) {
      window.convFlow.showSuccess('drive', {
        driveUrl: result.fileUrl,
        locationPath: result.folderPath || `${tahun} / ${namaSalesForFolder}`,
        subtitle: `File sudah ada di folder Drive ${result.folderPath || (tahun + ' / ' + namaSalesForFolder)}.`
      });
    }
  } catch (e) {
    showToast('Gagal simpan ke Drive: ' + e.message, 'error');
    if (window.convFlow) window.convFlow.showError('drive', e.message);
  }
}

if (btnDriveUpload) {
  btnDriveUpload.addEventListener('click', async () => {
    if (!S.lastExportBlob) {
      const msg = 'Belum ada file yang di-export di sesi ini. Export ke Excel dulu ya.';
      showToast(msg, 'error');
      // setTimeout 0: modal progress (kalau lagi kebuka) baru masuk state loading
      // SETELAH listener ini selesai (lihat resetToLoading('drive') di
      // konversian.html, listener terpisah di tombol yang sama) — nunda
      // sedikit biar showError ini gak ketimpa balik jadi loading.
      if (window.convFlow) setTimeout(() => window.convFlow.showError('drive', msg), 0);
      return;
    }
    // Dicek FRESH di sini (bukan pas Export), karena tombol ini biasa diklik
    // beberapa saat setelah sesi dibuka/export — checklistTanggal lebih besar
    // kemungkinan udah keisi dibanding ngecek pas tombol Export baru diklik.
    if (!S.checklistPermintaanId || !S.checklistTanggal) {
      const msg = 'Sesi ini belum ada Permintaan RS (atau tanggalnya belum tercatat) — isi Permintaan RS dulu, baru bisa simpan ke Drive.';
      showToast(msg, 'error');
      if (window.convFlow) setTimeout(() => window.convFlow.showError('drive', msg), 0);
      return;
    }
    const tahunFolder = new Date(S.checklistTanggal).getFullYear();
    btnDriveUpload.disabled = true;
    try {
      await uploadKonversianToDrive(S.lastExportBlob, S.lastExportFilename, tahunFolder, S.lastExportNamaSales);
    } finally {
      btnDriveUpload.disabled = false;
    }
  });
}

// EXPORT EXCEL
S.btnExport.addEventListener('click', async () => {
  const namaRs = S.inpRs.value.trim() || 'RS';
  const namaSales = S.inpSales.value.trim() || 'Sales';
  const tanggal = new Date().toLocaleDateString('id-ID', {day:'2-digit', month:'long', year:'numeric'});

  // Sesi ini udah pernah di-Record sebelumnya? Kalau iya, file export dikasih
  // suffix -REV{n} ngikutin nomor revisi yang BAKAL kepake kalau kamu Record
  // sekarang (revisi terakhir + 1) — bukan revisi lama yang udah tersimpan.
  // Ini disamain sama cara Record ngitung nomornya, biar nama file yang kamu
  // export duluan (sebelum sempet Record) tetep konsisten sama yang bakal
  // kesimpen nanti, bukan ketinggalan satu angka.
  let revSuffix = '';
  if (S.currentSesiId) {
    try {
      const revRes = await sesiFetch(`konversi_record?sesi_id=eq.${S.currentSesiId}&select=revisi&order=revisi.desc&limit=1`);
      if (revRes.ok) {
        const revRows = await revRes.json();
        if (revRows.length) {
          const revisiBerikutnya = (revRows[0].revisi || 0) + 1;
          revSuffix = `-REV${revisiBerikutnya}`;
        }
      }
    } catch { /* gagal cek revisi → export tetap jalan tanpa suffix, bukan blocking */ }
  }

  const filename = `CONVERTED${S.modeSwastaOutput?'-SWASTA':''}-${namaSales.replace(/[^a-zA-Z0-9 ]/g,'').trim()}-${namaRs.replace(/[^a-zA-Z0-9 ]/g,'').trim()}-${tanggal}${revSuffix}.xlsx`;

  S.exportModal.classList.add('show');
  setProgress(0, 1, 'Menyiapkan data…');

  try {
    await S.ensureExceljs(); // lazy: ExcelJS baru didownload di sini, pas export beneran dipencet
    const wb = new ExcelJS.Workbook();
    wb.creator = 'PT Pionir Nusantara Manufacturing';
    wb.created = new Date();

    // ── COLLECT ALL ITEMS NEEDED FOR IMAGE FETCH ──
    const sets = S.clipboard.filter(i => i.is_set);
    const satuans = S.clipboard.filter(i => !i.is_set && i.tipe !== 'UNIT');

    // fetch set items
    setProgress(0, sets.length + 1, 'Mengambil rincian set…');
    const setItemsMap = {};
    for (let s = 0; s < sets.length; s++) {
      const items = await getSetItems(sets[s].kode_produk);
      setItemsMap[sets[s].kode_produk] = items;
      setProgress(s+1, sets.length + 1, `Mengambil rincian: ${sets[s].nama_produk}`);
    }

    // collect all items needing images (keep kode_produk as map key, kode_asli for URL)
    const allKodesMap = new Map(); // kode_produk -> kode_asli
    S.clipboard.forEach(item => {
      if (!item.is_set && item.tipe !== 'UNIT') allKodesMap.set(item.kode_produk, item.kode_asli);
      else if (setItemsMap[item.kode_produk]) {
        setItemsMap[item.kode_produk].forEach(si => allKodesMap.set(si.kode_produk, si.kode_asli));
      }
    });
    const kodesArr = [...allKodesMap.keys()];

    // fetch all images (using kode_asli for the URL, fallback to kode_produk)
    const imgMap = {};
    setProgress(0, kodesArr.length, 'Mengambil thumbnail gambar…');
    const results = await Promise.all(kodesArr.map(k => fetchImageBase64(allKodesMap.get(k), k)));
    await Promise.all(kodesArr.map(async (k, i) => {
  if (results[i]) imgMap[k] = await removeBackground(results[i]);
  }));
    setProgress(kodesArr.length, kodesArr.length, 'Gambar selesai…');

    setProgress(kodesArr.length, kodesArr.length, 'Membuat file Excel…');

    // ── HELPER: ADD IMAGE TO SHEET ──
    // wb.addImage() menyimpan bytes gambar baru ke paket xlsx SETIAP kali dipanggil,
    // bahkan kalau base64-nya sama persis. Karena banyak produk yang sama muncul
    // berulang lintas set/lampiran, ini yang bikin file bengkak drastis saat "banyak
    // set". Fix: cache imgId per kode_produk, panggil wb.addImage cuma sekali per kode.
    const imgIdCache = {};
    // Border tipis 4-sisi, dipakai di SEMUA sheet (header & data) biar hasilnya
    // kelihatan sebagai tabel yang jelas grid-nya — warna item gelap standar
    // (bukan abu-abu pucat) biar kelihatan kayak "All borders" manual di Google
    // Sheets/Excel, bukan garis samar yang nyaris nyatu sama background putih.
    const GRID_BORDER = {
      top: {style:'thin', color:{argb:'FF000000'}},
      left: {style:'thin', color:{argb:'FF000000'}},
      bottom: {style:'thin', color:{argb:'FF000000'}},
      right: {style:'thin', color:{argb:'FF000000'}}
    };
    function addImg(ws, b64, row, col, w=80, h=80, cacheKey=null) {
      if (!b64) return;
      try {
        let imgId;
        if (cacheKey && imgIdCache[cacheKey] !== undefined) {
          imgId = imgIdCache[cacheKey];
        } else {
          imgId = wb.addImage({ base64: b64, extension: 'png' });
          if (cacheKey) imgIdCache[cacheKey] = imgId;
        }
        ws.addImage(imgId, {
          tl: { col: col - 0.9, row: row - 0.9 },
          ext: { width: w, height: h }
        });
      } catch(e) {}
    }

    // ── SHEET 1: SUMMARY ──
    const wsSummary = wb.addWorksheet('SUMMARY');
    // header info
    wsSummary.getRow(1).getCell(1).value = 'DOKUMEN KONVERSI INSTRUMEN';
    wsSummary.getRow(1).getCell(1).font = {bold:true, size:13};
    wsSummary.getRow(2).getCell(1).value = 'PT Pionir Nusantara Manufacturing';
    wsSummary.getRow(2).getCell(1).font = {italic:true, color:{argb:'FF4B5563'}};
    wsSummary.getRow(3).getCell(1).value = 'RS / Instansi'; wsSummary.getRow(3).getCell(2).value = namaRs;
    wsSummary.getRow(4).getCell(1).value = 'Nama Sales';    wsSummary.getRow(4).getCell(2).value = namaSales;
    wsSummary.getRow(5).getCell(1).value = 'Tanggal';       wsSummary.getRow(5).getCell(2).value = tanggal;
    wsSummary.getRow(6).getCell(1).value = '';

    // column headers (dinamis sesuai mode)
    const sumHdrRow = wsSummary.getRow(7);
    const sumHeaders = S.modeSwastaOutput
      ? ['No.','Kode Produk','Nama Produk / Deskripsi','QTY','Harga Swasta','Total Harga','Status Stok']
      : ['No.','Kode Produk','Nama Produk / Deskripsi','QTY','Harga e-Kat','Total Harga','Link e-Katalog v6','Status Stok'];
    sumHeaders.forEach((h,i) => {
      const cell = sumHdrRow.getCell(i+1);
      cell.value = h;
      cell.font = {bold:true, color:{argb:'FFFFFFFF'}};
      cell.fill = {type:'pattern', pattern:'solid', fgColor:{argb:'FF1D5BD4'}};
      cell.alignment = {vertical:'middle', horizontal:'center'};
      cell.border = GRID_BORDER;
    });
    sumHdrRow.height = 22;
    wsSummary.columns = S.modeSwastaOutput
      ? [{width:5},{width:24},{width:50},{width:8},{width:18},{width:18},{width:14}]
      : [{width:5},{width:24},{width:50},{width:8},{width:18},{width:18},{width:45},{width:14}];

    let sumRow = 8;
    let grandTotal = 0;
    const stokColIdx = S.modeSwastaOutput ? 7 : 8;
    S.clipboard.forEach((item, idx) => {
      const row = wsSummary.getRow(sumRow);
      const hargaPakai = S.modeSwastaOutput ? (item.harga_swasta || 0) : (item.harga_ekat || 0);
      const total = hargaPakai * (item.qty || 1);
      grandTotal += total;
      row.getCell(1).value = idx + 1;
      row.getCell(2).value = item.kode_produk;
      row.getCell(3).value = item.nama_produk;
      row.getCell(4).value = item.qty || 1;
      row.getCell(5).value = hargaPakai || '';
      row.getCell(6).value = total || '';
      if (!S.modeSwastaOutput && item.link_v6) {
        row.getCell(7).value = {text:'Lihat di e-Katalog', hyperlink: item.link_v6};
        row.getCell(7).font = {color:{argb:'FF1D4ED8'}, underline:true};
      }
      const stokLabel = item.stok_status === 'READY' ? 'Ready'
        : item.stok_status === 'INDENT' ? 'Indent'
        : item.stok_status === 'DATA_TIDAK_LENGKAP' ? 'Data blm lengkap'
        : '-';
      row.getCell(stokColIdx).value = stokLabel;
      row.getCell(stokColIdx).alignment = {horizontal:'center', vertical:'middle'};
      if (stokLabel === 'Ready') row.getCell(stokColIdx).font = {color:{argb:'FF15803D'}, bold:true};
      else if (stokLabel === 'Indent') row.getCell(stokColIdx).font = {color:{argb:'FFB91C1C'}, bold:true};
      else if (stokLabel === 'Data blm lengkap') row.getCell(stokColIdx).font = {color:{argb:'FFB45309'}, bold:true};
      // zebra + border + center alignment buat semua kolom di baris ini
      const zebraCount = S.modeSwastaOutput ? 7 : 8;
      Array.from({length: zebraCount}, (_,c)=>c+1).forEach(c => {
        row.getCell(c).border = GRID_BORDER;
        if (c !== stokColIdx) row.getCell(c).alignment = {vertical:'middle', horizontal:'center', wrapText: c===3};
        if (idx % 2 === 0) row.getCell(c).fill = {type:'pattern',pattern:'solid',fgColor:{argb:'FFF5F6F8'}};
      });
      sumRow++;
    });

    // total row
    const totRow = wsSummary.getRow(sumRow);
    totRow.getCell(3).value = 'GRAND TOTAL';
    totRow.getCell(3).font = {bold:true};
    totRow.getCell(6).value = grandTotal;
    totRow.getCell(6).font = {bold:true};
    totRow.getCell(6).numFmt = '#,##0';
    {
      const totCols = S.modeSwastaOutput ? 7 : 8;
      for (let c = 1; c <= totCols; c++) totRow.getCell(c).border = GRID_BORDER;
    }

    // format harga cols
    for (let r = 8; r <= sumRow; r++) {
      wsSummary.getRow(r).getCell(5).numFmt = '#,##0';
      wsSummary.getRow(r).getCell(6).numFmt = '#,##0';
    }

    // ── SHEETS: KEBUTUHAN RS, 1 sheet per Section (kalau section udah dipakai) ──
    // Section = tab di UI = sheet di Excel, 1:1 — ini yang sebelumnya BOLONG:
    // export lama selalu bikin 1 sheet flat "KEBUTUHAN RS" gak peduli item-nya
    // udah dipindah ke section mana pun di UI. Sekarang tiap section jadi
    // sheet sendiri (nama sheet = nama section), pagu-nya ambil dari
    // section.pagu (bukan checklistPagu global lagi). Kalau belum ada section
    // sama sekali, fallback ke 1 sheet "KEBUTUHAN RS" flat kayak sebelumnya —
    // gak ada regresi buat Permintaan RS yang emang belum dipecah section.
    if (S.checklistItems.length > 0) {
      const usedSheetNames = new Set(wb.worksheets.map(w => w.name));
      // Excel: nama sheet max 31 char, gak boleh \ / ? * [ ] : , dan harus unik.
      function safeSheetName(base) {
        const cleaned = String(base).replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Section';
        let candidate = cleaned, n = 2;
        while (usedSheetNames.has(candidate)) {
          const suffix = ` (${n++})`;
          candidate = cleaned.slice(0, 31 - suffix.length) + suffix;
        }
        usedSheetNames.add(candidate);
        return candidate;
      }

      function writeKebutuhanSheet(wsTitle, items, sectionPagu) {
        const wsKb = wb.addWorksheet(safeSheetName(wsTitle));
        // 2026-09-14: preamble (judul/PT/RS/Sales/Pagu/baris kosong) DICABUT —
        // tabelnya langsung mulai row 1, gak ada basa-basi. Pagu per section
        // masih ada, cuma sekarang dikelola/dilihat dari UI (tab section di
        // Kebutuhan RS), bukan diduplikasi ke tiap sheet export. SUMMARY tetap
        // jadi satu-satunya sheet rollup lintas section. Status diganti Link
        // (klik langsung ke e-katalog), plus kolom Gambar (thumbnail nempel,
        // reuse imgMap yang udah di-fetch buat sheet komposisi SET di bawah).
        //
        // Kolom Link cuma relevan di mode e-Katalog (link_v6 emang gak ada
        // sama sekali di mode Swasta — sama kayak SUMMARY yang udah lebih
        // dulu nyembunyiin kolom ini). Dulu header "Link" tetap muncul di
        // sheet ini walau modeSwastaOutput true, jadinya kolom kosong
        // nganggur — sekarang headernya dibikin dinamis kayak sumHeaders,
        // dan index kolom Gambar ikut geser (8 kalau gak ada Link, 9 kalau ada).
        const colGambar = S.modeSwastaOutput ? 8 : 9;
        const colLink = S.modeSwastaOutput ? null : 8;
        const kbHeaders = S.modeSwastaOutput
          ? ['No.','Item Diminta','Qty Diminta','Kode Produk','Deskripsi','Harga','Total','Gambar']
          : ['No.','Item Diminta','Qty Diminta','Kode Produk','Deskripsi','Harga','Total','Link','Gambar'];
        const kbHdrRow = wsKb.getRow(1);
        kbHeaders.forEach((h,i) => {
          const cell = kbHdrRow.getCell(i+1);
          cell.value = h;
          cell.font = {bold:true, color:{argb:'FFFFFFFF'}};
          cell.fill = {type:'pattern', pattern:'solid', fgColor:{argb:'FF1D5BD4'}};
          cell.alignment = {vertical:'middle', horizontal:'center'};
          cell.border = GRID_BORDER;
        });
        kbHdrRow.height = 22;
        wsKb.columns = S.modeSwastaOutput
          ? [{width:5},{width:36},{width:12},{width:22},{width:36},{width:16},{width:16},{width:14}]
          : [{width:5},{width:36},{width:12},{width:22},{width:36},{width:16},{width:16},{width:16},{width:14}];

        let kbRow = 2;
        let kbGrandTotal = 0;
        items.forEach((item, idx) => {
          // Satu kebutuhan bisa kesambung ke lebih dari 1 SKU (bundle). Dulu
          // kode/nama-nya digabung "; " jadi satu baris/cell — sekarang tiap
          // produk yang match dapet barisnya sendiri (kolom Kode/Deskripsi/
          // Harga/Total/Link/Gambar per baris), sementara No/Item Diminta/Qty
          // Diminta cuma ditulis SEKALI di baris pertama grup lalu di-merge
          // vertikal ke bawah — kebutuhan tetap satu, item-nya yang berbaris.
          const matchedList = (item.matched_items || [])
            .map(l => S.clipboard.find(c => c.kode_produk === l.kode_produk))
            .filter(Boolean);
          const rowCount = Math.max(matchedList.length, 1);
          const startRow = kbRow;
          let itemTotal = 0;

          if (matchedList.length === 0) {
            // Belum ada produk yang match — satu baris kosong kayak sebelumnya.
            const row = wsKb.getRow(kbRow);
            row.height = 56;
            row.getCell(1).value = idx + 1;
            row.getCell(2).value = item.raw_text;
            row.getCell(3).value = item.qty_diminta || '';
            for (let c = 1; c <= colGambar; c++) {
              row.getCell(c).border = GRID_BORDER;
              row.getCell(c).alignment = {vertical:'middle', horizontal:'center', wrapText: c===2||c===5};
              if (idx % 2 === 0) row.getCell(c).fill = {type:'pattern',pattern:'solid',fgColor:{argb:'FFF5F6F8'}};
            }
            kbRow++;
          } else {
            matchedList.forEach((m, mIdx) => {
              const row = wsKb.getRow(kbRow);
              row.height = 56;
              if (mIdx === 0) {
                row.getCell(1).value = idx + 1;
                row.getCell(2).value = item.raw_text;
                row.getCell(3).value = item.qty_diminta || '';
              }
              const link = (item.matched_items || []).find(l => l.kode_produk === m.kode_produk);
              const hargaSatuan = S.modeSwastaOutput ? (m.harga_swasta || 0) : (m.harga_ekat || 0);
              const qty = (link && link.qty_alokasi != null) ? link.qty_alokasi : (item.qty_diminta || 1);
              const totalBaris = hargaSatuan * qty;
              itemTotal += totalBaris;

              row.getCell(4).value = m.kode_produk;
              row.getCell(5).value = m.nama_produk;
              row.getCell(6).value = hargaSatuan;
              row.getCell(7).value = totalBaris;
              if (colLink && m.link_v6) {
                row.getCell(colLink).value = {text:'Lihat di e-Katalog', hyperlink: m.link_v6};
                row.getCell(colLink).font = {color:{argb:'FF1D4ED8'}, underline:true};
              }
              addImg(wsKb, imgMap[m.kode_produk], kbRow, colGambar, 80, 65, m.kode_produk);

              for (let c = 1; c <= colGambar; c++) {
                row.getCell(c).border = GRID_BORDER;
                row.getCell(c).alignment = {vertical:'middle', horizontal:'center', wrapText: c===2||c===5};
                if (idx % 2 === 0) row.getCell(c).fill = {type:'pattern',pattern:'solid',fgColor:{argb:'FFF5F6F8'}};
              }
              kbRow++;
            });
            kbGrandTotal += itemTotal;

            if (rowCount > 1) {
              const endRow = kbRow - 1;
              [1,2,3].forEach(c => {
                wsKb.mergeCells(startRow, c, endRow, c);
                wsKb.getCell(startRow, c).alignment = {vertical:'middle', horizontal:'center', wrapText: c===2};
                wsKb.getCell(startRow, c).border = GRID_BORDER;
              });
            }
          }
        });

        const kbTotRow = wsKb.getRow(kbRow);
        kbTotRow.getCell(5).value = 'TOTAL TERPENUHI';
        kbTotRow.getCell(5).font = {bold:true};
        kbTotRow.getCell(7).value = kbGrandTotal;
        kbTotRow.getCell(7).font = {bold:true};
        kbTotRow.getCell(7).numFmt = '#,##0';
        for (let c = 1; c <= colGambar; c++) kbTotRow.getCell(c).border = GRID_BORDER;
        kbRow++;

        const doneCount = items.filter(i => i.status === 'TERPENUHI').length;
        const totalCount = items.length;
        const pct = totalCount > 0 ? Math.round((doneCount/totalCount)*1000)/10 : 0;
        const kbRekapRow = wsKb.getRow(kbRow);
        kbRekapRow.getCell(2).value = `Tingkat pemenuhan: ${pct}% (${doneCount}/${totalCount} item)`;
        kbRekapRow.getCell(2).font = {italic:true, color:{argb:'FF4B5563'}};

        for (let r = 2; r < kbRow - 1; r++) {
          wsKb.getRow(r).getCell(6).numFmt = '#,##0';
          wsKb.getRow(r).getCell(7).numFmt = '#,##0';
        }
      }

      if (S.checklistSections.length) {
        const bySection = new Map(S.checklistSections.map(s => [s.id, []]));
        bySection.set(null, []);
        S.checklistItems.forEach(it => {
          const key = bySection.has(it.section_id) ? it.section_id : null;
          bySection.get(key).push(it);
        });
        S.checklistSections.forEach(s => {
          const items = bySection.get(s.id);
          if (items.length) writeKebutuhanSheet(s.nama_section, items, s.pagu != null ? s.pagu : null);
        });
        const orphanItems = bySection.get(null);
        if (orphanItems.length) writeKebutuhanSheet('Tanpa Section', orphanItems, null);
      } else {
        writeKebutuhanSheet('KEBUTUHAN RS', S.checklistItems, S.checklistPagu);
      }
    }

    // ── SHEETS PER SET ──
    for (const setItem of sets) {
      const items = setItemsMap[setItem.kode_produk] || [];
      const sheetName = setItem.nama_produk.replace(/[\\\/\?\*\[\]:]/g,'').substring(0,31);
      const ws = wb.addWorksheet(sheetName);

      // header
      ws.getRow(1).getCell(1).value = setItem.nama_produk;
      ws.getRow(1).getCell(1).font = {bold:true, size:13, color:{argb:'FF1D5BD4'}};
      ws.getRow(1).getCell(1).fill = {type:'pattern',pattern:'solid',fgColor:{argb:'FFEFF4FF'}};
      ws.mergeCells('A1:E1');
      ws.getRow(1).height = 30;

      ws.getRow(2).getCell(1).value = 'PT Pionir Nusantara Manufacturing';
      ws.getRow(2).getCell(1).font = {italic:true, size:10, color:{argb:'FF4B5563'}};
      ws.mergeCells('A2:E2');

      ws.getRow(3).getCell(1).value = '';

      const hdrRow = ws.getRow(4);
      ['NO','KODE PNM','DESKRIPSI BARANG','QTY','GAMBAR'].forEach((h, i) => {
        const cell = hdrRow.getCell(i+1);
        cell.value = h;
        cell.font = {bold:true, color:{argb:'FFFFFFFF'}};
        cell.fill = {type:'pattern',pattern:'solid',fgColor:{argb:'FF1D5BD4'}};
        cell.alignment = {vertical:'middle', horizontal:'center'};
        cell.border = GRID_BORDER;
      });
      hdrRow.height = 22;

      ws.columns = [{width:6},{width:24},{width:45},{width:8},{width:18}];

      for (let idx = 0; idx < items.length; idx++) {
        const si = items[idx];
        const dataRow = 5 + idx;
        const row = ws.getRow(dataRow);
        row.height = 70;
        row.getCell(1).value = si.urutan || idx+1;
        row.getCell(2).value = si.kode_produk;
        row.getCell(3).value = si.nama_produk;
        row.getCell(4).value = si.qty;
        [1,2,3,4,5].forEach(c => {
          row.getCell(c).alignment = {vertical:'middle', horizontal:'center', wrapText:true};
          row.getCell(c).border = GRID_BORDER;
          if (idx % 2 === 0) row.getCell(c).fill = {type:'pattern',pattern:'solid',fgColor:{argb:'FFF5F6F8'}};
        });
        addImg(ws, imgMap[si.kode_produk], dataRow, 5, 80, 65, si.kode_produk);
      }

      // total
      const totalRow = ws.getRow(5 + items.length);
      totalRow.getCell(3).value = 'TOTAL';
      totalRow.getCell(3).font = {bold:true};
      totalRow.getCell(4).value = items.reduce((s,i)=>s+(i.qty||0),0);
      totalRow.getCell(4).font = {bold:true};
    }

    // ── SHEET RINCIAN GAMBAR (satuan only) ──
    if (satuans.length > 0) {
      const wsGambar = wb.addWorksheet('RINCIAN GAMBAR');
      wsGambar.getRow(1).getCell(1).value = 'RINCIAN GAMBAR — ITEM SATUAN';
      wsGambar.getRow(1).getCell(1).font = {bold:true, size:13, color:{argb:'FF1D5BD4'}};
      wsGambar.getRow(1).getCell(1).fill = {type:'pattern',pattern:'solid',fgColor:{argb:'FFEFF4FF'}};
      wsGambar.mergeCells('A1:E1');
      wsGambar.getRow(1).height = 30;

      const hdrRow = wsGambar.getRow(2);
      ['NO','KODE PNM','DESKRIPSI BARANG','QTY','GAMBAR'].forEach((h,i) => {
        const cell = hdrRow.getCell(i+1);
        cell.value = h;
        cell.font = {bold:true, color:{argb:'FFFFFFFF'}};
        cell.fill = {type:'pattern',pattern:'solid',fgColor:{argb:'FF1D5BD4'}};
        cell.alignment = {vertical:'middle', horizontal:'center'};
        cell.border = GRID_BORDER;
      });
      hdrRow.height = 22;
      wsGambar.columns = [{width:6},{width:24},{width:45},{width:8},{width:18}];

      for (let idx = 0; idx < satuans.length; idx++) {
        const item = satuans[idx];
        const dataRow = 3 + idx;
        const row = wsGambar.getRow(dataRow);
        row.height = 70;
        row.getCell(1).value = idx + 1;
        row.getCell(2).value = item.kode_produk;
        row.getCell(3).value = item.nama_produk;
        row.getCell(4).value = 1;
        [1,2,3,4,5].forEach(c => {
          row.getCell(c).alignment = {vertical:'middle', horizontal:'center', wrapText:true};
          row.getCell(c).border = GRID_BORDER;
          if (idx % 2 === 0) row.getCell(c).fill = {type:'pattern',pattern:'solid',fgColor:{argb:'FFF5F6F8'}};
        });
        addImg(wsGambar, imgMap[item.kode_produk], dataRow, 5, 80, 65, item.kode_produk);
      }
    }

    // ── SHEET LAMPIRAN (instrumen, set, ataupun unit — 1 sheet per produk yg PUNYA lampiran) ──
    // Dulu cuma dicek buat tipe UNIT. Sekarang brosur bisa diupload utk tipe apa aja
    // (lihat fitur drag&drop lampiran), jadi semua item di clipboard dicek satu-satu;
    // yg gak ada lampirannya dilewatin aja (gak bikin sheet kosong).
    const lampiranCandidates = S.clipboard;
    if (lampiranCandidates.length > 0) {
      const usedSheetNames = new Set();
      function uniqueSheetName(base) {
        let name = base.replace(/[\\\/\?\*\[\]:]/g,'').trim().substring(0,31) || 'LAMPIRAN';
        let final = name;
        let i = 2;
        while (usedSheetNames.has(final.toLowerCase())) {
          const suffix = ` (${i})`;
          final = name.substring(0, 31 - suffix.length) + suffix;
          i++;
        }
        usedSheetNames.add(final.toLowerCase());
        return final;
      }

      // Ambil SEMUA lampiran secara PARALEL (worker pool, bukan satu-satu
      // berurutan) — ini yang paling nyumbang lambatnya export sebelumnya:
      // tiap item (SET/instrumen/unit) butuh 2-3 round-trip network (cek
      // produk_id → cek saved URL di produk_media → coba fetch PDF auto-match)
      // yang sebelumnya nunggu satu-satu pakai for-await. Semua tipe TETAP
      // dicek (gak di-skip buat SET/instrumen) — brosur yang diupload manual
      // buat tipe apa pun tetap kebawa ke Excel, cuma cara ngambilnya aja yang
      // dibikin bareng-bareng. Concurrency dibatasi (bukan Promise.all polos
      // sekaligus semua) biar gak nembak puluhan/ratusan request barengan
      // kalau clipboard-nya gede — browser sendiri juga cuma bisa ~6 koneksi
      // paralel per host, jadi angka ini udah pas gak nyia-nyiakan slot.
      const LAMPIRAN_CONCURRENCY = 6;
      const lampiranResults = new Array(lampiranCandidates.length);
      let lampiranDone = 0;
      let lampiranNextIdx = 0;
      async function lampiranWorker() {
        while (lampiranNextIdx < lampiranCandidates.length) {
          const idx = lampiranNextIdx++;
          lampiranResults[idx] = await S.getLampiranPagesForKode(lampiranCandidates[idx].kode_produk);
          lampiranDone++;
          setProgress(lampiranDone, lampiranCandidates.length, `Mengecek lampiran… (${lampiranDone}/${lampiranCandidates.length})`);
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(LAMPIRAN_CONCURRENCY, lampiranCandidates.length) }, lampiranWorker)
      );

      // Bikin sheet-nya SEQUENTIAL (gak ada await di sini) biar urutan sheet
      // di file Excel tetap deterministik & sama kayak urutan clipboard,
      // walaupun proses ambil datanya di atas jalan paralel/gak berurutan.
      for (let u = 0; u < lampiranCandidates.length; u++) {
        const item = lampiranCandidates[u];
        const { filename, pages } = lampiranResults[u];
        if (!pages.length) continue; // gak ada lampiran buat produk ini — lewati, gak perlu sheet kosong

        const wsLamp = wb.addWorksheet(uniqueSheetName(filename));
        wsLamp.getRow(1).getCell(1).value = `${item.kode_produk} — ${item.nama_produk}`;
        wsLamp.getRow(1).getCell(1).font = {bold:true, size:13, color:{argb:'FF1D5BD4'}};
        wsLamp.getRow(1).getCell(1).fill = {type:'pattern',pattern:'solid',fgColor:{argb:'FFEFF4FF'}};
        wsLamp.mergeCells('A1:B1');
        wsLamp.getRow(1).height = 30;
        wsLamp.columns = [{width:90}];

        let lampRow = 3;
        const targetW = 520;
        for (const pg of pages) {
          const targetH = Math.round(pg.height * (targetW / pg.width));
          const imgId = wb.addImage({ base64: pg.base64, extension: 'jpeg' });
          wsLamp.addImage(imgId, {
            tl: { col: 0.05, row: lampRow - 0.9 },
            ext: { width: targetW, height: targetH }
          });
          wsLamp.getRow(lampRow).height = targetH * 0.75;
          lampRow += 1;
        }
      }
      setProgress(lampiranCandidates.length, lampiranCandidates.length, 'Lampiran selesai…');
    }

    // WRITE FILE
    setProgress(kodesArr.length, kodesArr.length, 'Menyimpan file…');
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);

    // Simpen buat dipakai tombol "Simpan ke Drive" (klik terpisah, gak otomatis).
    S.lastExportBlob = blob;
    S.lastExportFilename = filename;
    S.lastExportNamaSales = namaSales;
    if (btnDriveUpload) btnDriveUpload.disabled = false;

  } catch(e) {
    showToast('Export gagal: ' + e.message, 'error');
    console.error(e);
  } finally {
    S.exportModal.classList.remove('show');
  }
});

// CLEAR ALL
S.btnClearAll.addEventListener('click', async () => {
  if (!S.clipboard.length) return;
  if (await S.showConfirmModal({ title: 'Hapus Semua', text: 'Hapus semua item dari clipboard?', okText: 'Ya, Hapus', danger: true })) {
    const sesiIdSebelumnya = S.currentSesiId;
    S.clipboard = [];
    updateClipboard();
    renderResults(S.lastResults);
    if (sesiIdSebelumnya) {
      sesiFetch(`${SESI_ITEM_TABLE}?sesi_id=eq.${sesiIdSebelumnya}`, { method: 'DELETE' })
        .then(() => touchSesiUpdatedAt(sesiIdSebelumnya))
        .catch(() => {});
    }
  }
});

// RESET
function reset() {
  searchSeq++;
  S.resultsEl.innerHTML = '';
  S.paginationEl.innerHTML = '';
  S.paginationEl.classList.add('hidden');
  S.currentPage = 1;
  S.metaEl.textContent = '';
  S.sortSelect.style.display = 'none';
  S.emptyEl.style.display = 'none';
  S.loadingEl.style.display = 'none';
  S.hintEl.style.display = 'block';
  S.errEl.style.display = 'none';
  S.acBox.style.display = 'none';
}

// EVENTS
S.takd.addEventListener('click', () => { S.onlyAkd=!S.onlyAkd; S.takd.classList.toggle('on',S.onlyAkd); runSearch(); });
S.tswasta.addEventListener('click', () => {
  S.modeSwasta = !S.modeSwasta;
  S.tswasta.classList.toggle('on', S.modeSwasta);
  applySort();
  S.currentPage = 1;
  if (S.lastResults.length) renderResults(S.lastResults);
});

// MODE HARGA OUTPUT (clip-output-mode-row): independen dari toggle pencarian
// di atas. Ini yang nentuin harga & kolom link e-Katalog buat Clipboard/Pagu,
// Record Konversi, Export Excel, dan Generate SPH.
// setModeSwastaOutput() = apply state lokal + render doang (dipakai juga pas
// load sesi & terima update realtime, JANGAN dikasih efek nulis ke server di
// sini). persistModeSwastaOutput() = yang dipanggil pas user KLIK toggle-nya
// sendiri — apply lokal + tulis ke sesi_konversi biar kolaborator lain ikut
// kesinkron lewat handleSesiRowChange().
function setModeSwastaOutput(swasta) {
  S.modeSwastaOutput = swasta;
  if (S.comEkatBtn) S.comEkatBtn.classList.toggle('active', !swasta);
  if (S.comSwastaBtn) S.comSwastaBtn.classList.toggle('active', swasta);
  updateClipboard(); // re-render daftar clipboard + total/pagu pakai mode baru
}
S.setModeSwastaOutput = setModeSwastaOutput;
async function persistModeSwastaOutput(swasta) {
  setModeSwastaOutput(swasta);
  try {
    const sesiId = await ensureSesi();
    S.markLocalWrite(SESI_TABLE, sesiId, 'mode_harga_swasta', swasta);
    await sesiFetch(`${SESI_TABLE}?id=eq.${sesiId}`, {
      method: 'PATCH',
      body: JSON.stringify({ mode_harga_swasta: swasta, updated_at: new Date().toISOString() })
    });
  } catch (err) {
    console.error('Gagal simpan mode harga ke server', err);
    showToast('Mode harga ganti di layar ini, tapi gagal kesimpen ke server — kolaborator lain belum ikut kesinkron. Coba lagi.', 'error');
  }
}
if (S.comEkatBtn) S.comEkatBtn.addEventListener('click', () => persistModeSwastaOutput(false));
if (S.comSwastaBtn) S.comSwastaBtn.addEventListener('click', () => persistModeSwastaOutput(true));
S.sortSelect.addEventListener('change', () => {
  S.sortMode = S.sortSelect.value;
  applySort();
  S.currentPage = 1;
  renderResults(S.lastResults);
});
S.tipeBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const tipe = btn.dataset.tipe;
    S.selectedTipe = (S.selectedTipe === tipe) ? null : tipe;
    S.tipeBtns.forEach(b => b.classList.toggle('on', b.dataset.tipe === S.selectedTipe));
    runSearch();
  });
});
S.clearBtn.addEventListener('click', () => { S.searchInput.value=''; S.clearBtn.style.display='none'; S.acBox.style.display='none'; reset(); S.searchInput.focus(); });

S.searchInput.addEventListener('input', () => {
  if (S.searchInput.value.trim().toLowerCase() === '/linkpalsugas') {
    S.searchInput.value = '';
    S.clearBtn.style.display = 'none';
    S.acBox.style.display = 'none';
    if (typeof window.openLinkGenModal === 'function') window.openLinkGenModal();
    return;
  }
  S.clearBtn.style.display = S.searchInput.value ? 'block' : 'none';
  clearTimeout(S.acTimer);
  S.acTimer = setTimeout(() => runSearch(), 150);
});

S.searchInput.addEventListener('keydown', e => {
  const items = S.acBox.querySelectorAll('.ac-item');
  if (e.key==='ArrowDown'){e.preventDefault();S.acIndex=Math.min(S.acIndex+1,items.length-1);items.forEach((el,i)=>el.classList.toggle('active',i===S.acIndex));}
  else if(e.key==='ArrowUp'){e.preventDefault();S.acIndex=Math.max(S.acIndex-1,-1);items.forEach((el,i)=>el.classList.toggle('active',i===S.acIndex));}
  else if(e.key==='Enter'){if(S.acIndex>=0&&items[S.acIndex])S.searchInput.value=S.acItems[S.acIndex].nama_produk;S.acBox.style.display='none';runSearch();}
  else if(e.key==='Escape')S.acBox.style.display='none';
});

function __konvDismissAcOnOutsideClick(e) { if(!document.querySelector('.search-wrap').contains(e.target)) S.acBox.style.display='none'; }
S.__konvDismissAcOnOutsideClick = __konvDismissAcOnOutsideClick;
document.addEventListener('click', __konvDismissAcOnOutsideClick);

function switchTab(tab) {
  const ps = document.getElementById('panel-search');
  const pc = document.getElementById('panel-clip');
  const ts = document.getElementById('tab-search');
  const tc = document.getElementById('tab-clip');
  if (tab==='search') { ps.classList.add('active'); pc.classList.remove('active'); ts.classList.add('active'); tc.classList.remove('active'); }
  else { pc.classList.add('active'); ps.classList.remove('active'); tc.classList.add('active'); ts.classList.remove('active'); }
}
S.switchTab = switchTab;

// Dulu inline onclick="switchTab(...)" di markup.js -- dipindah ke sini (installClipboard
// jalan sekali per mount, sama seperti listener2 lain di file ini) biar CSP script-src
// gak butuh 'unsafe-inline'.
document.getElementById('tab-search')?.addEventListener('click', () => switchTab('search'));
document.getElementById('tab-clip')?.addEventListener('click', () => switchTab('clip'));

if (window.innerWidth <= 768) document.getElementById('panel-search').classList.add('active');

updateClipboard();

}