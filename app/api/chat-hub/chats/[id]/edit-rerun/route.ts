import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireChatHubAdmin } from '@/lib/chat-hub-auth'
import { executeEditImage, type AgentStep } from '@/lib/chat-hub-agent'

// POST /api/chat-hub/chats/[id]/edit-rerun — { messageId, stepId, operations }
// The media viewer's LAYER EDITOR: re-runs an edit_image step's recipe with
// user-modified operations (moved text, recolored shapes, toggled layers) and
// swaps the step's image for the new render. The old URL stays in the message
// so nothing already referenced breaks.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireChatHubAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const chatId = parseInt((await params).id)
  if (isNaN(chatId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const messageId = typeof body.messageId === 'number' ? body.messageId : NaN
  const stepId = typeof body.stepId === 'string' ? body.stepId : ''
  const operations = Array.isArray(body.operations) ? body.operations : null
  if (isNaN(messageId) || !stepId || !operations || operations.length === 0 || operations.length > 20) {
    return NextResponse.json({ error: 'messageId, stepId and 1-20 operations are required' }, { status: 400 })
  }

  const chat = await prisma.chat.findFirst({ where: { id: chatId, userId: user.id }, select: { id: true } })
  if (!chat) return NextResponse.json({ error: 'Chat not found' }, { status: 404 })

  const row = await prisma.chatMessage.findFirst({
    where: { id: messageId, chatId, role: 'assistant' },
  })
  if (!row) return NextResponse.json({ error: 'Message not found' }, { status: 404 })

  const meta = (row.metadata ?? {}) as Record<string, any>
  const steps: AgentStep[] = Array.isArray(meta.agentSteps) ? meta.agentSteps : []
  const step = steps.find(s => s.id === stepId)
  if (!step?.editRecipe) {
    return NextResponse.json({ error: 'This image has no editable layer recipe' }, { status: 400 })
  }

  // Everything already in the conversation is fair game for source + overlays
  // — including mid-run authorized URLs (dataset buckets / search_refs)
  // persisted as metadata.allowedExtra on assistant rows
  const imageRows = await prisma.chatMessage.findMany({
    where: { chatId },
    orderBy: { id: 'desc' },
    take: 60,
    select: { imageUrls: true, metadata: true },
  })
  const allowedImages = new Set<string>()
  for (const r of imageRows) {
    for (const u of r.imageUrls) allowedImages.add(u)
    const extra = (r.metadata as Record<string, unknown> | null)?.allowedExtra
    if (Array.isArray(extra)) for (const u of extra) if (typeof u === 'string') allowedImages.add(u)
  }
  if (step.editRecipe.image_url) allowedImages.add(step.editRecipe.image_url)

  const out = await executeEditImage(
    {
      ...(step.editRecipe.image_url ? { image_url: step.editRecipe.image_url } : {}),
      ...(step.editRecipe.canvas ? { canvas: step.editRecipe.canvas } : {}),
      operations: operations as any,
    },
    { user: { id: user.id, email: user.email }, allowedImages },
  )
  if ('error' in out) return NextResponse.json({ error: out.error }, { status: 400 })

  // Swap the step to the new render + keep the updated recipe for further edits
  step.imageUrl = out.imageUrl
  step.editRecipe = { ...step.editRecipe, operations }
  const imageUrls = row.imageUrls.includes(out.imageUrl) ? row.imageUrls : [...row.imageUrls, out.imageUrl]

  await prisma.chatMessage.update({
    where: { id: row.id },
    data: {
      imageUrls,
      metadata: JSON.parse(JSON.stringify({ ...meta, agentSteps: steps })),
    },
  })

  // User-directed re-edit is a deliverable — surface it in the portal feed
  // (same shape as persistFinalEdit's rows)
  try {
    await prisma.generatedImage.create({
      data: {
        userId: user.id,
        prompt: `Edited (layers): ${(step.task ?? '').slice(0, 200) || 'chat edit'}`,
        imageUrl: out.imageUrl,
        model: 'chat-image-edit',
        ticketCost: 0,
        referenceImageUrls: [],
        expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      },
    })
  } catch (err) {
    console.error('edit-rerun feed persist error:', err)
  }

  return NextResponse.json({ imageUrl: out.imageUrl, width: out.width, height: out.height })
}
