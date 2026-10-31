"use client";

import { useFormState, useFormStatus } from "react-dom";
import { claimProfile, type ClaimState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending}
      className="w-full rounded-xl bg-primary px-4 py-2.5 text-14 font-semibold text-white shadow-pop transition hover:bg-primary-hover disabled:opacity-60"
    >
      {pending ? "One moment…" : "Set password & meet Maya"}
    </button>
  );
}

const inputCls =
  "w-full rounded-10 border border-line px-3.5 py-2.5 text-14 transition focus:border-primary focus:ring-2 focus:ring-primary/15";

export function ClaimForm({ token, email }: { token: string; email: string }) {
  const [state, action] = useFormState<ClaimState, FormData>(claimProfile.bind(null, token), {});
  return (
    <form action={action} className="space-y-4">
      <div>
        <label className="mb-1.5 block text-13 font-semibold text-slate2">Email</label>
        <input value={email} readOnly className={`${inputCls} bg-canvas2 text-muted`} />
      </div>
      <div>
        <label className="mb-1.5 block text-13 font-semibold text-slate2">Choose a password</label>
        <input name="password" type="password" minLength={8} required autoComplete="new-password" placeholder="At least 8 characters" className={inputCls} />
      </div>
      <div>
        <label className="mb-1.5 block text-13 font-semibold text-slate2">Repeat password</label>
        <input name="confirm" type="password" minLength={8} required autoComplete="new-password" className={inputCls} />
      </div>
      <label className="flex items-start gap-2 text-12 leading-relaxed text-slate2">
        <input type="checkbox" name="consent" required className="mt-0.5 h-4 w-4 shrink-0 accent-primary" />
        <span>
          I&apos;m happy for MigRizo to show my profile to startups hiring through it, under the{" "}
          <a href="/terms" className="font-semibold text-primary hover:underline">terms</a> and{" "}
          <a href="/privacy" className="font-semibold text-primary hover:underline">privacy policy</a>.
        </span>
      </label>
      {state.error && <p className="rounded-10 bg-[#fdecec] px-3.5 py-2 text-13 font-medium text-[#b3261e]">{state.error}</p>}
      <SubmitButton />
    </form>
  );
}
