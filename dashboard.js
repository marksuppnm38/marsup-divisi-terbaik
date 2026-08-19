// Inisialisasi tema (dark/light) sebelum render — mencegah flash of unstyled theme
(function(){
  const saved = localStorage.getItem('theme');
  const theme = saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  if (theme === 'dark') document.body.setAttribute('data-theme', 'dark');
})();

const SUPABASE_URL = 'https://ptkkbsemihcyndisjoor.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB0a2tic2VtaWhjeW5kaXNqb29yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0Njc4MzgsImV4cCI6MjA5ODA0MzgzOH0.QsCqmcqQcXvz1f8bLkagvMbAGUBbBP-3Wa5Aore5OMo';

// ══════════════════════════════════════════
// SESI LOGIN PERSISTENT — sama persis dengan Conversion Workspace,
// jadi login sekali dan tersimpan di seluruh tools PNM-BARE.
// ══════════════════════════════════════════
const AUTH_STORAGE_KEY = 'pnm_auth_session';
let accessToken = null;

const authGate = document.getElementById('auth-gate');
const appRoot = document.getElementById('app-root');
const gateEmail = document.getElementById('gate-email');
const gatePassword = document.getElementById('gate-password');
const gateLoginBtn = document.getElementById('gate-login-btn');
const gateStatus = document.getElementById('gate-status');

function saveAuthSession(data) {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600)
  }));
}
function clearAuthSession() { localStorage.removeItem(AUTH_STORAGE_KEY); }
function readAuthSession() {
  try { return JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || 'null'); } catch { return null; }
}
function showApp() {
  authGate.style.display = 'none';
  appRoot.style.display = 'block';
  loadEverything();
}
function showGate(msg) {
  accessToken = null;
  appRoot.style.display = 'none';
  authGate.style.display = 'flex';
  if (msg) { gateStatus.style.color = 'var(--danger)'; gateStatus.textContent = msg; }
}
async function refreshAuthSession(refreshToken) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY },
    body: JSON.stringify({ refresh_token: refreshToken })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.msg || 'Sesi habis, silakan masuk lagi.');
  return data;
}

// DETAIL MODAL
let detailOverlay;
document.addEventListener('DOMContentLoaded', () => {
  detailOverlay = document.getElementById('detail-modal-overlay');
  if(detailOverlay){
    function closeDetailModal(){
      detailOverlay.classList.remove('show');
      document.querySelectorAll('#tbl-body tr').forEach(tr => tr.classList.remove('row-active'));
      activeDetailKode = null;
    }
    document.getElementById('dm-close').addEventListener('click', closeDetailModal);
    detailOverlay.addEventListener('click', e => { if(e.target===detailOverlay) closeDetailModal(); });
  }
});

let activeDetailKode = null;
async function openDetail(kode){
  activeDetailKode = kode;
  document.querySelectorAll('#tbl-body tr').forEach(tr => tr.classList.remove('row-active'));
  const targetRow = document.querySelector(`#tbl-body tr[data-kode="${kode}"]`);
  if (targetRow) targetRow.classList.add('row-active');
  document.getElementById('dm-title').textContent = '—';
  document.getElementById('dm-kode').textContent = kode;
  document.getElementById('dm-body').innerHTML = '<div class="detail-loading"><i class="ph ph-circle-notch spinner"></i> Memuat detail…</div>';
  detailOverlay.classList.add('show');
  try {
    const d = await rpc('get_produk_detail', {p_kode: kode});
    console.log('DATA:', d);
    if(!d){ document.getElementById('dm-body').innerHTML = '<div class="detail-loading">Produk tidak ditemukan.</div>'; return; }
    document.getElementById('dm-title').textContent = d.nama_produk || '—';
    document.getElementById('dm-kode').textContent = d.kode_produk;

    const THUMB_BASE = 'https://ptkkbsemihcyndisjoor.supabase.co/storage/v1/object/public/thumbnails/';
    const mediaThumb = d.media ? d.media.find(m=>m.is_primary && m.url) || d.media.find(m=>m.url) : null;
    const thumbUrl = mediaThumb?.url || (d.kode_asli ? THUMB_BASE + d.kode_asli + '.png' : null);
    console.log('THUMB URL:', thumbUrl);
    const thumbHtml = thumbUrl
  ? `<canvas id="dm-thumb-canvas" class="detail-thumb"></canvas>`
  : `<div class="detail-thumb-placeholder"><i class="ph ph-image"></i> Tidak ada gambar</div>`;

    const hargaMap = {};
    (d.harga||[]).forEach(h=>{ if(!hargaMap[h.jenis]) hargaMap[h.jenis]=h; });
    const hargaHtml = `<div class="harga-grid">
      ${['EKATALOG','UPLOAD','SWASTA'].map(j=>`
        <div class="harga-box">
          <div class="harga-box-label">${j==='EKATALOG'?'e-Katalog':j==='UPLOAD'?'Upload':j}</div>
          <div class="harga-box-val">${hargaMap[j] ? rupiah(hargaMap[j].harga) : '—'}</div>
          <div class="harga-box-tahun">${hargaMap[j] ? hargaMap[j].tahun : ''}</div>
        </div>`).join('')}
    </div>`;

    document.getElementById('dm-body').innerHTML = `
      ${thumbHtml}
      ${hargaHtml}
      <div>
        ${row('Tipe', `<span class="badge badge-${(d.tipe||'').toLowerCase()}">${d.tipe||'—'}</span>`)}
        ${row('No. AKD', d.no_akd || '—')}
        ${row('Kode KFA', d.kode_kfa ? `<span style="font-family:var(--mono)">${d.kode_kfa}</span>` : '—')}
        ${row('Spesifikasi', d.spesifikasi || '—')}
        ${row('Link v6', d.link_v6 ? `<a href="${d.link_v6}" target="_blank">Lihat di e-Katalog <i class="ph ph-arrow-square-out"></i></a>` : '—')}
      </div>
    `;

    document.getElementById('dm-body').innerHTML = `
      <canvas id="dm-thumb-canvas" class="detail-thumb" style="${thumbUrl?'':'display:none'}"></canvas>
      ${!thumbUrl ? `<div class="detail-thumb-placeholder"><i class="ph ph-image"></i> Tidak ada gambar</div>` : ''}
      ${hargaHtml}
      <div>
        ${row('Tipe', `<span class="badge badge-${(d.tipe||'').toLowerCase()}">${d.tipe||'—'}</span>`)}
        ${row('No. AKD', d.no_akd || '—')}
        ${row('Kode KFA', d.kode_kfa ? `<span style="font-family:var(--mono)">${d.kode_kfa}</span>` : '—')}
        ${row('Spesifikasi', d.spesifikasi || '—')}
        ${row('Link v6', d.link_v6 ? `<a href="${d.link_v6}" target="_blank">Lihat di e-Katalog <i class="ph ph-arrow-square-out"></i></a>` : '—')}
      </div>
    `;
    if (thumbUrl) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
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
    document.getElementById('dm-body').innerHTML = `<div class="detail-loading" style="color:var(--danger)">Gagal memuat: ${e.message}</div>`;
  }
}
function showToast(msg, type='success'){
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<i class="ph ph-${type==='success'?'check-circle':'warning-circle'}"></i> ${msg}`;
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
async function initAuth() {
  const saved = readAuthSession();
  if (!saved) { showGate(); return; }
  if (saved.expires_at && saved.expires_at - Math.floor(Date.now() / 1000) > 60) {
    accessToken = saved.access_token;
    showApp();
    return;
  }
  try {
    const data = await refreshAuthSession(saved.refresh_token);
    accessToken = data.access_token;
    saveAuthSession(data);
    showApp();
  } catch (err) {
    clearAuthSession();
    showGate('Sesi kamu sudah habis, silakan masuk lagi.');
  }
}
gateLoginBtn.addEventListener('click', async () => {
  const email = gateEmail.value.trim().toLowerCase();
  const password = gatePassword.value;
  if (!email || !password) {
    gateStatus.style.color = 'var(--danger)';
    gateStatus.textContent = 'Isi email dan password dulu.';
    return;
  }
  gateLoginBtn.disabled = true;
  gateLoginBtn.textContent = 'Memproses…';
  gateStatus.style.color = 'var(--text-muted)';
  gateStatus.textContent = '';
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error_description || data.msg || 'Login gagal');
    accessToken = data.access_token;
    saveAuthSession(data);
    gatePassword.value = '';
    showApp();
  } catch (err) {
    gateStatus.style.color = 'var(--danger)';
    gateStatus.textContent = 'Gagal masuk: ' + err.message;
  } finally {
    gateLoginBtn.disabled = false;
    gateLoginBtn.textContent = 'Masuk';
  }
});
gatePassword.addEventListener('keydown', (e) => { if (e.key === 'Enter') gateLoginBtn.click(); });

// THEME
const themeBtn = document.getElementById('theme-toggle');
const themeIcon = document.getElementById('theme-icon');
function syncIcon(){ themeIcon.className = document.body.getAttribute('data-theme')==='dark' ? 'ph ph-sun' : 'ph ph-moon'; }
syncIcon();
themeBtn.addEventListener('click', () => {
  const dark = document.body.getAttribute('data-theme') === 'dark';
  dark ? document.body.removeAttribute('data-theme') : document.body.setAttribute('data-theme','dark');
  localStorage.setItem('theme', dark ? 'light' : 'dark');
  syncIcon();
});
document.getElementById('reload-btn').addEventListener('click', loadEverything);

function fmt(n){ return Number(n||0).toLocaleString('id-ID'); }
function pct(a,b){ return b ? Math.round(a/b*100) : 0; }
function pctClass(p){ return p>=80?'pct-good':p>=50?'pct-warn':'pct-bad'; }
function rupiah(n){ return n ? 'Rp ' + Number(n).toLocaleString('id-ID') : '—'; }

function showError(msg){
  const b = document.getElementById('err-banner');
  document.getElementById('err-text').textContent = msg;
  b.classList.add('show');
}
function clearError(){ document.getElementById('err-banner').classList.remove('show'); }

// Semua RPC call di dashboard ini butuh role 'authenticated' (bukan
// cuma anon key) supaya RLS produk/produk_harga konsisten dengan
// tools lain. Kalau token expired di tengah jalan, lempar ke gate lagi.
async function rpc(fn, params){
  // SECURITY FIX: dulu fallback ke ANON_KEY kalau accessToken belum/nggak ke-set
  // (race condition saat load, atau token expired) — artinya RPC ini bisa diam-diam
  // jalan sebagai anon. Sekarang wajib ada token sesi user yang login; kalau nggak,
  // lempar ke gate daripada nembak pakai anon key.
  if (!accessToken) {
    showGate('Sesi kamu sudah habis, silakan masuk lagi.');
    throw new Error('unauthorized: no access token');
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': ANON_KEY,
      'Authorization': 'Bearer ' + accessToken
    },
    body: JSON.stringify(params || {})
  });
  if (res.status === 401) {
    showGate('Sesi kamu sudah habis, silakan masuk lagi.');
    throw new Error('unauthorized');
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.error_description || `RPC ${fn} gagal`);
  return data;
}

// ══════════════════════════════════════════
// KONVERSI HARI INI — snapshot operasional cepat: berapa sesi lagi jalan
// SEKARANG (bukan cuma yang dibuka hari ini, karena sesi bisa nginep
// berhari-hari), dan berapa yang beres hari ini + total valuenya.
// "Beres" di-dedup per sesi (ambil revisi terakhir aja) biar sesi yang
// direvisi 2x hari ini gak ke-count 2 kali.
// ══════════════════════════════════════════
async function loadKonversiToday(){
  const k = await rpc('get_dashboard_konversi_today', {});
  document.getElementById('stats-grid-konversi').innerHTML = `
    <div class="stat-card blue">
      <div class="stat-icon blue"><i class="ph ph-hourglass-medium"></i></div>
      <div class="stat-val">${fmt(k.berjalan_count)}</div>
      <div class="stat-label">Konversi Sedang Berjalan</div>
      <div class="stat-sub"><i class="ph ph-plus-circle"></i> ${fmt(k.berjalan_baru_count)} sesi baru dibuka hari ini</div>
    </div>
    <div class="stat-card green">
      <div class="stat-icon green"><i class="ph ph-check-circle"></i></div>
      <div class="stat-val">${fmt(k.selesai_count)}</div>
      <div class="stat-label">Konversi Selesai Hari Ini</div>
      <div class="stat-sub"><i class="ph ph-money"></i> Total ${rupiah(k.selesai_value)}</div>
    </div>
    <div class="stat-card purple">
      <div class="stat-icon purple"><i class="ph ph-chart-line-up"></i></div>
      <div class="stat-val">${rupiah(k.selesai_avg)}</div>
      <div class="stat-label">Rata-rata Value / Order</div>
      <div class="stat-sub"><i class="ph ph-info"></i> Dari ${fmt(k.selesai_count)} order hari ini</div>
    </div>
  `;
}

// ══════════════════════════════════════════
// RINGKASAN — satu panggilan RPC (get_dashboard_summary), dihitung
// penuh di Postgres. Gantinya fetch produk + produk_harga mentah
// dengan limit=20000 yang kemarin bikin angka undercount.
// ══════════════════════════════════════════
async function loadStats(){
  const s = await rpc('get_dashboard_summary', {});
  const total = s.total || 0;
  document.querySelector('[data-f="all"]').innerHTML = `<i class="ph ph-squares-four"></i> Semua <span class="filter-count">(${fmt(total)})</span>`;
  document.querySelector('[data-f="noharga"]').innerHTML = `<i class="ph ph-currency-circle-dollar"></i> Tanpa Harga <span class="filter-count">(${fmt(total - s.punya_harga)})</span>`;
  document.querySelector('[data-f="nolink"]').innerHTML = `<i class="ph ph-link-break"></i> Tanpa Link <span class="filter-count">(${fmt(total - s.punya_link)})</span>`;
  document.querySelector('[data-f="noakd"]').innerHTML = `<i class="ph ph-shield-slash"></i> Tanpa AKD <span class="filter-count">(${fmt(total - s.punya_akd)})</span>`;

  document.getElementById('last-update-text').textContent = 'Live — ' + new Date().toLocaleTimeString('id-ID');

  document.getElementById('stats-grid').innerHTML = `
    <div class="stat-card blue">
      <div class="stat-icon blue"><i class="ph ph-database"></i></div>
      <div class="stat-val">${fmt(total)}</div>
      <div class="stat-label">Total Produk</div>
      <div class="stat-sub"><i class="ph ph-check-circle" style="color:var(--success)"></i> Semua aktif di database</div>
    </div>
    <div class="stat-card green">
      <div class="stat-icon green"><i class="ph ph-money"></i></div>
      <div class="stat-val">${fmt(s.punya_harga)}</div>
      <div class="stat-label">Punya Harga e-Katalog</div>
      <div class="stat-sub"><span class="stat-pct ${pctClass(pct(s.punya_harga,total))}">${pct(s.punya_harga,total)}%</span> dari total produk</div>
    </div>
    <div class="stat-card warning">
      <div class="stat-icon warning"><i class="ph ph-currency-circle-dollar"></i></div>
      <div class="stat-val">${fmt(total - s.punya_harga)}</div>
      <div class="stat-label">Belum Ada Harga</div>
      <div class="stat-sub"><span class="stat-pct pct-bad">${pct(total - s.punya_harga, total)}%</span> perlu dilengkapi</div>
    </div>
    <div class="stat-card blue">
      <div class="stat-icon blue"><i class="ph ph-link"></i></div>
      <div class="stat-val">${fmt(s.punya_link)}</div>
      <div class="stat-label">Ada di e-Katalog v6</div>
      <div class="stat-sub"><span class="stat-pct ${pctClass(pct(s.punya_link,total))}">${pct(s.punya_link,total)}%</span> dari total produk</div>
    </div>
    <div class="stat-card purple">
      <div class="stat-icon purple"><i class="ph ph-seal-check"></i></div>
      <div class="stat-val">${fmt(s.punya_akd)}</div>
      <div class="stat-label">Punya Nomor AKD</div>
      <div class="stat-sub"><span class="stat-pct ${pctClass(pct(s.punya_akd,total))}">${pct(s.punya_akd,total)}%</span> dari total produk</div>
    </div>
    <div class="stat-card danger">
      <div class="stat-icon danger"><i class="ph ph-link-break"></i></div>
      <div class="stat-val">${fmt(total - s.punya_link)}</div>
      <div class="stat-label">Belum di e-Katalog</div>
      <div class="stat-sub"><span class="stat-pct pct-bad">${pct(total - s.punya_link, total)}%</span> belum terdaftar</div>
    </div>
  `;

  document.getElementById('prog-harga').innerHTML =
    progItem('Instrumen', s.instrument_punya_harga, s.instrument, 'var(--accent)') +
    progItem('Set', s.set_punya_harga, s.set, 'var(--success)') +
    progItem('Unit', s.unit_punya_harga, s.unit, 'var(--purple)');

  document.getElementById('prog-link').innerHTML =
    progItem('Punya Link v6', s.punya_link, total, 'var(--accent)') +
    progItem('Belum Ada Link', total - s.punya_link, total, 'var(--danger)');

  document.getElementById('prog-akd').innerHTML =
    progItem('Punya AKD', s.punya_akd, total, 'var(--warning)') +
    progItem('Tanpa AKD', total - s.punya_akd, total, 'var(--danger)');
}

function progItem(name, val, total, color){
  const p = pct(val, total);
  return `<div class="prog-item">
    <div class="prog-meta">
      <span class="prog-name">${name}</span>
      <span class="prog-num">${fmt(val)} / ${fmt(total)}</span>
    </div>
    <div class="prog-track"><div class="prog-fill" style="width:${p}%;background:${color}"></div></div>
    <div class="prog-pct">${p}%</div>
  </div>`;
}

// ══════════════════════════════════════════
// TABEL — filter, search, tipe, dan pagination SEMUA dilakukan di
// server lewat RPC get_dashboard_produk. Browser cuma pernah pegang
// satu halaman (25 baris), bukan seluruh tabel produk.
// ══════════════════════════════════════════
const PAGE_SIZE = 25;
let currentFilter = 'all';
let currentTipe = '';
let currentSearch = '';
let currentPage = 1;
let searchDebounce = null;
let pageCache = {};

function cacheKey(page){
  return `${Array.from(activeFilters).sort().join(',')}|${currentTipe}|${currentSearch}|${page}`;
}
function clearPageCache(){ pageCache = {}; }

async function fetchPage(page){
  const key = cacheKey(page);
  if (pageCache[key]) return pageCache[key];
  const result = await rpc('get_dashboard_produk', {
  p_filters: Array.from(activeFilters),
  p_tipe: currentTipe || null,
  p_search: currentSearch || null,
  p_page: page,
  p_page_size: PAGE_SIZE
  });
  pageCache[key] = result;
  return result;
}

function prefetchNextPage(total){
  const pages = Math.ceil(total / PAGE_SIZE);
  if (currentPage < pages) {
    const nextKey = cacheKey(currentPage + 1);
    if (!pageCache[nextKey]) {
      rpc('get_dashboard_produk', {
        p_filter: currentFilter,
        p_tipe: currentTipe || null,
        p_search: currentSearch || null,
        p_page: currentPage + 1,
        p_page_size: PAGE_SIZE
      }).then(r => { pageCache[nextKey] = r; }).catch(() => {});
    }
  }
}

async function loadTable(){
  const key = cacheKey(currentPage);
  if (!pageCache[key]) {
    document.getElementById('tbl-body').innerHTML = '<tr class="loading-row"><td colspan="7"><i class="ph ph-circle-notch spinner"></i> Memuat data…</td></tr>';
  }
  const result = await fetchPage(currentPage);
  renderTable(result.total || 0, result.rows || []);
  prefetchNextPage(result.total || 0);
}

async function fetchPage(page){
  const key = cacheKey(page);
  if (pageCache[key]) return pageCache[key];
  const result = await rpc('get_dashboard_produk', {
    p_filters: Array.from(activeFilters),
    p_tipe: currentTipe || null,
    p_search: currentSearch || null,
    p_page: page,
    p_page_size: PAGE_SIZE
  });
  pageCache[key] = result;
  return result;
}

let activeFilters = new Set(['all']);

function setFilter(f, el){
  if (f === 'all') {
    activeFilters = new Set(['all']);
  } else {
    activeFilters.delete('all');
    if (activeFilters.has(f)) activeFilters.delete(f);
    else activeFilters.add(f);
    if (activeFilters.size === 0) activeFilters.add('all');
  }
  currentPage = 1;
  clearPageCache();
  document.querySelectorAll('.filter-btn').forEach(b => {
    b.classList.toggle('active', activeFilters.has(b.dataset.f));
  });
  loadTable().catch(handleLoadError);
}
function setTipe(v){ currentTipe = v; currentPage = 1; clearPageCache(); loadTable().catch(handleLoadError); }
let searchToken = 0;
function onSearch(){
  clearTimeout(searchDebounce);
  const spinner = document.getElementById('search-spinner');
  spinner.classList.add('show');
  const myToken = ++searchToken;
  searchDebounce = setTimeout(async () => {
    currentSearch = document.getElementById('tbl-search').value.trim();
    currentPage = 1;
    clearPageCache();
    try {
      await loadTable();
      if (currentSearch) addSearchHistory(currentSearch);
    } catch(err) {
      handleLoadError(err);
    } finally {
      if (myToken === searchToken) spinner.classList.remove('show');
    }
  }, 300);
}

function renderTable(total, rows){
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  currentPage = Math.min(currentPage, pages);

  document.getElementById('tbl-info').textContent =
    total === 0 ? '—' : `Menampilkan ${fmt((currentPage-1)*PAGE_SIZE+1)}–${fmt(Math.min(currentPage*PAGE_SIZE, total))} dari ${fmt(total)} produk`;

  const tipeClass = {INSTRUMENT:'badge-instrument', SET:'badge-set', UNIT:'badge-unit'};

  if (!rows.length){
    document.getElementById('tbl-body').innerHTML = '<tr style="cursor:pointer" onclick="openDetail(${r.kode_produk})"><td colspan="6"><i class="ph ph-magnifying-glass" style="font-size:28px;display:block;margin-bottom:6px"></i>Tidak ada produk yang cocok.</td></tr>';
  } else {
    document.getElementById('tbl-body').innerHTML = rows.map(r => `
  <tr style="cursor:pointer" data-kode="${r.kode_produk}" onclick="openDetail('${r.kode_produk}')">
    <td class="checkbox-col" onclick="event.stopPropagation()">
      <input type="checkbox" class="row-checkbox" data-kode="${r.kode_produk}" data-row='${JSON.stringify(r).replace(/'/g,"&apos;")}' ${selectedRows.has(r.kode_produk)?'checked':''} onchange="toggleRowSelect(this,'${r.kode_produk}', ${JSON.stringify(r).replace(/"/g,'&quot;')})"/>
    </td>
    <td><span class="kode-text">${r.kode_produk || '—'}</span><button class="copy-kode-btn" onclick="copyKode(event,'${r.kode_produk}')" title="Salin kode"><i class="ph ph-copy"></i></button></td>
        <td style="max-width:320px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r.nama_produk || '—'}</td>
        <td><span class="badge ${tipeClass[r.tipe] || ''}">${r.tipe || '—'}</span></td>
        <td>${r.harga ? `<span style="font-family:var(--mono);font-size:11.5px;color:var(--success);font-weight:600">${rupiah(r.harga)}</span>` : `<span class="chip chip-no"><i class="ph ph-x"></i> Belum ada</span>`}</td>
        <td>${r.link_v6 ? `<a href="${r.link_v6}" target="_blank" class="chip chip-yes" style="text-decoration:none"><i class="ph ph-arrow-square-out"></i> Ada</a>` : `<span class="chip chip-no"><i class="ph ph-x"></i> Belum</span>`}</td>
        <td>${r.no_akd ? `<span class="chip chip-yes" style="font-family:var(--mono)">${r.no_akd}</span>` : `<span class="chip chip-no"><i class="ph ph-x"></i> Belum</span>`}</td>
      </tr>
    `).join('');
  }

  const pg = document.getElementById('pagination');
  const btns = [];
  const range = 2;
  for (let i=1; i<=pages; i++){
    if (i===1 || i===pages || Math.abs(i-currentPage)<=range){
      btns.push(`<button class="page-btn${i===currentPage?' active':''}" onclick="goPage(${i})">${i}</button>`);
    } else if (btns[btns.length-1] !== '…'){
      btns.push('…');
    }
  }
  pg.innerHTML = btns.map(b => b==='…' ? `<span style="padding:0 4px;color:var(--text-muted);font-size:11.5px">…</span>` : b).join('');
}

function goPage(p){
  currentPage = p;
  loadTable().catch(handleLoadError);
  window.scrollTo({ top: document.querySelector('.table-section').offsetTop - 80, behavior: 'smooth' });
}

function handleLoadError(err){
  if (err.message === 'unauthorized') return;
  showToast('Gagal memuat data: ' + err.message, 'error');
}

async function loadEverything(){
  clearError();
  try {
    await Promise.all([loadStats(), loadTable(), loadKonversiToday(), loadTrend(), loadLeaderboard(), loadKategoriDonut(), loadValueLineChart(), loadWordtree(), loadForecastStok(), popInit()]);
  } catch (err) {
    handleLoadError(err);
  }
}
document.addEventListener('keydown', (e) => {
  const isTyping = ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName);

  // Esc: tutup modal detail
  if (e.key === 'Escape' && detailOverlay.classList.contains('show')) {
    closeDetailModal();
    return;
  }

  // "/" fokus ke search (kalau tidak sedang mengetik di field lain)
  if (e.key === '/' && !isTyping) {
    e.preventDefault();
    document.getElementById('tbl-search').focus();
    return;
  }

  // Panah kiri/kanan: ganti halaman pagination (kalau modal tidak terbuka & tidak sedang mengetik)
  if (!isTyping && !detailOverlay.classList.contains('show')) {
    if (e.key === 'ArrowRight') {
      const nextBtn = document.querySelector('.page-btn.active')?.nextElementSibling;
      if (nextBtn && nextBtn.classList.contains('page-btn')) nextBtn.click();
    } else if (e.key === 'ArrowLeft') {
      const activeBtn = document.querySelector('.page-btn.active');
      const prevBtn = activeBtn?.previousElementSibling;
      if (prevBtn && prevBtn.classList.contains('page-btn')) prevBtn.click();
    }
  }
});
// ══════════════════════════════════════════
// RIWAYAT PENCARIAN
// ══════════════════════════════════════════
const SEARCH_HISTORY_KEY = 'pnm_dashboard_search_history';
function getSearchHistory(){
  try { return JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) || '[]'); } catch { return []; }
}
function addSearchHistory(term){
  if (!term || term.length < 2) return;
  let hist = getSearchHistory().filter(t => t.toLowerCase() !== term.toLowerCase());
  hist.unshift(term);
  hist = hist.slice(0, 5);
  localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(hist));
}
function clearSearchHistory(){
  localStorage.removeItem(SEARCH_HISTORY_KEY);
  document.getElementById('search-history').classList.remove('show');
}
function showSearchHistory(){
  const hist = getSearchHistory();
  const box = document.getElementById('search-history');
  if (!hist.length) { box.classList.remove('show'); return; }
  box.innerHTML = hist.map(t => `<div class="search-history-item" onclick="applySearchHistory('${t.replace(/'/g,"\\'")}')"><i class="ph ph-clock-counter-clockwise"></i> ${t}</div>`).join('')
    + `<div class="search-history-clear" onclick="clearSearchHistory()">Hapus riwayat</div>`;
  box.classList.add('show');
}
function applySearchHistory(term){
  document.getElementById('tbl-search').value = term;
  document.getElementById('search-history').classList.remove('show');
  currentSearch = term;
  currentPage = 1;
  clearPageCache();
  loadTable().catch(handleLoadError);
}
document.addEventListener('click', (e) => {
  const box = document.getElementById('search-history');
  if (box && !e.target.closest('.search-wrap-mini')) box.classList.remove('show');
});

// ══════════════════════════════════════════
// PRESET FILTER TERSIMPAN
// ══════════════════════════════════════════
const PRESET_KEY = 'pnm_dashboard_presets';
function getPresets(){
  try { return JSON.parse(localStorage.getItem(PRESET_KEY) || '[]'); } catch { return []; }
}
function savePreset(){
  const label = prompt('Nama preset ini (contoh: "Instrumen tanpa harga"):');
  if (!label || !label.trim()) return;
  const presets = getPresets();
  presets.push({
    label: label.trim(),
    filter: currentFilter,
    tipe: currentTipe,
    search: currentSearch
  });
  localStorage.setItem(PRESET_KEY, JSON.stringify(presets));
  renderPresets();
  showToast(`Preset "${label.trim()}" tersimpan`);
}
function applyPreset(idx){
  const presets = getPresets();
  const p = presets[idx];
  if (!p) return;
  currentFilter = p.filter;
  currentTipe = p.tipe;
  currentSearch = p.search;
  currentPage = 1;
  clearPageCache();

  document.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b.dataset.f === p.filter));
  document.getElementById('tipe-filter').value = p.tipe || '';
  document.getElementById('tbl-search').value = p.search || '';

  loadTable().catch(handleLoadError);
}
function deletePreset(e, idx){
  e.stopPropagation();
  const presets = getPresets();
  presets.splice(idx, 1);
  localStorage.setItem(PRESET_KEY, JSON.stringify(presets));
  renderPresets();
}
function renderPresets(){
  const presets = getPresets();
  const bar = document.getElementById('preset-bar');
  if (!presets.length) { bar.innerHTML = `<span style="font-size:11px;color:var(--text-muted)">Belum ada preset tersimpan</span>`; return; }
  bar.innerHTML = presets.map((p, i) => `
    <button class="preset-chip" onclick="applyPreset(${i})">
      <i class="ph ph-bookmark-simple"></i> ${p.label}
      <span class="preset-x" onclick="deletePreset(event,${i})"><i class="ph ph-x"></i></span>
    </button>
  `).join('');
}
renderPresets();
// ══════════════════════════════════════════
// BULK SELECTION & EXPORT CSV
// ══════════════════════════════════════════
let selectedRows = new Map(); // kode_produk -> row data

function toggleRowSelect(cb, kode, rowData){
  if (cb.checked) selectedRows.set(kode, rowData);
  else selectedRows.delete(kode);
  updateBulkBar();
  document.getElementById('select-all-checkbox').checked =
    document.querySelectorAll('.row-checkbox:not(#select-all-checkbox)').length > 0 &&
    document.querySelectorAll('.row-checkbox:not(#select-all-checkbox):checked').length === document.querySelectorAll('.row-checkbox:not(#select-all-checkbox)').length;
}
function toggleSelectAll(masterCb){
  document.querySelectorAll('#tbl-body .row-checkbox').forEach(cb => {
    cb.checked = masterCb.checked;
    const kode = cb.dataset.kode;
    const rowData = JSON.parse(cb.dataset.row);
    if (masterCb.checked) selectedRows.set(kode, rowData);
    else selectedRows.delete(kode);
  });
  updateBulkBar();
}
function updateBulkBar(){
  const bar = document.getElementById('bulk-bar');
  const count = selectedRows.size;
  document.getElementById('bulk-count').textContent = count;
  bar.classList.toggle('show', count > 0);
}
function clearSelection(){
  selectedRows.clear();
  document.querySelectorAll('.row-checkbox').forEach(cb => cb.checked = false);
  updateBulkBar();
}
function exportSelected(){
  if (!selectedRows.size) return;
  const rows = Array.from(selectedRows.values());
  const headers = ['Kode Produk','Nama Produk','Tipe','Harga e-Kat','Link v6','No. AKD'];
  const csvRows = [headers.join(',')];
  rows.forEach(r => {
    const line = [
      r.kode_produk || '',
      `"${(r.nama_produk||'').replace(/"/g,'""')}"`,
      r.tipe || '',
      r.harga || '',
      r.link_v6 || '',
      r.no_akd || ''
    ].join(',');
    csvRows.push(line);
  });
  const csvContent = '\uFEFF' + csvRows.join('\n'); // BOM biar Excel baca UTF-8 dengan benar
  const blob = new Blob([csvContent], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `produk-export-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`${rows.length} produk berhasil di-export`);
}
// ══════════════════════════════════════════
// TREND 7 HARI + LEADERBOARD SALES
// ══════════════════════════════════════════
async function loadTrend(){
  const data = await rpc('get_dashboard_trend_7hari', {});
  const box = document.getElementById('trend-chart-box');
  if (!data || !data.length){ box.innerHTML = `<div class="insight-empty">Belum ada data konversi.</div>`; return; }

  const maxVal = Math.max(...data.map(d=>d.jumlah), 1);
  const todayStr = new Date().toISOString().slice(0,10);
  const dayNames = ['Min','Sen','Sel','Rab','Kam','Jum','Sab'];

  box.innerHTML = `<div class="trend-chart">
    ${data.map(d => {
      const h = Math.round((d.jumlah / maxVal) * 100);
      const isToday = d.tanggal === todayStr;
      const dt = new Date(d.tanggal + 'T00:00:00');
      const label = dayNames[dt.getDay()];
      return `<div class="trend-bar-wrap">
        <div class="trend-bar" style="height:${Math.max(h,3)}%">
          <div class="trend-bar-tooltip">${fmt(d.jumlah)} order<br>${rupiah(d.total_value)}</div>
        </div>
        <div class="trend-bar-label${isToday?' today':''}">${label}</div>
      </div>`;
    }).join('')}
  </div>`;
}

async function loadLeaderboard(){
  const data = await rpc('get_dashboard_leaderboard_sales', {p_days: 30});
  const box = document.getElementById('leaderboard-box');
  if (!data || !data.length){ box.innerHTML = `<div class="insight-empty">Belum ada data sales.</div>`; return; }

  const rankClass = (i) => i===0?'r1':i===1?'r2':i===2?'r3':'rn';
  box.innerHTML = `<div class="leaderboard-list">
    ${data.map((r,i) => `
      <div class="lb-item">
        <div class="lb-rank ${rankClass(i)}">${i+1}</div>
        <div class="lb-info">
          <div class="lb-name">${r.nama}</div>
          <div class="lb-sub">${fmt(r.jumlah_order)} order</div>
        </div>
        <div class="lb-value">${rupiah(r.total_value)}</div>
      </div>
    `).join('')}
  </div>`;
}
// ══════════════════════════════════════════
// WORD TREE: KEBUTUHAN CUSTOMER -> SKU
// Sumbernya permintaan_item_produk (junction table dari fitur multi-SKU
// di Kebutuhan RS) — otomatis nambah sendiri tiap staff nyentang "Bisa
// Dipenuhi", gak ada langkah manual terpisah. Normalisasi istilahnya
// dibikin niru pola yang dipakai tab Dictionary (lihat catatan di
// wordtree_rpc.sql kalau ternyata beda).
// ══════════════════════════════════════════
const WORDTREE_COLORS = ['#2563eb','#16a34a','#7c3aed','#d97706','#dc2626','#0d9488','#be185d','#4338ca'];
const WORDTREE_LAST_KEY = 'pnm_wordtree_last_istilah';
let wordtreeRoots = [];

async function loadWordtree(){
  const select = document.getElementById('wordtree-root-select');
  const box = document.getElementById('wordtree-box');
  try {
    wordtreeRoots = await rpc('get_wordtree_roots', { p_limit: 40 }) || [];
  } catch {
    wordtreeRoots = [];
  }
  if (!wordtreeRoots.length){
    select.innerHTML = '<option value="">Belum ada data</option>';
    box.innerHTML = `<div class="insight-empty">Belum ada kebutuhan yang tersambung ke SKU. Peta ini kepakai otomatis begitu Kebutuhan RS mulai ditandai "Bisa Dipenuhi".</div>`;
    return;
  }
  const saved = localStorage.getItem(WORDTREE_LAST_KEY);
  const initial = wordtreeRoots.some(r => r.istilah_customer === saved) ? saved : wordtreeRoots[0].istilah_customer;
  select.innerHTML = wordtreeRoots.map(r => {
    const val = escapeHtmlAttr(r.istilah_customer);
    const sel = r.istilah_customer === initial ? ' selected' : '';
    return `<option value="${val}"${sel}>${escapeHtmlAttr(r.istilah_customer)} (${r.frekuensi}×, ${r.jumlah_sku_unik} SKU)</option>`;
  }).join('');
  await loadWordtreeBranches(initial);
}

async function onWordtreeRootChange(istilah){
  localStorage.setItem(WORDTREE_LAST_KEY, istilah);
  await loadWordtreeBranches(istilah);
}

async function loadWordtreeBranches(istilah){
  const box = document.getElementById('wordtree-box');
  if (!istilah) { box.innerHTML = `<div class="insight-empty">Pilih istilah dulu.</div>`; return; }
  box.innerHTML = `<div class="skeleton" style="height:260px"></div>`;
  let branches;
  try {
    branches = await rpc('get_wordtree_branches', { p_istilah: istilah }) || [];
  } catch {
    box.innerHTML = `<div class="insight-empty">Gagal memuat word tree.</div>`;
    return;
  }
  if (!branches.length){ box.innerHTML = `<div class="insight-empty">Belum ada SKU tersambung buat istilah ini.</div>`; return; }
  box.innerHTML = renderWordtreeSvg(istilah, branches);
}

// Node kiri (root) = istilah customer, cabang di kanan = tiap SKU yang
// pernah dipakai buat penuhi istilah itu. Ketebalan & warna kabel ngikutin
// frekuensi, jadi kombinasi SKU paling sering kepakai langsung menonjol —
// bundle (mis. "Set Pacho" + "Cataract Minor Set" buat "All Set Mata")
// kelihatan sebagai beberapa cabang tebal dari satu root yang sama.
function renderWordtreeSvg(istilah, branches){
  const W = 720, rowH = 34, PAD_TOP = 20;
  const H = PAD_TOP * 2 + branches.length * rowH;
  const rootX = 170, rootY = H / 2;
  const branchX = W - 210;
  const maxFrek = Math.max(...branches.map(b => b.frekuensi), 1);

  const wires = branches.map((b, i) => {
    const by = PAD_TOP + i * rowH + rowH / 2;
    const strokeW = (1.5 + (b.frekuensi / maxFrek) * 5).toFixed(1);
    const color = WORDTREE_COLORS[i % WORDTREE_COLORS.length];
    const dx = (branchX - rootX) * 0.5;
    return `<path d="M ${rootX} ${rootY} C ${rootX + dx} ${rootY}, ${branchX - dx} ${by}, ${branchX} ${by}"
      stroke="${color}" stroke-width="${strokeW}" fill="none" opacity="0.55"/>`;
  }).join('');

  const branchNodes = branches.map((b, i) => {
    const by = PAD_TOP + i * rowH + rowH / 2;
    const color = WORDTREE_COLORS[i % WORDTREE_COLORS.length];
    return `
      <circle cx="${branchX}" cy="${by}" r="5" fill="${color}"/>
      <text x="${branchX + 12}" y="${by + 4}" font-size="12" fill="var(--text)">${escapeXml(b.kode_produk)}${b.nama_produk ? ' — ' + escapeXml(b.nama_produk) : ''}</text>
      <text x="${W - 6}" y="${by + 4}" font-size="11" text-anchor="end" fill="var(--text-muted)">${b.frekuensi}×${b.persentase != null ? ' · ' + b.persentase + '%' : ''}</text>
    `;
  }).join('');

  return `<div class="wordtree-wrap">
    <svg width="100%" viewBox="0 0 ${W} ${H}">
      ${wires}
      <circle cx="${rootX}" cy="${rootY}" r="7" fill="var(--accent)"/>
      <text x="${rootX - 14}" y="${rootY + 4}" font-size="13" font-weight="700" text-anchor="end" fill="var(--text)">${escapeXml(istilah)}</text>
      ${branchNodes}
    </svg>
  </div>`;
}

function escapeXml(s){
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escapeHtmlAttr(s){
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ══════════════════════════════════════════
// DONUT CHART KATEGORI + LINE CHART VALUE
// ══════════════════════════════════════════
const DONUT_COLORS = ['#2563eb','#16a34a','#7c3aed','#d97706','#dc2626','#0d9488'];

async function loadKategoriDonut(){
  const data = await rpc('get_dashboard_kategori_distribusi', {p_days: 30});
  const box = document.getElementById('donut-chart-box');
  if (!data || !data.length){ box.innerHTML = `<div class="insight-empty">Belum ada data kategori.</div>`; return; }

  const total = data.reduce((s,d)=>s+d.jumlah,0);
  const R = 45, CX = 55, CY = 55, STROKE = 18;
  const circumference = 2 * Math.PI * R;
  let offset = 0;

  const segments = data.map((d, i) => {
    const pct = d.jumlah / total;
    const dash = pct * circumference;
    const seg = `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${DONUT_COLORS[i % DONUT_COLORS.length]}" stroke-width="${STROKE}"
      stroke-dasharray="${dash} ${circumference-dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${CX} ${CY})"
      style="transition:stroke-dasharray .6s ease"><title>${d.kategori}: ${fmt(d.jumlah)} (${Math.round(pct*100)}%)</title></circle>`;
    offset += dash;
    return seg;
  }).join('');

  const legend = data.map((d,i) => `
    <div class="donut-legend-item">
      <span class="donut-legend-dot" style="background:${DONUT_COLORS[i % DONUT_COLORS.length]}"></span>
      <span class="donut-legend-label">${d.kategori}</span>
      <span class="donut-legend-val">${fmt(d.jumlah)}</span>
      <span class="donut-legend-pct">${Math.round(d.jumlah/total*100)}%</span>
    </div>
  `).join('');

  box.innerHTML = `<div class="donut-wrap-flex">
    <svg class="donut-svg" width="110" height="110" viewBox="0 0 110 110">${segments}</svg>
    <div class="donut-legend-list">${legend}</div>
  </div>`;
}

async function loadValueLineChart(){
  const data = await rpc('get_dashboard_trend_7hari', {});
  const box = document.getElementById('linechart-box');
  if (!data || !data.length){ box.innerHTML = `<div class="insight-empty">Belum ada data konversi.</div>`; return; }

  const W = 600, H = 140, PAD = 24;
  const maxVal = Math.max(...data.map(d=>d.total_value), 1);
  const dayNames = ['Min','Sen','Sel','Rab','Kam','Jum','Sab'];
  const n = data.length;
  const stepX = (W - PAD*2) / (n - 1 || 1);

  const points = data.map((d,i) => {
    const x = PAD + i * stepX;
    const y = H - PAD - ((d.total_value / maxVal) * (H - PAD*2));
    return {x, y, ...d};
  });

  const pathD = points.map((p,i) => `${i===0?'M':'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const areaD = pathD + ` L ${points[points.length-1].x.toFixed(1)} ${H-PAD} L ${points[0].x.toFixed(1)} ${H-PAD} Z`;

  const dots = points.map(p => {
    const dt = new Date(p.tanggal + 'T00:00:00');
    const label = dayNames[dt.getDay()];
    return `<g>
      <circle class="linechart-tooltip-dot" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" fill="var(--success)">
        <title>${label}, ${p.tanggal}: ${rupiah(p.total_value)}</title>
      </circle>
      <text x="${p.x.toFixed(1)}" y="${H-4}" font-size="9.5" fill="var(--text-muted)" text-anchor="middle">${label}</text>
    </g>`;
  }).join('');

  box.innerHTML = `<svg class="linechart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
    <defs>
      <linearGradient id="lineFade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--success)" stop-opacity="0.25"/>
        <stop offset="100%" stop-color="var(--success)" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path d="${areaD}" fill="url(#lineFade)"/>
    <path d="${pathD}" fill="none" stroke="var(--success)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}
  </svg>`;
}
// ══════════════════════════════════════════
// FORECASTING STOK
// ══════════════════════════════════════════
let forecastDays = 30;

function setForecastPeriod(days, el){
  forecastDays = days;
  document.querySelectorAll('.forecast-period-btn').forEach(b => b.classList.toggle('active', +b.dataset.days === days));
  loadForecastStok();
}

async function loadForecastStok(){
  const box = document.getElementById('forecast-box');
  box.innerHTML = '<div class="skeleton" style="height:200px"></div>';
  try {
    const data = await rpc('get_dashboard_forecast_stok', {p_days: forecastDays, p_limit: 15});
    if (!data || !data.length){
      box.innerHTML = `<div class="insight-empty"><i class="ph ph-check-circle" style="font-size:28px;display:block;margin-bottom:6px;color:var(--success)"></i>Tidak ada produk berisiko habis berdasarkan data ${forecastDays} hari terakhir.</div>`;
      return;
    }

    const maxDays = Math.max(...data.map(d => d.perkiraan_habis_hari || 0), 1);

    function daysPill(d){
      if (d === null || d === undefined) return '<span class="days-pill days-aman">—</span>';
      if (d <= 7)  return `<span class="days-pill days-kritis">⚠ ${d} hari</span>`;
      if (d <= 30) return `<span class="days-pill days-warn">${d} hari</span>`;
      return `<span class="days-pill days-aman">${d} hari</span>`;
    }

    function barColor(d){
      if (!d) return 'var(--border)';
      if (d <= 7)  return 'var(--danger)';
      if (d <= 30) return 'var(--warning)';
      return 'var(--success)';
    }

    box.innerHTML = `
      <div style="overflow-x:auto">
      <table class="forecast-table">
        <thead>
          <tr>
            <th>Kode Produk</th>
            <th>Nama Produk</th>
            <th style="text-align:right">Stok</th>
            <th style="text-align:right">Pakai/${forecastDays}hr</th>
            <th style="text-align:right">Rata/Hari</th>
            <th>Perkiraan Habis</th>
            <th style="min-width:100px">Status</th>
          </tr>
        </thead>
        <tbody>
          ${data.map(d => `
            <tr>
              <td><span class="kode-text">${d.kode_produk}</span></td>
              <td style="max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${d.nama_produk}</td>
              <td style="text-align:right;font-family:var(--mono);font-weight:600">${fmt(d.stok_sekarang)}</td>
              <td style="text-align:right;font-family:var(--mono)">${fmt(d.terpakai_periode)}</td>
              <td style="text-align:right;font-family:var(--mono)">${d.rata_harian}</td>
              <td>${daysPill(d.perkiraan_habis_hari)}</td>
              <td>
                <div class="forecast-bar-wrap">
                  <div class="forecast-bar-track">
                    <div class="forecast-bar-fill" style="width:${Math.min(100, Math.round((d.perkiraan_habis_hari||0)/maxDays*100))}%;background:${barColor(d.perkiraan_habis_hari)}"></div>
                  </div>
                  <span style="font-size:10px;color:var(--text-muted);white-space:nowrap">${d.perkiraan_habis_hari||'—'}h</span>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      </div>
      <div style="margin-top:10px;font-size:11px;color:var(--text-muted)">
  <i class="ph ph-info"></i> Berdasarkan laju pemakaian ${forecastDays} hari terakhir dari data konversi. Data stok terakhir diupdate: <b>${new Date().toLocaleDateString('id-ID',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</b>
        <span style="margin-left:12px"><span class="days-pill days-kritis" style="font-size:10px">≤7 hari</span> kritis &nbsp;
        <span class="days-pill days-warn" style="font-size:10px">≤30 hari</span> waspada &nbsp;
        <span class="days-pill days-aman" style="font-size:10px">&gt;30 hari</span> aman</span>
      </div>
    `;
  } catch(e) {
    box.innerHTML = `<div class="insight-empty" style="color:var(--danger)">Gagal memuat: ${e.message}</div>`;
  }
}
// ══════════════════════════════════════════
// POPULASI PRODUK PER WILAYAH — searchable & filterable, dihitung
// server-side lewat RPC get_dashboard_populasi_produk (lihat
// populasi_produk_schema.sql). Wilayah dideteksi otomatis dari
// ALAMAT_KIRIM lewat tabel referensi + trigger di Supabase, jadi
// tidak perlu isi manual tiap dokumen.
// ══════════════════════════════════════════
const POP_PAGE_SIZE = 25;
let popPage = 1;
let popSearch = '';
let popWilayah = '';
let popEntitas = '';
let popChannel = '';
let popSearchDebounce = null;

async function popInit(){
  try {
    const list = await rpc('get_dashboard_populasi_wilayah_list', {});
    const sel = document.getElementById('pop-wilayah-filter');
    sel.innerHTML = '<option value="">Semua Wilayah</option>' +
      (list || []).map(w => `<option value="${w.wilayah}">${w.wilayah} (${fmt(w.jumlah)})</option>`).join('');
  } catch(e) { /* tabel/RPC belum ada — biarkan dropdown default, error ditangani di popLoadTable */ }
  try {
    const list = await rpc('get_dashboard_populasi_entitas_list', {});
    const sel = document.getElementById('pop-entitas-filter');
    sel.innerHTML = '<option value="">Semua Entitas</option>' +
      (list || []).map(e => `<option value="${e.entitas}">${e.entitas} (${fmt(e.jumlah)})</option>`).join('');
  } catch(e) { /* biarkan default */ }
  try {
    const list = await rpc('get_dashboard_populasi_channel_list', {});
    const sel = document.getElementById('pop-channel-filter');
    sel.innerHTML = '<option value="">Semua Channel</option>' +
      (list || []).map(c => `<option value="${c.channel}">${c.channel} (${fmt(c.jumlah)})</option>`).join('');
  } catch(e) { /* RPC belum ada — dropdown tetap default sampai SQL channel dijalankan */ }
  await Promise.all([popLoadSummary(), popLoadTable()]);
}

function popSetWilayah(v){ popWilayah = v; popPage = 1; popLoadTable(); popLoadSummary(); }
function popSetEntitas(v){ popEntitas = v; popPage = 1; popLoadTable(); popLoadSummary(); }
function popSetChannel(v){ popChannel = v; popPage = 1; popLoadTable(); popLoadSummary(); }

function popOnSearch(){
  clearTimeout(popSearchDebounce);
  const spinner = document.getElementById('pop-search-spinner');
  spinner.classList.add('show');
  popSearchDebounce = setTimeout(async () => {
    popSearch = document.getElementById('pop-search').value.trim();
    popPage = 1;
    try { await popLoadTable(); } finally { spinner.classList.remove('show'); }
  }, 300);
}

async function popLoadSummary(){
  const box = document.getElementById('pop-summary-grid');
  try {
    const s = await rpc('get_dashboard_populasi_summary', { p_wilayah: popWilayah || null, p_entitas: popEntitas || null, p_channel: popChannel || null });
    box.innerHTML = `
      <div class="stat-card blue">
        <div class="stat-icon blue"><i class="ph ph-map-pin"></i></div>
        <div class="stat-val">${fmt(s.total_wilayah)}</div>
        <div class="stat-label">Wilayah Tercover</div>
      </div>
      <div class="stat-card green">
        <div class="stat-icon green"><i class="ph ph-package"></i></div>
        <div class="stat-val">${fmt(s.total_produk_unik)}</div>
        <div class="stat-label">Produk Unik Terorder</div>
      </div>
      <div class="stat-card purple">
        <div class="stat-icon purple"><i class="ph ph-stack"></i></div>
        <div class="stat-val">${fmt(s.total_qty)}</div>
        <div class="stat-label">Total Qty</div>
      </div>
      <div class="stat-card warning">
        <div class="stat-icon warning"><i class="ph ph-file-text"></i></div>
        <div class="stat-val">${fmt(s.total_dokumen)}</div>
        <div class="stat-label">Total Dokumen</div>
      </div>
    `;
  } catch(e) {
    box.innerHTML = '';
  }
}

async function popLoadTable(){
  const tbody = document.getElementById('pop-tbl-body');
  tbody.innerHTML = '<tr class="loading-row"><td colspan="9"><i class="ph ph-circle-notch spinner"></i> Memuat data…</td></tr>';
  try {
    const result = await rpc('get_dashboard_populasi_produk', {
      p_search: popSearch || null,
      p_wilayah: popWilayah || null,
      p_entitas: popEntitas || null,
      p_channel: popChannel || null,
      p_page: popPage,
      p_page_size: POP_PAGE_SIZE
    });
    popRenderTable(result.total || 0, result.rows || []);
  } catch(e) {
    if (e.message === 'unauthorized') return;
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:30px;color:var(--text-muted)">
      <i class="ph ph-database" style="font-size:26px;display:block;margin-bottom:8px"></i>
      Tabel/RPC populasi produk belum tersedia di Supabase.<br>
      <span style="font-size:11px">Jalankan <code>populasi_produk_schema.sql</code> di SQL Editor Supabase, lalu sync data (lihat <code>sync_ke_supabase.gs</code>).</span>
    </td></tr>`;
    document.getElementById('pop-tbl-info').textContent = '—';
    document.getElementById('pop-pagination').innerHTML = '';
  }
}

function popRenderTable(total, rows){
  const pages = Math.max(1, Math.ceil(total / POP_PAGE_SIZE));
  popPage = Math.min(popPage, pages);
  document.getElementById('pop-tbl-info').textContent =
    total === 0 ? '—' : `Menampilkan ${fmt((popPage-1)*POP_PAGE_SIZE+1)}–${fmt(Math.min(popPage*POP_PAGE_SIZE, total))} dari ${fmt(total)} kombinasi produk×wilayah`;

  if (!rows.length){
    document.getElementById('pop-tbl-body').innerHTML = `<tr><td colspan="9" style="text-align:center;padding:30px;color:var(--text-muted)">
      <i class="ph ph-magnifying-glass" style="font-size:26px;display:block;margin-bottom:6px"></i>Tidak ada data yang cocok.</td></tr>`;
  } else {
    document.getElementById('pop-tbl-body').innerHTML = rows.map(r => `
      <tr>
        <td><span class="kode-text">${r.kode_produk || '—'}</span></td>
        <td style="max-width:280px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${(r.nama_produk||'').replace(/"/g,'&quot;')}">${r.nama_produk || '—'}</td>
        <td><span class="badge badge-instrument">${r.entitas || '—'}</span></td>
        <td><span class="badge badge-instrument">${r.channel || '—'}</span></td>
        <td>${r.wilayah || '—'}</td>
        <td style="text-align:right;font-family:var(--mono);font-weight:600">${fmt(r.total_qty)}</td>
        <td style="text-align:right;font-family:var(--mono)">${fmt(r.jumlah_customer)}</td>
        <td style="text-align:right;font-family:var(--mono)">${fmt(r.jumlah_dokumen)}</td>
        <td style="font-size:11px;color:var(--text-muted)">${r.order_terakhir || '—'}</td>
      </tr>
    `).join('');
  }

  const pg = document.getElementById('pop-pagination');
  const btns = [];
  const range = 2;
  for (let i=1;i<=pages;i++){
    if (i===1 || i===pages || Math.abs(i-popPage)<=range){
      btns.push(`<button class="page-btn${i===popPage?' active':''}" onclick="popGoPage(${i})">${i}</button>`);
    } else if (btns[btns.length-1] !== '…'){
      btns.push('…');
    }
  }
  pg.innerHTML = btns.map(b => b==='…' ? `<span style="padding:0 4px;color:var(--text-muted);font-size:11.5px">…</span>` : b).join('');
}

function popGoPage(p){
  popPage = p;
  popLoadTable();
  window.scrollTo({ top: document.getElementById('pop-section').offsetTop - 80, behavior: 'smooth' });
}

// Export SEMUA baris yang cocok filter aktif (bukan cuma 1 halaman yang
// lagi ditampilin) ke file .csv yang bisa dibuka Excel. Pakai page_size
// besar biar RPC yang sama (get_dashboard_populasi_produk) narik semua
// baris sekaligus, tanpa perlu bikin RPC terpisah.
async function popExportExcel(ev){
  const btn = ev?.target?.closest('button');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ph ph-circle-notch spinner"></i> Menyiapkan…'; }
  try {
    const result = await rpc('get_dashboard_populasi_produk', {
      p_search: popSearch || null,
      p_wilayah: popWilayah || null,
      p_entitas: popEntitas || null,
      p_channel: popChannel || null,
      p_page: 1,
      p_page_size: 100000 // ambil semua baris yang cocok filter
    });
    const rows = result.rows || [];
    if (!rows.length) { showToast('Tidak ada data untuk di-export sesuai filter aktif.'); return; }

    const headers = ['Kode Produk','Nama Produk','Entitas','Channel','Wilayah','Total Qty','Jml Customer','Jml Dokumen','Order Terakhir'];
    const csvRows = [headers.join(',')];
    rows.forEach(r => {
      const line = [
        r.kode_produk || '',
        `"${(r.nama_produk||'').replace(/"/g,'""')}"`,
        r.entitas || '',
        r.channel || '',
        r.wilayah || '',
        r.total_qty ?? '',
        r.jumlah_customer ?? '',
        r.jumlah_dokumen ?? '',
        r.order_terakhir || ''
      ].join(',');
      csvRows.push(line);
    });
    const csvContent = '\uFEFF' + csvRows.join('\n'); // BOM biar Excel baca UTF-8 dengan benar
    const blob = new Blob([csvContent], {type:'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const filterTag = [popWilayah, popEntitas, popChannel].filter(Boolean).join('-') || 'semua';
    a.download = `populasi-produk-${filterTag}-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`${rows.length} baris berhasil di-export.`);
  } catch(e) {
    showToast('Gagal export: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ph ph-file-xls"></i> Export Excel'; }
  }
}

initAuth();