// crud-produk/hapus-paksa.js
// Logika murni (tanpa DOM / database) untuk "Hapus permanen" produk. Penegakan sebenarnya ada di RPC
// hapus_produk_paksa (supabase/2026-11-27_hapus_produk_paksa.sql); file ini hanya merangkai teks dan kondisi UI.
// Dipisah dari index.js supaya bisa dites tanpa browser.

export const MODE_RIWAYAT = Object.freeze({ LEPAS: 'lepas', HAPUS: 'hapus' });

const LABEL_CASCADE = { harga: 'baris harga', media: 'media', akd: 'relasi AKD', komposisi: 'item komposisi set ini' };
const LABEL_RIWAYAT = { inaproc_pengajuan: 'riwayat pengajuan INAPROC', permintaan_item: 'riwayat Permintaan RS', konversi_item: 'riwayat konversi', permintaan_item_produk: 'tautan produk di Permintaan RS' };

/** Tombol hapus permanen hanya untuk admin yang izin hapusnya tidak dicabut. DB tetap yang memutuskan. */
export function bolehHapusPaksa(auth) {
  return !!auth?.isAdmin?.() && auth?.can?.('hapus') !== false;
}

/** Mode tak dikenal jatuh ke 'lepas' (yang paling aman: riwayat tetap ada). */
export function normalisasiMode(m) {
  return m === MODE_RIWAYAT.HAPUS ? MODE_RIWAYAT.HAPUS : MODE_RIWAYAT.LEPAS;
}

/** Hasil RPC (`dampak`) -> daftar { kelompok, label, jumlah } yang jumlahnya > 0. */
export function ringkasDampak(dampak) {
  const d = dampak || {};
  const out = [];
  const n = (v) => Number(v) || 0;
  for (const [k, label] of Object.entries(LABEL_CASCADE)) if (n(d.cascade?.[k]) > 0) out.push({ kelompok: 'cascade', label, jumlah: n(d.cascade[k]) });
  for (const [k, v] of Object.entries(d.cascade_lain || {})) if (n(v) > 0) out.push({ kelompok: 'cascade_lain', label: `baris di ${k} (ikut terhapus otomatis)`, jumlah: n(v) });
  if (n(d.set_lain) > 0) out.push({ kelompok: 'set_lain', label: 'SET lain yang memakai produk ini (item dilepas)', jumlah: n(d.set_lain) });
  const aksi = d.mode_riwayat === MODE_RIWAYAT.HAPUS ? 'dihapus' : 'dilepas, baris tetap ada';
  for (const [k, label] of Object.entries(LABEL_RIWAYAT)) if (n(d.riwayat?.[k]) > 0) out.push({ kelompok: 'riwayat', label: `${label} (${aksi})`, jumlah: n(d.riwayat[k]) });
  return out;
}

export function teksDampak(dampak) {
  const r = ringkasDampak(dampak);
  return r.length ? r.map((x) => `${x.jumlah.toLocaleString('id-ID')} ${x.label}`).join(', ') : 'tidak ada data terkait';
}

export function pesanKonfirmasi({ label, dampak }) {
  const m = dampak?.mode_riwayat === MODE_RIWAYAT.HAPUS ? 'Riwayat yang menunjuk ke produk ini IKUT DIHAPUS.' : 'Riwayat lintas modul tetap ada, hanya tautannya ke produk dilepas.';
  return `Hapus PERMANEN produk ${label || 'ini'}? Dampak: ${teksDampak(dampak)}. ${m} Tindakan ini tidak bisa dibatalkan (jejaknya dicatat di produk_hapus_audit).`;
}

/** Error RPC -> kalimat yang bisa dibaca orang. Kode HP_* berasal dari fungsi SQL. */
export function pesanErrorHapusPaksa(err) {
  const m = String((err && err.message) || err || '');
  if (/Could not find the function|PGRST202/i.test(m)) return 'Fungsi hapus permanen belum terpasang. Jalankan supabase/2026-11-27_hapus_produk_paksa.sql di Supabase SQL Editor.';
  const kode = (m.match(/HP_[A-Z_]+/) || [])[0];
  if (kode) return m.slice(m.indexOf(kode) + kode.length).replace(/^:\s*/, '').split('\n')[0] || m;
  return m || 'Gagal menghapus produk.';
}

/** Pratinjau valid hanya untuk produk + mode yang sama dengan yang akan dieksekusi. */
export const kunciPratinjau = (id, mode) => `${id}|${normalisasiMode(mode)}`;
