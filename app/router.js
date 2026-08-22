// Minimal hash router. Zero-build: native <script type="module">, native import().
// Each route lazily imports a page module exposing mount(container) / unmount().
// Add a page here only once it's actually migrated (see map.md bagian 4).

const ROUTES = {
  'kompres-pdf': () => import('./pages/kompres-pdf/index.js'),
  'export-gambar': () => import('./pages/export-gambar/index.js'),
};

const DEFAULT_ROUTE = 'kompres-pdf';

const container = document.getElementById('app');
let currentPage = null; // the mounted module, so we can call .unmount()

function currentRoute() {
  const hash = location.hash.replace(/^#\/?/, '').split('?')[0].trim();
  return hash || DEFAULT_ROUTE;
}

async function render() {
  const route = currentRoute();
  const load = ROUTES[route];

  if (currentPage && typeof currentPage.unmount === 'function') {
    try { currentPage.unmount(); } catch (err) { console.error('unmount gagal:', err); }
  }
  currentPage = null;
  container.innerHTML = '';

  if (!load) {
    container.innerHTML = `<div style="max-width:520px;margin:60px auto;font-family:sans-serif;">
      <p>Halaman "${route}" belum dipindah ke SPA.</p>
      <p><a href="/${route}.html">Buka versi lama</a></p>
    </div>`;
    return;
  }

  const mod = await load();
  await mod.mount(container);
  currentPage = mod;
}

window.addEventListener('hashchange', render);
window.addEventListener('DOMContentLoaded', render);
render();
