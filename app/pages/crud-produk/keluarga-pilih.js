// Keluarga set di form produk: nilai yang diketik dibandingkan dengan keluarga yang SUDAH ADA, supaya salah ketik
// ("AS" vs "AS.", "BASIC MINOR S 2" vs "BASIC MINOR S. 2") tidak diam-diam menjadi keluarga baru yang hampir kembar.
// Logika murni (tanpa DOM / database) supaya bisa dites. Sengaja TIDAK memakai jarak ketik (typo 1 huruf): nomor varian
// ("MAYOR S. 2" vs "MAYOR S. 3") berbeda 1 karakter padahal memang keluarga berbeda.
import { normKeluarga } from './atribut.js';

/** Kunci perbandingan: huruf besar, hanya huruf & angka (titik, spasi, tanda hubung diabaikan). */
export const kunciKeluarga = (s) => String(s == null ? '' : s).normalize('NFKD').toUpperCase().replace(/[^A-Z0-9]+/g, '');

/**
 * Status isian keluarga terhadap daftar keluarga yang ada.
 *  - kosong : tidak diisi (= ikut otomatis)
 *  - ada    : sama persis (setelah dirapikan) dengan keluarga yang sudah ada
 *  - mirip  : beda tanda baca / spasi saja dari keluarga yang ada -> saran = nama yang sudah ada
 *  - baru   : belum ada dan tidak mirip apa pun
 * -> { jenis, nilai, saran: string[] }
 */
export function statusKeluarga(input, daftar) {
  const nilai = normKeluarga(input);
  if (!nilai) return { jenis: 'kosong', nilai: null, saran: [] };
  const nama = [...new Set((daftar || []).map(normKeluarga).filter(Boolean))];
  if (nama.includes(nilai)) return { jenis: 'ada', nilai, saran: [] };
  const k = kunciKeluarga(nilai);
  const saran = k ? nama.filter((n) => kunciKeluarga(n) === k).slice(0, 3) : [];
  return { jenis: saran.length ? 'mirip' : 'baru', nilai, saran };
}
