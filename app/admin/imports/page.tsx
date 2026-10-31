import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { PageTitle, Icon, StatusChip } from "@/components/ui";
import { aiEnabled, checkAI, modelVersion } from "@/lib/ai/provider";
import { timeAgo } from "@/lib/format";
import { CvUploader } from "./import-forms";
import { MayaInviteCard } from "./invite-card";
import { INVITE_ACTION, pendingInviteIds } from "@/lib/maya-invite";

export const dynamic = "force-dynamic";

export default async function AdminImportsPage() {
  await requireUser("ADMIN");
  const [imports, pendingInvites, invitedRows, health] = await Promise.all([
    db.candidateImport.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
    pendingInviteIds(),
    db.auditLog.findMany({ where: { action: INVITE_ACTION }, select: { entityId: true }, distinct: ["entityId"] }),
    checkAI(),
  ]);
  const pending = imports.filter((i) => i.status === "PARSED");
  const history = imports.filter((i) => i.status !== "PARSED");

  return (
    <div className="max-w-4xl">
      <PageTitle
        title="Import from CV"
        subtitle="Upload a CV, check what was read from it, approve the person into the talent network."
      />

      {!health.ok && (
        <div className="mb-5 flex items-center gap-2.5 rounded-14 border border-[#f4e3c2] bg-[#fdf8ec] px-4 py-3 text-13 text-amber-deep">
          <Icon name="warning" className="text-[17px]" />
          AI not answering ({health.detail}), so extraction falls back to a basic pattern parser.
        </div>
      )}

      <CvUploader />

      <MayaInviteCard pending={pendingInvites.length} invited={invitedRows.length} aiReady={health.ok} />

      {/* How it works */}
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {[
          ["neurology", "1 · Extract", `AI (${aiEnabled() ? modelVersion() : "fallback"}) reads the CV and maps it to profile fields, flagging anything uncertain.`],
          ["fact_check", "2 · Review", "You check every field against the CV text side by side, fix what's off, and fill the gaps."],
          ["auto_delete", "3 · Approve, file deleted", "The profile is created; the CV file itself was never written to disk, only its text extract."],
        ].map(([icon, t, b]) => (
          <div key={t as string} className="rounded-14 border border-line bg-white p-4 shadow-card">
            <Icon name={icon as string} className="text-[20px] text-primary" />
            <div className="mt-1.5 text-13 font-bold text-ink">{t}</div>
            <div className="mt-0.5 text-12 leading-relaxed text-muted">{b}</div>
          </div>
        ))}
      </div>

      {/* Pending queue */}
      {pending.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-16 font-bold text-ink">Awaiting review</h2>
          <div className="divide-y divide-line overflow-hidden rounded-18 border border-line bg-white shadow-card">
            {pending.map((i) => (
              <Link key={i.id} href={`/admin/imports/${i.id}`} className="flex items-center gap-3 px-5 py-3.5 transition hover:bg-canvas2">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#fdf3e2]">
                  <Icon name="pending_actions" className="text-[18px] text-amber-deep" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-14 font-semibold text-ink">{i.fileName}</div>
                  <div className="text-12 text-muted">
                    Parsed {timeAgo(i.createdAt)} · {(i.fileSizeBytes / 1024).toFixed(0)} KB
                  </div>
                </div>
                <span className="text-13 font-semibold text-primary">Review →</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-16 font-bold text-ink">History</h2>
          <div className="overflow-hidden rounded-18 border border-line bg-white shadow-card">
            <table className="w-full text-left text-13">
              <thead>
                <tr className="border-b border-line bg-canvas2 text-12 text-muted2">
                  <th className="px-5 py-2.5 font-semibold">File</th>
                  <th className="px-5 py-2.5 font-semibold">Engine</th>
                  <th className="px-5 py-2.5 font-semibold">Status</th>
                  <th className="px-5 py-2.5 text-right font-semibold">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {history.map((i) => (
                  <tr key={i.id}>
                    <td className="px-5 py-2.5 font-medium text-ink">
                      {i.candidateId ? (
                        <Link href={`/admin/candidates/${i.candidateId}`} className="hover:underline">
                          {i.fileName}
                        </Link>
                      ) : (
                        i.fileName
                      )}
                    </td>
                    <td className="px-5 py-2.5 text-muted">
                      {i.engine.startsWith("migrizo/") ? (
                        <span className="text-amber-deep">Heuristic</span>
                      ) : (
                        <span className="text-green-deep">AI · {i.engine}</span>
                      )}
                    </td>
                    <td className="px-5 py-2.5">
                      <StatusChip tone={i.status === "APPROVED" ? "green" : "gray"}>
                        {i.status.toLowerCase()}
                      </StatusChip>
                    </td>
                    <td className="px-5 py-2.5 text-right text-muted2">{timeAgo(i.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
