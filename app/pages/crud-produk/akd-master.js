// AUTO-EXTRACTED dari crud-produk/index.js (breakup, pola sama kayak
// konversian/*.js — S = objek shared state yang dioper dari index.js,
// installXxx(S) dipanggil di dalam mount(). Semua referensi ke 'sb' dan
// 'escapeHtml' (yang aslinya closure-scope dalam mount()/module-scope di
// index.js) diganti jadi S.sb / S.escapeHtml. showToast/crudConfirm/
// crudAlert/renderPgBar TETAP diimport langsung dari ui-utils.js (bukan
// lewat S) karena keduanya sama-sama sudah level module, gak perlu
// nebeng S. Logic di dalam TIDAK diubah sama sekali.
import { showToast, crudConfirm, crudAlert, renderPgBar } from './ui-utils.js';

export function installAkdMaster(S) {
// ================================================================
// AKD MANAGEMENT
// ================================================================
const AKD_COLUMNS = 'id, tipe_akd, no_akd, nama_akd, nama_database, kategori_set, penanda_kode, golongan, masa_berlaku, tgl_maju_mas_munir, status_terupdate, link_dokumen, update_progres, created_at, updated_at, kode_set';
const AKD_PAGE_SIZE = 30;

let akdPage = 1;
let akdSearchQuery = '';
let akdDistinct = { golongan: [], status_terupdate: [] }; // dipakai buat datalist "Golongan" & "Status Terupdate" di modal Tambah/Edit AKD

// Nilai golongan/status_terupdate dimuat dari data aktual (bukan hardcode)
// biar datalist di modal Tambah/Edit AKD selalu sinkron sama isi database beneran.
async function loadAkdDistinctValues(){
  // Dulu 2x S.sb.from('akd').select(...).limit(3000) -> sama risikonya kayak bug
  // Tipe produk sebelumnya, cuma di sini dampaknya ke datalist Golongan/Status
  // Terupdate di modal Tambah/Edit AKD (bukan filter). DISTINCT sekarang dihitung
  // penuh di Postgres lewat get_akd_distinct_filters.
  const { data, error } = await S.sb.rpc('get_akd_distinct_filters');
  if (error) {
    showToast('Gagal memuat opsi golongan/status AKD: ' + error.message, true);
    return;
  }
  akdDistinct.golongan = data?.golongan || [];
  akdDistinct.status_terupdate = data?.status_terupdate || [];
  document.getElementById('akd_golongan_list').innerHTML = akdDistinct.golongan.map(g => `<option value="${S.escapeHtml(g)}">`).join('');
  document.getElementById('akd_status_list').innerHTML = akdDistinct.status_terupdate.map(s => `<option value="${S.escapeHtml(s)}">`).join('');
}

function akdMasaBerlakuPill(dateStr){
  if (!dateStr) return `<span class="status-pill neutral">—</span>`;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + 'T00:00:00');
  const diffDays = Math.round((d - today) / 86400000);
  const label = d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
  if (diffDays < 0) return `<span class="status-pill bad" title="Sudah expired ${Math.abs(diffDays)} hari lalu">${label}</span>`;
  if (diffDays <= 30) return `<span class="status-pill warn" title="Akan expired ${diffDays} hari lagi">${label}</span>`;
  return `<span class="status-pill ok">${label}</span>`;
}

async function renderAkdTable(rows){
  const tbody = document.getElementById('akdTableBody');
  if (!rows.length) { tbody.innerHTML = `<tr class="state-row"><td colspan="9">Tidak ada AKD ditemukan.</td></tr>`; return; }
  // Jumlah produk terhubung buat baris yang lagi tampil -> query kecil per halaman.
  const idsOnPage = rows.map(r => r.id);
  const counts = new Map();
  if (idsOnPage.length) {
    const { data: linkRows } = await S.sb.from('produk_akd').select('akd_id').in('akd_id', idsOnPage);
    (linkRows || []).forEach(r => counts.set(r.akd_id, (counts.get(r.akd_id) || 0) + 1));
  }
  tbody.innerHTML = '';
  rows.forEach(r => {
    const cnt = counts.get(r.id) || 0;
    const tr = document.createElement('tr');
    tr.className = 'clickable';
    tr.innerHTML = `
      <td class="kode-cell">${S.escapeHtml(r.no_akd)}</td>
      <td>${S.escapeHtml(r.nama_akd || '—')}</td>
      <td><span class="tipe-chip">${S.escapeHtml(r.tipe_akd || '—')}</span></td>
      <td>${S.escapeHtml(r.golongan || '—')}</td>
      <td>${S.escapeHtml(r.kategori_set || '—')}</td>
      <td>${akdMasaBerlakuPill(r.masa_berlaku)}</td>
      <td>${S.escapeHtml(r.status_terupdate || '—')}</td>
      <td style="text-align:center;">${r.link_dokumen ? '<i class="ti ti-link link-yes" title="Sudah ada link dokumen"></i>' : '<i class="ti ti-link-off link-no" title="Belum ada link dokumen"></i>'}</td>
      <td>${cnt > 0 ? `<span class="status-pill ok">${cnt} produk</span>` : `<span class="status-pill neutral">Belum ada</span>`}</td>
    `;
    tr.addEventListener('click', () => openEditAkd(r.id));
    tbody.appendChild(tr);
  });
}

// Browse sederhana: tanpa search -> query server (paged, count exact).
// Dengan search -> pakai ILIKE di server juga (bukan fetch-semua-lalu-filter-client),
// biar halaman AKD tetap ringan dan gak nyimpen cache 5000 baris di memori.
async function loadAkd(page){
  akdPage = page || akdPage || 1;
  const tbody = document.getElementById('akdTableBody');
  tbody.innerHTML = `<tr class="state-row"><td colspan="9">Memuat data...</td></tr>`;
  document.getElementById('akdCount').textContent = 'Memuat...';

  const from = (akdPage - 1) * AKD_PAGE_SIZE, to = from + AKD_PAGE_SIZE - 1;
  let query = S.sb.from('akd').select(AKD_COLUMNS, { count: 'exact' });
  const q = akdSearchQuery.trim();
  if (q) query = query.or(`no_akd.ilike.%${q}%,nama_akd.ilike.%${q}%,kode_set.ilike.%${q}%`);
  const { data, error, count } = await query.order('updated_at', { ascending: false }).range(from, to);
  if (error) { tbody.innerHTML = `<tr class="state-row"><td colspan="9">Gagal memuat: ${S.escapeHtml(error.message)}</td></tr>`; return; }
  const rows = data || [], total = count || 0;

  document.getElementById('akdCount').textContent = total + ' AKD' + (q ? ` untuk "${q}"` : '');
  renderPgBar(document.getElementById('akdPagination'), { page: akdPage, pageSize: AKD_PAGE_SIZE, total, onPageChange: (p) => loadAkd(p) });
  await renderAkdTable(rows);
}

// ---- Search box ----
let akdSearchDebounce = null;
document.getElementById('akdSearchBoxInput').addEventListener('input', (e) => {
  clearTimeout(akdSearchDebounce);
  akdSearchDebounce = setTimeout(() => { akdSearchQuery = e.target.value; loadAkd(1); }, 300);
});

// ---- Modal Tambah/Edit AKD ----
const akdModalOverlay = document.getElementById('akdModalOverlay');
let currentAkdId = null;
const AKD_FORM_FIELDS = ['a_tipe_akd','a_no_akd','a_nama_akd','a_nama_database','a_kode_set','a_kategori_set','a_penanda_kode','a_golongan','a_masa_berlaku','a_tgl_maju_mas_munir','a_status_terupdate','a_link_dokumen','a_update_progres'];

document.getElementById('addAkdBtn').addEventListener('click', openAddAkd);
document.getElementById('akdModalCloseBtn').addEventListener('click', closeAkdModal);
document.getElementById('akdCancelBtn').addEventListener('click', closeAkdModal);
akdModalOverlay.addEventListener('click', (e) => { if (e.target === akdModalOverlay) closeAkdModal(); });

function closeAkdModal(){ akdModalOverlay.classList.remove('open'); }
function clearAkdForm(){ AKD_FORM_FIELDS.forEach(id => document.getElementById(id).value = ''); }

function openAddAkd(){
  currentAkdId = null;
  clearAkdForm();
  document.getElementById('akdModalTitle').textContent = 'Tambah AKD';
  document.getElementById('akdModalSub').textContent = 'Isi data AKD baru';
  document.getElementById('deleteAkdBtn').style.display = 'none';
  document.getElementById('akdLinkedProdukLabel').style.display = 'none';
  document.getElementById('akdLinkedProdukList').style.display = 'none';
  akdModalOverlay.classList.add('open');
}

async function openEditAkd(id){
  currentAkdId = id;
  clearAkdForm();
  document.getElementById('akdModalTitle').textContent = 'Memuat...';
  document.getElementById('akdModalSub').textContent = '';
  document.getElementById('deleteAkdBtn').style.display = 'none';
  document.getElementById('akdLinkedProdukLabel').style.display = 'none';
  document.getElementById('akdLinkedProdukList').style.display = 'none';
  akdModalOverlay.classList.add('open');

  const { data: r, error } = await S.sb.from('akd').select(AKD_COLUMNS).eq('id', id).single();
  if (error) { showToast('Gagal memuat AKD: ' + error.message, true); closeAkdModal(); return; }

  document.getElementById('akdModalTitle').textContent = 'Edit AKD';
  document.getElementById('akdModalSub').textContent = r.no_akd || '';
  document.getElementById('a_tipe_akd').value = r.tipe_akd || '';
  document.getElementById('a_no_akd').value = r.no_akd || '';
  document.getElementById('a_nama_akd').value = r.nama_akd || '';
  document.getElementById('a_nama_database').value = r.nama_database || '';
  document.getElementById('a_kode_set').value = r.kode_set || '';
  document.getElementById('a_kategori_set').value = r.kategori_set || '';
  document.getElementById('a_penanda_kode').value = r.penanda_kode || '';
  document.getElementById('a_golongan').value = r.golongan || '';
  document.getElementById('a_masa_berlaku').value = r.masa_berlaku || '';
  document.getElementById('a_tgl_maju_mas_munir').value = r.tgl_maju_mas_munir || '';
  document.getElementById('a_status_terupdate').value = r.status_terupdate || '';
  document.getElementById('a_link_dokumen').value = r.link_dokumen || '';
  document.getElementById('a_update_progres').value = r.update_progres || '';
  document.getElementById('deleteAkdBtn').style.display = '';

  // Reverse-lookup: produk mana aja yang terhubung ke AKD ini
  const { data: links } = await S.sb.from('produk_akd').select('produk:produk_id(id, kode_produk, nama_produk)').eq('akd_id', id);
  const produkList = (links || []).map(l => l.produk).filter(Boolean);
  document.getElementById('akdLinkedProdukLabel').style.display = '';
  document.getElementById('akdLinkedProdukLabel').textContent = `Produk Terhubung (${produkList.length})`;
  const listEl = document.getElementById('akdLinkedProdukList');
  listEl.style.display = '';
  if (!produkList.length) {
    listEl.innerHTML = `<div class="akd-empty">Belum ada produk yang terhubung ke AKD ini.</div>`;
  } else {
    listEl.innerHTML = `<div class="akd-current">` + produkList.map(p =>
      `<span class="akd-chip"><span class="ac-no">${S.escapeHtml(p.kode_produk)}</span><span class="ac-nama">${S.escapeHtml(p.nama_produk || '')}</span></span>`
    ).join('') + `</div>`;
  }
}

document.getElementById('akdSaveBtn').addEventListener('click', async () => {
  const noAkd = document.getElementById('a_no_akd').value.trim();
  const tipeAkd = document.getElementById('a_tipe_akd').value;
  if (!noAkd) { showToast('No. AKD wajib diisi', true); return; }
  if (!tipeAkd) { showToast('Tipe AKD wajib dipilih', true); return; }
  const payload = {
    tipe_akd: tipeAkd,
    no_akd: noAkd,
    nama_akd: document.getElementById('a_nama_akd').value.trim() || null,
    nama_database: document.getElementById('a_nama_database').value.trim() || null,
    kode_set: document.getElementById('a_kode_set').value.trim() || null,
    kategori_set: document.getElementById('a_kategori_set').value.trim() || null,
    penanda_kode: document.getElementById('a_penanda_kode').value.trim() || null,
    golongan: document.getElementById('a_golongan').value.trim() || null,
    masa_berlaku: document.getElementById('a_masa_berlaku').value || null,
    tgl_maju_mas_munir: document.getElementById('a_tgl_maju_mas_munir').value || null,
    status_terupdate: document.getElementById('a_status_terupdate').value.trim() || null,
    link_dokumen: document.getElementById('a_link_dokumen').value.trim() || null,
    update_progres: document.getElementById('a_update_progres').value.trim() || null,
  };
  let error;
  if (currentAkdId) {
    ({ error } = await S.sb.from('akd').update(payload).eq('id', currentAkdId));
  } else {
    ({ error } = await S.sb.from('akd').insert(payload));
  }
  if (error) {
    if (error.code === '23505') { showToast('No. AKD ini sudah terdaftar', true); return; }
    showToast('Gagal menyimpan AKD: ' + error.message, true); return;
  }
  showToast('AKD tersimpan');
  closeAkdModal();
  loadAkdDistinctValues();
  loadAkd(akdPage);
});

// ---- Hapus AKD ----
// produk_akd.akd_id -> akd itu FK yang confdeltype-nya gak ada di daftar constraint
// yang dicek kemarin (yang dicek cuma FK yang NUJU ke tabel produk). Daripada asumsi,
// halaman ini proaktif ngeblok manual kalau AKD masih punya relasi ke produk_akd,
// baru minta dilepas dulu dari sana -- aman apapun aturan delete-nya di database.
document.getElementById('deleteAkdBtn').addEventListener('click', async () => {
  if (!currentAkdId) return;
  const id = currentAkdId;
  const { count } = await S.sb.from('produk_akd').select('id', { count: 'exact', head: true }).eq('akd_id', id);
  if (count) {
    await crudAlert(`AKD ini masih terhubung ke ${count} produk. Lepas dulu relasinya lewat halaman Produk (tombol "Kelola AKD") sebelum menghapus AKD ini.`);
    return;
  }
  if (!await crudConfirm('Hapus AKD ini? Tindakan ini tidak bisa dibatalkan.', { danger: true, okLabel: 'Ya, Hapus' })) return;
  const { error } = await S.sb.from('akd').delete().eq('id', id);
  if (error) { showToast('Gagal hapus AKD: ' + error.message, true); return; }
  showToast('AKD dihapus');
  closeAkdModal();
  loadAkd(akdPage);
});

  // Diakses dari switchView() di index.js waktu tab AKD pertama kali dibuka.
  S.loadAkd = loadAkd;
  S.loadAkdDistinctValues = loadAkdDistinctValues;
}