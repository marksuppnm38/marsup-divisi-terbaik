// Tab "Project" di Konversian — BARU 2026-10-12.
//
// MASALAH: satu instansi (mis. RSUD PANDEGA PANGANDARAN) bisa punya beberapa
// konversi (sesi_konversi), dan yang akhirnya di-klik/dibeli di e-Katalog bisa
// campuran item dari 2 konversi berbeda. Gak ada primary key yang nyambungin
// "klik di INAPROC" ke "konversi tertentu" — sales sendiri sering lost contact.
//
// PENDEKATAN: gak coba bikin kuncinya. Project = wadah buat ngumpulin konversi
// satu instansi; klik di e-Kat dicatat per KODE PRODUK di level project; lalu
// "konversi asal" ditebak dari bukti yang ada (analyzeProject di bawah) dan
// SELALU bisa di-override manual (pin). Atribusi gak disimpan — dihitung ulang
// tiap project dibuka, jadi gak pernah basi kalau data bertambah.
//
// Bukti yang dipakai (dari yang paling kuat):
//   1. klik yang udah dicatat di Riwayat (sesi.klik_ekat_items) -> pasti
//   2. pin manual                                           -> pasti
//   3. kode produk cuma ada di 1 konversi project            -> pasti
//   4. kode ada di >1 konversi -> skor: jangkar (konversi lain yang udah
//      "pasti kena" lebih mungkin jadi sumber), qty klik == qty konversi,
//      dan urutan waktu (konversi dibuat SETELAH tanggal klik -> hampir mustahil)
//   5. kode gak ada di konversi manapun                      -> "di luar konversi"
//      (insight juga: sales beli sesuatu yang belum pernah kita konversi)
//
// Skema: lihat migration-project-konversi.sql. State lintas-file lewat objek S
// (pola sama kayak set-mendekati.js). Semua REST lewat S.sesiFetch.

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

// d = { sesi: [...], items: Map(sesiId -> Map(kode -> {nama, qty})), klik: [rows konversi_project_klik] }
export function analyzeProject(d) {
  const mem = d.sesi || [];
  const memById = new Map(mem.map(s => [String(s.id), s]));
  const itemsOf = (s) => d.items.get(String(s.id)) || new Map();

  // kode -> konversi mana aja (di project ini) yang memuatnya
  const kodes = new Map();
  mem.forEach(s => itemsOf(s).forEach((it, kode) => {
    let k = kodes.get(kode);
    if (!k) { k = { kode, nama: it.nama || '', sesi: [] }; kodes.set(kode, k); }
    if (!k.nama && it.nama) k.nama = it.nama;
    k.sesi.push(s);
  }));

  const clicks = new Map();
  const ensure = (kode) => {
    let e = clicks.get(kode);
    if (!e) {
      e = { kode, nama: (kodes.get(kode) || {}).nama || '', qty: null, tanggal: null, row: null, fromSesi: [], pinned: null, cands: [], status: '' };
      clicks.set(kode, e);
    }
    return e;
  };
  (d.klik || []).forEach(r => {
    const e = ensure(r.kode_produk);
    e.row = r; e.qty = r.qty != null ? Number(r.qty) : null; e.tanggal = r.tanggal || null;
    if (!e.nama && r.nama_produk) e.nama = r.nama_produk;
    const p = r.pinned_sesi_id != null ? String(r.pinned_sesi_id) : null;
    e.pinned = p && memById.has(p) ? p : null; // pin ke konversi yang udah bukan anggota = diabaikan
  });
  // Klik yang udah dicatat per-konversi di Riwayat (hanya valid kalau statusnya Klik e-Kat).
  mem.forEach(s => {
    if (s.hasil_order !== 'klik_ekat') return;
    const arr = Array.isArray(s.klik_ekat_items) ? s.klik_ekat_items : [];
    const qm = (s.klik_ekat_qty && typeof s.klik_ekat_qty === 'object' && !Array.isArray(s.klik_ekat_qty)) ? s.klik_ekat_qty : {};
    arr.forEach(kode => {
      const e = ensure(kode);
      const it = itemsOf(s).get(kode);
      e.fromSesi.push({ s, qty: qm[kode] != null ? Number(qm[kode]) : (it && it.qty != null ? Number(it.qty) : null) });
    });
  });

  // Pass 1: yang pasti. Sekalian hitung "jangkar" per konversi.
  const anchors = new Map();
  const bump = (s) => anchors.set(String(s.id), (anchors.get(String(s.id)) || 0) + 1);
  clicks.forEach(e => {
    const cs = (kodes.get(e.kode) || { sesi: [] }).sesi;
    if (e.fromSesi.length) {
      e.status = 'confirmed';
      e.cands = e.fromSesi.map(f => ({ s: f.s, p: 1 / e.fromSesi.length }));
      e.cands.forEach(c => bump(c.s));
    } else if (e.pinned) {
      e.status = 'pinned';
      e.cands = [{ s: memById.get(e.pinned), p: 1 }];
      bump(e.cands[0].s);
    } else if (!cs.length) {
      e.status = 'orphan';
    } else if (cs.length === 1) {
      e.status = 'sure';
      e.cands = [{ s: cs[0], p: 1 }];
      bump(cs[0]);
    } else {
      e.status = 'ambiguous';
      e._cs = cs;
    }
  });
  // Pass 2: yang ambigu, dinilai pakai jangkar + qty + waktu.
  clicks.forEach(e => {
    if (e.status !== 'ambiguous') return;
    const scored = e._cs.map(s => {
      let sc = 1 + (anchors.get(String(s.id)) || 0);
      const it = itemsOf(s).get(e.kode);
      if (e.qty != null && it && it.qty != null && Number(it.qty) === Number(e.qty)) sc += 0.5;
      if (e.tanggal) {
        const tKlik = new Date(e.tanggal + 'T23:59:59').getTime();
        const tSesi = Date.parse(s.updated_at);
        if (isFinite(tKlik) && isFinite(tSesi) && tSesi > tKlik) sc *= 0.25; // konversi baru dibuat sesudah klik
      }
      return { s, sc };
    });
    const sum = scored.reduce((a, x) => a + x.sc, 0) || 1;
    e.cands = scored.map(x => ({ s: x.s, p: x.sc / sum })).sort((a, b) => b.p - a.p);
    delete e._cs;
  });

  const stats = new Map(mem.map(s => [String(s.id), { hit: 0, maybe: 0, total: itemsOf(s).size }]));
  clicks.forEach(e => e.cands.forEach((c, i) => {
    const x = stats.get(String(c.s.id));
    if (!x) return;
    if (e.status === 'ambiguous' && i > 0) x.maybe++; else x.hit++;
  }));
  const counts = { sure: 0, amb: 0, orphan: 0, total: clicks.size, sesiTanpaKlik: 0 };
  clicks.forEach(e => {
    if (e.status === 'orphan') counts.orphan++;
    else if (e.status === 'ambiguous') counts.amb++;
    else counts.sure++;
  });
  stats.forEach(x => { if (!x.hit && !x.maybe) counts.sesiTanpaKlik++; });

  // Baris tabel: semua kode di konversi project, lalu klik "di luar konversi".
  const rows = [...kodes.values()];
  clicks.forEach(e => { if (!kodes.has(e.kode)) rows.push({ kode: e.kode, nama: e.nama, sesi: [] }); });
  return { kodes, clicks, stats, counts, rows };
}

// ── UI ──────────────────────────────────────────────────────────────────
export function installProject(S) {
  const root = document.getElementById('prj-root');
  if (!root) return;
  const esc = (s) => S.escapeHtmlAttr(s);
  const PRJ = 'konversi_project';
  const KLIK = 'konversi_project_klik';
  const HASIL = { '': 'Menunggu feedback', jadi_sph: 'Jadi SPH', klik_ekat: 'Klik e-Kat', jadi_order: 'Jadi order (lama)', tanpa_order: 'Tidak jadi (lama)' };
  const st = { view: 'list', cur: null, d: null, a: null, token: 0, onlyKlik: false, suggestions: [] };
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
    if (err && (err.code === 'PGRST205' || err.code === '42P01' || /konversi_project/i.test(m) && /not find|does not exist|schema cache/i.test(m)))
      return 'Tabel project belum ada — jalankan migration-project-konversi.sql di Supabase dulu.';
    if (err && (err.code === 'PGRST204' || err.code === '42703' || /project_id/i.test(m)))
      return 'Kolom sesi_konversi.project_id belum ada — jalankan migration-project-konversi.sql di Supabase dulu.';
    return m || 'Terjadi kesalahan.';
  }
  const fail = (prefix, err) => { console.error(prefix, err); S.showToast(`${prefix}: ${friendly(err)}`, 'error'); };
  const idOk = (x) => /^[\w-]+$/.test(String(x));

  // ── LIST ──────────────────────────────────────────────────────────────
  async function loadProjects() {
    st.view = 'list'; st.cur = null; st.d = null; st.a = null;
    root.innerHTML = `<div class="prj-loading"><i class="ti ti-loader-2"></i> Memuat project…</div>`;
    try {
      const rows = await api(`${PRJ}?select=id,nama,instansi,updated_at,${S.SESI_TABLE}!project_id(count),${KLIK}!project_id(count)&order=updated_at.desc&limit=300`);
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
      const nKlik = (p[KLIK] && p[KLIK][0] && p[KLIK][0].count) || 0;
      return `<div class="rcard prj-card" data-act="open" data-id="${esc(p.id)}" tabindex="0" role="button">
        <div class="rc-head"><div class="rc-title">
          <div class="rc-name">${esc(p.nama)}</div>
          ${p.instansi ? `<div class="rc-sub"><span><i class="ti ti-building-hospital"></i>${esc(p.instansi)}</span></div>` : ''}
        </div></div>
        <div class="rc-stats">
          <span class="rc-stat"><i class="ti ti-arrows-left-right"></i>${nSesi} konversi</span>
          <span class="rc-stat"><i class="ti ti-click"></i>${nKlik} klik tercatat</span>
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
        <span class="prj-lead">Kelompokkan beberapa konversi satu instansi jadi satu project, lalu catat item yang akhirnya di-klik di e-Katalog.</span>
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
    const [prj, sesi, klik] = await Promise.all([
      api(`${PRJ}?id=eq.${ide}&select=*`),
      api(`${S.SESI_TABLE}?project_id=eq.${ide}&select=id,nama_rs,pic_marsup,nama_sales,status,hasil_order,updated_at,klik_ekat_items,klik_ekat_qty&order=updated_at.asc`),
      api(`${KLIK}?project_id=eq.${ide}&select=*&order=created_at.asc`)
    ]);
    if (!prj || !prj[0]) throw new Error('Project tidak ditemukan.');
    const items = new Map();
    const put = (sid, kode, nama, qty, harga) => {
      if (!kode) return;
      const k = String(sid);
      if (!items.has(k)) items.set(k, new Map());
      items.get(k).set(kode, { kode, nama: nama || '', qty: qty != null ? Number(qty) : null, harga });
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
    return { project: prj[0], sesi: sesi || [], klik: klik || [], items };
  }

  async function openProject(id) {
    st.view = 'detail'; st.cur = id; st.onlyKlik = false;
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
          <input id="prj-pick-q" class="prj-input" type="text" placeholder="Cari nama RS…" autocomplete="off" value="${esc(p.instansi || '')}">
          <div id="prj-pick-res"></div>
        </div>
        <div id="prj-sesi-list"></div>
      </div>
      <div class="prj-sec">
        <div class="prj-sec-head"><b>Item yang di-klik di e-Katalog</b></div>
        <div class="prj-note">Centang item yang kelihatan di-klik/dibeli. Kalau kodenya ada di lebih dari satu konversi, asalnya ditebak otomatis (dan bisa di-pin manual). Item yang kodenya gak ada di konversi manapun masuk "di luar konversi".</div>
        <div class="prj-klik-tools">
          <label class="prj-tool"><span>Tanggal klik (opsional)</span><input id="prj-klik-date" type="date" class="prj-input"></label>
          <label class="prj-tool prj-grow"><span>Filter</span><input id="prj-klik-filter" type="text" class="prj-input" placeholder="Kode atau nama produk…" autocomplete="off"></label>
          <button class="toggle-btn" type="button" id="prj-only-klik" data-act="only-klik"><i class="ti ti-filter"></i> Hanya yang di-klik</button>
          <button class="toggle-btn" type="button" data-act="paste-toggle"><i class="ti ti-clipboard-text"></i> Tempel kode</button>
        </div>
        <div id="prj-paste" class="prj-paste" style="display:none">
          <textarea id="prj-paste-ta" class="prj-input prj-mono" rows="4" placeholder="1 baris = 1 kode, boleh dengan qty setelahnya:&#10;RB999-KE921-B99-U238&#9;2&#10;RB999-KE921-B99-U109"></textarea>
          <button class="pr-add-clip-btn" type="button" data-act="paste-save"><i class="ti ti-check"></i> Simpan sebagai klik</button>
          <span id="prj-paste-status" class="prj-hint"></span>
        </div>
        <div id="prj-klik-wrap"></div>
      </div>
    </div>`;
  }

  const sesiIdx = (s) => st.d.sesi.findIndex(x => String(x.id) === String(s.id));
  // Item (kode) di konversi s; konversi tanpa item sama sekali gak punya Map-nya.
  const itemOf = (s, kode) => { const m = st.d.items.get(String(s.id)); return m ? m.get(kode) : undefined; };
  const chip = (s) => { const i = sesiIdx(s); return `<span class="prj-chip prj-c${i % 6}" title="${esc(s.nama_rs || '')}">K${i + 1}</span>`; };

  function renderDynamic() {
    st.a = analyzeProject(st.d);
    renderSummary(); renderSesiList(); renderTable();
  }

  function renderSummary() {
    const c = st.a.counts, n = st.d.sesi.length;
    const el = document.getElementById('prj-summary'); if (!el) return;
    el.innerHTML = [
      `<span class="prj-pill"><b>${n}</b> konversi</span>`,
      `<span class="prj-pill"><b>${c.total}</b> item di-klik</span>`,
      `<span class="prj-pill prj-ok"><b>${c.sure}</b> asal jelas</span>`,
      c.amb ? `<span class="prj-pill prj-warn"><b>${c.amb}</b> asal ambigu</span>` : '',
      c.orphan ? `<span class="prj-pill prj-bad"><b>${c.orphan}</b> di luar konversi</span>` : '',
      (n && c.sesiTanpaKlik) ? `<span class="prj-pill"><b>${c.sesiTanpaKlik}</b> konversi belum ada klik</span>` : ''
    ].join('');
  }

  function renderSesiList() {
    const el = document.getElementById('prj-sesi-list'); if (!el) return;
    if (!st.d.sesi.length) {
      el.innerHTML = `<div class="prj-empty">Belum ada konversi di project ini. Klik "Tambah konversi" dan cari berdasarkan nama RS.</div>`;
      return;
    }
    el.innerHTML = st.d.sesi.map((s, i) => {
      const x = st.a.stats.get(String(s.id)) || { hit: 0, maybe: 0, total: 0 };
      return `<div class="prj-sesi">
        <span class="prj-chip prj-c${i % 6}">K${i + 1}</span>
        <div class="prj-sesi-main">
          <div class="prj-sesi-name">${esc(s.nama_rs || '(Nama RS belum diisi)')}</div>
          <div class="prj-sesi-sub">${esc(s.nama_sales || '-')} · ${esc(s.status === 'berjalan' ? 'Berjalan' : 'Selesai')} · ${esc(HASIL[s.hasil_order || ''] || s.hasil_order)} · ${esc(S.sesiTimeAgo(s.updated_at))}</div>
        </div>
        <div class="prj-sesi-cov" title="Item konversi ini yang tercatat di-klik">
          <b>${x.hit}</b>/${x.total} kena${x.maybe ? ` <span class="prj-hint">+${x.maybe} ambigu</span>` : ''}
        </div>
        <button class="rc-act" type="button" data-act="rm-sesi" data-id="${esc(s.id)}" title="Keluarkan dari project"><i class="ti ti-unlink"></i></button>
      </div>`;
    }).join('');
  }

  function attrHtml(e) {
    if (!e) return '<span class="prj-hint">—</span>';
    const pc = (c) => `${chip(c.s)}`;
    if (e.status === 'confirmed') return `${e.cands.map(pc).join('')} <span class="prj-st prj-st-sure" title="Dicatat di Riwayat konversi itu sendiri"><i class="ti ti-lock"></i> dari Riwayat</span>`;
    if (e.status === 'pinned') return `${pc(e.cands[0])} <span class="prj-st prj-st-sure"><i class="ti ti-pin"></i> manual</span>`;
    if (e.status === 'sure') return `${pc(e.cands[0])} <span class="prj-st prj-st-sure">pasti</span>`;
    if (e.status === 'orphan') return `<span class="prj-st prj-st-orph">di luar konversi</span>`;
    return e.cands.map(c => `<span class="prj-cand">${chip(c.s)}<b>${Math.round(c.p * 100)}%</b></span>`).join('')
      + ` <span class="prj-st prj-st-amb">tebakan</span>`;
  }

  function pinHtml(e) {
    if (!e || !e.row || e.status === 'confirmed' || e.status === 'orphan') return '';
    const cs = e.status === 'pinned' ? st.d.sesi.filter(s => (st.a.kodes.get(e.kode) || { sesi: [] }).sesi.includes(s)) : e.cands.map(c => c.s);
    if (cs.length < 2) return e.status === 'pinned' ? `<button class="rc-act" type="button" data-act="unpin" data-kode="${esc(e.kode)}" title="Lepas pin"><i class="ti ti-pin-off"></i></button>` : '';
    return `<select class="prj-pin" data-kode="${esc(e.kode)}" title="Pin asal konversi secara manual">
      <option value="">Otomatis</option>
      ${cs.map(s => `<option value="${esc(s.id)}" ${e.pinned === String(s.id) ? 'selected' : ''}>K${sesiIdx(s) + 1} · ${esc((s.nama_rs || '').slice(0, 28))}</option>`).join('')}
    </select>`;
  }

  function renderTable() {
    const wrap = document.getElementById('prj-klik-wrap'); if (!wrap) return;
    const btn = document.getElementById('prj-only-klik'); if (btn) btn.classList.toggle('on', st.onlyKlik);
    const q = ((document.getElementById('prj-klik-filter') || {}).value || '').trim().toLowerCase();
    let rows = st.a.rows;
    if (st.onlyKlik) rows = rows.filter(r => st.a.clicks.has(r.kode));
    if (q) rows = rows.filter(r => `${r.kode} ${r.nama}`.toLowerCase().includes(q));
    if (!st.a.rows.length) { wrap.innerHTML = `<div class="prj-empty">Belum ada item. Tambahkan konversi dulu, atau tempel kode produk yang di-klik.</div>`; return; }
    if (!rows.length) { wrap.innerHTML = `<div class="prj-empty">Tidak ada item yang cocok dengan filter.</div>`; return; }
    const body = rows.map(r => {
      const e = st.a.clicks.get(r.kode);
      const locked = !!(e && e.fromSesi.length);
      const firstIt = r.sesi[0] ? itemOf(r.sesi[0], r.kode) : null;
      const defQty = firstIt ? firstIt.qty : null;
      const qtyShown = e ? (locked ? (e.fromSesi[0].qty ?? '') : (e.qty ?? defQty ?? '')) : '';
      const qtyKonv = r.sesi.map(s => { const it = itemOf(s, r.kode); return `${it && it.qty != null ? it.qty : '-'}`; }).join(' / ') || '-';
      return `<tr class="${e ? 'prj-on prj-r-' + e.status : ''}" data-kode="${esc(r.kode)}">
        <td class="ek-col"><input type="checkbox" class="prj-cb" ${e ? 'checked' : ''} ${locked ? 'disabled' : ''} title="${locked ? 'Dicatat dari Riwayat konversi — ubah di sana' : 'Di-klik di e-Katalog'}" aria-label="Di-klik di e-Katalog"></td>
        <td class="kode">${esc(r.kode)}</td>
        <td>${esc(r.nama || '')}</td>
        <td>${r.sesi.length ? r.sesi.map(chip).join('') : '<span class="prj-hint">—</span>'}</td>
        <td class="num">${esc(qtyKonv)}</td>
        <td class="num"><input type="number" min="1" step="1" inputmode="numeric" class="prj-qty" value="${qtyShown === '' ? '' : esc(qtyShown)}" ${e && !locked ? '' : 'disabled'} aria-label="Qty yang di-klik"></td>
        <td class="prj-attr">${attrHtml(e)} ${pinHtml(e)}</td>
      </tr>`;
    }).join('');
    wrap.innerHTML = `<div class="riwayat-peek-wrap prj-table-wrap"><table class="prj-table">
      <thead><tr><th class="ek-col" title="Di-klik di e-Kat">Klik</th><th>Kode</th><th>Produk</th><th>Ada di</th><th class="num" title="Qty di tiap konversi (urut K1/K2…)">Qty konv.</th><th class="num">Qty klik</th><th>Asal klik</th></tr></thead>
      <tbody>${body}</tbody></table></div>`;
  }

  // ── Aksi data ─────────────────────────────────────────────────────────
  const klikDate = () => (document.getElementById('prj-klik-date') || {}).value || null;
  const klikRow = (kode) => st.d.klik.find(r => r.kode_produk === kode);
  const kEq = (kode) => `project_id=eq.${encodeURIComponent(st.cur)}&kode_produk=eq.${encodeURIComponent(kode)}`;

  async function toggleKlik(kode, on) {
    const k = st.a.kodes.get(kode);
    try {
      if (on) {
        const it = k && k.sesi[0] ? itemOf(k.sesi[0], kode) : null;
        const body = [{ project_id: st.cur, kode_produk: kode, nama_produk: (k && k.nama) || null, qty: it && it.qty != null ? it.qty : 1, tanggal: klikDate(), sumber: 'checklist' }];
        const saved = await api(`${KLIK}?on_conflict=project_id,kode_produk`, { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(body) });
        st.d.klik = st.d.klik.filter(r => r.kode_produk !== kode).concat(saved || body);
      } else {
        await api(`${KLIK}?${kEq(kode)}`, { method: 'DELETE' });
        st.d.klik = st.d.klik.filter(r => r.kode_produk !== kode);
      }
      renderDynamic();
    } catch (err) { fail('Gagal simpan klik', err); renderTable(); }
  }

  async function patchKlik(kode, patch) {
    const row = klikRow(kode); if (!row) return;
    const prev = { ...row };
    Object.assign(row, patch);
    renderDynamic();
    try { await api(`${KLIK}?${kEq(kode)}`, { method: 'PATCH', body: JSON.stringify(patch) }); }
    catch (err) { Object.assign(row, prev); renderDynamic(); fail('Gagal simpan', err); }
  }

  async function savePaste() {
    const ta = document.getElementById('prj-paste-ta'), stat = document.getElementById('prj-paste-status');
    const parsed = parsePasteKlik(ta.value);
    if (!parsed.length) { stat.textContent = 'Belum ada kode yang bisa dibaca.'; return; }
    stat.textContent = 'Menyimpan…';
    try {
      const tgl = klikDate();
      const body = [];
      for (const p of parsed) {
        const k = st.a.kodes.get(p.kode);
        let nama = k ? k.nama : null;
        if (!nama && typeof S.findProdukByKodeExact === 'function' && body.length < 40) {
          // Kode di luar konversi: coba ambil namanya dari katalog biar tabel terbaca. Best-effort.
          try { const r = await S.findProdukByKodeExact(p.kode); nama = r && r.produk ? (r.produk.nama_produk || r.produk.nama || null) : null; } catch (_) { /* biarin kosong */ }
        }
        const it = k && k.sesi[0] ? itemOf(k.sesi[0], p.kode) : null;
        body.push({ project_id: st.cur, kode_produk: p.kode, nama_produk: nama || null, qty: p.qty != null ? p.qty : (it && it.qty != null ? it.qty : 1), tanggal: tgl, sumber: 'paste' });
      }
      const saved = await api(`${KLIK}?on_conflict=project_id,kode_produk`, { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(body) });
      const got = new Set((saved || []).map(r => r.kode_produk));
      st.d.klik = st.d.klik.filter(r => !got.has(r.kode_produk)).concat(saved || []);
      ta.value = '';
      stat.textContent = `${parsed.length} kode disimpan.`;
      renderDynamic();
    } catch (err) { stat.textContent = ''; fail('Gagal simpan tempelan', err); }
  }

  async function setSesiProject(sesiId, projectId) {
    await api(`${S.SESI_TABLE}?id=eq.${encodeURIComponent(sesiId)}`, { method: 'PATCH', body: JSON.stringify({ project_id: projectId }) });
    if (projectId == null) await api(`${KLIK}?project_id=eq.${encodeURIComponent(st.cur)}&pinned_sesi_id=eq.${encodeURIComponent(sesiId)}`, { method: 'PATCH', body: JSON.stringify({ pinned_sesi_id: null }) }).catch(() => {});
  }

  async function runPicker() {
    const out = document.getElementById('prj-pick-res'); if (!out) return;
    const toks = (document.getElementById('prj-pick-q').value || '').replace(/[,()*]/g, ' ').trim().split(/\s+/).filter(Boolean);
    out.innerHTML = `<div class="prj-hint" style="padding:6px 2px"><i class="ti ti-loader-2"></i> Mencari…</div>`;
    try {
      const f = toks.map(t => `&nama_rs=ilike.*${encodeURIComponent(t)}*`).join('');
      const rows = await api(`${S.SESI_TABLE}?status=in.(selesai,berjalan)${f}&select=id,nama_rs,nama_sales,status,hasil_order,updated_at,project_id&order=updated_at.desc&limit=30`);
      const inProj = new Set(st.d.sesi.map(s => String(s.id)));
      const list = (rows || []).filter(r => !inProj.has(String(r.id)));
      out.innerHTML = list.length ? list.map(r => `<div class="prj-pick-row">
          <div class="prj-sesi-main"><div class="prj-sesi-name">${esc(r.nama_rs || '(Nama RS belum diisi)')}</div>
          <div class="prj-sesi-sub">${esc(r.nama_sales || '-')} · ${esc(r.status === 'berjalan' ? 'Berjalan' : 'Selesai')} · ${esc(S.sesiTimeAgo(r.updated_at))}</div></div>
          ${r.project_id ? `<span class="prj-hint">sudah di project lain</span>` : `<button class="rc-act" type="button" data-act="pick-add" data-id="${esc(r.id)}"><i class="ti ti-plus"></i><span>Tambah</span></button>`}
        </div>`).join('') : `<div class="prj-hint" style="padding:6px 2px">Tidak ada konversi yang cocok.</div>`;
    } catch (err) { out.innerHTML = `<div class="prj-error">${esc(friendly(err))}</div>`; }
  }

  async function saveMeta(field, value) {
    const p = st.d.project;
    if (field === 'nama' && !value.trim()) { document.getElementById('prj-f-nama').value = p.nama; return; }
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
      if (act === 'new-toggle') { const b = document.getElementById('prj-new'); b.style.display = b.style.display === 'none' ? 'flex' : 'none'; if (b.style.display !== 'none') document.getElementById('prj-new-nama').focus(); return; }
      if (act === 'new-save') {
        const nama = document.getElementById('prj-new-nama').value.trim();
        if (!nama) { S.showToast('Isi nama project dulu.', 'error'); return; }
        el.disabled = true;
        try { const p = await createProject(nama, document.getElementById('prj-new-instansi').value.trim()); return openProject(p.id); }
        finally { el.disabled = false; }
      }
      if (act === 'sug-create') {
        const g = st.suggestions[Number(el.dataset.i)]; if (!g) return;
        el.disabled = true;
        try { const p = await createProject(g.nama, g.nama, g.ids); S.showToast(`Project "${g.nama}" dibuat dari ${g.ids.length} konversi ✓`); return openProject(p.id); }
        finally { el.disabled = false; }
      }
      if (act === 'del-prj') {
        if (!confirm(`Hapus project "${st.d.project.nama}"?\nKonversinya TIDAK ikut terhapus — cuma dilepas dari project. Catatan klik project ini hilang.`)) return;
        await api(`${PRJ}?id=eq.${encodeURIComponent(st.cur)}`, { method: 'DELETE' });
        S.showToast('Project dihapus.');
        return loadProjects();
      }
      if (act === 'picker-toggle') { const p = document.getElementById('prj-picker'); const open = p.style.display === 'none'; p.style.display = open ? 'block' : 'none'; if (open) runPicker(); return; }
      if (act === 'pick-add') { el.disabled = true; await setSesiProject(el.dataset.id, st.cur); await reloadDetail(); return runPicker(); }
      if (act === 'rm-sesi') {
        const s = st.d.sesi.find(x => String(x.id) === el.dataset.id);
        if (!confirm(`Keluarkan "${(s && s.nama_rs) || 'konversi ini'}" dari project?`)) return;
        await setSesiProject(el.dataset.id, null);
        return reloadDetail();
      }
      if (act === 'only-klik') { st.onlyKlik = !st.onlyKlik; return renderTable(); }
      if (act === 'paste-toggle') { const p = document.getElementById('prj-paste'); p.style.display = p.style.display === 'none' ? 'flex' : 'none'; return; }
      if (act === 'paste-save') return savePaste();
      if (act === 'unpin') return patchKlik(el.dataset.kode, { pinned_sesi_id: null });
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
    const tr = t.closest && t.closest('tr[data-kode]');
    if (!tr) return;
    const kode = tr.dataset.kode;
    if (t.classList.contains('prj-cb')) return toggleKlik(kode, t.checked);
    if (t.classList.contains('prj-qty')) {
      const n = Math.floor(Number(t.value));
      if (!isFinite(n) || n < 1) { renderTable(); return; }
      return patchKlik(kode, { qty: n });
    }
    if (t.classList.contains('prj-pin')) return patchKlik(kode, { pinned_sesi_id: t.value || null });
  });
  root.addEventListener('input', (ev) => {
    if (ev.target.id === 'prj-klik-filter') renderTable();
    if (ev.target.id === 'prj-pick-q') { clearTimeout(pickTimer); pickTimer = setTimeout(runPicker, 300); }
  });
}