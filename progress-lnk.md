# Brainstorm v2: Tampermonkey Script - Upload Produk INAPROC EKAT v6

> Lanjutan dari `BRAINSTORM_INAPROC_EKAT_V6.md`. Semua 9 pertanyaan sudah dijawab Jamal (lihat `PERTANYAAN_INAPROC_EKAT_V6.xlsx`) dan sudah dikonfirmasi silang dengan outerHTML asli (`tkdn.htm`, `inaproc_dropdown_kategori__1_.html`). Status: **analisa selesai, siap desain queue/CONFIG lalu masuk coding.** Masih belum ada kode digenerate.

---

## 1. Ringkasan jawaban 9 pertanyaan (sudah terverifikasi via HTML asli)

| # | Pertanyaan | Jawaban Jamal | Verifikasi HTML |
|---|---|---|---|
| 1 | Kode KBKI fixed/per-SKU? | **Per-SKU, field isian manual user** | — |
| 2 | Merk konstan/per-SKU? | **Konstan** | — |
| 3 | Struktur halaman 1 scroll / tab? | **1 halaman panjang**, TKDN = mini-wizard modal yang scroll ke atas setelah simpan | Cocok — `inaproc_dropdown_kategori__1_.html` menunjukkan semua section (Kategori → Merk → Nama → Foto → Deskripsi → KBKI → Klasifikasi → Lokasi/Tenaga Kerja/Bahan Baku → TKDN → SNI → Spesifikasi Produk → Lampiran → Bisnis) ada di satu `<form id="form-product">` |
| 4 | Dropdown Kategori/KBKI pakai react-select? | Kategori **bukan** react-select biasa — custom dropdown 3-kolom kaskade (Alat Kesehatan → Peralatan Bedah Umum dan Bedah Plastik → Peralatan Bedah) | Konfirmed — lihat §2 |
| 5 | Selector modal TKDN | Outer HTML dikasih | Konfirmed — lihat §3 |
| 6 | Urutan 7(+) pertanyaan Spesifikasi Produk selalu sama? | **Tidak** — harus anchor by teks, bukan index/posisi | Konfirmed — untuk kategori "Alat Kesehatan" ternyata ada **16 field**, bukan 7 (lihat §4) |
| 7 | Upload dokumen nempel di bawah pertanyaan atau terpisah? | **Terpisah**, di bagian bawah sendiri (section "Lampiran"), mirip Master Produk | Konfirmed — lihat §4 |
| 8 | Header 6 dokumen lampiran unik? | **Ya**, ada nama per dokumen (Spek Produk, NIE, dst) | Konfirmed — 13 dokumen untuk kategori Alat Kesehatan, tiap wrapper `<div id="document-field-N">` punya `<p>` teks nama dokumen unik |
| 9 | Setelah Simpan balik kemana? | **Balik ke list produk**, lalu klik "Tambah Produk" lagi | — |

---

## 2. Section 1 — Kategori (CONFIRMED SELECTORS)

Bukan react-select. Custom combobox:

- Trigger/display: `#form-product-category-select` (div, bukan select), berisi `<input placeholder="Pilih Kategori">` yang value-nya jadi breadcrumb penuh: `"Alat Kesehatan > Peralatan Bedah Umum dan Bedah Plastik > Peralatan Bedah"`
- Saat diklik, muncul **3 kolom `<ul>` sejajar** (masing-masing `class="flex-grow w-1/3"`), tiap kolom adalah level kategori (Level 1 / Level 2 / Level 3).
- Tiap opsi = `<li>` berisi `<span class="block truncate text-sm">TEKS KATEGORI</span>`. Item yang **sedang terpilih** di kolom itu punya class tambahan `bg-secondary50 font-semibold text-secondary500`; yang belum terpilih `font-normal text-tertiary500`.
- Klik `<li>` di kolom 1 → kolom 2 muncul/berubah isi → klik `<li>` di kolom 2 → kolom 3 muncul → klik `<li>` di kolom 3 → dropdown close & input value ter-update.

**Implikasi untuk script:** fungsi `pilihKategoriKaskade(level1Text, level2Text, level3Text)` — klik trigger, `waitForElement` kolom 1, cari `<li>` yang `<span>` textnya match (pakai `.trim() === text` atau `includes`), klik, ulangi untuk kolom 2 & 3. **Kategori per-SKU ada di CONFIG grup** (karena "tergantung AKD"), bukan hardcode sekali untuk semua — kemungkinan besar dikelompokkan per grup produk (misal semua produk "Peralatan Bedah" pakai kaskade yang sama, override per SKU kalau AKD beda).

---

## 3. Section 2 — TKDN (CONFIRMED dari tkdn.htm)

- Trigger: switch `#form-product-tkdn-switch` (checkbox, name `tkdn.isActive`) → toggle ke "Ada" untuk memicu alur cari nomor TKDN. *(Search box awal belum ke-capture di HTML — kemungkinan modal search muncul begitu switch di-on. Perlu 1x observasi live untuk selector input pencarian & tombol "Cari".)*
- Modal hasil pencarian: tabel dengan `data-test="table"` → tiap baris hasil (`data-test="table-row-data"`) punya radio `<input type="radio" class=" cursor-pointer">` di kolom pertama (index-based, radio-radio ini **tidak** punya id unik, jadi harus dipilih via `closest('tr')` yang mengandung teks Merek/Tipe/Uraian yang match, atau just index ke-0 kalau cuma 1 hasil).
- Tombol modal:
  - `#tkdn-cancel-btn` → "Kembali"
  - `#tkdn-submit-btn` → "Simpan" (ini yang dipencet setelah radio dicentang)
- Setelah `#tkdn-submit-btn` diklik, halaman auto-scroll ke atas (dikonfirmasi Jamal). Script harus **re-`waitForElement`** section berikutnya, jangan asumsi posisi scroll.
- Catatan brainstorm lama menyebut ada tombol "Ya Simpan" sebelum "Simpan" — kemungkinan itu confirm dialog terpisah setelah klik Simpan (belum ke-capture). Perlu di-observe live sekali saja saat testing dry-run pertama.

---

## 4. Section 4 — Spesifikasi Produk (CONFIRMED — paling kompleks, sesuai dugaan)

Field ini **dinamis per kategori**. Untuk kategori "Alat Kesehatan > Peralatan Bedah..." ada 16 field (bukan 7 seperti dugaan awal):

| Index | Label | Tipe input |
|---|---|---|
| 0 | Kode KFA | text input |
| 1 | Spesifikasi Produk | text input |
| 2 | Nomor Izin Edar (NIE) | ? (perlu cek — kemungkinan text/dropdown) |
| 3 | Masa Berlaku NIE | ? (kemungkinan date) |
| 4 | Daftar Distributor yang Ditunjuk | **react-select dropdown** |
| 5 | Izin Distribusi Alat Kesehatan | dropdown |
| 6 | Sertifikat Cara Pembuatan Alat Kesehatan yang Baik Yang Masih Berlaku | dropdown |
| 7 | Sertifikat Cara Distribusi Alat Kesehatan Yang Baik Yang Masih Berlaku | dropdown |
| 8 | Sertifikat Alat Telekomunikasi dan/atau Perangkat Telekomunikasi | dropdown |
| 9 | Sertifikat Izin Pemanfaatan Sumber Radiasi Pengion (SRP) | dropdown |
| 10 | Hasil Pengujian Post Market | dropdown |
| 11 | Pemberitahuan Import Barang (PIB) | dropdown |
| 12 | BMHP | ? |
| 13 | Garansi | dropdown |
| 14 | Surat Ketersediaan Layanan Purna Jual dan Spare Part | dropdown |
| 15 | Struktur Harga | dropdown |

**Pola selector (KUNCI PENTING):**
- Label: `<label for="productInformations.mainInformations.{i}.value">` berisi `<span>{TEKS LABEL}</span>`
- Dropdown-nya (kalau tipe select): `<div id="form-product-productInformations-mainInformations-{i}-select">` (react-select asli, dengan `select__control`, `select__input`, dst — bisa reuse pola `pilihKategoriDropdown()`-style react-select helper dari script lama)
- Text input (kalau tipe teks): `<input id="form-product-productInformations-mainInformations-{i}-input">`

**Strategi anchor (sesuai jawaban Jamal #6):** karena `i` (index) BISA BEDA tiap kategori/produk, script **tidak boleh hardcode index**. Alurnya:
1. Cari semua `<label for="productInformations.mainInformations.*.value">` di halaman
2. Untuk tiap label, ambil teks `<span>` pertamanya, cocokkan (exact atau `includes`) ke teks pertanyaan target dari CONFIG (mis. "Daftar Distributor yang Ditunjuk")
3. Dari situ extract `{i}` dari atribut `for`
4. Susun selector target: `#form-product-productInformations-mainInformations-{i}-select` atau `-input`
5. Isi sesuai tipe (dropdown pakai react-select helper, text pakai `setNativeValue`)

Ini pola yang sama persis dengan semangat `findFileInputByDokumenHeader` di script lama — anchor by teks, bukan posisi.

**Section "Lampiran" (dokumen) — terpisah dari Q&A di atas, cocok jawaban #7 & #8:**

Wrapper per dokumen: `<div id="document-field-{i}">` berisi `<p class="text-sm font-bold text-tertiary500">{NAMA DOKUMEN}</p>` lalu di dalamnya ada tombol `#upload-document-btn` dan `<input type="file" id="document-field-input" accept="application/pdf,.pdf">`.

⚠️ **PENTING:** `id="document-field-input"` **DUPLIKAT** di semua 13 dokumen (persis seperti bug lama di script v3.9.0 yang butuh `findFileInputByDokumenHeader`). Jangan pernah `document.getElementById('document-field-input')` langsung — HARUS:
1. Cari `<div id="document-field-N">` yang `<p>`-nya match nama dokumen target
2. `.querySelector('input[type="file"]')` di dalam div itu saja

Untuk kategori Alat Kesehatan, 13 dokumen tersedia (bukan cuma 6 seperti draft awal — 6 itu kemungkinan cuma yang selalu "aktif"/wajib per kategori "Surgical Instrument" spesifik Jamal). Nama-nama dokumen (index bisa beda per kategori, harus anchor by teks juga):

```
0  Spesifikasi Produk
1  Nomor Izin Edar (NIE)
2  Daftar Distributor yang Ditunjuk
3  Izin Distribusi Alat Kesehatan
4  Sertifikat Cara Pembuatan Alat Kesehatan yang Baik Yang Masih Berlaku   (= CPAKB)
5  Sertifikat Cara Distribusi Alat Kesehatan Yang Baik Yang Masih Berlaku
6  Sertifikat Alat Telekomunikasi dan/atau Perangkat Telekomunikasi
7  Sertifikat Izin Pemanfaatan Sumber Radiasi Pengion (SRP)
8  Hasil Pengujian Post Market
9  Pemberitahuan Import Barang (PIB)
10 Garansi
11 Surat Ketersediaan Layanan Purna Jual dan Spare Part
12 Struktur Harga
```

Berdasarkan jawaban dropdown Jamal di draft awal (MENUNJUK / TIDAK TERSEDIA / TERSEDIA / dst), kemungkinan **jumlah dokumen yang benar-benar perlu diisi cuma sebagian** dari 13 ini — field lain kemungkinan tetap render di DOM tapi boleh dikosongkan kalau jawaban dropdown-nya "Tidak Tersedia/Tidak Ada". **Perlu dikonfirmasi:** apakah dokumen tetap wajib upload walau dropdown jawabannya "Tidak Tersedia", atau upload di-skip otomatis kalau jawabannya negatif? (lihat §6 pertanyaan sisa)

---

## 5. Field lain yang sudah confirmed ID-nya (Section 1, 5)

| Field | Selector |
|---|---|
| Nama Produk | `input[name="name"]` (id `form-product-name-input`) |
| Foto Produk (slot 0-4) | `#product-image-input-0` ... `#product-image-input-4` (multiple, accept image) |
| TKDN switch | `#form-product-tkdn-switch` |
| SNI switch | `#form-product-sni-switch` |
| Bahan Baku dropdown | `#form-product-material-type-select` (react-select) |
| Harga Produk | `#form-product-price-input` (name `priceAndVariantField.variants.0.price`) |
| Jumlah Stok | `#stockUnit-value-input` (name `priceAndVariantField.variants.0.stock`) |
| Satuan Produk | `#form-product-stockUnit-primaryUnit-input` (react-select) |
| Berat Produk | `#form-product-variants-shipping-weight-input` (name `shipping.weight`) |
| Minimum Pembelian | `#form-product-min-purchase-input` (name `priceAndVariantField.prices.minPurchase`) |
| Jenis Pajak (PPN%) | `#ppnPercentage-select` (react-select) |
| Pre Order switch | `#form-product-preorder-isActive-switch` (name `preOrder.isActive`) |

Semua field ini **tanpa index-collision** — aman dipakai langsung, gak perlu anchor-by-teks kayak Section 4.

---

## 6. Sisa hal yang masih perlu dikonfirmasi/diobservasi live (kecil, gak blocking desain)

1. Selector persis kotak search TKDN (input nomor TKDN + tombol "Cari") — belum ke-capture di `tkdn.htm` karena snapshot diambil setelah hasil pencarian muncul. Solusi: ambil 1 outerHTML lagi pas modal baru kebuka (sebelum search).
2. Apakah ada tombol konfirmasi "Ya Simpan" terpisah sebelum `#tkdn-submit-btn`, atau itu cuma di draft awal yang keliru.
3. Tipe input pasti untuk field index 2 (NIE), 3 (Masa Berlaku NIE), 12 (BMHP) — text/date/dropdown?
4. Apakah dokumen Lampiran yang jawabannya "Tidak Tersedia/Tidak Ada" tetap wajib diisi (mungkin dengan dokumen dummy) atau boleh dikosongkan/di-skip.
5. Dropdown react-select di Section 4 (Q&A) — apakah opsinya fixed per field (mis. "Distributor" cuma ada MENUNJUK/TIDAK MENUNJUK) atau bervariasi. Ini nentuin apakah CONFIG jawaban bisa 1 set konstan untuk semua produk sejenis (kemungkinan besar YA, karena ini bukan soal SKU tapi soal profil bisnis vendor).

Semua ini **kecil dan bisa diselesaikan sambil jalan** (pas testing dry-run SKU pertama) — tidak menghalangi mulai desain queue/CONFIG atau mulai coding section yang sudah pasti (1 & 5).

---

## 7. Keputusan data source — SUDAH DIPUTUSKAN

**Opsi B — tarik langsung dari Supabase.** User cukup isi daftar Kode Produk di queue textarea panel, script fetch sisanya dari Supabase (harga, deskripsi, dll).

**Catatan penting dari Jamal:** field harga yang ditarik harus **"harga upload"**, BUKAN **"harga ekat"** — kemungkinan besar ada 2 kolom harga berbeda (mis. di tabel `produk_harga`), dan yang dipakai buat isi form Tambah Produk adalah kolom "harga upload". **Perlu dikonfirmasi ke Jamal:** nama kolom & tabel persis di Supabase.

### Draft skema fetch per SKU (Opsi B)

```
Input user: daftar Kode Produk (satu per baris di textarea)

Untuk tiap Kode Produk, script fetch dari Supabase:
- master_produk        -> nama produk, deskripsi_vendor, kategori (AKD), kode KBKI (kalau disimpan di situ)
- produk_harga         -> kolom "harga upload" (BUKAN "harga ekat"), stok, satuan, berat
- storage: thumbnail/          -> foto produk (by kode RB)
- storage: spesifikasi/        -> SPEK-{KODE_PRODUK}.pdf
- storage: struktur-harga/     -> STRK-{KODE_PRODUK}.pdf
- storage: perizinan/          -> dokumen-dokumen konstan (AKD, CPAKB, Garansi, Surat Purna Jual, dll -- reusable semua SKU)

CONFIG (konstan, tidak di-fetch, hardcode di script):
- Merk
- Klasifikasi Produk, Lokasi Produksi, Tenaga Kerja, Bahan Baku (teks statement)
- SNI = Tidak Ada
- Jawaban 13 dropdown Section 4 (Distributor/NIE/CPAKB/dst) -- asumsi konstan per profil vendor
- Path dokumen konstan (Distributor, Garansi, Surat Layanan Purna Jual)
```

Opsi A (upload Excel manual) tetap bisa ditambahkan belakangan sebagai override manual per-field kalau ternyata ada SKU yang datanya di Supabase gak lengkap/salah -- tapi bukan prioritas awal.

### Pertanyaan soal ini — SUDAH DIJAWAB

1. ~~Nama tabel & kolom persis untuk "harga upload" vs "harga ekat" di Supabase.~~ **DIJAWAB:** sama-sama di tabel `produk_harga`, cuma beda nama kolom (kolom persisnya masih perlu dicek langsung pas coding — kemungkinan `harga_upload` vs `harga_ekat`, tinggal dikonfirmasi lewat Supabase table editor/API response pas nulis kode fetch-nya).
2. Nama tabel/kolom untuk kategori (AKD), stok, satuan, berat — masih perlu dicek pas coding (sama seperti #1, gampang diverifikasi lewat 1x fetch percobaan).
3. ~~Kode KBKI dari Supabase atau manual?~~ **DIJAWAB:** **belum ada di Supabase — harus diisi manual di queue textarea**, jadi KBKI **bukan** hasil fetch, tapi field manual per baris SKU (mis. `KODE_PRODUK<TAB>KODE_KBKI`).

---

## 8. Draft struktur queue (localStorage) — karena bentuk data source sudah jelas

Karena mayoritas per-SKU ditarik dari Supabase, tapi **KBKI harus manual**, queue-nya gak bisa cuma daftar Kode Produk polos — minimal butuh 2 kolom per baris. Draf format textarea (tab-separated, konsisten sama pola `jin_master_produk.js`):

```
KODE_PRODUK<TAB>KODE_KBKI
RB00123<TAB>4815013019 - Manual surgical instrument for general use
RB00124<TAB>4815013020 - Electric surgical instrument
```

Parsed jadi array of object, disimpan di `QUEUE_KEY`:

```js
{
  kodeProduk: "RB00123",
  kbki: "4815013019 - Manual surgical instrument for general use",
  // field di bawah ini di-fetch dari Supabase saat stage `fetch_data`, bukan dari textarea:
  nama: null, deskripsi: null, kategori: null,
  hargaUpload: null, stok: null, satuan: null, berat: null,
  fotoUrl: null, spekUrl: null, strukturHargaUrl: null,
}
```

**Stage machine** (sesuai rekomendasi §"Rekomendasi arsitektur" di brainstorm v1, dipertajam):

```
antrian -> fetch_data (tarik dari Supabase per SKU, isi field di atas)
        -> isi_dasar        (kategori, merk, nama, foto, deskripsi, kbki, klasifikasi, lokasi/tenaga kerja/bahan baku)
        -> isi_tkdn
        -> isi_sni
        -> isi_spesifikasi  (16 field anchor-by-teks + jawaban dropdown dari CONFIG)
        -> upload_lampiran  (13 dokumen, campur konstan (dari perizinan/) + per-SKU (spesifikasi/, struktur-harga/))
        -> isi_bisnis       (harga upload, stok, satuan, berat, pajak, min beli, preorder)
        -> simpan
        -> next SKU (balik ke list produk, klik Tambah Produk lagi)
```

Tiap stage checkpoint di `STAGE_KEY` per SKU (index queue) supaya kalau reload/error di tengah, bisa resume dari stage terakhir, bukan ulang dari `fetch_data`. Flag dev "stop after this stage" tetap dipakai biar tiap stage bisa diverifikasi manual dulu sebelum di-chain full-auto — terutama `isi_spesifikasi` dan `upload_lampiran` yang paling berisiko salah anchor.

**Field CONFIG (konstan, hardcode, gak masuk queue):**
- Merk, Klasifikasi Produk, Lokasi Produksi, Tenaga Kerja, Bahan Baku (teks)
- SNI = Tidak Ada
- 13 jawaban dropdown Section 4 + path dokumen konstan (Distributor, Garansi, Surat Purna Jual, CPAKB, AKD) dari `perizinan/`
- Jenis Pajak (kalau ternyata fixed juga — perlu dikonfirmasi, kemungkinan besar iya karena ini profil vendor bukan per produk)

---

## 9. Next steps

1. Verifikasi 1x lewat Supabase table editor / percobaan fetch: nama kolom persis `harga_upload` (vs `harga_ekat`) di `produk_harga`, dan tabel/kolom buat kategori/stok/satuan/berat — ini bisa langsung sambil mulai coding stage `fetch_data`, gak perlu nunggu jawaban terpisah dari Jamal.
2. Jamal jawab 5 hal kecil di §6 kalau sempat (bisa sambil jalan pas dry-run pertama) — terutama selector search box TKDN.
3. Mulai coding, urutan: stage `fetch_data` (Supabase) -> Section 1 & 5 (selector pasti) -> Section 6 Lampiran (anchor-by-teks, pola sudah jelas) -> Section 4 Spesifikasi Produk (paling kompleks) -> Section 2 TKDN (perlu 1x observasi live buat search box) -> Section 3 & 7