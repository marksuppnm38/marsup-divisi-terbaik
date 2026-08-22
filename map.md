# MAP.md

Peta singkat repo ini, plus rencana pindah ke vanilla SPA. Tujuan file ini: siapapun (termasuk Claude sesi baru) bisa ngerti struktur app dalam beberapa menit, tanpa harus baca 22 ribu baris dulu.

Cara baca: bagian 1–2 itu potret KONDISI SEKARANG (apa adanya, termasuk bagian yang berantakan). Bagian 3–5 itu RENCANA.

**Baca juga `visi-pionir-workspaces.md`** (dibuat 23 Agustus 2026) — dokumen terpisah soal keputusan arsitektur level lebih tinggi: `index.html` (gerbang kubus 3D, lalu flat module grid) sudah jadi shell SPA per sesi ketujuh — baca update sesi ketujuh di `visi-pionir-workspaces.md` buat status lengkap langkah 2, dan bagian 5 dokumen itu buat langkah 3-5 yang masih tersisa.

---

## 1. Kondisi sekarang: 6 halaman, 6 cara load yang beda-beda

Setiap `.html` di root itu halaman terpisah, full page reload kalau pindah. Bukan SPA sama sekali sekarang.

| Halaman | JS-nya | Pakai shared/auth-session.js? | Auth-nya gimana |
|---|---|---|---|
| `konversian.html` | **DIHAPUS** — sudah jadi `app/pages/konversian/` di SPA, gak ada lagi standalone file (sesi keempat) | **Ya, penuh** — semua panggil `PNMAuth.*` | Satu-satunya yang udah bener |
| `crud-produk.html` | `crud-produk.js` (2920 baris) | Script-nya di-load, tapi **gak pernah dipanggil** | Auth manual sendiri (`checkWhitelistAndShowApp`, fetch langsung ke `/auth/v1/token`) |
| `stok.html` | inline `<script>` di dalam file itu sendiri | **Gak di-load sama sekali** | Auth manual sendiri, refresh token manual lewat `fetch()` |
| `dashboard.html` | `dashboard.js` (1295 baris) | **Gak di-load sama sekali** | Auth manual sendiri, sama polanya kayak stok.html |
| `export-gambar-gabungan.html` | **DIHAPUS** — sudah jadi `app/pages/export-gambar/` di SPA (sesi kesembilan) | — | — |
| `kompres-pdf.html` | **DIHAPUS** — sudah jadi `app/pages/kompres-pdf/` di SPA (sesi kesembilan) | — | — |

**Yang ini penting:** `shared/supabase-client.js` dan `shared/auth-session.js` sudah dibuat (Agustus 2026) justru buat nyatuin ini semua, tapi migrasinya baru kelar di satu halaman (`konversian.html`). Ini bukan salah desain — komentar di `shared/auth-session.js` sendiri bilang jujur: *"modul lama... nanti tinggal diganti panggil ke PNMAuth.* — TAPI itu perubahan di file modul yang lagi disentuh sesi lain, jadi belum dilakukan di sini."* Jadi ini kerjaan yang sudah direncanakan, cuma belum digilir ke semua halaman.

**Bukti nyata duplikasinya:** `const SUPABASE_URL = '...'` di-declare ulang di 4 file berbeda (`konversian.js`, `crud-produk.js`, `dashboard.js`, `stok.html`), masing-masing juga punya fungsi refresh-token sendiri-sendiri yang isinya mirip tapi gak identik.

Contoh kecil lain: `shared/toast.js` sekarang nampung DUA skema class CSS berbeda (`.toast-success` buat konversian.js, `.toast.success` buat crud-produk.js) karena dua sistem lama disatuin belakangan tanpa diseragamin dulu — jalan, tapi nunjukin arah yang sama: makin banyak halaman, makin banyak "cara sendiri-sendiri" yang harus ditebak.

**Ini justru titik awal migrasi SPA yang paling gampang** — bukan mulai dari nol, tinggal nerusin migrasi PNMAuth yang udah dimulai, sambil dibarengin sama routing.

---

## 2. Isi konversian.js per bagian (buat nanti dipecah)

File ini yang paling gede (6998 baris), tapi sebenarnya sudah punya batas-batas section yang jelas lewat komentar `══════` di dalamnya. Ini daftarnya, urut dari atas:

1. Sesi login persistent + auth (baris ~30–250)
2. Realtime client setup (postgres_changes/presence/broadcast)
3. Resize panel clipboard (drag handle)
4. Collapse panel pencarian
5. Preferensi/settings
6. Status koneksi (online/offline banner)
7. Sesi konversi (clipboard sebagai objek tersimpan di server)
8. Dua pintu: Cari Cepat vs Konversi
9. Navigasi konversian.html ↔ crud-produk.html
10. Realtime kolaborasi (2 channel per sesi)
11. Tab clipboard: Kebutuhan RS vs Clipboard
12. Record konversi → Google Sheets (webhook)
13. Dual write ke Supabase
14. Modul Stok (di dalam konversian.js juga, bukan cuma di stok.html)
15. Modul Converter (paste kode+nama → cocokkan ke katalog)
16. Resolve manual buat baris yang gak ketemu
17. Pencarian exact-by-kode (disatukan, sudah ada cache)
18. Modul Permintaan RS
19. Kebutuhan RS (sidebar clipboard)
20. Saran Dictionary inline
21. Cari SET Mendekati (fuzzy match, skor Jaccard)
22. Dictionary istilah customer

Ini bukan file yang berantakan tanpa struktur — struktur logisnya udah ada, cuma belum dipisah jadi file fisik terpisah. Kerja "pisahin jadi modul" jadi jauh lebih gampang karena batasnya udah kelihatan.

---

## 3. Target struktur SPA

```
/app
  shell.html          <- satu file HTML kosong, cuma ada <div id="app"> + <script type="module" src="/app/router.js">
  router.js           <- ~40 baris, dengar hash/History API, import() modul halaman, panggil mount()
  state/
    store.js          <- pengganti PNMAuth + variabel global tersebar (stokAccessToken, currentUser, dst)
  pages/
    konversian/
      index.js         <- export mount(container)/unmount()
      search.js         <- section 8 (Cari Cepat) + 17 (exact-by-kode)
      clipboard.js       <- section 7, 11
      sph.js             <- isi sph-module.js, hampir gak berubah
      dictionary.js      <- section 20, 22
      set-mendekati.js   <- section 21
      permintaan-rs.js   <- section 18, 19
      realtime.js        <- section 2, 10
    crud-produk/
      index.js
    stok/
      index.js
    dashboard/
      index.js
    kompres-pdf/
      index.js           <- ini paling gampang, gak nyentuh Supabase sama sekali
    export-gambar/
      index.js
shared/                <- TETAP DI SINI, gak pindah — udah bagus posisinya
  supabase-client.js
  auth-session.js
  toast.js
```

Tetap zero-build. `<script type="module">` dan `import()` jalan native di browser, gak butuh bundler, gak butuh `npm install`. Alur "buka file, edit, refresh" tetap sama persis.

---

## 4. Urutan migrasi yang disaranin

Bukan urut abjad, tapi urut dari yang paling siap ke yang paling belum:

1. ✅ **`kompres-pdf.html`** — SELESAI dimigrasi (22 Agustus 2026). Lihat `/app/shell.html`, `/app/router.js` (hash router, ~40 baris), dan `/app/pages/kompres-pdf/` (`index.js` = mount/unmount, `markup.js` = HTML lama sebagai template string, `style.css` = CSS lama apa adanya). Halaman lama `kompres-pdf.html` masih ada dan tetap jalan, belum dihapus — biar aman kalau ada yang masih nge-link ke situ langsung. Diverifikasi dengan Playwright: shell → router → mount markup, ganti tab, ganti route via hash, dan unmount/remount semua jalan tanpa error konsol.
2. ✅ **`export-gambar-gabungan.html`** — SELESAI dimigrasi (22 Agustus 2026). `/app/pages/export-gambar/`. Auth manual (`sb.auth.signInWithPassword/signOut/onAuthStateChange/getSession`) sudah diganti penuh ke `PNMAuth.login/logout/onAuthStateChange/getSession` — `sb.from('allowed_users')` sengaja TETAP pakai `window.pnmSupabase` langsung (itu query tabel biasa, bukan urusan sesi, jadi di luar tanggung jawab `PNMAuth`). Halaman lama masih ada, belum dihapus. Diverifikasi end-to-end pakai Playwright dengan `shared/supabase-client.js` DAN `shared/auth-session.js` asli (bukan di-mock) — cuma SDK Supabase-nya yang di-stub (CDN-nya diblokir sandbox ini): login salah password → pesan error tampil, login benar → lolos cek whitelist → daftar file dari Storage muncul → klik file → ke-toggle. Juga dicek gonta-ganti route beberapa kali (export-gambar ↔ kompres-pdf) — gak ada style tag dobel, dan variabel global yang dipakai `onclick` inline (`toggleFile`, dkk — lihat catatan di bawah) kehapus bersih pas `unmount()`.
3. **`konversian.html`** — paling gede tapi paling siap secara auth (satu-satunya yang udah PNMAuth penuh). Kerjaannya di sini murni soal pisah-pisah section jadi modul (lihat bagian 2), bukan benerin auth.
4. **`crud-produk.html`** — perlu diganti dulu auth manualnya ke `PNMAuth.*` sebelum ikut masuk SPA, biar gak ada 2 sistem auth jalan bareng.
5. **`stok.html`** dan **`dashboard.html`** — sama kayak crud-produk, tapi juga sekalian dipisah dari inline `<script>` jadi file `.js` sendiri dulu (dashboard.js udah terpisah, stok.html belum).

Setiap halaman yang belum dimigrasi tetap boleh jalan sebagai link biasa (`<a href="/stok.html">`) sampai gilirannya — app gak pernah dalam kondisi setengah-rusak selama proses ini.

---

## 5. Checklist per halaman pas migrasi

Buat tiap halaman yang mau dipindah ke SPA, ini yang perlu dicek:

- [ ] Ganti auth manual (kalau masih ada) ke `PNMAuth.*`
- [ ] Bungkus kode setup jadi `mount(container)` + `unmount()`, bukan langsung jalan pas file di-load
- [ ] Pindahin `const SUPABASE_URL = ...` yang di-duplicate — pakai `window.PNM_SUPABASE_URL` dari shared client
- [ ] Cek toast — pastikan container yang dipakai sama-sama nyambung ke skema class yang sama di `shared/toast.js`
- [ ] Pastikan link internal ke halaman lain (`href="/stok.html"`) diganti ke route SPA setelah halaman tujuannya juga udah dimigrasi

---

## Status

Ditulis: 22 Agustus 2026, hasil investigasi langsung ke isi repo (bukan tebakan dari nama file).
Update file ini kalau ada halaman yang selesai dimigrasi — coret dari daftar bagian 4, jangan biarin basi.

**Update 22 Agustus 2026 (sesi kedua):** `kompres-pdf.html` sudah dimigrasi ke `/app`. Catatan buat sesi berikutnya yang lanjutin ke `export-gambar-gabungan.html` (urutan #2):
- Pola yang dipakai: `mount(container)` di-scope pakai `container.querySelector`/`container.querySelectorAll` (bukan `document.*`), CSS lama di-copy apa adanya ke `style.css` per halaman lalu di-`<link>`-kan sekali lewat `new URL('./style.css', import.meta.url)`, HTML lama disimpan sebagai template string di `markup.js` (zero-build, gak ada cara `import` file `.html` langsung).
- Script vendor pihak ketiga (CDN) di-load on-demand di dalam `mount()`, dicek dulu `window.<Global>` biar gak double-load kalau halaman di-mount ulang.
- Halaman ini gak ada listener di level `document`/`window`, jadi `unmount()`-nya nyaris kosong — halaman lain (terutama yang pakai drag globally atau `PNMAuth`) kemungkinan butuh `unmount()` yang beneran bersih-bersih (`removeEventListener`, clear interval, dsb). Jangan asumsikan pola kosong ini berlaku umum.
- `state/store.js` di bagian 3 BELUM dibuat — belum ada halaman yang butuh dia (kompres-pdf gak pakai Supabase/auth sama sekali). Baru relevan mulai dari `export-gambar-gabungan.html` dan seterusnya, yang mulai nyentuh `PNMAuth`.
- Diverifikasi pakai Playwright headless (bukan cuma baca kode): mount awal, ganti tab, ganti route via hash (unmount → remount), dan fallback halaman yang belum dimigrasi — semua nol error konsol.

**Update 22 Agustus 2026 (sesi keempat):** `konversian.html` sudah dimigrasi ke `/app/pages/konversian/` (urutan #3 selesai). Ini beda pendekatan dari 2 halaman sebelumnya, jadi dicatat detail:
- **Pendekatan beda dari export-gambar/kompres-pdf, SENGAJA**: file ini TIDAK di-rescope dari `document.getElementById(...)` ke `container.querySelector(...)` di ribuan titik pemanggilan — terlalu berisiko buat file sebesar 6998+1351 baris tanpa test browser end-to-end. Ini tetap aman karena router.js menjamin cuma SATU halaman termount di satu waktu (unmount() + `container.innerHTML=''` sebelum halaman baru di-mount), dan konversian.js/sph-module.js menangkap semua referensi elemen SETELAH markup di-inject — jadi `document.getElementById` tetap nemu elemen yang benar.
- **Body asli TIDAK diubah**, kecuali 5 patch bedah kecil (semua ditandai komentar "SPA migration" di titik masing-masing) buat nangkep handle yang dibutuhin `unmount()`: (1) return value `PNMAuth.onAuthStateChange()` ditangkep ke `__konvAuthUnsub`; (2) `setInterval` heartbeat badge sesi (30 detik) ditangkep ke `__konvHeartbeatTimer`; (3) listener `document.addEventListener('click', ...)` buat nutup autocomplete di-nama-in biar bisa di-`removeEventListener`; (4) baris `window.__konvBridge = {...}` ditambahin di paling akhir eksekusi konversian.js buat ngumpulin semua handle di atas; (5) inline script "conv-flow-ux" (dulu `<script>` ke-2 di HTML) ditambahin `window.convFlow._cleanup()` — disconnect 2 `MutationObserver` + lepas keydown listener + clear 2 timer, sebelumnya cuma expose showSuccess/showError/reset tanpa cara bersih-bersih dari luar.
- **2 bug path relatif yang KETEMU dan DIPERBAIKI** akibat pindah dari `/konversian.html` ke `/app/shell.html#konversian`: (a) `navigateToEditProduk()` pakai `new URL('crud-produk.html', window.location.href)` — kalau dibiarkan bakal resolve ke `/app/crud-produk.html` (gak ada), sekarang absolute `/crud-produk.html` (nembak file standalone yang masih ada, karena crud-produk.html BELUM dimigrasi — lihat urutan #4); (b) sph-module.js pakai path `assets/HEADER_SAMAYA.png` dkk (relatif) buat aset kop surat SPH, sekarang absolute `/assets/...`.
- **1 bug hash-stripping yang KETEMU dan DIPERBAIKI**: `restoreNavContext()` (dipanggil kalau ada `?resume=1`, alur balik dari edit produk di crud-produk.html) manggil `window.history.replaceState({}, '', window.location.pathname)` buat bersihin query string — di halaman standalone ini aman, tapi di SPA bakal ikut ngilangin `#konversian` dari address bar (reload berikutnya jatuh ke `DEFAULT_ROUTE` router.js, bukan balik ke konversian). Sekarang `window.location.hash` dipertahankan.
- **Tombol "Kembali ke Konversi" di `crud-produk.js` (baris ~178) DIUPDATE juga** (di luar rencana awal, ketemu pas testing manual) — sebelumnya redirect ke `konversian.html?resume=1&...` (halaman lama standalone), sekarang ke `/app/shell.html?resume=1&refreshed=...&sesi=...#konversian` (query string di LUAR hash — `restoreNavContext()` baca `window.location.search`, bukan query yang nempel di dalam hash). Ini gak nunggu crud-produk.html ikut dimigrasi ke SPA (urutan #4) — crud-produk.html TETAP standalone kayak sebelumnya, cuma tombol baliknya aja yang sekarang nunjuk ke rute SPA yang udah ada. Kalau nanti crud-produk.html ikut dimigrasi, baris ini kemungkinan gak perlu diubah lagi (udah nunjuk ke tujuan yang benar).
- **2 modal yang di-inject ke `document.body` langsung (bukan `container`)** ditemukan: `setupSphRiwayatModal()` dan `setupKonversiRiwayatModal()`, dua-duanya IIFE top-level yang jalan tiap kali `mount()` dipanggil. Tanpa guard, remount bakal numpuk elemen ber-id sama di body. Dikasih guard (`document.getElementById(id)?.remove()` sebelum bikin baru) DAN dibersihin lagi di `unmount()`.
- **Vendor scripts**: exceljs/pdfjs-dist/tesseract.js/jspdf/docx/`shared/toast.js` independen (Promise.all, pola sama kayak kompres-pdf); `@supabase/supabase-js` CDN → `shared/supabase-client.js` → `shared/auth-session.js` tetap sequential (pola sama kayak export-gambar, alasan sama: dependency lewat global).
- **CSS**: `pnm-universal.css` (shared antar halaman dashboard/stok/crud-produk) sekarang di-link dari `ensureStyle()` di `index.js` dengan id tetap (`shared-pnm-universal-css`) biar halaman lain yang migrasi belakangan bisa skip kalau udah ke-load — sama pola dengan Google Fonts + Phosphor + Tabler icon links (semua di-load sekali, id-checked). `pnm-konversian-rebase.css` (page-specific) tetap sendiri di `style.css` folder ini, gak berubah isinya.
- **BELUM dikerjakan** (baca bagian 2 buat batas section): konversian.js (6998 baris, sekarang di dalam `index.js`) MASIH SATU FILE — belum dipecah jadi `search.js`/`clipboard.js`/`sph.js`/`dictionary.js`/`set-mendekati.js`/`permintaan-rs.js`/`realtime.js` kayak target struktur bagian 3. Yang dikerjain sesi ini murni "masuk SPA jalan dulu, gak regresi (dan gak nambah bug path/lifecycle baru)" — pemecahan modul granular itu langkah refactor terpisah, resikonya beda (motong 22 section yang saling manggil fungsi, bukan soal auth/lifecycle lagi).
- **BELUM diverifikasi pakai Playwright** — beda dari 2 sesi sebelumnya. Sandbox investigasi sesi ini gak punya akses network ke domain CDN (`jsdelivr.net`, `unpkg.com`) ATAUPUN ke project Supabase (`ptkkbsemihcyndisjoor.supabase.co`), jadi gak ada cara jalanin browser asli terhadap kode ini dari sini. Yang SUDAH dicek: `node --check` (syntax valid) di `index.js`/`markup.js`/`router.js`, audit manual tiap `setInterval`/`addEventListener(window|document)`/`MutationObserver`/realtime-channel/modal-body-inject buat mastiin `unmount()` lengkap, dan grep menyeluruh buat path relatif yang bisa nyasar gara-gara pindah base URL dari `/konversian.html` ke `/app/shell.html`. **Sesi berikutnya atau kamu sendiri (yang udah `serve` lokal) WAJIB test manual/Playwright dulu sebelum ini dianggap selesai** — terutama: login gate, buka/lanjut sesi konversi + realtime kolaborasi (2 tab), Export Excel + Simpan ke Drive (modal conv-flow-ux), Generate SPH, dan mount→unmount→remount (pindah ke kompres-pdf/export-gambar lalu balik lagi ke `#konversian`) buat mastiin gak ada listener/timer/modal yang numpuk.

**Update 23 Agustus 2026 (post-testing, masih sesi keempat):** Ketemu pas user testing manual — `index.html` (dashboard/beranda, BELUM dimigrasi) punya link hardcoded ke halaman legacy buat **SEMUA TIGA halaman yang udah dimigrasi**, bukan cuma konversian: pill selector + `moduleFaces.*.url` (config buat cube 3D) di baris ~664-880-an. Ini kelewat di 2 sesi migrasi sebelumnya juga (kemungkinan karena diverifikasi langsung ke URL SPA-nya, bukan lewat klik dari dashboard). Semua 3 diganti ke rute SPA:
  - `#pill-konversian` + `moduleFaces.front.url`: `/konversian.html` → `/app/shell.html#konversian`
  - `#pill-kompres-pdf` + `moduleFaces.top.url`: `/kompres-pdf.html` → `/app/shell.html#kompres-pdf`
  - `#pill-export-gambar` + `moduleFaces.bottom.url`: `/export-gambar-gabungan.html` → `/app/shell.html#export-gambar`
  - `#pill-stok`/`#pill-crud` (`/stok.html`, `/crud-produk.html`) SENGAJA dibiarkan — dua itu memang belum dimigrasi.
**Checklist buat sesi migrasi berikutnya (crud-produk.html, urutan #4): jangan lupa update index.html juga**, bukan cuma bikin folder halaman barunya doang — bug ini gampang kelewat karena SPA-nya sendiri tetap "keliatan jalan" kalau dites langsung dari URL-nya, cuma jalur masuk dari dashboard yang diam-diam masih ke legacy.

**Update 23 Agustus 2026 (sesi kelima):** Eksekusi `visi-pionir-workspaces.md` bagian 5 langkah 1 — `index.html` (gerbang) di-port ke `app/pages/home/` (`index.js`/`markup.js`/`style.css`, pola sama seperti 3 tools lain), dan route `'home'` ditambahin ke `router.js` (`DEFAULT_ROUTE` BELUM diubah — masih `'kompres-pdf'`, sesuai urutan: `#home` harus kebukti jalan dulu sebelum root `index.html` ditimpa jadi shell di langkah 2). Link tiap modul dibiarkan APA ADANYA (masih `/app/shell.html#...` untuk yang migrated, masih `/nama.html` untuk yang legacy — belum hash-nav).

**DI LUAR rencana port verbatim di atas** — permintaan eksplisit user: kubus 3D (Rubik cube drag/rotate + `moduleFaces` + `requestAnimationFrame` loop), aurora background blobs, dan cursor-glow follower SEMUA DIBUANG, diganti grid kartu modul flat (`.module-card`, tanpa blur/glass/gradient). Konsekuensinya `app/pages/home/index.js` gak punya listener `window`/`document` sama sekali (gak ada lagi drag-pointer state buat di-`unmount()`) — `unmount()`-nya jadi sesederhana kompres-pdf punya. Root `index.html` (file terpisah, MASIH standalone, belum jadi shell) JUGA ditulis ulang dengan desain flat yang sama persis (isinya sengaja mirror `app/pages/home/`, dua-duanya masih hidup terpisah sampai langkah 2 visi tereksekusi) — supaya user yang buka `index.html` langsung juga langsung lihat hasilnya, gak nunggu 4 langkah sisanya kelar dulu.

Diverifikasi: `node --check` (syntax valid) di `markup.js`/`index.js`/`router.js`, dan `python -m http.server` lokal — semua file baru (`index.html`, `app/pages/home/*`, `app/shell.html`) ke-serve 200. **Belum diverifikasi pakai browser asli** (sandbox investigasi ini gak selalu punya akses ke `fonts.googleapis.com` — cuma dicek path/serve, bukan render visual). Sesi berikutnya/kamu sendiri yang `serve` lokal: cek `/#home` dan `/index.html` langsung di browser (toggle tema, hover/klik tiap kartu modul) sebelum lanjut ke langkah 2 (`index.html` root jadi shell + `router.js` `DEFAULT_ROUTE`).

**Update 23 Agustus 2026 (sesi keenam, bugfix hasil testing user):** User test manual di sandbox lokal (`#home` via Chrome) nemu 2 bug:
1. **Klik "Beranda" di `konversian` nyasar ke `index.html` lama** — `app/pages/konversian/markup.js` masih hardcode `href="/index.html"` (belum tau `#home` ada, karena ditulis sebelum sesi kelima). Diganti ke `href="/app/shell.html#home"`.
2. **"Balik pakai tombol Back di Chrome bikin tampilan `#home` jadi 'scale poorly'"** — root cause: `pnm-universal.css` (shared, dimuat sekali oleh konversian/lainnya dan TIDAK PERNAH di-unload — lihat bagian 1) berisi selector bentrok dengan classname yang dipakai `app/pages/home/style.css`: `.stat-val` (bentrok persis, spesifisitas sama → siapa yang paling akhir di-load ke `<head>` yang menang, dan `pnm-universal.css` selalu telat dimuat dibanding home) dan bare `header{background:...;gap:...;z-index:...;flex-shrink:...}` (elemen selector — kalah spesifisitas buat properti yang `.home-header` sudah override, tapi menang buat 4 properti yang tadinya TIDAK di-override). Balik dari tool lain (yang sempat mount pnm-universal.css) ke `#home` via Back = persis skenario ini. Fix: classname yang bentrok di-rename jadi prefixed (`stat-item`→`home-stat-item`, `stat-val`→`home-stat-val`, `stat-lbl`→`home-stat-lbl`, `header-right`→`home-header-right`) di `app/pages/home/markup.js`+`style.css` DAN di root `index.html` (biar konsisten, walau index.html standalone gak pernah load pnm-universal.css jadi gak collision beneran — cuma jaga-jaga kalau nanti disatuin), plus `.home-header` dikasih reset eksplisit (`background:transparent;gap:0;flex-shrink:initial;z-index:auto`) buat nutup celah 4 properti yang gak ke-cover classname manapun.
**Pelajaran buat halaman SPA baru ke depannya:** `pnm-universal.css` itu ~2231 baris dipakai lintas modul dan TIDAK PERNAH di-unload sepanjang sesi SPA — classname apapun yang dipakai halaman baru WAJIB di-grep dulu terhadap file itu sebelum dianggap aman, bukan cuma diasumsikan "gak bakal ketemu nama yang sama". Halaman yang sengaja gak mau ikutan tema `pnm-universal.css` (seperti `home`, karena desainnya flat/independen) risikonya lebih tinggi dari yang sengaja MEMANG pakai `pnm-universal.css` (seperti konversian) — karena yang terakhir emang didesain buat cocok sama stylesheet itu.

**Update 22 Agustus 2026 (sesi ketiga):** `export-gambar-gabungan.html` sudah dimigrasi. Catatan tambahan buat sesi berikutnya (lanjut ke `konversian.html`, urutan #3):
- Halaman ini TERNYATA butuh `unmount()` yang beneran bersih-bersih (beda dari kompres-pdf yang nyaris kosong) — ada 2 hal yang harus di-cleanup: (1) `IntersectionObserver` yang di-`disconnect()`, (2) unsubscribe function dari `PNMAuth.onAuthStateChange()` yang harus dipanggil. Keduanya disimpan di variabel module-scope (`activeObserver`, `authUnsubscribe`), bukan di dalam `mount()`, biar `unmount()` bisa akses.
- Markup lama pakai inline `onclick="..."`/`oninput="..."` yang manggil fungsi lewat global scope (`applyBulkInput`, `renderFileList`, `mergeAndPreview`, `exportCanvasAsPNG`, `toggleFile`). Karena modul sekarang `type="module"` (scope sendiri, gak otomatis nempel ke `window`), fungsi-fungsi itu harus di-expose manual ke `window.*` di akhir `mount()` DAN di-`delete`-in di `unmount()` — kalau lupa langkah kedua, mereka bakal nyangkut dan bisa nabrak halaman lain yang kebetulan pakai nama fungsi sama.
- Vendor script untuk halaman ini (`@supabase/supabase-js` CDN → `/shared/supabase-client.js` → `/shared/auth-session.js`) **harus dimuat berurutan**, gak bisa `Promise.all` kayak punya kompres-pdf — tiap file bergantung ke global yang dibikin file sebelumnya (`window.supabase` → `window.pnmSupabase` → `window.PNMAuth`).
- Ada temuan baru yang gak kesebut sebelumnya: halaman ini punya sistem toast KETIGA (bukan cuma 2 skema yang disebut di bagian 1) — `toast()` lokal + `#toastRoot`, gak pakai `shared/toast.js`/`PNMToast` sama sekali, dan CSS-nya nempel ke tema gelap "glass" khusus halaman ini. Dibiarkan apa adanya buat migrasi ini — nyatuin ke `PNMToast` itu keputusan terpisah (kemungkinan gak worth it kalau visualnya beda jauh), bukan bagian wajib checklist bagian 5.
- Diverifikasi end-to-end (bukan cuma smoke test kayak kompres-pdf): pakai `shared/supabase-client.js` dan `shared/auth-session.js` yang ASLI (file sungguhan, bukan stub) — cuma SDK Supabase-nya (CDN jsdelivr) yang di-mock via Playwright route interception, karena sandbox investigasi ini blokir domain itu. Alur login-salah → login-benar → lolos-whitelist → file list ke-load → toggle-file semuanya jalan lewat kode asli, bukan diasumsikan dari baca kode doang.
**Update 23 Agustus 2026 (sesi kesembilan):** Dua fix + satu cleanup atas laporan user:
1. **Bug "tema #home kacau + blink aneh" pas balik dari `stok.html`/`#export-gambar`, DIPERBAIKI** — root cause BUKAN di `app/pages/home/` (yang sudah difix sesi keenam), tapi di `konversian/index.js`: `pnm-universal.css` di-treat sebagai "SHARED, nempel selamanya" (di-load sekali via `ensureStyle()`, id `shared-pnm-universal-css`, TIDAK PERNAH dilepas walau `unmount()` dipanggil). Begitu user pernah mampir ke `#konversian` dalam satu sesi SPA, file itu nempel di `<head>` seterusnya dan bocor selector bare/unscoped-nya (`header{}`, `.stat-val`, dst — sama kelas bug dengan sesi keenam) ke halaman manapun yang di-mount setelahnya, termasuk `#home`. Fix: `pnm-universal.css` sekarang di-treat sama seperti stylesheet page-scoped lain — tetap di-load di `mount()` (lewat `ensureStyle()`, gak berubah), tapi sekarang di-`remove()` juga di `unmount()`. Browser HTTP cache bikin re-load berikutnya (kalau balik lagi ke `#konversian`) nyaris instant karena URL-nya persis sama (`?v=20260813b`), jadi gak ada biaya nyata. Font/icon links di `SHARED_LINKS` yang sama (Google Fonts, Phosphor, Tabler) SENGAJA TETAP nempel (gak dilepas) — cuma `pnm-universal.css` yang punya selector bare yang kebukti bocor.
   - **Belum diverifikasi pakai browser asli** (sandbox investigasi ini tetap gak punya akses ke domain CDN/font). Yang sudah dicek: `node --check` (syntax valid) di `konversian/index.js` (9021 baris). Sesi berikutnya/kamu sendiri: ulang skenario yang dilaporkan (buka `#konversian` → pindah ke `#home` atau `/stok.html` lalu balik) dan pastikan gak ada lagi tema kacau/blink.
   - **Catatan buat modul SPA baru ke depannya** (`crud-produk`/`dashboard`/`stok` kalau nanti dimigrasi dan juga butuh `pnm-universal.css`): ikuti pola yang sama — load di `mount()`, `remove()` di `unmount()` — jangan ulang pola "shared selamanya" yang baru saja dibongkar di sini.
2. **`kompres-pdf.html` dan `export-gambar-gabungan.html` (file legacy standalone) DIHAPUS** dari root, atas permintaan user setelah dikonfirmasi aman: di-grep menyeluruh dulu ke seluruh kodebase (`.js`/`.html`/`.md`), gak ada satupun referensi aktif ke dua file itu di luar komentar/dokumentasi (`app/pages/home/markup.js` udah pakai `#kompres-pdf`/`#export-gambar` hash-nav sejak sesi kedelapan, bukan lagi path `.html`-nya). `konversian.html`/`konversian.js` sendiri sudah lebih dulu dihapus user di sesi keempat (lihat catatan lama di `visi-pionir-workspaces.md` bagian 7). Tabel bagian 1 di atas diupdate reflect ini. Modul SPA-nya (`app/pages/kompres-pdf/`, `app/pages/export-gambar/`) TIDAK berubah sama sekali — cuma file legacy standalone-nya yang hilang.
   - Sisa file legacy standalone yang MASIH ada (sengaja, belum gilirannya): `stok.html`, `crud-produk.html`, `dashboard.html` — map.md bagian 4 urutan #4/#5 belum dikerjakan buat ketiganya.