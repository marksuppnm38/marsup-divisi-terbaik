# Pionir Workspaces — design.md

Design reference for the SPA migration (`app/router.js` + `app/pages/*`). Read this before touching any page's markup or CSS. Goal: one consistent, flat, neutral design language across every module — currently each page (home, dashboard, stok, crud-produk, konversian, kompres-pdf, export-gambar) has drifted its own color/spacing/component choices. This doc is the single source of truth to converge on. Design only — no implementation is assumed done just because it's described here; check the actual file before assuming a page matches this spec.

## Philosophy

Vercel-flat, not "AI app" flat. The tell of an AI-generated UI is saturated per-item colors (a different hex per card/module), bright status pills, gradients, glass/blur, and decorative icon backgrounds. The fix is restraint:

- **One accent color**, used only for links, focus rings, and a single primary button per screen. Never for icon backgrounds, status, or category differentiation.
- **No color-per-module.** Icons are one neutral color in a bordered square. The glyph differentiates modules, not the color.
- **No saturated status pills.** Status = a 6px dot + `text-secondary` label.
- **No shadows, no blur, no gradients, no glass.** Flat surfaces + hairline borders only.
- **Numbers are monospace.** IDs, prices, counts, timestamps — anything tabular. This is one of the highest-leverage "looks like a real product" signals and is currently inconsistent across pages.
- **Scan first, decorate never.** Every spacing/sizing decision below exists to make lists and tables scannable at a glance — dense internal ops tool, not a marketing page.

## Color tokens

Reconcile with `pnm-universal.css` `:root` block — that file currently has its own token set (`--bg`, `--accent: #007AFF`, etc.) and `home/style.css` maintains a second, separate token set (`--home-*`) specifically to avoid collisions (see COORD LOG comments in both files). Long-term, these should merge into one token set consumed by every page. Until that merge happens, any new/edited page must use these exact values so they end up compatible:

```css
--bg:             #FAFAFA;   /* dark: #0A0A0A */
--surface:        #FFFFFF;   /* dark: #111111 */
--surface-raised:  #FFFFFF;  /* dark: #171717 — cards, popovers */
--border:         #EAEAEA;   /* dark: #1F1F1F */
--border-strong:  #D4D4D4;   /* dark: #333333 */
--text:           #0A0A0A;   /* dark: #EDEDED */
--text-secondary: #666666;   /* dark: #A1A1A1 */
--text-muted:     #8F8F8F;   /* dark: #6E6E6E */
--accent:         #0070F3;   /* dark: #3291FF — sparingly, links/focus/one CTA */
--success-dot:    #3BA55D;
--warning-dot:    #C99A2C;
--danger-dot:     #E5484D;
--radius:         8px;
--radius-lg:      12px;      /* cards, modals */
--font-sans:      'Geist', 'Inter', system-ui, sans-serif;
--font-mono:      'Geist Mono', 'JetBrains Mono', monospace;
```

Do not introduce a new hex value for a new page without adding it here first. If `MODULES[].color` (in `app/pages/home/markup.js`) or the `.stat-card.blue/.green/.purple/.warning/.danger` variants (in `dashboard.html`) are still present when you read this, they are the primary anti-pattern to remove — replace with the neutral icon-square treatment below, not a new color.

## Spacing scale

8pt grid, applied consistently — the current pages mix ad hoc px values (`14px`, `18px`, `22px` paddings appear side by side in `home/style.css`). Pick from this scale only:

```
4   — icon-to-label gap, inline badge padding
8   — tight stack gap (label above value), row internal padding
12  — card internal padding (compact), grid gap between cards
16  — card internal padding (default), section internal gap
24  — gap between distinct sections on a page
32  — page top padding, gap between header and content
48  — gap between major page regions (e.g. hero and grid, rare)
```

Rules for scanning:

- **Table/list rows**: fixed row height, 36–40px, vertical padding `8px` top/bottom — never let row height vary with content length.
- **Card grids**: `gap: 12px` between cards, consistent regardless of grid density. Card internal padding `16px`, not `20px`+ — the current `home/style.css` `.module-card` uses `20px`, tighten to `16px` when this page is next touched.
- **Left-align everything scannable** (table cells, list labels). Right-align only numeric columns and status/action columns. Never center body text.
- **One weight of divider**: `0.5px solid var(--border)` between rows/ sections. Don't mix full 1px borders and 0.5px hairlines on the same page.
- **Breadcrumb/header row height**: 48–52px fixed, across every page, so the vertical rhythm doesn't jump when navigating between modules.
- **Label above value pattern** (metric cards, form fields): label `11px` uppercase `text-muted`, `4px` gap, value below. Don't put label and value on the same line — harder to scan a column of them.

## Typography

```
h1  18px / 600   — page title (one per page, in top bar or page header)
h2  15px / 600   — section heading
h3  13.5px / 500 — card title, table header
body 13px / 400  — default UI text
small 11.5-12px  — meta, timestamps, muted labels
mono 12.5px      — IDs, prices, counts, dates — always var(--font-mono)
```

Sentence case everywhere — labels, buttons, headings, table headers. No Title Case, no ALL CAPS except the 11px uppercase eyebrow labels (e.g. above metric card values), which get `letter-spacing: 0.04em`.

## Iconography

- Single icon library across the whole app (Tabler outline recommended — matches what's used in this doc's own mockups). Replace the hand-drawn inline `<svg>` icons currently defined per-module in `app/pages/home/markup.js` (`MODULES[].icon`) with library icons.
- 18–20px, one color (`var(--text)` or `var(--text-secondary)`), sitting in a 32px square with `0.5px solid var(--border)` and `7px` radius. No tinted/ colored background per icon — that's the single biggest visual tell to fix on the home hub.
- Status is never conveyed by icon color. Use the dot + label pattern instead.

## Component patterns

### Shared sidebar nav

Lives in `app/shell.html` (or a new `app/pages/_nav/` component rendered once and left mounted), not per-page. 200px wide, `var(--surface)` bg, right border `0.5px solid var(--border)`. Contents top to bottom: logo mark + product name, search trigger (with `/` mono hint), "Modules" eyebrow label, module list (icon + label, active = `var(--fill-ghost-selected)` bg

- 600 weight, inactive = `text-secondary`), user row pinned to bottom with avatar + name + theme toggle. Collapses to 48px icon-only rail under 768px, or a slide-over — same component, not a separate mobile nav.

Applies even to pages not yet ported to hash routes (`migrated: false` in `MODULES`) — this is a static shell wrapper, doesn't require the router work to be finished first. Decouples visual consistency from migration progress.

### Top bar (per page, inside the sidebar layout)

48–52px, breadcrumb on the left (`Workspaces / <module name>`, `text-muted` with `text` on the current crumb), page-specific actions on the right (search, filter, one primary button max). Replaces the full brand header currently duplicated in `dashboard.html`, `crud-produk.html`, `stok.html`.

### Cards (module grid, metric cards)

`var(--surface)` bg, `0.5px solid var(--border)`, `var(--radius)` (8px) for metric cards, `var(--radius-lg)` (12px) for module/content cards. No shadow. Hover: border → `var(--border-strong)`, optional `translateY(-1px)`, nothing else animates (no color shift, no scale on the whole card).

### Status

6px circle + `text-secondary` 11.5px label. Dot color from the semantic tokens above (`--success-dot` etc.) — never a filled colored badge/pill background.

### Tables

Hairline row dividers only (no zebra striping, no cell borders). Header row: `11px` uppercase `text-muted`, bottom border `0.5px solid var(--border-strong)`. Numeric/mono columns right-aligned. Row hover: `var(--fill-ghost-hover)` bg, no border change.

### Buttons

One primary (filled `var(--text)` bg / inverted text) per screen max. Everything else is secondary (transparent bg, `0.5px solid var(--border- strong)`, hover → `var(--surface-raised)`). No colored buttons outside the danger case (destructive actions only, using `--danger-dot` family).

## Anti-patterns present in the current codebase (fix on sight)

- `MODULES[].color` per-module hex + `background:${mod.color}1a` tinted icon tiles — `app/pages/home/markup.js`.
- `.card-badge` green "Live" pill with solid background — `app/pages/home/style.css`.
- `.stat-card.blue/.green/.purple/.warning/.danger` color-coded stat cards — `dashboard.html`.
- Glass/blur modal styles still present in `pnm-universal.css` (`.modal- overlay` — see its own COORD LOG comment about the blur-vs-solid merge).
- Two parallel, disconnected token sets (`pnm-universal.css` `:root` vs. `home/style.css` `--home-*`) — kept separate on purpose to avoid a class- collision bug, but that's a stopgap, not the target end state.

## Migration checklist per module

When porting a module from static `.html` to an `app/pages/<name>/` SPA route, in this order:

1. Apply the shared sidebar + top bar layout first (structural).
2. Swap any hardcoded/per-module colors for the neutral token set above.
3. Swap hand-rolled icons for the shared icon library at the standard 32px square treatment.
4. Convert any colored status badges to the dot + label pattern.
5. Audit spacing against the 8pt scale — don't carry over ad hoc px values from the old page.
6. Convert IDs/prices/counts/dates to `var(--font-mono)`.
7. Only then wire up the actual route/JS logic — this doc is scoped to visual design, not the router mechanics in `map.md` / `visi-pionir-workspaces.md`.