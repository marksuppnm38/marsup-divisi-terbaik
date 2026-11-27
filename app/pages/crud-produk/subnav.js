// Sub-navigation registry for crud-produk, consumed by app/pages/nav/
// (nav-markup.js/nav.js) to render this module's own pages as an
// expandable accordion under its item in the GLOBAL sidebar, instead of
// crud-produk drawing its own second sidebar (the "double nav" this whole
// thing exists to fix -- see markup.js/index.js's comments on what got
// removed there).
//
// Eagerly importable (no heavy logic, no DOM, no vendor scripts) — nav.js
// needs this available at nav-render time, which happens BEFORE router.js
// lazy-imports crud-produk/index.js itself (that only happens once the
// user actually navigates there). Keep this file lightweight forever;
// anything with real logic belongs in index.js, not here.
//
// Judul = teks tampilan (Product Manager, 2026-11): satu bahasa, satu-dua kata. Nilai `id` TIDAK BOLEH berubah --
// dipakai router, bookmark, dan switchView().
// id here is the URL sub-segment (`#crud-produk/<id>`) AND is passed
// straight into crud-produk's existing switchView(id) — the two need to
// stay in sync (same 7 values: produk/set/akd/kfa/bulk/sync/orphan -- 'sync'
// added for the "produk kepantau di sheet tapi belum ada di DB" catcher; 'kategori' (Kategori &
// Spesialisasi) was folded into the Produk list as columns + filters, see klasifikasi.js).
// If index.js's switchView() ever gets another view, add it here too,
// and vice versa.
export const CRUD_PRODUK_SUBNAV = [
  { id: 'produk', title: 'Products', icon: 'ti-package' },
  { id: 'set', title: 'Sets', icon: 'ti-stack-2' },
  { id: 'akd', title: 'AKD', icon: 'ti-shield-check' },
  { id: 'kfa', title: 'KFA', icon: 'ti-barcode' },
  { id: 'bulk', title: 'Bulk Edit', icon: 'ti-table' },
  { id: 'sync', title: 'Sheet Sync', icon: 'ti-refresh' },
  { id: 'orphan', title: 'Drift Check', icon: 'ti-git-compare' },
];