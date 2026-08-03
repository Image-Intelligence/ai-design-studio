import { NextResponse } from 'next/server'
import { authenticateApiKey, invalidKeyResponse, canUseModel } from '@/lib/api-key-auth'
import { checkIsAdmin } from '@/lib/admin-check'
import { usableCreateModels } from '@/lib/chat-hub-models'
import { AI_MODELS } from '@/config/ai-models.config'
import { modelCatalogForKeys } from '@/lib/api-key-permissions'

export const dynamic = 'force-dynamic'

// GET /api/v1/models — the model catalog for the desktop app, annotated with
// whether THIS key may use each model. Any valid key.
export async function GET(request: Request) {
  const auth = await authenticateApiKey(request)
  if (!auth || auth === 'invalid') return invalidKeyResponse()

  const isAdmin = await checkIsAdmin(auth.user.email)
  const usable = usableCreateModels(isAdmin)
  const usableIds = new Set(usable.map(m => m.id))
  const catalog = modelCatalogForKeys()
  // Base ticket cost at default settings (real charge varies with quality/
  // duration/resolution — same as the site's menus)
  const costOf = (id: string) =>
    usable.find(m => m.id === id)?.ticketCost ?? AI_MODELS.find(m => m.id === id)?.ticketCost ?? null

  const annotate = (kind: 'image' | 'video') =>
    catalog[kind]
      // Upscalers aren't in CHAT_CREATE_MODELS — always account-usable
      .filter(m => m.group === 'Upscalers' || usableIds.has(m.id))
      .map(m => ({ ...m, ticketCost: costOf(m.id), permitted: canUseModel(auth, kind, m.id) }))

  return NextResponse.json(
    { image: annotate('image'), video: annotate('video') },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
