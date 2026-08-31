"use client";

import { SupabaseClient, createClient } from "@supabase/supabase-js";

/**
 * The Supabase connection, or null when the app hasn't been given keys.
 *
 * Both branches are real, supported modes:
 *   - keys present  → shared cloud books, real accounts, live sync
 *   - keys absent   → local-only books in this browser, master-password gate
 *
 * Keeping the offline branch working means `npm run dev` needs no secrets, and
 * a deploy that is missing its env vars degrades to the old behaviour instead
 * of showing a blank screen.
 *
 * NEXT_PUBLIC_ vars are inlined into the browser bundle at build time, so they
 * must be read as complete literal expressions — `process.env[name]` does not
 * get substituted. Hence the explicit references below.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

export const supabaseConfigured = Boolean(url && anonKey);

/**
 * Why the configured values can't be used, in plain words — or null if fine.
 *
 * The two variables get pasted by hand into a Netlify form, so the realistic
 * failure is not "absent" but "wrong": the key pasted into the URL slot, a
 * copied `psql` connection string, a trailing newline. createClient() throws
 * on a malformed URL, which used to surface as an app frozen on its loading
 * spinner, so the problem is named here instead.
 */
export function supabaseConfigProblem(): string | null {
  if (!url || !anonKey) return null; // handled by missingSupabaseEnv()
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `NEXT_PUBLIC_SUPABASE_URL is not a valid URL ("${url.slice(0, 40)}…"). It should look like https://your-project-ref.supabase.co`;
  }
  if (!parsed.protocol.startsWith("http")) {
    return `NEXT_PUBLIC_SUPABASE_URL must start with https:// — got "${parsed.protocol}"`;
  }
  if (anonKey.length < 40) {
    return "NEXT_PUBLIC_SUPABASE_ANON_KEY looks too short to be a real key. Copy the anon/public key from Project Settings → API.";
  }
  if (/^https?:\/\//i.test(anonKey)) {
    return "NEXT_PUBLIC_SUPABASE_ANON_KEY contains a URL — the two variables look swapped.";
  }
  return null;
}

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!supabaseConfigured || supabaseConfigProblem()) return null;
  if (!client) {
    try {
      client = createClient(url!, anonKey!, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      });
    } catch {
      // Never let a bad value throw out of here — callers treat null as
      // "not connected" and show a diagnosable screen.
      return null;
    }
  }
  return client;
}

/** Which env vars are missing — surfaced in Settings so a bad deploy is diagnosable. */
export function missingSupabaseEnv(): string[] {
  const missing: string[] = [];
  if (!url) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!anonKey) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return missing;
}

/** Host of the configured project, for display. Never shows the key. */
export function supabaseHost(): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
