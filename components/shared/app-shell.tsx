'use client';

import { createContext, useContext, useState, useCallback } from 'react';
import { PwaSetup } from '@/components/shared/pwa';
import { Menu, Plus } from 'lucide-react';
import { AppProvider } from '@/components/shared/app-provider';
import { Sidebar } from '@/components/sidebar';
import { CooBanner } from '@/components/shared/coo-banner';
import { ActivityHeartbeat } from '@/components/shared/activity-heartbeat';
import { LeadDrawer } from '@/components/leads/lead-drawer';
import { AddLeadDialog } from '@/components/leads/add-lead-dialog';
import { ImportDialog } from '@/components/leads/import-dialog';
import { RecordPaymentDialog } from '@/components/payments/record-payment-dialog';
import type { Workspace, Lead, Payment, Activity } from '@/lib/types';

interface UIState {
  openAddLead: () => void;
  openImport: () => void;
  openLeadDrawer: (id: string) => void;
  openRecordPayment: (leadId?: string) => void;
}

const UIContext = createContext<UIState | null>(null);

export function useUI() {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error('useUI must be used inside <AppShell>');
  return ctx;
}

interface Props {
  user: { id: string; email: string; name: string };
  workspace: Workspace;
  role: 'admin' | 'member';
  canViewPayments: boolean;
  initialLeads: Lead[];
  initialPayments: Payment[];
  initialActivity: Activity[];
  children: React.ReactNode;
}

export function AppShell({ user, workspace, role, canViewPayments, initialLeads, initialPayments, initialActivity, children }: Props) {
  const [addLeadOpen, setAddLeadOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [drawerLeadId, setDrawerLeadId] = useState<string | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentLeadId, setPaymentLeadId] = useState<string | null>(null);
  const [mobileNav, setMobileNav] = useState(false);

  const ui: UIState = {
    openAddLead: useCallback(() => setAddLeadOpen(true), []),
    openImport: useCallback(() => setImportOpen(true), []),
    openLeadDrawer: useCallback((id: string) => setDrawerLeadId(id), []),
    openRecordPayment: useCallback((leadId?: string) => { setPaymentLeadId(leadId || null); setPaymentOpen(true); }, []),
  };

  return (
    <AppProvider user={user} workspace={workspace} role={role} initialCanViewPayments={canViewPayments} initialLeads={initialLeads} initialPayments={initialPayments} initialActivity={initialActivity}>
      <PwaSetup />
      <UIContext.Provider value={ui}>
        {/* Mobile top bar */}
        <header className="md:hidden fixed top-0 left-0 right-0 h-14 bg-surface/90 backdrop-blur-md border-b border-border z-30 flex items-center gap-3 px-4">
          <button onClick={() => setMobileNav(true)} aria-label="Open menu" className="p-2 -ml-2 rounded-lg hover:bg-surface-2 text-ink">
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white font-bold text-[13px] flex-shrink-0" style={{ background: '#4F46E5' }}>M</div>
            <span className="text-[15px] font-semibold tracking-tight truncate">Migrizo</span>
          </div>
          <button onClick={ui.openAddLead} aria-label="Add lead" className="p-2 -mr-1 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors">
            <Plus className="w-4 h-4" />
          </button>
        </header>

        <Sidebar user={user} workspaceName={workspace.name} leadsCount={initialLeads.length} onAddLead={() => { setMobileNav(false); ui.openAddLead(); }} mobileOpen={mobileNav} onClose={() => setMobileNav(false)} />

        <main className="md:ml-[240px] pt-14 md:pt-0">
          <CooBanner leads={initialLeads} isAdmin={role === 'admin'} userName={user.name} />
          <ActivityHeartbeat workspaceId={workspace.id} />
          {children}
        </main>

        <AddLeadDialog open={addLeadOpen} onClose={() => setAddLeadOpen(false)} />
        <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
        <RecordPaymentDialog open={paymentOpen} onClose={() => setPaymentOpen(false)} presetLeadId={paymentLeadId} />
        <LeadDrawer leadId={drawerLeadId} onClose={() => setDrawerLeadId(null)} onRecordPayment={(id) => { setDrawerLeadId(null); ui.openRecordPayment(id); }} />
      </UIContext.Provider>
    </AppProvider>
  );
}
