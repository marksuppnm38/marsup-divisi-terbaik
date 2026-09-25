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

// Dibungkus IIFE SENGAJA: file modul (konversian.js, crud-produk.js, dll)
// masing-masing juga punya `const SUPABASE_URL = ...` sendiri di scope-nya.
// Karena ini semua <script> biasa (bukan type="module"), top-level const/let
// dari script terpisah tetap satu lexical scope global yang sama — kalau
// nama variabelnya sama, browser bakal throw "Identifier ... has already
// been declared" dan SELURUH app berhenti jalan. IIFE ini mencegah itu:
// yang bocor ke luar cuma lewat window.* di bagian bawah.
(function () {
  const SUPABASE_URL = 'https://ptkkbsemihcyndisjoor.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB0a2tic2VtaWhjeW5kaXNqb29yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0Njc4MzgsImV4cCI6MjA5ODA0MzgzOH0.QsCqmcqQcXvz1f8bLkagvMbAGUBbBP-3Wa5Aore5OMo';

  // Key TUNGGAL untuk semua modul. Sengaja disamain dengan key lama
  // (`pnm_auth_session`) yang sudah dipakai konversian.js/stok.html, supaya
  // user yang lagi login di modul lama tetap kebaca sesinya begitu modul
  // itu ikut pindah ke shared client ini — gak perlu re-login massal pas
  // rollout. Sesi kedua puluh tiga: ini sekarang nama COOKIE, bukan lagi
  // localStorage key (lihat cookieStorage di bawah) -- key-nya sendiri
  // gak berubah, cuma tempat nyimpennya.
  const PNM_AUTH_STORAGE_KEY = 'pnm_auth_session';

  // ══════════════════════════════════════════
  // Sesi kedua puluh tiga: storage adapter custom, cookie-backed --
  // menggantikan default SDK (localStorage). CATATAN JUJUR (biar gak ada
  // yang later kaget): ini BUKAN upgrade keamanan. App ini static site
  // tanpa backend -- cookie yang di-set dari sini SAMA SEKALI GAK BISA
  // httpOnly (cuma server yang bisa nyet httpOnly cookie), jadi tetap
  // kebaca sama JS apapun yang jalan di halaman ini, PERSIS sama kayak
  // localStorage. Beda nyata cuma dua: (1) cookie ada batas ukuran ~4KB,
  // localStorage jauh lebih longgar (biasanya 5-10MB) -- makanya ada
  // console.warn kalau blob sesi mendekati batas itu (lihat setItem di
  // bawah); (2) cookie otomatis kekirim ke SETIAP request ke domain yang
  // sama (termasuk request static asset), sementara token buat panggilan
  // ke Supabase di app ini SELALU dikirim manual lewat header
  // `Authorization: Bearer` (lihat getAccessToken() di auth-session.js +
  // titik-titik fetch() di tiap modul) -- jadi gak ada keuntungan
  // fungsional dari "auto-attach" cookie ke request Supabase (beda
  // domain: app di Vercel, Supabase di *.supabase.co, cookie gak
  // otomatis nyebrang domain).
  //
  // Max-Age 30 hari (dipilih biar kira-kira samain UX localStorage yang
  // dulu -- gak expire cuma karena browser ditutup; refresh token
  // Supabase sendiri yang jadi batas beneran valid-nggaknya sesi, cookie
  // ini cuma wadah penyimpanan).
  const COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
  const COOKIE_SIZE_WARN_THRESHOLD = 3800; // browser umumnya mentok ~4093 byte per cookie

  function getCookie(name) {
    const prefix = name + '=';
    const found = document.cookie.split('; ').find((row) => row.startsWith(prefix));
    return found ? decodeURIComponent(found.slice(prefix.length)) : null;
  }

  function setCookie(name, value) {
    const encoded = encodeURIComponent(value);
    if (encoded.length > COOKIE_SIZE_WARN_THRESHOLD) {
      console.warn(
        `[shared/supabase-client] Cookie '${name}' ukurannya ${encoded.length} byte, ` +
        `mendekati/lewat batas ~4KB browser -- sesi mungkin gagal tersimpan diam-diam. ` +
        `Kalau ini kejadian terus, pertimbangkan balik ke localStorage buat auth storage.`
      );
    }
    // Secure cuma di-set kalau beneran https -- kalau dipaksa selalu ada,
    // cookie gagal ke-set total pas dev lokal via http (mis. localhost:8000
    // biasa, bukan https). SameSite=Lax: cukup buat single-domain app ini,
    // gak butuh None (yang mewajibkan Secure, gak jalan di http lokal).
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${name}=${encoded}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
  }

  function removeCookie(name) {
    document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
  }

  // Interface yang GoTrueClient (bagian auth dari SDK Supabase) harapkan:
  // getItem/setItem/removeItem, boleh sync atau Promise. Dibikin sync di
  // sini (document.cookie itu sendiri operasi sync).
  const cookieStorage = {
    getItem: (key) => getCookie(key),
    setItem: (key, value) => setCookie(key, value),
    removeItem: (key) => removeCookie(key),
  };

  if (typeof window.supabase === 'undefined' || !window.supabase.createClient) {
    console.error('[shared/supabase-client] SDK Supabase belum termuat — cek urutan <script> CDN-nya.');
    return;
  }

  const pnmSupabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storageKey: PNM_AUTH_STORAGE_KEY,
      storage: cookieStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false
    }
  });

  // Cuma INI yang diekspos ke global — sengaja dengan nama beda (window.PNM_*)
  // biar gak collide sama const SUPABASE_URL/ANON_KEY yang sudah ada di
  // file modul masing-masing. Modul lama boleh tetap pakai const lokalnya
  // sendiri buat fetch() manual (sesiFetch dkk) — cuma sumber TOKEN/session
  // yang perlu satu pintu, bukan URL/anon key-nya (itu memang publik & sama
  // di semua modul).
  window.pnmSupabase = pnmSupabase;
  window.PNM_SUPABASE_URL = SUPABASE_URL;
  window.PNM_SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;

  // ══════════════════════════════════════════
  // SIGNED URL HELPER (sesi keamanan, bucket 'thumbnails'/'lampiran-unit' privat)
  // ══════════════════════════════════════════
  // Dulu semua modul nge-build URL gambar/lampiran langsung sebagai string
  // deterministik ('.../object/public/<bucket>/<kode>.png') karena bucketnya
  // di-flag PUBLIC di Supabase -- siapa aja yang punya/nebak URL itu (link
  // "Copy image address" di browser, dsb.) bisa buka file itu SELAMANYA,
  // tanpa login, dari luar app ini sama sekali. Sekarang bucket-nya PRIVATE
  // (RLS storage.objects yang nentuin siapa boleh baca), jadi satu-satunya
  // cara ngambil URL yang beneran bisa diakses adalah minta Supabase nanda-
  // tangani URL sementara (createSignedUrl) pakai sesi login yang aktif --
  // itu yang dua fungsi di bawah ini bungkus, PLUS cache in-memory pendek
  // biar gambar yang sama (dilihat berkali-kali dalam satu sesi tab, mis.
  // buka-tutup modal yang sama) gak nembak endpoint signing berkali-kali.
  //
  // TTL sengaja gak dibikin "selamanya" atau "sangat panjang": ini PERSIS
  // titik keseimbangan yang dulu gak ada sama sekali (public = TTL tak
  // terhingga). URL hasil sign ini akan ditempel ke tempat yang bisa
  // "kabur" dari app (di-paste ke Excel/Google Sheet lewat fitur "Copy +
  // Gambar" / <img>/=IMAGE()) -- practice standar adalah kasih token itu
  // umur pendek, cukup buat kebutuhan paste/lihat saat itu juga, supaya
  // begitu lewat TTL-nya, link yang sempat ke-paste itu OTOMATIS jadi gak
  // guna lagi (401/expired) walau linknya sendiri masih "hidup" di sheet
  // orang. Kalau kebutuhan berubah (mis. tim komplain gambar di sheet lama
  // ilang kecepetan), naikkan angka ini -- jangan hapus mekanisme sign-nya.
  const SIGNED_URL_TTL_SECONDS = 3600; // 1 jam
  const SIGNED_URL_CACHE_MARGIN_MS = 30 * 1000; // anggap kadaluarsa 30dtk lebih awal dari klaimnya, buffer utk latency jaringan
  const signedUrlCache = new Map(); // key `${bucket}\u0000${path}` -> { url, expiresAtMs }

  function cacheKey(bucket, path) { return bucket + '\u0000' + path; }

  // Satu file. Lempar Error kalau gagal (path gak ada / gak ada akses) --
  // caller yang mutusin fallback-nya (tampilin placeholder, biarin
  // <img onerror>, dst), sama kayak dulu kalau URL public 404.
  async function pnmGetSignedUrl(bucket, path, expiresInSeconds = SIGNED_URL_TTL_SECONDS) {
    const key = cacheKey(bucket, path);
    const cached = signedUrlCache.get(key);
    if (cached && cached.expiresAtMs > Date.now()) return cached.url;
    const { data, error } = await pnmSupabase.storage.from(bucket).createSignedUrl(path, expiresInSeconds);
    if (error) throw error;
    signedUrlCache.set(key, { url: data.signedUrl, expiresAtMs: Date.now() + expiresInSeconds * 1000 - SIGNED_URL_CACHE_MARGIN_MS });
    return data.signedUrl;
  }

  // Banyak file sekaligus (satu request Storage API, bukan N request) --
  // buat list/tabel/clipboard-export yang butuh beberapa gambar bersamaan
  // (dictionary detail, rincian set, copy+gambar Converter). Balikinnya Map
  // path -> url ('' kalau gagal buat path itu spesifik, misal filenya emang
  // belum pernah diupload -- caller cek falsy-nya, sama kayak dulu <img
  // onerror> nanganin 404).
  async function pnmGetSignedUrls(bucket, paths, expiresInSeconds = SIGNED_URL_TTL_SECONDS) {
    const result = new Map();
    const uncached = [];
    const uniquePaths = [...new Set(paths)];
    uniquePaths.forEach((p) => {
      const key = cacheKey(bucket, p);
      const cached = signedUrlCache.get(key);
      if (cached && cached.expiresAtMs > Date.now()) result.set(p, cached.url);
      else uncached.push(p);
    });
    if (uncached.length) {
      const { data, error } = await pnmSupabase.storage.from(bucket).createSignedUrls(uncached, expiresInSeconds);
      if (error) throw error;
      (data || []).forEach((row) => {
        // signed URLs (path yang ditemukan, gak error per-item) -- SDK balikin satu
        // entri per path yg diminta, urut sama, tiap entri punya .path/.signedUrl/.error.
        const url = (!row.error && row.signedUrl) ? row.signedUrl : '';
        if (url) signedUrlCache.set(cacheKey(bucket, row.path), { url, expiresAtMs: Date.now() + expiresInSeconds * 1000 - SIGNED_URL_CACHE_MARGIN_MS });
        result.set(row.path, url);
      });
    }
    return result;
  }

  window.PNM_getSignedUrl = pnmGetSignedUrl;
  window.PNM_getSignedUrls = pnmGetSignedUrls;
})();