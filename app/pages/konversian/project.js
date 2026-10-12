// Tab "Project" di Konversian — BARU 2026-10-12.
//
// MASALAH: satu instansi (mis. RSUD PANDEGA PANGANDARAN) bisa punya beberapa
// konversi (sesi_konversi), dan yang akhirnya di-klik/dibeli di e-Katalog bisa
// campuran item dari 2 konversi berbeda. Gak ada primary key yang nyambungin
// "klik di INAPROC" ke "konversi tertentu" — sales sendiri sering lost contact.
//
// MODEL:  Project -> Transaksi e-Kat -> Item
//   - 1 "klik" = 1 TRANSAKSI INAPROC (negosiasi/pesanan), bukan 1 item. Satu
//     transaksi bisa isi banyak item (lihat konversi_project_transaksi).
//   - Item di dalam transaksi dicatat per KODE PRODUK (konversi_project_klik),
//     opsional dengan qty dan harga akhir dari INAPROC.
//   - "Konversi asal" ditebak dari bukti yang ada (analyzeProject di bawah) dan
//     SELALU bisa di-override manual (pin). Atribusi gak disimpan — dihitung ulang
//     tiap project dibuka, jadi gak pernah basi kalau data bertambah.
//
// BUKTI atribusi (dari yang paling kuat):
//   1. klik yang udah dicatat di Riwayat (sesi.klik_ekat_items)  -> pasti
//      (tiap konversi itu dianggap 1 transaksi "Riwayat Kx", read-only di sini)
//   2. pin manual                                               -> pasti
//   3. kode produk cuma ada di 1 konversi project                -> pasti
//   4. kode ada di >1 konversi -> skor: jangkar GLOBAL (konversi lain yang udah
//      "pasti kena"), jangkar LOKAL (item pasti di TRANSAKSI YANG SAMA — item
//      dalam satu transaksi cenderung dari konversi yang sama, bobot 2x), qty klik ==
//      qty konversi, dan urutan waktu (konversi dibuat SETELAH tanggal transaksi
//      -> hampir mustahil)
//   5. kode gak ada di konversi manapun                          -> "di luar konversi"
//
// NILAI (Rp): qty klik x harga. Harga = harga akhir yang diisi dari INAPROC kalau
// ada, kalau kosong = harga item di konversi asal (ditandai "estimasi"). Nilai tiap
// item dibagi ke konversi sesuai probabilitas atribusinya -> "terealisasi Rp X dari
// Rp Y" per konversi. total_bayar (Total Harga di INAPROC, sudah termasuk ongkir+PPN)
// ditampilkan terpisah dari nilai produk.
//
// Skema: migration-project-konversi.sql + migration-project-transaksi.sql.
// State lintas-file lewat objek S (pola sama kayak set-mendekati.js). Semua REST
// lewat S.sesiFetch.

// ── Helper murni (di-export biar gampang dites) ─────────────────────────

// Normalisasi nama RS buat nebak "ini instansi yang sama": uppercase, buang
// tanda baca & kata generik daerah, rapikan spasi.
export function normRs(s) {
  return String(s || '').toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\b(KAB|KABUPATEN|KOTA|PEMKAB|PEMKOT|PEMDA|PEMERINTAH|DAERAH)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

// Tempelan klik: 1 baris = "kode" atau "kode<tab/spasi/koma>qty". Baris dengan
// beberapa kode sekaligus (dipisah koma/spasi, tanpa angka qty) juga boleh.
export function parsePasteKlik(raw) {
  const out = new Map();
  String(raw || '').split(/\r?\n/).forEach(line => {
    const toks = line.trim().split(/[\t;,\s]+/).filter(Boolean);
    if (!toks.length) return;
    const isNum = (x) => /^\d+([.,]\d+)?$/.test(x);
    if (toks.length === 2 && !isNum(toks[0]) && isNum(toks[1])) {
      out.set(toks[0], { kode: toks[0], qty: Number(toks[1].replace(',', '.')) });
    } else {
      toks.filter(t => !isNum(t)).forEach(kode => { if (!out.has(kode)) out.set(kode, { kode, qty: null }); });
    }
  });
  return [...out.values()];
}

// "Rp28.393.079,00" / "28.393.079" / "28393079" / "4.456.757,5" -> angka. Kosong/gak valid -> null.
export function parseRupiah(raw) {
  let t = String(raw == null ? '' : raw).replace(/rp/ig, '').replace(/\s+/g, '').trim();
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  return isFinite(n) && n >= 0 ? n : null;
}

export const rp = (n) => (n == null || !isFinite(n)) ? '-' : 'Rp' + Math.round(n).toLocaleString('id-ID');

// d = { sesi: [...], items: Map(sesiId -> Map(kode -> {nama, qty, harga})),
//       trx: [rows konversi_project_transaksi], klik: [rows konversi_project_klik] }
export function analyzeProject(d) {
  const mem = d.sesi || [];
  const memById = new Map(mem.map(s => [String(s.id), s]));
  const itemsOf = (s) => d.items.get(String(s.id)) || new Map();
  const itemOf = (s, kode) => itemsOf(s).get(kode);
  const hargaItem = (s, kode) => { const it = itemOf(s, kode); return it && it.harga != null && it.harga !== '' ? Number(it.harga) : null; };

  // kode -> konversi mana aja (di project ini) yang memuatnya
  const kodes = new Map();
  mem.forEach(s => itemsOf(s).forEach((it, kode) => {
    let k = kodes.get(kode);
    if (!k) { k = { kode, nama: it.nama || '', sesi: [] }; kodes.set(kode, k); }
    if (!k.nama && it.nama) k.nama = it.nama;
    k.sesi.push(s);
  }));

  // Transaksi: yang dibuat di project ini + 1 transaksi "virtual" per konversi yang punya klik di Riwayat.
  const trxList = [];
  (d.trx || []).forEach((t, i) => trxList.push({
    id: String(t.id), row: t, virtual: false, n: i + 1, sesi: null, tanggal: t.tanggal || null,
    total: t.total_bayar != null && t.total_bayar !== '' ? Number(t.total_bayar) : null, entries: []
  }));
  mem.forEach(s => {
    if (s.hasil_order === 'klik_ekat' && Array.isArray(s.klik_ekat_items) && s.klik_ekat_items.length)
      trxList.push({ id: 'sesi:' + s.id, row: null, virtual: true, n: null, sesi: s, tanggal: null, total: null, entries: [] });
  });
  const trxById = new Map(trxList.map(t => [t.id, t]));

  // Entry = 1 item di dalam 1 transaksi.
  const entries = [];
  const mk = (t, kode, o) => {
    const e = {
      key: t.id + '|' + kode, trx: t, kode,
      nama: o.nama || (kodes.get(kode) || {}).nama || '',
      qty: o.qty != null && o.qty !== '' ? Number(o.qty) : null,
      harga: o.harga != null && o.harga !== '' ? Number(o.harga) : null,
      row: o.row || null, fromSesi: o.fromSesi || null, pinned: o.pinned || null,
      cands: [], status: '', value: 0, est: false, unknown: false
    };
    entries.push(e); t.entries.push(e);
    return e;
  };
  (d.klik || []).forEach(r => {
    const t = trxById.get(String(r.transaksi_id));
    if (!t) return;
    const p = r.pinned_sesi_id != null ? String(r.pinned_sesi_id) : null;
    mk(t, r.kode_produk, { nama: r.nama_produk, qty: r.qty, harga: r.harga, row: r, pinned: p && memById.has(p) ? p : null }); // pin ke konversi yang bukan anggota = diabaikan
  });
  trxList.filter(t => t.virtual).forEach(t => {
    const s = t.sesi;
    const qm = (s.klik_ekat_qty && typeof s.klik_ekat_qty === 'object' && !Array.isArray(s.klik_ekat_qty)) ? s.klik_ekat_qty : {};
    s.klik_ekat_items.forEach(kode => {
      const it = itemOf(s, kode);
      mk(t, kode, { qty: qm[kode] != null ? qm[kode] : (it ? it.qty : null), fromSesi: s });
    });
  });

  // Pass 1: yang pasti. Sekalian hitung jangkar global + lokal (per transaksi).
  const gA = new Map(), lA = new Map();
  const bump = (e, s) => {
    const k = String(s.id);
    gA.set(k, (gA.get(k) || 0) + 1);
    let m = lA.get(e.trx.id);
    if (!m) { m = new Map(); lA.set(e.trx.id, m); }
    m.set(k, (m.get(k) || 0) + 1);
  };
  entries.forEach(e => {
    const cs = (kodes.get(e.kode) || { sesi: [] }).sesi;
    if (e.fromSesi) { e.status = 'confirmed'; e.cands = [{ s: e.fromSesi, p: 1 }]; bump(e, e.fromSesi); }
    else if (e.pinned) { e.status = 'pinned'; e.cands = [{ s: memById.get(e.pinned), p: 1 }]; bump(e, e.cands[0].s); }
    else if (!cs.length) { e.status = 'orphan'; }
    else if (cs.length === 1) { e.status = 'sure'; e.cands = [{ s: cs[0], p: 1 }]; bump(e, cs[0]); }
    else { e.status = 'ambiguous'; e._cs = cs; }
  });
  // Pass 2: yang ambigu, dinilai pakai jangkar + qty + waktu.
  entries.forEach(e => {
    if (e.status !== 'ambiguous') return;
    const loc = lA.get(e.trx.id) || new Map();
    const scored = e._cs.map(s => {
      const k = String(s.id);
      let sc = 1 + (gA.get(k) || 0) + 2 * (loc.get(k) || 0);
      const it = itemOf(s, e.kode);
      if (e.qty != null && it && it.qty != null && Number(it.qty) === Number(e.qty)) sc += 0.5;
      if (e.trx.tanggal) {
        const tTrx = new Date(e.trx.tanggal + 'T23:59:59').getTime();
        const tSesi = Date.parse(s.updated_at);
        if (isFinite(tTrx) && isFinite(tSesi) && tSesi > tTrx) sc *= 0.25; // konversi baru dibuat sesudah transaksi
      }
      return { s, sc };
    });
    const sum = scored.reduce((a, x) => a + x.sc, 0) || 1;
    e.cands = scored.map(x => ({ s: x.s, p: x.sc / sum })).sort((a, b) => b.p - a.p);
    delete e._cs;
  });

  // Nilai (Rp): dibagi ke konversi sesuai probabilitas atribusi.
  const realized = new Map(mem.map(s => [String(s.id), 0]));
  entries.forEach(e => {
    const q = e.qty != null ? e.qty : 1;
    let tot = 0, unk = false;
    if (e.cands.length) {
      e.cands.forEach(c => {
        const pr = e.harga != null ? e.harga : hargaItem(c.s, e.kode);
        if (pr == null) { unk = true; return; }
        const v = c.p * q * pr;
        tot += v;
        realized.set(String(c.s.id), (realized.get(String(c.s.id)) || 0) + v);
      });
    } else if (e.harga != null) tot = q * e.harga;
    else unk = true;
    e.value = tot; e.est = e.harga == null && e.cands.length > 0; e.unknown = unk;
  });
  trxList.forEach(t => {
    t.produk = t.entries.reduce((a, e) => a + e.value, 0);
    t.est = t.entries.some(e => e.est);
    t.unknown = t.entries.filter(e => e.unknown).length;
    t.origin = new Map();
    t.entries.forEach(e => { const top = e.cands[0]; if (top) t.origin.set(String(top.s.id), (t.origin.get(String(top.s.id)) || 0) + 1); });
  });
  const projTrx = trxList.filter(t => !t.virtual);
  const withTotal = projTrx.filter(t => t.total != null);
  const value = {
    produk: trxList.reduce((a, t) => a + t.produk, 0),
    est: trxList.some(t => t.est),
    unknownItems: trxList.reduce((a, t) => a + t.unknown, 0),
    totalTrx: withTotal.reduce((a, t) => a + t.total, 0),
    trxWithTotal: withTotal.length,
    trxCount: projTrx.length
  };

  const stats = new Map(mem.map(s => {
    const items = itemsOf(s);
    let potential = 0;
    items.forEach(it => { if (it.harga != null && it.harga !== '' && it.qty != null) potential += Number(it.harga) * Number(it.qty); });
    return [String(s.id), { hit: new Set(), maybe: new Set(), total: items.size, potential, realized: 0 }];
  }));
  entries.forEach(e => e.cands.forEach((c, i) => {
    const x = stats.get(String(c.s.id));
    if (!x) return;
    if (e.status === 'ambiguous' && i > 0) x.maybe.add(e.kode); else x.hit.add(e.kode);
  }));
  stats.forEach((x, k) => {
    [...x.maybe].forEach(kd => { if (x.hit.has(kd)) x.maybe.delete(kd); });
    x.realized = realized.get(k) || 0;
    x.hit = x.hit.size; x.maybe = x.maybe.size;
  });

  const byKode = new Map();
  entries.forEach(e => { const a = byKode.get(e.kode) || []; a.push(e); byKode.set(e.kode, a); });
  const counts = { sure: 0, amb: 0, orphan: 0, kodeKlik: byKode.size, trx: projTrx.length, sesiTanpaKlik: 0 };
  entries.forEach(e => {
    if (e.status === 'orphan') counts.orphan++;
    else if (e.status === 'ambiguous') counts.amb++;
    else counts.sure++;
  });
  stats.forEach(x => { if (!x.hit && !x.maybe) counts.sesiTanpaKlik++; });

  // Baris tabel: semua kode di konversi project, lalu klik "di luar konversi".
  const rows = [...kodes.values()];
  byKode.forEach((es, kode) => { if (!kodes.has(kode)) rows.push({ kode, nama: es[0].nama, sesi: [] }); });
  return { kodes, entries, byKode, trxList, stats, counts, rows, value };
}

// ── UI ──────────────────────────────────────────────────────────────────
export function installProject(S) {
  const root = document.getElementById('prj-root');
  if (!root) return;
  const esc = (s) => S.escapeHtmlAttr(s);
  const $ = (id) => document.getElementById(id);
  const PRJ = 'konversi_project';
  const TRX = 'konversi_project_transaksi';
  const KLIK = 'konversi_project_klik';
  const HASIL = { '': 'Menunggu feedback', jadi_sph: 'Jadi SPH', klik_ekat: 'Klik e-Kat', jadi_order: 'Jadi order (lama)', tanpa_order: 'Tidak jadi (lama)' };
  const JENIS = { negosiasi: 'Negosiasi', pesanan: 'Pesanan' };
  const st = {
    view: 'list', cur: null, d: null, a: null, token: 0, onlyKlik: false, suggestions: [],
    activeTrx: null, editTrx: null,
    pickRows: [], pickMore: false, pickSeq: 0, prjNames: null, pickScope: 'semua', pickMatches: new Map(), pickIds: [], pickCapped: false, pickToks: []
  };
  let pickTimer = null;

  async function api(path, opts) {
    const res = await S.sesiFetch(path, opts);
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      const err = new Error(e.message || e.hint || ('HTTP ' + res.status));
      err.code = e.code;
      throw err;
    }
    if (res.status === 204) return null;
    return res.json().catch(() => null);
  }
  function friendly(err) {
    const m = String(err && err.message || '');
    if (err && err.code === '23505' && /no_uidx|no_transaksi/i.test(m)) return 'Nomor transaksi itu sudah ada di project ini.';
    if (err && (err.code === 'PGRST205' || err.code === '42P01' || /konversi_project/i.test(m) && /not find|does not exist|schema cache/i.test(m)))
      return 'Tabel project belum ada — jalankan migration-project-konversi.sql lalu migration-project-transaksi.sql di Supabase dulu.';
    if (err && (err.code === 'PGRST204' || err.code === '42703' || /project_id|transaksi_id/i.test(m)))
      return 'Kolom project/transaksi belum ada — jalankan migration-project-konversi.sql lalu migration-project-transaksi.sql di Supabase dulu.';
    return m || 'Terjadi kesalahan.';
  }
  const fail = (prefix, err) => { console.error(prefix, err); S.showToast(`${prefix}: ${friendly(err)}`, 'error'); };
  const idOk = (x) => /^[\w-]+$/.test(String(x));
  const fmtDate = (iso) => { if (!iso) return ''; const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}/${y}`; };
  const numFmt = (n) => (n == null || !isFinite(n)) ? '' : Number(n).toLocaleString('id-ID');

  // ── LIST ──────────────────────────────────────────────────────────────
  async function loadProjects() {
    st.view = 'list'; st.cur = null; st.d = null; st.a = null;
    root.innerHTML = `<div class="prj-loading"><i class="ti ti-loader-2"></i> Memuat project…</div>`;
    try {
      const rows = await api(`${PRJ}?select=id,nama,instansi,updated_at,${S.SESI_TABLE}!project_id(count),${TRX}!project_id(total_bayar)&order=updated_at.desc&limit=300`);
      st.suggestions = await loadSuggestions().catch(e => { console.warn('Saran project gagal:', e); return []; });
      renderList(rows || []);
    } catch (err) {
      root.innerHTML = `<div class="prj-error">${esc(friendly(err))}</div>`;
    }
  }
  S.loadProjects = loadProjects;

  // Konversi selesai yang belum masuk project, dikelompokkan per nama RS mirip —
  // jalan pintas buat data lama (1 klik = 1 project dari beberapa konversi).
  async function loadSuggestions() {
    const rows = await api(`${S.SESI_TABLE}?status=eq.selesai&project_id=is.null&nama_rs=not.is.null&select=id,nama_rs&order=updated_at.desc&limit=1000`);
    const groups = new Map();
    (rows || []).forEach(r => {
      const key = normRs(r.nama_rs);
      if (!key) return;
      const g = groups.get(key) || { key, ids: [], names: new Map() };
      g.ids.push(String(r.id));
      g.names.set(r.nama_rs, (g.names.get(r.nama_rs) || 0) + 1);
      groups.set(key, g);
    });
    return [...groups.values()].filter(g => g.ids.length >= 2).map(g => ({
      ids: g.ids,
      nama: [...g.names.entries()].sort((a, b) => b[1] - a[1])[0][0]
    })).sort((a, b) => b.ids.length - a.ids.length).slice(0, 12);
  }

  function renderList(rows) {
    const cards = rows.map(p => {
      const nSesi = (p[S.SESI_TABLE] && p[S.SESI_TABLE][0] && p[S.SESI_TABLE][0].count) || 0;
      const trx = p[TRX] || [];
      const withTotal = trx.filter(t => t.total_bayar != null);
      const totalTrx = withTotal.reduce((a, t) => a + Number(t.total_bayar), 0);
      return `<div class="rcard prj-card" data-act="open" data-id="${esc(p.id)}" tabindex="0" role="button">
        <div class="rc-head"><div class="rc-title">
          <div class="rc-name">${esc(p.nama)}</div>
          ${p.instansi ? `<div class="rc-sub"><span><i class="ti ti-building-hospital"></i>${esc(p.instansi)}</span></div>` : ''}
        </div></div>
        <div class="rc-stats">
          <span class="rc-stat"><i class="ti ti-arrows-left-right"></i>${nSesi} konversi</span>
          <span class="rc-stat"><i class="ti ti-click"></i>${trx.length} transaksi</span>
          ${withTotal.length ? `<span class="rc-stat"><i class="ti ti-cash"></i>${esc(rp(totalTrx))}${withTotal.length < trx.length ? ' <span class="prj-hint">(' + withTotal.length + ' dari ' + trx.length + ' terisi)</span>' : ''}</span>` : ''}
          <span class="rc-stat rc-time"><i class="ti ti-clock"></i>${esc(S.sesiTimeAgo(p.updated_at))}</span>
        </div>
      </div>`;
    }).join('');
    const sug = st.suggestions.length ? `<div class="prj-sug">
      <div class="prj-sec-head"><b><i class="ti ti-bulb"></i> Saran dari nama RS yang sama</b><span class="prj-hint">konversi selesai yang belum masuk project</span></div>
      ${st.suggestions.map((g, i) => `<div class="prj-sug-row">
        <span class="prj-sug-name">${esc(g.nama)}</span><span class="rc-stat">${g.ids.length} konversi</span>
        <button type="button" class="rc-act" data-act="sug-create" data-i="${i}"><i class="ti ti-folder-plus"></i><span>Buat project</span></button>
      </div>`).join('')}</div>` : '';
    root.innerHTML = `
      <div class="sesi-toolbar prj-toolbar">
        <span class="prj-lead">Kelompokkan beberapa konversi satu instansi jadi satu project, lalu catat transaksi e-Katalog yang terjadi beserta item dan nilainya.</span>
        <button class="pr-add-clip-btn" type="button" data-act="new-toggle"><i class="ti ti-folder-plus"></i> Project Baru</button>
        <button class="toggle-btn" type="button" data-act="refresh" title="Muat ulang"><i class="ti ti-refresh"></i></button>
      </div>
      <div class="prj-new" id="prj-new" style="display:none">
        <input id="prj-new-nama" class="prj-input" type="text" placeholder="Nama project, mis. RSUD PANDEGA PANGANDARAN" autocomplete="off">
        <input id="prj-new-instansi" class="prj-input" type="text" placeholder="Instansi (opsional)" autocomplete="off">
        <button class="pr-add-clip-btn" type="button" data-act="new-save"><i class="ti ti-check"></i> Buat</button>
      </div>
      ${sug}
      ${rows.length ? `<div class="prj-list">${cards}</div>` : `<div class="clip-empty"><i class="ti ti-folders"></i><p>Belum ada project.<br>Klik "Project Baru", atau pakai saran di atas kalau ada.</p></div>`}`;
  }

  async function createProject(nama, instansi, sesiIds) {
    const made = await api(PRJ, {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ nama, instansi: instansi || null })
    });
    const p = made && made[0];
    if (!p) throw new Error('Gagal membuat project.');
    const ids = (sesiIds || []).filter(idOk);
    if (ids.length) await api(`${S.SESI_TABLE}?id=in.(${ids.join(',')})`, { method: 'PATCH', body: JSON.stringify({ project_id: p.id }) });
    return p;
  }

  // ── DETAIL ────────────────────────────────────────────────────────────
  async function fetchDetail(id) {
    const ide = encodeURIComponent(id);
    const [prj, sesi, trx, klik] = await Promise.all([
      api(`${PRJ}?id=eq.${ide}&select=*`),
      api(`${S.SESI_TABLE}?project_id=eq.${ide}&select=id,nama_rs,pic_marsup,nama_sales,status,hasil_order,updated_at,klik_ekat_items,klik_ekat_qty&order=updated_at.asc`),
      api(`${TRX}?project_id=eq.${ide}&select=*&order=created_at.asc`),
      api(`${KLIK}?project_id=eq.${ide}&select=*&order=created_at.asc`)
    ]);
    if (!prj || !prj[0]) throw new Error('Project tidak ditemukan.');
    const items = new Map();
    const put = (sid, kode, nama, qty, harga) => {
      if (!kode) return;
      const k = String(sid);
      if (!items.has(k)) items.set(k, new Map());
      items.get(k).set(kode, { kode, nama: nama || '', qty: qty != null ? Number(qty) : null, harga: harga != null ? Number(harga) : null });
    };
    const ids = (sesi || []).map(s => String(s.id)).filter(idOk);
    if (ids.length) {
      const inList = ids.join(',');
      const soft = (p) => p.catch(e => { console.warn('Project: ambil item gagal', e); return []; });
      const [recs, cli] = await Promise.all([
        soft(api(`konversi_record?sesi_id=in.(${inList})&select=sesi_id,revisi,konversi_item(kode_produk,nama_produk,qty,harga)&order=revisi.asc&limit=1000`)),
        soft(api(`${S.SESI_ITEM_TABLE}?sesi_id=in.(${inList})&select=sesi_id,kode_produk,nama_produk,qty,harga_ekat&limit=5000`))
      ]);
      // Isi clipboard dulu, lalu record per revisi naik (record terbaru menang) —
      // klik bisa saja jatuh ke item REV lama, jadi digabung, bukan dipilih satu.
      (cli || []).forEach(r => put(r.sesi_id, r.kode_produk, r.nama_produk, r.qty, r.harga_ekat));
      (recs || []).forEach(rec => (rec.konversi_item || []).forEach(i => put(rec.sesi_id, i.kode_produk, i.nama_produk, i.qty, i.harga)));
    }
    return { project: prj[0], sesi: sesi || [], trx: trx || [], klik: klik || [], items };
  }

  async function openProject(id) {
    st.view = 'detail'; st.cur = id; st.onlyKlik = false; st.activeTrx = null; st.editTrx = null;
    const my = ++st.token;
    root.innerHTML = `<div class="prj-loading"><i class="ti ti-loader-2"></i> Membuka project…</div>`;
    try {
      const d = await fetchDetail(id);
      if (my !== st.token) return;
      st.d = d;
      renderShell();
      renderDynamic();
    } catch (err) {
      if (my !== st.token) return;
      root.innerHTML = `<div class="prj-error">${esc(friendly(err))}</div><button class="toggle-btn" type="button" data-act="back" style="margin:8px 12px"><i class="ti ti-arrow-left"></i> Kembali</button>`;
    }
  }
  S.openProject = openProject;

  async function reloadDetail() {
    const my = ++st.token;
    try {
      const d = await fetchDetail(st.cur);
      if (my !== st.token) return;
      st.d = d;
      if (st.activeTrx && !d.trx.some(t => String(t.id) === st.activeTrx)) st.activeTrx = null;
      renderDynamic();
    } catch (err) { fail('Gagal memuat ulang project', err); }
  }

  function renderShell() {
    const p = st.d.project;
    root.innerHTML = `<div class="prj-detail">
      <div class="prj-top">
        <button class="toggle-btn" type="button" data-act="back"><i class="ti ti-arrow-left"></i> Semua Project</button>
        <span style="flex:1"></span>
        <button class="rc-act prj-danger" type="button" data-act="del-prj"><i class="ti ti-trash"></i><span>Hapus project</span></button>
      </div>
      <div class="prj-meta">
        <input id="prj-f-nama" class="prj-input prj-input-title" type="text" value="${esc(p.nama)}" placeholder="Nama project" autocomplete="off">
        <input id="prj-f-instansi" class="prj-input" type="text" value="${esc(p.instansi || '')}" placeholder="Instansi (opsional)" autocomplete="off">
        <textarea id="prj-f-catatan" class="prj-input" rows="2" placeholder="Catatan lapangan (siapa sales-nya, kondisi tender, dst)">${esc(p.catatan || '')}</textarea>
      </div>
      <div id="prj-summary" class="prj-summary"></div>
      <div class="prj-sec">
        <div class="prj-sec-head"><b>Konversi dalam project</b>
          <button class="toggle-btn" type="button" data-act="picker-toggle"><i class="ti ti-plus"></i> Tambah konversi</button></div>
        <div id="prj-picker" class="prj-picker" style="display:none">
          <input id="prj-pick-q" class="prj-input" type="text" placeholder="Cari nama RS, sales, PIC, atau barang (mis. vienna)…" autocomplete="off" value="${esc(p.instansi || '')}">
          <div class="riwayat-scope" role="group" aria-label="Cari berdasarkan">
            <button type="button" class="riwayat-scope-btn active" data-act="pick-scope" data-scope="semua">Semua</button>
            <button type="button" class="riwayat-scope-btn" data-act="pick-scope" data-scope="barang"><i class="ti ti-package"></i> Barang</button>
            <button type="button" class="riwayat-scope-btn" data-act="pick-scope" data-scope="header"><i class="ti ti-building-hospital"></i> RS · PIC · Sales</button>
          </div>
          <div class="prj-hint">Kata kunci awal cuma tebakan dari instansi — bukan batasan. Ganti, hapus, atau kosongkan buat lihat semua konversi. "Barang" nyari ke isi konversi (kode/nama produk), jadi bisa ketemu konversi mana yang pernah memuat produk yang di-klik. Konversi yang sudah di project lain juga bisa dipindah ke sini.</div>
          <div id="prj-pick-res"></div>
        </div>
        <div id="prj-sesi-list"></div>
      </div>
      <div class="prj-sec">
        <div class="prj-sec-head"><b>Transaksi e-Katalog</b>
          <button class="toggle-btn" type="button" data-act="trx-new-toggle"><i class="ti ti-plus"></i> Transaksi baru</button></div>
        <div class="prj-note">1 transaksi = 1 klik di INAPROC (negosiasi atau pesanan), yang bisa berisi banyak item. Aktifkan transaksinya, lalu centang item yang ada di dalamnya. Nomor, tanggal, dan total boleh dikosongkan kalau infonya gak ada.</div>
        <div id="prj-trx-new" class="prj-trx-form" style="display:none"></div>
        <div id="prj-trx-list"></div>
      </div>
      <div class="prj-sec">
        <div class="prj-sec-head"><b>Item</b><span id="prj-active-label" class="prj-hint"></span></div>
        <div class="prj-klik-tools">
          <label class="prj-tool prj-grow"><span>Filter</span><input id="prj-klik-filter" type="text" class="prj-input" placeholder="Kode atau nama produk…" autocomplete="off"></label>
          <button class="toggle-btn" type="button" id="prj-only-klik" data-act="only-klik"><i class="ti ti-filter"></i> Hanya yang di-klik</button>
          <button class="toggle-btn" type="button" data-act="paste-toggle"><i class="ti ti-clipboard-text"></i> Tempel kode</button>
        </div>
        <div id="prj-paste" class="prj-paste" style="display:none">
          <textarea id="prj-paste-ta" class="prj-input prj-mono" rows="4" placeholder="1 baris = 1 kode, boleh dengan qty setelahnya (masuk ke transaksi yang aktif):&#10;RB999-KE921-B99-U238&#9;2&#10;RB999-KE921-B99-U109"></textarea>
          <button class="pr-add-clip-btn" type="button" data-act="paste-save"><i class="ti ti-check"></i> Simpan ke transaksi aktif</button>
          <span id="prj-paste-status" class="prj-hint"></span>
        </div>
        <div id="prj-klik-wrap"></div>
      </div>
    </div>`;
  }

  const sesiIdx = (s) => st.d.sesi.findIndex(x => String(x.id) === String(s.id));
  const itemOf = (s, kode) => { const m = st.d.items.get(String(s.id)); return m ? m.get(kode) : undefined; };
  const chip = (s) => { const i = sesiIdx(s); return `<span class="prj-chip prj-c${i % 6}" title="${esc(s.nama_rs || '')}">K${i + 1}</span>`; };
  const trxTitle = (t) => t.virtual ? `Riwayat · ${t.sesi.nama_rs || 'konversi'}` : (t.row.no_transaksi || `Transaksi ${t.n}`);
  const trxChip = (t) => `<span class="prj-trx-chip${t.virtual ? ' virt' : ''}" title="${esc(trxTitle(t))}">${t.virtual ? 'Riwayat K' + (sesiIdx(t.sesi) + 1) : 'T' + t.n}</span>`;
  const activeObj = () => (st.a && st.a.trxList.find(t => t.id === st.activeTrx && !t.virtual)) || null;
  const valText = (v, est) => `${esc(rp(v))}${est ? '<span class="prj-est" title="Sebagian pakai harga dari konversi (belum diisi harga akhir)"> ~</span>' : ''}`;

  function renderDynamic() {
    st.a = analyzeProject(st.d);
    renderSummary(); renderSesiList(); renderTrxList(); renderTable();
  }

  function renderSummary() {
    const c = st.a.counts, v = st.a.value, n = st.d.sesi.length;
    const el = $('prj-summary'); if (!el) return;
    const partial = v.trxCount && v.trxWithTotal < v.trxCount;
    el.innerHTML = [
      `<span class="prj-pill"><b>${n}</b> konversi</span>`,
      `<span class="prj-pill"><b>${c.trx}</b> transaksi</span>`,
      `<span class="prj-pill"><b>${c.kodeKlik}</b> item di-klik</span>`,
      c.sure ? `<span class="prj-pill prj-ok"><b>${c.sure}</b> asal jelas</span>` : '',
      c.amb ? `<span class="prj-pill prj-warn"><b>${c.amb}</b> asal ambigu</span>` : '',
      c.orphan ? `<span class="prj-pill prj-bad"><b>${c.orphan}</b> di luar konversi</span>` : '',
      (n && c.sesiTanpaKlik) ? `<span class="prj-pill"><b>${c.sesiTanpaKlik}</b> konversi belum ada klik</span>` : '',
      v.produk > 0 ? `<span class="prj-pill prj-val" title="Qty x harga item yang di-klik (belum PPN/ongkir)">Realisasi produk <b>${valText(v.produk, v.est)}</b></span>` : '',
      v.trxWithTotal ? `<span class="prj-pill prj-val" title="Total Harga di INAPROC (sudah termasuk ongkir + PPN)">Total transaksi <b>${esc(rp(v.totalTrx))}</b>${partial ? ` <span class="prj-hint">(${v.trxWithTotal} dari ${v.trxCount})</span>` : ''}</span>` : '',
      v.unknownItems ? `<span class="prj-pill prj-warn" title="Item yang belum punya harga (gak ada di konversi & harga akhir belum diisi)"><b>${v.unknownItems}</b> item belum ada harga</span>` : ''
    ].join('');
  }

  function renderSesiList() {
    const el = $('prj-sesi-list'); if (!el) return;
    if (!st.d.sesi.length) {
      el.innerHTML = `<div class="prj-empty">Belum ada konversi di project ini. Klik "Tambah konversi" dan cari berdasarkan nama RS, sales, atau barang.</div>`;
      return;
    }
    el.innerHTML = st.d.sesi.map((s, i) => {
      const x = st.a.stats.get(String(s.id)) || { hit: 0, maybe: 0, total: 0, potential: 0, realized: 0 };
      return `<div class="prj-sesi">
        <span class="prj-chip prj-c${i % 6}">K${i + 1}</span>
        <div class="prj-sesi-main">
          <div class="prj-sesi-name">${esc(s.nama_rs || '(Nama RS belum diisi)')}</div>
          <div class="prj-sesi-sub">${esc(s.nama_sales || '-')} · ${esc(s.status === 'berjalan' ? 'Berjalan' : 'Selesai')} · ${esc(HASIL[s.hasil_order || ''] || s.hasil_order)} · ${esc(S.sesiTimeAgo(s.updated_at))}</div>
        </div>
        <div class="prj-sesi-cov" title="Item konversi ini yang tercatat di-klik, dan nilai yang terealisasi dari nilai itemnya">
          <div><b>${x.hit}</b>/${x.total} item kena${x.maybe ? ` <span class="prj-hint">+${x.maybe} ambigu</span>` : ''}</div>
          ${x.realized > 0 || x.potential > 0 ? `<div class="prj-sesi-val"><b>${esc(rp(x.realized))}</b> dari ${esc(rp(x.potential))}${x.potential > 0 && x.realized > 0 ? ` <span class="prj-hint">(${Math.round(x.realized / x.potential * 100)}%)</span>` : ''}</div>` : ''}
        </div>
        <button class="rc-act" type="button" data-act="rm-sesi" data-id="${esc(s.id)}" title="Keluarkan dari project"><i class="ti ti-unlink"></i></button>
      </div>`;
    }).join('');
  }

  // ── Transaksi ─────────────────────────────────────────────────────────
  function trxFormHtml(prefix, t) {
    const r = t || {};
    return `<div class="prj-trx-fields">
      <label class="prj-tool prj-grow"><span>No. negosiasi / pesanan (opsional)</span><input id="${prefix}-no" class="prj-input prj-mono" type="text" value="${esc(r.no_transaksi || '')}" placeholder="mis. EP-01M4PV…" autocomplete="off"></label>
      <label class="prj-tool"><span>Jenis</span><select id="${prefix}-jenis" class="prj-input"><option value="">—</option>${Object.keys(JENIS).map(k => `<option value="${k}" ${r.jenis === k ? 'selected' : ''}>${JENIS[k]}</option>`).join('')}</select></label>
      <label class="prj-tool"><span>Tanggal</span><input id="${prefix}-tgl" class="prj-input" type="date" value="${esc(r.tanggal || '')}"></label>
      <label class="prj-tool"><span>Total Harga di INAPROC</span><input id="${prefix}-total" class="prj-input" type="text" inputmode="decimal" value="${r.total_bayar != null ? esc(numFmt(r.total_bayar)) : ''}" placeholder="mis. 28.393.079"></label>
    </div>`;
  }
  function readTrxForm(prefix) {
    const totalRaw = ($(`${prefix}-total`).value || '').trim();
    const total = parseRupiah(totalRaw);
    if (totalRaw && total == null) { S.showToast('Total Harga gak terbaca — isi angka saja, mis. 28.393.079', 'error'); return null; }
    return {
      no_transaksi: ($(`${prefix}-no`).value || '').trim() || null,
      jenis: $(`${prefix}-jenis`).value || null,
      tanggal: $(`${prefix}-tgl`).value || null,
      total_bayar: total
    };
  }

  function renderTrxList() {
    const el = $('prj-trx-list'); if (!el) return;
    const lbl = $('prj-active-label');
    const act = activeObj();
    if (lbl) lbl.innerHTML = act ? `centang item = masuk ke <b>${esc(trxTitle(act))}</b>` : 'belum ada transaksi aktif — mencentang item akan membuat transaksi baru';
    if (!st.a.trxList.length) { el.innerHTML = `<div class="prj-empty">Belum ada transaksi. Klik "Transaksi baru", atau langsung centang item di bawah (transaksi dibuat otomatis).</div>`; return; }
    el.innerHTML = st.a.trxList.map(t => {
      const origin = [...t.origin.entries()].sort((a, b) => b[1] - a[1]).map(([sid, n]) => {
        const s = st.d.sesi.find(x => String(x.id) === sid);
        return s ? `<span class="prj-cand">${chip(s)}<b>×${n}</b></span>` : '';
      }).join('');
      if (t.virtual) {
        return `<div class="prj-trx virt">
          <div class="prj-trx-head">${trxChip(t)}<span class="prj-trx-title">${esc(trxTitle(t))}</span><span class="prj-hint">dicatat di Riwayat — ubah di sana</span></div>
          <div class="prj-trx-body"><span>${t.entries.length} item</span><span>Produk ${valText(t.produk, t.est)}</span>${origin ? `<span>Asal: ${origin}</span>` : ''}</div></div>`;
      }
      const isActive = t.id === st.activeTrx;
      if (st.editTrx === t.id) {
        return `<div class="prj-trx editing">
          <div class="prj-trx-head">${trxChip(t)}<span class="prj-trx-title">Ubah transaksi</span></div>
          ${trxFormHtml('prj-edit', t.row)}
          <div class="prj-trx-actions">
            <button class="pr-add-clip-btn" type="button" data-act="trx-edit-save" data-id="${esc(t.id)}"><i class="ti ti-check"></i> Simpan</button>
            <button class="toggle-btn" type="button" data-act="trx-edit-cancel">Batal</button>
          </div></div>`;
      }
      const meta = [t.row.jenis ? JENIS[t.row.jenis] : '', t.tanggal ? fmtDate(t.tanggal) : ''].filter(Boolean).join(' · ');
      return `<div class="prj-trx${isActive ? ' active' : ''}">
        <div class="prj-trx-head">${trxChip(t)}<span class="prj-trx-title">${esc(trxTitle(t))}</span>${meta ? `<span class="prj-hint">${esc(meta)}</span>` : ''}
          <span style="flex:1"></span>
          ${isActive ? `<span class="prj-st prj-st-sure"><i class="ti ti-check"></i> aktif</span>` : `<button class="toggle-btn" type="button" data-act="trx-active" data-id="${esc(t.id)}">Aktifkan</button>`}
          <button class="rc-act" type="button" data-act="trx-edit" data-id="${esc(t.id)}" title="Ubah"><i class="ti ti-pencil"></i></button>
          <button class="rc-act prj-danger" type="button" data-act="trx-del" data-id="${esc(t.id)}" title="Hapus transaksi"><i class="ti ti-trash"></i></button>
        </div>
        <div class="prj-trx-body">
          <span>${t.entries.length} item</span>
          <span>Produk ${valText(t.produk, t.est)}</span>
          ${t.total != null ? `<span title="Total Harga di INAPROC (termasuk ongkir + PPN)">Total <b>${esc(rp(t.total))}</b></span>` : `<span class="prj-hint">total belum diisi</span>`}
          ${origin ? `<span>Asal: ${origin}${t.origin.size > 1 ? ' <span class="prj-st prj-st-amb">campuran</span>' : ''}</span>` : ''}
          ${t.unknown ? `<span class="prj-hint">${t.unknown} item belum ada harga</span>` : ''}
        </div></div>`;
    }).join('');
  }

  async function createTrxRow(fields) {
    const body = Object.assign({ project_id: st.cur }, fields || {});
    const made = await api(TRX, { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(body) });
    const row = made && made[0];
    if (!row) throw new Error('Gagal membuat transaksi.');
    st.d.trx.push(row);
    st.activeTrx = String(row.id);
    return row;
  }
  // Transaksi aktif = tempat item yang dicentang/ditempel masuk. Belum ada -> bikin otomatis.
  async function ensureActive() {
    const a = activeObj();
    if (a) return a.row;
    const row = await createTrxRow({});
    S.showToast(`Transaksi baru dibuat (T${st.d.trx.length}) — isi nomor/tanggal/total lewat tombol ubah.`);
    return row;
  }

  // ── Item / tabel ──────────────────────────────────────────────────────
  function attrHtml(e) {
    if (e.status === 'confirmed') return `${chip(e.cands[0].s)} <span class="prj-st prj-st-sure" title="Dicatat di Riwayat konversi itu sendiri"><i class="ti ti-lock"></i> dari Riwayat</span>`;
    if (e.status === 'pinned') return `${chip(e.cands[0].s)} <span class="prj-st prj-st-sure"><i class="ti ti-pin"></i> manual</span>`;
    if (e.status === 'sure') return `${chip(e.cands[0].s)} <span class="prj-st prj-st-sure">pasti</span>`;
    if (e.status === 'orphan') return `<span class="prj-st prj-st-orph">di luar konversi</span>`;
    return e.cands.map(c => `<span class="prj-cand">${chip(c.s)}<b>${Math.round(c.p * 100)}%</b></span>`).join('') + ` <span class="prj-st prj-st-amb">tebakan</span>`;
  }
  function pinHtml(e) {
    if (!e.row || e.fromSesi || e.status === 'orphan') return '';
    const cands = (st.a.kodes.get(e.kode) || { sesi: [] }).sesi;
    const ds = `data-trx="${esc(e.trx.id)}" data-kode="${esc(e.kode)}"`;
    if (cands.length < 2) return e.status === 'pinned' ? `<button class="rc-act" type="button" data-act="unpin" ${ds} title="Lepas pin"><i class="ti ti-pin-off"></i></button>` : '';
    return `<select class="prj-pin" ${ds} title="Pin asal konversi secara manual">
      <option value="">Otomatis</option>
      ${cands.map(s => `<option value="${esc(s.id)}" ${e.pinned === String(s.id) ? 'selected' : ''}>K${sesiIdx(s) + 1} · ${esc((s.nama_rs || '').slice(0, 28))}</option>`).join('')}
    </select>`;
  }

  function renderTable() {
    const wrap = $('prj-klik-wrap'); if (!wrap) return;
    const btn = $('prj-only-klik'); if (btn) btn.classList.toggle('on', st.onlyKlik);
    const q = (($('prj-klik-filter') || {}).value || '').trim().toLowerCase();
    let rows = st.a.rows;
    if (st.onlyKlik) rows = rows.filter(r => st.a.byKode.has(r.kode));
    if (q) rows = rows.filter(r => `${r.kode} ${r.nama}`.toLowerCase().includes(q));
    if (!st.a.rows.length) { wrap.innerHTML = `<div class="prj-empty">Belum ada item. Tambahkan konversi dulu, atau tempel kode produk yang di-klik.</div>`; return; }
    if (!rows.length) { wrap.innerHTML = `<div class="prj-empty">Tidak ada item yang cocok dengan filter.</div>`; return; }
    const body = rows.map(r => {
      const es = st.a.byKode.get(r.kode) || [];
      const aE = es.find(e => e.trx.id === st.activeTrx) || null;
      const firstIt = r.sesi[0] ? itemOf(r.sesi[0], r.kode) : null;
      const konvPrice = firstIt && firstIt.harga != null ? firstIt.harga : null;
      const qtyKonv = r.sesi.map(s => { const it = itemOf(s, r.kode); return `${it && it.qty != null ? it.qty : '-'}`; }).join(' / ') || '-';
      const nilai = es.reduce((a, e) => a + e.value, 0);
      const nilaiEst = es.some(e => e.est);
      return `<tr class="${es.length ? 'prj-on' : ''} ${es.some(e => e.status === 'orphan') ? 'prj-r-orphan' : ''}" data-kode="${esc(r.kode)}">
        <td class="ek-col"><input type="checkbox" class="prj-cb" ${aE ? 'checked' : ''} title="Di-klik dalam transaksi aktif" aria-label="Masuk transaksi aktif"></td>
        <td class="kode">${esc(r.kode)}</td>
        <td>${esc(r.nama || '')}</td>
        <td>${r.sesi.length ? r.sesi.map(chip).join('') : '<span class="prj-hint">—</span>'}</td>
        <td class="num">${esc(qtyKonv)}</td>
        <td class="num"><input type="number" min="1" step="1" inputmode="numeric" class="prj-qty" value="${aE && aE.qty != null ? esc(aE.qty) : ''}" ${aE ? '' : 'disabled'} aria-label="Qty yang di-klik"></td>
        <td class="num"><input type="text" inputmode="decimal" class="prj-harga" value="${aE && aE.harga != null ? esc(numFmt(aE.harga)) : ''}" placeholder="${konvPrice != null ? esc(numFmt(konvPrice)) : 'harga akhir'}" ${aE ? '' : 'disabled'} aria-label="Harga akhir per unit" title="Harga akhir per unit di INAPROC. Kosong = pakai harga konversi (estimasi)."></td>
        <td class="num">${nilai > 0 ? valText(nilai, nilaiEst) : '<span class="prj-hint">—</span>'}</td>
        <td class="prj-attr">${es.length ? es.map(e => `<div class="prj-attr-line">${trxChip(e.trx)} ${attrHtml(e)} ${pinHtml(e)}</div>`).join('') : '<span class="prj-hint">—</span>'}</td>
      </tr>`;
    }).join('');
    wrap.innerHTML = `<div class="riwayat-peek-wrap prj-table-wrap"><table class="prj-table">
      <thead><tr><th class="ek-col" title="Di-klik dalam transaksi aktif">Klik</th><th>Kode</th><th>Produk</th><th>Ada di</th><th class="num" title="Qty di tiap konversi (urut K1/K2…)">Qty konv.</th><th class="num" title="Qty di transaksi aktif">Qty klik</th><th class="num" title="Harga akhir per unit di transaksi aktif">Harga akhir</th><th class="num" title="Qty x harga, semua transaksi. ~ = sebagian estimasi dari harga konversi">Nilai</th><th>Asal klik</th></tr></thead>
      <tbody>${body}</tbody></table></div>`;
  }

  // ── Aksi data ─────────────────────────────────────────────────────────
  const klikRow = (trxId, kode) => st.d.klik.find(r => String(r.transaksi_id) === String(trxId) && r.kode_produk === kode);
  const kEq = (trxId, kode) => `transaksi_id=eq.${encodeURIComponent(trxId)}&kode_produk=eq.${encodeURIComponent(kode)}`;
  const UPSERT = { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' } };

  async function toggleKlik(kode, on) {
    const k = st.a.kodes.get(kode);
    try {
      if (on) {
        const trx = await ensureActive();
        const it = k && k.sesi[0] ? itemOf(k.sesi[0], kode) : null;
        const body = [{ transaksi_id: trx.id, project_id: st.cur, kode_produk: kode, nama_produk: (k && k.nama) || null, qty: it && it.qty != null ? it.qty : 1, sumber: 'checklist' }];
        const saved = await api(`${KLIK}?on_conflict=transaksi_id,kode_produk`, Object.assign({ body: JSON.stringify(body) }, UPSERT));
        st.d.klik = st.d.klik.filter(r => !(String(r.transaksi_id) === String(trx.id) && r.kode_produk === kode)).concat(saved || body);
      } else {
        if (!st.activeTrx) return renderTable();
        await api(`${KLIK}?${kEq(st.activeTrx, kode)}`, { method: 'DELETE' });
        st.d.klik = st.d.klik.filter(r => !(String(r.transaksi_id) === st.activeTrx && r.kode_produk === kode));
      }
      renderDynamic();
    } catch (err) { fail('Gagal simpan klik', err); renderDynamic(); }
  }

  async function patchKlik(trxId, kode, patch) {
    const row = klikRow(trxId, kode); if (!row) return;
    const prev = { ...row };
    Object.assign(row, patch);
    renderDynamic();
    try { await api(`${KLIK}?${kEq(trxId, kode)}`, { method: 'PATCH', body: JSON.stringify(patch) }); }
    catch (err) { Object.assign(row, prev); renderDynamic(); fail('Gagal simpan', err); }
  }

  async function savePaste() {
    const ta = $('prj-paste-ta'), stat = $('prj-paste-status');
    const parsed = parsePasteKlik(ta.value);
    if (!parsed.length) { stat.textContent = 'Belum ada kode yang bisa dibaca.'; return; }
    stat.textContent = 'Menyimpan…';
    try {
      const trx = await ensureActive();
      const body = [];
      for (const p of parsed) {
        const k = st.a.kodes.get(p.kode);
        let nama = k ? k.nama : null;
        if (!nama && typeof S.findProdukByKodeExact === 'function' && body.length < 40) {
          // Kode di luar konversi: coba ambil namanya dari katalog biar tabel terbaca. Best-effort.
          try { const r = await S.findProdukByKodeExact(p.kode); nama = r && r.produk ? (r.produk.nama_produk || r.produk.nama || null) : null; } catch (_) { /* biarin kosong */ }
        }
        const it = k && k.sesi[0] ? itemOf(k.sesi[0], p.kode) : null;
        body.push({ transaksi_id: trx.id, project_id: st.cur, kode_produk: p.kode, nama_produk: nama || null, qty: p.qty != null ? p.qty : (it && it.qty != null ? it.qty : 1), sumber: 'paste' });
      }
      const saved = await api(`${KLIK}?on_conflict=transaksi_id,kode_produk`, Object.assign({ body: JSON.stringify(body) }, UPSERT));
      const got = new Set((saved || []).map(r => r.kode_produk));
      st.d.klik = st.d.klik.filter(r => !(String(r.transaksi_id) === String(trx.id) && got.has(r.kode_produk))).concat(saved || []);
      ta.value = '';
      stat.textContent = `${parsed.length} kode disimpan.`;
      renderDynamic();
    } catch (err) { stat.textContent = ''; fail('Gagal simpan tempelan', err); }
  }

  async function setSesiProject(sesiId, projectId) {
    await api(`${S.SESI_TABLE}?id=eq.${encodeURIComponent(sesiId)}`, { method: 'PATCH', body: JSON.stringify({ project_id: projectId }) });
    // Konversi pindah/keluar project -> pin yang nunjuk ke dia (di project lama) dilepas.
    await api(`${KLIK}?pinned_sesi_id=eq.${encodeURIComponent(sesiId)}`, { method: 'PATCH', body: JSON.stringify({ pinned_sesi_id: null }) }).catch(() => {});
  }

  // Picker konversi: filter awal = instansi, tapi BUKAN batasan. Cocok ke nama RS / sales / PIC / barang,
  // kosong = semua konversi (terbaru dulu), bisa muat lebih banyak, dan konversi yang sudah
  // di project lain bisa dipindah (tim sering tau "yang ini sebenarnya RS X" walau di sesi belum ditulis).
  const PICK_PAGE = 30;
  // Cari konversi yang MEMUAT barang (kode/nama produk) — sama kayak pencarian "Barang" di Riwayat:
  // isi record (konversi_item) + isi clipboard sesi (sesi_konversi_item); tiap kata harus kena di item yang sama.
  async function fetchPickItemMatches(toks) {
    const out = new Map();
    const LIMIT = 800;
    const cond = 'and=' + encodeURIComponent('(' + toks.map(t => `or(kode_produk.ilike.*${t}*,nama_produk.ilike.*${t}*)`).join(',') + ')');
    const [recs, cli] = await Promise.all([
      api(`konversi_item?${cond}&select=kode_produk,nama_produk,qty,konversi_record!inner(sesi_id)&limit=${LIMIT}`).catch(e => { console.warn('Picker: cari barang di record gagal', e); return null; }),
      api(`${S.SESI_ITEM_TABLE}?${cond}&select=sesi_id,kode_produk,nama_produk,qty&limit=${LIMIT}`).catch(e => { console.warn('Picker: cari barang di sesi gagal', e); return null; })
    ]);
    if (recs === null && cli === null) throw new Error('Gagal mencari barang (cek koneksi / akses tabel konversi_item).');
    const put = (sid, m) => {
      if (sid == null || !m.kode) return;
      const k = String(sid);
      const arr = out.get(k) || [];
      if (!arr.some(x => x.kode === m.kode)) arr.push(m);
      out.set(k, arr);
    };
    (recs || []).forEach(r => put(r.konversi_record && r.konversi_record.sesi_id, { kode: r.kode_produk, nama: r.nama_produk, qty: r.qty }));
    (cli || []).forEach(r => put(r.sesi_id, { kode: r.kode_produk, nama: r.nama_produk, qty: r.qty }));
    return { map: out, capped: (recs || []).length >= LIMIT || (cli || []).length >= LIMIT };
  }

  async function runPicker(more) {
    const out = document.getElementById('prj-pick-res'); if (!out) return;
    if (!more) { st.pickRows = []; st.pickMore = false; }
    const toks = (document.getElementById('prj-pick-q').value || '').replace(/[,()*:]/g, ' ').trim().split(/\s+/).filter(Boolean);
    if (!more) out.innerHTML = `<div class="prj-hint" style="padding:6px 2px"><i class="ti ti-loader-2"></i> Mencari…</div>`;
    const my = ++st.pickSeq;
    try {
      const scope = st.pickScope;
      if (!more) {
        // Hasil pencarian barang cuma dihitung di halaman pertama, halaman berikutnya pakai ulang.
        st.pickMatches = new Map(); st.pickIds = []; st.pickCapped = false; st.pickToks = toks;
        if (toks.length && scope !== 'header') {
          const r = await fetchPickItemMatches(toks);
          if (my !== st.pickSeq) return;
          st.pickMatches = r.map; st.pickCapped = r.capped;
          st.pickIds = [...r.map.keys()].filter(idOk).slice(0, 150);
        }
      }
      let f = '';
      if (toks.length) {
        const hdr = '(' + toks.map(t => `or(nama_rs.ilike.*${t}*,nama_sales.ilike.*${t}*,pic_marsup.ilike.*${t}*)`).join(',') + ')';
        if (scope === 'header') f = '&and=' + encodeURIComponent(hdr);
        else if (scope === 'barang') {
          if (!st.pickIds.length) { st.pickRows = []; st.pickMore = false; renderPickRows(); return; }
          f = `&id=in.(${st.pickIds.join(',')})`;
        } else {
          f = '&or=' + encodeURIComponent(`(and${hdr}${st.pickIds.length ? `,id.in.(${st.pickIds.join(',')})` : ''})`);
        }
      }
      const [rows, prjs] = await Promise.all([
        api(`${S.SESI_TABLE}?status=in.(selesai,berjalan)${f}&select=id,nama_rs,pic_marsup,nama_sales,status,hasil_order,updated_at,project_id&order=updated_at.desc&limit=${PICK_PAGE + 1}&offset=${(st.pickRows || []).length}`),
        st.prjNames ? Promise.resolve(null) : api(`${PRJ}?select=id,nama&limit=500`).catch(() => [])
      ]);
      if (my !== st.pickSeq) return;
      if (prjs) st.prjNames = new Map(prjs.map(x => [String(x.id), x.nama]));
      const got = rows || [];
      st.pickMore = got.length > PICK_PAGE;
      st.pickRows = (st.pickRows || []).concat(got.slice(0, PICK_PAGE));
      renderPickRows();
    } catch (err) { if (my === st.pickSeq) out.innerHTML = `<div class="prj-error">${esc(friendly(err))}</div>`; }
  }
  const hl = (text) => {
    const raw = String(text == null ? '' : text);
    const toks = (st.pickToks || []).filter(Boolean).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!toks.length) return esc(raw);
    return raw.split(new RegExp('(' + toks.join('|') + ')', 'ig')).map((part, i) => (i % 2 ? `<mark class="prj-hl">${esc(part)}</mark>` : esc(part))).join('');
  };
  function renderPickRows() {
    const out = document.getElementById('prj-pick-res'); if (!out) return;
    const inProj = new Set(st.d.sesi.map(s => String(s.id)));
    const list = (st.pickRows || []).filter(r => !inProj.has(String(r.id)));
    if (!list.length && !st.pickMore) { out.innerHTML = `<div class="prj-hint" style="padding:6px 2px">Tidak ada konversi yang cocok. Coba kata kunci lain, atau kosongkan kotak cari.</div>`; return; }
    out.innerHTML = list.map(r => {
      const other = r.project_id && String(r.project_id) !== String(st.cur);
      const from = other ? (st.prjNames && st.prjNames.get(String(r.project_id))) || 'project lain' : '';
      const ms = st.pickMatches.get(String(r.id)) || [];
      const strip = ms.length ? `<div class="prj-matches">${ms.slice(0, 3).map(m => `<div class="prj-match"><span class="prj-match-kode">${hl(m.kode)}</span><span class="prj-match-nama">${hl(m.nama)}</span>${m.qty != null ? `<span class="prj-hint">×${esc(m.qty)}</span>` : ''}</div>`).join('')}${ms.length > 3 ? `<div class="prj-hint">+${ms.length - 3} barang lain cocok</div>` : ''}</div>` : '';
      return `<div class="prj-pick-row">
        <div class="prj-sesi-main"><div class="prj-sesi-name">${esc(r.nama_rs || '(Nama RS belum diisi)')}</div>
        <div class="prj-sesi-sub">${esc(r.nama_sales || '-')}${r.pic_marsup ? ' · PIC ' + esc(r.pic_marsup) : ''} · ${esc(r.status === 'berjalan' ? 'Berjalan' : 'Selesai')} · ${esc(S.sesiTimeAgo(r.updated_at))}${other ? ` · <span class="prj-moved">sekarang di "${esc(from)}"</span>` : ''}</div>${strip}</div>
        <button class="rc-act" type="button" data-act="pick-add" data-id="${esc(r.id)}" ${other ? `data-from="${esc(from)}"` : ''}><i class="ti ${other ? 'ti-arrows-exchange' : 'ti-plus'}"></i><span>${other ? 'Pindahkan ke sini' : 'Tambah'}</span></button>
      </div>`;
    }).join('') + (st.pickCapped ? `<div class="prj-hint" style="padding:4px 2px">Hasil pencarian barang dibatasi — persempit kata kunci kalau kurang lengkap.</div>` : '') + (st.pickMore ? `<button class="toggle-btn" type="button" data-act="pick-more" style="margin-top:6px"><i class="ti ti-chevron-down"></i> Muat lebih banyak</button>` : '');
  }

  async function saveMeta(field, value) {
    const p = st.d.project;
    if (field === 'nama' && !value.trim()) { $('prj-f-nama').value = p.nama; return; }
    const prev = p[field];
    p[field] = value.trim() || null;
    try { await api(`${PRJ}?id=eq.${encodeURIComponent(st.cur)}`, { method: 'PATCH', body: JSON.stringify({ [field]: p[field], updated_at: new Date().toISOString() }) }); }
    catch (err) { p[field] = prev; fail('Gagal simpan', err); }
  }

  // ── Event delegation ──────────────────────────────────────────────────
  root.addEventListener('click', async (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el || !root.contains(el)) return;
    const act = el.dataset.act;
    try {
      if (act === 'open') return openProject(el.dataset.id);
      if (act === 'back' || act === 'refresh') return loadProjects();
      if (act === 'new-toggle') { const b = $('prj-new'); b.style.display = b.style.display === 'none' ? 'flex' : 'none'; if (b.style.display !== 'none') $('prj-new-nama').focus(); return; }
      if (act === 'new-save') {
        const nama = $('prj-new-nama').value.trim();
        if (!nama) { S.showToast('Isi nama project dulu.', 'error'); return; }
        el.disabled = true;
        try { const p = await createProject(nama, $('prj-new-instansi').value.trim()); return openProject(p.id); }
        finally { el.disabled = false; }
      }
      if (act === 'sug-create') {
        const g = st.suggestions[Number(el.dataset.i)]; if (!g) return;
        el.disabled = true;
        try { const p = await createProject(g.nama, g.nama, g.ids); S.showToast(`Project "${g.nama}" dibuat dari ${g.ids.length} konversi ✓`); return openProject(p.id); }
        finally { el.disabled = false; }
      }
      if (act === 'del-prj') {
        if (!confirm(`Hapus project "${st.d.project.nama}"?\nKonversinya TIDAK ikut terhapus — cuma dilepas dari project. Semua transaksi dan catatan klik project ini hilang.`)) return;
        await api(`${PRJ}?id=eq.${encodeURIComponent(st.cur)}`, { method: 'DELETE' });
        S.showToast('Project dihapus.');
        return loadProjects();
      }
      if (act === 'picker-toggle') { const p = $('prj-picker'); const open = p.style.display === 'none'; p.style.display = open ? 'block' : 'none'; if (open) runPicker(); return; }
      if (act === 'pick-add') {
        if (el.dataset.from && !confirm(`Konversi ini sekarang ada di project "${el.dataset.from}".\nPindahkan ke project ini? (pin klik di project lama untuk konversi ini ikut dilepas)`)) return;
        el.disabled = true;
        await setSesiProject(el.dataset.id, st.cur);
        st.pickRows = (st.pickRows || []).filter(r => String(r.id) !== String(el.dataset.id));
        st.prjNames = null; // daftar project berubah, ambil ulang di pencarian berikutnya
        renderPickRows();
        return reloadDetail();
      }
      if (act === 'pick-scope') {
        st.pickScope = el.dataset.scope;
        root.querySelectorAll('[data-act="pick-scope"]').forEach(b => b.classList.toggle('active', b === el));
        return runPicker();
      }
      if (act === 'pick-more') { el.disabled = true; return runPicker(true); }
      if (act === 'rm-sesi') {
        const s = st.d.sesi.find(x => String(x.id) === el.dataset.id);
        if (!confirm(`Keluarkan "${(s && s.nama_rs) || 'konversi ini'}" dari project?`)) return;
        await setSesiProject(el.dataset.id, null);
        return reloadDetail();
      }
      // — Transaksi —
      if (act === 'trx-new-toggle') {
        const f = $('prj-trx-new');
        if (f.style.display === 'none') {
          f.innerHTML = trxFormHtml('prj-new-trx', null) + `<div class="prj-trx-actions"><button class="pr-add-clip-btn" type="button" data-act="trx-new-save"><i class="ti ti-check"></i> Buat transaksi</button></div>`;
          f.style.display = 'block';
        } else f.style.display = 'none';
        return;
      }
      if (act === 'trx-new-save') {
        const fields = readTrxForm('prj-new-trx'); if (!fields) return;
        el.disabled = true;
        try { await createTrxRow(fields); $('prj-trx-new').style.display = 'none'; renderDynamic(); S.showToast('Transaksi dibuat — centang item di bawah buat mengisinya.'); }
        finally { el.disabled = false; }
        return;
      }
      if (act === 'trx-active') { st.activeTrx = el.dataset.id; return renderDynamic(); }
      if (act === 'trx-edit') { st.editTrx = el.dataset.id; return renderTrxList(); }
      if (act === 'trx-edit-cancel') { st.editTrx = null; return renderTrxList(); }
      if (act === 'trx-edit-save') {
        const fields = readTrxForm('prj-edit'); if (!fields) return;
        const row = st.d.trx.find(t => String(t.id) === el.dataset.id); if (!row) return;
        const prev = { ...row };
        el.disabled = true;
        Object.assign(row, fields);
        try { await api(`${TRX}?id=eq.${encodeURIComponent(el.dataset.id)}`, { method: 'PATCH', body: JSON.stringify(fields) }); st.editTrx = null; renderDynamic(); }
        catch (err) { Object.assign(row, prev); el.disabled = false; throw err; }
        return;
      }
      if (act === 'trx-del') {
        const t = st.a.trxList.find(x => x.id === el.dataset.id); if (!t) return;
        if (!confirm(`Hapus "${trxTitle(t)}" beserta ${t.entries.length} item di dalamnya?`)) return;
        await api(`${TRX}?id=eq.${encodeURIComponent(t.id)}`, { method: 'DELETE' });
        st.d.trx = st.d.trx.filter(x => String(x.id) !== t.id);
        st.d.klik = st.d.klik.filter(r => String(r.transaksi_id) !== t.id);
        if (st.activeTrx === t.id) st.activeTrx = null;
        return renderDynamic();
      }
      // — Item —
      if (act === 'only-klik') { st.onlyKlik = !st.onlyKlik; return renderTable(); }
      if (act === 'paste-toggle') { const p = $('prj-paste'); p.style.display = p.style.display === 'none' ? 'flex' : 'none'; return; }
      if (act === 'paste-save') return savePaste();
      if (act === 'unpin') return patchKlik(el.dataset.trx, el.dataset.kode, { pinned_sesi_id: null });
    } catch (err) { fail('Gagal', err); }
  });
  root.addEventListener('keydown', (ev) => {
    const card = ev.target.closest && ev.target.closest('.prj-card');
    if (card && (ev.key === 'Enter' || ev.key === ' ') && ev.target === card) { ev.preventDefault(); openProject(card.dataset.id); }
  });
  root.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.id === 'prj-f-nama') return saveMeta('nama', t.value);
    if (t.id === 'prj-f-instansi') return saveMeta('instansi', t.value);
    if (t.id === 'prj-f-catatan') return saveMeta('catatan', t.value);
    if (t.classList.contains('prj-pin')) return patchKlik(t.dataset.trx, t.dataset.kode, { pinned_sesi_id: t.value || null });
    const tr = t.closest && t.closest('tr[data-kode]');
    if (!tr) return;
    const kode = tr.dataset.kode;
    if (t.classList.contains('prj-cb')) return toggleKlik(kode, t.checked);
    if (!st.activeTrx) return;
    if (t.classList.contains('prj-qty')) {
      const n = Math.floor(Number(t.value));
      if (!isFinite(n) || n < 1) { renderTable(); return; }
      return patchKlik(st.activeTrx, kode, { qty: n });
    }
    if (t.classList.contains('prj-harga')) {
      const raw = t.value.trim();
      const n = parseRupiah(raw);
      if (raw && n == null) { S.showToast('Harga gak terbaca — isi angka saja, mis. 4.456.757', 'error'); renderTable(); return; }
      return patchKlik(st.activeTrx, kode, { harga: n });
    }
  });
  root.addEventListener('input', (ev) => {
    if (ev.target.id === 'prj-klik-filter') renderTable();
    if (ev.target.id === 'prj-pick-q') { clearTimeout(pickTimer); pickTimer = setTimeout(runPicker, 300); }
  });
}