// Newsletter signup from the public blog. Accepts a plain HTML form POST,
// stores the email via service role (RLS: no public policies on the table),
// then redirects back to the page with ?subscribed=1.
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const BASE = process.env.NEXT_PUBLIC_BLOG_URL || 'https://blog.migrizo.com';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function POST(req: NextRequest) {
  let email = '', back = `${BASE}/`;
  try {
    const form = await req.formData();
    email = String(form.get('email') || '').trim().toLowerCase();
    const b = String(form.get('back') || '');
    if (b.startsWith(BASE)) back = b; // only redirect within the blog domain
  } catch { /* fall through */ }

  if (EMAIL_RE.test(email) && email.length <= 254) {
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    // upsert: repeat signups are silently fine
    await admin.from('blog_subscribers').upsert({ email, source: 'blog' }, { onConflict: 'email', ignoreDuplicates: true });
  }
  const sep = back.includes('?') ? '&' : '?';
  return NextResponse.redirect(`${back}${sep}subscribed=1`, 303);
}
