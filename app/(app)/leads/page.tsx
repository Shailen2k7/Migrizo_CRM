'use client';

import { Suspense, useState, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useApp } from '@/components/shared/app-provider';
import { useUI } from '@/components/shared/app-shell';
import { Topbar } from '@/components/topbar';
import { LeadsTable } from '@/components/leads/leads-table';
import { toast } from 'sonner';

function LeadsPageInner() {
  const params = useSearchParams();
  const seg = (params.get('segment') as 'all' | 'spotlight' | 'not_responding' | 'hot' | 'cold' | 'mr_coming_soon' | 'invoice_sent' | 'won' | 'junk') || 'all';
  const { leads, payments } = useApp();
  const ui = useUI();

  const summary = useMemo(() => {
    const won = leads.filter((l) => l.stage === 'won').length;
    const active = leads.filter((l) => !['won', 'junk'].includes(l.stage)).length;
    return `${leads.length} total · ${active} active · ${won} closed won`;
  }, [leads]);

  const exportCsv = () => {
    if (leads.length === 0) { toast.error('No leads to export'); return; }
    const headers = ['Full Name', 'Phone', 'Email', 'Visa Type', 'Stage', 'Score', 'Next Follow-up', 'Payment Status', 'Amount Paid', 'Last Note'];
    const rows = leads.map((l) => [l.full_name, l.phone || '', l.email || '', l.visa_type || '', l.stage, l.score, l.next_follow_up || '', l.payment_status, l.amount_paid, l.last_note || '']);
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `migrizo-leads-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${leads.length} leads`);
  };

  return (
    <div className="max-w-[1480px] mx-auto px-4 sm:px-6 lg:px-8 pt-5 sm:pt-7 pb-10 animate-pageIn">
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight leading-[1.1]">Leads</h1>
          <p className="text-[13.5px] text-muted mt-2">{summary}</p>
        </div>
        <div className="flex items-center gap-2.5">
          <button onClick={exportCsv} className="btn btn-outline">Export CSV</button>
          <Topbar leads={leads} payments={payments} onAddLead={ui.openAddLead} onImport={ui.openImport} onOpenLead={ui.openLeadDrawer} />
        </div>
      </div>
      <LeadsTable initialSegment={seg} onRowClick={ui.openLeadDrawer} />
    </div>
  );
}

export default function LeadsPage() {
  return (
    <Suspense fallback={<div className="p-10 text-muted text-sm">Loading…</div>}>
      <LeadsPageInner />
    </Suspense>
  );
}
