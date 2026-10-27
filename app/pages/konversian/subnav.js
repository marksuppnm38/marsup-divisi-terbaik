// Sub-navigation registry for konversian, consumed by app/pages/nav/ —
// same pattern/reasoning as crud-produk/subnav.js (read that file's header
// first if this is your first time in this pair).
//
// konversian's in-page subtab buttons (subtab-cari/-sesi/-riwayat/-converter/-setcari/
// -dictionary/-project, see markup.js) are hidden globally (pnm-universal.css) because
// this nav now lives in the sidebar. The sidebar entries drive the same switchSubTab()
// through setSubroute() in index.js. The .subtab-row element itself still exists: it
// also hosts the panel-collapse button.
//
// id here is the URL sub-segment (`/konversian/<id>`) AND is passed
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