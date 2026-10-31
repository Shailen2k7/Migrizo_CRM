"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { notify } from "@/lib/notify";
import { pendingInviteIds, sendMayaInvite } from "@/lib/maya-invite";

export async function inviteCandidate(candidateId: string): Promise<void> {
  const admin = await requireUser("ADMIN");
  const out = await sendMayaInvite(candidateId, admin.id);
  revalidatePath(`/admin/candidates/${candidateId}`);
  redirect(`/admin/candidates/${candidateId}?${out.sent ? "invited=1" : `invitefail=${encodeURIComponent(out.reason || "failed")}`}`);
}

export type BulkInviteResult = { sent?: number; failed?: { candidateId: string; reason?: string }[]; error?: string };

// One click sends at most this many, so a run stays well inside the
// serverless time limit. Press again for the rest.
const BATCH = 60;

export async function inviteAllPending(_prev: BulkInviteResult, formData: FormData): Promise<BulkInviteResult> {
  const admin = await requireUser("ADMIN");
  if (String(formData.get("confirm") || "") !== "on") return { error: "Tick the box to confirm the emails should go out." };
  const ids = (await pendingInviteIds()).slice(0, BATCH);
  if (ids.length === 0) return { sent: 0, failed: [] };
  let sent = 0;
  const failed: { candidateId: string; reason?: string }[] = [];
  for (const id of ids) {
    const out = await sendMayaInvite(id, admin.id);
    if (out.sent) sent++;
    else failed.push({ candidateId: id, reason: out.reason });
  }
  await notify(admin.id, "Maya invites sent", `${sent} invite${sent === 1 ? "" : "s"} sent${failed.length ? `, ${failed.length} not sent` : ""}.`, "/admin/imports");
  revalidatePath("/admin/imports");
  return { sent, failed };
}
