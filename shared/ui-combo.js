// ui-combo.js — saran isian custom pengganti popup <datalist> bawaan browser.
//
// KENAPA: popup datalist tampil ala OS (tidak ikut tema, tidak bisa di-style, perilakunya beda per browser).
//
// CARA KERJA (progressive enhancement, logic lama tidak berubah):
//  - <input data-ui-combo list="id"> tetap input biasa: listener 'input' / 'change' lama tetap jalan.
//  - Atribut `list` DICABUT supaya popup bawaan tidak muncul; <datalist> tetap di DOM sebagai SUMBER opsi,
//    dibaca ulang tiap menu dibuka, jadi kode yang mengisi datalist lewat innerHTML tidak perlu diubah.
//  - Pilih opsi -> set input.value -> dispatch 'input' lalu 'change' (bubbles).
//  - Menu hidup di parent input (parent diberi position:relative), jadi hilang sendiri saat modal dibuang.
// Self-installing, pola sama dengan ui-select.js. Opsi dibatasi MAKS supaya daftar panjang tetap ringan.

const SELECTOR = 'input[data-ui-combo]';
const MAKS = 40;
let openInstance = null;

function enhance(input) {
  if (input.dataset.uiComboOn === '1') return;
  const listId = input.getAttribute('list');
  if (!listId) return;
  input.dataset.uiComboOn = '1';
  input.dataset.listId = listId;
  input.removeAttribute('list');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');

  const host = input.parentElement;
  host.classList.add('ui-combo-host');
  const menu = document.createElement('div');
  menu.className = 'ui-select-menu ui-combo-menu';
  menu.setAttribute('role', 'listbox');
  menu.hidden = true;
  input.after(menu);

  let items = [];
  let activeIdx = -1;
  let diam = false;

  function sumber() {
    const dl = document.getElementById(listId);
    return dl ? Array.from(dl.options).map((o) => o.value).filter(Boolean) : [];
  }
  function render() {
    const q = input.value.trim().toLowerCase();
    const semua = sumber().filter((v) => !q || v.toLowerCase().includes(q));
    items = semua.slice(0, MAKS);
    menu.textContent = '';
    items.forEach((v, i) => {
      const el = document.createElement('div');
      el.className = 'ui-select-opt';
      el.setAttribute('role', 'option');
      el.dataset.idx = String(i);
      const t = document.createElement('span');
      t.textContent = v;
      el.append(t);
      menu.append(el);
    });
    if (semua.length > MAKS) {
      const more = document.createElement('div');
      more.className = 'ui-combo-more';
      more.textContent = (semua.length - MAKS) + ' lainnya. Ketik untuk menyaring.';
      menu.append(more);
    }
    return items.length > 0;
  }
  function place() {
    menu.style.left = input.offsetLeft + 'px';
    menu.style.top = (input.offsetTop + input.offsetHeight + 4) + 'px';
    menu.style.width = input.offsetWidth + 'px';
    host.classList.remove('is-up');
    const r = input.getBoundingClientRect();
    const need = Math.min(menu.scrollHeight, 280) + 12;
    if (window.innerHeight - r.bottom < need && r.top > need) {
      menu.style.top = 'auto';
      menu.style.bottom = (host.offsetHeight - input.offsetTop + 4) + 'px';
    } else {
      menu.style.bottom = '';
    }
  }
  function setActive(i) {
    const els = menu.querySelectorAll('.ui-select-opt');
    if (!els.length) { activeIdx = -1; return; }
    activeIdx = Math.max(0, Math.min(els.length - 1, i));
    els.forEach((el, k) => el.classList.toggle('is-active', k === activeIdx));
    els[activeIdx].scrollIntoView({ block: 'nearest' });
  }
  function open() {
    if (input.disabled || input.readOnly) return;
    if (openInstance && openInstance !== api) openInstance.close();
    if (!render()) { close(); return; }
    menu.hidden = false;
    place();
    input.setAttribute('aria-expanded', 'true');
    openInstance = api;
    activeIdx = -1;
  }
  function close() {
    if (menu.hidden) return;
    menu.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    if (openInstance === api) openInstance = null;
  }
  function choose(i) {
    const v = items[i];
    if (v == null) return;
    input.value = v;
    close();
    diam = true; // 'input' buatan ini jangan membuka menu lagi
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    diam = false;
  }
  const api = { close };

  input.addEventListener('focus', open);
  input.addEventListener('click', () => { if (menu.hidden) open(); });
  input.addEventListener('input', () => { if (!diam) open(); });
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', (e) => {
    if (menu.hidden) {
      if (e.key === 'ArrowDown') { e.preventDefault(); open(); setActive(0); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(activeIdx + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(activeIdx - 1); }
    else if (e.key === 'Enter' && activeIdx >= 0) { e.preventDefault(); e.stopPropagation(); choose(activeIdx); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') close();
  });
  menu.addEventListener('mousedown', (e) => e.preventDefault()); // jangan curi fokus dari input
  menu.addEventListener('click', (e) => {
    const el = e.target.closest('.ui-select-opt');
    if (el) choose(Number(el.dataset.idx));
  });
  menu.addEventListener('mousemove', (e) => {
    const el = e.target.closest('.ui-select-opt');
    if (el) setActive(Number(el.dataset.idx));
  });
}

function scan(root) {
  if (root.matches && root.matches(SELECTOR)) enhance(root);
  if (root.querySelectorAll) root.querySelectorAll(SELECTOR).forEach(enhance);
}

function install() {
  if (window.__uiComboInstalled) return;
  window.__uiComboInstalled = true;
  scan(document.body);
  new MutationObserver((muts) => {
    for (const m of muts) m.addedNodes.forEach((n) => { if (n.nodeType === 1) scan(n); });
  }).observe(document.body, { childList: true, subtree: true });
  document.addEventListener('mousedown', (e) => {
    if (openInstance && !e.target.closest('.ui-combo-host')) openInstance.close();
  });
  window.addEventListener('resize', () => { if (openInstance) openInstance.close(); });
}

if (document.body) install();
