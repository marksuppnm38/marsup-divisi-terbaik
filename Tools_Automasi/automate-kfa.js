// ==UserScript==
// @name         KFA Alkes Automation - Pionir
// @namespace    pionir-marsup
// @version      2.0
// @description  Automasi SKU -> cangkang + validasi KFA di kamus-alkes.kemkes.go.id (v2.0: diagnosa lengkap, cek via RPC, layout guard, panel ringkas)
// @match        https://kamus-alkes.kemkes.go.id/*
// @grant        none
// ==/UserScript==
(function () {
  'use strict';
  // ============================================================
  // RINGKASAN CARA PAKAI
  //  1. Login manual. Paste antrian (TAB-separated), klik "Muat":
  //       KODE_PRODUK <TAB> NIE <TAB> TKDN <TAB> BRAND <TAB> KODE_CANGKANG(opsional, fill-down)
  //  2. Pilih mode lalu "Start" (panel otomatis ngeciut):
  //       D = mulai dari mana aja, cari cangkang by kode (wajib KODE_CANGKANG)
  //       C = per SKU di cangkang yang lagi dibuka (cek -> A+Save -> B)
  //       A = tag Type saja (batch)      B = validasi SKU pertama saja
  //  3. Test 1 SKU dulu (semua checkbox OFF). Data masuk ke sistem KFA nasional.
  //  4. Kalau gagal: klik "Diagnosa" -> paste hasilnya ke Claude.
  //  5. PENTING: lebar jendela (viewport) harus >= 768px. Di bawah itu Odoo 14
  //     pindah ke layout MOBILE (tab/tombol disembunyiin). Split screen? Zoom
  //     browser out (Ctrl + minus) sampai lebar >= 900px.
  // ============================================================
  const VERSION = '2.0';
  const STORAGE_KEY = 'kfa_automation_queue_v1';
  const RESULTS_KEY = 'kfa_automation_results_v1';
  const AUTORESUME_PROSES_A_KEY = 'kfa_autoresume_prosesA_v1';
  const AUTORESUME_PROSES_C_KEY = 'kfa_autoresume_prosesC_v1';
  const LOG_KEY = 'kfa_log_v2';
  const FAIL_KEY = 'kfa_lastfail_v2';
  const UI_KEY = 'kfa_ui_v2';
  // Fallback xpath (rawan berubah; dipakai HANYA kalau selector utama gagal)
  const VARIANTS_TAB_FALLBACK_XPATH = '/html/body/div[4]/div/div[2]/div/div[1]/div[2]/div[5]/div[1]/ul/li[5]/a';
  const BREADCRUMB_PARENT_XPATH = '/html/body/div[4]/div/div[1]/div[1]/div[1]/ol/li[2]/a';
  const CONFIGURE_PRODUCT_BUTTON_FALLBACK_XPATH = '/html/body/div[4]/div/div[2]/div/div[1]/div[1]/div[1]/button[8]/span';
  // Selector hasil capture (Odoo 14, kamus-alkes)
  const SEL = {
    configure: 'button[name="configure_product"], button[name="reconfigure_product"]',
    typeInput: '.o_field_many2manytags input.o_input, .o_field_many2manytags input[type="text"]',
    typeField: '.o_field_many2manytags, .o_field_widget[name="value_ids"]',
  };
  const BTN = {
    save: { sel: '.o_form_buttons_edit .o_form_button_save, .o_form_buttons_edit button.btn-primary', text: 'Save' },
    discard: { sel: '.o_form_buttons_edit .o_form_button_cancel, .o_form_buttons_edit button.btn-secondary', text: 'Discard' },
    edit: { sel: '.o_form_buttons_view .o_form_button_edit, .o_form_buttons_view button.btn-primary', text: 'Edit' },
  };
  const CONFIG = {
    BLOCKUI_STABLE_MS: 500,
    BLOCKUI_MAX_WAIT_MS: 45000,
    BLOCKUI_ABS_MAX_MS: 120000,       // batas mutlak total waktu nunggu overlay dalam satu waitUntil
    AUTOCOMPLETE_TIMEOUT_MS: 20000,
    MODAL_TIMEOUT_MS: 20000,
    NEXT_BUTTON_TIMEOUT_MS: 20000,
    VALIDATE_VISIBLE_TIMEOUT_MS: 25000,
    VALIDATE_ENABLED_TIMEOUT_MS: 25000,
    VALIDATE_DONE_TIMEOUT_MS: 30000,
    KFA_CODE_TIMEOUT_MS: 30000,
    MANUAL_VALIDATE_TIMEOUT_MS: 300000,
    RETRY_COUNT: 2,
    PROSES_A_RETRY_COUNT: 3,
    PROSES_A_TABLE_TIMEOUT_MS: 30000,
    PROSES_A_AUTOSAVE_EVERY: 5,
    STATUS_STALL_WARNING_MS: 30000,
    VARIANTS_TAB_WAIT_TIMEOUT_MS: 60000,
    TAGS_INPUT_RECLICK_INTERVAL_MS: 2500,
    SAVE_CONFIRM_TIMEOUT_MS: 40000,
    CANGKANG_NAV_TIMEOUT_MS: 40000,
    MIN_VIEWPORT_WIDTH: 768,          // di bawah ini Odoo 14 = layout mobile
    RECOMMENDED_WIDTH: 900,
    LOG_BUFFER_MAX: 400,
  };
  // ============================================================
  // STATE
  // ============================================================
  let scriptStatus = { running: false, label: 'Idle', sku: null, lastActivity: Date.now() };
  let stopRequested = false;
  let runLock = false;
  let prosesA_pendingSaveCount = 0;
  let activeCangkang = null;      // { code, id, name, explicit }
  let forceVariantsNext = false;
  let lastShell = null;           // { id, hash } halaman cangkang sebelum Proses B
  let lastFailure = null;
  const stepHistory = [];
  const cangkangCache = {};
  const CANGKANG_NAV = { ACTION: '393', MENU: '298', CIDS: '1' };
  let ui = { collapsed: false, top: 70, left: null, mode: 'D', debug: false,
    flags: { autovalidate: false, autosave: false, autonext: false, autosave5: true } };
  try { Object.assign(ui, JSON.parse(localStorage.getItem(UI_KEY) || '{}')); ui.flags = Object.assign({ autovalidate: false, autosave: false, autonext: false, autosave5: true }, ui.flags); } catch (e) { /* abaikan */ }
  const autoFlags = ui.flags;
  function saveUi() { try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch (e) { /* abaikan */ } }
  // ============================================================
  // LOG + DIAGNOSA
  // ============================================================
  let logBuf = [];
  try { logBuf = JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch (e) { logBuf = []; }
  let persistTimer = null;
  function persistLog() {
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      try { localStorage.setItem(LOG_KEY, JSON.stringify(logBuf.slice(-CONFIG.LOG_BUFFER_MAX))); } catch (e) { /* abaikan */ }
    }, 1000);
  }
  function fmtEntry(e) {
    return `[${new Date(e.t).toLocaleTimeString()}]${e.l === 'error' ? ' ✖' : e.l === 'debug' ? ' ·' : ''} ${e.m}`;
  }
  function appendLogLine(e) {
    const box = document.getElementById('kfa-log');
    if (!box || (e.l === 'debug' && !ui.debug)) return;
    const line = document.createElement('div');
    line.textContent = fmtEntry(e);
    if (e.l === 'error') line.style.color = '#b00020';
    else if (e.l === 'debug') line.style.color = '#777';
    box.prepend(line);
    while (box.childNodes.length > 150) box.removeChild(box.lastChild);
  }
  function log(msg, lvl = 'info') {
    scriptStatus.lastActivity = Date.now();
    const entry = { t: Date.now(), l: lvl, m: msg };
    logBuf.push(entry);
    if (logBuf.length > CONFIG.LOG_BUFFER_MAX * 1.5) logBuf.splice(0, logBuf.length - CONFIG.LOG_BUFFER_MAX);
    persistLog();
    console.log('[KFA-AUTO]', msg);
    appendLogLine(entry);
    updateStatusBar();
  }
  const dbg = (m) => log(m, 'debug');
  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
  function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function describeEl(el) {
    if (!el || !el.tagName) return 'null';
    const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + cls;
  }
  function visibleButtonTexts() {
    return Array.from(document.querySelectorAll('.o_control_panel button, .o_statusbar_buttons button, .modal button, .o_form_statusbar button'))
      .filter((b) => !b.closest('#kfa-panel') && isVisible(b))
      .map((b) => norm(b.textContent).slice(0, 28)).filter(Boolean).slice(0, 14);
  }
  function snapshotState() {
    const s = {};
    try {
      s.url = location.href;
      s.viewport = `${innerWidth}x${innerHeight}@${devicePixelRatio}`;
      s.odooMobileLayout = innerWidth < CONFIG.MIN_VIEWPORT_WIDTH;
      s.tabHidden = document.hidden;
      s.windowFocused = document.hasFocus();
      s.blockUI = isBlockUIVisible();
      s.editMode = isEditMode();
      s.modal = getUnexpectedModalText() || null;
      const tab = document.querySelector('.o_notebook .nav-link.active');
      s.activeTab = tab ? norm(tab.textContent) : null;
      const row = findTipeAttributeRowNow();
      s.tipeRow = !!row;
      s.tipeBadges = row ? row.querySelectorAll('.o_tag, .badge').length : null;
      s.tipeInput = !!(row && row.querySelector(SEL.typeInput));
      s.buttons = visibleButtonTexts();
      s.activeElement = describeEl(document.activeElement);
      const q = loadQueue();
      s.queueLen = q.length;
      s.queueHead = q[0] || null;
      s.cangkang = activeCangkang;
      s.status = scriptStatus.label;
      s.recentSteps = stepHistory.slice(-12).map((x) => `${new Date(x.t).toLocaleTimeString()} ${x.label}${x.sku ? ' [' + x.sku + ']' : ''}`);
    } catch (e) { s.snapshotError = String(e); }
    return s;
  }
  function compactState(s) {
    return `viewport ${s.viewport}${s.odooMobileLayout ? ' ⚠MOBILE-LAYOUT' : ''} | edit=${s.editMode} | blockUI=${s.blockUI} | tab=${s.activeTab} | tipeRow=${s.tipeRow} badges=${s.tipeBadges} input=${s.tipeInput} | modal=${s.modal || '-'} | hidden=${s.tabHidden} focus=${s.windowFocused} | btn=[${(s.buttons || []).join(' / ')}]`;
  }
  // Catat kegagalan + snapshot kondisi halaman. Return null biar bisa `return fail(...)`.
  function fail(msg) {
    log('⚠️ ' + msg, 'error');
    const state = snapshotState();
    lastFailure = { time: new Date().toISOString(), version: VERSION, msg, state, log: logBuf.slice(-60).map(fmtEntry) };
    try { localStorage.setItem(FAIL_KEY, JSON.stringify(lastFailure)); } catch (e) { /* abaikan */ }
    log('🩺 ' + compactState(state), 'error');
    console.warn('[KFA-AUTO] FAIL:', msg, state);
    return null;
  }
  async function safe(name, fn) {
    try { return await fn(); } catch (e) {
      console.error(e);
      fail(`Exception di ${name}: ${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e}`);
      setIdle(`Berhenti (exception di ${name})`);
      return null;
    }
  }
  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
    } catch (e) { /* lanjut fallback */ }
    const tmp = document.createElement('textarea');
    tmp.value = text; tmp.style.cssText = 'position:fixed;opacity:0;';
    document.body.appendChild(tmp); tmp.focus(); tmp.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(tmp);
    return ok;
  }
  async function copyDiagnosa() {
    let fl = lastFailure;
    if (!fl) { try { fl = JSON.parse(localStorage.getItem(FAIL_KEY) || 'null'); } catch (e) { fl = null; } }
    const payload = {
      script: VERSION, takenAt: new Date().toISOString(), nowState: snapshotState(),
      lastFailure: fl, recentLog: logBuf.slice(-80).map(fmtEntry),
    };
    const ok = await copyText(JSON.stringify(payload, null, 1));
    log(ok ? '🩺 Diagnosa ke-copy ke clipboard -- paste ke Claude.' : '⚠️ Gagal copy diagnosa (browser nolak). Lihat console (F12).', ok ? 'info' : 'error');
    if (!ok) console.log('[KFA-AUTO] DIAGNOSA', payload);
  }
  // ============================================================
  // STATUS BAR + LAYOUT GUARD
  // ============================================================
  function setStatus(label, sku) {
    scriptStatus.running = true;
    scriptStatus.label = label;
    if (sku !== undefined) scriptStatus.sku = sku;
    scriptStatus.lastActivity = Date.now();
    stepHistory.push({ t: Date.now(), label, sku: scriptStatus.sku });
    if (stepHistory.length > 60) stepHistory.shift();
    dbg('▸ ' + label + (scriptStatus.sku ? ` [${scriptStatus.sku}]` : ''));
    updateStatusBar();
  }
  function setIdle(label = 'Idle') {
    scriptStatus.running = false;
    scriptStatus.label = label;
    scriptStatus.sku = null;
    scriptStatus.lastActivity = Date.now();
    runLock = false;
    if (/^(Berhenti|Selesai|Dihentikan)/.test(label)) { log('■ ' + label); setCollapsed(false); }
    updateStatusBar();
  }
  function updateStatusBar() {
    const dot = document.getElementById('kfa-status-dot');
    const text = document.getElementById('kfa-status-text');
    const mini = document.getElementById('kfa-mini-text');
    if (!dot || !text) return;
    const secs = Math.floor((Date.now() - scriptStatus.lastActivity) / 1000);
    const blocked = isBlockUIVisible();
    const narrow = innerWidth < CONFIG.MIN_VIEWPORT_WIDTH;
    let color = '#999', msg, short;
    if (!scriptStatus.running) { msg = `⏸ ${scriptStatus.label}`; short = scriptStatus.label; }
    else if (blocked) { color = '#e0a800'; msg = '⏳ Server lagi loading (overlay) -- wajar, nunggu...'; short = 'loading server...'; }
    else if (secs > CONFIG.STATUS_STALL_WARNING_MS / 1000) { color = '#dc3545'; msg = `⚠️ Diam ${secs}d tanpa overlay -- mungkin macet. Klik Diagnosa.`; short = `diam ${secs}d ⚠`; }
    else { color = '#28a745'; msg = `🟢 ${scriptStatus.label} (${secs}d lalu)`; short = scriptStatus.label; }
    if (scriptStatus.sku) { msg += ` | ${scriptStatus.sku}`; short += ` | ${scriptStatus.sku}`; }
    if (document.hidden) msg += ' | ⚠ tab nggak kelihatan (timer di-throttle)';
    msg += `\n📐 ${innerWidth}px${narrow ? ' ⚠ <768 = layout MOBILE, zoom out / fullscreen!' : ''}`;
    dot.style.color = color;
    text.textContent = msg;
    text.style.color = narrow ? '#b00020' : color;
    if (mini) mini.textContent = short.length > 38 ? short.slice(0, 36) + '…' : short;
  }
  setInterval(() => { if (!document.hidden) updateStatusBar(); }, 1000);
  function layoutOk() {
    const w = innerWidth;
    if (w >= CONFIG.MIN_VIEWPORT_WIDTH) {
      if (w < CONFIG.RECOMMENDED_WIDTH) log(`ℹ️ Lebar viewport ${w}px -- masih layout desktop, tapi sempit. Kalau sering gagal, zoom out (Ctrl -) atau fullscreen.`);
      return true;
    }
    log(`⚠️ Lebar viewport ${w}px < ${CONFIG.MIN_VIEWPORT_WIDTH}px: Odoo pindah ke layout MOBILE (tab/tombol dipindah/disembunyiin) -- ini penyebab utama script beda hasil di split screen vs fullscreen. Zoom out (Ctrl + minus) sampai lebar >= ${CONFIG.RECOMMENDED_WIDTH}px.`, 'error');
    return confirm(`Lebar jendela ${w}px < ${CONFIG.MIN_VIEWPORT_WIDTH}px -> Odoo pakai layout MOBILE, script rawan gagal.\n\nSaran: zoom out (Ctrl + minus) atau fullscreen.\n\nTetap lanjut?`);
  }
  // ============================================================
  // DOM HELPERS
  // ============================================================
  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
  const _bu = { t: 0, v: false };
  function isBlockUIVisible() {
    const now = Date.now();
    if (now - _bu.t < 100) return _bu.v;   // cache: hemat layout reflow di halaman yang berat
    const overlays = document.querySelectorAll('.blockUI.blockOverlay, .blockUI, .o_blockUI');
    _bu.v = Array.from(overlays).some((el) => {
      const st = window.getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden') return false;
      return el.offsetWidth > 0 && el.offsetHeight > 0;
    });
    _bu.t = now;
    return _bu.v;
  }
  // Tunggu sampai fn() truthy. Return nilainya, atau null kalau timeout.
  // Waktu blockUI TIDAK dihitung ke timeout (dengan batas mutlak).
  async function waitUntil(label, fn, { timeout = 8000, interval = 150, pauseOnBlockUI = true, logEvery = 0 } = {}) {
    const start = Date.now();
    let blocked = 0, last = Date.now(), lastLog = 0;
    while (true) {
      const now = Date.now();
      const dt = now - last;
      last = now;
      if (pauseOnBlockUI && isBlockUIVisible()) {
        blocked += dt;
        if (blocked > CONFIG.BLOCKUI_ABS_MAX_MS) { dbg(`⏱ "${label}": overlay nyangkut > ${Math.round(blocked / 1000)}d, nyerah.`); return null; }
        await sleep(interval);
        continue;
      }
      let r = null;
      try { r = fn(); if (r && typeof r.then === 'function') r = await r; } catch (e) { r = null; dbg(`waitUntil "${label}" error: ${e && e.message}`); }
      if (r) return r;
      const el = now - start - blocked;
      if (el > timeout) { dbg(`⏱ timeout "${label}" setelah ${Math.round(el / 1000)}d (overlay ${Math.round(blocked / 1000)}d)`); return null; }
      if (logEvery && el - lastLog >= logEvery) { lastLog = el; log(`⏳ nunggu ${label} (${Math.round(el / 1000)}d)...`); }
      await sleep(interval);
    }
  }
  async function waitForBlockUIClear({ timeout = CONFIG.BLOCKUI_MAX_WAIT_MS, stableFor = CONFIG.BLOCKUI_STABLE_MS, logIfWaiting = true } = {}) {
    const start = Date.now();
    let clearSince = null, logged = false;
    while (Date.now() - start < timeout) {
      if (!isBlockUIVisible()) {
        if (!clearSince) clearSince = Date.now();
        if (Date.now() - clearSince >= stableFor) return true;
      } else {
        if (logIfWaiting && !logged) { log('⏳ Overlay loading kedetect, nunggu beres (wajar).'); logged = true; }
        clearSince = null;
      }
      await sleep(150);
    }
    return false;
  }
  async function settleAfterAction(label = '') {
    await sleep(200);
    const cleared = await waitForBlockUIClear();
    if (!cleared) log(`⚠️ Overlay loading nggak ilang2${label ? ` (setelah "${label}")` : ''} -- server lemot/request nyangkut. Cek manual.`, 'error');
    return cleared;
  }
  async function withRetry(fn, { retries = CONFIG.RETRY_COUNT, label = 'step' } = {}) {
    let last = null;
    for (let a = 0; a <= retries; a++) {
      if (a > 0) {
        log(`🔁 Retry ${a}/${retries}: ${label}`);
        await waitForBlockUIClear({ logIfWaiting: false });
        await sleep(400);
      }
      try { last = await fn(); } catch (e) {
        console.error(e);
        log(`💥 Error di "${label}" (attempt ${a}): ${e && e.message ? e.message : e}`, 'error');
        last = null;
      }
      if (last) return last;
    }
    return last;
  }
  function setNativeValue(el, value) {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
    if (setter) setter.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  // Klik sintetis lengkap (pointer+mouse+click) langsung ke ELEMEN -- tanpa
  // elementFromPoint, jadi nggak peduli elemen lagi di luar layar / ketutup panel.
  function fireClick(el) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = Math.min(Math.max(r.left + Math.min(r.width / 2, 30), 1), Math.max(innerWidth - 1, 1));
    const y = Math.min(Math.max(r.top + r.height / 2, 1), Math.max(innerHeight - 1, 1));
    const init = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, button: 0, detail: 1 };
    try { el.dispatchEvent(new PointerEvent('pointerdown', init)); } catch (e) { /* abaikan */ }
    el.dispatchEvent(new MouseEvent('mousedown', init));
    try { el.dispatchEvent(new PointerEvent('pointerup', init)); } catch (e) { /* abaikan */ }
    el.dispatchEvent(new MouseEvent('mouseup', init));
    el.dispatchEvent(new MouseEvent('click', init));
  }
  // Klik by teks. Elemen di panel script sendiri SELALU di-exclude.
  function clickByText(selector, text, { visibleOnly = false } = {}) {
    const target = norm(text);
    let els = Array.from(document.querySelectorAll(selector)).filter((el) => !el.closest('#kfa-panel'));
    if (visibleOnly) els = els.filter((el) => isVisible(el.closest('button') || el));
    const match = els.find((el) => norm(el.textContent) === target) || els.find((el) => norm(el.textContent).includes(target));
    if (!match) return false;
    const t = match.closest('button') || match;
    if (t.disabled || t.classList?.contains('disabled')) return false;
    t.click();
    return true;
  }
  function findBtn(kind) {
    const d = BTN[kind];
    const bySel = Array.from(document.querySelectorAll(d.sel)).filter((e) => !e.closest('#kfa-panel') && isVisible(e));
    if (bySel.length) return bySel[0];
    return Array.from(document.querySelectorAll('button')).find((b) => !b.closest('#kfa-panel') && !b.closest('.modal') && norm(b.textContent) === d.text && isVisible(b)) || null;
  }
  function clickBtn(kind) {
    const b = findBtn(kind);
    if (!b || b.disabled || b.classList.contains('disabled')) return false;
    b.click();
    return true;
  }
  function isEditMode() { return !!(findBtn('save') || findBtn('discard')); }
  function hasVisibleValidateButton() { return !!getVisibleValidateButtonEl(); }
  function getVisibleValidateButtonEl() {
    const m = Array.from(document.querySelectorAll('span')).find((el) => el.textContent.trim() === 'Validate' && isVisible(el) && !el.closest('#kfa-panel'));
    return m ? (m.closest('button') || m) : null;
  }
  function isBtnDisabled(el) {
    return !!(el.disabled || el.classList?.contains('disabled') || el.classList?.contains('o_disabled') || el.getAttribute?.('aria-disabled') === 'true');
  }
  function isValidKfaCode(text) {
    const t = (text || '').trim();
    return !!t && t !== '/' && t !== '-' && t !== '—';
  }
  function getElementByXPath(xpath) {
    try { return document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue; } catch (e) { return null; }
  }
  // ---- modal tak terduga (duplikat dll) ----
  function getUnexpectedModals() {
    return Array.from(document.querySelectorAll('.modal.show, .o_dialog, .modal[style*="display: block"], .modal[style*="display:block"]')).filter(isVisible);
  }
  function isUnexpectedModalVisible() { return getUnexpectedModals().length > 0; }
  function getUnexpectedModalText() {
    const m = getUnexpectedModals();
    return m.length ? norm(m[0].textContent).slice(0, 300) : '';
  }
  function dismissUnexpectedModal() {
    const m = getUnexpectedModals();
    if (!m.length) return false;
    const b = Array.from(m[0].querySelectorAll('button')).find(isVisible);
    if (b) { b.click(); return true; }
    return false;
  }
  // ============================================================
  // AUTOCOMPLETE
  // ============================================================
  function collectCandidateMenus() {
    return new Set(document.querySelectorAll('.ui-autocomplete, .ui-autocomplete-menu, .o-autocomplete--dropdown-menu, .dropdown-menu, [role="listbox"], [role="menu"]'));
  }
  function isNearInput(el, inputEl, maxDist = 400) {
    const r = el.getBoundingClientRect(), ir = inputEl.getBoundingClientRect();
    return Math.min(Math.abs(r.top - ir.bottom), Math.abs(ir.top - r.bottom)) < maxDist;
  }
  // Cuma terima: item PERSIS sama, atau opsi Create "TEKS PERSIS SAMA". Selain itu null (nggak nebak).
  function findAutocompleteTarget(items, text) {
    const exact = items.find((li) => norm(li.textContent) === text);
    if (exact) return { target: exact, isCreate: false };
    const create = items.find((li) => {
      const t = norm(li.textContent);
      return t === `Create "${text}"` || t === `Create "${text}"...` || t === `Buat "${text}"`;
    });
    return create ? { target: create, isCreate: true } : { target: null, isCreate: false };
  }
  async function fillAutocomplete(inputEl, text) {
    await waitForBlockUIClear({ logIfWaiting: false });
    if (!inputEl || !inputEl.isConnected) { log(`Input buat "${text}" udah lepas dari halaman (di-render ulang).`, 'error'); return false; }
    inputEl.focus();
    const before = collectCandidateMenus();
    setNativeValue(inputEl, text);
    inputEl.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: text.slice(-1) }));
    inputEl.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: text.slice(-1) }));
    let menu = await waitUntil(`autocomplete "${text}"`, () => {
      for (const m of document.querySelectorAll('.ui-autocomplete, .ui-autocomplete-menu')) {
        if (isVisible(m) && m.querySelectorAll('li').length && isNearInput(m, inputEl)) return m;
      }
      return null;
    }, { timeout: CONFIG.AUTOCOMPLETE_TIMEOUT_MS });
    if (!menu) {
      menu = await waitUntil(`dropdown baru "${text}"`, () => {
        for (const el of collectCandidateMenus()) {
          if (!before.has(el) && isVisible(el) && isNearInput(el, inputEl) && el.querySelectorAll('li, [role="option"], .dropdown-item').length) return el;
        }
        return null;
      }, { timeout: 4000 });
    }
    if (!menu) {
      log(`⚠️ Autocomplete nggak muncul buat "${text}".`, 'error');
      console.log('[KFA-AUTO] input:', inputEl, 'value:', inputEl.value, 'rect:', inputEl.getBoundingClientRect());
      return false;
    }
    const items = Array.from(menu.querySelectorAll('li, [role="option"], .dropdown-item'));
    const { target, isCreate } = findAutocompleteTarget(items, text);
    if (!target) {
      log(`⚠️ Nggak ada item autocomplete yang PERSIS "${text}" -- berhenti daripada nebak. Opsi yang muncul: ${items.map((li) => norm(li.textContent)).slice(0, 8).join(' | ')}`, 'error');
      return false;
    }
    if (isCreate) log(`📌 "${text}" belum terdaftar -- script bikin value BARU (permanen di sistem KFA nasional).`);
    (target.querySelector('a') || target).click();
    await settleAfterAction(`pilih "${text}"`);
    return true;
  }
  // ============================================================
  // STORAGE
  // ============================================================
  function loadQueue() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch (e) { return []; } }
  function saveQueue(q) { localStorage.setItem(STORAGE_KEY, JSON.stringify(q)); }
  function loadResults() { try { return JSON.parse(localStorage.getItem(RESULTS_KEY) || '[]'); } catch (e) { return []; } }
  function saveResults(r) { localStorage.setItem(RESULTS_KEY, JSON.stringify(r)); }
  function getResultCangkang() { return (activeCangkang && activeCangkang.code) || ''; }
  function pushResult(kodeProduk, kfaCode) {
    const r = loadResults();
    r.push({ kodeProduk, kfaCode, timestamp: new Date().toISOString(), cangkang: getResultCangkang() });
    saveResults(r);
  }
  function shiftQueueIf(kodeProduk) {
    const q = loadQueue();
    if (q.length && q[0].kodeProduk === kodeProduk) { q.shift(); saveQueue(q); refreshPanel(); return q.length; }
    return null;
  }
  // ============================================================
  // RPC (pakai sesi login yang sama) -- baca status SERVER, bukan DOM
  // ============================================================
  async function odooRpc(model, method, kwargs = {}, args = [], timeoutMs = 20000) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const kw = Object.assign({ context: { lang: 'en_US' } }, kwargs);
      const resp = await fetch(`/web/dataset/call_kw/${model}/${method}`, {
        method: 'POST', credentials: 'same-origin', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { model, method, args, kwargs: kw } }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      if (json.error) throw new Error((json.error.data && json.error.data.message) || json.error.message || 'RPC error');
      return json.result;
    } finally { clearTimeout(to); }
  }
  async function getTypeLine(shellId) {
    const lines = await odooRpc('product.template.attribute.line', 'search_read', {
      domain: [['product_tmpl_id', '=', Number(shellId)]], fields: ['attribute_id', 'value_ids'],
    });
    return (lines || []).find((l) => l.attribute_id && /^(tipe|type)\b/i.test(String(l.attribute_id[1]).trim())) || null;
  }
  // Status SKU di value "Tipe (Type)" cangkang (yang SUDAH ke-save di server).
  async function skuStatusInShell(sku, shellId) {
    const line = await getTypeLine(shellId);
    if (!line) return { noLine: true };
    const vals = await odooRpc('product.attribute.value', 'search_read', {
      domain: [['attribute_id', '=', line.attribute_id[0]], ['name', '=', sku]], fields: ['id', 'name'], limit: 10,
    });
    const ids = (vals || []).map((v) => v.id);
    return { tagCount: line.value_ids.length, existsGlobally: ids.length > 0, inShell: ids.some((id) => line.value_ids.includes(id)) };
  }
  function getShellIdFromHash() {
    const h = getHashParams();
    return h.get('model') === 'product.template' && h.get('view_type') === 'form' ? h.get('id') : null;
  }
  // ============================================================
  // CEK CANGKANG (tabel attribute "Tipe (Type)")
  // ============================================================
  function findAttributeTableNow() {
    return Array.from(document.querySelectorAll('table')).find((t) => {
      const h = (t.querySelector('thead')?.textContent || t.rows[0]?.textContent || '').toLowerCase();
      return h.includes('attribute') && h.includes('value');
    }) || null;
  }
  function findTipeAttributeRowNow() {
    const table = findAttributeTableNow();
    if (!table) return null;
    return Array.from(table.querySelectorAll('tbody tr, tr')).find((tr) =>
      Array.from(tr.querySelectorAll('td')).some((c) => {
        const t = c.textContent.trim().toLowerCase();
        return t.startsWith('tipe') || t.startsWith('type');
      })) || null;
  }
  function getExistingTypeTagsText(row) {
    const field = row && row.querySelector(SEL.typeField);
    if (!field) return [];
    const labels = Array.from(field.querySelectorAll('.o_tag_badge_text'));
    if (labels.length) return labels.map((e) => norm(e.textContent)).filter(Boolean);
    return Array.from(field.querySelectorAll('.o_tag, .badge')).map((b) => norm(b.textContent).replace(/[×xX]\s*$/, '').trim()).filter(Boolean);
  }
  // true / false / null(nggak bisa mastiin). Utamakan RPC, fallback baca DOM.
  async function checkSkuInCangkang(kode) {
    const id = getShellIdFromHash();
    if (id) {
      try {
        const s = await skuStatusInShell(kode, id);
        if (s && !s.noLine) { dbg(`RPC: "${kode}" inShell=${s.inShell} existsGlobally=${s.existsGlobally} (tag cangkang: ${s.tagCount})`); return s.inShell; }
      } catch (e) { log(`ℹ️ Cek via server gagal (${e.message}) -- fallback baca tabel di layar.`); }
    }
    const row = await waitUntil('baris Tipe (Type)', findTipeAttributeRowNow, { timeout: CONFIG.PROSES_A_TABLE_TIMEOUT_MS });
    if (!row) return null;
    return getExistingTypeTagsText(row).includes(kode);
  }
  async function confirmTagSaved(sku) {
    const id = getShellIdFromHash();
    let rpcBroken = !id;
    if (id) {
      const r = await waitUntil(`tag "${sku}" ke-save di server`, async () => {
        try { const s = await skuStatusInShell(sku, id); return s && s.inShell ? 'ok' : null; } catch (e) { rpcBroken = true; return 'rpcfail'; }
      }, { timeout: CONFIG.SAVE_CONFIRM_TIMEOUT_MS, interval: 1500, pauseOnBlockUI: false, logEvery: 6000 });
      if (r === 'ok') {
        await waitUntil('form balik read-only', () => !isEditMode(), { timeout: 8000 });
        return true;
      }
      if (r !== 'rpcfail') return false;
    }
    if (rpcBroken) log('ℹ️ Konfirmasi via server nggak bisa -- pakai deteksi tombol Save ilang.');
    return waitForSaveButtonGone();
  }
  async function waitForSaveButtonGone({ timeout = CONFIG.SAVE_CONFIRM_TIMEOUT_MS } = {}) {
    const r = await waitUntil('tombol Save ilang (form read-only)', () => !isEditMode(), { timeout, interval: 250, logEvery: 4000 });
    return !!r;
  }
  // ============================================================
  // TAB VARIANTS
  // ============================================================
  async function waitForVariantsTabAndClick({ timeout = CONFIG.VARIANTS_TAB_WAIT_TIMEOUT_MS } = {}) {
    const r = await waitUntil('tab "Variants"', () => {
      const a = Array.from(document.querySelectorAll('.o_notebook a.nav-link, ul.nav-tabs a.nav-link, a[role="tab"]'))
        .find((x) => !x.closest('#kfa-panel') && norm(x.textContent) === 'Variants' && isVisible(x));
      if (a) { if (!a.classList.contains('active')) a.click(); return 'text'; }
      const fb = getElementByXPath(VARIANTS_TAB_FALLBACK_XPATH);
      if (fb && isVisible(fb) && /variants/i.test(fb.textContent)) { fb.click(); return 'xpath'; }
      return null;
    }, { timeout, interval: 400, logEvery: 5000 });
    if (r) log(`✅ Tab "Variants" aktif (via ${r}).`);
    return !!r;
  }
  // ============================================================
  // PINDAH CANGKANG BY KODE
  // ============================================================
  function getHashParams() { return new URLSearchParams(location.hash.replace(/^#/, '')); }
  function readShellCodeFromDom() {
    const els = Array.from(document.querySelectorAll('.o_form_view [name="kfa_pv_code"]')).filter((el) => !el.closest('#kfa-panel'));
    for (const el of els) {
      const raw = el.tagName === 'INPUT' ? el.value : (el.querySelector('input') ? el.querySelector('input').value : el.textContent);
      const t = norm(raw);
      if (t) return t;
    }
    return null;
  }
  function isOnShellPage(code, id) {
    const h = getHashParams();
    if (h.get('model') !== 'product.template' || h.get('view_type') !== 'form') return false;
    if (id && String(h.get('id')) !== String(id)) return false;
    return readShellCodeFromDom() === String(code).trim();
  }
  function syncActiveCangkangFromPage() {
    const id = getShellIdFromHash();
    if (id) { const code = readShellCodeFromDom(); activeCangkang = code ? { code, id, name: null, explicit: false } : null; } else activeCangkang = null;
  }
  async function lookupCangkangByCode(code) {
    if (cangkangCache[code]) return Object.assign({ ok: true }, cangkangCache[code]);
    const rows = await odooRpc('product.template', 'search_read', { domain: [['kfa_pv_code', '=', code]], fields: ['id', 'name', 'kfa_pv_code'], limit: 5 });
    if (!rows || !rows.length) return { ok: false, reason: 'notfound' };
    if (rows.length > 1) return { ok: false, reason: 'ambiguous', rows };
    cangkangCache[code] = { id: rows[0].id, name: rows[0].name };
    return { ok: true, id: rows[0].id, name: rows[0].name };
  }
  async function navigateToShellByHash(code, id) {
    const cur = getHashParams();
    const keep = cur.get('model') === 'product.template';
    const action = (keep && cur.get('action')) || CANGKANG_NAV.ACTION;
    const menu = (keep && cur.get('menu_id')) || CANGKANG_NAV.MENU;
    const cids = (keep && cur.get('cids')) || CANGKANG_NAV.CIDS;
    location.hash = `id=${id}&action=${action}&model=product.template&view_type=form&cids=${cids}&menu_id=${menu}`;
    await sleep(400);
    const loaded = await waitUntil(`form cangkang ${code} kebuka`, () => isOnShellPage(code, id), { timeout: CONFIG.CANGKANG_NAV_TIMEOUT_MS });
    if (!loaded) {
      if (isUnexpectedModalVisible()) log(`⚠️ Ada dialog pas pindah cangkang: "${getUnexpectedModalText()}"`, 'error');
      return false;
    }
    await settleAfterAction('pindah cangkang (hash)');
    await sleep(300);
    return isOnShellPage(code, id);
  }
  async function navigateToShellViaSearchUI(code) {
    log(`🔎 (fallback) cari "${code}" lewat search bar list Product Template...`);
    location.hash = `action=${CANGKANG_NAV.ACTION}&model=product.template&view_type=list&cids=${CANGKANG_NAV.CIDS}&menu_id=${CANGKANG_NAV.MENU}`;
    await sleep(500);
    await settleAfterAction('buka list Product Template');
    const findInput = () => { const el = document.querySelector('.o_control_panel .o_searchview_input'); return el && isVisible(el) ? el : null; };
    const input = await waitUntil('search bar list', findInput, { timeout: CONFIG.CANGKANG_NAV_TIMEOUT_MS });
    if (!input) { log('⚠️ Search bar list Product Template nggak ketemu.', 'error'); return false; }
    for (let i = 0; i < 5; i++) {
      const rm = document.querySelector('.o_control_panel .o_searchview_facet .o_facet_remove');
      if (!rm) break;
      rm.click(); await sleep(300); await settleAfterAction('hapus facet search');
    }
    const box = findInput() || input;
    box.focus(); setNativeValue(box, code); await sleep(500);
    ['keydown', 'keyup'].forEach((type) => box.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true })));
    await sleep(400);
    await settleAfterAction('search kode cangkang');
    const row = await waitUntil(`baris cangkang ${code}`, () => Array.from(document.querySelectorAll('.o_list_view tbody tr.o_data_row')).find((tr) => {
      const td = tr.querySelector('td[name="kfa_pv_code"]');
      return td && td.textContent.trim() === code;
    }), { timeout: CONFIG.CANGKANG_NAV_TIMEOUT_MS });
    if (!row) { log(`⚠️ Baris dengan Kode KFA (PV) persis "${code}" nggak ketemu di list.`, 'error'); return false; }
    (row.querySelector('td[name="name"]') || row.querySelector('td.o_data_cell') || row).click();
    const loaded = await waitUntil('form cangkang kebuka (search)', () => isOnShellPage(code, null), { timeout: CONFIG.CANGKANG_NAV_TIMEOUT_MS });
    if (!loaded) return false;
    await settleAfterAction('buka cangkang dari hasil search');
    return true;
  }
  async function ensureOnCangkang(codeRaw, { variantsTab = true, saveBeforeLeave = false } = {}) {
    const code = String(codeRaw || '').trim();
    if (!code) return true;
    let navigated = false;
    const cached = cangkangCache[code];
    if (!isOnShellPage(code, cached ? cached.id : null)) {
      setStatus(`Pindah cangkang: ${code}`, null);
      if (isEditMode()) {
        if (!saveBeforeLeave) { fail(`Mau pindah ke cangkang "${code}" tapi halaman masih mode edit (tombol Save kelihatan). Save/Discard dulu manual.`); return false; }
        log('💾 Form masih mode edit -- Save dulu biar tag yang numpuk nggak ilang...');
        if (!clickBtn('save')) { fail('Tombol Save nggak bisa diklik sebelum pindah cangkang.'); return false; }
        await settleAfterAction('save sebelum pindah cangkang');
        if (!(await waitForSaveButtonGone())) { fail('Tombol Save nggak ilang setelah diklik -- belum aman pindah cangkang.'); return false; }
        prosesA_pendingSaveCount = 0;
      }
      let ok = false, info = null;
      try { info = await lookupCangkangByCode(code); } catch (e) { log(`⚠️ Cari kode cangkang via server gagal (${e.message}) -- fallback search bar.`); }
      if (info && info.ok) {
        log(`🔎 Cangkang "${code}" ketemu: ${info.name} (id ${info.id}).`);
        ok = await navigateToShellByHash(code, info.id);
        if (!ok) log('⚠️ Pindah via URL hash gagal -- fallback search bar.', 'error');
      } else if (info && info.reason === 'notfound') { fail(`Cangkang dengan Kode KFA (PV) "${code}" NGGAK ketemu. Typo di kolom KODE_CANGKANG?`); return false; }
      else if (info && info.reason === 'ambiguous') { fail(`Kode "${code}" cocok ke ${info.rows.length} cangkang (id: ${info.rows.map((r) => r.id).join(', ')}) -- nggak berani milih.`); return false; }
      if (!ok) ok = await navigateToShellViaSearchUI(code);
      if (!ok) { fail(`Gagal pindah ke cangkang "${code}".`); return false; }
      navigated = true;
      log(`✅ Sekarang di cangkang "${code}".`);
    }
    const known = cangkangCache[code];
    activeCangkang = { code, id: (known && known.id) || getHashParams().get('id'), name: known ? known.name : null, explicit: true };
    if (variantsTab && (navigated || forceVariantsNext)) {
      forceVariantsNext = false;
      if (!(await waitForVariantsTabAndClick())) { fail(`Tab "Variants" nggak ketemu di cangkang "${code}".`); return false; }
      await settleAfterAction('tab Variants');
    }
    return true;
  }
  async function prepareCangkangForItem(item, opts) {
    if (item.cangkang) return ensureOnCangkang(item.cangkang, opts);
    syncActiveCangkangFromPage();
    return true;
  }
  // ============================================================
  // PROSES A -- tambah SKU ke tag "Tipe (Type)" cangkang
  // ============================================================
  // Klik LANGSUNG ke cell Values baris Tipe (persis kayak klik manual di capture),
  // dan baris di-query ULANG tiap iterasi (Odoo me-replace <tr> pas row masuk mode edit).
  async function activateTypeInput() {
    let start = Date.now(), lastTick = Date.now(), lastClick = 0, attempts = 0;
    while (true) {
      const now = Date.now();
      if (isBlockUIVisible()) { start += now - lastTick; lastTick = now; await sleep(200); continue; }
      lastTick = now;
      if (now - start > CONFIG.AUTOCOMPLETE_TIMEOUT_MS) break;
      const row = findTipeAttributeRowNow();
      if (row) {
        const input = row.querySelector(SEL.typeInput);
        if (input && input.isConnected && !input.disabled && !input.readOnly) { input.focus(); return input; }
        if (now - lastClick >= CONFIG.TAGS_INPUT_RECLICK_INTERVAL_MS) {
          lastClick = now; attempts += 1;
          const field = row.querySelector(SEL.typeField);
          const td = (field && field.closest('td')) || Array.from(row.querySelectorAll('td.o_data_cell')).pop();
          if (td) {
            td.scrollIntoView({ block: 'center' });
            fireClick(attempts % 2 === 1 ? td : (field || td));
            dbg(`🖱️ klik cell Values "Tipe (Type)" (percobaan ${attempts})`);
          }
        }
      }
      await sleep(200);
    }
    fail(`Input tag "Tipe (Type)" nggak muncul setelah ${attempts}x klik cell dalam ${Math.round(CONFIG.AUTOCOMPLETE_TIMEOUT_MS / 1000)}d.`);
    return null;
  }
  async function runProsesA(kodeProduk) {
    log(`Proses A: masukin "${kodeProduk}" ke cangkang...`);
    setStatus('Proses A: cek via server', kodeProduk);
    const shellId = getShellIdFromHash();
    if (shellId) {
      try {
        const s = await skuStatusInShell(kodeProduk, shellId);
        if (s && s.inShell) { log(`ℹ️ "${kodeProduk}" SUDAH ada di tag Tipe (Type) cangkang ini (cek server) -- nggak ditambah lagi.`); return 'EXISTS'; }
      } catch (e) { dbg(`pre-check RPC gagal: ${e.message}`); }
    }
    setStatus('Proses A: masuk mode edit', kodeProduk);
    if (!isEditMode()) {
      if (!clickBtn('edit')) return fail('Tombol Edit nggak ketemu & form bukan mode edit. Pastikan di halaman cangkang (tab Variants).');
      await settleAfterAction('klik Edit');
      if (!(await waitUntil('mode edit aktif', isEditMode, { timeout: 10000 }))) return fail('Klik Edit sudah dilakukan tapi form nggak masuk mode edit.');
    } else dbg('Form sudah mode edit (lanjutan batch).');
    document.activeElement?.blur();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(300);
    setStatus('Proses A: cari tabel attribute', kodeProduk);
    let table = await waitUntil('tabel attribute', findAttributeTableNow, { timeout: 4000 });
    if (!table) {
      log('ℹ️ Tabel attribute belum kelihatan -- coba klik tab Variants dulu...');
      await waitForVariantsTabAndClick({ timeout: 15000 });
      table = await waitUntil('tabel attribute (setelah klik Variants)', findAttributeTableNow, { timeout: CONFIG.PROSES_A_TABLE_TIMEOUT_MS });
    }
    if (!table) return fail('Tabel attribute (Attribute/Required/Values) nggak ketemu -- tab Variants nggak kebuka / layout mobile?');
    const row = findTipeAttributeRowNow();
    if (!row) {
      console.log('[KFA-AUTO] Baris tabel:', Array.from(table.querySelectorAll('tr')).map((tr) => Array.from(tr.querySelectorAll('td')).map((c) => c.textContent.trim())));
      return fail('Baris attribute "Tipe (Type)" nggak ketemu di tabel Variants (daftar baris ada di console F12).');
    }
    setStatus('Proses A: buka input tag Tipe (Type)', kodeProduk);
    const input = await withRetry(() => activateTypeInput(), { retries: CONFIG.PROSES_A_RETRY_COUNT, label: 'aktifin input tag Tipe (Type)' });
    if (!input) return fail('Input tag "Tipe (Type)" nggak bisa dibuka lewat script. Fallback: klik manual cell Values-nya sampai kursor kedip, lalu Alt+Enter.');
    setStatus(`Proses A: isi tag "${kodeProduk}"`, kodeProduk);
    const ok = await withRetry(async () => {
      const cur = findTipeAttributeRowNow()?.querySelector(SEL.typeInput) || input;
      return fillAutocomplete(cur, kodeProduk);
    }, { retries: CONFIG.PROSES_A_RETRY_COUNT, label: `isi tag Tipe = "${kodeProduk}"` });
    if (!ok) return fail(`"${kodeProduk}" nggak berhasil dipilih di autocomplete Tipe (Type) (udah di-retry). Kode belum terdaftar / opsi nggak persis cocok.`);
    await sleep(400);
    if (isUnexpectedModalVisible()) {
      const t = getUnexpectedModalText();
      log(`⚠️ Dialog tak terduga abis milih "${kodeProduk}" -- dianggap DUPLIKAT. Isi: "${t}"`, 'error');
      dismissUnexpectedModal();
      return 'DUPLICATE';
    }
    const badge = await waitUntil(`badge "${kodeProduk}" muncul di widget`, () => getExistingTypeTagsText(findTipeAttributeRowNow()).includes(kodeProduk), { timeout: 6000 });
    if (!badge) return fail(`Autocomplete sudah dipilih tapi badge "${kodeProduk}" nggak muncul di widget Tipe (Type) -- jangan Save dulu, cek manual.`);
    log(`✅ "${kodeProduk}" ditambah ke tag Tipe (Type) (belum di-save).`);
    return true;
  }
  // Alt+Enter: isi field yang lagi fokus (jalur manual)
  document.addEventListener('keydown', async (e) => {
    if (!(e.key === 'Enter' && e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey)) return;
    const a = document.activeElement;
    if (!(a && a.tagName === 'INPUT' && a.type === 'text' && !a.disabled && !a.readOnly && !a.closest('#kfa-panel'))) return;
    e.preventDefault(); e.stopPropagation();
    const kode = document.getElementById('kfa-assist-input')?.value.trim();
    if (!kode) { log('⚠️ Isi dulu kode SKU di kotak "Isi field manual" (menu Lainnya).', 'error'); return; }
    log(`(Alt+Enter) ketik & pilih "${kode}"...`);
    const ok = await withRetry(() => fillAutocomplete(a, kode), { label: `Alt+Enter "${kode}"` });
    if (!ok) { log(`⚠️ "${kode}" nggak ketemu di field ini.`, 'error'); return; }
    log(`✅ "${kode}" dipilih via Alt+Enter.`);
    if (autoFlags.autosave) { await sleep(300); if (clickBtn('save')) await settleAfterAction('save (Alt+Enter)'); }
    shiftQueueIf(kode);
  }, true);
  // ============================================================
  // PROSES B -- konfigurasi + validasi produk
  // ============================================================
  function findConfigureBtn() {
    let b = Array.from(document.querySelectorAll(SEL.configure)).find((x) => !x.closest('#kfa-panel') && isVisible(x));
    if (!b) {
      const sp = Array.from(document.querySelectorAll('button span, button')).find((x) =>
        !x.closest('#kfa-panel') && !x.closest('.modal') && /^(re)?configure product$/i.test(norm(x.textContent)) && isVisible(x.closest('button') || x));
      b = sp ? (sp.closest('button') || sp) : null;
    }
    if (!b) {
      const fb = getElementByXPath(CONFIGURE_PRODUCT_BUTTON_FALLBACK_XPATH);
      if (fb && isVisible(fb) && /configure/i.test(fb.textContent)) b = fb.closest('button') || fb;
    }
    if (!b || b.disabled || b.classList.contains('disabled')) return null;
    return b;
  }
  async function runProsesB({ kodeProduk, brand, nie, tkdn }) {
    log(`Proses B: konfigurasi produk "${kodeProduk}"...`);
    const shellId = getShellIdFromHash();
    if (shellId) {
      lastShell = { id: shellId, hash: location.hash };
      try {
        const s = await skuStatusInShell(kodeProduk, shellId);
        if (s && !s.noLine && !s.inShell) {
          return fail(`"${kodeProduk}" BELUM ke-save sebagai value Tipe (Type) di cangkang ini (cek server${s.existsGlobally ? ', value ada tapi belum nempel di cangkang ini' : ', value belum ada'}). Jalanin & Save Proses A dulu -- Proses B dihentikan biar nggak bikin produk kosong.`);
        }
      } catch (e) { dbg(`pre-check RPC Proses B gagal: ${e.message}`); }
    }
    setStatus('Proses B: nunggu tombol Configure/Reconfigure Product', kodeProduk);
    const cfgBtn = await waitUntil('tombol Configure/Reconfigure Product', findConfigureBtn, { timeout: CONFIG.NEXT_BUTTON_TIMEOUT_MS, interval: 300, logEvery: 3000 });
    if (!cfgBtn) return fail(`Tombol "Configure/Reconfigure Product" nggak muncul dalam ${Math.round(CONFIG.NEXT_BUTTON_TIMEOUT_MS / 1000)}d (di luar waktu loading).`);
    const usingReconfigure = /reconfigure/i.test(cfgBtn.textContent) || /reconfigure/i.test(cfgBtn.getAttribute('name') || '');
    if (usingReconfigure) log('ℹ️ Pakai "Reconfigure Product" (cangkang udah pernah dikonfigurasi).');
    cfgBtn.click();
    await settleAfterAction('klik Configure/Reconfigure Product');
    if (!usingReconfigure) {
      const next1 = await waitUntil('tombol Next pertama', () => document.querySelector('button[name="action_next_step"]'), { timeout: CONFIG.NEXT_BUTTON_TIMEOUT_MS });
      if (!next1) return fail('Tombol Next pertama nggak ketemu di modal.');
      next1.click();
      await settleAfterAction('klik Next pertama');
    }
    setStatus('Proses B: isi Brand/Type di wizard', kodeProduk);
    const modalInputs = await waitUntil('input Brand/Type di modal', () => {
      const i = document.querySelectorAll('.modal .o_input.ui-autocomplete-input');
      return i.length >= 2 ? i : null;
    }, { timeout: CONFIG.MODAL_TIMEOUT_MS });
    if (!modalInputs) return fail('Input Brand/Type nggak ketemu di modal wizard.');
    if (brand) {
      const ok = await withRetry(() => fillAutocomplete(document.querySelectorAll('.modal .o_input.ui-autocomplete-input')[0] || modalInputs[0], brand), { label: `isi Brand = "${brand}"` });
      if (!ok) return fail(`Brand "${brand}" gagal dipilih di modal -- BERHENTI sebelum Next (biar nggak kebuat produk Brand kosong).`);
    }
    const typeOk = await withRetry(() => fillAutocomplete(document.querySelectorAll('.modal .o_input.ui-autocomplete-input')[1] || modalInputs[1], kodeProduk), { label: `isi Type = "${kodeProduk}"` });
    if (!typeOk) return fail(`Type "${kodeProduk}" gagal dipilih di modal -- BERHENTI sebelum Next. Kemungkinan belum ke-save sebagai value Tipe (Type) (Proses A + Save dulu).`);
    const next2 = await waitUntil('tombol Next kedua aktif', () => {
      const b = document.querySelector('button[name="action_next_step"]');
      return b && !b.disabled && !b.classList.contains('disabled') ? b : null;
    }, { timeout: CONFIG.NEXT_BUTTON_TIMEOUT_MS });
    if (!next2) return fail('Tombol Next kedua nggak ketemu / nggak pernah aktif (validasi Brand/Type belum beres?).');
    const modalBefore = next2.closest('.modal');
    next2.click();
    await settleAfterAction('klik Next kedua');
    if (!(await waitUntil('modal wizard nutup', () => !modalBefore || !modalBefore.isConnected, { timeout: CONFIG.MODAL_TIMEOUT_MS }))) {
      return fail(`Modal wizard masih kebuka setelah Next kedua (validasi gagal diam-diam?). URL: ${location.href}`);
    }
    await sleep(500);
    setStatus('Proses B: tab Program dan Kemandirian', kodeProduk);
    let tabFound = clickByText('a', 'Program dan Kemandirian', { visibleOnly: true });
    if (!tabFound) {
      const fb = Array.from(document.querySelectorAll('a.nav-link, a[data-toggle="tab"]')).find((a) => a.textContent.toLowerCase().includes('kemandirian') && isVisible(a));
      if (fb) { fb.click(); tabFound = true; }
    }
    if (!tabFound) {
      console.log('[KFA-AUTO] Tab ter-scan:', Array.from(document.querySelectorAll('a.nav-link, a[data-toggle="tab"]')).map((a) => `${a.textContent.trim()} visible=${isVisible(a)}`));
      return fail(`Tab "Program dan Kemandirian" nggak ketemu. URL: ${location.href}`);
    }
    await settleAfterAction('tab Program dan Kemandirian');
    if (!clickBtn('edit')) return fail('Tombol Edit di halaman variant nggak ketemu.');
    await settleAfterAction('klik Edit (Proses B)');
    const nieInput = await waitUntil('input NIE', () => document.querySelector('input[name="nie"]'), { timeout: CONFIG.MODAL_TIMEOUT_MS });
    const tkdnInput = document.querySelector('input[name="score_tkdn"]');
    if (!nieInput || !tkdnInput) return fail('Field NIE/TKDN nggak ketemu.');
    setNativeValue(nieInput, nie);
    if (tkdn !== undefined && tkdn !== '') setNativeValue(tkdnInput, String(tkdn));
    await sleep(300);
    if (!clickByText('span', 'Get NIE REGALKES', { visibleOnly: true })) return fail('Tombol "Get NIE REGALKES" nggak ketemu.');
    log('⏳ Nunggu data Regalkes ke-fetch...');
    await settleAfterAction('klik Get NIE REGALKES');
    setStatus('Proses B: nunggu tombol Validate', kodeProduk);
    if (!(await waitUntil('tombol Validate kelihatan', hasVisibleValidateButton, { timeout: CONFIG.VALIDATE_VISIBLE_TIMEOUT_MS, interval: 300 }))) {
      return fail('Tombol Validate nggak pernah kelihatan setelah Get NIE REGALKES -- fetch Regalkes gagal / NIE nggak valid.');
    }
    if (!autoFlags.autovalidate) {
      log('⏸️ Berhenti sebelum Validate -- klik Validate manual (script nungguin & lanjut otomatis), atau centang "Validate".');
      return 'PAUSED_BEFORE_VALIDATE';
    }
    const validateBtn = await withRetry(() => waitUntil('tombol Validate enabled', () => {
      const b = getVisibleValidateButtonEl();
      return b && !isBtnDisabled(b) ? b : null;
    }, { timeout: CONFIG.VALIDATE_ENABLED_TIMEOUT_MS, interval: 300 }), { label: 'tunggu Validate enabled' });
    if (!validateBtn) {
      const inv = Array.from(document.querySelectorAll('.o_field_invalid, .is-invalid'));
      console.log('[KFA-AUTO] Field invalid:', inv);
      return fail(`Tombol Validate kelihatan tapi TETAP disabled (${inv.length} field ditandai invalid oleh Odoo -- detail di console F12). Cek NIE/TKDN/field wajib.`);
    }
    validateBtn.click();
    log('⏳ Nunggu validasi selesai...');
    await settleAfterAction('klik Validate');
    if (!(await waitUntil('tombol Validate ilang', () => !hasVisibleValidateButton(), { timeout: CONFIG.VALIDATE_DONE_TIMEOUT_MS, interval: 400 }))) {
      return fail('Tombol Validate masih kelihatan setelah ditunggu -- validasi gagal/nyangkut.');
    }
    await sleep(500);
    return finishProsesB(kodeProduk, true);
  }
  // Ambil kode KFA (PA) abis Validate. Dipakai jalur auto & jalur manual.
  async function finishProsesB(kodeProduk, recordResult) {
    if (!clickByText('a', 'Informasi Farmalkes', { visibleOnly: true })) return fail('Tab "Informasi Farmalkes" nggak ketemu.');
    await settleAfterAction('tab Informasi Farmalkes');
    const kfaCode = await waitUntil('kode KFA (PA)', () => {
      const t = document.querySelector('span[name="kfa_pa_code"]')?.textContent.trim();
      return isValidKfaCode(t) ? t : null;
    }, { timeout: CONFIG.KFA_CODE_TIMEOUT_MS, interval: 400 });
    if (!kfaCode) return fail(`Kode KFA (PA) buat "${kodeProduk}" masih kosong/"/" -- validasi kemungkinan belum sukses. JANGAN dianggap sukses.`);
    log(`🎉 Kode KFA (PA) "${kodeProduk}": ${kfaCode}`);
    if (autoFlags.autosave) {
      if (clickBtn('save')) { await settleAfterAction('save akhir'); log('💾 Save akhir di-klik otomatis.'); }
      else log('⚠️ Auto-save aktif tapi tombol Save nggak ketemu -- save manual.', 'error');
    } else log('⏸️ Klik Save manual buat commit hasil ini.');
    if (recordResult) { pushResult(kodeProduk, kfaCode); refreshPanel(); }
    return kfaCode;
  }
  async function watchForManualValidateAndFinish(item) {
    log(`👀 Nunggu kamu klik Validate manual buat "${item.kodeProduk}"...`);
    setStatus('Proses B: nunggu Validate manual', item.kodeProduk);
    if (!(await waitUntil('Validate manual', () => !hasVisibleValidateButton(), { timeout: CONFIG.MANUAL_VALIDATE_TIMEOUT_MS, interval: 1000 }))) {
      fail(`Nunggu Validate manual "${item.kodeProduk}" kelamaan (5 menit). Antrian TIDAK digeser.`);
      return false;
    }
    await settleAfterAction('setelah Validate manual');
    const kfa = await finishProsesB(item.kodeProduk, true);
    if (!kfa) return false;
    const n = shiftQueueIf(item.kodeProduk);
    if (n !== null) log(`➡️ Antrian digeser. Sisa: ${n} SKU.`);
    return true;
  }
  // ============================================================
  // RUNNER: Proses A (batch tag)
  // ============================================================
  async function safetySaveProsesA(reason) {
    if (prosesA_pendingSaveCount <= 0) return;
    log(`💾 Safety-save ${prosesA_pendingSaveCount} tag (${reason})...`);
    if (clickBtn('save')) { await settleAfterAction('safety-save'); prosesA_pendingSaveCount = 0; log('✅ Safety-save selesai.'); }
    else log('⚠️ Safety-save: tombol Save nggak kelihatan -- cek manual.', 'error');
  }
  function processNextInQueueForProsesA() { return safe('Proses A', runnerA); }
  async function runnerA() {
    if (stopRequested) { log('⏹ Stop -- Proses A berhenti di titik aman.'); await safetySaveProsesA('Stop'); setIdle('Dihentikan user (Stop)'); return; }
    const q = loadQueue();
    if (!q.length) {
      log('✅ Antrian abis (Proses A).');
      if (autoFlags.autosave || prosesA_pendingSaveCount > 0) {
        if (clickBtn('save')) { await settleAfterAction('save akhir batch A'); log('✅ Semua tag ke-commit.'); prosesA_pendingSaveCount = 0; }
        else log('⚠️ Tombol Save nggak ketemu -- save manual ("Save sekarang" di menu Lainnya).', 'error');
      } else log('⏸️ Belum di-save. Pakai "Save sekarang" (menu Lainnya) atau centang Save.');
      setIdle('Selesai (antrian habis, Proses A)');
      return;
    }
    const item = q[0];
    if (!(await prepareCangkangForItem(item, { variantsTab: true, saveBeforeLeave: true }))) {
      await safetySaveProsesA('gagal pindah cangkang');
      setIdle('Berhenti (Proses A: gagal pindah cangkang)');
      return;
    }
    setStatus(`Proses A: mulai SKU (sisa ${q.length})`, item.kodeProduk);
    const result = await runProsesA(item.kodeProduk);
    if (result === 'DUPLICATE') {
      shiftQueueIf(item.kodeProduk);
      pushResult(item.kodeProduk, 'SKIPPED_DUPLICATE');
      log(`⏭️ "${item.kodeProduk}" DUPLIKAT -- di-skip, halaman di-refresh buat lanjut.`);
      await safetySaveProsesA('sebelum refresh (duplikat)');
      localStorage.setItem(AUTORESUME_PROSES_A_KEY, '1');
      await sleep(600);
      location.reload();
      return;
    }
    if (result === 'EXISTS') { shiftQueueIf(item.kodeProduk); setTimeout(processNextInQueueForProsesA, 400); return; }
    if (result) {
      const n = shiftQueueIf(item.kodeProduk);
      log(`➡️ Antrian digeser (Proses A). Sisa: ${n} SKU.`);
      prosesA_pendingSaveCount += 1;
      if (autoFlags.autosave5 && prosesA_pendingSaveCount >= CONFIG.PROSES_A_AUTOSAVE_EVERY) {
        log(`💾 Auto-save periodik (${prosesA_pendingSaveCount} tag)...`);
        if (clickBtn('save')) { await settleAfterAction('auto-save periodik'); prosesA_pendingSaveCount = 0; }
        else log('⚠️ Auto-save periodik: tombol Save nggak ketemu.', 'error');
      }
      setTimeout(processNextInQueueForProsesA, 800);
    } else {
      log('⛔ Proses A gagal (bukan duplikat) -- DIHENTIKAN. Klik Diagnosa buat detailnya.', 'error');
      await safetySaveProsesA('SKU gagal, amanin progress sebelumnya');
      setIdle('Berhenti karena kegagalan (Proses A)');
    }
  }
  async function resumeProsesAAfterReload() {
    runLock = true; setCollapsed(true);
    setStatus('Proses A: balik ke tab Variants abis refresh', null);
    if (!(await waitForVariantsTabAndClick())) { fail('Tab Variants nggak ketemu abis refresh -- Proses A nggak dilanjut otomatis.'); setIdle('Berhenti (tab Variants nggak ketemu abis refresh)'); return; }
    await settleAfterAction('tab Variants abis refresh');
    await sleep(400);
    processNextInQueueForProsesA();
  }
  // ============================================================
  // RUNNER: Proses C / D (cek cangkang -> A + Save -> B -> pulang -> ulangi)
  // ============================================================
  async function returnToShellAndVariantsTab() {
    if (activeCangkang && activeCangkang.explicit) {
      log(`🔙 Balik ke cangkang ${activeCangkang.code} (via kode)...`);
      setStatus('Proses C: balik ke cangkang (via kode)', null);
      if (await ensureOnCangkang(activeCangkang.code, { variantsTab: true })) return true;
      log('⚠️ Balik via kode gagal -- coba breadcrumb...', 'error');
    }
    setStatus('Proses C: balik ke cangkang (breadcrumb)', null);
    const shellId = lastShell && lastShell.id;
    const onShell = () => { const h = getHashParams(); return h.get('model') === 'product.template' && (!shellId || String(h.get('id')) === String(shellId)) && !!readShellCodeFromDom(); };
    if (!onShell()) {
      const crumbs = Array.from(document.querySelectorAll('.o_control_panel ol.breadcrumb li:not(.active) a, .o_control_panel .breadcrumb li:not(.active) a')).filter(isVisible);
      let clicked = false;
      if (crumbs.length) { crumbs[crumbs.length - 1].click(); clicked = true; }
      else { const x = getElementByXPath(BREADCRUMB_PARENT_XPATH); if (x && isVisible(x)) { x.click(); clicked = true; } }
      if (!clicked && lastShell) { log('ℹ️ Breadcrumb nggak ketemu -- balik lewat URL hash cangkang.'); location.hash = lastShell.hash; }
      await sleep(300);
      await settleAfterAction('balik ke cangkang');
    }
    if (!(await waitUntil('halaman cangkang kebuka', onShell, { timeout: CONFIG.CANGKANG_NAV_TIMEOUT_MS }))) {
      fail('Setelah balik dari Proses B, halaman cangkang nggak kebuka.');
      return false;
    }
    if (!(await waitForVariantsTabAndClick())) { fail('Tab "Variants" nggak ketemu setelah balik ke cangkang.'); return false; }
    await settleAfterAction('tab Variants (balik dari Proses B)');
    return true;
  }
  async function goBackAfterProsesB() {
    const next = loadQueue()[0];
    if (next && next.cangkang) { log(`➡️ SKU berikutnya punya KODE_CANGKANG (${next.cangkang}) -- diarahkan di iterasi berikutnya.`); return true; }
    return returnToShellAndVariantsTab();
  }
  function processNextInQueueForProsesC() { return safe('Proses C', runnerC); }
  async function runnerC() {
    if (stopRequested) { log('⏹ Stop -- Proses C berhenti di titik aman.'); setIdle('Dihentikan user (Stop)'); return; }
    const q = loadQueue();
    if (!q.length) { log('✅ Antrian abis (Proses C/D).'); setIdle('Selesai (antrian habis)'); return; }
    const item = q[0];
    if (!(await prepareCangkangForItem(item, { variantsTab: true }))) { setIdle('Berhenti (gagal pindah ke cangkang)'); return; }
    setStatus(`Proses C: cek cangkang (sisa ${q.length})`, item.kodeProduk);
    log(`🔍 Cek "${item.kodeProduk}" di tag Tipe (Type) cangkang...`);
    const found = await checkSkuInCangkang(item.kodeProduk);
    if (found === null) { fail(`Nggak bisa mastiin "${item.kodeProduk}" ada/nggak di cangkang (tabel Tipe (Type) nggak ketemu & server nggak bisa dicek).`); setIdle('Berhenti (gagal cek cangkang)'); return; }
    if (found) log(`ℹ️ "${item.kodeProduk}" SUDAH ada di cangkang -- skip Proses A, langsung B.`);
    else {
      log(`➕ "${item.kodeProduk}" BELUM ada -- Proses A dulu...`);
      setStatus('Proses C: Proses A', item.kodeProduk);
      const resA = await runProsesA(item.kodeProduk);
      if (resA === 'DUPLICATE') {
        shiftQueueIf(item.kodeProduk);
        pushResult(item.kodeProduk, 'SKIPPED_DUPLICATE');
        log(`⏭️ "${item.kodeProduk}" DUPLIKAT di Proses A -- di-skip, refresh buat lanjut...`);
        localStorage.setItem(AUTORESUME_PROSES_C_KEY, '1');
        await sleep(600);
        location.reload();
        return;
      }
      if (!resA) { log(`⛔ Proses A gagal buat "${item.kodeProduk}" -- DIHENTIKAN.`, 'error'); setIdle('Berhenti (Proses A gagal)'); return; }
      if (resA === true) {
        setStatus('Proses C: Save sebelum Proses B', item.kodeProduk);
        log('💾 Save (WAJIB) sebelum Proses B...');
        if (!clickBtn('save')) { fail(`Tombol Save nggak ketemu abis Proses A -- tag "${item.kodeProduk}" belum ke-save. Save manual dulu.`); setIdle('Berhenti (tombol Save nggak ketemu)'); return; }
        await settleAfterAction('save sebelum Proses B');
        setStatus('Proses C: konfirmasi tag ke-save', item.kodeProduk);
        if (!(await confirmTagSaved(item.kodeProduk))) {
          fail(`Tag "${item.kodeProduk}" nggak terkonfirmasi ke-save (server / tombol Save nggak ilang) setelah ${Math.round(CONFIG.SAVE_CONFIRM_TIMEOUT_MS / 1000)}d.`);
          setIdle('Berhenti (Save nggak terkonfirmasi)');
          return;
        }
        log('✅ Tag ke-save (terkonfirmasi) -- lanjut Proses B...');
      }
    }
    setStatus('Proses C: Proses B', item.kodeProduk);
    let kfa = await runProsesB(item);
    if (kfa === 'PAUSED_BEFORE_VALIDATE') {
      if (!(await watchForManualValidateAndFinish(item))) { log('⛔ Proses B (manual) gagal -- DIHENTIKAN.', 'error'); setIdle('Berhenti (Proses B gagal)'); return; }
    } else if (kfa) {
      const n = shiftQueueIf(item.kodeProduk);
      log(`➡️ Antrian digeser (Proses C). Sisa: ${n} SKU.`);
    } else { log('⛔ Proses B gagal -- DIHENTIKAN. Klik Diagnosa.', 'error'); setIdle('Berhenti (Proses B gagal)'); return; }
    if (!(await goBackAfterProsesB())) { setIdle('Berhenti (gagal balik ke cangkang)'); return; }
    log('➡️ Lanjut ke SKU berikutnya...');
    setTimeout(processNextInQueueForProsesC, 1000);
  }
  async function resumeProsesCAfterReload() {
    runLock = true; setCollapsed(true);
    setStatus('Proses C: balik ke tab Variants abis refresh', null);
    if (!(await waitForVariantsTabAndClick())) { fail('Tab Variants nggak ketemu abis refresh -- Proses C nggak dilanjut.'); setIdle('Berhenti (tab Variants nggak ketemu abis refresh)'); return; }
    await settleAfterAction('tab Variants abis refresh');
    await sleep(400);
    processNextInQueueForProsesC();
  }
  // ============================================================
  // RUNNER: Proses B saja
  // ============================================================
  function processNextInQueue() { return safe('Proses B', runnerB); }
  async function runnerB() {
    if (stopRequested) { setIdle('Dihentikan user (Stop)'); return; }
    const q = loadQueue();
    if (!q.length) { log('✅ Antrian kosong.'); setIdle('Selesai (antrian habis)'); return; }
    const item = q[0];
    if (!(await prepareCangkangForItem(item, { variantsTab: false }))) { setIdle('Berhenti (Proses B: gagal pindah cangkang)'); return; }
    const kfa = await runProsesB(item);
    if (kfa === 'PAUSED_BEFORE_VALIDATE') {
      if (await watchForManualValidateAndFinish(item)) maybeAutoContinue(); else setIdle('Berhenti (Proses B gagal)');
      return;
    }
    if (kfa) { shiftQueueIf(item.kodeProduk); maybeAutoContinue(); }
    else { log('⛔ Proses B gagal -- auto-lanjut DIHENTIKAN.', 'error'); setIdle('Berhenti (Proses B gagal)'); }
  }
  function maybeAutoContinue() {
    const q = loadQueue();
    if (!autoFlags.autonext) { setIdle('Selesai (1 SKU, Proses B)'); return; }
    if (!q.length) { log('✅ Antrian habis.'); setIdle('Selesai (antrian habis)'); return; }
    log(`➡️ Auto-lanjut: "${q[0].kodeProduk}"...`);
    setTimeout(processNextInQueue, 1200);
  }
  function skipFirstInQueue() {
    const q = loadQueue();
    if (!q.length) { alert('Antrian kosong.'); return; }
    const item = q[0];
    if (!confirm(`Skip SKU "${item.kodeProduk}"?\nDigeser dari antrian & dicatat "SKIPPED_BY_USER" (nggak ngubah apa pun di sistem KFA).`)) return;
    q.shift(); saveQueue(q);
    const r = loadResults();
    r.push({ kodeProduk: item.kodeProduk, kfaCode: 'SKIPPED_BY_USER', timestamp: new Date().toISOString(), cangkang: item.cangkang || '' });
    saveResults(r);
    log(`⏭️ "${item.kodeProduk}" di-skip. Sisa ${q.length}.`);
    refreshPanel();
  }
  // ---- START (satu pintu) ----
  function startRun(mode) {
    if (runLock) { log('⚠️ Masih ada proses jalan. Klik Stop dulu.'); return; }
    const q = loadQueue();
    if (!q.length) { alert('Antrian kosong. Paste data lalu klik "Muat".'); return; }
    if (mode === 'D') {
      const missing = q.filter((x) => !x.cangkang).map((x) => x.kodeProduk);
      if (missing.length) { log(`⛔ Mode D butuh KODE_CANGKANG di tiap SKU; ${missing.length} belum punya (mis. ${missing.slice(0, 5).join(', ')}).`, 'error'); alert(`Mode D butuh KODE_CANGKANG di SETIAP SKU (${missing.length} belum punya). Lihat log.`); return; }
    }
    if (!layoutOk()) return;
    runLock = true; stopRequested = false; prosesA_pendingSaveCount = 0; lastShell = null;
    setCollapsed(true);
    log(`▶ Start mode ${mode}: ${q.length} SKU (viewport ${innerWidth}x${innerHeight}).`);
    if (mode === 'D') { forceVariantsNext = true; processNextInQueueForProsesC(); }
    else if (mode === 'C') processNextInQueueForProsesC();
    else if (mode === 'A') processNextInQueueForProsesA();
    else processNextInQueue();
  }
  // ============================================================
  // EXPORT
  // ============================================================
  function exportResultsCSV() {
    const results = loadResults();
    if (!results.length) { alert('Belum ada hasil.'); return; }
    const rows = [['KODE_PRODUK', 'KODE_KFA', 'TIMESTAMP', 'KODE_CANGKANG']].concat(results.map((r) => [r.kodeProduk, r.kfaCode, r.timestamp, r.cangkang || '']));
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = `kfa_hasil_${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  }
  async function copyResultsAsTSV() {
    const results = loadResults();
    if (!results.length) { alert('Belum ada hasil.'); return; }
    const text = results.map((r) => [r.kodeProduk, r.kfaCode, r.timestamp, r.cangkang || ''].join('\t')).join('\n');
    const ok = await copyText(text);
    if (ok) log(`📋 ${results.length} baris ke-copy (tanpa header) -- Ctrl+V di Google Sheets.`);
    else { log('⚠️ Copy otomatis gagal -- preview muncul, Ctrl+C manual.', 'error'); const b = document.getElementById('kfa-tsv-preview'); if (b) { b.style.display = 'block'; b.value = text; b.focus(); b.select(); } }
  }
  // ============================================================
  // PANEL
  // ============================================================
  function parseQueueInput(text) {
    let lastCangkang = '';
    return text.trim().split('\n').filter(Boolean).map((line) => {
      const [kodeProduk, nie, tkdn, brand, cangkang] = line.replace(/\r$/, '').split('\t').map((s) => (s || '').trim());
      if (cangkang) lastCangkang = cangkang;
      return { kodeProduk, nie, tkdn, brand: brand || '', cangkang: cangkang || lastCangkang };
    }).filter((x) => x.kodeProduk && x.kodeProduk !== 'KODE_PRODUK');
  }
  const PANEL_CSS = `
    #kfa-panel{position:fixed;width:300px;max-height:82vh;display:flex;flex-direction:column;background:#fff;border:2px solid #1F4E78;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.28);z-index:2147483000;font:12px/1.35 Arial,sans-serif;color:#222}
    #kfa-panel.collapsed{width:260px}
    #kfa-header{cursor:move;background:#1F4E78;color:#fff;padding:5px 8px;border-radius:5px 5px 0 0;display:flex;align-items:center;gap:6px;user-select:none}
    #kfa-header b{font-size:12px}
    #kfa-mini-text{flex:1;font-size:11px;opacity:.9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #kfa-panel button,#kfa-panel select{font-size:11px;cursor:pointer;padding:3px 5px}
    #kfa-body{padding:8px;overflow-y:auto}
    #kfa-panel.collapsed #kfa-body{display:none}
    #kfa-panel .r{display:flex;gap:4px;margin-bottom:5px;align-items:center}
    #kfa-panel .r>*{flex:1;min-width:0}
    #kfa-panel .r label{flex:none;font-size:11px}
    #kfa-status-text{white-space:pre-line;font-size:11px;font-weight:bold;background:#f0f2f5;border:1px solid #ddd;border-radius:4px;padding:4px 6px;margin-bottom:5px}
    #kfa-summary{color:#555;font-size:11px;margin-bottom:5px;word-break:break-all}
    #kfa-log{max-height:130px;overflow-y:auto;background:#f7f7f7;border:1px solid #ddd;padding:3px;font-size:10.5px}
    #kfa-panel details{margin-bottom:5px}
    #kfa-panel summary{cursor:pointer;color:#1F4E78;font-weight:bold}
    #kfa-panel hr{margin:6px 0;border:0;border-top:1px solid #ddd}
  `;
  function setCollapsed(v) {
    ui.collapsed = !!v; saveUi();
    const p = document.getElementById('kfa-panel');
    if (p) {
      p.classList.toggle('collapsed', ui.collapsed);
      const b = document.getElementById('kfa-collapse-btn');
      if (b) b.textContent = ui.collapsed ? '▢' : '—';
      clampPanel();
    }
  }
  function clampPanel() {
    const p = document.getElementById('kfa-panel');
    if (!p) return;
    const r = p.getBoundingClientRect();
    let left = ui.left === null ? innerWidth - r.width - 10 : ui.left;
    left = Math.max(0, Math.min(left, innerWidth - Math.min(r.width, innerWidth)));
    const top = Math.max(0, Math.min(ui.top, Math.max(innerHeight - 40, 0)));
    p.style.left = left + 'px'; p.style.top = top + 'px'; p.style.right = 'auto';
  }
  function refreshPanel() {
    const sum = document.getElementById('kfa-summary');
    if (!sum) return;
    const q = loadQueue(), r = loadResults();
    const distinct = new Set(q.map((x) => x.cangkang || '')).size;
    sum.textContent = `Antrian ${q.length} • Hasil ${r.length}` + (q.length ? ` • Next: ${q[0].kodeProduk} → ${q[0].cangkang || '(halaman ini)'}${distinct > 1 ? ` • ${distinct} cangkang` : ''}` : '');
    const as = document.getElementById('kfa-assist-input');
    if (as && q.length && document.activeElement !== as) as.value = q[0].kodeProduk;
  }
  const renderPanel = () => { ensurePanel(); refreshPanel(); };
  function ensurePanel() {
    if (document.getElementById('kfa-panel') || !document.body) return;
    if (!document.getElementById('kfa-style')) {
      const st = document.createElement('style'); st.id = 'kfa-style'; st.textContent = PANEL_CSS; document.head.appendChild(st);
    }
    const panel = document.createElement('div');
    panel.id = 'kfa-panel';
    if (ui.collapsed) panel.classList.add('collapsed');
    panel.innerHTML = `
      <div id="kfa-header">
        <span id="kfa-status-dot" style="font-size:14px">●</span>
        <b>KFA Auto v${VERSION}</b>
        <span id="kfa-mini-text"></span>
        <button id="kfa-mini-stop" title="Stop (berhenti di titik aman)" style="flex:none">⏹</button>
        <button id="kfa-collapse-btn" title="Ciutkan / lebarkan" style="flex:none">${ui.collapsed ? '▢' : '—'}</button>
      </div>
      <div id="kfa-body">
        <div id="kfa-status-text">⏸ Idle</div>
        <div id="kfa-summary"></div>
        <textarea id="kfa-queue-input" rows="3" style="width:100%;box-sizing:border-box;font-size:11px;margin-bottom:4px" placeholder="KODE_PRODUK[TAB]NIE[TAB]TKDN[TAB]BRAND[TAB]KODE_CANGKANG(opsional)"></textarea>
        <div class="r">
          <button id="kfa-load-queue">Muat</button>
          <select id="kfa-mode" style="flex:3">
            <option value="D">D • cari cangkang, dari mana aja</option>
            <option value="C">C • per SKU di cangkang ini</option>
            <option value="A">A • tag Type saja (batch)</option>
            <option value="B">B • validasi SKU pertama</option>
          </select>
        </div>
        <div class="r">
          <button id="kfa-start" style="background:#0b6b3a;color:#fff;font-weight:bold">▶ Start</button>
          <button id="kfa-stop" style="background:#f8d7da;border:1px solid #dc3545;color:#721c24">⏹ Stop</button>
          <button id="kfa-skip" title="Skip SKU pertama di antrian">⏭ Skip</button>
        </div>
        <div class="r" style="flex-wrap:wrap">
          <label title="Auto-klik Validate di Proses B"><input type="checkbox" id="kfa-autovalidate"> Validate</label>
          <label title="Auto-klik Save di akhir Proses B / batch A"><input type="checkbox" id="kfa-autosave"> Save</label>
          <label title="Auto-lanjut SKU berikutnya (Proses B saja; A/C/D selalu lanjut)"><input type="checkbox" id="kfa-autonext"> Lanjut(B)</label>
        </div>
        <div class="r">
          <button id="kfa-copy-tsv">📋 Hasil</button>
          <button id="kfa-copy-diag" title="Copy diagnosa kegagalan terakhir + log (paste ke Claude)">🩺 Diagnosa</button>
        </div>
        <details>
          <summary>Lainnya</summary>
          <div class="r"><input type="text" id="kfa-goto-input" placeholder="Kode KFA (PV) cangkang" style="font-size:11px"><button id="kfa-goto-btn" style="flex:none">🔎 Pindah</button></div>
          <div class="r"><button id="kfa-save-now">💾 Save sekarang</button><button id="kfa-export">⬇ CSV</button></div>
          <label style="display:block;margin-bottom:4px"><input type="checkbox" id="kfa-autosave5"> Auto-save tiap ${CONFIG.PROSES_A_AUTOSAVE_EVERY} SKU (Proses A)</label>
          <div style="color:#555;font-size:10.5px;margin-bottom:2px">Isi field manual: klik field sampai kursor kedip, tekan <b>Alt+Enter</b>.</div>
          <input type="text" id="kfa-assist-input" placeholder="Kode SKU" style="width:100%;box-sizing:border-box;font-size:11px;margin-bottom:4px">
          <textarea id="kfa-tsv-preview" readonly rows="3" style="display:none;width:100%;box-sizing:border-box;font-size:10px"></textarea>
          <button id="kfa-clear" style="width:100%">🗑 Reset antrian, hasil & log</button>
        </details>
        <div style="display:flex;align-items:center;gap:6px;margin:4px 0 3px">
          <b>Log</b>
          <label style="font-size:10.5px"><input type="checkbox" id="kfa-debug"> detail</label>
          <span style="flex:1"></span>
          <button id="kfa-copy-log">Copy</button><button id="kfa-clear-log">Bersih</button>
        </div>
        <div id="kfa-log"></div>
      </div>`;
    document.body.appendChild(panel);
    // isi log dari buffer
    logBuf.slice(-80).forEach((e) => appendLogLine(e));
    const $ = (id) => document.getElementById(id);
    $('kfa-mode').value = ui.mode;
    $('kfa-debug').checked = !!ui.debug;
    ['autovalidate', 'autosave', 'autonext', 'autosave5'].forEach((k) => {
      $('kfa-' + k).checked = !!autoFlags[k];
      $('kfa-' + k).onchange = (e) => { autoFlags[k] = e.target.checked; saveUi(); };
    });
    $('kfa-mode').onchange = (e) => { ui.mode = e.target.value; saveUi(); };
    $('kfa-debug').onchange = (e) => {
      ui.debug = e.target.checked; saveUi();
      const box = $('kfa-log'); box.textContent = '';
      logBuf.slice(-80).forEach((x) => appendLogLine(x));
    };
    $('kfa-collapse-btn').onclick = () => setCollapsed(!ui.collapsed);
    // drag
    let dragging = false, sx = 0, sy = 0, pl = 0, pt = 0;
    $('kfa-header').addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      dragging = true; const r = panel.getBoundingClientRect(); pl = r.left; pt = r.top; sx = e.clientX; sy = e.clientY; e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      panel.style.left = Math.max(0, pl + e.clientX - sx) + 'px'; panel.style.top = Math.max(0, pt + e.clientY - sy) + 'px'; panel.style.right = 'auto';
    });
    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false; const r = panel.getBoundingClientRect(); ui.left = Math.round(r.left); ui.top = Math.round(r.top); saveUi(); clampPanel();
    });
    const qi = $('kfa-queue-input');
    qi.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      e.preventDefault();
      const s = qi.selectionStart;
      qi.value = qi.value.slice(0, s) + '\t' + qi.value.slice(qi.selectionEnd);
      qi.selectionStart = qi.selectionEnd = s + 1;
    });
    $('kfa-load-queue').onclick = () => {
      const items = parseQueueInput(qi.value);
      saveQueue(items);
      const withC = items.filter((x) => x.cangkang).length;
      log(`Antrian dimuat: ${items.length} SKU (${withC} punya KODE_CANGKANG, ${new Set(items.filter((x) => x.cangkang).map((x) => x.cangkang)).size} cangkang berbeda).`);
      refreshPanel();
    };
    $('kfa-start').onclick = () => startRun($('kfa-mode').value);
    $('kfa-stop').onclick = () => {
      stopRequested = true;
      log('⏹ Stop diminta -- berhenti abis SKU yang lagi jalan kelar (+ safety-save kalau ada tag numpuk).');
      if (!scriptStatus.running || Date.now() - scriptStatus.lastActivity > 45000) { setIdle('Dihentikan user (Stop paksa)'); }
    };
    $('kfa-mini-stop').onclick = () => $('kfa-stop').click();
    $('kfa-skip').onclick = skipFirstInQueue;
    $('kfa-copy-tsv').onclick = copyResultsAsTSV;
    $('kfa-copy-diag').onclick = copyDiagnosa;
    $('kfa-export').onclick = exportResultsCSV;
    $('kfa-goto-btn').onclick = async () => {
      const code = $('kfa-goto-input').value.trim();
      if (!code) return alert('Isi dulu Kode KFA (PV) cangkang tujuan.');
      if (runLock) return log('⚠️ Masih ada proses jalan.');
      runLock = true; stopRequested = false;
      setStatus(`Pindah cangkang (manual): ${code}`, null);
      const ok = await safe('pindah cangkang', () => ensureOnCangkang(code, { variantsTab: true }));
      setIdle(ok ? `Selesai (pindah cangkang ${code})` : `Berhenti (pindah cangkang ${code} gagal)`);
    };
    $('kfa-save-now').onclick = async () => {
      if (!clickBtn('save')) return alert('Tombol Save nggak kelihatan. Pastikan masih di halaman cangkang yang lagi diedit.');
      log('💾 Save manual diklik...');
      await settleAfterAction('Save sekarang');
      prosesA_pendingSaveCount = 0;
      log('✅ Save selesai.');
    };
    $('kfa-copy-log').onclick = async () => {
      const ok = await copyText(logBuf.slice(-150).map(fmtEntry).join('\n'));
      log(ok ? '📋 Log ke-copy.' : '⚠️ Copy log gagal.', ok ? 'info' : 'error');
    };
    $('kfa-clear-log').onclick = () => { logBuf = []; localStorage.removeItem(LOG_KEY); $('kfa-log').textContent = ''; };
    $('kfa-clear').onclick = () => {
      if (!confirm('Reset antrian, hasil & log? (Nggak menghapus apa pun di sistem KFA.)')) return;
      localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(RESULTS_KEY); localStorage.removeItem(LOG_KEY); localStorage.removeItem(FAIL_KEY);
      logBuf = []; lastFailure = null; $('kfa-log').textContent = '';
      refreshPanel();
    };
    clampPanel();
    refreshPanel();
    updateStatusBar();
  }
  // ============================================================
  // INIT
  // ============================================================
  function initKFA() {
    ensurePanel();
    log(`Script v${VERSION} jalan | viewport ${innerWidth}x${innerHeight}${innerWidth < CONFIG.MIN_VIEWPORT_WIDTH ? ' ⚠ <768 = layout mobile!' : ''}`);
    if (localStorage.getItem(AUTORESUME_PROSES_A_KEY)) {
      localStorage.removeItem(AUTORESUME_PROSES_A_KEY);
      log('🔄 Abis refresh otomatis (duplikat, Proses A) -- lanjut dari SKU berikutnya...');
      setTimeout(resumeProsesAAfterReload, 800);
    }
    if (localStorage.getItem(AUTORESUME_PROSES_C_KEY)) {
      localStorage.removeItem(AUTORESUME_PROSES_C_KEY);
      log('🔄 Abis refresh otomatis (duplikat, Proses C/D) -- lanjut dari SKU berikutnya...');
      setTimeout(resumeProsesCAfterReload, 800);
    }
  }
  window.addEventListener('resize', () => { clampPanel(); updateStatusBar(); });
  document.addEventListener('visibilitychange', () => {
    if (scriptStatus.running) log(document.hidden ? '⚠️ Tab nggak kelihatan -- browser nge-throttle timer, script bakal lambat/macet. Biarkan tab ini kelihatan.' : 'ℹ️ Tab kelihatan lagi.', document.hidden ? 'error' : 'info');
  });
  if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(initKFA, 1000);
  else window.addEventListener('load', () => setTimeout(initKFA, 1000));
  let panelCheckTimer = null;
  const bodyObserver = new MutationObserver(() => {
    if (panelCheckTimer) return;
    panelCheckTimer = setTimeout(() => {
      panelCheckTimer = null;
      if (document.body && !document.getElementById('kfa-panel')) renderPanel();
    }, 800);
  });
  if (document.body) bodyObserver.observe(document.body, { childList: true, subtree: false });
})();