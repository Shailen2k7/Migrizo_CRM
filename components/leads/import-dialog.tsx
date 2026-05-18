'use client';

import { useState, useRef, useCallback } from 'react';
import { Modal } from '@/components/shared/modal';
import { useApp } from '@/components/shared/app-provider';
import { readFile, buildPreview, type ImportPreview } from '@/lib/csv-import';
import { UploadCloud, FileText, CheckCircle2, AlertTriangle, AlertCircle, X } from 'lucide-react';
import { toast } from 'sonner';

interface Props { open: boolean; onClose: () => void; }

export function ImportDialog({ open, onClose }: Props) {
  const { leads, bulkInsertLeads, refresh } = useApp();
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState<{ inserted: number; skipped: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const close = () => { setPreview(null); setDone(null); onClose(); };

  const handleFile = useCallback(async (file: File) => {
    if (!file) return;
    setParsing(true);
    try {
      const { headers, rows } = await readFile(file);
      if (rows.length === 0) {
        toast.error('File is empty or unreadable');
        setParsing(false);
        return;
      }
      const existing = {
        phones: new Set(leads.map((l) => l.phone).filter(Boolean) as string[]),
        emails: new Set(leads.map((l) => l.email).filter(Boolean) as string[]),
      };
      const p = buildPreview(file.name, headers, rows, existing);
      setPreview(p);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to parse file');
    } finally {
      setParsing(false);
    }
  }, [leads]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const onImport = async () => {
    if (!preview) return;
    setImporting(true);
    const validRows = preview.rows.filter((r) => r._errors.length === 0 && !r._duplicate);
    const result = await bulkInsertLeads(validRows.map((r) => ({
      full_name: r.full_name,
      phone: r.phone,
      email: r.email,
      visa_type: r.visa_type,
      stage: r.stage,
      next_follow_up: r.next_follow_up,
      payment_status: r.payment_status,
      amount_paid: r.amount_paid,
      last_note: r.last_note,
    })));
    setImporting(false);
    setDone({ inserted: result.inserted, skipped: preview.totalRows - result.inserted });
    await refresh();
    toast.success(`Imported ${result.inserted} leads`);
  };

  // ---- Render ----
  const fieldLabels: Record<string, string> = {
    full_name: 'Full name', first_name: 'First name', last_name: 'Last name',
    phone: 'Phone', email: 'Email', visa_type: 'Visa type', stage: 'Stage',
    last_note: 'Last note', next_follow_up: 'Next follow-up', payment_status: 'Payment status', amount_paid: 'Amount paid',
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Import leads"
      subtitle="Upload a CSV or Excel from Zoho Bigin — fields auto-detect"
      size="lg"
      footer={
        done ? (
          <button onClick={close} className="btn btn-primary">Done</button>
        ) : preview ? (
          <>
            <button onClick={() => setPreview(null)} className="btn btn-ghost">Choose different file</button>
            <button onClick={onImport} disabled={importing || preview.validCount === 0} className="btn btn-primary disabled:opacity-50">
              {importing ? 'Importing…' : `Import ${preview.validCount} leads`}
            </button>
          </>
        ) : (
          <button onClick={close} className="btn btn-ghost">Cancel</button>
        )
      }
    >
      {done ? (
        <div className="text-center py-6">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center" style={{ background: 'hsl(var(--green-soft))', color: '#10B981' }}>
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-semibold mb-1">Import complete</h3>
          <p className="text-[13px] text-muted">
            <span className="font-semibold text-ink num">{done.inserted}</span> leads imported
            {done.skipped > 0 && <> · <span className="font-semibold num">{done.skipped}</span> skipped</>}
          </p>
        </div>
      ) : !preview ? (
        <>
          <div
            onDrop={onDrop}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onClick={() => fileRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all ${dragOver ? 'border-indigo bg-indigo-soft' : 'border-border bg-surface-2 hover:border-border-strong'}`}
          >
            <div className="w-12 h-12 mx-auto mb-3 rounded-full flex items-center justify-center" style={{ background: 'hsl(var(--indigo-soft))', color: '#4338CA' }}>
              <UploadCloud className="w-6 h-6" />
            </div>
            <div className="text-[14px] font-semibold mb-1">{parsing ? 'Parsing…' : 'Drop your file here'}</div>
            <div className="text-[12.5px] text-muted">or click to browse — CSV, XLSX, XLS supported</div>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.txt" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-border p-4">
              <div className="text-[12px] font-semibold mb-2">Auto-detected fields</div>
              <div className="text-[11.5px] text-muted leading-relaxed">Full Name · Phone · Email · Visa Type · Stage · Last Note · Next Follow-up · Payment Status · Amount Paid</div>
            </div>
            <div className="rounded-xl border border-border p-4">
              <div className="text-[12px] font-semibold mb-2">Built-in normalization</div>
              <div className="text-[11.5px] text-muted leading-relaxed">Phone numbers formatted · stages mapped · duplicates flagged · dates parsed automatically</div>
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Summary */}
          <div className="flex items-center gap-3 mb-4 p-3 rounded-xl bg-surface-2 border border-border">
            <FileText className="w-5 h-5 text-muted flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold truncate">{preview.fileName}</div>
              <div className="text-[11.5px] text-muted"><span className="num">{preview.totalRows}</span> rows · <span className="num">{Object.keys(preview.fieldMap).length}</span> fields detected</div>
            </div>
            <div className="flex items-center gap-2 text-[11.5px]">
              <span className="chip" style={{ background: 'hsl(var(--green-soft))', color: '#047857', border: 'none' }}><CheckCircle2 className="w-3 h-3" /> {preview.validCount} valid</span>
              {preview.duplicateCount > 0 && <span className="chip" style={{ background: 'hsl(var(--amber-soft))', color: '#B45309', border: 'none' }}>↻ {preview.duplicateCount} duplicates</span>}
              {preview.errorCount > 0 && <span className="chip" style={{ background: 'hsl(var(--rose-soft))', color: '#B91C1C', border: 'none' }}><AlertCircle className="w-3 h-3" /> {preview.errorCount} errors</span>}
            </div>
          </div>

          {/* Field mapping */}
          <div className="mb-4">
            <h4 className="text-[12px] font-semibold uppercase tracking-wider text-muted mb-2">Field mapping</h4>
            <div className="grid grid-cols-2 gap-1.5">
              {Object.entries(preview.fieldMap).map(([canonical, col]) => (
                <div key={canonical} className="flex items-center justify-between gap-2 px-3 py-2 rounded-md bg-surface-2 text-[12px]">
                  <span className="text-muted truncate">{col}</span>
                  <span className="text-faint">→</span>
                  <span className="font-semibold text-ink truncate">{fieldLabels[canonical] || canonical}</span>
                </div>
              ))}
              {preview.unmappedHeaders.length > 0 && (
                <div className="col-span-2 mt-1 text-[11px] text-muted">
                  <span className="font-medium">Ignored columns:</span> {preview.unmappedHeaders.join(', ')}
                </div>
              )}
            </div>
          </div>

          {/* Preview table */}
          <div className="border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border bg-surface-2 flex items-center justify-between">
              <h4 className="text-[12px] font-semibold uppercase tracking-wider text-muted">Preview · first 12 rows</h4>
            </div>
            <div className="max-h-[260px] overflow-auto">
              <table className="w-full text-[12px]">
                <thead className="bg-surface-2 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold text-muted">Row</th>
                    <th className="text-left px-3 py-2 font-semibold text-muted">Name</th>
                    <th className="text-left px-3 py-2 font-semibold text-muted">Phone</th>
                    <th className="text-left px-3 py-2 font-semibold text-muted">Email</th>
                    <th className="text-left px-3 py-2 font-semibold text-muted">Stage</th>
                    <th className="text-left px-3 py-2 font-semibold text-muted">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 12).map((r) => {
                    const issue = r._errors[0] || r._warnings[0];
                    const cls = r._errors.length > 0 ? 'bg-rose-soft' : r._duplicate ? 'bg-amber-soft' : '';
                    return (
                      <tr key={r._row} className={`border-t border-border ${cls}`}>
                        <td className="px-3 py-2 num text-muted">{r._row}</td>
                        <td className="px-3 py-2 font-medium truncate max-w-[160px]">{r.full_name || <span className="text-faint">—</span>}</td>
                        <td className="px-3 py-2 num truncate max-w-[140px]">{r.phone || <span className="text-faint">—</span>}</td>
                        <td className="px-3 py-2 truncate max-w-[160px]">{r.email || <span className="text-faint">—</span>}</td>
                        <td className="px-3 py-2 text-[11px]">{r.stage}</td>
                        <td className="px-3 py-2 text-[11px]">
                          {r._errors.length > 0 ? <span className="inline-flex items-center gap-1 text-danger font-medium" title={issue}><AlertCircle className="w-3 h-3" />{issue}</span>
                            : r._duplicate ? <span className="inline-flex items-center gap-1 text-amber-dark font-medium"><X className="w-3 h-3" />Duplicate {r._duplicate}</span>
                            : r._warnings.length > 0 ? <span className="inline-flex items-center gap-1 text-amber-dark" title={issue}><AlertTriangle className="w-3 h-3" />{issue}</span>
                            : <span className="inline-flex items-center gap-1 text-success font-medium"><CheckCircle2 className="w-3 h-3" />Ready</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {preview.rows.length > 12 && <div className="px-4 py-2 border-t border-border text-[11.5px] text-muted text-center">+ {preview.rows.length - 12} more rows</div>}
          </div>
        </>
      )}
    </Modal>
  );
}
