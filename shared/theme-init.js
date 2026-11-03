/* ============================================================
   THEME — satu-satunya sumber kebenaran untuk tema light/dark.

   Dimuat sebagai <script> KLASIK sinkron di <head> index.html, SEBELUM
   stylesheet & router.js, supaya <html data-theme> sudah terpasang sebelum
   paint pertama (tidak ada flash tema salah) dan sebelum halaman manapun
   mount(). Harus file eksternal, bukan inline: CSP di vercel.json memakai
   script-src 'self' tanpa 'unsafe-inline'.

   Preferensi pengguna:
     - localStorage 'theme' = 'light' | 'dark'  -> pilihan manual (menang)
     - tidak ada / 'system'                      -> ikuti OS, dan ikut
                                                    berubah live saat OS ganti
   Key lama 'pnum-theme' hanya dibaca sebagai fallback migrasi.

   Akar bug "light di Spek Maker, tiba-tiba dark di Konversian":
   dulu TIDAK ada init global. Tiap halaman menyetel tema sendiri saat
   mount() (konversian/dashboard/stok/rekon/crud-produk) dengan fallback
   ke prefers-color-scheme, sedangkan halaman lain (spek-maker, export-gambar,
   kompres-pdf, uploader-wiki) tidak menyetel apa-apa sehingga jatuh ke
   :root (light). Pengguna dengan OS dark dan belum pernah klik toggle akan
   melihat light di halaman "diam" lalu dark begitu pindah ke halaman yang
   punya init sendiri. Sekarang semua halaman cukup membaca <html data-theme>.

   API (window.PNMTheme):
     get()            -> 'light' | 'dark'  (tema yang sedang terpasang)
     getPreference()  -> 'light' | 'dark' | 'system'
     set(pref)        -> 'light' | 'dark' | 'system'
     toggle()         -> balik light <-> dark (jadi pilihan manual)
     subscribe(fn)    -> fn(theme, preference) tiap tema berubah; return unsubscribe
   Event: window 'pnm:themechange' dengan detail { theme, preference }.
   ============================================================ */
(function () {
  'use strict';

  var KEY = 'theme';
  var LEGACY_KEY = 'pnum-theme';
  var root = document.documentElement;
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function read(k) {
    try { return localStorage.getItem(k); } catch (e) { return null; }
  }
  function write(k, v) {
    try { localStorage.setItem(k, v); } catch (e) { /* private mode / kuota: tema tetap jalan untuk sesi ini */ }
  }
  function remove(k) {
    try { localStorage.removeItem(k); } catch (e) { /* abaikan */ }
  }
  function isTheme(v) { return v === 'light' || v === 'dark'; }

  function storedTheme() {
    var v = read(KEY);
    if (isTheme(v)) return v;
    var legacy = read(LEGACY_KEY);
    return isTheme(legacy) ? legacy : null;
  }
  function systemTheme() {
    return mq && mq.matches ? 'dark' : 'light';
  }
  function resolve() {
    return storedTheme() || systemTheme();
  }
  function preference() {
    return storedTheme() || 'system';
  }

  var listeners = [];

  function apply(theme) {
    var changed = root.getAttribute('data-theme') !== theme;
    root.setAttribute('data-theme', theme);
    root.style.colorScheme = theme;
    if (!changed) return;
    var pref = preference();
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](theme, pref); } catch (e) { /* satu listener rusak tidak boleh menghentikan yang lain */ }
    }
    try {
      window.dispatchEvent(new CustomEvent('pnm:themechange', { detail: { theme: theme, preference: pref } }));
    } catch (e) { /* CustomEvent tidak tersedia: abaikan */ }
  }

  // Terapkan SEKARANG, sebelum paint pertama.
  apply(resolve());

  // Ikut perubahan OS selama pengguna belum memilih manual.
  function onSystemChange() {
    if (!storedTheme()) apply(systemTheme());
  }
  if (mq) {
    if (mq.addEventListener) mq.addEventListener('change', onSystemChange);
    else if (mq.addListener) mq.addListener(onSystemChange);
  }

  // Sinkron antar tab: tema diubah di tab lain -> tab ini ikut.
  window.addEventListener('storage', function (e) {
    if (e.key === null || e.key === KEY || e.key === LEGACY_KEY) apply(resolve());
  });

  window.PNMTheme = {
    get: function () { return root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'; },
    getPreference: preference,
    set: function (pref) {
      if (pref === 'system') {
        remove(KEY);
        remove(LEGACY_KEY);
        apply(systemTheme());
      } else if (isTheme(pref)) {
        write(KEY, pref);
        apply(pref);
      }
    },
    toggle: function () {
      var next = window.PNMTheme.get() === 'dark' ? 'light' : 'dark';
      window.PNMTheme.set(next);
      return next;
    },
    subscribe: function (fn) {
      listeners.push(fn);
      return function () {
        var i = listeners.indexOf(fn);
        if (i !== -1) listeners.splice(i, 1);
      };
    }
  };
})();
