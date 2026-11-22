// Penampil daftar PROSEDUR set (modal dari tab Dictionary): hasil urai prosedur.js di SELURUH set, buat direview.
//   • Tampilan "Prosedur": prosedur -> kualifier -> tier/nomor -> set. Tanda kuning = layak dicek (lihat prosedur-review.js).
//   • Tampilan "Brand kosong": set berbrand kosong per prefix kode + saran brand dari data (perbaikannya tetap di data, bukan di sini).
//   • Status sinonim ditampilkan terang-terangan: pemuatnya diam-diam kalau tabel prosedur_sinonim diblok RLS/grant.
// Hanya BACA — tidak menulis apa pun. Logika ada di auto-konversi/prosedur-review.js (murni, ada test-nya); file ini cuma DOM.
import { ringkasProsedur, temuan, brandKosong, keTsv } from './auto-konversi/index.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const JENIS_LABEL = {
  inti_kosong: 'inti kosong', kualifier_panjang: 'kualifier panjang', mirip: 'nama mirip', kualifier_prosedur: 'kualifier = prosedur'
};
const TIER_LABEL = { basic: 'basic', standar: 'standar', complete: 'complete', inst: 'inst', kit: 'kit' };

export function installProsedurDaftar(S) {
  const btn = document.getElementById('btn-prosedur-daftar');
  if (!btn) return;

  let modal = null, el = {};
  let ringkas = null, tandaAll = [], indeks = null;
  let view = 'prosedur', urut = 'abjad', cari = '', jenis = 'semua';
  let brandHasil = null; // { res: brandKosong(), gagal: n } setelah "Cek brand"

  function build() {
    modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-box pd-box" role="dialog" aria-modal="true" aria-labelledby="pd-title">
        <div class="pd-head">
          <div class="modal-title" id="pd-title">Daftar prosedur set</div>
          <button class="toggle-btn" data-pd="tutup" type="button" aria-label="Tutup"><i class="ti ti-x"></i></button>
        </div>
        <div class="pd-stats" id="pd-stats" role="status"></div>
        <div class="pd-toolbar">
          <button class="kb-filter-chip active" data-pd="view" data-v="prosedur" type="button">Prosedur</button>
          <button class="kb-filter-chip" data-pd="view" data-v="brand" type="button">Brand kosong</button>
          <span class="pd-sep"></span>
          <div class="search-wrap pd-search"><i class="ti ti-search"></i><input id="pd-cari" type="text" placeholder="Cari prosedur, kualifier, kode, atau nama set" aria-label="Cari" autocomplete="off"/></div>
          <select class="filter-select" id="pd-urut" aria-label="Urutkan"><option value="abjad">A sampai Z</option><option value="jumlah">Set terbanyak</option></select>
          <button class="toggle-btn" data-pd="tsv" type="button" title="Salin yang tampil sebagai TSV (tempel ke spreadsheet)"><i class="ti ti-copy"></i> Salin TSV</button>
        </div>
        <div class="pd-chips" id="pd-chips"></div>
        <div class="pd-body" id="pd-body"></div>
      </div>`;
    (document.getElementById('app-root') || document.body).appendChild(modal);
    el = { stats: modal.querySelector('#pd-stats'), cari: modal.querySelector('#pd-cari'), urut: modal.querySelector('#pd-urut'), chips: modal.querySelector('#pd-chips'), body: modal.querySelector('#pd-body'), search: modal.querySelector('.pd-search'), toolbarTsv: modal.querySelector('[data-pd="tsv"]') };
    modal.addEventListener('click', onKlik);
    el.cari.addEventListener('input', () => { cari = el.cari.value.trim().toLowerCase(); renderBody(); });
    el.urut.addEventListener('change', () => { urut = el.urut.value; ringkas = ringkasProsedur(indeks, { urut }); renderBody(); });
  }

  const onDocKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); tutup(); } };
  function tutup() { if (modal) modal.classList.remove('show'); document.removeEventListener('keydown', onDocKey, true); btn.focus(); }

  async function buka() {
    if (!modal) build();
    modal.classList.add('show');
    document.addEventListener('keydown', onDocKey, true);
    el.body.innerHTML = '<div class="pd-info"><i class="ti ti-loader-2"></i> Memuat daftar set…</div>';
    el.stats.textContent = '';
    // Modal dipakai ulang: buang sisa pembukaan sebelumnya supaya gagal-muat tidak menampilkan data basi.
    indeks = null; ringkas = null; tandaAll = []; brandHasil = null; view = 'prosedur';
    modal.querySelectorAll('[data-pd="view"]').forEach((b) => b.classList.toggle('active', b.dataset.v === view));
    indeks = await S.getProsedurIndeks();
    if (!indeks) {
      el.body.innerHTML = '<div class="pd-info pd-warn">Indeks prosedur belum bisa dimuat (view <b>v_produk_keluarga</b> belum ada, akses diblok, atau offline). Auto-konversi tetap jalan tanpa prosedur. Coba buka lagi setelah koneksi/akses beres.</div>';
      return;
    }
    ringkas = ringkasProsedur(indeks, { urut });
    tandaAll = temuan(ringkas);
    renderStats();
    renderChips();
    renderBody();
    el.cari.focus();
  }

  function renderStats() {
    const m = (S.prosedurMeta && S.prosedurMeta()) || {};
    const nKual = ringkas.prosedur.reduce((a, p) => a + p.kualifier.length, 0);
    const sinOk = m.sinonimStatus === 'ok' && m.sinonim > 0;
    const sinTxt = m.sinonimStatus === 'ok'
      ? (m.sinonim > 0 ? `${m.sinonim} sinonim dimuat` : '0 sinonim terbaca — kalau tabel prosedur_sinonim berisi, cek RLS/grant SELECT-nya (PACHO, SC, dll. tidak akan menyatu)')
      : `sinonim GAGAL dimuat (${esc(m.sinonimStatus || '?')}) — cek akses tabel prosedur_sinonim`;
    el.stats.innerHTML = `<b>${ringkas.total}</b> set · <b>${ringkas.prosedur.length}</b> prosedur · <b>${nKual}</b> kombinasi prosedur+kualifier · <span class="${sinOk ? '' : 'pd-warn-txt'}">${sinTxt}</span>`;
  }

  function renderChips() {
    const hitung = {};
    tandaAll.forEach((t) => { hitung[t.jenis] = (hitung[t.jenis] || 0) + 1; });
    const n = tandaAll.length;
    const chip = (k, label, c) => `<button class="kb-filter-chip${jenis === k ? ' active' : ''}" data-pd="jenis" data-j="${k}" type="button">${esc(label)}${c != null ? ` <span class="kb-filter-count">${c}</span>` : ''}</button>`;
    el.chips.innerHTML = chip('semua', 'Semua', ringkas.prosedur.length) + chip('cek', 'Perlu dicek', new Set(tandaAll.map((t) => t.prosedur)).size)
      + Object.keys(JENIS_LABEL).filter((j) => hitung[j]).map((j) => chip(j, JENIS_LABEL[j], hitung[j])).join('')
      + (n ? '' : '<span class="pd-muted">Tidak ada tanda — pengurai tidak menemukan yang janggal.</span>');
    el.chips.style.display = view === 'prosedur' ? '' : 'none';
  }

  const tandaProsedur = (nama) => tandaAll.filter((t) => t.prosedur === nama);
  function terlihat() {
    return ringkas.prosedur.filter((p) => {
      const tt = tandaProsedur(p.nama);
      if (jenis === 'cek' && !tt.length) return false;
      if (jenis !== 'semua' && jenis !== 'cek' && !tt.some((t) => t.jenis === jenis)) return false;
      if (!cari) return true;
      return (p.nama || '(kosong)').toLowerCase().includes(cari) || p.kualifier.some((k) => k.kualifier.toLowerCase().includes(cari) || k.anggota.some((a) => a.kode.toLowerCase().includes(cari) || a.nama.toLowerCase().includes(cari)));
    });
  }

  function barisKualifier(p, k) {
    const tier = Object.keys(k.tier).map((t) => `${esc(TIER_LABEL[t] || t)} ${k.tier[t]}`).join(' · ');
    const nomor = k.nomor.map((n) => (n == null ? '—' : n)).join(', ');
    const tt = tandaAll.filter((t) => t.prosedur === p.nama && t.kualifier === k.kualifier && t.kualifier).map((t) => `<span class="pd-tag" title="${esc(t.detail)}">${esc(JENIS_LABEL[t.jenis])}</span>`).join('');
    return `<details class="pd-kual"><summary><span class="pd-kual-nama">${k.kualifier ? esc(k.kualifier) : '<i>(umum)</i>'}</span> ${tt}<span class="pd-meta">${k.nSet} set · ${tier} · nomor ${esc(nomor)}</span></summary>
      <ul class="pd-set">${k.anggota.map((a) => `<li><code>${esc(a.kode)}</code> ${esc(a.nama)} <span class="pd-meta">${esc(TIER_LABEL[a.tier] || a.tier)}${a.nomor != null ? ' #' + a.nomor : ''}</span></li>`).join('')}</ul></details>`;
  }

  function renderProsedur() {
    const list = terlihat();
    if (!list.length) { el.body.innerHTML = '<div class="pd-info">Tidak ada prosedur yang cocok dengan filter ini.</div>'; return; }
    // Ringkasan dulu, isi kualifier dibangun saat dibuka (ratusan prosedur × puluhan set = DOM berat kalau dirender semua).
    el.body.innerHTML = list.map((p, i) => {
      const tt = tandaProsedur(p.nama).filter((t) => !t.kualifier || t.jenis === 'inti_kosong');
      const tags = [...new Set(tt.map((t) => t.jenis))].map((j) => `<span class="pd-tag" title="${esc(tt.filter((t) => t.jenis === j).map((t) => t.detail).join('; '))}">${esc(JENIS_LABEL[j])}</span>`).join('');
      const nTandaKual = tandaAll.filter((t) => t.prosedur === p.nama && t.kualifier).length;
      return `<details class="pd-prosedur" data-i="${i}"><summary><span class="pd-nama">${p.nama ? esc(p.nama) : '<i>(inti kosong)</i>'}</span> ${tags}${nTandaKual ? `<span class="pd-tag" title="ada kualifier yang ditandai">${nTandaKual} kualifier ⚠</span>` : ''}<span class="pd-meta">${p.nSet} set · ${p.kualifier.length} kualifier</span></summary><div class="pd-isi"></div></details>`;
    }).join('');
    el.body.querySelectorAll('.pd-prosedur').forEach((d) => d.addEventListener('toggle', () => {
      const isi = d.querySelector('.pd-isi');
      if (d.open && !isi.firstChild) { const p = list[Number(d.dataset.i)]; isi.innerHTML = p.kualifier.map((k) => barisKualifier(p, k)).join(''); }
    }));
  }

  function renderBrand() {
    if (!brandHasil) {
      el.body.innerHTML = `<div class="pd-info">Set berbrand kosong tidak ikut cocok saat konversi (brand kosong ≠ ROBUST). Cek ini membaca kolom <b>brand</b> semua set di daftar (±1 query per 150 kode), jadi dijalankan manual.
        <div style="margin-top:10px"><button class="toggle-btn" data-pd="cekbrand" type="button"><i class="ti ti-search"></i> Cek brand kosong</button></div></div>`;
      return;
    }
    const { res, gagal } = brandHasil;
    const bersih = res.kosong === 0;
    const baris = res.grup.map((g) => `<tr><td><code>${esc(g.prefix || '(tanpa prefix)')}</code></td><td class="pd-num">${g.n}</td>
      <td>${g.saran ? `<span class="pd-tag pd-tag-saran">${esc(g.saran)}</span> <span class="pd-meta">dari ${g.dasar === 'prefix' ? 'prefix sama' : 'keluarga ' + esc(g.prefix.replace(/[^A-Z]/g, '').slice(0, 2))}</span>` : '<span class="pd-meta">tanpa saran (kemungkinan merek lain)</span>'}</td>
      <td class="pd-kodes">${esc(g.kode.slice(0, 12).join(', '))}${g.kode.length > 12 ? ` … +${g.kode.length - 12}` : ''}</td>
      <td><button class="toggle-btn" data-pd="salinkode" data-prefix="${esc(g.prefix)}" type="button" title="Salin semua kode grup ini">Salin kode</button></td></tr>`).join('');
    el.body.innerHTML = `<div class="pd-info">${res.kosong} dari ${res.total} set berbrand kosong${gagal ? ` · <span class="pd-warn-txt">${gagal} kode gagal dibaca brand-nya, tidak dihitung</span>` : ''}.
      Baris bersaran = prefix-nya sama dengan set berbrand lain, jadi kemungkinan besar salah-isi (perbaiki di data). Tanpa saran = kemungkinan merek lain yang kolom brand-nya belum diisi.
      <button class="toggle-btn" data-pd="cekbrand" type="button" style="margin-left:8px"><i class="ti ti-refresh"></i> Cek ulang</button></div>
      ${bersih ? '' : `<table class="pd-tabel"><thead><tr><th>Prefix</th><th>Set</th><th>Saran brand</th><th>Kode</th><th></th></tr></thead><tbody>${baris}</tbody></table>`}`;
  }

  function renderBody() {
    el.search.style.display = view === 'prosedur' ? '' : 'none';
    el.urut.style.display = view === 'prosedur' ? '' : 'none';
    el.chips.style.display = view === 'prosedur' ? '' : 'none';
    if (!ringkas) return; // indeks gagal dimuat: pesan galat dari buka() dibiarkan
    if (view === 'brand') renderBrand(); else renderProsedur();
  }

  async function cekBrand() {
    if (!ringkas) return;
    const kodes = ringkas.prosedur.flatMap((p) => p.kualifier.flatMap((k) => k.anggota.map((a) => a.kode)));
    const rows = kodes.map((k) => ({ kode_produk: k }));
    for (let i = 0; i < rows.length; i += 600) {
      el.body.innerHTML = `<div class="pd-info"><i class="ti ti-loader-2"></i> Membaca brand… ${Math.min(i, rows.length)}/${rows.length}</div>`;
      await S.enrichBrand(rows.slice(i, i + 600));
    }
    const peta = new Map(); let gagal = 0;
    rows.forEach((r) => { if (r.brand === undefined) gagal++; else peta.set(r.kode_produk, r.brand); }); // undefined = fetch gagal, BUKAN brand kosong
    brandHasil = { res: brandKosong(kodes.filter((k) => peta.has(k)), peta), gagal };
    renderBody();
  }

  async function salin(teks, pesan) {
    try { await navigator.clipboard.writeText(teks); S.showToast?.(pesan); } catch (e) { S.showToast?.('Gagal menyalin', 'error'); }
  }

  function onKlik(e) {
    if (e.target === modal) { tutup(); return; }
    const t = e.target.closest('[data-pd]');
    if (!t) return;
    const a = t.dataset.pd;
    if (a === 'tutup') tutup();
    else if (a === 'view') {
      view = t.dataset.v;
      modal.querySelectorAll('[data-pd="view"]').forEach((b) => b.classList.toggle('active', b === t));
      renderBody();
    } else if (a === 'jenis') { jenis = t.dataset.j; renderChips(); renderBody(); }
    else if (a === 'cekbrand') cekBrand();
    else if (a === 'salinkode') { const g = brandHasil && brandHasil.res.grup.find((x) => x.prefix === t.dataset.prefix); if (g) salin(g.kode.join('\n'), `${g.kode.length} kode disalin`); }
    else if (a === 'tsv') {
      if (view === 'brand' && brandHasil) salin(brandHasil.res.grup.flatMap((g) => g.kode.map((k) => `${g.prefix}\t${g.saran || ''}\t${k}`)).join('\n'), 'Daftar brand kosong disalin');
      else if (ringkas) { const l = terlihat(); salin(keTsv({ prosedur: l }), `${l.length} prosedur disalin`); }
    }
  }

  btn.addEventListener('click', buka);
}
