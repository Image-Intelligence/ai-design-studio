import prisma from '@/lib/prisma'
import { authenticateApiKey, invalidKeyResponse, requireScopes } from '@/lib/api-key-auth'

export const dynamic = 'force-dynamic'

const POLL_MS = 3_000
const PING_MS = 25_000
const MAX_LIFETIME_MS = 5 * 60_000 // self-terminate; the client reconnects

// GET /api/v1/tickets/stream — SSE live ticket balance for the desktop app.
// Emits `data: {"balance":N,"reserved":N}` on every change, `: ping` heartbeats,
// and closes after 5 minutes. Re-checks the key each poll so disabling a key
// kills live streams too.
export async function GET(request: Request) {
  const auth = await authenticateApiKey(request)
  if (!auth || auth === 'invalid') return invalidKeyResponse()
  const denied = requireScopes(auth, 'tickets:read')
  if (denied) return denied

  const userId = auth.user.id
  const keyId = auth.keyId
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const started = Date.now()
      let lastPing = Date.now()
      let lastPayload = ''
      let closed = false
      const abort = () => { closed = true }
      request.signal.addEventListener('abort', abort)

      const send = (text: string) => {
        try { controller.enqueue(encoder.encode(text)) } catch { closed = true }
      }

      while (!closed && Date.now() - started < MAX_LIFETIME_MS) {
        try {
          // Revocation check: a disabled/deleted key ends the stream immediately
          const keyRow = await prisma.apiKey.findUnique({ where: { id: keyId }, select: { disabled: true } })
          if (!keyRow || keyRow.disabled) {
            send(`event: revoked\ndata: {"error":"API key revoked"}\n\n`)
            break
          }

          const ticket = await prisma.ticket.findUnique({ where: { userId } })
          const balance = Math.max(0, (ticket?.balance ?? 0) - (ticket?.reserved ?? 0))
          const payload = JSON.stringify({ balance, reserved: ticket?.reserved ?? 0 })
          if (payload !== lastPayload) {
            lastPayload = payload
            send(`data: ${payload}\n\n`)
          } else if (Date.now() - lastPing > PING_MS) {
            lastPing = Date.now()
            send(`: ping\n\n`)
          }
        } catch {
          // transient DB error — keep the stream alive, retry next tick
        }
        await new Promise(r => setTimeout(r, POLL_MS))
      }

      request.signal.removeEventListener('abort', abort)
      try { controller.close() } catch {}
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
    },
  })
}
