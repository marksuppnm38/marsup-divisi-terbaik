// AUTO-EXTRACTED dari crud-produk/index.js (breakup, lanjutan akd-master.js).
// sb/escapeHtml diakses lewat S.sb/S.escapeHtml. openAdd (fungsi modal
// tambah/edit produk yang MASIH tinggal di index.js) diakses lewat
// S.openAdd -- dipakai loadSyncUnmatched() buat tombol "Tambah Produk".
// showToast/crudConfirm/crudAlert/renderPgBar tetap import langsung dari
// ui-utils.js, konsisten sama akd-master.js. Logic TIDAK diubah.
import { showToast, crudConfirm, crudAlert, renderPgBar, parseLinkV6 } from './ui-utils.js';

export function installKfa(S) {
// ============================================================
// ---- KFA Management ----
// produk_kfa: 1 baris = 1 produk (unique produk_id), berlaku sama buat SET
// maupun instrumen satuan. KFA sifatnya biner (punya kode_kfa atau belum),
// gak ada kolom status lagi. kode_kfa disini otomatis sync ke produk.kode_kfa
// lewat trigger DB trg_sync_kode_kfa -- jadi gak perlu urus sync itu dari sini.
// ============================================================
const KFA_PAGE_SIZE = 30;
let kfaPage = 1;
let kfaSearchQuery = '';
let kfaActiveFilter = 'all';
let currentKfaId = null;
const kfaModalOverlay = document.getElementById('kfaModalOverlay');

async function refreshKfaFilterCounts(){
  const [adaRes, belumRes, totalRes] = await Promise.all([
    S.sb.from('produk_kfa').select('id', { count: 'exact', head: true }).not('kode_kfa', 'is', null),
    S.sb.from('produk_kfa').select('id', { count: 'exact', head: true }).is('kode_kfa', null),
    S.sb.from('produk_kfa').select('id', { count: 'exact', head: true }),
  ]);
  document.getElementById('fc-kfa-ada').textContent = adaRes.count || 0;
  document.getElementById('fc-kfa-belum').textContent = belumRes.count || 0;
  document.getElementById('fc-kfa-all').textContent = totalRes.count || 0;
}

async function loadKfa(page){
  kfaPage = page || kfaPage || 1;
  const tbody = document.getElementById('kfaTableBody');
  tbody.innerHTML = `<tr class="state-row"><td colspan="7">Memuat data...</td></tr>`;
  document.getElementById('kfaCount').textContent = 'Memuat...';

  const from = (kfaPage - 1) * KFA_PAGE_SIZE, to = from + KFA_PAGE_SIZE - 1;
  let query = S.sb.from('produk_kfa').select('*, produk:produk_id(kode_produk, nama_produk, tipe)', { count: 'exact' });
  if (kfaActiveFilter === 'ada') query = query.not('kode_kfa', 'is', null);
  else if (kfaActiveFilter === 'belum') query = query.is('kode_kfa', null);

  const q = kfaSearchQuery.trim();
  if (q) {
    // produk_kfa gak bisa di-ilike langsung pakai kolom produk (beda tabel),
    // jadi resolve dulu produk_id yang cocok, baru gabung sama pencarian kode_kfa.
    const { data: matchedProduk } = await S.sb.from('produk').select('id')
      .or(`kode_produk.ilike.%${q}%,nama_produk.ilike.%${q}%`).limit(500);
    const ids = (matchedProduk || []).map(p => p.id);
    if (ids.length) query = query.or(`kode_kfa.ilike.%${q}%,produk_id.in.(${ids.join(',')})`);
    else query = query.ilike('kode_kfa', `%${q}%`);
  }

  const { data, error, count } = await query.order('updated_at', { ascending: false }).range(from, to);
  if (error) { tbody.innerHTML = `<tr class="state-row"><td colspan="7">Gagal memuat: ${S.escapeHtml(error.message)}</td></tr>`; return; }
  const rows = data || [], total = count || 0;

  document.getElementById('kfaCount').textContent = total + ' record KFA' + (q ? ` untuk "${q}"` : '');
  renderPgBar(document.getElementById('kfaPagination'), { page: kfaPage, pageSize: KFA_PAGE_SIZE, total, onPageChange: (p) => loadKfa(p) });
  renderKfaTable(rows);
}

function renderKfaTable(rows){
  const tbody = document.getElementById('kfaTableBody');
  if (!rows.length) { tbody.innerHTML = `<tr class="state-row"><td colspan="8">Tidak ada record KFA ditemukan.</td></tr>`; return; }
  tbody.innerHTML = '';
  rows.forEach(r => {
    const p = r.produk || {};
    const tr = document.createElement('tr');
    tr.className = 'clickable';
    tr.innerHTML = `
      <td class="kode-cell">${S.escapeHtml(p.kode_produk || '—')}</td>
      <td>${S.escapeHtml(p.nama_produk || '—')}</td>
      <td>${S.escapeHtml(r.kode_kfa || '—')}</td>
      <td>${S.escapeHtml(r.kode_cangkang || '—')}</td>
      <td>${S.escapeHtml(r.nama_cangkang || '—')}</td>
      <td>${S.escapeHtml(r.no_akd_rujukan || '—')}</td>
      <td>${r.tanggal_verifikasi || '—'}</td>
      <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${S.escapeHtml(r.catatan || '')}">${S.escapeHtml(r.catatan || '—')}</td>
    `;
    tr.addEventListener('click', () => openEditKfa(r));
    tbody.appendChild(tr);
  });
}

// ---- Filter chip & search box ----
document.querySelectorAll('#kfaFilterBar .filter-chip').forEach(btn => {
  btn.addEventListener('click', () => {
    kfaActiveFilter = btn.dataset.filter;
    document.querySelectorAll('#kfaFilterBar .filter-chip').forEach(b => b.classList.toggle('active', b === btn));
    loadKfa(1);
  });
});
let kfaSearchDebounce = null;
document.getElementById('kfaSearchBoxInput').addEventListener('input', (e) => {
  clearTimeout(kfaSearchDebounce);
  kfaSearchDebounce = setTimeout(() => { kfaSearchQuery = e.target.value; loadKfa(1); }, 300);
});

// ---- Modal edit ----
function openEditKfa(row){
  currentKfaId = row.id;
  const p = row.produk || {};
  document.getElementById('kfaModalTitle').textContent = p.kode_produk || 'Detail KFA';
  document.getElementById('kfaModalSub').textContent = p.nama_produk || '—';
  document.getElementById('k_tanggal_verifikasi').value = row.tanggal_verifikasi || '';
  document.getElementById('k_kode_kfa').value = row.kode_kfa || '';
  document.getElementById('k_kode_cangkang').value = row.kode_cangkang || '';
  document.getElementById('k_nama_cangkang').value = row.nama_cangkang || '';
  document.getElementById('k_no_akd_rujukan').value = row.no_akd_rujukan || '';
  document.getElementById('k_catatan').value = row.catatan || '';
  kfaModalOverlay.classList.add('open');
}
function closeKfaModal(){ kfaModalOverlay.classList.remove('open'); currentKfaId = null; }
document.getElementById('kfaModalCloseBtn').addEventListener('click', closeKfaModal);
document.getElementById('kfaCancelBtn').addEventListener('click', closeKfaModal);

document.getElementById('kfaSaveBtn').addEventListener('click', async () => {
  if (!currentKfaId) return;
  const kodeKfa = document.getElementById('k_kode_kfa').value.trim() || null;
  const payload = {
    kode_kfa: kodeKfa,
    kode_cangkang: document.getElementById('k_kode_cangkang').value.trim() || null,
    nama_cangkang: document.getElementById('k_nama_cangkang').value.trim() || null,
    no_akd_rujukan: document.getElementById('k_no_akd_rujukan').value.trim() || null,
    tanggal_verifikasi: document.getElementById('k_tanggal_verifikasi').value || null,
    catatan: document.getElementById('k_catatan').value.trim() || null,
  };
  const { error } = await S.sb.from('produk_kfa').update(payload).eq('id', currentKfaId);
  if (error) {
    if (error.code === '23505') { showToast('Kode KFA ini sudah dipakai produk lain', true); return; }
    showToast('Gagal menyimpan: ' + error.message, true); return;
  }
  showToast('Record KFA tersimpan');
  closeKfaModal();
  loadKfa(kfaPage);
  refreshKfaFilterCounts();
});

document.getElementById('deleteKfaBtn').addEventListener('click', async () => {
  if (!currentKfaId) return;
  if (!await crudConfirm('Hapus record KFA ini? Kode KFA di produk (kalau ada) ikut kekosongin.', { danger: true, okLabel: 'Ya, Hapus' })) return;
  const { error } = await S.sb.from('produk_kfa').delete().eq('id', currentKfaId);
  if (error) { showToast('Gagal hapus: ' + error.message, true); return; }
  showToast('Record KFA dihapus');
  closeKfaModal();
  loadKfa(kfaPage);
  refreshKfaFilterCounts();
});

// ---- Tambah produk baru ke KFA (produk yang belum punya record sama sekali) ----
const kfaAddBox = document.getElementById('kfaAddBox');
document.getElementById('addKfaBtn').addEventListener('click', () => {
  kfaAddBox.style.display = kfaAddBox.style.display === 'none' ? 'block' : 'none';
  if (kfaAddBox.style.display === 'block') document.getElementById('kfaAddSearchInput').focus();
});
let kfaAddSearchDebounce = null;
document.getElementById('kfaAddSearchInput').addEventListener('input', (e) => {
  clearTimeout(kfaAddSearchDebounce);
  const q = e.target.value.trim();
  const resultsEl = document.getElementById('kfaAddResults');
  if (!q) { resultsEl.innerHTML = ''; return; }
  kfaAddSearchDebounce = setTimeout(async () => {
    // cari produk yang cocok DAN belum punya baris di produk_kfa sama sekali
    // (SET ikut disertakan -- SET juga wajib lewat proses KFA sama kayak instrumen satuan)
    const { data: matched } = await S.sb.from('produk').select('id, kode_produk, nama_produk')
      .or(`kode_produk.ilike.%${q}%,nama_produk.ilike.%${q}%`).limit(15);
    if (!matched || !matched.length) { resultsEl.innerHTML = `<div class="akd-hint">Tidak ada produk cocok.</div>`; return; }
    const ids = matched.map(p => p.id);
    const { data: existing } = await S.sb.from('produk_kfa').select('produk_id').in('produk_id', ids);
    const existingIds = new Set((existing || []).map(r => r.produk_id));
    const available = matched.filter(p => !existingIds.has(p.id));
    if (!available.length) { resultsEl.innerHTML = `<div class="akd-hint">Semua hasil pencarian ini sudah punya record KFA.</div>`; return; }
    resultsEl.innerHTML = '';
    available.forEach(p => {
      const div = document.createElement('div');
      div.className = 'akd-result-row';
      div.innerHTML = `<span class="ar-no">${S.escapeHtml(p.kode_produk)}</span><span class="ar-nama">${S.escapeHtml(p.nama_produk || '')}</span>`;
      div.addEventListener('click', async () => {
        const { data: inserted, error } = await S.sb.from('produk_kfa').insert({ produk_id: p.id }).select('*, produk:produk_id(kode_produk, nama_produk, tipe)').single();
        if (error) { showToast('Gagal tambah record: ' + error.message, true); return; }
        showToast('Record KFA dibuat, isi detailnya');
        document.getElementById('kfaAddSearchInput').value = '';
        resultsEl.innerHTML = '';
        kfaAddBox.style.display = 'none';
        loadKfa(1);
        refreshKfaFilterCounts();
        openEditKfa(inserted);
      });
      resultsEl.appendChild(div);
    });
  }, 300);
});

// ---- Sync dari Sheet (kode_produk kepantau di Google Sheets lewat
// Apps Script pollAndSync, tapi belum punya row di tabel produk -- edge
// function sync-sheet nyatet ke tabel sync_unmatched_produk, hilang
// sendiri dari daftar ini begitu produknya dibuat) ----
// Keterangan di bawah deskripsi baris sync: komponen yang dibutuhkan set
// (dari RINCIAN SET) atau kode set baru. Set ditampilkan pakai DESKRIPSI-nya
// (nameByKode), kode cuma jadi fallback + muncul di tooltip. Daftar dipotong 3
// karena deskripsi lebih panjang dari kode.
const SYNC_PAGE_SIZE = 25;
let syncRows = [];   // hasil akhir (sudah difilter yang sudah ada di produk), semua halaman
let syncPage = 1;
let syncSearchQuery = '';

// Filter client-side dari syncRows (sudah ada di memori semua, jadi gak perlu query ulang).
// Cocokkan ke kode, deskripsi, sumber sheet, dan kode set yang membutuhkan produk ini.
let syncStatusFilter = 'all';   // all | ok | warn | bad
let syncTipeFilter = 'all';     // all | INSTRUMENT | UNIT | SET
function syncTipeOf(r){ return (r.is_set || r.source_sheet === 'SET FIX V6') ? 'SET' : (r.tipe_hint || 'LAINNYA'); }
function syncMatchSearch(r){
  const q = syncSearchQuery.trim().toLowerCase();
  if (!q) return true;
  const hay = [r.kode_produk, r.deskripsi, r.source_sheet].concat(Array.isArray(r.dibutuhkan_oleh) ? r.dibutuhkan_oleh : []);
  return hay.some(v => v && String(v).toLowerCase().includes(q));
}
// Filter client-side dari syncRows (sudah ada di memori semua, jadi gak perlu query ulang).
function getFilteredSyncRows(){
  return syncRows.filter(r => syncMatchSearch(r)
    && syncMatchCols(r)
    && (syncTipeFilter === 'all' || syncTipeOf(r) === syncTipeFilter)
    && (syncStatusFilter === 'all' || evalSyncRow(r).level === syncStatusFilter));
}

// ---- Filter per kolom (baris input/dropdown di bawah header tabel) ----
// Status gak masuk objek ini: dia pakai syncStatusFilter yang sama dengan chip
// di atas tabel, jadi dropdown kolom Status & chip Status selalu sinkron.
//   link  : all | ada (URL, bersih atau + catatan) | bersih | catatan | invalid (cuma teks) | kosong
//   harga : all | ada | kosong
//   sumber: all | __none__ (kosong) | nama sheet persis
const syncColFilter = { kode: '', desk: '', link: 'all', harga: 'all', sumber: 'all' };
function syncHasColFilter(){
  return !!syncColFilter.kode.trim() || !!syncColFilter.desk.trim()
    || syncColFilter.link !== 'all' || syncColFilter.harga !== 'all' || syncColFilter.sumber !== 'all';
}
function syncMatchCols(r){
  const f = syncColFilter;
  const kq = f.kode.trim().toLowerCase();
  if (kq && !String(r.kode_produk || '').toLowerCase().includes(kq)) return false;
  const dq = f.desk.trim().toLowerCase();
  if (dq && !String(r.deskripsi || '').toLowerCase().includes(dq)) return false;
  if (f.link !== 'all') {
    const st = parseLinkV6(r.link).state;
    if (f.link === 'ada' ? (st !== 'bersih' && st !== 'catatan') : st !== f.link) return false;
  }
  if (f.harga !== 'all') {
    const adaHarga = r.harga_ekat != null && r.harga_ekat !== '';
    if ((f.harga === 'ada') !== adaHarga) return false;
  }
  if (f.sumber !== 'all') {
    const sm = String(r.source_sheet || '').trim();
    if (f.sumber === '__none__' ? !!sm : sm !== f.sumber) return false;
  }
  return true;
}

let syncSearchDebounce = null;
const syncSearchEl = document.getElementById('syncSearchInput');
if (syncSearchEl) {
  syncSearchEl.addEventListener('input', (e) => {
    clearTimeout(syncSearchDebounce);
    syncSearchDebounce = setTimeout(() => { syncSearchQuery = e.target.value; syncPage = 1; renderSyncPage(); }, 250);
  });
}

// Ambil semua baris tabel dengan paging 1000-an (PostgREST default max 1000 baris/request,
// tanpa ini daftar sync yang >1000 kepotong diam-diam).
async function fetchAllSyncRows(){
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await S.sb.from('sync_unmatched_produk').select('*')
      .order('last_seen_at', { ascending: false }).order('kode_produk').range(from, from + 999);
    if (error) return { error };
    all.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return { data: all };
}

// Map kode_produk -> tipe untuk kode yang SUDAH ada di tabel produk (di-chunk biar URL .in() gak kepanjangan).
// Return null kalau query gagal -- pemanggil harus memperlakukan itu sebagai "gak tahu", bukan "semua kosong".
async function fetchProdukTipeMap(kodes){
  const map = new Map();
  const uniq = [...new Set(kodes.filter(Boolean))];
  for (let i = 0; i < uniq.length; i += 200) {
    const { data, error } = await S.sb.from('produk').select('kode_produk, tipe').in('kode_produk', uniq.slice(i, i + 200));
    if (error) return null;
    (data || []).forEach(p => map.set(p.kode_produk, p.tipe));
  }
  return map;
}

// Bandingkan komposisi set dari sheet dengan isi tabel produk.
//   missing = belum ada sama sekali di database
//   nested  = ada, tapi bertipe SET -> seedSetKomposisi() sengaja gak memasukkannya
function summarizeKomposisi(komposisi, tipeMap){
  const kodes = [...new Set((Array.isArray(komposisi) ? komposisi : []).map(k => k?.kode_produk).filter(Boolean))];
  const missing = kodes.filter(k => !tipeMap.has(k));
  const nested = kodes.filter(k => tipeMap.get(k) === 'SET');
  return { total: kodes.length, missing, nested };
}

// Keterangan di bawah deskripsi baris sync: komponen yang dibutuhkan set
// (dari RINCIAN SET) atau kode set baru. Set ditampilkan pakai DESKRIPSI-nya
// (nameByKode), kode cuma jadi fallback + muncul di tooltip. Daftar dipotong 3
// karena deskripsi lebih panjang dari kode.
function syncNoteHtml(row, nameByKode, komposisiInfo){
  const needed = Array.isArray(row.dibutuhkan_oleh) ? row.dibutuhkan_oleh : [];
  const label = (k) => (nameByKode && nameByKode.get(k)) || k;
  if (needed.length) {
    const shown = needed.slice(0, 3).map(k => S.escapeHtml(label(k))).join(', ');
    const more = needed.length > 3 ? ` +${needed.length - 3} lainnya` : '';
    const tip = needed.map(k => `${label(k)} (${k})`).join('\n');
    return `<div style="margin-top:4px;font-size:11.5px;color:var(--warn-text, #b45309);" title="${S.escapeHtml(tip)}"><i class="ti ti-alert-triangle"></i> Belum ada di database, dibutuhkan oleh set: ${shown}${more}</div>`;
  }
  if (row.is_set) {
    let html = `<div style="margin-top:4px;font-size:11.5px;color:var(--text-muted);"><i class="ti ti-stack-2"></i> Set baru dari sheet. Buat produknya (tipe SET), komposisi terisi otomatis di sync berikutnya</div>`;
    if (komposisiInfo && (komposisiInfo.missing.length || komposisiInfo.nested.length)) {
      const parts = [];
      if (komposisiInfo.missing.length) parts.push(`${komposisiInfo.missing.length} dari ${komposisiInfo.total} instrumen belum ada di database`);
      if (komposisiInfo.nested.length) parts.push(`${komposisiInfo.nested.length} berupa SET (gak masuk komposisi)`);
      const tip = komposisiInfo.missing.concat(komposisiInfo.nested).join('\n');
      html += `<div style="margin-top:4px;font-size:11.5px;color:var(--warn-text, #b45309);" title="${S.escapeHtml(tip)}"><i class="ti ti-alert-triangle"></i> Cek dulu komposisinya: ${S.escapeHtml(parts.join(', '))}</div>`;
    }
    return html;
  }
  return '';
}

// Warning sebelum nambah SET dari tab Sync: komposisi dari sheet dicek ulang ke database SEKARANG
// (bukan pakai data render, bisa aja udah berubah), lalu user diminta konfirmasi kalau ada
// instrumen yang belum terdaftar. Return true = lanjut buka form.
async function confirmSetKomposisi(row){
  const komposisi = Array.isArray(row.komposisi) ? row.komposisi : [];
  if (!komposisi.length) return true;
  const tipeMap = await fetchProdukTipeMap(komposisi.map(k => k?.kode_produk));
  if (!tipeMap) {
    showToast('Gagal mengecek komposisi ke database, cek manual di Set Management setelah set dibuat', true);
    return true;
  }
  const { total, missing, nested } = summarizeKomposisi(komposisi, tipeMap);
  if (!missing.length && !nested.length) return true;

  // Nama instrumen yang belum ada: ambil dari baris sync lain (deskripsi dari sheet) biar pesannya kebaca.
  const descByKode = new Map();
  if (missing.length) {
    const { data } = await S.sb.from('sync_unmatched_produk').select('kode_produk, deskripsi').in('kode_produk', missing.slice(0, 200));
    (data || []).forEach(r => { if (r.deskripsi) descByKode.set(r.kode_produk, r.deskripsi); });
  }
  const fmt = (k) => descByKode.has(k) ? `• ${k} — ${descByKode.get(k)}` : `• ${k}`;
  const MAX = 8;
  const lines = [`Tolong dicek dulu sebelum menambah set ini.`, ''];
  if (missing.length) {
    lines.push(`${missing.length} dari ${total} instrumen di komposisinya belum ada di database:`);
    lines.push(...missing.slice(0, MAX).map(fmt));
    if (missing.length > MAX) lines.push(`…dan ${missing.length - MAX} lainnya`);
    lines.push('');
  }
  if (nested.length) {
    lines.push(`${nested.length} item berupa SET (SET tidak boleh jadi isi set lain, jadi tidak ikut masuk): ${nested.slice(0, MAX).join(', ')}${nested.length > MAX ? ', …' : ''}`);
    lines.push('');
  }
  lines.push('Kalau lanjut, komposisi hanya terisi instrumen yang sudah ada. Sisanya bisa ditambahkan nanti lewat bagian "Belum ada di database" di halaman Composition set. Disarankan: tambahkan instrumen yang kurang dulu.');
  return crudConfirm(lines.join('\n'), { title: 'Komposisi belum lengkap', okLabel: 'Tetap Tambah Set' });
}

// Chip ringkas data dari sheet (tipe, kode asli, merk, AKD, KFA) di bawah deskripsi.
function syncPayloadHtml(row){
  const p = row.payload || {};
  const chip = (t, mono) => `<span class="tipe-chip" style="${mono ? 'font-family:var(--font-mono);' : ''}">${S.escapeHtml(t)}</span>`;
  const bits = [];
  if (row.tipe_hint) bits.push(chip(row.tipe_hint));
  if (p.kode_asli) bits.push(chip('asli ' + p.kode_asli, true));
  if (p.unit && p.unit.merk) bits.push(chip(String(p.unit.merk).slice(0, 28)));
  if (Array.isArray(p.akd) && p.akd.length) bits.push(chip('AKD ' + p.akd.slice(0, 2).map(a => String(a.no_akd).replace(/^AKD\s*/i, '')).join(', ') + (p.akd.length > 2 ? ' …' : ''), true));
  if (p.kfa && p.kfa.kode) bits.push(chip('KFA ' + p.kfa.kode, true));
  if (!bits.length) return '';
  return `<div style="margin-top:5px;display:flex;flex-wrap:wrap;gap:4px;">${bits.join('')}</div>`;
}

// Kolom Status: pill + alasan (kalau ada).
function syncStatusHtml(ev){
  const label = { ok: 'Siap', warn: 'Cek dulu', bad: 'Tidak siap' }[ev.level];
  const reasons = ev.bad.concat(ev.warn);
  const list = reasons.length
    ? `<div style="margin-top:5px;font-size:11px;line-height:1.4;color:var(--text-muted);">${reasons.map(r => S.escapeHtml(r)).join('<br>')}</div>` : '';
  return `<span class="status-pill ${ev.level}">${label}</span>${list}`;
}

// Link V6: tampil ringkas (slug), tandai kalau sel berisi catatan selain URL.
function syncLinkHtml(raw){
  const t = String(raw == null ? '' : raw).trim();
  if (!t) return '<span style="color:var(--text-muted);">—</span>';
  const m = t.match(/https?:\/\/\S+/);
  const clamp = 'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-all;font-size:12px;max-width:240px;';
  if (!m) return `<span style="${clamp}color:var(--text-muted);" title="${S.escapeHtml(t)}">${S.escapeHtml(t)}</span>`;
  const url = m[0];
  const clean = url === t;
  const label = url.replace(/^https?:\/\/[^/]+\//, '').replace(/^pionir-nusantara-manufacturing\//, '') || url;
  return `<a href="${S.escapeHtml(url)}" target="_blank" rel="noopener" title="${S.escapeHtml(t)}" style="${clamp}">${S.escapeHtml(label)}</a>`
    + (clean ? '' : `<div style="margin-top:3px;font-size:11px;color:var(--warn-text, #b45309);"><i class="ti ti-note"></i> ada catatan di sel</div>`);
}

// Chip filter status & tipe, lengkap dengan hitungan. Hitungan status mengikuti search + filter tipe,
// hitungan tipe mengikuti search + filter status, jadi angkanya selalu sesuai apa yang akan tampil.
function renderSyncFilters(){
  const sb = document.getElementById('syncStatusBar'), tb = document.getElementById('syncTipeBar');
  if (!sb || !tb) return;
  const base = syncRows.filter(r => syncMatchSearch(r) && syncMatchCols(r));
  syncSyncColFilterUi();
  const st = { all: 0, ok: 0, warn: 0, bad: 0 }, tp = { all: 0, INSTRUMENT: 0, UNIT: 0, SET: 0 };
  base.forEach(r => {
    const lv = evalSyncRow(r).level, ty = syncTipeOf(r);
    if (syncTipeFilter === 'all' || ty === syncTipeFilter) { st.all++; st[lv]++; }
    if (syncStatusFilter === 'all' || lv === syncStatusFilter) { tp.all++; if (tp[ty] !== undefined) tp[ty]++; }
  });
  const chip = (attr, val, active, html, count, title) =>
    `<button class="filter-chip${active ? ' active' : ''}" ${attr}="${val}" title="${S.escapeHtml(title || '')}">${html}<span class="fc-count">${count}</span></button>`;
  sb.innerHTML =
    chip('data-sst', 'all', syncStatusFilter === 'all', 'Semua', st.all) +
    chip('data-sst', 'ok', syncStatusFilter === 'ok', '<i class="ti ti-circle-check" style="color:var(--teal-ok-text,#0f766e)"></i> Siap bulk', st.ok, 'Data lengkap & valid, aman ditambahkan massal') +
    chip('data-sst', 'warn', syncStatusFilter === 'warn', '<i class="ti ti-alert-triangle" style="color:var(--warn-text,#b45309)"></i> Perlu dicek', st.warn, 'Bisa dibuat, tapi ada bagian data yang dilewati / perlu ditengok') +
    chip('data-sst', 'bad', syncStatusFilter === 'bad', '<i class="ti ti-circle-x" style="color:var(--danger-text,#b91c1c)"></i> Tidak siap', st.bad, 'Tidak bisa bulk: SET, tanpa deskripsi, atau kode janggal. Tambah manual lewat form');
  tb.innerHTML =
    chip('data-stp', 'all', syncTipeFilter === 'all', 'Semua tipe', tp.all) +
    chip('data-stp', 'INSTRUMENT', syncTipeFilter === 'INSTRUMENT', 'Instrument', tp.INSTRUMENT) +
    chip('data-stp', 'UNIT', syncTipeFilter === 'UNIT', 'Unit', tp.UNIT) +
    chip('data-stp', 'SET', syncTipeFilter === 'SET', 'Set', tp.SET);
}

// ---- Bulk tambah produk dari tab Sync ----
// Validasi di sini cuma buat UX (status & checkbox); validasi yang menentukan ada di RPC
// bulk_create_produk_from_sync (client hanya mengirim daftar kode).
const SYNC_KODE_RE = /^[A-Za-z0-9][A-Za-z0-9._\-\/]{2,79}$/;
const syncSelected = new Set();

function evalSyncRow(row){
  const bad = [], warn = [];
  const p = row.payload || {};
  const isSet = !!(row.is_set || row.source_sheet === 'SET FIX V6');
  if (isSet) bad.push('SET: buat lewat form (komposisi perlu dicek)');
  else if (row.tipe_hint !== 'INSTRUMENT' && row.tipe_hint !== 'UNIT') bad.push('tipe belum diketahui');
  if (!String(row.deskripsi || '').trim()) bad.push('tanpa deskripsi');
  if (!SYNC_KODE_RE.test(row.kode_produk || '')) bad.push('format kode janggal');
  const asli = p.kode_asli;
  if (asli && (asli.length > 60 || /[\n\r$\/]/.test(asli) || asli.includes('..'))) warn.push('kode asli janggal (tidak dipakai)');
  else if (row.tipe_hint === 'INSTRUMENT' && !asli) warn.push('tanpa kode asli');
  if (row.link && !/^https?:\/\/\S+$/i.test(String(row.link).trim())) warn.push('link berisi catatan (tidak dipakai)');
  if (row.tipe_hint === 'UNIT' && row.harga_ekat == null) warn.push('tanpa harga');
  return { level: bad.length ? 'bad' : (warn.length ? 'warn' : 'ok'), bad, warn };
}


function updateSyncBulkBar(){
  const bar = document.getElementById('syncBulkBar');
  if (!bar) return;
  const n = syncSelected.size;
  bar.style.display = n ? 'flex' : 'none';
  const info = document.getElementById('syncBulkInfo');
  if (info) info.textContent = `${n} produk dipilih`;
  const all = document.getElementById('syncSelectAll');
  if (all) {
    const ready = getFilteredSyncRows().filter(r => evalSyncRow(r).level === 'ok');
    all.checked = ready.length > 0 && ready.every(r => syncSelected.has(r.kode_produk));
  }
}

async function runSyncBulkCreate(){
  const btn = document.getElementById('syncBulkAddBtn');
  const rows = syncRows.filter(r => syncSelected.has(r.kode_produk));
  const evs = rows.map(r => ({ r, ev: evalSyncRow(r) })).filter(x => x.ev.level !== 'bad');
  if (!evs.length) { showToast('Tidak ada baris yang valid untuk ditambahkan', true); return; }
  const nInst = evs.filter(x => x.r.tipe_hint === 'INSTRUMENT').length;
  const nUnit = evs.filter(x => x.r.tipe_hint === 'UNIT').length;
  const warns = evs.filter(x => x.ev.level === 'warn');
  const lines = [`Akan membuat ${evs.length} produk: ${nInst} INSTRUMENT, ${nUnit} UNIT.`, ''];
  if (warns.length) {
    lines.push(`${warns.length} punya catatan (bagian bermasalah dilewati, produk tetap dibuat):`);
    warns.slice(0, 8).forEach(x => lines.push(`• ${x.r.kode_produk} — ${x.ev.warn.join(', ')}`));
    if (warns.length > 8) lines.push(`…dan ${warns.length - 8} lainnya`);
    lines.push('');
  }
  lines.push('Yang dibuat sekarang: kode, nama, tipe, kode asli, spek, link bersih. Harga, AKD, KFA & detail unit terisi otomatis di sync berikutnya.');
  if (!await crudConfirm(lines.join('\n'), { title: 'Tambah produk dari sheet', okLabel: `Ya, Tambah ${evs.length}` })) return;

  btn.disabled = true;
  const created = [], skipped = [];
  try {
    const kodes = evs.map(x => x.r.kode_produk);
    for (let i = 0; i < kodes.length; i += 100) {
      const { data, error } = await S.sb.rpc('bulk_create_produk_from_sync', { p_kodes: kodes.slice(i, i + 100) });
      if (error) { showToast('Gagal: ' + error.message, true); break; }
      created.push(...(data?.created || []));
      skipped.push(...(data?.skipped || []));
    }
  } finally { btn.disabled = false; }

  created.forEach(k => syncSelected.delete(k));
  if (created.length) showToast(`${created.length} produk ditambahkan` + (skipped.length ? `, ${skipped.length} dilewati` : ''));
  if (skipped.length) {
    await crudAlert(`${skipped.length} produk dilewati:\n` + skipped.slice(0, 15).map(s => `• ${s.kode} — ${s.alasan}`).join('\n') + (skipped.length > 15 ? `\n…dan ${skipped.length - 15} lainnya` : ''));
  }
  await loadSyncUnmatched();
}

(function wireSyncBulk(){
  const onChip = (barId, attr, setter) => {
    const bar = document.getElementById(barId);
    if (bar) bar.addEventListener('click', (e) => {
      const b = e.target.closest('.filter-chip');
      if (!b) return;
      setter(b.getAttribute(attr)); syncPage = 1; renderSyncPage();
    });
  };
  onChip('syncStatusBar', 'data-sst', v => { syncStatusFilter = v; });
  onChip('syncTipeBar', 'data-stp', v => { syncTipeFilter = v; });
  const all = document.getElementById('syncSelectAll');
  if (all) all.addEventListener('change', () => {
    const ready = getFilteredSyncRows().filter(r => evalSyncRow(r).level === 'ok');
    ready.forEach(r => { if (all.checked) syncSelected.add(r.kode_produk); else syncSelected.delete(r.kode_produk); });
    renderSyncPage();
  });
  const clr = document.getElementById('syncBulkClearBtn');
  if (clr) clr.addEventListener('click', () => { syncSelected.clear(); renderSyncPage(); });
  const add = document.getElementById('syncBulkAddBtn');
  if (add) add.addEventListener('click', runSyncBulkCreate);
})();

// ---- Ringkasan filter aktif (bar di atas tabel) ----
const SYNC_LABEL = {
  tipe: { INSTRUMENT: 'Instrument', UNIT: 'Unit', SET: 'Set' },
  status: { ok: 'Siap', warn: 'Cek dulu', bad: 'Tidak siap' },
  link: { ada: 'Ada link', bersih: 'Link bersih', catatan: 'Link + catatan', invalid: 'Cuma teks (bukan URL)', kosong: 'Kosong' },
  harga: { ada: 'Ada harga', kosong: 'Kosong' },
};
function syncActiveFilters(){
  const f = syncColFilter, out = [];
  const q = syncSearchQuery.trim();
  if (q) out.push({ key: 'search', label: 'Pencarian', val: `"${q}"` });
  if (syncTipeFilter !== 'all') out.push({ key: 'tipe', label: 'Tipe', val: SYNC_LABEL.tipe[syncTipeFilter] || syncTipeFilter });
  if (syncStatusFilter !== 'all') out.push({ key: 'status', label: 'Status', val: SYNC_LABEL.status[syncStatusFilter] || syncStatusFilter });
  if (f.kode.trim()) out.push({ key: 'kode', label: 'Kode', val: `"${f.kode.trim()}"` });
  if (f.desk.trim()) out.push({ key: 'desk', label: 'Deskripsi', val: `"${f.desk.trim()}"` });
  if (f.link !== 'all') out.push({ key: 'link', label: 'Link V6', val: SYNC_LABEL.link[f.link] || f.link });
  if (f.harga !== 'all') out.push({ key: 'harga', label: 'Harga E-KAT', val: SYNC_LABEL.harga[f.harga] || f.harga });
  if (f.sumber !== 'all') out.push({ key: 'sumber', label: 'Sumber', val: f.sumber === '__none__' ? '(kosong)' : f.sumber });
  return out;
}
function syncRemoveFilter(key){
  const f = syncColFilter;
  if (key === '__all__') {
    Object.assign(f, { kode: '', desk: '', link: 'all', harga: 'all', sumber: 'all' });
    syncStatusFilter = 'all'; syncTipeFilter = 'all'; syncSearchQuery = '';
    if (syncSearchEl) syncSearchEl.value = '';
  } else if (key === 'search') { syncSearchQuery = ''; if (syncSearchEl) syncSearchEl.value = ''; }
  else if (key === 'tipe') syncTipeFilter = 'all';
  else if (key === 'status') syncStatusFilter = 'all';
  else if (key === 'kode' || key === 'desk') f[key] = '';
  else if (key in f) f[key] = 'all';
  syncPage = 1; renderSyncPage();
}
function renderSyncActiveBar(total){
  const bar = document.getElementById('syncActiveBar');
  if (!bar) return;
  const act = syncActiveFilters();
  if (!act.length) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
  bar.style.display = 'flex';
  bar.innerHTML =
    `<span class="saf-label"><i class="ti ti-filter"></i> Filter aktif (${act.length})</span>`
    + act.map(a => `<button type="button" class="saf-chip" data-saf="${a.key}" title="Klik untuk hapus filter ini"><span class="saf-k">${S.escapeHtml(a.label)}:</span><b>${S.escapeHtml(a.val)}</b><i class="ti ti-x"></i></button>`).join('')
    + `<span class="saf-result">Menampilkan <b>${total}</b> dari ${syncRows.length}</span>`
    + `<button type="button" class="saf-reset" data-saf="__all__"><i class="ti ti-filter-off"></i> Reset semua</button>`;
}

// ---- Baris filter kolom: disuntik lewat JS ke <thead> (markup.js gak perlu diubah) ----
function ensureSyncColFilterRow(){
  const tbody = document.getElementById('syncTableBody');
  const thead = tbody && tbody.closest('table') && tbody.closest('table').tHead;
  if (!thead || thead.querySelector('.sync-filter-row')) return;
  const tr = document.createElement('tr');
  tr.className = 'sync-filter-row';
  tr.innerHTML = `
    <th></th>
    <th><input type="text" class="sync-col-input" data-scol="kode" placeholder="Filter kode..." autocomplete="off"/></th>
    <th><input type="text" class="sync-col-input" data-scol="desk" placeholder="Filter deskripsi..." autocomplete="off"/></th>
    <th><select class="sync-col-select" data-scol="link">
      <option value="all">Semua</option>
      <option value="ada">Ada link</option>
      <option value="bersih">Link bersih (URL doang)</option>
      <option value="catatan">Link + catatan</option>
      <option value="invalid">Cuma teks (bukan URL)</option>
      <option value="kosong">Kosong</option>
    </select></th>
    <th><select class="sync-col-select" data-scol="harga">
      <option value="all">Semua</option>
      <option value="ada">Ada harga</option>
      <option value="kosong">Kosong</option>
    </select></th>
    <th><select class="sync-col-select" data-scol="sumber"><option value="all">Semua</option></select></th>
    <th><select class="sync-col-select" data-scol="status">
      <option value="all">Semua</option>
      <option value="ok">Siap</option>
      <option value="warn">Cek dulu</option>
      <option value="bad">Tidak siap</option>
    </select></th>
    <th><button type="button" class="btn btn-sm" id="syncColResetBtn" title="Reset semua filter kolom" style="display:none;"><i class="ti ti-filter-off"></i></button></th>
  `;
  thead.appendChild(tr);

  // Bar ringkasan filter aktif, disisipkan tepat di atas kartu tabel.
  const card = tbody.closest('.table-card');
  if (card && !document.getElementById('syncActiveBar')) {
    const bar = document.createElement('div');
    bar.id = 'syncActiveBar';
    bar.style.display = 'none';
    card.parentNode.insertBefore(bar, card);
  }
  // Delegasi klik: chip (hapus 1 filter), "Reset semua", dan tombol reset di state kosong tabel.
  const onReset = (e) => {
    const b = e.target.closest('[data-saf]');
    if (b) syncRemoveFilter(b.getAttribute('data-saf'));
  };
  const barEl = document.getElementById('syncActiveBar');
  if (barEl) barEl.addEventListener('click', onReset);
  tbody.addEventListener('click', onReset);

  let debounce = null;
  tr.addEventListener('input', (e) => {
    const el = e.target.closest('.sync-col-input');
    if (!el) return;
    clearTimeout(debounce);
    debounce = setTimeout(() => { syncColFilter[el.dataset.scol] = el.value; syncPage = 1; renderSyncPage(); }, 250);
  });
  tr.addEventListener('change', (e) => {
    const el = e.target.closest('.sync-col-select');
    if (!el) return;
    const k = el.dataset.scol;
    if (k === 'status') syncStatusFilter = el.value; else syncColFilter[k] = el.value;
    syncPage = 1; renderSyncPage();
  });
  tr.querySelector('#syncColResetBtn').addEventListener('click', () => {
    Object.assign(syncColFilter, { kode: '', desk: '', link: 'all', harga: 'all', sumber: 'all' });
    syncStatusFilter = 'all';
    syncPage = 1; renderSyncPage();
  });
}
ensureSyncColFilterRow();

// Sinkronkan tampilan baris filter dengan state (dipanggil tiap render) + isi opsi
// Sumber dari data aktual. Opsi cuma dibangun ulang kalau daftar sumbernya berubah.
let syncSumberSig = '';
function syncSyncColFilterUi(){
  const row = document.querySelector('#syncTableBody') && document.querySelector('#syncTableBody').closest('table').querySelector('.sync-filter-row');
  if (!row) return;
  const sumbers = [...new Set(syncRows.map(r => String(r.source_sheet || '').trim()).filter(Boolean))].sort();
  const hasNone = syncRows.some(r => !String(r.source_sheet || '').trim());
  const sig = sumbers.join('|') + '#' + hasNone;
  const sel = row.querySelector('[data-scol="sumber"]');
  if (sig !== syncSumberSig) {
    syncSumberSig = sig;
    sel.innerHTML = '<option value="all">Semua</option>'
      + sumbers.map(s => `<option value="${S.escapeHtml(s)}">${S.escapeHtml(s)}</option>`).join('')
      + (hasNone ? '<option value="__none__">(kosong)</option>' : '');
    // sumber yang dipilih sudah gak ada di data -> kembali ke Semua
    if (syncColFilter.sumber !== 'all' && ![...sel.options].some(o => o.value === syncColFilter.sumber)) syncColFilter.sumber = 'all';
  }
  sel.value = syncColFilter.sumber;
  row.querySelector('[data-scol="link"]').value = syncColFilter.link;
  row.querySelector('[data-scol="harga"]').value = syncColFilter.harga;
  row.querySelector('[data-scol="status"]').value = syncStatusFilter;
  // input teks cuma disentuh kalau beda (jangan ganggu kursor saat user lagi ngetik)
  const ik = row.querySelector('[data-scol="kode"]'), id = row.querySelector('[data-scol="desk"]');
  if (ik.value !== syncColFilter.kode) ik.value = syncColFilter.kode;
  if (id.value !== syncColFilter.desk) id.value = syncColFilter.desk;
  // Penanda visual: input/dropdown yang lagi dipakai + header kolomnya diberi warna aksen.
  row.querySelectorAll('[data-scol]').forEach(el => el.classList.toggle('is-active', el.value.trim() !== '' && el.value !== 'all'));
  const ths = row.closest('table').tHead.rows[0].cells;
  const colActive = [false, !!syncColFilter.kode.trim(), !!syncColFilter.desk.trim(), syncColFilter.link !== 'all',
    syncColFilter.harga !== 'all', syncColFilter.sumber !== 'all', syncStatusFilter !== 'all'];
  colActive.forEach((on, i) => { if (ths[i]) ths[i].classList.toggle('sync-th-active', on); });
  const rb = row.querySelector('#syncColResetBtn');
  if (rb) rb.style.display = (syncHasColFilter() || syncStatusFilter !== 'all') ? '' : 'none';
}

async function renderSyncPage(){
  renderSyncFilters();
  const tbody = document.getElementById('syncTableBody');
  if (!tbody) return; // user udah pindah halaman selagi query jalan
  const list = getFilteredSyncRows();
  const total = list.length;
  const q = syncSearchQuery.trim();
  const filtered = !!q || syncStatusFilter !== 'all' || syncTipeFilter !== 'all' || syncHasColFilter();
  document.getElementById('syncCount').textContent = filtered
    ? `${total} dari ${syncRows.length} kode produk (terfilter)`
    : `${syncRows.length} kode produk belum terdaftar`;
  const pagEl = document.getElementById('syncPagination');
  renderSyncActiveBar(total);

  if (!total) {
    tbody.innerHTML = filtered
      ? `<tr class="state-row"><td colspan="8">Tidak ada kode produk yang cocok dengan filter/pencarian ini.<div style="margin-top:10px;"><button type="button" class="btn btn-sm" data-saf="__all__"><i class="ti ti-filter-off"></i> Reset semua filter</button></div></td></tr>`
      : `<tr class="state-row"><td colspan="8">Semua kode produk dari sheet sudah terdaftar di database 🎉</td></tr>`;
    renderPgBar(pagEl, { page: 1, pageSize: SYNC_PAGE_SIZE, total: 0, onPageChange: () => {} });
    return;
  }
  const totalPages = Math.max(1, Math.ceil(total / SYNC_PAGE_SIZE));
  if (syncPage > totalPages) syncPage = totalPages;
  if (syncPage < 1) syncPage = 1;
  const pageRows = list.slice((syncPage - 1) * SYNC_PAGE_SIZE, syncPage * SYNC_PAGE_SIZE);
  const pageAtRender = syncPage;

  // Lookup pendukung cuma untuk baris di halaman ini (bukan seluruh daftar).
  // Nama set untuk keterangan "dibutuhkan oleh set": prioritas nama_produk di
  // tabel produk (set sudah dibuat), lalu deskripsi dari baris sync (set baru
  // dari sheet), terakhir fallback ke kode.
  const nameByKode = new Map();
  syncRows.forEach(r => { if (r.deskripsi) nameByKode.set(r.kode_produk, r.deskripsi); });
  const setKodes = [...new Set(pageRows.flatMap(r => Array.isArray(r.dibutuhkan_oleh) ? r.dibutuhkan_oleh : []))];
  for (let i = 0; i < setKodes.length; i += 200) {
    const { data: setRows } = await S.sb.from('produk').select('kode_produk, nama_produk').in('kode_produk', setKodes.slice(i, i + 200));
    (setRows || []).forEach(p => { if (p.nama_produk) nameByKode.set(p.kode_produk, p.nama_produk); });
  }
  // Status komposisi tiap SET di halaman ini (1 query batch) -> dipakai buat penanda peringatan di baris.
  const komposisiKodes = pageRows.filter(r => r.is_set).flatMap(r => (Array.isArray(r.komposisi) ? r.komposisi : []).map(k => k?.kode_produk));
  const tipeMap = komposisiKodes.length ? await fetchProdukTipeMap(komposisiKodes) : null;
  if (pageAtRender !== syncPage || !document.getElementById('syncTableBody')) return; // user ganti halaman/pindah view selagi query jalan

  renderPgBar(pagEl, { page: syncPage, pageSize: SYNC_PAGE_SIZE, total, onPageChange: (p) => { syncPage = p; renderSyncPage(); } });
  tbody.innerHTML = '';
  pageRows.forEach(row => {
    const komposisiInfo = (row.is_set && tipeMap) ? summarizeKomposisi(row.komposisi, tipeMap) : null;
    const ev = evalSyncRow(row);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="checkbox" class="sync-sel" ${ev.level === 'bad' ? 'disabled' : ''} ${syncSelected.has(row.kode_produk) ? 'checked' : ''}/></td>
      <td class="kode-cell" style="white-space:normal;word-break:break-word;max-width:190px;">${S.escapeHtml(row.kode_produk)}</td>
      <td class="sync-desc-cell" title="${S.escapeHtml(row.deskripsi || '')}" style="max-width:380px;white-space:normal;">
        <div style="font-weight:500;line-height:1.35;">${row.deskripsi ? S.escapeHtml(row.deskripsi) : '<span style="color:var(--text-muted);font-weight:400;">(tanpa deskripsi)</span>'}</div>
        ${syncPayloadHtml(row)}${syncNoteHtml(row, nameByKode, komposisiInfo)}
      </td>
      <td>${syncLinkHtml(row.link)}</td>
      <td style="white-space:nowrap;font-variant-numeric:tabular-nums;">${row.harga_ekat != null ? Number(row.harga_ekat).toLocaleString('id-ID') : '<span style="color:var(--text-muted);">—</span>'}</td>
      <td style="white-space:nowrap;">${S.escapeHtml(row.source_sheet || '—')}<div style="margin-top:2px;font-size:11px;color:var(--text-muted);">${row.last_seen_at ? new Date(row.last_seen_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' }) : ''}</div></td>
      <td style="min-width:130px;">${syncStatusHtml(ev)}</td>
      <td><button class="btn btn-sm btn-accent sync-add-btn" style="white-space:nowrap;"><i class="ti ti-plus"></i> Tambah</button></td>
    `;
    tr.querySelector('.sync-sel').addEventListener('change', (e) => {
      if (e.target.checked) syncSelected.add(row.kode_produk); else syncSelected.delete(row.kode_produk);
      updateSyncBulkBar();
    });
    const btn = tr.querySelector('.sync-add-btn');
    btn.addEventListener('click', async () => {
      // SET dikenali dari sheet SET FIX V6, atau dari kode_set di RINCIAN SET.
      const isSet = !!(row.is_set || row.source_sheet === 'SET FIX V6');
      if (isSet) {
        btn.disabled = true;
        try { if (!await confirmSetKomposisi(row)) return; }
        finally { btn.disabled = false; }
      }
      S.openAdd({
        kode_produk: row.kode_produk,
        link_v6: row.link,
        nama_produk: row.deskripsi,
        tipe: isSet ? 'SET' : (row.tipe_hint || undefined),
        kode_asli: (row.payload && row.payload.kode_asli) || undefined,
        spesifikasi: (row.payload && row.payload.spesifikasi) || undefined,
      });
    });
    tbody.appendChild(tr);
  });

  updateSyncBulkBar();
}

// Sumber data tab Sync. Dipanggil tiap tab dibuka (refetch penuh, halaman aktif dipertahankan
// dan di-clamp kalau daftar menyusut). Ganti halaman cuma render ulang dari syncRows, tanpa refetch.
async function loadSyncUnmatched(){
  const tbody = document.getElementById('syncTableBody');
  if (!tbody) return;
  const { data: rawData, error } = await fetchAllSyncRows();
  if (error) {
    tbody.innerHTML = `<tr class="state-row"><td colspan="8">Gagal memuat: ${S.escapeHtml(error.message)}</td></tr>`;
    document.getElementById('syncCount').textContent = 'Gagal memuat';
    renderPgBar(document.getElementById('syncPagination'), { page: 1, pageSize: SYNC_PAGE_SIZE, total: 0, onPageChange: () => {} });
    return;
  }

  // FIX: sebelumnya row di sini cuma ilang kalau edge function sync-sheet
  // sempet jalan ulang (lewat poll Apps Script) dan nemuin kode_produk-nya
  // udah ada -- jadi kalau produknya ditambah manual dari sini (atau dari
  // mana pun), row-nya nyangkut terus sampe poll berikutnya. Sekarang
  // di-double-check langsung ke tabel produk tiap kali tab ini dimuat: kode
  // yang udah punya baris di produk dianggap SUDAH sync, di-filter dari
  // tampilan, dan row-nya dihapus dari sync_unmatched_produk (fire-and-forget,
  // gak nunda render) biar gak keperiksa lagi ke depannya.
  // Di-chunk 200 kode per query biar URL .in() gak kepanjangan kalau daftar sync besar.
  let data = rawData || [];
  if (data.length) {
    const sudahAdaSet = new Set();
    let cekOk = true;
    for (let i = 0; i < data.length; i += 200) {
      const chunk = data.slice(i, i + 200).map(r => r.kode_produk);
      const { data: sudahAda, error: cekErr } = await S.sb.from('produk').select('kode_produk').in('kode_produk', chunk);
      if (cekErr) { cekOk = false; break; }
      (sudahAda || []).forEach(p => sudahAdaSet.add(p.kode_produk));
    }
    if (cekOk && sudahAdaSet.size) {
      data = data.filter(r => !sudahAdaSet.has(r.kode_produk));
      const del = Array.from(sudahAdaSet);
      for (let i = 0; i < del.length; i += 200) {
        S.sb.from('sync_unmatched_produk').delete().in('kode_produk', del.slice(i, i + 200))
          .then(({ error: delErr }) => { if (delErr) console.warn('Gagal bersihin sync_unmatched_produk:', delErr.message); });
      }
    }
  }

  syncRows = data;
  await renderSyncPage();
}

  // Diakses dari switchView()/index.js (tab KFA & Sinkronisasi) dan dari
  // tombol "Lompat ke KFA" di modal edit produk (baris jumpToKfaLink).
  S.loadKfa = loadKfa;
  S.refreshKfaFilterCounts = refreshKfaFilterCounts;
  S.loadSyncUnmatched = loadSyncUnmatched;
  S.jumpToKfaSearch = function jumpToKfaSearch(query) {
    kfaSearchQuery = query;
    loadKfa(1);
  };
}