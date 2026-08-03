import { Metadata } from 'next'
import Link from 'next/link'
import { SitePageHeader, SiteBrandHero } from '@/components/SitePageHeader'

export const metadata: Metadata = {
  title: 'Documents & Policies | AI Design Studio',
  description: 'All legal documents and policies for AI Design Studio — Terms of Service, Privacy Policy, Refund Policy, and Content Reporting.',
}

const POLICIES = [
  {
    href: '/terms',
    title: 'Terms of Service',
    description:
      'The agreement that governs your use of AI Design Studio — eligibility (18+), acceptable use, content rules, ticket purchases and subscriptions, and your rights and responsibilities as a user.',
  },
  {
    href: '/privacy',
    title: 'Privacy Policy',
    description:
      'What information we collect, how it is used and stored, who it is shared with, and the choices you have about your personal data.',
  },
  {
    href: '/refund',
    title: 'Refund Policy',
    description:
      'How refunds work for ticket purchases and subscriptions — what qualifies, how to request one, and expected processing times.',
  },
  {
    href: '/report',
    title: 'Content Reporting',
    description:
      'Report content that violates our rules or your rights — complaints, takedown requests, and appeals from depicted persons. All reports are reviewed and resolved within seven days.',
  },
]

export default function PoliciesPage() {
  return (
    <div className="min-h-screen bg-[#050810] text-slate-100 flex flex-col">
      <SitePageHeader />

      {/* flex-1 + justify-center: portrait screens distribute the content down the
          page instead of leaving the bottom half empty; landscape still scrolls */}
      <main className="flex-1 flex flex-col justify-center max-w-4xl mx-auto w-full px-4 py-10 gap-8">
        <SiteBrandHero />

        <div>
          <h1 className="text-center text-lg font-bold text-white uppercase tracking-[0.2em] mb-1">Documents &amp; Policies</h1>
          <p className="text-center text-sm text-slate-500">
            Everything that governs AI Design Studio in one place. Select a document to read it in full.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {POLICIES.map(p => (
            <Link
              key={p.href}
              href={p.href}
              className="group block rounded-xl border border-white/10 bg-white/[0.03] p-5 sm:p-6 hover:border-white/25 hover:bg-white/[0.05] transition-all"
            >
              <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-2">
                {p.title} <span className="text-slate-500 group-hover:text-slate-300 transition-colors">→</span>
              </h2>
              <p className="text-[13px] text-slate-400 leading-relaxed">{p.description}</p>
            </Link>
          ))}
        </div>

        {/* Contact — part of the document set (business info + billing support) */}
        <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-1">Contact Us</h2>
            <p className="text-[13px] text-slate-400 leading-relaxed">
              Business information for Prompt &amp; Protocol LLC and billing support through CCBill,
              our payment processor — for questions about charges, cancellations, and refunds.
            </p>
          </div>
          <Link
            href="/contact"
            className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-white/15 bg-white/[0.06] text-sm font-semibold text-slate-200 hover:text-white hover:border-white/30 transition-all"
          >
            Open the Contact page →
          </Link>
        </section>

        <p className="text-center text-xs text-slate-600">
          © {new Date().getFullYear()} Prompt &amp; Protocol LLC · Orlando, Florida, USA
        </p>
      </main>
    </div>
  )
}
