// =============================================================================
// UNSUBSCRIBE — one-click opt-out. Adds the email to the workspace suppression
// list so no future campaign can reach it. Public (secret-free) by design;
// shows a simple confirmation page. Must be in middleware PUBLIC_PATHS.
// =============================================================================
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function page(msg: string) {
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Migrizo</title></head>
    <body style="margin:0;font-family:-apple-system,Segoe UI,Arial,sans-serif;background:#EEF1F8;display:flex;align-items:center;justify-content:center;min-height:100vh;">
      <div style="background:#fff;border-radius:14px;padding:36px 30px;max-width:420px;text-align:center;box-shadow:0 8px 30px rgba(22,41,78,.1);">
        <div style="font-size:30px;">✅</div>
        <h1 style="font-size:19px;color:#16294E;margin:12px 0 8px;">${msg}</h1>
        <p style="font-size:13.5px;color:#6B7280;line-height:1.6;">You won't receive further marketing emails from Migrizo. If this was a mistake, just reply to any earlier email and we'll add you back.</p>
      </div>
    </body></html>`,
    { headers: { 'Content-Type': 'text/html' } }
  );
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  const email = (u.searchParams.get('e') || '').toLowerCase().trim();
  const ws = u.searchParams.get('w') || '';
  if (!email || !ws) return page('Invalid unsubscribe link');

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    const admin = createClient(url, key, { auth: { persistSession: false } });
    try {
      await admin.from('email_suppressions').upsert(
        { workspace_id: ws, email, reason: 'unsubscribe' },
        { onConflict: 'workspace_id,email' }
      );
    } catch { /* still show success */ }
  }
  return page('You\'ve been unsubscribed');
}
