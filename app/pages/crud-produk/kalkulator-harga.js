// crud-produk/kalkulator-harga.js -- kalkulator nego cepat di tab Pricing detail set.
//
// Masukkan satu angka, pilih angka itu "Harga EKATALOG (after tax)" atau "Harga Upload (before tax)",
// lalu dua-duanya dikembalikan. Murni hitung di layar: TIDAK menyimpan apa pun ke database.
// Rumus sama dengan yang dipakai tabel di atasnya: UPLOAD = EKATALOG / 1.11 (FAKTOR_PPN dari Struktur Harga),
// dibulatkan ke rupiah (Math.round) seperti penyimpanan harga turunan.
//
// Bagian "Bandingkan" (opsional, lewat getAcuan / getKomponen dari index.js):
//   - Diskon (%) dari harga tayang saat ini, dua arah: ketik % -> angka terisi; ketik angka -> % terhitung.
//   - Total komponen set (SUM harga EKATALOG item x qty), dihitung saat diminta, lalu dibandingkan dengan
//     harga tayang nego. Dua-duanya after tax, jadi perbandingannya sebanding.

import { FAKTOR_PPN } from '../spek-maker/struktur-harga.js';
import { showToast } from './ui-utils.js';

const LS_MODE = 'crud.kalkHarga.mode';

/** "214.352.000", "Rp 214352000", "1.234,5", "214,352,000" -> angka. Tidak valid / <= 0 -> NaN. */
export function parseRupiah(raw) {
  let s = String(raw ?? '').replace(/rp/gi, '').replace(/\s+/g, '');
  if (!s || /[^\d.,]/.test(s)) return NaN;
  const dot = s.lastIndexOf('.'), com = s.lastIndexOf(',');
  if (dot >= 0 && com >= 0) {
    // dua-duanya ada: yang paling kanan = pemisah desimal, yang lain = pemisah ribuan
    const dec = dot > com ? '.' : ',';
    const thousand = dec === '.' ? /,/g : /\./g;
    s = s.replace(thousand, '');
    if (dec === ',') s = s.replace(',', '.');
  } else if (dot >= 0 || com >= 0) {
    const sep = dot >= 0 ? '.' : ',';
    const parts = s.split(sep);
    const isThousand = parts.length > 2 || (parts.length === 2 && parts[1].length === 3 && parts[0].length >= 1 && parts[0].length <= 3);
    s = isThousand ? parts.join('') : parts.join('.');
  }
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : NaN;
}

/** "5", "5,5", "-2" -> angka persen (negatif = naik dari harga tayang). Bukan angka, atau >= 100 (gratis) / <= -1000 -> NaN. */
export function parsePersen(raw) {
  const s = String(raw ?? '').replace(/%/g, '').replace(/\s+/g, '').replace(',', '.');
  if (!s || !/^-?\d*\.?\d+$/.test(s)) return NaN;
  const n = Number(s);
  return n > -1000 && n < 100 ? n : NaN;
}

/** mode 'ekat' = nilai adalah harga EKATALOG (after tax); 'upload' = harga Upload (before tax). */
export function hitungKalkulatorHarga(nilai, mode) {
  if (!Number.isFinite(nilai) || nilai <= 0) return null;
  const n = Math.round(nilai);
  const ekat = mode === 'upload' ? Math.round(n * FAKTOR_PPN) : n;
  const upload = mode === 'upload' ? n : Math.round(n / FAKTOR_PPN);
  return { ekat, upload, ppn: ekat - upload };
}

/** Selisih harga nego terhadap pembanding: diff > 0 = lebih mahal, < 0 = lebih murah. pct terhadap pembanding. */
export function hitungSelisih(ekat, pembanding) {
  if (!Number.isFinite(ekat) || !Number.isFinite(pembanding) || pembanding <= 0) return null;
  const diff = ekat - pembanding;
  return { diff, pct: (diff / pembanding) * 100 };
}

const fmtRp = (n) => 'Rp ' + Number(n).toLocaleString('id-ID');
const fmtPct = (n) => Number(n).toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
// "turun Rp 10.717.600 (5%)" / "naik ..." / "sama"
function selisihText(sel, kataTurun = 'turun', kataNaik = 'naik') {
  if (!sel) return '—';
  if (sel.diff === 0) return 'Sama';
  const arah = sel.diff < 0 ? kataTurun : kataNaik;
  return `${arah} ${fmtRp(Math.abs(sel.diff))} (${fmtPct(Math.abs(sel.pct))}%)`;
}

/**
 * Pasang kalkulator ke container (markup-nya ada di markup.js, #kalkHarga). Mengembalikan { refresh, resetKomponen }.
 *   onPakai(ekat)  : klik "Pakai ke kotak Harga EKATALOG".
 *   getAcuan()     : { ekat, tahun } harga tayang set saat ini, atau null.
 *   getKomponen()  : Promise<{ total, itemTanpaHarga } | { kosong: true } | { error }>, dipanggil hanya saat user minta.
 */
export function installKalkulatorHarga(root, { onPakai, getAcuan, getKomponen } = {}) {
  const noop = { refresh() {}, resetKomponen() {} };
  if (!root) return noop;
  const $ = (sel) => root.querySelector(sel);
  const input = $('#kalkInput');
  const outUpload = $('#kalkOutUpload');
  const outPpn = $('#kalkOutPpn');
  const outEkat = $('#kalkOutEkat');
  const pakaiBtn = $('#kalkPakai');
  const diskonEl = $('#kalkDiskon');
  const outAcuan = $('#kalkAcuan');
  const outSelisih = $('#kalkSelisih');
  const outKomponen = $('#kalkKomponen');
  const outVsKomponen = $('#kalkVsKomponen');
  const komponenBtn = $('#kalkKomponenBtn');
  const cmpNote = $('#kalkCmpNote');
  const copyBtns = root.querySelectorAll('[data-kalk-copy]');
  const modeEls = root.querySelectorAll('input[name="kalkMode"]');
  let hasil = null;
  let komponen = null; // { total, tanpaHarga } hasil terakhir; null = belum dihitung

  const mode = () => (root.querySelector('input[name="kalkMode"]:checked') || {}).value || 'ekat';
  const acuan = () => {
    const a = getAcuan ? getAcuan() : null;
    return a && Number.isFinite(a.ekat) && a.ekat > 0 ? a : null;
  };

  try {
    const saved = localStorage.getItem(LS_MODE);
    if (saved === 'ekat' || saved === 'upload') modeEls.forEach((el) => { el.checked = el.value === saved; });
  } catch { /* storage diblok: pakai default */ }

  function paintKomponen() {
    if (!komponen) {
      outKomponen.textContent = '—';
      outVsKomponen.textContent = '—';
      outVsKomponen.classList.remove('is-warn');
      if (komponenBtn) komponenBtn.textContent = 'Hitung';
      return;
    }
    outKomponen.textContent = fmtRp(Math.round(komponen.total));
    if (komponenBtn) komponenBtn.textContent = 'Hitung ulang';
    const sel = hasil ? hitungSelisih(hasil.ekat, komponen.total) : null;
    outVsKomponen.textContent = selisihText(sel, 'di bawah komponen', 'di atas komponen');
    // Harga set di bawah total komponen = berpotensi rugi dibanding menjual itemnya satu-satu.
    outVsKomponen.classList.toggle('is-warn', !!sel && sel.diff < 0);
  }

  function paintNote() {
    const bits = [];
    if (!acuan()) bits.push('Set ini belum punya harga EKATALOG, jadi diskon belum bisa dihitung.');
    if (komponen && komponen.tanpaHarga > 0) bits.push(`${komponen.tanpaHarga} item belum punya harga EKATALOG dan tidak ikut dalam total komponen.`);
    if (komponen) bits.push('Total komponen dihitung saat tombol diklik; klik Hitung ulang kalau komposisi berubah.');
    cmpNote.textContent = bits.join(' ');
  }

  function paint() {
    const raw = input.value.trim();
    const n = parseRupiah(raw);
    hasil = hitungKalkulatorHarga(n, mode());
    const invalid = raw !== '' && !hasil;
    input.setAttribute('aria-invalid', String(invalid));
    root.classList.toggle('is-invalid', invalid);
    outUpload.textContent = hasil ? fmtRp(hasil.upload) : '—';
    outPpn.textContent = hasil ? fmtRp(hasil.ppn) : '—';
    outEkat.textContent = hasil ? fmtRp(hasil.ekat) : '—';
    copyBtns.forEach((b) => { b.disabled = !hasil; });
    if (pakaiBtn) pakaiBtn.disabled = !hasil;
    // Nilai yang diketik user ditandai di baris hasilnya, supaya jelas mana input dan mana hasil hitung.
    root.querySelectorAll('.kalk-row[data-side]').forEach((row) => row.classList.toggle('is-input', !!hasil && row.dataset.side === mode()));

    // Bandingkan dengan harga tayang saat ini
    const a = acuan();
    outAcuan.textContent = a ? `${fmtRp(a.ekat)}${a.tahun ? ` (${a.tahun})` : ''}` : '—';
    diskonEl.disabled = !a;
    const sel = a && hasil ? hitungSelisih(hasil.ekat, a.ekat) : null;
    outSelisih.textContent = selisihText(sel);
    // Isi kolom diskon dari angka, kecuali user sedang mengetik di kolom itu sendiri (jangan menimpa ketikannya).
    if (document.activeElement !== diskonEl) {
      diskonEl.value = sel ? fmtPct((Math.round(-sel.pct * 100) / 100) || 0) : ''; // `|| 0` supaya -0 tidak tampil "-0"
      diskonEl.removeAttribute('aria-invalid');
    }
    paintKomponen();
    paintNote();
  }

  input.addEventListener('input', paint);
  // Rapikan jadi "214.352.000" saat selesai mengetik (tidak saat mengetik, supaya kursor tidak loncat).
  input.addEventListener('blur', () => {
    const n = parseRupiah(input.value);
    if (Number.isFinite(n)) { input.value = Math.round(n).toLocaleString('id-ID'); paint(); }
  });
  modeEls.forEach((el) => el.addEventListener('change', () => {
    try { localStorage.setItem(LS_MODE, mode()); } catch { /* abaikan */ }
    paint();
  }));

  // Ketik diskon % -> harga EKATALOG nego terisi (diskon dihitung dari harga tayang saat ini), mode otomatis "EKATALOG".
  diskonEl.addEventListener('input', () => {
    const a = acuan();
    const d = parsePersen(diskonEl.value);
    if (!a || !Number.isFinite(d)) { diskonEl.setAttribute('aria-invalid', String(diskonEl.value.trim() !== '')); return; }
    diskonEl.removeAttribute('aria-invalid');
    const harga = Math.round(a.ekat * (1 - d / 100));
    modeEls.forEach((el) => { el.checked = el.value === 'ekat'; });
    input.value = harga.toLocaleString('id-ID');
    paint();
  });
  diskonEl.addEventListener('blur', () => { paint(); });

  copyBtns.forEach((btn) => btn.addEventListener('click', async () => {
    if (!hasil) return;
    const angka = String(hasil[btn.dataset.kalkCopy]); // angka polos tanpa titik: siap ditempel ke form / Excel
    try {
      await navigator.clipboard.writeText(angka);
      showToast('Disalin: ' + angka);
    } catch {
      showToast('Gagal menyalin, salin manual: ' + angka, true);
    }
  }));

  if (pakaiBtn) pakaiBtn.addEventListener('click', () => { if (hasil && onPakai) onPakai(hasil.ekat); });

  if (komponenBtn) komponenBtn.addEventListener('click', async () => {
    if (!getKomponen) return;
    const labelAsal = komponenBtn.textContent;
    komponenBtn.disabled = true;
    komponenBtn.textContent = 'Menghitung...';
    try {
      const r = await getKomponen();
      if (r && r.kosong) { showToast('Belum ada item di komposisi set ini', true); return; }
      if (!r || r.error) { showToast('Gagal ambil harga item: ' + ((r && r.error && r.error.message) || 'tidak diketahui'), true); return; }
      komponen = { total: r.total, tanpaHarga: (r.itemTanpaHarga || []).length };
      paint();
    } finally {
      komponenBtn.disabled = false;
      if (komponenBtn.textContent === 'Menghitung...') komponenBtn.textContent = labelAsal;
    }
  });

  paint();
  return {
    /** Dipanggil index.js saat harga set (acuan) selesai dimuat / berubah. */
    refresh: paint,
    /** Dipanggil saat pindah set: total komponen milik set lain tidak berlaku lagi. */
    resetKomponen() { komponen = null; },
  };
}