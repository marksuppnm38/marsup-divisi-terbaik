// crud-produk/keluarga.js
// Keluarga set: set dikelompokkan ke "keluarganya" = nama dasar tanpa nomor varian
// (MAYOR S. / MAYOR S. 2 / MAYOR S. 3 -> MAYOR S; MAYOR VAGINAL S tetap keluarga sendiri).
//
// Sumber kebenaran ada di database (supabase/03_keluarga_set.sql): fungsi fn_keluarga_set() + view
//   v_produk_keluarga : satu baris per SET, kolom list sama dengan list Produk + `keluarga`
//   v_keluarga_set    : daftar keluarga + jumlah varian (opsi filter)
// Koreksi MANUAL (atribut.js) menimpa keluarga otomatis dari view: tiga fungsi baca di bawah menerapkannya dari cache koreksi
// (dimuat index.js lebih dulu; cache kosong = tidak ada koreksi, perilaku persis seperti sebelumnya).
// Modul ini hanya MEMBACA view itu. Sengaja tanpa ketergantungan DOM dan TIDAK pernah throw: semua fungsi
// mengembalikan { ..., error } supaya bisa diuji dengan Supabase tiruan (keluarga.test.mjs) dan halaman
// Produk tetap jalan kalau migrasinya belum dijalankan (kolom/filter keluarga saja yang kosong).

import { manualMap } from './atribut.js';

export const KELUARGA_VIEW = 'v_produk_keluarga';
export const KELUARGA_REF = 'v_keluarga_set';

const ID_CHUNK = 150;     // sama dengan chunk .in('id', ...) lain di halaman Produk (aman untuk panjang URL)
const NAMA_CHUNK = 40;    // jumlah nama keluarga per request .in('keluarga', ...)
const PAGE = 1000;        // batas baris PostgREST per request

// PGRST205 = view/tabel tidak ada di schema cache PostgREST; 42P01 = undefined_table.
export function viewBelumTerpasang(err) {
  if (!err) return false;
  if (err.code === 'PGRST205' || err.code === '42P01') return true;
  return /could not find the (?:table|view)|relation .* does not exist/i.test(err.message || '');
}

export function pesanKeluarga(err) {
  if (viewBelumTerpasang(err)) return 'Keluarga set belum aktif di database. Jalankan supabase/03_keluarga_set.sql di Supabase SQL Editor, lalu muat ulang.';
  return 'Gagal memuat keluarga set: ' + ((err && err.message) || err);
}

// Nomor varian dari nama set, untuk mengurutkan varian dalam satu keluarga: "MAYOR S. 10" -> 10,
// "MAYOR S." -> null (varian pertama, diurutkan paling awal). Aturan sama dengan SQL (token S / AS / SP + nomor).
export function nomorVarian(nama) {
  const m = String(nama || '').match(/\b(?:AS|SP|S)\.?\s*(\d+)\b/i);
  return m ? Number(m[1]) : null;
}

const cmpText = (a, b) => String(a || '').localeCompare(String(b || ''), 'id', { numeric: true, sensitivity: 'base' });

// Urut per keluarga, lalu nomor varian (1, 2, ... 10, bukan 1, 10, 2), lalu nama.
export function urutKeluarga(a, b) {
  const k = cmpText(a.keluarga, b.keluarga);
  if (k) return k;
  const na = nomorVarian(a.nama_produk), nb = nomorVarian(b.nama_produk);
  if (na !== nb) return (na ?? -1) - (nb ?? -1);
  return cmpText(a.nama_produk, b.nama_produk);
}

const chunks = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

// Keluarga OTOMATIS (apa adanya dari view, tanpa koreksi manual) untuk sekumpulan produk_id. Dipakai form edit ("Otomatis: ...")
// dan untuk menghitung ulang jumlah varian. -> { map: Map<id, keluarga>, error }
export async function fetchKeluargaAuto(sb, ids) {
  const map = new Map();
  const uniq = [...new Set((ids || []).filter((x) => x != null))];
  if (!uniq.length) return { map, error: null };
  try {
    const res = await Promise.all(chunks(uniq, ID_CHUNK).map((c) => sb.from(KELUARGA_VIEW).select('id, keluarga').in('id', c)));
    const bad = res.find((r) => r.error);
    if (bad) return { map, error: bad.error };
    res.forEach((r) => (r.data || []).forEach((x) => { if (x.keluarga) map.set(x.id, x.keluarga); }));
    return { map, error: null };
  } catch (e) {
    return { map, error: e };
  }
}

// Daftar keluarga untuk opsi filter. -> { rows: [{ keluarga, n }], error }
// Jumlah varian dari view v_keluarga_set dikoreksi dengan koreksi manual: produk yang dipindah keluarga dikurangi dari keluarga
// otomatisnya dan ditambah ke keluarga barunya; keluarga yang kosong dibuang, keluarga baru (hanya ada lewat koreksi) muncul.
export async function fetchKeluargaOptions(sb) {
  try {
    const out = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb.from(KELUARGA_REF).select('keluarga, jumlah_varian').order('keluarga').range(from, from + PAGE - 1);
      if (error) return { rows: [], error };
      (data || []).forEach((r) => { if (r.keluarga) out.push({ keluarga: r.keluarga, n: Number(r.jumlah_varian) || 0 }); });
      if (!data || data.length < PAGE) break;
    }
    const manual = [...manualMap()].filter(([, m]) => m.keluarga);
    if (!manual.length) return { rows: out, error: null };

    const auto = await fetchKeluargaAuto(sb, manual.map(([id]) => id));
    if (auto.error) return { rows: [], error: auto.error };
    const n = new Map(out.map((r) => [r.keluarga, r.n]));
    manual.forEach(([id, m]) => {
      const asal = auto.map.get(id);
      if (asal === m.keluarga) return;
      if (asal) n.set(asal, (n.get(asal) || 0) - 1);
      n.set(m.keluarga, (n.get(m.keluarga) || 0) + 1);
    });
    const rows = [...n].filter(([, c]) => c > 0).map(([keluarga, c]) => ({ keluarga, n: c })).sort((x, y) => cmpText(x.keluarga, y.keluarga));
    return { rows, error: null };
  } catch (e) {
    return { rows: [], error: e };
  }
}

// Keluarga untuk sekumpulan produk_id (kolom "Keluarga set", dan jalur search / chip Verified).
// Produk non-SET tidak ada di view, jadi tidak ikut di map. -> { map: Map<id, keluarga>, error }
export async function fetchKeluargaMap(sb, ids) {
  const map = new Map();
  const uniq = [...new Set((ids || []).filter((x) => x != null))];
  if (!uniq.length) return { map, error: null };
  try {
    const res = await Promise.all(chunks(uniq, ID_CHUNK).map((c) => sb.from(KELUARGA_VIEW).select('id, keluarga').in('id', c)));
    const bad = res.find((r) => r.error);
    if (bad) return { map, error: bad.error };
    res.forEach((r) => (r.data || []).forEach((x) => { if (x.keluarga) map.set(x.id, x.keluarga); }));
    const manual = manualMap();
    uniq.forEach((id) => { const m = manual.get(id); if (m && m.keluarga) map.set(id, m.keluarga); }); // koreksi manual menang
    return { map, error: null };
  } catch (e) {
    return { map, error: e };
  }
}

// Semua set di keluarga yang dipilih (filter "Keluarga set"). Dipaging 1.000 baris per request supaya tidak
// kepotong batas PostgREST. `columns` = kolom list Produk + keluarga. -> { rows (sudah urut), error }
export async function fetchRowsByKeluarga(sb, values, columns) {
  const names = [...new Set((values || []).filter(Boolean))];
  if (!names.length) return { rows: [], error: null };
  try {
    const one = async (chunk) => {
      const rows = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await sb.from(KELUARGA_VIEW).select(columns).in('keluarga', chunk).order('id').range(from, from + PAGE - 1);
        if (error) return { rows, error };
        rows.push(...(data || []));
        if (!data || data.length < PAGE) break;
      }
      return { rows, error: null };
    };
    const res = await Promise.all(chunks(names, NAMA_CHUNK).map(one));
    const bad = res.find((r) => r.error);
    if (bad) return { rows: [], error: bad.error };
    let rows = res.flatMap((r) => r.rows);

    // Koreksi manual: set yang DIPINDAHKAN keluar dari keluarga yang dipilih dibuang; set yang dipindahkan MASUK diambil per id
    // dari view yang sama (kolom list sama) dan diberi keluarga barunya.
    const manual = manualMap();
    if (manual.size) {
      const pilih = new Set(names);
      rows = rows.filter((r) => { const m = manual.get(r.id); return !(m && m.keluarga && !pilih.has(m.keluarga)); });
      rows.forEach((r) => { const m = manual.get(r.id); if (m && m.keluarga) r.keluarga = m.keluarga; });
      const ada = new Set(rows.map((r) => r.id));
      const masuk = [...manual].filter(([id, m]) => m.keluarga && pilih.has(m.keluarga) && !ada.has(id)).map(([id]) => id);
      if (masuk.length) {
        const ext = await Promise.all(chunks(masuk, ID_CHUNK).map((c) => sb.from(KELUARGA_VIEW).select(columns).in('id', c)));
        const bad2 = ext.find((r) => r.error);
        if (bad2) return { rows: [], error: bad2.error };
        ext.forEach((r) => (r.data || []).forEach((x) => { x.keluarga = manual.get(x.id).keluarga; rows.push(x); }));
      }
    }
    return { rows: rows.sort(urutKeluarga), error: null };
  } catch (e) {
    return { rows: [], error: e };
  }
}