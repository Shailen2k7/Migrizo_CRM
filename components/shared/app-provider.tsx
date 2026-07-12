'use client';

import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Lead, Payment, Activity, Workspace, Note, Case, CaseChecklistItem, CaseActivity, CaseStage, ChecklistStatus, FollowUp } from '@/lib/types';
import type { CaseJourneyState } from '@/lib/journey';
import { buildSampleLeads } from '@/lib/sample-data';
import { toast } from 'sonner';

export interface Member {
  user_id: string;
  email: string;
  full_name: string;
  role: 'admin' | 'member';
  status: 'pending' | 'active' | 'paused';
  joined_at: string;
  can_view_payments: boolean;
}

interface AppData {
  user: { id: string; email: string; name: string };
  workspace: Workspace;
  role: 'admin' | 'member';
  leads: Lead[];
  payments: Payment[];
  activity: Activity[];
  cases: Case[];
  followUps: FollowUp[];
  members: Member[];
  loading: boolean;
  canViewPayments: boolean;
  canSendEmails: boolean;
  setMemberPaymentAccess: (userId: string, canView: boolean) => Promise<void>;
  refresh: () => Promise<void>;
  refreshMembers: () => Promise<void>;
  refreshCases: () => Promise<void>;
  refreshFollowUps: () => Promise<void>;
  memberNameById: (userId: string | null | undefined) => string;
  createLead: (input: Partial<Lead>) => Promise<Lead | null>;
  updateLead: (id: string, patch: Partial<Lead>) => Promise<void>;
  deleteLead: (id: string) => Promise<void>;
  toggleSpotlight: (id: string) => Promise<void>;
  addNote: (leadId: string, body: string) => Promise<void>;
  getNotes: (leadId: string) => Promise<Note[]>;
  recordPayment: (input: Partial<Payment> & { lead_id: string; milestone: Payment['milestone']; amount: number }) => Promise<void>;
  updatePayment: (id: string, patch: Partial<Payment>) => Promise<void>;
  deletePayment: (id: string) => Promise<void>;
  bulkInsertLeads: (rows: Partial<Lead>[]) => Promise<{ inserted: number }>;
  resetWorkspace: (sampleOnly: boolean) => Promise<void>;
  loadSampleData: () => Promise<void>;
  // Cases
  createCase: (input: { lead_id: string | null; client_name: string; visa_type: string; client_email?: string | null; client_phone?: string | null }) => Promise<string | null>;
  updateCase: (caseId: string, patch: Partial<Case>) => Promise<void>;
  updateCaseJourney: (caseId: string, journey: import('@/lib/journey').CaseJourneyState, extra?: Partial<Case>) => Promise<void>;
  sendClientUpdate: (caseId: string, note?: string) => Promise<boolean>;
  deleteCase: (caseId: string) => Promise<void>;
  getChecklist: (caseId: string) => Promise<CaseChecklistItem[]>;
  updateChecklistItem: (itemId: string, patch: Partial<CaseChecklistItem>) => Promise<void>;
  addChecklistItem: (caseId: string, item: Partial<CaseChecklistItem>) => Promise<void>;
  deleteChecklistItem: (itemId: string) => Promise<void>;
  getCaseActivity: (caseId: string) => Promise<CaseActivity[]>;
  // Follow-ups
  createFollowUp: (input: { lead_id: string; title: string; scheduled_at: string; channel?: FollowUp['channel']; notes?: string | null; assigned_to?: string | null }) => Promise<FollowUp | null>;
  updateFollowUp: (id: string, patch: Partial<FollowUp>) => Promise<void>;
  deleteFollowUp: (id: string) => Promise<void>;
  completeFollowUp: (id: string, outcome?: string | null) => Promise<void>;
  reopenFollowUp: (id: string) => Promise<void>;
  cancelFollowUp: (id: string) => Promise<void>;
}

const AppContext = createContext<AppData | null>(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}

interface ProviderProps {
  user: { id: string; email: string; name: string };
  workspace: Workspace;
  role: 'admin' | 'member';
  initialCanViewPayments: boolean;
  initialLeads: Lead[];
  initialPayments: Payment[];
  initialActivity: Activity[];
  children: React.ReactNode;
}

export function AppProvider({ user, workspace, role, initialCanViewPayments, initialLeads, initialPayments, initialActivity, children }: ProviderProps) {
  const supabase = useMemo(() => createClient(), []);
  const [leads, setLeads] = useState<Lead[]>(initialLeads);
  const [payments, setPayments] = useState<Payment[]>(initialPayments);
  const [activity, setActivity] = useState<Activity[]>(initialActivity);
  const [members, setMembers] = useState<Member[]>([]);
  const [cases, setCases] = useState<Case[]>([]);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [loading, setLoading] = useState(false);
  // Current user's effective payment visibility. Admins always see payments.
  const [canViewPayments, setCanViewPayments] = useState<boolean>(role === 'admin' ? true : initialCanViewPayments);
  const canSendEmails = role === 'admin' || !!workspace.allow_member_email;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: l }, { data: p }, { data: a }] = await Promise.all([
        supabase.from('leads').select('*').order('updated_at', { ascending: false }).range(0, 9999),
        supabase.from('payments').select('*').order('created_at', { ascending: false }).range(0, 9999),
        supabase.from('activity').select('*').order('created_at', { ascending: false }).limit(50),
      ]);
      if (l) setLeads(l as Lead[]);
      if (p) setPayments(p as Payment[]);
      if (a) setActivity(a as Activity[]);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  // Lightweight: refresh a single lead row instead of re-fetching everything.
  // Used after payment/follow-up mutations where only one lead's totals changed.
  const refreshLead = useCallback(async (leadId: string) => {
    const { data } = await supabase.from('leads').select('*').eq('id', leadId).maybeSingle();
    if (data) setLeads((prev) => prev.map((l) => l.id === leadId ? (data as Lead) : l));
  }, [supabase]);

  const refreshMembers = useCallback(async () => {
    const { data, error } = await supabase.rpc('list_workspace_members', { p_workspace_id: workspace.id });
    if (error) {
      console.error('[Migrizo] list_workspace_members failed:', error.message);
      return;
    }
    // The RPC may not include can_view_payments — fetch it directly and merge in.
    const { data: perms } = await supabase
      .from('workspace_members')
      .select('user_id, can_view_payments')
      .eq('workspace_id', workspace.id);
    const permMap = new Map((perms || []).map((p: { user_id: string; can_view_payments: boolean }) => [p.user_id, p.can_view_payments]));
    if (data) {
      const merged = (data as Member[]).map((m) => ({ ...m, can_view_payments: permMap.get(m.user_id) ?? true }));
      setMembers(merged);
      // Keep the current user's own permission in sync (in case admin changed it live).
      const me = merged.find((m) => m.user_id === user.id);
      if (me) setCanViewPayments(role === 'admin' ? true : me.can_view_payments);
    }
  }, [supabase, workspace.id, user.id, role]);

  const refreshCases = useCallback(async () => {
    const { data, error } = await supabase
      .from('cases')
      .select('*')
      .eq('workspace_id', workspace.id)
      .order('updated_at', { ascending: false });
    if (error) {
      console.error('[Migrizo] refreshCases failed:', error.message);
      return;
    }
    if (data) setCases(data as Case[]);
  }, [supabase, workspace.id]);

  const refreshFollowUps = useCallback(async () => {
    const { data, error } = await supabase
      .from('follow_ups')
      .select('*')
      .eq('workspace_id', workspace.id)
      .order('scheduled_at', { ascending: true });
    if (error) {
      console.error('[Migrizo] refreshFollowUps failed:', error.message);
      return;
    }
    if (data) setFollowUps(data as FollowUp[]);
  }, [supabase, workspace.id]);

  // Load members + cases + follow-ups on mount and when window regains focus (throttled)
  useEffect(() => {
    refreshMembers();
    refreshCases();
    refreshFollowUps();
    let lastFocusRefresh = Date.now();
    const onFocus = () => {
      // Only re-fetch if it's been more than 60s since the last focus refresh.
      // Prevents a heavy re-fetch every time the user switches browser tabs.
      if (Date.now() - lastFocusRefresh < 60_000) return;
      lastFocusRefresh = Date.now();
      refreshMembers(); refreshCases(); refreshFollowUps();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshMembers, refreshCases, refreshFollowUps]);

  // Helper: map a user_id to a display name
  // Falls back gracefully: null → "Team", unknown user → "Team member" (was "Unknown")
  const memberNameById = useCallback((userId: string | null | undefined): string => {
    if (!userId) return 'Team';
    if (userId === user.id) return 'You';
    const m = members.find((x) => x.user_id === userId);
    if (m && m.full_name) return m.full_name;
    return 'Team member';
  }, [members, user.id]);

  // Incremental realtime
  useEffect(() => {
    const ch = supabase
      .channel('ws-' + workspace.id)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'leads', filter: `workspace_id=eq.${workspace.id}` },
        (payload) => {
          const row = payload.new as Lead;
          setLeads((prev) => prev.some((l) => l.id === row.id) ? prev : [row, ...prev]);
        })
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'leads', filter: `workspace_id=eq.${workspace.id}` },
        (payload) => {
          const row = payload.new as Lead;
          setLeads((prev) => prev.map((l) => l.id === row.id ? row : l));
        })
      .on('postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'leads', filter: `workspace_id=eq.${workspace.id}` },
        (payload) => {
          const id = (payload.old as { id?: string }).id;
          if (id) setLeads((prev) => prev.filter((l) => l.id !== id));
        })
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'payments', filter: `workspace_id=eq.${workspace.id}` },
        (payload) => {
          const row = payload.new as Payment;
          setPayments((prev) => prev.some((p) => p.id === row.id) ? prev : [row, ...prev]);
        })
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'payments', filter: `workspace_id=eq.${workspace.id}` },
        (payload) => {
          const row = payload.new as Payment;
          setPayments((prev) => prev.map((p) => p.id === row.id ? row : p));
        })
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'activity', filter: `workspace_id=eq.${workspace.id}` },
        (payload) => {
          const row = payload.new as Activity;
          setActivity((prev) => prev.some((a) => a.id === row.id) ? prev : [row, ...prev].slice(0, 50));
        })
      // Member changes — refresh full list so admins see pending requests in realtime
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'workspace_members', filter: `workspace_id=eq.${workspace.id}` },
        () => { refreshMembers(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [supabase, workspace.id, refreshMembers]);

  const logActivity = useCallback(async (action: string, leadId: string | null = null, meta: Record<string, unknown> = {}) => {
    await supabase.from('activity').insert({ workspace_id: workspace.id, user_id: user.id, lead_id: leadId, action, meta });
  }, [supabase, workspace.id, user.id]);

  const createLead = useCallback(async (input: Partial<Lead>): Promise<Lead | null> => {
    const payload = {
      workspace_id: workspace.id,
      created_by: user.id,
      full_name: input.full_name || 'Unnamed',
      phone: input.phone || null,
      email: input.email || null,
      visa_type: input.visa_type || null,
      stage: input.stage || 'cold',
      source: input.source || null,
      score: input.score ?? 50,
      next_follow_up: input.next_follow_up || null,
      payment_status: input.payment_status || 'none',
      currency: input.currency || 'INR',
      amount_paid: input.amount_paid || 0,
      amount_total: input.amount_total || 0,
      last_note: input.last_note || null,
      last_note_at: input.last_note ? new Date().toISOString() : null,
      last_note_author_id: input.last_note ? user.id : null,
      tags: input.tags || [],
      is_sample: false,
    };
    const { data, error } = await supabase.from('leads').insert(payload).select().single();
    if (error) { toast.error(`Failed to create lead: ${error.message}`); return null; }
    setLeads((prev) => prev.some((l) => l.id === data.id) ? prev : [data as Lead, ...prev]);
    // If an initial note was entered at creation, store it as a real note so it
    // shows up in the lead drawer's Notes section (not just the last_note field).
    if (payload.last_note) {
      await supabase.from('notes').insert({ lead_id: data.id, workspace_id: workspace.id, body: payload.last_note, author_id: user.id });
    }
    logActivity('created_lead', data.id, { name: data.full_name });
    toast.success(`Added ${data.full_name}`);
    // Auto-send the "How it works" email to brand-new leads that have an email —
    // mirrors the Meta-ingest auto-welcome so manually added leads behave the
    // same. Fire-and-forget; the email route renders + logs it to the Emails tab.
    if (data.email && String(data.email).includes('@')) {
      fetch('/api/email/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'process', leadId: data.id }),
      }).then((r) => r.ok && toast.success('Sent "How it works" intro email')).catch(() => {});
    }
    return data as Lead;
  }, [supabase, workspace.id, user.id, logActivity]);

  const updateLead = useCallback(async (id: string, patch: Partial<Lead>) => {
    const before = leads.find((l) => l.id === id);
    // Stamp the conversion time the moment a lead first becomes 'won' (powers the AI COO).
    const effPatch: Partial<Lead> = { ...patch };
    if (patch.stage === 'won' && before?.stage !== 'won') {
      effPatch.won_at = new Date().toISOString();
    }
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, ...effPatch } as Lead : l)));
    const { error } = await supabase.from('leads').update(effPatch).eq('id', id);
    if (error) {
      if (before) setLeads((prev) => prev.map((l) => (l.id === id ? before : l)));
      toast.error(`Update failed: ${error.message}`);
      return;
    }
    if (patch.stage && before?.stage !== patch.stage) {
      logActivity('moved_stage', id, { from: before?.stage, to: patch.stage });
    }
  }, [supabase, leads, logActivity]);

  const deleteLead = useCallback(async (id: string) => {
    if (role !== 'admin') { toast.error('Only the admin can delete leads'); return; }
    const before = leads;
    setLeads((prev) => prev.filter((l) => l.id !== id));
    const { error } = await supabase.from('leads').delete().eq('id', id);
    if (error) {
      setLeads(before);
      toast.error(`Delete failed: ${error.message}`);
      return;
    }
    toast.success('Lead deleted');
  }, [supabase, leads, role]);

  const toggleSpotlight = useCallback(async (id: string) => {
    const lead = leads.find((l) => l.id === id);
    if (!lead) return;
    const next = !lead.is_spotlight;
    // Optimistic update
    setLeads((prev) => prev.map((l) => l.id === id ? { ...l, is_spotlight: next } : l));
    const { error } = await supabase.from('leads').update({ is_spotlight: next }).eq('id', id);
    if (error) {
      setLeads((prev) => prev.map((l) => l.id === id ? { ...l, is_spotlight: !next } : l));
      toast.error(`Couldn't update: ${error.message}`);
      return;
    }
    toast.success(next ? 'Added to Spotlight' : 'Removed from Spotlight');
  }, [supabase, leads]);

  const setMemberPaymentAccess = useCallback(async (userId: string, canView: boolean) => {
    if (role !== 'admin') { toast.error('Only the admin can change this'); return; }
    // Optimistic update of the members list
    setMembers((prev) => prev.map((m) => m.user_id === userId ? { ...m, can_view_payments: canView } : m));
    const { error } = await supabase
      .from('workspace_members')
      .update({ can_view_payments: canView })
      .eq('workspace_id', workspace.id)
      .eq('user_id', userId);
    if (error) {
      setMembers((prev) => prev.map((m) => m.user_id === userId ? { ...m, can_view_payments: !canView } : m));
      toast.error(`Couldn't update access: ${error.message}`);
      return;
    }
    // If the admin changed their OWN flag (shouldn't normally, admins always see), keep state consistent
    if (userId === user.id && role !== 'admin') setCanViewPayments(canView);
    toast.success(canView ? 'Payments access granted' : 'Payments access removed');
  }, [supabase, workspace.id, role, user.id]);

  const addNote = useCallback(async (leadId: string, body: string) => {
    const trimmed = body.trim();
    if (!trimmed) return;
    const { error } = await supabase.from('notes').insert({
      lead_id: leadId, workspace_id: workspace.id, body: trimmed, author_id: user.id,
    });
    if (error) { toast.error(`Note failed: ${error.message}`); return; }
    await supabase.from('leads').update({
      last_note: trimmed, last_note_at: new Date().toISOString(), last_note_author_id: user.id,
    }).eq('id', leadId);
    setLeads((prev) => prev.map((l) => l.id === leadId ? { ...l, last_note: trimmed, last_note_at: new Date().toISOString(), last_note_author_id: user.id } : l));
    logActivity('added_note', leadId, { preview: trimmed.slice(0, 80) });
    toast.success('Note added');
  }, [supabase, workspace.id, user.id, logActivity]);

  const getNotes = useCallback(async (leadId: string): Promise<Note[]> => {
    const { data, error } = await supabase.from('notes').select('*').eq('lead_id', leadId).order('created_at', { ascending: false });
    if (error) { toast.error(error.message); return []; }
    return (data || []) as Note[];
  }, [supabase]);

  // Fire-and-forget onboarding email when a kickstart payment is marked paid.
  // The API route has a server-side "sent once" guard, so this can never double-send.
  const triggerOnboardingEmail = useCallback((leadId: string) => {
    fetch('/api/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'onboarding', leadId }),
    }).then(async (r) => {
      const j = await r.json().catch(() => null);
      if (j?.ok && !j.already_sent) toast.success('Onboarding email sent to client');
    }).catch(() => { /* silent — never block payment flow */ });
  }, []);

  // Auto-send a branded receipt for a PAID payment (any milestone). The API
  // renders the paid invoice as a receipt and guards per-payment against repeats.
  const triggerReceiptEmail = useCallback((leadId: string, paymentId: string) => {
    fetch('/api/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'invoice', leadId, paymentId }),
    }).then(async (r) => {
      const j = await r.json().catch(() => null);
      if (j?.ok && !j.already_sent) toast.success('Payment receipt emailed to client');
    }).catch(() => { /* silent — never block payment flow */ });
  }, []);

  const recordPayment = useCallback(async (input: Partial<Payment> & { lead_id: string; milestone: Payment['milestone']; amount: number }) => {
    const payload = {
      lead_id: input.lead_id,
      workspace_id: workspace.id,
      milestone: input.milestone,
      amount: input.amount,
      currency: input.currency || 'INR',
      status: input.status || 'paid',
      due_date: input.due_date || null,
      paid_at: input.status === 'paid' || !input.status ? new Date().toISOString() : null,
      note: input.note || null,
      created_by: user.id,
    };
    const { data, error } = await supabase.from('payments').insert(payload).select().single();
    if (error) { toast.error(`Payment failed: ${error.message}`); return; }
    setPayments((prev) => prev.some((p) => p.id === data.id) ? prev : [data as Payment, ...prev]);

    // DB trigger payments_sync_lead automatically updates lead.amount_paid and payment_status.
    // Refresh ONLY the affected lead (fast) instead of re-fetching everything.
    await refreshLead(input.lead_id);

    logActivity('recorded_payment', input.lead_id, { milestone: input.milestone, amount: input.amount });
    toast.success(`Payment recorded`);

    // On a PAID payment: auto-send the receipt for this payment. If it's the
    // kickstart, ALSO send the onboarding email (two separate emails).
    const effStatus = input.status || 'paid';
    if (effStatus === 'paid') {
      triggerReceiptEmail(input.lead_id, (data as Payment).id);
      if (input.milestone === 'kickstart') triggerOnboardingEmail(input.lead_id);
    }
  }, [supabase, workspace.id, user.id, refreshLead, logActivity, triggerOnboardingEmail, triggerReceiptEmail]);

  const updatePayment = useCallback(async (id: string, patch: Partial<Payment>) => {
    const before = payments.find((p) => p.id === id);
    // Optimistic update
    setPayments((prev) => prev.map((p) => p.id === id ? { ...p, ...patch } as Payment : p));
    const { error } = await supabase.from('payments').update(patch).eq('id', id);
    if (error) {
      if (before) setPayments((prev) => prev.map((p) => p.id === id ? before : p));
      toast.error(`Update failed: ${error.message}`);
      return;
    }
    // DB trigger recomputes lead.amount_paid — refresh just that lead
    if (before?.lead_id) await refreshLead(before.lead_id);
    toast.success('Payment updated');

    // Kickstart transitioned to paid → onboarding email (server-side guard).
    const effMilestone = patch.milestone ?? before?.milestone;
    if (before?.lead_id && patch.status === 'paid' && before?.status !== 'paid') {
      triggerReceiptEmail(before.lead_id, id);
      if (effMilestone === 'kickstart') triggerOnboardingEmail(before.lead_id);
    }
  }, [supabase, payments, refreshLead, triggerOnboardingEmail, triggerReceiptEmail]);

  const deletePayment = useCallback(async (id: string) => {
    const before = payments;
    setPayments((prev) => prev.filter((p) => p.id !== id));
    const { error } = await supabase.from('payments').delete().eq('id', id);
    if (error) {
      setPayments(before);
      toast.error(`Delete failed: ${error.message}`);
      return;
    }
    // DB trigger recomputes lead.amount_paid — refresh just that lead
    if (before.length) {
      const deleted = before.find((p) => p.id === id);
      if (deleted?.lead_id) await refreshLead(deleted.lead_id);
    }
    toast.success('Payment deleted');
  }, [supabase, payments, refreshLead]);

  const bulkInsertLeads = useCallback(async (rows: Partial<Lead>[]): Promise<{ inserted: number }> => {
    if (rows.length === 0) return { inserted: 0 };
    const payload = rows.map((r) => ({
      workspace_id: workspace.id,
      created_by: user.id,
      full_name: r.full_name || 'Unnamed',
      phone: r.phone || null,
      email: r.email || null,
      visa_type: r.visa_type || null,
      stage: r.stage || 'cold',
      score: 50,
      next_follow_up: r.next_follow_up || null,
      payment_status: r.payment_status || 'none',
      amount_paid: r.amount_paid || 0,
      amount_total: 0,
      last_note: r.last_note || null,
      last_note_at: r.last_note ? new Date().toISOString() : null,
      last_note_author_id: r.last_note ? user.id : null,
      tags: [],
      is_sample: false,
    }));
    const { data, error } = await supabase.from('leads').insert(payload).select();
    if (error) { toast.error(`Import failed: ${error.message}`); return { inserted: 0 }; }
    if (data) {
      const existingIds = new Set(leads.map((l) => l.id));
      const fresh = (data as Lead[]).filter((l) => !existingIds.has(l.id));
      setLeads((prev) => [...fresh, ...prev]);
    }
    logActivity('imported_leads', null, { count: data?.length || 0 });
    return { inserted: data?.length || 0 };
  }, [supabase, workspace.id, user.id, leads, logActivity]);

  const resetWorkspace = useCallback(async (sampleOnly: boolean) => {
    if (role !== 'admin') { toast.error('Only admins can reset data'); return; }
    const { error } = await supabase.rpc('reset_workspace', { ws_id: workspace.id, sample_only: sampleOnly });
    if (error) { toast.error(`Reset failed: ${error.message}`); return; }
    await refresh();
    toast.success(sampleOnly ? 'Sample data cleared' : 'Workspace reset');
  }, [supabase, workspace.id, role, refresh]);

  const loadSampleData = useCallback(async () => {
    const rows = buildSampleLeads(workspace.id, user.id);
    const { data, error } = await supabase.from('leads').insert(rows).select();
    if (error) { toast.error(`Sample load failed: ${error.message}`); return; }
    if (data) {
      const existingIds = new Set(leads.map((l) => l.id));
      const fresh = (data as Lead[]).filter((l) => !existingIds.has(l.id));
      setLeads((prev) => [...fresh, ...prev]);
    }
    logActivity('loaded_sample_data', null, { count: data?.length || 0 });
    toast.success(`Loaded ${data?.length || 0} sample leads`);
  }, [supabase, workspace.id, user.id, leads, logActivity]);

  // =========================================
  // CASES
  // =========================================
  const createCase = useCallback(async (input: { lead_id: string | null; client_name: string; visa_type: string; client_email?: string | null; client_phone?: string | null }): Promise<string | null> => {
    // Pull contact details from the linked lead if not explicitly provided.
    const lead = input.lead_id ? leads.find((l) => l.id === input.lead_id) : null;
    // New cases start clean at the first step (Onboarding).
    const journey = { tasks: {}, pillars: {}, gates: {} };
    const { data, error } = await supabase.from('cases').insert({
      workspace_id: workspace.id,
      lead_id: input.lead_id,
      client_name: input.client_name,
      client_email: input.client_email ?? lead?.email ?? null,
      client_phone: input.client_phone ?? lead?.phone ?? null,
      visa_type: input.visa_type,
      current_phase: 'onboarding',
      journey,
      owner_id: user.id,
      owner_name: user.name,
      decision: 'pending',
      created_by: user.id,
    }).select().single();
    if (error) { toast.error(`Couldn't create case: ${error.message}`); return null; }
    toast.success(`Case opened for ${input.client_name}`);
    await refreshCases();
    return (data as Case).id;
  }, [supabase, workspace.id, user.id, user.name, refreshCases, leads]);

  // Fire-and-forget client email via the server route. Never blocks the UI.
  const notifyClientEmail = useCallback(async (
    caseId: string,
    event: 'phase_advanced' | 'decision' | 'custom',
    note?: string,
  ): Promise<boolean> => {
    try {
      const res = await fetch('/api/notify-client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseId, event, note: note || null }),
      });
      const json = await res.json().catch(() => ({}));
      return !!json?.ok;
    } catch {
      return false;
    }
  }, []);

  // Public: the manual "Send update" button in the case drawer.
  const sendClientUpdate = useCallback(async (caseId: string, note?: string): Promise<boolean> => {
    const ok = await notifyClientEmail(caseId, 'custom', note);
    if (ok) toast.success('Update emailed to the client');
    else toast.error("Couldn't send — check the client's email and Resend setup");
    return ok;
  }, [notifyClientEmail]);

  // Write the whole journey blob (and optionally other case fields) in one update.
  // Read-modify-write keeps it simple and is safe for single-owner cases.
  const updateCaseJourney = useCallback(async (caseId: string, journey: CaseJourneyState, extra?: Partial<Case>) => {
    const before = cases.find((c) => c.id === caseId);
    const patch = { journey, ...(extra || {}) } as Partial<Case>;
    setCases((prev) => prev.map((c) => c.id === caseId ? { ...c, ...patch } as Case : c));
    const { error } = await supabase.from('cases').update(patch).eq('id', caseId);
    if (error) {
      if (before) setCases((prev) => prev.map((c) => c.id === caseId ? before : c));
      toast.error(`Couldn't save: ${error.message}`);
    }
  }, [supabase, cases]);

  const updateCase = useCallback(async (caseId: string, patch: Partial<Case>) => {
    const before = cases.find((c) => c.id === caseId);
    setCases((prev) => prev.map((c) => c.id === caseId ? { ...c, ...patch } as Case : c));
    const { error } = await supabase.from('cases').update(patch).eq('id', caseId);
    if (error) {
      if (before) setCases((prev) => prev.map((c) => c.id === caseId ? before : c));
      toast.error(`Update failed: ${error.message}`);
      return;
    }
    if (patch.current_stage && before && before.current_stage !== patch.current_stage) {
      await supabase.rpc('log_case_activity', {
        p_case_id: caseId,
        p_action: 'stage_changed',
        p_meta: { from: before.current_stage, to: patch.current_stage },
      });
    }
    if (patch.status && before && before.status !== patch.status) {
      await supabase.rpc('log_case_activity', {
        p_case_id: caseId,
        p_action: 'status_changed',
        p_meta: { from: before.status, to: patch.status },
      });
    }
  }, [supabase, cases]);

  const deleteCase = useCallback(async (caseId: string) => {
    if (role !== 'admin') { toast.error('Only admins can delete cases'); return; }
    const before = cases;
    setCases((prev) => prev.filter((c) => c.id !== caseId));
    const { error } = await supabase.from('cases').delete().eq('id', caseId);
    if (error) {
      setCases(before);
      toast.error(`Delete failed: ${error.message}`);
      return;
    }
    toast.success('Case deleted');
  }, [supabase, cases, role]);

  const getChecklist = useCallback(async (caseId: string): Promise<CaseChecklistItem[]> => {
    const { data, error } = await supabase
      .from('case_checklist_items')
      .select('*')
      .eq('case_id', caseId)
      .order('display_order', { ascending: true });
    if (error) { toast.error(error.message); return []; }
    return (data || []) as CaseChecklistItem[];
  }, [supabase]);

  const updateChecklistItem = useCallback(async (itemId: string, patch: Partial<CaseChecklistItem>) => {
    const payload: Record<string, unknown> = { ...patch };
    if (patch.status === 'completed') {
      payload.completed_at = new Date().toISOString();
      payload.completed_by = user.id;
    } else if (patch.status) {
      payload.completed_at = null;
      payload.completed_by = null;
    }
    const { error } = await supabase.from('case_checklist_items').update(payload).eq('id', itemId);
    if (error) { toast.error(`Couldn't update: ${error.message}`); return; }

    if (patch.status === 'completed') {
      // Fetch the item to get case_id + title for activity log
      const { data: item } = await supabase.from('case_checklist_items').select('case_id, title').eq('id', itemId).single();
      if (item) {
        await supabase.rpc('log_case_activity', {
          p_case_id: item.case_id,
          p_action: 'item_completed',
          p_meta: { title: item.title },
        });
      }
    }
  }, [supabase, user.id]);

  const addChecklistItem = useCallback(async (caseId: string, item: Partial<CaseChecklistItem>) => {
    const { error } = await supabase.from('case_checklist_items').insert({
      case_id: caseId,
      stage: item.stage,
      category: item.category || 'custom',
      title: item.title,
      description: item.description || null,
      display_order: item.display_order ?? 9999,
      is_required: item.is_required ?? false,
    });
    if (error) { toast.error(`Couldn't add: ${error.message}`); return; }
    toast.success('Item added');
    await supabase.rpc('log_case_activity', { p_case_id: caseId, p_action: 'item_added', p_meta: { title: item.title } });
  }, [supabase]);

  const deleteChecklistItem = useCallback(async (itemId: string) => {
    const { error } = await supabase.from('case_checklist_items').delete().eq('id', itemId);
    if (error) { toast.error(`Couldn't delete: ${error.message}`); return; }
    toast.success('Item removed');
  }, [supabase]);

  const getCaseActivity = useCallback(async (caseId: string): Promise<CaseActivity[]> => {
    const { data, error } = await supabase
      .from('case_activity')
      .select('*')
      .eq('case_id', caseId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) { toast.error(error.message); return []; }
    return (data || []) as CaseActivity[];
  }, [supabase]);

  // =========================================
  // FOLLOW-UPS
  // =========================================
  const createFollowUp = useCallback(async (input: { lead_id: string; title: string; scheduled_at: string; channel?: FollowUp['channel']; notes?: string | null; assigned_to?: string | null }): Promise<FollowUp | null> => {
    const payload = {
      workspace_id: workspace.id,
      lead_id: input.lead_id,
      title: input.title,
      scheduled_at: input.scheduled_at,
      channel: input.channel || 'call',
      status: 'pending' as const,
      notes: input.notes || null,
      assigned_to: input.assigned_to || user.id,
      created_by: user.id,
    };
    const { data, error } = await supabase.from('follow_ups').insert(payload).select().single();
    if (error) { toast.error(`Couldn't schedule: ${error.message}`); return null; }
    setFollowUps((prev) => [...prev, data as FollowUp].sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()));
    // The DB trigger updates lead.next_follow_up — refresh just that lead
    refreshLead(input.lead_id);
    toast.success('Follow-up scheduled');
    return data as FollowUp;
  }, [supabase, workspace.id, user.id, refreshLead]);

  const updateFollowUp = useCallback(async (id: string, patch: Partial<FollowUp>) => {
    const before = followUps.find((f) => f.id === id);
    setFollowUps((prev) => prev.map((f) => f.id === id ? { ...f, ...patch } as FollowUp : f));
    const { error } = await supabase.from('follow_ups').update(patch).eq('id', id);
    if (error) {
      if (before) setFollowUps((prev) => prev.map((f) => f.id === id ? before : f));
      toast.error(`Update failed: ${error.message}`);
      return;
    }
    if (before?.lead_id) refreshLead(before.lead_id);
  }, [supabase, followUps, refreshLead]);

  const deleteFollowUp = useCallback(async (id: string) => {
    const before = followUps;
    const target = followUps.find((f) => f.id === id);
    setFollowUps((prev) => prev.filter((f) => f.id !== id));
    const { error } = await supabase.from('follow_ups').delete().eq('id', id);
    if (error) {
      setFollowUps(before);
      toast.error(`Delete failed: ${error.message}`);
      return;
    }
    if (target?.lead_id) refreshLead(target.lead_id);
    toast.success('Follow-up deleted');
  }, [supabase, followUps, refreshLead]);

  const completeFollowUp = useCallback(async (id: string, outcome?: string | null) => {
    const patch = {
      status: 'completed' as const,
      completed_at: new Date().toISOString(),
      outcome: outcome || null,
    };
    setFollowUps((prev) => prev.map((f) => f.id === id ? { ...f, ...patch } as FollowUp : f));
    const target = followUps.find((f) => f.id === id);
    const { error } = await supabase.from('follow_ups').update(patch).eq('id', id);
    if (error) { toast.error(`Couldn't complete: ${error.message}`); return; }
    if (target?.lead_id) refreshLead(target.lead_id);
    toast.success('Follow-up completed');
  }, [supabase, followUps, refreshLead]);

  const reopenFollowUp = useCallback(async (id: string) => {
    const patch = { status: 'pending' as const, completed_at: null, outcome: null };
    setFollowUps((prev) => prev.map((f) => f.id === id ? { ...f, ...patch } as FollowUp : f));
    const target = followUps.find((f) => f.id === id);
    const { error } = await supabase.from('follow_ups').update(patch).eq('id', id);
    if (error) { toast.error(`Couldn't reopen: ${error.message}`); return; }
    if (target?.lead_id) refreshLead(target.lead_id);
    toast.success('Follow-up reopened');
  }, [supabase, followUps, refreshLead]);

  const cancelFollowUp = useCallback(async (id: string) => {
    const patch = { status: 'cancelled' as const };
    setFollowUps((prev) => prev.map((f) => f.id === id ? { ...f, ...patch } as FollowUp : f));
    const target = followUps.find((f) => f.id === id);
    const { error } = await supabase.from('follow_ups').update(patch).eq('id', id);
    if (error) { toast.error(`Couldn't cancel: ${error.message}`); return; }
    if (target?.lead_id) refreshLead(target.lead_id);
    toast.success('Follow-up cancelled');
  }, [supabase, followUps, refreshLead]);

  const value: AppData = {
    user, workspace, role, leads, payments, activity, cases, followUps, members, loading,
    canViewPayments, canSendEmails, setMemberPaymentAccess,
    refresh, refreshMembers, refreshCases, refreshFollowUps, memberNameById,
    createLead, updateLead, deleteLead, toggleSpotlight, addNote, getNotes, recordPayment, updatePayment, deletePayment, bulkInsertLeads, resetWorkspace, loadSampleData,
    createCase, updateCase, updateCaseJourney, sendClientUpdate, deleteCase, getChecklist, updateChecklistItem, addChecklistItem, deleteChecklistItem, getCaseActivity,
    createFollowUp, updateFollowUp, deleteFollowUp, completeFollowUp, reopenFollowUp, cancelFollowUp,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
