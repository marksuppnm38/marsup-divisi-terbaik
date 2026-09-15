// shared/auth-gate.js
// ══════════════════════════════════════════
// THE single login gate for the whole app. Mounted ONCE by router.js,
// BEFORE any page module is ever mount()ed — replaces the 5 separate
// per-module gates that used to live in dashboard/stok/konversian (the
// `.auth-gate`/`.auth-gate-box` pattern) and crud-produk/export-gambar
// (the bespoke `.gate-wrap`/`.gate-card` pattern). Those are all REMOVED
// from their respective markup.js/index.js as of this session (sesi
// kesembilan belas) — see map-history.md for the per-page removal notes.
// kompres-pdf never had a gate (no auth at all). konversian WAS deferred
// (too large/delicate to touch blind without browser access to verify —
// see map-history.md "sesi kesembilan belas") but has since been migrated
// onto this gate too (see konversian/index.js's mount() — its own
// #auth-gate/checkWhitelist()/showGate() are gone, konversian/markup.js's
// #app-root is no longer hidden-until-login). Every routed module now goes
// through exactly this one gate.
//
// BEHAVIOR CHANGE worth flagging explicitly (per map-history.md sesi
// kelima belas's own note: "kalau mau disamain [whitelist check], itu
// perubahan behavior yang perlu diminta eksplisit, bukan diam-diam
// ditambahin"): dashboard.html's ORIGINAL auth had NO allowed_users
// whitelist check at all (anyone with valid Supabase credentials got
// in). Now that dashboard sits behind this ONE shared gate, it inherits
// the whitelist check like every other gated module. This is an
// intentional side effect of "one gate for everyone" — a single shared
// gate can't have a different policy per destination module.
//
// Whitelist check unified to `select('email')` only (dropped the extra
// `role` column crud-produk's old per-page check used to fetch — grepped
// crud-produk/index.js first, confirmed `.role`/`data.role` was never
// actually read anywhere after the fetch, so nothing observable changes).
// ══════════════════════════════════════════

const VENDOR_CHAIN = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  '/shared/supabase-client.js',
  '/shared/auth-session.js',
];

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

function ensureGateStyles() {
  return Promise.all(GATE_STYLE_LINKS.map(({ id, href }) => loadLink(id, href)));
}

const GATE_MARKUP = `
<div id="pw-gate" class="auth-gate">
  <div class="auth-gate-box">
    <img src="/favicon/favicon-96x96.png" alt="PNM Logo" class="auth-gate-logo"/>
    <div class="auth-gate-title">Pionir Workspaces</div>
    <div class="auth-gate-sub">Masuk untuk melanjutkan.</div>
    <div class="pr-field">
      <label>Email</label>
      <input type="email" id="pw-gate-email" placeholder="nama@email.com" autocomplete="email"/>
    </div>
    <div class="pr-field">
      <label>Password</label>
      <input type="password" id="pw-gate-password" placeholder="••••••••" autocomplete="current-password"/>
    </div>
    <button id="pw-gate-login-btn" class="auth-gate-btn">Masuk</button>
    <div id="pw-gate-status" class="auth-gate-status"></div>
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
  if (gateEl) gateEl.style.display = 'flex';
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

function hideGate() {
  if (gateEl) gateEl.style.display = 'none';
  setStatus('');
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

  await Promise.all([ensureGateStyles(), ensureVendorScripts()]);

  const emailInput = document.getElementById('pw-gate-email');
  const passwordInput = document.getElementById('pw-gate-password');
  const loginBtn = document.getElementById('pw-gate-login-btn');

  async function attemptLogin() {
    const email = (emailInput.value || '').trim().toLowerCase();
    const password = passwordInput.value || '';
    if (!email || !email.includes('@')) { setStatus('Masukkan email yang valid dulu ya.', true); return; }
    if (!password) { setStatus('Masukkan password.', true); return; }
    loginBtn.disabled = true;
    loginBtn.textContent = 'Memproses...';
    try {
      await window.PNMAuth.login(email, password);
      // onAuthStateChange (di bawah) yang nanganin sisanya (whitelist check + onReady).
    } catch (error) {
      setStatus(
        error.message.toLowerCase().includes('email not confirmed')
          ? 'Email belum dikonfirmasi. Cek inbox kamu buat klik link konfirmasi dulu.'
          : 'Gagal masuk: ' + error.message,
        true
      );
    }
    loginBtn.disabled = false;
    loginBtn.textContent = 'Masuk';
  }

  loginBtn.addEventListener('click', attemptLogin);
  passwordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') attemptLogin(); });

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