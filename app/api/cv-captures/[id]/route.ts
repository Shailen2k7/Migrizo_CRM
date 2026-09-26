// =============================================================================
// CV CAPTURES — one CV that arrived on WhatsApp.
// -----------------------------------------------------------------------------
//   GET  /api/cv-captures/<id>   opens the original file the person sent
//   POST /api/cv-captures/<id>   { action: 'approve', leadId? }  save it as the lead's CV
//                                { action: 'dismiss' }           no CV needed from this file
//
// Used by the "CVs from WhatsApp" popup on the Leads page. The files live in
// the WhatsApp app's private bucket, and the captures table is written by its
// webhook, so every read and write here goes through the service role — after
// the caller's session and workspace have been checked.
// =============================================================================
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin, type SupabaseClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RELAY_BUCKET = 'relay-media';

interface CaptureRow {
  id: string; workspace_id: string; message_id: string; lead_id: string | null;
  status: string; file_name: string | null; file_mime: string | null; extracted_text: string | null;
}
type Authorised = { ok: true; userId: string; workspaceId: string; admin: SupabaseClient };
type Refused = { ok: false; status: number; message: string };

async function authorise(): Promise<Authorised | Refused> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401, message: 'Unauthorized' };
  const { data: member } = await supabase
    .from('workspace_members').select('workspace_id').eq('user_id', user.id).maybeSingle();
  if (!member) return { ok: false, status: 403, message: 'Forbidden' };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { ok: false, status: 500, message: 'Not configured' };
  return {
    ok: true,
    userId: user.id,
    workspaceId: (member as { workspace_id: string }).workspace_id,
    admin: createAdmin(url, key, { auth: { persistSession: false } }) as SupabaseClient,
  };
}

async function loadCapture(admin: SupabaseClient, id: string, workspaceId: string): Promise<CaptureRow | null> {
  const { data } = await admin
    .from('relay_cv_captures')
    .select('id, workspace_id, message_id, lead_id, status, file_name, file_mime, extracted_text')
    .eq('id', id).maybeSingle();
  const row = data as CaptureRow | null;
  return row && row.workspace_id === workspaceId ? row : null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await authorise();
  if (!a.ok) return new NextResponse(a.message, { status: a.status });

  const capture = await loadCapture(a.admin, id, a.workspaceId);
  if (!capture) return new NextResponse('Not found', { status: 404 });

  const { data: msgData } = await a.admin
    .from('relay_messages').select('media_path, media_url, media_name, media_mime')
    .eq('id', capture.message_id).maybeSingle();
  const msg = msgData as {
    media_path: string | null; media_url: string | null;
    media_name: string | null; media_mime: string | null;
  } | null;
  if (!msg?.media_path && !msg?.media_url) {
    return new NextResponse('The file is no longer stored.', { status: 404 });
  }

  // A document too large for our bucket was never copied, but WhatsApp still
  // holds it — so the reviewer can open it either way.
  let buf: ArrayBuffer;
  if (msg.media_path) {
    const { data: file, error } = await a.admin.storage.from(RELAY_BUCKET).download(msg.media_path);
    if (error || !file) return new NextResponse('The file could not be opened.', { status: 404 });
    buf = await file.arrayBuffer();
  } else {
    try {
      const res = await fetch(msg.media_url as string, { signal: AbortSignal.timeout(25_000) });
      if (!res.ok) return new NextResponse('The file could not be opened.', { status: 404 });
      buf = await res.arrayBuffer();
    } catch {
      return new NextResponse('The file could not be opened.', { status: 404 });
    }
  }
  const name = (msg.media_name || capture.file_name || 'document').replace(/["\r\n]/g, '');
  return new NextResponse(buf, {
    headers: {
      'Content-Type': msg.media_mime || capture.file_mime || 'application/octet-stream',
      'Content-Length': String(buf.byteLength),
      'Content-Disposition': `inline; filename="${name}"`,
      'Cache-Control': 'private, max-age=300',
    },
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await authorise();
  if (!a.ok) return NextResponse.json({ ok: false, error: a.message }, { status: a.status });

  const body = await req.json().catch(() => ({})) as { action?: string; leadId?: string };
  const capture = await loadCapture(a.admin, id, a.workspaceId);
  if (!capture) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });

  const now = new Date().toISOString();

  if (body.action === 'dismiss') {
    await a.admin.from('relay_cv_captures')
      .update({ status: 'dismissed', resolved_at: now, resolved_by: a.userId }).eq('id', capture.id);
    return NextResponse.json({ ok: true, status: 'dismissed' });
  }

  if (body.action !== 'approve') {
    return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
  }

  const leadId = body.leadId || capture.lead_id;
  if (!leadId) return NextResponse.json({ ok: false, error: 'Choose which lead this CV belongs to.' }, { status: 400 });
  if (!capture.extracted_text) {
    return NextResponse.json({ ok: false, error: 'This file has no readable text — open it and attach it to the lead by hand.' }, { status: 400 });
  }

  const { data: leadData } = await a.admin
    .from('leads').select('id, workspace_id, profile_text, profile_received').eq('id', leadId).maybeSingle();
  const lead = leadData as { id: string; workspace_id: string; profile_text: string | null; profile_received: string | null } | null;
  if (!lead || lead.workspace_id !== a.workspaceId) {
    return NextResponse.json({ ok: false, error: 'Lead not found.' }, { status: 404 });
  }

  const { error } = await a.admin.from('leads').update({
    profile_text: capture.extracted_text,
    profile_received: lead.profile_received === 'both' ? 'both' : 'cv',
    profile_received_at: now,
    cv_name: capture.file_name,
  }).eq('id', lead.id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  try {
    await a.admin.from('activity').insert({
      workspace_id: a.workspaceId, user_id: a.userId, lead_id: lead.id,
      action: 'cv_profile_saved',
      meta: {
        source: 'whatsapp_review',
        message_id: capture.message_id,
        filename: capture.file_name,
        replaced: !!lead.profile_text,
        previous_text: lead.profile_text || null,
      },
    });
  } catch { /* best-effort */ }

  await a.admin.from('relay_cv_captures')
    .update({ status: 'approved', lead_id: lead.id, resolved_at: now, resolved_by: a.userId }).eq('id', capture.id);

  return NextResponse.json({ ok: true, status: 'approved' });
}
