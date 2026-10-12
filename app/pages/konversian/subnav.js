// Sub-navigation registry for konversian, consumed by app/pages/nav/ —
// same pattern/reasoning as crud-produk/subnav.js (read that file's header
// first if this is your first time in this pair).
//
// UNLIKE crud-produk, konversian's own in-page subtab row (subtab-cari/
// -sesi/-riwayat/-converter/-setcari/-dictionary, see markup.js) is NOT
// being removed this session — konversian is the largest/most delicate
// file in this codebase (9000+ lines, no browser access to verify changes
// to a page this central), and unlike crud-produk's full second SIDEBAR,
// konversian's own subtabs are a single horizontal row, not a competing
// nav surface -- lower urgency, higher risk to touch further right now.
// So for now konversian's items appear in BOTH the global sidebar (new)
// AND its own subtab row (existing, untouched) -- redundant but harmless,
// and the global sidebar entries still work (see index.js's setSubroute)
// since they drive the exact same switchSubTab() the in-page row already
// calls. Removing the in-page row is the natural follow-up once this is
// confirmed working in a real browser.
//
// id here is the URL sub-segment (`#konversian/<id>`) AND is passed
// straight into konversian's existing switchSubTab(id) — the two need to
// stay in sync (same 7 values; 'project' ditambah 2026-10-12). If index.js ever gets an 8th subtab, add it
// here too, and vice versa.
export const KONVERSIAN_SUBNAV = [
  { id: 'cari', title: 'Cari Produk', icon: 'ti-search' },
  { id: 'sesi', title: 'Konversi Berjalan', icon: 'ti-list-details' },
  { id: 'riwayat', title: 'Riwayat', icon: 'ti-history' },
  { id: 'project', title: 'Project', icon: 'ti-folders' },
  { id: 'converter', title: 'Converter', icon: 'ti-clipboard-copy' },
  { id: 'setcari', title: 'Cari SET', icon: 'ti-box-multiple' },
  { id: 'dictionary', title: 'Dictionary', icon: 'ti-book-2' },
];