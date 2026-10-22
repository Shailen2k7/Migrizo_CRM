// =============================================================================
// AI COO v3 — chat endpoint with live database tools.
// The model answers in an agentic loop: it can call search_notes, count_leads,
// period_metrics, get_lead, … (lib/ai/tools.ts) against the live CRM, then
// writes the answer — streaming text the whole way, plus `status` events so
// the screen shows what it's searching. History persists in ai_messages.
// =============================================================================
import { createClient } from '@/lib/supabase/server';
import { buildSystemPrompt } from '@/lib/ai/context';
import { TOOL_DEFS, runTool, toolStatusLabel } from '@/lib/ai/tools';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_ROUNDS = 6;       // tool round-trips per answer
const TIME_BUDGET_MS = 90_000; // stop calling tools near the platform limit

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

  const system = await buildSystemPrompt(supabase, workspaceId);

  // Clean history: non-empty alternating turns starting with the user.
  const turns: Anthropic.Beta.Messages.BetaMessageParam[] = [];
  for (const m of [...history, { role: 'user' as const, content: message }]) {
    const text = (m.content || '').trim();
    if (!text || (m.role !== 'user' && m.role !== 'assistant')) continue;
    const last = turns[turns.length - 1];
    if (last && last.role === m.role && typeof last.content === 'string') last.content = `${last.content}\n\n${text}`;
    else if (turns.length === 0 && m.role === 'assistant') continue;
    else turns.push({ role: m.role, content: text });
  }

  const model = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';
  const client = new Anthropic({ apiKey });
  const encoder = new TextEncoder();
  const t0 = Date.now();
  let full = '';
  const sse = (evt: unknown) => encoder.encode(`data: ${JSON.stringify(evt)}\n\n`);
  const say = (text: string) => sse({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } });

  // Buffered until the browser attaches; status events show tool progress.
  const buffered: Uint8Array[] = [];
  let ctrl: ReadableStreamDefaultController<Uint8Array> | null = null;
  const push = (chunk: Uint8Array) => { if (ctrl) ctrl.enqueue(chunk); else buffered.push(chunk); };
  let pendingBreak = false; // insert a paragraph break when text resumes after tools
  const emitText = (text: string) => {
    if (pendingBreak) { pendingBreak = false; if (full && !/\n\s*$/.test(full)) { full += '\n\n'; push(say('\n\n')); } }
    full += text; push(say(text));
  };
  const emitStatus = (text: string) => push(sse({ type: 'status', text }));

  const startStream = () => {
    const s = client.beta.messages.stream({
      model,
      max_tokens: 16000,
      system,
      messages: turns,
      tools: TOOL_DEFS as Anthropic.Beta.Messages.BetaToolUnion[],
      output_config: { effort: 'medium' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    s.on('text', (delta) => emitText(delta));
    return s;
  };

  // First request: wait until the API accepts it, so configuration errors
  // (credit, key, model) come back as one clear JSON message, not a dead stream.
  let stream = startStream();
  try {
    await new Promise<void>((resolve, reject) => {
      stream.on('connect', () => resolve());
      stream.on('error', (e) => reject(e));
    });
  } catch (err) {
    const { status, text } = explain(err, model);
    await supabase.from('ai_messages').delete().eq('conversation_id', conversationId).eq('role', 'user').eq('content', message);
    return new Response(JSON.stringify({ error: text, detail: (err as Error)?.message?.slice(0, 300) }), { status });
  }

  const out = new ReadableStream<Uint8Array>({
    start(controller) {
      ctrl = controller;
      for (const c of buffered.splice(0)) controller.enqueue(c);

      (async () => {
        for (let round = 0; round <= MAX_ROUNDS; round++) {
          const final = await stream.finalMessage();

          if (final.stop_reason === 'refusal') { emitText('\n\n_This question was declined by the AI safety check. Try rephrasing it._'); break; }
          if (final.stop_reason === 'max_tokens') { emitText('\n\n_(Answer cut short — ask me to continue.)_'); break; }

          // Server-side pause: push the turn back and continue.
          if (final.stop_reason === 'pause_turn') {
            turns.push({ role: 'assistant', content: final.content });
            stream = startStream();
            continue;
          }

          const toolUses = final.content.filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === 'tool_use');
          if (final.stop_reason !== 'tool_use' || toolUses.length === 0) break; // done

          // Budget guard: answer with what we have instead of timing out.
          const outOfBudget = round >= MAX_ROUNDS - 1 || Date.now() - t0 > TIME_BUDGET_MS;

          turns.push({ role: 'assistant', content: final.content });
          const results: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = [];
          for (const tu of toolUses) {
            if (outOfBudget) {
              results.push({ type: 'tool_result', tool_use_id: tu.id, is_error: true, content: 'Tool budget exhausted — answer now with the data already gathered, and say what could not be checked.' });
              continue;
            }
            emitStatus(toolStatusLabel(tu.name, tu.input));
            const result = await runTool(supabase, workspaceId, tu.name, tu.input);
            results.push({ type: 'tool_result', tool_use_id: tu.id, content: result });
          }
          turns.push({ role: 'user', content: results });
          emitStatus('Writing the answer…');
          pendingBreak = true;
          stream = startStream();
        }
      })()
        .catch((err) => emitText(`${full ? '\n\n' : ''}⚠️ ${explain(err, model).text}`))
        .finally(async () => {
          emitStatus('');
          if (full.trim()) {
            await supabase.from('ai_messages').insert({ conversation_id: conversationId!, workspace_id: workspaceId, role: 'assistant', content: full });
          }
          try { controller.close(); } catch { /* already closed */ }
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
