// Aturan "akun ini boleh melihat apa" untuk lapisan UI (menu, pencarian, router, halaman Pengaturan).
// Satu sumber, tanpa DOM dan tanpa efek samping, supaya bisa dites langsung dari Node (scripts/test-izin-akun.mjs).
//
// INI LAPISAN UI. Yang menutup data sungguhan adalah RLS (supabase/2026-11-26_izin_akun_modul.sql).
//
// Format allowed_users.modul_tersembunyi: daftar id yang DISEMBUNYIKAN (modul baru otomatis tampil).
//   'rekon-meeting'       modul tersembunyi seluruhnya (semua submodulnya ikut)
//   'konversian/riwayat'  hanya submodul itu
// Modul yang punya submodul dan SEMUA submodulnya tersembunyi dianggap tersembunyi juga (tidak ada halaman
// yang bisa dibuka di dalamnya).
// Izin belum termuat (PNMAuth.canView belum ada) -> boleh: UI tidak sok melarang, database yang memutuskan.

import { MODULES } from '../home/markup.js';
import { CRUD_PRODUK_SUBNAV } from '../crud-produk/subnav.js';
import { KONVERSIAN_SUBNAV } from '../konversian/subnav.js';

// module -> daftar submodulnya. Urutan pertama = submodul bawaan saat URL tanpa sub (cek konversian/index.js
// `initialSub || 'cari'` dan crud-produk/index.js `initialSub || 'produk'`).
export const SUBNAV = {
  'crud-produk': CRUD_PRODUK_SUBNAV,
  'konversian': KONVERSIAN_SUBNAV,
};

// Pengaturan bukan bagian MODULES (daftar bersama); hanya muncul untuk admin.
export const PENGATURAN_MODULE = { id: 'pengaturan', title: 'Pengaturan', url: '/pengaturan', migrated: true };

const auth = () => (typeof window !== 'undefined' ? window.PNMAuth : undefined);

function canView(moduleId, subId) {
  const a = auth();
  return typeof a?.canView !== 'function' || a.canView(moduleId, subId || null);
}

// Boleh membuka route ini? sub boleh kosong (= halaman modul itu sendiri).
export function isModuleAllowed(moduleId, subId) {
  if (moduleId === 'pengaturan') {
    const a = auth();
    return typeof a?.isAdmin === 'function' && a.isAdmin();
  }
  if (!canView(moduleId, subId)) return false;
  const subs = SUBNAV[moduleId];
  if (!subId && subs && subs.length) return subs.some((s) => canView(moduleId, s.id));
  return true;
}

// Submodul yang tampil untuk modul ini; null kalau modulnya memang tidak punya submodul.
export function visibleSubs(moduleId) {
  const subs = SUBNAV[moduleId];
  if (!subs) return null;
  return subs.filter((s) => canView(moduleId, s.id));
}

// Submodul pertama yang boleh dibuka, atau null (modul tanpa submodul / semuanya tersembunyi).
export function firstAllowedSub(moduleId) {
  const v = visibleSubs(moduleId);
  return v && v.length ? v[0].id : null;
}

// Modul yang tampil di sidebar akun yang sedang login. Dihitung ULANG tiap dipanggil (izin baru ada setelah
// login, dan akun bisa ganti tanpa reload).
export function navModules() {
  const mods = MODULES.filter((m) => isModuleAllowed(m.id));
  if (isModuleAllowed('pengaturan')) mods.push(PENGATURAN_MODULE);
  return mods;
}

// Sidik jari modul + submodul yang tampil. nav.js membandingkannya tiap pindah rute.
export function navPermSignature() {
  return navModules()
    .map((m) => { const v = visibleSubs(m.id); return v ? `${m.id}[${v.map((s) => s.id).join('+')}]` : m.id; })
    .join(',');
}

// Semua id yang sah untuk modul_tersembunyi: 'modul' dan 'modul/sub'. Dipakai halaman Pengaturan untuk
// membuang id basi (modul/submodul yang sudah dibongkar dari kode).
export function knownPermIds() {
  const ids = new Set(MODULES.map((m) => m.id));
  Object.entries(SUBNAV).forEach(([m, subs]) => subs.forEach((s) => ids.add(`${m}/${s.id}`)));
  return ids;
}

// Bentuk baku daftar tersembunyi (diurutkan): modul yang tersembunyi seluruhnya tidak perlu mencantumkan
// submodulnya, dan modul yang SEMUA submodulnya tersembunyi sama artinya dengan modul tersembunyi.
export function canonHidden(ids) {
  const set = new Set(ids);
  Object.entries(SUBNAV).forEach(([mod, subs]) => {
    if (subs.length && subs.every((x) => set.has(`${mod}/${x.id}`))) set.add(mod);
    if (set.has(mod)) subs.forEach((x) => set.delete(`${mod}/${x.id}`));
  });
  return Array.from(set).sort();
}
