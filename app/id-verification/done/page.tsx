import Link from "next/link"
import { SitePageHeader } from "@/components/SitePageHeader"

/*
 * Where /api/id-verification/return lands the person after Didit. The
 * verification usually ran in its own tab, which the portal is polling - so
 * this page mostly says "you can close this tab", with a way back in case the
 * flow replaced the portal tab instead.
 */
const COPY: Record<string, { title: string; body: string }> = {
  approved: { title: "You're verified", body: "Uploads are unlocked on your account. You can close this tab - the studio has already updated." },
  review: { title: "Almost there", body: "Your ID is being reviewed. That usually takes a few minutes; uploads unlock on their own once it's approved." },
  declined: { title: "We couldn't verify you", body: "The check didn't pass. You can try again from any upload button - make sure your ID is valid, fully in frame and well lit. You must be 18 or over." },
  mismatch: { title: "Wrong account", body: "This verification belongs to a different account. Sign in to the account that started it and try again." },
  signin: { title: "Sign in to finish", body: "Sign in again, then press an upload button to check your verification." },
  pending: { title: "Verification in progress", body: "We haven't received the result yet. Go back to the studio - it updates on its own when the check finishes." },
}

export default async function IdVerificationDone({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  const { s } = await searchParams
  const c = COPY[s ?? ""] ?? COPY.pending
  return (
    <div className="min-h-screen bg-[#050810] text-white">
      <SitePageHeader />
      <main className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-100">{c.title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-400">{c.body}</p>
        <Link href="/admin/portal-v2" className="mt-8 inline-flex items-center justify-center rounded-lg border border-white/15 bg-white/[0.06] px-4 py-2 text-sm text-slate-100 transition-colors hover:bg-white/[0.12]">
          Back to the studio
        </Link>
      </main>
    </div>
  )
}
