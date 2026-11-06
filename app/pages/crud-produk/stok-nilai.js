// Tab "Stok & Nilai" -- stok per produk + nilai (qty x harga EKATALOG), bisa difilter & diexport
// buat tim yang butuh datanya. Read-only. Sumber: view v_stok_nilai (lihat stok_nilai_view.sql).
// Pola sama dengan orphan.js: installStokNilai(S) dipanggil di mount(); S.loadStokNilai() dipanggil
// dari switchView() tiap tab dibuka (stok berubah tiap upload di halaman Stok, jadi selalu muat ulang).
// Semua filter jalan di client dari seluruh baris (ribuan, murah) supaya TOTAL NILAI & export
// selalu sesuai filter yang sedang aktif, bukan cuma halaman yang tampil.
import { showToast, renderPgBar } from './ui-utils.js';

export function installStokNilai(S) {
  const PAGE_SIZE = 50;
  const STATUS = {
    READY: ['ok', 'Siap'],
    INDENT: ['neutral', 'Indent'],
    DATA_TIDAK_LENGKAP: ['warn', 'Data tidak lengkap'],
  };
  const st = { rows: null, loading: false, error: null, page: 1, q: '', fStatus: 'all', fTipe: 'all', fLink: 'all', fNilai: 'all' };
  const $ = (id) => document.getElementById(id);
  const esc = (v) => S.escapeHtml(v == null ? '' : String(v));
  const fmtN = (n) => Number(n || 0).toLocaleString('id-ID');
  const rp = (n) => 'Rp ' + Math.round(Number(n || 0)).toLocaleString('id-ID');
  const safeHref = (u) => (/^https?:\/\//i.test(u || '') ? u : '');

  async function fetchAll() {
    const all = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await S.sb.from('v_stok_nilai')
        .select('produk_id,kode_produk,kode_asli,nama_produk,tipe,golongan,is_active,stok_status,qty_ready,harga_ekatalog,tahun_harga,nilai,ada_link,link_v6')
        .order('kode_produk', { ascending: true }).range(from, from + 999);
      if (error) return { error };
      all.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    return { data: all };
  }

  async function load() {
    if (!$('stokBody')) return;
    st.loading = true; st.error = null; render();
    const res = await fetchAll();
    st.loading = false;
    if (res.error) st.error = res.error; else st.rows = res.data;
    render();
  }

  // Tanpa harga padahal ada stok = nilai tidak ikut terhitung (perlu dilengkapi di tab Produk).
  const tanpaHarga = (r) => Number(r.qty_ready) > 0 && r.harga_ekatalog == null;

  function matches(r, over) {
    const o = Object.assign({ status: st.fStatus, tipe: st.fTipe, link: st.fLink, nilai: st.fNilai, q: st.q }, over || {});
    if (o.status !== 'all' && r.stok_status !== o.status) return false;
    if (o.tipe !== 'all' && r.tipe !== o.tipe) return false;
    if (o.link === 'ada' && !r.ada_link) return false;
    if (o.link === 'belum' && r.ada_link) return false;
    if (o.nilai === 'tanpa_harga' && !tanpaHarga(r)) return false;
    const q = (o.q || '').trim().toLowerCase();
    if (!q) return true;
    return (r.kode_produk || '').toLowerCase().includes(q) || (r.kode_asli || '').toLowerCase().includes(q)
      || (r.nama_produk || '').toLowerCase().includes(q) || (r.golongan || '').toLowerCase().includes(q);
  }
  const currentRows = (over) => (st.rows || []).filter((r) => matches(r, over))
    .sort((a, b) => (Number(b.nilai) || -1) - (Number(a.nilai) || -1) || String(a.kode_produk).localeCompare(String(b.kode_produk)));

  function renderStats(rows) {
    const total = rows.reduce((s, r) => s + (Number(r.nilai) || 0), 0);
    const nSiap = rows.filter((r) => r.stok_status === 'READY').length;
    const nTanpa = rows.filter(tanpaHarga).length;
    const card = (cls, icon, label, val, sub, attr) =>
      `<${attr ? 'button' : 'div'} class="orph-stat ${cls}"${attr ? ' ' + attr : ''}><div class="orph-stat-top"><i class="ti ${icon}"></i><span>${label}</span></div><div class="orph-stat-val">${val}</div><div class="orph-stat-sub">${sub}</div></${attr ? 'button' : 'div'}>`;
    $('stokStats').innerHTML =
      card('is-snap is-ok', 'ti-coin', 'Total nilai (filter aktif)', rp(total), 'qty × harga e-Katalog, tanpa nego') +
      card('', 'ti-packages', 'Produk tampil', fmtN(rows.length), `${fmtN(nSiap)} berstatus Siap`) +
      card('is-pending', 'ti-currency-dollar-off', 'Ada stok, belum ada harga', fmtN(nTanpa), 'nilainya belum terhitung', 'data-sstat="tanpa_harga"') +
      card('', 'ti-link', 'Sudah ada link e-Katalog', fmtN(rows.filter((r) => r.ada_link).length), `${fmtN(rows.filter((r) => !r.ada_link).length)} belum`);
  }

  function renderFilters() {
    const cnt = (over) => (st.rows || []).filter((r) => matches(r, over)).length;
    const seg = (label, attr, cur, items, key) =>
      `<div class="orph-fgroup"><span class="orph-flabel">${label}</span><div class="orph-seg">${items.map(([v, html]) =>
        `<button class="${cur === v ? 'active' : ''}" ${attr}="${v}">${html}<span class="fc-count">${fmtN(cnt(Object.assign({}, { [key]: v }, { nilai: 'all' })))}</span></button>`).join('')}</div></div>`;
    $('stokFilterBar').innerHTML =
      seg('Stok', 'data-sst', st.fStatus, [['all', 'Semua'], ['READY', 'Siap'], ['INDENT', 'Indent'], ['DATA_TIDAK_LENGKAP', 'Data tidak lengkap']], 'status') +
      seg('Tipe', 'data-stp', st.fTipe, [['all', 'Semua'], ['SET', 'Set'], ['INSTRUMENT', 'Instrument'], ['UNIT', 'Unit']], 'tipe') +
      seg('Link e-Katalog', 'data-slk', st.fLink, [['all', 'Semua'], ['ada', 'Sudah ada'], ['belum', 'Belum']], 'link') +
      (st.fNilai === 'tanpa_harga' ? '<div class="orph-fgroup"><button class="btn btn-sm" data-sstat="all"><i class="ti ti-x"></i> Hapus filter "belum ada harga"</button></div>' : '');
  }

  function render() {
    const body = $('stokBody');
    if (!body) return;
    if (st.error) {
      const missing = ['PGRST205', '42P01', '404'].includes(st.error.code);
      body.innerHTML = `<div class="state-row" style="padding:24px;">${missing
        ? 'View belum dibuat. Jalankan <code>stok_nilai_view.sql</code> di Supabase SQL Editor, lalu klik Muat ulang.'
        : 'Gagal memuat: ' + esc(st.error.message)}</div>`;
      $('stokCount').textContent = 'Gagal memuat'; $('stokStats').innerHTML = ''; $('stokFilterBar').innerHTML = '';
      return;
    }
    if (st.loading || !st.rows) {
      body.innerHTML = '<div class="state-row" style="padding:24px;">Memuat data stok…</div>';
      $('stokCount').textContent = 'Memuat...';
      return;
    }
    const rows = currentRows();
    renderStats(rows);
    renderFilters();
    $('stokCount').textContent = `${fmtN(rows.length)} dari ${fmtN(st.rows.length)} produk`;
    const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    if (st.page > totalPages) st.page = totalPages;
    const slice = rows.slice((st.page - 1) * PAGE_SIZE, st.page * PAGE_SIZE);
    const trs = slice.map((r) => {
      const s = STATUS[r.stok_status] || ['neutral', r.stok_status || '-'];
      const href = safeHref(r.link_v6);
      return `<tr>
        <td class="kode-cell">${esc(r.kode_produk)}<div class="orph-note">${esc(r.kode_asli || '')}</div></td>
        <td style="white-space:normal;max-width:340px;">${esc(r.nama_produk || '—')}</td>
        <td><span class="tipe-chip">${esc(r.tipe || '—')}</span></td>
        <td><span class="status-pill ${s[0]}">${esc(s[1])}</span></td>
        <td class="sn-num">${r.qty_ready == null ? '<span class="orph-muted">—</span>' : fmtN(r.qty_ready)}</td>
        <td class="sn-num">${r.harga_ekatalog == null ? '<span class="orph-muted" title="Belum ada harga EKATALOG">—</span>' : rp(r.harga_ekatalog)}</td>
        <td class="sn-num"><b>${r.nilai == null ? '<span class="orph-muted">—</span>' : rp(r.nilai)}</b></td>
        <td>${href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer" title="Buka di e-Katalog"><i class="ti ti-external-link link-yes"></i></a>` : '<i class="ti ti-link-off link-no" title="Belum ada link e-Katalog bersih"></i>'}</td>
      </tr>`;
    });
    body.innerHTML = `<div class="table-card orph-card"><div class="orph-scroll"><table class="orph-table"><thead><tr>
      <th>Kode Produk</th><th>Nama</th><th>Tipe</th><th>Stok</th><th class="sn-num">Qty</th><th class="sn-num">Harga e-Katalog</th><th class="sn-num">Nilai</th><th>Link</th></tr></thead><tbody>${
      trs.length ? trs.join('') : '<tr class="state-row"><td colspan="8"><div class="orph-empty"><div>Tidak ada produk untuk filter ini.</div></div></td></tr>'}</tbody></table></div></div>`;
    renderPgBar($('stokPagination'), { page: st.page, pageSize: PAGE_SIZE, total: rows.length, onPageChange: (p) => { st.page = p; render(); } });
  }

  // ---------- export: SEMUA baris hasil filter ----------
  const HEADER = ['Kode Produk', 'Kode Asli', 'Nama Produk', 'Tipe', 'Golongan', 'Status Stok', 'Qty', 'Harga e-Katalog', 'Tahun Harga', 'Nilai', 'Link e-Katalog'];
  const toAoa = (rows) => [HEADER].concat(rows.map((r) => [
    r.kode_produk || '', r.kode_asli || '', r.nama_produk || '', r.tipe || '', r.golongan || '',
    (STATUS[r.stok_status] || ['', r.stok_status || ''])[1],
    r.qty_ready == null ? '' : Number(r.qty_ready), r.harga_ekatalog == null ? '' : Number(r.harga_ekatalog),
    r.tahun_harga == null ? '' : Number(r.tahun_harga), r.nilai == null ? '' : Number(r.nilai), r.link_v6 || '']));
  const stamp = () => new Date().toISOString().slice(0, 10);

  async function exportXlsx() {
    const rows = currentRows();
    if (!rows.length) { showToast('Tidak ada data untuk diexport', true); return; }
    if (!window.XLSX) { showToast('Library Excel belum siap, coba lagi sebentar', true); return; }
    const X = window.XLSX;
    const aoa = toAoa(rows);
    const total = rows.reduce((s, r) => s + (Number(r.nilai) || 0), 0);
    aoa.push([]); aoa.push(['TOTAL NILAI', '', '', '', '', '', '', '', '', total, '']);
    const ws = X.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [24, 22, 60, 12, 16, 18, 8, 18, 11, 20, 60].map((w) => ({ wch: w }));
    ws['!autofilter'] = { ref: X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: HEADER.length - 1 } }) };
    ws['!freeze'] = { xSplit: 0, ySplit: 1 };
    for (let r = 1; r < aoa.length; r++) {
      [7, 9].forEach((c) => { const cell = ws[X.utils.encode_cell({ r, c })]; if (cell && typeof cell.v === 'number') cell.z = '#,##0'; });
    }
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws, 'Stok & Nilai');
    X.writeFile(wb, `stok_nilai_${stamp()}.xlsx`);
  }
  // sel diawali = + - @ diberi ' (cegah formula injection di Sheets/Excel)
  const safeCell = (v) => { let s = String(v == null ? '' : v).replace(/[\t\r\n]+/g, ' ').trim(); if (/^[=+\-@]/.test(s)) s = "'" + s; return s; };
  function exportCsv() {
    const rows = currentRows();
    if (!rows.length) { showToast('Tidak ada data untuk diunduh', true); return; }
    const csv = toAoa(rows).map((r) => r.map((v) => { const s = safeCell(v); return /[",]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `stok_nilai_${stamp()}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function copyTsv() {
    const rows = currentRows();
    if (!rows.length) { showToast('Tidak ada data untuk disalin', true); return; }
    try { await navigator.clipboard.writeText(toAoa(rows).map((r) => r.map(safeCell).join('\t')).join('\n')); showToast(`${fmtN(rows.length)} baris disalin, tinggal Ctrl+V di Sheets`); }
    catch { showToast('Gagal menyalin ke clipboard', true); }
  }

  (function wire() {
    if (!$('stokBody')) return;
    $('stokFilterBar').addEventListener('click', (e) => {
      const a = e.target.closest('[data-sst],[data-stp],[data-slk],[data-sstat]');
      if (!a) return;
      if (a.dataset.sst) st.fStatus = a.dataset.sst;
      else if (a.dataset.stp) st.fTipe = a.dataset.stp;
      else if (a.dataset.slk) st.fLink = a.dataset.slk;
      else st.fNilai = a.dataset.sstat === 'tanpa_harga' ? 'tanpa_harga' : 'all';
      st.page = 1; render();
    });
    $('stokStats').addEventListener('click', (e) => {
      const a = e.target.closest('[data-sstat]');
      if (!a) return;
      st.fNilai = 'tanpa_harga'; st.page = 1; render();
    });
    let deb = null;
    $('stokSearchInput').addEventListener('input', (e) => { clearTimeout(deb); deb = setTimeout(() => { st.q = e.target.value; st.page = 1; render(); }, 250); });
    $('stokRefreshBtn').addEventListener('click', load);
    $('stokCopyBtn').addEventListener('click', copyTsv);
    $('stokCsvBtn').addEventListener('click', exportCsv);
    $('stokXlsxBtn').addEventListener('click', exportXlsx);
  })();

  S.loadStokNilai = load;
}