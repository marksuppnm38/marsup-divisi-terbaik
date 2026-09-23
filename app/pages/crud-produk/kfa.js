// AUTO-EXTRACTED dari crud-produk/index.js (breakup, lanjutan akd-master.js).
// sb/escapeHtml diakses lewat S.sb/S.escapeHtml. openAdd (fungsi modal
// tambah/edit produk yang MASIH tinggal di index.js) diakses lewat
// S.openAdd -- dipakai loadSyncUnmatched() buat tombol "Tambah Produk".
// showToast/crudConfirm/crudAlert/renderPgBar tetap import langsung dari
// ui-utils.js, konsisten sama akd-master.js. Logic TIDAK diubah.
import { showToast, crudConfirm, crudAlert, renderPgBar } from './ui-utils.js';

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
async function loadSyncUnmatched(){
  const tbody = document.getElementById('syncTableBody');
  const { data: rawData, error } = await S.sb.from('sync_unmatched_produk').select('*').order('last_seen_at', { ascending: false });
  if (error) {
    tbody.innerHTML = `<tr class="state-row"><td colspan="6">Gagal memuat: ${S.escapeHtml(error.message)}</td></tr>`;
    document.getElementById('syncCount').textContent = 'Gagal memuat';
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
  let data = rawData || [];
  if (data.length) {
    const kodeList = data.map(r => r.kode_produk);
    const { data: sudahAda } = await S.sb.from('produk').select('kode_produk').in('kode_produk', kodeList);
    const sudahAdaSet = new Set((sudahAda || []).map(p => p.kode_produk));
    if (sudahAdaSet.size) {
      data = data.filter(r => !sudahAdaSet.has(r.kode_produk));
      S.sb.from('sync_unmatched_produk').delete().in('kode_produk', Array.from(sudahAdaSet))
        .then(({ error: delErr }) => { if (delErr) console.warn('Gagal bersihin sync_unmatched_produk:', delErr.message); });
    }
  }

  document.getElementById('syncCount').textContent = `${data.length} kode produk belum terdaftar`;
  if (!data.length) {
    tbody.innerHTML = `<tr class="state-row"><td colspan="6">Semua kode produk dari sheet sudah terdaftar di database 🎉</td></tr>`;
    return;
  }
  tbody.innerHTML = '';
  data.forEach(row => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="kode-cell">${S.escapeHtml(row.kode_produk)}</td>
      <td>${row.link ? `<a href="${S.escapeHtml(row.link)}" target="_blank" rel="noopener">${S.escapeHtml(row.link)}</a>` : '—'}</td>
      <td>${row.harga_ekat != null ? Number(row.harga_ekat).toLocaleString('id-ID') : '—'}</td>
      <td>${S.escapeHtml(row.source_sheet || '—')}</td>
      <td>${row.last_seen_at ? new Date(row.last_seen_at).toLocaleString('id-ID') : '—'}</td>
      <td><button class="btn btn-sm btn-accent sync-add-btn"><i class="ti ti-plus"></i> Tambah Produk</button></td>
    `;
    tr.querySelector('.sync-add-btn').addEventListener('click', () => {
      S.openAdd({ kode_produk: row.kode_produk, link_v6: row.link });
    });
    tbody.appendChild(tr);
  });
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