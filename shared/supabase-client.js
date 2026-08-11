// shared/supabase-client.js
// ══════════════════════════════════════════
// SATU instance Supabase client + SATU auth storage key, dipakai SEMUA
// modul (konversian, stok, dashboard, crud-produk). Ini menggantikan pola
// lama di mana tiap modul punya client/config auth sendiri-sendiri.
//
// CARA PAKAI di tiap HTML modul, urutan <script> WAJIB begini:
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//   <script src="/shared/supabase-client.js"></script>
//   <script src="/shared/auth-session.js"></script>
//   <script src="/konversian.js"></script>  <!-- atau modul lainnya -->
//
// Setelah ini dimuat, semua modul akses lewat window.pnmSupabase — JANGAN
// bikin supabase.createClient(...) baru lagi di file modul manapun.
// ══════════════════════════════════════════

const SUPABASE_URL = 'https://ptkkbsemihcyndisjoor.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB0a2tic2VtaWhjeW5kaXNqb29yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0Njc4MzgsImV4cCI6MjA5ODA0MzgzOH0.QsCqmcqQcXvz1f8bLkagvMbAGUBbBP-3Wa5Aore5OMo';

// Key localStorage TUNGGAL untuk semua modul. Sengaja disamain dengan key
// lama (`pnm_auth_session`) yang sudah dipakai konversian.js/stok.html,
// supaya user yang lagi login di modul lama tetap kebaca sesinya begitu
// modul itu ikut pindah ke shared client ini — gak perlu re-login massal
// pas rollout.
const PNM_AUTH_STORAGE_KEY = 'pnm_auth_session';

if (typeof window.supabase === 'undefined' || !window.supabase.createClient) {
  console.error('[shared/supabase-client] SDK Supabase belum termuat — cek urutan <script> CDN-nya.');
}

const pnmSupabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storageKey: PNM_AUTH_STORAGE_KEY,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false
  }
});

// Diekspos global biar file modul lama (yang masih baca SUPABASE_URL/ANON_KEY
// langsung buat sesiFetch() manual) bisa migrasi pelan-pelan tanpa harus
// ganti semua nama variabel sekaligus.
window.pnmSupabase = pnmSupabase;
window.PNM_SUPABASE_URL = SUPABASE_URL;
window.PNM_SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;
