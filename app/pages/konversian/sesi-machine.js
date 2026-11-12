// ═══════════════════════════════════════════════════════════════════════════
// SESI MACHINE — lifecycle "sesi yang lagi kepegang di layar ini", dijadiin eksplisit.
//
// Dulu state ini TERSEBAR dan implisit:
//   - "ada sesi gak?" = S.currentSesiId != null, ditulis langsung di 9 tempat
//     (clipboard.js x4, dictionary.js, index.js x2, + init) tanpa aturan transisi.
//   - "sesi udah ditutup (selesai) tapi masih kepegang di layar" (habis Record, atau
//     ditutup kolaborator lain / sweep mandek) GAK PUNYA nama — cuma tersirat dari
//     komentar, dan realtime.js nyimpen status server sendiri di sesiKnown.status.
//   - "lagi bikin sesi (POST in flight)" gak ada sama sekali → ensureSesi() yang
//     dipanggil 2x berdekatan bikin 2 sesi (race), yang kedua ditimpa jadi yatim.
//   - blok "bersihin layar" ada 5 salinan yang beda-beda tipis (satu lupa reset
//     pagu → pagu sesi lama kebawa ke sesi baru lewat ensureSesi()).
//
// Sekarang: satu tempat. Fase:
//   idle      belum ada sesi kepegang (currentSesiId === null)
//   creating  POST sesi baru lagi jalan (ensure() yang lain ikut nunggu, gak POST lagi)
//   active    sesi kepegang, di server masih 'berjalan'
//   closed    sesi kepegang, di server udah 'selesai' (Record / ditutup orang lain / sweep).
//             SENGAJA tetap kepegang: Export setelah Record butuh currentSesiId buat nomor -REVx.
//
// Transisi (satu-satunya jalan ngubah currentSesiId):
//   ensure(create)  idle → creating → active      (atau join yang lagi jalan / balikin id yg ada)
//   attach(sesi)    * → active | closed           (buka sesi dari daftar / link share)
//   close(reason)   active → closed               (Record, kolaborator/sweep nutup)
//   detach(reason)  * → idle + bersihin layar     (Sesi Baru, Keluar, Selesaikan, Hapus, Muat Revisi)
//
// Token `gen` naik tiap attach/detach: create() yang kelar SESUDAH layar pindah sesi
// dibuang (gak boleh nimpa sesi yang sekarang kepegang).
// ═══════════════════════════════════════════════════════════════════════════
export function installSesiMachine(S) {
  const PHASE = Object.freeze({ IDLE: 'idle', CREATING: 'creating', ACTIVE: 'active', CLOSED: 'closed' });
  const ALLOWED = {
    idle: ['creating', 'active', 'closed'],
    creating: ['active', 'closed', 'idle'],
    active: ['closed', 'idle', 'active'],
    closed: ['active', 'idle', 'closed'],
  };

  let phase = PHASE.IDLE;
  let id = null;
  let gen = 0;
  let slot = null; // { gen, promise } — create yang lagi jalan
  const listeners = [];

  function go(to, reason) {
    const from = phase;
    if (from !== to && !ALLOWED[from].includes(to)) {
      console.error(`[sesi] transisi ilegal ${from} → ${to} (${reason}) — diabaikan`);
      return false;
    }
    phase = to;
    if (from !== to || reason === 'attach') {
      listeners.forEach(fn => { try { fn({ from, to, reason, id }); } catch (e) { console.error('[sesi] listener error', e); } });
    }
    return true;
  }

  const m = {
    PHASE,
    get phase() { return phase; },
    get id() { return id; },
    get isAttached() { return id != null; },
    get isClosed() { return phase === PHASE.CLOSED; },
    on(fn) { listeners.push(fn); },

    // Balikin id sesi; bikin lewat create() kalau belum ada. create() harus return baris sesi ({id, status?}).
    // Pemanggil bersamaan join ke promise yang sama → gak ada sesi dobel.
    ensure(create) {
      if (id != null) return Promise.resolve(id);
      if (slot && slot.gen === gen) return slot.promise;
      const myGen = gen;
      const mine = { gen: myGen, promise: null };
      slot = mine;
      go(PHASE.CREATING, 'ensure');
      mine.promise = (async () => {
        try {
          const row = await create();
          if (myGen !== gen) throw new Error('Layar pindah sesi saat sesi baru dibuat — ulangi aksinya.');
          id = row.id;
          go(row.status && row.status !== 'berjalan' ? PHASE.CLOSED : PHASE.ACTIVE, 'created');
          return id;
        } catch (err) {
          if (myGen === gen && phase === PHASE.CREATING) go(PHASE.IDLE, 'create-failed');
          throw err;
        } finally {
          if (slot === mine) slot = null;
        }
      })();
      return mine.promise;
    },

    // Pegang sesi yang SUDAH ada di server (openSesi). Status 'selesai' → fase closed.
    attach(sesi) {
      gen++; slot = null;
      id = sesi.id;
      go(sesi.status && sesi.status !== 'berjalan' ? PHASE.CLOSED : PHASE.ACTIVE, 'attach');
    },

    // Server bilang sesi yang kepegang udah 'selesai'. Cuma berlaku dari active; sisanya no-op.
    close(reason) {
      if (phase !== PHASE.ACTIVE) return false;
      return go(PHASE.CLOSED, reason || 'close');
    },

    // Lepas sesi dari layar + bersihin SEMUA state turunannya, satu jalur (ganti 5 salinan blok reset).
    // opts: { rs, sales, marsup } isi header sesudah dibersihin (default kosong; marsup default dibiarin
    //        karena itu PIC si pemakai), { headerCollapsed: [collapsed, persist] }.
    detach(reason, opts) {
      const o = opts || {};
      gen++; slot = null;
      id = null;
      go(PHASE.IDLE, reason || 'detach');
      S.currentButuhBantuan = false;
      S.checklistPagu = null; // dulu gak pernah direset → pagu sesi lama kebawa ke sesi baru (ensureSesi nge-POST-nya)
      S.clipboard = [];
      S.inpRs.value = o.rs || '';
      S.inpSales.value = o.sales || '';
      if (o.marsup) S.inpMarsup.value = o.marsup;
      S.updateClipboard();
      S.renderResults(S.lastResults);
      S.setClipHeaderCollapsed(...(o.headerCollapsed || [false]));
      S.updateClipHeaderCompact();
      S.renderButuhBantuanBtn();
      S.setSesiSavedStatus('');
      S.resetChecklistUI(); // ini juga yang mutus channel realtime sesi lama
    },
  };

  // Akses lama (S.currentSesiId) tetap jalan buat BACA. Nulis langsung dilarang — lewat m.*.
  Object.defineProperty(S, 'currentSesiId', {
    configurable: true,
    enumerable: true,
    get() { return id; },
    set(v) {
      console.warn('[sesi] S.currentSesiId ditulis langsung — pakai S.sesi.ensure/attach/detach');
      if (v == null) { gen++; slot = null; id = null; go(PHASE.IDLE, 'legacy-set'); }
      else { gen++; slot = null; id = v; go(PHASE.ACTIVE, 'legacy-set'); }
    },
  });

  S.sesi = m;
  return m;
}