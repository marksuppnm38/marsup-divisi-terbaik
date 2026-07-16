// ==UserScript==
// @name         KFA Alkes Automation - Pionir Group
// @namespace    pionir-marsup
// @version      1.19
// @description  Bantu automasi masukin SKU ke cangkang + validasi KFA di kamus-alkes.kemkes.go.id
// @match        https://kamus-alkes.kemkes.go.id/*
// @grant        none
// ==/UserScript==
(function () {
  'use strict';
  // ============================================================
  // CARA PAKAI (baca dulu sebelum jalanin ke banyak SKU):
  // 1. Login manual seperti biasa ke kamus-alkes.kemkes.go.id
  // 2. Panel kecil bakal muncul di pojok kanan atas
  // 3. Paste data antrian di textarea, format TAB-separated:
  //      KODE_PRODUK <TAB> NIE <TAB> TKDN <TAB> BRAND
  //    (satu baris = satu SKU, cangkang-nya ditentuin manual per halaman
  //     yang lagi kamu buka -- script ini TIDAK pindah-pindah cangkang
  //     sendiri, karena assignment cangkang tetap keputusan kamu)
  // 4. WAJIB test 1 item dulu manual sebelum lanjut ke banyak SKU sekaligus,
  //    karena hasilnya masuk ke sistem KFA nasional -- kalau ada yang aneh,
  //    berhenti dan cek manual, jangan lanjut ke SKU berikutnya.
  // 5. Tombol "Validate" & "Save" TIDAK di-klik otomatis secara default,
  //    supaya kamu tetap review sebelum commit. Bisa diaktifkan di panel
  //    kalau kamu sudah yakin alurnya stabil.
  // 6. Kalau field autocomplete tertentu susah dibuka via script (mis. baris
  //    Tipe/Type yang widget-nya berat/reaktif), buka field itu MANUAL dulu
  //    (klik biasa pakai mouse sampai kotak inputnya beneran muncul), lalu
  //    isi kode SKU di kotak "Isi field yang lagi kebuka" di panel dan
  //    tekan Alt+Enter (lihat catatan di dalam kode) -- script cuma akan
  //    ngetikin & milih dari autocomplete-nya, bagian buka field tetap manual.
  // 7. PENTING buat Proses B: field "Type" di modal wizard cuma bisa milih
  //    kode yang UDAH TERDAFTAR sebagai value "Tipe (Type)" di sistem.
  //    Pastikan Proses A buat SKU itu udah SELESAI DAN KE-SAVE (bukan cuma
  //    keliatan di layar) sebelum jalanin Proses B buat SKU yang sama.
  //    Kalau nggak, wizard-nya bisa gagal isi Brand/Type -- script sekarang
  //    akan BERHENTI otomatis kalau itu kejadian (nggak lanjut klik Next),
  //    tapi tetap cek manual ke daftar produk buat mastiin nggak ada
  //    produk duplikat/kosong yang keburu kebuat sebelum fix ini dipasang.
  // 8. Kalau kamu MATIIN "Auto-klik Validate" (biar sempat cek manual dulu),
  //    setelah klik "Proses B" script bakal berhenti sebelum Validate dan
  //    NUNGGUIN kamu klik Validate manual sendiri. Begitu kamu klik Validate
  //    manual, script otomatis lanjut ambil kode KFA, Save (kalau auto-save
  //    dicentang), catat hasil, dan geser antrian.
  // 9. Proses B otomatis DETEKSI tombolnya: "Configure Product" (SKU
  //    pertama di cangkang ini) atau "Reconfigure Product" (cangkang ini
  //    udah pernah dikonfigurasi buat SKU lain -- modal langsung ke
  //    Brand/Type tanpa step pilih template). Script nyesuain sendiri.
  // 10. Centang "Auto-lanjut ke SKU berikutnya" kalau mau abis 1 SKU
  //     berhasil (dapet kode KFA valid), script LANGSUNG proses SKU
  //     berikutnya di antrian sendiri tanpa kamu klik apa-apa lagi. Kalau
  //     ada SKU yang GAGAL di tengah jalan, auto-lanjut ini BERHENTI
  //     otomatis (nggak maksa lanjut ke SKU berikutnya), biar kamu sempat
  //     cek manual dulu.
  // 11. Buat mindahin hasil ke Google Sheets: klik "Copy Hasil (TSV)" di
  //     panel -- ini nyalin daftar hasil (KODE_PRODUK, KODE_KFA, TIMESTAMP)
  //     ke clipboard dalam format tab-separated. Tinggal buka Sheets, klik
  //     cell kosong, Ctrl+V / Cmd+V -- otomatis kepecah per kolom & per
  //     baris kayak paste dari Excel. Kalau browser nolak akses clipboard
  //     otomatis, textarea "Preview hasil" di bawah tombol bakal muncul --
  //     select-all manual (klik textarea-nya, Ctrl+A, Ctrl+C) dari situ.
  // 12. (BARU v1.11) Website KFA ini basically Odoo yang berat -- tiap kali
  //     ada request ke server, biasanya muncul overlay abu-abu gelap
  //     ("blockUI") nutupin seluruh halaman sampai request-nya kelar. Ini
  //     WAJAR dan BUKAN error. Script sekarang otomatis NUNGGUIN overlay
  //     ini ilang (dan mastiin beneran ilang, bukan cuma kedip sebentar)
  //     sebelum lanjut ke langkah berikutnya, jadi nggak gampang "keburu"
  //     cek elemen yang belum siap. Prioritas sekarang BERHASIL, bukan
  //     CEPAT -- kalau internet/server lagi lemot, script bakal nungguin
  //     lebih lama daripada langsung nyerah.
  //
  // v1.3: Fix dropdown Brand di-portal keluar .modal (dicari via jarak ke
  //       input, isNearInput, bukan ancestry .modal).
  // v1.3.1: Fix Next kedua diklik sebelum enabled + nunggu modal beneran
  //       hilang sebelum lanjut cari tab.
  // v1.4: Fix kode KFA "/" ketangkep sebagai sukses -- sekarang wajib bukan
  //       placeholder kosong (isValidKfaCode) + watcher buat Validate manual.
  // v1.5: Fix Validate ketabrak tab Informasi Farmalkes (nunggu tombol
  //       Validate ilang dulu, bukan sleep tebakan) + dukungan tombol
  //       "Reconfigure Product".
  // v1.6: Tambah opsi "Auto-lanjut ke SKU berikutnya" -- abis 1 SKU sukses,
  //       otomatis proses SKU berikutnya di antrian sendiri (berhenti kalau
  //       ada yang gagal). Berlaku baik di jalur auto-validate maupun jalur
  //       Validate manual (watcher).
  // v1.7: Fix clickByText bisa nge-klik elemen "Validate" (atau tombol lain)
  //       yang SAMA TEKSNYA tapi lagi tersembunyi/disabled di DOM (umum di
  //       Odoo -- ada elemen duplikat state lain). Sekarang clickByText bisa
  //       difilter visibleOnly, dan alur Validate nunggu tombolnya beneran
  //       visible dulu (bukan asumsi siap begitu Get NIE selesai) sebelum
  //       diklik. Tombol Edit/Save/Get NIE/Configure-Reconfigure Product
  //       juga dipaksa visibleOnly biar nggak salah klik elemen tersembunyi.
  // v1.8: Fix lanjutan -- tombol Validate bisa KELIHATAN tapi masih
  //       DISABLED sesaat (nunggu field lain/hasil fetch Regalkes beres).
  //       Sekarang nunggu sampai tombolnya visible DAN enabled (bukan cuma
  //       visible) sebelum diklik. Kalau tetap disabled setelah 10 detik,
  //       script berhenti & print detail elemen + field yang invalid ke
  //       console (F12) biar gampang didiagnosis penyebabnya.
  // v1.9: Fix BESAR -- checkbox "Auto validate/Auto save/Auto-lanjut" balik
  //       ke UNCHECKED tiap kali panel digambar ulang (renderPanel() jalan
  //       berkali-kali di tengah proses: abis Save, abis geser antrian,
  //       dst), sehingga auto-lanjut berhenti diam-diam padahal user udah
  //       nyentang semuanya. Sekarang status ketiga checkbox disimpan di
  //       variabel terpisah (autoFlags) yang nggak ke-reset waktu panel
  //       digambar ulang, dan checkbox-nya sync dua arah ke variabel itu.
  // v1.10: Tambah opsi export hasil sebagai TEKS PASTEABLE (tab-separated)
  //       yang bisa langsung di-paste ke Google Sheets, sebagai alternatif
  //       download CSV. Tombol baru "Copy Hasil (TSV)" nyalin ke clipboard
  //       otomatis (navigator.clipboard, dengan fallback execCommand kalau
  //       clipboard API diblokir), plus textarea "Preview hasil" yang bisa
  //       di-select manual & Ctrl+C kalau copy otomatis gagal.
  // v1.11: FOKUS UTAMA -- ngatasin kegagalan yang sebenernya cuma soal
  //       loading Odoo yang berat/unpredictable (overlay "blockUI" abu-abu
  //       yang nutupin halaman pas ada request ke server), bukan error
  //       beneran. Perubahan:
  //       (a) Tambah deteksi blockUI (isBlockUIVisible) + waitForBlockUIClear
  //           yang nunggu overlay-nya ilang dan STABIL ilang (nggak keitung
  //           beres kalau cuma kedip sebentar di antara beberapa request
  //           yang berantai).
  //       (b) waitFor() inti sekarang "pause" hitungan timeout-nya selama
  //           blockUI aktif -- jadi waktu nunggu loading nggak lagi ikut
  //           makan jatah timeout & bikin dianggap gagal padahal cuma lemot.
  //       (c) Ditambahin settleAfterAction() yang dipanggil setelah klik2
  //           yang biasanya mancing request ke server (Edit, Next, Get NIE,
  //           Validate, Save, pindah tab) -- nunggu overlay muncul-hilang
  //           dulu sebelum script lanjut meriksa elemen berikutnya, biar
  //           nggak baca DOM yang lagi setengah jadi.
  //       (d) Step2 yang paling sering kena imbas timing (isi autocomplete
  //           Brand/Type/Tags, nunggu tombol Next/Validate siap) sekarang
  //           di-bungkus withRetry -- otomatis dicoba ulang 1-2x (nunggu
  //           blockUI beres dulu tiap retry) sebelum beneran nyerah &
  //           nyuruh cek manual.
  //       (e) Semua timeout utama dinaikin cukup jauh dari versi
  //           sebelumnya (lihat CONFIG di bawah) -- prioritasnya sekarang
  //           BERHASIL, bukan CEPAT, karena situs KFA emang lambat.
  //       (f) Nggak ada perubahan di logika keamanan/guardrail (auto-lanjut
  //           tetap berhenti kalau ada kegagalan asli, auto-validate/
  //           auto-save tetap default OFF, dst) -- yang berubah cuma cara
  //           script mengenali "masih loading" vs "beneran gagal".
  // v1.12: Tambah tombol "⏭ Skip SKU pertama di antrian" di panel. Kalau
  //       ada SKU yang mau dilewatin (misal ternyata invalid / mau dicek
  //       belakangan), user tinggal klik tombol ini -- SKU itu digeser
  //       keluar dari antrian (SAMA kayak kalau berhasil), TAPI dicatat di
  //       hasil dengan KODE_KFA = "SKIPPED_BY_USER" (bukan kode KFA asli),
  //       jadi kelihatan jelas di export CSV/TSV mana yang beneran
  //       berhasil vs mana yang di-skip manual. Ada konfirmasi (confirm
  //       dialog) dulu sebelum skip beneran jalan, biar nggak kepencet
  //       nggak sengaja. Kalau "Auto-lanjut ke SKU berikutnya" dicentang,
  //       setelah skip script otomatis lanjut ke SKU berikutnya di
  //       antrian (skip dianggap "selesai", bukan kegagalan).
  // v1.13: Fix KHUSUS buat Proses A -- widget many2many tag di baris
  //       "Tipe (Type)" ternyata KELIHATAN read-only kalau di-klik lewat
  //       container-nya (yang dipakai script sebelumnya), padahal manual
  //       harus klik PERSIS di kotak input TERAKHIR (posisinya setelah
  //       tag/chip yang udah ada) baru beneran ke-aktifin buat ngetik.
  //       Perubahan:
  //       (a) activateTagsInputForEditing() -- cari input PALING TERAKHIR
  //           di dalam widget INI SAJA (bukan query global, biar nggak
  //           kepencet input attribute/row lain), lalu kirim urutan event
  //           mouse lengkap (mousedown -> focus -> mouseup -> click),
  //           karena widget ini kadang cuma dengerin mousedown buat lepas
  //           dari state read-only-nya. Dibungkus withRetry -- kalau
  //           attempt pertama masih kebaca disabled/readonly, dicolek
  //           sekali lagi.
  //       (b) findAutocompleteTarget() -- SEBELUMNYA kalau nggak ada
  //           match persis, script asal pilih item PERTAMA di daftar
  //           autocomplete (items[0]). Ini BAHAYA karena bisa jadi fuzzy
  //           match yang salah, atau nyiptain tag baru ("Create "...")
  //           dengan teks yang beda dikit dari yang diminta -- dan tag
  //           itu bakal NEMPEL PERMANEN di sistem KFA nasional. Sekarang
  //           script CUMA mau lanjut kalau: (1) ada item yang isinya
  //           PERSIS sama kayak kode yang diminta, ATAU (2) ada opsi
  //           "Create "KODE_PERSIS_SAMA"" (dengan teks di dalam tanda
  //           kutip PERSIS sama). Di luar itu, script BERHENTI & minta
  //           cek manual -- nggak nebak-nebak lagi.
  //       (c) Log sekarang bilang jelas kalau script bakal BIKIN tag
  //           BARU (bukan milih yang udah ada), biar user sadar ini aksi
  //           yang nempel permanen ke sistem nasional.
  // v1.14: Fix lanjutan dari v1.13 setelah ketauan dari log console kalau
  //       widget many2many tag ini TERNYATA nggak punya <input> SAMA
  //       SEKALI di DOM sampai user klik PERSIS di celah kosong setelah
  //       tag terakhir -- input-nya baru di-render Odoo ON-DEMAND abis
  //       klik itu kena sasaran (v1.13 masih asumsi input-nya udah ada &
  //       cuma perlu "diaktifin", makanya tetep gagal). Sekarang:
  //       (a) Hitung titik koordinat yang tepat (sedikit di kanan tag
  //           terakhir, di baris yang sama; atau ujung kiri container
  //           kalau belum ada tag), lalu pakai document.elementFromPoint
  //           buat nemuin elemen ASLI di titik itu -- biar klik-nya
  //           seakurat mungkin kayak klik mouse beneran (bukan asal
  //           dispatch ke tagsField).
  //       (b) BARU SETELAH klik itu, di-waitFor (bukan sleep tebakan)
  //           sampai Odoo beneran ngerender <input> baru -- karena
  //           sebelumnya emang belum ada, jadi nggak ada gunanya dicek
  //           langsung sinkron.
  //       (c) Kalau tetap gagal, script nge-print titik koordinat +
  //           elemen yang kena klik ke console (F12), biar gampang
  //           didiagnosis kalau ternyata posisi klik-nya masih meleset.
  // v1.15: Fix bug NYATA yang ketauan dari log -- di attempt retry ke-2/3,
  //       titik klik yang dihitung jadi {x:-4, y:0} (jelas salah). Ini
  //       tandanya reference `tagsField` yang dipegang script udah STALE
  //       (ke-detach dari DOM) setelah attempt pertama, karena Owl/Odoo
  //       ngeganti total node widget many2many ini abis kena
  //       klik/interaksi apapun -- getBoundingClientRect() ke elemen yang
  //       udah detached selalu balikin rect kosong semua nol. Perubahan:
  //       (a) activateTagsInputForEditing() sekarang nerima `attributeRow`
  //           (elemen <tr>, jauh lebih jarang di-ganti-total sama Owl
  //           dibanding div widget di dalamnya) dan RE-QUERY tagsField
  //           dari situ SETIAP KALI dipanggil -- termasuk tiap retry --
  //           bukan pakai reference lama yang di-cache di luar.
  //       (b) Ditambah focus() langsung lewat JS API sebelum dispatch
  //           event mouse (focus() SELALU beneran jalan biarpun dipanggil
  //           dari script, beda sama dispatchEvent yang browser kadang
  //           nggak jalanin default action-nya kalau bukan event asli).
  //       (c) Ditambah dispatch PointerEvent (pointerdown/pointerup) di
  //           samping MouseEvent, plus detail:1 & button:0 di semua
  //           event -- buat jaga2 kalau widget-nya dengerin pointer event
  //           atau ngecek detail count, bukan cuma mouse event polos.
  //       (d) CATATAN JUJUR: kalau widget ini ternyata emang gantungin ke
  //           perilaku browser yang CUMA jalan buat klik mouse ASLI
  //           (trusted event) -- bukan buat event yang di-dispatch lewat
  //           script -- maka ini BATAS TEKNIS BROWSER yang nggak bisa
  //           ditembus dari sisi script manapun (ini bukan bug yang bisa
  //           di-fix lewat kode lagi). Kalau masih gagal setelah fix ini,
  //           jalur manual (klik PERSIS di kotak kosong + Alt+Enter, yang
  //           udah kebukti jalan) jadi jalur normal/permanen buat step
  //           ini, bukan lagi dianggap "sementara sampai ke-fix".
  // v1.16: Dua fix berdasarkan feedback abis Proses A beneran berhasil
  //       jalan (input + save manual jalan, tapi antrian nggak geser):
  //       (a) BUG NYATA -- tombol "Proses A" di panel SEBELUMNYA cuma
  //           manggil runProsesA() doang TANPA geser antrian sama sekali,
  //           jadi counter-nya nggak pernah maju walaupun SKU-nya beneran
  //           berhasil diinput. Sekarang ada processNextInQueueForProsesA()
  //           yang geser antrian abis sukses (persis kayak Proses B), plus
  //           "Auto-lanjut" (checkbox yang sama) sekarang juga berlaku
  //           buat Proses A -- abis 1 SKU sukses diinput sebagai tag,
  //           otomatis lanjut ke SKU berikutnya di antrian TANPA save di
  //           antaranya, cocok buat numpuk banyak SKU jadi tag ke
  //           cangkang yang sama.
  //       (b) Sesuai saran user -- save tiap 1 SKU itu boros (blockUI
  //           muncul tiap kali, Save-nya sendiri lemot). Auto-save
  //           SEKARANG DILEPAS dari Proses A -- Proses A cuma nambahin
  //           tag ke widget (belum di-save), checkbox "Auto-klik Save"
  //           sekarang CUMA berlaku buat Proses B. Ditambah tombol baru
  //           "💾 Save Sekarang" di panel buat commit SEMUA tag yang udah
  //           ketumpuk, dipencet SEKALI aja abis numpuk sebanyak yang
  //           diinginkan (bukan tiap 1 SKU).
  // v1.17: Disederhanain sesuai maunya user -- "input input input" terus
  //       otomatis, checkbox nggak perlu dipikirin lagi:
  //       (a) Proses A SEKARANG SELALU lanjut otomatis ke SKU berikutnya
  //           begitu satu SKU berhasil ditambah sebagai tag -- nggak
  //           gantung ke checkbox "Auto-lanjut" lagi (checkbox itu
  //           sekarang CUMA berlaku buat Proses B). Tombol "Proses A" di
  //           panel diklik SEKALI, terus dia jalan sampai antrian abis
  //           atau ketemu kegagalan ASLI (bukan duplikat).
  //       (b) DETEKSI DUPLIKAT -- Proses A itu sendiri nggak pernah
  //           munculin modal/window apapun di alur normalnya. Jadi kalau
  //           ADA window/dialog kelihatan abis kita milih tag (mis. abis
  //           milih opsi "Create"), itu dianggap SINYAL DUPLIKAT (kode
  //           udah kepake/terdaftar). SKU itu otomatis di-SKIP (dicatat
  //           di hasil sebagai SKIPPED_DUPLICATE, BUKAN kode KFA asli),
  //           dialognya ditutup, terus halaman di-REFRESH (soalnya widget
  //           yang abis ketimpuk dialog error suka nyangkut & susah
  //           dipulihin tanpa refresh) -- dan abis refresh, script
  //           OTOMATIS lanjut lagi dari SKU berikutnya di antrian (nggak
  //           perlu klik apa2), lewat flag AUTORESUME_PROSES_A_KEY yang
  //           dibaca pas script mulai jalan ulang.
  //       (c) CATATAN: selector modal-nya (`.modal.show, .o_dialog, ...`)
  //           masih tebakan umum karena bentuk PERSIS window duplikatnya
  //           belum pernah dilihat -- kalau ternyata beda / nggak
  //           kedetect, share HTML-nya biar bisa disesuaikan presisi.
  //       (d) Auto-save (kalau dicentang) sekarang jalan SEKALI aja abis
  //           SELURUH antrian abis diproses (bukan per-item, bukan juga
  //           harus diklik manual) -- "centang Auto-save, klik Proses A,
  //           selesai".
  // v1.18: Fix BUG NYATA yang ketauan dari log batch: SKU pertama sukses
  //       (tag ketambah, antrian digeser), tapi SKU KEDUA langsung gagal
  //       dengan pesan "Tombol Edit nggak ketemu". Penyebabnya: Proses A
  //       SENGAJA nggak Save di antara SKU (biar bisa numpuk banyak tag
  //       dulu), jadi abis SKU pertama, form-nya MASIH dalam mode EDIT --
  //       tombol "Edit" udah nggak ada lagi (kegantiin Save/Discard), tapi
  //       kode sebelumnya SELALU maksa nyari tombol Edit di awal setiap
  //       SKU dan langsung nganggep gagal kalau nggak ketemu. Sekarang:
  //       kalau tombol Edit nggak ketemu, dicek dulu apa form-nya emang
  //       udah dalam mode edit (Save/Discard kelihatan) -- kalau iya,
  //       dianggap WAJAR (lanjutan dari SKU sebelumnya di batch yang
  //       sama), bukan kegagalan, dan proses lanjut seperti biasa tanpa
  //       klik Edit lagi.
  // v1.19: Fokus permintaan user: (1) di cangkang yang crowded/lemot,
  //       Proses A jangan gampang nyerah -- perbanyak & perpanjang retry
  //       KHUSUS buat langkah widget many2many "Tipe (Type)" (paling
  //       sering keserempet overlay loading), termasuk pencarian tabel
  //       attribute-nya sendiri (sebelumnya cuma 1x percobaan tanpa
  //       retry). (2) Auto-save tiap N SKU (default 5) SELAMA Proses A
  //       jalan -- jaga-jaga kalau cangkang lemot/nyangkut di tengah
  //       jalan, progress yang udah ketumpuk nggak ilang percuma. Kalau
  //       Proses A berhenti karena kegagalan ASLI, dan ada tag yang belum
  //       ke-save, script SEKARANG otomatis nyoba Save dulu sebelum
  //       beneran berhenti (safety-save), supaya kegagalan di SKU
  //       terakhir nggak nge-buang progress SKU-SKU sebelumnya yang udah
  //       benar. (3) Tombol "⏹ Stop" buat interupsi batch yang lagi
  //       jalan secara aman (nunggu step yang lagi jalan kelar dulu, baru
  //       berhenti -- bukan potong di tengah aksi). (4) STATUS BAR hidup
  //       di panel (titik berdenyut + teks + hitungan detik sejak
  //       aktivitas terakhir) yang di-update tiap 500ms LEPAS dari
  //       eksekusi script -- ini jawaban buat "bingung ini jalan apa
  //       nggak pas KFA-nya lemot": kalau overlay loading kedetect,
  //       status bar bilang jelas "server lagi loading (wajar)"; kalau
  //       nggak ada overlay tapi juga nggak ada log baru lebih dari 30
  //       detik, baru dikasih tau "mungkin macet, cek console". Ini
  //       murni indikator visual, TIDAK mengubah logika retry/timeout
  //       yang udah ada.
  // ============================================================
  const STORAGE_KEY = 'kfa_automation_queue_v1';
  const RESULTS_KEY = 'kfa_automation_results_v1';
  // v1.17: flag buat nandain "abis reload ini, lanjutin Proses A otomatis"
  // -- dipasang sesaat sebelum location.reload() pas ketemu duplikat, dan
  // dibaca+dihapus lagi pas script mulai jalan ulang abis reload.
  const AUTORESUME_PROSES_A_KEY = 'kfa_autoresume_prosesA_v1';
  // ---------- Konfigurasi (v1.11) ----------
  // Semua angka di sini bisa diubah kalau perlu -- dinaikin dari versi
  // sebelumnya karena prioritas sekarang "pasti berhasil" bukan "cepat".
  const CONFIG = {
    BLOCKUI_STABLE_MS: 500,       // overlay harus ilang STABIL segini lama baru dianggap beres
    BLOCKUI_MAX_WAIT_MS: 45000,   // maksimal nungguin overlay ilang sebelum nyerah & minta cek manual
    AUTOCOMPLETE_TIMEOUT_MS: 20000,
    MODAL_TIMEOUT_MS: 20000,
    NEXT_BUTTON_TIMEOUT_MS: 20000,
    VALIDATE_VISIBLE_TIMEOUT_MS: 25000,
    VALIDATE_ENABLED_TIMEOUT_MS: 25000,
    VALIDATE_DONE_TIMEOUT_MS: 30000,
    KFA_CODE_TIMEOUT_MS: 30000,
    MANUAL_VALIDATE_TIMEOUT_MS: 300000, // nungguin user klik Validate manual (5 menit, sama kayak sebelumnya)
    RETRY_COUNT: 2, // berapa kali retry otomatis buat step2 yang rawan ketiban loading
    // v1.19: retry KHUSUS Proses A (widget "Tipe (Type)" + tabel
    // attribute-nya) -- dibikin lebih gigih daripada RETRY_COUNT umum,
    // karena ini step yang paling sering keserempet cangkang crowded.
    PROSES_A_RETRY_COUNT: 5,
    PROSES_A_TABLE_TIMEOUT_MS: 30000,
    // v1.19: auto-save tiap sekian SKU sukses selama Proses A jalan, biar
    // kalau di tengah batch cangkangnya nyangkut/lemot parah, progress
    // yang udah ketumpuk nggak ilang percuma.
    PROSES_A_AUTOSAVE_EVERY: 5,
    // v1.19: ambang "dianggap mungkin macet" di status bar kalau nggak
    // ada log baru & nggak ada overlay loading yang kedetect.
    STATUS_STALL_WARNING_MS: 30000,
  };
  // ---------- v1.19: status hidup buat panel (jawaban "jalan apa nggak") ----------
  // scriptStatus di-update tiap ada log() atau tiap ganti tahap proses.
  // updateStatusBar() jalan lewat setInterval TERPISAH dari eksekusi
  // script utama, jadi walaupun lagi nungguin overlay/loading lama,
  // status bar tetap "hidup" & ngasih tau kondisi terkini -- bukan cuma
  // diem kayak nggak ada apa2 yang kejadian.
  let scriptStatus = { running: false, label: 'Idle', sku: null, lastActivity: Date.now() };
  let stopRequested = false;
  function setStatus(label, sku) {
    scriptStatus.running = true;
    scriptStatus.label = label;
    if (sku !== undefined) scriptStatus.sku = sku;
    scriptStatus.lastActivity = Date.now();
    updateStatusBar();
  }
  function setIdle(label = 'Idle') {
    scriptStatus.running = false;
    scriptStatus.label = label;
    scriptStatus.sku = null;
    scriptStatus.lastActivity = Date.now();
    updateStatusBar();
  }
  function updateStatusBar() {
    const dot = document.getElementById('kfa-status-dot');
    const text = document.getElementById('kfa-status-text');
    if (!dot || !text) return;
    const secs = Math.floor((Date.now() - scriptStatus.lastActivity) / 1000);
    const blocked = isBlockUIVisible();
    let color = '#999';
    let msg;
    if (!scriptStatus.running) {
      color = '#999';
      msg = `⏸ ${scriptStatus.label}`;
    } else if (blocked) {
      color = '#ffc107';
      msg = `⏳ Server KFA lagi loading (overlay kedetect) -- wajar, nunggu aja...`;
    } else if (secs > CONFIG.STATUS_STALL_WARNING_MS / 1000) {
      color = '#dc3545';
      msg = `⚠️ Nggak ada aktivitas ${secs}d & nggak ada overlay loading -- mungkin macet, cek Log/Console (F12)`;
    } else {
      color = '#28a745';
      msg = `🟢 Jalan (${scriptStatus.label}) -- aktivitas terakhir ${secs}d lalu`;
    }
    if (scriptStatus.sku) msg += ` | SKU: ${scriptStatus.sku}`;
    dot.style.color = color;
    dot.style.textShadow = scriptStatus.running ? `0 0 6px ${color}` : 'none';
    text.textContent = msg;
    text.style.color = color;
  }
  setInterval(updateStatusBar, 500);
  // ---------- Helpers ----------
  function log(msg) {
    scriptStatus.lastActivity = Date.now();
    const box = document.getElementById('kfa-log');
    if (box) {
      const line = document.createElement('div');
      line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
      box.prepend(line);
    }
    console.log('[KFA-AUTO]', msg);
    updateStatusBar();
  }
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  // v1.11: waitFor sekarang "pause" hitungan timeout selama blockUI aktif.
  // Sebelumnya, kalau server lemot & overlay muncul lama, waktu itu ikut
  // kepotong dari jatah timeout -- jadi step yang sebenernya cuma lemot
  // gampang ke-anggap gagal. Sekarang waktu blockUI aktif nggak dihitung.
  function waitFor(checkFn, { timeout = 8000, interval = 150, pauseOnBlockUI = true } = {}) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      let blockedAccum = 0;
      let lastTick = Date.now();
      const timer = setInterval(() => {
        const now = Date.now();
        const dt = now - lastTick;
        lastTick = now;
        if (pauseOnBlockUI && isBlockUIVisible()) {
          blockedAccum += dt;
          return; // lagi loading -- jangan dulu evaluasi checkFn, jangan dulu itung ke timeout
        }
        let result;
        try {
          result = checkFn();
        } catch (e) {
          result = null;
        }
        if (result) {
          clearInterval(timer);
          resolve(result);
        } else if (now - start - blockedAccum > timeout) {
          clearInterval(timer);
          reject(new Error('waitFor timeout: ' + checkFn.toString().slice(0, 80)));
        }
      }, interval);
    });
  }
  // v1.17: deteksi window/modal/dialog yang NGGAK DIHARAPKAN muncul di
  // tengah Proses A. Proses A itu sendiri emang nggak pernah munculin
  // modal apapun di alur normalnya (beda sama Proses B yang punya wizard
  // modal Configure/Reconfigure Product) -- jadi kalau ADA modal/dialog
  // kelihatan abis kita milih tag, itu paling mungkin window error/
  // konflik dari Odoo (mis. kode yang mau dibikin ternyata udah ada /
  // duplikat). Selector-nya sengaja digeneralisir (bootstrap .modal.show
  // ATAU Owl .o_dialog) karena bentuk pastinya belum diketahui -- kalau
  // ternyata beda, gampang disesuaikan di sini.
  function getUnexpectedModals() {
    const modals = document.querySelectorAll('.modal.show, .o_dialog, .modal[style*="display: block"], .modal[style*="display:block"]');
    return Array.from(modals).filter(isVisible);
  }
  function isUnexpectedModalVisible() {
    return getUnexpectedModals().length > 0;
  }
  function getUnexpectedModalText() {
    const modals = getUnexpectedModals();
    if (!modals.length) return '';
    return modals[0].textContent.replace(/\s+/g, ' ').trim().slice(0, 300);
  }
  function dismissUnexpectedModal() {
    const modals = getUnexpectedModals();
    if (!modals.length) return false;
    const modal = modals[0];
    // Cari tombol yang KELIHATAN di dalam modal ini (biasanya "Ok" /
    // "Close" / "Tutup") -- ambil yang pertama ketemu.
    const btn = Array.from(modal.querySelectorAll('button')).find((b) => isVisible(b));
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  }
  // v1.11: deteksi overlay loading "blockUI" (dipakai jQuery BlockUI plugin,
  // umum di Odoo). Nggak pakai isVisible() biasa karena overlay ini kadang
  // computed style-nya "aneh" (mis. opacity di-set lewat inline style tapi
  // display tetap block) -- di sini kita cek langsung display/visibility +
  // ukuran elemen di layar.
  function isBlockUIVisible() {
    const overlays = document.querySelectorAll('.blockUI.blockOverlay, .blockUI, .o_blockUI');
    return Array.from(overlays).some((el) => {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
  }
  // v1.11: nungguin overlay blockUI ilang, dan mastiin dia ilang STABIL
  // (nggak keitung beres kalau cuma kedip bentar di antara beberapa request
  // yang nembak berantai -- pola ini sering kejadian pas Odoo ngerjain
  // beberapa RPC beruntun buat satu aksi user).
  async function waitForBlockUIClear({
    timeout = CONFIG.BLOCKUI_MAX_WAIT_MS,
    stableFor = CONFIG.BLOCKUI_STABLE_MS,
    logIfWaiting = true,
  } = {}) {
    const start = Date.now();
    let clearSince = null;
    let loggedWaiting = false;
    while (Date.now() - start < timeout) {
      if (!isBlockUIVisible()) {
        if (!clearSince) clearSince = Date.now();
        if (Date.now() - clearSince >= stableFor) return true;
      } else {
        if (logIfWaiting && !loggedWaiting) {
          log('⏳ Halaman lagi loading (overlay blockUI kedetect)... nungguin beres dulu sebelum lanjut, ini wajar & bukan error.');
          loggedWaiting = true;
        }
        clearSince = null;
      }
      await sleep(150);
    }
    return false;
  }
  // v1.11: dipanggil setelah aksi yang biasanya mancing request ke server
  // (Edit, Next, Get NIE, Validate, Save, pindah tab). Kasih jeda dikit
  // dulu (siapa tau overlay-nya baru mau muncul), lalu nungguin sampai
  // beneran clear, biar step berikutnya nggak baca DOM yang lagi
  // setengah jadi / stale.
  async function settleAfterAction(label = '') {
    await sleep(200);
    const cleared = await waitForBlockUIClear();
    if (!cleared) {
      log(`⚠️ Overlay loading nggak ilang2 setelah ditunggu lama${label ? ` (setelah "${label}")` : ''}. Kemungkinan halaman nyangkut / request gagal diam-diam / koneksi lemot banget. Cek manual, jangan lanjut otomatis.`);
    }
    return cleared;
  }
  // v1.11: bungkus step2 yang paling rawan ketiban timing/loading (isi
  // autocomplete, nunggu tombol siap, dst) -- kalau attempt pertama gagal,
  // nunggu blockUI beres dulu, kasih jeda, terus coba lagi (maksimal
  // CONFIG.RETRY_COUNT kali) sebelum beneran dianggap gagal. Ini BUKAN
  // buat nutupin error asli -- kalau emang gagal terus setelah semua
  // retry, tetap dianggap gagal & alur normal (berhenti, minta cek
  // manual) tetap jalan seperti biasa.
  async function withRetry(fn, { retries = CONFIG.RETRY_COUNT, label = 'step' } = {}) {
    let lastResult = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) {
        log(`🔁 Retry ${attempt}/${retries} buat "${label}" (kemungkinan attempt sebelumnya ketiban loading/overlay)...`);
        await waitForBlockUIClear();
        await sleep(400);
      }
      try {
        lastResult = await fn();
      } catch (e) {
        console.log(`[KFA-AUTO] Error di step "${label}" (attempt ${attempt}):`, e);
        lastResult = null;
      }
      if (lastResult) return lastResult;
    }
    return lastResult;
  }
  function isValidKfaCode(text) {
    if (!text) return false;
    const t = text.trim();
    if (!t) return false;
    if (t === '/' || t === '-' || t === '—') return false;
    return true;
  }
  function hasVisibleValidateButton() {
    const spans = Array.from(document.querySelectorAll('span'));
    return spans.some((el) => el.textContent.trim() === 'Validate' && isVisible(el));
  }
  // v1.8: cari elemen tombol Validate (bukan cuma span-nya) supaya bisa
  // dicek statusnya "disabled" beneran, bukan cuma "kelihatan".
  function getVisibleValidateButtonEl() {
    const spans = Array.from(document.querySelectorAll('span'));
    const match = spans.find((el) => el.textContent.trim() === 'Validate' && isVisible(el));
    if (!match) return null;
    return match.closest('button') || match;
  }
  function isBtnDisabled(el) {
    return !!(el.disabled || el.classList?.contains('disabled') || el.classList?.contains('o_disabled')
      || el.getAttribute?.('aria-disabled') === 'true');
  }
  function setNativeValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) {
      setter.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  // v1.7: tambah opsi { visibleOnly } supaya kita nggak salah klik elemen
  // ber-teks sama yang lagi disembunyiin/disabled di DOM (umum di Odoo).
  function clickByText(selector, text, { visibleOnly = false } = {}) {
    const norm = (s) => s.replace(/\s+/g, ' ').trim();
    const target = norm(text);
    let els = Array.from(document.querySelectorAll(selector));
    if (visibleOnly) {
      els = els.filter((el) => isVisible(el.closest('button') || el));
    }
    let match = els.find((el) => norm(el.textContent) === target);
    if (!match) {
      match = els.find((el) => norm(el.textContent).includes(target));
    }
    if (!match) return false;
    const clickTarget = match.closest('button') || match;
    if (clickTarget.disabled || clickTarget.classList?.contains('disabled')) return false;
    clickTarget.click();
    return true;
  }
  // v1.18: cek doang (TANPA nge-klik) apakah ada tombol dengan teks
  // tertentu yang kelihatan -- dipakai buat ngecek "lagi dalam mode edit
  // apa nggak" (tombol Save/Discard kelihatan = lagi edit) tanpa resiko
  // nge-klik sesuatu yang nggak diinginkan.
  function hasVisibleButtonText(selector, text) {
    const norm = (s) => s.replace(/\s+/g, ' ').trim();
    const target = norm(text);
    const els = Array.from(document.querySelectorAll(selector));
    return els.some((el) => {
      const t = norm(el.textContent);
      return (t === target || t.includes(target)) && isVisible(el.closest('button') || el);
    });
  }
  function collectCandidateMenus(root = document) {
    const selectors = [
      '.ui-autocomplete',
      '.ui-autocomplete-menu',
      '.o-autocomplete--dropdown-menu',
      '.o_input_dropdown_container .dropdown-menu',
      '.dropdown-menu',
      '[role="listbox"]',
      '[role="menu"]',
    ];
    return new Set(root.querySelectorAll(selectors.join(',')));
  }
  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
  function isNearInput(el, inputEl, maxDist = 400) {
    const r = el.getBoundingClientRect();
    const ir = inputEl.getBoundingClientRect();
    const vGap = Math.min(Math.abs(r.top - ir.bottom), Math.abs(ir.top - r.bottom));
    return vGap < maxDist;
  }
  // v1.13: SEBELUMNYA kalau nggak ada match persis di daftar autocomplete,
  // script asal milih item PERTAMA (items[0]). Itu bahaya -- bisa kepencet
  // fuzzy match yang salah, atau nyiptain tag baru ("Create "...") dengan
  // teks yang beda dikit dari yang diminta, dan tag itu NEMPEL PERMANEN
  // di sistem KFA nasional. Sekarang cuma ada 2 kondisi yang diterima:
  // (1) ada item yang isinya PERSIS sama kayak `text`, atau
  // (2) ada opsi "Create "TEKS_PERSIS_SAMA"" -- ini valid buat Proses A
  //     (kode SKU emang belum terdaftar & harus dibikin baru), TAPI cuma
  //     diterima kalau teks di dalam kutipnya PERSIS sama, biar nggak
  //     kepencet bikin tag dengan typo.
  // Di luar 2 kondisi itu, return null -- caller HARUS berhenti & minta
  // cek manual, bukan nebak-nebak.
  function findAutocompleteTarget(items, text) {
    const norm = (s) => s.replace(/\s+/g, ' ').trim();
    const exact = items.find((li) => norm(li.textContent) === text);
    if (exact) return { target: exact, isCreate: false };
    const createExact = items.find((li) => {
      const t = norm(li.textContent);
      return t === `Create "${text}"` || t === `Create "${text}"...` || t === `Buat "${text}"`;
    });
    if (createExact) return { target: createExact, isCreate: true };
    return { target: null, isCreate: false };
  }
  // v1.13/v1.14: Aktifin input "nambah tag baru" di widget many2many_tags
  // Odoo (mis. baris "Tipe (Type)"). PENTING (ketauan dari log console):
  // widget ini TIDAK punya <input> di DOM sama sekali sampai user klik
  // PERSIS di celah kosong SETELAH tag/chip terakhir -- input-nya baru
  // di-render Odoo ON-DEMAND abis klik itu kena sasaran. Jadi:
  // 1) Cari titik koordinat yang tepat: sedikit di sebelah kanan tag
  //    terakhir, di baris (row) yang sama -- ini konvensi Odoo
  //    many2many_tags, kalau nggak ada tag sama sekali klik di ujung
  //    kiri container.
  // 2) Pakai document.elementFromPoint(x, y) buat nemuin elemen ASLI di
  //    titik itu (bukan asal dispatch ke tagsField), biar klik-nya
  //    seakurat mungkin kayak klik mouse beneran -- soalnya kemungkinan
  //    widget ini ngecek posisi klik (bukan cuma target/type event) buat
  //    mutusin apa masuk mode edit atau nggak.
  // 3) Kirim urutan event mouse LENGKAP (mousedown -> mouseup -> click)
  //    di titik itu.
  // 4) BARU SETELAH klik, tunggu (waitFor, bukan sleep tebakan) sampai
  //    Odoo beneran nge-render <input> baru di dalam widget ini -- karena
  //    input-nya emang nggak ada sebelum klik, jadi nggak ada gunanya
  //    dicek langsung sinkron kayak versi sebelumnya.
  function getLastTagsInput(tagsField) {
    const candidates = Array.from(
      tagsField.querySelectorAll('input[type="text"], input.ui-autocomplete-input, input.o_input')
    );
    return candidates[candidates.length - 1] || null;
  }
  function computeTagsClickPoint(tagsField) {
    const containerRect = tagsField.getBoundingClientRect();
    const badges = Array.from(tagsField.querySelectorAll('.badge, .o_tag'));
    const lastBadge = badges[badges.length - 1];
    if (lastBadge) {
      const r = lastBadge.getBoundingClientRect();
      // Klik tepat di sebelah kanan tag terakhir, di baris yang sama --
      // dibatasin biar nggak keluar dari lebar container (kalau tag
      // terakhir udah mepet ujung kanan).
      const x = Math.min(r.right + 8, containerRect.right - 4);
      const y = r.top + r.height / 2;
      return { x, y };
    }
    // Belum ada tag sama sekali -- klik aja di ujung kiri container.
    return { x: containerRect.left + 8, y: containerRect.top + containerRect.height / 2 };
  }
  async function activateTagsInputForEditing(attributeRow) {
    // v1.14b: SELALU re-query tagsField yang FRESH dari attributeRow tiap
    // kali fungsi ini dipanggil (termasuk tiap retry) -- JANGAN pakai
    // reference lama yang di-cache di luar, karena Owl/Odoo bisa
    // ngeganti total node div widget ini abis interaksi apapun.
    const tagsField = attributeRow.querySelector('.o_field_many2manytags, .o_field_widget[name="value_ids"]');
    if (!tagsField || !tagsField.isConnected) {
      log('⚠️ Widget tag "Tipe (Type)" nggak ketemu lagi di baris ini (mungkin abis di-render ulang sama halamannya). Cek manual.');
      return null;
    }
    // Kalau kebetulan input-nya UDAH ada & aktif (mis. sisa dari attempt
    // sebelumnya), langsung pakai -- nggak perlu klik ulang.
    let input = getLastTagsInput(tagsField);
    if (input && !input.disabled && !input.readOnly) {
      input.focus();
      return input;
    }
    const { x, y } = computeTagsClickPoint(tagsField);
    const clickTarget = document.elementFromPoint(x, y) || tagsField;
    // v1.14b: coba beberapa cara "ngebuka" widget ini sekaligus dalam
    // satu attempt, karena kita nggak tau pasti widget ini dengerin apa
    // (click biasa? pointer event? butuh fokus dulu baru klik?):
    // 1) focus() langsung lewat JS API (INI SELALU jalan beneran, nggak
    //    kayak dispatchEvent yang kadang nggak trigger default action
    //    browser -- jadi kalau elemen/ancestor-nya focusable, ini paling
    //    reliable).
    if (typeof clickTarget.focus === 'function') {
      clickTarget.focus();
    }
    // 2) Urutan pointer + mouse event lengkap, detail:1 (biar kebaca
    //    sebagai "klik asli ke-1" oleh handler yang ngecek e.detail),
    //    di titik koordinat yang bener.
    const fire = (Ctor, type) => clickTarget.dispatchEvent(new Ctor(type, {
      bubbles: true, cancelable: true, composed: true, view: window,
      clientX: x, clientY: y, button: 0, detail: 1,
    }));
    try { fire(PointerEvent, 'pointerdown'); } catch (e) { /* browser lama tanpa PointerEvent */ }
    fire(MouseEvent, 'mousedown');
    try { fire(PointerEvent, 'pointerup'); } catch (e) { /* no-op */ }
    fire(MouseEvent, 'mouseup');
    fire(MouseEvent, 'click');
    // Input-nya baru muncul SETELAH klik ini (kalau berhasil) -- jadi
    // WAJIB ditunggu (bukan sleep tebakan), karena Odoo ngerender-nya
    // on-demand.
    input = await waitFor(() => getLastTagsInput(attributeRow.querySelector('.o_field_many2manytags, .o_field_widget[name="value_ids"]') || tagsField), {
      timeout: CONFIG.AUTOCOMPLETE_TIMEOUT_MS,
    }).catch(() => null);
    if (!input) {
      log('⚠️ Klik di celah kosong setelah tag terakhir belum berhasil mancing input baru muncul. Titik yang diklik script saya print ke console (F12) beserta elemen yang kena.');
      console.log('[KFA-AUTO] Titik klik:', { x, y }, '| Elemen yang kena (elementFromPoint):', clickTarget);
      console.log('[KFA-AUTO] HTML widget tags saat ini:', tagsField.outerHTML.slice(0, 800));
      return null;
    }
    input.focus();
    if (input.disabled || input.readOnly) {
      return null;
    }
    return input;
  }
  async function fillAutocomplete(inputEl, text) {
    // v1.11: mastiin nggak lagi ada overlay loading sebelum mulai ngetik --
    // banyak kegagalan "autocomplete nggak muncul" sebenernya karena widget
    // many2many-nya masih proses render/fetch pas kita udah mulai ngetik.
    await waitForBlockUIClear({ logIfWaiting: false });
    inputEl.focus();
    const before = collectCandidateMenus(document);
    setNativeValue(inputEl, text);
    inputEl.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: text.slice(-1) }));
    inputEl.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: text.slice(-1) }));
    let menu = await waitFor(() => {
      const m = document.querySelector('.ui-autocomplete:not([style*="display: none"]), .ui-autocomplete-menu:not([style*="display: none"])');
      return m && m.querySelectorAll('li').length && isNearInput(m, inputEl) ? m : null;
    }, { timeout: CONFIG.AUTOCOMPLETE_TIMEOUT_MS }).catch(() => null);
    if (!menu) {
      menu = await waitFor(() => {
        const now = collectCandidateMenus(document);
        for (const el of now) {
          if (!before.has(el) && isVisible(el) && isNearInput(el, inputEl)
              && el.querySelectorAll('li, [role="option"], .dropdown-item').length) {
            return el;
          }
        }
        return null;
      }, { timeout: CONFIG.AUTOCOMPLETE_TIMEOUT_MS }).catch(() => null);
    }
    if (!menu) {
      log(`⚠️ Autocomplete nggak muncul buat "${text}" -- cek manual.`);
      const candidates = Array.from(collectCandidateMenus(document));
      console.log('[KFA-AUTO] Nggak nemu menu autocomplete. Kandidat elemen dropdown di document:');
      candidates.forEach((el, i) => {
        const r = el.getBoundingClientRect();
        console.log(`[KFA-AUTO] Candidate ${i}: rect=`, r, 'visible=', isVisible(el), el.outerHTML.slice(0, 300));
      });
      console.log('[KFA-AUTO] Input yang lagi diisi:', inputEl, '| value sekarang:', inputEl.value, '| rect:', inputEl.getBoundingClientRect());
      return false;
    }
    const items = Array.from(menu.querySelectorAll('li, [role="option"], .dropdown-item'));
    const { target, isCreate } = findAutocompleteTarget(items, text);
    if (!target) {
      log(`⚠️ Nggak nemu item autocomplete yang PERSIS cocok buat "${text}" (bukan exact match, bukan juga opsi "Create" dengan teks persis sama) -- script SENGAJA berhenti di sini daripada nebak, biar nggak salah pilih/nyiptain tag yang salah. Daftar opsi yang muncul saya print ke console (F12).`);
      console.log(`[KFA-AUTO] Opsi autocomplete yang muncul buat "${text}":`, items.map((li) => li.textContent.trim()));
      return false;
    }
    if (isCreate) {
      log(`📌 "${text}" belum terdaftar -- script bakal BIKIN tag/value BARU dengan teks ini (nempel permanen ke sistem KFA nasional). Kalau ini nggak diinginkan, batalin/cek manual sekarang.`);
    }
    (target.querySelector('a') || target).click();
    // v1.11: milih item dari autocomplete kadang mancing RPC kecil
    // (misalnya validasi tag baru) -- kasih kesempatan overlay itu
    // muncul-hilang sebelum kita anggap step ini beres.
    await settleAfterAction(`pilih "${text}" dari autocomplete`);
    return true;
  }
  let lastFocusedInput = null;
  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (
      el && el.tagName === 'INPUT' && el.type === 'text' &&
      !el.disabled && !el.readOnly &&
      !el.closest('#kfa-panel')
    ) {
      lastFocusedInput = el;
    }
  }, true);
  function loadQueue() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch {
      return [];
    }
  }
  function saveQueue(q) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(q));
  }
  function loadResults() {
    try {
      return JSON.parse(localStorage.getItem(RESULTS_KEY) || '[]');
    } catch {
      return [];
    }
  }
  function saveResults(r) {
    localStorage.setItem(RESULTS_KEY, JSON.stringify(r));
  }
  // ============================================================
  // PROSES A
  // ============================================================
  async function runProsesA(kodeProduk) {
    log(`Proses A: masukin "${kodeProduk}" ke cangkang...`);
    setStatus('Proses A: buka form / cek mode edit', kodeProduk);
    // v1.18: FIX BUG -- sebelumnya di sini SELALU maksa ada tombol "Edit"
    // buat diklik. Itu keliru buat SKU ke-2/3/dst dalam satu batch,
    // karena Proses A SENGAJA nggak Save di antara SKU (numpuk banyak
    // tag dulu baru Save di akhir) -- jadi form-nya masih dalam mode
    // EDIT dari SKU sebelumnya, dan tombol "Edit" udah nggak ada lagi
    // (kegantiin Save/Discard). Sekarang: kalau tombol Edit ketemu,
    // klik seperti biasa; kalau nggak ketemu TAPI ternyata form udah
    // dalam mode edit (Save/Discard kelihatan), anggap itu WAJAR --
    // lanjutin aja, JANGAN dianggap gagal.
    if (clickByText('button', 'Edit', { visibleOnly: true })) {
      await settleAfterAction('klik Edit');
    } else {
      const alreadyEditing = hasVisibleButtonText('button', 'Save') || hasVisibleButtonText('button', 'Discard');
      if (!alreadyEditing) {
        log('⚠️ Tombol Edit nggak ketemu, dan form ini kelihatannya juga BUKAN lagi dalam mode edit. Pastikan kamu di halaman cangkang (tab Variants) dulu.');
        return false;
      }
      log('ℹ️ Tombol Edit nggak ada, tapi form ini emang udah dalam mode edit (lanjutan numpuk tag dari SKU sebelumnya di batch ini) -- lanjut tanpa klik Edit lagi.');
    }
    document.activeElement?.blur();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.body.click();
    await sleep(300);
    // v1.19: SEBELUMNYA pencarian tabel attribute ini cuma 1x percobaan
    // (waitFor biasa, langsung nyerah kalau timeout). Di cangkang yang
    // crowded/lemot ini ternyata bisa telat render cukup lama -- jadi
    // sekarang dibungkus withRetry (PROSES_A_RETRY_COUNT kali) dengan
    // timeout yang lebih panjang per percobaan, plus log progres tiap
    // retry biar user tau ini masih "nyoba", bukan diem/macet.
    setStatus('Proses A: nyari tabel attribute (Variants)', kodeProduk);
    const attributeTable = await withRetry(() => waitFor(() => {
      const tables = Array.from(document.querySelectorAll('table'));
      return (
        tables.find((table) => {
          const headerText = table.querySelector('thead')?.textContent.toLowerCase()
            || table.rows[0]?.textContent.toLowerCase()
            || '';
          return headerText.includes('attribute') && headerText.includes('value');
        }) || null
      );
    }, { timeout: CONFIG.PROSES_A_TABLE_TIMEOUT_MS }).catch(() => null), {
      retries: CONFIG.PROSES_A_RETRY_COUNT,
      label: 'nyari tabel attribute (Variants)',
    });
    if (!attributeTable) {
      log('⚠️ Tabel attribute (Attribute/Required/Values) nggak ketemu setelah dicoba berkali-kali -- pastikan kamu di tab Variants.');
      return false;
    }
    const attributeRow = Array.from(attributeTable.querySelectorAll('tbody tr, tr')).find((tr) => {
      const cells = Array.from(tr.querySelectorAll('td'));
      return cells.some((cell) => {
        const text = cell.textContent.trim().toLowerCase();
        return text.startsWith('tipe') || text.startsWith('type');
      });
    });
    if (!attributeRow) {
      log('⚠️ Baris attribute "Tipe (Type)" nggak ketemu di dalam tabel Variants. Daftar label baris yang ke-scan saya print ke console (F12) -- copy-paste hasilnya biar bisa saya sesuaikan.');
      const allRows = Array.from(attributeTable.querySelectorAll('tbody tr, tr'));
      console.log('[KFA-AUTO] Tabel attribute ketemu, tapi baris "Tipe" nggak match. Ini daftar semua baris & seluruh isi cell-nya:');
      allRows.forEach((tr, i) => {
        const cellsText = Array.from(tr.querySelectorAll('td')).map((c) => c.textContent.trim());
        console.log(`[KFA-AUTO] Row ${i}: cells=${JSON.stringify(cellsText)}`);
      });
      return false;
    }
    const tagsField = attributeRow.querySelector('.o_field_many2manytags, .o_field_widget[name="value_ids"]');
    if (!tagsField) {
      log('⚠️ Field tags di baris "Tipe (Type)" nggak ketemu. Struktur HTML baris ini saya print ke console (F12) -- copy-paste hasilnya biar bisa saya sesuaikan selectornya.');
      console.log('[KFA-AUTO] HTML baris "Tipe (Type)" yang ketemu:');
      console.log(attributeRow.outerHTML);
      return false;
    }
    const existingTags = tagsField.querySelectorAll('.o_tag, .badge, .o_field_tags .o_tag_badge_text');
    const lastTag = existingTags[existingTags.length - 1];
    if (lastTag) {
      lastTag.scrollIntoView({ block: 'center' });
    } else {
      tagsField.scrollIntoView({ block: 'center' });
    }
    await sleep(200);
    document.activeElement?.blur();
    // v1.14b: PENTING -- widget many2many ini di-re-render sama Owl/Odoo
    // pas kena klik/interaksi, jadi node `tagsField` yang kita pegang di
    // sini BISA JADI STALE (udah kepisah dari DOM) abis attempt pertama.
    // Ini kebukti dari log: attempt ke-2/3 koordinat kliknya jadi
    // {x:-4, y:0} -- itu tandanya getBoundingClientRect() dipanggil ke
    // elemen yang UDAH KE-DETACH (selalu balikin rect kosong semua nol).
    // Makanya sekarang activateTagsInputForEditing() nerima `attributeRow`
    // (elemen <tr>, yang jauh lebih jarang di-replace total sama Owl
    // dibanding div widget di dalamnya) dan RE-QUERY tagsField-nya dari
    // situ tiap kali dipanggil -- bukan pakai reference lama yang
    // di-cache di luar.
    // v1.19: naikin jumlah retry KHUSUS step ini (PROSES_A_RETRY_COUNT,
    // lebih gigih dari RETRY_COUNT umum) karena widget "Tipe (Type)" ini
    // yang paling sering keserempet overlay loading di cangkang crowded.
    setStatus('Proses A: buka input tag "Tipe (Type)"', kodeProduk);
    const input = await withRetry(() => activateTagsInputForEditing(attributeRow), {
      retries: CONFIG.PROSES_A_RETRY_COUNT,
      label: 'aktifin input tag "Tipe (Type)" buat diketik',
    });
    if (!input) {
      // v1.14b: jujur soal batasannya -- browser cuma jalanin beberapa
      // "default action" (kayak focus-follows-click di elemen custom)
      // buat event yang BENERAN dari mouse asli (trusted), bukan yang
      // di-dispatch lewat script. Kalau widget-nya emang gantungin ke
      // perilaku itu (bukan cuma dengerin event click biasa), script
      // MEMANG nggak bisa nembus ini -- ini batas teknis browser, bukan
      // bug yang bisa di-fix lewat kode. Jalur manual (klik + Alt+Enter)
      // di bawah ini yang jadi jalur normal buat kasus ini.
      log('⚠️ Widget tag "Tipe (Type)" nggak berhasil dibuka lewat script setelah beberapa kali dicoba -- kemungkinan widget ini emang butuh klik mouse ASLI (browser sengaja nggak jalanin beberapa perilaku default buat klik yang di-dispatch lewat script, ini batasan browser bukan bug). Klik MANUAL PERSIS di kotak kosong setelah tag terakhir (sampai kursor kedip-kedip beneran), lalu tekan Alt+Enter (kode SKU-nya udah otomatis keisi di kotak "Isi field yang lagi kebuka" di panel) buat lanjutin dari situ.');
      return false;
    }
    // v1.11/v1.19: widget many2many tag ini yang paling sering "berat" --
    // bungkus withRetry (pakai jatah retry Proses A yang lebih gigih)
    // biar kalau attempt pertama ketiban loading/timing, script otomatis
    // coba lagi sebelum nyerah.
    setStatus(`Proses A: isi tag "${kodeProduk}"`, kodeProduk);
    const ok = await withRetry(() => fillAutocomplete(input, kodeProduk), {
      retries: CONFIG.PROSES_A_RETRY_COUNT,
      label: `isi tag "Tipe (Type)" = "${kodeProduk}"`,
    });
    if (!ok) {
      log(`⚠️ "${kodeProduk}" nggak ketemu di autocomplete tag "Tipe (Type)" (udah dicoba beberapa kali) -- kemungkinan kode belum terdaftar di sistem KFA sama sekali. Cek manual.`);
      return false;
    }
    // v1.17: abis milih tag (apalagi kalau itu opsi "Create"), Odoo kadang
    // butuh sesaat buat validasi ke server -- kalau kodenya ternyata
    // DUPLIKAT/udah kepake, ini biasanya munculin window/dialog error.
    // Proses A itu sendiri emang nggak pernah munculin modal apapun di
    // alur normalnya, jadi modal APAPUN yang kelihatan di titik ini
    // dianggap sinyal duplikat -- bukan dianggap gagal biasa, tapi
    // di-skip otomatis sama caller (lihat processNextInQueueForProsesA).
    await sleep(400);
    if (isUnexpectedModalVisible()) {
      const modalText = getUnexpectedModalText();
      log(`⚠️ Muncul window/dialog yang nggak diharapkan abis milih "${kodeProduk}" -- kemungkinan ini DUPLIKAT (kode udah terdaftar). Isi dialognya: "${modalText}"`);
      dismissUnexpectedModal();
      return 'DUPLICATE';
    }
    await sleep(500);
    // v1.16: SEBELUMNYA di sini auto-klik Save tiap SATU SKU berhasil
    // diinput -- boros, karena Save di Odoo ini berat/lemot (blockUI
    // muncul tiap kali). Proses A CUMA nambahin tag ke widget (belum
    // di-save di sini) -- yang ngurusin auto-save periodik tiap N SKU
    // (v1.19) ada di processNextInQueueForProsesA, bukan di fungsi ini.
    log(`✅ "${kodeProduk}" berhasil ditambah ke daftar tag "Tipe (Type)" (BELUM di-save). Lanjut ke SKU berikutnya dulu kalau mau numpuk banyak, atau klik "💾 Save Sekarang" di panel buat commit semua tag yang udah diinput.`);
    return true;
  }
  // ============================================================
  // BANTUAN: isi field autocomplete yang lagi FOKUS, lewat hotkey
  // ============================================================
  document.addEventListener('keydown', async (e) => {
    const isHotkey = e.key === 'Enter' && e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey;
    if (!isHotkey) return;
    const active = document.activeElement;
    const isValidField = active && active.tagName === 'INPUT' && active.type === 'text'
      && !active.disabled && !active.readOnly && !active.closest('#kfa-panel');
    if (!isValidField) return;
    e.preventDefault();
    e.stopPropagation();
    const kodeProduk = document.getElementById('kfa-assist-input')?.value.trim();
    if (!kodeProduk) {
      log('⚠️ Isi dulu kode SKU di kotak "Isi field yang lagi kebuka" di panel sebelum pakai Alt+Enter.');
      return;
    }
    log(`(Alt+Enter) Ketik & pilih "${kodeProduk}" di field yang lagi fokus...`);
    const ok = await withRetry(() => fillAutocomplete(active, kodeProduk), {
      label: `Alt+Enter isi "${kodeProduk}"`,
    });
    if (ok) {
      log(`✅ "${kodeProduk}" berhasil dipilih via Alt+Enter.`);
      if (autoFlags.autosave) {
        await sleep(300);
        if (clickByText('button', 'Save', { visibleOnly: true })) {
          await settleAfterAction('klik Save (Alt+Enter)');
          log('💾 Save di-klik otomatis.');
        } else {
          log('⚠️ Auto-save aktif tapi tombol Save nggak ketemu -- save manual ya.');
        }
      }
      const q = loadQueue();
      if (q.length && q[0].kodeProduk === kodeProduk) {
        q.shift();
        saveQueue(q);
        log(`➡️ Antrian digeser. Sisa: ${q.length} SKU.`);
        renderPanel();
      }
    } else {
      log(`⚠️ "${kodeProduk}" nggak ketemu di autocomplete field ini (udah dicoba beberapa kali). Cek manual.`);
    }
  }, true);
  async function fillCurrentlyOpenField(kodeProduk) {
    const input = lastFocusedInput;
    if (!input || !input.isConnected) {
      log('⚠️ Belum kedetect ada field yang lagi kebuka. Klik dulu manual ke field yang mau diisi (sampai kotak input-nya beneran muncul & fokus), baru klik tombol ini lagi.');
      return false;
    }
    const rect = input.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      log('⚠️ Field terakhir yang kedetect udah nggak kelihatan (mungkin halaman/tab udah pindah). Klik ulang manual ke field yang mau diisi.');
      return false;
    }
    if (input.disabled || input.readOnly) {
      log('⚠️ Field yang kedetect ternyata disabled/readonly -- ini bukan kotak input yang aktif buat nambah tag, kemungkinan cuma elemen tampilan yang kebetulan ke-fokus. Coba klik lagi PERSIS di celah kosong setelah tag/chip terakhir (biasanya ada kursor kedip-kedip di situ kalau bener), baru klik tombol ini lagi.');
      return false;
    }
    log(`Ketik & pilih "${kodeProduk}" di field yang barusan kamu klik manual...`);
    const ok = await withRetry(() => fillAutocomplete(input, kodeProduk), {
      label: `isi field manual "${kodeProduk}"`,
    });
    if (!ok) {
      log(`⚠️ "${kodeProduk}" nggak ketemu di autocomplete field ini (udah dicoba beberapa kali) -- cek apakah field yang kedetect emang field yang dimaksud, atau kode belum terdaftar. Cek manual.`);
      return false;
    }
    log(`✅ "${kodeProduk}" berhasil dipilih di field yang dibuka manual.`);
    return true;
  }
  // ============================================================
  // PROSES B
  // ============================================================
  async function runProsesB({ kodeProduk, brand, nie, tkdn }) {
    log(`Proses B: konfigurasi produk "${kodeProduk}"...`);
    setStatus('Proses B: konfigurasi produk', kodeProduk);
    let usingReconfigure = false;
    if (clickByText('span', 'Configure Product', { visibleOnly: true })) {
      usingReconfigure = false;
    } else if (clickByText('span', 'Reconfigure Product', { visibleOnly: true })) {
      usingReconfigure = true;
      log('i️ Pakai "Reconfigure Product" (cangkang ini udah pernah dikonfigurasi sebelumnya).');
    } else {
      log('⚠️ Tombol "Configure Product" / "Reconfigure Product" nggak ketemu.');
      return null;
    }
    await settleAfterAction('klik Configure/Reconfigure Product');
    if (!usingReconfigure) {
      const nextBtn1 = await waitFor(() =>
        document.querySelector('button[name="action_next_step"]')
      , { timeout: CONFIG.NEXT_BUTTON_TIMEOUT_MS }).catch(() => null);
      if (!nextBtn1) {
        log('⚠️ Tombol Next pertama nggak ketemu di modal.');
        return null;
      }
      nextBtn1.click();
      await settleAfterAction('klik Next pertama');
    }
    const modalInputs = await waitFor(() => {
      const inputs = document.querySelectorAll('.modal .o_input.ui-autocomplete-input');
      return inputs.length >= 2 ? inputs : null;
    }, { timeout: CONFIG.MODAL_TIMEOUT_MS }).catch(() => null);
    if (!modalInputs) {
      log('⚠️ Input Brand/Type nggak ketemu di modal.');
      return null;
    }
    if (brand) {
      const brandOk = await withRetry(() => fillAutocomplete(modalInputs[0], brand), {
        label: `isi Brand = "${brand}"`,
      });
      if (!brandOk) {
        log(`⚠️ Brand "${brand}" nggak ketemu/gagal dipilih di modal (udah dicoba beberapa kali) -- BERHENTI di sini, TIDAK lanjut klik Next, biar nggak kebuat produk dengan Brand kosong. Cek manual, atau pastikan brand ini valid.`);
        return null;
      }
    }
    const typeOk = await withRetry(() => fillAutocomplete(modalInputs[1], kodeProduk), {
      label: `isi Type = "${kodeProduk}"`,
    });
    if (!typeOk) {
      log(`⚠️ Type "${kodeProduk}" nggak ketemu/gagal dipilih di modal (udah dicoba beberapa kali) -- BERHENTI di sini, TIDAK lanjut klik Next, biar nggak kebuat produk dengan Type kosong. Kemungkinan kode ini belum ke-save sebagai value "Tipe (Type)" (jalanin & Save Proses A dulu buat SKU ini), atau cek manual.`);
      return null;
    }
    const nextBtn2 = await waitFor(() => {
      const btn = document.querySelector('button[name="action_next_step"]');
      return btn && !btn.disabled && !btn.classList.contains('disabled') ? btn : null;
    }, { timeout: CONFIG.NEXT_BUTTON_TIMEOUT_MS }).catch(() => null);
    if (!nextBtn2) {
      log('⚠️ Tombol Next kedua nggak ketemu / nggak pernah aktif (mungkin masih nunggu validasi field Brand/Type). Cek manual.');
      return null;
    }
    const modalBeforeNext2 = nextBtn2.closest('.modal');
    nextBtn2.click();
    await settleAfterAction('klik Next kedua');
    const modalGone = await waitFor(() => {
      return !modalBeforeNext2 || !modalBeforeNext2.isConnected;
    }, { timeout: CONFIG.MODAL_TIMEOUT_MS }).catch(() => false);
    if (!modalGone) {
      log(`⚠️ Modal wizard kelihatannya masih kebuka setelah Next kedua diklik (mungkin ada validasi yang gagal diam-diam). URL saat ini: ${location.href}. Cek manual, jangan lanjut otomatis.`);
      return null;
    }
    await sleep(500);
    let tabFound = clickByText('a', 'Program dan Kemandirian', { visibleOnly: true });
    if (!tabFound) {
      const fallbackTab = Array.from(document.querySelectorAll('a.nav-link, a[data-toggle="tab"]'))
        .find((a) => a.textContent.toLowerCase().includes('kemandirian') && isVisible(a));
      if (fallbackTab) {
        fallbackTab.click();
        tabFound = true;
      }
    }
    if (!tabFound) {
      log(`⚠️ Tab "Program dan Kemandirian" nggak ketemu. URL saat ini: ${location.href}. Daftar tab yang ke-scan saya print ke console (F12) -- copy-paste hasilnya biar bisa saya sesuaikan.`);
      const navLinks = Array.from(document.querySelectorAll('a.nav-link, a[data-toggle="tab"]'));
      console.log('[KFA-AUTO] Daftar tab (a.nav-link / a[data-toggle="tab"]) yang ke-scan:');
      navLinks.forEach((a, i) => console.log(`[KFA-AUTO] Tab ${i}: text="${a.textContent.trim()}" href="${a.getAttribute('href')}" visible=${isVisible(a)}`, a));
      return null;
    }
    await settleAfterAction('pindah tab Program dan Kemandirian');
    if (!clickByText('button', 'Edit', { visibleOnly: true })) {
      log('⚠️ Tombol Edit di halaman variant nggak ketemu.');
      return null;
    }
    await settleAfterAction('klik Edit (Proses B)');
    const nieInput = await waitFor(() => document.querySelector('input[name="nie"]'), {
      timeout: CONFIG.MODAL_TIMEOUT_MS,
    }).catch(() => null);
    const tkdnInput = document.querySelector('input[name="score_tkdn"]');
    if (!nieInput || !tkdnInput) {
      log('⚠️ Field NIE/TKDN nggak ketemu.');
      return null;
    }
    setNativeValue(nieInput, nie);
    if (tkdn !== undefined && tkdn !== '') {
      setNativeValue(tkdnInput, String(tkdn));
    }
    await sleep(300);
    if (!clickByText('span', 'Get NIE REGALKES', { visibleOnly: true })) {
      log('⚠️ Tombol "Get NIE REGALKES" nggak ketemu.');
      return null;
    }
    log('⏳ Nunggu data Regalkes ke-fetch...');
    await settleAfterAction('klik Get NIE REGALKES');
    // v1.11: sebelumnya ada sleep(2500) tebakan di sini -- diganti total
    // sama settleAfterAction() di atas (nunggu blockUI beneran clear),
    // jadi nggak nebak2 lagi durasi fetch Regalkes-nya.
    log('⏳ Nunggu tombol Validate beneran siap/kelihatan...');
    const validateReady = await waitFor(() => hasVisibleValidateButton(), {
      timeout: CONFIG.VALIDATE_VISIBLE_TIMEOUT_MS,
      interval: 300,
    }).catch(() => false);
    if (!validateReady) {
      log(`⚠️ Tombol Validate nggak pernah kelihatan setelah Get NIE REGALKES (ditunggu ${Math.round(CONFIG.VALIDATE_VISIBLE_TIMEOUT_MS / 1000)} detik, di luar waktu loading). Kemungkinan fetch Regalkes gagal, atau NIE-nya nggak valid. Cek manual, JANGAN dianggap sukses.`);
      return null;
    }
    if (!autoFlags.autovalidate) {
      log('⏸️ Berhenti sebelum Validate -- centang "Auto validate" di panel kalau mau lanjut otomatis, atau klik Validate manual sekarang (script bakal otomatis nungguin & nglanjutin abis kamu Validate).');
      return 'PAUSED_BEFORE_VALIDATE';
    }
    // v1.8: tombol udah KELIHATAN belum tentu udah BISA DIKLIK -- Odoo
    // sering nampilin tombol lebih dulu, baru enable-nya nyusul setelah
    // field lain (mis. TKDN) atau hasil fetch Regalkes selesai divalidasi.
    // Tunggu sampai visible DAN nggak disabled, baru klik langsung ke
    // elemen tombolnya. Dibungkus withRetry (v1.11) karena ini juga
    // rawan ketiban timing loading Odoo yang berat.
    log('⏳ Mastiin tombol Validate enabled (nggak abu-abu)...');
    const validateBtn = await withRetry(
      () =>
        waitFor(
          () => {
            const btn = getVisibleValidateButtonEl();
            return btn && !isBtnDisabled(btn) ? btn : null;
          },
          { timeout: CONFIG.VALIDATE_ENABLED_TIMEOUT_MS, interval: 300 }
        ).catch(() => null),
      { label: 'tunggu tombol Validate enabled' }
    );
    if (!validateBtn) {
      const stuckBtn = getVisibleValidateButtonEl();
      log(`⚠️ Tombol Validate kelihatan tapi TETAP disabled setelah ditunggu lama (di luar waktu loading) -- kemungkinan ada field wajib lain yang belum valid (cek TKDN/NIE atau field lain di tab ini). Detail elemen saya print ke console (F12), dan field yang ke-mark invalid oleh Odoo (kalau ada) juga saya list. Cek manual, JANGAN dianggap sukses.`);
      if (stuckBtn) {
        console.log('[KFA-AUTO] Elemen tombol Validate yang macet (disabled):', stuckBtn, stuckBtn.outerHTML.slice(0, 400));
      }
      const invalidFields = Array.from(document.querySelectorAll('.o_field_invalid, .is-invalid'));
      if (invalidFields.length) {
        console.log('[KFA-AUTO] Field yang ke-mark invalid oleh Odoo saat ini:');
        invalidFields.forEach((f, i) => console.log(`[KFA-AUTO] Invalid field ${i}:`, f, f.outerHTML.slice(0, 200)));
      } else {
        console.log('[KFA-AUTO] Nggak ada field ber-class o_field_invalid/is-invalid yang kedetect -- kemungkinan penyebab disabled-nya bukan validasi field biasa (mis. masih nunggu request Regalkes, atau state Odoo lain). Cek tab ini manual.');
      }
      return null;
    }
    validateBtn.click();
    log('⏳ Nunggu proses validasi selesai (nungguin tombol Validate ilang/berubah)...');
    await settleAfterAction('klik Validate');
    const validateDone = await waitFor(() => !hasVisibleValidateButton(), {
      timeout: CONFIG.VALIDATE_DONE_TIMEOUT_MS,
      interval: 400,
    }).catch(() => false);
    if (!validateDone) {
      log(`⚠️ Tombol Validate masih kelihatan setelah ditunggu lama (di luar waktu loading) -- kemungkinan validasi gagal/nyangkut. Cek manual, JANGAN dianggap sukses.`);
      return null;
    }
    await sleep(500);
    if (!clickByText('a', 'Informasi Farmalkes', { visibleOnly: true })) {
      log('⚠️ Tab "Informasi Farmalkes" nggak ketemu. Daftar tab yang ke-scan saya print ke console (F12) -- copy-paste hasilnya biar bisa saya sesuaikan.');
      const navLinks = Array.from(document.querySelectorAll('a.nav-link, a[data-toggle="tab"]'));
      console.log('[KFA-AUTO] Daftar tab (a.nav-link / a[data-toggle="tab"]) yang ke-scan:');
      navLinks.forEach((a, i) => console.log(`[KFA-AUTO] Tab ${i}: text="${a.textContent.trim()}" href="${a.getAttribute('href')}" visible=${isVisible(a)}`, a));
      return null;
    }
    await settleAfterAction('pindah tab Informasi Farmalkes');
    const kfaCode = await waitFor(() => {
      const el = document.querySelector('span[name="kfa_pa_code"]');
      const text = el?.textContent.trim();
      return isValidKfaCode(text) ? text : null;
    }, { timeout: CONFIG.KFA_CODE_TIMEOUT_MS, interval: 400 }).catch(() => null);
    if (!kfaCode) {
      log('⚠️ Kode KFA (PA) belum muncul (masih kosong/placeholder "/" setelah ditunggu, di luar waktu loading) -- kemungkinan validasi gagal atau butuh waktu lebih lama. Cek manual, JANGAN dianggap sukses.');
      return null;
    }
    log(`🎉 Kode KFA (PA) buat "${kodeProduk}": ${kfaCode}`);
    if (autoFlags.autosave) {
      clickByText('button', 'Save', { visibleOnly: true });
      await settleAfterAction('klik Save akhir');
      log('💾 Save akhir di-klik otomatis.');
    } else {
      log('⏸️ Klik Save manual untuk commit hasil ini.');
    }
    const results = loadResults();
    results.push({ kodeProduk, kfaCode, timestamp: new Date().toISOString() });
    saveResults(results);
    renderPanel();
    return kfaCode;
  }
  // ============================================================
  // WATCHER: dipakai kalau auto-validate DIMATIKAN (validate manual).
  // Sekarang RETURN true/false biar caller (processNextInQueue) tau
  // apakah boleh lanjut ke auto-next atau harus berhenti.
  // ============================================================
  async function watchForManualValidateAndFinish(item) {
    log(`👀 Nunggu kamu klik Validate manual buat "${item.kodeProduk}"...`);
    const validated = await waitFor(() => {
      return !hasVisibleValidateButton() ? true : null;
    }, { timeout: CONFIG.MANUAL_VALIDATE_TIMEOUT_MS, interval: 1000 }).catch(() => false);
    if (!validated) {
      log(`⚠️ Nunggu Validate buat "${item.kodeProduk}" kelamaan (5 menit) / nggak terdeteksi selesai. Antrian TIDAK digeser otomatis -- cek manual, lanjutin sendiri kalau perlu.`);
      return false;
    }
    log('✅ Validate kedetect selesai. Buka tab "Informasi Farmalkes" & nungguin kode KFA...');
    await settleAfterAction('setelah Validate manual');
    if (!clickByText('a', 'Informasi Farmalkes', { visibleOnly: true })) {
      log('⚠️ Tab "Informasi Farmalkes" nggak ketemu setelah Validate. Cek manual -- hasil TIDAK dicatat & antrian TIDAK digeser.');
      return false;
    }
    await settleAfterAction('pindah tab Informasi Farmalkes (manual)');
    const kfaCode = await waitFor(() => {
      const el = document.querySelector('span[name="kfa_pa_code"]');
      const text = el?.textContent.trim();
      return isValidKfaCode(text) ? text : null;
    }, { timeout: CONFIG.KFA_CODE_TIMEOUT_MS, interval: 500 }).catch(() => null);
    if (!kfaCode) {
      log(`⚠️ Kode KFA (PA) buat "${item.kodeProduk}" masih kosong/placeholder "/" setelah ditunggu (di luar waktu loading). Kemungkinan Validate belum beneran sukses. Cek manual -- hasil TIDAK dicatat & antrian TIDAK digeser.`);
      return false;
    }
    log(`🎉 Kode KFA (PA) buat "${item.kodeProduk}" terdeteksi: ${kfaCode}`);
    if (autoFlags.autosave) {
      if (clickByText('button', 'Save', { visibleOnly: true })) {
        await settleAfterAction('klik Save (watcher)');
        log('💾 Save di-klik otomatis.');
      } else {
        log('⚠️ Auto-save aktif tapi tombol Save nggak ketemu -- save manual ya (antrian tetap digeser).');
      }
    } else {
      log('⏸️ Auto-save nggak aktif -- klik Save manual buat commit hasil ini (antrian tetap digeser di panel sekarang).');
    }
    const results = loadResults();
    results.push({ kodeProduk: item.kodeProduk, kfaCode, timestamp: new Date().toISOString() });
    saveResults(results);
    const q = loadQueue();
    if (q.length && q[0].kodeProduk === item.kodeProduk) {
      q.shift();
      saveQueue(q);
      log(`➡️ Antrian digeser. Sisa: ${q.length} SKU.`);
    }
    renderPanel();
    return true;
  }
  // ============================================================
  // v1.17: QUEUE RUNNER buat PROSES A -- disederhanain sesuai maunya user:
  // "input input input" terus sampai antrian habis atau ketemu kegagalan
  // ASLI (bukan gantung ke checkbox "Auto-lanjut" lagi -- itu sekarang
  // CUMA buat Proses B). Tiga hasil yang mungkin dari runProsesA():
  //  - true         -> sukses, tag ketambah, GESER antrian, lanjut TERUS
  //                    otomatis ke SKU berikutnya (nggak nunggu apa2).
  //  - 'DUPLICATE'  -> muncul window/dialog nggak terduga abis milih tag
  //                    (dianggap kode ini duplikat/udah kepake). SKU ini
  //                    di-skip (dicatat SKIPPED_DUPLICATE di hasil, GESER
  //                    antrian), lalu halaman di-REFRESH (soalnya widget
  //                    yang abis ketimpuk dialog error suka nyangkut) dan
  //                    otomatis LANJUT dari SKU berikutnya abis refresh
  //                    (lewat AUTORESUME_PROSES_A_KEY, dibaca di initKFA).
  //  - false        -> kegagalan ASLI (bukan duplikat) -- proses OTOMATIS
  //                    BERHENTI di sini, TIDAK lanjut/refresh sendiri,
  //                    biar bisa dicek manual dulu.
  // Begitu antrian abis (sukses semua/di-skip semua), kalau "Auto-klik
  // Save" dicentang, Save di-klik SEKALI aja buat commit seluruh batch.
  //
  // v1.19: dua tambahan penting:
  //  - AUTO-SAVE PERIODIK tiap CONFIG.PROSES_A_AUTOSAVE_EVERY (default 5)
  //    SKU sukses -- supaya kalau cangkang lemot/nyangkut di tengah batch
  //    yang panjang, progress yang udah ketumpuk nggak ilang percuma.
  //    Ini jalan LEPAS dari checkbox "Auto-klik Save" (yang itu cuma
  //    ngatur save di AKHIR seluruh antrian / buat Proses B) -- dikontrol
  //    checkbox terpisah "Auto-save tiap N SKU" yang defaultnya NYALA.
  //  - SAFETY-SAVE kalau berhenti karena kegagalan ASLI: kalau ada tag
  //    yang udah ketumpuk tapi belum ke-save pas proses berhenti, script
  //    nyoba Save dulu sebelum beneran berhenti, biar SKU-SKU sebelumnya
  //    yang udah bener nggak ikut ilang gara-gara SKU terakhir gagal.
  //  - STOP button: cek stopRequested di awal tiap iterasi (bukan potong
  //    di tengah satu SKU yang lagi jalan -- nunggu SKU itu kelar dulu,
  //    baru berhenti di titik yang aman).
  // ============================================================
  let prosesA_pendingSaveCount = 0;
  async function safetySaveProsesA(reason) {
    if (prosesA_pendingSaveCount <= 0) return;
    log(`💾 Safety-save: nyoba nyimpen ${prosesA_pendingSaveCount} tag yang udah ketumpuk (${reason})...`);
    setStatus('Proses A: safety-save', null);
    if (clickByText('button', 'Save', { visibleOnly: true })) {
      await settleAfterAction('safety-save Proses A');
      log('✅ Safety-save selesai. Tag yang udah bener sejauh ini ke-commit, nggak ikut ilang.');
      prosesA_pendingSaveCount = 0;
    } else {
      log('⚠️ Safety-save nggak nemu tombol Save yang kelihatan -- kemungkinan bukan lagi mode edit, atau memang belum ada tag yang ketumpuk. Cek manual.');
    }
  }
  async function processNextInQueueForProsesA() {
    if (stopRequested) {
      log('⏹ Stop diminta user -- Proses A berhenti di titik aman (sebelum mulai SKU berikutnya).');
      await safetySaveProsesA('berhenti karena tombol Stop');
      setIdle('Dihentikan user (Stop)');
      return;
    }
    const q = loadQueue();
    if (!q.length) {
      log('✅ Antrian abis -- semua SKU sudah diproses (Proses A).');
      if (autoFlags.autosave || prosesA_pendingSaveCount > 0) {
        log('💾 Nyimpen semua tag yang udah ketumpuk di batch ini...');
        if (clickByText('button', 'Save', { visibleOnly: true })) {
          await settleAfterAction('auto-save akhir batch Proses A');
          log('✅ Save otomatis selesai. Semua tag ke-commit.');
          prosesA_pendingSaveCount = 0;
        } else {
          log('⚠️ Tombol Save nggak ketemu/nggak kelihatan -- save manual ya lewat "💾 Save Sekarang".');
        }
      } else {
        log('⏸️ Belum di-save. Klik "💾 Save Sekarang" buat commit semua tag, atau centang "Auto-klik Save" biar otomatis kesave abis antrian habis.');
      }
      setIdle('Selesai (antrian habis)');
      return;
    }
    const item = q[0];
    setStatus(`Proses A: mulai SKU (sisa ${q.length})`, item.kodeProduk);
    const result = await runProsesA(item.kodeProduk);
    if (result === 'DUPLICATE') {
      const qNow = loadQueue();
      if (qNow.length && qNow[0].kodeProduk === item.kodeProduk) {
        qNow.shift();
        saveQueue(qNow);
      }
      const results = loadResults();
      results.push({ kodeProduk: item.kodeProduk, kfaCode: 'SKIPPED_DUPLICATE', timestamp: new Date().toISOString() });
      saveResults(results);
      log(`⏭️ "${item.kodeProduk}" dianggap DUPLIKAT -- di-skip & dicatat sebagai SKIPPED_DUPLICATE. Refresh halaman buat lanjutin dari SKU berikutnya...`);
      // v1.19: refresh bakal ngilangin tag yang belum ke-save -- safety-
      // save dulu kalau ada progress yang ketumpuk, biar nggak ilang
      // gara-gara refresh ini.
      await safetySaveProsesA('sebelum refresh karena duplikat');
      localStorage.setItem(AUTORESUME_PROSES_A_KEY, '1');
      await sleep(600);
      location.reload();
      return;
    }
    if (result) {
      const qNow = loadQueue();
      if (qNow.length && qNow[0].kodeProduk === item.kodeProduk) {
        qNow.shift();
        saveQueue(qNow);
        renderPanel();
        log(`➡️ Antrian digeser (Proses A). Sisa: ${qNow.length} SKU.`);
      }
      prosesA_pendingSaveCount += 1;
      // v1.19: auto-save periodik tiap N SKU sukses (default 5), biar
      // progress nggak numpuk kelamaan & rawan ilang kalau cangkangnya
      // nyangkut/lemot parah di tengah batch panjang. Ini LEPAS dari
      // checkbox "Auto-klik Save" -- dikontrol checkbox "Auto-save tiap
      // N SKU" sendiri (default nyala).
      if (autoFlags.autosave5 && prosesA_pendingSaveCount >= CONFIG.PROSES_A_AUTOSAVE_EVERY) {
        log(`💾 Udah numpuk ${prosesA_pendingSaveCount} tag -- auto-save periodik (tiap ${CONFIG.PROSES_A_AUTOSAVE_EVERY} SKU) jalan sekarang biar progress aman...`);
        setStatus('Proses A: auto-save periodik', item.kodeProduk);
        if (clickByText('button', 'Save', { visibleOnly: true })) {
          await settleAfterAction('auto-save periodik Proses A');
          log('✅ Auto-save periodik selesai.');
          prosesA_pendingSaveCount = 0;
        } else {
          log('⚠️ Auto-save periodik nggak nemu tombol Save -- lanjut proses, tapi progress belum ke-save, coba "💾 Save Sekarang" manual kalau perlu.');
        }
      }
      setTimeout(processNextInQueueForProsesA, 800);
    } else {
      log('⛔ Proses A gagal/berhenti di tengah jalan (BUKAN duplikat) -- proses OTOMATIS DIHENTIKAN. Cek manual / pakai jalur klik+Alt+Enter dulu sebelum lanjut ke SKU berikutnya.');
      // v1.19: sebelum beneran berhenti, coba safety-save dulu kalau ada
      // tag yang udah ketumpuk dari SKU-SKU sebelumnya di batch ini --
      // jangan sampai kegagalan di SKU terakhir nge-buang progress yang
      // udah benar sebelumnya.
      await safetySaveProsesA('SKU gagal, amanin progress sebelumnya');
      setIdle('Berhenti karena kegagalan (cek manual)');
    }
  }
  // ============================================================
  // QUEUE RUNNER: satu titik masuk buat proses 1 SKU, dan (kalau
  // "Auto-lanjut ke SKU berikutnya" dicentang) otomatis nyambung ke SKU
  // berikutnya selama masih sukses. Berhenti otomatis kalau ada kegagalan
  // di step manapun -- TIDAK maksa lanjut biar bisa dicek manual dulu.
  // ============================================================
  async function processNextInQueue() {
    const q = loadQueue();
    if (!q.length) {
      log('✅ Antrian kosong, nggak ada yang diproses.');
      return;
    }
    const item = q[0];
    const kfaCode = await runProsesB(item);
    if (kfaCode === 'PAUSED_BEFORE_VALIDATE') {
      const success = await watchForManualValidateAndFinish(item);
      if (success) {
        maybeAutoContinue();
      } else {
        log('⛔ Auto-lanjut DIHENTIKAN karena SKU ini gagal/nggak terdeteksi selesai. Cek manual dulu sebelum lanjut.');
        setIdle('Berhenti (Proses B gagal)');
      }
      return;
    }
    if (kfaCode) {
      const qNow = loadQueue();
      if (qNow.length && qNow[0].kodeProduk === item.kodeProduk) {
        qNow.shift();
        saveQueue(qNow);
        renderPanel();
      }
      maybeAutoContinue();
    } else {
      log('⛔ Proses B gagal/berhenti di tengah jalan -- auto-lanjut DIHENTIKAN. Perbaiki masalahnya dulu, jangan lanjut ke SKU berikutnya sebelum SKU ini beres.');
      setIdle('Berhenti (Proses B gagal)');
    }
  }
  // ============================================================
  // v1.12: SKIP SKU -- user bisa lewatin SKU pertama di antrian secara
  // manual (misal ternyata invalid / mau dicek belakangan). SKU-nya
  // digeser keluar dari antrian SAMA kayak kalau berhasil, tapi dicatat
  // di hasil dengan kfaCode = "SKIPPED_BY_USER" biar jelas kebedain dari
  // yang beneran dapet kode KFA pas di-export.
  // ============================================================
  function skipFirstInQueue() {
    const q = loadQueue();
    if (!q.length) {
      alert('Antrian kosong, nggak ada yang bisa di-skip.');
      return;
    }
    const item = q[0];
    const confirmed = confirm(`Yakin skip SKU "${item.kodeProduk}"?\n\nSKU ini bakal digeser keluar dari antrian & dicatat di hasil sebagai "SKIPPED_BY_USER" (bukan kode KFA asli). Ini TIDAK ngerubah apa2 di sistem KFA, cuma di panel/antrian ini.`);
    if (!confirmed) return;
    q.shift();
    saveQueue(q);
    const results = loadResults();
    results.push({ kodeProduk: item.kodeProduk, kfaCode: 'SKIPPED_BY_USER', timestamp: new Date().toISOString() });
    saveResults(results);
    log(`⏭️ SKU "${item.kodeProduk}" di-skip manual oleh user. Dicatat di hasil sebagai SKIPPED_BY_USER. Sisa antrian: ${q.length} SKU.`);
    renderPanel();
    // Skip dianggap "selesai" (bukan kegagalan) -- kalau auto-lanjut
    // dicentang, boleh langsung nyambung ke SKU berikutnya.
    maybeAutoContinue();
  }
  function maybeAutoContinue() {
    if (!autoFlags.autonext) return;
    const q = loadQueue();
    if (!q.length) {
      log('✅ Antrian habis, auto-lanjut selesai.');
      return;
    }
    log(`➡️ Auto-lanjut ke SKU berikutnya: "${q[0].kodeProduk}"...`);
    setTimeout(processNextInQueue, 1200);
  }
  // ---------- Export CSV ----------
  function exportResultsCSV() {
    const results = loadResults();
    if (!results.length) {
      alert('Belum ada hasil buat di-export.');
      return;
    }
    const rows = [['KODE_PRODUK', 'KODE_KFA', 'TIMESTAMP']];
    results.forEach((r) => rows.push([r.kodeProduk, r.kfaCode, r.timestamp]));
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kfa_hasil_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  // ---------- v1.10: Export sebagai teks pasteable (TSV) buat Google Sheets ----------
  // Tab-separated: kalau di-paste ke Sheets, tiap TAB otomatis jadi kolom
  // baru dan tiap baris baru otomatis jadi row baru -- sama kayak nge-paste
  // dari Excel.
  function resultsToTSV() {
    const results = loadResults();
    const header = ['KODE_PRODUK', 'KODE_KFA', 'TIMESTAMP'];
    const rows = [header, ...results.map((r) => [r.kodeProduk, r.kfaCode, r.timestamp])];
    return rows.map((r) => r.join('\t')).join('\n');
  }
  function showTsvPreview(text) {
    let box = document.getElementById('kfa-tsv-preview');
    if (!box) return;
    box.style.display = 'block';
    box.value = text;
    box.focus();
    box.select();
  }
  async function copyResultsAsTSV() {
    const results = loadResults();
    if (!results.length) {
      alert('Belum ada hasil buat di-copy.');
      return;
    }
    const text = resultsToTSV();
    let copied = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        copied = true;
      }
    } catch (e) {
      copied = false;
    }
    if (!copied) {
      // Fallback lawas buat browser/situasi yang nolak Clipboard API
      const tmp = document.createElement('textarea');
      tmp.value = text;
      tmp.style.position = 'fixed';
      tmp.style.opacity = '0';
      document.body.appendChild(tmp);
      tmp.focus();
      tmp.select();
      try {
        copied = document.execCommand('copy');
      } catch (e) {
        copied = false;
      }
      document.body.removeChild(tmp);
    }
    if (copied) {
      log(`📋 ${results.length} baris hasil ke-copy ke clipboard (format TSV) -- tinggal paste (Ctrl+V) ke Google Sheets.`);
    } else {
      log('⚠️ Copy otomatis ke clipboard gagal (browser mungkin ngeblok). Textarea "Preview hasil" di panel udah ke-select otomatis -- tekan Ctrl+C (atau Cmd+C) manual dari situ.');
    }
    // Selalu tampilin preview-nya juga, biar ada jalan manual kalau copy
    // otomatis gagal / user mau ngecek dulu isinya sebelum paste.
    showTsvPreview(text);
  }
  // ---------- Panel UI ----------
  let panelPos = { top: 70, left: null, right: 10 };
  let panelCollapsed = false;
  // v1.9: state checkbox disimpan DI SINI (bukan cuma di DOM), karena
  // renderPanel() dipanggil berkali-kali di tengah proses (abis Save, abis
  // geser antrian, dst) -- kalau statusnya cuma dibaca dari DOM, tiap kali
  // panel digambar ulang checkbox-nya balik ke unchecked dan auto-lanjut
  // jadi berhenti diam-diam padahal user udah nyentang semuanya.
  // v1.19: tambah autosave5 (default NYALA -- ini fitur jaga-jaga, beda
  // dari checkbox lain yang defaultnya OFF sampai user yakin alurnya
  // stabil).
  let autoFlags = { autovalidate: false, autosave: false, autonext: false, autosave5: true };
  function parseQueueInput(text) {
    return text
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [kodeProduk, nie, tkdn, brand] = line.split('\t').map((s) => (s || '').trim());
        return { kodeProduk, nie, tkdn, brand: brand || '' };
      });
  }
  function renderPanel() {
    let panel = document.getElementById('kfa-panel');
    if (panel) panel.remove();
    panel = document.createElement('div');
    panel.id = 'kfa-panel';
    const posCss = panelPos.left !== null
      ? `top: ${panelPos.top}px; left: ${panelPos.left}px;`
      : `top: ${panelPos.top}px; right: ${panelPos.right}px;`;
    panel.style.cssText = `
      position: fixed; ${posCss} width: 340px; max-height: 85vh;
      overflow-y: auto; background: #fff; border: 2px solid #1F4E78; border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.25); z-index: 999999; font-family: Arial, sans-serif;
      font-size: 12px; padding: 0;
    `;
    const queue = loadQueue();
    const results = loadResults();
    panel.innerHTML = `
      <div id="kfa-header" style="cursor: move; background:#1F4E78; color:#fff; padding:8px 10px;
           border-radius: 5px 5px 0 0; display:flex; justify-content:space-between; align-items:center;">
        <span style="font-weight:bold; font-size:13px;">KFA Alkes Automation — Pionir</span>
        <span style="display:flex; gap:6px;">
          <button id="kfa-collapse-btn" title="Ciutkan/lebarin panel (atau geser panel ini kalau nutupin tombol/tab di halaman)"
            style="cursor:pointer; background:#fff; color:#1F4E78; border:none; border-radius:3px; width:22px; height:22px; font-weight:bold;">
            ${panelCollapsed ? '▢' : '—'}
          </button>
        </span>
      </div>
      <div id="kfa-body" style="padding: 10px; ${panelCollapsed ? 'display:none;' : ''}">
        <div id="kfa-status-bar" style="margin-bottom:8px; padding:6px 8px; background:#f0f2f5; border-radius:4px; border:1px solid #ddd; display:flex; align-items:center; gap:6px;">
          <span id="kfa-status-dot" style="font-size:14px; line-height:1;">●</span>
          <span id="kfa-status-text" style="font-size:11px; font-weight:bold;">⏸ Idle</span>
        </div>
        <div style="margin-bottom:6px; color:#555;">
          Antrian: <b>${queue.length}</b> SKU | Hasil terkumpul: <b>${results.length}</b>
        </div>
        <textarea id="kfa-queue-input" rows="4" style="width:100%; box-sizing:border-box; font-size:11px;"
          placeholder="KODE_PRODUK[TAB]NIE[TAB]TKDN[TAB]BRAND (satu baris per SKU)"></textarea>
        <button id="kfa-load-queue" style="width:100%; margin-top:4px;">Muat ke Antrian</button>
        <hr>
        <label style="display:block; margin-bottom:4px;">
          <input type="checkbox" id="kfa-autovalidate" ${autoFlags.autovalidate ? 'checked' : ''}> Auto-klik Validate
        </label>
        <label style="display:block; margin-bottom:4px;">
          <input type="checkbox" id="kfa-autosave" ${autoFlags.autosave ? 'checked' : ''}> Auto-klik Save (cuma buat Proses B, & buat commit akhir batch Proses A -- lihat juga "Auto-save tiap N SKU" di bawah)
        </label>
        <label style="display:block; margin-bottom:4px;">
          <input type="checkbox" id="kfa-autosave5" ${autoFlags.autosave5 ? 'checked' : ''}> Auto-save tiap ${CONFIG.PROSES_A_AUTOSAVE_EVERY} SKU sukses di Proses A (jaga-jaga kalau cangkang lemot/nyangkut, biar progress nggak ilang)
        </label>
        <label style="display:block; margin-bottom:6px;">
          <input type="checkbox" id="kfa-autonext" ${autoFlags.autonext ? 'checked' : ''}> Auto-lanjut ke SKU berikutnya (cuma buat Proses B -- Proses A SELALU otomatis lanjut sampai antrian habis/ketemu gagal beneran)
        </label>
        <div style="color:#a00; margin-bottom:6px;">
          ⚠️ Data masuk ke sistem KFA nasional. Test 1 SKU manual dulu (semua checkbox OFF) sebelum aktifin auto-validate/save/lanjut.
        </div>
        <div style="color:#1F4E78; margin-bottom:6px; font-style:italic;">
          💡 Website ini sering nunjukin overlay abu-abu (loading) yang lama & nggak keprediksi -- script SEKARANG sengaja nungguin overlay itu ilang dulu sebelum lanjut (bukan asal jalan cepat), jadi kalau keliatan diem sebentar pas ada tulisan "lagi loading" di log, itu emang lagi nungguin server, bukan macet. Liat kotak status di atas buat tau kondisi terkini kapan aja.
        </div>
        <button id="kfa-run-a" style="width:100%; margin-bottom:4px;">▶ Proses A: Proses SEMUA SKU di antrian ke cangkang ini (otomatis, skip duplikat, gigih walau lemot)</button>
        <button id="kfa-stop" style="width:100%; margin-bottom:4px; background:#f8d7da; border:1px solid #dc3545; color:#721c24;">⏹ Stop (berhenti di titik aman + safety-save)</button>
        <button id="kfa-save-now" style="width:100%; margin-bottom:4px; background:#e6f4ea; border:1px solid #1e7e34; color:#155724;">💾 Save Sekarang (commit semua tag Proses A)</button>
        <button id="kfa-run-b" style="width:100%; margin-bottom:4px;">▶ Proses B: Validasi SKU pertama di antrian</button>
        <button id="kfa-skip" style="width:100%; margin-bottom:8px; background:#fff3cd; border:1px solid #d39e00; color:#7a5c00;">⏭ Skip SKU pertama di antrian</button>
        <hr>
        <div style="font-weight:bold; margin-bottom:4px;">Bantuan: isi field yang lagi kebuka manual</div>
        <div style="color:#555; margin-bottom:4px;">
          Kotak kode di bawah otomatis keisi dari SKU pertama di antrian, dan otomatis geser ke SKU berikutnya tiap kali berhasil. 1) Klik manual ke field sampai kursor kedip-kedip. 2) Tekan <b>Alt+Enter</b> di keyboard (JANGAN klik tombol -- klik tombol bikin field-nya keblur & mati duluan). Auto-save (kalau dicentang) jalan otomatis setelah berhasil.
        </div>
        <input type="text" id="kfa-assist-input" placeholder="Kode SKU / produk" value="${queue[0]?.kodeProduk ? queue[0].kodeProduk.replace(/"/g, '&quot;') : ''}"
          style="width:100%; box-sizing:border-box; font-size:11px; margin-bottom:4px;">
        <div style="color:#888; margin-bottom:8px; font-size:10px;">
          Tombol di bawah ini fallback lama & BISA GAGAL untuk field yang mati saat blur (mis. Tipe/Type) -- pakai Alt+Enter di atas untuk field itu.
        </div>
        <button id="kfa-run-assist" style="width:100%; margin-bottom:8px;">▶ (fallback) Isi field yang lagi kebuka</button>
        <hr>
        <div style="font-weight:bold; margin-bottom:4px;">Export Hasil</div>
        <button id="kfa-export" style="width:100%; margin-bottom:4px;">⬇ Download CSV</button>
        <button id="kfa-copy-tsv" style="width:100%; margin-bottom:4px;">📋 Copy Hasil (paste ke Google Sheets)</button>
        <textarea id="kfa-tsv-preview" readonly rows="3" style="display:none; width:100%; box-sizing:border-box; font-size:10px; margin-bottom:8px;"
          placeholder="Preview hasil (TSV) muncul di sini setelah klik Copy..."></textarea>
        <button id="kfa-clear" style="width:100%; margin-bottom:6px;">🗑 Reset Antrian & Hasil</button>
        <div style="font-weight:bold; margin-top:4px;">Log:</div>
        <div id="kfa-log" style="max-height:160px; overflow-y:auto; background:#f7f7f7; padding:4px; border:1px solid #ddd;"></div>
      </div>
    `;
    document.body.appendChild(panel);
    updateStatusBar();
    const header = document.getElementById('kfa-header');
    let dragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let panelStartLeft = 0;
    let panelStartTop = 0;
    header.addEventListener('mousedown', (e) => {
      if (e.target.id === 'kfa-collapse-btn') return;
      dragging = true;
      const rect = panel.getBoundingClientRect();
      panelStartLeft = rect.left;
      panelStartTop = rect.top;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const newLeft = panelStartLeft + (e.clientX - dragStartX);
      const newTop = panelStartTop + (e.clientY - dragStartY);
      panel.style.left = `${Math.max(0, newLeft)}px`;
      panel.style.top = `${Math.max(0, newTop)}px`;
      panel.style.right = 'auto';
    });
    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      const rect = panel.getBoundingClientRect();
      panelPos = { top: Math.round(rect.top), left: Math.round(rect.left), right: null };
    });
    document.getElementById('kfa-collapse-btn').onclick = () => {
      panelCollapsed = !panelCollapsed;
      renderPanel();
    };
    document.getElementById('kfa-autovalidate').onchange = (e) => {
      autoFlags.autovalidate = e.target.checked;
    };
    document.getElementById('kfa-autosave').onchange = (e) => {
      autoFlags.autosave = e.target.checked;
    };
    document.getElementById('kfa-autosave5').onchange = (e) => {
      autoFlags.autosave5 = e.target.checked;
    };
    document.getElementById('kfa-autonext').onchange = (e) => {
      autoFlags.autonext = e.target.checked;
    };
    const queueInput = document.getElementById('kfa-queue-input');
    queueInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      e.preventDefault();
      const start = queueInput.selectionStart;
      const end = queueInput.selectionEnd;
      const value = queueInput.value;
      queueInput.value = value.slice(0, start) + '\t' + value.slice(end);
      queueInput.selectionStart = queueInput.selectionEnd = start + 1;
    });
    document.getElementById('kfa-load-queue').onclick = () => {
      const text = document.getElementById('kfa-queue-input').value;
      const items = parseQueueInput(text);
      saveQueue(items);
      log(`Antrian dimuat: ${items.length} SKU.`);
      renderPanel();
    };
    document.getElementById('kfa-run-a').onclick = () => {
      // v1.16: SEBELUMNYA di sini langsung manggil runProsesA() doang
      // tanpa geser antrian -- bug, counter-nya nggak pernah maju.
      // Sekarang lewat processNextInQueueForProsesA() yang geser antrian
      // abis sukses & (kalau Auto-lanjut dicentang) otomatis nyambung ke
      // SKU berikutnya buat numpuk banyak tag ke cangkang yang sama.
      // v1.19: reset stopRequested & counter save tiap kali batch baru
      // dimulai dari tombol ini, biar Stop sebelumnya nggak nyangkut ke
      // batch yang baru.
      stopRequested = false;
      prosesA_pendingSaveCount = 0;
      processNextInQueueForProsesA();
    };
    document.getElementById('kfa-stop').onclick = () => {
      // v1.19: minta berhenti di titik aman -- BUKAN potong paksa di
      // tengah satu SKU yang lagi jalan (biar nggak ninggalin DOM/state
      // setengah jadi). Dicek di awal tiap iterasi
      // processNextInQueueForProsesA(), abis SKU yang lagi jalan kelar.
      stopRequested = true;
      log('⏹ Stop diminta -- bakal berhenti abis SKU yang lagi diproses sekarang kelar (bukan potong paksa di tengah), plus safety-save kalau ada progress yang belum ke-save.');
    };
    document.getElementById('kfa-save-now').onclick = async () => {
      // v1.16: tombol buat commit SEKALI di akhir, setelah numpuk
      // beberapa/banyak tag SKU lewat Proses A -- bukan save tiap 1 SKU.
      if (!clickByText('button', 'Save', { visibleOnly: true })) {
        alert('Tombol Save nggak ketemu / nggak kelihatan saat ini. Pastikan kamu masih di halaman cangkang yang lagi diedit.');
        return;
      }
      log('💾 Save diklik manual -- nungguin proses commit selesai...');
      await settleAfterAction('klik Save Sekarang (Proses A, batch)');
      log('✅ Save selesai. Semua tag yang udah diinput di widget ini sekarang ke-commit.');
      prosesA_pendingSaveCount = 0;
    };
    document.getElementById('kfa-run-b').onclick = () => {
      processNextInQueue();
    };
    document.getElementById('kfa-skip').onclick = () => {
      skipFirstInQueue();
    };
    document.getElementById('kfa-run-assist').onclick = async () => {
      const kodeProduk = document.getElementById('kfa-assist-input').value.trim();
      if (!kodeProduk) return alert('Isi dulu kode SKU / produk-nya.');
      await fillCurrentlyOpenField(kodeProduk);
    };
    document.getElementById('kfa-export').onclick = exportResultsCSV;
    document.getElementById('kfa-copy-tsv').onclick = copyResultsAsTSV;
    document.getElementById('kfa-clear').onclick = () => {
      if (confirm('Yakin reset antrian & hasil? Ini tidak menghapus data di sistem KFA, cuma di panel ini.')) {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(RESULTS_KEY);
        renderPanel();
      }
    };
  }
  // ---------- Init ----------
  function initKFA() {
    log('Script KFA-AUTO mulai jalan (readyState: ' + document.readyState + ')');
    if (document.getElementById('kfa-panel')) {
      return;
    }
    renderPanel();
    // v1.17: kalau flag ini ke-set, artinya halaman baru aja di-refresh
    // OTOMATIS gara2 ketemu duplikat di Proses A -- lanjutin lagi dari
    // SKU berikutnya di antrian (yang duplikatnya udah ke-skip sebelum
    // reload) TANPA perlu klik tombol apapun. Kasih jeda cukup panjang
    // dulu (2.5 detik) biar halaman/SPA-nya beneran kelar render sebelum
    // script mulai cari-cari elemen.
    if (localStorage.getItem(AUTORESUME_PROSES_A_KEY)) {
      localStorage.removeItem(AUTORESUME_PROSES_A_KEY);
      log('🔄 Halaman baru aja di-refresh otomatis (abis skip duplikat di Proses A) -- lanjutin Proses A dari SKU berikutnya di antrian...');
      setTimeout(() => processNextInQueueForProsesA(), 2500);
    }
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(initKFA, 1000);
  } else {
    window.addEventListener('load', () => setTimeout(initKFA, 1000));
  }
  let panelCheckTimer = null;
  const bodyObserver = new MutationObserver(() => {
    if (panelCheckTimer) return;
    panelCheckTimer = setTimeout(() => {
      panelCheckTimer = null;
      if (document.body && !document.getElementById('kfa-panel')) {
        renderPanel();
      }
    }, 800);
  });
  if (document.body) {
    bodyObserver.observe(document.body, { childList: true, subtree: false });
  }
})();