const SUPABASE_URL = 'https://ptkkbsemihcyndisjoor.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB0a2tic2VtaWhjeW5kaXNqb29yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0Njc4MzgsImV4cCI6MjA5ODA0MzgzOH0.QsCqmcqQcXvz1f8bLkagvMbAGUBbBP-3Wa5Aore5OMo';

// ══════════════════════════════════════════
// SESI LOGIN PERSISTENT: seluruh aplikasi wajib login, tapi sesi disimpan
// di localStorage supaya user gak perlu login ulang tiap buka tab/refresh.
// ══════════════════════════════════════════
const AUTH_STORAGE_KEY = 'pnm_auth_session';
let stokAccessToken = null; // dipakai di seluruh app buat panggil RPC yang butuh role 'authenticated'
let currentUser = null; // { id, email } dari Supabase Auth — basis identitas Presence/Realtime (BUKAN pic_marsup yang teks bebas)

const authGate = document.getElementById('auth-gate');
const appRoot = document.getElementById('app-root');
const gateEmail = document.getElementById('gate-email');
const gatePassword = document.getElementById('gate-password');
const gateLoginBtn = document.getElementById('gate-login-btn');
const gateStatus = document.getElementById('gate-status');

// ══════════════════════════════════════════
// REALTIME CLIENT: cuma dipakai buat channel (postgres_changes/presence/broadcast).
// Query data TETAP lewat sesiFetch()/REST kayak biasa — SDK ini gak gantiin itu.
// `window.supabase` global dari CDN ketimpa nama var lokal manapun, makanya
// instance-nya dipegang di `rt` biar gak collide sama apa-apa yang udah ada.
// ══════════════════════════════════════════
const rt = (typeof window.supabase !== 'undefined' && window.supabase.createClient)
  ? window.supabase.createClient(SUPABASE_URL, ANON_KEY)
  : null;
if (!rt) console.warn('Supabase Realtime SDK gagal dimuat — kolaborasi live gak aktif, app tetap jalan pakai REST biasa.');

function saveAuthSession(data) {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
    user: data.user ? { id: data.user.id, email: data.user.email } : null
  }));
}
function clearAuthSession() { localStorage.removeItem(AUTH_STORAGE_KEY); }
function readAuthSession() {
  try { return JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || 'null'); } catch { return null; }
}
// Realtime (postgres_changes yang difilter RLS + presence) butuh token user yang
// sama kayak dipakai sesiFetch() — kalau enggak, channel subscribe tapi gak pernah
// nerima row apapun (RLS nge-filter diem-diem). Dipanggil tiap kali token baru
// didapat/direfresh, sejalur sama titik-titik stokAccessToken diisi.
function syncRealtimeAuth() {
  if (rt && stokAccessToken) rt.realtime.setAuth(stokAccessToken);
}
function showApp() {
  authGate.style.display = 'none';
  appRoot.style.display = 'flex';
  openSesiFromUrlIfAny();
  loadSalesOptions();
}

// Isi datalist "Nama Sales" dari tabel master `sales` (via RPC get_sales_aktif,
// security definer — bukan select langsung ke tabel, karena tabel sales pakai
// RLS dan query REST langsung lewat token user bisa kefilter kosong tanpa
// error kalau belum ada policy buat role 'authenticated'). Tujuannya nyegah
// varian ejaan/kapitalisasi baru (mis. "LEO" vs "Leo") terbentuk di
// konversi_record.pic_sales / sesi_konversi.nama_sales: user masih bisa ketik
// bebas, tapi begitu nama yang benar sudah terdaftar, browser akan
// menyarankan ejaan itu duluan lewat autocomplete <datalist>.
async function loadSalesOptions() {
  try {
    const { data, error } = await rpc('get_sales_aktif', {});
    if (error || !Array.isArray(data)) return; // gagal diam-diam, gak boleh blocking alur konversi
    const dl = document.getElementById('sales-datalist');
    if (!dl) return;
    dl.innerHTML = data.map(r => `<option value="${String(r.nama).replace(/"/g, '&quot;')}">`).join('');
  } catch {
    // koneksi gagal / token belum siap — biarkan, field tetap bisa dipakai manual
  }
}
// Kalau app dibuka lewat link yang dikirim dari tombol "Minta Bantuan" (format
// ?sesi=<id>), langsung pindah ke tab Konversi Berjalan dan buka sesinya —
// biar temen yang klik link gak perlu cari-cari manual dulu.
function openSesiFromUrlIfAny() {
  const params = new URLSearchParams(window.location.search);
  const sesiId = params.get('sesi');
  if (!sesiId) return;
  if (window.innerWidth <= 860 && typeof switchTab === 'function') switchTab('search');
  switchSubTab('sesi');
  openSesi(sesiId);
}
function buildSesiShareUrl(id) {
  return `${window.location.origin}${window.location.pathname}?sesi=${encodeURIComponent(id)}`;
}
function shareSesiToWhatsApp(id, namaRs) {
  const link = buildSesiShareUrl(id);
  const label = namaRs && namaRs.trim() ? namaRs.trim() : '(Nama RS belum diisi)';
  const text = `🙋 Butuh bantuan untuk sesi konversi "${label}":\n${link}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
}
function showGate(msg) {
  stokAccessToken = null;
  currentUser = null;
  if (typeof unsubscribeFromSesiRealtime === 'function') unsubscribeFromSesiRealtime();
  appRoot.style.display = 'none';
  authGate.style.display = 'flex';
  if (msg) { gateStatus.style.color = 'var(--danger)'; gateStatus.textContent = msg; }
}

async function refreshAuthSession(refreshToken) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY },
    body: JSON.stringify({ refresh_token: refreshToken })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.msg || 'Sesi habis, silakan masuk lagi.');
  return data;
}

async function initAuth() {
  const saved = readAuthSession();
  if (!saved) { showGate(); return; }
  // Kalau token masih berlaku >60 detik lagi, pakai langsung. Kalau enggak, refresh dulu.
  if (saved.expires_at && saved.expires_at - Math.floor(Date.now() / 1000) > 60) {
    stokAccessToken = saved.access_token;
    currentUser = saved.user || null;
    syncRealtimeAuth();
    showApp();
    return;
  }
  try {
    const data = await refreshAuthSession(saved.refresh_token);
    stokAccessToken = data.access_token;
    currentUser = data.user ? { id: data.user.id, email: data.user.email } : saved.user || null;
    saveAuthSession(data);
    syncRealtimeAuth();
    showApp();
  } catch (err) {
    clearAuthSession();
    showGate('Sesi kamu sudah habis, silakan masuk lagi.');
  }
}

gateLoginBtn.addEventListener('click', async () => {
  const email = gateEmail.value.trim().toLowerCase();
  const password = gatePassword.value;
  if (!email || !password) {
    gateStatus.style.color = 'var(--danger)';
    gateStatus.textContent = 'Isi email dan password dulu.';
    return;
  }
  gateLoginBtn.disabled = true;
  gateLoginBtn.textContent = 'Memproses…';
  gateStatus.style.color = 'var(--text-muted)';
  gateStatus.textContent = '';
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error_description || data.msg || 'Login gagal');
    stokAccessToken = data.access_token;
    currentUser = data.user ? { id: data.user.id, email: data.user.email } : null;
    saveAuthSession(data);
    syncRealtimeAuth();
    gatePassword.value = '';
    showApp();
  } catch (err) {
    gateStatus.style.color = 'var(--danger)';
    gateStatus.textContent = 'Gagal masuk: ' + err.message;
  } finally {
    gateLoginBtn.disabled = false;
    gateLoginBtn.textContent = 'Masuk';
  }
});
gatePassword.addEventListener('keydown', (e) => { if (e.key === 'Enter') gateLoginBtn.click(); });

initAuth();
const THUMB_BASE = 'https://ptkkbsemihcyndisjoor.supabase.co/storage/v1/object/public/thumbnails/';
const LAMPIRAN_BASE = 'https://ptkkbsemihcyndisjoor.supabase.co/storage/v1/object/public/lampiran-unit/';

// Regex resmi dari storage-api Supabase buat validasi object key (S3-safe chars).
// Nama file dari WA/HP sering nyelundupin karakter unicode "siluman" (nbsp,
// smart quotes, dash khusus, dll) yang kelihatan normal tapi bikin request
// upload ditolak dgn error "InvalidKey". Makanya path yg dikirim ke Storage
// WAJIB disanitasi dulu, jangan pakai file.name mentah-mentah.
function isValidStorageKey(key) {
  return /^(\w|\/|!|-|\.|\*|'|\(|\)| |&|\$|@|=|;|:|\+|,|\?)*$/.test(key);
}
function sanitizeStorageFileName(name) {
  const dotIdx = name.lastIndexOf('.');
  const base = dotIdx > -1 ? name.slice(0, dotIdx) : name;
  const ext = dotIdx > -1 ? name.slice(dotIdx) : '';
  const cleanBase = base
    .normalize('NFKC')                              // normalisasi variasi unicode
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')    // hapus control char tak terlihat
    .replace(/[\u00A0\u200B-\u200D\uFEFF]/g, ' ')    // nbsp & zero-width -> spasi biasa
    .replace(/\s+/g, '_')                            // spasi (termasuk ganda) -> underscore
    .replace(/[^a-zA-Z0-9._-]/g, '')                 // buang sisa char di luar whitelist aman
    .replace(/_+/g, '_')                             // rapikan underscore berulang
    .replace(/^_+|_+$/g, '');                        // trim underscore di ujung
  return (cleanBase || 'file') + ext.toLowerCase();
}

// upload file ke Supabase Storage bucket (dipakai fitur drag & drop brosur/gambar).
// x-upsert:true supaya kalau nama file sama, langsung ditimpa (gak perlu hapus manual dulu).
async function uploadToSupabaseStorage(bucket, path, fileOrBlob, contentType) {
  // PENTING: Authorization pakai token sesi user yg login (stokAccessToken), BUKAN ANON_KEY.
  // Kalau pakai ANON_KEY, Supabase Storage nganggep request datang dari role 'anon',
  // jadi kalau policy RLS bucket-nya butuh role 'authenticated', request selalu ditolak
  // dgn error "new row violates row-level security policy" walau bucket-nya sendiri udah bener.
  if (!stokAccessToken) throw new Error('Sesi login sudah habis / belum login — silakan login ulang dulu.');
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${encodeURIComponent(path)}`, {
    method: 'POST',
    headers: {
      'apikey': ANON_KEY,
      'Authorization': 'Bearer ' + stokAccessToken,
      'Content-Type': contentType || fileOrBlob.type || 'application/octet-stream',
      'x-upsert': 'true'
    },
    body: fileOrBlob
  });
  if (!r.ok) throw new Error(await r.text());
  return true;
}

// bikin dropzone (klik utk browse + drag&drop) manggil callback dgn File yg dipilih/di-drop
function setupDropzone(zoneEl, inputEl, onFile) {
  if (!zoneEl || !inputEl) return;
  zoneEl.addEventListener('click', () => inputEl.click());
  inputEl.addEventListener('change', () => {
    if (inputEl.files && inputEl.files[0]) onFile(inputEl.files[0]);
    inputEl.value = '';
  });
  ['dragenter', 'dragover'].forEach(evt => zoneEl.addEventListener(evt, (e) => {
    e.preventDefault(); e.stopPropagation(); zoneEl.classList.add('dragover');
  }));
  ['dragleave', 'dragend'].forEach(evt => zoneEl.addEventListener(evt, (e) => {
    e.preventDefault(); e.stopPropagation(); zoneEl.classList.remove('dragover');
  }));
  zoneEl.addEventListener('drop', (e) => {
    e.preventDefault(); e.stopPropagation();
    zoneEl.classList.remove('dragover');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) onFile(f);
  });
}

// convert file gambar apapun (jpg/webp/screenshot dll) jadi PNG blob,
// biar konsisten sama konvensi penamaan thumbnail (kode_produk.png)
function imageFileToPngBlob(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Gagal memproses gambar')), 'image/png');
      };
      img.onerror = () => reject(new Error('File gambar tidak valid'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Gagal membaca file'));
    reader.readAsDataURL(file);
  });
}

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

const lampiranModal = document.getElementById('lampiran-modal');
const lampiranTitle = document.getElementById('lampiran-title');
const lampiranStatus = document.getElementById('lampiran-status');
const lampiranPages = document.getElementById('lampiran-pages');
const lampiranPicker = document.getElementById('lampiran-picker');
const lampiranSearchInput = document.getElementById('lampiran-search-input');
const lampiranSuggestList = document.getElementById('lampiran-suggest-list');
const lampiranSaveRow = document.getElementById('lampiran-save-row');
const lampiranSaveBtn = document.getElementById('lampiran-save-btn');
const lampiranGantiBtn = document.getElementById('lampiran-ganti-btn');
const lampiranDropzone = document.getElementById('lampiran-dropzone');
const lampiranFileInput = document.getElementById('lampiran-file-input');
const lampiranUploadStatus = document.getElementById('lampiran-upload-status');
document.getElementById('lampiran-close').addEventListener('click', () => lampiranModal.classList.remove('show'));
lampiranModal.addEventListener('click', (e) => { if (e.target === lampiranModal) lampiranModal.classList.remove('show'); });

// MODAL PREVIEW GAMBAR PRODUK (dipicu tombol mata di kartu hasil pencarian)
const gambarModal = document.getElementById('gambar-modal');
const gambarTitle = document.getElementById('gambar-title');
const gambarStatus = document.getElementById('gambar-status');
const gambarImg = document.getElementById('gambar-img');
const gambarGantiBtn = document.getElementById('gambar-ganti-btn');
const gambarDropzone = document.getElementById('gambar-dropzone');
const gambarFileInput = document.getElementById('gambar-file-input');
const gambarUploadStatus = document.getElementById('gambar-upload-status');
document.getElementById('gambar-close').addEventListener('click', () => gambarModal.classList.remove('show'));
gambarModal.addEventListener('click', (e) => { if (e.target === gambarModal) gambarModal.classList.remove('show'); });

// ══════════════════════════════════════════
// REFERENSI SCREENSHOT PERMINTAAN RS: dipicu tiap kali OCR (Tesseract) berhasil
// baca gambar di modal Catat Permintaan RS. Gambarnya DISIMPEN CUMA DI MEMORY TAB
// INI (object URL dari File asli) — sengaja gak diupload ke Supabase Storage,
// biar user masih bisa cek balik ke sumber kalau parsing OCR meleset (sering
// kejadian), tanpa nambah beban storage tiap konversi. Konsekuensinya: ilang
// begitu tab ditutup/direfresh — itu trade-off yang disengaja buat v1, bukan bug.
// Ditampilin di 2 tempat pake container beda (renderSsRefStrip loop keduanya):
// 1) pr-ss-ref-strip — di modal intake, biar kecek pas ngedit hasil parse.
// 2) kb-ss-ref-strip — di panel Kebutuhan RS, karena OCR yang meleset biasanya
//    baru ketauan pas proses matching, bukan pas upload.
// ══════════════════════════════════════════
let ssReferences = []; // [{id, url, filename}]
let ssRefLightboxIndex = 0;
const prSsRefStrip = document.getElementById('pr-ss-ref-strip');
const kbSsRefStrip = document.getElementById('kb-ss-ref-strip');
const ssRefModal = document.getElementById('ss-ref-modal');
const ssRefImg = document.getElementById('ss-ref-img');
const ssRefCounter = document.getElementById('ss-ref-counter');
const ssRefPrevBtn = document.getElementById('ss-ref-prev');
const ssRefNextBtn = document.getElementById('ss-ref-next');

function addSsReference(file) {
  const ref = { id: 'ss_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), url: URL.createObjectURL(file), filename: file.name };
  ssReferences.push(ref);
  renderSsRefStrip();
  return ref;
}

// Dipanggil pas ganti/keluar konteks sesi (mulai sesi baru, sesi selesai, sesi
// dihapus, pindah buka sesi lain) — lihat resetChecklistUI(). Object URL WAJIB
// di-revoke di sini, kalau enggak nyangkut di memory browser sampai tab ditutup.
function resetSsReferences() {
  ssReferences.forEach(r => URL.revokeObjectURL(r.url));
  ssReferences = [];
  renderSsRefStrip();
}

function ssRefStripHtml() {
  const chips = ssReferences.map((r, idx) => `<button type="button" class="ss-ref-chip" data-idx="${idx}" title="Lihat screenshot ${idx + 1} dari ${ssReferences.length}" style="flex-shrink:0;padding:0;border:1.5px solid var(--border-strong);border-radius:8px;overflow:hidden;cursor:pointer;width:48px;height:48px;background:var(--surface-2)">
    <img src="${r.url}" alt="Screenshot ${idx + 1}" style="width:100%;height:100%;object-fit:cover;display:block;pointer-events:none"/>
  </button>`).join('');
  return `<div style="display:flex;align-items:center;gap:8px;padding:6px 2px 10px">
    <span style="font-size:11px;color:var(--text-muted);flex-shrink:0;white-space:nowrap"><i class="ti ti-photo"></i> Referensi:</span>
    <div style="display:flex;gap:6px;overflow-x:auto">${chips}</div>
  </div>`;
}

function renderSsRefStrip() {
  [prSsRefStrip, kbSsRefStrip].forEach(el => {
    if (!el) return;
    if (!ssReferences.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.innerHTML = ssRefStripHtml();
    el.style.display = 'block';
    el.querySelectorAll('.ss-ref-chip').forEach(btn => {
      btn.addEventListener('click', () => openSsRefLightbox(parseInt(btn.dataset.idx, 10)));
    });
  });
}

function openSsRefLightbox(idx) {
  if (!ssReferences.length) return;
  ssRefLightboxIndex = Math.max(0, Math.min(idx, ssReferences.length - 1));
  renderSsRefLightbox();
  ssRefModal.classList.add('show');
}

function renderSsRefLightbox() {
  const ref = ssReferences[ssRefLightboxIndex];
  if (!ref) return;
  ssRefImg.src = ref.url;
  ssRefCounter.textContent = ssReferences.length > 1 ? `Gambar ${ssRefLightboxIndex + 1} dari ${ssReferences.length}` : '';
  const multi = ssReferences.length > 1;
  ssRefPrevBtn.style.visibility = multi ? 'visible' : 'hidden';
  ssRefNextBtn.style.visibility = multi ? 'visible' : 'hidden';
}

document.getElementById('ss-ref-close').addEventListener('click', () => ssRefModal.classList.remove('show'));
ssRefModal.addEventListener('click', (e) => { if (e.target === ssRefModal) ssRefModal.classList.remove('show'); });
ssRefPrevBtn.addEventListener('click', () => { ssRefLightboxIndex = (ssRefLightboxIndex - 1 + ssReferences.length) % ssReferences.length; renderSsRefLightbox(); });
ssRefNextBtn.addEventListener('click', () => { ssRefLightboxIndex = (ssRefLightboxIndex + 1) % ssReferences.length; renderSsRefLightbox(); });

let gambarCurrentKodeForUrl = null;

function openGambarModal(kode_asli, kode_produk, nama_produk) {
  const kodeForUrl = (kode_asli && kode_asli.trim()) ? kode_asli.trim() : kode_produk;
  gambarCurrentKodeForUrl = kodeForUrl;
  gambarTitle.textContent = nama_produk || 'Gambar Produk';
  gambarImg.style.display = 'none';
  gambarDropzone.style.display = 'none';
  gambarUploadStatus.style.display = 'none';
  gambarGantiBtn.style.display = 'none';
  gambarStatus.style.display = 'block';
  gambarStatus.style.color = 'var(--text-muted)';
  gambarStatus.textContent = 'Memuat gambar…';
  gambarModal.classList.add('show');

  const url = THUMB_BASE + kodeForUrl + '.png';
  gambarImg.onload = () => { gambarStatus.style.display = 'none'; gambarImg.style.display = 'block'; gambarDropzone.style.display = 'none'; gambarGantiBtn.style.display = 'inline-block'; };
  gambarImg.onerror = () => {
    gambarStatus.style.display = 'none';
    gambarGantiBtn.style.display = 'none';
    showGambarDropzone();
  };
  gambarImg.src = url;
}

function showGambarDropzone() {
  gambarImg.style.display = 'none';
  gambarStatus.style.display = 'none';
  gambarUploadStatus.style.display = 'none';
  gambarDropzone.style.display = 'flex';
}
gambarGantiBtn.addEventListener('click', showGambarDropzone);

setupDropzone(gambarDropzone, gambarFileInput, handleGambarFileDropped);

async function handleGambarFileDropped(file) {
  if (!gambarCurrentKodeForUrl) return;
  if (!file.type.startsWith('image/')) {
    showToast('File harus berupa gambar (foto/screenshot).', 'error');
    return;
  }
  gambarDropzone.style.display = 'none';
  gambarUploadStatus.style.display = 'block';
  gambarUploadStatus.textContent = `Mengunggah "${file.name}"…`;
  try {
    const pngBlob = await imageFileToPngBlob(file);
    await uploadToSupabaseStorage('thumbnails', gambarCurrentKodeForUrl + '.png', pngBlob, 'image/png');
    gambarUploadStatus.textContent = 'Berhasil diunggah ✓';
    gambarStatus.style.display = 'block';
    gambarStatus.style.color = 'var(--text-muted)';
    gambarStatus.textContent = 'Memuat gambar…';
    gambarImg.onload = () => { gambarStatus.style.display = 'none'; gambarUploadStatus.style.display = 'none'; gambarImg.style.display = 'block'; gambarGantiBtn.style.display = 'inline-block'; };
    gambarImg.onerror = () => { gambarUploadStatus.textContent = 'Gambar sudah diunggah, tapi gagal dimuat ulang — coba buka lagi.'; };
    gambarImg.src = THUMB_BASE + gambarCurrentKodeForUrl + '.png?t=' + Date.now();
  } catch (e) {
    gambarUploadStatus.textContent = 'Gagal mengunggah: ' + (e.message || e);
    gambarDropzone.style.display = 'flex';
  }
}

let lampiranBucketFiles = null; // cache daftar file di bucket
let lampiranCurrentProdukId = null;
let lampiranCurrentKode = null;
let lampiranCurrentFilename = null;

async function getProdukId(kode_produk) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/produk?kode_produk=eq.${encodeURIComponent(kode_produk)}&select=id&limit=1`, {
    headers: {'apikey':ANON_KEY,'Authorization':'Bearer '+ANON_KEY}
  });
  const data = await r.json();
  return (data && data.length) ? data[0].id : null;
}

async function getSavedBrosurUrl(produk_id) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/produk_media?produk_id=eq.${produk_id}&jenis=eq.brosur&select=url&limit=1`, {
    headers: {'apikey':ANON_KEY,'Authorization':'Bearer '+ANON_KEY}
  });
  const data = await r.json();
  return (data && data.length) ? data[0].url : null;
}

async function listLampiranBucket() {
  if (lampiranBucketFiles) return lampiranBucketFiles;
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/list/lampiran-unit`, {
    method: 'POST',
    headers: {'apikey':ANON_KEY,'Authorization':'Bearer '+ANON_KEY,'Content-Type':'application/json'},
    body: JSON.stringify({prefix:'', limit:1000, offset:0, sortBy:{column:'name',order:'asc'}})
  });
  const data = await r.json();
  lampiranBucketFiles = (Array.isArray(data) ? data : []).map(f => f.name).filter(n => n && n.toLowerCase().endsWith('.pdf'));
  return lampiranBucketFiles;
}

function renderSuggestList(filterText) {
  const q = (filterText||'').toLowerCase().trim();
  const files = lampiranBucketFiles || [];
  const matches = q ? files.filter(f => f.toLowerCase().includes(q)) : files;
  if (!matches.length) {
    lampiranSuggestList.innerHTML = `<div style="padding:10px;font-size:12px;color:var(--text-muted)">Tidak ada file yang cocok.</div>`;
    lampiranSuggestList.style.display = 'block';
    return;
  }
  lampiranSuggestList.innerHTML = matches.slice(0, 50).map(f =>
    `<div class="lampiran-suggest-item" data-file="${f.replace(/"/g,'&quot;')}" style="padding:8px 10px;font-size:13px;cursor:pointer;border-bottom:1px solid var(--border)">${f}</div>`
  ).join('');
  lampiranSuggestList.style.display = 'block';
  lampiranSuggestList.querySelectorAll('.lampiran-suggest-item').forEach(el => {
    el.addEventListener('mouseenter', () => el.style.background = 'var(--surface-2)');
    el.addEventListener('mouseleave', () => el.style.background = '');
    el.addEventListener('click', () => selectLampiranFile(el.dataset.file));
  });
}

async function selectLampiranFile(filename) {
  lampiranCurrentFilename = filename;
  lampiranSearchInput.value = filename;
  lampiranSuggestList.style.display = 'none';
  const url = LAMPIRAN_BASE + encodeURIComponent(filename);
  try {
    await renderPdfFromUrl(url);
    lampiranSaveRow.style.display = 'flex';
    lampiranGantiBtn.style.display = 'inline-block';
  } catch (e) {
    lampiranStatus.style.display = 'block';
    lampiranStatus.textContent = 'Gagal buka file itu: ' + (e.message||e);
  }
}

lampiranSearchInput.addEventListener('input', () => renderSuggestList(lampiranSearchInput.value));
lampiranSearchInput.addEventListener('focus', () => renderSuggestList(lampiranSearchInput.value));

async function renderPdfFromUrl(pdfUrl) {
  lampiranPages.innerHTML = '';
  lampiranStatus.style.display = 'block';
  lampiranStatus.textContent = 'Memuat PDF…';
  const pdf = await pdfjsLib.getDocument(pdfUrl).promise;
  lampiranStatus.textContent = `Merender ${pdf.numPages} halaman…`;
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    const img = document.createElement('img');
    img.src = canvas.toDataURL('image/jpeg', 0.85);
    img.style.cssText = 'width:100%;border:1px solid var(--border);border-radius:8px;display:block';
    lampiranPages.appendChild(img);
    lampiranStatus.textContent = `Merender halaman ${p} / ${pdf.numPages}…`;
  }
  lampiranStatus.style.display = 'none';
}

// versi headless (tanpa render ke DOM) buat dipakai di export Excel
async function getPdfPagesBase64(pdfUrl, scale = 1.5) {
  const pdf = await pdfjsLib.getDocument(pdfUrl).promise;
  const pages = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    pages.push({
      base64: canvas.toDataURL('image/jpeg', 0.85).split(',')[1],
      width: viewport.width,
      height: viewport.height
    });
  }
  return pages;
}

// ambil halaman lampiran (PDF) suatu kode produk, pakai prioritas yg sama dgn modal: saved url -> auto match -> kosong
async function getLampiranPagesForKode(kode_produk) {
  function filenameFromUrl(url) {
    try {
      const last = url.split('/').pop().split('?')[0];
      return decodeURIComponent(last).replace(/\.pdf$/i, '');
    } catch (e) { return kode_produk; }
  }
  try {
    const produk_id = await getProdukId(kode_produk);
    if (produk_id) {
      const savedUrl = await getSavedBrosurUrl(produk_id);
      if (savedUrl) {
        try {
          const pages = await getPdfPagesBase64(savedUrl);
          return { filename: filenameFromUrl(savedUrl), pages };
        } catch (e) { /* lanjut coba auto */ }
      }
    }
  } catch (e) {}
  const autoUrl = LAMPIRAN_BASE + encodeURIComponent(kode_produk) + '.pdf';
  try {
    const pages = await getPdfPagesBase64(autoUrl);
    return { filename: filenameFromUrl(autoUrl), pages };
  } catch (e) {
    return { filename: kode_produk, pages: [] };
  }
}

async function openLampiranModal(kode_produk) {
  lampiranTitle.textContent = 'Lampiran — ' + kode_produk;
  lampiranPages.innerHTML = '';
  lampiranPicker.style.display = 'none';
  lampiranSuggestList.style.display = 'none';
  lampiranSearchInput.value = '';
  lampiranSaveRow.style.display = 'none';
  lampiranGantiBtn.style.display = 'none';
  lampiranUploadStatus.style.display = 'none';
  lampiranDropzone.classList.remove('dragover');
  lampiranSaveBtn.disabled = false;
  lampiranSaveBtn.textContent = 'Simpan';
  lampiranStatus.style.display = 'block';
  lampiranStatus.textContent = 'Memuat lampiran…';
  lampiranModal.classList.add('show');
  lampiranCurrentKode = kode_produk;
  lampiranCurrentFilename = null;

  const produk_id = await getProdukId(kode_produk);
  lampiranCurrentProdukId = produk_id;

  // 1. Cek apakah sudah ada link tersimpan manual di produk_media
  if (produk_id) {
    const savedUrl = await getSavedBrosurUrl(produk_id);
    if (savedUrl) {
      try {
        await renderPdfFromUrl(savedUrl);
        lampiranGantiBtn.style.display = 'inline-block';
        return;
      }
      catch (e) { /* lanjut coba cara lain */ }
    }
  }

  // 2. Coba auto-match kode_produk.pdf
  const autoUrl = LAMPIRAN_BASE + encodeURIComponent(kode_produk) + '.pdf';
  try {
    await renderPdfFromUrl(autoUrl);
    lampiranGantiBtn.style.display = 'inline-block';
    return;
  } catch (e) {
    // 3. Gagal — tampilkan picker dengan daftar suggestion
    await showLampiranPicker();
  }
}

async function showLampiranPicker() {
  lampiranPages.innerHTML = '';
  lampiranGantiBtn.style.display = 'none';
  lampiranUploadStatus.style.display = 'none';
  lampiranStatus.style.display = 'block';
  lampiranStatus.textContent = 'Pilih file lampiran PDF:';
  lampiranPicker.style.display = 'block';
  lampiranSearchInput.value = '';
  try {
    await listLampiranBucket();
    renderSuggestList('');
  } catch (e2) {
    lampiranStatus.textContent = 'Gagal mengambil daftar file dari bucket: ' + (e2.message||e2);
  }
}

lampiranGantiBtn.addEventListener('click', () => { showLampiranPicker(); });

setupDropzone(lampiranDropzone, lampiranFileInput, handleLampiranFileDropped);

// upload brosur baru (dari WA/HP/dll, belum ada di bucket) lalu langsung dipakai sbg lampiran
async function handleLampiranFileDropped(file) {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (!isPdf) {
    showToast('File harus berupa PDF.', 'error');
    return;
  }
  lampiranSuggestList.style.display = 'none';
  lampiranUploadStatus.style.display = 'block';
  lampiranUploadStatus.textContent = `Mengunggah "${file.name}"…`;

  // Nama asli dari WA/HP bisa ngandung karakter unicode "siluman" (nbsp, smart
  // quote, dash khusus, dll) yang bikin Supabase Storage nolak dgn "InvalidKey".
  // Jadi key yg dikirim ke Storage WAJIB versi yang sudah disanitasi;
  // nama asli (file.name) cuma dipakai buat teks status yg dilihat user.
  const safeName = sanitizeStorageFileName(file.name);

  try {
    await uploadToSupabaseStorage('lampiran-unit', safeName, file, 'application/pdf');
    lampiranBucketFiles = null; // reset cache biar file baru ikut muncul di daftar lain kali
    lampiranUploadStatus.textContent = safeName === file.name
      ? `Berhasil diunggah: ${file.name}`
      : `Berhasil diunggah sbg "${safeName}" (nama asli: ${file.name})`;
    await selectLampiranFile(safeName); // pakai safeName krn itu key sebenarnya di bucket
  } catch (e) {
    lampiranUploadStatus.textContent = 'Gagal mengunggah: ' + (e.message || e);
  }
}

lampiranSaveBtn.addEventListener('click', async () => {
  if (!lampiranCurrentProdukId || !lampiranCurrentFilename) return;
  lampiranSaveBtn.disabled = true;
  lampiranSaveBtn.textContent = 'Menyimpan…';
  try {
    const url = LAMPIRAN_BASE + encodeURIComponent(lampiranCurrentFilename);
    const r = await fetch(`${SUPABASE_URL}/rest/v1/produk_media`, {
      method: 'POST',
      headers: {'apikey':ANON_KEY,'Authorization':'Bearer '+ANON_KEY,'Content-Type':'application/json','Prefer':'return=minimal'},
      body: JSON.stringify({
        produk_id: lampiranCurrentProdukId,
        jenis: 'brosur',
        judul: lampiranCurrentFilename,
        url: url,
        is_primary: true,
        urutan: 1
      })
    });
    if (!r.ok) throw new Error(await r.text());
    lampiranSaveBtn.textContent = 'Tersimpan ✓';
  } catch (e) {
    lampiranSaveBtn.disabled = false;
    lampiranSaveBtn.textContent = 'Simpan';
    showToast('Gagal simpan lampiran: ' + (e.message||e), 'error');
  }
});

// STATE
let clipboard = [];
let acItems = [], acIndex = -1, onlyAkd = false, selectedTipe = null, acTimer = null;
let lastResults = [];
let modeSwasta = false;
let sortMode = 'relevance';
let prioritizeLink = true; // produk yang ada link_v6 diprioritaskan (hanya berlaku saat mode e-katalog)
const RESULTS_PER_PAGE = 20;
let currentPage = 1;

// ELEMENTS
const searchInput = document.getElementById('search-input');
const clearBtn = document.getElementById('clear-btn');
const acBox = document.getElementById('autocomplete');
const resultsEl = document.getElementById('results');
const paginationEl = document.getElementById('pagination');
const metaEl = document.getElementById('meta');
const loadingEl = document.getElementById('loading');
const emptyEl = document.getElementById('empty');
const hintEl = document.getElementById('hint');
const errEl = document.getElementById('err');
const tipeBtns = document.querySelectorAll('.tipe-btn');
const takd = document.getElementById('takd');
const tswasta = document.getElementById('tswasta');
const sortSelect = document.getElementById('sort-select');
const clipList = document.getElementById('clip-list');
const clipEmpty = document.getElementById('clip-empty');
const clipTotal = document.getElementById('clip-total');
const hdrCount = document.getElementById('hdr-count');
const btnExport = document.getElementById('btn-export');
const btnClearAll = document.getElementById('btn-clear-all');
const inpRs = document.getElementById('inp-rs');
const inpSales = document.getElementById('inp-sales');
const inpMarsup = document.getElementById('inp-marsup');
const btnRecord = document.getElementById('btn-record');
const clipHeader = document.getElementById('clip-header');
const clipHeaderToggle = document.getElementById('clip-header-toggle');
const clipHeaderCompact = document.getElementById('clip-header-compact');
const clipTotalHarga = document.getElementById('clip-total-harga');
const clipBudget = document.getElementById('clip-budget');

// ══════════════════════════════════════════
// RESIZE PANEL CLIPBOARD: drag manual lewat handle (pointer events, mouse+touch),
// dobel klik buat reset cepat ke lebar Normal. Lebar disimpan di localStorage
// per browser, jadi tiap orang bisa atur sesuai layar masing-masing dan gak
// ke-reset tiap refresh.
// ══════════════════════════════════════════
const CLIP_WIDTH_KEY = 'pnm_clip_width';
const CLIP_WIDTH_MIN = 300;
const CLIP_WIDTH_MAX = 640;
const CLIP_WIDTH_DEFAULT = 340;
const clipResizeHandle = document.getElementById('clip-resize-handle');

function setClipWidth(px, persist = true) {
  const clamped = Math.min(CLIP_WIDTH_MAX, Math.max(CLIP_WIDTH_MIN, Math.round(px)));
  document.documentElement.style.setProperty('--clip-width', clamped + 'px');
  if (persist) localStorage.setItem(CLIP_WIDTH_KEY, String(clamped));
  return clamped;
}

(function initClipWidth() {
  const saved = parseInt(localStorage.getItem(CLIP_WIDTH_KEY), 10);
  setClipWidth(!isNaN(saved) ? saved : CLIP_WIDTH_DEFAULT, false);
})();

// Drag manual lewat resize handle. Panel clipboard ada di sisi kanan, jadi
// menyeret handle ke kiri (dx negatif) memperlebar panel — width baru dihitung
// dari jarak kursor ke tepi kanan layar (bukan cuma delta X saja), supaya tetap
// akurat walau resize dimulai/dilepas di titik mana pun.
let clipDragPointerId = null;
function onClipResizeMove(e) {
  if (clipDragPointerId === null) return;
  const newWidth = window.innerWidth - e.clientX;
  setClipWidth(newWidth, false);
}
function endClipResize(e) {
  if (clipDragPointerId === null) return;
  clipResizeHandle.classList.remove('dragging');
  document.body.style.userSelect = '';
  try { clipResizeHandle.releasePointerCapture(clipDragPointerId); } catch {}
  clipDragPointerId = null;
  // baru persist ke localStorage di akhir drag, biar gak nulis tiap pixel gerak
  const current = getComputedStyle(document.documentElement).getPropertyValue('--clip-width');
  setClipWidth(parseInt(current, 10) || CLIP_WIDTH_DEFAULT, true);
  document.removeEventListener('pointermove', onClipResizeMove);
  document.removeEventListener('pointerup', endClipResize);
}
clipResizeHandle.addEventListener('pointerdown', (e) => {
  clipDragPointerId = e.pointerId;
  clipResizeHandle.classList.add('dragging');
  document.body.style.userSelect = 'none';
  try { clipResizeHandle.setPointerCapture(e.pointerId); } catch {}
  document.addEventListener('pointermove', onClipResizeMove);
  document.addEventListener('pointerup', endClipResize);
});
// Dobel klik handle = reset cepat ke lebar Normal, buat yang kepencet kejauhan pas drag.
clipResizeHandle.addEventListener('dblclick', () => setClipWidth(CLIP_WIDTH_DEFAULT));

// ══════════════════════════════════════════
// COLLAPSE PANEL PENCARIAN: kalau lagi fokus nyocokin clipboard, panel kiri
// bisa diciutkan jadi rail tipis biar area clipboard dapat ruang penuh.
// Status ciutan/enggak disimpan per sesi browser (sessionStorage), bukan
// selamanya — biar gak bikin bingung kalau lain kali buka lagi dari awal.
// ══════════════════════════════════════════
const PANEL_SEARCH_COLLAPSE_KEY = 'pnm_panel_search_collapsed';
const panelSearchEl = document.getElementById('panel-search');
const panelSearchCollapseBtn = document.getElementById('panel-search-collapse-btn');
const panelSearchRail = document.getElementById('panel-search-rail');
function setPanelSearchCollapsed(collapsed, persist = true) {
  panelSearchEl.classList.toggle('collapsed', collapsed);
  panelSearchRail.title = 'Buka panel pencarian';
  if (persist) sessionStorage.setItem(PANEL_SEARCH_COLLAPSE_KEY, collapsed ? '1' : '0');
}
if (panelSearchCollapseBtn && panelSearchRail) {
  panelSearchCollapseBtn.addEventListener('click', () => setPanelSearchCollapsed(true));
  panelSearchRail.addEventListener('click', () => setPanelSearchCollapsed(false));
  panelSearchRail.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPanelSearchCollapsed(false); }
  });
  setPanelSearchCollapsed(sessionStorage.getItem(PANEL_SEARCH_COLLAPSE_KEY) === '1', false);
}

// ══════════════════════════════════════════
// PREFERENSI / SETTINGS: dirancang biar gampang nambah setting baru — tinggal
// push satu entry ke SETTINGS_SCHEMA (key, label, deskripsi, default, dan
// callback onChange kalau perlu efek langsung), modal otomatis nge-render
// togglenya. Tema (Light/Dark) tetap pakai sistem localStorage yang sudah
// ada di bawah (biar gak duplikat/nabrak), tapi tetap ditampilkan sebagai
// baris pertama di modal ini biar semua preferensi ada di satu tempat.
// ══════════════════════════════════════════
const PNM_SETTINGS_KEY = 'pnm_settings';
const PNM_SETTINGS_DEFAULT = { autoComplete: true };
function loadPnmSettings() {
  try {
    return Object.assign({}, PNM_SETTINGS_DEFAULT, JSON.parse(localStorage.getItem(PNM_SETTINGS_KEY) || '{}'));
  } catch {
    return Object.assign({}, PNM_SETTINGS_DEFAULT);
  }
}
let pnmSettings = loadPnmSettings();
function savePnmSettings() {
  localStorage.setItem(PNM_SETTINGS_KEY, JSON.stringify(pnmSettings));
}

// Tambah setting baru di sini nanti — tidak perlu ubah HTML modal.
const SETTINGS_SCHEMA = [
  {
    key: 'autoComplete',
    label: 'Auto Complete',
    desc: 'Tampilkan saran ejaan otomatis di bawah kolom pencarian sambil mengetik.',
    onChange: (val) => { if (!val) { acBox.style.display = 'none'; acBox.innerHTML = ''; } }
  }
];

const settingsModal = document.getElementById('settings-modal');
const settingsToggleBtn = document.getElementById('settings-toggle');
const settingsModalClose = document.getElementById('settings-modal-close');
const settingsListEl = document.getElementById('settings-list');

function isDarkThemeActive() {
  return document.documentElement.getAttribute('data-theme') === 'dark';
}

function renderSettingsList() {
  const dark = isDarkThemeActive();
  let html = `
    <div class="pref-row">
      <div>
        <div class="pref-row-label">Tema</div>
        <div class="pref-row-desc">Pilih tampilan terang atau gelap untuk seluruh workspace.</div>
      </div>
      <div class="pref-switch ${dark ? 'on' : ''}" id="pref-theme-switch" role="switch" aria-checked="${dark}" tabindex="0">
        <div class="knob"><i class="ph ${dark ? 'ph-moon' : 'ph-sun'}"></i></div>
      </div>
    </div>
  `;
  html += SETTINGS_SCHEMA.map(s => `
    <div class="pref-row">
      <div>
        <div class="pref-row-label">${s.label}</div>
        <div class="pref-row-desc">${s.desc}</div>
      </div>
      <div class="pref-switch ${pnmSettings[s.key] ? 'on' : ''}" data-pref-key="${s.key}" role="switch" aria-checked="${!!pnmSettings[s.key]}" tabindex="0"><div class="knob"></div></div>
    </div>
  `).join('');
  settingsListEl.innerHTML = html;

  const themeSwitch = document.getElementById('pref-theme-switch');
  themeSwitch.addEventListener('click', () => {
    // Reuse tombol theme-toggle yang sudah ada di header, biar logika
    // penyimpanan tema (localStorage 'theme'/'pnum-theme' + ikon) gak dobel.
    document.getElementById('theme-toggle').click();
    renderSettingsList();
  });

  settingsListEl.querySelectorAll('.pref-switch[data-pref-key]').forEach(el => {
    const toggle = () => {
      const key = el.dataset.prefKey;
      pnmSettings[key] = !pnmSettings[key];
      savePnmSettings();
      el.classList.toggle('on', pnmSettings[key]);
      el.setAttribute('aria-checked', String(pnmSettings[key]));
      const schema = SETTINGS_SCHEMA.find(s => s.key === key);
      if (schema && typeof schema.onChange === 'function') schema.onChange(pnmSettings[key]);
    };
    el.addEventListener('click', toggle);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  });
}

function openSettingsModal() { renderSettingsList(); settingsModal.classList.add('show'); }
function closeSettingsModal() { settingsModal.classList.remove('show'); }
if (settingsToggleBtn) settingsToggleBtn.addEventListener('click', openSettingsModal);
if (settingsModalClose) settingsModalClose.addEventListener('click', closeSettingsModal);
if (settingsModal) settingsModal.addEventListener('click', (e) => { if (e.target === settingsModal) closeSettingsModal(); });

// ══════════════════════════════════════════
// STATUS KONEKSI: banner + toast saat internet putus/nyambung lagi. Aksi yang
// gagal karena offline (search, simpan sesi, dll) tetap dikasih tau lewat toast
// error masing-masing seperti biasa — banner ini cuma indikator ambient.
// ══════════════════════════════════════════
const offlineBanner = document.getElementById('offline-banner');
function updateOnlineStatus() {
  const isOnline = navigator.onLine;
  offlineBanner.classList.toggle('show', !isOnline);
  if (isOnline && offlineBanner.dataset.wasOffline === '1') {
    showToast('Koneksi kembali normal ✓');
  }
  offlineBanner.dataset.wasOffline = isOnline ? '0' : '1';
}
window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);
updateOnlineStatus();

// ══════════════════════════════════════════
// SESI KONVERSI: bikin "clipboard" jadi objek yang tersimpan di server,
// bukan array lokal doang. Satu sesi = satu konversi yang lagi dikerjakan,
// bisa dibuka lagi (dan dibantu tim lain) dari daftar "Konversi Berjalan".
// ══════════════════════════════════════════
const SESI_TABLE = 'sesi_konversi';
const SESI_ITEM_TABLE = 'sesi_konversi_item';
let currentSesiId = null;
let currentButuhBantuan = false;

const subtabCari = document.getElementById('subtab-cari');
const subtabSesi = document.getElementById('subtab-sesi');
const subtabRiwayat = document.getElementById('subtab-riwayat');
const subtabConverter = document.getElementById('subtab-converter');
const subtabSetcari = document.getElementById('subtab-setcari');
const subtabDictionary = document.getElementById('subtab-dictionary');
const cariControls = document.getElementById('cari-controls');
const panelBodyCari = document.getElementById('panel-body-cari');
const panelBodySesi = document.getElementById('panel-body-sesi');
const panelBodyRiwayat = document.getElementById('panel-body-riwayat');
const panelBodyConverter = document.getElementById('panel-body-converter');
const panelBodySetcari = document.getElementById('panel-body-setcari');
const panelBodyDictionary = document.getElementById('panel-body-dictionary');
const setcariBadge = document.getElementById('setcari-badge');
// Refs modul "Cari SET Mendekati" — dideklarasikan di sini (bukan di dekat
// fungsi-fungsinya di bawah) karena updateClipboard() manggil
// updateSetcariSourceCount() sejak load pertama; kalau const-nya baru
// dideklarasikan belakangan, ini ReferenceError (temporal dead zone).
const setcariSearchBtn = document.getElementById('setcari-search-btn');
const setcariStatus = document.getElementById('setcari-status');
const setcariEmpty = document.getElementById('setcari-empty');
const setcariList = document.getElementById('setcari-list');
const setcariSourceCount = document.getElementById('setcari-source-count');
const riwayatList = document.getElementById('riwayat-list');
const riwayatListEmpty = document.getElementById('riwayat-list-empty');
const riwayatListLoading = document.getElementById('riwayat-list-loading');
const riwayatListError = document.getElementById('riwayat-list-error');
const btnRiwayatRefresh = document.getElementById('btn-riwayat-refresh');
const riwayatSearchInput = document.getElementById('riwayat-search-input');
const riwayatClearBtn = document.getElementById('riwayat-clear-btn');
let riwayatSearchDebounce = null;
const sesiBadge = document.getElementById('sesi-badge');
const sesiList = document.getElementById('sesi-list');
const sesiListEmpty = document.getElementById('sesi-list-empty');
const sesiListLoading = document.getElementById('sesi-list-loading');
const sesiListError = document.getElementById('sesi-list-error');
const btnSesiBaru = document.getElementById('btn-sesi-baru');
const btnSesiRefresh = document.getElementById('btn-sesi-refresh');
const btnButuhBantuan = document.getElementById('btn-butuh-bantuan');
const sesiSaveStatus = document.getElementById('sesi-save-status');
const sessionIndicator = document.getElementById('session-indicator');
const sessionIndicatorDot = document.getElementById('session-indicator-dot');
const sessionIndicatorText = document.getElementById('session-indicator-text');
const btnEndSesi = document.getElementById('btn-end-sesi');
const toastContainer = document.getElementById('toast-container');
const APP_TITLE_BASE = document.title; // "Conversion Workspace — PT Pionir Nusantara Manufacturing"

// Notifikasi kecil yang muncul-hilang sendiri — dipakai buat kasih feedback instan
// untuk aksi yang sebelumnya senyap (bikin sesi, selesaikan sesi), biar user gak
// ragu-ragu apakah aksinya beneran kejadian atau enggak.
function showToast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  const icon = type === 'error' ? 'ti-alert-circle' : (type === 'presence' ? 'ti-users' : 'ti-circle-check');
  el.innerHTML = `<i class="ti ${icon}"></i><span></span>`;
  el.querySelector('span').textContent = msg;
  toastContainer.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 2600);
}

// Render pesan error yang seragam buat daftar (Sesi/Riwayat/Dictionary), lengkap
// sama tombol "Coba lagi" — biar user gak harus pindah tab/refresh cuma buat
// nyoba ulang satu request yang gagal (misal gara-gara koneksi sempat putus).
function renderListError(el, msg, retryFn) {
  el.innerHTML = `<div>${msg}</div><button type="button" class="list-error-retry-btn" style="margin-top:8px;background:none;border:1px solid var(--danger-border);color:var(--danger);border-radius:6px;padding:4px 10px;font-size:11.5px;font-weight:600;cursor:pointer;font-family:inherit">Coba lagi</button>`;
  el.style.display = 'block';
  const btn = el.querySelector('.list-error-retry-btn');
  if (btn) btn.addEventListener('click', retryFn);
}

// Tombol "Selesaikan Sesi" cuma boleh aktif kalau memang lagi ada sesi yang
// berjalan di server (currentSesiId keisi) — jadi state-nya selalu nyambung
// sama kenyataan, gak pernah nampilin tombol aktif buat sesi yang gak ada.
function updateEndSesiBtnState() {
  btnEndSesi.disabled = !currentSesiId;
}

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
sessionIndicator.addEventListener('click', () => {
  if (window.innerWidth <= 860 && typeof switchTab === 'function') switchTab('search');
  switchSubTab('sesi');
});

// Semua panggilan REST ke Supabase buat modul sesi lewat sini, supaya kalau
// token expired di tengah jalan, langsung ditendang balik ke gerbang login.
async function sesiFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'apikey': ANON_KEY,
      'Authorization': 'Bearer ' + stokAccessToken,
      ...(options.headers || {})
    }
  });
  if (res.status === 401) { showGate('Sesi kamu habis, silakan masuk lagi.'); throw new Error('Sesi login habis'); }
  return res;
}

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
  if (currentSesiId) return currentSesiId;
  const body = {
    nama_rs: inpRs.value.trim() || null,
    nama_sales: inpSales.value.trim() || null,
    pic_marsup: inpMarsup.value.trim() || null,
    pagu: (typeof checklistPagu !== 'undefined' ? checklistPagu : null),
    status: 'berjalan',
    butuh_bantuan: currentButuhBantuan
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
  currentSesiId = rows[0].id;
  updateEndSesiBtnState();
  updateClipHeaderCompact(); // refresh indikator header (ikut currentSesiId, bukan cuma nama RS)
  if (typeof subscribeToSesiRealtime === 'function') subscribeToSesiRealtime(currentSesiId);
  return currentSesiId;
}

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

async function persistRemoveItem(item) {
  if (!currentSesiId) return;
  setSesiSavedStatus('Menyimpan…');
  try {
    if (item._sesiItemId) {
      await sesiFetch(`${SESI_ITEM_TABLE}?id=eq.${item._sesiItemId}`, { method: 'DELETE' });
    } else {
      await sesiFetch(`${SESI_ITEM_TABLE}?sesi_id=eq.${currentSesiId}&kode_produk=eq.${encodeURIComponent(item.kode_produk)}`, { method: 'DELETE' });
    }
    await touchSesiUpdatedAt(currentSesiId);
    setSesiSavedStatus('Tersimpan ✓');
  } catch (err) {
    setSesiSavedStatus('Gagal hapus: ' + err.message, true);
  }
}

let qtySaveTimer = null;
function persistUpdateQty(item) {
  if (!currentSesiId || !item._sesiItemId) return;
  setSesiSavedStatus('Menyimpan…');
  clearTimeout(qtySaveTimer);
  qtySaveTimer = setTimeout(async () => {
    try {
      await sesiFetch(`${SESI_ITEM_TABLE}?id=eq.${item._sesiItemId}`, {
        method: 'PATCH',
        body: JSON.stringify({ qty: item.qty })
      });
      await touchSesiUpdatedAt(currentSesiId);
      setSesiSavedStatus('Tersimpan ✓');
    } catch (err) {
      setSesiSavedStatus('Gagal simpan qty: ' + err.message, true);
    }
  }, 400);
}

// Nama RS / Sales / PIC diketik → sesi ikut keupdate (bikin baru kalau belum ada)
let headerSaveTimer = null;
[inpRs, inpSales, inpMarsup].forEach(inp => {
  inp.addEventListener('input', () => {
    clearTimeout(headerSaveTimer);
    setSesiSavedStatus('Menyimpan…');
    headerSaveTimer = setTimeout(async () => {
      try {
        const sesiId = await ensureSesi();
        const namaRs = inpRs.value.trim() || null;
        const namaSales = inpSales.value.trim() || null;
        const picMarsup = inpMarsup.value.trim() || null;
        markLocalWrite(SESI_TABLE, sesiId, 'nama_rs', namaRs);
        markLocalWrite(SESI_TABLE, sesiId, 'nama_sales', namaSales);
        markLocalWrite(SESI_TABLE, sesiId, 'pic_marsup', picMarsup);
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

function renderButuhBantuanBtn() {
  btnButuhBantuan.classList.toggle('on', currentButuhBantuan);
  btnButuhBantuan.textContent = currentButuhBantuan ? '🙋 Butuh Bantuan' : '🙋 Minta Bantuan';
}
btnButuhBantuan.addEventListener('click', async () => {
  currentButuhBantuan = !currentButuhBantuan;
  renderButuhBantuanBtn();
  try {
    const sesiId = await ensureSesi();
    markLocalWrite(SESI_TABLE, sesiId, 'butuh_bantuan', currentButuhBantuan);
    await sesiFetch(`${SESI_TABLE}?id=eq.${sesiId}`, {
      method: 'PATCH',
      body: JSON.stringify({ butuh_bantuan: currentButuhBantuan, updated_at: new Date().toISOString() })
    });
    // Baru minta bantuan (bukan batalin) → langsung tawarin kirim link sesinya ke WA,
    // biar temen yang dihubungi bisa langsung klik & buka sesi yang sama.
    if (currentButuhBantuan && await showConfirmModal({ title: 'Minta Bantuan', text: 'Kirim link sesi ini ke WhatsApp sekarang?', okText: 'Ya, Kirim' })) {
      shareSesiToWhatsApp(sesiId, inpRs.value);
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
  if (clipboard.length && !(await showConfirmModal({ title: 'Mulai Sesi Baru', text: 'Sesi yang sedang dibuka akan ditinggalkan — datanya tetap tersimpan, bisa dibuka lagi lewat daftar Konversi Berjalan.', okText: 'Ya, Mulai Baru' }))) return;
  currentSesiId = null;
  currentButuhBantuan = false;
  clipboard = [];
  inpRs.value = '';
  inpSales.value = '';
  updateClipboard();
  renderResults(lastResults);
  setClipHeaderCollapsed(false);
  updateClipHeaderCompact();
  renderButuhBantuanBtn();
  setSesiSavedStatus('');
  resetChecklistUI();
  updateEndSesiBtnState();
  switchSubTab('cari');

  btnSesiBaru.disabled = true;
  try {
    await ensureSesi();
    updateEndSesiBtnState();
    setSesiSavedStatus('Tersimpan ✓');
    showToast('Sesi baru dibuat ✓');
    loadSesiList();
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
btnEndSesi.addEventListener('click', async () => {
  if (!currentSesiId) return;
  const namaAktif = inpRs.value.trim() || '(Nama RS belum diisi)';
  const ok = await showConfirmModal({
    title: 'Selesaikan Sesi',
    text: `Selesaikan sesi "${namaAktif}"? Sesi akan keluar dari daftar Konversi Berjalan, tapi datanya tetap tersimpan.`,
    okText: 'Ya, Selesaikan'
  });
  if (!ok) return;
  btnEndSesi.disabled = true;
  try {
    await sesiFetch(`${SESI_TABLE}?id=eq.${currentSesiId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'selesai', updated_at: new Date().toISOString() })
    });
    currentSesiId = null;
    currentButuhBantuan = false;
    clipboard = [];
    inpRs.value = '';
    inpSales.value = '';
    updateClipboard();
    renderResults(lastResults);
    setClipHeaderCollapsed(false);
    updateClipHeaderCompact();
    renderButuhBantuanBtn();
    setSesiSavedStatus('');
    resetChecklistUI();
    showToast('Sesi diselesaikan ✓');
    loadSesiList();
  } catch (err) {
    showToast('Gagal selesaikan sesi: ' + err.message, 'error');
  } finally {
    updateEndSesiBtnState();
  }
});
btnSesiRefresh.addEventListener('click', loadSesiList);

function switchSubTab(tab) {
  subtabCari.classList.toggle('active', tab === 'cari');
  subtabSesi.classList.toggle('active', tab === 'sesi');
  subtabRiwayat.classList.toggle('active', tab === 'riwayat');
  subtabConverter.classList.toggle('active', tab === 'converter');
  subtabSetcari.classList.toggle('active', tab === 'setcari');
  subtabDictionary.classList.toggle('active', tab === 'dictionary');
  panelBodyCari.style.display = tab === 'cari' ? 'block' : 'none';
  panelBodySesi.style.display = tab === 'sesi' ? 'block' : 'none';
  panelBodyRiwayat.style.display = tab === 'riwayat' ? 'block' : 'none';
  panelBodyConverter.style.display = tab === 'converter' ? 'block' : 'none';
  panelBodySetcari.style.display = tab === 'setcari' ? 'block' : 'none';
  panelBodyDictionary.style.display = tab === 'dictionary' ? 'block' : 'none';
  cariControls.style.display = tab === 'cari' ? 'block' : 'none';
  if (tab === 'sesi') loadSesiList();
  if (tab === 'riwayat') loadRiwayatList();
  if (tab === 'dictionary') loadDictionary();
  if (tab === 'setcari' && typeof updateSetcariSourceCount === 'function') updateSetcariSourceCount();
}
subtabCari.addEventListener('click', () => switchSubTab('cari'));
subtabSesi.addEventListener('click', () => switchSubTab('sesi'));
subtabRiwayat.addEventListener('click', () => switchSubTab('riwayat'));
subtabConverter.addEventListener('click', () => switchSubTab('converter'));
subtabSetcari.addEventListener('click', () => switchSubTab('setcari'));
subtabDictionary.addEventListener('click', () => switchSubTab('dictionary'));

function sesiTimeAgo(iso) {
  if (!iso) return '-';
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'baru saja';
  if (min < 60) return min + ' menit lalu';
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + ' jam lalu';
  return Math.floor(hr / 24) + ' hari lalu';
}

function renderSesiCard(s) {
  const itemCount = (s.sesi_konversi_item && s.sesi_konversi_item[0] && s.sesi_konversi_item[0].count) || 0;
  const namaAman = (s.nama_rs || '(Nama RS belum diisi)').replace(/"/g, '&quot;');
  const bantuanBadge = s.butuh_bantuan
    ? `<span class="tipe-badge" style="background:var(--danger-bg);color:var(--danger)">🙋 Butuh bantuan</span>
       <button class="sesi-wa-btn" data-id="${s.id}" data-nama="${namaAman}" title="Kirim link sesi ini ke WhatsApp" type="button" style="position:absolute;top:8px;right:38px;width:24px;height:24px;border:1px solid var(--success-border);border-radius:6px;background:var(--success-bg);color:var(--success);font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center"><i class="ti ti-brand-whatsapp"></i></button>`
    : '';
  // Ringkasan Permintaan RS (kalau ada) — biar temen yang lagi liat daftar
  // "Konversi Berjalan" langsung tau ada permintaan apa gak di sesi ini,
  // tanpa perlu buka satu-satu dulu.
  const p = s._permintaan;
  const permintaanChip = p
    ? `<span class="mi"><i class="ph ph-clipboard-text"></i><span>Permintaan RS: ${p.items_terpenuhi}/${p.items_total} terpenuhi${p.items_pending > 0 ? ' · ' + p.items_pending + ' belum dicek' : ''}</span></span>`
    : '';
  return `<div class="rcard sesi-card" data-id="${s.id}" style="position:relative">
    <button class="sesi-delete-btn" data-id="${s.id}" data-nama="${(s.nama_rs || '(Nama RS belum diisi)').replace(/"/g, '&quot;')}" title="Hapus sesi ini" type="button"><i class="ti ti-trash"></i></button>
    <div class="rcard-top" style="padding-right:66px">
      <div class="rcard-name">${s.nama_rs ? s.nama_rs : '(Nama RS belum diisi)'}</div>
      ${bantuanBadge}
    </div>
    <div class="rcard-meta">
      <span class="mi"><i class="ti ti-user"></i><span>PIC: ${s.pic_marsup || '-'}</span></span>
      <span class="mi"><i class="ti ti-users"></i><span>Sales: ${s.nama_sales || '-'}</span></span>
      <span class="mi"><i class="ti ti-package"></i><span>${itemCount} produk</span></span>
      ${permintaanChip}
      <span class="mi"><i class="ti ti-clock"></i><span>${sesiTimeAgo(s.updated_at)}</span></span>
    </div>
  </div>`;
}

// Kartu riwayat: sesi yang statusnya 'selesai', apapun hasilnya. Dibedain visual
// pake badge "Jadi Order" (kalau ada baris konversi_record nempel di sesi ini,
// lewat kolom konversi_record.sesi_id) vs "Ditutup Tanpa Order" (kalau enggak —
// artinya ditutup lewat "Selesaikan Sesi", bukan "Record Konversi"). Kalau sesi
// ini udah pernah direvisi (>1 baris konversi_record), badge-nya nunjukin nomor
// REV terakhir + berapa versi yang kesimpen semuanya.
function renderRiwayatCard(s) {
  const itemCount = (s.sesi_konversi_item && s.sesi_konversi_item[0] && s.sesi_konversi_item[0].count) || 0;
  const records = s.konversi_record || [];
  const latest = records.length ? records.reduce((a, b) => (b.revisi > a.revisi ? b : a)) : null;
  const orderBadge = latest
    ? `<span class="badge-jadi-order"><i class="ti ti-circle-check"></i> Jadi Order${latest.revisi > 0 ? ' · REV' + latest.revisi : ''}${latest.grand_total != null ? ' · Rp' + Number(latest.grand_total).toLocaleString('id-ID') : ''}</span>`
    : `<span class="badge-tanpa-order"><i class="ti ti-square-off"></i> Ditutup Tanpa Order</span>`;
  const versiChip = records.length > 1
    ? `<span class="mi"><i class="ti ti-versions"></i><span>${records.length} versi tersimpan</span></span>`
    : '';
  return `<div class="rcard riwayat-card" data-id="${s.id}" style="position:relative">
    <div class="rcard-top" style="padding-right:8px">
      <div class="rcard-name">${s.nama_rs ? s.nama_rs : '(Nama RS belum diisi)'}</div>
      ${orderBadge}
    </div>
    <div class="rcard-meta">
      <span class="mi"><i class="ti ti-user"></i><span>PIC: ${s.pic_marsup || '-'}</span></span>
      <span class="mi"><i class="ti ti-users"></i><span>Sales: ${s.nama_sales || '-'}</span></span>
      <span class="mi"><i class="ti ti-package"></i><span>${itemCount} produk</span></span>
      ${versiChip}
      <span class="mi"><i class="ti ti-clock"></i><span>Selesai ${sesiTimeAgo(s.updated_at)}</span></span>
    </div>
  </div>`;
}

async function loadRiwayatList() {
  riwayatListLoading.style.display = 'block';
  riwayatListError.style.display = 'none';
  riwayatListEmpty.style.display = 'none';
  riwayatList.innerHTML = '';
  try {
    // Search realtime di nama RS / PIC / Sales — pake `or=` PostgREST biar
    // kepencet satu kotak aja, gak perlu tiga filter field terpisah.
    const term = riwayatSearchInput ? riwayatSearchInput.value.trim() : '';
    let searchFilter = '';
    if (term) {
      const esc = term.replace(/[,()]/g, ' ').trim();
      searchFilter = `&or=(nama_rs.ilike.*${encodeURIComponent(esc)}*,pic_marsup.ilike.*${encodeURIComponent(esc)}*,nama_sales.ilike.*${encodeURIComponent(esc)}*)`;
    }
    const res = await sesiFetch(`${SESI_TABLE}?status=eq.selesai${searchFilter}&select=*,${SESI_ITEM_TABLE}(count),konversi_record(id,grand_total,kategori,revisi)&order=updated_at.desc&limit=100`);
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.message || errData.hint || 'Gagal memuat riwayat (cek relasi konversi_record.sesi_id → sesi_konversi.id di Supabase).');
    }
    const data = await res.json();
    if (data.length === 0) {
      riwayatListEmpty.querySelector('p').innerHTML = term
        ? `Gak ada riwayat yang cocok dengan "${term.replace(/</g, '&lt;')}".`
        : 'Belum ada sesi yang selesai.<br>Sesi yang di-Record atau di-Selesaikan bakal muncul di sini.';
      riwayatListEmpty.style.display = 'block';
      return;
    }
    riwayatList.innerHTML = data.map(renderRiwayatCard).join('');
    riwayatList.querySelectorAll('.riwayat-card').forEach(card => {
      card.addEventListener('click', () => openSesi(card.dataset.id));
    });
  } catch (err) {
    renderListError(riwayatListError, err.message, loadRiwayatList);
    riwayatListError.style.display = 'block';
  } finally {
    riwayatListLoading.style.display = 'none';
  }
}
btnRiwayatRefresh.addEventListener('click', loadRiwayatList);

// Search realtime, di-debounce biar gak nembak Supabase tiap ketikan huruf.
riwayatSearchInput.addEventListener('input', () => {
  riwayatClearBtn.style.display = riwayatSearchInput.value ? 'block' : 'none';
  clearTimeout(riwayatSearchDebounce);
  riwayatSearchDebounce = setTimeout(loadRiwayatList, 300);
});
riwayatClearBtn.addEventListener('click', () => {
  riwayatSearchInput.value = '';
  riwayatClearBtn.style.display = 'none';
  loadRiwayatList();
});


// buat seluruh daftar), lalu tempel ke masing-masing baris sesi sebagai _permintaan.
// Gagal di sini gak boleh gagalin daftar sesi — badge-nya optional.
async function attachPermintaanSummary(sesiRows) {
  if (!sesiRows.length) return sesiRows;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_permintaan_summary_by_sesi_ids`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': ANON_KEY,
        'Authorization': 'Bearer ' + stokAccessToken
      },
      body: JSON.stringify({ p_sesi_ids: sesiRows.map(s => s.id) })
    });
    if (!res.ok) return sesiRows;
    const summaries = await res.json();
    const bySesiId = {};
    (summaries || []).forEach(s => { bySesiId[s.sesi_id] = s; });
    sesiRows.forEach(s => { s._permintaan = bySesiId[s.id] || null; });
  } catch { /* badge permintaan opsional, diamkan kalau gagal */ }
  return sesiRows;
}

async function loadSesiList() {
  sesiListLoading.style.display = 'block';
  sesiListError.style.display = 'none';
  sesiListEmpty.style.display = 'none';
  sesiList.innerHTML = '';
  try {
    const res = await sesiFetch(`${SESI_TABLE}?status=eq.berjalan&select=*,${SESI_ITEM_TABLE}(count)&order=updated_at.desc`);
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.message || errData.hint || 'Tabel sesi_konversi belum tersedia di Supabase — jalankan dulu SQL setup-nya.');
    }
    const data = await res.json();
    sesiBadge.textContent = data.length;
    sesiBadge.style.display = data.length > 0 ? 'inline-block' : 'none';
    if (data.length === 0) { sesiListEmpty.style.display = 'block'; return; }
    await attachPermintaanSummary(data);
    sesiList.innerHTML = data.map(renderSesiCard).join('');
    sesiList.querySelectorAll('.sesi-card').forEach(card => {
      card.addEventListener('click', () => openSesi(card.dataset.id));
    });
    sesiList.querySelectorAll('.sesi-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation(); // jangan sampai ikut buka sesinya
        deleteSesi(btn.dataset.id, btn.dataset.nama, btn);
      });
    });
    sesiList.querySelectorAll('.sesi-wa-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        shareSesiToWhatsApp(btn.dataset.id, btn.dataset.nama);
      });
    });
  } catch (err) {
    renderListError(sesiListError, err.message, loadSesiList);
  } finally {
    sesiListLoading.style.display = 'none';
  }
}

// Hapus sesi konversi secara permanen (beserta semua item di dalamnya).
// Kalau sesi yang dihapus adalah sesi yang sedang dibuka, layar clipboard
// ikut direset biar gak nyisa data sesi yang udah gak ada.
async function deleteSesi(id, nama, btn) {
  if (!(await showConfirmModal({ title: 'Hapus Sesi', text: `Hapus sesi "${nama}"? Semua produk di dalamnya ikut terhapus dan tidak bisa dikembalikan.`, okText: 'Ya, Hapus', danger: true }))) return;
  if (btn) btn.disabled = true;
  try {
    await sesiFetch(`${SESI_ITEM_TABLE}?sesi_id=eq.${id}`, { method: 'DELETE' });
    const res = await sesiFetch(`${SESI_TABLE}?id=eq.${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.message || errData.hint || 'Gagal menghapus sesi');
    }
    if (currentSesiId === id) {
      currentSesiId = null;
      clipboard = [];
      inpRs.value = '';
      inpSales.value = '';
      currentButuhBantuan = false;
      updateClipboard();
      renderResults(lastResults);
      renderButuhBantuanBtn();
      setSesiSavedStatus('');
      updateClipHeaderCompact();
      resetChecklistUI();
      updateEndSesiBtnState();
    }
    await loadSesiList();
  } catch (err) {
    showToast('Gagal hapus sesi: ' + err.message, 'error');
    if (btn) btn.disabled = false;
  }
}

async function openSesi(id) {
  try {
    resetChecklistUI(); // buang checklist Permintaan RS dari sesi sebelumnya (kalau ada) dulu
    const [sesiRes, itemsRes] = await Promise.all([
      sesiFetch(`${SESI_TABLE}?id=eq.${id}&select=*`),
      sesiFetch(`${SESI_ITEM_TABLE}?sesi_id=eq.${id}&select=*`)
    ]);
    if (!sesiRes.ok || !itemsRes.ok) throw new Error('Gagal memuat sesi dari server');
    const [sesiRows, items] = await Promise.all([sesiRes.json(), itemsRes.json()]);
    const sesi = sesiRows[0];
    if (!sesi) throw new Error('Sesi tidak ditemukan (mungkin sudah dihapus/selesai)');

    currentSesiId = sesi.id;
    currentButuhBantuan = !!sesi.butuh_bantuan;
    inpRs.value = sesi.nama_rs || '';
    inpSales.value = sesi.nama_sales || '';
    if (sesi.pic_marsup) inpMarsup.value = sesi.pic_marsup;
    checklistPagu = (sesi.pagu != null) ? sesi.pagu : null;
    updateEndSesiBtnState();

    clipboard = items.map(mapSesiItemRowToClipItem);

    updateClipboard();
    if (lastResults.length) renderResults(lastResults);
    renderButuhBantuanBtn();
    setClipHeaderCollapsed(false);
    updateClipHeaderCompact();
    setSesiSavedStatus('Sesi dimuat ✓');
    switchSubTab('cari');
    if (window.innerWidth <= 860 && typeof switchTab === 'function') switchTab('clip');

    // Permintaan RS yang nempel di sesi ini (kalau ada) ikut dimuat & ditampilin,
    // jadi siapa pun yang buka sesi ini liat daftar permintaannya — bukan cuma
    // orang yang pertama nyatetnya.
    await loadChecklistForSesi(sesi.id);
    if (typeof subscribeToSesiRealtime === 'function') subscribeToSesiRealtime(currentSesiId);
  } catch (err) {
    showToast('Gagal membuka sesi: ' + err.message, 'error');
  }
}

// Reset state checklist "Kebutuhan RS" di layar (dipanggil sebelum ganti sesi,
// biar gak nyisa data dari sesi yang lain).
function resetChecklistUI() {
  checklistItems = [];
  checklistPermintaanId = null;
  if (typeof kbRefreshStatus !== 'undefined' && kbRefreshStatus) kbRefreshStatus.textContent = '';
  if (typeof updateKbTabState === 'function') updateKbTabState();
  if (typeof updateClipSummaryStrip === 'function') updateClipSummaryStrip();
  if (typeof switchClipTab === 'function') switchClipTab('list');
  // Referensi screenshot nempel ke konteks Permintaan RS yang lagi dibuka —
  // begitu pindah/tutup/hapus sesi, referensi lama gak relevan lagi.
  if (typeof resetSsReferences === 'function') resetSsReferences();
  // Channel realtime nempel ke satu sesi doang — begitu pindah/tutup/hapus sesi,
  // channel yang lama WAJIB diputus dulu (lihat subscribeToSesiRealtime di bawah).
  if (typeof unsubscribeFromSesiRealtime === 'function') unsubscribeFromSesiRealtime();
}

// ══════════════════════════════════════════════════════════════════════════
// REALTIME KOLABORASI — satu sesi = satu live workspace. Dua channel per sesi:
//   1) sesi-db-*       → postgres_changes (sumber kebenaran: tabel SESI_TABLE &
//      SESI_ITEM_TABLE). Ini yang bikin clipboard/header orang lain nongol
//      otomatis — lewat patchClipItem/insertClipItem/removeClipItemDom yang
//      cuma nyentuh baris yang berubah, BUKAN updateClipboard() penuh.
//   2) sesi-presence-* → presence + broadcast, buat hal yang EPHEMERAL doang
//      (siapa online, siapa lagi ngedit apa). Sengaja gak numpang ke tabel
//      manapun — otomatis bersih begitu tab ditutup, gak ninggalin baris
//      "lock" yang nyangkut kalau browser crash.
// Siklusnya ngikutin currentSesiId: subscribeToSesiRealtime() dipanggil begitu
// currentSesiId final (ensureSesi()/openSesi()), unsubscribe dipanggil dari
// resetChecklistUI() di atas — titik reset terpusat yang sama dipakai
// resetSsReferences().
// ══════════════════════════════════════════════════════════════════════════
let sesiDbChannel = null;
let sesiPresenceChannel = null;
let presenceRoster = {}; // presence key -> {nama, status, joined_at}
let rtActivityLog = []; // {ts, msg} — dicap N item terakhir, lihat pushActivity()

// Jejak tulisan lokal barusan, biar event postgres_changes yang notabene
// "gema" dari tulisan sendiri gak di-reapply (nge-pulse/nge-flash sendiri).
const recentLocalWrites = new Map(); // key: `${table}:${id}:${field}` -> {value, ts}
const RECENT_WRITE_TTL_MS = 2500;
function markLocalWrite(table, id, field, value) {
  if (!id) return;
  recentLocalWrites.set(`${table}:${id}:${field}`, { value, ts: Date.now() });
}
function isEchoOfLocalWrite(table, id, field, value) {
  const key = `${table}:${id}:${field}`;
  const rec = recentLocalWrites.get(key);
  if (!rec) return false;
  if (Date.now() - rec.ts > RECENT_WRITE_TTL_MS) { recentLocalWrites.delete(key); return false; }
  // Nilainya sama persis → emang gema tulisan sendiri. Kalau beda, tetap
  // dianggap perubahan asli (ke-outrace tulisan orang lain di window yang sama).
  return String(rec.value) === String(value);
}

function updateRtStatus(state) {
  // state: 'connecting' | 'live' | 'reconnecting' | 'offline'
  const dot = document.getElementById('rt-status-dot');
  const text = document.getElementById('rt-status-text');
  const wrap = document.getElementById('rt-status');
  if (!dot || !text || !wrap) return;
  wrap.style.display = currentSesiId ? 'flex' : 'none';
  dot.classList.remove('dot-live', 'dot-connecting', 'dot-reconnecting', 'dot-offline');
  dot.classList.add('dot-' + state);
  const labels = { connecting: 'Menyambungkan…', live: 'Live', reconnecting: 'Menyambung ulang…', offline: 'Offline' };
  text.textContent = labels[state] || '';
}

function subscribeToSesiRealtime(sesiId) {
  if (!rt || !sesiId) return; // SDK gagal dimuat / gak ada sesi → diam-diam gak aktifin live sync, app tetap jalan manual kayak sebelumnya
  unsubscribeFromSesiRealtime(); // jaga-jaga: jangan sampai numpuk channel dari sesi sebelumnya
  updateRtStatus('connecting');

  sesiDbChannel = rt.channel(`sesi-db-${sesiId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: SESI_TABLE, filter: `id=eq.${sesiId}` }, handleSesiRowChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: SESI_ITEM_TABLE, filter: `sesi_id=eq.${sesiId}` }, handleItemRowChange)
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') updateRtStatus('live');
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') updateRtStatus('reconnecting');
      else if (status === 'CLOSED') updateRtStatus('offline');
    });

  const presenceKey = currentUser ? currentUser.id : ('anon-' + Math.random().toString(36).slice(2, 9));
  sesiPresenceChannel = rt.channel(`sesi-presence-${sesiId}`, { config: { presence: { key: presenceKey } } })
    .on('presence', { event: 'sync' }, handlePresenceSync)
    .on('presence', { event: 'join' }, handlePresenceJoin)
    .on('presence', { event: 'leave' }, handlePresenceLeave)
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        try {
          await sesiPresenceChannel.track({
            nama: (inpMarsup && inpMarsup.value.trim()) || (currentUser && currentUser.email) || 'Anonim',
            status: 'online',
            joined_at: new Date().toISOString()
          });
        } catch { /* presence gagal gak boleh nge-block kerjaan utama */ }
      }
    });

  // Away kalau tab disembunyikan >30 detik — kembali online begitu dibuka lagi.
  document.addEventListener('visibilitychange', handleVisibilityForPresence);
}

let awayTimer = null;
function handleVisibilityForPresence() {
  if (!sesiPresenceChannel) return;
  clearTimeout(awayTimer);
  if (document.hidden) {
    awayTimer = setTimeout(() => {
      sesiPresenceChannel && sesiPresenceChannel.track({ nama: (inpMarsup && inpMarsup.value.trim()) || 'Anonim', status: 'away', joined_at: new Date().toISOString() }).catch(() => {});
    }, 30000);
  } else {
    sesiPresenceChannel.track({ nama: (inpMarsup && inpMarsup.value.trim()) || 'Anonim', status: 'online', joined_at: new Date().toISOString() }).catch(() => {});
  }
}

function unsubscribeFromSesiRealtime() {
  document.removeEventListener('visibilitychange', handleVisibilityForPresence);
  clearTimeout(awayTimer);
  if (rt && sesiDbChannel) rt.removeChannel(sesiDbChannel);
  if (rt && sesiPresenceChannel) rt.removeChannel(sesiPresenceChannel);
  sesiDbChannel = null;
  sesiPresenceChannel = null;
  presenceRoster = {};
  rtActivityLog = [];
  renderPresenceRoster();
  renderActivityFeed();
  updateRtStatus('offline');
  const wrap = document.getElementById('rt-status');
  if (wrap) wrap.style.display = 'none';
}

// ---- Handler: baris sesi_konversi berubah (header/pagu/status/butuh_bantuan) ----
function handleSesiRowChange(payload) {
  if (payload.eventType === 'DELETE') return; // dihapus ditangani lewat alur hapus sesi yang sudah ada
  const row = payload.new;
  if (!row || row.id !== currentSesiId) return;

  // Nama RS/Sales/PIC: jangan timpa field yang LAGI DIFOKUS user lokal (lagi diketik).
  [['nama_rs', inpRs], ['nama_sales', inpSales], ['pic_marsup', inpMarsup]].forEach(([field, el]) => {
    if (!el) return;
    if (isEchoOfLocalWrite(SESI_TABLE, row.id, field, row[field])) return;
    if (document.activeElement === el) return;
    const newVal = row[field] || '';
    if (el.value !== newVal) {
      el.value = newVal;
      el.classList.add('rt-field-pulse');
      setTimeout(() => el.classList.remove('rt-field-pulse'), 1100);
    }
  });

  if (row.pagu !== checklistPagu && !isEchoOfLocalWrite(SESI_TABLE, row.id, 'pagu', row.pagu)) {
    checklistPagu = row.pagu;
    updateClipAggregates(); // cuma hitung ulang total/budget, gak nyentuh daftar item
    pushActivity('Pagu diperbarui');
  }
  if (!!row.butuh_bantuan !== currentButuhBantuan && !isEchoOfLocalWrite(SESI_TABLE, row.id, 'butuh_bantuan', row.butuh_bantuan)) {
    currentButuhBantuan = !!row.butuh_bantuan;
    if (typeof renderButuhBantuanBtn === 'function') renderButuhBantuanBtn();
    pushActivity(currentButuhBantuan ? 'Minta bantuan diaktifkan' : 'Minta bantuan dibatalkan');
  }
}

// ---- Handler: baris sesi_konversi_item berubah (isi clipboard) ----
function handleItemRowChange(payload) {
  if (!currentSesiId) return;
  const row = payload.new || payload.old;
  if (!row || row.sesi_id !== currentSesiId) return;

  if (payload.eventType === 'INSERT') {
    // kode_produk unik per clipboard (dipakai jadi key di mana-mana) — cukup buat
    // ngecek "ini beneran baru" tanpa perlu tracking id kayak update/delete.
    if (clipboard.some(c => c.kode_produk === row.kode_produk)) return;
    insertClipItem(mapSesiItemRowToClipItem(row));
    pushActivity(`${presenceNameGuess()} menambahkan ${row.nama_produk}`);
    return;
  }
  if (payload.eventType === 'UPDATE') {
    const item = clipboard.find(c => c._sesiItemId === row.id);
    if (!item) { insertClipItem(mapSesiItemRowToClipItem(row)); return; }
    if (row.qty !== item.qty && !isEchoOfLocalWrite(SESI_ITEM_TABLE, row.id, 'qty', row.qty)) {
      const oldQty = item.qty;
      patchClipItem(item.kode_produk, { qty: row.qty });
      pushActivity(`Qty ${item.nama_produk} ${oldQty} → ${row.qty}`);
    }
    return;
  }
  if (payload.eventType === 'DELETE') {
    const item = clipboard.find(c => c._sesiItemId === row.id);
    if (!item) return; // udah kehapus duluan lokal (optimistic), gak perlu apa-apa lagi
    const nama = item.nama_produk;
    removeClipItemDom(item.kode_produk);
    pushActivity(`${nama} dihapus`);
  }
}

// Placeholder ringan buat "siapa yang ngelakuin ini" di activity feed — presence
// gak nyimpen histori per-event, jadi paling akurat yang bisa kita bilang cuma
// "kolaborator" kalau bukan diri sendiri. Upgrade ke nama presisi (butuh kolom
// pengubah di tabel item) masuk tahap activity-feed berikutnya.
function presenceNameGuess() {
  return 'Kolaborator';
}

// ---- Activity feed ringan (in-memory, dicap 8 entri terakhir) ----
function pushActivity(msg) {
  rtActivityLog.unshift({ ts: new Date(), msg });
  if (rtActivityLog.length > 8) rtActivityLog.length = 8;
  renderActivityFeed();
}
function renderActivityFeed() {
  const el = document.getElementById('rt-activity-feed');
  if (!el) return;
  if (!rtActivityLog.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
  el.style.display = 'block';
  el.innerHTML = rtActivityLog.map((a, i) => {
    const hh = String(a.ts.getHours()).padStart(2, '0');
    const mm = String(a.ts.getMinutes()).padStart(2, '0');
    return `<div${i === 0 ? ' class="rt-fade-in"' : ''} style="padding:2px 0">${hh}:${mm} — ${a.msg}</div>`;
  }).join('');
}

// ---- Presence ----
function handlePresenceSync() {
  if (!sesiPresenceChannel) return;
  const state = sesiPresenceChannel.presenceState();
  const roster = {};
  Object.keys(state).forEach(key => {
    const entries = state[key];
    if (entries && entries.length) roster[key] = entries[entries.length - 1];
  });
  presenceRoster = roster;
  renderPresenceRoster();
}
function handlePresenceJoin({ key, newPresences }) {
  if (currentUser && key === currentUser.id) return; // diri sendiri, gak usah notif
  const nama = newPresences && newPresences[0] && newPresences[0].nama;
  if (nama) showToast(`${nama} bergabung ke sesi ini`, 'presence');
}
function handlePresenceLeave({ key, leftPresences }) {
  if (currentUser && key === currentUser.id) return;
  const nama = leftPresences && leftPresences[0] && leftPresences[0].nama;
  if (nama) showToast(`${nama} keluar dari sesi`, 'presence');
}
function renderPresenceRoster() {
  const el = document.getElementById('rt-presence');
  if (!el) return;
  const names = Object.values(presenceRoster).map(p => p.nama).filter(Boolean);
  if (!names.length) { el.style.display = 'none'; return; }
  el.style.display = 'flex';
  el.title = names.join(', ');
  el.innerHTML = `<i class="ti ti-users"></i> ${names.length} online`;
}

// Ambil Permintaan RS yang nempel ke sesi ini (kalau ada) dan tampilin di
// panel "Kebutuhan RS", persis kayak saat baru disubmit — bedanya ini dipicu
// pas buka sesi, jadi berlaku juga buat temen yang bukan pembuat pertamanya.
async function loadChecklistForSesi(sesiId) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_permintaan_by_sesi`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': ANON_KEY,
        'Authorization': 'Bearer ' + stokAccessToken
      },
      body: JSON.stringify({ p_sesi_id: sesiId })
    });
    if (!res.ok) { kbRefreshStatus.textContent = 'Gagal memuat checklist.'; return; }
    const data = await res.json();
    if (!data) { kbRefreshStatus.textContent = ''; return; } // sesi ini emang gak punya Permintaan RS

    checklistItems = Array.isArray(data.items) ? data.items : [];
    checklistItems.forEach(it => { it.matched_items = normalizeMatchedItems(it); });
    checklistNamaRs = data.nama_rs || '(tanpa nama RS)';
    checklistSales = data.pic_sales || '(tanpa nama sales)';
    checklistPagu = (data.pagu != null) ? data.pagu : checklistPagu;
    checklistPermintaanId = data.permintaan_id;

    kbSection.classList.remove('kb-collapsed');
    kbRecordStatus.textContent = 'Tingkat pemenuhan tersimpan otomatis tiap item ditandai.';
    kbRefreshStatus.textContent = 'Diperbarui ✓ ' + new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    renderChecklist();
    // Sesi ini punya Permintaan RS yang nempel — langsung arahkan ke tab
    // Kebutuhan RS, karena itu kemungkinan besar yang mau dicek duluan.
    switchClipTab('kb');
  } catch {
    kbRefreshStatus.textContent = 'Gagal memuat checklist.';
  }
}

// Refresh ringan badge jumlah sesi aktif tiap 30 detik, biar kelihatan
// walau lagi di tab Cari Produk — tanpa nge-reload seluruh daftar.
setInterval(async () => {
  if (!stokAccessToken) return;
  try {
    const res = await sesiFetch(`${SESI_TABLE}?status=eq.berjalan&select=id`);
    if (!res.ok) return;
    const rows = await res.json();
    sesiBadge.textContent = rows.length;
    sesiBadge.style.display = rows.length > 0 ? 'inline-block' : 'none';
  } catch { /* diamkan */ }
}, 30000);

function updateClipHeaderCompact() {
  const rsRaw = inpRs.value.trim();
  const rs = rsRaw || '(nama RS belum diisi)';
  const sales = inpSales.value.trim();
  const marsup = inpMarsup.value.trim();
  clipHeaderCompact.innerHTML = `<b>${rs}</b>${sales ? ' · Sales: ' + sales : ''}${marsup ? ' · PIC: ' + marsup : ''}`;
  updateSessionIndicatorAndTitle(rsRaw, sales);
}

// Satu sumber kebenaran "lagi di sesi/RS mana" yang SELALU kelihatan, di dua
// tempat: badge sticky di header global (nggak ikut hilang pas panel diciutkan
// atau di-scroll) dan judul tab browser (biar gampang bedain kalau buka
// beberapa tab untuk beberapa RS sekaligus).
function updateSessionIndicatorAndTitle(rsRaw, salesRaw) {
  // Aktif/enggaknya indikator sekarang ngikutin currentSesiId (fakta di server),
  // bukan cuma "ada nama RS yang diketik" — soalnya sesi bisa udah kebentuk
  // duluan (lewat "Mulai Sesi Baru") sebelum nama RS-nya sempat diisi.
  const hasSesi = !!currentSesiId;
  sessionIndicator.classList.toggle('empty', !hasSesi);
  sessionIndicator.classList.toggle('active', hasSesi);
  if (hasSesi) {
    const label = rsRaw ? (salesRaw ? `${rsRaw} · ${salesRaw}` : rsRaw) : 'Sesi baru (RS belum diisi)';
    sessionIndicatorText.textContent = label;
    document.title = rsRaw ? `${rsRaw} — Conversion Workspace` : APP_TITLE_BASE;
  } else {
    sessionIndicatorText.textContent = 'Belum ada sesi — klik "Mulai Sesi Baru"';
    document.title = APP_TITLE_BASE;
  }
}
const CLIP_HEADER_COLLAPSE_KEY = 'pnm_clip_header_collapsed';
function setClipHeaderCollapsed(collapsed, persist = true) {
  clipHeader.classList.toggle('collapsed', collapsed);
  clipHeaderToggle.title = collapsed ? 'Perluas form sesi' : 'Ciutkan form sesi';
  if (collapsed) updateClipHeaderCompact();
  if (persist) sessionStorage.setItem(CLIP_HEADER_COLLAPSE_KEY, collapsed ? '1' : '0');
}
clipHeaderToggle.addEventListener('click', () => {
  setClipHeaderCollapsed(!clipHeader.classList.contains('collapsed'));
});
// Section tetap ciutan/terbuka selama masih di tab yang sama (sessionStorage),
// jadi gak perlu diulang tiap kali klik antar produk.
setClipHeaderCollapsed(sessionStorage.getItem(CLIP_HEADER_COLLAPSE_KEY) === '1', false);
[inpRs, inpSales, inpMarsup].forEach(inp => {
  inp.addEventListener('input', updateClipHeaderCompact);
});
const recordModal = document.getElementById('record-modal');
const recTanggal = document.getElementById('rec-tanggal');
const recRs = document.getElementById('rec-rs');
const recSales = document.getElementById('rec-sales');
const recKategori = document.getElementById('rec-kategori');
const recValue = document.getElementById('rec-value');
const recNotes = document.getElementById('rec-notes');
const recLink = document.getElementById('rec-link');
const recordStatus = document.getElementById('record-status');
const recordSubmitBtn = document.getElementById('record-submit-btn');
const recordCancelBtn = document.getElementById('record-cancel-btn');
const exportModal = document.getElementById('export-modal');

const btnPermintaan = document.getElementById('btn-permintaan');
const prModal = document.getElementById('pr-modal');
const prFormWrap = document.getElementById('pr-form-wrap');
const prCancelBtn2 = document.getElementById('pr-cancel-btn-2');
const prNamaRs = document.getElementById('pr-nama-rs');
const prTanggal = document.getElementById('pr-tanggal');
const prPicSales = document.getElementById('pr-pic-sales');
const prPagu = document.getElementById('pr-pagu');

// Format input Pagu jadi "150.000.000" sambil ngetik, biar kebaca jelas —
// tapi tetep nerima keyboard numerik biasa (bukan input type=number yang suka nolak titik).
function parsePaguValue(str) {
  const digits = (str || '').replace(/\D/g, '');
  return digits ? Number(digits) : null;
}
prPagu.addEventListener('input', () => {
  const digits = prPagu.value.replace(/\D/g, '');
  prPagu.value = digits ? Number(digits).toLocaleString('id-ID') : '';
});
const prTabTeks = document.getElementById('pr-tab-teks');
const prTabExcel = document.getElementById('pr-tab-excel');
const prTeksWrap = document.getElementById('pr-teks-wrap');
const prExcelWrap = document.getElementById('pr-excel-wrap');
const prTeks = document.getElementById('pr-teks');
const prFile = document.getElementById('pr-file');
const prSubmitBtn = document.getElementById('pr-submit-btn');
const prStatusMsg = document.getElementById('pr-status-msg');
const prReviewWrap = document.getElementById('pr-review-wrap');
const prReviewInfo = document.getElementById('pr-review-info');
const prReviewRows = document.getElementById('pr-review-rows');
const prReviewAddBtn = document.getElementById('pr-review-add-btn');
const prReviewBackBtn = document.getElementById('pr-review-back-btn');
const prReviewSaveBtn = document.getElementById('pr-review-save-btn');
const kbSection = document.getElementById('clip-kebutuhan-section');
const kbEmptyState = document.getElementById('kb-empty-state');
const kbEmptyCta = document.getElementById('kb-empty-cta');
const kbRealContent = document.getElementById('kb-real-content');
const kbTitle = document.getElementById('kb-title');
const kbCount = document.getElementById('kb-count');
const kbList = document.getElementById('kb-list');
const kbSummary = document.getElementById('kb-summary');
const kbRecordStatus = document.getElementById('kb-record-status');
const kbCollapseBtn = document.getElementById('kb-collapse-btn');
const kbRefreshBtn = document.getElementById('kb-refresh-btn');
const kbRefreshStatus = document.getElementById('kb-refresh-status');
const clipTabRow = document.getElementById('clip-tab-row');
const clipTabBtnKb = document.getElementById('clip-tab-btn-kb');
const clipTabBtnList = document.getElementById('clip-tab-btn-list');
const clipTabBtnSph = document.getElementById('clip-tab-btn-sph');
const clipTabBadgeKb = document.getElementById('clip-tab-badge-kb');
const clipTabBadgeList = document.getElementById('clip-tab-badge-list');
const clipTabPanelKb = document.getElementById('clip-tab-panel-kb');
const clipTabPanelList = document.getElementById('clip-tab-panel-list');
const clipTabPanelSph = document.getElementById('clip-tab-panel-sph');
const clipSummaryStrip = document.getElementById('clip-summary-strip');

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
// otomatis begitu tab ini dibuka — form + preview PDF dapet ruang lebih
// lega tanpa user harus mencet tombol ciutkan manual dulu. Balik ke tab
// lain otomatis ngembaliin panel search ke kondisi semula, TAPI cuma kalau
// kita sendiri yang nyiutin di sini — kalau user emang udah nyiutin duluan
// (manual) sebelum masuk tab SPH, biarin tetap ciut, jangan maksa kebuka.
let sphAutoCollapsedSearch = false;
function switchClipTab(tab) {
  clipActiveTab = tab;
  clipTabBtnKb.classList.toggle('active', tab === 'kb');
  clipTabBtnList.classList.toggle('active', tab === 'list');
  clipTabBtnSph.classList.toggle('active', tab === 'sph');
  clipTabPanelKb.style.display = tab === 'kb' ? 'flex' : 'none';
  clipTabPanelList.style.display = tab === 'list' ? 'flex' : 'none';
  clipTabPanelSph.style.display = tab === 'sph' ? 'flex' : 'none';
  if (panelClipEl) panelClipEl.classList.toggle('tab-sph-active', tab === 'sph');

  if (tab === 'sph') {
    if (panelSearchEl && !panelSearchEl.classList.contains('collapsed')) {
      sphAutoCollapsedSearch = true;
      setPanelSearchCollapsed(true, false);
    }
  } else if (sphAutoCollapsedSearch) {
    sphAutoCollapsedSearch = false;
    setPanelSearchCollapsed(false, false);
  }

  if (tab === 'sph' && typeof window.onSphTabOpen === 'function') window.onSphTabOpen();
}
clipTabBtnKb.addEventListener('click', () => switchClipTab('kb'));
clipTabBtnList.addEventListener('click', () => switchClipTab('list'));
clipTabBtnSph.addEventListener('click', () => switchClipTab('sph'));
kbEmptyCta.addEventListener('click', () => openPrModal());

// Toggle antara empty-state ("belum ada Permintaan RS") dan konten checklist
// beneran di dalam tab Kebutuhan RS, plus update badge jumlah item pending
// di tab-nya sendiri biar kelihatan dari tab Clipboard tanpa perlu pindah.
function updateKbTabState() {
  const hasChecklist = !!checklistPermintaanId && checklistItems.length > 0;
  kbEmptyState.style.display = hasChecklist ? 'none' : 'flex';
  kbRealContent.style.display = hasChecklist ? 'flex' : 'none';
  if (hasChecklist) {
    const pending = checklistItems.filter(i => i.status === 'PENDING').length;
    clipTabBadgeKb.textContent = pending;
    clipTabBadgeKb.style.display = 'inline-block';
    clipTabBadgeKb.classList.toggle('warn', pending > 0);
  } else {
    clipTabBadgeKb.style.display = 'none';
  }
}

// Strip ringkasan yang tetap kelihatan di kedua tab — biar progress pencocokan
// & total belanja tetap ke-track walau lagi buka tab yang lain.
function updateClipSummaryStrip() {
  const parts = [];
  if (checklistPermintaanId && checklistItems.length > 0) {
    const done = checklistItems.filter(i => i.status === 'TERPENUHI').length;
    parts.push(`Kebutuhan RS: <b>${done}/${checklistItems.length}</b> terpenuhi`);
  }
  if (clipboard.length > 0) {
    parts.push(`Clipboard: <b>${clipboard.length}</b> produk`);
    if (clipTotalHarga.textContent) parts.push(`<b>${clipTotalHarga.textContent}</b>`);
  }
  if (!parts.length) { clipSummaryStrip.style.display = 'none'; return; }
  clipSummaryStrip.style.display = 'flex';
  clipSummaryStrip.innerHTML = parts.map(p => `<span>${p}</span>`).join('');
}
const progressFill = document.getElementById('progress-fill');
const progressLabel = document.getElementById('progress-label');
const modalSub = document.getElementById('modal-sub');
const themeToggle = document.getElementById('theme-toggle');
const themeIcon = document.getElementById('theme-icon');

// DARK MODE
function setThemeIcon() {
  const isDark = document.body.getAttribute('data-theme') === 'dark';
  themeIcon.className = isDark ? 'ph ph-sun' : 'ph ph-moon';
}
setThemeIcon();
themeToggle.addEventListener('click', () => {
  const isDark = document.body.getAttribute('data-theme') === 'dark';
  if (isDark) {
    document.body.removeAttribute('data-theme');
    localStorage.setItem('theme', 'light');
  } else {
    document.body.setAttribute('data-theme', 'dark');
    localStorage.setItem('theme', 'dark');
  }
  setThemeIcon();
});

// SUPABASE
async function rpc(fn, params) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {'Content-Type':'application/json','apikey':ANON_KEY,'Authorization':'Bearer '+ANON_KEY},
    body: JSON.stringify(params)
  });
  const data = await res.json();
  if (!res.ok) return {data:null, error:data};
  return {data, error:null};
}

function rupiah(n) {
  if (!n && n !== 0) return '—';
  return 'Rp ' + Number(n).toLocaleString('id-ID');
}

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

// FETCH IMAGE AS BASE64
async function fetchImageBase64(kode_asli, kode_produk) {
  const kodeForUrl = (kode_asli && kode_asli.trim()) ? kode_asli.trim() : kode_produk;
  try {
    const url = THUMB_BASE + kodeForUrl + '.png';
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

// AUTOCOMPLETE — reuses lastResults from runSearch, no separate API call needed
function renderAutocomplete(data) {
  if (!searchInput.value.trim() || !data || !data.length) {
    acBox.style.display = 'none'; acItems = []; acIndex = -1; return;
  }
  acItems = data.slice(0, 6);
  acIndex = -1;
  acBox.innerHTML = acItems.map(r => {
    const t = (r.tipe || '').toUpperCase();
    const tipeLabel = t === 'SET' ? 'Set' : t === 'UNIT' ? 'Unit' : 'Instrumen';
    return `<div class="ac-item"><span class="ac-name">${r.nama_produk}</span><span class="ac-code">${r.kode_produk || ''}</span><span class="ac-badge">${tipeLabel}</span></div>`;
  }).join('');
  acBox.querySelectorAll('.ac-item').forEach((el, i) => {
    el.addEventListener('click', () => {
      searchInput.value = acItems[i].nama_produk;
      acBox.style.display = 'none';
      runSearch();
    });
  });
  acBox.style.display = 'block';
}

function renderSkeletons(count) {
  const widths = [62, 75, 50, 68, 40, 80, 55, 45];
  loadingEl.innerHTML = Array.from({length: count}, (_, i) => {
    const w1 = widths[i % widths.length];
    const w2 = widths[(i + 3) % widths.length] * 0.6;
    return `<div class="skel-card"><div class="skeleton skel-bar" style="width:${w1}%"></div><div class="skeleton skel-bar" style="width:${w2}%;height:9px"></div></div>`;
  }).join('');
}

// SEARCH
let searchSeq = 0;
async function runSearch() {
  const q = searchInput.value.trim();
  console.log('DEBUG q:', JSON.stringify(q));
  console.log('DEBUG codes:', [...q].map(c => c.charCodeAt(0)));
  
  if (!q) { reset(); return; }
  const mySeq = ++searchSeq; // request lama yang telat balik nanti diabaikan, bukan nimpa hasil yang lebih baru
  errEl.style.display = 'none';
  hintEl.style.display = 'none';
  renderSkeletons(Math.min(lastResults.length || 6, RESULTS_PER_PAGE));
  loadingEl.style.display = 'block';
  resultsEl.innerHTML = '';
  emptyEl.style.display = 'none';
  metaEl.textContent = '';
  const {data, error} = await rpc('search_produk_dengan_harga', {
    q, p_tipe: selectedTipe, only_akd: onlyAkd, only_kfa: false
  });
  if (mySeq !== searchSeq) return; // sudah ada pencarian lebih baru — buang hasil basi ini
  console.log('DEBUG data length:', data ? data.length : null);
  console.log('DEBUG error:', error);

  loadingEl.style.display = 'none'; // FIX: matikan loading begitu response datang (sebelum branching)

  if (error) {
    acBox.style.display = 'none';
    const msg = error.message || JSON.stringify(error);
    if (msg.includes('timeout') || msg.includes('canceling')) {
      emptyEl.style.display='block';
      metaEl.textContent='Pencarian timeout — coba kata kunci lebih spesifik';
    } else {
      const offlineHint = (!navigator.onLine) ? ' Sepertinya koneksi internet kamu sedang terputus.' : '';
      errEl.innerHTML = `<div>Gagal mencari: ${msg}.${offlineHint}</div><button type="button" id="err-retry-btn" style="margin-top:6px;background:none;border:1px solid var(--danger-border);color:var(--danger);border-radius:6px;padding:4px 10px;font-size:11.5px;font-weight:600;cursor:pointer;font-family:inherit">Coba lagi</button>`;
      errEl.style.display='block';
      const retryBtn = document.getElementById('err-retry-btn');
      if (retryBtn) retryBtn.addEventListener('click', () => { errEl.style.display='none'; runSearch(); });
    }
    return;
  }
  if (!data || !data.length) { emptyEl.style.display='block'; metaEl.textContent='Tidak ada hasil untuk "'+q+'"'; acBox.style.display='none'; return; }
  lastResults = data;
  await enrichResultsWithStok(lastResults);
  sortSelect.style.display = 'inline-block';
  applySort();
  currentPage = 1;
  metaEl.textContent = data.length + ' produk ditemukan — klik untuk tambah ke clipboard';
  renderResults(lastResults);
  if (pnmSettings.autoComplete) {
    renderAutocomplete(lastResults);
  } else {
    acBox.style.display = 'none';
    acBox.innerHTML = '';
    acItems = []; acIndex = -1;
  }
}

// SORT
function applySort() {
  const useLinkPriority = prioritizeLink && !modeSwasta;

  if (sortMode === 'relevance') {
    if (useLinkPriority) {
      lastResults = [...lastResults].sort((a, b) => {
        const aHas = a.link_v6 ? 0 : 1;
        const bHas = b.link_v6 ? 0 : 1;
        return aHas - bHas; // stable sort: urutan relevansi asli tetap terjaga di tiap grup
      });
    }
    return; // urutan asli dari backend (score DESC), atau sudah dipartisi link_v6 di atas
  }

  if (sortMode === 'stok_ready_dulu' || sortMode === 'stok_indent_dulu') {
    // urutan: READY -> INDENT -> tanpa data stok (paling bawah), lalu tie-break by qty desc
    const rank = (status) => status === 'READY' ? 0 : status === 'INDENT' ? 1 : 2;
    const dirFlip = sortMode === 'stok_indent_dulu';
    lastResults.sort((a, b) => {
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

  const field = modeSwasta ? 'harga_swasta' : 'harga_ekat';
  const dir = sortMode === 'harga_asc' ? 1 : -1;
  lastResults.sort((a, b) => {
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
  const totalPages = Math.max(1, Math.ceil(data.length / RESULTS_PER_PAGE));
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;
  const start = (currentPage - 1) * RESULTS_PER_PAGE;
  const pageData = data.slice(start, start + RESULTS_PER_PAGE);

  resultsEl.innerHTML = pageData.map((r, i) => {
    const inClip = clipboard.some(c => c.kode_produk === r.kode_produk);
    const isSet = r.tipe && r.tipe.toUpperCase() === 'SET';
    const tipeClass = isSet ? 'tipe-set' : (r.tipe && r.tipe.toUpperCase() === 'UNIT') ? 'tipe-unit' : 'tipe-other';
    const hargaTampil = modeSwasta ? r.harga_swasta : r.harga_ekat;
    const tahunTampil = modeSwasta ? r.tahun_harga_swasta : r.tahun_harga;
    const labelHarga = modeSwasta ? 'Harga Swasta' : 'Harga belum ada';
    const stokBadge = isSet
      ? (r.stok_status === 'READY'
          ? `<span class="mi stok-ready"><i class="ph ph-check-circle"></i><span>Ready · bisa rakit ${r.stok_qty} set</span></span>`
          : r.stok_status === 'INDENT'
            ? `<span class="mi stok-indent"><i class="ph ph-clock-countdown"></i><span>Indent${r.stok_qty ? ' · bisa rakit '+r.stok_qty+' set' : ''}</span></span>`
            : `<span class="mi stok-warn" title="${r.stok_komponen_terdata||0}/${r.stok_komponen_total||'?'} komponen sudah ada data stok"><i class="ph ph-warning-circle"></i><span>Data stok komponen blm lengkap</span></span>`)
      : (r.stok_status === 'READY'
          ? `<span class="mi stok-ready"><i class="ph ph-check-circle"></i><span>Ready · ${r.stok_qty} pcs</span></span>`
          : r.stok_status === 'INDENT'
            ? `<span class="mi stok-indent"><i class="ph ph-clock-countdown"></i><span>Indent${r.stok_qty ? ' · '+r.stok_qty+' pcs' : ''}</span></span>`
            : `<span class="mi stok-unknown"><i class="ph ph-question"></i><span>Stok: -</span></span>`);
    return `<div class="rcard${inClip?' selected':''}" data-kode="${r.kode_produk}">
      <div class="rcard-top">
        <span class="rcard-name">${r.nama_produk||'—'}</span>
        ${r.tipe?`<span class="tipe-badge ${tipeClass}">${r.tipe}</span>`:''}
      </div>
      <div class="rcard-meta">
        <span class="mi"><i class="ti ti-barcode"></i><span>${r.kode_produk||'—'}</span></span>
        ${r.no_akd?`<span class="mi"><i class="ti ti-certificate"></i><span>${r.no_akd}</span></span>`:''}
        ${r.kode_kfa?`<span class="mi"><i class="ti ti-tag"></i><span>${r.kode_kfa}</span></span>`:''}
        ${hargaTampil?`<span class="mi harga"><i class="ti ti-coin-rupee"></i><span>${rupiah(hargaTampil)}${tahunTampil?' · '+tahunTampil:''}</span></span>`:`<span class="mi"><i class="ti ti-coin-rupee"></i><span style="color:var(--text-muted)">${modeSwasta?'Harga swasta belum ada':'Harga belum ada'}</span></span>`}
        ${stokBadge}
      </div>
      <div style="margin-top:6px;display:flex;align-items:center;flex-wrap:wrap;justify-content:space-between;gap:8px">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          ${modeSwasta ? '' : (r.link_v6
            ?`<a href="${r.link_v6}" target="_blank" rel="noopener" class="badge-katalog-yes" data-role="link-katalog"><i class="ti ti-circle-check" style="font-size:12px"></i> Ada di e-Katalog v6</a>`
            : r.status_inaproc === 'Disetujui'
              ?`<span class="badge-katalog-no" style="color:var(--rust-text,#8F3620);border-color:var(--rust,#B8492F);background:var(--rust-bg,#FBE8E2)"><i class="ti ti-alert-triangle" style="font-size:12px"></i> Disetujui INAPROC — siap dibuatkan Link V6!</span>`
              :`<span class="badge-katalog-no"><i class="ti ti-circle-x" style="font-size:12px"></i> Belum ada di e-Katalog</span>`
          )}
          <button class="btn-preview-gambar btn-lihat-gambar" data-kode="${r.kode_produk}" data-kode-asli="${r.kode_asli||''}" data-nama="${(r.nama_produk||'').replace(/"/g,'&quot;')}"><i class="ti ti-eye" style="font-size:12px"></i> Lihat Gambar</button>
          <button class="btn-preview-gambar btn-copy-produk" data-kode="${r.kode_produk}"><i class="ti ti-copy" style="font-size:12px"></i> Copy</button>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          ${isSet?`<span style="font-size:11px;color:var(--success);display:flex;align-items:center;gap:3px"><i class="ti ti-packages" style="font-size:12px"></i> Set</span>`:''}
          <button class="btn-lampiran" data-kode="${r.kode_produk}" style="font-size:11px;color:var(--accent-text);background:var(--accent-bg);border:1px solid var(--accent-text);border-radius:20px;padding:2px 8px;display:flex;align-items:center;gap:4px;cursor:pointer"><i class="ti ti-file-text" style="font-size:12px"></i> Lihat Lampiran</button>
          ${!inClip?`<span style="font-size:11px;color:var(--text-muted);display:flex;align-items:center;gap:3px"><i class="ti ti-circle-plus" style="font-size:12px"></i> Tambah</span>`:''}
        </div>
      </div>
    </div>`;
  }).join('');
  resultsEl.querySelectorAll('.rcard').forEach(el => {
    el.addEventListener('click', () => addToClip(el.dataset.kode));
  });
  resultsEl.querySelectorAll('.btn-lampiran').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openLampiranModal(btn.dataset.kode);
    });
  });
  resultsEl.querySelectorAll('[data-role="link-katalog"]').forEach(a => {
    a.addEventListener('click', (e) => { e.stopPropagation(); });
  });
  resultsEl.querySelectorAll('.btn-lihat-gambar').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openGambarModal(btn.dataset.kodeAsli, btn.dataset.kode, btn.dataset.nama);
    });
  });
  resultsEl.querySelectorAll('.btn-copy-produk').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      copyProdukToClipboard(btn.dataset.kode);
    });
  });
  renderPagination(data.length);
}

// COPY SATU PRODUK: kode, deskripsi, harga, link — siap paste ke WA
function copyProdukToClipboard(kode) {
  const r = lastResults.find(x => x.kode_produk === kode);
  if (!r) return;
  const harga = modeSwasta ? r.harga_swasta : r.harga_ekat;
  const lines = [
    r.kode_produk || '-',
    r.nama_produk || '-',
    harga ? rupiah(harga) : 'Harga belum ada',
    r.link_v6 || ''
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
  const totalPages = Math.max(1, Math.ceil(totalItems / RESULTS_PER_PAGE));
  if (totalPages <= 1) { paginationEl.innerHTML = ''; paginationEl.classList.add('hidden'); return; }
  paginationEl.classList.remove('hidden');

  function pageBtn(p, label, disabled=false) {
    const active = p === currentPage;
    return `<button class="page-btn${active?' active':''}" data-page="${p}"${disabled?' disabled':''}>${label}</button>`;
  }

  // selalu tampilin halaman 1, halaman terakhir, dan sekitar halaman aktif; sisanya "…"
  const pagesToShow = [...new Set([1, totalPages, currentPage-1, currentPage, currentPage+1])]
    .filter(p => p >= 1 && p <= totalPages)
    .sort((a,b) => a-b);

  let numberBtns = '';
  let prevP = null;
  pagesToShow.forEach(p => {
    if (prevP !== null && p - prevP > 1) numberBtns += `<span class="page-info">…</span>`;
    numberBtns += pageBtn(p, p);
    prevP = p;
  });

  const startItem = (currentPage - 1) * RESULTS_PER_PAGE + 1;
  const endItem = Math.min(currentPage * RESULTS_PER_PAGE, totalItems);

  paginationEl.innerHTML = `
    <span class="page-info">${startItem}–${endItem} dari ${totalItems}</span>
    ${pageBtn(currentPage - 1, '<i class="ti ti-chevron-left"></i>', currentPage === 1)}
    ${numberBtns}
    ${pageBtn(currentPage + 1, '<i class="ti ti-chevron-right"></i>', currentPage === totalPages)}
  `;

  paginationEl.querySelectorAll('.page-btn[data-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = parseInt(btn.dataset.page, 10);
      if (!p || p < 1 || p > totalPages || p === currentPage) return;
      currentPage = p;
      renderResults(lastResults);
      panelBodyCari.scrollTop = 0;
    });
  });
}
// CLIPBOARD
function addToClip(kode) {
  const r = lastResults.find(x => x.kode_produk === kode);
  if (!r) return;
  if (clipboard.some(c => c.kode_produk === r.kode_produk)) { removeFromClip(r.kode_produk); return; }
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
  clipboard.push(newItem);
  updateClipboard();
  renderResults(lastResults);
  persistAddItem(newItem); // simpan ke sesi (async, gak nunggu biar UI tetep responsif)
}
function removeFromClip(kode) {
  const removed = clipboard.find(c => c.kode_produk === kode);
  clipboard = clipboard.filter(c => c.kode_produk !== kode);
  updateClipboard();
  renderResults(lastResults);
  if (removed) persistRemoveItem(removed);
}
function updateClipAggregates() {
  const n = clipboard.length;
  hdrCount.textContent = n;
  clipTotal.textContent = n;
  btnExport.disabled = n === 0;
  btnRecord.disabled = n === 0;
  clipEmpty.style.display = n === 0 ? 'block' : 'none';
  const tabBadge = document.getElementById('tab-badge');
  if (tabBadge) { tabBadge.textContent = n; tabBadge.style.display = n > 0 ? 'inline-block' : 'none'; }
  clipTabBadgeList.textContent = n;
  clipTabBadgeList.style.display = n > 0 ? 'inline-block' : 'none';

  // Total harga clipboard + bandingin sama Pagu (kalau ada sesi Kebutuhan RS aktif)
  let totalHargaClip = 0;
  let adaHargaKosong = false;
  clipboard.forEach(item => {
    const h = modeSwasta ? item.harga_swasta : item.harga_ekat;
    if (h) totalHargaClip += h * item.qty;
    else adaHargaKosong = true;
  });
  if (n === 0) {
    clipTotalHarga.textContent = '';
  } else {
    clipTotalHarga.textContent = rupiah(totalHargaClip) + (adaHargaKosong ? ' +' : '');
  }
  updateClipSummaryStrip();
  if (typeof updateSetcariSourceCount === 'function') updateSetcariSourceCount();
  if (n > 0 && typeof checklistPagu !== 'undefined' && checklistPagu != null) {
    const sisa = checklistPagu - totalHargaClip;
    clipBudget.classList.add('show');
    if (sisa >= 0) {
      clipBudget.classList.remove('over');
      clipBudget.classList.add('under');
      clipBudget.innerHTML = `<span>Sisa pagu</span><b>${rupiah(sisa)}</b>`;
    } else {
      clipBudget.classList.remove('under');
      clipBudget.classList.add('over');
      clipBudget.innerHTML = `<span>Lebih dari pagu</span><b>${rupiah(Math.abs(sisa))}</b>`;
    }
  } else {
    clipBudget.classList.remove('show');
  }
}

// Template satu baris clipboard — dipakai render awal (updateClipboard) MAUPUN
// patch realtime (insertClipItem/patchClipItem), biar markup-nya gak dobel definisi.
function renderClipItemHtml(item) {
  const isSet = item.is_set;
  const tipeColor = isSet ? 'background:var(--success-bg);color:var(--success)' : 'background:var(--accent-bg);color:var(--accent-text)';
  const hargaTampil = modeSwasta ? item.harga_swasta : item.harga_ekat;
  const totalHarga = hargaTampil ? hargaTampil * item.qty : null;
  return `<div class="clip-item" data-kode="${item.kode_produk}">
      <div class="clip-item-info">
        <div class="clip-item-name">${item.nama_produk}</div>
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
      const item = clipboard.find(c => c.kode_produk === btn.dataset.kode);
      if (!item) return;
      item.qty = Math.max(1, item.qty + parseInt(btn.dataset.d));
      if (item._sesiItemId) markLocalWrite(SESI_ITEM_TABLE, item._sesiItemId, 'qty', item.qty);
      patchClipItem(item.kode_produk, { qty: item.qty });
      persistUpdateQty(item);
    });
  });
  // FIX: handler untuk input qty yang diketik manual
  scopeEl.querySelectorAll('.qty-input').forEach(input => {
    // update saat user selesai ngetik (blur) atau tekan Enter
    const commit = () => {
      const item = clipboard.find(c => c.kode_produk === input.dataset.kode);
      if (!item) return;
      let val = parseInt(input.value, 10);
      if (isNaN(val) || val < 1) val = 1;
      item.qty = val;
      if (item._sesiItemId) markLocalWrite(SESI_ITEM_TABLE, item._sesiItemId, 'qty', item.qty);
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
  clipList.innerHTML = clipboard.map(renderClipItemHtml).join('');
  bindClipItemEvents(clipList);
}

// ---- Patch granular (dipakai realtime DAN aksi lokal qty +/-/ketik) ----
// Bedanya sama updateClipboard(): ini cuma nyentuh SATU baris + angka agregat,
// gak nge-rebuild innerHTML seluruh daftar — biar baris lain gak ikut kedip
// dan scroll position/fokus input orang lain gak keganggu.
function patchClipItem(kode, changes) {
  const item = clipboard.find(c => c.kode_produk === kode);
  if (!item) return;
  Object.assign(item, changes);
  const node = clipList.querySelector(`.clip-item[data-kode="${CSS.escape(kode)}"]`);
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

function insertClipItem(item) {
  if (clipboard.some(c => c.kode_produk === item.kode_produk)) { patchClipItem(item.kode_produk, item); return; }
  clipboard.push(item);
  const temp = document.createElement('div');
  temp.innerHTML = renderClipItemHtml(item);
  const newNode = temp.firstElementChild;
  newNode.classList.add('rt-fade-in');
  clipList.prepend(newNode); // item baru dari kolaborator muncul paling atas, biar kelihatan
  bindClipItemEvents(newNode);
  updateClipAggregates();
}

function removeClipItemDom(kode) {
  const idx = clipboard.findIndex(c => c.kode_produk === kode);
  if (idx === -1) return;
  clipboard.splice(idx, 1);
  const node = clipList.querySelector(`.clip-item[data-kode="${CSS.escape(kode)}"]`);
  if (node) {
    node.classList.add('rt-removing');
    setTimeout(() => node.remove(), 260);
  }
  updateClipAggregates();
}

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

// PROGRESS
function setProgress(current, total, label) {
  const pct = total > 0 ? Math.round((current/total)*100) : 0;
  progressFill.style.width = pct + '%';
  progressLabel.textContent = `${current} / ${total}`;
  if (label) modalSub.textContent = label;
}

// GET SET ITEMS
async function getSetItems(kode_produk) {
  const r1 = await fetch(`${SUPABASE_URL}/rest/v1/produk?kode_produk=eq.${encodeURIComponent(kode_produk)}&select=id&limit=1`, {
    headers: {'apikey':ANON_KEY,'Authorization':'Bearer '+ANON_KEY}
  });
  const prodList = await r1.json();
  if (!prodList || !prodList.length) return [];
  const set_id = prodList[0].id;
  
  const r2 = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_set_items`, {
    method: 'POST',
    headers: {'apikey':ANON_KEY,'Authorization':'Bearer '+ANON_KEY,'Content-Type':'application/json'},
    body: JSON.stringify({p_set_id: set_id})
  });
  const data = await r2.json();
  return data || [];
}

// EXPORT EXCEL
btnExport.addEventListener('click', async () => {
  const namaRs = inpRs.value.trim() || 'RS';
  const namaSales = inpSales.value.trim() || 'Sales';
  const tanggal = new Date().toLocaleDateString('id-ID', {day:'2-digit', month:'long', year:'numeric'});

  // Sesi ini udah pernah di-Record sebelumnya? Kalau iya, file export dikasih
  // suffix -REV{n} ngikutin nomor revisi yang BAKAL kepake kalau kamu Record
  // sekarang (revisi terakhir + 1) — bukan revisi lama yang udah tersimpan.
  // Ini disamain sama cara Record ngitung nomornya, biar nama file yang kamu
  // export duluan (sebelum sempet Record) tetep konsisten sama yang bakal
  // kesimpen nanti, bukan ketinggalan satu angka.
  let revSuffix = '';
  if (currentSesiId) {
    try {
      const revRes = await sesiFetch(`konversi_record?sesi_id=eq.${currentSesiId}&select=revisi&order=revisi.desc&limit=1`);
      if (revRes.ok) {
        const revRows = await revRes.json();
        if (revRows.length) {
          const revisiBerikutnya = (revRows[0].revisi || 0) + 1;
          revSuffix = `-REV${revisiBerikutnya}`;
        }
      }
    } catch { /* gagal cek revisi → export tetap jalan tanpa suffix, bukan blocking */ }
  }

  const filename = `CONVERTED${modeSwasta?'-SWASTA':''}-${namaSales.replace(/[^a-zA-Z0-9 ]/g,'').trim()}-${namaRs.replace(/[^a-zA-Z0-9 ]/g,'').trim()}-${tanggal}${revSuffix}.xlsx`;

  exportModal.classList.add('show');
  setProgress(0, 1, 'Menyiapkan data…');

  try {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'PT Pionir Nusantara Manufacturing';
    wb.created = new Date();

    // ── COLLECT ALL ITEMS NEEDED FOR IMAGE FETCH ──
    const sets = clipboard.filter(i => i.is_set);
    const satuans = clipboard.filter(i => !i.is_set && i.tipe !== 'UNIT');

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
    clipboard.forEach(item => {
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
    const sumHeaders = modeSwasta
      ? ['No.','Kode Produk','Nama Produk / Deskripsi','QTY','Harga Swasta','Total Harga','Status Stok']
      : ['No.','Kode Produk','Nama Produk / Deskripsi','QTY','Harga e-Kat','Total Harga','Link e-Katalog v6','Status Stok'];
    sumHeaders.forEach((h,i) => {
      const cell = sumHdrRow.getCell(i+1);
      cell.value = h;
      cell.font = {bold:true, color:{argb:'FFFFFFFF'}};
      cell.fill = {type:'pattern', pattern:'solid', fgColor:{argb:'FF1D5BD4'}};
      cell.alignment = {vertical:'middle', horizontal:'center'};
      cell.border = {bottom:{style:'thin',color:{argb:'FFE2E4E9'}}};
    });
    sumHdrRow.height = 22;
    wsSummary.columns = modeSwasta
      ? [{width:5},{width:24},{width:50},{width:8},{width:18},{width:18},{width:14}]
      : [{width:5},{width:24},{width:50},{width:8},{width:18},{width:18},{width:45},{width:14}];

    let sumRow = 8;
    let grandTotal = 0;
    const stokColIdx = modeSwasta ? 7 : 8;
    clipboard.forEach((item, idx) => {
      const row = wsSummary.getRow(sumRow);
      const hargaPakai = modeSwasta ? (item.harga_swasta || 0) : (item.harga_ekat || 0);
      const total = hargaPakai * (item.qty || 1);
      grandTotal += total;
      row.getCell(1).value = idx + 1;
      row.getCell(2).value = item.kode_produk;
      row.getCell(3).value = item.nama_produk;
      row.getCell(4).value = item.qty || 1;
      row.getCell(5).value = hargaPakai || '';
      row.getCell(6).value = total || '';
      if (!modeSwasta && item.link_v6) {
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
      // zebra
      const zebraCount = modeSwasta ? 7 : 8;
      if (idx % 2 === 0) {
        Array.from({length: zebraCount}, (_,c)=>c+1).forEach(c => {
          row.getCell(c).fill = {type:'pattern',pattern:'solid',fgColor:{argb:'FFF5F6F8'}};
        });
      }
      row.alignment = {vertical:'middle'};
      sumRow++;
    });

    // total row
    const totRow = wsSummary.getRow(sumRow);
    totRow.getCell(3).value = 'GRAND TOTAL';
    totRow.getCell(3).font = {bold:true};
    totRow.getCell(6).value = grandTotal;
    totRow.getCell(6).font = {bold:true};
    totRow.getCell(6).numFmt = '#,##0';

    // format harga cols
    for (let r = 8; r <= sumRow; r++) {
      wsSummary.getRow(r).getCell(5).numFmt = '#,##0';
      wsSummary.getRow(r).getCell(6).numFmt = '#,##0';
    }

    // ── SHEET: KEBUTUHAN RS ──
    // Cuma dibikin kalau sesi ini emang punya Permintaan RS yang direcord.
    // Formatnya niru workflow lama tim (Google Sheets): satu baris = satu item
    // yang diminta RS, kolom Kode/Deskripsi/Harga keisi kalau item itu udah
    // di-link ke produk clipboard lewat fitur "Bisa Dipenuhi". Kosong kalau
    // belum di-link (baik karena belum dicek, atau ditandai tidak bisa).
    if (checklistItems.length > 0) {
      const wsKb = wb.addWorksheet('KEBUTUHAN RS');
      wsKb.getRow(1).getCell(1).value = 'KEBUTUHAN RS';
      wsKb.getRow(1).getCell(1).font = {bold:true, size:13};
      wsKb.getRow(2).getCell(1).value = 'PT Pionir Nusantara Manufacturing';
      wsKb.getRow(2).getCell(1).font = {italic:true, color:{argb:'FF4B5563'}};
      wsKb.getRow(3).getCell(1).value = 'RS / Instansi'; wsKb.getRow(3).getCell(2).value = checklistNamaRs || namaRs;
      wsKb.getRow(4).getCell(1).value = 'Sales';          wsKb.getRow(4).getCell(2).value = checklistSales || namaSales;
      wsKb.getRow(5).getCell(1).value = 'Pagu';           wsKb.getRow(5).getCell(2).value = checklistPagu != null ? checklistPagu : '';
      wsKb.getRow(6).getCell(1).value = '';

      const kbHdrRow = wsKb.getRow(7);
      const kbHeaders = ['No.','Item Diminta','Qty Diminta','Kode Produk','Deskripsi','Harga','Total','Status'];
      kbHeaders.forEach((h,i) => {
        const cell = kbHdrRow.getCell(i+1);
        cell.value = h;
        cell.font = {bold:true, color:{argb:'FFFFFFFF'}};
        cell.fill = {type:'pattern', pattern:'solid', fgColor:{argb:'FF1D5BD4'}};
        cell.alignment = {vertical:'middle', horizontal:'center'};
        cell.border = {bottom:{style:'thin',color:{argb:'FFE2E4E9'}}};
      });
      kbHdrRow.height = 22;
      wsKb.columns = [{width:5},{width:40},{width:12},{width:22},{width:38},{width:16},{width:16},{width:16}];

      let kbRow = 8;
      let kbGrandTotal = 0;
      checklistItems.forEach((item, idx) => {
        // Satu kebutuhan bisa kesambung ke lebih dari 1 SKU (bundle) — gabungkan
        // kode/nama dengan "; " dan jumlahkan totalnya, bukan cuma ambil satu.
        const matchedList = (item.matched_items || [])
          .map(l => clipboard.find(c => c.kode_produk === l.kode_produk))
          .filter(Boolean);
        const hargaTotalRow = matchedList.reduce((sum, m) => {
          const link = (item.matched_items || []).find(l => l.kode_produk === m.kode_produk);
          const hargaSatuan = modeSwasta ? (m.harga_swasta || 0) : (m.harga_ekat || 0);
          const qty = (link && link.qty_alokasi != null) ? link.qty_alokasi : (item.qty_diminta || 1);
          return sum + hargaSatuan * qty;
        }, 0);
        if (matchedList.length) kbGrandTotal += hargaTotalRow;

        const row = wsKb.getRow(kbRow);
        row.getCell(1).value = idx + 1;
        row.getCell(2).value = item.raw_text;
        row.getCell(3).value = item.qty_diminta || '';
        row.getCell(4).value = matchedList.map(m => m.kode_produk).join('; ');
        row.getCell(5).value = matchedList.map(m => m.nama_produk).join('; ');
        row.getCell(6).value = matchedList.length === 1 ? (modeSwasta ? (matchedList[0].harga_swasta||0) : (matchedList[0].harga_ekat||0)) : '';
        row.getCell(7).value = matchedList.length ? hargaTotalRow : '';

        const statusLabel = item.status === 'TERPENUHI' ? 'Bisa Dipenuhi'
          : item.status === 'TIDAK_TERPENUHI' ? 'Tidak Bisa'
          : 'Belum Dicek';
        row.getCell(8).value = statusLabel;
        row.getCell(8).alignment = {horizontal:'center', vertical:'middle'};
        if (statusLabel === 'Bisa Dipenuhi') row.getCell(8).font = {color:{argb:'FF15803D'}, bold:true};
        else if (statusLabel === 'Tidak Bisa') row.getCell(8).font = {color:{argb:'FFB91C1C'}, bold:true};
        else row.getCell(8).font = {color:{argb:'FFB45309'}, bold:true};

        if (idx % 2 === 0) {
          Array.from({length:8}, (_,c)=>c+1).forEach(c => {
            row.getCell(c).fill = {type:'pattern',pattern:'solid',fgColor:{argb:'FFF5F6F8'}};
          });
        }
        row.alignment = {vertical:'middle', wrapText: true};
        kbRow++;
      });

      const kbTotRow = wsKb.getRow(kbRow);
      kbTotRow.getCell(5).value = 'TOTAL TERPENUHI';
      kbTotRow.getCell(5).font = {bold:true};
      kbTotRow.getCell(7).value = kbGrandTotal;
      kbTotRow.getCell(7).font = {bold:true};
      kbTotRow.getCell(7).numFmt = '#,##0';
      kbRow++;

      const doneCount = checklistItems.filter(i => i.status === 'TERPENUHI').length;
      const totalCount = checklistItems.length;
      const pct = totalCount > 0 ? Math.round((doneCount/totalCount)*1000)/10 : 0;
      const kbRekapRow = wsKb.getRow(kbRow);
      kbRekapRow.getCell(2).value = `Tingkat pemenuhan: ${pct}% (${doneCount}/${totalCount} item)`;
      kbRekapRow.getCell(2).font = {italic:true, color:{argb:'FF4B5563'}};

      for (let r = 8; r < kbRow - 1; r++) {
        wsKb.getRow(r).getCell(6).numFmt = '#,##0';
        wsKb.getRow(r).getCell(7).numFmt = '#,##0';
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
          row.getCell(c).alignment = {vertical:'middle', horizontal: c===3?'left':'center', wrapText:true};
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
          row.getCell(c).alignment = {vertical:'middle', horizontal: c===3?'left':'center', wrapText:true};
          if (idx % 2 === 0) row.getCell(c).fill = {type:'pattern',pattern:'solid',fgColor:{argb:'FFF5F6F8'}};
        });
        addImg(wsGambar, imgMap[item.kode_produk], dataRow, 5, 80, 65, item.kode_produk);
      }
    }

    // ── SHEET LAMPIRAN (instrumen, set, ataupun unit — 1 sheet per produk yg PUNYA lampiran) ──
    // Dulu cuma dicek buat tipe UNIT. Sekarang brosur bisa diupload utk tipe apa aja
    // (lihat fitur drag&drop lampiran), jadi semua item di clipboard dicek satu-satu;
    // yg gak ada lampirannya dilewatin aja (gak bikin sheet kosong).
    const lampiranCandidates = clipboard;
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

      for (let u = 0; u < lampiranCandidates.length; u++) {
        const item = lampiranCandidates[u];
        setProgress(u, lampiranCandidates.length, `Mengecek lampiran: ${item.nama_produk}`);
        const { filename, pages } = await getLampiranPagesForKode(item.kode_produk);
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

  } catch(e) {
    showToast('Export gagal: ' + e.message, 'error');
    console.error(e);
  } finally {
    exportModal.classList.remove('show');
  }
});

// CLEAR ALL
btnClearAll.addEventListener('click', async () => {
  if (!clipboard.length) return;
  if (await showConfirmModal({ title: 'Hapus Semua', text: 'Hapus semua item dari clipboard?', okText: 'Ya, Hapus', danger: true })) {
    const sesiIdSebelumnya = currentSesiId;
    clipboard = [];
    updateClipboard();
    renderResults(lastResults);
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
  resultsEl.innerHTML = '';
  paginationEl.innerHTML = '';
  paginationEl.classList.add('hidden');
  currentPage = 1;
  metaEl.textContent = '';
  sortSelect.style.display = 'none';
  emptyEl.style.display = 'none';
  loadingEl.style.display = 'none';
  hintEl.style.display = 'block';
  errEl.style.display = 'none';
  acBox.style.display = 'none';
}

// EVENTS
takd.addEventListener('click', () => { onlyAkd=!onlyAkd; takd.classList.toggle('on',onlyAkd); runSearch(); });
tswasta.addEventListener('click', () => {
  modeSwasta = !modeSwasta;
  tswasta.classList.toggle('on', modeSwasta);
  applySort();
  currentPage = 1;
  if (lastResults.length) renderResults(lastResults);
  updateClipboard();
});
sortSelect.addEventListener('change', () => {
  sortMode = sortSelect.value;
  applySort();
  currentPage = 1;
  renderResults(lastResults);
});
tipeBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const tipe = btn.dataset.tipe;
    selectedTipe = (selectedTipe === tipe) ? null : tipe;
    tipeBtns.forEach(b => b.classList.toggle('on', b.dataset.tipe === selectedTipe));
    runSearch();
  });
});
clearBtn.addEventListener('click', () => { searchInput.value=''; clearBtn.style.display='none'; acBox.style.display='none'; reset(); searchInput.focus(); });

searchInput.addEventListener('input', () => {
  if (searchInput.value.trim().toLowerCase() === '/linkpalsugas') {
    searchInput.value = '';
    clearBtn.style.display = 'none';
    acBox.style.display = 'none';
    if (typeof window.openLinkGenModal === 'function') window.openLinkGenModal();
    return;
  }
  clearBtn.style.display = searchInput.value ? 'block' : 'none';
  clearTimeout(acTimer);
  acTimer = setTimeout(() => runSearch(), 150);
});

searchInput.addEventListener('keydown', e => {
  const items = acBox.querySelectorAll('.ac-item');
  if (e.key==='ArrowDown'){e.preventDefault();acIndex=Math.min(acIndex+1,items.length-1);items.forEach((el,i)=>el.classList.toggle('active',i===acIndex));}
  else if(e.key==='ArrowUp'){e.preventDefault();acIndex=Math.max(acIndex-1,-1);items.forEach((el,i)=>el.classList.toggle('active',i===acIndex));}
  else if(e.key==='Enter'){if(acIndex>=0&&items[acIndex])searchInput.value=acItems[acIndex].nama_produk;acBox.style.display='none';runSearch();}
  else if(e.key==='Escape')acBox.style.display='none';
});

document.addEventListener('click', e => { if(!document.querySelector('.search-wrap').contains(e.target)) acBox.style.display='none'; });

function switchTab(tab) {
  const ps = document.getElementById('panel-search');
  const pc = document.getElementById('panel-clip');
  const ts = document.getElementById('tab-search');
  const tc = document.getElementById('tab-clip');
  if (tab==='search') { ps.classList.add('active'); pc.classList.remove('active'); ts.classList.add('active'); tc.classList.remove('active'); }
  else { pc.classList.add('active'); ps.classList.remove('active'); tc.classList.add('active'); ts.classList.remove('active'); }
}

if (window.innerWidth <= 768) document.getElementById('panel-search').classList.add('active');

updateClipboard();

// ══════════════════════════════════════════
// RECORD KONVERSI → GOOGLE SHEETS (Apps Script webhook)
// ══════════════════════════════════════════

// GANTI dengan URL Web App hasil deploy Google Apps Script kamu.
const GAS_WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbylWyYXD5HQG2vEFhUG4vekkuJEyOfTFQmY-UOgn1CKvBgZ9z3JLkA8Ke2zgTVdEWWTkQ/exec';

// Ingat nama PIC Marsup di browser supaya ga perlu ketik ulang tiap buka
(function initMarsupName() {
  const saved = localStorage.getItem('pic_marsup_name');
  if (saved) inpMarsup.value = saved;
})();
inpMarsup.addEventListener('input', () => {
  localStorage.setItem('pic_marsup_name', inpMarsup.value.trim());
});

// Hitung kategori (Instrumen / Set / Unit / Campuran) + total value dari clipboard
function computeKonversiSummary() {
  const tipeSet = new Set(clipboard.map(i => (i.tipe || '').toUpperCase()));
  let kategori;
  if (tipeSet.size === 0) kategori = '-';
  else if (tipeSet.size > 1) kategori = 'Campuran';
  else {
    const t = [...tipeSet][0];
    kategori = t === 'INSTRUMENT' ? 'Instrumen' : t === 'SET' ? 'Set' : t === 'UNIT' ? 'Unit' : t;
  }

  let grandTotal = 0;
  clipboard.forEach(item => {
    const hargaPakai = modeSwasta ? (item.harga_swasta || 0) : (item.harga_ekat || 0);
    grandTotal += hargaPakai * (item.qty || 1);
  });

  return { kategori, grandTotal };
}

function openRecordModal() {
  const namaRs = inpRs.value.trim() || 'RS';
  const namaSales = inpSales.value.trim() || 'Sales';
  const { kategori, grandTotal } = computeKonversiSummary();

  // Soft-gate: cuma nudge, gak nge-block. checklistPermintaanId keisi kalau
  // sesi ini udah pernah ada Permintaan RS (baru diisi ATAU dimuat ulang
  // lewat loadChecklistForSesi pas openSesi). Kalau kosong, kemungkinan besar
  // emang belum dicatat — 1x reminder di titik final ini nangkep kasus lupa.
  document.getElementById('pr-nudge').classList.toggle('show', !checklistPermintaanId);

  recTanggal.textContent = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
  recRs.textContent = namaRs;
  recSales.textContent = namaSales;
  recKategori.textContent = kategori;
  recValue.textContent = rupiah(grandTotal);
  recNotes.value = '';
  recLink.value = '';
  recordStatus.textContent = '';
  recordStatus.style.color = '';
  recordSubmitBtn.disabled = false;
  recordSubmitBtn.textContent = 'Kirim ke Sheet';

  recordModal.classList.add('show');
}

btnRecord.addEventListener('click', openRecordModal);
recordCancelBtn.addEventListener('click', () => recordModal.classList.remove('show'));
recordModal.addEventListener('click', (e) => { if (e.target === recordModal) recordModal.classList.remove('show'); });

// Klik "Isi Permintaan RS dulu" dari dalam nudge: pindah ke modal Permintaan RS,
// tandain biar abis submit balik lagi ke Record modal (bukan ilang ke layar lain).
var resumeRecordAfterPr = false;
document.getElementById('pr-nudge-btn').addEventListener('click', () => {
  resumeRecordAfterPr = true;
  recordModal.classList.remove('show');
  openPrModal();
});

// ══════════════════════════════════════════
// DUAL WRITE: Supabase (konversi_record + konversi_item, granular, source
// of truth buat insight) dulu, baru Google Sheet (mirror, format lama tetap
// dipertahankan persis karena ada laporan lain yang gantung ke situ).
// Urutannya sengaja gak paralel: kalau Supabase gagal, seluruh operasi
// dianggap gagal (data belum "resmi" tercatat). Kalau cuma Sheet yang gagal,
// data tetap dianggap tersimpan — user bisa retry sync ke Sheet aja tanpa
// harus input ulang semuanya dari nol.
// ══════════════════════════════════════════
recordSubmitBtn.addEventListener('click', async () => {
  if (!inpMarsup.value.trim()) {
    recordStatus.textContent = 'Isi dulu nama PIC Marsup di panel clipboard.';
    recordStatus.style.color = 'var(--danger)';
    return;
  }

  const namaRs = inpRs.value.trim() || 'RS';
  const namaSales = inpSales.value.trim() || 'Sales';
  const { kategori, grandTotal } = computeKonversiSummary();
  const tanggalIso = new Date().toISOString().slice(0, 10);

  recordSubmitBtn.disabled = true;
  recordSubmitBtn.textContent = 'Menyimpan…';
  recordStatus.textContent = '';

  let newRecordId = null;

  // ---- Tahap 1: Supabase (fondasi, wajib sukses) ----
  try {
    // Cek dulu apakah sesi ini udah pernah kerekam sebelumnya (mis. sesi lama
    // yang di-reopen dari tab Riwayat lalu diubah lagi). Kalau iya, ini
    // dianggap REVISI: record baru tetap di-INSERT (bukan nimpa yang lama —
    // biar histori tiap versi kesimpen lengkap), tapi dikasih nomor revisi
    // yang naik dari yang terakhir.
    let revisiKe = 0;
    if (currentSesiId) {
      try {
        const cekRes = await sesiFetch(`konversi_record?sesi_id=eq.${currentSesiId}&select=revisi&order=revisi.desc&limit=1`);
        if (cekRes.ok) {
          const cekRows = await cekRes.json();
          if (cekRows.length) revisiKe = (cekRows[0].revisi || 0) + 1;
        }
      } catch { /* gagal cek → anggap revisi 0, fallback aman (bukan blocking) */ }
    }

    const recordBody = {
      sesi_id: currentSesiId || null,
      permintaan_id: checklistPermintaanId || null,
      tanggal: tanggalIso,
      nama_rs: namaRs,
      pic_sales: namaSales,
      pic_marsup: inpMarsup.value.trim(),
      pagu_total: (typeof checklistPagu !== 'undefined' ? checklistPagu : null),
      kategori: kategori,
      grand_total: grandTotal,
      revisi: revisiKe,
      notes: recNotes.value.trim(),
      link: recLink.value.trim(),
      synced_to_sheet: false
    };

    const recRes = await sesiFetch('konversi_record', {
      method: 'POST',
      headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify(recordBody)
    });
    if (!recRes.ok) {
      const errData = await recRes.json().catch(() => ({}));
      throw new Error(errData.message || errData.hint || 'Gagal menyimpan header konversi_record');
    }
    const recRows = await recRes.json();
    newRecordId = recRows[0].id;

    // Detail per item — ini yang bikin data granular buat insight nanti
    // (produk apa yang sering INDENT, revenue per kategori/produk, dst).
    const itemRows = clipboard.map(item => {
      const hargaPakai = modeSwasta ? (item.harga_swasta || 0) : (item.harga_ekat || 0);
      return {
        konversi_record_id: newRecordId,
        produk_id: item.produk_id || null,
        kode_produk: item.kode_produk,
        nama_produk: item.nama_produk,
        qty: item.qty || 1,
        harga: hargaPakai
      };
    });

    if (itemRows.length) {
      const itemRes = await sesiFetch('konversi_item', {
        method: 'POST',
        body: JSON.stringify(itemRows)
      });
      if (!itemRes.ok) {
        const errData = await itemRes.json().catch(() => ({}));
        throw new Error(errData.message || errData.hint || 'Record tersimpan, tapi detail item gagal (cek konversi_item)');
      }
    }

    // Sesi ini selesai → keluar dari daftar "Konversi Berjalan". Kalau ada
    // checklist Permintaan RS yang nempel, rekap pemenuhannya ikut
    // dipastikan tersimpan di langkah yang sama.
    if (currentSesiId) {
      sesiFetch(`${SESI_TABLE}?id=eq.${currentSesiId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'selesai', updated_at: new Date().toISOString() })
      }).catch(() => {});
      // currentSesiId SENGAJA tetap dipertahankan (bukan di-null-in) — kalau
      // langsung di-null, Export yang diklik tepat setelah Record kehilangan
      // pegangan buat ngecek nomor revisi (jadi filename-nya balik polos tanpa
      // -REVx). Sesi tetap "kepegang" di layar sampai user eksplisit klik
      // "Mulai Sesi Baru" atau buka sesi lain — statusnya sendiri udah 'selesai'
      // di server, jadi tetap gak nyangkut di daftar "Konversi Berjalan".
      updateEndSesiBtnState();
      loadSesiList();
      if (subtabRiwayat.classList.contains('active')) loadRiwayatList();
    }
    if (checklistPermintaanId) {
      autoFinalizePermintaan().catch(() => {});
    }

    recordStatus.textContent = (revisiKe > 0 ? `Tersimpan sebagai REV${revisiKe} ✓` : 'Tersimpan ✓') + ' — menyinkronkan ke Sheet…';
    recordStatus.style.color = 'var(--success)';
  } catch (err) {
    recordStatus.textContent = 'Gagal: ' + err.message;
    recordStatus.style.color = 'var(--danger)';
    recordSubmitBtn.disabled = false;
    recordSubmitBtn.textContent = 'Kirim ke Sheet';
    return; // stop total — fondasi gagal, jangan lanjut ke sheet
  }

  // ---- Tahap 2: Google Sheet (mirror, format tetap sama persis) ----
  // keyword/rekanan/customer/distributor sengaja diisi nilai yang sama —
  // itu format yang sudah dipakai sheet lain yang gantung ke kolom ini,
  // jadi TIDAK diubah.
  const sheetPayload = {
    tanggal: tanggalIso,
    pic_marsup: inpMarsup.value.trim(),
    pic_sales: namaSales,
    keyword: namaRs,
    rekanan: namaRs,
    customer: namaRs,
    distributor: namaRs,
    kategori: kategori,
    value: grandTotal,
    notes: recNotes.value.trim(),
    link: recLink.value.trim()
  };

  try {
    if (!GAS_WEBHOOK_URL || GAS_WEBHOOK_URL.startsWith('PASTE_URL')) {
      throw new Error('URL webhook Apps Script belum diisi di kode (GAS_WEBHOOK_URL).');
    }
    const res = await fetch(GAS_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // hindari CORS preflight ke Apps Script
      body: JSON.stringify(sheetPayload)
    });
    const result = await res.json();
    if (!result.ok) throw new Error(result.error || 'Gagal menyimpan ke sheet');

    if (newRecordId) {
      sesiFetch(`konversi_record?id=eq.${newRecordId}`, {
        method: 'PATCH',
        body: JSON.stringify({ synced_to_sheet: true })
      }).catch(() => {});
    }

    recordStatus.textContent = 'Berhasil dicatat & disinkronkan ke Sheet ✓';
    recordStatus.style.color = 'var(--success)';
    setTimeout(() => recordModal.classList.remove('show'), 1200);
  } catch (err) {
    // Sheet gagal BUKAN berarti semuanya gagal — data sudah aman di Supabase.
    recordStatus.textContent = 'Tersimpan di sistem ✓, tapi gagal sync ke Sheet: ' + err.message;
    recordStatus.style.color = 'var(--danger)';
    recordSubmitBtn.disabled = false;
    recordSubmitBtn.textContent = 'Coba Sync ke Sheet Lagi';
    recordSubmitBtn.dataset.retryRecordId = newRecordId || '';
  }
});

// ══════════════════════════════════════════
// MODUL STOK: login ringan, parse Excel, upload (full replace),
// dan integrasi tampilan/sort stok ke hasil search
// ══════════════════════════════════════════

// Upload/timpa stok sekarang jadi modul mandiri di stok.html (Modul 03 di
// index) — divisi lain gak perlu lagi buka Konversian buat update stok
// harian. Konversian tetap butuh status stok buat badge READY/INDENT di
// hasil search, jadi bagian read-only (enrichResultsWithStok) di bawah ini
// TETAP ada, cuma bagian upload/timpa-nya yang dipindah.

// ---- Ambil status stok buat semua kode_asli yang muncul di hasil search ----
// NOTE: SET gak punya baris di stok_produk (stoknya ditentukan dari komponen),
// makanya dipisah query-nya: item biasa pakai v_stok_status (kode_asli), SET
// pakai v_stok_status_set (kode_produk milik SET itu sendiri), lalu digabung
// balik ke object `results` yang sama supaya badge/sort/export di hilir gak
// perlu tau bedanya — cukup baca r.stok_status & r.stok_qty seperti biasa.
async function enrichResultsWithStok(results) {
  const nonSet = results.filter(r => !(r.tipe && r.tipe.toUpperCase() === 'SET'));
  const setItems = results.filter(r => r.tipe && r.tipe.toUpperCase() === 'SET');

  await Promise.all([
    enrichNonSetStok(nonSet),
    enrichSetStok(setItems)
  ]);
}

async function enrichNonSetStok(results) {
  const kodeAsliList = [...new Set(results.map(r => r.kode_asli).filter(Boolean))];
  if (kodeAsliList.length === 0) return;

  try {
    const inList = kodeAsliList.map(k => `"${k.replace(/"/g,'')}"`).join(',');
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/v_stok_status?kode_asli=in.(${inList})&select=kode_asli,qty,status`,
      { headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + ANON_KEY } }
    );
    if (!res.ok) return; // kalau gagal, biarin badge stok gak muncul, jangan blokir search
    const stokData = await res.json();
    const stokMap = new Map(stokData.map(s => [s.kode_asli, s]));

    results.forEach(r => {
      const s = r.kode_asli ? stokMap.get(r.kode_asli) : null;
      r.stok_qty = s ? s.qty : null;
      r.stok_status = s ? s.status : null; // null = belum ada data stok sama sekali buat kode ini
    });
  } catch { /* diamkan, stok cuma nice-to-have di tampilan search */ }
}

// ---- Ambil status stok rakitan buat semua produk tipe SET (bottleneck komponen) ----
async function enrichSetStok(results) {
  const kodeSetList = [...new Set(results.map(r => r.kode_produk).filter(Boolean))];
  if (kodeSetList.length === 0) return;

  try {
    const inList = kodeSetList.map(k => `"${k.replace(/"/g,'')}"`).join(',');
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/v_stok_status_set?kode_produk=in.(${inList})&select=kode_produk,buildable_qty,status,jumlah_komponen,jumlah_komponen_terdata`,
      { headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + ANON_KEY } }
    );
    if (!res.ok) return;
    const stokData = await res.json();
    const stokMap = new Map(stokData.map(s => [s.kode_produk, s]));

    results.forEach(r => {
      const s = stokMap.get(r.kode_produk);
      r.stok_qty = s ? s.buildable_qty : null;         // dipakai bareng field yang sama kayak item biasa
      r.stok_status = s ? s.status : 'DATA_TIDAK_LENGKAP'; // gak ada baris di view = komponen blm ke-cek sama sekali
      r.stok_komponen_terdata = s ? s.jumlah_komponen_terdata : 0;
      r.stok_komponen_total = s ? s.jumlah_komponen : null;
    });
  } catch { /* diamkan, stok cuma nice-to-have di tampilan search */ }
}

// ══════════════════════════════════════════
// MODUL CONVERTER: paste daftar "kode<TAB>nama" (kode asli & deskripsi dari RS),
// dicocokkan EXACT ke katalog (lewat RPC search_produk_dengan_harga per kode —
// gak perlu RPC baru, tinggal exact-filter hasilnya di JS), lalu produk yang
// cocok langsung bisa ditambahkan ke clipboard sesi aktif seperti klik hasil
// pencarian biasa. Ujungnya tetap pakai alur Export/Record yang sudah ada.
// ══════════════════════════════════════════
const convInput = document.getElementById('conv-input');
const convStatus = document.getElementById('conv-status');
const convResultsEl = document.getElementById('conv-results');
const convActions = document.getElementById('conv-actions');
const btnConvProses = document.getElementById('btn-conv-proses');
const btnConvRetryErr = document.getElementById('btn-conv-retry-err');
const btnConvClear = document.getElementById('btn-conv-clear');
const btnConvAddAll = document.getElementById('btn-conv-add-all');
let convRows = [];

function parseConverterLine(line) {
  const idx = line.indexOf('\t');
  if (idx !== -1) {
    return { kode: line.slice(0, idx).trim(), nama_input: line.slice(idx + 1).trim() };
  }
  // Fallback kalau tab kepencet jadi spasi pas paste (1 spasi pun cukup) —
  // aman karena kode produk kita gak pernah punya spasi di dalamnya.
  const m = line.match(/^(\S+)\s+(.+)$/);
  if (m) return { kode: m[1].trim(), nama_input: m[2].trim() };
  return { kode: line.trim(), nama_input: '' };
}

function renderConvResults(rows) {
  convResultsEl.innerHTML = rows.map((r, i) => {
    let badge, color, sub = '';
    if (r.status === 'exact') { badge = '✅ Cocok'; color = 'var(--success)'; }
    else if (r.status === 'code_found_name_diff') {
      badge = '⚠️ Kode ketemu, nama beda';
      color = 'var(--warning)';
      sub = `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">Input: "${escapeHtmlAttr(r.nama_input)}" · Katalog: "${escapeHtmlAttr(r.produk.nama_produk)}"</div>`;
    } else if (r.status === 'error') {
      badge = '🔄 Error / timeout — belum sempat dicek';
      color = 'var(--warning)';
      sub = `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">${escapeHtmlAttr(r.errMsg || '')}</div>`;
    } else { badge = '❌ Tidak ditemukan'; color = 'var(--danger)'; }
    const disabled = r.produk ? '' : 'disabled';
    const checked = r.produk ? 'checked' : '';
    return `<div class="clip-item" style="align-items:flex-start">
      <input type="checkbox" class="conv-check" data-idx="${i}" ${checked} ${disabled} style="margin-top:4px"/>
      <div class="clip-item-info" style="margin-left:8px">
        <div class="clip-item-name">${escapeHtmlAttr(r.produk ? r.produk.nama_produk : r.nama_input || '(tanpa nama)')}</div>
        <div class="clip-item-meta">
          <span class="clip-item-code">${escapeHtmlAttr(r.kode)}</span>
          <span style="color:${color};font-size:11px">${badge}</span>
        </div>
        ${sub}
      </div>
    </div>`;
  }).join('');
}

// Satu pencocokan kode → produk, dengan 1x retry otomatis kalau RPC-nya
// timeout (backend search_produk_dengan_harga kadang timeout buat query
// tertentu — beda kasus dari "genuinely not found"). Kalau retry juga gagal,
// ditandai 'error' (bukan 'not_found') biar bisa diproses ulang belakangan.
async function matchOneKode(kode, nama_input) {
  const row = { kode, nama_input, status: 'not_found', produk: null, errMsg: null };
  if (!kode) return row;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { data, error } = await rpc('search_produk_dengan_harga', { q: kode, p_tipe: null, only_akd: false, only_kfa: false });
      if (error) {
        const msg = error.message || JSON.stringify(error);
        if ((msg.includes('timeout') || msg.includes('canceling')) && attempt === 0) continue; // retry sekali
        row.status = 'error';
        row.errMsg = msg;
        return row;
      }
      if (data && data.length) {
        const exact = data.find(r => r.kode_produk && r.kode_produk.toLowerCase() === kode.toLowerCase());
        if (exact) {
          row.produk = exact;
          const namaKatalog = (exact.nama_produk || '').trim().toLowerCase();
          const namaInputNorm = nama_input.trim().toLowerCase();
          row.status = (!namaInputNorm || namaKatalog === namaInputNorm) ? 'exact' : 'code_found_name_diff';
        }
      }
      return row;
    } catch (e) {
      if (attempt === 0) continue;
      row.status = 'error';
      row.errMsg = e.message;
      return row;
    }
  }
  return row;
}

async function finishConvBatch(rows) {
  const foundProduk = rows.filter(r => r.produk).map(r => r.produk);
  if (foundProduk.length) {
    convStatus.textContent = 'Mengambil status stok…';
    await enrichResultsWithStok(foundProduk);
  }
  convRows = rows;
  renderConvResults(rows);
  const nExact = rows.filter(r => r.status === 'exact').length;
  const nDiff = rows.filter(r => r.status === 'code_found_name_diff').length;
  const nErr = rows.filter(r => r.status === 'error').length;
  const nNotFound = rows.filter(r => r.status === 'not_found').length;
  convStatus.textContent = `Selesai — ${nExact} cocok penuh, ${nDiff} kode ketemu (nama beda), ${nNotFound} tidak ditemukan`
    + (nErr ? `, ${nErr} error/timeout (klik "Proses Ulang yang Error").` : '.');
  convActions.style.display = foundProduk.length ? 'block' : 'none';
  btnConvRetryErr.style.display = nErr ? 'inline-flex' : 'none';
}

async function processConverter() {
  const lines = convInput.value.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim());
  if (!lines.length) return;
  btnConvProses.disabled = true;
  btnConvRetryErr.style.display = 'none';
  convActions.style.display = 'none';
  convResultsEl.innerHTML = '';
  const parsed = lines.map(parseConverterLine);
  const rows = [];
  for (let i = 0; i < parsed.length; i++) {
    convStatus.textContent = `Mencocokkan ${i + 1} / ${parsed.length} — ${parsed[i].kode}`;
    rows.push(await matchOneKode(parsed[i].kode, parsed[i].nama_input));
  }
  await finishConvBatch(rows);
  btnConvProses.disabled = false;
}

btnConvProses.addEventListener('click', processConverter);
btnConvRetryErr.addEventListener('click', async () => {
  const errIdxs = convRows.map((r, i) => r.status === 'error' ? i : -1).filter(i => i >= 0);
  if (!errIdxs.length) return;
  btnConvRetryErr.disabled = true;
  for (let n = 0; n < errIdxs.length; n++) {
    const i = errIdxs[n];
    convStatus.textContent = `Mengulang ${n + 1} / ${errIdxs.length} — ${convRows[i].kode}`;
    convRows[i] = await matchOneKode(convRows[i].kode, convRows[i].nama_input);
  }
  await finishConvBatch(convRows);
  btnConvRetryErr.disabled = false;
});
btnConvClear.addEventListener('click', () => {
  convInput.value = '';
  convResultsEl.innerHTML = '';
  convStatus.textContent = '';
  convActions.style.display = 'none';
  btnConvRetryErr.style.display = 'none';
  convRows = [];
});

btnConvAddAll.addEventListener('click', async () => {
  btnConvAddAll.disabled = true;
  try {
    // Pastikan sesi kebuat/kepake SEKALI dulu di sini, sebelum loop nambahin
    // item — kalau enggak, tiap item bisa manggil ensureSesi() hampir bareng
    // dan masing-masing bikin sesi barunya sendiri (race condition → numpuk
    // sesi kosong di "Konversi Berjalan").
    await ensureSesi();
    const checks = [...convResultsEl.querySelectorAll('.conv-check')];
    let added = 0, skipped = 0;
    for (const chk of checks) {
      if (!chk.checked) continue;
      const row = convRows[parseInt(chk.dataset.idx, 10)];
      if (!row || !row.produk) continue;
      const r = row.produk;
      if (clipboard.some(c => c.kode_produk === r.kode_produk)) { skipped++; continue; }
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
      clipboard.push(newItem);
      await persistAddItem(newItem); // ditunggu satu-satu biar gak ada race lain & gak nge-flood API
      added++;
    }
    updateClipboard();
    showToast(`${added} produk ditambahkan ke clipboard` + (skipped ? `, ${skipped} sudah ada di clipboard` : ''), added > 0 ? 'success' : 'error');
  } finally {
    btnConvAddAll.disabled = false;
  }
});

// ══════════════════════════════════════════
// MODUL PERMINTAAN RS: catat permintaan (teks/Excel), cocokkan ke katalog,
// tampilkan mana yang match vs tidak. Pure data collection, bukan auto-konversi.
// ══════════════════════════════════════════

function openPrModal() {
  prStatusMsg.textContent = '';
  prTeksFromOcr = false;
  prShowTab('teks');
  reviewItems = [];
  prReviewWrap.style.display = 'none';
  prFormWrap.style.display = '';
  if (!prTanggal.value) prTanggal.value = new Date().toISOString().slice(0,10);

  // Satu login di gerbang awal sudah cukup — kalau token expired, balik ke gerbang.
  if (!stokAccessToken) {
    closePrModal();
    showGate('Sesi kamu habis, silakan masuk lagi.');
    return;
  }
  prModal.classList.add('show');
}
function closePrModal() { prModal.classList.remove('show'); }

btnPermintaan.addEventListener('click', openPrModal);
prCancelBtn2.addEventListener('click', () => { closePrModal(); resumeRecordAfterCancel(); });
prModal.addEventListener('click', (e) => { if (e.target === prModal) { closePrModal(); resumeRecordAfterCancel(); } });

// Kalau modal PR dibuka dari nudge tapi dibatalin (bukan submit), tetap balik
// ke Record modal — user cuma ngecek/mikir ulang, bukan mau kabur dari flow.
function resumeRecordAfterCancel() {
  if (resumeRecordAfterPr) {
    resumeRecordAfterPr = false;
    openRecordModal();
  }
}

// ---- Tab switch Teks / Excel / Screenshot ----
let prTeksFromOcr = false;
prTeks.addEventListener('input', () => { prTeksFromOcr = false; });
const prTabSs = document.getElementById('pr-tab-ss');
const prSsWrap = document.getElementById('pr-ss-wrap');
const prSsFile = document.getElementById('pr-ss-file');
const prSsRunBtn = document.getElementById('pr-ss-run-btn');
const prSsStatus = document.getElementById('pr-ss-status');

let prActiveTab = 'teks';
function prShowTab(which) {
  prActiveTab = which;
  prTabTeks.classList.toggle('active', which === 'teks');
  prTabExcel.classList.toggle('active', which === 'excel');
  prTabSs.classList.toggle('active', which === 'ss');
  prTeksWrap.style.display = which === 'teks' ? 'block' : 'none';
  prExcelWrap.style.display = which === 'excel' ? 'block' : 'none';
  prSsWrap.style.display = which === 'ss' ? 'block' : 'none';
}
prTabTeks.addEventListener('click', () => prShowTab('teks'));
prTabExcel.addEventListener('click', () => prShowTab('excel'));
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
    addSsReference(file);
    // Hasil OCR ditaruh ke textarea Paste Teks, biar user cek/edit dulu sebelum simpan —
    // sama sekali gak langsung disimpan otomatis dari OCR.
    prTeks.value = (prTeks.value ? prTeks.value + '\n' : '') + text;
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

prSubmitBtn.addEventListener('click', async () => {
  prStatusMsg.textContent = '';

  let items = [];
  let sumber = 'TEKS';
  try {
    if (prActiveTab === 'teks') {
      items = parseTeksPermintaan(prTeks.value);
      sumber = prTeksFromOcr ? 'SCREENSHOT' : 'TEKS';
    } else if (prActiveTab === 'excel') {
      const file = prFile.files[0];
      if (!file) throw new Error('Pilih file Excel dulu.');
      items = await parseExcelPermintaan(file);
      sumber = 'EXCEL';
    } else {
      throw new Error('Klik "Baca Teks dari Gambar" dulu, hasilnya akan dicek di tab Paste Teks sebelum disimpan.');
    }
  } catch (err) {
    prStatusMsg.textContent = 'Gagal baca input: ' + err.message;
    prStatusMsg.style.color = 'var(--danger)';
    return;
  }

  // Baris yang otomatis disaring pas parsing teks WA (header tabel, basa-basi,
  // dsb.) — dilaporkan ke staff, bukan diam-diam hilang. Kalau ternyata ada
  // yang kesaring padahal itu nama produk beneran, staff bisa tambah manual
  // lewat "+ Tambah baris" di layar Review.
  reviewSkipped = items._skipped || [];

  if (items.length === 0) {
    prStatusMsg.textContent = reviewSkipped.length
      ? `Semua ${reviewSkipped.length} baris kebaca sebagai noise (header/basa-basi), gak ada nama produk yang kedeteksi.`
      : 'Gak ada baris permintaan yang terbaca.';
    prStatusMsg.style.color = 'var(--danger)';
    return;
  }

  // Belum manggil API sama sekali di sini — hasil parse dibawa dulu ke layar
  // Review biar staff bisa cek/edit nama, qty, dan isi pagu satuan per item
  // (opsional) sebelum benar-benar disimpan ke server.
  reviewItems = items.map(it => ({ raw_text: it.raw_text, qty: it.qty, pagu_satuan: it.pagu_satuan ?? null }));
  reviewSumber = sumber;
  renderReviewRows();
  prFormWrap.style.display = 'none';
  prReviewWrap.style.display = '';
});

// ---- Step 2: Layar Review — edit manual sebelum submit_permintaan_rs ----
let reviewItems = [];      // {raw_text, qty, pagu_satuan}
let reviewSumber = 'TEKS';
let reviewSkipped = [];    // baris mentah yang otomatis disaring pas parsing (info doang, ditampilkan)

function escapeHtmlAttr(s) {
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function renderReviewRows() {
  const labelSumber = reviewSumber === 'EXCEL' ? 'Excel' : reviewSumber === 'SCREENSHOT' ? 'screenshot' : 'teks';
  let info = `${reviewItems.length} item terbaca dari ${labelSumber} — cek dan lengkapi sebelum disimpan`;
  if (reviewSkipped.length) {
    info += `. ${reviewSkipped.length} baris disaring otomatis (bukan nama produk — header/basa-basi/simbol lepas): "${reviewSkipped.slice(0, 3).map(s => escapeHtmlAttr(s)).join('", "')}"${reviewSkipped.length > 3 ? ', dst.' : ''}`;
  }
  prReviewInfo.innerHTML = info;
  prReviewRows.innerHTML = reviewItems.length ? reviewItems.map((it, idx) => `
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
  const rows = prReviewRows.querySelectorAll('.pr-review-row');
  rows.forEach((row) => {
    const idx = parseInt(row.dataset.idx, 10);
    if (!reviewItems[idx]) return;
    const nama = row.querySelector('.pr-rv-nama').value.trim();
    const qtyRaw = row.querySelector('.pr-rv-qty').value.trim();
    const paguRaw = row.querySelector('.pr-rv-pagu').value;
    reviewItems[idx] = {
      raw_text: nama,
      qty: qtyRaw ? parseInt(qtyRaw, 10) : null,
      pagu_satuan: parsePaguValue(paguRaw)
    };
  });
}

// Format input Pagu satuan per baris jadi "150.000.000" sambil ngetik, sama
// kayak field Pagu utama di atas.
prReviewRows.addEventListener('input', (e) => {
  if (e.target.classList.contains('pr-rv-pagu')) {
    const digits = e.target.value.replace(/\D/g, '');
    e.target.value = digits ? Number(digits).toLocaleString('id-ID') : '';
  }
});

prReviewRows.addEventListener('click', (e) => {
  const btn = e.target.closest('.pr-review-del');
  if (!btn) return;
  syncReviewItemsFromDom();
  const idx = parseInt(btn.dataset.idx, 10);
  reviewItems.splice(idx, 1);
  renderReviewRows();
});

prReviewAddBtn.addEventListener('click', () => {
  syncReviewItemsFromDom();
  reviewItems.push({ raw_text: '', qty: null, pagu_satuan: null });
  renderReviewRows();
  const lastNama = prReviewRows.querySelector('.pr-review-row:last-child .pr-rv-nama');
  if (lastNama) lastNama.focus();
});

// "Kembali edit" cuma balik ke form input (teks/excel/screenshot) — item hasil
// parse yang lagi di-review dibuang, jadi kalau lanjut lagi nanti diparse ulang
// dari input aslinya (bukan dari state review yang sempat diedit).
prReviewBackBtn.addEventListener('click', () => {
  prReviewWrap.style.display = 'none';
  prFormWrap.style.display = '';
});

prReviewSaveBtn.addEventListener('click', async () => {
  prStatusMsg.textContent = '';
  syncReviewItemsFromDom();

  // Baris manual yang ditambah tapi nama-nya gak jadi diisi, dibuang diam-diam
  // (bukan error) — daripada ganjel submit gara-gara baris kosong.
  const items = reviewItems.filter(it => it.raw_text);
  if (items.length === 0) {
    prStatusMsg.style.color = 'var(--danger)';
    prStatusMsg.textContent = 'Gak ada item tersisa buat disimpan.';
    return;
  }

  prReviewSaveBtn.disabled = true;
  prReviewSaveBtn.textContent = 'Menyimpan…';

  try {
    // Permintaan RS ini nempel ke sesi konversi yang lagi aktif (bikin baru
    // kalau belum ada), jadi kalau temen buka sesi yang sama, daftar
    // permintaannya ikut kelihatan — bukan cuma tersimpan di layar sendiri.
    const sesiId = await ensureSesi();
    const namaRsTrim = prNamaRs.value.trim();
    const picSalesTrim = prPicSales.value.trim();
    if (namaRsTrim || picSalesTrim) {
      await sesiFetch(`${SESI_TABLE}?id=eq.${sesiId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          nama_rs: namaRsTrim || null,
          nama_sales: picSalesTrim || null,
          updated_at: new Date().toISOString()
        })
      });
    }

    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/submit_permintaan_rs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': ANON_KEY,
        'Authorization': 'Bearer ' + stokAccessToken
      },
      body: JSON.stringify({
        p_tanggal: prTanggal.value || null,
        p_nama_rs: prNamaRs.value.trim() || null,
        p_pic_sales: prPicSales.value.trim() || null,
        p_sumber: reviewSumber,
        p_pagu: parsePaguValue(prPagu.value),
        p_items: items,
        p_sesi_id: sesiId
      })
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.message || errData.hint || 'Gagal simpan (cek login/whitelist)');
    }
    const result = await res.json();

    startChecklistSession(result, prNamaRs.value.trim(), prPicSales.value.trim(), parsePaguValue(prPagu.value));
    closePrModal();

    // Kalau tadi masuk ke sini lewat nudge di Record modal, balik lagi ke situ
    // biar user lanjut dari titik yang sama (bukan ilang, harus klik Record lagi).
    if (resumeRecordAfterPr) {
      resumeRecordAfterPr = false;
      openRecordModal();
    }
  } catch (err) {
    prStatusMsg.style.color = 'var(--danger)';
    prStatusMsg.textContent = 'Gagal: ' + err.message;
  } finally {
    prReviewSaveBtn.disabled = false;
    prReviewSaveBtn.textContent = 'Simpan & mulai sesi';
  }
});

// ══════════════════════════════════════════
// KEBUTUHAN RS: nempel di sidebar clipboard, bagian dari alur konversi yang sama.
// "Bisa Dipenuhi" itu penilaian tim marsup sendiri (bukan matching otomatis) —
// tujuannya cuma ngumpulin data insight (mana kebutuhan RS yang sering gak bisa
// kita penuhi), bukan proses konversi. Konversi produk tetap manual lewat search+clipboard.
// ══════════════════════════════════════════
var checklistItems = [];       // [{id, raw_text, qty_diminta, status}]
var checklistNamaRs = '';
var checklistSales = '';
var checklistPagu = null;
var checklistPermintaanId = null;
var checklistPickingId = null; // id item yang lagi nampilin dropdown pilih produk (null = gak ada)

function startChecklistSession(submitResult, namaRs, picSales, pagu) {
  checklistItems = Array.isArray(submitResult.items) ? submitResult.items : [];
  checklistItems.forEach(it => { it.matched_items = normalizeMatchedItems(it); });
  checklistNamaRs = namaRs || '(tanpa nama RS)';
  checklistSales = picSales || '(tanpa nama sales)';
  checklistPagu = (pagu === undefined) ? null : pagu;
  checklistPermintaanId = submitResult.permintaan_id;

  // Auto-isi Nama RS / Sales di clipboard, biar gak perlu diketik ulang —
  // ini satu sesi konversi yang sama, bukan dua langkah terpisah.
  if (namaRs) inpRs.value = namaRs;
  if (picSales) inpSales.value = picSales;
  updateClipboard();
  setClipHeaderCollapsed(true);

  kbSection.classList.remove('kb-collapsed');
  kbRecordStatus.textContent = 'Tingkat pemenuhan tersimpan otomatis tiap item ditandai.';
  kbRefreshStatus.textContent = '';
  renderChecklist();
  switchClipTab('kb');

  // pastikan panel clipboard kelihatan (termasuk di mobile, yang defaultnya nampilin tab search)
  if (window.innerWidth <= 860 && typeof switchTab === 'function') switchTab('clip');
  clipTabRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// Daftar checkbox produk diambil dari clipboard sesi ini (bukan search baru) —
// karena konteksnya emang produk yang lagi diproses di sesi konversi yang sama.
// Satu kebutuhan sekarang boleh dicentang lebih dari satu SKU sekaligus (mis.
// "All Set Mata" -> Set Pacho + Cataract Minor Set), makanya checkbox bukan
// dropdown single-select lagi. Qty per-SKU opsional, dipakai kalau kebutuhan
// dipenuhi campuran beberapa varian dengan porsi qty berbeda.
function clipboardPickerHtml(itemId, matchedItems) {
  if (!clipboard.length) {
    return `<div class="kb-picker-empty">Clipboard masih kosong — tambahkan produk ke clipboard dulu buat bisa dipilih di sini.</div>`;
  }
  const rows = clipboard.map(c => {
    const link = (matchedItems || []).find(l => l.kode_produk === c.kode_produk);
    const checked = link ? ' checked' : '';
    const qtyVal = (link && link.qty_alokasi != null) ? link.qty_alokasi : '';
    return `<label class="kb-picker-row">
      <input type="checkbox" data-picker-check="${itemId}" data-kode="${escapeHtmlAttr(c.kode_produk)}" data-produk-id="${c.produk_id||''}"${checked}>
      <span class="kb-picker-name">${escapeHtmlAttr(c.kode_produk)} — ${escapeHtmlAttr(c.nama_produk)}</span>
      <input type="number" min="0" class="kb-picker-qty" data-picker-qty="${itemId}" data-kode="${escapeHtmlAttr(c.kode_produk)}"
        placeholder="qty" value="${qtyVal}" style="${checked ? '' : 'display:none'}">
    </label>`;
  }).join('');
  return `<div class="kb-picker-list">${rows}</div>`;
}

// Cari nama produk buat ditampilin di baris item yang udah TERPENUHI & ke-link
// ke suatu produk. Kalau produknya kebetulan udah gak ada di clipboard (misal
// dihapus lagi), tetep tampilin kode-nya aja tanpa nama.
function namaProdukByKode(kode) {
  const c = clipboard.find(c => c.kode_produk === kode);
  return c ? c.nama_produk : null;
}

function renderChecklist() {
  const pending = checklistItems.filter(i => i.status === 'PENDING').length;
  const done = checklistItems.filter(i => i.status === 'TERPENUHI').length;
  const na = checklistItems.filter(i => i.status === 'TIDAK_TERPENUHI').length;

  kbTitle.textContent = 'Kebutuhan RS';
  kbCount.textContent = `${pending} belum dicek · ${done} bisa dipenuhi · ${na} tidak bisa`;
  updateKbTabState();
  updateClipSummaryStrip();

  kbSummary.innerHTML = `
    <div class="kb-summary-row"><span>Nama RS</span><b>${checklistNamaRs || '-'}</b></div>
    <div class="kb-summary-row"><span>Pagu</span><b>${checklistPagu != null ? rupiah(checklistPagu) : '-'}</b></div>
  `;

  kbList.innerHTML = checklistItems.map(item => {
    const isPending = item.status === 'PENDING';
    const isDone = item.status === 'TERPENUHI';
    const isNa = item.status === 'TIDAK_TERPENUHI';
    const isPicking = checklistPickingId === item.id;
    const cls = isDone ? 'terpenuhi' : isNa ? 'tidak-terpenuhi' : '';

    let sub = '';
    if (isDone) sub = `✓ Bisa dipenuhi`;
    else if (isNa) sub = `✕ Tidak bisa dipenuhi`;

    let matchedHtml = '';
    if (isDone && item.matched_items && item.matched_items.length) {
      matchedHtml = `<div class="kb-item-matched">${item.matched_items.map(l => {
        const nama = namaProdukByKode(l.kode_produk);
        const qtyTxt = l.qty_alokasi != null ? ` · qty ${l.qty_alokasi}` : '';
        return `<span class="kb-matched-row">→ ${l.kode_produk}${nama ? ' — ' + nama : ''}${qtyTxt}</span>`;
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
      bodyHtml = `
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

    return `<div class="kb-item ${cls}">
      <div class="kb-item-text">${item.raw_text}${item.qty_diminta ? ' · qty ' + item.qty_diminta : ''}${item.pagu_satuan != null ? ' · pagu satuan ' + rupiah(item.pagu_satuan) : ''}</div>
      ${sub ? `<div class="kb-item-sub">${sub}</div>` : ''}
      ${matchedHtml}
      ${bodyHtml}
    </div>`;
  }).join('');
}

// Total qty_alokasi dari SEMUA item Kebutuhan RS yang match ke produk yang sama
// (by produk_id kalau ada, fallback ke kode_produk) — dipake buat sinkronin qty
// clipboard biar akurat kalau >1 item Permintaan RS dipenuhi dari produk yang
// sama persis (harus DIJUMLAH, bukan ketimpa sama yang terakhir dikonfirm).
// `override` opsional: {itemId, links} — dipake pas lagi proses konfirmasi
// picker, sebelum item.matched_items-nya sendiri kesimpen.
function sumQtyAlokasiForProduk(produkId, kode, override) {
  let total = 0;
  let hasAny = false;
  checklistItems.forEach(it => {
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
  const clipItem = clipboard.find(c => c.kode_produk === kode);
  if (!clipItem) return false;
  const total = sumQtyAlokasiForProduk(produkId, kode, override);
  if (total != null && clipItem.qty !== total) {
    clipItem.qty = total;
    persistUpdateQty(clipItem);
    return true;
  }
  return false;
}

kbList.addEventListener('click', async (e) => {
  const link = e.target.closest('a[data-action]');
  const btn = e.target.closest('button[data-action]');
  const el = link || btn;
  if (!el) return;
  const itemId = parseInt(el.dataset.id, 10);
  const action = el.dataset.action;
  const item = checklistItems.find(i => i.id === itemId);
  if (!item) return;

  if (action === 'bisa' || action === 'change') {
    // Buka mode pilih produk, belum manggil API sama sekali.
    checklistPickingId = itemId;
    renderChecklist();
    return;
  }

  if (action === 'pick-cancel') {
    checklistPickingId = null;
    renderChecklist();
    return;
  }

  if (action === 'pick-confirm') {
    // Kumpulin semua checkbox yang dicentang buat item ini -> jadi array link.
    const checks = kbList.querySelectorAll(`input[data-picker-check="${itemId}"]:checked`);
    if (checks.length === 0) {
      const errEl = kbList.querySelector(`[data-picker-error="${itemId}"]`);
      if (errEl) errEl.style.display = 'block';
      return;
    }
    const links = Array.from(checks).map(chk => {
      const kode = chk.dataset.kode;
      const produkId = chk.dataset.produkId ? parseInt(chk.dataset.produkId, 10) : null;
      const qtyInput = kbList.querySelector(`input[data-picker-qty="${itemId}"][data-kode="${CSS.escape(kode)}"]`);
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
    if (clipQtyChanged) updateClipboard();

    btn.disabled = true;
    try {
      await callUpdatePermintaanItemMulti(itemId, 'TERPENUHI', links);
      item.status = 'TERPENUHI';
      item.matched_items = links;
      checklistPickingId = null;
      renderChecklist();
      autoFinalizePermintaan();
    } catch (err) {
      showToast('Gagal update: ' + err.message, 'error');
      renderChecklist();
    }
    return;
  }

  if (action === 'tidak') {
    btn.closest('.kb-item-actions').querySelectorAll('button').forEach(b => b.disabled = true);
    const prevMatched = item.matched_items || [];
    try {
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
      if (clipQtyChanged) updateClipboard();
      renderChecklist();
      autoFinalizePermintaan();
    } catch (err) {
      showToast('Gagal update: ' + err.message, 'error');
      renderChecklist();
    }
    return;
  }

  if (action === 'undo') {
    const prevMatched = item.matched_items || [];
    try {
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
      if (clipQtyChanged) updateClipboard();
      checklistPickingId = null;
      renderChecklist();
      autoFinalizePermintaan();
    } catch (err) {
      showToast('Gagal membatalkan: ' + err.message, 'error');
      renderChecklist();
    }
    return;
  }
});

// Centang/uncentang checkbox produk di picker -> qty input muncul/hilang
// ngikutin, dan pesan error "pilih minimal 1" ilang begitu ada yang dicentang.
kbList.addEventListener('change', (e) => {
  const chk = e.target.closest('input[data-picker-check]');
  if (!chk) return;
  const kode = chk.dataset.kode;
  const qtyInput = kbList.querySelector(`input[data-picker-qty="${chk.dataset.pickerCheck}"][data-kode="${CSS.escape(kode)}"]`);
  if (qtyInput) qtyInput.style.display = chk.checked ? '' : 'none';
  const errEl = kbList.querySelector(`[data-picker-error="${chk.dataset.pickerCheck}"]`);
  if (errEl && chk.checked) errEl.style.display = 'none';
});

const KB_COLLAPSE_KEY = 'pnm_kb_collapsed';
kbCollapseBtn.addEventListener('click', () => {
  const collapsed = kbSection.classList.toggle('kb-collapsed');
  kbCollapseBtn.title = collapsed ? 'Buka daftar' : 'Ciutkan daftar';
  sessionStorage.setItem(KB_COLLAPSE_KEY, collapsed ? '1' : '0');
});
// Kalau sebelumnya diciutkan di sesi browser yang sama, biarkan tetap ciutan
// begitu daftar Kebutuhan RS pertama kali muncul.
if (sessionStorage.getItem(KB_COLLAPSE_KEY) === '1') {
  kbSection.classList.add('kb-collapsed');
  kbCollapseBtn.title = 'Buka daftar';
}

// Kerja bareng dalam satu sesi yang sama bisa jalan bersamaan (bukan cuma
// gantian) — tombol ini nge-tarik ulang status checklist dari server, biar
// item yang barusan ditandai temen langsung kelihatan tanpa buka-tutup sesi.
kbRefreshBtn.addEventListener('click', async () => {
  if (!currentSesiId) return;
  kbRefreshBtn.disabled = true;
  kbRefreshStatus.textContent = 'Memuat ulang…';
  await loadChecklistForSesi(currentSesiId);
  kbRefreshBtn.disabled = false;
});

// Dulu ini tombol "Record Sesi Ini" terpisah yang harus diklik manual.
// Sekarang otomatis: tiap kali item dicentang (bisa/tidak), tingkat pemenuhan
// langsung dihitung ulang & disimpan di background — gak nunggu diklik, dan
// otomatis ke-cover juga saat "Record Konversi" ditekan di akhir.
async function autoFinalizePermintaan() {
  if (!checklistPermintaanId) return;
  const total = checklistItems.length;
  const done = checklistItems.filter(i => i.status === 'TERPENUHI').length;
  const tingkatPemenuhan = total > 0 ? Math.round((done / total) * 1000) / 10 : 0; // 1 desimal

  kbRecordStatus.style.color = 'var(--text-muted)';
  kbRecordStatus.textContent = 'Menyimpan…';
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/finalize_permintaan_rs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': ANON_KEY,
        'Authorization': 'Bearer ' + stokAccessToken
      },
      body: JSON.stringify({
        p_permintaan_id: checklistPermintaanId,
        p_tingkat_pemenuhan: tingkatPemenuhan,
        p_items_terpenuhi: done,
        p_items_total: total
      })
    });
    if (!res.ok) throw new Error('Gagal simpan rekap');
    kbRecordStatus.style.color = 'var(--success)';
    kbRecordStatus.textContent = `Tersimpan otomatis ✓ ${tingkatPemenuhan}% terpenuhi (${done}/${total} item)`;
  } catch {
    kbRecordStatus.style.color = 'var(--danger)';
    kbRecordStatus.textContent = 'Gagal simpan rekap otomatis (gak masalah, dicoba lagi pas item berikutnya ditandai)';
  }
}

// ══════════════════════════════════════════
// CARI SET MENDEKATI: dulu tool HTML terpisah (tempel kode_produk manual ke
// textarea, panggil RPC cari_set_mendekati/detail_isi_set). Sekarang dilebur
// jadi tab clipboard, sumber kode_produk-nya otomatis dari item yang ada di
// Clipboard sesi ini (bukan input manual lagi) — biar seamless: user tinggal
// klik "Cari SET Mendekati", gak perlu copy-paste kode dari clipboard ke tool
// lain. RPC dipanggil lewat helper rpc() yang sudah ada (pola sama kayak
// get_set_items dkk — pakai ANON_KEY, bukan stokAccessToken, karena RPC ini
// read-only/security-definer).
// ══════════════════════════════════════════
// Kode sumber = kode_produk unik dari clipboard (kode_asli dipakai kalau ada,
// sama kayak konvensi kode buat gambar/thumbnail di bagian lain app ini).
function setcariSourceKodeList() {
  const seen = new Set();
  const out = [];
  clipboard.forEach(c => {
    const kode = (c.kode_asli && c.kode_asli.trim()) ? c.kode_asli.trim() : c.kode_produk;
    if (kode && !seen.has(kode)) { seen.add(kode); out.push(kode); }
  });
  return out;
}

function updateSetcariSourceCount() {
  const n = setcariSourceKodeList().length;
  setcariSourceCount.textContent = n;
  setcariSearchBtn.disabled = n === 0;
}

function setcariSetStatus(msg, isError) {
  setcariStatus.textContent = msg || '';
  setcariStatus.classList.toggle('error', !!isError);
}

function setcariSkorClass(skor) {
  if (skor >= 0.7) return 'high';
  if (skor >= 0.4) return 'mid';
  return 'low';
}

async function runCariSetMendekati() {
  const kodeList = setcariSourceKodeList();
  if (kodeList.length === 0) {
    setcariSetStatus('Clipboard masih kosong — tambahkan produk dulu.', true);
    return;
  }
  setcariSearchBtn.disabled = true;
  setcariSetStatus('Mencari…');
  setcariEmpty.style.display = 'none';
  setcariList.innerHTML = '';
  setcariBadge.style.display = 'none';
  try {
    const { data, error } = await rpc('cari_set_mendekati', { kode_list: kodeList, batas: 30 });
    if (error) throw new Error(error.message || 'Gagal mencari SET');
    if (!data || data.length === 0) {
      setcariSetStatus('');
      setcariEmpty.style.display = 'block';
      setcariEmpty.querySelector('p').textContent = 'Tidak ada SET yang cocok ditemukan buat produk-produk di clipboard sekarang.';
      return;
    }
    setcariSetStatus(`Ditemukan ${data.length} SET, diurutkan dari yang paling mirip.`);
    setcariBadge.textContent = data.length;
    setcariBadge.style.display = 'inline-block';
    renderSetcariResults(data, kodeList);
  } catch (err) {
    setcariSetStatus('Gagal mencari: ' + err.message, true);
  } finally {
    setcariSearchBtn.disabled = setcariSourceKodeList().length === 0;
  }
}

function renderSetcariResults(rows, kodeList) {
  setcariList.innerHTML = rows.map(row => {
    const pct = Math.round(row.skor_jaccard * 100);
    const cls = setcariSkorClass(row.skor_jaccard);
    return `<div class="setcari-card" data-set-id="${row.set_id}">
      <div class="setcari-card-top">
        <div>
          <div class="setcari-kode">${escapeHtmlAttr(row.kode_set)}</div>
          ${row.nama_set ? `<div class="setcari-nama">${escapeHtmlAttr(row.nama_set)}</div>` : ''}
          <div class="setcari-cocok" style="margin-top:4px">${row.jumlah_cocok} / ${row.total_item_set} item set cocok</div>
        </div>
        <div class="setcari-score-wrap">
          <div class="setcari-score ${cls}">${pct}%</div>
          <div class="setcari-bar-track"><div class="setcari-bar-fill" style="width:${pct}%"></div></div>
        </div>
      </div>
      <div class="setcari-card-actions">
        <button class="setcari-detail-btn" type="button" data-action="toggle-detail" data-set-id="${row.set_id}">Lihat isi</button>
        <button class="setcari-detail-btn" type="button" data-action="add-clip" data-kode="${escapeHtmlAttr(row.kode_set)}">+ Tambah ke Clipboard</button>
      </div>
      <div class="setcari-detail" data-detail-for="${row.set_id}" style="display:none"></div>
    </div>`;
  }).join('');

  setcariList.querySelectorAll('button[data-action="toggle-detail"]').forEach(btn => {
    btn.addEventListener('click', () => toggleSetcariDetail(btn, kodeList));
  });
  setcariList.querySelectorAll('button[data-action="add-clip"]').forEach(btn => {
    btn.addEventListener('click', () => addSetKodeToClip(btn.dataset.kode, btn));
  });
}

// Tambah SET hasil pencarian langsung ke Clipboard tanpa harus balik ke tab
// pencarian produk dulu — cari by kode_produk persis (RPC produk_by_kode kalau
// ada; fallback ke pencarian biasa lewat search_produk yang sudah dipakai app).
async function addSetKodeToClip(kode, btn) {
  if (!kode) return;
  if (clipboard.some(c => c.kode_produk === kode)) {
    showToast('SET ini sudah ada di clipboard.', 'error');
    return;
  }
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = 'Menambahkan…';
  try {
    const { data, error } = await rpc('search_produk_dengan_harga', { q: kode, p_tipe: null, only_akd: false, only_kfa: false });
    if (error) throw new Error(error.message || 'Gagal mencari produk SET');
    const match = Array.isArray(data) ? data.find(r => r.kode_produk && r.kode_produk.toLowerCase() === kode.toLowerCase()) : null;
    if (!match) throw new Error('Produk SET tidak ditemukan di database.');
    lastResults = lastResults && lastResults.length ? lastResults.concat([match]) : [match];
    addToClip(kode);
    showToast(`${kode} ditambahkan ke clipboard ✓`);
    btn.textContent = 'Ditambahkan ✓';
  } catch (err) {
    showToast('Gagal menambahkan: ' + err.message, 'error');
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

async function toggleSetcariDetail(btn, kodeList) {
  const setId = btn.dataset.setId;
  const detailEl = setcariList.querySelector(`[data-detail-for="${setId}"]`);
  if (!detailEl) return;
  if (detailEl.style.display !== 'none') {
    detailEl.style.display = 'none';
    btn.textContent = 'Lihat isi';
    return;
  }
  btn.textContent = 'Memuat…';
  try {
    const { data, error } = await rpc('detail_isi_set', { p_set_id: Number(setId), kode_list: kodeList });
    if (error) throw new Error(error.message || 'Gagal ambil detail SET');
    const lines = (data || []).map(it => `
      <div class="setcari-item-line ${it.cocok_dengan_input ? 'match' : ''}">
        <span>${it.urutan}. ${escapeHtmlAttr(it.kode_item)} — ${escapeHtmlAttr(it.nama_item || '')}</span>
        <span>qty ${it.qty}${it.cocok_dengan_input ? '<span class="setcari-item-tag">cocok</span>' : ''}</span>
      </div>`).join('');
    detailEl.innerHTML = lines || '<div class="setcari-detail-empty">Tidak ada item.</div>';
    detailEl.style.display = 'flex';
    btn.textContent = 'Sembunyikan';
  } catch (err) {
    setcariSetStatus('Gagal ambil detail: ' + err.message, true);
    btn.textContent = 'Lihat isi';
  }
}

setcariSearchBtn.addEventListener('click', runCariSetMendekati);

// ══════════════════════════════════════════
// DICTIONARY ISTILAH CUSTOMER (fitur baru)
// Murni baca histori dari tabel permintaan_item lewat RPC Supabase
// (get_dictionary_stats, get_dictionary_summary, get_dictionary_detail).
// Tidak ada AI/fuzzy — normalisasi teks dilakukan di database (lihat SQL).
// Berdiri sendiri, tidak menyentuh logic Search/Konversi/Riwayat/Converter.
// ══════════════════════════════════════════
const dictSearchInput = document.getElementById('dict-search-input');
const dictClearBtn = document.getElementById('dict-clear-btn');
const dictFilterSelect = document.getElementById('dict-filter-select');
const dictSortSelect = document.getElementById('dict-sort-select');
const btnDictRefresh = document.getElementById('btn-dict-refresh');
const dictLoading = document.getElementById('dict-loading');
const dictError = document.getElementById('dict-error');
const dictEmpty = document.getElementById('dict-empty');
const dictTableWrap = document.getElementById('dict-table-wrap');
const dictTableBody = document.getElementById('dict-table-body');
const dictStatIstilah = document.getElementById('dict-stat-istilah');
const dictStatProduk = document.getElementById('dict-stat-produk');
const dictStatAlias = document.getElementById('dict-stat-alias');
const dictModal = document.getElementById('dictionary-modal');
const dictModalTitle = document.getElementById('dict-modal-title');
const dictModalClose = document.getElementById('dict-modal-close');
const dictModalLoading = document.getElementById('dict-modal-loading');
const dictModalError = document.getElementById('dict-modal-error');
const dictModalList = document.getElementById('dict-modal-list');
const dictPaginationEl = document.getElementById('dict-pagination');

const DICT_PAGE_SIZE = 20;
let dictCurrentPage = 1;
let dictLastTotal = 0;

let dictStatsLoaded = false;
let dictSearchDebounce = null;

// Statistik cuma perlu dimuat sekali per sesi tab (angka historis, jarang berubah
// dalam satu waktu buka aplikasi) — tapi tetap ikut di-refresh kalau tombol Refresh ditekan.
async function loadDictionaryStats() {
  const { data, error } = await rpc('get_dictionary_stats', {});
  if (error || !data || !data.length) {
    dictStatIstilah.textContent = '—';
    dictStatProduk.textContent = '—';
    dictStatAlias.textContent = '—';
    return;
  }
  const s = data[0];
  dictStatIstilah.textContent = (s.total_istilah_unik ?? 0).toLocaleString('id-ID');
  dictStatProduk.textContent = (s.total_produk_dipilih ?? 0).toLocaleString('id-ID');
  dictStatAlias.textContent = (s.total_alias ?? 0).toLocaleString('id-ID');
}

function dictBadgeHtml(status) {
  return status === 'MULTIPLE'
    ? `<span class="dict-badge multiple">MULTIPLE</span>`
    : `<span class="dict-badge consistent">CONSISTENT</span>`;
}

function dictFormatTanggal(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) + ' · ' + sesiTimeAgo(iso);
}

function renderDictRow(row) {
  const tr = document.createElement('tr');
  tr.dataset.istilah = row.istilah_customer;
  tr.innerHTML = `
    <td class="dict-term">${escapeHtmlAttr(row.istilah_customer)}</td>
    <td>${dictBadgeHtml(row.status)}</td>
    <td class="dict-col-freq">${Number(row.total_frekuensi).toLocaleString('id-ID')}×</td>
    <td class="dict-col-time">${dictFormatTanggal(row.terakhir_dipakai)}</td>
  `;
  tr.addEventListener('click', () => openDictionaryDetail(row.istilah_customer));
  return tr;
}

async function loadDictionary() {
  if (!dictStatsLoaded) { dictStatsLoaded = true; loadDictionaryStats(); }

  dictLoading.style.display = 'block';
  dictError.style.display = 'none';
  dictEmpty.style.display = 'none';
  dictTableWrap.style.display = 'none';
  dictTableBody.innerHTML = '';

  const p_search = dictSearchInput.value.trim() || null;
  const p_filter = dictFilterSelect.value;
  const p_sort = dictSortSelect.value;

  try {
    const { data, error } = await rpc('get_dictionary_summary', {
      p_search, p_filter, p_sort,
      p_limit: DICT_PAGE_SIZE,
      p_offset: (dictCurrentPage - 1) * DICT_PAGE_SIZE
    });
    if (error) throw new Error(error.message || error.hint || 'Gagal memuat dictionary');
    dictLastTotal = (data && data.length) ? Number(data[0].total_count) : 0;
    if (!data || data.length === 0) {
      dictEmpty.style.display = 'block';
      renderDictPagination();
      return;
    }
    const frag = document.createDocumentFragment();
    data.forEach(row => frag.appendChild(renderDictRow(row)));
    dictTableBody.appendChild(frag);
    dictTableWrap.style.display = 'block';
    renderDictPagination();
  } catch (err) {
    renderListError(dictError, err.message, loadDictionary);
    dictLastTotal = 0;
    renderDictPagination();
  } finally {
    dictLoading.style.display = 'none';
  }
}

// Kontrol halaman Dictionary — pola sama kayak renderPagination() di tab Cari
// Produk, cuma versi ringkas (elemen sendiri, gak ganggu state pagination Cari Produk).
function renderDictPagination() {
  const totalPages = Math.max(1, Math.ceil(dictLastTotal / DICT_PAGE_SIZE));
  if (totalPages <= 1) { dictPaginationEl.innerHTML = ''; dictPaginationEl.style.display = 'none'; return; }
  dictPaginationEl.style.display = 'flex';

  function pageBtn(p, label, disabled = false) {
    const active = p === dictCurrentPage;
    return `<button class="page-btn${active ? ' active' : ''}" data-page="${p}"${disabled ? ' disabled' : ''}>${label}</button>`;
  }

  const pagesToShow = [...new Set([1, totalPages, dictCurrentPage - 1, dictCurrentPage, dictCurrentPage + 1])]
    .filter(p => p >= 1 && p <= totalPages)
    .sort((a, b) => a - b);

  let numberBtns = '';
  let prevP = null;
  pagesToShow.forEach(p => {
    if (prevP !== null && p - prevP > 1) numberBtns += `<span class="page-info">…</span>`;
    numberBtns += pageBtn(p, p);
    prevP = p;
  });

  const startItem = (dictCurrentPage - 1) * DICT_PAGE_SIZE + 1;
  const endItem = Math.min(dictCurrentPage * DICT_PAGE_SIZE, dictLastTotal);

  dictPaginationEl.innerHTML = `
    <span class="page-info">${startItem}–${endItem} dari ${dictLastTotal}</span>
    ${pageBtn(dictCurrentPage - 1, '<i class="ti ti-chevron-left"></i>', dictCurrentPage === 1)}
    ${numberBtns}
    ${pageBtn(dictCurrentPage + 1, '<i class="ti ti-chevron-right"></i>', dictCurrentPage === totalPages)}
  `;

  dictPaginationEl.querySelectorAll('.page-btn[data-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = parseInt(btn.dataset.page, 10);
      if (!p || p < 1 || p > totalPages || p === dictCurrentPage) return;
      dictCurrentPage = p;
      loadDictionary();
      dictTableWrap.scrollIntoView({ block: 'nearest' });
    });
  });
}

// Search realtime, di-debounce biar gak nembak RPC tiap ketikan huruf.
dictSearchInput.addEventListener('input', () => {
  dictClearBtn.style.display = dictSearchInput.value ? 'block' : 'none';
  clearTimeout(dictSearchDebounce);
  dictSearchDebounce = setTimeout(() => { dictCurrentPage = 1; loadDictionary(); }, 300);
});
dictClearBtn.addEventListener('click', () => {
  dictSearchInput.value = '';
  dictClearBtn.style.display = 'none';
  dictCurrentPage = 1;
  loadDictionary();
});
dictFilterSelect.addEventListener('change', () => { dictCurrentPage = 1; loadDictionary(); });
dictSortSelect.addEventListener('change', () => { dictCurrentPage = 1; loadDictionary(); });
btnDictRefresh.addEventListener('click', () => { dictStatsLoaded = false; loadDictionary(); });

async function openDictionaryDetail(istilah) {
  dictModalTitle.textContent = istilah;
  dictModalList.innerHTML = '';
  dictModalError.style.display = 'none';
  dictModalLoading.style.display = 'block';
  dictModal.classList.add('show');

  try {
    const { data, error } = await rpc('get_dictionary_detail', { p_istilah: istilah });
    if (error) throw new Error(error.message || error.hint || 'Gagal memuat detail istilah');
    if (!data || data.length === 0) {
      dictModalList.innerHTML = '<div style="padding:16px 0;text-align:center;color:var(--text-muted);font-size:13px">Tidak ada data.</div>';
      return;
    }
    // Sudah terurut dari server berdasarkan frekuensi terbesar (JANGAN diurutkan ulang —
    // satu istilah customer memang wajar punya beberapa produk Robust, ini bukan error).
    dictModalList.innerHTML = data.map(d => `
      <div class="dict-detail-row" style="display:block">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
          <div>
            <div class="dict-detail-produk">${escapeHtmlAttr(d.nama_produk || '(nama produk tidak tersedia)')}</div>
            <div class="dict-detail-kode">${escapeHtmlAttr(d.kode_produk || '-')}</div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div class="dict-detail-freq">${Number(d.jumlah_pemakaian).toLocaleString('id-ID')}×</div>
            <div class="dict-detail-pct">${d.persentase != null ? d.persentase + '%' : ''}</div>
          </div>
        </div>
        <div class="dict-detail-bar-wrap"><div class="dict-detail-bar" style="width:${d.persentase != null ? d.persentase : 0}%"></div></div>
      </div>
    `).join('');
  } catch (err) {
    dictModalError.textContent = err.message;
    dictModalError.style.display = 'block';
  } finally {
    dictModalLoading.style.display = 'none';
  }
}
dictModalClose.addEventListener('click', () => dictModal.classList.remove('show'));
dictModal.addEventListener('click', (e) => { if (e.target === dictModal) dictModal.classList.remove('show'); });

// p_links: array of {produk_id, kode_produk, qty_alokasi} — boleh kosong ([])
// kalau statusnya PENDING/TIDAK_TERPENUHI. Ganti total (replace-all) per item,
// bukan nambah satu-satu, jadi konsisten sama isi checkbox picker di layar.
async function callUpdatePermintaanItemMulti(itemId, status, links) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/update_permintaan_item_multi`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': ANON_KEY,
      'Authorization': 'Bearer ' + stokAccessToken
    },
    body: JSON.stringify({ p_item_id: itemId, p_status: status, p_links: links || [] })
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.message || errData.hint || 'Gagal update item');
  }
}

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

/* ==================================================================
   HIDDEN FEATURE: Generator Link Katalog
   Munculnya cuma kalau di search-input diketik "/linkpalsugas".
   Tidak ada tombol/menu yang mengarah ke sini secara terlihat.
   ================================================================== */
(function () {
  const modal = document.getElementById('linkgen-modal');
  if (!modal) return;

  const closeBtn = document.getElementById('linkgen-close');
  const baseInput = document.getElementById('linkgen-base');
  const prefixInput = document.getElementById('linkgen-prefix');
  const textInput = document.getElementById('linkgen-input');
  const genBtn = document.getElementById('linkgen-generate-btn');
  const copyBtn = document.getElementById('linkgen-copy-btn');
  const countEl = document.getElementById('linkgen-count');
  const outputEl = document.getElementById('linkgen-output');
  let rows = [];

  function slugify(text, prefix) {
    return prefix + text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function generate() {
    const base = baseInput.value.trim();
    const prefix = prefixInput.value;
    const lines = textInput.value.split('\n').map(l => l.trim()).filter(Boolean);
    rows = lines.map(desc => ({ desc, link: base + slugify(desc, prefix) }));

    if (!rows.length) {
      outputEl.innerHTML = '<div style="color:var(--text-muted);font-size:12.5px;padding:12px 0;text-align:center">Belum ada hasil.</div>';
      countEl.textContent = '';
      return;
    }

    countEl.textContent = rows.length + ' baris';

    let html = '<table style="width:100%;border-collapse:collapse;font-size:12.5px"><thead><tr>'
      + '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border);color:var(--text-muted);font-weight:500;font-size:11px;text-transform:uppercase">Deskripsi</th>'
      + '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border);color:var(--text-muted);font-weight:500;font-size:11px;text-transform:uppercase">Link</th></tr></thead><tbody>';
    rows.forEach(r => {
      html += '<tr><td style="padding:6px 8px;border-bottom:1px solid var(--border)">' + esc(r.desc) + '</td>'
        + '<td style="padding:6px 8px;border-bottom:1px solid var(--border);word-break:break-all"><a href="' + esc(r.link) + '" target="_blank" style="color:var(--accent-text)">' + esc(r.link) + '</a></td></tr>';
    });
    html += '</tbody></table>';
    outputEl.innerHTML = html;
  }

  genBtn.addEventListener('click', generate);

  copyBtn.addEventListener('click', () => {
    if (!rows.length) generate();
    if (!rows.length) return;
    const tsv = rows.map(r => r.desc + '\t' + r.link).join('\n');
    navigator.clipboard.writeText(tsv).then(() => {
      const old = copyBtn.textContent;
      copyBtn.textContent = 'Tersalin!';
      setTimeout(() => { copyBtn.textContent = old; }, 1200);
    });
  });

  closeBtn.addEventListener('click', () => modal.classList.remove('show'));
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('show'); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal.classList.contains('show')) modal.classList.remove('show');
  });

  window.openLinkGenModal = function () {
    modal.classList.add('show');
    outputEl.innerHTML = '';
    countEl.textContent = '';
    setTimeout(() => textInput.focus(), 50);
  };
})();

// Modal konfirmasi custom — pengganti confirm() bawaan browser biar konsisten
// dengan tampilan app dan gak nge-block thread (native confirm() nge-freeze
// seluruh tab, termasuk animasi/toast lain yang lagi jalan).
function showConfirmModal({ title = 'Konfirmasi', text = '', okText = 'Ya, Lanjutkan', danger = false } = {}) {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirm-modal');
    const titleEl = document.getElementById('confirm-modal-title');
    const textEl = document.getElementById('confirm-modal-text');
    const okBtn = document.getElementById('confirm-modal-ok');
    const cancelBtn = document.getElementById('confirm-modal-cancel');
    const iconWrap = document.getElementById('confirm-modal-icon');

    titleEl.textContent = title;
    textEl.textContent = text;
    okBtn.textContent = okText;
    okBtn.style.background = danger ? 'var(--danger)' : 'var(--accent)';
    iconWrap.style.background = danger ? 'var(--danger-soft)' : 'var(--warn-soft)';
    iconWrap.style.color = danger ? 'var(--danger-text)' : 'var(--warn-text)';
    iconWrap.innerHTML = danger ? '<i class="ph ph-trash"></i>' : '<i class="ph ph-warning-circle"></i>';

    function cleanup(result) {
      modal.classList.remove('show');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      modal.removeEventListener('click', onOverlay);
      document.removeEventListener('keydown', onKey);
      resolve(result);
    }
    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }
    function onOverlay(e) { if (e.target === modal) cleanup(false); }
    function onKey(e) { if (e.key === 'Escape') cleanup(false); if (e.key === 'Enter') cleanup(true); }

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    modal.addEventListener('click', onOverlay);
    document.addEventListener('keydown', onKey);
    modal.classList.add('show');
  });
}