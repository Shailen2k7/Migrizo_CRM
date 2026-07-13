// AI COO v2 — conversation history: list, fetch messages, delete.
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  const id = new URL(req.url).searchParams.get('id');
  if (id) {
    const { data: msgs } = await supabase.from('ai_messages')
      .select('role, content, created_at').eq('conversation_id', id)
      .order('created_at', { ascending: true }).limit(200);
    return NextResponse.json({ ok: true, messages: msgs || [] });
  }
  const { data: convs } = await supabase.from('ai_conversations')
    .select('id, title, updated_at').eq('user_id', user.id)
    .order('updated_at', { ascending: false }).limit(50);
  return NextResponse.json({ ok: true, conversations: convs || [] });
}

export async function DELETE(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ ok: false }, { status: 400 });
  await supabase.from('ai_conversations').delete().eq('id', id).eq('user_id', user.id);
  return NextResponse.json({ ok: true });
}
