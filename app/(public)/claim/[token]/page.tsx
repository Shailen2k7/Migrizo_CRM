import Link from "next/link";
import { db } from "@/lib/db";
import { pageMeta } from "@/lib/seo";
import { MayaAvatar } from "@/components/maya-avatar";
import { ClaimForm } from "../claim-form";

export const dynamic = "force-dynamic";

// Personal one-time links: never indexed.
export const metadata = pageMeta({ title: "Claim Your Profile", description: "Set your password and meet Maya.", path: "/claim", noindex: true });

export default async function ClaimPage({ params }: { params: { token: string } }) {
  const candidate = await db.candidate.findUnique({
    where: { claimToken: params.token },
    include: { user: { select: { name: true, email: true } } },
  });

  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-10">
      <div className="mg-fade-up w-full max-w-sm">
        <Link href="/" className="mb-7 flex items-center justify-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white">
            <span className="msym text-[18px]">public</span>
          </span>
          <span className="text-18 font-bold text-ink">MigRizo</span>
        </Link>
        <div className="mg-glass rounded-18 border border-white/80 p-7 shadow-lift">
          {candidate ? (
            <>
              <div className="mb-4 flex items-center gap-3">
                <MayaAvatar size={44} />
                <div>
                  <h1 className="text-20 font-bold text-ink">Hi {candidate.user.name.split(" ")[0]}</h1>
                  <p className="text-13 text-muted">Your talent profile is ready.</p>
                </div>
              </div>
              <p className="mb-5 text-13 leading-relaxed text-muted">
                Set a password to open it. Next you&apos;ll check your details and take a short spoken interview with Maya, about 15
                minutes. Startups see your profile once it&apos;s done.
              </p>
              <ClaimForm token={params.token} email={candidate.user.email} />
            </>
          ) : (
            <>
              <h1 className="text-20 font-bold text-ink">This link has been used</h1>
              <p className="mb-5 mt-1 text-14 leading-relaxed text-muted">
                Each invite link works once. If you already set your password, sign in with your email to continue with Maya.
              </p>
              <Link href="/login" className="inline-flex w-full items-center justify-center rounded-xl bg-primary px-4 py-2.5 text-14 font-semibold text-white shadow-pop transition hover:bg-primary-hover">
                Sign in
              </Link>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
