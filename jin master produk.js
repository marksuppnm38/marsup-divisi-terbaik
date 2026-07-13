// ==UserScript==
// @name         INAPROC Auto Isi Master Produk Sectoral (Alkes - Kode Unik KFA) + Panel
// @namespace    inaproc-auto-master-produk
// @version      3.9.0
// @description  Panel UI untuk auto isi form pengajuan penunjukan Sectoral (Kategori Alkes: Kode Unik KFA) di penyedia.inaproc.id, unggah AKD & CPAKB dari Supabase Storage, konfirmasi, kirim, dan auto-lanjut antar SKU. SKU dengan nomor permohonan bermasalah di-skip dengan REFRESH HALAMAN (fresh start) daripada maksa lanjut di context lama -- menghindari false-negative deteksi error akibat network lelet. Urutan upload: Dokumen 1 = AKD, Dokumen 2 = CPAKB, dicari via header unik "Dokumen 1"/"Dokumen 2". Fix v3.9.0: deteksi upload selesai sekarang snapshot link "Lihat Dokumen" yang sudah ada SEBELUM upload lalu tunggu link BARU (href beda) muncul -- sebelumnya asal ada link apapun langsung dianggap selesai, jadi ke-fool sama link basi/lama dan Kirim kepencet sebelum dokumen baru beneran selesai keupload.
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
      return Object.assign({ dryRun: true, autoContinueQueue: true }, JSON.parse(localStorage.getItem(FLAGS_KEY) || '{}'));
    } catch {
      return { dryRun: true, autoContinueQueue: true };
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

  // FIX v3.7.0: teks tombol/dropzone "Pilih atau tarik dokumen di sini" SAMA PERSIS
  // di semua slot dokumen, jadi gak bisa dipakai buat bedain slot 1 vs slot 2 (bug
  // versi sebelumnya: occurrence index ke teks berulang gak reliable begitu ada
  // >2 slot / urutan DOM beda dari urutan visual). Sekarang anchor ke HEADER unik
  // per slot ("Dokumen 1", "Dokumen 2", dst -- <p class="text-caption-lg-bold mb-4">)
  // lalu naik ke parent sampai ketemu input[type="file"] di dalamnya.
  // FIX v3.8.0: sekarang balikin { input, container } -- container dipakai lagi
  // buat polling link "Lihat Dokumen" setelah upload (lihat tungguLihatDokumen).
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

  // FIX v3.9.0: bug "gak sabar" -- tungguLihatDokumen versi lama cuma cek "ada link
  // Lihat Dokumen gak di container", TAPI kalau ada link LAMA (basi dari upload
  // sebelumnya, atau kepeluk dari slot dokumen sebelahnya kalau container-nya
  // kebetulan lebih luas dari 1 slot), langsung dianggap "selesai" padahal itu
  // bukan hasil upload yang baru saja di-trigger. Sekarang: snapshot dulu href
  // link yang SUDAH ADA sebelum upload, lalu polling nunggu link BARU (href beda
  // dari snapshot) -- ini robust walau container-nya kebetulan lebih luas.
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
      const newLink = getLinks().find((a) => !existingHrefs.has(a.getAttribute('href')));
      if (newLink) {
        log(`✅ Upload ${label} selesai (link "Lihat Dokumen" baru terdeteksi).`);
        await sleep(300); // buffer kecil biar state form kebentuk sempurna
        return true;
      }
      await sleep(interval);
    }
    throw new Error(`Upload ${label} tidak selesai dalam ${timeout / 1000} detik (link "Lihat Dokumen" baru tidak muncul).`);
  }

  // ---------- Deteksi error & fix false-positive/false-negative ----------
  // FIX v3.6.0: exclude elemen dari panel INAPROC sendiri saat cari teks error,
  // karena panel kita punya baris bantuan yang teksnya persis mengandung frasa
  // error form, jadi kalau gak di-exclude selalu ke-detect sebagai error.
  function cekNomorPermohonanError() {
    const els = Array.from(document.querySelectorAll('span, div, p'));
    return els.some((el) => {
      if (el.closest('#inaproc-panel')) return false; // skip elemen panel kita sendiri
      const t = el.textContent.replace(/\s+/g, ' ').trim();
      return t.includes('Nomor permohonan wajib') && isVisible(el);
    });
  }

  async function tungguErrorHilang(timeout = 4000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (!cekNomorPermohonanError()) return true;
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

  async function pilihKategoriDropdown() {
    let control = await pollUntil(() => {
      const now = Array.from(document.querySelectorAll('[class*="select__control"]'));
      const fresh = now.find((el) => !controlsBeforeSectoral.has(el) && isVisible(el));
      return fresh || null;
    }, { timeout: 8000 }).catch(() => null);

    if (!control) {
      control = Array.from(document.querySelectorAll('[class*="select__control"]')).find(isVisible) || null;
    }
    if (!control) throw new Error('Tidak menemukan kontrol dropdown kategori sama sekali. Cek selector di DevTools.');

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

    async function bukaMenuKategori() {
      simulasiKlikLengkap(control);
      await sleep(350);
      return Array.from(document.querySelectorAll('[class*="select__menu"]')).some(
        (el) => isVisible(el) && isNear(el, control, 600)
      );
    }

    let menuTerbuka = await bukaMenuKategori();
    for (let attempt = 0; !menuTerbuka && attempt < 2; attempt++) {
      await sleep(300);
      menuTerbuka = await bukaMenuKategori();
    }
    if (!menuTerbuka) throw new Error('Menu dropdown kategori nggak kebuka setelah beberapa kali percobaan klik.');

    const optionSelector = '[class*="select__option"], [class*="select"][class*="option"], [role="option"]';
    const option = await pollUntil(() => {
      const candidates = Array.from(document.querySelectorAll(optionSelector)).filter(
        (el) => isVisible(el) && isNear(el, control, 600)
      );
      if (!candidates.length) return null;
      const exact = candidates.find((el) => el.textContent.trim() === CONFIG.kategoriLabel);
      return exact || candidates.find((el) => el.textContent.includes(CONFIG.kategoriLabel)) || null;
    }, { timeout: 8000 }).catch(() => null);

    if (!option) {
      const allVisibleOptions = Array.from(document.querySelectorAll(optionSelector)).filter(isVisible);
      console.log('[INAPROC-AUTO] Opsi dropdown kategori nggak ketemu. Kandidat opsi visible:');
      allVisibleOptions.forEach((el, i) => console.log(`[INAPROC-AUTO] Opsi ${i}: "${el.textContent.trim()}"`, el));
      throw new Error(`Opsi "${CONFIG.kategoriLabel}" nggak ketemu di dropdown.`);
    }

    clickElement(option);
    simulasiKlikLengkap(option);
    await sleep(CONFIG.stepDelay);

    const selected = await pollUntil(() => {
      const text = control.textContent.trim();
      return text && text !== 'Pilih' ? text : null;
    }, { timeout: 5000 }).catch(() => null);

    if (!selected) throw new Error('Dropdown kategori masih menunjukkan "Pilih" setelah opsi diklik.');
    log(`Kategori terpilih: "${selected}"`);
  }

  async function isiNomorProduk(kfaCode) {
    const input = await waitForElement('input[name="kfa.input"], input[placeholder="Nomor Produk"]');
    setNativeValue(input, kfaCode);
    await sleep(CONFIG.stepDelay);
  }

  async function klikPeriksa() {
    const btn = await waitForElement('#find-kfa-button');
    clickElement(btn);
    await sleep(3500);
  }

  // FIX v3.7.0: dulu ada while-loop internal yang skip SKU bermasalah lalu LANGSUNG
  // lanjut cek SKU berikutnya di context/DOM yang sama -- ini sumber bug utama:
  // kalau deteksi error telat kedetect (network lelet), state DOM/React yang residual
  // bikin SKU berikutnya ikut salah baca. Sekarang fungsi ini cuma cek SATU SKU per
  // page-load. Kalau bermasalah -> skip + REFRESH HALAMAN (fresh start), bukan lanjut
  // di context yang sama. Proses otomatis nyambung lagi sendiri lewat stage + main().
  async function cekDanProsesNomorProduk() {
    const q = loadQueue();
    if (!q.length) return null;
    const item = q[0];

    await tungguErrorHilang(4000);

    log(`Cek Nomor Produk (KFA): "${item.kfaCode}"...`);
    await isiNomorProduk(item.kfaCode);
    await klikPeriksa();

    // Polling sabar (backend kadang lelet) tapi tetap 1 percobaan per page-load --
    // kalau kena skip, refresh aja daripada maksa lanjut di context ini.
    let errorTerlihat = false;
    const pollStart = Date.now();
    while (Date.now() - pollStart < 8000) {
      if (cekNomorPermohonanError()) { errorTerlihat = true; break; }
      await sleep(400);
    }

    if (errorTerlihat) {
      log(`⏭️ KFA "${item.kfaCode}" DILEWATI: "Nomor permohonan wajib di isi". Refresh buat fresh start...`);
      recordResult(item.kfaCode, 'skipped-kfa-bermasalah');
      shiftQueueIfMatches(item.kfaCode);
      renderPanel();
      await restartViaReload();
      return null;
    }

    log(`✅ Nomor Produk "${item.kfaCode}" valid, lanjut proses.`);
    return item;
  }

  // FIX v3.7.0: reload dilakukan DI HALAMAN FORM APPLY YANG SAMA (bukan balik ke
  // dashboard dulu), karena form apply-nya reusable / masih di posisi yang sama
  // setelah reload -- tinggal pilih jenis penunjukan (Sectoral) lagi. Makanya stage
  // yang dipakai adalah 'await_apply_form', BUKAN 'await_daftarkan' (yang butuh
  // klik "Daftarkan Merek" dari dashboard).
  async function restartViaReload() {
    const remaining = loadQueue().length;
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

  // FIX v3.7.0: urutan upload dibetulin -- Dokumen 1 = CPAKB, Dokumen 2 = AKD
  // (sebelumnya kebalik). Input dicari via header unik per slot, bukan occurrence
  // index ke teks dropzone yang sama di semua slot (lihat findFileInputByDokumenHeader).
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
      if (!item) return; // queue kosong ATAU lagi proses refresh -- keduanya berhenti di sini

      await centangTipePenyedia();
      await unggahDokumen(item.akdPath);

      // FIX v3.7.0: late-check sesaat sebelum submit. Kalau error baru kedetect
      // di titik ini (telat render karena network lelet), batalkan & refresh
      // daripada maksa klik Kirim yang bakal timeout karena form invalid.
      if (cekNomorPermohonanError()) {
        log(`⏭️ KFA "${item.kfaCode}" DILEWATI (telat kedetect, sebelum submit). Refresh...`);
        recordResult(item.kfaCode, 'skipped-kfa-bermasalah-late');
        shiftQueueIfMatches(item.kfaCode);
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

      // FIX v3.7.0: kalau tombol Kirim tetep gak pernah aktif (form ternyata invalid,
      // lolos dari 2 lapis pengecekan sebelumnya), treat sebagai skip + refresh,
      // bukan cuma lempar error dan nyangkut nunggu klik manual.
      try {
        await klikKirim();
      } catch (err) {
        if (err.message.includes('Kirim')) {
          log(`⏭️ KFA "${item.kfaCode}" DILEWATI: tombol Kirim nggak pernah aktif (form invalid). Refresh...`);
          recordResult(item.kfaCode, 'skipped-kirim-timeout');
          shiftQueueIfMatches(item.kfaCode);
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
      if (flags.autoContinueQueue && remaining > 0) {
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
      log(`⚠️ Gagal memproses: ${err.message}`);
      console.error('[INAPROC-AUTO]', err);
    } finally {
      processNextInQueueRunning = false;
    }
  }

  let mainInProgress = false;
  async function main() {
    if (mainInProgress) return;
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
        return { kfaCode, akdPath };
      })
      .filter((item) => item.kfaCode && item.akdPath);
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
          ℹ️ SKU dengan error nomor permohonan kosong otomatis dilewati (dicatat sebagai <i>skipped-*</i>) dan halaman di-REFRESH otomatis buat fresh start ke SKU berikutnya.
        </div>
        <button id="inaproc-start" style="width:100%; margin-bottom:4px; background:#1F4E78; color:#fff; font-weight:bold;">🚀 Mulai (klik "Daftarkan Merek" di halaman ini)</button>
        <button id="inaproc-run-next" style="width:100%; margin-bottom:8px;">▶ Proses SKU berikutnya di antrian (kalau sudah di halaman apply)</button>
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

  setInterval(() => { if (getStage()) main(); }, 2000);
})();