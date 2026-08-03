import { Metadata } from 'next'
import Link from 'next/link'
import { SitePageHeader, SiteBrandHero } from '@/components/SitePageHeader'

export const metadata: Metadata = {
  title: 'Contact Us | AI Design Studio',
  description: 'Contact information for Prompt & Protocol LLC and billing support through CCBill.',
}

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-[#050810] text-slate-100 flex flex-col">
      <SitePageHeader />

      {/* flex-1 + justify-center: portrait screens distribute the content down the
          page instead of leaving the bottom half empty; landscape still scrolls */}
      <main className="flex-1 flex flex-col justify-center max-w-4xl mx-auto w-full px-4 py-10 gap-8">
        <SiteBrandHero />

        <div>
          <h1 className="text-center text-lg font-bold text-white uppercase tracking-[0.2em] mb-1">Contact Us</h1>
          <p className="text-center text-sm text-slate-500">How to reach us — and who to contact about billing.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* Business information */}
          <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
            <h2 className="text-sm font-bold text-white mb-3 uppercase tracking-wider">Business Information</h2>
            <dl className="space-y-2.5 text-sm">
              <div className="flex gap-3">
                <dt className="w-28 shrink-0 text-slate-500">Business Name</dt>
                <dd className="text-slate-200 font-medium">Prompt &amp; Protocol LLC</dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-28 shrink-0 text-slate-500">City</dt>
                <dd className="text-slate-200">Orlando</dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-28 shrink-0 text-slate-500">State</dt>
                <dd className="text-slate-200">Florida</dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-28 shrink-0 text-slate-500">Country</dt>
                <dd className="text-slate-200">USA</dd>
              </div>
            </dl>
          </section>

          {/* Billing support — CCBill */}
          <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
            <h2 className="text-sm font-bold text-white mb-3 uppercase tracking-wider">Billing Support (CCBill)</h2>
            <p className="text-[13px] text-slate-400 leading-relaxed mb-3">
              Payments are processed by <span className="text-slate-200 font-medium">CCBill</span>. For questions about a
              charge, cancellations, or refunds, contact CCBill consumer support:
            </p>
            <dl className="space-y-2.5 text-sm">
              <div className="flex gap-3">
                <dt className="w-28 shrink-0 text-slate-500">Support Email</dt>
                <dd>
                  <a href="mailto:support@ccbill.com" className="text-slate-200 hover:text-white underline underline-offset-2 decoration-slate-600">
                    support@ccbill.com
                  </a>
                </dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-28 shrink-0 text-slate-500">Support Site</dt>
                <dd>
                  <a
                    href="https://support.ccbill.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-slate-200 hover:text-white underline underline-offset-2 decoration-slate-600"
                  >
                    support.ccbill.com
                  </a>
                </dd>
              </div>
            </dl>
            <p className="text-[11px] text-slate-600 leading-relaxed mt-3">
              CCBill consumer support is available 24/7 for billing inquiries related to purchases made through CCBill.
            </p>
          </section>
        </div>

        {/* Content reports — slim row */}
        <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-1">Report Content</h2>
            <p className="text-[13px] text-slate-400 leading-relaxed">
              Complaints, takedown requests, and depicted-person appeals are handled through our reporting form.
              All reports are reviewed and resolved within seven days.
            </p>
          </div>
          <Link
            href="/report"
            className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-white/15 bg-white/[0.06] text-sm font-semibold text-slate-200 hover:text-white hover:border-white/30 transition-all"
          >
            Open the Report form →
          </Link>
        </section>

        <div className="flex items-center justify-between text-xs text-slate-600">
          <p>© {new Date().getFullYear()} Prompt &amp; Protocol LLC · Orlando, Florida, USA</p>
          <Link href="/policies" className="text-slate-500 hover:text-slate-300 underline underline-offset-2 decoration-slate-700">
            Documents &amp; Policies
          </Link>
        </div>
      </main>
    </div>
  )
}
