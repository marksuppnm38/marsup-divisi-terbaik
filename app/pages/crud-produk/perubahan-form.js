// Penanda perubahan form "Info Dasar": membandingkan isi form sekarang dengan snapshot saat produk selesai dimuat.
// Logika murni (tanpa DOM / database) supaya bisa dites. DOM-nya ada di index.js (bacaFormDasar, renderPerubahan).

/**
 * Field yang dilacak. `sensitif` = perubahannya ditampilkan inline "Sebelumnya: …" (nama, brand, keluarga manual),
 * karena salah ubah di sini paling mahal akibatnya (judul di semua daftar, filter brand, pengelompokan set).
 */
export const FIELD_PERUBAHAN = Object.freeze([
  { key: 'nama_produk',   label: 'Nama produk',     sensitif: true,  elId: 'f_nama_produk' },
  { key: 'brand',         label: 'Brand',           sensitif: true,  elId: 'f_brand' },
  { key: 'berat_gram',    label: 'Berat',           sensitif: false, elId: 'f_berat_gram' },
  { key: 'link_v6',       label: 'Link V6',         sensitif: false, elId: 'f_link_v6' },
  { key: 'spesifikasi',   label: 'Spesifikasi',     sensitif: false, elId: 'f_spesifikasi' },
  { key: 'kode_asli',     label: 'Kode asli',       sensitif: false, elId: 'f_kode_asli' },
  { key: 'm_deskripsi',   label: 'Deskripsi vendor', sensitif: false, elId: 'm_deskripsi_vendor' },
  { key: 'm_family',      label: 'Family',          sensitif: false, elId: 'm_family' },
  { key: 'klas_keluarga', label: 'Keluarga set',    sensitif: true,  elId: 'f_klas_keluarga' },
  { key: 'klas_kategori', label: 'Kategori',        sensitif: false, elId: 'f_klas_kategori' },
  { key: 'klas_spes',     label: 'Spesialisasi',    sensitif: false, elId: 'f_klas_spes' },
]);

const rapikan = (v) => String(v ?? '').trim().replace(/\s+/g, ' ');

/** Nilai disamakan bentuknya sebelum dibandingkan: kosong/null/undefined sama, spasi dirapikan, brand huruf besar, angka dibandingkan sebagai angka. */
export function normNilai(key, v) {
  if (key === 'brand') return rapikan(v).toUpperCase();
  if (key === 'berat_gram') {
    const s = rapikan(v);
    if (s === '') return '';
    const n = Number(s.replace(',', '.'));
    return Number.isFinite(n) ? String(n) : s;
  }
  // Teks panjang: hanya ujung yang dipangkas (spasi / baris baru di tengah itu isi, bukan kerapian).
  if (key === 'spesifikasi' || key === 'm_deskripsi') return String(v ?? '').trim();
  return rapikan(v);
}

/**
 * snap = isi form saat dimuat, kini = isi form sekarang (objek { key: nilai }).
 * Key yang tidak ada di snapshot (belum selesai dimuat, mis. klasifikasi / master) DILEWATI, bukan dianggap berubah.
 * -> { jumlah, daftar: [{ key, label, sensitif, elId, sebelum, sesudah }], kunci: Set<string> }
 */
export function hitungPerubahan(snap, kini) {
  const daftar = [];
  if (snap && kini) {
    for (const f of FIELD_PERUBAHAN) {
      if (!(f.key in snap) || snap[f.key] === undefined) continue;
      const a = normNilai(f.key, snap[f.key]);
      const b = normNilai(f.key, kini[f.key]);
      if (a !== b) daftar.push({ key: f.key, label: f.label, sensitif: f.sensitif, elId: f.elId, sebelum: a, sesudah: b });
    }
  }
  return { jumlah: daftar.length, daftar, kunci: new Set(daftar.map((d) => d.key)) };
}

/** Teks tombol Simpan. 0 / tidak diketahui -> "Simpan". */
export function labelSimpan(jumlah) {
  return jumlah > 0 ? `Simpan (${jumlah})` : 'Simpan';
}

/** Teks "Sebelumnya: …" untuk field sensitif; nilai kosong ditulis eksplisit; teks panjang dipotong. */
export function catatanSebelumnya(sebelum, kosong = '(kosong)', maks = 60) {
  const s = String(sebelum ?? '').trim();
  if (!s) return `Sebelumnya: ${kosong}`;
  return `Sebelumnya: ${s.length > maks ? s.slice(0, maks - 1) + '…' : s}`;
}

/** Perbarui sebagian snapshot (mis. hanya bagian yang berhasil tersimpan). Tidak mengubah objek asal. */
export function perbaruiSnapshot(snap, bagian) {
  return { ...(snap || {}), ...(bagian || {}) };
}
