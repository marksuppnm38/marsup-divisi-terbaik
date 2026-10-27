// SEARCH — mesin pencarian produk ("Cari Cepat"): query ke database, Dictionary istilah customer,
// koreksi typo, urutan/sort, kartu hasil, paginasi, autocomplete, navigasi keyboard, dan wiring
// input/filter/tombol pencarian.
//
// DIPINDAH dari clipboard.js (2026-10-27) — dulu numpang di sana karena waktu konversian.js dipecah,
// region "pencarian" gak punya nomor section sendiri di map.md (search.js lama cuma kebagian pintu
// Cari Cepat + exact-by-kode, yang sekarang ada di converter.js). Logic TIDAK diubah; cuma referensi ke
// hal-hal yang masih tinggal di clipboard.js diganti jadi S.nama (S.rpc, S.rupiah, S.showToast,
// S.handleClipToggleClick, S.cachedSetItemCount, S.hydrateSetCounts, S.panelBodyCari).
// clipboard.js sendiri sekarang cuma butuh S.renderResults dari sini (dipanggil belakangan, bukan saat install).
export function installSearch(S) {
// AUTOCOMPLETE — reuses lastResults from runSearch, no separate API call needed.
// Dikurangin dari 6 ke 4 item: dropdown ini ngambang di atas list produk yang
// sebenarnya udah kelihatan di bawahnya, jadi makin sedikit & padat makin gak
// berasa nutup-nutupin — 4 quick-pick tercepat udah cukup, sisanya toh masih
// kebaca lewat scroll di list produk itu sendiri. (lihat juga max-height di
// pnm-konversian-rebase.css yang dikunci senada sama jumlah ini)
function renderAutocomplete(data) {
  if (!S.searchInput.value.trim() || !data || !data.length) {
    S.acBox.style.display = 'none'; S.acItems = []; S.acIndex = -1; return;
  }
  S.acItems = data.slice(0, 4);
  S.acIndex = -1;
  S.acBox.innerHTML = S.acItems.map(r => {
    const t = (r.tipe || '').toUpperCase();
    const tipeLabel = t === 'SET' ? 'Set' : t === 'UNIT' ? 'Unit' : 'Instrumen';
    return `<div class="ac-item"><span class="ac-name">${S.escapeHtmlAttr(r.nama_produk)}</span><span class="ac-code">${S.escapeHtmlAttr(r.kode_produk || '')}</span><span class="ac-badge">${tipeLabel}</span></div>`;
  }).join('');
  S.acBox.querySelectorAll('.ac-item').forEach((el, i) => {
    el.addEventListener('click', () => {
      S.searchInput.value = S.acItems[i].nama_produk;
      S.acBox.style.display = 'none';
      runSearch();
    });
  });
  S.acBox.style.display = 'block';
}

function renderSkeletons(count) {
  const widths = [62, 75, 50, 68, 40, 80, 55, 45];
  S.loadingEl.innerHTML = Array.from({length: count}, (_, i) => {
    const w1 = widths[i % widths.length];
    const w2 = widths[(i + 3) % widths.length] * 0.6;
    return `<div class="skel-card"><div class="skeleton skel-bar" style="width:${w1}%"></div><div class="skeleton skel-bar" style="width:${w2}%;height:9px"></div></div>`;
  }).join('');
}

// SEARCH
let searchSeq = 0;
// Baris meta di atas hasil: "N produk ditemukan (M produk belum firm disembunyikan) [Tampilkan]".
// Opsi tampilkan cuma berlaku untuk query yang sama (S.showNotFirmQ) — cari kata lain, balik
// disembunyikan lagi, biar produk belum firm gak nyangkut tampil terus tanpa disadari.
function setSearchMeta(base, notFirmCount, showingNotFirm, extraNote) {
  S.metaEl.textContent = base;
  if (notFirmCount) {
    S.metaEl.append(showingNotFirm ? ` (termasuk ${notFirmCount} belum firm) ` : ` (${notFirmCount} produk belum firm disembunyikan) `);
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = showingNotFirm ? 'Sembunyikan' : 'Tampilkan';
    b.style.cssText = 'background:none;border:none;padding:0;font:inherit;color:var(--accent,#1D5BD4);text-decoration:underline;cursor:pointer';
    b.addEventListener('click', () => {
      S.showNotFirmQ = showingNotFirm ? null : (S.rawCache && S.rawCache.q);
      runSearch({ reuse: true }); // pakai hasil RPC yang sama, gak fetch ulang
    });
    S.metaEl.append(b);
  }
  if (extraNote) S.metaEl.append(extraNote);
}
// ---- Dictionary (hemat resource) ----
// RPC search_dictionary_hits relatif mahal (~0,5 dtk: hitung ulang istilah dari riwayat permintaan). Jadi:
//  1. dipanggil SETELAH hasil biasa tampil, dan cuma kalau user berhenti mengetik (jeda DICT_DELAY_MS —
//     seluruh ketikan yang keburu diganti dibuang lewat searchSeq, gak sampai ke database);
//  2. dilewati untuk query yang jelas gak butuh: <3 huruf, kode produk (satu kata + angka), atau
//     pencarian biasa sudah dapat kecocokan persis (score 1000);
//  3. di-cache di browser 5 menit per query (istilah yang sama berulang gak nembak DB lagi).
const DICT_DELAY_MS = 450;
const DICT_CACHE_TTL = 5 * 60 * 1000;
const dictHitsCache = new Map(); // key -> { t, rows }
function dictPerluDicek(q, dataRaw) {
  const t = (q || '').trim();
  if (t.length < 3) return false;
  if (!/\s/.test(t) && /\d/.test(t)) return false;           // kemungkinan kode produk
  if (dataRaw && dataRaw.some(r => r.score >= 1000)) return false; // sudah ada kecocokan persis
  return true;
}
async function getDictHits(q, args) {
  const key = [q.trim().toLowerCase(), args.p_tipe || '', args.only_akd ? 1 : 0, args.only_kfa ? 1 : 0].join('|');
  const hit = dictHitsCache.get(key);
  if (hit && Date.now() - hit.t < DICT_CACHE_TTL) return hit.rows;
  let rows = [];
  try {
    const { data, error } = await S.rpc('search_dictionary_hits', args);
    if (!error && Array.isArray(data)) rows = data;
  } catch (e) { /* fungsi belum di-deploy / error: abaikan, pencarian biasa tetap jalan */ }
  if (dictHitsCache.size > 100) dictHitsCache.delete(dictHitsCache.keys().next().value);
  dictHitsCache.set(key, { t: Date.now(), rows });
  return rows;
}
S.getDictHits = getDictHits;
// Gabungkan hasil Dictionary ke daftar yang sudah tampil: yang sudah ada cuma diberi label & dinaikkan,
// yang belum ada ditambahkan di atas. Patuh filter yang sama dengan hasil biasa (firm / Verified).
async function mergeDictHits(q, args, dataRaw, mySeq) {
  if (!dictPerluDicek(q, dataRaw)) return;
  await new Promise(r => setTimeout(r, DICT_DELAY_MS));
  if (mySeq !== searchSeq) return; // user sudah mengetik lagi / pencarian lain jalan: gak usah nembak DB
  const hits = await getDictHits(q, args);
  if (!hits.length || mySeq !== searchSeq) return;
  const byKode = new Map(S.lastResults.map(r => [r.kode_produk, r]));
  const flagged = [], fresh = [];
  for (const h of hits) {
    const ex = byKode.get(h.kode_produk);
    if (ex) { ex.dict_istilah = h.dict_istilah; ex.dict_skor = h.dict_skor; flagged.push(ex); }
    else fresh.push(h);
  }
  let freshOk = S.filterFirm(fresh, S.modeSwasta);
  if (S.onlyVerified) freshOk = freshOk.filter(S.isVerified);
  if (!flagged.length && !freshOk.length) return;
  freshOk.forEach(r => { r.stok_pending = true; });
  if (S.rawCache && S.rawCache.q === q) S.rawCache.data = [...fresh, ...S.rawCache.data.filter(r => !hits.some(h => h.kode_produk === r.kode_produk))];
  const top = new Set([...freshOk, ...flagged]);
  S.lastResults = [...freshOk, ...flagged, ...S.lastResults.filter(r => !top.has(r))];
  applySort();
  S.currentPage = 1;
  renderResults(S.lastResults);
  const first = S.metaEl.firstChild; // teks "N produk ditemukan" -> perbarui angkanya saja
  if (first && first.nodeType === 3) first.nodeValue = first.nodeValue.replace(/^\d+/, String(S.lastResults.length));
  if (freshOk.length) {
    await Promise.race([Promise.resolve(S.enrichResultsWithStok(freshOk)).catch(() => {}), new Promise(r => setTimeout(r, 5000))]);
    freshOk.forEach(r => { delete r.stok_pending; });
    if (mySeq === searchSeq) { applySort(); renderResults(S.lastResults); }
  }
}

// ---- Typo: koreksi kata lewat RPC suggest_koreksi_query (kamus kata katalog + pg_trgm) ----
// Cuma dipanggil kalau hasil kosong/sedikit. Gagal/belum di-deploy -> null (diam-diam, pencarian tetap jalan).
const koreksiCache = new Map(); // q -> koreksi | null
async function cariKoreksi(q) {
  if (koreksiCache.has(q)) return koreksiCache.get(q);
  let fix = null;
  try {
    const { data, error } = await S.rpc('suggest_koreksi_query', { q });
    const row = !error && data ? (Array.isArray(data) ? data[0] : data) : null;
    if (row && row.berubah && row.koreksi && row.koreksi.trim() && row.koreksi.trim() !== q.trim().toLowerCase()) fix = row.koreksi.trim();
  } catch (e) { /* abaikan */ }
  koreksiCache.set(q, fix);
  return fix;
}
async function runSearch(opts) {
  const qInput = S.searchInput.value.trim();
  if (!qInput) { S.corrected = null; reset(); return; }
  // q = kata yang benar-benar dicari. Biasanya = ketikan; kalau tadi sudah dikoreksi otomatis, tetap pakai koreksinya
  // (mis. toggle "Tampilkan belum firm" memanggil runSearch({reuse:true})).
  let q = qInput;
  if (opts && opts.qOverride) q = opts.qOverride;
  else if (opts && opts.reuse && S.corrected && S.corrected.from === qInput) q = S.corrected.to;
  else S.corrected = null;
  const mySeq = ++searchSeq; // request lama yang telat balik nanti diabaikan, bukan nimpa hasil yang lebih baru
  S.errEl.style.display = 'none';
  S.hintEl.style.display = 'none';
  renderSkeletons(Math.min(S.lastResults.length || 6, S.RESULTS_PER_PAGE));
  S.loadingEl.style.display = 'block';
  S.resultsEl.innerHTML = '';
  S.emptyEl.style.display = 'none';
  S.metaEl.textContent = '';
  let dataRaw, error;
  if (opts && opts.reuse && S.rawCache && S.rawCache.q === q) {
    dataRaw = S.rawCache.data; error = null; // toggle "Tampilkan belum firm": hasil RPC yang sama
  } else {
    // Jalur utama = pencarian lama (cepat). Dictionary TIDAK ditunggu: ditambahkan belakangan oleh
    // mergeDictHits() (lihat bawah) — hemat resource & hasil biasa tetap instan.
    ({data: dataRaw, error} = await S.rpc('search_produk_dengan_harga', {
      q, p_tipe: S.selectedTipe, only_akd: S.onlyAkd, only_kfa: false
    }));
    if (!error) S.rawCache = { q, data: dataRaw };
    if (S.showNotFirmQ !== q) S.showNotFirmQ = null; // kata kunci baru -> belum firm disembunyikan lagi
  }
  // Produk belum firm (link_v6 ada catatan) disembunyikan dari hasil — lihat S.filterFirm —
  // kecuali user milih "Tampilkan" untuk query ini.
  await S.verifiedReady;
  const showingNotFirm = !S.modeSwasta && S.showNotFirmQ === q;
  let data = dataRaw ? (showingNotFirm ? dataRaw : S.filterFirm(dataRaw, S.modeSwasta)) : dataRaw;
  let notFirmCount = (dataRaw && !S.modeSwasta) ? dataRaw.filter(r => !S.isProdukFirm(r)).length : 0;
  let hiddenNote = '';
  if (S.onlyVerified && data) {
    const sebelum = data.length;
    data = data.filter(S.isVerified);
    hiddenNote += ` (${sebelum - data.length} non-Verified disembunyikan)`;
  }
  if (mySeq !== searchSeq) return; // sudah ada pencarian lebih baru — buang hasil basi ini

  S.loadingEl.style.display = 'none'; // FIX: matikan loading begitu response datang (sebelum branching)

  if (error) {
    S.acBox.style.display = 'none';
    const msg = error.message || JSON.stringify(error);
    if (msg.includes('timeout') || msg.includes('canceling')) {
      S.emptyEl.style.display='block';
      S.metaEl.textContent='Pencarian timeout — coba kata kunci lebih spesifik';
    } else {
      const offlineHint = (!navigator.onLine) ? ' Sepertinya koneksi internet kamu sedang terputus.' : '';
      S.errEl.innerHTML = `<div>Gagal mencari: ${msg}.${offlineHint}</div><button type="button" id="err-retry-btn" style="margin-top:6px;background:none;border:1px solid var(--danger-border);color:var(--danger);border-radius:6px;padding:4px 10px;font-size:11.5px;font-weight:600;cursor:pointer;font-family:inherit">Coba lagi</button>`;
      S.errEl.style.display='block';
      const retryBtn = document.getElementById('err-retry-btn');
      if (retryBtn) retryBtn.addEventListener('click', () => { S.errEl.style.display='none'; runSearch(); });
    }
    return;
  }
  // Katalog kosong ≠ pasti tidak ada. Istilah customer ("korentang") sering beda dari nama katalog
  // ("Forceps …"), jadi pencarian utama kosong, padahal riwayat TERPENUHI pernah memasangkannya.
  // Dulu Dictionary cuma dipanggil kalau hasil utama TIDAK kosong (mergeDictHits), jadi kasus ini lolos.
  // Sekarang dicek di sini, SEBELUM koreksi typo: riwayat nyata lebih bisa dipercaya daripada tebakan
  // trigram, dan koreksi diam-diam bisa membelokkan query ke kata lain. Satu RPC, di-cache, dan hanya
  // jalan kalau hasil kosong (query normal tidak membayar apa-apa).
  let dictRescued = false;
  if ((!data || !data.length) && dictPerluDicek(q, null)) {
    const hits = await getDictHits(q, { q, p_tipe: S.selectedTipe, only_akd: S.onlyAkd, only_kfa: false });
    if (mySeq !== searchSeq) return;
    let fromDict = showingNotFirm ? hits : S.filterFirm(hits, S.modeSwasta);
    if (!S.modeSwasta) notFirmCount = hits.filter(r => !S.isProdukFirm(r)).length;
    if (S.onlyVerified) {
      const sebelum = fromDict.length;
      fromDict = fromDict.filter(S.isVerified);
      if (sebelum > fromDict.length) hiddenNote += ` (${sebelum - fromDict.length} non-Verified disembunyikan)`;
    }
    if (fromDict.length) {
      data = fromDict;
      dictRescued = true;
      hiddenNote += ' — cocok dengan riwayat istilah customer';
    }
  }
  if ((!data || !data.length) && !S.corrected && !(opts && opts.noCorrect)) {
    const fix = await cariKoreksi(q);
    if (mySeq !== searchSeq) return;
    if (fix) { S.corrected = { from: qInput, to: fix }; return runSearch({ qOverride: fix }); }
  }
  if (!data || !data.length) { S.emptyEl.style.display='block'; setSearchMeta('Tidak ada hasil untuk "'+qInput+'"', notFirmCount, showingNotFirm, hiddenNote); delete S.metaEl.dataset.nav; S.acBox.style.display='none'; return; }
  S.lastResults = data;
  // PERF: dulu di sini `await enrichResultsWithStok()` DULU baru render, jadi tiap pencarian
  // nunggu 1 round trip tambahan cuma buat badge stok. Sekarang hasil langsung tampil dengan
  // badge "Cek stok…", stok di-fetch di belakang, lalu kartu di-render ulang.
  data.forEach(r => { r.stok_pending = true; });
  S.sortSelect.style.display = 'inline-block';
  applySort();
  S.currentPage = 1;
  let metaExtra = hiddenNote;
  if (S.corrected && S.corrected.to === q) {
    // Hasil dari koreksi otomatis: kasih tau + jalan balik ke pencarian persis
    const frag = document.createDocumentFragment();
    frag.append(hiddenNote || '', ` — menampilkan hasil untuk "${q}". `);
    const bk = document.createElement('button');
    bk.type = 'button'; bk.textContent = `Cari "${qInput}" saja`;
    bk.style.cssText = 'background:none;border:none;padding:0;font:inherit;color:var(--accent,#1D5BD4);text-decoration:underline;cursor:pointer';
    bk.addEventListener('click', () => { S.corrected = null; runSearch({ noCorrect: true }); });
    frag.append(bk);
    metaExtra = frag;
  }
  setSearchMeta(data.length + ' produk ditemukan', notFirmCount, showingNotFirm, metaExtra);
  S.metaEl.dataset.nav = '1';
  // Hasil sedikit & belum dikoreksi: tawarkan "Maksud kamu…?" (async, gak menahan render)
  if (!S.corrected && !dictRescued && data.length <= 2 && !(opts && opts.noCorrect)) { // hasil dari riwayat = sudah istilah customer yang valid, gak perlu tebakan typo (hemat 1 RPC)
    cariKoreksi(q).then(fix => {
      if (!fix || mySeq !== searchSeq || S.corrected) return;
      S.metaEl.append(' Maksud kamu: ');
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = fix;
      b.style.cssText = 'background:none;border:none;padding:0;font:inherit;font-weight:600;color:var(--accent,#1D5BD4);text-decoration:underline;cursor:pointer';
      b.addEventListener('click', () => { S.corrected = { from: qInput, to: fix }; runSearch({ qOverride: fix }); });
      S.metaEl.append(b, '?');
    });
  }
  S.kbdCardIdx = -1;
  renderResults(S.lastResults);
  if (!dictRescued) mergeDictHits(q, { q, p_tipe: S.selectedTipe, only_akd: S.onlyAkd, only_kfa: false }, dataRaw, mySeq); // non-blocking (kalau sudah rescue, hasilnya sudah dari Dictionary)
  if (S.pnmSettings.autoComplete) {
    renderAutocomplete(S.lastResults);
  } else {
    S.acBox.style.display = 'none';
    S.acBox.innerHTML = '';
    S.acItems = []; S.acIndex = -1;
  }

  // Batas tunggu stok: di koneksi jelek fetch bisa macet lama. Lewat batas ini badge jatuh ke
  // "Stok: -" (sama kayak dulu kalau fetch stok gagal) dan tombol Tambah dibuka lagi — gak nyangkut.
  const STOK_TIMEOUT_MS = 5000;
  let timedOut = false;
  const enrich = Promise.resolve(S.enrichResultsWithStok(data)).catch(() => { /* stok cuma nice-to-have */ });
  const timer = new Promise(res => setTimeout(() => { timedOut = true; res(); }, STOK_TIMEOUT_MS));
  const refreshAfterStok = () => {
    const kbdIdx = S.kbdCardIdx ?? -1;
    applySort(); // perlu kalau mode sort berbasis stok (READY/INDENT dulu); idempotent di mode lain
    renderResults(S.lastResults);
    if (kbdIdx >= 0) setKbdCard(kbdIdx); // jaga highlight keyboard biar gak hilang pas re-render
  };
  await Promise.race([enrich, timer]);
  data.forEach(r => { delete r.stok_pending; });
  if (mySeq !== searchSeq) return; // sudah ada pencarian lebih baru selama stok di-fetch — jangan timpa
  refreshAfterStok();
  // Stok telat (lewat batas) tapi akhirnya datang: render ulang sekali supaya badge-nya ikut benar.
  if (timedOut) enrich.then(() => { if (mySeq === searchSeq) refreshAfterStok(); });
}

// SORT
function applySort() {
  const useLinkPriority = S.prioritizeLink && !S.modeSwasta;

  if (S.sortMode === 'relevance') {
    if (useLinkPriority) {
      S.lastResults = [...S.lastResults].sort((a, b) => {
        return S.katalogRank(a) - S.katalogRank(b); // verified > link bersih > lainnya; stable sort: urutan relevansi asli tetap terjaga di tiap grup
      });
    }
    return; // urutan asli dari backend (score DESC), atau sudah dipartisi link_v6 di atas
  }

  if (S.sortMode === 'stok_ready_dulu' || S.sortMode === 'stok_indent_dulu') {
    // urutan: READY -> INDENT -> tanpa data stok (paling bawah), lalu tie-break by qty desc
    const rank = (status) => status === 'READY' ? 0 : status === 'INDENT' ? 1 : 2;
    const dirFlip = S.sortMode === 'stok_indent_dulu';
    S.lastResults.sort((a, b) => {
      let ra = rank(a.stok_status), rb = rank(b.stok_status);
      if (dirFlip) {
        // tukar urutan READY/INDENT, tapi "tanpa data" tetap paling bawah
        if (ra < 2) ra = ra === 0 ? 1 : 0;
        if (rb < 2) rb = rb === 0 ? 1 : 0;
      }
      if (ra !== rb) return ra - rb;
      return (b.stok_qty || 0) - (a.stok_qty || 0);
    });
    return;
  }

  const field = S.modeSwasta ? 'harga_swasta' : 'harga_ekat';
  const dir = S.sortMode === 'harga_asc' ? 1 : -1;
  S.lastResults.sort((a, b) => {
    if (useLinkPriority) {
      const aHas = S.katalogRank(a);
      const bHas = S.katalogRank(b);
      if (aHas !== bHas) return aHas - bHas;
    }
    const av = a[field], bv = b[field];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;  // produk tanpa harga ditaruh paling bawah
    if (bv == null) return -1;
    return (av - bv) * dir;
  });
}

// Badge status e-Katalog per kartu hasil. Hijau "Ada di e-Katalog v6" HANYA
// buat link bersih (URL doang). Link yang ada catatan tambahan (mis. "UPDATE
// HARGA TAPI MASIH NYANTOL ORDERAN") sengaja TIDAK dianggap ada di e-Katalog —
// harganya belum tentu valid — jadi dikasih badge kuning + isi catatannya.
function katalogBadgeHtml(r) {
  const L = S.parseLinkV6(r.link_v6);
  const verified = S.isVerified(r);
  const vIcon = verified ? ' <i class="ti ti-rosette-discount-check-filled" style="font-size:13px;color:#1d9bf0" title="Verified Product — tayang di INAPROC"></i>' : '';
  if (L.state === 'bersih') {
    return `<a href="${S.escapeHtmlAttr(L.url)}" target="_blank" rel="noopener" class="badge-katalog-yes" data-role="link-katalog" title="Ada di e-Katalog v6 — klik untuk membuka"><i class="ti ti-circle-check" style="font-size:12px"></i> e-Kat v6${vIcon}</a>`;
  }
  if (verified && L.state !== 'catatan') {
    // tayang & verified di INAPROC, tapi Link V6 belum diisi di database kita
    return `<span class="badge-katalog-yes" data-role="verified-tanpa-link" title="Sudah Verified di INAPROC, Link V6 belum diisi di CRUD Produk"><i class="ti ti-rosette-discount-check-filled" style="font-size:13px;color:#1d9bf0"></i> Verified INAPROC · Link V6 belum diisi</span>`;
  }
  if (L.state === 'catatan') {
    const ringkas = L.catatan.length > 48 ? L.catatan.slice(0, 48) + '…' : L.catatan;
    const tip = 'Link V6 belum bersih — ada catatan: ' + L.catatan;
    return `<span class="badge-katalog-no" data-role="link-katalog-catatan" title="${S.escapeHtmlAttr(tip)}" style="color:var(--amber-text,#8a5314);border-color:var(--amber,#c97c2a);background:var(--amber-bg,#fbf0de)"><i class="ti ti-alert-circle" style="font-size:12px"></i> Link V6 ada catatan${ringkas ? ': ' + S.escapeHtmlAttr(ringkas) : ''}</span>`;
  }
  if (r.status_inaproc === 'Disetujui') {
    return `<span class="badge-katalog-no" style="color:var(--rust-text,#8F3620);border-color:var(--rust,#B8492F);background:var(--rust-bg,#FBE8E2)"><i class="ti ti-alert-triangle" style="font-size:12px"></i> Disetujui INAPROC — siap dibuatkan Link V6!</span>`;
  }
  return `<span class="badge-katalog-no" title="Belum ada di e-Katalog"><i class="ti ti-circle-x" style="font-size:12px"></i> Belum di e-Kat</span>`;
}

// Label tombol lampiran di KARTU hasil: ringkas (ikon + jumlah item). Dialog/Dictionary tetap pakai
// setLampiranLabelText ("Lihat Lampiran · N item") — jangan disatukan, ruangnya beda.
function lampiranCardLabel(n) { return n != null ? n + ' item' : 'Lampiran'; }

function renderResults(data) {
  // clamp currentPage kalau data berubah (misal abis filter) jadi lebih pendek dari halaman aktif
  const totalPages = Math.max(1, Math.ceil(data.length / S.RESULTS_PER_PAGE));
  if (S.currentPage > totalPages) S.currentPage = totalPages;
  if (S.currentPage < 1) S.currentPage = 1;
  const start = (S.currentPage - 1) * S.RESULTS_PER_PAGE;
  const pageData = data.slice(start, start + S.RESULTS_PER_PAGE);

  S.resultsEl.innerHTML = pageData.map((r, i) => {
    const inClip = S.clipboard.some(c => c.kode_produk === r.kode_produk);
    const isSet = r.tipe && r.tipe.toUpperCase() === 'SET';
    const tipeClass = isSet ? 'tipe-set' : (r.tipe && r.tipe.toUpperCase() === 'UNIT') ? 'tipe-unit' : 'tipe-other';
    const hargaTampil = S.modeSwasta ? r.harga_swasta : r.harga_ekat;
    const tahunTampil = S.modeSwasta ? r.tahun_harga_swasta : r.tahun_harga;
    const labelHarga = S.modeSwasta ? 'Harga Swasta' : 'Harga belum ada';
    const stokBadge = S.stokBadgeHtml(r, isSet);
    // SECURITY FIX 2026-08-14 (+ diperluas hari ini): konsisten dengan
    // renderClipItemHtml — escape SEMUA field yang datang dari DB (bisa
    // diisi manual lewat CRUD Produk oleh staf manapun) sebelum masuk
    // innerHTML/atribut, bukan cuma nama_produk. kode_produk/kode_asli/
    // no_akd/kode_kfa/tipe semuanya kolom teks bebas di database — kalau
    // salah satunya kebetulan diisi karakter HTML (sengaja atau gak),
    // tanpa escape ini bakal jadi stored XSS yang nyerang SEMUA user lain
    // yang buka hasil pencarian yang sama, bukan cuma yang ngisi datanya.
    const kode = S.escapeHtmlAttr(r.kode_produk||'');
    const kodeAsli = S.escapeHtmlAttr(r.kode_asli||'');
    const namaEsc = S.escapeHtmlAttr(r.nama_produk||'');
    const noAkdEsc = S.escapeHtmlAttr(r.no_akd||'');
    const kodeKfaEsc = S.escapeHtmlAttr(r.kode_kfa||'');
    const tipeEsc = S.escapeHtmlAttr(r.tipe||'');
    const tahunEsc = S.escapeHtmlAttr(String(tahunTampil || ''));
    const priceHtml = hargaTampil
      ? `<span class="rcard-price" title="${S.modeSwasta ? 'Harga swasta' : 'Harga e-Katalog'}${tahunEsc ? ' ' + tahunEsc : ''}">${S.rupiah(hargaTampil)}${tahunEsc ? `<small>${tahunEsc}</small>` : ''}</span>`
      : `<span class="rcard-price is-empty">${S.modeSwasta ? 'Harga swasta belum ada' : 'Harga belum ada'}</span>`;
    const ctaHtml = inClip
      ? `<button type="button" class="btn-clip-toggle in-clip" data-kode="${kode}" data-action="remove" title="Sudah di Konversi — klik untuk keluarkan"><i class="ti ti-circle-check"></i><span>Di Konversi</span></button>`
      : `<button type="button" class="btn-clip-toggle" data-kode="${kode}" data-action="add" title="Tambahkan ke Konversi"><i class="ti ti-plus"></i><span>Tambah</span></button>`;
    return `<div class="rcard${inClip?' selected':''}" data-kode="${kode}">
      <div class="rcard-top">
        <span class="rcard-name" title="${namaEsc}">${namaEsc||'—'}</span>
        ${r.tipe?`<span class="tipe-badge ${tipeClass}">${tipeEsc}</span>`:''}
        ${(!S.modeSwasta && !S.isProdukFirm(r)) ? `<span class="tipe-badge tipe-other" title="Link V6 masih ada catatan — tidak dipakai buat konversi">Belum firm</span>` : ''}
        ${r.dict_istilah ? `<span class="tipe-badge tipe-other" title="Cocok dengan istilah di Dictionary: ${S.escapeHtmlAttr(r.dict_istilah)}"><i class="ti ti-book-2"></i> Dictionary</span>` : ''}
        ${priceHtml}
        ${ctaHtml}
      </div>
      <div class="rcard-foot">
        <div class="rcard-meta">
          <span class="mi mi-kode" title="Kode produk"><i class="ti ti-barcode"></i><span>${kode||'—'}</span></span>
          ${r.no_akd?`<span class="mi" title="No. AKD"><i class="ti ti-certificate"></i><span>${noAkdEsc}</span></span>`:''}
          ${r.kode_kfa?`<span class="mi" title="Kode KFA"><i class="ti ti-tag"></i><span>${kodeKfaEsc}</span></span>`:''}
          ${stokBadge}
        </div>
        <div class="rcard-tools">
          ${S.modeSwasta ? '' : katalogBadgeHtml(r)}
          <button type="button" class="rc-tool btn-lihat-gambar" data-kode="${kode}" data-kode-asli="${kodeAsli}" data-nama="${namaEsc}" title="Lihat gambar" aria-label="Lihat gambar"><i class="ti ti-eye"></i></button>
          <button type="button" class="rc-tool btn-copy-produk" data-kode="${kode}" title="Copy info produk" aria-label="Copy info produk"><i class="ti ti-copy"></i></button>
          <button type="button" class="rc-tool rc-tool-text btn-lampiran" data-kode="${kode}" data-is-set="${isSet}" title="Lihat lampiran${isSet ? ' (isi set)' : ''}" aria-label="Lihat lampiran"><i class="ti ti-file-text"></i>${isSet ? `<span data-lampiran-label="${kode}">${lampiranCardLabel(S.cachedSetItemCount(r))}</span>` : ''}</button>
          <button type="button" class="rc-tool btn-edit-produk" data-kode="${kode}" title="Edit produk ini" aria-label="Edit produk ini"><i class="ti ti-settings"></i></button>
        </div>
      </div>
    </div>`;
  }).join('');
  // Card body SENGAJA gak punya click listener lagi (dulu klik di mana aja
  // langsung commit ke Konversi/bikin row database — lihat diskusi rebase UI).
  // Cari Cepat sekarang murni baca: lihat, Copy, atau eksplisit "Tambahkan ke
  // Konversi" lewat tombol di bawah ini, gak ada jalan lain yang nulis ke server.
  S.resultsEl.querySelectorAll('.btn-clip-toggle').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      S.handleClipToggleClick(btn.dataset.kode, btn.dataset.action);
    });
  });
  S.resultsEl.querySelectorAll('.btn-edit-produk').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      S.navigateToEditProduk(btn.dataset.kode);
    });
  });
  S.resultsEl.querySelectorAll('.btn-lampiran').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      S.openLampiranModal(btn.dataset.kode, btn.dataset.isSet === 'true');
    });
  });
  // SET yang belum ada angka item-nya → ambil lazy, label tombol nyusul.
  S.hydrateSetCounts(S.resultsEl, pageData
    .filter(r => r.tipe && r.tipe.toUpperCase() === 'SET' && S.cachedSetItemCount(r) == null)
    .map(r => r.kode_produk), lampiranCardLabel);
  S.resultsEl.querySelectorAll('[data-role="link-katalog"]').forEach(a => {
    a.addEventListener('click', (e) => { e.stopPropagation(); });
  });
  S.resultsEl.querySelectorAll('.btn-lihat-gambar').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      S.openGambarModal(btn.dataset.kodeAsli, btn.dataset.kode, btn.dataset.nama);
    });
  });
  S.resultsEl.querySelectorAll('.btn-copy-produk').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      copyProdukToClipboard(btn.dataset.kode);
    });
  });
  renderPagination(data.length);
  if (S._kbdLastPage !== S.currentPage) { S.kbdCardIdx = -1; S._kbdLastPage = S.currentPage; }
  if ((S.kbdCardIdx ?? -1) >= 0) setKbdCard(S.kbdCardIdx);
}
S.renderResults = renderResults;

// ── NAVIGASI KEYBOARD HASIL PENCARIAN ──────────────────────────────────────
// Alur kerja inti = ketik → pilih → tambah → ketik lagi. Tanpa ini tiap produk
// butuh pindah ke mouse (Fitts). Saat dropdown autocomplete TERTUTUP:
//   ↓ / ↑  pindah sorotan antar kartu     Enter  tambah/keluarkan dari Konversi
//   Esc    hapus sorotan                  (ketik lagi = pencarian baru, sorotan reset)
// Saat autocomplete terbuka, perilaku lama (↓/↑/Enter pilih saran) tidak berubah.
S.kbdCardIdx = -1;
function setKbdCard(idx) {
  const cards = Array.from(S.resultsEl.querySelectorAll('.rcard'));
  cards.forEach(c => c.classList.remove('kbd-active'));
  if (!cards.length || idx < 0) { S.kbdCardIdx = -1; return; }
  S.kbdCardIdx = Math.min(idx, cards.length - 1);
  const c = cards[S.kbdCardIdx];
  c.classList.add('kbd-active');
  c.scrollIntoView({ block: 'nearest' });
}

// COPY SATU PRODUK: kode, deskripsi, harga, link — siap paste ke WA.
// Link e-Katalog cuma relevan di mode e-Katalog — di mode Swasta link_v6
// gak ikut kecopy, konsisten sama badge katalog (baris di atas), sheet
// SUMMARY, dan sheet Kebutuhan RS di Export Excel yang juga nyembunyiin
// kolom Link pas modeSwastaOutput true.
function copyProdukToClipboard(kode) {
  const r = S.lastResults.find(x => x.kode_produk === kode);
  if (!r) return;
  const harga = S.modeSwasta ? r.harga_swasta : r.harga_ekat;
  const lines = [
    r.kode_produk || '-',
    r.nama_produk || '-',
    harga ? S.rupiah(harga) : 'Harga belum ada',
    S.modeSwasta ? '' : (S.cleanLinkV6(r.link_v6) || '')
  ];
  if (S.pnmSettings && S.pnmSettings.outputVerified && S.isVerified(r)) lines.push('Verified');
  const text = lines.join('\t');

  function fallbackCopy(str) {
    const ta = document.createElement('textarea');
    ta.value = str;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      S.showToast('Disalin ke clipboard ✓');
    }).catch(() => {
      if (fallbackCopy(text)) S.showToast('Disalin ke clipboard ✓');
      else S.showToast('Gagal menyalin, coba lagi', 'error');
    });
  } else {
    if (fallbackCopy(text)) S.showToast('Disalin ke clipboard ✓');
    else S.showToast('Gagal menyalin, coba lagi', 'error');
  }
} // <- INI PENUTUP FUNCTION-NYA, PASTIKAN ADA
// PAGINATION
function renderPagination(totalItems) {
  const totalPages = Math.max(1, Math.ceil(totalItems / S.RESULTS_PER_PAGE));
  if (totalPages <= 1) { S.paginationEl.innerHTML = ''; S.paginationEl.classList.add('hidden'); return; }
  S.paginationEl.classList.remove('hidden');

  function pageBtn(p, label, disabled=false) {
    const active = p === S.currentPage;
    return `<button class="page-btn${active?' active':''}" data-page="${p}"${disabled?' disabled':''}>${label}</button>`;
  }

  // selalu tampilin halaman 1, halaman terakhir, dan sekitar halaman aktif; sisanya "…"
  const pagesToShow = [...new Set([1, totalPages, S.currentPage-1, S.currentPage, S.currentPage+1])]
    .filter(p => p >= 1 && p <= totalPages)
    .sort((a,b) => a-b);

  let numberBtns = '';
  let prevP = null;
  pagesToShow.forEach(p => {
    if (prevP !== null && p - prevP > 1) numberBtns += `<span class="page-info">…</span>`;
    numberBtns += pageBtn(p, p);
    prevP = p;
  });

  const startItem = (S.currentPage - 1) * S.RESULTS_PER_PAGE + 1;
  const endItem = Math.min(S.currentPage * S.RESULTS_PER_PAGE, totalItems);

  S.paginationEl.innerHTML = `
    <span class="page-info">${startItem}–${endItem} dari ${totalItems}</span>
    ${pageBtn(S.currentPage - 1, '<i class="ti ti-chevron-left"></i>', S.currentPage === 1)}
    ${numberBtns}
    ${pageBtn(S.currentPage + 1, '<i class="ti ti-chevron-right"></i>', S.currentPage === totalPages)}
  `;

  S.paginationEl.querySelectorAll('.page-btn[data-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = parseInt(btn.dataset.page, 10);
      if (!p || p < 1 || p > totalPages || p === S.currentPage) return;
      S.currentPage = p;
      renderResults(S.lastResults);
      S.panelBodyCari.scrollTop = 0;
    });
  });
}


// RESET
function reset() {
  searchSeq++;
  S.resultsEl.innerHTML = '';
  S.paginationEl.innerHTML = '';
  S.paginationEl.classList.add('hidden');
  S.currentPage = 1;
  S.metaEl.textContent = '';
  S.sortSelect.style.display = 'none';
  S.emptyEl.style.display = 'none';
  S.loadingEl.style.display = 'none';
  S.hintEl.style.display = 'block';
  S.errEl.style.display = 'none';
  S.acBox.style.display = 'none';
}

// EVENTS
S.takd.addEventListener('click', () => { S.onlyAkd=!S.onlyAkd; S.takd.classList.toggle('on',S.onlyAkd); runSearch(); });
if (S.tverif) S.tverif.addEventListener('click', () => { S.onlyVerified=!S.onlyVerified; S.tverif.classList.toggle('on',S.onlyVerified); runSearch(); });
S.tswasta.addEventListener('click', () => {
  S.modeSwasta = !S.modeSwasta;
  S.tswasta.classList.toggle('on', S.modeSwasta);
  applySort();
  S.currentPage = 1;
  if (S.lastResults.length) renderResults(S.lastResults);
});


S.sortSelect.addEventListener('change', () => {
  S.sortMode = S.sortSelect.value;
  applySort();
  S.currentPage = 1;
  renderResults(S.lastResults);
});
S.tipeBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const tipe = btn.dataset.tipe;
    S.selectedTipe = (S.selectedTipe === tipe) ? null : tipe;
    S.tipeBtns.forEach(b => b.classList.toggle('on', b.dataset.tipe === S.selectedTipe));
    runSearch();
  });
});
S.clearBtn.addEventListener('click', () => { S.searchInput.value=''; S.clearBtn.style.display='none'; S.acBox.style.display='none'; reset(); S.searchInput.focus(); });

S.searchInput.addEventListener('input', () => {
  if (S.searchInput.value.trim().toLowerCase() === '/linkpalsugas') {
    S.searchInput.value = '';
    S.clearBtn.style.display = 'none';
    S.acBox.style.display = 'none';
    if (typeof window.openLinkGenModal === 'function') window.openLinkGenModal();
    return;
  }
  S.clearBtn.style.display = S.searchInput.value ? 'block' : 'none';
  if ((S.kbdCardIdx ?? -1) >= 0) setKbdCard(-1);
  clearTimeout(S.acTimer);
  S.acTimer = setTimeout(() => runSearch(), 150);
});

S.searchInput.addEventListener('keydown', e => {
  const items = S.acBox.querySelectorAll('.ac-item');
  const acOpen = S.acBox.style.display === 'block' && items.length > 0;
  if (acOpen) {
    if (e.key==='ArrowDown'){e.preventDefault();S.acIndex=Math.min(S.acIndex+1,items.length-1);items.forEach((el,i)=>el.classList.toggle('active',i===S.acIndex));}
    else if(e.key==='ArrowUp'){e.preventDefault();S.acIndex=Math.max(S.acIndex-1,-1);items.forEach((el,i)=>el.classList.toggle('active',i===S.acIndex));}
    else if(e.key==='Enter'){if(S.acIndex>=0&&items[S.acIndex])S.searchInput.value=S.acItems[S.acIndex].nama_produk;S.acBox.style.display='none';runSearch();}
    else if(e.key==='Escape')S.acBox.style.display='none';
    return;
  }
  // autocomplete tertutup → keyboard dipakai buat jalan di hasil pencarian
  const cur = S.kbdCardIdx ?? -1;
  if (e.key === 'ArrowDown' && S.resultsEl.querySelector('.rcard')) { e.preventDefault(); setKbdCard(cur + 1); }
  else if (e.key === 'ArrowUp' && cur >= 0) { e.preventDefault(); setKbdCard(cur - 1); }
  else if (e.key === 'Escape') { if (cur >= 0) setKbdCard(-1); S.acBox.style.display='none'; }
  else if (e.key === 'Enter') {
    const card = cur >= 0 ? S.resultsEl.querySelectorAll('.rcard')[cur] : null;
    if (card) { e.preventDefault(); card.querySelector('.btn-clip-toggle')?.click(); }
    else { S.acBox.style.display='none'; runSearch(); }
  }
});

function __konvDismissAcOnOutsideClick(e) { if(!document.querySelector('.search-wrap').contains(e.target)) S.acBox.style.display='none'; }
S.__konvDismissAcOnOutsideClick = __konvDismissAcOnOutsideClick;
document.addEventListener('click', __konvDismissAcOnOutsideClick);

}