// =============================================================================
// FX — /api/fx?from=GBP&to=INR
// -----------------------------------------------------------------------------
// Today's exchange rate for a payment recorded in a currency other than the
// client's billing currency. Source: the European Central Bank reference
// rates via frankfurter.dev (free, no key), cached for 6 hours. If it cannot
// be reached, the CRM's standing rate (FX_TO_INR) is returned and marked as
// such — the person recording the payment always sees, and can edit, the rate.
// =============================================================================
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { fxStanding } from '@/lib/utils';

export const runtime = 'nodejs';

const ALLOWED = new Set(['INR', 'GBP', 'USD']);
const cache = new Map<string, { rate: number; at: number; date: string }>();
const SIX_HOURS = 6 * 3600_000;

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse('Unauthorized', { status: 401 });

  const from = (req.nextUrl.searchParams.get('from') || '').toUpperCase();
  const to = (req.nextUrl.searchParams.get('to') || '').toUpperCase();
  if (!ALLOWED.has(from) || !ALLOWED.has(to)) return NextResponse.json({ ok: false, reason: 'Unsupported currency' }, { status: 400 });
  if (from === to) return NextResponse.json({ ok: true, rate: 1, source: 'same', date: null });

  const key = `${from}-${to}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < SIX_HOURS) return NextResponse.json({ ok: true, rate: hit.rate, source: 'ecb', date: hit.date });

  try {
    const res = await fetch(`https://api.frankfurter.dev/v1/latest?base=${from}&symbols=${to}`, { cache: 'no-store', signal: AbortSignal.timeout(4000) });
    const j = await res.json() as { rates?: Record<string, number>; date?: string };
    const rate = j.rates?.[to];
    if (!res.ok || !rate) throw new Error('no rate');
    cache.set(key, { rate, at: Date.now(), date: j.date || '' });
    return NextResponse.json({ ok: true, rate, source: 'ecb', date: j.date || null });
  } catch {
    return NextResponse.json({ ok: true, rate: fxStanding(from, to), source: 'standing', date: null });
  }
}
