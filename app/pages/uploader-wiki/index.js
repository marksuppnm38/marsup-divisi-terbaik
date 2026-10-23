// uploader-wiki page module: mount(container) / unmount().
// Alur: pilih produk -> (opsional) atur konstanta & pemetaan AKD -> Periksa -> Bangun paket zip per operator.
// Logika baris MASTER ada di build.js (murni, dites di tests/uploader-wiki.test.mjs); pembuatan zip di bundle.js
// (memakai generator PDF/gambar yang sama dengan tab Bulk di Document Maker).

import { UPLOADER_WIKI_MARKUP } from './markup.js';
import {
  buildRow, defaultSettings, SETTINGS_FIELDS, collapse, splitBatches, akdDigits, deriveKat3,
} from './build.js';
import {
  getDeps, fetchRpcMap, checkThumbs, fetchScriptText, prepareRenderer, buildOperatorZip, SCRIPT_FILE,
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
const PAGE = 1000;

let isMounted = false;
let mountedContainer = null;
let handlers = [];

async function fetchAll(makeQuery) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await makeQuery().range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

export async function mount(container) {
  isMounted = true;
  mountedContainer = container;
  container.innerHTML = UPLOADER_WIKI_MARKUP;
  await Promise.all([ensureStyle(), ensureVendorScripts()]);
  if (!isMounted) return;

  const $ = (id) => container.querySelector(`#${id}`);
  const sb = () => window.pnmSupabase;
  const seed = await (await fetch(new URL('./seed.json', import.meta.url))).json();
  if (!isMounted) return;

  const S = {
    seed,
    settings: Object.assign(defaultSettings(seed), lsGet(LS_SETTINGS, {})),
    akdMap: Object.assign({}, seed.akdMap, lsGet(LS_AKD, {})),
    akdHints: new Map(),
    needAkd: new Set(),
    produk: [],
    filtered: [],
    selected: new Set(),
    pickInaproc: new Set(),
    pickV6: new Set(),
    rpcCache: new Map(),
    imgCache: new Map(),
    result: null,
    cancel: false,
    busy: false,
    scriptText: null,
  };
  const keyOf = (p) => String(p.kode_produk).toUpperCase();
  const valOf = (v) => (v == null || v === '' ? '(kosong)' : String(v));

  // ---------- pengaturan ----------
  function renderFields() {
    const inputs = SETTINGS_FIELDS.map((f) =>
      `<label>${escapeHtml(f.label)}<input class="field-input" data-set="${f.key}" value="${escapeHtml(S.settings[f.key])}"></label>`);
    const stok = [
      ['stokDefault', 'Stok default'], ['stokBesar', 'Stok besar (keranjang sterilisasi)'],
      ['stokBesarRegex', 'Nama produk berpola (regex) -> stok besar'], ['stokBesarPrefix', 'Atau kode berawalan -> stok besar'],
    ].map(([k, l]) => `<label>${escapeHtml(l)}<input class="field-input" data-set="${k}" value="${escapeHtml(S.settings[k])}"></label>`);
    const ov = `<label style="grid-column:1/-1">Override stok per kode (satu per baris, format KODE=jumlah)<textarea class="field-input" data-set="stokOverride" style="min-height:60px">${escapeHtml(S.settings.stokOverride)}</textarea></label>`;
    $('uwFields').innerHTML = inputs.concat(stok, [ov]).join('');
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

  // ---------- daftar produk ----------
  function counts(values) {
    const m = new Map();
    values.forEach((v) => { const k = valOf(v); m.set(k, (m.get(k) || 0) + 1); });
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }
  function renderChips(el, entries, picked, group) {
    el.innerHTML = entries.map(([v, n]) =>
      `<span class="uw-chip${picked.has(v) ? ' on' : ''}" data-group="${group}" data-val="${escapeHtml(v)}">${escapeHtml(v)} · ${n}</span>`).join('');
  }
  function applyFilters() {
    const q = collapse($('uwSearch').value).toLowerCase();
    S.filtered = S.produk.filter((p) => {
      if (S.pickInaproc.size && !S.pickInaproc.has(valOf(p.status_inaproc))) return false;
      if (S.pickV6.size && !S.pickV6.has(valOf(p.status_v6))) return false;
      if (q && !`${p.kode_produk} ${p.nama_produk}`.toLowerCase().includes(q)) return false;
      return true;
    });
    renderList();
  }
  function renderList() {
    const shown = S.filtered.slice(0, MAX_ROWS);
    $('uwList').innerHTML = shown.map((p) => {
      const k = keyOf(p);
      return `<label class="uw-item"><input type="checkbox" data-sel="${escapeHtml(k)}"${S.selected.has(k) ? ' checked' : ''}><code>${escapeHtml(p.kode_produk)}</code><span>${escapeHtml(collapse(p.nama_produk))}</span></label>`;
    }).join('') + (S.filtered.length > MAX_ROWS ? `<div class="uw-item"><span></span><span class="uw-muted" style="grid-column:2/-1">Menampilkan ${MAX_ROWS} dari ${S.filtered.length}. Gunakan filter / "Pilih semua hasil filter" untuk sisanya.</span></div>` : '');
    updateSelInfo();
  }
  function updateSelInfo() {
    $('uwSelInfo').textContent = `${S.selected.size} dipilih · ${S.filtered.length} lolos filter dari ${S.produk.length}`;
    $('uwCheckCard').hidden = S.selected.size === 0;
  }

  async function onLoad() {
    const btn = $('uwLoad'); btn.disabled = true; $('uwLoadInfo').textContent = 'Memuat...';
    try {
      const onlyActive = $('uwActive').checked;
      const noLink = $('uwNoLink').checked;
      let rows = await fetchAll(() => {
        let q = sb().from('produk')
          .select('id,kode_produk,kode_asli,nama_produk,berat_gram,status_inaproc,status_v6,link_v6,is_active')
          .order('kode_produk');
        if (onlyActive) q = q.eq('is_active', true);
        return q;
      });
      if (noLink) rows = rows.filter((p) => !collapse(p.link_v6));
      if (!isMounted) return;
      S.produk = rows;
      S.selected.clear(); S.pickInaproc.clear(); S.pickV6.clear(); S.result = null;
      renderChips($('uwStatusInaproc'), counts(rows.map((p) => p.status_inaproc)), S.pickInaproc, 'inaproc');
      renderChips($('uwStatusV6'), counts(rows.map((p) => p.status_v6)), S.pickV6, 'v6');
      $('uwFilters').hidden = false;
      $('uwLoadInfo').textContent = `${rows.length} produk dimuat.`;
      applyFilters();
    } catch (e) {
      $('uwLoadInfo').textContent = 'Gagal: ' + e.message;
    } finally { btn.disabled = false; }
  }

  // ---------- periksa ----------
  function setProg(id, done, total) { const p = $(id); p.hidden = !total; p.max = total || 1; p.value = done; }

  // Murni atas cache: dipanggil ulang setelah pemetaan AKD diedit (tanpa fetch ulang).
  function evaluate() {
    const ctx = { seed: S.seed, settings: S.settings, akdMap: S.akdMap };
    const ready = []; const skipped = []; const warn = []; const needAkd = new Set();
    S.produk.filter((p) => S.selected.has(keyOf(p))).forEach((p) => {
      const rpc = S.rpcCache.get(keyOf(p)) || null;
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
      ? `Script Tampermonkey (${SCRIPT_FILE}) ditemukan dan akan ikut di setiap paket.`
      : `${SCRIPT_FILE} tidak ditemukan di folder halaman ini, jadi tidak ikut paket. Taruh file itu di app/pages/uploader-wiki/ supaya otomatis masuk paket.`;
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
      const sel = S.produk.filter((p) => S.selected.has(keyOf(p)));
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
      const rend = await prepareRenderer(deps);
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
    const chip = ev.target.closest('.uw-chip');
    if (chip) {
      const set = chip.dataset.group === 'v6' ? S.pickV6 : S.pickInaproc;
      const v = chip.dataset.val;
      if (set.has(v)) set.delete(v); else set.add(v);
      chip.classList.toggle('on'); applyFilters(); return;
    }
    const btn = ev.target.closest('button'); if (!btn) return;
    const row = btn.closest('[data-akd]');
    switch (btn.id) {
      case 'uwLoad': onLoad(); break;
      case 'uwSelAll': S.filtered.forEach((p) => S.selected.add(keyOf(p))); renderList(); break;
      case 'uwSelNone': S.selected.clear(); renderList(); break;
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
    if (t.dataset && t.dataset.sel) { if (t.checked) S.selected.add(t.dataset.sel); else S.selected.delete(t.dataset.sel); updateSelInfo(); }
    if (t.id === 'uwOps') renderResult();
  });
  on(container, 'input', (ev) => {
    const t = ev.target;
    if (t.id === 'uwSearch') applyFilters();
    else if (t.dataset && t.dataset.set) { S.settings[t.dataset.set] = t.value; saveSettings(); }
    else if (t.dataset && t.dataset.f) {
      const row = t.closest('[data-akd]');
      if (row) { const m = S.akdMap[row.dataset.akd] || (S.akdMap[row.dataset.akd] = {}); m[t.dataset.f] = t.value; saveAkd(); }
    }
  });

  renderFields();
  renderAkd();
  fetchScriptText().then((t) => { S.scriptText = t; if (isMounted && S.result) renderResult(); });
}

export function unmount() {
  isMounted = false;
  handlers.forEach((off) => off());
  handlers = [];
  mountedContainer = null;
  document.getElementById('page-uploader-wiki-style')?.remove();
}