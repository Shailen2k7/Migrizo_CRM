// =============================================================================
// AI COO v2 — chat endpoint.
// Streams Claude's answer over a FULL system snapshot, and persists both sides
// of the conversation so history survives forever.
//
// Uses the official Anthropic SDK (Oct 2026). Every failure is translated into
// a plain sentence the screen shows — "AI request failed (400)" hid the real
// reason (usually the account's credit balance) from the person asking.
// =============================================================================
import { createClient } from '@/lib/supabase/server';
import { buildSystemPrompt } from '@/lib/ai/context';
import Anthropic from '@anthropic-ai/sdk';

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

  // Clean history: the API needs non-empty turns that alternate user/assistant
  // and start with the user. A reply that failed earlier leaves two user turns
  // in a row — merge them instead of sending a malformed conversation.
  const turns: Anthropic.Beta.Messages.BetaMessageParam[] = [];
  for (const m of [...history, { role: 'user' as const, content: message }]) {
    const text = (m.content || '').trim();
    if (!text || (m.role !== 'user' && m.role !== 'assistant')) continue;
    const last = turns[turns.length - 1];
    if (last && last.role === m.role) last.content = `${last.content as string}\n\n${text}`;
    else if (turns.length === 0 && m.role === 'assistant') continue;
    else turns.push({ role: m.role, content: text });
  }

  const model = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';
  const client = new Anthropic({ apiKey });
  const encoder = new TextEncoder();
  let full = '';
  const sse = (evt: unknown) => encoder.encode(`data: ${JSON.stringify(evt)}\n\n`);
  // The screen reads text deltas; a mid-answer problem is shown as text too.
  const say = (text: string) => sse({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } });

  // Text is captured from the first chunk: anything that arrives before the
  // browser starts reading is buffered, never dropped.
  const buffered: string[] = [];
  let ctrl: ReadableStreamDefaultController<Uint8Array> | null = null;
  const emit = (text: string) => { full += text; if (ctrl) ctrl.enqueue(say(text)); else buffered.push(text); };

  const stream = client.beta.messages.stream({
    model,
    max_tokens: 16000,
    system,
    messages: turns,
    output_config: { effort: 'medium' },
    // If the model declines for policy reasons, Anthropic retries on its
    // recommended substitute instead of returning a refusal.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  });
  stream.on('text', (delta) => emit(delta));

  // Wait until the API has accepted the request, so request errors (credit,
  // key, model) come back as one clear message rather than a broken stream.
  try {
    await new Promise<void>((resolve, reject) => {
      stream.on('connect', () => resolve());
      stream.on('error', (e) => reject(e));
    });
  } catch (err) {
    const { status, text } = explain(err, model);
    // Remove the unanswered question so a retry doesn't leave two in a row.
    await supabase.from('ai_messages').delete().eq('conversation_id', conversationId).eq('role', 'user').eq('content', message);
    return new Response(JSON.stringify({ error: text, detail: (err as Error)?.message?.slice(0, 300) }), { status });
  }

  const out = new ReadableStream<Uint8Array>({
    start(controller) {
      ctrl = controller;
      for (const t of buffered.splice(0)) controller.enqueue(say(t));
      stream.finalMessage()
        .then((final) => {
          if (final.stop_reason === 'refusal') emit('\n\n_This question was declined by the AI safety check. Try rephrasing it._');
          else if (final.stop_reason === 'max_tokens') emit('\n\n_(Answer cut short — ask me to continue.)_');
        })
        .catch((err) => emit(`${full ? '\n\n' : ''}⚠️ ${explain(err, model).text}`))
        .finally(async () => {
          if (full.trim()) {
            await supabase.from('ai_messages').insert({ conversation_id: conversationId!, workspace_id: workspaceId, role: 'assistant', content: full });
          }
          controller.close();
        });
    },
  });

  return new Response(out, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'x-conversation-id': conversationId!,
    },
  });
}

/** A failed call, in words the team can act on. */
function explain(err: unknown, model: string): { status: number; text: string } {
  if (err instanceof Anthropic.APIError) {
    const raw = (err.message || '').toLowerCase();
    if (raw.includes('credit balance')) {
      return { status: 402, text: 'The Anthropic account is out of credit. Top up at console.anthropic.com → Billing, then try again.' };
    }
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      return { status: 502, text: 'The ANTHROPIC_API_KEY in Netlify is invalid or revoked. Create a new key at console.anthropic.com and update it in Netlify → Environment variables.' };
    }
    if (err instanceof Anthropic.NotFoundError || raw.includes('model')) {
      return { status: 502, text: `The AI model "${model}" isn't available to this account. Remove or correct ANTHROPIC_MODEL in Netlify (leave it empty to use the default).` };
    }
    if (err instanceof Anthropic.RateLimitError) {
      return { status: 429, text: 'Too many AI requests right now — wait a minute and ask again.' };
    }
    if (err instanceof Anthropic.BadRequestError) {
      return { status: 502, text: `The AI rejected the request: ${err.message.replace(/^\d+\s*/, '').slice(0, 220)}` };
    }
    if ((err.status ?? 0) >= 500) {
      return { status: 503, text: 'The AI service is temporarily busy — please try again in a moment.' };
    }
    return { status: 502, text: `AI request failed (${err.status ?? 'error'}): ${err.message.slice(0, 200)}` };
  }
  return { status: 502, text: 'Could not reach the AI service — please try again.' };
}
