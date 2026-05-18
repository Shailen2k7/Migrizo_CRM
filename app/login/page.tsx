'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';

type Mode = 'signin' | 'signup';

function LoginForm() {
  const router = useRouter();
  const supabase = createClient();
  const params = useSearchParams();
  const next = params.get('next') || '/dashboard';

  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState<'google' | 'email' | null>(null);

  const handleGoogle = async () => {
    setLoading('google');
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${siteUrl}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    if (error) { toast.error(error.message); setLoading(null); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    if (password.length < 6) { toast.error('Password must be at least 6 characters'); return; }

    setLoading('email');

    if (mode === 'signup') {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { full_name: name.trim() || email.split('@')[0] },
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });
      setLoading(null);
      if (error) { toast.error(error.message); return; }
      // If email confirmation is OFF in Supabase, we get a session immediately.
      if (data.session) {
        toast.success('Account created — welcome!');
        router.push(next);
        router.refresh();
      } else {
        toast.success('Account created. Check your email to verify, then sign in.');
        setMode('signin');
      }
      return;
    }

    // Sign in
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(null);
    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('invalid login')) toast.error('Wrong email or password');
      else if (msg.includes('email not confirmed')) toast.error('Please confirm your email first — check your inbox');
      else toast.error(error.message);
      return;
    }
    toast.success('Signed in');
    router.push(next);
    router.refresh();
  };

  const isSignup = mode === 'signup';

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-12" style={{ background: 'hsl(var(--bg))' }}>
      <div className="w-full max-w-[420px]">
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-base" style={{ background: '#4F46E5' }}>M</div>
          <div className="text-xl font-bold tracking-tight">Migrizo</div>
        </div>

        <div className="panel p-8">
          <h1 className="text-2xl font-bold tracking-tight mb-1.5">
            {isSignup ? 'Create your account' : 'Sign in to Migrizo'}
          </h1>
          <p className="text-[13px] text-muted mb-6">
            {isSignup ? 'Get started with Migrizo CRM' : 'Welcome back. Enter your details below.'}
          </p>

          <button
            onClick={handleGoogle}
            disabled={loading !== null}
            type="button"
            className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-md border border-border bg-surface hover:bg-surface-2 transition-all text-[13.5px] font-medium disabled:opacity-50 mb-4"
          >
            <svg width="18" height="18" viewBox="0 0 18 18">
              <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" />
              <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" />
              <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" />
              <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" />
            </svg>
            {loading === 'google' ? 'Redirecting…' : 'Continue with Google'}
          </button>

          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border" /></div>
            <div className="relative flex justify-center"><span className="bg-surface px-3 text-[11px] uppercase tracking-wider text-muted font-medium">or</span></div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            {isSignup && (
              <div>
                <label className="input-label">Full name</label>
                <input
                  type="text"
                  placeholder="Shailendra Pathak"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="input"
                  disabled={loading !== null}
                />
              </div>
            )}

            <div>
              <label className="input-label">Email address</label>
              <input
                type="email"
                required
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
                disabled={loading !== null}
                autoComplete="email"
              />
            </div>

            <div>
              <label className="input-label">Password</label>
              <div className="relative">
                <input
                  type={showPwd ? 'text' : 'password'}
                  required
                  minLength={6}
                  placeholder={isSignup ? 'At least 6 characters' : 'Your password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input pr-16"
                  disabled={loading !== null}
                  autoComplete={isSignup ? 'new-password' : 'current-password'}
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(!showPwd)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted hover:text-ink font-medium"
                  tabIndex={-1}
                >
                  {showPwd ? 'Hide' : 'Show'}
                </button>
              </div>
              {isSignup && <p className="text-[11px] text-muted mt-1.5">Minimum 6 characters</p>}
            </div>

            <button
              type="submit"
              disabled={loading !== null || !email.trim() || !password}
              className="btn btn-primary w-full justify-center py-3 disabled:opacity-50 mt-2"
            >
              {loading === 'email' ? (isSignup ? 'Creating account…' : 'Signing in…') : (isSignup ? 'Create account' : 'Sign in')}
            </button>
          </form>

          <div className="mt-5 pt-5 border-t border-border text-center">
            <span className="text-[12.5px] text-muted">
              {isSignup ? 'Already have an account? ' : "Don't have an account? "}
            </span>
            <button
              type="button"
              onClick={() => { setMode(isSignup ? 'signin' : 'signup'); setPassword(''); }}
              className="text-[12.5px] font-semibold text-indigo-600 hover:underline"
            >
              {isSignup ? 'Sign in' : 'Sign up'}
            </button>
          </div>
        </div>

        <p className="text-[11.5px] text-muted text-center mt-6">By signing in you agree to keep your client data secure.</p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-muted text-sm">Loading…</div>}>
      <LoginForm />
    </Suspense>
  );
}
