// AUTO-EXTRACTED dari crud-produk/index.js (breakup, pola sama kayak
// konversian/*.js — S = objek shared state yang dioper dari index.js,
// installXxx(S) dipanggil di dalam mount(). Semua referensi ke 'sb' dan
// 'escapeHtml' (yang aslinya closure-scope dalam mount()/module-scope di
// index.js) diganti jadi S.sb / S.escapeHtml. showToast/crudConfirm/
// crudAlert/renderPgBar TETAP diimport langsung dari ui-utils.js (bukan
// lewat S) karena keduanya sama-sama sudah level module, gak perlu
// nebeng S. Logic di dalam TIDAK diubah sama sekali.
import { showToast, crudConfirm, crudAlert, renderPgBar, guardHapus, barisTerhapus } from './ui-utils.js';
import { orIlike } from '../../../shared/api.js';
import { createDataTable } from '../../../shared/data-table.js';

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

// ---- Tabel dinamis (shared/data-table.js): urut + saring per kolom + kolom bisa dipilih ----
// Kolom di bawah = semua kolom tabel `akd` yang berguna + "Produk Terhubung" (dihitung, tidak bisa disort/filter).
// Yang tidak tampil bawaan (hidden) bisa dimunculkan dari tombol "Kolom".
const AKD_TIPE_OPTS = [{ value: 'satuan', label: 'satuan' }, { value: 'set', label: 'set' }, { value: 'unit', label: 'unit' }];
const akdOpts = (k) => () => akdDistinct[k] || [];
const AKD_COLS = [
  { key: 'no_akd', label: 'No. AKD', locked: true, td: 'kode-cell', render: (r) => S.escapeHtml(r.no_akd) },
  { key: 'nama_akd', label: 'Nama AKD' },
  { key: 'tipe_akd', label: 'Tipe', type: 'enum', options: AKD_TIPE_OPTS, render: (r) => `<span class="tipe-chip">${S.escapeHtml(r.tipe_akd || '—')}</span>` },
  { key: 'golongan', label: 'Golongan', type: 'enum', options: akdOpts('golongan') },
  { key: 'kategori_set', label: 'Kategori Set' },
  { key: 'masa_berlaku', label: 'Masa Berlaku', type: 'date', render: (r) => akdMasaBerlakuPill(r.masa_berlaku),
    sortLabels: ['Segera habis dulu', 'Paling lama berlaku dulu'],
    datePresets: [
      { label: 'Sudah kadaluarsa', filter: { op: 'expired' } },
      { label: 'Kadaluarsa ≤ 30 hari lagi', chip: 'dalam 30 hari', filter: { op: 'within', value: 30 } },
      { label: 'Kadaluarsa ≤ 90 hari lagi', chip: 'dalam 90 hari', filter: { op: 'within', value: 90 } },
    ] },
  { key: 'status_terupdate', label: 'Status Terupdate', type: 'enum', options: akdOpts('status_terupdate') },
  { key: 'link_dokumen', label: 'Link Dok.', sortable: false, tdStyle: 'text-align:center;',
    render: (r) => r.link_dokumen ? '<i class="ti ti-link link-yes" title="Sudah ada link dokumen"></i>' : '<i class="ti ti-link-off link-no" title="Belum ada link dokumen"></i>' },
  { key: 'produk_terhubung', label: 'Produk Terhubung', sortable: false, filterable: false,
    render: (r, ctx) => { const n = (ctx.counts && ctx.counts.get(r.id)) || 0; return n > 0 ? `<span class="status-pill ok">${n} produk</span>` : '<span class="status-pill neutral">Belum ada</span>'; } },
  // Tersembunyi bawaan -- dimunculkan lewat tombol "Kolom"
  { key: 'tgl_maju_mas_munir', label: 'Tgl Maju Mas Munir', type: 'date', hidden: true },
  { key: 'kode_set', label: 'Kode Set', hidden: true },
  { key: 'nama_database', label: 'Nama Database', hidden: true },
  { key: 'penanda_kode', label: 'Penanda Kode', hidden: true },
  { key: 'update_progres', label: 'Update Progres', hidden: true },
  { key: 'updated_at', label: 'Terakhir Diubah', type: 'date', hidden: true, fillFilter: false },
];
const akdDt = createDataTable({
  id: 'akd',
  columns: AKD_COLS,
  headRow: document.getElementById('akdHeadRow'),
  bar: document.getElementById('akdDtBar'),
  defaultSort: { key: 'updated_at', dir: 'desc' }, // sama dengan urutan lama
  tieBreak: 'id',
  presets: [
    { id: 'ringkas', label: 'Ringkas', keys: ['no_akd', 'nama_akd', 'masa_berlaku', 'status_terupdate'] },
    { id: 'kadaluarsa', label: 'Pantau kadaluarsa', keys: ['no_akd', 'nama_akd', 'masa_berlaku', 'tgl_maju_mas_munir', 'status_terupdate', 'update_progres', 'link_dokumen'] },
  ],
  onChange: () => loadAkd(1),
  onRowClick: (r) => openEditAkd(r.id),
  emptyText: 'Tidak ada AKD ditemukan.',
});

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
  if (!rows.length) { akdDt.renderBody(tbody, rows); return; }
  // Jumlah produk terhubung buat baris yang lagi tampil -> query kecil per halaman.
  const idsOnPage = rows.map(r => r.id);
  const counts = new Map();
  if (idsOnPage.length) {
    const { data: linkRows } = await S.sb.from('produk_akd').select('akd_id').in('akd_id', idsOnPage);
    (linkRows || []).forEach(r => counts.set(r.akd_id, (counts.get(r.akd_id) || 0) + 1));
  }
  akdDt.renderBody(tbody, rows, { counts });
}

// Browse sederhana: tanpa search -> query server (paged, count exact).
// Dengan search -> pakai ILIKE di server juga (bukan fetch-semua-lalu-filter-client),
// biar halaman AKD tetap ringan dan gak nyimpen cache 5000 baris di memori.
let akdReq = 0; // balapan: urut/filter diganti cepat -> hanya respons terbaru yang digambar
async function loadAkd(page){
  akdPage = page || akdPage || 1;
  const myReq = ++akdReq;
  const tbody = document.getElementById('akdTableBody');
  akdDt.showState(tbody, 'Memuat data...');
  document.getElementById('akdCount').textContent = 'Memuat...';

  const from = (akdPage - 1) * AKD_PAGE_SIZE, to = from + AKD_PAGE_SIZE - 1;
  let query = S.sb.from('akd').select(AKD_COLUMNS, { count: 'exact' });
  const q = akdSearchQuery.trim();
  if (q) query = query.or(orIlike(['no_akd', 'nama_akd', 'kode_set'], q));
  // Urutan + filter kolom dikerjakan server (shared/data-table.js), jadi paging tetap benar.
  const { data, error, count } = await akdDt.applyQuery(query).range(from, to);
  if (myReq !== akdReq) return;
  if (error) { akdDt.showState(tbody, 'Gagal memuat: ' + error.message); return; }
  const rows = data || [], total = count || 0;

  document.getElementById('akdCount').textContent = total + ' AKD' + (q ? ` untuk "${q}"` : '') + (akdDt.hasFilters() ? ' (terfilter)' : '');
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

const akdSaveBtn = document.getElementById('akdSaveBtn');
akdSaveBtn.addEventListener('click', async () => {
  // Simpan dobel (klik cepat / Ctrl+S dua kali) dulu bisa menembak update/insert dua kali.
  if (akdSaveBtn.disabled) return;
  akdSaveBtn.disabled = true;
  try { await saveAkd(); } finally { akdSaveBtn.disabled = false; }
});
async function saveAkd() {
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
  if (S.markProdukStale) S.markProdukStale({ distinct: true }); // status / masa berlaku / golongan produk terkait bisa ikut berubah
  closeAkdModal();
  loadAkdDistinctValues();
  loadAkd(akdPage);
}

// ---- Hapus AKD ----
// produk_akd.akd_id -> akd itu FK yang confdeltype-nya gak ada di daftar constraint
// yang dicek kemarin (yang dicek cuma FK yang NUJU ke tabel produk). Daripada asumsi,
// halaman ini proaktif ngeblok manual kalau AKD masih punya relasi ke produk_akd,
// baru minta dilepas dulu dari sana -- aman apapun aturan delete-nya di database.
document.getElementById('deleteAkdBtn').addEventListener('click', async () => {
  if (!currentAkdId) return;
  if (!guardHapus()) return;
  const id = currentAkdId;
  const { count } = await S.sb.from('produk_akd').select('id', { count: 'exact', head: true }).eq('akd_id', id);
  if (count) {
    await crudAlert(`AKD ini masih terhubung ke ${count} produk. Lepas dulu relasinya lewat halaman Produk (tombol "Kelola AKD") sebelum menghapus AKD ini.`);
    return;
  }
  if (!await crudConfirm('Hapus AKD ini? Tindakan ini tidak bisa dibatalkan.', { danger: true, okLabel: 'Ya, Hapus' })) return;
  const delRes = await S.sb.from('akd').delete().eq('id', id).select('id');
  if (delRes.error) { showToast('Gagal hapus AKD: ' + delRes.error.message, true); return; }
  if (!barisTerhapus(delRes)) { showToast('AKD tidak terhapus', true, { detail: 'Akun ini tidak punya izin, atau datanya sudah hilang.' }); return; }
  showToast('AKD dihapus');
  closeAkdModal();
  loadAkd(akdPage);
});

  // Diakses dari switchView() di index.js waktu tab AKD pertama kali dibuka.
  S.loadAkd = loadAkd;
  S.loadAkdDistinctValues = loadAkdDistinctValues;
}