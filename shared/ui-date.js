// ui-date.js — pemilih tanggal custom pengganti kalender bawaan <input type="date">.
//
// CARA KERJA (progressive enhancement, sama dengan ui-select.js):
//  - <input type="date" class="f-date"> asli TETAP ada (disembunyikan) dan tetap sumber kebenaran: nilainya selalu
//    "YYYY-MM-DD" atau "". Kode lama yang membaca/menulis `input.value` atau mendengar 'change' tidak berubah.
//  - Di sebelahnya dibuat tombol (teks "03 Sep 2029" / "Pilih tanggal") + kalender (Senin sebagai hari pertama).
//  - `input.value = x` dari JS menyegarkan tombol (setter dibungkus). `disabled` diikuti lewat MutationObserver.
//  - Pilih tanggal / Hapus -> set value -> dispatch 'input' + 'change' (bubbles).
// Keyboard: tombol membuka kalender; panah = pindah hari, PageUp/PageDown = pindah bulan, Enter = pilih, Esc = tutup.

const SELECTOR = 'input[type="date"].f-date';
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const BULAN_PENDEK = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const HARI = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];

let openInstance = null;

const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => y + '-' + pad(m + 1) + '-' + pad(d);
function parse(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || '');
  if (!m) return null;
  const y = +m[1], mo = +m[2] - 1, d = +m[3];
  const dt = new Date(y, mo, d);
  return dt.getFullYear() === y && dt.getMonth() === mo && dt.getDate() === d ? { y, m: mo, d } : null;
}
const tampil = (p) => pad(p.d) + ' ' + BULAN_PENDEK[p.m] + ' ' + p.y;

function enhance(input) {
  if (input.dataset.uiDate === '1') return;
  input.dataset.uiDate = '1';

  const wrap = document.createElement('div');
  wrap.className = 'ui-select ui-select-field ui-date';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ui-select-btn';
  btn.setAttribute('aria-haspopup', 'dialog');
  btn.setAttribute('aria-expanded', 'false');
  const ikon = document.createElement('i');
  ikon.className = 'ti ti-calendar ui-select-icon';
  const label = document.createElement('span');
  label.className = 'ui-select-label';
  btn.append(label, ikon);

  const pop = document.createElement('div');
  pop.className = 'ui-select-menu ui-date-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Pilih tanggal');
  pop.hidden = true;

  wrap.append(btn, pop);
  input.parentNode.insertBefore(wrap, input);
  input.classList.add('ui-select-native');
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');

  let view = { y: 0, m: 0 };  // bulan yang ditampilkan
  let fokus = { y: 0, m: 0, d: 1 }; // hari yang disorot keyboard

  function refresh() {
    const p = parse(input.value);
    label.textContent = p ? tampil(p) : 'Pilih tanggal';
    btn.classList.toggle('is-placeholder', !p);
    btn.disabled = input.disabled;
  }

  function render() {
    const sel = parse(input.value);
    const now = new Date();
    const first = new Date(view.y, view.m, 1);
    const offset = (first.getDay() + 6) % 7; // Senin = 0
    const jumlah = new Date(view.y, view.m + 1, 0).getDate();
    let html = '<div class="ud-head">' +
      '<button type="button" class="ud-nav" data-nav="-1" aria-label="Bulan sebelumnya"><i class="ti ti-chevron-left"></i></button>' +
      '<div class="ud-title" aria-live="polite">' + BULAN[view.m] + ' ' + view.y + '</div>' +
      '<button type="button" class="ud-nav" data-nav="1" aria-label="Bulan berikutnya"><i class="ti ti-chevron-right"></i></button></div>' +
      '<div class="ud-grid" role="grid">' + HARI.map((h) => '<span class="ud-dow">' + h + '</span>').join('');
    for (let i = 0; i < offset; i++) html += '<span></span>';
    for (let d = 1; d <= jumlah; d++) {
      const cls = ['ud-day'];
      if (sel && sel.y === view.y && sel.m === view.m && sel.d === d) cls.push('is-selected');
      if (now.getFullYear() === view.y && now.getMonth() === view.m && now.getDate() === d) cls.push('is-today');
      if (fokus.y === view.y && fokus.m === view.m && fokus.d === d) cls.push('is-focus');
      html += '<button type="button" class="' + cls.join(' ') + '" data-d="' + d + '" tabindex="-1">' + d + '</button>';
    }
    html += '</div><div class="ud-foot"><button type="button" class="ud-link" data-act="today">Hari ini</button>' +
      '<button type="button" class="ud-link" data-act="clear">Hapus</button></div>';
    pop.innerHTML = html;
  }

  function geser(dd, dm) {
    const t = new Date(fokus.y, fokus.m + dm, fokus.d + dd);
    fokus = { y: t.getFullYear(), m: t.getMonth(), d: t.getDate() };
    view = { y: fokus.y, m: fokus.m };
    render();
  }

  function set(v) {
    const berubah = input.value !== v;
    input.value = v;
    refresh();
    close();
    btn.focus();
    if (berubah) {
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function open() {
    if (input.disabled) return;
    if (openInstance && openInstance !== api) openInstance.close();
    const p = parse(input.value) || (() => { const n = new Date(); return { y: n.getFullYear(), m: n.getMonth(), d: n.getDate() }; })();
    view = { y: p.y, m: p.m };
    fokus = { y: p.y, m: p.m, d: p.d };
    render();
    wrap.classList.remove('is-right', 'is-up');
    pop.hidden = false;
    wrap.classList.add('is-open');
    if (pop.getBoundingClientRect().right > window.innerWidth - 8) wrap.classList.add('is-right');
    const r = btn.getBoundingClientRect();
    const need = pop.offsetHeight + 12;
    wrap.classList.toggle('is-up', window.innerHeight - r.bottom < need && r.top > need);
    btn.setAttribute('aria-expanded', 'true');
    openInstance = api;
  }
  function close() {
    if (pop.hidden) return;
    pop.hidden = true;
    wrap.classList.remove('is-open');
    btn.setAttribute('aria-expanded', 'false');
    if (openInstance === api) openInstance = null;
  }
  const api = { close };

  btn.addEventListener('click', () => (pop.hidden ? open() : close()));
  btn.addEventListener('keydown', (e) => {
    if (pop.hidden) {
      if (['ArrowDown', 'Enter', ' '].includes(e.key)) { e.preventDefault(); open(); }
      return;
    }
    const peta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [-7, 0], ArrowDown: [7, 0], PageUp: [0, -1], PageDown: [0, 1] };
    if (peta[e.key]) { e.preventDefault(); geser(...peta[e.key]); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); set(iso(fokus.y, fokus.m, fokus.d)); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') close();
  });
  pop.addEventListener('mousedown', (e) => e.preventDefault());
  pop.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav) {
      const t = new Date(view.y, view.m + Number(nav.dataset.nav), 1);
      view = { y: t.getFullYear(), m: t.getMonth() };
      fokus = { y: view.y, m: view.m, d: Math.min(fokus.d, new Date(view.y, view.m + 1, 0).getDate()) };
      render();
      return;
    }
    const day = e.target.closest('[data-d]');
    if (day) { set(iso(view.y, view.m, Number(day.dataset.d))); return; }
    const act = e.target.closest('[data-act]');
    if (act) {
      if (act.dataset.act === 'clear') set('');
      else { const n = new Date(); set(iso(n.getFullYear(), n.getMonth(), n.getDate())); }
    }
  });

  input.addEventListener('change', refresh);
  new MutationObserver(refresh).observe(input, { attributes: true, attributeFilter: ['disabled'] });
  // `input.value = x` dari JS tidak memicu event -> bungkus setter-nya
  const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  Object.defineProperty(input, 'value', {
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
  if (window.__uiDateInstalled) return;
  window.__uiDateInstalled = true;
  scan(document.body);
  new MutationObserver((muts) => {
    for (const m of muts) m.addedNodes.forEach((n) => { if (n.nodeType === 1) scan(n); });
  }).observe(document.body, { childList: true, subtree: true });
  document.addEventListener('mousedown', (e) => {
    if (openInstance && !e.target.closest('.ui-date')) openInstance.close();
  });
  window.addEventListener('resize', () => { if (openInstance) openInstance.close(); });
}

if (document.body) install();
