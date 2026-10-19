// Tab "Orphan / Drift" -- arah SEBALIKNYA dari tab "Sync dari Sheet", dan sifatnya INFORMASI SAJA:
// "item ini ada di Supabase tapi di sheet sudah tidak ada".
// Tidak ada tombol hapus / nonaktifkan / ubah apa pun di sini -- tab ini hanya membaca.
// Sumber: view v_sync_* + sync_orphan_produk (diisi pushManifest di Apps Script ->
// edge function sync-sheet type 'manifest' -> RPC reverse_check_commit).
// Yang disediakan: lihat, cari, filter, salin daftar kode, unduh CSV (buat dicek manual di sheet).
import { showToast, renderPgBar } from './ui-utils.js';

export function installOrphan(S) {
  const PAGE_SIZE = 25;
  const SECTIONS = [
    { id: 'orphan',   label: 'Ada di DB, hilang di sheet', icon: 'ti-ghost-2' },
    { id: 'akd',      label: 'Relasi AKD tak ada di sheet', icon: 'ti-shield-off' },
    { id: 'komp',     label: 'Komposisi set tak ada di sheet', icon: 'ti-stack-2' },
    { id: 'tipe',     label: 'Tipe beda',                  icon: 'ti-arrows-diff' },
    { id: 'nonaktif', label: 'Nonaktif tapi ada di sheet', icon: 'ti-eye-off' },
  ];
  const SOURCES = {
    orphan: 'v_sync_orphan_detail', akd: 'v_sync_akd_drift', komp: 'v_sync_setkomp_drift',
    tipe: 'v_sync_tipe_mismatch', nonaktif: 'v_sync_inactive_in_sheet',
  };
  const st = {
    section: 'orphan', page: 1, q: '', fStatus: 'confirmed', fAsal: 'all',
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

  async function load() {
    const body = $('orphanBody');
    if (!body) return;
    body.innerHTML = '<div class="state-row" style="padding:24px;">Memuat data...</div>';
    const runRes = await S.sb.from('sync_manifest_run').select('run_id, finished_at, status, note')
      .in('status', ['committed', 'suspect']).order('finished_at', { ascending: false }).limit(1);
    if (runRes.error) {
      st.missingBackend = true;
      body.innerHTML = `<div class="state-row" style="padding:24px;">Backend reverse-check belum terpasang (${esc(runRes.error.message)}). Jalankan <code>reverse_check.sql</code>, deploy edge function, lalu jalankan <code>pushManifest()</code> sekali di Apps Script.</div>`;
      $('orphanCount').textContent = 'Belum aktif';
      return;
    }
    st.missingBackend = false;
    st.run = (runRes.data || [])[0] || null;
    const keys = Object.keys(SOURCES);
    const results = await Promise.all(keys.map((k) => fetchAll(SOURCES[k])));
    keys.forEach((k, i) => { st.data[k] = results[i].error ? [] : results[i].data; });
    const firstErr = results.find((r) => r.error);
    if (firstErr) showToast('Sebagian data gagal dimuat: ' + firstErr.error.message, true);
    render();
  }

  // ---------- util ----------
  const chip = (attr, val, active, html, count) =>
    `<button class="filter-chip${active ? ' active' : ''}" ${attr}="${val}">${html}${count != null ? `<span class="fc-count">${count}</span>` : ''}</button>`;
  const matchQ = (vals) => { const q = st.q.trim().toLowerCase(); return !q || vals.some((v) => v && String(v).toLowerCase().includes(q)); };

  function runBanner() {
    if (!st.run) return '<div class="paste-hint" style="color:var(--warn-text,#b45309);"><i class="ti ti-alert-triangle"></i> Belum ada snapshot sheet. Jalankan <code>pushManifest()</code> di Apps Script.</div>';
    const ageH = (Date.now() - new Date(st.run.finished_at).getTime()) / 3600000;
    const when = new Date(st.run.finished_at).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    const warns = [];
    if (st.run.status === 'suspect') warns.push(`Snapshot terakhir bermasalah (${esc(st.run.note || 'sebagian sheet tidak sehat')}). Tipe produk dari sheet itu <b>tidak dinilai</b>.`);
    if (ageH > 3) warns.push(`Snapshot sudah ${Math.floor(ageH)} jam — cek trigger <code>pushManifest</code>.`);
    return `<div class="paste-hint"${warns.length ? ' style="color:var(--warn-text,#b45309);"' : ''}><i class="ti ti-clock"></i> Snapshot sheet terakhir: <b>${when}</b>. ${warns.join(' ')}</div>`;
  }

  // ---------- baris yang sedang tampil (sesuai section + filter + pencarian) ----------
  function currentRows() {
    const d = st.data;
    switch (st.section) {
      case 'orphan':
        return d.orphan.filter((r) => matchQ([r.kode_produk, r.nama_produk])
          && (st.fStatus === 'all' || r.status === st.fStatus)
          && (st.fAsal === 'all' || (st.fAsal === 'dihapus' ? r.pernah_di_sheet : !r.pernah_di_sheet)));
      case 'akd':      return d.akd.filter((r) => matchQ([r.kode_produk, r.nama_produk, r.no_akd]));
      case 'komp':     return d.komp.filter((r) => matchQ([r.kode_set, r.nama_set, r.kode_komponen, r.nama_komponen]));
      case 'tipe':     return d.tipe.filter((r) => matchQ([r.kode_produk, r.nama_produk]));
      default:         return d.nonaktif.filter((r) => matchQ([r.kode_produk, r.nama_produk]));
    }
  }
  // kolom kode utama per section -> untuk "Salin kode"
  const KODE_KEY = { orphan: 'kode_produk', akd: 'kode_produk', komp: 'kode_set', tipe: 'kode_produk', nonaktif: 'kode_produk' };

  // ---------- render ----------
  function render() {
    const body = $('orphanBody');
    if (!body || st.missingBackend) return;
    $('orphanSectionBar').innerHTML = SECTIONS.map((s) =>
      chip('data-osec', s.id, st.section === s.id, `<i class="ti ${s.icon}"></i> ${s.label}`, st.data[s.id].length)).join('');
    $('orphanRunInfo').innerHTML = runBanner();
    renderFilters();
    const rows = currentRows();
    const R = { orphan: rOrphan, akd: rAkd, komp: rKomp, tipe: rTipe, nonaktif: rNonaktif }[st.section];
    const { head, trs, count, empty, cols } = R(rows);
    $('orphanCount').textContent = count;

    const totalPages = Math.max(1, Math.ceil(trs.length / PAGE_SIZE));
    if (st.page > totalPages) st.page = totalPages;
    const slice = trs.slice((st.page - 1) * PAGE_SIZE, st.page * PAGE_SIZE);
    body.innerHTML = `<div class="table-card"><table><thead><tr>${head}</tr></thead><tbody>${
      slice.length ? slice.join('') : `<tr class="state-row"><td colspan="${cols}">${empty}</td></tr>`}</tbody></table></div>`;
    renderPgBar($('orphanPagination'), { page: st.page, pageSize: PAGE_SIZE, total: trs.length, onPageChange: (p) => { st.page = p; render(); } });
  }

  function renderFilters() {
    const fb = $('orphanFilterBar');
    if (st.section !== 'orphan') { fb.innerHTML = ''; fb.style.display = 'none'; return; }
    const all = st.data.orphan, cnt = (f) => all.filter(f).length;
    fb.style.display = '';
    fb.innerHTML =
      chip('data-ost', 'confirmed', st.fStatus === 'confirmed', '<i class="ti ti-circle-check"></i> Terkonfirmasi', cnt((r) => r.status === 'confirmed')) +
      chip('data-ost', 'pending', st.fStatus === 'pending', '<i class="ti ti-hourglass"></i> Menunggu konfirmasi', cnt((r) => r.status === 'pending')) +
      chip('data-ost', 'all', st.fStatus === 'all', 'Semua', all.length) +
      '<span style="width:14px;display:inline-block;"></span>' +
      chip('data-oas', 'all', st.fAsal === 'all', 'Semua asal') +
      chip('data-oas', 'dihapus', st.fAsal === 'dihapus', '<i class="ti ti-trash-x"></i> Pernah di sheet, sekarang hilang', cnt((r) => r.pernah_di_sheet)) +
      chip('data-oas', 'legacy', st.fAsal === 'legacy', '<i class="ti ti-history"></i> Tak pernah terpantau di sheet', cnt((r) => !r.pernah_di_sheet));
  }

  function rOrphan(rows) {
    const trs = rows.map((r) => {
      const rename = (r.rename_candidates || []).map((c) => `<div style="font-size:11px;color:var(--accent);"><i class="ti ti-arrows-exchange"></i> mungkin di-rename di sheet jadi <b>${esc(c.kode_baru)}</b> (${esc(c.alasan)})</div>`).join('');
      const notes = [];
      if (r.n_dipakai_set) notes.push(`jadi komponen di ${r.n_dipakai_set} set`);
      if (r.n_komposisi) notes.push(`punya ${r.n_komposisi} item komposisi`);
      if (r.n_inaproc) notes.push(`${r.n_inaproc} riwayat pengajuan INAPROC`);
      const status = r.status === 'confirmed'
        ? '<span class="tipe-chip" style="color:var(--rust);">terkonfirmasi</span>'
        : `<span class="tipe-chip" title="Belum cukup snapshot berturut-turut; mungkin sheet sempat loading">menunggu (${esc(r.missing_runs)}×)</span>`;
      return `<tr>
        <td class="kode-cell" style="white-space:normal;word-break:break-word;max-width:200px;">${esc(r.kode_produk)}<div><span class="tipe-chip">${esc(r.tipe)}</span></div></td>
        <td style="max-width:420px;white-space:normal;"><div style="font-weight:500;line-height:1.35;">${r.nama_produk ? esc(r.nama_produk) : '<span style="color:var(--text-muted);">(tanpa nama)</span>'}</div>
          ${notes.length ? `<div style="font-size:11px;color:var(--text-muted);">${esc(notes.join(' · '))}</div>` : ''}${rename}</td>
        <td style="white-space:nowrap;font-size:12px;">${r.pernah_di_sheet ? 'pernah di sheet, sekarang hilang' : '<span style="color:var(--text-muted);">tak pernah terpantau di sheet</span>'}</td>
        <td style="white-space:nowrap;font-size:12px;">${fmtDate(r.first_missing_at)}</td>
        <td>${status}</td></tr>`;
    });
    return { head: '<th>Kode Produk</th><th>Nama / Keterangan</th><th>Asal</th><th>Hilang sejak</th><th>Status</th>', trs, cols: 5,
      count: `${rows.length} dari ${st.data.orphan.length} produk aktif di DB yang tidak ditemukan di sheet`,
      empty: 'Tidak ada untuk filter ini 🎉' };
  }
  function rAkd(rows) {
    return { head: '<th>Kode Produk</th><th>Nama</th><th>No AKD (ada di DB, tidak di baris sheet)</th><th>Primary</th>', cols: 4,
      trs: rows.map((r) => `<tr><td class="kode-cell">${esc(r.kode_produk)}</td><td style="white-space:normal;max-width:380px;">${esc(r.nama_produk)}</td><td>${esc(r.no_akd)}</td><td>${r.is_primary ? 'ya' : ''}</td></tr>`),
      count: `${rows.length} relasi produk↔AKD ada di DB tapi tidak ada di baris sheet-nya`, empty: 'Semua relasi AKD sejalan dengan sheet 🎉' };
  }
  function rKomp(rows) {
    return { head: '<th>Set</th><th>Komponen (ada di DB, tidak di sheet)</th><th>Qty</th><th>Keterangan</th>', cols: 4,
      trs: rows.map((r) => `<tr><td style="white-space:normal;max-width:280px;"><b>${esc(r.kode_set)}</b><div style="font-size:11px;color:var(--text-muted);">${esc(r.nama_set)}</div></td>
        <td style="white-space:normal;max-width:320px;"><b>${esc(r.kode_komponen)}</b><div style="font-size:11px;color:var(--text-muted);">${esc(r.nama_komponen)}</div></td>
        <td>${esc(r.qty)}</td><td style="font-size:12px;">${esc(r.alasan)}</td></tr>`),
      count: `${rows.length} item komposisi ada di DB tapi tidak ada di RINCIAN SET`, empty: 'Komposisi DB sejalan dengan sheet 🎉' };
  }
  function rTipe(rows) {
    return { head: '<th>Kode Produk</th><th>Nama</th><th>Tipe di DB</th><th>Tipe di sheet</th>', cols: 4,
      trs: rows.map((r) => `<tr><td class="kode-cell">${esc(r.kode_produk)}</td><td style="white-space:normal;max-width:400px;">${esc(r.nama_produk)}</td><td><span class="tipe-chip">${esc(r.tipe_db)}</span></td><td><span class="tipe-chip">${esc(r.tipe_sheet)}</span></td></tr>`),
      count: `${rows.length} produk bertipe beda antara DB dan sheet`, empty: 'Tidak ada ketidakcocokan tipe 🎉' };
  }
  function rNonaktif(rows) {
    return { head: '<th>Kode Produk</th><th>Nama</th><th>Tipe</th>', cols: 3,
      trs: rows.map((r) => `<tr><td class="kode-cell">${esc(r.kode_produk)}</td><td style="white-space:normal;max-width:420px;">${esc(r.nama_produk)}</td><td><span class="tipe-chip">${esc(r.tipe)}</span></td></tr>`),
      count: `${rows.length} produk nonaktif di DB tapi kodenya ada di sheet`, empty: 'Tidak ada 🎉' };
  }

  // ---------- ekspor (read-only): salin kode / unduh CSV dari hasil yang sedang tampil ----------
  async function copyKodes() {
    const key = KODE_KEY[st.section];
    const kodes = [...new Set(currentRows().map((r) => r[key]).filter(Boolean))];
    if (!kodes.length) { showToast('Tidak ada kode untuk disalin', true); return; }
    try { await navigator.clipboard.writeText(kodes.join('\n')); showToast(`${kodes.length} kode disalin`); }
    catch { showToast('Gagal menyalin ke clipboard', true); }
  }
  function downloadCsv() {
    const rows = currentRows();
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
    const onBar = (e) => {
      const sec = e.target.closest('[data-osec]'), ost = e.target.closest('[data-ost]'), oas = e.target.closest('[data-oas]');
      if (sec) { st.section = sec.getAttribute('data-osec'); }
      else if (ost) { st.fStatus = ost.getAttribute('data-ost'); }
      else if (oas) { st.fAsal = oas.getAttribute('data-oas'); }
      else return;
      st.page = 1; render();
    };
    $('orphanSectionBar').addEventListener('click', onBar);
    $('orphanFilterBar').addEventListener('click', onBar);
    let deb = null;
    $('orphanSearchInput').addEventListener('input', (e) => { clearTimeout(deb); deb = setTimeout(() => { st.q = e.target.value; st.page = 1; render(); }, 250); });
    $('orphanRefreshBtn').addEventListener('click', load);
    $('orphanCopyBtn').addEventListener('click', copyKodes);
    $('orphanCsvBtn').addEventListener('click', downloadCsv);
  })();

  S.loadOrphan = load;
}