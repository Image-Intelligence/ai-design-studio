import { headers } from 'next/headers'
import Link from 'next/link'
import { SiteBrandHero } from '@/components/SitePageHeader'
import { ConnectedApps, CopyUrl } from './ConnectedApps'

/*
 * /connect (2026-10-20) - AI Design Studio inside ChatGPT and Claude: how to
 * add the connector, what it can do, and (signed in) the apps connected to
 * the account, each with Disconnect. Public: it is also the connector's
 * documentation page (lib/mcp/oauth service_documentation).
 */
export const dynamic = 'force-dynamic'
export const metadata = { title: 'Use AI Design Studio in ChatGPT and Claude', description: 'Connect your AI Design Studio account to ChatGPT or Claude and make images and videos right in the chat.' }

export default async function ConnectPage() {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  const mcpUrl = `${proto.split(',')[0]}://${host.split(',')[0]}/api/mcp`
  const step = 'flex gap-3 text-[13px] text-slate-300 leading-relaxed'
  const n = 'shrink-0 w-6 h-6 rounded-full bg-white/[0.08] border border-white/15 text-[11px] font-bold text-white flex items-center justify-center'
  return (
    <div className="min-h-[100dvh] bg-[#050810] text-white px-4 py-10">
      <div className="max-w-2xl mx-auto">
        <SiteBrandHero />
        <h1 className="mt-8 text-2xl sm:text-3xl font-black tracking-tight">Use AI Design Studio in ChatGPT and Claude</h1>
        <p className="mt-2 text-[14px] text-slate-400 leading-relaxed">
          Connect your account once, then just ask in the chat - &ldquo;make a logo for my bakery&rdquo;, &ldquo;turn this picture into a 5-second video&rdquo;.
          The AI uses your AI Design Studio account: every picture and clip is made with the site&apos;s models, costs the same tickets as on the site,
          shows up right in the chat and is saved to your My Generations.
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <section className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5">
            <h2 className="text-[15px] font-bold">ChatGPT</h2>
            <ol className="mt-3 space-y-2.5">
              <li className={step}><span className={n}>1</span><span>In ChatGPT, open <b>Apps</b> and search for <b>AI Design Studio</b>, then <b>Connect</b>. (Before it is listed: Settings → Apps → Advanced → turn on Developer mode, then <b>Create app</b> with the address below and OAuth sign-in.)</span></li>
              <li className={step}><span className={n}>2</span><span>Sign in with your AI Design Studio account and approve.</span></li>
              <li className={step}><span className={n}>3</span><span>Ask for an image or a video - pick AI Design Studio in the chat&apos;s tools if ChatGPT does not choose it by itself.</span></li>
            </ol>
          </section>
          <section className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5">
            <h2 className="text-[15px] font-bold">Claude</h2>
            <ol className="mt-3 space-y-2.5">
              <li className={step}><span className={n}>1</span><span>In Claude, open <b>Settings → Connectors</b> and choose <b>Add custom connector</b>.</span></li>
              <li className={step}><span className={n}>2</span><span>Name it AI Design Studio and paste the address below, then <b>Connect</b> and approve with your account.</span></li>
              <li className={step}><span className={n}>3</span><span>Turn it on in a chat (the tools menu) and ask away.</span></li>
            </ol>
          </section>
        </div>

        <div className="mt-4 rounded-2xl border border-white/[0.08] bg-black/30 p-4">
          <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-slate-500">Connector address</p>
          <CopyUrl url={mcpUrl} />
        </div>

        <section className="mt-6 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5">
          <h2 className="text-[15px] font-bold">What it can do</h2>
          <ul className="mt-2 space-y-1.5 text-[13px] text-slate-300 list-disc pl-5">
            <li>Make images (up to 4 at a time) and edit your pictures with words</li>
            <li>Make videos, from a prompt or from one of your pictures</li>
            <li>Find your past generations and use them as references</li>
            <li>Check your ticket balance and the models&apos; prices</li>
          </ul>
          <p className="mt-3 text-[12px] text-slate-500 leading-relaxed">
            It can&apos;t buy tickets (top up on the site), see your password or change your account. Requests made in ChatGPT and Claude follow
            stricter, all-ages content rules than the site itself. Uploading your own pictures through the chat needs a one-time ID check on the site.
          </p>
        </section>

        <section className="mt-6 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5">
          <h2 className="text-[15px] font-bold">Connected apps</h2>
          <ConnectedApps />
        </section>

        <p className="mt-8 text-center text-[11px] text-slate-600">
          <Link href="/privacy" className="hover:text-slate-400">Privacy</Link> · <Link href="/terms" className="hover:text-slate-400">Terms</Link> · <Link href="/contact" className="hover:text-slate-400">Contact</Link>
        </p>
      </div>
    </div>
  )
}
