// =============================================================================
// AI COO v2 — chat endpoint.
// Streams Claude's answer (SSE pass-through) over a FULL system snapshot, and
// persists both sides of the conversation so history survives forever.
// =============================================================================
import { createClient } from '@/lib/supabase/server';
import { buildSystemPrompt } from '@/lib/ai/context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface ChatMessage { role: 'user' | 'assistant'; content: string; }

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'AI not configured. Add ANTHROPIC_API_KEY in Netlify environment variables.' }), { status: 501 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  const { data: membership } = await supabase.from('workspace_members')
    .select('workspace_id').eq('user_id', user.id).limit(1).single();
  if (!membership) return new Response(JSON.stringify({ error: 'No workspace' }), { status: 403 });
  const workspaceId = membership.workspace_id;

  let body: { conversationId?: string | null; message?: string };
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'Bad JSON' }), { status: 400 }); }
  const message = (body.message || '').trim();
  if (!message) return new Response(JSON.stringify({ error: 'Empty message' }), { status: 400 });

  // Load or create the conversation.
  let conversationId = body.conversationId || null;
  if (conversationId) {
    const { data: conv } = await supabase.from('ai_conversations').select('id').eq('id', conversationId).eq('user_id', user.id).maybeSingle();
    if (!conv) conversationId = null;
  }
  if (!conversationId) {
    const { data: conv, error } = await supabase.from('ai_conversations')
      .insert({ workspace_id: workspaceId, user_id: user.id, title: message.slice(0, 60) })
      .select('id').single();
    if (error || !conv) return new Response(JSON.stringify({ error: 'Could not start conversation' }), { status: 500 });
    conversationId = conv.id;
  }

  // Prior turns (last 20) so the model has the thread's own history too.
  const { data: prior } = await supabase.from('ai_messages')
    .select('role, content').eq('conversation_id', conversationId)
    .order('created_at', { ascending: true }).limit(40);
  const history: ChatMessage[] = ((prior || []) as ChatMessage[]).slice(-20);

  // Persist the user's message immediately.
  await supabase.from('ai_messages').insert({ conversation_id: conversationId, workspace_id: workspaceId, role: 'user', content: message });
  await supabase.from('ai_conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId);

  // Build the full-system prompt (includes dossiers matched to this question).
  const system = await buildSystemPrompt(supabase, workspaceId, message);

  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
      max_tokens: 2500,
      system,
      messages: [...history, { role: 'user', content: message }],
      stream: true,
    }),
  });
  if (!anthropicRes.ok || !anthropicRes.body) {
    const detail = await anthropicRes.text().catch(() => '');
    return new Response(JSON.stringify({ error: `AI request failed (${anthropicRes.status})`, detail: detail.slice(0, 300) }), { status: 502 });
  }

  // Pass the SSE stream through while accumulating the full answer; persist on end.
  const decoder = new TextDecoder();
  let full = '';
  const persisted = { done: false };
  async function persist() {
    if (persisted.done || !full.trim()) return;
    persisted.done = true;
    await supabase.from('ai_messages').insert({ conversation_id: conversationId!, workspace_id: workspaceId, role: 'assistant', content: full });
  }
  const stream = anthropicRes.body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      const text = decoder.decode(chunk, { stream: true });
      for (const line of text.split('\n')) {
        if (!line.startsWith('data:')) continue;
        try {
          const evt = JSON.parse(line.slice(5).trim());
          if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') full += evt.delta.text;
        } catch { /* partial line */ }
      }
    },
    async flush() { await persist(); },
  }));

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'x-conversation-id': conversationId!,
    },
  });
}
