import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { PageTitle, Icon, verificationChip } from "@/components/ui";
import { CandidateProfileView } from "@/components/candidate-profile";
import { RevealObserver } from "@/components/reveal";
import { fmtDate } from "@/lib/format";
import { decideVerification, suspendCandidate } from "../../actions";
import { inviteCandidate } from "../../invite-actions";
import { INVITE_ACTION } from "@/lib/maya-invite";
import { resumeOnFile } from "@/lib/resume";

export const dynamic = "force-dynamic";

export default async function AdminCandidateDetail({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { imported?: string; needcv?: string; invited?: string; invitefail?: string };
}) {
  await requireUser("ADMIN");
  const candidate = await db.candidate.findUnique({
    where: { id: params.id },
    include: {
      user: true,
      skills: true,
      experiences: { orderBy: { order: "asc" } },
      educations: { orderBy: { order: "asc" } },
      documents: true,
      verifications: { orderBy: { createdAt: "desc" } },
      interviews: { include: { score: true } },
    },
  });
  if (!candidate) notFound();

  const [lastInvite, claimed] =
    candidate.source === "ADMIN_IMPORT"
      ? await Promise.all([
          db.auditLog.findFirst({ where: { action: INVITE_ACTION, entityId: candidate.id }, orderBy: { createdAt: "desc" } }),
          db.auditLog.findFirst({ where: { action: "PROFILE_CLAIMED", entityId: candidate.id } }),
        ])
      : [null, null];
  const interviewed = candidate.interviews.some((i) => i.status === "COMPLETED" || i.status === "EVALUATED");
  const invite = inviteCandidate.bind(null, candidate.id);
  const approve = decideVerification.bind(null, candidate.id, "APPROVED");
  const reject = decideVerification.bind(null, candidate.id, "REJECTED");
  const suspend = suspendCandidate.bind(null, candidate.id);
  const hasResume = resumeOnFile(candidate);

  return (
    <div className="max-w-6xl">
      <RevealObserver />
      {searchParams.needcv && (
        <div className="mb-5 flex items-center gap-2.5 rounded-14 border border-[#f6d6d3] bg-[#fff5f4] px-4 py-3 text-14 text-[#b3261e]">
          <Icon name="error" className="text-[18px]" />
          Not approved: this profile has no resume on file. Ask the candidate to upload one first.
        </div>
      )}
      {searchParams.imported && (
        <div className="mb-5 flex items-center gap-2.5 rounded-14 border border-[#d7f5e6] bg-[#f4fdf8] px-4 py-3 text-14 text-green-deep">
          <Icon name="check_circle" className="text-[18px]" />
          Profile created from CV import. The source file was never stored.
        </div>
      )}
      {searchParams.invited && (
        <div className="mb-5 flex items-center gap-2.5 rounded-14 border border-[#d7f5e6] bg-[#f4fdf8] px-4 py-3 text-14 text-green-deep">
          <Icon name="mark_email_read" className="text-[18px]" />
          Maya invite sent to {candidate.user.email}.
        </div>
      )}
      {searchParams.invitefail && (
        <div className="mb-5 flex items-center gap-2.5 rounded-14 border border-[#f6d6d3] bg-[#fff5f4] px-4 py-3 text-14 text-[#b3261e]">
          <Icon name="error" className="text-[18px]" />
          Invite not sent: {searchParams.invitefail}.
        </div>
      )}
      {/* The title spans both columns, so the profile and the review panel start level. */}
      <PageTitle
        title={candidate.user.name}
        subtitle={candidate.user.email}
        action={verificationChip(candidate.verificationStatus)}
      />

      <div className="grid items-start gap-6 lg:grid-cols-[1fr,320px]">
        <div className="min-w-0">
          <CandidateProfileView candidate={candidate} />
        </div>

        <aside className="space-y-4">
        {/* Verification decision */}
        {candidate.verificationStatus === "PENDING" && (
          <div className="rounded-18 border border-[#f4e3c2] bg-[#fdf8ec] p-5">
            <h3 className="flex items-center gap-1.5 text-14 font-bold text-amber-deep">
              <Icon name="pending_actions" className="text-[17px]" /> Awaiting your review
            </h3>
            <form className="mt-3 space-y-2.5">
              <textarea
                name="note"
                rows={2}
                placeholder="Internal note (shared with candidate if rejected)"
                className="w-full rounded-10 border border-line bg-white px-3 py-2 text-13"
              />
              {!hasResume && (
                <div className="flex items-start gap-2 rounded-xl border border-[#f6d6d3] bg-white px-3 py-2.5 text-12 leading-relaxed text-[#b3261e]">
                  <Icon name="description" className="mt-px shrink-0 text-[16px]" />
                  <span>
                    <strong>No resume on file.</strong> Approval unlocks once the candidate uploads one. You can still reject with a note.
                  </span>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                {hasResume ? (
                  <button formAction={approve} className="rounded-10 bg-green-deep px-3 py-2 text-13 font-semibold text-white transition hover:brightness-110">
                    Approve
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled
                    title="A resume is required before approval"
                    className="inline-flex cursor-not-allowed items-center justify-center gap-1 rounded-10 bg-[#e6e4ee] px-3 py-2 text-13 font-semibold text-muted2"
                  >
                    <Icon name="lock" className="text-[15px]" /> Approve
                  </button>
                )}
                <button formAction={reject} className="rounded-10 bg-[#b3261e] px-3 py-2 text-13 font-semibold text-white transition hover:brightness-110">
                  Reject
                </button>
              </div>
            </form>
          </div>
        )}

        {candidate.discoverable && (
          <form action={suspend} className="rounded-18 border border-line bg-white p-5 shadow-card">
            <h3 className="text-14 font-bold text-ink">Live in search</h3>
            <p className="mt-1 text-12 text-muted">This candidate is visible to employers.</p>
            <button className="mt-2.5 w-full rounded-10 border border-line px-3 py-2 text-13 font-semibold text-[#b3261e] transition hover:bg-[#fdecec]">
              Remove from search
            </button>
          </form>
        )}

        {candidate.source === "ADMIN_IMPORT" && !interviewed && (
          <form action={invite} className="rounded-18 border border-line bg-white p-5 shadow-card">
            <h3 className="flex items-center gap-1.5 text-14 font-bold text-ink">
              <Icon name="graphic_eq" className="text-[17px] text-primary" /> Maya interview
            </h3>
            <p className="mt-1 text-12 leading-relaxed text-muted">
              {claimed
                ? `Profile claimed ${fmtDate(claimed.createdAt)}. They can sign in and take Maya.`
                : lastInvite
                  ? `Invited ${fmtDate(lastInvite.createdAt)}. Not claimed yet.`
                  : "Not invited yet. Hidden from employers until the interview is done."}
            </p>
            {!claimed && (
              <button className="mt-2.5 w-full rounded-10 bg-primary px-3 py-2 text-13 font-semibold text-white transition hover:brightness-110">
                {lastInvite ? "Resend invite" : "Send Maya invite"}
              </button>
            )}
          </form>
        )}

        {/* Documents */}
        <div className="rounded-18 border border-line bg-white p-5 shadow-card">
          <h3 className="mb-2.5 flex items-center justify-between gap-2 text-14 font-bold text-ink">
            <span>Documents ({candidate.documents.length})</span>
            {hasResume ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-mint px-2 py-0.5 text-11 font-bold text-green-deep">
                <Icon name="check_circle" fill className="text-[13px]" /> {candidate.source === "ADMIN_IMPORT" && !candidate.documents.some((d) => d.kind === "CV") ? "CV imported" : "Resume on file"}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#fdecec] px-2 py-0.5 text-11 font-bold text-[#b3261e]">
                <Icon name="error" className="text-[13px]" /> Resume missing
              </span>
            )}
          </h3>
          {candidate.documents.length === 0 ? (
            <p className="text-13 text-muted">No documents uploaded.</p>
          ) : (
            <ul className="space-y-1.5">
              {candidate.documents.map((d) => {
                const ext = d.fileName.split(".").pop()?.toLowerCase() || "";
                const icon = ext === "pdf" ? "picture_as_pdf" : ["png", "jpg", "jpeg", "webp", "gif"].includes(ext) ? "image" : "description";
                const opens = ["pdf", "png", "jpg", "jpeg", "webp", "gif"].includes(ext);
                return (
                  <li key={d.id} className="flex items-center gap-2 rounded-xl border border-line bg-white px-2.5 py-2 transition duration-200 hover:border-[#c2beda] hover:shadow-card">
                    <Icon name={icon} className="shrink-0 text-[16px] text-muted2" />
                    <a
                      href={`/api/documents/${d.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={opens ? `Open ${d.fileName}` : `Download ${d.fileName}`}
                      className="min-w-0 flex-1 truncate text-13 font-medium text-slate2 transition-colors hover:text-primary hover:underline"
                    >
                      {d.fileName}
                    </a>
                    <span className="shrink-0 text-11 text-muted2">{(d.sizeBytes / 1024).toFixed(0)} KB</span>
                    {opens && (
                      <a
                        href={`/api/documents/${d.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Open ${d.fileName}`}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted2 transition duration-200 hover:bg-lavender hover:text-primary"
                      >
                        <Icon name="open_in_new" className="text-[15px]" />
                      </a>
                    )}
                    <a
                      href={`/api/documents/${d.id}?download=1`}
                      aria-label={`Download ${d.fileName}`}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted2 transition duration-200 hover:bg-lavender hover:text-primary"
                    >
                      <Icon name="download" className="text-[15px]" />
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Verification history */}
        <div className="rounded-18 border border-line bg-white p-5 shadow-card">
          <h3 className="mb-2.5 text-14 font-bold text-ink">Verification history</h3>
          {candidate.verifications.length === 0 ? (
            <p className="text-13 text-muted">Never submitted.</p>
          ) : (
            <div className="space-y-2.5">
              {candidate.verifications.map((v) => (
                <div key={v.id} className="text-12">
                  <span className={`font-bold ${v.status === "APPROVED" ? "text-green-deep" : v.status === "REJECTED" ? "text-[#b3261e]" : "text-amber-deep"}`}>
                    {v.status}
                  </span>
                  <span className="text-muted"> · {fmtDate(v.createdAt)}</span>
                  {v.note && <p className="mt-0.5 text-muted">{v.note}</p>}
                </div>
              ))}
            </div>
          )}
          </div>
        </aside>
      </div>
    </div>
  );
}
