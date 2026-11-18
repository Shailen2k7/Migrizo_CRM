// =============================================================================
// META CAPI — queue runner. Called every minute by Supabase cron
// (x-cron-secret header, same as the other jobs). Sends due events from
// meta_capi_events to Meta, one request per event. See lib/meta-capi.ts.
//
// Does nothing unless META_CAPI_ENABLED=true and the dataset id + token are set.
// =============================================================================

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { capiConfigFromEnv, processQueue, defaultDeps, type CapiStore, type QueueRow, type LeadMeta } from '@/lib/meta-capi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function supabaseStore(admin: any): CapiStore {
  return {
    async due(limit) {
      const { data, error } = await admin.from('meta_capi_events')
        .select('id, lead_id, event_name, event_time, attempt_count')
        .eq('status', 'pending').lte('next_attempt_at', new Date().toISOString())
        .order('next_attempt_at', { ascending: true }).limit(limit);
      if (error) { console.error('[meta-capi] queue read failed:', error.message); return []; }
      return (data || []) as QueueRow[];
    },
    async claim(id) {
      // Lease the row for 2 minutes so an overlapping run cannot send it too.
      const { data } = await admin.from('meta_capi_events')
        .update({ next_attempt_at: new Date(Date.now() + 120_000).toISOString(), updated_at: new Date().toISOString() })
        .eq('id', id).eq('status', 'pending').lte('next_attempt_at', new Date().toISOString())
        .select('id');
      return !!data?.length;
    },
    async lead(leadId) {
      const { data } = await admin.from('leads').select('meta_leadgen_id, meta_lead_created_at').eq('id', leadId).maybeSingle();
      return (data as LeadMeta | null) ?? null;
    },
    async update(id, patch) {
      const { error } = await admin.from('meta_capi_events').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
      if (error) console.error('[meta-capi] row update failed:', id, error.message);
    },
  };
}

async function handle(req: Request) {
  const secret = req.headers.get('x-cron-secret');
  if (!secret || secret !== process.env.CRON_SECRET) return NextResponse.json({ ok: false }, { status: 401 });

  const cfg = capiConfigFromEnv();
  if (!cfg.enabled) return NextResponse.json({ ok: true, enabled: false, note: 'META_CAPI_ENABLED is off — nothing sent' });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ ok: false, reason: 'not_configured' }, { status: 500 });
  const admin = createClient(url, key, { auth: { persistSession: false } });

  const summary = await processQueue(supabaseStore(admin), cfg, defaultDeps, { limit: 25, budgetMs: 18000 });
  return NextResponse.json({ ok: true, ...summary });
}

export const POST = handle;
export const GET = handle;
