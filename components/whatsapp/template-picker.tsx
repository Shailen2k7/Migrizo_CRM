'use client';

// =============================================================================
// TEMPLATE PICKER — list on the left, variables + live preview on the right.
//
// The preview shows the message exactly as the lead will receive it, so nobody
// discovers a missing variable after Meta has already rejected the send.
// =============================================================================
import { useEffect, useMemo, useState } from 'react';
import { X, FileText, Zap } from 'lucide-react';
import type { WaTemplate } from '@/lib/whatsapp/types';

interface Props {
  open: boolean;
  templates: WaTemplate[];
  leadFirstName: string;
  windowShut: boolean;
  sending: boolean;
  onClose: () => void;
  onSend: (t: WaTemplate, values: Record<string, string>) => void;
}

/** Read placeholders from the body, not the metadata — Meta validates the body. */
function placeholders(body: string): string[] {
  const found = Array.from(body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)).map((m) => m[1]);
  return Array.from(new Set(found)).sort((a, b) => Number(a) - Number(b));
}

export default function TemplatePicker({
  open, templates, leadFirstName, windowShut, sending, onClose, onSend,
}: Props) {
  const [tab, setTab] = useState<'all' | 'cold' | 'hot'>('all');
  const [selId, setSelId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});

  const shown = useMemo(
    () => templates.filter((t) => tab === 'all' || t.track === tab),
    [templates, tab]
  );
  const sel = templates.find((t) => t.id === selId) || null;
  const slots = sel ? placeholders(sel.body) : [];
  const missing = slots.filter((n) => !(values[n] ?? '').trim());

  function pick(t: WaTemplate) {
    setSelId(t.id);
    const next: Record<string, string> = {};
    placeholders(t.body).forEach((n) => {
      const meta = (t.variables || []).find((v) => String(v.n) === n);
      next[n] = n === '1' ? leadFirstName : (meta?.default ?? '');
    });
    setValues(next);
  }

  function rendered(t: WaTemplate): string {
    let out = t.body;
    placeholders(t.body).forEach((n) => {
      out = out.replace(new RegExp(`\\{\\{\\s*${n}\\s*\\}\\}`, 'g'), values[n] || `{{${n}}}`);
    });
    return out;
  }

  // Escape closes it, and reopening always starts from a clean slate.
  useEffect(() => {
    if (!open) { setSelId(null); setValues({}); setTab('all'); return; }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-[rgba(20,24,40,.48)] p-6 backdrop-blur-[2px]"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex max-h-[84vh] w-full max-w-[960px] flex-col overflow-hidden rounded-2xl bg-white shadow-[0_30px_60px_-20px_rgba(20,24,40,.34)]">
        <div className="flex flex-shrink-0 items-center gap-3 border-b border-[#E8EAF0] px-[22px] py-[18px]">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] border border-[#D7F3E1] bg-[#EDFAF1]">
            <FileText className="h-[17px] w-[17px] text-[#1B7A44]" />
          </span>
          <div className="flex-1">
            <h3 className="m-0 text-[15.5px] font-semibold tracking-[-.025em]">Send an approved template</h3>
            <p className="m-0 mt-[3px] text-[12.4px] text-muted">
              {windowShut
                ? 'The 24-hour window is shut, so only Meta-approved templates can go out.'
                : 'The window is open — you could type freely, but a template keeps the sequence consistent.'}
            </p>
          </div>
          <button onClick={onClose} className="flex h-[34px] w-[34px] items-center justify-center rounded-full border border-[#E8EAF0] text-muted transition hover:bg-[#F5F6F9] hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* left: list */}
          <div className="flex w-[410px] flex-shrink-0 flex-col border-r border-[#E8EAF0] bg-[#F5F6F9]">
            <div className="flex flex-shrink-0 gap-[5px] px-[15px] pb-[11px] pt-[14px]">
              {([['all', 'All'], ['cold', 'Cold'], ['hot', 'Hot']] as const).map(([k, l]) => (
                <button
                  key={k}
                  onClick={() => setTab(k)}
                  className={[
                    'flex-1 rounded-lg border px-2 py-[7px] text-[12.4px] font-semibold transition',
                    tab === k
                      ? 'border-[#DDE0E9] bg-white text-ink shadow-[0_1px_2px_rgba(20,24,40,.06)]'
                      : 'border-transparent text-muted hover:bg-[#EDEFF3]',
                  ].join(' ')}
                >
                  {l}{' '}
                  <span className="opacity-55">
                    {templates.filter((t) => k === 'all' || t.track === k).length}
                  </span>
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto px-[11px] pb-[13px]">
              {shown.length === 0 && (
                <p className="px-3 py-8 text-center text-[12.6px] text-muted">
                  No templates yet. Seed them with{' '}
                  <code className="text-[11px]">whatsapp_seed_templates()</code>.
                </p>
              )}
              {shown.map((t) => {
                const on = selId === t.id;
                const blocked = t.meta_status !== 'approved';
                return (
                  <button
                    key={t.id}
                    onClick={() => pick(t)}
                    className={[
                      'mb-[7px] w-full rounded-[11px] border px-[14px] py-3 text-left transition',
                      on
                        ? 'border-[#25A25A] bg-[#EDFAF1] shadow-[0_0_0_2px_#D7F3E1]'
                        : 'border-[#DDE0E9] bg-white hover:border-[#2FB463] hover:bg-[#EDFAF1]',
                    ].join(' ')}
                  >
                    <div className="mb-[5px] flex items-center gap-2">
                      <b className="text-[13px] font-semibold tracking-[-.01em]">{t.name}</b>
                      <span
                        className={[
                          'ml-auto flex-shrink-0 rounded-full border px-[9px] py-[3px] text-[11px] font-semibold',
                          t.category === 'UTILITY'
                            ? 'border-[#D7F3E1] bg-[#EDFAF1] text-[#1B7A44]'
                            : 'border-indigo-100 bg-indigo-soft text-indigo-700',
                        ].join(' ')}
                      >
                        {t.category}
                      </span>
                    </div>
                    <div className="line-clamp-2 text-[11.6px] leading-[1.5] text-muted">
                      {t.body.replace(/\n+/g, ' ')}
                    </div>
                    <div className="mt-[6px] flex items-center gap-2">
                      <code className="text-[10.2px] text-faint">{t.code}</code>
                      {blocked && (
                        <span className="rounded border border-[#F8E2B8] bg-[#FEF6E6] px-[6px] py-px text-[9.5px] font-bold uppercase tracking-wide text-[#A25D07]">
                          {t.meta_status}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* right: variables + preview */}
          <div className="min-w-0 flex-1 overflow-y-auto px-[22px] py-5">
            {!sel ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-5 py-11 text-center text-faint">
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#E8EAF0] bg-[#F5F6F9]">
                  <FileText className="h-5 w-5" />
                </span>
                <b className="text-[13.6px] font-semibold text-muted">Pick a template on the left</b>
                <p className="m-0 max-w-[240px] text-[12.6px] leading-[1.6]">
                  Fill its variables here and see the exact message that lands on their phone.
                </p>
              </div>
            ) : (
              <>
                <h5 className="m-0 mb-3 text-[10px] font-bold uppercase tracking-[.08em] text-faint">
                  Variables — filled at send time, no Meta re-approval
                </h5>
                {slots.map((n) => {
                  const meta = (sel.variables || []).find((v) => String(v.n) === n);
                  return (
                    <div key={n} className="mb-[9px] flex items-center gap-[10px]">
                      <span className="min-w-[38px] flex-shrink-0 rounded-md border border-[#D7F3E1] bg-[#EDFAF1] px-[7px] py-[5px] text-center font-mono text-[11.4px] font-semibold text-[#1B7A44]">
                        {`{{${n}}}`}
                      </span>
                      <input
                        value={values[n] ?? ''}
                        placeholder={meta?.label || `Value for {{${n}}}`}
                        onChange={(e) => setValues((v) => ({ ...v, [n]: e.target.value }))}
                        className="w-full rounded-[9px] border border-[#DDE0E9] px-[10px] py-2 text-[12.8px] outline-none transition focus:border-[#2FB463] focus:shadow-[0_0_0_3px_#EDFAF1]"
                      />
                    </div>
                  );
                })}

                <h5 className="m-0 mb-3 mt-5 text-[10px] font-bold uppercase tracking-[.08em] text-faint">
                  Preview — exactly what lands on their phone
                </h5>
                <div className="flex justify-end rounded-xl border border-[#DDE0E9] bg-[#F7F8FA] p-4">
                  <div className="max-w-full rounded-[18px] bg-[#D7F5D3] px-[17px] py-[13px] text-[14.6px] leading-[1.6] text-[#123321]">
                    <span className="mb-2 inline-flex items-center gap-[5px] rounded bg-[rgba(27,122,68,.13)] px-2 py-[3px] text-[9.5px] font-bold uppercase tracking-[.08em] text-[#1B7A44]">
                      <Zap className="h-[11px] w-[11px]" />
                      {sel.category} · {sel.code}
                    </span>
                    <div className="whitespace-pre-wrap break-words">{rendered(sel)}</div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-shrink-0 items-center gap-[11px] border-t border-[#E8EAF0] bg-[#F5F6F9] px-[22px] py-[14px]">
          <span className="text-[11.8px] text-muted">
            {!sel ? 'Select a template to continue'
              : missing.length ? `Fill ${missing.map((n) => `{{${n}}}`).join(', ')} before sending`
              : sel.category === 'UTILITY' ? 'Utility — cheaper, no frequency cap'
              : 'Marketing — subject to frequency caps'}
          </span>
          <div className="ml-auto flex gap-[10px]">
            <button onClick={onClose}
              className="rounded-[9px] border border-[#DDE0E9] bg-white px-[15px] py-[9px] text-[13.2px] font-semibold text-ink-2 transition hover:bg-[#F5F6F9]">
              Cancel
            </button>
            <button
              disabled={!sel || missing.length > 0 || sending}
              onClick={() => sel && onSend(sel, values)}
              className="rounded-[9px] bg-[#25A25A] px-[15px] py-[9px] text-[13.2px] font-semibold text-white transition hover:bg-[#1B7A44] disabled:opacity-40"
            >
              {sending ? 'Sending…' : 'Send template'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
