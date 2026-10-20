import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Check, ImageIcon, Library, Ticket, Video, X } from 'lucide-react'
import { getUserFromSession } from '@/lib/auth'
import { authRedirect, consentToken, friendlyClientName, parseAuthRequest } from '@/lib/mcp/oauth'
import { SiteBrandHero } from '@/components/SitePageHeader'
import { checkIsAdmin } from '@/lib/admin-check'
import { CONNECTOR_ADMIN_ONLY } from '@/lib/nova/config'

/*
 * "Connect AI Design Studio" (2026-10-20): the page ChatGPT / Claude send the
 * user to when they add the connector (lib/mcp/oauth). Signed out, it goes to
 * the normal sign-in and comes back here; signed in, the user sees which app
 * is asking and what it may do, and approves or cancels (POST
 * /api/oauth/authorize). A request this page cannot trust (unknown app, a
 * redirect the app never registered) is shown here, never sent anywhere.
 */
export const dynamic = 'force-dynamic'
export const metadata = { title: 'Connect your account · AI Design Studio' }

export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) if (typeof v === 'string') q.set(k, v)
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https')
  const origin = `${proto.split(',')[0]}://${host.split(',')[0]}`

  const parsed = await parseAuthRequest(q, origin)
  if (!parsed.ok && 'redirect' in parsed) redirect(parsed.redirect)

  const session = (await cookies()).get('session')?.value
  const user = session ? await getUserFromSession(session) : null
  if (parsed.ok && (!session || !user)) redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${q.toString()}`)}`)
  // Admin-only until the connector is public (CONNECTOR_ADMIN_ONLY): the app gets access_denied
  if (parsed.ok && CONNECTOR_ADMIN_ONLY && user && !(await checkIsAdmin(user.email))) {
    redirect(authRedirect(parsed.req.redirectUri, origin, { error: 'access_denied', error_description: 'AI Design Studio in ChatGPT and Claude is not available yet', ...(parsed.req.state ? { state: parsed.req.state } : {}) }))
  }

  return (
    <div className="min-h-[100dvh] bg-[#050810] text-white flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <SiteBrandHero />
        {!parsed.ok ? (
          <div className="mt-8 rounded-2xl border border-red-500/25 bg-red-500/[0.06] p-5">
            <p className="text-sm font-bold text-red-100">This connection can&apos;t continue</p>
            <p className="mt-1.5 text-[12.5px] text-red-200/80 leading-relaxed">{'show' in parsed ? parsed.show : 'Something was wrong with the request.'}</p>
            <Link href="/" className="mt-4 inline-block text-[12px] text-slate-300 underline">Go to AI Design Studio</Link>
          </div>
        ) : (
          <form method="post" action="/api/oauth/authorize" className="mt-8 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5 sm:p-6">
            {[...q.entries()].map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <input type="hidden" name="consent" value={consentToken(session!, parsed.req)} />
            <div className="flex items-center gap-3">
              {parsed.req.client.logo
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={parsed.req.client.logo} alt="" className="w-10 h-10 rounded-xl bg-white/10 object-contain" />
                : <span className="w-10 h-10 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center text-sm font-black">{friendlyClientName(parsed.req.client).slice(0, 1)}</span>}
              <div className="min-w-0">
                <h1 className="text-[15px] font-bold leading-tight">{friendlyClientName(parsed.req.client)} wants to use your account</h1>
                <p className="text-[11.5px] text-slate-500 truncate">Signed in as {user!.email}</p>
              </div>
            </div>
            <p className="mt-4 text-[10px] font-mono uppercase tracking-[0.2em] text-slate-500">It will be able to</p>
            <ul className="mt-2 space-y-2 text-[12.5px] text-slate-200">
              <li className="flex gap-2.5"><ImageIcon size={15} className="shrink-0 mt-0.5 text-slate-400" /> Make and edit images with the site&apos;s models</li>
              <li className="flex gap-2.5"><Video size={15} className="shrink-0 mt-0.5 text-slate-400" /> Make videos</li>
              <li className="flex gap-2.5"><Ticket size={15} className="shrink-0 mt-0.5 text-slate-400" /> Spend your tickets on them (each costs what it costs on the site; you have {user!.tickets?.balance ?? 0})</li>
              <li className="flex gap-2.5"><Library size={15} className="shrink-0 mt-0.5 text-slate-400" /> See your generations and references</li>
            </ul>
            <p className="mt-3 text-[11px] text-slate-500 leading-relaxed">
              It can&apos;t buy tickets, see your password or change your account. Everything it makes is saved to your My Generations.
              Disconnect any time in <Link href="/connect" className="underline">Connected apps</Link>.
            </p>
            <div className="mt-5 flex items-center gap-2">
              <button name="decision" value="deny" className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl border border-white/10 text-[13px] text-slate-300 hover:text-white hover:bg-white/[0.05]">
                <X size={14} /> Cancel
              </button>
              <button name="decision" value="approve" className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-white text-black text-[13px] font-bold hover:bg-slate-200">
                <Check size={14} /> Connect
              </button>
            </div>
            <p className="mt-3 text-center text-[10.5px] text-slate-600">Not you? <a href={`/login?next=${encodeURIComponent(`/oauth/authorize?${q.toString()}`)}`} className="underline">Use another account</a></p>
          </form>
        )}
      </div>
    </div>
  )
}
