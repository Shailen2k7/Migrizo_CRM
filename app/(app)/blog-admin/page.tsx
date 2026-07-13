'use client';

// =============================================================================
// BLOG ADMIN (CRM) — world-class block editor + SEO + publish + access control.
// Visible only to users granted access in blog_access (owner-only by default).
// =============================================================================
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useApp } from '@/components/shared/app-provider';
import { createClient } from '@/lib/supabase/client';
import { renderBlocks, readingMinutes, slugify, ARTICLE_CSS, type BlogBlock } from '@/lib/blog/render';
import { PenLine, Plus, Trash2, Eye, EyeOff, ArrowUp, ArrowDown, Image as ImageIcon, Type, Heading2, Heading3, List, ListOrdered, Quote, Minus, Loader2, Globe, Copy, ChevronLeft, Users, X, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface Post {
  id: string; title: string; slug: string; excerpt: string | null; cover_url: string | null;
  content: BlogBlock[]; tags: string[]; seo_title: string | null; seo_description: string | null;
  status: string; published_at: string | null; views: number; reading_minutes: number; updated_at: string;
}
interface AccessRow { user_id: string; }
interface Member { user_id: string; role: string; email?: string; name?: string; }

const BLOG_BASE = process.env.NEXT_PUBLIC_BLOG_URL || 'https://blog.migrizo.com';
const uid = () => Math.random().toString(36).slice(2, 10);

export default function BlogAdminPage() {
  const { user, workspace, members } = useApp() as unknown as { user: { id: string; email?: string }; workspace: { id: string }; members?: Member[] };
  const supabase = useMemo(() => createClient(), []);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [editing, setEditing] = useState<Post | null>(null);
  const [accessOpen, setAccessOpen] = useState(false);

  const load = useCallback(async () => {
    const { data: acc } = await supabase.from('blog_access').select('user_id').eq('workspace_id', workspace.id);
    const mine = (acc || []).some((a: AccessRow) => a.user_id === user.id);
    setAllowed(mine);
    if (!mine) return;
    const { data } = await supabase.from('blog_posts').select('*').eq('workspace_id', workspace.id).order('updated_at', { ascending: false });
    setPosts((data as Post[]) || []);
  }, [supabase, workspace.id, user.id]);
  useEffect(() => { void load(); }, [load]);

  if (allowed === null) return <div className="max-w-[900px] mx-auto px-6 py-20 text-center text-muted text-[13px]">Loading…</div>;
  if (!allowed) return <div className="max-w-[900px] mx-auto px-6 py-20 text-center text-muted text-[14px]">You don't have access to the Blog module.</div>;

  if (editing) return <Editor post={editing} workspaceId={workspace.id} userId={user.id} onBack={() => { setEditing(null); void load(); }} />;

  return (
    <div className="max-w-[1000px] mx-auto px-4 sm:px-6 lg:px-8 pt-5 sm:pt-7 pb-16 animate-pageIn">
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2.5"><PenLine className="w-6 h-6 text-indigo" /><h1 className="text-[26px] font-bold text-ink">Blog</h1></div>
          <p className="text-[13px] text-muted mt-1">Write once here — live on your website instantly · <a href={`${BLOG_BASE}/`} target="_blank" rel="noreferrer" className="text-indigo underline">view public blog</a></p>
        </div>
        <div className="flex gap-2.5">
          <button onClick={() => setAccessOpen(true)} className="btn btn-outline"><Users className="w-4 h-4" /> Access</button>
          <button onClick={() => setEditing({ id: '', title: '', slug: '', excerpt: '', cover_url: null, content: [{ id: uid(), type: 'p', text: '' }], tags: [], seo_title: '', seo_description: '', status: 'draft', published_at: null, views: 0, reading_minutes: 1, updated_at: '' })} className="btn btn-primary"><Plus className="w-4 h-4" /> New post</button>
        </div>
      </div>

      {posts.length === 0 && (
        <div className="panel panel-pad text-center py-14">
          <div className="text-[15px] font-semibold text-ink mb-1">No posts yet</div>
          <div className="text-[13px] text-muted">Hit "New post" and publish your first article — it goes live at {BLOG_BASE}.</div>
        </div>
      )}
      <div className="space-y-2.5">
        {posts.map((p) => (
          <div key={p.id} className="panel px-4 py-3.5 flex items-center gap-4 hover:shadow-md transition cursor-pointer" onClick={() => setEditing(p)}>
            {p.cover_url ? <img src={p.cover_url} alt="" className="w-16 h-12 object-cover rounded-lg flex-shrink-0" /> : <div className="w-16 h-12 rounded-lg bg-gradient-to-br from-indigo to-[#16294E] flex-shrink-0" />}
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-ink text-[14px] truncate">{p.title || 'Untitled'}</div>
              <div className="text-[11.5px] text-muted">/{p.slug} · {p.reading_minutes} min · {p.views} views</div>
            </div>
            <span className={cn('text-[10.5px] font-bold rounded-full px-2.5 py-1 flex-shrink-0', p.status === 'published' ? 'bg-emerald-50 text-emerald-700' : 'bg-surface-2 text-muted')}>
              {p.status === 'published' ? '● LIVE' : 'DRAFT'}
            </span>
          </div>
        ))}
      </div>

      {accessOpen && <AccessManager workspaceId={workspace.id} userId={user.id} onClose={() => setAccessOpen(false)} />}
    </div>
  );
}

// ============================== EDITOR ======================================
function Editor({ post, workspaceId, userId, onBack }: { post: Post; workspaceId: string; userId: string; onBack: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [p, setP] = useState<Post>({ ...post, content: post.content?.length ? post.content : [{ id: uid(), type: 'p', text: '' }] });
  const [slugTouched, setSlugTouched] = useState(!!post.id);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const coverRef = useRef<HTMLInputElement>(null);

  const set = (patch: Partial<Post>) => setP((prev) => ({ ...prev, ...patch }));
  const setBlock = (id: string, patch: Partial<BlogBlock>) => set({ content: p.content.map((b) => (b.id === id ? { ...b, ...patch } : b)) });
  const addBlock = (type: BlogBlock['type'], after?: string) => {
    const nb: BlogBlock = { id: uid(), type, text: '' };
    const idx = after ? p.content.findIndex((b) => b.id === after) + 1 : p.content.length;
    const next = [...p.content]; next.splice(idx, 0, nb);
    set({ content: next });
  };
  const removeBlock = (id: string) => set({ content: p.content.filter((b) => b.id !== id) });
  const moveBlock = (id: string, dir: -1 | 1) => {
    const i = p.content.findIndex((b) => b.id === id);
    const j = i + dir;
    if (j < 0 || j >= p.content.length) return;
    const next = [...p.content];[next[i], next[j]] = [next[j], next[i]];
    set({ content: next });
  };

  async function uploadImage(file: File, blockId?: string) {
    setUploading(blockId || 'cover');
    try {
      const path = `${workspaceId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
      const { error } = await supabase.storage.from('blog-images').upload(path, file, { cacheControl: '31536000', upsert: false });
      if (error) throw error;
      const { data } = supabase.storage.from('blog-images').getPublicUrl(path);
      if (blockId) setBlock(blockId, { url: data.publicUrl });
      else set({ cover_url: data.publicUrl });
      toast.success('Image uploaded');
    } catch (e) { toast.error((e as Error).message || 'Upload failed'); }
    setUploading(null);
  }

  async function save(publish?: boolean) {
    if (!p.title.trim()) { toast.error('Add a title first'); return; }
    const slug = (p.slug || slugify(p.title)).trim();
    if (!slug) { toast.error('Add a slug'); return; }
    setSaving(true);
    const status = publish === undefined ? p.status : publish ? 'published' : 'draft';
    const payload = {
      workspace_id: workspaceId, author_id: userId,
      title: p.title.trim(), slug, excerpt: p.excerpt || null, cover_url: p.cover_url,
      content: p.content.filter((b) => b.type === 'image' ? b.url : (b.text || '').trim() || b.type === 'divider'),
      tags: p.tags, seo_title: p.seo_title || null, seo_description: p.seo_description || null,
      status, reading_minutes: readingMinutes(p.content),
      published_at: status === 'published' ? (p.published_at || new Date().toISOString()) : p.published_at,
      updated_at: new Date().toISOString(),
    };
    const q = p.id
      ? supabase.from('blog_posts').update(payload).eq('id', p.id).select().single()
      : supabase.from('blog_posts').insert(payload).select().single();
    const { data, error } = await q;
    setSaving(false);
    if (error) { toast.error(error.message.includes('unique') ? 'That slug is already used — change it' : error.message); return; }
    setP({ ...(data as Post) });
    setSlugTouched(true);
    toast.success(status === 'published' ? '🎉 Published — live on the blog!' : 'Draft saved');
  }

  const previewHtml = useMemo(() => renderBlocks(p.content), [p.content]);
  const liveUrl = `${BLOG_BASE}/${p.slug || slugify(p.title)}`;

  const BLOCK_TYPES: { type: BlogBlock['type']; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { type: 'p', label: 'Text', icon: Type }, { type: 'h2', label: 'Heading', icon: Heading2 }, { type: 'h3', label: 'Subheading', icon: Heading3 },
    { type: 'ul', label: 'Bullets', icon: List }, { type: 'ol', label: 'Numbered', icon: ListOrdered },
    { type: 'quote', label: 'Quote', icon: Quote }, { type: 'image', label: 'Image', icon: ImageIcon }, { type: 'divider', label: 'Divider', icon: Minus },
  ];

  return (
    <div className="max-w-[1000px] mx-auto px-4 sm:px-6 lg:px-8 pt-5 pb-24 animate-pageIn">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
        <button onClick={onBack} className="inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-ink"><ChevronLeft className="w-4 h-4" /> All posts</button>
        <div className="flex items-center gap-2 flex-wrap">
          {p.status === 'published' && (
            <button onClick={() => { navigator.clipboard.writeText(liveUrl); toast.success('Link copied'); }} className="btn btn-outline btn-sm"><Copy className="w-3.5 h-3.5" /> Copy link</button>
          )}
          <button onClick={() => setPreview((v) => !v)} className="btn btn-outline btn-sm">{preview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />} {preview ? 'Edit' : 'Preview'}</button>
          <button onClick={() => void save(false)} disabled={saving} className="btn btn-outline btn-sm">Save draft</button>
          {p.status === 'published'
            ? <button onClick={() => void save(false)} disabled={saving} className="btn btn-outline btn-sm text-amber-700 border-amber-300">Unpublish</button>
            : null}
          <button onClick={() => void save(true)} disabled={saving} className="btn btn-primary btn-sm">{saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Globe className="w-3.5 h-3.5" />} {p.status === 'published' ? 'Update live post' : 'Publish'}</button>
        </div>
      </div>

      {p.status === 'published' && (
        <div className="mb-4 text-[12px] bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg px-3.5 py-2">
          ● Live at <a href={liveUrl} target="_blank" rel="noreferrer" className="underline font-semibold">{liveUrl}</a> · {p.views} views
        </div>
      )}

      {preview ? (
        <div className="panel p-6 sm:p-10">
          <style dangerouslySetInnerHTML={{ __html: ARTICLE_CSS }} />
          <h1 style={{ fontSize: 34, fontWeight: 800, color: '#16294E', lineHeight: 1.22, margin: '0 0 14px' }}>{p.title || 'Untitled'}</h1>
          {p.excerpt && <p style={{ fontSize: 17, color: '#6B7280', lineHeight: 1.6, margin: '0 0 22px' }}>{p.excerpt}</p>}
          {p.cover_url && <img src={p.cover_url} alt="" style={{ width: '100%', height: 'auto', borderRadius: 14, marginBottom: 24 }} />}
          <div className="mgz-article" dangerouslySetInnerHTML={{ __html: previewHtml }} />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">
          {/* Main editor */}
          <div>
            <input value={p.title} onChange={(e) => { set({ title: e.target.value }); if (!slugTouched) set({ slug: slugify(e.target.value) }); }}
              placeholder="Post title…" className="w-full text-[26px] font-extrabold text-ink placeholder:text-faint outline-none bg-transparent mb-2" />
            <textarea value={p.excerpt || ''} onChange={(e) => set({ excerpt: e.target.value })} rows={2}
              placeholder="Short intro / excerpt (also used for SEO description if empty)…"
              className="w-full text-[14.5px] text-muted outline-none bg-transparent resize-none mb-4 leading-relaxed" />

            {/* Blocks */}
            <div className="space-y-2">
              {p.content.map((b, bi) => (
                <div key={b.id} className="group relative border border-transparent hover:border-border rounded-xl transition p-2 -mx-2">
                  {/* Controls */}
                  <div className="absolute -left-1 top-2 opacity-0 group-hover:opacity-100 transition flex flex-col gap-0.5 -translate-x-full pr-1.5">
                    <button onClick={() => moveBlock(b.id, -1)} disabled={bi === 0} className="p-1 rounded hover:bg-surface-2 text-muted disabled:opacity-25"><ArrowUp className="w-3.5 h-3.5" /></button>
                    <button onClick={() => moveBlock(b.id, 1)} disabled={bi === p.content.length - 1} className="p-1 rounded hover:bg-surface-2 text-muted disabled:opacity-25"><ArrowDown className="w-3.5 h-3.5" /></button>
                    <button onClick={() => removeBlock(b.id)} className="p-1 rounded hover:bg-red-50 text-muted hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>

                  {b.type === 'image' ? (
                    <ImageBlock b={b} uploading={uploading === b.id} onUpload={(f) => void uploadImage(f, b.id)} onCaption={(c) => setBlock(b.id, { caption: c })} onRemove={() => removeBlock(b.id)} />
                  ) : b.type === 'divider' ? (
                    <div className="py-3"><div className="h-px bg-border" /></div>
                  ) : (
                    <AutoTextarea
                      value={b.text || ''}
                      onChange={(v) => setBlock(b.id, { text: v })}
                      placeholder={b.type === 'h2' ? 'Heading' : b.type === 'h3' ? 'Subheading' : b.type === 'ul' ? 'One bullet per line' : b.type === 'ol' ? 'One item per line — numbers are automatic' : b.type === 'quote' ? 'Quote' : 'Write here… (**bold**, *italic*, [link](https://…))'}
                      className={cn(
                        'w-full outline-none bg-transparent resize-none leading-relaxed',
                        b.type === 'h2' && 'text-[22px] font-extrabold text-ink',
                        b.type === 'h3' && 'text-[18px] font-bold text-ink',
                        b.type === 'quote' && 'text-[15px] italic text-ink border-l-4 border-[#F4C430] pl-4',
                        (b.type === 'ul' || b.type === 'ol') && 'text-[15px] text-ink font-mono-none',
                        b.type === 'p' && 'text-[15.5px] text-ink'
                      )}
                    />
                  )}
                </div>
              ))}
            </div>

            {/* Add block bar */}
            <div className="mt-5 flex items-center gap-1.5 flex-wrap border border-dashed border-border rounded-xl p-2.5">
              <span className="text-[11px] font-bold text-faint uppercase tracking-wide px-1.5">Add</span>
              {BLOCK_TYPES.map(({ type, label, icon: Icon }) => (
                <button key={type} onClick={() => addBlock(type)} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-muted hover:text-indigo hover:bg-indigo-soft px-2.5 py-1.5 rounded-lg transition">
                  <Icon className="w-3.5 h-3.5" /> {label}
                </button>
              ))}
            </div>
          </div>

          {/* Right rail: cover + SEO */}
          <div className="space-y-4">
            <div className="panel p-4">
              <div className="text-[11px] font-bold uppercase tracking-wide text-muted mb-2">Cover image</div>
              {p.cover_url ? (
                <div className="relative group">
                  <img src={p.cover_url} alt="" className="w-full rounded-lg" style={{ height: 'auto' }} />
                  <button onClick={() => set({ cover_url: null })} className="absolute top-2 right-2 bg-black/60 text-white rounded-md p-1 opacity-0 group-hover:opacity-100 transition"><X className="w-3.5 h-3.5" /></button>
                </div>
              ) : (
                <button onClick={() => coverRef.current?.click()} className="w-full border border-dashed border-border rounded-lg py-8 text-[12.5px] text-muted hover:border-indigo hover:text-indigo transition">
                  {uploading === 'cover' ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : <><ImageIcon className="w-5 h-5 mx-auto mb-1.5" />Upload cover (1200×630 ideal)</>}
                </button>
              )}
              <input ref={coverRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadImage(f); e.target.value = ''; }} />
            </div>

            <div className="panel p-4">
              <div className="text-[11px] font-bold uppercase tracking-wide text-muted mb-2.5">SEO</div>
              <label className="block text-[11.5px] font-medium text-muted mb-1">URL slug</label>
              <div className="flex items-center gap-1 mb-1">
                <span className="text-[11px] text-faint">blog.migrizo.com/</span>
                <input value={p.slug} onChange={(e) => { setSlugTouched(true); set({ slug: slugify(e.target.value) || e.target.value }); }} className="flex-1 px-2 py-1.5 border border-border rounded-md text-[12px] focus:border-indigo outline-none" />
              </div>
              <label className="block text-[11.5px] font-medium text-muted mb-1 mt-3">SEO title <span className="text-faint">(≤60 chars)</span></label>
              <input value={p.seo_title || ''} onChange={(e) => set({ seo_title: e.target.value })} placeholder={p.title || 'Defaults to post title'} className="w-full px-2 py-1.5 border border-border rounded-md text-[12px] focus:border-indigo outline-none" />
              <div className={cn('text-[10.5px] mt-0.5', (p.seo_title || '').length > 60 ? 'text-amber-600' : 'text-faint')}>{(p.seo_title || '').length}/60</div>
              <label className="block text-[11.5px] font-medium text-muted mb-1 mt-2">Meta description <span className="text-faint">(≤158 chars)</span></label>
              <textarea value={p.seo_description || ''} onChange={(e) => set({ seo_description: e.target.value })} rows={3} placeholder={p.excerpt || 'Defaults to excerpt'} className="w-full px-2 py-1.5 border border-border rounded-md text-[12px] focus:border-indigo outline-none resize-none" />
              <div className={cn('text-[10.5px] mt-0.5', (p.seo_description || '').length > 158 ? 'text-amber-600' : 'text-faint')}>{(p.seo_description || '').length}/158</div>
              <label className="block text-[11.5px] font-medium text-muted mb-1 mt-2">Tags <span className="text-faint">(comma-separated)</span></label>
              <input value={p.tags.join(', ')} onChange={(e) => set({ tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })} className="w-full px-2 py-1.5 border border-border rounded-md text-[12px] focus:border-indigo outline-none" />

              {/* Google preview */}
              <div className="mt-4 border border-border rounded-lg p-3 bg-surface-2/50">
                <div className="text-[10px] text-faint mb-1.5">Google preview</div>
                <div className="text-[13px] text-[#1a0dab] leading-snug truncate">{p.seo_title || p.title || 'Post title'}</div>
                <div className="text-[10.5px] text-emerald-700 truncate">{liveUrl}</div>
                <div className="text-[11px] text-[#4d5156] leading-snug mt-0.5" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.seo_description || p.excerpt || 'Meta description appears here…'}</div>
              </div>
              <div className="text-[10.5px] text-faint mt-3">Reading time: {readingMinutes(p.content)} min · Article schema, Open Graph &amp; sitemap are automatic.</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Auto-growing textarea (feels like a document, not a form)
function AutoTextarea({ value, onChange, placeholder, className }: { value: string; onChange: (v: string) => void; placeholder: string; className?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (ref.current) { ref.current.style.height = 'auto'; ref.current.style.height = ref.current.scrollHeight + 'px'; } }, [value]);
  return <textarea ref={ref} value={value} rows={1} placeholder={placeholder} className={className}
    onChange={(e) => onChange(e.target.value)} />;
}

// Image block — auto-settling: any upload fits the column, small stays natural size, centered.
function ImageBlock({ b, uploading, onUpload, onCaption, onRemove }: { b: BlogBlock; uploading: boolean; onUpload: (f: File) => void; onCaption: (c: string) => void; onRemove: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div>
      {b.url ? (
        <figure className="text-center my-1">
          <img src={b.url} alt={b.caption || ''} className="inline-block rounded-xl" style={{ maxWidth: '100%', width: 'auto', height: 'auto', maxHeight: 520, boxShadow: '0 4px 18px rgba(22,41,78,0.08)' }} />
          <input value={b.caption || ''} onChange={(e) => onCaption(e.target.value)} placeholder="Add a caption (optional)…"
            className="block w-full text-center text-[12px] text-muted outline-none bg-transparent mt-2" />
        </figure>
      ) : (
        <button onClick={() => ref.current?.click()} className="w-full border border-dashed border-border rounded-xl py-10 text-[13px] text-muted hover:border-indigo hover:text-indigo transition">
          {uploading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : <><ImageIcon className="w-6 h-6 mx-auto mb-2" />Click to upload an image — any size settles automatically</>}
        </button>
      )}
      <input ref={ref} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ''; }} />
    </div>
  );
}

// Access manager — grant/revoke the Blog module per teammate.
function AccessManager({ workspaceId, userId, onClose }: { workspaceId: string; userId: string; onClose: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<{ user_id: string }[]>([]);
  const [team, setTeam] = useState<{ user_id: string; email: string | null; name: string | null }[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [{ data: acc }, { data: mem }] = await Promise.all([
      supabase.from('blog_access').select('user_id').eq('workspace_id', workspaceId),
      supabase.rpc('list_workspace_members', { p_workspace_id: workspaceId }),
    ]);
    setRows(acc || []);
    setTeam(((mem || []) as { user_id: string; email: string; full_name: string }[]).map((m) => ({
      user_id: m.user_id, email: m.email || null, name: m.full_name || null,
    })));
  }, [supabase, workspaceId]);
  useEffect(() => { void load(); }, [load]);

  async function toggle(uid2: string, has: boolean) {
    if (uid2 === userId && has) { toast.error("You can't remove your own access"); return; }
    setBusy(true);
    if (has) await supabase.from('blog_access').delete().eq('workspace_id', workspaceId).eq('user_id', uid2);
    else await supabase.from('blog_access').insert({ workspace_id: workspaceId, user_id: uid2, granted_by: userId });
    await load();
    setBusy(false);
    toast.success(has ? 'Access removed' : 'Access granted');
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-[440px] p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-[16px] font-bold text-ink">Blog access</h2>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-surface-2 text-muted"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-[12px] text-muted mb-4">Only people listed with access can see the Blog in their sidebar and manage posts.</p>
        <div className="panel divide-y divide-border max-h-[340px] overflow-y-auto">
          {team.map((m) => {
            const has = rows.some((r) => r.user_id === m.user_id);
            return (
              <div key={m.user_id} className="px-3.5 py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-ink truncate">{m.name || m.email || m.user_id.slice(0, 8)}{m.user_id === userId ? ' (you)' : ''}</div>
                  {m.email && m.name && <div className="text-[11px] text-muted truncate">{m.email}</div>}
                </div>
                <button disabled={busy} onClick={() => void toggle(m.user_id, has)}
                  className={cn('text-[11.5px] font-bold rounded-full px-3 py-1.5 border transition flex items-center gap-1', has ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-surface text-muted border-border hover:text-ink')}>
                  {has ? <><Check className="w-3 h-3" /> Has access</> : 'Grant access'}
                </button>
              </div>
            );
          })}
          {team.length === 0 && <div className="px-4 py-4 text-[12px] text-muted">Couldn't load the team list — you can still grant by keeping this owner-only for now.</div>}
        </div>
      </div>
    </div>
  );
}
