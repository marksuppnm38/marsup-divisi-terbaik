// CONVERTER BULK (2026-10-19) — modul baru, dipisah dari index.js/search.js.
//
// Isi:
//   1. S.resolveConvRows(parsed, onProgress): cocokkan BANYAK kode sekaligus lewat RPC
//      resolve_kode_bulk (1 round-trip per chunk, bukan 1 RPC per baris), dengan kunci
//      kode_produk ATAU kode_asli (pilihan #conv-kunci, default 'auto').
//   2. Aturan pemilih otomatis buat kode_asli yang dobel di tabel produk (548 grup):
//        - 1 kandidat                       -> langsung dipakai
//        - >1, skor tertinggi UNIK          -> dipakai + chip "+N varian lain" (bisa ditukar)
//        - >1, skor imbang                  -> tie-break kemiripan nama_input (Jaccard);
//                                              kalau tetap imbang -> status 'ambiguous',
//                                              user WAJIB pilih (gak ada tebak-tebakan)
//        - >1, ada kandidat skor lebih rendah yang namanya JELAS lebih cocok sama
//          nama_input -> 'ambiguous' juga (cegah salah kirim barang)
//      Skor dihitung di SQL (aktif +4, punya harga +2, link +1, AKD +1).
//   3. Copy Tabel (preset kolom) yang MENJAGA URUTAN & JUMLAH BARIS input, supaya hasil
//      bisa langsung ditempel di sebelah kolom asli di Sheet. Baris yang gak ketemu tetap
//      ada, ditandai jelas.
//
// Kalau RPC belum dipasang di database (01_resolve_kode_bulk.sql), otomatis jatuh ke
// jalur lama (S.matchOneKode, 1 RPC per baris, cuma kode_produk) + toast pemberitahuan.
export function installConverterBulk(S) {

  const CHUNK_SIZE = 150;         // RPC maksimal 500; 150 aman buat timeout free-tier
  const MIN_SIM_PICK = 0.3;       // kemiripan nama minimum buat memutus imbang
  const MIN_SIM_GAP = 0.15;       // selisih minimum terhadap kandidat berikutnya
  // Grup yang deskripsinya BEDA (kode_asli dipakai 2 barang) taruhannya salah-kirim barang,
  // jadi bukti kemiripan buat memutus imbang harus jauh lebih kuat.
  const MIN_SIM_PICK_KONFLIK = 0.6;
  const MIN_SIM_GAP_KONFLIK = 0.25;
  const NAME_CONFLICT_GAP = 0.3;  // kandidat skor rendah dianggap "jelas lebih cocok" kalau selisih >= ini
  const NAME_CONFLICT_MIN = 0.5;  //  ...dan kemiripannya sendiri >= ini

  S.convAltOpen = new Set();      // idx baris yang daftar varian-nya lagi dibuka

  // ── util ──────────────────────────────────────────────────────────────
  const esc = (s) => S.escapeHtmlAttr ? S.escapeHtmlAttr(String(s ?? '')) :
    String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function tokens(s) {
    return new Set(String(s || '').toUpperCase().split(/[^A-Z0-9]+/).filter(t => t.length >= 2));
  }
  // Jaccard antar token nama. Dua nama kosong = 0 (bukan 1) supaya gak "cocok" tanpa bukti.
  function nameSim(a, b) {
    const A = tokens(a), B = tokens(b);
    if (!A.size || !B.size) return 0;
    let inter = 0;
    A.forEach(t => { if (B.has(t)) inter++; });
    return inter / (A.size + B.size - inter);
  }

  function isMissingRpc(error) {
    const msg = String((error && (error.message || error.hint || error.code)) || '');
    return /PGRST202|Could not find the function|does not exist|resolve_kode_bulk/.test(msg) && !/timeout|canceling/i.test(msg);
  }

  // ── bangun SATU baris hasil dari kandidat ─────────────────────────────
  // matches: array baris RPC (sudah difilter ditemukan=true) ATAU [] kalau gak ketemu.
  function buildRow(kode, nama_input, matches, errMsg) {
    const row = { kode, nama_input, status: 'not_found', produk: null, errMsg: null,
                  alternatives: [], kunci: null, konflik: false };
    if (errMsg) { row.status = 'error'; row.errMsg = errMsg; return row; }
    if (!kode || !matches || !matches.length) return row;

    let cands = matches.slice();
    // Belum firm (link_v6 ada catatan) gak dipakai konversian (kecuali mode Swasta).
    if (!S.modeSwastaOutput) {
      const firm = cands.filter(c => S.isProdukFirm(c));
      if (!firm.length) { row.notFirm = true; return row; }
      cands = firm;
    }
    cands.sort((a, b) => (b.skor || 0) - (a.skor || 0));
    row.kunci = cands[0].kunci_dipakai || null;
    row.konflik = !!cands.some(c => c.ambigu_beda_nama);

    let pick = null;
    if (cands.length === 1) {
      pick = cands[0];
    } else {
      const top = cands[0], second = cands[1];
      const withSim = cands.map(c => ({ c, sim: nameSim(nama_input, c.nama_produk) }));
      const simOf = (c) => withSim.find(x => x.c === c).sim;

      if ((top.skor || 0) > (second.skor || 0)) {
        pick = top;
        // Pengaman salah-kirim: ada kandidat skor lebih rendah yang namanya JELAS lebih cocok.
        if (nama_input) {
          const best = withSim.filter(x => x.c !== top).sort((a, b) => b.sim - a.sim)[0];
          if (best && best.sim >= NAME_CONFLICT_MIN && best.sim - simOf(top) >= NAME_CONFLICT_GAP) pick = null;
        }
      } else if (nama_input) {
        // Skor imbang -> pakai kemiripan nama sebagai pemutus.
        const tied = withSim.filter(x => (x.c.skor || 0) === (top.skor || 0)).sort((a, b) => b.sim - a.sim);
        const minSim = row.konflik ? MIN_SIM_PICK_KONFLIK : MIN_SIM_PICK;
        const minGap = row.konflik ? MIN_SIM_GAP_KONFLIK : MIN_SIM_GAP;
        if (tied[0].sim >= minSim && (tied.length < 2 || tied[0].sim - tied[1].sim >= minGap)) pick = tied[0].c;
      }
    }

    if (!pick) {                       // belum bisa diputuskan -> user yang pilih
      row.status = 'ambiguous';
      row.alternatives = cands;
      return row;
    }
    row.produk = pick;
    row.alternatives = cands.filter(c => c !== pick);
    const namaKatalog = (pick.nama_produk || '').trim().toLowerCase();
    const namaInputNorm = (nama_input || '').trim().toLowerCase();
    row.status = (!namaInputNorm || namaKatalog === namaInputNorm) ? 'exact' : 'code_found_name_diff';
    return row;
  }
  S.buildConvRow = buildRow; // diekspos supaya bisa dites terpisah

  // ── resolver utama ────────────────────────────────────────────────────
  async function callRpcWithRetry(kodes, kunci) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { data, error } = await S.rpc('resolve_kode_bulk', { p_kodes: kodes, p_kunci: kunci });
        if (!error) return { data };
        const msg = error.message || JSON.stringify(error);
        if (isMissingRpc(error)) return { missing: true, errMsg: msg };
        if ((/timeout|canceling/i.test(msg)) && attempt === 0) continue;
        return { errMsg: msg };
      } catch (e) {
        if (attempt === 0) continue;
        return { errMsg: e.message || String(e) };
      }
    }
    return { errMsg: 'gagal' };
  }

  async function resolveConvRows(parsed, onProgress) {
    S.convAltOpen = new Set();
    const kunciEl = document.getElementById('conv-kunci');
    const kunci = (kunciEl && kunciEl.value) || 'auto';

    // Kode unik (case-insensitive) -> 1 permintaan per kode unik, hasilnya dipakai ulang buat duplikat.
    const keyOf = (k) => String(k || '').trim().toLowerCase();
    const uniq = [], seen = new Map();
    parsed.forEach(p => { const k = keyOf(p.kode); if (k && !seen.has(k)) { seen.set(k, uniq.length); uniq.push(p.kode.trim()); } });

    const byKey = new Map();            // keyOf(kode) -> { matches, errMsg }
    let missing = false;
    for (let off = 0; off < uniq.length; off += CHUNK_SIZE) {
      const chunk = uniq.slice(off, off + CHUNK_SIZE);
      if (onProgress) onProgress(Math.min(off + chunk.length, uniq.length), uniq.length);
      const res = await callRpcWithRetry(chunk, kunci);
      if (res.missing) { missing = true; break; }
      if (res.errMsg) { chunk.forEach(k => byKey.set(keyOf(k), { matches: [], errMsg: res.errMsg })); continue; }
      // input_idx = posisi 1-based di chunk
      const grouped = new Map();
      (res.data || []).forEach(r => {
        const k = keyOf(chunk[r.input_idx - 1]);
        if (!grouped.has(k)) grouped.set(k, []);
        if (r.ditemukan) grouped.get(k).push(r);
      });
      chunk.forEach(k => byKey.set(keyOf(k), { matches: grouped.get(keyOf(k)) || [], errMsg: null }));
    }

    if (missing) {
      // RPC belum dipasang -> jalur lama (kode_produk saja), supaya Converter tetap hidup.
      S.showToast('Fungsi resolve_kode_bulk belum dipasang di database — pakai mode lama (lambat, kode produk saja).', 'error');
      if (typeof S.matchOneKode !== 'function') throw new Error('resolve_kode_bulk belum dipasang');
      const rows = [];
      for (let i = 0; i < parsed.length; i++) {
        if (onProgress) onProgress(i + 1, parsed.length);
        rows.push(await S.matchOneKode(parsed[i].kode, parsed[i].nama_input));
      }
      return rows;
    }

    await S.verifiedReady;
    return parsed.map(p => {
      const hit = byKey.get(keyOf(p.kode));
      return buildRow(p.kode, p.nama_input, hit ? hit.matches : [], hit && hit.errMsg);
    });
  }
  S.resolveConvRows = resolveConvRows;

  // ── daftar varian (dipakai index.js convRowHtml) ──────────────────────
  const rp = (n) => (n == null || n === '') ? null : 'Rp ' + Number(n).toLocaleString('id-ID');
  function altFlags(c) {
    const hargaPakai = S.modeSwastaOutput ? c.harga_swasta : c.harga_ekat;
    const flags = [];
    flags.push(hargaPakai ? esc(rp(hargaPakai)) : '<span class="conv-alt-warn">tanpa harga</span>');
    if (!S.modeSwastaOutput) flags.push(S.cleanLinkV6(c.link_v6) ? 'ada link' : '<span class="conv-alt-warn">tanpa link</span>');
    if (c.no_akd) flags.push('AKD');
    if (c.is_active === false) flags.push('<span class="conv-alt-warn">nonaktif</span>');
    return flags.join(' · ');
  }
  // Satu daftar kandidat, dipakai untuk 2 kasus: baris ambigu (belum ada pilihan) dan
  // baris yang sudah auto-pick tapi punya varian lain.
  S.convAltListHtml = function convAltListHtml(i, r) {
    if (!r.alternatives || !r.alternatives.length) return '';
    const label = r.produk ? 'Ganti ke varian lain:' : 'Pilih salah satu:';
    const konflikNote = r.konflik
      ? '<div class="conv-alt-note">⚠ Deskripsinya beda antar kode ini — cek dulu sebelum memilih.</div>' : '';
    const items = r.alternatives.map(c => `<div class="conv-alt-row">
      <div class="conv-alt-info">
        <span class="conv-alt-nama">${esc(c.nama_produk)}</span>
        <span class="conv-alt-meta"><span class="conv-manual-row-kode">${esc(c.kode_produk)}</span> · ${altFlags(c)}</span>
      </div>
      <button type="button" class="conv-manual-pick conv-alt-pick" data-idx="${i}" data-kode="${esc(c.kode_produk)}">${r.produk ? 'Pakai' : 'Pilih'}</button>
    </div>`).join('');
    return `<div class="conv-alt-list"><div class="conv-alt-title">${label}</div>${konflikNote}${items}</div>`;
  };

  // ── interaksi: buka/tutup daftar varian + tukar pilihan ───────────────
  if (S.convResultsEl) {
    S.convResultsEl.addEventListener('click', async (e) => {
      const tgl = e.target.closest('.conv-alt-toggle');
      if (tgl) {
        const i = parseInt(tgl.dataset.idx, 10);
        if (S.convAltOpen.has(i)) S.convAltOpen.delete(i); else S.convAltOpen.add(i);
        S.patchConvRow(i);
        return;
      }
      const pick = e.target.closest('.conv-alt-pick');
      if (!pick) return;
      const i = parseInt(pick.dataset.idx, 10);
      const row = S.convRows[i];
      const chosen = row && (row.alternatives || []).find(a => a.kode_produk === pick.dataset.kode);
      if (!chosen) return;
      pick.disabled = true;
      const old = row.produk;
      row.alternatives = [...(old ? [old] : []), ...row.alternatives.filter(a => a !== chosen)];
      row.produk = chosen;
      row.status = 'manual_matched';
      row.errMsg = null;
      S.convExpandedIdx.delete(i);
      S.convAltOpen.delete(i);
      try { await S.enrichResultsWithStok([chosen]); } finally { S.patchConvRow(i); S.updateConvSummary(); }
    });
  }

  // ── COPY TABEL (preset kolom) ─────────────────────────────────────────
  const PRESETS = {
    kdhl:    { label: 'Kode · Deskripsi · Harga · Link', cols: ['kode', 'deskripsi', 'harga', 'link'] },
    peta:    { label: 'Peta: Kode Input → Kode Produk / Kode Asli', cols: ['input', 'kode', 'asli', 'deskripsi'] },
    lengkap: { label: 'Lengkap (+ AKD, stok, catatan)', cols: ['no', 'input', 'kode', 'asli', 'deskripsi', 'harga', 'link', 'akd', 'berlaku', 'stok', 'catatan'] }
  };
  S.CONV_PRESETS = PRESETS;

  function catatanOf(r) {
    if (r.status === 'error') return 'ERROR — belum dicek';
    if (r.notFirm) return 'BELUM FIRM — tidak dipakai';
    if (r.status === 'ambiguous') return `AMBIGU — ${r.alternatives.length} kode produk, belum dipilih`;
    if (!r.produk) return 'TIDAK DITEMUKAN';
    const n = (r.alternatives || []).length;
    const parts = [];
    if (r.status === 'code_found_name_diff') parts.push('nama input beda dgn katalog');
    if (n) parts.push(`${n} varian lain`);
    if (r.status === 'manual_matched') parts.push('dipilih manual');
    return parts.join('; ');
  }

  function cellValue(col, r, idx, hasInputCol) {
    const p = r.produk;
    const swasta = !!S.modeSwastaOutput;
    switch (col) {
      case 'no':        return idx + 1;
      case 'input':     return r.kode;
      // Preset tanpa kolom "kode input": baris yang gagal tetap menampilkan kode yang dipaste,
      // supaya kelihatan kode MANA yang bermasalah (bukan baris kosong misterius).
      case 'kode':      return p ? p.kode_produk : (hasInputCol ? '' : r.kode);
      case 'asli':      return p ? (p.kode_asli || '') : '';
      case 'deskripsi': return p ? p.nama_produk : catatanOf(r);   // baris gak ketemu: alasan tampil di kolom deskripsi
      case 'harga':     { if (!p) return ''; const h = swasta ? p.harga_swasta : p.harga_ekat; return h == null ? '' : Number(h); }
      case 'link':      return (p && !swasta) ? (S.cleanLinkV6(p.link_v6) || '') : '';
      case 'akd':       return p ? (p.no_akd || '') : '';
      case 'berlaku':   return p ? (p.masa_berlaku || '') : '';
      case 'stok':      return p ? (S.stokStatusOutput(p.stok_status) || '') : '';   // DATA_TIDAK_LENGKAP -> INDENT
      case 'catatan':   return catatanOf(r);
      default:          return '';
    }
  }
  const HEADERS = { no: 'NO', input: 'KODE INPUT', kode: 'KODE PRODUK', asli: 'KODE ASLI', deskripsi: 'DESKRIPSI', link: 'LINK',
                    akd: 'NO AKD', berlaku: 'AKD BERLAKU', stok: 'STOK', catatan: 'CATATAN' };
  function headerOf(col) {
    if (col === 'harga') return S.modeSwastaOutput ? 'HARGA (SWASTA)' : 'HARGA (E-KAT)';
    return HEADERS[col] || col.toUpperCase();
  }

  // Dibuat murni (gak nyentuh DOM/clipboard) supaya gampang dites.
  S.buildConvTable = function buildConvTable(rows, presetKey) {
    const preset = PRESETS[presetKey] || PRESETS.kdhl;
    const clean = (s) => String(s ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ').trim();
    const head = preset.cols.map(headerOf);
    const hasInputCol = preset.cols.includes('input');
    const body = rows.map((r, i) => preset.cols.map(c => cellValue(c, r, i, hasInputCol)));
    const plain = [head, ...body].map(line => line.map(clean).join('\t')).join('\n');
    const hasProblem = (r) => !r.produk;
    const th = head.map(h => `<th style="border:1px solid #000;background:#1D5BD4;color:#fff">${esc(h)}</th>`).join('');
    const trs = body.map((line, i) => {
      const bg = hasProblem(rows[i]) ? ' style="background:#FDE8E8"' : '';
      const tds = line.map((v, ci) => {
        const isNum = preset.cols[ci] === 'harga' && v !== '';
        return `<td style="border:1px solid #000${isNum ? ';text-align:right' : ''}">${esc(v)}</td>`;
      }).join('');
      return `<tr${bg}>${tds}</tr>`;
    }).join('');
    const html = `<table border="1" style="border-collapse:collapse"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
    return { html, plain, nBaris: rows.length, nTidak: rows.filter(hasProblem).length };
  };

  const btnCopyTabel = document.getElementById('btn-conv-copy-tabel');
  const presetEl = document.getElementById('conv-preset');
  if (btnCopyTabel) {
    btnCopyTabel.addEventListener('click', async () => {
      if (!S.convRows || !S.convRows.length) { S.showToast('Belum ada hasil untuk disalin', 'error'); return; }
      const { html, plain, nBaris, nTidak } = S.buildConvTable(S.convRows, presetEl ? presetEl.value : 'kdhl');
      const ok = await S.writeRichClipboard(html, plain);
      if (!ok) { S.showToast('Gagal copy ke clipboard, coba lagi', 'error'); return; }
      S.showToast(`Tersalin ${nBaris} baris (urutan sama dengan input)` + (nTidak ? ` — ${nTidak} baris belum terselesaikan, ditandai merah` : '') + ' ✓');
      const original = btnCopyTabel.innerHTML;
      btnCopyTabel.innerHTML = '<i class="ti ti-check"></i> Tersalin!';
      setTimeout(() => { btnCopyTabel.innerHTML = original; }, 1800);
    });
  }
}