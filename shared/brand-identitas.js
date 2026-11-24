// BRAND-IDENTITAS — satu sumber definisi identitas visual brand (kunci tema + logo + chip).
// Murni: tanpa DOM, tanpa Supabase. Dipakai CRUD Produk (kartu identitas), header Set Detail,
// dan card hasil Cari Produk (Konversian). Warna ada di pnm-universal.css ([data-brand="…"] → --lb, --lb-soft).
//
// Brand yang belum punya tema (SKYLAR, SCHAFER, NASHORN, dst) sengaja tidak diberi warna maupun logo pengganti.

// brand (UPPERCASE) -> kunci tema
export const BRAND_KEY = Object.freeze({ ROBUST: 'robust', ADLER: 'adler', PICMA: 'picma' });

// Logo per kunci tema (berkas yang sama dengan Lampiran Konversian; ratio = lebar/tinggi PNG).
//   h     = tinggi di kartu identitas / header Set Detail (px)
//   hChip = tinggi di chip card hasil pencarian (px) — lebih kecil supaya card tetap padat
//   warna = logo dua warna (PICMA): tampil apa adanya, bukan dilebur jadi satu warna aksen
// `src` hanya boleh datang dari tabel ini, tidak pernah dari data.
export const BRAND_LOGO = Object.freeze({
  robust: Object.freeze({ src: '/assets/robust-logo.png', ratio: 2048 / 243, h: 13, hChip: 11 }),
  adler:  Object.freeze({ src: '/assets/adler-logo.png',  ratio: 750 / 196,  h: 17, hChip: 12 }),
  picma:  Object.freeze({ src: '/assets/picma-logo.png',  ratio: 836 / 177,  h: 24, hChip: 16, warna: true }),
});

// 'robust' | 'adler' | 'picma' | '' (trim + uppercase; tak dikenal / kosong / bukan teks -> '')
export function kunciBrand(brand) {
  if (typeof brand !== 'string') return '';
  const k = brand.trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(BRAND_KEY, k) ? BRAND_KEY[k] : '';
}

// Objek logo untuk brand, atau null bila brand tanpa tema.
export function logoBrand(brand) {
  const k = kunciBrand(brand);
  return k ? BRAND_LOGO[k] : null;
}

// "ROBUST" -> "Robust" (label tampil di chip teks)
export function labelBrand(brand) {
  const b = typeof brand === 'string' ? brand.trim() : '';
  return b ? b.charAt(0).toUpperCase() + b.slice(1).toLowerCase() : '';
}

// HTML chip brand untuk baris meta card hasil. `esc` = fungsi escape yang disuntik (S.escapeHtmlAttr).
//   brand kosong        -> ''
//   brand bertema       -> chip logo (teks tetap ada di aria-label + title, bukan cuma warna)
//   brand tanpa tema    -> chip teks netral (ikon pabrik + nama)
export function brandChipHtml(brand, esc) {
  const label = labelBrand(brand);
  if (!label) return '';
  const nama = esc(label);
  const logo = logoBrand(brand);
  if (!logo) {
    return '<span class="mi mi-brand" title="Brand ' + nama + '"><i class="ti ti-building-factory-2"></i><span>' + nama + '</span></span>';
  }
  const style = '--logo:url(' + logo.src + ');--ar:' + logo.ratio + ';--h:' + logo.hChip + 'px';
  return '<span class="mi mi-brand brand-chip' + (logo.warna ? ' is-warna' : '') + '" role="img" aria-label="Brand ' + nama + '" title="Brand ' + nama + '">'
    + '<span class="brand-logo-mark" style="' + style + '"></span></span>';
}
