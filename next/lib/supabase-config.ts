// Central place for Supabase connection info.
//
// Every module talks to Supabase through this file (and through
// lib/supabase-rest.ts / lib/auth-session.ts), never with a hardcoded
// URL/key inline. When the company's self-hosted Supabase is ready,
// swapping backends is just changing these two env vars — no page code
// needs to change.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
export const SUPABASE_ANON_KEY = process.env
  .NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // Loud failure in dev instead of silently calling undefined/undefined.
  // (Won't throw at build time for server components without env access,
  // only when actually read on the client.)
  if (typeof window !== "undefined") {
    console.error(
      "Supabase env vars are missing. Copy .env.local.example to .env.local and fill them in."
    );
  }
}
