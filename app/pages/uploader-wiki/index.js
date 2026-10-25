// uploader-wiki page module: mount(container) / unmount().
// Alur: cari & pilih produk (RPC search_produk_dengan_harga) -> (opsional) atur konstanta & pemetaan AKD -> Periksa -> Bangun paket zip per operator.
// Logika baris MASTER ada di build.js (murni, dites di tests/uploader-wiki.test.mjs); pembuatan zip di bundle.js
// (memakai generator PDF/gambar yang sama dengan tab Bulk di Document Maker).

import { UPLOADER_WIKI_MARKUP } from './markup.js';
import SEED from './seed.js';
import {
  buildRow, defaultSettings, SETTINGS_FIELDS, collapse, splitBatches, akdDigits, deriveKat3,
} from './build.js';
import {
  getDeps, fetchRpcMap, checkThumbs, fetchScriptText, prepareRenderer, buildOperatorZip, SCRIPT_ASSET,
} from './bundle.js';

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const VENDOR_SCRIPTS = [
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
  if (!vendorReady) vendorReady = VENDOR_SCRIPTS.reduce((chain, src) => chain.then(() => loadScript(src)), Promise.resolve());
  return vendorReady;
}
function ensureStyle() {
  return new Promise((resolve) => {
    if (document.getElementById('page-uploader-wiki-style')) return resolve();
    const link = document.createElement('link');
    link.id = 'page-uploader-wiki-style';
    link.rel = 'stylesheet';
    link.href = new URL('./style.css', import.meta.url).href;
    link.onload = () => resolve();
    link.onerror = () => resolve();
    document.head.appendChild(link);
  });
}

const LS_SETTINGS = 'uw_settings_v1';
const LS_AKD = 'uw_akdmap_v1';
const lsGet = (k, fb) => { try { const v = localStorage.getItem(k); return v == null ? fb : JSON.parse(v); } catch { return fb; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* penuh / diblokir: abaikan */ } };
const MAX_ROWS = 500;

let isMounted = false;
let mountedContainer = null;
let handlers = [];

export async function mount(container) {
  isMounted = true;
  mountedContainer = container;
  container.innerHTML = UPLOADER_WIKI_MARKUP;
  await Promise.all([ensureStyle(), ensureVendorScripts()]);
  if (!isMounted) return;

  const $ = (id) => container.querySelector(`#${id}`);
  const sb = () => window.pnmSupabase;
  const seed = SEED;

  const S = {
    seed,
    settings: Object.assign(defaultSettings(seed), lsGet(LS_SETTINGS, {})),
    akdMap: Object.assign({}, seed.akdMap, lsGet(LS_AKD, {})),
    akdHints: new Map(),
    needAkd: new Set(),
    selected: new Map(),     // KODE_UPPER -> baris hasil pencarian (tetap terkumpul antar pencarian)
    hits: [],                // hasil pencarian terakhir (yang tampil di daftar)
    prodCache: new Map(),    // KODE_UPPER -> baris tabel produk (kode_asli, nama_produk, berat_gram, ...)
    searchSeq: 0,
    searchTimer: null,
    rpcCache: new Map(),
    imgCache: new Map(),
    result: null,
    cancel: false,
    busy: false,
    scriptText: null,
  };
  const keyOf = (p) => String(p.kode_produk).toUpperCase();

  // ---------- pengaturan ----------
  function renderFields() {
    const inputs = SETTINGS_FIELDS.map((f) =>
      `<label>${escapeHtml(f.label)}<input class="field-input" data-set="${f.key}" value="${escapeHtml(S.settings[f.key])}"></label>`);
    const stok = [
      ['stokDefault', 'Stok default'], ['stokBesar', 'Stok besar (keranjang sterilisasi)'],
      ['stokBesarRegex', 'Nama produk berpola (regex) -> stok besar'], ['stokBesarPrefix', 'Atau kode berawalan -> stok besar'],
    ].map(([k, l]) => `<label>${escapeHtml(l)}<input class="field-input" data-set="${k}" value="${escapeHtml(S.settings[k])}"></label>`);
    const tpl = `<label>Template thumbnail (Export Gambar)<select class="field-input" data-set="thumbTemplate">${['robust', 'adler'].map((k) => `<option value="${k}"${S.settings.thumbTemplate === k ? ' selected' : ''}>${k === 'robust' ? 'Robust' : 'Adler'}</option>`).join('')}</select></label>`;
    const ov = `<label style="grid-column:1/-1">Override stok per kode (satu per baris, format KODE=jumlah)<textarea class="field-input" data-set="stokOverride" style="min-height:60px">${escapeHtml(S.settings.stokOverride)}</textarea></label>`;
    $('uwFields').innerHTML = inputs.concat([tpl], stok, [ov]).join('');
  }
  function renderAkd() {
    const rows = Object.keys(S.akdMap).sort().map((d) => {
      const m = S.akdMap[d] || {};
      const h = S.akdHints.get(d);
      const hint = h ? [h.nama_akd, h.kategori_set].filter(Boolean).join(' | ') : '';
      const need = S.needAkd.has(d) && (!collapse(m.kat2) || !collapse(m.kbki));
      return `<div class="uw-akd-row${need ? ' need' : ''}" data-akd="${d}">
        <span class="uw-akd-no" title="${escapeHtml(hint)}">${d}</span>
        <input class="field-input" data-f="kat2" placeholder="${escapeHtml(hint || 'Kategori 2')}" value="${escapeHtml(m.kat2 || '')}">
        <input class="field-input" data-f="kat3" placeholder="${escapeHtml(m.kat2 ? deriveKat3(m.kat2) : 'Kategori 3 (otomatis)')}" value="${escapeHtml(m.kat3 || '')}">
        <input class="field-input" data-f="kbki" placeholder="KBKI" value="${escapeHtml(m.kbki || '')}">
        <button class="btn btn-ghost" data-act="akd-del" title="Hapus">&times;</button></div>`;
    });
    $('uwAkd').innerHTML = rows.join('') || '<span class="uw-muted">Belum ada pemetaan.</span>';
  }
  const saveSettings = () => lsSet(LS_SETTINGS, S.settings);
  const saveAkd = () => lsSet(LS_AKD, S.akdMap);

  // ---------- cari & pilih produk (RPC search_produk_dengan_harga) ----------
  // Sama dengan yang dipakai Converter / CRUD Produk: ranking token + trigram di server, jadi cepat dan toleran
  // terhadap beda koma/titik/spasi. Pilihan disimpan di S.selected sehingga bisa dikumpulkan dari beberapa pencarian.
  const norm = (x) => String(x == null ? '' : x).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  async function rpcSearch(q) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { data, error } = await sb().rpc('search_produk_dengan_harga', { q, p_tipe: null, only_akd: false, only_kfa: false });
      if (!error) return data || [];
      const msg = error.message || '';
      if (attempt === 0 && /timeout|canceling/i.test(msg)) continue;   // retry sekali, seperti Converter
      throw new Error(/timeout|canceling/i.test(msg) ? 'pencarian timeout -- coba kata kunci lebih spesifik' : msg);
    }
    return [];
  }
  const hideLinked = () => $('uwHideLinked').checked;
  const isLinked = (r) => !!collapse(r.link_v6);

  function renderHits() {
    const rows = S.hits.filter((r) => !(hideLinked() && isLinked(r)));
    const hidden = S.hits.length - rows.length;
    $('uwHits').hidden = S.hits.length === 0;
    $('uwHitInfo').textContent = `${rows.length} hasil${hidden ? ` · ${hidden} disembunyikan (sudah punya link_v6)` : ''}`;
    $('uwList').innerHTML = rows.slice(0, MAX_ROWS).map((r) => {
      const k = keyOf(r);
      const tags = [r.status_inaproc ? `<span class="uw-tag">${escapeHtml(r.status_inaproc)}</span>` : '', isLinked(r) ? '<span class="uw-tag warn">link_v6</span>' : ''].join('');
      return `<label class="uw-item"><input type="checkbox" data-sel="${escapeHtml(k)}"${S.selected.has(k) ? ' checked' : ''}><code>${escapeHtml(r.kode_produk)}</code><span>${escapeHtml(collapse(r.nama_produk))}${tags}</span></label>`;
    }).join('') + (rows.length > MAX_ROWS ? `<div class="uw-item"><span></span><span class="uw-muted" style="grid-column:2/-1">Menampilkan ${MAX_ROWS} dari ${rows.length}. Persempit kata kunci.</span></div>` : '');
  }
  function renderSelected() {
    $('uwSelInfo').textContent = `${S.selected.size} produk`;
    $('uwSelList').innerHTML = Array.from(S.selected.entries()).slice(0, 300).map(([k, r]) =>
      `<span class="uw-sel" title="${escapeHtml(collapse(r.nama_produk))}">${escapeHtml(r.kode_produk)}<button data-unsel="${escapeHtml(k)}" aria-label="Hapus">&times;</button></span>`).join('')
      + (S.selected.size > 300 ? `<span class="uw-muted">...dan ${S.selected.size - 300} lagi</span>` : '');
    $('uwCheckCard').hidden = S.selected.size === 0;
    if (S.selected.size === 0) { $('uwBuildCard').hidden = true; $('uwResult').hidden = true; }
  }

  async function onSearch() {
    const lines = String($('uwQuery').value || '').split(/\r?\n/).map((x) => collapse(x)).filter(Boolean);
    if (!lines.length) return;
    const my = ++S.searchSeq;
    $('uwSearch').disabled = true; $('uwMiss').innerHTML = '';
    try {
      if (lines.length === 1) {
        $('uwSearchInfo').textContent = 'Mencari...';
        const rows = await rpcSearch(lines[0]);
        if (my !== S.searchSeq) return;
        S.hits = rows;
        renderHits();
        $('uwSearchInfo').textContent = rows.length ? '' : `Tidak ada hasil untuk "${lines[0]}".`;
        return;
      }
      // Banyak baris: cari tiap baris, otomatis pilih yang cocok persis (kode / nama); kalau tak ada yang persis, ambil teratas dan tandai.
      const miss = []; const approx = []; const all = [];
      let done = 0;
      const queue = lines.slice();
      await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
        while (queue.length) {
          const line = queue.shift();
          try {
            const rows = await rpcSearch(line);
            const n = norm(line);
            const exact = rows.filter((r) => norm(r.kode_produk) === n || norm(r.nama_produk) === n);
            const contain = exact.length ? exact : rows.filter((r) => norm(r.nama_produk).includes(n));
            const pick = contain.length ? contain : rows.slice(0, 1);
            if (!pick.length) miss.push(`${line}: tidak ada hasil`);
            else {
              if (!contain.length) approx.push(`${line}  ->  ${pick[0].kode_produk} (${collapse(pick[0].nama_produk)})`);
              pick.forEach((r) => { S.selected.set(keyOf(r), r); all.push(r); });
            }
          } catch (e) { miss.push(`${line}: ${e.message}`); }
          done += 1;
          $('uwSearchInfo').textContent = `Mencari ${done}/${lines.length}...`;
        }
      }, ));
      if (my !== S.searchSeq) return;
      S.hits = all;
      renderHits(); renderSelected();
      $('uwSearchInfo').textContent = `${lines.length} baris dicari, ${new Set(all.map(keyOf)).size} produk unik dipilih.`;
      const blk = (t, a) => (a.length ? `<div class="uw-issues-title">${escapeHtml(t)} (${a.length})</div><div class="uw-issues">${a.map(escapeHtml).join('\n')}</div>` : '');
      $('uwMiss').innerHTML = blk('Tidak ketemu', miss) + blk('Hanya mirip (tidak ada yang persis) -- cek kembali', approx);
    } catch (e) {
      $('uwSearchInfo').textContent = 'Gagal: ' + e.message;
    } finally { if (my === S.searchSeq) $('uwSearch').disabled = false; }
  }

  // ---------- periksa ----------
  function setProg(id, done, total) { const p = $(id); p.hidden = !total; p.max = total || 1; p.value = done; }

  // Murni atas cache: dipanggil ulang setelah pemetaan AKD diedit (tanpa fetch ulang).
  function evaluate() {
    const ctx = { seed: S.seed, settings: S.settings, akdMap: S.akdMap };
    const ready = []; const skipped = []; const warn = []; const needAkd = new Set();
    Array.from(S.selected.entries()).forEach(([k, hit]) => {
      const p = S.prodCache.get(k) || hit;
      const rpc = S.rpcCache.get(k) || null;
      const r = buildRow(p, rpc, ctx);
      const reasons = r.skip.slice();
      if (!r.row) {
        if (r.akd && !S.akdMap[r.akd]) needAkd.add(r.akd);
        else if (r.akd && reasons.some((x) => /belum lengkap/.test(x))) needAkd.add(r.akd);
        skipped.push({ kode: p.kode_produk, why: reasons.join('; ') });
        return;
      }
      if (S.imgCache.get(collapse(p.kode_asli)) !== true) {
        skipped.push({ kode: p.kode_produk, why: 'thumbnail belum ada di bucket (buat dulu di Export Gambar > Bulk)' });
        return;
      }
      r.flags.forEach((f) => warn.push({ kode: p.kode_produk, why: f }));
      ready.push({ p, rpc, row: r.row });
    });
    S.needAkd = needAkd;
    S.result = { ready, skipped, warn };
    renderResult();
  }

  function renderResult() {
    const r = S.result; if (!r) return;
    const n = Math.max(1, Math.min(20, parseInt($('uwOps').value, 10) || 1));
    const parts = splitBatches(r.ready, n).map((x) => x.length);
    $('uwResult').hidden = false;
    $('uwStats').innerHTML = [
      `${r.ready.length} siap`, `${r.skipped.length} dilewati`, `${r.warn.length} catatan`,
      `${parts.length} paket: ${parts.join(' / ')} SKU`,
    ].map((t) => `<span class="stat-pill">${escapeHtml(t)}</span>`).join('');
    const block = (title, arr) => arr.length
      ? `<div class="uw-issues-title">${escapeHtml(title)} (${arr.length})</div><div class="uw-issues">${arr.slice(0, 200).map((x) => escapeHtml(`${x.kode}: ${x.why}`)).join('\n')}${arr.length > 200 ? `\n...dan ${arr.length - 200} lagi` : ''}</div>`
      : '';
    const needMsg = S.needAkd.size
      ? `<div class="uw-issues-title">AKD belum dipetakan (${S.needAkd.size}) -- isi kategori & KBKI di bagian "2. Pengaturan", lalu klik Periksa lagi</div><div class="uw-issues">${Array.from(S.needAkd).map((d) => escapeHtml(d)).join(', ')}</div>`
      : '';
    $('uwIssues').innerHTML = needMsg + block('Dilewati (tidak masuk paket)', r.skipped) + block('Catatan', r.warn);
    $('uwBuildCard').hidden = r.ready.length === 0;
    $('uwScriptInfo').textContent = S.scriptText
      ? `Script Tampermonkey ditemukan dan akan ikut di setiap paket.`
      : `Script Tampermonkey belum ada di server, jadi tidak ikut paket. Taruh file script sebagai assets/${SCRIPT_ASSET} di repo supaya otomatis masuk setiap paket.`;
    if (S.needAkd.size) { $('uwSettings').open = true; renderAkd(); }
  }

  async function loadAkdHints(digitsList) {
    const need = digitsList.filter((d) => !S.akdHints.has(d));
    if (!need.length) return;
    try {
      const { data } = await sb().from('akd').select('no_akd,nama_akd,kategori_set,golongan')
        .or(need.map((d) => `no_akd.ilike.%${d}%`).join(','));
      (data || []).forEach((a) => { const d = akdDigits(a.no_akd); if (d) S.akdHints.set(d, a); });
    } catch { /* petunjuk saja, boleh gagal */ }
  }

  async function onCheck() {
    if (S.busy) return;
    S.busy = true; S.cancel = false; $('uwCheck').disabled = true;
    try {
      const needProd = Array.from(S.selected.entries()).filter(([k]) => !S.prodCache.has(k)).map(([, r]) => r.kode_produk);
      if (needProd.length) {
        $('uwCheckInfo').textContent = 'Mengambil data produk...';
        for (let i = 0; i < needProd.length; i += 100) {
          const { data, error } = await sb().from('produk').select('kode_produk,kode_asli,nama_produk,berat_gram,status_inaproc,link_v6').in('kode_produk', needProd.slice(i, i + 100));
          if (error) throw new Error(error.message);
          (data || []).forEach((r) => S.prodCache.set(keyOf(r), r));
        }
      }
      const sel = Array.from(S.selected.keys()).map((k) => S.prodCache.get(k)).filter(Boolean);
      const needRpc = sel.filter((p) => !S.rpcCache.has(keyOf(p))).map((p) => p.kode_produk);
      if (needRpc.length) {
        $('uwCheckInfo').textContent = 'Mengambil harga & AKD dari database...';
        const deps = await getDeps();
        const map = await fetchRpcMap(deps, needRpc, { onProgress: (d, t) => setProg('uwProg', d, t), stop: () => !isMounted });
        needRpc.forEach((c) => { const k = String(c).toUpperCase(); if (map.has(k)) S.rpcCache.set(k, map.get(k)); });
      }
      const needImg = Array.from(new Set(sel.filter((p) => S.rpcCache.has(keyOf(p))).map((p) => collapse(p.kode_asli)).filter((k) => k && !S.imgCache.has(k))));
      if (needImg.length) {
        $('uwCheckInfo').textContent = 'Memeriksa thumbnail di bucket...';
        const deps = await getDeps();
        const ok = await checkThumbs(deps, needImg, { onProgress: (d, t) => setProg('uwProg', d, t), stop: () => !isMounted });
        needImg.forEach((k) => S.imgCache.set(k, ok.has(k)));
      }
      setProg('uwProg', 0, 0);
      evaluate();
      if (S.needAkd.size) { await loadAkdHints(Array.from(S.needAkd)); renderAkd(); }
      $('uwCheckInfo').textContent = '';
    } catch (e) {
      setProg('uwProg', 0, 0);
      $('uwCheckInfo').textContent = 'Gagal: ' + e.message;
    } finally { S.busy = false; $('uwCheck').disabled = false; }
  }

  // ---------- bangun paket ----------
  async function onBuild() {
    if (S.busy || !S.result || !S.result.ready.length) return;
    S.busy = true; S.cancel = false;
    $('uwBuild').disabled = true; $('uwCancel').hidden = false;
    try {
      const deps = await getDeps();
      $('uwBuildInfo').textContent = 'Menyiapkan font, logo, dan library...';
      const rend = await prepareRenderer(deps, S.settings);
      const n = Math.max(1, Math.min(20, parseInt($('uwOps').value, 10) || 1));
      const names = $('uwNames').value.split(',').map((x) => collapse(x)).filter(Boolean);
      const d = new Date(); const pad = (x) => String(x).padStart(2, '0');
      const batchId = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
      const parts = splitBatches(S.result.ready, n);
      const stop = () => S.cancel || !isMounted;
      const report = [];
      for (let i = 0; i < parts.length && !stop(); i += 1) {
        const label = names[i] || `OP${i + 1}`;
        const out = await buildOperatorZip(deps, rend, {
          label, batchId, records: parts[i], seed: S.seed, settings: S.settings, scriptText: S.scriptText, stop,
          onProgress: (done, total) => { setProg('uwBuildProg', done, total); $('uwBuildInfo').textContent = `Paket ${i + 1}/${parts.length} (${label}): ${done}/${total} SKU`; },
        });
        if (!out) break;
        deps.triggerDownload(out.blob, out.name);
        report.push(`${out.name}: ${out.ok.length} SKU${out.gagal.length ? `, ${out.gagal.length} gagal dibuat (lihat GAGAL_DIBUAT.txt)` : ''}`);
        await new Promise((r) => setTimeout(r, 900));   // jeda supaya browser tidak memblokir unduhan beruntun
      }
      setProg('uwBuildProg', 0, 0);
      $('uwBuildInfo').textContent = S.cancel ? 'Dibatalkan.' : `Selesai. ${report.join(' · ')}`;
    } catch (e) {
      setProg('uwBuildProg', 0, 0);
      $('uwBuildInfo').textContent = 'Gagal: ' + e.message;
    } finally { S.busy = false; $('uwBuild').disabled = false; $('uwCancel').hidden = true; }
  }

  // ---------- event ----------
  const on = (t, type, fn) => { t.addEventListener(type, fn); handlers.push(() => t.removeEventListener(type, fn)); };

  on(container, 'click', (ev) => {
    const un = ev.target.closest('[data-unsel]');
    if (un) { S.selected.delete(un.dataset.unsel); renderSelected(); renderHits(); return; }
    const btn = ev.target.closest('button'); if (!btn) return;
    const row = btn.closest('[data-akd]');
    switch (btn.id) {
      case 'uwSearch': onSearch(); break;
      case 'uwPickAll': S.hits.filter((r) => !(hideLinked() && isLinked(r))).forEach((r) => S.selected.set(keyOf(r), r)); renderHits(); renderSelected(); break;
      case 'uwSelNone': S.selected.clear(); renderSelected(); renderHits(); break;
      case 'uwCheck': onCheck(); break;
      case 'uwBuild': onBuild(); break;
      case 'uwCancel': S.cancel = true; break;
      case 'uwAkdAdd': {
        const d = akdDigits($('uwAkdNew').value);
        if (!d) break;
        if (!S.akdMap[d]) S.akdMap[d] = { kat2: '', kat3: '', kbki: '' };
        S.needAkd.add(d); saveAkd(); renderAkd(); $('uwAkdNew').value = ''; break;
      }
      case 'uwAkdCopy':
        navigator.clipboard.writeText(JSON.stringify(S.akdMap, null, 1)).then(() => { btn.textContent = 'Tersalin'; setTimeout(() => { btn.textContent = 'Salin JSON'; }, 1500); }).catch(() => {});
        break;
      case 'uwAkdImport': {
        const ta = $('uwAkdJson');
        if (ta.hidden) { ta.hidden = false; btn.textContent = 'Terapkan JSON'; break; }
        try {
          const obj = JSON.parse(ta.value);
          Object.keys(obj).forEach((k) => { const d = akdDigits(k); if (d && obj[k] && typeof obj[k] === 'object') S.akdMap[d] = { kat2: obj[k].kat2 || '', kat3: obj[k].kat3 || '', kbki: obj[k].kbki || '' }; });
          saveAkd(); renderAkd(); ta.hidden = true; ta.value = ''; btn.textContent = 'Muat dari JSON';
        } catch { btn.textContent = 'JSON tidak valid'; setTimeout(() => { btn.textContent = 'Terapkan JSON'; }, 1500); }
        break;
      }
      case 'uwReset':
        if (window.confirm('Kembalikan semua konstanta & pemetaan AKD ke default bawaan?')) {
          S.settings = defaultSettings(S.seed); S.akdMap = Object.assign({}, S.seed.akdMap);
          saveSettings(); saveAkd(); renderFields(); renderAkd();
        }
        break;
      default:
        if (btn.dataset.act === 'akd-del' && row) { delete S.akdMap[row.dataset.akd]; saveAkd(); renderAkd(); }
    }
  });
  on(container, 'change', (ev) => {
    const t = ev.target;
    if (t.dataset && t.dataset.sel) {
      const hit = S.hits.find((r) => keyOf(r) === t.dataset.sel);
      if (hit) { if (t.checked) S.selected.set(t.dataset.sel, hit); else S.selected.delete(t.dataset.sel); renderSelected(); }
    }
    if (t.dataset && t.dataset.set && t.tagName === 'SELECT') { S.settings[t.dataset.set] = t.value; saveSettings(); }
    if (t.id === 'uwOps') renderResult();
    if (t.id === 'uwHideLinked') renderHits();
  });
  on(container, 'input', (ev) => {
    const t = ev.target;
    if (t.id === 'uwQuery') {
      // satu baris -> cari otomatis setelah berhenti mengetik; banyak baris -> tunggu klik Cari / Ctrl+Enter
      clearTimeout(S.searchTimer);
      if (!/[\r\n]/.test(t.value.trim()) && collapse(t.value).length >= 3) S.searchTimer = setTimeout(onSearch, 450);
    } else if (t.dataset && t.dataset.set) { S.settings[t.dataset.set] = t.value; saveSettings(); }
    else if (t.dataset && t.dataset.f) {
      const row = t.closest('[data-akd]');
      if (row) { const m = S.akdMap[row.dataset.akd] || (S.akdMap[row.dataset.akd] = {}); m[t.dataset.f] = t.value; saveAkd(); }
    }
  });
  on(container, 'keydown', (ev) => {
    if (ev.target.id === 'uwQuery' && ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); clearTimeout(S.searchTimer); onSearch(); }
  });

  renderFields();
  renderAkd();
  renderSelected();
  fetchScriptText().then((t) => { S.scriptText = t; if (isMounted && S.result) renderResult(); });
}

export function unmount() {
  isMounted = false;
  handlers.forEach((off) => off());
  handlers = [];
  mountedContainer = null;
  document.getElementById('page-uploader-wiki-style')?.remove();
}