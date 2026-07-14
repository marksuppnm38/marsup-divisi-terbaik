// ==UserScript==
// @name         INAPROC Upload Produk V6 (Task 2 - Navigation)
// @namespace    inaproc-upload-produk-v6
// @version      0.2.0
// @description  Task 1: framework/pondasi. Task 2: modul Navigation (masuk ke form Tambah Produk). Belum mengisi field apa pun.
// @author       you
// @match        https://penyedia.inaproc.id/products
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
    version: '0.2.0',
    debug: true,
    dryRun: true,       // Task 2: masih dryRun, hanya navigasi, belum isi form
    autoContinue: false,
    retryLimit: 3,
    waitTimeout: 10000,     // ms
    pollingInterval: 300,   // ms
    targetUrl: 'https://penyedia.inaproc.id/products',

    // Selector khusus Task 2 (Navigation).
    // Selector form Tambah Produk (isi_dasar dst.) BELUM diisi di sini,
    // akan ditentukan pada Task 3 setelah struktur form final diketahui.
    selectors: {
      addProductButton: '#products-add-product-btn',
      // fallback jika id berubah: cari link sidebar menuju /products/add
      addProductSidebarLink: 'a[href="/products/add"]',
    },

    // Bagian path URL yang menandakan kita sudah pindah ke halaman Tambah Produk.
    addProductUrlPart: '/products/add',
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
    // Teks status bebas untuk ditampilkan di panel, mis. "Navigating...",
    // "Waiting Product Form...". null berarti pakai status default
    // (Idle/Running/Paused) dari UIPanel.refresh().
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
      // render log yang sudah ada saat panel baru dibuat
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
  // Bentuk item queue (contoh, belum ada parser Excel di task ini):
  // { kodeProduk: "", harga: "", stok: "" }

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
  // Helper umum, reusable. Belum dipakai untuk mengisi form apapun di Task 1.

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

    // Set value pada native input/textarea/select sehingga terdeteksi oleh
    // framework frontend (React/Vue) yang membungkus value setter.
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
  };
  // #endregion DOM HELPER

  // =====================================================================
  // #region NAVIGATION
  // =====================================================================
  // Tanggung jawab module ini HANYA membawa script dari halaman daftar
  // produk (/products) ke halaman Tambah Produk (/products/add).
  // Tidak ada pengisian field, tidak ada klik Simpan, tidak ada loop SKU.
  const Navigation = {
    /**
     * Cek apakah halaman saat ini sudah merupakan halaman form Tambah Produk.
     * Verifikasi berbasis URL. Verifikasi elemen form akan diperketat pada
     * Task 3 begitu selector form final tersedia; untuk saat ini kita
     * memakai indikator umum (heading/form/input) sebagai bukti bahwa
     * halaman sudah selesai me-render, bukan hanya URL berubah.
     */
    isProductForm() {
      const urlOk = window.location.pathname.indexOf(CONFIG.addProductUrlPart) === 0;
      if (!urlOk) return false;

      // Indikator umum bahwa konten halaman (bukan hanya shell/loading)
      // sudah selesai dirender. Selector spesifik form akan menggantikan
      // ini pada Task 3.
      const hasGenericContent = !!(
        document.querySelector('h1, h2') ||
        document.querySelector('form') ||
        document.querySelector('input')
      );

      return hasGenericContent;
    },

    /**
     * Tunggu sampai halaman Tambah Produk benar-benar siap.
     * Tidak menganggap selesai hanya karena URL berubah.
     */
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

    /**
     * Cari tombol "Tambah Produk" di halaman daftar produk.
     * Menggunakan waitForElement (bukan timeout tetap) dan mencoba
     * selector utama, lalu fallback ke link sidebar bila tidak ditemukan.
     */
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

    /**
     * Navigasi dari halaman daftar produk ke halaman Tambah Produk.
     * Retry sesuai CONFIG.retryLimit, tidak infinite loop.
     */
    async gotoAddProduct() {
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
            // Tunggu sebentar sebelum retry, tetap dibatasi retryLimit.
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

    /**
     * Placeholder untuk kembali ke halaman daftar produk.
     * Belum diimplementasikan penuh pada Task 2 (belum dibutuhkan).
     */
    backToProductList() {
      Logger.debug('backToProductList() dipanggil (placeholder, belum diimplementasikan).');
      // Implementasi navigasi kembali akan ditambahkan saat dibutuhkan
      // oleh task selanjutnya (mis. setelah save/finish per SKU).
    },
  };
  // #endregion NAVIGATION

  // =====================================================================
  // #region UI PANEL
  // =====================================================================
  const UIPanel = {
    _root: null,
    _els: {},

    create() {
      // Cegah panel ganda jika create() terpanggil lebih dari sekali.
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

    // Set teks status bebas di panel, mis. "Navigating...", "Waiting Product
    // Form...". Panggil dengan null/undefined untuk kembali ke status
    // default (Idle/Running/Paused).
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

      // Load config override dari localStorage (jika ada), tapi tidak mengubah
      // struktur default di luar key yang sudah didefinisikan.
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

      Logger.success('Framework siap. Panel dalam keadaan Idle. Navigation Module siap, menunggu Start (Task 2).');
    },

    async start() {
      if (STATE.isRunning) {
        Logger.warning('start() dipanggil tapi proses sudah berjalan.');
        return;
      }
      STATE.isRunning = true;
      STATE.isPaused = false;
      UIPanel.refresh();

      Logger.info('start() dipanggil. Task 2: menjalankan Navigation Module.');

      // Validasi Queue. Task 2 hanya navigasi (belum ada parser Excel/loop
      // SKU), jadi queue kosong TIDAK menghentikan navigasi — hanya dicatat.
      Logger.info(`Validasi Queue: ${QueueManager.size()} item pada queue.`);
      if (QueueManager.isEmpty()) {
        Logger.warning('Queue kosong. Navigasi tetap dilanjutkan (Task 2 belum melakukan loop SKU).');
      }

      if (!STATE.isRunning) {
        // Sempat di-stop() oleh user sebelum navigasi mulai.
        return;
      }

      try {
        const ok = await Navigation.gotoAddProduct();
        if (ok) {
          Logger.success('Navigation selesai. Stage sekarang: isi_dasar.');
        } else {
          Logger.error('Navigation gagal. Proses dihentikan.');
        }
      } catch (e) {
        Logger.error('Navigation melempar error tak terduga.', { reason: e && e.message });
      }

      // Sesuai acceptance criteria Task 2: setelah navigasi (berhasil atau
      // gagal setelah retryLimit), script berhenti. Tidak ada aksi lain.
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
      // @match sudah membatasi ini, ini hanya pengaman tambahan.
      return;
    }
    Main.init();
  }

  // Jalankan setelah halaman benar-benar idle (document-idle via @run-at),
  // tambahan guard di sini untuk memastikan DOM body sudah tersedia.
  if (document.body) {
    validateUrlAndBoot();
  } else {
    document.addEventListener('DOMContentLoaded', validateUrlAndBoot, { once: true });
  }

  // Expose ke window untuk debugging manual lewat console (opsional, tidak
  // memicu automasi apapun secara otomatis).
  window.__INAPROC_V6__ = {
    CONFIG,
    STATE,
    Logger,
    QueueManager,
    StageManager,
    DomHelper,
    Navigation,
    UIPanel,
    Main,
  };
  // #endregion MAIN
})();