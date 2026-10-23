/*
 * universal_capture.js  v2  —  paste di Console HALAMAN MANA PUN.
 *
 * READ-ONLY: gak ngeklik / ngisi / submit apa pun. Cuma ngerekam apa yang kamu lakukan + kondisi halaman,
 * lalu hasilnya jadi 1 file JSON yang dikirim ke Claude buat dijadiin dasar userscript/automasi.
 *
 * YANG DIREKAM
 *   snaps[]  : foto halaman — controls (semua field: label, wajib/opsional, tipe, maxlength, accept, opsi select,
 *              nilai, selector css/xpath), buttons, links, tables, repeaters (list kartu), menu/dropdown terbuka,
 *              dialog, alert/toast, outline heading, "appeared" (field baru yang muncul sejak snapshot sebelumnya).
 *              Nembus Shadow DOM + iframe same-origin. Ada adapter react-select / antd / select2 / Odoo.
 *   steps[]  : aksi kamu berurutan (click, input, change, key Enter/Esc, submit, drop file) + target (selector, label)
 *              + efek (urlAfter, menu yang kebuka, dialog, alert).
 *   net[]    : fetch + XHR (GraphQL operationName, body, status, respons), tiap request ditandai afterStep
 *              (step pemicu). Token / cookie / JWT / password otomatis diredaksi. + WebSocket (ringkas).
 *
 * CARA PAKAI
 *   1. Buka halaman target, paste script ini di Console, Enter. (Mau nangkep request saat load awal? paste, lalu refresh
 *      gak bisa — hook hilang. Request awal tetap kelihatan di page.resourceFetches.)
 *   2. Lakukan alur normal seperti manual. Auto-snapshot jalan tiap URL/hash berubah & tiap dialog muncul.
 *   3. Alt+Shift+S = snapshot manual (pas dropdown kebuka, habis pilih kategori, habis scroll, pindah tab, dll).
 *   4. Alt+Shift+P = pause/resume rekam steps.
 *   5. Alt+Shift+D = DUMP → file JSON ke-download + ke-copy ke clipboard. Kirim ke Claude.
 *
 * CONSOLE: __cap.snap('nama') · __cap.note('catatan buat Claude') · __cap.dump({all:true|light:true|name:'x'})
 *          __cap.sel($0) (selector elemen yang lagi diinspect) · __cap.config.maskValues=true (nilai input disensor)
 *          __cap.auto(false) · __cap.pause() / __cap.resume() · __cap.reset() · __cap.uninstall()
 */
(() => {
  'use strict';
  if (window.__cap && typeof window.__cap.uninstall === 'function') { try { window.__cap.uninstall(); } catch (e) { /* abaikan */ } }

  const VERSION = '2.0-universal';
  const CONFIG = {
    maxNet: 500, maxSteps: 600, maxRows: 30, maxMenuLines: 200, maxLinks: 60, maxButtons: 80,
    maxResp: 6000, recordSteps: true, autoNav: true, autoDialog: true,
    maskValues: false // true = semua nilai input diganti «N karakter» (buat halaman berisi data pribadi)
  };
  const state = { t0: Date.now(), snaps: [], net: [], steps: [], nav: [], ws: [] };
  let netSeq = 0, stepSeq = 0, paused = false, autoTimer = null, moTimer = null;
  let lastAutoKey = '', lastSig = '', prevKeys = null, R = null;
  let lastOv = { menus: '', dialogs: '', alerts: '' };

  // ── util ────────────────────────────────────────────────────────────────
  const $$ = (sel, root) => { try { return Array.from((root || document).querySelectorAll(sel)); } catch (e) { return []; } };
  const itext = (el) => (el ? ((el.innerText !== undefined ? el.innerText : el.textContent) || '') : '');
  const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const txt = (el) => clean(itext(el));
  const cut = (s, n) => { s = String(s); return s.length > n ? s.slice(0, n) + '…(+' + (s.length - n) + ')' : s; };
  const esc = (s) => ((window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/[^\w-]/g, '\\$&'));
  const inUI = (el) => !!(el && el.closest && el.closest('[data-cap-ui]'));
  const since = () => Date.now() - state.t0;
  const win = (el) => (el.ownerDocument && el.ownerDocument.defaultView) || window;
  const compact = (o) => { Object.keys(o).forEach((k) => { if (o[k] === undefined || o[k] === null || o[k] === '') delete o[k]; }); return o; };

  const vis = (el) => {
    try { if (el.checkVisibility && !el.checkVisibility({ checkVisibilityCSS: true })) return false; } catch (e) { /* abaikan */ }
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return false;
    const cs = win(el).getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  };

  function toast(msg) {
    try {
      let t = document.querySelector('[data-cap-ui="toast"]');
      if (!t) {
        t = document.createElement('div');
        t.setAttribute('data-cap-ui', 'toast');
        t.style.cssText = 'position:fixed;right:16px;bottom:90px;z-index:2147483647;background:#111;color:#fff;font:12px/1.4 system-ui,sans-serif;padding:8px 12px;border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,.4);pointer-events:none;max-width:320px';
        document.body.appendChild(t);
      }
      t.textContent = msg; t.style.display = 'block';
      clearTimeout(t._h); t._h = setTimeout(() => { t.style.display = 'none'; }, 2600);
    } catch (e) { /* toast opsional */ }
  }

  // ── roots: document + shadow DOM + iframe same-origin ───────────────────
  const ctxMap = new Map();
  function roots() {
    const out = [{ root: document, ctx: 'main' }];
    const seen = new Set([document]);
    const walk = (r, ctx) => {
      let i = 0;
      $$('*', r).forEach((el) => {
        if (el.shadowRoot && !seen.has(el.shadowRoot)) {
          seen.add(el.shadowRoot);
          const c = ctx + '>shadow(' + el.tagName.toLowerCase() + ')';
          out.push({ root: el.shadowRoot, ctx: c }); walk(el.shadowRoot, c);
        }
        if (el.tagName === 'IFRAME') {
          try {
            const d = el.contentDocument;
            if (d && !seen.has(d)) { seen.add(d); const c = ctx + '>iframe[' + (el.id || el.name || i) + ']'; out.push({ root: d, ctx: c }); walk(d, c); }
          } catch (e) { /* cross-origin */ }
          i++;
        }
      });
    };
    walk(document, 'main');
    out.forEach((o) => ctxMap.set(o.root, o.ctx));
    return out;
  }
  const getRoots = () => R || (R = roots());
  function qa(sel) {
    const res = [];
    getRoots().forEach(({ root }) => { $$(sel, root).forEach((el) => { if (!inUI(el)) res.push(el); }); });
    return res;
  }
  const ctxOf = (el) => {
    const r = el.getRootNode && el.getRootNode();
    return ctxMap.get(r) || (r && r.host ? 'shadow' : (el.ownerDocument !== document ? 'iframe' : 'main'));
  };

  // ── redaksi & serialisasi ───────────────────────────────────────────────
  const JWT = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g;
  const SECRET_KV = /("(?:csrf_token|session_id|access_token|refresh_token|id_token|token|password|passwd|api_key|apikey|secret|authorization)"\s*:\s*)"[^"]*"/gi;
  const redactStr = (s) => String(s).replace(JWT, '«JWT»').replace(SECRET_KV, '$1"«redacted»"');
  const SENS_H = /^(authorization|cookie|set-cookie|x-csrf|x-xsrf|x-api-key|x-auth|proxy-authorization)/i;
  const SENS_Q = /sign|token|key|secret|auth|credential|password|session|csrf|expires|x-amz/i;
  const SENS_B = /token|secret|password|passwd|authorization|cookie|credential|session_id|csrf|otp|pin$/i;
  const NOISE = /\.(png|jpe?g|gif|webp|avif|svg|ico|css|woff2?|ttf|otf|js|map|mp4|webm)(\?|$)|\/_next\/(static|image)|[?&]_rsc=|\/web\/(static|assets|image)|\/longpolling|\/bus\/|google-analytics|googletagmanager|gstatic|doubleclick|sentry|hotjar|clarity\.ms|facebook\.|segment\.|mixpanel|newrelic|datadog|amplitude|\/beacon|\/collect(\?|$)/i;
  const BINARY = /image|font|video|audio|octet-stream|pdf|zip|event-stream/i;
  const interesting = (r) => r.method !== 'GET' || /graphql|\/api\/|ajax|rpc|upload|presign|call_kw|dataset|\.json|search|query|submit|save|create|update/i.test(r.url) || /json/i.test(r.contentType || '');

  function cleanUrl(u) {
    try {
      const x = new URL(u, location.href);
      const q = [];
      x.searchParams.forEach((v, k) => q.push(k + '=' + (SENS_Q.test(k) ? '«redacted»' : cut(v, 80))));
      return x.origin + x.pathname + (q.length ? '?' + q.join('&') : '') + (x.hash && x.hash.length < 120 ? x.hash : '');
    } catch (e) { return cut(u, 200); }
  }

  function shrink(v, key, depth) {
    depth = depth || 0;
    if (v == null) return v;
    if (typeof v === 'string') {
      if (/^(query|mutation)$/.test(key)) return cut(redactStr(v), 4000);
      if (/^data:/.test(v)) return '«data-uri ' + v.length + '»';
      if (v.length > 400 && /^[A-Za-z0-9+/=_-]+$/.test(v.slice(0, 200))) return '«base64/opaque ' + v.length + ' karakter»';
      return cut(redactStr(v), 300);
    }
    if (typeof v !== 'object') return v;
    if (depth > 9) return '«terlalu dalam»';
    if (Array.isArray(v)) {
      const a = v.slice(0, 30).map((x) => shrink(x, key, depth + 1));
      if (v.length > 30) a.push('«+' + (v.length - 30) + ' item»');
      return a;
    }
    const o = {};
    Object.keys(v).slice(0, 80).forEach((k) => { o[k] = SENS_B.test(k) ? '«redacted»' : shrink(v[k], k, depth + 1); });
    return o;
  }
  const parseMaybe = (s) => { try { return shrink(JSON.parse(s)); } catch (e) { return cut(redactStr(s), 800); } };

  function ser(body) {
    if (body == null) return null;
    if (typeof body === 'string') return parseMaybe(body);
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      const rows = [];
      body.forEach((v, k) => {
        const isFile = typeof File !== 'undefined' && v instanceof File;
        rows.push([k, isFile ? '«File ' + v.name + ' · ' + v.type + ' · ' + v.size + 'B»' : (SENS_B.test(k) ? '«redacted»' : cut(redactStr(v), 300))]);
      });
      return { formData: rows };
    }
    if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return { urlencoded: cut(redactStr(body.toString()), 600) };
    if (typeof Blob !== 'undefined' && body instanceof Blob) return '«Blob ' + body.type + ' · ' + body.size + 'B»';
    if (body && body.byteLength !== undefined) return '«binary ' + body.byteLength + 'B»';
    return cut(String(body), 200);
  }

  function gqlOf(b) {
    try {
      const o = typeof b === 'string' ? JSON.parse(b) : b;
      const g = (Array.isArray(o) ? o : [o]).filter((x) => x && (x.query || x.operationName)).map((x) => ({
        op: x.operationName || (String(x.query || '').match(/(?:query|mutation|subscription)\s+(\w+)/) || [])[1],
        type: (String(x.query || '').match(/^\s*(query|mutation|subscription)/) || [])[1]
      }));
      return g.length ? g : null;
    } catch (e) { return null; }
  }

  function hdrs(h) {
    const o = {};
    try {
      if (!h) return o;
      const put = (k, v) => { o[k] = SENS_H.test(k) ? (/^authorization$/i.test(k) ? clean(String(v)).split(' ')[0] + ' «redacted»' : '«redacted»') : cut(redactStr(v), 120); };
      if (typeof Headers !== 'undefined' && h instanceof Headers) h.forEach((v, k) => put(k, v));
      else if (Array.isArray(h)) h.forEach((p) => put(p[0], p[1]));
      else Object.keys(h).forEach((k) => put(k, h[k]));
    } catch (e) { /* abaikan */ }
    return o;
  }

  function setResp(rec, text, ct) {
    ct = ct || '';
    try {
      if (BINARY.test(ct)) { rec.resp = '«' + ct + '»'; return; }
      if (/json/i.test(ct) || /^\s*[[{]/.test(text)) {
        try {
          const sh = shrink(JSON.parse(text)); const s = JSON.stringify(sh);
          rec.resp = s.length <= CONFIG.maxResp ? sh : cut(s, CONFIG.maxResp);
        } catch (e) { rec.resp = cut(redactStr(text), 1500); }
      } else if (/html/i.test(ct)) {
        rec.resp = '«html ' + text.length + ' karakter» ' + cut(clean(text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, ' ')), 300);
      } else rec.resp = cut(redactStr(text), 1500);
    } catch (e) { /* abaikan */ }
  }

  const push = (rec) => { if (stepSeq) rec.afterStep = stepSeq; state.net.push(rec); if (state.net.length > CONFIG.maxNet) state.net.shift(); };

  // ── hook fetch / XHR / WebSocket / history ──────────────────────────────
  const orig = {
    fetch: window.fetch, WS: window.WebSocket,
    xhrOpen: XMLHttpRequest.prototype.open, xhrSend: XMLHttpRequest.prototype.send, xhrSet: XMLHttpRequest.prototype.setRequestHeader,
    push: history.pushState, replace: history.replaceState
  };

  if (orig.fetch) {
    window.fetch = function (input, init) {
      let rec = null; const t0 = Date.now();
      try {
        const isReq = typeof Request !== 'undefined' && input instanceof Request;
        const url = isReq ? input.url : String(input);
        if (!NOISE.test(url)) {
          const method = String((init && init.method) || (isReq && input.method) || 'GET').toUpperCase();
          const hasInitBody = !!(init && init.body != null);
          rec = { n: ++netSeq, kind: 'fetch', t: since(), method, url: cleanUrl(url), reqHeaders: hdrs((init && init.headers) || (isReq ? input.headers : null)), body: hasInitBody ? ser(init.body) : null };
          if (hasInitBody && typeof init.body === 'string') { const g = gqlOf(init.body); if (g) rec.gql = g; }
          if (isReq && !hasInitBody && method !== 'GET' && method !== 'HEAD') {
            try { input.clone().text().then((x) => { rec.body = ser(x); const g = gqlOf(x); if (g) rec.gql = g; }, () => {}); } catch (e) { /* abaikan */ }
          }
          push(rec);
        }
      } catch (e) { rec = null; }
      const p = orig.fetch.apply(this, arguments);
      if (rec) {
        p.then((res) => {
          try {
            rec.status = res.status; rec.ms = Date.now() - t0;
            const ct = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
            const cl = +((res.headers && res.headers.get && res.headers.get('content-length')) || 0);
            rec.contentType = ct;
            if (BINARY.test(ct) || cl > 3e6) { rec.resp = '«' + ct + ' ' + cl + 'B»'; return; }
            res.clone().text().then((x) => setResp(rec, x, ct), () => {});
          } catch (e) { /* abaikan */ }
        }, (err) => { rec.error = String((err && err.message) || err); });
      }
      return p;
    };
  }

  XMLHttpRequest.prototype.open = function (m, u) {
    try { this.__cap = { method: String(m).toUpperCase(), url: String(u), headers: {} }; } catch (e) { /* abaikan */ }
    return orig.xhrOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    try { if (this.__cap) this.__cap.headers[k] = v; } catch (e) { /* abaikan */ }
    return orig.xhrSet.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    const c = this.__cap;
    if (c && !NOISE.test(c.url)) {
      try {
        const t0 = Date.now();
        const rec = { n: ++netSeq, kind: 'xhr', t: since(), method: c.method, url: cleanUrl(c.url), reqHeaders: hdrs(c.headers), body: body != null ? ser(body) : null };
        if (typeof body === 'string') { const g = gqlOf(body); if (g) rec.gql = g; }
        push(rec);
        this.addEventListener('loadend', () => {
          rec.status = this.status; rec.ms = Date.now() - t0;
          try {
            rec.contentType = this.getResponseHeader('content-type') || '';
            if (!this.responseType || this.responseType === 'text') setResp(rec, this.responseText || '', rec.contentType);
            else rec.resp = '«' + this.responseType + '»';
          } catch (e) { /* abaikan */ }
        });
      } catch (e) { /* abaikan */ }
    }
    return orig.xhrSend.apply(this, arguments);
  };

  if (orig.WS) {
    window.WebSocket = function (url, protocols) {
      const ws = protocols !== undefined ? new orig.WS(url, protocols) : new orig.WS(url);
      try {
        const rec = { n: ++netSeq, t: since(), url: cleanUrl(url), msgs: [] };
        state.ws.push(rec);
        const add = (dir, d) => { if (rec.msgs.length < 40) rec.msgs.push([since(), dir, typeof d === 'string' ? cut(redactStr(d), 300) : '«binary»']); };
        ws.addEventListener('message', (e) => add('in', e.data));
        const send = ws.send; ws.send = function (d) { add('out', d); return send.apply(this, arguments); };
      } catch (e) { /* abaikan */ }
      return ws;
    };
    window.WebSocket.prototype = orig.WS.prototype;
    ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach((k) => { window.WebSocket[k] = orig.WS[k]; });
  }

  function schedAuto() {
    if (!CONFIG.autoNav) return;
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => { if (location.href === lastAutoKey) return; lastAutoKey = location.href; snap('nav (auto)', true); }, 1500);
  }
  history.pushState = function () { try { state.nav.push({ t: since(), via: 'pushState', url: cleanUrl(String(arguments[2])) }); schedAuto(); } catch (e) { /* abaikan */ } return orig.push.apply(this, arguments); };
  history.replaceState = function () { try { state.nav.push({ t: since(), via: 'replaceState', url: cleanUrl(String(arguments[2])) }); schedAuto(); } catch (e) { /* abaikan */ } return orig.replace.apply(this, arguments); };
  const onNav = (e) => { state.nav.push({ t: since(), via: e.type, url: cleanUrl(location.href) }); schedAuto(); };
  window.addEventListener('popstate', onNav);
  window.addEventListener('hashchange', onNav);

  // ── selector ────────────────────────────────────────────────────────────
  const STABLE_ATTR = ['data-testid', 'data-test', 'data-cy', 'data-qa', 'data-automation-id', 'data-id', 'data-name', 'name', 'aria-label', 'placeholder', 'title'];
  const stableId = (id) => !!id && !/\d{4,}|^:r|react-select|^radix|headlessui|^mui-|[a-f0-9]{8}-[a-f0-9]{4}|^ember|^\d/i.test(id);
  const attrSel = (el, a) => el.tagName.toLowerCase() + '[' + a + '="' + String(el.getAttribute(a)).replace(/["\\]/g, '\\$&') + '"]';

  function cssOf(el) {
    const root = el.getRootNode();
    const q = (s) => { try { return root.querySelectorAll(s); } catch (e) { return []; } };
    if (stableId(el.id)) { const s = '#' + esc(el.id); if (q(s).length === 1) return { css: s, unique: true }; }
    for (const a of STABLE_ATTR) {
      const v = el.getAttribute(a);
      if (v && v.length < 80) { const s = attrSel(el, a); if (q(s).length === 1) return { css: s, unique: true }; }
    }
    const parts = []; let e = el, s = '';
    for (let i = 0; e && e.nodeType === 1 && i < 12; i++) {
      let p = e.tagName.toLowerCase();
      if (stableId(e.id)) { parts.unshift(p + '#' + esc(e.id)); s = parts.join(' > '); break; }
      const cls = Array.from(e.classList).filter((c) => !/^(css-|sc-|jsx-|svelte-|chakra-|emotion-)|\d{4,}/.test(c)).slice(0, 2);
      if (cls.length) p += '.' + cls.map(esc).join('.');
      const par = e.parentElement;
      if (par) { const sib = Array.from(par.children).filter((x) => x.tagName === e.tagName); if (sib.length > 1) p += ':nth-of-type(' + (sib.indexOf(e) + 1) + ')'; }
      parts.unshift(p); s = parts.join(' > ');
      if (q(s).length === 1) break;
      e = par;
    }
    return { css: s, unique: q(s).length === 1 };
  }

  function xpathOf(el) {
    const seg = [];
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      if (stableId(e.id)) return '//*[@id="' + e.id + '"]' + (seg.length ? '/' + seg.join('/') : '');
      const sib = e.parentElement ? Array.from(e.parentElement.children).filter((x) => x.tagName === e.tagName) : [e];
      seg.unshift(e.tagName.toLowerCase() + (sib.length > 1 ? '[' + (sib.indexOf(e) + 1) + ']' : ''));
    }
    return '/' + seg.join('/');
  }
  function selOf(el) { const o = cssOf(el); if (!o.unique) o.xpath = xpathOf(el); if (o.unique) delete o.unique; else o.unique = false; return o; }

  // ── form controls ───────────────────────────────────────────────────────
  const WRAP = '[class*="select__control"], .ant-select, .select2-container';
  const CTRL_SEL = 'input:not([type="hidden"]), textarea, select, [contenteditable=""], [contenteditable="true"], [role="combobox"], [role="textbox"], [role="searchbox"], [role="switch"], [role="checkbox"], [role="radio"], [role="slider"], [role="spinbutton"], [aria-haspopup]:not(a):not([role="menuitem"]), ' + WRAP;
  const MENU_INNER = '[role="listbox"], [role="menu"], [class*="select__menu"], .ant-select-dropdown, .select2-dropdown';

  function ctlText(lab) {
    const c = lab.cloneNode(true);
    $$('input, select, textarea, button, svg', c).forEach((n) => n.remove());
    return clean(c.textContent);
  }

  function labelOf(el) {
    const doc = el.ownerDocument;
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const t = clean(by.split(/\s+/).map((id) => { const n = doc.getElementById(id); return n ? n.textContent : ''; }).join(' '));
      if (t) return { text: t, src: 'aria-labelledby' };
    }
    if (el.labels && el.labels.length) { const t = ctlText(el.labels[0]); if (t) return { text: t, src: 'label-for' }; }
    const al = el.getAttribute('aria-label'); if (al) return { text: clean(al), src: 'aria-label' };
    const wl = el.closest('label'); if (wl) { const t = ctlText(wl); if (t) return { text: t, src: 'label-wrap' }; }
    let node = el.closest(WRAP) || el;
    for (let up = 0; node && up < 5; up++, node = node.parentElement) {
      let sib = node.previousElementSibling;
      for (let k = 0; sib && k < 3; k++, sib = sib.previousElementSibling) {
        if (sib.querySelector && sib.querySelector('input, select, textarea')) break;
        const t = clean(sib.textContent);
        if (t && t.length <= 120) return { text: t, src: 'proximity' };
      }
      const par = node.parentElement;
      if (par) {
        const lk = par.querySelector(':scope > label, :scope > legend, :scope > [class*="label"], :scope > [class*="title"], :scope > strong, :scope > b');
        if (lk && lk !== node && !lk.contains(el)) { const t = clean(lk.textContent); if (t && t.length <= 120) return { text: t, src: 'wrapper-label' }; }
      }
    }
    const ph = el.getAttribute('placeholder'); if (ph) return { text: clean(ph), src: 'placeholder' };
    return { text: '', src: '' };
  }

  function splitLabel(raw) {
    let t = clean(raw), req = null;
    t = t.replace(/\s*\d+\s*\/\s*\d+\s*$/, ''); // penghitung karakter "0/100"
    const m = t.match(/\s+(wajib|opsional|required|optional|mandatory)\s*$/i) || t.match(/^(wajib|opsional|required|optional|mandatory)\s+/i);
    if (m) { req = /wajib|required|mandatory/i.test(m[1]); t = clean(t.replace(m[0], ' ')); }
    if (/\*+\s*$/.test(t) || /^\*+/.test(t)) { if (req == null) req = true; t = clean(t.replace(/\*+/g, ' ')); }
    return { label: t, req };
  }

  function helpErr(el) {
    const out = {};
    const dby = el.getAttribute('aria-describedby');
    if (dby) {
      const t = clean(dby.split(/\s+/).map((id) => { const n = el.ownerDocument.getElementById(id); return n ? n.textContent : ''; }).join(' '));
      if (t) out.help = cut(t, 300);
    }
    let wrap = el.closest('[class*="field"], [class*="form-group"], [class*="FormControl"], [class*="form-item"], .mb-3') || (el.parentElement && el.parentElement.parentElement);
    if (wrap && $$('input:not([type="hidden"]), select, textarea', wrap).length > 3) wrap = el.parentElement;
    if (wrap) {
      $$('[class*="help"], [class*="hint"], [class*="desc"], [class*="error"], [class*="invalid"], [class*="feedback"], [role="alert"], small', wrap).some((n) => {
        if (n.contains(el) || n.querySelector('input, select, textarea')) return false;
        const t = clean(n.textContent);
        if (!t || t.length > 300) return false;
        const isErr = /error|invalid|danger|feedback/i.test(String(n.className)) || n.getAttribute('role') === 'alert';
        if (isErr) { if (!out.error) out.error = t; } else if (!out.help) out.help = cut(t, 300);
        return !!(out.help && out.error);
      });
    }
    return out;
  }

  function regionOf(el) {
    if (el.closest('dialog, [role="dialog"], [role="alertdialog"], .modal, [aria-modal="true"]')) return 'dialog';
    const map = [['nav, [role="navigation"]', 'nav'], ['header, [role="banner"]', 'header'], ['footer, [role="contentinfo"]', 'footer'], ['aside, [role="complementary"]', 'aside'], ['main, [role="main"]', 'main']];
    for (const [s, n] of map) if (el.closest(s)) return n;
    return 'body';
  }

  function maskedVal(el, v) {
    if (v == null || typeof v === 'boolean') return v;
    const t = (el.type || '').toLowerCase();
    const ac = (el.getAttribute && el.getAttribute('autocomplete')) || '';
    if (t === 'password' || /^(cc-|one-time|current-password|new-password)/.test(ac)) return '«masked»';
    if (CONFIG.maskValues && !/^(checkbox|radio)$/.test(t) && el.tagName !== 'SELECT') return '«' + String(v).length + ' karakter»';
    return cut(redactStr(v), 300);
  }
  const valueOf = (el) => maskedVal(el, (el.type === 'checkbox' || el.type === 'radio') ? !!el.checked : ('value' in el ? el.value : txt(el)));

  function kindOf(el) {
    if (el.matches(WRAP)) return 'custom-select';
    const tag = el.tagName, t = (el.type || '').toLowerCase();
    if (tag === 'SELECT') return 'select';
    if (tag === 'TEXTAREA') return 'textarea';
    if (tag === 'INPUT') return t === 'file' ? 'file' : (t || 'text');
    const r = el.getAttribute('role'); if (r) return 'aria-' + r;
    if (el.isContentEditable) return 'contenteditable';
    if (el.hasAttribute('aria-haspopup')) return 'popup-trigger';
    return tag.toLowerCase();
  }

  function describe(el) {
    const at = (n) => el.getAttribute(n);
    const d = { kind: kindOf(el) };
    const lb = labelOf(el), sl = splitLabel(lb.text);
    d.label = sl.label; d.labelSrc = lb.src;
    let req = sl.req;
    if (el.required || at('aria-required') === 'true') req = true;
    if (req != null) d.required = req;
    if (el.matches(WRAP)) {
      const sv = $$('[class*="single-value"], [class*="multi-value__label"], .ant-select-selection-item, .select2-selection__rendered', el).map(txt).filter(Boolean);
      d.value = sv.length > 1 ? sv : (sv[0] || '');
      const ph = el.querySelector('[class*="placeholder"], .select2-selection__placeholder'); if (ph) d.placeholder = txt(ph);
      const inp = el.querySelector('input'); if (inp && inp.disabled) d.disabled = true;
      if (el.querySelector('[class*="multi-value"], .ant-select-selection-overflow')) d.multiple = true;
      d.ui = /ant-select/.test(el.className) ? 'antd' : (/select2/.test(el.className) ? 'select2' : 'react-select');
    } else {
      ['type', 'name', 'id', 'placeholder', 'maxlength', 'minlength', 'min', 'max', 'step', 'pattern', 'accept', 'autocomplete', 'inputmode', 'role', 'aria-haspopup', 'aria-expanded', 'aria-invalid', 'data-testid'].forEach((n) => {
        const v = at(n);
        if (v != null && v !== '' && !(n === 'type' && d.kind === v)) d[n] = cut(v, 120);
      });
      if (el.multiple) d.multiple = true;
      if (el.disabled || at('aria-disabled') === 'true') d.disabled = true;
      if (el.readOnly) d.readonly = true;
      const t = (el.type || '').toLowerCase();
      if (el.tagName === 'SELECT') {
        d.value = el.value;
        d.options = Array.from(el.options).slice(0, 80).map((o) => [o.value, clean(o.text)]);
      } else if (t === 'checkbox') d.checked = !!el.checked;
      else if (t === 'file') {
        d.files = Array.from(el.files || []).map((f) => f.name + ' · ' + f.type + ' · ' + f.size + 'B');
        let c = el.parentElement, slot = '';
        for (let i = 0; c && i < 4 && !slot; i++, c = c.parentElement) { const x = txt(c); if (x && x.length <= 60) slot = x; }
        if (slot) d.slot = slot;
        const dz = el.closest('[class*="dropzone"], [class*="Dropzone"], [class*="upload"]'); if (dz) d.dropzone = cut(txt(dz), 100);
        if (!vis(el)) d.hidden = true;
      } else if (t !== 'radio') d.value = valueOf(el);
      if (at('aria-checked') != null) d.checked = at('aria-checked') === 'true';
    }
    const odoo = el.closest('.o_field_widget[name]');
    if (odoo) d.odooField = odoo.getAttribute('name');
    Object.assign(d, helpErr(el));
    return d;
  }

  function collectControls() {
    const all = qa(CTRL_SEL).filter((el) => {
      if (el.closest(MENU_INNER)) return false;
      const w = el.closest(WRAP); if (w && w !== el) return false;
      if (el.type === 'file') return true;
      return vis(el);
    });
    return all.filter((el) => el.matches(WRAP) || !all.some((o) => o !== el && !o.matches(WRAP) && el.contains(o)));
  }

  function headingsList() {
    return qa('h1, h2, h3, h4, h5, h6, [role="heading"], legend, summary').filter(vis)
      .map((h) => ({ el: h, text: cut(txt(h), 100), tag: h.tagName.toLowerCase() })).filter((h) => h.text);
  }
  function sectionFor(el, heads) {
    let best = ''; const root = el.getRootNode();
    heads.forEach((h) => { if (h.el.getRootNode() === root && (h.el.compareDocumentPosition(el) & 4) && !h.el.contains(el)) best = h.text; });
    return best;
  }

  function optionLabel(el) {
    if (el.labels && el.labels[0]) return ctlText(el.labels[0]);
    const wl = el.closest('label'); if (wl) return ctlText(wl);
    return clean((el.nextSibling && el.nextSibling.textContent) || (el.nextElementSibling && el.nextElementSibling.textContent) || '');
  }

  function decorate(d, el, heads) {
    d.section = sectionFor(el, heads); d.region = regionOf(el);
    const c = ctxOf(el); if (c !== 'main') d.ctx = c;
    return d;
  }

  function describeAll(heads) {
    const out = [], radios = {};
    collectControls().forEach((el) => {
      if (el.type === 'radio' && el.name) {
        const key = ctxOf(el) + '|' + el.name;
        let g = radios[key];
        if (!g) {
          const fs = el.closest('fieldset, [role="radiogroup"]') || (el.parentElement && el.parentElement.parentElement) || el;
          const lb = labelOf(fs), sl = splitLabel(lb.text);
          g = decorate({ kind: 'radio-group', name: el.name, label: sl.label, labelSrc: lb.src, required: el.required ? true : (sl.req == null ? undefined : sl.req), options: [] }, el, heads);
          radios[key] = g; out.push(g);
        }
        g.options.push({ label: optionLabel(el), value: el.value, checked: !!el.checked, css: cssOf(el).css });
        return;
      }
      const d = decorate(describe(el), el, heads);
      Object.assign(d, selOf(el));
      out.push(compact(d));
    });
    return out.map((d) => compact(d));
  }

  // ── buttons, links, tables, repeaters ───────────────────────────────────
  function collectButtons() {
    const seen = new Set();
    return qa('button, [role="button"], input[type="submit"], input[type="button"], input[type="reset"], summary')
      .filter((b) => vis(b) && !b.closest(MENU_INNER))
      .map((b) => {
        const text = cut(txt(b) || b.value || b.getAttribute('aria-label') || b.title || '', 60);
        const o = { text, region: regionOf(b), disabled: !!(b.disabled || b.getAttribute('aria-disabled') === 'true') || undefined, type: b.getAttribute('type') || undefined };
        const k = o.text + '|' + o.region + '|' + o.disabled;
        if (!text || seen.has(k)) return null;
        seen.add(k); Object.assign(o, selOf(b)); return compact(o);
      }).filter(Boolean).slice(0, CONFIG.maxButtons);
  }

  function collectLinks() {
    const seen = new Set();
    return qa('a[href]').filter((a) => vis(a) && !a.getAttribute('href').startsWith('javascript:')).map((a) => {
      const text = cut(txt(a) || a.getAttribute('aria-label') || '', 60);
      let href = a.getAttribute('href');
      try { const u = new URL(href, location.href); href = u.origin === location.origin ? u.pathname + u.search : u.origin + u.pathname; } catch (e) { /* abaikan */ }
      const k = text + '|' + href;
      if (!text || seen.has(k)) return null;
      seen.add(k); return { text, href: cut(href, 140), region: regionOf(a) };
    }).filter(Boolean).slice(0, CONFIG.maxLinks);
  }

  function collectTables() {
    return qa('table, [role="grid"], [role="table"], [role="treegrid"]').filter((t) => vis(t) && !t.parentElement.closest('table')).slice(0, 12).map((t) => {
      const headers = $$('thead th, [role="columnheader"]', t).map((h) => cut(txt(h), 60));
      const rowEls = $$('tr, [role="row"]', t).filter((r) => r.querySelector('td, [role="cell"], [role="gridcell"]'));
      const cellsOf = (r) => $$(':scope > td, :scope > [role="cell"], :scope > [role="gridcell"]', r);
      const colKeys = rowEls.length ? cellsOf(rowEls[0]).map((c) => c.getAttribute('data-name') || c.getAttribute('data-field') || c.getAttribute('data-col-id') || c.getAttribute('data-column') || '') : [];
      const o = { selector: cssOf(t).css, region: regionOf(t), headers, rowCount: rowEls.length, rows: rowEls.slice(0, CONFIG.maxRows).map((r) => cellsOf(r).map((c) => cut(txt(c), 120))) };
      if (colKeys.some(Boolean)) o.colKeys = colKeys;
      return o;
    });
  }

  function collectRepeaters() {
    const res = [];
    qa('div, ul, ol, section, tbody, main').forEach((p) => {
      if (p.children.length < 4 || p.closest('nav, header, footer, select, ' + MENU_INNER)) return;
      const g = {};
      Array.from(p.children).forEach((c) => {
        const k = c.tagName.toLowerCase() + Array.from(c.classList).filter((x) => !/\d{4,}/.test(x)).slice(0, 3).map((x) => '.' + esc(x)).join('');
        (g[k] = g[k] || []).push(c);
      });
      Object.keys(g).forEach((k) => {
        const items = g[k]; if (items.length < 4 || !vis(items[0])) return;
        const avg = items.reduce((a, c) => a + txt(c).length, 0) / items.length;
        if (avg >= 12) res.push({ parent: p, k, count: items.length, avg, items });
      });
    });
    res.sort((a, b) => b.count * b.avg - a.count * a.avg);
    const out = [];
    for (const r of res) {
      if (out.some((o) => o.parent.contains(r.parent) || r.parent.contains(o.parent))) continue;
      out.push(r); if (out.length >= 4) break;
    }
    return out.map((r) => ({ container: cssOf(r.parent).css, itemCss: r.k, count: r.count, sample: r.items.slice(0, 3).map((c) => cut(txt(c), 200)) }));
  }

  // ── overlay: menu / dialog / alert ──────────────────────────────────────
  const MENU_SEL = '[role="listbox"], [role="menu"], [class*="select__menu"], [class*="dropdown-menu"], [class*="popover"], [class*="cascader"], [class*="autocomplete"], .ant-select-dropdown, .select2-dropdown, .ui-autocomplete, [class*="MuiPopover"], [class*="MuiMenu"], [data-radix-popper-content-wrapper], [class*="popper"]';
  const DSEL = 'dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"], .modal.show, .modal.o_technical_modal';
  const ALERT_SEL = '[role="alert"], [role="status"], [class*="toast"], [class*="Toastify"], [class*="snackbar"], [class*="notification"], [class*="alert"], [class*="flash"]';

  function menuInfo(m, maxLines) {
    const lines = itext(m).split('\n').map(clean).filter(Boolean);
    if (!lines.length) return null;
    const o = { cls: cut(String(m.className), 80), lines: lines.slice(0, maxLines) };
    let opts = $$('[role="option"], [role="menuitem"], [role="treeitem"]', m);
    if (!opts.length) opts = $$('[class*="option"]', m).filter((x) => !x.querySelector('[class*="option"]'));
    if (opts.length) {
      o.items = opts.slice(0, maxLines).map((x) => compact({
        text: cut(txt(x), 100),
        selected: (x.getAttribute('aria-selected') === 'true' || /selected|checked/.test(String(x.className))) || undefined,
        disabled: x.getAttribute('aria-disabled') === 'true' || undefined
      }));
    }
    const lists = $$('ul, [role="listbox"], [class*="column"]', m).filter((l) => !l.querySelector('ul, [role="listbox"], [class*="column"]'));
    const cols = lists.map((l) => itext(l).split('\n').map(clean).filter(Boolean)).filter((a) => a.length);
    if (cols.length > 1) o.cols = cols.map((c) => c.slice(0, 150));
    const active = $$('[aria-selected="true"], [class*="selected"], [class*="active"]', m).map(txt).filter(Boolean).slice(0, 8);
    if (active.length) o.active = active;
    return o;
  }

  function getOverlays(maxLines) {
    const menus = qa(MENU_SEL).filter((m) => vis(m) && !(m.parentElement && m.parentElement.closest(MENU_SEL))).map((m) => menuInfo(m, maxLines)).filter(Boolean).slice(0, 6);
    const dialogs = qa(DSEL).filter((d) => vis(d) && !(d.parentElement && d.parentElement.closest(DSEL))).slice(0, 4).map((d) => {
      const h = d.querySelector('h1, h2, h3, h4, [class*="title"], [role="heading"]');
      return compact({ title: h ? cut(txt(h), 100) : '', text: cut(txt(d), 800), buttons: $$('button, [role="button"]', d).filter(vis).map((b) => cut(txt(b), 40)).filter(Boolean).slice(0, 12), css: cssOf(d).css });
    });
    const seen = new Set();
    const alerts = qa(ALERT_SEL).filter(vis).map(txt).filter((t) => t && t.length <= 300 && !seen.has(t) && seen.add(t)).slice(0, 8);
    return { menus, dialogs, alerts };
  }

  // ── steps (rekam aksi user) ─────────────────────────────────────────────
  const INTERACTIVE = 'button, a[href], [role="button"], [role="option"], [role="menuitem"], [role="tab"], [role="treeitem"], [role="checkbox"], [role="radio"], [role="switch"], input, select, textarea, label, summary, li, [onclick], [tabindex]';

  function target(el) {
    const t = el.closest ? (el.closest(INTERACTIVE) || el) : el;
    const d = { tag: t.tagName.toLowerCase() };
    const role = t.getAttribute('role'); if (role) d.role = role;
    d.text = cut(txt(t), 80);
    if (t.matches(CTRL_SEL)) { const lb = splitLabel(labelOf(t).text).label; if (lb) d.label = lb; if (t.name) d.name = t.name; }
    Object.assign(d, selOf(t));
    d.region = regionOf(t);
    const c = ctxOf(t); if (c !== 'main') d.ctx = c;
    return compact(d);
  }

  function settle(s) {
    const before = location.href;
    setTimeout(() => {
      try {
        R = null;
        if (location.href !== before) s.urlAfter = cleanUrl(location.href);
        const ov = getOverlays(80);
        [['menus', 'opened'], ['dialogs', 'dialogs'], ['alerts', 'alerts']].forEach(([k, name]) => {
          const sig = JSON.stringify(ov[k]);
          if (sig !== lastOv[k]) { lastOv[k] = sig; if (ov[k].length) s[name] = ov[k]; }
        });
      } catch (e) { /* abaikan */ }
    }, 700);
  }

  function addStep(type, el, extra, force) {
    if ((paused || !CONFIG.recordSteps) && !force) return null;
    const s = Object.assign({ n: ++stepSeq, t: since(), type, path: location.pathname + location.hash }, extra || {});
    try { if (el) s.target = target(el); } catch (e) { /* abaikan */ }
    state.steps.push(s);
    if (state.steps.length > CONFIG.maxSteps) state.steps.shift();
    if (type !== 'note') settle(s);
    return s;
  }

  const pathEl = (e) => { const el = (e.composedPath && e.composedPath()[0]) || e.target; return el && el.nodeType === 1 ? el : null; };
  const L = [
    ['click', (e) => { const el = pathEl(e); if (el && !inUI(el)) addStep('click', el); }],
    ['change', (e) => {
      const el = pathEl(e); if (!el || inUI(el)) return;
      addStep('change', el, el.type === 'file' ? { files: Array.from(el.files || []).map((f) => f.name + ' · ' + f.type + ' · ' + f.size + 'B') } : { value: valueOf(el) });
    }],
    ['input', (e) => {
      const el = pathEl(e);
      if (!el || inUI(el) || /^(checkbox|radio|file|range|color)$/.test(el.type || '')) return;
      clearTimeout(el.__capT); el.__capT = setTimeout(() => addStep('input', el, { value: valueOf(el) }), 700);
    }],
    ['submit', (e) => { const el = pathEl(e); if (el) addStep('submit', el, { action: cleanUrl(el.action || ''), method: el.method }); }],
    ['drop', (e) => {
      const el = pathEl(e);
      if (el && !inUI(el)) addStep('drop', el, { files: Array.from((e.dataTransfer && e.dataTransfer.files) || []).map((f) => f.name + ' · ' + f.type + ' · ' + f.size + 'B') });
    }],
    ['keydown', (e) => {
      if (e.altKey && e.shiftKey) {
        if (e.code === 'KeyS') { e.preventDefault(); snap(); }
        else if (e.code === 'KeyD') { e.preventDefault(); dump(); }
        else if (e.code === 'KeyP') { e.preventDefault(); paused = !paused; toast(paused ? '⏸ rekam steps di-pause' : '⏺ rekam steps lanjut'); }
        return;
      }
      if (e.key === 'Enter' || e.key === 'Escape') { const el = pathEl(e); if (el && !inUI(el)) addStep('key', el, { key: e.key }); }
    }]
  ];
  L.forEach(([t, fn]) => window.addEventListener(t, fn, true));

  const mo = new MutationObserver((muts) => {
    if (!CONFIG.autoDialog) return;
    let hit = false;
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeType === 1 && !inUI(n) && ((n.matches && n.matches(DSEL)) || (n.querySelector && n.querySelector(DSEL)))) { hit = true; break; }
      }
      if (hit) break;
    }
    if (!hit) return;
    clearTimeout(moTimer); moTimer = setTimeout(() => snap('dialog (auto)', true), 900);
  });
  try { mo.observe(document.documentElement, { childList: true, subtree: true }); } catch (e) { /* abaikan */ }

  // ── snapshot ────────────────────────────────────────────────────────────
  function frameworks() {
    const f = [], w = window, d = document;
    try {
      const hook = w.__REACT_DEVTOOLS_GLOBAL_HOOK__;
      if (w.React || d.querySelector('[data-reactroot]') || (hook && hook.renderers && hook.renderers.size)) f.push('react');
      if (d.getElementById('__next') || w.__NEXT_DATA__) f.push('next');
      if (w.__NUXT__ || w.$nuxt) f.push('nuxt');
      const app = d.querySelector('#app, #root');
      if (w.Vue || w.__VUE__ || (app && (app.__vue_app__ || app.__vue__)) || d.querySelector('[data-v-app]')) f.push('vue');
      if (d.querySelector('[ng-version]')) f.push('angular');
      if (w.odoo) f.push('odoo');
      if (w.jQuery) f.push('jquery ' + (w.jQuery.fn && w.jQuery.fn.jquery || ''));
      ['htmx', 'Livewire', 'Alpine', 'Ember'].forEach((k) => { if (w[k]) f.push(k.toLowerCase()); });
    } catch (e) { /* abaikan */ }
    return f;
  }

  function meta() {
    let ls = [], ss = [];
    try { ls = Object.keys(localStorage); } catch (e) { /* abaikan */ }
    try { ss = Object.keys(sessionStorage); } catch (e) { /* abaikan */ }
    let rf = [];
    try {
      rf = performance.getEntriesByType('resource').filter((e) => /fetch|xmlhttprequest/.test(e.initiatorType) && !NOISE.test(e.name))
        .slice(-150).map((e) => ({ url: cleanUrl(e.name), type: e.initiatorType, ms: Math.round(e.duration) }));
    } catch (e) { /* abaikan */ }
    return {
      url: cleanUrl(location.href), title: document.title, lang: document.documentElement.lang, ua: navigator.userAgent,
      viewport: [innerWidth, innerHeight], frameworks: frameworks(),
      localStorageKeys: ls.slice(0, 60), sessionStorageKeys: ss.slice(0, 60),
      cookieNames: document.cookie.split(';').map((c) => c.split('=')[0].trim()).filter(Boolean).slice(0, 40),
      resourceFetches: rf
    };
  }

  function snap(label, auto) {
    R = null;
    const heads = headingsList();
    const controls = describeAll(heads);
    const ov = getOverlays(CONFIG.maxMenuLines);
    const keyOf = (c) => (c.css || c.name || '') + '|' + (c.label || '');
    const keys = new Set(controls.map(keyOf));
    const sig = Array.from(keys).join('~') + '#' + ov.dialogs.map((d) => d.title + (d.text || '').slice(0, 40)).join('|') + '#' + location.href;
    if (auto && sig === lastSig) return null;
    lastSig = sig;
    const s = {
      label: label || ('snap-' + (state.snaps.length + 1)), t: since(), url: cleanUrl(location.href), title: document.title,
      scroll: { y: Math.round(window.scrollY || 0), pageHeight: document.documentElement.scrollHeight, viewport: window.innerHeight },
      outline: heads.slice(0, 40).map((h) => h.tag + ': ' + h.text),
      controls, buttons: collectButtons(), links: collectLinks(), tables: collectTables(), repeaters: collectRepeaters(),
      menus: ov.menus, dialogs: ov.dialogs, alerts: ov.alerts,
      textPreview: cut(clean(itext(document.body)), 1200)
    };
    if (prevKeys) {
      const added = controls.filter((c) => !prevKeys.has(keyOf(c))).map((c) => c.label || c.name || c.css);
      const gone = Array.from(prevKeys).filter((k) => !keys.has(k)).length;
      if (added.length) s.appeared = added.slice(0, 40);
      if (gone) s.disappearedCount = gone;
    }
    prevKeys = keys;
    ['menus', 'dialogs', 'alerts'].forEach((k) => { if (!s[k].length) delete s[k]; });
    if (!s.tables.length) delete s.tables;
    if (!s.repeaters.length) delete s.repeaters;
    state.snaps.push(s);
    toast('📸 Snapshot #' + state.snaps.length + ': ' + controls.length + ' field, ' + (ov.menus.length) + ' menu terbuka, ' + (ov.dialogs.length) + ' dialog');
    console.log('[cap] snapshot', s.label, s);
    return s;
  }

  // ── dump ────────────────────────────────────────────────────────────────
  const GUIDE = {
    purpose: 'Capture halaman web (read-only) untuk dibaca Claude dan dijadikan dasar userscript/automasi.',
    'snaps[]': 'Kondisi halaman saat snapshot: controls (field: label+labelSrc, required, kind, atribut, opsi, nilai, css/xpath), buttons, links, tables, repeaters, menus (dropdown terbuka), dialogs, alerts, appeared (field baru sejak snapshot sebelumnya).',
    'controls[].css': 'Selector terbaik. Kalau unique=false → tidak unik, pakai xpath atau kombinasi label+section. labelSrc: label-for/aria-* = yakin; proximity/wrapper-label = tebakan dari posisi.',
    'steps[]': 'Aksi user berurutan (click/input/change/key/submit/drop/note) + target + efek (urlAfter, opened=menu terbuka, dialogs, alerts). input = nilai akhir yang diketik.',
    'net[]': 'Request fetch/XHR. afterStep = nomor step pemicu terakhir. gql = operationName GraphQL. resp sudah dipangkas.',
    redaksi: 'Token/JWT/cookie/password diganti «redacted»/«masked».'
  };

  function download(name, text) {
    try {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      a.download = name; a.setAttribute('data-cap-ui', 'dl');
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    } catch (e) { console.warn('[cap] gagal download:', e); }
  }

  function dump(opts) {
    opts = opts || {};
    const net = opts.all ? state.net : state.net.filter(interesting);
    let out = {
      tool: 'universal_capture v' + VERSION, takenAt: new Date().toISOString(), guide: GUIDE,
      page: meta(), snaps: state.snaps, steps: state.steps, net, ws: state.ws, nav: state.nav,
      netCount: { recorded: state.net.length, shown: net.length },
      note: 'Authorization/cookie/JWT/password diredaksi. Cek sekali lagi sebelum dikirim.'
    };
    if (opts.light) {
      out = JSON.parse(JSON.stringify(out, (k, v) => (typeof v === 'string' && v.length > 200 ? cut(v, 200) : (Array.isArray(v) && v.length > 12 ? v.slice(0, 12).concat(['«+' + (v.length - 12) + '»']) : v))));
    }
    const json = JSON.stringify(out, null, 1);
    let host = 'page'; try { host = location.hostname.replace(/[^\w.-]/g, '_'); } catch (e) { /* abaikan */ }
    const d = new Date(), p2 = (n) => String(n).padStart(2, '0');
    const name = (opts.name || ('capture-' + host + '-' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '-' + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds()))) + '.json';
    download(name, json);
    try { navigator.clipboard.writeText(json).catch(() => {}); } catch (e) { /* abaikan */ }
    window.__cap.last = out;
    const kb = Math.round(json.length / 1024);
    toast('💾 Dump ' + kb + ' KB · ' + state.snaps.length + ' snapshot · ' + state.steps.length + ' step · ' + net.length + ' request' + (kb > 2500 ? ' — besar, coba dump({light:true})' : ''));
    console.log('[cap] dump selesai — ' + name + ' (' + kb + ' KB), juga ke clipboard.');
    return out;
  }

  // ── API ─────────────────────────────────────────────────────────────────
  window.__cap = {
    config: CONFIG, snap, dump, sel: (el) => selOf(el),
    note: (text) => addStep('note', null, { text: String(text) }, true),
    pause: () => { paused = true; toast('⏸ rekam steps di-pause'); },
    resume: () => { paused = false; toast('⏺ rekam steps lanjut'); },
    auto: (on) => { CONFIG.autoNav = !!on; CONFIG.autoDialog = !!on; toast('Auto-snapshot ' + (on ? 'ON' : 'OFF')); },
    net: () => state.net, steps: () => state.steps, snaps: () => state.snaps,
    reset: () => { state.snaps.length = 0; state.net.length = 0; state.steps.length = 0; state.nav.length = 0; state.ws.length = 0; stepSeq = 0; prevKeys = null; lastSig = ''; lastOv = { menus: '', dialogs: '', alerts: '' }; toast('Capture di-reset'); },
    uninstall: () => {
      window.fetch = orig.fetch; window.WebSocket = orig.WS;
      XMLHttpRequest.prototype.open = orig.xhrOpen; XMLHttpRequest.prototype.send = orig.xhrSend; XMLHttpRequest.prototype.setRequestHeader = orig.xhrSet;
      history.pushState = orig.push; history.replaceState = orig.replace;
      L.forEach(([t, fn]) => window.removeEventListener(t, fn, true));
      window.removeEventListener('popstate', onNav); window.removeEventListener('hashchange', onNav);
      try { mo.disconnect(); } catch (e) { /* abaikan */ }
      clearTimeout(autoTimer); clearTimeout(moTimer);
      $$('[data-cap-ui]').forEach((n) => n.remove());
      delete window.__cap;
      console.log('[cap] uninstall');
    }
  };

  lastAutoKey = location.href;
  toast('Capture aktif — Alt+Shift+S snapshot · Alt+Shift+D dump');
  console.log('%c[cap] aktif (v' + VERSION + ').%c Alt+Shift+S = snapshot · Alt+Shift+D = dump · Alt+Shift+P = pause steps · __cap.note("...") = catatan', 'font-weight:bold', '');
  snap('awal');
})();