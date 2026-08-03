import { Metadata } from 'next'
import { SitePageHeader, SiteBrandHero } from '@/components/SitePageHeader'

export const metadata: Metadata = {
  title: 'Privacy Policy | AI Design Studio',
  description: 'Privacy Policy for AI Design Studio AI image generation platform',
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[#050810] text-slate-100">
      <SitePageHeader />
      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="mb-10">
          <SiteBrandHero />
        </div>
        <h1 className="text-center text-lg font-bold text-white uppercase tracking-[0.2em] mb-1">
          Privacy Policy
        </h1>
        <p className="text-center text-sm text-slate-500 mb-10">Last Updated: February 27, 2026 | Version 3.1</p>

        <div className="space-y-8 text-slate-300">
          <section>
            <h2 className="text-2xl font-bold text-white mb-3">1. Introduction</h2>
            <p className="mb-3">
              Prompt & Protocol LLC ("we," "our," or "us"), operator of AI Design Studio, is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our AI image generation service ("the Service").
            </p>
            <p className="text-sm text-amber-300 font-semibold">
              By using our Service, you consent to the data practices described in this policy. If you do not agree with this policy, please do not use the Service.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-white mb-3">2. Information We Collect</h2>
            <div className="space-y-4">
              <div>
                <h3 className="font-bold text-slate-300 mb-2">2.1 Account Information</h3>
                <ul className="list-disc ml-6 space-y-1 text-sm">
                  <li>Email address (required for account creation via Clerk authentication)</li>
                  <li>Display name and profile information (if provided)</li>
                  <li>Authentication tokens and session data</li>
                  <li>Account creation date and last login timestamp</li>
                </ul>
              </div>
              <div>
                <h3 className="font-bold text-slate-300 mb-2">2.2 Usage Data</h3>
                <ul className="list-disc ml-6 space-y-1 text-sm">
                  <li>Text prompts submitted for image generation</li>
                  <li>Reference images uploaded (if any)</li>
                  <li>Model selection (NanoBanana Cluster, Pro, SeeDream, etc.)</li>
                  <li>Quality, aspect ratio, and other generation settings</li>
                  <li>Generation timestamps and ticket consumption records</li>
                  <li>IP address, browser type, and device information (for security and fraud prevention)</li>
                  <li>Referral sources and navigation patterns</li>
                </ul>
              </div>
              <div>
                <h3 className="font-bold text-slate-300 mb-2">2.3 Payment and Subscription Information</h3>
                <ul className="list-disc ml-6 space-y-1 text-sm">
                  <li>CCBill transaction IDs and payment amounts</li>
                  <li>Subscription plan details (Dev Tier: biweekly, monthly, or yearly)</li>
                  <li>Ticket purchase history and balance</li>
                  <li>Subscription status (active, canceled, expired)</li>
                  <li><strong className="text-slate-200">We do NOT store credit card numbers, bank account details, or billing addresses</strong></li>
                  <li>All payment processing is handled securely by CCBill (our authorized payment processor)</li>
                </ul>
              </div>
              <div>
                <h3 className="font-bold text-slate-300 mb-2">2.4 Generated Content</h3>
                <ul className="list-disc ml-6 space-y-1 text-sm">
                  <li>AI-generated images (stored for 30 days maximum)</li>
                  <li>Image metadata (creation date, model used, settings, user ID)</li>
                  <li>Download history and view counts</li>
                  <li>Image ratings and feedback (if provided)</li>
                </ul>
              </div>
            </div>
          </section>

          <section className="bg-white/[0.04] border-2 border-white/15 p-6 rounded-lg">
            <h2 className="text-2xl font-bold text-slate-200 mb-3">3. How We Use Your Information</h2>
            <p className="mb-3">We use collected information for the following legitimate purposes:</p>
            <div className="space-y-3">
              <div className="flex items-start gap-2">
                <span className="text-slate-200 mt-1 text-lg">•</span>
                <div>
                  <p className="font-bold text-white">Service Delivery</p>
                  <p className="text-sm">Processing your prompts through AI models (fal.ai, Google Gemini) to generate images</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-slate-200 mt-1 text-lg">•</span>
                <div>
                  <p className="font-bold text-white">Account Management</p>
                  <p className="text-sm">Authenticating users, managing ticket balances, processing subscriptions, and tracking usage history</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-slate-200 mt-1 text-lg">•</span>
                <div>
                  <p className="font-bold text-white">Billing & Subscription Management</p>
                  <p className="text-sm">Processing payments, managing recurring subscriptions, preventing fraud, and handling refund requests</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-slate-200 mt-1 text-lg">•</span>
                <div>
                  <p className="font-bold text-white">Safety & Compliance</p>
                  <p className="text-sm">Detecting prohibited content, preventing abuse, enforcing our Terms of Service, and complying with legal obligations</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-slate-200 mt-1 text-lg">•</span>
                <div>
                  <p className="font-bold text-white">Service Improvement</p>
                  <p className="text-sm">Analyzing anonymized usage patterns to optimize performance, add features, and improve user experience</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-slate-200 mt-1 text-lg">•</span>
                <div>
                  <p className="font-bold text-white">Customer Support</p>
                  <p className="text-sm">Responding to support requests, troubleshooting issues, and providing technical assistance</p>
                </div>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-white mb-3">4. Third-Party Service Providers & Data Sharing</h2>
            <p className="mb-4 font-semibold text-amber-300">
              IMPORTANT: We share your data with third-party service providers to operate the Service. Each provider has their own data practices and privacy policies.
            </p>
            <div className="space-y-4">
              <div className="p-5 bg-white/[0.03] rounded-lg border-2 border-white/10">
                <div className="flex items-start gap-3">
                  <div className="text-3xl">🤖</div>
                  <div className="flex-1">
                    <h3 className="font-bold text-white text-lg mb-2">fal.ai (AI Infrastructure Provider)</h3>
                    <p className="text-sm mb-2"><strong className="text-white">What they receive:</strong> Your text prompts, reference images (if uploaded), generation parameters, and model selection</p>
                    <p className="text-sm mb-2"><strong className="text-white">Purpose:</strong> Processing AI image generation through their infrastructure (Google Gemini, ByteDance SeeDream, and other models)</p>
                    <p className="text-sm mb-3"><strong className="text-white">Privacy policy:</strong> <a href="https://fal.ai/privacy" className="text-slate-300 hover:text-white underline underline-offset-2 decoration-slate-600" target="_blank" rel="noopener noreferrer">fal.ai/privacy</a></p>
                    <div className="p-3 bg-amber-500/[0.06] border border-amber-500/25 rounded text-sm">
                      <p className="text-amber-300 font-bold mb-1">⚠️ Data Usage Policy:</p>
                      <p>fal.ai may use your prompts and generated content according to their terms of service. While we use their paid API, their data retention and usage policies apply. Review their privacy policy for complete details.</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-5 bg-white/[0.03] rounded-lg border-2 border-white/10">
                <div className="flex items-start gap-3">
                  <div className="text-3xl">🧠</div>
                  <div className="flex-1">
                    <h3 className="font-bold text-white text-lg mb-2">Google Gemini API (AI Model Provider)</h3>
                    <p className="text-sm mb-2"><strong className="text-white">What they receive:</strong> Text prompts and generation parameters when using Gemini models directly</p>
                    <p className="text-sm mb-2"><strong className="text-white">Purpose:</strong> Processing AI image generation and providing AI capabilities</p>
                    <p className="text-sm mb-3"><strong className="text-white">Privacy policy:</strong> <a href="https://ai.google.dev/gemini-api/terms" className="text-slate-300 hover:text-white underline underline-offset-2 decoration-slate-600" target="_blank" rel="noopener noreferrer">ai.google.dev/gemini-api/terms</a></p>
                    <div className="space-y-2">
                      <div className="p-3 bg-red-500/10 border border-red-500/30 rounded text-sm">
                        <p className="text-red-400 font-bold mb-1">⚠️ Unpaid Services (Free Features):</p>
                        <p>When using unpaid Gemini services, <strong className="text-white">Google uses submitted content and generated responses to improve their products and machine learning technologies</strong>. Do not submit sensitive, confidential, or personal information to unpaid services.</p>
                      </div>
                      <div className="p-3 bg-white/[0.04] border border-white/15 rounded text-sm">
                        <p className="text-slate-200 font-bold mb-1">✓ Paid Services:</p>
                        <p>When using paid Gemini services, Google does NOT use your prompts or responses to improve their products. However, they log them for 30 days solely for detecting violations and required legal/regulatory disclosures.</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-5 bg-white/[0.03] rounded-lg border-2 border-white/10">
                <div className="flex items-start gap-3">
                  <div className="text-3xl">💳</div>
                  <div className="flex-1">
                    <h3 className="font-bold text-white text-lg mb-2">CCBill (Payment Processor)</h3>
                    <p className="text-sm mb-2"><strong className="text-white">Role:</strong> CCBill is our authorized payment processor — they handle payment processing, subscription billing, and transaction management on our behalf. Charges on your statement appear under CCBill&apos;s billing descriptor</p>
                    <p className="text-sm mb-2"><strong className="text-white">What they receive:</strong> Your name, email, billing address, payment method details, transaction amounts, and subscription plan information</p>
                    <p className="text-sm mb-2"><strong className="text-white">Purpose:</strong> Secure payment processing, subscription billing, and chargeback management for all ticket and subscription purchases</p>
                    <p className="text-sm mb-2"><strong className="text-white">What we DON'T see:</strong> Your full credit card numbers, bank account details, or complete billing addresses — all sensitive payment data is handled exclusively by CCBill on their PCI-DSS compliant systems</p>
                    <p className="text-sm mb-3"><strong className="text-white">Privacy policy:</strong> <a href="https://www.ccbill.com/privacy-policy" className="text-slate-300 hover:text-white underline underline-offset-2 decoration-slate-600" target="_blank" rel="noopener noreferrer">ccbill.com/privacy-policy</a> · Support: <a href="https://support.ccbill.com" className="text-slate-300 hover:text-white underline underline-offset-2 decoration-slate-600" target="_blank" rel="noopener noreferrer">support.ccbill.com</a></p>
                  </div>
                </div>
              </div>

              <div className="p-5 bg-white/[0.03] rounded-lg border-2 border-white/10">
                <div className="flex items-start gap-3">
                  <div className="text-3xl">☁️</div>
                  <div className="flex-1">
                    <h3 className="font-bold text-white text-lg mb-2">Vercel (Hosting & Storage)</h3>
                    <p className="text-sm mb-2"><strong className="text-white">What they store:</strong> Generated images (via Vercel Blob Storage), application code, and user session data</p>
                    <p className="text-sm mb-2"><strong className="text-white">Purpose:</strong> Website hosting and temporary image storage (30 days maximum)</p>
                    <p className="text-sm mb-2"><strong className="text-white">Security:</strong> SOC 2 Type II certified, encrypted at rest and in transit with TLS 1.3</p>
                    <p className="text-sm mb-3"><strong className="text-white">Privacy policy:</strong> <a href="https://vercel.com/legal/privacy-policy" className="text-slate-300 hover:text-white underline underline-offset-2 decoration-slate-600" target="_blank" rel="noopener noreferrer">vercel.com/legal/privacy-policy</a></p>
                  </div>
                </div>
              </div>

              <div className="p-5 bg-white/[0.03] rounded-lg border-2 border-white/10">
                <div className="flex items-start gap-3">
                  <div className="text-3xl">🗄️</div>
                  <div className="flex-1">
                    <h3 className="font-bold text-white text-lg mb-2">Prisma / PostgreSQL Database</h3>
                    <p className="text-sm mb-2"><strong className="text-white">What they store:</strong> User accounts, ticket balances, subscription data, generation history, and metadata</p>
                    <p className="text-sm mb-2"><strong className="text-white">Purpose:</strong> Persistent data storage, user authentication, and subscription management</p>
                    <p className="text-sm"><strong className="text-white">Security:</strong> Encrypted connections (SSL), regular backups, role-based access control</p>
                  </div>
                </div>
              </div>

              <div className="p-5 bg-white/[0.03] rounded-lg border-2 border-white/10">
                <div className="flex items-start gap-3">
                  <div className="text-3xl">🔐</div>
                  <div className="flex-1">
                    <h3 className="font-bold text-white text-lg mb-2">Clerk (Authentication Provider)</h3>
                    <p className="text-sm mb-2"><strong className="text-white">What they receive:</strong> Email address, authentication tokens, login history, and security events</p>
                    <p className="text-sm mb-2"><strong className="text-white">Purpose:</strong> User authentication, account management, and security monitoring</p>
                    <p className="text-sm mb-3"><strong className="text-white">Privacy policy:</strong> <a href="https://clerk.com/legal/privacy" className="text-slate-300 hover:text-white underline underline-offset-2 decoration-slate-600" target="_blank" rel="noopener noreferrer">clerk.com/legal/privacy</a></p>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 p-4 bg-red-500/10 border-2 border-red-500/30 rounded-lg">
              <p className="font-bold text-red-400 mb-2 text-lg">⚠️ Critical Privacy Notice</p>
              <p className="text-sm mb-2">
                <strong className="text-white">We do NOT control how third-party AI providers use your data.</strong> While we use paid/enterprise services where possible to minimize data retention, the underlying AI model providers (Google, ByteDance) have their own data policies.
              </p>
              <p className="text-sm font-semibold text-amber-300">
                Do not submit sensitive, confidential, personal information, protected health information (PHI), or trade secrets to the Service.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-white mb-3">5. Data Retention & Automatic Deletion</h2>
            <div className="bg-amber-500/[0.06] border-2 border-amber-500/25 p-5 rounded-lg mb-4">
              <p className="font-bold text-amber-300 mb-3 text-lg">⏱️ Automatic Data Deletion Timeline</p>
              <ul className="list-disc ml-6 space-y-2 text-sm">
                <li><strong className="text-white">Generated Images:</strong> Automatically deleted after 30 days from creation date</li>
                <li><strong className="text-white">Text Prompts & Metadata:</strong> Retained for 90 days for support and troubleshooting, then automatically deleted</li>
                <li><strong className="text-white">Account Data:</strong> Retained until you request account deletion or account is inactive for 2 years</li>
                <li><strong className="text-white">Subscription Data:</strong> Retained for duration of active subscription plus 90 days after cancellation</li>
                <li><strong className="text-white">Payment Records:</strong> Retained for 7 years (legal requirement for tax and financial compliance)</li>
                <li><strong className="text-white">Logs & Security Data:</strong> Retained for 90 days for security monitoring and fraud prevention</li>
              </ul>
            </div>
            <p className="text-sm">
              This retention policy ensures your creative work isn't stored indefinitely while maintaining records necessary for legal compliance, customer support, and service operation. You can request early deletion of your data at any time by contacting us.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-white mb-3">6. Your Privacy Rights</h2>
            <p className="mb-4">Depending on your location, you may have the following rights:</p>
            <div className="space-y-3">
              <div className="p-4 bg-white/[0.03] rounded-lg border border-white/10">
                <h3 className="font-bold text-white mb-1 flex items-center gap-2">
                  <span>🔍</span> Right to Access
                </h3>
                <p className="text-sm">Request a copy of all personal data we have stored about you in machine-readable format</p>
              </div>
              <div className="p-4 bg-white/[0.03] rounded-lg border border-white/10">
                <h3 className="font-bold text-white mb-1 flex items-center gap-2">
                  <span>✏️</span> Right to Correction
                </h3>
                <p className="text-sm">Update or correct inaccurate information in your account settings or by contacting us</p>
              </div>
              <div className="p-4 bg-white/[0.03] rounded-lg border border-white/10">
                <h3 className="font-bold text-white mb-1 flex items-center gap-2">
                  <span>🗑️</span> Right to Deletion
                </h3>
                <p className="text-sm">Request complete deletion of your account and all associated data</p>
                <p className="text-xs text-slate-400 mt-1">Note: Payment records may be retained for 7 years for legal/tax compliance even after account deletion</p>
              </div>
              <div className="p-4 bg-white/[0.03] rounded-lg border border-white/10">
                <h3 className="font-bold text-white mb-1 flex items-center gap-2">
                  <span>📦</span> Right to Data Portability
                </h3>
                <p className="text-sm">Export your generation history, prompts, and account data in JSON or CSV format</p>
              </div>
              <div className="p-4 bg-white/[0.03] rounded-lg border border-white/10">
                <h3 className="font-bold text-white mb-1 flex items-center gap-2">
                  <span>⛔</span> Right to Opt-Out
                </h3>
                <p className="text-sm">Opt-out of marketing emails and non-essential communications (service emails cannot be disabled)</p>
              </div>
              <div className="p-4 bg-white/[0.03] rounded-lg border border-white/10">
                <h3 className="font-bold text-white mb-1 flex items-center gap-2">
                  <span>🚫</span> Right to Restrict Processing
                </h3>
                <p className="text-sm">Request limitation of how we process your personal data</p>
              </div>
              <div className="p-4 bg-white/[0.03] rounded-lg border border-white/10">
                <h3 className="font-bold text-white mb-1 flex items-center gap-2">
                  <span>⚖️</span> Right to Object
                </h3>
                <p className="text-sm">Object to processing of your personal data for certain purposes</p>
              </div>
            </div>
            <p className="mt-4 text-sm bg-white/[0.04] border border-white/15 p-3 rounded">
              <strong>To exercise any of these rights:</strong> Contact us at{' '}
              <a href="mailto:promptandprotocol@gmail.com" className="text-slate-300 hover:text-white underline underline-offset-2 decoration-slate-600">
                promptandprotocol@gmail.com
              </a>
              {' '}with "Privacy Request" in the subject line. Include your account email and specify which right(s) you wish to exercise. We will respond within 30 days.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-white mb-3">7. Data Security Measures</h2>
            <p className="mb-4">We implement industry-standard security practices to protect your data:</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="p-4 bg-white/[0.03] rounded-lg border border-white/10">
                <p className="font-bold text-white mb-1">🔐 Encryption</p>
                <p className="text-sm">TLS 1.3 for data in transit, AES-256 for data at rest</p>
              </div>
              <div className="p-4 bg-white/[0.03] rounded-lg border border-white/10">
                <p className="font-bold text-white mb-1">🔑 Password Security</p>
                <p className="text-sm">Bcrypt hashing with salt, never stored in plaintext</p>
              </div>
              <div className="p-4 bg-white/[0.03] rounded-lg border border-white/10">
                <p className="font-bold text-white mb-1">🛡️ Access Control</p>
                <p className="text-sm">Role-based permissions, principle of least privilege</p>
              </div>
              <div className="p-4 bg-white/[0.03] rounded-lg border border-white/10">
                <p className="font-bold text-white mb-1">📊 Security Monitoring</p>
                <p className="text-sm">24/7 intrusion detection, automated threat response</p>
              </div>
              <div className="p-4 bg-white/[0.03] rounded-lg border border-white/10">
                <p className="font-bold text-white mb-1">🔄 Regular Backups</p>
                <p className="text-sm">Daily encrypted backups with 30-day retention</p>
              </div>
              <div className="p-4 bg-white/[0.03] rounded-lg border border-white/10">
                <p className="font-bold text-white mb-1">🔬 Security Audits</p>
                <p className="text-sm">Regular vulnerability scans and dependency updates</p>
              </div>
              <div className="p-4 bg-white/[0.03] rounded-lg border border-white/10">
                <p className="font-bold text-white mb-1">🚨 Fraud Detection</p>
                <p className="text-sm">Automated systems to detect and prevent abuse</p>
              </div>
              <div className="p-4 bg-white/[0.03] rounded-lg border border-white/10">
                <p className="font-bold text-white mb-1">📝 Audit Logs</p>
                <p className="text-sm">Comprehensive logging of all system access and changes</p>
              </div>
            </div>
            <p className="mt-4 text-sm text-amber-300 bg-amber-500/[0.06] border border-amber-500/25 p-3 rounded">
              ⚠️ <strong>Disclaimer:</strong> No security system is 100% impenetrable. While we implement industry best practices and take security seriously, we cannot guarantee absolute security against all potential threats. You use the Service at your own risk.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-white mb-3">8. Cookies & Tracking Technologies</h2>
            <div className="space-y-4">
              <div>
                <h3 className="font-bold text-slate-300 mb-2">Essential Cookies (Required)</h3>
                <p className="text-sm mb-2">These cookies are necessary for the Service to function:</p>
                <ul className="list-disc ml-6 text-sm space-y-1">
                  <li>Session authentication tokens (expires after logout or 7 days)</li>
                  <li>CSRF protection tokens</li>
                  <li>User preferences (theme, language, scanner settings)</li>
                  <li>Shopping cart and ticket purchase session data</li>
                </ul>
              </div>
              <div>
                <h3 className="font-bold text-slate-300 mb-2">Analytics Cookies (Optional)</h3>
                <p className="text-sm mb-2">Used to improve our Service:</p>
                <ul className="list-disc ml-6 text-sm space-y-1">
                  <li>Page views and navigation patterns (anonymized)</li>
                  <li>Feature usage statistics</li>
                  <li>Error tracking and performance metrics</li>
                  <li>A/B testing for UI improvements</li>
                </ul>
                <p className="text-sm text-slate-400 mt-2">You can disable analytics cookies in your browser settings without affecting Service functionality.</p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-white mb-3">9. Children's Privacy (COPPA Compliance)</h2>
            <div className="bg-red-500/10 border-2 border-red-500/30 p-5 rounded-lg">
              <p className="font-bold text-red-400 mb-3 text-lg">🔞 Age Restriction: 18+ Only</p>
              <p className="text-sm mb-3">
                Our Service is <strong className="text-white">NOT intended for users under 18 years of age</strong>. We do not knowingly collect personal information from minors under 18. This is required by Google Gemini API terms and our content policies.
              </p>
              <p className="text-sm mb-3">
                If we discover that a user is under 18, we will immediately terminate their account and delete all associated data without notice or refund.
              </p>
              <p className="text-sm">
                If you believe a minor has created an account, please report it immediately to{' '}
                <a href="mailto:promptandprotocol@gmail.com" className="text-slate-300 hover:text-white underline underline-offset-2 decoration-slate-600">
                  promptandprotocol@gmail.com
                </a>
                {' '}with the subject line "Underage User Report".
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-white mb-3">10. International Data Transfers</h2>
            <p className="mb-3">
              Our Service is operated from the United States. Your data may be transferred to, stored in, and processed in the United States or other countries where our service providers operate (including Google's and fal.ai's data centers worldwide).
            </p>
            <p className="text-sm mb-3">
              By using our Service, you consent to the transfer of your information to countries outside your country of residence, which may have different data protection laws than your jurisdiction.
            </p>
            <p className="text-sm font-semibold text-amber-300">
              For European Union users: We comply with applicable data transfer requirements, including adequacy decisions and standard contractual clauses where required.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-white mb-3">11. Data Breach Notification</h2>
            <p className="mb-3">
              In the event of a data breach that affects your personal information, we will:
            </p>
            <ul className="list-disc ml-6 space-y-2 text-sm">
              <li>Notify affected users within 72 hours of discovery via email to your registered address</li>
              <li>Provide details about what data was compromised and which systems were affected</li>
              <li>Outline immediate steps we're taking to address the breach and prevent future incidents</li>
              <li>Offer specific guidance on protecting your account (password reset, fraud monitoring, etc.)</li>
              <li>Comply with all legal notification requirements (GDPR, CCPA, state laws)</li>
              <li>Work with law enforcement and security experts as appropriate</li>
            </ul>
            <p className="mt-3 text-sm text-slate-400">
              You can report suspected security issues to <a href="mailto:promptandprotocol@gmail.com" className="text-slate-300 hover:text-white underline underline-offset-2 decoration-slate-600">promptandprotocol@gmail.com</a> with "Security Issue" in the subject line.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-white mb-3">12. California Privacy Rights (CCPA)</h2>
            <p className="mb-3 text-sm">
              If you are a California resident, you have additional rights under the California Consumer Privacy Act (CCPA):
            </p>
            <div className="bg-white/[0.03] border border-white/10 p-4 rounded-lg">
              <ul className="list-disc ml-6 space-y-2 text-sm">
                <li><strong className="text-white">Right to Know:</strong> What personal information is collected, used, shared, or sold</li>
                <li><strong className="text-white">Right to Delete:</strong> Request deletion of your personal information</li>
                <li><strong className="text-white">Right to Opt-Out:</strong> Opt-out of the sale of personal information</li>
                <li><strong className="text-white">Right to Non-Discrimination:</strong> Not be discriminated against for exercising your privacy rights</li>
              </ul>
              <div className="mt-4 p-3 bg-white/[0.04] border border-white/15 rounded">
                <p className="text-sm font-bold text-slate-200">✓ We do NOT sell your personal information</p>
                <p className="text-sm">We have not sold any personal information in the past 12 months and do not plan to sell personal information in the future.</p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-white mb-3">13. European Privacy Rights (GDPR)</h2>
            <p className="mb-3 text-sm">
              If you are a European Economic Area (EEA), United Kingdom, or Swiss resident, you have rights under the General Data Protection Regulation (GDPR):
            </p>
            <div className="bg-white/[0.03] border border-white/10 p-4 rounded-lg">
              <ul className="list-disc ml-6 space-y-2 text-sm">
                <li><strong className="text-white">Right to Access:</strong> Obtain confirmation of data processing and access to your personal data</li>
                <li><strong className="text-white">Right to Rectification:</strong> Correct inaccurate personal data</li>
                <li><strong className="text-white">Right to Erasure:</strong> Request deletion of personal data ("right to be forgotten")</li>
                <li><strong className="text-white">Right to Data Portability:</strong> Receive your data in structured, machine-readable format</li>
                <li><strong className="text-white">Right to Restrict Processing:</strong> Limit how we process your data</li>
                <li><strong className="text-white">Right to Object:</strong> Object to processing based on legitimate interests</li>
                <li><strong className="text-white">Right to Withdraw Consent:</strong> Withdraw consent at any time (doesn't affect prior processing)</li>
                <li><strong className="text-white">Right to Lodge a Complaint:</strong> File complaint with your local supervisory authority</li>
              </ul>
              <div className="mt-4 p-3 bg-white/[0.04] border border-white/15 rounded text-sm">
                <p className="font-bold mb-1">Legal Basis for Processing:</p>
                <ul className="list-disc ml-6 space-y-1">
                  <li><strong>Contractual Necessity:</strong> To provide the Service you've requested</li>
                  <li><strong>Legitimate Interest:</strong> To improve, secure, and optimize our platform</li>
                  <li><strong>Legal Obligation:</strong> To comply with applicable laws and regulations</li>
                </ul>
              </div>
            </div>
            <p className="mt-3 text-sm text-amber-300">
              <strong>Note for EEA/UK/Swiss users:</strong> Due to Google Gemini API restrictions, you may be required to use paid services only when accessing Gemini-based models.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-white mb-3">14. Changes to This Privacy Policy</h2>
            <p className="mb-3">
              We may update this Privacy Policy periodically to reflect changes in our practices, technologies, legal requirements, or other factors.
            </p>
            <ul className="list-disc ml-6 space-y-2 text-sm">
              <li>Material changes will be communicated via email with 30 days advance notice</li>
              <li>The "Last Updated" date at the top will be revised</li>
              <li>Continued use of the Service after changes take effect constitutes acceptance of the updated policy</li>
              <li>Previous versions are available upon request for your records</li>
              <li>You may request account deletion if you disagree with policy changes</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-white mb-3">15. Contact Us</h2>
            <p className="mb-3">
              For privacy questions, concerns, data requests, or to exercise your rights, contact us at:
            </p>
            <div className="p-5 bg-white/[0.03] rounded-lg border-2 border-white/10">
              <p className="font-bold text-white mb-1">Email:</p>
              <p className="text-white text-lg mb-4">
                <a href="mailto:promptandprotocol@gmail.com" className="hover:underline">
                  promptandprotocol@gmail.com
                </a>
              </p>
              <p className="text-sm text-slate-400 mb-2">
                <strong>Subject line for privacy requests:</strong> "Privacy Request - [Your Request Type]"
              </p>
              <p className="text-sm text-slate-400">
                Please note that AI Design Studio is operated by a single individual, so responses may take longer than typical support times. We appreciate your patience.
              </p>
            </div>
          </section>
        </div>

        <div className="mt-12 p-6 rounded-xl border-2 border-white/15 bg-green-500/5">
          <div className="flex items-start gap-4">
            <div className="text-4xl">🛡️</div>
            <div>
              <h3 className="text-2xl font-bold text-slate-200 mb-3">Our Privacy Commitment</h3>
              <div className="space-y-2 text-slate-300">
                <p className="text-sm">
                  <strong className="text-white">✓ Transparency:</strong> We clearly disclose how your data is used and shared with third parties
                </p>
                <p className="text-sm">
                  <strong className="text-white">✓ Control:</strong> You have rights to access, correct, delete, and export your data
                </p>
                <p className="text-sm">
                  <strong className="text-white">✓ Security:</strong> We implement industry-standard security measures to protect your information
                </p>
                <p className="text-sm">
                  <strong className="text-white">✓ Minimal Retention:</strong> Images auto-delete after 30 days, prompts after 90 days
                </p>
                <p className="text-sm text-slate-400 mt-3 italic">
                  "Your creativity is yours. We're just the infrastructure that helps bring it to life."
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 text-center border-t border-slate-800 pt-6">
          <p className="text-sm text-slate-500">Last Updated: February 27, 2026</p>
          <p className="text-xs text-slate-600 mt-1">Version 3.1</p>
        </div>
      </div>
    </div>
  )
}
