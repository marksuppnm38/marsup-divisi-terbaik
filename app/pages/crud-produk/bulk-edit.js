// crud-produk/bulk-edit.js
// Tab "Edit massal" (pengganti "Harga massal" + "Link V6 massal"): tempel dari sheet, kolom pertama = kunci,
// kolom lain = atribut apa pun yang dipilih. Tiga langkah satu layar: pilih atribut -> tempel -> preview diff -> proses.
//
// ATURAN: sel kosong = tidak diubah. TIDAK ADA token pengosong. Informasi kurang / format salah = baris gagal,
// alasannya tampil di preview dan baris itu tidak ikut diproses. Preview = RPC yang sama dengan p_dry_run:true.
//
// RPC (lihat HANDOFF §5; versi tanpa token pengosong -> kunci di `set` selalu bernilai, tidak pernah null):
//   bulk_upsert_produk(p_items jsonb, p_dry_run boolean, p_allow_create boolean) -> { dry_run, ringkas, baris:[{ord,kode,status,diff,alasan}] }
//   bulk_upsert_akd   (p_items jsonb, p_dry_run boolean, p_allow_create boolean) -> idem + produk_resync
import { showToast, crudConfirm } from './ui-utils.js';
import { ATTRS, PRESETS, KEYS, attrsOf, attrByKey, attrKeysFromTableCols } from './bulk-registry.js';
import { isHeaderRow, columnsFromHeader, columnsFromSelection, buildRows, applyReport, hitungStatus, toTsv } from './bulk-parse.js';
import { resetManual } from './atribut.js';
import { resetKlasifikasi } from './klasifikasi.js';

const LS_KEY = 'pnm_crud_bulk_edit_v1';
const LS_TABEL = 'pnm_crud_produk_tbl_cols_v1';
const CHUNK = 300;
const RPC = { produk: 'bulk_upsert_produk', akd: 'bulk_upsert_akd' };
const STATUS_LABEL = { baru: 'Baru', ubah: 'Ubah', sama: 'Sama', error: 'Gagal' };

export function installBulkEdit(S, { parsePasteLines, chunkArray }) {
  const $ = (id) => document.getElementById(id);
  if (!$('bulk-edit')) return;
  const esc = (s) => S.escapeHtml(String(s == null ? '' : s));

  // ---------- state ----------
  const st = { entity: 'produk', allowCreate: false, sel: { produk: [], akd: [] }, modes: {}, metas: [], cols: [], raws: [], filter: 'semua', busy: false, info: null };
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (raw) {
      if (raw.entity === 'akd' || raw.entity === 'produk') st.entity = raw.entity;
      st.allowCreate = !!raw.allowCreate;
      for (const e of ['produk', 'akd']) st.sel[e] = (raw.sel && Array.isArray(raw.sel[e]) ? raw.sel[e] : []).filter((k) => attrByKey(e, k));
      st.modes = raw.modes && typeof raw.modes === 'object' ? raw.modes : {};
    }
  } catch { /* storage diblok / rusak -> default */ }
  if (!st.sel.produk.length) st.sel.produk = ['harga_ekat', 'tahun', 'link_v6'];
  const save = () => { try { localStorage.setItem(LS_KEY, JSON.stringify({ entity: st.entity, allowCreate: st.allowCreate, sel: st.sel, modes: st.modes })); } catch { /* abaikan */ } };

  const fmtVal = (v, key) => {
    if (v == null || v === '') return '—';
    if (key === 'tahun') return String(v);
    if (Array.isArray(v)) return v.map((x) => (x && typeof x === 'object' ? `${x.kode} x${x.qty}` : x)).join('; ') || '—';
    if (typeof v === 'boolean') return v ? 'Ya' : 'Tidak';
    if (typeof v === 'number') return v.toLocaleString('id-ID');
    return String(v);
  };

  // ---------- langkah 1: entitas, mode, chip ----------
  function renderSeg() {
    $('beEntity').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === st.entity));
    $('beCreate').querySelectorAll('button').forEach((b) => b.classList.toggle('on', (b.dataset.v === 'baru') === st.allowCreate));
    $('beCreateHint').textContent = st.allowCreate
      ? (st.entity === 'produk' ? 'Kode yang belum ada dibuat sebagai produk baru — kolom Tipe wajib terisi.' : 'No. AKD + tipe yang belum ada dibuat sebagai AKD baru.')
      : 'Kode yang tidak ditemukan ditandai gagal (tidak membuat apa-apa).';
  }
  function renderPresets() {
    const list = PRESETS[st.entity].map((p) => `<button type="button" class="be-preset" data-preset="${p.id}">${esc(p.label)}</button>`);
    if (st.entity === 'produk') list.push('<button type="button" class="be-preset" data-preset="__tabel">Seperti tampilan tabel saya</button>');
    list.push('<button type="button" class="be-preset be-preset-clear" data-preset="__kosong">Kosongkan pilihan</button>');
    $('bePresets').innerHTML = '<span class="be-lbl">Preset</span>' + list.join('');
  }
  function renderChips() {
    const sel = st.sel[st.entity];
    const groups = [];
    attrsOf(st.entity).forEach((a) => {
      let g = groups.find((x) => x.name === a.group);
      if (!g) { g = { name: a.group, items: [] }; groups.push(g); }
      g.items.push(a);
    });
    $('beChips').innerHTML = groups.map((g) => `
      <div class="be-group"><div class="be-gname">${esc(g.name)}</div><div class="be-gchips">${g.items.map((a) => {
        const i = sel.indexOf(a.key);
        const on = i >= 0;
        const modeSel = on && a.kind === 'banyak'
          ? `<select class="be-mode" data-mode="${a.mode}" title="Cara menulis banyak nilai">${a.modes.map((m) => `<option value="${m}"${(st.modes[a.mode] || a.modes[0]) === m ? ' selected' : ''}>${m}</option>`).join('')}</select>` : '';
        return `<span class="be-chipwrap"><button type="button" class="be-chip${on ? ' on' : ''}" data-key="${a.key}"${a.catatan ? ` title="${esc(a.catatan)}"` : ''}>${on ? `<b>${i + 1}</b>` : ''}${esc(a.label)}</button>${modeSel}</span>`;
      }).join('')}</div></div>`).join('');
  }
  function renderCols() {
    const sel = st.sel[st.entity];
    const keyHtml = KEYS[st.entity].map((k, i) => `<span class="bk-col bk-key"><b>${String.fromCharCode(65 + i)}</b>${esc(k.label)}</span>`).join('');
    const attrHtml = sel.map((k, i) => `<span class="bk-col"><b>${String.fromCharCode(65 + KEYS[st.entity].length + i)}</b>${esc(attrByKey(st.entity, k).label)}</span>`).join('');
    $('beCols').innerHTML = keyHtml + (attrHtml || '<span class="be-empty">Pilih atribut di atas — atau tempel data dengan baris header sendiri.</span>');
    renderHint();
  }
  function renderHint() {
    const notes = st.sel[st.entity].map((k) => attrByKey(st.entity, k)).filter((a) => a && a.catatan).map((a) => `<li><b>${esc(a.label)}</b>: ${esc(a.catatan)}</li>`);
    $('beNotes').innerHTML = notes.length ? `<ul>${notes.join('')}</ul>` : '';
  }
  function refreshStep1() { renderSeg(); renderPresets(); renderChips(); renderCols(); }

  $('beEntity').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || b.dataset.v === st.entity) return;
    st.entity = b.dataset.v; save(); resetPreview(); refreshStep1();
  });
  $('beCreate').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    st.allowCreate = b.dataset.v === 'baru'; save(); resetPreview(); renderSeg();
  });
  $('bePresets').addEventListener('click', (e) => {
    const b = e.target.closest('.be-preset'); if (!b) return;
    const id = b.dataset.preset;
    if (id === '__kosong') st.sel[st.entity] = [];
    else if (id === '__tabel') {
      let vis = [];
      try { const raw = JSON.parse(localStorage.getItem(LS_TABEL) || 'null'); if (raw && Array.isArray(raw.order)) { const v = new Set(raw.visible || []); vis = raw.order.filter((k) => v.has(k)); } } catch { /* abaikan */ }
      const keys = attrKeysFromTableCols(vis);
      if (!keys.length) { showToast('Kolom tabelmu belum memuat atribut yang bisa diedit massal', 'warning'); return; }
      st.sel.produk = keys;
    } else {
      const p = PRESETS[st.entity].find((x) => x.id === id);
      if (p) st.sel[st.entity] = [...p.keys];
    }
    save(); resetPreview(); renderChips(); renderCols();
  });
  $('beChips').addEventListener('click', (e) => {
    const b = e.target.closest('.be-chip'); if (!b) return;
    const sel = st.sel[st.entity], key = b.dataset.key, i = sel.indexOf(key);
    if (i >= 0) sel.splice(i, 1); else sel.push(key);
    save(); resetPreview(); renderChips(); renderCols();
  });
  $('beChips').addEventListener('change', (e) => {
    const m = e.target.closest('.be-mode'); if (!m) return;
    st.modes[m.dataset.mode] = m.value; save(); resetPreview();
  });

  $('beCopyHeader').addEventListener('click', async () => {
    const labels = [...KEYS[st.entity].map((k) => k.label), ...st.sel[st.entity].map((k) => attrByKey(st.entity, k).label)];
    try { await navigator.clipboard.writeText(labels.join('\t')); showToast('Header disalin — tempel di baris pertama sheet'); }
    catch { showToast('Gagal menyalin header (izin clipboard ditolak)', true); }
  });

  // ---------- langkah 2/3: cek data (dry-run) ----------
  function resetPreview() {
    st.metas = []; st.cols = []; st.raws = []; st.info = null; st.filter = 'semua';
    $('beResult').style.display = 'none';
    $('beProsesBtn').style.display = 'none';
    $('beSummary').innerHTML = '';
    $('beHeaderProblem').style.display = 'none';
    $('beReport').style.display = 'none';
  }

  function authMessage(error) {
    if (!error) return null;
    if (error.code === '42501') return 'Akunmu tidak ada di daftar yang diizinkan mengubah data.';
    if (error.code === '28000') return 'Sesi login habis. Muat ulang halaman dan login lagi.';
    const msg = (error.message || '') + ' ' + (error.code || '');
    if (/jwt expired|invalid jwt|jwt malformed|refresh.{0,10}token|session.{0,10}(expired|invalid|missing)/i.test(msg)) return 'Sesi login habis. Muat ulang halaman dan login lagi.';
    if (/PGRST202|could not find the function/i.test(msg)) return `Fungsi ${RPC[st.entity]} belum ada di database — jalankan migrasi SQL-nya dulu.`;
    return null;
  }

  async function callChunks(items, dryRun, onProgress) {
    const out = [];
    const chunks = chunkArray(items, CHUNK);
    for (let i = 0; i < chunks.length; i++) {
      onProgress && onProgress(i + 1, chunks.length);
      const { data, error } = await S.sb.rpc(RPC[st.entity], { p_items: chunks[i], p_dry_run: dryRun, p_allow_create: st.allowCreate });
      if (error) { console.error('BULK EDIT RPC ERROR (batch ' + (i + 1) + '):', JSON.stringify(error, null, 2)); return { error, doneChunks: i, out }; }
      out.push(...(data && data.baris ? data.baris : []));
      if (data && data.produk_resync != null) st.resync = (st.resync || 0) + data.produk_resync;
    }
    return { error: null, out };
  }

  $('bePreviewBtn').addEventListener('click', async () => {
    if (st.busy) return;
    const rows = parsePasteLines($('bePaste').value);
    if (!rows.length) { showToast('Belum ada data yang ditempel', true); return; }
    resetPreview();
    let cols, dataRows, firstLine = 1, header = null;
    if (isHeaderRow(rows[0], st.entity)) {
      header = columnsFromHeader(rows[0], st.entity);
      const problems = [];
      if (header.missingKeys.length) problems.push(`Kolom kunci tidak ada di header: <b>${header.missingKeys.map(esc).join(', ')}</b>`);
      if (header.unknown.length) problems.push(`Header tidak dikenal: <b>${header.unknown.map(esc).join(', ')}</b> — periksa ejaan atau hapus kolomnya`);
      if (header.dupAttrs.length) problems.push(`Kolom dobel: <b>${header.dupAttrs.map(esc).join(', ')}</b>`);
      if (!header.cols.some((c) => c.type === 'attr')) problems.push('Tidak ada kolom atribut yang bisa diubah di header ini');
      if (problems.length) {
        $('beHeaderProblem').innerHTML = '<i class="ti ti-alert-triangle"></i><div><b>Header belum bisa diproses</b><ul>' + problems.map((p) => `<li>${p}</li>`).join('') + '</ul><span>Tidak ada baris yang dicek sampai header benar.</span></div>';
        $('beHeaderProblem').style.display = 'flex';
        return;
      }
      cols = header.cols; dataRows = rows.slice(1); firstLine = 2;
      if (!dataRows.length) { showToast('Hanya ada baris header, belum ada data', true); return; }
    } else {
      if (!st.sel[st.entity].length) { showToast('Pilih minimal satu atribut (chip) atau tempel dengan baris header', true); return; }
      cols = columnsFromSelection(st.sel[st.entity], st.entity).cols; dataRows = rows;
    }
    const built = buildRows(dataRows, cols, st.entity, st.modes, firstLine);
    st.cols = cols; st.raws = dataRows; st.metas = built.metas; st.info = { header, mode: header ? 'header' : 'chip' };
    st.resync = 0;

    const btn = $('bePreviewBtn'), asal = btn.innerHTML;
    st.busy = true; btn.disabled = true;
    try {
      let baris = [];
      if (built.items.length) {
        btn.innerHTML = `<span class="spinner"></span> Memeriksa ${built.items.length} baris...`;
        const r = await callChunks(built.items, true, (i, n) => { if (n > 1) btn.innerHTML = `<span class="spinner"></span> Memeriksa batch ${i}/${n}...`; });
        if (r.error) { showToast('Gagal cek data: ' + (authMessage(r.error) || r.error.message), true); resetPreview(); return; }
        baris = r.out;
      }
      applyReport(st.metas, baris);
      st.resyncPreview = st.resync;
      renderResult();
    } finally { st.busy = false; btn.disabled = false; btn.innerHTML = asal; }
  });

  // ---------- render preview ----------
  function attrCols() { return st.cols.filter((c) => c.type === 'attr'); }
  function renderResult() {
    const cnt = hitungStatus(st.metas);
    const ders = (st.info && st.info.header && st.info.header.derived) || [];
    $('beSummary').innerHTML =
      ['semua', 'baru', 'ubah', 'sama', 'error'].map((k) => {
        const n = k === 'semua' ? st.metas.length : cnt[k];
        return `<button type="button" class="be-filter ${k}${st.filter === k ? ' on' : ''}" data-f="${k}"${n ? '' : ' disabled'}><span>${k === 'semua' ? 'Semua' : STATUS_LABEL[k]}</span><b>${n}</b></button>`;
      }).join('') +
      (ders.length ? `<span class="be-note"><i class="ti ti-info-circle"></i> Kolom turunan diabaikan: ${ders.map(esc).join(', ')}</span>` : '') +
      (st.entity === 'akd' && st.resyncPreview ? `<span class="be-note"><i class="ti ti-refresh"></i> ${st.resyncPreview} produk terkait akan di-sinkron</span>` : '');

    const acols = attrCols();
    $('beHead').innerHTML = `<tr><th class="c-line">Baris</th><th>${KEYS[st.entity].map((k) => esc(k.label)).join(' · ')}</th><th>Status</th>${acols.map((c) => `<th>${esc(c.def.label)}</th>`).join('')}<th>Keterangan</th></tr>`;
    const list = st.metas.filter((m) => st.filter === 'semua' || m.status === st.filter);
    const MAX = 500;
    $('beBody').innerHTML = list.slice(0, MAX).map((m) => {
      const cells = acols.map((c) => {
        const k = c.def.key, p = m.parsed[k];
        if (m.status === 'error') return `<td class="be-dim">${p ? esc(p.show) : '<span class="be-na">—</span>'}</td>`;
        if (!p) return '<td class="be-dim"><span class="be-na">—</span></td>';
        const d = m.diff && m.diff[k];
        if (m.status === 'baru') return `<td class="be-new">${esc(p.show)}</td>`;
        if (d) return `<td class="be-chg"><span class="be-old">${esc(fmtVal(d[0], k))}</span><i class="ti ti-arrow-right"></i><span class="be-nw">${esc(fmtVal(d[1], k))}</span></td>`;
        return `<td class="be-dim">${esc(p.show)}</td>`;
      }).join('');
      return `<tr class="be-r ${m.status}"><td class="c-line">${m.line}</td><td class="kode-cell">${esc(m.kode || '—')}</td><td><span class="row-status ${m.status === 'error' ? 'err' : 'ok'} be-st-${m.status}">${STATUS_LABEL[m.status]}</span></td>${cells}<td class="be-why">${m.status === 'error' ? esc(m.alasan) : (m.alasan ? esc(m.alasan) : '')}</td></tr>`;
    }).join('') + (list.length > MAX ? `<tr><td colspan="${acols.length + 4}" class="be-more">Menampilkan ${MAX} dari ${list.length} baris (filter untuk mempersempit). Semua baris tetap diproses.</td></tr>` : '');
    $('beResult').style.display = 'block';
    const proses = cnt.baru + cnt.ubah;
    const pb = $('beProsesBtn');
    pb.style.display = proses > 0 ? 'inline-flex' : 'none';
    pb.innerHTML = `<i class="ti ti-check"></i> Proses ${proses} baris`;
    $('beErrBtn').style.display = cnt.error > 0 ? 'inline-flex' : 'none';
    $('beErrBtn').innerHTML = `<i class="ti ti-download"></i> Unduh ${cnt.error} baris gagal`;
  }
  $('beSummary').addEventListener('click', (e) => {
    const b = e.target.closest('.be-filter'); if (!b || b.disabled) return;
    st.filter = b.dataset.f; renderResult();
  });

  // ---------- unduh ----------
  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/tab-separated-values;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  // Baris gagal: kolom persis seperti yang ditempel + "Alasan gagal" (dikenali sebagai kolom turunan, jadi aman ditempel ulang setelah diperbaiki)
  function errorTsv() {
    const head = [...st.cols.map((c) => c.text), 'Alasan gagal'];
    const out = [head];
    st.metas.forEach((m, i) => {
      if (m.status !== 'error') return;
      const raw = st.raws[i] || [];
      out.push([...st.cols.map((c) => (raw[c.idx] == null ? '' : raw[c.idx])), m.alasan || '']);
    });
    return toTsv(out);
  }
  // Snapshot "sebelum": nilai lama kolom yang BERUBAH, format sama dengan paste -> rollback manual = tempel balik.
  // (Nilai yang dulunya kosong tidak bisa dikembalikan ke kosong lewat bulk — sel kosong berarti "tidak diubah".)
  function snapshotTsv(metas) {
    const ac = attrCols();
    const head = [...KEYS[st.entity].map((k) => k.label), ...ac.map((c) => c.def.label)];
    const out = [head];
    metas.forEach((m) => {
      if (m.status !== 'ubah' || !m.diff) return;
      const kv = KEYS[st.entity].map((k) => (m.keyVals && m.keyVals[k.key]) || '');
      out.push([...kv, ...ac.map((c) => { const d = m.diff[c.def.key]; return d && d[0] != null ? fmtVal(d[0], c.def.key).replace(/^—$/, '') : ''; })]);
    });
    return out.length > 1 ? toTsv(out) : null;
  }
  $('beErrBtn').addEventListener('click', () => download(`baris-gagal-${stamp()}.tsv`, errorTsv()));

  // ---------- proses ----------
  $('beProsesBtn').addEventListener('click', async () => {
    if (st.busy) return;
    const cnt = hitungStatus(st.metas);
    const target = st.metas.filter((m) => m.status === 'baru' || m.status === 'ubah');
    if (!target.length) return;
    const msg = `Proses ${target.length} baris (${cnt.baru} baru, ${cnt.ubah} ubah)?` +
      (cnt.error ? `\n${cnt.error} baris gagal tidak ikut diproses.` : '') +
      (cnt.sama ? `\n${cnt.sama} baris sama dilewati.` : '') +
      (st.entity === 'akd' && st.resyncPreview ? `\n${st.resyncPreview} produk terkait ikut di-sinkron.` : '');
    if (!(await crudConfirm(msg, { okLabel: 'Ya, Proses' }))) return;

    const items = [];
    target.forEach((m) => {
      const it = buildRows([st.raws[m.ord - 1]], st.cols, st.entity, st.modes, m.line).items[0];
      if (it) { it.ord = m.ord; items.push(it); }
    });
    const snap = snapshotTsv(target);

    const btn = $('beProsesBtn'), asal = btn.innerHTML;
    st.busy = true; btn.disabled = true; $('bePreviewBtn').disabled = true;
    st.resync = 0;
    try {
      const { data: rs, error: re } = await S.sb.auth.refreshSession();
      if (re || !rs || !rs.session) { showToast('Sesi login sudah habis', true, { detail: 'Muat ulang halaman dan login lagi sebelum memproses.' }); return; }
      const chunks = chunkArray(items, CHUNK);
      const hasil = [];
      let berhenti = null;
      for (let i = 0; i < chunks.length; i++) {
        btn.innerHTML = `<span class="spinner"></span> Memproses batch ${i + 1}/${chunks.length}...`;
        const { data, error } = await S.sb.rpc(RPC[st.entity], { p_items: chunks[i], p_dry_run: false, p_allow_create: st.allowCreate });
        if (error) {
          console.error('BULK EDIT RPC ERROR (batch ' + (i + 1) + '):', JSON.stringify(error, null, 2));
          berhenti = { i, error }; break;
        }
        hasil.push(...(data && data.baris ? data.baris : []));
        if (data && data.produk_resync != null) st.resync += data.produk_resync;
      }
      const byOrd = new Map(hasil.map((b) => [b.ord, b]));
      let ditulis = 0, gagal = 0, sama = 0;
      const tak = [];
      target.forEach((m) => {
        const b = byOrd.get(m.ord);
        if (!b) { tak.push(m); return; }
        m.status = b.status; m.diff = b.diff || m.diff; m.alasan = b.alasan || null;
        if (b.status === 'error') gagal++; else if (b.status === 'sama') sama++; else ditulis++;
      });
      const sudahDiproses = chunks.slice(0, berhenti ? berhenti.i : chunks.length).reduce((n, c) => n + c.length, 0);
      if (berhenti) {
        const pesan = authMessage(berhenti.error) || berhenti.error.message;
        showToast(`Berhenti di batch ${berhenti.i + 1}/${chunks.length}`, true, { detail: `${pesan} ${sudahDiproses} baris sudah tertulis; sisanya belum. Cek ulang data lalu proses lagi.` });
      } else {
        showToast(`Selesai — ${ditulis} baris tertulis${gagal ? `, ${gagal} gagal` : ''}${sama ? `, ${sama} sudah sama` : ''}`, gagal > 0 ? 'warning' : 'success');
      }
      // cache yang bergantung data produk dibuang supaya tabel & filter menampilkan hasil terbaru
      resetManual(); resetKlasifikasi();
      S.invalidateProdukStackCache(); S.loadProduk(); S.refreshProdukFilterCounts();
      if (st.entity === 'akd' && S.loadAkd) S.loadAkd();
      renderResult();
      renderReport({ ditulis, gagal, sama, belum: tak.length, snap, resync: st.resync });
    } finally { st.busy = false; btn.disabled = false; btn.innerHTML = asal; $('bePreviewBtn').disabled = false; }
  });

  function renderReport({ ditulis, gagal, sama, belum, snap, resync }) {
    const box = $('beReport');
    box.innerHTML = `<div class="be-rep-h"><i class="ti ti-circle-check"></i> Hasil proses</div>
      <div class="be-rep-n"><span class="ok">${ditulis} tertulis</span>${gagal ? `<span class="warn">${gagal} gagal</span>` : ''}${sama ? `<span>${sama} sudah sama</span>` : ''}${belum ? `<span class="warn">${belum} belum diproses</span>` : ''}${resync ? `<span>${resync} produk di-sinkron</span>` : ''}</div>
      <div class="be-rep-a">${snap ? '<button type="button" class="btn btn-ghost" id="beSnapBtn"><i class="ti ti-history"></i> Unduh snapshot sebelum</button>' : ''}<span class="be-rep-hint">${snap ? 'Snapshot = nilai lama baris yang berubah; tempel balik untuk mengembalikan (nilai yang dulu kosong tidak bisa dikosongkan lewat bulk).' : ''}</span></div>`;
    box.style.display = 'block';
    const sb = $('beSnapBtn');
    if (sb) sb.addEventListener('click', () => download(`snapshot-sebelum-${stamp()}.tsv`, snap));
    // setelah proses, status "baru/ubah" yang sudah tertulis tidak boleh diproses dua kali lewat tombol lama
    $('beProsesBtn').style.display = st.metas.some((m) => m.status === 'baru' || m.status === 'ubah') && belum ? 'inline-flex' : 'none';
  }

  $('bePaste').addEventListener('input', () => { if (st.metas.length) resetPreview(); });
  $('beClearBtn').addEventListener('click', () => { $('bePaste').value = ''; resetPreview(); });
  refreshStep1();
}