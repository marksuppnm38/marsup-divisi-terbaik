// Tab "Kategori & Spesialisasi" -- hanya MEMBACA. Dua RPC (migrasi 20261110_kategori_spes_katalog.sql):
//   get_katalog_kategori_ringkasan -> matriks kategori x spesialisasi seluruh katalog (sekali per muat)
//   get_katalog_kategori_daftar    -> daftar produk berpaginasi (set / instrumen satuan / unit & alat)
// Pola sama kayak orphan.js/akd-master.js: installKategori(S) dipanggil di mount(), S.loadKategori dipakai switchView().
import { showToast, renderPgBar } from './ui-utils.js';

export function installKategori(S) {
  const PAGE_SIZE = 30;
  const KAT = {
    'SET': 'Set instrumen', 'INSTRUMEN SATUAN': 'Instrumen satuan', 'ELEKTROMEDIS': 'Elektromedis',
    'ALAT LABORATORIUM': 'Alat laboratorium', 'PENUNJANG MEDIS': 'Penunjang medis', 'BMHP': 'BMHP', 'UNIT': 'Unit lainnya',
  };
  const KAT_ORDER = Object.keys(KAT);
  const ALAT = ['ELEKTROMEDIS', 'ALAT LABORATORIUM', 'PENUNJANG MEDIS', 'BMHP', 'UNIT'];
  const MODES = [
    { id: 'ringkasan', label: 'Ringkasan', icon: 'ti-layout-grid' },
    { id: 'set', label: 'Set', icon: 'ti-stack-2', kat: ['SET'] },
    { id: 'instrumen', label: 'Instrumen satuan', icon: 'ti-tool', kat: ['INSTRUMEN SATUAN'] },
    { id: 'alat', label: 'Unit & alat', icon: 'ti-device-desktop', kat: ALAT },
  ];
  const SPES_SUMBER = {
    peta: ['Peta kode', ''], rmp: ['Kode RMP', ''], kata: ['Kata kunci', ''], dasar: ['Dasar', ''], manual: ['Dikoreksi', ''],
    'peta?': ['Dugaan (peta)', 'warn'], 'rmp?': ['Dugaan (RMP)', 'warn'], kosong: ['Belum ada petunjuk', 'bad'],
    label: ['Label set', ''], isi: ['Dari isi set', ''],
  };
  const st = { mode: 'ringkasan', page: 1, q: '', spes: '', kat: '', cek: false, ring: null, req: 0 };

  const esc = (v) => S.escapeHtml(v == null ? '' : String(v));
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Number(n || 0).toLocaleString('id-ID');
  const katNama = (k) => KAT[k] || k || '—';
  const spesNama = (s) => (s == null ? 'Tanpa spesialisasi'
    : s === 'LAINNYA' ? 'Belum dikelompokkan'
    : String(s).replace(/\w\S*/g, (w) => w.charAt(0) + w.slice(1).toLowerCase()).replace(/\bTht\b/, 'THT').replace(/\bObgyn\b/, 'OBGYN'));
  const modeDef = (id) => MODES.find((m) => m.id === id);
  const missingRpc = (e) => e && (e.code === 'PGRST202' || e.code === '42883' || /could not find the function/i.test(e.message || ''));

  // ---- turunan dari matriks ----
  const matriks = () => (st.ring && st.ring.matriks) || [];
  const katDi = (m) => matriks().filter((r) => m.kat.includes(r.kategori));
  const sum = (rows, f = 'jumlah') => rows.reduce((a, r) => a + Number(r[f] || 0), 0);

  async function loadRingkasan() {
    const my = ++st.req;
    $('katCount').textContent = 'Memuat...';
    $('katBody').innerHTML = '<div class="table-card"><table><tbody><tr class="state-row"><td>Menghitung kategori & spesialisasi seluruh katalog...</td></tr></tbody></table></div>';
    const { data, error } = await S.sb.rpc('get_katalog_kategori_ringkasan');
    if (my !== st.req) return;
    if (error) return showError(error);
    st.ring = data;
    render();
  }

  function showError(error) {
    $('katCount').textContent = 'Gagal memuat';
    $('katPagination').style.display = 'none';
    const msg = missingRpc(error)
      ? 'RPC belum terpasang. Jalankan <code>20261110_kategori_spes_katalog.sql</code> di Supabase.'
      : esc(error.message || error);
    $('katBody').innerHTML = `<div class="orph-alert"><i class="ti ti-alert-triangle"></i><div>${msg}</div></div>`;
    if (!missingRpc(error)) showToast('Gagal memuat kategori: ' + (error.message || error), true);
  }

  function render() {
    renderModeBar();
    const ringkasan = st.mode === 'ringkasan';
    $('katToolbar').style.display = ringkasan ? 'none' : '';
    $('katChips').style.display = ringkasan ? 'none' : '';
    if (!st.ring) return;
    const tot = Number(st.ring.total || 0), cek = Number(st.ring.perlu_cek || 0);
    $('katCount').textContent = `${fmt(tot)} produk aktif · ${fmt(cek)} perlu dicek`;
    if (ringkasan) { $('katPagination').style.display = 'none'; renderRingkasan(); }
    else { renderChips(); loadList(); }
  }

  function renderModeBar() {
    $('katModeBar').innerHTML = MODES.map((m) => {
      const n = m.kat && st.ring ? fmt(sum(katDi(m))) : null;
      return `<button class="orph-tab${st.mode === m.id ? ' active' : ''}" data-kmode="${m.id}"><i class="ti ${m.icon}"></i><span>${m.label}</span>${n != null ? `<span class="orph-tab-count">${n}</span>` : ''}</button>`;
    }).join('');
  }

  // ---- Ringkasan: tile per kategori + matriks spesialisasi x (set | instrumen | kategori lain) ----
  function renderRingkasan() {
    const rows = matriks();
    const perKat = {};
    rows.forEach((r) => { const o = perKat[r.kategori] || (perKat[r.kategori] = { n: 0, cek: 0 }); o.n += Number(r.jumlah); o.cek += Number(r.perlu_cek); });
    const tiles = KAT_ORDER.filter((k) => perKat[k]).map((k) => {
      const go = k === 'SET' ? 'set' : k === 'INSTRUMEN SATUAN' ? 'instrumen' : 'alat';
      const o = perKat[k];
      return `<button class="orph-stat${o.cek ? ' is-pending' : ''}" data-kgo="${go}" data-kkat="${esc(k)}"><div class="orph-stat-top"><span>${esc(katNama(k))}</span></div><div class="orph-stat-val">${fmt(o.n)}</div><div class="orph-stat-sub">${o.cek ? fmt(o.cek) + ' perlu dicek' : 'semua terpetakan'}</div></button>`;
    }).join('');

    const by = new Map();
    rows.filter((r) => r.spes != null).forEach((r) => {
      const key = r.spes, col = r.kategori === 'SET' ? 'set' : r.kategori === 'INSTRUMEN SATUAN' ? 'ins' : 'lain';
      const o = by.get(key) || { set: [0, 0], ins: [0, 0], lain: [0, 0] };
      o[col][0] += Number(r.jumlah); o[col][1] += Number(r.perlu_cek); by.set(key, o);
    });
    const list = [...by.entries()].sort((a, b) => {
      if (a[0] === 'LAINNYA') return 1; if (b[0] === 'LAINNYA') return -1;
      const t = (o) => o.set[0] + o.ins[0] + o.lain[0];
      return t(b[1]) - t(a[1]);
    });
    const adaLain = list.some(([, o]) => o.lain[0] > 0);
    const cell = (v, go, spes, kat) => v[0]
      ? `<button class="kat-cell" data-kgo="${go}" data-kspes="${esc(spes)}" data-kkat="${esc(kat)}">${fmt(v[0])}${v[1] ? `<span class="kat-warn" title="${fmt(v[1])} perlu dicek">⚠ ${fmt(v[1])}</span>` : ''}</button>`
      : '<span class="kat-zero">–</span>';
    const tr = list.map(([spes, o]) => `<tr>
      <td>${esc(spesNama(spes))}</td>
      <td class="num">${cell(o.set, 'set', spes, 'SET')}</td>
      <td class="num">${cell(o.ins, 'instrumen', spes, 'INSTRUMEN SATUAN')}</td>
      ${adaLain ? `<td class="num">${cell(o.lain, 'alat', spes, '')}</td>` : ''}
      <td class="num"><b>${fmt(o.set[0] + o.ins[0] + o.lain[0])}</b></td></tr>`).join('');
    const colSum = (c) => list.reduce((a, [, o]) => a + o[c][0], 0);

    $('katBody').innerHTML = `
      <div class="orph-stats">${tiles}</div>
      <div class="table-card"><table>
        <thead><tr><th>Spesialisasi</th><th class="num">Set</th><th class="num">Instrumen satuan</th>${adaLain ? '<th class="num">Kategori lain</th>' : ''}<th class="num">Total</th></tr></thead>
        <tbody>${tr || '<tr class="state-row"><td colspan="5">Belum ada data.</td></tr>'}</tbody>
        <tfoot><tr><td><b>Total</b></td><td class="num"><b>${fmt(colSum('set'))}</b></td><td class="num"><b>${fmt(colSum('ins'))}</b></td>${adaLain ? `<td class="num"><b>${fmt(colSum('lain'))}</b></td>` : ''}<td class="num"><b>${fmt(colSum('set') + colSum('ins') + colSum('lain'))}</b></td></tr></tfoot>
      </table></div>
      <div class="kat-note">Unit &amp; alat tidak punya spesialisasi (belum ada sumbernya), jadi tampil per kategori di kartu atas. Angka ⚠ = perlu dicek (dugaan sistem, belum ada petunjuk, atau golongan belum dipetakan).</div>`;
  }

  // ---- Mode daftar ----
  function renderChips() {
    const m = modeDef(st.mode);
    const rows = katDi(m);
    const seg = (label, attr, cur, items) => `<div class="orph-fgroup"><span class="orph-flabel">${label}</span><div class="orph-seg">${items.map(([v, html, n]) =>
      `<button class="${cur === v ? 'active' : ''}" ${attr}="${esc(v)}">${html}<span class="fc-count">${fmt(n)}</span></button>`).join('')}</div></div>`;
    let h = '';
    if (m.id === 'alat') {
      const per = {}; rows.forEach((r) => { per[r.kategori] = (per[r.kategori] || 0) + Number(r.jumlah); });
      h += seg('Kategori', 'data-kkat-f', st.kat, [['', 'Semua', sum(rows)], ...ALAT.filter((k) => per[k]).map((k) => [k, esc(katNama(k)), per[k]])]);
    } else {
      const per = new Map(); rows.forEach((r) => { if (r.spes != null) per.set(r.spes, (per.get(r.spes) || 0) + Number(r.jumlah)); });
      const items = [...per.entries()].sort((a, b) => (a[0] === 'LAINNYA') - (b[0] === 'LAINNYA') || b[1] - a[1]);
      h += seg('Spesialisasi', 'data-kspes-f', st.spes, [['', 'Semua', sum(rows)], ...items.map(([s, n]) => [s, esc(spesNama(s)), n])]);
    }
    h += seg('Status', 'data-kcek-f', st.cek ? '1' : '0', [['0', 'Semua', sum(rows)], ['1', '<i class="ti ti-alert-triangle"></i> Perlu dicek', sum(rows, 'perlu_cek')]]);
    $('katChips').innerHTML = h;
  }

  async function loadList() {
    const m = modeDef(st.mode);
    const my = ++st.req;
    const body = $('katBody');
    body.innerHTML = '<div class="table-card"><table><tbody><tr class="state-row"><td>Memuat data...</td></tr></tbody></table></div>';
    const { data, error } = await S.sb.rpc('get_katalog_kategori_daftar', {
      p_kategori: st.kat ? [st.kat] : m.kat,
      p_spes: st.spes || null,
      p_cari: st.q.trim() || null,
      p_perlu_cek: st.cek,
      p_batas: PAGE_SIZE,
      p_offset: (st.page - 1) * PAGE_SIZE,
    });
    if (my !== st.req) return;
    if (error) return showError(error);
    const rows = data.rows || [], total = Number(data.total || 0);
    const isSet = m.id === 'set', isAlat = m.id === 'alat';
    const head = ['Kode', 'Nama', isAlat ? 'Kategori' : 'Spesialisasi', ...(m.id === 'instrumen' ? ['Jenis'] : []), ...(isAlat ? ['Golongan'] : [])];
    const pill = (txt, cls, title) => `<span class="status-pill ${cls || 'neutral'}"${title ? ` title="${esc(title)}"` : ''}>${esc(txt)}</span>`;
    const tr = rows.map((r) => {
      let c3;
      if (isAlat) {
        const note = r.kategori_sumber === 'bawaan' ? ' ' + pill('Belum dipetakan', 'warn', 'Golongan ini belum dipetakan ke kategori')
          : r.kategori_sumber === 'koreksi' ? ' ' + pill('Dikoreksi', 'neutral') : '';
        c3 = `${esc(katNama(r.kategori))}${note}`;
      } else {
        const s = SPES_SUMBER[r.spes_sumber];
        c3 = `${esc(spesNama(r.spes))}${r.mikro ? ' <span class="tipe-chip">mikro</span>' : ''}${s ? ' ' + pill(s[0], s[1]) : ''}`;
      }
      return `<tr class="clickable" data-kid="${r.produk_id}" data-ktipe="${esc(r.tipe)}">
        <td class="kode-cell">${esc(r.kode_produk)}</td><td>${esc(r.nama_produk || '—')}</td><td>${c3}</td>
        ${m.id === 'instrumen' ? `<td>${esc(r.jenis ? spesNama(r.jenis) : '—')}</td>` : ''}
        ${isAlat ? `<td>${esc(r.golongan || '—')}</td>` : ''}</tr>`;
    }).join('');
    body.innerHTML = `<div class="table-card akd-table-scroll"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${tr || `<tr class="state-row"><td colspan="${head.length}">Tidak ada ${isSet ? 'set' : 'produk'} yang cocok.</td></tr>`}</tbody></table></div>`;
    renderPgBar($('katPagination'), { page: st.page, pageSize: PAGE_SIZE, total, onPageChange: (p) => { st.page = p; loadList(); } });
  }

  // ---- navigasi & event (delegasi di #viewKategori) ----
  function go(mode, { spes = '', kat = '' } = {}) {
    Object.assign(st, { mode, page: 1, spes, kat, cek: false, q: '' });
    $('katSearchInput').value = '';
    render();
  }
  let debounce = null;
  $('katSearchInput').addEventListener('input', (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { st.q = e.target.value; st.page = 1; loadList(); }, 300);
  });
  $('katRefreshBtn').addEventListener('click', loadRingkasan);
  $('viewKategori').addEventListener('click', (e) => {
    const t = e.target.closest('button, tr[data-kid]');
    if (!t) return;
    if (t.dataset.kmode) return go(t.dataset.kmode);
    if (t.dataset.kgo) return go(t.dataset.kgo, { spes: t.dataset.kspes || '', kat: ALAT.includes(t.dataset.kkat) ? t.dataset.kkat : '' });
    if ('kspesF' in t.dataset) { st.spes = t.dataset.kspesF; st.page = 1; return render(); }
    if ('kkatF' in t.dataset) { st.kat = t.dataset.kkatF; st.page = 1; return render(); }
    if ('kcekF' in t.dataset) { st.cek = t.dataset.kcekF === '1'; st.page = 1; return render(); }
    if (t.dataset.kid) {
      const id = Number(t.dataset.kid);
      if (t.dataset.ktipe === 'SET') S.goToSetDetail && S.goToSetDetail(id); else S.openEdit && S.openEdit(id);
    }
  });

  S.loadKategori = loadRingkasan;
}