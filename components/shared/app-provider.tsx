'use client';

import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Lead, Payment, Activity, Workspace, Note } from '@/lib/types';
import { buildSampleLeads } from '@/lib/sample-data';
import { toast } from 'sonner';

export interface Member {
  user_id: string;
  email: string;
  full_name: string;
  role: 'admin' | 'member';
  status: 'pending' | 'active' | 'paused';
  joined_at: string;
}

interface AppData {
  user: { id: string; email: string; name: string };
  workspace: Workspace;
  role: 'admin' | 'member';
  leads: Lead[];
  payments: Payment[];
  activity: Activity[];
  members: Member[];
  loading: boolean;
  refresh: () => Promise<void>;
  refreshMembers: () => Promise<void>;
  memberNameById: (userId: string | null | undefined) => string;
  createLead: (input: Partial<Lead>) => Promise<Lead | null>;
  updateLead: (id: string, patch: Partial<Lead>) => Promise<void>;
  deleteLead: (id: string) => Promise<void>;
  addNote: (leadId: string, body: string) => Promise<void>;
  getNotes: (leadId: string) => Promise<Note[]>;
  recordPayment: (input: Partial<Payment> & { lead_id: string; milestone: Payment['milestone']; amount: number }) => Promise<void>;
  bulkInsertLeads: (rows: Partial<Lead>[]) => Promise<{ inserted: number }>;
  resetWorkspace: (sampleOnly: boolean) => Promise<void>;
  loadSampleData: () => Promise<void>;
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
  initialLeads: Lead[];
  initialPayments: Payment[];
  initialActivity: Activity[];
  children: React.ReactNode;
}

export function AppProvider({ user, workspace, role, initialLeads, initialPayments, initialActivity, children }: ProviderProps) {
  const supabase = useMemo(() => createClient(), []);
  const [leads, setLeads] = useState<Lead[]>(initialLeads);
  const [payments, setPayments] = useState<Payment[]>(initialPayments);
  const [activity, setActivity] = useState<Activity[]>(initialActivity);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: l }, { data: p }, { data: a }] = await Promise.all([
        supabase.from('leads').select('*').order('updated_at', { ascending: false }),
        supabase.from('payments').select('*').order('created_at', { ascending: false }),
        supabase.from('activity').select('*').order('created_at', { ascending: false }).limit(50),
      ]);
      if (l) setLeads(l as Lead[]);
      if (p) setPayments(p as Payment[]);
      if (a) setActivity(a as Activity[]);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  const refreshMembers = useCallback(async () => {
    const { data } = await supabase.rpc('list_workspace_members', { p_workspace_id: workspace.id });
    if (data) setMembers(data as Member[]);
  }, [supabase, workspace.id]);

  // Load members on mount
  useEffect(() => { refreshMembers(); }, [refreshMembers]);

  // Helper: map a user_id to a display name
  const memberNameById = useCallback((userId: string | null | undefined): string => {
    if (!userId) return 'Unknown';
    if (userId === user.id) return 'You';
    const m = members.find((x) => x.user_id === userId);
    return m ? m.full_name : 'Unknown';
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
      stage: input.stage || 'new',
      source: input.source || null,
      score: input.score ?? 50,
      next_follow_up: input.next_follow_up || null,
      payment_status: input.payment_status || 'none',
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
    logActivity('created_lead', data.id, { name: data.full_name });
    toast.success(`Added ${data.full_name}`);
    return data as Lead;
  }, [supabase, workspace.id, user.id, logActivity]);

  const updateLead = useCallback(async (id: string, patch: Partial<Lead>) => {
    const before = leads.find((l) => l.id === id);
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } as Lead : l)));
    const { error } = await supabase.from('leads').update(patch).eq('id', id);
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

  const recordPayment = useCallback(async (input: Partial<Payment> & { lead_id: string; milestone: Payment['milestone']; amount: number }) => {
    const payload = {
      lead_id: input.lead_id,
      workspace_id: workspace.id,
      milestone: input.milestone,
      amount: input.amount,
      status: input.status || 'paid',
      due_date: input.due_date || null,
      paid_at: input.status === 'paid' || !input.status ? new Date().toISOString() : null,
      note: input.note || null,
      created_by: user.id,
    };
    const { data, error } = await supabase.from('payments').insert(payload).select().single();
    if (error) { toast.error(`Payment failed: ${error.message}`); return; }
    setPayments((prev) => prev.some((p) => p.id === data.id) ? prev : [data as Payment, ...prev]);

    const lead = leads.find((l) => l.id === input.lead_id);
    if (lead && input.status !== 'pending') {
      const newPaid = (lead.amount_paid || 0) + input.amount;
      const newStatus = newPaid >= (lead.amount_total || newPaid) && lead.amount_total > 0 ? 'paid' : 'partial';
      await updateLead(lead.id, { amount_paid: newPaid, payment_status: newStatus });
    }
    logActivity('recorded_payment', input.lead_id, { milestone: input.milestone, amount: input.amount });
    toast.success(`Payment recorded`);
  }, [supabase, workspace.id, user.id, leads, updateLead, logActivity]);

  const bulkInsertLeads = useCallback(async (rows: Partial<Lead>[]): Promise<{ inserted: number }> => {
    if (rows.length === 0) return { inserted: 0 };
    const payload = rows.map((r) => ({
      workspace_id: workspace.id,
      created_by: user.id,
      full_name: r.full_name || 'Unnamed',
      phone: r.phone || null,
      email: r.email || null,
      visa_type: r.visa_type || null,
      stage: r.stage || 'new',
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

  const value: AppData = {
    user, workspace, role, leads, payments, activity, members, loading,
    refresh, refreshMembers, memberNameById,
    createLead, updateLead, deleteLead, addNote, getNotes, recordPayment, bulkInsertLeads, resetWorkspace, loadSampleData,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
