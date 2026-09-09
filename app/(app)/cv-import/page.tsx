'use client';

// =============================================================================
// IMPORT CVs — drop a folder of CVs, review who each one belongs to, save.
// -----------------------------------------------------------------------------
// Two steps, deliberately. Parsing is instant and harmless; SAVING writes a
// person's career onto a lead record, and a wrong match writes it onto the
// wrong person. So nothing is saved until every row has a name next to it and
// the button at the bottom is pressed.
//
// Exact matches (email or phone found in the CV) are pre-ticked. Fuzzy ones
// (name only) are shown with a dropdown and left unticked. "Doesn't look like a
// CV" rows are unticked and say why. The file itself never leaves memory on
// the server; only the text comes back here.
// =============================================================================

import { useCallback, useMemo, useRef, useState } from 'react';
import { useApp } from '@/components/shared/app-provider';
import { useUI } from '@/components/shared/app-shell';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  UploadCloud, FileText, CheckCircle2, AlertTriangle, HelpCircle, Loader2, X, Search, ChevronDown, ChevronUp,
} from 'lucide-react';

interface Match {
  leadId: string | null; leadName: string | null;
  confidence: 'exact' | 'fuzzy' | 'none';
  how: 'email' | 'phone' | 'name' | 'filename' | null;
  candidates: { id: string; name: string; why: string }[];
}
interface Row {
  key: string; filename: string; ok: boolean; error?: string;
  text?: string; bytes?: number; rawBytes?: number; condensed?: boolean; cvScore?: number;
  contacts?: { emails: string[]; phones: string[]; nameGuess: string | null };
  match?: Match;
  // review state
  leadId: string | null; include: boolean; open: boolean;
}

const fmtKB = (b?: number) => (b == null ? '—' : `${(b / 1024).toFixed(1)} KB`);

export default function CvImportPage() {
  const { leads } = useApp();
  const ui = useUI();
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const leadOptions = useMemo(
    () => leads.filter((l) => !l.is_sample).map((l) => ({ id: l.id, name: l.full_name, stage: l.stage }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [leads],
  );
  const nameOf = (id: string | null) => leadOptions.find((l) => l.id === id)?.name || '—';

  // ── parse ─────────────────────────────────────────────────────────────
  const parse = useCallback(async (files: File[]) => {
    const accepted = files.filter((f) => /\.(pdf|docx|txt)$/i.test(f.name));
    if (!accepted.length) { toast.error('PDF, DOCX or TXT only.'); return; }
    if (accepted.length < files.length) toast.message(`${files.length - accepted.length} skipped — not PDF/DOCX/TXT.`);

    setBusy(true);
    const fd = new FormData();
    accepted.slice(0, 40).forEach((f) => fd.append('files', f));
    try {
      const r = await fetch('/api/cv/parse', { method: 'POST', body: fd });
      const j = await r.json();
      if (!j.ok) { toast.error(j.error || 'Could not read the files.'); setBusy(false); return; }
      const next: Row[] = (j.results as Omit<Row, 'key' | 'leadId' | 'include' | 'open'>[]).map((res, i) => {
        const exact = res.ok && res.match?.confidence === 'exact';
        const looksLikeCv = (res.cvScore ?? 0) >= 0.4;
        return {
          ...res,
          key: `${Date.now()}-${i}-${res.filename}`,
          leadId: res.match?.leadId ?? null,
          include: !!(exact && looksLikeCv),
          open: false,
        };
      });
      setRows((prev) => [...next, ...prev]);
      const exact = next.filter((r) => r.match?.confidence === 'exact').length;
      toast.success(`${next.length} read · ${exact} matched exactly`);
    } catch {
      toast.error('Upload failed.');
    }
    setBusy(false);
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDrag(false);
    parse(Array.from(e.dataTransfer.files));
  };

  // ── save ──────────────────────────────────────────────────────────────
  const toSave = rows.filter((r) => r.include && r.ok && r.leadId && r.text);
  const save = async () => {
    if (!toSave.length) return;
    setSaving(true);
    try {
      const r = await fetch('/api/cv/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: toSave.map((x) => ({ leadId: x.leadId, text: x.text, filename: x.filename })) }),
      });
      const j = await r.json();
      if (!j.ok) { toast.error(j.error || 'Save failed.'); setSaving(false); return; }
      toast.success(`Saved ${j.saved} profile${j.saved === 1 ? '' : 's'}${j.failed?.length ? ` · ${j.failed.length} failed` : ''}`);
      const savedIds = new Set(toSave.map((x) => x.key));
      setRows((prev) => prev.filter((x) => !savedIds.has(x.key)));
      // The provider holds leads in memory; a reload is the honest way to see
      // the new "View profile" button appear in the drawer.
      setTimeout(() => window.location.reload(), 900);
    } catch { toast.error('Save failed.'); }
    setSaving(false);
  };

  const set = (key: string, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <div className="max-w-[1180px] mx-auto px-4 sm:px-6 lg:px-8 pt-5 sm:pt-7 pb-10 animate-pageIn">
      <div className="mb-6">
        <h1 className="text-[28px] font-bold tracking-tight leading-[1.1]">Import CVs</h1>
        <p className="text-[13.5px] text-muted mt-2">
          Drop CVs here. Each one is read, matched to a lead, and shown for review. Nothing is saved until you press Save.
          Only the text is kept — never the file.
        </p>
      </div>

      {/* drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'panel mb-5 cursor-pointer border-2 border-dashed px-6 py-12 text-center transition',
          drag ? 'border-indigo bg-indigo-soft' : 'border-border hover:border-border-strong',
        )}
      >
        <input ref={inputRef} type="file" multiple accept=".pdf,.docx,.txt" className="hidden"
          onChange={(e) => { if (e.target.files) parse(Array.from(e.target.files)); e.target.value = ''; }} />
        {busy ? (
          <><Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-indigo" />
          <div className="text-[14px] font-semibold">Reading…</div></>
        ) : (
          <><UploadCloud className="mx-auto mb-3 h-8 w-8 text-faint" />
          <div className="text-[14px] font-semibold">Drop CVs here, or click to choose</div>
          <div className="mt-1 text-[12.5px] text-muted">PDF, DOCX or TXT · up to 40 at a time · 15MB each</div></>
        )}
      </div>

      {rows.length > 0 && (
        <>
          {/* summary + save */}
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <div className="text-[12.5px] text-muted">
              <b className="text-ink">{rows.length}</b> file{rows.length === 1 ? '' : 's'} ·{' '}
              <b className="text-ink">{rows.filter((r) => r.match?.confidence === 'exact').length}</b> exact ·{' '}
              <b className="text-ink">{rows.filter((r) => r.match?.confidence === 'fuzzy').length}</b> need a look ·{' '}
              <b className="text-ink">{rows.filter((r) => r.ok && (r.match?.confidence === 'none')).length}</b> unmatched
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button onClick={() => setRows([])} className="btn btn-outline"><X className="h-4 w-4" /> Clear</button>
              <button onClick={save} disabled={saving || !toSave.length} className="btn btn-primary disabled:opacity-50">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Save {toSave.length} to lead{toSave.length === 1 ? '' : 's'}
              </button>
            </div>
          </div>

          {/* review table */}
          <div className="space-y-2">
            {rows.map((r) => {
              const conf = r.match?.confidence ?? 'none';
              const looksLikeCv = (r.cvScore ?? 0) >= 0.4;
              const Icon = !r.ok ? AlertTriangle : conf === 'exact' ? CheckCircle2 : conf === 'fuzzy' ? HelpCircle : Search;
              const iconColor = !r.ok ? 'text-[#B91C1C]' : conf === 'exact' ? 'text-[#047857]' : conf === 'fuzzy' ? 'text-[#B45309]' : 'text-faint';
              return (
                <div key={r.key} className={cn('panel p-3.5', r.include && 'border-[#A7F3D0]')}>
                  <div className="flex items-start gap-3">
                    <input type="checkbox" checked={r.include} disabled={!r.ok || !r.leadId}
                      onChange={(e) => set(r.key, { include: e.target.checked })}
                      className="mt-1 h-4 w-4 shrink-0 accent-indigo" />
                    <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', iconColor)} />

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="truncate text-[13.5px] font-semibold">{r.filename}</span>
                        {r.ok && (
                          <span className="text-[11px] text-faint">
                            {fmtKB(r.bytes)}{r.condensed ? ` · condensed from ${fmtKB(r.rawBytes)}` : ''}
                          </span>
                        )}
                        {r.ok && !looksLikeCv && (
                          <span className="rounded-md bg-[hsl(var(--amber-soft))] px-1.5 py-0.5 text-[10.5px] font-bold text-[#92400E]">
                            doesn&apos;t look like a CV
                          </span>
                        )}
                      </div>

                      {!r.ok ? (
                        <div className="mt-1 text-[12px] text-[#B91C1C]">{r.error}</div>
                      ) : (
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px]">
                          <span className="text-muted">
                            {conf === 'exact' && <>Matched by <b className="text-ink">{r.match?.how}</b> →</>}
                            {conf === 'fuzzy' && <>Probably <b className="text-ink">{r.match?.leadName}</b> ({r.match?.how}) — confirm:</>}
                            {conf === 'none' && <>No match found — pick a lead:</>}
                          </span>
                          <select
                            value={r.leadId ?? ''}
                            onChange={(e) => set(r.key, { leadId: e.target.value || null, include: !!e.target.value })}
                            className="rounded-md border border-border bg-surface px-2 py-1 text-[12px] text-ink focus:outline-none focus:border-indigo"
                          >
                            <option value="">— choose —</option>
                            {r.match?.candidates.map((c) => (
                              <option key={c.id} value={c.id}>{c.name} · {c.why}</option>
                            ))}
                            {r.match?.candidates.length ? <option disabled>──────────</option> : null}
                            {leadOptions.map((l) => (
                              <option key={l.id} value={l.id}>{l.name}{l.stage ? ` · ${l.stage}` : ''}</option>
                            ))}
                          </select>
                          {r.leadId && (
                            <button onClick={() => ui.openLeadDrawer(r.leadId!)} className="text-[12px] font-medium text-indigo hover:underline">
                              open {nameOf(r.leadId)}
                            </button>
                          )}
                        </div>
                      )}

                      {r.ok && r.contacts && (r.contacts.emails.length || r.contacts.phones.length) ? (
                        <div className="mt-1 text-[11px] text-faint">
                          found: {[...r.contacts.emails, ...r.contacts.phones].join(' · ')}
                        </div>
                      ) : null}
                    </div>

                    {r.ok && (
                      <button onClick={() => set(r.key, { open: !r.open })} className="shrink-0 rounded-md p-1 text-faint hover:text-ink" title="Preview text">
                        {r.open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                    )}
                    <button onClick={() => setRows((p) => p.filter((x) => x.key !== r.key))} className="shrink-0 rounded-md p-1 text-faint hover:text-ink" title="Remove">
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  {r.open && r.text && (
                    <div className="mt-3 rounded-lg border border-border bg-surface-2 p-3">
                      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-faint">
                        <FileText className="h-3 w-3" /> what will be saved
                      </div>
                      <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-ink-2">{r.text}</pre>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
