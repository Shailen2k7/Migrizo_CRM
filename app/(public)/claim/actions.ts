"use server";

import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { audit } from "@/lib/audit";

export type ClaimState = { error?: string };

export async function claimProfile(token: string, _prev: ClaimState, formData: FormData): Promise<ClaimState> {
  const password = String(formData.get("password") || "");
  const confirm = String(formData.get("confirm") || "");
  if (password.length < 8) return { error: "Use at least 8 characters." };
  if (password !== confirm) return { error: "The two passwords don't match." };
  if (formData.get("consent") !== "on") return { error: "Please confirm you're happy for startups to see your profile." };

  const candidate = token ? await db.candidate.findUnique({ where: { claimToken: token }, include: { user: true } }) : null;
  if (!candidate) return { error: "This link has already been used. Sign in with your email and password instead." };

  await db.$transaction([
    db.user.update({ where: { id: candidate.userId }, data: { passwordHash: await bcrypt.hash(password, 10) } }),
    // Single use: the link stops working the moment the password is set.
    db.candidate.update({ where: { id: candidate.id }, data: { claimToken: null } }),
  ]);
  await audit(candidate.userId, "PROFILE_CLAIMED", "Candidate", candidate.id, candidate.user.email);
  await createSession(candidate.userId, candidate.user.role);
  redirect("/candidate/interview");
}
