<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# PNM-BARE TOOLS — Next.js Migration

Migrating from a multi-page plain HTML/JS repo (parent folder) to Next.js
App Router, module by module. The old repo stays live/untouched while this
runs on a separate `react-migrate` branch.

## Context
- Internal tools for Pionir Group sales/marketing ops (three entities: PNM, SMY, METO)
- Backend: Supabase — currently a free-tier project under a personal email;
  a company self-hosted Supabase is being set up separately and will replace it later
- Old modules to migrate: `crud-produk.html`, `konversian.html`, `generatesph.html`,
  `dashboard.html`, `stok.html`, `cari_set.html`
- Auth: custom email/password gate against Supabase Auth REST endpoints
  (not supabase-js), session cached in `localStorage` under `pnm_auth_session`
  — must stay compatible with the old HTML/JS pages during the transition
  since users may bounce between old and new pages

## Migration pattern (established in `app/stok/`)
- All Supabase calls go through `lib/supabase-config.ts` (env-based URL/key),
  `lib/auth-session.ts` (login/refresh/session), and `lib/supabase-rest.ts`
  (generic GET/insert/RPC helpers) — never hardcode the URL/key or call
  `fetch` to Supabase directly from a page
- Env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (see `.env.local.example`)
- Each old `<module>.html` becomes `app/<module>/page.tsx` + a plain
  `<module>.css` file imported into it (not a CSS module, since the old
  stylesheets use `:root` custom properties)
- Migrate one module at a time; keep the React version behavior-identical
  to the old HTML/JS page before adding anything new

## Migration status
- `app/stok/` — migrated (pilot)
- `app/page.tsx` — module hub (was `index.html`), links to `/stok` for the migrated
  module and to the old relative `.html` paths for everything not yet migrated
- Everything else (`crud-produk`, `konversian`, `generatesph`, `dashboard`,
  `cari_set`) — not yet migrated, still plain HTML/JS

## Principles
- Don't re-architect the Supabase backend (RPC-for-writes, view/REST-for-reads
  pattern) as part of this migration — that's a separate concern
- Keep the abstraction layer thin enough that switching to the self-hosted
  Supabase later is an env var change, not a code change
