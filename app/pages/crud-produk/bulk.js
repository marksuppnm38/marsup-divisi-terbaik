// AUTO-EXTRACTED dari crud-produk/index.js (breakup, lanjutan akd-master.js +
// kfa.js). Isi 3 alur Bulk Edit: Harga, Link V6, Inaproc Tracker. sb/
// escapeHtml lewat S.sb/S.escapeHtml seperti biasa; invalidateProdukStackCache/
// loadProduk/refreshProdukFilterCounts (masih di index.js, bagian Produk List
// yang belum dipecah) dioper lewat S juga. parsePasteLines diekspor ke S karena
// dipakai balik dari luar (fitur Paste Rincian Set di tab Set Detail, index.js
// baris compPastePreviewBtn). Logic TIDAK diubah.
import { showToast, crudConfirm, crudAlert, renderPgBar, parseLinkV6 } from './ui-utils.js';

export function installBulk(S) {
// ================================================================
// BULK EDIT
// ================================================================
document.querySelectorAll('.bulk-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.bulk-tab').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.bulk-panel').forEach(p => p.classList.toggle('active', p.id === 'bulk-' + btn.dataset.bulk));
  });
});

// FIX (bulk paste kadang "gak kebaca" 1-2 item + hasilnya berantakan): dulu
// baris dipisah pakai raw.split('\n') doang duluan, baru tiap baris di-split
// tab -- gak ngerti quoting sama sekali. Masalahnya kalau salah satu cell
// (biasanya nama item yang panjang) di Excel/Google Sheets ke-wrap manual
// jadi beberapa baris FISIK, pas di-copy sebagai TSV, Excel/Sheets otomatis
// bungkus cell itu pakai tanda kutip ganda (") dan newline di dalemnya ikut
// kebawa apa adanya. Contoh nyata dari user:
//   ...\t"MAYO SAFETY PIN, F/ HOLDING RING HANDLE INSTRUMENTS, 140
//   MM"\t2
// itu SATU baris data (satu item, qty 2), tapi split-by-newline lama
// motongnya jadi DUA baris rusak -- satu kehilangan kolom qty (jadi ke-skip
// atau salah kebaca sebagai kode_set), satu lagi kodeItem-nya jadi pecahan
// teks 'MM"' yang gak match produk manapun. Makanya item itu ilang / nongol
// jadi 2 baris error yang bikin preview berantakan.
//
// Parser di bawah ini TSV-aware ala CSV (RFC4180-style, delimiter tab):
// - field yang dibungkus tanda kutip ganda boleh berisi tab/newline literal
//   di dalemnya, dan itu tetap dianggap SATU field/baris yang sama
// - tanda kutip ganda dobel ("") di dalam field = satu tanda kutip literal
//   (aturan escaping standar yang dipakai Excel & Google Sheets)
// - newline literal di dalam field diganti jadi spasi (itu tetap satu nilai
//   teks, bukan beneran dua baris terpisah) biar hasilnya rapi buat ditampilin
function parsePasteLines(raw){
  const text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } // "" di dalam field = 1 kutip literal
        else { inQuotes = false; } // kutip penutup
      } else if (ch === '\n') {
        field += ' '; // newline literal di dalam field kutip -> spasi
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === '') { inQuotes = true; continue; } // kutip pembuka (harus di awal field)
    if (ch === '\t') { row.push(field); field = ''; continue; }
    if (ch === '\n') {
      row.push(field); field = '';
      if (row.some(c => c.trim() !== '')) rows.push(row); // baris kosong (mis. baris paling akhir) diabaikan
      row = [];
      continue;
    }
    field += ch;
  }
  if (field !== '' || row.length) { // baris terakhir kalau paste-annya gak diakhiri newline
    row.push(field);
    if (row.some(c => c.trim() !== '')) rows.push(row);
  }
  return rows.map(r => r.map(c => c.trim()));
}
// Pecah array jadi potongan-potongan kecil sebelum dikirim ke RPC — satu potongan
// = satu panggilan jaringan (bukan satu panggilan per baris kayak sebelumnya), dan
// tetap di bawah cap ukuran batch yang divalidasi di sisi RPC (lihat bulk_rpc_migration.sql).
function chunkArray(arr, size){
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ---- BULK HARGA ----
let bulkHargaRows = [];
document.getElementById('bulkHargaPreviewBtn').addEventListener('click', async () => {
  const lines = parsePasteLines(document.getElementById('bulkHargaPaste').value);
  if (lines.length === 0) { showToast('Belum ada data yang di-paste', true); return; }
  const btn = document.getElementById('bulkHargaPreviewBtn');
  const btnHtmlAsal = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> Memeriksa ${lines.length} baris...`;
  try {
    const kodeSet = [...new Set(lines.map(l => l[0]).filter(Boolean))];
    const { data: produkRows, error } = await S.sb.from('produk').select('id, kode_produk, nama_produk').in('kode_produk', kodeSet);
    if (error) { showToast('Gagal cek produk: ' + error.message, true); return; }
    const byKode = Object.fromEntries((produkRows || []).map(p => [p.kode_produk, p]));

    bulkHargaRows = lines.map(l => {
      const [kode, tahunStr, hargaStr] = l;
      const tahun = parseInt(tahunStr, 10);
      const hargaEkat = parseFloat((hargaStr || '').replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.'));
      const produk = byKode[kode];
      let status = 'ok', msg = 'Siap diproses';
      if (!kode) { status = 'err'; msg = 'Kode produk kosong'; }
      else if (!produk) { status = 'err'; msg = 'Kode produk tidak ditemukan'; }
      else if (!tahun) { status = 'err'; msg = 'Tahun tidak valid'; }
      else if (isNaN(hargaEkat)) { status = 'err'; msg = 'Harga tidak valid'; }
      return { kode, tahun, hargaEkat, produk, status, msg };
    });

    renderBulkHargaPreview();
  } finally {
    btn.disabled = false;
    btn.innerHTML = btnHtmlAsal;
  }
});
function renderBulkHargaPreview(){
  const wrap = document.getElementById('bulkHargaPreviewWrap');
  const body = document.getElementById('bulkHargaPreviewBody');
  const summary = document.getElementById('bulkHargaSummary');
  const okCount = bulkHargaRows.filter(r => r.status === 'ok').length;
  const errCount = bulkHargaRows.length - okCount;
  summary.innerHTML = `<span class="ok">${okCount} baris siap diproses</span>${errCount ? `<span class="warn">${errCount} baris bermasalah (tidak ikut diproses)</span>` : ''}`;
  wrap.style.display = 'block';
  body.innerHTML = '';
  bulkHargaRows.forEach(r => {
    const tr = document.createElement('tr');
    const swasta = !isNaN(r.hargaEkat) ? Math.round(r.hargaEkat * 1.3) : '—';
    const upload = !isNaN(r.hargaEkat) ? Math.round(r.hargaEkat / 1.11) : '—';
    tr.innerHTML = `
      <td class="kode-cell">${S.escapeHtml(r.kode)}</td>
      <td>${S.escapeHtml(r.produk?.nama_produk || '—')}</td>
      <td>${r.tahun || '—'}</td>
      <td>${!isNaN(r.hargaEkat) ? 'Rp ' + r.hargaEkat.toLocaleString('id-ID') : '—'}</td>
      <td>${typeof swasta === 'number' ? 'Rp ' + swasta.toLocaleString('id-ID') : swasta}</td>
      <td>${typeof upload === 'number' ? 'Rp ' + upload.toLocaleString('id-ID') : upload}</td>
      <td><span class="row-status ${r.status}">${r.status === 'ok' ? 'Siap' : r.msg}</span></td>
    `;
    body.appendChild(tr);
  });
  document.getElementById('bulkHargaProsesBtn').style.display = okCount > 0 ? 'inline-flex' : 'none';
}
document.getElementById('bulkHargaProsesBtn').addEventListener('click', async () => {
  const rows = bulkHargaRows.filter(r => r.status === 'ok');
  if (rows.length === 0) return;
  const btn = document.getElementById('bulkHargaProsesBtn');
  const labelAsal = btn.textContent;
  btn.disabled = true;

  // RPC bulk_upsert_harga: 1 panggilan hitung + upsert EKATALOG/SWASTA/UPLOAD
  // sekaligus utk semua baris di batch itu (dulu: 3-6 query per baris di client).
  const items = rows.map(r => ({ produk_id: r.produk.id, tahun: r.tahun, harga_ekat: r.hargaEkat }));
  const chunks = chunkArray(items, 300);
  let sukses = 0, gagal = 0;
  for (let i = 0; i < chunks.length; i++) {
    btn.textContent = chunks.length > 1 ? `Memproses batch ${i + 1}/${chunks.length}...` : labelAsal;
    const { data, error } = await S.sb.rpc('bulk_upsert_harga', { p_items: chunks[i] });
    if (error) {
      console.error('BULK HARGA RPC ERROR (batch ' + (i + 1) + '):', JSON.stringify(error, null, 2));
      gagal += chunks[i].length;
    } else {
      sukses += data?.processed ?? chunks[i].length;
    }
  }
  btn.disabled = false;
  btn.textContent = labelAsal;
  showToast(`Selesai — ${sukses} produk ter-update${gagal ? `, ${gagal} baris gagal (lihat console)` : ''}`, gagal > 0);
  document.getElementById('bulkHargaPaste').value = '';
  document.getElementById('bulkHargaPreviewWrap').style.display = 'none';
  document.getElementById('bulkHargaSummary').innerHTML = '';
  btn.style.display = 'none';
  bulkHargaRows = [];
  S.invalidateProdukStackCache();
  S.loadProduk();
  S.refreshProdukFilterCounts();
});

// ---- KOMPOSISI SET dipindah ke tab-composition (lihat compPaste* di dekat loadComposition) ----

// ---- BULK LINK V6 ----
let bulkLinkRows = [];
document.getElementById('bulkLinkPreviewBtn').addEventListener('click', async () => {
  const lines = parsePasteLines(document.getElementById('bulkLinkPaste').value);
  if (lines.length === 0) { showToast('Belum ada data yang di-paste', true); return; }
  const btn = document.getElementById('bulkLinkPreviewBtn');
  const btnHtmlAsal = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> Memeriksa ${lines.length} baris...`;
  try {
    const kodeSet = [...new Set(lines.map(l => l[0]).filter(Boolean))];
    const { data: produkRows, error } = await S.sb.from('produk').select('id, kode_produk, nama_produk, link_v6').in('kode_produk', kodeSet);
    if (error) { showToast('Gagal cek produk: ' + error.message, true); return; }
    const byKode = Object.fromEntries((produkRows || []).map(p => [p.kode_produk, p]));

    bulkLinkRows = lines.map(l => {
      const [kode, link] = l;
      const produk = byKode[kode];
      let status = 'ok', msg = 'Siap diproses';
      if (!kode) { status = 'err'; msg = 'Kode produk kosong'; }
      else if (!produk) { status = 'err'; msg = 'Kode produk tidak ditemukan'; }
      else if (!link) { status = 'err'; msg = 'Link kosong'; }
      else {
        // Link harus URL bersih. Yang ada catatan tambahan (mis. "UPDATE HARGA
        // TAPI MASIH NYANTOL ORDERAN") ditolak biar gak ke-label "Ada di
        // e-Katalog" di Konversian — pisahin dulu catatannya dari URL-nya.
        const L = parseLinkV6(link);
        if (L.state === 'catatan') { status = 'err'; msg = 'Link ada catatan: "' + L.catatan.slice(0, 40) + '" — pisahkan dari URL'; }
        else if (L.state === 'invalid') { status = 'err'; msg = 'Bukan URL'; }
      }
      return { kode, link, produk, status, msg };
    });
    renderBulkLinkPreview();
  } finally {
    btn.disabled = false;
    btn.innerHTML = btnHtmlAsal;
  }
});
function renderBulkLinkPreview(){
  const wrap = document.getElementById('bulkLinkPreviewWrap');
  const body = document.getElementById('bulkLinkPreviewBody');
  const summary = document.getElementById('bulkLinkSummary');
  const okCount = bulkLinkRows.filter(r => r.status === 'ok').length;
  const errCount = bulkLinkRows.length - okCount;
  summary.innerHTML = `<span class="ok">${okCount} baris siap diproses</span>${errCount ? `<span class="warn">${errCount} baris bermasalah (tidak ikut diproses)</span>` : ''}`;
  wrap.style.display = 'block';
  body.innerHTML = '';
  bulkLinkRows.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="kode-cell">${S.escapeHtml(r.kode)}</td>
      <td>${S.escapeHtml(r.produk?.nama_produk || '—')}</td>
      <td class="media-link" style="max-width:180px;">${S.escapeHtml(r.produk?.link_v6 || '—')}</td>
      <td class="media-link" style="max-width:180px;">${S.escapeHtml(r.link || '—')}</td>
      <td><span class="row-status ${r.status}">${r.status === 'ok' ? 'Siap' : r.msg}</span></td>
    `;
    body.appendChild(tr);
  });
  document.getElementById('bulkLinkProsesBtn').style.display = okCount > 0 ? 'inline-flex' : 'none';
}
document.getElementById('bulkLinkProsesBtn').addEventListener('click', async () => {
  const rows = bulkLinkRows.filter(r => r.status === 'ok');
  if (rows.length === 0) return;
  const btn = document.getElementById('bulkLinkProsesBtn');
  const labelAsal = btn.textContent;
  btn.disabled = true;

  const items = rows.map(r => ({ produk_id: r.produk.id, link: r.link }));
  const chunks = chunkArray(items, 500);
  let sukses = 0, gagal = 0;
  for (let i = 0; i < chunks.length; i++) {
    btn.textContent = chunks.length > 1 ? `Memproses batch ${i + 1}/${chunks.length}...` : labelAsal;
    const { data, error } = await S.sb.rpc('bulk_update_link_v6', { p_items: chunks[i] });
    if (error) {
      console.error('BULK LINK V6 RPC ERROR (batch ' + (i + 1) + '):', JSON.stringify(error, null, 2));
      gagal += chunks[i].length;
    } else {
      sukses += data?.processed ?? chunks[i].length;
    }
  }
  btn.disabled = false;
  btn.textContent = labelAsal;
  showToast(`Selesai — ${sukses} link ter-update${gagal ? `, ${gagal} baris gagal (lihat console)` : ''}`, gagal > 0);
  document.getElementById('bulkLinkPaste').value = '';
  document.getElementById('bulkLinkPreviewWrap').style.display = 'none';
  document.getElementById('bulkLinkSummary').innerHTML = '';
  btn.style.display = 'none';
  bulkLinkRows = [];
  S.invalidateProdukStackCache();
  S.loadProduk();
  S.refreshProdukFilterCounts();
});

// ---- BULK INAPROC TRACKER ----
const BULAN_INDO = { januari:1, februari:2, maret:3, april:4, mei:5, juni:6, juli:7, agustus:8, september:9, oktober:10, november:11, desember:12 };
function parseTglIndo(txt){
  if (!txt) return null;
  const parts = txt.trim().toLowerCase().split(/\s+/);
  if (parts.length !== 3) return null;
  const bulan = BULAN_INDO[parts[1]];
  if (!bulan) return null;
  const tgl = parseInt(parts[0], 10), tahun = parseInt(parts[2], 10);
  if (!tgl || !tahun) return null;
  return `${tahun}-${String(bulan).padStart(2,'0')}-${String(tgl).padStart(2,'0')}`;
}
function extractKodeDariNama(namaRaw){
  if (!namaRaw) return null;
  const m = namaRaw.match(/\(([^,)]+),/);
  return m ? m[1].trim() : null;
}

let bulkInaprocRows = [];
document.getElementById('bulkInaprocPreviewBtn').addEventListener('click', async () => {
  const lines = parsePasteLines(document.getElementById('bulkInaprocPaste').value);
  if (lines.length === 0) { showToast('Belum ada data yang di-paste', true); return; }
  const btn = document.getElementById('bulkInaprocPreviewBtn');
  const btnHtmlAsal = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> Memeriksa ${lines.length} baris...`;
  try {

  const parsedRaw = lines.map(l => {
    const [, nama, kategori, nomorPermohonan, tglStr, status, alasan] = l;
    const kode = extractKodeDariNama(nama);
    const tgl = parseTglIndo(tglStr);
    return { nama, kategori, nomorPermohonan, tgl, status, alasan: alasan || null, kode };
  });

  // Dedup by nomor_permohonan: kalau nomor yang sama muncul lebih dari sekali di paste
  // (misal status-nya di-update dari "Ditolak" jadi "Disetujui" untuk nomor yang sama),
  // upsert bakal nimpa baris itu berkali-kali. Tanpa dedup, yang menang adalah baris yang
  // urutannya paling belakang di teks paste — bukan yang tgl_pengajuan-nya paling baru.
  //
  // Prioritas menang: status "Disetujui" duluan, BARU tgl_pengajuan terbesar buat tie-break.
  // Kenapa gak murni tanggal terbaru (logic lama): ada edge case duplikasi pengajuan di mana
  // baris dengan tanggal lebih baru justru berstatus "Ditolak", padahal ada baris lain (tanggal
  // lebih lama) untuk nomor yang sama yang udah "Disetujui". Kalau murni pilih tanggal terbesar,
  // status "Disetujui" itu ketiban jadi "Ditolak" — salah. Jadi begitu ada baris "Disetujui"
  // buat suatu nomor permohonan, dia otomatis menang, gak peduli baris lain tanggalnya lebih baru.
  // Tie-break tanggal (leksikografis ISO string, null dianggap paling lama) cuma dipakai kalau
  // dua-duanya sama-sama "Disetujui", atau dua-duanya sama-sama bukan "Disetujui".
  const byNomor = new Map();
  let dilewatiKarenaDuplikat = 0;
  const parsed = [];
  for (const p of parsedRaw) {
    if (!p.nomorPermohonan) { parsed.push(p); continue; }
    const existing = byNomor.get(p.nomorPermohonan);
    if (!existing) {
      byNomor.set(p.nomorPermohonan, p);
    } else {
      const existingDisetujui = existing.status === 'Disetujui';
      const baruDisetujui = p.status === 'Disetujui';
      let baruMenang;
      if (existingDisetujui !== baruDisetujui) {
        baruMenang = baruDisetujui; // status "Disetujui" otomatis menang, gak peduli tanggal
      } else {
        const tglBaru = p.tgl || '';
        const tglLama = existing.tgl || '';
        baruMenang = tglBaru > tglLama;
      }
      if (baruMenang) byNomor.set(p.nomorPermohonan, p); // yang menang gantiin, yang kalah dibuang
      dilewatiKarenaDuplikat++;
    }
  }
  for (const p of byNomor.values()) parsed.push(p);
  if (dilewatiKarenaDuplikat > 0) {
    showToast(`${dilewatiKarenaDuplikat} baris duplikat (nomor permohonan sama) dilewati — dipilih yang tgl_pengajuan-nya paling baru`, false);
  }

  const kodeList = [...new Set(parsed.map(p => p.kode).filter(Boolean))];
  const CHUNK_SIZE = 150; // batasi tiap query .in() biar URL-nya ga kepanjangan
  let produkRows = [];
  for (let i = 0; i < kodeList.length; i += CHUNK_SIZE) {
    const chunk = kodeList.slice(i, i + CHUNK_SIZE);
    const totalChunks = Math.ceil(kodeList.length / CHUNK_SIZE);
    if (totalChunks > 1) {
      btn.innerHTML = `<span class="spinner"></span> Memeriksa produk (${Math.floor(i / CHUNK_SIZE) + 1}/${totalChunks})...`;
    }
    const { data, error } = await S.sb.from('produk').select('id, kode_produk').in('kode_produk', chunk);
    if (error) { showToast('Gagal cek produk: ' + error.message, true); return; }
    produkRows = produkRows.concat(data || []);
  }
  const byKode = Object.fromEntries(produkRows.map(p => [p.kode_produk, p]));

  bulkInaprocRows = parsed.map(p => {
    const produk = byKode[p.kode];
    let status_ = 'ok', msg = 'Siap diproses';
    if (!p.nomorPermohonan) { status_ = 'err'; msg = 'Nomor permohonan kosong'; }
    else if (!p.kode) { status_ = 'err'; msg = 'Kode produk tidak terbaca dari Nama'; }
    else if (!produk) { status_ = 'err'; msg = 'Kode produk tidak ditemukan di database'; }
    else if (!p.status) { status_ = 'err'; msg = 'Status kosong'; }
    return { ...p, produk, status_, msg };
  });
  renderBulkInaprocPreview();
  } finally {
    btn.disabled = false;
    btn.innerHTML = btnHtmlAsal;
  }
});
function renderBulkInaprocPreview(){
  const wrap = document.getElementById('bulkInaprocPreviewWrap');
  const body = document.getElementById('bulkInaprocPreviewBody');
  const summary = document.getElementById('bulkInaprocSummary');
  const okCount = bulkInaprocRows.filter(r => r.status_ === 'ok').length;
  const errCount = bulkInaprocRows.length - okCount;
  summary.innerHTML = `<span class="ok">${okCount} baris siap diproses</span>${errCount ? `<span class="warn">${errCount} baris bermasalah (tidak ikut diproses)</span>` : ''}`;
  wrap.style.display = 'block';
  body.innerHTML = '';
  bulkInaprocRows.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="kode-cell">${S.escapeHtml(r.nomorPermohonan)}</td>
      <td class="kode-cell">${S.escapeHtml(r.kode || '—')}</td>
      <td>${S.escapeHtml(r.nama || '—')}</td>
      <td>${S.escapeHtml(r.tgl || '—')}</td>
      <td>${S.escapeHtml(r.status || '—')}</td>
      <td><span class="row-status ${r.status_}">${r.status_ === 'ok' ? 'Ketemu produknya' : r.msg}</span></td>
    `;
    body.appendChild(tr);
  });
  document.getElementById('bulkInaprocProsesBtn').style.display = okCount > 0 ? 'inline-flex' : 'none';
}
function isAuthError(error) {
  if (!error) return false;
  const msg = (error.message || '') + ' ' + (error.code || '');
  // sengaja SEMPIT: "403"/"forbidden"/"permission" itu muncul di SEMUA RLS denial,
  // apapun sebabnya — bukan cuma pas token expired. Kalau dipakai buat deteksi,
  // toast "sesi expired" jadi salah nembak tiap kali ada RLS/permission issue biasa.
  // Cuma tandain sebagai auth-error kalau pesannya spesifik nyebut token/JWT/session.
  return /jwt expired|invalid jwt|jwt malformed|invalid.{0,10}token|refresh.{0,10}token|session.{0,10}(expired|invalid|missing)/i.test(msg);
}
document.getElementById('bulkInaprocProsesBtn').addEventListener('click', async () => {
  const rows = bulkInaprocRows.filter(r => r.status_ === 'ok');
  if (rows.length === 0) return;
  const btn = document.getElementById('bulkInaprocProsesBtn');
  const btnLabelAsal = btn.textContent;
  btn.disabled = true;

  // pastikan sesi masih fresh sebelum mulai batch panjang — pakai refreshSession(),
  // bukan getSession(), karena getSession() cuma baca cache lokal dan bisa keliru
  // bilang "masih ada sesi" padahal sesi itu sebenarnya udah mati di server.
  const { data: refreshData, error: refreshError } = await S.sb.auth.refreshSession();
  if (refreshError || !refreshData?.session) {
    showToast('Sesi login kamu udah habis — refresh halaman & login ulang dulu sebelum proses', true);
    btn.disabled = false;
    btn.textContent = btnLabelAsal;
    return;
  }

  // RPC bulk_upsert_inaproc: 1 panggilan per CHUNK baris, bukan 1 panggilan per baris.
  // CHUNK juga jadi unit retry kalau sesi putus di tengah jalan.
  const CHUNK = 300;
  const chunks = chunkArray(rows, CHUNK);

  let sukses = 0, gagal = 0, diprosesRows = 0, berhentiKarenaAuth = false;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    btn.textContent = `Memproses batch ${i + 1}/${chunks.length} (${diprosesRows}/${rows.length} baris)...`;
    const items = chunk.map(r => ({
      nomor_permohonan: r.nomorPermohonan,
      nama_raw: r.nama,
      kode_produk_terbaca: r.kode,
      produk_id: r.produk.id,
      kategori: r.kategori || null,
      tgl_pengajuan: r.tgl,
      status: r.status,
      alasan_ditolak: r.alasan
    }));
    const { data, error } = await S.sb.rpc('bulk_upsert_inaproc', { p_items: items });
    if (error) {
      console.error('BULK INAPROC RPC ERROR (batch ' + (i + 1) + '):', JSON.stringify(error, null, 2));
      if (isAuthError(error)) {
        berhentiKarenaAuth = true;
        break; // chunk ini + sisanya belum sempat dicoba, dihitung dari diprosesRows di bawah
      }
      gagal += chunk.length;
    } else {
      sukses += data?.processed ?? chunk.length;
    }
    diprosesRows += chunk.length;
  }
  btn.disabled = false;
  btn.textContent = btnLabelAsal;

  if (berhentiKarenaAuth) {
    const sisaRows = rows.slice(diprosesRows);
    showToast(`Berhenti di baris ${diprosesRows + 1}/${rows.length} — sesi login expired. Refresh halaman, login ulang, lalu klik Proses lagi buat lanjutin ${sisaRows.length} baris sisanya.`, true);
    // ganti isi bulkInaprocRows dengan sisa baris yang belum ke-proses, biar preview & tombol tetap muncul
    bulkInaprocRows = bulkInaprocRows.filter(r => r.status_ !== 'ok').concat(sisaRows);
    renderBulkInaprocPreview();
    return;
  }

  showToast(`Selesai — ${sukses} pengajuan tersimpan${gagal ? `, ${gagal} baris gagal (lihat console)` : ''}`, gagal > 0);
  document.getElementById('bulkInaprocPaste').value = '';
  document.getElementById('bulkInaprocPreviewWrap').style.display = 'none';
  document.getElementById('bulkInaprocSummary').innerHTML = '';
  btn.style.display = 'none';
  bulkInaprocRows = [];
  S.invalidateProdukStackCache();
  S.loadProduk();
  S.refreshProdukFilterCounts();
});


// ---- BULK VERIFIED PRODUCT (centang biru INAPROC) ----
// TSV dari semua-produk-tayang.js = SNAPSHOT lengkap produk yang lagi tayang. Seluruh
// pencocokan ke tabel produk + penulisan dikerjakan di Postgres (RPC bulk_sync_verified,
// 1 panggilan, bukan N query dari browser). Preview = RPC yang sama dgn p_dry_run=true,
// jadi laporan yang kamu lihat PERSIS sama dengan yang akan ditulis.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function parseVerifiedTsv(raw){
  const lines = parsePasteLines(raw);
  let iId = 0, iName = 1, iSlug = 2;
  if (lines.length && lines[0].some(c => c.toLowerCase() === 'product_id')) {
    const head = lines.shift().map(c => c.toLowerCase());
    iId = head.indexOf('product_id'); iName = head.indexOf('name'); iSlug = head.indexOf('slug');
  }
  return lines
    .map(l => ({ id: (l[iId] || '').trim(), name: (l[iName] || '').trim(), slug: (l[iSlug] || '').trim() }))
    .filter(r => UUID_RE.test(r.id));
}
let bulkVerifiedItems = [];
let bulkVerifiedReport = null;
// Keputusan manual buat baris AMBIGU: index baris ambigu -> { kode, id } produk pilihan user.
// Algoritma RPC cuma bisa bilang "cocok ke beberapa kode"; yang mutusin tetap manusia.
let bulkVerifiedChoices = {};
let bulkVerifiedCand = {}; // kode_produk -> { id, nama_produk } (buat label dropdown + tulis manual)
async function loadVerifiedCandidates(ambiguous){
  const kodes = [...new Set((ambiguous || []).flatMap(x => x.kode || []))];
  bulkVerifiedCand = {};
  if (!kodes.length) return;
  const { data, error } = await S.sb.from('produk').select('id, kode_produk, nama_produk').in('kode_produk', kodes);
  if (error) { showToast('Gagal memuat kandidat ambigu: ' + error.message, true); return; }
  (data || []).forEach(r => { bulkVerifiedCand[r.kode_produk] = { id: r.id, nama_produk: r.nama_produk }; });
}
document.getElementById('bulkVerifiedFile').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  document.getElementById('bulkVerifiedPaste').value = await f.text();
});
function resetBulkVerified(){
  document.getElementById('bulkVerifiedPaste').value = '';
  document.getElementById('bulkVerifiedFile').value = '';
  document.getElementById('bulkVerifiedPreviewWrap').style.display = 'none';
  document.getElementById('bulkVerifiedSummary').innerHTML = '';
  document.getElementById('bulkVerifiedProsesBtn').style.display = 'none';
  bulkVerifiedItems = []; bulkVerifiedReport = null; bulkVerifiedChoices = {}; bulkVerifiedCand = {};
}
function renderBulkVerifiedReport(r){
  const summary = document.getElementById('bulkVerifiedSummary');
  const body = document.getElementById('bulkVerifiedPreviewBody');
  const amb = r.ambiguous || [];
  const dipilih = Object.keys(bulkVerifiedChoices).length;
  const masalah = (r.unmatched || []).length + (amb.length - dipilih);
  summary.innerHTML =
    `<span class="ok">${r.matched}/${r.total} cocok (UUID ${r.by_id} · link ${r.by_link} · nama ${r.by_nama})</span>` +
    `<span class="ok">+${r.gain} dapat badge · ${r.keep} tetap</span>` +
    (r.lose ? `<span class="warn">${r.lose} kehilangan badge</span>` : '') +
    (amb.length ? `<span class="${dipilih === amb.length ? 'ok' : 'warn'}">${dipilih}/${amb.length} ambigu sudah kamu putuskan</span>` : '') +
    (masalah ? `<span class="warn">${masalah} baris bermasalah (tidak ikut)</span>` : '');
  body.innerHTML = '';
  // Ambigu: user yang mutusin. Pilih salah satu kandidat, atau biarkan "Lewati".
  amb.forEach((x, i) => {
    const tr = document.createElement('tr');
    const opts = (x.kode || []).map(k => {
      const c = bulkVerifiedCand[k];
      const label = k + (c && c.nama_produk ? ' — ' + c.nama_produk : '');
      return `<option value="${S.escapeHtml(k)}"${bulkVerifiedChoices[i] && bulkVerifiedChoices[i].kode === k ? ' selected' : ''}>${S.escapeHtml(label)}</option>`;
    }).join('');
    tr.innerHTML = `<td>${S.escapeHtml(x.name || '—')}</td><td class="kode-cell">${S.escapeHtml(x.slug || '—')}</td>` +
      `<td><select class="verified-amb-select" data-i="${i}" style="max-width:100%;font-size:12px;">` +
      `<option value="">Ambigu — lewati (tidak dapat badge)</option>${opts}</select></td>`;
    body.appendChild(tr);
  });
  [
    ...(r.unmatched || []).map(x => ({ ...x, cls: 'err', msg: 'Tidak ketemu di database' })),
    ...(r.via_nama || []).map(x => ({ ...x, slug: '', cls: 'ok', msg: 'Cocok via nama → ' + x.kode + ' (cek sekilas)' })),
  ].forEach(x => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${S.escapeHtml(x.name || '—')}</td><td class="kode-cell">${S.escapeHtml(x.slug || '—')}</td><td><span class="row-status ${x.cls}">${S.escapeHtml(x.msg)}</span></td>`;
    body.appendChild(tr);
  });
  document.getElementById('bulkVerifiedPreviewWrap').style.display = body.children.length ? 'block' : 'none';
  document.getElementById('bulkVerifiedProsesBtn').style.display = (r.matched > 0 || amb.length) ? 'inline-flex' : 'none';
}
// Delegasi: simpan pilihan user per baris ambigu, lalu update ringkasan tanpa render ulang tabel
// (biar dropdown yang lagi dipegang gak reset).
document.getElementById('bulkVerifiedPreviewBody').addEventListener('change', (e) => {
  const sel = e.target.closest('.verified-amb-select');
  if (!sel || !bulkVerifiedReport) return;
  const i = Number(sel.dataset.i);
  const kode = sel.value;
  if (!kode) delete bulkVerifiedChoices[i];
  else if (bulkVerifiedCand[kode]) bulkVerifiedChoices[i] = { kode, id: bulkVerifiedCand[kode].id };
  else { sel.value = ''; showToast('Produk ' + kode + ' tidak ditemukan', true); return; }
  const r = bulkVerifiedReport, amb = r.ambiguous || [];
  const dipilih = Object.keys(bulkVerifiedChoices).length;
  const chip = [...document.querySelectorAll('#bulkVerifiedSummary span')].find(el => /ambigu sudah kamu putuskan/.test(el.textContent));
  if (chip) { chip.textContent = `${dipilih}/${amb.length} ambigu sudah kamu putuskan`; chip.className = dipilih === amb.length ? 'ok' : 'warn'; }
});
document.getElementById('bulkVerifiedPreviewBtn').addEventListener('click', async () => {
  const items = parseVerifiedTsv(document.getElementById('bulkVerifiedPaste').value);
  if (items.length === 0) { showToast('Tidak ada baris valid (kolom product_id harus UUID)', true); return; }
  const btn = document.getElementById('bulkVerifiedPreviewBtn');
  const asal = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> Mencocokkan ${items.length} baris...`;
  try {
    const { data, error } = await S.sb.rpc('bulk_sync_verified', { p_items: items, p_dry_run: true });
    if (error) { showToast('Gagal preview: ' + error.message, true); return; }
    bulkVerifiedItems = items; bulkVerifiedReport = data; bulkVerifiedChoices = {};
    await loadVerifiedCandidates(data.ambiguous);
    renderBulkVerifiedReport(data);
  } finally {
    btn.disabled = false;
    btn.innerHTML = asal;
  }
});
document.getElementById('bulkVerifiedProsesBtn').addEventListener('click', async () => {
  if (!bulkVerifiedItems.length || !bulkVerifiedReport) return;
  const r = bulkVerifiedReport;
  // Pengaman snapshot: paste yang kepotong / salah file bisa nyabut banyak badge sekaligus.
  if (r.lose > 0 || r.matched < r.total * 0.5) {
    const ok = await crudConfirm(
      `+${r.gain} produk dapat badge, ${r.lose} produk KEHILANGAN badge (tidak ada di data ini).\n` +
      (r.matched < r.total * 0.5 ? `Perhatian: baru ${r.matched} dari ${r.total} baris yang cocok.\n` : '') +
      'Lanjut sinkronkan?', { okLabel: 'Ya, Sinkronkan', danger: r.lose > 0 });
    if (!ok) return;
  }
  const btn = document.getElementById('bulkVerifiedProsesBtn');
  const asal = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Menyimpan...';
  try {
    const { data, error } = await S.sb.rpc('bulk_sync_verified', { p_items: bulkVerifiedItems, p_dry_run: false });
    if (error) { showToast('Gagal sinkron: ' + error.message, true); return; }
    // Keputusan manual user buat baris ambigu: tulis sebagai matched_by='manual' (jalur yang sama
    // dgn checkbox manual di modal produk, dilindungi dari sync snapshot berikutnya).
    // Simpan JUGA UUID INAPROC-nya (inaproc_product_id): sync berikutnya cocok di tier 1 (UUID),
    // jadi baris ini gak ambigu lagi dan keputusanmu permanen. UUID dicari dari TSV via slug+nama
    // (RPC gak ngembaliin id di daftar ambigu). Tulis lewat RPC resolve_verified_ambiguous karena
    // tabel produk_verified gak punya policy UPDATE buat upsert langsung dari browser.
    const amb = r.ambiguous || [];
    const picks = Object.entries(bulkVerifiedChoices).map(([i, c]) => {
      const a = amb[Number(i)] || {};
      const slug = (a.slug || '').toLowerCase();
      const src = bulkVerifiedItems.find(it => slug && it.slug.toLowerCase() === slug && it.name === (a.name || it.name))
               || bulkVerifiedItems.find(it => slug && it.slug.toLowerCase() === slug);
      return { produk_id: c.id, inaproc_product_id: src ? src.id : null };
    });
    let manualOk = 0;
    if (picks.length) {
      const { data: mRes, error: mErr } = await S.sb.rpc('resolve_verified_ambiguous', { p_items: picks });
      if (mErr) showToast('Sinkron OK, tapi simpan pilihan ambigu gagal: ' + mErr.message, true);
      else manualOk = mRes && mRes.written != null ? mRes.written : picks.length;
    }
    showToast(`Selesai — ${data.matched} produk verified (+${data.gain}, -${data.lose})` + (manualOk ? ` · ${manualOk} ambigu kamu putuskan` : ''));
    resetBulkVerified();
    S.invalidateProdukStackCache();
    S.loadProduk();
    S.refreshProdukFilterCounts();
  } finally {
    btn.disabled = false;
    btn.innerHTML = asal;
  }
});

  // parseSetKompLine (tab Set Detail, index.js) manggil ini balik lewat S
  // buat parse textarea paste rincian set.
  S.parsePasteLines = parsePasteLines;
}