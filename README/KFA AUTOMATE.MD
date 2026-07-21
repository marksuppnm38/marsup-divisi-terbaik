# Panduan Lengkap: KFA Alkes Automation (Pionir Group)

Panduan ini dibuat supaya siapa pun di tim — bahkan yang baru pertama kali pegang script ini — bisa jalanin tanpa bikin data KFA nasional berantakan. **Baca dari atas ke bawah dulu SEBELUM mulai kerja**, jangan loncat-loncat.

---

## ⚠️ ATURAN PALING PENTING (WAJIB BACA)

1. **Proses A (masukin kode SKU ke field "Tipe (Type)" di cangkang) HARUS DILAKUKAN MANUAL.** Ada tombol "▶ Proses A" di panel, tapi **JANGAN DIPAKAI** untuk kerja beneran — field "Tipe (Type)" itu widget yang berat/reaktif dan gampang meleset kalau diklik otomatis oleh script. Satu-satunya cara yang aman untuk Proses A adalah: **paste data → klik manual ke field → tekan Alt+Enter** (langkah lengkapnya di Bagian 3 di bawah).
2. **Proses B (validasi ke sistem KFA nasional) BOLEH diotomasi**, tapi **WAJIB tes 1 SKU dulu dengan SEMUA checkbox OFF** sebelum nyalain auto-validate/auto-save/auto-lanjut buat banyak SKU sekaligus.
3. Data yang diproses script ini **masuk ke sistem KFA nasional (kemkes.go.id)**. Kalau ada yang keliru dan udah ke-Save, itu bukan sekadar "undo" — harus dibenerin manual di sistem. Makanya: **pelan-pelan di awal, ngebut kalau udah yakin stabil.**
4. Kalau ada peringatan (⚠️) di log panel, **JANGAN lanjut ke SKU berikutnya dulu**. Baca peringatannya, cek manual, baru lanjut.

---

## Bagian 1: Instalasi (sekali saja)

1. Install ekstensi **Tampermonkey** di browser Chrome/Edge kamu (cari di Chrome Web Store, klik "Add to Chrome").
2. Klik ikon Tampermonkey di pojok kanan atas browser → pilih **"Create a new script..."**.
3. Hapus semua isi default yang muncul, lalu **copy-paste seluruh isi file script** (`kfa-alkes-automation.user.js`) ke situ.
4. Tekan **Ctrl+S** (atau menu File → Save) untuk simpan script.
5. Buka `https://kamus-alkes.kemkes.go.id/` dan login manual seperti biasa.
6. Kalau instalasi berhasil, **panel kecil berwarna biru "KFA Alkes Automation — Pionir" akan muncul otomatis** di pojok kanan atas halaman. Kalau nggak muncul, refresh halaman (F5).

> 💡 Setiap kali ada versi baru script dari tim, ulangi langkah 2–4 (buka script lama di Tampermonkey, hapus isinya, paste yang baru, save).

---

## Bagian 2: Kenalan dengan Panelnya

Panel biru itu isinya:
- **Kotak antrian (textarea)** — tempat paste daftar SKU yang mau diproses.
- **Tombol "Muat ke Antrian"** — mindahin isi textarea jadi antrian aktif.
- **3 checkbox**: Auto-klik Validate, Auto-klik Save, Auto-lanjut ke SKU berikutnya (lihat Bagian 4).
- **Tombol "▶ Proses A"** — **JANGAN DIPAKAI**, lihat aturan #1 di atas.
- **Tombol "▶ Proses B"** — jalanin validasi otomatis buat SKU pertama di antrian.
- **Kotak "Isi field yang lagi kebuka" + tombol Alt+Enter** — ini yang dipakai untuk Proses A manual.
- **Tombol Export CSV** — download hasil (kode KFA yang udah didapat) jadi file CSV.
- **Tombol Reset** — kosongin antrian & hasil di panel ini (TIDAK menghapus apa pun di sistem KFA).
- **Log** — catatan apa yang terjadi, paling penting buat troubleshooting. Baris terbaru selalu di atas.

Panel bisa digeser (drag di bagian header biru) kalau nutupin tombol di halaman, dan bisa diciutkan pakai tombol "—" di pojok kanan atas panel.

---

## Bagian 3: Proses A — WAJIB MANUAL (jangan pakai tombol otomatis)

Proses A itu masukin kode SKU ke daftar tag "Tipe (Type)" di halaman cangkang (Variants). Ini harus dikerjain **satu-satu, manual, per cangkang** — script cuma bantu ngetik & milih dari autocomplete-nya, bukan yang mutusin cangkang mana atau yang klik-klik navigasinya.

### Langkah-langkah:

1. **Siapkan data.** Buka spreadsheet (Excel/Google Sheets) berisi kolom: `KODE_PRODUK`, `NIE`, `TKDN`, `BRAND`. Blok data yang mau diproses (boleh banyak baris sekaligus), copy (Ctrl+C).
2. Di panel, paste (Ctrl+V) ke kotak textarea antrian. Formatnya harus **TAB-separated** (kalau copy langsung dari Excel/Sheets, ini otomatis sesuai).
3. Klik **"Muat ke Antrian"**. Cek di panel, tulisan "Antrian: X SKU" harus sesuai jumlah baris yang kamu paste.
4. Kotak **"Isi field yang lagi kebuka"** di bagian bawah panel akan otomatis keisi kode SKU pertama di antrian. Ini yang bakal diketik ke field yang kamu buka manual.
5. **Buka halaman cangkang** (produk template) yang mau kamu isi SKU-nya. Pastikan kamu di tab **Variants**.
6. Klik tombol **"Edit"** di halaman itu (manual, klik biasa pakai mouse).
7. Cari baris attribute **"Tipe (Type)"** di tabel. **Klik manual** (pakai mouse) di kotak kosong setelah tag/chip terakhir di baris itu — pastikan **kursor beneran kedap-kedip** di situ (tanda field-nya aktif/fokus). Kalau nggak yakin field-nya kebuka, klik lagi sampai yakin.
8. Setelah yakin field-nya aktif, **tekan tombol `Alt + Enter` di keyboard** (bukan klik tombol di panel — klik tombol bikin field-nya blur/mati duluan).
9. Script bakal otomatis ngetik kode SKU itu dan milih dari daftar autocomplete yang muncul. Cek log panel — kalau muncul ✅, berarti berhasil ditambahkan. Kalau muncul ⚠️, cek manual (kemungkinan kode belum terdaftar di sistem KFA sama sekali).
10. **Klik Save manual** di halaman itu untuk commit perubahan (kecuali kamu sudah centang "Auto-klik Save" — lihat Bagian 4, opsional untuk mempercepat).
11. Kalau berhasil, kotak "Isi field yang lagi kebuka" akan **otomatis geser ke SKU berikutnya** di antrian. Kalau mau lanjut ke SKU berikutnya di cangkang yang SAMA (satu cangkang bisa nampung banyak Tipe), ulangi dari langkah 7–10.
12. Kalau mau pindah ke cangkang lain, buka halaman cangkang barunya manual (navigasi ini SELALU manual, script tidak pernah pindah halaman sendiri), lalu ulangi dari langkah 6.

> ⚠️ **JANGAN skip langkah 7 (klik manual dulu sampai kursor kedip-kedip).** Kalau field belum beneran fokus terus kamu tekan Alt+Enter, kemungkinan besar gagal atau — lebih parah — salah masuk ke field lain.

> ⚠️ **Pastikan Proses A untuk satu SKU benar-benar SELESAI dan KE-SAVE** (bukan cuma keliatan di layar) sebelum kamu jalanin Proses B untuk SKU yang sama. Kalau belum ke-save, Proses B bisa gagal isi Brand/Type.

---

## Bagian 4: Proses B — Validasi ke Sistem KFA (boleh otomatis, tapi bertahap)

Proses B itu bagian yang bikin kode KFA resmi keluar (Configure/Reconfigure Product → isi Brand/Type → isi NIE/TKDN → Get NIE REGALKES → Validate → ambil kode KFA → Save).

### 3 checkbox yang perlu kamu pahami dulu:

| Checkbox | Fungsi | Kapan dinyalain |
|---|---|---|
| **Auto-klik Validate** | Script otomatis klik tombol Validate setelah Get NIE selesai | Nyalain kalau kamu udah yakin data NIE/TKDN yang di-input selalu benar |
| **Auto-klik Save** | Script otomatis klik Save setelah dapat kode KFA (atau setelah Proses A) | Nyalain bareng/setelah Auto-klik Validate |
| **Auto-lanjut ke SKU berikutnya** | Setelah 1 SKU sukses dapat kode KFA, script LANGSUNG proses SKU berikutnya di antrian sendiri | Nyalain PALING TERAKHIR, setelah dua checkbox di atas terbukti aman |

**Auto-lanjut otomatis BERHENTI sendiri** kalau ada SKU yang gagal di tengah jalan (script tidak akan maksa lanjut) — tapi tetap wajib kamu cek log-nya setiap saat, jangan ditinggal-tinggal lama tanpa dipantau.

### Langkah-langkah (WAJIB ikuti urutan ini setiap kali mulai batch baru):

**Tahap 1 — Tes 1 SKU, SEMUA checkbox OFF:**
1. Pastikan antrian di panel udah keisi (dari Bagian 3 kamu udah paste TSV & load antrian; kalau session baru, paste & Muat ke Antrian lagi).
2. Pastikan **ketiga checkbox dalam keadaan MATI/kosong**.
3. Buka halaman **cangkang** (produk) yang SKU pertamanya mau divalidasi. Pastikan Proses A buat SKU ini **sudah selesai dan ke-Save**.
4. Klik **"▶ Proses B"**.
5. Script akan jalan sampai titik sebelum Validate, lalu **berhenti dan nunggu kamu**. Cek semua data yang sudah keisi (Brand, Type, NIE, TKDN) — pastikan bener semua.
6. Kalau semua benar, **klik tombol Validate MANUAL** sendiri di halaman.
7. Script otomatis mendeteksi kamu sudah klik Validate, lalu lanjut ambil kode KFA, dan berhenti sebelum Save (karena Auto-klik Save masih mati) — cek log, kalau muncul 🎉 dengan kode KFA-nya, berarti berhasil.
8. Klik **Save manual**.
9. Kalau semua lancar tanpa ⚠️ di log, kamu boleh lanjut ke Tahap 2.

**Tahap 2 — Nyalain Auto-klik Validate & Auto-klik Save (masih 1 SKU per klik):**
1. Centang **Auto-klik Validate** dan **Auto-klik Save**. Biarkan **Auto-lanjut tetap MATI**.
2. Buka cangkang untuk SKU berikutnya (Proses A-nya harus sudah selesai duluan — lihat Bagian 3).
3. Klik **"▶ Proses B"** lagi. Sekarang script akan jalan penuh sendiri sampai Save, tanpa kamu harus klik apa-apa.
4. Cek log — pastikan hasil akhirnya 🎉 dengan kode KFA yang valid, bukan ⚠️.
5. Ulangi untuk beberapa SKU lagi sambil kamu awasi. Kalau semuanya konsisten sukses, lanjut ke Tahap 3.

**Tahap 3 — Nyalain Auto-lanjut (baru untuk batch besar):**
1. Centang juga **Auto-lanjut ke SKU berikutnya**.
2. Pastikan **semua cangkang yang dibutuhkan untuk seluruh SKU di antrian sudah selesai Proses A dan ke-Save duluan** (ingat: Proses A itu manual, harus dikerjain dulu semua sebelum kamu jalanin batch Proses B otomatis).
3. Klik **"▶ Proses B"** sekali saja di cangkang SKU pertama di antrian.
4. Script akan proses SKU itu, dan kalau sukses, **otomatis lanjut ke SKU berikutnya sendiri** — tapi ingat, **navigasi ke cangkang baru tetap manual** kalau SKU berikutnya ada di cangkang yang beda. Jadi auto-lanjut ini paling optimal dipakai kalau beberapa SKU berturut-turut ada di **cangkang yang sama**.
5. **Tetap pantengin log-nya.** Kalau muncul ⛔ atau ⚠️, itu tandanya script berhenti sendiri — jangan diapa-apain dulu selain cek manual sesuai pesan log-nya.

---

## Bagian 5: Kalau Ada Peringatan (⚠️) di Log

Jangan panik, dan **jangan langsung klik ulang berkali-kali**. Ikuti ini:

1. **Baca pesan warning-nya pelan-pelan** — script selalu kasih tau kira-kira apa penyebabnya dan apa yang harus dicek.
2. Kalau pesannya minta cek **Console (F12)**, buka DevTools browser (tekan F12), klik tab **Console**, dan baca detail tambahan yang di-print di situ (biasanya nunjukin elemen HTML atau field mana yang bermasalah).
3. **Jangan lanjut ke SKU berikutnya** sampai masalah di SKU yang gagal ini beres dan kamu cek manual ke halaman produknya (pastikan nggak ada data setengah jadi/duplikat yang kebuat).
4. Kalau butuh bantuan, screenshot log panel + hasil Console (F12), kirim ke yang pegang script ini.

---

## Bagian 6: Export Hasil

Kapan pun, klik **"⬇ Export Hasil CSV"** untuk download semua kode KFA yang udah berhasil didapat selama sesi ini (kolom: Kode Produk, Kode KFA, Timestamp). Berguna buat rekap/laporan tanpa harus scroll log manual.

---

## Ringkasan Cepat (Cheat Sheet)

- **Proses A (isi Tipe/Type di cangkang) = SELALU MANUAL.** Paste TSV → Muat ke Antrian → klik manual field → **Alt+Enter** → Save. Jangan pakai tombol "▶ Proses A".
- **Proses B (validasi KFA) = boleh otomatis, tapi naik level pelan-pelan:** Tes 1 SKU semua checkbox OFF → nyalain Auto-Validate + Auto-Save → baru nyalain Auto-lanjut.
- **Selalu awasi log.** ⚠️ = berhenti, cek manual dulu. 🎉 = sukses, aman lanjut.
- **Navigasi pindah cangkang/halaman = SELALU manual**, script tidak pernah pindah halaman sendiri.
- Ragu? **Test dulu di 1 SKU**, jangan langsung gas ke banyak SKU sekaligus.