// Logika murni halaman Pengaturan > User Management: tanpa DOM, tanpa jaringan, bisa dites langsung dari Node
// (scripts/test-izin-akun.mjs), sama seperti nav/perm-view.js.
//
// Dua bentuk data:
//   row  = keadaan akun menurut server (hasil normalizeRow):
//          { email, role, is_superuser, boleh_hapus, boleh_hapus_sesi, modul_tersembunyi: string[] baku }
//   form = keadaan yang sedang diedit admin di drawer:
//          { boleh_hapus, boleh_hapus_sesi, hidden: string[] baku }   (hidden = isi modul_tersembunyi)
//
// Semantik BLACKLIST: modul "tampil" = id-nya TIDAK ada di hidden. Bentuk baku (canonHidden) dijaga di setiap
// fungsi yang mengubah hidden, jadi apa yang ditulis ke database selalu sama dengan yang ditulis halaman lama.

import { MODULES } from '../home/markup.js';
import { SUBNAV, knownPermIds, canonHidden } from '../nav/perm-view.js';

export const IZIN_COLS = 'email, role, is_superuser, boleh_hapus, boleh_hapus_sesi, modul_tersembunyi';

// ── Normalisasi ──────────────────────────────────────────────────────────────────────────────

// known = Set id yang sah ('modul' dan 'modul/sub'). Id basi (modul/submodul sudah dibongkar dari kode) dibuang.
export function normalizeRow(r, known = knownPermIds()) {
  const raw = r && Array.isArray(r.modul_tersembunyi) ? r.modul_tersembunyi : [];
  return {
    email: String((r && r.email) || ''),
    role: (r && r.role) || '',
    is_superuser: !!(r && r.is_superuser),
    boleh_hapus: !!(r && r.boleh_hapus),
    boleh_hapus_sesi: !!(r && r.boleh_hapus_sesi),
    modul_tersembunyi: canonHidden(raw.filter((id) => typeof id === 'string' && known.has(id))),
  };
}

export function sameSet(a, b) {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

// Dua baris dari server sama (untuk deteksi konflik)? Hanya tiga kolom yang bisa diubah dari halaman ini.
export function sameServerState(a, b) {
  return !!a && !!b
    && a.boleh_hapus === b.boleh_hapus
    && a.boleh_hapus_sesi === b.boleh_hapus_sesi
    && sameSet(a.modul_tersembunyi, b.modul_tersembunyi);
}

export function rowToForm(row) {
  return { boleh_hapus: row.boleh_hapus, boleh_hapus_sesi: row.boleh_hapus_sesi, hidden: [...row.modul_tersembunyi] };
}

// ── Baca keadaan modul / submodul dari form ──────────────────────────────────────────────────

const subsOf = (modId) => SUBNAV[modId] || [];

export function isModOn(form, modId) {
  return !form.hidden.includes(modId);
}

export function isSubOn(form, modId, subId) {
  return isModOn(form, modId) && !form.hidden.includes(`${modId}/${subId}`);
}

// { on, partial, count, total }: on = switch modul menyala (minimal satu submodul tampil), partial = sebagian,
// count/total = jumlah submodul yang tampil (modul tanpa submodul: 1 atau 0 dari 1).
export function modState(form, modId) {
  const subs = subsOf(modId);
  if (!subs.length) {
    const on = isModOn(form, modId);
    return { on, partial: false, count: on ? 1 : 0, total: 1 };
  }
  const count = subs.filter((s) => isSubOn(form, modId, s.id)).length;
  return { on: count > 0, partial: count > 0 && count < subs.length, count, total: subs.length };
}

// ── Ubah form (tidak memutasi argumen) ───────────────────────────────────────────────────────

// Nyalakan / matikan seluruh modul (semua submodulnya ikut).
export function setMod(form, modId, on) {
  const hidden = form.hidden.filter((id) => id !== modId && !id.startsWith(`${modId}/`));
  if (!on) hidden.push(modId);
  return { ...form, hidden: canonHidden(hidden) };
}

// Nyalakan / matikan satu submodul. Kalau modulnya tersembunyi seluruhnya lalu satu submodul dinyalakan,
// 'modul' diurai dulu menjadi semua submodul KECUALI yang dinyalakan.
export function setSub(form, modId, subId, on) {
  const subs = subsOf(modId);
  if (!subs.some((s) => s.id === subId)) return form;
  let hidden = [...form.hidden];
  if (hidden.includes(modId)) {
    hidden = hidden.filter((id) => id !== modId);
    subs.forEach((s) => hidden.push(`${modId}/${s.id}`));
  }
  const id = `${modId}/${subId}`;
  hidden = hidden.filter((x) => x !== id);
  if (!on) hidden.push(id);
  return { ...form, hidden: canonHidden(hidden) };
}

export function setIzin(form, key, value) {
  if (key !== 'boleh_hapus' && key !== 'boleh_hapus_sesi') return form;
  return { ...form, [key]: !!value };
}

// ── Perubahan: hitung, ringkas, payload ──────────────────────────────────────────────────────

const IZIN_LABEL = { boleh_hapus: 'Hapus data', boleh_hapus_sesi: 'Hapus item clipboard' };
const modTitle = (id) => (MODULES.find((m) => m.id === id) || {}).title || id;

// Daftar perubahan form terhadap row. Satuan hitung: SATU modul yang tampilannya berubah (berapa pun submodulnya)
// ditambah tiap izin hapus yang berubah. Admin: modul tidak ikut dibandingkan (kontrolnya terkunci).
// Kembalian: { count, items: ['Hapus data', 'Konversian', ...], izin: ['boleh_hapus'...], modul: boolean }
export function diffForm(row, form) {
  const izin = ['boleh_hapus', 'boleh_hapus_sesi'].filter((k) => form[k] !== row[k]);
  const items = izin.map((k) => IZIN_LABEL[k]);
  let modulChanged = false;
  if (!row.is_superuser && !sameSet(form.hidden, row.modul_tersembunyi)) {
    const before = rowToForm(row);
    MODULES.forEach((m) => {
      const a = subsOf(m.id).length ? subsOf(m.id).map((s) => isSubOn(before, m.id, s.id)) : [isModOn(before, m.id)];
      const b = subsOf(m.id).length ? subsOf(m.id).map((s) => isSubOn(form, m.id, s.id)) : [isModOn(form, m.id)];
      if (a.some((v, i) => v !== b[i])) { items.push(m.title); modulChanged = true; }
    });
    // Perbedaan yang tidak terbaca dari MODULES (tidak seharusnya terjadi): tetap dianggap perubahan.
    if (!modulChanged) { items.push('Modul'); modulChanged = true; }
  }
  return { count: items.length, items, izin, modul: modulChanged };
}

export const isDirty = (row, form) => diffForm(row, form).count > 0;

// Payload UPDATE: HANYA kolom yang berubah. Dengan begitu perubahan lain yang masuk bersamaan (admin lain, SQL
// Editor) pada kolom yang tidak disentuh tidak tertimpa, dan audit hanya mencatat yang memang diubah.
// Admin tidak pernah menulis modul_tersembunyi (selalu melihat semua modul).
export function buildPayload(row, form) {
  const d = diffForm(row, form);
  const p = {};
  d.izin.forEach((k) => { p[k] = !!form[k]; });
  if (d.modul && !row.is_superuser) p.modul_tersembunyi = canonHidden(form.hidden);
  return p;
}

// Mengaktifkan "Hapus data" (yang sebelumnya mati) butuh konfirmasi. Menonaktifkan tidak.
export const needsDeleteConfirm = (row, form) => form.boleh_hapus === true && row.boleh_hapus === false;

// ── Ringkasan untuk tabel ────────────────────────────────────────────────────────────────────

export function modulCategory(row) {
  if (row.is_superuser) return 'Akses penuh';
  return row.modul_tersembunyi.length ? 'Sebagian disembunyikan' : 'Semua tampil';
}

export function modulSummary(row) {
  if (row.is_superuser) return 'Akses penuh';
  const n = row.modul_tersembunyi.length;
  return n ? `${n} disembunyikan` : 'Semua tampil';
}

// Izin hapus efektif: 'Penuh' (Hapus data), 'Clipboard' (hanya item clipboard), 'Tidak'.
export function hapusLevel(row) {
  if (row.boleh_hapus) return 'Penuh';
  return row.boleh_hapus_sesi ? 'Clipboard' : 'Tidak';
}

export const initialOf = (email) => (String(email || '').trim().charAt(0) || '?').toUpperCase();

// Pilihan filter Role diturunkan dari data (bukan daftar tetap), jadi role baru otomatis muncul.
export function roleOptions(rows) {
  return [...new Set(rows.map((r) => r.role).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'id'));
}

// Pencarian akun: email atau role, tidak peka huruf besar/kecil. Kosong = semua.
export function matchSearch(row, q) {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return true;
  return row.email.toLowerCase().includes(s) || row.role.toLowerCase().includes(s);
}

// ── Label ramah untuk riwayat ────────────────────────────────────────────────────────────────

// 'konversian/riwayat' -> 'Conversion Workspace › Riwayat'. Id yang tidak dikenal ditampilkan apa adanya.
export function idLabel(id) {
  const [mod, sub] = String(id).split('/');
  if (!sub) return modTitle(mod);
  const s = subsOf(mod).find((x) => x.id === sub);
  return `${modTitle(mod)} › ${s ? s.title : sub}`;
}

const splitIds = (v) => (v == null || v === '' ? [] : String(v).split(',').map((x) => x.trim()).filter(Boolean));

// Nilai audit modul_tersembunyi ('a, b/c') dibandingkan: { disembunyikan: [...], ditampilkan: [...] } (sudah berlabel).
export function diffHiddenAudit(lama, baru) {
  const a = new Set(splitIds(lama));
  const b = new Set(splitIds(baru));
  return {
    disembunyikan: [...b].filter((x) => !a.has(x)).map(idLabel),
    ditampilkan: [...a].filter((x) => !b.has(x)).map(idLabel),
  };
}

const BOOL_COLS = new Set(['boleh_hapus', 'boleh_hapus_sesi', 'is_superuser']);
export const KOLOM_LABEL = {
  boleh_hapus: 'Hapus data',
  boleh_hapus_sesi: 'Hapus item clipboard',
  modul_tersembunyi: 'Modul',
  is_superuser: 'Admin',
  role: 'Role',
  akun: 'Akun',
};

// Satu baris audit -> teks ringkas satu kalimat (belum di-escape; pemanggil yang meng-escape).
export function describeAudit(r) {
  const kolom = r.kolom;
  const label = KOLOM_LABEL[kolom] || kolom;
  if (kolom === 'modul_tersembunyi') {
    const d = diffHiddenAudit(r.nilai_lama, r.nilai_baru);
    const parts = [];
    if (d.disembunyikan.length) parts.push(`disembunyikan: ${d.disembunyikan.join(', ')}`);
    if (d.ditampilkan.length) parts.push(`ditampilkan: ${d.ditampilkan.join(', ')}`);
    return parts.length ? `Modul ${parts.join('; ')}` : 'Modul (tanpa perubahan bersih)';
  }
  if (BOOL_COLS.has(kolom)) {
    const v = (x) => (x === 'true' ? 'ya' : x === 'false' ? 'tidak' : '—');
    return `${label}: ${v(r.nilai_lama)} → ${v(r.nilai_baru)}`;
  }
  const v = (x) => (x == null || x === '' ? '—' : x);
  return `${label}: ${v(r.nilai_lama)} → ${v(r.nilai_baru)}`;
}
