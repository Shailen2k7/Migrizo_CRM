'use client';

// =============================================================================
// Q&A TAB — the growing knowledge base behind auto-answers.
//
// The founder types a QUESTION (how leads actually ask it) and the ANSWER that
// should go out. The AI reads every incoming message and picks the closest
// saved question — the reply is the saved answer, word-for-word, never
// invented. No match → the chat is left for the team. The more rows here, the
// more the system handles alone.
//
// Four topics are hard-wired to a human BEFORE matching ever runs: discounts &
// negotiation, complaints, ready-to-pay, and guarantee questions.
// =============================================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { MessageCircleQuestion, Plus, Trash2, Loader2, ShieldAlert } from 'lucide-react';
import { FIELD, FIELD_AREA } from '@/components/whatsapp/ui';

interface Faq {
  id: string; title: string; question: string; keywords: string[]; answer: string;
  active: boolean; sort_order: number; times_used: number;
}

export default function QaTab({ workspaceId }: { workspaceId: string }) {
  const supabase = createClient();
  const [faqs, setFaqs] = useState<Faq[] | null>(null);
  const [adding, setAdding] = useState(false);
  const loaded = useRef(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('whatsapp_faqs')
      .select('*').eq('workspace_id', workspaceId).order('sort_order').order('created_at');
    if (error) {
      if (/does not exist|schema cache/i.test(error.message)) {
        if (!loaded.current) toast.error('Run migration 051 first — the Q&A table is missing.');
      } else if (!loaded.current) toast.error(error.message);
      return;
    }
    setFaqs((data ?? []) as Faq[]);
    loaded.current = true;
  }, [supabase, workspaceId]);

  useEffect(() => { load(); }, [load]);

  const save = async (f: Partial<Faq> & { id?: string }, isNew = false) => {
    const row = {
      workspace_id: workspaceId,
      title: (f.title ?? '').trim() || (f.question ?? '').trim().slice(0, 60) || 'Untitled',
      question: (f.question ?? '').trim(),
      keywords: (f.keywords ?? []).map((k) => k.trim()).filter(Boolean),
      answer: (f.answer ?? '').trim(),
      active: f.active ?? true,
      sort_order: f.sort_order ?? (faqs?.length ?? 0) + 1,
    };
    const q = isNew
      ? supabase.from('whatsapp_faqs').insert(row)
      : supabase.from('whatsapp_faqs').update(row).eq('id', f.id!);
    const { error } = await q;
    if (error) { toast.error(error.message); return; }
    toast.success(isNew ? 'Q&A added — live immediately' : 'Q&A saved');
    setAdding(false); load();
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this Q&A?')) return;
    const { error } = await supabase.from('whatsapp_faqs').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    load();
  };

  if (!faqs) {
    return <div className="flex items-center justify-center py-20 text-[12.5px] text-muted">
      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Loading Q&amp;A…
    </div>;
  }

  const totalAnswered = faqs.reduce((a, f) => a + f.times_used, 0);
  const mostAsked = faqs.reduce<Faq | null>((best, f) => (f.times_used > (best?.times_used ?? 0) ? f : best), null);

  return (
    <div className="mx-auto max-w-[1380px] px-5 py-4">
      <div className="mb-3 flex items-center gap-3 rounded-xl border border-[#E8EAF0] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(20,24,40,.04)]">
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] border border-indigo-100 bg-indigo-soft">
          <MessageCircleQuestion className="h-4 w-4 text-indigo-700" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-[13.5px] font-semibold tracking-[-.015em]">Q&amp;A — teach the system your answers</h2>
          <p className="m-0 mt-px text-[11.8px] leading-[1.5] text-muted">
            Write a question the way leads ask it, and the exact answer to send. The AI picks the closest saved question and replies with <b>your</b> words — it never invents.
          </p>
        </div>
        <button onClick={() => setAdding(true)}
          className="flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-[#25A25A] px-3 py-1.5 text-[12px] font-semibold text-white transition hover:bg-[#1B7A44]">
          <Plus className="h-3 w-3" /> Add Q&amp;A
        </button>
      </div>

      {/* KPI strip */}
      <div className="mb-3.5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <QaKpi label="Saved answers" value={String(faqs.length)} />
        <QaKpi label="Auto-answered" value={String(totalAnswered)} note="all time" />
        <QaKpi label="Active" value={String(faqs.filter((f) => f.active).length)} />
        <QaKpi label="Most asked" value={mostAsked && mostAsked.times_used > 0 ? mostAsked.title : '—'} small />
      </div>

      <div className="grid grid-cols-1 items-start gap-3.5 xl:grid-cols-[minmax(0,1fr)_372px]">
        <div>
          {adding && <Editor onSave={(f) => save(f, true)} onCancel={() => setAdding(false)} />}
          {faqs.length === 0 && !adding && (
            <p className="m-0 py-8 text-center text-[12px] text-faint">No Q&amp;As yet — add your first one above.</p>
          )}
          <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
            {faqs.map((f) => <Card key={f.id} faq={f} onSave={save} onDelete={() => remove(f.id)} />)}
          </div>
        </div>

        <aside className="grid gap-3 xl:sticky xl:top-4">
          <section className="rounded-xl border border-[#F5E3BC] bg-white shadow-[0_1px_2px_rgba(20,24,40,.04)]">
            <div className="flex items-center gap-2 border-b border-[#F5E3BC] px-3.5 py-2.5">
              <ShieldAlert className="h-3.5 w-3.5 text-[#A25D07]" />
              <h3 className="m-0 text-[12.6px] font-semibold">Always a human, never the robot</h3>
            </div>
            <div className="px-3.5 py-1.5">
              {['💸 Discounts & price negotiation', '😠 Complaints or frustration', '💳 “I\u2019m ready to pay”', '🛡️ Guarantee / success-rate questions'].map((r) => (
                <div key={r} className="border-b border-dashed border-[#F5E3BC] py-2 text-[11.6px] text-[#8A5606] last:border-b-0">{r}</div>
              ))}
            </div>
            <div className="border-t border-[#F5E3BC] px-3.5 py-2 text-[10.8px] text-[#8A5606]">
              Flagged to your team instantly — even if a matching Q&amp;A exists.
            </div>
          </section>

          <section className="rounded-xl border border-[#E8EAF0] bg-white shadow-[0_1px_2px_rgba(20,24,40,.04)]">
            <div className="border-b border-[#F0F1F5] px-3.5 py-2.5">
              <h3 className="m-0 text-[12.6px] font-semibold">How it works</h3>
            </div>
            <div className="px-3.5 py-1.5">
              {[
                'A lead\u2019s message comes in — any chat, any hour. Their message opens the reply window.',
                'AI finds the closest saved question and sends your answer, word-for-word.',
                'No match? The chat is flagged for your team. Silence beats guessing.',
                'Each answer fires max once per chat per day — no spam, ever.',
              ].map((t, i) => (
                <div key={i} className="flex gap-2.5 py-2 text-[11.6px] leading-[1.5] text-ink-2">
                  <span className="flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-full bg-[#EDFAF1] text-[10px] font-bold text-[#1B7A44]">{i + 1}</span>
                  {t}
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function QaKpi({ label, value, note, small }: { label: string; value: string; note?: string; small?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-[#E8EAF0] bg-white px-3.5 py-2.5 shadow-[0_1px_2px_rgba(20,24,40,.04)]">
      <div className="min-w-0">
        <span className="block text-[10px] font-bold uppercase tracking-[.05em] text-faint">{label}</span>
        <b className={`block truncate leading-[1.2] tracking-[-.02em] ${small ? 'text-[13px]' : 'text-[19px]'}`}>{value}</b>
      </div>
      {note && <span className="ml-auto rounded-md bg-[#EDFAF1] px-2 py-0.5 text-[10px] font-bold text-[#1B7A44]">{note}</span>}
    </div>
  );
}

function Card({ faq, onSave, onDelete }: {
  faq: Faq; onSave: (f: Partial<Faq> & { id: string }) => void; onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return <Editor faq={faq} onSave={(f) => { onSave({ ...f, id: faq.id }); setEditing(false); }} onCancel={() => setEditing(false)} />;
  }
  return (
    <div className={`mb-2 rounded-xl border px-3.5 py-2.5 transition ${faq.active ? 'border-[#E8EAF0] bg-white' : 'border-[#F0F1F5] bg-[#F7F8FA] opacity-70'}`}>
      <div className="flex items-center gap-2">
        <b className="text-[12.5px]">{faq.title}</b>
        {!faq.active && <span className="rounded border border-[#DDE0E9] bg-white px-1.5 py-px text-[9px] font-bold uppercase text-[#7A8095]">off</span>}
        {faq.times_used > 0 && <span className="text-[10.3px] text-faint">answered {faq.times_used}×</span>}
        <button onClick={() => setEditing(true)} className="ml-auto text-[11px] font-semibold text-muted transition hover:text-ink">Edit</button>
        <button onClick={onDelete} className="text-muted transition hover:text-[#B3423A]"><Trash2 className="h-3 w-3" /></button>
      </div>
      {faq.question && <p className="m-0 mt-1 text-[11.3px] italic leading-[1.45] text-muted">“{faq.question}”</p>}
      <p className="m-0 mt-1 line-clamp-2 whitespace-pre-wrap text-[11.5px] leading-[1.5] text-ink-2">{faq.answer}</p>
      {faq.keywords.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {faq.keywords.map((k) => (
            <span key={k} className="rounded bg-indigo-soft px-1.5 py-px text-[9.8px] font-medium text-indigo-700">{k}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function Editor({ faq, onSave, onCancel }: {
  faq?: Faq; onSave: (f: Partial<Faq>) => void; onCancel: () => void;
}) {
  const [title, setTitle] = useState(faq?.title ?? '');
  const [question, setQuestion] = useState(faq?.question ?? '');
  const [keywords, setKeywords] = useState((faq?.keywords ?? []).join(', '));
  const [answer, setAnswer] = useState(faq?.answer ?? '');
  const [active, setActive] = useState(faq?.active ?? true);
  return (
    <div className="mb-2 rounded-xl border border-[#2FB463] bg-[#FBFEFC] px-3.5 py-3 shadow-[0_0_0_2px_#EDFAF1]">
      <div className="mb-1.5 grid gap-1.5 sm:grid-cols-2">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Topic label — e.g. Price / total cost"
          className={FIELD} />
        <input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="Optional trigger words — price, cost, fee"
          className={FIELD} />
      </div>
      <input value={question} onChange={(e) => setQuestion(e.target.value)}
        placeholder='The question, as leads ask it — "How much does it cost? What do I need to spend?"'
        className={`${FIELD} mb-1.5`} />
      <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={4}
        placeholder="The reply that goes out, word-for-word. Tokens allowed: {{name}}, {{pdf}}, {{video}}, {{booking}}"
        className={`${FIELD_AREA} mb-1.5`} />
      <div className="flex items-center gap-2.5">
        <label className="flex cursor-pointer items-center gap-1.5 text-[11.5px] text-muted">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active
        </label>
        <button onClick={onCancel} className="ml-auto rounded-lg border border-[#DDE0E9] bg-white px-2.5 py-1.5 text-[11.5px] font-semibold text-ink-2 hover:bg-[#F5F6F9]">Cancel</button>
        <button
          onClick={() => onSave({ title, question, keywords: keywords.split(','), answer, active })}
          disabled={!answer.trim() || (!question.trim() && !keywords.trim())}
          className="rounded-lg bg-[#25A25A] px-2.5 py-1.5 text-[11.5px] font-semibold text-white hover:bg-[#1B7A44] disabled:opacity-40">
          Save
        </button>
      </div>
    </div>
  );
}
