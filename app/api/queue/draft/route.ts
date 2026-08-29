// ============================================================================
// FOLLOW-UP DRAFT — POST /api/queue/draft
// When a rep marks a lead "not right now", Claude writes the short
// message that keeps the door open. Returns plain text the rep can edit.
// ============================================================================
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!apiKey) return NextResponse.json({ ok: false, reason: 'no_api_key' });

  let body: { leadId?: string; outcome?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }); }
  if (!body.leadId) return NextResponse.json({ error: 'Missing leadId' }, { status: 400 });

  const { data: lead } = await supabase
    .from('leads')
    .select('full_name, visa_type, last_note, stage')
    .eq('id', body.leadId)
    .single();
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

  const system = `You write short follow-up messages for a UK immigration consultancy (Migrizo).

Rules:
- 2 sentences maximum, under 45 words.
- Warm, human, never pushy. No hard sell, no urgency tricks.
- Acknowledge the timing isn't right, leave the door genuinely open.
- Use the person's first name only.
- No emojis, no greetings like "Dear", no sign-off block.
Return ONLY the message text.`;

  const ctx = `Name: ${lead.full_name}\nInterested in: ${lead.visa_type || 'UK visa options'}\nLast note: ${lead.last_note || 'none'}\nThey said: not the right time at the moment.`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
        max_tokens: 300,
        system,
        messages: [{ role: 'user', content: ctx }],
      }),
    });
    if (!res.ok) return NextResponse.json({ ok: false, reason: 'api_error' });
    const data = await res.json();
    const text = (data.content || [])
      .filter((c: { type: string }) => c.type === 'text')
      .map((c: { text: string }) => c.text).join('').trim();
    return NextResponse.json({ ok: true, message: text });
  } catch {
    return NextResponse.json({ ok: false, reason: 'exception' });
  }
}
