"use client";

import { useEffect, useState } from "react";
import {
  Building2,
  CloudOff,
  Loader2,
  LockKeyhole,
  LogIn,
  RefreshCw,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useLock, passwordProblem, verifyMasterPassword } from "@/lib/auth";
import { WORKSPACE_ID, useSession } from "@/lib/session";
import { supabaseConfigured } from "@/lib/supabase";
import { hydrateFromCloud, startSync, stopSync, uploadLocalToCloud } from "@/lib/sync";
import { useStore } from "@/lib/store";
import { Button, Card, Field, Input } from "@/components/ui";

/**
 * Two supported modes, chosen by whether Supabase keys were built in:
 *
 *   cloud (keys present) → real per-person accounts, one shared set of books
 *   local (no keys)      → master password, data stays in this browser
 *
 * The local branch is what `npm run dev` gets without secrets, and what a
 * deploy falls back to if its env vars are missing — so a misconfigured build
 * degrades visibly instead of rendering nothing.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  if (!supabaseConfigured) return <LocalGate>{children}</LocalGate>;
  return <CloudGate>{children}</CloudGate>;
}

/* ── Shared chrome ───────────────────────────────────────────────────────── */

function Shell({
  title,
  sub,
  footer,
  children,
}: {
  title: string;
  sub: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="app-bg flex min-h-screen items-center justify-center p-5">
      <div className="w-full max-w-[400px] animate-fade-up">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-fg">
            <Building2 size={20} />
          </div>
          <div>
            <p className="text-[15px] font-bold leading-tight tracking-tight">Founder Finance OS</p>
            <p className="label-caps mt-0.5">Executive Portal</p>
          </div>
        </div>
        <Card className="p-6" hover={false}>
          <h1 className="text-xl font-bold tracking-tight">{title}</h1>
          <p className="mb-5 mt-1 text-[13px] text-text-3">{sub}</p>
          {children}
        </Card>
        {footer}
      </div>
    </div>
  );
}

function Splash({ label }: { label: string }) {
  return (
    <div className="app-bg flex min-h-screen flex-col items-center justify-center gap-3">
      <Loader2 size={22} className="animate-spin text-text-3" />
      <p className="text-[13px] text-text-3">{label}</p>
    </div>
  );
}

function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-[13px] font-medium text-negative">
      {children}
    </p>
  );
}

/* ── Cloud mode ──────────────────────────────────────────────────────────── */

function CloudGate({ children }: { children: React.ReactNode }) {
  const status = useSession((s) => s.status);
  const workspace = useSession((s) => s.workspace);
  const hydrated = useSession((s) => s.hydrated);
  const error = useSession((s) => s.error);
  const init = useSession((s) => s.init);
  const setHydrated = useSession((s) => s.setHydrated);
  const [hydrateError, setHydrateError] = useState<string | null>(null);

  useEffect(() => {
    void init();
  }, [init]);

  // Pull the workspace's books down, then keep them mirrored.
  useEffect(() => {
    if (status !== "ready" || !workspace || hydrated) return;
    let cancelled = false;
    (async () => {
      try {
        await hydrateFromCloud(workspace.id);
        if (cancelled) return;
        startSync(workspace.id);
        setHydrated(true);
      } catch (e) {
        if (!cancelled) setHydrateError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, workspace, hydrated, setHydrated]);

  useEffect(() => () => stopSync(), []);

  if (status === "loading") return <Splash label="Opening…" />;
  if (status === "error") {
    return (
      <Shell
        title="Couldn't reach your database"
        sub="The app is configured for cloud sync, but the connection failed."
      >
        <ErrorNote>{error}</ErrorNote>
        <div className="mt-4 space-y-2">
          <p className="text-[12px] leading-relaxed text-text-3">
            Check in Supabase → Project Settings → API that{" "}
            <span className="num text-text-2">NEXT_PUBLIC_SUPABASE_URL</span> is the Project URL and{" "}
            <span className="num text-text-2">NEXT_PUBLIC_SUPABASE_ANON_KEY</span> is the anon public
            key. On Netlify, change them and then redeploy — they are baked in at build time.
          </p>
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            onClick={() => window.location.reload()}
          >
            <RefreshCw size={15} /> Try again
          </Button>
        </div>
      </Shell>
    );
  }
  if (status === "locked") return <MasterPasswordScreen />;

  if (hydrateError) {
    return (
      <Shell
        title="Couldn't load your books"
        sub="The password was right, but reading the data failed. This usually means the schema hasn't been run yet, or the anon key is wrong."
      >
        <ErrorNote>{hydrateError}</ErrorNote>
        <p className="mt-3 text-[12px] leading-relaxed text-text-3">
          Run <code className="text-text-2">supabase/schema.sql</code> in your project&apos;s SQL editor,
          then reload.
        </p>
      </Shell>
    );
  }
  if (!hydrated) return <Splash label="Loading your books…" />;

  return <>{children}</>;
}

/**
 * The only way in: one master password, no accounts, no email.
 *
 * The password is checked locally against a shipped PBKDF2 hash, then the app
 * opens a single shared cloud session behind the scenes so every device sees
 * the same books. On the very first run it also creates the workspace and
 * uploads whatever this browser is holding.
 */
/**
 * The only way in: one master password. No accounts, no email, no sign-up.
 *
 * The password is checked in the browser against a PBKDF2 hash compiled into
 * the build; passing it opens the shared cloud workspace directly with the
 * anon key.
 */
function MasterPasswordScreen() {
  const enter = useSession((s) => s.enter);
  const setHydrated = useSession((s) => s.setHydrated);
  const localCount = useStore((s) => s.transactions.length);
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);

    if (!(await verifyMasterPassword(pw))) {
      setBusy(false);
      setPw("");
      return setErr("That password is not right.");
    }

    const fail = enter();
    if (fail) {
      setBusy(false);
      return setErr(fail);
    }

    // First run against an empty cloud: seed it from this browser so books
    // already imported here are not stranded locally.
    if (localCount > 0) {
      try {
        const { empty } = await hydrateFromCloud(WORKSPACE_ID);
        if (empty) await uploadLocalToCloud(WORKSPACE_ID);
      } catch {
        // Real problems surface on the gate's own error screen.
      }
      setHydrated(false);
    }
    setBusy(false);
  };

  return (
    <Shell
      title="Enter password"
      sub="One password opens the books. They are stored in the cloud, so the same data appears on every device."
    >
      <form onSubmit={submit} className="space-y-3.5">
        <Field label="Password">
          <Input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            autoFocus
            autoComplete="current-password"
            required
          />
        </Field>
        {err && <ErrorNote>{err}</ErrorNote>}
        <Button variant="primary" size="lg" type="submit" className="w-full" disabled={busy}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <LockKeyhole size={15} />}
          {busy ? "Opening your books…" : "Open"}
        </Button>
      </form>
    </Shell>
  );
}

/* ── Local mode (no keys) ────────────────────────────────────────────────── */

function LocalGate({ children }: { children: React.ReactNode }) {
  const salt = useLock((s) => s.salt);
  const hash = useLock((s) => s.hash);
  const unlocked = useLock((s) => s.unlocked);
  const restoreSession = useLock((s) => s.restoreSession);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    restoreSession();
    setReady(true);
  }, [restoreSession]);

  if (!ready) return <Splash label="Opening your books…" />;

  const hasPassword = !!salt && !!hash;
  if (!hasPassword) return <SetPasswordScreen />;
  if (!unlocked) return <UnlockScreen />;
  return <>{children}</>;
}

const localFooter = (
  <p className="mt-4 flex items-start gap-1.5 text-center text-[11px] leading-relaxed text-text-3">
    <CloudOff size={13} className="mt-px flex-none" />
    <span className="text-left">
      Cloud sync is off, so this data stays in this browser only. Add your Supabase keys to share
      these books across devices and people.
    </span>
  </p>
);

function SetPasswordScreen() {
  const setPassword = useLock((s) => s.setPassword);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (pw !== pw2) return setErr("Passwords do not match.");
    const problem = passwordProblem(pw);
    if (problem) return setErr(problem);
    setBusy(true);
    const fail = await setPassword(pw);
    setBusy(false);
    if (fail) setErr(fail);
  };

  return (
    <Shell
      title="Set your master password"
      sub="One password opens Founder Finance OS. There is no account and no recovery — if you forget it you can clear the app data and start again, so store it in your password manager."
      footer={localFooter}
    >
      <form onSubmit={submit} className="space-y-3.5">
        <Field label="Master password">
          <Input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="At least 8 characters, 1 number"
            autoFocus
            autoComplete="new-password"
          />
        </Field>
        <Field label="Confirm password">
          <Input
            type="password"
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
        {err && <ErrorNote>{err}</ErrorNote>}
        <Button variant="primary" size="lg" type="submit" className="w-full" disabled={busy}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />}
          Set password &amp; continue
        </Button>
      </form>
    </Shell>
  );
}

function UnlockScreen() {
  const unlock = useLock((s) => s.unlock);
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const fail = await unlock(pw);
    setBusy(false);
    if (fail) {
      setErr(fail);
      setPw("");
    }
  };

  return (
    <Shell
      title="Enter master password"
      sub="Unlock your books for this session."
      footer={localFooter}
    >
      <form onSubmit={submit} className="space-y-3.5">
        <Field label="Master password">
          <Input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            autoFocus
            autoComplete="current-password"
          />
        </Field>
        {err && <ErrorNote>{err}</ErrorNote>}
        <Button variant="primary" size="lg" type="submit" className="w-full" disabled={busy}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <LockKeyhole size={15} />}
          Unlock
        </Button>
      </form>
    </Shell>
  );
}
