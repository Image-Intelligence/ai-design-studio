import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { requireStoryboardUser, ownRefs } from '@/lib/storyboard-gate'
import { jsonPrivate } from '@/lib/api-json'
import { canonicalisePayload } from '@/lib/media-url'
import { enforceContentFilter } from '@/lib/content-filter'
import { submitClipTool, boardTakes } from '@/lib/storyboard-shoot'
import { clipTool } from '@/lib/storyboard-tools'
import { sanitizeShots } from '@/lib/storyboard'

/**
 * POST /api/employees/storyboards/[id]/clip-edit - the Shot edits phase.
 *
 * Body: { shotId, tool, prompt?, refs?: string[], choice?: string, adds?: number, lineId? }
 *   tool: a lib/storyboard-tools CLIP_TOOLS id (upscale, restyle, edit with
 *   words, remove something, recast, extend, sound effects, lip-sync...)
 * Returns: { video, takes, ticketCost } - the slot's new `video` is rendering;
 * the page's shoot polling (GET ../shoot) settles it into a new take.
 *
 * The tool runs through /api/video/generate (lib/storyboard-shoot
 * submitClipTool), which measures the clip, prices and charges it, keeps
 * admin-only tools admin-only and checks the clip and pictures are the
 * account's own. Here: the tool must be one the studio offers, its prompt
 * passes the CCBill filter, references are the account's own pictures, and
 * a lip-sync uses the shot's own recorded line.
 */
export const runtime = 'nodejs'
export const maxDuration = 120

type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, ctx: Ctx) {
  const user = await requireStoryboardUser()
  if (!user) return jsonPrivate({ error: 'Unauthorized' }, { status: 401 })
  const id = parseInt((await ctx.params).id)
  const board = Number.isFinite(id) ? await prisma.storyboard.findFirst({ where: { id, userId: user.id } }) : null
  if (!board) return jsonPrivate({ error: 'Not found' }, { status: 404 })

  const body = canonicalisePayload(await req.json().catch(() => ({}))) as Record<string, unknown>
  const tool = clipTool(String(body.tool ?? ''))
  if (!tool) return jsonPrivate({ error: 'Unknown tool' }, { status: 400 })
  const shotId = typeof body.shotId === 'string' ? body.shotId : ''
  const shot = sanitizeShots(board.shots).find(s => s.id === shotId)
  if (!shot) return jsonPrivate({ error: 'That shot is not on the board (save first?)' }, { status: 404 })

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim().slice(0, 2000) : ''
  if (tool.prompt === 'required' && !prompt) return jsonPrivate({ error: `${tool.label} needs words - say what to do` }, { status: 400 })
  if (prompt) {
    const cf = await enforceContentFilter(prompt, user.email)
    if (!cf.ok) return jsonPrivate({ error: cf.reason }, { status: 400 })
  }
  // The clip's length limits, from what the slot recorded (the route measures it again)
  const secs = shot.video?.seconds ?? 0
  if (tool.maxSec && secs > tool.maxSec + 0.5) return jsonPrivate({ error: `${tool.label} takes clips up to ${tool.maxSec}s - this one is ${secs}s` }, { status: 400 })
  if (tool.minSec && secs && secs < tool.minSec - 0.2) return jsonPrivate({ error: `${tool.label} needs a clip of at least ${tool.minSec}s - this one is ${secs}s` }, { status: 400 })

  // References: the account's own pictures (an admin's pass), up to what the tool takes
  let refs: string[] = []
  if (tool.refs) {
    const sent = (Array.isArray(body.refs) ? body.refs : []).filter((u): u is string => typeof u === 'string' && /^https:\/\//.test(u)).slice(0, tool.refs.max)
    refs = await ownRefs(user, sent)
    if (sent.length && !refs.length) return jsonPrivate({ error: 'References must be your own pictures' }, { status: 400 })
    if (tool.refs.required && !refs.length) return jsonPrivate({ error: `${tool.label} needs ${tool.refs.label.toLowerCase()}` }, { status: 400 })
  }
  // One setting, kept to the tool's own options
  const settings: Record<string, unknown> = { ...(tool.extra ?? {}) }
  if (tool.choice) {
    const v = String(body.choice ?? '')
    settings[tool.choice.key] = tool.choice.options.some(o => o.value === v) ? v : tool.choice.def
  }
  const adds = tool.adds ? Math.max(tool.adds.min, Math.min(tool.adds.max, Math.round(Number(body.adds) || tool.adds.def))) : undefined
  // Lip-sync: one of the shot's own recorded lines
  let line: { id: string; url: string } | undefined
  if (tool.usesLine) {
    const l = (shot.lines ?? []).find(x => x.id === body.lineId) ?? (shot.lines ?? []).find(x => x.status === 'done' && x.url)
    if (!l?.url || l.status !== 'done') return jsonPrivate({ error: 'Record a voice line on this shot first (the audio lane), then lip-sync it' }, { status: 400 })
    line = { id: l.id, url: l.url }
  }

  const out = await submitClipTool(user, board, shot.id, { id: tool.id, label: tool.label, prompt, refs, settings, seconds: adds, line })
  if ('error' in out) return jsonPrivate({ error: out.error }, { status: out.status ?? 400 })
  return jsonPrivate({ video: out.video, ticketCost: out.ticketCost, takes: await boardTakes(board.id) })
}
