// AUTO-EXTRACTED dari crud-produk/index.js (breakup, pola sama kayak
// konversian/dictionary.js dkk). BEDA dari modul konversian:
// keempat fungsi di sini TIDAK butuh shared state 'S' sama sekali (murni
// terima parameter + document.getElementById + window.PNMToast global),
// jadi diekspor langsung sebagai named export, bukan lewat installXxx(S).
// Logic di dalam TIDAK diubah sama sekali dari versi asli di index.js.

export const PESAN_TANPA_IZIN_HAPUS = 'Akun kamu tidak punya izin menghapus data.';
/** false (+ toast) kalau akun ini tidak boleh menghapus. Pagar kedua di handler; pagar pertama = tombol disembunyikan, pagar utama = RLS. */
export function guardHapus(){
  if (window.PNMAuth?.can?.('hapus') === false) { showToast(PESAN_TANPA_IZIN_HAPUS, true); return false; }
  return true;
}
/** Hasil .delete().select('id'): true kalau ada baris yang benar-benar terhapus. 0 baris tanpa error = ditolak RLS / sudah hilang. */
export function barisTerhapus(res){ return !res.error && Array.isArray(res.data) && res.data.length > 0; }

export function showToast(msg, kind, opts){
  // Body delegate ke shared/toast.js. `kind` boleh boolean lama (true = error) atau nama tipe
  // ('warning', 'info', ...). Durasi ditentukan toast.js dari panjang teks, kecuali `opts.duration`.
  const type = kind === true ? 'error' : (typeof kind === 'string' ? kind : 'success');
  PNMToast.show(msg, type, opts);
}

// Pengganti window.confirm()/alert() bawaan browser -- dibangun di atas
// .confirm-overlay/.confirm-card/.confirm-actions yang harus SUDAH ADA di
// markup halaman pemanggil (lihat CRUD_PRODUK_MARKUP: #genericConfirmOverlay
// dkk). Escape=batal, Enter=OK, listener di-attach/lepas per panggilan biar
// gak numpuk.
export function crudConfirm(message, { title = 'Konfirmasi', okLabel = 'Ya, Lanjutkan', danger = false, alertOnly = false } = {}) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('genericConfirmOverlay');
    const card = document.getElementById('genericConfirmCard');
    const iconEl = document.getElementById('genericConfirmIcon');
    const titleEl = document.getElementById('genericConfirmTitle');
    const msgEl = document.getElementById('genericConfirmMsg');
    const cancelBtn = document.getElementById('genericConfirmCancelBtn');
    const okBtn = document.getElementById('genericConfirmOkBtn');

    titleEl.textContent = title;
    msgEl.textContent = message;
    msgEl.style.whiteSpace = 'pre-line'; // biar \n di pesan (daftar kode, dll) kebaca sebagai baris baru
    okBtn.textContent = alertOnly ? 'Oke' : okLabel;
    card.classList.toggle('danger', danger);
    iconEl.className = danger ? 'ti ti-alert-triangle' : 'ti ti-info-circle';
    okBtn.classList.toggle('btn-accent', !danger);
    okBtn.classList.toggle('btn-danger-ghost', danger);
    cancelBtn.style.display = alertOnly ? 'none' : '';

    function cleanup(result) {
      overlay.classList.remove('open');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onOverlay);
      document.removeEventListener('keydown', onKey);
      resolve(result);
    }
    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }
    function onOverlay(e) { if (e.target === overlay) cleanup(false); }
    function onKey(e) {
      if (e.key === 'Escape') { cleanup(false); return; }
      if (e.key === 'Enter') { cleanup(true); }
    }

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    overlay.addEventListener('click', onOverlay);
    document.addEventListener('keydown', onKey);
    overlay.classList.add('open');
  });
}

// alert() polos -- lewat fungsi yang sama, cuma alertOnly:true nyembunyiin
// tombol Batal.
export function crudAlert(message, opts = {}) {
  return crudConfirm(message, { title: 'Perhatian', ...opts, alertOnly: true });
}

// ---- Pagination reusable — dipakai di Produk, Set Management, Log Aktivitas ----
// el: elemen container. page: halaman aktif (mulai dari 1). pageSize: item per
// halaman. total: total item keseluruhan (dari count exact / panjang array).
// onPageChange(newPage): dipanggil pas user klik halaman lain.
export function renderPgBar(el, { page, pageSize, total, onPageChange }){
  // FIX: el bisa null kalau pemanggil (loadProduk() dkk, semua async & await
  // network) resolve SETELAH user udah pindah halaman -- router.js ngosongin
  // container.innerHTML SEBELUM mount() halaman baru jalan.
  if (!el) return;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0 || totalPages <= 1) { el.innerHTML = ''; el.style.display = 'none'; return; }
  el.style.display = 'flex';

  const startItem = (page - 1) * pageSize + 1;
  const endItem = Math.min(page * pageSize, total);

  const pagesToShow = [...new Set([1, totalPages, page - 1, page, page + 1])]
    .filter(p => p >= 1 && p <= totalPages)
    .sort((a, b) => a - b);

  let numberBtns = '';
  let prevP = null;
  pagesToShow.forEach(p => {
    if (prevP !== null && p - prevP > 1) numberBtns += `<span class="pg-ellipsis">…</span>`;
    numberBtns += `<button class="pg-btn${p === page ? ' active' : ''}" data-page="${p}">${p}</button>`;
    prevP = p;
  });

  el.innerHTML = `
    <span class="pg-info">${startItem}–${endItem} dari ${total}</span>
    <div class="pg-btns">
      <button class="pg-btn" data-page="${page - 1}" aria-label="Halaman sebelumnya" title="Halaman sebelumnya" ${page === 1 ? 'disabled' : ''}><i class="ti ti-chevron-left"></i></button>
      ${numberBtns}
      <button class="pg-btn" data-page="${page + 1}" aria-label="Halaman berikutnya" title="Halaman berikutnya" ${page === totalPages ? 'disabled' : ''}><i class="ti ti-chevron-right"></i></button>
    </div>
  `;
  el.querySelectorAll('.pg-btn[data-page]:not(:disabled)').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = parseInt(btn.dataset.page, 10);
      if (!p || p < 1 || p > totalPages || p === page) return;
      onPageChange(p);
    });
  });
}
// Klasifikasi isi kolom link_v6 (versi sama persis dengan S.parseLinkV6 di
// konversian/index.js — jaga tetap sinkron). state:
//   kosong | invalid (teks tapi bukan URL) | bersih (URL doang) | catatan (URL + teks lain)
export function parseLinkV6(raw) {
  const t = String(raw == null ? '' : raw).replace(/[\u00a0\u200b-\u200d\ufeff]/g, ' ').trim();
  if (!t) return { state: 'kosong', url: null, catatan: '' };
  if (/^https?:\/\/\S+$/i.test(t)) return { state: 'bersih', url: t, catatan: '' };
  const m = t.match(/https?:\/\/\S+/i);
  if (!m) return { state: 'invalid', url: null, catatan: t };
  return { state: 'catatan', url: m[0], catatan: t.replace(m[0], ' ').replace(/\s+/g, ' ').trim() };
}
// ---- AKD placeholder "TIDAK ADA" ----
// Di tabel akd ada record placeholder bernomor "TIDAK ADA" (artinya: memang tidak ada AKD).
// Begitu produk/set punya AKD asli, placeholder itu tidak boleh ikut tampil ("TIDAK ADA +1").
export function isAkdPlaceholder(noAkd) {
  return /^\s*tidak\s+ada\s*$/i.test(String(noAkd == null ? '' : noAkd));
}
// Buang placeholder HANYA kalau masih ada AKD asli. Kalau yang ada cuma placeholder, dibiarkan.
// getNo: ambil nomor AKD dari elemen list (default: elemennya sendiri, untuk array string).
export function sembunyikanAkdPlaceholder(list, getNo = (x) => x) {
  const arr = Array.isArray(list) ? list : [];
  const asli = arr.filter((x) => !isAkdPlaceholder(getNo(x)));
  return asli.length ? asli : arr;
}