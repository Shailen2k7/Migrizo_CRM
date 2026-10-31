"use client";

import { useFormState, useFormStatus } from "react-dom";
import { Icon } from "@/components/ui";
import { inviteAllPending, type BulkInviteResult } from "../invite-actions";

function SendButton({ count }: { count: number }) {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending || count === 0}
      className="rounded-10 bg-primary px-4 py-2.5 text-13 font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
    >
      {pending ? "Sending invites…" : `Send ${Math.min(count, 60)} Maya invite${count === 1 ? "" : "s"}`}
    </button>
  );
}

export function MayaInviteCard({ pending, invited, aiReady }: { pending: number; invited: number; aiReady: boolean }) {
  const [state, action] = useFormState<BulkInviteResult, FormData>(inviteAllPending, {});
  return (
    <div className="mt-6 rounded-18 border border-line bg-white p-5 shadow-card">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#efedff]">
          <Icon name="graphic_eq" className="text-[20px] text-primary" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-15 font-bold text-ink">Invite imported talent to Maya</h2>
          <p className="mt-0.5 text-13 leading-relaxed text-muted">
            Imported profiles stay hidden until the person takes their interview. The invite emails a one-time link: they set a
            password, land on their profile and start Maya. <strong className="text-ink">{pending}</strong> waiting for an invite ·{" "}
            <strong className="text-ink">{invited}</strong> invited so far.
          </p>
          {!aiReady && (
            <p className="mt-2 flex items-center gap-1.5 rounded-10 bg-[#fdf8ec] px-3 py-2 text-12 font-medium text-amber-deep">
              <Icon name="warning" className="text-[15px]" />
              The AI engine is not answering (see Settings). Fix it before inviting, or Maya will use generic questions and basic scoring.
            </p>
          )}
          {pending > 0 && (
            <form action={action} className="mt-3 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-13 text-slate2">
                <input type="checkbox" name="confirm" className="h-4 w-4 accent-primary" />
                Yes, email these candidates now
              </label>
              <SendButton count={pending} />
            </form>
          )}
          {state.error && <p className="mt-2 text-13 font-medium text-[#b3261e]">{state.error}</p>}
          {typeof state.sent === "number" && (
            <p className="mt-2 text-13 font-medium text-green-deep">
              {state.sent} invite{state.sent === 1 ? "" : "s"} sent
              {state.failed && state.failed.length > 0 ? `, ${state.failed.length} not sent (${Array.from(new Set(state.failed.map((f) => f.reason))).join(", ")})` : ""}.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
