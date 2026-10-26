// ==UserScript==
// @name         INAPROC Master Produk Sectoral KFA v4 (file lokal, tanpa Supabase)
// @namespace    inaproc-master-produk-v4
// @version      4.0.0
// @description  Auto isi pengajuan Pemilik Master Produk (Sectoral > Kategori Alkes: Kode Unik KFA) di penyedia.inaproc.id. Paste "AKD[TAB]KFA", dokumen diambil dari FOLDER LOKAL (File System Access API, bukan Supabase), hasil tinggal di-copy ke Sheet.
// @match        https://penyedia.inaproc.id/*
// @run-at       document-start
// @grant        none
// ==/UserScript==
(function () {
  'use strict';
  if (window.__INAPROC_MP4__) return;
  window.__INAPROC_MP4__ = true;

  // =====================================================================
  // CONFIG
  // =====================================================================
  const CONFIG = {
    listUrl: 'https://penyedia.inaproc.id/principal-applications?tab=ALL&p=1',
    listPath: '/principal-applications',
    applyPath: '/principal-applications/apply',
    sectoralLabel: 'Kode Unik Sektoral',
    kategoriLabel: 'Kategori Alkes: Kode Unik KFA',
    tipePenyedia: ['Pemilik Merek', 'Produsen'], // Distributor sengaja TIDAK dicentang (sesuai capture)
    // Nama file default Dokumen 2 / Dokumen 3 (tanpa .pdf juga boleh). Bisa diubah dari panel.
    defaultDocs: { 2: 'Sertifikat CPAKB PNM KBLI 32509 K1', 3: '' },
    stepDelay: 500,
    maxRetry: 2,            // SKU bermasalah di-requeue maks segini kali sebelum GAGAL permanen
    maxServerRestart: 6,    // restart beruntun karena server error sebelum run dihentikan
    maxConsecutiveErrors: 3, // error teknis beruntun sebelum run dihentikan
    scanDepth: 4,           // kedalaman subfolder yang discan di folder dokumen
  };

  const PANEL_ID = 'inaproc-mp4-panel';
  const K = {
    lines: 'inaproc_mp4_lines',
    queue: 'inaproc_mp4_queue',
    results: 'inaproc_mp4_results',
    flags: 'inaproc_mp4_flags',
    run: 'inaproc_mp4_run',
    docs: 'inaproc_mp4_docs',
    log: 'inaproc_mp4_log',
    counters: 'inaproc_mp4_counters',
  };

  // =====================================================================
  // STORAGE
  // =====================================================================
  function jget(key, def) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch { return def; }
  }
  function jset(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* penuh/diblokir */ } }
  function getFlags() { return Object.assign({ dryRun: true }, jget(K.flags, {})); }
  function getDocs() { return Object.assign({}, CONFIG.defaultDocs, jget(K.docs, {})); }
  const isRunFlag = () => localStorage.getItem(K.run) === '1';

  // #region PARSER
  // Format input: satu baris per SKU, "AKD 10703620035<TAB>32010154".
  // Urutan kolom bebas: kolom yang berawalan "AKD" dianggap AKD, sisanya KFA.
  function parseQueueInput(text) {
    const out = [];
    String(text || '').split(/\r?\n/).forEach((rawLine) => {
      const raw = rawLine.trim();
      if (!raw) return;
      if (!/\d/.test(raw)) return; // header / baris tanpa angka -> abaikan
      let tokens = raw.split(/\t+/).map((s) => s.trim()).filter(Boolean);
      if (tokens.length < 2) {
        // fallback: dipisah spasi, mis. "AKD 10703620035 32010154"
        const m = raw.match(/^(AKD[\s_-]*\d+)\s+(\d+)$/i) || raw.match(/^(\d+)\s+(AKD[\s_-]*\d+)$/i);
        if (m) tokens = [m[1], m[2]];
      }
      if (tokens.length < 2) { out.push({ raw, valid: false, reason: 'Format salah (butuh 2 kolom: AKD dan KFA)' }); return; }
      let akd = tokens.find((t) => /akd/i.test(t));
      let rest = tokens.filter((t) => t !== akd);
      if (!akd) { akd = tokens[0]; rest = tokens.slice(1); }
      const kfa = (rest[0] || '').replace(/\s+/g, '');
      if (!/^\d{4,}$/.test(kfa)) { out.push({ raw, valid: false, reason: `Kode KFA "${rest[0] || ''}" tidak valid (harus angka)` }); return; }
      if (!/\d{4,}/.test(akd) && !/akd/i.test(akd)) { out.push({ raw, valid: false, reason: `AKD "${akd}" tidak valid` }); return; }
      out.push({ raw, valid: true, akd: akd.replace(/\s+/g, ' ').trim(), kfa });
    });
    return out;
  }
  const normName = (s) => String(s || '').toLowerCase().replace(/\.[a-z0-9]{2,4}$/, '').replace(/[^a-z0-9]/g, '');
  function matchAkdFile(files, akdText) {
    const digits = (String(akdText).match(/\d{5,}/) || [])[0];
    const want = normName(akdText);
    let cands = digits ? files.filter((f) => f.norm.includes(digits)) : files.filter((f) => f.norm === want);
    if (!cands.length) return null;
    const pref = cands.filter((f) => f.norm.startsWith('akd'));
    if (pref.length) cands = pref;
    cands.sort((a, b) => a.name.length - b.name.length);
    return cands[0];
  }
  function matchNamedFile(files, name) {
    const n = normName(name);
    if (!n) return null;
    const exact = files.find((f) => f.norm === n);
    if (exact) return exact;
    const part = files.filter((f) => f.norm.includes(n)).sort((a, b) => a.name.length - b.name.length);
    return part[0] || null;
  }
  // #endregion PARSER

  // =====================================================================
  // LOG
  // =====================================================================
  function log(msg) {
    const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
    const arr = jget(K.log, []);
    arr.unshift(line);
    jset(K.log, arr.slice(0, 80));
    const box = document.getElementById('mp4-log');
    if (box) {
      const d = document.createElement('div');
      d.textContent = line;
      box.prepend(d);
    }
    console.log('[INAPROC-MP4]', msg);
  }

  // =====================================================================
  // ABORT / TIMING HELPERS
  // =====================================================================
  class AbortError extends Error {}
  let loopActive = false;
  function guard() { if (loopActive && !isRunFlag()) throw new AbortError('stop'); }
  const sleep = async (ms) => { await new Promise((r) => setTimeout(r, ms)); guard(); };
  async function pollUntil(fn, { timeout = 8000, interval = 200 } = {}) {
    const start = Date.now();
    for (;;) {
      guard();
      const r = fn();
      if (r) return r;
      if (Date.now() - start > timeout) throw new Error('pollUntil timeout');
      await new Promise((res) => setTimeout(res, interval));
    }
  }
  async function tryPoll(fn, opts) {
    try { return await pollUntil(fn, opts); } catch (e) { if (e instanceof AbortError) throw e; return null; }
  }

  // =====================================================================
  // DOM HELPERS
  // =====================================================================
  function isVisible(el) {
    if (!el) return false;
    const st = window.getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function isBtnDisabled(el) {
    return !!(el.disabled || el.classList?.contains('disabled') || el.getAttribute?.('aria-disabled') === 'true');
  }
  function setNativeValue(el, value) {
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
    if (desc && desc.set) desc.set.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function clickElement(el) {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    el.click();
  }
  function simulasiKlikLengkap(el) {
    const r = el.getBoundingClientRect();
    const base = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
    if (window.PointerEvent) el.dispatchEvent(new PointerEvent('pointerdown', { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
    el.dispatchEvent(new MouseEvent('mousedown', base));
    if (window.PointerEvent) el.dispatchEvent(new PointerEvent('pointerup', { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
    el.dispatchEvent(new MouseEvent('mouseup', base));
    el.dispatchEvent(new MouseEvent('click', base));
  }
  function ignorable(el) {
    return !!(el.closest('#' + PANEL_ID) || el.closest('[id^="iv6"]') || el.closest('[class*="iv6-"]'));
  }
  function hardNavigate(url = CONFIG.listUrl) {
    window.addEventListener('beforeunload', (e) => e.stopImmediatePropagation(), true);
    window.onbeforeunload = null;
    window.location.assign(url);
    return new Promise(() => {}); // halaman bakal unload; script boot ulang & lanjut otomatis
  }

  // =====================================================================
  // NETWORK WATCH (bungkus fetch GraphQL, buat baca hasil tombol "Periksa")
  // =====================================================================
  const NetWatch = {
    entries: [],
    install() {
      const orig = window.fetch;
      if (!orig || orig.__mp4) return;
      const self = this;
      const wrapped = function (input, init) {
        let url = '';
        try { url = typeof input === 'string' ? input : (input && input.url) || ''; } catch { /* abaikan */ }
        if (!/graphql/i.test(url)) return orig.apply(this, arguments);
        let body = '';
        try { if (init && typeof init.body === 'string') body = init.body; } catch { /* abaikan */ }
        let op = '';
        try { op = JSON.parse(body).operationName || ''; } catch { /* abaikan */ }
        const entry = { t0: Date.now(), op, body: body.slice(0, 4000), status: 0, errors: null, done: false, failed: false };
        self.entries.push(entry);
        if (self.entries.length > 100) self.entries.shift();
        const p = orig.apply(this, arguments);
        p.then((res) => {
          entry.status = res.status;
          return res.clone().text().then((txt) => {
            try {
              const j = JSON.parse(txt);
              if (Array.isArray(j.errors) && j.errors.length) {
                entry.errors = j.errors.map((e) => e && e.message).filter(Boolean).join(' | ') || 'GraphQL error';
              }
            } catch { /* bukan JSON */ }
          });
        }).catch(() => { entry.failed = true; }).finally(() => { entry.done = true; });
        return p;
      };
      wrapped.__mp4 = true;
      window.fetch = wrapped;
    },
    findFor(t0, code) { return this.entries.find((e) => e.t0 >= t0 && e.body.includes(code)) || null; },
  };
  NetWatch.install();

  // =====================================================================
  // DETEKSI ERROR
  // =====================================================================
  const ERROR_KEYWORDS = [
    'wajib diisi', 'wajib di isi', 'harus diisi', 'tidak valid', 'gagal', 'tidak ditemukan',
    'tidak terdaftar', 'belum terdaftar', 'tidak sesuai', 'tidak tersedia', 'kedaluwarsa', 'kadaluarsa',
  ];
  const DUP_KEYWORDS = ['sudah digunakan', 'sudah terdaftar', 'sudah pernah', 'sudah diajukan', 'sudah ada', 'duplikat'];
  const SERVER_ERROR_KEYWORDS = [
    'internal server error', 'terjadi kesalahan pada server', 'kesalahan server', 'server error', 'bad gateway',
    'service unavailable', '500 error', 'error 500', 'error 502', 'error 503', 'gateway timeout',
    'sesi anda telah berakhir', 'sesi telah berakhir', 'sesi berakhir', 'muat ulang halaman',
  ];
  // Peta teks bermasalah yang terlihat: teks -> 'kw' (kata kunci) | 'cls' (cuma dari nama class error/warning)
  function scanMasalah() {
    const map = new Map();
    document.querySelectorAll('span, div, p, small, label').forEach((el) => {
      if (ignorable(el) || el.children.length > 2 || !isVisible(el)) return;
      const raw = el.textContent.replace(/\s+/g, ' ').trim();
      if (!raw || raw.length > 200) return;
      const t = raw.toLowerCase();
      if (ERROR_KEYWORDS.some((k) => t.includes(k)) || DUP_KEYWORDS.some((k) => t.includes(k))) { map.set(raw, 'kw'); return; }
      const cls = typeof el.className === 'string' ? el.className : '';
      if (raw.length > 3 && /(^|[\s_-])(error|invalid|danger|warning)([\s_-]|$)/i.test(cls) && !map.has(raw)) map.set(raw, 'cls');
    });
    return map;
  }
  // Pesan bermasalah yang BARU (belum ada di baseline). Baseline mencegah elemen statis
  // yang kebetulan berstyle warning/error dianggap error terus-menerus.
  function masalahBaru(baseline, kwOnly) {
    for (const [text, kind] of scanMasalah()) {
      if (baseline.has(text)) continue;
      if (kwOnly && kind !== 'kw') continue;
      return text;
    }
    return null;
  }
  const classify = (text) => (DUP_KEYWORDS.some((k) => text.toLowerCase().includes(k))
    ? { type: 'duplicate', msg: text } : { type: 'invalid', msg: text });
  function cekServerError() {
    return Array.from(document.querySelectorAll('body, body *')).some((el) => {
      if (ignorable(el) || el.children.length > 0 || !isVisible(el)) return false;
      const t = el.textContent.replace(/\s+/g, ' ').trim().toLowerCase();
      return !!t && t.length <= 200 && SERVER_ERROR_KEYWORDS.some((k) => t.includes(k));
    });
  }

  // =====================================================================
  // FOLDER DOKUMEN LOKAL (File System Access API, pola yang sama dgn kerasukan)
  // =====================================================================
  const IDB = {
    _open() {
      return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') { reject(new Error('indexedDB tidak tersedia')); return; }
        const r = indexedDB.open('inaproc_mp4', 1);
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
    handle: null,
    index: null,
    supported() { return typeof window.showDirectoryPicker === 'function'; },
    label() { return this.handle ? this.handle.name : null; },
    async restore() {
      if (this.handle) return true;
      try {
        const h = await IDB.get('docRoot');
        if (h) { this.handle = h; return true; }
      } catch { /* belum ada */ }
      return false;
    },
    async perm(request) {
      if (!this.handle) return false;
      try {
        let p = await this.handle.queryPermission({ mode: 'read' });
        if (p !== 'granted' && request) p = await this.handle.requestPermission({ mode: 'read' });
        return p === 'granted';
      } catch { return false; }
    },
    async pick() {
      if (!this.supported()) throw new Error('Browser tidak mendukung showDirectoryPicker. Pakai Chrome/Edge desktop.');
      const h = await window.showDirectoryPicker({ id: 'inaproc-mp4-docs', mode: 'read' });
      this.handle = h;
      this.index = null;
      IDB.set('docRoot', h).catch(() => {});
      return h;
    },
    async ensureIndex(force) {
      if (this.index && !force) return this.index;
      const files = [];
      const walk = async (dir, depth, path) => {
        for await (const [name, h] of dir.entries()) {
          if (h.kind === 'file' && /\.pdf$/i.test(name)) files.push({ name, handle: h, path: path + name, norm: normName(name) });
          else if (h.kind === 'directory' && depth < CONFIG.scanDepth) await walk(h, depth + 1, path + name + '/');
        }
      };
      await walk(this.handle, 0, '');
      this.index = files;
      return files;
    },
    findAkd(akdText) { return matchAkdFile(this.index || [], akdText); },
    findNamed(name) { return matchNamedFile(this.index || [], name); },
  };

  // =====================================================================
  // ANTRIAN & HASIL
  // =====================================================================
  function setResult(item, status, note) {
    const res = jget(K.results, {});
    res[item.idx] = { status, note: note || '', ts: new Date().toISOString() };
    jset(K.results, res);
  }
  function shiftQueue(idx) {
    jset(K.queue, jget(K.queue, []).filter((q) => q.idx !== idx));
  }
  function itemFromQueue(q) {
    const line = jget(K.lines, []).find((l) => l.idx === q.idx) || {};
    return { ...line, attempts: q.attempts || 0 };
  }
  // SKU bermasalah: pindah ke BELAKANG antrian (retry), setelah maxRetry baru GAGAL permanen.
  function requeueOrDrop(item, reason) {
    const q = jget(K.queue, []).filter((x) => x.idx !== item.idx);
    const attempts = (item.attempts || 0) + 1;
    if (attempts <= CONFIG.maxRetry) {
      q.push({ idx: item.idx, attempts });
      jset(K.queue, q);
      setResult(item, `RETRY-${attempts}`, reason);
      log(`⏭️ KFA ${item.kfa}: ${reason} -> dimasukkan ulang ke akhir antrian (percobaan ${attempts}/${CONFIG.maxRetry}).`);
    } else {
      jset(K.queue, q);
      setResult(item, 'GAGAL', reason);
      log(`🛑 KFA ${item.kfa}: ${reason} -> GAGAL permanen setelah ${CONFIG.maxRetry}x retry.`);
    }
  }
  function loadBatch(text) {
    const parsed = parseQueueInput(text);
    const seen = new Set();
    const lines = [];
    const queue = [];
    const results = {};
    parsed.forEach((p, i) => {
      const idx = i + 1;
      if (!p.valid) {
        lines.push({ idx, raw: p.raw, akd: p.raw, kfa: '', valid: false });
        results[idx] = { status: 'BARIS-TIDAK-VALID', note: p.reason, ts: new Date().toISOString() };
        return;
      }
      const key = `${p.akd.toLowerCase()}|${p.kfa}`;
      lines.push({ idx, raw: p.raw, akd: p.akd, kfa: p.kfa, valid: true });
      if (seen.has(key)) {
        results[idx] = { status: 'DUPLIKAT-DI-INPUT', note: 'AKD+KFA sama dengan baris sebelumnya, tidak diproses', ts: new Date().toISOString() };
        return;
      }
      seen.add(key);
      queue.push({ idx, attempts: 0 });
    });
    jset(K.lines, lines);
    jset(K.queue, queue);
    jset(K.results, results);
    jset(K.counters, { server: 0, err: 0 });
    return { total: lines.length, queued: queue.length, invalid: lines.filter((l) => !l.valid).length, dup: Object.values(results).filter((r) => r.status === 'DUPLIKAT-DI-INPUT').length };
  }
  // Output urut sesuai baris input -> tinggal paste ke Sheet di sebelah data asli.
  function outputRows() {
    const res = jget(K.results, {});
    return jget(K.lines, []).map((l) => {
      const r = res[l.idx];
      return [l.akd || l.raw, l.kfa || '', r ? r.status : 'BELUM-DIPROSES', r ? (r.note || '') : ''];
    });
  }
  const cleanCell = (s) => String(s == null ? '' : s).replace(/[\t\r\n]+/g, ' ').trim();
  function outputTSV() { return outputRows().map((r) => r.map(cleanCell).join('\t')).join('\n'); }

  // =====================================================================
  // LANGKAH-LANGKAH FORM
  // =====================================================================
  async function bukaFormDaftar() {
    if (cekServerError()) return { type: 'server', msg: 'Server error di halaman daftar' };
    const btn = await tryPoll(() => {
      const b = document.querySelector('#register-brand-button');
      return b && isVisible(b) && !isBtnDisabled(b) ? b : null;
    }, { timeout: 25000 });
    if (!btn) return cekServerError() ? { type: 'server', msg: 'Server error' } : { type: 'error', msg: 'Tombol "Daftarkan Merek" tidak ketemu' };
    clickElement(btn);
    const ok = await tryPoll(() => document.querySelector('#sectoral'), { timeout: 15000 });
    if (!ok) return { type: 'error', msg: 'Form pengajuan tidak terbuka setelah klik "Daftarkan Merek"' };
    return null;
  }

  async function pilihSectoral() {
    const radio = await pollUntil(() => document.querySelector('#sectoral'), { timeout: 15000 });
    if (!radio.checked) clickElement(radio);
    await sleep(CONFIG.stepDelay);
    if (!radio.checked) { clickElement(radio.closest('label') || radio); await sleep(CONFIG.stepDelay); }
  }

  async function pilihKategori() {
    const MAX = 3;
    const cariControl = () => {
      const all = Array.from(document.querySelectorAll('[class*="select__control"]')).filter(isVisible);
      const cocok = all.filter((el) => {
        let n = el;
        for (let i = 0; i < 6 && n; i++, n = n.parentElement) {
          if ((n.textContent || '').toLowerCase().includes(CONFIG.sectoralLabel.toLowerCase())) return true;
        }
        return false;
      });
      return cocok[0] || (all.length === 1 ? all[0] : null);
    };
    const cariOpsi = () => Array.from(document.querySelectorAll('[class*="select__option"], [role="option"]'))
      .find((el) => isVisible(el) && el.textContent.trim() === CONFIG.kategoriLabel) || null;
    for (let a = 1; a <= MAX; a++) {
      const control = await tryPoll(cariControl, { timeout: 8000 });
      if (!control) { log(`⚠️ Dropdown kategori belum muncul (percobaan ${a}/${MAX})`); continue; }
      if (/alkes/i.test(control.textContent)) { log('Kategori sudah terpilih: Alkes'); return; }
      simulasiKlikLengkap(control); // react-select membuka menu lewat mousedown
      await sleep(350);
      let opsi = await tryPoll(cariOpsi, { timeout: 4000 });
      if (!opsi) {
        const inp = control.querySelector('input');
        if (inp) { inp.focus(); inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, bubbles: true })); }
        opsi = await tryPoll(cariOpsi, { timeout: 3000 });
      }
      if (!opsi) {
        log(`⚠️ Opsi "${CONFIG.kategoriLabel}" tidak ketemu (percobaan ${a}/${MAX}), coba lagi...`);
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
        await sleep(400);
        continue;
      }
      simulasiKlikLengkap(opsi);
      await sleep(CONFIG.stepDelay);
      const terpilih = await tryPoll(() => { const c = cariControl(); return c && /alkes/i.test(c.textContent); }, { timeout: 4000 });
      if (terpilih) { log(`Kategori terpilih: ${CONFIG.kategoriLabel}`); return; }
      log(`⚠️ Kategori belum berubah setelah opsi diklik (percobaan ${a}/${MAX})`);
    }
    throw new Error(`Gagal memilih kategori "${CONFIG.kategoriLabel}" setelah ${MAX}x percobaan`);
  }

  // Hasil tombol "Periksa". Di form sekarang blok tipe penyedia & lampiran sudah tampil
  // SEBELUM Periksa, jadi "checkbox muncul" tidak bisa dipakai sebagai tanda sukses.
  // Tanda yang dipakai: respons GraphQL yang membawa kode KFA tsb + pesan baru di layar.
  async function periksaKfa(kfa, baseline) {
    const input = await pollUntil(() => document.querySelector('input[name="kfa.input"], input[placeholder="Nomor Produk"]'), { timeout: 10000 });
    setNativeValue(input, kfa);
    await sleep(CONFIG.stepDelay);
    const btn = await pollUntil(() => document.querySelector('#find-kfa-button'), { timeout: 8000 });
    await tryPoll(() => !isBtnDisabled(btn), { timeout: 4000 });
    baseline = new Map([...baseline, ...scanMasalah()]);
    const t0 = Date.now();
    clickElement(btn);
    let entry = null;
    while (Date.now() - t0 < 14000) {
      guard();
      if (cekServerError()) return { type: 'server', msg: 'Server error saat Periksa' };
      if (!entry) entry = NetWatch.findFor(t0, kfa);
      if (entry && entry.done) {
        if (entry.status >= 500 || entry.failed) return { type: 'server', msg: `Respons server ${entry.status || 'gagal'} saat Periksa` };
        if (entry.errors) return classify(entry.errors);
        await sleep(700); // kasih waktu React render pesan hasil
        const m = masalahBaru(baseline, true);
        if (m) return classify(m);
        return { type: 'ok', via: `${entry.op || 'graphql'} ${entry.status}`, baseline: new Map([...baseline, ...scanMasalah()]) };
      }
      if (!entry && Date.now() - t0 > 2500) {
        const m = masalahBaru(baseline, false);
        if (m) return classify(m);
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    const m = masalahBaru(baseline, false);
    if (m) return classify(m);
    log('⚠️ Respons "Periksa" tidak terdeteksi lewat network & tidak ada pesan error -- lanjut dengan asumsi valid (divalidasi lagi saat Kirim).');
    return { type: 'ok', via: 'timeout', baseline: new Map([...baseline, ...scanMasalah()]) };
  }

  function cariCheckbox(nama, idx) {
    let el = document.querySelector(`input[type="checkbox"][label="${nama}"]`);
    if (el) return el;
    const all = Array.from(document.querySelectorAll('input[type="checkbox"]')).filter((i) => i.id !== 'checkbox-data-validity-confirmation');
    el = all.find((i) => {
      const box = i.closest('div.flex.items-start') || i.closest('label') || i.parentElement;
      return box && (box.textContent || '').toLowerCase().includes(nama.toLowerCase());
    });
    return el || all[idx] || null;
  }
  async function centangTipePenyedia() {
    for (let i = 0; i < CONFIG.tipePenyedia.length; i++) {
      const nama = CONFIG.tipePenyedia[i];
      const cb = await pollUntil(() => cariCheckbox(nama, i), { timeout: 10000 });
      if (!cb.checked) {
        clickElement(cb);
        await sleep(300);
        if (!cb.checked) { clickElement(cb.closest('label') || cb); await sleep(300); }
      }
      if (!cb.checked) throw new Error(`Checkbox tipe penyedia "${nama}" gagal dicentang`);
    }
    log(`Tipe penyedia dicentang: ${CONFIG.tipePenyedia.join(', ')}`);
    await sleep(CONFIG.stepDelay);
  }

  function getSlots() {
    const inputs = Array.from(document.querySelectorAll('input[type="file"]'))
      .filter((i) => /pdf/i.test(i.getAttribute('accept') || '') && !ignorable(i));
    return inputs.map((input, i) => {
      let best = input.parentElement;
      let node = input;
      for (let h = 0; h < 8 && node.parentElement; h++) {
        node = node.parentElement;
        if (node.querySelectorAll('input[type="file"]').length !== 1) break;
        best = node;
      }
      return { n: i + 1, input, container: best };
    });
  }
  // Bukti upload SUKSES = tulisan "Lihat Dokumen" muncul (terlihat) di dalam slot-nya.
  // Tanpa itu, proses TIDAK boleh lanjut.
  function lihatDokumenEls(container) {
    return Array.from(container.querySelectorAll('a, button, span, p, div'))
      .filter((el) => el.children.length === 0 && el.textContent.replace(/\s+/g, ' ').trim().toLowerCase() === 'lihat dokumen' && isVisible(el));
  }
  const hrefsOf = (els) => els.map((el) => el.getAttribute('href') || '').filter(Boolean);
  async function uploadKeSlot(slot, file, label) {
    const beforeEls = lihatDokumenEls(slot.container);
    const beforeHrefs = hrefsOf(beforeEls);
    const dt = new DataTransfer();
    dt.items.add(file);
    slot.input.files = dt.files;
    slot.input.dispatchEvent(new Event('input', { bubbles: true }));
    slot.input.dispatchEvent(new Event('change', { bubbles: true }));
    log(`⏳ Upload ${label}: ${file.name} -- menunggu tulisan "Lihat Dokumen"...`);
    await pollUntil(() => {
      if (cekServerError()) throw new Error('SERVER_ERROR');
      const els = lihatDokumenEls(slot.container);
      if (!els.length) return null;
      if (beforeEls.length) return hrefsOf(els).some((h) => !beforeHrefs.includes(h)) ? true : null; // sudah ada sebelumnya -> butuh link baru
      return true;
    }, { timeout: 30000, interval: 300 }).catch((e) => {
      if (e instanceof AbortError || e.message === 'SERVER_ERROR') throw e;
      throw new Error(`Upload ${label} BELUM terkonfirmasi: tulisan "Lihat Dokumen" tidak muncul dalam 30 detik (proses dihentikan untuk SKU ini)`);
    });
    log(`✅ Upload ${label} terkonfirmasi ("Lihat Dokumen" muncul)`);
    await sleep(300);
  }
  async function unggahDokumen(files) {
    const slots = await pollUntil(() => { const s = getSlots(); return s.length ? s : null; }, { timeout: 12000 });
    log(`Slot dokumen di form: ${slots.length}`);
    const diupload = [];
    for (const slot of slots) {
      const f = files[slot.n];
      if (!f) { log(`ℹ️ Dokumen ${slot.n}: tidak ada file dikonfigurasi, slot DILEWATI`); continue; }
      const file = await f.handle.getFile();
      await uploadKeSlot(slot, file, `Dokumen ${slot.n}`);
      diupload.push(slot);
    }
    for (const n of Object.keys(files)) {
      if (!slots.some((sl) => String(sl.n) === String(n))) throw new Error(`Slot Dokumen ${n} tidak ada di form padahal file-nya dikonfigurasi`);
    }
    // Verifikasi akhir: semua slot yang diupload HARUS masih menampilkan "Lihat Dokumen".
    await sleep(500);
    const belum = diupload.filter((sl) => !lihatDokumenEls(sl.container).length).map((sl) => `Dokumen ${sl.n}`);
    if (belum.length) throw new Error(`Verifikasi akhir gagal: "Lihat Dokumen" tidak terlihat di ${belum.join(', ')}`);
    log(`✅ Semua dokumen terverifikasi ("Lihat Dokumen" ada di ${diupload.length} slot)`);
  }

  async function kirimForm(baseline) {
    const cb = await pollUntil(() => document.querySelector('#checkbox-data-validity-confirmation'), { timeout: 8000 });
    if (!cb.checked) { clickElement(cb); await sleep(300); }
    if (!cb.checked) { clickElement(cb.closest('label') || cb); await sleep(300); }
    const btn = await tryPoll(() => {
      const b = document.querySelector('#button-submit-principal-application');
      return b && isVisible(b) && !isBtnDisabled(b) ? b : null;
    }, { timeout: 10000 });
    if (!btn) {
      const m = masalahBaru(baseline, false);
      return { type: 'invalid', msg: m ? `Tombol Kirim tidak aktif: ${m}` : 'Tombol Kirim tidak aktif (form belum lengkap/valid)' };
    }
    clickElement(btn);
    log('⏳ Kirim diklik, menunggu hasil...');
    const t0 = Date.now();
    const kembaliTerlihat = () => Array.from(document.querySelectorAll('button, span, a'))
      .some((el) => el.textContent.trim() === 'Kembali ke Dashboard' && isVisible(el));
    while (Date.now() - t0 < 30000) {
      guard();
      if (cekServerError()) return { type: 'server', msg: 'Server error setelah klik Kirim' };
      if (kembaliTerlihat()) return { type: 'ok', msg: 'Terkirim' };
      const b = document.querySelector('#button-submit-principal-application');
      if (!b || !isVisible(b)) {
        await sleep(1000);
        const m = masalahBaru(baseline, true);
        if (m) return classify(m);
        return { type: 'ok', msg: 'Terkirim' };
      }
      if (Date.now() - t0 > 4000) {
        const m = masalahBaru(baseline, true);
        if (m) return classify(m);
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    return { type: 'error', msg: 'Tombol Kirim masih terlihat setelah 30 detik (submit kemungkinan nyangkut)' };
  }

  async function processItem(item, files) {
    try {
      log(`▶ AKD "${item.akd}" | KFA ${item.kfa}`);
      await pilihSectoral();
      await pilihKategori();
      const kfaInput = await pollUntil(() => document.querySelector('input[name="kfa.input"], input[placeholder="Nomor Produk"]'), { timeout: 10000 });
      const baseline0 = scanMasalah();
      setNativeValue(kfaInput, '');
      await sleep(200);
      const cek = await periksaKfa(item.kfa, baseline0);
      if (cek.type !== 'ok') return cek;
      log(`✅ Periksa KFA ${item.kfa} lolos (${cek.via})`);
      const baseline = cek.baseline;
      await centangTipePenyedia();
      await unggahDokumen(files);
      await sleep(800);
      if (cekServerError()) return { type: 'server', msg: 'Server error sebelum submit' };
      const m = masalahBaru(baseline, false);
      if (m) return classify(m);
      if (getFlags().dryRun) return { type: 'dry' };
      return await kirimForm(baseline);
    } catch (e) {
      if (e instanceof AbortError) throw e;
      if (e.message === 'SERVER_ERROR' || cekServerError()) return { type: 'server', msg: e.message };
      console.error('[INAPROC-MP4]', e);
      return { type: 'error', msg: e.message };
    }
  }

  // =====================================================================
  // LOOP UTAMA
  // =====================================================================
  function stopRun(reason) {
    localStorage.setItem(K.run, '0');
    if (reason) log(`⏹ ${reason}`);
    refreshPanel();
  }

  async function resolveFiles(item) {
    if (!DocStore.handle) await DocStore.restore();
    if (!DocStore.handle) return { type: 'stop', msg: 'Folder dokumen belum dipilih. Klik "Pilih / Izinkan Folder", lalu Mulai lagi.' };
    if (!(await DocStore.perm(false))) return { type: 'stop', msg: 'Izin akses folder belum aktif (browser minta konfirmasi ulang). Klik "Pilih / Izinkan Folder", lalu Mulai lagi.' };
    await DocStore.ensureIndex();
    const akd = DocStore.findAkd(item.akd);
    if (!akd) return { type: 'skip', status: 'FILE-AKD-TIDAK-ADA', msg: `File PDF untuk "${item.akd}" tidak ketemu di folder` };
    const files = { 1: akd };
    const docs = getDocs();
    for (const n of [2, 3]) {
      if (!docs[n]) continue;
      const f = DocStore.findNamed(docs[n]);
      if (!f) return { type: 'stop', msg: `Dokumen ${n} "${docs[n]}" tidak ketemu di folder. Cek nama file di panel.` };
      files[n] = f;
    }
    return { type: 'ok', files };
  }

  async function handleOutcome(item, out) {
    const C = Object.assign({ server: 0, err: 0 }, jget(K.counters, {}));
    switch (out.type) {
      case 'ok':
        setResult(item, 'BERHASIL', out.msg || '');
        shiftQueue(item.idx);
        C.server = 0; C.err = 0;
        log(`🎉 BERHASIL: KFA ${item.kfa} (AKD ${item.akd})`);
        break;
      case 'dry':
        setResult(item, 'DRY-RUN-OK', 'Form terisi lengkap, TIDAK dikirim (dry run)');
        log(`[DRY RUN] KFA ${item.kfa} selesai diisi. Checkbox konfirmasi & Kirim TIDAK diklik. Cek form di layar.`);
        stopRun('Dry run selesai untuk 1 SKU (SKU tetap di antrian). Matikan Dry run lalu klik Mulai untuk submit sungguhan.');
        return 'stop';
      case 'duplicate':
        setResult(item, 'SUDAH-ADA', out.msg);
        shiftQueue(item.idx);
        C.server = 0; C.err = 0;
        log(`↪ KFA ${item.kfa}: ${out.msg} -> dicatat SUDAH-ADA`);
        break;
      case 'invalid':
        requeueOrDrop(item, out.msg);
        C.server = 0; C.err = 0;
        break;
      case 'server':
        C.server += 1;
        jset(K.counters, C);
        if (C.server > CONFIG.maxServerRestart) {
          stopRun(`Server error ${C.server}x beruntun (${out.msg}). Cek koneksi / login, lalu Mulai lagi.`);
          return 'stop';
        }
        log(`🛑 ${out.msg} -- infra, bukan salah SKU. Restart dari awal (SKU tetap di antrian, tidak dihitung retry). [${C.server}/${CONFIG.maxServerRestart}]`);
        break;
      default:
        C.err += 1;
        requeueOrDrop(item, `ERROR: ${out.msg}`);
        if (C.err >= CONFIG.maxConsecutiveErrors) {
          jset(K.counters, C);
          stopRun(`${C.err} error teknis beruntun -- kemungkinan struktur form berubah. Lihat log, lalu kirim ke Claude buat dicek.`);
          return 'stop';
        }
    }
    jset(K.counters, C);
    refreshPanel();
    await sleep(300);
    return hardNavigate(); // fresh start untuk SKU berikutnya
  }

  async function runLoop() {
    if (loopActive) return;
    loopActive = true;
    refreshPanel();
    try {
      for (;;) {
        guard();
        const q = jget(K.queue, []);
        if (!q.length) {
          stopRun('🎉 Antrian kosong -- semua baris sudah diproses. Klik "Copy Hasil" buat paste ke Sheet.');
          break;
        }
        const item = itemFromQueue(q[0]);
        const pre = await resolveFiles(item);
        if (pre.type === 'stop') { stopRun(pre.msg); break; }
        if (pre.type === 'skip') {
          setResult(item, pre.status, pre.msg);
          shiftQueue(item.idx);
          log(`⏭️ ${pre.msg} -> dilewati`);
          refreshPanel();
          continue;
        }
        const path = location.pathname.replace(/\/+$/, '');
        let out = null;
        if (path === CONFIG.listPath) out = await bukaFormDaftar();
        else if (path !== CONFIG.applyPath) { await hardNavigate(); }
        if (!out) out = await processItem(item, pre.files);
        if ((await handleOutcome(item, out)) === 'stop') break;
      }
    } catch (e) {
      if (!(e instanceof AbortError)) { console.error('[INAPROC-MP4]', e); log(`⚠️ Loop berhenti: ${e.message}`); localStorage.setItem(K.run, '0'); }
    } finally {
      loopActive = false;
      refreshPanel();
    }
  }

  function startRun() {
    if (!jget(K.queue, []).length) { log('⚠️ Antrian kosong. Paste data & klik "Muat Antrian" dulu.'); return; }
    localStorage.setItem(K.run, '1');
    log(`🚀 Mulai (${getFlags().dryRun ? 'DRY RUN' : 'LIVE -- submit sungguhan'})`);
    const path = location.pathname.replace(/\/+$/, '');
    if (path !== CONFIG.listPath) hardNavigate(); // selalu mulai dari halaman daftar biar form fresh
    else runLoop();
  }

  // =====================================================================
  // PANEL
  // =====================================================================

  function refreshPanel() {
    const el = document.getElementById('mp4-status');
    if (!el) return;
    const q = jget(K.queue, []);
    const res = jget(K.results, {});
    const cnt = {};
    Object.values(res).forEach((r) => { cnt[r.status] = (cnt[r.status] || 0) + 1; });
    const ringkas = Object.keys(cnt).sort().map((s) => `${s}: ${cnt[s]}`).join(' | ');
    const state = isRunFlag() ? (loopActive ? '<b style="color:#2e7d32">▶ JALAN</b>' : '<b style="color:#b26a00">▶ MENUNGGU</b>') : '<b style="color:#a00">⏹ BERHENTI</b>';
    el.innerHTML = `${state} | Antrian: <b>${q.length}</b> | Baris: <b>${jget(K.lines, []).length}</b><br><span style="color:#555">${ringkas || 'Belum ada hasil'}</span>`;
    const fl = document.getElementById('mp4-folder-label');
    if (fl) fl.textContent = DocStore.label() ? `📁 ${DocStore.label()}` : '(folder belum dipilih)';
  }

  function showPreview(text) {
    const box = document.getElementById('mp4-preview');
    if (!box) return;
    box.style.display = 'block';
    box.value = text;
    box.focus();
    box.select();
  }
  async function copyHasil() {
    const rows = outputRows();
    if (!rows.length) { alert('Belum ada data buat di-copy.'); return; }
    const text = outputTSV();
    let ok = false;
    try {
      if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); ok = true; }
    } catch { ok = false; }
    if (!ok) {
      const tmp = document.createElement('textarea');
      tmp.value = text; tmp.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(tmp); tmp.focus(); tmp.select();
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      document.body.removeChild(tmp);
    }
    log(ok ? `📋 ${rows.length} baris ke-copy (kolom: AKD, KFA, STATUS, KETERANGAN). Paste ke Sheet.` : '⚠️ Copy otomatis gagal -- teks sudah ke-select di kotak preview, tekan Ctrl+C.');
    showPreview(text);
  }
  function downloadCsv() {
    const rows = outputRows();
    if (!rows.length) { alert('Belum ada data buat di-export.'); return; }
    const csv = [['AKD', 'KFA', 'STATUS', 'KETERANGAN'], ...rows].map((r) => r.map((c) => `"${cleanCell(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `inaproc_hasil_${Date.now()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  async function pilihFolder() {
    try {
      await DocStore.restore();
      if (!DocStore.handle) await DocStore.pick();
      else if (!(await DocStore.perm(true))) await DocStore.pick();
      const files = await DocStore.ensureIndex(true);
      log(`📁 Folder "${DocStore.label()}" siap: ${files.length} file PDF terindeks (scan sampai ${CONFIG.scanDepth} level subfolder).`);
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      log(`⚠️ Gagal pilih folder: ${e.message}`);
    }
    refreshPanel();
  }
  async function gantiFolder() {
    try {
      await DocStore.pick();
      const files = await DocStore.ensureIndex(true);
      log(`📁 Folder diganti ke "${DocStore.label()}": ${files.length} file PDF terindeks.`);
    } catch (e) { if (!(e && e.name === 'AbortError')) log(`⚠️ Gagal ganti folder: ${e.message}`); }
    refreshPanel();
  }
  async function cekBerkas() {
    await DocStore.restore();
    if (!DocStore.handle) { log('⚠️ Pilih folder dokumen dulu.'); return; }
    if (!(await DocStore.perm(true))) { log('⚠️ Izin folder ditolak/belum diberikan.'); return; }
    const files = await DocStore.ensureIndex(true);
    log(`🔎 Cek berkas: ${files.length} PDF di folder.`);
    const docs = getDocs();
    for (const n of [2, 3]) {
      if (!docs[n]) { log(`   Dokumen ${n}: (kosong -- slot dilewati)`); continue; }
      const f = DocStore.findNamed(docs[n]);
      log(`   Dokumen ${n}: ${f ? `OK -> ${f.path}` : `❌ TIDAK ADA ("${docs[n]}")`}`);
    }
    const q = jget(K.queue, []).map(itemFromQueue);
    let ok = 0;
    const miss = [];
    q.forEach((it) => { if (DocStore.findAkd(it.akd)) ok++; else miss.push(it.akd); });
    log(`   AKD: ${ok}/${q.length} file ketemu${miss.length ? `. Tidak ada: ${miss.slice(0, 15).join(', ')}${miss.length > 15 ? ` (+${miss.length - 15} lagi)` : ''}` : ''}`);
  }

  const UI_KEY = 'inaproc_mp4_ui';
  const PANEL_CSS = `
    #${PANEL_ID}{position:fixed;display:flex;flex-direction:column;background:#fff;border:1px solid #1F4E78;border-radius:10px;
      box-shadow:0 8px 28px rgba(0,0,0,.28);z-index:999999;font:12px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#1f2937;overflow:hidden;}
    #${PANEL_ID} *{box-sizing:border-box;}
    #${PANEL_ID} .hd{cursor:move;background:linear-gradient(135deg,#1F4E78,#2d6aa3);color:#fff;padding:9px 12px;display:flex;justify-content:space-between;align-items:center;user-select:none;flex-shrink:0;}
    #${PANEL_ID} .hd b{font-size:13px;letter-spacing:.2px;}
    #${PANEL_ID} .hd button{cursor:pointer;background:rgba(255,255,255,.18);color:#fff;border:none;border-radius:5px;width:24px;height:24px;font-weight:bold;}
    #${PANEL_ID} .hd button:hover{background:rgba(255,255,255,.32);}
    #${PANEL_ID} .bd{flex:1;min-height:0;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:8px;background:#f4f6f9;}
    #${PANEL_ID} .card{background:#fff;border:1px solid #dde3ea;border-radius:8px;padding:8px;display:flex;flex-direction:column;gap:6px;flex-shrink:0;}
    #${PANEL_ID} .card.grow{flex:1;min-height:110px;}
    #${PANEL_ID} .ttl{font-weight:700;color:#1F4E78;font-size:11px;text-transform:uppercase;letter-spacing:.4px;}
    #${PANEL_ID} .row{display:flex;gap:6px;align-items:center;}
    #${PANEL_ID} .row > *{flex:1;min-width:0;}
    #${PANEL_ID} label.f{display:flex;flex-direction:column;gap:2px;color:#4b5563;}
    #${PANEL_ID} input[type=text],#${PANEL_ID} textarea{width:100%;border:1px solid #c7d0db;border-radius:6px;padding:5px 7px;font:inherit;background:#fff;}
    #${PANEL_ID} textarea{resize:vertical;font-family:ui-monospace,Consolas,monospace;font-size:11px;}
    #${PANEL_ID} input:focus,#${PANEL_ID} textarea:focus{outline:2px solid #9cc3e6;border-color:#2d6aa3;}
    #${PANEL_ID} button.b{cursor:pointer;border:1px solid #c7d0db;background:#fff;color:#1f2937;border-radius:6px;padding:6px 8px;font:inherit;font-weight:600;}
    #${PANEL_ID} button.b:hover{background:#eef3f8;}
    #${PANEL_ID} button.b.pri{background:#1F4E78;border-color:#1F4E78;color:#fff;}
    #${PANEL_ID} button.b.pri:hover{background:#2d6aa3;}
    #${PANEL_ID} button.b.dng{background:#b42318;border-color:#b42318;color:#fff;}
    #${PANEL_ID} button.b.dng:hover{background:#d92d20;}
    #${PANEL_ID} .warn{background:#fff4e5;border:1px solid #f5c98b;color:#8a4b00;border-radius:6px;padding:5px 7px;}
    #${PANEL_ID} .muted{color:#6b7280;}
    #${PANEL_ID} .chk{display:flex;gap:6px;align-items:flex-start;}
    #${PANEL_ID} #mp4-status{line-height:1.6;}
    #${PANEL_ID} #mp4-log{flex:1;min-height:60px;overflow-y:auto;background:#0f172a;color:#d1e3f8;border-radius:6px;padding:6px;font:11px/1.45 ui-monospace,Consolas,monospace;}
    #${PANEL_ID} #mp4-log div{border-bottom:1px solid rgba(255,255,255,.06);padding:1px 0;word-break:break-word;}
    #${PANEL_ID} .rz{position:absolute;right:0;bottom:0;width:18px;height:18px;cursor:nwse-resize;
      background:linear-gradient(135deg,transparent 50%,#1F4E78 50%,#1F4E78 58%,transparent 58%,transparent 70%,#1F4E78 70%,#1F4E78 78%,transparent 78%);border-bottom-right-radius:9px;}
    #${PANEL_ID}.collapsed{height:auto!important;}
    #${PANEL_ID}.collapsed .bd,#${PANEL_ID}.collapsed .rz{display:none;}
  `;

  function buildPanel() {
    if (!document.body || document.getElementById(PANEL_ID)) return;
    if (!document.getElementById(PANEL_ID + '-css')) {
      const st = document.createElement('style');
      st.id = PANEL_ID + '-css';
      st.textContent = PANEL_CSS;
      (document.head || document.documentElement).appendChild(st);
    }
    const ui = Object.assign({ top: 70, left: null, width: 380, height: 620, collapsed: false }, jget(UI_KEY, {}));
    const clampUi = () => {
      ui.width = Math.min(Math.max(ui.width, 320), window.innerWidth - 10);
      ui.height = Math.min(Math.max(ui.height, 220), window.innerHeight - 10);
      if (ui.left === null) ui.left = Math.max(5, window.innerWidth - ui.width - 12);
      ui.left = Math.min(Math.max(ui.left, 0), Math.max(0, window.innerWidth - 80));
      ui.top = Math.min(Math.max(ui.top, 0), Math.max(0, window.innerHeight - 40));
    };
    clampUi();
    const saveUi = () => jset(UI_KEY, ui);

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    const docs = getDocs();
    const fl = getFlags();
    const esc = (v) => String(v || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    panel.innerHTML = `
      <div class="hd" id="mp4-header"><b>INAPROC Master Produk v4 · file lokal</b><button id="mp4-collapse" title="Ciutkan / buka">—</button></div>
      <div class="bd" id="mp4-body">
        <div class="card"><div id="mp4-status"></div></div>
        <div class="card">
          <div class="ttl">1 · Folder dokumen</div>
          <button class="b" id="mp4-folder">📁 Pilih / Izinkan Folder</button>
          <div class="row"><span id="mp4-folder-label" class="muted"></span><a href="#" id="mp4-folder-change" style="flex:0 0 auto;font-size:11px;">ganti folder</a></div>
          <div class="row">
            <label class="f">Dokumen 2 (nama file)<input type="text" id="mp4-doc2" value="${esc(docs[2])}"></label>
            <label class="f">Dokumen 3 (kosong = lewati)<input type="text" id="mp4-doc3" value="${esc(docs[3])}"></label>
          </div>
        </div>
        <div class="card">
          <div class="ttl">2 · Data (AKD ⇥ KFA, 1 baris = 1 SKU)</div>
          <textarea id="mp4-input" rows="5" placeholder="AKD 10703620035&#9;32010154"></textarea>
          <div class="row"><button class="b" id="mp4-load">Muat Antrian</button><button class="b" id="mp4-check">🔎 Cek Berkas</button></div>
        </div>
        <div class="card">
          <div class="ttl">3 · Jalankan</div>
          <label class="chk"><input type="checkbox" id="mp4-dry" ${fl.dryRun ? 'checked' : ''}><span>Dry run: isi form & berhenti setelah 1 SKU, <b>jangan kirim</b></span></label>
          <div class="warn">⚠️ Data masuk ke INAPROC sungguhan. Tes 1 SKU dengan dry run dulu.</div>
          <div class="row"><button class="b pri" id="mp4-start" style="flex:2">▶ Mulai / Lanjutkan</button><button class="b dng" id="mp4-stop">⏹ Stop</button></div>
        </div>
        <div class="card">
          <div class="ttl">4 · Hasil</div>
          <div class="row"><button class="b" id="mp4-copy">📋 Copy ke Sheet</button><button class="b" id="mp4-csv">⬇ CSV</button><button class="b" id="mp4-reset">🗑 Reset</button></div>
          <textarea id="mp4-preview" readonly rows="3" style="display:none"></textarea>
        </div>
        <div class="card grow"><div class="ttl">Log</div><div id="mp4-log"></div></div>
      </div>
      <div class="rz" id="mp4-resize" title="Tarik buat ubah ukuran"></div>`;
    document.body.appendChild(panel);

    const applyGeom = () => {
      panel.style.top = ui.top + 'px';
      panel.style.left = ui.left + 'px';
      panel.style.width = ui.width + 'px';
      panel.style.height = ui.height + 'px';
      panel.classList.toggle('collapsed', !!ui.collapsed);
      panel.querySelector('#mp4-collapse').textContent = ui.collapsed ? '▢' : '—';
    };
    applyGeom();

    const logBox = panel.querySelector('#mp4-log');
    jget(K.log, []).slice().reverse().forEach((l) => { const d = document.createElement('div'); d.textContent = l; logBox.prepend(d); });

    // Geser panel (pointer capture di header, jadi tidak ada listener global yang menumpuk)
    const header = panel.querySelector('#mp4-header');
    let mode = null, sx = 0, sy = 0, o = null;
    header.addEventListener('pointerdown', (e) => {
      if (e.target.id === 'mp4-collapse') return;
      mode = 'move'; sx = e.clientX; sy = e.clientY; o = { top: ui.top, left: ui.left };
      header.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    header.addEventListener('pointermove', (e) => {
      if (mode !== 'move') return;
      ui.left = o.left + e.clientX - sx;
      ui.top = o.top + e.clientY - sy;
      clampUi(); applyGeom();
    });
    const endDrag = () => { if (mode) { mode = null; saveUi(); } };
    header.addEventListener('pointerup', endDrag);
    header.addEventListener('pointercancel', endDrag);
    header.addEventListener('dblclick', (e) => { if (e.target.id !== 'mp4-collapse') panel.querySelector('#mp4-collapse').click(); });

    // Ubah ukuran panel (pegangan di pojok kanan-bawah)
    const rz = panel.querySelector('#mp4-resize');
    let rmode = false, rw = 0, rh = 0;
    rz.addEventListener('pointerdown', (e) => {
      rmode = true; sx = e.clientX; sy = e.clientY; rw = ui.width; rh = ui.height;
      rz.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    rz.addEventListener('pointermove', (e) => {
      if (!rmode) return;
      ui.width = rw + e.clientX - sx;
      ui.height = rh + e.clientY - sy;
      ui.width = Math.min(Math.max(ui.width, 320), window.innerWidth - ui.left - 4);
      ui.height = Math.min(Math.max(ui.height, 220), window.innerHeight - ui.top - 4);
      applyGeom();
    });
    const endResize = () => { if (rmode) { rmode = false; saveUi(); } };
    rz.addEventListener('pointerup', endResize);
    rz.addEventListener('pointercancel', endResize);
    window.addEventListener('resize', () => { clampUi(); applyGeom(); });

    panel.querySelector('#mp4-collapse').onclick = () => { ui.collapsed = !ui.collapsed; applyGeom(); saveUi(); };

    const input = panel.querySelector('#mp4-input');
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      e.preventDefault();
      const s0 = input.selectionStart, en = input.selectionEnd;
      input.value = input.value.slice(0, s0) + '\t' + input.value.slice(en);
      input.selectionStart = input.selectionEnd = s0 + 1;
    });
    panel.querySelector('#mp4-doc2').onchange = (e) => { const d = getDocs(); d[2] = e.target.value.trim(); jset(K.docs, d); };
    panel.querySelector('#mp4-doc3').onchange = (e) => { const d = getDocs(); d[3] = e.target.value.trim(); jset(K.docs, d); };
    panel.querySelector('#mp4-dry').onchange = (e) => { const f = getFlags(); f.dryRun = e.target.checked; jset(K.flags, f); log(f.dryRun ? 'Dry run ON' : '⚠️ Dry run OFF -- run berikutnya akan SUBMIT sungguhan'); };
    panel.querySelector('#mp4-folder').onclick = pilihFolder;
    panel.querySelector('#mp4-folder-change').onclick = (e) => { e.preventDefault(); gantiFolder(); };
    panel.querySelector('#mp4-check').onclick = cekBerkas;
    panel.querySelector('#mp4-load').onclick = () => {
      const hasResult = Object.values(jget(K.results, {})).some((r) => r.status === 'BERHASIL' || r.status === 'SUDAH-ADA');
      if (hasResult && !confirm('Antrian & hasil sebelumnya akan diganti. Pastikan hasil lama sudah di-copy ke Sheet. Lanjut?')) return;
      const r = loadBatch(input.value);
      log(`Antrian dimuat: ${r.queued} SKU diproses dari ${r.total} baris${r.invalid ? `, ${r.invalid} baris tidak valid` : ''}${r.dup ? `, ${r.dup} duplikat di input` : ''}.`);
      refreshPanel();
    };
    panel.querySelector('#mp4-start').onclick = startRun;
    panel.querySelector('#mp4-stop').onclick = () => stopRun('Dihentikan. Antrian tetap tersimpan -- klik "Mulai / Lanjutkan" buat lanjut.');
    panel.querySelector('#mp4-copy').onclick = copyHasil;
    panel.querySelector('#mp4-csv').onclick = downloadCsv;
    panel.querySelector('#mp4-reset').onclick = () => {
      if (!confirm('Reset antrian & hasil? (Tidak menghapus data yang sudah terkirim ke INAPROC.)')) return;
      [K.lines, K.queue, K.results, K.counters].forEach((k) => localStorage.removeItem(k));
      localStorage.setItem(K.run, '0');
      refreshPanel();
    };
    refreshPanel();
  }

  // =====================================================================
  // BOOT
  // =====================================================================
  function boot() {
    buildPanel();
    DocStore.restore().then(refreshPanel);
    if (isRunFlag()) {
      log('↻ Halaman dimuat, melanjutkan run...');
      setTimeout(runLoop, 1500);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  setInterval(() => { if (document.body && !document.getElementById(PANEL_ID)) buildPanel(); refreshPanel(); }, 3000);
})();