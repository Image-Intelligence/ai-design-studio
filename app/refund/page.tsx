import { Metadata } from 'next'
import { SitePageHeader, SiteBrandHero } from '@/components/SitePageHeader'

export const metadata: Metadata = {
  title: 'Refund Policy | AI Design Studio',
  description: 'Refund Policy for AI Design Studio — Prompt & Protocol LLC',
}

export default function RefundPage() {
  return (
    <div className="min-h-screen bg-[#050810] text-slate-100">
      <SitePageHeader />
      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="mb-10">
          <SiteBrandHero />
        </div>
        <h1 className="text-center text-lg font-bold text-white uppercase tracking-[0.2em] mb-1">
          Refund Policy
        </h1>
        <p className="text-center text-sm text-slate-500 mb-2">Last Updated: February 27, 2026 | Version 1.0</p>
        <p className="text-center text-sm text-slate-500 mb-8">Prompt &amp; Protocol LLC — AI Design Studio</p>

        <div className="space-y-8 text-slate-300">

          {/* Overview box */}
          <div className="border-2 border-amber-500/30 bg-amber-500/[0.05] p-6 rounded-lg">
            <h2 className="text-xl font-bold mb-3 text-amber-300">Policy Summary</h2>
            <p className="text-sm leading-relaxed">
              All ticket purchases and subscription fees paid to Prompt &amp; Protocol LLC are <strong className="text-white">final and non-refundable</strong>,
              with one limited exception: verifiable technical failures that resulted in ticket deductions without any generated output.
              In those cases, a <strong className="text-white">ticket credit</strong> (not a cash refund) will be issued to your account.
              Please read this policy in full before making any purchase.
            </p>
          </div>

          <section>
            <h2 className="text-2xl font-bold mb-4 text-white">1. Why We Do Not Offer Refunds</h2>
            <p className="mb-4">
              AI Design Studio operates on a compute-cost model. Every image generation request dispatches a live call to
              third-party AI infrastructure (fal.ai, Google Gemini API) that incurs real-time GPU and API costs the moment
              it is submitted — regardless of whether the output meets your expectations or whether you choose to keep the result.
            </p>
            <p className="mb-4">These costs are:</p>
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li><strong>Immediate and non-recoupable</strong> — charged to us the instant a generation is triggered</li>
              <li><strong>Per-request</strong> — every individual generation consumes real infrastructure resources</li>
              <li><strong>Independent of satisfaction</strong> — costs are incurred whether or not you like the result</li>
              <li><strong>Independent of usage</strong> — costs are incurred even if you purchase tickets and never use them, as capacity is reserved</li>
            </ul>
            <p className="mt-4">
              Because these costs cannot be recovered, we are unable to offer cash refunds on ticket purchases, subscription fees,
              or any other payment made to Prompt &amp; Protocol LLC.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold mb-4 text-white">2. Ticket Purchases — No Refunds</h2>
            <p className="mb-4">
              All one-time ticket purchases are <strong>final at the moment of payment confirmation</strong>. No refund will be issued for:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li>Tickets that have been fully or partially spent on generations</li>
              <li>Tickets that remain unused at the time of account closure or termination</li>
              <li>Purchases made in error (wrong quantity, wrong package, duplicate purchases)</li>
              <li>Dissatisfaction with the quality, style, or content of AI-generated outputs</li>
              <li>Generations blocked or filtered by AI safety systems (tickets are reserved but refunded automatically by our system — see Section 4)</li>
              <li>Account suspensions or terminations resulting from violations of our Terms of Service</li>
              <li>Changes to ticket pricing or model availability after purchase</li>
            </ul>
            <p className="mt-4 font-semibold text-amber-300">
              Ticket balances have no cash value and cannot be transferred, sold, traded, or converted to any form of monetary compensation.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold mb-4 text-white">3. Subscription Fees — No Refunds</h2>
            <p className="mb-4">
              All subscription payments (Dev Tier — Biweekly, Monthly, or Yearly) are <strong>non-refundable</strong>, including:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li>Partial billing periods (if you cancel mid-cycle, your access continues until the end of the paid period — no prorated refund is issued)</li>
              <li>Billing cycles where you did not actively use the Service</li>
              <li>Tickets allocated at the start of a billing cycle that were not used before the next cycle</li>
              <li>Automatic renewal charges — it is your responsibility to cancel before the renewal date</li>
              <li>Charges for billing cycles during which the Service experienced partial downtime due to third-party provider issues</li>
            </ul>

            <h3 className="text-xl font-semibold mb-3 mt-6 text-slate-300">3.1 How to Cancel Your Subscription</h3>
            <p className="mb-4">
              You may cancel your subscription at any time through your account settings. Cancellation stops future billing immediately.
              Your subscription and any remaining ticket balance remain active through the end of the current paid period.
              Cancellation does not trigger a refund of any amount already charged.
            </p>
            <p className="mb-4">
              If you are unable to cancel through the account settings, contact us at{' '}
              <a href="mailto:promptandprotocol@gmail.com" className="text-slate-300 hover:text-white underline underline-offset-2 decoration-slate-600">promptandprotocol@gmail.com</a>{' '}
              before your next renewal date. We cannot retroactively cancel charges for billing cycles that have already been processed.
            </p>
          </section>

          <section className="border-2 border-white/15 bg-white/[0.04] p-6 rounded-lg">
            <h2 className="text-2xl font-bold mb-4 text-white">4. The Only Exception: Technical Failure Credits</h2>
            <p className="mb-4">
              We recognize that technical failures can occasionally occur — situations where our system or a third-party provider
              deducted tickets from your account but produced no image output. This is the <strong>only circumstance</strong> under
              which we will issue compensation, and that compensation takes the form of a <strong>ticket credit to your account</strong>,
              not a cash or payment refund.
            </p>

            <h3 className="text-xl font-semibold mb-3 text-slate-300">4.1 What Qualifies as a Technical Failure</h3>
            <p className="mb-2">A qualifying technical failure is specifically:</p>
            <ul className="list-disc list-inside space-y-2 ml-4 mb-4">
              <li>Tickets were deducted from your balance AND</li>
              <li>No image was delivered to your canvas or gallery AND</li>
              <li>The failure was caused by a server-side error, API timeout, or infrastructure outage on our end or our providers' end</li>
            </ul>
            <p className="mb-4 font-semibold text-amber-300">The following do NOT qualify as technical failures:</p>
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li>Generations blocked by AI content safety filters (your tickets are automatically refunded by our system in real time)</li>
              <li>Images generated successfully but disliked, unexpected, or not matching your creative intent</li>
              <li>Slow generation times or queue delays</li>
              <li>Browser crashes, tab closures, or connectivity issues on your end</li>
              <li>Images that expired from our 30-day storage window</li>
              <li>Model-specific limitations (aspect ratio restrictions, style limitations, etc.)</li>
            </ul>

            <h3 className="text-xl font-semibold mb-3 mt-6 text-slate-300">4.2 How to Request a Ticket Credit</h3>
            <p className="mb-4">
              To submit a ticket credit request, email{' '}
              <a href="mailto:promptandprotocol@gmail.com" className="text-slate-300 hover:text-white underline underline-offset-2 decoration-slate-600">promptandprotocol@gmail.com</a>{' '}
              with the subject line <strong>"Ticket Credit Request"</strong> and include:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li>Your registered account email address</li>
              <li>The approximate date and time the failure occurred</li>
              <li>The model you were using (e.g., NanoBanana Pro, SeeDream 4.5)</li>
              <li>The number of tickets you believe were incorrectly deducted</li>
              <li>A brief description of what happened (what you submitted, what you received)</li>
            </ul>
            <p className="mt-4">
              We will investigate your claim and respond within <strong>5 business days</strong>. If the failure is confirmed,
              we will restore the equivalent ticket amount directly to your account. The decision of Prompt &amp; Protocol LLC
              is final.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold mb-4 text-white">5. Chargebacks and Payment Disputes</h2>
            <p className="mb-4">
              Before initiating a chargeback or payment dispute with your bank or credit card company, we strongly encourage
              you to contact us directly at{' '}
              <a href="mailto:promptandprotocol@gmail.com" className="text-slate-300 hover:text-white underline underline-offset-2 decoration-slate-600">promptandprotocol@gmail.com</a>.
              Most concerns can be resolved quickly without involving third-party payment processors.
            </p>
            <p className="mb-4">
              Filing a chargeback or dispute for a valid charge that falls under this no-refund policy constitutes a violation
              of our Terms of Service and will result in:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li><strong>Immediate suspension</strong> of your account pending investigation</li>
              <li><strong>Permanent termination</strong> of your account if the chargeback is upheld</li>
              <li><strong>Forfeiture</strong> of all remaining ticket balances and subscription benefits</li>
              <li>Potential recovery of disputed amounts through legal means, including applicable chargeback fees</li>
              <li>Permanent ban from creating new accounts on AI Design Studio</li>
            </ul>
            <p className="mt-4 text-amber-300 font-semibold">
              We reserve the right to dispute any chargeback filed for a transaction that complied with this Refund Policy
              and our Terms of Service.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold mb-4 text-white">6. Service Modifications and Discontinued Models</h2>
            <p className="mb-4">
              Prompt &amp; Protocol LLC reserves the right to modify, suspend, or discontinue AI models, features, or the Service
              at any time. Tickets are sold as general-purpose generation credits, not as credits tied to any specific model.
              If a model you intended to use becomes unavailable, your tickets remain valid for use with all other available models.
            </p>
            <p className="mb-4">
              No refund will be issued due to:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li>Discontinuation or removal of a specific AI model</li>
              <li>Price changes to ticket packages or subscription plans</li>
              <li>Changes to ticket costs per generation for individual models</li>
              <li>Service downtime or temporary unavailability</li>
              <li>Feature removals or modifications to the platform</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold mb-4 text-white">7. Account Termination for Policy Violations</h2>
            <p className="mb-4">
              As stated in our Terms of Service, accounts terminated for violations of our Prohibited Use Policy or Terms of Service
              will have all remaining ticket balances and subscription benefits permanently forfeited without compensation.
              This applies regardless of how recently tickets were purchased or how many remain unused.
            </p>
            <p className="mb-4 text-red-400 font-semibold">
              If your account is terminated for cause, you are not entitled to any refund, ticket credit, or other compensation.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold mb-4 text-white">8. Governing Law</h2>
            <p className="mb-4">
              This Refund Policy is governed by the laws of the State of Florida, United States. Any disputes regarding this policy
              are subject to the dispute resolution and arbitration provisions set forth in our{' '}
              <a href="/terms" className="text-slate-300 hover:text-white underline underline-offset-2 decoration-slate-600">Terms of Service</a>.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold mb-4 text-white">9. Changes to This Policy</h2>
            <p className="mb-4">
              Prompt &amp; Protocol LLC reserves the right to update this Refund Policy at any time. Material changes will be posted
              on this page with an updated "Last Updated" date. Your continued use of the Service or any purchase made after
              the updated policy is posted constitutes acceptance of the revised terms.
              We recommend reviewing this policy before each purchase.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold mb-4 text-white">10. Contact Us</h2>
            <p className="mb-4">
              For questions about this Refund Policy or to submit a ticket credit request, contact us at:
            </p>
            <div className="bg-white/[0.03] border border-white/10 rounded-lg p-4">
              <p className="font-semibold text-white mb-1">Prompt &amp; Protocol LLC</p>
              <p className="text-sm">
                Email:{' '}
                <a href="mailto:promptandprotocol@gmail.com" className="text-slate-300 hover:text-white underline underline-offset-2 decoration-slate-600">
                  promptandprotocol@gmail.com
                </a>
              </p>
              <p className="text-sm text-slate-400 mt-2">
                Response times may vary. Support is provided in English only.
              </p>
            </div>
          </section>

          <div className="mt-12 p-6 border-2 border-white/15 rounded-lg bg-white/[0.03]">
            <p className="font-semibold mb-3 text-lg">By completing any purchase on AI Design Studio, you acknowledge that:</p>
            <ul className="list-disc list-inside space-y-2 ml-4 text-sm">
              <li>You have read and understood this Refund Policy in its entirety</li>
              <li>All ticket purchases and subscription payments are final and non-refundable</li>
              <li>Ticket credits (not cash) are the only form of compensation available, and only for verified technical failures</li>
              <li>Chargebacks filed for valid charges constitute a Terms of Service violation and will result in account termination</li>
              <li>This policy is governed by the laws of Florida and is incorporated into the Terms of Service</li>
            </ul>
          </div>

          <div className="text-center pt-4 pb-2">
            <div className="flex justify-center gap-6 text-sm">
              <a href="/terms" className="text-slate-300 hover:text-white underline underline-offset-2 decoration-slate-600">Terms of Service</a>
              <a href="/privacy" className="text-slate-300 hover:text-white underline underline-offset-2 decoration-slate-600">Privacy Policy</a>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
