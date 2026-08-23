// home page module: mount(container) / unmount().
// Ported from root index.html (see visi-pionir-workspaces.md bagian 3.1).
// DELIBERATE change vs a verbatim port: the 3D Rubik cube, aurora background
// blobs, and cursor-glow follower are all removed — replaced by a flat
// module-card grid. That's a user-requested redesign ("lose the cube
// gimmick, minimal modern flat design"), done at this step rather than
// deferred, so there's no drag/rotate physics or requestAnimationFrame loop
// left to port at all.
// Nav links: as of sesi kedelapan, migrated modules (konversian/kompres-pdf/
// export-gambar) use fragment-only `#<id>` hash-nav; legacy modules
// (stok/crud-produk/dashboard) still full-page `.html` links — see
// markup.js MODULES array.

import { HOME_MARKUP } from './markup.js';

const FONT_LINK_ID = 'shared-plus-jakarta-sans';
const FONT_HREF = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap';

// Sesi kesepuluh fix (FOUC/flash bug): sebelumnya ensureStyle() nge-append
// <link> tag terus LANGSUNG lanjut ke `container.innerHTML = HOME_MARKUP`
// tanpa nunggu stylesheet-nya kelar di-download — jadi ada 1 frame (kadang
// lebih lama di koneksi lambat/cold cache di Vercel) di mana markup mentah
// sempat ke-paint pakai default browser style (serif font, SVG icon gak
// dibatasi 18x18 jadi tampil raksasa) sebelum CSS kelar. Fix: ensureStyle()
// sekarang balikin Promise yang resolve pas link udah ke-load (event
// 'load') ATAU udah ada duluan (skip nunggu) ATAU gagal load (event
// 'error' — tetap resolve, bukan reject, biar app gak nyangkut nge-block
// selamanya kalau CDN font down; halaman tetap muncul, cuma mungkin pakai
// fallback font). mount() sekarang `await` ini SEBELUM nge-set innerHTML,
// jadi container tetap kosong (bukan markup mentah) selama nunggu.
function loadLink(id, href) {
  const existing = document.getElementById(id);
  if (existing) return Promise.resolve();
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = () => resolve();
    link.onerror = () => resolve(); // don't block forever if a CDN is down
    document.head.appendChild(link);
  });
}

function ensureStyle() {
  return Promise.all([
    loadLink(FONT_LINK_ID, FONT_HREF),
    loadLink('page-home-style', new URL('./style.css', import.meta.url).href),
  ]);
}

let mountedContainer = null;

export async function mount(container) {
  mountedContainer = container;
  await ensureStyle();
  container.classList.add('app-wrap');
  container.innerHTML = HOME_MARKUP;

  // Theme init + toggle — single source of truth: <html data-theme>, same
  // localStorage keys ('theme' / 'pnum-theme') as konversian's theme-toggle
  // block, so switching theme here stays in sync with other tools.
  const root = document.documentElement;
  function currentTheme() {
    return root.getAttribute('data-theme')
      || localStorage.getItem('theme')
      || localStorage.getItem('pnum-theme')
      || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }
  function applyTheme(theme) {
    theme = theme === 'dark' ? 'dark' : 'light';
    root.setAttribute('data-theme', theme);
    root.style.colorScheme = theme;
    localStorage.setItem('theme', theme);
    localStorage.setItem('pnum-theme', theme);
    const btn = container.querySelector('#home-theme-toggle');
    if (btn) {
      btn.innerHTML = theme === 'dark'
        ? '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
        : '<svg viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
    }
  }
  applyTheme(currentTheme());
  container.querySelector('#home-theme-toggle')?.addEventListener('click', () => {
    applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
  });
}

export function unmount() {
  // No document/window-level listeners (no drag/pointer physics anymore —
  // that's the whole point of dropping the cube). The single click listener
  // lives on a button inside `container`, so router's container.innerHTML =
  // '' already tears it down. Only undo what mount() set on the container:
  mountedContainer?.classList.remove('app-wrap');
  mountedContainer = null;
}