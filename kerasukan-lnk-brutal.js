// ==UserScript==
// @name         INAPROC Upload Produk V6 (Task 3 - FormFiller Isi Dasar + Bisnis)
// @namespace    inaproc-upload-produk-v6
// @version      0.3.0
// @description  Task 1: framework/pondasi. Task 2: modul Navigation. Task 3: FormFiller Section 1 (Isi Dasar) + Section 5 (Bisnis) untuk field yang selector-nya sudah pasti. Field Merek/KBKI/Daftar Produk Sektoral sengaja di-stub (butuh observasi live), belum ada TKDN/SNI/Spesifikasi/Lampiran/Simpan.
// @author       you
// @match        https://penyedia.inaproc.id/products
// @match        https://penyedia.inaproc.id/products/add
// @run-at       document-idle
// @grant        none
// ==/UserScript==
/* eslint-disable no-console */
(function () {
  'use strict';
  // Guard: pastikan script hanya jalan sekali walau ke-inject berkali-kali
  if (window.__INAPROC_V6_LOADED__) {
    return;
  }
  window.__INAPROC_V6_LOADED__ = true;
  // =====================================================================
  // #region CONFIG
  // =====================================================================
  const CONFIG = {
    version: '0.3.0',
    debug: true,
    dryRun: true,       // Task 3: masih dryRun secara default -- klik Simpan belum ada sama sekali (Task 11)
    autoContinue: false,
    retryLimit: 3,
    waitTimeout: 10000,     // ms
    pollingInterval: 300,   // ms
    targetUrl: 'https://penyedia.inaproc.id/products',
    // Stage terakhir yang boleh dijalankan otomatis oleh Main.start() pada
    // Task ini. Stage sesudahnya (tkdn, sni, spesifikasi, upload, save)
    // belum diimplementasikan -- lihat progress.md.
    stopAfterStage: 'bisnis',
    // Selector Task 2 (Navigation).
    selectors: {
      addProductButton: '#products-add-product-btn',
      addProductSidebarLink: 'a[href="/products/add"]',
    },
    addProductUrlPart: '/products/add',

    // Selector Task 3 (Isi Dasar + Bisnis). Semua sudah diverifikasi
    // langsung dari outerHTML form Tambah Produk (bukan tebakan), KECUALI
    // yang ditandai [BELUM TERVERIFIKASI].
    formSelectors: {
      // --- Section 1: Isi Dasar ---
      merekSwitch: '#form-product-brand-isActive-switch',            // [BELUM TERVERIFIKASI apa yg muncul sesudah di-on]
      kbkiButton: '#form-product-kbki-select',                       // [BELUM TERVERIFIKASI apa yg muncul sesudah diklik]
      daftarProdukSektoralHeading: 'Daftar Produk Sektoral',          // [BELUM TERVERIFIKASI perilaku search-nya]
      kategoriTrigger: '#form-product-category-select',
      kategoriKolomList: 'ul.custom-scrollbar',                      // ada 1-3 elemen tergantung berapa level sudah dipilih
      namaProdukInput: '#form-product-name-input',
      deskripsiTextarea: 'textarea[name="description"]',
      klasifikasiProdukSelect: '#form-product-product-type-select',
      lokasiProduksiSelect: '#form-product-location-type-select',
      tenagaKerjaSelect: '#form-product-labor-type-select',
      bahanBakuSelect: '#form-product-material-type-select',
      fotoProdukInputPrefix: '#product-image-input-',                // + index 0..4

      // --- Section 5: Bisnis ---
      hargaInput: '#form-product-price-input',
      stokInput: '#stockUnit-value-input',
      satuanProdukHeading: 'Satuan Produk',                          // anchor by heading, BUKAN by id -- id aslinya
                                                                      // rusak di source (literal `"` nyasar di awal id),
                                                                      // lihat progress.md
      beratInput: '#form-product-variants-shipping-weight-input',
      minPembelianInput: '#form-product-min-purchase-input',
      jenisPajakSelect: '#ppnPercentage-select',
      preOrderSwitch: '#form-product-preorder-isActive-switch',
    },

    // Nilai default field react-select yang SUDAH BENAR di form (statement
    // TKDN lokal 100%). Dipakai untuk VERIFIKASI saja (baca, bukan ubah),
    // supaya kalau suatu saat default form berubah, script kasih warning
    // -- bukan diam-diam salah isi.
    expectedDefaults: {
      klasifikasiProduk: 'Lokal',
      lokasiProduksi: 'Diproduksi di seluruh Indonesia',
      tenagaKerja: 'Dibuat oleh seluruh tenaga kerja Indonesia di dalam negeri',
      bahanBaku: 'Seluruh bahan baku dalam negeri',
    },
  };
  // #endregion CONFIG
  // =====================================================================
  // #region STORAGE KEYS
  // =====================================================================
  const STORAGE_KEYS = {
    QUEUE_KEY: 'inaproc_v6_queue',
    RESULT_KEY: 'inaproc_v6_results',
    FLAG_KEY: 'inaproc_v6_flags',
    STAGE_KEY: 'inaproc_v6_stage',
    CONFIG_KEY: 'inaproc_v6_config',
  };
  const Storage = {
    save(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (e) {
        console.error('[INAPROC V6] Storage.save error:', e);
        return false;
      }
    },
    load(key, fallback = null) {
      try {
        const raw = localStorage.getItem(key);
        if (raw === null) return fallback;
        return JSON.parse(raw);
      } catch (e) {
        console.error('[INAPROC V6] Storage.load error:', e);
        return fallback;
      }
    },
    remove(key) {
      try {
        localStorage.removeItem(key);
        return true;
      } catch (e) {
        console.error('[INAPROC V6] Storage.remove error:', e);
        return false;
      }
    },
  };
  // #endregion STORAGE KEYS
  // =====================================================================
  // #region STATE
  // =====================================================================
  const STATE = {
    currentStage: 'idle',
    currentSku: null,
    isRunning: false,
    isPaused: false,
    currentIndex: 0,
    queue: [],
    results: [],
    flags: {},
    statusText: null,
  };
  // #endregion STATE
  // =====================================================================
  // #region LOGGER
  // =====================================================================
  const LOG_LEVELS = {
    INFO: 'INFO',
    SUCCESS: 'SUCCESS',
    WARNING: 'WARNING',
    ERROR: 'ERROR',
    DEBUG: 'DEBUG',
  };
  const Logger = {
    _entries: [],
    _panelListEl: null,
    _timestamp() {
      const d = new Date();
      const pad = (n, l = 2) => String(n).padStart(l, '0');
      return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
    },
    _write(level, message, data) {
      const ts = this._timestamp();
      const entry = { level, message, data: data ?? null, ts };
      this._entries.push(entry);
      const consoleMsg = `[INAPROC V6][${ts}][${level}] ${message}`;
      switch (level) {
        case LOG_LEVELS.ERROR:
          console.error(consoleMsg, data ?? '');
          break;
        case LOG_LEVELS.WARNING:
          console.warn(consoleMsg, data ?? '');
          break;
        case LOG_LEVELS.DEBUG:
          if (CONFIG.debug) console.debug(consoleMsg, data ?? '');
          break;
        default:
          console.log(consoleMsg, data ?? '');
      }
      this._renderToPanel(entry);
    },
    setPanelListElement(el) {
      this._panelListEl = el;
      this._entries.forEach((entry) => this._renderToPanel(entry));
    },
    _renderToPanel(entry) {
      if (!this._panelListEl) return;
      const row = document.createElement('div');
      row.style.padding = '2px 4px';
      row.style.fontFamily = 'monospace';
      row.style.fontSize = '11px';
      row.style.whiteSpace = 'pre-wrap';
      row.style.wordBreak = 'break-word';
      const colorMap = {
        INFO: '#8ab4f8',
        SUCCESS: '#81c995',
        WARNING: '#fdd663',
        ERROR: '#f28b82',
        DEBUG: '#c58af9',
      };
      row.style.color = colorMap[entry.level] || '#e0e0e0';
      row.textContent = `[${entry.ts}] [${entry.level}] ${entry.message}`;
      this._panelListEl.appendChild(row);
      this._panelListEl.scrollTop = this._panelListEl.scrollHeight;
    },
    info(msg, data) { this._write(LOG_LEVELS.INFO, msg, data); },
    success(msg, data) { this._write(LOG_LEVELS.SUCCESS, msg, data); },
    warning(msg, data) { this._write(LOG_LEVELS.WARNING, msg, data); },
    error(msg, data) { this._write(LOG_LEVELS.ERROR, msg, data); },
    debug(msg, data) { this._write(LOG_LEVELS.DEBUG, msg, data); },
    exportAsText() {
      return this._entries
        .map((e) => `[${e.ts}] [${e.level}] ${e.message}${e.data ? ' ' + JSON.stringify(e.data) : ''}`)
        .join('\n');
    },
    clear() {
      this._entries = [];
      if (this._panelListEl) this._panelListEl.innerHTML = '';
    },
  };
  // #endregion LOGGER
  // =====================================================================
  // #region QUEUE MANAGER
  // =====================================================================
  // Bentuk item queue Task 3 (SEMENTARA, MANUAL -- belum disambungkan ke
  // Supabase, itu Task 8). Field yang di-comment "opsional" boleh kosong
  // dulu karena bagian formnya belum diimplementasikan.
  //
  // {
  //   kodeProduk: "RB00123",
  //   kbki: "4815013019 - Manual surgical instrument for general use", // opsional (Task 4)
  //   kategori: ["Alat Kesehatan", "Peralatan Bedah Umum dan Bedah Plastik", "Peralatan Bedah"],
  //   namaProduk: "ROBUST Gunting Bedah Lurus 14cm",
  //   deskripsi: "ROBUST Gunting Bedah Lurus 14cm, stainless steel...",
  //   harga: 150000,
  //   stok: 10,
  //   satuan: "Pcs",
  //   berat: 500,        // gram
  //   minPembelian: 1,
  //   jenisPajak: "PPN 11%", // teks opsi PPN persis sesuai dropdown
  // }
  const QueueManager = {
    loadQueue() {
      const saved = Storage.load(STORAGE_KEYS.QUEUE_KEY, []);
      STATE.queue = Array.isArray(saved) ? saved : [];
      Logger.debug(`Queue dimuat dari localStorage (${STATE.queue.length} item).`);
      return STATE.queue;
    },
    saveQueue() {
      const ok = Storage.save(STORAGE_KEYS.QUEUE_KEY, STATE.queue);
      if (ok) Logger.debug(`Queue disimpan (${STATE.queue.length} item).`);
      return ok;
    },
    setQueue(items) {
      STATE.queue = Array.isArray(items) ? items : [];
      STATE.currentIndex = 0;
      this.saveQueue();
      return STATE.queue;
    },
    getCurrent() {
      if (STATE.currentIndex < 0 || STATE.currentIndex >= STATE.queue.length) {
        return null;
      }
      return STATE.queue[STATE.currentIndex];
    },
    next() {
      if (STATE.currentIndex < STATE.queue.length - 1) {
        STATE.currentIndex += 1;
      } else {
        Logger.warning('Queue sudah berada di item terakhir.');
      }
      return this.getCurrent();
    },
    previous() {
      if (STATE.currentIndex > 0) {
        STATE.currentIndex -= 1;
      } else {
        Logger.warning('Queue sudah berada di item pertama.');
      }
      return this.getCurrent();
    },
    reset() {
      STATE.currentIndex = 0;
      STATE.results = [];
      Logger.info('Queue direset ke posisi awal.');
      return this.getCurrent();
    },
    isEmpty() {
      return STATE.queue.length === 0;
    },
    size() {
      return STATE.queue.length;
    },
  };
  // #endregion QUEUE MANAGER
  // =====================================================================
  // #region STAGE MANAGER
  // =====================================================================
  const STAGES = [
    'idle',
    'isi_dasar',
    'tkdn',
    'sni',
    'spesifikasi',
    'bisnis',
    'upload',
    'save',
    'finished',
  ];
  const StageManager = {
    STAGES,
    setStage(stage) {
      if (!STAGES.includes(stage)) {
        Logger.error(`Stage tidak dikenal: ${stage}`);
        return false;
      }
      STATE.currentStage = stage;
      this.saveStage();
      Logger.info(`Stage diubah menjadi: ${stage}`);
      UIPanel.refresh();
      return true;
    },
    getStage() {
      return STATE.currentStage;
    },
    saveStage() {
      return Storage.save(STORAGE_KEYS.STAGE_KEY, STATE.currentStage);
    },
    loadStage() {
      const saved = Storage.load(STORAGE_KEYS.STAGE_KEY, 'idle');
      STATE.currentStage = STAGES.includes(saved) ? saved : 'idle';
      Logger.debug(`Stage dimuat dari localStorage: ${STATE.currentStage}`);
      return STATE.currentStage;
    },
    resetStage() {
      this.setStage('idle');
    },
  };
  // #endregion STAGE MANAGER
  // =====================================================================
  // #region DOM HELPER
  // =====================================================================
  const DomHelper = {
    sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    },
    waitForElement(selector, { timeout = CONFIG.waitTimeout, root = document } = {}) {
      return new Promise((resolve, reject) => {
        const existing = root.querySelector(selector);
        if (existing) {
          resolve(existing);
          return;
        }
        const observer = new MutationObserver(() => {
          const el = root.querySelector(selector);
          if (el) {
            observer.disconnect();
            clearTimeout(timer);
            resolve(el);
          }
        });
        observer.observe(root === document ? document.documentElement : root, {
          childList: true,
          subtree: true,
        });
        const timer = setTimeout(() => {
          observer.disconnect();
          reject(new Error(`waitForElement timeout untuk selector: ${selector}`));
        }, timeout);
      });
    },
    pollUntil(conditionFn, { timeout = CONFIG.waitTimeout, interval = CONFIG.pollingInterval } = {}) {
      return new Promise((resolve, reject) => {
        const start = Date.now();
        const check = () => {
          let result;
          try {
            result = conditionFn();
          } catch (e) {
            reject(e);
            return;
          }
          if (result) {
            resolve(result);
            return;
          }
          if (Date.now() - start >= timeout) {
            reject(new Error('pollUntil timeout'));
            return;
          }
          setTimeout(check, interval);
        };
        check();
      });
    },
    scrollIntoView(el, options = { behavior: 'smooth', block: 'center' }) {
      if (!el) return;
      el.scrollIntoView(options);
    },
    setNativeValue(el, value) {
      if (!el) return;
      const proto = Object.getPrototypeOf(el);
      const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
      const setter = descriptor && descriptor.set;
      if (setter) {
        setter.call(el, value);
      } else {
        el.value = value;
      }
    },
    dispatchInput(el) {
      if (!el) return;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    },
    dispatchChange(el) {
      if (!el) return;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    dispatchClick(el) {
      if (!el) return;
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    },
    // Inject File ke <input type="file"> pakai DataTransfer supaya lolos
    // deteksi React (bypass file picker asli). Dipakai lagi di Task 5
    // (Foto Produk) dan Task 10 (Lampiran).
    injectFileToInput(inputEl, file) {
      if (!inputEl || !file) {
        Logger.error('injectFileToInput: inputEl atau file kosong.');
        return false;
      }
      try {
        const dt = new DataTransfer();
        dt.items.add(file);
        inputEl.files = dt.files;
        this.dispatchInput(inputEl);
        this.dispatchChange(inputEl);
        return true;
      } catch (e) {
        Logger.error('injectFileToInput gagal.', { reason: e.message });
        return false;
      }
    },
    // Anchor-by-teks: cari <h3> section yang textnya persis sama, lalu
    // naik ke ancestor "row" section (class mengandung "flex-row").
    // Dipakai untuk field yang id-nya tidak stabil/tidak ada
    // (Satuan Produk, Daftar Produk Sektoral).
    findRowByHeading(headingText) {
      const headings = Array.from(document.querySelectorAll('h3'));
      const h3 = headings.find((h) => h.textContent.trim() === headingText.trim());
      if (!h3) {
        Logger.warning(`findRowByHeading: heading "${headingText}" tidak ditemukan.`);
        return null;
      }
      let node = h3;
      for (let i = 0; i < 8 && node; i += 1) {
        node = node.parentElement;
        if (node && typeof node.className === 'string' && node.className.includes('flex-row')) {
          return node;
        }
      }
      Logger.warning(`findRowByHeading: row wrapper untuk "${headingText}" tidak ketemu, dikembalikan null.`);
      return null;
    },
  };
  // #endregion DOM HELPER
  // =====================================================================
  // #region REACT SELECT HELPER
  // =====================================================================
  // Helper generik untuk komponen react-select (bukan kombobox kaskade
  // Kategori yang punya pola sendiri -- lihat FormFiller.fillKategori).
  const ReactSelectHelper = {
    // Baca text opsi yang sedang terpilih TANPA mengubah apa pun.
    // container = element hasil querySelector pembungkus react-select
    // (biasanya punya class css-b62m3t-container / id *-select).
    readValue(container) {
      if (!container) return null;
      const el = container.querySelector('.select__single-value');
      return el ? el.textContent.trim() : null;
    },
    async select(container, optionText, { timeout = CONFIG.waitTimeout } = {}) {
      if (!container) {
        throw new Error('ReactSelectHelper.select: container null.');
      }
      const control = container.querySelector('.select__control') || container;
      DomHelper.dispatchClick(control);
      await DomHelper.sleep(150);
      const input = container.querySelector('.select__input');
      if (input) {
        DomHelper.setNativeValue(input, optionText);
        DomHelper.dispatchInput(input);
      }
      const option = await DomHelper.pollUntil(() => {
        const opts = Array.from(document.querySelectorAll('.select__option'));
        return (
          opts.find((o) => o.textContent.trim() === optionText.trim()) ||
          opts.find((o) => o.textContent.trim().includes(optionText.trim()))
        );
      }, { timeout }).catch(() => null);
      if (!option) {
        throw new Error(`ReactSelectHelper.select: opsi "${optionText}" tidak ditemukan di menu.`);
      }
      DomHelper.dispatchClick(option);
      await DomHelper.sleep(150);
      return true;
    },
  };
  // #endregion REACT SELECT HELPER
  // =====================================================================
  // #region NAVIGATION
  // =====================================================================
  const Navigation = {
    isProductForm() {
      const urlOk = window.location.pathname.indexOf(CONFIG.addProductUrlPart) === 0;
      if (!urlOk) return false;
      const hasGenericContent = !!(
        document.querySelector('h1, h2') ||
        document.querySelector('form') ||
        document.querySelector('input')
      );
      return hasGenericContent;
    },
    async waitForProductForm({ timeout = CONFIG.waitTimeout } = {}) {
      Logger.info('Waiting Product Form');
      UIPanel.setStatusText('Waiting Product Form...');
      try {
        await DomHelper.pollUntil(() => this.isProductForm(), {
          timeout,
          interval: CONFIG.pollingInterval,
        });
      } catch (e) {
        Logger.error('Product Form Not Loaded', { reason: e.message });
        throw new Error('PRODUCT_FORM_NOT_LOADED');
      }
      Logger.success('Product Form Loaded');
      return true;
    },
    async findAddProductButton({ timeout = CONFIG.waitTimeout } = {}) {
      try {
        const btn = await DomHelper.waitForElement(CONFIG.selectors.addProductButton, { timeout });
        return btn;
      } catch (e) {
        Logger.warning('Tombol utama Tambah Produk tidak ditemukan, mencoba fallback sidebar link.');
      }
      try {
        const link = await DomHelper.waitForElement(CONFIG.selectors.addProductSidebarLink, { timeout });
        return link;
      } catch (e) {
        return null;
      }
    },
    async gotoAddProduct() {
      // Kalau sudah ada di halaman Tambah Produk (mis. reload di tengah
      // proses), skip klik tombol, langsung anggap navigasi selesai.
      if (this.isProductForm()) {
        Logger.info('Sudah berada di halaman Tambah Produk, skip klik tombol.');
        StageManager.setStage('isi_dasar');
        return true;
      }
      Logger.info('Start Navigation');
      UIPanel.setStatusText('Navigating...');
      let attempt = 0;
      let lastError = null;
      while (attempt < CONFIG.retryLimit) {
        attempt += 1;
        try {
          Logger.info('Searching Add Product Button');
          const btn = await this.findAddProductButton();
          if (!btn) {
            Logger.error('Button Not Found');
            lastError = new Error('BUTTON_NOT_FOUND');
            await DomHelper.sleep(CONFIG.pollingInterval);
            continue;
          }
          DomHelper.scrollIntoView(btn);
          Logger.info('Clicking Add Product');
          DomHelper.dispatchClick(btn);
          await this.waitForProductForm();
          StageManager.setStage('isi_dasar');
          UIPanel.setStatusText('Idle');
          return true;
        } catch (e) {
          lastError = e;
          if (e && e.message === 'PRODUCT_FORM_NOT_LOADED') {
            Logger.error('Navigation Timeout');
          }
          Logger.warning(`Percobaan navigasi ke-${attempt} gagal. Sisa percobaan: ${CONFIG.retryLimit - attempt}.`);
        }
      }
      UIPanel.setStatusText('Idle');
      Logger.error('Navigasi gagal setelah mencapai retryLimit.', { lastError: lastError && lastError.message });
      return false;
    },
    backToProductList() {
      Logger.debug('backToProductList() dipanggil (placeholder, belum diimplementasikan -- Task 11).');
    },
  };
  // #endregion NAVIGATION
  // =====================================================================
  // #region FORM FILLER (Task 3: Isi Dasar + Bisnis)
  // =====================================================================
  const FormFiller = {
    // -------------------------------------------------------------
    // Section 1: Isi Dasar
    // -------------------------------------------------------------

    // [STUB - butuh observasi live, lihat progress.md]
    // Cuma toggle switch, TIDAK menebak UI search yang muncul sesudahnya.
    async fillMerek() {
      const sw = await DomHelper.waitForElement(CONFIG.formSelectors.merekSwitch);
      if (!sw.checked) {
        Logger.info('Mengaktifkan switch Merek...');
        DomHelper.dispatchClick(sw);
        await DomHelper.sleep(300);
      }
      Logger.warning(
        'STUB: switch Merek sudah di-on, tapi UI search/pilih kode merek sesudahnya BELUM diimplementasikan ' +
        '(belum ada outerHTML referensinya). Cek manual di browser, lalu kirim outerHTML-nya supaya Task 4 bisa lanjut.'
      );
      return 'NEEDS_MANUAL_REVIEW';
    },

    // [STUB - butuh observasi live, lihat progress.md]
    async fillKbki(item) {
      const btn = await DomHelper.waitForElement(CONFIG.formSelectors.kbkiButton);
      DomHelper.dispatchClick(btn);
      await DomHelper.sleep(300);
      Logger.warning(
        `STUB: tombol Kode KBKI sudah diklik (target isi: "${item.kbki || '(kosong)'}"), tapi UI list/search ` +
        'hasil klik BELUM diimplementasikan. Cek manual di browser, lalu kirim outerHTML-nya supaya Task 4 bisa lanjut.'
      );
      return 'NEEDS_MANUAL_REVIEW';
    },

    // [STUB - butuh observasi live, lihat progress.md]
    async fillDaftarProdukSektoral(item) {
      const row = DomHelper.findRowByHeading(CONFIG.formSelectors.daftarProdukSektoralHeading);
      if (!row) {
        Logger.error('Daftar Produk Sektoral: row tidak ditemukan sama sekali.');
        return 'NOT_FOUND';
      }
      Logger.warning(
        `STUB: container Daftar Produk Sektoral ketemu, tapi belum tahu apakah searchable-by-Kode-Produk ` +
        `atau dropdown list biasa (target: "${item.kodeProduk}"). Belum diisi otomatis. Cek manual di browser.`
      );
      return 'NEEDS_MANUAL_REVIEW';
    },

    async fillKategori(item) {
      const [level1, level2, level3] = item.kategori || [];
      if (!level1 || !level2 || !level3) {
        Logger.error('fillKategori: item.kategori harus array 3 level [lvl1, lvl2, lvl3].', { kategori: item.kategori });
        return false;
      }
      const trigger = await DomHelper.waitForElement(CONFIG.formSelectors.kategoriTrigger);
      const isOpen = () => document.querySelectorAll(CONFIG.formSelectors.kategoriKolomList).length > 0;
      if (!isOpen()) {
        Logger.info('Membuka dropdown Kategori...');
        DomHelper.dispatchClick(trigger);
        await DomHelper.pollUntil(isOpen, { timeout: 5000 });
      }
      await this._pilihKolomKategori(0, level1);
      await this._pilihKolomKategori(1, level2);
      await this._pilihKolomKategori(2, level3);
      Logger.success(`Kategori terisi: ${level1} > ${level2} > ${level3}`);
      return true;
    },
    async _pilihKolomKategori(colIndex, text) {
      await DomHelper.pollUntil(
        () => document.querySelectorAll(CONFIG.formSelectors.kategoriKolomList).length > colIndex,
        { timeout: 5000 }
      );
      const cols = document.querySelectorAll(CONFIG.formSelectors.kategoriKolomList);
      const col = cols[colIndex];
      const li = Array.from(col.querySelectorAll('li')).find((el) => {
        const span = el.querySelector('span');
        return span && span.textContent.trim() === text.trim();
      });
      if (!li) {
        throw new Error(`Kategori level ${colIndex + 1} "${text}" tidak ditemukan di kolom dropdown.`);
      }
      DomHelper.dispatchClick(li);
      await DomHelper.sleep(250); // beri waktu kolom berikutnya render
    },

    async fillNamaProduk(item) {
      const input = await DomHelper.waitForElement(CONFIG.formSelectors.namaProdukInput);
      DomHelper.setNativeValue(input, item.namaProduk || '');
      DomHelper.dispatchInput(input);
      Logger.success(`Nama Produk terisi: "${item.namaProduk}"`);
    },

    async fillDeskripsi(item) {
      const textarea = await DomHelper.waitForElement(CONFIG.formSelectors.deskripsiTextarea);
      DomHelper.setNativeValue(textarea, item.deskripsi || '');
      DomHelper.dispatchInput(textarea);
      Logger.success('Deskripsi terisi.');
    },

    // Field react-select yang defaultnya SUDAH BENAR (statement lokal
    // 100%) -- verifikasi saja, JANGAN diubah kecuali memang beda dari
    // yang diharapkan (lebih aman daripada paksa re-select tiap kali).
    async verifyDefaultLocalStatements() {
      const checks = [
        ['klasifikasiProdukSelect', 'klasifikasiProduk'],
        ['lokasiProduksiSelect', 'lokasiProduksi'],
        ['tenagaKerjaSelect', 'tenagaKerja'],
        ['bahanBakuSelect', 'bahanBaku'],
      ];
      let allOk = true;
      for (const [selectorKey, expectedKey] of checks) {
        const container = document.querySelector(CONFIG.formSelectors[selectorKey]);
        if (!container) {
          Logger.error(`verifyDefaultLocalStatements: container "${selectorKey}" tidak ditemukan.`);
          allOk = false;
          continue;
        }
        const actual = ReactSelectHelper.readValue(container);
        const expected = CONFIG.expectedDefaults[expectedKey];
        if (actual === expected) {
          Logger.debug(`OK: ${selectorKey} = "${actual}"`);
        } else {
          Logger.warning(
            `Default TIDAK sesuai untuk ${selectorKey}: diharapkan "${expected}", ditemukan "${actual}". ` +
            'Belum diubah otomatis -- cek manual dulu.'
          );
          allOk = false;
        }
      }
      return allOk;
    },

    // Upload Foto Produk. item.fotoFiles = array of File object.
    // CATATAN: sumber File asli (dari Supabase Storage) belum ada --
    // itu Task 8. Fungsi ini generik dan siap dipakai begitu File-nya ada.
    async fillFotoProduk(item) {
      const files = item.fotoFiles;
      if (!Array.isArray(files) || files.length === 0) {
        Logger.warning('fillFotoProduk: item.fotoFiles kosong, dilewati (belum ada sumber file -- Task 8).');
        return 'SKIPPED_NO_FILES';
      }
      let uploaded = 0;
      for (let i = 0; i < files.length && i < 5; i += 1) {
        const selector = `${CONFIG.formSelectors.fotoProdukInputPrefix}${i}`;
        const input = document.querySelector(selector);
        if (!input) {
          Logger.warning(`Slot foto ${i} (${selector}) tidak ditemukan, mungkin sudah terisi/slot habis.`);
          continue;
        }
        const ok = DomHelper.injectFileToInput(input, files[i]);
        if (ok) {
          uploaded += 1;
          Logger.success(`Foto slot ${i} berhasil di-inject: ${files[i].name}`);
          await DomHelper.sleep(300);
        }
      }
      return uploaded;
    },

    async isiDasar(item) {
      Logger.info(`=== Mulai isi Section 1 (Isi Dasar) untuk SKU ${item.kodeProduk} ===`);

      // Sengaja duluan: field yang masih STUB. Kalau salah satu butuh
      // review manual, proses berhenti di sini SEBELUM buang waktu ngisi
      // field lain yang sebenarnya sudah pasti jalan (lihat progress.md).
      const merekResult = await this.fillMerek();
      if (merekResult === 'NEEDS_MANUAL_REVIEW') {
        StageManager.setStage('isi_dasar');
        UIPanel.setStatusText('PAUSED: Merek butuh review manual (lihat log)');
        return 'PAUSED_MEREK';
      }
      const kbkiResult = await this.fillKbki(item);
      if (kbkiResult === 'NEEDS_MANUAL_REVIEW') {
        UIPanel.setStatusText('PAUSED: KBKI butuh review manual (lihat log)');
        return 'PAUSED_KBKI';
      }
      const sektoralResult = await this.fillDaftarProdukSektoral(item);
      if (sektoralResult === 'NEEDS_MANUAL_REVIEW') {
        UIPanel.setStatusText('PAUSED: Daftar Produk Sektoral butuh review manual (lihat log)');
        return 'PAUSED_SEKTORAL';
      }

      // Field yang sudah pasti selector-nya:
      await this.fillKategori(item);
      await this.fillNamaProduk(item);
      await this.fillFotoProduk(item);
      await this.fillDeskripsi(item);
      await this.verifyDefaultLocalStatements();

      Logger.success('=== Section 1 (Isi Dasar) selesai (kecuali bagian yang masih stub) ===');
      return 'OK';
    },

    // -------------------------------------------------------------
    // Section 5: Bisnis
    // -------------------------------------------------------------

    async fillHarga(item) {
      const input = await DomHelper.waitForElement(CONFIG.formSelectors.hargaInput);
      DomHelper.setNativeValue(input, String(item.harga ?? ''));
      DomHelper.dispatchInput(input);
      Logger.success(`Harga Produk terisi: ${item.harga}`);
    },

    async fillStok(item) {
      const input = await DomHelper.waitForElement(CONFIG.formSelectors.stokInput);
      DomHelper.setNativeValue(input, String(item.stok ?? ''));
      DomHelper.dispatchInput(input);
      Logger.success(`Jumlah Stok terisi: ${item.stok}`);
    },

    async fillSatuan(item) {
      if (!item.satuan) {
        Logger.warning('fillSatuan: item.satuan kosong, dilewati.');
        return;
      }
      const row = DomHelper.findRowByHeading(CONFIG.formSelectors.satuanProdukHeading);
      if (!row) {
        Logger.error('fillSatuan: row Satuan Produk tidak ditemukan.');
        return;
      }
      const container = row.querySelector('.css-b62m3t-container') || row;
      await ReactSelectHelper.select(container, item.satuan);
      Logger.success(`Satuan Produk terisi: ${item.satuan}`);
    },

    async fillBerat(item) {
      const input = await DomHelper.waitForElement(CONFIG.formSelectors.beratInput);
      DomHelper.setNativeValue(input, String(item.berat ?? ''));
      DomHelper.dispatchInput(input);
      Logger.success(`Berat Produk terisi: ${item.berat} gram`);
    },

    async fillMinPembelian(item) {
      const input = await DomHelper.waitForElement(CONFIG.formSelectors.minPembelianInput);
      DomHelper.setNativeValue(input, String(item.minPembelian ?? 1));
      DomHelper.dispatchInput(input);
      Logger.success(`Minimum Pembelian terisi: ${item.minPembelian ?? 1}`);
    },

    async fillJenisPajak(item) {
      if (!item.jenisPajak) {
        Logger.warning('fillJenisPajak: item.jenisPajak kosong, dilewati.');
        return;
      }
      const container = await DomHelper.waitForElement(CONFIG.formSelectors.jenisPajakSelect);
      await ReactSelectHelper.select(container, item.jenisPajak);
      Logger.success(`Jenis Pajak terisi: ${item.jenisPajak}`);
    },

    async isiBisnis(item) {
      Logger.info(`=== Mulai isi Section 5 (Bisnis) untuk SKU ${item.kodeProduk} ===`);
      await this.fillHarga(item);
      await this.fillStok(item);
      await this.fillSatuan(item);
      await this.fillBerat(item);
      await this.fillMinPembelian(item);
      await this.fillJenisPajak(item);
      // Pre Order sengaja TIDAK disentuh -- default "Tidak Aktif" sudah
      // sesuai kebutuhan (belum ada kasus yang butuh Pre Order aktif).
      Logger.success('=== Section 5 (Bisnis) selesai ===');
      return 'OK';
    },
  };
  // #endregion FORM FILLER
  // =====================================================================
  // #region UI PANEL
  // =====================================================================
  const UIPanel = {
    _root: null,
    _els: {},
    create() {
      if (document.getElementById('inaproc-v6-panel')) {
        this._root = document.getElementById('inaproc-v6-panel');
        return this._root;
      }
      const style = document.createElement('style');
      style.textContent = `
        #inaproc-v6-panel {
          position: fixed;
          top: 16px;
          right: 16px;
          width: 300px;
          background: #1e1e1e;
          color: #f0f0f0;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          font-size: 12px;
          border-radius: 8px;
          box-shadow: 0 4px 16px rgba(0,0,0,0.4);
          z-index: 999999;
          overflow: hidden;
          border: 1px solid #3a3a3a;
        }
        #inaproc-v6-panel .iv6-header {
          background: #2b2b2b;
          padding: 8px 10px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          cursor: move;
          user-select: none;
        }
        #inaproc-v6-panel .iv6-title {
          font-weight: 600;
          font-size: 13px;
        }
        #inaproc-v6-panel .iv6-version {
          opacity: 0.6;
          font-size: 10px;
        }
        #inaproc-v6-panel .iv6-body {
          padding: 10px;
        }
        #inaproc-v6-panel .iv6-row {
          display: flex;
          justify-content: space-between;
          margin-bottom: 4px;
        }
        #inaproc-v6-panel .iv6-row .iv6-label {
          opacity: 0.7;
        }
        #inaproc-v6-panel .iv6-buttons {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 6px;
          margin-top: 8px;
        }
        #inaproc-v6-panel button {
          background: #333;
          color: #f0f0f0;
          border: 1px solid #4a4a4a;
          border-radius: 4px;
          padding: 6px 8px;
          font-size: 11px;
          cursor: pointer;
        }
        #inaproc-v6-panel button:hover {
          background: #444;
        }
        #inaproc-v6-panel button:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        #inaproc-v6-panel .iv6-log {
          margin-top: 8px;
          height: 140px;
          overflow-y: auto;
          background: #111;
          border-radius: 4px;
          border: 1px solid #333;
        }
        #inaproc-v6-panel .iv6-export {
          width: 100%;
          margin-top: 6px;
        }
      `;
      document.head.appendChild(style);
      const root = document.createElement('div');
      root.id = 'inaproc-v6-panel';
      root.innerHTML = `
        <div class="iv6-header" id="iv6-drag-handle">
          <span class="iv6-title">INAPROC Upload V6</span>
          <span class="iv6-version">v${CONFIG.version}</span>
        </div>
        <div class="iv6-body">
          <div class="iv6-row"><span class="iv6-label">Status</span><span id="iv6-status">Idle</span></div>
          <div class="iv6-row"><span class="iv6-label">Stage</span><span id="iv6-stage">idle</span></div>
          <div class="iv6-row"><span class="iv6-label">SKU</span><span id="iv6-sku">-</span></div>
          <div class="iv6-row"><span class="iv6-label">Queue</span><span id="iv6-queue-pos">0 / 0</span></div>
          <div class="iv6-buttons">
            <button id="iv6-btn-start">Start</button>
            <button id="iv6-btn-pause">Pause</button>
            <button id="iv6-btn-resume">Resume</button>
            <button id="iv6-btn-stop">Stop</button>
          </div>
          <button class="iv6-export" id="iv6-btn-export">Export Log</button>
          <div class="iv6-log" id="iv6-log"></div>
        </div>
      `;
      document.body.appendChild(root);
      this._root = root;
      this._els = {
        status: root.querySelector('#iv6-status'),
        stage: root.querySelector('#iv6-stage'),
        sku: root.querySelector('#iv6-sku'),
        queuePos: root.querySelector('#iv6-queue-pos'),
        btnStart: root.querySelector('#iv6-btn-start'),
        btnPause: root.querySelector('#iv6-btn-pause'),
        btnResume: root.querySelector('#iv6-btn-resume'),
        btnStop: root.querySelector('#iv6-btn-stop'),
        btnExport: root.querySelector('#iv6-btn-export'),
        log: root.querySelector('#iv6-log'),
      };
      Logger.setPanelListElement(this._els.log);
      this._bindEvents();
      this._makeDraggable(root, root.querySelector('#iv6-drag-handle'));
      this.refresh();
      return root;
    },
    _bindEvents() {
      this._els.btnStart.addEventListener('click', () => Main.start());
      this._els.btnPause.addEventListener('click', () => Main.pause());
      this._els.btnResume.addEventListener('click', () => Main.resume());
      this._els.btnStop.addEventListener('click', () => Main.stop());
      this._els.btnExport.addEventListener('click', () => this._exportLog());
    },
    _exportLog() {
      const text = Logger.exportAsText();
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      a.href = url;
      a.download = `inaproc-v6-log-${stamp}.txt`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      Logger.info('Log berhasil diexport.');
    },
    _makeDraggable(root, handle) {
      let isDragging = false;
      let offsetX = 0;
      let offsetY = 0;
      handle.addEventListener('mousedown', (e) => {
        isDragging = true;
        const rect = root.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;
      });
      document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        root.style.left = `${e.clientX - offsetX}px`;
        root.style.top = `${e.clientY - offsetY}px`;
        root.style.right = 'auto';
      });
      document.addEventListener('mouseup', () => {
        isDragging = false;
      });
    },
    setStatusText(text) {
      STATE.statusText = text || null;
      this.refresh();
    },
    refresh() {
      if (!this._els.status) return;
      const defaultStatus = STATE.isRunning
        ? (STATE.isPaused ? 'Paused' : 'Running')
        : 'Idle';
      this._els.status.textContent = STATE.statusText || defaultStatus;
      this._els.stage.textContent = STATE.currentStage;
      this._els.sku.textContent = STATE.currentSku || '-';
      this._els.queuePos.textContent = `${STATE.queue.length ? STATE.currentIndex + 1 : 0} / ${STATE.queue.length}`;
      this._els.btnStart.disabled = STATE.isRunning;
      this._els.btnPause.disabled = !STATE.isRunning || STATE.isPaused;
      this._els.btnResume.disabled = !STATE.isRunning || !STATE.isPaused;
      this._els.btnStop.disabled = !STATE.isRunning;
    },
  };
  // #endregion UI PANEL
  // =====================================================================
  // #region MAIN
  // =====================================================================
  const Main = {
    _initialized: false,
    init() {
      if (this._initialized) {
        Logger.warning('init() dipanggil lebih dari sekali, diabaikan.');
        return;
      }
      this._initialized = true;
      Logger.info(`INAPROC Upload Produk V6 v${CONFIG.version} - inisialisasi framework...`);
      const savedConfig = Storage.load(STORAGE_KEYS.CONFIG_KEY, null);
      if (savedConfig && typeof savedConfig === 'object') {
        Object.assign(CONFIG, savedConfig);
        Logger.debug('CONFIG override dimuat dari localStorage.', savedConfig);
      }
      QueueManager.loadQueue();
      StageManager.loadStage();
      STATE.flags = Storage.load(STORAGE_KEYS.FLAG_KEY, {});
      STATE.results = Storage.load(STORAGE_KEYS.RESULT_KEY, []);
      UIPanel.create();
      Logger.success(
        'Framework siap. Navigation + FormFiller (Isi Dasar & Bisnis) siap, menunggu Start (Task 3). ' +
        'Isi queue dulu lewat console: window.__INAPROC_V6__.QueueManager.setQueue([...]) sebelum Start ' +
        '(belum ada UI textarea di panel, itu nanti pas Task 4+ kalau format queue sudah final).'
      );
    },
    async start() {
      if (STATE.isRunning) {
        Logger.warning('start() dipanggil tapi proses sudah berjalan.');
        return;
      }
      STATE.isRunning = true;
      STATE.isPaused = false;
      UIPanel.refresh();
      Logger.info('start() dipanggil.');

      Logger.info(`Validasi Queue: ${QueueManager.size()} item pada queue.`);
      if (QueueManager.isEmpty()) {
        Logger.error('Queue kosong. Isi dulu lewat window.__INAPROC_V6__.QueueManager.setQueue([...]).');
        this.stop();
        return;
      }
      const item = QueueManager.getCurrent();
      STATE.currentSku = item.kodeProduk || null;
      UIPanel.refresh();

      try {
        const navOk = await Navigation.gotoAddProduct();
        if (!navOk) {
          Logger.error('Navigation gagal. Proses dihentikan.');
          this.stop();
          return;
        }
        if (!STATE.isRunning) return; // sempat di-stop() user

        StageManager.setStage('isi_dasar');
        const dasarResult = await FormFiller.isiDasar(item);
        if (dasarResult !== 'OK') {
          Logger.warning(`isiDasar berhenti dengan status "${dasarResult}". Proses dihentikan, cek log di atas.`);
          this.stop();
          return;
        }
        if (!STATE.isRunning) return;

        if (CONFIG.stopAfterStage === 'isi_dasar') {
          Logger.success('stopAfterStage = "isi_dasar" tercapai. Berhenti sesuai konfigurasi.');
          this.stop();
          return;
        }

        StageManager.setStage('bisnis');
        await FormFiller.isiBisnis(item);

        Logger.success(
          'Section 1 & 5 selesai diisi (field yang sudah pasti). Stage TKDN/SNI/Spesifikasi/Lampiran/Simpan ' +
          'belum diimplementasikan (Task 4 dst) -- proses berhenti di sini sesuai stopAfterStage.'
        );
      } catch (e) {
        Logger.error('Proses melempar error tak terduga.', { reason: e && e.message, stack: e && e.stack });
      }
      this.stop();
    },
    pause() {
      if (!STATE.isRunning) {
        Logger.warning('pause() dipanggil tapi proses tidak sedang berjalan.');
        return;
      }
      STATE.isPaused = true;
      Logger.info('Proses dipause.');
      UIPanel.refresh();
    },
    resume() {
      if (!STATE.isRunning || !STATE.isPaused) {
        Logger.warning('resume() dipanggil tapi proses tidak dalam keadaan paused.');
        return;
      }
      STATE.isPaused = false;
      Logger.info('Proses dilanjutkan.');
      UIPanel.refresh();
    },
    stop() {
      STATE.isRunning = false;
      STATE.isPaused = false;
      STATE.statusText = null;
      Logger.info('Proses dihentikan.');
      UIPanel.refresh();
    },
  };
  function validateUrlAndBoot() {
    if (window.location.href.indexOf(CONFIG.targetUrl) !== 0) {
      return;
    }
    Main.init();
  }
  if (document.body) {
    validateUrlAndBoot();
  } else {
    document.addEventListener('DOMContentLoaded', validateUrlAndBoot, { once: true });
  }
  window.__INAPROC_V6__ = {
    CONFIG,
    STATE,
    Logger,
    QueueManager,
    StageManager,
    DomHelper,
    ReactSelectHelper,
    Navigation,
    FormFiller,
    UIPanel,
    Main,
  };
  // #endregion MAIN
})();