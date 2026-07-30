"use client";

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabase-config";

// Same localStorage key as the old HTML/JS tools, so a user who's already
// logged in from the old site (or another migrated page) stays logged in.
export const AUTH_STORAGE_KEY = "pnm_auth_session";

export type AuthSession = {
  access_token: string;
  refresh_token: string;
  expires_at: number; // unix seconds
};

export function saveAuthSession(data: {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
}) {
  const session: AuthSession = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
  };
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
}

export function clearAuthSession() {
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

export function readAuthSession(): AuthSession | null {
  try {
    return JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

export function decodeEmailFromToken(token: string): string | null {
  try {
    return JSON.parse(atob(token.split(".")[1])).email || null;
  } catch {
    return null;
  }
}

export async function loginWithPassword(email: string, password: string) {
  const res = await fetch(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ email, password }),
    }
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error_description || data.msg || "Login gagal");
  }
  return data as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
}

export async function refreshAuthSession(refreshToken: string) {
  const res = await fetch(
    `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ refresh_token: refreshToken }),
    }
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      data.error_description || data.msg || "Sesi habis, silakan masuk lagi."
    );
  }
  return data as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
}

/**
 * Resolves a usable access token: returns the cached one if still valid,
 * silently refreshes if it's expiring soon, or returns null if the user
 * needs to log in again.
 */
export async function resolveAccessToken(): Promise<{
  token: string | null;
  email: string | null;
  expiredMessage?: string;
}> {
  const saved = readAuthSession();
  if (!saved) return { token: null, email: null };

  if (saved.expires_at && saved.expires_at - Math.floor(Date.now() / 1000) > 60) {
    return { token: saved.access_token, email: decodeEmailFromToken(saved.access_token) };
  }

  try {
    const data = await refreshAuthSession(saved.refresh_token);
    saveAuthSession(data);
    return { token: data.access_token, email: decodeEmailFromToken(data.access_token) };
  } catch {
    clearAuthSession();
    return {
      token: null,
      email: null,
      expiredMessage: "Sesi kamu sudah habis, silakan masuk lagi.",
    };
  }
}
