// =============================================================================
// LEAD CV — GET /api/lead/cv/<leadId>
// -----------------------------------------------------------------------------
// The drawer's "Download CV" button. One promise: THIS BUTTON ALWAYS GIVES
// YOU SOMETHING, in a format that opens.
//
//   1. The archived original (leads.cv_path — permanent, survives purges),
//      served under a proper filename WITH an extension.
//   2. No archive? The newest CV-looking file still sitting in their chat.
//   3. No file at all (deleted by the old pipeline)? A clean, printable
//      document rendered from the extracted profile text — because the
//      CONTENT was never lost, only the bytes. Opens as a page; ⌘P saves
//      it as a PDF.
//   4. Truly nothing? A plain-English explanation, never a bare 404.
//
// ?download=1 forces a save dialog for the file cases.
// =============================================================================
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin, type SupabaseClient } from '@supabase/supabase-js';
import { toBuffer, safeFilename, mimeFor, fileResponse } from '@/lib/whatsapp/serve-bytes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function withExtension(name: string, path: string): string {
  return safeFilename({ name, path }).filename;
}

/**
 * Reads the object and sends it as a Buffer with a real Content-Length.
 * A 0-byte object counts as a MISS (returns null) so the caller falls through
 * to the next source instead of handing the founder an empty file — that empty
 * file was the whole "hell pain".
 */
async function serveFile(
  admin: SupabaseClient, path: string, name: string, download: boolean
): Promise<NextResponse | null> {
  const { data: file, error } = await admin.storage.from('whatsapp-media').download(path);
  if (error || !file) return null;
  const buf = await toBuffer(file);
  if (buf.byteLength === 0) return null;
  const { filename, ext } = safeFilename({ name, path, buf, fallback: 'CV' });
  return fileResponse(buf, filename, mimeFor(ext), download);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ leadId: string }> }
) {
  const { leadId } = await params;
  const download = req.nextUrl.searchParams.get('download') === '1';

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse('Unauthorized', { status: 401 });
  const { data: member } = await supabase
    .from('workspace_members').select('workspace_id').eq('user_id', user.id).maybeSingle();
  if (!member) return new NextResponse('Forbidden', { status: 403 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return new NextResponse('Not configured', { status: 500 });
  const admin = createAdmin(url, key, { auth: { persistSession: false } });

  const { data: lead } = await admin
    .from('leads')
    .select('id, workspace_id, full_name, phone, cv_path, cv_name, profile_text, profile_ai, profile_received_at')
    .eq('id', leadId)
    .maybeSingle();
  if (!lead || lead.workspace_id !== member.workspace_id) {
    return new NextResponse('Not found', { status: 404 });
  }
  const displayName = (lead.full_name || 'Lead').trim();

  // ── 1. the permanent archive ──────────────────────────────────────────────
  if (lead.cv_path) {
    const res = await serveFile(admin, lead.cv_path, lead.cv_name || `${displayName} — CV`, download);
    if (res) return res;
  }

  // ── 2. the newest CV-looking file still in their chat ─────────────────────
  // Covers every lead judged BEFORE the archive existed whose file survived.
  // Found via the lead's conversation, documents first, then photos.
  const { data: convs } = await admin
    .from('whatsapp_conversations').select('id')
    .eq('workspace_id', lead.workspace_id).eq('lead_id', lead.id);
  const convIds = (convs ?? []).map((c) => c.id);
  if (convIds.length) {
    const { data: files } = await admin
      .from('whatsapp_messages')
      .select('media_path, media_name, media_type, created_at')
      .in('conversation_id', convIds)
      .eq('direction', 'in')
      .in('media_type', ['document', 'image'])
      .not('media_path', 'is', null)
      .order('created_at', { ascending: false })
      .limit(10);
    const pick = (files ?? []).find((f) => f.media_type === 'document') ?? (files ?? [])[0];
    if (pick?.media_path) {
      const res = await serveFile(
        admin, pick.media_path,
        pick.media_name || `${displayName} — CV`, download);
      if (res) {
        // SELF-HEALING RECORD: this lead predates the archive — copy the file
        // into it right now, so the record survives future chat purges. Best
        // effort; the serve above already succeeded either way.
        try {
          const ext = (pick.media_path.split('.').pop() || 'pdf').toLowerCase();
          const dest = `${lead.workspace_id}/cv/${lead.id}/${Date.now()}.${ext}`;
          const { error: cpErr } = await admin.storage.from('whatsapp-media').copy(pick.media_path, dest);
          if (!cpErr) {
            await admin.from('leads').update({
              cv_path: dest,
              cv_name: withExtension(pick.media_name || `${displayName} — CV`, pick.media_path),
            }).eq('id', lead.id);
          }
        } catch { /* record stays chat-backed until next click */ }
        return res;
      }
    }
  }

  // ── 3. the extracted profile, as a proper printable document ──────────────
  if (lead.profile_text) {
    const ai = (lead.profile_ai ?? {}) as { eligible?: boolean; route?: string; reason?: string };
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const bodyHtml = esc(lead.profile_text)
      .split('\n')
      .map((line) => {
        const t = line.trim();
        if (/^#{1,3}\s/.test(t)) return `<h2>${t.replace(/^#{1,3}\s*/, '')}</h2>`;
        if (/^[-*]\s/.test(t)) return `<li>${t.replace(/^[-*]\s*/, '')}</li>`;
        if (!t) return '';
        return `<p>${t}</p>`;
      })
      .join('\n')
      .replace(/(<li>[\s\S]*?<\/li>)(?!\s*<li>)/g, '<ul>$1</ul>');

    const html = `<!doctype html><html><head><meta charset="utf-8">
<title>${esc(displayName)} — CV (extracted)</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; max-width: 720px; margin: 40px auto; padding: 0 24px; color: #1a1a1a; line-height: 1.65; }
  .top { border-bottom: 2px solid #1a1a1a; padding-bottom: 14px; margin-bottom: 20px; }
  .top h1 { margin: 0 0 4px; font-size: 26px; }
  .top .meta { color: #555; font-size: 13px; }
  .verdict { background: ${ai.eligible ? '#f0f9f2' : '#fdf6ec'}; border: 1px solid ${ai.eligible ? '#bfe3c8' : '#f0dcb8'}; border-radius: 8px; padding: 10px 14px; font-size: 13.5px; margin-bottom: 22px; }
  h2 { font-size: 15px; text-transform: uppercase; letter-spacing: .06em; border-bottom: 1px solid #ddd; padding-bottom: 4px; margin: 26px 0 8px; }
  p, li { font-size: 14px; margin: 6px 0; }
  .note { margin-top: 34px; padding-top: 12px; border-top: 1px dashed #ccc; color: #888; font-size: 11.5px; }
  @media print { .note { display: none; } body { margin: 0 auto; } }
</style></head><body>
  <div class="top">
    <h1>${esc(displayName)}</h1>
    <div class="meta">${esc(lead.phone || '')}${lead.profile_received_at ? ` · CV received ${new Date(lead.profile_received_at).toLocaleDateString('en-IN')}` : ''} · Migrizo CRM record</div>
  </div>
  ${ai.route || ai.reason ? `<div class="verdict"><b>${ai.eligible ? 'Eligible' : 'Not eligible'}${ai.route ? ` — ${esc(ai.route)}` : ''}.</b> ${esc(ai.reason || '')}</div>` : ''}
  ${bodyHtml}
  <div class="note">Extracted by Migrizo CRM from the CV the lead sent on WhatsApp. The original file is no longer stored; this document preserves its full content. Press ⌘P / Ctrl+P to save as PDF.</div>
<script>${download ? 'window.print();' : ''}</script>
</body></html>`;
    return new NextResponse(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, max-age=300' },
    });
  }

  // ── 4. honestly nothing ───────────────────────────────────────────────────
  return new NextResponse(
    `No CV on record for ${displayName} yet. When they send one on WhatsApp (PDF, Word or photos), it is judged automatically and archived here permanently.`,
    { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
  );
}
