# PNM Bare Tools — Roadmap Arsitektur (update Agustus 2026)

## Rencana awal vs yang beneran kejadian

**Rencana awal:**
```
Vite → single application shell → client-side navigation → shared state → shared auth → modular existing features
```

**Yang beneran jalan (urutan kebalik, dan ini yang worked):**
```
shared auth ✅ → navigation layer (1 flow) ✅ → shared toast ✅ → [SEDANG: audit API client] → shared state (nanti) → Vite/shell (mundur ke "maybe someday", mungkin gak perlu)
```

**Insight utama:** rasa "kerasa satu aplikasi" ternyata bukan datang dari hilangnya full-page-reload (yang butuh Vite/shell). Datang dari 3 hal yang udah kelar tanpa Vite sama sekali:
1. Login sekali buat semua modul (shared auth)
2. Context nggak ilang pas pindah modul (navigation layer — query param + resume mechanism)
3. Feedback konsisten (toast seragam)

## Status shared-layer (dari rencana asli: navigation, auth/session, API client, modal/drawer, toast, shared state)

| Layer | Status | Catatan |
|---|---|---|
| Auth/session | ✅ Selesai, tested | `shared/auth-session.js` + `shared/supabase-client.js`. One-login antar modul, cross-tab logout sync jalan. |
| Navigation | ✅ Selesai, tested (1 flow) | Query param (`?edit=`, `?return_to=`, `?resume=`) + reuse mekanisme `?sesi=` yang udah ada. Baru buat flow Konversian↔Produk. Pola generic, tinggal di-copy ke pasangan modul lain kalau kerasa perlu — jangan proaktif kalau nggak ada keresahan konkret. |
| Toast/notification | ✅ Selesai, tested (sempat ada bug visual, udah difix) | `shared/toast.js`. Delegate isi fungsi `showToast()` lama, titik panggil (128 total) nggak kesentuh. |
| API client | 🔍 Lagi diaudit | Lihat task di bawah. |
| Modal/drawer | ⬜ Belum disentuh sama sekali | Belum diaudit. |
| Shared state | ⬜ Belum, generalized version | Yang ada sekarang cuma spesifik buat flow navigation di atas. |
| Vite / app shell | ⬜ Sengaja ditunda, bukan roadmap aktif | Prod masih zero build tooling. Kemungkinan besar gak akan dibutuhin kalau shared-layer di atas kelar semua. |
| `react-migration` branch | ❄️ Frozen | Nggak diapa-apain kecuali ada alasan konkret baru. |

## Konvensi yang disepakati (WAJIB diikuti sesi manapun yang kerja di repo ini)

- File shared baru dibikin isolated dulu (nggak langsung ganti titik panggil yang ada di modul lama)
- Kalau integrasi ke modul lama: **delegate isi fungsi**, jangan ubah signature/titik panggil (contoh: `showToast()` lama isinya diganti manggil `PNMToast.show()`, 128 titik panggil nggak kesentuh)
- Header **COORD LOG** (4 baris comment) di atas file yang rawan disentuh 2+ sesi paralel (`konversian.js`, `crud-produk.js`, `pnm-universal.css`, `shared/*.js`) — tambah baris baru tiap edit, jangan hapus riwayat lama
- Cache-bust query string (`?v=YYYYMMDDx`) di semua `<script>`/`<link>` file lokal (bukan CDN), naikin manual tiap ganti file
- `serve.json` (`{"cleanUrls": false}`) di local dev — jangan dihapus, itu fix buat bug query-string ilang di `npx serve`. Efek sampingnya: URL lokal wajib pakai `.html` lengkap, gak bisa akses tanpa ekstensi lagi.
- Prioritas kerja: **preserve existing functionality > minimize rewrite > seamless UX > maintainability**
- **Verifikasi otomatis (syntax check, combined-scope check) TIDAK nangkep bug visual/runtime.** Pernah kejadian: bug toast (teks ijo di atas background ijo, gara-gara 2 sistem CSS ke-collision) lolos semua verifikasi structural, ketauan cuma pas ditest beneran di browser. **User WAJIB test manual sebelum kerjaan dianggap kelar.**
- Selalu `git pull` + diff eksplisit di awal sesi baru sebelum mulai kerja, biar ketauan kalau ada perubahan dari sesi/kolega lain sejak terakhir kepegang.

---

# TASK SEKARANG: Audit API Client (belum implementasi apapun)

Prompt ini bisa langsung di-paste ke chat/room baru:

```
Lanjutin kerjaan arsitektur di repo marsup-divisi-terbaik (PNM Bare Tools).

Sebelum mulai:
1. Baca memory kamu soal project ini dulu (area file terkait pnm-bare-tools) buat
   re-sync konteks — jangan mulai kerja sebelum itu.
2. git clone/pull https://github.com/marksuppnm38/marsup-divisi-terbaik (branch
   main), diff eksplisit lawan apa yang kamu tau dari memory — laporin kalau ada
   perubahan yang perlu disorot sebelum lanjut.

Tugas sekarang: AUDIT-ONLY (belum nulis kode apapun) buat "API client" — semua
pemanggilan sesiFetch()/fetch manual di konversian.js dan sb.from()/sb.rpc() di
crud-produk.js (~116 titik total). Petain pola-polanya: mana yang beneran
seragam (bisa aman di-unify ke satu shared function), mana yang punya nuance
khusus (retry logic, upload storage, RPC vs REST) yang kalau dipaksa
diseragamin malah ngilangin behavior yang sengaja beda. Kasih penilaian: worth
di-unify jadi shared/api-client.js atau lebih baik dibiarin?

Konvensi yang udah disepakati, tetap dipakai (lihat detail di roadmap):
- File shared baru itu isolated dulu, gak langsung ganti titik panggil yang ada
- Kalau pun nanti ada perubahan kode, delegate isi fungsi, bukan ubah signature
- Header COORD LOG di baris atas file yang rawan disentuh sesi lain
- Cache-bust query string (?v=) tiap ganti file lokal
- Prioritas: preserve existing functionality > minimize rewrite > seamless UX > maintainability
- WAJIB diingetin ke user: verifikasi kamu gak nangkep bug visual/runtime — user
  tetap harus test manual di browser sebelum dianggap kelar

Jangan langsung refactor apapun — audit dan kasih rekomendasi dulu.
```
