# MAP.md

Peta singkat repo ini, plus rencana pindah ke vanilla SPA. Tujuan file ini: siapapun (termasuk Claude sesi baru) bisa ngerti struktur app dalam beberapa menit, tanpa harus baca 22 ribu baris dulu.

Cara baca: bagian 1–2 itu potret KONDISI SEKARANG (apa adanya, termasuk bagian yang berantakan). Bagian 3–5 itu RENCANA.

---

## 1. Kondisi sekarang: 6 halaman, 6 cara load yang beda-beda

Setiap `.html` di root itu halaman terpisah, full page reload kalau pindah. Bukan SPA sama sekali sekarang.

| Halaman | JS-nya | Pakai shared/auth-session.js? | Auth-nya gimana |
|---|---|---|---|
| `konversian.html` | `konversian.js` (6998 baris) + `sph-module.js` (1351 baris) | **Ya, penuh** — semua panggil `PNMAuth.*` | Satu-satunya yang udah bener |
| `crud-produk.html` | `crud-produk.js` (2920 baris) | Script-nya di-load, tapi **gak pernah dipanggil** | Auth manual sendiri (`checkWhitelistAndShowApp`, fetch langsung ke `/auth/v1/token`) |
| `stok.html` | inline `<script>` di dalam file itu sendiri | **Gak di-load sama sekali** | Auth manual sendiri, refresh token manual lewat `fetch()` |
| `dashboard.html` | `dashboard.js` (1295 baris) | **Gak di-load sama sekali** | Auth manual sendiri, sama polanya kayak stok.html |
| `export-gambar-gabungan.html` | inline `<script>` | Di-load, tapi cuma dipakai buat baca `window.PNM_SUPABASE_URL`, gak pakai `PNMAuth.*` | Setengah-setengah |
| `kompres-pdf.html` | inline, murni client-side | Gak butuh (gak ada data yang perlu login) | — |

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

1. **`kompres-pdf.html`** — paling gampang duluan. Gak ada Supabase, gak ada auth, murni fungsi. Cocok buat nyoba pola shell+router+mount tanpa resiko ngerusak data.
2. **`export-gambar-gabungan.html`** — udah setengah jalan ke shared client, tinggal diselesaikan ke `PNMAuth.*` penuh.
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