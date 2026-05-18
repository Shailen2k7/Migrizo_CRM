import { createBrowserClient } from '@supabase/ssr';

// Build-safe placeholders. The real values come from Netlify env vars at runtime.
// If you see "Auth not configured" toasts in production, your env vars are missing.
const PLACEHOLDER_URL = 'https://placeholder.supabase.co';
const PLACEHOLDER_KEY = 'placeholder-anon-key';

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || PLACEHOLDER_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || PLACEHOLDER_KEY;

  if (typeof window !== 'undefined' && url === PLACEHOLDER_URL) {
    // Loud warning in the browser console so missing env vars are obvious post-deploy.
    console.error(
      '[Supabase] Missing env vars. Set NEXT_PUBLIC_SUPABASE_URL and ' +
      'NEXT_PUBLIC_SUPABASE_ANON_KEY in Netlify → Site configuration → Environment variables.'
    );
  }

  return createBrowserClient(url, key);
}
