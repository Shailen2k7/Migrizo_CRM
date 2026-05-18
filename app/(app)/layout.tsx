import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AppShell } from '@/components/shared/app-shell';
import type { Workspace, Lead, Payment, Activity, WorkspaceMember } from '@/lib/types';

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();

  // 1. Get the authenticated user (middleware should have redirected unauth users already)
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) redirect('/login');

  // 2. Resolve the user's workspace + role
  const { data: member } = await supabase
    .from('workspace_members')
    .select('workspace_id, role, workspaces:workspaces(*)')
    .eq('user_id', user.id)
    .single();

  if (!member || !member.workspaces) {
    // The DB trigger should have created this; if missing, fail loudly
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="panel p-8 max-w-md text-center">
          <h2 className="text-lg font-semibold mb-2">Workspace not found</h2>
          <p className="text-[13px] text-muted mb-4">Your workspace wasn't created on signup. Run the SQL migration in Supabase or contact support.</p>
          <a href="/login" className="btn btn-primary inline-flex">Sign in again</a>
        </div>
      </div>
    );
  }

  const workspace = member.workspaces as unknown as Workspace;
  const role = (member.role as WorkspaceMember['role']) || 'admin';

  // 3. Fetch initial data in parallel — all scoped to workspace via RLS
  const [leadsRes, paymentsRes, activityRes] = await Promise.all([
    supabase.from('leads').select('*').order('updated_at', { ascending: false }),
    supabase.from('payments').select('*').order('created_at', { ascending: false }),
    supabase.from('activity').select('*').order('created_at', { ascending: false }).limit(50),
  ]);

  const displayName = (user.user_metadata?.full_name as string) || (user.user_metadata?.name as string) || (user.email || '').split('@')[0];

  return (
    <AppShell
      user={{ id: user.id, email: user.email || '', name: displayName }}
      workspace={workspace}
      role={role}
      initialLeads={(leadsRes.data || []) as Lead[]}
      initialPayments={(paymentsRes.data || []) as Payment[]}
      initialActivity={(activityRes.data || []) as Activity[]}
    >
      {children}
    </AppShell>
  );
}
