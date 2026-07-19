'use client';

// =============================================================================
// LEARNING HUB — a simple internal library of PDF resources.
// Admins upload PDFs into categories; everyone reads. Click a card to open the
// PDF in-app (served via a short-lived signed URL). Hover to edit or delete.
// Deliberately minimal: no tabs, no feeds — just the library.
// =============================================================================
import { useState, useEffect, useCallback, useRef } from 'react';
import { useApp } from '@/components/shared/app-provider';
import { createClient } from '@/lib/supabase/client';
import { FileText, Upload, Loader2, Pencil, Trash2, X, Download, Search, BookOpen } from 'lucide-react';
import { toast } from 'sonner';

interface Doc {
  id: string; title: string; category: string; storage_path: string;
  file_name: string; file_size: number; created_at: string;
}

const CATEGORIES = [
  { key: 'sales', label: 'Sales', grad: 'linear-gradient(135deg,#FEF3C7,#FDE68A)', ink: '#92400E' },
  { key: 'product', label: 'Product', grad: 'linear-gradient(135deg,#DBEAFE,#BFDBFE)', ink: '#1E40AF' },
  { key: 'gtv', label: 'GTV Knowledge', grad: 'linear-gradient(135deg,#EDE9FE,#DDD6FE)', ink: '#5B21B6' },
  { key: 'general', label: 'General', grad: 'linear-gradient(135deg,#EEF2FF,#E0E7FF)', ink: '#4338CA' },
];
const catOf = (k: string) => CATEGORIES.find((c) => c.key === k) || CATEGORIES[3];
const fmtSize = (b: number) => b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
const fmtDate = (s: string) => new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const BUCKET = 'learning-docs';
const MAX_MB = 25;

export default function LearningPage() {
  const { workspace, user, role } = useApp() as ReturnType<typeof useApp> & { workspace: { id: string }; user: { id: string }; role: string };
  const isAdmin = role === 'admin';
  const supabase = createClient();

  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [q, setQ] = useState('');
  const [uploading, setUploading] = useState(false);
  const [viewer, setViewer] = useState<{ doc: Doc; url: string } | null>(null);
  const [editing, setEditing] = useState<Doc | null>(null);
  const [confirmDel, setConfirmDel] = useState<Doc | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('learning_docs').select('*')
      .eq('workspace_id', workspace.id)
      .order('created_at', { ascending: false });
    if (error) { toast.error('Could not load resources'); setDocs([]); return; }
    setDocs((data as Doc[]) || []);
  }, [supabase, workspace.id]);

  useEffect(() => { void load(); }, [load]);

  // ── upload ──
  const doUpload = async (file: File, category = 'general') => {
    if (file.type !== 'application/pdf') { toast.error('Please choose a PDF file'); return; }
    if (file.size > MAX_MB * 1e6) { toast.error(`File is too large (max ${MAX_MB} MB)`); return; }
    setUploading(true);
    try {
      const safe = file.name.replace(/[^\w.\-]+/g, '_').slice(-80);
      const path = `${workspace.id}/${Date.now()}_${safe}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { cacheControl: '3600', upsert: false });
      if (upErr) throw upErr;
      const title = file.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim();
      const { error: insErr } = await supabase.from('learning_docs').insert({
        workspace_id: workspace.id, title: title || file.name, category,
        storage_path: path, file_name: file.name, file_size: file.size, uploaded_by: user.id,
      });
      if (insErr) throw insErr;
      toast.success('Uploaded');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  // ── open (signed URL) ──
  const openDoc = async (doc: Doc) => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(doc.storage_path, 3600);
    if (error || !data) { toast.error('Could not open this file'); return; }
    setViewer({ doc, url: data.signedUrl });
  };
  const downloadDoc = async (doc: Doc) => {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(doc.storage_path, 3600, { download: doc.file_name });
    if (data) window.open(data.signedUrl, '_blank');
  };

  // ── delete ──
  const doDelete = async (doc: Doc) => {
    setConfirmDel(null);
    const { error } = await supabase.from('learning_docs').delete().eq('id', doc.id);
    if (error) { toast.error('Could not delete'); return; }
    void supabase.storage.from(BUCKET).remove([doc.storage_path]); // best-effort file cleanup
    setDocs((d) => (d || []).filter((x) => x.id !== doc.id));
    toast.success('Deleted');
  };

  // ── drag & drop ──
  const [dragOver, setDragOver] = useState(false);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    if (!isAdmin) return;
    const f = e.dataTransfer.files?.[0];
    if (f) void doUpload(f);
  };

  const shown = (docs || []).filter((d) =>
    (filter === 'all' || d.category === filter) &&
    (!q.trim() || d.title.toLowerCase().includes(q.toLowerCase()))
  );

  return (
    <div className="max-w-[1180px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* header */}
      <div className="flex items-start justify-between gap-4 mb-1">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-700 flex items-center justify-center"><BookOpen className="w-4 h-4" /></span>
            Learning Hub
          </h1>
          <p className="text-[13px] text-muted mt-1">Guides, SOPs and resources for the team.{isAdmin ? ' Upload PDFs; everyone can read them.' : ' Read-only — ask an admin to add resources.'}</p>
        </div>
        {isAdmin && (
          <button onClick={() => fileRef.current?.click()} disabled={uploading} className="btn btn-primary btn-sm">
            {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Upload PDF
          </button>
        )}
        <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void doUpload(f); }} />
      </div>

      {/* filters + search */}
      <div className="flex items-center gap-2 flex-wrap mt-5 mb-5">
        <button onClick={() => setFilter('all')} className={`text-[12.5px] font-semibold px-3.5 py-1.5 rounded-full border ${filter === 'all' ? 'bg-ink text-white border-ink' : 'bg-surface border-border text-ink-2 hover:border-indigo'}`}>All</button>
        {CATEGORIES.map((c) => (
          <button key={c.key} onClick={() => setFilter(c.key)} className={`text-[12.5px] font-semibold px-3.5 py-1.5 rounded-full border ${filter === c.key ? 'bg-ink text-white border-ink' : 'bg-surface border-border text-ink-2 hover:border-indigo'}`}>{c.label}</button>
        ))}
        <div className="ml-auto relative">
          <Search className="w-3.5 h-3.5 text-faint absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="pl-8 pr-3 py-1.5 border border-border rounded-full text-[12.5px] focus:border-indigo outline-none w-[180px]" />
        </div>
      </div>

      {/* grid */}
      {docs === null ? (
        <div className="py-20 text-center text-[13px] text-muted"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Loading…</div>
      ) : (
        <div
          onDragOver={(e) => { if (isAdmin) { e.preventDefault(); setDragOver(true); } }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[18px] rounded-2xl transition-colors ${dragOver ? 'ring-2 ring-indigo ring-offset-4' : ''}`}
        >
          {/* upload tile (admins) */}
          {isAdmin && (
            <button onClick={() => fileRef.current?.click()} disabled={uploading}
              className="min-h-[210px] border-2 border-dashed border-border rounded-2xl bg-surface-2 hover:border-indigo hover:bg-indigo-50/40 transition-colors flex items-center justify-center">
              <div className="text-center px-4">
                <div className="text-2xl mb-2">{uploading ? <Loader2 className="w-7 h-7 animate-spin mx-auto text-indigo" /> : <Upload className="w-7 h-7 mx-auto text-muted" />}</div>
                <div className="text-[13.5px] font-bold text-ink-2">{uploading ? 'Uploading…' : 'Upload a PDF'}</div>
                <div className="text-[11.5px] text-faint mt-0.5">Drag &amp; drop or click · max {MAX_MB} MB</div>
              </div>
            </button>
          )}

          {/* doc cards */}
          {shown.map((doc) => {
            const cat = catOf(doc.category);
            return (
              <div key={doc.id} onClick={() => void openDoc(doc)}
                className="group relative border border-border rounded-2xl overflow-hidden bg-surface cursor-pointer transition-all hover:-translate-y-1 hover:shadow-lg hover:border-indigo/40">
                {isAdmin && (
                  <div className="absolute top-2.5 right-2.5 z-10 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={(e) => { e.stopPropagation(); setEditing(doc); }} title="Edit" className="w-8 h-8 rounded-lg bg-white/95 shadow border border-border flex items-center justify-center text-muted hover:text-indigo-700 hover:border-indigo/40"><Pencil className="w-3.5 h-3.5" /></button>
                    <button onClick={(e) => { e.stopPropagation(); setConfirmDel(doc); }} title="Delete" className="w-8 h-8 rounded-lg bg-white/95 shadow border border-border flex items-center justify-center text-muted hover:text-red-600 hover:border-red-300"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                )}
                <div className="h-[130px] relative flex items-center justify-center" style={{ background: cat.grad }}>
                  <span className="absolute top-2.5 left-2.5 text-[9.5px] font-extrabold tracking-wide px-2 py-0.5 rounded bg-red-600 text-white">PDF</span>
                  <FileText className="w-10 h-10 opacity-25" style={{ color: cat.ink }} />
                </div>
                <div className="p-4">
                  <div className="text-[10px] font-extrabold uppercase tracking-wide" style={{ color: cat.ink }}>{cat.label}</div>
                  <h4 className="text-[14.5px] font-bold leading-snug mt-1.5 mb-2 line-clamp-2">{doc.title}</h4>
                  <div className="text-[11.5px] text-faint">{fmtSize(doc.file_size)} · {fmtDate(doc.created_at)}</div>
                </div>
              </div>
            );
          })}

          {/* empty state */}
          {shown.length === 0 && (
            <div className={`${isAdmin ? 'sm:col-span-1 lg:col-span-2' : 'sm:col-span-2 lg:col-span-3'} min-h-[210px] flex items-center justify-center text-center border border-dashed border-border rounded-2xl`}>
              <div className="text-muted">
                <FileText className="w-7 h-7 mx-auto mb-2 text-faint" />
                <div className="text-[13px]">{q || filter !== 'all' ? 'No resources match.' : 'No resources yet.'}</div>
                {isAdmin && !q && filter === 'all' && <div className="text-[11.5px] text-faint mt-1">Upload your first PDF to get started.</div>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── PDF viewer ── */}
      {viewer && (
        <div className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center p-4" onClick={() => setViewer(null)}>
          <div className="bg-surface w-full max-w-[900px] h-[88vh] rounded-2xl overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 px-5 py-3 border-b border-border">
              <FileText className="w-4 h-4 text-indigo-600 flex-shrink-0" />
              <div className="text-[14px] font-bold truncate flex-1">{viewer.doc.title}</div>
              <button onClick={() => void downloadDoc(viewer.doc)} className="btn btn-outline btn-sm"><Download className="w-3.5 h-3.5" /> Download</button>
              <button onClick={() => setViewer(null)} className="p-1.5 rounded-md hover:bg-surface-2 text-muted"><X className="w-4 h-4" /></button>
            </div>
            <iframe title={viewer.doc.title} src={viewer.url} className="flex-1 w-full bg-neutral-100" />
          </div>
        </div>
      )}

      {/* ── edit dialog ── */}
      {editing && (
        <EditDialog doc={editing} onClose={() => setEditing(null)} onSaved={(patch) => {
          setDocs((d) => (d || []).map((x) => x.id === editing.id ? { ...x, ...patch } : x));
          setEditing(null);
        }} />
      )}

      {/* ── delete confirm ── */}
      {confirmDel && (
        <div className="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center p-4" onClick={() => setConfirmDel(null)}>
          <div className="bg-surface w-full max-w-[380px] rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[15px] font-bold mb-1.5">Delete this resource?</h3>
            <p className="text-[13px] text-muted mb-4">“{confirmDel.title}” will be removed for everyone. This can’t be undone.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmDel(null)} className="btn btn-outline btn-sm">Cancel</button>
              <button onClick={() => void doDelete(confirmDel)} className="btn btn-sm" style={{ background: '#B91C1C', color: '#fff' }}><Trash2 className="w-3.5 h-3.5" /> Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Edit dialog: rename + recategorise ──
function EditDialog({ doc, onClose, onSaved }: { doc: Doc; onClose: () => void; onSaved: (patch: Partial<Doc>) => void }) {
  const supabase = createClient();
  const [title, setTitle] = useState(doc.title);
  const [category, setCategory] = useState(doc.category);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!title.trim()) { toast.error('Title is required'); return; }
    setSaving(true);
    const { error } = await supabase.from('learning_docs')
      .update({ title: title.trim(), category, updated_at: new Date().toISOString() })
      .eq('id', doc.id);
    setSaving(false);
    if (error) { toast.error('Could not save'); return; }
    toast.success('Saved');
    onSaved({ title: title.trim(), category });
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface w-full max-w-[420px] rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[15px] font-bold">Edit resource</h3>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-surface-2 text-muted"><X className="w-4 h-4" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <div className="text-[10.5px] font-bold uppercase tracking-wide text-muted mb-1">Title</div>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full px-3 py-2 border border-border rounded-lg text-[13px] focus:border-indigo outline-none" />
          </div>
          <div>
            <div className="text-[10.5px] font-bold uppercase tracking-wide text-muted mb-1">Category</div>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full px-3 py-2 border border-border rounded-lg text-[13px] focus:border-indigo outline-none bg-surface">
              {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
          <div className="text-[11.5px] text-faint">File: {doc.file_name}</div>
        </div>
        <div className="flex gap-2 justify-end mt-5">
          <button onClick={onClose} className="btn btn-outline btn-sm">Cancel</button>
          <button onClick={() => void save()} disabled={saving} className="btn btn-primary btn-sm">{saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Save</button>
        </div>
      </div>
    </div>
  );
}
