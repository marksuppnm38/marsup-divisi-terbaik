// auto-konversi/siap.js
// ══════════════════════════════════════════
// Chip status kesiapan jual (link V6 / AKD) untuk BARIS PRODUK yang ditawarkan ke staf: kandidat/alternatif Auto-Match
// dan panel "Tawarkan semua varian". Staf perlu langsung melihat, per baris, apakah produk itu SUDAH ada linknya —
// bukan baru tahu setelah dipakai. Murni (tanpa DOM/Supabase): `esc` (escape HTML) disuntikkan pemanggil, supaya bisa dites.
//
// Sumber data:
//   siap  : { ok, kurang[] } dari firm.js (assessProduk) — dipasang resolver di tiap kandidat. undefined = tidak dicek
//           (mode harga Swasta tidak memakai link e-Katalog, atau pengecekan gagal) → TIDAK menampilkan chip apa pun,
//           karena menebak "ada link" tanpa data lebih buruk daripada diam.
//   firm  : boolean dari RPC auto_konversi_tawarkan (link V6 bersih + AKD ada + bukan SINGLE USE). undefined = tidak diketahui.
// ══════════════════════════════════════════

// Teks `kurang` dari firm.js → label singkat. Urutan = prioritas pencocokan. Teks yang tidak dikenal tampil apa adanya.
const LABEL_KURANG = [
  [/link V6 belum dibuat/i, 'Belum ada link'],
  [/link V6 bukan URL/i, 'Link bukan URL'],
  [/belum firm/i, 'Link ada catatan'],
  [/AKD belum bisa dicek/i, 'AKD belum bisa dicek'],
  [/AKD belum ada/i, 'AKD belum ada']
];
export function labelKurang(teks) {
  const t = String(teks == null ? '' : teks);
  const hit = LABEL_KURANG.find(([re]) => re.test(t));
  return hit ? hit[1] : t;
}

const chip = (kelas, teks, judul, esc) =>
  `<span class="kb-siap ${kelas}" title="${esc(judul)}">${esc(teks)}</span>`;

// Kandidat Auto-Match. ok → satu chip hijau; belum siap → satu chip kuning per kekurangan (judulnya teks lengkap).
export function siapChipsHtml(siap, esc) {
  if (!siap || typeof siap.ok !== 'boolean') return '';
  if (siap.ok) return chip('ok', 'Link ✓', 'Link V6 sudah ada dan firm, AKD ada: siap dijual.', esc);
  const kurang = Array.isArray(siap.kurang) ? siap.kurang : [];
  if (!kurang.length) return chip('warn', 'Belum siap', 'Belum siap dijual.', esc);
  return kurang.map((k) => chip('warn', labelKurang(k), String(k), esc)).join('');
}

// Baris panel varian (kontrak RPC: boolean `firm`).
export function firmChipHtml(firm, esc) {
  if (firm === true) return chip('ok', 'Link ✓', 'Link V6 sudah ada dan firm: siap dijual.', esc);
  if (firm === false) return chip('warn', 'Belum firm', 'Link V6 belum ada atau masih ada catatan, atau AKD belum ada.', esc);
  return '';
}
