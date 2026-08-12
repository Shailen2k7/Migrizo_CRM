'use client';

// =============================================================================
// QUICK REPLIES TAB — the canned-notes library behind the "/" palette.
//
// One purpose: a founder types an answer ONCE, and from then on it is two
// keystrokes in any chat — "/" plus Enter. A reply can carry a file (the
// brochure PDF, a checklist) and links live in the body like normal text.
// Tokens {{name}} {{pdf}} {{video}} {{booking}} are filled at send time.
//
// Replaced the Q&A tab (2026-08-12): auto-answers are off in manual mode, and
// migration 056 imported every saved Q&A answer here so nothing was lost.
// =============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import {
  Plus, Loader2, Pencil, Trash2, Paperclip, X, MessageSquareText,
  Zap, FileText, TrendingUp,
} from 'lucide-react';
import type { WaSavedReply } from '@/lib/whatsapp/types';
import { FIELD, FIELD_AREA } from '@/components/whatsapp/ui';

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);

interface Draft {
  id: string | null;
  title: string;
  shortcut: string;
  body: string;
  media_path: string | null;
  media_type: string | null;
  media_name: string | null;
  media_mime: string | null;
  media_size: number | null;
}
const EMPTY: Draft = {
  id: null, title: '', shortcut: '', body: '',
  media_path: null, media_type: null, media_name: null, media_mime: null, media_size: null,
};

export default function RepliesTab({
  workspaceId, onChanged,
}: { workspaceId: string; onChanged: () => void }) {
  const supabase = createClient();
  const [rows, setRows] = useState<WaSavedReply[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const shortcutTouched = useRef(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('whatsapp_saved_replies')
      .select('*').eq('workspace_id', workspaceId).order('sort_order').order('created_at');
    if (error) { toast.error(error.message); return; }
    setRows((data ?? []) as WaSavedReply[]);
    setLoading(false);
  }, [supabase, workspaceId]);
  useEffect(() => { load(); }, [load]);

  const openNew = () => { shortcutTouched.current = false; setDraft({ ...EMPTY }); };
  const openEdit = (r: WaSavedReply) => {
    shortcutTouched.current = true;
    setDraft({
      id: r.id, title: r.title, shortcut: r.shortcut, body: r.body,
      media_path: r.media_path ?? null, media_type: r.media_type ?? null,
      media_name: r.media_name ?? null, media_mime: r.media_mime ?? null,
      media_size: r.media_size ?? null,
    });
  };

  const save = async () => {
    if (!draft) return;
    const shortcut = slugify(draft.shortcut || draft.title);
    if (!draft.title.trim() || !shortcut || !draft.body.trim()) {
      toast.error('A title, a shortcut and the message are all needed'); return;
    }
    setSaving(true);
    const payload = {
      workspace_id: workspaceId,
      title: draft.title.trim(),
      shortcut,
      body: draft.body,
      media_path: draft.media_path, media_type: draft.media_type,
      media_name: draft.media_name, media_mime: draft.media_mime, media_size: draft.media_size,
    };
    const { error } = draft.id
      ? await supabase.from('whatsapp_saved_replies').update(payload).eq('id', draft.id)
      : await supabase.from('whatsapp_saved_replies').insert(payload);
    setSaving(false);
    if (error) {
      toast.error(/duplicate|unique/i.test(error.message)
        ? `“/${shortcut}” is taken — pick another shortcut` : error.message);
      return;
    }
    toast.success(draft.id ? 'Reply updated' : `Saved — type /${shortcut} in any chat`);
    setDraft(null);
    load(); onChanged();
  };

  const remove = async (r: WaSavedReply) => {
    if (!window.confirm(`Delete “${r.title}” (/${r.shortcut})?\n\nThis cannot be undone.`)) return;
    const { error } = await supabase.from('whatsapp_saved_replies').delete().eq('id', r.id);
    if (error) { toast.error(error.message); return; }
    toast.success('Deleted');
    load(); onChanged();
  };

  const attach = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/whatsapp/media/upload', { method: 'POST', body: fd });
      const json = await res.json();
      if (!json.ok) { toast.error(json.detail || json.reason || 'Upload failed'); return; }
      setDraft((d) => d && ({
        ...d, media_path: json.path, media_type: json.mediaType,
        media_name: json.name, media_mime: json.mime, media_size: json.size,
      }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const stats = useMemo(() => ({
    total: rows.length,
    withFiles: rows.filter((r) => r.media_path).length,
    used: rows.reduce((a, r) => a + (r.times_used ?? 0), 0),
    top: [...rows].sort((a, b) => (b.times_used ?? 0) - (a.times_used ?? 0))[0] ?? null,
  }), [rows]);

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-[12.5px] text-muted">
      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Loading quick replies…
    </div>;
  }

  return (
    <div className="mx-auto max-w-[1380px] px-5 py-4">

      {/* header */}
      <div className="mb-3 flex items-center gap-3 rounded-xl border border-[#E8EAF0] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(20,24,40,.04)]">
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] border border-[#D7F3E1] bg-[#EDFAF1]">
          <Zap className="h-4 w-4 text-[#1B7A44]" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-[13.5px] font-semibold tracking-[-.015em]">Quick replies</h2>
          <p className="m-0 mt-px text-[11.8px] leading-[1.5] text-muted">
            Type <code className="rounded bg-[#F4F5F8] px-1 font-mono text-[11px] font-bold text-[#697086]">/</code> in
            any chat, pick one, Enter — the message (and its file) is ready to send.
            Tokens <code className="font-mono text-[10.5px]">{'{{name}} {{pdf}} {{video}} {{booking}}'}</code> fill themselves.
          </p>
        </div>
        <button onClick={openNew}
          className="flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-[#25A25A] px-3 py-1.5 text-[12px] font-semibold text-white transition hover:bg-[#1B7A44]">
          <Plus className="h-3.5 w-3.5" /> New reply
        </button>
      </div>

      {/* KPI strip */}
      <div className="mb-3.5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi icon={<MessageSquareText className="h-3.5 w-3.5 text-[#1B7A44]" />} bg="bg-[#EDFAF1]" label="Saved replies" value={String(stats.total)} />
        <Kpi icon={<Paperclip className="h-3.5 w-3.5 text-indigo-700" />} bg="bg-indigo-soft" label="With a file" value={String(stats.withFiles)} />
        <Kpi icon={<TrendingUp className="h-3.5 w-3.5 text-[#D9541E]" />} bg="bg-[#FFF4EE]" label="Times sent" value={String(stats.used)} />
        <Kpi icon={<FileText className="h-3.5 w-3.5 text-[#1B7A44]" />} bg="bg-[#EDFAF1]" label="Most used"
          value={stats.top && (stats.top.times_used ?? 0) > 0 ? `/${stats.top.shortcut}` : '—'} />
      </div>

      {/* cards */}
      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#DDE0E9] bg-white px-6 py-12 text-center">
          <p className="m-0 text-[13px] font-semibold text-ink-2">No quick replies yet</p>
          <p className="m-0 mt-1 text-[12px] text-muted">Save the answers you type every day — fees, documents, timelines — and send them with two keystrokes.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {rows.map((r) => (
            <div key={r.id} className="group rounded-xl border border-[#E8EAF0] bg-white shadow-[0_1px_2px_rgba(20,24,40,.04)] transition hover:border-[#CBD1DD]">
              <div className="flex items-center gap-2 border-b border-[#F0F1F5] px-3.5 py-2.5">
                <code className="rounded-md bg-[#EDFAF1] px-1.5 py-px font-mono text-[10.8px] font-bold text-[#1B7A44]">/{r.shortcut}</code>
                <b className="min-w-0 flex-1 truncate text-[12.6px] font-semibold text-[#0F1728]">{r.title}</b>
                {(r.times_used ?? 0) > 0 && (
                  <span className="flex-shrink-0 text-[10px] font-semibold text-[#A6ACBF]">sent {r.times_used}×</span>
                )}
                <span className="flex flex-shrink-0 gap-0.5 opacity-0 transition group-hover:opacity-100">
                  <button onClick={() => openEdit(r)} title="Edit"
                    className="rounded-md p-1.5 text-[#8A90A5] transition hover:bg-[#F4F5F8] hover:text-[#0F1728]">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => remove(r)} title="Delete"
                    className="rounded-md p-1.5 text-[#8A90A5] transition hover:bg-[#FDEEEE] hover:text-[#B3423A]">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </span>
              </div>
              <div className="px-3.5 py-2.5">
                <p className="m-0 line-clamp-4 whitespace-pre-wrap text-[11.8px] leading-[1.55] text-[#45464c]">{r.body}</p>
                {r.media_path && (
                  <span className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-lg border border-[#E3E6ED] bg-[#F7F8FA] px-2 py-1 text-[10.8px] font-semibold text-[#697086]">
                    <Paperclip className="h-3 w-3 flex-shrink-0" />
                    <span className="truncate">{r.media_name ?? 'attachment'}</span>
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* editor */}
      {draft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F1728]/40 p-4" onClick={() => setDraft(null)}>
          <div className="w-full max-w-[520px] overflow-hidden rounded-2xl bg-white shadow-[0_24px_60px_-12px_rgba(15,23,40,.4)]"
               onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-[#F0F1F5] px-4 py-3">
              <h3 className="m-0 text-[13.5px] font-semibold">{draft.id ? 'Edit quick reply' : 'New quick reply'}</h3>
              <button onClick={() => setDraft(null)} className="rounded-md p-1 text-[#8A90A5] hover:bg-[#F4F5F8] hover:text-[#0F1728]">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid gap-3 px-4 py-3.5">
              <div className="grid grid-cols-[1fr_170px] gap-2.5">
                <label className="block">
                  <span className="mb-1 block text-[10px] font-bold uppercase tracking-[.06em] text-faint">Title</span>
                  <input
                    value={draft.title} autoFocus placeholder="Our fees"
                    onChange={(e) => {
                      const title = e.target.value;
                      setDraft((d) => d && ({
                        ...d, title,
                        shortcut: shortcutTouched.current ? d.shortcut : slugify(title),
                      }));
                    }}
                    className={FIELD}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-bold uppercase tracking-[.06em] text-faint">Shortcut</span>
                  <span className="relative flex">
                    <span className="pointer-events-none absolute left-[11px] top-1/2 -translate-y-1/2 font-mono text-[12px] font-bold text-[#A6ACBF]">/</span>
                    <input
                      value={draft.shortcut} placeholder="fees"
                      onChange={(e) => {
                        shortcutTouched.current = true;
                        setDraft((d) => d && ({ ...d, shortcut: slugify(e.target.value) }));
                      }}
                      className={`${FIELD} pl-6 font-mono`}
                    />
                  </span>
                </label>
              </div>
              <label className="block">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-[.06em] text-faint">Message</span>
                <textarea
                  value={draft.body} rows={7}
                  placeholder={'The message exactly as it should arrive.\nPaste links as plain text — WhatsApp makes them tappable.'}
                  onChange={(e) => setDraft((d) => d && ({ ...d, body: e.target.value }))}
                  className={FIELD_AREA}
                />
                <span className="mt-1 block text-[10.5px] text-faint">
                  Tokens filled at send time: <code className="font-mono">{'{{name}}'}</code> = lead&apos;s first name ·{' '}
                  <code className="font-mono">{'{{pdf}} {{video}} {{booking}}'}</code> = your links from the Automation tab.
                </span>
              </label>

              {/* attachment */}
              <div>
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-[.06em] text-faint">Attachment (optional)</span>
                {draft.media_path ? (
                  <span className="inline-flex max-w-full items-center gap-2 rounded-lg border border-[#D7F3E1] bg-[#EDFAF1] px-2.5 py-1.5 text-[11.5px] font-semibold text-[#1B7A44]">
                    <Paperclip className="h-3.5 w-3.5 flex-shrink-0" />
                    <span className="truncate">{draft.media_name}</span>
                    <button onClick={() => setDraft((d) => d && ({
                      ...d, media_path: null, media_type: null, media_name: null, media_mime: null, media_size: null,
                    }))} className="rounded p-0.5 text-[#1B7A44] hover:bg-[#D7F3E1]">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ) : (
                  <>
                    <input ref={fileRef} type="file" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) attach(f); }} />
                    <button onClick={() => fileRef.current?.click()} disabled={uploading}
                      className="flex items-center gap-1.5 rounded-lg border border-dashed border-[#CBD1DD] bg-[#FAFBFC] px-3 py-1.5 text-[11.5px] font-semibold text-[#697086] transition hover:border-[#25A25A] hover:text-[#1B7A44] disabled:opacity-50">
                      {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
                      {uploading ? 'Uploading…' : 'Attach a PDF or image'}
                    </button>
                  </>
                )}
                <span className="mt-1 block text-[10.5px] text-faint">Sent together with the message, like a normal WhatsApp attachment.</span>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-[#F0F1F5] bg-[#FBFBFC] px-4 py-3">
              <button onClick={() => setDraft(null)}
                className="rounded-lg border border-[#DDE0E9] bg-white px-3 py-1.5 text-[12px] font-semibold text-ink-2 transition hover:bg-[#F5F6F9]">
                Cancel
              </button>
              <button onClick={save} disabled={saving}
                className="rounded-lg bg-[#25A25A] px-3.5 py-1.5 text-[12px] font-semibold text-white transition hover:bg-[#1B7A44] disabled:opacity-50">
                {saving ? 'Saving…' : draft.id ? 'Save changes' : 'Save reply'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ icon, bg, label, value }: {
  icon: React.ReactNode; bg: string; label: string; value: string;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-[#E8EAF0] bg-white px-3.5 py-2.5 shadow-[0_1px_2px_rgba(20,24,40,.04)]">
      <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[9px] ${bg}`}>{icon}</span>
      <div className="min-w-0">
        <span className="block text-[10px] font-bold uppercase tracking-[.05em] text-faint">{label}</span>
        <b className="block truncate text-[19px] leading-[1.15] tracking-[-.02em]">{value}</b>
      </div>
    </div>
  );
}
