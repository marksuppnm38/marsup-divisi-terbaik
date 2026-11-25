// Katalog produk untuk Konversian: SATU pintu baca, SATU pintu tulis, SATU aturan "boleh masuk Clipboard".
//
// Kenapa ada: dulu "ambil baris produk lalu masukkan ke Clipboard" tersebar di beberapa tempat dan masing-masing
// punya versi sendiri (addToClip nyari di S.lastResults, addSetKodeToClip nulis ke tempat lain, aturan firm dicek
// dengan flag yang beda). Begitu salah satu pindah tempat, yang lain diam-diam rusak — "Pakai yang cocok" selalu
// gagal dengan "Produk tidak bisa dimuat ke Clipboard" sejak produkLookup dipisah dari lastResults.
//
// Aturan modul ini:
//   - TIDAK menyentuh DOM dan TIDAK menampilkan toast. Hasil dikembalikan sebagai data ({ ok, status, ... });
//     pemanggil yang memutuskan tampilannya (tombol satuan = 1 toast, proses massal = 1 toast ringkasan).
//   - Baris produk dibaca HANYA lewat S.getProduk() dan ditulis HANYA lewat S.simpanProduk(). Jangan akses
//     S.produkLookup langsung dari luar modul ini.
//   - Mutasi Clipboard-nya sendiri tetap milik clipboard.js (S.tambahProdukKeClip); modul ini yang memuat produknya
//     dan menerapkan aturan penolakan.
//
// Dipasang lewat installProdukKatalog(S) setelah installClipboard(S). Semua pemanggilan antar-modul terjadi saat
// runtime (bukan saat install), jadi urutan install tidak kritis selama S.findProdukByKodeExact (converter.js) dan
// S.tambahProdukKeClip (clipboard.js) sudah terpasang sebelum pemakaian pertama.

export function installProdukKatalog(S) {
  // Label singkat per alasan gagal. Dipakai untuk pesan satuan maupun ringkasan massal.
  const LABEL = {
    firm: 'belum firm (link V6 masih ada catatan)',
    stok: 'stoknya masih dicek, coba lagi sebentar',
    tidak_ditemukan: 'tidak ada di katalog',
    galat: 'gagal memuat produk',
    gagal_pasang: 'gagal dipasang ke item'
  };

  // ── BACA ──────────────────────────────────────────────────────────────────────────────────
  // Urutan: hasil pencarian yang sedang tampil dulu (paling segar, sudah diperkaya stok/brand), baru cache katalog.
  function getProduk(kode) {
    if (!kode) return null;
    const dariCari = Array.isArray(S.lastResults) ? S.lastResults.find(r => r.kode_produk === kode) : null;
    return dariCari || S.produkLookup.get(kode) || null;
  }

  // ── TULIS ─────────────────────────────────────────────────────────────────────────────────
  // Kunci selalu kode_produk kanonik dari barisnya sendiri (bukan teks yang diketik/ditempel pemanggil), supaya
  // perbedaan huruf besar/kecil tidak bikin baris "ada tapi tidak ketemu". Cache ini dikosongkan sesi-machine saat sesi dilepas.
  function simpanProduk(row) {
    if (row && row.kode_produk) S.produkLookup.set(row.kode_produk, row);
    return row;
  }

  // ── ATURAN ────────────────────────────────────────────────────────────────────────────────
  // Satu-satunya tempat aturan "produk ini boleh masuk Clipboard sekarang?" hidup. Mengembalikan alasan atau null.
  //  - firm: link V6 tanpa catatan. Dilonggarkan kalau mode Swasta aktif, baik di panel pencarian (modeSwasta)
  //    maupun mode harga output (modeSwastaOutput) — dulu tiap jalur hanya mengecek satu dari dua flag itu.
  //  - stok: stok masih di-fetch di belakang (lihat runSearch); item akan ter-snapshot dengan stok kosong.
  function alasanTolakProduk(r) {
    if (!S.isProdukFirm(r) && !S.modeSwasta && !S.modeSwastaOutput) return 'firm';
    if (r.stok_pending) return 'stok';
    return null;
  }

  // ── MUAT ──────────────────────────────────────────────────────────────────────────────────
  // Produk dari mana pun (hasil cari, cache, atau RPC exact-by-kode) → baris lengkap termasuk stok.
  // Stok wajib terisi: item Clipboard menghitung READY/INDENT dari stok_status+stok_qty (lihat stokStatusUntukQty).
  const sedangMuat = new Map(); // kode (lowercase) -> Promise, supaya kode yang sama tidak menembak RPC dua kali bersamaan

  async function ambilDariKatalog(kode) {
    const { produk, errMsg } = await S.findProdukByKodeExact(kode); // sudah punya retry timeout + cache hasil sukses
    if (errMsg) return { ok: false, status: 'galat', kode, detail: errMsg };
    if (!produk) return { ok: false, status: 'tidak_ditemukan', kode };
    if (produk.stok_status === undefined) {
      try { await S.enrichResultsWithStok([produk]); } catch (_) { /* stok cuma pelengkap; jangan gagalkan pemasangan */ }
    }
    return { ok: true, produk: simpanProduk(produk) };
  }

  function muatProduk(kode) {
    const ada = getProduk(kode);
    if (ada) return Promise.resolve({ ok: true, produk: ada });
    const key = String(kode || '').toLowerCase();
    if (!key) return Promise.resolve({ ok: false, status: 'tidak_ditemukan', kode });
    if (!sedangMuat.has(key)) {
      sedangMuat.set(key, ambilDariKatalog(kode).finally(() => sedangMuat.delete(key)));
    }
    return sedangMuat.get(key);
  }

  // ── PASANG ────────────────────────────────────────────────────────────────────────────────
  // Pastikan produk ada di Clipboard. Idempotent: sudah ada = sukses ('dup'), TIDAK dikeluarkan (beda dari addToClip
  // yang toggle). Hasil: { ok, status, kode, detail? } dengan status:
  //   'added' | 'dup'                                   → ok: true
  //   'firm' | 'stok' | 'tidak_ditemukan' | 'galat'     → ok: false
  async function pasangKeClipboard(kode) {
    const muat = await muatProduk(kode);
    if (!muat.ok) return { ...muat, kode };
    const status = S.tambahProdukKeClip(muat.produk, { noToggle: true });
    const ok = status === 'added' || status === 'dup';
    return { ok, status, kode: muat.produk.kode_produk };
  }

  // Berurutan (bukan paralel): tiap penambahan menulis ke sesi di server dan ensureSesi() tidak boleh balapan.
  // Mengembalikan { ok: [kode kanonik], gagal: [hasil] } — tanpa toast.
  async function pasangBanyakKeClipboard(kodes) {
    const ok = [], gagal = [];
    for (const kode of kodes) {
      const h = await pasangKeClipboard(kode);
      if (h.ok) ok.push(h.kode); else gagal.push(h);
    }
    return { ok, gagal };
  }

  // Teks untuk toast. Satu gagal: "KODE: alasan". Banyak: "2× belum firm…, 1× tidak ada di katalog".
  function ringkasGagalClip(daftar) {
    if (!daftar || !daftar.length) return '';
    const satuan = (h) => `${LABEL[h.status] || h.status}${h.detail ? ` (${h.detail})` : ''}`;
    if (daftar.length === 1) return `${daftar[0].kode}: ${satuan(daftar[0])}`;
    const hitung = new Map();
    for (const h of daftar) hitung.set(h.status, (hitung.get(h.status) || 0) + 1);
    return [...hitung].map(([st, n]) => `${n}× ${LABEL[st] || st}`).join(', ');
  }

  S.getProduk = getProduk;
  S.simpanProduk = simpanProduk;
  S.alasanTolakProduk = alasanTolakProduk;
  S.muatProduk = muatProduk;
  S.pasangKeClipboard = pasangKeClipboard;
  S.pasangBanyakKeClipboard = pasangBanyakKeClipboard;
  S.ringkasGagalClip = ringkasGagalClip;
}
