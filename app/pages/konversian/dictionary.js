// AUTO-EXTRACTED dari konversian/index.js (breakup sesuai map.md bagian 3) — Claude, 2026-09-15.
// Region asli: lihat map.md bagian 2. Semua state lintas-file diakses lewat
// objek 'S' yang dioper dari index.js (S = window.__konvBridge-style shared
// state, TAPI bukan window global — cuma dioper sebagai parameter, lihat
// index.js: const S = {}; lalu install*(S) dipanggil berurutan).
// Logic di dalam TIDAK diubah — cuma referensi ke variabel/fungsi yang
// didefinisikan di file LAIN diganti jadi S.nama (lihat COORD LOG index.js).
export function installDictionary(S) {
// ══════════════════════════════════════════
// SARAN DICTIONARY INLINE — "organizational memory" muncul pas lagi ngerjain
// satu requirement, bukan jadi tab terpisah yang harus disambangin. Berkat
// accordion, paling banyak cuma SATU item yang expanded dalam satu waktu, jadi
// paling banyak cuma 1 pasang RPC call yang jalan bersamaan (bukan N+1 buat
// 20-50 item sekaligus) — di-cache per item.id biar gak nembak ulang tiap
// buka-tutup baris yang sama.
// ══════════════════════════════════════════
// <<DICT-SUGG-V2 BEGIN>>
// Bentuk cache sekarang: { loading:false, groups:[{istilah, tier, skor, utama:[row], lain:[row]}] } | null
// row = { kode_produk, nama_produk, freq, ukuran, src:'riwayat'|'katalog'|'varian' }
// Sumber data: RPC suggest_dictionary (lihat migration_suggest_dictionary.sql). Kalau RPC itu
// belum ada / error, jatuh balik ke jalur lama (get_dictionary_summary + _detail) biar UI tetap jalan.
const dictSuggestionCache = {}; // item.id -> {loading, groups} | null (null = udah dicek, gak ada saran)
S.dictSuggestionCache = dictSuggestionCache;

// CSS tambahan khusus elemen baru (label ukuran, chip, catatan). Class lama (kb-dict-sugg-row,
// -use, -attach, dst.) tetap pakai CSS yang sudah ada. Fallback warna dipakai kalau variabel tema gak ada.
(function ensureDictSuggStyles() {
  if (document.getElementById('kb-dict-sugg-v2-style')) return;
  const st = document.createElement('style');
  st.id = 'kb-dict-sugg-v2-style';
  st.textContent = `
    .kb-dict-sugg-group + .kb-dict-sugg-group { margin-top:8px; padding-top:8px; border-top:1px dashed var(--border,#ddd); }
    .kb-dict-sugg-group.lemah .kb-dict-suggestion-label { color: var(--text-muted,#888); }
    .kb-dict-sugg-hint { font-size:11px; color: var(--text-muted,#888); margin:2px 0 4px; }
    .kb-dict-sugg-uk { font-size:10px; padding:1px 6px; border-radius:8px; margin-left:6px; white-space:nowrap; }
    .kb-dict-sugg-uk.cocok { background: var(--success-bg,#e6f4ea); color: var(--success,#1e7e34); }
    .kb-dict-sugg-uk.dekat { background: var(--surface-3,#eee); color: var(--text-secondary,#555); }
    .kb-dict-sugg-uk.beda  { background: #fff4e0; color: var(--warning,#b26a00); }
    .kb-dict-sugg-chips { display:flex; flex-wrap:wrap; gap:4px; align-items:center; margin-top:6px; font-size:11px; color: var(--text-muted,#888); }
    .kb-dict-sugg-chip { font-size:11px; padding:2px 8px; border:1px solid var(--border,#ddd); border-radius:10px;
      background: var(--surface,#fff); color: var(--text,#222); cursor:pointer; }
    .kb-dict-sugg-chip:hover { border-color: var(--accent,#2563eb); }
    .kb-dict-sugg-chip:disabled { opacity:.6; cursor:default; }
  `;
  document.head.appendChild(st);
})();

// Label ukuran pendek dari nama produk, buat chip ("16.5 cm"). null kalau gak ada.
function dictSizeLabel(nama) {
  const m = /(\d+(?:[.,]\d+)?)\s*(cm|mm)(?![a-z])/i.exec(nama || '');
  return m ? m[1].replace(',', '.') + ' ' + m[2].toLowerCase() : null;
}

// Baris datar dari RPC -> grup per istilah. Aturan penempatan baris:
//   tier 'varian'                       -> lain  (ukuran lain yang tersedia, cuma kalau ukuran gak diminta)
//   tier 'katalog'                      -> utama (SKU ukuran yang diminta, dari katalog)
//   baris istilah dgn ukuran 'beda'     -> lain, KECUALI semua baris grup itu 'beda' (maka tetap utama + diberi peringatan)
//   sisanya (cocok/dekat/tidak_*)       -> utama
function groupSuggestionRows(rows) {
  const groups = [];
  const byIstilah = new Map();
  (rows || []).forEach(r => {
    let g = byIstilah.get(r.istilah);
    if (!g) {
      g = { istilah: r.istilah, tier: null, skor: Number(r.skor), utama: [], lain: [], _beda: [] };
      byIstilah.set(r.istilah, g); groups.push(g);
    }
    const row = {
      kode_produk: r.kode_produk, nama_produk: r.nama_produk,
      freq: Number(r.freq) || 0, ukuran: r.ukuran,
      src: r.tier === 'katalog' ? 'katalog' : (r.tier === 'varian' ? 'varian' : 'riwayat')
    };
    if (r.tier !== 'katalog' && r.tier !== 'varian' && !g.tier) g.tier = r.tier;
    if (r.tier === 'varian') g.lain.push(row);
    else if (r.tier === 'katalog') g.utama.push(row);
    else if (r.ukuran === 'beda') g._beda.push(row);
    else g.utama.push(row);
  });
  groups.forEach(g => {
    if (g.utama.length === 0 && g._beda.length) g.utama = g._beda;   // cuma ada ukuran beda: tetap tampilkan, tapi berperingatan
    else g.lain = g._beda.concat(g.lain);
    delete g._beda;
    if (!g.tier) g.tier = 'exact';
  });
  return groups.filter(g => g.utama.length || g.lain.length);
}

// Jalur lama (get_dictionary_summary + get_dictionary_detail) dibungkus ke bentuk grup yang sama.
async function fetchLegacySuggestion(item) {
  const { data: summaryRows, error: summaryErr } = await S.rpc('get_dictionary_summary', {
    p_search: item.raw_text, p_filter: 'semua', p_sort: 'frekuensi', p_limit: 1, p_offset: 0
  });
  if (summaryErr) throw new Error(summaryErr.message || summaryErr.hint || 'get_dictionary_summary gagal');
  const top = summaryRows && summaryRows[0];
  if (!top) return null;
  const { data: detailRows, error: detailErr } = await S.rpc('get_dictionary_detail', { p_istilah: top.istilah_customer });
  if (detailErr) throw new Error(detailErr.message || detailErr.hint || 'get_dictionary_detail gagal');
  return { loading: false, groups: [{
    istilah: top.istilah_customer, tier: 'legacy', skor: null,
    utama: (detailRows || []).slice(0, 3).map(p => ({
      kode_produk: p.kode_produk, nama_produk: p.nama_produk,
      freq: Number(p.jumlah_pemakaian) || 0, ukuran: 'tidak_diminta', src: 'riwayat'
    })), lain: []
  }] };
}

async function fetchDictSuggestionFor(item) {
  if (dictSuggestionCache[item.id] !== undefined) return; // udah pernah dicek (ada hasil ATAU emang null)
  dictSuggestionCache[item.id] = { loading: true };
  try {
    const { data, error } = await S.rpc('suggest_dictionary', { p_text: item.raw_text, p_limit: 3 });
    if (error) throw new Error(error.message || error.hint || 'suggest_dictionary gagal');
    const groups = groupSuggestionRows(data);
    dictSuggestionCache[item.id] = groups.length ? { loading: false, groups } : null;
  } catch (err) {
    console.warn('suggest_dictionary gagal, pakai jalur lama buat "' + item.raw_text + '":', err);
    try {
      dictSuggestionCache[item.id] = await fetchLegacySuggestion(item);
    } catch (err2) {
      console.error('Gagal ambil saran Dictionary buat "' + item.raw_text + '":', err2);
      dictSuggestionCache[item.id] = null; // jangan block UI checklist-nya
    }
  }
  // Item ini mungkin masih expanded pas fetch selesai — patch biar sarannya muncul.
  // Kalau user udah pindah ke item lain, patchChecklistItem no-op aman aja.
  if (S.checklistExpandedId === item.id) S.patchChecklistItem(item.id, {});
}

// Label per tier. kuat = pernah dipakai persis; sedang = produk sama beda ukuran; lemah = tebakan mirip.
const DICT_TIER_UI = {
  exact:    { cls: 'kuat',   icon: 'ti-history', pre: 'Pernah dipakai buat', post: '' },
  urutan:   { cls: 'kuat',   icon: 'ti-history', pre: 'Pernah dipakai buat', post: ' (urutan kata beda)' },
  keluarga: { cls: 'sedang', icon: 'ti-history', pre: 'Produk sama, ukuran lain — dari', post: '' },
  umum:     { cls: 'lemah',  icon: 'ti-bulb',    pre: 'Istilah lebih umum:', post: '', hint: 'Permintaan ini lebih spesifik dari istilah di riwayat — pilih varian yang sesuai.' },
  sempit:   { cls: 'lemah',  icon: 'ti-bulb',    pre: 'Istilah lebih spesifik:', post: '', hint: 'Permintaan ini lebih umum dari istilah di riwayat — cek dulu sebelum dipakai.' },
  fuzzy:    { cls: 'lemah',  icon: 'ti-bulb',    pre: 'Mirip dengan', post: '', hint: 'Kecocokan perkiraan — cek dulu sebelum dipakai.' },
  legacy:   { cls: 'sedang', icon: 'ti-history', pre: 'Biasa dipakai buat', post: '' }
};
const DICT_UKURAN_LABEL = {
  cocok: ['cocok', 'ukuran cocok'],
  dekat: ['dekat', 'ukuran dekat'],
  beda:  ['beda',  'ukuran beda']
};

function renderDictSuggestionHtml(item, sugg) {
  if (sugg === undefined || sugg === null) return '';
  if (sugg.loading) return `<div class="kb-dict-suggestion loading">Ngecek riwayat pemakaian…</div>`;
  const groups = (sugg.groups || []).slice(0, 2);
  if (!groups.length) return '';
  const esc = S.escapeHtmlAttr;
  const inClip = kode => S.clipboard.some(c => c.kode_produk === kode);

  const groupsHtml = groups.map(g => {
    const ui = DICT_TIER_UI[g.tier] || DICT_TIER_UI.fuzzy;
    const rows = g.utama.slice(0, 5).map(p => {
      const uk = DICT_UKURAN_LABEL[p.ukuran];
      const ukBadge = uk ? `<span class="kb-dict-sugg-uk ${uk[0]}" title="${p.ukuran === 'dekat' ? 'Selisih ≤ 0,5 cm dari ukuran yang diminta (pembulatan umum, mis. 14 cm vs 14,5 cm)' : p.ukuran === 'beda' ? 'Ukuran produk ini beda dari yang diminta' : ''}">${uk[1]}</span>` : '';
      const freqTxt = p.src === 'katalog' ? 'SKU ukuran yang diminta (dari katalog)' : `${p.freq.toLocaleString('id-ID')}× dipakai`;
      const btn = inClip(p.kode_produk)
        ? `<button class="kb-dict-sugg-use" data-action="use-suggestion" data-id="${item.id}" data-kode="${esc(p.kode_produk)}">Pakai</button>`
        : `<button class="kb-dict-sugg-attach" data-action="attach-suggestion" data-id="${item.id}" data-kode="${esc(p.kode_produk)}" title="Belum ada di Clipboard sesi ini — tambahin dulu">+ Tambah & Pakai</button>`;
      return `<div class="kb-dict-sugg-row">
        <div class="kb-dict-sugg-info">
          <span class="kb-dict-sugg-nama">${esc(p.nama_produk || p.kode_produk)}${ukBadge}</span>
          <span class="kb-dict-sugg-freq">${freqTxt}</span>
        </div>
        ${btn}
      </div>`;
    }).join('');

    // Istilah kuat yang punya >1 produk berbeda = ambigu (bukan bug): jangan pura-pura yakin.
    const ambigu = (g.tier === 'exact' || g.tier === 'urutan') && g.utama.filter(p => p.src === 'riwayat').length > 1
      ? `<div class="kb-dict-sugg-hint">Istilah ini pernah dipenuhi ${g.utama.filter(p => p.src === 'riwayat').length} produk berbeda — pilih yang sesuai.</div>` : '';
    const hint = ui.hint ? `<div class="kb-dict-sugg-hint">${ui.hint}</div>` : '';

    const chips = g.lain.length ? `<div class="kb-dict-sugg-chips"><span>Ukuran lain:</span>${g.lain.slice(0, 12).map(p => {
      const lbl = dictSizeLabel(p.nama_produk) || (p.nama_produk || p.kode_produk).slice(0, 24);
      const act = inClip(p.kode_produk) ? 'use-suggestion' : 'attach-suggestion';
      return `<button class="kb-dict-sugg-chip" type="button" data-action="${act}" data-id="${item.id}" data-kode="${esc(p.kode_produk)}" title="${esc(p.nama_produk || p.kode_produk)}">${esc(lbl)}</button>`;
    }).join('')}</div>` : '';

    return `<div class="kb-dict-sugg-group ${ui.cls}">
      <div class="kb-dict-suggestion-label"><i class="ti ${ui.icon}"></i> ${ui.pre} "${esc(g.istilah)}"${ui.post}</div>
      ${hint}${ambigu}${rows}${chips}
    </div>`;
  }).join('');
  return `<div class="kb-dict-suggestion">${groupsHtml}</div>`;
}
S.renderDictSuggestionHtml = renderDictSuggestionHtml; // dipakai renderChecklistItemHtml (checklist Kebutuhan RS, permintaan-rs.js)
// <<DICT-SUGG-V2 END>>
// Dipanggil abis checklistExpandedId ganti (toggle manual, auto-advance, atau
// default pas checklist pertama kali dimuat) — satu titik konsisten biar gak
// keulang nulis pengecekan yang sama di banyak tempat.
function maybeFetchSuggestionForExpanded() {
  if (!S.checklistExpandedId) return;
  const it = S.checklistItems.find(i => i.id === S.checklistExpandedId);
  if (it && it.status === 'PENDING') fetchDictSuggestionFor(it);
}
S.maybeFetchSuggestionForExpanded = maybeFetchSuggestionForExpanded;


// ══════════════════════════════════════════
// DICTIONARY ISTILAH CUSTOMER (fitur baru)
// Murni baca histori dari tabel permintaan_item lewat RPC Supabase
// (get_dictionary_stats, get_dictionary_summary, get_dictionary_detail).
// Tidak ada AI/fuzzy — normalisasi teks dilakukan di database (lihat SQL).
// Berdiri sendiri, tidak menyentuh logic Search/Konversi/Riwayat/Converter.
// ══════════════════════════════════════════
const dictSearchInput = document.getElementById('dict-search-input');
const dictClearBtn = document.getElementById('dict-clear-btn');
const dictFilterSelect = document.getElementById('dict-filter-select');
const dictSortSelect = document.getElementById('dict-sort-select');
const btnDictRefresh = document.getElementById('btn-dict-refresh');
const dictLoading = document.getElementById('dict-loading');
const dictError = document.getElementById('dict-error');
const dictEmpty = document.getElementById('dict-empty');
const dictTableWrap = document.getElementById('dict-table-wrap');
const dictTableBody = document.getElementById('dict-table-body');
const dictStatIstilah = document.getElementById('dict-stat-istilah');
const dictStatProduk = document.getElementById('dict-stat-produk');
const dictStatAlias = document.getElementById('dict-stat-alias');
const dictModal = document.getElementById('dictionary-modal');
const dictModalTitle = document.getElementById('dict-modal-title');
const dictModalClose = document.getElementById('dict-modal-close');
const dictModalLoading = document.getElementById('dict-modal-loading');
const dictModalError = document.getElementById('dict-modal-error');
const dictModalList = document.getElementById('dict-modal-list');
const dictPaginationEl = document.getElementById('dict-pagination');
const btnDictTambah = document.getElementById('btn-dict-tambah');
const dictNewModal = document.getElementById('dict-new-modal');
const dictNewInput = document.getElementById('dict-new-input');
const dictNewError = document.getElementById('dict-new-error');
const dictNewOk = document.getElementById('dict-new-ok');
const dictNewCancel = document.getElementById('dict-new-cancel');
const dictModalAddInput = document.getElementById('dict-modal-add-input');
const dictModalAddResults = document.getElementById('dict-modal-add-results');
const dictModalHiddenWrap = document.getElementById('dict-modal-hidden-wrap');
const dictModalHiddenList = document.getElementById('dict-modal-hidden-list');

const DICT_PAGE_SIZE = 20;
let dictCurrentPage = 1;
let dictLastTotal = 0;

let dictStatsLoaded = false;
let dictSearchDebounce = null;

// Statistik cuma perlu dimuat sekali per sesi tab (angka historis, jarang berubah
// dalam satu waktu buka aplikasi) — tapi tetap ikut di-refresh kalau tombol Refresh ditekan.
async function loadDictionaryStats() {
  const { data, error } = await S.rpc('get_dictionary_stats', {});
  if (error || !data || !data.length) {
    dictStatIstilah.textContent = '—';
    dictStatProduk.textContent = '—';
    dictStatAlias.textContent = '—';
    return;
  }
  const s = data[0];
  dictStatIstilah.textContent = (s.total_istilah_unik ?? 0).toLocaleString('id-ID');
  dictStatProduk.textContent = (s.total_produk_dipilih ?? 0).toLocaleString('id-ID');
  dictStatAlias.textContent = (s.total_alias ?? 0).toLocaleString('id-ID');
}

function dictBadgeHtml(status) {
  return status === 'MULTIPLE'
    ? `<span class="dict-badge multiple">MULTIPLE</span>`
    : `<span class="dict-badge consistent">CONSISTENT</span>`;
}

function dictFormatTanggal(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) + ' · ' + S.sesiTimeAgo(iso);
}

function renderDictRow(row) {
  const tr = document.createElement('tr');
  tr.dataset.istilah = row.istilah_customer;
  tr.innerHTML = `
    <td class="dict-term">${S.escapeHtmlAttr(row.istilah_customer)}</td>
    <td>${dictBadgeHtml(row.status)}</td>
    <td class="dict-col-freq">${Number(row.total_frekuensi).toLocaleString('id-ID')}×</td>
    <td class="dict-col-time">${dictFormatTanggal(row.terakhir_dipakai)}</td>
  `;
  tr.addEventListener('click', () => openDictionaryDetail(row.istilah_customer));
  return tr;
}

async function loadDictionary() {
  if (!dictStatsLoaded) { dictStatsLoaded = true; loadDictionaryStats(); }

  dictLoading.style.display = 'block';
  dictError.style.display = 'none';
  dictEmpty.style.display = 'none';
  dictTableWrap.style.display = 'none';
  dictTableBody.innerHTML = '';

  const p_search = dictSearchInput.value.trim() || null;
  const p_filter = dictFilterSelect.value;
  const p_sort = dictSortSelect.value;

  try {
    const { data, error } = await S.rpc('get_dictionary_summary', {
      p_search, p_filter, p_sort,
      p_limit: DICT_PAGE_SIZE,
      p_offset: (dictCurrentPage - 1) * DICT_PAGE_SIZE
    });
    if (error) throw new Error(error.message || error.hint || 'Gagal memuat dictionary');
    dictLastTotal = (data && data.length) ? Number(data[0].total_count) : 0;
    if (!data || data.length === 0) {
      dictEmpty.style.display = 'block';
      renderDictPagination();
      return;
    }
    const frag = document.createDocumentFragment();
    data.forEach(row => frag.appendChild(renderDictRow(row)));
    dictTableBody.appendChild(frag);
    dictTableWrap.style.display = 'block';
    renderDictPagination();
  } catch (err) {
    S.renderListError(dictError, err.message, loadDictionary);
    dictLastTotal = 0;
    renderDictPagination();
  } finally {
    dictLoading.style.display = 'none';
  }
}
S.loadDictionary = loadDictionary;

// Kontrol halaman Dictionary — pola sama kayak renderPagination() di tab Cari
// Produk, cuma versi ringkas (elemen sendiri, gak ganggu state pagination Cari Produk).
function renderDictPagination() {
  const totalPages = Math.max(1, Math.ceil(dictLastTotal / DICT_PAGE_SIZE));
  if (totalPages <= 1) { dictPaginationEl.innerHTML = ''; dictPaginationEl.style.display = 'none'; return; }
  dictPaginationEl.style.display = 'flex';

  function pageBtn(p, label, disabled = false) {
    const active = p === dictCurrentPage;
    return `<button class="page-btn${active ? ' active' : ''}" data-page="${p}"${disabled ? ' disabled' : ''}>${label}</button>`;
  }

  const pagesToShow = [...new Set([1, totalPages, dictCurrentPage - 1, dictCurrentPage, dictCurrentPage + 1])]
    .filter(p => p >= 1 && p <= totalPages)
    .sort((a, b) => a - b);

  let numberBtns = '';
  let prevP = null;
  pagesToShow.forEach(p => {
    if (prevP !== null && p - prevP > 1) numberBtns += `<span class="page-info">…</span>`;
    numberBtns += pageBtn(p, p);
    prevP = p;
  });

  const startItem = (dictCurrentPage - 1) * DICT_PAGE_SIZE + 1;
  const endItem = Math.min(dictCurrentPage * DICT_PAGE_SIZE, dictLastTotal);

  dictPaginationEl.innerHTML = `
    <span class="page-info">${startItem}–${endItem} dari ${dictLastTotal}</span>
    ${pageBtn(dictCurrentPage - 1, '<i class="ti ti-chevron-left"></i>', dictCurrentPage === 1)}
    ${numberBtns}
    ${pageBtn(dictCurrentPage + 1, '<i class="ti ti-chevron-right"></i>', dictCurrentPage === totalPages)}
  `;

  dictPaginationEl.querySelectorAll('.page-btn[data-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = parseInt(btn.dataset.page, 10);
      if (!p || p < 1 || p > totalPages || p === dictCurrentPage) return;
      dictCurrentPage = p;
      loadDictionary();
      dictTableWrap.scrollIntoView({ block: 'nearest' });
    });
  });
}

// Search realtime, di-debounce biar gak nembak RPC tiap ketikan huruf.
dictSearchInput.addEventListener('input', () => {
  dictClearBtn.style.display = dictSearchInput.value ? 'block' : 'none';
  clearTimeout(dictSearchDebounce);
  dictSearchDebounce = setTimeout(() => { dictCurrentPage = 1; loadDictionary(); }, 300);
});
dictClearBtn.addEventListener('click', () => {
  dictSearchInput.value = '';
  dictClearBtn.style.display = 'none';
  dictCurrentPage = 1;
  loadDictionary();
});
dictFilterSelect.addEventListener('change', () => { dictCurrentPage = 1; loadDictionary(); });
dictSortSelect.addEventListener('change', () => { dictCurrentPage = 1; loadDictionary(); });
btnDictRefresh.addEventListener('click', () => { dictStatsLoaded = false; loadDictionary(); });

// istilah lagi kebuka di modal saat ini — dipakai widget "+ Tambah produk" &
// tombol hapus/kembalikan biar tau mesti update pair yang mana.
let dictModalCurrentIstilah = null;

function dictDetailRowHtml(d, isManual) {
  const kodeForUrl = (d.kode_asli && d.kode_asli.trim()) ? d.kode_asli.trim() : d.kode_produk;
  const thumbUrl = S.THUMB_BASE + kodeForUrl + '.png';
  return `
    <div class="dict-detail-row" style="display:block" data-kode="${S.escapeHtmlAttr(d.kode_produk || '')}">
      <div style="display:flex;align-items:flex-start;gap:10px">
        <img src="${thumbUrl}" class="dict-detail-thumb" data-kode="${S.escapeHtmlAttr(d.kode_produk || '')}"
          data-kode-asli="${S.escapeHtmlAttr(d.kode_asli || '')}" data-nama="${S.escapeHtmlAttr(d.nama_produk || '')}"
          style="width:44px;height:44px;object-fit:cover;border-radius:6px;border:1px solid var(--border);background:var(--surface-2);flex-shrink:0;cursor:pointer"/>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
            <div style="min-width:0">
              <div class="dict-detail-produk">${S.escapeHtmlAttr(d.nama_produk || '(nama produk tidak tersedia)')}
                ${isManual ? '<span class="dict-badge" style="font-size:9px;padding:1px 5px;margin-left:6px">MANUAL</span>' : ''}
                ${d.is_set ? '<span style="font-size:9px;color:var(--success);margin-left:6px"><i class="ti ti-packages"></i> Set</span>' : ''}
              </div>
              <div class="dict-detail-kode">${S.escapeHtmlAttr(d.kode_produk || '-')}</div>
            </div>
            <div style="text-align:right;flex-shrink:0;display:flex;align-items:center;gap:10px">
              <div>
                <div class="dict-detail-freq">${Number(d.jumlah_pemakaian).toLocaleString('id-ID')}×</div>
                <div class="dict-detail-pct">${d.persentase != null ? d.persentase + '%' : ''}</div>
              </div>
              <button type="button" class="dict-detail-hapus-btn" data-kode="${S.escapeHtmlAttr(d.kode_produk || '')}"
                title="Tandai link ini kurang akurat / gak relevan" style="border:none;background:none;color:var(--text-muted);cursor:pointer;padding:4px">
                <i class="ti ti-trash"></i>
              </button>
            </div>
          </div>
          <div class="dict-detail-bar-wrap"><div class="dict-detail-bar" style="width:${d.persentase != null ? d.persentase : 0}%"></div></div>
          <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
            <button type="button" class="btn-preview-gambar dict-detail-gambar-btn" data-kode="${S.escapeHtmlAttr(d.kode_produk || '')}"
              data-kode-asli="${S.escapeHtmlAttr(d.kode_asli || '')}" data-nama="${S.escapeHtmlAttr(d.nama_produk || '')}">
              <i class="ti ti-eye" style="font-size:12px"></i> Lihat Gambar
            </button>
            <button type="button" class="dict-detail-lampiran-btn" data-kode="${S.escapeHtmlAttr(d.kode_produk || '')}" data-is-set="${!!d.is_set}"
              style="font-size:11px;color:var(--accent-text);background:var(--accent-bg);border:1px solid var(--accent-text);border-radius:20px;padding:2px 8px;display:inline-flex;align-items:center;gap:4px;cursor:pointer;font-family:inherit">
              <i class="ti ti-file-text" style="font-size:12px"></i> Lihat Lampiran
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

async function openDictionaryDetail(istilah) {
  dictModalCurrentIstilah = istilah;
  dictModalTitle.textContent = istilah;
  dictModalList.innerHTML = '';
  dictModalError.style.display = 'none';
  dictModalLoading.style.display = 'block';
  dictModalAddInput.value = '';
  dictModalAddResults.style.display = 'none';
  dictModalAddResults.innerHTML = '';
  dictModalHiddenWrap.style.display = 'none';
  dictModalHiddenList.innerHTML = '';
  dictModal.classList.add('show');

  try {
    // Detail (link aktif, histori + manual sudah di-blend di RPC) DAN daftar
    // override manual (buat tau mana yang MANUAL badge-nya + isi bagian
    // "Disembunyikan") ditarik bareng — dua RPC ringan, gak perlu nunggu urut.
    const [detailRes, overrideRes] = await Promise.all([
      S.rpc('get_dictionary_detail', { p_istilah: istilah }),
      S.rpc('get_dictionary_overrides', { p_istilah: istilah })
    ]);
    if (detailRes.error) throw new Error(detailRes.error.message || detailRes.error.hint || 'Gagal memuat detail istilah');
    const data = detailRes.data || [];
    const overrides = overrideRes.error ? [] : (overrideRes.data || []);
    const manualAddedKodes = new Set(overrides.filter(o => o.included).map(o => o.kode_produk));
    const hiddenRows = overrides.filter(o => !o.included);

    if (!data.length) {
      dictModalList.innerHTML = '<div style="padding:16px 0;text-align:center;color:var(--text-muted);font-size:13px">Belum ada produk yang dihubungkan ke istilah ini — tambah lewat kolom di bawah.</div>';
    } else {
      // Sudah terurut dari server berdasarkan frekuensi terbesar (JANGAN diurutkan ulang —
      // satu istilah customer memang wajar punya beberapa produk Robust, ini bukan error).
      dictModalList.innerHTML = data.map(d => dictDetailRowHtml(d, manualAddedKodes.has(d.kode_produk))).join('');
    }

    if (hiddenRows.length) {
      dictModalHiddenWrap.style.display = 'block';
      dictModalHiddenList.innerHTML = hiddenRows.map(h => `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;font-size:12px">
          <span style="color:var(--text-muted)">${S.escapeHtmlAttr(h.nama_produk || h.kode_produk)} <span class="dict-detail-kode">${S.escapeHtmlAttr(h.kode_produk)}</span></span>
          <button type="button" class="dict-detail-kembalikan-btn" data-kode="${S.escapeHtmlAttr(h.kode_produk)}"
            style="font-size:11.5px;padding:4px 10px;border-radius:6px;border:1px solid var(--border-strong);background:var(--surface);color:var(--text);cursor:pointer">Kembalikan</button>
        </div>
      `).join('');
    }
  } catch (err) {
    dictModalError.textContent = err.message;
    dictModalError.style.display = 'block';
  } finally {
    dictModalLoading.style.display = 'none';
  }
}
S.openDictionaryDetail = openDictionaryDetail;
dictModalClose.addEventListener('click', () => dictModal.classList.remove('show'));
dictModal.addEventListener('click', (e) => { if (e.target === dictModal) dictModal.classList.remove('show'); });

// Thumbnail gagal load (kode_asli belum ada gambar) -> sembunyikan, bukan
// nampilin ikon broken-image bawaan browser. Dulu inline onerror= di
// dictDetailRowHtml(); dipindah ke satu listener capture-phase di sini
// (error event gak bubbling, tapi tetap kelewatan capture phase) karena
// baris detail di-render ulang tiap buka istilah -- gak perlu dipasang ulang.
dictModalList.addEventListener('error', (e) => {
  if (e.target.matches && e.target.matches('.dict-detail-thumb')) e.target.style.visibility = 'hidden';
}, true);

// Klik thumbnail atau tombol "Lihat Gambar" -> pakai modal gambar yang
// sama persis kayak di tab Cari Produk (S.openGambarModal sudah nanganin
// fallback kode_asli -> kode_produk & upload/ganti gambar kalau belum ada).
dictModalList.addEventListener('click', (e) => {
  const el = e.target.closest('.dict-detail-thumb, .dict-detail-gambar-btn');
  if (!el) return;
  S.openGambarModal(el.dataset.kodeAsli, el.dataset.kode, el.dataset.nama);
});

// Klik "Lihat Lampiran" -> modal lampiran yang sama juga (nampilin rincian
// per komponen otomatis kalau produknya SET, lewat flag isSet).
dictModalList.addEventListener('click', (e) => {
  const btn = e.target.closest('.dict-detail-lampiran-btn');
  if (!btn) return;
  S.openLampiranModal(btn.dataset.kode, btn.dataset.isSet === 'true');
});

// Klik "Hapus" di satu baris produk (link asli dari histori ATAU manual) —
// gak beneran hapus histori permintaan_item-nya, cuma nyimpen override
// included=false biar RPC berikutnya nyembunyiin pasangan istilah+produk ini.
// Reversible lewat "Kembalikan" di bagian "Disembunyikan".
dictModalList.addEventListener('click', async (e) => {
  const btn = e.target.closest('.dict-detail-hapus-btn');
  if (!btn || !dictModalCurrentIstilah) return;
  const kode = btn.dataset.kode;
  if (!kode) return;
  btn.disabled = true;
  try {
    const { error } = await S.rpc('upsert_dictionary_override', {
      p_istilah: dictModalCurrentIstilah, p_kode_produk: kode, p_produk_id: null, p_included: false
    });
    if (error) throw new Error(error.message || error.hint || 'Gagal menyembunyikan link');
    await openDictionaryDetail(dictModalCurrentIstilah);
    loadDictionary(); // status/jumlah produk di tabel utama bisa ikut geser
  } catch (err) {
    S.showToast('Gagal: ' + err.message, 'error');
    btn.disabled = false;
  }
});

// Klik "Kembalikan" di bagian "Disembunyikan" — hapus override-nya sekalian
// (bukan sekadar toggle included=true), biar balik ke keadaan alami: kalau
// link itu emang dari histori asli, dia otomatis muncul lagi di detail tanpa
// perlu nyimpen override apa pun.
dictModalList.addEventListener('click', async (e) => {
  const btn = e.target.closest('.dict-detail-kembalikan-btn');
  if (!btn || !dictModalCurrentIstilah) return;
  const kode = btn.dataset.kode;
  if (!kode) return;
  btn.disabled = true;
  try {
    const { error } = await S.rpc('delete_dictionary_override', { p_istilah: dictModalCurrentIstilah, p_kode_produk: kode });
    if (error) throw new Error(error.message || error.hint || 'Gagal mengembalikan link');
    await openDictionaryDetail(dictModalCurrentIstilah);
    loadDictionary();
  } catch (err) {
    S.showToast('Gagal: ' + err.message, 'error');
    btn.disabled = false;
  }
});

// "Kembalikan" ada di dictModalHiddenList, bukan dictModalList — event di atas
// gak nyampe ke situ (elemen beda). Delegasikan sekali lagi dari parent yang
// beneran ngandung tombolnya.
dictModalHiddenList.addEventListener('click', async (e) => {
  const btn = e.target.closest('.dict-detail-kembalikan-btn');
  if (!btn || !dictModalCurrentIstilah) return;
  const kode = btn.dataset.kode;
  if (!kode) return;
  btn.disabled = true;
  try {
    const { error } = await S.rpc('delete_dictionary_override', { p_istilah: dictModalCurrentIstilah, p_kode_produk: kode });
    if (error) throw new Error(error.message || error.hint || 'Gagal mengembalikan link');
    await openDictionaryDetail(dictModalCurrentIstilah);
    loadDictionary();
  } catch (err) {
    S.showToast('Gagal: ' + err.message, 'error');
    btn.disabled = false;
  }
});

// ---- Widget "+ Tambah / hubungkan produk lain" (search sambil ketik) ----
let dictAddSearchDebounce = null;
dictModalAddInput.addEventListener('input', () => {
  clearTimeout(dictAddSearchDebounce);
  const q = dictModalAddInput.value.trim();
  if (!q) { dictModalAddResults.style.display = 'none'; dictModalAddResults.innerHTML = ''; return; }
  dictAddSearchDebounce = setTimeout(async () => {
    try {
      // RPC yang sama dipakai search utama Konversian — biar konsisten hasilnya
      // (harga/status/dsb sekalian ada kalau nanti mau ditampilin juga).
      const { data, error } = await S.rpc('search_produk_dengan_harga', { q, p_tipe: null, only_akd: false, only_kfa: false });
      if (error || !data || !data.length) {
        dictModalAddResults.style.display = 'block';
        dictModalAddResults.innerHTML = `<div style="padding:8px 10px;font-size:12px;color:var(--text-muted)">Gak ketemu.</div>`;
        return;
      }
      dictModalAddResults.style.display = 'block';
      dictModalAddResults.innerHTML = data.slice(0, 8).map(p => `
        <div class="dict-add-result-row" data-kode="${S.escapeHtmlAttr(p.kode_produk)}" data-produk-id="${p.id || ''}"
          style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 10px;font-size:12.5px;cursor:pointer;border-bottom:1px solid var(--border)">
          <span>${S.escapeHtmlAttr(p.kode_produk)} — ${S.escapeHtmlAttr(p.nama_produk || '')}</span>
          <i class="ti ti-plus" style="flex-shrink:0"></i>
        </div>
      `).join('');
    } catch (err) {
      dictModalAddResults.style.display = 'block';
      dictModalAddResults.innerHTML = `<div style="padding:8px 10px;font-size:12px;color:var(--danger)">${err.message}</div>`;
    }
  }, 300);
});

dictModalAddResults.addEventListener('click', async (e) => {
  const row = e.target.closest('.dict-add-result-row');
  if (!row || !dictModalCurrentIstilah) return;
  const kode = row.dataset.kode;
  const produkId = row.dataset.produkId ? parseInt(row.dataset.produkId, 10) : null;
  row.style.pointerEvents = 'none';
  row.style.opacity = '.5';
  try {
    const { error } = await S.rpc('upsert_dictionary_override', {
      p_istilah: dictModalCurrentIstilah, p_kode_produk: kode, p_produk_id: produkId, p_included: true
    });
    if (error) throw new Error(error.message || error.hint || 'Gagal menambahkan link');
    dictModalAddInput.value = '';
    dictModalAddResults.style.display = 'none';
    dictModalAddResults.innerHTML = '';
    await openDictionaryDetail(dictModalCurrentIstilah);
    loadDictionary();
  } catch (err) {
    S.showToast('Gagal: ' + err.message, 'error');
    row.style.pointerEvents = '';
    row.style.opacity = '';
  }
});

// ---- Modal "Tambah Istilah" — cuma minta teks istilahnya, produk pertama
// dihubungkan lewat widget "+ Tambah produk" di dalam modal detail yang sama
// (dibuka otomatis begitu istilah baru diisi), biar gak ada 2 form beda gaya. ----
function openDictNewModal() {
  dictNewInput.value = '';
  dictNewError.style.display = 'none';
  dictNewModal.classList.add('show');
  setTimeout(() => dictNewInput.focus(), 50);
}
function closeDictNewModal() { dictNewModal.classList.remove('show'); }

btnDictTambah.addEventListener('click', openDictNewModal);
dictNewCancel.addEventListener('click', closeDictNewModal);
dictNewModal.addEventListener('click', (e) => { if (e.target === dictNewModal) closeDictNewModal(); });
dictNewInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDictNewModal(); if (e.key === 'Enter') dictNewOk.click(); });
dictNewOk.addEventListener('click', () => {
  const istilah = dictNewInput.value.trim();
  if (!istilah) {
    dictNewError.textContent = 'Istilah gak boleh kosong.';
    dictNewError.style.display = 'block';
    return;
  }
  closeDictNewModal();
  // Belum ke-INSERT apa pun ke DB di titik ini (tabel manual override butuh
  // kode_produk NOT NULL) — baru beneran kesimpen begitu produk pertama
  // dipilih lewat widget "+ Tambah produk" di modal detail ini.
  openDictionaryDetail(istilah);
});


/* ==================================================================
   HIDDEN FEATURE: Generator Link Katalog
   Munculnya cuma kalau di search-input diketik "/linkpalsugas".
   Tidak ada tombol/menu yang mengarah ke sini secara terlihat.
   ================================================================== */
(function () {
  const modal = document.getElementById('linkgen-modal');
  if (!modal) return;

  const closeBtn = document.getElementById('linkgen-close');
  const baseInput = document.getElementById('linkgen-base');
  const prefixInput = document.getElementById('linkgen-prefix');
  const textInput = document.getElementById('linkgen-input');
  const genBtn = document.getElementById('linkgen-generate-btn');
  const copyBtn = document.getElementById('linkgen-copy-btn');
  const countEl = document.getElementById('linkgen-count');
  const outputEl = document.getElementById('linkgen-output');
  let rows = [];

  function slugify(text, prefix) {
    return prefix + text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function generate() {
    const base = baseInput.value.trim();
    const prefix = prefixInput.value;
    const lines = textInput.value.split('\n').map(l => l.trim()).filter(Boolean);
    rows = lines.map(desc => ({ desc, link: base + slugify(desc, prefix) }));

    if (!rows.length) {
      outputEl.innerHTML = '<div style="color:var(--text-muted);font-size:12.5px;padding:12px 0;text-align:center">Belum ada hasil.</div>';
      countEl.textContent = '';
      return;
    }

    countEl.textContent = rows.length + ' baris';

    let html = '<table style="width:100%;border-collapse:collapse;font-size:12.5px"><thead><tr>'
      + '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border);color:var(--text-muted);font-weight:500;font-size:11px;text-transform:uppercase">Deskripsi</th>'
      + '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border);color:var(--text-muted);font-weight:500;font-size:11px;text-transform:uppercase">Link</th></tr></thead><tbody>';
    rows.forEach(r => {
      html += '<tr><td style="padding:6px 8px;border-bottom:1px solid var(--border)">' + esc(r.desc) + '</td>'
        + '<td style="padding:6px 8px;border-bottom:1px solid var(--border);word-break:break-all"><a href="' + esc(r.link) + '" target="_blank" rel="noopener noreferrer" style="color:var(--accent-text)">' + esc(r.link) + '</a></td></tr>';
    });
    html += '</tbody></table>';
    outputEl.innerHTML = html;
  }

  genBtn.addEventListener('click', generate);

  copyBtn.addEventListener('click', () => {
    if (!rows.length) generate();
    if (!rows.length) return;
    const tsv = rows.map(r => r.desc + '\t' + r.link).join('\n');
    navigator.clipboard.writeText(tsv).then(() => {
      const old = copyBtn.textContent;
      copyBtn.textContent = 'Tersalin!';
      setTimeout(() => { copyBtn.textContent = old; }, 1200);
    });
  });

  closeBtn.addEventListener('click', () => modal.classList.remove('show'));
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('show'); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal.classList.contains('show')) modal.classList.remove('show');
  });

  window.openLinkGenModal = function () {
    modal.classList.add('show');
    outputEl.innerHTML = '';
    countEl.textContent = '';
    setTimeout(() => textInput.focus(), 50);
  };
})();

// Modal konfirmasi custom — pengganti confirm() bawaan browser biar konsisten
// dengan tampilan app dan gak nge-block thread (native confirm() nge-freeze
// seluruh tab, termasuk animasi/toast lain yang lagi jalan).
function showConfirmModal({ title = 'Konfirmasi', text = '', okText = 'Ya, Lanjutkan', danger = false } = {}) {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirm-modal');
    const titleEl = document.getElementById('confirm-modal-title');
    const textEl = document.getElementById('confirm-modal-text');
    const okBtn = document.getElementById('confirm-modal-ok');
    const cancelBtn = document.getElementById('confirm-modal-cancel');
    const iconWrap = document.getElementById('confirm-modal-icon');

    titleEl.textContent = title;
    textEl.textContent = text;
    okBtn.textContent = okText;
    okBtn.style.background = danger ? 'var(--danger)' : 'var(--accent)';
    iconWrap.style.background = danger ? 'var(--danger-soft)' : 'var(--warn-soft)';
    iconWrap.style.color = danger ? 'var(--danger-text)' : 'var(--warn-text)';
    iconWrap.innerHTML = danger ? '<i class="ti ti-trash"></i>' : '<i class="ti ti-alert-circle"></i>';

    function cleanup(result) {
      modal.classList.remove('show');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      modal.removeEventListener('click', onOverlay);
      document.removeEventListener('keydown', onKey);
      resolve(result);
    }
    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }
    function onOverlay(e) { if (e.target === modal) cleanup(false); }
    function onKey(e) { if (e.key === 'Escape') cleanup(false); if (e.key === 'Enter') cleanup(true); }

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    modal.addEventListener('click', onOverlay);
    document.addEventListener('keydown', onKey);
    modal.classList.add('show');
  });
}
S.showConfirmModal = showConfirmModal;

// Modal nama section (tambah/rename) — pengganti prompt() bawaan browser,
// sama alasannya kayak showConfirmModal: konsisten sama tema app + gak
// nge-freeze tab. Satu fungsi generic dipakai 2 mode:
//   mode 'add'    -> title "Tambah Section", input kosong
//   mode 'rename' -> title "Ganti Nama Section", input udah keisi nama lama
// existingNames dipakai buat validasi inline (gak boleh kosong / gak boleh
// nabrak nama section lain) sebelum sempet nembak RPC ke server sama sekali.
function showSectionNameModal({ mode = 'add', initialValue = '', existingNames = [] } = {}) {
  return new Promise((resolve) => {
    const modal = document.getElementById('section-name-modal');
    const titleEl = document.getElementById('section-name-modal-title');
    const subEl = document.getElementById('section-name-modal-sub');
    const input = document.getElementById('section-name-modal-input');
    const errorEl = document.getElementById('section-name-modal-error');
    const okBtn = document.getElementById('section-name-modal-ok');
    const cancelBtn = document.getElementById('section-name-modal-cancel');

    const isRename = mode === 'rename';
    titleEl.textContent = isRename ? 'Ganti Nama Section' : 'Tambah Section';
    subEl.textContent = isRename
      ? 'Rename sheet ini — baris di dalamnya ikut, cuma namanya yang berubah.'
      : 'Section = 1 sheet di Excel RS — mis. nama ruangan atau kategori barang.';
    okBtn.textContent = isRename ? 'Simpan' : 'Tambah';
    input.value = initialValue;
    errorEl.style.display = 'none';
    errorEl.textContent = '';

    const normalizedExisting = existingNames
      .filter(n => n !== initialValue)
      .map(n => n.trim().toLowerCase());

    function validate(nama) {
      if (!nama) return 'Nama section gak boleh kosong.';
      if (normalizedExisting.includes(nama.toLowerCase())) return `Section "${nama}" udah ada — pakai nama lain.`;
      return null;
    }

    function cleanup(result) {
      modal.classList.remove('show');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      modal.removeEventListener('click', onOverlay);
      input.removeEventListener('keydown', onKey);
      input.removeEventListener('input', onInput);
      resolve(result);
    }
    function onOk() {
      const nama = input.value.trim();
      const err = validate(nama);
      if (err) { errorEl.textContent = err; errorEl.style.display = 'block'; input.focus(); return; }
      cleanup(nama);
    }
    function onCancel() { cleanup(null); }
    function onOverlay(e) { if (e.target === modal) cleanup(null); }
    function onKey(e) {
      if (e.key === 'Escape') { cleanup(null); return; }
      if (e.key === 'Enter') { e.preventDefault(); onOk(); }
    }
    function onInput() { if (errorEl.style.display !== 'none') { errorEl.style.display = 'none'; } }

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    modal.addEventListener('click', onOverlay);
    input.addEventListener('keydown', onKey);
    input.addEventListener('input', onInput);
    modal.classList.add('show');
    setTimeout(() => { input.focus(); input.select(); }, 50);
  });
}
S.showSectionNameModal = showSectionNameModal;

// ===== RIWAYAT SPH per sesi =====
// Modal buat lihat semua revisi SPH yang pernah digenerate dari satu sesi
// (sph_records.sesi_id, lihat migration_sph_link_sesi.sql) + donlot ulang
// file PDF/docx-nya dari Supabase Storage. Modal-nya di-inject lewat JS
// (bukan ditulis manual di konversian.html) — polanya sama kayak #settings-list
// yang dirender dari SETTINGS_SCHEMA, biar nambah modal kayak gini nanti gak
// perlu ubah-ubah HTML.
(function setupSphRiwayatModal() {
  // SPA migration: modal ini di-append ke document.body (bukan container),
  // jadi kalau halaman ini di-mount ulang (pindah route lalu balik lagi
  // tanpa reload), IIFE ini jalan lagi dan bakal nyoba nambahin elemen
  // id="sph-riwayat-modal" KEDUA ke body kalau yang lama belum kehapus.
  // Guard ini + pembersihan di unmount() (lihat window.__konvBridge di
  // bawah) mencegah itu.
  document.getElementById('sph-riwayat-modal')?.remove();
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'sph-riwayat-modal';
  modal.innerHTML = `
    <div class="modal-box" style="width:92vw;max-width:520px;max-height:82vh;overflow-y:auto;text-align:left;padding:22px 24px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
        <div class="modal-title" style="margin:0" id="sph-riwayat-title"><i class="ti ti-file-invoice"></i> Riwayat SPH</div>
        <button id="sph-riwayat-close" style="border:none;background:none;font-size:20px;cursor:pointer;color:var(--text-muted);line-height:1">&times;</button>
      </div>
      <div class="modal-sub" style="margin-bottom:12px">Semua SPH yang pernah digenerate dari sesi ini, urut dari revisi terbaru.</div>
      <div id="sph-riwayat-list"></div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('show'); });
  modal.querySelector('#sph-riwayat-close').addEventListener('click', () => modal.classList.remove('show'));
})();

function sphRiwayatRowHtml(r, idx) {
  const noSafe = S.escapeHtmlAttr(r.no_sph || '(tanpa nomor)');
  const revLabel = 'REV' + (r.revisi || 0);
  const tgl = r.tanggal_surat || '-';
  const total = r.total_value != null ? 'Rp' + Number(r.total_value).toLocaleString('id-ID') : '-';
  const rowId = `sph-riwayat-row-${idx}`;
  const items = r.sph_record_items || [];
  const itemRows = items.map(it => {
    const hargaSafe = it.harga_satuan != null ? Number(it.harga_satuan).toLocaleString('id-ID') : '-';
    const totalSafe = it.total != null ? Number(it.total).toLocaleString('id-ID') : '-';
    return `<tr>
      <td style="padding:5px 6px;font-family:var(--mono);font-size:11px">${S.escapeHtmlAttr(it.kode_produk || '-')}</td>
      <td style="padding:5px 6px;font-size:11.5px">${S.escapeHtmlAttr(it.deskripsi || '-')}</td>
      <td style="padding:5px 6px;font-size:11.5px;text-align:right">${it.qty ?? '-'}</td>
      <td style="padding:5px 6px;font-size:11.5px;text-align:right">${hargaSafe}</td>
      <td style="padding:5px 6px;font-size:11.5px;text-align:right">${totalSafe}</td>
    </tr>`;
  }).join('');
  const itemsTable = items.length
    ? `<div id="${rowId}" style="display:none;margin-top:8px;overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:11.5px">
          <thead><tr style="color:var(--text-muted);text-align:left">
            <th style="padding:5px 6px">Kode</th><th style="padding:5px 6px">Deskripsi</th>
            <th style="padding:5px 6px;text-align:right">Qty</th><th style="padding:5px 6px;text-align:right">Harga</th>
            <th style="padding:5px 6px;text-align:right">Total</th>
          </tr></thead>
          <tbody>${itemRows}</tbody>
        </table>
      </div>`
    : `<div id="${rowId}" style="display:none;margin-top:8px;font-size:11.5px;color:var(--text-muted)">Gak ada detail item tersimpan buat revisi ini.</div>`;
  return `<div class="rcard" style="margin-bottom:8px;padding:10px 12px">
    <button type="button" class="sph-riwayat-toggle" data-target="${rowId}" style="display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;border:none;background:none;cursor:pointer;padding:0;color:inherit;font:inherit;text-align:left">
      <div>
        <div style="font-weight:600;font-size:12.5px">${revLabel} · ${noSafe}</div>
        <div style="font-size:11.5px;color:var(--text-muted);margin-top:2px">${tgl} · ${total} · ${items.length} produk</div>
      </div>
      <i class="ti ti-chevron-down" style="flex-shrink:0"></i>
    </button>
    ${itemsTable}
  </div>`;
}

async function openSphRiwayatModal(sesiId, namaRs) {
  const modal = document.getElementById('sph-riwayat-modal');
  const list = document.getElementById('sph-riwayat-list');
  const title = document.getElementById('sph-riwayat-title');
  title.innerHTML = `<i class="ti ti-file-invoice"></i> Riwayat SPH — ${S.escapeHtmlAttr(namaRs || '')}`;
  list.innerHTML = `<div style="padding:16px;text-align:center;color:var(--text-muted)">Memuat…</div>`;
  modal.classList.add('show');
  try {
    // Nested select PostgREST: sph_records + sph_record_items sekaligus dalam
    // satu request, gak perlu N+1 query per revisi.
    const res = await S.sesiFetch(`sph_records?sesi_id=eq.${sesiId}&select=*,sph_record_items(kode_produk,deskripsi,qty,harga_satuan,total)&order=revisi.desc,created_at.desc`);
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.message || errData.hint || 'Gagal memuat riwayat SPH.');
    }
    const rows = await res.json();
    if (!rows.length) {
      list.innerHTML = `<div style="padding:16px;text-align:center;color:var(--text-muted)">Belum ada SPH tersimpan buat sesi ini.</div>`;
      return;
    }
    list.innerHTML = rows.map((r, idx) => sphRiwayatRowHtml(r, idx)).join('');
    list.querySelectorAll('.sph-riwayat-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = document.getElementById(btn.dataset.target);
        const icon = btn.querySelector('i');
        const isOpen = target.style.display !== 'none';
        target.style.display = isOpen ? 'none' : 'block';
        if (icon) icon.className = isOpen ? 'ti ti-chevron-down' : 'ti ti-chevron-up';
      });
    });
  } catch (err) {
    list.innerHTML = `<div style="padding:16px;text-align:center;color:var(--danger)">${err.message}</div>`;
  }
}
S.openSphRiwayatModal = openSphRiwayatModal;

// ===== RIWAYAT KONVERSI per sesi =====
// Modal buat lihat semua REVISI Record Konversi yang pernah disimpan dari
// satu sesi (konversi_record.sesi_id + konversi_item.konversi_record_id) —
// data ini SUDAH ada dari awal (tiap kali tombol "Record Konversi" diklik,
// handleRecordSubmit selalu INSERT baris baru dengan nomor revisi naik,
// bukan UPDATE nimpa yang lama, lihat komentar "DUAL WRITE" & "dianggap
// REVISI" di atas). Makanya TIDAK butuh migration/backfill SQL apa pun —
// beda dari sph_records yang baru dapet kolom sesi_id belakangan (lihat
// migration_sph_link_sesi.sql) — konversi_record dari lahir udah nyatet
// sesi_id + revisi, jadi modal ini tinggal query langsung. Pola dan gaya
// (IIFE inject modal sekali, row toggle collapsible per revisi) sengaja
// dibikin sama persis kayak setupSphRiwayatModal/openSphRiwayatModal di
// atas biar konsisten & gampang dirawat bareng.
(function setupKonversiRiwayatModal() {
  // Guard sama seperti setupSphRiwayatModal (lihat komentar di sana) —
  // modal ini juga nempel langsung ke document.body, bukan container.
  document.getElementById('konversi-riwayat-modal')?.remove();
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'konversi-riwayat-modal';
  modal.innerHTML = `
    <div class="modal-box" style="width:92vw;max-width:560px;max-height:82vh;overflow-y:auto;text-align:left;padding:22px 24px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
        <div class="modal-title" style="margin:0" id="konversi-riwayat-title"><i class="ti ti-versions"></i> Riwayat Konversi</div>
        <button id="konversi-riwayat-close" style="border:none;background:none;font-size:20px;cursor:pointer;color:var(--text-muted);line-height:1">&times;</button>
      </div>
      <div class="modal-sub" style="margin-bottom:12px">Semua revisi Record Konversi yang pernah disimpan dari sesi ini, urut dari revisi terbaru.</div>
      <div id="konversi-riwayat-list"></div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('show'); });
  modal.querySelector('#konversi-riwayat-close').addEventListener('click', () => modal.classList.remove('show'));
})();

// Cache baris riwayat yang lagi ditampilin di modal (hasil query nested
// konversi_record+konversi_item dari openKonversiRiwayatModal) — dipakai
// tombol "Muat ke Clipboard" biar gak perlu fetch ulang pas diklik.
let konversiRiwayatRowsCache = [];

function konversiRiwayatRowHtml(r, idx) {
  const revLabel = 'REV' + (r.revisi || 0);
  const kategoriSafe = S.escapeHtmlAttr(r.kategori || '-');
  const tgl = r.tanggal || '-';
  const total = r.grand_total != null ? S.rupiah(r.grand_total) : '-';
  const salesSafe = S.escapeHtmlAttr(r.pic_sales || '-');
  const marsupSafe = S.escapeHtmlAttr(r.pic_marsup || '-');
  const rowId = `konversi-riwayat-row-${idx}`;
  const items = r.konversi_item || [];
  const itemRows = items.map(it => {
    const hargaSafe = it.harga != null ? Number(it.harga).toLocaleString('id-ID') : '-';
    const subtotal = (it.harga != null && it.qty != null) ? Number(it.harga * it.qty).toLocaleString('id-ID') : '-';
    return `<tr>
      <td style="padding:5px 6px;font-family:var(--mono);font-size:11px">${S.escapeHtmlAttr(it.kode_produk || '-')}</td>
      <td style="padding:5px 6px;font-size:11.5px">${S.escapeHtmlAttr(it.nama_produk || '-')}</td>
      <td style="padding:5px 6px;font-size:11.5px;text-align:right">${it.qty ?? '-'}</td>
      <td style="padding:5px 6px;font-size:11.5px;text-align:right">${hargaSafe}</td>
      <td style="padding:5px 6px;font-size:11.5px;text-align:right">${subtotal}</td>
    </tr>`;
  }).join('');
  const itemsTable = items.length
    ? `<div style="margin-top:8px;overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:11.5px">
          <thead><tr style="color:var(--text-muted);text-align:left">
            <th style="padding:5px 6px">Kode</th><th style="padding:5px 6px">Produk</th>
            <th style="padding:5px 6px;text-align:right">Qty</th><th style="padding:5px 6px;text-align:right">Harga</th>
            <th style="padding:5px 6px;text-align:right">Subtotal</th>
          </tr></thead>
          <tbody>${itemRows}</tbody>
        </table>
      </div>`
    : `<div style="margin-top:8px;font-size:11.5px;color:var(--text-muted)">Gak ada detail item tersimpan buat revisi ini.</div>`;
  const notesLine = r.notes
    ? `<div style="margin-top:8px;font-size:11.5px;color:var(--text-muted)"><i class="ti ti-note"></i> ${S.escapeHtmlAttr(r.notes)}</div>`
    : '';
  const linkLine = (r.link && S.isSafeHttpUrl(r.link))
    ? `<div style="margin-top:6px"><a href="${S.escapeHtmlAttr(r.link)}" target="_blank" rel="noopener" style="color:var(--accent-text);font-size:11.5px"><i class="ti ti-link"></i> Buka file</a></div>`
    : '';
  const expandBody = `<div id="${rowId}" style="display:none">${itemsTable}${notesLine}${linkLine}</div>`;
  // Tombol "Muat ke Clipboard" — restore produk+qty revisi ini ke clipboard
  // kerja biar bisa di-Export ke Excel / Generate SPH ulang. Disabled kalau
  // revisi ini gak punya item tersimpan (kasus jarang, tapi bisa aja kalau
  // insert konversi_item gagal partial dulu). Taruh di luar tombol toggle
  // (bukan di dalam <button> toggle) + stopPropagation di listener-nya, biar
  // klik tombol ini gak ikut expand/collapse baris.
  const loadBtn = `<button type="button" class="konversi-riwayat-load-btn" data-idx="${idx}" ${items.length ? '' : 'disabled'} style="flex-shrink:0;display:flex;align-items:center;gap:5px;border:1px solid var(--border-strong);background:var(--surface);color:var(--text);border-radius:7px;padding:6px 10px;font-size:11.5px;font-weight:600;cursor:${items.length ? 'pointer' : 'not-allowed'};font-family:inherit;opacity:${items.length ? '1' : '.5'}"><i class="ti ti-clipboard-copy"></i>Muat ke Clipboard</button>`;
  return `<div class="rcard" style="margin-bottom:8px;padding:10px 12px">
    <div style="display:flex;align-items:flex-start;gap:8px">
      <button type="button" class="konversi-riwayat-toggle" data-target="${rowId}" style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex:1;min-width:0;border:none;background:none;cursor:pointer;padding:0;color:inherit;font:inherit;text-align:left">
        <div style="min-width:0">
          <div style="font-weight:600;font-size:12.5px">${revLabel} · ${kategoriSafe}</div>
          <div style="font-size:11.5px;color:var(--text-muted);margin-top:2px">${tgl} · ${total} · ${items.length} produk</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px">Sales: ${salesSafe} · Marsup: ${marsupSafe}</div>
        </div>
        <i class="ti ti-chevron-down" style="flex-shrink:0"></i>
      </button>
      ${loadBtn}
    </div>
    ${expandBody}
  </div>`;
}

async function openKonversiRiwayatModal(sesiId, namaRs) {
  const modal = document.getElementById('konversi-riwayat-modal');
  const list = document.getElementById('konversi-riwayat-list');
  const title = document.getElementById('konversi-riwayat-title');
  title.innerHTML = `<i class="ti ti-versions"></i> Riwayat Konversi — ${S.escapeHtmlAttr(namaRs || '')}`;
  list.innerHTML = `<div style="padding:16px;text-align:center;color:var(--text-muted)">Memuat…</div>`;
  modal.classList.add('show');
  try {
    // Nested select PostgREST: konversi_record + konversi_item sekaligus
    // dalam satu request, gak perlu N+1 query per revisi — sama pola kayak
    // openSphRiwayatModal di atas.
    const res = await S.sesiFetch(`konversi_record?sesi_id=eq.${sesiId}&select=*,konversi_item(kode_produk,nama_produk,qty,harga)&order=revisi.desc,created_at.desc`);
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.message || errData.hint || 'Gagal memuat riwayat konversi.');
    }
    const rows = await res.json();
    konversiRiwayatRowsCache = rows;
    if (!rows.length) {
      list.innerHTML = `<div style="padding:16px;text-align:center;color:var(--text-muted)">Belum ada Record Konversi tersimpan buat sesi ini.</div>`;
      return;
    }
    list.innerHTML = rows.map((r, idx) => konversiRiwayatRowHtml(r, idx)).join('');
    list.querySelectorAll('.konversi-riwayat-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = document.getElementById(btn.dataset.target);
        const icon = btn.querySelector('i');
        const isOpen = target.style.display !== 'none';
        target.style.display = isOpen ? 'none' : 'block';
        if (icon) icon.className = isOpen ? 'ti ti-chevron-down' : 'ti ti-chevron-up';
      });
    });
    list.querySelectorAll('.konversi-riwayat-load-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        muatRevisiKeClipboard(parseInt(btn.dataset.idx, 10), btn);
      });
    });
  } catch (err) {
    list.innerHTML = `<div style="padding:16px;text-align:center;color:var(--danger)">${err.message}</div>`;
  }
}
S.openKonversiRiwayatModal = openKonversiRiwayatModal;

// "Muat ke Clipboard" — restore produk+qty dari SATU REVISI riwayat konversi
// ke clipboard kerja, biar bisa di-Export ke Excel / Generate SPH lagi tanpa
// input ulang manual.
//
// konversi_item nyimpen SNAPSHOT item yang beneran direkam waktu itu
// (kode_produk, nama_produk, qty, harga) — itu yang mau di-REUSE apa adanya,
// harganya PERSIS yang kesimpen, bukan diganti harga katalog terkini (harga
// katalog bisa udah berubah sejak direkam, tapi angka yang direkam itulah
// yang beneran dipakai/disepakati waktu itu). Yang gak kesimpen di
// konversi_item cuma field TEKNIS yang dibutuhin mesin Export/kategori
// (tipe/is_set buat computeKonversiSummary & pemisahan sheet Set vs Satuan
// di btnExport, link_v6 buat kolom link e-katalog, kode_asli+stok buat
// thumbnail & badge stok) — makanya field itu doang yang di-lengkapi lewat
// fetch fresh ke tabel produk pakai kode_produk (pola query "in.()" sama
// kayak enrichNonSetStok). Harga TETAP dari konversi_item, harga_ekat dan
// harga_swasta sengaja diisi NILAI YANG SAMA (persis harga yang direkam)
// biar hasilnya konsisten mau toggle mode Rp E-Katalog/Swasta yang mana pun.
// Produk yang udah dihapus/berubah kode dari katalog tetap dimasukin apa
// adanya (item + qty + harga dari catatan lama, cuma tanpa gambar/link/badge
// stok), dan ditandain di toast biar user tau mana yang perlu dicek manual.
//
// Restore-nya JUGA bikin SESI BARU (pola sama kayak startNewSesi()) — bukan
// nulis ke sesi lama yang statusnya udah 'selesai', biar histori lama gak
// keutak-atik dan kolaborasi realtime tetap konsisten sama siklus 1
// currentSesiId = 1 live workspace.
async function muatRevisiKeClipboard(idx, btnEl) {
  const row = konversiRiwayatRowsCache[idx];
  if (!row) return;
  const items = row.konversi_item || [];
  if (!items.length) {
    S.showToast('Gak ada item tersimpan buat revisi ini', 'error');
    return;
  }
  if (S.clipboard.length && !(await showConfirmModal({
    title: 'Muat Revisi ke Clipboard',
    text: `Clipboard yang lagi kebuka bakal ditinggalkan (datanya tetap tersimpan, bisa dibuka lagi lewat daftar Konversi Berjalan) dan diganti sama ${items.length} produk dari REV${row.revisi || 0}. Lanjut?`,
    okText: 'Ya, Muat'
  }))) return;

  const originalLabel = btnEl ? btnEl.innerHTML : '';
  if (btnEl) { btnEl.disabled = true; btnEl.innerHTML = '<i class="ti ti-loader-2"></i> Memuat…'; }

  try {
    const kodeList = [...new Set(items.map(it => it.kode_produk).filter(Boolean))];
    let produkMap = new Map();
    if (kodeList.length) {
      const inList = kodeList.map(k => `"${k.replace(/"/g, '')}"`).join(',');
      const res = await S.sesiFetch(`produk?kode_produk=in.(${inList})&select=*`);
      if (res.ok) {
        const produkRows = await res.json();
        produkMap = new Map(produkRows.map(p => [p.kode_produk, p]));
      }
    }

    const notFound = [];
    const mapped = items.map(it => {
      const p = produkMap.get(it.kode_produk);
      // Harga SELALU dari catatan lama (it.harga) — persis yang direkam,
      // diisi ke harga_ekat & harga_swasta biar konsisten di mode manapun.
      // p (kalau ketemu) cuma nyumbang field teknis (tipe/is_set/link_v6/
      // kode_asli/stok) buat kebutuhan Export/kategori, BUKAN buat nimpa harga.
      if (!p) notFound.push(it.kode_produk);
      const isSet = p && p.tipe && p.tipe.toLowerCase() === 'set';
      return {
        kode_produk: it.kode_produk,
        kode_asli: (p && p.kode_asli) || null,
        nama_produk: it.nama_produk,
        tipe: (p && p.tipe) || '-',
        is_set: !!isSet,
        produk_id: it.produk_id || (p && p.id) || null,
        no_akd: (p && p.no_akd) || null,
        kode_kfa: (p && p.kode_kfa) || null,
        link_v6: (p && p.link_v6) || null,
        harga_ekat: it.harga != null ? it.harga : null,
        tahun_harga: null,
        harga_swasta: it.harga != null ? it.harga : null,
        tahun_harga_swasta: null,
        stok_status: (p && p.stok_status) || null,
        stok_qty: p ? (p.stok_qty ?? null) : null,
        qty: it.qty || 1
      };
    });

    // ---- Reset clipboard/sesi kerja (pola sama kayak startNewSesi()) ----
    const modal = document.getElementById('konversi-riwayat-modal');
    if (modal) modal.classList.remove('show');
    S.currentSesiId = null;
    S.currentButuhBantuan = false;
    S.clipboard = [];
    S.inpRs.value = row.nama_rs || '';
    S.inpSales.value = row.pic_sales || '';
    if (row.pic_marsup) S.inpMarsup.value = row.pic_marsup;
    S.resetChecklistUI();
    S.setClipHeaderCollapsed(false);
    S.renderButuhBantuanBtn();
    S.setSesiSavedStatus('');
    S.updateEndSesiBtnState();
    S.switchSubTab('cari');
    if (typeof S.switchDoor === 'function') S.switchDoor('konversi');
    if (window.innerWidth <= 860 && typeof S.switchTab === 'function') S.switchTab('clip');

    // ---- Isi ulang clipboard + render (harga_ekat === harga_swasta di
    // semua item, jadi mode toggle gak ngubah total — gak perlu diutak-atik) ----
    S.clipboard = mapped;
    S.updateClipboard();
    S.renderResults(S.lastResults);
    S.updateClipHeaderCompact();

    // ---- Persist jadi SESI BARU (bukan nimpa sesi lama yang udah 'selesai') ----
    await S.ensureSesi();
    await Promise.all(mapped.map(item => S.persistAddItem(item)));
    S.updateEndSesiBtnState();
    S.loadSesiList();

    S.showToast(`${mapped.length} produk dari REV${row.revisi || 0} dimuat ke clipboard ✓`);
    if (notFound.length) {
      S.showToast(`${notFound.length} produk (${notFound.slice(0, 3).join(', ')}${notFound.length > 3 ? ', …' : ''}) gak ketemu lagi di katalog — gambar/link/badge stok gak ikut kebawa, tapi nama/qty/harga tetap ada dari catatan lama`, 'error');
    }
  } catch (err) {
    S.showToast('Gagal muat revisi ke clipboard: ' + err.message, 'error');
    if (btnEl) { btnEl.disabled = false; btnEl.innerHTML = originalLabel; }
  }
}
// ── BRIDGE (added by SPA migration, bukan bagian file asli) ──
// index.js butuh handle-handle ini di unmount() buat bersih-bersih (interval,
// listener, subscription) supaya remount (ganti route lalu balik lagi tanpa
// reload halaman) gak numpuk duplikat. Semua nama di sini didefinisikan di
// atas (hoisted function declarations / const yang di-assign sebelum baris
// ini jalan, karena baris ini ada di paling akhir eksekusi top-level).
window.__konvBridge = {
  authUnsub: S.__konvAuthUnsub,
  heartbeatTimer: S.__konvHeartbeatTimer,
  dismissAcOnOutsideClick: S.__konvDismissAcOnOutsideClick,
  updateOnlineStatus: S.updateOnlineStatus,
  switchTab: S.switchTab,
  unsubscribeFromSesiRealtime: S.unsubscribeFromSesiRealtime,
};
}