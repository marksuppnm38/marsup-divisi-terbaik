import { MODULES } from '../home/markup.js';

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

function navItemHtml(mod, activeId) {
  const icon = NAV_ICONS[mod.id] || 'ti-square';
  const isActive = mod.id === activeId;
  // Legacy (not-yet-migrated) modules keep their real .html href so the nav
  // works as a plain link for them too (full navigation, same as today) —
  // migrated ones use the #hash so router.js's existing hashchange handling
  // takes over, no extra JS needed here.
  return `
    <a class="pw-nav-item${isActive ? ' active' : ''}" href="${mod.url}">
      <i class="ti ${icon}"></i>
      <span>${mod.title}</span>
    </a>`;
}

export function navMarkup(activeId) {
  const items = MODULES.map((mod) => navItemHtml(mod, activeId)).join('');
  return `
    <div class="pw-nav-brand">
      <span>Pionir Workspaces</span>
    </div>
    <div class="pw-nav-search" id="pwNavSearch">
      <i class="ti ti-search"></i>
      <span>Search</span>
      <kbd>/</kbd>
    </div>
    <div class="pw-nav-eyebrow">Modules</div>
    <div class="pw-nav-list">${items}</div>
    <div class="pw-nav-user">
      <div class="pw-nav-user-avatar" id="pwNavAvatar">?</div>
      <div class="pw-nav-user-name" id="pwNavUserName">—</div>
      <button class="pw-nav-theme-toggle" id="pwNavThemeToggle" type="button" aria-label="Toggle theme">
        <i class="ti ti-sun" id="pwNavThemeIcon"></i>
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
      <div class="pw-topbar-crumb">Workspaces / <strong>${moduleTitle}</strong></div>
      <div class="pw-topbar-actions">${actionsHtml}</div>
    </div>`;
}