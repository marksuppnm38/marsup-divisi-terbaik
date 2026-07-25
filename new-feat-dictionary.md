# Fitur Baru - Dictionary Istilah Customer

## Tujuan

Membangun fitur **Dictionary** untuk melihat histori istilah yang digunakan customer dan produk Robust yang dipilih user.

Fitur ini **bukan AI**.

Ini murni mengambil data historis dari tabel `permintaan_item`.

Tujuannya:

- membantu sales melihat bahasa customer
- mempercepat konversi berikutnya
- menjaga konsistensi pemilihan produk
- menjadi knowledge base internal


---

# Lokasi UI

Tambahkan tab baru sejajar dengan:

- Search
- Riwayat Konversi
- Konversi Berjalan
- Converted

menjadi

- Search
- Riwayat
- Berjalan
- Converted
- Dictionary


---

# Isi Halaman Dictionary

Halaman terdiri dari dua bagian.


## 1. Statistik

Card sederhana berisi:

- Total istilah customer unik
- Total produk yang pernah dipilih
- Total alias

Tidak perlu grafik.


---

## 2. Tabel Dictionary

Kolom:

| Istilah Customer | Produk Robust | Frekuensi | Terakhir Dipakai |
|-----------------|--------------|-----------|------------------|

Contoh

| Minor |
| Minor Set |
| Hecting |
| SC Set |
| Partus |
| Rawat Luka Set |


Klik satu row membuka detail.


---

# Detail Dictionary

Saat row diklik tampil panel kanan / modal.

Contoh

Istilah:

Minor


Pernah dipilih menjadi:

Minor S1
45x

Minor S2
17x

Minor S3
6x

Minor Basic
2x


Urutkan berdasarkan frekuensi terbesar.


Ini penting.

Karena memang satu istilah customer bisa memiliki beberapa produk Robust.


JANGAN menganggap ini error.


---

# Badge

Jika hanya pernah dipilih menjadi 1 produk

beri badge

CONSISTENT

warna hijau.


Jika pernah dipilih menjadi beberapa produk

beri badge

MULTIPLE

warna kuning.


Contoh

Minor

MULTIPLE


Rawat Luka Set

CONSISTENT


---

# Search

Search realtime.

Harus bisa mencari:

- istilah customer
- kode produk
- nama produk


---

# Filter

Tambahkan dropdown

Semua

Consistent

Multiple


---

# Sorting

Support sorting:

- Frekuensi terbanyak
- Alphabet
- Terbaru digunakan


---

# Frekuensi

Frekuensi dihitung dari jumlah record

status='TERPENUHI'

yang memiliki pasangan

(raw_text, matched_kode_produk)


---

# SQL

Gunakan data historis dari tabel

permintaan_item

status harus

TERPENUHI


---

## Query Summary

Setiap istilah customer menghasilkan:

- istilah
- jumlah produk berbeda
- total frekuensi
- terakhir digunakan


---

## Query Detail

Saat membuka satu istilah tampil:

- kode produk
- nama produk
- jumlah pemakaian

diurutkan berdasarkan jumlah terbesar.


---

# UX

Tidak perlu reload.

Gunakan fetch seperti halaman lain.

Loading spinner.

Empty state.

Error state.


---

# Yang TIDAK dibuat

Jangan buat:

- AI
- embedding
- vector search
- fuzzy recommendation
- auto suggest
- auto replace
- synonym generation
- machine learning

Semua itu nanti.


Sekarang hanya membuat Dictionary berbasis histori data.


---

# Coding Style

Ikuti struktur project yang sudah ada.

Jangan mengubah style UI utama.

Gunakan komponen yang sudah dipakai di halaman lain.

Jangan merombak CSS global.

Jangan mengubah logic Search maupun Konversi.

Fitur Dictionary harus berdiri sendiri dan tidak mengganggu fitur existing.


---

# Tujuan Akhir

Setelah fitur selesai, user bisa membuka tab Dictionary dan melihat:

- bahasa asli customer
- produk Robust yang biasanya dipilih
- apakah istilah tersebut konsisten atau memiliki banyak kemungkinan
- frekuensi penggunaan
- histori pemilihan

Sehingga Dictionary menjadi knowledge base internal yang terus bertambah setiap kali user melakukan konversi.