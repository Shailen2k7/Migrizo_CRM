'use client';

// ============================================================================
// SETTINGS → EMAIL SIGNATURE
// Structured fields (not raw HTML) so the signature renders beautifully and
// identically on every email. Per-user: each teammate saves their own.
// ============================================================================
import { useState, useEffect } from 'react';
import { Loader2, Save } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useApp } from '@/components/shared/app-provider';
import { DEFAULT_SIGNATURE, type EmailSignature } from '@/lib/email/custom';
import { toast } from 'sonner';

const FIELDS: { key: keyof EmailSignature; label: string; placeholder: string }[] = [
  { key: 'closing', label: 'Closing line', placeholder: 'Warm Regards,' },
  { key: 'name', label: 'Your name', placeholder: 'Shailen Pathak' },
  { key: 'title', label: 'Title / role', placeholder: 'Lead Consultant – Global Talent Visa' },
  { key: 'company', label: 'Company', placeholder: 'Migrizo Ventures Pvt Ltd' },
  { key: 'phone', label: 'Phone / WhatsApp', placeholder: '+44 7887 348822' },
  { key: 'website', label: 'Website', placeholder: 'https://www.migrizo.com' },
  { key: 'email', label: 'Email', placeholder: 'info@migrizo.com' },
];

export function SignatureSection() {
  const { workspace, user } = useApp() as ReturnType<typeof useApp> & { workspace: { id: string }; user: { id: string } };
  const [sig, setSig] = useState<EmailSignature>(DEFAULT_SIGNATURE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.from('email_signatures').select('signature').eq('workspace_id', workspace.id).eq('user_id', user.id).maybeSingle()
      .then(({ data }) => {
        setSig({ ...DEFAULT_SIGNATURE, ...((data?.signature as Partial<EmailSignature>) || {}) });
        setLoading(false);
      });
  }, [workspace.id, user.id]);

  const save = async () => {
    if (!sig.name.trim()) { toast.error('Name is required'); return; }
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.from('email_signatures').upsert({
      workspace_id: workspace.id, user_id: user.id, signature: sig, updated_at: new Date().toISOString(),
    });
    setSaving(false);
    if (error) toast.error(`Could not save: ${error.message}`);
    else toast.success('Signature saved — it will appear on every email you compose');
  };

  return (
    <div className="panel">
      <div className="panel-pad border-b border-border">
        <h2 className="text-[15px] font-semibold">Email signature</h2>
        <p className="text-[12.5px] text-muted mt-0.5">Auto-added to every email you compose from a lead. Each teammate has their own.</p>
      </div>
      <div className="panel-pad">
        {loading ? (
          <div className="py-8 text-center text-[12.5px] text-muted"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading…</div>
        ) : (
          <div className="grid md:grid-cols-2 gap-6">
            {/* Fields */}
            <div className="space-y-3">
              {FIELDS.map((f) => (
                <div key={f.key}>
                  <div className="text-[10.5px] font-bold uppercase tracking-wide text-muted mb-1">{f.label}</div>
                  <input value={sig[f.key]} onChange={(e) => setSig((s) => ({ ...s, [f.key]: e.target.value }))} placeholder={f.placeholder}
                    className="w-full px-3 py-2 border border-border rounded-lg text-[13px] focus:border-indigo outline-none" />
                </div>
              ))}
              <button onClick={() => void save()} disabled={saving} className="btn btn-primary btn-sm mt-1">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save signature
              </button>
            </div>
            {/* Live preview */}
            <div>
              <div className="text-[10.5px] font-bold uppercase tracking-wide text-muted mb-2">Preview — exactly how clients see it</div>
              <div className="rounded-xl border border-border bg-white p-5">
                <div className="text-[13px] text-[#1A1E27] mb-2.5">{sig.closing}</div>
                <div className="pl-3.5" style={{ borderLeft: '3px solid #506BD8' }}>
                  <div className="text-[14px] font-bold" style={{ color: '#16294E' }}>{sig.name || '—'}</div>
                  <div className="text-[12.5px] text-muted">{sig.title}</div>
                  <div className="text-[12.5px] font-semibold" style={{ color: '#16294E' }}>{sig.company}</div>
                  <div className="text-[11.5px] text-muted mt-1 leading-relaxed">
                    Phone / WhatsApp: <span style={{ color: '#506BD8' }}>{sig.phone}</span><br />
                    Website: <span style={{ color: '#506BD8' }}>{sig.website.replace(/^https?:\/\//, '')}</span><br />
                    Email: <span style={{ color: '#506BD8' }}>{sig.email}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
