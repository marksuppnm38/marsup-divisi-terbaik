// Home page markup (gerbang / landing). Ported from root index.html per
// visi-pionir-workspaces.md bagian 3.1 + 5 (langkah 1: port dulu, link masih
// apa adanya, belum hash-nav). Perubahan yang SENGAJA dilakukan di langkah
// ini (di luar sekadar "port"): kubus 3D + aurora blobs + cursor-glow
// dibuang, diganti grid kartu modul flat — ini permintaan eksplisit user
// ("lose the cube gimmick, simplified... minimal modern flat design"), bukan
// bagian dari rencana port verbatim di map.md/visi-pionir-workspaces.md.
//
// MODULES adalah satu-satunya tempat data modul didefinisikan untuk halaman
// ini (judul, warna, ikon, link, deskripsi) — belum sepenuhnya jadi
// `app/pages.js` registry lintas-file yang disebut di visi bagian 3.3, itu
// langkah terpisah nanti (langkah 4).
//
// Langkah 3 (visi bagian 5) DIKERJAKAN DI SINI: modul yang sudah
// `migrated: true` sekarang link ke `/<id>` (real clean path). Ini file
// itu sendiri sekarang UNREACHABLE (lihat router.js's RETIRED_REDIRECTS —
// 'home' route diretire sesi keenam belas), jadi klik di sini gak akan
// pernah beneran kejadian, tapi MODULES tetap dipakai sebagai satu-satunya
// sumber data modul oleh nav-markup.js (lihat file itu), jadi url di sini
// harus tetap sinkron sama path asli. Modul yang masih `migrated: false`
// TETAP full-page `.html` link, sengaja belum disentuh — mereka belum
// eksis sebagai route SPA sampai gilirannya (map.md bagian 4, urutan #4/#5).

export const MODULES = [
  {
    id: 'konversian',
    title: 'Conversion Workspace',
    desc: 'Almost everything you need.',
    url: '/konversian',
    migrated: true,
    color: '#2563EB',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
  },
  {
    id: 'stok',
    title: 'Stok',
    desc: 'One source of truth.',
    url: '/stok',
    migrated: true,
    color: '#10B981',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05"/><path d="M12 22.08V12"/></svg>',
  },
  {
    id: 'crud-produk',
    title: 'CRUD Produk',
    desc: 'Control, without complexity.',
    url: '/crud-produk',
    migrated: true,
    color: '#8B5CF6',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>',
  },
  {
    id: 'dashboard',
    title: 'Dashboard',
    desc: 'See everything that matters.',
    url: '/dashboard',
    migrated: true,
    color: '#06B6D4',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>',
  },
  {
    id: 'kompres-pdf',
    title: 'Kompres PDF',
    desc: 'Smaller files, same content.',
    url: '/kompres-pdf',
    migrated: true,
    color: '#EF4444',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 15l3 3 3-3"/><path d="M12 12v6"/></svg>',
  },
  {
    id: 'export-gambar',
    title: 'Export Gambar Gabungan',
    desc: 'Merge template & overlay jadi satu gambar.',
    url: '/export-gambar',
    migrated: true,
    color: '#10B981',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
  },
];