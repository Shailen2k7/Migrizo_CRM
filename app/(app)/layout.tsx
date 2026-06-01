import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AppShell } from '@/components/shared/app-shell';
import { AuthStatusScreen } from '@/components/auth-status-screen';
import type { Workspace, Lead, Payment, Activity } from '@/lib/types';

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();

  // 1. Get authenticated user
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) redirect('/login');

  const displayName = (user.user_metadata?.full_name as string) ||
                      (user.user_metadata?.name as string) ||
                      (user.email || '').split('@')[0];

  // 2. Look up membership (this works regardless of status because the RLS policy allows users to see their own row)
  const { data: member } = await supabase
    .from('workspace_members')
    .select('workspace_id, role, status, can_view_payments, workspaces:workspaces(*)')
    .eq('user_id', user.id)
    .maybeSingle();

  // 3. If no membership row at all, the signup trigger didn't fire — fail gracefully
  if (!member) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8" style={{ background: 'hsl(var(--bg))' }}>
        <div className="panel p-8 max-w-md text-center">
          <h2 className="text-lg font-semibold mb-2">Account setup incomplete</h2>
          <p className="text-[13px] text-muted mb-4">
            Your account exists but isn't linked to any workspace. The admin needs to add you manually.
          </p>
          <p className="text-[11.5px] text-muted">Signed in as {user.email}</p>
          <form action="/auth/signout" method="POST" className="mt-4">
            <a href="/login" className="btn btn-primary inline-flex">Back to sign in</a>
          </form>
        </div>
      </div>
    );
  }

  // 4. Gate based on status — check BEFORE workspace data
  //    (pending/paused users may not be able to read the workspaces row via RLS, which is OK)
  if (member.status === 'pending') {
    return <AuthStatusScreen status="pending" userEmail={user.email || ''} userName={displayName} />;
  }
  if (member.status === 'paused') {
    return <AuthStatusScreen status="paused" userEmail={user.email || ''} userName={displayName} />;
  }

  // 5. Active member — need workspace data to render the app
  if (!member.workspaces) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8" style={{ background: 'hsl(var(--bg))' }}>
        <div className="panel p-8 max-w-md text-center">
          <h2 className="text-lg font-semibold mb-2">Workspace not found</h2>
          <p className="text-[13px] text-muted mb-4">Your workspace data couldn't be loaded. Try signing out and back in.</p>
          <a href="/login" className="btn btn-primary inline-flex">Back to sign in</a>
        </div>
      </div>
    );
  }

  const workspace = member.workspaces as unknown as Workspace;
  const role = (member.role as 'admin' | 'member') || 'member';
  // Admins always see payments; members depend on their flag (default true)
  const canViewPayments = role === 'admin' ? true : ((member as { can_view_payments?: boolean }).can_view_payments ?? true);

  const [leadsRes, paymentsRes, activityRes] = await Promise.all([
    supabase.from('leads').select('*').order('updated_at', { ascending: false }),
    supabase.from('payments').select('*').order('created_at', { ascending: false }),
    supabase.from('activity').select('*').order('created_at', { ascending: false }).limit(30),
  ]);

  return (
    <AppShell
      user={{ id: user.id, email: user.email || '', name: displayName }}
      workspace={workspace}
      role={role}
      canViewPayments={canViewPayments}
      initialLeads={(leadsRes.data || []) as Lead[]}
      initialPayments={(paymentsRes.data || []) as Payment[]}
      initialActivity={(activityRes.data || []) as Activity[]}
    >
      {children}
    </AppShell>
  );
}
