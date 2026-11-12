// Tab "Orphan / Drift" -- arah SEBALIKNYA dari tab "Sync dari Sheet", dan sifatnya INFORMASI SAJA:
// "item ini ada di Supabase tapi di sheet sudah tidak ada".
// Tidak ada tombol hapus / nonaktifkan / ubah apa pun di sini -- tab ini hanya membaca.
// Sumber: view v_sync_* + sync_orphan_produk (diisi pushManifest di Apps Script ->
// edge function sync-sheet type 'manifest' -> RPC reverse_check_commit).
// Yang disediakan: lihat, cari, filter, salin daftar kode, unduh CSV (buat dicek manual di sheet).
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

  S.loadOrphan = () => load(false);
}