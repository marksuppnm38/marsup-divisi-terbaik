# Database Sync Workflow (V2)

## Tujuan

Menjadikan **Google Sheet sebagai source of truth** untuk data master produk.

Supabase tidak lagi diupdate manual satu per satu, tetapi hanya melakukan sinkronisasi dari CSV hasil export Google Sheet.

Dengan pendekatan ini:

- tidak perlu menjalankan banyak query import
- tidak perlu edit data langsung di tabel
- produk baru otomatis masuk
- produk lama otomatis update
- harga otomatis update
- komposisi SET otomatis update
- frontend tetap memakai database yang sama

---

# Source of Truth

Google Sheet

Semua perubahan dilakukan di Google Sheet.

Contoh:

- tambah produk
- edit nama produk
- edit AKD
- edit KFA
- edit spesifikasi
- edit harga e-Katalog
- edit isi SET

Semuanya dilakukan di Google Sheet.

---

# Harga

Harga e-Katalog menjadi satu-satunya source of truth.

Rumus:

```
Harga Upload = Harga E-Katalog / 1.11

Harga Swasta = Harga E-Katalog × 1.3
```

Walaupun secara bisnis cukup satu harga, ketiga harga tetap disimpan di tabel `produk_harga` agar tetap kompatibel dengan sistem lama.

---

# Workflow

```
Google Sheet
      │
      ▼
Export CSV
      │
      ▼
Upload ke staging table
      │
      ▼
SELECT sync_produk_csv();
      │
      ▼
Database otomatis sinkron
```

---

# Staging Table

CSV diupload ke tabel berikut.

```
stg_akd_satuan
stg_satuan_v6
stg_list_set
stg_isi_set
```

Staging hanya berfungsi sebagai tempat sementara.

---

# sync_produk_csv()

Function ini menjadi pusat sinkronisasi.

Sekali dijalankan akan melakukan:

## 1. Tambah produk baru

Jika kode produk belum ada

↓

INSERT ke tabel produk

---

## 2. Update produk lama

Jika kode produk sudah ada

↓

UPDATE seluruh informasi terbaru

misalnya:

- nama
- AKD
- kode asli
- KFA
- link
- spesifikasi
- berat
- status

---

## 3. Sinkron harga

Harga akan otomatis disimpan ke

```
produk_harga
```

jenis:

- EKATALOG
- UPLOAD
- SWASTA

menggunakan rumus yang sudah ditentukan.

---

## 4. Sinkron SET

Jika ada SET baru

↓

otomatis masuk ke tabel produk.

---

## 5. Sinkron isi SET

Data pada

```
stg_isi_set
```

akan mengupdate

```
produk_set_item
```

---

## 6. Search

Search tidak perlu diupdate manual.

Trigger PostgreSQL akan memperbarui:

```
search_text

search_tsv
```

secara otomatis.

---

# Contoh Workflow

## Tambah Produk

Google Sheet

↓

Tambah baris baru

↓

Export CSV

↓

Upload staging

↓

```
SELECT sync_produk_csv();
```

↓

Produk baru otomatis muncul.

---

## Edit Nama Produk

Google Sheet

↓

Edit nama

↓

Export CSV

↓

Upload staging

↓

```
SELECT sync_produk_csv();
```

↓

Nama produk berubah.

---

## Edit Harga

Google Sheet

↓

Edit Harga E-Katalog

↓

Export CSV

↓

Upload staging

↓

```
SELECT sync_produk_csv();
```

↓

Harga otomatis ikut berubah.

---

## Edit Isi SET

Google Sheet

↓

Edit komposisi

↓

Export CSV

↓

Upload staging

↓

```
SELECT sync_produk_csv();
```

↓

produk_set_item otomatis sinkron.

---

# CRUD

CRUD harian tidak lagi dilakukan langsung pada tabel.

Semua perubahan berasal dari Google Sheet.

Supabase hanya melakukan sinkronisasi.

```
Google Sheet
        ↓
Export CSV
        ↓
Upload staging
        ↓
sync_produk_csv()
        ↓
Database
```

---

# Yang Sudah Selesai

- Database V2
- View CRUD
- Sinkron produk
- Sinkron harga
- Sinkron SET
- Sinkron isi SET
- Search otomatis
- Produk baru otomatis dibuat
- Produk lama otomatis diupdate

---

# Yang Masih Akan Dikerjakan

## Soft Delete

Jika suatu produk sudah tidak ada lagi di Google Sheet, jangan dihapus dari database.

Lebih aman:

```
is_active = false
```

Dengan begitu:

- histori tetap aman
- relasi tidak rusak
- produk lama tidak muncul di pencarian aktif

---

# Prinsip Arsitektur

Google Sheet

↓

Source of Truth

↓

CSV

↓

Staging

↓

sync_produk_csv()

↓

Supabase

↓

Frontend

Frontend **tidak bertugas menghitung atau menyinkronkan data**, tetapi hanya membaca data yang sudah tersinkronisasi dari database.