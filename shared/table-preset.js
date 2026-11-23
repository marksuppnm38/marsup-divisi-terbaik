// shared/table-preset.js
// Serah-terima kecil "buka tabel X dengan filter/urutan ini" antar halaman (mis. kartu dashboard
// "AKD kadaluarsa dalam 30 hari" -> tabel AKD sudah terfilter). Pakai sessionStorage, bukan query string:
// router SPA menolak path ber-query (isValidNavPath) dan tidak mempertahankan `?...`.
//
// Pengirim : setTablePreset({ table: 'akd', filters: [{ key, op, value }], sort: { key, dir } })
// Penerima : consumeTablePreset('akd') -> { filters, sort } | null   (dibaca SEKALI lalu dihapus)
//
// Preset kedaluwarsa 60 dtk: kalau navigasi gagal / dibatalkan, preset basi tidak boleh muncul
// belakangan dan membingungkan di kunjungan berikutnya.
const KEY = 'pnm_table_preset_v1';
const TTL_MS = 60 * 1000;

export function setTablePreset(preset) {
  try {
    if (!preset || typeof preset.table !== 'string') return;
    sessionStorage.setItem(KEY, JSON.stringify({ ...preset, at: Date.now() }));
  } catch (e) { /* sessionStorage ditolak (mode privat ketat) -> tabel terbuka tanpa preset, tidak fatal */ }
}

export function consumeTablePreset(table, now = Date.now()) {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || p.table !== table) return null; // milik tabel lain: biarkan, jangan dihapus
    sessionStorage.removeItem(KEY);
    if (!Number.isFinite(p.at) || now - p.at > TTL_MS) return null;
    return {
      filters: Array.isArray(p.filters) ? p.filters : [],
      sort: p.sort && typeof p.sort.key === 'string' ? p.sort : null,
    };
  } catch (e) { return null; }
}
