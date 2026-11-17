// Modul hasil pecahan dari konversian/index.js. State lintas-file diakses lewat objek
// 'S' yang dioper dari index.js (bukan window global; lihat `const S = {}` di mount()
// lalu install*(S) dipanggil berurutan). Referensi ke variabel/fungsi yang didefinisikan
// di file LAIN ditulis S.nama (lihat COORD LOG di index.js).
export function installSetMendekati(S) {
// ══════════════════════════════════════════
// CARI SET MENDEKATI: dulu tool HTML terpisah (kode_produk ditempel manual ke
// textarea, lalu RPC cari_set_mendekati/detail_isi_set). Sekarang jadi subtab; sumber
// kodenya otomatis dari item di Clipboard sesi ini, atau dari paste-an. RPC dipanggil
// lewat helper rpc() yang sudah ada (pola sama dengan get_set_items dkk: pakai
// ANON_KEY, bukan stokAccessToken, karena RPC ini read-only/security-definer).
// ══════════════════════════════════════════
// Kode sumber = kode_produk unik dari clipboard (kode_asli dipakai kalau ada,
// sama kayak konvensi kode buat gambar/thumbnail di bagian lain app ini) —
// ATAU dari textarea paste-an, tergantung pintu (setcariSourceMode) yang
// lagi aktif. Satu titik dipanggil runCariSetMendekati() & updateSetcariSourceCount(),
// jadi kedua pintu otomatis konsisten tanpa logic ganda.
function setcariSourceKodeList() {
  if (S.setcariSourceMode === 'paste') return parseSetcariPasteKode(S.setcariPasteInput.value);
  const seen = new Set();
  const out = [];
  S.clipboard.forEach(c => {
    const kode = (c.kode_asli && c.kode_asli.trim()) ? c.kode_asli.trim() : c.kode_produk;
    if (kode && !seen.has(kode)) { seen.add(kode); out.push(kode); }
  });
  return out;
}

// Pisah per baris ATAU koma (dua-duanya sering kepake pas paste dari Excel/
// chat WA) — kode produk sendiri gak pernah punya spasi/koma di dalamnya,
// jadi aman displit begini. Dedupe biar gak nembak kode yang sama 2x.
function parseSetcariPasteKode(raw) {
  const seen = new Set();
  const out = [];
  raw.split(/[\n,]/).map(s => s.trim()).filter(Boolean).forEach(kode => {
    if (!seen.has(kode)) { seen.add(kode); out.push(kode); }
  });
  return out;
}

function updateSetcariSourceCount() {
  const n = setcariSourceKodeList().length;
  const noun = S.setcariSourceMode === 'paste' ? 'kode dari paste-an' : 'produk di Clipboard';
  S.setcariSourceLabel.innerHTML = `<b>${n}</b> ${noun} dibandingkan dengan isi tiap SET`;
  S.setcariSearchBtn.disabled = n === 0;
}
S.updateSetcariSourceCount = updateSetcariSourceCount;

// Empty state punya 2 wajah: (1) intro penjelasan fungsi — tampil selama belum ada pencarian,
// supaya user baru langsung ngerti ini buat apa; (2) pesan singkat kalau pencarian tidak
// menemukan SET apa pun. Dua-duanya hidup di #setcari-empty, saling gantian.
function showSetcariIntro() {
  S.setcariEmpty.style.display = 'block';
  const intro = document.getElementById('setcari-intro');
  const msg = document.getElementById('setcari-empty-msg');
  if (intro) intro.hidden = false;
  if (msg) { msg.hidden = true; msg.textContent = ''; }
}
function showSetcariEmptyMsg(text) {
  S.setcariEmpty.style.display = 'block';
  const intro = document.getElementById('setcari-intro');
  const msg = document.getElementById('setcari-empty-msg');
  if (intro) intro.hidden = true;
  if (msg) { msg.textContent = text; msg.hidden = false; }
}

// Pindah pintu sumber: hasil pencarian sebelumnya (dari sumber lain) udah
// gak relevan lagi, jadi di-reset — daripada nampilin hasil SET yang
// ternyata bukan dari kode yang lagi aktif dipakai.
function setSetcariSourceMode(mode) {
  if (S.setcariSourceMode === mode) return;
  S.setcariSourceMode = mode;
  S.setcariSrcClip.classList.toggle('on', mode === 'clip');
  S.setcariSrcPaste.classList.toggle('on', mode === 'paste');
  S.setcariSrcClip.setAttribute('aria-pressed', String(mode === 'clip'));
  S.setcariSrcPaste.setAttribute('aria-pressed', String(mode === 'paste'));
  S.setcariPasteWrap.style.display = mode === 'paste' ? 'block' : 'none';
  S.setcariList.innerHTML = '';
  S.setcariBadge.style.display = 'none';
  setcariSetStatus('');
  showSetcariIntro();
  updateSetcariSourceCount();
}
// Pintu sumber dipilih otomatis waktu tab dibuka: Clipboard kosong -> langsung tampilkan kotak
// paste-an (tab ini gak boleh kelihatan kosong melompong), Clipboard ada isi -> pakai Clipboard.
// Berhenti ikut-ikutan begitu user milih sendiri (setcariSourceTouched), kalau kotak paste-an
// sudah ada isinya, atau kalau hasil pencarian lagi tampil — jangan sampai ngerusak kerjaan user.
S.setcariSourceTouched = false;
function autoPickSetcariSource() {
  if (S.setcariSourceTouched) return;
  if (S.setcariList.children.length) return;
  if (S.setcariPasteInput.value.trim()) return;
  setSetcariSourceMode(S.clipboard.length ? 'clip' : 'paste');
}
S.autoPickSetcariSource = autoPickSetcariSource;
S.setcariSrcClip.addEventListener('click', () => { S.setcariSourceTouched = true; setSetcariSourceMode('clip'); });
S.setcariSrcPaste.addEventListener('click', () => { S.setcariSourceTouched = true; setSetcariSourceMode('paste'); });
S.setcariPasteInput.addEventListener('input', () => updateSetcariSourceCount());

// Toggle "Termasuk substitusi": OFF = RPC lama (cari_set_mendekati), perilaku tidak berubah.
// ON = cari_set_mendekati_v2 (famili + ukuran dekat). Ganti mode -> hasil lama dibersihkan
// supaya persen persis/substitusi tidak tercampur dalam satu daftar.
function setcariSubstitusiOn() {
  const el = document.getElementById('setcari-sub-chk');
  return !!(el && el.checked);
}
{
  const chk = document.getElementById('setcari-sub-chk');
  if (chk) chk.addEventListener('change', () => {
    S.setcariList.innerHTML = '';
    S.setcariBadge.style.display = 'none';
    setcariSetStatus('');
    showSetcariIntro();
  });
}

function setcariSetStatus(msg, isError) {
  S.setcariStatus.textContent = msg || '';
  S.setcariStatus.classList.toggle('error', !!isError);
}

function setcariSkorClass(skor) {
  if (skor >= 0.7) return 'high';
  if (skor >= 0.4) return 'mid';
  return 'low';
}

async function runCariSetMendekati() {
  const kodeList = setcariSourceKodeList();
  if (kodeList.length === 0) {
    setcariSetStatus(S.setcariSourceMode === 'paste' ? 'Tempel kode produk dulu di kotak di atas.' : 'Clipboard masih kosong. Tambahkan produk dulu.', true);
    return;
  }
  S.setcariSearchBtn.disabled = true;
  setcariSetStatus('Mencari SET…');
  S.setcariEmpty.style.display = 'none';
  S.setcariList.innerHTML = '';
  S.setcariBadge.style.display = 'none';
  try {
    const useSub = setcariSubstitusiOn();
    const { data, error } = useSub
      ? await S.rpc('cari_set_mendekati_v2', { kode_list: kodeList, izinkan_substitusi: true, batas: 30 })
      : await S.rpc('cari_set_mendekati', { kode_list: kodeList, batas: 30 });
    if (error) throw new Error(error.message || 'Gagal mencari SET');
    if (!data || data.length === 0) {
      setcariSetStatus('');
      showSetcariEmptyMsg(S.setcariSourceMode === 'paste'
        ? 'Tidak ada SET yang cocok dengan kode yang ditempel.'
        : 'Tidak ada SET yang cocok dengan produk di Clipboard saat ini.');
      return;
    }
    setcariSetStatus(`${data.length} SET ditemukan, diurutkan dari yang paling mirip.`);
    S.setcariBadge.textContent = data.length;
    S.setcariBadge.style.display = 'inline-block';
    renderSetcariResults(data, kodeList, useSub);
  } catch (err) {
    setcariSetStatus('Gagal mencari SET: ' + err.message, true);
  } finally {
    S.setcariSearchBtn.disabled = setcariSourceKodeList().length === 0;
  }
}

function renderSetcariResults(rows, kodeList, useSub) {
  S.setcariList.innerHTML = rows.map(row => {
    const skor = useSub ? row.skor_substitusi : row.skor_jaccard;
    const pct = Math.round((skor || 0) * 100);
    const cls = setcariSkorClass(skor || 0);
    const subInfo = useSub
      ? (row.jumlah_substitusi > 0 ? `, <b>${row.jumlah_substitusi}</b> lewat substitusi ukuran` : '')
        + (row.jumlah_famili_beda > 0 ? `, ${row.jumlah_famili_beda} sekeluarga tapi beda ukuran` : '')
      : '';
    const scoreTip = useSub
      ? 'Kemiripan isi termasuk substitusi ukuran (selisih ≤ 5 mm, produk sekeluarga). Persis saja: ' + Math.round((row.skor_jaccard || 0) * 100) + '%'
      : 'Kemiripan isi: item yang sama dibagi gabungan item input dan isi SET';
    const detailId = `setcari-detail-${row.set_id}`;
    return `<div class="setcari-card" data-set-id="${row.set_id}">
      <div class="setcari-card-top">
        <div class="setcari-card-id">
          <div class="setcari-kode">${S.escapeHtmlAttr(row.kode_set)}</div>
          ${row.nama_set ? `<div class="setcari-nama">${S.escapeHtmlAttr(row.nama_set)}</div>` : ''}
          <div class="setcari-cocok">${row.jumlah_cocok} dari ${row.total_item_set} item SET cocok persis${subInfo}</div>
        </div>
        <div class="setcari-score-wrap" title="${S.escapeHtmlAttr(scoreTip)}">
          <div class="setcari-score ${cls}">${pct}%</div>
          <div class="setcari-bar-track" role="img" aria-label="Kemiripan ${pct} persen"><div class="setcari-bar-fill" style="width:${pct}%"></div></div>
        </div>
      </div>
      <div class="setcari-card-actions">
        <button class="setcari-detail-btn" type="button" data-action="toggle-detail" data-set-id="${row.set_id}" aria-expanded="false" aria-controls="${detailId}">Lihat isi</button>
        <button class="setcari-detail-btn" type="button" data-action="add-clip" data-kode="${S.escapeHtmlAttr(row.kode_set)}"><i class="ti ti-plus"></i> Tambah ke Clipboard</button>
      </div>
      <div class="setcari-detail" id="${detailId}" data-detail-for="${row.set_id}" style="display:none"></div>
    </div>`;
  }).join('');

  S.setcariList.querySelectorAll('button[data-action="toggle-detail"]').forEach(btn => {
    btn.addEventListener('click', () => toggleSetcariDetail(btn, kodeList, useSub));
  });
  S.setcariList.querySelectorAll('button[data-action="add-clip"]').forEach(btn => {
    btn.addEventListener('click', () => addSetKodeToClip(btn.dataset.kode, btn));
  });
}

// Tambah SET hasil pencarian langsung ke Clipboard tanpa harus balik ke tab
// pencarian produk dulu — cari by kode_produk persis lewat
// findProdukByKodeExact() (shared sama modul Converter, lihat komentarnya).
async function addSetKodeToClip(kode, btn) {
  if (!kode) return;
  if (S.clipboard.some(c => c.kode_produk === kode)) {
    S.showToast('SET ini sudah ada di Clipboard.', 'error');
    return;
  }
  btn.disabled = true;
  const originalHtml = btn.innerHTML;
  btn.textContent = 'Menambahkan…';
  try {
    const { produk: match, errMsg } = await S.findProdukByKodeExact(kode);
    if (errMsg) throw new Error(errMsg);
    if (!match) throw new Error('SET ini tidak ada di katalog.');
    if (!S.isProdukFirm(match) && !S.modeSwastaOutput) throw new Error('SET ini belum firm (link V6 masih ada catatan), jadi tidak dipakai untuk konversi.');
    S.lastResults = S.lastResults && S.lastResults.length ? S.lastResults.concat([match]) : [match];
    S.addToClip(kode);
    S.showToast(`${kode} ditambahkan ke Clipboard`);
    btn.innerHTML = '<i class="ti ti-check"></i> Ditambahkan';
  } catch (err) {
    S.showToast('Gagal menambahkan: ' + err.message, 'error');
    btn.innerHTML = originalHtml;
    btn.disabled = false;
  }
}
S.addSetKodeToClip = addSetKodeToClip;

async function toggleSetcariDetail(btn, kodeList, useSub) {
  const setId = btn.dataset.setId;
  const detailEl = S.setcariList.querySelector(`[data-detail-for="${setId}"]`);
  if (!detailEl) return;
  if (detailEl.style.display !== 'none') {
    detailEl.style.display = 'none';
    btn.textContent = 'Lihat isi';
    btn.setAttribute('aria-expanded', 'false');
    return;
  }
  btn.textContent = 'Memuat…';
  try {
    const { data, error } = useSub
      ? await S.rpc('detail_isi_set_v2', { p_set_id: Number(setId), kode_list: kodeList })
      : await S.rpc('detail_isi_set', { p_set_id: Number(setId), kode_list: kodeList });
    if (error) throw new Error(error.message || 'Gagal ambil detail SET');
    const lines = (data || []).map(it => {
      // v2: cocok_tipe; v1: cocok_dengan_input. Substitusi SELALU diberi lencana + selisih + produk yang digantikan.
      const tipe = it.cocok_tipe || (it.cocok_dengan_input ? 'persis' : 'tidak');
      const selisih = it.selisih_mm != null ? Number(it.selisih_mm) : null;
      const selTxt = selisih != null ? (selisih === 0 ? 'ukuran sama' : `selisih ${+(selisih / 10).toFixed(2)} cm`) : '';
      let tag = '';
      if (tipe === 'persis') tag = '<span class="setcari-item-tag">cocok</span>';
      else if (tipe === 'famili_dekat') tag = `<span class="setcari-item-tag sub" title="Pengganti untuk ${S.escapeHtmlAttr(it.pengganti_kode || '')}">substitusi · ${S.escapeHtmlAttr(selTxt)}</span>`;
      else if (tipe === 'famili_beda') tag = `<span class="setcari-item-tag beda" title="Sekeluarga dengan ${S.escapeHtmlAttr(it.pengganti_kode || '')} tapi ukuran beda">beda ukuran · ${S.escapeHtmlAttr(selTxt)}</span>`;
      const mengganti = (tipe === 'famili_dekat' || tipe === 'famili_beda') && it.pengganti_nama
        ? `<div class="setcari-item-ganti">menggantikan: ${S.escapeHtmlAttr(it.pengganti_nama)}</div>` : '';
      const cls = tipe === 'persis' ? 'match' : (tipe === 'famili_dekat' ? 'sub' : '');
      return `
      <div class="setcari-item-line ${cls}">
        <span class="setcari-item-main"><span class="setcari-item-no">${it.urutan}</span><span class="setcari-item-kode">${S.escapeHtmlAttr(it.kode_item)}</span><span class="setcari-item-nama">${S.escapeHtmlAttr(it.nama_item || '')}${mengganti}</span></span>
        <span class="setcari-item-qty">qty ${it.qty}${tag}</span>
      </div>`;
    }).join('');
    detailEl.innerHTML = lines || '<div class="setcari-detail-empty">SET ini tidak punya item.</div>';
    detailEl.style.display = 'flex';
    btn.textContent = 'Sembunyikan';
    btn.setAttribute('aria-expanded', 'true');
  } catch (err) {
    setcariSetStatus('Gagal memuat isi SET: ' + err.message, true);
    btn.textContent = 'Lihat isi';
  }
}

S.setcariSearchBtn.addEventListener('click', runCariSetMendekati);

}