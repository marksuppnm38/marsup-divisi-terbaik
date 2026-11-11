// app/pages/populasi/progress.js
// Mode "Progress order" di halaman Populasi: daftar SEMUA project (No. RMP) yang masih berjalan, termasuk yang
// belum firm / bukan populasi. Satu baris per (RS, No. RMP). Tujuan utama: rekap order tiap sales pada periode tertentu
// (default bulan ini), lalu daftar RMP di bawahnya.
//
// DATA: RPC get_progress_order (populasi_progress_order.sql) -> { ringkasan, rows, opsi_provinsi, opsi_pic, data_per }.
//   Rekap per sales = satu panggilan tambahan per PIC (p_pic_order), memakai filter yang sama, hanya 'ringkasan' yang dipakai.
//   Dijalankan di belakang (3 sekaligus) setelah daftar tampil, jadi daftar tidak menunggu rekap.
//
// Modul ini berdiri sendiri: tidak menyentuh state/tabel Populasi. index.js hanya menyediakan util (ctx) dan
// meneruskan klik/ubah/ketik untuk id/aksi berawalan pg-. Semua nilai dari DB lewat esc() (data berasal dari sheet).

const PAGE_STEP = 100;      // baris RMP yang digambar per tahap
const MAX_SALES = 24;       // batas PIC yang direkap
const POOL = 3;             // panggilan rekap yang berjalan bersamaan

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
      pic: '', provinsi: '', cari: '', tanpaSample: false, sort: 'update', shown: PAGE_STEP,
    });
  }
  resetState();

  let data = null;          // respons terakhir
  let rows = [];            // data.rows + field turunan
  let view = [];            // rows menurut urutan tampil
  let recap = null;         // null = memuat; array = hasil rekap per sales
  let reqId = 0;
  let recapReq = 0;
  let timer = null;
  let alive = true;
  let started = false;

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
  async function load() {
    const my = ++reqId;
    recapReq++;
    clearError();
    setBusy(true);
    try {
      const res = await rpc('get_progress_order', Object.assign(baseParams(), { p_pic_order: st.pic || null }));
      if (!alive || my !== reqId) return;
      data = res || {};
      rows = (Array.isArray(data.rows) ? data.rows : []).map((r) => {
        const set = num(r.set_qty); const pcs = num(r.pcs_qty); const unit = num(r.unit_qty);
        return Object.assign({}, r, { set, pcs, unit, total: set + pcs + unit, items: Array.isArray(r.items) ? r.items : [] });
      });
      st.shown = PAGE_STEP;
      recap = null;
      render();
      loadRecap();
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
        $('pg-body').innerHTML = `<tr><td colspan="7" class="ps-empty ps-empty-err">${esc(msg)}<br><button type="button" class="btn btn-ghost ps-retry" data-action="pg-reload">Coba lagi</button></td></tr>`;
      }
    } finally {
      if (alive && my === reqId) setBusy(false);
    }
  }

  // Rekap per sales: satu panggilan per PIC, hanya ringkasannya yang dipakai. Berjalan di belakang.
  async function loadRecap() {
    const rid = recapReq;
    if (st.pic) { recap = null; renderRecap(); return; }
    const opsi = (data && Array.isArray(data.opsi_pic) ? data.opsi_pic : []).slice(0, MAX_SALES);
    if (!opsi.length) { recap = []; renderRecap(); return; }
    recap = null;
    renderRecap();
    const base = baseParams();
    const out = new Array(opsi.length);
    let next = 0;
    async function worker() {
      while (next < opsi.length) {
        const i = next++;
        try {
          const r = await rpc('get_progress_order', Object.assign({}, base, { p_pic_order: opsi[i].pic }));
          out[i] = { pic: opsi[i].pic, s: (r && r.ringkasan) || {} };
        } catch (e) {
          out[i] = { pic: opsi[i].pic, err: true };
        }
        if (!alive || rid !== recapReq) return;
      }
    }
    await Promise.all(Array.from({ length: Math.min(POOL, opsi.length) }, worker));
    if (!alive || rid !== recapReq) return;
    recap = out.filter(Boolean);
    renderRecap();
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
    const prov = $('pg-provinsi'); const pic = $('pg-pic');
    if (prov) {
      const opsi = (data && data.opsi_provinsi) || [];
      const names = new Set(opsi.map((o) => o.provinsi));
      let h = '<option value="">Semua provinsi</option>' +
        opsi.map((o) => `<option value="${esc(o.provinsi)}">${esc(o.provinsi)} (${fmt(o.jumlah_rmp)} RMP)</option>`).join('');
      if (st.provinsi && !names.has(st.provinsi)) h += `<option value="${esc(st.provinsi)}">${esc(st.provinsi)} (0 RMP)</option>`;
      prov.innerHTML = h; prov.value = st.provinsi;
    }
    if (pic) {
      const opsi = (data && data.opsi_pic) || [];
      const names = new Set(opsi.map((o) => o.pic));
      let h = '<option value="">Semua sales</option>' +
        opsi.map((o) => `<option value="${esc(o.pic)}">${esc(o.pic)} (${fmt(o.jumlah_rmp)} RMP)</option>`).join('');
      if (st.pic && !names.has(st.pic)) h += `<option value="${esc(st.pic)}">${esc(st.pic)}</option>`;
      pic.innerHTML = h; pic.value = st.pic;
    }
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
    if (rs) rs.hidden = !(st.pic || st.provinsi || st.cari.trim() || st.tanpaSample || st.status !== 'IN_PIPELINE' || st.preset !== 'bulan-ini');
  }

  function statCard(val, label, sub) {
    return `<div class="stat-card"><div class="stat-val">${val}</div><div class="stat-label">${esc(label)}</div>${sub ? `<div class="stat-sub">${esc(sub)}</div>` : ''}</div>`;
  }

  function renderSummary() {
    const s = (data && data.ringkasan) || {};
    const bits = [`<b>${esc(periodeText())}</b>`, esc(statusText()), esc(st.provinsi || 'Semua provinsi')];
    if (st.pic) bits.push(`Sales <b>${esc(st.pic)}</b>`);
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

  // RMP tanpa PIC order dihitung di sisi klien dari daftar yang sudah ada (server hanya merekap per nama PIC).
  function tanpaPicRow() {
    const t = rows.filter((r) => !String(r.pic_order || '').trim());
    if (!t.length) return null;
    return {
      pic: '', rmp: t.length, rs: new Set(t.map((r) => r.customer)).size,
      set: t.reduce((a, r) => a + r.set, 0), pcs: t.reduce((a, r) => a + r.pcs, 0), unit: t.reduce((a, r) => a + r.unit, 0),
      item: t.reduce((a, r) => a + num(r.jumlah_item), 0),
    };
  }

  function renderRecap() {
    const el = $('pg-recap');
    if (!el) return;
    if (st.pic) {
      el.hidden = false;
      el.innerHTML = `<div class="ps-review-bar"><span class="ps-review-msg">Menampilkan sales <b>${esc(st.pic)}</b> saja.</span><button type="button" class="btn btn-ghost" data-action="pg-pic" data-pic="">Lihat semua sales</button></div>`;
      return;
    }
    if (!data) { el.hidden = true; return; }
    const opsi = Array.isArray(data.opsi_pic) ? data.opsi_pic : [];
    const tanpa = tanpaPicRow();
    if (!opsi.length && !tanpa) { el.hidden = true; return; }
    el.hidden = false;
    const head = '<div class="pg-sec-h"><span class="table-title">Rekap per sales</span><span class="ps-muted pg-sec-note">klik baris untuk melihat RMP sales itu</span></div>';
    if (recap === null) {
      el.innerHTML = head + '<div class="ps-empty pg-recap-load" role="status">Menghitung rekap per sales…</div>';
      return;
    }
    const list = recap.filter((x) => !x.err).map((x) => ({
      pic: x.pic, rmp: num(x.s.jumlah_rmp), rs: num(x.s.jumlah_rs), set: num(x.s.set_total), pcs: num(x.s.pcs_total), unit: num(x.s.unit_total), item: num(x.s.jumlah_item),
    })).filter((x) => x.rmp > 0).sort((a, b) => b.rmp - a.rmp || a.pic.localeCompare(b.pic, 'id'));
    const gagal = recap.filter((x) => x.err).length;
    if (tanpa) list.push(tanpa);
    const s = data.ringkasan || {};
    const body = list.map((x) => {
      const nama = x.pic
        ? `<button type="button" class="ps-rs-btn" data-action="pg-pic" data-pic="${esc(x.pic)}" title="Tampilkan RMP ${esc(x.pic)}"><span class="ps-rs">${esc(x.pic)}</span></button>`
        : '<span class="ps-muted">Tanpa PIC order</span>';
      return `<tr class="pg-recap-row"><td>${nama}</td><td class="ps-num"><b>${fmt(x.rmp)}</b></td><td class="ps-num">${nc(x.rs)}</td><td class="ps-num">${nc(x.set)}</td><td class="ps-num">${nc(x.pcs)}</td><td class="ps-num">${nc(x.unit)}</td><td class="ps-num">${nc(x.item)}</td></tr>`;
    }).join('');
    const foot = `<tr class="pg-recap-total"><td>Semua sales <span class="ps-sub" title="RMP yang ditangani lebih dari satu sales dihitung di tiap sales, jadi baris di atas tidak dijumlahkan.">tidak sama dengan jumlah baris di atas</span></td><td class="ps-num"><b>${fmt(s.jumlah_rmp)}</b></td><td class="ps-num">${nc(s.jumlah_rs)}</td><td class="ps-num">${nc(s.set_total)}</td><td class="ps-num">${nc(s.pcs_total)}</td><td class="ps-num">${nc(s.unit_total)}</td><td class="ps-num">${nc(s.jumlah_item)}</td></tr>`;
    const warn = gagal ? `<div class="ps-note">${fmt(gagal)} sales gagal dihitung (database sibuk). <button type="button" class="ps-linkbtn" data-action="pg-reload">Muat ulang</button></div>` : '';
    el.innerHTML = head + warn +
      `<div class="table-scroll pg-recap-scroll"><table class="pg-recap-t"><thead><tr><th>Sales</th><th class="ps-th-num">RMP</th><th class="ps-th-num">RS</th><th class="ps-th-num">Set</th><th class="ps-th-num">Pcs</th><th class="ps-th-num">Unit</th><th class="ps-th-num">Item</th></tr></thead><tbody>${body}${foot}</tbody></table></div>`;
  }

  function emptyHtml() {
    const b = (label, attrs) => `<button type="button" class="btn btn-ghost" ${attrs}>${esc(label)}</button>`;
    const act = [];
    if (st.cari.trim()) act.push(b('Lepas pencarian', 'data-action="pg-clear" data-k="cari"'));
    if (st.pic) act.push(b('Lihat semua sales', 'data-action="pg-pic" data-pic=""'));
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
      body.innerHTML = `<tr><td colspan="7" class="ps-empty">${emptyHtml()}</td></tr>`;
      if (more) more.hidden = true;
      return;
    }
    const tampil = view.slice(0, st.shown);
    body.innerHTML = tampil.map((r, i) => {
      const lokasi = [r.kab_kota, st.provinsi ? '' : r.provinsi].filter(Boolean).join(' · ') || r.provinsi || '';
      const statusTeks = String(r.status_teks || '').trim();
      const jml = [r.set ? `${fmt(r.set)} set` : '', r.pcs ? `${fmt(r.pcs)} pcs` : '', r.unit ? `${fmt(r.unit)} unit` : ''].filter(Boolean);
      return `
      <tr class="ps-row pg-row" data-action="pg-toggle" data-i="${i}">
        <td class="pg-col-rmp"><button type="button" class="ps-rs-btn" data-action="pg-toggle" data-i="${i}" aria-expanded="false" title="Lihat isi project"><i class="ti ti-chevron-right ps-chev" aria-hidden="true"></i><span class="kode-text">${esc(rmpNum(r.kode_rmp))}</span></button></td>
        <td><span class="ps-rs">${esc(r.customer)}</span>${lokasi ? `<span class="ps-sub">${esc(lokasi)}</span>` : ''}</td>
        <td>${r.pic_order ? esc(r.pic_order) : '<span class="ps-muted">—</span>'}</td>
        <td class="pg-col-status"><span class="ps-st" title="${esc(statusTeks)}">${esc(statusTeks || '—')}</span><span class="ps-sub">${esc(grupTag(r.status_grup))}${r.ada_sample ? ' · sample' : ''}</span></td>
        <td class="ps-num">${jml.length ? jml.map((t) => `<b>${esc(t)}</b>`).join('') : dash}<span class="ps-sub">${fmt(r.jumlah_item)} item</span></td>
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
      r.po ? ['No. PO', r.po] : null,
      r.channel ? ['Channel', r.channel] : null,
      r.sumber_sheet ? ['Sheet', r.sumber_sheet] : null,
      r.deadline ? ['Deadline kirim', r.deadline] : null,
      r.tgl_kirim ? ['Tgl kirim', fmtDate(r.tgl_kirim)] : null,
      r.catatan ? ['Catatan', r.catatan] : null,
    ].filter(Boolean);
    const metaHtml = meta.length
      ? `<dl class="pg-meta">${meta.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : '';
    const items = r.items || [];
    const tbl = items.length
      ? `<table class="ps-dt"><thead><tr><th>Produk</th><th>Kode</th><th class="ps-th-num">Jumlah</th><th>Status</th></tr></thead><tbody>${
        items.map((it) => `<tr><td>${esc(it.produk || '—')}${it.kelompok ? `<span class="ps-sub">${esc(it.kelompok)}</span>` : ''}</td><td><span class="kode-text">${esc(it.kode || '—')}</span></td><td class="ps-num">${esc(fmt(it.qty))} ${esc(String(it.satuan || '').toLowerCase())}</td><td class="ps-st">${esc(it.status || '—')}</td></tr>`).join('')
      }</tbody></table>`
      : '<div class="ps-detail-empty">Tidak ada rincian item.</div>';
    return `<div class="ps-detail">${metaHtml}${tbl}</div>`;
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
    d.innerHTML = `<td colspan="7">${detailHtml(r)}</td>`;
    tr.after(d);
    tr.classList.add('open');
    if (btn) btn.setAttribute('aria-expanded', 'true');
  }

  // ── teks (WhatsApp) ───────────────────────────────────────────────────────
  function recapList() {
    if (!recap) return [];
    const l = recap.filter((x) => !x.err && num(x.s.jumlah_rmp) > 0).map((x) => ({
      pic: x.pic, rmp: num(x.s.jumlah_rmp), rs: num(x.s.jumlah_rs), set: num(x.s.set_total), pcs: num(x.s.pcs_total), unit: num(x.s.unit_total), item: num(x.s.jumlah_item),
    })).sort((a, b) => b.rmp - a.rmp || a.pic.localeCompare(b.pic, 'id'));
    const t = tanpaPicRow();
    if (t) l.push(Object.assign(t, { pic: 'Tanpa PIC order' }));
    return l;
  }
  const qtyText = (o) => [o.set ? `${fmt(o.set)} set` : '', o.pcs ? `${fmt(o.pcs)} pcs` : '', o.unit ? `${fmt(o.unit)} unit` : ''].filter(Boolean).join(' + ') || '0';

  function buildText() {
    const s = data.ringkasan || {};
    const L = [];
    L.push(`Progress order — ${periodeText()}`);
    L.push(`${statusText()}${st.provinsi ? ', ' + st.provinsi : ''}${st.pic ? ', sales ' + st.pic : ''}, data per ${fmtDate(data.data_per)}`, '');
    const rec = recapList();
    if (rec.length && !st.pic) {
      L.push('Rekap per sales:');
      rec.forEach((x, i) => L.push(`${i + 1}. ${x.pic} — ${fmt(x.rmp)} RMP, ${fmt(x.rs)} RS (${qtyText(x)})`));
      L.push('');
    }
    L.push('Daftar project:');
    view.forEach((r, i) => {
      L.push(`${i + 1}. ${r.kode_rmp} · ${r.customer}${r.pic_order ? ' · ' + r.pic_order : ''} — ${qtyText(r)}${r.status_teks ? ' [' + String(r.status_teks).trim() + ']' : ''}`);
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
    const snap = { rows: view.slice(), data, rec: recapList(), periode: periodeText(), status: statusText(), prov: st.provinsi, pic: st.pic };
    try {
      const ExcelJS = await ctx.ensureExcel();
      const wb = new ExcelJS.Workbook();
      wb.creator = 'PNM-BARE TOOLS'; wb.created = new Date();
      const HEAD = { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } }, alignment: { vertical: 'middle', wrapText: true } };
      const styleHead = (row) => { row.height = 22; row.eachCell((c) => Object.assign(c, HEAD)); };
      const D = (s) => { const t = ctx.toDate(s); return t || null; };
      const NUMF = '#,##0;-#,##0;"–"';
      const DATEF = 'dd mmm yyyy';

      // 1. Rekap per sales
      const w1 = wb.addWorksheet('Rekap per sales');
      w1.addRow([`Progress order — ${snap.periode}`]).font = { bold: true, size: 14 };
      w1.addRow([`${snap.status}${snap.prov ? ', ' + snap.prov : ', semua provinsi'}${snap.pic ? ', sales ' + snap.pic : ''}. Data per ${fmtDate(snap.data.data_per)}.`]);
      w1.addRow([]);
      const h1 = w1.addRow(['Sales', 'No. RMP', 'Rumah sakit', 'Set', 'Pcs', 'Unit', 'Baris item']);
      styleHead(h1);
      if (snap.rec.length) snap.rec.forEach((x) => w1.addRow([x.pic, x.rmp, x.rs, x.set, x.pcs, x.unit, x.item]));
      else w1.addRow([snap.pic ? 'Rekap per sales tidak ditampilkan saat satu sales dipilih.' : 'Rekap per sales belum tersedia.']);
      const s = snap.data.ringkasan || {};
      const tot = w1.addRow(['Semua sales', num(s.jumlah_rmp), num(s.jumlah_rs), num(s.set_total), num(s.pcs_total), num(s.unit_total), num(s.jumlah_item)]);
      tot.font = { bold: true };
      w1.addRow(['RMP yang ditangani lebih dari satu sales dihitung di tiap sales, jadi baris sales tidak dijumlahkan ke baris “Semua sales”.']).font = { italic: true, color: { argb: 'FF666666' } };
      w1.columns = [{ width: 24 }, { width: 11 }, { width: 13 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 12 }];
      w1.eachRow((row, n) => { if (n >= 5) for (let c = 2; c <= 7; c++) row.getCell(c).numFmt = NUMF; });

      // 2. Daftar RMP
      const w2 = wb.addWorksheet('Daftar RMP');
      styleHead(w2.addRow(['No. RMP', 'Rumah sakit', 'Provinsi', 'Kab/Kota', 'Sales (PIC order)', 'No. PO', 'Status', 'Grup status', 'Channel', 'Tgl PO', 'Deadline kirim', 'Tgl kirim', 'Diperbarui', 'Baris item', 'Set', 'Pcs', 'Unit', 'Sample', 'Catatan']));
      snap.rows.forEach((r) => w2.addRow([r.kode_rmp, r.customer, r.provinsi || '', r.kab_kota || '', r.pic_order || '', r.po || '', String(r.status_teks || '').trim(), grupTag(r.status_grup), r.channel || '', D(r.tgl_po), r.deadline || '', D(r.tgl_kirim), D(r.diperbarui), num(r.jumlah_item), r.set, r.pcs, r.unit, r.ada_sample ? 'Ya' : '', r.catatan || '']));
      w2.columns = [{ width: 13 }, { width: 36 }, { width: 18 }, { width: 20 }, { width: 18 }, { width: 26 }, { width: 28 }, { width: 16 }, { width: 14 }, { width: 13 }, { width: 16 }, { width: 13 }, { width: 13 }, { width: 10 }, { width: 8 }, { width: 8 }, { width: 8 }, { width: 8 }, { width: 40 }];
      [10, 12, 13].forEach((c) => { w2.getColumn(c).numFmt = DATEF; });
      [14, 15, 16, 17].forEach((c) => { w2.getColumn(c).numFmt = NUMF; });
      w2.views = [{ state: 'frozen', ySplit: 1, xSplit: 2 }];
      w2.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 19 } };

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
    'pg-pic': (el) => { st.pic = el.dataset.pic || ''; load(); },
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
    'pg-pic': (t) => { st.pic = t.value; load(); },
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
      reqId++; recapReq++;           // batalkan respons yang masih di jalan
      clearTimeout(timer);
      setBusy(false);
    },
    isStarted: () => started,
    onClick(el) { const f = ACTIONS[el.dataset.action]; if (f && Object.prototype.hasOwnProperty.call(ACTIONS, el.dataset.action)) f(el); },
    onChange(t) { if (Object.prototype.hasOwnProperty.call(CHANGE, t.id)) CHANGE[t.id](t); },
    onInput(t) {
      if (t.id !== 'pg-cari') return;
      st.cari = t.value;
      clearTimeout(timer);
      timer = setTimeout(() => load(), 350);
    },
    destroy() { alive = false; reqId++; recapReq++; clearTimeout(timer); },
  };
}