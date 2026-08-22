# VISI-PIONIR-WORKSPACES.md

Dokumen ini beda dari `map.md`. `map.md` itu log kondisi-sekarang + progres migrasi
per halaman (siapa yang udah kelar, siapa yang belum, catatan teknis per sesi).
File ini isinya **keputusan arsitektur** yang disepakati user (23 Agustus 2026)
soal bentuk akhir aplikasinya, biar gak perlu didebat ulang tiap sesi baru mulai.

**Baca urutannya:** `map.md` dulu (paham kondisi sekarang + 3 halaman yang udah
pindah SPA), baru file ini (paham KE MANA arahnya).

---

## 1. Masalah yang mau diselesaikan

Sekarang (per 23 Agustus 2026) bentuknya "N aplikasi berdiri sendiri, salah satunya
kebetulan berupa kubus 3D navigasi": `index.html` (judul aslinya "Pionir Group —
Tools Manifest 3D") itu sendiri halaman terpisah, isinya kubus 3D + pill-selector
yang nge-link (full page reload) ke 6 tools lain: `konversian`, `kompres-pdf`,
`export-gambar-gabungan`, `stok`, `crud-produk`, `dashboard` (ini "Dashboard
Produk" — tools sendiri, BUKAN halaman gerbang, gampang ketuker sama kata
"dashboard" secara umum — makanya di dokumen ini gak dipakai istilah itu buat
halaman gerbang).

3 dari 6 tools itu udah dipindah ke SPA (`/app/shell.html#<route>` — lihat
`map.md`), tapi `index.html` sendiri MASIH halaman biasa yang ngelink pakai
`<a href>`/`window.location.href` biasa ke `/app/shell.html#...`. Akibatnya:
- Masuk dari gerbang ke tool = full page reload (matiin keuntungan SPA-nya).
- Ada 2 sumber kebenaran yang harus disinkronin manual: daftar route di
  `router.js` DAN daftar pill+cube-face di `index.html`. Bug yang baru aja
  ditemu+dibenerin (pill/cube-face masih ngelink ke halaman legacy walau
  tool-nya udah dimigrasi) itu gejala langsung dari desain 2-sumber ini.
- Gak ada tempat buat nav/chrome yang persist lintas tool (misal sidebar,
  breadcrumb, notifikasi global) — tiap "masuk tool" itu start dari nol.

**Keputusan user:** ini semua "harusnya" satu **workspace** tunggal, bukan
kumpulan aplikasi berdiri sendiri yang kebetulan punya gerbang bersama. Nama
produknya **Pionir Workspaces** (sudah kepakai di `<title>` `app/shell.html`
sekarang — jadi ini sebenernya nama yang udah "nemu tempatnya" tanpa sengaja).

---

## 2. Visi target

Satu SPA. Satu shell. Semua tools jadi **route setara** (peer), bukan halaman
terpisah yang ditautkan. Gerbang kubus 3D jadi **route `home`** di dalam SPA
yang sama, bukan halaman di luar SPA yang ngelink masuk.

```
SEKARANG:
  index.html (app terpisah, gerbang)
    --full reload--> /app/shell.html#konversian (SPA #1)
    --full reload--> /app/shell.html#kompres-pdf (SPA #1, route lain)
    --full reload--> /stok.html (app terpisah #2, belum dimigrasi)
    --full reload--> /crud-produk.html (app terpisah #3, belum dimigrasi)
    --full reload--> /dashboard.html (app terpisah #4, belum dimigrasi)

TARGET:
  / (shell, SATU-SATUNYA app)
    #home         <- kubus 3D + pill selector, isinya index.html sekarang
    #konversian   <- sudah ada
    #kompres-pdf  <- sudah ada
    #export-gambar <- sudah ada
    #stok         <- nanti, pas gilirannya (map.md bagian 4 urutan #5)
    #crud-produk  <- nanti (urutan #4)
    #dashboard    <- nanti (urutan #5, ini "Dashboard Produk")
```

Pindah dari `#home` ke `#konversian` (atau antar tool mana pun) jadi hash
change biasa di dalam SATU halaman yang sama — bukan navigasi ke file `.html`
lain. `router.js` yang sudah ada sekarang (dari migrasi kompres-pdf) sudah
PAS buat ini — gak perlu router baru, tinggal ditambahin 1 route (`home`) dan
dijadiin `DEFAULT_ROUTE`.

---

## 3. Perubahan konkret yang perlu dieksekusi

### 3.1 `index.html` (gerbang) jadi route `home`

- Port isi `index.html` sekarang (kubus 3D + interaksi drag/rotate + pill
  selector) jadi `app/pages/home/` (`index.js` mount/unmount + `markup.js`
  atau `markup.html` + `style.css`), pola sama persis kayak 3 tools yang
  udah dimigrasi — lihat `map.md` bagian 3 & catatan sesi per halaman.
- Pill link (`<a href="/app/shell.html#konversian">`) dan `moduleFaces.*.url`
  (config buat klik kubus) diganti dari full-page navigation
  (`window.location.href = ...`) jadi hash-navigation di dalam app yang sama
  (`location.hash = 'konversian'`) — biar beneran gak reload.
- Animasi kubus (drag pointer, `requestAnimationFrame`, dst) kemungkinan
  butuh di-`unmount()` dengan bener (`cancelAnimationFrame`, lepas pointer
  listener) kalau user pindah dari `#home` ke tool lain terus balik lagi —
  sama kelas masalah kayak `unmount()` di 3 tools sebelumnya, cuma objeknya
  animasi bukan Supabase/interval.

### 3.2 File root `index.html` DIGANTI ISINYA jadi shell

Ini bagian yang paling gampang disalahpahami, jadi ditulis eksplisit:

- **Bukan** bikin file baru. **Isi** `index.html` yang SEKARANG (kubus 3D)
  dipindah jadi `app/pages/home/` (lihat 3.1) DULU.
- **Baru setelah itu**, isi file `index.html` di root DITIMPA jadi isinya
  `app/shell.html` sekarang (`<div id="app"></div>` + `<script type="module"
  src="/app/router.js">` + `<head>` boilerplate/favicon).
- `app/shell.html` sendiri jadi redundan setelah ini → boleh dihapus, ATAU
  dibiarin sebagai alias/symlink-nya-manual (isi sama persis) buat jaga-jaga
  ada yang masih nge-bookmark `/app/shell.html#...` secara langsung. Bebas,
  gak kritis — putuskan pas eksekusi, bukan sekarang.
- `router.js`: tambah `'home': () => import('./pages/home/index.js')`,
  ganti `const DEFAULT_ROUTE = 'kompres-pdf'` jadi `'home'`.
- Efek sampingnya bagus: URL jadi `/#konversian` (bukan
  `/app/shell.html#konversian`) — lebih pendek, dan gak ada lagi 2 file HTML
  (`index.html` + `app/shell.html`) yang isinya mirip-mirip beda peran.

### 3.3 Registry manifest — satu sumber kebenaran

Bikin `app/pages.js`, isinya array/object per tool:

```js
export const PAGES = [
  { id: 'konversian',    title: 'Conversion Workspace', color: '#2563EB',
    status: 'migrated',   icon: '<svg ...>', cubeFace: 'front' },
  { id: 'kompres-pdf',   title: 'Kompres PDF',          color: '#EF4444',
    status: 'migrated',   icon: '<svg ...>', cubeFace: 'top' },
  { id: 'export-gambar', title: 'Export Gambar Gabungan', color: '#10B981',
    status: 'migrated',   icon: '<svg ...>', cubeFace: 'bottom' },
  { id: 'stok',          title: 'Stock',                 color: '#10B981',
    status: 'legacy', legacyHref: '/stok.html', icon: '<svg ...>', cubeFace: 'right' },
  { id: 'crud-produk',   title: 'CRUD Produk',           color: '#8B5CF6',
    status: 'legacy', legacyHref: '/crud-produk.html', icon: '<svg ...>', cubeFace: 'back' },
  { id: 'dashboard',     title: 'Dashboard Produk',      color: '#06B6D4',
    status: 'legacy', legacyHref: '/dashboard.html', icon: '<svg ...>', cubeFace: 'left' },
];
```

- `router.js` konsumsi ini buat tau route mana yang `status: 'migrated'`
  (baru boleh masuk `ROUTES`, sisanya tetap tampilin pesan "belum dipindah,
  buka versi lama" kayak sekarang — itu logic yang UDAH ADA di `render()`,
  tinggal sumber datanya diganti dari hardcode ke baca `PAGES`).
- `app/pages/home/index.js` konsumsi `PAGES` yang SAMA buat render pill +
  cube face — bukan hardcode ulang.
- **Ini yang nutup celah bug kemarin secara struktural**: gak mungkin lagi
  ada "route udah dimigrasi tapi pill masih ngelink ke legacy", karena cuma
  ada SATU tempat nulis status migrasi per halaman, dibaca 2 tempat.
- Field `cubeFace`/`icon`/`color` boleh disesuaikan sama kebutuhan real
  `moduleFaces` yang sekarang — di atas cuma contoh bentuk, bukan final.

### 3.4 Yang TIDAK berubah

- Tetap zero-build. Semua ini masih `<script type="module">` + `import()`
  native, masih `python -m http.server`, gak ada npm/bundler yang masuk.
- Tools yang masih `status: 'legacy'` (stok, crud-produk, dashboard) TETAP
  file `.html` berdiri sendiri persis kayak sekarang, dibuka via
  `legacyHref` — gak wajib ikut restrukturisasi ini buat bisa jalan. App
  gak pernah dalam kondisi setengah-rusak, sama prinsipnya kayak migrasi
  per-halaman di `map.md`.
- 3 tools yang udah `status: 'migrated'` (`konversian`, `kompres-pdf`,
  `export-gambar`) **isinya gak perlu diapa-apain** — restrukturisasi ini
  cuma soal file di LUAR `app/pages/<tool>/` (yaitu `index.html` lama →
  `app/pages/home/`, dan root `index.html` → jadi shell). `mount()`/
  `unmount()` mereka tetap sama.

---

## 4. Follow-up WAJIB setelah restrukturisasi ini jalan

Begitu 3.2 selesai (`/app/shell.html#...` gak dipakai lagi, diganti `/#...`),
ada 2 tempat yang perlu diikutin, JANGAN LUPA (gampang kelewat, sama kelas
masalah kayak bug pill/cube-face kemarin):

1. **`crud-produk.js`** (baris ~178-190, tombol "Kembali ke Konversi") —
   sekarang redirect ke `/app/shell.html?resume=1&...#konversian`. Ganti ke
   `/?resume=1&...#konversian`.
2. **`konversian` punya sendiri** — cek ulang `app/pages/konversian/index.js`
   siapa tau ada string literal `/app/shell.html` lain yang kelewat pas
   audit kemarin (waktu itu cuma ketemu 1 titik di `crud-produk.js`, tapi
   belum tentu itu satu-satunya di seluruh kodebase — grep ulang
   `"app/shell.html"` di semua file pas eksekusi ini).

---

## 5. Urutan eksekusi yang disaranin

Ini best-effort urutan, bukan harga mati — sesuaikan kalau ada pertimbangan
lain pas eksekusi:

1. Port `index.html` (kubus+pill) → `app/pages/home/` dulu, **sambil masih
   nge-link ke `/app/shell.html#...` seperti sekarang** (belum diubah ke
   hash-nav) — biar bisa dites `home` route-nya doang jalan bener dulu,
   sebelum nyampur sama perubahan routing.
2. Baru setelah `#home` kebukti jalan (kubus render, animasi jalan, klik
   pill/face beneran mindahin halaman): ganti isi root `index.html` jadi
   shell, update `router.js` (tambah route `home` + `DEFAULT_ROUTE`).
3. Baru setelah itu: ganti pill/cube-face dari `window.location.href = ...`
   jadi `location.hash = ...` (hash-nav asli, gak reload lagi).
4. Baru setelah itu: bikin `app/pages.js`, refactor `router.js` +
   `app/pages/home/index.js` buat baca dari situ (bagian 3.3).
5. Terakhir: bagian 4 di atas (follow-up link `/app/shell.html` yang nyisa).

Alasan urutannya begini: tiap langkah bisa dites SENDIRI-SENDIRI (gak numpuk
banyak perubahan sekaligus sebelum ketauan jalan apa nggak) — pola yang sama
kayak kenapa 3 migrasi tool sebelumnya juga dipisah per-sesi, bukan
sekaligus.

**Status — 23 Agustus 2026 (sesi kelima):** Langkah 1 SELESAI —
`app/pages/home/` udah ada, route `'home'` udah masuk `router.js`
(`DEFAULT_ROUTE` masih `'kompres-pdf'`, sengaja belum diubah). Detail teknis
+ penyimpangan desain (kubus 3D/aurora/cursor-glow dibuang, diganti flat
module-card grid — permintaan user, bukan bagian rencana port verbatim) ada
di `map.md` (update sesi kelima). Langkah 2–5 di atas BELUM dikerjakan — root
`index.html` masih file standalone terpisah (isinya udah ikut didesain ulang
flat juga, tapi strukturnya belum jadi shell), `router.js` `DEFAULT_ROUTE`
belum diganti, pill/cube-face belum hash-nav, `app/pages.js` registry belum
dibikin.

**Status — 23 Agustus 2026 (sesi ketujuh):** Langkah 2 SELESAI. Root
`index.html` ditimpa jadi isi `app/shell.html` persis (diff-checked identik —
`<div id="app"></div>` + `<script type="module" src="/app/router.js">` +
head boilerplate/favicon, gak ada perubahan lain). Isi lama (flat module-card
grid hasil sesi kelima) HILANG dari root `index.html` sebagai standalone
file — tapi gak hilang dari aplikasi, karena isinya sudah dipindah ke
`app/pages/home/` dari sesi kelima, dan sekarang itulah yang dirender lewat
router pas route `home` aktif. `router.js`: `DEFAULT_ROUTE` diganti dari
`'kompres-pdf'` ke `'home'`. `app/shell.html` SENGAJA DIBIARKAN ADA (opsi
"alias" dari bagian 3.2 di atas, bukan dihapus) — sekarang isinya
duplikat 100% sama kayak root `index.html`, jadi bookmark lama ke
`/app/shell.html#...` tetap jalan tanpa perubahan apapun.
Diverifikasi: `node --check app/router.js` (syntax valid), dan
`python -m http.server` lokal + `curl` — `/`, `/app/router.js`,
`/app/pages/home/index.js`, `/app/shell.html` semua balas 200, dan body
`/` dicek mengandung `<div id="app"></div>` (bukan markup lama). **Belum
diverifikasi pakai browser asli** (sandbox investigasi ini gak punya akses
network ke `fonts.googleapis.com` atau CDN lain — sama keterbatasan yang
disebut di update sesi keempat/kelima `map.md`). Sesi berikutnya/kamu sendiri
yang `serve` lokal: WAJIB buka `/` di browser dan pastikan route `#home`
langsung ke-render pas pertama kali landing (bukan cuma lewat `/#home`
eksplisit), sebelum lanjut ke langkah 3 (pill/cube-face jadi hash-nav).

Langkah 3–5 MASIH BELUM dikerjakan sesi ini (sengaja, ngikutin urutan
per-langkah di bagian 5 — tiap langkah dites sendiri dulu sebelum lanjut):
pill link di `app/pages/home/markup.js` dan cube-face url-nya masih
`window.location.href`-style ke `/app/shell.html#...`/`.html` legacy (bukan
`location.hash = ...`), `app/pages.js` registry belum dibikin, dan follow-up
di bagian 4 (`crud-produk.js` baris ~187, audit string literal
`"app/shell.html"` di `konversian/index.js`) belum disentuh — semua masih
jalan seperti sebelumnya karena `app/shell.html` sengaja dipertahankan
sebagai alias di atas, jadi gak ada yang patah, cuma belum "bersih".

**Status — 23 Agustus 2026 (sesi kedelapan):** Bugfix + langkah 3 SELESAI.
- **Bugfix duluan**: user testing manual (push ke Vercel, PowerShell) nemu
  `Uncaught SyntaxError: Unexpected token '<'` di `router.js:1`. Root cause:
  isi `app\router.js` (624 bytes) ketimpa konten `index.html`/`shell.html`
  (juga 624 bytes) pas copy-paste manual — jadi browser coba parse HTML
  sebagai JS. User benerin sendiri di sisi dia dan push ulang (commit "router
  salah copas anjing wkwkwk") — dikonfirmasi lewat `git pull` fresh:
  `app/router.js` sekarang 1537 bytes, isinya JS asli lagi.
- **Langkah 3**: pill link di `app/pages/home/markup.js` (`MODULES` array)
  buat 3 modul yang sudah `status: migrated` (`konversian`, `kompres-pdf`,
  `export-gambar`) diganti dari `/app/shell.html#<id>` jadi fragment-only
  `#<id>` — ini otomatis jadi hash-nav asli TANPA butuh JS/click-handler
  tambahan sama sekali, karena `<a href="#id">` native men-trigger
  `hashchange` di window, dan `router.js` udah dengar event itu dari awal
  (lihat `router.js` baris 45). 3 modul yang masih `status: legacy` (`stok`,
  `crud-produk`, `dashboard`) SENGAJA DIBIARKAN full-page `.html` link,
  belum jadi route SPA. Field `migrated: true/false` ditambahin ke tiap
  entri `MODULES` (dipakai buat komentar/dokumentasi array ini sekarang,
  belum dikonsumsi `router.js`/logic apapun — itu baru relevan pas
  `app/pages.js` registry dibikin di langkah 4).
- Diverifikasi: `node --check` (syntax valid) di `markup.js`/`index.js`, dan
  `python -m http.server` lokal + `curl` — konten `MODULES` array kekonfirmasi
  isinya `#konversian`/`#kompres-pdf`/`#export-gambar` (bukan lagi
  `/app/shell.html#...`) buat yang migrated, `/stok.html` dkk tetap apa
  adanya buat yang legacy. **Belum diverifikasi klik asli di browser** —
  sandbox ini tetap gak punya akses ke `fonts.googleapis.com`. Sesi
  berikutnya/kamu sendiri: klik tiap kartu modul yang migrated dari `#home`,
  pastikan URL address bar berubah jadi `/#konversian` dkk TANPA reload
  (cek Network tab — harusnya nol request dokumen baru), baru lanjut ke
  langkah 4 (`app/pages.js` registry).

Langkah 4–5 masih belum dikerjakan: `app/pages.js` registry belum dibikin,
follow-up bagian 4 (`crud-produk.js` baris ~187, audit
`konversian/markup.js` baris 58 yang masih `/app/shell.html#home` buat
tombol "Beranda") belum disentuh — sengaja, ngikutin urutan, dan gak ada
yang patah karena `app/shell.html` masih alias yang hidup.

---

## 6. Konteks deployment (Vercel, `cleanUrls: true`)

`vercel.json` di root isinya `{ "cleanUrls": true }` — Vercel otomatis strip
`.html` dari URL (`/konversian.html` di-301-redirect ke `/konversian`, file
yang sama tetap ke-serve). Ini CUMA berlaku buat `.html`, gak nyentuh
`.js`/`.css` (jadi `import()` dinamis di `router.js`, `<script src>`,
`<link href>` semua gak kepengaruh).

Efeknya ke arsitektur target di dokumen ini: **selaras, gak perlu config
tambahan.** Setelah bagian 3 (`index.html` jadi shell, link jadi
`/#konversian` tanpa `.html`), gak ada lagi redirect `.html`-stripping yang
kejadian buat navigasi di dalam app — karena emang gak ada lagi `.html` yang
direferensikan buat SPA routes. Link ke halaman legacy yang masih
`status: 'legacy'` (`/stok.html`, dst) tetap kena 1 kali redirect kayak
sekarang — gak masalah, cuma sedikit boros, bukan bug.

**Catatan buat testing:** `python -m http.server` (dipakai buat test lokal)
**TIDAK** replikasi behavior `cleanUrls` — dia serve path apa adanya, gak ada
redirect logic sama sekali. Gak ada bagian dari rencana ini yang bergantung
ke behavior itu (hash routing gak pernah dikirim ke server), tapi ini beda
nyata antara "jalan pas dites lokal" vs "jalan di Vercel" buat hal-hal lain
di luar rencana ini juga — jangan diasumsikan dua-duanya identik.

---

## 7. Yang SENGAJA belum diputusin (bukan lupa)

- Nav chrome persisten (sidebar/topbar yang keliatan terus lintas semua
  route, bukan cuma di `#home`) — ide bagus buat kedepannya, TAPI itu
  keputusan desain terpisah (butuh mikirin layout ulang tiap halaman), gak
  otomatis ikut kepake cuma karena restrukturisasi ini. Jangan diasumsikan
  termasuk kalau eksekusi bagian 3 di atas.
- Kapan file `.html` legacy (`stok.html`, `crud-produk.html`,
  `dashboard.html`, dan yang udah "mati" kayak `konversian.html` yang sudah
  dihapus di sandbox testing user) beneran dihapus dari repo utama —
  `map.md` udah punya prinsip "jangan dihapus sampai gilirannya dimigrasi",
  dokumen ini gak mengubah itu.
- Nama file `app/pages.js` vs `app/pages.json` vs taruh di `state/store.js`
  yang udah disebut di `map.md` bagian 3 — putuskan pas eksekusi liat mana
  yang paling pas sama kode router.js real waktu itu.