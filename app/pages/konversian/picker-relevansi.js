// picker-relevansi.js — urutan & pengelompokan picker produk di Kebutuhan RS (Fase 3 redesain panel, 2026-11-25).
// ══════════════════════════════════════════
// Memilah isi clipboard jadi "Cocok" dan "Lainnya" terhadap NAMA KEBUTUHAN, murni dari kecocokan token nama
// (tanpa RPC, tanpa katalog). Tujuannya cuma urutan tampilan: yang disimpan ke server (link produk, qty_alokasi)
// tidak disentuh sama sekali.
//
// Aturan:
//   • Token = kata hasil upper-case + TYPO_FIXES (aliases.js), dipisah tanda baca. "S." berdiri sendiri = "SET".
//   • Token LEMAH (tidak bisa membuat produk jadi "Cocok" sendirian): kata jenis/umum (SET, ALL, UNIT, PCS, CM, …)
//     dan angka polos. Token KUAT = sisanya (MINOR, GUNTING, MAYO, …).
//   • Produk "Cocok" bila minimal satu token KUAT permintaan ada di kode/nama produk (sama persis, atau awalan
//     untuk kata ≥ 4 huruf). Kalau permintaan tidak punya token kuat sama sekali, token lemah dipakai.
//   • Skor = bobot token cocok / bobot semua token (kuat = 1, lemah = 0,25). Cocok diurut skor menurun; seri
//     mengikuti urutan clipboard (stabil). "Lainnya" mengikuti urutan clipboard.
//   • Produk yang SUDAH terpasang ke kebutuhan ini selalu di "Cocok" dan paling atas (pilihan sengaja jangan
//     terkubur di "Lainnya" yang diciutkan).
//   • Permintaan tanpa token sama sekali → tidak ada dasar memilah: cocok = [], lainnya = semua (UI menampilkan
//     daftar datar tanpa kepala grup).
// PURE: tanpa DOM / Supabase, aman dites di Node.
// ══════════════════════════════════════════
import { TYPO_FIXES } from './auto-konversi/aliases.js';

const LEMAH = new Set([
  'SET', 'ALL', 'DAN', 'UNTUK', 'YANG', 'DENGAN', 'DI', 'DARI', 'ATAU', 'UNIT', 'PCS', 'PC', 'BUAH', 'BOX', 'PAK',
  'CM', 'MM', 'NO', 'NOMOR', 'TYPE', 'TIPE', 'ISI'
]);
const BOBOT_LEMAH = 0.25;

export function tokensRelevansi(teks) {
  let up = String(teks == null ? '' : teks).toUpperCase();
  up = TYPO_FIXES.reduce((t, [re, rep]) => t.replace(re, rep), up);
  up = up.replace(/(\d),(\d)/g, '$1.$2').replace(/(\d)\s+(CM|MM)\b/g, '$1$2');
  const out = [];
  for (const raw of up.split(/[^A-Z0-9.]+/)) {
    let t = raw.replace(/^\.+|\.+$/g, '');
    if (!t) continue;
    if (t === 'S') t = 'SET';                       // "MINOR S." = "MINOR SET"
    if (t.length < 2 && !/^\d$/.test(t)) continue;  // huruf tunggal lain = bukan kata
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

const lemah = (t) => LEMAH.has(t) || /^\d+(?:\.\d+)?$/.test(t);

function cocokToken(t, haystack) {
  if (haystack.has(t)) return true;
  if (t.length < 4) return false;
  for (const h of haystack) if (h.length >= 4 && (h.startsWith(t) || t.startsWith(h))) return true;
  return false;
}

// → { cocok: [{ c, skor }], lainnya: [{ c, skor }] }   (c = item clipboard apa adanya)
export function urutkanPicker(namaKebutuhan, clipboard, kodeTerpasang = []) {
  const items = Array.isArray(clipboard) ? clipboard : [];
  const terpasang = new Set(kodeTerpasang || []);
  const req = tokensRelevansi(namaKebutuhan);
  if (!req.length) return { cocok: [], lainnya: items.map((c) => ({ c, skor: 0 })) };

  const kuat = req.filter((t) => !lemah(t));
  const bobot = (t) => (lemah(t) ? BOBOT_LEMAH : 1);
  const total = req.reduce((s, t) => s + bobot(t), 0);
  const penentu = kuat.length ? kuat : req; // tanpa token kuat: token lemah boleh menentukan

  const cocok = [], lainnya = [];
  items.forEach((c, idx) => {
    const hay = new Set(tokensRelevansi(`${c.kode_produk || ''} ${c.nama_produk || ''}`));
    const skor = req.reduce((s, t) => s + (cocokToken(t, hay) ? bobot(t) : 0), 0) / total;
    const lolos = penentu.some((t) => cocokToken(t, hay));
    const dipasang = terpasang.has(c.kode_produk);
    if (lolos || dipasang) cocok.push({ c, skor: dipasang ? skor + 10 : skor, idx });
    else lainnya.push({ c, skor, idx });
  });
  cocok.sort((a, b) => (b.skor - a.skor) || (a.idx - b.idx));
  return {
    cocok: cocok.map(({ c, skor }) => ({ c, skor: skor >= 10 ? skor - 10 : skor })),
    lainnya: lainnya.map(({ c, skor }) => ({ c, skor }))
  };
}
