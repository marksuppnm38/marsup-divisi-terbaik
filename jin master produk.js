// ==UserScript==
// @name         INAPROC Auto Isi Master Produk Sectoral (Alkes - Kode Unik KFA) + Panel
// @namespace    inaproc-auto-master-produk
// @version      3.1.0
// @description  Panel UI untuk auto isi form pengajuan penunjukan Sectoral (Kategori Alkes: Kode Unik KFA) di penyedia.inaproc.id, unggah AKD & CPAKB dari Supabase Storage, konfirmasi, kirim, dan auto-lanjut antar SKU.
// @match        https://penyedia.inaproc.id/*
// @grant        none
// ==/UserScript==
(function () {
  'use strict';

  // ============================================================
  // CARA PAKAI:
  // 1. Login manual seperti biasa ke penyedia.inaproc.id
  // 2. Buka halaman daftar produk, mis:
  //      https://penyedia.inaproc.id/principal-applications?tab=ALL&p=1
  //    Panel kecil bakal muncul di pojok kanan atas (bisa digeser & diciutkan)
  // 3. Paste antrian di textarea, format TAB-separated, satu baris = satu SKU:
  //      KODE_KFA <TAB> PATH_FILE_AKD_DI_BUCKET
  //    contoh:  91000123<TAB>AKD-91000123.pdf
  // 4. Klik "Muat ke Antrian", lalu klik "🚀 Mulai" -- ini akan klik tombol
  //    "Daftarkan Merek" di halaman daftar produk dan lanjut isi SKU
  //    pertama begitu form apply-nya kebuka.
  // 5. "Dry run" NYALA secara default -- script isi semua field TAPI TIDAK
  //    centang konfirmasi & TIDAK klik Kirim. WAJIB test 1 SKU dulu dengan
  //    dry run sebelum mematikannya, karena setelah dry run dimatikan,
  //    data akan benar-benar terkirim ke sistem KFA nasional.
  // 6. "Auto-lanjut ke SKU berikutnya" HANYA berlaku kalau dry run OFF,
  //    karena dry run tidak menyisakan halaman baru untuk dilanjutkan
  //    (tidak ada submit -> tidak ada navigasi balik ke dashboard).
  //    Setelah tiap SKU sukses dikirim, script otomatis: Kembali ke
  //    Dashboard -> Daftarkan Merek -> isi SKU berikutnya.
  // 7. Kalau ada langkah yang gagal di tengah jalan, proses BERHENTI
  //    otomatis (tidak maksa lanjut ke SKU berikutnya) -- cek log & DOM
  //    manual dulu sebelum lanjut (tombol "Proses SKU berikutnya" bisa
  //    dipakai buat retry manual kalau kamu sudah di halaman apply).
  // ============================================================

  const CONFIG = {
    // Base URL public object storage Supabase kamu:
    // https://<project-ref>.supabase.co/storage/v1/object/public/<bucket-name>
    supabaseBaseUrl: 'https://ptkkbsemihcyndisjoor.supabase.co/storage/v1/object/public/perizinan',

    // Kalau bucket PRIVATE, isi ini. Kosongkan ('') kalau bucket-nya public.
    supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB0a2tic2VtaWhjeW5kaXNqb29yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0Njc4MzgsImV4cCI6MjA5ODA0MzgzOH0.QsCqmcqQcXvz1f8bLkagvMbAGUBbBP-3Wa5Aore5OMo',

    // CPAKB selalu sama untuk semua produk (1 jenis produk: instrumen).
    cpakbPath: 'Sertifikat CPAKB PNM KBLI 32509 K1.pdf',

    // Teks label kategori di dropdown sectoral yang harus dipilih
    kategoriLabel: 'Kategori Alkes: Kode Unik KFA',

    // Jeda antar-langkah (ms)
    stepDelay: 600,
  };

  const QUEUE_KEY = 'inaproc_master_queue_v1';
  const RESULTS_KEY = 'inaproc_master_results_v1';
  const FLAGS_KEY = 'inaproc_master_flags_v1';
  const STAGE_KEY = 'inaproc_master_stage_v1';

  // ---------- Storage helpers ----------
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

  // ---------- Log ----------
  function log(msg) {
    const box = document.getElementById('inaproc-log');
    if (box) {
      const line = document.createElement('div');
      line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
      box.prepend(line);
    }
    console.log('[INAPROC-AUTO]', msg);
  }

  // ---------- Util dasar ----------
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

  function waitForElementByText(selector, text, { timeout = 10000, root = document } = {}) {
    return new Promise((resolve, reject) => {
      const check = () => {
        const els = Array.from(root.querySelectorAll(selector));
        return els.find((el) => el.textContent.trim() === text);
      };
      const found = check();
      if (found) return resolve(found);
      const observer = new MutationObserver(() => {
        const el = check();
        if (el) { observer.disconnect(); resolve(el); }
      });
      observer.observe(root, { childList: true, subtree: true });
      setTimeout(() => { observer.disconnect(); reject(new Error(`Timeout menunggu elemen berteks: "${text}" (${selector})`)); }, timeout);
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

  // Cari elemen ber-teks persis `text` yang BENAR-BENAR terlihat (dan opsional harus
  // enabled), lalu klik tombolnya. Ini menghindari salah klik elemen duplikat yang
  // sama teksnya tapi lagi disembunyikan/disabled di DOM (umum kejadian di web app
  // reaktif -- ada beberapa elemen untuk state berbeda yang hidup bersamaan).
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

  // ---------- Ambil file dari Supabase Storage -> File object ----------
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

  function findFileInputNearLabel(labelText, occurrenceIndex = 0, maxParentHops = 6) {
    const spans = Array.from(document.querySelectorAll('span')).filter((s) => s.textContent.trim() === labelText);
    const span = spans[occurrenceIndex];
    if (!span) return null;
    let node = span;
    for (let i = 0; i < maxParentHops; i++) {
      if (!node.parentElement) break;
      node = node.parentElement;
      const input = node.querySelector('input[type="file"]');
      if (input) return input;
    }
    return null;
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
    // Cari kontrol select yang BARU muncul setelah radio "sectoral" dipilih --
    // ini lebih akurat daripada asal ambil select__control pertama di halaman,
    // karena mungkin ada beberapa dropdown react-select lain sudah ada duluan.
    let control = await pollUntil(() => {
      const now = Array.from(document.querySelectorAll('[class*="select__control"]'));
      const fresh = now.find((el) => !controlsBeforeSectoral.has(el) && isVisible(el));
      return fresh || null;
    }, { timeout: 8000 }).catch(() => null);

    if (!control) {
      // Fallback: kontrol select pertama yang visible di halaman
      control = Array.from(document.querySelectorAll('[class*="select__control"]')).find(isVisible) || null;
    }
    if (!control) throw new Error('Tidak menemukan kontrol dropdown kategori sama sekali. Cek selector di DevTools.');

    clickElement(control);
    await sleep(CONFIG.stepDelay);

    // Opsi react-select biasanya di-PORTAL keluar dari kontrolnya (dirender di
    // tempat lain di DOM, bukan di dalam elemen kontrolnya) -- jadi dicari di
    // SELURUH dokumen, lalu difilter yang visible & posisinya dekat kontrol ini,
    // bukan dicari lewat hubungan parent/child ke kontrolnya.
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
      console.log('[INAPROC-AUTO] Opsi dropdown kategori nggak ketemu. Kandidat opsi yang visible di halaman saat ini:');
      allVisibleOptions.forEach((el, i) => console.log(`[INAPROC-AUTO] Opsi ${i}: "${el.textContent.trim()}"`, el));
      throw new Error(`Opsi "${CONFIG.kategoriLabel}" nggak ketemu di dropdown yang kebuka. Cek console (F12) buat lihat daftar opsi yang kedetect.`);
    }

    clickElement(option);
    await sleep(CONFIG.stepDelay);

    // Verifikasi: kontrolnya harus SUDAH BERGANTI dari placeholder "Pilih" ke nilai
    // yang dipilih. Kalau tetap "Pilih" berarti klik opsi tadi nggak beneran kena.
    const selected = await pollUntil(() => {
      const text = control.textContent.trim();
      return text && text !== 'Pilih' ? text : null;
    }, { timeout: 5000 }).catch(() => null);

    if (!selected) {
      throw new Error('Dropdown kategori masih menunjukkan placeholder "Pilih" setelah opsi diklik -- kemungkinan klik opsi nggak kena elemen yang benar. Cek manual / console (F12).');
    }
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
    await sleep(CONFIG.stepDelay * 2);
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

    const akdInput = findFileInputNearLabel('Unggah Dokumen', 0);
    if (!akdInput) throw new Error('Input file AKD tidak ditemukan. Sesuaikan findFileInputNearLabel().');
    injectFileToInput(akdInput, akdFile);
    await sleep(CONFIG.stepDelay);

    const cpakbInput = findFileInputNearLabel('Unggah Dokumen', 1);
    if (!cpakbInput) throw new Error('Input file CPAKB tidak ditemukan (slot kedua "Unggah Dokumen").');
    injectFileToInput(cpakbInput, cpakbFile);
    await sleep(CONFIG.stepDelay);
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
    if (!selesai) {
      throw new Error('Tombol "Kirim" masih terlihat setelah 15 detik -- submit kemungkinan gagal/nyangkut. BERHENTI, tidak lanjut ke Kembali ke Dashboard.');
    }
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

  // Titik mulai: halaman daftar produk, mis. penyedia.inaproc.id/principal-applications?tab=ALL&p=1
  // Dipanggil manual dari tombol panel "Mulai" -- klik "Daftarkan Merek" lalu tandai stage
  // supaya begitu halaman apply termuat, main() otomatis lanjut isi SKU pertama di antrian.
  async function startFromDaftarkanMerek() {
    const q = loadQueue();
    if (!q.length) { log('⚠️ Antrian masih kosong. Muat antrian dulu sebelum klik Mulai.'); return; }
    const adaTombol = document.body.textContent.includes('Daftarkan Merek');
    if (!adaTombol) {
      log('⚠️ Tombol "Daftarkan Merek" nggak ketemu di halaman ini. Pastikan kamu di halaman daftar produk (principal-applications), bukan halaman lain.');
      return;
    }
    log('🚀 Memulai: klik "Daftarkan Merek"...');
    setStage('await_apply_form');
    try {
      await klikDaftarkanMerek();
      // Kalau navigasi bukan full reload (SPA route change), main() lewat MutationObserver
      // panel init tidak otomatis jalan lagi -- jadi cek langsung juga di sini sebagai jaga-jaga.
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

  // ---------- Orkestrasi satu SKU ----------
  async function processNextInQueue() {
    const q = loadQueue();
    if (!q.length) { log('✅ Antrian kosong, nggak ada yang diproses.'); return; }
    const item = q[0];
    log(`Memproses KFA "${item.kfaCode}"...`);

    try {
      await pilihJenisSectoral();
      await pilihKategoriDropdown();
      await isiNomorProduk(item.kfaCode);
      await klikPeriksa();
      await centangTipePenyedia();
      await unggahDokumen(item.akdPath);

      if (flags.dryRun) {
        log(`[DRY RUN] KFA "${item.kfaCode}" selesai diisi. Checkbox konfirmasi & tombol Kirim TIDAK diklik. Cek manual dulu, matikan "Dry run" kalau sudah yakin.`);
        recordResult(item.kfaCode, 'dry-run');
        shiftQueueIfMatches(item.kfaCode);
        renderPanel();
        return;
      }

      await centangKonfirmasiValiditas();
      await klikKirim();

      recordResult(item.kfaCode, 'submitted');
      shiftQueueIfMatches(item.kfaCode);
      renderPanel();

      const remaining = loadQueue().length;
      if (flags.autoContinueQueue && remaining > 0) {
        log(`➡️ Auto-lanjut: masih ada ${remaining} SKU di antrian. Kembali ke dashboard...`);
        setStage('await_daftarkan');
        await klikKembaliKeDashboard();
        // Halaman kemungkinan navigasi/reload - sisanya ditangani main() saat load berikutnya
      } else if (flags.autoContinueQueue) {
        setStage(null);
        await klikKembaliKeDashboard();
        log('🎉 Semua item di antrian sudah selesai dikirim.');
      } else {
        log(`✅ KFA "${item.kfaCode}" berhasil dikirim. Klik "Proses SKU berikutnya" lagi untuk lanjut manual.`);
      }
    } catch (err) {
      log(`⚠️ Gagal memproses KFA "${item.kfaCode}": ${err.message}`);
      console.error('[INAPROC-AUTO]', err);
    }
  }

  // ---------- State machine lintas-halaman (dashboard <-> apply) ----------
  let mainInProgress = false;
  async function main() {
    if (mainInProgress) return;
    const stage = getStage();
    if (!stage) return;

    mainInProgress = true;
    try {
      if (stage === 'await_daftarkan') {
        // klikDaftarkanMerek() sendiri sudah nunggu (polling) sampai 15 detik buat
        // elemennya muncul & aktif, jadi nggak perlu gate cek dulu di sini -- gate
        // seperti itu justru bikin main() nyerah kalau dipanggil pas halaman belum
        // sempat render listingnya.
        setStage('await_apply_form');
        await klikDaftarkanMerek();
      } else if (stage === 'await_apply_form') {
        // pilihJenisSectoral() (dipanggil dari processNextInQueue) juga sudah nunggu
        // elemen #sectoral sampai 10 detik, jadi langsung coba proses saja.
        setStage(null);
        await sleep(CONFIG.stepDelay);
        await processNextInQueue();
      }
    } catch (err) {
      log(`⚠️ Auto-continue gagal di stage "${stage}": ${err.message}. Lanjutkan manual lewat panel.`);
      setStage(null);
      console.error('[INAPROC-AUTO]', err);
    } finally {
      mainInProgress = false;
    }
  }

  // ---------- Export hasil ----------
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
    if (copied) log(`📋 ${results.length} baris hasil ke-copy ke clipboard (TSV) -- tinggal paste ke Google Sheets.`);
    else log('⚠️ Copy otomatis gagal. Textarea "Preview hasil" sudah ke-select -- tekan Ctrl+C manual.');
    showTsvPreview(text);
  }

  // ---------- Panel UI ----------
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

    // Drag
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
      if (confirm('Yakin reset antrian & hasil? Ini tidak menghapus data yang sudah terkirim ke INAPROC, cuma di panel ini.')) {
        localStorage.removeItem(QUEUE_KEY);
        localStorage.removeItem(RESULTS_KEY);
        renderPanel();
      }
    };
  }

  // ---------- Init ----------
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
      main(); // retry stage pending tiap ada perubahan DOM signifikan (nge-cover SPA route change)
    }, 800);
  });
  if (document.body) bodyObserver.observe(document.body, { childList: true, subtree: true });

  // Jaring pengaman tambahan: kalau nggak ada perubahan DOM yang kedetect observer
  // (mis. konten di-render lewat cara yang nggak memicu childList mutation di <body>),
  // tetap coba lagi tiap 2 detik selama masih ada stage auto-continue yang nunggu.
  setInterval(() => { if (getStage()) main(); }, 2000);
})();