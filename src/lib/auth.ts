"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

/* ──────────────────────────────────────────────────────────────
   Master password lock

   One password guards the whole app — no accounts, no roles. The password
   itself is never stored; only a PBKDF2 hash with a random salt, so reading
   localStorage does not reveal it.

   Be clear-eyed about what this protects: it stops someone casually opening
   your books on an unattended screen. It is not encryption — the financial
   data itself sits in localStorage in plain form, so anyone with devtools and
   physical access to the machine can still read it. Real protection arrives
   with the Supabase backend, where data lives on the server behind auth.
   ────────────────────────────────────────────────────────────── */

/* ──────────────────────────────────────────────────────────────
   Shipped team password

   The app ships already locked with a shared password rather than asking the
   first visitor to choose one — otherwise, on a public deployment, whoever
   loads the URL first gets to set the password and everyone else is locked
   out of the founder's own books.

   Only the PBKDF2 hash and its salt live here, so the password itself is not
   sitting in the source. That said: a shared secret committed to a repo is
   only as private as the repo and the people who have ever been told it, and
   it does not identify *who* signed in. It is a front door lock on a public
   URL, appropriate for keeping casual visitors out — not for protecting
   financial data from someone who wants it. Per-user Supabase accounts are
   the real answer; see SUPABASE_SETUP.md.

   To change it, use Settings → Master Password (that writes a fresh random
   salt and hash to this browser and takes precedence over this default).
   ────────────────────────────────────────────────────────────── */
const SHIPPED_SALT = "f0a91c47d63b2e58a1c904fb7e236d80";
const SHIPPED_HASH = "58812f20d9f39e8a2bae18f5e214af837f56db0c275678e153cf550d92b7ca41";

const UNLOCK_KEY = "ffos-unlocked-until";
/** How long one unlock lasts. Long enough that you type it once a day. */
const UNLOCK_HOURS = 12;

function markUnlocked() {
  try {
    localStorage.setItem(UNLOCK_KEY, String(Date.now() + UNLOCK_HOURS * 3600_000));
  } catch {}
}

function clearUnlocked() {
  try {
    localStorage.removeItem(UNLOCK_KEY);
  } catch {}
}

function unlockStillValid(): boolean {
  try {
    const until = Number(localStorage.getItem(UNLOCK_KEY) ?? 0);
    if (!until) return false;
    if (Date.now() > until) {
      clearUnlocked();
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function randomSalt(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashPassword(password: string, salt: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode(salt), iterations: 150_000, hash: "SHA-256" },
    key,
    256
  );
  return Array.from(new Uint8Array(bits))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Check a password against the one shipped with the build.
 *
 * Used by the cloud gate, where there are no accounts: this password is the
 * whole front door, and the cloud session behind it is shared by everyone.
 * Compared in constant time against a PBKDF2 hash, so the password itself is
 * not sitting in the bundle in readable form.
 */
export async function verifyMasterPassword(password: string): Promise<boolean> {
  const candidate = await hashPassword(password, SHIPPED_SALT);
  return safeEqual(candidate, SHIPPED_HASH);
}

export function passwordProblem(pw: string): string | null {
  if (pw.length < 8) return "Password must be at least 8 characters.";
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return "Use at least one letter and one number.";
  return null;
}

interface LockState {
  salt: string | null;
  hash: string | null;
  /**
   * Set when someone deliberately removes the password. Without this, "no
   * password" is indistinguishable from "never set one", and the shipped
   * default would silently reinstate itself on the next reload.
   */
  passwordDisabled: boolean;
  /** Derived from a timed flag; not part of the persisted password record. */
  unlocked: boolean;

  setPassword: (pw: string) => Promise<string | null>;
  unlock: (pw: string) => Promise<string | null>;
  lock: () => void;
  changePassword: (current: string, next: string) => Promise<string | null>;
  restoreSession: () => void;
  /** Removes the password entirely — the app opens without a prompt. */
  removePassword: (current: string) => Promise<string | null>;
}

export const useLock = create<LockState>()(
  persist(
    (set, get) => ({
      // Starts on the shipped team password; replaced the moment anyone sets
      // their own in Settings, and that override is what persists.
      salt: SHIPPED_SALT,
      hash: SHIPPED_HASH,
      passwordDisabled: false,
      unlocked: false,

      setPassword: async (pw) => {
        const problem = passwordProblem(pw);
        if (problem) return problem;
        const salt = randomSalt();
        const hash = await hashPassword(pw, salt);
        set({ salt, hash, passwordDisabled: false, unlocked: true });
        markUnlocked();
        return null;
      },

      unlock: async (pw) => {
        const { salt, hash } = get();
        if (!salt || !hash) return "No password is set.";
        const attempt = await hashPassword(pw, salt);
        if (!safeEqual(attempt, hash)) return "Incorrect password.";
        set({ unlocked: true });
        markUnlocked();
        return null;
      },

      lock: () => {
        set({ unlocked: false });
        clearUnlocked();
      },

      changePassword: async (current, next) => {
        const { salt, hash } = get();
        if (salt && hash) {
          const attempt = await hashPassword(current, salt);
          if (!safeEqual(attempt, hash)) return "Current password is incorrect.";
        }
        const problem = passwordProblem(next);
        if (problem) return problem;
        const newSalt = randomSalt();
        const newHash = await hashPassword(next, newSalt);
        set({ salt: newSalt, hash: newHash, passwordDisabled: false });
        return null;
      },

      removePassword: async (current) => {
        const { salt, hash } = get();
        if (!salt || !hash) return null;
        const attempt = await hashPassword(current, salt);
        if (!safeEqual(attempt, hash)) return "Current password is incorrect.";
        set({ salt: null, hash: null, passwordDisabled: true, unlocked: true });
        clearUnlocked();
        return null;
      },

      // salt+hash persist on disk; the unlock is a separate timed flag shared
      // across tabs, so you type the password once rather than per tab.
      restoreSession: () => {
        if (unlockStillValid()) set({ unlocked: true });
      },
    }),
    {
      // Bumped from v1 so browsers that had already chosen their own password
      // adopt the shared team one — otherwise "one password for everyone"
      // would silently not apply to anyone who had used the app before.
      name: "ffos-lock-v2",
      partialize: (s) => ({ salt: s.salt, hash: s.hash, passwordDisabled: s.passwordDisabled }),
      // Fall back to the shipped password only when none was ever chosen —
      // never when someone deliberately removed it.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<LockState>;
        const disabled = p.passwordDisabled === true;
        return {
          ...current,
          ...p,
          passwordDisabled: disabled,
          salt: disabled ? null : (p.salt ?? current.salt),
          hash: disabled ? null : (p.hash ?? current.hash),
        };
      },
    }
  )
);

export function hasPasswordSet(): boolean {
  const { salt, hash } = useLock.getState();
  return !!salt && !!hash;
}
