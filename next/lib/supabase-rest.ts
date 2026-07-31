"use client";

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabase-config";

/** GET a PostgREST table/view with a raw query string (e.g. "select=id,email&order=id.desc"). */
export async function restGet<T = unknown>(
  path: string,
  query: string,
  accessToken: string
): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}?${query}`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!res.ok) throw new Error(`GET ${path} failed (${res.status})`);
  return res.json();
}

/** POST (insert) a row into a PostgREST table. */
export async function restInsert(
  path: string,
  body: unknown,
  accessToken: string
): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`INSERT ${path} failed (${res.status})`);
}

/** Call a Postgres RPC function. Returns the raw Response so callers can
 * handle status codes (e.g. 401) themselves. */
export async function restRpc(
  fn: string,
  args: unknown,
  accessToken: string
): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(args),
  });
}

/** Same as restRpc, but for modules with no login gate — authenticates as
 * the anon role (same as what supabase-js does when there's no user session). */
export async function restRpcAnon(fn: string, args: unknown): Promise<Response> {
  return restRpc(fn, args, SUPABASE_ANON_KEY);
}
