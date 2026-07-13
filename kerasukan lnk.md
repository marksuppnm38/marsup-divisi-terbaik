# Brainstorm: Tampermonkey Script - Upload Produk INAPROC EKAT v6

> **Cara pakai file ini:** besok buka chat baru, upload file .md ini + (kalau perlu) file `AUTOMATE_UPLOAD_EKAT.xlsx` dan `jin_master_produk.js` lagi, terus bilang ke Claude "lanjutin brainstorm dari file ini". Belum ada kode yang di-generate — ini baru tahap analisa & nentuin arsitektur.

---

## Konteks

Jamal mau bikin Tampermonkey script buat automasi **"Tambah Produk"** di e-Katalog LKPP v6 (penyedia.inaproc.id), berdasarkan alur di `AUTOMATE_UPLOAD_EKAT.xlsx`. Ini beda dan LEBIH KOMPLEKS dari script yang udah ada (`jin_master_produk.js` v3.9.0) yang cuma otomasi registrasi merek (isi 1 kode KFA + upload 2 dokumen: AKD & CPAKB).

Referensi arsitektur yang sudah proven jalan di `jin_master_produk.js` (bisa dipakai lagi buat script baru):
- Stage-machine pakai `localStorage` (`QUEUE_KEY`, `RESULTS_KEY`, `FLAGS_KEY`, `STAGE_KEY`) — supaya proses bisa **survive page reload**
- Panel UI draggable/collapsible dengan textarea queue, dry-run toggle, auto-continue toggle, export CSV/TSV
- Helper: `waitForElement`, `pollUntil`, `waitForClickableByText`, `setNativeValue`, `injectFileToInput` (pakai `DataTransfer` buat bypass file picker), `findFileInputByDokumenHeader` (anchor ke header unik per slot dokumen, bukan occurrence index — ini fix penting dari bug sebelumnya)
- Fetch dokumen dari Supabase Storage: `https://ptkkbsemihcyndisjoor.supabase.co/storage/v1/object/public/perizinan/...`
- Pola "skip + refresh halaman" kalau ketemu SKU bermasalah, daripada maksa lanjut di context DOM yang residual (sumber bug utama versi lama)

---

## Breakdown alur dari xlsx (pemahaman awal, PERLU DIKONFIRMASI Jamal)

### Section 1 — Info dasar produk
- Kategori (tergantung AKD — jadi ini **per-SKU**, bukan fixed)
- Merk — nilai contoh `DID2023107469` — **diduga ini hasil dari proses registrasi merek** (`jin_master_produk.js`). Perlu dikonfirmasi.
- Pilih dari "Daftar Produk Sektoral" by Kode Produk
- Nama Produk (template: "ROBUST" + deskripsi)
- Upload Foto Produk (path: kode produk di Supabase bucket)
- Deskripsi (ROBUST + deskripsi)
- Kode KBKI — contoh: `4815013019 - Manual surgical instrument for general use` — **perlu dikonfirmasi**: fixed buat semua surgical instrument, atau beda per jenis produk?
- Klasifikasi Produk: "Lokal" (kemungkinan fixed)
- Lokasi Produksi, Tenaga Kerja, Bahan Baku: teks fixed (statement standar TKDN lokal)

### Section 2 — TKDN
Ada mini-wizard: cari nomor TKDN → modal muncul → centang radio → klik "Ya Simpan" → klik "Simpan". Nomor contoh: `6722/TKDN/IK/VII/2024`.

### Section 3 — SNI
Nilai: "TIDAK ADA" (kemungkinan cuma pilih dropdown)

### Section 4 — Spesifikasi Produk (PALING RUMIT, PALING PERLU DIPERJELAS)
7 pertanyaan Q&A, masing-masing dropdown jawaban:
1. Daftar Distributor yang Ditunjuk → **MENUNJUK**
2. Izin Distribusi Alat Kesehatan (NIE) → **TIDAK TERSEDIA**
3. Sertifikat Cara Pembuatan Alkes yang Baik (CPAKB) → **TERSEDIA**
4. Pemberitahuan Impor Barang (PIB) → **TIDAK ADA**
5. Garansi → **1 TAHUN**
6. Surat Ketersediaan Layanan Purna Jual & Sparepart → **1 TAHUN**
7. Struktur Harga → **TERSEDIA**

Dugaan: beberapa jawaban dropdown ini **trigger munculnya field upload dokumen** terkait. Perlu dikonfirmasi gimana persisnya (langsung nempel di bawah pertanyaan, atau modal terpisah).

### Section 5 — Field bisnis
Jenis Pajak, Minimum Pembelian, Harga Produk, Jumlah Stok, Satuan Produk, Pre Order, Berat Produk — field-field simpel, semua **per-SKU**.

### Section 6 — Upload Lampiran (urutan penting!)
6 dokumen diupload urut:
1. Spesifikasi Produk (file: `SPEK-KODE_PRODUK`) — per-SKU
2. NIE (Nomor Izin Edar) — per-SKU
3. Daftar Distributor Tertunjuk — **fixed** (gak pernah berubah, kata Jamal)
4. Garansi — **fixed**
5. Surat Ketersediaan Layanan Purna Jual & Sparepart — **fixed**
6. Struktur Harga (`STRK-KODE_PRODUK`) — per-SKU

### Section 7 — Simpan & Loop
Centang checkbox → Simpan → balik ke list produk / form reset → klik "Tambah Produk" lagi buat SKU berikutnya.

---

## Klasifikasi data: per-SKU vs konstan (CONFIG)

**Kemungkinan KONSTAN (masuk CONFIG, kayak `cpakbPath` di script lama):**
- Klasifikasi Produk, Lokasi Produksi, Tenaga Kerja, Bahan Baku (teks statement)
- SNI (Tidak Ada), Jenis Pajak (mungkin)
- Brand "ROBUST"
- Dokumen: Daftar Distributor, Garansi, Surat Layanan Purna Jual, Struktur Harga template — **CATATAN: field ini kelihatannya konstan, tapi dokumen Struktur Harga di lampiran #6 ada suffix `STRK-KODE_PRODUK` yang menyiratkan per-SKU. Ini KONTRADIKSI yang perlu diklarifikasi ke Jamal** — apakah dokumen Struktur Harga isinya beda per SKU (karena berisi harga produk itu) meskipun "section"-nya sama?

**Per-SKU (masuk queue):**
- Kode Produk, Kategori, Nama Produk/Deskripsi, Harga, Stok, Satuan, Berat
- Merk (kode hasil registrasi)
- Foto Produk, File Spesifikasi Produk (SPEK-KODE), NIE
- Kode KBKI (perlu dikonfirmasi — bisa jadi konstan per grup produk)

---

## Pertanyaan terbuka buat Jamal (WAJIB dijawab sebelum lanjut desain queue)

1. Apakah "MERK" (`DID2023107469`) itu benar hasil dari proses `jin_master_produk.js`? Kalau iya, apakah kodenya bisa didapat otomatis (misal disimpan di tabel Supabase abis proses merek selesai), atau harus manual dicatat Jamal?
2. Kode KBKI — fixed untuk semua produk surgical instrument, atau beda per jenis alat?
3. Dokumen Struktur Harga (`STRK-KODE_PRODUK`) — beneran per-SKU (karena isi harga beda-beda) meskipun section Spesifikasi Produk jawabannya "TERSEDIA" konstan?
4. Struktur halaman: apakah semua section (1-7) itu 1 halaman panjang (scroll) atau ada step/tab wizard terpisah?
5. Dropdown Kategori & KBKI — pakai react-select kayak script lama, atau komponen beda?
6. Modal TKDN — selector persis: input search, tombol cari, radio di modal, tombol "Ya Simpan"
7. Section Spesifikasi Produk — apakah urutan 7 pertanyaan & selector-nya SELALU SAMA tiap produk, atau bisa beda tergantung kategori? Gimana field upload dokumen nempel ke jawaban dropdown (langsung muncul di bawah, atau modal baru)?
8. 6 dokumen lampiran — apakah headernya unik per slot (kayak "Dokumen 1"/"Dokumen 2" di script lama), atau ada nama section per dokumen (misal "Upload NIE")?
9. Behaviour loop: abis Simpan, balik ke list produk terus klik "Tambah Produk" lagi, atau form reset di tempat yang sama?

---

## Opsi arsitektur data source (belum diputuskan)

**Opsi A — Upload file Excel/CSV langsung ke panel**
Tombol "Load dari file" di panel → parse pakai SheetJS (browser-side) → preview tabel sebelum jalan. Lebih robust dari textarea tab-separated karena field-nya banyak.

**Opsi B — Tarik dari Supabase langsung (kemungkinan paling efektif)**
User cukup isi daftar Kode Produk di queue, script fetch sisanya (harga dari `produk_harga`, deskripsi dari `master_produk.deskripsi_vendor`, dll) — data udah "satu sumber kebenaran" di Supabase, human error minim. Bisa dikombinasi Opsi A sebagai override manual per field kalau perlu.

**Belum diputuskan mana yang dipilih — ini salah satu hal pertama yang perlu diselesaikan besok.**

---

## Rekomendasi arsitektur development (biar gak kayak trial-error live kemarin)

- Tetep pakai stage-machine + localStorage queue (proven robust dari script lama)
- **Pecah tiap section jadi stage sendiri**: `isi_dasar` → `isi_tkdn` → `isi_spesifikasi` → `isi_bisnis` → `upload_lampiran` → `simpan` — biar kalau ada bug di 1 section, gampang di-resume tanpa ulang dari awal
- Tambahin flag "stop after this section" khusus buat development, supaya tiap section bisa diverifikasi satu-satu dulu sebelum di-chain full-auto — form sekompleks ini kalau langsung full-auto dari awal bakal susah nyari titik bug-nya

---

## Next steps besok

1. Jamal jawab 9 pertanyaan di atas (idealnya sambil buka DevTools di halaman Tambah Produk, kasih screenshot/HTML snippet per section)
2. Putuskan data source: Opsi A / B / kombinasi
3. Baru mulai desain struktur queue + CONFIG detail
4. Baru masuk coding — mulai dari section paling sederhana/pasti dulu (Section 1 & 5), section paling ambigu (Section 4: Spesifikasi Produk) dikerjain belakangan setelah selector-nya jelas