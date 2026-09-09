// =============================================================================
// POST /api/cv/parse — files in, proposals out. SAVES NOTHING.
// -----------------------------------------------------------------------------
// Multipart upload of one or many CVs. Each is parsed in memory, matched to a
// lead, and returned as a proposal for the review table. The file itself is
// discarded the moment this handler returns; only the text travels back to the
// browser, and only the browser's later /save call writes anything.
//
// Splitting parse from save is the whole safety model: nothing reaches a lead
// until a person has seen the name next to the file and pressed Save.
// =============================================================================
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { extractCv } from '@/lib/cv/extract';
import { matchLead, type LeadLite } from '@/lib/cv/match';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_FILES = 40;
const MAX_FILE_BYTES = 15 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });

  const { data: member } = await supabase
    .from('workspace_members').select('workspace_id').eq('user_id', user.id).limit(1).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'No workspace.' }, { status: 403 });
  const ws = member.workspace_id as string;

  let form: FormData;
  try { form = await req.formData(); }
  catch { return NextResponse.json({ ok: false, error: 'Expected files.' }, { status: 400 }); }

  const files = form.getAll('files').filter((f): f is File => f instanceof File).slice(0, MAX_FILES);
  if (!files.length) return NextResponse.json({ ok: false, error: 'No files received.' }, { status: 400 });

  // One read of the lead list, reused for every file. Sample rows excluded so
  // a demo record can never claim a real person's CV.
  const leads: LeadLite[] = [];
  for (let page = 0; page < 10; page++) {
    const { data } = await supabase
      .from('leads').select('id, full_name, email, phone, stage')
      .eq('workspace_id', ws).eq('is_sample', false)
      .range(page * 1000, page * 1000 + 999);
    if (!data?.length) break;
    leads.push(...(data as LeadLite[]));
    if (data.length < 1000) break;
  }

  const results = [];
  for (const f of files) {
    if (f.size > MAX_FILE_BYTES) {
      results.push({ filename: f.name, ok: false, error: 'Over 15MB.' });
      continue;
    }
    try {
      const buf = Buffer.from(await f.arrayBuffer());
      const x = await extractCv(buf, f.name, f.type);
      const match = matchLead(leads, x.contacts, f.name);
      results.push({
        filename: f.name, ok: true,
        kind: x.kind, text: x.text, bytes: Buffer.byteLength(x.text, 'utf8'),
        rawBytes: x.rawBytes, condensed: x.condensed, cvScore: x.cvScore,
        contacts: x.contacts, match,
      });
    } catch (e) {
      results.push({ filename: f.name, ok: false, error: e instanceof Error ? e.message : 'Could not read this file.' });
    }
  }

  return NextResponse.json({ ok: true, results });
}
