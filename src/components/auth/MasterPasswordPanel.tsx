"use client";

import { useState } from "react";
import { KeyRound, Loader2, Lock, ShieldCheck, X } from "lucide-react";
import { useLock } from "@/lib/auth";
import { Button, Card, Field, Input, toast } from "@/components/ui";

export function MasterPasswordPanel() {
  const hasPassword = useLock((s) => !!s.hash);
  const changePassword = useLock((s) => s.changePassword);
  const setPassword = useLock((s) => s.setPassword);
  const removePassword = useLock((s) => s.removePassword);
  const lock = useLock((s) => s.lock);

  const [mode, setMode] = useState<"idle" | "change" | "remove">("idle");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [next2, setNext2] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setMode("idle");
    setCurrent("");
    setNext("");
    setNext2("");
    setErr(null);
  };

  const submitChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (next !== next2) return setErr("New passwords do not match.");
    setBusy(true);
    const fail = hasPassword ? await changePassword(current, next) : await setPassword(next);
    setBusy(false);
    if (fail) return setErr(fail);
    toast("Master password updated");
    reset();
  };

  const submitRemove = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const fail = await removePassword(current);
    setBusy(false);
    if (fail) return setErr(fail);
    toast("Password removed — the app now opens without a prompt", "info");
    reset();
  };

  return (
    <Card className="p-6" hover={false}>
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <ShieldCheck size={15} className="text-text-3" /> Master Password
      </h2>
      <p className="mb-4 text-xs text-text-3">
        {hasPassword
          ? "One password opens the app. It is stored only as a salted hash, and you are asked for it once per browser session."
          : "No password is set — the app opens straight to your books. Set one to keep casual eyes out."}
      </p>

      {mode === "idle" && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setMode("change")}>
            <KeyRound size={14} /> {hasPassword ? "Change password" : "Set password"}
          </Button>
          {hasPassword && (
            <>
              <Button variant="secondary" onClick={lock}>
                <Lock size={14} /> Lock now
              </Button>
              <Button variant="danger" onClick={() => setMode("remove")}>
                <X size={14} /> Remove password
              </Button>
            </>
          )}
        </div>
      )}

      {mode === "change" && (
        <form onSubmit={submitChange} className="max-w-sm space-y-3">
          {hasPassword && (
            <Field label="Current password">
              <Input
                type="password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                autoFocus
                autoComplete="current-password"
              />
            </Field>
          )}
          <Field label="New password">
            <Input
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              placeholder="8+ characters, 1 number"
              autoComplete="new-password"
            />
          </Field>
          <Field label="Confirm new password">
            <Input
              type="password"
              value={next2}
              onChange={(e) => setNext2(e.target.value)}
              autoComplete="new-password"
            />
          </Field>
          {err && (
            <p className="rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-[13px] font-medium text-negative">
              {err}
            </p>
          )}
          <div className="flex gap-2">
            <Button variant="primary" type="submit" disabled={busy}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />} Save
            </Button>
            <Button variant="ghost" type="button" onClick={reset}>
              <X size={14} /> Cancel
            </Button>
          </div>
        </form>
      )}

      {mode === "remove" && (
        <form onSubmit={submitRemove} className="max-w-sm space-y-3 rounded-md border border-negative/30 bg-negative/5 p-4">
          <p className="text-sm font-semibold text-negative">
            Anyone opening this browser will see your books immediately.
          </p>
          <Field label="Confirm with your current password">
            <Input
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoFocus
              autoComplete="current-password"
            />
          </Field>
          {err && (
            <p className="rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-[13px] font-medium text-negative">
              {err}
            </p>
          )}
          <div className="flex gap-2">
            <Button variant="danger" type="submit" disabled={busy}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />} Remove password
            </Button>
            <Button variant="ghost" type="button" onClick={reset}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
