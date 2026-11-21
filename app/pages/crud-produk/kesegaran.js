// crud-produk/kesegaran.js
// Penanda "data di layar sudah basi" antar tampilan crud-produk.
//
// Kenapa ada: tampilan Produk / AKD dimuat SEKALI per mount (switchView), dan banyak aksi menulis ke DB dari tempat lain
// (modal edit: harga & AKD, Set Management, Sync dari Sheet, edit AKD) tanpa menyentuh list di belakangnya.
// Dulu tiap titik harus ingat memanggil loadProduk() sendiri-sendiri -- dan beberapa lupa. Sekarang aksi cukup
// mark(); list dimuat ulang begitu pengguna kembali melihatnya (modal ditutup / pindah tab), BUKAN saat itu juga,
// jadi tidak ada reload sia-sia selagi list tidak kelihatan.
//
// Tanpa ketergantungan DOM; tiap efek lewat callback h:
//   invalidate()   buang cache Produk (invalidateProdukStackCache)
//   reloadProduk() muat ulang list Produk (+ jumlah di filter)
//   reloadDistinct() muat ulang opsi dropdown Brand / Golongan / Status INAPROC
//   reloadAkd()    muat ulang list AKD
export function createStaleTracker(h) {
  let produk = false, akd = false, distinct = false;
  return {
    /** Data Produk berubah di DB. opts.akd: list AKD ikut basi. opts.distinct: opsi dropdown filter ikut basi. */
    mark(opts) {
      h.invalidate();
      produk = true;
      if (opts && opts.akd) akd = true;
      if (opts && opts.distinct) distinct = true;
    },
    /** Dipanggil saat sebuah tampilan kembali terlihat. -> daftar yang dimuat ulang ('produk' | 'distinct' | 'akd'). */
    flush(view, modalOpen) {
      const out = [];
      if (view === 'produk' && !modalOpen) {
        if (produk) { produk = false; out.push('produk'); h.reloadProduk(); }
        // Opsi dropdown berdiri sendiri: Bulk Edit memuat ulang list segera (settle('produk')) tapi opsi filter
        // baru perlu dimuat ulang saat tab Produk terlihat lagi.
        if (distinct) { distinct = false; out.push('distinct'); h.reloadDistinct(); }
      }
      if (view === 'akd' && akd) {
        akd = false;
        out.push('akd');
        h.reloadAkd();
      }
      return out;
    },
    /** Sebuah muat ulang penuh baru saja dimulai: tanda yang bersangkutan sudah terlayani. */
    settle(kind) {
      if (kind === 'produk') produk = false;
      else if (kind === 'akd') akd = false;
    },
    isStale: (kind) => (kind === 'akd' ? akd : kind === 'distinct' ? distinct : produk),
  };
}
