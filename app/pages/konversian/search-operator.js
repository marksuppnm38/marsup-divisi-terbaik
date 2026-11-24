// SEARCH-OPERATOR — pembaca ketikan kolom "Cari Produk" (fungsi murni, tanpa DOM / database).
//
// Ketikan -> struktur yang dikirim ke RPC search_produk_operator, plus "terjemahan" untuk ditampilkan.
//
//   spasi          DAN        basic mayor            -> basic DAN mayor
//   |              ATAU       mayor | laparotomy     -> mayor ATAU laparotomy
//   -kata          KECUALI    mayor -pediatric       -> mayor, tanpa pediatric
//   "frasa"        persis     "basic mayor"          -> dua kata itu berurutan
//   kolom:kata     di kolom   spek:metzen            -> metzen hanya di spesifikasi (juga nama:, kode:)
//
// `|` hanya mengikat kata di kiri-kanannya (seperti OR di Google):
//   basic mayor | laparotomy  =  basic DAN (mayor ATAU laparotomy)
//
// Aturan supaya data asli tidak salah dibaca:
//   - `-` hanya berarti "kecuali" kalau ada di AWAL kata (RB999-KE921-B99-U02, 5X6 T. aman).
//   - `"` hanya membuka frasa kalau ada di awal kata DAN ada penutupnya (ukuran inci 6" aman).
//   - Awalan kata (lapar*) tidak perlu: database memang sudah mencocokkan awalan kata.
//
// Hasil bacaKetikan():
//   adaOperator  true kalau ada | / -kata / "frasa" / kolom: -> pakai RPC operator; kalau false -> jalur lama
//   valid        false kalau tidak ada satu pun kata positif (mis. cuma "-pediatric")
//   pesan        penjelasan kalau tidak valid
//   json         { must: [[{w, c?}, ...ATAU], ...DAN], not: [{w, c?}, ...] }  (dikirim ke database)
//   terjemah     "Mencari: basic DAN (mayor ATAU laparotomy) · tanpa: pediatric"

const KOLOM = { kode: 'A', nama: 'B', spek: 'C', spesifikasi: 'C' };
const NAMA_BOBOT = { A: 'kode', B: 'nama', C: 'spesifikasi' };

// Sama dengan yang dilakukan database (normalize_search + translate tanda tsquery): pecah jadi kata.
function pecahKata(teks) {
  return String(teks).toLowerCase()
    .replace(/[-_()/.,&|!:'\\<>*"]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}
// Satu kata < 2 huruf dibuang (sama dengan pencarian lama); frasa boleh memuat kata pendek.
function unitBermakna(teks) {
  const k = pecahKata(teks);
  return k.length >= 2 || (k.length === 1 && k[0].length >= 2);
}

export function bacaKetikan(ketikan) {
  const s = String(ketikan == null ? '' : ketikan);
  const n = s.length;
  const spasi = (c) => /\s/.test(c);
  const items = [];
  let i = 0;

  while (i < n) {
    const c = s[i];
    if (spasi(c)) { i++; continue; }
    if (c === '|') { items.push({ t: 'atau' }); i++; continue; }

    let j = i;
    let neg = false;
    if (s[j] === '-' && j + 1 < n && !spasi(s[j + 1]) && s[j + 1] !== '|') { neg = true; j++; }

    let bobot = null;
    const mk = /^([A-Za-z]+):/.exec(s.slice(j));
    if (mk && Object.prototype.hasOwnProperty.call(KOLOM, mk[1].toLowerCase())) {
      bobot = KOLOM[mk[1].toLowerCase()];
      j += mk[0].length;
    }

    let teks = '';
    let kutip = false;
    if (s[j] === '"') {
      const k = s.indexOf('"', j + 1);
      if (k > j + 1 && (k + 1 >= n || spasi(s[k + 1]) || s[k + 1] === '|')) {
        teks = s.slice(j + 1, k);
        kutip = true;
        i = k + 1;
      }
    }
    if (!kutip) {
      let e = j;
      while (e < n && !spasi(s[e]) && s[e] !== '|') e++;
      teks = s.slice(j, e);
      i = Math.max(e, i + 1);
    }

    if (!unitBermakna(teks)) continue;
    items.push({ t: 'unit', neg, bobot, teks: teks.trim(), frasa: kutip && pecahKata(teks).length > 1 });
  }

  // Susun: klausa DAN, tiap klausa berisi alternatif ATAU.
  const must = [];
  const not = [];
  let klausa = null;
  let prevPositif = false;
  let menungguAtau = false;
  let adaAtau = false;
  for (const it of items) {
    if (it.t === 'atau') { menungguAtau = prevPositif; continue; }
    if (it.neg) { not.push(it); prevPositif = false; menungguAtau = false; continue; }
    if (menungguAtau && klausa) { klausa.push(it); adaAtau = true; }
    else { klausa = [it]; must.push(klausa); }
    prevPositif = true;
    menungguAtau = false;
  }

  const adaOperator = adaAtau || not.length > 0 ||
    must.some(k => k.some(u => u.frasa || u.bobot)) || not.some(u => u.frasa || u.bobot);
  const valid = must.length > 0;
  const json = {
    must: must.map(k => k.map(ke)),
    not: not.map(ke)
  };

  return {
    adaOperator,
    valid,
    pesan: valid ? '' : 'Tulis minimal satu kata yang dicari — operator -kata hanya bisa dipakai bersama kata lain.',
    json,
    terjemah: terjemahkan(must, not)
  };
}

function ke(u) {
  const o = { w: u.teks };
  if (u.bobot) o.c = u.bobot;
  return o;
}

function fmt(u) {
  const t = u.frasa ? `\u201C${u.teks}\u201D` : u.teks;
  return u.bobot ? `${t} di ${NAMA_BOBOT[u.bobot]}` : t;
}

function terjemahkan(must, not) {
  const banyak = must.length > 1;
  const bagian = must.map(k => {
    const t = k.map(fmt).join(' ATAU ');
    return k.length > 1 && banyak ? `(${t})` : t;
  });
  let out = bagian.length ? `Mencari: ${bagian.join(' DAN ')}` : 'Mencari: —';
  if (not.length) out += ` · tanpa: ${not.map(fmt).join(', ')}`;
  return out;
}