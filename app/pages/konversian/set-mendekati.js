// Modul hasil pecahan dari konversian/index.js. State lintas-file diakses lewat objek
// 'S' yang dioper dari index.js (bukan window global; lihat `const S = {}` di mount()
// lalu install*(S) dipanggil berurutan). Referensi ke variabel/fungsi yang didefinisikan
// di file LAIN ditulis S.nama (lihat COORD LOG di index.js).
export function installSetMendekati(S) {
// ══════════════════════════════════════════
// CARI SET MENDEKATI: dulu tool HTML terpisah (kode_produk ditempel manual ke
// textarea, lalu RPC cari_set_mendekati/detail_isi_set). Sekarang jadi subtab; sumber
// kodenya otomatis dari item di Clipboard sesi ini, atau dari paste-an sheet permintaan
// (nama item biasa ATAU kode; nama dipetakan ke produk lewat suggest_dictionary, hasil
// pemetaan bisa dikoreksi per baris). Hasil perbandingan punya kolom justifikasi (otomatis
// dari data, bisa diedit) dan bisa disalin sebagai TSV ke Excel. RPC dipanggil
// lewat helper rpc() yang sudah ada (pola sama dengan get_set_items dkk): rpc() jalan
// lewat sesiFetch() -> Authorization pakai token sesi user yang login (BUKAN anon).
// ══════════════════════════════════════════
// Pintu Clipboard: kode sumber = kode_produk unik dari clipboard (kode_asli dipakai kalau ada,
// sama kayak konvensi kode buat gambar/thumbnail di bagian lain app ini).
function setcariClipboardKodeList() {
  const seen = new Set();
  const out = [];
  S.clipboard.forEach(c => {
    const kode = (c.kode_asli && c.kode_asli.trim()) ? c.kode_asli.trim() : c.kode_produk;
    if (kode && !seen.has(kode)) { seen.add(kode); out.push(kode); }
  });
  return out;
}

// Pintu paste-an: satu baris = satu item permintaan. Baris yang isinya kode produk (token
// ber-strip, tanpa spasi; boleh beberapa dipisah koma) dipakai apa adanya. Baris lain dianggap
// teks permintaan ("Gunting perban 14 cm 2 pcs"): qty & basa-basi dibersihkan oleh parser
// Permintaan RS (S.parseTeksPermintaan), lalu dipetakan ke produk oleh resolveSetcariEntries().
const SETCARI_KODE_RE = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+){2,}$/;
const SETCARI_SKIP = '__skip__';
function parseSetcariPaste(raw) {
  const entries = [];
  const seenKode = new Set();
  const seenTeks = new Set();
  let skipped = 0;
  String(raw || '').split('\n').map(l => l.trim()).filter(Boolean).forEach(line => {
    const tokens = line.split(',').map(t => t.trim()).filter(Boolean);
    if (tokens.length && tokens.every(t => SETCARI_KODE_RE.test(t))) {
      tokens.forEach(kode => {
        if (seenKode.has(kode)) return;
        seenKode.add(kode);
        entries.push({ raw: kode, qty: null, kodeLangsung: true, kode, cands: [] });
      });
      return;
    }
    const parsed = typeof S.parseTeksPermintaan === 'function'
      ? S.parseTeksPermintaan(line)
      : [{ raw_text: line, qty: null }];
    skipped += (parsed._skipped || []).length;
    parsed.forEach(it => {
      // Parser Permintaan RS menganggap angka di ujung ("Trocar 10") sebagai qty. Di sini angka itu
      // lebih sering ukuran ("Gunting perban 14"), dan ukuran dibutuhkan buat memetakan produk,
      // jadi kalau tidak ada kata satuan (pcs/unit/set/...) angka itu dikembalikan ke teks.
      const bersih = line.replace(/^\d+[.)]\s+/, '').replace(/^[*\-•●▪‣·]+\s*/, '').replace(/@.*$/, '').trim();
      if (it.qty && /\s\d+$/.test(bersih) && !/\b(unit|set|pcs|buah|box|pak|lusin)\b/i.test(bersih)) {
        it = Object.assign({}, it, { raw_text: bersih, qty: null });
      }
      const key = it.raw_text.toLowerCase();
      if (seenTeks.has(key)) return;
      seenTeks.add(key);
      entries.push({ raw: it.raw_text, qty: it.qty || null, kodeLangsung: false, kode: null, cands: [] });
    });
  });
  entries._skipped = skipped;
  return entries;
}

// Kode yang dikirim ke RPC = hasil pemetaan (baris yang diabaikan / belum dikenali tidak ikut), unik.
function kodeListFromEntries(entries) {
  const seen = new Set();
  const out = [];
  (entries || []).forEach(e => { if (e.kode && !seen.has(e.kode)) { seen.add(e.kode); out.push(e.kode); } });
  return out;
}

// Pemetaan teks -> produk memakai mesin Dictionary yang sama dengan Kebutuhan RS (suggest_dictionary).
// Cache per teks supaya cari ulang tidak menembak RPC lagi; pilihan manual user (ganti produk / abaikan)
// diingat per teks dan menang atas tebakan sistem.
const suggCache = new Map();
const pilihanUser = new Map();
function candidatesFromRows(rows) {
  const seen = new Set();
  const out = [];
  (rows || []).forEach(r => {
    if (!r.kode_produk || seen.has(r.kode_produk)) return;
    seen.add(r.kode_produk);
    out.push({ kode: r.kode_produk, nama: r.nama_produk || '', tier: r.tier || '', ukuran: r.ukuran || '',
      istilah: r.istilah || '', skor: Number(r.skor) || 0, isSet: !!r.is_set });
  });
  return out.slice(0, 6);
}
// Urutan RPC sudah skor desc. Default dipilih hanya dari istilah dengan skor teratas (jangan loncat
// ke istilah umum seperti "GUNTING" cuma karena ukurannya kebetulan cocok), lalu ukuran terbaik, bukan SET.
const UKURAN_RANK = { cocok: 0, tidak_diminta: 0, tidak_diketahui: 1, dekat: 1, varian: 3, beda: 4 };
function pickBestCand(cands) {
  if (!cands.length) return null;
  const top = cands[0].skor;
  const pool = cands.filter(c => c.skor === top && !c.isSet);
  const use = pool.length ? pool : cands;
  return use.slice().sort((a, b) => (UKURAN_RANK[a.ukuran] ?? 2) - (UKURAN_RANK[b.ukuran] ?? 2))[0];
}
function candConf(c) {
  if (!c) return 'none';
  if (c.ukuran === 'beda' || c.ukuran === 'varian') return 'lemah';
  if (c.tier === 'exact' || c.tier === 'urutan') return 'kuat';
  if (c.tier === 'keluarga' || c.tier === 'katalog' || c.tier === 'varian') return 'sedang';
  return 'lemah';
}
const CONF_LABEL = { kuat: 'Pernah dipakai', sedang: 'Mirip', lemah: 'Perkiraan, cek dulu', none: 'Tidak dikenali' };

async function resolveSetcariEntry(e) {
  let cands = suggCache.get(e.raw);
  e.error = null;
  if (!cands) {
    try {
      const { data, error } = await S.rpc('suggest_dictionary', { p_text: e.raw, p_limit: 3 });
      if (error) throw new Error(error.message || error.hint || 'suggest_dictionary gagal');
      cands = candidatesFromRows(data);
      suggCache.set(e.raw, cands);
    } catch (err) {
      cands = [];
      e.error = err.message;
    }
  }
  e.cands = cands;
  const ov = pilihanUser.get(e.raw);
  if (ov === SETCARI_SKIP) { e.skip = true; e.kode = null; }
  else if (ov) { e.skip = false; e.kode = ov; }
  else { e.skip = false; const best = pickBestCand(cands); e.kode = best ? best.kode : null; }
}
async function resolveSetcariEntries(entries) {
  const todo = entries.filter(e => !e.kodeLangsung);
  let next = 0, done = 0;
  const worker = async () => {
    while (next < todo.length) {
      const e = todo[next++];
      await resolveSetcariEntry(e);
      done++;
      setcariSetStatus(`Memetakan permintaan ke produk… ${done}/${todo.length}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, todo.length) }, worker));
}

function setcariSourceCount() {
  if (S.setcariSourceMode === 'paste') return parseSetcariPaste(S.setcariPasteInput.value).length;
  return setcariClipboardKodeList().length;
}

function updateSetcariSourceCount() {
  const n = setcariSourceCount();
  const noun = S.setcariSourceMode === 'paste' ? 'baris dari paste-an' : 'produk di Clipboard';
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
  S.setcariMap = [];
  renderSetcariMap();
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
// Opsi fleksibel (hanya berlaku saat substitusi ON): toleransi ukuran (mm) & izin TC <-> non-TC.
function setcariOpts() {
  const tol = document.getElementById('setcari-tol');
  const tc = document.getElementById('setcari-tc-chk');
  return { tol: tol ? Number(tol.value) : 5.01, lintasTc: !!(tc && tc.checked) };
}
{
  const resetHasil = () => {
    S.setcariMap = [];
    renderSetcariMap();
    S.setcariList.innerHTML = '';
    S.setcariBadge.style.display = 'none';
    setcariSetStatus('');
    showSetcariIntro();
  };
  const chk = document.getElementById('setcari-sub-chk');
  const opts = document.getElementById('setcari-sub-opts');
  if (chk) chk.addEventListener('change', () => { if (opts) opts.hidden = !chk.checked; resetHasil(); });
  ['setcari-tol', 'setcari-tc-chk'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', resetHasil);
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

S.setcariMap = [];
S.setcariMapOpen = null; // null = otomatis (terbuka kalau ada baris yang perlu dicek), true/false = pilihan user

function esc(v) { return S.escapeHtmlAttr(v == null ? '' : String(v)); }

// Panel "Pemetaan permintaan": tiap baris teks -> produk yang dipakai buat mencari SET. Baris dengan
// kode langsung tidak ditampilkan (tidak ada yang perlu dikoreksi), hanya dihitung di ringkasan.
function renderSetcariMap() {
  const box = document.getElementById('setcari-map');
  if (!box) return;
  const entries = S.setcariMap || [];
  const teks = entries.filter(e => !e.kodeLangsung);
  if (!teks.length) { box.hidden = true; box.innerHTML = ''; return; }
  const chosen = e => (e.cands || []).find(c => c.kode === e.kode) || null;
  const confOf = e => e.skip ? 'skip' : (e.kode ? candConf(chosen(e)) : 'none');
  const cnt = { kuat: 0, sedang: 0, lemah: 0, none: 0, skip: 0 };
  teks.forEach(e => { cnt[confOf(e)]++; });
  const perluCek = cnt.lemah + cnt.none;
  const langsung = entries.length - teks.length;
  const ringkas = [
    `${teks.length - cnt.none - cnt.skip} dari ${teks.length} baris terpetakan`,
    perluCek ? `${perluCek} perlu dicek` : '',
    cnt.skip ? `${cnt.skip} diabaikan` : '',
    langsung ? `${langsung} kode langsung` : ''
  ].filter(Boolean).join(', ');
  const open = S.setcariMapOpen == null ? perluCek > 0 : S.setcariMapOpen;
  const rows = teks.map(e => {
    const idx = entries.indexOf(e);
    const conf = confOf(e);
    const opts = (e.cands || []).map(c => {
      const sfx = c.ukuran === 'beda' ? ' (ukuran beda)' : (c.ukuran === 'dekat' ? ' (ukuran dekat)' : '');
      return `<option value="${esc(c.kode)}"${c.kode === e.kode ? ' selected' : ''}>${esc(c.nama || c.kode)} (${esc(c.kode)})${sfx}</option>`;
    }).join('');
    const kosong = `<option value=""${!e.kode ? ' selected' : ''}>${e.skip ? 'Diabaikan' : ((e.cands || []).length ? 'Abaikan baris ini' : 'Belum ada produk yang cocok')}</option>`;
    return `<div class="sc-map-row conf-${conf}" data-i="${idx}">
      <div class="sc-map-raw"><span class="sc-map-text">${esc(e.raw)}</span>${e.qty ? `<span class="sc-map-qty">× ${e.qty}</span>` : ''}</div>
      <select class="sc-map-sel conv-select" data-ui-icon="ti-link" data-i="${idx}" aria-label="Produk untuk ${esc(e.raw)}">${opts}${kosong}</select>
      <span class="sc-map-conf">${esc(e.error ? 'Gagal dicek' : (conf === 'skip' ? 'Diabaikan' : CONF_LABEL[conf]))}</span>
    </div>`;
  }).join('');
  box.hidden = false;
  box.innerHTML = `<details class="sc-map"${open ? ' open' : ''}>
    <summary><span class="sc-map-title">Pemetaan permintaan</span><span class="sc-map-sum${perluCek ? ' warn' : ''}">${esc(ringkas)}</span></summary>
    <div class="sc-map-rows">${rows}</div>
  </details>`;
  const det = box.querySelector('details');
  det.addEventListener('toggle', () => { S.setcariMapOpen = det.open; });
  box.querySelectorAll('select.sc-map-sel').forEach(sel => {
    sel.addEventListener('change', () => {
      const e = (S.setcariMap || [])[Number(sel.dataset.i)];
      if (!e) return;
      pilihanUser.set(e.raw, sel.value || SETCARI_SKIP);
      e.skip = !sel.value;
      e.kode = sel.value || null;
      const i = sel.dataset.i;
      renderSetcariMap();
      // render ulang membuang tombol dropdown yang tadi fokus; kembalikan supaya keyboard tidak "jatuh"
      setTimeout(() => { const b = box.querySelector(`.sc-map-row[data-i="${i}"] .ui-select-btn`); if (b) b.focus(); }, 0);
      scheduleSetcariRerun();
    });
  });
}

// Ganti pilihan produk di panel pemetaan -> cari ulang otomatis (tanpa resolve ulang), ditahan sebentar
// supaya beberapa koreksi beruntun cuma menembak RPC sekali.
let rerunTimer = null;
function scheduleSetcariRerun() {
  clearTimeout(rerunTimer);
  rerunTimer = setTimeout(() => {
    const kodeList = kodeListFromEntries(S.setcariMap);
    searchSetcari(kodeList);
  }, 350);
}

async function runCariSetMendekati() {
  clearTimeout(rerunTimer);
  const pasteMode = S.setcariSourceMode === 'paste';
  S.setcariSearchBtn.disabled = true;
  try {
    if (!pasteMode) {
      S.setcariMap = [];
      renderSetcariMap();
      const kodeList = setcariClipboardKodeList();
      if (kodeList.length === 0) { setcariSetStatus('Clipboard masih kosong. Tambahkan produk dulu.', true); return; }
      await searchSetcari(kodeList);
      return;
    }
    const entries = parseSetcariPaste(S.setcariPasteInput.value);
    if (entries.length === 0) { setcariSetStatus('Tempel daftar item dulu di kotak di atas.', true); return; }
    S.setcariList.innerHTML = '';
    S.setcariBadge.style.display = 'none';
    S.setcariEmpty.style.display = 'none';
    setcariSetStatus('Membaca permintaan…');
    await resolveSetcariEntries(entries);
    S.setcariMap = entries;
    S.setcariMapOpen = null;
    renderSetcariMap();
    await searchSetcari(kodeListFromEntries(entries), entries._skipped || 0);
  } finally {
    S.setcariSearchBtn.disabled = setcariSourceCount() === 0;
  }
}

async function searchSetcari(kodeList, barisDisaring) {
  if (kodeList.length === 0) {
    S.setcariList.innerHTML = '';
    S.setcariBadge.style.display = 'none';
    setcariSetStatus('');
    showSetcariEmptyMsg('Belum ada baris yang terpetakan ke produk. Pilih produk di panel Pemetaan, atau tempel kode produk langsung.');
    return;
  }
  setcariSetStatus('Mencari SET…');
  S.setcariEmpty.style.display = 'none';
  S.setcariList.innerHTML = '';
  S.setcariBadge.style.display = 'none';
  try {
    const useSub = setcariSubstitusiOn();
    const { data, error } = useSub
      ? await S.rpc('cari_set_mendekati_v2', { kode_list: kodeList, izinkan_substitusi: true, batas: 30, p_toleransi_mm: setcariOpts().tol, p_lintas_tc: setcariOpts().lintasTc })
      : await S.rpc('cari_set_mendekati', { kode_list: kodeList, batas: 30 });
    if (error) throw new Error(error.message || 'Gagal mencari SET');
    if (!data || data.length === 0) {
      setcariSetStatus('');
      showSetcariEmptyMsg(S.setcariSourceMode === 'paste'
        ? 'Tidak ada SET yang cocok dengan item yang ditempel.'
        : 'Tidak ada SET yang cocok dengan produk di Clipboard saat ini.');
      return;
    }
    const catatan = barisDisaring ? ` ${barisDisaring} baris bukan item (judul/basa-basi) dilewati.` : '';
    setcariSetStatus(`${data.length} SET ditemukan, diurutkan dari yang paling mirip.${catatan}`);
    S.setcariBadge.textContent = data.length;
    S.setcariBadge.style.display = 'inline-block';
    renderSetcariResults(data, kodeList, useSub);
  } catch (err) {
    setcariSetStatus('Gagal mencari SET: ' + err.message, true);
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
      ? 'Kemiripan isi termasuk substitusi ukuran (produk sekeluarga, selisih dalam toleransi). Persis saja: ' + Math.round((row.skor_jaccard || 0) * 100) + '%'
      : 'Kemiripan isi: item yang sama dibagi gabungan item input dan isi SET';
    const detailId = `setcari-detail-${row.set_id}`;
    return `<div class="setcari-card" data-set-id="${row.set_id}">
      <div class="setcari-card-top">
        <div class="setcari-card-id">
          <div class="setcari-kode">${S.escapeHtmlAttr(row.kode_set)}</div>
          ${row.nama_set ? `<div class="setcari-nama">${S.escapeHtmlAttr(row.nama_set)}</div>` : ''}
          <div class="setcari-cocok">${row.jumlah_cocok} dari ${row.total_item_input != null ? row.total_item_input : kodeList.length} item diminta cocok persis${subInfo}. SET ini berisi ${row.total_item_set} item.</div>
        </div>
        <div class="setcari-score-wrap" title="${S.escapeHtmlAttr(scoreTip)}">
          <div class="setcari-score ${cls}">${pct}%</div>
          <div class="setcari-bar-track" role="img" aria-label="Kemiripan ${pct} persen"><div class="setcari-bar-fill" style="width:${pct}%"></div></div>
        </div>
      </div>
      <div class="setcari-card-actions">
        <button class="setcari-detail-btn" type="button" data-action="toggle-detail" data-set-id="${row.set_id}" aria-expanded="false" aria-controls="${detailId}">${useSub ? 'Bandingkan' : 'Lihat isi'}</button>
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

// Tombol "Tambah ke Clipboard" di kartu SET: cangkang UI saja (disabled/teks tombol + satu toast). Memuat produk dan
// memasangnya ke Clipboard dikerjakan S.pasangKeClipboard() (produk-katalog.js), yang juga dipakai Auto-Match.
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
    const hasil = await S.pasangKeClipboard(kode);
    if (!hasil.ok) throw new Error(S.ringkasGagalClip([hasil]));
    S.showToast(`${kode} ditambahkan ke Clipboard`);
    btn.innerHTML = '<i class="ti ti-check"></i> Ditambahkan';
  } catch (err) {
    S.showToast('Gagal menambahkan: ' + err.message, 'error');
    btn.innerHTML = originalHtml;
    btn.disabled = false;
  }
}

const STATUS_LABEL = {
  persis:        { ico: '✓', txt: 'Persis' },
  substitusi:    { ico: '⇄', txt: 'Substitusi' },
  beda_ukuran:   { ico: '≈', txt: 'Beda ukuran' },
  hanya_set:     { ico: '+', txt: 'Tambahan di SET' },
  hanya_input:   { ico: '−', txt: 'Tidak ada di SET' },
  tidak_dikenal: { ico: '?', txt: 'Kode tidak dikenal' },
  belum_dipetakan: { ico: '?', txt: 'Belum dipetakan' }
};
function fmtUkuranCm(arr) {
  if (!arr || !arr.length) return '';
  return arr.map(mm => (Number(mm) / 10).toLocaleString('id-ID', { maximumFractionDigits: 2 })).join(' × ') + ' cm';
}
function fmtSelisihCm(mm) {
  if (mm == null) return '';
  const n = Number(mm);
  return n === 0 ? 'ukuran sama' : 'selisih ' + (n / 10).toLocaleString('id-ID', { maximumFractionDigits: 2 }) + ' cm';
}

// Justifikasi otomatis dari data (selisih ukuran, TC <-> non-TC). Hanya usulan: kolomnya bisa diedit,
// dan "fungsi setara" tetap keputusan manusia, jadi baris beda_ukuran diberi tanda perlu dicek.
const isTcNama = nama => /\bTC\b|tungsten/i.test(nama || '');
function justifikasiOtomatis(r) {
  const selCm = (r.selisih_mm != null && Number(r.selisih_mm) > 0)
    ? (Number(r.selisih_mm) / 10).toLocaleString('id-ID', { maximumFractionDigits: 2 }) : '';
  switch (r.status) {
    case 'persis': return '';
    case 'substitusi':
    case 'beda_ukuran': {
      const parts = [];
      if (selCm) parts.push(`Selisih ukuran ${selCm} cm`);
      const tcIn = isTcNama(r.input_nama), tcSet = isTcNama(r.set_nama);
      if (tcIn && !tcSet) parts.push('non-TC');
      else if (!tcIn && tcSet) parts.push('versi TC');
      if (r.status === 'substitusi') parts.push('fungsi sama');
      return parts.join(', ') || (r.status === 'substitusi' ? 'Fungsi sama' : '');
    }
    case 'hanya_input': return 'Tidak tersedia di SET ini';
    case 'hanya_set': return 'Tambahan di SET (tidak diminta)';
    case 'belum_dipetakan': return 'Belum dipetakan ke produk';
    case 'tidak_dikenal': return 'Kode tidak dikenal';
    default: return '';
  }
}
// Perlu dicek manusia sebelum dikirim: sekeluarga tapi beda ukuran, atau TC <-> non-TC.
function justifikasiPerluCek(r) {
  if (r.status === 'beda_ukuran') return true;
  return (r.status === 'substitusi') && isTcNama(r.input_nama) !== isTcNama(r.set_nama);
}

function entryUntukKode(kode) {
  return kode ? (S.setcariMap || []).find(e => e.kode === kode && !e.kodeLangsung) : null;
}

// Perbandingan: kiri = yang diminta (teks asli dari sheet kalau ada), tengah = status, kanan = isi SET,
// ujung = justifikasi (bisa diedit). Baris mengikuti urutan permintaan; item SET yang tidak diminta di akhir;
// baris permintaan yang belum dipetakan ke produk ikut ditampilkan supaya tabel yang disalin lengkap.
function bandingRowsLengkap(rows, kodeList) {
  const order = new Map(kodeList.map((k, i) => [k, i]));
  const sorted = rows.slice().sort((a, b) => {
    const ia = order.has(a.input_kode) ? order.get(a.input_kode) : 1e6;
    const ib = order.has(b.input_kode) ? order.get(b.input_kode) : 1e6;
    return ia - ib;
  });
  const belum = (S.setcariMap || []).filter(e => !e.kodeLangsung && !e.kode && !e.skip)
    .map(e => ({ status: 'belum_dipetakan', input_kode: '', input_nama: e.raw, _raw: e.raw, _qty: e.qty }));
  return sorted.concat(belum);
}
function renderSetcariBanding(rowsRaw, kodeList) {
  const rows = bandingRowsLengkap(rowsRaw, kodeList);
  const cnt = {};
  rows.forEach(r => { cnt[r.status] = (cnt[r.status] || 0) + 1; });
  const chip = (st, label) => cnt[st] ? `<span class="sc-chip st-${st}">${cnt[st]} ${label}</span>` : '';
  const ringkas = [
    chip('persis', 'persis'), chip('substitusi', 'substitusi'), chip('beda_ukuran', 'beda ukuran'),
    chip('hanya_input', 'tidak ada di SET'), chip('hanya_set', 'tambahan di SET'),
    chip('belum_dipetakan', 'belum dipetakan'), chip('tidak_dikenal', 'kode tidak dikenal')
  ].join('');
  const cell = (kode, nama, ukuran, extra) => kode || nama
    ? `<div class="sc-cmp-kode">${S.escapeHtmlAttr(kode || '')}</div>
       <div class="sc-cmp-nama">${S.escapeHtmlAttr(nama || '')}</div>
       ${ukuran ? `<div class="sc-cmp-uk">${S.escapeHtmlAttr(ukuran)}</div>` : ''}${extra || ''}`
    : '<div class="sc-cmp-kosong">—</div>';
  const body = rows.map((r, i) => {
    const lb = STATUS_LABEL[r.status] || { ico: '', txt: r.status };
    const sel = (r.status === 'substitusi' || r.status === 'beda_ukuran') ? fmtSelisihCm(r.selisih_mm) : '';
    const kalimat = r.status === 'substitusi'
      ? `${r.set_kode} dapat menggantikan ${r.input_kode} (${sel})`
      : r.status === 'beda_ukuran' ? `${r.set_kode} sekeluarga dengan ${r.input_kode} tetapi ukurannya berbeda (${sel})` : '';
    const ent = entryUntukKode(r.input_kode);
    r._qtyDiminta = r._qty != null ? r._qty : (ent && ent.qty) || null;
    r._rawDiminta = r._raw || (ent && ent.raw) || '';
    let sisiInput;
    if (r.status === 'hanya_set') sisiInput = '<div class="sc-cmp-kosong">tidak diminta</div>';
    else if (r.status === 'belum_dipetakan') sisiInput = `<div class="sc-cmp-raw">${esc(r._rawDiminta)}${r._qtyDiminta ? `<span class="sc-map-qty">× ${r._qtyDiminta}</span>` : ''}</div>`;
    else {
      const raw = r._rawDiminta
        ? `<div class="sc-cmp-raw">${esc(r._rawDiminta)}${r._qtyDiminta ? `<span class="sc-map-qty">× ${r._qtyDiminta}</span>` : ''}</div>` : '';
      sisiInput = raw + cell(r.input_kode, r.input_nama, fmtUkuranCm(r.input_ukuran_mm));
    }
    const qtyWarn = (r.set_qty != null && r._qtyDiminta && Number(r.set_qty) < Number(r._qtyDiminta))
      ? `<div class="sc-cmp-qty warn">qty SET ${r.set_qty}, diminta ${r._qtyDiminta}</div>`
      : (r.set_qty != null ? `<div class="sc-cmp-qty">qty ${r.set_qty}</div>` : '');
    const sisiSet = (r.status === 'hanya_input' || r.status === 'tidak_dikenal' || r.status === 'belum_dipetakan')
      ? `<div class="sc-cmp-kosong">${r.status === 'belum_dipetakan' ? 'belum ada produk' : 'tidak ada di SET'}</div>`
      : cell(r.set_kode, r.set_nama, fmtUkuranCm(r.set_ukuran_mm), qtyWarn);
    const cek = justifikasiPerluCek(r);
    return `<div class="sc-cmp-row st-${r.status}"${kalimat ? ` title="${S.escapeHtmlAttr(kalimat)}"` : ''}>
      <div class="sc-cmp-side">${sisiInput}</div>
      <div class="sc-cmp-mid"><span class="sc-cmp-badge">${lb.ico} ${lb.txt}</span>${sel ? `<span class="sc-cmp-sel">${S.escapeHtmlAttr(sel)}</span>` : ''}</div>
      <div class="sc-cmp-side">${sisiSet}</div>
      <div class="sc-cmp-side">${r.status === 'persis' ? '<div class="sc-cmp-kosong">—</div>'
        : `<input class="sc-cmp-just${cek ? ' cek' : ''}" type="text" data-i="${i}" value="${esc(justifikasiOtomatis(r))}" placeholder="Tulis alasan" aria-label="Justifikasi baris ${i + 1}"${cek ? ' title="Cek dulu: fungsi setara adalah penilaian manusia"' : ''}>`}</div>
    </div>`;
  }).join('');
  const html = `<div class="sc-cmp">
    <div class="sc-cmp-summary">${ringkas || '<span class="sc-chip">Tidak ada data</span>'}
      <button class="setcari-detail-btn sc-cmp-copy" type="button" data-action="copy-banding"><i class="ti ti-copy"></i> Salin tabel</button></div>
    <div class="sc-cmp-head"><div>Diminta</div><div></div><div>Isi SET</div><div>Justifikasi</div></div>
    ${body}
  </div>`;
  return { html, rows };
}
// TSV siap tempel ke Excel. Justifikasi diambil dari kolom yang tampil (sudah termasuk editan user).
function bandingToTsv(rows, justTexts) {
  const head = ['Diminta', 'Qty diminta', 'Kode produk diminta', 'Kode di SET', 'Nama di SET', 'Qty di SET', 'Status', 'Justifikasi'];
  const lines = rows.map((r, i) => [
    r._rawDiminta || r.input_nama || '', r._qtyDiminta == null ? '' : r._qtyDiminta, r.input_kode || '',
    r.set_kode || '', r.set_nama || '', r.set_qty == null ? '' : r.set_qty,
    (STATUS_LABEL[r.status] || {}).txt || r.status, justTexts[i] != null ? justTexts[i] : justifikasiOtomatis(r)
  ].map(v => String(v).replace(/[\t\r\n]+/g, ' ')).join('\t'));
  return [head.join('\t')].concat(lines).join('\n');
}

async function toggleSetcariDetail(btn, kodeList, useSub) {
  const setId = btn.dataset.setId;
  const detailEl = S.setcariList.querySelector(`[data-detail-for="${setId}"]`);
  if (!detailEl) return;
  const labelAwal = useSub ? 'Bandingkan' : 'Lihat isi';
  if (detailEl.style.display !== 'none') {
    detailEl.style.display = 'none';
    btn.textContent = labelAwal;
    btn.setAttribute('aria-expanded', 'false');
    return;
  }
  btn.textContent = 'Memuat…';
  try {
    if (useSub) {
      const o = setcariOpts();
      const { data, error } = await S.rpc('bandingkan_input_set', {
        p_set_id: Number(setId), kode_list: kodeList, p_toleransi_mm: o.tol, p_lintas_tc: o.lintasTc
      });
      if (error) throw new Error(error.message || 'Gagal membandingkan');
      const { html, rows } = renderSetcariBanding(data || [], kodeList);
      detailEl.innerHTML = html;
      const copyBtn = detailEl.querySelector('[data-action="copy-banding"]');
      if (copyBtn) copyBtn.addEventListener('click', async () => {
        const justTexts = rows.map((_, i) => {
          const inp = detailEl.querySelector(`input.sc-cmp-just[data-i="${i}"]`);
          return inp ? inp.value : '';
        });
        try { await navigator.clipboard.writeText(bandingToTsv(rows, justTexts)); S.showToast('Tabel disalin (siap tempel ke Excel)'); }
        catch (e) { S.showToast('Gagal menyalin: ' + e.message, 'error'); }
      });
    } else {
      const { data, error } = await S.rpc('detail_isi_set', { p_set_id: Number(setId), kode_list: kodeList });
      if (error) throw new Error(error.message || 'Gagal ambil detail SET');
      const lines = (data || []).map(it => `
      <div class="setcari-item-line ${it.cocok_dengan_input ? 'match' : ''}">
        <span class="setcari-item-main"><span class="setcari-item-no">${it.urutan}</span><span class="setcari-item-kode">${S.escapeHtmlAttr(it.kode_item)}</span><span class="setcari-item-nama">${S.escapeHtmlAttr(it.nama_item || '')}</span></span>
        <span class="setcari-item-qty">qty ${it.qty}${it.cocok_dengan_input ? '<span class="setcari-item-tag">cocok</span>' : ''}</span>
      </div>`).join('');
      detailEl.innerHTML = lines || '<div class="setcari-detail-empty">SET ini tidak punya item.</div>';
    }
    detailEl.style.display = useSub ? 'block' : 'flex';
    btn.textContent = 'Sembunyikan';
    btn.setAttribute('aria-expanded', 'true');
  } catch (err) {
    setcariSetStatus('Gagal memuat isi SET: ' + err.message, true);
    btn.textContent = labelAwal;
  }
}

S.setcariSearchBtn.addEventListener('click', runCariSetMendekati);

}