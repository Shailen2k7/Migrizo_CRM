'use client';

import { createContext, useContext, useState, useCallback } from 'react';
import { AppProvider } from '@/components/shared/app-provider';
import { Sidebar } from '@/components/sidebar';
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
  initialLeads: Lead[];
  initialPayments: Payment[];
  initialActivity: Activity[];
  children: React.ReactNode;
}

export function AppShell({ user, workspace, role, initialLeads, initialPayments, initialActivity, children }: Props) {
  const [addLeadOpen, setAddLeadOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [drawerLeadId, setDrawerLeadId] = useState<string | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentLeadId, setPaymentLeadId] = useState<string | null>(null);

  const ui: UIState = {
    openAddLead: useCallback(() => setAddLeadOpen(true), []),
    openImport: useCallback(() => setImportOpen(true), []),
    openLeadDrawer: useCallback((id: string) => setDrawerLeadId(id), []),
    openRecordPayment: useCallback((leadId?: string) => { setPaymentLeadId(leadId || null); setPaymentOpen(true); }, []),
  };

  return (
    <AppProvider user={user} workspace={workspace} role={role} initialLeads={initialLeads} initialPayments={initialPayments} initialActivity={initialActivity}>
      <UIContext.Provider value={ui}>
        <Sidebar user={user} workspaceName={workspace.name} leadsCount={initialLeads.length} onAddLead={ui.openAddLead} />
        <main style={{ marginLeft: 240 }}>{children}</main>

        <AddLeadDialog open={addLeadOpen} onClose={() => setAddLeadOpen(false)} />
        <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
        <RecordPaymentDialog open={paymentOpen} onClose={() => setPaymentOpen(false)} presetLeadId={paymentLeadId} />
        <LeadDrawer leadId={drawerLeadId} onClose={() => setDrawerLeadId(null)} onRecordPayment={(id) => { setDrawerLeadId(null); ui.openRecordPayment(id); }} />
      </UIContext.Provider>
    </AppProvider>
  );
}
