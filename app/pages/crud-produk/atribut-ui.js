// crud-produk/atribut-ui.js
// Kontrol di frontend untuk menentukan Keluarga set, Kategori, dan Spesialisasi sebuah produk (koreksi manual, lihat atribut.js).
//   1) Bagian "Klasifikasi" di modal Edit Produk: satu produk. Disimpan TERPISAH dari tombol Simpan produk (langsung ke
//      produk_atribut_manual lewat RPC), jadi tidak ikut aturan form produk dan tidak memicu "perubahan belum disimpan".
//   2) Dialog "Atur klasifikasi" dari bar produk terpilih: banyak produk sekaligus. Tiap field punya tiga keadaan:
//      tidak diubah / kembalikan ke otomatis / isi dengan nilai.
// Pilihan pertama di tiap dropdown selalu "Otomatis": memilihnya menghapus koreksi, produk kembali ke nilai dari sistem.
// Elemen DOM-nya ada di markup.js (klasSection, klasBulkOverlay, copyBarKlas); modul ini hanya menghubungkannya.
import { KAT_ORDER, katNama, spesNama, klasAuto, opsiKlasifikasi, SPES_NONE } from './klasifikasi.js';
import { muatManual, manualOf, simpanManual, pesanAtribut, normKeluarga, SPES_TANPA } from './atribut.js';
import { fetchKeluargaAuto } from './keluarga.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KEEP = '__keep__', AUTO = '__auto__';   // nilai khusus di dialog massal (nilai asli tidak pernah memakai garis bawah ganda)
const MAX_IDS = 2000;

export function createAtributUi({ sb, showToast, ensureKlas, keluargaNames, getSelectedRows, onChanged }) {
  const $ = (id) => document.getElementById(id);
  const cleanups = [];
  const on = (el, ev, fn, opt) => { if (!el) return; el.addEventListener(ev, fn, opt); cleanups.push(() => el.removeEventListener(ev, fn, opt)); };

  let cur = null;        // { id, tipe } produk yang sedang dibuka di modal
  let seq = 0;           // buang hasil basi kalau modal pindah produk selagi memuat
  let installed = true;  // false = migrasi belum dijalankan

  // ---------- opsi ----------
  const opsiSpes = (tambahan) => {
    const vals = opsiKlasifikasi().spes.map((o) => o.value).filter((v) => v !== SPES_NONE);
    if (tambahan && tambahan !== SPES_TANPA && !vals.includes(tambahan)) vals.push(tambahan);
    return vals;
  };
  const opt = (v, label, selected) => `<option value="${esc(v)}"${selected ? ' selected' : ''}>${esc(label)}</option>`;
  const namaSpes = (v) => (v === SPES_TANPA ? 'Tanpa spesialisasi' : spesNama(v));

  // ---------- 1) modal edit produk ----------
  function setMsg(text, kind) {
    const el = $('klasMsg');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'klas-msg' + (kind ? ' ' + kind : '');
  }
  function lockForm(locked) {
    ['f_klas_keluarga', 'f_klas_kategori', 'f_klas_spes', 'klasSimpanBtn', 'klasResetBtn'].forEach((id) => { const el = $(id); if (el) el.disabled = !!locked; });
  }
  const hint = (el, manual, auto, fmt) => {
    if (!el) return;
    el.textContent = manual ? `Dikoreksi manual. Otomatis: ${auto ? fmt(auto) : '—'}` : (auto ? `Otomatis dari sistem: ${fmt(auto)}` : 'Belum ada nilai otomatis');
    el.classList.toggle('is-manual', !!manual);
  };

  /** Produk baru belum punya id: bagian ini disembunyikan sampai produknya disimpan. */
  function lockNew() {
    cur = null; seq++;
    const s = $('klasSection');
    if (!s) return;
    s.hidden = false;
    $('klasBody').hidden = true;
    $('klasLocked').hidden = false;
  }

  /** Dipanggil openEdit setelah produk termuat. tipe = tipe produk di database. */
  async function openFor(id, tipe) {
    const my = ++seq;
    cur = { id, tipe };
    const s = $('klasSection');
    if (!s) return;
    s.hidden = false;
    $('klasLocked').hidden = true;
    $('klasBody').hidden = false;
    $('klasKeluargaWrap').hidden = tipe !== 'SET';
    setMsg('Memuat…');
    lockForm(true);

    const [man, klas, auto, nama] = await Promise.all([
      muatManual(sb),
      ensureKlas ? ensureKlas() : { ok: true },
      tipe === 'SET' ? fetchKeluargaAuto(sb, [id]) : { map: new Map() },
      tipe === 'SET' && keluargaNames ? keluargaNames().catch(() => []) : [],
    ]);
    if (my !== seq) return; // modal sudah pindah produk / ditutup

    installed = !(man && man.belumTerpasang);
    const m = manualOf(id) || {};
    const a = klasAuto(id) || null;
    const autoKel = auto.map.get(id) || null;

    // keluarga
    $('f_klas_keluarga').value = m.keluarga || '';
    $('f_klas_keluarga').placeholder = autoKel ? `Otomatis: ${autoKel}` : 'Otomatis';
    $('f_klas_keluarga_list').innerHTML = (nama || []).map((n) => `<option value="${esc(n)}"></option>`).join('');
    hint($('klasKeluargaHint'), m.keluarga, autoKel, (v) => v);

    // kategori
    $('f_klas_kategori').innerHTML = opt('', a ? `Otomatis — ${katNama(a.kategori)}` : 'Otomatis', !m.kategori)
      + KAT_ORDER.map((k) => opt(k, katNama(k), m.kategori === k)).join('');
    hint($('klasKategoriHint'), m.kategori, a && a.kategori, katNama);

    // spesialisasi
    const autoSpes = a ? (a.spes == null ? SPES_TANPA : a.spes) : null;
    $('f_klas_spes').innerHTML = opt('', autoSpes ? `Otomatis — ${namaSpes(autoSpes)}` : 'Otomatis', !m.spes)
      + opt(SPES_TANPA, 'Tanpa spesialisasi', m.spes === SPES_TANPA)
      + opsiSpes(m.spes).map((v) => opt(v, spesNama(v), m.spes === v)).join('');
    hint($('klasSpesHint'), m.spes, autoSpes, namaSpes);

    if (!installed) setMsg('Fitur ini belum aktif di database: jalankan supabase/2026-11-21_atribut_produk_manual.sql.', 'warn');
    else if (!klas.ok) setMsg('Daftar kategori & spesialisasi otomatis gagal dimuat; koreksi tetap bisa disimpan.', 'warn');
    else if (!a) setMsg('Produk nonaktif: tidak ada nilai otomatis. Nilai koreksi tetap tersimpan dan tampil di list.', 'info');
    else setMsg('');
    lockForm(!installed);
    $('klasResetBtn').disabled = !installed || !(m.keluarga || m.kategori || m.spes);
  }

  async function simpanSatu(reset) {
    if (!cur) return;
    const { id, tipe } = cur;
    const m = manualOf(id) || {};
    const patch = {};
    if (reset) {
      if (m.keluarga && tipe === 'SET') patch.keluarga = null;
      if (m.kategori) patch.kategori = null;
      if (m.spes) patch.spes = null;
    } else {
      const k = normKeluarga($('f_klas_keluarga').value);
      const c = $('f_klas_kategori').value || null;
      const sp = $('f_klas_spes').value || null;
      if (tipe === 'SET' && k !== (m.keluarga || null)) patch.keluarga = k;
      if (c !== (m.kategori || null)) patch.kategori = c;
      if (sp !== (m.spes || null)) patch.spes = sp;
    }
    if (!Object.keys(patch).length) { setMsg('Tidak ada perubahan.', 'info'); return; }

    lockForm(true);
    setMsg('Menyimpan…');
    const r = await simpanManual(sb, [id], patch);
    if (!cur || cur.id !== id) return;               // modal pindah produk selagi menyimpan
    if (!r.ok) { lockForm(false); setMsg(pesanAtribut(r.error), 'bad'); showToast(pesanAtribut(r.error), true); return; }
    showToast(reset ? 'Klasifikasi dikembalikan ke otomatis' : 'Klasifikasi disimpan');
    await openFor(id, tipe);                         // tampilkan nilai terbaru + hint
    if (onChanged) onChanged();
  }

  // Perubahan di bagian ini bukan bagian dari form produk: jangan sampai memicu "perubahan belum disimpan" di modal.
  const sec = $('klasSection');
  ['input', 'change'].forEach((ev) => on(sec, ev, (e) => e.stopPropagation()));
  on($('klasSimpanBtn'), 'click', () => simpanSatu(false));
  on($('klasResetBtn'), 'click', () => simpanSatu(true));

  // ---------- 2) dialog massal ----------
  const bulk = { rows: [] };
  const ov = () => $('klasBulkOverlay');
  const tutupBulk = () => { const o = ov(); if (o) o.classList.remove('open'); };

  const modeKel = () => $('klasBulkKelMode').value;
  function syncBulk() {
    const set = modeKel() === 'set';
    $('klasBulkKel').disabled = !set;
    const n = bulk.rows.length;
    const nSet = bulk.rows.filter((r) => r.tipe === 'SET').length;
    $('klasBulkKelNote').textContent = n && nSet < n ? `${(n - nSet).toLocaleString('id-ID')} dari ${n.toLocaleString('id-ID')} produk bukan SET dan akan dilewati untuk keluarga.` : '';
    const adaUbah = modeKel() !== 'keep' || $('klasBulkKat').value !== KEEP || $('klasBulkSpes').value !== KEEP;
    const keluargaKosong = set && !normKeluarga($('klasBulkKel').value);
    $('klasBulkApply').disabled = !installed || !n || n > MAX_IDS || !adaUbah || keluargaKosong;
  }

  async function bukaBulk() {
    const rows = (getSelectedRows ? getSelectedRows() : []) || [];
    if (!rows.length) { showToast('Pilih produk dulu', true); return; }
    bulk.rows = rows;
    const [man] = await Promise.all([muatManual(sb), ensureKlas ? ensureKlas() : null, keluargaNames ? keluargaNames().then((n) => { bulk.nama = n; }).catch(() => { bulk.nama = []; }) : null]);
    installed = !(man && man.belumTerpasang);

    $('klasBulkSub').textContent = `${rows.length.toLocaleString('id-ID')} produk dipilih`
      + (rows.length > MAX_IDS ? ` — maksimal ${MAX_IDS.toLocaleString('id-ID')} per simpan, kurangi pilihan.` : '');
    $('klasBulkKat').innerHTML = opt(KEEP, 'Tidak diubah', true) + opt(AUTO, 'Kembalikan ke otomatis', false)
      + KAT_ORDER.map((k) => opt(k, katNama(k), false)).join('');
    $('klasBulkSpes').innerHTML = opt(KEEP, 'Tidak diubah', true) + opt(AUTO, 'Kembalikan ke otomatis', false) + opt(SPES_TANPA, 'Tanpa spesialisasi', false)
      + opsiSpes().map((v) => opt(v, spesNama(v), false)).join('');
    $('klasBulkKelMode').innerHTML = opt('keep', 'Tidak diubah', true) + opt('auto', 'Kembalikan ke otomatis', false) + opt('set', 'Isi dengan…', false);
    $('klasBulkKel').value = '';
    $('klasBulkKelList').innerHTML = (bulk.nama || []).map((n) => `<option value="${esc(n)}"></option>`).join('');
    $('klasBulkMsg').textContent = installed ? '' : 'Fitur ini belum aktif di database: jalankan supabase/2026-11-21_atribut_produk_manual.sql.';
    syncBulk();
    ov().classList.add('open');
  }

  async function terapkanBulk() {
    const patch = {};
    const mode = modeKel();
    if (mode === 'auto') patch.keluarga = null;
    else if (mode === 'set') patch.keluarga = normKeluarga($('klasBulkKel').value);
    const kat = $('klasBulkKat').value, sp = $('klasBulkSpes').value;
    if (kat !== KEEP) patch.kategori = kat === AUTO ? null : kat;
    if (sp !== KEEP) patch.spes = sp === AUTO ? null : sp;
    if (!Object.keys(patch).length) return;

    const btn = $('klasBulkApply');
    btn.disabled = true;
    $('klasBulkMsg').textContent = 'Menyimpan…';
    const r = await simpanManual(sb, bulk.rows.map((x) => x.id), patch);
    if (!r.ok) { $('klasBulkMsg').textContent = pesanAtribut(r.error); showToast(pesanAtribut(r.error), true); syncBulk(); return; }
    const lewat = r.hasil.keluarga_dilewati;
    showToast(`Klasifikasi ${r.hasil.diubah.toLocaleString('id-ID')} produk diperbarui`
      + (lewat ? ` (keluarga dilewati untuk ${lewat.toLocaleString('id-ID')} produk non-SET)` : ''));
    tutupBulk();
    if (onChanged) onChanged();
  }

  on($('copyBarKlas'), 'click', bukaBulk);
  on($('klasBulkCloseBtn'), 'click', tutupBulk);
  on($('klasBulkCancel'), 'click', tutupBulk);
  on(ov(), 'click', (e) => { if (e.target === ov()) tutupBulk(); });
  on($('klasBulkApply'), 'click', terapkanBulk);
  ['klasBulkKelMode', 'klasBulkKat', 'klasBulkSpes'].forEach((id) => on($(id), 'change', syncBulk));
  on($('klasBulkKel'), 'input', syncBulk);

  return {
    openFor, lockNew, bukaBulk,
    destroy() { cleanups.forEach((f) => f()); cleanups.length = 0; seq++; cur = null; },
  };
}
