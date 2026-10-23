// ==UserScript==
// @name         INAPROC Upload Produk V6 (v0.8.6 - dokumen, lampiran, simpan, batch, skip SKU)
// @namespace    inaproc-upload-produk-v6
// @version      0.8.6
// @description  v0.8.6 (+KBKI: scroll bertahap sampai dasar menu, fuzzy "... general use" ala kategori, fallback 999/lainnya; +harga & deskripsi yang diupload dicatat di log & Export Hasil). v0.8.5 (+rerun pintar: pesan "Data produk sudah digunakan"/"Nama Produk tidak boleh sama" = link sudah terupload -> skip & geser antrian, dicatat confirmed; cek nama produk setelah diisi). v0.8.4 (+fallback KBKI, scroll menu KBKI, kategori toleran, mode ulang dari awal). v0.8.3 (+Lihat Dokumen=OK, slug katalog, minimize panel). v0.8.2 (+centang dialog konfirmasi Simpan, verifikasi harga). v0.8.1 (+skip SKU). v0.8.0: baca MASTER.xlsx, folder dokumen lokal, dropdown Spesifikasi, upload foto + 7 lampiran PDF, Simpan, loop batch dengan resume.
// @author       you
// @match        https://penyedia.inaproc.id/*
// @run-at       document-idle
// @require      https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js
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
    version: '0.8.6',
    debug: true,

    // DRY RUN (default TRUE = aman): semua field diisi & semua file diupload
    // ke form, tapi tombol "Simpan" TIDAK diklik dan proses berhenti setelah
    // 1 produk. Matikan lewat checkbox di panel kalau sudah yakin.
    dryRun: true,

    // Berhenti SETELAH stage ini selesai. Urutan:
    // 'isi_dasar' (Kategori) -> 'tkdn' -> 'spesifikasi' -> 'bisnis' -> 'upload' -> 'save'
    stopAfterStage: 'save',

    // Kalau 1 produk gagal: 'stop' (berhenti, cek manual) atau 'skip'
    // (reload halaman, coba ulang 1x, lalu lewati). Bisa diubah dari panel.
    onItemError: 'stop',

    // MODE ULANG DARI AWAL: abaikan hasil lama, proses SEMUA SKU lagi.
    // - SKU yang SUDAH ada di INAPROC akan ditolak form ("Data produk sudah digunakan pada produk lain"
    //   / "Nama Produk tidak boleh sama") -> dianggap AMAN (link sudah terupload): dicatat confirmed,
    //   form ditutup, antrian geser ke SKU berikutnya. Status SAVED lama dipertahankan.
    // - SKU yang TIDAK ditolak berarti belum terupload (apapun alasannya) -> diisi normal sampai Simpan.
    // Progress rerun disimpan terpisah (RERUN_KEY) supaya Stop/reload bisa dilanjutkan.
    rerunAll: false,

    // Produk yang berkas dokumennya tidak lengkap dilewati (tidak diisi setengah-setengah).
    skipIfMissingFiles: true,

    // Daftar Produk Sektoral: kalau data produk SUDAH DIPAKAI produk lain (opsi nonaktif,
    // pesan "sudah digunakan", atau ditolak saat Simpan) -> SKIP SKU dan dicatat di hasil.
    // true  = opsi yang sama sekali tidak muncul di pencarian juga di-skip (dicatat terpisah).
    // false = opsi tidak muncul dianggap error biasa (berhenti untuk dicek manual).
    skipSektoralNotFound: true,
    // Pola pesan di layar yang berarti "sudah ada / sudah dipakai / duplikat".
    usedMessageRegex: /sudah\s+(digunakan|terpakai|dipakai|terdaftar|ada|dihubungkan|tertaut)|telah\s+(digunakan|dipakai|terdaftar)|already\s+(used|exists|registered)|tidak\s+boleh\s+sama|nama\s+produk\s+(sudah|telah)\s+(ada|digunakan|dipakai)/i,

    // Pantau fetch/XHR supaya script tahu kapan upload file selesai.
    trackNetwork: true,

    retryLimit: 3,
    waitTimeout: 10000,       // ms
    uploadTimeout: 90000,     // ms, tunggu upload satu file selesai
    saveTimeout: 45000,       // ms, tunggu hasil klik Simpan
    pollingInterval: 300,     // ms
    delayBetweenItems: 1500,  // ms
    targetUrl: 'https://penyedia.inaproc.id/products',

    // Selector Task 2 (Navigation).
    selectors: {
      addProductButton: '#products-add-product-btn',
      addProductSidebarLink: 'a[href="/products/add"]',
    },
    addProductUrlPart: '/products/add',

    // Selector form Tambah Produk (diverifikasi dari outerHTML / inaproc-form-capture.json).
    formSelectors: {
      // --- Section 1: Isi Dasar ---
      merekSwitch: '#form-product-brand-isActive-switch',
      merekInput: '#form-product-brand-application-number-input',
      merekCheckBtn: '#form-product-check-brand-btn',
      kbkiButton: '#form-product-kbki-select',
      daftarProdukSektoralHeading: 'Daftar Produk Sektoral',
      kategoriTrigger: '#form-product-category-select',
      kategoriKolomList: 'ul.custom-scrollbar',
      namaProdukInput: '#form-product-name-input',
      deskripsiTextarea: 'textarea[name="description"]',
      klasifikasiProdukSelect: '#form-product-product-type-select',
      lokasiProduksiSelect: '#form-product-location-type-select',
      tenagaKerjaSelect: '#form-product-labor-type-select',
      bahanBakuSelect: '#form-product-material-type-select',
      fotoProdukInputPrefix: '#product-image-input-',

      // --- Section 5: Bisnis ---
      hargaInput: '#form-product-price-input',
      stokInput: '#stockUnit-value-input',
      satuanProdukHeading: 'Satuan Produk',   // id aslinya rusak di source -> anchor by heading
      beratInput: '#form-product-variants-shipping-weight-input',
      minPembelianInput: '#form-product-min-purchase-input',
      jenisPajakSelect: '#ppnPercentage-select',
      preOrderSwitch: '#form-product-preorder-isActive-switch',

      // --- Section 2: TKDN ---
      tkdnSwitch: '#form-product-tkdn-switch',
      tkdnKeywordInput: '#form-product-tkdn-keyword-input',
      tkdnSearchBtn: '#form-product-tkdn-search-btn-new',
      tkdnResultRow: 'tr[data-test="table-row-data"]',
      tkdnResultRadio: 'input[type="radio"]',
      tkdnSubmitBtn: '#tkdn-submit-btn',
      tkdnCancelBtn: '#tkdn-cancel-btn',
    },

    // Dropdown di section "Spesifikasi Produk > Informasi Utama" (react-select).
    // id = dari inaproc-form-capture.json. itemKey = field di item queue (kolom MASTER).
    specDropdowns: [
      { itemKey: 'distributor',    id: 'form-product-productInformations-mainInformations-4-select',  label: 'Daftar Distributor yang Ditunjuk' },
      { itemKey: 'izinDistribusi', id: 'form-product-productInformations-mainInformations-5-select',  label: 'Izin Distribusi Alat Kesehatan' },
      { itemKey: 'cpakb',          id: 'form-product-productInformations-mainInformations-6-select',  label: 'Sertifikat Cara Pembuatan Alat Kesehatan yang Baik' },
      { itemKey: 'pib',            id: 'form-product-productInformations-mainInformations-11-select', label: 'Pemberitahuan Import Barang (PIB)' },
      { itemKey: 'garansi',        id: 'form-product-productInformations-mainInformations-13-select', label: 'Garansi' },
      { itemKey: 'sparepart',      id: 'form-product-productInformations-mainInformations-14-select', label: 'Surat Ketersediaan Layanan Purna Jual dan Spare Part' },
      { itemKey: 'strukturHarga',  id: 'form-product-productInformations-mainInformations-15-select', label: 'Struktur Harga' },
    ],

    // Nama subfolder di dalam folder dokumen (nama folder di Drive-mu).
    docFolders: {
      thumbnails: 'THUMBNAILS',
      strukturHarga: 'STRUKTUR_HARGA',
      spek: 'SPEK',
      akd: 'AKD',
      staticDoc: 'STATIC_DOC',
    },

    // Slug katalog publik: https://katalog.inaproc.id/<sellerSlug>/<slug nama produk>
    catalog: { base: 'https://katalog.inaproc.id', sellerSlug: 'pionir-nusantara-manufacturing', brandWord: 'ROBUST' },

    // Slot upload di section "Lampiran". heading = teks judul slot di form.
    // folder = key di docFolders. field = key di item.files.
    docSlots: [
      { key: 'spek',        heading: 'Spesifikasi Produk',                                                  folder: 'spek',          field: 'spek' },
      { key: 'nie',         heading: 'Nomor Izin Edar (NIE)',                                               folder: 'akd',           field: 'nie' },
      { key: 'distributor', heading: 'Daftar Distributor yang Ditunjuk',                                    folder: 'staticDoc',     field: 'distributor' },
      { key: 'cpakb',       heading: 'Sertifikat Cara Pembuatan Alat Kesehatan yang Baik Yang Masih Berlaku', folder: 'staticDoc',   field: 'cpakb' },
      { key: 'garansi',     heading: 'Garansi',                                                             folder: 'staticDoc',     field: 'garansi' },
      { key: 'sparepart',   heading: 'Surat Ketersediaan Layanan Purna Jual dan Spare Part',                folder: 'staticDoc',     field: 'sparepart' },
      { key: 'struktur',    heading: 'Struktur Harga',                                                      folder: 'strukturHarga', field: 'struktur' },
    ],

    // SEMUA judul slot di section Lampiran (termasuk yang tidak kita upload).
    // Dipakai untuk memetakan tiap <input type=file> ke judul terdekat di atasnya,
    // karena semua input-nya berbagi id yang sama ("document-field-input").
    lampiranTitles: [
      'Spesifikasi Produk',
      'Nomor Izin Edar (NIE)',
      'Daftar Distributor yang Ditunjuk',
      'Izin Distribusi Alat Kesehatan',
      'Sertifikat Cara Pembuatan Alat Kesehatan yang Baik Yang Masih Berlaku',
      'Sertifikat Cara Distribusi Alat Kesehatan Yang Baik Yang Masih Berlaku',
      'Sertifikat Alat Telekomunikasi dan / atau Perangkat Telekomunikasi',
      'Sertifikat Izin Pemanfaatan Sumber Radiasi Pengion (SRP)',
      'Hasil Pengujian Post Market',
      'Pemberitahuan Import Barang (PIB)',
      'Garansi',
      'Surat Ketersediaan Layanan Purna Jual dan Spare Part',
      'Struktur Harga',
    ],

    // Nilai konstan fallback (dipakai kalau kolom MASTER kosong).
    constants: {
      merkNomor: 'DID2023107469',
      tkdnNomor: '6722/TKDN/IK/VII/2024',
    },

    // Default react-select PDN yang SUDAH BENAR (dibaca saja, tidak diubah).
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
    RUN_KEY: 'inaproc_v6_run',
    RERUN_KEY: 'inaproc_v6_rerun',
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
    skipRequested: false,
    currentIndex: 0,
    queue: [],
    results: [],
    flags: {},
    statusText: null,
    runDone: new Set(),   // SKU yang sudah diproses di mode "ulang dari awal"
    formSnap: {},         // snapshot nilai form (harga/deskripsi) per SKU saat verifikasi sebelum Simpan
  };
  // #endregion STATE

  // =====================================================================
  // #region TEXT UTILS
  // =====================================================================
  const Txt = {
    oneLine(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); },
    lower(s) { return this.oneLine(s).normalize('NFC').toLowerCase(); },
    // "ROBUST URETHRAL BOUGIE GUYON 29 CH 26.5 CM" -> "robust-urethral-bougie-guyon-29-ch-26-5-cm"
    slugify(s) {
      return String(s == null ? '' : s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    },
    stripEndPunct(s) { return this.oneLine(s).replace(/[\s.,;:]+$/, ''); },
    escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); },
    // Cocokkan kode utuh (batas = bukan huruf/angka/strip) supaya "RB10-KE1" tidak cocok di "RB10-KE12".
    codeRegex(code) {
      return new RegExp('(^|[^A-Za-z0-9-])' + this.escapeRe(code) + '(?![A-Za-z0-9-])', 'i');
    },
    headerKey(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ''); },
    toNumber(v) {
      if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
      let s = String(v == null ? '' : v).trim().replace(/[^\d.,-]/g, '');
      if (!s) return NaN;
      const hasDot = s.includes('.');
      const hasComma = s.includes(',');
      if (hasDot && hasComma) {
        if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
        else s = s.replace(/,/g, '');
      } else if (hasComma) {
        s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
      } else if (hasDot && /^-?\d{1,3}(\.\d{3}){2,}$/.test(s)) {
        s = s.replace(/\./g, '');
      }
      const n = Number(s);
      return Number.isFinite(n) ? n : NaN;
    },
  };
  // #endregion TEXT UTILS

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
    _maxEntries: 4000,
    _maxPanelRows: 400,
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
      if (this._entries.length > this._maxEntries) this._entries.splice(0, this._entries.length - this._maxEntries);
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
      this._entries.slice(-this._maxPanelRows).forEach((entry) => this._renderToPanel(entry));
    },
    _renderToPanel(entry) {
      if (!this._panelListEl) return;
      if (entry.level === LOG_LEVELS.DEBUG && !CONFIG.debug) return;
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
      while (this._panelListEl.childNodes.length > this._maxPanelRows) {
        this._panelListEl.removeChild(this._panelListEl.firstChild);
      }
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
  // Bentuk item queue (v0.8.0):
  // {
  //   kodeProduk, kodeAsli,
  //   kategori: [lvl1, lvl2, lvl3],
  //   merek, sektoral, namaProduk, deskripsi, foto,
  //   kbki,            // deskripsi KBKI (atau "kode - deskripsi")
  //   kbkiFallback,    // teks aturan fallback; kalau mengandung "999" -> pilih kode berakhiran 999
  //   tkdn,            // nomor sertifikat TKDN
  //   spec: { distributor, izinDistribusi, cpakb, pib, garansi, sparepart, strukturHarga },
  //   harga (integer), stok, satuan, berat (gram), minPembelian, jenisPajak,
  //   files: { spek, nie, distributor, cpakb, garansi, sparepart, struktur }   // nama file
  // }
  //
  // Pemetaan kolom MASTER -> field, berdasarkan NAMA HEADER (urutan kolom bebas).
  // nth = urutan kemunculan kalau header-nya kembar (MASTER punya 2 kolom
  // bernama "Sertifikat_Cara_Pembuatan_...": ke-1 = nilai dropdown, ke-2 = nama file).
  const CPAKB_HDR = 'sertifikatcarapembuatanalatkesehatanyangbaikyangmasihberlaku';
  const COLUMN_MAP = {
    kodeProduk:     { h: 'kode' },
    kodeAsli:       { h: 'kodeasli' },
    kategoriLvl1:   { h: 'kategori1' },
    kategoriLvl2:   { h: 'kategori2' },
    kategoriLvl3:   { h: 'kategori3' },
    merek:          { h: 'merek' },
    sektoral:       { h: 'daftarproduksektoral' },
    namaProduk:     { h: 'namaproduk' },
    foto:           { h: 'uploadfotoproduk' },
    deskripsi:      { h: 'deskripsi' },
    kbki:           { h: 'kodekbki' },
    kbkiFallback:   { h: 'ifkodekbkinotfound' },
    tkdn:           { h: 'sertifikattkdn' },
    distributor:    { h: 'daftardistributoryangditunjuk' },
    izinDistribusi: { h: 'izindistribusialatkesehatan' },
    cpakb:          { h: CPAKB_HDR, nth: 0 },
    pib:            { h: 'pemberitahuanimportbarangpib' },
    garansi:        { h: 'garansi' },
    sparepart:      { h: 'suratketersediaanlayananpurnajualdansparepart' },
    strukturHarga:  { h: 'strukturharga' },
    harga:          { h: 'hargaproduk' },
    stok:           { h: 'jumlahstok' },
    satuan:         { h: 'satuanproduk' },
    berat:          { h: 'beratproduk' },
    fSpek:          { h: 'spesifikasiprodukfilename' },
    fNie:           { h: 'nomorizinedarniefilename' },
    fDistributor:   { h: 'daftardistributoryangditunjukfilename' },
    fCpakb:         { h: CPAKB_HDR, nth: 1, alt: [{ h: CPAKB_HDR + 'filename' }] },
    fGaransi:       { h: 'garansifilename' },
    fSparepart:     { h: 'suratketersediaanlayananpurnajualdansparepartfilename' },
    fStruktur:      { h: 'strukturhargafilename' },
  };
  const REQUIRED_KEYS = ['kodeProduk', 'kategoriLvl1', 'kategoriLvl2', 'kategoriLvl3', 'namaProduk', 'harga', 'stok', 'satuan', 'berat'];

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
      else Logger.warning('Queue gagal disimpan ke localStorage (kepenuhan?). Queue tetap ada di memori, tapi tidak bisa auto-resume setelah reload.');
      return ok;
    },
    setQueue(items) {
      STATE.queue = Array.isArray(items) ? items : [];
      STATE.currentIndex = 0;
      this.saveQueue();
      return STATE.queue;
    },
    getCurrent() {
      if (STATE.currentIndex < 0 || STATE.currentIndex >= STATE.queue.length) return null;
      return STATE.queue[STATE.currentIndex];
    },
    reset() {
      STATE.currentIndex = 0;
      Logger.info('Queue direset ke posisi awal.');
      return this.getCurrent();
    },
    isEmpty() { return STATE.queue.length === 0; },
    size() { return STATE.queue.length; },

    // Target KBKI dari item: bisa "kode - deskripsi", kode saja, atau deskripsi saja (format MASTER).
    kbkiTarget(item) {
      const raw = Txt.oneLine(item.kbki || '');
      const m = raw.match(/^(\d{6,})\s*(?:-\s*(.*))?$/);
      if (m) return { code: m[1], desc: m[2] || '', fallback: item.kbkiFallback || '' };
      return { code: '', desc: raw, fallback: item.kbkiFallback || '' };
    },

    // Daftar berkas yang dibutuhkan item (untuk pre-check & validasi folder).
    requiredFiles(item) {
      const out = [];
      const foto = item.foto || (item.kodeAsli ? `${item.kodeAsli}.png` : '');
      if (foto) out.push({ key: 'foto', folder: 'thumbnails', name: foto });
      CONFIG.docSlots.forEach((s) => {
        const n = item.files && item.files[s.field];
        if (n) out.push({ key: s.key, folder: s.folder, name: n });
      });
      return out;
    },

    // ---------- Parsing tabel (header di baris pertama) ----------
    parseTable(aoa) {
      const errors = [];
      if (!Array.isArray(aoa) || aoa.length < 2) {
        return { items: [], errors: ['Tabel kosong atau hanya berisi header.'], totalLines: 0 };
      }
      const hmap = new Map();
      aoa[0].forEach((h, i) => {
        const k = Txt.headerKey(h);
        if (!k) return;
        if (!hmap.has(k)) hmap.set(k, []);
        hmap.get(k).push(i);
      });
      const idxOf = (spec) => {
        const cands = [spec].concat(spec.alt || []);
        for (const c of cands) {
          const list = hmap.get(c.h);
          if (!list) continue;
          const i = list[c.nth || 0];
          if (i !== undefined) return i;
        }
        return -1;
      };
      const cols = {};
      Object.keys(COLUMN_MAP).forEach((k) => { cols[k] = idxOf(COLUMN_MAP[k]); });
      const missingHdr = REQUIRED_KEYS.filter((k) => cols[k] < 0);
      if (missingHdr.length) {
        return { items: [], errors: [`Header wajib tidak ditemukan: ${missingHdr.join(', ')}`], totalLines: 0 };
      }

      const items = [];
      let totalLines = 0;
      for (let r = 1; r < aoa.length; r += 1) {
        const row = aoa[r] || [];
        if (!row.some((c) => c !== null && c !== undefined && String(c).trim() !== '')) continue;
        totalLines += 1;
        const raw = (k) => (cols[k] >= 0 ? row[cols[k]] : '');
        const str = (k) => Txt.oneLine(raw(k));

        const kodeProduk = str('kodeProduk');
        const harga = Math.round(Txt.toNumber(raw('harga')));
        const stok = Math.round(Txt.toNumber(raw('stok')));
        const berat = Math.round(Txt.toNumber(raw('berat')));
        const problems = [];
        REQUIRED_KEYS.forEach((k) => {
          if (['harga', 'stok', 'berat'].includes(k)) return;
          if (!str(k)) problems.push(k);
        });
        if (!(harga > 0)) problems.push('harga');
        if (!(stok >= 0) || Number.isNaN(stok)) problems.push('stok');
        if (!(berat > 0)) problems.push('berat');
        if (problems.length) {
          errors.push(`Baris ${r + 1}${kodeProduk ? ` (${kodeProduk})` : ''}: field wajib kosong/tidak valid -> ${problems.join(', ')}`);
          continue;
        }

        items.push({
          kodeProduk,
          kodeAsli: str('kodeAsli'),
          kategori: [str('kategoriLvl1'), str('kategoriLvl2'), str('kategoriLvl3')],
          merek: str('merek') || null,
          sektoral: str('sektoral') || kodeProduk,
          namaProduk: str('namaProduk'),                      // newline & spasi ganda -> 1 spasi
          deskripsi: str('deskripsi').slice(0, 2000),         // maxlength form = 2000
          foto: str('foto'),
          kbki: str('kbki') || null,
          kbkiFallback: str('kbkiFallback'),
          tkdn: str('tkdn') || null,
          spec: {
            distributor: str('distributor'),
            izinDistribusi: str('izinDistribusi'),
            cpakb: str('cpakb'),
            pib: str('pib'),
            garansi: str('garansi'),
            sparepart: str('sparepart'),
            strukturHarga: str('strukturHarga'),
          },
          harga,
          stok,
          satuan: str('satuan'),
          berat,
          minPembelian: 1,
          jenisPajak: null,                                   // tidak ada di MASTER -> pakai default form (12%)
          files: {
            spek: str('fSpek'),
            nie: str('fNie'),
            distributor: str('fDistributor'),
            cpakb: str('fCpakb'),
            garansi: str('fGaransi'),
            sparepart: str('fSparepart'),
            struktur: str('fStruktur'),
          },
        });
      }

      // Kode produk harus unik (dipakai untuk resume & hasil).
      const seen = new Set();
      const dedup = [];
      items.forEach((it) => {
        if (seen.has(it.kodeProduk)) {
          errors.push(`Kode duplikat dilewati: ${it.kodeProduk}`);
          return;
        }
        seen.add(it.kodeProduk);
        dedup.push(it);
      });
      return { items: dedup, errors, totalLines };
    },

    // ---------- Parsing teks (CSV / TSV, quote-aware, newline dalam sel OK) ----------
    parseDelimited(text) {
      const t = String(text || '').replace(/^\uFEFF/, '');
      const first = t.split(/\r?\n/, 1)[0] || '';
      const counts = {
        '\t': (first.match(/\t/g) || []).length,
        ';': (first.match(/;/g) || []).length,
        ',': (first.match(/,/g) || []).length,
      };
      let delim = '\t';
      let best = counts['\t'];
      [';', ','].forEach((d) => { if (counts[d] > best) { best = counts[d]; delim = d; } });
      const rows = [];
      let row = [];
      let cur = '';
      let inQ = false;
      for (let i = 0; i < t.length; i += 1) {
        const c = t[i];
        if (inQ) {
          if (c === '"') {
            if (t[i + 1] === '"') { cur += '"'; i += 1; } else { inQ = false; }
          } else { cur += c; }
        } else if (c === '"' && cur === '') {
          inQ = true;
        } else if (c === delim) {
          row.push(cur); cur = '';
        } else if (c === '\n' || c === '\r') {
          if (c === '\r' && t[i + 1] === '\n') i += 1;
          row.push(cur); cur = '';
          rows.push(row); row = [];
        } else {
          cur += c;
        }
      }
      if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
      return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
    },

    // Format lama (v0.7.x): 13 kolom TAB tanpa header.
    LEGACY_COLUMNS: [
      'kodeProduk', 'kbki', 'kategoriLvl1', 'kategoriLvl2', 'kategoriLvl3',
      'namaProduk', 'deskripsi', 'harga', 'stok', 'satuan', 'berat',
      'minPembelian', 'jenisPajak',
    ],
    parseLegacy(rows) {
      const items = [];
      const errors = [];
      rows.forEach((cols, idx) => {
        const raw = {};
        this.LEGACY_COLUMNS.forEach((key, i) => { raw[key] = cols[i] !== undefined ? Txt.oneLine(cols[i]) : ''; });
        const missing = ['kodeProduk', 'kategoriLvl1', 'kategoriLvl2', 'kategoriLvl3', 'namaProduk', 'harga', 'stok', 'satuan', 'berat'].filter((k) => !raw[k]);
        if (missing.length) { errors.push(`Baris ${idx + 1}: field wajib kosong -> ${missing.join(', ')}`); return; }
        items.push({
          kodeProduk: raw.kodeProduk,
          kodeAsli: '',
          kategori: [raw.kategoriLvl1, raw.kategoriLvl2, raw.kategoriLvl3],
          merek: null,
          sektoral: raw.kodeProduk,
          namaProduk: raw.namaProduk,
          deskripsi: raw.deskripsi,
          foto: '',
          kbki: raw.kbki || null,
          kbkiFallback: '',
          tkdn: null,
          spec: {},
          harga: Math.round(Txt.toNumber(raw.harga)) || 0,
          stok: Math.round(Txt.toNumber(raw.stok)) || 0,
          satuan: raw.satuan,
          berat: Math.round(Txt.toNumber(raw.berat)) || 0,
          minPembelian: raw.minPembelian ? (Math.round(Txt.toNumber(raw.minPembelian)) || 1) : 1,
          jenisPajak: raw.jenisPajak || null,
          files: {},
        });
      });
      return { items, errors, totalLines: rows.length };
    },

    // Terima teks apa saja: JSON (queue.json / array baris), CSV, TSV, atau format lama.
    parseAnyText(text) {
      const s = String(text || '').replace(/^\uFEFF/, '').trim();
      if (!s) return { items: [], errors: ['Teks kosong.'], totalLines: 0 };
      if (s[0] === '[' || s[0] === '{') {
        let data;
        try { data = JSON.parse(s); } catch (e) { return { items: [], errors: [`JSON tidak valid: ${e.message}`], totalLines: 0 }; }
        if (!Array.isArray(data)) data = data.items || data.queue || [];
        return this.parseJsonArray(data);
      }
      const rows = this.parseDelimited(s);
      const hdr = (rows[0] || []).map((h) => Txt.headerKey(h));
      if (hdr.includes('namaproduk') && hdr.includes('kode')) return this.parseTable(rows);
      return this.parseLegacy(rows);
    },

    parseJsonArray(data) {
      if (!Array.isArray(data) || data.length === 0) return { items: [], errors: ['Array JSON kosong.'], totalLines: 0 };
      if (data[0] && typeof data[0] === 'object' && data[0].kodeProduk && Array.isArray(data[0].kategori)) {
        // Sudah bentuk item queue (hasil queue.json).
        const items = [];
        const errors = [];
        data.forEach((it, i) => {
          if (!it || !it.kodeProduk || !it.namaProduk || !Array.isArray(it.kategori) || it.kategori.length < 3 || !(it.harga > 0)) {
            errors.push(`Item #${i + 1}: field wajib tidak lengkap.`);
            return;
          }
          items.push(Object.assign({ spec: {}, files: {}, minPembelian: 1, jenisPajak: null }, it));
        });
        return { items, errors, totalLines: data.length };
      }
      // Array objek berkunci nama header MASTER.
      const keys = Object.keys(data[0] || {});
      const aoa = [keys].concat(data.map((o) => keys.map((k) => o[k])));
      return this.parseTable(aoa);
    },

    async loadFromFile(file) {
      const name = String(file.name || '').toLowerCase();
      if (/\.(xlsx|xlsm|xls)$/.test(name)) {
        if (typeof XLSX === 'undefined') {
          return { items: [], errors: ['Library SheetJS (XLSX) tidak termuat. Export MASTER ke .csv lalu load file .csv, atau pakai queue.json.'], totalLines: 0 };
        }
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const sheetName = wb.SheetNames.includes('MASTER') ? 'MASTER' : wb.SheetNames[0];
        Logger.info(`Membaca sheet "${sheetName}" dari ${file.name}...`);
        const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true, defval: '', blankrows: false });
        return this.parseTable(aoa);
      }
      return this.parseAnyText(await file.text());
    },
  };
  // #endregion QUEUE MANAGER

  // =====================================================================
  // #region RESULTS (progress per SKU, untuk resume)
  // =====================================================================
  const Results = {
    load() {
      const saved = Storage.load(STORAGE_KEYS.RESULT_KEY, []);
      STATE.results = Array.isArray(saved) ? saved : [];
      return STATE.results;
    },
    save() { Storage.save(STORAGE_KEYS.RESULT_KEY, STATE.results); },
    get(kode) { return STATE.results.find((r) => r.kode === kode) || null; },
    slugFor(kode) {
      const item = (STATE.queue || []).find((i) => i.kodeProduk === kode);
      if (!item) return { slug: '', url: '' };
      let base = Txt.oneLine(item.namaProduk || item.deskripsi || '');
      const brand = CONFIG.catalog.brandWord;
      if (brand && !new RegExp(`(^|[^a-z0-9])${brand}([^a-z0-9]|$)`, 'i').test(base)) base = `${brand} ${base}`;
      const slug = Txt.slugify(base);
      return { slug, url: slug ? `${CONFIG.catalog.base}/${CONFIG.catalog.sellerSlug}/${slug}` : '' };
    },
    // Dianggap "link sudah ada di INAPROC": SAVED, atau di-skip karena form menolak sebagai duplikat.
    isConfirmed(r) {
      return !!r && (r.status === 'SAVED' || r.confirmed === true);
    },
    // confirmed = true kalau ada bukti di layar bahwa produk sudah ada (pesan duplikat dari form).
    record(kode, status, note, opts) {
      const confirmedNow = !!(opts && opts.confirmed);
      let r = this.get(kode);
      // Rerun: SKU yang sebelumnya SAVED lalu ditolak "sudah dipakai" = memang sudah ada. Pertahankan SAVED.
      if (r && r.status === 'SAVED' && /^SKIPPED_SEKTORAL/.test(status)) {
        r.note = 'rerun: sudah ada di INAPROC (ditolak form sebagai duplikat) -- hasil upload sebelumnya';
        r.confirmed = true;
        r.ts = new Date().toISOString();
        this.save();
        UIPanel.refresh();
        return;
      }
      if (!r) { r = { kode, status, note: '', attempts: 0, ts: null, confirmed: false }; STATE.results.push(r); }
      const sl = this.slugFor(kode); r.slug = sl.slug; r.url = sl.url;   // slug dicatat utk SEMUA status
      // v0.8.6: catat nama, harga MASTER, deskripsi, dan nilai yang benar-benar terbaca di form.
      const qi = (STATE.queue || []).find((i) => i.kodeProduk === kode);
      if (qi) { r.nama = qi.namaProduk; r.hargaMaster = qi.harga; r.deskripsi = qi.deskripsi; }
      const snap = STATE.formSnap && STATE.formSnap[kode];
      if (snap) { r.hargaForm = snap.harga; r.hargaFormText = snap.hargaText; r.deskripsiForm = snap.deskripsi; }
      r.status = status;
      r.note = Txt.oneLine(note || '').slice(0, 500);
      r.ts = new Date().toISOString();
      if (status === 'SAVED') r.confirmed = true;
      else if (confirmedNow) r.confirmed = true;
      else if (/^(FAILED|DRYRUN)/.test(status)) r.confirmed = false;
      if (status !== 'SAVED' && status !== 'DRYRUN_DONE' && status.indexOf('SKIPPED') !== 0) r.attempts += 1;
      this.save();
      UIPanel.refresh();
    },
    // Lewati kalau sudah SAVED, sengaja di-skip (sektoral sudah dipakai / skip manual),
    // atau (mode 'skip') sudah gagal 2x. SKIPPED_MISSING_FILES TIDAK dilewati: dicoba lagi
    // di run berikutnya, siapa tahu berkasnya sudah dilengkapi.
    // Mode rerun: abaikan hasil lama, lewati hanya SKU yang sudah diproses di rerun ini.
    shouldSkip(kode) {
      if (CONFIG.rerunAll) return STATE.runDone.has(kode);
      const r = this.get(kode);
      if (!r) return false;
      if (r.status === 'SAVED') return true;
      if (/^SKIPPED_(SEKTORAL|MANUAL)/.test(r.status)) return true;
      if (CONFIG.onItemError === 'skip' && r.status.indexOf('FAILED') === 0 && r.attempts >= 2) return true;
      return false;
    },
    counts() {
      const c = { saved: 0, failed: 0, skipped: 0, confirmed: 0 };
      STATE.results.forEach((r) => {
        if (r.status === 'SAVED') c.saved += 1;
        else if (r.status.indexOf('SKIPPED') === 0) c.skipped += 1;
        else if (r.status !== 'DRYRUN_DONE') c.failed += 1;
        if (this.isConfirmed(r)) c.confirmed += 1;
      });
      return c;
    },
    clear() { STATE.results = []; this.save(); UIPanel.refresh(); },
    exportCsv() {
      const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
      const lines = ['kode,status,terkonfirmasi,attempts,waktu,catatan,slug,url_katalog,nama_produk,harga_master,harga_form,deskripsi'];
      STATE.results.forEach((r) => lines.push([
        r.kode, r.status, this.isConfirmed(r) ? 'YA' : '', r.attempts, r.ts, r.note, r.slug, r.url,
        r.nama || '', r.hargaMaster != null ? r.hargaMaster : '', r.hargaForm != null ? r.hargaForm : '',
        r.deskripsiForm || r.deskripsi || '',
      ].map(esc).join(',')));
      return '\uFEFF' + lines.join('\n');   // BOM supaya Excel baca UTF-8 dengan benar
    },
  };
  // #endregion RESULTS

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
    getStage() { return STATE.currentStage; },
    saveStage() { return Storage.save(STORAGE_KEYS.STAGE_KEY, STATE.currentStage); },
    loadStage() {
      const saved = Storage.load(STORAGE_KEYS.STAGE_KEY, 'idle');
      STATE.currentStage = STAGES.includes(saved) ? saved : 'idle';
      return STATE.currentStage;
    },
    resetStage() { this.setStage('idle'); },
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
      if (!el || typeof el.scrollIntoView !== 'function') return;
      el.scrollIntoView(options);
    },
    isVisible(el) {
      if (!el) return false;
      if (el.offsetParent !== null) return true;
      const r = el.getClientRects ? el.getClientRects() : [];
      return r.length > 0;
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
    dispatchBlur(el) {
      if (!el) return;
      el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      el.dispatchEvent(new FocusEvent('blur', { bubbles: false }));
    },
    dispatchClick(el) {
      if (!el) return;
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    },
    // react-select membuka menu lewat mousedown (bukan click).
    dispatchMouseDown(el) {
      if (!el) return;
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, view: window }));
    },
    dispatchEscape(el) {
      if (!el) return;
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    },
    // Cari <button> berdasarkan teks persis (regex), yang kelihatan.
    findButton(regex, { includeDisabled = true } = {}) {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.find((b) => regex.test(Txt.oneLine(b.textContent)) && this.isVisible(b) && (includeDisabled || !b.disabled)) || null;
    },
    // Inject File ke <input type="file"> pakai DataTransfer (lolos deteksi React).
    // files: File atau array File.
    injectFileToInput(inputEl, files) {
      const list = Array.isArray(files) ? files : [files];
      if (!inputEl || list.length === 0 || !list[0]) {
        Logger.error('injectFileToInput: inputEl atau file kosong.');
        return false;
      }
      try {
        const dt = new DataTransfer();
        list.forEach((f) => dt.items.add(f));
        inputEl.files = dt.files;
        this.dispatchInput(inputEl);
        this.dispatchChange(inputEl);
        return true;
      } catch (e) {
        Logger.error('injectFileToInput gagal.', { reason: e.message });
        return false;
      }
    },
    // Anchor-by-teks: cari <h3> yang textnya persis sama, lalu naik ke ancestor "row" (class "flex-row").
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
  // #region NETWORK IDLE (tahu kapan upload selesai)
  // =====================================================================
  const NetIdle = {
    pending: 0,
    last: Date.now(),
    installed: false,
    ignore: /cdn-cgi\/rum|notification\.inaproc\.id|google-analytics|googletagmanager|sentry|hotjar/i,
    _inc() { this.pending += 1; this.last = Date.now(); },
    _dec() { this.pending = Math.max(0, this.pending - 1); this.last = Date.now(); },
    install() {
      if (this.installed || !CONFIG.trackNetwork) return;
      this.installed = true;
      const self = this;
      const origFetch = window.fetch;
      if (typeof origFetch === 'function') {
        window.fetch = function patchedFetch(...args) {
          let url = '';
          try { url = String((args[0] && args[0].url) || args[0] || ''); } catch (e) { url = ''; }
          const track = !self.ignore.test(url);
          if (track) self._inc();
          let p;
          try {
            p = origFetch.apply(this, args);
          } catch (e) {
            if (track) self._dec();
            throw e;
          }
          if (track) p.then(() => self._dec(), () => self._dec());
          return p;
        };
      }
      const XHR = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
      if (XHR) {
        const origOpen = XHR.open;
        const origSend = XHR.send;
        XHR.open = function patchedOpen(method, url) {
          this.__iv6url = String(url || '');
          return origOpen.apply(this, arguments);
        };
        XHR.send = function patchedSend() {
          const track = !self.ignore.test(this.__iv6url || '');
          let done = false;
          const fin = () => { if (!done) { done = true; self._dec(); } };
          if (track) {
            self._inc();
            this.addEventListener('loadend', fin);
          }
          try {
            return origSend.apply(this, arguments);
          } catch (e) {
            if (track) fin();
            throw e;
          }
        };
      }
      Logger.debug('NetIdle terpasang (fetch + XHR dipantau).');
    },
    // true = idle tercapai, false = timeout.
    async waitIdle({ quiet = 800, timeout = 30000 } = {}) {
      if (!this.installed) {
        await DomHelper.sleep(Math.min(timeout, 2500));
        return true;
      }
      const start = Date.now();
      while (Date.now() - start < timeout) {
        if (STATE.skipRequested) return true;   // user menekan "Skip SKU": jangan menunggu upload lagi
        if (this.pending === 0 && Date.now() - this.last >= quiet) return true;
        await DomHelper.sleep(100);
      }
      return false;
    },
  };
  // #endregion NETWORK IDLE

  // =====================================================================
  // #region REACT SELECT HELPER
  // =====================================================================
  const ReactSelectHelper = {
    // Baca text opsi yang sedang terpilih TANPA mengubah apa pun.
    readValue(container) {
      if (!container) return null;
      const el = container.querySelector('.select__single-value');
      return el ? el.textContent.trim() : null;
    },
    _optionTexts(limit = 15) {
      return Array.from(document.querySelectorAll('.select__option')).slice(0, limit).map((o) => Txt.oneLine(o.textContent));
    },
    // matcher (opsional): fungsi (teksOpsi) => boolean. Kalau ada, HANYA matcher yang dipakai.
    async select(container, optionText, { timeout = CONFIG.waitTimeout, matcher = null } = {}) {
      if (!container) {
        throw new Error('ReactSelectHelper.select: container null.');
      }
      const want = Txt.lower(optionText);
      const control = container.querySelector('.select__control') || container;
      DomHelper.dispatchClick(control);
      await DomHelper.sleep(150);
      // Fallback untuk select yang tidak searchable: menu hanya terbuka lewat mousedown.
      if (!document.querySelector('.select__menu')) {
        DomHelper.dispatchMouseDown(control);
        await DomHelper.sleep(150);
      }
      const input = container.querySelector('.select__input');
      if (input) {
        DomHelper.setNativeValue(input, optionText);
        DomHelper.dispatchInput(input);
      }
      const option = await DomHelper.pollUntil(() => {
        const opts = Array.from(document.querySelectorAll('.select__option'));
        if (matcher) return opts.find((o) => matcher(o.textContent.trim()));
        return (
          opts.find((o) => Txt.lower(o.textContent) === want) ||
          opts.find((o) => Txt.lower(o.textContent).includes(want))
        );
      }, { timeout }).catch(() => null);
      if (!option) {
        const avail = this._optionTexts();
        DomHelper.dispatchEscape(input || control);
        const err = new Error(`opsi "${optionText}" tidak ditemukan di menu. Opsi yang terlihat: ${avail.length ? avail.map((t) => `"${t}"`).join(', ') : '(menu kosong)'}`);
        err.code = 'OPTION_NOT_FOUND';
        throw err;
      }
      // Opsi ada tapi dinonaktifkan oleh react-select (mis. sudah dipakai produk lain).
      const cls = typeof option.className === 'string' ? option.className : '';
      if (/is-disabled/.test(cls) || option.getAttribute('aria-disabled') === 'true') {
        DomHelper.dispatchEscape(input || control);
        const err = new Error(`opsi "${Txt.oneLine(option.textContent)}" ada tapi NONAKTIF (disabled).`);
        err.code = 'OPTION_DISABLED';
        throw err;
      }
      DomHelper.dispatchClick(option);
      await DomHelper.sleep(150);
      return true;
    },
  };
  // #endregion REACT SELECT HELPER

  // =====================================================================
  // #region KBKI PICKER
  // =====================================================================
  const Kbki = {
    parseOption(text) {
      const m = Txt.oneLine(text).match(/^(\d{4,})\s*-\s*(.*)$/);
      return m ? { code: m[1], label: m[2] } : { code: '', label: Txt.oneLine(text) };
    },
    _norm(s) { return Txt.lower(Txt.stripEndPunct(s)); },
    // options: [{el, text}] -> {opt, how} | null
    pick(options, target) {
      const parsed = options.map((o) => Object.assign({}, o, this.parseOption(o.text)));
      if (target.code) {
        const byCode = parsed.find((p) => p.code === target.code);
        if (byCode) return { opt: byCode, how: 'code' };
      }
      if (target.desc) {
        const d = this._norm(target.desc);
        const exact = parsed.find((p) => this._norm(p.label) === d);
        if (exact) return { opt: exact, how: 'exact' };
        const partial = parsed
          .filter((p) => {
            const l = this._norm(p.label);
            return l.length > 3 && (l.includes(d) || d.includes(l));
          })
          .sort((a, b) => Math.abs(a.label.length - d.length) - Math.abs(b.label.length - d.length));
        if (partial.length) return { opt: partial[0], how: 'partial' };
      }
      return null;
    },
    // Fallback: kode berakhiran 999, atau opsi "... lainnya" (mis. "4815008999 - Peralatan ... lainnya").
    pickFallback(options) {
      const parsed = options.map((o) => Object.assign({}, o, this.parseOption(o.text)));
      const by999 = parsed.find((p) => /999$/.test(p.code));
      if (by999) return { opt: by999, how: 'fallback999' };
      const byLainnya = parsed.find((p) => p.code && /\blainnya\b|\bothers?\b/i.test(p.label));
      return byLainnya ? { opt: byLainnya, how: 'fallbackLainnya' } : null;
    },
    _STOP: new Set(['for', 'of', 'the', 'and', 'dan', 'with', 'to', 'in', 'a', 'an']),
    _tokens(s) {
      return Txt.lower(s).replace(/[^a-z0-9]+/g, ' ').split(' ')
        .filter((w) => w.length > 1 && !this._STOP.has(w))
        .map((w) => (w.length > 3 && /s$/.test(w) && !/ss$/.test(w) ? w.slice(0, -1) : w));
    },
    // Fuzzy ala kategori: 2 kata TERAKHIR deskripsi MASTER wajib ada ("... ... general use"),
    // kata di depan boleh beda. Skor = kemiripan token; yang tertinggi menang.
    pickFuzzy(options, target) {
      const want = this._tokens(target.desc);
      if (want.length < 2) return null;
      const tail = want.slice(-2);
      const wantSet = new Set(want);
      let best = null;
      options.forEach((o) => {
        const p = this.parseOption(o.text);
        const toks = this._tokens(p.label);
        if (!toks.length) return;
        const tset = new Set(toks);
        if (!tail.every((w) => tset.has(w))) return;               // ekor wajib
        const common = want.filter((w) => tset.has(w)).length;
        const tailSeq = (' ' + toks.join(' ') + ' ').includes(' ' + tail.join(' ') + ' ');
        const jacc = common / (wantSet.size + tset.size - common);
        const score = (tailSeq ? 1 : 0) + jacc + common / want.length;
        if (!best || score > best.score) best = { opt: Object.assign({}, o, p), score };
      });
      return best ? { opt: best.opt, how: 'fuzzy', score: best.score } : null;
    },
  };
  // #endregion KBKI PICKER

  // =====================================================================
  // #region NAVIGATION
  // =====================================================================
  const Navigation = {
    isProductForm() {
      const urlOk = window.location.pathname.indexOf(CONFIG.addProductUrlPart) === 0;
      if (!urlOk) return false;
      return !!(
        document.querySelector('h1, h2') ||
        document.querySelector('form') ||
        document.querySelector('input')
      );
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
        return await DomHelper.waitForElement(CONFIG.selectors.addProductButton, { timeout });
      } catch (e) {
        Logger.warning('Tombol utama Tambah Produk tidak ditemukan, mencoba fallback sidebar link.');
      }
      try {
        return await DomHelper.waitForElement(CONFIG.selectors.addProductSidebarLink, { timeout });
      } catch (e) {
        return null;
      }
    },
    async gotoAddProduct() {
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
          UIPanel.setStatusText('Running');
          return true;
        } catch (e) {
          lastError = e;
          if (e && e.message === 'PRODUCT_FORM_NOT_LOADED') Logger.error('Navigation Timeout');
          Logger.warning(`Percobaan navigasi ke-${attempt} gagal. Sisa percobaan: ${CONFIG.retryLimit - attempt}.`);
        }
      }
      UIPanel.setStatusText(null);
      Logger.error('Navigasi gagal setelah mencapai retryLimit.', { lastError: lastError && lastError.message });
      return false;
    },
    // Keluar dari form TANPA menyimpan (untuk skip SKU / gagal). Urutan: tombol "Batal"
    // (+ konfirmasi dialog kalau ada) -> kalau masih di form, reload penuh.
    async leaveForm() {
      if (!this.isProductForm()) return true;
      Logger.info('Keluar dari form tanpa menyimpan...');
      const batal = DomHelper.findButton(/^batal$/i);
      if (batal) {
        DomHelper.scrollIntoView(batal);
        DomHelper.dispatchClick(batal);
        const leaveRe = /^(ya[,.\s]*(keluar|tinggalkan|buang|lanjut)?|keluar|tinggalkan|buang|lanjut(kan)?|ok)$/i;
        const start = Date.now();
        while (Date.now() - start < 6000) {
          await DomHelper.sleep(400);
          if (!this.isProductForm()) return true;
          FormFiller._clickConfirmIfAny(leaveRe);
        }
      } else {
        Logger.warning('Tombol "Batal" tidak ditemukan.');
      }
      return this.hardReload();
    },
    // Reload penuh (buang state form). Promise tidak pernah resolve karena halaman akan unload;
    // script boot ulang & auto-resume (flag RUN_KEY masih aktif).
    hardReload(url = CONFIG.targetUrl) {
      Logger.warning(`Reload halaman ke ${url} (state form dibuang, run dilanjutkan otomatis).`);
      window.addEventListener('beforeunload', (e) => { e.stopImmediatePropagation(); }, true);
      window.onbeforeunload = null;
      window.location.assign(url);
      return new Promise(() => {});
    },
  };
  // #endregion NAVIGATION

  // =====================================================================
  // #region DOC STORE (folder dokumen lokal via File System Access API)
  // =====================================================================
  const IDB = {
    _open() {
      return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') { reject(new Error('indexedDB tidak tersedia')); return; }
        const r = indexedDB.open('inaproc_v6', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    },
    async get(key) {
      const db = await this._open();
      return new Promise((resolve, reject) => {
        const rq = db.transaction('kv', 'readonly').objectStore('kv').get(key);
        rq.onsuccess = () => resolve(rq.result);
        rq.onerror = () => reject(rq.error);
      });
    },
    async set(key, val) {
      const db = await this._open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(val, key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      });
    },
  };

  const DocStore = {
    _handle: null,
    _base: null,
    _idx: new Map(),

    supported() { return typeof window.showDirectoryPicker === 'function'; },
    label() { return this._base ? this._base.name : null; },
    hasFolder() { return !!this._base; },

    async restore() {
      if (!this.supported()) return false;
      try {
        const h = await IDB.get('docRoot');
        if (!h) return false;
        this._handle = h;
        const perm = await h.queryPermission({ mode: 'read' });
        if (perm === 'granted') {
          await this._resolveBase();
          return true;
        }
        Logger.info(`Folder dokumen "${h.name}" tersimpan, tapi izin perlu dikonfirmasi ulang -- klik Start (atau "Pilih Folder Dokumen").`);
        return false;
      } catch (e) {
        Logger.debug('DocStore.restore: tidak ada folder tersimpan.', { reason: e && e.message });
        return false;
      }
    },
    async pick() {
      if (!this.supported()) {
        throw new Error('Browser ini tidak mendukung showDirectoryPicker. Pakai Chrome/Edge versi desktop.');
      }
      const h = await window.showDirectoryPicker({ id: 'inaproc-v6-docs', mode: 'read' });
      this._handle = h;
      this._base = null;
      this._idx.clear();
      IDB.set('docRoot', h).catch(() => {});
      await this._resolveBase();
      return this._base;
    },
    // Harus dipanggil dari user gesture (klik) kalau izin belum 'granted'.
    async ensurePermission() {
      if (!this._handle) return false;
      try {
        let perm = await this._handle.queryPermission({ mode: 'read' });
        if (perm !== 'granted') perm = await this._handle.requestPermission({ mode: 'read' });
        if (perm !== 'granted') return false;
        if (!this._base) await this._resolveBase();
        return !!this._base;
      } catch (e) {
        Logger.debug('DocStore.ensurePermission gagal.', { reason: e && e.message });
        return false;
      }
    },
    async _findDir(parent, name) {
      const want = Txt.lower(name);
      for await (const [entryName, handle] of parent.entries()) {
        if (handle.kind === 'directory' && Txt.lower(entryName) === want) return handle;
      }
      return null;
    },
    async _resolveBase() {
      const h = this._handle;
      const probe = CONFIG.docFolders.spek;
      this._base = null;
      this._idx.clear();
      if (await this._findDir(h, probe)) {
        this._base = h;
      } else {
        for await (const [, sub] of h.entries()) {
          if (sub.kind === 'directory' && await this._findDir(sub, probe)) { this._base = sub; break; }
        }
      }
      if (this._base) {
        Logger.success(`Folder dokumen siap: "${this._base.name}"`);
      } else {
        this._base = h;
        Logger.warning(`Subfolder "${probe}" tidak ditemukan di "${h.name}" (maupun satu level di bawahnya). Pilih folder induk yang berisi ${Object.values(CONFIG.docFolders).join(', ')}.`);
      }
      UIPanel.refresh();
    },
    _key(n) { return Txt.lower(n); },
    _stripExt(k) { return k.replace(/\.[a-z0-9]{2,5}$/, ''); },
    async _index(folderKey) {
      if (this._idx.has(folderKey)) return this._idx.get(folderKey);
      const folderName = CONFIG.docFolders[folderKey];
      const full = new Map();
      const bare = new Map();
      const dir = this._base ? await this._findDir(this._base, folderName) : null;
      if (dir) {
        for await (const [name, handle] of dir.entries()) {
          if (handle.kind !== 'file') continue;
          const k = this._key(name);
          full.set(k, handle);
          const b = this._stripExt(k);
          if (!bare.has(b)) bare.set(b, handle);
        }
      } else {
        Logger.warning(`Subfolder "${folderName}" tidak ditemukan di folder dokumen.`);
      }
      const idx = { dirFound: !!dir, full, bare, count: full.size };
      this._idx.set(folderKey, idx);
      return idx;
    },
    async _lookup(folderKey, filename) {
      const idx = await this._index(folderKey);
      const k = this._key(filename);
      return idx.full.get(k) || idx.bare.get(this._stripExt(k)) || null;
    },
    async has(folderKey, filename) { return !!(await this._lookup(folderKey, filename)); },
    async getFile(folderKey, filename) {
      const h = await this._lookup(folderKey, filename);
      return h ? h.getFile() : null;
    },
    refreshIndex() { this._idx.clear(); },
    async validateQueue(queue) {
      const missingByKey = {};
      const lines = [];
      let okItems = 0;
      for (const item of queue) {
        const miss = [];
        for (const f of QueueManager.requiredFiles(item)) {
          if (!(await this.has(f.folder, f.name))) {
            miss.push(f);
            missingByKey[f.key] = (missingByKey[f.key] || 0) + 1;
          }
        }
        if (miss.length === 0) okItems += 1;
        else if (lines.length < 20) lines.push(`${item.kodeProduk}: ${miss.map((f) => `${CONFIG.docFolders[f.folder]}/${f.name}`).join(' | ')}`);
      }
      const counts = {};
      for (const k of Object.keys(CONFIG.docFolders)) counts[k] = (await this._index(k)).count;
      return { total: queue.length, okItems, missingByKey, lines, counts };
    },
  };
  // #endregion DOC STORE

  // =====================================================================
  // #region LAMPIRAN (peta slot upload PDF)
  // =====================================================================
  // Semua <input type=file accept=pdf> di section Lampiran berbagi id yang sama
  // ("document-field-input"), jadi dipetakan lewat judul terdekat di atasnya.
  // Slot dianggap valid hanya kalau judulnya punya TEPAT 1 input (kalau 2 -> ada
  // judul yang tidak terdeteksi; lebih baik gagal daripada salah masuk slot).
  const Lampiran = {
    _key(s) { return Txt.lower(s).replace(/\s*\/\s*/g, '/').replace(/[\s*:]+$/, ''); },
    _own(el) {
      let t = '';
      el.childNodes.forEach((n) => { if (n.nodeType === 3) t += n.textContent; });
      return t;
    },
    build() {
      const keys = new Map();
      CONFIG.lampiranTitles.forEach((t) => keys.set(this._key(t), t));
      const nodes = [];
      document.querySelectorAll('h1,h2,h3,h4,h5,h6,label,legend,p,span,div').forEach((el) => {
        const k = this._key(this._own(el));
        if (k && keys.has(k)) nodes.push({ el, title: keys.get(k) });
      });
      const map = new Map();
      CONFIG.lampiranTitles.forEach((t) => map.set(t, []));
      const inputs = Array.from(document.querySelectorAll('input[type="file"]'))
        .filter((i) => /pdf/i.test(i.getAttribute('accept') || ''));
      inputs.forEach((inp) => {
        let owner = null;
        for (const n of nodes) {
          if (n.el.compareDocumentPosition(inp) & Node.DOCUMENT_POSITION_FOLLOWING) owner = n;
          else break;
        }
        if (owner) map.get(owner.title).push(inp);
      });
      return { map, nodes, inputCount: inputs.length };
    },
    // Slot sudah berisi dokumen = ada tautan/tombol "Lihat Dokumen" di bawah judul slot itu.
    // (Pesan merah "Dokumen harus diisi" bisa tertinggal walau dokumen sudah masuk -> abaikan.)
    hasDoc(title) {
      const { nodes } = this.build();
      const mine = nodes.filter((n) => n.title === title);
      if (!mine.length) return false;
      const links = Array.from(document.querySelectorAll('a,button,span,div,p'))
        .filter((el) => /^lihat dokumen$/i.test(Txt.oneLine(this._own(el))));
      return links.some((l) => {
        let owner = null;
        for (const n of nodes) {
          if (n.el.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING) owner = n; else break;
        }
        return owner && owner.title === title;
      });
    },
    inputFor(title) {
      const arr = this.build().map.get(title) || [];
      return arr.length === 1 ? arr[0] : null;
    },
  };
  // #endregion LAMPIRAN

  // =====================================================================
  // #region FORM FILLER
  // =====================================================================
  const FormFiller = {
    _warnedUnmapped: false,

    // -------------------------------------------------------------
    // Section 1: Isi Dasar
    // -------------------------------------------------------------

    // Merek: switch di-on -> isi nomor -> klik "Periksa".
    async fillMerek(item) {
      const nomor = (item && item.merek) || CONFIG.constants.merkNomor;
      const sw = await DomHelper.waitForElement(CONFIG.formSelectors.merekSwitch);
      if (!sw.checked) {
        Logger.info('Mengaktifkan switch Merek...');
        DomHelper.dispatchClick(sw);
        await DomHelper.sleep(300);
      }
      const input = await DomHelper.waitForElement(CONFIG.formSelectors.merekInput);
      DomHelper.setNativeValue(input, nomor);
      DomHelper.dispatchInput(input);
      await DomHelper.sleep(200);
      const btn = await DomHelper.waitForElement(CONFIG.formSelectors.merekCheckBtn);
      DomHelper.dispatchClick(btn);
      await NetIdle.waitIdle({ quiet: 500, timeout: 8000 });
      Logger.success(`Merek diisi & diperiksa: ${nomor}`);
      return 'OK';
    },

    // Kode KBKI: MASTER hanya punya DESKRIPSI (bukan kode). Menu berisi "kode - deskripsi" dan lazy-load saat di-scroll.
    // Tahap: (1) kode/exact (+partial) -> (2) fuzzy ekor "... general use" -> (3) fallback "lainnya"/kode 999.
    // Setiap tahap men-scroll menu bertahap sampai dasar (dan menunggu lazy-load) sebelum menyerah.
    async fillKbki(item) {
      const target = QueueManager.kbkiTarget(item);
      if (!target.code && !target.desc) {
        Logger.warning('fillKbki: item.kbki kosong pada queue. Field ini Wajib -- isi manual sebelum Simpan.');
        return 'OK';
      }
      const btn = await DomHelper.waitForElement(CONFIG.formSelectors.kbkiButton);
      DomHelper.scrollIntoView(btn);
      DomHelper.dispatchClick(btn);

      const findInput = () => {
        const active = document.activeElement;
        if (active && active.matches && active.matches('.select__input')) return active;
        let node = btn;
        for (let i = 0; i < 4 && node; i += 1) {
          const f = node.querySelector && node.querySelector('.select__input');
          if (f) return f;
          node = node.parentElement;
        }
        return document.querySelector('.select__input');
      };
      await DomHelper.waitForElement('.select__input', { timeout: 5000 }).catch(() => null);
      const readOpts = () => Array.from(document.querySelectorAll('.select__option'))
        .map((el) => ({ el, text: Txt.oneLine(el.textContent) }));

      const typeText = async (value) => {
        const input = findInput();
        if (input) {
          DomHelper.setNativeValue(input, value);
          DomHelper.dispatchInput(input);
        }
        await DomHelper.sleep(600);
        await DomHelper.pollUntil(() => !document.querySelector('.select__loading-message'), { timeout: 3000, interval: 150 }).catch(() => null);
        await DomHelper.sleep(200);
      };

      // Scroll menu bertahap dari atas sampai dasar; di tiap langkah jalankan finder(opts).
      // Di dasar: tunggu sampai 2.5 dtk untuk lazy-load; berhenti kalau 2x berturut-turut tidak bertambah.
      // Finder dicoba di setiap langkah, jadi aman juga kalau list-nya virtualized.
      const scan = async (finder) => {
        let list = document.querySelector('.select__menu-list');
        if (!list) return finder(readOpts());
        list.scrollTop = 0;
        await DomHelper.sleep(200);
        let stable = 0;
        for (let i = 0; i < 120; i += 1) {
          list = document.querySelector('.select__menu-list') || list;
          const hit = finder(readOpts());
          if (hit) return hit;
          const sig = () => {
            const o = readOpts();
            return `${o.length}|${o.length ? o[o.length - 1].text : ''}|${list.scrollHeight}`;
          };
          const before = sig();
          const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 4;
          list.scrollTop += Math.max(60, Math.floor(list.clientHeight * 0.8));
          list.dispatchEvent(new Event('scroll', { bubbles: true }));
          list.dispatchEvent(new WheelEvent('wheel', { deltaY: 300, bubbles: true }));
          await DomHelper.sleep(250);
          if (atBottom) {
            const grew = await DomHelper.pollUntil(() => sig() !== before, { timeout: 2500, interval: 150 }).then(() => true).catch(() => false);
            if (grew) stable = 0; else { stable += 1; if (stable >= 2) break; }
          }
        }
        return null;
      };

      const descClean = Txt.stripEndPunct(target.desc);
      const words = descClean.split(' ').filter(Boolean);
      const queries = [target.code || descClean];
      if (words.length > 2) queries.push(words.slice(1).join(' '));
      if (words.length > 3) queries.push(words.slice(-3).join(' '));
      if (words.length > 2) queries.push(words.slice(-2).join(' '));
      queries.push('');
      const uniq = Array.from(new Set(queries));

      // Tahap 1: kode / exact (partial hanya dipakai kalau exact tidak ketemu di seluruh scroll)
      let pick = null;
      for (const q of uniq) {
        await typeText(q);
        let partial = null;
        pick = await scan((opts) => {
          const p = Kbki.pick(opts, target);
          if (p && p.how !== 'partial') return p;
          if (p && !partial) partial = p.opt.text;
          return null;
        });
        if (!pick && partial) {
          pick = await scan((opts) => {
            const o = opts.find((x) => x.text === partial);
            return o ? { opt: o, how: 'partial' } : null;
          });
        }
        if (pick) break;
      }

      // Tahap 2: fuzzy -- "... ... general use"
      if (!pick && descClean) {
        for (const q of uniq) {
          await typeText(q);
          let best = null;
          await scan((opts) => {
            const f = Kbki.pickFuzzy(opts, target);
            if (f && (!best || f.score > best.score)) best = { text: f.opt.text, score: f.score };
            return null;
          });
          if (best) {
            pick = await scan((opts) => {
              const o = opts.find((x) => x.text === best.text);
              return o ? { opt: o, how: `fuzzy skor ${best.score.toFixed(2)}` } : null;
            });
            if (pick) {
              Logger.warning(`KBKI "${descClean}" tidak ada persis -> fuzzy cocok ke "${pick.opt.text}".`);
              break;
            }
          }
        }
      }

      // Tahap 3: fallback "...lainnya" / kode berakhiran 999
      if (!pick) {
        for (const q of ['lainnya', '999', '']) {
          await typeText(q);
          pick = await scan((opts) => Kbki.pickFallback(opts));
          if (pick) break;
        }
        if (pick) Logger.warning(`KBKI "${descClean || target.code}" tidak ada -> fallback ke "${pick.opt.text}".`);
      }

      if (!pick) {
        const all = readOpts();
        Logger.error(`fillKbki: KBKI "${descClean || target.code}" tidak ditemukan (exact, fuzzy, maupun fallback). Opsi terlihat terakhir (${all.length}): ${all.slice(0, 30).map((o) => `"${o.text}"`).join(', ')}`);
        DomHelper.dispatchEscape(findInput() || btn);
        return 'NEEDS_MANUAL_REVIEW';
      }
      if (pick.opt.el.scrollIntoView) pick.opt.el.scrollIntoView({ block: 'nearest' });
      DomHelper.dispatchClick(pick.opt.el);
      await DomHelper.sleep(250);
      Logger.success(`Kode KBKI terisi (${pick.how}): ${pick.opt.text}`);
      return 'OK';
    },

    // Daftar Produk Sektoral: opsi "Nama Produk (Kode1, Kode2, Brand)". Cocokkan kode utuh.
    async fillDaftarProdukSektoral(item) {
      const row = DomHelper.findRowByHeading(CONFIG.formSelectors.daftarProdukSektoralHeading);
      if (!row) {
        Logger.error('Daftar Produk Sektoral: row tidak ditemukan sama sekali.');
        return 'NOT_FOUND';
      }
      const kode = item.sektoral || item.kodeProduk;
      const re = Txt.codeRegex(kode);
      const container = row.querySelector('.css-b62m3t-container') || row;
      try {
        await ReactSelectHelper.select(container, kode, { matcher: (t) => re.test(t) });
      } catch (e) {
        if (e.code === 'OPTION_DISABLED') {
          Logger.warning(`Daftar Produk Sektoral: ${kode} sudah dipakai produk lain (${e.message}) -> SKIP SKU.`);
          return 'SKIP_USED';
        }
        if (e.code === 'OPTION_NOT_FOUND' && CONFIG.skipSektoralNotFound) {
          Logger.warning(`Daftar Produk Sektoral: ${kode} tidak muncul di pencarian (kemungkinan sudah dipakai produk lain) -> SKIP SKU.`);
          return 'SKIP_NOT_FOUND';
        }
        Logger.error(`fillDaftarProdukSektoral gagal: ${e.message}`);
        return 'NEEDS_MANUAL_REVIEW';
      }
      // Form menolak SETELAH opsi dipilih (pesan merah "Data produk sudah digunakan pada produk lain").
      // Pesan bisa telat muncul -> tunggu sampai ~2 detik.
      const used = await this._waitUsedMessage(2000);
      if (used) {
        Logger.warning(`Daftar Produk Sektoral: form menolak ${kode}: "${used}" -> produk sudah ada, SKIP SKU.`);
        return 'SKIP_USED';
      }
      Logger.success(`Daftar Produk Sektoral terisi (match kode produk): ${kode}`);
      return 'OK';
    },

    // Cari pesan di layar yang berarti "sudah ada / sudah dipakai / duplikat"
    // (error inline / toast / dialog). Panel script sendiri DIABAIKAN (lognya memuat kata yang sama).
    _usedMessage() {
      const re = CONFIG.usedMessageRegex;
      const inPanel = (el) => !!(el.closest && el.closest('#inaproc-v6-panel'));
      const sel = '[role="alert"], [role="status"], [role="dialog"], [class*="error" i], [class*="invalid" i], [class*="toast" i], [class*="Toastify"], [class*="danger" i], [class*="helper" i]';
      for (const el of document.querySelectorAll(sel)) {
        if (inPanel(el) || !DomHelper.isVisible(el)) continue;
        const t = Txt.oneLine(el.textContent);
        if (t && t.length < 300 && re.test(t)) return t;
      }
      // Cadangan: teks kecil (elemen daun) yang cocok, apa pun class-nya (mis. teks merah di bawah input).
      for (const el of document.querySelectorAll('p,span,small,div,li,label')) {
        if (el.children.length > 0 || inPanel(el) || !DomHelper.isVisible(el)) continue;
        const t = Txt.oneLine(el.textContent);
        if (t && t.length < 200 && re.test(t)) return t;
      }
      return null;
    },
    async _waitUsedMessage(timeout = 2000) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const m = this._usedMessage();
        if (m) return m;
        await DomHelper.sleep(250);
      }
      return this._usedMessage();
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
    // Pencocokan toleran: abaikan huruf besar/kecil, tanda baca, "&" dan kata "dan"
    // ("Hidung dan Tenggorokan" == "Hidung, dan Tenggorokan"). Kalau gagal, cetak semua opsi kolom itu.
    async _pilihKolomKategori(colIndex, text) {
      await DomHelper.pollUntil(
        () => document.querySelectorAll(CONFIG.formSelectors.kategoriKolomList).length > colIndex,
        { timeout: 5000 }
      );
      const col = document.querySelectorAll(CONFIG.formSelectors.kategoriKolomList)[colIndex];
      const norm = (s) => Txt.lower(s).replace(/&/g, ' dan ').replace(/[^a-z0-9]+/g, ' ').replace(/\bdan\b/g, ' ').replace(/\s+/g, ' ').trim();
      const items = Array.from(col.querySelectorAll('li')).map((el) => ({
        el,
        label: Txt.oneLine((el.querySelector('span') || el).textContent),
      }));
      const want = norm(text);
      let hit = items.find((x) => x.label === Txt.oneLine(text)) || items.find((x) => norm(x.label) === want);
      if (!hit) {
        const cand = items.filter((x) => {
          const n = norm(x.label);
          return n && (n.includes(want) || want.includes(n));
        });
        if (cand.length === 1) hit = cand[0];
      }
      if (!hit) {
        throw new Error(`Kategori level ${colIndex + 1} "${text}" tidak ditemukan di kolom dropdown. Opsi: ${items.map((x) => `"${x.label}"`).join(', ') || '(kolom kosong)'}`);
      }
      if (hit.label !== Txt.oneLine(text)) {
        Logger.warning(`Kategori level ${colIndex + 1}: "${text}" dicocokkan ke "${hit.label}".`);
      }
      DomHelper.dispatchClick(hit.el);
      await DomHelper.sleep(250);
    },

    // Isi Nama Produk, picu blur (validasi unik biasanya jalan saat blur), lalu cek pesan
    // "Nama Produk tidak boleh sama". Return 'OK' | 'SKIP_USED'.
    async fillNamaProduk(item) {
      const input = await DomHelper.waitForElement(CONFIG.formSelectors.namaProdukInput);
      DomHelper.setNativeValue(input, item.namaProduk || '');
      DomHelper.dispatchInput(input);
      DomHelper.dispatchChange(input);
      DomHelper.dispatchBlur(input);
      Logger.success(`Nama Produk terisi: "${item.namaProduk}"`);
      const used = await this._waitUsedMessage(1500);
      if (used) {
        Logger.warning(`Nama Produk: form menolak "${item.namaProduk}": "${used}" -> produk sudah ada, SKIP SKU.`);
        return 'SKIP_USED';
      }
      return 'OK';
    },

    async fillDeskripsi(item) {
      const textarea = await DomHelper.waitForElement(CONFIG.formSelectors.deskripsiTextarea);
      DomHelper.setNativeValue(textarea, item.deskripsi || '');
      DomHelper.dispatchInput(textarea);
      Logger.success('Deskripsi terisi.');
    },

    // Default PDN (lokal 100%) -- verifikasi saja, tidak diubah.
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

    async _checkImage(file) {
      try {
        if (typeof createImageBitmap !== 'function') return;
        const bmp = await createImageBitmap(file);
        const { width: w, height: h } = bmp;
        if (bmp.close) bmp.close();
        if (w < 300 || h < 300 || w > 2048 || h > 2048) {
          Logger.warning(`Foto ${file.name} berukuran ${w}x${h} px; ketentuan form: min 300x300, maks 2048x2048.`);
        } else {
          Logger.debug(`Foto ${file.name}: ${w}x${h} px OK.`);
        }
      } catch (e) {
        Logger.debug('_checkImage dilewati.', { reason: e && e.message });
      }
    },

    // Foto Produk: thumbnail dari folder THUMBNAILS -> slot "Foto Utama" (input-0).
    async fillFotoProduk(item) {
      let files = Array.isArray(item.fotoFiles) ? item.fotoFiles : [];
      if (files.length === 0) {
        const name = item.foto || (item.kodeAsli ? `${item.kodeAsli}.png` : '');
        if (!name) {
          Logger.warning('fillFotoProduk: nama file foto kosong di MASTER, dilewati.');
          return 'SKIPPED_NO_FILES';
        }
        const f = await DocStore.getFile('thumbnails', name);
        if (!f) {
          Logger.error(`fillFotoProduk: "${name}" tidak ada di folder ${CONFIG.docFolders.thumbnails}.`);
          return 'MISSING_FILE';
        }
        files = [f];
      }
      const input = document.querySelector(`${CONFIG.formSelectors.fotoProdukInputPrefix}0`) ||
        document.querySelector('input[id^="product-image-input-"]');
      if (!input) {
        Logger.error('fillFotoProduk: input foto tidak ditemukan.');
        return 'NOT_FOUND';
      }
      await this._checkImage(files[0]);
      const ok = DomHelper.injectFileToInput(input, files.slice(0, 5));
      if (!ok) return 'INJECT_FAILED';
      await NetIdle.waitIdle({ quiet: 900, timeout: CONFIG.uploadTimeout });
      await DomHelper.sleep(300);
      Logger.success(`Foto Produk terupload: ${files[0].name}`);
      return 'OK';
    },

    // FASE 1 (sebelum TKDN): HANYA Kategori.
    async isiDasarPreTkdn(item) {
      Logger.info(`=== Mulai isi Section 1 (Isi Dasar) - fase pre-TKDN untuk SKU ${item.kodeProduk} ===`);
      const kategoriOk = await this.fillKategori(item);
      if (!kategoriOk) {
        Logger.error('fillKategori gagal, proses dihentikan sebelum lanjut ke TKDN.');
        return 'FAILED_KATEGORI';
      }
      Logger.success('=== Fase pre-TKDN selesai (Kategori terisi). Lanjut ke stage TKDN. ===');
      return 'OK';
    },

    // FASE 2 (sesudah TKDN): Merek, KBKI, Sektoral, Nama, Foto, Deskripsi, verifikasi default.
    // Duplikat (sektoral/nama sudah dipakai) dideteksi SEBELUM foto diupload supaya cepat.
    async isiDasarPostTkdn(item) {
      Logger.info(`=== Lanjut isi Section 1 (Isi Dasar) - fase post-TKDN untuk SKU ${item.kodeProduk} ===`);
      await this.fillMerek(item);
      const kbkiResult = await this.fillKbki(item);
      if (kbkiResult === 'NEEDS_MANUAL_REVIEW') {
        UIPanel.setStatusText('PAUSED: KBKI butuh review manual (lihat log)');
        return 'PAUSED_KBKI';
      }
      const sektoralResult = await this.fillDaftarProdukSektoral(item);
      if (sektoralResult === 'SKIP_USED') return 'SKIPPED_SEKTORAL_USED';
      if (sektoralResult === 'SKIP_NOT_FOUND') return 'SKIPPED_SEKTORAL_NOT_FOUND';
      if (sektoralResult !== 'OK') {
        UIPanel.setStatusText('PAUSED: Daftar Produk Sektoral butuh review manual (lihat log)');
        return 'PAUSED_SEKTORAL';
      }
      const namaResult = await this.fillNamaProduk(item);
      if (namaResult === 'SKIP_USED') return 'SKIPPED_NAMA_USED';
      const fotoResult = await this.fillFotoProduk(item);
      if (fotoResult !== 'OK' && fotoResult !== 'SKIPPED_NO_FILES') {
        UIPanel.setStatusText('PAUSED: foto produk gagal (lihat log)');
        return 'PAUSED_FOTO';
      }
      await this.fillDeskripsi(item);
      await this.verifyDefaultLocalStatements();
      Logger.success('=== Section 1 (Isi Dasar) selesai ===');
      return 'OK';
    },

    // TKDN: nomor sertifikat (dari MASTER / konstan). Cari -> halaman hasil terpisah -> pilih radio -> Simpan.
    async fillTkdn(item) {
      const nomor = (item && item.tkdn) || CONFIG.constants.tkdnNomor;

      const sw = await DomHelper.waitForElement(CONFIG.formSelectors.tkdnSwitch);
      if (!sw.checked) {
        Logger.info('Mengaktifkan switch TKDN...');
        DomHelper.dispatchClick(sw);
        await DomHelper.sleep(300);
      } else {
        Logger.debug('Switch TKDN sudah aktif (default form).');
      }

      const input = await DomHelper.waitForElement(CONFIG.formSelectors.tkdnKeywordInput);
      DomHelper.setNativeValue(input, nomor);
      DomHelper.dispatchInput(input);
      await DomHelper.sleep(200);

      const searchBtn = await DomHelper.waitForElement(CONFIG.formSelectors.tkdnSearchBtn);
      Logger.info(`Mencari TKDN dengan nomor: ${nomor}`);
      DomHelper.dispatchClick(searchBtn);

      const submitBtnInitial = await DomHelper
        .waitForElement(CONFIG.formSelectors.tkdnSubmitBtn, { timeout: CONFIG.waitTimeout })
        .catch(() => null);
      if (!submitBtnInitial) {
        Logger.error('fillTkdn: halaman hasil TKDN (tombol "Simpan") tidak muncul setelah "Cari TKDN".');
        return 'NEEDS_MANUAL_REVIEW';
      }

      // Tombol "Simpan" muncul duluan; baris hasil di-render belakangan (fetch async) -> poll terpisah.
      const rowsFound = await DomHelper
        .pollUntil(() => {
          const rows = document.querySelectorAll(CONFIG.formSelectors.tkdnResultRow);
          return rows.length > 0 ? rows : null;
        }, { timeout: CONFIG.waitTimeout })
        .catch(() => null);

      if (!rowsFound) {
        Logger.error('fillTkdn: tidak ada baris hasil TKDN muncul dalam waktu tunggu (kemungkinan nomor tidak ditemukan).');
        return 'NEEDS_MANUAL_REVIEW';
      }
      const rows = Array.from(rowsFound);
      if (rows.length > 1) {
        Logger.warning(
          `fillTkdn: ditemukan ${rows.length} baris hasil TKDN (biasanya 1). Otomatis pilih baris pertama -- ` +
          'verifikasi manual disarankan kalau ini tidak sesuai ekspektasi.'
        );
      }
      const radio = rows[0].querySelector(CONFIG.formSelectors.tkdnResultRadio);
      if (!radio) {
        Logger.error('fillTkdn: radio button tidak ditemukan di baris hasil pertama.');
        return 'NEEDS_MANUAL_REVIEW';
      }
      DomHelper.dispatchClick(radio);
      await DomHelper.sleep(200);

      const submitBtn = document.querySelector(CONFIG.formSelectors.tkdnSubmitBtn) || submitBtnInitial;
      Logger.info('Klik "Simpan" TKDN...');
      DomHelper.dispatchClick(submitBtn);

      const backOk = await DomHelper
        .pollUntil(() => Navigation.isProductForm(), { timeout: CONFIG.waitTimeout })
        .then(() => true)
        .catch(() => false);
      if (!backOk) {
        Logger.warning(
          'fillTkdn: tidak yakin sudah kembali ke form Tambah Produk setelah Simpan -- lanjut saja, ' +
          'tapi verifikasi manual dianjurkan.'
        );
      }
      Logger.success(`TKDN terisi & disimpan (nomor: ${nomor}).`);
      return 'OK';
    },

    // -------------------------------------------------------------
    // Section: Spesifikasi Produk (dropdown dokumen)
    // -------------------------------------------------------------
    async isiSpesifikasi(item) {
      Logger.info(`=== Mulai isi Spesifikasi Produk (dropdown) untuk SKU ${item.kodeProduk} ===`);
      let failed = 0;
      for (const dd of CONFIG.specDropdowns) {
        const want = item.spec && item.spec[dd.itemKey];
        if (!want) {
          Logger.debug(`Spesifikasi "${dd.label}": nilai kosong di MASTER, dilewati.`);
          continue;
        }
        try {
          const container = await DomHelper.waitForElement(`#${dd.id}`, { timeout: CONFIG.waitTimeout });
          DomHelper.scrollIntoView(container);
          const current = ReactSelectHelper.readValue(container);
          if (current && Txt.lower(current) === Txt.lower(want)) {
            Logger.debug(`Spesifikasi "${dd.label}" sudah "${current}", dilewati.`);
            continue;
          }
          await ReactSelectHelper.select(container, want);
          Logger.success(`Spesifikasi "${dd.label}" = ${want}`);
        } catch (e) {
          failed += 1;
          Logger.error(`Spesifikasi "${dd.label}" gagal: ${e.message}`);
        }
      }
      if (!this._warnedUnmapped) {
        this._warnedUnmapped = true;
        Logger.warning(
          'Field berlabel "Wajib" di form yang TIDAK ada di MASTER (tidak diisi script): Kode KFA, Spesifikasi Produk (teks), ' +
          'Nomor Izin Edar (teks), Masa Berlaku NIE, BMHP. Kalau form menolak Simpan, cek pesan error di log.'
        );
      }
      return failed > 0 ? 'NEEDS_MANUAL_REVIEW' : 'OK';
    },

    // -------------------------------------------------------------
    // Section 5: Bisnis
    // -------------------------------------------------------------
    // Angka yang TAMPIL di input bertopeng (mask) -> number. Format ID ("1.234,50") atau
    // EN ("1,234.50"); pemisah ribuan saja ("6.099.670") dianggap bilangan bulat.
    _displayedNumber(text) {
      const s = String(text == null ? '' : text).replace(/[^\d.,]/g, '');
      if (!s) return NaN;
      if (/,\d{1,2}$/.test(s)) return Number(s.replace(/\./g, '').replace(',', '.'));
      if (/\.\d{1,2}$/.test(s) && !/\.\d{3}$/.test(s)) return Number(s.replace(/,/g, ''));
      return Number(s.replace(/[.,]/g, ''));
    },

    // Isi input numerik lalu BACA BALIK nilai yang tampil. Kalau beda dari yang diharapkan
    // (mask salah tafsir), coba ulang dengan mengetik per karakter. Return true/false.
    async _setNumeric(input, value, label) {
      const want = Number(value);
      const matches = () => Math.abs(this._displayedNumber(input.value) - want) < 0.5;
      DomHelper.setNativeValue(input, String(value));
      DomHelper.dispatchInput(input);
      await DomHelper.sleep(250);
      if (matches()) {
        Logger.debug(`${label}: form menampilkan "${input.value}" (OK, = ${want}).`);
        return true;
      }
      Logger.warning(`${label}: form menampilkan "${input.value}", diharapkan ${want}. Mencoba ketik per karakter...`);
      if (input.focus) input.focus();
      DomHelper.setNativeValue(input, '');
      DomHelper.dispatchInput(input);
      await DomHelper.sleep(120);
      for (const ch of String(value)) {
        DomHelper.setNativeValue(input, (input.value || '') + ch);
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch }));
        await DomHelper.sleep(30);
      }
      await DomHelper.sleep(250);
      if (matches()) {
        Logger.success(`${label}: berhasil dengan ketik per karakter -> "${input.value}".`);
        return true;
      }
      Logger.error(`${label}: form menampilkan "${input.value}", diharapkan ${want}. TIDAK COCOK.`);
      return false;
    },

    async fillHarga(item) {
      const input = await DomHelper.waitForElement(CONFIG.formSelectors.hargaInput);
      const ok = await this._setNumeric(input, item.harga, 'Harga Produk');
      if (ok) Logger.success(`Harga Produk terisi: ${item.harga} (form: "${input.value}")`);
      return ok;
    },

    async fillStok(item) {
      const input = await DomHelper.waitForElement(CONFIG.formSelectors.stokInput);
      const ok = await this._setNumeric(input, item.stok, 'Jumlah Stok');
      if (ok) Logger.success(`Jumlah Stok terisi: ${item.stok} (form: "${input.value}")`);
      return ok;
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
      const ok = await this._setNumeric(input, item.berat, 'Berat Produk');
      if (ok) Logger.success(`Berat Produk terisi: ${item.berat} gram (form: "${input.value}")`);
      return ok;
    },

    async fillMinPembelian(item) {
      const input = await DomHelper.waitForElement(CONFIG.formSelectors.minPembelianInput);
      const ok = await this._setNumeric(input, item.minPembelian ?? 1, 'Minimum Pembelian');
      if (ok) Logger.success(`Minimum Pembelian terisi: ${item.minPembelian ?? 1}`);
      return ok;
    },

    async fillJenisPajak(item) {
      if (!item.jenisPajak) {
        Logger.debug('fillJenisPajak: tidak ada di MASTER -> pakai default form (PPN 12%).');
        return;
      }
      const container = await DomHelper.waitForElement(CONFIG.formSelectors.jenisPajakSelect);
      await ReactSelectHelper.select(container, item.jenisPajak);
      Logger.success(`Jenis Pajak terisi: ${item.jenisPajak}`);
    },

    async isiBisnis(item) {
      Logger.info(`=== Mulai isi Section 5 (Bisnis) untuk SKU ${item.kodeProduk} ===`);
      let allOk = true;
      if (!(await this.fillHarga(item))) allOk = false;
      if (!(await this.fillStok(item))) allOk = false;
      await this.fillSatuan(item);
      if (!(await this.fillBerat(item))) allOk = false;
      if (!(await this.fillMinPembelian(item))) allOk = false;
      await this.fillJenisPajak(item);
      if (!allOk) {
        Logger.error('Section 5 (Bisnis): ada angka yang tidak cocok dengan MASTER -- SKU ini tidak akan disimpan.');
        return 'FAILED_VERIFY';
      }
      Logger.success('=== Section 5 (Bisnis) selesai ===');
      return 'OK';
    },

    // Pemeriksaan terakhir sebelum Simpan: baca ulang field penting dari form dan bandingkan
    // dengan MASTER (React bisa me-reset field setelah re-render / pilihan dropdown).
    async verifyBeforeSave(item) {
      const fs = CONFIG.formSelectors;
      const problems = [];
      const num = (sel, want, label) => {
        const el = document.querySelector(sel);
        if (!el) { problems.push(`${label}: input tidak ditemukan`); return; }
        const got = this._displayedNumber(el.value);
        if (!(Math.abs(got - Number(want)) < 0.5)) problems.push(`${label}: form="${el.value}", MASTER=${want}`);
      };
      num(fs.hargaInput, item.harga, 'Harga');
      num(fs.stokInput, item.stok, 'Stok');
      num(fs.beratInput, item.berat, 'Berat');
      const nama = document.querySelector(fs.namaProdukInput);
      if (!nama) problems.push('Nama Produk: input tidak ditemukan');
      else if (Txt.oneLine(nama.value) !== Txt.oneLine(item.namaProduk)) problems.push(`Nama: form="${Txt.oneLine(nama.value)}", MASTER="${Txt.oneLine(item.namaProduk)}"`);
      // v0.8.6: simpan snapshot harga & deskripsi yang benar-benar ada di form (untuk log & Export Hasil).
      const hEl = document.querySelector(fs.hargaInput);
      const dEl = document.querySelector(fs.deskripsiTextarea);
      STATE.formSnap[item.kodeProduk] = {
        harga: hEl ? this._displayedNumber(hEl.value) : null,
        hargaText: hEl ? hEl.value : '',
        deskripsi: dEl ? String(dEl.value || '').trim() : '',
      };
      if (problems.length) {
        Logger.error(`Verifikasi sebelum Simpan GAGAL untuk ${item.kodeProduk}: ${problems.join(' | ')}`);
        return false;
      }
      Logger.success(`Verifikasi sebelum Simpan OK (harga=${item.harga}, stok=${item.stok}, berat=${item.berat}).`);
      return true;
    },

    // -------------------------------------------------------------
    // Section: Lampiran (upload PDF)
    // -------------------------------------------------------------
    async isiLampiran(item) {
      Logger.info(`=== Mulai upload Lampiran untuk SKU ${item.kodeProduk} ===`);
      let failed = 0;
      for (const slot of CONFIG.docSlots) {
        const name = item.files && item.files[slot.field];
        if (!name) {
          Logger.debug(`Lampiran "${slot.heading}": nama file kosong di MASTER, dilewati.`);
          continue;
        }
        try {
          if (Lampiran.hasDoc(slot.heading)) {
            Logger.success(`Lampiran "${slot.heading}" sudah berisi dokumen ("Lihat Dokumen" ada) -> dilewati.`);
            continue;
          }
          const file = await DocStore.getFile(slot.folder, name);
          if (!file) throw new Error(`file "${name}" tidak ada di folder ${CONFIG.docFolders[slot.folder]}`);
          if (file.size > 10 * 1024 * 1024) {
            Logger.warning(`"${name}" berukuran ${(file.size / 1048576).toFixed(1)} MB (> batas 10 MB di form).`);
          }
          const input = await DomHelper
            .pollUntil(() => Lampiran.inputFor(slot.heading), { timeout: 8000 })
            .catch(() => null);
          if (!input && Lampiran.hasDoc(slot.heading)) { Logger.success(`Lampiran "${slot.heading}": uploader sudah berganti kartu dokumen ("Lihat Dokumen") -> OK.`); continue; }
          if (!input) throw new Error(`uploader untuk "${slot.heading}" tidak ditemukan (atau ambigu) di section Lampiran`);
          DomHelper.scrollIntoView(input.parentElement || input);
          if (!DomHelper.injectFileToInput(input, file)) throw new Error('inject file gagal');
          Logger.info(`Upload "${slot.heading}": ${name} (${Math.round(file.size / 1024)} KB) -- menunggu selesai...`);
          const idle = await NetIdle.waitIdle({ quiet: 900, timeout: CONFIG.uploadTimeout });
          if (!idle) Logger.warning(`Upload "${slot.heading}": timeout menunggu network idle, lanjut saja.`);
          const seen = await DomHelper.pollUntil(() => Lampiran.hasDoc(slot.heading), { timeout: 6000, interval: 200 }).then(() => true).catch(() => false);
          await DomHelper.sleep(300);
          if (seen) Logger.success(`Lampiran "${slot.heading}" terupload: ${name} ("Lihat Dokumen" muncul).`);
          else Logger.warning(`Lampiran "${slot.heading}": ${name} dikirim, tapi "Lihat Dokumen" belum terlihat -- lanjut (cek manual kalau Simpan ditolak).`);
        } catch (e) {
          failed += 1;
          Logger.error(`Lampiran "${slot.heading}" gagal: ${e.message}`);
        }
      }
      return failed > 0 ? 'NEEDS_MANUAL_REVIEW' : 'OK';
    },

    // -------------------------------------------------------------
    // Simpan
    // -------------------------------------------------------------
    _visibleErrors() {
      const sel = '[role="alert"], [class*="error"], [class*="invalid"], [class*="danger"]';
      const out = [];
      document.querySelectorAll(sel).forEach((el) => {
        if (el.closest && el.closest('#inaproc-v6-panel')) return;
        if (!DomHelper.isVisible(el)) return;
        const t = Txt.oneLine(el.textContent);
        if (t && t.length < 200 && !out.includes(t)) out.push(t);
      });
      return out.slice(0, 8);
    },
    _clickConfirmIfAny(okRe = /^(ya[,.\s]*(simpan|lanjut|kirim|ajukan|konfirmasi)|simpan|lanjut(kan)?|kirim|ajukan|konfirmasi|setuju|ya)$/i) {
      const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"], [aria-modal="true"]');
      for (const d of dialogs) {
        if (!DomHelper.isVisible(d)) continue;
        const btn = Array.from(d.querySelectorAll('button'))
          .find((b) => !b.disabled && DomHelper.isVisible(b) && okRe.test(Txt.oneLine(b.textContent)));
        if (btn) {
          Logger.info(`Dialog konfirmasi: klik "${Txt.oneLine(btn.textContent)}".`);
          DomHelper.dispatchClick(btn);
          return true;
        }
      }
      return false;
    },
    // Dialog "Apakah data sudah benar?" setelah klik Simpan: tombol "Ya Simpan" NONAKTIF sampai
    // semua pernyataan dicentang. Return: 'CLICKED' | 'STUCK' (tombol tetap nonaktif) | null (tidak ada dialog ini).
    async _confirmSaveDialog() {
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"], [aria-modal="true"]'))
        .filter((d) => DomHelper.isVisible(d));
      for (const d of dialogs) {
        const yes = Array.from(d.querySelectorAll('button')).find((b) => /^ya[,.\s]*simpan$/i.test(Txt.oneLine(b.textContent)));
        if (!yes) continue;
        const isOn = (el) => (el.matches('input') ? el.checked : el.getAttribute('aria-checked') === 'true');
        const enabled = () => !yes.disabled && yes.getAttribute('aria-disabled') !== 'true';

        const boxes = Array.from(d.querySelectorAll('input[type="checkbox"], [role="checkbox"]'));
        Logger.info(`Dialog "${Txt.oneLine((d.querySelector('h1,h2,h3,[class*="title" i]') || {}).textContent)}": ${boxes.length} kotak pernyataan, mencentang semuanya...`);
        for (const box of boxes) {
          if (isOn(box)) continue;
          DomHelper.dispatchClick(box);
          await DomHelper.sleep(150);
          if (!isOn(box)) {                       // checkbox custom: klik pembungkusnya
            DomHelper.dispatchClick(box.closest('label') || box.parentElement);
            await DomHelper.sleep(150);
          }
        }
        // Cadangan kalau tombol masih nonaktif: klik label/elemen "checkbox" satu per satu sampai aktif.
        if (!enabled()) {
          const cands = Array.from(d.querySelectorAll('label, [class*="checkbox" i]')).filter((el) => DomHelper.isVisible(el));
          for (const el of cands) {
            if (enabled()) break;
            DomHelper.dispatchClick(el);
            await DomHelper.sleep(150);
          }
        }
        await DomHelper.pollUntil(() => enabled(), { timeout: 3000, interval: 100 }).catch(() => null);
        if (!enabled()) {
          Logger.error('Dialog konfirmasi: tombol "Ya Simpan" tetap nonaktif setelah mencentang kotak. Centang manual lalu klik "Ya Simpan".');
          return 'STUCK';
        }
        Logger.info('Dialog konfirmasi: klik "Ya Simpan".');
        DomHelper.dispatchClick(yes);
        return 'CLICKED';
      }
      return null;
    },
    _toastSuccess() {
      const els = document.querySelectorAll('[role="status"], [role="alert"], [class*="toast" i], [class*="Toastify"]');
      return Array.from(els).some((el) => DomHelper.isVisible(el) && /berhasil/i.test(el.textContent));
    },
    async simpan(item) {
      const btn = DomHelper.findButton(/^simpan$/i);
      if (!btn) {
        Logger.error('Tombol "Simpan" tidak ditemukan.');
        return 'FAILED_SAVE_NO_BUTTON';
      }
      if (btn.disabled) {
        Logger.error(`Tombol "Simpan" disabled -- form belum valid. Pesan error: ${this._visibleErrors().join(' | ') || '(tidak terbaca)'}`);
        return 'FAILED_SAVE_DISABLED';
      }
      await NetIdle.waitIdle({ quiet: 800, timeout: CONFIG.uploadTimeout });
      DomHelper.scrollIntoView(btn);
      Logger.info(`Klik "Simpan" untuk SKU ${item.kodeProduk}...`);
      DomHelper.dispatchClick(btn);

      const start = Date.now();
      let confirmed = false;
      while (Date.now() - start < CONFIG.saveTimeout) {
        await DomHelper.sleep(500);
        if (!confirmed) {
          const c = await this._confirmSaveDialog();
          if (c === 'CLICKED') confirmed = true;
          else if (c === 'STUCK') return 'FAILED_SAVE_DIALOG';
          else if (this._clickConfirmIfAny()) confirmed = true;   // dialog lain tanpa checkbox
        }
        if (!Navigation.isProductForm()) return 'OK';
        if (this._toastSuccess()) return 'OK';
        // Server menolak karena data produk sudah ada/dipakai -> skip, bukan gagal.
        const used = this._usedMessage();
        if (used) {
          Logger.warning(`Simpan ditolak: "${used}" -> SKIP SKU.`);
          return 'SKIPPED_SEKTORAL_USED';
        }
      }
      Logger.error(`Simpan: tidak ada tanda berhasil dalam ${CONFIG.saveTimeout / 1000} detik. Pesan di layar: ${this._visibleErrors().join(' | ') || '(tidak ada)'}`);
      return 'FAILED_SAVE_TIMEOUT';
    },
  };
  // #endregion FORM FILLER

  // =====================================================================
  // #region DIAGNOSTICS (cek form tanpa mengubah apa pun)
  // =====================================================================
  const Diagnostics = {
    async run() {
      Logger.info('=== DIAGNOSA FORM (baca saja, tidak mengubah apa pun) ===');
      Logger.info(`Halaman: ${window.location.pathname} | isProductForm=${Navigation.isProductForm()}`);
      if (!Navigation.isProductForm()) {
        Logger.warning('Buka halaman Tambah Produk dulu supaya diagnosa bermakna.');
      }
      const fs = CONFIG.formSelectors;
      const simple = ['merekSwitch', 'kbkiButton', 'kategoriTrigger', 'namaProdukInput', 'deskripsiTextarea', 'klasifikasiProdukSelect',
        'lokasiProduksiSelect', 'tenagaKerjaSelect', 'bahanBakuSelect', 'hargaInput', 'stokInput', 'beratInput', 'minPembelianInput',
        'jenisPajakSelect', 'tkdnSwitch'];
      simple.forEach((k) => Logger.info(`${document.querySelector(fs[k]) ? 'ADA  ' : 'HILANG'} ${k} (${fs[k]})`));
      CONFIG.specDropdowns.forEach((dd) => {
        const c = document.getElementById(dd.id);
        Logger.info(`${c ? 'ADA  ' : 'HILANG'} dropdown "${dd.label}"${c ? ` = "${ReactSelectHelper.readValue(c) || ''}"` : ''}`);
      });
      const { map, nodes, inputCount } = Lampiran.build();
      Logger.info(`Lampiran: ${inputCount} input PDF terdeteksi, ${nodes.length} judul slot cocok.`);
      CONFIG.lampiranTitles.forEach((t) => {
        const n = (map.get(t) || []).length;
        const isUploaded = CONFIG.docSlots.some((s) => s.heading === t);
        Logger.info(`${n === 1 ? 'OK   ' : (n === 0 ? 'KOSONG' : 'AMBIGU')} slot "${t}" -> ${n} input${isUploaded ? ' [diupload script]' : ''}`);
      });
      Logger.info(`Folder dokumen: ${DocStore.label() || '(belum dipilih)'}`);
      if (DocStore.hasFolder() && !QueueManager.isEmpty()) {
        const rep = await DocStore.validateQueue(STATE.queue);
        Logger.info(`Berkas: ${rep.okItems}/${rep.total} produk lengkap. Jumlah file per folder: ${JSON.stringify(rep.counts)}`);
      }
      Logger.info('=== DIAGNOSA SELESAI ===');
    },
  };
  // #endregion DIAGNOSTICS

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
          position: fixed; top: 16px; right: 16px; width: 330px; max-height: 92vh; overflow-y: auto;
          background: #1e1e1e; color: #f0f0f0;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 12px;
          border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.4); z-index: 999999;
          border: 1px solid #3a3a3a;
        }
        #inaproc-v6-panel .iv6-header { background: #2b2b2b; padding: 8px 10px; display: flex; justify-content: space-between; align-items: center; cursor: move; user-select: none; position: sticky; top: 0; }
        #inaproc-v6-panel .iv6-title { font-weight: 600; font-size: 13px; }
        #inaproc-v6-panel .iv6-version { opacity: 0.6; font-size: 10px; }
        #inaproc-v6-panel .iv6-body { padding: 10px; }
        #inaproc-v6-panel .iv6-row { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 4px; }
        #inaproc-v6-panel .iv6-row .iv6-label { opacity: 0.7; white-space: nowrap; }
        #inaproc-v6-panel .iv6-row span:last-child { text-align: right; word-break: break-word; }
        #inaproc-v6-panel .iv6-buttons { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 8px; }
        #inaproc-v6-panel button { background: #333; color: #f0f0f0; border: 1px solid #4a4a4a; border-radius: 4px; padding: 6px 8px; font-size: 11px; cursor: pointer; }
        #inaproc-v6-panel button:hover { background: #444; }
        #inaproc-v6-panel button:disabled { opacity: 0.4; cursor: not-allowed; }
        #inaproc-v6-panel button.iv6-primary { background: #1a5fb4; border-color: #3584e4; }
        #inaproc-v6-panel .iv6-wide { width: 100%; margin-top: 6px; }
        #inaproc-v6-panel .iv6-log { margin-top: 8px; height: 150px; overflow-y: auto; background: #111; border-radius: 4px; border: 1px solid #333; }
        #inaproc-v6-panel .iv6-section { margin-top: 8px; border-top: 1px solid #333; padding-top: 8px; }
        #inaproc-v6-panel .iv6-section-label { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
        #inaproc-v6-panel .iv6-hint { opacity: 0.55; font-size: 10px; cursor: help; }
        #inaproc-v6-panel textarea#iv6-queue-input { width: 100%; box-sizing: border-box; height: 50px; background: #111; color: #f0f0f0; border: 1px solid #3a3a3a; border-radius: 4px; font-family: monospace; font-size: 10px; padding: 6px; resize: vertical; }
        #inaproc-v6-panel label.iv6-check { display: flex; align-items: center; gap: 6px; margin-top: 6px; cursor: pointer; }
        #inaproc-v6-panel.iv6-collapsed { width: auto; min-width: 150px; max-height: none; overflow: hidden; opacity: .92; }
        #inaproc-v6-panel.iv6-collapsed .iv6-body { display: none; }
        #inaproc-v6-panel.iv6-collapsed .iv6-title, #inaproc-v6-panel.iv6-collapsed .iv6-version { display: none; }
        #inaproc-v6-panel.iv6-collapsed .iv6-mini { display: inline !important; font-size: 11px; margin-right: 8px; }
        #inaproc-v6-panel .iv6-warn { color: #fdd663; }
      `;
      document.head.appendChild(style);
      const root = document.createElement('div');
      root.id = 'inaproc-v6-panel';
      root.innerHTML = `
        <div class="iv6-header" id="iv6-drag-handle">
          <span class="iv6-title">INAPROC Upload V6</span>
          <span class="iv6-mini" id="iv6-mini" style="display:none"></span>
          <span><span class="iv6-version">v${CONFIG.version}</span> <button id="iv6-btn-min" title="Minimize / buka panel" style="padding:0 7px;margin-left:6px">&#8211;</button></span>
        </div>
        <div class="iv6-body">
          <div class="iv6-section" style="border-top:none;margin-top:0;padding-top:0">
            <div class="iv6-section-label">
              <span class="iv6-label">1. Data produk</span>
              <span class="iv6-hint" title="Load MASTER.xlsx (sheet MASTER), .csv, .tsv, atau queue.json. Header kolom dicocokkan berdasarkan NAMA, urutan kolom bebas.&#10;Atau paste teks di kotak bawah lalu klik 'Load dari Teks'.">?</span>
            </div>
            <button class="iv6-wide iv6-primary" id="iv6-btn-load-file">Load MASTER (.xlsx / .csv / .json)</button>
            <input type="file" id="iv6-file-input" accept=".xlsx,.xlsm,.xls,.csv,.tsv,.txt,.json" style="display:none">
            <textarea id="iv6-queue-input" placeholder="(opsional) paste CSV/TSV/JSON di sini"></textarea>
            <button class="iv6-wide" id="iv6-btn-load-text">Load dari Teks</button>
          </div>
          <div class="iv6-section">
            <div class="iv6-section-label">
              <span class="iv6-label">2. Folder dokumen</span>
              <span class="iv6-hint" title="Pilih folder induk yang berisi subfolder THUMBNAILS, STRUKTUR_HARGA, SPEK, AKD, STATIC_DOC (mis. hasil download / sync Google Drive). Hanya dibaca, tidak diubah.">?</span>
            </div>
            <button class="iv6-wide" id="iv6-btn-pick-folder">Pilih Folder Dokumen</button>
            <div class="iv6-buttons">
              <button id="iv6-btn-check-files">Cek Berkas</button>
              <button id="iv6-btn-diagnose">Diagnosa Form</button>
            </div>
          </div>
          <div class="iv6-section">
            <div class="iv6-row"><span class="iv6-label">Status</span><span id="iv6-status">Idle</span></div>
            <div class="iv6-row"><span class="iv6-label">Stage</span><span id="iv6-stage">idle</span></div>
            <div class="iv6-row"><span class="iv6-label">SKU</span><span id="iv6-sku">-</span></div>
            <div class="iv6-row"><span class="iv6-label">Queue</span><span id="iv6-queue-pos">0 / 0</span></div>
            <div class="iv6-row"><span class="iv6-label">Folder</span><span id="iv6-docs">(belum dipilih)</span></div>
            <div class="iv6-row"><span class="iv6-label">Hasil</span><span id="iv6-results">0 saved / 0 gagal / 0 skip</span></div>
            <div class="iv6-row"><span class="iv6-label">Terkonfirmasi</span><span id="iv6-confirmed" title="SKU yang pasti sudah ada di INAPROC (SAVED, atau ditolak form sebagai duplikat)">0</span></div>
            <label class="iv6-check"><input type="checkbox" id="iv6-chk-dry"> <span>Dry run (JANGAN klik Simpan)</span></label>
            <label class="iv6-check"><input type="checkbox" id="iv6-chk-skip"> <span>Lanjut ke produk berikutnya kalau error</span></label>
            <label class="iv6-check"><input type="checkbox" id="iv6-chk-rerun"> <span>Mode ulang dari awal (abaikan hasil lama)</span></label>
            <div class="iv6-buttons">
              <button id="iv6-btn-start" class="iv6-primary">Start</button>
              <button id="iv6-btn-stop">Stop</button>
              <button id="iv6-btn-pause">Pause</button>
              <button id="iv6-btn-resume">Resume</button>
            </div>
            <div class="iv6-buttons">
              <button id="iv6-btn-export">Export Log</button>
              <button id="iv6-btn-export-results">Export Hasil</button>
            </div>
            <button class="iv6-wide" id="iv6-btn-skip" title="Saat berjalan: lewati SKU yang sedang diproses (dicatat SKIPPED_MANUAL). Saat idle: tandai SKU berikutnya sebagai skip.">Skip SKU</button>
            <button class="iv6-wide" id="iv6-btn-reset-results">Reset Hasil (ulang dari awal)</button>
            <div class="iv6-log" id="iv6-log"></div>
          </div>
        </div>
      `;
      document.body.appendChild(root);
      this._root = root;
      this._els = {
        queueInput: root.querySelector('#iv6-queue-input'),
        fileInput: root.querySelector('#iv6-file-input'),
        btnLoadFile: root.querySelector('#iv6-btn-load-file'),
        btnLoadText: root.querySelector('#iv6-btn-load-text'),
        btnPickFolder: root.querySelector('#iv6-btn-pick-folder'),
        btnCheckFiles: root.querySelector('#iv6-btn-check-files'),
        btnDiagnose: root.querySelector('#iv6-btn-diagnose'),
        status: root.querySelector('#iv6-status'),
        stage: root.querySelector('#iv6-stage'),
        sku: root.querySelector('#iv6-sku'),
        queuePos: root.querySelector('#iv6-queue-pos'),
        docs: root.querySelector('#iv6-docs'),
        results: root.querySelector('#iv6-results'),
        confirmed: root.querySelector('#iv6-confirmed'),
        chkDry: root.querySelector('#iv6-chk-dry'),
        chkSkip: root.querySelector('#iv6-chk-skip'),
        chkRerun: root.querySelector('#iv6-chk-rerun'),
        btnStart: root.querySelector('#iv6-btn-start'),
        btnPause: root.querySelector('#iv6-btn-pause'),
        btnResume: root.querySelector('#iv6-btn-resume'),
        btnStop: root.querySelector('#iv6-btn-stop'),
        btnExport: root.querySelector('#iv6-btn-export'),
        btnExportResults: root.querySelector('#iv6-btn-export-results'),
        btnResetResults: root.querySelector('#iv6-btn-reset-results'),
        btnSkip: root.querySelector('#iv6-btn-skip'),
        btnMin: root.querySelector('#iv6-btn-min'),
        mini: root.querySelector('#iv6-mini'),
        log: root.querySelector('#iv6-log'),
      };
      Logger.setPanelListElement(this._els.log);
      this._bindEvents();
      this._makeDraggable(root, root.querySelector('#iv6-drag-handle'));
      this.refresh();
      return root;
    },
    _bindEvents() {
      const e = this._els;
      e.btnStart.addEventListener('click', () => {
        if (!CONFIG.dryRun && !window.confirm('Dry run OFF: script akan menekan "Simpan" dan menyimpan produk SUNGGUHAN ke INAPROC. Lanjut?')) return;
        Main.start();
      });
      e.btnMin.addEventListener('click', () => this.setCollapsed(!this._root.classList.contains('iv6-collapsed')));
      e.btnSkip.addEventListener('click', () => Main.skipCurrent());
      e.btnPause.addEventListener('click', () => Main.pause());
      e.btnResume.addEventListener('click', () => Main.resume());
      e.btnStop.addEventListener('click', () => Main.stop());
      e.btnExport.addEventListener('click', () => this._download(Logger.exportAsText(), 'inaproc-v6-log', 'txt'));
      e.btnExportResults.addEventListener('click', () => this._download(Results.exportCsv(), 'inaproc-v6-hasil', 'csv'));
      e.btnResetResults.addEventListener('click', () => {
        if (window.confirm('Hapus semua catatan hasil? Produk yang sudah SAVED akan diproses ulang (bisa duplikat di INAPROC).')) {
          Results.clear();
          Logger.info('Catatan hasil direset.');
        }
      });
      e.btnLoadFile.addEventListener('click', () => e.fileInput.click());
      e.fileInput.addEventListener('change', async () => {
        const f = e.fileInput.files && e.fileInput.files[0];
        if (!f) return;
        try {
          this._applyParsed(await QueueManager.loadFromFile(f), f.name);
        } catch (err) {
          Logger.error(`Gagal membaca ${f.name}: ${err.message}`);
        }
        e.fileInput.value = '';
      });
      e.btnLoadText.addEventListener('click', () => {
        const text = e.queueInput.value;
        if (!text || !text.trim()) { Logger.warning('Textarea masih kosong.'); return; }
        this._applyParsed(QueueManager.parseAnyText(text), 'teks');
      });
      e.btnPickFolder.addEventListener('click', async () => {
        try {
          await DocStore.pick();
        } catch (err) {
          if (err && err.name === 'AbortError') Logger.info('Pilih folder dibatalkan.');
          else Logger.error(`Pilih folder gagal: ${err.message}`);
        }
        this.refresh();
      });
      e.btnCheckFiles.addEventListener('click', async () => { await this._checkFiles(); });
      e.btnDiagnose.addEventListener('click', async () => { await Diagnostics.run(); });
      e.chkDry.addEventListener('change', () => {
        CONFIG.dryRun = e.chkDry.checked;
        Main.saveConfig();
        if (!CONFIG.dryRun) Logger.warning('DRY RUN OFF: script akan klik Simpan sungguhan.');
        else Logger.info('Dry run ON: tombol Simpan tidak akan diklik.');
      });
      e.chkSkip.addEventListener('change', () => {
        CONFIG.onItemError = e.chkSkip.checked ? 'skip' : 'stop';
        Main.saveConfig();
        Logger.info(`Saat error: ${CONFIG.onItemError === 'skip' ? 'lanjut ke produk berikutnya (reload, coba ulang 1x lalu lewati)' : 'berhenti'}.`);
      });
      e.chkRerun.addEventListener('change', () => {
        CONFIG.rerunAll = e.chkRerun.checked;
        if (!CONFIG.rerunAll) Main.clearRerun();
        Main.saveConfig();
        Logger.info(CONFIG.rerunAll
          ? 'Mode ulang dari awal AKTIF: semua SKU diproses lagi. SKU yang ditolak form sebagai duplikat ("sudah digunakan"/"tidak boleh sama") = sudah terupload -> dicatat terkonfirmasi & di-skip; sisanya diisi sampai Simpan.'
          : 'Mode ulang dari awal dimatikan (progress rerun dihapus).');
      });
    },
    _applyParsed(parsed, sourceName) {
      const { items, errors, totalLines } = parsed;
      errors.slice(0, 25).forEach((msg) => Logger.error(`Parse ${sourceName} -- ${msg}`));
      if (errors.length > 25) Logger.error(`...dan ${errors.length - 25} error lain.`);
      if (items.length === 0) {
        Logger.error(`Load gagal: 0 dari ${totalLines} baris valid dari ${sourceName}.`);
        return;
      }
      QueueManager.setQueue(items);
      STATE.currentSku = null;
      this.refresh();
      Logger.success(`Load ${sourceName} berhasil: ${items.length} dari ${totalLines} baris valid.`);
      if (errors.length > 0) Logger.warning(`${errors.length} baris dilewati karena tidak valid -- lihat pesan error di atas.`);
    },
    async _checkFiles() {
      if (QueueManager.isEmpty()) { Logger.warning('Queue kosong. Load MASTER dulu.'); return; }
      if (!DocStore.hasFolder()) {
        if (!(await DocStore.ensurePermission())) { Logger.warning('Pilih Folder Dokumen dulu.'); return; }
      }
      DocStore.refreshIndex();
      Logger.info('Memeriksa kelengkapan berkas semua produk...');
      const rep = await DocStore.validateQueue(STATE.queue);
      Logger.info(`File per folder: ${Object.keys(rep.counts).map((k) => `${CONFIG.docFolders[k]}=${rep.counts[k]}`).join(', ')}`);
      if (rep.okItems === rep.total) {
        Logger.success(`Semua ${rep.total} produk berkasnya lengkap.`);
      } else {
        Logger.warning(`${rep.okItems}/${rep.total} produk lengkap. Yang kurang per jenis: ${JSON.stringify(rep.missingByKey)}`);
        rep.lines.forEach((l) => Logger.warning(`  ${l}`));
        if (rep.total - rep.okItems > rep.lines.length) Logger.warning(`  ...dan ${rep.total - rep.okItems - rep.lines.length} produk lain.`);
      }
    },
    _download(text, base, ext) {
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      a.href = url;
      a.download = `${base}-${stamp}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      Logger.info(`File ${a.download} diexport.`);
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
      document.addEventListener('mouseup', () => { isDragging = false; });
    },
    setCollapsed(on) {
      if (!this._root) return;
      this._root.classList.toggle('iv6-collapsed', !!on);
      this._els.btnMin.textContent = on ? '+' : '\u2013';
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
      const c = Results.counts();
      if (this._els.mini) { this._els.mini.textContent = `${STATE.isRunning ? (STATE.isPaused ? '\u23F8' : '\u25B6') : '\u25A0'} ${STATE.currentSku || '-'} | ${c.saved}/${c.failed}/${c.skipped}`; }
      this._els.sku.textContent = STATE.currentSku || '-';
      this._els.queuePos.textContent = `${STATE.queue.length ? STATE.currentIndex + 1 : 0} / ${STATE.queue.length}`;
      this._els.docs.textContent = DocStore.label() || '(belum dipilih)';
      this._els.results.textContent = `${c.saved} saved / ${c.failed} gagal / ${c.skipped} skip`;
      if (this._els.confirmed) this._els.confirmed.textContent = `${c.confirmed} / ${STATE.queue.length}`;
      this._els.chkDry.checked = !!CONFIG.dryRun;
      this._els.chkSkip.checked = CONFIG.onItemError === 'skip';
      if (this._els.chkRerun) this._els.chkRerun.checked = !!CONFIG.rerunAll;
      this._els.btnSkip.disabled = STATE.queue.length === 0;
      this._els.btnSkip.textContent = STATE.isRunning && STATE.currentSku ? `Skip SKU ini (${STATE.currentSku})` : 'Skip SKU berikutnya';
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
  const STAGE_ORDER = ['isi_dasar', 'tkdn', 'spesifikasi', 'bisnis', 'upload', 'save'];
  const Main = {
    _initialized: false,
    _docsReady: Promise.resolve(false),

    saveConfig() {
      Storage.save(STORAGE_KEYS.CONFIG_KEY, {
        dryRun: CONFIG.dryRun,
        onItemError: CONFIG.onItemError,
        stopAfterStage: CONFIG.stopAfterStage,
        rerunAll: CONFIG.rerunAll,
      });
    },

    // Progress mode "ulang dari awal": SKU yang sudah diproses di rerun ini (tahan reload / Stop).
    _markDone(kode) {
      STATE.runDone.add(kode);
      Storage.save(STORAGE_KEYS.RERUN_KEY, Array.from(STATE.runDone));
    },
    clearRerun() {
      STATE.runDone = new Set();
      Storage.remove(STORAGE_KEYS.RERUN_KEY);
    },

    init() {
      if (this._initialized) {
        Logger.warning('init() dipanggil lebih dari sekali, diabaikan.');
        return;
      }
      this._initialized = true;
      Logger.info(`INAPROC Upload Produk V6 v${CONFIG.version} - inisialisasi...`);
      const saved = Storage.load(STORAGE_KEYS.CONFIG_KEY, null);
      if (saved && typeof saved === 'object') {
        ['dryRun', 'onItemError', 'stopAfterStage', 'rerunAll'].forEach((k) => { if (saved[k] !== undefined) CONFIG[k] = saved[k]; });
        Logger.debug('Pengaturan dimuat dari localStorage.', saved);
      }
      QueueManager.loadQueue();
      StageManager.loadStage();
      STATE.flags = Storage.load(STORAGE_KEYS.FLAG_KEY, {});
      Results.load();
      const rr = Storage.load(STORAGE_KEYS.RERUN_KEY, []);
      STATE.runDone = new Set(Array.isArray(rr) ? rr : []);
      NetIdle.install();
      UIPanel.create();
      this._docsReady = DocStore.restore().then((ok) => { UIPanel.refresh(); return ok; });
      Logger.success(
        `Siap. ${QueueManager.size()} produk di queue. Langkah: (1) Load MASTER, (2) Pilih Folder Dokumen, ` +
        '(3) Cek Berkas / Diagnosa Form, (4) Start. Dry run ' + (CONFIG.dryRun ? 'AKTIF (aman).' : 'MATI (akan menyimpan sungguhan!).') +
        (CONFIG.rerunAll ? ` Mode ULANG DARI AWAL aktif (${STATE.runDone.size} SKU sudah diproses di rerun ini).` : '')
      );

      const run = Storage.load(STORAGE_KEYS.RUN_KEY, null);
      if (run && run.active && !QueueManager.isEmpty()) {
        Logger.warning('Run sebelumnya masih aktif (halaman ter-reload?). Auto-resume dalam 2 detik...');
        setTimeout(() => { this._docsReady.then(() => this.start({ auto: true })); }, 2000);
      }
    },

    async checkpoint() {
      while (STATE.isPaused && STATE.isRunning && !STATE.skipRequested) await DomHelper.sleep(300);
      if (!STATE.isRunning) throw new Error('STOPPED');
      if (STATE.skipRequested) throw new Error('SKIP_SKU');
    },

    // Tombol "Skip SKU": saat berjalan -> hentikan SKU yang sedang diproses di titik aman
    // berikutnya (antar-stage / saat menunggu upload), catat SKIPPED_MANUAL, keluar form, lanjut.
    // Saat tidak berjalan -> tandai SKU berikutnya yang belum selesai sebagai SKIPPED_MANUAL.
    skipCurrent() {
      if (STATE.isRunning) {
        STATE.skipRequested = true;
        Logger.warning(`Skip SKU diminta untuk ${STATE.currentSku || '-'} -- berhenti di titik aman berikutnya.`);
        return;
      }
      const next = STATE.queue.find((it) => !Results.shouldSkip(it.kodeProduk));
      if (!next) { Logger.warning('Tidak ada SKU tersisa untuk di-skip.'); return; }
      Results.record(next.kodeProduk, 'SKIPPED_MANUAL', 'di-skip manual (sebelum Start)');
      Logger.warning(`SKU ${next.kodeProduk} ditandai SKIP (manual). Start akan melewatinya.`);
    },

    _stopAfter(stage) { return CONFIG.stopAfterStage === stage; },

    // v0.8.6: tulis ke log harga, nama, dan deskripsi yang diupload.
    _logUploaded(kode) {
      const r = Results.get(kode) || {};
      const harga = r.hargaForm != null ? r.hargaForm : r.hargaMaster;
      Logger.info(`[${kode}] Harga diupload: Rp ${Number(harga).toLocaleString('id-ID')} (form: "${r.hargaFormText || '-'}", MASTER: ${r.hargaMaster})`);
      Logger.info(`[${kode}] Nama: ${r.nama || '-'}`);
      Logger.info(`[${kode}] Deskripsi: ${r.deskripsiForm || r.deskripsi || '-'}`);
    },

    // Proses SATU produk dari awal sampai (simulasi) simpan. Mengembalikan kode status.
    async processItem(item) {
      const kode = item.kodeProduk;
      Logger.info(`########## SKU ${kode} (${STATE.currentIndex + 1}/${STATE.queue.length}) ##########`);

      // 0. Pre-check berkas
      // Mode rerun: SKU yang sudah terkonfirmasi ada di INAPROC tidak perlu berkas lengkap
      // (akan ditolak form sebagai duplikat), jadi pre-check hanya memblokir kalau belum terkonfirmasi.
      const missing = [];
      for (const f of QueueManager.requiredFiles(item)) {
        if (!(await DocStore.has(f.folder, f.name))) missing.push(`${CONFIG.docFolders[f.folder]}/${f.name}`);
      }
      if (missing.length) {
        Logger.error(`Berkas tidak ditemukan untuk ${kode}: ${missing.join(' | ')}`);
        if (CONFIG.skipIfMissingFiles) {
          if (CONFIG.rerunAll && Results.isConfirmed(Results.get(kode))) {
            Logger.info(`SKU ${kode}: berkas kurang, tapi sudah terkonfirmasi ada di INAPROC -> dilewati tanpa membuka form.`);
            return 'SKIPPED_ALREADY_CONFIRMED';
          }
          Results.record(kode, 'SKIPPED_MISSING_FILES', missing.join(' | '));
          return 'SKIPPED_MISSING_FILES';
        }
      }

      // 1. Navigasi
      if (!(await Navigation.gotoAddProduct())) {
        Results.record(kode, 'FAILED_NAV', 'navigasi ke Tambah Produk gagal');
        return 'FAILED_NAV';
      }
      await this.checkpoint();

      // 2. Kategori
      StageManager.setStage('isi_dasar');
      const pre = await FormFiller.isiDasarPreTkdn(item);
      if (pre !== 'OK') { Results.record(kode, 'FAILED_KATEGORI', pre); return 'FAILED_KATEGORI'; }
      if (this._stopAfter('isi_dasar')) return 'STOP_AFTER_STAGE';
      await this.checkpoint();

      // 3. TKDN
      StageManager.setStage('tkdn');
      const tk = await FormFiller.fillTkdn(item);
      if (tk !== 'OK') { Results.record(kode, 'FAILED_TKDN', tk); return 'FAILED_TKDN'; }
      if (this._stopAfter('tkdn')) return 'STOP_AFTER_STAGE';
      await this.checkpoint();

      // 4. Sisa Isi Dasar (di sini duplikat sektoral/nama terdeteksi)
      StageManager.setStage('isi_dasar');
      const post = await FormFiller.isiDasarPostTkdn(item);
      if (post.indexOf('SKIPPED_') === 0) {
        // USED / NAMA_USED = form sendiri yang bilang sudah ada -> terkonfirmasi.
        // NOT_FOUND = opsi tidak muncul di pencarian -> belum pasti, tidak dikonfirmasi.
        const confirmed = /_USED$/.test(post);
        const why = post === 'SKIPPED_NAMA_USED'
          ? 'Nama Produk tidak boleh sama (produk sudah ada di INAPROC)'
          : (confirmed ? 'Data produk sudah digunakan pada produk lain (produk sudah ada di INAPROC)' : 'Daftar Produk Sektoral tidak muncul di pencarian (kemungkinan sudah dipakai)');
        Results.record(kode, post, why, { confirmed });
        return post;
      }
      if (post !== 'OK') { Results.record(kode, `FAILED_${post}`, 'isi dasar'); return `FAILED_${post}`; }
      await this.checkpoint();

      // 5. Spesifikasi (dropdown) -- SEBELUM upload lampiran, karena pilihan dropdown bisa me-render ulang section Lampiran
      StageManager.setStage('spesifikasi');
      const sp = await FormFiller.isiSpesifikasi(item);
      if (sp !== 'OK') { Results.record(kode, 'FAILED_SPESIFIKASI', 'dropdown spesifikasi'); return 'FAILED_SPESIFIKASI'; }
      if (this._stopAfter('spesifikasi')) return 'STOP_AFTER_STAGE';
      await this.checkpoint();

      // 6. Bisnis
      StageManager.setStage('bisnis');
      const bz = await FormFiller.isiBisnis(item);
      if (bz !== 'OK') { Results.record(kode, 'FAILED_BISNIS', 'harga/stok/berat tidak cocok dengan MASTER (lihat log)'); return 'FAILED_BISNIS'; }
      if (this._stopAfter('bisnis')) return 'STOP_AFTER_STAGE';
      await this.checkpoint();

      // 7. Lampiran
      StageManager.setStage('upload');
      const up = await FormFiller.isiLampiran(item);
      if (up !== 'OK') { Results.record(kode, 'FAILED_LAMPIRAN', 'upload lampiran'); return 'FAILED_LAMPIRAN'; }
      if (this._stopAfter('upload')) return 'STOP_AFTER_STAGE';
      await this.checkpoint();

      // 8. Simpan
      StageManager.setStage('save');
      if (!(await FormFiller.verifyBeforeSave(item))) {
        Results.record(kode, 'FAILED_VERIFY', 'verifikasi sebelum Simpan gagal: nilai di form beda dengan MASTER (lihat log)');
        return 'FAILED_VERIFY';
      }
      if (CONFIG.dryRun) {
        Logger.success(`DRY RUN: semua field & file untuk ${kode} sudah terisi. Tombol "Simpan" TIDAK diklik. Periksa form secara manual.`);
        Results.record(kode, 'DRYRUN_DONE', 'dry run');
        this._logUploaded(kode);
        return 'DRYRUN_DONE';
      }
      const sv = await FormFiller.simpan(item);
      if (sv !== 'OK') {
        const isSkip = sv.indexOf('SKIPPED_') === 0;
        Results.record(kode, sv, isSkip ? 'ditolak saat Simpan: produk sudah ada di INAPROC (duplikat)' : 'simpan', { confirmed: isSkip && /_USED$/.test(sv) });
        return sv;
      }
      Results.record(kode, 'SAVED', '');
      this._logUploaded(kode);
      Logger.success(`SKU ${kode} TERSIMPAN.`);
      return 'SAVED';
    },

    async start({ auto = false } = {}) {
      if (STATE.isRunning) {
        Logger.warning('start() dipanggil tapi proses sudah berjalan.');
        return;
      }
      if (QueueManager.isEmpty()) {
        Logger.error('Queue kosong. Klik "Load MASTER" dulu.');
        return;
      }
      // Izin folder dokumen: harus di awal (butuh user gesture kalau belum granted).
      const docsOk = await DocStore.ensurePermission();
      if (!docsOk) {
        Logger.error(auto
          ? 'Auto-resume butuh izin folder dokumen -- klik Start (atau "Pilih Folder Dokumen") untuk melanjutkan.'
          : 'Folder dokumen belum dipilih / izin ditolak. Klik "Pilih Folder Dokumen".');
        UIPanel.setStatusText('Pilih folder dokumen dulu');
        return;
      }
      DocStore.refreshIndex();

      STATE.isRunning = true;
      STATE.isPaused = false;
      STATE.statusText = null;
      Storage.save(STORAGE_KEYS.RUN_KEY, { active: true, since: Date.now() });
      UIPanel.setCollapsed(true);   // panel dikecilkan supaya tidak menutupi tombol form
      UIPanel.refresh();
      Logger.info(`start() dipanggil. ${QueueManager.size()} produk, dryRun=${CONFIG.dryRun}, onItemError=${CONFIG.onItemError}, rerunAll=${CONFIG.rerunAll}.`);

      let finishedAll = true;
      try {
        for (let i = 0; i < STATE.queue.length; i += 1) {
          const item = STATE.queue[i];
          if (Results.shouldSkip(item.kodeProduk)) continue;
          if (CONFIG.rerunAll) {            // percobaan ulang tidak boleh menghabiskan jatah attempts mode normal
            const prev = Results.get(item.kodeProduk);
            if (prev && /^FAILED/.test(prev.status)) prev.attempts = 0;
          }
          STATE.currentIndex = i;
          STATE.currentSku = item.kodeProduk;
          STATE.skipRequested = false;
          UIPanel.refresh();
          await this.checkpoint();

          let status;
          try {
            status = await this.processItem(item);
          } catch (e) {
            if (e && e.message === 'STOPPED') throw e;
            if (e && e.message === 'SKIP_SKU') {
              status = 'SKIPPED_MANUAL';
              Results.record(item.kodeProduk, status, 'di-skip manual lewat tombol Skip SKU');
            } else {
              status = 'FAILED_EXCEPTION';
              Logger.error(`Error tak terduga pada ${item.kodeProduk}: ${e && e.message}`, { stack: e && e.stack });
              Results.record(item.kodeProduk, status, e && e.message);
            }
          }
          STATE.skipRequested = false;
          if (CONFIG.rerunAll) this._markDone(item.kodeProduk);   // sudah diproses di rerun ini (tahan reload/Stop)

          if (status === 'SAVED') {
            if (Navigation.isProductForm()) await Navigation.leaveForm();   // form masih terbuka -> reset bersih
            await DomHelper.sleep(CONFIG.delayBetweenItems);
            continue;
          }
          if (status === 'SKIPPED_MISSING_FILES' || status === 'SKIPPED_ALREADY_CONFIRMED') continue;     // form belum dibuka, tidak perlu keluar
          if (status.indexOf('SKIPPED') === 0) {
            Logger.warning(`SKU ${item.kodeProduk} DI-SKIP (${status}) dan dicatat di hasil. Geser ke produk berikutnya.`);
            await Navigation.leaveForm();
            await DomHelper.sleep(CONFIG.delayBetweenItems);
            continue;
          }
          if (status === 'DRYRUN_DONE' || status === 'STOP_AFTER_STAGE') { finishedAll = false; break; }

          // Gagal
          if (CONFIG.onItemError === 'skip') {
            Logger.warning(`Produk ${item.kodeProduk} gagal (${status}). Mode lanjut: keluar form & lanjut ke berikutnya (dicoba ulang 1x di run berikutnya).`);
            await Navigation.leaveForm();
            continue;
          }
          finishedAll = false;
          Logger.error(`Berhenti di ${item.kodeProduk} (${status}). Perbaiki manual lalu klik Start lagi (produk ini akan dicoba ulang).`);
          break;
        }
        if (finishedAll) {
          const c = Results.counts();
          Logger.success(`SELESAI. ${c.saved} tersimpan, ${c.failed} gagal, ${c.skipped} dilewati. Terkonfirmasi ada di INAPROC: ${c.confirmed} dari ${STATE.queue.length} SKU.`);
          if (CONFIG.rerunAll) {
            const unconfirmed = STATE.queue.filter((it) => !Results.isConfirmed(Results.get(it.kodeProduk))).map((it) => it.kodeProduk);
            if (unconfirmed.length) Logger.warning(`SKU yang BELUM terkonfirmasi (${unconfirmed.length}): ${unconfirmed.slice(0, 60).join(', ')}${unconfirmed.length > 60 ? ' ...' : ''}`);
            else Logger.success('Semua SKU di queue terkonfirmasi sudah ada di INAPROC.');
          }
          StageManager.setStage('finished');
          if (CONFIG.rerunAll) {
            CONFIG.rerunAll = false;
            this.clearRerun();
            this.saveConfig();
            Logger.success('Mode ulang dari awal selesai; kembali ke mode normal. Jalankan Start sekali lagi untuk mengulang SKU yang masih FAILED.');
          }
        }
      } catch (e) {
        if (!e || e.message !== 'STOPPED') Logger.error('Proses melempar error tak terduga.', { reason: e && e.message, stack: e && e.stack });
      }
      this.stop();
    },

    pause() {
      if (!STATE.isRunning) {
        Logger.warning('pause() dipanggil tapi proses tidak sedang berjalan.');
        return;
      }
      STATE.isPaused = true;
      Logger.info('Proses dipause (berhenti di antara stage).');
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
      Storage.remove(STORAGE_KEYS.RUN_KEY);
      Logger.info('Proses dihentikan.');
      UIPanel.setCollapsed(false);
      UIPanel.refresh();
    },
  };

  function boot() {
    Main.init();
  }
  if (document.body) {
    boot();
  } else {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  }

  window.__INAPROC_V6__ = {
    CONFIG,
    STATE,
    Txt,
    Logger,
    QueueManager,
    Results,
    StageManager,
    DomHelper,
    NetIdle,
    ReactSelectHelper,
    Kbki,
    Navigation,
    DocStore,
    Lampiran,
    FormFiller,
    Diagnostics,
    UIPanel,
    Main,
  };
  // #endregion MAIN
})();