import { NextResponse } from 'next/server'
import { requireChatHubAdmin } from '@/lib/chat-hub-auth'

// GET /api/chat-hub/ollama/models — list the models installed in the LOCAL
// Ollama server (the Next.js server reaches it at localhost; browsers on the
// LAN can't, which is exactly why this proxy exists).
export async function GET() {
  const user = await requireChatHubAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const base = (process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434').replace(/\/+$/, '')
  try {
    const res = await fetch(`${base}/api/tags`, { cache: 'no-store', signal: AbortSignal.timeout(4000) })
    if (!res.ok) {
      return NextResponse.json({ error: `Ollama responded ${res.status} — is it running at ${base}?` }, { status: 502 })
    }
    const data = await res.json().catch(() => null)
    const models = Array.isArray(data?.models)
      ? data.models
          .filter((m: any) => typeof m?.name === 'string')
          .map((m: any) => ({
            id: `ollama/${m.name}`,
            label: m.name,
            size: typeof m.size === 'number' ? m.size : undefined,
          }))
      : []
    return NextResponse.json({ models, base })
  } catch {
    return NextResponse.json(
      { error: `Could not reach Ollama at ${base} — start it with \`ollama serve\` (or set OLLAMA_BASE_URL in .env.local).` },
      { status: 502 },
    )
  }
}
