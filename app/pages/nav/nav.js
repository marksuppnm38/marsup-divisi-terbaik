// Shared sidebar nav (design.md spec) — mount(navEl) once, call setActive(id)
// on every route change. This is deliberately a SEPARATE lifecycle from the
// per-page mount()/unmount() pattern in app/pages/<name>/index.js — the nav
// is meant to survive across route changes (design.md: "Lives in
// app/shell.html... not per-page"), so it is mounted ONCE by whatever wires
// it in (future router.js change), not remounted on every hashchange like a
// regular page.
//
// HOW TO WIRE THIS IN (when stok/dashboard get built — see nav.css header
// comment for why not now):
//   1. app/shell.html: change <div id="app"></div> to a `.pw-shell` wrapper
//      containing <nav id="app-nav"></nav> + <div id="app" class="pw-content">
//   2. app/router.js: import nav.js, call navMount(document.getElementById
//      ('app-nav')) ONCE before the first render(), then call
//      navSetActive(route) inside render() alongside the existing
//      mount/unmount calls (see router.js's render() function for where the
//      route id is already available).
//   3. Each NEW page (stok/dashboard) built from here on renders inside
//      .pw-content and can assume the nav's 200px (or 48px collapsed) width
//      is already accounted for — no per-page layout changes needed for the
//      pages that adopt this from day one. The 5 already-migrated pages
//      (home/konversian/crud-produk/kompres-pdf/export-gambar) do NOT get
//      this treatment automatically just by wiring in step 1/2 above — they
//      still render full-width inside .pw-content until each is
//      individually retrofitted per design.md's own migration checklist
//      (separate, later task — see design.md + map.md).

import { navMarkup } from './nav-markup.js';

const TABLER_ID = 'shared-tabler-icons';
const TABLER_HREF = 'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.31.0/dist/tabler-icons.min.css';

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

function ensureStyle() {
  return Promise.all([
    loadLink(TABLER_ID, TABLER_HREF),
    loadLink('page-nav-style', new URL('./nav.css', import.meta.url).href),
  ]);
}

let navEl = null;

function applyThemeIcon() {
  const icon = document.getElementById('pwNavThemeIcon');
  if (!icon) return;
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  icon.className = isDark ? 'ti ti-moon' : 'ti ti-sun';
}

async function fillUser() {
  const nameEl = document.getElementById('pwNavUserName');
  const avatarEl = document.getElementById('pwNavAvatar');
  if (!nameEl || !avatarEl || !window.PNMAuth) return;
  try {
    const user = await window.PNMAuth.getUser();
    const email = user?.email || '';
    if (email) {
      nameEl.textContent = email;
      avatarEl.textContent = email[0].toUpperCase();
    }
  } catch (e) {
    // not logged in yet / session not ready — leave the "—" placeholder,
    // this isn't an error state worth surfacing in the nav itself.
  }
}

/**
 * Mount the nav ONCE into the given element. Idempotent — calling this
 * again on the same element is a no-op (guards against a future caller
 * accidentally mounting it per-route instead of once).
 */
export async function navMount(container, activeId) {
  if (navEl === container) return; // already mounted here
  await ensureStyle();
  container.innerHTML = navMarkup(activeId);
  navEl = container;

  applyThemeIcon();
  fillUser();

  const toggle = document.getElementById('pwNavThemeToggle');
  toggle?.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    document.documentElement.style.colorScheme = next;
    localStorage.setItem('theme', next);
    applyThemeIcon();
  });

  // "/" focuses search trigger — design.md's mono "/" hint in the search
  // box implies this shortcut. Actual search UI (what clicking/pressing "/"
  // opens) isn't specified in design.md and isn't built here — this just
  // wires the affordance so it's ready whichever page/command-palette ends
  // up handling it.
  const search = document.getElementById('pwNavSearch');
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
      e.preventDefault();
      search?.click();
    }
  });
}

/** Call on every route change so the correct nav item highlights. */
export function navSetActive(activeId) {
  if (!navEl) return;
  navEl.querySelectorAll('.pw-nav-item').forEach((el) => el.classList.remove('active'));
  // hash-based items have href="#id"; legacy items have href="/id.html" —
  // match on whichever form this activeId's module actually uses, same
  // matching MODULES itself already encodes (see markup.js's navItemHtml).
  const match = Array.from(navEl.querySelectorAll('.pw-nav-item')).find((el) => {
    const href = el.getAttribute('href') || '';
    return href === `#${activeId}` || href.includes(`/${activeId}.html`) || href.includes(`/${activeId}`);
  });
  match?.classList.add('active');
}