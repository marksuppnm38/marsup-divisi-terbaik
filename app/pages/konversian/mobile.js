// Navigasi mobile modul konversian (HP, <=640px). Material 3 "navigation bar" + bottom sheet "Lainnya".
//
// Kenapa ada: di HP tombol sub-tab (.subtab-btn) disembunyikan global dan sidebar menciut jadi rail ikon,
// jadi Konversi Berjalan / Riwayat / Project / Converter / Cari SET / Dictionary tidak bisa dijangkau.
// File ini TIDAK menduplikasi logika: semua tujuan hanya meng-klik tombol sub-tab yang sudah ada
// (switchSubTab di index.js) atau tab Clipboard bawaan (S.switchTab di clipboard.js).
// Seluruh tampilannya ada di mobile.css, dan hanya aktif di <=640px.

const DEST = [
  { id: 'cari', label: 'Cari', icon: 'ti-search', sub: 'cari' },
  { id: 'sesi', label: 'Berjalan', icon: 'ti-list-details', sub: 'sesi', badge: 'sesi-badge' },
  { id: 'converter', label: 'Converter', icon: 'ti-clipboard-copy', sub: 'converter' },
  { id: 'clip', label: 'Clipboard', icon: 'ti-clipboard', clip: true, badge: 'tab-badge' },
  { id: 'more', label: 'Lainnya', icon: 'ti-dots', more: true },
];
const MORE = [
  { label: 'Riwayat', icon: 'ti-history', sub: 'riwayat' },
  { label: 'Project', icon: 'ti-folders', sub: 'project' },
  { label: 'Cari SET', icon: 'ti-box-multiple', sub: 'setcari', badge: 'setcari-badge' },
  { label: 'Dictionary', icon: 'ti-book-2', sub: 'dictionary' },
];

export function installMobileNav(S) {
  const root = document.getElementById('app-root');
  if (!root || root.querySelector('#konv-bottombar')) return () => {};

  const bar = document.createElement('nav');
  bar.id = 'konv-bottombar';
  bar.className = 'konv-bottombar';
  bar.setAttribute('aria-label', 'Navigasi konversi');
  bar.innerHTML = DEST.map(d => `
    <button type="button" class="kb-dest" data-dest="${d.id}" aria-label="${d.label}">
      <span class="kb-pill"><i class="ti ${d.icon}"></i><span class="kb-dot" data-badge="${d.badge || ''}" hidden></span></span>
      <span class="kb-label">${d.label}</span>
    </button>`).join('');

  const sheet = document.createElement('div');
  sheet.id = 'konv-more-sheet';
  sheet.className = 'konv-sheet';
  sheet.hidden = true;
  sheet.innerHTML = `
    <div class="konv-sheet-scrim" data-close></div>
    <div class="konv-sheet-box" role="dialog" aria-modal="true" aria-label="Menu lainnya">
      <div class="konv-sheet-grab"></div>
      ${MORE.map(m => `
        <button type="button" class="konv-sheet-item" data-sub="${m.sub}">
          <i class="ti ${m.icon}"></i><span>${m.label}</span>
          <span class="konv-sheet-count" data-badge="${m.badge || ''}" hidden></span>
        </button>`).join('')}
    </div>`;

  root.appendChild(bar);
  root.appendChild(sheet);

  const q = id => document.getElementById(id);
  const isPhone = () => window.matchMedia('(max-width:640px)').matches;
  const closeSheet = () => { sheet.hidden = true; };

  function goSub(sub) {
    S.switchTab?.('search');
    q('subtab-' + sub)?.click();
    const body = q('panel-body-' + sub);
    if (body) body.scrollTop = 0;
  }

  bar.addEventListener('click', e => {
    const b = e.target.closest('.kb-dest');
    if (!b) return;
    const d = DEST.find(x => x.id === b.dataset.dest);
    if (d.more) { sheet.hidden = !sheet.hidden; return; }
    closeSheet();
    if (d.clip) S.switchTab?.('clip'); else goSub(d.sub);
    sync();
  });
  sheet.addEventListener('click', e => {
    if (e.target.closest('[data-close]')) return closeSheet();
    const it = e.target.closest('.konv-sheet-item');
    if (!it) return;
    closeSheet();
    goSub(it.dataset.sub);
    sync();
  });
  const onKey = e => { if (e.key === 'Escape') closeSheet(); };
  document.addEventListener('keydown', onKey);

  // Sinkron status aktif + badge dari elemen asli (sumber kebenaran tetap index.js/clipboard.js).
  function activeSub() {
    return Object.keys({ cari: 1, sesi: 1, riwayat: 1, project: 1, converter: 1, setcari: 1, dictionary: 1 })
      .find(s => q('subtab-' + s)?.classList.contains('active')) || 'cari';
  }
  function sync() {
    if (!isPhone()) return;
    const onClip = q('panel-clip')?.classList.contains('active');
    const sub = activeSub();
    const inMore = MORE.some(m => m.sub === sub);
    bar.querySelectorAll('.kb-dest').forEach(b => {
      const d = DEST.find(x => x.id === b.dataset.dest);
      const on = onClip ? d.clip : d.more ? inMore : (!d.clip && d.sub === sub);
      b.classList.toggle('is-active', !!on);
      b.setAttribute('aria-current', on ? 'page' : 'false');
    });
    root.querySelectorAll('[data-badge]').forEach(el => {
      const src = el.dataset.badge && q(el.dataset.badge);
      const n = src ? (src.textContent || '').trim() : '';
      const show = src && src.style.display !== 'none' && n && n !== '0';
      el.hidden = !show;
      if (show && el.classList.contains('konv-sheet-count')) el.textContent = n;
    });
  }

  const mo = new MutationObserver(sync);
  ['subtab-cari', 'subtab-sesi', 'subtab-riwayat', 'subtab-project', 'subtab-converter', 'subtab-setcari',
   'subtab-dictionary', 'panel-clip', 'sesi-badge', 'tab-badge', 'setcari-badge']
    .forEach(id => { const el = q(id); if (el) mo.observe(el, { attributes: true, attributeFilter: ['class', 'style'], childList: true, characterData: true, subtree: id.endsWith('badge') }); });
  window.addEventListener('resize', sync);
  sync();

  return function cleanup() {
    mo.disconnect();
    window.removeEventListener('resize', sync);
    document.removeEventListener('keydown', onKey);
    bar.remove();
    sheet.remove();
  };
}