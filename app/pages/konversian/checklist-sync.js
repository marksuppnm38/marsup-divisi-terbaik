// checklist-sync.js
// ══════════════════════════════════════════
// Sinkronisasi checklist Kebutuhan RS: snapshot dari server TIDAK boleh menimpa perubahan lokal yang lebih baru.
//
// Masalah yang diselesaikan (counter "7/21" tiba-tiba balik "1/21"):
//   loadChecklistForSesi() dulu mengganti SELURUH S.checklistItems dengan hasil fetch. Kalau fetch itu berangkat
//   sebelum sebuah tulisan lokal selesai (mis. di tengah "Pakai N yang cocok", atau saat resync realtime), balasannya
//   snapshot BASI dan menimpa status yang baru ditulis -> counter turun, lalu naik lagi di reload berikutnya.
//   Selain itu objek item diganti baru, sehingga loop yang masih memegang referensi item lama menulis ke objek yatim.
//
// Aturan di sini:
//   1. Tiap tulisan status item dicatat (begin/end). Perubahan dari rekan (broadcast) dicatat lewat note().
//   2. Snapshot dicap waktu mulai-fetch (t0). Item yang "kotor" = sedang ditulis, atau perubahan lokal terakhirnya
//      terjadi pada/setelah t0 -> snapshot untuk item itu dianggap basi: status & matched_items lokal dipertahankan.
//   3. Objek item dipertahankan (Object.assign), supaya referensi yang dipegang kode lain tetap hidup.
// Murni (tanpa DOM/Supabase) supaya bisa dites.
// ══════════════════════════════════════════

export function createItemWriteTracker({ now = Date.now, keepMs = 60000 } = {}) {
  const w = new Map(); // id -> { inflight, lastEnd }
  const prune = () => {
    const t = now();
    for (const [id, e] of w) if (e.inflight <= 0 && t - e.lastEnd > keepMs) w.delete(id);
  };
  const get = (id) => { let e = w.get(id); if (!e) { e = { inflight: 0, lastEnd: 0 }; w.set(id, e); } return e; };
  return {
    begin(id) { if (id == null) return; get(id).inflight++; },
    end(id) { if (id == null) return; const e = get(id); e.inflight = Math.max(0, e.inflight - 1); e.lastEnd = now(); prune(); },
    // Perubahan item yang datang dari luar (broadcast rekan): sama pentingnya dengan tulisan lokal.
    note(id) { if (id == null) return; get(id).lastEnd = now(); },
    // >= (bukan >): kalau waktunya persis sama, berpihak ke data lokal.
    isDirty(id, t0) { const e = w.get(id); return !!e && (e.inflight > 0 || e.lastEnd >= t0); },
    async track(id, fn) {
      this.begin(id);
      try { return await fn(); } finally { this.end(id); }
    },
    size() { return w.size; }
  };
}

// local: S.checklistItems saat ini; server: data.items dari server; t0: waktu SEBELUM fetch dimulai.
// Mengembalikan array baru berurutan seperti server. Item yang tidak ada di server dibuang (dihapus rekan).
export function mergeChecklistSnapshot(local, server, tracker, t0) {
  const byId = new Map((local || []).map((i) => [i.id, i]));
  return (server || []).map((s) => {
    const o = byId.get(s.id);
    if (!o) return s;
    if (tracker && tracker.isDirty(s.id, t0)) {
      const { status, matched_items } = o;
      Object.assign(o, s);
      o.status = status;
      o.matched_items = matched_items;
      return o;
    }
    // Format lama dari server (tanpa matched_items) -> jangan biarkan nilai lokal yang basi lolos normalisasi.
    if (!Object.prototype.hasOwnProperty.call(s, 'matched_items')) delete o.matched_items;
    Object.assign(o, s);
    return o;
  });
}
