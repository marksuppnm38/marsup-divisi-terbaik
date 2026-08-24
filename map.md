# MAP.md

Peta singkat repo ini, plus rencana pindah ke vanilla SPA. Tujuan file ini: siapapun (termasuk Claude sesi baru) bisa ngerti struktur app dalam beberapa menit, tanpa harus baca ribuan baris kode dulu.

Cara baca: bagian 1–2 itu potret KONDISI SEKARANG (apa adanya, termasuk bagian yang berantakan). Bagian 3–5 itu RENCANA. File ini SENGAJA dijaga tetap pendek — riwayat lengkap tiap sesi (apa yang dikerjain, bug apa yang ketemu, kenapa suatu keputusan diambil) dipindah ke `map-history.md` (24 Agustus 2026, biar file ini murah dibaca ulang tiap sesi baru — gak perlu re-paste ratusan baris changelog cuma buat orientasi).

**Baca juga:**
- `visi-pionir-workspaces.md` — keputusan arsitektur level lebih tinggi soal `index.html`/shell SPA.
- `design.md` — spec desain (warna, spacing, komponen shared nav) buat nyeragamin visual semua halaman. Belum di-wire ke halaman manapun kecuali `app/pages/_nav/` (dibangun 24 Agustus, siap pakai tapi SENGAJA belum diaktifkan — lihat komentar header `nav.js` buat urutan wiring-nya).
- `map-history.md` — riwayat lengkap tiap sesi migrasi, urut tanggal. Baca ini kalau butuh tau KENAPA sesuatu dikerjain kayak sekarang, atau detail bug/fix spesifik. Bagian di bawah ini cuma nyimpen HASIL AKHIRNYA, bukan prosesnya.

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

**Duplikasi yang masih tersisa** (`stok.html`/`dashboard.html`, belum migrasi): `const SUPABASE_URL = '...'` di-declare ulang di file-file itu (masing-masing juga punya fungsi refresh-token sendiri-sendiri, mirip tapi gak identik), dan `shared/toast.js` nampung 2 skema class CSS beda (`.toast-success` vs `.toast.success`) dari 2 sistem lama yang disatuin belakangan tanpa diseragamin. Konteks/alasan lengkap kenapa ini kejadian ada di `map-history.md` (bagian awal).

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
5. **`stok.html`** dan **`dashboard.html`** — belum digarap. Sama kayak crud-produk, tapi sekalian dipisah dari inline `<script>` jadi file `.js` sendiri dulu (dashboard.js udah terpisah, stok.html belum).

Setiap halaman yang belum dimigrasi tetap boleh jalan sebagai link biasa (`<a href="/stok.html">`) sampai gilirannya — app gak pernah dalam kondisi setengah-rusak selama proses ini.

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