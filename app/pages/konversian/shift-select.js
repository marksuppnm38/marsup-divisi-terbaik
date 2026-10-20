// shift-select.js — Shift+klik pilih rentang + "Centang yang tampil" — Claude, 2026-10-20.
// Satu listener delegasi (S.onGlobal -> otomatis lepas di unmount) buat semua grup
// checkbox di konversian, tanpa nyentuh logic centang masing-masing grup:
//   conv   : .conv-check di Converter (hasil cocok-in bulk)
//   picker : input[data-picker-check] di picker "Bisa Dipenuhi" (Kebutuhan RS)
//   ekat   : .ek-cb di tabel "Lihat isi" Riwayat (item yang di-klik di e-Kat)
// Cara kerja: klik biasa = jadi "anchor" (diinget per grup+scope). Shift+klik di
// checkbox lain = semua checkbox KELIHATAN di antara anchor & yang diklik ikut
// jadi state yang diklik. Yang ke-filter (display:none) otomatis gak kena,
// jadi "ketik gunting -> klik awal -> shift+klik akhir" cuma nyentuh gunting.
// Aman dari re-render: anchor disimpen sebagai id logis (kode/idx), bukan elemen.
export function installShiftSelect(S) {
  const visible = (c) => !c.disabled && c.getClientRects().length > 0;

  const GROUPS = [
    { name: 'conv', check: '.conv-check',
      scope: (c) => c.closest('#conv-results'),
      key:   () => 'conv',
      id:    (c) => c.dataset.idx },
    { name: 'picker', check: 'input[data-picker-check]',
      scope: (c) => c.closest('.kb-picker-list'),
      key:   (c) => c.dataset.pickerCheck,
      id:    (c) => c.dataset.kode },
    { name: 'ekat', check: '.ek-cb',
      scope: (c) => c.closest('tbody'),
      key:   (c) => c.closest('.riwayat-card')?.dataset.id || '',
      id:    (c) => c.closest('tr')?.dataset.kode,
      // toggleKlikEkat() me-refresh SEMUA checkbox dari state tiap panggilan, jadi
      // event change satu-satu bakal saling nimpa -> pakai jalur batch.
      batch: (chks, on) => {
        const card = chks[0].closest('.riwayat-card');
        if (!card || !S.setKlikEkatMany) return false;
        S.setKlikEkatMany(card.dataset.id, chks.map(c => c.closest('tr').dataset.kode).filter(Boolean), on, card);
        return true;
      } },
  ];
  const PICKER = GROUPS[1];

  const anchors = new Map();   // `${group}:${key}` -> id logis checkbox terakhir yang diklik
  let labelShift = false;      // klik di <label> -> browser nembak klik sintetis ke input; bawa status Shift-nya

  // Set semua dulu BARU kirim event change — penting buat picker: refreshPickerAlloc()
  // ngisi qty otomatis kalau baru 1 yang tercentang; kalau dikirim per-satu sambil
  // nyentang, produk pertama bakal kebagian qty_diminta penuh padahal yang dipilih banyak.
  function applyState(group, chks, on) {
    const changed = chks.filter(c => c.checked !== on);
    if (!changed.length) return;
    changed.forEach(c => { c.checked = on; });
    if (group.batch && group.batch(changed, on)) return;
    changed.forEach(c => c.dispatchEvent(new Event('change', { bubbles: true })));
  }

  // Cegah teks ke-blok biru pas Shift+klik di baris checkbox; input/tombol lain dibiarin.
  S.onGlobal(document, 'mousedown', (e) => {
    if (!e.shiftKey) return;
    if (e.target.closest('input:not([type="checkbox"]), button, a, textarea, select')) return;
    const row = e.target.closest('label.kb-picker-row, .clip-item, .riwayat-peek tbody tr');
    if (row && row.querySelector('.conv-check, input[data-picker-check], .ek-cb')) e.preventDefault();
  });

  S.onGlobal(document, 'click', (e) => {
    // 1) Tombol "Centang yang tampil" / "Kosongkan yang tampil" di picker.
    const selBtn = e.target.closest && e.target.closest('[data-picker-selvis]');
    if (selBtn) {
      const itemId = selBtn.dataset.pickerSelvis;
      const list = document.querySelector(`.kb-picker-list[data-picker-list="${CSS.escape(itemId)}"]`);
      if (!list) return;
      const chks = [...list.querySelectorAll('input[data-picker-check]')].filter(visible);
      applyState(PICKER, chks, selBtn.dataset.mode === 'on');
      return;
    }

    // 2) Shift+klik rentang.
    const chk = e.target;
    if (!chk.matches || !chk.matches('input[type="checkbox"]')) {
      // Klik di teks <label>: simpan status Shift buat klik sintetis ke input yang nyusul.
      if (e.target.closest && e.target.closest('label')) { labelShift = e.shiftKey; setTimeout(() => { labelShift = false; }, 0); }
      return;
    }
    const group = GROUPS.find(g => chk.matches(g.check));
    if (!group) return;
    const scope = group.scope(chk);
    if (!scope) return;
    const slot = `${group.name}:${group.key(chk)}`;
    const myId = group.id(chk);
    const shift = e.shiftKey || labelShift;
    const anchorId = anchors.get(slot);
    anchors.set(slot, myId);
    if (!shift || anchorId == null || anchorId === myId) return;

    const all = [...scope.querySelectorAll(group.check)].filter(visible);
    const a = all.findIndex(c => group.id(c) === anchorId);
    const b = all.indexOf(chk);
    if (a < 0 || b < 0) return;   // anchor hilang / ke-filter -> perlakukan sebagai klik biasa
    const [from, to] = a < b ? [a, b] : [b, a];
    applyState(group, all.slice(from, to + 1), chk.checked); // ikut state checkbox yang barusan diklik
  });
}