// AUTO-EXTRACTED dari konversian/index.js (breakup sesuai map.md bagian 3) — Claude, 2026-09-15.
// Region asli: lihat map.md bagian 2. Semua state lintas-file diakses lewat
// objek 'S' yang dioper dari index.js (S = window.__konvBridge-style shared
// state, TAPI bukan window global — cuma dioper sebagai parameter, lihat
// index.js: const S = {}; lalu install*(S) dipanggil berurutan).
// Logic di dalam TIDAK diubah — cuma referensi ke variabel/fungsi yang
// didefinisikan di file LAIN diganti jadi S.nama (lihat COORD LOG index.js).
export function installSetMendekati(S) {
// ══════════════════════════════════════════
// CARI SET MENDEKATI: dulu tool HTML terpisah (tempel kode_produk manual ke
// textarea, panggil RPC cari_set_mendekati/detail_isi_set). Sekarang dilebur
// jadi tab clipboard, sumber kode_produk-nya otomatis dari item yang ada di
// Clipboard sesi ini (bukan input manual lagi) — biar seamless: user tinggal
// klik "Cari SET Mendekati", gak perlu copy-paste kode dari clipboard ke tool
// lain. RPC dipanggil lewat helper rpc() yang sudah ada (pola sama kayak
// get_set_items dkk — pakai ANON_KEY, bukan stokAccessToken, karena RPC ini
// read-only/security-definer).
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
  const noun = S.setcariSourceMode === 'paste' ? 'kode yang di-paste' : 'produk yang lagi ada di Clipboard';
  S.setcariSourceLabel.innerHTML = `Nyari SET dengan isi paling mirip <b>${n}</b> ${noun}`;
  S.setcariSearchBtn.disabled = n === 0;
}
S.updateSetcariSourceCount = updateSetcariSourceCount;

function updateSetcariEmptyHint() {
  const p = S.setcariEmpty.querySelector('p');
  p.textContent = S.setcariSourceMode === 'paste'
    ? 'Paste daftar kode produk di atas (1 per baris atau dipisah koma), lalu klik "Cari SET Mendekati" buat lihat SET yang isinya paling mirip.'
    : 'Tambahkan produk ke Clipboard dulu, lalu klik "Cari SET Mendekati" buat lihat SET yang isinya paling mirip sama produk-produk itu.';
}

// Pindah pintu sumber: hasil pencarian sebelumnya (dari sumber lain) udah
// gak relevan lagi, jadi di-reset — daripada nampilin hasil SET yang
// ternyata bukan dari kode yang lagi aktif dipakai.
function setSetcariSourceMode(mode) {
  if (S.setcariSourceMode === mode) return;
  S.setcariSourceMode = mode;
  S.setcariSrcClip.classList.toggle('on', mode === 'clip');
  S.setcariSrcPaste.classList.toggle('on', mode === 'paste');
  S.setcariPasteWrap.style.display = mode === 'paste' ? 'block' : 'none';
  S.setcariList.innerHTML = '';
  S.setcariBadge.style.display = 'none';
  setcariSetStatus('');
  S.setcariEmpty.style.display = 'block';
  updateSetcariEmptyHint();
  updateSetcariSourceCount();
}
S.setcariSrcClip.addEventListener('click', () => setSetcariSourceMode('clip'));
S.setcariSrcPaste.addEventListener('click', () => setSetcariSourceMode('paste'));
S.setcariPasteInput.addEventListener('input', () => updateSetcariSourceCount());

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
    setcariSetStatus(S.setcariSourceMode === 'paste' ? 'Paste kode produk dulu di kotak atas.' : 'Clipboard masih kosong — tambahkan produk dulu.', true);
    return;
  }
  S.setcariSearchBtn.disabled = true;
  setcariSetStatus('Mencari…');
  S.setcariEmpty.style.display = 'none';
  S.setcariList.innerHTML = '';
  S.setcariBadge.style.display = 'none';
  try {
    const { data, error } = await S.rpc('cari_set_mendekati', { kode_list: kodeList, batas: 30 });
    if (error) throw new Error(error.message || 'Gagal mencari SET');
    if (!data || data.length === 0) {
      setcariSetStatus('');
      S.setcariEmpty.style.display = 'block';
      S.setcariEmpty.querySelector('p').textContent = 'Tidak ada SET yang cocok ditemukan buat produk-produk di clipboard sekarang.';
      return;
    }
    setcariSetStatus(`Ditemukan ${data.length} SET, diurutkan dari yang paling mirip.`);
    S.setcariBadge.textContent = data.length;
    S.setcariBadge.style.display = 'inline-block';
    renderSetcariResults(data, kodeList);
  } catch (err) {
    setcariSetStatus('Gagal mencari: ' + err.message, true);
  } finally {
    S.setcariSearchBtn.disabled = setcariSourceKodeList().length === 0;
  }
}

function renderSetcariResults(rows, kodeList) {
  S.setcariList.innerHTML = rows.map(row => {
    const pct = Math.round(row.skor_jaccard * 100);
    const cls = setcariSkorClass(row.skor_jaccard);
    return `<div class="setcari-card" data-set-id="${row.set_id}">
      <div class="setcari-card-top">
        <div>
          <div class="setcari-kode">${S.escapeHtmlAttr(row.kode_set)}</div>
          ${row.nama_set ? `<div class="setcari-nama">${S.escapeHtmlAttr(row.nama_set)}</div>` : ''}
          <div class="setcari-cocok" style="margin-top:4px">${row.jumlah_cocok} / ${row.total_item_set} item set cocok</div>
        </div>
        <div class="setcari-score-wrap">
          <div class="setcari-score ${cls}">${pct}%</div>
          <div class="setcari-bar-track"><div class="setcari-bar-fill" style="width:${pct}%"></div></div>
        </div>
      </div>
      <div class="setcari-card-actions">
        <button class="setcari-detail-btn" type="button" data-action="toggle-detail" data-set-id="${row.set_id}">Lihat isi</button>
        <button class="setcari-detail-btn" type="button" data-action="add-clip" data-kode="${S.escapeHtmlAttr(row.kode_set)}">+ Tambah ke Clipboard</button>
      </div>
      <div class="setcari-detail" data-detail-for="${row.set_id}" style="display:none"></div>
    </div>`;
  }).join('');

  S.setcariList.querySelectorAll('button[data-action="toggle-detail"]').forEach(btn => {
    btn.addEventListener('click', () => toggleSetcariDetail(btn, kodeList));
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
    S.showToast('SET ini sudah ada di clipboard.', 'error');
    return;
  }
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = 'Menambahkan…';
  try {
    const { produk: match, errMsg } = await S.findProdukByKodeExact(kode);
    if (errMsg) throw new Error(errMsg);
    if (!match) throw new Error('Produk SET tidak ditemukan di database.');
    S.lastResults = S.lastResults && S.lastResults.length ? S.lastResults.concat([match]) : [match];
    S.addToClip(kode);
    S.showToast(`${kode} ditambahkan ke clipboard ✓`);
    btn.textContent = 'Ditambahkan ✓';
  } catch (err) {
    S.showToast('Gagal menambahkan: ' + err.message, 'error');
    btn.textContent = originalText;
    btn.disabled = false;
  }
}
S.addSetKodeToClip = addSetKodeToClip;

async function toggleSetcariDetail(btn, kodeList) {
  const setId = btn.dataset.setId;
  const detailEl = S.setcariList.querySelector(`[data-detail-for="${setId}"]`);
  if (!detailEl) return;
  if (detailEl.style.display !== 'none') {
    detailEl.style.display = 'none';
    btn.textContent = 'Lihat isi';
    return;
  }
  btn.textContent = 'Memuat…';
  try {
    const { data, error } = await S.rpc('detail_isi_set', { p_set_id: Number(setId), kode_list: kodeList });
    if (error) throw new Error(error.message || 'Gagal ambil detail SET');
    const lines = (data || []).map(it => `
      <div class="setcari-item-line ${it.cocok_dengan_input ? 'match' : ''}">
        <span>${it.urutan}. ${S.escapeHtmlAttr(it.kode_item)} — ${S.escapeHtmlAttr(it.nama_item || '')}</span>
        <span>qty ${it.qty}${it.cocok_dengan_input ? '<span class="setcari-item-tag">cocok</span>' : ''}</span>
      </div>`).join('');
    detailEl.innerHTML = lines || '<div class="setcari-detail-empty">Tidak ada item.</div>';
    detailEl.style.display = 'flex';
    btn.textContent = 'Sembunyikan';
  } catch (err) {
    setcariSetStatus('Gagal ambil detail: ' + err.message, true);
    btn.textContent = 'Lihat isi';
  }
}

S.setcariSearchBtn.addEventListener('click', runCariSetMendekati);

}
