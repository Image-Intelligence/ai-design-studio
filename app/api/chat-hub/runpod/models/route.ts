import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireChatHubAdmin } from '@/lib/chat-hub-auth'
import { decryptKey } from '@/lib/chat-key-crypto'
import { parseRunpodConfig } from '@/lib/runpod-config'

// GET /api/chat-hub/runpod/models — list the models served by the linked
// RunPod endpoint (vLLM /v1/models). Mirrors the Ollama sync proxy.
export async function GET() {
  const user = await requireChatHubAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const row = await prisma.chatProviderKey.findUnique({
    where: { userId_provider: { userId: user.id, provider: 'runpod' } },
    select: { encrypted: true },
  }).catch(() => null)
  const cfg = row ? parseRunpodConfig(decryptKey(row.encrypted)) : null
  if (!cfg) return NextResponse.json({ error: 'No RunPod endpoint linked yet' }, { status: 400 })

  try {
    const res = await fetch(`${cfg.baseUrl}/models`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000), // serverless endpoints can cold-start
      headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : undefined,
    })
    if (!res.ok) {
      return NextResponse.json(
        { error: `Endpoint responded ${res.status} — is the pod running and serving an OpenAI-compatible API at ${cfg.baseUrl}?` },
        { status: 502 },
      )
    }
    const data = await res.json().catch(() => null)
    const models = Array.isArray(data?.data)
      ? data.data
          .filter((m: any) => typeof m?.id === 'string')
          .map((m: any) => ({
            id: `runpod/${m.id}`,
            label: String(m.id).split('/').pop()!.slice(0, 60),
          }))
      : []
    return NextResponse.json({ models, baseUrl: cfg.baseUrl })
  } catch {
    return NextResponse.json(
      { error: `Could not reach ${cfg.baseUrl} — check that the pod is running (cold starts can take a minute; try again).` },
      { status: 502 },
    )
  }
}
