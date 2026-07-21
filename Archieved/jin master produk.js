// ==UserScript==
// @name         INAPROC Auto Isi Master Produk Sectoral (Alkes - Kode Unik KFA) + Panel
// @namespace    inaproc-auto-master-produk
// @version      3.14.0
// @description  Panel UI untuk auto isi form pengajuan penunjukan Sectoral (Kategori Alkes: Kode Unik KFA) di penyedia.inaproc.id, unggah AKD & CPAKB dari Supabase Storage, konfirmasi, kirim, dan auto-lanjut antar SKU. v3.10.0: (1) tombol Jeda/Lanjutkan & Stop di panel -- checkpoint-based (berhenti di antara SKU / sebelum reload, bukan motong di tengah upload, biar form gak ketinggalan state setengah jadi). (2) Deteksi error/warning diperluas -- bukan cuma teks persis "Nomor permohonan wajib" tapi juga elemen berstyle error/warning/danger dan kata kunci umum (tidak valid, gagal, dst). (3) SKU yang di-skip karena error/warning sekarang di-REQUEUE ke akhir antrian (retry, max 2x) alih-alih langsung dianggap selesai/dilewati permanen -- baru ditandai gagal permanen kalau udah gagal berkali-kali. v3.11.0: deteksi error SERVER (Internal Server Error/500/502/dst) dipisah dari error validasi SKU -- ini infra yang lelet/rusak, bukan salah SKU-nya, jadi SKU saat ini TIDAK di-requeue/dihitung retry. Yang terjadi malah full restart: reload halaman lalu ulang dari awal mulai dari klik "Daftarkan Merek". v3.11.1: fix -- "Sesi Anda telah berakhir" gak ke-cover keyword server-error sebelumnya, sekarang masuk. tungguLihatDokumen() (nunggu upload dokumen selesai) sekarang ngecek server-error/sesi-berakhir tiap poll, gagal cepat & restart total daripada nunggu 20 detik penuh baru nyerah. v3.13.0: (1) pilihKategoriDropdown() ditulis ulang -- kontrol diidentifikasi dari teks ancestor "Kategori" (bukan tebak-tebakan before/after diff), dibungkus retry 3x penuh (bukan cuma retry buka-menu), plus fallback ketik ke search box kalau opsi gak ke-render (virtualized list) -- ini buat kasus "stuck" di pemilihan kategori. (2) Delay setelah klik Periksa sekarang polling early-exit (berhenti begitu ada error ATAU form udah lanjut ke checkbox Pemilik Merek), bukan nunggu fixed 3500ms+8000ms penuh -- kasus normal jauh lebih cepat. v3.14.0: fitur Google Drive (v3.12.0-3.13.1) DICABUT -- AKD balik diambil dari Supabase seperti semula. @grant balik ke none (gak butuh sandboxed context lagi, gak perlu update permission).
// @match        https://penyedia.inaproc.id/*
// @grant        none
// ==/UserScript==
(function () {
  'use strict';
  const CONFIG = {
    supabaseBaseUrl: 'https://ptkkbsemihcyndisjoor.supabase.co/storage/v1/object/public/perizinan',
    supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB0a2tic2VtaWhjeW5kaXNqb29yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0Njc4MzgsImV4cCI6MjA5ODA0MzgzOH0.QsCqmcqQcXvz1f8bLkagvMbAGUBbBP-3Wa5Aore5OMo',
    cpakbPath: 'Sertifikat CPAKB PNM KBLI 32509 K1.pdf',
    kategoriLabel: 'Kategori Alkes: Kode Unik KFA',
    stepDelay: 600,
    maxRetry: 2, // berapa kali SKU bermasalah di-requeue sebelum ditandai gagal permanen
  };
  const QUEUE_KEY = 'inaproc_master_queue_v1';
  const RESULTS_KEY = 'inaproc_master_results_v1';
  const FLAGS_KEY = 'inaproc_master_flags_v1';
  const STAGE_KEY = 'inaproc_master_stage_v1';
  function loadQueue() {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; }
  }
  function saveQueue(q) { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); }
  function loadResults() {
    try { return JSON.parse(localStorage.getItem(RESULTS_KEY) || '[]'); } catch { return []; }
  }
  function saveResults(r) { localStorage.setItem(RESULTS_KEY, JSON.stringify(r)); }
  function recordResult(kfaCode, status) {
    const r = loadResults();
    r.push({ kfaCode, status, timestamp: new Date().toISOString() });
    saveResults(r);
  }
  function loadFlags() {
    try {
      return Object.assign({ dryRun: true, autoContinueQueue: true, paused: false }, JSON.parse(localStorage.getItem(FLAGS_KEY) || '{}'));
    } catch {
      return { dryRun: true, autoContinueQueue: true, paused: false };
    }
  }
  function saveFlags(f) { localStorage.setItem(FLAGS_KEY, JSON.stringify(f)); }
  let flags = loadFlags();
  function getStage() { return localStorage.getItem(STAGE_KEY) || null; }
  function setStage(stage) {
    if (stage === null) localStorage.removeItem(STAGE_KEY);
    else localStorage.setItem(STAGE_KEY, stage);
  }
  function shiftQueueIfMatches(kfaCode) {
    const q = loadQueue();
    if (q.length && q[0].kfaCode === kfaCode) {
      q.shift();
      saveQueue(q);
    }
    return q;
  }
  // SKU bermasalah: skip dari depan antrian, requeue ke BELAKANG buat dicoba lagi
  // setelah sisa data kelar diproses (bukan langsung dianggap selesai/dilewati
  // permanen). Setelah maxRetry kali gagal, baru ditandai gagal permanen.
  function requeueAtBackOrDrop(item, reasonLabel, statusKey) {
    const q = shiftQueueIfMatches(item.kfaCode);
    const attempts = (item.attempts || 0) + 1;
    if (attempts <= CONFIG.maxRetry) {
      q.push({ ...item, attempts });
      saveQueue(q);
      recordResult(item.kfaCode, `${statusKey}-retry${attempts}`);
      log(`⏭️ KFA "${item.kfaCode}" ${reasonLabel}. Dimasukkan ulang ke akhir antrian (percobaan ke-${attempts}/${CONFIG.maxRetry}).`);
    } else {
      recordResult(item.kfaCode, `${statusKey}-gagal-permanen`);
      log(`🛑 KFA "${item.kfaCode}" ${reasonLabel} setelah ${CONFIG.maxRetry}x percobaan -- dilewati permanen.`);
    }
  }
  function log(msg) {
    const box = document.getElementById('inaproc-log');
    if (box) {
      const line = document.createElement('div');
      line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
      box.prepend(line);
    }
    console.log('[INAPROC-AUTO]', msg);
  }
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  function waitForElement(selector, { timeout = 10000, root = document } = {}) {
    return new Promise((resolve, reject) => {
      const existing = root.querySelector(selector);
      if (existing) return resolve(existing);
      const observer = new MutationObserver(() => {
        const el = root.querySelector(selector);
        if (el) { observer.disconnect(); resolve(el); }
      });
      observer.observe(root, { childList: true, subtree: true, attributes: true });
      setTimeout(() => { observer.disconnect(); reject(new Error(`Timeout menunggu elemen: ${selector}`)); }, timeout);
    });
  }
  function setNativeValue(element, value) {
    const proto = Object.getPrototypeOf(element);
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    const nativeSetter = descriptor && descriptor.set;
    if (nativeSetter) nativeSetter.call(element, value);
    else element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function clickElement(el) {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    el.click();
  }
  function isNear(elA, elB, maxDist = 600) {
    const rA = elA.getBoundingClientRect();
    const rB = elB.getBoundingClientRect();
    const vGap = Math.min(Math.abs(rA.top - rB.bottom), Math.abs(rB.top - rA.bottom));
    return vGap < maxDist;
  }
  function pollUntil(checkFn, { timeout = 8000, interval = 200 } = {}) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const timer = setInterval(() => {
        const result = checkFn();
        if (result) { clearInterval(timer); resolve(result); }
        else if (Date.now() - start > timeout) { clearInterval(timer); reject(new Error('pollUntil timeout')); }
      }, interval);
    });
  }
  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
  function isBtnDisabled(el) {
    return !!(el.disabled || el.classList?.contains('disabled') || el.classList?.contains('o_disabled')
      || el.getAttribute?.('aria-disabled') === 'true');
  }
  function waitForClickableByText(selector, text, { timeout = 15000, interval = 300, requireEnabled = true } = {}) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        const els = Array.from(document.querySelectorAll(selector));
        const match = els.find((el) => {
          if (el.textContent.trim() !== text) return false;
          const btn = el.closest('button') || el;
          if (!isVisible(btn)) return false;
          if (requireEnabled && isBtnDisabled(btn)) return false;
          return true;
        });
        return match ? (match.closest('button') || match) : null;
      };
      const found = check();
      if (found) return resolve(found);
      const timer = setInterval(() => {
        const el = check();
        if (el) { clearInterval(timer); resolve(el); }
        else if (Date.now() - start > timeout) { clearInterval(timer); reject(new Error(`Timeout menunggu elemen terlihat & aktif berteks: "${text}" (${selector})`)); }
      }, interval);
    });
  }
  async function fetchFileFromSupabase(path) {
    const encodedPath = path.split('/').map((seg) => encodeURIComponent(seg)).join('/');
    const url = `${CONFIG.supabaseBaseUrl}/${encodedPath}`;
    const filename = path.split('/').pop();
    const headers = CONFIG.supabaseAnonKey
      ? { apikey: CONFIG.supabaseAnonKey, Authorization: `Bearer ${CONFIG.supabaseAnonKey}` }
      : {};
    const res = await fetch(url, { headers });
    if (!res.ok) {
      let detail = '';
      try { detail = await res.text(); } catch { /* ignore */ }
      throw new Error(`Gagal ambil file (${res.status}) di ${url}${detail ? ` -- respons: ${detail.slice(0, 200)}` : ''}`);
    }
    const blob = await res.blob();
    return new File([blob], filename, { type: blob.type || 'application/pdf' });
  }
  function injectFileToInput(inputEl, file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    inputEl.files = dt.files;
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function findFileInputByDokumenHeader(dokumenNumber, maxParentHops = 6) {
    const headerText = `Dokumen ${dokumenNumber}`;
    const headers = Array.from(document.querySelectorAll('p.text-caption-lg-bold, p, span, div, label'))
      .filter((el) => el.children.length === 0 && el.textContent.trim() === headerText && isVisible(el));
    const header = headers[0];
    if (!header) return null;
    let node = header;
    for (let i = 0; i < maxParentHops; i++) {
      if (!node.parentElement) break;
      node = node.parentElement;
      const input = node.querySelector('input[type="file"]');
      if (input) return { input, container: node };
    }
    return null;
  }
  async function tungguLihatDokumen(container, label, { timeout = 20000, interval = 300 } = {}) {
    function getLinks() {
      return Array.from(container.querySelectorAll('a')).filter((a) => {
        const text = a.textContent.trim();
        const href = a.getAttribute('href') || '';
        return text === 'Lihat Dokumen' && href.startsWith('blob:') && isVisible(a);
      });
    }
    const existingHrefs = new Set(getLinks().map((a) => a.getAttribute('href')));
    log(`⏳ Menunggu upload ${label} selesai...`);
    const start = Date.now();
    while (Date.now() - start < timeout) {
      // Gagal cepat kalau server error / sesi berakhir kedeteksi -- daripada nunggu
      // 20 detik penuh baru nyerah lewat timeout generik di bawah.
      if (cekServerError()) {
        throw new Error(`SERVER_ERROR terdeteksi saat menunggu upload ${label}.`);
      }
      const newLink = getLinks().find((a) => !existingHrefs.has(a.getAttribute('href')));
      if (newLink) {
        log(`✅ Upload ${label} selesai (link "Lihat Dokumen" baru terdeteksi).`);
        await sleep(300);
        return true;
      }
      await sleep(interval);
    }
    throw new Error(`Upload ${label} tidak selesai dalam ${timeout / 1000} detik (link "Lihat Dokumen" baru tidak muncul).`);
  }
  // ---------- Deteksi error & warning ----------
  // v3.10.0: dulu cuma nyari teks PERSIS "Nomor permohonan wajib". Sekarang juga
  // nyari kata kunci umum lain (tidak valid, gagal, dst) DAN elemen yang jelas
  // ditandai sebagai error/warning/danger lewat class-nya -- jadi kalau INAPROC
  // munculin pesan error/warning lain yang belum pernah ketemu, tetep kedeteksi
  // alih-alih lolos gitu aja dan bikin submit nyasar.
  const ERROR_KEYWORDS = ['nomor permohonan wajib', 'wajib di isi', 'wajib diisi', 'tidak valid', 'harus diisi', 'gagal'];
  function cekPesanBermasalah() {
    const els = Array.from(document.querySelectorAll('span, div, p, small'));
    return els.some((el) => {
      if (el.closest('#inaproc-panel')) return false; // skip elemen panel kita sendiri
      if (!isVisible(el)) return false;
      const raw = el.textContent.replace(/\s+/g, ' ').trim();
      if (!raw || raw.length > 200) return false;
      const t = raw.toLowerCase();
      if (ERROR_KEYWORDS.some((k) => t.includes(k))) return true;
      const cls = (el.className && typeof el.className === 'string') ? el.className : '';
      const beridentitasError = /error|invalid|danger|warning/i.test(cls);
      return beridentitasError && raw.length > 3;
    });
  }
  // Error SERVER (infra lelet/rusak) dipisah dari error validasi SKU di atas --
  // ini bukan salah SKU-nya, jadi gak boleh ikut dihitung sebagai percobaan gagal
  // buat SKU tsb. Cukup keyword match (gak pakai heuristik class error/warning
  // yang dipakai cekPesanBermasalah, karena itu bisa kena elemen form biasa).
  const SERVER_ERROR_KEYWORDS = [
    'internal server error', 'terjadi kesalahan pada server', 'kesalahan server',
    'server error', 'bad gateway', 'service unavailable', '500 error',
    'error 500', 'error 502', 'error 503', 'gateway timeout',
    'sesi anda telah berakhir', 'sesi telah berakhir', 'sesi berakhir', 'muat ulang halaman',
  ];
  function cekServerError() {
    const els = Array.from(document.querySelectorAll('body, body *'));
    return els.some((el) => {
      if (el.closest('#inaproc-panel')) return false;
      if (el.children.length > 0) return false; // cuma leaf node biar gak scan gabungan teks gede
      if (!isVisible(el)) return false;
      const t = el.textContent.replace(/\s+/g, ' ').trim().toLowerCase();
      if (!t || t.length > 200) return false;
      return SERVER_ERROR_KEYWORDS.some((k) => t.includes(k));
    });
  }
  async function tungguErrorHilang(timeout = 4000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (!cekPesanBermasalah()) return true;
      await sleep(200);
    }
    return false;
  }
  async function kosongkanNomorProduk() {
    const input = await waitForElement('input[name="kfa.input"], input[placeholder="Nomor Produk"]');
    setNativeValue(input, '');
    await sleep(300);
  }
  // ---------- Langkah-langkah form ----------
  let controlsBeforeSectoral = new Set();
  async function pilihJenisSectoral() {
    controlsBeforeSectoral = new Set(document.querySelectorAll('[class*="select__control"]'));
    const radio = await waitForElement('#sectoral');
    if (!radio.checked) clickElement(radio);
    await sleep(CONFIG.stepDelay);
  }
  // v3.13.0: dulu kontrol dropdown kategori ditebak dari "select__control yang
  // baru muncul setelah pilih Sectoral" (before/after Set-diff) -- gampang salah
  // ambil kalau lebih dari satu dropdown muncul bersamaan / timing-nya meleset,
  // dan itu sumber paling mungkin dari kasus "stuck" di kategori. Sekarang
  // diidentifikasi dari TEKS ANCESTOR yang mengandung "Kategori" (jauh lebih
  // reliable), before/after diff cuma jadi fallback. Seluruh alur (buka menu ->
  // cari opsi -> klik -> verifikasi) juga dibungkus retry 3x penuh -- kalau
  // gagal di step manapun, Escape + coba dari awal lagi, bukan langsung nyerah.
  function simulasiKlikLengkap(el) {
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const base = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, button: 0 };
    if (window.PointerEvent) {
      el.dispatchEvent(new PointerEvent('pointerdown', { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
    }
    el.dispatchEvent(new MouseEvent('mousedown', base));
    if (window.PointerEvent) {
      el.dispatchEvent(new PointerEvent('pointerup', { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
    }
    el.dispatchEvent(new MouseEvent('mouseup', base));
    el.dispatchEvent(new MouseEvent('click', base));
  }
  function tutupMenuDropdown() {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  }
  async function pilihKategoriDropdown() {
    function controlTerlihatSepertiKategori(el) {
      let node = el;
      for (let i = 0; i < 6 && node; i++) {
        if ((node.textContent || '').toLowerCase().includes('kategori')) return true;
        node = node.parentElement;
      }
      return false;
    }
    function cariControlKategori() {
      const semua = Array.from(document.querySelectorAll('[class*="select__control"]')).filter(isVisible);
      const kandidat = semua.filter(controlTerlihatSepertiKategori);
      if (kandidat.length) return kandidat[0];
      const fresh = semua.find((el) => !controlsBeforeSectoral.has(el));
      return fresh || semua[0] || null;
    }
    const optionSelector = '[class*="select__option"], [class*="select"][class*="option"], [role="option"]';
    function cariOptionKategori(control) {
      const candidates = Array.from(document.querySelectorAll(optionSelector)).filter(
        (el) => isVisible(el) && isNear(el, control, 600)
      );
      if (!candidates.length) return null;
      const exact = candidates.find((el) => el.textContent.trim() === CONFIG.kategoriLabel);
      return exact || candidates.find((el) => el.textContent.includes(CONFIG.kategoriLabel)) || null;
    }
    async function bukaMenuKategori(control) {
      simulasiKlikLengkap(control);
      await sleep(350);
      return Array.from(document.querySelectorAll('[class*="select__menu"]')).some(
        (el) => isVisible(el) && isNear(el, control, 600)
      );
    }
    const MAX_ATTEMPT = 3;
    for (let attempt = 1; attempt <= MAX_ATTEMPT; attempt++) {
      const control = cariControlKategori();
      if (!control) {
        log(`⚠️ Kontrol dropdown kategori belum ketemu (percobaan ${attempt}/${MAX_ATTEMPT})...`);
        await sleep(500);
        continue;
      }
      let menuTerbuka = await bukaMenuKategori(control);
      if (!menuTerbuka) { await sleep(300); menuTerbuka = await bukaMenuKategori(control); }
      if (!menuTerbuka) {
        log(`⚠️ Menu kategori gak kebuka (percobaan ${attempt}/${MAX_ATTEMPT}), coba lagi...`);
        tutupMenuDropdown();
        await sleep(400);
        continue;
      }
      let option = await pollUntil(() => cariOptionKategori(control), { timeout: 5000 }).catch(() => null);
      if (!option) {
        // Fallback: ketik ke search input react-select buat memfilter opsi --
        // berguna kalau daftarnya di-virtualize dan opsi target belum ke-render.
        const searchInput = control.querySelector('input');
        if (searchInput) {
          setNativeValue(searchInput, 'KFA');
          option = await pollUntil(() => cariOptionKategori(control), { timeout: 4000 }).catch(() => null);
        }
      }
      if (!option) {
        log(`⚠️ Opsi "${CONFIG.kategoriLabel}" gak ketemu (percobaan ${attempt}/${MAX_ATTEMPT}), tutup & coba lagi...`);
        tutupMenuDropdown();
        await sleep(400);
        continue;
      }
      clickElement(option);
      simulasiKlikLengkap(option);
      await sleep(CONFIG.stepDelay);
      const selected = await pollUntil(() => {
        const text = control.textContent.trim();
        return text && text !== 'Pilih' ? text : null;
      }, { timeout: 5000 }).catch(() => null);
      if (selected) {
        log(`Kategori terpilih: "${selected}"`);
        return;
      }
      log(`⚠️ Dropdown kategori masih nunjukin "Pilih" setelah opsi diklik (percobaan ${attempt}/${MAX_ATTEMPT}).`);
    }
    throw new Error(`Gagal pilih kategori "${CONFIG.kategoriLabel}" setelah ${MAX_ATTEMPT}x percobaan.`);
  }
  async function isiNomorProduk(kfaCode) {
    const input = await waitForElement('input[name="kfa.input"], input[placeholder="Nomor Produk"]');
    setNativeValue(input, kfaCode);
    await sleep(CONFIG.stepDelay);
  }
  async function klikPeriksa() {
    const btn = await waitForElement('#find-kfa-button');
    clickElement(btn);
    await sleep(400); // jeda kecil doang biar React sempat mulai proses klik
  }
  // v3.13.0: dulu nunggu fixed 3500ms + polling 8000ms PENUH (cuma break kalau
  // ketemu ERROR, gak ada jalan keluar cepat kalau sukses) -- total sampai
  // ~11.5 detik walau form-nya udah valid dalam 1 detik. Sekarang polling
  // berhenti begitu SALAH SATU dari 3 kondisi ketemu duluan: error, server
  // error, atau tandanya form udah lanjut (checkbox "Pemilik Merek" muncul --
  // itu langkah berikutnya yang sama persis dipakai centangTipePenyedia()).
  // Kasus normal jadi jauh lebih cepat, kasus lambat tetap ada batas aman 10 detik.
  async function cekDanProsesNomorProduk() {
    const q = loadQueue();
    if (!q.length) return null;
    const item = q[0];
    await tungguErrorHilang(4000);
    log(`Cek Nomor Produk (KFA): "${item.kfaCode}"...`);
    await isiNomorProduk(item.kfaCode);
    await klikPeriksa();
    let hasil = null; // 'server-error' | 'error' | 'siap' | null (timeout)
    const pollStart = Date.now();
    while (Date.now() - pollStart < 10000) {
      if (cekServerError()) { hasil = 'server-error'; break; }
      if (cekPesanBermasalah()) { hasil = 'error'; break; }
      const pemilikMerek = document.querySelector('input[label="Pemilik Merek"]');
      if (pemilikMerek && isVisible(pemilikMerek)) { hasil = 'siap'; break; }
      await sleep(250);
    }
    if (hasil === 'server-error') {
      await restartTotalKeDaftarkanMerek('Server error terdeteksi setelah klik Periksa');
      return null;
    }
    if (hasil === 'error') {
      requeueAtBackOrDrop(item, 'DILEWATI: ada pesan error/warning di form', 'skipped-kfa-bermasalah');
      renderPanel();
      await restartViaReload();
      return null;
    }
    // hasil === 'siap' ATAU timeout habis tanpa error kedeteksi -- keduanya
    // lanjut proses; centangTipePenyedia() punya waitForElement sendiri buat
    // jaga-jaga kalau kasus timeout ternyata belum benar-benar siap.
    log(`✅ Nomor Produk "${item.kfaCode}" valid, lanjut proses.`);
    return item;
  }
  // Server error -> bukan salah SKU, jadi antrian TIDAK diubah (item saat ini
  // tetap di depan, dicoba lagi dari nol setelah restart). Beda dari
  // restartViaReload yang stage-nya 'await_apply_form' (asumsi masih di form
  // apply) -- ini balik ke 'await_daftarkan' biar re-klik "Daftarkan Merek" juga.
  async function restartTotalKeDaftarkanMerek(alasan) {
    log(`🛑 ${alasan} -- ini infra, bukan salah SKU. Restart total dari "Daftarkan Merek" (SKU saat ini TETAP di antrian, gak dihitung retry)...`);
    setStage('await_daftarkan');
    await sleep(500);
    location.reload();
  }
  async function restartViaReload() {
    const remaining = loadQueue().length;
    if (flags.paused) {
      setStage(null);
      log('⏸️ Dijeda -- gak refresh dulu. Klik "Lanjutkan" buat balik jalan.');
      return;
    }
    if (remaining > 0 && flags.autoContinueQueue) {
      log('🔄 Refresh halaman buat fresh start (masih di form apply, tinggal pilih jenis penunjukan lagi)...');
      setStage('await_apply_form');
      await sleep(500);
      location.reload();
    } else {
      setStage(null);
      log(remaining > 0
        ? '⏸️ Auto-lanjut OFF -- klik "Proses SKU berikutnya" lagi buat lanjut manual.'
        : '🎉 Semua SKU di antrian sudah diproses/dilewati.');
    }
  }
  async function centangTipePenyedia() {
    const pemilikMerek = await waitForElement('input[label="Pemilik Merek"]');
    if (!pemilikMerek.checked) clickElement(pemilikMerek);
    await sleep(300);
    const produsen = await waitForElement('input[label="Produsen"]');
    if (!produsen.checked) clickElement(produsen);
    await sleep(CONFIG.stepDelay);
  }
  async function unggahDokumen(akdPath) {
    const [akdFile, cpakbFile] = await Promise.all([
      fetchFileFromSupabase(akdPath),
      fetchFileFromSupabase(CONFIG.cpakbPath),
    ]);
    const akdSlot = findFileInputByDokumenHeader(1); // Dokumen 1 = AKD
    if (!akdSlot) throw new Error('Input file untuk "Dokumen 1" (AKD) tidak ditemukan.');
    injectFileToInput(akdSlot.input, akdFile);
    await tungguLihatDokumen(akdSlot.container, 'Dokumen 1 (AKD)');
    const cpakbSlot = findFileInputByDokumenHeader(2); // Dokumen 2 = CPAKB
    if (!cpakbSlot) throw new Error('Input file untuk "Dokumen 2" (CPAKB) tidak ditemukan.');
    injectFileToInput(cpakbSlot.input, cpakbFile);
    await tungguLihatDokumen(cpakbSlot.container, 'Dokumen 2 (CPAKB)');
  }
  async function centangKonfirmasiValiditas() {
    const cb = await waitForElement('#checkbox-data-validity-confirmation');
    if (!cb.checked) clickElement(cb);
    await sleep(CONFIG.stepDelay);
  }
  async function klikKirim() {
    const btn = await waitForClickableByText('span', 'Kirim', { timeout: 8000, requireEnabled: true });
    clickElement(btn);
    log('⏳ Kirim diklik, menunggu proses submit selesai...');
    const selesai = await new Promise((resolve) => {
      const start = Date.now();
      const timer = setInterval(() => {
        const stillThere = Array.from(document.querySelectorAll('span'))
          .some((el) => el.textContent.trim() === 'Kirim' && isVisible(el.closest('button') || el));
        if (!stillThere) { clearInterval(timer); resolve(true); }
        else if (Date.now() - start > 15000) { clearInterval(timer); resolve(false); }
      }, 300);
    });
    if (!selesai) throw new Error('Tombol "Kirim" masih terlihat setelah 15 detik -- submit kemungkinan gagal/nyangkut.');
    await sleep(CONFIG.stepDelay * 2);
  }
  async function klikKembaliKeDashboard() {
    const btn = await waitForClickableByText('span', 'Kembali ke Dashboard', { timeout: 15000, requireEnabled: true });
    clickElement(btn);
    await sleep(CONFIG.stepDelay);
  }
  async function klikDaftarkanMerek() {
    const btn = await waitForClickableByText('span', 'Daftarkan Merek', { timeout: 15000, requireEnabled: true });
    clickElement(btn);
    await sleep(CONFIG.stepDelay);
  }
  async function startFromDaftarkanMerek() {
    const q = loadQueue();
    if (!q.length) { log('⚠️ Antrian masih kosong. Muat antrian dulu sebelum klik Mulai.'); return; }
    const adaTombol = document.body.textContent.includes('Daftarkan Merek');
    if (!adaTombol) {
      log('⚠️ Tombol "Daftarkan Merek" nggak ketemu di halaman ini.');
      return;
    }
    flags.paused = false;
    saveFlags(flags);
    log('🚀 Memulai: klik "Daftarkan Merek"...');
    setStage('await_apply_form');
    try {
      await klikDaftarkanMerek();
      await sleep(CONFIG.stepDelay);
      if (document.querySelector('#sectoral')) {
        setStage(null);
        await processNextInQueue();
      }
    } catch (err) {
      log(`⚠️ Gagal klik "Daftarkan Merek": ${err.message}`);
      setStage(null);
    }
  }
  let processNextInQueueRunning = false;
  async function processNextInQueue() {
    if (processNextInQueueRunning) {
      log('⏭️ processNextInQueue() lagi jalan di instance lain, panggilan ini di-skip (mencegah race/rebutan dropdown).');
      return;
    }
    processNextInQueueRunning = true;
    try {
      await pilihJenisSectoral();
      await pilihKategoriDropdown();
      const item = await cekDanProsesNomorProduk();
      if (!item) return; // queue kosong ATAU lagi proses refresh/jeda -- keduanya berhenti di sini
      await centangTipePenyedia();
      await unggahDokumen(item.akdPath);
      if (cekServerError()) {
        await restartTotalKeDaftarkanMerek('Server error terdeteksi sebelum submit');
        return;
      }
      if (cekPesanBermasalah()) {
        requeueAtBackOrDrop(item, 'DILEWATI (telat kedeteksi, sebelum submit)', 'skipped-kfa-bermasalah-late');
        renderPanel();
        await restartViaReload();
        return;
      }
      if (flags.dryRun) {
        log(`[DRY RUN] KFA "${item.kfaCode}" selesai diisi. Checkbox konfirmasi & tombol Kirim TIDAK diklik.`);
        recordResult(item.kfaCode, 'dry-run');
        shiftQueueIfMatches(item.kfaCode);
        renderPanel();
        return;
      }
      await centangKonfirmasiValiditas();
      try {
        await klikKirim();
      } catch (err) {
        if (cekServerError()) {
          await restartTotalKeDaftarkanMerek('Server error terdeteksi saat/setelah klik Kirim');
          return;
        }
        if (err.message.includes('Kirim')) {
          requeueAtBackOrDrop(item, 'DILEWATI: tombol Kirim nggak pernah aktif (form invalid)', 'skipped-kirim-timeout');
          renderPanel();
          await restartViaReload();
          return;
        }
        throw err;
      }
      recordResult(item.kfaCode, 'submitted');
      shiftQueueIfMatches(item.kfaCode);
      renderPanel();
      const remaining = loadQueue().length;
      if (flags.paused) {
        setStage(null);
        log('⏸️ Dijeda. Klik "Lanjutkan" buat balik ke dashboard & lanjut SKU berikutnya.');
      } else if (flags.autoContinueQueue && remaining > 0) {
        log(`➡️ Auto-lanjut: masih ada ${remaining} SKU di antrian. Kembali ke dashboard...`);
        setStage('await_daftarkan');
        await klikKembaliKeDashboard();
      } else if (flags.autoContinueQueue) {
        setStage(null);
        await klikKembaliKeDashboard();
        log('🎉 Semua item di antrian sudah selesai dikirim.');
      } else {
        log(`✅ KFA "${item.kfaCode}" berhasil dikirim. Klik "Proses SKU berikutnya" untuk lanjut manual.`);
      }
    } catch (err) {
      if (cekServerError()) {
        await restartTotalKeDaftarkanMerek(`Server error terdeteksi setelah error lain (${err.message})`);
        return;
      }
      log(`⚠️ Gagal memproses: ${err.message}`);
      console.error('[INAPROC-AUTO]', err);
    } finally {
      processNextInQueueRunning = false;
    }
  }
  let mainInProgress = false;
  async function main() {
    if (mainInProgress) return;
    if (flags.paused) return; // jaga-jaga: jangan auto-lanjut selagi dijeda
    const stage = getStage();
    if (!stage) return;
    mainInProgress = true;
    try {
      if (stage === 'await_daftarkan') {
        setStage('await_apply_form');
        await klikDaftarkanMerek();
      } else if (stage === 'await_apply_form') {
        setStage(null);
        await sleep(CONFIG.stepDelay);
        await processNextInQueue();
      }
    } catch (err) {
      log(`⚠️ Auto-continue gagal di stage "${stage}": ${err.message}.`);
      setStage(null);
      console.error('[INAPROC-AUTO]', err);
    } finally {
      mainInProgress = false;
    }
  }
  function resultsToTSV() {
    const results = loadResults();
    const header = ['KODE_KFA', 'STATUS', 'TIMESTAMP'];
    const rows = [header, ...results.map((r) => [r.kfaCode, r.status, r.timestamp])];
    return rows.map((r) => r.join('\t')).join('\n');
  }
  function exportResultsCSV() {
    const results = loadResults();
    if (!results.length) { alert('Belum ada hasil buat di-export.'); return; }
    const rows = [['KODE_KFA', 'STATUS', 'TIMESTAMP']];
    results.forEach((r) => rows.push([r.kfaCode, r.status, r.timestamp]));
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inaproc_hasil_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  function showTsvPreview(text) {
    const box = document.getElementById('inaproc-tsv-preview');
    if (!box) return;
    box.style.display = 'block';
    box.value = text;
    box.focus();
    box.select();
  }
  async function copyResultsAsTSV() {
    const results = loadResults();
    if (!results.length) { alert('Belum ada hasil buat di-copy.'); return; }
    const text = resultsToTSV();
    let copied = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        copied = true;
      }
    } catch { copied = false; }
    if (!copied) {
      const tmp = document.createElement('textarea');
      tmp.value = text;
      tmp.style.position = 'fixed';
      tmp.style.opacity = '0';
      document.body.appendChild(tmp);
      tmp.focus();
      tmp.select();
      try { copied = document.execCommand('copy'); } catch { copied = false; }
      document.body.removeChild(tmp);
    }
    if (copied) log(`📋 ${results.length} baris hasil ke-copy ke clipboard (TSV).`);
    else log('⚠️ Copy otomatis gagal. Textarea "Preview hasil" sudah ke-select -- tekan Ctrl+C manual.');
    showTsvPreview(text);
  }
  let panelPos = { top: 70, left: null, right: 10 };
  let panelCollapsed = false;
  function parseQueueInput(text) {
    return text
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [kfaCode, akdPath] = line.split('\t').map((s) => (s || '').trim());
        return { kfaCode, akdPath, attempts: 0 };
      })
      .filter((item) => item.kfaCode && item.akdPath);
  }
  // Klik Jeda/Lanjutkan atau Stop diproses di checkpoint aman berikutnya (antar
  // SKU / sebelum reload) -- gak motong paksa di tengah upload/submit, karena itu
  // bisa ninggalin form dalam state setengah jadi yang malah lebih runyam.
  function togglePause() {
    flags.paused = !flags.paused;
    saveFlags(flags);
    renderPanel();
    if (flags.paused) {
      log('⏸️ Dijeda. Proses berhenti di checkpoint aman berikutnya.');
    } else {
      log('▶️ Dilanjutkan.');
      if (document.querySelector('#sectoral')) processNextInQueue();
      else if (document.body.textContent.includes('Daftarkan Merek')) startFromDaftarkanMerek();
    }
  }
  function stopProcessing() {
    flags.paused = true;
    saveFlags(flags);
    setStage(null);
    processNextInQueueRunning = false;
    mainInProgress = false;
    log('⏹️ Dihentikan. Antrian tetap tersimpan -- klik "Lanjutkan" atau "Mulai" buat lanjut lagi nanti.');
    renderPanel();
  }
  function renderPanel() {
    let panel = document.getElementById('inaproc-panel');
    if (panel) panel.remove();
    panel = document.createElement('div');
    panel.id = 'inaproc-panel';
    const posCss = panelPos.left !== null
      ? `top: ${panelPos.top}px; left: ${panelPos.left}px;`
      : `top: ${panelPos.top}px; right: ${panelPos.right}px;`;
    panel.style.cssText = `
      position: fixed; ${posCss} width: 340px; max-height: 85vh;
      overflow-y: auto; background: #fff; border: 2px solid #1F4E78; border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.25); z-index: 999999; font-family: Arial, sans-serif;
      font-size: 12px; padding: 0;
    `;
    const queue = loadQueue();
    const results = loadResults();
    panel.innerHTML = `
      <div id="inaproc-header" style="cursor: move; background:#1F4E78; color:#fff; padding:8px 10px;
           border-radius: 5px 5px 0 0; display:flex; justify-content:space-between; align-items:center;">
        <span style="font-weight:bold; font-size:13px;">INAPROC Master Produk Automation</span>
        <button id="inaproc-collapse-btn" title="Ciutkan/lebarin panel"
          style="cursor:pointer; background:#fff; color:#1F4E78; border:none; border-radius:3px; width:22px; height:22px; font-weight:bold;">
          ${panelCollapsed ? '▢' : '—'}
        </button>
      </div>
      <div id="inaproc-body" style="padding: 10px; ${panelCollapsed ? 'display:none;' : ''}">
        <div style="margin-bottom:6px; color:#555;">
          Antrian: <b>${queue.length}</b> SKU | Hasil terkumpul: <b>${results.length}</b>
          ${flags.paused ? ' | <b style="color:#a00;">⏸️ DIJEDA</b>' : ''}
        </div>
        <textarea id="inaproc-queue-input" rows="4" style="width:100%; box-sizing:border-box; font-size:11px;"
          placeholder="KODE_KFA[TAB]PATH_FILE_AKD (satu baris per SKU)"></textarea>
        <button id="inaproc-load-queue" style="width:100%; margin-top:4px;">Muat ke Antrian</button>
        <hr>
        <label style="display:block; margin-bottom:4px;">
          <input type="checkbox" id="inaproc-dryrun" ${flags.dryRun ? 'checked' : ''}> Dry run (isi field, JANGAN submit)
        </label>
        <label style="display:block; margin-bottom:6px;">
          <input type="checkbox" id="inaproc-autonext" ${flags.autoContinueQueue ? 'checked' : ''}> Auto-lanjut ke SKU berikutnya (butuh dry run OFF)
        </label>
        <div style="color:#a00; margin-bottom:6px;">
          ⚠️ Data ini masuk ke sistem INAPROC sungguhan. Test 1 SKU dengan dry run dulu sebelum mematikannya.
        </div>
        <div style="color:#555; margin-bottom:6px;">
          ℹ️ SKU dengan error/warning di form otomatis di-skip dan dimasukkan ulang ke akhir antrian (retry, maks ${CONFIG.maxRetry}x) sebelum ditandai gagal permanen. Halaman di-refresh otomatis buat fresh start ke SKU berikutnya.
        </div>
        <div style="color:#555; margin-bottom:6px;">
          ℹ️ Kalau ketemu error SERVER (Internal Server Error/500/dst), itu dianggap masalah infra bukan salah SKU -- otomatis restart TOTAL dari tombol "Daftarkan Merek", SKU yang lagi diproses tetap di antrian (gak dihitung retry).
        </div>
        <button id="inaproc-start" style="width:100%; margin-bottom:4px; background:#1F4E78; color:#fff; font-weight:bold;">🚀 Mulai (klik "Daftarkan Merek" di halaman ini)</button>
        <button id="inaproc-run-next" style="width:100%; margin-bottom:4px;">▶ Proses SKU berikutnya di antrian (kalau sudah di halaman apply)</button>
        <div style="display:flex; gap:6px; margin-bottom:8px;">
          <button id="inaproc-pause" style="flex:1; ${flags.paused ? 'background:#2e7d32; color:#fff;' : ''}">${flags.paused ? '▶ Lanjutkan' : '⏸ Jeda'}</button>
          <button id="inaproc-stop" style="flex:1; background:#a00; color:#fff;">⏹ Stop</button>
        </div>
        <hr>
        <div style="font-weight:bold; margin-bottom:4px;">Export Hasil</div>
        <button id="inaproc-export" style="width:100%; margin-bottom:4px;">⬇ Download CSV</button>
        <button id="inaproc-copy-tsv" style="width:100%; margin-bottom:4px;">📋 Copy Hasil (paste ke Google Sheets)</button>
        <textarea id="inaproc-tsv-preview" readonly rows="3" style="display:none; width:100%; box-sizing:border-box; font-size:10px; margin-bottom:8px;"
          placeholder="Preview hasil (TSV) muncul di sini setelah klik Copy..."></textarea>
        <button id="inaproc-clear" style="width:100%; margin-bottom:6px;">🗑 Reset Antrian & Hasil</button>
        <div style="font-weight:bold; margin-top:4px;">Log:</div>
        <div id="inaproc-log" style="max-height:160px; overflow-y:auto; background:#f7f7f7; padding:4px; border:1px solid #ddd;"></div>
      </div>
    `;
    document.body.appendChild(panel);
    const header = document.getElementById('inaproc-header');
    let dragging = false, dragStartX = 0, dragStartY = 0, panelStartLeft = 0, panelStartTop = 0;
    header.addEventListener('mousedown', (e) => {
      if (e.target.id === 'inaproc-collapse-btn') return;
      dragging = true;
      const rect = panel.getBoundingClientRect();
      panelStartLeft = rect.left; panelStartTop = rect.top;
      dragStartX = e.clientX; dragStartY = e.clientY;
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const newLeft = panelStartLeft + (e.clientX - dragStartX);
      const newTop = panelStartTop + (e.clientY - dragStartY);
      panel.style.left = `${Math.max(0, newLeft)}px`;
      panel.style.top = `${Math.max(0, newTop)}px`;
      panel.style.right = 'auto';
    });
    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      const rect = panel.getBoundingClientRect();
      panelPos = { top: Math.round(rect.top), left: Math.round(rect.left), right: null };
    });
    document.getElementById('inaproc-collapse-btn').onclick = () => {
      panelCollapsed = !panelCollapsed;
      renderPanel();
    };
    document.getElementById('inaproc-dryrun').onchange = (e) => {
      flags.dryRun = e.target.checked;
      saveFlags(flags);
    };
    document.getElementById('inaproc-autonext').onchange = (e) => {
      flags.autoContinueQueue = e.target.checked;
      saveFlags(flags);
    };
    const queueInput = document.getElementById('inaproc-queue-input');
    queueInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      e.preventDefault();
      const start = queueInput.selectionStart, end = queueInput.selectionEnd, value = queueInput.value;
      queueInput.value = value.slice(0, start) + '\t' + value.slice(end);
      queueInput.selectionStart = queueInput.selectionEnd = start + 1;
    });
    document.getElementById('inaproc-load-queue').onclick = () => {
      const items = parseQueueInput(document.getElementById('inaproc-queue-input').value);
      saveQueue(items);
      log(`Antrian dimuat: ${items.length} SKU.`);
      renderPanel();
    };
    document.getElementById('inaproc-start').onclick = () => startFromDaftarkanMerek();
    document.getElementById('inaproc-run-next').onclick = () => processNextInQueue();
    document.getElementById('inaproc-pause').onclick = () => togglePause();
    document.getElementById('inaproc-stop').onclick = () => stopProcessing();
    document.getElementById('inaproc-export').onclick = exportResultsCSV;
    document.getElementById('inaproc-copy-tsv').onclick = copyResultsAsTSV;
    document.getElementById('inaproc-clear').onclick = () => {
      if (confirm('Yakin reset antrian & hasil? Ini tidak menghapus data yang sudah terkirim ke INAPROC.')) {
        localStorage.removeItem(QUEUE_KEY);
        localStorage.removeItem(RESULTS_KEY);
        renderPanel();
      }
    };
  }
  function initInaproc() {
    log('Panel INAPROC-AUTO mulai jalan (readyState: ' + document.readyState + ')');
    if (!document.getElementById('inaproc-panel')) renderPanel();
    main();
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(initInaproc, 1000);
  } else {
    window.addEventListener('load', () => setTimeout(initInaproc, 1000));
  }
  let panelCheckTimer = null;
  const bodyObserver = new MutationObserver(() => {
    if (panelCheckTimer) return;
    panelCheckTimer = setTimeout(() => {
      panelCheckTimer = null;
      if (document.body && !document.getElementById('inaproc-panel')) renderPanel();
      main();
    }, 800);
  });
  if (document.body) bodyObserver.observe(document.body, { childList: true, subtree: true });
  setInterval(() => { if (getStage() && !flags.paused) main(); }, 2000);
})();