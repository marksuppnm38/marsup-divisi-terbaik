# Progress: Tampermonkey Script - Upload Produk INAPROC EKAT v6

> Living doc. Update tiap task selesai. Lihat `BRAINSTORM_INAPROC_EKAT_V6_v2.md` buat konteks arsitektur lengkap.

## Status ringkas

| Task | Scope | Status |
|---|---|---|
| 1 | Framework/pondasi (CONFIG, Storage, State, Logger, QueueManager, StageManager, DomHelper, UIPanel, Main) | ✅ Selesai |
| 2 | Navigation module (masuk ke form Tambah Produk) | ✅ Selesai |
| 3 | FormFiller — Section 1 (Isi Dasar) + Section 5 (Bisnis), field yang selector-nya sudah pasti | ✅ Selesai (parsial — 3 sub-field di-stub, lihat catatan) |
| 3.2 | Reorder strategi: Kategori (pre-TKDN) → checkpoint stage `tkdn` → sisa Isi Dasar (post-TKDN) → Bisnis | ✅ Selesai (lihat catatan "Perubahan Strategi" di atas) |
| 3.1 | UI Panel — textarea "Load Queue" (gak perlu lagi isi queue lewat console) | ✅ Selesai |
| 4a | Merek — isi nomor konstan + klik "Periksa" | ✅ Selesai (lihat catatan verifikasi) |
| 4b | Kode KBKI (react-select search) + Daftar Produk Sektoral (react-select search-by-kode) | ✅ Selesai |
| 5 | Upload Foto Produk (wiring ke File object asli, sekarang cuma helper generik) | ⬜ Belum — butuh sumber file (Task 8 Supabase) |
| 6 | Section 2 — TKDN (nomor sertifikat konstan, "Cari TKDN" → halaman hasil terpisah → pilih radio → Simpan) | ✅ Selesai |
| 7 | Section 3 — SNI (switch/dropdown, kemungkinan simpel) | ⬜ Belum |
| 8 | Stage `fetch_data` — integrasi Supabase (produk_harga kolom "harga upload", master_produk, storage buckets) | ⬜ Belum — butuh Supabase URL + anon key + nama kolom persis dari Jamal |
| 9 | Section 4 — Spesifikasi Produk (16 field, anchor-by-teks ke index `productInformations.mainInformations.N`) | ⬜ Belum |
| 10 | Section 6 — Upload Lampiran (13 dokumen, anchor-by-teks ke `document-field-N`) | ⬜ Belum |
| 11 | Section 7 — Simpan & Loop ke SKU berikutnya | ⬜ Belum |
| 12 | Full-auto chain semua stage + testing end-to-end | ⬜ Belum |

## ⚠️ Perubahan Strategi (v0.5.0) — Kategori sebelum TKDN

**Alasan:** Section 2 (TKDN) memunculkan modal wizard, dan begitu modal itu disimpan, halaman scroll balik ke atas. Kalau field-field lain di Section 1 (Merek, KBKI, Sektoral, Nama, Foto, Deskripsi) sudah diisi lebih dulu sebelum TKDN dijalankan, ada risiko field itu "terganggu" render ulang pas modal TKDN close. Kategori dikecualikan dari penundaan ini karena kemungkinan besar ikut menentukan opsi/behaviour TKDN itu sendiri (mis. status lokal/impor).

**Urutan baru di dalam `isi_dasar`:**
1. **Fase pre-TKDN** — HANYA Kategori (`FormFiller.isiDasarPreTkdn()`)
2. **Checkpoint stage `tkdn`** — `FormFiller.fillTkdn()` (masih stub, Task 6)
3. **Fase post-TKDN** — Merek, KBKI, Sektoral, Nama Produk, Foto, Deskripsi, verifikasi default (`FormFiller.isiDasarPostTkdn()`)
4. Lanjut `bisnis` seperti biasa

`CONFIG.stopAfterStage` default diganti dari `'bisnis'` jadi `'tkdn'` — jadi sekarang proses otomatis berhenti tepat sesudah Kategori terisi, menunggu TKDN diisi manual (atau Task 6 selesai). Begitu Task 6 kelar, `stopAfterStage` tinggal digeser lagi ke `'bisnis'` (atau stage sesudahnya).

Ini murni perubahan urutan eksekusi, bukan perubahan selector — semua selector Task 3/4a yang sudah diverifikasi tetap sama, cuma dipanggil di titik yang berbeda.

## Fix v0.7.1 — race condition di fillTkdn()

Dari dry-run pertama: halaman TKDN kebuka, tapi `fillTkdn()` gagal dengan "tidak ada baris hasil TKDN ditemukan" padahal tombol "Simpan" sudah ketemu. Penyebabnya: tombol "Simpan" itu bagian dari SHELL halaman (muncul duluan), sedangkan baris hasil pencarian di-render belakangan lewat fetch async ke API TKDN. Kode lama langsung `querySelectorAll` sekali begitu tombol Simpan ketemu — race condition.

**Fix:** baris hasil sekarang di-`pollUntil()` terpisah (nunggu sampai row-nya beneran muncul, bukan diasumsikan udah ada). Tombol "Simpan" juga di-re-query pas mau diklik (bukan pakai referensi lama), buat jaga-jaga kalau React re-render subtree itu begitu hasil pencarian masuk dan bikin node lama jadi detached.

Catatan tambahan dari testing: switch TKDN ternyata **TIDAK** default checked di kondisi nyata (beda dari yang kelihatan di snapshot `sebelumtmodultkdn.htm`) — tapi kode udah handle ini dengan baik (`if (!sw.checked) { ...aktifkan... }`), jadi gak masalah.

## Detail Task 6 (baru selesai) — TKDN

Dari `sebelumtmodultkdn.htm` + `tkdn.htm` (dua snapshot: sebelum & sesudah klik "Cari TKDN"), ternyata **koreksi asumsi sebelumnya**: TKDN bukan modal wizard overlay, tapi navigasi ke **halaman/route TERPISAH** (header-navigation & layout beda total dari form Tambah Produk). Ini justru konfirmasi kenapa halaman "scroll balik ke atas" pas Simpan — itu memang balik ke halaman lain, bukan modal ditutup. Strategi reorder v0.5.0 (Kategori dulu, baru TKDN) tetap relevan/valid dengan temuan ini.

**Selector terkonfirmasi:**
- Switch: `#form-product-tkdn-switch` (default sudah **checked** begitu form dibuka)
- Input nomor sertifikat: `#form-product-tkdn-keyword-input`
- Tombol "Cari TKDN": `#form-product-tkdn-search-btn-new`
- Halaman hasil: baris `tr[data-test="table-row-data"]`, tiap baris ada `input[type="radio"]` di kolom pertama
- Tombol "Simpan": `#tkdn-submit-btn` (ada juga `#tkdn-cancel-btn` "Kembali", belum dipakai)

**Nomor sertifikat KONSTAN** (bukan per-SKU, sama pola kayak Merek): `6722/TKDN/IK/VII/2024` → masuk `CONFIG.constants.tkdnNomor`.

`FormFiller.fillTkdn()`: pastikan switch ON → isi nomor → klik "Cari TKDN" → tunggu tombol Simpan di halaman hasil muncul (bukan timeout tetap) → kalau hasil >1 baris, log WARNING dan otomatis pilih baris pertama → klik radio → klik Simpan → tunggu sampai balik ke form Tambah Produk (`Navigation.isProductForm()`).

**Risiko yang belum bisa dipastikan dari HTML statis saja:** apakah navigasi ke halaman TKDN itu client-side routing (SPA, script tetap jalan) atau hard reload (script mati di tengah proses). Kalau Next.js-nya pakai client routing (kemungkinan besar), gak masalah. Untuk jaga-jaga, `@match` diperluas ke `https://penyedia.inaproc.id/products/*` supaya kalau ternyata hard reload dan URL-nya masih di bawah `/products/...`, script tetap re-init. **Perlu diverifikasi pas dry-run pertama**: kalau proses "macet"/gak lanjut-lanjut persis sesudah klik "Cari TKDN", kemungkinan besar itu penyebabnya — kabari aja biar didesain ulang (mis. jadi 2 stage terpisah dengan localStorage handoff).

`CONFIG.stopAfterStage` default balik ke `'bisnis'` — sekarang proses jalan otomatis penuh: Navigation → Kategori → TKDN → sisa Isi Dasar (Merek/KBKI/Sektoral/Nama/Foto/Deskripsi) → Bisnis → stop.

## Detail Task 4b (baru selesai) — KBKI + Daftar Produk Sektoral

**Kode KBKI:** klik `#form-product-kbki-select` membuka menu react-select (classNamePrefix `select__`, sama seperti Satuan Produk/Jenis Pajak). Opsinya `<span class="select__option-label">{kode} - {deskripsi}</span>`. `FormFiller.fillKbki()` sekarang: klik tombol → isi `.select__input` dengan `item.kbki` → tunggu opsi yang teksnya diawali/mengandung kode itu → klik. Kalau `item.kbki` kosong di queue, di-skip dengan warning (field ini Wajib, jadi tetap harus diisi manual kalau kosong).

**Daftar Produk Sektoral:** dari screenshot, field "Pilih Produk" ini react-select biasa yang searchable pakai Kode Produk, opsinya format `Nama Produk (Kode1, Kode2, Brand)`. `FormFiller.fillDaftarProdukSektoral()` sekarang pakai `ReactSelectHelper.select(container, item.kodeProduk)` — container dicari via `findRowByHeading('Daftar Produk Sektoral')` lalu `.css-b62m3t-container` di dalamnya (pola sama seperti Satuan Produk). Match "includes" di `ReactSelectHelper.select()` otomatis menangkap karena kode produk muncul sebagai substring di textContent opsi.

**Merek:** dikonfirmasi TIDAK ada langkah lanjutan sesudah klik "Periksa" berhasil (bukan modal konfirmasi seperti TKDN). Warning yang sebelumnya nempel di `fillMerek()` sudah dihapus.

Dengan ini, `FormFiller.isiDasarPostTkdn()` sudah full-implemented, tidak ada lagi field stub di Section 1 selain yang memang menunggu Task 6 (TKDN, sengaja di-checkpoint sebelum section ini per strategi v0.5.0).

## Detail Task 3 (baru selesai)

**File:** `inaproc-v6-upload-produk.user.js` (lanjutan dari script Task 1-2 yang user tempel di chat)

**Ditambahkan:**
- `DomHelper.injectFileToInput()` — helper generik inject File ke `<input type=file>` pakai `DataTransfer` (dipakai lagi nanti buat Foto Produk & Lampiran)
- `DomHelper.findRowByHeading(text)` — anchor-by-teks ke `<h3>` label section, buat field yang id-nya gak stabil/gak ada (Satuan Produk, Daftar Produk Sektoral)
- `ReactSelectHelper.select(container, optionText)` — buka react-select, ketik cari, klik opsi yang cocok
- `ReactSelectHelper.readValue(container)` — baca text `select__single-value` tanpa mengubah apa pun (dipakai buat verifikasi field yang defaultnya sudah benar)
- `FormFiller.isiDasar(item)` — isi Nama Produk, Deskripsi, Kategori (kaskade 3 kolom), verifikasi Klasifikasi/Lokasi Produksi/Tenaga Kerja/Bahan Baku (skip touch kalau default sudah cocok)
- `FormFiller.isiBisnis(item)` — isi Harga, Stok, Satuan, Berat, Minimum Pembelian, Jenis Pajak (PPN)
- Stage flow di `Main.start()`: Navigation → `isi_dasar` → `bisnis` → stop (sesuai `CONFIG.stopAfterStage`, default `'bisnis'` karena stage sesudahnya belum diimplementasi)
- Queue item Task 3 pakai bentuk **manual sementara** (bukan hasil fetch Supabase — itu Task 8), lihat comment `// TODO Task 8` di CONFIG

**Sengaja di-stub (TIDAK ditebak/dipaksa), logged sebagai WARNING, proses berhenti di situ menunggu observasi live:**
1. **Merek** — switch `#form-product-brand-isActive-switch` di-on, tapi UI search sesudahnya (kayak TKDN) belum ke-capture di HTML manapun yang di-upload. `FormFiller.fillMerek()` cuma toggle switch lalu `Logger.warning` + berhenti.
2. **Kode KBKI** — tombol `#form-product-kbki-select` diklik untuk buka, tapi UI list/search hasil klik belum ke-capture. Sama, di-log warning + berhenti.
3. **Daftar Produk Sektoral** — react-select tanpa id stabil (id-nya random per render `react-select-_r_3m_-*`), dan belum tahu apakah searchable-by-Kode-Produk atau dropdown biasa. Di-anchor pakai `findRowByHeading('Daftar Produk Sektoral')` tapi belum diisi otomatis, cuma di-log posisi containernya buat verifikasi manual.

Karena 2 hal ini (KBKI, Sektoral) ada di section yang sama (`isi_dasar`), `FormFiller.isiDasar()` masih berhenti (return early) begitu sampai ke KBKI — Merek sudah tidak lagi jadi blocker sejak Task 4a.

## Detail Task 4a (baru selesai) — Merek

Jamal kasih outerHTML: input nomor `#form-product-brand-application-number-input` (name `brand.input`) + tombol `#form-product-check-brand-btn` ("Periksa"). Nilainya konstan: `DID2023107469` (masuk `CONFIG.constants.merkNomor`).

`FormFiller.fillMerek()` sekarang: nyalain switch (kalau belum) → isi nomor konstan → klik "Periksa" → tunggu 800ms. **Catatan:** belum ada konfirmasi apakah ada langkah lanjutan sesudah klik "Periksa" (mis. modal konfirmasi kayak TKDN) — makanya tetap ada `Logger.warning` supaya diverifikasi visual pas dry-run pertama, bukan diam-diam dianggap pasti tuntas. Kalau ternyata ada langkah lanjutan, tinggal kasih outerHTML-nya.

## Detail Task 3.1 (baru selesai)

Ditambahkan textarea + tombol "Load Queue dari Textarea" di panel, jadi gak perlu lagi `window.__INAPROC_V6__.QueueManager.setQueue([...])` lewat console.

**Format 1 baris per SKU, kolom dipisah TAB (bukan spasi):**
```
kodeProduk<TAB>kbki<TAB>kategoriLvl1<TAB>kategoriLvl2<TAB>kategoriLvl3<TAB>namaProduk<TAB>deskripsi<TAB>harga<TAB>stok<TAB>satuan<TAB>berat<TAB>minPembelian<TAB>jenisPajak
```
Wajib diisi: `kodeProduk`, `kategoriLvl1-3`, `namaProduk`, `harga`, `stok`, `satuan`, `berat`. Sisanya (`kbki`, `deskripsi`, `minPembelian`, `jenisPajak`) boleh kosong. Hover ikon "?" di panel buat lihat urutan kolom kalau lupa.

Parser (`QueueManager.parseFromText`) validasi per baris — baris yang field wajibnya kosong di-skip + di-log error, TIDAK bikin seluruh load gagal (baris lain yang valid tetap masuk).

**Catatan:** format tab-separated ini masih sementara/manual (Opsi A-style), bakal digantikan/dilengkapi stage `fetch_data` dari Supabase di Task 8 sesuai keputusan arsitektur Opsi B. Kolom `kategoriLvl1-3`/`harga`/`stok`/`satuan`/`berat` kemungkinan besar nanti ke-auto-fill dari situ, jadi textarea-nya bisa disederhanakan lagi tinggal `kodeProduk` + `kbki` aja.

## Task 4b sudah terjawab

Ketiga pertanyaan di bawah ini sudah dijawab dan diimplementasikan — lihat "Detail Task 4b" di atas:
1. ~~Klik `#form-product-kbki-select` → outerHTML apa yang muncul~~ → react-select, opsi `select__option-label`
2. ~~Daftar Produk Sektoral searchable atau dropdown biasa~~ → searchable by Kode Produk (screenshot)
3. ~~Konfirmasi langkah lanjutan sesudah "Periksa" Merek~~ → tidak ada langkah lanjutan

## Yang dibutuhkan dari Jamal buat Task 8 (Supabase)

1. Supabase project URL + anon/public API key (buat REST fetch dari Tampermonkey — CORS harus izinin origin `penyedia.inaproc.id` atau kita fetch dari halaman itu langsung, perlu dicek RLS policy-nya juga)
2. Nama kolom persis "harga upload" di tabel `produk_harga` (vs `harga_ekat`)
3. Nama tabel/kolom kategori (AKD), stok, satuan, berat — asumsi sementara ada di `produk_harga`/`master_produk`, perlu dikonfirmasi