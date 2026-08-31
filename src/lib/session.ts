"use client";

import { create } from "zustand";
import { getSupabase, supabaseConfigProblem, supabaseConfigured } from "./supabase";

/**
 * Cloud session for a single-password app.
 *
 * There are no user accounts, no sign-up and no email anywhere. One master
 * password opens the app, and the data is read and written with Supabase's
 * anon key against one fixed workspace.
 *
 * The security posture, stated plainly: the anon key is compiled into the
 * browser bundle and is public, so anyone holding the site URL can reach the
 * data directly whether or not they know the password. The password stops
 * casual access; keeping the URL private is the real boundary. Routing through
 * a shared Supabase Auth account would not have changed this — those
 * credentials would have shipped in the same bundle — so this trades no
 * security for a great deal less machinery.
 */

/** The one workspace every copy of the app reads and writes. Seeded by schema.sql. */
export const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const WORKSPACE_NAME = "Migrizo & Nutrolis";

/** Remembers the password for this tab so a reload doesn't ask again. */
const UNLOCK_KEY = "ffos-unlocked";

export type CloudStatus =
  | "offline" // no keys — local-only mode
  | "loading"
  | "locked" // waiting for the master password
  | "ready"
  | "error";

export interface WorkspaceInfo {
  id: string;
  name: string;
}

interface SessionState {
  status: CloudStatus;
  workspace: WorkspaceInfo | null;
  error: string | null;
  /** True once the initial pull from Postgres has finished. */
  hydrated: boolean;
  lastSyncedAt: string | null;
  syncing: boolean;

  init: () => void;
  /** Called once the master password has been verified. */
  enter: () => string | null;
  lock: () => void;
  setHydrated: (v: boolean) => void;
  setSyncing: (v: boolean) => void;
  markSynced: () => void;
  setError: (message: string | null) => void;
}

const workspace: WorkspaceInfo = { id: WORKSPACE_ID, name: WORKSPACE_NAME };

function rememberUnlock(on: boolean) {
  try {
    if (on) sessionStorage.setItem(UNLOCK_KEY, "1");
    else sessionStorage.removeItem(UNLOCK_KEY);
  } catch {
    // Private browsing can refuse sessionStorage; the app still works, it just
    // asks for the password again after a reload.
  }
}

function wasUnlocked(): boolean {
  try {
    return sessionStorage.getItem(UNLOCK_KEY) === "1";
  } catch {
    return false;
  }
}

export const useSession = create<SessionState>()((set) => ({
  status: supabaseConfigured ? "loading" : "offline",
  workspace: null,
  error: null,
  hydrated: false,
  lastSyncedAt: null,
  syncing: false,

  init: () => {
    if (!supabaseConfigured) return set({ status: "offline" });

    // A mistyped key must say so rather than fail later as a mystery.
    const problem = supabaseConfigProblem();
    if (problem) return set({ status: "error", error: problem });
    if (!getSupabase()) {
      return set({ status: "error", error: "Could not create the Supabase client." });
    }

    set(
      wasUnlocked()
        ? { status: "ready", workspace, error: null }
        : { status: "locked", workspace: null, error: null }
    );
  },

  enter: () => {
    const problem = supabaseConfigProblem();
    if (problem) {
      set({ status: "error", error: problem });
      return problem;
    }
    rememberUnlock(true);
    set({ status: "ready", workspace, error: null });
    return null;
  },

  lock: () => {
    rememberUnlock(false);
    set({ status: "locked", workspace: null, hydrated: false, lastSyncedAt: null });
  },

  setHydrated: (v) => set({ hydrated: v }),
  setSyncing: (v) => set({ syncing: v }),
  markSynced: () => set({ lastSyncedAt: new Date().toISOString(), syncing: false }),
  setError: (message) => set({ error: message, status: message ? "error" : "ready" }),
}));
