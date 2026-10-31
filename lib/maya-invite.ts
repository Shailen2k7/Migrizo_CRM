import crypto from "crypto";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { sendEmail } from "@/lib/email";

/**
 * Maya invites for profiles the MigRizo team created from a CV.
 *
 * An imported candidate has an account they have never seen: a random
 * password and a single-use claimToken. The invite emails a /claim/<token>
 * link; opening it lets them set a password, which signs them in and takes
 * them straight to their interview with Maya. The token is cleared once
 * claimed, so the link works exactly once.
 *
 * Every send is written to the audit log as MAYA_INVITE_SENT (entity
 * Candidate). That log is also how the bulk sender knows who already has one.
 */

export const INVITE_ACTION = "MAYA_INVITE_SENT";

const appUrl = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function mayaInviteEmail(opts: { name: string; title: string | null; link: string }) {
  const first = opts.name.trim().split(/\s+/)[0] || "there";
  const subject = "Your MigRizo talent profile is ready: one step left";
  const text = [
    `Hi ${first},`,
    ``,
    `Thank you for sharing your CV with Migrizo. We have turned it into a MigRizo talent profile${opts.title ? ` as ${opts.title}` : ""}, so startups hiring remote talent can find you.`,
    ``,
    `One step is left before employers can see it: a short spoken interview with Maya, our AI interviewer. It takes about 15 minutes, you can do it from your laptop or phone, and your score goes with every application.`,
    ``,
    `1. Open your profile and set a password: ${opts.link}`,
    `2. Check your details, then start your interview with Maya.`,
    ``,
    `This link is personal and works once. If you would rather not be listed, just reply to this email and we will remove your profile.`,
    ``,
    `The MigRizo team`,
  ].join("\n");

  const html = `
<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;color:#131b2e">
  <div style="padding:24px 0 8px"><strong style="font-size:18px">MigRizo</strong></div>
  <h1 style="font-size:22px;margin:8px 0 12px">Your talent profile is ready</h1>
  <p style="font-size:14px;line-height:1.6;color:#464555">Hi ${esc(first)}, thank you for sharing your CV with Migrizo. We have turned it into a MigRizo talent profile${opts.title ? ` as <strong>${esc(opts.title)}</strong>` : ""}, so startups hiring remote talent can find you.</p>
  <div style="border:1px solid #e4e2f0;border-radius:14px;padding:16px 18px;margin:18px 0;background:#f7f6ff">
    <div style="font-size:14px;font-weight:700">One step left: your interview with Maya</div>
    <div style="font-size:13px;line-height:1.6;color:#464555;margin-top:6px">A short spoken interview with Maya, our AI interviewer. About 15 minutes, on laptop or phone. Employers see your profile once it is done, and your score goes with every application.</div>
  </div>
  <a href="${esc(opts.link)}" style="display:inline-block;background:#3525cd;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 22px;border-radius:12px">Set your password &amp; meet Maya</a>
  <p style="font-size:12px;color:#8b8899;margin-top:12px">This link is personal and works once. If you would rather not be listed, reply to this email and we will remove your profile.</p>
  <p style="font-size:13px;color:#464555;margin-top:20px">The MigRizo team</p>
</div>`;
  return { subject, text, html };
}

export type InviteOutcome = { candidateId: string; sent: boolean; reason?: string };

/** Sends (or re-sends) one invite. Never touches an account that was already claimed. */
export async function sendMayaInvite(candidateId: string, adminId: string): Promise<InviteOutcome> {
  const candidate = await db.candidate.findUnique({
    where: { id: candidateId },
    include: { user: true, interviews: { select: { status: true } } },
  });
  if (!candidate) return { candidateId, sent: false, reason: "not found" };
  if (candidate.source !== "ADMIN_IMPORT") return { candidateId, sent: false, reason: "signed up themselves" };
  if (candidate.interviews.some((i) => i.status === "COMPLETED" || i.status === "EVALUATED"))
    return { candidateId, sent: false, reason: "interview already done" };

  let token = candidate.claimToken;
  if (!token) {
    // A missing token means the account was claimed (or created without one).
    // Only mint a new one if nobody has ever claimed it.
    const claimed = await db.auditLog.findFirst({ where: { action: "PROFILE_CLAIMED", entityId: candidate.id } });
    if (claimed) return { candidateId, sent: false, reason: "already claimed, they can sign in" };
    token = crypto.randomBytes(24).toString("hex");
    await db.candidate.update({ where: { id: candidate.id }, data: { claimToken: token } });
  }

  const mail = mayaInviteEmail({
    name: candidate.user.name,
    title: candidate.currentTitle || candidate.headline,
    link: `${appUrl()}/claim/${token}`,
  });
  const { delivered } = await sendEmail({ to: candidate.user.email, ...mail });
  if (!delivered) return { candidateId, sent: false, reason: "email provider rejected it" };
  await audit(adminId, INVITE_ACTION, "Candidate", candidate.id, candidate.user.email);
  return { candidateId, sent: true };
}

/** Imported, not interviewed, never invited: the bulk sender's queue. */
export async function pendingInviteIds(): Promise<string[]> {
  const [pool, invited] = await Promise.all([
    db.candidate.findMany({
      where: {
        source: "ADMIN_IMPORT",
        claimToken: { not: null },
        interviews: { none: { status: { in: ["COMPLETED", "EVALUATED"] } } },
      },
      select: { id: true },
    }),
    db.auditLog.findMany({ where: { action: INVITE_ACTION }, select: { entityId: true } }),
  ]);
  const done = new Set(invited.map((a) => a.entityId));
  return pool.map((c) => c.id).filter((id) => !done.has(id));
}
