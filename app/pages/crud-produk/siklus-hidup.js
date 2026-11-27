// crud-produk/siklus-hidup.js
// Logika murni (tanpa DOM / database) untuk kontrak keep-alive router (suspend / resume / isDirty). Rencana: bagian 9.
// index.js memakai tiga hal di sini; dipisah supaya bisa dites tanpa browser.

// Data Produk yang lebih tua dari ini disegarkan di latar saat modul dilanjutkan (resume).
export const BATAS_SEGAR_MS = 2 * 60 * 1000;

/**
 * Perlu menyegarkan daftar di latar saat resume? `terakhirMuat` = Date.now() saat daftar terakhir selesai dimuat.
 * 0 / tidak valid = belum pernah dimuat -> false (daftar dimuat malas oleh switchView, bukan urusan resume).
 */
export function perluSegarkan(terakhirMuat, sekarang, batas = BATAS_SEGAR_MS) {
  if (!Number.isFinite(terakhirMuat) || terakhirMuat <= 0) return false;
  return (sekarang - terakhirMuat) > batas;
}

/**
 * isDirty() modul: modal produk (edit / tambah / Info Dasar set) terbuka DAN ada perubahan belum disimpan.
 * Hanya membaca state modal (bukan DOM), jadi benar juga saat DOM sedang terparkir.
 */
export function adaDraft({ modalState, modalDirty } = {}) {
  return !!modalState && modalState !== 'closed' && modalDirty === true;
}

/**
 * Daftar listener tingkat document / window milik modul, yang bisa dilepas (suspend) dan dipasang lagi (resume).
 * Aman dipanggil berulang: lepas() dua kali / sambung() dua kali tidak menumpuk listener.
 *  - pasang(target, type, fn, { tetapSaatDraft, opsi }): daftarkan DAN pasang. Pasangan (target, type, fn) yang sama tidak ganda.
 *  - lepas({ draft }): lepas semua; entri `tetapSaatDraft` (beforeunload) tetap terpasang selama draft === true,
 *    supaya F5 / tutup tab saat modal berdraft terparkir tetap diperingatkan.
 *  - sambung(): pasang lagi yang terlepas.
 *  - buang(): lepas semua dan kosongkan daftar (unmount sungguhan).
 */
export function createGlobalBindings() {
  let daftar = [];
  const cocok = (e, target, type, fn) => e.target === target && e.type === type && e.fn === fn;
  return {
    pasang(target, type, fn, { tetapSaatDraft = false, opsi } = {}) {
      let e = daftar.find((x) => cocok(x, target, type, fn));
      if (!e) { e = { target, type, fn, opsi, tetapSaatDraft, terpasang: false }; daftar.push(e); }
      if (!e.terpasang) { target.addEventListener(type, fn, opsi); e.terpasang = true; }
      return e;
    },
    lepas({ draft = false } = {}) {
      daftar.forEach((e) => {
        if (!e.terpasang) return;
        if (e.tetapSaatDraft && draft) return;
        e.target.removeEventListener(e.type, e.fn, e.opsi);
        e.terpasang = false;
      });
    },
    sambung() {
      daftar.forEach((e) => {
        if (e.terpasang) return;
        e.target.addEventListener(e.type, e.fn, e.opsi);
        e.terpasang = true;
      });
    },
    buang() {
      daftar.forEach((e) => { if (e.terpasang) e.target.removeEventListener(e.type, e.fn, e.opsi); });
      daftar = [];
    },
    /** Untuk tes / debug: [{ type, terpasang }]. */
    status() { return daftar.map((e) => ({ type: e.type, terpasang: e.terpasang })); },
  };
}
