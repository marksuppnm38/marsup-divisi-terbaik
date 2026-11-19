# Auto-Konversi (PoC) — Draft konversi otomatis permintaan RS

Status: **proof of concept, engine saja**. Belum dipasang ke UI dan belum diuji terhadap database asli.

## Istilah

Pilihan nama, dari yang paling cocok dengan cara kerjanya:

| Pakai untuk | Istilah | Alasan |
|---|---|---|
| Nama fitur / tombol | **Auto-Match** | Yang dilakukan sistem memang *mencocokkan* teks RS ke produk, bukan menghitung konversi |
| Hasilnya | **Draft konversi** | Selalu butuh konfirmasi staff — jangan pernah disebut "hasil final" |
| Tahap 1 | **Baca (parse)** | teks → item + qty + spesifikasi |
| Tahap 2 | **Cocokkan (match/resolve)** | item → usulan produk + tingkat keyakinan |

"Parse" cuma tahap pertama. Kalau fitur disebut "parser" saja, orang mengira hanya membaca teks.

## Alur

```
teks permintaan RS (paste Excel / WA)         PDF set kompetitor (pdftotext -layout)
        │                                              │
        ▼                                              ▼
  parser.js  parseRequestText()               competitor.js  parseCompetitorSet()
  qty, ukuran, varian ejaan                   no, kode kompetitor, deskripsi, qty
        │                                     + cek silang total qty & nomor urut
        └───────────────┬──────────────────────────────┘
                        ▼
              resolver.js  resolveItems()
              1. suggest_dictionary  (riwayat istilah customer)   ← mesin yang SUDAH ada
              2. fallback search_produk_dengan_harga (katalog)
              3. putuskan: AUTO / REVIEW / UNKNOWN
                        │
                        ▼
          layar Review (sudah ada di permintaan-rs.js)  →  staff konfirmasi
                        │
                        ▼  (end-game, set kompetitor)
          cari_set_mendekati / bandingkan_input_set  (sudah ada di set-mendekati.js)
```

Tidak ada AI/embedding/fuzzy baru. Mesin pencocoknya `suggest_dictionary` yang sudah dipakai
Kebutuhan RS dan Cari SET. Modul ini menambahkan: parser yang paham paste Excel, varian ejaan,
aturan keputusan, dan parser set kompetitor.

## Aturan keputusan

| Status | Syarat | Artinya |
|---|---|---|
| **AUTO** | riwayat `exact`/`urutan` **dan** tidak ambigu **dan** ukuran `cocok`/`tidak_diminta` | Boleh diisi otomatis (tetap tampil di Review, ditandai) |
| **REVIEW** | keyakinan sedang/lemah, ukuran dekat/beda, hanya ketemu di katalog, atau istilah ambigu | Ada usulan, staff yang memilih |
| **UNKNOWN** | tidak ada di riwayat maupun katalog | Kandidat celah katalog / tambah ke Dictionary |

"Ambigu" = istilah yang sama pernah dipenuhi beberapa produk dan tidak ada yang dominan
(≥ 70% pemakaian dan ≥ 3×). Itu **bukan error** (lihat `new-feat-dictionary.md`), makanya REVIEW dan bukan ditebak.

Semua sumber (teks RS, Excel, set kompetitor) memakai keputusan yang sama; tidak ada mode khusus. Item kompetitor
hampir selalu REVIEW hanya karena buktinya biasanya cuma dari katalog, bukan karena asalnya.

**Keluarga + ukuran.** Kode `RB11-KE830-B014-U07` = keluarga `RB11-KE830` + ukuran 14 cm. Ambigu hanya kalau
istilah pernah dipenuhi beberapa *keluarga* tanpa dominan. Beda ukuran dalam satu keluarga bukan ambigu: ukuran
diambil dari teks, atau kalau tidak diminta, dari yang paling sering dipakai (`ukuran_default: true`).
SET (`-B99-`) dihitung per kode.

**Qty.** Angka bulat di ujung baris tanpa satuan = qty. Angka setelah NO/FIG/UK/SIZE/# bukan qty.
**Baris identik** tidak digabung secara default (bisa beda section/ukuran); hanya diberi peringatan.

## Hasil pada contoh permintaan RS (14 baris)

`node app/pages/konversian/auto-konversi/cli.mjs request app/pages/konversian/auto-konversi/fixtures/permintaan-rs-contoh.txt`

- 14 baris → **10 item**, total qty **105**.
- `GUNTING JARINGAN` 5 baris identik dibiarkan terpisah dengan peringatan (`{ merge: true }` kalau mau dijumlah → qty 25).
- `NEEDELHOLDER 14.5` → ukuran 14.5 cm (terbaca sebagai ukuran, bukan qty); varian `NEEDLE HOLDER 14.5`.
- `GUNTING GIFS` → varian `GUNTING GIPS`. Ejaan asli tetap dicoba duluan karena riwayat menyimpan ejaan customer apa adanya.
- `KLEM BENGKOK` vs `KLEM BENGKOK PANJANG`: terbaca sebagai dua item berbeda; `bengkok` dan `panjang` masuk spesifikasi.

## Hasil pada set Falcon "Appendectomy and Hernia"

`node app/pages/konversian/auto-konversi/cli.mjs competitor app/pages/konversian/auto-konversi/fixtures/falcon-appendectomy-hernia.txt`

- 28 baris terbaca semua, nomor urut 1..28 lengkap, total qty **61 = total di dokumen** (cek silang otomatis).
- Tiap item menghasilkan daftar query dari paling spesifik ke paling longgar, mis. Kelly:
  `KELLY ARTERY FORCEPS 14 CM` → `KELLY KLEM ARTERI 14 CM` → `KELLY 14 CM` → …
- Dua ADSON (dissecting vs tissue) dan dua spatula (lebar 30 vs 40 mm, cm sama) tidak jadi query yang sama.

## Cara menjalankan test

```
node --test app/pages/konversian/auto-konversi/auto-konversi.test.mjs
```

19 test, RPC di-mock. Test **tidak** membuktikan akurasi terhadap data aslinya — itu tugas Q5 & Q9.

## Yang belum diketahui / harus dicek

1. **Penamaan di tabel `produk`.** `aliases.js` (`GLOSSARY_EN_ID`, `TYPO_FIXES`) adalah tebakan awal. Jalankan Q10 untuk melihat apakah katalog memakai "Artery Forceps", "Klem Arteri", atau yang lain, lalu sesuaikan.
2. **Skema asli.** Query SQL memakai kolom yang terbukti dipakai kode, tapi file migration tidak ada di repo. Jalankan Q0a dulu.
3. **Akurasi.** Angka AUTO yang realistis baru diketahui lewat Q5 (batas atas) dan evaluasi replay dari Q9: putar ulang `raw_text` historis lewat resolver, bandingkan dengan `matched_kode_produk`. Target: % AUTO yang benar mendekati 100, baru kemudian dinaikkan cakupannya.
4. **Qty vs ukuran.** Sudah diputuskan: angka bulat di ujung = qty (konfirmasi pemilik).
5. **Dedup.** Merge baris identik bisa salah kalau itu memang beda section. Perilakunya dilaporkan, bukan disembunyikan.
6. **Kata "bukan konversi otomatis".** `PR_SUB_CREATE` di `permintaan-rs.js` masih menyatakan fitur ini "bukan proses konversi otomatis". Kalau Auto-Match dipasang, teks itu harus diubah.

## Rencana integrasi (belum dikerjakan)

1. Di layar Review (`renderReviewRows`), tambahkan kolom **Usulan produk** + badge AUTO/REVIEW/UNKNOWN. Pakai `resolveItems(items, S.rpc, { onProgress })`.
2. Staff mengonfirmasi → pakai jalur simpan yang sudah ada (`update_permintaan_item_multi`), jadi riwayat Dictionary otomatis bertambah dan tingkat AUTO naik seiring pemakaian.
3. Untuk set kompetitor: tab/tombol baru di Cari SET. Paste teks hasil `pdftotext -layout` (atau upload PDF → ekstraksi di server), `parseCompetitorSet`, `resolveItems` dengan `queriesFor: i => i.queries`, lalu hasil yang dikonfirmasi diteruskan ke `cari_set_mendekati`.
4. De-duplikasi `NOISE_WORDS` dan `pickBestCand/candConf` dengan `permintaan-rs.js` / `set-mendekati.js` (sengaja disalin dulu supaya modul lama tidak tersentuh).

## Keterbatasan set kompetitor

- Format yang didukung: tabel `No | Kode | Deskripsi | Qty` ala Falcon. Vendor lain kemungkinan butuh pola baris tambahan (ada cadangan tanpa kolom kode).
- PDF hasil scan (gambar) butuh OCR dulu; PoC ini mengandalkan PDF yang teksnya bisa diekstraksi.
- Item non-instrumen (mis. `STORING CASE`) ikut terbaca dan hampir pasti UNKNOWN — wajar, biarkan staff yang memutuskan.


## Pemahaman atribut + lexicon (vendor-agnostik)

Tujuan: mengenali deskripsi vendor mana pun **dan** istilah customer yang aneh ("korentang", "babcock", "bengkok")
tanpa tabel per-vendor dan tanpa menghardcode arti kata.

| Lapisan | File | Fungsi |
|---|---|---|
| Pahami | `understand.js` | Teks apa pun → `{ inti, tokens, attrs }`. `attrs` = ukuran, ujung (SH/BL/…), bentuk, gigi, nomor, mm, fig. Kata yang tak dikenal tetap jadi `inti`. "bengkok" = bentuk bila ada kata jenis ("klem bengkok"), tapi nama produk bila berdiri sendiri. |
| Nilai | `compareAttrs()` | Kandidat & permintaan lewat fungsi yang sama → per atribut `cocok / dekat / beda / tak_ada`. |
| Kamus | `lexicon.js` + SQL Q3 | Kata aneh → jenis katalog, **dipelajari dari riwayat** (`kamus_token`). Hanya entri n ≥ 3 dan konsisten ≥ 60% yang dipakai. Kata ambigu ("bengkok", share ~50%) otomatis tidak dipakai. |
| Putuskan | `resolver.js` | Riwayat kuat → tidak menyentuh katalog. Selain itu katalog ikut dicari lewat tangga query (asli → inti+atribut → buang kata satu-satu → kanonik lexicon) dan kandidat dinilai per atribut. |

Aturan baru:
- Atribut penentu berselisih (ujung, bentuk, gigi, nomor, mm, fig) → **tidak boleh AUTO**, alasannya menyebut atributnya (`reason_key = atribut_beda`).
  Pengecualian: riwayat exact/urutan yang dipakai ≥ 3× (staff berulang kali memutuskan begitu = kesetaraan yang sudah dipelajari).
- Dua ukuran sama dekat (minta 17, ada 16,5 dan 17,5) → `ukuran_seri`, bukan menebak.
- Setiap hasil membawa `reason_key`, `diff`, `attrs`, `lexicon_hits`. UI: tag alasan di baris, sub-filter alasan di bar saat filter "Cek dulu", chip beda spesifikasi per kandidat.

Data & pengukuran (`README/auto-konversi-queries.sql`):
- Q3 `kamus_token` + `get_kamus_token()`; refresh: `select refresh_kamus_token();` (ulangi berkala).
- Q4 `automatch_log` + `log_automatch()` + view `automatch_akurasi`. Tiap usulan dan keputusan staff tercatat
  (`diterima` / `diganti` / `ditolak`) lewat satu-satunya jalur tulis (`callUpdatePermintaanItemMulti`). Gagal log tidak mengganggu UI.
- `node auto-konversi/replay.mjs eval.json --katalog-saja` mengukur top-1/top-5 dan **AUTO yang salah** terhadap keputusan lama.
  Selalu pakai `--katalog-saja` untuk menilai item baru; tanpa itu hasil menggelembung karena riwayat berisi jawabannya.

Belum dikerjakan: layout tabel lebar (memakai area kiri yang kosong), review lewat keyboard, bulk-putuskan per kelompok alasan,
dan aturan kesetaraan ukuran yang dipelajari ("17 cm ≈ 17,5 cm") — butuh data `automatch_log` dulu.


### Temuan dari data nyata (hasil Q0–Q2) dan penyesuaiannya
- `search_produk_dengan_harga` hanya memberi hasil bersih bila SEMUA token query cocok (prefiks); jika satu saja tidak ada di katalog
  ("MAYO", atau "BL/BL" yang tidak ada), jatuh ke pencocokan sebagian yang berisik. Tangga query kini mulai dari tingkat **keluarga**
  (inti nama, lalu buang kata satu-satu), tanpa atribut; atribut dinilai di sisi kita. Baris yang diambil naik dari 8 ke 60 karena
  peringkat DB berbasis teks, bukan atribut.
- Katalog merek Jerman memakai MM untuk panjang ("PEAN FORCEPS CVD 140MM", "145 MM (5 3/4")"). mm tunggal ≥ 80 dibaca sebagai panjang (cm = mm/10).
- Kode ujung di katalog: `SH/SH`, `BL/BL`, `SH/BL`, `SHARP/SHARP`, `BLUNT/BLUNT`, `SHARP/BLUNT` — semuanya dinormalkan. `ANGLED` bentuk tersendiri (bukan CURVED).
- "bengkok" tanpa kata jenis lain (juga "bengkok sedang/besar", "bengkok 20 cm") = nama produk (nierbekken); "klem bengkok" = bentuk.
- Kamus lama berbasis nama produk utuh terlalu granular (mis. "KIDNEY DISH 250X140X40 MM"; "KORENTANG" terpecah ke 3 nama sponge forceps → share 0,33).
  Kini kamus berbasis **kata nama produk** (tanpa token berangka/satuan), hanya kata yang ada di ≥ 50% hasil keputusan dan tidak umum di katalog (> 6% nama).
  Item `is_junk`, produk non-aktif, dan SET tidak ikut.
- `suggest_dictionary` punya `p_exclude_item` → evaluasi leave-one-out (Q5 memuat `id`, `replay.mjs` memakainya).
