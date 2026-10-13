// Auto-Record + "Perlu tindakan" — BARU 2026-10-13.
//
// MASALAH: user lupa Record, atau lupa nutup sesi -> sesi nyangkut di Konversi Berjalan,
// konversi yang beneran kejadian (di-export / jadi SPH / di-klik e-Kat) gak punya Record.
//
// PRINSIP: status diturunkan dari KEJADIAN, bukan dari ingatan. Record dipecah jadi dua tahap
// berdasarkan SIAPA yang memutuskan:
//   Tahap 1 (simpan ke database): OTOMATIS, dipicu kejadian nyata — Export, Record SPH, atau
//     sesi mandek yang ditutup sweep. Cuma dibuat kalau sesi itu BELUM punya Record sama sekali
//     (jadi gak ada spam REV). Ditandai konversi_record.sumber = 'auto_export' | 'auto_sph' |
//     'auto_mandek' biar dashboard bisa bedain dari Record yang dikonfirmasi manusia.
//   Tahap 2 (Google Sheet): tetap KEPUTUSAN MANUSIA, tapi 1 ketukan ("Kirim ke Sheet").
// "Selesaikan Sesi" SENGAJA TIDAK auto-record: itu jalur resmi buat sesi cek-cek/diskusi yang gak
// jadi transaksi (lihat komentar btnEndSesi di clipboard.js).
//
// Semua isi Record bisa diturunkan dari data sesi yang sudah tersimpan: nama RS, sales, PIC
// (sesi_konversi), mode harga (mode_harga_swasta), kategori (dari tipe item) dan total
// (harga x qty, sama persis dengan computeKonversiSummary di index.js).
//
// Modul ini juga: kirim Record ke Sheet tanpa modal (sendRecordToSheet — payload & idempotency key
// record_id sama persis dengan alur Record manual), dan kotak "Perlu tindakan" di atas Konversi
// Berjalan (klik e-Kat tanpa Record, Record belum ke Sheet, sesi mandek, sesi kosong).
//
// Butuh: migration-auto-record.sql (kolom konversi_record.sumber). State lintas-file lewat S.

// ── Helper murni (di-export biar gampang dites) ─────────────────────────

// Sama persis dengan computeKonversiSummary() di index.js, tapi menerima daftar item.
export function summarizeItems(items, swasta) {
  const tipeSet = new Set((items || []).map(i => String(i.tipe || '').toUpperCase()));
  let kategori;
  if (tipeSet.size === 0) kategori = '-';
  else if (tipeSet.size > 1) kategori = 'Campuran';
  else {
    const t = [...tipeSet][0];
    kategori = t === 'INSTRUMENT' ? 'Instrumen' : t === 'SET' ? 'Set' : t === 'UNIT' ? 'Unit' : t;
  }
  let grandTotal = 0;
  (items || []).forEach(item => {
    const harga = swasta ? (item.harga_swasta || 0) : (item.harga_ekat || 0);
    grandTotal += harga * (item.qty || 1);
  });
  return { kategori, grandTotal };
}

export function idleDays(iso, now) {
  if (!iso) return 0;
  return Math.floor(((now || Date.now()) - new Date(iso).getTime()) / 86400000);
}

// Dari baris Record yang belum ke Sheet, sisakan cuma yang merupakan REVISI TERAKHIR sesinya
// (kalau revisi yang lebih baru sudah terkirim, yang lama gak relevan lagi). allRev = semua
// {sesi_id, revisi, synced_to_sheet} untuk sesi-sesi itu.
export function latestUnsynced(unsynced, allRev) {
  const maxRev = new Map();
  (allRev || []).forEach(r => { const k = String(r.sesi_id); maxRev.set(k, Math.max(maxRev.has(k) ? maxRev.get(k) : -1, Number(r.revisi) || 0)); });
  return (unsynced || []).filter(r => {
    if (r.sesi_id == null) return true; // record tanpa sesi: tampilkan apa adanya
    return (Number(r.revisi) || 0) >= (maxRev.get(String(r.sesi_id)) ?? -1);
  });
}

export const samePic = (pic, mine) => {
  const a = String(pic || '').trim().toLowerCase(), b = String(mine || '').trim().toLowerCase();
  return !!b && a === b;
};

const NOTE = { export: '[otomatis] dibuat saat Export', sph: '[otomatis] dibuat saat Record SPH', mandek: '[otomatis] sesi mandek ditutup', cepat: '' };

// ── Modul ───────────────────────────────────────────────────────────────
export function installAutoRecord(S) {
  const esc = (s) => S.escapeHtmlAttr(s);
  const idOk = (x) => /^[\w-]+$/.test(String(x));
  const inflight = new Map();

  async function api(path, opts) {
    const res = await S.sesiFetch(path, opts);
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.message || e.hint || ('HTTP ' + res.status));
    }
    if (res.status === 204) return null;
    return res.json().catch(() => null);
  }
  const enc = encodeURIComponent;

  async function latestRecord(sesiId) {
    const rows = await api(`konversi_record?sesi_id=eq.${enc(sesiId)}&select=*&order=revisi.desc&limit=1`);
    return rows && rows[0] ? rows[0] : null;
  }

  // Bikin Record REV0 + item-itemnya. Item gagal -> record dibatalkan (gak ninggalin Record kosong).
  async function createRecord(o) {
    const { kategori, grandTotal } = summarizeItems(o.items, o.swasta);
    const body = {
      sesi_id: o.sesiId || null, permintaan_id: o.permintaanId || null,
      tanggal: new Date().toISOString().slice(0, 10),
      nama_rs: o.namaRs || 'RS', pic_sales: o.namaSales || 'Sales', pic_marsup: o.picMarsup || '-',
      pagu_total: o.pagu != null ? o.pagu : null,
      kategori, grand_total: grandTotal, revisi: 0,
      notes: o.notes || '', link: o.link || '', synced_to_sheet: false, sumber: o.sumber
    };
    const made = await api('konversi_record', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(body) });
    const rec = made && made[0];
    if (!rec) throw new Error('Gagal membuat record.');
    try {
      const rows = (o.items || []).map(item => ({
        konversi_record_id: rec.id, produk_id: item.produk_id || null,
        kode_produk: item.kode_produk, nama_produk: item.nama_produk, qty: item.qty || 1,
        harga: o.swasta ? (item.harga_swasta || 0) : (item.harga_ekat || 0)
      }));
      if (rows.length) await api('konversi_item', { method: 'POST', body: JSON.stringify(rows) });
    } catch (err) {
      await api(`konversi_record?id=eq.${enc(rec.id)}`, { method: 'DELETE' }).catch(() => {});
      throw err;
    }
    return rec;
  }

  const once = (key, fn) => {
    if (inflight.has(key)) return inflight.get(key);
    const p = Promise.resolve().then(fn).finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  };

  // Sesi yang LAGI DIBUKA: pakai state layar (clipboard di memori) — lebih baru daripada yang sempat ke-autosave.
  // Dipanggil dari Export dan Record SPH. Null kalau sesi kosong / sudah punya Record.
  function autoRecordCurrent(reason) {
    const sid = S.currentSesiId;
    if (!sid) return Promise.resolve(null);
    return once('cur:' + sid, async () => {
      const items = S.clipboard || [];
      if (!items.length) return null;
      if (await latestRecord(sid)) return null;
      return createRecord({
        sesiId: sid, permintaanId: S.checklistPermintaanId || null,
        namaRs: S.inpRs.value.trim(), namaSales: S.inpSales.value.trim(), picMarsup: S.inpMarsup.value.trim(),
        pagu: typeof S.checklistPagu !== 'undefined' ? S.checklistPagu : null,
        items, swasta: !!S.modeSwastaOutput,
        notes: NOTE[reason] || '', link: S.lastDriveUrl || '', sumber: 'auto_' + reason
      });
    });
  }

  // Sesi mana saja (dari database): dipakai sweep (sesi mandek) dan Record cepat dari daftar.
  // opts.sumber: default 'auto_<reason>'; Record cepat (aksi manusia) pakai 'manual'.
  // opts.picFallback: nama PIC kalau sesinya gak nyimpen (cuma buat aksi manusia, bukan sweep).
  function autoRecordSesiById(sesiId, reason, opts) {
    const o = opts || {};
    return once('id:' + sesiId, async () => {
      if (!idOk(sesiId)) return null;
      if (await latestRecord(sesiId)) return null;
      const [sesi, items] = await Promise.all([
        api(`${S.SESI_TABLE}?id=eq.${enc(sesiId)}&select=id,nama_rs,nama_sales,pic_marsup,mode_harga_swasta`),
        api(`${S.SESI_ITEM_TABLE}?sesi_id=eq.${enc(sesiId)}&select=kode_produk,nama_produk,qty,tipe,harga_ekat,harga_swasta,produk_id&limit=1000`)
      ]);
      const s = sesi && sesi[0];
      if (!s || !items || !items.length) return null;
      return createRecord({
        sesiId, namaRs: s.nama_rs, namaSales: s.nama_sales,
        picMarsup: (s.pic_marsup || '').trim() || o.picFallback || '',
        items, swasta: !!s.mode_harga_swasta,
        notes: NOTE[reason] || '', sumber: o.sumber || ('auto_' + reason)
      });
    });
  }

  // Kirim Record ke Google Sheet — payload & record_id (idempotency key Apps Script) SAMA dengan alur Record manual.
  async function sendRecordToSheet(rec) {
    const token = await S.getFreshToken();
    if (!token || token === S.ANON_KEY) throw new Error('Sesi login sudah habis / belum login — silakan login ulang dulu.');
    const payload = {
      tanggal: rec.tanggal, pic_marsup: rec.pic_marsup, pic_sales: rec.pic_sales,
      keyword: rec.nama_rs, rekanan: rec.nama_rs, customer: rec.nama_rs, distributor: rec.nama_rs,
      kategori: rec.kategori, value: rec.grand_total, notes: rec.notes || '', link: rec.link || '',
      record_id: rec.id
    };
    const res = await fetch(S.SHEETS_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ target: 'konversi', data: payload })
    });
    const raw = await res.text();
    let result;
    try { result = JSON.parse(raw); }
    catch {
      throw new Error((/^\s*<(!doctype|html)/i.test(raw) ? 'Apps Script balikin halaman HTML' : 'Respons Apps Script gak valid: ' + raw.slice(0, 120))
        + ' — baris ini mungkin SUDAH masuk Sheet, cek Sheet dulu sebelum coba lagi supaya gak dobel.');
    }
    if (!result.ok) throw new Error(result.error || 'Gagal menyimpan ke sheet');
    await api(`konversi_record?id=eq.${enc(rec.id)}`, { method: 'PATCH', body: JSON.stringify({ synced_to_sheet: true }) });
    rec.synced_to_sheet = true;
    return rec;
  }
  async function sendRecordToSheetById(recordId) {
    const rows = await api(`konversi_record?id=eq.${enc(recordId)}&select=*`);
    if (!rows || !rows[0]) throw new Error('Record tidak ditemukan.');
    if (rows[0].synced_to_sheet) return rows[0];
    return sendRecordToSheet(rows[0]);
  }

  // Record cepat dari daftar (aksi manusia): pastikan sesi punya Record, opsional langsung ke Sheet.
  // Return { rec, sheetError } — Record yang berhasil tersimpan tetap aman walau Sheet gagal.
  async function quickRecord(sesiId, opts) {
    const o = opts || {};
    let rec = await latestRecord(sesiId);
    if (!rec) {
      let pic = ''; try { pic = (localStorage.getItem('pic_marsup_name') || '').trim(); } catch { /* abaikan */ }
      rec = await autoRecordSesiById(sesiId, 'cepat', { sumber: 'manual', picFallback: pic });
    }
    if (!rec) throw new Error('Sesi ini belum punya produk, jadi belum bisa di-Record.');
    let sheetError = null;
    if (o.sheet && !rec.synced_to_sheet) {
      try { await sendRecordToSheet(rec); } catch (err) { sheetError = err.message; }
    }
    return { rec, sheetError };
  }

  // Record otomatis yang ternyata BUKAN transaksi (mis. cuma cek-cek) — dibuang, sesinya tetap ada.
  async function discardAutoRecord(recordId) {
    await api(`konversi_item?konversi_record_id=eq.${enc(recordId)}`, { method: 'DELETE' });
    await api(`konversi_record?id=eq.${enc(recordId)}&sumber=like.auto*&synced_to_sheet=eq.false`, { method: 'DELETE' });
  }

  S.autoRecordCurrent = autoRecordCurrent;
  S.autoRecordSesiById = autoRecordSesiById;
  S.sendRecordToSheet = sendRecordToSheet;
  S.sendRecordToSheetById = sendRecordToSheetById;
  S.quickRecord = quickRecord;

  // ── Kotak "Perlu tindakan" ────────────────────────────────────────────
  const st = { last: 0, view: null, data: null, open: {} };
  const MANDEK_MIN = 2, MANDEK_MAX = 7; // >= 7 hari ditutup sweep, jadi bukan "perlu tindakan" lagi
  const myPic = () => { try { return (localStorage.getItem('pic_marsup_name') || '').trim(); } catch { return ''; } };
  const cnt = (s) => (s[S.SESI_ITEM_TABLE] && s[S.SESI_ITEM_TABLE][0] && s[S.SESI_ITEM_TABLE][0].count) || 0;

  async function loadTodoInbox(force) {
    const el = document.getElementById('todo-inbox');
    if (!el) return;
    if (!force && Date.now() - st.last < 3000) return;
    st.last = Date.now();
    try {
      const IT = S.SESI_ITEM_TABLE;
      const [berjalan, unsynced, klik] = await Promise.all([
        api(`${S.SESI_TABLE}?status=eq.berjalan&select=id,nama_rs,nama_sales,pic_marsup,updated_at,${IT}(count)&order=updated_at.asc&limit=300`),
        api(`konversi_record?synced_to_sheet=eq.false&select=id,sesi_id,revisi,nama_rs,pic_sales,pic_marsup,grand_total,sumber,tanggal&order=created_at.desc&limit=300`),
        api(`${S.SESI_TABLE}?status=eq.selesai&hasil_order=eq.klik_ekat&select=id,nama_rs,nama_sales,pic_marsup,updated_at,${IT}(count),konversi_record(id)&order=updated_at.desc&limit=300`)
      ]);
      const sesiIds = [...new Set((unsynced || []).map(r => r.sesi_id).filter(x => x != null && idOk(x)))].slice(0, 150);
      const allRev = sesiIds.length ? await api(`konversi_record?sesi_id=in.(${sesiIds.join(',')})&select=sesi_id,revisi,synced_to_sheet`).catch(() => []) : [];
      const now = Date.now();
      st.data = {
        klik: (klik || []).filter(s => !(s.konversi_record || []).length && cnt(s) > 0).map(s => ({ id: s.id, nama: s.nama_rs, pic: s.pic_marsup, sales: s.nama_sales, days: idleDays(s.updated_at, now) })),
        sheet: latestUnsynced(unsynced, allRev).map(r => ({ id: r.id, sesiId: r.sesi_id, nama: r.nama_rs, pic: r.pic_marsup, sales: r.pic_sales, total: r.grand_total, auto: String(r.sumber || '').startsWith('auto'), rev: r.revisi })),
        mandek: (berjalan || []).filter(s => cnt(s) > 0 && idleDays(s.updated_at, now) >= MANDEK_MIN && idleDays(s.updated_at, now) < MANDEK_MAX).map(s => ({ id: s.id, nama: s.nama_rs, pic: s.pic_marsup, sales: s.nama_sales, days: idleDays(s.updated_at, now) })),
        kosong: (berjalan || []).filter(s => cnt(s) === 0 && idleDays(s.updated_at, now) >= MANDEK_MAX).map(s => ({ id: s.id, nama: s.nama_rs, pic: s.pic_marsup, sales: s.nama_sales, days: idleDays(s.updated_at, now) }))
      };
      renderTodo();
    } catch (err) {
      console.warn('Perlu tindakan gagal dimuat:', err);
    }
  }
  S.loadTodoInbox = loadTodoInbox;

  function viewOf() { return st.view || (myPic() ? 'mine' : 'all'); }
  function renderTodo() {
    const el = document.getElementById('todo-inbox');
    const badge = document.getElementById('todo-badge');
    if (!el || !st.data) return;
    const mine = myPic(), v = viewOf();
    const pick = (arr) => (v === 'mine' && mine) ? arr.filter(x => samePic(x.pic, mine)) : arr;
    const G = {
      klik: pick(st.data.klik), sheet: pick(st.data.sheet), mandek: pick(st.data.mandek), kosong: pick(st.data.kosong)
    };
    const total = G.klik.length + G.sheet.length + G.mandek.length + G.kosong.length;
    const allTotal = st.data.klik.length + st.data.sheet.length + st.data.mandek.length + st.data.kosong.length;
    if (badge) { badge.textContent = total; badge.style.display = total ? 'inline-block' : 'none'; }
    if (!allTotal) { el.innerHTML = ''; el.style.display = 'none'; return; } // gak ada yang perlu dikerjain = gak ada kotak (gak nambah keribetan)
    el.style.display = 'block';
    const meta = (x) => [x.sales, x.pic ? 'PIC ' + x.pic : '', x.days != null ? x.days + ' hari lalu' : ''].filter(Boolean).map(esc).join(' · ');
    const row = (x, actions, extra) => `<div class="todo-row"><div class="todo-main"><div class="todo-name">${esc(x.nama || '(Nama RS belum diisi)')}${extra || ''}</div><div class="todo-sub">${meta(x)}</div></div><div class="todo-acts">${actions}</div></div>`;
    const btn = (act, id, label, icon, extra) => `<button type="button" class="rc-act" data-todo="${act}" data-id="${esc(id)}" ${extra || ''}><i class="ti ${icon}"></i><span>${label}</span></button>`;
    const group = (key, title, hint, list, mk) => {
      if (!list.length) return '';
      const shown = st.open[key] ? list : list.slice(0, 5);
      return `<div class="todo-group"><div class="todo-group-title">${title} <span class="todo-n">${list.length}</span> <span class="prj-hint">${hint}</span></div>
        ${shown.map(mk).join('')}
        ${list.length > 5 ? `<button type="button" class="toggle-btn" data-todo="more" data-key="${key}">${st.open[key] ? 'Sembunyikan' : `Lihat ${list.length - 5} lagi`}</button>` : ''}</div>`;
    };
    el.innerHTML = `<div class="todo-box">
      <div class="todo-head"><b><i class="ti ti-bell-ringing"></i> Perlu tindakan</b>
        <span style="flex:1"></span>
        ${mine ? `<button type="button" class="toggle-btn ${v === 'mine' ? 'on' : ''}" data-todo="view" data-v="mine">Punyaku</button><button type="button" class="toggle-btn ${v === 'all' ? 'on' : ''}" data-todo="view" data-v="all">Semua</button>` : ''}
      </div>
      ${total ? '' : `<div class="prj-hint" style="padding:6px 2px">Tidak ada yang perlu kamu tindak lanjuti. ${allTotal} item milik orang lain — pilih "Semua" untuk melihat.</div>`}
      ${group('klik', 'Klik e-Kat tapi belum di-Record', 'konversi ini sudah terbukti jadi — prioritas', G.klik, x => row(x, btn('qrec', x.id, 'Record cepat', 'ti-file-check') + btn('qrec-sheet', x.id, '+ Sheet', 'ti-cloud-upload') + btn('open', x.id, 'Buka', 'ti-external-link')))}
      ${group('sheet', 'Record belum dikirim ke Sheet', '', G.sheet, x => row(x, btn('sheet', x.id, 'Kirim ke Sheet', 'ti-cloud-upload') + (x.auto ? btn('discard', x.id, 'Bukan transaksi', 'ti-trash', 'title="Hapus Record otomatis ini; sesinya tetap ada"') : '') + (x.sesiId ? btn('open', x.sesiId, 'Buka', 'ti-external-link') : ''), (x.auto ? ' <span class="prj-st prj-st-amb">otomatis</span>' : '') + (x.rev ? ' <span class="prj-hint">REV' + esc(x.rev) + '</span>' : '')))}
      ${group('mandek', `Mandek ${MANDEK_MIN}+ hari`, `ditutup otomatis di hari ke-${MANDEK_MAX}`, G.mandek, x => row(x, btn('open', x.id, 'Buka', 'ti-external-link')))}
      ${group('kosong', `Sesi kosong ${MANDEK_MAX}+ hari`, 'tidak ada produk', G.kosong, x => row(x, btn('delete', x.id, 'Hapus', 'ti-trash', `data-nama="${esc(x.nama || '')}"`)))}
    </div>`;
  }

  const todoBox = document.getElementById('todo-inbox');
  if (todoBox) todoBox.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-todo]'); if (!b) return;
    const act = b.dataset.todo, id = b.dataset.id;
    try {
      if (act === 'view') { st.view = b.dataset.v; return renderTodo(); }
      if (act === 'more') { st.open[b.dataset.key] = !st.open[b.dataset.key]; return renderTodo(); }
      if (act === 'open') return S.openSesi(id);
      if (act === 'delete') return S.deleteSesi(id, b.dataset.nama || '', b);
      b.disabled = true;
      if (act === 'qrec' || act === 'qrec-sheet') {
        const { sheetError } = await quickRecord(id, { sheet: act === 'qrec-sheet' });
        S.showToast(sheetError ? 'Record tersimpan ✓, tapi Sheet gagal: ' + sheetError : (act === 'qrec-sheet' ? 'Record tersimpan & terkirim ke Sheet ✓' : 'Record tersimpan ✓'), sheetError ? 'error' : undefined);
      } else if (act === 'sheet') {
        await sendRecordToSheetById(id);
        S.showToast('Terkirim ke Sheet ✓');
      } else if (act === 'discard') {
        if (!(await S.showConfirmModal({ title: 'Bukan transaksi', text: 'Hapus Record otomatis ini? Sesinya tetap ada, hanya Record-nya yang dibuang.', okText: 'Ya, hapus Record' }))) { b.disabled = false; return; }
        await discardAutoRecord(id);
        S.showToast('Record otomatis dihapus.');
      }
      await loadTodoInbox(true);
      if (typeof S.loadRiwayatList === 'function' && S.subtabRiwayat && S.subtabRiwayat.classList.contains('active')) S.loadRiwayatList(true);
    } catch (err) {
      S.showToast('Gagal: ' + err.message, 'error');
      b.disabled = false;
    }
  });
}