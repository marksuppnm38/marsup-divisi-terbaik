// Drawer detail izin satu akun (halaman Pengaturan > User Management): tab Izin + tab Riwayat, satu save bar.
//
// INI LAPISAN UI. Yang menegakkan izin adalah database (RLS + hak kolom + trigger allowed_users_guard di
// supabase/2026-11-26_izin_akun_modul.sql): akun non-admin yang memanggil API langsung tetap ditolak.
//
// Alur simpan (saveDrawer):
//   1. Baca ulang baris akun dan bandingkan dengan snapshot yang dipakai form. Beda = admin lain (atau SQL Editor)
//      baru mengubahnya -> berhenti, tampilkan banner "Muat ulang", jangan menimpa.
//   2. UPDATE hanya kolom yang berubah (buildPayload). Admin tidak pernah menulis modul_tersembunyi.
//   3. UPDATE yang ditolak RLS membalas SUKSES dengan 0 baris -> dianggap gagal ("Ditolak database").
//   4. Berhasil: baris diganti hasil server, akun sendiri memuat ulang izinnya (PNMAuth.loadPerms), riwayat segar.
//
// Preset izin (presets.js): dropdown "Preset izin" + "Salin dari akun lain" hanya MENGISI form; penyimpanan tetap lewat
// saveDrawer di atas. Tidak dirender untuk admin (kontrol modulnya terkunci, tidak ada yang bisa diisi).
//
// Tidak ada inline onclick/onchange. Listener dipasang di elemen overlay/konfirmasi milik halaman, jadi ikut
// hilang saat router mengosongkan container. Semua teks dari database di-escape sebelum masuk innerHTML.

import { MODULES } from '../home/markup.js';
import { SUBNAV } from '../nav/perm-view.js';
import { escapeHtml as esc } from './table.js';
import {
  IZIN_COLS, normalizeRow, sameServerState, rowToForm, isModOn, isSubOn, modState, setMod, setSub, setIzin,
  diffForm, buildPayload, needsDeleteConfirm, initialOf, describeAudit,
} from './state.js';
import { PRESETS, CUSTOM_ID, applyPreset, matchPreset, applyCopy, copySources } from './presets.js';

const AUDIT_LIMIT = 50;

const toast = (kind, msg, detail) => {
  try { window.PNMToast?.[kind]?.(msg, detail ? { detail } : undefined); } catch (_) { /* toast bukan hal yang boleh menggagalkan simpan */ }
};

// ── Dialog konfirmasi (memakai .confirm-overlay milik pnm-universal.css) ─────────────────────
let cancelActiveAsk = null; // dialog yang sedang terbuka (dibatalkan paksa saat halaman ditinggalkan)
// buttons: [{ value, label, primary?, danger? }]. Kembali: value tombol yang dipilih, atau null (Esc / klik luar).
function ask(host, { title, message, danger = false, buttons }) {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    host.innerHTML = `
      <div class="confirm-card${danger ? ' danger' : ''}" role="alertdialog" aria-modal="true" aria-labelledby="pgCfTitle" aria-describedby="pgCfMsg">
        <h3 id="pgCfTitle"><i class="ti ti-alert-triangle" aria-hidden="true"></i>${esc(title)}</h3>
        <p id="pgCfMsg">${esc(message)}</p>
        <div class="confirm-actions">${buttons.map((b) => `<button type="button" class="pg-btn${b.primary ? ' pg-btn-primary' : ''}${b.danger ? ' pg-btn-danger' : ''}" data-v="${esc(b.value)}">${esc(b.label)}</button>`).join('')}</div>
      </div>`;
    host.classList.add('open');
    const btns = Array.from(host.querySelectorAll('button[data-v]'));
    const done = (v) => {
      cancelActiveAsk = null;
      host.classList.remove('open');
      host.innerHTML = '';
      host.onclick = null;
      document.removeEventListener('keydown', onKey, true);
      if (prevFocus && prevFocus.isConnected && typeof prevFocus.focus === 'function') prevFocus.focus();
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); return; }
      if (e.key !== 'Tab' || !btns.length) return;
      const i = btns.indexOf(document.activeElement);
      e.preventDefault();
      btns[(i + (e.shiftKey ? -1 : 1) + btns.length) % btns.length].focus();
    };
    host.onclick = (e) => {
      const b = e.target.closest && e.target.closest('button[data-v]');
      if (b) done(b.dataset.v);
      else if (e.target === host) done(null);
    };
    document.addEventListener('keydown', onKey, true);
    cancelActiveAsk = () => done(null);
    // Fokus awal ke pilihan paling aman (bukan tombol berbahaya).
    (btns.find((b) => !b.classList.contains('pg-btn-danger')) || btns[0]).focus();
  });
}

// ── Pabrik drawer ────────────────────────────────────────────────────────────────────────────
// deps: { overlay, confirmHost, getRows(), getMe(), onRowUpdated(row), onClosed(email) }
export function createDrawer(deps) {
  const { overlay, confirmHost } = deps;
  let row = null;          // keadaan server yang dipakai form (hasil normalizeRow)
  let form = null;         // keadaan yang sedang diedit
  let tab = 'izin';
  let busy = false;
  let confirming = false;
  let opened = false;
  let auditSeq = 0;
  let openMods = new Set();
  let trigger = null;      // elemen yang memicu buka (fokus kembali ke sini)
  let aside = null;

  const q = (sel) => (aside ? aside.querySelector(sel) : null);
  const meIsRow = () => !!row && row.email.toLowerCase() === deps.getMe();
  const diff = () => (row && form ? diffForm(row, form) : { count: 0, items: [], izin: [], modul: false });

  // ── Markup ─────────────────────────────────────────────────────────────────────────────────
  function modHtml(m) {
    const subs = SUBNAV[m.id] || [];
    const sid = `pgSubs-${m.id}`;
    const chev = subs.length
      ? `<button type="button" class="pg-acc" data-act="toggle" data-mod="${esc(m.id)}" aria-expanded="false" aria-controls="${esc(sid)}" aria-label="Tampilkan submodul ${esc(m.title)}"><i class="ti ti-chevron-right" aria-hidden="true"></i></button>`
      : '<span class="pg-acc-gap" aria-hidden="true"></span>';
    const count = subs.length ? '<span class="pg-mod-count" aria-hidden="true"></span>' : '';
    const subsHtml = subs.length
      ? `<div class="pg-subs" id="${esc(sid)}" hidden>${subs.map((s) => `<label class="pg-sub"><input type="checkbox" data-mod="${esc(m.id)}" data-sub="${esc(s.id)}"><span>${esc(s.title)}</span></label>`).join('')}</div>`
      : '';
    return `<div class="pg-mod" data-mod="${esc(m.id)}">
      <div class="pg-mod-row">${chev}
        <label class="pg-mod-label"><span class="pg-mod-name">${esc(m.title)}</span>${count}<input type="checkbox" class="pg-switch" role="switch" data-mod="${esc(m.id)}"></label>
      </div>${subsHtml}</div>`;
  }

  function presetHtml() {
    if (row.is_superuser) return '';
    const presetOpts = [`<option value="${CUSTOM_ID}">Custom</option>`]
      .concat(PRESETS.map((p) => `<option value="${esc(p.id)}">${esc(p.label)}</option>`)).join('');
    const sources = copySources(deps.getRows(), row.email);
    const copyOpts = ['<option value="">Salin dari akun lain…</option>']
      .concat(sources.map((r) => `<option value="${esc(r.email)}">${esc(r.email)}${r.is_superuser ? ' (Admin)' : ''}</option>`)).join('');
    return `
      <section class="pg-sec pg-preset" aria-labelledby="pgSecPreset">
        <div class="pg-sec-head"><h3 id="pgSecPreset">Preset izin</h3></div>
        <div class="pg-preset-row">
          <select class="conv-select" data-preset="preset" data-ui-icon="ti-adjustments" aria-label="Preset izin">${presetOpts}</select>
          ${sources.length ? `<select class="conv-select" data-preset="copy" data-ui-icon="ti-copy" aria-label="Salin izin dari akun lain">${copyOpts}</select>` : ''}
        </div>
        <p class="pg-hint">Mengisi modul dan izin hapus sekaligus. Belum tersimpan sampai kamu menekan Simpan.</p>
      </section>`;
  }

  function izinHtml() {
    return `${presetHtml()}
      <section class="pg-sec" aria-labelledby="pgSecModul">
        <div class="pg-sec-head">
          <h3 id="pgSecModul">Modul yang tampil</h3>
          <button type="button" class="pg-info" data-act="info" aria-expanded="false" aria-controls="pgInfoPop" aria-label="Catatan tentang menyembunyikan modul"><i class="ti ti-info-circle" aria-hidden="true"></i></button>
        </div>
        <div class="pg-pop" id="pgInfoPop" role="note" hidden>Menyembunyikan modul hanya mengatur tampilan. Data ikut terkunci di database hanya untuk tabel yang khusus dipakai modul itu.</div>
        ${row.is_superuser ? '<p class="pg-hint">Admin selalu melihat semua modul.</p>' : ''}
        <div class="pg-mods">${MODULES.map(modHtml).join('')}</div>
      </section>
      <section class="pg-sec pg-danger" aria-labelledby="pgSecBahaya">
        <div class="pg-sec-head"><h3 id="pgSecBahaya"><i class="ti ti-alert-triangle" aria-hidden="true"></i>Izin berbahaya</h3></div>
        <label class="pg-izin">
          <input type="checkbox" class="pg-switch pg-switch-danger" role="switch" data-izin="boleh_hapus">
          <span><strong>Hapus data</strong><small>Produk, master produk, AKD, item clipboard, dan tabel lain yang dikunci.</small></span>
        </label>
        <label class="pg-izin">
          <input type="checkbox" class="pg-switch pg-switch-danger" role="switch" data-izin="boleh_hapus_sesi">
          <span><strong>Hapus item clipboard saja</strong><small>Hanya item di clipboard sesi konversi, tabel lain tetap terkunci.</small><small class="pg-izin-note" hidden>Sudah tercakup oleh Hapus data.</small></span>
        </label>
      </section>`;
  }

  function shellHtml() {
    const badges = [
      row.role ? `<span class="pg-role">${esc(row.role)}</span>` : '',
      row.is_superuser ? '<span class="pg-tag pg-tag-admin">Admin</span>' : '',
      meIsRow() ? '<span class="pg-tag pg-tag-me">Kamu</span>' : '',
    ].join('');
    return `
      <aside class="pg-drawer" role="dialog" aria-modal="true" aria-labelledby="pgDrTitle" tabindex="-1">
        <header class="pg-dr-head">
          <span class="pg-avatar pg-avatar-lg" aria-hidden="true">${esc(initialOf(row.email))}</span>
          <div class="pg-dr-id"><h2 id="pgDrTitle">${esc(row.email)}</h2><div class="pg-dr-badges">${badges}</div></div>
          <button type="button" class="pg-dr-close" data-act="close" aria-label="Tutup"><i class="ti ti-x" aria-hidden="true"></i></button>
        </header>
        <div class="pg-tabs" role="tablist" aria-label="Detail akun">
          <button type="button" role="tab" id="pgTabIzin" class="pg-tab" data-tab="izin" aria-controls="pgPanelIzin" aria-selected="true">Izin</button>
          <button type="button" role="tab" id="pgTabRiwayat" class="pg-tab" data-tab="riwayat" aria-controls="pgPanelRiwayat" aria-selected="false" tabindex="-1">Riwayat</button>
        </div>
        <div class="pg-dr-body">
          <div class="pg-banner" id="pgBanner" role="alert" hidden></div>
          <div id="pgPanelIzin" role="tabpanel" aria-labelledby="pgTabIzin">${izinHtml()}</div>
          <div id="pgPanelRiwayat" role="tabpanel" aria-labelledby="pgTabRiwayat" hidden></div>
        </div>
        <footer class="pg-savebar">
          <span class="pg-dirty" id="pgDirty" aria-live="polite"></span>
          <button type="button" class="pg-btn" data-act="reset" disabled>Batal</button>
          <button type="button" class="pg-btn pg-btn-primary" data-act="save" disabled>Simpan</button>
        </footer>
      </aside>`;
  }

  // ── Sinkron DOM dari form (tanpa render ulang, jadi fokus keyboard tidak lepas) ─────────────
  function syncUi() {
    if (!aside || !row || !form) return;
    const admin = row.is_superuser;
    const lock = admin || busy;
    MODULES.forEach((m) => {
      const wrap = aside.querySelector(`.pg-mod[data-mod="${m.id}"]`);
      if (!wrap) return;
      const subs = SUBNAV[m.id] || [];
      const st = admin ? { on: true, partial: false, count: subs.length || 1, total: subs.length || 1 } : modState(form, m.id);
      const box = wrap.querySelector('input.pg-switch[data-mod]');
      box.checked = st.on;
      box.indeterminate = st.partial;
      box.disabled = lock;
      const cnt = wrap.querySelector('.pg-mod-count');
      if (cnt) { cnt.textContent = `${st.count}/${st.total}`; cnt.classList.toggle('is-partial', st.partial); }
      wrap.querySelectorAll('input[data-sub]').forEach((i) => {
        i.checked = admin || isSubOn(form, m.id, i.dataset.sub);
        i.disabled = lock;
      });
      if (subs.length) {
        const open = openMods.has(m.id);
        const panel = wrap.querySelector('.pg-subs');
        const btn = wrap.querySelector('.pg-acc');
        panel.hidden = !open;
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        btn.classList.toggle('is-open', open);
      }
    });

    const presetSel = aside.querySelector('select[data-preset="preset"]');
    if (presetSel) {
      presetSel.value = matchPreset(form) || CUSTOM_ID; // Custom = tidak cocok preset mana pun (dihitung, tidak disimpan)
      presetSel.disabled = busy;
    }
    const copySel = aside.querySelector('select[data-preset="copy"]');
    if (copySel) { copySel.value = ''; copySel.disabled = busy; }

    const hapus = aside.querySelector('input[data-izin="boleh_hapus"]');
    const sesi = aside.querySelector('input[data-izin="boleh_hapus_sesi"]');
    hapus.checked = form.boleh_hapus;
    hapus.disabled = busy;
    sesi.checked = form.boleh_hapus_sesi;
    // "Hapus data" sudah mencakup "item clipboard": kontrolnya dikunci, nilainya TIDAK diubah otomatis.
    sesi.disabled = busy || form.boleh_hapus;
    aside.querySelector('.pg-izin-note').hidden = !form.boleh_hapus;

    const d = diff();
    const dirty = d.count > 0;
    const dirtyEl = q('#pgDirty');
    dirtyEl.textContent = dirty ? `${d.count} perubahan belum disimpan` : 'Berlaku setelah akun itu memuat ulang halaman.';
    dirtyEl.title = dirty ? d.items.join(', ') : '';
    dirtyEl.classList.toggle('is-dirty', dirty);
    q('[data-act="save"]').disabled = !dirty || busy;
    q('[data-act="save"]').classList.toggle('is-loading', busy);
    q('[data-act="reset"]').disabled = !dirty || busy;
  }

  function showBanner(kind, text, actionLabel) {
    const b = q('#pgBanner');
    if (!b) return;
    if (!text) { b.hidden = true; b.innerHTML = ''; return; }
    b.className = `pg-banner is-${kind}`;
    b.innerHTML = `<i class="ti ${kind === 'conflict' ? 'ti-refresh-alert' : 'ti-alert-circle'}" aria-hidden="true"></i><span>${esc(text)}</span>${actionLabel ? `<button type="button" class="pg-btn pg-btn-sm" data-act="reload">${esc(actionLabel)}</button>` : ''}`;
    b.hidden = false;
  }

  // ── Riwayat per akun ───────────────────────────────────────────────────────────────────────
  async function loadAudit() {
    const host = q('#pgPanelRiwayat');
    if (!host || !row) return;
    const seq = ++auditSeq;
    const email = row.email;
    host.innerHTML = '<div class="pg-hist-state">Memuat riwayat…</div>';
    let data = null;
    let error = null;
    try {
      ({ data, error } = await window.pnmSupabase.from('izin_audit')
        .select('waktu, oleh, email_target, kolom, nilai_lama, nilai_baru')
        .eq('email_target', email)
        .order('waktu', { ascending: false })
        .limit(AUDIT_LIMIT));
    } catch (e) { error = e; }
    if (seq !== auditSeq || !aside || !aside.isConnected) return; // sudah pindah akun / tertutup
    if (error) { host.innerHTML = '<div class="pg-hist-state">Riwayat belum tersedia. Jalankan migrasi izin akun dulu.</div>'; return; }
    if (!data || !data.length) { host.innerHTML = '<div class="pg-hist-state">Belum ada perubahan izin yang tercatat untuk akun ini.</div>'; return; }
    host.innerHTML = `<ol class="pg-hist">${data.map((r) => {
      const t = new Date(r.waktu);
      const waktu = Number.isNaN(t.getTime()) ? String(r.waktu || '') : t.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
      return `<li><div class="pg-hist-meta"><time>${esc(waktu)}</time><span>${esc(r.oleh)}</span></div><div class="pg-hist-text">${esc(describeAudit(r))}</div></li>`;
    }).join('')}</ol>${data.length >= AUDIT_LIMIT ? `<p class="pg-hist-more">Menampilkan ${AUDIT_LIMIT} perubahan terbaru.</p>` : ''}`;
  }

  function setTab(next) {
    tab = next === 'riwayat' ? 'riwayat' : 'izin';
    aside.querySelectorAll('.pg-tab').forEach((t) => {
      const on = t.dataset.tab === tab;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
    });
    q('#pgPanelIzin').hidden = tab !== 'izin';
    q('#pgPanelRiwayat').hidden = tab !== 'riwayat';
    if (tab === 'riwayat') loadAudit();
  }

  // ── Buka / tutup ───────────────────────────────────────────────────────────────────────────
  function render() {
    overlay.innerHTML = shellHtml();
    aside = overlay.querySelector('.pg-drawer');
    openMods = new Set();
    MODULES.forEach((m) => { if (modState(form, m.id).partial) openMods.add(m.id); });
    syncUi();
    setTab('izin');
  }

  async function open(email, triggerEl) {
    const rows = deps.getRows();
    const next = rows.find((r) => r.email === email);
    if (!next || busy) return false;
    if (opened && row && row.email === next.email) { aside.focus(); return true; }
    if (opened && !(await requestClose())) return false;
    row = deps.getRows().find((r) => r.email === email) || next; // data bisa berubah selama dialog tertutup/terbuka
    if (busy) return false;
    form = rowToForm(row);
    trigger = triggerEl || null;
    overlay.classList.add('open');
    opened = true;
    render();
    aside.focus();
    return true;
  }

  function teardown() {
    const email = row ? row.email : null;
    auditSeq++;
    overlay.classList.remove('open');
    overlay.innerHTML = '';
    aside = null;
    opened = false;
    row = null;
    form = null;
    busy = false;
    const t = trigger;
    trigger = null;
    if (t && t.isConnected && typeof t.focus === 'function') t.focus();
    if (deps.onClosed) deps.onClosed(email);
  }

  // Tutup dengan pengaman: ada perubahan -> Buang / Lanjut edit / Simpan. Kembali true kalau drawer tertutup.
  async function requestClose() {
    if (!opened) return true;
    if (busy || confirming) return false;
    if (diff().count > 0) {
      confirming = true;
      const v = await ask(confirmHost, {
        title: 'Perubahan belum disimpan',
        message: `Ada ${diff().count} perubahan untuk ${row.email} yang belum disimpan.`,
        buttons: [
          { value: 'stay', label: 'Lanjut edit' },
          { value: 'discard', label: 'Buang', danger: true },
          { value: 'save', label: 'Simpan', primary: true },
        ],
      });
      confirming = false;
      if (!opened) return true;
      if (v === 'save') { if (!(await saveDrawer())) return false; }
      else if (v !== 'discard') return false; // 'stay' atau Esc
    }
    teardown();
    return true;
  }

  // ── Simpan ─────────────────────────────────────────────────────────────────────────────────
  function reloadFrom(freshRow) {
    row = freshRow;
    form = rowToForm(row);
    if (deps.onRowUpdated) deps.onRowUpdated(row);
    showBanner(null);
    syncUi();
  }

  async function saveDrawer() {
    if (!opened || busy || diff().count === 0) return false;
    const sb = window.pnmSupabase;
    const snapshot = row;
    const payload = buildPayload(snapshot, form);
    if (!Object.keys(payload).length) return false;
    busy = true;
    showBanner(null);
    syncUi();

    // 1) Cek konflik: baca ulang dan bandingkan dengan snapshot.
    let fresh = null;
    let error = null;
    try {
      ({ data: fresh, error } = await sb.from('allowed_users').select(IZIN_COLS).eq('email', snapshot.email).maybeSingle());
    } catch (e) { error = e; }
    if (!aside || !aside.isConnected) return false;
    if (error) {
      busy = false; syncUi();
      showBanner('error', 'Gagal memeriksa keadaan terbaru akun: ' + (error.message || error));
      toast('error', 'Gagal menyimpan izin', error.message || String(error));
      return false;
    }
    if (!fresh) {
      busy = false; syncUi();
      showBanner('error', 'Akun ini tidak ditemukan lagi di allowed_users (mungkin sudah dihapus). Tutup lalu muat ulang halaman.');
      return false;
    }
    const freshRow = normalizeRow(fresh);
    if (!sameServerState(freshRow, snapshot)) {
      busy = false; syncUi();
      showBanner('conflict', 'Akun ini baru diubah orang lain. Perubahanmu belum disimpan. Muat ulang untuk melihat keadaan terbaru (perubahanmu di form ini akan dibuang).', 'Muat ulang');
      return false;
    }

    // 2) UPDATE hanya kolom yang berubah.
    let data = null;
    error = null;
    try {
      ({ data, error } = await sb.from('allowed_users').update(payload).eq('email', snapshot.email).select(IZIN_COLS));
    } catch (e) { error = e; }
    if (!aside || !aside.isConnected) return false; // drawer sudah ditinggalkan selagi menyimpan
    busy = false;

    if (error) {
      syncUi();
      showBanner('error', 'Gagal menyimpan: ' + (error.message || error) + '. Perubahanmu masih ada di form.');
      toast('error', 'Gagal menyimpan izin', error.message || String(error));
      return false;
    }
    // RLS yang menolak UPDATE membalas sukses dengan 0 baris. Jangan pura-pura tersimpan.
    if (!Array.isArray(data) || data.length !== 1) {
      syncUi();
      showBanner('error', 'Ditolak database. Pastikan akunmu admin dan migrasi izin akun sudah dijalankan. Perubahanmu masih ada di form.');
      toast('error', 'Perubahan ditolak database', 'Pastikan akunmu admin dan migrasi izin akun sudah dijalankan.');
      return false;
    }

    const saved = normalizeRow(data[0]);
    row = saved;
    form = rowToForm(saved);
    if (deps.onRowUpdated) deps.onRowUpdated(saved);
    syncUi();
    toast('success', `Izin ${saved.email} disimpan`);

    // Mengubah izin akun sendiri: muat ulang supaya UI akun ini ikut, tanpa menunggu login berikutnya.
    if (saved.email.toLowerCase() === deps.getMe()) {
      try { await window.PNMAuth?.loadPerms(deps.getMe()); } catch (_) { /* gagal muat ulang bukan kegagalan simpan */ }
    }
    if (aside && tab === 'riwayat') loadAudit();
    return true;
  }

  // ── Event ──────────────────────────────────────────────────────────────────────────────────
  // Terapkan form hasil preset/salinan. Kalau hasilnya MENGAKTIFKAN "Hapus data" (yang sebelumnya mati), minta
  // konfirmasi yang sama seperti saklar manual; batal = tidak ada yang berubah sama sekali.
  async function applyFormChange(next, what) {
    if (needsDeleteConfirm(row, next)) {
      confirming = true;
      const v = await ask(confirmHost, {
        title: 'Aktifkan Hapus data?',
        message: `${what} akan mengaktifkan Hapus data untuk ${row.email}, jadi akun ini bisa menghapus produk, master produk, AKD, item clipboard, dan data lain yang dikunci. Terapkan hanya kalau memang perlu.`,
        danger: true,
        buttons: [{ value: 'no', label: 'Batal' }, { value: 'yes', label: 'Ya, terapkan', danger: true }],
      });
      confirming = false;
      if (!aside || v !== 'yes') { if (aside) syncUi(); return; }
    }
    form = next;
    MODULES.forEach((m) => { if (modState(form, m.id).partial) openMods.add(m.id); });
    showBanner(null);
    syncUi();
  }

  async function onSelectChange(sel) {
    if (sel.dataset.preset === 'preset') {
      const preset = PRESETS.find((p) => p.id === sel.value);
      if (!preset) { syncUi(); return; } // "Custom" dipilih: bukan perintah, kembalikan ke keadaan sebenarnya
      await applyFormChange(applyPreset(form, preset), `Preset “${preset.label}”`);
    } else if (sel.dataset.preset === 'copy') {
      const src = deps.getRows().find((r) => r.email === sel.value);
      if (!src) { syncUi(); return; }
      await applyFormChange(applyCopy(form, src), `Menyalin izin dari ${src.email}`);
    }
  }

  async function onChange(e) {
    const t = e.target;
    if (!aside || !row || busy) return;
    if (t instanceof HTMLSelectElement) { await onSelectChange(t); return; }
    if (!(t instanceof HTMLInputElement)) return;
    if (t.dataset.izin) {
      const next = setIzin(form, t.dataset.izin, t.checked);
      if (t.dataset.izin === 'boleh_hapus' && needsDeleteConfirm(row, next)) {
        confirming = true;
        const v = await ask(confirmHost, {
          title: 'Aktifkan Hapus data?',
          message: `${row.email} akan bisa menghapus produk, master produk, AKD, item clipboard, dan data lain yang dikunci. Aktifkan hanya kalau memang perlu.`,
          danger: true,
          buttons: [{ value: 'no', label: 'Batal' }, { value: 'yes', label: 'Ya, aktifkan', danger: true }],
        });
        confirming = false;
        if (!aside) return;
        if (v !== 'yes') { syncUi(); return; } // batal: kembalikan saklar
      }
      form = next;
    } else if (t.dataset.sub) {
      form = setSub(form, t.dataset.mod, t.dataset.sub, t.checked);
      if (modState(form, t.dataset.mod).partial) openMods.add(t.dataset.mod);
    } else if (t.dataset.mod) {
      // Saklar sebagian (indeterminate) diklik = lengkapi (nyalakan semua), bukan matikan semua.
      const wasPartial = modState(form, t.dataset.mod).partial;
      form = setMod(form, t.dataset.mod, wasPartial ? true : t.checked);
      if (modState(form, t.dataset.mod).partial) openMods.add(t.dataset.mod);
    } else return;
    showBanner(null);
    syncUi();
  }

  function onClick(e) {
    const btn = e.target.closest && e.target.closest('[data-act], [data-tab]');
    if (e.target === overlay) { requestClose(); return; } // klik di luar panel
    if (!btn || !aside || !aside.contains(btn)) return;
    if (btn.dataset.tab) { setTab(btn.dataset.tab); return; }
    switch (btn.dataset.act) {
      case 'close': requestClose(); break;
      case 'save': saveDrawer(); break;
      case 'reset': if (!busy) { form = rowToForm(row); showBanner(null); syncUi(); } break;
      case 'reload': reloadFresh(); break;
      case 'info': {
        const pop = q('#pgInfoPop');
        pop.hidden = !pop.hidden;
        btn.setAttribute('aria-expanded', pop.hidden ? 'false' : 'true');
        break;
      }
      case 'toggle': {
        const id = btn.dataset.mod;
        if (openMods.has(id)) openMods.delete(id); else openMods.add(id);
        syncUi();
        break;
      }
      default: break;
    }
  }

  async function reloadFresh() {
    if (!row || busy) return;
    busy = true; syncUi();
    let fresh = null;
    let error = null;
    try {
      ({ data: fresh, error } = await window.pnmSupabase.from('allowed_users').select(IZIN_COLS).eq('email', row.email).maybeSingle());
    } catch (e) { error = e; }
    if (!aside) return;
    busy = false;
    if (error || !fresh) { syncUi(); showBanner('error', 'Gagal memuat ulang akun: ' + ((error && error.message) || 'akun tidak ditemukan')); return; }
    reloadFrom(normalizeRow(fresh));
    if (tab === 'riwayat') loadAudit();
  }

  function onKeyDown(e) {
    if (!aside) return;
    // Tab terkunci di dalam panel selama drawer terbuka (dialog konfirmasi punya jebakan fokusnya sendiri).
    if (e.key === 'Tab' && !confirming) {
      const f = Array.from(aside.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"]')).filter((n) => n.offsetParent !== null || n === document.activeElement);
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === aside)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      return;
    }
    // Panah kiri/kanan di tab-list memindahkan tab (pola WAI-ARIA tabs).
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && e.target.closest && e.target.closest('.pg-tabs')) {
      e.preventDefault();
      setTab(tab === 'izin' ? 'riwayat' : 'izin');
      q(`.pg-tab[data-tab="${tab}"]`).focus();
    }
  }

  overlay.addEventListener('change', onChange);
  overlay.addEventListener('click', onClick);
  overlay.addEventListener('keydown', onKeyDown);

  return {
    open,
    requestClose,
    isOpen: () => opened,
    isDirty: () => diff().count > 0,
    currentEmail: () => (row ? row.email : null),
    hasConfirm: () => confirming,
    // Esc: tutup popover info dulu, baru drawer. Kembali true kalau ada yang ditangani.
    escape() {
      if (!opened || confirming) return false;
      // Esc milik menu dropdown yang sedang terbuka: ui-select menutupnya sendiri, drawer jangan ikut tertutup.
      if (aside && aside.querySelector('.ui-select.is-open')) return false;
      const pop = q('#pgInfoPop');
      if (pop && !pop.hidden) { pop.hidden = true; q('[data-act="info"]').setAttribute('aria-expanded', 'false'); return true; }
      requestClose();
      return true;
    },
    // Baris akun diperbarui dari luar (mis. muat ulang tabel) sementara drawer terbuka & tidak diedit.
    syncRow(next) {
      if (!opened || !row || next.email !== row.email || diff().count > 0 || busy) return;
      row = next;
      form = rowToForm(row);
      syncUi();
    },
    destroy() {
      overlay.removeEventListener('change', onChange);
      overlay.removeEventListener('click', onClick);
      overlay.removeEventListener('keydown', onKeyDown);
      if (cancelActiveAsk) cancelActiveAsk(); // lepas listener keydown dialog yang masih terbuka
      auditSeq++;
      aside = null;
      opened = false;
    },
  };
}
