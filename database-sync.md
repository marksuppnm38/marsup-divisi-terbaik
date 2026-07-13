# DATABASE ARCHITECTURE
## Robust Medical Instrument Database

Last Updated : July 2026

---

# Overview

Database ini dibuat sebagai **single source of truth** untuk seluruh data produk Robust.

Semua data berasal dari berbagai spreadsheet operasional perusahaan, kemudian diimport ke **staging table**, lalu disinkronkan ke database utama menggunakan function:

```sql
SELECT sync_staging_to_produk();
```

Tidak ada proses edit langsung ke tabel staging selain import CSV.

---

# Arsitektur Database

```
Google Sheet
      │
      ▼
 Export CSV
      │
      ▼
 Staging Tables
      │
      ▼
sync_staging_to_produk()
      │
      ▼
 Main Tables
      │
      ▼
 Search Function
      │
      ▼
 Web Application
```

---

# Konsep Database

Database dibagi menjadi dua bagian besar.

## 1. Staging

Digunakan sebagai tempat import CSV.

Semua tabel staging boleh dihapus isinya (TRUNCATE).

Tidak ada data permanen di sini.

Contoh:

- stg_akd_satuan
- stg_satuan_v6
- stg_master_produk
- stg_kfa_satuan
- stg_unit_baru
- stg_list_set
- stg_isi_set

---

## 2. Main Database

Merupakan database utama yang digunakan aplikasi.

Data di tabel ini **tidak pernah dihapus saat update CSV**.

Semua update dilakukan melalui fungsi sync.

Tabel utama:

- master_produk
- produk
- produk_harga
- produk_set_item

---

# Relasi Antar Tabel

## master_produk

Master referensi berdasarkan:

```
kode_asli
```

Berisi informasi vendor seperti:

- deskripsi vendor
- family
- sub family
- manufacturer
- capital

Sumber data:

```
stg_master_produk
```

Digunakan untuk melengkapi data produk apabila data AKD kurang lengkap.

---

## produk

Merupakan tabel utama seluruh item.

Primary identifier:

```
kode_produk
```

Satu baris = satu produk.

Tipe produk terdiri dari:

- INSTRUMENT
- UNIT
- SET

Semua pencarian aplikasi dilakukan ke tabel ini.

---

## produk_harga

Relasi:

```
produk.id
    │
    ▼
produk_harga.produk_id
```

Satu produk memiliki banyak harga.

Contoh:

```
EKATALOG

UPLOAD

SWASTA
```

Harga selalu disimpan berdasarkan tahun.

---

## produk_set_item

Relasi:

```
SET
 │
 ▼
produk_set_item
 │
 ▼
INSTRUMENT
```

Tabel ini menyimpan isi dari setiap set.

Contoh:

SET A

↓

Scissor

↓

Qty 2

---

# Alur Data

## 1.

Master Produk

```
stg_master_produk

↓

sync_master_produk()

↓

master_produk
```

---

## 2.

Instrument AKD

```
stg_akd_satuan

↓

produk
```

---

## 3.

Data V6

```
stg_satuan_v6

↓

Update:

nama

harga

AKD

berat

spesifikasi

status

link
```

---

## 4.

KFA

```
stg_kfa_satuan

↓

produk

↓

kode_kfa

kode_cangkang

nama_cangkang
```

---

## 5.

Unit

```
stg_unit_baru

↓

Import UNIT baru

↓

Update data UNIT
```

---

## 6.

Set

```
stg_list_set

↓

Import SET

↓

stg_isi_set

↓

produk_set_item
```

---

# Sync Process

Semua sinkronisasi dilakukan melalui:

```sql
SELECT sync_staging_to_produk();
```

Function ini akan menjalankan:

## STEP 0

Sync Master Produk

```
stg_master_produk

↓

master_produk
```

---

## STEP 1

Import Instrument Baru

```
stg_akd_satuan

↓

produk
```

---

## STEP 2A

Import UNIT Baru

```
stg_unit_baru

↓

produk
```

---

## STEP 2B

Import SET Baru

```
stg_list_set

↓

produk
```

---

## STEP 3

Update Instrument dari V6

Meliputi:

- nama
- kode asli
- AKD
- berat
- spesifikasi
- status
- link

---

## STEP 4

Update

- KFA
- Cangkang

---

## STEP 5

Update UNIT

---

## STEP 6

Sync Harga

Menghasilkan:

- EKATALOG
- UPLOAD
- SWASTA

Harga disimpan ke:

```
produk_harga
```

---

## STEP 7

Sync Isi Set

Mengupdate:

```
produk_set_item
```

---

# Source of Truth

| Data | Source |
|--------|----------------|
| Master Produk | stg_master_produk |
| Instrument | stg_akd_satuan |
| Detail Instrument | stg_satuan_v6 |
| KFA | stg_kfa_satuan |
| UNIT | stg_unit_baru |
| SET | stg_list_set |
| Isi SET | stg_isi_set |

---

# Cara Update Database

## 1.

Kosongkan staging yang akan diupdate.

Contoh:

```sql
TRUNCATE stg_satuan_v6;
```

Tidak perlu truncate semua tabel apabila hanya satu data yang berubah.

---

## 2.

Import CSV terbaru.

CSV harus mengikuti struktur kolom tabel staging.

Tidak perlu mengikuti struktur tabel `produk`.

---

## 3.

Jalankan:

```sql
SELECT sync_staging_to_produk();
```

---

# Penting

Jangan melakukan edit manual pada:

- produk
- produk_harga
- produk_set_item

Kecuali memang diperlukan untuk perbaikan data tertentu.

Perubahan massal selalu dilakukan melalui staging + sync.

---

# Data Flow

```
Google Sheet

↓

CSV

↓

Staging

↓

sync_staging_to_produk()

↓

Main Database

↓

Search Function

↓

Website
```

---

# Filosofi Database

Staging adalah tempat import.

Main Database adalah sumber data aplikasi.

CSV boleh berubah.

Database utama tidak dihapus.

Sync bertugas menyamakan keduanya secara aman menggunakan UPSERT.

Dengan desain ini:

✓ aman melakukan update berkali-kali

✓ tidak kehilangan data

✓ mudah rollback

✓ scalable untuk data baru

✓ aplikasi selalu membaca dari satu sumber data yang konsisten