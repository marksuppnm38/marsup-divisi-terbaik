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
// id here is the URL sub-segment (`#crud-produk/<id>`) AND is passed
// straight into crud-produk's existing switchView(id) — the two need to
// stay in sync (same 5 values: produk/set/akd/kfa/bulk). If index.js's
// switchView() ever gets a 6th view, add it here too, and vice versa.
export const CRUD_PRODUK_SUBNAV = [
  { id: 'produk', title: 'Produk', icon: 'ti-package' },
  { id: 'set', title: 'Set Management', icon: 'ti-stack-2' },
  { id: 'akd', title: 'AKD', icon: 'ti-shield-check' },
  { id: 'kfa', title: 'KFA Management', icon: 'ti-barcode' },
  { id: 'bulk', title: 'Bulk Edit', icon: 'ti-table' },
];