# Progress: Tampermonkey Script - Upload Produk INAPROC EKAT v6

> Living doc. Update tiap task selesai. Lihat `BRAINSTORM_INAPROC_EKAT_V6_v2.md` buat konteks arsitektur lengkap.

## Status ringkas

| Task | Scope | Status |
|---|---|---|
| 1 | Framework/pondasi (CONFIG, Storage, State, Logger, QueueManager, StageManager, DomHelper, UIPanel, Main) | ✅ Selesai |
| 2 | Navigation module (masuk ke form Tambah Produk) | ✅ Selesai |
| 3 | FormFiller — Section 1 (Isi Dasar) + Section 5 (Bisnis), field yang selector-nya sudah pasti | ✅ Selesai (parsial — 3 sub-field di-stub, lihat catatan) |
| 4 | Merek (switch + search), Kode KBKI (search modal), Daftar Produk Sektoral (async select) | ⬜ Belum — butuh 1x observasi live |
| 5 | Upload Foto Produk (wiring ke File object asli, sekarang cuma helper generik) | ⬜ Belum — butuh sumber file (Task 8 Supabase) |
| 6 | Section 2 — TKDN (search box awal, modal hasil sudah confirmed dari `tkdn.htm`) | ⬜ Belum — butuh observasi live search box + tombol "Ya Simpan" |
| 7 | Section 3 — SNI (switch/dropdown, kemungkinan simpel) | ⬜ Belum |
| 8 | Stage `fetch_data` — integrasi Supabase (produk_harga kolom "harga upload", master_produk, storage buckets) | ⬜ Belum — butuh Supabase URL + anon key + nama kolom persis dari Jamal |
| 9 | Section 4 — Spesifikasi Produk (16 field, anchor-by-teks ke index `productInformations.mainInformations.N`) | ⬜ Belum |
| 10 | Section 6 — Upload Lampiran (13 dokumen, anchor-by-teks ke `document-field-N`) | ⬜ Belum |
| 11 | Section 7 — Simpan & Loop ke SKU berikutnya | ⬜ Belum |
| 12 | Full-auto chain semua stage + testing end-to-end | ⬜ Belum |

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

Karena 3 hal ini di section yang sama (`isi_dasar`), untuk sekarang **`FormFiller.isiDasar()` berhenti (return early) begitu sampai ke Merek**, TIDAK lanjut ke Nama Produk/Kategori/dst dulu — jadi urutan eksekusi di kode sengaja ditaruh Merek/KBKI/Sektoral DULUAN supaya begitu ketemu blocker, User langsung tahu dan bisa kasih observasi HTML tambahan, sebelum waktu kebuang test field lain yang sebenarnya udah pasti jalan.

## Yang dibutuhkan dari Jamal buat lanjut ke Task 4

1. Buka form Tambah Produk, klik switch Merek → screenshot / outerHTML apa yang muncul (search box? modal? dropdown list kode merek?)
2. Klik `#form-product-kbki-select` → sama, outerHTML yang muncul
3. Klik field "Daftar Produk Sektoral" → apakah searchable (ketik lalu muncul opsi) atau dropdown list biasa, dan apakah nyari-nya pakai Kode Produk

## Yang dibutuhkan dari Jamal buat Task 8 (Supabase)

1. Supabase project URL + anon/public API key (buat REST fetch dari Tampermonkey — CORS harus izinin origin `penyedia.inaproc.id` atau kita fetch dari halaman itu langsung, perlu dicek RLS policy-nya juga)
2. Nama kolom persis "harga upload" di tabel `produk_harga` (vs `harga_ekat`)
3. Nama tabel/kolom kategori (AKD), stok, satuan, berat — asumsi sementara ada di `produk_harga`/`master_produk`, perlu dikonfirmasi