// konteks-suggest — usulan "Jenis" (konteks) item permintaan dari teksnya. Fungsi MURNI (tanpa DOM / jaringan),
// jadi 100+ item selesai seketika dan bisa dites di Node.
//
// Prinsip: lebih baik kosong daripada salah jenis (sama seperti resolver.js). Usulan TIDAK pernah diterapkan
// otomatis: UI menampilkannya sebagai usulan yang harus dikonfirmasi staff.
//
//   suggestKonteks(teks, satuan?) -> { konteks: 'SET'|'INSTRUMENT'|'UNIT', conf: 'tinggi'|'sedang', why } | null
//
// satuan = kata satuan yang dibuang parser dari teks ("2 UNIT" -> 'UNIT', "3 SET" -> 'SET').
// Sinyal bertabrakan (mis. SET + UNIT, INSTRUMENT + UNIT) -> null.

const RE_SET = /\b(SET|PAKET|PACKAGE|MINOR|MAYOR|MAJOR|KIT)\b/i;
// Kata "alat / unit" (alat besar). Daftar awal: tambah sesuai data nyata.
const RE_UNIT = /\b(WHEEL\s?CHAIR|KURSI\s+RODA|BED|TEMPAT\s+TIDUR|BRANKAR|STRETCHER|TROLLEY|TROLI|MONITOR|PUMP|POMPA|VENTILATOR|AUTOCLAVE|STERILISATOR|STERILIZER|LAMPU\s+OPERASI|OPERATING\s+LIGHT|OPERATING\s+TABLE|MEJA\s+OPERASI|SUCTION\s+UNIT|ELECTROSURGICAL|DIATHERMY|ESU|DEFIBRILLATOR|NEBULIZER|NEBULISER|INCUBATOR|SYRINGE\s+PUMP|INFUSION\s+PUMP|C-?ARM|USG|ECG|EKG|LEMARI|CABINET|RAK)\b/i;
// Kata instrumen satuan.
const RE_INSTR = /\b(GUNTING|SCISSORS?|KLEM|CLAMP|PINSET|FORCEPS|KORENTANG|NEEDLE\s+HOLDER|RETRACTOR|SCALPEL|HANDLE|SPATULA|KURET|CURETTE|ELEVATOR|RASPATORIUM|ROUNGER|RONGEUR|PROBE|SONDE|KANUL|CANNULA|TROCAR|TROKAR|BAKI|BENGKOK|KIDNEY\s+DISH|MANGKOK)\b/i;

export function suggestKonteks(teks, satuan) {
  const t = String(teks || '');
  if (!t.trim()) return null;
  const sat = String(satuan || '').toUpperCase();

  const hSet = RE_SET.test(t) || sat === 'SET';
  const hUnit = RE_UNIT.test(t);
  const hInstr = RE_INSTR.test(t);

  if (hSet && hUnit) return null;           // "BED SET": ambigu
  if (hInstr && hUnit) return null;         // bertabrakan
  if (hSet) {
    // "GUNTING SET" / "SET GUNTING": SET tetap yang paling mungkin, tapi keyakinannya turun.
    if (hInstr) return { konteks: 'SET', conf: 'sedang', why: 'kata SET + nama instrumen' };
    return { konteks: 'SET', conf: 'tinggi', why: RE_SET.test(t) ? 'ada kata SET / paket' : 'satuan SET' };
  }
  if (hUnit) return { konteks: 'UNIT', conf: 'tinggi', why: 'nama alat besar' };
  if (hInstr) return { konteks: 'INSTRUMENT', conf: 'tinggi', why: 'nama instrumen' };
  if (sat === 'UNIT') return { konteks: 'UNIT', conf: 'sedang', why: 'satuan UNIT' };
  return null;
}

// Hitung usulan untuk banyak item sekaligus: { map: uid -> usulan, cakupan: 0..1 }.
export function suggestAll(items) {
  let n = 0;
  const out = items.map(it => { const s = suggestKonteks(it.raw_text, it.satuan); if (s) n++; return s; });
  return { out, cakupan: items.length ? n / items.length : 0 };
}
