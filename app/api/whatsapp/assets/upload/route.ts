// =============================================================================
// PROCESS-PDF UPLOAD — POST /api/whatsapp/assets/upload  (multipart form)
// -----------------------------------------------------------------------------
// The permanent fix for "is not supported for Document media": instead of
// pasting a Drive/Dropbox share link (which serves an HTML preview page that
// Interakt rightly rejects), the admin uploads the actual PDF here. It lands
// in our own bucket; at send time the autopilot mints a 10-minute signed URL
// that always serves real application/pdf bytes.
//
// Stores settings.pdf_url = "storage:<path>" — resolveProcessPdf() in
// lib/whatsapp/outbound.ts understands both this form and plain https links.
// =============================================================================
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 15 * 1024 * 1024; // WhatsApp's document ceiling is 100MB; 15MB is plenty for a process doc

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, reason: 'unauthenticated' }, { status: 401 });
  const { data: member } = await supabase.from('workspace_members')
    .select('workspace_id').eq('user_id', user.id).limit(1).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, reason: 'no_workspace' }, { status: 403 });
  const { data: allowed } = await supabase.rpc('is_campaign_admin', { p_workspace_id: member.workspace_id });
  if (!allowed) return NextResponse.json({ ok: false, reason: 'not_campaign_admin' }, { status: 403 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ ok: false, reason: 'not_configured' }, { status: 500 });
  const admin = createAdmin(url, key, { auth: { persistSession: false } });

  let form: FormData;
  try { form = await req.formData(); } catch {
    return NextResponse.json({ ok: false, reason: 'expected multipart form data' }, { status: 400 });
  }
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, reason: 'no file in the "file" field' }, { status: 400 });
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > MAX_BYTES) {
    return NextResponse.json({ ok: false, reason: `file must be 1 byte – ${MAX_BYTES / 1024 / 1024}MB` }, { status: 400 });
  }
  // A PDF starts with %PDF — checked on the bytes, not the filename, because
  // the filename is exactly what fooled the old link-paste flow.
  if (bytes.subarray(0, 4).toString('latin1') !== '%PDF') {
    return NextResponse.json({ ok: false, reason: 'that file is not a PDF — export/print it to PDF first' }, { status: 400 });
  }

  const wsId = member.workspace_id as string;
  const path = `${wsId}/assets/process-${Date.now()}.pdf`;
  const { error: upErr } = await admin.storage.from('whatsapp-media')
    .upload(path, bytes, { contentType: 'application/pdf', upsert: false });
  if (upErr) return NextResponse.json({ ok: false, reason: upErr.message }, { status: 500 });

  // Point settings at the new asset; sweep the previous uploaded one so the
  // bucket holds exactly one process document.
  const { data: prev } = await admin.from('whatsapp_settings')
    .select('pdf_url').eq('workspace_id', wsId).maybeSingle();
  const { data: setRows, error: setErr } = await admin.from('whatsapp_settings')
    .update({ pdf_url: `storage:${path}`, updated_at: new Date().toISOString() })
    .eq('workspace_id', wsId)
    .select('workspace_id');
  if (setErr || !setRows?.length) {
    // No settings row = nothing to attach to. Clean up rather than orphan.
    await admin.storage.from('whatsapp-media').remove([path]);
    return NextResponse.json(
      { ok: false, reason: setErr?.message ?? 'WhatsApp is not set up yet — open WhatsApp → Settings once first' },
      { status: 500 });
  }
  if (prev?.pdf_url?.startsWith('storage:')) {
    await admin.storage.from('whatsapp-media').remove([prev.pdf_url.slice('storage:'.length)]);
  }

  return NextResponse.json({ ok: true, stored: `storage:${path}`, size: bytes.byteLength });
}
