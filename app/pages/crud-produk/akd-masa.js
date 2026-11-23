// akd-masa.js — status masa berlaku AKD. Murni (tanpa DOM / jaringan), dites di akd-masa.test.mjs.
// Ambang "segera habis" = 30 hari, sama dengan kartu dashboard dan preset "Kadaluarsa ≤ 30 hari lagi" di tabel AKD.
export const AKD_WASPADA_HARI = 30;

/**
 * iso: 'YYYY-MM-DD' (atau timestamp yang diawali itu). Hasil: { tone, days, label, hint }
 *   tone: 'none' (kosong) | 'bad' (sudah lewat) | 'warn' (<= 30 hari, termasuk hari ini) | 'ok'
 *   hint: teks pendamping hanya bila perlu tindakan ("19 hari lagi", "lewat 3 hari"), kosong kalau aman.
 */
export function masaBerlakuInfo(iso, today = new Date()) {
  if (!iso) return { tone: 'none', days: null, label: '', hint: '' };
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  if (!m) return { tone: 'none', days: null, label: String(iso), hint: '' };
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const days = Math.round((Date.UTC(y, mo - 1, d) - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000);
  const label = new Date(y, mo - 1, d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
  if (days < 0) return { tone: 'bad', days, label, hint: `lewat ${-days} hari` };
  if (days === 0) return { tone: 'warn', days, label, hint: 'hari ini' };
  if (days <= AKD_WASPADA_HARI) return { tone: 'warn', days, label, hint: `${days} hari lagi` };
  return { tone: 'ok', days, label, hint: '' };
}
