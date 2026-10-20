/**
 * Nova Studio - a chat's references (2026-10-19, owner): the assets and My
 * Generations pictures the user switched on in the studio panel, so Nova
 * knows what "the character", "my product" or "that shot" means in every
 * message, not only the one they were picked for.
 *
 * Stored on the chat (NovaChatState.refs, ids only). Resolved here against
 * the account's OWN assets and generations - an id that is gone or not
 * theirs simply drops out. Used by the chat route (what the panel shows) and
 * by the agent (what Nova is told and shown).
 *
 * SERVER ONLY.
 */
import prisma from '@/lib/prisma'
import { findAsset, storedRefs } from '@/lib/user-assets'
import { kindOf, clip, type NovaBible } from '@/lib/nova/agent-tools'
import type { NovaMediaKind } from '@/lib/nova/config'

export type ChatRefAsset = {
  id: number; name: string; kind: string; notes: string; thumb: string | null
  /** Its pictures (all of them, for showing) and the ones that are My Generations rows (usable as reference_ids). */
  pictures: { url: string; thumb: string | null }[]
  ids: number[]
}
export type ChatRefGeneration = { id: number; kind: NovaMediaKind; url: string; thumb: string | null; prompt: string; model: string }
export type ChatRefs = { assets: ChatRefAsset[]; generations: ChatRefGeneration[] }

export async function resolveChatRefs(userId: number, refs: { assets: number[]; generations: number[] } | undefined): Promise<ChatRefs> {
  if (!refs || (!refs.assets.length && !refs.generations.length)) return { assets: [], generations: [] }
  const rawAssets = (await Promise.all(refs.assets.map(id => findAsset(userId, id)))).filter((a): a is NonNullable<typeof a> => !!a)
  const assetPics = rawAssets.map(a => storedRefs(a.refs))
  const urls = assetPics.flat().map(r => r.url)
  const [picRows, genRows] = await Promise.all([
    urls.length ? prisma.generatedImage.findMany({ where: { userId, isDeleted: false, imageUrl: { in: urls } }, select: { id: true, imageUrl: true, thumbnailUrl: true } }) : [],
    refs.generations.length ? prisma.generatedImage.findMany({
      where: { userId, isDeleted: false, id: { in: refs.generations } },
      select: { id: true, imageUrl: true, thumbnailUrl: true, model: true, prompt: true, videoMetadata: true },
    }) : [],
  ])
  const assets: ChatRefAsset[] = rawAssets.map((a, i) => {
    const pics = assetPics[i]
    const rowOf = (u: string) => picRows.find(r => r.imageUrl === u)
    return {
      id: a.id, name: a.name, kind: a.kind, notes: a.notes ?? '',
      thumb: rowOf(pics[0]?.url ?? '')?.thumbnailUrl ?? pics[0]?.thumb ?? pics[0]?.url ?? null,
      pictures: pics.map(p => ({ url: p.url, thumb: rowOf(p.url)?.thumbnailUrl ?? p.thumb ?? null })),
      ids: pics.map(p => rowOf(p.url)?.id).filter((v): v is number => !!v),
    }
  })
  // In the order they were picked
  const generations: ChatRefGeneration[] = refs.generations.map(id => genRows.find(r => r.id === id)).filter((r): r is NonNullable<typeof r> => !!r).map(r => {
    return {
      id: r.id, kind: kindOf(r), url: r.imageUrl, model: r.model, prompt: clip(r.prompt, 160),
      // Pictures: their thumbnail. Clips: the library's poster proxy (it makes one when the row has none)
      thumb: kindOf(r) === 'image' ? (r.thumbnailUrl ?? null) : kindOf(r) === 'audio' ? null : `/api/images/${r.id}?thumb=1`,
    }
  })
  return { assets, generations }
}

/** The references as Nova reads them, in the user's message. */
export function chatRefsText(r: ChatRefs): string {
  if (!r.assets.length && !r.generations.length) return ''
  const lines: string[] = []
  for (const a of r.assets) lines.push(`- Asset ${a.id} "${a.name}" (${a.kind})${a.notes ? ` - notes: ${clip(a.notes, 400)}` : ''}; pictures usable as reference_ids: ${a.ids.length ? a.ids.map(i => `#${i}`).join(', ') : 'none in My Generations'}`)
  for (const g of r.generations) lines.push(`- #${g.id} (${g.kind}, ${g.model})${g.prompt ? `: ${g.prompt}` : ''}`)
  return `[References the user has switched on for this chat - what they mean by "the character", "my product", "that shot" unless they say otherwise; keep work consistent with them and pass their ids as reference_ids when you make something with them:\n${lines.join('\n')}]`
}

/** The chat's look bible with a thumbnail per picture, for the studio panel. */
export type ChatBibleView = { characters: { name: string; pictures: { id: number; thumb: string | null }[] }[]; places: { name: string; pictures: { id: number; thumb: string | null }[] }[]; style: string }
export async function resolveBible(userId: number, b: NovaBible | null | undefined): Promise<ChatBibleView | null> {
  if (!b) return null
  const all = [...b.characters, ...b.places].flatMap(e => e.ids)
  const rows = all.length ? await prisma.generatedImage.findMany({ where: { userId, isDeleted: false, id: { in: all } }, select: { id: true, imageUrl: true, thumbnailUrl: true } }) : []
  const pics = (ids: number[]) => ids.map(id => rows.find(r => r.id === id)).filter((r): r is NonNullable<typeof r> => !!r).map(r => ({ id: r.id, thumb: r.thumbnailUrl ?? r.imageUrl }))
  const view = {
    characters: b.characters.map(c => ({ name: c.name, pictures: pics(c.ids) })).filter(c => c.pictures.length),
    places: b.places.map(p => ({ name: p.name, pictures: pics(p.ids) })).filter(p => p.pictures.length),
    style: b.style,
  }
  return view.characters.length || view.places.length || view.style ? view : null
}
