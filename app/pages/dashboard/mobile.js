// Dashboard di HP (<=640px): halaman ini panjang (9 bagian), jadi dipasang baris chip "lompat ke bagian"
// yang menempel di atas (pola Material 3 scrollable chips). Hanya membaca section yang sudah ada di markup.js,
// tidak mengubah data atau logika dashboard. Tampilannya ada di mobile.css dan hanya aktif di <=640px.

const SHORT = {
  'Booking tracker': 'Booking',
  'Perlu dikerjakan': 'Perlu dikerjakan',
  'Tujuh hari terakhir': '7 hari',
  'Stok berisiko habis': 'Stok',
  'Populasi set terkirim': 'Populasi',
  'Distributor terbaik': 'Distributor',
  'Kebutuhan customer ke SKU': 'Kebutuhan',
  'Laporan dan unduhan': 'Laporan',
};

export function installDashboardMobile(container) {
  const main = container?.querySelector('main');
  if (!main || main.querySelector('.db-jump')) return () => {};

  const sections = [...main.querySelectorAll('section.db-row')].map((sec, i) => {
    const title = sec.querySelector('.db-sec-title')?.textContent.trim() || '';
    sec.id = sec.id || `db-s-${i}`;
    return { sec, title };
  }).filter(s => s.title);

  const nav = document.createElement('nav');
  nav.className = 'db-jump';
  nav.setAttribute('aria-label', 'Lompat ke bagian');
  nav.innerHTML = sections.map(s =>
    `<button type="button" class="db-chip" data-target="${s.sec.id}">${SHORT[s.title] || s.title}</button>`).join('');
  (main.querySelector('.db-head') || main.firstElementChild)?.after(nav);

  const chips = [...nav.querySelectorAll('.db-chip')];
  const setActive = id => chips.forEach(c => {
    const on = c.dataset.target === id;
    c.classList.toggle('is-active', on);
    if (on) c.setAttribute('aria-current', 'true'); else c.removeAttribute('aria-current');
    if (on && nav.scrollWidth > nav.clientWidth) c.scrollIntoView({ inline: 'center', block: 'nearest' });
  });

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  nav.addEventListener('click', e => {
    const c = e.target.closest('.db-chip');
    if (!c) return;
    document.getElementById(c.dataset.target)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    setActive(c.dataset.target);
  });

  let io = null;
  if ('IntersectionObserver' in window) {
    io = new IntersectionObserver(entries => {
      const hit = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (hit) setActive(hit.target.id);
    }, { rootMargin: '-56px 0px -60% 0px' });
    sections.forEach(s => io.observe(s.sec));
  }
  setActive(sections[0]?.sec.id);

  // Grafik 7 hari: bila label nilai panjang (mis. "Rp 14.093.792.600"), kolom 1/7 lebar layar tak muat.
  // Tandai supaya CSS memutar labelnya. Dirender ulang tiap data/metrik berubah, jadi diamati.
  const trend = main.querySelector('#db-trend');
  const markLong = () => {
    const cols = trend?.querySelector('.tr-cols');
    if (cols) cols.classList.toggle('is-long', [...cols.querySelectorAll('.tr-val')].some(v => v.textContent.trim().length > 6));
  };
  const mo = trend ? new MutationObserver(markLong) : null;
  mo?.observe(trend, { childList: true, subtree: true, characterData: true });
  markLong();

  return () => { io?.disconnect(); mo?.disconnect(); nav.remove(); };
}