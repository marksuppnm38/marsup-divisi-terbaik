// shared/no-autofill.js
// ══════════════════════════════════════════
// KENAPA FILE INI ADA: user melaporkan textbox biasa (contoh: search box
// "Cari Produk") memunculkan popup "sign in as ..." dari password manager
// browser -- walaupun beberapa input SUDAH dikasih autocomplete="off"
// manual (lihat app/pages/konversian/markup.js #search-input). Itu bukan
// bug di masing-masing field: shell.html adalah SATU halaman (SPA), dan
// #pw-gate (shared/auth-gate.js) yang berisi <input type="password">
// SELALU ada di <body>, bukan di dalam <form> apa pun. Chromium (dan
// browser Chromium lain) mengelompokkan semua input yang tidak
// dibungkus <form> di satu frame jadi satu "unowned form" internal buat
// keperluan password manager -- jadi SEMUA textbox lain di app ini ikut
// dianggap "field terkait login" oleh browser selama <input type=
// password> itu masih ada di DOM, walau cuma disembunyikan (display:
// none) dan walau textbox-nya sendiri sudah autocomplete="off".
//
// Fix ada DUA lapis:
//  1. shared/auth-gate.js sekarang betul-betul MELEPAS #pw-gate dari DOM
//     (bukan cuma display:none) begitu user login -- putus asosiasi di
//     atas dari akarnya.
//  2. File ini: lapis kedua/jaring pengaman. Nge-scan SELURUH textbox di
//     luar #pw-gate (termasuk yang dirender belakangan lewat innerHTML,
//     misal dictionary.js/clipboard.js/crud-produk) dan masangin
//     autocomplete="off" + atribut "jangan sarankan" punya masing-masing
//     password manager pihak ketiga (LastPass/1Password/Bitwarden/
//     Dashlane). #pw-gate SENGAJA dikecualikan -- itu satu-satunya
//     tempat autofill/sarankan password justru harus tetap jalan.
// ══════════════════════════════════════════

const GATE_ID = 'pw-gate';

// Semua tipe input yang bisa diisi teks bebas dan gampang salah-deteksi
// jadi "username" oleh password manager. type=password/checkbox/radio/
// file/hidden/submit/button sengaja tidak disentuh (baik karena memang
// harus punya autofill sendiri -- tidak ada di luar gate -- atau karena
// atribut ini tidak relevan buat tipe itu).
const SELECTOR = [
  'input:not([type])',
  'input[type="text"]',
  'input[type="search"]',
  'input[type="email"]',
  'input[type="tel"]',
  'input[type="url"]',
  'input[type="number"]',
  'input[type="date"]',
].join(',');

function isInsideLoginGate(el) {
  return !!el.closest('#' + GATE_ID);
}

function harden(el) {
  if (isInsideLoginGate(el)) return;
  if (el.dataset.noAutofillHardened) return;
  el.setAttribute('autocomplete', 'off');
  el.setAttribute('data-lpignore', 'true');   // LastPass
  el.setAttribute('data-1p-ignore', 'true');  // 1Password
  el.setAttribute('data-bwignore', 'true');   // Bitwarden
  el.setAttribute('data-form-type', 'other'); // Dashlane, dkk yang cek atribut ini
  el.dataset.noAutofillHardened = 'true';
}

function scan(root) {
  if (!root || root.nodeType !== 1) return;
  if (root.matches && root.matches(SELECTOR)) harden(root);
  if (root.querySelectorAll) root.querySelectorAll(SELECTOR).forEach(harden);
}

export function initNoAutofillGuard() {
  scan(document.body);
  // Router ini nge-mount/unmount tiap modul via innerHTML template string
  // (bukan komponen React/Vue yang lifecycle-nya predictable), jadi
  // textbox baru bisa muncul kapan saja setelah initial render -- observer
  // ini yang jaga supaya field baru ikut ke-harden otomatis, tanpa perlu
  // tiap page module manggil fungsi ini manual satu-satu.
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach((node) => scan(node));
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}