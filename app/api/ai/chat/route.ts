import { createClient } from '@/lib/supabase/server';
import type { Lead, Payment, Activity } from '@/lib/types';
import { STAGE_META, MILESTONE_META, getStageMeta } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

function buildSystemPrompt(
  userName: string,
  workspaceName: string,
  leads: Lead[],
  payments: Payment[],
  activity: Activity[]
): string {
  const now = new Date();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dayMs = 86400000;

  // KPIs
  const totalLeads = leads.length;
  const active = leads.filter((l) => !['won', 'junk'].includes(l.stage)).length;
  const won = leads.filter((l) => l.stage === 'won').length;
  const lost = leads.filter((l) => l.stage === 'junk').length;
  const winRate = won + lost > 0 ? (won / (won + lost) * 100).toFixed(0) : 'N/A';

  const overdueFu = leads.filter((l) =>
    l.next_follow_up && new Date(l.next_follow_up).getTime() < now.getTime() && !['won', 'junk'].includes(l.stage)
  );
  const followUpsToday = leads.filter((l) => {
    if (!l.next_follow_up) return false;
    const t = new Date(l.next_follow_up).getTime();
    return t >= today.getTime() && t < today.getTime() + dayMs;
  });
  const hot = leads.filter((l) => l.score >= 75 && !['won', 'junk'].includes(l.stage));
  const stale = leads.filter((l) => {
    const last = new Date(l.last_note_at || l.updated_at).getTime();
    return now.getTime() - last > 7 * dayMs && !['won', 'junk'].includes(l.stage);
  });

  // Pipeline by stage
  const byStage: Record<string, number> = {};
  leads.forEach((l) => { byStage[l.stage] = (byStage[l.stage] || 0) + 1; });

  // Revenue
  // Revenue reads the SAME source as the Dashboard & Payments tab (lead-level
  // amount_paid, excluding leads hidden from payments) so the AI never quotes a
  // figure that disagrees with the rest of the CRM.
  const payLeads = leads.filter((l) => !l.hidden_from_payments);
  const collected = payLeads.reduce((s, l) => s + (l.amount_paid || 0), 0);
  const outstanding = payLeads.reduce((s, l) => s + Math.max(0, (l.amount_total || 0) - (l.amount_paid || 0)), 0);
  const overdueLeads = payLeads.filter((l) => (l.amount_overdue || 0) > 0);
  const overduePayAmt = overdueLeads.reduce((s, l) => s + (l.amount_overdue || 0), 0);

  // Format INR
  const inr = (n: number) => {
    if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)}Cr`;
    if (n >= 100000) return `₹${(n / 100000).toFixed(2)}L`;
    if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
    return `₹${n}`;
  };

  // Lead table — compact format for token efficiency
  const leadRows = leads.slice(0, 80).map((l) => {
    const fu = l.next_follow_up ? new Date(l.next_follow_up).toISOString().slice(0, 10) : '—';
    const isOverdue = l.next_follow_up && new Date(l.next_follow_up).getTime() < now.getTime() && !['won', 'junk'].includes(l.stage);
    const fuLabel = isOverdue ? `${fu} ⚠OVERDUE` : fu;
    const lastTouch = l.last_note_at ? new Date(l.last_note_at).toISOString().slice(0, 10) : '—';
    const note = (l.last_note || '').slice(0, 100);
    return `• ${l.full_name} | ${getStageMeta(l.stage).label} | score:${l.score} | ${l.visa_type || '—'} | fu:${fuLabel} | last:${lastTouch} | paid:${inr(l.amount_paid)} | note:"${note}"`;
  }).join('\n');

  // Recent activity (last 15)
  const recentActivity = activity.slice(0, 15).map((a) => {
    const t = new Date(a.created_at).toISOString().slice(0, 16).replace('T', ' ');
    return `• ${t} - ${a.action} ${a.lead_id ? `(lead ${a.lead_id.slice(0, 8)})` : ''}`;
  }).join('\n');

  return `You are the AI Chief Operating Officer for ${userName}'s visa consultancy CRM (Migrizo). You have full, live access to their workspace data and your job is to give specific, actionable advice — not generic platitudes.

## Business context
- Migrizo is a visa consultancy in India helping clients secure UK / Canada / Australia / Germany visas (primarily UK Global Talent, UK Innovator Founder, UK Skilled Worker, Canada Express Entry, Australia 491, Germany Blue Card)
- Stages: New inquiry → Attempted → Connected → Qualified → Consultation → Proposal sent → Partial pay → Closed won / Closed lost
- Payments are milestone-based: Kickstart 25% → Profile Building 35% → Endorsement 25% → Post-Approval 15%
- Currency is INR (₹). Amounts in the data are rupees, not paise.
- Average revenue per closed-won client: ₹2.5–3 lakh

## Your tone
- Direct. No "consider doing X". Say "Call Aditi Sharma — proposal sent Monday, decision expected Friday".
- Reference specific clients by name from the data below.
- Use numbers, not vibes. ("3 leads at proposal stage for 5+ days" not "you have some stalled proposals")
- Brief. Bullets and short paragraphs. Markdown is supported.
- When asked to draft messages (emails, WhatsApp, SMS), produce ready-to-send copy. No placeholder text like [Client Name] — fill it in from the data.
- Push back honestly when you see real problems. Don't sugarcoat.

## Live workspace snapshot — ${now.toISOString()}

WORKSPACE: ${workspaceName}
TOTAL LEADS: ${totalLeads} (${active} active, ${won} won, ${lost} lost — ${winRate}% win rate)
REVENUE COLLECTED: ${inr(collected)}
OUTSTANDING (billed, not yet paid): ${inr(outstanding)}
OVERDUE PAYMENTS: ${overdueLeads.length} client(s) totalling ${inr(overduePayAmt)}

URGENCY METRICS:
- ${overdueFu.length} overdue follow-ups
- ${followUpsToday.length} follow-ups due today
- ${hot.length} hot leads (score ≥75) in active pipeline
- ${stale.length} stale leads (no activity 7+ days)

PIPELINE BY STAGE:
${Object.entries(byStage).map(([s, n]) => `- ${STAGE_META[s as keyof typeof STAGE_META]?.label || s}: ${n}`).join('\n')}

ALL LEADS (most recent first, format: name | stage | score | visa | fu=next follow-up | last=last touched | paid=amount | note):
${leadRows}
${leads.length > 80 ? `\n... and ${leads.length - 80} more leads (older).` : ''}

RECENT ACTIVITY:
${recentActivity || '(none)'}

When answering questions, ground every claim in the data above. If asked something the data doesn't support, say so directly.`;
}

export async function POST(req: Request) {
  // Auth check
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  // API key check
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({
      error: 'AI not configured. Add ANTHROPIC_API_KEY in Netlify environment variables (no NEXT_PUBLIC_ prefix).'
    }), { status: 500 });
  }

  // Parse body
  let body: { messages: ChatMessage[]; model?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return new Response(JSON.stringify({ error: 'No messages provided' }), { status: 400 });
  }

  // Fetch user's workspace and live data
  const { data: member } = await supabase
    .from('workspace_members')
    .select('workspace_id, role, workspaces:workspaces(*)')
    .eq('user_id', user.id)
    .single();

  if (!member || !member.workspaces) {
    return new Response(JSON.stringify({ error: 'Workspace not found' }), { status: 404 });
  }

  const workspace = member.workspaces as unknown as { id: string; name: string };

  const [{ data: leads }, { data: payments }, { data: activity }] = await Promise.all([
    supabase.from('leads').select('*').order('updated_at', { ascending: false }),
    supabase.from('payments').select('*').order('created_at', { ascending: false }),
    supabase.from('activity').select('*').order('created_at', { ascending: false }).limit(50),
  ]);

  const userName = (user.user_metadata?.full_name as string) || (user.email || '').split('@')[0];
  const systemPrompt = buildSystemPrompt(
    userName,
    workspace.name,
    (leads || []) as Lead[],
    (payments || []) as Payment[],
    (activity || []) as Activity[]
  );

  // Call Anthropic with streaming
  const model = body.model || 'claude-sonnet-4-6';
  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      system: systemPrompt,
      messages: body.messages,
      stream: true,
    }),
  });

  if (!anthropicRes.ok || !anthropicRes.body) {
    const errText = await anthropicRes.text().catch(() => 'Unknown error');
    return new Response(JSON.stringify({ error: `Claude API error: ${errText}` }), { status: anthropicRes.status });
  }

  // Transform Anthropic's SSE stream into a simple text stream of token deltas
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const stream = new ReadableStream({
    async start(controller) {
      const reader = anthropicRes.body!.getReader();
      let buf = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            try {
              const evt = JSON.parse(payload);
              if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
                controller.enqueue(encoder.encode(evt.delta.text));
              }
            } catch {
              // Ignore non-JSON or partial frames; the buffer will pick them up next round
            }
          }
        }
        controller.close();
      } catch (e) {
        controller.error(e);
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
