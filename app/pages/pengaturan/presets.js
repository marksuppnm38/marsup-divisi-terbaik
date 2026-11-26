// Preset izin untuk halaman Pengaturan > User Management. Logika murni: tanpa DOM, tanpa jaringan, dites lewat
// scripts/test-izin-akun.mjs (sama seperti state.js dan nav/perm-view.js).
//
// "Preset izin" BUKAN role. Kolom `role` tidak bisa diubah dari browser; preset hanya mengisi tiga kolom izin
// yang memang boleh ditulis halaman ini: boleh_hapus, boleh_hapus_sesi, modul_tersembunyi.
//
// Modelnya BLACKLIST (modul_tersembunyi = yang disembunyikan). Supaya preset mudah dibaca dan tidak ikut basi
// saat modul baru ditambah, preset didefinisikan sebagai yang TAMPIL, lalu daftar tersembunyinya dihitung dari
// knownPermIds() saat diterapkan (presetHidden). Konsekuensinya sengaja: modul baru otomatis tampil untuk akun
// yang pernah cocok dengan sebuah preset, jadi akun itu bisa berubah jadi "Custom" tanpa ada yang mengubahnya.
//
// Preset hanya mengubah FORM di drawer. Tidak ada yang tertulis ke database sampai admin menekan Simpan,
// dan jalur simpan yang sama (cek konflik, UPDATE kolom yang berubah, audit) tetap berlaku.

import { knownPermIds, canonHidden } from '../nav/perm-view.js';
import { sameSet } from './state.js';

// tampil: '*' (semua modul) atau daftar id yang tampil: 'modul' (beserta semua submodulnya) dan/atau 'modul/sub'.
// Menambah preset = menambah satu baris di sini; tidak ada tempat lain yang perlu diubah.
export const PRESETS = [
  { id: 'penuh', label: 'Akses penuh', tampil: '*', boleh_hapus: true, boleh_hapus_sesi: false },
  { id: 'konversi', label: 'Hanya konversi', tampil: ['konversian'], boleh_hapus: false, boleh_hapus_sesi: false },
];

export const CUSTOM_ID = 'custom';

// Daftar id yang disembunyikan untuk sebuah preset, dalam bentuk baku (canonHidden).
// Id di `tampil` yang sudah tidak dikenal (modul dibongkar dari kode) diabaikan, bukan error.
export function presetHidden(preset, known = knownPermIds()) {
  if (preset.tampil === '*') return [];
  const tampil = new Set(preset.tampil);
  const subShown = (mod) => preset.tampil.some((t) => t.startsWith(`${mod}/`));
  const hidden = [];
  known.forEach((id) => {
    const slash = id.indexOf('/');
    if (slash === -1) {
      // modul: tersembunyi kalau tidak disebut dan tidak ada satu pun submodulnya yang disebut
      if (!tampil.has(id) && !subShown(id)) hidden.push(id);
    } else if (!tampil.has(id) && !tampil.has(id.slice(0, slash))) {
      // submodul: tersembunyi kalau tidak disebut dan modul induknya juga tidak disebut utuh
      hidden.push(id);
    }
  });
  return canonHidden(hidden);
}

// Form baru setelah preset diterapkan (tidak memutasi argumen).
export function applyPreset(form, preset, known = knownPermIds()) {
  return {
    ...form,
    hidden: presetHidden(preset, known),
    boleh_hapus: !!preset.boleh_hapus,
    boleh_hapus_sesi: !!preset.boleh_hapus_sesi,
  };
}

// Preset yang cocok persis dengan form sekarang, atau null (= "Custom"). Custom DIHITUNG, tidak disimpan.
export function matchPreset(form, presets = PRESETS, known = knownPermIds()) {
  const hit = presets.find((p) => form.boleh_hapus === !!p.boleh_hapus
    && form.boleh_hapus_sesi === !!p.boleh_hapus_sesi
    && sameSet(form.hidden, presetHidden(p, known)));
  return hit ? hit.id : null;
}

// ── Salin dari akun lain ─────────────────────────────────────────────────────────────────────

// Form baru yang menyalin ketiga kolom izin dari akun sumber. Admin selalu melihat semua modul, jadi untuk
// sumber admin yang disalin adalah "semua tampil" (hidden kosong), bukan sisa isi modul_tersembunyi-nya.
export function applyCopy(form, source) {
  return {
    ...form,
    hidden: source.is_superuser ? [] : [...source.modul_tersembunyi],
    boleh_hapus: !!source.boleh_hapus,
    boleh_hapus_sesi: !!source.boleh_hapus_sesi,
  };
}

// Akun yang bisa jadi sumber salinan: semua selain akun yang sedang diedit, urut menurut email.
export function copySources(rows, targetEmail) {
  const me = String(targetEmail || '').toLowerCase();
  return rows
    .filter((r) => r.email.toLowerCase() !== me)
    .sort((a, b) => a.email.localeCompare(b.email, 'id'));
}
