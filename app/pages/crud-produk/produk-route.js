// URL modal edit produk: /crud-produk/produk/<url_token>. Pasangan dari pola detail set (/crud-produk/set/<url_token>).
// Aturan bentuk token dan alasan memakai UUID acak (bukan produk.id / kode yang urut) ada di app/route-params.js.
//
// Sengaja tanpa DOM / jaringan sendiri (client Supabase disuntik) supaya bisa dites langsung dengan node --test
// (produk-route.test.mjs). Pemakainya index.js: goToProdukEdit / openProdukFromRoute / resolveRoute.
import { UUID_RE } from '../../route-params.js';

/** Path modal edit untuk satu token. Token di-encode walau UUID sah tidak punya karakter khusus (pertahanan berlapis). */
export const produkPath = (token) => '/crud-produk/produk/' + encodeURIComponent(token);

/**
 * Apakah `pathname` persis /crud-produk/produk/<uuid sah> (garis miring penutup boleh)?
 * Dipakai saat modal ditutup: URL cuma boleh ditarik balik ke daftar kalau address bar MEMANG masih di sini --
 * user yang sudah pindah view lewat sidebar (/crud-produk/kfa, /crud-produk/set, ...) tidak boleh dilempar balik.
 */
export function isProdukDetailPath(pathname) {
  if (typeof pathname !== 'string') return false;
  const seg = pathname.replace(/\/+$/, '').split('/'); // ['', 'crud-produk', 'produk', '<uuid>']
  return seg.length === 4 && seg[1] === 'crud-produk' && seg[2] === 'produk' && UUID_RE.test(seg[3]);
}

/**
 * Query pencarian produk berdasar url_token, dibatasi sesuai sub-route:
 *  - 'set'    : hanya produk bertipe SET.
 *  - 'produk' : hanya produk BUKAN SET (UNIT / INSTRUMENT; tipe kosong pada data lama ikut, supaya tidak jadi link mati).
 * Simetris: token SET di /produk/<uuid> dan token non-SET di /set/<uuid> sama-sama dianggap tidak ada.
 * Mengembalikan query builder (belum dieksekusi); pemanggil menambahkan .maybeSingle().
 */
export function tokenQuery(sb, sub, token) {
  const q = sb.from('produk').select('id, kode_produk').eq('url_token', String(token).toLowerCase());
  return sub === 'set' ? q.eq('tipe', 'SET') : q.or('tipe.is.null,tipe.neq.SET');
}
