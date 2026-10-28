// ui-select.js — dropdown custom pengganti <select class="filter-select"> bawaan browser.
//
// KENAPA: popup <select> native tampil ala OS (kotak putih/abu polos, gak ikut tema gelap,
// gak bisa di-style) — itu yang kelihatan "jadul" di filter urutan "Paling relevan".
//
// CARA KERJA (progressive enhancement, TANPA ngubah logic yang sudah ada):
//  - <select> asli TETAP ada di DOM dan tetap jadi sumber kebenaran. Kode lama yang baca
//    `select.value`, dengar event 'change', atau set `select.value = ...` tetap jalan.
//  - Select asli disembunyikan secara visual; di sebelahnya dibuat tombol + menu.
//  - Pilih opsi di menu -> set select.value -> dispatch 'change' (bubbles).
//  - Set `select.value` dari JS (mis. restore filter Riwayat) ikut menyegarkan label tombol.
//  - Visibilitas wrapper mengikuti select asli (search.js men-toggle style.display).
//
// INSTALL: modul ini self-installing (import sekali dari nav-markup.js). Satu MutationObserver
// di document.body menangkap select.filter-select yang muncul belakangan (halaman SPA).
// Select yang sudah diproses ditandai data-ui-select="1" supaya gak diproses dua kali.
// Menu hidup DI DALAM wrapper (bukan di <body>) jadi otomatis hilang saat halaman di-unmount.

const SELECTOR = 'select.filter-select';
const ICON_SORT = 'ti-arrows-sort';
const ICON_FILTER = 'ti-filter';

let openInstance = null; // cuma satu menu terbuka dalam satu waktu

function closeOpen() {
  if (openInstance) openInstance.close();
}

function enhance(select) {
  if (select.dataset.uiSelect === '1') return;
  select.dataset.uiSelect = '1';

  const wrap = document.createElement('div');
  wrap.className = 'ui-select';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ui-select-btn';
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');

  const icon = document.createElement('i');
  const isSort = /sort|urut/i.test(select.id + ' ' + (select.title || ''));
  icon.className = 'ti ' + (isSort ? ICON_SORT : ICON_FILTER) + ' ui-select-icon';
  const label = document.createElement('span');
  label.className = 'ui-select-label';
  const chev = document.createElement('i');
  chev.className = 'ti ti-chevron-down ui-select-chev';
  btn.append(icon, label, chev);

  const menu = document.createElement('div');
  menu.className = 'ui-select-menu';
  menu.setAttribute('role', 'listbox');
  menu.hidden = true;

  wrap.append(btn, menu);
  select.parentNode.insertBefore(wrap, select);
  select.classList.add('ui-select-native');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');

  let activeIdx = -1;

  function currentLabel() {
    const opt = select.options[select.selectedIndex];
    return opt ? opt.textContent.trim() : '';
  }
  function refresh() {
    label.textContent = currentLabel();
    btn.disabled = select.disabled;
    btn.title = select.title || '';
    // opsi kosong ("Semua Sales" value="") = belum difilter -> tampil netral; selain itu aktif
    btn.classList.toggle('is-active', !isSort && select.value !== '');
    wrap.hidden = select.style.display === 'none';
  }

  function renderItems() {
    menu.textContent = '';
    Array.from(select.options).forEach((opt, i) => {
      const item = document.createElement('div');
      item.className = 'ui-select-opt';
      item.setAttribute('role', 'option');
      item.dataset.idx = String(i);
      const selected = i === select.selectedIndex;
      item.setAttribute('aria-selected', selected ? 'true' : 'false');
      if (selected) item.classList.add('is-selected');
      if (opt.disabled) item.classList.add('is-disabled');
      const t = document.createElement('span');
      t.textContent = opt.textContent.trim();
      const check = document.createElement('i');
      check.className = 'ti ti-check ui-select-check';
      item.append(t, check);
      menu.append(item);
    });
  }

  function setActive(i) {
    const items = menu.querySelectorAll('.ui-select-opt');
    if (!items.length) return;
    activeIdx = Math.max(0, Math.min(items.length - 1, i));
    items.forEach((el, k) => el.classList.toggle('is-active', k === activeIdx));
    items[activeIdx].scrollIntoView({ block: 'nearest' });
  }

  function choose(i) {
    const opt = select.options[i];
    if (!opt || opt.disabled) return;
    const changed = select.selectedIndex !== i;
    select.selectedIndex = i;
    refresh();
    close();
    btn.focus();
    if (changed) select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function open() {
    if (select.disabled) return;
    if (openInstance && openInstance !== api) openInstance.close();
    renderItems();
    wrap.classList.remove('is-right', 'is-up');
    menu.hidden = false;
    wrap.classList.add('is-open');
    // rata kanan kalau menu (rata kiri secara default) bakal keluar dari layar
    if (menu.getBoundingClientRect().right > window.innerWidth - 8) wrap.classList.add('is-right');
    btn.setAttribute('aria-expanded', 'true');
    // buka ke atas kalau ruang di bawah gak cukup
    const r = btn.getBoundingClientRect();
    const need = Math.min(menu.scrollHeight, 280) + 12;
    wrap.classList.toggle('is-up', window.innerHeight - r.bottom < need && r.top > need);
    openInstance = api;
    setActive(select.selectedIndex);
  }
  function close() {
    if (menu.hidden) return;
    menu.hidden = true;
    wrap.classList.remove('is-open');
    btn.setAttribute('aria-expanded', 'false');
    if (openInstance === api) openInstance = null;
  }
  const api = { close };

  btn.addEventListener('click', () => (menu.hidden ? open() : close()));
  btn.addEventListener('keydown', (e) => {
    if (menu.hidden) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        open();
      }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(activeIdx + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(activeIdx - 1); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(select.options.length - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(activeIdx); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab') close();
  });
  menu.addEventListener('mousedown', (e) => e.preventDefault()); // jangan curi fokus dari tombol
  menu.addEventListener('click', (e) => {
    const item = e.target.closest('.ui-select-opt');
    if (item) choose(Number(item.dataset.idx));
  });
  menu.addEventListener('mousemove', (e) => {
    const item = e.target.closest('.ui-select-opt');
    if (item) setActive(Number(item.dataset.idx));
  });

  // sinkron: change dari luar, opsi di-repopulate (innerHTML), display di-toggle
  select.addEventListener('change', refresh);
  new MutationObserver(refresh).observe(select, { childList: true, attributes: true, attributeFilter: ['style', 'disabled'] });
  // `select.value = x` dari JS gak memicu event apa pun -> bungkus setter-nya
  const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  Object.defineProperty(select, 'value', {
    configurable: true,
    get() { return desc.get.call(this); },
    set(v) { desc.set.call(this, v); refresh(); },
  });

  refresh();
}

function scan(root) {
  if (root.matches && root.matches(SELECTOR)) enhance(root);
  if (root.querySelectorAll) root.querySelectorAll(SELECTOR).forEach(enhance);
}

function install() {
  if (window.__uiSelectInstalled) return;
  window.__uiSelectInstalled = true;
  scan(document.body);
  new MutationObserver((muts) => {
    for (const m of muts) m.addedNodes.forEach((n) => { if (n.nodeType === 1) scan(n); });
  }).observe(document.body, { childList: true, subtree: true });
  // klik di luar menutup menu (satu listener global, dipasang sekali seumur halaman)
  document.addEventListener('mousedown', (e) => {
    if (openInstance && !e.target.closest('.ui-select')) closeOpen();
  });
  window.addEventListener('blur', closeOpen);
  window.addEventListener('resize', closeOpen);
}

if (document.body) install();
else document.addEventListener('DOMContentLoaded', install, { once: true });