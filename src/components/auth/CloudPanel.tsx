"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  CloudOff,
  Cloud,
  Loader2,
  LogOut,
  RefreshCw,
  Users,
} from "lucide-react";
import { useSession } from "@/lib/session";
import { missingSupabaseEnv, supabaseConfigured, supabaseHost } from "@/lib/supabase";
import { flushSync } from "@/lib/sync";
import { useStore } from "@/lib/store";
import { Badge, Button, Card, toast } from "@/components/ui";

/**
 * Answers "is this actually connected to the database?" without anyone having
 * to read the code — the question that is otherwise impossible to settle from
 * inside the running app.
 */
export function CloudPanel() {
  const status = useSession((s) => s.status);
  const workspace = useSession((s) => s.workspace);
  const syncing = useSession((s) => s.syncing);
  const lastSyncedAt = useSession((s) => s.lastSyncedAt);
  const lockCloud = useSession((s) => s.lock);
  const txnCount = useStore((s) => s.transactions.length);

  /* Not configured — say exactly what is missing. */
  if (!supabaseConfigured) {
    const missing = missingSupabaseEnv();
    return (
      <Card className="border-warning/30 p-6" hover={false}>
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
          <CloudOff size={15} className="text-warning" /> Cloud Sync — Not Connected
        </h2>
        <p className="mb-4 text-[13px] text-text-3">
          This build has no database keys, so your books live only in this browser. Nobody else can
          see them and they will not appear on another device.
        </p>
        <div className="rounded-md border border-border-strong/40 p-3">
          <p className="label-caps mb-2">Missing environment variables</p>
          <ul className="space-y-1">
            {missing.map((m) => (
              <li key={m} className="num text-[12px] text-negative">
                {m}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[12px] leading-relaxed text-text-3">
            Add these in Netlify under Site configuration → Environment variables, then{" "}
            <span className="font-semibold text-text-2">redeploy</span>. They are baked into the
            build, so changing them without a fresh deploy has no effect.
          </p>
        </div>
      </Card>
    );
  }

  const connected = status === "ready";

  return (
    <Card className="p-6" hover={false}>
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <Cloud size={15} className={connected ? "text-positive" : "text-text-3"} /> Cloud Sync
        {connected ? (
          <Badge tone="positive">Connected</Badge>
        ) : (
          <Badge tone="warning">{status}</Badge>
        )}
      </h2>
      <p className="mb-4 text-[13px] text-text-3">
        Your books are stored in Postgres, so the same data opens on every device.
      </p>

      <dl className="mb-5 grid gap-x-6 gap-y-2 sm:grid-cols-2">
        <Row label="Project" value={supabaseHost() ?? "—"} />
        <Row label="Workspace" value={workspace?.name ?? "—"} />
        <Row label="Transactions synced" value={String(txnCount)} />
        <Row
          label="Last saved"
          value={
            syncing
              ? "saving…"
              : lastSyncedAt
                ? new Date(lastSyncedAt).toLocaleTimeString("en-IN")
                : "no changes yet"
          }
        />
      </dl>

      {connected && (
        <>
          <div className="mb-5 rounded-md border border-border-strong/40 p-3">
            <p className="label-caps mb-2 flex items-center gap-1.5">
              <Users size={12} /> Who can get in
            </p>
            <p className="text-[13px] leading-relaxed text-text-2">
              Anyone with the site link and the master password. There are no individual
              accounts — everyone opens the same books, on any device.
            </p>
            <p className="mt-2.5 text-[12px] leading-relaxed text-text-3">
              Because there is no per-person login, the only way to revoke access is to change
              the password and redeploy. Treat the site URL as private.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={async () => {
                await flushSync();
                toast("Everything saved to the cloud.");
              }}
            >
              <RefreshCw size={14} /> Save now
            </Button>
            <Button
              onClick={async () => {
                await flushSync();
                lockCloud();
              }}
            >
              <LogOut size={14} /> Lock app
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border-strong/25 py-1.5">
      <dt className="label-caps">{label}</dt>
      <dd className="num truncate text-[13px] font-medium">{value}</dd>
    </div>
  );
}

/** Compact "is it connected" pill for the sidebar. */
export function CloudBadge() {
  const status = useSession((s) => s.status);
  const syncing = useSession((s) => s.syncing);

  if (!supabaseConfigured) {
    return (
      <span className="flex items-center gap-1.5 text-[11px] font-medium text-text-3">
        <CloudOff size={12} /> Local only
      </span>
    );
  }
  if (status === "ready") {
    return (
      <span className="flex items-center gap-1.5 text-[11px] font-medium text-positive">
        {syncing ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <CheckCircle2 size={12} />
        )}
        {syncing ? "Saving…" : "Synced"}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-[11px] font-medium text-warning">
      <Cloud size={12} /> Connecting…
    </span>
  );
}
