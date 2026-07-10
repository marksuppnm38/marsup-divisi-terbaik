# Database Maintenance

Dokumentasi proses maintenance database setelah update arsitektur sinkronisasi produk.

---

# Struktur Sinkronisasi

Semua data master berasal dari tabel **staging**.

CSV tidak pernah di-import langsung ke tabel utama (`produk`, `produk_harga`, dll).

Alur sinkronisasi:

CSV
↓
stg_*
↓
sync_staging_to_produk()
↓
produk
produk_harga
produk_set_item
master_produk

---

# Daftar Tabel Staging

| Tabel | Fungsi |
|--------|--------|
| stg_akd_satuan | Data instrument AKD |
| stg_satuan_v6 | Data V6 Instrument |
| stg_kfa_satuan | Mapping KFA & Cangkang |
| stg_master_produk | Master Produk Vendor |
| stg_list_set | Daftar Set |
| stg_isi_set | Isi Set |
| stg_unit_baru | Produk Unit |

---

# Workflow Update Database

## 1. Kosongkan seluruh staging

```sql
TRUNCATE TABLE stg_akd_satuan;
TRUNCATE TABLE stg_satuan_v6;
TRUNCATE TABLE stg_kfa_satuan;
TRUNCATE TABLE stg_master_produk;
TRUNCATE TABLE stg_list_set;
TRUNCATE TABLE stg_isi_set;
TRUNCATE TABLE stg_unit_baru;
```

---

## 2. Upload seluruh CSV terbaru

Upload ke masing-masing tabel staging.

Pastikan:

- delimiter benar
- header sesuai
- tidak ada error import

---

## 3. Jalankan sinkronisasi

```sql
SELECT sync_staging_to_produk();
```

Function akan menjalankan seluruh proses secara otomatis.

---

# Yang Dikerjakan sync_staging_to_produk()

## STEP 0

Sync Master Produk

Menjalankan

```
sync_master_produk()
```

untuk mengupdate tabel:

```
master_produk
```

---

## STEP 1

Import Instrument Baru

Source:

```
stg_akd_satuan
```

Target:

```
produk
```

tipe:

```
INSTRUMENT
```

---

## STEP 2A

Import Unit Baru

Source:

```
stg_unit_baru
```

Target:

```
produk
```

tipe:

```
UNIT
```

---

## STEP 2B

Import Set Baru

Source:

```
stg_list_set
```

Target:

```
produk
```

tipe:

```
SET
```

---

## STEP 3

Update data Instrument dari

```
stg_satuan_v6
```

Field yang diperbarui:

- nama_produk
- kode_asli
- no_akd
- kode_kfa
- link_v6
- berat_gram
- spesifikasi
- status_v6

---

## STEP 4

Update KFA & Cangkang

Source

```
stg_kfa_satuan
```

Field:

- kode_kfa
- kode_cangkang
- nama_cangkang

---

## STEP 5

Update data Unit

Source

```
stg_unit_baru
```

Field:

- nama_produk
- no_akd
- kode_kfa
- link_v6
- berat_gram
- spesifikasi
- golongan

---

## STEP 6

Sync Harga

Harga menggunakan tahun aktif dari

```
get_tahun_harga()
```

Jenis harga yang dibuat:

- EKATALOG
- UPLOAD
- SWASTA

Source:

Instrument

```
stg_satuan_v6.harga_ekat
```

Unit

```
stg_unit_baru.harga_satuan
```

Target:

```
produk_harga
```

---

## STEP 7

Sync Isi Set

Source

```
stg_isi_set
```

Target

```
produk_set_item
```

---

# Return Value

Function mengembalikan JSON.

Contoh:

```json
{
    "status":"OK",
    "sync_time":"2026-07-10T06:29:38",
    "tahun_harga":2026,
    "master_produk":12018,
    "produk_baru":0,
    "produk_diupdate":18813,
    "harga_disync":21714,
    "set_disync":13875
}
```

---

# Catatan Penting

## Tahun harga

Tidak lagi menggunakan angka hardcode.

Seluruh harga mengikuti:

```sql
SELECT get_tahun_harga();
```

---

## Master Produk

Selalu di-update terlebih dahulu sebelum sinkronisasi produk.

Tidak perlu menjalankan `sync_master_produk()` secara manual.

---

## Staging

Staging boleh dikosongkan menggunakan:

```sql
TRUNCATE TABLE ...
```

setiap sebelum upload CSV baru.

Data staging bukan data permanen.

---

## Data Produksi

Jangan pernah mengedit tabel:

- produk
- produk_harga
- produk_set_item

secara manual kecuali memang diperlukan.

Seluruh perubahan sebaiknya berasal dari file CSV lalu dilakukan sinkronisasi ulang.

---

# Manual Update Link

Apabila terdapat link Inaproc yang belum tersedia di CSV, update dapat dilakukan secara manual.

Contoh:

```sql
UPDATE produk
SET
    link_v6='https://katalog.inaproc.id/...',
    updated_at=NOW()
WHERE
    kode_produk='RB11-KE914-B018-U07'
    AND tipe='INSTRUMENT';
```

atau

```sql
UPDATE produk
SET
    link_v6='https://katalog.inaproc.id/...',
    updated_at=NOW()
WHERE
    kode_produk='BSC - 001'
    AND tipe='UNIT';
```

---

# Ringkasan Workflow

```
TRUNCATE staging
        │
        ▼
Upload seluruh CSV
        │
        ▼
SELECT sync_staging_to_produk();
        │
        ▼
Database Production Updated
```