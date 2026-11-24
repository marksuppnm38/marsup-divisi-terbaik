// crud-produk/atribut-ui.js
// Kontrol di frontend untuk menentukan Keluarga set, Kategori, dan Spesialisasi sebuah produk (koreksi manual, lihat atribut.js).
//   1) Bagian "Klasifikasi" di modal Edit Produk: satu produk. Ikut tombol Simpan produk (satu-satunya tombol simpan di modal):
//      index.js memanggil periksaForm() sebelum menyimpan dan simpanDariForm() sesudah update produk berhasil (RPC yang sama,
//      produk_atribut_manual). Mengubah isian di sini memicu "perubahan belum disimpan" seperti field lain.
//   2) Dialog "Atur klasifikasi" dari bar produk terpilih: banyak produk sekaligus. Tiap field punya tiga keadaan:
//      tidak diubah / kembalikan ke otomatis / isi dengan nilai.
// Pilihan pertama di tiap dropdown selalu "Otomatis": memilihnya menghapus koreksi, produk kembali ke nilai dari sistem.
// Elemen DOM-nya ada di markup.js (klasSection, klasBulkOverlay, copyBarKlas); modul ini hanya menghubungkannya.
import { KAT_ORDER, katNama, spesNama, klasAuto, muatOtomatis, opsiKlasifikasi, SPES_NONE } from './klasifikasi.js';
import { muatManual, manualOf, simpanManual, pesanAtribut, normKeluarga, SPES_TANPA } from './atribut.js';
import { fetchKeluargaAuto } from './keluarga.js';
import { statusKeluarga } from './keluarga-pilih.js';

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
  let keluargaBaruOk = null; // nilai keluarga (sudah dirapikan) yang sengaja dikonfirmasi pengguna sebagai keluarga BARU

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
    ['f_klas_keluarga', 'f_klas_kategori', 'f_klas_spes', 'klasResetBtn'].forEach((id) => { const el = $(id); if (el) el.disabled = !!locked; });
    // Kategori SET ditentukan oleh tipe produk, bukan koreksi: dropdown tidak pernah aktif untuk SET.
    const kat = $('f_klas_kategori');
    if (kat && cur && cur.tipe === 'SET') kat.disabled = true;
  }
  // Kategori efektif dibaca LANGSUNG dari produk (bukan dari produk_atribut_manual, kolom kategorinya sudah tidak dipakai).
  // "Dikoreksi" = kategori_sumber === 'koreksi' (nilainya benar-benar beda dari dasar), bukan sekadar ada baris manual.
  async function bacaKategori(id) {
    try {
      const { data } = await sb.from('produk').select('kategori, kategori_sumber').eq('id', id).maybeSingle();
      return data ? { kategori: data.kategori || null, koreksi: data.kategori_sumber === 'koreksi' } : { kategori: null, koreksi: false };
    } catch (e) { return { kategori: null, koreksi: false }; }
  }
  const KAT_EDIT = KAT_ORDER.filter((k) => k !== 'SET');
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
    cur = { id, tipe, nama: [] };
    keluargaBaruOk = null;
    const s = $('klasSection');
    if (!s) return;
    s.hidden = false;
    $('klasLocked').hidden = true;
    $('klasBody').hidden = false;
    $('klasKeluargaWrap').hidden = tipe !== 'SET';
    setMsg('Memuat…');
    lockForm(true);

    const [man, klas, otoRes, auto, nama, katNow] = await Promise.all([
      muatManual(sb),
      ensureKlas ? ensureKlas() : { ok: true },
      muatOtomatis(sb, [id]),
      tipe === 'SET' ? fetchKeluargaAuto(sb, [id]) : { map: new Map() },
      tipe === 'SET' && keluargaNames ? keluargaNames().catch(() => []) : [],
      tipe === 'SET' ? { kategori: 'SET', koreksi: false } : bacaKategori(id),
    ]);
    if (my !== seq) return; // modal sudah pindah produk / ditutup

    installed = !(man && man.belumTerpasang);
    cur.nama = nama || [];
    const m = manualOf(id) || {};
    const a = klasAuto(id) || null;
    const autoKel = auto.map.get(id) || null;

    // keluarga
    $('f_klas_keluarga').value = m.keluarga || '';
    $('f_klas_keluarga').placeholder = autoKel ? `Otomatis: ${autoKel}` : 'Otomatis';
    $('f_klas_keluarga_list').innerHTML = (nama || []).map((n) => `<option value="${esc(n)}"></option>`).join('');
    hint($('klasKeluargaHint'), m.keluarga, autoKel, (v) => v);
    renderKeluargaAksi();

    // kategori: SET read-only (turunan tipe); non-SET: "Otomatis" atau koreksi (disimpan per kode produk lewat set_produk_kategori)
    const katSel = $('f_klas_kategori');
    if (tipe === 'SET') {
      katSel.innerHTML = opt('', katNama('SET'), true);
      $('klasKategoriHint').textContent = 'Ditentukan oleh tipe produk';
      $('klasKategoriHint').classList.remove('is-manual');
    } else {
      katSel.innerHTML = opt('', a ? `Otomatis — ${katNama(a.kategori)}` : 'Otomatis', !katNow.koreksi)
        + KAT_EDIT.map((k) => opt(k, katNama(k), katNow.koreksi && katNow.kategori === k)).join('');
      hint($('klasKategoriHint'), katNow.koreksi, a && a.kategori, katNama);
    }
    cur.katKoreksi = katNow.koreksi ? katNow.kategori : null;

    // spesialisasi
    const autoSpes = a ? (a.spes == null ? SPES_TANPA : a.spes) : null;
    $('f_klas_spes').innerHTML = opt('', autoSpes ? `Otomatis — ${namaSpes(autoSpes)}` : 'Otomatis', !m.spes)
      + opt(SPES_TANPA, 'Tanpa spesialisasi', m.spes === SPES_TANPA)
      + opsiSpes(m.spes).map((v) => opt(v, spesNama(v), m.spes === v)).join('');
    hint($('klasSpesHint'), m.spes, autoSpes, namaSpes);

    if (!installed) setMsg('Fitur ini belum aktif di database: jalankan supabase/2026-11-21_atribut_produk_manual.sql.', 'warn');
    else if (!klas.ok || !otoRes.ok) setMsg('Nilai otomatis kategori & spesialisasi gagal dimuat; koreksi tetap bisa disimpan.', 'warn');
    else if (!a) setMsg('Produk ini tidak ada di klasifikasi otomatis (mis. nonaktif). Nilai yang diisi tetap tersimpan dan tampil di list.', 'info');
    else setMsg('');
    lockForm(!installed);
    $('klasResetBtn').disabled = !installed;
  }

  // Beda form vs yang tersimpan -> patch untuk RPC. Kosong = tidak ada yang perlu ditulis.
  function hitungPatch() {
    if (!cur) return {};
    const { id, tipe } = cur;
    const m = manualOf(id) || {};
    const patch = {};
    const k = normKeluarga($('f_klas_keluarga').value);
    const c = $('f_klas_kategori').value || null;
    const sp = $('f_klas_spes').value || null;
    if (tipe === 'SET' && k !== (m.keluarga || null)) patch.keluarga = k;
    if (tipe !== 'SET' && c !== (cur.katKoreksi || null)) patch.kategori = c;
    if (sp !== (m.spes || null)) patch.spes = sp;
    return patch;
  }

  // Keluarga: nama yang berbeda dari yang tersimpan dicek terhadap keluarga yang sudah ada. "Tetap" = tidak diubah.
  function statusKel() {
    const m = manualOf(cur.id) || {};
    const v = normKeluarga($('f_klas_keluarga').value);
    if (v === (m.keluarga || null)) return { jenis: 'tetap', nilai: v, saran: [] };
    return statusKeluarga(v, cur.nama);
  }
  function renderKeluargaAksi() {
    const box = $('klasKeluargaAksi');
    if (!box) return;
    if (!cur || cur.tipe !== 'SET') { box.hidden = true; box.innerHTML = ''; return; }
    const st = statusKel();
    const v = normKeluarga($('f_klas_keluarga').value);
    let html = '', warn = false;
    if (st.jenis === 'mirip' && keluargaBaruOk !== st.nilai) {
      warn = true;
      html = `<span class="klas-aksi-teks">Mirip dengan keluarga yang sudah ada. Pilih salah satu:</span>`
        + st.saran.map((n) => `<button type="button" class="btn btn-ghost btn-sm" data-aksi="pakai" data-nilai="${esc(n)}">Pakai “${esc(n)}”</button>`).join('')
        + `<button type="button" class="btn btn-ghost btn-sm" data-aksi="baru">Tetap buat baru “${esc(st.nilai)}”</button>`;
    } else if (st.jenis === 'baru' && keluargaBaruOk !== st.nilai) {
      warn = true;
      html = `<span class="klas-aksi-teks">“${esc(st.nilai)}” belum ada sebagai keluarga.</span>`
        + `<button type="button" class="btn btn-ghost btn-sm" data-aksi="baru">Buat keluarga baru “${esc(st.nilai)}”</button>`;
    } else if ((st.jenis === 'mirip' || st.jenis === 'baru') && keluargaBaruOk === st.nilai) {
      html = `<span class="klas-aksi-ok"><i class="ti ti-circle-plus" aria-hidden="true"></i>Keluarga baru “${esc(st.nilai)}” dibuat saat Simpan.</span>`;
    }
    if (v) html += `<button type="button" class="btn btn-ghost btn-sm" data-aksi="auto"><i class="ti ti-restore" aria-hidden="true"></i> Kembalikan ke otomatis</button>`;
    box.innerHTML = html;
    box.classList.toggle('is-warn', warn);
    box.hidden = !html;
  }
  const kabarkanUbah = (el) => el.dispatchEvent(new Event('input', { bubbles: true })); // jalur yang sama dengan mengetik: badge "belum disimpan"
  on($('klasKeluargaAksi'), 'click', (e) => {
    const btn = e.target.closest('[data-aksi]');
    if (!btn || !cur) return;
    const inp = $('f_klas_keluarga');
    const aksi = btn.dataset.aksi;
    if (aksi === 'pakai') { inp.value = btn.dataset.nilai || ''; keluargaBaruOk = null; }
    else if (aksi === 'baru') { keluargaBaruOk = normKeluarga(inp.value); }
    else if (aksi === 'auto') { inp.value = ''; keluargaBaruOk = null; }
    renderKeluargaAksi();
    if (aksi !== 'baru') kabarkanUbah(inp);
    inp.focus();
  });
  on($('f_klas_keluarga'), 'input', () => renderKeluargaAksi());

  /**
   * Dipanggil SEBELUM Simpan menulis apa pun: isian klasifikasi yang tidak valid menghentikan seluruh simpan
   * (jangan sampai info dasar tersimpan tapi keluarga salah ketik ikut jadi keluarga baru).
   * -> { ok, pesan }
   */
  function periksaForm() {
    if (!cur || cur.tipe !== 'SET' || !installed) return { ok: true };
    const st = statusKel();
    if ((st.jenis === 'mirip' || st.jenis === 'baru') && keluargaBaruOk !== st.nilai) {
      const inp = $('f_klas_keluarga');
      try { inp.scrollIntoView({ block: 'center' }); inp.focus(); } catch (e) { /* abaikan */ }
      return { ok: false, pesan: `Keluarga set “${st.nilai}” belum ada. Pilih keluarga yang sudah ada, atau klik “Buat keluarga baru”.` };
    }
    return { ok: true };
  }

  /**
   * Dipanggil SESUDAH update produk berhasil. Menulis koreksi klasifikasi yang berubah (RPC set_produk_atribut_manual).
   * Tidak pernah throw. -> { ok, diubah, pesan? }; gagal = info dasar tetap tersimpan, isian klasifikasi tetap di form.
   */
  async function simpanDariForm() {
    if (!cur || !installed) return { ok: true, diubah: false };
    const { id, tipe } = cur;
    const patch = hitungPatch();
    if (!Object.keys(patch).length) return { ok: true, diubah: false };
    lockForm(true);
    setMsg('Menyimpan…');
    const r = await simpanManual(sb, [id], patch);
    if (!cur || cur.id !== id) return r.ok ? { ok: true, diubah: true } : { ok: false, diubah: false, pesan: pesanAtribut(r.error) }; // modal pindah produk selagi menyimpan
    if (!r.ok) {
      lockForm(false);
      const pesan = pesanAtribut(r.error);
      setMsg(pesan, 'bad');
      return { ok: false, diubah: false, pesan };
    }
    await openFor(id, tipe);                         // tampilkan nilai terbaru + hint
    if (onChanged) onChanged();
    return { ok: true, diubah: true };
  }

  // "Semua ke otomatis": hanya mengosongkan isian di form (ikut Simpan), tidak menulis ke database sendiri.
  on($('klasResetBtn'), 'click', () => {
    if (!cur) return;
    keluargaBaruOk = null;
    if (cur.tipe === 'SET') $('f_klas_keluarga').value = '';
    const kat = $('f_klas_kategori');
    if (cur.tipe !== 'SET' && kat && !kat.disabled) kat.value = '';
    $('f_klas_spes').value = '';
    renderKeluargaAksi();
    kabarkanUbah($('klasSection'));
  });

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
      + KAT_EDIT.map((k) => opt(k, katNama(k), false)).join('');
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

  // Isi form klasifikasi sekarang (untuk snapshot / penanda perubahan). Bukan dari database: murni apa yang tampil di form.
  function bacaForm() {
    return {
      klas_keluarga: $('f_klas_keluarga') ? $('f_klas_keluarga').value : '',
      klas_kategori: $('f_klas_kategori') ? $('f_klas_kategori').value : '',
      klas_spes: $('f_klas_spes') ? $('f_klas_spes').value : '',
    };
  }

  return {
    openFor, lockNew, bukaBulk, periksaForm, simpanDariForm, bacaForm,
    destroy() { cleanups.forEach((f) => f()); cleanups.length = 0; seq++; cur = null; },
  };
}
