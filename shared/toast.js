// ═══ COORD LOG (baca dulu sebelum edit — file ini kepakai/kesentuh 2+ sesi Claude paralel) ═══
// 2026-08-12: dibuat baru — shared toast/notification module — Claude (sesi arsitektur)
// Kalau kamu Claude/sesi lain yang mau edit file ini: tambahin baris baru di atas (jangan hapus riwayatnya), ringkas 1 baris apa yang berubah + tanggal.
// ═══════════════════════════════════════════════════════════════════════════

// shared/toast.js
// ══════════════════════════════════════════
// Sebelumnya ada 2 showToast() terpisah (konversian.js & crud-produk.js),
// beda signature (type string vs isError boolean) DAN beda konvensi CSS
// class (.toast-success vs .toast.success) -- 2 sistem paralel yang
// kebetulan gak nabrak. Ada juga 1 blok CSS `.toast{}` yatim/legacy yang
// diam-diam menang di cascade dan nimpa keduanya (position/z-index/
// pointer-events) -- itu udah dibuang dari pnm-universal.css.
//
// PNMToast.show() DULUNYA nempelin DUA konvensi class sekaligus
// (toast-${type} DAN ${type}) di satu elemen -- niatnya biar kompatibel ke
// 2 sistem CSS tanpa perlu nyeragamin dulu. TERNYATA itu bikin bug baru:
// .toast.success (2 class, spesifisitas lebih tinggi) menang buat `color`,
// sementara .toast-success (1 class) yang nentuin `background` -- keduanya
// sama-sama ijo, hasilnya teks ijo di atas background ijo, gak keliatan
// sama sekali. FIX: deteksi container mana yang ketemu, keluarin CUMA
// SATU skema class yang cocok sama container itu, bukan dua-duanya.
// ══════════════════════════════════════════

const PNMToast = (() => {
  function resolveContainer() {
    const byId = document.getElementById('toast-container');
    if (byId) return { el: byId, scheme: 'id' }; // konversian.js: .toast-success/.toast-error/.toast-presence
    const byClass = document.querySelector('.toast-container');
    if (byClass) return { el: byClass, scheme: 'class' }; // crud-produk.js: .toast.success/.toast.error
    const el = document.createElement('div');
    el.id = 'toast-container';
    el.className = 'toast-container';
    document.body.appendChild(el);
    return { el, scheme: 'id' };
  }

  const ICONS = { success: 'ti-circle-check', error: 'ti-alert-circle', presence: 'ti-users' };

  function show(msg, type = 'success', opts = {}) {
    const { el: container, scheme } = resolveContainer();
    const el = document.createElement('div');
    el.className = scheme === 'id' ? `toast toast-${type}` : `toast ${type}`;
    const icon = ICONS[type] || ICONS.success;
    el.innerHTML = `<i class="ti ${icon}"></i><span></span>`;
    el.querySelector('span').textContent = msg; // textContent = aman dari XSS by construction, gak butuh escapeHtml manual
    container.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));

    const duration = opts.duration ?? (type === 'error' ? 4000 : 2600);
    setTimeout(() => {
      el.classList.add('fade-out');
      el.classList.remove('show');
      setTimeout(() => el.remove(), 300);
    }, duration);
  }

  return {
    show,
    success: (msg, opts) => show(msg, 'success', opts),
    error: (msg, opts) => show(msg, 'error', opts),
    presence: (msg, opts) => show(msg, 'presence', opts)
  };
})();

window.PNMToast = PNMToast;