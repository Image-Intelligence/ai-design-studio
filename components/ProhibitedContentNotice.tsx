import { Shield } from "lucide-react"

/**
 * The site-wide content policy notice.
 *
 * The payment processor (CCBill) asked for a clearly stated prohibition on
 * deepfakes and non-consensual impersonation, visible on the site itself and
 * not only inside the Terms. Shown on the home page and the user dashboard;
 * the Refs unlock pop-up carries its own, longer version. One component, so
 * the wording cannot drift between pages.
 */
export function ProhibitedContentNotice({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-start gap-3 rounded-xl border border-red-500/20 bg-red-500/[0.05] px-4 py-3 ${className}`}>
      <Shield size={15} className="text-red-300/80 shrink-0 mt-0.5" />
      <p className="text-[12px] text-slate-300 leading-relaxed">
        <span className="font-semibold text-white">Prohibited content.</span>{" "}
        The creation, upload, distribution, or use of deepfake content, non-consensual impersonation
        of any real person, and any illegal or policy-violating AI-generated content is strictly
        prohibited on this site.{" "}
        <a href="/terms#prohibited" className="text-red-200 hover:underline whitespace-nowrap">Read the full policy →</a>
      </p>
    </div>
  )
}
