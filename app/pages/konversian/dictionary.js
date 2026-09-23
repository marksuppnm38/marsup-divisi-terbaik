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
const dictSuggestionCache = {}; // item.id -> {loading, istilah, status, produk} | null (null = udah dicek, gak ada saran)
S.dictSuggestionCache = dictSuggestionCache;
async function fetchDictSuggestionFor(item) {
  if (dictSuggestionCache[item.id] !== undefined) return; // udah pernah dicek (ada hasil ATAU emang null)
  dictSuggestionCache[item.id] = { loading: true };
  try {
    const { data: summaryRows, error: summaryErr } = await S.rpc('get_dictionary_summary', {
      // Value parameter ini HARUS sama persis kayak yang dipake tab Dictionary
      // asli (lihat #dict-filter-select/#dict-sort-select) — 'semua'/'frekuensi',
      // bukan 'all'/'freq_desc'. Nilai enum yang salah bikin RPC gagal, dan
      // gagalnya gak keliatan kalau cuma ngecek `data` doang tanpa cek `error`.
      p_search: item.raw_text, p_filter: 'semua', p_sort: 'frekuensi', p_limit: 1, p_offset: 0
    });
    if (summaryErr) throw new Error(summaryErr.message || summaryErr.hint || 'get_dictionary_summary gagal');
    const top = summaryRows && summaryRows[0];
    if (!top) { dictSuggestionCache[item.id] = null; }
    else {
      const { data: detailRows, error: detailErr } = await S.rpc('get_dictionary_detail', { p_istilah: top.istilah_customer });
      if (detailErr) throw new Error(detailErr.message || detailErr.hint || 'get_dictionary_detail gagal');
      dictSuggestionCache[item.id] = {
        loading: false,
        istilah: top.istilah_customer,
        status: top.status,
        produk: (detailRows || []).slice(0, 3) // paling banyak 3 baris teratas, ini sinyal kontekstual bukan halaman browse penuh
      };
    }
  } catch (err) {
    console.error('Gagal ambil saran Dictionary buat "' + item.raw_text + '":', err);
    dictSuggestionCache[item.id] = null; // gagal fetch = anggap gak ada saran, jangan block UI checklist-nya — tapi errornya sekarang keliatan di console
  }
  // Item ini mungkin masih expanded pas fetch selesai — patch biar sarannya muncul.
  // Kalau user udah pindah ke item lain, patchChecklistItem no-op aman aja.
  if (S.checklistExpandedId === item.id) patchChecklistItem(item.id, {});
}
// Dipanggil abis checklistExpandedId ganti (toggle manual, auto-advance, atau
// default pas checklist pertama kali dimuat) — satu titik konsisten biar gak
// keulang nulis pengecekan yang sama di banyak tempat.
function maybeFetchSuggestionForExpanded() {
  if (!S.checklistExpandedId) return;
  const it = S.checklistItems.find(i => i.id === S.checklistExpandedId);
  if (it && it.status === 'PENDING') fetchDictSuggestionFor(it);
}
S.maybeFetchSuggestionForExpanded = maybeFetchSuggestionForExpanded;

function startChecklistSession(submitResult, namaRs, picSales, pagu, tanggal) {
  S.checklistItems = Array.isArray(submitResult.items) ? submitResult.items : [];
  S.checklistItems.forEach(it => { it.matched_items = normalizeMatchedItems(it); });
  S.checklistNamaRs = namaRs || '(tanpa nama RS)';
  S.checklistSales = picSales || '(tanpa nama sales)';
  S.checklistPagu = (pagu === undefined) ? null : pagu;
  S.checklistPermintaanId = submitResult.permintaan_id;
  // BUGFIX: dulu checklistTanggal gak pernah di-set di sini (cuma di-set di
  // loadChecklistForSesi buat sesi yang DIBUKA ULANG), jadi begitu Permintaan
  // RS BARU disubmit, tombol "Simpan ke Drive" langsung nganggep sesi ini
  // "belum ada Permintaan RS" walau permintaan_id-nya jelas keisi — soalnya
  // pengecekannya butuh checklistTanggal juga (lihat listener btnDriveUpload),
  // bukan cuma checklistPermintaanId. Sekarang diisi dari tanggal yang barusan
  // disubmit di form (prTanggal.value), fallback ke submitResult.tanggal kalau
  // RPC submit_permintaan_rs ternyata ikut mengembalikannya.
  S.checklistTanggal = tanggal || submitResult.tanggal || null;
  // Sama kayak loadChecklistForSesi: buka otomatis requirement PENDING pertama.
  const firstPending = S.checklistItems.find(i => i.status === 'PENDING');
  S.checklistExpandedId = firstPending ? firstPending.id : null;

  // Auto-isi Nama RS / Sales di clipboard, biar gak perlu diketik ulang —
  // ini satu sesi konversi yang sama, bukan dua langkah terpisah.
  if (namaRs) S.inpRs.value = namaRs;
  if (picSales) S.inpSales.value = picSales;
  S.updateClipboard();
  S.setClipHeaderCollapsed(true);

  S.kbSection.classList.remove('kb-collapsed');
  S.kbRecordStatus.textContent = 'Tingkat pemenuhan tersimpan otomatis tiap item ditandai.';
  S.kbRefreshStatus.textContent = '';
  renderChecklist();
  maybeFetchSuggestionForExpanded();
  S.switchClipTab('kb');

  // pastikan panel clipboard kelihatan (termasuk di mobile, yang defaultnya nampilin tab search)
  if (window.innerWidth <= 860 && typeof S.switchTab === 'function') S.switchTab('clip');
  S.clipTabRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
S.startChecklistSession = startChecklistSession;

// Daftar checkbox produk diambil dari clipboard sesi ini (bukan search baru) —
// karena konteksnya emang produk yang lagi diproses di sesi konversi yang sama.
// Satu kebutuhan sekarang boleh dicentang lebih dari satu SKU sekaligus (mis.
// "All Set Mata" -> Set Pacho + Cataract Minor Set), makanya checkbox bukan
// dropdown single-select lagi. Qty per-SKU opsional, dipakai kalau kebutuhan
// dipenuhi campuran beberapa varian dengan porsi qty berbeda.
function clipboardPickerHtml(itemId, matchedItems) {
  const rows = S.clipboard.map(c => {
    const link = (matchedItems || []).find(l => l.kode_produk === c.kode_produk);
    const checked = link ? ' checked' : '';
    const qtyVal = (link && link.qty_alokasi != null) ? link.qty_alokasi : '';
    // data-search dipake filter client-side di bawah — cocokin ke kode ATAU nama,
    // biar ketik "scalpel" nemu meski yang diinget cuma sebagian nama produknya.
    const haystack = `${c.kode_produk} ${c.nama_produk}`.toLowerCase();
    return `<label class="kb-picker-row" data-search="${S.escapeHtmlAttr(haystack)}">
      <input type="checkbox" data-picker-check="${itemId}" data-kode="${S.escapeHtmlAttr(c.kode_produk)}" data-produk-id="${c.produk_id||''}"${checked}>
      <span class="kb-picker-name">${S.escapeHtmlAttr(c.kode_produk)} — ${S.escapeHtmlAttr(c.nama_produk)}</span>
      <input type="number" min="0" class="kb-picker-qty" data-picker-qty="${itemId}" data-kode="${S.escapeHtmlAttr(c.kode_produk)}"
        placeholder="qty" value="${qtyVal}" style="${checked ? '' : 'display:none'}">
    </label>`;
  }).join('');
  // Quick-pick dari pool sesi ini (clipboard) itu jalur UTAMA — kebanyakan
  // komponen (scalpel, gunting, forcep) kepake berulang lintas banyak baris
  // kebutuhan dalam 1 sesi, jadi begitu udah pernah dicari sekali, baris-baris
  // lain tinggal klik, gak perlu ngetik ulang. Search box di sini cuma nyaring
  // pool yang UDAH ada (client-side, instan) — bukan search DB baru. Kalau
  // yang dicari beneran belum pernah muncul di sesi ini, tombol "Cari di
  // katalog" jadi jalan pintas ke search utama (bukan search kedua yang
  // duplikat) — biar gak ada 2 search engine keliatan beda tapi
  // sebenernya nyari hal yang sama.
  return `<div class="kb-picker-wrap">
    <input type="text" class="kb-picker-filter" data-filter-for="${itemId}"
      placeholder="Saring dari ${S.clipboard.length} produk yang udah kepake di sesi ini…" ${S.clipboard.length ? '' : 'disabled'}>
    <div class="kb-picker-list" data-picker-list="${itemId}">${rows}</div>
    <div class="kb-picker-empty" data-picker-empty="${itemId}" style="${S.clipboard.length ? 'display:none' : ''}">
      ${S.clipboard.length ? 'Gak ada yang cocok di pool sesi ini.' : 'Belum ada produk yang kepake di sesi ini.'}
      <button type="button" class="kb-picker-bridge" data-bridge-for="${itemId}">Cari di katalog →</button>
    </div>
  </div>`;
}

// Filter pool secara instan (client-side, sembunyi/tampil baris, BUKAN
// re-render/refetch) — didelegasikan dari kbList biar picker yang baru muncul
// abis re-render (expand item lain, dst) otomatis ikut kefilter juga.
S.kbList.addEventListener('input', e => {
  const filterInput = e.target.closest('.kb-picker-filter');
  if (!filterInput) return;
  const itemId = filterInput.dataset.filterFor;
  const list = S.kbList.querySelector(`.kb-picker-list[data-picker-list="${CSS.escape(itemId)}"]`);
  const emptyEl = S.kbList.querySelector(`.kb-picker-empty[data-picker-empty="${CSS.escape(itemId)}"]`);
  if (!list) return;
  const q = filterInput.value.trim().toLowerCase();
  let anyVisible = false;
  list.querySelectorAll('.kb-picker-row').forEach(row => {
    const match = !q || row.dataset.search.includes(q);
    row.style.display = match ? '' : 'none';
    if (match) anyVisible = true;
  });
  if (emptyEl) {
    emptyEl.style.display = anyVisible ? 'none' : '';
    const bridgeBtn = emptyEl.querySelector('.kb-picker-bridge');
    if (bridgeBtn) bridgeBtn.dataset.bridgeQuery = q;
  }
});

// Jalan pintas "Cari di katalog" — buka/fokusin search utama, prefill teks
// yang tadi diketik di filter picker, biar gak perlu ngetik query yang sama
// dua kali di dua tempat.
S.kbList.addEventListener('click', e => {
  const bridgeBtn = e.target.closest('.kb-picker-bridge');
  if (!bridgeBtn) return;
  const query = bridgeBtn.dataset.bridgeQuery
    || S.kbList.querySelector(`.kb-picker-filter[data-filter-for="${CSS.escape(bridgeBtn.dataset.bridgeFor)}"]`)?.value.trim()
    || '';
  if (S.panelSearchEl && S.panelSearchEl.classList.contains('collapsed')) S.setPanelSearchCollapsed(false, false);
  if (query) { S.searchInput.value = query; S.searchInput.dispatchEvent(new Event('input')); }
  S.searchInput.focus();
});

// Cari nama produk buat ditampilin di baris item yang udah TERPENUHI & ke-link
// ke suatu produk. Kalau produknya kebetulan udah gak ada di clipboard (misal
// dihapus lagi), tetep tampilin kode-nya aja tanpa nama.
function namaProdukByKode(kode) {
  const c = S.clipboard.find(c => c.kode_produk === kode);
  return c ? c.nama_produk : null;
}

function updateKbCounts() {
  const pending = S.checklistItems.filter(i => i.status === 'PENDING').length;
  const done = S.checklistItems.filter(i => i.status === 'TERPENUHI').length;
  const na = S.checklistItems.filter(i => i.status === 'TIDAK_TERPENUHI').length;
  S.kbTitle.textContent = 'Kebutuhan RS';
  S.kbCount.textContent = `${pending} belum dicek · ${done} bisa dipenuhi · ${na} tidak bisa`;
  S.updateKbTabState();
  S.updateClipSummaryStrip();
}

// Template satu baris Kebutuhan RS — dipakai render awal (renderChecklist) MAUPUN
// patch realtime (patchChecklistItem), biar markup-nya gak dobel definisi.
function renderChecklistItemHtml(item) {
  const isPending = item.status === 'PENDING';
  const isDone = item.status === 'TERPENUHI';
  const isNa = item.status === 'TIDAK_TERPENUHI';
  const isPicking = S.checklistPickingId === item.id;
  // Picker butuh ruang penuh buat checkbox-list-nya, jadi kalau lagi milih
  // produk, item ini otomatis kebuka juga — gak masuk akal ada picker di
  // dalam baris yang keciutin.
  const isExpanded = isPicking || S.checklistExpandedId === item.id;
  const cls = (isDone ? 'terpenuhi' : isNa ? 'tidak-terpenuhi' : '') + (isExpanded ? ' expanded' : ' collapsed');

  const qtyTxt = item.qty_diminta ? ` · qty ${item.qty_diminta}` : '';
  const paguTxt = item.pagu_satuan != null ? ` · pagu satuan ${S.rupiah(item.pagu_satuan)}` : '';

  // ---- Baris ringkas (selalu kelihatan, ini yang diklik buat buka/tutup) ----
  const statusIcon = isDone ? '<i class="ti ti-circle-check" style="color:var(--success)"></i>'
    : isNa ? '<i class="ti ti-circle-x" style="color:var(--danger)"></i>'
    : '<i class="ti ti-circle-dashed" style="color:var(--text-muted)"></i>';
  let compactMatchedTxt = '';
  if (isDone && item.matched_items && item.matched_items.length) {
    const first = item.matched_items[0];
    const namaFirst = namaProdukByKode(first.kode_produk) || first.kode_produk;
    const more = item.matched_items.length - 1;
    compactMatchedTxt = `<div class="kb-item-compact-matched">→ ${namaFirst}${more > 0 ? ` +${more} lainnya` : ''}</div>`;
  }
  // SECURITY FIX 2026-08-14: raw_text itu teks bebas hasil paste/OCR user
  // (Permintaan RS) yang disimpan ke DB & ditampilin ke semua kolaborator —
  // wajib di-escape sebelum masuk innerHTML (stored XSS fix).
  const headerHtml = `<div class="kb-item-header" data-action="toggle-expand" data-id="${item.id}">
    <span class="kb-item-status-icon">${statusIcon}</span>
    <div class="kb-item-header-text">
      <div class="kb-item-text">${S.escapeHtmlAttr(item.raw_text)}${qtyTxt}${paguTxt}</div>
      ${!isExpanded ? compactMatchedTxt : ''}
    </div>
    <i class="ti ti-chevron-down kb-item-chevron"></i>
  </div>`;

  // ---- Detail (cuma dirender kalau lagi expanded — hemat DOM buat 20-50 baris) ----
  let detailHtml = '';
  if (isExpanded) {
    let sub = '';
    if (isDone) sub = `✓ Bisa dipenuhi`;
    else if (isNa) sub = `✕ Tidak bisa dipenuhi`;

    let matchedHtml = '';
    if (isDone && item.matched_items && item.matched_items.length) {
      matchedHtml = `<div class="kb-item-matched">${item.matched_items.map(l => {
        const nama = namaProdukByKode(l.kode_produk);
        const qtyLineTxt = l.qty_alokasi != null ? ` · qty ${l.qty_alokasi}` : '';
        return `<span class="kb-matched-row">→ ${l.kode_produk}${nama ? ' — ' + nama : ''}${qtyLineTxt}</span>`;
      }).join('')}</div>`;
    }

    let bodyHtml;
    if (isPicking) {
      // Mode pilih produk: checkbox multi-select dari clipboard (bisa dicentang
      // lebih dari satu buat kebutuhan yang dipenuhi campuran beberapa SKU) +
      // Konfirmasi/Batal. Muncul baik dari klik "Bisa Dipenuhi" (item PENDING)
      // maupun dari klik "Ubah produk" (item yang udah TERPENUHI).
      bodyHtml = `
        <div class="kb-picker">
          ${clipboardPickerHtml(item.id, item.matched_items)}
          <div class="kb-picker-error" data-picker-error="${item.id}" style="display:none">Pilih minimal 1 produk dulu.</div>
          <div class="kb-picker-actions">
            <button class="kb-cancel-btn" data-action="pick-cancel" data-id="${item.id}">Batal</button>
            <button class="kb-confirm-btn" data-action="pick-confirm" data-id="${item.id}">Konfirmasi</button>
          </div>
        </div>`;
    } else if (isPending) {
      const sugg = dictSuggestionCache[item.id];
      let suggHtml = '';
      if (sugg === undefined) {
        suggHtml = ''; // belum sempat di-fetch (harusnya sebentar doang, di-trigger bareng expand)
      } else if (sugg && sugg.loading) {
        suggHtml = `<div class="kb-dict-suggestion loading">Ngecek riwayat pemakaian…</div>`;
      } else if (sugg && sugg.produk && sugg.produk.length) {
        const badgeCls = sugg.status === 'MULTIPLE' ? 'multiple' : 'consistent';
        const rows = sugg.produk.map(p => {
          const inClip = S.clipboard.some(c => c.kode_produk === p.kode_produk);
          return `<div class="kb-dict-sugg-row">
            <div class="kb-dict-sugg-info">
              <span class="kb-dict-sugg-nama">${S.escapeHtmlAttr(p.nama_produk || p.kode_produk)}</span>
              <span class="kb-dict-sugg-freq">${Number(p.jumlah_pemakaian).toLocaleString('id-ID')}× dipakai${p.persentase != null ? ' · ' + p.persentase + '%' : ''}</span>
            </div>
            ${inClip
              ? `<button class="kb-dict-sugg-use" data-action="use-suggestion" data-id="${item.id}" data-kode="${p.kode_produk}">Pakai</button>`
              : `<button class="kb-dict-sugg-attach" data-action="attach-suggestion" data-id="${item.id}" data-kode="${p.kode_produk}" title="Belum ada di Clipboard sesi ini — tambahin dulu">+ Tambah & Pakai</button>`}
          </div>`;
        }).join('');
        suggHtml = `<div class="kb-dict-suggestion">
          <div class="kb-dict-suggestion-label"><i class="ti ti-history"></i> Biasa dipakai buat "${S.escapeHtmlAttr(sugg.istilah)}" <span class="dict-badge ${badgeCls}" style="font-size:9px;padding:1px 5px">${sugg.status}</span></div>
          ${rows}
        </div>`;
      }
      bodyHtml = `
        ${suggHtml}
        <div class="kb-item-actions">
          <button class="kb-bisa-btn" data-action="bisa" data-id="${item.id}">✓ Bisa Dipenuhi</button>
          <button class="kb-tidak-btn" data-action="tidak" data-id="${item.id}">✕ Tidak Bisa</button>
        </div>`;
    } else {
      // Sudah dikonfirmasi (TERPENUHI/TIDAK_TERPENUHI): status kekunci, tapi
      // tetep bisa diubah/dibatalkan lewat dua link kecil ini.
      bodyHtml = `
        <div class="kb-item-links">
          ${isDone ? `<a data-action="change" data-id="${item.id}">Ubah produk</a>` : ''}
          <a class="kb-batal-link" data-action="undo" data-id="${item.id}">Batal</a>
        </div>`;
    }

    detailHtml = `<div class="kb-item-detail">
      ${sub ? `<div class="kb-item-sub">${sub}</div>` : ''}
      ${matchedHtml}
      ${bodyHtml}
    </div>`;
  }

  return `<div class="kb-item ${cls}" data-id="${item.id}" draggable="true">
    ${headerHtml}
    ${detailHtml}
  </div>`;
}

// Harga satu baris kebutuhan = jumlah (harga_ekat produk × qty_alokasi) dari
// semua matched_items-nya. Lookup harga lewat clipboard (harga_ekat = source
// of truth, sama kayak dipakai di updateClipAggregates). Kalau produk match
// udah gak ada di clipboard sesi ini (kepencet hapus dsb), baris itu gak ikut
// disenilai — floor aman, gak bikin summary keliatan lebih murah dari nyatanya
// (mending "belum kehitung" daripada 0 yang bisa disalahartikan tuntas).
function hargaKebutuhan(item) {
  if (!item.matched_items || !item.matched_items.length) return { harga: 0, complete: item.status !== 'TERPENUHI' };
  let harga = 0, complete = true;
  item.matched_items.forEach(l => {
    const c = S.clipboard.find(c => (l.produk_id != null && c.produk_id != null) ? c.produk_id === l.produk_id : c.kode_produk === l.kode_produk);
    if (!c || c.harga_ekat == null) { complete = false; return; }
    harga += Number(c.harga_ekat) * Number(l.qty_alokasi || 1);
  });
  return { harga, complete };
}

// Rollup 1 section (atau grup "Tanpa section"): pagu vs total harga item
// yang matched di section itu, plus progress pemenuhan.
function computeSectionRollup(items, pagu) {
  let harga = 0, anyIncomplete = false;
  const done = items.filter(i => i.status === 'TERPENUHI').length;
  items.forEach(it => {
    if (it.status !== 'TERPENUHI') return;
    const h = hargaKebutuhan(it);
    harga += h.harga;
    if (!h.complete) anyIncomplete = true;
  });
  return {
    done, total: items.length, harga,
    pagu: pagu != null ? Number(pagu) : null,
    selisih: pagu != null ? Number(pagu) - harga : null,
    anyIncomplete
  };
}

function kbRollupHtml(r, size) {
  const cls = size === 'sm' ? 'kb-section-rollup' : 'kb-global-rollup';
  const selisihCls = r.selisih == null ? '' : (r.selisih >= 0 ? 'positif' : 'negatif');
  return `<div class="${cls}">
    <span>${r.done}/${r.total} terpenuhi</span>
    <span>${S.rupiah(r.harga)}${r.anyIncomplete ? '<i class="ti ti-alert-triangle" title="Ada produk match yang harganya belum kehitung (cek clipboard)"></i>' : ''}</span>
    ${r.pagu != null ? `<span>pagu ${S.rupiah(r.pagu)}</span><span class="kb-selisih ${selisihCls}">${r.selisih >= 0 ? 'sisa ' : 'lebih '}${S.rupiah(Math.abs(r.selisih))}</span>` : ''}
  </div>`;
}

// Section = tab sheet Excel: 1 aktif keliatan penuh dalam satu waktu (persis
// kayak buka 1 sheet), bukan semua digelar sekaligus grid — biar interaksinya
// kerasa kayak Sheets (klik tab ganti konteks), bukan cuma datanya doang yang
// section-aware. "Semua" = tab semu, nampilin rekap tiap section berurutan
// (dipake juga sebagai satu-satunya tampilan kalau belum ada section sama
// sekali, fallback lama tetap jalan).
S.activeSectionTab = null; // null = "Semua"; angka = id permintaan_section

function renderSectionTabs() {
  // Dulu: kalau belum ada section sama sekali, tab bar (termasuk tombol "+")
  // ikut disembunyiin — bug, bikin gak ada cara mulai bikin section pertama
  // dari UI. Sekarang: selalu tampil begitu ada Permintaan RS aktif ("Semua"
  // + "+" minimal selalu ada), biar bisa bootstrap section pertama kapan pun.
  if (!S.checklistPermintaanId) { S.kbSectionTabs.style.display = 'none'; return; }
  S.kbSectionTabs.style.display = 'flex';
  const countBySection = new Map(S.checklistSections.map(s => [s.id, 0]));
  countBySection.set(null, 0);
  S.checklistItems.forEach(it => {
    const key = countBySection.has(it.section_id) ? it.section_id : null;
    countBySection.set(key, (countBySection.get(key) || 0) + 1);
  });
  const orphanCount = countBySection.get(null) || 0;

  const tabs = [`<button type="button" class="kb-tab ${S.activeSectionTab === null ? 'active' : ''}" data-tab="semua">Semua</button>`];
  tabs.push(...S.checklistSections.map(s => `<button type="button" class="kb-tab ${S.activeSectionTab === s.id ? 'active' : ''}"
      draggable="true" data-tab="${s.id}" title="Klik: buka. Dobel-klik: rename. Drag: urutin atau pindahin baris ke sini.">
    ${S.escapeHtmlAttr(s.nama_section)} <span class="kb-tab-count">${countBySection.get(s.id) || 0}</span>
    <span class="kb-tab-delete" data-delete-section="${s.id}" title="Hapus section (baris di dalamnya pindah ke Tanpa section, gak ikut kehapus)"><i class="ti ti-x"></i></span>
  </button>`));
  if (orphanCount) tabs.push(`<button type="button" class="kb-tab ${S.activeSectionTab === 'orphan' ? 'active' : ''}" data-tab="orphan">Tanpa section <span class="kb-tab-count">${orphanCount}</span></button>`);
  tabs.push(`<button type="button" class="kb-tab kb-tab-add" data-tab="add" title="Tambah section"><i class="ti ti-plus"></i></button>`);
  S.kbSectionTabs.innerHTML = tabs.join('');
}

S.kbSectionTabs.addEventListener('click', async e => {
  const deleteBtn = e.target.closest('.kb-tab-delete');
  if (deleteBtn) {
    const sectionId = Number(deleteBtn.dataset.deleteSection);
    const section = S.checklistSections.find(s => s.id === sectionId);
    if (!section) return;
    const itemCount = S.checklistItems.filter(i => i.section_id === sectionId).length;
    const ok = await showConfirmModal({
      title: `Hapus section "${section.nama_section}"?`,
      text: itemCount
        ? `${itemCount} baris di dalamnya bakal pindah ke "Tanpa section" (baris-nya sendiri gak ikut kehapus).`
        : 'Section ini belum ada isinya.',
      okText: 'Ya, Hapus',
      danger: true
    });
    if (!ok) return;
    const { error } = await S.rpc('delete_permintaan_section', { p_section_id: sectionId });
    if (error) { PNMToast.error('Gagal hapus section: ' + (error.message || 'error')); return; }
    S.checklistSections = S.checklistSections.filter(s => s.id !== sectionId);
    S.checklistItems.forEach(it => { if (it.section_id === sectionId) it.section_id = null; });
    if (S.activeSectionTab === sectionId) S.activeSectionTab = null; // section yang lagi dibuka kehapus → balik ke "Semua"
    renderChecklist();
    return;
  }
  const btn = e.target.closest('.kb-tab');
  if (!btn) return;
  const tab = btn.dataset.tab;
  if (tab === 'add') {
    const nama = await showSectionNameModal({
      mode: 'add',
      existingNames: S.checklistSections.map(s => s.nama_section)
    });
    if (!nama) return;
    const { data, error } = await S.rpc('add_permintaan_section', { p_permintaan_id: S.checklistPermintaanId, p_nama_section: nama });
    if (error) { PNMToast.error('Gagal nambah section: ' + (error.message || 'error')); return; }
    const row = Array.isArray(data) ? data[0] : data;
    S.checklistSections.push(row);
    S.activeSectionTab = row.id;
    renderChecklist();
    return;
  }
  S.activeSectionTab = tab === 'semua' ? null : (tab === 'orphan' ? 'orphan' : Number(tab));
  renderChecklist();
});

S.kbSectionTabs.addEventListener('dblclick', async e => {
  const btn = e.target.closest('.kb-tab');
  if (!btn || !/^\d+$/.test(btn.dataset.tab)) return; // cuma section beneran, bukan Semua/Tanpa section/+
  const section = S.checklistSections.find(s => s.id === Number(btn.dataset.tab));
  if (!section) return;
  const nama = await showSectionNameModal({
    mode: 'rename',
    initialValue: section.nama_section,
    existingNames: S.checklistSections.map(s => s.nama_section)
  });
  if (!nama || nama === section.nama_section) return;
  const { error } = await S.rpc('rename_permintaan_section', { p_section_id: section.id, p_nama_section: nama });
  if (error) { PNMToast.error('Gagal rename: ' + (error.message || 'error')); return; }
  section.nama_section = nama;
  renderChecklist();
});

// --- Drag & drop: reorder tab (tab-ke-tab) ATAU pindahin baris kebutuhan ke
// section lain (kb-item-ke-tab). Dibedain dari isi dataTransfer di dragstart. ---
let dragPayload = null; // {type:'tab', id} | {type:'item', id}

S.kbSectionTabs.addEventListener('dragstart', e => {
  if (e.target.closest('.kb-tab-delete')) { e.preventDefault(); return; } // klik "×" gak boleh ke-trigger jadi drag tab
  const tabBtn = e.target.closest('.kb-tab[data-tab]');
  if (tabBtn && /^\d+$/.test(tabBtn.dataset.tab)) {
    dragPayload = { type: 'tab', id: Number(tabBtn.dataset.tab) };
    tabBtn.classList.add('dragging');
  }
});
S.kbSectionTabs.addEventListener('dragend', e => {
  e.target.closest('.kb-tab')?.classList.remove('dragging');
});
S.kbSectionTabs.addEventListener('dragover', e => {
  const tabBtn = e.target.closest('.kb-tab[data-tab]');
  if (!tabBtn || !dragPayload) return;
  const targetIsSection = /^\d+$/.test(tabBtn.dataset.tab);
  if (!targetIsSection) return; // gak bisa drop ke Semua/+/Tanpa section
  e.preventDefault();
  tabBtn.classList.add('drop-target');
});
S.kbSectionTabs.addEventListener('dragleave', e => {
  e.target.closest('.kb-tab')?.classList.remove('drop-target');
});
S.kbSectionTabs.addEventListener('drop', async e => {
  const tabBtn = e.target.closest('.kb-tab[data-tab]');
  S.kbSectionTabs.querySelectorAll('.drop-target').forEach(n => n.classList.remove('drop-target'));
  if (!tabBtn || !dragPayload || !/^\d+$/.test(tabBtn.dataset.tab)) { dragPayload = null; return; }
  e.preventDefault();
  const targetSectionId = Number(tabBtn.dataset.tab);

  if (dragPayload.type === 'item') {
    const item = S.checklistItems.find(i => i.id === dragPayload.id);
    if (item && item.section_id !== targetSectionId) {
      item.section_id = targetSectionId; // optimistic
      renderChecklist();
      const { error } = await S.rpc('move_permintaan_item_section', { p_item_id: dragPayload.id, p_section_id: targetSectionId });
      if (error) PNMToast.error('Gagal pindahin baris: ' + (error.message || 'error'));
    }
  } else if (dragPayload.type === 'tab' && dragPayload.id !== targetSectionId) {
    const fromIdx = S.checklistSections.findIndex(s => s.id === dragPayload.id);
    const toIdx = S.checklistSections.findIndex(s => s.id === targetSectionId);
    if (fromIdx > -1 && toIdx > -1) {
      const [moved] = S.checklistSections.splice(fromIdx, 1);
      S.checklistSections.splice(toIdx, 0, moved);
      renderSectionTabs();
      const { error } = await S.rpc('reorder_permintaan_sections', {
        p_permintaan_id: S.checklistPermintaanId,
        p_ordered_ids: S.checklistSections.map(s => s.id)
      });
      if (error) PNMToast.error('Gagal urutin section: ' + (error.message || 'error'));
    }
  }
  dragPayload = null;
});

// kb-item juga bisa di-drag (draggable="true" di renderChecklistItemHtml) buat
// di-drop ke salah satu tab section — didelegasikan dari kbList, bukan per-node,
// biar kb-item yang baru muncul abis re-render otomatis ikut bisa didrag juga.
S.kbList.addEventListener('dragstart', e => {
  const itemEl = e.target.closest('.kb-item[data-id]');
  if (!itemEl || !S.checklistSections.length) return; // drag antar-section gak relevan kalau belum ada section
  dragPayload = { type: 'item', id: Number(itemEl.dataset.id) };
});

function renderChecklist() {
  updateKbCounts();
  renderSectionTabs();

  const globalPagu = S.checklistSections.length
    ? S.checklistSections.reduce((s, sec) => s + (sec.pagu != null ? Number(sec.pagu) : 0), 0) || null
    : S.checklistPagu;
  const globalRollup = computeSectionRollup(S.checklistItems, globalPagu);

  // SECURITY FIX 2026-08-14: checklistNamaRs juga free-text, escape dulu.
  S.kbSummary.innerHTML = `
    <div class="kb-summary-row"><span>Nama RS</span><b>${S.escapeHtmlAttr(S.checklistNamaRs || '-')}</b></div>
    ${kbRollupHtml(globalRollup, 'lg')}
  `;

  if (!S.checklistSections.length) {
    // Belum ada section (Permintaan RS single-sheet, atau RPC belum di-update
    // buat ngirim field sections) — tampilin flat kayak sebelumnya, gak ada regresi.
    S.kbList.innerHTML = S.checklistItems.map(renderChecklistItemHtml).join('');
    return;
  }

  const bySection = new Map(S.checklistSections.map(s => [s.id, []]));
  bySection.set(null, []); // item tanpa section_id (mis. ditambah manual di luar import)
  S.checklistItems.forEach(it => {
    const key = bySection.has(it.section_id) ? it.section_id : null;
    bySection.get(key).push(it);
  });

  if (S.activeSectionTab === null) {
    // Tab "Semua": rekap tiap section berurutan, kayak scroll ngeliatin semua
    // sheet sekilas — buat overview, bukan tempat kerja detail (itu di tab masing-masing).
    const groups = S.checklistSections.map(s => ({ section: s, items: bySection.get(s.id) }));
    if (bySection.get(null).length) groups.push({ section: null, items: bySection.get(null) });
    S.kbList.innerHTML = groups.map(g => {
      if (!g.items.length) return '';
      const rollup = computeSectionRollup(g.items, g.section ? g.section.pagu : null);
      const title = g.section ? S.escapeHtmlAttr(g.section.nama_section) : 'Tanpa section';
      return `<div class="kb-section-group" data-section-id="${g.section ? g.section.id : 'null'}">
        <div class="kb-section-header">
          <span class="kb-section-title">${title}</span>
          ${kbRollupHtml(rollup, 'sm')}
        </div>
        <div class="kb-section-items">${g.items.map(renderChecklistItemHtml).join('')}</div>
      </div>`;
    }).join('');
    return;
  }

  // Tab section spesifik (atau "orphan"): cuma nampilin baris section itu,
  // full-width, kayak buka 1 sheet doang — ini "tempat kerja"-nya.
  const items = S.activeSectionTab === 'orphan' ? bySection.get(null) : (bySection.get(S.activeSectionTab) || []);
  const section = S.activeSectionTab === 'orphan' ? null : S.checklistSections.find(s => s.id === S.activeSectionTab);
  const rollup = computeSectionRollup(items, section ? section.pagu : null);
  // formatRibuan: "90000000" → "90.000.000" — dipake buat nilai awal input DAN
  // live-reformat pas ngetik (listener 'input' di bawah), biar gampang keliatan
  // salah nol tanpa nunggu blur/submit dulu buat sadar.
  const paguRow = section
    ? `<div class="kb-section-pagu-row">Pagu section: <input type="text" inputmode="numeric" id="kb-section-pagu-input" data-section-id="${section.id}"
         value="${section.pagu != null ? formatRibuan(section.pagu) : ''}" placeholder="belum diisi"></div>`
    : '';
  S.kbList.innerHTML = `<div class="kb-active-section-head">
      ${kbRollupHtml(rollup, 'sm')}
      ${paguRow}
    </div>
    ${items.length ? items.map(renderChecklistItemHtml).join('') : '<div class="kb-section-empty">Belum ada baris di section ini. Drag baris dari tab lain ke sini, atau tambah lewat Permintaan RS.</div>'}`;
}
S.renderChecklist = renderChecklist;

function formatRibuan(numOrStr) {
  const digits = String(numOrStr).replace(/[^\d]/g, '');
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

// Live-reformat sambil ngetik — strip semua non-digit, pasang titik ribuan
// ulang, taro kursor di akhir. Simpel (gak pertahanin posisi kursor persis di
// tengah angka), tapi buat input angka pendek kayak pagu ini cukup nyaman.
S.kbList.addEventListener('input', e => {
  const input = e.target.closest('#kb-section-pagu-input');
  if (!input) return;
  const formatted = formatRibuan(input.value);
  if (formatted !== input.value) input.value = formatted;
});

// Edit pagu section langsung dari tab yang lagi aktif (bukan modal terpisah).
S.kbList.addEventListener('change', async e => {
  const input = e.target.closest('#kb-section-pagu-input');
  if (!input) return;
  const raw = input.value.replace(/[^\d]/g, '');
  const pagu = raw ? Number(raw) : null;
  const sectionId = Number(input.dataset.sectionId);
  const section = S.checklistSections.find(s => s.id === sectionId);
  if (!section) return;
  section.pagu = pagu; // optimistic
  input.value = pagu != null ? formatRibuan(pagu) : ''; // normalisasi tampilan (jaga-jaga ada titik nyasar dari paste manual)
  refreshRollupHeadersOnly();
  const { error } = await S.rpc('update_permintaan_section_pagu', { p_section_id: sectionId, p_pagu: pagu });
  if (error) PNMToast.error('Gagal simpan pagu: ' + (error.message || 'error'));
});

// ---- Patch granular buat 1 item Kebutuhan RS (dipakai realtime UPDATE dari
// kolaborator lain) — gak nge-rebuild seluruh daftar kayak renderChecklist(). ----
function patchChecklistItem(id, changes) {
  const item = S.checklistItems.find(i => i.id === id);
  if (!item) return;
  if (S.checklistPickingId === id) return; // lagi dipilihin produknya sama user lokal, jangan diganggu dulu
  Object.assign(item, changes);
  updateKbCounts();
  const node = S.kbList.querySelector(`.kb-item[data-id="${CSS.escape(String(id))}"]`);
  if (node) {
    const temp = document.createElement('div');
    temp.innerHTML = renderChecklistItemHtml(item);
    const newNode = temp.firstElementChild;
    newNode.classList.add('rt-pulse');
    node.replaceWith(newNode);
    // Status/matched_items item ini ganti → rollup section-nya (dan rollup
    // global di kbSummary) kemungkinan besar ikut geser. Re-render header aja
    // (bukan renderChecklist() penuh) biar gak ngerender ulang semua baris.
    refreshRollupHeadersOnly();
  } else {
    renderChecklist(); // fallback aman kalau node-nya gak ketemu (harusnya jarang)
  }
}
S.patchChecklistItem = patchChecklistItem;

// Update angka-angka rollup (kbSummary + tiap kb-section-header) tanpa
// nyentuh/re-render baris kb-item satu pun — dipanggil abis patchChecklistItem
// atau abis clipboard berubah (harga produk match bisa geser rollup walau
// status item-nya sendiri gak berubah).
function refreshRollupHeadersOnly() {
  const globalPagu = S.checklistSections.length
    ? S.checklistSections.reduce((s, sec) => s + (sec.pagu != null ? Number(sec.pagu) : 0), 0) || null
    : S.checklistPagu;
  const globalRollupNode = S.kbSummary.querySelector('.kb-global-rollup');
  if (globalRollupNode) {
    const temp = document.createElement('div');
    temp.innerHTML = kbRollupHtml(computeSectionRollup(S.checklistItems, globalPagu), 'lg');
    globalRollupNode.replaceWith(temp.firstElementChild);
  }
  if (!S.checklistSections.length) return;
  const bySection = new Map(S.checklistSections.map(s => [s.id, []]));
  bySection.set(null, []);
  S.checklistItems.forEach(it => {
    const key = bySection.has(it.section_id) ? it.section_id : null;
    bySection.get(key).push(it);
  });

  if (S.activeSectionTab !== null) {
    // Tab section spesifik aktif: cuma 1 rollup node (.kb-active-section-head), bukan .kb-section-group.
    const items = S.activeSectionTab === 'orphan' ? bySection.get(null) : (bySection.get(S.activeSectionTab) || []);
    const section = S.activeSectionTab === 'orphan' ? null : S.checklistSections.find(s => s.id === S.activeSectionTab);
    const rollupNode = S.kbList.querySelector('.kb-active-section-head .kb-section-rollup');
    if (rollupNode) {
      const temp = document.createElement('div');
      temp.innerHTML = kbRollupHtml(computeSectionRollup(items, section ? section.pagu : null), 'sm');
      rollupNode.replaceWith(temp.firstElementChild);
    }
    return;
  }
  S.kbList.querySelectorAll('.kb-section-group').forEach(groupEl => {
    const idAttr = groupEl.dataset.sectionId;
    const g = idAttr === 'null' ? null : S.checklistSections.find(s => String(s.id) === idAttr);
    const items = g ? bySection.get(g.id) : bySection.get(null);
    if (!items) return;
    const rollupNode = groupEl.querySelector('.kb-section-rollup');
    if (!rollupNode) return;
    const temp = document.createElement('div');
    temp.innerHTML = kbRollupHtml(computeSectionRollup(items, g ? g.pagu : null), 'sm');
    rollupNode.replaceWith(temp.firstElementChild);
  });
}
S.refreshRollupHeadersOnly = refreshRollupHeadersOnly;



// Total qty_alokasi dari SEMUA item Kebutuhan RS yang match ke produk yang sama
// (by produk_id kalau ada, fallback ke kode_produk) — dipake buat sinkronin qty
// clipboard biar akurat kalau >1 item Permintaan RS dipenuhi dari produk yang
// sama persis (harus DIJUMLAH, bukan ketimpa sama yang terakhir dikonfirm).
// `override` opsional: {itemId, links} — dipake pas lagi proses konfirmasi
// picker, sebelum item.matched_items-nya sendiri kesimpen.
function sumQtyAlokasiForProduk(produkId, kode, override) {
  let total = 0;
  let hasAny = false;
  S.checklistItems.forEach(it => {
    const list = (override && override.itemId === it.id) ? override.links : (it.matched_items || []);
    (list || []).forEach(l => {
      const sameProduk = (produkId != null && l.produk_id != null) ? l.produk_id === produkId : l.kode_produk === kode;
      if (!sameProduk) return;
      if (l.qty_alokasi == null || isNaN(l.qty_alokasi) || l.qty_alokasi < 1) return;
      total += Number(l.qty_alokasi);
      hasAny = true;
    });
  });
  return hasAny ? total : null;
}

// Sinkronin qty item clipboard ke total qty_alokasi teragregasi (lihat fungsi
// di atas). Balikin true kalau qty-nya berubah (biar caller tau perlu re-render).
function syncClipboardQtyForProduk(produkId, kode, override) {
  const clipItem = S.clipboard.find(c => c.kode_produk === kode);
  if (!clipItem) return false;
  const total = sumQtyAlokasiForProduk(produkId, kode, override);
  if (total != null && clipItem.qty !== total) {
    clipItem.qty = total;
    S.persistUpdateQty(clipItem);
    return true;
  }
  return false;
}

S.kbList.addEventListener('click', async (e) => {
  const link = e.target.closest('a[data-action]');
  const btn = e.target.closest('button[data-action]');
  const header = e.target.closest('.kb-item-header[data-action]');
  const el = link || btn || header;
  if (!el) return;
  const itemId = parseInt(el.dataset.id, 10);
  const action = el.dataset.action;
  const item = S.checklistItems.find(i => i.id === itemId);
  if (!item) return;

  if (action === 'toggle-expand') {
    // Kalau lagi milih produk (picker kebuka), jangan biarin ke-collapse cuma
    // gara-gara klik header-nya sendiri — user harus Batal/Konfirmasi dulu.
    if (S.checklistPickingId === itemId) return;
    S.checklistExpandedId = (S.checklistExpandedId === itemId) ? null : itemId;
    renderChecklist();
    maybeFetchSuggestionForExpanded();
    return;
  }

  if (action === 'use-suggestion') {
    // Fast-path dari saran Dictionary: langsung tandai TERPENUHI pakai produk
    // yang disaranin, TANPA buka picker — cuma valid kalau produknya emang
    // udah ada di Clipboard sesi ini (dicek dobel di sini, bukan cuma percaya
    // tombolnya beneran ke-render dengan benar).
    const kode = el.dataset.kode;
    if (!S.clipboard.some(c => c.kode_produk === kode)) return;
    btn.disabled = true;
    await S.markItemTerpenuhiWithSingleProduk(item, kode);
    return;
  }

  if (action === 'attach-suggestion') {
    // Sama kayak "Pakai", tapi produknya belum ada di Clipboard — tambahin dulu
    // (reuse addSetKodeToClip yang udah dipakai tab Cari SET buat kasus yang
    // sama persis: cari exact by kode_produk, masukin ke lastResults, addToClip
    // — fungsi itu juga yang ngurus disabled/text state tombolnya sendiri),
    // baru abis itu jalanin fast-path yang sama kayak "Pakai".
    const kode = el.dataset.kode;
    await S.addSetKodeToClip(kode, btn);
    if (!S.clipboard.some(c => c.kode_produk === kode)) return; // gagal, addSetKodeToClip udah nampilin toast errornya
    await S.markItemTerpenuhiWithSingleProduk(item, kode);
    return;
  }

  if (action === 'bisa' || action === 'change') {
    // Buka mode pilih produk, belum manggil API sama sekali.
    S.checklistPickingId = itemId;
    S.checklistExpandedId = itemId;
    renderChecklist();
    return;
  }

  if (action === 'pick-cancel') {
    S.checklistPickingId = null;
    renderChecklist();
    return;
  }

  if (action === 'pick-confirm') {
    // Kumpulin semua checkbox yang dicentang buat item ini -> jadi array link.
    const checks = S.kbList.querySelectorAll(`input[data-picker-check="${itemId}"]:checked`);
    if (checks.length === 0) {
      const errEl = S.kbList.querySelector(`[data-picker-error="${itemId}"]`);
      if (errEl) errEl.style.display = 'block';
      return;
    }
    const links = Array.from(checks).map(chk => {
      const kode = chk.dataset.kode;
      const produkId = chk.dataset.produkId ? parseInt(chk.dataset.produkId, 10) : null;
      const qtyInput = S.kbList.querySelector(`input[data-picker-qty="${itemId}"][data-kode="${CSS.escape(kode)}"]`);
      const qtyVal = qtyInput && qtyInput.value.trim() ? Number(qtyInput.value) : null;
      return { produk_id: produkId, kode_produk: kode, qty_alokasi: qtyVal };
    });

    // Kalau qty_alokasi diisi di picker Kebutuhan RS, ikutin ke qty item clipboard
    // yang sama — biar user gak perlu isi qty dua kali (di clipboard & di sini).
    // Kalau ada >1 item Permintaan RS yang dipenuhi dari produk yang sama, qty-nya
    // DIJUMLAH (bukan ketimpa sama yang terakhir dikonfirm) — agregasi per produk
    // (produk_id kalau ada, fallback kode_produk), lewat sumQtyAlokasiForProduk().
    // Kalau qty_alokasi dikosongin, qty clipboard dibiarin apa adanya (gak di-reset).
    let clipQtyChanged = false;
    const touchedProduk = new Set();
    links.forEach(l => {
      if (l.qty_alokasi == null || isNaN(l.qty_alokasi) || l.qty_alokasi < 1) return;
      const key = l.produk_id != null ? 'id:' + l.produk_id : 'kode:' + l.kode_produk;
      if (touchedProduk.has(key)) return; // 2 checkbox beda tapi produk sama (jarang) — cukup dihitung sekali
      touchedProduk.add(key);
      if (syncClipboardQtyForProduk(l.produk_id, l.kode_produk, { itemId, links })) clipQtyChanged = true;
    });
    if (clipQtyChanged) S.updateClipboard();

    btn.disabled = true;
    try {
      S.markLocalWrite(S.PERMINTAAN_ITEM_TABLE, itemId, 'status', 'TERPENUHI');
      await callUpdatePermintaanItemMulti(itemId, 'TERPENUHI', links);
      item.status = 'TERPENUHI';
      item.matched_items = links;
      S.checklistPickingId = null;
      S.checklistExpandedId = S.advanceToNextPending(itemId); // langsung buka yang PENDING berikutnya
      renderChecklist();
      maybeFetchSuggestionForExpanded();
      S.broadcastChecklistItemUpdated(item);
      autoFinalizePermintaan();
    } catch (err) {
      S.showToast('Gagal update: ' + err.message, 'error');
      renderChecklist();
    }
    return;
  }

  if (action === 'tidak') {
    btn.closest('.kb-item-actions').querySelectorAll('button').forEach(b => b.disabled = true);
    const prevMatched = item.matched_items || [];
    try {
      S.markLocalWrite(S.PERMINTAAN_ITEM_TABLE, itemId, 'status', 'TIDAK_TERPENUHI');
      await callUpdatePermintaanItemMulti(itemId, 'TIDAK_TERPENUHI', []);
      item.status = 'TIDAK_TERPENUHI';
      item.matched_items = [];
      // Produk yang tadinya kepakai item ini kehilangan kontribusinya ke total —
      // kalkulasi ulang qty clipboard biar gak nyangkut kelebihan dari sebelumnya.
      let clipQtyChanged = false;
      const touchedProduk = new Set();
      prevMatched.forEach(l => {
        const key = l.produk_id != null ? 'id:' + l.produk_id : 'kode:' + l.kode_produk;
        if (touchedProduk.has(key)) return;
        touchedProduk.add(key);
        if (syncClipboardQtyForProduk(l.produk_id, l.kode_produk)) clipQtyChanged = true;
      });
      if (clipQtyChanged) S.updateClipboard();
      S.checklistExpandedId = S.advanceToNextPending(itemId);
      renderChecklist();
      maybeFetchSuggestionForExpanded();
      S.broadcastChecklistItemUpdated(item);
      autoFinalizePermintaan();
    } catch (err) {
      S.showToast('Gagal update: ' + err.message, 'error');
      renderChecklist();
    }
    return;
  }

  if (action === 'undo') {
    const prevMatched = item.matched_items || [];
    try {
      S.markLocalWrite(S.PERMINTAAN_ITEM_TABLE, itemId, 'status', 'PENDING');
      await callUpdatePermintaanItemMulti(itemId, 'PENDING', []);
      item.status = 'PENDING';
      item.matched_items = [];
      // Sama kayak 'tidak': produk yang kepakai item ini kehilangan kontribusinya,
      // jadi total qty clipboard dihitung ulang biar tetap akurat.
      let clipQtyChanged = false;
      const touchedProduk = new Set();
      prevMatched.forEach(l => {
        const key = l.produk_id != null ? 'id:' + l.produk_id : 'kode:' + l.kode_produk;
        if (touchedProduk.has(key)) return;
        touchedProduk.add(key);
        if (syncClipboardQtyForProduk(l.produk_id, l.kode_produk)) clipQtyChanged = true;
      });
      if (clipQtyChanged) S.updateClipboard();
      S.checklistPickingId = null;
      renderChecklist();
      S.broadcastChecklistItemUpdated(item);
      autoFinalizePermintaan();
    } catch (err) {
      S.showToast('Gagal membatalkan: ' + err.message, 'error');
      renderChecklist();
    }
    return;
  }
});

// Centang/uncentang checkbox produk di picker -> qty input muncul/hilang
// ngikutin, dan pesan error "pilih minimal 1" ilang begitu ada yang dicentang.
S.kbList.addEventListener('change', (e) => {
  const chk = e.target.closest('input[data-picker-check]');
  if (!chk) return;
  const kode = chk.dataset.kode;
  const qtyInput = S.kbList.querySelector(`input[data-picker-qty="${chk.dataset.pickerCheck}"][data-kode="${CSS.escape(kode)}"]`);
  if (qtyInput) qtyInput.style.display = chk.checked ? '' : 'none';
  const errEl = S.kbList.querySelector(`[data-picker-error="${chk.dataset.pickerCheck}"]`);
  if (errEl && chk.checked) errEl.style.display = 'none';
});

const KB_COLLAPSE_KEY = 'pnm_kb_collapsed';
S.kbCollapseBtn.addEventListener('click', () => {
  const collapsed = S.kbSection.classList.toggle('kb-collapsed');
  S.kbCollapseBtn.title = collapsed ? 'Buka daftar' : 'Ciutkan daftar';
  sessionStorage.setItem(KB_COLLAPSE_KEY, collapsed ? '1' : '0');
});
// Kalau sebelumnya diciutkan di sesi browser yang sama, biarkan tetap ciutan
// begitu daftar Kebutuhan RS pertama kali muncul.
if (sessionStorage.getItem(KB_COLLAPSE_KEY) === '1') {
  S.kbSection.classList.add('kb-collapsed');
  S.kbCollapseBtn.title = 'Buka daftar';
}

// Kerja bareng dalam satu sesi yang sama bisa jalan bersamaan (bukan cuma
// gantian) — tombol ini nge-tarik ulang status checklist dari server, biar
// item yang barusan ditandai temen langsung kelihatan tanpa buka-tutup sesi.
S.kbRefreshBtn.addEventListener('click', async () => {
  if (!S.currentSesiId) return;
  S.kbRefreshBtn.disabled = true;
  S.kbRefreshStatus.textContent = 'Memuat ulang…';
  await S.loadChecklistForSesi(S.currentSesiId);
  S.kbRefreshBtn.disabled = false;
});

// Dulu ini tombol "Record Sesi Ini" terpisah yang harus diklik manual.
// Sekarang otomatis: tiap kali item dicentang (bisa/tidak), tingkat pemenuhan
// langsung dihitung ulang & disimpan di background — gak nunggu diklik, dan
// otomatis ke-cover juga saat "Record Konversi" ditekan di akhir.
async function autoFinalizePermintaan() {
  if (!S.checklistPermintaanId) return;
  const total = S.checklistItems.length;
  const done = S.checklistItems.filter(i => i.status === 'TERPENUHI').length;
  const tingkatPemenuhan = total > 0 ? Math.round((done / total) * 1000) / 10 : 0; // 1 desimal

  S.kbRecordStatus.style.color = 'var(--text-muted)';
  S.kbRecordStatus.textContent = 'Menyimpan…';
  try {
    const res = await fetch(`${S.SUPABASE_URL}/rest/v1/rpc/finalize_permintaan_rs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': S.ANON_KEY,
        'Authorization': 'Bearer ' + (await S.getFreshToken())
      },
      body: JSON.stringify({
        p_permintaan_id: S.checklistPermintaanId,
        p_tingkat_pemenuhan: tingkatPemenuhan,
        p_items_terpenuhi: done,
        p_items_total: total
      })
    });
    if (!res.ok) throw new Error('Gagal simpan rekap');
    S.kbRecordStatus.style.color = 'var(--success)';
    S.kbRecordStatus.textContent = `Tersimpan otomatis ✓ ${tingkatPemenuhan}% terpenuhi (${done}/${total} item)`;
  } catch {
    S.kbRecordStatus.style.color = 'var(--danger)';
    S.kbRecordStatus.textContent = 'Gagal simpan rekap otomatis (gak masalah, dicoba lagi pas item berikutnya ditandai)';
  }
}
S.autoFinalizePermintaan = autoFinalizePermintaan;

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

// p_links: array of {produk_id, kode_produk, qty_alokasi} — boleh kosong ([])
// kalau statusnya PENDING/TIDAK_TERPENUHI. Ganti total (replace-all) per item,
// bukan nambah satu-satu, jadi konsisten sama isi checkbox picker di layar.
async function callUpdatePermintaanItemMulti(itemId, status, links) {
  const res = await fetch(`${S.SUPABASE_URL}/rest/v1/rpc/update_permintaan_item_multi`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': S.ANON_KEY,
      'Authorization': 'Bearer ' + (await S.getFreshToken())
    },
    body: JSON.stringify({ p_item_id: itemId, p_status: status, p_links: links || [] })
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.message || errData.hint || 'Gagal update item');
  }
}
S.callUpdatePermintaanItemMulti = callUpdatePermintaanItemMulti;

// Item yang datang dari server (get_permintaan_by_sesi) atau dari sesi lama
// mungkin masih format 1:1 (matched_produk_id/matched_kode_produk doang, belum
// ada matched_items array). Normalisasi di sini biar sisa kode UI cuma perlu
// tau satu bentuk: item.matched_items = [{produk_id, kode_produk, qty_alokasi}].
function normalizeMatchedItems(item) {
  if (Array.isArray(item.matched_items)) return item.matched_items;
  if (item.matched_kode_produk) {
    return [{ produk_id: item.matched_produk_id ?? null, kode_produk: item.matched_kode_produk, qty_alokasi: null }];
  }
  return [];
}
S.normalizeMatchedItems = normalizeMatchedItems;

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