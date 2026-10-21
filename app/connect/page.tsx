import { cookies, headers } from 'next/headers'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getUserFromSession } from '@/lib/auth'
import { checkIsAdmin } from '@/lib/admin-check'
import { CONNECTOR_ADMIN_ONLY } from '@/lib/nova/config'
import { SiteBrandHero } from '@/components/SitePageHeader'
import { ConnectedApps, CopyUrl } from './ConnectedApps'
import { AdminTag } from '@/components/ui/admin-mark'

/*
 * /connect (2026-10-20) - AI Design Studio inside ChatGPT and Claude: how to
 * add the connector, what it can do, and (signed in) the apps connected to
 * the account, each with Disconnect. Public: it is also the connector's
 * documentation page (lib/mcp/oauth service_documentation).
 */
export const dynamic = 'force-dynamic'
export const metadata = { title: 'Use AI Design Studio in ChatGPT and Claude', description: 'Connect your AI Design Studio account to ChatGPT or Claude and make images and videos right in the chat.' }

export default async function ConnectPage() {
  // Admin-only until the connector is made public (CONNECTOR_ADMIN_ONLY): everyone else gets a 404
  if (CONNECTOR_ADMIN_ONLY) {
    const token = (await cookies()).get('session')?.value
    const user = token ? await getUserFromSession(token) : null
    if (!user?.email || !(await checkIsAdmin(user.email))) notFound()
  }
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
        <div className="mt-8 flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight">Use AI Design Studio in ChatGPT and Claude</h1>
          {/* Red while the connector is admin-only (CONNECTOR_ADMIN_ONLY) */}
          {CONNECTOR_ADMIN_ONLY && <AdminTag />}
        </div>
        <p className="mt-2 text-[14px] text-slate-400 leading-relaxed">
          Connect your account once, then just ask in the chat - &ldquo;make a logo for my bakery&rdquo;, &ldquo;turn this picture into a 5-second video&rdquo;.
          The AI uses your AI Design Studio account: every picture and clip is made with the site&apos;s models, costs the same tickets as on the site,
          shows up right in the chat and is saved to your My Generations.
        </p>

        {/*
          The apps' own menus move often (2026-10-20, owner: "there is no Apps
          section or Advanced"): these steps follow ChatGPT's October 2026 layout -
          custom MCP apps are web-only, on paid plans, with Developer mode under
          Security and login and the app added from Plugins. Keep the "if you
          don't see it" notes: older accounts still show the earlier layout.
        */}
        <div className="mt-6 rounded-2xl border border-white/[0.08] bg-black/30 p-4">
          <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-slate-500">The connector address - you&apos;ll paste this in</p>
          <CopyUrl url={mcpUrl} />
        </div>

        <section className="mt-4 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-[15px] font-bold">ChatGPT</h2>
            <span className="text-[11px] text-slate-500">About 2 minutes · a paid plan (Plus, Pro, Business) · on a computer</span>
          </div>
          <p className="mt-2 text-[12.5px] text-amber-200/90 leading-relaxed rounded-lg border border-amber-400/20 bg-amber-500/[0.06] px-3 py-2">
            AI Design Studio isn&apos;t in ChatGPT&apos;s app directory yet, so for now you add it yourself. This is only possible on
            <b> chatgpt.com in a web browser</b> - the iPhone and Android apps (and their Settings) don&apos;t have these options.
          </p>
          <ol className="mt-4 space-y-3.5">
            <li className={step}><span className={n}>1</span><span>
              On a computer, open <a href="https://chatgpt.com" target="_blank" rel="noopener noreferrer" className="underline text-white">chatgpt.com</a> and sign in.
              Click your name or picture (bottom left) → <b>Settings</b>.
            </span></li>
            <li className={step}><span className={n}>2</span><span>
              Open <b>Security and login</b> and turn on <b>Developer mode</b>.
              <span className="block mt-1 text-[11.5px] text-slate-500">Don&apos;t see it there? On some accounts it is under <b>Apps</b> (or <b>Connectors</b>) → <b>Advanced settings</b>. No Developer mode anywhere usually means a free plan.</span>
            </span></li>
            <li className={step}><span className={n}>3</span><span>
              Go to <a href="https://chatgpt.com/plugins" target="_blank" rel="noopener noreferrer" className="underline text-white">chatgpt.com/plugins</a> (or <b>Plugins</b> in the sidebar), click
              the <b>+</b> button and choose to add a custom MCP server / <b>Create</b> an app.
            </span></li>
            <li className={step}><span className={n}>4</span><span>
              Fill it in: name <b>AI Design Studio</b>, server URL <b>the address above</b>, authentication <b>OAuth</b> (leave client ID and secret empty - ChatGPT registers itself).
              Tick the box that you understand the risk, then <b>Create</b>.
            </span></li>
            <li className={step}><span className={n}>5</span><span>
              ChatGPT opens the AI Design Studio sign-in. Sign in with your AI Design Studio account and press <b>Connect</b>.
            </span></li>
            <li className={step}><span className={n}>6</span><span>
              Start a new chat, click <b>+</b> in the message box → <b>Developer mode</b>, and switch on <b>AI Design Studio</b>. Then ask:
              <span className="block mt-1 text-slate-400">&ldquo;Use AI Design Studio to make a minimal logo for a bakery called Golden Crust.&rdquo;</span>
            </span></li>
          </ol>
        </section>

        <section className="mt-4 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-[15px] font-bold">Claude</h2>
            <span className="text-[11px] text-slate-500">About 1 minute · any plan (Free allows one custom connector) · set up on claude.ai or the desktop app</span>
          </div>
          <ol className="mt-4 space-y-3.5">
            <li className={step}><span className={n}>1</span><span>
              Open <a href="https://claude.ai" target="_blank" rel="noopener noreferrer" className="underline text-white">claude.ai</a> (or the Claude desktop app) → <b>Settings</b> → <b>Connectors</b>.
              <span className="block mt-1 text-[11.5px] text-slate-500">On some accounts it is <b>Customize → Connectors</b>. On a Team or Enterprise plan an owner adds it for the organisation first.</span>
            </span></li>
            <li className={step}><span className={n}>2</span><span>
              Click <b>Add custom connector</b>, name it <b>AI Design Studio</b>, paste <b>the address above</b> and click <b>Add</b>.
            </span></li>
            <li className={step}><span className={n}>3</span><span>
              Click <b>Connect</b>, sign in with your AI Design Studio account and press <b>Connect</b> on our page.
            </span></li>
            <li className={step}><span className={n}>4</span><span>
              In a chat, open the tools menu (the sliders / <b>+</b> button) and make sure <b>AI Design Studio</b> is on. Once it&apos;s added on the web it also works in the Claude phone app.
            </span></li>
          </ol>
        </section>

        <section className="mt-4 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5">
          <h2 className="text-[15px] font-bold">If something doesn&apos;t work</h2>
          <ul className="mt-2 space-y-2 text-[12.5px] text-slate-300 leading-relaxed list-disc pl-5">
            <li><b>No Developer mode or Plugins in ChatGPT:</b> use chatgpt.com in a browser (not the phone app) on a paid plan. A work (Business / Enterprise) account may need its admin to allow custom apps.</li>
            <li><b>The sign-in page says the app can&apos;t be identified:</b> make sure the address is exactly the one above, with <code>/api/mcp</code> at the end, then delete the app and add it again.</li>
            <li><b>Connected, but the AI doesn&apos;t use it:</b> switch it on for that chat (step 6 for ChatGPT, step 4 for Claude) and mention &ldquo;AI Design Studio&rdquo; in your request.</li>
            <li><b>&ldquo;Not enough tickets&rdquo;:</b> top up on the site - tickets can&apos;t be bought inside ChatGPT or Claude.</li>
            <li><b>A request is refused:</b> requests from ChatGPT and Claude follow all-ages content rules, stricter than the site itself.</li>
          </ul>
        </section>

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
