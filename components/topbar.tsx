'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Sun, Moon, Plus, Sparkles, Upload } from 'lucide-react';
import type { Lead, Payment } from '@/lib/types';
import { STAGE_META, getStageMeta } from '@/lib/types';
import { initials, avatarColor } from '@/lib/utils';
import { NotificationDropdown } from '@/components/notification-dropdown';

interface Props {
  leads: Lead[];
  payments: Payment[];
  onAddLead: () => void;
  onImport: () => void;
  onOpenLead: (id: string) => void;
}

export function Topbar({ leads, payments, onAddLead, onImport, onOpenLead }: Props) {
  const router = useRouter();
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = (localStorage.getItem('migrizo-theme') as 'light' | 'dark') || 'light';
    setTheme(t);
  }, []);

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    document.documentElement.classList.toggle('dark', next === 'dark');
    localStorage.setItem('migrizo-theme', next);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        const input = document.getElementById('global-search') as HTMLInputElement | null;
        input?.focus();
      }
      if (e.key === 'Escape') setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClick); };
  }, []);

  const results = query.trim().length === 0 ? [] : leads.filter((l) => {
    const q = query.toLowerCase();
    return (
      l.full_name.toLowerCase().includes(q) ||
      (l.phone || '').toLowerCase().includes(q) ||
      (l.email || '').toLowerCase().includes(q) ||
      (l.last_note || '').toLowerCase().includes(q) ||
      (l.visa_type || '').toLowerCase().includes(q)
    );
  }).slice(0, 8);

  return (
    <div className="flex items-center gap-2.5 flex-wrap">
      <div className="relative" ref={wrapRef}>
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <input
          id="global-search"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search leads, clients, notes…"
          className="pl-9 pr-16 py-2.5 text-[13px] w-[340px] rounded-md border border-border bg-surface focus:outline-none focus:border-indigo focus:ring-4 focus:ring-indigo-soft transition text-ink"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 pointer-events-none">
          <span className="kbd">⌘</span><span className="kbd">K</span>
        </span>
        {open && query.trim() && (
          <div className="absolute top-full left-0 right-0 mt-1.5 bg-surface border border-border rounded-xl shadow-lg z-50 max-h-[440px] overflow-y-auto">
            {results.length === 0 ? (
              <div className="p-5 text-center text-[12.5px] text-muted">No leads match "{query}"</div>
            ) : (
              <div className="p-1.5">
                <div className="text-[10.5px] uppercase tracking-wider text-faint font-semibold px-2.5 py-1.5">Leads · {results.length}</div>
                {results.map((l) => {
                  const stage = getStageMeta(l.stage);
                  return (
                    <button
                      key={l.id}
                      onClick={() => { onOpenLead(l.id); setOpen(false); setQuery(''); }}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md hover:bg-surface-2 text-left"
                    >
                      <div className="av" style={{ background: avatarColor(l.id) }}>{initials(l.full_name)}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium truncate">{l.full_name}</div>
                        <div className="text-[11px] text-muted truncate">{l.phone || l.email || '—'}</div>
                      </div>
                      <span className="chip" style={{ background: stage.bg, color: stage.fg }}>{stage.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <button onClick={() => router.push('/ai')} className="p-2.5 rounded-md hover:bg-surface-2 transition" title="AI COO">
        <Sparkles className="w-[18px] h-[18px] text-indigo-600" />
      </button>

      <NotificationDropdown leads={leads} payments={payments} onOpenLead={onOpenLead} />

      <button onClick={toggleTheme} className="p-2.5 rounded-md hover:bg-surface-2 transition" title="Toggle theme">
        {theme === 'light' ? <Sun className="w-[18px] h-[18px] text-ink-2" /> : <Moon className="w-[18px] h-[18px] text-ink-2" />}
      </button>

      <button onClick={onImport} className="btn btn-outline"><Upload className="w-4 h-4" /> Import</button>
      <button onClick={onAddLead} className="btn btn-primary"><Plus className="w-4 h-4" /> Add Lead</button>
    </div>
  );
}
