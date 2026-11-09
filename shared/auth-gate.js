// shared/auth-gate.js
// ══════════════════════════════════════════
// THE single login gate for the whole app. Mounted ONCE by router.js, BEFORE any
// page module is ever mount()ed. No page module has its own login form or
// whitelist check; every routed module goes through exactly this one gate.
//
// POLICY NOTE: one shared gate can't have a different policy per destination
// module. The allowed_users whitelist check therefore applies to every module,
// including dashboard (whose original standalone page had no whitelist check at
// all -- anyone with valid Supabase credentials got in). A different rule for a
// single module would be a behavior change to request explicitly, not something
// to add silently here.
//
// The whitelist check is `select('email')` only (crud-produk's old per-page
// check also fetched `role`, but it was never read afterwards).
// ══════════════════════════════════════════

const VENDOR_CHAIN = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  '/shared/supabase-client.js',
  '/shared/auth-session.js',
];

// Turnstile dimuat terpisah (bukan lewat VENDOR_CHAIN) karena scriptnya
// self-render lewat data-attribute (lihat renderTurnstile() di bawah),
// beda pola dari vendor chain yang cuma nunggu window.* keisi.
const TURNSTILE_SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
const TURNSTILE_SITE_KEY = '0x4AAAAAAE7ZdN9sD0QXxxlE';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Gagal memuat ' + src));
    document.head.appendChild(s);
  });
}

let vendorReady = null;
function ensureVendorScripts() {
  if (window.PNMAuth && window.pnmSupabase) return Promise.resolve();
  if (!vendorReady) {
    vendorReady = VENDOR_CHAIN.reduce((p, src) => p.then(() => loadScript(src)), Promise.resolve());
  }
  return vendorReady;
}

let turnstileReady = null;
function ensureTurnstileScript() {
  if (window.turnstile) return Promise.resolve();
  if (!turnstileReady) turnstileReady = loadScript(TURNSTILE_SCRIPT_SRC);
  return turnstileReady;
}

// BUG (dilaporkan user, 28 Agustus 2026): gate tampil TAPI SAMA SEKALI GAK
// KE-STYLE (form polos gaya browser default). Root cause: `.auth-gate`/
// `.auth-gate-box`/`.pr-field` classes yang dipakai GATE_MARKUP di bawah
// datang dari `pnm-universal.css` -- tapi file ini TIDAK PERNAH nge-load
// stylesheet itu sendiri. Sebelum sesi kesembilan belas, ini gak masalah
// karena tiap halaman (dashboard/stok/dst) punya gate-nya SENDIRI di dalam
// markup-nya sendiri, dan halaman itu SENDIRI yang nge-load pnm-universal.css
// di mount()-nya. Begitu gate dipindah ke sini (level shell, sebelum
// halaman MANAPUN pernah di-mount()), gak ada lagi yang nge-load
// pnm-universal.css lebih dulu -- gate nongol duluan, sebelum satupun
// mount() page pernah jalan. id+href SAMA PERSIS kayak yang dipakai tiap
// page's SHARED_LINKS (dashboard/stok/crud-produk/export-gambar/konversian)
// biar dedup otomatis kalau kebetulan udah ke-load duluan.
const GATE_STYLE_LINKS = [
  { id: 'shared-google-fonts', href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400&display=swap' },
  // Khusus judul gate (redesign 2026-11-09). Cuma 1 family, 1 weight range, display=swap -> kalau telat/gagal
  // judul jatuh ke Inter, gate tetap kepakai.
  { id: 'pw-gate-title-font', href: 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700&display=swap' },
  { id: 'shared-pnm-universal-css', href: '/pnm-universal.css?v=20260813b' },
];

function loadLink(id, href) {
  if (document.getElementById(id)) return Promise.resolve();
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = () => resolve();
    link.onerror = () => resolve();
    document.head.appendChild(link);
  });
}

const GATE_CSS = `
#pw-gate{--g-panel:#e3e7ed;--g-tray:#eef1f5;--g-steel:#8a95a5;--g-steel-hi:#fbfcfd;--g-engrave:#7a8493;
  font-family:'Inter',system-ui,sans-serif;color:var(--text);background:var(--bg);align-items:stretch;justify-content:stretch}
html[data-theme="dark"] #pw-gate{--g-panel:#101112;--g-tray:#17191b;--g-steel:#626d7a;--g-steel-hi:#bcc6d1;--g-engrave:#6e7884}
#pw-gate .pwg-shell{width:100%;height:100%;display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr);overflow:auto}
#pw-gate .pwg-panel{background:var(--g-panel);border-right:1px solid var(--border);display:flex;align-items:center;justify-content:center;overflow:hidden;padding:4vh 3vw}
#pw-gate .pwg-tray{height:min(88vh,760px);aspect-ratio:3/4;max-width:100%;display:block}
#pw-gate .pwg-main{display:flex;align-items:center;justify-content:center;padding:32px 24px}
#pw-gate .pwg-card{width:100%;max-width:340px;display:flex;flex-direction:column;align-items:stretch;text-align:left}
#pw-gate .pwg-logo{height:30px;width:auto;align-self:flex-start;margin:0 0 44px;object-fit:contain}
#pw-gate .pwg-logo-dark{display:none}
html[data-theme="dark"] #pw-gate .pwg-logo-light{display:none}
html[data-theme="dark"] #pw-gate .pwg-logo-dark{display:block}
#pw-gate .pwg-title{margin:0;font-family:'Bricolage Grotesque','Inter',system-ui,sans-serif;font-size:36px;line-height:1.05;font-weight:700;letter-spacing:-.025em;text-align:left}
#pw-gate .pwg-sub{margin:12px 0 28px;font-size:14px;line-height:1.5;color:var(--text-muted);text-align:left}
#pw-gate .pwg-field{margin:0 0 16px}
#pw-gate .pwg-field label{display:block;margin:0 0 6px;font-size:13px;font-weight:500;color:var(--text-secondary)}
#pw-gate .pwg-input{position:relative}
#pw-gate .pwg-field input{width:100%;height:44px;padding:0 14px;font:inherit;font-size:14px;color:var(--text);background:var(--surface);border:1px solid var(--border-strong);border-radius:10px;outline:none;transition:border-color .15s,box-shadow .15s}
#pw-gate .pwg-field input::placeholder{color:var(--text-muted);opacity:.7}
#pw-gate .pwg-field input:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-ring)}
#pw-gate #pw-gate-password{padding-right:84px}
#pw-gate .pwg-peek{position:absolute;right:6px;top:50%;transform:translateY(-50%);height:32px;padding:0 10px;border:0;border-radius:7px;background:none;font:inherit;font-size:12.5px;font-weight:500;color:var(--accent-text);cursor:pointer}
#pw-gate .pwg-peek:hover{background:var(--accent-soft)}
#pw-gate .pwg-peek:focus-visible,#pw-gate .pwg-btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
#pw-gate #pw-gate-turnstile{margin:4px 0 14px;min-height:65px;display:flex;justify-content:center;align-items:center}
#pw-gate .pwg-btn{width:100%;height:46px;border:0;border-radius:10px;background:var(--accent);color:#fff;font:inherit;font-size:15px;font-weight:600;cursor:pointer;transition:background .15s,transform .05s}
#pw-gate .pwg-btn:hover:not(:disabled){background:var(--accent-hover)}
#pw-gate .pwg-btn:active:not(:disabled){transform:translateY(1px)}
#pw-gate .pwg-btn:disabled{background:var(--border-strong);color:var(--text-muted);cursor:not-allowed}
#pw-gate .pwg-status{min-height:20px;margin:12px 0 0;font-size:13px;line-height:1.45;text-align:left;color:var(--text-muted)}
#pw-gate .pwg-help{margin:22px 0 0;padding-top:18px;border-top:1px solid var(--border);font-size:13px;color:var(--text-muted)}
#pw-gate .pwg-s{fill:none;stroke:var(--g-steel);stroke-linecap:round;stroke-linejoin:round}
#pw-gate .pwg-hi{fill:none;stroke:var(--g-steel-hi);stroke-linecap:round;opacity:.85}
#pw-gate .pwg-cut{fill:none;stroke:var(--g-tray);stroke-linecap:round}
@keyframes pwgLay{from{opacity:0;transform:translateY(-24px) rotate(var(--r,0deg))}to{opacity:1;transform:none}}
#pw-gate .pwg-inst{transform-box:fill-box;transform-origin:center;animation:pwgLay .75s cubic-bezier(.2,.7,.2,1) both;animation-delay:calc(var(--i)*120ms + 150ms)}
@media (max-width:860px){
  #pw-gate .pwg-shell{grid-template-columns:minmax(0,1fr)}
  #pw-gate .pwg-panel{display:none}
  #pw-gate .pwg-logo{margin-bottom:32px}
  #pw-gate .pwg-title{font-size:30px}
}
@media (prefers-reduced-motion:reduce){
  #pw-gate .pwg-inst{animation:none}
  #pw-gate .pwg-field input,#pw-gate .pwg-btn{transition:none}
}
`;

function ensureGateCss() {
  if (document.getElementById('pw-gate-css')) return;
  const st = document.createElement('style');
  st.id = 'pw-gate-css';
  st.textContent = GATE_CSS;
  document.head.appendChild(st); // sesudah <link> universal -> menang urutan; #pw-gate menang spesifisitas
}

function ensureGateStyles() {
  ensureGateCss();
  return Promise.all(GATE_STYLE_LINKS.map(({ id, href }) => loadLink(id, href)));
}

const GATE_MARKUP = `
<div id="pw-gate" class="auth-gate">
  <div class="pwg-shell">
    <aside class="pwg-panel" aria-hidden="true">
      <svg class="pwg-tray" viewBox="0 0 480 640" focusable="false">
        <g transform="rotate(-3 240 320)">
          <rect x="40" y="40" width="400" height="560" rx="24" fill="var(--g-tray)" stroke="var(--border-strong)" stroke-width="2"/>
          <rect x="58" y="58" width="364" height="524" rx="14" fill="none" stroke="var(--border-strong)" stroke-width="1" opacity=".6"/>
          <g transform="rotate(2 96 380)"><g class="pwg-inst" style="--i:0;--r:-6deg">
            <path class="pwg-s" stroke-width="14" d="M96 250V520"/>
            <path class="pwg-hi" stroke-width="3" d="M92 262V508"/>
            <path class="pwg-cut" stroke-width="1.5" d="M89 440h14M89 452h14M89 464h14M89 476h14M89 488h14"/>
            <path class="pwg-s" stroke-width="7" d="M96 250V196"/>
            <path d="M92.5 196H99.5V150Q99.5 112 94 92Q90 118 92.5 150Z" fill="var(--g-steel)"/>
          </g></g>
          <g transform="rotate(-1.5 170 330)"><g class="pwg-inst" style="--i:1;--r:5deg">
            <path class="pwg-s" stroke-width="8" d="M170 540C158 400 152 260 166 120"/>
            <path class="pwg-s" stroke-width="8" d="M170 540C182 400 188 260 174 120"/>
            <path class="pwg-hi" stroke-width="2" d="M168 520C157 400 151 270 164 132"/>
            <path class="pwg-hi" stroke-width="2" d="M172 520C183 400 189 270 176 132"/>
            <path class="pwg-cut" stroke-width="1.5" d="M163 128h14M163 137h14M164 146h12"/>
          </g></g>
          <g transform="rotate(1 262 330)"><g class="pwg-inst" style="--i:2;--r:-4deg">
            <path class="pwg-s" stroke-width="9" d="M246 96L262 330L294 452"/>
            <path class="pwg-s" stroke-width="9" d="M278 96L262 330L230 452"/>
            <path class="pwg-hi" stroke-width="2" d="M248 112L263 322"/>
            <circle class="pwg-s" cx="302" cy="478" r="28" stroke-width="7"/>
            <circle class="pwg-s" cx="222" cy="478" r="28" stroke-width="7"/>
            <circle cx="262" cy="330" r="7" fill="var(--accent)" stroke="var(--g-steel-hi)" stroke-width="2"/>
          </g></g>
          <g transform="rotate(-1 370 380)"><g class="pwg-inst" style="--i:3;--r:6deg">
            <path class="pwg-s" stroke-width="9" d="M370 540V196Q370 176 390 176H410V212"/>
            <path class="pwg-hi" stroke-width="2" d="M366 520V204"/>
          </g></g>
          <text x="240" y="570" text-anchor="middle" font-family="'JetBrains Mono',ui-monospace,monospace" font-size="11" letter-spacing="1.4" fill="var(--g-engrave)">RB999-KE921-B99-U02</text>
        </g>
      </svg>
    </aside>
    <main class="pwg-main">
      <div class="pwg-card">
        <img src="/assets/logo-mark-pnm-sidebar.png" alt="PNM" class="pwg-logo pwg-logo-light"/>
        <img src="/assets/logo-mark-pnm-sidebar-dark.png" alt="PNM" class="pwg-logo pwg-logo-dark"/>
        <h1 class="pwg-title">Pionir Workspaces</h1>
        <p class="pwg-sub">Masuk dengan email tim yang sudah terdaftar.</p>
        <div class="pwg-field">
          <label for="pw-gate-email">Email</label>
          <input type="email" id="pw-gate-email" placeholder="nama@email.com" autocomplete="email"/>
        </div>
        <div class="pwg-field">
          <label for="pw-gate-password">Password</label>
          <div class="pwg-input">
            <input type="password" id="pw-gate-password" placeholder="Password" autocomplete="current-password"/>
            <button type="button" id="pw-gate-peek" class="pwg-peek" aria-label="Tampilkan password">Lihat</button>
          </div>
        </div>
        <div id="pw-gate-turnstile"></div>
        <button id="pw-gate-login-btn" class="pwg-btn">Masuk</button>
        <div id="pw-gate-status" class="pwg-status" role="status" aria-live="polite"></div>
        <p class="pwg-help">Belum bisa masuk? Minta admin menambahkan emailmu.</p>
      </div>
    </main>
  </div>
</div>`;

let gateEl = null;
let authedUserId = null; // guard: cegah onReady() kepanggil dobel buat sesi user yang sama
                          // (SDK bisa nembak INITIAL_SESSION lalu SIGNED_IN buat sesi sama)

function setStatus(text, isError) {
  const el = document.getElementById('pw-gate-status');
  if (!el) return;
  el.textContent = text;
  el.style.color = isError ? 'var(--danger, #E5484D)' : '';
}

function showGate(message) {
  if (gateEl) {
    // Gate dilepas total dari DOM (bukan cuma display:none) tiap kali
    // hideGate() dipanggil -- lihat catatan di hideGate() kenapa. Begitu
    // mau ditampilkan lagi, tempel balik ke <body> dulu kalau memang
    // sudah lepas.
    if (!gateEl.isConnected) document.body.appendChild(gateEl);
    gateEl.style.display = 'flex';
  }
  // Defensive re-load: kalau gate ini muncul lagi SETELAH sempat hilang
  // (logout, misalnya) dan halaman terakhir yang ke-mount() sudah
  // remove()-in 'shared-pnm-universal-css' di unmount()-nya sendiri (pola
  // normal tiap page module -- lihat dashboard/stok/dst), gate bakal
  // balik jadi unstyled lagi kalau ini gak dipanggil ulang di sini.
  // loadLink() di atas dedup otomatis (no-op kalau linknya masih ada).
  ensureGateStyles();
  authedUserId = null;
  if (message) setStatus(message, true);
}

// FIX (laporan user: textbox biasa kayak search box munculin saran
// password/email tersimpan): selama <input type="password"> ini masih
// ada di DOM -- walau cuma disembunyikan lewat display:none -- browser
// (Chromium dkk) tetap mengelompokkannya bareng SEMUA input lain yang
// gak dibungkus <form> di halaman ini jadi satu "unowned form" internal,
// dan menyodorkan saran login itu ke textbox APAPUN yang lagi difokus,
// gak peduli textbox itu sendiri sudah autocomplete="off". Solusinya:
// begitu user berhasil login, gate ini (berikut input email+password-nya)
// dicopot BENERAN dari DOM, bukan cuma disembunyikan -- baru ditempel
// lagi kalau showGate() dipanggil ulang (misal habis logout).
function hideGate() {
  setStatus(''); // clear status DULU, selagi #pw-gate-status masih ada di DOM
  // SECURITY: password yang tadi diketik masih nempel di properti .value
  // node <input> ini walau udah gak keliatan (display:none, lalu di-
  // remove() dari DOM barisan bawah) -- dikosongin eksplisit di sini biar
  // gak ada teks password asli nongkrong di memori/DOM lebih lama dari
  // yang perlu begitu login sukses. Email sengaja DIBIARKAN (bukan
  // rahasia, dan enak buat re-login cepat kalau logout lagi sebentar).
  const passwordInput = document.getElementById('pw-gate-password');
  if (passwordInput) { passwordInput.value = ''; passwordInput.type = 'password'; }
  const peek = document.getElementById('pw-gate-peek');
  if (peek) { peek.textContent = 'Lihat'; peek.setAttribute('aria-label', 'Tampilkan password'); }
  if (gateEl) {
    gateEl.style.display = 'none';
    if (gateEl.isConnected) gateEl.remove();
  }
}

/**
 * Mount the gate + block until an authenticated, whitelisted session
 * exists, then call onReady(session) EXACTLY ONCE per login. Also calls
 * onLoggedOut() (if given) whenever the session drops to null AFTER
 * onReady() has already fired once — i.e. the app was showing normal
 * content and the user (or another tab) logged out — so router.js can
 * tear down the currently-mounted page and stop routing until the gate
 * passes again.
 */
export async function initAuthGate({ onReady, onLoggedOut }) {
  gateEl = document.getElementById('pw-gate');
  if (!gateEl) {
    const wrap = document.createElement('div');
    wrap.innerHTML = GATE_MARKUP;
    gateEl = wrap.firstElementChild;
    document.body.appendChild(gateEl);
  }

  await Promise.all([ensureGateStyles(), ensureVendorScripts(), ensureTurnstileScript()]);

  const emailInput = document.getElementById('pw-gate-email');
  const passwordInput = document.getElementById('pw-gate-password');
  const loginBtn = document.getElementById('pw-gate-login-btn');
  const turnstileEl = document.getElementById('pw-gate-turnstile');

  // Token Turnstile sekali-pakai: begitu satu attemptLogin() konsumsi
  // token ini (berhasil ATAU gagal), widget WAJIB di-reset biar dapat
  // token baru buat percobaan berikutnya -- kalau enggak, login kedua
  // akan selalu ditolak Supabase ("captcha check failed") walau
  // password-nya sendiri sudah benar.
  let turnstileToken = null;
  let turnstileWidgetId = null;
  function renderTurnstile() {
    if (!turnstileEl || !window.turnstile) return;
    turnstileWidgetId = window.turnstile.render(turnstileEl, {
      sitekey: TURNSTILE_SITE_KEY,
      size: 'flexible', // lebar mengikuti kartu (bukan 300px tetap)
      callback: (token) => { turnstileToken = token; },
      'expired-callback': () => { turnstileToken = null; },
      'error-callback': () => { turnstileToken = null; },
    });
  }
  function resetTurnstile() {
    turnstileToken = null;
    if (window.turnstile && turnstileWidgetId != null) window.turnstile.reset(turnstileWidgetId);
  }
  renderTurnstile();

  async function attemptLogin() {
    const email = (emailInput.value || '').trim().toLowerCase();
    const password = passwordInput.value || '';
    if (!email || !email.includes('@')) { setStatus('Masukkan email yang valid dulu ya.', true); return; }
    if (!password) { setStatus('Masukkan password.', true); return; }
    if (!turnstileToken) { setStatus('Tunggu verifikasi keamanan selesai dulu ya (beberapa detik).', true); return; }
    loginBtn.disabled = true;
    loginBtn.textContent = 'Memproses...';
    try {
      await window.PNMAuth.login(email, password, turnstileToken);
      // onAuthStateChange (di bawah) yang nanganin sisanya (whitelist check + onReady).
    } catch (error) {
      const m = (error.message || '').toLowerCase();
      setStatus(
        m.includes('email not confirmed')
          ? 'Email belum dikonfirmasi. Cek inbox kamu buat klik link konfirmasi dulu.'
          : m.includes('invalid login credentials')
            ? 'Email atau password salah. Periksa lagi, lalu coba masuk.'
            : m.includes('captcha')
              ? 'Verifikasi keamanan gagal. Tunggu kotak verifikasi dimuat ulang, lalu coba masuk lagi.'
              : 'Gagal masuk: ' + error.message,
        true
      );
    }
    resetTurnstile(); // token sudah terpakai (berhasil/gagal) -- selalu minta token baru
    loginBtn.disabled = false;
    loginBtn.textContent = 'Masuk';
  }

  loginBtn.addEventListener('click', attemptLogin);
  passwordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') attemptLogin(); });
  emailInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); passwordInput.focus(); } });
  const peekBtn = document.getElementById('pw-gate-peek');
  if (peekBtn) peekBtn.addEventListener('click', () => {
    const show = passwordInput.type === 'password';
    passwordInput.type = show ? 'text' : 'password';
    peekBtn.textContent = show ? 'Sembunyikan' : 'Lihat';
    peekBtn.setAttribute('aria-label', show ? 'Sembunyikan password' : 'Tampilkan password');
  });

  let hasBeenReady = false;

  async function checkWhitelistAndProceed(session) {
    if (authedUserId === session.user.id) return; // guard dobel-fire
    const email = session.user.email.toLowerCase();
    const sb = window.pnmSupabase;
    const { data, error } = await sb.from('allowed_users').select('email').eq('email', email).maybeSingle();
    if (error) {
      // Query gagal (network/timeout) -- BUKAN bukti email nggak terdaftar.
      // Jangan sign-out paksa, biarkan user coba lagi.
      setStatus('Gagal cek akses (koneksi bermasalah), coba lagi: ' + error.message, true);
      return;
    }
    if (!data) {
      await window.PNMAuth.logout();
      setStatus('Email ' + email + ' belum terdaftar sebagai tim. Hubungi admin.', true);
      return;
    }
    authedUserId = session.user.id;
    hasBeenReady = true;
    hideGate();
    onReady(session);
  }

  const AUTH_EVENTS_YANG_MEMICU_GATE = new Set(['SIGNED_IN', 'INITIAL_SESSION']);
  window.PNMAuth.onAuthStateChange((event, session) => {
    if (session && AUTH_EVENTS_YANG_MEMICU_GATE.has(event)) {
      checkWhitelistAndProceed(session);
    } else if (!session) {
      const wasReady = hasBeenReady;
      hasBeenReady = false;
      showGate();
      if (wasReady && typeof onLoggedOut === 'function') onLoggedOut();
    }
  });
}