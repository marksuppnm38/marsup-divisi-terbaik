// Halaman dashboard: mount(container) / unmount().
//
// Data disegarkan otomatis, tanpa tombol "Muat ulang":
//   - tiap 5 menit selama tab terlihat,
//   - saat tab kembali aktif setelah lebih dari 3 menit,
//   - penyegaran berjalan diam-diam: isi lama tetap tampil sampai data baru siap.
// Teks "Diperbarui ..." di topbar hanya menjadi tautan "Coba lagi" bila ada bagian yang gagal.
// Tiap bagian (panel) dimuat sendiri-sendiri; satu RPC gagal tidak menjatuhkan bagian lain.
//
// Sumber data (tanpa RPC baru):
//   Perlu dikerjakan : get_dashboard_summary, get_produk_filter_counts, plus hitungan langsung
//                      dari tabel akd (masa_berlaku) dan sesi_konversi (status, updated_at)
//                      lewat RLS allowed_users.
//   Populasi         : get_populasi_v2 (semua provinsi, kategori SET, terkirim), diringkas di sini.
//   Lainnya          : get_dashboard_*, get_wordtree_*.
//
// Event: satu set listener delegasi di container (data-action / data-nav / data-open-kode),
// tanpa handler inline dan tanpa fungsi di window.*.

import { DASHBOARD_MARKUP } from './markup.js';
import { KONVERSIAN_SUBNAV } from '../konversian/subnav.js';
import { CRUD_PRODUK_SUBNAV } from '../crud-produk/subnav.js';
import { parseLinkV6 } from '../crud-produk/ui-utils.js';
import { fetchHargaLatestMap, selectPricelistRows, writePricelistXlsx } from '../../../shared/exports/pricelist.js';

const VENDOR_CHAIN = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  '/shared/supabase-client.js',
  '/shared/auth-session.js',
];

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Gagal memuat ' + src));
    document.head.appendChild(s);
  });
}

let vendorReady = null;
function ensureVendorScripts() {
  if (window.PNMAuth && window.pnmSupabase) return Promise.resolve();
  if (!vendorReady) {
    vendorReady = VENDOR_CHAIN.reduce((p, src) => p.then(() => loadScript(src)), Promise.resolve());
  }
  return vendorReady;
}

// shared-google-fonts: id+href SAMA PERSIS kayak yang dipakai konversian/index.js,
// jadi halaman yang aktif bareng share satu <link>.
// pnm-universal.css: dimuat di mount() tapi TIDAK dilepas di unmount() (permanent
// <link>, lihat komentar di unmount()).
// shared-phosphor-icons DIHAPUS (icon-library convergence pass, sesi ini):
// semua glyph dashboard (ph-*) di-remap ke Tabler yang ekuivalen, jadi
// konsisten sama konversian/stok/crud-produk/nav yang sudah lama pindah --
// dashboard adalah holdout terakhir. Satu webfont doang yang kepakai
// sekarang di seluruh app.
const SHARED_LINKS = [
  { id: 'shared-google-fonts', href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400&display=swap' },
  { id: 'shared-tabler-icons', href: 'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.31.0/dist/tabler-icons.min.css' },
  { id: 'shared-pnm-universal-css', href: '/pnm-universal.css?v=20260813b' },
];

function loadLink(id, href) {
  if (document.getElementById(id)) return Promise.resolve();
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = () => resolve();
    link.onerror = () => resolve();
    document.head.appendChild(link);
  });
}

// Stylesheet halaman ini (style.css di folder ini) di-load di mount() dan dilepas di
// unmount(), pola sama kayak konversian/crud-produk/kompres-pdf/export-gambar.
// .pw-topbar/.pw-content yang dipakai markup.js udah otomatis kesedia dari
// app/pages/nav/nav.css (dimuat router.js lewat navMount() SEBELUM mount() halaman
// manapun dipanggil -- lihat router.js's render()), gak perlu di-load ulang di sini.
function ensureStyle() {
  return Promise.all([
    ...SHARED_LINKS.map(({ id, href }) => loadLink(id, href)),
    loadLink('page-dashboard-style', new URL('./style.css', import.meta.url).href),
  ]);
}

let mountedContainer = null;
let dashKeydownHandler = null;
let dashContainerHandlers = null;   // listener delegasi di container, dilepas di unmount()
let visibilityHandler = null;
const timers = { fresh: null, poll: null };

const SUPABASE_URL = 'https://ptkkbsemihcyndisjoor.supabase.co';
const RPC_TIMEOUT_MS = 25000;
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB0a2tic2VtaWhjeW5kaXNqb29yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0Njc4MzgsImV4cCI6MjA5ODA0MzgzOH0.QsCqmcqQcXvz1f8bLkagvMbAGUBbBP-3Wa5Aore5OMo';

// Stale-while-revalidate untuk RPC baca. Module-scope supaya selamat dari unmount/mount: kembali
// ke dashboard menampilkan hasil terakhir seketika, lalu yang tadi disajikan dari cache disegarkan
// di belakang dan dashboard dimuat ulang sekali bila ada yang berubah.
const rpcMemo = new Map();   // fn|JSON(params) -> data
let dashMountSeq = 0;        // penanda mount aktif (unmount menaikkannya -> pekerjaan lama berhenti)
let bulkLoading = false;     // true hanya selama loadAll() berjalan
let staleServed = [];        // { fn, params, key, data } yang disajikan dari cache pada pemuatan ini

export async function mount(container) {
  mountedContainer = container;
  const myMount = ++dashMountSeq;
  await Promise.all([ensureStyle(), ensureVendorScripts()]);
  container.innerHTML = DASHBOARD_MARKUP;

let detailOverlay = document.getElementById('detail-modal-overlay');
let activeDetailKode = null;
let detailReqId = 0;            // token: respons detail yang telat gak boleh nimpa yang lebih baru
let lastFocusBeforeModal = null;

// FIX: dulu function ini dideklarasikan DI DALAM blok `if(detailOverlay){...}`.
// Di ES module (strict mode) function-in-block itu block-scoped, jadi handler
// Esc di bawah kena "closeDetailModal is not defined". Sekarang di scope mount().
function closeDetailModal(){
  detailOverlay.classList.remove('show');
  document.querySelectorAll('#tbl-body tr').forEach(tr => tr.classList.remove('row-active'));
  activeDetailKode = null;
  detailReqId++;
  if (lastFocusBeforeModal && document.contains(lastFocusBeforeModal)) lastFocusBeforeModal.focus();
  lastFocusBeforeModal = null;
}
if(detailOverlay){
  document.getElementById('dm-close').addEventListener('click', closeDetailModal);
  detailOverlay.addEventListener('click', e => { if(e.target===detailOverlay) closeDetailModal(); });
}
async function openDetail(kode){
  const myReq = ++detailReqId;
  activeDetailKode = kode;
  if (!detailOverlay.classList.contains('show')) lastFocusBeforeModal = document.activeElement;
  document.querySelectorAll('#tbl-body tr').forEach(tr => tr.classList.toggle('row-active', tr.dataset.kode === kode));
  document.getElementById('dm-title').textContent = '—';
  document.getElementById('dm-kode').textContent = kode;
  document.getElementById('dm-body').innerHTML = '<div class="detail-loading"><i class="ti ti-loader-2 spinner"></i> Memuat detail…</div>';
  detailOverlay.classList.add('show');
  document.getElementById('dm-close').focus();
  try {
    const d = await rpc('get_produk_detail', {p_kode: kode});
    if (myReq !== detailReqId) return; // user sudah buka produk lain / nutup modal
    if(!d){ document.getElementById('dm-body').innerHTML = '<div class="detail-loading">Produk tidak ditemukan.</div>'; return; }
    document.getElementById('dm-title').textContent = d.nama_produk || '—';
    document.getElementById('dm-kode').textContent = d.kode_produk;

    // SECURITY FIX: bucket 'thumbnails' sekarang PRIVATE (dulu URL public
    // deterministik THUMB_BASE + kode_asli + '.png', bisa diakses siapa aja
    // tanpa login). Sekarang minta signed URL (sementara, lihat
    // window.PNM_getSignedUrl di shared/supabase-client.js) -- perlu await,
    // jadi blok ini dipindah ke dalam try/catch openDetail() yang sudah async.
    const mediaThumb = d.media ? d.media.find(m=>m.is_primary && m.url) || d.media.find(m=>m.url) : null;
    let thumbUrl = mediaThumb?.url || null;
    if (!thumbUrl && d.kode_asli) {
      try {
        thumbUrl = await window.PNM_getSignedUrl('thumbnails', d.kode_asli + '.png');
      } catch (e) {
        thumbUrl = null; // kode_asli belum ada gambarnya -- sama seperti dulu 404 pada URL public
      }
      if (myReq !== detailReqId) return; // user sudah pindah produk lain selama nunggu signed URL
    }
    if (thumbUrl && !isSafeHttpUrl(thumbUrl)) thumbUrl = null;

    const hargaMap = {};
    (d.harga||[]).forEach(h=>{ if(!hargaMap[h.jenis]) hargaMap[h.jenis]=h; });
    const hargaHtml = `<div class="harga-grid">
      ${['EKATALOG','UPLOAD','SWASTA'].map(j=>`
        <div class="harga-box">
          <div class="harga-box-label">${j==='EKATALOG'?'e-Katalog':j==='UPLOAD'?'Upload':j}</div>
          <div class="harga-box-val">${hargaMap[j] ? rupiah(hargaMap[j].harga) : '—'}</div>
          <div class="harga-box-tahun">${hargaMap[j] ? esc(hargaMap[j].tahun) : ''}</div>
        </div>`).join('')}
    </div>`;
    const tipeCls = String(d.tipe||'').toLowerCase().replace(/[^a-z]/g,'');
    const kodeSafe = d.kode_produk || kode;
    // Aksi lanjutan: modal ini bukan jalan buntu. <a> asli (bukan onclick) -> bisa dibuka di tab baru.
    const actionsHtml = `<div class="detail-actions">
      <a class="btn btn-accent" href="/crud-produk?edit=${encodeURIComponent(kodeSafe)}"><i class="ti ti-pencil"></i> Edit di CRUD Produk</a>
      ${String(d.tipe||'').toUpperCase()==='SET' ? `<a class="btn btn-ghost" href="/crud-produk/set" data-nav="/crud-produk/set"><i class="ti ti-stack-2"></i> Set Management</a>` : ''}
      <button type="button" class="btn btn-ghost" data-action="copy-kode" data-kode="${esc(kodeSafe)}"><i class="ti ti-copy"></i> Salin kode</button>
    </div>`;

    document.getElementById('dm-body').innerHTML = `
      <canvas id="dm-thumb-canvas" class="detail-thumb" style="${thumbUrl?'':'display:none'}"></canvas>
      ${!thumbUrl ? `<div class="detail-thumb-placeholder"><i class="ti ti-photo"></i> Tidak ada gambar</div>` : ''}
      ${hargaHtml}
      <div>
        ${row('Tipe', `<span class="badge badge-${tipeCls}">${esc(d.tipe) || '—'}</span>`)}
        ${row('No. AKD', esc(d.no_akd) || '—')}
        ${row('Kode KFA', d.kode_kfa ? `<span style="font-family:var(--mono)">${esc(d.kode_kfa)}</span>` : '—')}
        ${row('Spesifikasi', esc(d.spesifikasi) || '—')}
        ${row('Link v6', (d.link_v6 && isSafeHttpUrl(d.link_v6)) ? `<a href="${escapeHtmlAttr(d.link_v6)}" target="_blank" rel="noopener noreferrer">Lihat di e-Katalog <i class="ti ti-external-link"></i></a>` : '—')}
      </div>
      ${actionsHtml}
    `;
    if (thumbUrl) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (myReq !== detailReqId) return;
        const canvas = document.getElementById('dm-thumb-canvas');
        if (!canvas) return;

        // Upscale minimal 2x kalau gambar aslinya kecil, biar gak pecah waktu di-stretch CSS
        const scale = Math.max(1, Math.min(3, Math.ceil(300 / Math.max(img.width, img.height))));
        const w = img.width * scale, h = img.height * scale;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, w, h);

        try {
          const data = ctx.getImageData(0, 0, w, h);
          const px = data.data;

          function edgeSample(x,y){ const i=(y*w+x)*4; return [px[i],px[i+1],px[i+2]]; }
          const samples = [];
          for (let x=0; x<w; x+=Math.max(1,Math.floor(w/20))){ samples.push(edgeSample(x,0)); samples.push(edgeSample(x,h-1)); }
          for (let y=0; y<h; y+=Math.max(1,Math.floor(h/20))){ samples.push(edgeSample(0,y)); samples.push(edgeSample(w-1,y)); }
          const bgR = Math.round(samples.reduce((s,c)=>s+c[0],0)/samples.length);
          const bgG = Math.round(samples.reduce((s,c)=>s+c[1],0)/samples.length);
          const bgB = Math.round(samples.reduce((s,c)=>s+c[2],0)/samples.length);

          const threshold = 60;
          for (let i = 0; i < px.length; i += 4) {
            const dr = px[i]-bgR, dg = px[i+1]-bgG, db = px[i+2]-bgB;
            const dist = Math.sqrt(dr*dr+dg*dg+db*db);
            if (dist < threshold) {
              const alpha = dist / threshold;
              px[i+3] = Math.round(alpha * px[i+3]);
            }
          }
          ctx.putImageData(data, 0, 0);
        } catch(bgErr) {
          console.warn('Background removal skipped (CORS):', bgErr.message);
        }
      };
      img.onerror = () => {
        const canvas = document.getElementById('dm-thumb-canvas');
        if (canvas) canvas.style.display = 'none';
      };
      img.src = thumbUrl;
    }
  } catch(e){
    if (myReq !== detailReqId) return;
    if (String(e.message).startsWith('unauthorized')) return;
    document.getElementById('dm-body').innerHTML = `<div class="detail-loading" style="color:var(--danger)">Gagal memuat: ${esc(e.message)}</div>`;
  }
}
function showToast(msg, type='success'){
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  const ic = document.createElement('i');
  ic.className = `ti ti-${type==='success'?'check-circle':'warning-circle'}`;
  t.appendChild(ic);
  t.appendChild(document.createTextNode(' ' + msg));
  c.appendChild(t);
  setTimeout(() => {
    t.classList.add('fade-out');
    setTimeout(() => t.remove(), 250);
  }, 2200);
}
function copyKode(e, kode){
  e.stopPropagation();
  navigator.clipboard.writeText(kode).then(() => showToast(`Kode "${kode}" disalin`))
    .catch(() => showToast('Gagal menyalin', 'error'));
}
function row(k,v){ return `<div class="detail-row"><span class="detail-key">${k}</span><span class="detail-val">${v}</span></div>`; }


  // ══ RPC ══
// Semua RPC call di dashboard ini butuh role 'authenticated' (bukan
// cuma anon key) supaya RLS produk/produk_harga konsisten dengan
// tools lain. Kalau token expired di tengah jalan, lempar ke gate lagi.
async function rpcNet(fn, params){
  // SPA migration: accessToken (variable lokal yang di-set manual saat login/
  // refresh) diganti PNMAuth.getAccessToken() dipanggil FRESH tiap request --
  // sama fix persis kayak getFreshToken() di konversian/index.js (bug asalnya:
  // variable lokal bisa basi kalau tab dibackground lama, browser throttle
  // timer refresh SDK-nya, RPC lanjut jalan pakai token expired sampai user
  // ngerjain sesuatu yang minta re-check). getAccessToken() baca session SDK
  // yang aktif, bukan snapshot yang mungkin udah gak valid.
  const accessToken = await window.PNMAuth.getAccessToken();
  if (!accessToken) {
    // Sesi kesembilan belas: dulu manggil showGate() (fungsi lokal modul
    // ini, sudah dihapus bareng auth-gate). Sekarang cukup logout() --
    // itu men-triggerkan window.PNMAuth.onAuthStateChange(null) yang
    // didengarkan shared/auth-gate.js, yang otomatis nampilin gate lagi
    // DAN (lewat router.js's onLoggedOut) unmount modul ini + bersihin
    // container, jadi gak ada UI dashboard basi ketinggalan di belakang gate.
    window.PNMAuth.logout();
    throw new Error('unauthorized: no access token');
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), RPC_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': ANON_KEY,
        'Authorization': 'Bearer ' + accessToken
      },
      body: JSON.stringify(params || {}),
      signal: ctrl.signal
    });
  } catch (err) {
    throw new Error(err.name === 'AbortError' ? `RPC ${fn} timeout (>${RPC_TIMEOUT_MS/1000}s)` : err.message);
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401) {
    window.PNMAuth.logout();
    throw new Error('unauthorized');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error((data && (data.message || data.error_description)) || `RPC ${fn} gagal (HTTP ${res.status})`);
    err.status = res.status;
    err.code = data && data.code;   // mis. PGRST202 = function tidak ada di schema cache
    throw err;
  }
  return data;
}

async function rpc(fn, params){
  if (!bulkLoading || !/^get_(dashboard_|wordtree_|populasi_v2$)/.test(fn)) return rpcNet(fn, params);
  const key = fn + '|' + JSON.stringify(params || {});
  if (rpcMemo.has(key)) {
    const data = rpcMemo.get(key);
    staleServed.push({ fn, params, key, data });
    return data;
  }
  const data = await rpcNet(fn, params);
  rpcMemo.set(key, data);
  return data;
}


  // ══════════════════════════════════════════
  // UTIL
  // ══════════════════════════════════════════
  const $ = (id) => document.getElementById(id);
  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const fmt = (n) => Number(n || 0).toLocaleString('id-ID');
  const fmt1 = (n) => Number(n || 0).toLocaleString('id-ID', { maximumFractionDigits: 1 });
  const pct = (a, b) => (b ? Math.round(a / b * 100) : 0);
  // 0 itu angka valid ("Rp 0"), bukan "tidak ada data".
  const rupiah = (n) => ((n === null || n === undefined || n === '') ? '—' : 'Rp ' + Number(n).toLocaleString('id-ID'));
  function compact(n) {
    n = Number(n || 0);
    const a = Math.abs(n);
    if (a >= 1e9) return fmt1(n / 1e9) + ' M';
    if (a >= 1e6) return fmt1(n / 1e6) + ' jt';
    if (a >= 1e3) return fmt1(n / 1e3) + ' rb';
    return fmt(n);
  }
  const rupiahShort = (n) => 'Rp ' + compact(n);
  function esc(s) { return escapeHtmlAttr(s); }
  // Tanggal LOKAL (WIB): toISOString() itu UTC, jadi jam 00:00-06:59 WIB dianggap "kemarin".
  function localISODate(d = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  const DAY_NAMES = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
  const busyHtml = () => '<div class="db-busy">Memuat…</div>';
  const emptyHtml = (msg) => `<div class="db-empty">${esc(msg)}</div>`;
  const errorHtml = (id, msg) => `<div class="db-empty db-error" title="${esc(msg)}">Bagian ini belum bisa dimuat. <button type="button" class="db-textbtn" data-action="retry" data-panel="${esc(id)}">Coba lagi</button></div>`;
  function setPressed(btn) {
    btn.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
  }

  // ══════════════════════════════════════════
  // PERLU DIKERJAKAN
  // Urutan tetap dari yang paling mendesak (bukan dari angka terbesar: satuannya berbeda-beda).
  // Yang sudah 0 tidak dibuat baris sendiri, cukup disebut di baris "Sudah beres".
  // Tiap sumber berdiri sendiri; satu gagal hanya menghilangkan barisnya.
  // ══════════════════════════════════════════
  async function loadWorklist(el) {
    const sb = window.pnmSupabase;
    const hariIni = localISODate();
    const batas30 = localISODate(new Date(Date.now() + 30 * 86400000));
    const idleCut = new Date(Date.now() - 2 * 86400000).toISOString(); // sama dengan MANDEK_MIN konversian (2 hari)
    const hitung = async (q) => { const { count, error } = await q; if (error) throw new Error(error.message); return count || 0; };
    const sumber = await Promise.allSettled([
      rpc('get_dashboard_summary', {}),
      rpc('get_produk_filter_counts', {}),
      hitung(sb.from('akd').select('id', { count: 'exact', head: true }).lt('masa_berlaku', hariIni)),
      hitung(sb.from('akd').select('id', { count: 'exact', head: true }).gte('masa_berlaku', hariIni).lte('masa_berlaku', batas30)),
      hitung(sb.from('sesi_konversi').select('id', { count: 'exact', head: true }).eq('status', 'berjalan').lt('updated_at', idleCut)),
    ]);
    sumber.forEach((r) => { if (r.status === 'rejected' && String(r.reason && r.reason.message).startsWith('unauthorized')) throw r.reason; });
    const [rSum, rCnt, rExp, rSoon, rSesi] = sumber;
    const ok = (r) => r.status === 'fulfilled';
    const items = [];
    if (ok(rExp)) items.push({ n: rExp.value, urgent: true, label: 'AKD sudah kadaluarsa', detail: 'Masa berlakunya sudah lewat', act: 'Buka AKD', nav: '/crud-produk/akd' });
    if (ok(rSesi)) items.push({ n: rSesi.value, urgent: true, label: 'Sesi konversi mandek', detail: 'Tidak ada aktivitas selama 2 hari atau lebih', act: 'Buka sesi', nav: '/konversian/sesi' });
    if (ok(rSoon)) items.push({ n: rSoon.value, label: 'AKD kadaluarsa dalam 30 hari', detail: 'Siapkan perpanjangan sebelum masa berlakunya lewat', act: 'Buka AKD', nav: '/crud-produk/akd' });
    if (ok(rCnt)) {
      items.push({ n: Number(rCnt.value.disetujui_tanpa_link) || 0, label: 'Disetujui INAPROC, belum ada Link V6', detail: 'Belum masuk pricelist sampai Link V6 terisi', act: 'Isi Link V6', nav: '/crud-produk/produk' });
      items.push({ n: Number(rCnt.value.belum_diajukan) || 0, label: 'Produk belum diajukan ke INAPROC', detail: 'Belum punya AKD', act: 'Buka produk', nav: '/crud-produk/produk' });
    }
    if (ok(rSum)) {
      const s = rSum.value || {};
      const total = Number(s.total) || 0, n = total - (Number(s.punya_harga) || 0);
      const sisa = (a, b) => fmt((Number(s[a]) || 0) - (Number(s[b]) || 0));
      items.push({ n, label: 'Produk tanpa harga e-Katalog',
        detail: `${pct(total - n, total)}% produk sudah punya harga. Belum ada: Instrumen ${sisa('instrument', 'instrument_punya_harga')}, Set ${sisa('set', 'set_punya_harga')}, Unit ${sisa('unit', 'unit_punya_harga')}.`,
        act: 'Buka produk', nav: '/crud-produk/produk' });
    }
    const gagal = sumber.filter((r) => !ok(r));
    gagal.forEach((r) => console.warn('worklist: sumber gagal:', r.reason && r.reason.message));
    if (!items.length) throw new Error('Semua sumber daftar kerja gagal dimuat');

    const todo = items.filter((i) => i.n > 0), done = items.filter((i) => !(i.n > 0));
    const count = $('wl-count');
    if (count) count.textContent = todo.length ? `${fmt(todo.length)} hal perlu tindakan` : '';
    const wlRow = (it) => `<a class="wl-row" href="${it.nav}" data-nav="${it.nav}">
      <div class="wl-n${it.urgent ? ' is-urgent' : ''}">${fmt(it.n)}</div>
      <div><div class="wl-label">${esc(it.label)}</div><div class="wl-detail">${esc(it.detail)}</div></div>
      <span class="wl-act">${esc(it.act)}</span></a>`;
    el.innerHTML =
      (todo.length ? todo.map(wlRow).join('') : '<div class="wl-allclear">Tidak ada yang perlu dikerjakan sekarang.</div>')
      + (done.length ? `<div class="wl-foot">${todo.length ? 'Sudah beres' : 'Yang dicek'}: ${done.map((i) => esc(i.label)).join(', ')}.</div>` : '')
      + (gagal.length ? `<div class="wl-foot">${fmt(gagal.length)} sumber data belum bisa dimuat, jadi sebagian baris tidak tampil. <button type="button" class="db-textbtn" data-action="retry" data-panel="worklist">Coba lagi</button></div>` : '');
  }

  // ══════════════════════════════════════════
  // KONVERSI HARI INI
  // "Selesai" di-dedup per sesi di server (revisi terakhir saja).
  // ══════════════════════════════════════════
  async function loadToday(el) {
    const k = await rpc('get_dashboard_konversi_today', {}) || {};
    el.innerHTML = `
      <div class="hi-figs">
        <div><div class="hi-n">${fmt(k.selesai_count)}</div><div class="hi-l">order selesai</div></div>
        <div><div class="hi-n" title="${esc(rupiah(k.selesai_value))}">${rupiahShort(k.selesai_value)}</div><div class="hi-l">total nilai</div></div>
      </div>
      <dl class="hi-list">
        <div class="hi-li"><dt>Rata-rata per order</dt><dd>${Number(k.selesai_count) ? rupiah(k.selesai_avg) : '—'}</dd></div>
        <div class="hi-li"><dt><a href="/konversian/sesi" data-nav="/konversian/sesi">Sesi sedang berjalan</a></dt>
          <dd>${fmt(k.berjalan_count)}${Number(k.berjalan_baru_count) ? `<small>${fmt(k.berjalan_baru_count)} dibuka hari ini</small>` : ''}</dd></div>
      </dl>`;
  }

  // ══════════════════════════════════════════
  // TUJUH HARI TERAKHIR (satu grafik, ukuran bisa diganti Order/Nilai)
  // ══════════════════════════════════════════
  let trendData = null;
  let trendMetric = 'jumlah';
  async function loadTrend(el) {
    trendData = await rpc('get_dashboard_trend_7hari', {}) || [];
    renderTrend(el);
  }
  function renderTrend(el) {
    const data = trendData || [];
    if (!data.length) { el.innerHTML = emptyHtml('Belum ada konversi dalam 7 hari terakhir.'); return; }
    const byNilai = trendMetric === 'nilai';
    const val = (d) => Number(byNilai ? d.total_value : d.jumlah) || 0;
    const max = Math.max(...data.map(val), 1);
    const totJ = data.reduce((s, d) => s + (Number(d.jumlah) || 0), 0);
    const totV = data.reduce((s, d) => s + (Number(d.total_value) || 0), 0);
    const today = localISODate();
    const cols = data.map((d) => {
      const dt = new Date(d.tanggal + 'T00:00:00');
      const v = val(d);
      return `<li class="tr-col${d.tanggal === today ? ' is-today' : ''}">
        <a class="tr-link" href="/konversian/riwayat" data-nav="/konversian/riwayat" title="${esc(`${DAY_NAMES[dt.getDay()]}, ${d.tanggal}: ${fmt(d.jumlah)} order, ${rupiah(d.total_value)}`)}">
          <span class="tr-val">${byNilai ? compact(v) : fmt(v)}</span>
          <span class="tr-track"><span class="tr-bar" style="height:${Math.round(v / max * 100)}%"></span></span>
          <span class="tr-day">${DAY_NAMES[dt.getDay()]} ${dt.getDate()}</span>
        </a></li>`;
    }).join('');
    el.innerHTML = `
      <dl class="tr-totals">
        <div><dt>order</dt><dd>${fmt(totJ)}</dd></div>
        <div><dt>total nilai</dt><dd title="${esc(rupiah(totV))}">${rupiahShort(totV)}</dd></div>
      </dl>
      <ol class="tr-cols" aria-label="${byNilai ? 'Nilai konversi' : 'Jumlah konversi'} per hari, 7 hari terakhir">${cols}</ol>`;
  }

  // ══════════════════════════════════════════
  // LEADERBOARD SALES + KATEGORI
  // lbDays juga dibawa ke tab Riwayat saat baris diklik (lihat RIWAYAT_PENDING_FILTER_KEY).
  // ══════════════════════════════════════════
  let lbDays = 30;
  // Key sessionStorage ini HARUS sama persis dengan yang dibaca applyPendingRiwayatFilter()
  // di app/pages/konversian/index.js.
  const RIWAYAT_PENDING_FILTER_KEY = 'pnm_riwayat_pending_filter';
  const daysToRiwayatPeriodKey = (d) => (d === 7 ? '7hari' : d === 30 ? '30hari' : d === 90 ? '90hari' : 'semua');
  async function loadLeaderboard(el) {
    const data = await rpc('get_dashboard_leaderboard_sales', { p_days: lbDays });
    if (!data || !data.length) { el.innerHTML = emptyHtml('Belum ada data sales untuk periode ini.'); return; }
    el.innerHTML = `<ol class="rk">${data.slice(0, 8).map((r, i) => `
      <li><button type="button" class="rk-row" data-action="goto-riwayat-sales" data-sales="${esc(r.nama)}" title="Lihat konversi ${esc(r.nama)}">
        <span class="rk-pos">${i + 1}</span>
        <span class="rk-name">${esc(r.nama)}<span class="rk-sub">${fmt(r.jumlah_order)} order</span></span>
        <span class="rk-val" title="${esc(rupiah(r.total_value))}">${rupiahShort(r.total_value)}</span>
      </button></li>`).join('')}</ol>`;
  }
  async function loadKategori(el) {
    const data = await rpc('get_dashboard_kategori_distribusi', { p_days: 30 });
    if (!data || !data.length) { el.innerHTML = emptyHtml('Belum ada data kategori.'); return; }
    const total = data.reduce((s, d) => s + (Number(d.jumlah) || 0), 0) || 1;
    el.innerHTML = `<ol class="rk rk--plain">${data.map((d) => `
      <li><a class="rk-row" href="/konversian/riwayat" data-nav="/konversian/riwayat">
        <span class="rk-name">${esc(d.kategori)}</span>
        <span class="rk-val">${fmt(d.jumlah)}<small>${Math.round((Number(d.jumlah) || 0) / total * 100)}%</small></span>
      </a></li>`).join('')}</ol>`;
  }

  // ══════════════════════════════════════════
  // STOK BERISIKO HABIS
  // ══════════════════════════════════════════
  const FC_INITIAL = 6;
  let fcDays = 30, fcData = [], fcAll = false;
  async function loadStok(el) {
    fcData = await rpc('get_dashboard_forecast_stok', { p_days: fcDays, p_limit: 15 }) || [];
    renderStok(el);
  }
  function renderStok(el) {
    if (!el) return;
    if (!fcData.length) { el.innerHTML = emptyHtml(`Tidak ada produk yang diperkirakan habis berdasarkan konversi ${fcDays} hari terakhir.`); return; }
    const rows = fcAll ? fcData : fcData.slice(0, FC_INITIAL);
    const habis = (v) => {
      const d = (v === null || v === undefined || !Number.isFinite(Number(v))) ? null : Number(v);
      if (d === null) return '<span class="fc-d is-aman">—</span>';
      const c = d <= 7 ? 'is-kritis' : d <= 30 ? 'is-waspada' : 'is-aman';
      return `<span class="fc-d ${c}">${fmt(d)} hari</span>${d <= 7 ? '<span class="fc-flag">Segera</span>' : ''}`;
    };
    el.innerHTML = `
      <div class="tb-wrap"><table class="tb">
        <thead><tr><th>Produk</th><th class="num">Stok</th><th class="num">Terpakai ${fcDays} hari</th><th class="num">Rata-rata per hari</th><th class="num">Perkiraan habis</th></tr></thead>
        <tbody>${rows.map((d) => `
          <tr data-open-kode="${esc(d.kode_produk)}" tabindex="0" title="Lihat detail produk">
            <td><span class="tb-name">${esc(d.nama_produk)}</span><span class="tb-kode">${esc(d.kode_produk)}</span></td>
            <td class="num">${fmt(d.stok_sekarang)}</td>
            <td class="num">${fmt(d.terpakai_periode)}</td>
            <td class="num">${fmt1(d.rata_harian)}</td>
            <td class="num">${habis(d.perkiraan_habis_hari)}</td>
          </tr>`).join('')}</tbody>
      </table></div>
      <div class="tb-foot">
        <span>Merah: habis dalam 7 hari atau kurang. Oranye: sampai 30 hari.</span>
        ${fcData.length > FC_INITIAL ? `<button type="button" class="db-textbtn" data-action="forecast-more">${fcAll ? 'Ringkas' : `Tampilkan ${fcData.length - FC_INITIAL} lainnya`}</button>` : ''}
      </div>`;
  }

  // ══════════════════════════════════════════
  // POPULASI SET: satu panggilan get_populasi_v2 (semua provinsi), diringkas per provinsi di sini.
  // Parameter dan nama kolom disalin dari populasi/index.js. Provinsi bawaan = Jawa Tengah.
  // ══════════════════════════════════════════
  let popData = null, popSel = '';
  async function loadPopulasi(el) {
    const res = await rpc('get_populasi_v2', {
      p_provinsi: null, p_status: 'DELIVERED', p_cakupan: 'POPULASI', p_dari: null, p_sampai: null,
      p_kelompok: ['SET'], p_produk: null, p_rs: null, p_isi_set: false,
    });
    const rows = ((res && res.rows) || [])
      .map((r) => ({ nama: r.customer, prov: r.provinsi || '', set: Number(r.set_terkirim) || 0 }))
      .filter((r) => r.set > 0);
    if (!rows.length) { popData = null; el.innerHTML = emptyHtml('Belum ada set terkirim.'); return; }
    const by = new Map();
    let unmapped = 0;
    rows.forEach((r) => {
      if (!r.prov) { unmapped++; return; }
      const p = by.get(r.prov) || { prov: r.prov, set: 0, rs: [] };
      p.set += r.set; p.rs.push(r); by.set(r.prov, p);
    });
    const provs = [...by.values()].sort((a, b) => b.set - a.set);
    provs.forEach((p) => p.rs.sort((a, b) => b.set - a.set));
    popData = { provs, unmapped, totalSet: rows.reduce((s, r) => s + r.set, 0), totalRs: rows.length };
    if (!provs.length) { el.innerHTML = emptyHtml('Wilayah rumah sakit belum terpetakan. Atur di halaman Populasi.'); return; }
    if (!by.has(popSel)) popSel = by.has('Jawa Tengah') ? 'Jawa Tengah' : provs[0].prov;
    renderPopulasi(el);
  }
  function renderPopulasi(el) {
    if (!el || !popData) return;
    const { provs, unmapped, totalSet, totalRs } = popData;
    let shown = provs.slice(0, 6);
    const cur = provs.find((p) => p.prov === popSel);
    if (cur && !shown.includes(cur)) shown.push(cur);
    const rs = cur ? cur.rs.slice(0, 5) : [];
    el.innerHTML = `
      <p class="pop-lead"><strong>${fmt(totalSet)}</strong> set terkirim ke <strong>${fmt(totalRs)}</strong> rumah sakit di <strong>${fmt(provs.length)}</strong> provinsi.</p>
      <div class="pop-cols">
        <div>
          <h3 class="db-sub">Wilayah teratas</h3>
          <ul class="pv">${shown.map((p) => `
            <li><button type="button" class="pv-btn" data-action="pop-prov" data-prov="${esc(p.prov)}" aria-pressed="${p.prov === popSel}">
              <span class="pv-name">${esc(p.prov)}</span><span class="pv-rs">${fmt(p.rs.length)} RS</span><span class="pv-n">${fmt(p.set)}</span>
            </button></li>`).join('')}</ul>
        </div>
        <div>
          <h3 class="db-sub">Rumah sakit terbanyak di ${esc(popSel)}</h3>
          <ol class="rs-list">${rs.map((r) => `<li class="rs-li"><span title="${esc(r.nama)}">${esc(r.nama)}</span><span>${fmt(r.set)} set</span></li>`).join('')}</ol>
        </div>
      </div>
      ${unmapped ? `<p class="pop-note">${fmt(unmapped)} rumah sakit belum punya provinsi, jadi belum masuk hitungan wilayah.</p>` : ''}`;
  }

  // ══════════════════════════════════════════
  // KEBUTUHAN CUSTOMER -> SKU
  // Sumber: permintaan_item_produk (terisi otomatis saat Kebutuhan RS ditandai "Bisa Dipenuhi").
  // Kiri: istilah yang dipakai customer. Kanan: SKU yang dipakai untuk memenuhinya.
  // ══════════════════════════════════════════
  const WT_KEY = 'pnm_wordtree_last_istilah';
  let wtRoots = [], wtRootsJson = '', wtSel = '', wtReq = 0;
  async function loadKebutuhan(el) {
    let roots = [];
    try { roots = await rpc('get_wordtree_roots', { p_limit: 40 }) || []; } catch (e) {
      if (String(e.message).startsWith('unauthorized')) throw e;
    }
    if (!roots.length) {
      wtRoots = []; wtRootsJson = '';
      el.innerHTML = emptyHtml('Belum ada kebutuhan yang tersambung ke SKU. Bagian ini terisi otomatis begitu Kebutuhan RS ditandai “Bisa Dipenuhi”.');
      return;
    }
    let saved = null;
    try { saved = localStorage.getItem(WT_KEY); } catch (e) { /* private mode: abaikan */ }
    const has = (v) => roots.some((r) => r.istilah_customer === v);
    wtSel = has(wtSel) ? wtSel : (has(saved) ? saved : roots[0].istilah_customer);
    const json = JSON.stringify(roots);
    if (json !== wtRootsJson || !$('wt-list')) {   // daftar sama -> jangan bangun ulang (posisi scroll tetap)
      wtRoots = roots; wtRootsJson = json;
      el.innerHTML = `<div class="wt">
        <div class="wt-list" id="wt-list">${roots.map((r) => `
          <button type="button" class="wt-item" data-action="wt-pick" data-istilah="${esc(r.istilah_customer)}" aria-pressed="${r.istilah_customer === wtSel}" title="${fmt(r.jumlah_sku_unik)} SKU berbeda">
            <span>${esc(r.istilah_customer)}</span><span>${fmt(r.frekuensi)}×</span></button>`).join('')}</div>
        <div id="wt-detail">${busyHtml()}</div></div>`;
    } else {
      markWt();
    }
    await loadWtBranches(wtSel);
  }
  function markWt() {
    document.querySelectorAll('#wt-list .wt-item').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.istilah === wtSel)));
  }
  async function pickIstilah(istilah) {
    wtSel = istilah;
    try { localStorage.setItem(WT_KEY, istilah); } catch (e) { /* abaikan */ }
    markWt();
    await loadWtBranches(istilah);
  }
  async function loadWtBranches(istilah) {
    const box = $('wt-detail');
    if (!box) return;
    const my = ++wtReq;
    box.setAttribute('aria-busy', 'true');
    try {
      const branches = await rpc('get_wordtree_branches', { p_istilah: istilah }) || [];
      if (my !== wtReq) return;
      box.innerHTML = branches.length ? `
        <h3 class="db-sub">Untuk “${esc(istilah)}”, SKU yang dipakai</h3>
        <ul class="sku">${branches.map((b) => `
          <li><button type="button" class="sku-btn" data-open-kode="${esc(b.kode_produk)}" title="Lihat detail produk">
            <span class="sku-name"><span class="sku-kode">${esc(b.kode_produk)}</span>${esc(b.nama_produk || '')}</span>
            <span class="sku-n">${fmt(b.frekuensi)}×</span>
            <span class="sku-p">${b.persentase != null ? esc(fmt1(b.persentase)) + '%' : ''}</span>
          </button></li>`).join('')}</ul>`
        : emptyHtml('Belum ada SKU tersambung untuk istilah ini.');
    } catch (e) {
      if (my !== wtReq || String(e.message).startsWith('unauthorized')) return;
      box.innerHTML = '<div class="db-empty db-error">SKU untuk istilah ini belum bisa dimuat.</div>';
    } finally {
      if (my === wtReq) box.removeAttribute('aria-busy');
    }
  }

  // ══════════════════════════════════════════
  // PANEL: tiap bagian dimuat dan gagal sendiri-sendiri
  // ══════════════════════════════════════════
  const PANELS = {
    worklist:    { el: 'db-worklist',    load: loadWorklist },
    today:       { el: 'db-today',       load: loadToday },
    trend:       { el: 'db-trend',       load: loadTrend },
    leaderboard: { el: 'db-leaderboard', load: loadLeaderboard },
    stok:        { el: 'db-stok',        load: loadStok },
    populasi:    { el: 'db-populasi',    load: loadPopulasi },
    kategori:    { el: 'db-kategori',    load: loadKategori },
    kebutuhan:   { el: 'db-kebutuhan',   load: loadKebutuhan },
  };
  const rendered = new Set();   // panel yang pernah berhasil tampil
  const failed = new Set();     // panel yang terakhir gagal
  let loadingAll = false;
  let lastOkAt = 0;

  async function runPanel(id, silent) {
    const p = hasOwn(PANELS, id) ? PANELS[id] : null;
    const el = p && $(p.el);
    if (!el) return true;
    if (!rendered.has(id)) el.innerHTML = busyHtml();
    else if (!silent) el.setAttribute('aria-busy', 'true');   // isi lama tetap terlihat, hanya diredupkan
    try {
      await p.load(el);
      rendered.add(id); failed.delete(id);
      return true;
    } catch (e) {
      const msg = String((e && e.message) || e);
      if (msg.startsWith('unauthorized')) return true;
      console.error('Dashboard: bagian "' + id + '" gagal:', msg);
      failed.add(id);
      if (!silent || !rendered.has(id)) { el.innerHTML = errorHtml(id, msg); rendered.delete(id); }
      return false;
    } finally {
      el.removeAttribute('aria-busy');
    }
  }

  async function loadAll({ silent = false, revalidate = true, ids = null } = {}) {
    if (loadingAll) return;
    loadingAll = true; bulkLoading = true; staleServed = [];
    let results;
    try { results = await Promise.all((ids || Object.keys(PANELS)).map((id) => runPanel(id, silent))); }
    finally { bulkLoading = false; loadingAll = false; }
    const served = staleServed;
    staleServed = [];
    if (results.some(Boolean)) lastOkAt = Date.now();
    renderFresh();
    if (revalidate && served.length && myMount === dashMountSeq) revalidateStale(served);
  }

  // Yang tadi disajikan dari cache disegarkan di belakang; kalau ada yang berubah, muat ulang sekali.
  async function revalidateStale(list) {
    let changed = false;
    await Promise.all(list.map(async (it) => {
      try {
        const fresh = await rpcNet(it.fn, it.params);
        rpcMemo.set(it.key, fresh);
        if (JSON.stringify(fresh) !== JSON.stringify(it.data)) changed = true;
      } catch (e) { /* gagal menyegarkan -> biarkan yang tampil */ }
    }));
    if (changed && myMount === dashMountSeq) await loadAll({ silent: true, revalidate: false });
  }

  // ── Penyegaran otomatis ──
  const POLL_MS = 5 * 60 * 1000;
  const STALE_MS = 3 * 60 * 1000;
  function refreshQuietly() {
    if (document.hidden || myMount !== dashMountSeq) return;
    rpcMemo.clear();
    loadAll({ silent: true, revalidate: false });
  }
  function renderFresh() {
    const el = $('db-fresh');
    if (!el) return;
    if (failed.size) { el.innerHTML = 'Sebagian data belum termuat. <button type="button" class="db-textbtn" data-action="refresh">Coba lagi</button>'; return; }
    if (!lastOkAt) { el.textContent = 'Memuat…'; return; }
    const m = Math.floor((Date.now() - lastOkAt) / 60000);
    el.textContent = m < 1 ? 'Diperbarui baru saja'
      : m < 60 ? `Diperbarui ${m} menit lalu`
      : 'Diperbarui ' + new Date(lastOkAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  }

  // ══════════════════════════════════════════
  // PRICELIST (logika di shared/exports/pricelist.js, dipakai juga crud-produk)
  // ══════════════════════════════════════════
const XLSX_SRC = 'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js';
async function unduhPricelist(btn){
  if (btn.disabled) return;
  const tipe = document.getElementById('pricelist-tipe')?.value || '';
  const html0 = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader-2 spinner"></i> Menyiapkan…';
  try {
    if (!window.XLSX) await loadScript(XLSX_SRC);
    const sb = window.pnmSupabase;
    const { data, error } = await sb.rpc('get_produk_list', {
      p_status_filter: 'all', p_tipe: tipe ? [tipe] : null, p_golongan: null, p_is_active: null,
      p_status_inaproc: null, p_harga: null, p_link_v6: null, p_page: 1, p_page_size: null,
    });
    if (error) throw new Error(error.message);
    const rows = data?.rows || [];
    const hargaMap = await fetchHargaLatestMap(sb, rows.map(r => r.id));
    const { priced, skippedNoLink, skippedNoHarga } =
      selectPricelistRows(rows, hargaMap, r => parseLinkV6(r.link_v6).state === 'bersih');
    if (!priced.length) { showToast('Belum ada produk yang punya Link V6 dan harga e-Katalog untuk pilihan ini.', 'error'); return; }
    const label = { INSTRUMENT: 'Instrumen', SET: 'Set', UNIT: 'Unit' }[tipe];
    writePricelistXlsx(window.XLSX, priced, hargaMap, {
      subtitle: label ? `Tipe: ${label}` : 'Semua produk',
      fileTag: tipe ? `_${tipe.toLowerCase()}` : '_semua',
    });
    const skip = skippedNoLink + skippedNoHarga;
    showToast(`Pricelist terunduh: ${fmt(priced.length)} produk` + (skip ? ` · ${fmt(skip)} dilewati (belum siap jual)` : ''));
  } catch (e) {
    showToast('Gagal membuat pricelist: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = html0;
  }
}


function escapeXml(s){
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escapeHtmlAttr(s){
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
// Security: link_v6 datang dari database (diisi manual), bukan sesuatu yang
// aman buat langsung ditaruh di href tanpa cek -- cuma izinkan http(s).
function isSafeHttpUrl(u){
  return /^https?:\/\//i.test(String(u == null ? '' : u).trim());
}


  // ══════════════════════════════════════════
  // NAVIGASI + EVENT DELEGASI
  // ══════════════════════════════════════════
  // Tujuan yang tidak dikenal router = 404 + auto-logout (lihat router.js), jadi divalidasi dulu
  // terhadap registry sub-route yang sama dengan yang dipakai nav/router.
  const NAV_SUBS = {
    'stok': [],
    'populasi': [],
    'crud-produk': CRUD_PRODUK_SUBNAV.map((s) => s.id),
    'konversian': KONVERSIAN_SUBNAV.map((s) => s.id),
  };
  function isValidNavPath(p) {
    const m = /^\/([a-z-]+)(?:\/([a-z-]+))?$/.exec(String(p || ''));
    if (!m || !hasOwn(NAV_SUBS, m[1])) return false;
    return !m[2] || NAV_SUBS[m[1]].includes(m[2]);
  }
  function goTo(path) {
    if (!isValidNavPath(path)) { console.warn('Tujuan navigasi tidak valid:', path); showToast('Tujuan navigasi tidak valid', 'error'); return; }
    window.dispatchEvent(new CustomEvent('pnm:navigate', { detail: { path } }));
  }

  const ACTIONS = {
    'goto-riwayat-sales': (el) => {
      try {
        sessionStorage.setItem(RIWAYAT_PENDING_FILTER_KEY, JSON.stringify({ sales: el.dataset.sales || '', period: daysToRiwayatPeriodKey(lbDays) }));
      } catch (e) { /* abaikan: tab Riwayat dibuka tanpa filter */ }
      goTo('/konversian/riwayat');
    },
    'trend-metric':    (el) => { trendMetric = el.dataset.m === 'nilai' ? 'nilai' : 'jumlah'; setPressed(el); renderTrend($('db-trend')); },
    'lb-period':       (el) => { lbDays = +el.dataset.days || 30; setPressed(el); runPanel('leaderboard', false); },
    'forecast-period': (el) => { fcDays = +el.dataset.days || 30; fcAll = false; setPressed(el); runPanel('stok', false); },
    'forecast-more':   () => { fcAll = !fcAll; renderStok($('db-stok')); },
    'pop-prov':        (el) => { popSel = el.dataset.prov || popSel; renderPopulasi($('db-populasi')); },
    'wt-pick':         (el) => pickIstilah(el.dataset.istilah),
    'retry':           (el) => runPanel(el.dataset.panel, false).then(renderFresh),
    'refresh':         () => loadAll({ ids: [...failed], revalidate: false }),
    'pricelist-unduh': (el) => unduhPricelist(el),
    'copy-kode':       (el, e) => copyKode(e, el.dataset.kode),
  };
  function onContainerClick(e) {
    const el = e.target.closest('[data-action],[data-nav],[data-open-kode]');
    if (!el || !container.contains(el)) return;
    if (el.dataset.nav) {
      // <a href> asli: biarkan browser kalau ctrl/cmd/shift-klik (buka tab baru)
      if (el.tagName === 'A' && (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) return;
      e.preventDefault();
      goTo(el.dataset.nav);
      return;
    }
    if (el.dataset.action) {
      if (hasOwn(ACTIONS, el.dataset.action)) ACTIONS[el.dataset.action](el, e);
      return;
    }
    if (el.dataset.openKode) {
      const inner = e.target.closest('a,button');
      if (inner && inner !== el && el.contains(inner)) return;   // link/tombol di dalam baris punya aksinya sendiri
      openDetail(el.dataset.openKode);
    }
  }
  function onContainerKeydown(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const t = e.target;
    if (t.matches('input, select, textarea, button, a')) return;   // kontrol native menangani sendiri
    if (t.matches('tr[data-open-kode]')) {
      e.preventDefault();
      t.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }
  }
  dashContainerHandlers = { click: onContainerClick, keydown: onContainerKeydown };
  Object.entries(dashContainerHandlers).forEach(([type, fn]) => container.addEventListener(type, fn));
  dashKeydownHandler = (e) => {
    if (e.key === 'Escape' && detailOverlay && detailOverlay.classList.contains('show')) closeDetailModal();
  };
  document.addEventListener('keydown', dashKeydownHandler);

  // ── Mulai ──
  const dateEl = $('db-date');
  if (dateEl) dateEl.textContent = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  renderFresh();
  timers.fresh = setInterval(renderFresh, 30000);
  timers.poll = setInterval(refreshQuietly, POLL_MS);
  visibilityHandler = () => { if (!document.hidden && lastOkAt && Date.now() - lastOkAt > STALE_MS) refreshQuietly(); };
  document.addEventListener('visibilitychange', visibilityHandler);
  loadAll();
}

export function unmount() {
  dashMountSeq++;
  if (dashKeydownHandler) document.removeEventListener('keydown', dashKeydownHandler);
  if (visibilityHandler) document.removeEventListener('visibilitychange', visibilityHandler);
  clearInterval(timers.fresh);
  clearInterval(timers.poll);
  dashKeydownHandler = null;
  visibilityHandler = null;

  // shared-pnm-universal-css TIDAK dilepas di sini (link permanen; melepasnya tiap pindah modul
  // menyebabkan kilatan tanpa-gaya).
  document.getElementById('page-dashboard-style')?.remove();

  if (dashContainerHandlers && mountedContainer) {
    Object.entries(dashContainerHandlers).forEach(([type, fn]) => mountedContainer.removeEventListener(type, fn));
  }
  dashContainerHandlers = null;
  mountedContainer = null;
}