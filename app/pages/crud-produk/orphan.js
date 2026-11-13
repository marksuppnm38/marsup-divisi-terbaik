// Tab "Orphan / Drift" -- arah SEBALIKNYA dari tab "Sync dari Sheet":
// "item ini ada di Supabase tapi di sheet sudah tidak ada".
// Semua section hanya-baca, KECUALI section "Hilang di sheet" yang punya quick action hapus massal
// (RPC orphan_bulk_delete, lihat sql/02_orphan_bulk_delete.sql). Keputusan boleh-tidaknya dihapus ada di
// SERVER: tiap kode dievaluasi ulang terhadap snapshot terbaru, jadi daftar di layar yang basi tidak bisa
// menghapus produk yang sudah kembali ada di sheet. Browser hanya memilih dan menampilkan pratinjau.
// Sumber: view v_sync_* + sync_orphan_produk (diisi pushManifest di Apps Script ->
// edge function sync-sheet type 'manifest' -> RPC reverse_check_commit).
import { showToast, renderPgBar } from './ui-utils.js';

export function installOrphan(S) {
  const PAGE_SIZE = 50;
  const CONFIRM_AFTER = 3; // harus sama dengan MANIFEST_CONFIRM_AFTER di Apps Script
  const SECTIONS = [
    // label pendek supaya lima tab muat satu baris; kalimat lengkapnya ada di tooltip dan di subjudul halaman
    { id: 'orphan',   label: 'Hilang di sheet', hint: 'Ada di DB, hilang di sheet',           icon: 'ti-ghost-2' },
    { id: 'akd',      label: 'Relasi AKD',      hint: 'Relasi AKD ada di DB, tidak ada di sheet', icon: 'ti-shield-off' },
    { id: 'komp',     label: 'Komposisi set',   hint: 'Komposisi set ada di DB, tidak ada di sheet', icon: 'ti-stack-2' },
    { id: 'tipe',     label: 'Tipe beda',       hint: 'Tipe produk di DB berbeda dengan di sheet', icon: 'ti-arrows-diff' },
    { id: 'nonaktif', label: 'Nonaktif di DB',  hint: 'Nonaktif di DB, tapi masih ada di sheet', icon: 'ti-eye-off' },
  ];
  const SOURCES = {
    orphan: 'v_sync_orphan_detail', akd: 'v_sync_akd_drift', komp: 'v_sync_setkomp_drift',
    tipe: 'v_sync_tipe_mismatch', nonaktif: 'v_sync_inactive_in_sheet',
  };
  const st = {
    section: 'orphan', page: 1, q: '', fStatus: 'all', fAsal: 'all', fTipe: 'all', sel: new Set(),
    data: { orphan: [], akd: [], komp: [], tipe: [], nonaktif: [] },
    run: null, missingBackend: false,
    del: { busy: false, opt: { legacy: false, detach: false }, preview: [], typed: '' },
  };
  const esc = (v) => S.escapeHtml(v == null ? '' : String(v));
  const $ = (id) => document.getElementById(id);
  const fmtDate = (d) => new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });

  async function fetchAll(view) {
    const all = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await S.sb.from(view).select('*').range(from, from + 999);
      if (error) return { error };
      all.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    return { data: all };
  }

  // PERF: tiap view di sini ~1,4 dtk per eksekusi (produk di-seq-scan + subplan per baris) dan
  // fetchAll() mengeksekusinya ulang untuk SETIAP halaman 1000 baris. Data ini cuma berubah saat
  // manifest sync baru masuk (run_id baru) -> kalau run_id sama dengan yang sudah dimuat, pakai
  // data di memori. Tombol Refresh (force=true) selalu muat ulang.
  async function load(force) {
    const body = $('orphanBody');
    if (!body) return;
    st.sel.clear();
    const cachedRunId = st.loadedRunId;
    body.innerHTML = '<div class="table-card">' + Array.from({ length: 8 }, () =>
      '<div class="orph-skel-row"><span class="orph-skel s-kode"></span><span class="orph-skel s-nama"></span><span class="orph-skel s-tag"></span></div>').join('') + '</div>';
    const runRes = await S.sb.from('sync_manifest_run').select('run_id, finished_at, status, note')
      .in('status', ['committed', 'suspect']).order('finished_at', { ascending: false }).limit(1);
    if (runRes.error) {
      st.missingBackend = true;
      body.innerHTML = `<div class="orph-alert"><i class="ti ti-alert-triangle"></i><div>Backend reverse-check belum terpasang (${esc(runRes.error.message)}). Jalankan <code>reverse_check.sql</code>, deploy edge function, lalu jalankan <code>pushManifest()</code> sekali di Apps Script.</div></div>`;
      $('orphanCount').textContent = 'Belum aktif';
      return;
    }
    st.missingBackend = false;
    st.run = (runRes.data || [])[0] || null;
    if (force !== true && cachedRunId != null && st.run && st.run.run_id === cachedRunId) { render(); return; }
    const keys = Object.keys(SOURCES);
    const results = await Promise.all(keys.map((k) => fetchAll(SOURCES[k])));
    keys.forEach((k, i) => { st.data[k] = results[i].error ? [] : results[i].data; });
    const firstErr = results.find((r) => r.error);
    if (firstErr) showToast('Sebagian data gagal dimuat: ' + firstErr.error.message, true);
    st.loadedRunId = (!firstErr && st.run) ? st.run.run_id : null; // jangan di-cache kalau ada yang gagal
    render();
  }

  // ---------- util ----------
  const chip = (attr, val, active, html, count) =>
    `<button class="filter-chip${active ? ' active' : ''}" ${attr}="${val}">${html}${count != null ? `<span class="fc-count">${count}</span>` : ''}</button>`;
  const matchQ = (vals) => { const q = st.q.trim().toLowerCase(); return !q || vals.some((v) => v && String(v).toLowerCase().includes(q)); };
  const filtersOn = () => !!st.q.trim() || (st.section === 'orphan' && (st.fStatus !== 'all' || st.fAsal !== 'all' || st.fTipe !== 'all'));
  // kosong karena filter -> beri jalan keluar (reset); kosong karena memang bersih -> jelaskan artinya
  const emptyState = (cleanMsg) => filtersOn()
    ? '<div class="orph-empty is-filtered"><i class="ti ti-filter-off"></i><div>Tidak ada hasil untuk pencarian atau filter ini.</div><button class="btn btn-sm" type="button" data-oreset>Reset pencarian dan filter</button></div>'
    : `<div class="orph-empty"><i class="ti ti-circle-check"></i><div>${cleanMsg}</div></div>`;

  function runHealth() {
    if (!st.run) return { level: 'bad', label: 'Belum ada', when: '-', ago: '', warns: [] };
    const ageH = (Date.now() - new Date(st.run.finished_at).getTime()) / 3600000;
    const when = new Date(st.run.finished_at).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    const warns = [];
    if (st.run.status === 'suspect') warns.push(`Snapshot terakhir bermasalah (${esc(st.run.note || 'sebagian sheet tidak sehat')}). Tipe produk dari sheet itu <b>tidak dinilai</b>.`);
    if (ageH > 3) warns.push(`Snapshot sudah ${Math.floor(ageH)} jam — cek trigger <code>pushManifest</code>.`);
    const level = st.run.status === 'suspect' ? 'warn' : ageH > 3 ? 'warn' : 'ok';
    const label = st.run.status === 'suspect' ? 'Bermasalah' : ageH > 3 ? 'Terlambat' : 'Sehat';
    const ago = ageH < 1 ? `${Math.max(1, Math.round(ageH * 60))} menit lalu` : ageH < 48 ? `${Math.floor(ageH)} jam lalu` : `${Math.floor(ageH / 24)} hari lalu`;
    return { level, label, when, ago, warns };
  }
  function runBanner() {
    if (!st.run) return '<div class="orph-alert"><i class="ti ti-alert-triangle"></i><div>Belum ada snapshot sheet. Jalankan <code>pushManifest()</code> di Apps Script.</div></div>';
    const h = runHealth();
    return h.warns.length ? `<div class="orph-alert"><i class="ti ti-alert-triangle"></i><div>${h.warns.join(' ')}</div></div>` : '';
  }
  function renderStats() {
    const o = st.data.orphan, h = runHealth();
    const nConf = o.filter((r) => r.status === 'confirmed').length;
    const nPend = o.filter((r) => r.status === 'pending').length;
    const nLegacy = o.filter((r) => !r.pernah_di_sheet).length;
    const card = (cls, icon, label, value, sub, attr) =>
      `<${attr ? 'button' : 'div'} class="orph-stat ${cls}"${attr ? ' ' + attr : ''}><div class="orph-stat-top"><i class="ti ${icon}"></i><span>${label}</span></div><div class="orph-stat-val">${value}</div><div class="orph-stat-sub">${sub}</div></${attr ? 'button' : 'div'}>`;
    $('orphanStats').innerHTML =
      card('is-rust', 'ti-ghost-2', 'Ada di DB, hilang di sheet', o.length.toLocaleString('id-ID'), `${nLegacy.toLocaleString('id-ID')} tak pernah terpantau di sheet`, 'data-ostat="all"') +
      card('is-confirmed', 'ti-circle-check', 'Terkonfirmasi', nConf.toLocaleString('id-ID'), `hilang di ${CONFIRM_AFTER} snapshot berturut-turut`, 'data-ostat="confirmed"') +
      card('is-pending', 'ti-hourglass', 'Menunggu konfirmasi', nPend.toLocaleString('id-ID'), 'belum cukup snapshot', 'data-ostat="pending"') +
      card('is-snap is-' + h.level, 'ti-clock', 'Snapshot sheet terakhir',
        `<span class="orph-stat-time">${h.when}</span>`,
        `<span class="orph-health is-${h.level}">${h.label}</span>${h.ago ? ' · ' + h.ago : ''}`);
  }

  // ---------- baris yang sedang tampil (sesuai section + filter + pencarian) ----------
  function currentRows() {
    const d = st.data;
    switch (st.section) {
      case 'orphan':
        return orphanRows({});
      case 'akd':      return d.akd.filter((r) => matchQ([r.kode_produk, r.nama_produk, r.no_akd]));
      case 'komp':     return d.komp.filter((r) => matchQ([r.kode_set, r.nama_set, r.kode_komponen, r.nama_komponen]));
      case 'tipe':     return d.tipe.filter((r) => matchQ([r.kode_produk, r.nama_produk]));
      default:         return d.nonaktif.filter((r) => matchQ([r.kode_produk, r.nama_produk]));
    }
  }
  // baris orphan sesuai pencarian + 3 filter; `over` meniadakan satu filter (dipakai untuk hitungan chip)
  function orphanRows(over) {
    const f = Object.assign({ status: st.fStatus, asal: st.fAsal, tipe: st.fTipe }, over);
    return st.data.orphan.filter((r) => matchQ([r.kode_produk, r.nama_produk])
      && (f.status === 'all' || r.status === f.status)
      && (f.tipe === 'all' || r.tipe === f.tipe)
      && (f.asal === 'all' || (f.asal === 'dihapus' ? r.pernah_di_sheet : !r.pernah_di_sheet)));
  }
  // kolom kode utama per section -> untuk "Salin kode"
  const KODE_KEY = { orphan: 'kode_produk', akd: 'kode_produk', komp: 'kode_set', tipe: 'kode_produk', nonaktif: 'kode_produk' };

  // ---------- render ----------
  function render() {
    const body = $('orphanBody');
    if (!body || st.missingBackend) return;
    $('orphanSectionBar').innerHTML = SECTIONS.map((s) =>
      `<button class="orph-tab${st.section === s.id ? ' active' : ''}" data-osec="${s.id}" title="${esc(s.hint)}"><i class="ti ${s.icon}"></i><span>${s.label}</span><span class="orph-tab-count${st.data[s.id].length ? '' : ' zero'}">${st.data[s.id].length.toLocaleString('id-ID')}</span></button>`).join('');
    $('orphanRunInfo').innerHTML = runBanner();
    renderStats();
    renderFilters();
    renderQuick();
    const rows = currentRows();
    const R = { orphan: rOrphan, akd: rAkd, komp: rKomp, tipe: rTipe, nonaktif: rNonaktif }[st.section];
    const { head, trs, count, empty, cols } = R(rows);
    $('orphanCount').textContent = count;

    const totalPages = Math.max(1, Math.ceil(trs.length / PAGE_SIZE));
    if (st.page > totalPages) st.page = totalPages;
    const slice = trs.slice((st.page - 1) * PAGE_SIZE, st.page * PAGE_SIZE);
    // satu area scroll saja (.vbody di markup); tabel tidak lagi punya kotak scroll sendiri
    body.innerHTML = `<div class="table-card"><table class="orph-table"><thead><tr>${head}</tr></thead><tbody>${
      slice.length ? slice.join('') : `<tr class="state-row"><td colspan="${cols}">${emptyState(empty)}</td></tr>`}</tbody></table></div>`;
    renderPgBar($('orphanPagination'), { page: st.page, pageSize: PAGE_SIZE, total: trs.length, onPageChange: (p) => { st.page = p; render(); } });
    syncSelUi(rows);
  }

  // checkbox "pilih semua" + bar aksi massal (hanya section orphan)
  function syncSelUi(rows) {
    const bar = $('orphanBulkBar');
    const n = st.section === 'orphan' ? st.sel.size : 0;
    bar.style.display = n ? 'flex' : 'none';
    $('orphanBulkInfo').innerHTML = `<b>${st.sel.size.toLocaleString('id-ID')}</b> produk dipilih`;
    const blocked = deleteBlockedReason();
    const delBtn = $('orphanBulkDelete');
    delBtn.disabled = !!blocked;
    delBtn.title = blocked || 'Periksa lalu hapus produk terpilih (server memeriksa ulang sebelum menghapus)';
    const all = $('orphanSelAll');
    if (all && st.section === 'orphan') {
      const inView = rows.filter((r) => st.sel.has(r.kode_produk)).length;
      all.checked = rows.length > 0 && inView === rows.length;
      all.indeterminate = inView > 0 && inView < rows.length;
    }
  }

  function renderFilters() {
    const fb = $('orphanFilterBar');
    if (st.section !== 'orphan') { fb.innerHTML = ''; fb.style.display = 'none'; return; }
    fb.style.display = '';
    const cnt = (over) => orphanRows(over).length;
    const seg = (label, attr, cur, items) =>
      `<div class="orph-fgroup"><span class="orph-flabel">${label}</span><div class="orph-seg">${items.map(([v, html, n, title]) =>
        `<button class="${cur === v ? 'active' : ''}" ${attr}="${v}" title="${esc(title || '')}">${html}<span class="fc-count">${n.toLocaleString('id-ID')}</span></button>`).join('')}</div></div>`;
    fb.innerHTML =
      seg('Status', 'data-ost', st.fStatus, [
        ['all', 'Semua', cnt({ status: 'all' })],
        ['confirmed', '<i class="ti ti-circle-check"></i> Terkonfirmasi', cnt({ status: 'confirmed' }), `Hilang di ${CONFIRM_AFTER} snapshot berturut-turut`],
        ['pending', '<i class="ti ti-hourglass"></i> Menunggu', cnt({ status: 'pending' }), 'Belum cukup snapshot berturut-turut'],
      ]) +
      seg('Asal', 'data-oas', st.fAsal, [
        ['all', 'Semua', cnt({ asal: 'all' })],
        ['dihapus', '<i class="ti ti-trash-x"></i> Dihapus dari sheet', cnt({ asal: 'dihapus' }), 'Pernah terpantau di sheet lalu hilang: paling perlu ditindaklanjuti'],
        ['legacy', '<i class="ti ti-history"></i> Tak pernah di sheet', cnt({ asal: 'legacy' }), 'Tidak pernah terpantau di sheet (kemungkinan dibuat dari sumber lain)'],
      ]) +
      seg('Tipe', 'data-otp', st.fTipe, [
        ['all', 'Semua', cnt({ tipe: 'all' })],
        ['UNIT', 'Unit', cnt({ tipe: 'UNIT' })],
        ['INSTRUMENT', 'Instrument', cnt({ tipe: 'INSTRUMENT' })],
        ['SET', 'Set', cnt({ tipe: 'SET' })],
      ]);
  }

  const tipeBadge = (t) => `<span class="badge badge-${esc(String(t || '').toLowerCase())}">${esc(t || '-')}</span>`;
  function relDay(d) {
    const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
    return days <= 0 ? 'hari ini' : days === 1 ? 'kemarin' : `${days} hari lalu`;
  }

  function rOrphan(rows) {
    const trs = rows.map((r) => {
      const rename = (r.rename_candidates || []).map((c) => `<div class="orph-rename"><i class="ti ti-arrows-exchange"></i> mungkin di-rename di sheet jadi <b>${esc(c.kode_baru)}</b> (${esc(c.alasan)})</div>`).join('');
      const notes = [];
      if (r.n_dipakai_set) notes.push(`jadi komponen di ${r.n_dipakai_set} set`);
      if (r.n_komposisi) notes.push(`punya ${r.n_komposisi} item komposisi`);
      if (r.n_inaproc) notes.push(`${r.n_inaproc} riwayat pengajuan INAPROC`);
      const n = Math.min(Number(r.missing_runs) || 0, CONFIRM_AFTER);
      // Progres konfirmasi = teks "n/3" (kebaca langsung), bukan deretan titik yang harus dihitung mata.
      const status = r.status === 'confirmed'
        ? `<span class="orph-status is-confirmed" title="Hilang di ${CONFIRM_AFTER} snapshot berturut-turut">Terkonfirmasi</span>`
        : `<span class="orph-status is-pending" title="${n} dari ${CONFIRM_AFTER} snapshot. Belum cukup berturut-turut; mungkin sheet sempat loading">Menunggu <span class="orph-n">${n}/${CONFIRM_AFTER}</span></span>`;
      const asal = r.pernah_di_sheet
        ? '<span class="orph-asal is-deleted" title="Pernah terpantau di sheet, sekarang hilang"><i class="ti ti-trash-x"></i> Dihapus dari sheet</span>'
        : '<span class="orph-asal" title="Tak pernah terpantau di sheet (kemungkinan dibuat dari sumber lain)"><i class="ti ti-history"></i> Tak pernah di sheet</span>';
      const kode = esc(r.kode_produk);
      return `<tr>
        <td class="orph-chk"><input type="checkbox" data-osel="${kode}" aria-label="Pilih ${kode}"${st.sel.has(r.kode_produk) ? ' checked' : ''}/></td>
        <td class="kode-cell orph-kode"><div class="orph-kode-row"><span>${kode}</span><button class="orph-copy" type="button" data-ocopy="${kode}" title="Salin kode" aria-label="Salin kode ${kode}"><i class="ti ti-copy"></i></button></div><div>${tipeBadge(r.tipe)}</div></td>
        <td class="orph-nama"><div class="orph-nama-main">${r.nama_produk ? esc(r.nama_produk) : '<span class="orph-muted">(tanpa nama)</span>'}</div>
          ${notes.length ? `<div class="orph-note">${esc(notes.join(' · '))}</div>` : ''}${rename}</td>
        <td class="orph-asal-cell">${asal}</td>
        <td class="orph-when"><div>${fmtDate(r.first_missing_at)}</div><div class="orph-note">${relDay(r.first_missing_at)}</div></td>
        <td>${status}</td></tr>`;
    });
    return { head: '<th class="orph-chk"><input type="checkbox" id="orphanSelAll" title="Pilih semua hasil filter (semua halaman)" aria-label="Pilih semua hasil filter"/></th><th>Kode Produk</th><th>Nama / Keterangan</th><th>Asal</th><th>Hilang sejak</th><th>Status</th>', trs, cols: 6,
      count: `${rows.length.toLocaleString('id-ID')} dari ${st.data.orphan.length.toLocaleString('id-ID')} produk aktif di DB yang tidak ditemukan di sheet`,
      empty: 'Semua produk aktif di DB ada di sheet.' };
  }
  function rAkd(rows) {
    return { head: '<th>Kode Produk</th><th>Nama</th><th>No AKD (ada di DB, tidak di baris sheet)</th><th>Primary</th>', cols: 4,
      trs: rows.map((r) => `<tr><td class="kode-cell">${esc(r.kode_produk)}</td><td class="orph-wrap">${esc(r.nama_produk)}</td><td>${esc(r.no_akd)}</td><td>${r.is_primary ? 'ya' : ''}</td></tr>`),
      count: `${rows.length} relasi produk↔AKD ada di DB tapi tidak ada di baris sheet-nya`, empty: 'Semua relasi AKD di DB sama dengan sheet.' };
  }
  function rKomp(rows) {
    return { head: '<th>Set</th><th>Komponen (ada di DB, tidak di sheet)</th><th class="num">Qty</th><th>Keterangan</th>', cols: 4,
      trs: rows.map((r) => `<tr><td class="orph-wrap"><b>${esc(r.kode_set)}</b><div class="orph-note">${esc(r.nama_set)}</div></td>
        <td class="orph-wrap"><b>${esc(r.kode_komponen)}</b><div class="orph-note">${esc(r.nama_komponen)}</div></td>
        <td class="num">${esc(r.qty)}</td><td class="orph-wrap orph-small">${esc(r.alasan)}</td></tr>`),
      count: `${rows.length} item komposisi ada di DB tapi tidak ada di RINCIAN SET`, empty: 'Semua komposisi set di DB sama dengan sheet.' };
  }
  function rTipe(rows) {
    return { head: '<th>Kode Produk</th><th>Nama</th><th>Tipe di DB</th><th>Tipe di sheet</th>', cols: 4,
      trs: rows.map((r) => `<tr><td class="kode-cell">${esc(r.kode_produk)}</td><td class="orph-wrap">${esc(r.nama_produk)}</td><td><span class="tipe-chip">${esc(r.tipe_db)}</span></td><td><span class="tipe-chip">${esc(r.tipe_sheet)}</span></td></tr>`),
      count: `${rows.length} produk bertipe beda antara DB dan sheet`, empty: 'Tipe produk di DB dan sheet sama.' };
  }
  function rNonaktif(rows) {
    return { head: '<th>Kode Produk</th><th>Nama</th><th>Tipe</th>', cols: 3,
      trs: rows.map((r) => `<tr><td class="kode-cell">${esc(r.kode_produk)}</td><td class="orph-wrap">${esc(r.nama_produk)}</td><td><span class="tipe-chip">${esc(r.tipe)}</span></td></tr>`),
      count: `${rows.length} produk nonaktif di DB tapi kodenya ada di sheet`, empty: 'Tidak ada produk nonaktif yang masih tercantum di sheet.' };
  }

  // ---------- ekspor (read-only): salin kode / unduh CSV dari hasil yang sedang tampil ----------
  const exportRows = (onlySel) => (onlySel && st.sel.size ? st.data.orphan.filter((r) => st.sel.has(r.kode_produk)) : currentRows());
  async function copyKodes(onlySel) {
    const key = KODE_KEY[st.section];
    const kodes = [...new Set(exportRows(onlySel === true).map((r) => r[key]).filter(Boolean))];
    if (!kodes.length) { showToast('Tidak ada kode untuk disalin', true); return; }
    try { await navigator.clipboard.writeText(kodes.join('\n')); showToast(`${kodes.length} kode disalin`); }
    catch { showToast('Gagal menyalin ke clipboard', true); }
  }
  function downloadCsv(onlySel) {
    const rows = exportRows(onlySel === true);
    if (!rows.length) { showToast('Tidak ada data untuk diunduh', true); return; }
    const cols = Object.keys(rows[0]).filter((c) => typeof rows[0][c] !== 'object' || rows[0][c] === null);
    const cell = (v) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const csv = [cols.join(',')].concat(rows.map((r) => cols.map((c) => cell(r[c])).join(','))).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `orphan-drift_${st.section}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }


  // =====================================================================
  // QUICK ACTION: pilih cepat + hapus massal (hanya section "Hilang di sheet")
  // =====================================================================
  const CHUNK_PREVIEW = 200, CHUNK_EXEC = 100;

  // Tombol hapus hanya hidup kalau snapshot sehat. Server menegakkan aturan yang sama (RUN_SUSPECT / RUN_STALE).
  function deleteBlockedReason() {
    if (!st.run) return 'Belum ada snapshot sheet';
    if (st.run.status !== 'committed') return 'Snapshot terakhir bermasalah, penghapusan dinonaktifkan';
    const ageH = (Date.now() - new Date(st.run.finished_at).getTime()) / 3600000;
    if (ageH > 3) return `Snapshot sudah ${Math.floor(ageH)} jam, penghapusan dinonaktifkan sampai snapshot baru masuk`;
    return '';
  }
  // Prafilter di browser = cermin aturan server (hanya untuk pilih cepat; server tetap memutuskan).
  // n_permintaan / n_konversi tidak ada di view, jadi yang itu baru ketahuan saat pratinjau.
  const isSafe = (r) => r.status === 'confirmed' && r.pernah_di_sheet
    && !(r.rename_candidates || []).length && !Number(r.n_inaproc) && !Number(r.n_dipakai_set);

  function renderQuick() {
    const q = $('orphanQuick');
    if (!q) return;
    if (st.section !== 'orphan') { q.innerHTML = ''; q.style.display = 'none'; return; }
    q.style.display = '';
    const rows = orphanRows({});
    const nSafe = rows.filter(isSafe).length;
    const nConf = rows.filter((r) => r.status === 'confirmed').length;
    q.innerHTML = `<span class="orph-quick-label"><i class="ti ti-bolt"></i> Quick action</span>
      <button class="btn btn-sm" type="button" data-oq="safe"${nSafe ? '' : ' disabled'} title="Terkonfirmasi, pernah ada di sheet lalu dihapus, tidak ada kandidat rename, tanpa riwayat INAPROC, bukan komponen set lain">
        <i class="ti ti-shield-check"></i> Pilih yang aman dihapus <span class="fc-count">${nSafe.toLocaleString('id-ID')}</span></button>
      <button class="btn btn-sm" type="button" data-oq="confirmed"${nConf ? '' : ' disabled'} title="Semua yang terkonfirmasi pada hasil filter saat ini (pratinjau tetap memeriksa riwayat satu per satu)">
        <i class="ti ti-checks"></i> Pilih semua terkonfirmasi <span class="fc-count">${nConf.toLocaleString('id-ID')}</span></button>`;
  }

  const KODE_RE = /^[^\s]+$/;
  const chunk = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };

  function friendlyRpcError(err) {
    const m = String((err && err.message) || err || '');
    if (/Could not find the function|PGRST202|does not exist/i.test(m) && /orphan_bulk_delete/i.test(m))
      return 'Fungsi hapus massal belum terpasang. Jalankan sql/02_orphan_bulk_delete.sql di Supabase SQL Editor.';
    const code = (m.match(/RUN_(NONE|SUSPECT|STALE|CHANGED)/) || [])[0];
    if (code === 'RUN_CHANGED') return 'Snapshot sheet sudah berganti sejak halaman dimuat. Tidak ada yang dihapus: muat ulang, lalu pilih lagi.';
    if (code) return m.replace(/^.*?RUN_\w+:\s*/, '').split('\n')[0];
    return m;
  }

  async function callBulk(kodes, dry, size) {
    const out = [];
    for (const part of chunk(kodes, size)) {
      const { data, error } = await S.sb.rpc('orphan_bulk_delete', {
        p_kodes: part, p_run_id: String(st.run.run_id), p_dry_run: dry,
        p_include_legacy: st.del.opt.legacy, p_detach_sets: st.del.opt.detach,
      });
      if (error) return { error, results: out };
      out.push(...((data && data.results) || []));
    }
    return { results: out };
  }

  const dEl = {
    ov: () => $('orphDelOverlay'), title: () => $('orphDelTitle'), body: () => $('orphDelBody'), act: () => $('orphDelActions'),
  };
  function dOpen() { dEl.ov().classList.add('open'); }
  function dClose() { if (st.del.busy) return; dEl.ov().classList.remove('open'); }
  function dSetActions(html) { dEl.act().innerHTML = html; }

  function groupBy(rows, fn) {
    const m = new Map();
    rows.forEach((r) => { const k = fn(r); (m.get(k) || m.set(k, []).get(k)).push(r); });
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }
  const listKodes = (rows, max) => rows.slice(0, max).map((r) => esc(r.kode_produk)).join(', ')
    + (rows.length > max ? ` …dan ${(rows.length - max).toLocaleString('id-ID')} lainnya` : '');

  function dCsv(rows, name) {
    const cols = ['kode_produk', 'nama_produk', 'tipe', 'outcome', 'reason'];
    const cell = (v) => { const t = v == null ? '' : String(v); return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
    const csv = [cols.join(',')].concat(rows.map((r) => cols.map((c) => cell(r[c])).join(','))).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `${name}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function openDelete() {
    if (st.del.busy) return;
    const why = deleteBlockedReason();
    if (why) { showToast(why, true); return; }
    const kodes = [...st.sel].filter((k) => KODE_RE.test(k));
    if (!kodes.length) { showToast('Belum ada produk dipilih', true); return; }
    st.del.typed = '';
    dEl.title().textContent = 'Hapus produk orphan';
    dOpen();
    await runPreview(kodes);
  }

  async function runPreview(kodes) {
    st.del.busy = true;
    dEl.body().innerHTML = `<p class="orph-del-lead"><span class="orph-spin"></span> Memeriksa ${kodes.length.toLocaleString('id-ID')} produk terhadap snapshot terbaru…</p>`;
    dSetActions('<button class="btn btn-ghost" type="button" disabled>Batal</button>');
    const res = await callBulk(kodes, true, CHUNK_PREVIEW);
    st.del.busy = false;
    if (res.error) {
      dEl.body().innerHTML = `<div class="orph-alert"><i class="ti ti-alert-triangle"></i><div>${esc(friendlyRpcError(res.error))}</div></div>`;
      dSetActions('<button class="btn btn-ghost" type="button" data-od="close">Tutup</button><button class="btn" type="button" data-od="reload"><i class="ti ti-refresh"></i> Muat ulang data</button>');
      return;
    }
    st.del.preview = res.results;
    renderPreview();
  }

  function renderPreview() {
    const rows = st.del.preview;
    const ok = rows.filter((r) => r.outcome === 'can_delete');
    const blocked = rows.filter((r) => r.outcome !== 'can_delete');
    const sum = (k) => ok.reduce((a, r) => a + (Number((r.notes || {})[k]) || 0), 0);
    const cascade = [['harga', 'baris harga'], ['media', 'media'], ['akd', 'relasi AKD'], ['komposisi', 'item komposisi set']]
      .map(([k, l]) => [sum(k), l]).filter(([n]) => n).map(([n, l]) => `${n.toLocaleString('id-ID')} ${l}`);
    const detachN = ok.reduce((a, r) => a + (Number((r.notes || {}).dipakai_di_set) || 0), 0);
    const groups = groupBy(blocked, (r) => (r.reason || r.outcome).replace(/\d+/g, 'N'));
    const typed = st.del.typed.trim().toUpperCase() === 'HAPUS';

    dEl.body().innerHTML = `
      <p class="orph-del-lead"><b>${ok.length.toLocaleString('id-ID')}</b> produk lolos pemeriksaan server dan siap dihapus${
        blocked.length ? `, <b>${blocked.length.toLocaleString('id-ID')}</b> ditahan` : ''}.</p>
      <div class="orph-del-opts">
        <label><input type="checkbox" data-oopt="legacy"${st.del.opt.legacy ? ' checked' : ''}/> Sertakan yang <b>tak pernah terpantau di sheet</b> <span class="orph-note">(bisa jadi dibuat langsung di app)</span></label>
        <label><input type="checkbox" data-oopt="detach"${st.del.opt.detach ? ' checked' : ''}/> Lepas dulu dari <b>komposisi set lain</b> <span class="orph-note">(set itu berkurang satu item)</span></label>
      </div>
      ${ok.length ? `<div class="orph-del-box"><div class="orph-del-h"><i class="ti ti-trash"></i> Akan dihapus</div>
        <div class="orph-del-list">${listKodes(ok, 12)}</div>
        ${cascade.length ? `<div class="orph-note">Ikut terhapus otomatis: ${cascade.join(', ')}.</div>` : ''}
        ${st.del.opt.detach && detachN ? `<div class="orph-note">${detachN.toLocaleString('id-ID')} relasi komponen di set lain dilepas.</div>` : ''}</div>` : ''}
      ${blocked.length ? `<details class="orph-del-box is-held"><summary><i class="ti ti-hand-stop"></i> Ditahan, tidak akan dihapus (${blocked.length.toLocaleString('id-ID')})</summary>
        ${groups.map(([k, rs]) => `<div class="orph-del-grp"><div class="orph-del-reason">${esc(rs[0].reason || rs[0].outcome)}${rs.length > 1 ? ` <span class="fc-count">${rs.length}</span>` : ''}</div><div class="orph-note">${listKodes(rs, 8)}</div></div>`).join('')}</details>` : ''}
      <p class="orph-note orph-del-safe"><i class="ti ti-archive"></i> Isi produk dan data turunannya dicadangkan ke tabel <code>sync_orphan_delete_log</code> sebelum dihapus.</p>
      ${ok.length ? `<label class="orph-del-confirm">Ketik <b>HAPUS</b> untuk melanjutkan
        <input type="text" id="orphDelTyped" autocomplete="off" spellcheck="false" value="${esc(st.del.typed)}" placeholder="HAPUS"/></label>` : ''}`;
    dSetActions(`<button class="btn btn-ghost" type="button" data-od="close">Batal</button>
      <button class="btn" type="button" data-od="csv"><i class="ti ti-download"></i> Unduh pratinjau</button>
      <button class="btn btn-danger-ghost" type="button" id="orphDelGo" data-od="go"${ok.length && typed ? '' : ' disabled'}><i class="ti ti-trash"></i> Hapus ${ok.length.toLocaleString('id-ID')} produk</button>`);
  }

  async function runDelete() {
    const kodes = st.del.preview.filter((r) => r.outcome === 'can_delete').map((r) => r.kode_produk);
    if (!kodes.length || st.del.busy) return;
    const why = deleteBlockedReason();
    if (why) { showToast(why, true); return; }
    st.del.busy = true;
    dEl.title().textContent = 'Menghapus…';
    dSetActions('<button class="btn btn-ghost" type="button" disabled>Mohon tunggu</button>');
    const done = [];
    let fatal = null;
    for (const [i, part] of chunk(kodes, CHUNK_EXEC).entries()) {
      dEl.body().innerHTML = `<p class="orph-del-lead"><span class="orph-spin"></span> Menghapus… ${(i * CHUNK_EXEC).toLocaleString('id-ID')} / ${kodes.length.toLocaleString('id-ID')}</p>
        <div class="orph-del-bar"><span style="width:${Math.round((i * CHUNK_EXEC) / kodes.length * 100)}%"></span></div>`;
      const { data, error } = await S.sb.rpc('orphan_bulk_delete', {
        p_kodes: part, p_run_id: String(st.run.run_id), p_dry_run: false,
        p_include_legacy: st.del.opt.legacy, p_detach_sets: st.del.opt.detach,
      });
      if (error) { fatal = error; break; }
      done.push(...((data && data.results) || []));
    }
    st.del.busy = false;
    const deleted = done.filter((r) => r.outcome === 'deleted');
    const rest = done.filter((r) => r.outcome !== 'deleted');
    const notReached = kodes.length - done.length;
    deleted.forEach((r) => st.sel.delete(r.kode_produk));
    dEl.title().textContent = fatal ? 'Berhenti di tengah jalan' : 'Selesai';
    dEl.body().innerHTML = `
      <p class="orph-del-lead"><b>${deleted.length.toLocaleString('id-ID')}</b> produk berhasil dihapus${
        rest.length ? `, <b>${rest.length.toLocaleString('id-ID')}</b> tidak jadi dihapus` : ''}.</p>
      ${fatal ? `<div class="orph-alert"><i class="ti ti-alert-triangle"></i><div>${esc(friendlyRpcError(fatal))}${notReached ? ` ${notReached.toLocaleString('id-ID')} produk belum diproses.` : ''}</div></div>` : ''}
      ${rest.length ? `<details class="orph-del-box is-held" open><summary><i class="ti ti-hand-stop"></i> Tidak jadi dihapus</summary>
        ${groupBy(rest, (r) => (r.reason || r.outcome).replace(/\d+/g, 'N')).map(([k, rs]) => `<div class="orph-del-grp"><div class="orph-del-reason">${esc(rs[0].reason || rs[0].outcome)}${rs.length > 1 ? ` <span class="fc-count">${rs.length}</span>` : ''}</div><div class="orph-note">${listKodes(rs, 8)}</div></div>`).join('')}</details>` : ''}`;
    st.del.preview = done;
    dSetActions(`${done.length ? '<button class="btn" type="button" data-od="csvdone"><i class="ti ti-download"></i> Unduh hasil</button>' : ''}
      <button class="btn btn-accent" type="button" data-od="finish">Tutup</button>`);
    if (deleted.length) {
      try { S.invalidateProdukStackCache && S.invalidateProdukStackCache(); S.loadProduk && S.loadProduk(); S.refreshProdukFilterCounts && S.refreshProdukFilterCounts(true); } catch { /* daftar Produk akan menyegarkan sendiri saat dibuka */ }
    }
  }

  function wireDelete() {
    if (!$('orphDelOverlay')) return;
    $('orphanBulkDelete').addEventListener('click', openDelete);
    $('orphanQuick').addEventListener('click', (e) => {
      const b = e.target.closest('[data-oq]');
      if (!b || b.disabled) return;
      const rows = orphanRows({}).filter(b.getAttribute('data-oq') === 'safe' ? isSafe : (r) => r.status === 'confirmed');
      rows.forEach((r) => st.sel.add(r.kode_produk));
      render();
      showToast(`${rows.length.toLocaleString('id-ID')} produk dipilih. Cek lalu klik "Hapus terpilih…"`);
    });
    const ov = $('orphDelOverlay');
    ov.addEventListener('click', async (e) => {
      if (e.target === ov) { dClose(); return; }
      const a = e.target.closest('[data-od]');
      if (!a || a.disabled) return;
      const act = a.getAttribute('data-od');
      if (act === 'close') dClose();
      else if (act === 'csv') dCsv(st.del.preview, 'orphan-pratinjau-hapus');
      else if (act === 'csvdone') dCsv(st.del.preview, 'orphan-hasil-hapus');
      else if (act === 'go') runDelete();
      else if (act === 'reload') { dClose(); load(true); }
      else if (act === 'finish') { dClose(); st.loadedRunId = null; await load(true); }
    });
    ov.addEventListener('change', (e) => {
      const o = e.target.closest('[data-oopt]');
      if (!o) return;
      st.del.opt[o.getAttribute('data-oopt')] = o.checked;
      st.del.typed = '';
      runPreview([...st.sel].filter((k) => KODE_RE.test(k)));
    });
    ov.addEventListener('input', (e) => {
      if (e.target.id !== 'orphDelTyped') return;
      st.del.typed = e.target.value;
      const go = $('orphDelGo');
      if (go) go.disabled = st.del.typed.trim().toUpperCase() !== 'HAPUS' || !st.del.preview.some((r) => r.outcome === 'can_delete');
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ov.classList.contains('open')) dClose(); });
  }

  (function wire() {
    if (!$('orphanBody')) return;
    const attr = (e, a) => e.target.closest('[' + a + ']');
    const onBar = (e) => {
      const sec = attr(e, 'data-osec'), ost = attr(e, 'data-ost'), oas = attr(e, 'data-oas'), otp = attr(e, 'data-otp');
      if (sec) st.section = sec.getAttribute('data-osec');
      else if (ost) st.fStatus = ost.getAttribute('data-ost');
      else if (oas) st.fAsal = oas.getAttribute('data-oas');
      else if (otp) st.fTipe = otp.getAttribute('data-otp');
      else return;
      st.page = 1; render();
    };
    $('orphanSectionBar').addEventListener('click', onBar);
    $('orphanFilterBar').addEventListener('click', onBar);
    // kartu statistik = pintasan filter status
    $('orphanStats').addEventListener('click', (e) => {
      const c = attr(e, 'data-ostat');
      if (!c) return;
      st.section = 'orphan'; st.fStatus = c.getAttribute('data-ostat'); st.page = 1; render();
    });
    // salin 1 kode / checkbox baris / pilih semua (delegasi di body tabel)
    $('orphanBody').addEventListener('click', async (e) => {
      if (attr(e, 'data-oreset')) {
        st.q = ''; st.fStatus = st.fAsal = st.fTipe = 'all'; st.page = 1;
        $('orphanSearchInput').value = '';
        render();
        return;
      }
      const cp = attr(e, 'data-ocopy');
      if (!cp) return;
      try { await navigator.clipboard.writeText(cp.getAttribute('data-ocopy')); showToast('Kode disalin'); }
      catch { showToast('Gagal menyalin ke clipboard', true); }
    });
    $('orphanBody').addEventListener('change', (e) => {
      const one = e.target.closest('[data-osel]');
      if (one) {
        const k = one.getAttribute('data-osel');
        one.checked ? st.sel.add(k) : st.sel.delete(k);
        syncSelUi(currentRows());
      } else if (e.target.id === 'orphanSelAll') {
        const rows = currentRows();
        rows.forEach((r) => (e.target.checked ? st.sel.add(r.kode_produk) : st.sel.delete(r.kode_produk)));
        render();
      }
    });
    let deb = null;
    $('orphanSearchInput').addEventListener('input', (e) => { clearTimeout(deb); deb = setTimeout(() => { st.q = e.target.value; st.page = 1; render(); }, 250); });
    $('orphanRefreshBtn').addEventListener('click', () => load(true));
    $('orphanCopyBtn').addEventListener('click', () => copyKodes(false));
    $('orphanCsvBtn').addEventListener('click', () => downloadCsv(false));
    $('orphanBulkCopy').addEventListener('click', () => copyKodes(true));
    $('orphanBulkCsv').addEventListener('click', () => downloadCsv(true));
    $('orphanBulkClear').addEventListener('click', () => { st.sel.clear(); render(); });
  })();

  wireDelete();
  S.loadOrphan = () => load(false);
}