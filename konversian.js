// ═══ COORD LOG (baca dulu sebelum edit — file ini kepakai/kesentuh 2+ sesi Claude paralel) ═══
// 2026-08-18: SECURITY — RLS produk/produk_harga/produk_set_item/akd/produk_akd/master_produk diketatin dari publik jadi allowed_users-only (harga_swasta sempat bisa dibaca siapa aja tanpa login). getProdukId/rpc()/getSetItems/enrichStok diganti dari ANON_KEY mentah ke sesiFetch(token sesi). Login gate sekarang juga checkWhitelist() ke allowed_users (dulu cuma cek kredensial valid, gak cek whitelist) — Claude
// 2026-08-13(7): 3 behavior fix fundamental (per diskusi manual): (a) isian tab Buat SPH nempel ke SPH terakhir — sph-module.js sekarang expose window.sphFlow.reset() dipanggil dari resetChecklistUI(); (b) nambah tombol "Keluar dari Sesi" (btn-leave-sesi) — beda dari Selesaikan Sesi, cuma bersihin tampilan lokal, GAK ngubah status server, sesi tetap 'berjalan'; (c) badge "Jadi Order"/"Ditutup Tanpa Order" di kartu riwayat dulu auto-derived dari ada-gaknya konversi_record (keliru — itu nunjukin "Record diklik", bukan "beneran jadi order"), sekarang dropdown manual hasil_order (kolom BARU sesi_konversi, perlu migration SQL manual dulu, lihat catatan terpisah), default null = "Menunggu Feedback Sales" — Claude
// 2026-08-13(6): fix "notif kolaborator (mode harga, dll) kadang muncul kadang enggak" — syncRealtimeAuth() dulu baca stokAccessToken (cache) langsung buat auth socket Realtime, dan cuma kepanggil pas event TOKEN_REFRESHED/(re)subscribe channel. Kalau tab di-background lama, timer refresh SDK bisa ke-throttle, socket kepasang token basi, dan RLS DIAM-DIAM nge-filter postgres_changes tanpa error apapun (beda dari REST yang minimal 401 kelihatan). Sekarang syncRealtimeAuth() ambil token fresh (getFreshToken()) + dipaksa kepanggil ulang pas tab balik visible (bukan cuma nunggu TOKEN_REFRESHED) — Claude
// 2026-08-13(5): fix "mode harga (Swasta/E-Katalog) gak ikut realtime" — modeSwastaOutput dulu variabel lokal per-tab doang, gak pernah ditulis/dibaca dari sesi_konversi, jadi kolaborator yang buka sesi yang sama selalu mulai dari default E-Katalog walau pembuat sesi udah set Swasta (bisa keluar harga salah di Record/Export/SPH tanpa tanda apapun). Sekarang persisted ke kolom BARU sesi_konversi.mode_harga_swasta (perlu migration SQL manual dulu sebelum dipush, lihat catatan terpisah) + disinkron lewat handleSesiRowChange() sama kayak pagu/butuh_bantuan — Claude
// 2026-08-13(4): fix duplikasi search-by-kode — matchOneKode() (Converter, ada retry timeout) dan addSetKodeToClip() (Cari SET Mendekati, TANPA retry) tadinya 2 salinan terpisah dari logika "exact match by kode via search_produk_dengan_harga", plus gak ada cache jadi kode duplikat dalam 1 batch paste = RPC berulang. Disatukan ke findProdukByKodeExact() + kodeExactCache (cache cuma hasil sukses, error tetap fresh-retry) — Claude
// 2026-08-13(3): fix "kekick ke login padahal masih kerja" — sesiFetch()/rpc-manual-berautentikasi/upload/openPrModal dulu baca variabel stokAccessToken langsung (bisa basi kalau tab sempat di-background), sekarang lewat getFreshToken() (panggil PNMAuth.getAccessToken() -> cek-dan-refresh di momen request, bukan nunggu timer) — Claude
// 2026-08-13(2): fix stepper Export/Simpan ke Drive di konversian.html nyangkut nunjukin status sesi SEBELUMNYA pas Selesaikan Sesi/Mulai Sesi Baru/buka sesi lain — window.convFlow.reset() (baru) sekarang dipanggil dari resetChecklistUI(), plus lastExportBlob dkk ikut dikosongin di titik yang sama — Claude
// 2026-08-13: fix bug "Sesi ini belum ada Permintaan RS (atau tanggalnya belum tercatat)" muncul palsu — startChecklistSession() gak pernah ngisi checklistTanggal pas Permintaan RS BARU disubmit (cuma loadChecklistForSesi yang ngisi, buat sesi yang DIBUKA ULANG). Sekarang startChecklistSession terima parameter tanggal & set checklistTanggal dari situ — Claude
// 2026-08-12: shared auth layer + navigasi konversian<->crud-produk + theme-fix (single <html data-theme>) + cache-busting — Claude (sesi arsitektur)
// Kalau kamu Claude/sesi lain yang mau edit file ini: tambahin baris baru di atas (jangan hapus riwayatnya), ringkas 1 baris apa yang berubah + tanggal.
// ═══════════════════════════════════════════════════════════════════════════
const SUPABASE_URL = 'https://ptkkbsemihcyndisjoor.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB0a2tic2VtaWhjeW5kaXNqb29yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0Njc4MzgsImV4cCI6MjA5ODA0MzgzOH0.QsCqmcqQcXvz1f8bLkagvMbAGUBbBP-3Wa5Aore5OMo';

// ── AUTO-UPLOAD KE GOOGLE DRIVE (via Edge Function proxy, BUKAN langsung ke
// Apps Script dari client) ──
// SECURITY FIX 2026-08-14: DRIVE_UPLOAD_URL & DRIVE_UPLOAD_TOKEN dulu ada di
// sini sebagai string hardcoded — artinya siapapun yang buka devtools/view
// source bisa nyomot token itu dan manggil Apps Script langsung, bypass
// login aplikasi ini sepenuhnya. Sekarang browser cuma manggil Edge Function
// upload-drive-proxy (nempel SUPABASE_URL yg sudah ada di atas), yang baru
// verify user beneran login (JWT) lalu die-yang nempelin token rahasia ke
// Apps Script dari sisi server — token gak pernah nyampe ke client lagi.
// Rahasia yang lama (919c5bac...) SUDAH di-rotate di Code.gs, jadi walau
// masih ada di git history versi lama, sudah gak berguna lagi.
const DRIVE_PROXY_URL = `${SUPABASE_URL}/functions/v1/upload-drive-proxy`;

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
  ? window.supabase.createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      // POLA "THIRD-PARTY AUTH": kita login manual (fetch ke /auth/v1/token
      // langsung, bukan lewat rt.auth.signIn...), jadi rt.auth gak pernah punya
      // sesi. Realtime SDK ini manggil ULANG fungsi accessToken ini sendiri tiap
      // heartbeat/reconnect buat narik token TERBARU — beda sama rt.realtime.setAuth()
      // manual yang cuma nembak sekali terus ketiban balik ke ANON_KEY tiap heartbeat
      // jalan (itu penyebab kenapa role-nya selalu balik jadi 'anon'). Callback ini
      // baca stokAccessToken langsung dari closure, jadi otomatis dapet nilai
      // terbaru kapan pun dipanggil — gak perlu manual re-sync di titik lain lagi.
      accessToken: async () => stokAccessToken || ANON_KEY
    })
  : null;
if (!rt) console.warn('Supabase Realtime SDK gagal dimuat — kolaborasi live gak aktif, app tetap jalan pakai REST biasa.');

// saveAuthSession/readAuthSession/clearAuthSession versi manual (localStorage
// langsung) SUDAH DIGANTIKAN oleh shared/auth-session.js (PNMAuth), yang
// baca-tulis via window.pnmSupabase.auth — tapi tetap ke localStorage key
// yang SAMA (pnm_auth_session, lihat shared/supabase-client.js), jadi sesi
// yang lagi aktif gak ke-invalidate pas file ini di-deploy.
// Realtime (postgres_changes yang difilter RLS + presence) butuh token user yang
// sama kayak dipakai sesiFetch() — kalau enggak, channel subscribe tapi gak pernah
// nerima row apapun (RLS nge-filter diem-diem). Dipanggil tiap kali token baru
// didapat/direfresh, sejalur sama titik-titik stokAccessToken diisi.
// FIX "notif kolaborator kadang muncul kadang enggak": dulu baca stokAccessToken
// (cache) langsung — sama kelasnya sama bug "kekick ke login" di getFreshToken()
// bawah, tapi di sini akibatnya lebih diam-diam: token basi bukan bikin error,
// cuma bikin RLS nge-filter update orang lain tanpa tanda apapun, jadi kerasanya
// "kadang jalan kadang enggak" tergantung sempat-gaknya tab di-background pas
// token mepet expired. Sekarang ambil token fresh tiap dipanggil.
async function syncRealtimeAuth() {
  if (!rt) return;
  const token = await getFreshToken();
  if (token) rt.realtime.setAuth(token);
}

// FIX "kekick ke login padahal masih kerja": sesiFetch()/rpc-manual/upload di
// bawah dulu baca stokAccessToken (variabel cache) langsung, yang cuma
// keupdate lewat event TOKEN_REFRESHED punya SDK di background. Kalau tab ini
// sempat di-background (browser nge-throttle timer refresh SDK — kejadian
// wajar pas tab konversian dibiarin nganggur sambil kerja di Excel), token
// bisa expired duluan sebelum event itu sempat jalan, jadi request pertama
// abis balik ke tab kena 401 palsu walau sesi sebenarnya masih bisa direfresh.
// getFreshToken() manggil PNMAuth.getAccessToken() -> sb.auth.getSession(),
// yang ngecek-dan-refresh DI MOMEN ini juga (bukan nunggu timer) — sama
// persis kayak yang otomatis dilakuin sb.from()/sb.rpc() di crud-produk.js.
// Fallback ke stokAccessToken/ANON_KEY kalau PNMAuth somehow belum siap.
async function getFreshToken() {
  try {
    const t = await PNMAuth.getAccessToken();
    if (t) return t;
  } catch { /* lanjut ke fallback di bawah */ }
  return stokAccessToken || ANON_KEY;
}
function showApp() {
  authGate.style.display = 'none';
  appRoot.style.display = 'flex';
  openSesiFromUrlIfAny();
  loadSalesOptions();
  restoreNavContext();
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

// SECURITY FIX 2026-08-18: dulu file ini cuma ngecek "kredensial valid di
// Supabase Auth" — TIDAK pernah ngecek allowed_users kayak crud-produk.js.
// Sekarang RLS produk/produk_harga/dll udah diketatin ke allowed_users doang
// (lihat 14_restrict_catalog_read_to_internal.sql), jadi orang yang berhasil
// login tapi gak terdaftar tetap gak bisa lihat data apa pun — tapi tanpa
// cek ini, pengalamannya jadi "app-nya kosong/gak jalan" (bikin bingung),
// bukan pesan yang jujur soal kenapa. checkWhitelist() nutup celah UX itu,
// SAMA PERSIS pola checkWhitelistAndShowApp() di crud-produk.js.
async function checkWhitelist(session) {
  const email = (session.user.email || '').toLowerCase();
  const r = await sesiFetch(`allowed_users?select=email&email=eq.${encodeURIComponent(email)}&limit=1`);
  if (!r.ok) {
    // Query gagal (network/timeout dll) — BUKAN bukti email nggak terdaftar.
    // Jangan sign-out paksa gara-gara koneksi bermasalah.
    showGate('Gagal cek akses (koneksi bermasalah), coba lagi.');
    return false;
  }
  const rows = await r.json();
  if (!rows || !rows.length) {
    await PNMAuth.logout();
    showGate('Email ' + email + ' belum terdaftar sebagai tim. Hubungi admin kalau ini seharusnya salah.');
    return false;
  }
  return true;
}

// refreshAuthSession() manual SUDAH DIGANTIKAN oleh autoRefreshToken bawaan
// SDK (diaktifkan di shared/supabase-client.js) — PNMAuth.getSession() di
// bawah otomatis kepicu refresh sendiri kalau token yang tersimpan sudah
// dekat/lewat expired, gak perlu dicek manual pakai expires_at lagi di sini.

async function initAuth() {
  const session = await PNMAuth.getSession();
  if (!session) { showGate(); return; }
  stokAccessToken = session.access_token;
  currentUser = session.user ? { id: session.user.id, email: session.user.email } : null;
  if (!(await checkWhitelist(session))) return; // showGate() sudah dipanggil di dalamnya kalau gagal
  syncRealtimeAuth();
  showApp();
}

// PNMAuth.onAuthStateChange menangani 2 kasus yang dulu gak ke-cover pola manual:
//  1) Token di-refresh otomatis oleh SDK di background -> stokAccessToken (dipakai
//     seluruh sesiFetch()/rpc()/upload di file ini) otomatis ke-update juga, gak
//     perlu nunggu initAuth() jalan ulang.
//  2) Sesi habis/di-signOut dari tab/modul lain (mis. user logout dari crud-produk
//     di tab sebelah) -> app ini ikut ke-gate juga, gak nyangkut di state "login"
//     palsu karena token yang dipegang sebenarnya udah gak valid.
PNMAuth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT' || !session) {
    if (appRoot.style.display !== 'none') showGate('Sesi kamu berakhir, silakan masuk lagi.');
    return;
  }
  if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
    stokAccessToken = session.access_token;
    syncRealtimeAuth();
  }
});

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
    const { session } = await PNMAuth.login(email, password);
    stokAccessToken = session.access_token;
    currentUser = session.user ? { id: session.user.id, email: session.user.email } : null;
    if (!(await checkWhitelist(session))) return; // showGate() sudah dipanggil di dalamnya kalau gagal
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

// Logout: satu pintu lewat PNMAuth.logout() -> ini yang otomatis nembak
// /auth/v1/logout buat revoke refresh token di server (mekanisme yang
// sempat ketinggalan 1 commit) SEKALIGUS hapus sesi dari localStorage.
// showGate() sendiri sudah kepanggil otomatis lewat onAuthStateChange di
// atas begitu event SIGNED_OUT masuk, jadi gak perlu dipanggil manual di sini.
const btnLogout = document.getElementById('btn-logout');
if (btnLogout) {
  btnLogout.addEventListener('click', async () => {
    btnLogout.disabled = true;
    try { await PNMAuth.logout(); }
    finally { btnLogout.disabled = false; }
  });
}

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
  const rawExt = dotIdx > -1 ? name.slice(dotIdx) : '';
  const cleanBase = base
    .normalize('NFKC')                              // normalisasi variasi unicode
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')    // hapus control char tak terlihat
    .replace(/[\u00A0\u200B-\u200D\uFEFF]/g, ' ')    // nbsp & zero-width -> spasi biasa
    .replace(/\s+/g, '_')                            // spasi (termasuk ganda) -> underscore
    .replace(/[^a-zA-Z0-9._-]/g, '')                 // buang sisa char di luar whitelist aman
    .replace(/_+/g, '_')                             // rapikan underscore berulang
    .replace(/^_+|_+$/g, '');                        // trim underscore di ujung
  // SECURITY FIX: dulu ekstensi (rawExt) dipakai mentah tanpa filter sama sekali —
  // kalau nama file kebetulan punya titik lain + karakter aneh/slash setelah titik
  // terakhir, itu lolos apa adanya ke storage key. Sekarang ekstensi juga disaring
  // whitelist yang sama, cuma dibolehin alnum (buat jaga-jaga kalau ada ekstensi
  // ganda semacam .tar.gz, walau di app ini praktiknya cuma .pdf/.png dst).
  const cleanExt = rawExt.toLowerCase().replace(/[^a-z0-9.]/g, '');
  let finalName = (cleanBase || 'file') + cleanExt;
  // SECURITY FIX: isValidStorageKey() sebelumnya didefinisikan tapi TIDAK PERNAH
  // dipanggil di manapun (dead code) — jadi validasi whitelist karakter S3-safe yang
  // dimaksud gak pernah benar-benar dieksekusi. Sekarang dipakai sebagai pengecekan
  // akhir; kalau karena suatu hal hasil sanitasi di atas masih lolos karakter yang
  // gak aman, fallback ke nama generik + timestamp biar upload tetap gak gagal diam-diam
  // tapi juga gak pernah kirim key yang gak divalidasi ke Storage.
  if (!isValidStorageKey(finalName)) {
    finalName = 'file_' + Date.now() + cleanExt;
  }
  return finalName;
}

// Batas ukuran file upload lampiran/gambar (client-side, defense-in-depth —
// idealnya bucket/Edge Function juga membatasi ini di sisi server).
const MAX_UPLOAD_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB
function formatFileSizeMb(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// SECURITY: cek magic bytes PDF (%PDF di awal file), bukan cuma percaya
// file.type/nama ekstensi yang gampang dispoof (rename file apa saja jadi .pdf).
async function looksLikePdf(file) {
  try {
    const head = await file.slice(0, 5).arrayBuffer();
    const bytes = new Uint8Array(head);
    const sig = String.fromCharCode(...bytes);
    return sig.startsWith('%PDF');
  } catch {
    return false;
  }
}

// upload file ke Supabase Storage bucket (dipakai fitur drag & drop brosur/gambar).
// x-upsert:true supaya kalau nama file sama, langsung ditimpa (gak perlu hapus manual dulu).
async function uploadToSupabaseStorage(bucket, path, fileOrBlob, contentType) {
  // PENTING: Authorization pakai token sesi user yg login (stokAccessToken), BUKAN ANON_KEY.
  // Kalau pakai ANON_KEY, Supabase Storage nganggep request datang dari role 'anon',
  // jadi kalau policy RLS bucket-nya butuh role 'authenticated', request selalu ditolak
  // dgn error "new row violates row-level security policy" walau bucket-nya sendiri udah bener.
  const uploadToken = await getFreshToken();
  if (!uploadToken || uploadToken === ANON_KEY) throw new Error('Sesi login sudah habis / belum login — silakan login ulang dulu.');
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${encodeURIComponent(path)}`, {
    method: 'POST',
    headers: {
      'apikey': ANON_KEY,
      'Authorization': 'Bearer ' + uploadToken,
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
const lampiranSetRincian = document.getElementById('lampiran-set-rincian');
const lampiranToggleBtn = document.getElementById('lampiran-toggle-btn');
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
  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    showToast(`File terlalu besar (${formatFileSizeMb(file.size)}). Maksimal ${formatFileSizeMb(MAX_UPLOAD_SIZE_BYTES)}.`, 'error');
    return;
  }
  // Catatan: validasi isi file "beneran gambar" sudah otomatis terjadi di
  // imageFileToPngBlob() di bawah — file didekode lewat <img>/<canvas> dan
  // di-re-encode jadi PNG asli, jadi file non-gambar yang cuma diganti nama
  // ekstensinya akan gagal di sini (img.onerror) dan ditolak.
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
  const r = await sesiFetch(`produk?kode_produk=eq.${encodeURIComponent(kode_produk)}&select=id&limit=1`);
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
  // SECURITY FIX: dulu pakai ANON_KEY buat list SELURUH isi bucket — karena
  // ANON_KEY public (ada di bundle JS), ini artinya siapapun tanpa login bisa
  // enumerasi semua nama file lampiran tanpa buka aplikasi sama sekali. Bucket ini
  // memang punya URL publik utk file individual (by design), tapi listing massal
  // gak perlu ikut dibuka ke non-user — sekarang pakai token sesi user yang login.
  const listToken = await getFreshToken();
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/list/lampiran-unit`, {
    method: 'POST',
    headers: {'apikey':ANON_KEY,'Authorization':'Bearer '+(listToken || ANON_KEY),'Content-Type':'application/json'},
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

let lampiranCurrentIsSet = false; // dipakai toggle-btn buat tau mode "kembali" yang bener

async function openLampiranModal(kode_produk, isSet) {
  lampiranTitle.textContent = 'Lampiran — ' + kode_produk;
  lampiranPages.innerHTML = '';
  lampiranSetRincian.innerHTML = '';
  lampiranSetRincian.style.display = 'none';
  lampiranPicker.style.display = 'none';
  lampiranSuggestList.style.display = 'none';
  lampiranSearchInput.value = '';
  lampiranSaveRow.style.display = 'none';
  lampiranGantiBtn.style.display = 'none';
  lampiranToggleBtn.style.display = 'none';
  lampiranUploadStatus.style.display = 'none';
  lampiranDropzone.classList.remove('dragover');
  lampiranSaveBtn.disabled = false;
  lampiranSaveBtn.textContent = 'Simpan';
  lampiranStatus.style.display = 'block';
  lampiranStatus.textContent = 'Memuat lampiran…';
  lampiranModal.classList.add('show');
  lampiranCurrentKode = kode_produk;
  lampiranCurrentFilename = null;
  lampiranCurrentIsSet = !!isSet;

  const produk_id = await getProdukId(kode_produk);
  lampiranCurrentProdukId = produk_id;

  if (lampiranCurrentIsSet) {
    // Default buat SET: rincian isi set + gambar — "lampiran" SET pada
    // dasarnya emang dari isi komponennya (persis sheet per-set di export
    // Excel), bukan brosur terpisah yang perlu dicari/diupload. Pintu upload
    // PDF manual TETAP dibuka lewat toggle-btn, buat kasus SET yang beneran
    // punya brosur paket dari vendor.
    await renderSetRincianInLampiranModal(kode_produk);
    lampiranToggleBtn.textContent = 'Upload Lampiran PDF';
    lampiranToggleBtn.style.display = 'inline-block';
    lampiranToggleBtn.onclick = () => runPdfLookupFlow(kode_produk);
    return;
  }

  await runPdfLookupFlow(kode_produk);
}

// Rincian isi set + gambar, ditampilkan sebagai tabel di modal Lampiran —
// data & foto diambil dari sumber yang SAMA dengan sheet per-set di export
// Excel (get_set_items via getSetItems + fetchImageBase64/removeBackground),
// jadi apa yang keliatan di sini bakal konsisten sama isi file export nanti.
async function renderSetRincianInLampiranModal(kode_produk) {
  lampiranPages.innerHTML = '';
  lampiranPicker.style.display = 'none';
  lampiranSaveRow.style.display = 'none';
  lampiranGantiBtn.style.display = 'none';
  lampiranSetRincian.style.display = 'none';
  lampiranStatus.style.display = 'block';
  lampiranStatus.textContent = 'Memuat rincian set…';

  let items;
  try {
    items = await getSetItems(kode_produk);
  } catch (e) {
    lampiranStatus.textContent = 'Gagal memuat rincian set: ' + (e.message || e);
    return;
  }
  if (!items.length) {
    lampiranStatus.textContent = 'Rincian isi set tidak ditemukan buat produk ini.';
    return;
  }

  // Gambar tiap komponen diambil PARALEL (bukan satu-satu) — sama pola kayak
  // worker pool di export Excel, biar gak lelet kalau isi setnya banyak.
  const imgs = new Array(items.length);
  await Promise.all(items.map(async (it, i) => {
    const raw = await fetchImageBase64(it.kode_asli, it.kode_produk);
    imgs[i] = raw ? await removeBackground(raw) : null;
  }));

  lampiranStatus.style.display = 'none';
  const esc = (s) => String(s ?? '').replace(/</g, '&lt;');
  const rows = items.map((it, i) => `
    <tr style="border-bottom:1px solid var(--border)">
      <td style="padding:8px;text-align:center;color:var(--text-muted);font-size:12px">${it.urutan || i + 1}</td>
      <td style="padding:8px;font-family:monospace;font-size:12px;white-space:nowrap">${esc(it.kode_produk)}</td>
      <td style="padding:8px;font-size:13px">${esc(it.nama_produk)}</td>
      <td style="padding:8px;text-align:center;font-size:13px">${it.qty ?? 1}</td>
      <td style="padding:8px;text-align:center">${imgs[i]
        ? `<img src="data:image/png;base64,${imgs[i]}" style="width:56px;height:56px;object-fit:contain"/>`
        : '<span style="color:var(--text-muted);font-size:11px">—</span>'}</td>
    </tr>`).join('');

  lampiranSetRincian.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px">
      <div style="font-size:12px;color:var(--text-muted)">Rincian isi set — sama seperti sheet per-set di export Excel.</div>
      <button id="lampiran-copy-sheet-btn" title="Copy kode, deskripsi, qty — siap paste ke Google Sheet (tanpa gambar)" style="border:1px solid var(--border-strong);background:var(--surface-2);color:var(--text-secondary);font-size:12px;font-weight:500;padding:5px 10px;border-radius:8px;cursor:pointer;white-space:nowrap;display:flex;align-items:center;gap:6px">
        <i class="ti ti-copy"></i><span>Copy buat Sheet</span>
      </button>
    </div>
    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr style="background:var(--accent-bg);color:var(--accent-text)">
          <th style="padding:8px;text-align:center;width:36px;font-size:12px">No</th>
          <th style="padding:8px;text-align:left;font-size:12px">Kode</th>
          <th style="padding:8px;text-align:left;font-size:12px">Nama Produk</th>
          <th style="padding:8px;text-align:center;width:60px;font-size:12px">Qty</th>
          <th style="padding:8px;text-align:center;width:80px;font-size:12px">Gambar</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
  lampiranSetRincian.style.display = 'block';

  // Tombol copy: kode + deskripsi (nama_produk) + qty aja, format TSV (tab-separated)
  // biar pas di-paste ke Google Sheet langsung kepisah otomatis per kolom — gambar
  // sengaja gak diikutkan karena gambar gak bisa ditempel lewat clipboard teks biasa.
  const copyBtn = document.getElementById('lampiran-copy-sheet-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => copySetRincianToClipboard(items, copyBtn));
  }
}

async function copySetRincianToClipboard(items, btnEl) {
  const clean = (s) => String(s ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ').trim();
  const tsv = items.map((it) => [clean(it.kode_produk), clean(it.nama_produk), it.qty ?? 1].join('\t')).join('\n');

  try {
    await navigator.clipboard.writeText(tsv);
  } catch (e) {
    // Fallback buat browser/context yang gak dukung Clipboard API (misal non-HTTPS)
    const ta = document.createElement('textarea');
    ta.value = tsv;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e2) {
      showToast('Gagal copy ke clipboard: ' + (e2.message || e2), 'error');
      document.body.removeChild(ta);
      return;
    }
    document.body.removeChild(ta);
  }

  showToast(`Tersalin ${items.length} baris (kode, deskripsi, qty) — siap paste ke Google Sheet ✓`);
  if (btnEl) {
    const original = btnEl.innerHTML;
    btnEl.innerHTML = '<i class="ti ti-check"></i><span>Tersalin!</span>';
    setTimeout(() => { btnEl.innerHTML = original; }, 1500);
  }
}

// Flow cari/render/upload PDF — sama persis kayak isi openLampiranModal yang
// lama, cuma dipisah jadi fungsi sendiri biar bisa dipanggil ULANG lewat
// toggle-btn dari mode Rincian Set (item SET) tanpa perlu buka ulang modal
// dari awal / fetch produk_id lagi.
async function runPdfLookupFlow(kode_produk) {
  lampiranPages.innerHTML = '';
  lampiranSetRincian.style.display = 'none';
  lampiranPicker.style.display = 'none';
  lampiranSuggestList.style.display = 'none';
  lampiranSaveRow.style.display = 'none';
  lampiranGantiBtn.style.display = 'none';
  lampiranStatus.style.display = 'block';
  lampiranStatus.textContent = 'Memuat lampiran…';

  if (lampiranCurrentIsSet) {
    lampiranToggleBtn.textContent = 'Lihat Rincian Set';
    lampiranToggleBtn.style.display = 'inline-block';
    lampiranToggleBtn.onclick = () => renderSetRincianInLampiranModalAndResetToggle(kode_produk);
  }

  // 1. Cek apakah sudah ada link tersimpan manual di produk_media
  if (lampiranCurrentProdukId) {
    const savedUrl = await getSavedBrosurUrl(lampiranCurrentProdukId);
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

// Dipanggil dari toggle-btn pas lagi di mode PDF (item SET) buat balik ke
// tabel rincian — sekalian nyiapin toggle-btn lagi ke arah sebaliknya.
async function renderSetRincianInLampiranModalAndResetToggle(kode_produk) {
  await renderSetRincianInLampiranModal(kode_produk);
  lampiranToggleBtn.textContent = 'Upload Lampiran PDF';
  lampiranToggleBtn.style.display = 'inline-block';
  lampiranToggleBtn.onclick = () => runPdfLookupFlow(kode_produk);
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
  // SECURITY FIX: dulu cuma cek file.type/nama ekstensi — nilai itu ditentukan
  // browser dari EKSTENSI NAMA FILE, bukan isi asli, jadi gampang dilewati (rename
  // file apapun jadi ".pdf"). Sekarang dicek juga magic bytes (%PDF di awal file)
  // sebelum diupload ke bucket publik dengan Content-Type dipaksa application/pdf.
  const extLooksLikePdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (!extLooksLikePdf) {
    showToast('File harus berupa PDF.', 'error');
    return;
  }
  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    showToast(`File terlalu besar (${formatFileSizeMb(file.size)}). Maksimal ${formatFileSizeMb(MAX_UPLOAD_SIZE_BYTES)}.`, 'error');
    return;
  }
  if (!(await looksLikePdf(file))) {
    showToast('File ini bukan PDF asli (isi file tidak cocok) — cek lagi atau ganti nama file yang benar.', 'error');
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
    // SECURITY FIX: dulu pakai ANON_KEY (public, ada di bundle JS) buat Authorization
    // di POST ini — artinya SIAPAPUN tanpa login bisa nembak endpoint ini langsung
    // (bypass auth-gate total) dan set produk_media.url bebas ke domain manapun kalau
    // RLS tabel ini kebetulan mengizinkan role anon nulis. Sekarang wajib pakai token
    // sesi user yang beneran login, sejalan sama uploadToSupabaseStorage() di atas.
    const writeToken = await getFreshToken();
    if (!writeToken || writeToken === ANON_KEY) throw new Error('Sesi login sudah habis / belum login — silakan login ulang dulu.');
    const url = LAMPIRAN_BASE + encodeURIComponent(lampiranCurrentFilename);
    const r = await fetch(`${SUPABASE_URL}/rest/v1/produk_media`, {
      method: 'POST',
      headers: {'apikey':ANON_KEY,'Authorization':'Bearer '+writeToken,'Content-Type':'application/json','Prefer':'return=minimal'},
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
let modeSwasta = false; // toggle "Harga Swasta" di panel PENCARIAN — cuma preferensi quick lookup (harga & link_v6 yang ditampilin pas browsing hasil cari). JANGAN dipakai buat nentuin harga output (clipboard/record/export/SPH) — lihat modeSwastaOutput.
let modeSwastaOutput = false; // mode harga yang BENERAN dipakai buat Clipboard total & Pagu, Record Konversi, Export ke Excel, dan Generate SPH. Sengaja dipisah dari modeSwasta di atas biar user gak kepaksa ngubah tampilan pencarian cuma buat ganti mode output — lihat toggle #com-ekat/#com-swasta di clip-output-mode-row.
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
const comEkatBtn = document.getElementById('com-ekat');
const comSwastaBtn = document.getElementById('com-swasta');
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
const PERMINTAAN_ITEM_TABLE = 'permintaan_item'; // tabel mentah di balik RPC get_permintaan_by_sesi/update_permintaan_item_multi — dipakai buat filter postgres_changes
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
const btnLeaveSesi = document.getElementById('btn-leave-sesi');
const toastContainer = document.getElementById('toast-container');
const APP_TITLE_BASE = document.title; // "Conversion Workspace — PT Pionir Nusantara Manufacturing"

// Notifikasi kecil yang muncul-hilang sendiri — dipakai buat kasih feedback instan
// untuk aksi yang sebelumnya senyap (bikin sesi, selesaikan sesi), biar user gak
// ragu-ragu apakah aksinya beneran kejadian atau enggak.
function showToast(msg, type = 'success') {
  // Body delegate ke shared/toast.js — signature & 32 titik panggil di file
  // ini sama sekali gak berubah, cuma implementasinya yang sekarang satu
  // sumber sama crud-produk.js (lihat shared/toast.js buat detail/alasan).
  PNMToast.show(msg, type);
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

// Tombol "Selesaikan Sesi"/"Keluar dari Sesi" cuma boleh aktif kalau memang
// lagi ada sesi yang berjalan di server (currentSesiId keisi) — jadi state-nya
// selalu nyambung sama kenyataan, gak pernah nampilin tombol aktif buat sesi
// yang gak ada.
function updateEndSesiBtnState() {
  btnEndSesi.disabled = !currentSesiId;
  if (btnLeaveSesi) btnLeaveSesi.disabled = !currentSesiId;
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
  const token = await getFreshToken();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'apikey': ANON_KEY,
      'Authorization': 'Bearer ' + token,
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
    butuh_bantuan: currentButuhBantuan,
    mode_harga_swasta: modeSwastaOutput
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
    // WORKAROUND: postgres_changes event DELETE ternyata gak reliable di Supabase
    // Realtime (dikonfirmasi manual: SQL DELETE langsung pun gak ngirim event apa-apa
    // buat tabel ini — publication/RLS/replica identity semua udah benar, ini murni
    // limitation di sisi Supabase, bukan config kita). Makanya penghapusan disiarin
    // manual lewat Broadcast begitu REST DELETE-nya sukses, bukan nunggu postgres_changes.
    if (typeof broadcastItemRemoved === 'function') broadcastItemRemoved(item);
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
// Kalau belum ada sesi & user nolak konfirmasi "Mulai Konversi Baru?" pas ngetik
// di field ini, jangan nanya ULANG tiap debounce nembak lagi (bisa tiap keystroke-
// pause) — cukup sekali per "sesi ngetik form" ini. Direset begitu ada sesi baru
// beneran kebentuk di tempat lain (lihat resetChecklistUI()).
let headerFieldsSesiDeclined = false;
[inpRs, inpSales, inpMarsup].forEach(inp => {
  inp.addEventListener('input', () => {
    clearTimeout(headerSaveTimer);
    setSesiSavedStatus('Menyimpan…');
    headerSaveTimer = setTimeout(async () => {
      if (!currentSesiId) {
        if (headerFieldsSesiDeclined) { setSesiSavedStatus(''); return; }
        const ok = await showConfirmModal({
          title: 'Mulai Konversi Baru?',
          text: 'Isian ini bakal disimpan ke sesi konversi baru.',
          okText: 'Ya, Mulai Konversi'
        });
        if (!ok) { headerFieldsSesiDeclined = true; setSesiSavedStatus(''); return; }
      }
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

// ---- Editing indicator: broadcast 'editing' pas fokus di salah satu field header,
// biar kolaborator lain liat "lagi diedit siapa" — ini SOFT-locking (cuma sinyal),
// bukan hard lock; semua tetep bisa ngedit bareng kapan aja. ----
const RT_FIELD_MAP = [[inpRs, 'nama_rs'], [inpSales, 'nama_sales'], [inpMarsup, 'pic_marsup']];
let editingBroadcastTimer = null;
RT_FIELD_MAP.forEach(([inp, field]) => {
  inp.addEventListener('focus', () => {
    broadcastEditing(field);
    clearInterval(editingBroadcastTimer);
    editingBroadcastTimer = setInterval(() => broadcastEditing(field), 3000); // di-refresh berkala selama fokus, biar kolaborator lain tau masih diedit
  });
  inp.addEventListener('blur', () => {
    clearInterval(editingBroadcastTimer);
    broadcastEditingStop(field);
  });
});
function broadcastEditing(field) {
  if (!sesiPresenceChannel) return;
  sesiPresenceChannel.send({ type: 'broadcast', event: 'editing', payload: { field, nama: currentDisplayName() } }).catch(() => {});
}
function broadcastEditingStop(field) {
  if (!sesiPresenceChannel) return;
  sesiPresenceChannel.send({ type: 'broadcast', event: 'editing_stop', payload: { field } }).catch(() => {});
}
const editingBadgeTimers = {}; // field -> timeout id
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
function handleEditingStopBroadcast({ payload }) {
  if (!payload || !payload.field) return;
  const badge = document.getElementById('editing-badge-' + payload.field);
  if (!badge) return;
  clearTimeout(editingBadgeTimers[payload.field]);
  badge.classList.remove('show');
}

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
// FIX (fundamental, per diskusi): dulu SATU-SATUNYA cara keluar dari sesi
// adalah "Selesaikan Sesi" — yang "mahal" karena ngubah status:'selesai' di
// server (sesi ilang dari Konversi Berjalan, otomatis dianggap tertutup buat
// keperluan riwayat). Ini nambah opsi "murah": Keluar dari Sesi — cuma
// bersihin TAMPILAN lokal browser ini doang, gak nyentuh server sama sekali.
// Sesi tetap 'berjalan', tetap di daftar Konversi Berjalan, kolaborator lain
// (kalau ada) sama sekali gak keganggu — bisa dibuka lagi kapan aja lanjut
// dari kondisi terakhir, gak ada state yang keubah/ke-reset di server.
btnLeaveSesi.addEventListener('click', () => {
  if (!currentSesiId) return;
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
  showToast('Keluar dari sesi — sesi tetap berjalan, bisa dibuka lagi lewat daftar Konversi Berjalan');
  loadSesiList();
});
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
  document.getElementById('door-btn-cari').classList.toggle('active', door === 'cari');
  document.getElementById('door-btn-konversi').classList.toggle('active', door === 'konversi');
  if (door === 'cari') {
    switchSubTab('cari'); // pintu ini cuma nyisain 1 opsi, pastiin itu yang aktif
    if (typeof switchTab === 'function') switchTab('search'); // sinkron sama mekanisme tab mobile yang udah ada
  } else if (typeof switchTab === 'function') {
    switchTab('clip'); // default landing di workspace-nya, subtab lain (Kebutuhan RS dkk) tetep dijangkau dari situ
  }
}
document.getElementById('door-btn-cari').addEventListener('click', () => switchDoor('cari'));
document.getElementById('door-btn-konversi').addEventListener('click', () => switchDoor('konversi'));

// ══════════════════════════════════════════
// NAVIGATION LAYER — konversian.html <-> crud-produk.html
// Murni URL query param, gak pakai sessionStorage sama sekali — ternyata
// ?sesi=<id> buat resume sesi konversi UDAH ADA (dipakai fitur share link
// WhatsApp, lihat openSesiFromUrlIfAny() di atas), jadi tinggal numpang
// pola yang sama, bukan bikin mekanisme baru. Nggak butuh Vite/router,
// nggak ubah cara deploy — tetap static file kayak sekarang.
// ══════════════════════════════════════════

function navigateToEditProduk(kode) {
  const url = new URL('crud-produk.html', window.location.href);
  url.searchParams.set('edit', kode);
  url.searchParams.set('return_to', 'konversian');
  if (currentSesiId) url.searchParams.set('return_sesi', currentSesiId);
  window.location.href = url.toString();
}

// Dipanggil sekali dari showApp() setelah login sukses. Gak ngapa-ngapain
// kalau bukan hasil balik dari crud-produk (?resume gak ada) — aman
// dipanggil selalu, gak ganggu load biasa/link WhatsApp yang cuma bawa ?sesi=.
async function restoreNavContext() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('resume') !== '1') return;

  // ?sesi= (kalau ada) udah otomatis ke-handle sama openSesiFromUrlIfAny()
  // yang dipanggil showApp() — di sini cuma mastiin door-nya Konversi dulu,
  // soalnya default door pas fresh load itu 'cari' (lihat class awal
  // #app-root di HTML), dan subtab-row disembunyikan total di door itu.
  if (params.get('sesi')) switchDoor('konversi');

  const refreshedKode = params.get('refreshed');
  if (refreshedKode) refreshSingleProdukCard(refreshedKode);

  // Bersihkan query string dari address bar SETELAH dipakai, biar reload
  // manual berikutnya gak nyoba resume/refresh ulang ke state basi. Link
  // ?sesi= murni (dari WhatsApp, tanpa resume=1) sengaja gak kena ini,
  // biar tetap bisa di-bookmark/dibagi ulang seperti sebelumnya.
  window.history.replaceState({}, '', window.location.pathname);
}

// Patch 1 card produk yang lagi tampil di hasil pencarian, tanpa re-search
// semua — dipakai setelah balik dari edit produk di crud-produk.html.
async function refreshSingleProdukCard(kode) {
  if (!Array.isArray(lastResults) || !lastResults.some(r => r.kode_produk === kode)) return;
  try {
    const res = await sesiFetch(`produk?kode_produk=eq.${encodeURIComponent(kode)}&select=*&limit=1`);
    if (!res.ok) return;
    const rows = await res.json();
    if (rows && rows[0]) {
      lastResults = lastResults.map(r => r.kode_produk === kode ? rows[0] : r);
      renderResults(lastResults);
    }
  } catch (e) { console.warn('Gagal refresh kartu produk:', e); }
}

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
  // SECURITY FIX 2026-08-14: nama_rs/pic_marsup/nama_sales itu free-text yang
  // diketik user & disebar ke SEMUA kolaborator lewat Realtime — dulu
  // ditulis mentah ke innerHTML (stored XSS). Sekarang semua di-escape lewat
  // escapeHtmlAttr() sebelum masuk template.
  const namaSafe = escapeHtmlAttr(s.nama_rs || '(Nama RS belum diisi)');
  const picSafe = escapeHtmlAttr(s.pic_marsup || '-');
  const salesSafe = escapeHtmlAttr(s.nama_sales || '-');
  const bantuanBadge = s.butuh_bantuan
    ? `<span class="tipe-badge" style="background:var(--danger-bg);color:var(--danger)">🙋 Butuh bantuan</span>
       <button class="sesi-wa-btn" data-id="${s.id}" data-nama="${namaSafe}" title="Kirim link sesi ini ke WhatsApp" type="button" style="position:absolute;top:8px;right:38px;width:24px;height:24px;border:1px solid var(--success-border);border-radius:6px;background:var(--success-bg);color:var(--success);font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center"><i class="ti ti-brand-whatsapp"></i></button>`
    : '';
  // Ringkasan Permintaan RS (kalau ada) — biar temen yang lagi liat daftar
  // "Konversi Berjalan" langsung tau ada permintaan apa gak di sesi ini,
  // tanpa perlu buka satu-satu dulu.
  const p = s._permintaan;
  const permintaanChip = p
    ? `<span class="mi"><i class="ph ph-clipboard-text"></i><span>Permintaan RS: ${p.items_terpenuhi}/${p.items_total} terpenuhi${p.items_pending > 0 ? ' · ' + p.items_pending + ' belum dicek' : ''}</span></span>`
    : '';
  return `<div class="rcard sesi-card" data-id="${s.id}" style="position:relative">
    <button class="sesi-delete-btn" data-id="${s.id}" data-nama="${namaSafe}" title="Hapus sesi ini" type="button"><i class="ti ti-trash"></i></button>
    <div class="rcard-top" style="padding-right:66px">
      <div class="rcard-name">${namaSafe}</div>
      ${bantuanBadge}
    </div>
    <div class="rcard-meta">
      <span class="mi"><i class="ti ti-user"></i><span>PIC: ${picSafe}</span></span>
      <span class="mi"><i class="ti ti-users"></i><span>Sales: ${salesSafe}</span></span>
      <span class="mi"><i class="ti ti-package"></i><span>${itemCount} produk</span></span>
      ${permintaanChip}
      <span class="mi"><i class="ti ti-clock"></i><span>${sesiTimeAgo(s.updated_at)}</span></span>
    </div>
  </div>`;
}

// Kartu riwayat: sesi yang statusnya 'selesai', apapun hasilnya.
// FIX (fundamental, per diskusi): "Jadi Order"/"Ditutup Tanpa Order" DULU
// didiktein otomatis dari ada-gaknya baris konversi_record (Record Konversi
// pernah diklik atau enggak) — itu keliru, karena "pernah di-Record" beda
// sama "beneran jadi order", yang faktanya nunggu feedback sales dan bisa
// berubah lama SETELAH sesi ditutup. Sekarang hasil_order itu field manual
// (kolom baru di sesi_konversi, lihat migration terpisah) yang manusia set
// sendiri lewat dropdown di kartu ini — default null = "Menunggu Feedback
// Sales" (netral, BUKAN diasumsikan gagal). REV/grand_total/link tetap dari
// konversi_record seperti biasa, itu emang soal dokumennya sendiri, bukan
// soal hasil order.
function renderRiwayatCard(s) {
  const itemCount = (s.sesi_konversi_item && s.sesi_konversi_item[0] && s.sesi_konversi_item[0].count) || 0;
  // SECURITY FIX 2026-08-14: sama seperti renderSesiCard — escape free-text
  // sebelum masuk innerHTML (stored XSS fix).
  const namaSafe = escapeHtmlAttr(s.nama_rs || '(Nama RS belum diisi)');
  const picSafe = escapeHtmlAttr(s.pic_marsup || '-');
  const salesSafe = escapeHtmlAttr(s.nama_sales || '-');
  const records = s.konversi_record || [];
  const latest = records.length ? records.reduce((a, b) => (b.revisi > a.revisi ? b : a)) : null;
  const hasilOrder = s.hasil_order || null; // null | 'jadi_order' | 'tanpa_order'
  const hasilOrderCls = hasilOrder === 'jadi_order' ? 'hasil-order-jadi' : hasilOrder === 'tanpa_order' ? 'hasil-order-tanpa' : 'hasil-order-nunggu';
  const orderBadge = `<select class="hasil-order-select ${hasilOrderCls}" data-id="${s.id}" onclick="event.stopPropagation()" title="Hasil order ditentukan manusia, bukan otomatis — nunggu feedback sales">
      <option value="" ${!hasilOrder ? 'selected' : ''}>⏳ Menunggu Feedback Sales</option>
      <option value="jadi_order" ${hasilOrder === 'jadi_order' ? 'selected' : ''}>✅ Jadi Order</option>
      <option value="tanpa_order" ${hasilOrder === 'tanpa_order' ? 'selected' : ''}>◻️ Tidak Jadi Order</option>
    </select>${latest ? `<span class="mi" style="margin-left:4px"><i class="ti ti-file-text"></i><span>${latest.revisi > 0 ? 'REV' + latest.revisi : 'Ada Record'}${latest.grand_total != null ? ' · Rp' + Number(latest.grand_total).toLocaleString('id-ID') : ''}</span></span>` : ''}`;
  const versiChip = records.length > 1
    ? `<span class="mi"><i class="ti ti-versions"></i><span>${records.length} versi tersimpan</span></span>`
    : '';
  // Link file/dokumen yang nempel di record terbaru (biasanya link Drive dari
  // "Simpan ke Drive" → auto-filled ke rec-link → ikut kesimpen di sini).
  // stopPropagation biar klik link gak ikut ngebuka sesi (card-nya sendiri
  // punya click handler buat openSesi).
  const linkChip = (latest && latest.link)
    ? `<a class="mi" href="${latest.link.replace(/"/g, '&quot;')}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="color:var(--accent-text)"><i class="ti ti-link"></i><span>Buka file</span></a>`
    : '';
  return `<div class="rcard riwayat-card" data-id="${s.id}" style="position:relative">
    <div class="rcard-top" style="padding-right:8px">
      <div class="rcard-name">${namaSafe}</div>
      ${orderBadge}
    </div>
    <div class="rcard-meta">
      <span class="mi"><i class="ti ti-user"></i><span>PIC: ${picSafe}</span></span>
      <span class="mi"><i class="ti ti-users"></i><span>Sales: ${salesSafe}</span></span>
      <span class="mi"><i class="ti ti-package"></i><span>${itemCount} produk</span></span>
      ${versiChip}
      ${linkChip}
      <span class="mi"><i class="ti ti-clock"></i><span>Selesai ${sesiTimeAgo(s.updated_at)}</span></span>
    </div>
  </div>`;
}

// Nulis hasil_order (manual, dari dropdown kartu riwayat) ke server. Optimistic
// UI — dropdown udah kepilih duluan pas ini jalan — jadi kalau gagal, dropdown
// dibalikin ke value lama + toast error, biar gak nampilin state yang gak
// beneran kesimpen.
async function persistHasilOrder(sesiId, value, selectEl) {
  const prevValue = selectEl.dataset.prevValue || '';
  selectEl.dataset.prevValue = value;
  selectEl.classList.remove('hasil-order-jadi', 'hasil-order-tanpa', 'hasil-order-nunggu');
  selectEl.classList.add(value === 'jadi_order' ? 'hasil-order-jadi' : value === 'tanpa_order' ? 'hasil-order-tanpa' : 'hasil-order-nunggu');
  try {
    const res = await sesiFetch(`${SESI_TABLE}?id=eq.${sesiId}`, {
      method: 'PATCH',
      body: JSON.stringify({ hasil_order: value || null, updated_at: new Date().toISOString() })
    });
    if (!res.ok) throw new Error('PATCH gagal');
  } catch (err) {
    selectEl.value = prevValue;
    selectEl.dataset.prevValue = prevValue;
    selectEl.classList.remove('hasil-order-jadi', 'hasil-order-tanpa', 'hasil-order-nunggu');
    selectEl.classList.add(prevValue === 'jadi_order' ? 'hasil-order-jadi' : prevValue === 'tanpa_order' ? 'hasil-order-tanpa' : 'hasil-order-nunggu');
    showToast('Gagal simpan hasil order, coba lagi', 'error');
  }
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
    const res = await sesiFetch(`${SESI_TABLE}?status=eq.selesai${searchFilter}&select=*,${SESI_ITEM_TABLE}(count),konversi_record(id,grand_total,kategori,revisi,link)&order=updated_at.desc&limit=100`);
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
    riwayatList.querySelectorAll('.hasil-order-select').forEach(sel => {
      sel.addEventListener('click', (e) => e.stopPropagation());
      sel.addEventListener('mousedown', (e) => e.stopPropagation());
      sel.addEventListener('change', (e) => persistHasilOrder(sel.dataset.id, sel.value, sel));
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
        'Authorization': 'Bearer ' + (await getFreshToken())
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
    if (typeof switchDoor === 'function') switchDoor('konversi'); // buka sesi = jelas-jelas mau lanjut kerjaan konversi
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

    // Mode harga ikut sesi (ditetapkan pembuatnya), bukan default lokal —
    // setModeSwastaOutput() di bawah juga manggil updateClipboard().
    setModeSwastaOutput(!!sesi.mode_harga_swasta);
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
  // Sesi ganti total → link Drive sesi sebelumnya gak relevan lagi buat sesi
  // yang baru dibuka/dimulai (lihat lastDriveUrl & openRecordModal()).
  lastDriveUrl = null;
  checklistItems = [];
  checklistPermintaanId = null;
  checklistTanggal = null;
  checklistExpandedId = null;
  checklistPickingId = null;
  // Cache saran Dictionary di-key pakai item.id — item.id sesi lama gak relevan
  // lagi (dan secara teori bisa collide sama id sesi baru), buang aja.
  Object.keys(dictSuggestionCache).forEach(k => delete dictSuggestionCache[k]);
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
  // Konteks sesi ganti total — kalau ada penolakan "Mulai Konversi Baru?" dari
  // form sebelumnya, itu gak relevan lagi buat konteks yang baru ini.
  headerFieldsSesiDeclined = false;
  // BUGFIX: file Excel hasil export & status stepper "Export ✓ / Simpan ke
  // Drive ✓" nempel ke sesi SEBELUMNYA — begitu pindah/tutup/hapus sesi,
  // itu semua gak relevan lagi (mirip logika lastDriveUrl/resetSsReferences
  // di atas), tapi sebelumnya gak pernah dibersihin sampai reload halaman
  // manual. lastExportBlob dikosongin biar "Simpan ke Drive" gak bisa
  // reupload file Excel sesi lama tanpa export ulang dulu; window.convFlow.
  // reset() (konversian.html) yang beresin tampilan steppernya sendiri.
  lastExportBlob = null;
  lastExportFilename = null;
  lastExportNamaSales = null;
  if (typeof btnDriveUpload !== 'undefined' && btnDriveUpload) btnDriveUpload.disabled = true;
  if (window.convFlow && typeof window.convFlow.reset === 'function') window.convFlow.reset();
  // BUGFIX: isian tab "Buat SPH" (RS/Sales/Tanggal/Nomor/preview) nempel ke sesi
  // SEBELUMNYA — sphPrefillFromSession() di sph-module.js sengaja cuma ngisi field
  // kosong (biar gak nimpa ketikan manual DALAM 1 sesi yang sama), tapi itu bikin
  // isian gak pernah kereset begitu pindah/tutup/buka sesi lain. sphFlow.reset()
  // kosongin dulu di sini, biar sphPrefillFromSession() ngisi ulang FRESH dari
  // sesi yang baru begitu tab SPH dibuka.
  if (window.sphFlow && typeof window.sphFlow.reset === 'function') window.sphFlow.reset();
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
// Nama yang ditampilin buat presence/activity/editing-indicator — pake PIC Marsup
// (lebih manusiawi daripada email), fallback ke email kalau belum diisi.
function currentDisplayName() {
  return (inpMarsup && inpMarsup.value.trim()) || (currentUser && currentUser.email) || 'Anonim';
}
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

let rtConnState = 'offline'; // dipake buat nyusun title tooltip gabungan sama presence
function updateRtStatus(state) {
  // state: 'connecting' | 'live' | 'reconnecting' | 'offline'
  rtConnState = state;
  const dot = document.getElementById('rt-status-dot');
  const wrap = document.getElementById('rt-live');
  if (!dot || !wrap) return;
  wrap.style.display = currentSesiId ? 'flex' : 'none';
  dot.classList.remove('dot-live', 'dot-connecting', 'dot-reconnecting', 'dot-offline');
  dot.classList.add('dot-' + state);
  renderPresenceRoster(); // ikut update tooltip-nya (teks koneksi + daftar nama gabung di situ)
}

function subscribeToSesiRealtime(sesiId) {
  if (!rt || !sesiId) return; // SDK gagal dimuat / gak ada sesi → diam-diam gak aktifin live sync, app tetap jalan manual kayak sebelumnya
  unsubscribeFromSesiRealtime(); // jaga-jaga: jangan sampai numpuk channel dari sesi sebelumnya
  syncRealtimeAuth(); // pastiin token authenticated kepasang tiap kali (re)subscribe, jangan andelin sekali panggil pas login doang
  updateRtStatus('connecting');

  // Item Kebutuhan RS (tabel permintaan_item) SENGAJA gak disubscribe lewat
  // postgres_changes di sini — kena berlapis masalah di setup ini (auth Realtime
  // kepeleset ke anon, kolom filter gak ke-index) dan biarpun udah dibenerin
  // semua tetep gak reliable. Update status item disiarin lewat Broadcast aja
  // (lihat broadcastChecklistItemUpdated/handleChecklistItemUpdatedBroadcast di
  // channel presence bawah), sama pola yang dipakai clipboard.
  const dbChannel = rt.channel(`sesi-db-${sesiId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: SESI_TABLE, filter: `id=eq.${sesiId}` }, handleSesiRowChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: SESI_ITEM_TABLE, filter: `sesi_id=eq.${sesiId}` }, handleItemRowChange);
  sesiDbChannel = dbChannel.subscribe((status) => {
    if (status === 'SUBSCRIBED') updateRtStatus('live');
    else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') updateRtStatus('reconnecting');
    else if (status === 'CLOSED') updateRtStatus('offline');
  });

  const presenceKey = currentUser ? currentUser.id : ('anon-' + Math.random().toString(36).slice(2, 9));
  sesiPresenceChannel = rt.channel(`sesi-presence-${sesiId}`, { config: { presence: { key: presenceKey } } })
    .on('presence', { event: 'sync' }, handlePresenceSync)
    .on('presence', { event: 'join' }, handlePresenceJoin)
    .on('presence', { event: 'leave' }, handlePresenceLeave)
    .on('broadcast', { event: 'item_removed' }, handleItemRemovedBroadcast)
    .on('broadcast', { event: 'checklist_item_updated' }, handleChecklistItemUpdatedBroadcast)
    .on('broadcast', { event: 'editing' }, handleEditingBroadcast)
    .on('broadcast', { event: 'editing_stop' }, handleEditingStopBroadcast)
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        try {
          await sesiPresenceChannel.track({
            nama: currentDisplayName(),
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
      sesiPresenceChannel && sesiPresenceChannel.track({ nama: currentDisplayName(), status: 'away', joined_at: new Date().toISOString() }).catch(() => {});
    }, 30000);
  } else {
    sesiPresenceChannel.track({ nama: currentDisplayName(), status: 'online', joined_at: new Date().toISOString() }).catch(() => {});
    // Tab baru balik kelihatan — jangan andelin TOKEN_REFRESHED (bisa telat/
    // ke-throttle browser pas tab tadi di-background), paksa re-sync token
    // realtime di sini juga biar postgres_changes gak kena filter diam-diam
    // gara-gara token basi (lihat komentar di syncRealtimeAuth()).
    syncRealtimeAuth();
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
  const wrap = document.getElementById('rt-live');
  if (wrap) wrap.style.display = 'none';
  // Badge "sedang mengedit" nempel ke sesi yang lama — bersihin biar gak nyisa
  // pas pindah/buka sesi lain.
  clearInterval(editingBroadcastTimer);
  Object.keys(editingBadgeTimers).forEach(field => {
    clearTimeout(editingBadgeTimers[field]);
    const badge = document.getElementById('editing-badge-' + field);
    if (badge) badge.classList.remove('show');
  });
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
  // Mode harga (E-Katalog/Swasta) ditetapkan pembuat sesi — kolaborator lain harus
  // ikut, bukan mulai dari default lokal masing-masing (lihat COORD LOG di atas).
  if (!!row.mode_harga_swasta !== modeSwastaOutput && !isEchoOfLocalWrite(SESI_TABLE, row.id, 'mode_harga_swasta', row.mode_harga_swasta)) {
    setModeSwastaOutput(!!row.mode_harga_swasta);
    pushActivity(row.mode_harga_swasta ? 'Mode harga diubah ke Swasta oleh kolaborator' : 'Mode harga diubah ke E-Katalog oleh kolaborator');
  }
}

// ---- Handler: baris sesi_konversi_item berubah (isi clipboard) ----
function handleItemRowChange(payload) {
  if (!currentSesiId) return;

  // PENTING soal DELETE: Supabase Postgres Changes SECARA RESMI gak nge-filter
  // event DELETE di server sama sekali (beda dari INSERT/UPDATE) — lihat
  // https://supabase.com/docs/guides/realtime/postgres-changes#delete-events-are-not-filterable
  // Ditambah lagi payload.old default-nya cuma isi primary key (`id`), gak ada
  // sesi_id, jadi filter `row.sesi_id !== currentSesiId` GAK BISA dipakai buat
  // DELETE — bakal selalu gagal match dan diem-diem nge-drop semua delete.
  // Solusinya: DELETE difilter dari sisi client pakai keanggotaan di clipboard
  // LOKAL kita (yang emang udah pasti isinya cuma item sesi ini), bukan dari
  // kolom sesi_id di payload.
  if (payload.eventType === 'DELETE') {
    const row = payload.old;
    if (!row || row.id == null) return;
    const item = clipboard.find(c => c._sesiItemId === row.id);
    if (!item) return; // bukan item sesi ini, atau emang udah kehapus lokal duluan (optimistic)
    const nama = item.nama_produk;
    removeClipItemDom(item.kode_produk);
    pushActivity(`${nama} dihapus`);
    return;
  }

  // INSERT & UPDATE difilter server-side dengan benar (payload.new selalu lengkap),
  // baris di bawah cuma jaga-jaga kalau ada race/event nyasar.
  const row = payload.new;
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
  }
}

// Placeholder ringan buat "siapa yang ngelakuin ini" di activity feed — presence
// gak nyimpen histori per-event, jadi paling akurat yang bisa kita bilang cuma
// "kolaborator" kalau bukan diri sendiri. Upgrade ke nama presisi (butuh kolom
// pengubah di tabel item) masuk tahap activity-feed berikutnya.
function presenceNameGuess() {
  return 'Kolaborator';
}

// ---- Penghapusan item: Broadcast manual, bukan andelin postgres_changes DELETE ----
// LATAR BELAKANG: postgres_changes event DELETE terbukti gak reliable di Supabase
// Realtime buat setup ini — udah dicek satu-satu (publication, RLS, replica identity,
// bahkan SQL DELETE langsung dari SQL Editor) dan semuanya benar, tapi event-nya tetep
// gak pernah nyampe. Ini match sama bug yang udah lama dilaporin di beberapa repo
// Supabase (INSERT/UPDATE jalan, DELETE diem) — bukan salah konfigurasi kita. Makanya
// penghapusan disiarin manual lewat Broadcast (send/on, bukan postgres_changes), yang
// justru direkomendasikan Supabase sendiri buat use-case yang butuh reliability.
function broadcastItemRemoved(item) {
  if (!sesiPresenceChannel) return;
  sesiPresenceChannel.send({
    type: 'broadcast',
    event: 'item_removed',
    payload: { kode_produk: item.kode_produk, sesi_item_id: item._sesiItemId, nama_produk: item.nama_produk, actor: currentDisplayName() }
  }).catch(() => { /* broadcast gagal gak boleh nge-block penghapusan lokal — item ini tetap kehapus di sisi yang ngirim */ });
}
function handleItemRemovedBroadcast({ payload }) {
  if (!payload || !payload.kode_produk) return;
  const item = clipboard.find(c => c.kode_produk === payload.kode_produk);
  if (!item) return; // udah kehapus duluan lokal, atau bukan item sesi ini
  removeClipItemDom(item.kode_produk);
  pushActivity(`${payload.actor ? payload.actor + ' menghapus ' : ''}${payload.nama_produk || item.nama_produk}${payload.actor ? '' : ' dihapus'}`);
}

// ---- Update status item Kebutuhan RS: Broadcast manual, sama kayak pola DELETE
// clipboard di atas ----
// LATAR BELAKANG: postgres_changes buat tabel permintaan_item kena berlapis-lapis
// masalah di setup ini (auth Realtime kepeleset ke anon, kolom filter permintaan_id
// gak ke-index, dst) — daripada terus gantung ke situ, status item disiarin manual
// lewat Broadcast begitu update ke server sukses, persis pola yang udah kebukti
// reliable buat clipboard.
function broadcastChecklistItemUpdated(item) {
  if (!sesiPresenceChannel) return;
  sesiPresenceChannel.send({
    type: 'broadcast',
    event: 'checklist_item_updated',
    payload: { id: item.id, status: item.status, matched_items: item.matched_items || [], raw_text: item.raw_text, actor: currentDisplayName() }
  }).catch(() => { /* broadcast gagal gak boleh nge-block update lokal — item ini tetap keupdate di sisi yang ngirim */ });
}
function handleChecklistItemUpdatedBroadcast({ payload }) {
  if (!payload || payload.id == null) return;
  const item = checklistItems.find(i => i.id === payload.id);
  if (!item) return;
  const statusChanged = payload.status !== item.status;
  patchChecklistItem(payload.id, { status: payload.status, matched_items: payload.matched_items || [] });
  if (statusChanged) {
    const label = payload.status === 'TERPENUHI' ? 'bisa dipenuhi' : payload.status === 'TIDAK_TERPENUHI' ? 'tidak bisa dipenuhi' : 'PENDING lagi';
    const actor = payload.actor ? payload.actor + ' menandai ' : '';
    pushActivity(`${actor}"${payload.raw_text || item.raw_text}" ${label}`);
  }
}

// ---- Activity feed ringan (in-memory, dicap 8 entri terakhir) ----
function pushActivity(msg) {
  rtActivityLog.unshift({ ts: new Date(), msg });
  if (rtActivityLog.length > 8) rtActivityLog.length = 8;
  renderActivityFeed();
}
function renderActivityFeed() {
  const wrap = document.getElementById('rt-feed-wrap');
  const el = document.getElementById('rt-activity-feed');
  const label = document.getElementById('rt-feed-toggle-label');
  if (!wrap || !el) return;
  if (!rtActivityLog.length) { wrap.style.display = 'none'; el.innerHTML = ''; return; }
  wrap.style.display = 'block';
  if (label) label.textContent = `Aktivitas terbaru (${rtActivityLog.length})`;
  el.innerHTML = rtActivityLog.map((a, i) => {
    const hh = String(a.ts.getHours()).padStart(2, '0');
    const mm = String(a.ts.getMinutes()).padStart(2, '0');
    return `<div${i === 0 ? ' class="rt-fade-in"' : ''} style="padding:2px 0">${hh}:${mm} — ${a.msg}</div>`;
  }).join('');
}
document.getElementById('rt-feed-toggle').addEventListener('click', () => {
  document.getElementById('rt-feed-wrap').classList.toggle('rt-feed-collapsed');
});

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
const RT_AVATAR_PALETTE = ['#e5484d', '#f76b15', '#ffb224', '#46a758', '#12a594', '#0091ff', '#8e4ec6', '#e93d82'];
function avatarColorFor(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return RT_AVATAR_PALETTE[hash % RT_AVATAR_PALETTE.length];
}
function initialsFor(nama) {
  const parts = nama.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
const RT_STATUS_LABELS = { connecting: 'Menyambungkan…', live: 'Live', reconnecting: 'Menyambung ulang…', offline: 'Offline' };
function renderPresenceRoster() {
  const wrap = document.getElementById('rt-live');
  const cluster = document.getElementById('rt-avatar-cluster');
  if (!wrap || !cluster) return;
  const entries = Object.values(presenceRoster).filter(p => p.nama);
  const MAX_SHOWN = 4;
  const shown = entries.slice(0, MAX_SHOWN);
  const overflow = entries.length - shown.length;
  cluster.innerHTML = shown.map(p => {
    const awayCls = p.status === 'away' ? ' away' : '';
    return `<span class="rt-avatar${awayCls}" style="background:${avatarColorFor(p.nama)}">${initialsFor(p.nama)}</span>`;
  }).join('') + (overflow > 0 ? `<span class="rt-avatar-more">+${overflow}</span>` : '');
  const names = entries.map(p => p.nama + (p.status === 'away' ? ' (away)' : ''));
  wrap.title = (names.length ? names.join(', ') : 'Cuma kamu di sesi ini') + ' — ' + (RT_STATUS_LABELS[rtConnState] || '');
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
        'Authorization': 'Bearer ' + (await getFreshToken())
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
    // ASUMSI: field 'tanggal' ada di hasil RPC ini (sama kayak p_tanggal pas submit).
    // Kalau ternyata undefined terus (cek console: `checklistTanggal` selalu null padahal
    // Permintaan RS jelas ada), berarti RPC get_permintaan_by_sesi di server belum
    // nge-return kolom ini — perlu ditambahin di definisi function-nya di Supabase.
    checklistTanggal = data.tanggal || null;
    // Buka otomatis requirement PENDING pertama, biar langsung ada yang bisa
    // dikerjain begitu Kebutuhan RS ini tampil — bukan daftar kolaps semua.
    const firstPending = checklistItems.find(i => i.status === 'PENDING');
    checklistExpandedId = firstPending ? firstPending.id : null;

    kbSection.classList.remove('kb-collapsed');
    kbRecordStatus.textContent = 'Tingkat pemenuhan tersimpan otomatis tiap item ditandai.';
    kbRefreshStatus.textContent = 'Diperbarui ✓ ' + new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    renderChecklist();
    maybeFetchSuggestionForExpanded();
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
  // SECURITY FIX 2026-08-14: input ini diketik langsung oleh user (bukan dari
  // DB), tapi tetap wajib di-escape sebelum innerHTML — kalau enggak, orang
  // yang isi field ini bisa nginjek script yang jalan di browsernya sendiri
  // (dan kalau field ini ke-sync/keliatan kolaborator lain via Realtime,
  // jalan juga di browser mereka).
  clipHeaderCompact.innerHTML = `<b>${escapeHtmlAttr(rs)}</b>${sales ? ' · Sales: ' + escapeHtmlAttr(sales) : ''}${marsup ? ' · PIC: ' + escapeHtmlAttr(marsup) : ''}`;
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

// AUTOCOMPLETE — reuses lastResults from runSearch, no separate API call needed.
// Dikurangin dari 6 ke 4 item: dropdown ini ngambang di atas list produk yang
// sebenarnya udah kelihatan di bawahnya, jadi makin sedikit & padat makin gak
// berasa nutup-nutupin — 4 quick-pick tercepat udah cukup, sisanya toh masih
// kebaca lewat scroll di list produk itu sendiri. (lihat juga max-height di
// pnm-konversian-rebase.css yang dikunci senada sama jumlah ini)
function renderAutocomplete(data) {
  if (!searchInput.value.trim() || !data || !data.length) {
    acBox.style.display = 'none'; acItems = []; acIndex = -1; return;
  }
  acItems = data.slice(0, 4);
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
    // SECURITY FIX 2026-08-14: konsisten dengan renderClipItemHtml — escape
    // nama_produk sebelum masuk innerHTML (defense in depth).
    return `<div class="rcard${inClip?' selected':''}" data-kode="${r.kode_produk}">
      <div class="rcard-top">
        <span class="rcard-name">${escapeHtmlAttr(r.nama_produk||'—')}</span>
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
          <button class="btn-lampiran" data-kode="${r.kode_produk}" data-is-set="${isSet}" style="font-size:11px;color:var(--accent-text);background:var(--accent-bg);border:1px solid var(--accent-text);border-radius:20px;padding:2px 8px;display:flex;align-items:center;gap:4px;cursor:pointer"><i class="ti ti-file-text" style="font-size:12px"></i> Lihat Lampiran</button>
          <button class="btn-edit-produk" data-kode="${r.kode_produk}" title="Edit produk ini" style="font-size:11px;color:var(--text-secondary);background:var(--surface-2);border:1px solid var(--border-strong);border-radius:20px;padding:2px 8px;display:flex;align-items:center;gap:4px;cursor:pointer"><i class="ti ti-settings" style="font-size:12px"></i></button>
          ${inClip
            ? `<button class="btn-clip-toggle in-clip" data-kode="${r.kode_produk}" data-action="remove"><i class="ti ti-circle-check" style="font-size:12px"></i> Di Konversi</button>`
            : `<button class="btn-clip-toggle" data-kode="${r.kode_produk}" data-action="add"><i class="ti ti-circle-plus" style="font-size:12px"></i> Tambahkan ke Konversi</button>`}
        </div>
      </div>
    </div>`;
  }).join('');
  // Card body SENGAJA gak punya click listener lagi (dulu klik di mana aja
  // langsung commit ke Konversi/bikin row database — lihat diskusi rebase UI).
  // Cari Cepat sekarang murni baca: lihat, Copy, atau eksplisit "Tambahkan ke
  // Konversi" lewat tombol di bawah ini, gak ada jalan lain yang nulis ke server.
  resultsEl.querySelectorAll('.btn-clip-toggle').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleClipToggleClick(btn.dataset.kode, btn.dataset.action);
    });
  });
  resultsEl.querySelectorAll('.btn-edit-produk').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      navigateToEditProduk(btn.dataset.kode);
    });
  });
  resultsEl.querySelectorAll('.btn-lampiran').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openLampiranModal(btn.dataset.kode, btn.dataset.isSet === 'true');
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
// Satu-satunya jalan masuk dari Cari Cepat yang boleh nulis ke database — dipicu
// CUMA dari klik eksplisit tombol "Tambahkan ke Konversi" (lihat renderResults),
// gak pernah dari klik kartu. Kalau belum ada sesi jalan, konfirmasi dulu biar
// bikin row sesi_konversi itu keputusan sadar, bukan efek samping diam-diam.
async function handleClipToggleClick(kode, action) {
  if (action === 'remove') { removeFromClip(kode); return; }
  const isFirstCommit = !currentSesiId; // ini yang nentuin apa perlu konfirmasi DAN apa perlu eskalasi pintu
  if (isFirstCommit) {
    const ok = await showConfirmModal({
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
  if (isFirstCommit && typeof switchDoor === 'function') switchDoor('konversi');
}

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
    const h = modeSwastaOutput ? item.harga_swasta : item.harga_ekat;
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
  const hargaTampil = modeSwastaOutput ? item.harga_swasta : item.harga_ekat;
  const totalHarga = hargaTampil ? hargaTampil * item.qty : null;
  // SECURITY FIX 2026-08-14: nama_produk ditampilin mentah — escape jaga-jaga
  // (produk-produk ini biasa dari katalog terkontrol, tapi tetap defense in
  // depth kalau ada nama produk yang mengandung karakter HTML).
  return `<div class="clip-item" data-kode="${item.kode_produk}">
      <div class="clip-item-info">
        <div class="clip-item-name">${escapeHtmlAttr(item.nama_produk)}</div>
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

// ── SIMPAN KE DRIVE (manual, lewat tombol — bukan otomatis pas Export) ──
// Export ke Excel cuma nyiapin file + download lokal seperti biasa. Blob hasil
// export terakhir disimpan di sini, biar tombol "Simpan ke Drive" (terpisah,
// diklik kapan aja setelah export) bisa reupload tanpa nge-generate ulang file.
let lastExportBlob = null;
let lastExportFilename = null;
let lastExportNamaSales = null;
// Link Drive terakhir yang beneran didapat dari upload sukses (result.fileUrl),
// buat auto-fill #rec-link pas modal Record dibuka — sebelumnya link ini cuma
// nyampe ke modal sukses convFlow (visual doang), gak pernah ditulis balik ke
// field record-nya, jadi openRecordModal() nge-reset ke kosong lagi. Direset
// balik ke null di resetChecklistUI() tiap kali sesi ganti/dibuka ulang.
let lastDriveUrl = null;
const btnDriveUpload = document.getElementById('btn-drive-upload');

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
    const uploadToken = await getFreshToken();
    if (!uploadToken || uploadToken === ANON_KEY) throw new Error('Sesi login sudah habis / belum login — silakan login ulang dulu.');
    const res = await fetch(DRIVE_PROXY_URL, {
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
      lastDriveUrl = result.fileUrl;
      if (recLink) recLink.value = result.fileUrl;
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
    if (!lastExportBlob) {
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
    if (!checklistPermintaanId || !checklistTanggal) {
      const msg = 'Sesi ini belum ada Permintaan RS (atau tanggalnya belum tercatat) — isi Permintaan RS dulu, baru bisa simpan ke Drive.';
      showToast(msg, 'error');
      if (window.convFlow) setTimeout(() => window.convFlow.showError('drive', msg), 0);
      return;
    }
    const tahunFolder = new Date(checklistTanggal).getFullYear();
    btnDriveUpload.disabled = true;
    try {
      await uploadKonversianToDrive(lastExportBlob, lastExportFilename, tahunFolder, lastExportNamaSales);
    } finally {
      btnDriveUpload.disabled = false;
    }
  });
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

  const filename = `CONVERTED${modeSwastaOutput?'-SWASTA':''}-${namaSales.replace(/[^a-zA-Z0-9 ]/g,'').trim()}-${namaRs.replace(/[^a-zA-Z0-9 ]/g,'').trim()}-${tanggal}${revSuffix}.xlsx`;

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
    const sumHeaders = modeSwastaOutput
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
    wsSummary.columns = modeSwastaOutput
      ? [{width:5},{width:24},{width:50},{width:8},{width:18},{width:18},{width:14}]
      : [{width:5},{width:24},{width:50},{width:8},{width:18},{width:18},{width:45},{width:14}];

    let sumRow = 8;
    let grandTotal = 0;
    const stokColIdx = modeSwastaOutput ? 7 : 8;
    clipboard.forEach((item, idx) => {
      const row = wsSummary.getRow(sumRow);
      const hargaPakai = modeSwastaOutput ? (item.harga_swasta || 0) : (item.harga_ekat || 0);
      const total = hargaPakai * (item.qty || 1);
      grandTotal += total;
      row.getCell(1).value = idx + 1;
      row.getCell(2).value = item.kode_produk;
      row.getCell(3).value = item.nama_produk;
      row.getCell(4).value = item.qty || 1;
      row.getCell(5).value = hargaPakai || '';
      row.getCell(6).value = total || '';
      if (!modeSwastaOutput && item.link_v6) {
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
      const zebraCount = modeSwastaOutput ? 7 : 8;
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
          const hargaSatuan = modeSwastaOutput ? (m.harga_swasta || 0) : (m.harga_ekat || 0);
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
        row.getCell(6).value = matchedList.length === 1 ? (modeSwastaOutput ? (matchedList[0].harga_swasta||0) : (matchedList[0].harga_ekat||0)) : '';
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
          lampiranResults[idx] = await getLampiranPagesForKode(lampiranCandidates[idx].kode_produk);
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
    lastExportBlob = blob;
    lastExportFilename = filename;
    lastExportNamaSales = namaSales;
    if (btnDriveUpload) btnDriveUpload.disabled = false;

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
  modeSwastaOutput = swasta;
  if (comEkatBtn) comEkatBtn.classList.toggle('active', !swasta);
  if (comSwastaBtn) comSwastaBtn.classList.toggle('active', swasta);
  updateClipboard(); // re-render daftar clipboard + total/pagu pakai mode baru
}
async function persistModeSwastaOutput(swasta) {
  setModeSwastaOutput(swasta);
  try {
    const sesiId = await ensureSesi();
    markLocalWrite(SESI_TABLE, sesiId, 'mode_harga_swasta', swasta);
    await sesiFetch(`${SESI_TABLE}?id=eq.${sesiId}`, {
      method: 'PATCH',
      body: JSON.stringify({ mode_harga_swasta: swasta, updated_at: new Date().toISOString() })
    });
  } catch (err) {
    console.error('Gagal simpan mode harga ke server', err);
    showToast('Mode harga ganti di layar ini, tapi gagal kesimpen ke server — kolaborator lain belum ikut kesinkron. Coba lagi.', 'error');
  }
}
if (comEkatBtn) comEkatBtn.addEventListener('click', () => persistModeSwastaOutput(false));
if (comSwastaBtn) comSwastaBtn.addEventListener('click', () => persistModeSwastaOutput(true));
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

// SECURITY FIX 2026-08-14: dulu manggil GAS_WEBHOOK_URL langsung dari
// browser tanpa proteksi apapun (bukan cuma token doang yang gak ada — URL
// Apps Script-nya sendiri jadi satu-satunya "kunci", padahal itu keliatan
// telanjang di bundle JS publik). Sekarang lewat Edge Function
// sheets-webhook-proxy, yang wajib verify JWT user login dulu sebelum
// nembak ke Apps Script — orang yang gak login gak bisa nyuntik baris palsu
// ke Sheet lagi. URL Apps Script asli sekarang cuma disimpan di server
// (Supabase secret), gak pernah nyampe ke client.
const SHEETS_PROXY_URL = `${SUPABASE_URL}/functions/v1/sheets-webhook-proxy`;

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
    const hargaPakai = modeSwastaOutput ? (item.harga_swasta || 0) : (item.harga_ekat || 0);
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
  // Auto-filled dari link Drive sesi ini kalau udah pernah diupload (lihat
  // uploadKonversianToDrive) — JANGAN di-reset ke kosong, itu bikin link yang
  // baru aja didapat ilang lagi pas modal ini dibuka.
  recLink.value = lastDriveUrl || '';
  recordStatus.textContent = '';
  recordStatus.style.color = '';
  recordSubmitBtn.disabled = false;
  recordSubmitBtn.textContent = 'Kirim ke Sheet';
  recordSubmitBtn.dataset.retryRecordId = ''; // sesi/record baru — pastiin gak kebawa retry ID lama

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

  // ── FIX bug lama: "Coba Sync ke Sheet Lagi" dulu selalu lari ulang dari
  // Tahap 1, jadi tiap klik retry bikin konversi_record + konversi_item
  // BARU (duplikat), padahal cuma Tahap 2 (Sheet) yang gagal. Sekarang:
  // kalau retryRecordId udah keisi (dari kegagalan Tahap 2 sebelumnya),
  // Tahap 1 di-SKIP total — reuse ID lama, langsung lanjut Tahap 2 aja. ──
  const retryRecordId = recordSubmitBtn.dataset.retryRecordId || '';
  let newRecordId = retryRecordId || null;

  if (!retryRecordId) {
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
      const hargaPakai = modeSwastaOutput ? (item.harga_swasta || 0) : (item.harga_ekat || 0);
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
  } else {
    // Retry: Tahap 1 udah pernah sukses (record id: newRecordId), langsung
    // lompat ke Tahap 2 tanpa insert apa pun lagi.
    recordStatus.textContent = 'Menyinkronkan ulang ke Sheet…';
    recordStatus.style.color = 'var(--success)';
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
    link: recLink.value.trim(),
    // Idempotency key buat dedupe di sisi Apps Script (lihat RecordKonversi.gs).
    // newRecordId STABIL di seluruh percobaan retry sesi ini — "Coba Sync ke
    // Sheet Lagi" reuse ID yang sama, gak pernah insert record baru ke
    // Supabase (lihat retryRecordId di atas), jadi aman dipakai buat nyocokin
    // "request ini udah pernah beneran nyampe & keproses di Sheet apa belum".
    record_id: newRecordId || null
  };

  try {
    const uploadToken = await getFreshToken();
    if (!uploadToken || uploadToken === ANON_KEY) throw new Error('Sesi login sudah habis / belum login — silakan login ulang dulu.');
    const res = await fetch(SHEETS_PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + uploadToken
      },
      body: JSON.stringify({ target: 'konversi', data: sheetPayload })
    });
    // Apps Script kadang balikin halaman HTML (bukan JSON) walau row-nya SUDAH
    // kesimpen di Sheet — biasanya karena ada kode SETELAH appendRow() di
    // doPost yang throw exception gak ke-catch, jadi Google keburu ngasih
    // halaman error bawaan sebelum sempat return JSON. Makanya res.json()
    // langsung dipanggil bisa gagal padahal datanya udah nyangkut. Baca
    // sebagai text dulu biar bisa kasih pesan yang jujur soal ini, bukan
    // "Unexpected token" yang bikin orang kira datanya ilang.
    const rawText = await res.text();
    let result;
    try {
      result = JSON.parse(rawText);
    } catch {
      const looksLikeHtml = /^\s*<(!doctype|html)/i.test(rawText);
      throw new Error(
        (looksLikeHtml
          ? 'Apps Script balikin halaman HTML, bukan JSON (kemungkinan besar ada error di script SETELAH baris tersimpan — cek Apps Script > Executions buat lihat detail errornya).'
          : 'Respons Apps Script gak valid: ' + rawText.slice(0, 120))
        + ' PENTING: baris ini kemungkinan SUDAH masuk ke Sheet meski response-nya error — cek Sheet dulu sebelum klik "Coba Sync ke Sheet Lagi", biar gak ke-duplikat.'
      );
    }
    if (!result.ok) throw new Error(result.error || 'Gagal menyimpan ke sheet');

    if (newRecordId) {
      sesiFetch(`konversi_record?id=eq.${newRecordId}`, {
        method: 'PATCH',
        body: JSON.stringify({ synced_to_sheet: true })
      }).catch(() => {});
    }

    recordStatus.textContent = 'Berhasil dicatat & disinkronkan ke Sheet ✓';
    recordStatus.style.color = 'var(--success)';
    recordSubmitBtn.dataset.retryRecordId = '';
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
    const res = await sesiFetch(`v_stok_status?kode_asli=in.(${inList})&select=kode_asli,qty,status`);
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
    const res = await sesiFetch(`v_stok_status_set?kode_produk=in.(${inList})&select=kode_produk,buildable_qty,status,jumlah_komponen,jumlah_komponen_terdata`);
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
      const { data, error } = await rpc('search_produk_dengan_harga', { q: kode, p_tipe: null, only_akd: false, only_kfa: false });
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
    // Konsisten sama "+ Tambahkan ke Konversi" di Cari Cepat dan submit Permintaan
    // RS: kalau ini bakal jadi sesi PERTAMA, konfirmasi dulu.
    if (!currentSesiId) {
      const ok = await showConfirmModal({
        title: 'Mulai Konversi Baru?',
        text: 'Produk-produk terpilih bakal masuk ke sesi konversi baru.',
        okText: 'Ya, Mulai Konversi'
      });
      if (!ok) { btnConvAddAll.disabled = false; return; }
    }
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

async function openPrModal() {
  prStatusMsg.textContent = '';
  prTeksFromOcr = false;
  prShowTab('teks');
  reviewItems = [];
  prReviewWrap.style.display = 'none';
  prFormWrap.style.display = '';
  if (!prTanggal.value) prTanggal.value = new Date().toISOString().slice(0,10);

  // Satu login di gerbang awal sudah cukup — kalau token expired, balik ke gerbang.
  // Pakai getFreshToken() (bukan baca stokAccessToken langsung) biar gak salah
  // nendang ke login gara-gara token cache basi padahal sebenarnya masih bisa direfresh.
  const prModalToken = await getFreshToken();
  if (!prModalToken || prModalToken === ANON_KEY) {
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
    // Sama kayak "+ Tambahkan ke Konversi" di Cari Cepat: kalau ini bakal jadi
    // sesi PERTAMA, konfirmasi dulu biar bikin row sesi_konversi itu keputusan
    // sadar, bukan efek samping submit form.
    const isFirstCommit = !currentSesiId;
    if (isFirstCommit) {
      const ok = await showConfirmModal({
        title: 'Mulai Konversi Baru?',
        text: 'Permintaan RS ini bakal disimpan ke sesi konversi baru.',
        okText: 'Ya, Mulai Konversi'
      });
      if (!ok) return; // finally di bawah tetap jalan, ngebalikin tombol ke state semula
    }
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
        'Authorization': 'Bearer ' + (await getFreshToken())
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

    startChecklistSession(result, prNamaRs.value.trim(), prPicSales.value.trim(), parsePaguValue(prPagu.value), prTanggal.value || null);
    closePrModal();
    if (typeof switchDoor === 'function') switchDoor('konversi');

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
var checklistTanggal = null; // dipakai buat nentuin folder tahun di Drive — diisi loadChecklistForSesi()
var checklistPickingId = null; // id item yang lagi nampilin dropdown pilih produk (null = gak ada)
// Accordion master-detail: cuma SATU requirement yang "kebuka" nunjukin detail
// penuh dalam satu waktu, sisanya nyusut jadi baris ringkas — biar kerasa kayak
// fokus per-requirement, bukan 20-50 baris yang semuanya "berteriak" bareng.
var checklistExpandedId = null;
// Abis 1 requirement diputusin (bisa/tidak), otomatis buka yang PENDING
// berikutnya — biar alur kerja "putusin, lanjut, putusin, lanjut" gak perlu
// klik cari-cari baris berikutnya manual tiap kali.
function advanceToNextPending(afterId) {
  const idx = checklistItems.findIndex(i => i.id === afterId);
  for (let i = idx + 1; i < checklistItems.length; i++) {
    if (checklistItems[i].status === 'PENDING') return checklistItems[i].id;
  }
  for (let i = 0; i < idx; i++) { // muter dari awal, jaga-jaga ada yang kelewat di atas
    if (checklistItems[i].status === 'PENDING') return checklistItems[i].id;
  }
  return null; // udah gak ada yang PENDING lagi
}

// Fast-path "tandai TERPENUHI pakai 1 produk spesifik" — dipake bareng sama
// action 'use-suggestion' (produk udah ada di Clipboard) dan 'attach-suggestion'
// (produk baru aja ditambahin ke Clipboard). Satu titik biar dua jalur itu gak
// duplikasi logic konfirmasi status.
async function markItemTerpenuhiWithSingleProduk(item, kode) {
  const itemId = item.id;
  try {
    markLocalWrite(PERMINTAAN_ITEM_TABLE, itemId, 'status', 'TERPENUHI');
    const links = [{ produk_id: null, kode_produk: kode, qty_alokasi: null }];
    await callUpdatePermintaanItemMulti(itemId, 'TERPENUHI', links);
    item.status = 'TERPENUHI';
    item.matched_items = links;
    checklistExpandedId = advanceToNextPending(itemId);
    renderChecklist();
    maybeFetchSuggestionForExpanded();
    broadcastChecklistItemUpdated(item);
    autoFinalizePermintaan();
  } catch (err) {
    showToast('Gagal update: ' + err.message, 'error');
    renderChecklist();
  }
}

// ══════════════════════════════════════════
// SARAN DICTIONARY INLINE — "organizational memory" muncul pas lagi ngerjain
// satu requirement, bukan jadi tab terpisah yang harus disambangin. Berkat
// accordion, paling banyak cuma SATU item yang expanded dalam satu waktu, jadi
// paling banyak cuma 1 pasang RPC call yang jalan bersamaan (bukan N+1 buat
// 20-50 item sekaligus) — di-cache per item.id biar gak nembak ulang tiap
// buka-tutup baris yang sama.
// ══════════════════════════════════════════
const dictSuggestionCache = {}; // item.id -> {loading, istilah, status, produk} | null (null = udah dicek, gak ada saran)
async function fetchDictSuggestionFor(item) {
  if (dictSuggestionCache[item.id] !== undefined) return; // udah pernah dicek (ada hasil ATAU emang null)
  dictSuggestionCache[item.id] = { loading: true };
  try {
    const { data: summaryRows, error: summaryErr } = await rpc('get_dictionary_summary', {
      // Value parameter ini HARUS sama persis kayak yang dipake tab Dictionary
      // asli (lihat #dict-filter-select/#dict-sort-select) — 'semua'/'frekuensi',
      // bukan 'all'/'freq_desc'. Nilai enum yang salah bikin RPC gagal, dan
      // gagalnya gak keliatan kalau cuma ngecek `data` doang tanpa cek `error`.
      p_search: item.raw_text, p_filter: 'semua', p_sort: 'frekuensi', p_limit: 1, p_offset: 0
    });
    if (summaryErr) throw new Error(summaryErr.message || summaryErr.hint || 'get_dictionary_summary gagal');
    const top = summaryRows && summaryRows[0];
    if (!top) { dictSuggestionCache[item.id] = null; }
    else {
      const { data: detailRows, error: detailErr } = await rpc('get_dictionary_detail', { p_istilah: top.istilah_customer });
      if (detailErr) throw new Error(detailErr.message || detailErr.hint || 'get_dictionary_detail gagal');
      dictSuggestionCache[item.id] = {
        loading: false,
        istilah: top.istilah_customer,
        status: top.status,
        produk: (detailRows || []).slice(0, 3) // paling banyak 3 baris teratas, ini sinyal kontekstual bukan halaman browse penuh
      };
    }
  } catch (err) {
    console.error('Gagal ambil saran Dictionary buat "' + item.raw_text + '":', err);
    dictSuggestionCache[item.id] = null; // gagal fetch = anggap gak ada saran, jangan block UI checklist-nya — tapi errornya sekarang keliatan di console
  }
  // Item ini mungkin masih expanded pas fetch selesai — patch biar sarannya muncul.
  // Kalau user udah pindah ke item lain, patchChecklistItem no-op aman aja.
  if (checklistExpandedId === item.id) patchChecklistItem(item.id, {});
}
// Dipanggil abis checklistExpandedId ganti (toggle manual, auto-advance, atau
// default pas checklist pertama kali dimuat) — satu titik konsisten biar gak
// keulang nulis pengecekan yang sama di banyak tempat.
function maybeFetchSuggestionForExpanded() {
  if (!checklistExpandedId) return;
  const it = checklistItems.find(i => i.id === checklistExpandedId);
  if (it && it.status === 'PENDING') fetchDictSuggestionFor(it);
}

function startChecklistSession(submitResult, namaRs, picSales, pagu, tanggal) {
  checklistItems = Array.isArray(submitResult.items) ? submitResult.items : [];
  checklistItems.forEach(it => { it.matched_items = normalizeMatchedItems(it); });
  checklistNamaRs = namaRs || '(tanpa nama RS)';
  checklistSales = picSales || '(tanpa nama sales)';
  checklistPagu = (pagu === undefined) ? null : pagu;
  checklistPermintaanId = submitResult.permintaan_id;
  // BUGFIX: dulu checklistTanggal gak pernah di-set di sini (cuma di-set di
  // loadChecklistForSesi buat sesi yang DIBUKA ULANG), jadi begitu Permintaan
  // RS BARU disubmit, tombol "Simpan ke Drive" langsung nganggep sesi ini
  // "belum ada Permintaan RS" walau permintaan_id-nya jelas keisi — soalnya
  // pengecekannya butuh checklistTanggal juga (lihat listener btnDriveUpload),
  // bukan cuma checklistPermintaanId. Sekarang diisi dari tanggal yang barusan
  // disubmit di form (prTanggal.value), fallback ke submitResult.tanggal kalau
  // RPC submit_permintaan_rs ternyata ikut mengembalikannya.
  checklistTanggal = tanggal || submitResult.tanggal || null;
  // Sama kayak loadChecklistForSesi: buka otomatis requirement PENDING pertama.
  const firstPending = checklistItems.find(i => i.status === 'PENDING');
  checklistExpandedId = firstPending ? firstPending.id : null;

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
  maybeFetchSuggestionForExpanded();
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

function updateKbCounts() {
  const pending = checklistItems.filter(i => i.status === 'PENDING').length;
  const done = checklistItems.filter(i => i.status === 'TERPENUHI').length;
  const na = checklistItems.filter(i => i.status === 'TIDAK_TERPENUHI').length;
  kbTitle.textContent = 'Kebutuhan RS';
  kbCount.textContent = `${pending} belum dicek · ${done} bisa dipenuhi · ${na} tidak bisa`;
  updateKbTabState();
  updateClipSummaryStrip();
}

// Template satu baris Kebutuhan RS — dipakai render awal (renderChecklist) MAUPUN
// patch realtime (patchChecklistItem), biar markup-nya gak dobel definisi.
function renderChecklistItemHtml(item) {
  const isPending = item.status === 'PENDING';
  const isDone = item.status === 'TERPENUHI';
  const isNa = item.status === 'TIDAK_TERPENUHI';
  const isPicking = checklistPickingId === item.id;
  // Picker butuh ruang penuh buat checkbox-list-nya, jadi kalau lagi milih
  // produk, item ini otomatis kebuka juga — gak masuk akal ada picker di
  // dalam baris yang keciutin.
  const isExpanded = isPicking || checklistExpandedId === item.id;
  const cls = (isDone ? 'terpenuhi' : isNa ? 'tidak-terpenuhi' : '') + (isExpanded ? ' expanded' : ' collapsed');

  const qtyTxt = item.qty_diminta ? ` · qty ${item.qty_diminta}` : '';
  const paguTxt = item.pagu_satuan != null ? ` · pagu satuan ${rupiah(item.pagu_satuan)}` : '';

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
      <div class="kb-item-text">${escapeHtmlAttr(item.raw_text)}${qtyTxt}${paguTxt}</div>
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
      const sugg = dictSuggestionCache[item.id];
      let suggHtml = '';
      if (sugg === undefined) {
        suggHtml = ''; // belum sempat di-fetch (harusnya sebentar doang, di-trigger bareng expand)
      } else if (sugg && sugg.loading) {
        suggHtml = `<div class="kb-dict-suggestion loading">Ngecek riwayat pemakaian…</div>`;
      } else if (sugg && sugg.produk && sugg.produk.length) {
        const badgeCls = sugg.status === 'MULTIPLE' ? 'multiple' : 'consistent';
        const rows = sugg.produk.map(p => {
          const inClip = clipboard.some(c => c.kode_produk === p.kode_produk);
          return `<div class="kb-dict-sugg-row">
            <div class="kb-dict-sugg-info">
              <span class="kb-dict-sugg-nama">${escapeHtmlAttr(p.nama_produk || p.kode_produk)}</span>
              <span class="kb-dict-sugg-freq">${Number(p.jumlah_pemakaian).toLocaleString('id-ID')}× dipakai${p.persentase != null ? ' · ' + p.persentase + '%' : ''}</span>
            </div>
            ${inClip
              ? `<button class="kb-dict-sugg-use" data-action="use-suggestion" data-id="${item.id}" data-kode="${p.kode_produk}">Pakai</button>`
              : `<button class="kb-dict-sugg-attach" data-action="attach-suggestion" data-id="${item.id}" data-kode="${p.kode_produk}" title="Belum ada di Clipboard sesi ini — tambahin dulu">+ Tambah & Pakai</button>`}
          </div>`;
        }).join('');
        suggHtml = `<div class="kb-dict-suggestion">
          <div class="kb-dict-suggestion-label"><i class="ti ti-history"></i> Biasa dipakai buat "${escapeHtmlAttr(sugg.istilah)}" <span class="dict-badge ${badgeCls}" style="font-size:9px;padding:1px 5px">${sugg.status}</span></div>
          ${rows}
        </div>`;
      }
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

  return `<div class="kb-item ${cls}" data-id="${item.id}">
    ${headerHtml}
    ${detailHtml}
  </div>`;
}

function renderChecklist() {
  updateKbCounts();

  // SECURITY FIX 2026-08-14: checklistNamaRs juga free-text, escape dulu.
  kbSummary.innerHTML = `
    <div class="kb-summary-row"><span>Nama RS</span><b>${escapeHtmlAttr(checklistNamaRs || '-')}</b></div>
    <div class="kb-summary-row"><span>Pagu</span><b>${checklistPagu != null ? rupiah(checklistPagu) : '-'}</b></div>
  `;

  kbList.innerHTML = checklistItems.map(renderChecklistItemHtml).join('');
}

// ---- Patch granular buat 1 item Kebutuhan RS (dipakai realtime UPDATE dari
// kolaborator lain) — gak nge-rebuild seluruh daftar kayak renderChecklist(). ----
function patchChecklistItem(id, changes) {
  const item = checklistItems.find(i => i.id === id);
  if (!item) return;
  if (checklistPickingId === id) return; // lagi dipilihin produknya sama user lokal, jangan diganggu dulu
  Object.assign(item, changes);
  updateKbCounts();
  const node = kbList.querySelector(`.kb-item[data-id="${CSS.escape(String(id))}"]`);
  if (node) {
    const temp = document.createElement('div');
    temp.innerHTML = renderChecklistItemHtml(item);
    const newNode = temp.firstElementChild;
    newNode.classList.add('rt-pulse');
    node.replaceWith(newNode);
  } else {
    renderChecklist(); // fallback aman kalau node-nya gak ketemu (harusnya jarang)
  }
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
  const header = e.target.closest('.kb-item-header[data-action]');
  const el = link || btn || header;
  if (!el) return;
  const itemId = parseInt(el.dataset.id, 10);
  const action = el.dataset.action;
  const item = checklistItems.find(i => i.id === itemId);
  if (!item) return;

  if (action === 'toggle-expand') {
    // Kalau lagi milih produk (picker kebuka), jangan biarin ke-collapse cuma
    // gara-gara klik header-nya sendiri — user harus Batal/Konfirmasi dulu.
    if (checklistPickingId === itemId) return;
    checklistExpandedId = (checklistExpandedId === itemId) ? null : itemId;
    renderChecklist();
    maybeFetchSuggestionForExpanded();
    return;
  }

  if (action === 'use-suggestion') {
    // Fast-path dari saran Dictionary: langsung tandai TERPENUHI pakai produk
    // yang disaranin, TANPA buka picker — cuma valid kalau produknya emang
    // udah ada di Clipboard sesi ini (dicek dobel di sini, bukan cuma percaya
    // tombolnya beneran ke-render dengan benar).
    const kode = el.dataset.kode;
    if (!clipboard.some(c => c.kode_produk === kode)) return;
    btn.disabled = true;
    await markItemTerpenuhiWithSingleProduk(item, kode);
    return;
  }

  if (action === 'attach-suggestion') {
    // Sama kayak "Pakai", tapi produknya belum ada di Clipboard — tambahin dulu
    // (reuse addSetKodeToClip yang udah dipakai tab Cari SET buat kasus yang
    // sama persis: cari exact by kode_produk, masukin ke lastResults, addToClip
    // — fungsi itu juga yang ngurus disabled/text state tombolnya sendiri),
    // baru abis itu jalanin fast-path yang sama kayak "Pakai".
    const kode = el.dataset.kode;
    await addSetKodeToClip(kode, btn);
    if (!clipboard.some(c => c.kode_produk === kode)) return; // gagal, addSetKodeToClip udah nampilin toast errornya
    await markItemTerpenuhiWithSingleProduk(item, kode);
    return;
  }

  if (action === 'bisa' || action === 'change') {
    // Buka mode pilih produk, belum manggil API sama sekali.
    checklistPickingId = itemId;
    checklistExpandedId = itemId;
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
      markLocalWrite(PERMINTAAN_ITEM_TABLE, itemId, 'status', 'TERPENUHI');
      await callUpdatePermintaanItemMulti(itemId, 'TERPENUHI', links);
      item.status = 'TERPENUHI';
      item.matched_items = links;
      checklistPickingId = null;
      checklistExpandedId = advanceToNextPending(itemId); // langsung buka yang PENDING berikutnya
      renderChecklist();
      maybeFetchSuggestionForExpanded();
      broadcastChecklistItemUpdated(item);
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
      markLocalWrite(PERMINTAAN_ITEM_TABLE, itemId, 'status', 'TIDAK_TERPENUHI');
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
      checklistExpandedId = advanceToNextPending(itemId);
      renderChecklist();
      maybeFetchSuggestionForExpanded();
      broadcastChecklistItemUpdated(item);
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
      markLocalWrite(PERMINTAAN_ITEM_TABLE, itemId, 'status', 'PENDING');
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
      broadcastChecklistItemUpdated(item);
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
        'Authorization': 'Bearer ' + (await getFreshToken())
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
// pencarian produk dulu — cari by kode_produk persis lewat
// findProdukByKodeExact() (shared sama modul Converter, lihat komentarnya).
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
    const { produk: match, errMsg } = await findProdukByKodeExact(kode);
    if (errMsg) throw new Error(errMsg);
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
      'Authorization': 'Bearer ' + (await getFreshToken())
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
        + '<td style="padding:6px 8px;border-bottom:1px solid var(--border);word-break:break-all"><a href="' + esc(r.link) + '" target="_blank" rel="noopener noreferrer" style="color:var(--accent-text)">' + esc(r.link) + '</a></td></tr>';
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