// crud-produk/kalkulator-harga.js -- kalkulator nego cepat di tab Pricing detail set.
//
// Masukkan satu angka, pilih angka itu "Harga EKATALOG (after tax)" atau "Harga Upload (before tax)",
// lalu dua-duanya dikembalikan. Murni hitung di layar: TIDAK menyimpan apa pun ke database.
// Rumus sama dengan yang dipakai tabel di atasnya: UPLOAD = EKATALOG / 1.11 (FAKTOR_PPN dari Struktur Harga),
// dibulatkan ke rupiah (Math.round) seperti penyimpanan harga turunan.

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

/** mode 'ekat' = nilai adalah harga EKATALOG (after tax); 'upload' = harga Upload (before tax). */
export function hitungKalkulatorHarga(nilai, mode) {
  if (!Number.isFinite(nilai) || nilai <= 0) return null;
  const n = Math.round(nilai);
  const ekat = mode === 'upload' ? Math.round(n * FAKTOR_PPN) : n;
  const upload = mode === 'upload' ? n : Math.round(n / FAKTOR_PPN);
  return { ekat, upload, ppn: ekat - upload };
}

const fmtRp = (n) => 'Rp ' + Number(n).toLocaleString('id-ID');

/**
 * Pasang kalkulator ke container (markup-nya ada di markup.js, #kalkHarga).
 * onPakai(ekat): dipanggil saat user klik "Pakai ke kotak Harga EKATALOG".
 */
export function installKalkulatorHarga(root, { onPakai } = {}) {
  if (!root) return;
  const $ = (sel) => root.querySelector(sel);
  const input = $('#kalkInput');
  const outUpload = $('#kalkOutUpload');
  const outPpn = $('#kalkOutPpn');
  const outEkat = $('#kalkOutEkat');
  const pakaiBtn = $('#kalkPakai');
  const copyBtns = root.querySelectorAll('[data-kalk-copy]');
  const modeEls = root.querySelectorAll('input[name="kalkMode"]');
  let hasil = null;

  const mode = () => (root.querySelector('input[name="kalkMode"]:checked') || {}).value || 'ekat';

  try {
    const saved = localStorage.getItem(LS_MODE);
    if (saved === 'ekat' || saved === 'upload') modeEls.forEach((el) => { el.checked = el.value === saved; });
  } catch { /* storage diblok: pakai default */ }

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

  paint();
}