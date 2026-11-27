// Keep-alive: logika MURNI "tempat parkir" modul (tanpa DOM, tanpa window) -- dipakai router.js.
// Dipisah dari router.js supaya aturan LRU / TTL / draft bisa dites dengan `node --test`
// (lihat keepalive.test.mjs). Yang disimpan di sini hanya nilai buram (`value`) per id modul;
// apa isinya (halaman, DocumentFragment, daftar <style>) urusan router.
//
// ATURAN (rencana bagian 9.2):
//  - Maksimal `max` (bawaan 3) modul terparkir. Kelebihan dibuang dari yang BERSIH paling lama
//    diparkir (LRU: parkir ulang = dianggap baru dipakai).
//  - Modul bersih yang terparkir lebih dari `ttlMs` (bawaan 30 menit) kedaluwarsa.
//  - Modul DIRTY (isDirty() true = ada draft belum disimpan) TIDAK PERNAH dibuang LRU maupun TTL.
//    Konsekuensinya batas `max` boleh terlampaui kalau semua kandidat dirty; jumlahnya tetap
//    dibatasi banyaknya modul, jadi tidak tumbuh tanpa batas.
//  - isDirty() yang melempar error dianggap dirty: lebih baik menahan modul daripada
//    membuang draft karena bug kecil.
//  - Entri yang BARU diparkir tidak pernah jadi korban LRU pada pemanggilan park() yang sama.

export const DEFAULT_MAX_PARKED = 3;
export const DEFAULT_TTL_MS = 30 * 60 * 1000;

export function createParkingLot({ max = DEFAULT_MAX_PARKED, ttlMs = DEFAULT_TTL_MS, now = Date.now } = {}) {
  /** @type {Map<string, {value: any, parkedAt: number, seq: number, isDirty: () => boolean}>} */
  const entries = new Map();
  let seq = 0; // pemecah seri kalau dua entri diparkir di milidetik yang sama

  function dirtyOf(entry) {
    try { return !!entry.isDirty(); } catch (err) { return true; }
  }

  const toList = (items) => items.map(([id, e]) => ({ id, value: e.value }));

  // Entri bersih, dari yang paling lama diparkir. `exceptId` = entri yang tidak boleh jadi korban.
  function cleanOldestFirst(exceptId) {
    return [...entries.entries()]
      .filter(([id, e]) => id !== exceptId && !dirtyOf(e))
      .sort((a, b) => a[1].parkedAt - b[1].parkedAt || a[1].seq - b[1].seq);
  }

  return {
    // Parkir `value` untuk `id`. Mengembalikan entri yang harus dibuang sungguhan (LRU): [{id, value}].
    park(id, value, { isDirty = () => false } = {}) {
      entries.set(id, { value, parkedAt: now(), seq: ++seq, isDirty });
      const evicted = [];
      while (entries.size > max) {
        const victim = cleanOldestFirst(id)[0];
        if (!victim) break; // semua kandidat dirty: biarkan melampaui batas
        entries.delete(victim[0]);
        evicted.push(victim);
      }
      return toList(evicted);
    },

    // Ambil keluar (untuk di-resume). Entri dihapus dari tempat parkir. null kalau tidak ada.
    take(id) {
      const e = entries.get(id);
      if (!e) return null;
      entries.delete(id);
      return e.value;
    },

    has: (id) => entries.has(id),
    get size() { return entries.size; },
    ids: () => [...entries.keys()],

    // Entri bersih yang sudah melewati TTL dikeluarkan dan dikembalikan: [{id, value}].
    sweep() {
      const t = now();
      const expired = [...entries.entries()].filter(([, e]) => t - e.parkedAt > ttlMs && !dirtyOf(e));
      expired.forEach(([id]) => entries.delete(id));
      return toList(expired);
    },

    // Id modul terparkir yang punya draft (untuk titik "ada draft" di sidebar).
    dirtyIds() {
      return [...entries.entries()].filter(([, e]) => dirtyOf(e)).map(([id]) => id);
    },

    // Kosongkan semua (logout). Mengembalikan semua entri supaya router bisa unmount sungguhan.
    clear() {
      const all = [...entries.entries()];
      entries.clear();
      return toList(all);
    },
  };
}
