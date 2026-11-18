// ═══ COORD LOG (baca dulu sebelum edit — file ini kepakai/kesentuh 2+ sesi Claude paralel) ═══
// 2026-11-18: toast jadi SATU sistem buat semua halaman — Claude
//   · host tunggal #pnm-toasts di <body> (bukan lagi container per halaman, jadi toast gak ikut
//     hilang waktu pindah modul), class baru .pnm-toast / .pnm-toast--<type>
//   · teks pesan dirapikan otomatis: pesan panjang dipecah jadi judul + keterangan, titik akhir
//     dan "✓" dibuang, durasi ikut panjang teks, error/warning punya tombol tutup
//   · tipe baru: warning, info (success/error/presence tetap). opts: { detail, duration }
//   · file ini idempotent (window.PNMToast, bukan `const`) — aman kalau ke-load dua kali
// 2026-08-12: dibuat baru — shared toast/notification module — Claude (sesi arsitektur)
// Kalau kamu Claude/sesi lain yang mau edit file ini: tambahin baris baru di atas (jangan hapus riwayatnya), ringkas 1 baris apa yang berubah + tanggal.
// ═══════════════════════════════════════════════════════════════════════════

// shared/toast.js
// ══════════════════════════════════════════
// Dulu ada 6 pembuat toast terpisah (PNMToast, showToast lokal dashboard/populasi, toast() lokal
// spek-maker & export-gambar, crud-produk) dengan container, kelas CSS, durasi, dan ikon sendiri-sendiri.
// Sekarang semuanya lewat PNMToast.show(); showToast()/toast() lokal di tiap halaman cuma
// pembungkus tipis supaya titik panggil lama gak perlu diubah.
//
// Aturan tampilan (CSS-nya di pnm-universal.css, blok "TOAST"):
//   · success / info / presence  → permukaan netral, hilang sendiri, klik buat tutup
//   · error / warning            → permukaan bertint, tahan lebih lama, ada tombol tutup
//   · satu baris judul (maks ~2 baris), keterangan opsional di bawahnya dengan warna lebih tenang
//   · hover/fokus menahan hitung mundur; pesan kembar digabung jadi satu dengan penghitung
//
// textContent dipakai di semua titik (bukan innerHTML) → aman dari XSS by construction.
// ══════════════════════════════════════════

(function () {
  if (window.PNMToast) return;

  var HOST_ID = 'pnm-toasts';
  var MAX_VISIBLE = 3;
  var LEAVE_MS = 220;

  var ICONS = {
    success: 'ti-circle-check',
    error: 'ti-alert-circle',
    warning: 'ti-alert-triangle',
    info: 'ti-info-circle',
    presence: 'ti-users'
  };
  var LOUD = { error: true, warning: true };

  var live = new Map(); // kunci "type|judul|keterangan" → entry, buat nyatuin pesan kembar

  function host() {
    var el = document.getElementById(HOST_ID);
    if (el && document.body.contains(el)) return el;
    el = document.createElement('div');
    el.id = HOST_ID;
    document.body.appendChild(el);
    return el;
  }

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  // ── Rapiin teks ─────────────────────────────────────────────────────────────
  function tidy(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().replace(/\s*✓$/, '');
  }
  function stripDot(s) { return s.replace(/[.\s]+$/, ''); }
  function sentenceCase(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function endWithDot(s) { return /[\p{L}\p{N})]$/u.test(s) ? s + '.' : s; }

  // Pesan panjang tanpa `detail` eksplisit dipecah di batas natural pertama (" — " atau akhir kalimat),
  // jadi judulnya tetap singkat dan sisanya turun ke keterangan.
  function splitMessage(text) {
    if (text.length <= 56) return { title: stripDot(text), detail: '' };
    var cuts = [];
    var dash = text.indexOf(' — ');
    if (dash >= 10) cuts.push({ at: dash, skip: 3, keep: 0 });
    var m = /[.!?]\s+(?=[A-Z"“(])/.exec(text);
    if (m && m.index >= 10) cuts.push({ at: m.index, skip: m[0].length, keep: 1 });
    if (!cuts.length) return { title: stripDot(text), detail: '' };
    cuts.sort(function (a, b) { return a.at - b.at; });
    var c = cuts[0];
    var title = stripDot(text.slice(0, c.at + c.keep));
    var detail = text.slice(c.at + c.skip).trim();
    if (detail.length < 8) return { title: stripDot(text), detail: '' };
    return { title: title, detail: endWithDot(sentenceCase(detail)) };
  }

  function autoDuration(type, len) {
    if (type === 'presence') return 3200;
    if (LOUD[type]) return clamp(4500 + len * 45, 5000, 11000);
    return clamp(2200 + len * 32, 2600, 5500);
  }

  // ── Satu toast ──────────────────────────────────────────────────────────────
  function dismiss(entry) {
    if (!entry || entry.leaving) return;
    entry.leaving = true;
    clearTimeout(entry.timer);
    live.delete(entry.key);
    entry.el.classList.remove('is-in');
    entry.el.classList.add('is-leaving');
    setTimeout(function () { entry.el.remove(); }, LEAVE_MS);
  }

  function arm(entry, ms) {
    clearTimeout(entry.timer);
    if (!isFinite(ms) || ms <= 0) return; // duration 0/Infinity = nempel sampai ditutup
    entry.remaining = ms;
    entry.startedAt = Date.now();
    entry.timer = setTimeout(function () { dismiss(entry); }, ms);
  }
  function pause(entry) {
    if (entry.leaving || !entry.timer) return;
    clearTimeout(entry.timer);
    entry.remaining = Math.max(800, entry.remaining - (Date.now() - entry.startedAt));
  }
  function resume(entry) {
    if (entry.leaving || !isFinite(entry.total) || entry.total <= 0) return;
    arm(entry, entry.remaining);
  }

  function show(msg, type, opts) {
    type = ICONS[type] ? type : 'success';
    opts = opts || {};

    var text = tidy(msg);
    if (!text) return null;
    var title, detail;
    if (opts.detail != null && opts.detail !== '') {
      title = stripDot(text);
      detail = tidy(opts.detail);
    } else {
      var parts = splitMessage(text);
      title = parts.title;
      detail = parts.detail;
    }

    var key = type + '|' + title + '|' + detail;
    var dupe = live.get(key);
    if (dupe && !dupe.leaving) {
      dupe.count += 1;
      dupe.countEl.textContent = '×' + dupe.count;
      dupe.countEl.hidden = false;
      if (!dupe.aside.parentNode) dupe.el.appendChild(dupe.aside);
      arm(dupe, dupe.total);
      return dupe.el;
    }

    var root = host();
    var el = document.createElement('div');
    el.className = 'pnm-toast pnm-toast--' + type;
    el.setAttribute('role', LOUD[type] ? 'alert' : 'status');

    var icon = document.createElement('i');
    icon.className = 'ti ' + ICONS[type] + ' pnm-toast__icon';
    icon.setAttribute('aria-hidden', 'true');

    var body = document.createElement('div');
    body.className = 'pnm-toast__body';
    var t = document.createElement('p');
    t.className = 'pnm-toast__title';
    t.textContent = title;
    body.appendChild(t);
    if (detail) {
      var d = document.createElement('p');
      d.className = 'pnm-toast__detail';
      d.textContent = detail;
      body.appendChild(d);
    }

    var aside = document.createElement('div');
    aside.className = 'pnm-toast__aside';
    var countEl = document.createElement('span');
    countEl.className = 'pnm-toast__count';
    countEl.hidden = true;
    aside.appendChild(countEl);

    el.appendChild(icon);
    el.appendChild(body);

    var total = opts.duration != null ? opts.duration : autoDuration(type, title.length + detail.length);
    var entry = { el: el, aside: aside, key: key, count: 1, countEl: countEl, total: total, remaining: total, leaving: false, timer: 0, startedAt: 0 };

    if (LOUD[type]) {
      var close = document.createElement('button');
      close.type = 'button';
      close.className = 'pnm-toast__close';
      close.setAttribute('aria-label', 'Tutup notifikasi');
      var closeIcon = document.createElement('i');
      closeIcon.className = 'ti ti-x';
      closeIcon.setAttribute('aria-hidden', 'true');
      close.appendChild(closeIcon);
      close.addEventListener('click', function () { dismiss(entry); });
      aside.appendChild(close);
      el.appendChild(aside); // kolom ketiga cuma ada kalau ada isinya (tombol tutup / penghitung)
    } else {
      el.classList.add('is-dismissible');
      el.addEventListener('click', function () {
        var sel = window.getSelection && window.getSelection();
        if (sel && String(sel).length) return; // lagi nyeleksi teks, jangan ditutup
        dismiss(entry);
      });
    }

    el.addEventListener('mouseenter', function () { pause(entry); });
    el.addEventListener('mouseleave', function () { resume(entry); });
    el.addEventListener('focusin', function () { pause(entry); });
    el.addEventListener('focusout', function () { resume(entry); });

    root.appendChild(el);
    live.set(key, entry);
    requestAnimationFrame(function () { el.classList.add('is-in'); });
    arm(entry, total);

    // Maks MAX_VISIBLE sekaligus: yang paling lama ditutup duluan, biar layar gak penuh pas aksi massal.
    var shown = Array.prototype.filter.call(root.children, function (n) { return !n.classList.contains('is-leaving'); });
    while (shown.length > MAX_VISIBLE) {
      var oldest = shown.shift();
      live.forEach(function (e) { if (e.el === oldest) dismiss(e); });
    }
    return el;
  }

  function dismissAll() {
    live.forEach(function (e) { dismiss(e); });
  }

  window.PNMToast = {
    show: show,
    success: function (msg, opts) { return show(msg, 'success', opts); },
    error: function (msg, opts) { return show(msg, 'error', opts); },
    warning: function (msg, opts) { return show(msg, 'warning', opts); },
    info: function (msg, opts) { return show(msg, 'info', opts); },
    presence: function (msg, opts) { return show(msg, 'presence', opts); },
    dismissAll: dismissAll
  };
})();