// shared/auth-session.js
// ══════════════════════════════════════════
// Wrapper tipis di atas window.pnmSupabase.auth. Ini SATU-SATUNYA tempat
// modul manapun boleh manggil login/logout/baca-sesi — biar semua modul
// otomatis "satu login" begitu mereka pindah pakai file ini, dan biar
// refresh-token/revoke ditangani SDK (lebih benar) daripada hand-rolled
// fetch ke /auth/v1/token kayak pola lama.
//
// WAJIB dimuat SETELAH shared/supabase-client.js.
//
// Modul lama (konversian.js/stok.html) yang masih punya fungsi sendiri:
//   saveAuthSession() / readAuthSession() / clearAuthSession() / doLogout()
// nanti tinggal diganti panggil ke PNMAuth.* di bawah ini — TAPI itu
// perubahan di file modul yang lagi disentuh sesi lain, jadi belum
// dilakukan di sini. Ini cuma nyiapin fondasinya dulu.
// ══════════════════════════════════════════

const PNMAuth = (() => {
  const sb = window.pnmSupabase;
  if (!sb) console.error('[shared/auth-session] pnmSupabase belum ada — pastikan shared/supabase-client.js dimuat lebih dulu.');

  async function login(email, password, captchaToken) {
    const { data, error } = await sb.auth.signInWithPassword({
      email,
      password,
      options: captchaToken ? { captchaToken } : undefined,
    });
    if (error) throw error;
    return data; // { user, session }
  }

  // ── Izin per-akun (kolom di tabel allowed_users) ──
  // Ini cuma LAPISAN UI (sembunyiin tombol + pesan jelas). Yang benar-benar melarang tetap RLS di database
  // (lihat db/migrations/001_boleh_hapus.sql). Makanya kalau gagal dimuat (kolom belum ada / jaringan), can()
  // balik true: UI gak sok melarang, dan DB yang menentukan.
  let _perms = null; // { role, is_superuser, boleh_hapus } | null

  // Kolom izin dimuat penuh. Kalau kolom baru (boleh_hapus_sesi, modul_tersembunyi) belum ada di DB (migrasi
  // belum dijalankan), jatuh ke daftar kolom lama supaya izin hapus yang lama tetap terbaca.
  const PERM_COLS_FULL = 'role, is_superuser, boleh_hapus, boleh_hapus_sesi, modul_tersembunyi';
  const PERM_COLS_LEGACY = 'role, is_superuser, boleh_hapus';

  async function loadPerms(email) {
    _perms = null;
    const key = String(email || '').toLowerCase();
    try {
      let { data, error } = await sb.from('allowed_users').select(PERM_COLS_FULL).eq('email', key).maybeSingle();
      if (error) {
        ({ data, error } = await sb.from('allowed_users').select(PERM_COLS_LEGACY).eq('email', key).maybeSingle());
      }
      if (error) { console.warn('[PNMAuth.loadPerms] gagal, UI tidak membatasi (DB tetap menegakkan):', error.message); return null; }
      _perms = data || null;
    } catch (e) { console.warn('[PNMAuth.loadPerms]', e); }
    return _perms;
  }

  function can(action) {
    if (!_perms) return true;
    if (_perms.is_superuser) return true;
    if (action === 'hapus') return _perms.boleh_hapus !== false;
    return true;
  }

  // Admin = is_superuser. Halaman Pengaturan (/pengaturan) hanya untuk ini. Penegakan sebenarnya ada di RLS
  // (can_manage_izin()); ini cuma supaya UI tidak menawarkan sesuatu yang pasti ditolak DB.
  // Izin belum termuat -> false: halaman admin tidak dibuka atas dasar tebakan.
  function isAdmin() { return !!(_perms && _perms.is_superuser); }

  // Boleh melihat modul (dan submodul, kalau subId diisi)? modul_tersembunyi = daftar id yang disembunyikan:
  // 'modul' (seluruh modul) atau 'modul/sub' (satu submodul). Superuser selalu melihat semua (admin tidak bisa
  // mengunci dirinya sendiri). Izin belum termuat -> true, sama seperti can(): UI tidak sok melarang.
  // INI LAPISAN UI, bukan kunci data; data dikunci RLS (supabase/2026-11-26_izin_akun_modul.sql).
  function canView(moduleId, subId) {
    if (!_perms || _perms.is_superuser) return true;
    const hidden = Array.isArray(_perms.modul_tersembunyi) ? _perms.modul_tersembunyi : [];
    if (hidden.includes(moduleId)) return false;
    return !(subId && hidden.includes(moduleId + '/' + subId));
  }

  async function logout() {
    _perms = null;
    // signOut() bawaan SDK sudah otomatis:
    //  1) nembak /auth/v1/logout buat revoke refresh token di server
    //  2) hapus session dari localStorage (key PNM_AUTH_STORAGE_KEY)
    // Jadi doLogout() versi manual yang lama (yang sempat "ketinggalan
    // commit" di salah satu modul) gak perlu ditulis ulang manual lagi —
    // fungsinya sudah include di sini secara built-in.
    const { error } = await sb.auth.signOut();
    if (error) console.warn('[PNMAuth.logout] gagal revoke di server, tetap lanjut logout lokal:', error);
  }

  async function getSession() {
    const { data, error } = await sb.auth.getSession();
    if (error) { console.warn('[PNMAuth.getSession]', error); return null; }
    return data.session; // null kalau belum/nggak login
  }

  async function getUser() {
    const session = await getSession();
    return session ? session.user : null;
  }

  async function getAccessToken() {
    // Otomatis kepicu refresh oleh SDK kalau token yang di storage
    // sudah/hampir expired — modul lama harus manggil refreshAuthSession()
    // manual sendiri buat ini, di sini gratis.
    const session = await getSession();
    return session ? session.access_token : null;
  }

  // Dipanggil modul yang mau tau real-time kalau ada login/logout/refresh
  // terjadi di tab lain (misal user logout dari modul lain yang lagi
  // dibuka di tab sebelah). Return unsubscribe function.
  function onAuthStateChange(callback) {
    const { data: sub } = sb.auth.onAuthStateChange((event, session) => callback(event, session));
    return () => sub.subscription.unsubscribe();
  }

  // Helper buat modul yang mau strict guard di awal load: kalau belum
  // login, panggil ini dan redirect sendiri kalau hasilnya null. Modul
  // yang sudah punya auth-gate sendiri (kayak konversian.html) boleh
  // pakai ini juga buat ngecek status awal, gak wajib redirect.
  async function requireAuth(onUnauthenticated) {
    const session = await getSession();
    if (!session && typeof onUnauthenticated === 'function') onUnauthenticated();
    return session;
  }

  return { login, logout, getSession, getUser, getAccessToken, onAuthStateChange, requireAuth, loadPerms, can, canView, isAdmin, perms: () => _perms };
})();

window.PNMAuth = PNMAuth;