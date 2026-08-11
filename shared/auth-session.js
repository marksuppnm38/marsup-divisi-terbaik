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

  async function login(email, password) {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data; // { user, session }
  }

  async function logout() {
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

  return { login, logout, getSession, getUser, getAccessToken, onAuthStateChange, requireAuth };
})();

window.PNMAuth = PNMAuth;
