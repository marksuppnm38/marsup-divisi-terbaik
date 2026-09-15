import { MODULES } from '../home/markup.js';
import { CRUD_PRODUK_SUBNAV } from '../crud-produk/subnav.js';
import { KONVERSIAN_SUBNAV } from '../konversian/subnav.js';

// design.md explicitly calls MODULES[].color + the hand-drawn per-module
// <svg> icons the PRIMARY anti-pattern to remove ("Icons are one neutral
// color in a bordered square. The glyph differentiates modules, not the
// color."). Rather than duplicate a whole second module list here (which
// would just create a THIRD place list-of-modules facts can drift out of
// sync — home/markup.js's MODULES is already the single source of truth
// for id/title/url/migrated), this file imports MODULES and layers its own
// neutral Tabler-icon mapping on top, keyed by id. Add an entry here
// whenever a new module is added to home/markup.js's MODULES array.
const NAV_ICONS = {
  'konversian':    'ti-arrows-left-right',
  'stok':          'ti-package',
  'crud-produk':   'ti-database',
  'dashboard':     'ti-layout-dashboard',
  'kompres-pdf':   'ti-file-zip',
  'export-gambar': 'ti-photo',
};

// UPDATE (sesi lanjutan -- "double nav" fix): module -> its own SUBNAV
// registry, same single-source-of-truth reasoning as NAV_ICONS above.
// A module with no entry here just renders with no accordion (dashboard/
// stok/kompres-pdf/export-gambar all currently have none -- single-view
// pages, nothing to sub-navigate). Add an entry here the day a module
// grows its own tabs/views, same moment its subnav.js gets created.
const SUBNAV = {
  'crud-produk': CRUD_PRODUK_SUBNAV,
  'konversian': KONVERSIAN_SUBNAV,
};

function navSubitemHtml(mod, sub, activeSub) {
  const isActive = sub.id === activeSub;
  return `
    <a class="pw-nav-subitem${isActive ? ' active' : ''}" href="/${mod.id}/${sub.id}" data-module="${mod.id}" data-sub="${sub.id}" title="${sub.title}">
      <i class="ti ${sub.icon}"></i>
      <span>${sub.title}</span>
    </a>`;
}

function navItemHtml(mod, activeId, activeSub) {
  const icon = NAV_ICONS[mod.id] || 'ti-square';
  const isActive = mod.id === activeId;
  const subnav = SUBNAV[mod.id];
  // Legacy (not-yet-migrated) modules keep their real .html href so the nav
  // works as a plain link for them too (full navigation, same as today) —
  // migrated ones use a real clean path ('/module', no '#'); nav.js
  // intercepts clicks on these (see its wireInternalNav()) and hands them
  // to router.js's pushState-based navigate() instead of letting the
  // browser reload, so behavior stays identical to the old hash-nav.
  const itemHtml = `
    <a class="pw-nav-item${isActive ? ' active' : ''}" href="${mod.url}" title="${mod.title}">
      <i class="ti ${icon}"></i>
      <span>${mod.title}</span>
      ${subnav ? `<i class="ti ti-chevron-down pw-nav-item-chevron${isActive ? ' open' : ''}"></i>` : ''}
    </a>`;
  // Sub-items only render (in the DOM at all) while their module is
  // active -- there's no separate expand/collapse click state to manage,
  // it's driven purely by the route itself. Simpler than a real
  // accordion widget, and it means the accordion can never show a sub-item
  // list for a module you're not even looking at.
  const subHtml = (subnav && isActive)
    ? `<div class="pw-nav-subitems">${subnav.map((s) => navSubitemHtml(mod, s, activeSub)).join('')}</div>`
    : '';
  return itemHtml + subHtml;
}

export function navMarkup(activeId, activeSub) {
  const items = MODULES.map((mod) => navItemHtml(mod, activeId, activeSub)).join('');
  return `
    <div class="pw-nav-brand">
      <img src="/assets/logo-mark-pnm.png" alt="PNM" width="43" height="18">
      <span>Pionir Workspaces</span>
    </div>
    <button class="pw-nav-collapse-btn" id="pwNavCollapseBtn" type="button" aria-label="Collapse sidebar" aria-expanded="true" title="Collapse sidebar">
      <i class="ti ti-chevron-left"></i>
    </button>
    <div class="pw-nav-search-wrap">
      <i class="ti ti-search"></i>
      <input class="pw-nav-search-input" id="pwNavSearchInput" type="text" placeholder="Search" autocomplete="off" spellcheck="false">
      <kbd class="pw-nav-search-kbd">/</kbd>
      <div class="pw-nav-search-results" id="pwNavSearchResults" hidden></div>
    </div>
    <div class="pw-nav-eyebrow">Modules</div>
    <div class="pw-nav-list">${items}</div>
    <div class="pw-nav-user">
      <div class="pw-nav-user-avatar" id="pwNavAvatar">?</div>
      <div class="pw-nav-user-name" id="pwNavUserName">—</div>
      <button class="pw-nav-theme-toggle" id="pwNavThemeToggle" type="button" aria-label="Toggle theme">
        <i class="ti ti-sun" id="pwNavThemeIcon"></i>
      </button>
      <button class="pw-nav-theme-toggle" id="pwNavLogoutBtn" type="button" aria-label="Keluar" title="Keluar">
        <i class="ti ti-logout"></i>
      </button>
    </div>`;
}

// design.md's "Top bar" component — meant to be rendered BY EACH PAGE inside
// its own .pw-content area (not by the nav itself, since the breadcrumb/
// actions are page-specific). Exported here since it's part of the same
// shared visual language and pages porting to it shouldn't have to
// hand-write the breadcrumb markup structure themselves.
export function topbarMarkup(moduleTitle, actionsHtml = '') {
  return `
    <div class="pw-topbar">
      <div class="pw-topbar-crumb"><strong>${moduleTitle}</strong></div>
      <div class="pw-topbar-actions">${actionsHtml}</div>
    </div>`;
}

// Flat search index used by nav.js's real search box: every module PLUS
// every module's sub-items, each with the full path needed to navigate
// straight there. Built here (not in nav.js) because it's pure data
// derived from MODULES + SUBNAV, which already live in this file.
export function buildSearchIndex() {
  const rows = [];
  MODULES.forEach((mod) => {
    rows.push({
      label: mod.title,
      sublabel: null,
      hash: mod.url, // already either '/id' (migrated) or '/page.html' (not) -- see navItemHtml, same value used there
      icon: NAV_ICONS[mod.id] || 'ti-square',
      migrated: mod.migrated,
    });
    const subnav = SUBNAV[mod.id];
    if (subnav) {
      subnav.forEach((s) => {
        rows.push({
          label: s.title,
          sublabel: mod.title,
          hash: `/${mod.id}/${s.id}`,
          icon: s.icon,
          migrated: mod.migrated,
        });
      });
    }
  });
  return rows;
}