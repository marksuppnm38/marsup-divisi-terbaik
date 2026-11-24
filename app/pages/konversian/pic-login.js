// PIC-LOGIN — PIC Marsup diturunkan dari email akun yang login, bukan diketik bebas.
// Murni: tanpa DOM, tanpa Supabase (pola brand-awalan.js / perubahan-form.js).
//
// Aturan: PIC = bagian email sebelum '@', huruf kecil. Ini sama dengan nama tampilan di Presence dan activity feed
// (realtime.js: emailLocalPart), jadi satu orang satu nama di seluruh Konversian.

// 'Stephanus@pionir.co.id' -> 'stephanus'. Bukan teks / tanpa '@' / bagian depan kosong -> ''.
export function picDariEmail(email) {
  if (typeof email !== 'string') return '';
  const e = email.trim();
  const at = e.indexOf('@');
  if (at <= 0) return '';
  return e.slice(0, at).trim().toLowerCase();
}

// Daftar nama yang dianggap "punyaku" untuk filter Punyaku: PIC dari login + nama lama yang dulu diketik manual
// (localStorage). Record lama yang PIC-nya ditulis manual tetap kebaca sebagai milik orang yang sama.
export function namaPicSaya(email, namaLama) {
  const hasil = [];
  for (const n of [picDariEmail(email), typeof namaLama === 'string' ? namaLama.trim() : '']) {
    if (n && !hasil.some((x) => x.toLowerCase() === n.toLowerCase())) hasil.push(n);
  }
  return hasil;
}
