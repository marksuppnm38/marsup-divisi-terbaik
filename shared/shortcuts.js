// shared/shortcuts.js
// ══════════════════════════════════════════
// SATU-SATUNYA tempat pintasan keyboard didaftarkan.
//
//   1. SHORTCUTS        daftar semua pintasan (yang dipasang lewat engine ini DAN yang masih
//                       dipasang manual di file lain -> ditandai `external`, cuma dicatat di sini
//                       supaya bentrok kelihatan di satu tempat).
//   2. BROWSER_RESERVED kombinasi yang sudah dipakai browser. Dilarang dipakai di SHORTCUTS.
//   3. installShortcuts(page, handlers)  satu listener keydown per halaman, dilepas lewat dispose().
//   4. applyShortcutHints(map)           isi title + aria-keyshortcuts tombol DARI registry, jadi teks
//                                        "(Alt+Shift+X)" tidak mungkin beda dari handler-nya.
//   5. toggleCheatSheet(page)            daftar pintasan halaman yang lagi dibuka (tombol "?").
//   6. validateRegistry()                dipakai scripts/check-shortcuts.mjs: cari id dobel, bentrok,
//                                        dan kombinasi terlarang.
//
// Aturan menambah pintasan: tambah SATU baris di SHORTCUTS, pasang handler dengan id yang sama di
// installShortcuts(), lalu jalankan `node scripts/check-shortcuts.mjs`.
//
// File ini aman di-import dari Node (tidak menyentuh document/window saat di-load) -- itu yang
// dipakai script pengecekan.
// ══════════════════════════════════════════

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || '');

// Kombinasi yang sudah dipakai browser. Daftar ini BELUM lengkap dan belum diverifikasi di semua
// browser: isinya cuma yang sudah ketahuan. Alt+Shift+N diketahui sebagai Split View Chrome
// (lihat komentar di konversian/clipboard.js); T/A/I/B dicatat di komentar yang sama sebagai
// kombinasi Chrome. Tiap kombinasi Alt+Shift baru WAJIB dites manual di browser sebelum dipakai.
export const BROWSER_RESERVED = [
  { combo: 'Alt+Shift+N', why: 'Chrome: Split View' },
  { combo: 'Alt+Shift+T', why: 'dipakai Chrome (catatan di clipboard.js)' },
  { combo: 'Alt+Shift+A', why: 'dipakai Chrome (catatan di clipboard.js)' },
  { combo: 'Alt+Shift+I', why: 'dipakai Chrome (catatan di clipboard.js)' },
  { combo: 'Alt+Shift+B', why: 'dipakai Chrome (catatan di clipboard.js)' },
];

// Field:
//   id         unik, format "<halaman>.<aksi>"
//   page       id halaman (sama dengan id modul di router) atau '*' = semua halaman
//   combo      string atau array. Format "Mod+S", "Alt+Shift+P", "/", "j", "Escape".
//              Mod = Ctrl di Windows/Linux, Cmd di Mac. Tombol polos (tanpa modifier) dicocokkan
//              lewat e.key; kombinasi dengan Alt dicocokkan lewat e.code (di Mac Alt+huruf
//              menghasilkan karakter lain, e.key tidak bisa diandalkan).
//   scope      'page'    -> tidak jalan kalau ada dialog terbuka (default)
//              'modal'   -> hanya jalan kalau ada dialog terbuka
//              'popover' -> seperti page, untuk panel kecil yang bukan dialog
//              'any'     -> selalu
//   desc/group teks di cheat sheet
//   repeat     true = boleh jalan terus saat tombol ditahan (j/k)
//   allowTyping true = tombol polos tetap jalan walau fokus di kolom input (Escape)
//   external   path file yang MEMASANG handler-nya sendiri (bukan lewat engine ini). Dicatat di sini
//              hanya untuk cheat sheet dan deteksi bentrok.
//   overrides  id pintasan global yang sengaja dikalahkan halaman ini (engine memasang listener di
//              fase capture + stopImmediatePropagation, jadi halaman menang)
//   knownConflict id pintasan lain yang BENTROK dan belum diperbaiki (muncul sebagai WARN)
//   tab        (opsional) sub-tab di dalam halaman tempat pintasan ini hidup, string atau array. Dua
//              pintasan dengan kombinasi sama TIDAK bentrok kalau tab-nya tidak beririsan (mis. Enter
//              di tab Cari Produk vs Enter di tab Riwayat). Tanpa `tab` = berlaku di semua tab.
//
// SENGAJA TANPA PINTASAN (mengubah data atau membuang pekerjaan, harus lewat klik): Record Konversi,
// Hapus semua, Logout. Record tetap dikirim dengan Ctrl+Enter DI DALAM dialognya (konv.dialog.submit),
// jadi tetap ada langkah klik yang disengaja.
// Selesaikan Sesi (Alt+Shift+S) dan Keluar dari Sesi (Alt+Shift+L) SEKARANG punya pintasan (2026-11-18):
// keduanya cuma MENGKLIK tombolnya, jadi pengaman bawaan tetap jalan -- Selesaikan Sesi tetap membuka dialog
// konfirmasi "Ya, Selesaikan" (pintasan TIDAK menyelesaikan sesi langsung), Keluar dari Sesi cuma membersihkan
// tampilan lokal (sesi tetap 'berjalan' di server).
export const SHORTCUTS = [
  // ─── global ───
  { id: 'nav.search', page: '*', combo: '/', scope: 'page', external: 'app/pages/nav/nav.js',
    desc: 'Cari menu di sidebar', group: 'Cari & daftar' },

  // ─── crud-produk ───
  { id: 'produk.search', page: 'crud-produk', combo: '/', scope: 'page', overrides: 'nav.search',
    desc: 'Fokus ke kolom cari', group: 'Cari & daftar' },
  { id: 'produk.cmdk', page: 'crud-produk', combo: 'Mod+K', scope: 'any', external: 'app/pages/crud-produk/index.js',
    desc: 'Cari produk dari tab mana pun', group: 'Cari & daftar' },
  { id: 'produk.nextRow', page: 'crud-produk', combo: 'j', scope: 'page', repeat: true,
    desc: 'Baris berikutnya', group: 'Cari & daftar' },
  { id: 'produk.prevRow', page: 'crud-produk', combo: 'k', scope: 'page', repeat: true,
    desc: 'Baris sebelumnya', group: 'Cari & daftar' },
  { id: 'produk.arrowNext', page: 'crud-produk', combo: 'ArrowDown', scope: 'page', repeat: true, allowTyping: true,
    desc: 'Baris berikutnya (↓ juga jalan dari kolom cari)', group: 'Cari & daftar' },
  { id: 'produk.arrowPrev', page: 'crud-produk', combo: 'ArrowUp', scope: 'page', repeat: true, allowTyping: true,
    desc: 'Baris sebelumnya', group: 'Cari & daftar' },
  { id: 'produk.extendNext', page: 'crud-produk', combo: 'Shift+ArrowDown', scope: 'page', repeat: true, allowTyping: true,
    desc: 'Perluas pilihan ke baris berikutnya (rentang)', group: 'Cari & daftar' },
  { id: 'produk.extendPrev', page: 'crud-produk', combo: 'Shift+ArrowUp', scope: 'page', repeat: true, allowTyping: true,
    desc: 'Perluas pilihan ke baris sebelumnya (rentang)', group: 'Cari & daftar' },
  { id: 'produk.open', page: 'crud-produk', combo: 'Enter', scope: 'page', external: 'app/pages/crud-produk/index.js',
    desc: 'Buka produk yang sedang difokus', group: 'Cari & daftar' },
  { id: 'produk.select', page: 'crud-produk', combo: 'x', scope: 'page', external: 'app/pages/crud-produk/copy.js',
    desc: 'Pilih / lepas baris (Shift untuk rentang)', group: 'Cari & daftar' },
  { id: 'produk.copy', page: 'crud-produk', combo: 'Mod+C', scope: 'page', external: 'app/pages/crud-produk/copy.js',
    desc: 'Salin baris yang dipilih', group: 'Cari & daftar' },

  { id: 'produk.add', page: 'crud-produk', combo: 'Alt+Shift+P', scope: 'page',
    desc: 'Tambah Produk', group: 'Aksi' },
  { id: 'produk.addFilter', page: 'crud-produk', combo: 'Alt+Shift+F', scope: 'page',
    desc: 'Tambah Filter', group: 'Aksi' },
  { id: 'produk.help', page: 'crud-produk', combo: '?', scope: 'page',
    desc: 'Tampilkan daftar pintasan ini', group: 'Aksi' },

  { id: 'produk.save', page: 'crud-produk', combo: ['Mod+S', 'Mod+Enter'], scope: 'modal',
    desc: 'Simpan (dialog Produk, AKD, KFA)', group: 'Dialog & panel' },
  { id: 'produk.filterClose', page: 'crud-produk', combo: 'Escape', scope: 'popover', allowTyping: true,
    desc: 'Tutup panel Tambah Filter', group: 'Dialog & panel' },
  { id: 'produk.closeDialog', page: 'crud-produk', combo: 'Escape', scope: 'modal', allowTyping: true,
    desc: 'Tutup dialog yang terbuka (Produk, AKD, KFA, Log Aktivitas)', group: 'Dialog & panel' },

  // ─── konversian ───
  // Dipasang lewat engine ini (handler di konversian/index.js), KECUALI yang bertanda `external`:
  // Alt+Shift+M masih dipasang di clipboard.js, dan tombol panah / Enter / Esc di kolom Cari Produk
  // dipasang di search.js (dicatat di sini supaya muncul di cheat sheet dan bentrok kelihatan).
  // "/" dan j/k/panah jalan di fase capture jadi menang atas sidebar.
  { id: 'konv.sesiBaru', page: 'konversian', combo: 'Alt+Shift+M', scope: 'page', external: 'app/pages/konversian/clipboard.js',
    desc: 'Mulai Sesi Baru', group: 'Sesi' },
  { id: 'konv.sesi.selesai', page: 'konversian', combo: 'Alt+Shift+S', scope: 'page',
    desc: 'Selesaikan Sesi (tetap minta konfirmasi dulu)', group: 'Sesi' },
  { id: 'konv.sesi.keluar', page: 'konversian', combo: 'Alt+Shift+L', scope: 'page',
    desc: 'Keluar dari Sesi (sesi tetap berjalan)', group: 'Sesi' },
  { id: 'konv.help', page: 'konversian', combo: '?', scope: 'page',
    desc: 'Tampilkan daftar pintasan ini', group: 'Aksi' },
  { id: 'konv.primary', page: 'konversian', combo: 'Mod+Enter', scope: 'page',
    desc: 'Aksi utama tab ini: Cocokkan ke katalog / Cari SET Mendekati / Generate SPH (jalan juga saat mengetik)', group: 'Aksi' },
  { id: 'konv.dict.add', page: 'konversian', combo: 'n', scope: 'page', tab: 'dictionary',
    desc: 'Dictionary: tambah istilah', group: 'Aksi' },
  { id: 'konv.clip.toggle', page: 'konversian', combo: 'Alt+Shift+K', scope: 'page',
    desc: 'Buka / tutup panel clipboard', group: 'Aksi' },
  { id: 'konv.export', page: 'konversian', combo: 'Alt+Shift+X', scope: 'page',
    desc: 'Export ke Excel', group: 'Aksi' },
  { id: 'konv.drive', page: 'konversian', combo: 'Alt+Shift+U', scope: 'page',
    desc: 'Simpan ke Drive (setelah Export)', group: 'Aksi' },

  { id: 'konv.search', page: 'konversian', combo: '/', scope: 'page', overrides: 'nav.search',
    desc: 'Fokus ke kolom cari / input di tab ini', group: 'Cari & daftar' },
  // Kolom Cari Produk (search.js): sudah lama jalan, sekarang dicatat supaya kelihatan di cheat sheet.
  { id: 'konv.cari.next', page: 'konversian', combo: 'ArrowDown', scope: 'page', tab: 'cari', allowTyping: true, external: 'app/pages/konversian/search.js',
    desc: 'Cari Produk: hasil / saran berikutnya', group: 'Cari & daftar' },
  { id: 'konv.cari.prev', page: 'konversian', combo: 'ArrowUp', scope: 'page', tab: 'cari', allowTyping: true, external: 'app/pages/konversian/search.js',
    desc: 'Cari Produk: hasil / saran sebelumnya', group: 'Cari & daftar' },
  // Shift+panah: validator mengabaikan Shift di tombol polos, jadi dianggap sama dengan panah biasa -> ditandai overrides
  // (bukan bentrok sungguhan: search.js membedakan lewat e.shiftKey).
  { id: 'konv.cari.extendNext', page: 'konversian', combo: 'Shift+ArrowDown', scope: 'page', tab: 'cari', allowTyping: true, overrides: 'konv.cari.next', external: 'app/pages/konversian/search.js',
    desc: 'Cari Produk: perluas pilihan ke hasil berikutnya (rentang)', group: 'Cari & daftar' },
  { id: 'konv.cari.extendPrev', page: 'konversian', combo: 'Shift+ArrowUp', scope: 'page', tab: 'cari', allowTyping: true, overrides: 'konv.cari.prev', external: 'app/pages/konversian/search.js',
    desc: 'Cari Produk: perluas pilihan ke hasil sebelumnya (rentang)', group: 'Cari & daftar' },
  { id: 'konv.cari.copy', page: 'konversian', combo: 'Mod+C', scope: 'page', tab: 'cari', allowTyping: true, external: 'app/pages/konversian/search.js',
    desc: 'Cari Produk: copy info produk yang disorot / rentang pilihan (sama kayak tombol Copy), kecuali ada teks yang diblok', group: 'Cari & daftar' },
  { id: 'konv.cari.add', page: 'konversian', combo: 'Enter', scope: 'page', tab: 'cari', allowTyping: true, external: 'app/pages/konversian/search.js',
    desc: 'Cari Produk: tambah hasil yang disorot ke clipboard, atau SEMUA yang terpilih kalau ada rentang Shift+↓ (yang sudah ada dilewati)', group: 'Cari & daftar' },
  { id: 'konv.cari.esc', page: 'konversian', combo: 'Escape', scope: 'page', tab: 'cari', allowTyping: true, external: 'app/pages/konversian/search.js',
    desc: 'Cari Produk: lepas sorotan / tutup saran', group: 'Cari & daftar' },
  { id: 'konv.filter.instrument', page: 'konversian', combo: 'Alt+Shift+1', scope: 'page', tab: 'cari',
    desc: 'Cari Produk: filter Instrumen (1-6 = urutan tombol filter, jalan juga saat mengetik)', group: 'Cari & daftar' },
  { id: 'konv.filter.set', page: 'konversian', combo: 'Alt+Shift+2', scope: 'page', tab: 'cari',
    desc: 'Cari Produk: filter Set', group: 'Cari & daftar' },
  { id: 'konv.filter.unit', page: 'konversian', combo: 'Alt+Shift+3', scope: 'page', tab: 'cari',
    desc: 'Cari Produk: filter Unit', group: 'Cari & daftar' },
  { id: 'konv.filter.akd', page: 'konversian', combo: 'Alt+Shift+4', scope: 'page', tab: 'cari',
    desc: 'Cari Produk: filter AKD', group: 'Cari & daftar' },
  { id: 'konv.filter.verified', page: 'konversian', combo: 'Alt+Shift+5', scope: 'page', tab: 'cari',
    desc: 'Cari Produk: filter Verified', group: 'Cari & daftar' },
  { id: 'konv.filter.swasta', page: 'konversian', combo: 'Alt+Shift+6', scope: 'page', tab: 'cari',
    desc: 'Cari Produk: filter Harga Swasta', group: 'Cari & daftar' },

  { id: 'konv.list.next', page: 'konversian', combo: 'j', scope: 'page', repeat: true, tab: ['sesi', 'riwayat', 'project', 'converter', 'dictionary'],
    desc: 'Daftar: baris / kartu berikutnya (Konversi Berjalan, Riwayat, Project, Converter, Dictionary)', group: 'Cari & daftar' },
  { id: 'konv.list.prev', page: 'konversian', combo: 'k', scope: 'page', repeat: true, tab: ['sesi', 'riwayat', 'project', 'converter', 'dictionary'],
    desc: 'Daftar: baris / kartu sebelumnya', group: 'Cari & daftar' },
  { id: 'konv.list.open', page: 'konversian', combo: 'Enter', scope: 'page', tab: ['sesi', 'riwayat', 'project', 'dictionary'], external: 'app/pages/konversian/index.js',
    desc: 'Daftar: buka kartu / baris yang difokus', group: 'Cari & daftar' },
  { id: 'konv.list.reload', page: 'konversian', combo: 'r', scope: 'page', tab: ['sesi', 'riwayat', 'project', 'dictionary'],
    desc: 'Daftar: muat ulang', group: 'Cari & daftar' },
  { id: 'konv.riwayat.pageNext', page: 'konversian', combo: 'ArrowRight', scope: 'page', tab: 'riwayat',
    desc: 'Riwayat: halaman berikutnya', group: 'Cari & daftar' },
  { id: 'konv.riwayat.pagePrev', page: 'konversian', combo: 'ArrowLeft', scope: 'page', tab: 'riwayat',
    desc: 'Riwayat: halaman sebelumnya', group: 'Cari & daftar' },
  { id: 'konv.conv.check', page: 'konversian', combo: 'x', scope: 'page', tab: 'converter',
    desc: 'Converter: centang / lepas baris yang disorot', group: 'Cari & daftar' },
  { id: 'konv.conv.copy', page: 'konversian', combo: 'Mod+C', scope: 'page', tab: 'converter',
    desc: 'Converter: salin baris yang dicentang (Copy + Gambar), kecuali ada teks yang diblok', group: 'Cari & daftar' },

  { id: 'konv.tab.cari', page: 'konversian', combo: '1', scope: 'page', desc: 'Buka tab Cari Produk', group: 'Pindah tab' },
  { id: 'konv.tab.sesi', page: 'konversian', combo: '2', scope: 'page', desc: 'Buka tab Konversi Berjalan', group: 'Pindah tab' },
  { id: 'konv.tab.riwayat', page: 'konversian', combo: '3', scope: 'page', desc: 'Buka tab Riwayat', group: 'Pindah tab' },
  { id: 'konv.tab.project', page: 'konversian', combo: '4', scope: 'page', desc: 'Buka tab Project', group: 'Pindah tab' },
  { id: 'konv.tab.converter', page: 'konversian', combo: '5', scope: 'page', desc: 'Buka tab Converter', group: 'Pindah tab' },
  { id: 'konv.tab.setcari', page: 'konversian', combo: '6', scope: 'page', desc: 'Buka tab Cari SET', group: 'Pindah tab' },
  { id: 'konv.tab.dictionary', page: 'konversian', combo: '7', scope: 'page', desc: 'Buka tab Dictionary', group: 'Pindah tab' },
  { id: 'konv.clip.prev', page: 'konversian', combo: '[', scope: 'page',
    desc: 'Panel clipboard: ke panel kiri (Kebutuhan RS ← Clipboard ← Buat SPH)', group: 'Pindah tab' },
  { id: 'konv.clip.next', page: 'konversian', combo: ']', scope: 'page',
    desc: 'Panel clipboard: ke panel kanan', group: 'Pindah tab' },

  { id: 'konv.dialog.submit', page: 'konversian', combo: 'Mod+Enter', scope: 'modal',
    desc: 'Simpan / Kirim di dialog (Record Konversi, Record SPH, Permintaan RS, Lampiran, Nama section)', group: 'Dialog & panel' },
  // Layar Periksa item (modal Permintaan RS): atur Jenis item dengan cepat. Tombol polos otomatis tidak jalan saat mengetik.
  { id: 'konv.rv.next', page: 'konversian', combo: 'j', scope: 'modal', repeat: true,
    desc: 'Periksa item: baris berikutnya', group: 'Periksa item (Jenis)' },
  { id: 'konv.rv.prev', page: 'konversian', combo: 'k', scope: 'modal', repeat: true,
    desc: 'Periksa item: baris sebelumnya', group: 'Periksa item (Jenis)' },
  { id: 'konv.rv.set1', page: 'konversian', combo: '1', scope: 'modal',
    desc: 'Periksa item: Jenis SET, lalu maju ke baris berikutnya (atau ke semua yang dipilih)', group: 'Periksa item (Jenis)' },
  { id: 'konv.rv.set2', page: 'konversian', combo: '2', scope: 'modal',
    desc: 'Periksa item: Jenis INSTRUMENT', group: 'Periksa item (Jenis)' },
  { id: 'konv.rv.set3', page: 'konversian', combo: '3', scope: 'modal',
    desc: 'Periksa item: Jenis UNIT', group: 'Periksa item (Jenis)' },
  { id: 'konv.rv.clear', page: 'konversian', combo: '0', scope: 'modal',
    desc: 'Periksa item: kosongkan Jenis', group: 'Periksa item (Jenis)' },
  { id: 'konv.rv.accept', page: 'konversian', combo: 'a', scope: 'modal',
    desc: 'Periksa item: terima usulan Jenis di baris aktif (atau yang dipilih)', group: 'Periksa item (Jenis)' },
  { id: 'konv.rv.fillDown', page: 'konversian', combo: 'f', scope: 'modal',
    desc: 'Periksa item: isi ke bawah (salin Jenis baris aktif ke baris kosong di bawahnya)', group: 'Periksa item (Jenis)' },
  { id: 'konv.rv.select', page: 'konversian', combo: 'x', scope: 'modal',
    desc: 'Periksa item: pilih / lepas baris aktif', group: 'Periksa item (Jenis)' },
  { id: 'konv.rv.extendDown', page: 'konversian', combo: 'Shift+ArrowDown', scope: 'modal', repeat: true,
    desc: 'Periksa item: perluas pilihan ke bawah', group: 'Periksa item (Jenis)' },
  { id: 'konv.rv.extendUp', page: 'konversian', combo: 'Shift+ArrowUp', scope: 'modal', repeat: true,
    desc: 'Periksa item: perluas pilihan ke atas', group: 'Periksa item (Jenis)' },
  { id: 'konv.rv.selectAll', page: 'konversian', combo: 'Mod+A', scope: 'modal',
    desc: 'Periksa item: pilih semua yang tampil (di luar kolom ketik)', group: 'Periksa item (Jenis)' },
  { id: 'konv.rv.undo', page: 'konversian', combo: 'Mod+Z', scope: 'modal',
    desc: 'Periksa item: urungkan pengaturan Jenis terakhir (di luar kolom ketik)', group: 'Periksa item (Jenis)' },
  { id: 'konv.rv.edit', page: 'konversian', combo: 'Enter', scope: 'modal',
    desc: 'Periksa item: edit nama baris aktif', group: 'Periksa item (Jenis)' },
  { id: 'konv.riwayat.closeMenu', page: 'konversian', combo: 'Escape', scope: 'page', allowTyping: true, tab: 'riwayat',
    desc: 'Riwayat: tutup menu status kartu', group: 'Dialog & panel' },
];

const PAGE_LABELS = { 'crud-produk': 'CRUD Produk', konversian: 'Konversian' };
const GROUP_ORDER = ['Sesi', 'Pindah tab', 'Cari & daftar', 'Aksi', 'Dialog & panel'];

const toArray = (v) => (Array.isArray(v) ? v : [v]);
const byId = (id) => SHORTCUTS.find((s) => s.id === id);

// ───────────────────────── parsing & pencocokan ─────────────────────────

const MODS = ['mod', 'ctrl', 'alt', 'shift', 'meta'];

export function parseCombo(raw) {
  const parts = raw.split('+');
  const key = parts.pop();
  if (!key) throw new Error(`Kombinasi kosong: "${raw}"`);
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  for (const m of mods) if (!MODS.includes(m)) throw new Error(`Modifier tidak dikenal "${m}" di "${raw}"`);
  return { raw, key, mod: mods.has('mod'), ctrl: mods.has('ctrl'), alt: mods.has('alt'), shift: mods.has('shift'), meta: mods.has('meta') };
}

const isBare = (c) => !c.alt && !c.mod && !c.ctrl && !c.meta;

function codeFor(key) {
  if (/^[a-z]$/i.test(key)) return 'Key' + key.toUpperCase();
  if (/^\d$/.test(key)) return 'Digit' + key;
  return key; // 'Enter', 'Escape', ...
}

function matchEvent(e, c) {
  if (c.alt !== e.altKey) return false;
  if (c.mod) { if (e.ctrlKey === e.metaKey) return false; } // tepat satu dari Ctrl / Cmd
  else if (c.ctrl !== e.ctrlKey || c.meta !== e.metaKey) return false;
  // Tombol polos: e.key apa adanya (Shift sudah terkandung di "?" atau "J").
  // Tombol non-karakter (panah, Enter, Escape): Shift harus sama persis, supaya "↓" dan "Shift+↓" bisa jadi dua pintasan berbeda.
  if (isBare(c)) return e.key === c.key && (c.key.length === 1 || c.shift === e.shiftKey);
  if (c.shift !== e.shiftKey) return false;
  if (c.alt) return e.code === codeFor(c.key);
  return String(e.key).toLowerCase() === c.key.toLowerCase();
}

// ───────────────────────── konteks ─────────────────────────

const NON_TEXT_INPUT = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'file', 'color', 'image']);

// Fokus di tempat orang mengetik. Checkbox/radio/tombol sengaja TIDAK dihitung, jadi j/k tetap jalan
// setelah user mencentang kotak pilih di baris.
export function isTyping(t) {
  if (!t) return false;
  if (t.isContentEditable) return true;
  if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
  if (t.tagName === 'INPUT') return !NON_TEXT_INPUT.has((t.type || 'text').toLowerCase());
  return false;
}

// Sama dengan pola yang sudah dipakai di Konversian, ditambah kelas yang dipakai CRUD Produk.
const DIALOG_SELECTOR = [
  '.modal-overlay.open', '.modal-overlay.show',
  '.confirm-overlay.open', '.confirm-overlay.show',
  '.cmdk-overlay.open', '.cmdk-overlay.show',
  '[class*="modal"].show', '[class*="overlay"].show', '[id*="modal"].show',
].join(',');

export function isDialogOpen() {
  return !!document.querySelector(DIALOG_SELECTOR);
}

// ───────────────────────── tampilan kombinasi ─────────────────────────

const KEY_LABEL = { Escape: 'Esc', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' };

// Potongan tombol satu kombinasi, urutan tampil: ["Alt", "Shift", "S"] (Mac: ["⌥", "⇧", "S"]).
export function comboParts(raw) {
  const c = parseCombo(raw);
  const k = KEY_LABEL[c.key] || (isBare(c) ? c.key : (c.key.length === 1 ? c.key.toUpperCase() : c.key));
  const mods = [];
  if (c.mod || c.ctrl) mods.push(IS_MAC && c.mod ? '⌘' : 'Ctrl');
  if (c.meta) mods.push(IS_MAC ? '⌘' : 'Win');
  if (c.alt) mods.push(IS_MAC ? '⌥' : 'Alt');
  if (c.shift) mods.push(IS_MAC ? '⇧' : 'Shift');
  return [...mods, k];
}

export function formatCombo(raw) {
  return comboParts(raw).join(IS_MAC ? '' : '+');
}

function ariaCombo(raw) {
  const c = parseCombo(raw);
  const k = c.key.length === 1 ? c.key.toUpperCase() : c.key;
  const base = (ctrl, meta) => [ctrl && 'Control', meta && 'Meta', c.alt && 'Alt', c.shift && 'Shift', k].filter(Boolean).join('+');
  if (c.mod) return base(true, false) + ' ' + base(false, true); // aria tidak kenal "Mod"
  return base(c.ctrl, c.meta);
}

// Isi title + aria-keyshortcuts dari registry.
//   map: { '#idTombol': 'produk.add' }  atau  { '#kolom': { ids: ['a', 'b'], base: 'Cari produk' } }
// Teks dasar title diambil dari title lama / isi tombol, disimpan di data-sc-base supaya aman dipanggil ulang.
export function applyShortcutHints(map, root = document) {
  for (const [selector, spec] of Object.entries(map)) {
    const el = root.querySelector(selector);
    if (!el) { console.warn(`[shortcuts] elemen tidak ditemukan: ${selector}`); continue; }
    const ids = typeof spec === 'string' ? [spec] : spec.ids;
    const combos = [];
    for (const id of ids) {
      const def = byId(id);
      if (!def) { console.warn(`[shortcuts] id tidak ada di registry: ${id}`); continue; }
      combos.push(...toArray(def.combo));
    }
    if (!combos.length) continue;
    const base = el.dataset.scBase
      ?? ((typeof spec === 'object' && spec.base) || el.getAttribute('title') || el.textContent.replace(/\s+/g, ' ').trim());
    el.dataset.scBase = base;
    el.title = `${base} (${combos.map(formatCombo).join(' / ')})`;
    el.setAttribute('aria-keyshortcuts', combos.map(ariaCombo).join(' '));
  }
}

// ───────────────────────── engine ─────────────────────────

// handlers: { [id]: (event, { page, def }) => boolean | void }
//   Kembalikan false = "bukan urusan saya" -> event dibiarkan lewat (dan handler lain, misalnya "/" di
//   nav.js, tetap jalan). Selain false = ditangani -> preventDefault + stopImmediatePropagation.
// Listener dipasang di fase capture supaya pintasan halaman menang atas pintasan global yang
// dipasang di fase bubble (nav.js).
export function installShortcuts(page, handlers) {
  const entries = [];
  for (const def of SHORTCUTS) {
    if (def.external) continue;
    if (def.page !== page && def.page !== '*') continue;
    const fn = handlers[def.id];
    if (!fn) continue;
    for (const raw of toArray(def.combo)) entries.push({ def, combo: parseCombo(raw), fn });
  }
  for (const id of Object.keys(handlers)) {
    const def = byId(id);
    if (!def || def.external) console.error(`[shortcuts] handler "${id}" tidak punya definisi aktif di registry`);
  }

  const onKeyDown = (e) => {
    if (e.isComposing || e.defaultPrevented) return;
    for (const { def, combo, fn } of entries) {
      if (!matchEvent(e, combo)) continue;
      if (isBare(combo) && !def.allowTyping && isTyping(e.target)) continue;
      const scope = def.scope || 'page';
      const dialog = isDialogOpen();
      if (((scope === 'page' || scope === 'popover') && dialog) || (scope === 'modal' && !dialog)) {
        if (combo.alt) e.preventDefault(); // cegah karakter aneh di Mac / aksi bawaan browser
        continue;
      }
      if (e.repeat && !def.repeat) { e.preventDefault(); return; } // tombol ditahan: jangan jalan berkali-kali
      if (fn(e, { page, def }) === false) continue;
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
  };
  document.addEventListener('keydown', onKeyDown, true);

  return function dispose() {
    document.removeEventListener('keydown', onKeyDown, true);
    closeCheatSheet();
  };
}

// ───────────────────────── cheat sheet ─────────────────────────

let sheetEl = null;
let sheetKeyHandler = null;
let sheetReturnFocus = null;

function ensureSheetStyle() {
  if (document.getElementById('pnm-shortcuts-style')) return;
  const st = document.createElement('style');
  st.id = 'pnm-shortcuts-style';
  st.textContent = `
.modal-overlay.pnm-sc-overlay{align-items:center;padding:24px 16px}
.pnm-sc-card{max-width:780px;max-height:min(720px,calc(100vh - 48px));max-height:min(720px,calc(100dvh - 48px));display:flex;flex-direction:column;padding:0;overflow:hidden}
.pnm-sc-card .modal-head{margin:0;padding:20px 24px 14px;border-bottom:1px solid var(--border)}
.pnm-sc-card .modal-close{margin:-2px -6px 0 0}
.pnm-sc-card .modal-title{margin-bottom:0}
.pnm-sc-card .modal-sub{margin:2px 0 0}
.pnm-sc-body{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:0 24px 12px;columns:2 300px;column-gap:44px}
.pnm-sc-group{break-after:avoid;margin:0;padding:18px 0 6px;font-size:12px;font-weight:600;color:var(--text-secondary)}
.pnm-sc-row{break-inside:avoid;display:flex;align-items:baseline;justify-content:space-between;gap:14px;padding:5px 0;font-size:13px;line-height:1.4;color:var(--text)}
.pnm-sc-keys{display:inline-flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;flex-shrink:0;max-width:50%;gap:4px 8px}
.pnm-sc-combo{display:inline-flex;align-items:center;gap:3px;white-space:nowrap}
.pnm-sc-plus,.pnm-sc-or{font-size:11.5px;color:var(--text-muted)}
.pnm-sc-kbd{min-width:22px;padding:1px 6px 0;text-align:center;border:1px solid var(--border-strong);border-bottom-width:2px;border-radius:var(--radius-sm);background:var(--surface-2);color:var(--text-secondary);font-family:var(--font-mono,ui-monospace,monospace);font-size:11.5px;line-height:1.6;white-space:nowrap}
.pnm-sc-note{margin:0;padding:12px 24px 16px;border-top:1px solid var(--border);font-size:12px;line-height:1.5;color:var(--text-muted)}
@media (max-width:520px){.pnm-sc-card .modal-head{padding:16px 16px 12px}.pnm-sc-body{padding:0 16px 8px}.pnm-sc-note{padding:12px 16px 14px}.pnm-sc-row{flex-direction:column;align-items:flex-start;gap:4px}.pnm-sc-keys{justify-content:flex-start;max-width:none}}
`;
  document.head.appendChild(st);
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

export function isCheatSheetOpen() { return !!sheetEl; }

export function closeCheatSheet() {
  if (sheetKeyHandler) document.removeEventListener('keydown', sheetKeyHandler, true);
  sheetKeyHandler = null;
  if (sheetEl) sheetEl.remove();
  sheetEl = null;
  if (sheetReturnFocus && sheetReturnFocus.isConnected) sheetReturnFocus.focus();
  sheetReturnFocus = null;
}

export function toggleCheatSheet(page) {
  if (sheetEl) { closeCheatSheet(); return; }
  ensureSheetStyle();

  const pageDefs = SHORTCUTS.filter((s) => s.page === page);
  const overridden = new Set(pageDefs.map((s) => s.overrides).filter(Boolean));
  // Yang disembunyikan cuma pintasan GLOBAL yang dikalahkan halaman ini (mis. "/" milik sidebar); pintasan halaman yang
  // di-`overrides` pintasan halaman lain (mis. ↓ vs Shift+↓) tetap tampil.
  const defs = SHORTCUTS.filter((s) => (s.page === page || s.page === '*') && !(s.page === '*' && overridden.has(s.id)));

  const overlay = el('div', 'modal-overlay open show pnm-sc-overlay');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'pnmScTitle');

  const card = el('div', 'modal-card pnm-sc-card');
  const head = el('div', 'modal-head');
  const titleWrap = el('div');
  const title = el('div', 'modal-title', 'Pintasan keyboard');
  title.id = 'pnmScTitle';
  titleWrap.append(title, el('div', 'modal-sub', PAGE_LABELS[page] || page));
  const closeBtn = el('button', 'modal-close');
  closeBtn.type = 'button';
  closeBtn.title = 'Tutup (Esc)';
  closeBtn.setAttribute('aria-label', 'Tutup');
  closeBtn.append(el('i', 'ti ti-x'));
  closeBtn.addEventListener('click', closeCheatSheet);
  head.append(titleWrap, closeBtn);
  card.append(head);

  const body = el('div', 'pnm-sc-body');
  const groups = [...new Set(defs.map((d) => d.group || 'Lainnya'))]
    .sort((a, b) => (GROUP_ORDER.indexOf(a) + 1 || 99) - (GROUP_ORDER.indexOf(b) + 1 || 99));
  for (const g of groups) {
    body.append(el('div', 'pnm-sc-group', g));
    for (const d of defs.filter((x) => (x.group || 'Lainnya') === g)) {
      const row = el('div', 'pnm-sc-row');
      row.append(el('span', null, d.desc));
      const keys = el('span', 'pnm-sc-keys');
      toArray(d.combo).forEach((c, i) => {
        if (i) keys.append(el('span', 'pnm-sc-or', 'atau'));
        const combo = el('span', 'pnm-sc-combo');
        comboParts(c).forEach((part, n) => {
          if (n && !IS_MAC) combo.append(el('span', 'pnm-sc-plus', '+'));
          combo.append(el('kbd', 'pnm-sc-kbd', part));
        });
        keys.append(combo);
      });
      row.append(keys);
      body.append(row);
    }
  }
  card.append(body);
  card.append(el('p', 'pnm-sc-note', 'Tombol tunggal (j, k, 1–7, dst.) tidak jalan saat kamu mengetik di kolom input; kombinasi Alt+Shift jalan di mana saja. Tekan ? atau Esc untuk menutup.'));

  overlay.append(card);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeCheatSheet(); });
  document.body.append(overlay);
  sheetEl = overlay;
  sheetReturnFocus = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;

  // Selagi terbuka: Esc / ? menutup, Tab tidak boleh lari ke belakang overlay, "/" tidak boleh
  // menembus ke pencarian sidebar.
  sheetKeyHandler = (e) => {
    if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); e.stopImmediatePropagation(); closeCheatSheet(); return; }
    if (e.key === 'Tab') { e.preventDefault(); closeBtn.focus(); return; }
    if (e.key === '/') { e.preventDefault(); e.stopImmediatePropagation(); }
  };
  document.addEventListener('keydown', sheetKeyHandler, true);
  closeBtn.focus();
}

// ───────────────────────── validasi registry ─────────────────────────

function normalize(raw) {
  const c = parseCombo(raw);
  const mods = [c.alt && 'alt', (c.mod || c.ctrl) && 'ctrl', c.meta && 'meta', c.shift && (!isBare(c) || c.key.length > 1) && 'shift'].filter(Boolean);
  return [...mods, c.key.toLowerCase()].join('+');
}

// Mengembalikan { errors: string[], warnings: string[] }. Tidak menyentuh DOM.
export function validateRegistry() {
  const errors = [];
  const warnings = [];

  const seen = new Set();
  for (const s of SHORTCUTS) {
    if (seen.has(s.id)) errors.push(`id dobel: ${s.id}`);
    seen.add(s.id);
  }

  const reserved = new Map(BROWSER_RESERVED.map((r) => [normalize(r.combo), r]));
  const flat = [];
  for (const s of SHORTCUTS) {
    for (const raw of toArray(s.combo)) {
      let n;
      try { n = normalize(raw); } catch (err) { errors.push(`${s.id}: ${err.message}`); continue; }
      flat.push({ s, raw, n });
      const r = reserved.get(n);
      if (r) errors.push(`${s.id}: ${raw} dilarang (${r.why})`);
    }
    if (s.overrides && !byId(s.overrides)) errors.push(`${s.id}: overrides "${s.overrides}" tidak ada`);
    if (s.knownConflict && !byId(s.knownConflict)) errors.push(`${s.id}: knownConflict "${s.knownConflict}" tidak ada`);
    if (!s.external && !s.desc) errors.push(`${s.id}: desc kosong`);
  }

  const scopeOf = (s) => s.scope || 'page';
  const scopesOverlap = (a, b) => scopeOf(a) === 'any' || scopeOf(b) === 'any' || scopeOf(a) === scopeOf(b)
    || (['page', 'popover'].includes(scopeOf(a)) && ['page', 'popover'].includes(scopeOf(b)));
  const pagesOverlap = (a, b) => a.page === '*' || b.page === '*' || a.page === b.page;
  const tabsOverlap = (a, b) => !a.tab || !b.tab || toArray(a.tab).some((t) => toArray(b.tab).includes(t));

  for (let i = 0; i < flat.length; i++) {
    for (let j = i + 1; j < flat.length; j++) {
      const a = flat[i], b = flat[j];
      if (a.s === b.s || a.n !== b.n) continue;
      if (!pagesOverlap(a.s, b.s) || !scopesOverlap(a.s, b.s) || !tabsOverlap(a.s, b.s)) continue;
      if (a.s.overrides === b.s.id || b.s.overrides === a.s.id) continue;
      const msg = `bentrok: ${a.s.id} dan ${b.s.id} sama-sama ${a.raw}`;
      if (a.s.knownConflict === b.s.id || b.s.knownConflict === a.s.id) warnings.push(`${msg} (diketahui, belum diperbaiki)`);
      else errors.push(msg);
    }
  }
  return { errors, warnings };
}