const SUPABASE_URL = 'https://ptkkbsemihcyndisjoor.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB0a2tic2VtaWhjeW5kaXNqb29yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0Njc4MzgsImV4cCI6MjA5ODA0MzgzOH0.QsCqmcqQcXvz1f8bLkagvMbAGUBbBP-3Wa5Aore5OMo';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const THUMB_BASE = 'https://ptkkbsemihcyndisjoor.supabase.co/storage/v1/object/public/thumbnails/';

const SEAL_LABELS = {
  terhubung: 'Terhubung',
  belum_diajukan: 'Perlu AKD',
  belum_firm: 'Belum Firm',
  di_luar_cakupan: 'Di Luar Cakupan'
};
function sealHtml(status){
  const s = status || 'null';
  const label = SEAL_LABELS[status] || 'Belum Ada';
  return `<span class="seal seal-${s}">${label}</span>`;
}
const TIPE_TO_AKD = { INSTRUMENT: 'satuan', SET: 'set', UNIT: 'unit' };

function renderInaprocIndikator(statusInaproc, linkV6){
  const el = document.getElementById('inaprocIndikator');
  if (!statusInaproc) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  let cls = 'seal-null', label = statusInaproc;
  if (statusInaproc === 'Disetujui') cls = 'seal-terhubung';
  else if (statusInaproc === 'Ditolak') cls = 'seal-belum_diajukan';
  else if (statusInaproc === 'Menunggu Persetujuan') cls = 'seal-belum_firm';
  let extra = '';
  if (statusInaproc === 'Disetujui' && !linkV6) {
    extra = ' <span style="color:var(--rust-text);font-size:11.5px;">— sudah disetujui INAPROC, belum ada Link V6, siap dibuatkan!</span>';
  }
  el.innerHTML = `<span style="font-size:11px;color:var(--text-muted);">Status INAPROC:</span> <span class="seal ${cls}">${escapeHtml(label)}</span>${extra}`;
}

// ---- Theme toggle ----
// NOTE: data-theme attribute is already set as early as possible by the
// inline script right after <body> (prevents flash of light theme before
// this external file loads). Here we just sync the icon + wire the toggle.
const themeToggle = document.getElementById('themeToggle');
const themeIcon = document.getElementById('themeIcon');
function applyTheme(t){
  document.body.setAttribute('data-theme', t);
  themeIcon.className = t === 'dark' ? 'ti ti-moon' : 'ti ti-sun';
  localStorage.setItem('theme', t);
}
themeIcon.className = document.body.getAttribute('data-theme') === 'dark' ? 'ti ti-moon' : 'ti ti-sun';
themeToggle.addEventListener('click', () => {
  applyTheme(document.body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
});

// ---- Sidebar nav (stub views) ----
function switchView(view){
  document.querySelectorAll('.sb-item[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  ['produk','dashboard','set','akd','bulk'].forEach(v => {
    document.getElementById('view' + v.charAt(0).toUpperCase() + v.slice(1)).style.display = (v === view) ? 'block' : 'none';
  });
  document.getElementById('addBtn').style.display = (view === 'produk') ? '' : 'none';
  document.querySelector('.view-toggle').style.display = (view === 'produk') ? '' : 'none';
  if (view === 'akd' && !akdLoadedOnce) { akdLoadedOnce = true; loadAkdDistinctValues(); loadAkd(); }
}
let akdLoadedOnce = false;
document.querySelectorAll('.sb-item[data-view]').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

// ---- Sidebar collapse/expand (desktop) — state disimpen di localStorage biar
// nempel walau reload/pindah tool, sama kayak preferensi theme & view lain. ----
const sidebarEl = document.querySelector('.sidebar');
const sidebarCollapseBtn = document.getElementById('sidebarCollapseBtn');
function setSidebarCollapsed(collapsed){
  sidebarEl.classList.toggle('collapsed', collapsed);
  sidebarCollapseBtn.title = collapsed ? 'Perluas sidebar' : 'Ciutkan sidebar';
  localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0');
}
setSidebarCollapsed(localStorage.getItem('sidebarCollapsed') === '1');
sidebarCollapseBtn.addEventListener('click', () => setSidebarCollapsed(!sidebarEl.classList.contains('collapsed')));

// ---- Auth elements ----
const gateWrap = document.getElementById('gateWrap');
const appWrap = document.getElementById('appWrap');
const gateTitle = document.getElementById('gateTitle');
const gateDesc = document.getElementById('gateDesc');
const loginFormWrap = document.getElementById('loginFormWrap');
const loginEmail = document.getElementById('loginEmail');
const loginPassword = document.getElementById('loginPassword');
const loginBtn = document.getElementById('loginBtn');
const gateMsg = document.getElementById('gateMsg');
const userEmailLabel = document.getElementById('userEmailLabel');
const logoutBtn = document.getElementById('logoutBtn');

function showMsg(text, type){
  gateMsg.textContent = text;
  gateMsg.className = 'gate-msg show ' + type;
}

loginBtn.addEventListener('click', async () => {
  const email = loginEmail.value.trim().toLowerCase();
  const password = loginPassword.value;
  if (!email || !email.includes('@')) { showMsg('Masukkan email yang valid dulu ya.', 'error'); return; }
  if (!password) { showMsg('Masukkan password.', 'error'); return; }
  loginBtn.disabled = true;
  loginBtn.textContent = 'Memproses...';
  const { error } = await sb.auth.signInWithPassword({ email, password });
  loginBtn.disabled = false;
  loginBtn.textContent = 'Masuk';
  if (error) {
    showMsg(error.message.toLowerCase().includes('email not confirmed')
      ? 'Email belum dikonfirmasi. Cek inbox kamu buat klik link konfirmasi dulu.'
      : 'Gagal masuk: ' + error.message, 'error');
    return;
  }
});

async function checkWhitelistAndShowApp(session){
  const email = session.user.email.toLowerCase();
  const { data, error } = await sb.from('allowed_users').select('email, role').eq('email', email).maybeSingle();
  if (error) {
    // Query gagal (network/timeout, dll) — ini BUKAN bukti email nggak terdaftar.
    // Jangan sign-out paksa di tengah kerjaan; cukup kasih tahu dan biarkan sesi tetap hidup.
    showToast('Gagal cek akses (koneksi bermasalah), coba lagi: ' + error.message, true);
    return;
  }
  if (!data) {
    // Ini baru konfirmasi valid: query sukses, dan emailnya memang nggak ada di whitelist.
    await sb.auth.signOut();
    gateTitle.textContent = 'Akses Ditolak';
    gateDesc.textContent = 'Email ' + email + ' belum terdaftar sebagai tim. Hubungi admin kalau ini seharusnya salah.';
    loginFormWrap.style.display = 'none';
    gateMsg.className = 'gate-msg show error';
    gateMsg.textContent = 'Silakan hubungi admin untuk ditambahkan ke daftar akses.';
    gateWrap.style.display = 'flex';
    appWrap.style.display = 'none';
    return;
  }
  userEmailLabel.textContent = email;
  gateWrap.style.display = 'none';
  appWrap.style.display = 'flex';
  loadProduk();
  refreshProdukFilterCounts();
}

logoutBtn.addEventListener('click', async () => { await sb.auth.signOut(); });

// Cuma jalanin gate whitelist di event login yang beneran baru (sign-in awal / load pertama).
// Event lain kayak TOKEN_REFRESHED juga bawa `session`, tapi itu cuma refresh token di
// background — nggak perlu (dan berbahaya kalau) re-check whitelist tiap kali itu terjadi,
// karena query yang gagal gara-gara network sibuk (mis. lagi proses bulk upsert) bisa
// kepicu sign-out paksa padahal user sebenarnya masih valid login.
const AUTH_EVENTS_YANG_MEMICU_GATE = new Set(['SIGNED_IN', 'INITIAL_SESSION']);
sb.auth.onAuthStateChange((event, session) => {
  if (session && AUTH_EVENTS_YANG_MEMICU_GATE.has(event)) {
    checkWhitelistAndShowApp(session);
  } else if (!session) {
    gateWrap.style.display = 'flex'; appWrap.style.display = 'none'; loginFormWrap.style.display = 'block'; gateTitle.textContent = 'Masuk ke Produk'; gateDesc.textContent = 'Khusus tim internal.';
  }
  // event lain (TOKEN_REFRESHED, USER_UPDATED, dll) dengan session yang masih ada: diamkan,
  // sesi tetap jalan seperti biasa tanpa re-gate.
});

// ---- Log Aktivitas ----
const LOG_ACTION_LABELS = { INSERT: 'Tambah', UPDATE: 'Ubah', DELETE: 'Hapus' };
const LOG_TABLE_LABELS = { produk: 'Produk', produk_harga: 'Harga', produk_media: 'Media', master_produk: 'Master Produk', produk_akd: 'Relasi AKD', produk_set_item: 'Komposisi Set', akd: 'AKD' };
const logModalOverlay = document.getElementById('logModalOverlay');
document.getElementById('logToggle').addEventListener('click', () => { logModalOverlay.classList.add('open'); loadLog(1); });
document.getElementById('logModalCloseBtn').addEventListener('click', () => logModalOverlay.classList.remove('open'));
logModalOverlay.addEventListener('click', e => { if (e.target === logModalOverlay) logModalOverlay.classList.remove('open'); });
document.getElementById('log_refresh').addEventListener('click', () => loadLog(1));
document.getElementById('log_tanggal').addEventListener('change', () => loadLog(1));
document.getElementById('log_table').addEventListener('change', () => loadLog(1));
document.getElementById('log_action').addEventListener('change', () => loadLog(1));

let logPage = 1;
const LOG_PAGE_SIZE = 30;

async function loadLog(page){
  logPage = page || logPage || 1;
  const logList = document.getElementById('logList');
  logList.innerHTML = '<div style="color:var(--text-muted);padding:14px;">Memuat log...</div>';
  let query = sb.from('audit_log').select('*', { count: 'exact' }).order('changed_at', { ascending: false });
  const tgl = document.getElementById('log_tanggal').value;
  const tbl = document.getElementById('log_table').value;
  const act = document.getElementById('log_action').value;
  if (tgl) query = query.gte('changed_at', tgl + 'T00:00:00').lte('changed_at', tgl + 'T23:59:59');
  if (tbl) query = query.eq('table_name', tbl);
  if (act) query = query.eq('action', act);
  const from = (logPage - 1) * LOG_PAGE_SIZE;
  const to = from + LOG_PAGE_SIZE - 1;
  query = query.range(from, to);

  const { data, error, count } = await query;
  if (error) { logList.innerHTML = `<div style="color:var(--rust);padding:14px;">Gagal memuat log: ${escapeHtml(error.message)}</div>`; return; }
  const total = count || 0;
  renderPgBar(document.getElementById('logPagination'), {
    page: logPage, pageSize: LOG_PAGE_SIZE, total,
    onPageChange: (p) => loadLog(p)
  });
  if (!data || data.length === 0) { logList.innerHTML = '<div style="color:var(--text-muted);padding:14px;">Tidak ada aktivitas.</div>'; return; }

  logList.innerHTML = '';
  data.forEach((row, idx) => {
    const el = document.createElement('div');
    el.className = 'log-entry';
    const jam = new Date(row.changed_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    el.innerHTML = `
      <div class="log-entry-top">
        <span class="log-action ${row.action}">${LOG_ACTION_LABELS[row.action] || row.action}</span>
        <span class="log-table">${LOG_TABLE_LABELS[row.table_name] || row.table_name}</span>
        <span class="log-meta">${jam} · ${escapeHtml(row.changed_by || 'tidak diketahui')}</span>
      </div>
      <div class="log-summary">${buildLogSummary(row)}</div>
      <button class="log-diff-toggle" data-idx="${idx}">Lihat detail</button>
      <div class="log-diff" id="logdiff-${idx}">${escapeHtml(JSON.stringify({ before: row.old_data, sesudah: row.new_data }, null, 2))}</div>
    `;
    el.querySelector('.log-diff-toggle').addEventListener('click', e => {
      const diffEl = document.getElementById('logdiff-' + idx);
      diffEl.classList.toggle('open');
      e.target.textContent = diffEl.classList.contains('open') ? 'Sembunyikan detail' : 'Lihat detail';
    });
    logList.appendChild(el);
  });
}
function buildLogSummary(row){
  const label = LOG_TABLE_LABELS[row.table_name] || row.table_name;
  const idText = row.record_id ? `<span class="kode-cell">${escapeHtml(row.record_id)}</span>` : '';
  if (row.action === 'INSERT') {
    const nama = row.new_data?.nama_produk || row.new_data?.judul || row.new_data?.deskripsi_vendor || '';
    return `Menambahkan ${label} ${idText}${nama ? ' — ' + escapeHtml(nama) : ''}`;
  }
  if (row.action === 'DELETE') {
    const nama = row.old_data?.nama_produk || row.old_data?.judul || '';
    return `Menghapus ${label} ${idText}${nama ? ' — ' + escapeHtml(nama) : ''}`;
  }
  const before = row.old_data || {}, after = row.new_data || {};
  const changed = Object.keys(after).filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k]) && k !== 'updated_at');
  const fieldsText = changed.length ? changed.slice(0, 4).join(', ') + (changed.length > 4 ? `, +${changed.length - 4} lainnya` : '') : 'tidak ada field berubah';
  return `Mengubah ${label} ${idText} — field: ${escapeHtml(fieldsText)}`;
}

// ================================================================
// PRODUK LIST — search pakai RPC search_produk_dengan_harga
// ================================================================
let currentProdukId = null;
let masterExists = false;
let hargaRows = [];
let mediaRows = [];
let currentAkdLinks = [];
let currentView = localStorage.getItem('produkView') || 'table';

function showToast(msg, isError){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isError ? ' error' : '');
  setTimeout(() => t.className = 'toast', 3000);
}
function escapeHtml(s){
  return String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

// ---- Pagination reusable — dipakai di Produk, Set Management, Log Aktivitas ----
// el: elemen container. page: halaman aktif (mulai dari 1). pageSize: item per
// halaman. total: total item keseluruhan (dari count exact / panjang array).
// onPageChange(newPage): dipanggil pas user klik halaman lain.
function renderPgBar(el, { page, pageSize, total, onPageChange }){
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0 || totalPages <= 1) { el.innerHTML = ''; el.style.display = 'none'; return; }
  el.style.display = 'flex';

  const startItem = (page - 1) * pageSize + 1;
  const endItem = Math.min(page * pageSize, total);

  const pagesToShow = [...new Set([1, totalPages, page - 1, page, page + 1])]
    .filter(p => p >= 1 && p <= totalPages)
    .sort((a, b) => a - b);

  let numberBtns = '';
  let prevP = null;
  pagesToShow.forEach(p => {
    if (prevP !== null && p - prevP > 1) numberBtns += `<span class="pg-ellipsis">…</span>`;
    numberBtns += `<button class="pg-btn${p === page ? ' active' : ''}" data-page="${p}">${p}</button>`;
    prevP = p;
  });

  el.innerHTML = `
    <span class="pg-info">${startItem}–${endItem} dari ${total}</span>
    <div class="pg-btns">
      <button class="pg-btn" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''}><i class="ti ti-chevron-left"></i></button>
      ${numberBtns}
      <button class="pg-btn" data-page="${page + 1}" ${page === totalPages ? 'disabled' : ''}><i class="ti ti-chevron-right"></i></button>
    </div>
  `;
  el.querySelectorAll('.pg-btn[data-page]:not(:disabled)').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = parseInt(btn.dataset.page, 10);
      if (!p || p < 1 || p > totalPages || p === page) return;
      onPageChange(p);
    });
  });
}

const tableBody = document.getElementById('tableBody');
const cardWrap = document.getElementById('cardWrap');
const tableWrap = document.getElementById('tableWrap');
const produkCount = document.getElementById('produkCount');
const viewTableBtn = document.getElementById('viewTableBtn');
const viewCardBtn = document.getElementById('viewCardBtn');

function setView(v){
  currentView = v;
  localStorage.setItem('produkView', v);
  viewTableBtn.classList.toggle('active', v === 'table');
  viewCardBtn.classList.toggle('active', v === 'card');
  tableWrap.style.display = v === 'table' ? 'block' : 'none';
  cardWrap.style.display = v === 'card' ? 'grid' : 'none';
}
viewTableBtn.addEventListener('click', () => setView('table'));
viewCardBtn.addEventListener('click', () => setView('card'));
setView(currentView);

let lastQuery = '';
let topSearchTimer = null;
const topSearchInput = document.getElementById('topSearchInput');
const topSearchClear = document.getElementById('topSearchClear');
topSearchInput.addEventListener('input', () => {
  clearTimeout(topSearchTimer);
  topSearchClear.style.display = topSearchInput.value ? 'block' : 'none';
  topSearchTimer = setTimeout(() => {
    switchView('produk');
    loadProduk(topSearchInput.value);
  }, 300);
});
topSearchClear.addEventListener('click', () => {
  topSearchInput.value = '';
  topSearchClear.style.display = 'none';
  loadProduk('');
  topSearchInput.focus();
});

let produkPage = 1;
const PRODUK_PAGE_SIZE = 30;
let produkSearchRawRows = []; // hasil lengkap dari RPC search_produk_dengan_harga, BELUM difilter status
let produkSearchAllRows = []; // produkSearchRawRows setelah difilter status_akd/link, di-page di client

// ---- Filter status (chip bar di atas list Produk) ----
// 'all' gak butuh kondisi tambahan. Sisanya map ke kolom status_akd, kecuali
// 'disetujui_tanpa_link' yang kondisinya gabungan status_inaproc + link_v6 kosong
// (logic-nya sama persis kayak renderInaprocIndikator() di modal edit, cuma di sini
// dipakai buat nyaring list, bukan cuma nampilin di satu produk).
const PRODUK_FILTERS = {
  all: null,
  belum_diajukan: p => p.status_akd === 'belum_diajukan',
  belum_firm: p => p.status_akd === 'belum_firm',
  di_luar_cakupan: p => p.status_akd === 'di_luar_cakupan',
  terhubung: p => p.status_akd === 'terhubung',
  disetujui_tanpa_link: p => p.status_inaproc === 'Disetujui' && !p.link_v6,
};
let produkActiveFilter = 'all';
function applyProdukFilterToQuery(query, filterKey){
  if (filterKey === 'disetujui_tanpa_link') return query.eq('status_inaproc', 'Disetujui').is('link_v6', null);
  if (filterKey && filterKey !== 'all') return query.eq('status_akd', filterKey);
  return query;
}

const PRODUK_LIST_COLUMNS = 'id, kode_produk, nama_produk, tipe, golongan, is_active, status_akd, status_inaproc, link_v6, updated_at';

// ---- Filter bertumpuk ("+ Tambah Filter") — di-AND-kan di atas chip status di atas
// DAN di atas search yang lagi aktif. Sengaja dipasang di sini (Produk), bukan di
// halaman AKD, karena semua dimensinya adalah properti produk (golongan, tipe,
// is_active, status_inaproc, ketersediaan harga) — bukan properti AKD.
let produkActiveFilters = []; // [{ dim, value, label }]
let produkDistinct = { tipe: [], golongan: [], status_inaproc: [] };
let produkHargaIdSet = null; // Set<produk_id> yang SUDAH punya baris produk_harga, dimuat lazy pas dimensi "harga" dipakai
let produkAllRowsCache = { key: null, rows: null }; // dipakai kalau ada filter tambahan aktif (tanpa search) -> full-fetch respek chip status, difilter+dipaging di client
let produkCurrentFilteredFull = null; // hasil filter lengkap (semua halaman) -> sumber Download Excel

const PRODUK_FILTER_DIMS = [
  { key: 'tipe', label: 'Tipe', dynamic: 'tipe', multi: true },
  { key: 'golongan', label: 'Golongan', dynamic: 'golongan' },
  { key: 'is_active', label: 'Status Aktif', options: [
      { value: 'aktif', label: 'Aktif' },
      { value: 'nonaktif', label: 'Nonaktif' },
  ]},
  { key: 'status_inaproc', label: 'Status INAPROC', dynamic: 'status_inaproc' },
  { key: 'harga', label: 'Ketersediaan Harga', options: [
      { value: 'ada', label: 'Sudah ada harga' },
      { value: 'kosong', label: 'Belum ada harga' },
  ]},
  { key: 'link_v6', label: 'Link V6', options: [
      { value: 'ada', label: 'Sudah ada link' },
      { value: 'kosong', label: 'Belum ada link' },
  ]},
];

async function loadProdukDistinctValues(){
  const [tipeR, golR, statR] = await Promise.all([
    sb.from('produk').select('tipe').not('tipe', 'is', null).limit(3000),
    sb.from('produk').select('golongan').not('golongan', 'is', null).limit(3000),
    sb.from('produk').select('status_inaproc').not('status_inaproc', 'is', null).limit(3000),
  ]);
  produkDistinct.tipe = [...new Set((tipeR.data || []).map(r => r.tipe).filter(Boolean))].sort();
  produkDistinct.golongan = [...new Set((golR.data || []).map(r => r.golongan).filter(Boolean))].sort();
  produkDistinct.status_inaproc = [...new Set((statR.data || []).map(r => r.status_inaproc).filter(Boolean))].sort();
}

async function ensureProdukHargaSet(){
  if (produkHargaIdSet) return;
  // RPC balikin SATU baris array (bukan ribuan baris satu-satu), jadi gak
  // kena limit baris PostgREST berapapun besar produk_harga nanti tumbuh
  // -- beda dari .select('produk_id').limit(20000) yang dulu kepotong diam-diam
  // pas produk_harga sudah 22 ribu baris (2 ribu produk salah kelihatan "belum ada harga").
  const { data, error } = await sb.rpc('get_produk_harga_ids');
  if (error) {
    showToast('Gagal cek ketersediaan harga: ' + error.message, true);
    produkHargaIdSet = new Set();
    return;
  }
  produkHargaIdSet = new Set(data || []);
}
function invalidateProdukStackCache(){
  produkAllRowsCache = { key: null, rows: null };
  produkHargaIdSet = null;
}

function produkRowMatchesFilter(row, filt){
  switch (filt.dim) {
    case 'tipe': return filt.values ? filt.values.includes(row.tipe) : row.tipe === filt.value;
    case 'golongan': return row.golongan === filt.value;
    case 'is_active': return filt.value === 'aktif' ? !!row.is_active : !row.is_active;
    case 'status_inaproc': return row.status_inaproc === filt.value;
    case 'harga': {
      const has = produkHargaIdSet.has(row.id);
      return filt.value === 'ada' ? has : !has;
    }
    case 'link_v6': return filt.value === 'ada' ? !!row.link_v6 : !row.link_v6;
    default: return true;
  }
}

async function loadProduk(q, page){
  const newQ = (q ?? lastQuery ?? '').trim();
  const searchChanged = newQ !== (lastQuery ?? '').trim();
  lastQuery = newQ;
  produkPage = searchChanged ? 1 : (page || produkPage || 1);
  const qq = newQ;

  tableBody.innerHTML = `<tr class="state-row"><td colspan="5">Memuat data...</td></tr>`;
  cardWrap.innerHTML = '';
  produkCount.textContent = 'Memuat...';

  const needsHarga = produkActiveFilters.some(f => f.dim === 'harga');
  if (needsHarga) await ensureProdukHargaSet();

  let rows = [];
  let total = 0;
  if (qq) {
    // pakai RPC search yang sudah ranked (token search + trigram + fast-path exact match)
    // RPC ini ambil SEMUA hasil match sekaligus (gak dukung limit/offset dan gak dukung
    // filter status tambahan), jadi paging DAN filter status dilakukan di client dari
    // produkSearchRawRows — bukan query ulang tiap ganti halaman/filter.
    if (searchChanged) {
      const { data: rpcData, error: rpcErr } = await sb.rpc('search_produk_dengan_harga', { q: qq, p_tipe: null, only_akd: false, only_kfa: false });
      if (rpcErr) { tableBody.innerHTML = `<tr class="state-row"><td colspan="5">Gagal mencari: ${escapeHtml(rpcErr.message)}</td></tr>`; return; }
      const kodeList = (rpcData || []).map(r => r.kode_produk);
      if (kodeList.length === 0) { produkSearchRawRows = []; }
      else {
        const { data: fullRows, error: fullErr } = await sb.from('produk')
          .select(PRODUK_LIST_COLUMNS)
          .in('kode_produk', kodeList);
        if (fullErr) { tableBody.innerHTML = `<tr class="state-row"><td colspan="5">Gagal memuat: ${escapeHtml(fullErr.message)}</td></tr>`; return; }
        const byKode = Object.fromEntries((fullRows || []).map(r => [r.kode_produk, r]));
        produkSearchRawRows = kodeList.map(k => byKode[k]).filter(Boolean);
      }
    }
    const matcher = PRODUK_FILTERS[produkActiveFilter];
    let filtered = matcher ? produkSearchRawRows.filter(matcher) : produkSearchRawRows;
    produkActiveFilters.forEach(f => { filtered = filtered.filter(r => produkRowMatchesFilter(r, f)); });
    produkSearchAllRows = filtered;
    produkCurrentFilteredFull = filtered;
    total = filtered.length;
    rows = filtered.slice((produkPage - 1) * PRODUK_PAGE_SIZE, produkPage * PRODUK_PAGE_SIZE);
  } else if (produkActiveFilters.length > 0) {
    // Ada filter tambahan aktif ("+ Tambah Filter") tapi gak lagi search -> gak bisa
    // dipaging langsung di server (kombinasi filternya campuran server+client), jadi
    // full-fetch SEKALI (respek chip status di server dulu biar lebih ringan), lalu
    // filter tambahan + paging dilakukan di client. Di-cache per chip status supaya
    // gak fetch ulang tiap ganti halaman/tambah-hapus filter dalam chip yang sama.
    if (produkAllRowsCache.key !== produkActiveFilter || !produkAllRowsCache.rows) {
      let query = sb.from('produk').select(PRODUK_LIST_COLUMNS);
      query = applyProdukFilterToQuery(query, produkActiveFilter);
      const { data, error } = await query.order('updated_at', { ascending: false }).limit(20000);
      if (error) { tableBody.innerHTML = `<tr class="state-row"><td colspan="5">Gagal memuat: ${escapeHtml(error.message)}</td></tr>`; return; }
      produkAllRowsCache = { key: produkActiveFilter, rows: data || [] };
    }
    let filtered = produkAllRowsCache.rows;
    produkActiveFilters.forEach(f => { filtered = filtered.filter(r => produkRowMatchesFilter(r, f)); });
    produkCurrentFilteredFull = filtered;
    total = filtered.length;
    rows = filtered.slice((produkPage - 1) * PRODUK_PAGE_SIZE, produkPage * PRODUK_PAGE_SIZE);
  } else {
    produkCurrentFilteredFull = null;
    const from = (produkPage - 1) * PRODUK_PAGE_SIZE;
    const to = from + PRODUK_PAGE_SIZE - 1;
    let query = sb.from('produk')
      .select(PRODUK_LIST_COLUMNS, { count: 'exact' });
    query = applyProdukFilterToQuery(query, produkActiveFilter);
    const { data, error, count } = await query
      .order('updated_at', { ascending: false })
      .range(from, to);
    if (error) { tableBody.innerHTML = `<tr class="state-row"><td colspan="5">Gagal memuat: ${escapeHtml(error.message)}</td></tr>`; return; }
    rows = data || [];
    total = count || 0;
  }

 produkCount.textContent = total + ' produk' + (qq ? ` untuk "${qq}"` : '') +
    (produkActiveFilters.length ? ` · ${produkActiveFilters.length} filter tambahan aktif` : '');
  renderPgBar(document.getElementById('produkPagination'), {
    page: produkPage, pageSize: PRODUK_PAGE_SIZE, total,
    onPageChange: (p) => loadProduk(qq, p)
  });

  if (rows.length === 0) {
    tableBody.innerHTML = `<tr class="state-row"><td colspan="5">Tidak ada produk ditemukan.</td></tr>`;
    cardWrap.innerHTML = `<div class="stub-box" style="grid-column:1/-1;">Tidak ada produk ditemukan.</div>`;
    return;
  }

  // Cek ketersediaan harga KHUSUS untuk baris yang lagi tampil di halaman ini
  // (bukan semua produk) — biar ringan, query kecil nempel ke tiap ganti halaman.
  // Dipakai buat kasih visual cue "butuh perhatian" di tabel/card, bukan buat
  // nampilin nominal harganya (itu tetap di modal edit / tab Pricing).
  const idsOnPage = rows.map(p => p.id);
  let hargaExistIds = new Set();
  if (idsOnPage.length) {
    const { data: hargaRows } = await sb.from('produk_harga').select('produk_id').in('produk_id', idsOnPage);
    hargaExistIds = new Set((hargaRows || []).map(h => h.produk_id));
  }
  const ONE_DAY = 24 * 60 * 60 * 1000;
  function attentionMeta(p){
    const noHarga = !hargaExistIds.has(p.id);
    const noLink = p.status_inaproc === 'Disetujui' && !p.link_v6;
    const recentlyUpdated = p.updated_at && (Date.now() - new Date(p.updated_at).getTime()) < ONE_DAY;
    return { noHarga, noLink, recentlyUpdated };
  }

  tableBody.innerHTML = '';
  cardWrap.innerHTML = '';
  rows.forEach(p => {
    const { noHarga, noLink, recentlyUpdated } = attentionMeta(p);
    const noLinkIcon = noLink ? '<i class="ti ti-link-off" title="Disetujui INAPROC, belum ada Link V6" style="color:var(--rust-text);"></i>' : '';
    const tr = document.createElement('tr');
    tr.className = 'clickable' + (noHarga || noLink ? ' row-attention' : '');
    tr.innerHTML = `
      <td class="kode-cell">${escapeHtml(p.kode_produk)}${recentlyUpdated ? '<span class="dot-updated" title="Diubah dalam 24 jam terakhir"></span>' : ''}</td>
      <td>${escapeHtml(p.nama_produk || '—')}</td>
      <td><span class="tipe-chip">${escapeHtml(p.tipe || '—')}</span></td>
      <td>${sealHtml(p.status_akd)} ${noLinkIcon}</td>
      <td style="text-align:right;color:var(--text-muted);">${noHarga ? '<i class="ti ti-currency-dollar-off" title="Belum ada harga"></i>' : ''}${p.is_active ? '' : ' <i class="ti ti-eye-off" title="Nonaktif"></i>'}</td>
    `;
    tr.addEventListener('click', () => { if (p.tipe === 'SET') { goToSetDetail(p.id); } else { openEdit(p.id); } });
    tableBody.appendChild(tr);

    const card = document.createElement('div');
    card.className = 'prod-card' + (noHarga || noLink ? ' row-attention' : '');
    card.innerHTML = `
      <div class="pc-kode">${escapeHtml(p.kode_produk)}${recentlyUpdated ? '<span class="dot-updated" title="Diubah dalam 24 jam terakhir"></span>' : ''}</div>
      <div class="pc-nama">${escapeHtml(p.nama_produk || '—')}</div>
      <div class="pc-foot"><span class="tipe-chip">${escapeHtml(p.tipe || '—')}</span>${sealHtml(p.status_akd)}${noLinkIcon}${noHarga ? '<i class="ti ti-currency-dollar-off" title="Belum ada harga" style="color:var(--amber);margin-left:4px;"></i>' : ''}</div>
    `;
    card.addEventListener('click', () => { if (p.tipe === 'SET') { goToSetDetail(p.id); } else { openEdit(p.id); } });
    cardWrap.appendChild(card);
  });
}

// ---- Klik chip filter status di atas list Produk ----
document.querySelectorAll('#produkFilterBar .filter-chip').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.filter === produkActiveFilter) return;
    produkActiveFilter = btn.dataset.filter;
    document.querySelectorAll('#produkFilterBar .filter-chip').forEach(b => b.classList.toggle('active', b === btn));
    loadProduk(lastQuery, 1);
  });
});

// ---- Filter builder ("+ Tambah Filter") — sama pola kayak yang dulu ada di AKD,
// cuma dimensinya properti Produk (golongan, tipe, aktif/nonaktif, status INAPROC,
// ketersediaan harga), dan ditumpuk di atas chip status + search yang lagi aktif.
const produkAddFilterBtn = document.getElementById('produkAddFilterBtn');
const produkAddFilterPop = document.getElementById('produkAddFilterPop');
produkAddFilterBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  renderProdukFilterPopStep1();
  produkAddFilterPop.classList.toggle('open');
});
document.addEventListener('click', (e) => {
  if (produkAddFilterPop.classList.contains('open') && !produkAddFilterPop.contains(e.target) && e.target !== produkAddFilterBtn) {
    produkAddFilterPop.classList.remove('open');
  }
});
function renderProdukFilterPopStep1(){
  produkAddFilterPop.innerHTML = `<div class="afp-step">
    <div class="afp-title">Pilih dimensi filter</div>
    ${PRODUK_FILTER_DIMS.map(d => `<button class="afp-dim-btn" data-dim="${d.key}"><span>${escapeHtml(d.label)}</span><i class="ti ti-chevron-right"></i></button>`).join('')}
  </div>`;
  produkAddFilterPop.querySelectorAll('.afp-dim-btn').forEach(b => {
    b.addEventListener('click', (e) => { e.stopPropagation(); renderProdukFilterPopStep2(b.dataset.dim); });
  });
}
function renderProdukFilterPopStep2(dimKey){
  const dim = PRODUK_FILTER_DIMS.find(d => d.key === dimKey);
  let options = dim.options;
  if (dim.dynamic) {
    options = (produkDistinct[dim.dynamic] || []).map(v => ({ value: v, label: v }));
    if (!options.length) options = [{ value: '', label: '(belum ada data terisi)' }];
  }

  if (dim.multi) {
    // Pilih banyak nilai sekaligus dalam satu dimensi (misal Tipe: SET + INSTRUMENT)
    // -> hasil filter di-OR-kan di antara nilai yang dicentang, lalu di-AND-kan
    // seperti biasa dengan dimensi/chip status lain. Prefill centang dari filter
    // yang lagi aktif kalau user buka ulang dimensi yang sama buat diubah.
    const existing = produkActiveFilters.find(f => f.dim === dimKey);
    const selected = new Set(existing?.values || []);
    produkAddFilterPop.innerHTML = `<div class="afp-step">
      <div class="afp-back" id="produkAfpBack"><i class="ti ti-arrow-left"></i> Kembali</div>
      <div class="afp-title">${escapeHtml(dim.label)} <span style="text-transform:none;font-weight:400;">(bisa pilih lebih dari satu)</span></div>
      ${options.map(o => `<label class="afp-check-row${o.value === '' ? ' disabled' : ''}">
          <input type="checkbox" data-value="${escapeHtml(o.value)}" ${selected.has(o.value) ? 'checked' : ''} ${o.value === '' ? 'disabled' : ''}/>
          <span>${escapeHtml(o.label)}</span>
        </label>`).join('')}
      <button class="afp-apply-btn" id="produkAfpApply">Terapkan</button>
    </div>`;
    document.getElementById('produkAfpBack').addEventListener('click', (e) => { e.stopPropagation(); renderProdukFilterPopStep1(); });
    document.getElementById('produkAfpApply').addEventListener('click', (e) => {
      e.stopPropagation();
      const values = Array.from(produkAddFilterPop.querySelectorAll('input[type="checkbox"]:checked')).map(c => c.dataset.value);
      if (values.length === 0) {
        removeProdukFilter(dimKey);
      } else {
        const labels = values.map(v => (options.find(o => o.value === v) || {}).label || v);
        addProdukFilterMulti(dimKey, values, dim.label + ': ' + labels.join(', '));
      }
      produkAddFilterPop.classList.remove('open');
    });
    return;
  }

  produkAddFilterPop.innerHTML = `<div class="afp-step">
    <div class="afp-back" id="produkAfpBack"><i class="ti ti-arrow-left"></i> Kembali</div>
    <div class="afp-title">${escapeHtml(dim.label)}</div>
    ${options.map(o => `<button class="afp-dim-btn" data-value="${escapeHtml(o.value)}" ${o.value === '' ? 'disabled' : ''}>${escapeHtml(o.label)}</button>`).join('')}
  </div>`;
  document.getElementById('produkAfpBack').addEventListener('click', (e) => { e.stopPropagation(); renderProdukFilterPopStep1(); });
  produkAddFilterPop.querySelectorAll('.afp-dim-btn[data-value]:not([disabled])').forEach(b => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      addProdukFilter(dimKey, b.dataset.value, dim.label + ': ' + b.textContent.trim());
      produkAddFilterPop.classList.remove('open');
    });
  });
}
function addProdukFilter(dim, value, label){
  produkActiveFilters = produkActiveFilters.filter(f => f.dim !== dim); // satu dimensi = satu nilai aktif, ganti kalau dipilih ulang
  produkActiveFilters.push({ dim, value, label });
  renderProdukFilterChips();
  loadProduk(lastQuery, 1);
}
function addProdukFilterMulti(dim, values, label){
  produkActiveFilters = produkActiveFilters.filter(f => f.dim !== dim);
  produkActiveFilters.push({ dim, values, label });
  renderProdukFilterChips();
  loadProduk(lastQuery, 1);
}
function removeProdukFilter(dim){
  produkActiveFilters = produkActiveFilters.filter(f => f.dim !== dim);
  renderProdukFilterChips();
  loadProduk(lastQuery, 1);
}
function renderProdukFilterChips(){
  const el = document.getElementById('produkFilterChips');
  el.innerHTML = produkActiveFilters.map(f => `<span class="adv-filter-chip" data-dim="${f.dim}">${escapeHtml(f.label)}<button title="Hapus filter ini"><i class="ti ti-x"></i></button></span>`).join('');
  el.querySelectorAll('.adv-filter-chip button').forEach(btn => {
    btn.addEventListener('click', () => removeProdukFilter(btn.parentElement.dataset.dim));
  });
}

// ---- Download Excel (hasil filter yang lagi aktif — chip status + filter tambahan
// + search, bukan cuma halaman yang lagi tampil) ----
async function exportProdukToExcel(){
  const needsHarga = produkActiveFilters.some(f => f.dim === 'harga');
  if (needsHarga) await ensureProdukHargaSet();

  let rowsToExport;
  if (lastQuery.trim() || produkActiveFilters.length > 0) {
    rowsToExport = produkCurrentFilteredFull || [];
  } else {
    let query = sb.from('produk').select(PRODUK_LIST_COLUMNS);
    query = applyProdukFilterToQuery(query, produkActiveFilter);
    const { data, error } = await query.order('updated_at', { ascending: false }).limit(20000);
    if (error) { showToast('Gagal export: ' + error.message, true); return; }
    rowsToExport = data || [];
  }
  if (!rowsToExport.length) { showToast('Tidak ada data untuk diexport', true); return; }
  await ensureProdukHargaSet();
  const sheetData = rowsToExport.map(r => ({
    'Kode Produk': r.kode_produk || '',
    'Nama Produk': r.nama_produk || '',
    'Tipe': r.tipe || '',
    'Golongan': r.golongan || '',
    'Status AKD': SEAL_LABELS[r.status_akd] || r.status_akd || '',
    'Status INAPROC': r.status_inaproc || '',
    'Link V6': r.link_v6 || '',
    'Aktif': r.is_active ? 'Ya' : 'Tidak',
    'Sudah Ada Harga': produkHargaIdSet.has(r.id) ? 'Ya' : 'Tidak',
  }));
  const ws = XLSX.utils.json_to_sheet(sheetData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Produk');
  const dateStr = new Date().toISOString().slice(0, 10);
  const filterTag = (produkActiveFilter !== 'all' ? '_' + produkActiveFilter : '') +
    (produkActiveFilters.length ? '_' + produkActiveFilters.map(f => f.dim).join('-') : '') +
    (lastQuery.trim() ? '_search' : '');
  XLSX.writeFile(wb, `produk_export_${dateStr}${filterTag || '_semua'}.xlsx`);
  showToast(`Excel terdownload — ${rowsToExport.length} baris`);
}
document.getElementById('produkExportBtn').addEventListener('click', exportProdukToExcel);

// ---- Angka di tiap chip (total per kategori, independen dari search/pagination) ----
async function refreshProdukFilterCounts(){
  const defs = [
    ['all', q => q],
    ['belum_diajukan', q => q.eq('status_akd', 'belum_diajukan')],
    ['belum_firm', q => q.eq('status_akd', 'belum_firm')],
    ['di_luar_cakupan', q => q.eq('status_akd', 'di_luar_cakupan')],
    ['terhubung', q => q.eq('status_akd', 'terhubung')],
    ['disetujui_tanpa_link', q => q.eq('status_inaproc', 'Disetujui').is('link_v6', null)],
  ];
  const results = await Promise.all(defs.map(([key, apply]) =>
    apply(sb.from('produk').select('id', { count: 'exact', head: true }))
      .then(r => [key, r.error ? null : (r.count ?? 0)])
  ));
  results.forEach(([key, count]) => {
    const el = document.getElementById('fc-' + key);
    if (el) el.textContent = count === null ? '' : ` · ${count}`;
  });
}

// debounce search dari topbar? -> topbar sekarang cuma trigger command palette,
// browsing halaman utama pakai default list (tanpa query) + refresh tiap buka.
loadProduk('');
refreshProdukFilterCounts();
loadProdukDistinctValues();

// ================================================================
// COMMAND PALETTE (⌘K) — search pakai RPC yang sama
// ================================================================
const cmdkOverlay = document.getElementById('cmdkOverlay');
const cmdkInput = document.getElementById('cmdkInput');
const cmdkList = document.getElementById('cmdkList');
const cmdkTrigger = document.getElementById('cmdkTrigger');
let cmdkResults = [];
let cmdkActiveIdx = -1;
let cmdkTimer = null;

function openCmdk(){
  cmdkOverlay.classList.add('open');
  cmdkInput.value = '';
  cmdkList.innerHTML = '<div class="cmdk-empty">Ketik untuk mencari produk...</div>';
  cmdkResults = []; cmdkActiveIdx = -1;
  setTimeout(() => cmdkInput.focus(), 30);
}
function closeCmdk(){ cmdkOverlay.classList.remove('open'); }
cmdkTrigger.addEventListener('click', openCmdk);
cmdkOverlay.addEventListener('click', e => { if (e.target === cmdkOverlay) closeCmdk(); });
document.getElementById('cmdkCloseBtn').addEventListener('click', closeCmdk);

document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openCmdk(); }
  if (e.key === 'Escape' && cmdkOverlay.classList.contains('open')) closeCmdk();
});

cmdkInput.addEventListener('input', () => {
  clearTimeout(cmdkTimer);
  const q = cmdkInput.value.trim();
  if (!q) { cmdkList.innerHTML = '<div class="cmdk-empty">Ketik untuk mencari produk...</div>'; cmdkResults = []; return; }
  cmdkTimer = setTimeout(async () => {
    const { data, error } = await sb.rpc('search_produk_dengan_harga', { q, p_tipe: null, only_akd: false, only_kfa: false });
    if (error) { cmdkList.innerHTML = `<div class="cmdk-empty">Gagal mencari: ${escapeHtml(error.message)}</div>`; return; }
    cmdkResults = (data || []).slice(0, 10);
    cmdkActiveIdx = cmdkResults.length ? 0 : -1;
    renderCmdkList();
  }, 220);
});

function renderCmdkList(){
  if (cmdkResults.length === 0) { cmdkList.innerHTML = '<div class="cmdk-empty">Tidak ada produk ditemukan.</div>'; return; }
  cmdkList.innerHTML = '';
  cmdkResults.forEach((r, idx) => {
    const el = document.createElement('div');
    el.className = 'cmdk-item' + (idx === cmdkActiveIdx ? ' active' : '');
    el.innerHTML = `<span class="ci-kode">${escapeHtml(r.kode_produk)}</span><span class="ci-nama">${escapeHtml(r.nama_produk || '—')}</span><span class="tipe-chip">${escapeHtml(r.tipe || '')}</span>`;
    el.addEventListener('click', () => selectCmdkResult(idx));
    cmdkList.appendChild(el);
  });
}
async function selectCmdkResult(idx){
  const r = cmdkResults[idx];
  if (!r) return;
  const { data, error } = await sb.from('produk').select('id').eq('kode_produk', r.kode_produk).single();
  if (error || !data) { showToast('Gagal membuka produk', true); return; }
  closeCmdk();
  if (r.tipe === 'SET') { goToSetDetail(data.id); } else { openEdit(data.id); }
}
cmdkInput.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { e.preventDefault(); cmdkActiveIdx = Math.min(cmdkActiveIdx + 1, cmdkResults.length - 1); renderCmdkList(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); cmdkActiveIdx = Math.max(cmdkActiveIdx - 1, 0); renderCmdkList(); }
  else if (e.key === 'Enter') { e.preventDefault(); if (cmdkActiveIdx >= 0) selectCmdkResult(cmdkActiveIdx); }
});

// ---- Modal open/close ----
const modalOverlay = document.getElementById('modalOverlay');
const modalTitle = document.getElementById('modalTitle');
const modalSub = document.getElementById('modalSub');
const hargaSection = document.getElementById('hargaSection');
const mediaSection = document.getElementById('mediaSection');
const deleteBtn = document.getElementById('deleteBtn');

document.getElementById('addBtn').addEventListener('click', openAdd);
document.getElementById('cancelBtn').addEventListener('click', attemptCloseModal);
document.getElementById('modalCloseBtn').addEventListener('click', attemptCloseModal);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) attemptCloseModal(); });

function closeModal(){ modalOverlay.classList.remove('open'); }

// ---- Unsaved changes guard — dipakai di modal edit produk (form yang sama
// juga dipakai buat "Set Baru" & "Edit Info Dasar" di Set Management, jadi
// otomatis kepakai di sana juga). Composition/Pricing/AKD di tab Set Detail
// TIDAK butuh guard ini karena tiap perubahan di situ sudah auto-save
// langsung ke database (lihat hint "tersimpan otomatis" di UI-nya). ----
let modalDirty = false;
const unsavedConfirmOverlay = document.getElementById('unsavedConfirmOverlay');
document.querySelector('#modalOverlay .modal-card').addEventListener('input', () => { modalDirty = true; });
document.querySelector('#modalOverlay .modal-card').addEventListener('change', () => { modalDirty = true; });

function attemptCloseModal(){
  if (modalDirty) { unsavedConfirmOverlay.classList.add('open'); return; }
  closeModal();
}
document.getElementById('unsavedStayBtn').addEventListener('click', () => {
  unsavedConfirmOverlay.classList.remove('open'); // balik ke form, gak jadi nutup
});
document.getElementById('unsavedDiscardBtn').addEventListener('click', () => {
  modalDirty = false;
  unsavedConfirmOverlay.classList.remove('open');
  closeModal(); // buang perubahan, form kebuang pas openAdd/openEdit berikutnya
});
document.getElementById('unsavedSaveBtn').addEventListener('click', async (e) => {
  e.currentTarget.disabled = true;
  const ok = await saveProduk();
  e.currentTarget.disabled = false;
  unsavedConfirmOverlay.classList.remove('open');
  if (ok) { modalDirty = false; closeModal(); }
  // kalau gagal (mis. validasi kode produk kosong), dialog konfirmasi ketutup
  // tapi modal edit tetap kebuka dengan toast error-nya — user bisa benerin.
});
// Nutup tab/refresh browser padahal masih ada perubahan yang belum disimpan
window.addEventListener('beforeunload', (e) => {
  if (modalOverlay.classList.contains('open') && modalDirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});

function resetForm(){
  modalDirty = false;
  document.getElementById('inaprocIndikator').style.display = 'none';
  ['f_kode_asli','f_kode_produk','f_nama_produk','f_no_akd','f_masa_berlaku','f_golongan',
   'f_kode_kfa','f_kode_cangkang','f_nama_cangkang','f_berat_gram','f_status_v6','f_link_v6',
   'f_spesifikasi','m_deskripsi_vendor','m_family','m_sub_family','m_manufacturer','m_capital'
  ].forEach(id => document.getElementById(id).value = '');
  document.getElementById('f_tipe').value = '';
  document.getElementById('f_is_active').checked = true;
  document.getElementById('masterFields').style.display = 'none';
  document.getElementById('masterLookupMsg').innerHTML = '';
  masterExists = false;
  hargaRows = []; renderHargaTable();
  mediaRows = []; renderMediaTable();
  currentAkdLinks = []; renderAkdCurrent();
  document.getElementById('akdBox').style.display = 'none';
  document.getElementById('akdSearchInput').value = '';
  document.getElementById('akdResults').innerHTML = '';
  document.getElementById('akdSealHolder').innerHTML = '';
  document.getElementById('md_judul').value = '';
  document.getElementById('md_url').value = '';
  document.getElementById('md_urutan').value = 1;
  document.getElementById('md_primary').checked = false;
  document.getElementById('md_jenis').value = 'brosur';
  document.getElementById('gambarInstrumenSection').style.display = 'none';
  document.getElementById('gambarInstrumenPreviewWrap').style.display = 'none';
}

function openAdd(){
  resetForm();
  currentProdukId = null;
  modalTitle.textContent = 'Tambah Produk';
  modalSub.textContent = 'Isi data produk baru';
  hargaSection.style.display = 'none';
  mediaSection.style.display = 'none';
  deleteBtn.style.display = 'none';
  document.getElementById('toggleAkdBoxBtn').style.display = 'none';
  document.getElementById('akdHint').textContent = 'Simpan produk dulu sebelum mengelola relasi AKD.';
  modalOverlay.classList.add('open');
}

async function openEdit(produkId){
  resetForm();
  currentProdukId = produkId;
  modalTitle.textContent = 'Edit Produk';
  modalSub.textContent = 'Memuat data...';
  hargaSection.style.display = 'block';
  mediaSection.style.display = 'block';
  deleteBtn.style.display = 'inline-flex';
  document.getElementById('toggleAkdBoxBtn').style.display = 'inline-flex';
  modalOverlay.classList.add('open');

  const { data: p, error } = await sb.from('produk').select('*').eq('id', produkId).single();
  if (error) { showToast('Gagal memuat produk: ' + error.message, true); closeModal(); return; }

  document.getElementById('f_kode_asli').value = p.kode_asli || '';
  document.getElementById('f_kode_produk').value = p.kode_produk || '';
  document.getElementById('f_nama_produk').value = p.nama_produk || '';
  document.getElementById('f_tipe').value = p.tipe || '';
  document.getElementById('f_no_akd').value = p.no_akd || '';
  document.getElementById('f_masa_berlaku').value = p.masa_berlaku || '';
  document.getElementById('f_golongan').value = p.golongan || '';
  document.getElementById('f_kode_kfa').value = p.kode_kfa || '';
  document.getElementById('f_kode_cangkang').value = p.kode_cangkang || '';
  document.getElementById('f_nama_cangkang').value = p.nama_cangkang || '';
  document.getElementById('f_berat_gram').value = p.berat_gram ?? '';
  document.getElementById('f_status_v6').value = p.status_v6 || '';
  document.getElementById('f_link_v6').value = p.link_v6 || '';
  renderInaprocIndikator(p.status_inaproc, p.link_v6);
  document.getElementById('f_spesifikasi').value = p.spesifikasi || '';
  document.getElementById('f_is_active').checked = !!p.is_active;
  document.getElementById('akdSealHolder').innerHTML = sealHtml(p.status_akd);
  modalSub.textContent = 'Kode: ' + (p.kode_produk || '—');

  if (p.kode_asli) await cekMaster(p.kode_asli, true);
  await loadHarga(produkId);
  await loadMedia(produkId);
  await loadAkdLinks(produkId, p.tipe);
}

// ---- Master produk lookup ----
document.getElementById('cekMasterBtn').addEventListener('click', () => {
  const kode = document.getElementById('f_kode_asli').value.trim();
  if (!kode) { showToast('Isi kode_asli dulu', true); return; }
  cekMaster(kode, false);
});
async function cekMaster(kodeAsli, silent){
  const msgEl = document.getElementById('masterLookupMsg');
  const fieldsEl = document.getElementById('masterFields');
  if (!silent) msgEl.innerHTML = `<div class="lookup-msg">Mencari...</div>`;
  const { data, error } = await sb.from('master_produk').select('*').eq('kode_asli', kodeAsli).maybeSingle();
  if (error) { msgEl.innerHTML = `<div class="lookup-msg notfound">Gagal cek: ${escapeHtml(error.message)}</div>`; return; }
  fieldsEl.style.display = 'block';
  if (data) {
    masterExists = true;
    document.getElementById('m_deskripsi_vendor').value = data.deskripsi_vendor || '';
    document.getElementById('m_family').value = data.family || '';
    document.getElementById('m_sub_family').value = data.sub_family || '';
    document.getElementById('m_manufacturer').value = data.manufacturer || '';
    document.getElementById('m_capital').value = data.capital || '';
    msgEl.innerHTML = `<div class="lookup-msg found"><i class="ti ti-check"></i> Ditemukan di master_produk, data terisi otomatis.</div>`;
  } else {
    masterExists = false;
    msgEl.innerHTML = `<div class="lookup-msg notfound"><i class="ti ti-alert-triangle"></i> Belum ada — isi field di bawah untuk buat master baru.</div>`;
  }
  await checkGambarInstrumen();
}

// ================================================================
// GAMBAR INSTRUMEN — cek bucket 'thumbnails' by kode_asli.png, upload kalau belum ada.
// Bucket-nya udah public buat DIBACA (GET file langsung bypass RLS), tapi list & upload
// tetep lewat Storage API yang kena RLS storage.objects -> perlu policy select/insert/update
// khusus bucket ini (lihat catatan migrasi terpisah).
// ================================================================
const GAMBAR_BUCKET = 'thumbnails';
function gambarInstrumenFilename(kodeAsli){ return `${kodeAsli}.png`; }

async function checkGambarInstrumen(){
  const tipe = document.getElementById('f_tipe').value;
  const kodeAsli = document.getElementById('f_kode_asli').value.trim();
  const section = document.getElementById('gambarInstrumenSection');
  const badge = document.getElementById('gambarInstrumenBadge');
  const hint = document.getElementById('gambarInstrumenHint');
  const previewWrap = document.getElementById('gambarInstrumenPreviewWrap');
  const uploadBtn = document.getElementById('gambarInstrumenUploadBtn');

  if (tipe !== 'INSTRUMENT' || !kodeAsli) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  badge.className = 'status-pill neutral';
  badge.textContent = 'Mengecek...';
  hint.textContent = '';
  previewWrap.style.display = 'none';

  const filename = gambarInstrumenFilename(kodeAsli);
  const { data, error } = await sb.storage.from(GAMBAR_BUCKET).list('', { search: kodeAsli });
  if (error) {
    badge.className = 'status-pill bad';
    badge.textContent = 'Gagal cek bucket';
    hint.textContent = error.message;
    uploadBtn.innerHTML = '<i class="ti ti-upload"></i> Upload Gambar';
    return;
  }
  const found = (data || []).some(f => f.name === filename);
  if (found) {
    badge.className = 'status-pill ok';
    badge.innerHTML = '<i class="ti ti-check"></i> Ada di bucket';
    hint.textContent = filename;
    previewWrap.style.display = '';
    document.getElementById('gambarInstrumenPreview').src = THUMB_BASE + filename + '?t=' + Date.now();
    uploadBtn.innerHTML = '<i class="ti ti-refresh"></i> Ganti Gambar';
  } else {
    badge.className = 'status-pill warn';
    badge.innerHTML = '<i class="ti ti-alert-triangle"></i> Belum ada gambar';
    hint.textContent = `Bakal disimpan sebagai ${filename}`;
    uploadBtn.innerHTML = '<i class="ti ti-upload"></i> Upload Gambar';
  }
}

document.getElementById('gambarInstrumenUploadBtn').addEventListener('click', () => {
  const kodeAsli = document.getElementById('f_kode_asli').value.trim();
  if (!kodeAsli) { showToast('Isi & cek kode_asli dulu', true); return; }
  document.getElementById('gambarInstrumenFileInput').click();
});

document.getElementById('gambarInstrumenFileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (file.type !== 'image/png') { showToast('File harus format PNG', true); return; }
  const kodeAsli = document.getElementById('f_kode_asli').value.trim();
  if (!kodeAsli) { showToast('Isi & cek kode_asli dulu', true); return; }
  const filename = gambarInstrumenFilename(kodeAsli);
  const badge = document.getElementById('gambarInstrumenBadge');
  badge.className = 'status-pill neutral';
  badge.textContent = 'Mengupload...';
  const { error } = await sb.storage.from(GAMBAR_BUCKET).upload(filename, file, { upsert: true, contentType: 'image/png' });
  if (error) { showToast('Gagal upload: ' + error.message, true); await checkGambarInstrumen(); return; }
  showToast('Gambar instrumen berhasil diupload');
  await checkGambarInstrumen();
});

document.getElementById('f_tipe').addEventListener('change', checkGambarInstrumen);

// ================================================================
// KELOLA AKD — link/unlink produk_akd, cari di tabel akd sesuai tipe
// ================================================================
const toggleAkdBoxBtn = document.getElementById('toggleAkdBoxBtn');
const akdBox = document.getElementById('akdBox');
toggleAkdBoxBtn.addEventListener('click', () => {
  akdBox.style.display = akdBox.style.display === 'none' ? 'block' : 'none';
});

async function loadAkdLinks(produkId, tipe){
  const { data, error } = await sb.from('produk_akd')
    .select('akd_id, akd:akd_id(id, no_akd, nama_akd, tipe_akd)')
    .eq('produk_id', produkId);
  if (error) { document.getElementById('akdHint').textContent = 'Gagal memuat relasi AKD: ' + error.message; return; }
  currentAkdLinks = (data || []).map(r => r.akd).filter(Boolean);
  renderAkdCurrent();
  const mapped = TIPE_TO_AKD[tipe];
  document.getElementById('akdHint').textContent = mapped
    ? `Pencarian dibatasi ke AKD tipe "${mapped}" (sesuai tipe produk "${tipe}").`
    : 'Pilih Tipe produk dulu supaya pencarian AKD terarah.';
}

function renderAkdCurrent(){
  const el = document.getElementById('akdCurrentList');
  if (currentAkdLinks.length === 0) {
    el.innerHTML = `<div class="akd-empty">Belum ada AKD terhubung ke produk ini.</div>`;
    return;
  }
  el.innerHTML = '';
  currentAkdLinks.forEach(a => {
    const chip = document.createElement('div');
    chip.className = 'akd-chip';
    chip.innerHTML = `<span class="ac-no">${escapeHtml(a.no_akd)}</span><span class="ac-nama">${escapeHtml(a.nama_akd || '')}</span><button title="Lepas relasi"><i class="ti ti-x"></i></button>`;
    chip.querySelector('button').addEventListener('click', () => unlinkAkd(a.id));
    el.appendChild(chip);
  });
}

async function unlinkAkd(akdId){
  if (!currentProdukId) return;
  if (!confirm('Lepas relasi AKD ini dari produk?')) return;
  const { error } = await sb.from('produk_akd').delete().eq('produk_id', currentProdukId).eq('akd_id', akdId);
  if (error) { showToast('Gagal melepas relasi: ' + error.message, true); return; }
  showToast('Relasi AKD dilepas');
  const tipe = document.getElementById('f_tipe').value;
  await loadAkdLinks(currentProdukId, tipe);
  await refreshAkdFieldsFromDb();
}

let akdSearchTimer = null;
document.getElementById('akdSearchInput').addEventListener('input', () => {
  clearTimeout(akdSearchTimer);
  const q = document.getElementById('akdSearchInput').value.trim();
  const resEl = document.getElementById('akdResults');
  if (!q) { resEl.innerHTML = ''; return; }
  akdSearchTimer = setTimeout(async () => {
    const tipe = document.getElementById('f_tipe').value;
    const mapped = TIPE_TO_AKD[tipe];
    let query = sb.from('akd').select('id, no_akd, nama_akd, tipe_akd').or(`no_akd.ilike.%${q}%,nama_akd.ilike.%${q}%`).limit(15);
    if (mapped) query = query.eq('tipe_akd', mapped);
    const { data, error } = await query;
    if (error) { resEl.innerHTML = `<div class="akd-empty">Gagal mencari: ${escapeHtml(error.message)}</div>`; return; }
    if (!data || data.length === 0) { resEl.innerHTML = `<div class="akd-empty">Tidak ditemukan.</div>`; return; }
    resEl.innerHTML = '';
    data.forEach(a => {
      const row = document.createElement('div');
      row.className = 'akd-result-row';
      row.innerHTML = `<span class="ar-no">${escapeHtml(a.no_akd)}</span><span class="ar-nama">${escapeHtml(a.nama_akd || '')}</span>`;
      row.addEventListener('click', () => linkAkd(a.id));
      resEl.appendChild(row);
    });
  }, 250);
});

async function linkAkd(akdId){
  if (!currentProdukId) { showToast('Simpan produk dulu sebelum menghubungkan AKD', true); return; }
  const { error } = await sb.from('produk_akd').insert({ produk_id: currentProdukId, akd_id: akdId, is_primary: true });
  if (error) {
    if (error.code === '23505') { showToast('AKD ini sudah terhubung ke produk ini'); return; }
    showToast('Gagal menghubungkan AKD: ' + error.message, true); return;
  }
  showToast('AKD terhubung');
  document.getElementById('akdSearchInput').value = '';
  document.getElementById('akdResults').innerHTML = '';
  const tipe = document.getElementById('f_tipe').value;
  await loadAkdLinks(currentProdukId, tipe);
  await refreshAkdFieldsFromDb();
}

async function refreshAkdFieldsFromDb(){
  const { data: p, error } = await sb.from('produk').select('no_akd, masa_berlaku, golongan, status_akd').eq('id', currentProdukId).single();
  if (error || !p) return;
  document.getElementById('f_no_akd').value = p.no_akd || '';
  document.getElementById('f_masa_berlaku').value = p.masa_berlaku || '';
  document.getElementById('f_golongan').value = p.golongan || '';
  document.getElementById('akdSealHolder').innerHTML = sealHtml(p.status_akd);
}

// ---- Harga ----
async function loadHarga(produkId){
  const { data, error } = await sb.from('produk_harga').select('*').eq('produk_id', produkId).order('tahun', { ascending: false });
  if (error) { showToast('Gagal memuat harga: ' + error.message, true); return; }
  hargaRows = data || [];
  renderHargaTable();
}
function renderHargaTable(){
  const tbody = document.getElementById('hargaTableBody');
  if (hargaRows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="color:var(--text-muted);padding:14px;">Belum ada data harga</td></tr>`;
    return;
  }
  tbody.innerHTML = '';
  hargaRows.forEach(h => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${h.tahun}</td>
      <td>${escapeHtml(h.jenis)}</td>
      <td>Rp ${Number(h.harga).toLocaleString('id-ID')}</td>
      <td><button class="btn btn-danger-ghost btn-sm" data-id="${h.id}"><i class="ti ti-trash"></i></button></td>
    `;
    tr.querySelector('button').addEventListener('click', () => deleteHarga(h.id));
    tbody.appendChild(tr);
  });
}
// ---- Hitung & simpan 3 jenis harga sekaligus dari Harga EKATALOG ----
// SWASTA = EKATALOG x 1.3 ; UPLOAD = EKATALOG / 1.11 (sesuai rumus yang sudah dipakai tim)
async function upsertHargaDariEkat(produkId, tahun, hargaEkat){
  const rows = [
    { jenis: 'EKATALOG', harga: Math.round(hargaEkat) },
    { jenis: 'SWASTA', harga: Math.round(hargaEkat * 1.3) },
    { jenis: 'UPLOAD', harga: Math.round(hargaEkat / 1.11) }
  ];
  for (const r of rows) {
    const { data: existing, error: findErr } = await sb.from('produk_harga')
      .select('id').eq('produk_id', produkId).eq('tahun', tahun).eq('jenis', r.jenis).maybeSingle();
    if (findErr) { showToast('Gagal cek harga ' + r.jenis + ': ' + findErr.message, true); return false; }
    if (existing) {
      const { error } = await sb.from('produk_harga').update({ harga: r.harga }).eq('id', existing.id);
      if (error) { showToast('Gagal update harga ' + r.jenis + ': ' + error.message, true); return false; }
    } else {
      const { error } = await sb.from('produk_harga').insert({ produk_id: produkId, tahun, jenis: r.jenis, harga: r.harga });
      if (error) { showToast('Gagal tambah harga ' + r.jenis + ': ' + error.message, true); return false; }
    }
  }
  return true;
}

document.getElementById('addHargaBtn').addEventListener('click', async () => {
  if (!currentProdukId) { showToast('Simpan data produk dulu sebelum menambah harga', true); return; }
  const tahun = parseInt(document.getElementById('h_tahun').value, 10);
  const hargaEkat = parseFloat(document.getElementById('h_harga').value);
  if (!tahun || isNaN(hargaEkat)) { showToast('Lengkapi tahun dan harga EKATALOG', true); return; }
  const ok = await upsertHargaDariEkat(currentProdukId, tahun, hargaEkat);
  if (!ok) return;
  document.getElementById('h_tahun').value = '';
  document.getElementById('h_harga').value = '';
  showToast('Harga EKATALOG, SWASTA & UPLOAD tersimpan');
  loadHarga(currentProdukId);
});
async function deleteHarga(id){
  if (!confirm('Hapus baris harga ini?')) return;
  const { error } = await sb.from('produk_harga').delete().eq('id', id);
  if (error) { showToast('Gagal hapus: ' + error.message, true); return; }
  showToast('Harga dihapus');
  loadHarga(currentProdukId);
}

// ---- Media ----
async function loadMedia(produkId){
  const { data, error } = await sb.from('produk_media').select('*').eq('produk_id', produkId).order('urutan', { ascending: true });
  if (error) { showToast('Gagal memuat media: ' + error.message, true); return; }
  mediaRows = data || [];
  renderMediaTable();
}
function renderMediaTable(){
  const tbody = document.getElementById('mediaTableBody');
  if (mediaRows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="color:var(--text-muted);padding:14px;">Belum ada media</td></tr>`;
    return;
  }
  tbody.innerHTML = '';
  mediaRows.forEach(m => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(m.jenis)}</td>
      <td>${escapeHtml(m.judul || '—')}</td>
      <td><a class="media-link" href="${escapeHtml(m.url)}" target="_blank" rel="noopener">${escapeHtml(m.url)}</a></td>
      <td>${m.is_primary ? '<span class="badge-primary">Utama</span>' : '—'}</td>
      <td><button class="btn btn-danger-ghost btn-sm" data-id="${m.id}"><i class="ti ti-trash"></i></button></td>
    `;
    tr.querySelector('button').addEventListener('click', () => deleteMedia(m.id));
    tbody.appendChild(tr);
  });
}
document.getElementById('addMediaBtn').addEventListener('click', async () => {
  if (!currentProdukId) { showToast('Simpan data produk dulu sebelum menambah media', true); return; }
  const jenis = document.getElementById('md_jenis').value;
  const judul = document.getElementById('md_judul').value.trim();
  const url = document.getElementById('md_url').value.trim();
  const urutan = parseInt(document.getElementById('md_urutan').value, 10) || 1;
  const is_primary = document.getElementById('md_primary').checked;
  if (!url) { showToast('URL wajib diisi', true); return; }
  const { error } = await sb.from('produk_media').insert({ produk_id: currentProdukId, jenis, judul: judul || null, url, urutan, is_primary });
  if (error) { showToast('Gagal tambah media: ' + error.message, true); return; }
  document.getElementById('md_judul').value = '';
  document.getElementById('md_url').value = '';
  document.getElementById('md_urutan').value = 1;
  document.getElementById('md_primary').checked = false;
  showToast('Media ditambahkan');
  loadMedia(currentProdukId);
});
async function deleteMedia(id){
  if (!confirm('Hapus media ini?')) return;
  const { error } = await sb.from('produk_media').delete().eq('id', id);
  if (error) { showToast('Gagal hapus: ' + error.message, true); return; }
  showToast('Media dihapus');
  loadMedia(currentProdukId);
}

// ---- Save produk ----
async function saveProduk(){
  const kodeAsli = document.getElementById('f_kode_asli').value.trim();
  const kodeProduk = document.getElementById('f_kode_produk').value.trim();
  const tipe = document.getElementById('f_tipe').value;
  if (!kodeProduk || !tipe) { showToast('Kode Produk dan Tipe wajib diisi', true); return false; }

  if (kodeAsli) {
    const { error: mErr } = await sb.from('master_produk').upsert({
      kode_asli: kodeAsli,
      deskripsi_vendor: document.getElementById('m_deskripsi_vendor').value || null,
      family: document.getElementById('m_family').value || null,
      sub_family: document.getElementById('m_sub_family').value || null,
      manufacturer: document.getElementById('m_manufacturer').value || null,
      capital: document.getElementById('m_capital').value || null
    }, { onConflict: 'kode_asli' });
    if (mErr) { showToast('Gagal menyimpan master_produk: ' + mErr.message, true); return false; }
  }

  // no_akd/masa_berlaku/golongan sengaja TIDAK dikirim -> field itu read-only,
  // dikontrol sepenuhnya lewat relasi produk_akd + trigger sync.
  const payload = {
    kode_asli: kodeAsli || null,
    kode_produk: kodeProduk,
    nama_produk: document.getElementById('f_nama_produk').value || null,
    tipe,
    kode_kfa: document.getElementById('f_kode_kfa').value || null,
    kode_cangkang: document.getElementById('f_kode_cangkang').value || null,
    nama_cangkang: document.getElementById('f_nama_cangkang').value || null,
    berat_gram: document.getElementById('f_berat_gram').value || null,
    status_v6: document.getElementById('f_status_v6').value || null,
    link_v6: document.getElementById('f_link_v6').value || null,
    spesifikasi: document.getElementById('f_spesifikasi').value || null,
    is_active: document.getElementById('f_is_active').checked
  };

  let result;
  if (currentProdukId) {
    result = await sb.from('produk').update(payload).eq('id', currentProdukId).select().single();
  } else {
    result = await sb.from('produk').insert(payload).select().single();
  }
  if (result.error) { showToast('Gagal simpan produk: ' + result.error.message, true); return false; }

  showToast(currentProdukId ? 'Produk diperbarui' : 'Produk ditambahkan');
  modalDirty = false; // data form sekarang sudah sama persis dengan yang di database
  currentProdukId = result.data.id;
  hargaSection.style.display = 'block';
  mediaSection.style.display = 'block';
  deleteBtn.style.display = 'inline-flex';
  toggleAkdBoxBtn.style.display = 'inline-flex';
  document.getElementById('akdHint').textContent = 'Simpan berhasil — sekarang kamu bisa hubungkan AKD.';
  modalTitle.textContent = 'Edit Produk';
  modalSub.textContent = 'Kode: ' + result.data.kode_produk;
  await loadHarga(currentProdukId);
  await loadMedia(currentProdukId);
  await loadAkdLinks(currentProdukId, tipe);
  invalidateProdukStackCache();
  loadProduk();
  refreshProdukFilterCounts();
  return true;
}
document.getElementById('saveBtn').addEventListener('click', saveProduk);

// ================================================================
// SET MANAGEMENT
// ================================================================
let currentSetId = null;
let currentSetKode = '';
let compRows = [];
let lastAddedItemRowId = null;

async function goToSetDetail(produkId){
  switchView('set');
  const { data: p, error } = await sb.from('produk').select('id, kode_produk').eq('id', produkId).single();
  if (error || !p) { showToast('Gagal membuka set', true); return; }
  document.getElementById('setListWrap').style.display = 'none';
  document.getElementById('setDetailWrap').style.display = 'block';
  openSetDetail(p.id, p.kode_produk);
}

document.getElementById('addSetBtn').addEventListener('click', () => {
  openAdd();
  document.getElementById('f_tipe').value = 'SET';
});

let setListPage = 1;
const SET_LIST_PAGE_SIZE = 30;

async function loadSetList(page){
  setListPage = page || setListPage || 1;
  const wrap = document.getElementById('setListBody');
  wrap.innerHTML = '<div style="color:var(--text-muted);padding:14px;">Memuat...</div>';
  const from = (setListPage - 1) * SET_LIST_PAGE_SIZE;
  const to = from + SET_LIST_PAGE_SIZE - 1;
  const { data, error, count } = await sb.from('produk_set_ringkasan')
    .select('*', { count: 'exact' })
    .order('kode_produk')
    .range(from, to);
  if (error) { wrap.innerHTML = `<div style="color:var(--rust);padding:14px;">Gagal memuat: ${escapeHtml(error.message)}</div>`; return; }
  const total = count || 0;
  document.getElementById('setListCount').textContent = total + ' set produk';
  renderPgBar(document.getElementById('setListPagination'), {
    page: setListPage, pageSize: SET_LIST_PAGE_SIZE, total,
    onPageChange: (p) => loadSetList(p)
  });
  if (!data || data.length === 0) { wrap.innerHTML = '<div class="stub-box">Belum ada produk tipe SET.</div>'; return; }

  // Sama kayak di list Produk: cek ketersediaan harga khusus buat set yang
  // lagi tampil di halaman ini aja.
  const setIdsOnPage = data.map(s => s.set_id);
  let hargaExistIds = new Set();
  if (setIdsOnPage.length) {
    const { data: hargaRows } = await sb.from('produk_harga').select('produk_id').in('produk_id', setIdsOnPage);
    hargaExistIds = new Set((hargaRows || []).map(h => h.produk_id));
  }
  const ONE_DAY = 24 * 60 * 60 * 1000;

  wrap.innerHTML = '';
  data.forEach(s => {
    const noHarga = !hargaExistIds.has(s.set_id);
    const noItem = !(s.jumlah_jenis_item > 0); // set kosong (belum ada komposisi) — sama pentingnya kayak belum ada harga
    const recentlyUpdated = s.updated_at && (Date.now() - new Date(s.updated_at).getTime()) < ONE_DAY;
    const row = document.createElement('div');
    row.className = 'set-list-row' + ((noHarga || noItem) ? ' row-attention' : '');
    row.innerHTML = `
      <span class="sl-kode">${escapeHtml(s.kode_produk)}${recentlyUpdated ? '<span class="dot-updated" title="Diubah dalam 24 jam terakhir"></span>' : ''}</span>
      <span class="sl-nama">${escapeHtml(s.nama_produk || '—')}</span>
      <span class="sl-meta">${noItem ? '<span style="color:var(--amber);">Belum ada item</span>' : `${s.jumlah_jenis_item} item · qty ${s.total_qty || 0}`}${noHarga ? ' · <span style="color:var(--amber);">belum ada harga</span>' : ''}</span>
      ${sealHtml(s.status_akd)}
    `;
    row.addEventListener('click', () => openSetDetail(s.set_id, s.kode_produk));
    wrap.appendChild(row);
  });
}

document.getElementById('setBackBtn').addEventListener('click', () => {
  document.getElementById('setDetailWrap').style.display = 'none';
  document.getElementById('setListWrap').style.display = 'block';
  loadSetList();
});

async function openSetDetail(setId, kodeProduk){
  currentSetId = setId;
  currentSetKode = kodeProduk;
  document.getElementById('setListWrap').style.display = 'none';
  document.getElementById('setDetailWrap').style.display = 'block';
  switchSetTab('composition');
  await refreshSetHeader();
  await loadComposition();
  await loadSetHarga();
  await loadSetAkd();
  await loadSetHistory();
}

async function refreshSetHeader(){
  const { data: p } = await sb.from('produk').select('*').eq('id', currentSetId).single();
  if (!p) return;
  document.getElementById('setDetailNama').textContent = p.nama_produk || p.kode_produk;
  document.getElementById('setDetailKode').textContent = p.kode_produk;
  document.getElementById('setDetailSeal').innerHTML = sealHtml(p.status_akd);

  const { data: ring } = await sb.from('produk_set_ringkasan').select('*').eq('set_id', currentSetId).maybeSingle();
  document.getElementById('setDetailJumlahItem').textContent = ring?.jumlah_jenis_item || 0;
  document.getElementById('setDetailQty').textContent = ring?.total_qty || 0;

  const { data: hargaRow } = await sb.from('produk_harga').select('harga, jenis, tahun').eq('produk_id', currentSetId)
    .order('tahun', { ascending: false }).limit(1).maybeSingle();
  document.getElementById('setDetailHarga').textContent = hargaRow ? `Rp ${Number(hargaRow.harga).toLocaleString('id-ID')} (${hargaRow.jenis} ${hargaRow.tahun})` : 'Belum ada harga';
}

document.getElementById('editSetOverviewBtn').addEventListener('click', () => openEdit(currentSetId));

// ---- Tabs ----
document.querySelectorAll('.set-tab').forEach(btn => {
  btn.addEventListener('click', () => switchSetTab(btn.dataset.tab));
});
function switchSetTab(tab){
  document.querySelectorAll('.set-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.set-tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + tab));
}

// ---- Composition ----
async function loadComposition(){
  const { data, error } = await sb.from('produk_set_item')
    .select('id, qty, produk_id, item:produk_id(id, kode_produk, nama_produk, berat_gram)')
    .eq('set_id', currentSetId);
  if (error) { document.getElementById('compList').innerHTML = `<div style="color:var(--rust);">Gagal memuat: ${escapeHtml(error.message)}</div>`; return; }
  compRows = (data || []).sort((a,b) => (a.item?.nama_produk || '').localeCompare(b.item?.nama_produk || ''));
  renderComposition();
}
function renderComposition(){
  const wrap = document.getElementById('compList');
  document.getElementById('compJumlahJenis').textContent = compRows.length;
  const totalQty = compRows.reduce((s,r) => s + (r.qty || 0), 0);
  document.getElementById('compTotalQty').textContent = totalQty;
  const estBerat = compRows.reduce((s,r) => s + ((r.item?.berat_gram || 0) * (r.qty || 0)), 0);
  document.getElementById('compEstBerat').textContent = estBerat.toLocaleString('id-ID') + ' g';

  if (compRows.length === 0) { wrap.innerHTML = '<div class="akd-empty">Belum ada item di set ini.</div>'; return; }
  wrap.innerHTML = '';
  compRows.forEach(r => {
    const row = document.createElement('div');
    row.className = 'comp-row';
    row.dataset.rowId = r.id;
    row.innerHTML = `
      <span class="cr-kode">${escapeHtml(r.item?.kode_produk || '—')}</span>
      <span class="cr-nama" data-id="${r.item?.id}">${escapeHtml(r.item?.nama_produk || '—')}</span>
      <input type="number" class="cr-qty" value="${r.qty}" min="1" data-item-row="${r.id}"/>
      <span class="cr-saved-tag" style="display:none;font-size:10.5px;color:var(--teal-ok-text);"><i class="ti ti-check"></i></span>
      <button class="cr-del" data-item-row="${r.id}" title="Hapus item ini">×</button>
    `;
    row.querySelector('.cr-nama').addEventListener('click', () => { if (r.item?.id) openEdit(r.item.id); });
    const qtyInput = row.querySelector('.cr-qty');
    const savedTag = row.querySelector('.cr-saved-tag');
    let lastValue = r.qty;
    let qtyDebounceTimer = null;

    async function commitQty(fromDebounce){
      const val = parseInt(qtyInput.value, 10);
      if (!val || val < 1) {
        if (!fromDebounce) {
          if (confirm('Qty kosong/0 — hapus item ini dari set?')) { deleteCompItem(r.id); }
          else { qtyInput.value = lastValue; }
        }
        return;
      }
      if (val === lastValue) return;
      const { error } = await sb.from('produk_set_item').update({ qty: val }).eq('id', r.id);
      if (error) { showToast('Gagal update qty: ' + error.message, true); qtyInput.value = lastValue; return; }
      lastValue = val;
      r.qty = val;
      qtyInput.classList.add('saved');
      savedTag.style.display = 'inline';
      setTimeout(() => { qtyInput.classList.remove('saved'); savedTag.style.display = 'none'; }, 1200);
      document.getElementById('compTotalQty').textContent = compRows.reduce((s,x) => s + (x.qty || 0), 0);
      document.getElementById('compEstBerat').textContent = compRows.reduce((s,x) => s + ((x.item?.berat_gram || 0) * (x.qty || 0)), 0).toLocaleString('id-ID') + ' g';
      refreshSetHeader();
    }
    // autosave debounced tiap ketik (jaring pengaman kalau user pindah halaman tanpa blur)
    qtyInput.addEventListener('input', () => {
      clearTimeout(qtyDebounceTimer);
      qtyDebounceTimer = setTimeout(() => commitQty(true), 700);
    });
    qtyInput.addEventListener('blur', () => { clearTimeout(qtyDebounceTimer); commitQty(false); });
    qtyInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { clearTimeout(qtyDebounceTimer); qtyInput.blur(); }
      if (e.key === 'Escape') { clearTimeout(qtyDebounceTimer); qtyInput.value = lastValue; qtyInput.blur(); }
    });
    row.querySelector('.cr-del').addEventListener('click', () => {
      if (confirm('Hapus item ini dari set?')) deleteCompItem(r.id);
    });
    wrap.appendChild(row);
  });

  if (lastAddedItemRowId) {
    const el = wrap.querySelector(`[data-row-id="${lastAddedItemRowId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.style.transition = 'background .3s ease';
      el.style.background = 'var(--teal-ok-bg)';
      setTimeout(() => { el.style.background = ''; }, 1500);
    }
    lastAddedItemRowId = null;
  }
}
async function deleteCompItem(rowId){
  const { error } = await sb.from('produk_set_item').delete().eq('id', rowId);
  if (error) { showToast('Gagal hapus item: ' + error.message, true); return; }
  showToast('Item dihapus dari set');
  await loadComposition();
  await refreshSetHeader();
}

let compSearchTimer = null;
document.getElementById('compSearchInput').addEventListener('input', () => {
  clearTimeout(compSearchTimer);
  const q = document.getElementById('compSearchInput').value.trim();
  const resEl = document.getElementById('compSearchResults');
  if (!q) { resEl.innerHTML = ''; return; }
  compSearchTimer = setTimeout(async () => {
    const { data, error } = await sb.rpc('search_produk_dengan_harga', { q, p_tipe: null, only_akd: false, only_kfa: false });
    if (error) { resEl.innerHTML = `<div class="akd-empty">Gagal mencari: ${escapeHtml(error.message)}</div>`; return; }
    const filtered = (data || []).filter(r => r.tipe !== 'SET').slice(0, 10);
    if (filtered.length === 0) { resEl.innerHTML = '<div class="akd-empty">Tidak ditemukan (SET tidak bisa jadi isi set lain).</div>'; return; }
    resEl.innerHTML = '';
    filtered.forEach(r => {
      const row = document.createElement('div');
      row.className = 'akd-result-row';
      row.innerHTML = `<span class="ar-no">${escapeHtml(r.kode_produk)}</span><span class="ar-nama">${escapeHtml(r.nama_produk || '')}</span><span class="tipe-chip">${escapeHtml(r.tipe)}</span>`;
      row.addEventListener('click', () => addCompItem(r.kode_produk));
      resEl.appendChild(row);
    });
  }, 250);
});
async function addCompItem(kodeProduk){
  const { data: item, error: itemErr } = await sb.from('produk').select('id').eq('kode_produk', kodeProduk).single();
  if (itemErr || !item) { showToast('Gagal menemukan produk', true); return; }
  const { data: inserted, error } = await sb.from('produk_set_item').insert({ set_id: currentSetId, produk_id: item.id, qty: 1 }).select('id').single();
  if (error) {
    if (error.code === '23505') { showToast('Item ini sudah ada di set'); return; }
    showToast('Gagal tambah item: ' + error.message, true); return;
  }
  showToast('Item ditambahkan (qty default 1) — atur angkanya di daftar kalau perlu');
  document.getElementById('compSearchInput').value = '';
  document.getElementById('compSearchResults').innerHTML = '';
  lastAddedItemRowId = inserted?.id ?? null;
  await loadComposition();
  await refreshSetHeader();
}

// ---- Pricing (tab, terpisah dari modal generic) ----
async function loadSetHarga(){
  const { data, error } = await sb.from('produk_harga').select('*').eq('produk_id', currentSetId).order('tahun', { ascending: false });
  const tbody = document.getElementById('setHargaTableBody');
  if (error) { tbody.innerHTML = `<tr><td colspan="4">Gagal memuat: ${escapeHtml(error.message)}</td></tr>`; return; }
  if (!data || data.length === 0) { tbody.innerHTML = `<tr><td colspan="4" style="color:var(--text-muted);padding:14px;">Belum ada data harga</td></tr>`; return; }
  tbody.innerHTML = '';
  data.forEach(h => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${h.tahun}</td><td>${escapeHtml(h.jenis)}</td><td>Rp ${Number(h.harga).toLocaleString('id-ID')}</td>
      <td><button class="btn btn-danger-ghost btn-sm" data-id="${h.id}"><i class="ti ti-trash"></i></button></td>`;
    tr.querySelector('button').addEventListener('click', async () => {
      if (!confirm('Hapus baris harga ini?')) return;
      const { error: delErr } = await sb.from('produk_harga').delete().eq('id', h.id);
      if (delErr) { showToast('Gagal hapus: ' + delErr.message, true); return; }
      showToast('Harga dihapus'); loadSetHarga(); refreshSetHeader();
    });
    tbody.appendChild(tr);
  });
}
document.getElementById('hitungKomposisiBtn').addEventListener('click', async () => {
  if (compRows.length === 0) { showToast('Belum ada item di komposisi set ini', true); return; }
  let total = 0;
  let itemTanpaHarga = [];
  for (const r of compRows) {
    const { data: hargaItem } = await sb.from('produk_harga').select('harga').eq('produk_id', r.produk_id).eq('jenis', 'EKATALOG')
      .order('tahun', { ascending: false }).limit(1).maybeSingle();
    if (hargaItem) { total += hargaItem.harga * r.qty; }
    else { itemTanpaHarga.push(r.item?.nama_produk || r.item?.kode_produk || 'item'); }
  }
  document.getElementById('sh_harga').value = Math.round(total);
  if (itemTanpaHarga.length > 0) {
    showToast(`Dihitung, tapi ${itemTanpaHarga.length} item belum punya harga EKATALOG (tidak ikut terhitung): ${itemTanpaHarga.slice(0,3).join(', ')}${itemTanpaHarga.length>3?', ...':''}`, true);
  } else {
    showToast('Harga terisi dari total komposisi — masih bisa diedit manual sebelum disimpan');
  }
});
document.getElementById('addSetHargaBtn').addEventListener('click', async () => {
  const tahun = parseInt(document.getElementById('sh_tahun').value, 10);
  const hargaEkat = parseFloat(document.getElementById('sh_harga').value);
  if (!tahun || isNaN(hargaEkat)) { showToast('Lengkapi tahun dan harga EKATALOG', true); return; }
  const ok = await upsertHargaDariEkat(currentSetId, tahun, hargaEkat);
  if (!ok) return;
  document.getElementById('sh_tahun').value = ''; document.getElementById('sh_harga').value = '';
  showToast('Harga EKATALOG, SWASTA & UPLOAD tersimpan'); loadSetHarga(); refreshSetHeader();
});

// ---- AKD (tab, terpisah dari modal generic) ----
let setAkdLinks = [];
async function loadSetAkd(){
  const { data, error } = await sb.from('produk_akd').select('akd_id, akd:akd_id(id, no_akd, nama_akd, tipe_akd)').eq('produk_id', currentSetId);
  if (error) return;
  setAkdLinks = (data || []).map(r => r.akd).filter(Boolean);
  renderSetAkd();
}
function renderSetAkd(){
  const el = document.getElementById('setAkdCurrentList');
  if (setAkdLinks.length === 0) { el.innerHTML = '<div class="akd-empty">Belum ada AKD terhubung ke set ini.</div>'; return; }
  el.innerHTML = '';
  setAkdLinks.forEach(a => {
    const chip = document.createElement('div');
    chip.className = 'akd-chip';
    chip.innerHTML = `<span class="ac-no">${escapeHtml(a.no_akd)}</span><span class="ac-nama">${escapeHtml(a.nama_akd || '')}</span><button title="Lepas relasi"><i class="ti ti-x"></i></button>`;
    chip.querySelector('button').addEventListener('click', async () => {
      if (!confirm('Lepas relasi AKD ini dari set?')) return;
      const { error } = await sb.from('produk_akd').delete().eq('produk_id', currentSetId).eq('akd_id', a.id);
      if (error) { showToast('Gagal melepas: ' + error.message, true); return; }
      showToast('Relasi AKD dilepas'); loadSetAkd(); refreshSetHeader();
    });
    el.appendChild(chip);
  });
}
let setAkdSearchTimer = null;
document.getElementById('setAkdSearchInput').addEventListener('input', () => {
  clearTimeout(setAkdSearchTimer);
  const q = document.getElementById('setAkdSearchInput').value.trim();
  const resEl = document.getElementById('setAkdResults');
  if (!q) { resEl.innerHTML = ''; return; }
  setAkdSearchTimer = setTimeout(async () => {
    const { data, error } = await sb.from('akd').select('id, no_akd, nama_akd').eq('tipe_akd', 'set').or(`no_akd.ilike.%${q}%,nama_akd.ilike.%${q}%`).limit(15);
    if (error) { resEl.innerHTML = `<div class="akd-empty">Gagal mencari: ${escapeHtml(error.message)}</div>`; return; }
    if (!data || data.length === 0) { resEl.innerHTML = '<div class="akd-empty">Tidak ditemukan.</div>'; return; }
    resEl.innerHTML = '';
    data.forEach(a => {
      const row = document.createElement('div');
      row.className = 'akd-result-row';
      row.innerHTML = `<span class="ar-no">${escapeHtml(a.no_akd)}</span><span class="ar-nama">${escapeHtml(a.nama_akd || '')}</span>`;
      row.addEventListener('click', async () => {
        const { error: linkErr } = await sb.from('produk_akd').insert({ produk_id: currentSetId, akd_id: a.id, is_primary: true });
        if (linkErr) { if (linkErr.code === '23505') { showToast('Sudah terhubung'); return; } showToast('Gagal: ' + linkErr.message, true); return; }
        showToast('AKD terhubung');
        document.getElementById('setAkdSearchInput').value = ''; resEl.innerHTML = '';
        loadSetAkd(); refreshSetHeader();
      });
      resEl.appendChild(row);
    });
  }, 250);
});

// ---- History (tab, best-effort — level produk; detail item/harga/AKD ada di Log global) ----
async function loadSetHistory(){
  const wrap = document.getElementById('setHistoryList');
  wrap.innerHTML = '<div style="color:var(--text-muted);">Memuat...</div>';
  const { data, error } = await sb.from('audit_log').select('*').eq('table_name', 'produk').eq('record_id', currentSetKode).order('changed_at', { ascending: false }).limit(30);
  if (error) { wrap.innerHTML = `<div style="color:var(--rust);">Gagal memuat: ${escapeHtml(error.message)}</div>`; return; }
  if (!data || data.length === 0) { wrap.innerHTML = '<div class="akd-empty">Belum ada riwayat perubahan level produk untuk set ini.</div>'; return; }
  wrap.innerHTML = '';
  data.forEach(row => {
    const el = document.createElement('div');
    el.className = 'log-entry';
    const jam = new Date(row.changed_at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
    el.innerHTML = `<div class="log-entry-top"><span class="log-action ${row.action}">${LOG_ACTION_LABELS[row.action] || row.action}</span><span class="log-meta">${jam} · ${escapeHtml(row.changed_by || 'tidak diketahui')}</span></div>
      <div class="log-summary">${buildLogSummary(row)}</div>`;
    wrap.appendChild(el);
  });
}
document.getElementById('openFullLogFromSetBtn').addEventListener('click', () => {
  document.getElementById('log_table').value = 'produk_set_item';
  logModalOverlay.classList.add('open');
  loadLog(1);
});

// ---- Sesuaikan modal generic: sembunyikan Harga & AKD kelola kalau tipe SET ----
const _origOpenEdit = openEdit;
window.openEdit = async function(produkId){
  await _origOpenEdit(produkId);
  const tipe = document.getElementById('f_tipe').value;
  if (tipe === 'SET') {
    hargaSection.style.display = 'none';
    toggleAkdBoxBtn.style.display = 'none';
    akdBox.style.display = 'none';
    document.getElementById('akdHint').textContent = '';
    if (!document.getElementById('setRedirectNote')) {
      const note = document.createElement('div');
      note.id = 'setRedirectNote';
      note.className = 'akd-hint';
      note.style.marginTop = '4px';
      note.innerHTML = 'Harga & AKD untuk SET dikelola di halaman <b>Set Management</b>, bukan di sini.';
      toggleAkdBoxBtn.parentElement.appendChild(note);
    }
  } else {
    const note = document.getElementById('setRedirectNote');
    if (note) note.remove();
    toggleAkdBoxBtn.style.display = 'inline-flex';
  }
};

// ---- Route klik SET dari Produk list & command palette ke Set Management ----
const _origLoadProdukRowClick = null; // handled inline below via monkey-patch approach not needed; see loadProduk edits

// ---- Muat awal saat pertama masuk view Set (lazy) ----
document.querySelector('.sb-item[data-view="set"]').addEventListener('click', () => {
  if (!document.getElementById('setDetailWrap') || document.getElementById('setDetailWrap').style.display === 'none') {
    loadSetList();
  }
});

// ================================================================
// BULK EDIT
// ================================================================
document.querySelectorAll('.bulk-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.bulk-tab').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.bulk-panel').forEach(p => p.classList.toggle('active', p.id === 'bulk-' + btn.dataset.bulk));
  });
});

function parsePasteLines(raw){
  return raw.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim() !== '').map(l => l.split('\t').map(c => c.trim()));
}

// ---- BULK HARGA ----
let bulkHargaRows = [];
document.getElementById('bulkHargaPreviewBtn').addEventListener('click', async () => {
  const lines = parsePasteLines(document.getElementById('bulkHargaPaste').value);
  if (lines.length === 0) { showToast('Belum ada data yang di-paste', true); return; }
  const kodeSet = [...new Set(lines.map(l => l[0]).filter(Boolean))];
  const { data: produkRows, error } = await sb.from('produk').select('id, kode_produk, nama_produk').in('kode_produk', kodeSet);
  if (error) { showToast('Gagal cek produk: ' + error.message, true); return; }
  const byKode = Object.fromEntries((produkRows || []).map(p => [p.kode_produk, p]));

  bulkHargaRows = lines.map(l => {
    const [kode, tahunStr, hargaStr] = l;
    const tahun = parseInt(tahunStr, 10);
    const hargaEkat = parseFloat((hargaStr || '').replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.'));
    const produk = byKode[kode];
    let status = 'ok', msg = 'Siap diproses';
    if (!kode) { status = 'err'; msg = 'Kode produk kosong'; }
    else if (!produk) { status = 'err'; msg = 'Kode produk tidak ditemukan'; }
    else if (!tahun) { status = 'err'; msg = 'Tahun tidak valid'; }
    else if (isNaN(hargaEkat)) { status = 'err'; msg = 'Harga tidak valid'; }
    return { kode, tahun, hargaEkat, produk, status, msg };
  });

  renderBulkHargaPreview();
});
function renderBulkHargaPreview(){
  const wrap = document.getElementById('bulkHargaPreviewWrap');
  const body = document.getElementById('bulkHargaPreviewBody');
  const summary = document.getElementById('bulkHargaSummary');
  const okCount = bulkHargaRows.filter(r => r.status === 'ok').length;
  const errCount = bulkHargaRows.length - okCount;
  summary.innerHTML = `<span class="ok">${okCount} baris siap diproses</span>${errCount ? `<span class="warn">${errCount} baris bermasalah (tidak ikut diproses)</span>` : ''}`;
  wrap.style.display = 'block';
  body.innerHTML = '';
  bulkHargaRows.forEach(r => {
    const tr = document.createElement('tr');
    const swasta = !isNaN(r.hargaEkat) ? Math.round(r.hargaEkat * 1.3) : '—';
    const upload = !isNaN(r.hargaEkat) ? Math.round(r.hargaEkat / 1.11) : '—';
    tr.innerHTML = `
      <td class="kode-cell">${escapeHtml(r.kode)}</td>
      <td>${escapeHtml(r.produk?.nama_produk || '—')}</td>
      <td>${r.tahun || '—'}</td>
      <td>${!isNaN(r.hargaEkat) ? 'Rp ' + r.hargaEkat.toLocaleString('id-ID') : '—'}</td>
      <td>${typeof swasta === 'number' ? 'Rp ' + swasta.toLocaleString('id-ID') : swasta}</td>
      <td>${typeof upload === 'number' ? 'Rp ' + upload.toLocaleString('id-ID') : upload}</td>
      <td><span class="row-status ${r.status}">${r.status === 'ok' ? 'Siap' : r.msg}</span></td>
    `;
    body.appendChild(tr);
  });
  document.getElementById('bulkHargaProsesBtn').style.display = okCount > 0 ? 'inline-flex' : 'none';
}
document.getElementById('bulkHargaProsesBtn').addEventListener('click', async () => {
  const rows = bulkHargaRows.filter(r => r.status === 'ok');
  if (rows.length === 0) return;
  const btn = document.getElementById('bulkHargaProsesBtn');
  btn.disabled = true;
  let sukses = 0, gagal = 0;
  for (const r of rows) {
    const ok = await upsertHargaDariEkat(r.produk.id, r.tahun, r.hargaEkat);
    if (ok) sukses++; else gagal++;
  }
  btn.disabled = false;
  showToast(`Selesai — ${sukses} produk ter-update${gagal ? `, ${gagal} gagal` : ''}`, gagal > 0);
  document.getElementById('bulkHargaPaste').value = '';
  document.getElementById('bulkHargaPreviewWrap').style.display = 'none';
  document.getElementById('bulkHargaSummary').innerHTML = '';
  btn.style.display = 'none';
  bulkHargaRows = [];
  invalidateProdukStackCache();
  loadProduk();
  refreshProdukFilterCounts();
});

// ---- BULK KOMPOSISI SET ----
let bulkKompRows = [];
document.getElementById('bulkKompPreviewBtn').addEventListener('click', async () => {
  const lines = parsePasteLines(document.getElementById('bulkKompPaste').value);
  if (lines.length === 0) { showToast('Belum ada data yang di-paste', true); return; }
  const kodeSetList = [...new Set(lines.map(l => l[0]).filter(Boolean))];
  const kodeItemList = [...new Set(lines.map(l => l[2]).filter(Boolean))];
  const allKode = [...new Set([...kodeSetList, ...kodeItemList])];
  const { data: produkRows, error } = await sb.from('produk').select('id, kode_produk, tipe').in('kode_produk', allKode);
  if (error) { showToast('Gagal cek produk: ' + error.message, true); return; }
  const byKode = Object.fromEntries((produkRows || []).map(p => [p.kode_produk, p]));

  bulkKompRows = lines.map(l => {
    const [kodeSet, , kodeItem, namaItem, qtyStr] = l;
    const qty = parseInt(qtyStr, 10);
    const setProduk = byKode[kodeSet];
    const itemProduk = byKode[kodeItem];
    let status = 'ok', msg = 'Siap diproses';
    if (!kodeSet || !kodeItem) { status = 'err'; msg = 'Kode set/item kosong'; }
    else if (!setProduk) { status = 'err'; msg = 'Kode set tidak ditemukan'; }
    else if (setProduk.tipe !== 'SET') { status = 'err'; msg = 'Kode set bukan tipe SET'; }
    else if (!itemProduk) { status = 'err'; msg = 'Kode item tidak ditemukan'; }
    else if (itemProduk.tipe === 'SET') { status = 'err'; msg = 'Item tidak boleh SET (nested)'; }
    else if (!qty || qty < 1) { status = 'err'; msg = 'Qty tidak valid'; }
    return { kodeSet, kodeItem, namaItem, qty, setProduk, itemProduk, status, msg };
  });

  renderBulkKompPreview();
});
function renderBulkKompPreview(){
  const wrap = document.getElementById('bulkKompPreviewWrap');
  const body = document.getElementById('bulkKompPreviewBody');
  const summary = document.getElementById('bulkKompSummary');
  const okCount = bulkKompRows.filter(r => r.status === 'ok').length;
  const errCount = bulkKompRows.length - okCount;
  const setCount = new Set(bulkKompRows.filter(r => r.status === 'ok').map(r => r.kodeSet)).size;
  summary.innerHTML = `<span class="ok">${okCount} baris siap (${setCount} set berbeda)</span>${errCount ? `<span class="warn">${errCount} baris bermasalah (tidak ikut diproses)</span>` : ''}`;
  wrap.style.display = 'block';
  body.innerHTML = '';
  bulkKompRows.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="kode-cell">${escapeHtml(r.kodeSet)}</td>
      <td class="kode-cell">${escapeHtml(r.kodeItem)}</td>
      <td>${escapeHtml(r.namaItem || r.itemProduk?.nama_produk || '—')}</td>
      <td>${r.qty || '—'}</td>
      <td><span class="row-status ${r.status}">${r.status === 'ok' ? 'Siap' : r.msg}</span></td>
    `;
    body.appendChild(tr);
  });
  document.getElementById('bulkKompProsesBtn').style.display = okCount > 0 ? 'inline-flex' : 'none';
}
document.getElementById('bulkKompProsesBtn').addEventListener('click', async () => {
  const rows = bulkKompRows.filter(r => r.status === 'ok');
  if (rows.length === 0) return;
  const timpaMode = document.getElementById('bulkKompTimpaMode').checked;
  const btn = document.getElementById('bulkKompProsesBtn');
  btn.disabled = true;

  const bySet = {};
  rows.forEach(r => { (bySet[r.setProduk.id] = bySet[r.setProduk.id] || []).push(r); });

  let sukses = 0, gagal = 0;
  for (const setId of Object.keys(bySet)) {
    const itemRows = bySet[setId];
    if (timpaMode) {
      const { error: delErr } = await sb.from('produk_set_item').delete().eq('set_id', setId);
      if (delErr) { showToast('Gagal timpa komposisi ' + itemRows[0].kodeSet + ': ' + delErr.message, true); gagal += itemRows.length; continue; }
    }
    for (const r of itemRows) {
      if (timpaMode) {
        const { error } = await sb.from('produk_set_item').insert({ set_id: setId, produk_id: r.itemProduk.id, qty: r.qty });
        if (error) { gagal++; } else { sukses++; }
      } else {
        const { data: existing } = await sb.from('produk_set_item').select('id').eq('set_id', setId).eq('produk_id', r.itemProduk.id).maybeSingle();
        if (existing) {
          const { error } = await sb.from('produk_set_item').update({ qty: r.qty }).eq('id', existing.id);
          if (error) { gagal++; } else { sukses++; }
        } else {
          const { error } = await sb.from('produk_set_item').insert({ set_id: setId, produk_id: r.itemProduk.id, qty: r.qty });
          if (error) { gagal++; } else { sukses++; }
        }
      }
    }
  }
  btn.disabled = false;
  showToast(`Selesai — ${sukses} baris komposisi tersimpan${gagal ? `, ${gagal} gagal` : ''} (${Object.keys(bySet).length} set)`, gagal > 0);
  document.getElementById('bulkKompPaste').value = '';
  document.getElementById('bulkKompPreviewWrap').style.display = 'none';
  document.getElementById('bulkKompSummary').innerHTML = '';
  btn.style.display = 'none';
  bulkKompRows = [];
});

// ---- BULK LINK V6 ----
let bulkLinkRows = [];
document.getElementById('bulkLinkPreviewBtn').addEventListener('click', async () => {
  const lines = parsePasteLines(document.getElementById('bulkLinkPaste').value);
  if (lines.length === 0) { showToast('Belum ada data yang di-paste', true); return; }
  const kodeSet = [...new Set(lines.map(l => l[0]).filter(Boolean))];
  const { data: produkRows, error } = await sb.from('produk').select('id, kode_produk, nama_produk, link_v6').in('kode_produk', kodeSet);
  if (error) { showToast('Gagal cek produk: ' + error.message, true); return; }
  const byKode = Object.fromEntries((produkRows || []).map(p => [p.kode_produk, p]));

  bulkLinkRows = lines.map(l => {
    const [kode, link] = l;
    const produk = byKode[kode];
    let status = 'ok', msg = 'Siap diproses';
    if (!kode) { status = 'err'; msg = 'Kode produk kosong'; }
    else if (!produk) { status = 'err'; msg = 'Kode produk tidak ditemukan'; }
    else if (!link) { status = 'err'; msg = 'Link kosong'; }
    return { kode, link, produk, status, msg };
  });
  renderBulkLinkPreview();
});
function renderBulkLinkPreview(){
  const wrap = document.getElementById('bulkLinkPreviewWrap');
  const body = document.getElementById('bulkLinkPreviewBody');
  const summary = document.getElementById('bulkLinkSummary');
  const okCount = bulkLinkRows.filter(r => r.status === 'ok').length;
  const errCount = bulkLinkRows.length - okCount;
  summary.innerHTML = `<span class="ok">${okCount} baris siap diproses</span>${errCount ? `<span class="warn">${errCount} baris bermasalah (tidak ikut diproses)</span>` : ''}`;
  wrap.style.display = 'block';
  body.innerHTML = '';
  bulkLinkRows.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="kode-cell">${escapeHtml(r.kode)}</td>
      <td>${escapeHtml(r.produk?.nama_produk || '—')}</td>
      <td class="media-link" style="max-width:180px;">${escapeHtml(r.produk?.link_v6 || '—')}</td>
      <td class="media-link" style="max-width:180px;">${escapeHtml(r.link || '—')}</td>
      <td><span class="row-status ${r.status}">${r.status === 'ok' ? 'Siap' : r.msg}</span></td>
    `;
    body.appendChild(tr);
  });
  document.getElementById('bulkLinkProsesBtn').style.display = okCount > 0 ? 'inline-flex' : 'none';
}
document.getElementById('bulkLinkProsesBtn').addEventListener('click', async () => {
  const rows = bulkLinkRows.filter(r => r.status === 'ok');
  if (rows.length === 0) return;
  const btn = document.getElementById('bulkLinkProsesBtn');
  btn.disabled = true;
  let sukses = 0, gagal = 0;
  for (const r of rows) {
    const { error } = await sb.from('produk').update({ link_v6: r.link }).eq('id', r.produk.id);
    if (error) gagal++; else sukses++;
  }
  btn.disabled = false;
  showToast(`Selesai — ${sukses} link ter-update${gagal ? `, ${gagal} gagal` : ''}`, gagal > 0);
  document.getElementById('bulkLinkPaste').value = '';
  document.getElementById('bulkLinkPreviewWrap').style.display = 'none';
  document.getElementById('bulkLinkSummary').innerHTML = '';
  btn.style.display = 'none';
  bulkLinkRows = [];
  invalidateProdukStackCache();
  loadProduk();
  refreshProdukFilterCounts();
});

// ---- BULK INAPROC TRACKER ----
const BULAN_INDO = { januari:1, februari:2, maret:3, april:4, mei:5, juni:6, juli:7, agustus:8, september:9, oktober:10, november:11, desember:12 };
function parseTglIndo(txt){
  if (!txt) return null;
  const parts = txt.trim().toLowerCase().split(/\s+/);
  if (parts.length !== 3) return null;
  const bulan = BULAN_INDO[parts[1]];
  if (!bulan) return null;
  const tgl = parseInt(parts[0], 10), tahun = parseInt(parts[2], 10);
  if (!tgl || !tahun) return null;
  return `${tahun}-${String(bulan).padStart(2,'0')}-${String(tgl).padStart(2,'0')}`;
}
function extractKodeDariNama(namaRaw){
  if (!namaRaw) return null;
  const m = namaRaw.match(/\(([^,)]+),/);
  return m ? m[1].trim() : null;
}

let bulkInaprocRows = [];
document.getElementById('bulkInaprocPreviewBtn').addEventListener('click', async () => {
  const lines = parsePasteLines(document.getElementById('bulkInaprocPaste').value);
  if (lines.length === 0) { showToast('Belum ada data yang di-paste', true); return; }

  const parsedRaw = lines.map(l => {
    const [, nama, kategori, nomorPermohonan, tglStr, status, alasan] = l;
    const kode = extractKodeDariNama(nama);
    const tgl = parseTglIndo(tglStr);
    return { nama, kategori, nomorPermohonan, tgl, status, alasan: alasan || null, kode };
  });

  // Dedup by nomor_permohonan: kalau nomor yang sama muncul lebih dari sekali di paste
  // (misal status-nya di-update dari "Ditolak" jadi "Disetujui" untuk nomor yang sama),
  // upsert bakal nimpa baris itu berkali-kali. Tanpa dedup, yang menang adalah baris yang
  // urutannya paling belakang di teks paste — bukan yang tgl_pengajuan-nya paling baru.
  // Jadi ambil cuma satu per nomor_permohonan: yang tgl_pengajuan-nya terbesar (null dianggap paling lama).
  const byNomor = new Map();
  let dilewatiKarenaDuplikat = 0;
  const parsed = [];
  for (const p of parsedRaw) {
    if (!p.nomorPermohonan) { parsed.push(p); continue; }
    const existing = byNomor.get(p.nomorPermohonan);
    if (!existing) {
      byNomor.set(p.nomorPermohonan, p);
    } else {
      // bandingin tgl (format ISO string, aman dibandingin secara leksikografis); null dianggap paling lama
      const tglBaru = p.tgl || '';
      const tglLama = existing.tgl || '';
      if (tglBaru > tglLama) {
        byNomor.set(p.nomorPermohonan, p); // yang baru menang, yang lama dibuang
      }
      dilewatiKarenaDuplikat++;
    }
  }
  for (const p of byNomor.values()) parsed.push(p);
  if (dilewatiKarenaDuplikat > 0) {
    showToast(`${dilewatiKarenaDuplikat} baris duplikat (nomor permohonan sama) dilewati — dipilih yang tgl_pengajuan-nya paling baru`, false);
  }

  const kodeList = [...new Set(parsed.map(p => p.kode).filter(Boolean))];
  const CHUNK_SIZE = 150; // batasi tiap query .in() biar URL-nya ga kepanjangan
  let produkRows = [];
  for (let i = 0; i < kodeList.length; i += CHUNK_SIZE) {
    const chunk = kodeList.slice(i, i + CHUNK_SIZE);
    const { data, error } = await sb.from('produk').select('id, kode_produk').in('kode_produk', chunk);
    if (error) { showToast('Gagal cek produk: ' + error.message, true); return; }
    produkRows = produkRows.concat(data || []);
  }
  const byKode = Object.fromEntries(produkRows.map(p => [p.kode_produk, p]));

  bulkInaprocRows = parsed.map(p => {
    const produk = byKode[p.kode];
    let status_ = 'ok', msg = 'Siap diproses';
    if (!p.nomorPermohonan) { status_ = 'err'; msg = 'Nomor permohonan kosong'; }
    else if (!p.kode) { status_ = 'err'; msg = 'Kode produk tidak terbaca dari Nama'; }
    else if (!produk) { status_ = 'err'; msg = 'Kode produk tidak ditemukan di database'; }
    else if (!p.status) { status_ = 'err'; msg = 'Status kosong'; }
    return { ...p, produk, status_, msg };
  });
  renderBulkInaprocPreview();
});
function renderBulkInaprocPreview(){
  const wrap = document.getElementById('bulkInaprocPreviewWrap');
  const body = document.getElementById('bulkInaprocPreviewBody');
  const summary = document.getElementById('bulkInaprocSummary');
  const okCount = bulkInaprocRows.filter(r => r.status_ === 'ok').length;
  const errCount = bulkInaprocRows.length - okCount;
  summary.innerHTML = `<span class="ok">${okCount} baris siap diproses</span>${errCount ? `<span class="warn">${errCount} baris bermasalah (tidak ikut diproses)</span>` : ''}`;
  wrap.style.display = 'block';
  body.innerHTML = '';
  bulkInaprocRows.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="kode-cell">${escapeHtml(r.nomorPermohonan)}</td>
      <td class="kode-cell">${escapeHtml(r.kode || '—')}</td>
      <td>${escapeHtml(r.nama || '—')}</td>
      <td>${escapeHtml(r.tgl || '—')}</td>
      <td>${escapeHtml(r.status || '—')}</td>
      <td><span class="row-status ${r.status_}">${r.status_ === 'ok' ? 'Ketemu produknya' : r.msg}</span></td>
    `;
    body.appendChild(tr);
  });
  document.getElementById('bulkInaprocProsesBtn').style.display = okCount > 0 ? 'inline-flex' : 'none';
}
function isAuthError(error) {
  if (!error) return false;
  const msg = (error.message || '') + ' ' + (error.code || '');
  // sengaja SEMPIT: "403"/"forbidden"/"permission" itu muncul di SEMUA RLS denial,
  // apapun sebabnya — bukan cuma pas token expired. Kalau dipakai buat deteksi,
  // toast "sesi expired" jadi salah nembak tiap kali ada RLS/permission issue biasa.
  // Cuma tandain sebagai auth-error kalau pesannya spesifik nyebut token/JWT/session.
  return /jwt expired|invalid jwt|jwt malformed|invalid.{0,10}token|refresh.{0,10}token|session.{0,10}(expired|invalid|missing)/i.test(msg);
}
document.getElementById('bulkInaprocProsesBtn').addEventListener('click', async () => {
  const rows = bulkInaprocRows.filter(r => r.status_ === 'ok');
  if (rows.length === 0) return;
  const btn = document.getElementById('bulkInaprocProsesBtn');
  const btnLabelAsal = btn.textContent;
  btn.disabled = true;

  // pastikan sesi masih fresh sebelum mulai batch panjang — pakai refreshSession(),
  // bukan getSession(), karena getSession() cuma baca cache lokal dan bisa keliru
  // bilang "masih ada sesi" padahal sesi itu sebenarnya udah mati di server.
  const { data: refreshData, error: refreshError } = await sb.auth.refreshSession();
  if (refreshError || !refreshData?.session) {
    showToast('Sesi login kamu udah habis — refresh halaman & login ulang dulu sebelum proses', true);
    btn.disabled = false;
    btn.textContent = btnLabelAsal;
    return;
  }

  let sukses = 0, gagal = 0, diproses = 0, berhentiKarenaAuth = false;
  const sisaRows = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    btn.textContent = `Memproses ${i + 1}/${rows.length}...`;
    const { error } = await sb.from('inaproc_pengajuan').upsert({
      nomor_permohonan: r.nomorPermohonan,
      nama_raw: r.nama,
      kode_produk_terbaca: r.kode,
      produk_id: r.produk.id,
      kategori: r.kategori || null,
      tgl_pengajuan: r.tgl,
      status: r.status,
      alasan_ditolak: r.alasan
    }, { onConflict: 'nomor_permohonan' });
    if (error) {
      console.error('INAPROC UPSERT ERROR (baris ' + (i+1) + ', nomor ' + r.nomorPermohonan + '):', JSON.stringify(error, null, 2));
      gagal++;
      if (isAuthError(error)) {
        berhentiKarenaAuth = true;
        sisaRows.push(...rows.slice(i)); // simpan baris ini + sisanya yang belum sempat dicoba
        break;
      }
    } else {
      sukses++;
    }
    diproses++;
  }
  btn.disabled = false;
  btn.textContent = btnLabelAsal;

  if (berhentiKarenaAuth) {
    showToast(`Berhenti di baris ${diproses + 1}/${rows.length} — sesi login expired. Refresh halaman, login ulang, lalu klik Proses lagi buat lanjutin ${sisaRows.length} baris sisanya.`, true);
    // ganti isi bulkInaprocRows dengan sisa baris yang belum ke-proses, biar preview & tombol tetap muncul
    bulkInaprocRows = bulkInaprocRows.filter(r => r.status_ !== 'ok').concat(sisaRows);
    renderBulkInaprocPreview();
    return;
  }

  showToast(`Selesai — ${sukses} pengajuan tersimpan${gagal ? `, ${gagal} gagal` : ''}`, gagal > 0);
  document.getElementById('bulkInaprocPaste').value = '';
  document.getElementById('bulkInaprocPreviewWrap').style.display = 'none';
  document.getElementById('bulkInaprocSummary').innerHTML = '';
  btn.style.display = 'none';
  bulkInaprocRows = [];
  invalidateProdukStackCache();
  loadProduk();
  refreshProdukFilterCounts();
});

// ---- Delete produk ----
// Konstraint FK asli (dicek langsung ke Postgres, bukan asumsi):
//  - produk_harga, produk_media, produk_akd, produk_set_item.set_id -> CASCADE.
//    Rincian/komposisi SET, harga, media, & relasi AKD OTOMATIS ikut kehapus
//    barengan produk induknya di satu statement DELETE (atomic, DB yang jamin).
//  - produk_set_item.produk_id (posisi produk ini sbg ITEM di SET LAIN) -> RESTRICT.
//    Wajib dilepas manual dulu di sini, kalau nggak delete produk gagal total.
//  - inaproc_pengajuan.produk_id, permintaan_item.matched_produk_id,
//    konversi_item.produk_id -> NO ACTION. Ini riwayat lintas modul (pengajuan
//    INAPROC, Permintaan RS, konversi) yang SENGAJA kita hormati, bukan di-bypass —
//    bukan wewenang halaman Produk buat hapus diam-diam. Kalau masih ada baris di
//    situ, delete diBLOK dengan pesan jelas, bukan dibiarin gagal error Postgres mentah.
deleteBtn.addEventListener('click', async () => {
  if (!currentProdukId) return;
  const id = currentProdukId;

  const [hargaR, mediaR, akdR, komposisiSendiriR, dipakaiDiSetLainR, inaprocR, permintaanR, konversiR] = await Promise.all([
    sb.from('produk_harga').select('id', { count: 'exact', head: true }).eq('produk_id', id),
    sb.from('produk_media').select('id', { count: 'exact', head: true }).eq('produk_id', id),
    sb.from('produk_akd').select('id', { count: 'exact', head: true }).eq('produk_id', id),
    sb.from('produk_set_item').select('id', { count: 'exact', head: true }).eq('set_id', id),
    sb.from('produk_set_item').select('id', { count: 'exact', head: true }).eq('produk_id', id),
    sb.from('inaproc_pengajuan').select('id', { count: 'exact', head: true }).eq('produk_id', id),
    sb.from('permintaan_item').select('id', { count: 'exact', head: true }).eq('matched_produk_id', id),
    sb.from('konversi_item').select('id', { count: 'exact', head: true }).eq('produk_id', id),
  ]);
  const hargaCount = hargaR.count || 0, mediaCount = mediaR.count || 0, akdCount = akdR.count || 0,
        komposisiSendiri = komposisiSendiriR.count || 0, dipakaiDiSetLain = dipakaiDiSetLainR.count || 0,
        inaprocCount = inaprocR.count || 0, permintaanCount = permintaanR.count || 0, konversiCount = konversiR.count || 0;

  const blokir = [];
  if (inaprocCount) blokir.push(`${inaprocCount} riwayat pengajuan INAPROC`);
  if (permintaanCount) blokir.push(`${permintaanCount} riwayat Permintaan RS`);
  if (konversiCount) blokir.push(`${konversiCount} riwayat konversi`);
  if (blokir.length) {
    alert(`Produk ini belum bisa dihapus — masih ada ${blokir.join(', ')} yang menunjuk ke sini. Data riwayat lintas modul ini sengaja tidak dihapus otomatis dari halaman Produk; bersihkan dulu dari sumbernya kalau memang perlu.`);
    return;
  }

  const parts = [];
  if (hargaCount) parts.push(`${hargaCount} baris harga`);
  if (mediaCount) parts.push(`${mediaCount} media`);
  if (akdCount) parts.push(`${akdCount} relasi AKD`);
  if (komposisiSendiri) parts.push(`${komposisiSendiri} item komposisi set ini`);
  let pesan = 'Hapus produk ini?';
  if (parts.length) pesan += ' Ikut terhapus otomatis: ' + parts.join(', ') + '.';
  if (dipakaiDiSetLain) pesan += ` ⚠️ Produk ini masih jadi item komposisi di ${dipakaiDiSetLain} SET lain — relasinya di sana akan dilepas dulu (komposisi set-set itu berkurang satu item), baru produknya dihapus.`;
  if (!confirm(pesan)) return;

  if (dipakaiDiSetLain) {
    const { error: detachErr } = await sb.from('produk_set_item').delete().eq('produk_id', id);
    if (detachErr) { showToast('Gagal melepas relasi dari set lain: ' + detachErr.message, true); return; }
  }

  // Sisanya (harga, media, relasi AKD, komposisi SET ini sendiri) ikut kehapus
  // otomatis lewat CASCADE dalam satu statement ini.
  const { error } = await sb.from('produk').delete().eq('id', id);
  if (error) { showToast('Gagal hapus produk: ' + error.message, true); return; }
  showToast('Produk dan seluruh data terkait berhasil dihapus');
  closeModal();
  invalidateProdukStackCache();
  loadProduk();
  refreshProdukFilterCounts();
});

// ================================================================
// AKD MANAGEMENT
// ================================================================
const AKD_COLUMNS = 'id, tipe_akd, no_akd, nama_akd, nama_database, kategori_set, penanda_kode, golongan, masa_berlaku, tgl_maju_mas_munir, status_terupdate, link_dokumen, update_progres, created_at, updated_at, kode_set';
const AKD_PAGE_SIZE = 30;

let akdPage = 1;
let akdSearchQuery = '';
let akdDistinct = { golongan: [], status_terupdate: [] }; // dipakai buat datalist "Golongan" & "Status Terupdate" di modal Tambah/Edit AKD

// Nilai golongan/status_terupdate dimuat dari data aktual (bukan hardcode)
// biar datalist di modal Tambah/Edit AKD selalu sinkron sama isi database beneran.
async function loadAkdDistinctValues(){
  const [golR, statR] = await Promise.all([
    sb.from('akd').select('golongan').not('golongan', 'is', null).limit(3000),
    sb.from('akd').select('status_terupdate').not('status_terupdate', 'is', null).limit(3000),
  ]);
  akdDistinct.golongan = [...new Set((golR.data || []).map(r => r.golongan).filter(Boolean))].sort();
  akdDistinct.status_terupdate = [...new Set((statR.data || []).map(r => r.status_terupdate).filter(Boolean))].sort();
  document.getElementById('akd_golongan_list').innerHTML = akdDistinct.golongan.map(g => `<option value="${escapeHtml(g)}">`).join('');
  document.getElementById('akd_status_list').innerHTML = akdDistinct.status_terupdate.map(s => `<option value="${escapeHtml(s)}">`).join('');
}

function akdMasaBerlakuPill(dateStr){
  if (!dateStr) return `<span class="status-pill neutral">—</span>`;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + 'T00:00:00');
  const diffDays = Math.round((d - today) / 86400000);
  const label = d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
  if (diffDays < 0) return `<span class="status-pill bad" title="Sudah expired ${Math.abs(diffDays)} hari lalu">${label}</span>`;
  if (diffDays <= 30) return `<span class="status-pill warn" title="Akan expired ${diffDays} hari lagi">${label}</span>`;
  return `<span class="status-pill ok">${label}</span>`;
}

async function renderAkdTable(rows){
  const tbody = document.getElementById('akdTableBody');
  if (!rows.length) { tbody.innerHTML = `<tr class="state-row"><td colspan="9">Tidak ada AKD ditemukan.</td></tr>`; return; }
  // Jumlah produk terhubung buat baris yang lagi tampil -> query kecil per halaman.
  const idsOnPage = rows.map(r => r.id);
  const counts = new Map();
  if (idsOnPage.length) {
    const { data: linkRows } = await sb.from('produk_akd').select('akd_id').in('akd_id', idsOnPage);
    (linkRows || []).forEach(r => counts.set(r.akd_id, (counts.get(r.akd_id) || 0) + 1));
  }
  tbody.innerHTML = '';
  rows.forEach(r => {
    const cnt = counts.get(r.id) || 0;
    const tr = document.createElement('tr');
    tr.className = 'clickable';
    tr.innerHTML = `
      <td class="kode-cell">${escapeHtml(r.no_akd)}</td>
      <td>${escapeHtml(r.nama_akd || '—')}</td>
      <td><span class="tipe-chip">${escapeHtml(r.tipe_akd || '—')}</span></td>
      <td>${escapeHtml(r.golongan || '—')}</td>
      <td>${escapeHtml(r.kategori_set || '—')}</td>
      <td>${akdMasaBerlakuPill(r.masa_berlaku)}</td>
      <td>${escapeHtml(r.status_terupdate || '—')}</td>
      <td style="text-align:center;">${r.link_dokumen ? '<i class="ti ti-link link-yes" title="Sudah ada link dokumen"></i>' : '<i class="ti ti-link-off link-no" title="Belum ada link dokumen"></i>'}</td>
      <td>${cnt > 0 ? `<span class="status-pill ok">${cnt} produk</span>` : `<span class="status-pill neutral">Belum ada</span>`}</td>
    `;
    tr.addEventListener('click', () => openEditAkd(r.id));
    tbody.appendChild(tr);
  });
}

// Browse sederhana: tanpa search -> query server (paged, count exact).
// Dengan search -> pakai ILIKE di server juga (bukan fetch-semua-lalu-filter-client),
// biar halaman AKD tetap ringan dan gak nyimpen cache 5000 baris di memori.
async function loadAkd(page){
  akdPage = page || akdPage || 1;
  const tbody = document.getElementById('akdTableBody');
  tbody.innerHTML = `<tr class="state-row"><td colspan="9">Memuat data...</td></tr>`;
  document.getElementById('akdCount').textContent = 'Memuat...';

  const from = (akdPage - 1) * AKD_PAGE_SIZE, to = from + AKD_PAGE_SIZE - 1;
  let query = sb.from('akd').select(AKD_COLUMNS, { count: 'exact' });
  const q = akdSearchQuery.trim();
  if (q) query = query.or(`no_akd.ilike.%${q}%,nama_akd.ilike.%${q}%,kode_set.ilike.%${q}%`);
  const { data, error, count } = await query.order('updated_at', { ascending: false }).range(from, to);
  if (error) { tbody.innerHTML = `<tr class="state-row"><td colspan="9">Gagal memuat: ${escapeHtml(error.message)}</td></tr>`; return; }
  const rows = data || [], total = count || 0;

  document.getElementById('akdCount').textContent = total + ' AKD' + (q ? ` untuk "${q}"` : '');
  renderPgBar(document.getElementById('akdPagination'), { page: akdPage, pageSize: AKD_PAGE_SIZE, total, onPageChange: (p) => loadAkd(p) });
  await renderAkdTable(rows);
}

// ---- Search box ----
let akdSearchDebounce = null;
document.getElementById('akdSearchBoxInput').addEventListener('input', (e) => {
  clearTimeout(akdSearchDebounce);
  akdSearchDebounce = setTimeout(() => { akdSearchQuery = e.target.value; loadAkd(1); }, 300);
});

// ---- Modal Tambah/Edit AKD ----
const akdModalOverlay = document.getElementById('akdModalOverlay');
let currentAkdId = null;
const AKD_FORM_FIELDS = ['a_tipe_akd','a_no_akd','a_nama_akd','a_nama_database','a_kode_set','a_kategori_set','a_penanda_kode','a_golongan','a_masa_berlaku','a_tgl_maju_mas_munir','a_status_terupdate','a_link_dokumen','a_update_progres'];

document.getElementById('addAkdBtn').addEventListener('click', openAddAkd);
document.getElementById('akdModalCloseBtn').addEventListener('click', closeAkdModal);
document.getElementById('akdCancelBtn').addEventListener('click', closeAkdModal);
akdModalOverlay.addEventListener('click', (e) => { if (e.target === akdModalOverlay) closeAkdModal(); });

function closeAkdModal(){ akdModalOverlay.classList.remove('open'); }
function clearAkdForm(){ AKD_FORM_FIELDS.forEach(id => document.getElementById(id).value = ''); }

function openAddAkd(){
  currentAkdId = null;
  clearAkdForm();
  document.getElementById('akdModalTitle').textContent = 'Tambah AKD';
  document.getElementById('akdModalSub').textContent = 'Isi data AKD baru';
  document.getElementById('deleteAkdBtn').style.display = 'none';
  document.getElementById('akdLinkedProdukLabel').style.display = 'none';
  document.getElementById('akdLinkedProdukList').style.display = 'none';
  akdModalOverlay.classList.add('open');
}

async function openEditAkd(id){
  currentAkdId = id;
  clearAkdForm();
  document.getElementById('akdModalTitle').textContent = 'Memuat...';
  document.getElementById('akdModalSub').textContent = '';
  document.getElementById('deleteAkdBtn').style.display = 'none';
  document.getElementById('akdLinkedProdukLabel').style.display = 'none';
  document.getElementById('akdLinkedProdukList').style.display = 'none';
  akdModalOverlay.classList.add('open');

  const { data: r, error } = await sb.from('akd').select(AKD_COLUMNS).eq('id', id).single();
  if (error) { showToast('Gagal memuat AKD: ' + error.message, true); closeAkdModal(); return; }

  document.getElementById('akdModalTitle').textContent = 'Edit AKD';
  document.getElementById('akdModalSub').textContent = r.no_akd || '';
  document.getElementById('a_tipe_akd').value = r.tipe_akd || '';
  document.getElementById('a_no_akd').value = r.no_akd || '';
  document.getElementById('a_nama_akd').value = r.nama_akd || '';
  document.getElementById('a_nama_database').value = r.nama_database || '';
  document.getElementById('a_kode_set').value = r.kode_set || '';
  document.getElementById('a_kategori_set').value = r.kategori_set || '';
  document.getElementById('a_penanda_kode').value = r.penanda_kode || '';
  document.getElementById('a_golongan').value = r.golongan || '';
  document.getElementById('a_masa_berlaku').value = r.masa_berlaku || '';
  document.getElementById('a_tgl_maju_mas_munir').value = r.tgl_maju_mas_munir || '';
  document.getElementById('a_status_terupdate').value = r.status_terupdate || '';
  document.getElementById('a_link_dokumen').value = r.link_dokumen || '';
  document.getElementById('a_update_progres').value = r.update_progres || '';
  document.getElementById('deleteAkdBtn').style.display = '';

  // Reverse-lookup: produk mana aja yang terhubung ke AKD ini
  const { data: links } = await sb.from('produk_akd').select('produk:produk_id(id, kode_produk, nama_produk)').eq('akd_id', id);
  const produkList = (links || []).map(l => l.produk).filter(Boolean);
  document.getElementById('akdLinkedProdukLabel').style.display = '';
  document.getElementById('akdLinkedProdukLabel').textContent = `Produk Terhubung (${produkList.length})`;
  const listEl = document.getElementById('akdLinkedProdukList');
  listEl.style.display = '';
  if (!produkList.length) {
    listEl.innerHTML = `<div class="akd-empty">Belum ada produk yang terhubung ke AKD ini.</div>`;
  } else {
    listEl.innerHTML = `<div class="akd-current">` + produkList.map(p =>
      `<span class="akd-chip"><span class="ac-no">${escapeHtml(p.kode_produk)}</span><span class="ac-nama">${escapeHtml(p.nama_produk || '')}</span></span>`
    ).join('') + `</div>`;
  }
}

document.getElementById('akdSaveBtn').addEventListener('click', async () => {
  const noAkd = document.getElementById('a_no_akd').value.trim();
  const tipeAkd = document.getElementById('a_tipe_akd').value;
  if (!noAkd) { showToast('No. AKD wajib diisi', true); return; }
  if (!tipeAkd) { showToast('Tipe AKD wajib dipilih', true); return; }
  const payload = {
    tipe_akd: tipeAkd,
    no_akd: noAkd,
    nama_akd: document.getElementById('a_nama_akd').value.trim() || null,
    nama_database: document.getElementById('a_nama_database').value.trim() || null,
    kode_set: document.getElementById('a_kode_set').value.trim() || null,
    kategori_set: document.getElementById('a_kategori_set').value.trim() || null,
    penanda_kode: document.getElementById('a_penanda_kode').value.trim() || null,
    golongan: document.getElementById('a_golongan').value.trim() || null,
    masa_berlaku: document.getElementById('a_masa_berlaku').value || null,
    tgl_maju_mas_munir: document.getElementById('a_tgl_maju_mas_munir').value || null,
    status_terupdate: document.getElementById('a_status_terupdate').value.trim() || null,
    link_dokumen: document.getElementById('a_link_dokumen').value.trim() || null,
    update_progres: document.getElementById('a_update_progres').value.trim() || null,
  };
  let error;
  if (currentAkdId) {
    ({ error } = await sb.from('akd').update(payload).eq('id', currentAkdId));
  } else {
    ({ error } = await sb.from('akd').insert(payload));
  }
  if (error) {
    if (error.code === '23505') { showToast('No. AKD ini sudah terdaftar', true); return; }
    showToast('Gagal menyimpan AKD: ' + error.message, true); return;
  }
  showToast('AKD tersimpan');
  closeAkdModal();
  loadAkdDistinctValues();
  loadAkd(akdPage);
});

// ---- Hapus AKD ----
// produk_akd.akd_id -> akd itu FK yang confdeltype-nya gak ada di daftar constraint
// yang dicek kemarin (yang dicek cuma FK yang NUJU ke tabel produk). Daripada asumsi,
// halaman ini proaktif ngeblok manual kalau AKD masih punya relasi ke produk_akd,
// baru minta dilepas dulu dari sana -- aman apapun aturan delete-nya di database.
document.getElementById('deleteAkdBtn').addEventListener('click', async () => {
  if (!currentAkdId) return;
  const id = currentAkdId;
  const { count } = await sb.from('produk_akd').select('id', { count: 'exact', head: true }).eq('akd_id', id);
  if (count) {
    alert(`AKD ini masih terhubung ke ${count} produk. Lepas dulu relasinya lewat halaman Produk (tombol "Kelola AKD") sebelum menghapus AKD ini.`);
    return;
  }
  if (!confirm('Hapus AKD ini? Tindakan ini tidak bisa dibatalkan.')) return;
  const { error } = await sb.from('akd').delete().eq('id', id);
  if (error) { showToast('Gagal hapus AKD: ' + error.message, true); return; }
  showToast('AKD dihapus');
  closeAkdModal();
  loadAkd(akdPage);
});