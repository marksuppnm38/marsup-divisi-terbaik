// app/pages/populasi/progress.js
// Mode "Progress order" di halaman Populasi: daftar SEMUA project (No. RMP) yang masih berjalan, termasuk yang
// belum firm / bukan populasi. Satu baris per (RS, No. RMP). Tujuan utama: rekap order tiap sales pada periode tertentu
// (default bulan ini), lalu daftar RMP di bawahnya.
//
// DATA: RPC get_progress_order (populasi_progress_order.sql + progress_order_hitung_set.sql) ->
//   { ringkasan, rows, rekap_sales, rekap_tanpa_pic, opsi_provinsi, opsi_pic, data_per }. SATU panggilan untuk semuanya.
//   Jumlah set per RMP dihitung server dengan logika Populasi (isi set), bukan qty mentah komponen.
//
// Modul ini berdiri sendiri: tidak menyentuh state/tabel Populasi. index.js hanya menyediakan util (ctx) dan
// meneruskan klik/ubah/ketik untuk id/aksi berawalan pg-. Semua nilai dari DB lewat esc() (data berasal dari sheet).

const PAGE_STEP = 100;      // baris RMP yang digambar per tahap

const SORTS = {
  update: 'Terbaru diperbarui',
  po: 'Tanggal PO terbaru',
  rmp: 'No. RMP terbaru',
  jumlah: 'Jumlah terbanyak',
  rs: 'Rumah sakit A–Z',
  pic: 'PIC order A–Z',
};

export function createProgress(ctx) {
  const { $, rpc, esc, fmt, fmtDate, num, showToast, showError, clearError, localISODate, periodeBulan } = ctx;

  const st = {};
  function resetState() {
    const p = periodeBulan(0);
    Object.assign(st, {
      status: 'IN_PIPELINE', preset: 'bulan-ini', dari: p.dari, sampai: p.sampai,
      pics: [], provinsi: '', cari: '', tanpaSample: false, sort: 'update', shown: PAGE_STEP,
    });
  }
  resetState();

  let data = null;          // respons terakhir
  let rows = [];            // data.rows + field turunan
  let view = [];            // rows menurut urutan tampil
  let reqId = 0;
  let timer = null;
  let alive = true;
  let started = false;
  const picOpsi = new Map();   // semua sales yang pernah muncul di opsi (dipertahankan walau filter menyempit)
  let picTimer = null;
  let picSig = '';
  const picText = () => st.pics.join(', ');
  // Nomor EP (e-purchasing) = "No. FKS" di rekap manual. Dibaca dari kolom yang tersedia; PO yang berawalan EP- juga dianggap EP.
  const epOf = (r) => String(r.no_ep || r.no_fks || r.ep || (/^EP-/i.test(String(r.po || '')) ? r.po : '') || '').trim();
  const onDocClick = (e) => { const d = $('pg-pic-det'); if (d && d.open && !d.contains(e.target)) d.open = false; };
  document.addEventListener('click', onDocClick);

  // ── util ──────────────────────────────────────────────────────────────────
  const dash = '<span class="ps-muted">—</span>';
  const nc = (v) => (num(v) ? fmt(v) : dash);
  const rmpNum = (s) => String(s || '');
  const bulanNama = (iso) => {
    const d = new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, 1);
    return d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
  };

  function periodeText() {
    if (!st.dari && !st.sampai) return 'Semua tanggal';
    if (st.preset === 'bulan-ini' && st.dari) return `Bulan ini (${bulanNama(st.dari)})`;
    if (st.preset === 'bulan-lalu' && st.dari) return `Bulan lalu (${bulanNama(st.dari)})`;
    return `${st.dari ? fmtDate(st.dari) : 'awal'} – ${st.sampai ? fmtDate(st.sampai) : 'sekarang'}`;
  }
  const statusText = () => (st.status === 'SEMUA' ? 'Semua status' : 'Berjalan');

  function baseParams() {
    return {
      p_provinsi: st.provinsi || null,
      p_cari: st.cari.trim() || null,
      p_pic_order: null,
      p_dari: st.dari || null,
      p_sampai: st.sampai || null,
      p_status_group: st.status,
      p_tanpa_sample: !!st.tanpaSample,
    };
  }

  function grupTag(g) {
    const s = String(g || '');
    if (s.includes('IN_PIPELINE') && s.includes('DELIVERED')) return 'Sebagian terkirim';
    if (s.includes('IN_PIPELINE')) return 'Berjalan';
    if (s.includes('DELIVERED')) return 'Terkirim';
    if (s.includes('REDIRECTED')) return 'Dialihkan';
    return s || '—';
  }

  function setBusy(on) {
    const t = $('pg-table'); const s = $('pg-scope'); const k = $('pg-stats');
    if (t) { t.classList.toggle('ps-busy', on); if (on) t.setAttribute('aria-busy', 'true'); else t.removeAttribute('aria-busy'); }
    if (k) k.classList.toggle('ps-busy', on);
    if (s) s.classList.toggle('ps-loading', on);
  }

  // ── muat data ─────────────────────────────────────────────────────────────
  // Satu sales = satu panggilan RPC (seperti sebelumnya). Beberapa sales = satu panggilan per sales, digabung di sini,
  // supaya hitungan server per sales tetap dipakai apa adanya dan tidak perlu mengubah SQL.
  async function fetchData() {
    const call = (pic) => rpc('get_progress_order', Object.assign(baseParams(), { p_pic_order: pic || null }));
    if (st.pics.length <= 1) return call(st.pics[0]);
    const pics = st.pics.slice();
    const parts = await Promise.all(pics.map(call));
    return mergeParts(pics, parts);
  }
  function mergeParts(pics, parts) {
    const map = new Map();
    parts.forEach((pt, i) => ((pt && pt.rows) || []).forEach((r) => {
      const k = `${r.kode_rmp}|${r.customer}`;
      const ada = map.get(k);
      if (ada) ada._pics.push(pics[i]); else map.set(k, Object.assign({}, r, { _pics: [pics[i]] }));
    }));
    const rows = [...map.values()].sort((a, b) => String(b.diperbarui || '').localeCompare(String(a.diperbarui || '')));
    const sum = (f) => rows.reduce((s, r) => s + num(r[f]), 0);
    const p0 = parts[0] || {};
    return {
      rows, data_per: p0.data_per, opsi_provinsi: p0.opsi_provinsi, opsi_pic: p0.opsi_pic,
      ringkasan: { jumlah_rmp: rows.length, jumlah_rs: new Set(rows.map((r) => r.customer)).size, set_total: sum('set_qty'), pcs_total: sum('pcs_qty'), unit_total: sum('unit_qty'), jumlah_item: sum('jumlah_item') },
      rekap_sales: pics.map((pc, i) => Object.assign({ pic: pc }, (parts[i] && parts[i].ringkasan) || {})),
      rekap_tanpa_pic: null,
    };
  }

  async function load() {
    const my = ++reqId;
    clearError();
    setBusy(true);
    try {
      const res = await fetchData();
      if (!alive || my !== reqId) return;
      data = res || {};
      (Array.isArray(data.opsi_pic) ? data.opsi_pic : []).forEach((o) => { if (o && o.pic) picOpsi.set(o.pic, o); });
      rows = (Array.isArray(data.rows) ? data.rows : []).map((r) => {
        const set = num(r.set_qty); const pcs = num(r.pcs_qty); const unit = num(r.unit_qty);
        return Object.assign({}, r, { set, pcs, unit, total: set + pcs + unit, items: Array.isArray(r.items) ? r.items : [] });
      });
      st.shown = PAGE_STEP;
      render();
    } catch (e) {
      if (!alive || my !== reqId || String(e.message).startsWith('unauthorized')) return;
      const missing = e.code === 'PGRST202' || e.status === 404;
      let msg = missing
        ? 'RPC get_progress_order belum terpasang. Jalankan populasi_progress_order.sql di Supabase SQL Editor.'
        : (e.code === '57014' || /statement timeout/i.test(String(e.message || ''))
          ? 'Database terlalu lama menjawab. Coba lagi sebentar, atau persempit periode / provinsi.'
          : 'Gagal memuat progress order: ' + e.message);
      if (data) msg = 'Gagal menyegarkan, yang tampil adalah hasil sebelumnya. ' + msg;
      showError(msg);
      if (!data) {
        $('pg-body').innerHTML = `<tr><td colspan="8" class="ps-empty ps-empty-err">${esc(msg)}<br><button type="button" class="btn btn-ghost ps-retry" data-action="pg-reload">Coba lagi</button></td></tr>`;
      }
    } finally {
      if (alive && my === reqId) setBusy(false);
    }
  }

  // ── urutan ────────────────────────────────────────────────────────────────
  function sortRows() {
    const k = st.sort;
    const a = rows.slice();
    const cmpS = (x, y) => String(x || '').localeCompare(String(y || ''), 'id', { numeric: true });
    if (k === 'po') a.sort((x, y) => String(y.tgl_po || '').localeCompare(String(x.tgl_po || '')) || cmpS(y.kode_rmp, x.kode_rmp));
    else if (k === 'rmp') a.sort((x, y) => cmpS(y.kode_rmp, x.kode_rmp));
    else if (k === 'jumlah') a.sort((x, y) => y.total - x.total || cmpS(x.customer, y.customer));
    else if (k === 'rs') a.sort((x, y) => cmpS(x.customer, y.customer) || cmpS(x.kode_rmp, y.kode_rmp));
    else if (k === 'pic') a.sort((x, y) => cmpS(x.pic_order || '~', y.pic_order || '~') || cmpS(y.kode_rmp, x.kode_rmp));
    return a;   // 'update' = urutan server (diperbarui terbaru)
  }

  // ── render ────────────────────────────────────────────────────────────────
  function render() {
    renderFilters();
    renderSummary();
    renderRecap();
    renderTable();
    const dp = $('ps-data-per');
    if (dp) dp.textContent = data && data.data_per ? 'Data per ' + fmtDate(data.data_per) : 'Data per —';
  }

  function renderFilters() {
    const prov = $('pg-provinsi');
    if (prov) {
      const opsi = (data && data.opsi_provinsi) || [];
      const names = new Set(opsi.map((o) => o.provinsi));
      let h = '<option value="">Semua provinsi</option>' +
        opsi.map((o) => `<option value="${esc(o.provinsi)}">${esc(o.provinsi)} (${fmt(o.jumlah_rmp)} RMP)</option>`).join('');
      if (st.provinsi && !names.has(st.provinsi)) h += `<option value="${esc(st.provinsi)}">${esc(st.provinsi)} (0 RMP)</option>`;
      prov.innerHTML = h; prov.value = st.provinsi;
    }
    renderPicFilter();
    document.querySelectorAll('[data-action="pg-status"]').forEach((b) => {
      const on = b.dataset.v === st.status;
      b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on));
    });
    document.querySelectorAll('[data-action="pg-periode"]').forEach((b) => {
      const on = b.dataset.v === st.preset;
      b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on));
    });
    const d1 = $('pg-dari'); const d2 = $('pg-sampai'); const sm = $('pg-sample'); const ur = $('pg-urut'); const ci = $('pg-cari');
    if (d1) d1.value = st.dari;
    if (d2) d2.value = st.sampai;
    if (sm) sm.checked = st.tanpaSample;
    if (ur) ur.value = st.sort;
    if (ci && ci.value !== st.cari) ci.value = st.cari;
    const rs = $('pg-reset');
    if (rs) rs.hidden = !(st.pics.length || st.provinsi || st.cari.trim() || st.tanpaSample || st.status !== 'IN_PIPELINE' || st.preset !== 'bulan-ini');
  }

  function picSumText() {
    if (!st.pics.length) return 'Semua sales';
    return st.pics.length <= 2 ? st.pics.join(', ') : `${st.pics.length} sales dipilih`;
  }
  // Daftar centang sales. Opsi dirender ulang hanya bila daftarnya berubah, supaya kotak yang sedang dicentang tidak "loncat".
  function renderPicFilter() {
    const list = $('pg-pic-list'); const sum = $('pg-pic-sum');
    if (!list) return;
    const opsi = [...picOpsi.values()];
    const names = new Set(opsi.map((o) => o.pic));
    st.pics.forEach((n) => { if (!names.has(n)) opsi.push({ pic: n, jumlah_rmp: 0 }); });
    opsi.sort((x, y) => String(x.pic).localeCompare(String(y.pic), 'id'));
    const sig = opsi.map((o) => o.pic).join('|');
    if (sig !== picSig) {
      picSig = sig;
      list.innerHTML = opsi.length
        ? opsi.map((o, i) => `<label class="pg-multi-it"><input type="checkbox" id="pg-pic-${i}" data-pic="${esc(o.pic)}"><span>${esc(o.pic)}</span><span class="ps-cat-n" data-n="${esc(o.pic)}"></span></label>`).join('')
        : '<div class="ps-muted pg-multi-empty">Belum ada data sales.</div>';
    }
    list.querySelectorAll('input[data-pic]').forEach((cb) => { cb.checked = st.pics.includes(cb.dataset.pic); });
    opsi.forEach((o) => {
      const n = [...list.querySelectorAll('[data-n]')].find((e) => e.dataset.n === o.pic);
      if (n) n.textContent = fmt(o.jumlah_rmp);
    });
    if (sum) sum.textContent = picSumText();
  }

  function statCard(val, label, sub) {
    return `<div class="stat-card"><div class="stat-val">${val}</div><div class="stat-label">${esc(label)}</div>${sub ? `<div class="stat-sub">${esc(sub)}</div>` : ''}</div>`;
  }

  function renderSummary() {
    const s = (data && data.ringkasan) || {};
    const bits = [`<b>${esc(periodeText())}</b>`, esc(statusText()), esc(st.provinsi || 'Semua provinsi')];
    if (st.pics.length) bits.push(`Sales <b>${esc(picText())}</b>`);
    if (st.cari.trim()) bits.push(`“${esc(st.cari.trim())}”`);
    $('pg-sum-main').innerHTML = bits.join(' <span class="ps-sep">·</span> ');
    const cards = [statCard(fmt(s.jumlah_rmp), 'No. RMP', rows.length ? '' : 'tidak ada yang cocok'), statCard(fmt(s.jumlah_rs), 'Rumah sakit')];
    if (num(s.set_total)) cards.push(statCard(fmt(s.set_total), 'Set'));
    if (num(s.pcs_total)) cards.push(statCard(fmt(s.pcs_total), 'Pcs'));
    if (num(s.unit_total)) cards.push(statCard(fmt(s.unit_total), 'Unit'));
    cards.push(statCard(fmt(s.jumlah_item), 'Baris item'));
    $('pg-stats').innerHTML = cards.join('');
    const xl = document.querySelector('[data-action="pg-xlsx"]');
    const cp = document.querySelector('[data-action="pg-copy"]');
    if (xl) xl.disabled = !rows.length;
    if (cp) cp.disabled = !rows.length;
  }

  // Rekap dari server (rekap_sales + rekap_tanpa_pic). null = SQL belum diperbarui (progress_order_hitung_set.sql).
  const toRec = (pic, x) => ({ pic, rmp: num(x.jumlah_rmp), rs: num(x.jumlah_rs), set: num(x.set_total), pcs: num(x.pcs_total), unit: num(x.unit_total), item: num(x.jumlah_item) });
  function recapList() {
    if (!data || !Array.isArray(data.rekap_sales)) return null;
    const l = data.rekap_sales.map((x) => toRec(x.pic, x)).filter((x) => x.rmp > 0);
    const t = data.rekap_tanpa_pic;
    if (t && num(t.jumlah_rmp) > 0) l.push(toRec('', t));
    return l;
  }

  function renderRecap() {
    const el = $('pg-recap');
    if (!el) return;
    if (st.pics.length === 1) {
      el.hidden = false;
      el.innerHTML = `<div class="ps-review-bar"><span class="ps-review-msg">Menampilkan sales <b>${esc(st.pics[0])}</b> saja.</span><button type="button" class="btn btn-ghost" data-action="pg-pic" data-pic="">Lihat semua sales</button></div>`;
      return;
    }
    const list = recapList();
    if (!list || !list.length) { el.hidden = true; return; }
    el.hidden = false;
    const head = '<div class="pg-sec-h"><span class="table-title">Rekap per sales</span><span class="ps-muted pg-sec-note">klik nama untuk melihat RMP sales itu</span>' + (st.pics.length > 1 ? '<button type="button" class="btn btn-ghost pg-sec-btn" data-action="pg-pic" data-pic="">Lihat semua sales</button>' : '') + '</div>';
    const s = data.ringkasan || {};
    const body = list.map((x) => {
      const nama = x.pic
        ? `<button type="button" class="ps-rs-btn" data-action="pg-pic" data-pic="${esc(x.pic)}" title="Tampilkan RMP ${esc(x.pic)}"><span class="ps-rs">${esc(x.pic)}</span></button>`
        : '<span class="ps-muted">Tanpa PIC order</span>';
      return `<tr class="pg-recap-row"><td>${nama}</td><td class="ps-num"><b>${fmt(x.rmp)}</b></td><td class="ps-num">${nc(x.rs)}</td><td class="ps-num">${nc(x.set)}</td><td class="ps-num">${nc(x.pcs)}</td><td class="ps-num">${nc(x.unit)}</td><td class="ps-num">${nc(x.item)}</td></tr>`;
    }).join('');
    const foot = `<tr class="pg-recap-total"><td>${st.pics.length ? 'Gabungan sales terpilih' : 'Semua sales'} <span class="ps-sub" title="RMP yang ditangani lebih dari satu sales dihitung di tiap sales, jadi baris di atas tidak dijumlahkan.">tidak sama dengan jumlah baris di atas</span></td><td class="ps-num"><b>${fmt(s.jumlah_rmp)}</b></td><td class="ps-num">${nc(s.jumlah_rs)}</td><td class="ps-num">${nc(s.set_total)}</td><td class="ps-num">${nc(s.pcs_total)}</td><td class="ps-num">${nc(s.unit_total)}</td><td class="ps-num">${nc(s.jumlah_item)}</td></tr>`;
    el.innerHTML = head +
      `<div class="table-scroll pg-recap-scroll"><table class="pg-recap-t"><thead><tr><th>Sales</th><th class="ps-th-num">RMP</th><th class="ps-th-num">RS</th><th class="ps-th-num">Set</th><th class="ps-th-num">Pcs</th><th class="ps-th-num">Unit</th><th class="ps-th-num">Baris</th></tr></thead><tbody>${body}${foot}</tbody></table></div>`;
  }

  function emptyHtml() {
    const b = (label, attrs) => `<button type="button" class="btn btn-ghost" ${attrs}>${esc(label)}</button>`;
    const act = [];
    if (st.cari.trim()) act.push(b('Lepas pencarian', 'data-action="pg-clear" data-k="cari"'));
    if (st.pics.length) act.push(b('Lihat semua sales', 'data-action="pg-pic" data-pic=""'));
    if (st.provinsi) act.push(b('Semua provinsi', 'data-action="pg-clear" data-k="provinsi"'));
    if (st.preset !== 'semua') act.push(b('Semua tanggal', 'data-action="pg-periode" data-v="semua"'));
    if (st.status !== 'SEMUA') act.push(b('Termasuk yang sudah terkirim', 'data-action="pg-status" data-v="SEMUA"'));
    return 'Tidak ada project yang cocok dengan filter ini.' +
      (st.preset !== 'semua' ? '<br>Periode memakai tanggal PO. Project lama yang masih berjalan baru muncul bila periode “Semua tanggal”.' : '') +
      (act.length ? `<div class="ps-empty-act">${act.join('')}</div>` : '');
  }

  function renderTable() {
    view = sortRows();
    const body = $('pg-body');
    $('pg-tbl-title').textContent = rows.length ? `${fmt(rows.length)} No. RMP` : 'Daftar project';
    const ur = $('pg-urut'); if (ur) ur.disabled = rows.length < 2;
    const more = $('pg-more');
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="8" class="ps-empty">${emptyHtml()}</td></tr>`;
      if (more) more.hidden = true;
      return;
    }
    const tampil = view.slice(0, st.shown);
    body.innerHTML = tampil.map((r, i) => {
      const lokasi = [r.kab_kota, st.provinsi ? '' : r.provinsi].filter(Boolean).join(' · ') || r.provinsi || '';
      const statusTeks = String(r.status_teks || '').trim();
      const ep = epOf(r);
      const jml = [r.set ? `${fmt(r.set)} set` : '', r.pcs ? `${fmt(r.pcs)} pcs` : '', r.unit ? `${fmt(r.unit)} unit` : ''].filter(Boolean);
      return `
      <tr class="ps-row pg-row" data-action="pg-toggle" data-i="${i}">
        <td class="pg-col-rmp"><button type="button" class="ps-rs-btn" data-action="pg-toggle" data-i="${i}" aria-expanded="false" title="Lihat isi project"><i class="ti ti-chevron-right ps-chev" aria-hidden="true"></i><span class="kode-text">${esc(rmpNum(r.kode_rmp))}</span></button></td>
        <td><span class="ps-rs">${esc(r.customer)}</span>${lokasi ? `<span class="ps-sub">${esc(lokasi)}</span>` : ''}</td>
        <td class="pg-col-ep">${ep ? `<span class="kode-text">${esc(ep)}</span>` : dash}</td>
        <td>${r.pic_order ? esc(r.pic_order) : '<span class="ps-muted">—</span>'}</td>
        <td class="pg-col-status"><span class="ps-st" title="${esc(statusTeks)}">${esc(statusTeks || '—')}</span><span class="ps-sub">${esc(grupTag(r.status_grup))}${r.ada_sample ? ' · sample' : ''}</span></td>
        <td class="ps-num">${jml.length ? jml.map((t) => `<b>${esc(t)}</b>`).join('') : dash}<span class="ps-sub">${fmt(r.jumlah_item)} baris</span></td>
        <td class="ps-date">${esc(fmtDate(r.tgl_po))}</td>
        <td class="ps-date">${esc(fmtDate(r.diperbarui))}</td>
      </tr>`;
    }).join('');
    if (more) {
      const sisa = view.length - tampil.length;
      more.hidden = sisa <= 0;
      more.innerHTML = sisa > 0 ? `<button type="button" class="btn btn-ghost" data-action="pg-more">Tampilkan ${fmt(Math.min(PAGE_STEP, sisa))} lagi <span class="ps-muted">(sisa ${fmt(sisa)})</span></button>` : '';
    }
  }

  function detailHtml(r) {
    const meta = [
      epOf(r) ? ['No. EP', epOf(r)] : null,
      r.po && r.po !== epOf(r) ? ['No. PO', r.po] : null,
      r.channel ? ['Channel', r.channel] : null,
      r.sumber_sheet ? ['Sheet', r.sumber_sheet] : null,
      r.deadline ? ['Deadline kirim', r.deadline] : null,
      r.tgl_kirim ? ['Tgl kirim', fmtDate(r.tgl_kirim)] : null,
      r.catatan ? ['Catatan', r.catatan] : null,
    ].filter(Boolean);
    const metaHtml = meta.length
      ? `<dl class="pg-meta">${meta.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : '';
    const sets = Array.isArray(r.set_rinci) ? r.set_rinci : [];
    const setHtml = sets.length
      ? `<div class="pg-sets">${sets.map((x) => `<span class="pg-set"><b>${esc(x.label)}</b> ×${fmt(x.jumlah_set)} set${x.status_hitung === 'estimasi' ? ' <span class="ps-tag" title="Isi di sheet tidak sama dengan isi set di DB produk, jumlah set diperkirakan.">Perkiraan</span>' : ''}<span class="ps-sub">dari ${fmt(x.jumlah_baris)} baris</span></span>`).join('')}</div>` : '';
    const items = r.items || [];
    const tbl = items.length
      ? `<table class="ps-dt"><thead><tr><th>Produk</th><th>Kode</th><th class="ps-th-num">Jumlah</th><th>Status</th></tr></thead><tbody>${
        items.map((it) => `<tr><td>${esc(it.produk || '—')}${it.kelompok ? `<span class="ps-sub">${esc(it.kelompok)}</span>` : ''}</td><td><span class="kode-text">${esc(it.kode || '—')}</span></td><td class="ps-num">${esc(fmt(it.qty))} ${esc(String(it.satuan || '').toLowerCase())}</td><td class="ps-st">${esc(it.status || '—')}</td></tr>`).join('')
      }</tbody></table>`
      : '<div class="ps-detail-empty">Tidak ada rincian item.</div>';
    return `<div class="ps-detail">${metaHtml}${setHtml}${tbl}</div>`;
  }

  function toggle(i) {
    const tr = document.querySelector(`#pg-body tr.pg-row[data-i="${i}"]`);
    const r = view[i];
    if (!tr || !r) return;
    const nxt = tr.nextElementSibling;
    const btn = tr.querySelector('.ps-rs-btn');
    if (nxt && nxt.classList.contains('pg-detail-row')) {
      nxt.remove(); tr.classList.remove('open'); if (btn) btn.setAttribute('aria-expanded', 'false');
      return;
    }
    const d = document.createElement('tr');
    d.className = 'ps-detail-row pg-detail-row';
    d.innerHTML = `<td colspan="8">${detailHtml(r)}</td>`;
    tr.after(d);
    tr.classList.add('open');
    if (btn) btn.setAttribute('aria-expanded', 'true');
  }

  // ── teks (WhatsApp) ───────────────────────────────────────────────────────
  const qtyText = (o) => [o.set ? `${fmt(o.set)} set` : '', o.pcs ? `${fmt(o.pcs)} pcs` : '', o.unit ? `${fmt(o.unit)} unit` : ''].filter(Boolean).join(' + ') || '0';

  function buildText() {
    const s = data.ringkasan || {};
    const L = [];
    L.push(`Progress order — ${periodeText()}`);
    L.push(`${statusText()}${st.provinsi ? ', ' + st.provinsi : ''}${st.pics.length ? ', sales ' + picText() : ''}, data per ${fmtDate(data.data_per)}`, '');
    const rec = recapList() || [];
    if (rec.length && st.pics.length !== 1) {
      L.push('Rekap per sales:');
      rec.forEach((x, i) => L.push(`${i + 1}. ${x.pic || 'Tanpa PIC order'} — ${fmt(x.rmp)} RMP, ${fmt(x.rs)} RS (${qtyText(x)})`));
      L.push('');
    }
    L.push('Daftar project:');
    view.forEach((r, i) => {
      L.push(`${i + 1}. ${r.kode_rmp} · ${r.customer}${epOf(r) ? ' · ' + epOf(r) : ''}${r.pic_order ? ' · ' + r.pic_order : ''} — ${qtyText(r)}${r.status_teks ? ' [' + String(r.status_teks).trim() + ']' : ''}`);
    });
    L.push('', `Total: ${fmt(s.jumlah_rmp)} RMP, ${fmt(s.jumlah_rs)} RS (${qtyText({ set: num(s.set_total), pcs: num(s.pcs_total), unit: num(s.unit_total) })})`);
    return L.join('\n');
  }

  async function copyText() {
    if (!data || !rows.length) { showToast('Belum ada data untuk disalin', 'error'); return; }
    try { await navigator.clipboard.writeText(buildText()); showToast(`Progress ${fmt(rows.length)} RMP disalin`); }
    catch (e) { showToast('Gagal menyalin', 'error'); }
  }

  // ── Excel ─────────────────────────────────────────────────────────────────
  async function downloadXlsx(btn) {
    if (!data || !rows.length) return;
    if (btn) btn.disabled = true;
    const snap = { rows: view.slice(), data, rec: recapList() || [], periode: periodeText(), status: statusText(), prov: st.provinsi, pic: picText(), pics: st.pics.slice() };
    try {
      const ExcelJS = await ctx.ensureExcel();
      const wb = new ExcelJS.Workbook();
      wb.creator = 'PNM-BARE TOOLS'; wb.created = new Date();
      const HEAD = { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } }, alignment: { vertical: 'middle', wrapText: true } };
      const styleHead = (row) => { row.height = 22; row.eachCell((c) => Object.assign(c, HEAD)); };
      const D = (s) => { const t = ctx.toDate(s); return t || null; };
      const NUMF = '#,##0;-#,##0;"–"';
      const DATEF = 'dd mmm yyyy';

      // 0. Laporan per sales: satu sheet per sales, bentuknya seperti rekap orderan manual
      //    (entitas, No., distributor bila ada, No. RMP, rumah sakit, No. EP/FKS, tanggal pemenuhan).
      const grup = new Map();
      snap.rows.forEach((r) => {
        const ks = (r._pics && r._pics.length) ? r._pics : [snap.pics.length === 1 ? snap.pics[0] : (r.pic_order || '')];
        ks.forEach((k) => { if (!grup.has(k)) grup.set(k, []); grup.get(k).push(r); });
      });
      const adaDist = snap.rows.some((r) => r.distributor);
      const pakai = new Set(['rekap per sales', 'daftar rmp', 'rincian item']);
      const namaSheet = (k) => {
        const b = String(k || 'Tanpa PIC').replace(/[\\\/*?:\[\]]/g, ' ').trim().slice(0, 28) || 'Tanpa PIC';
        let n = b; let i = 2;
        while (pakai.has(n.toLowerCase())) n = b.slice(0, 25) + ' ' + (i++);
        pakai.add(n.toLowerCase());
        return n;
      };
      const cmpS = (x, y) => String(x || '').localeCompare(String(y || ''), 'id', { numeric: true });
      [...grup.entries()].sort((x, y) => cmpS(x[0] || '~', y[0] || '~')).forEach(([k, list]) => {
        const ws = wb.addWorksheet(namaSheet(k));
        ws.addRow([`REKAP ORDERAN ${String(k || 'TANPA PIC ORDER').toUpperCase()}`]).font = { bold: true, size: 14 };
        ws.addRow([`${snap.periode} · ${snap.status}${snap.prov ? ' · ' + snap.prov : ''} · data per ${fmtDate(snap.data.data_per)}`]);
        ws.addRow([]);
        const head = ['Pabrik / Entitas', 'No.'].concat(adaDist ? ['Nama Distributor'] : [], ['No. RMP', 'Rumah Sakit / Politeknik / Puskesmas', 'No. EP (FKS)', 'Tanggal Pemenuhan', 'Status']);
        styleHead(ws.addRow(head));
        const ent = (r) => String(r.entitas || r.pabrik || '').trim();
        const urut = list.slice().sort((x, y) => cmpS(ent(x), ent(y)) || cmpS(x.kode_rmp, y.kode_rmp));
        let prev = null;
        urut.forEach((r, i) => {
          const e = ent(r);
          const tgl = D(r.tgl_kirim) || D(r.deadline) || r.deadline || '';
          ws.addRow([e !== prev ? e : ''].concat([i + 1], adaDist ? [r.distributor || ''] : [], [r.kode_rmp, r.customer, epOf(r), tgl, String(r.status_teks || '').trim()]));
          prev = e;
        });
        const tr = ws.addRow(['', '', ...(adaDist ? [''] : []), `Total ${fmt(urut.length)} RMP`]);
        tr.font = { bold: true };
        const iTgl = head.indexOf('Tanggal Pemenuhan') + 1;
        ws.getColumn(iTgl).numFmt = DATEF;
        ws.columns = [{ width: 20 }, { width: 6 }].concat(adaDist ? [{ width: 30 }] : [], [{ width: 18 }, { width: 44 }, { width: 34 }, { width: 18 }, { width: 30 }]);
        ws.views = [{ state: 'frozen', ySplit: 4 }];
      });

      // 1. Rekap per sales
      const w1 = wb.addWorksheet('Rekap per sales');
      w1.addRow([`Progress order — ${snap.periode}`]).font = { bold: true, size: 14 };
      w1.addRow([`${snap.status}${snap.prov ? ', ' + snap.prov : ', semua provinsi'}${snap.pic ? ', sales ' + snap.pic : ''}. Data per ${fmtDate(snap.data.data_per)}.`]);
      w1.addRow([]);
      const h1 = w1.addRow(['Sales', 'No. RMP', 'Rumah sakit', 'Set', 'Pcs', 'Unit', 'Baris item']);
      styleHead(h1);
      if (snap.rec.length) snap.rec.forEach((x) => w1.addRow([x.pic || 'Tanpa PIC order', x.rmp, x.rs, x.set, x.pcs, x.unit, x.item]));
      else w1.addRow([snap.pic ? 'Rekap per sales tidak ditampilkan saat satu sales dipilih.' : 'Rekap per sales belum tersedia.']);
      const s = snap.data.ringkasan || {};
      const tot = w1.addRow(['Semua sales', num(s.jumlah_rmp), num(s.jumlah_rs), num(s.set_total), num(s.pcs_total), num(s.unit_total), num(s.jumlah_item)]);
      tot.font = { bold: true };
      w1.addRow(['RMP yang ditangani lebih dari satu sales dihitung di tiap sales, jadi baris sales tidak dijumlahkan ke baris “Semua sales”.']).font = { italic: true, color: { argb: 'FF666666' } };
      w1.columns = [{ width: 24 }, { width: 11 }, { width: 13 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 12 }];
      w1.eachRow((row, n) => { if (n >= 5) for (let c = 2; c <= 7; c++) row.getCell(c).numFmt = NUMF; });

      // 2. Daftar RMP
      const w2 = wb.addWorksheet('Daftar RMP');
      styleHead(w2.addRow(['No. RMP', 'Rumah sakit', 'Provinsi', 'Kab/Kota', 'Sales (PIC order)', 'No. EP', 'No. PO', 'Status', 'Grup status', 'Channel', 'Tgl PO', 'Deadline kirim', 'Tgl kirim', 'Diperbarui', 'Baris item', 'Set', 'Pcs', 'Unit', 'Sample', 'Catatan']));
      snap.rows.forEach((r) => w2.addRow([r.kode_rmp, r.customer, r.provinsi || '', r.kab_kota || '', r.pic_order || '', epOf(r), r.po || '', String(r.status_teks || '').trim(), grupTag(r.status_grup), r.channel || '', D(r.tgl_po), r.deadline || '', D(r.tgl_kirim), D(r.diperbarui), num(r.jumlah_item), r.set, r.pcs, r.unit, r.ada_sample ? 'Ya' : '', r.catatan || '']));
      w2.columns = [{ width: 13 }, { width: 36 }, { width: 18 }, { width: 20 }, { width: 18 }, { width: 32 }, { width: 26 }, { width: 28 }, { width: 16 }, { width: 14 }, { width: 13 }, { width: 16 }, { width: 13 }, { width: 13 }, { width: 10 }, { width: 8 }, { width: 8 }, { width: 8 }, { width: 8 }, { width: 40 }];
      [11, 13, 14].forEach((c) => { w2.getColumn(c).numFmt = DATEF; });
      [15, 16, 17, 18].forEach((c) => { w2.getColumn(c).numFmt = NUMF; });
      w2.views = [{ state: 'frozen', ySplit: 1, xSplit: 2 }];
      w2.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 20 } };

      // 3. Rincian item
      const w3 = wb.addWorksheet('Rincian item');
      styleHead(w3.addRow(['No. RMP', 'Rumah sakit', 'Sales (PIC order)', 'Produk', 'Kode', 'Jumlah', 'Satuan', 'Kelompok', 'Status', 'Sheet']));
      snap.rows.forEach((r) => r.items.forEach((it) => w3.addRow([r.kode_rmp, r.customer, r.pic_order || '', it.produk || '', it.kode || '', num(it.qty), String(it.satuan || '').toLowerCase(), it.kelompok || '', it.status || '', it.sheet || ''])));
      w3.columns = [{ width: 13 }, { width: 34 }, { width: 18 }, { width: 50 }, { width: 22 }, { width: 9 }, { width: 9 }, { width: 18 }, { width: 24 }, { width: 14 }];
      w3.getColumn(6).numFmt = NUMF;
      w3.views = [{ state: 'frozen', ySplit: 1 }];
      w3.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 10 } };

      const nama = `Progress order - ${ctx.bersihNama(snap.periode).slice(0, 40)} - ${ctx.bersihNama(snap.status)}${snap.pic ? ' - ' + ctx.bersihNama(snap.pic).slice(0, 24) : ''} - ${localISODate()}.xlsx`;
      const buf = await wb.xlsx.writeBuffer();
      ctx.saveBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), nama);
      showToast(`${nama} diunduh`);
    } catch (e) {
      if (String(e.message).startsWith('unauthorized')) return;
      showToast('Gagal membuat Excel: ' + e.message, 'error');
    } finally {
      if (btn) btn.disabled = !rows.length;
    }
  }

  // ── perubahan filter ──────────────────────────────────────────────────────
  function setPeriode(v) {
    if (v === 'semua') { st.preset = 'semua'; st.dari = ''; st.sampai = ''; }
    else { const p = periodeBulan(v === 'bulan-lalu' ? -1 : 0); st.preset = v === 'bulan-lalu' ? 'bulan-lalu' : 'bulan-ini'; st.dari = p.dari; st.sampai = p.sampai; }
    load();
  }

  const ACTIONS = {
    'pg-reload': () => load(),
    'pg-status': (el) => { st.status = el.dataset.v === 'SEMUA' ? 'SEMUA' : 'IN_PIPELINE'; load(); },
    'pg-periode': (el) => setPeriode(el.dataset.v),
    'pg-pic': (el) => { st.pics = el.dataset.pic ? [el.dataset.pic] : []; const d = $('pg-pic-det'); if (d) d.open = false; load(); },
    'pg-clear': (el) => {
      if (el.dataset.k === 'cari') st.cari = '';
      else if (el.dataset.k === 'provinsi') st.provinsi = '';
      load();
    },
    'pg-reset': () => { resetState(); load(); },
    'pg-toggle': (el) => toggle(+el.dataset.i),
    'pg-more': () => { st.shown += PAGE_STEP; renderTable(); },
    'pg-copy': () => copyText(),
    'pg-xlsx': (el) => downloadXlsx(el),
  };

  const CHANGE = {
    'pg-provinsi': (t) => { st.provinsi = t.value; load(); },
    'pg-dari': (t) => { st.dari = t.value; st.preset = (st.dari || st.sampai) ? 'kustom' : 'semua'; load(); },
    'pg-sampai': (t) => { st.sampai = t.value; st.preset = (st.dari || st.sampai) ? 'kustom' : 'semua'; load(); },
    'pg-sample': (t) => { st.tanpaSample = t.checked; load(); },
    'pg-urut': (t) => { st.sort = SORTS[t.value] ? t.value : 'update'; if (data) renderTable(); },
  };

  return {
    show() {
      $('pg-root').hidden = false;
      const u = $('pg-urut');
      if (u && !u.options.length) u.innerHTML = Object.entries(SORTS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
      started = true;
      load();
    },
    hide() {
      const r = $('pg-root'); if (r) r.hidden = true;
      reqId++;                       // batalkan respons yang masih di jalan
      clearTimeout(timer); clearTimeout(picTimer);
      setBusy(false);
    },
    isStarted: () => started,
    onClick(el) { const f = ACTIONS[el.dataset.action]; if (f && Object.prototype.hasOwnProperty.call(ACTIONS, el.dataset.action)) f(el); },
    onChange(t) {
      if (t.dataset && t.dataset.pic !== undefined && /^pg-pic-/.test(t.id)) {
        const nm = t.dataset.pic; const i = st.pics.indexOf(nm);
        if (t.checked && i < 0) st.pics.push(nm); else if (!t.checked && i >= 0) st.pics.splice(i, 1);
        const sum = $('pg-pic-sum'); if (sum) sum.textContent = picSumText();
        clearTimeout(picTimer); picTimer = setTimeout(() => load(), 350);   // beberapa centang beruntun = satu pemuatan
        return;
      }
      if (Object.prototype.hasOwnProperty.call(CHANGE, t.id)) CHANGE[t.id](t);
    },
    onInput(t) {
      if (t.id !== 'pg-cari') return;
      st.cari = t.value;
      clearTimeout(timer);
      timer = setTimeout(() => load(), 350);
    },
    destroy() { alive = false; reqId++; clearTimeout(timer); clearTimeout(picTimer); document.removeEventListener('click', onDocClick); },
  };
}