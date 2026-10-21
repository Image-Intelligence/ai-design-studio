/**
 * Nova Studio - what Nova remembers about a user (server only, 2026-10-18).
 *
 * Notes Nova saves with `remember` ("prefers warm colours", "the brand font is
 * bold sans", "never show prices in ads") live in portalPreferences
 * `novaMemory` - the user's own data, which they can read and delete in the
 * studio. They are injected into every turn, so Nova keeps a user's taste
 * across chats without them repeating it. Capped so the prompt stays small.
 */
import prisma from '@/lib/prisma'

export type NovaNote = { id: string; text: string; at: string }
export const NOVA_MEMORY_MAX = 40
const NOTE_MAX = 240

export async function loadNovaMemory(userId: number): Promise<NovaNote[]> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { portalPreferences: true } })
  const raw = ((u?.portalPreferences ?? {}) as Record<string, any>).novaMemory
  return Array.isArray(raw) ? raw.filter(n => n && typeof n.text === 'string').slice(0, NOVA_MEMORY_MAX) : []
}

async function save(userId: number, notes: NovaNote[]) {
  await prisma.$executeRaw`
    UPDATE "User"
    SET "portalPreferences" = COALESCE("portalPreferences"::jsonb, '{}'::jsonb) || jsonb_build_object('novaMemory', ${JSON.stringify(notes.slice(0, NOVA_MEMORY_MAX))}::jsonb)
    WHERE id = ${userId}`
}

/** Add a note (newest first); a near-duplicate replaces the old one. */
export async function addNovaNote(userId: number, text: string): Promise<NovaNote[]> {
  const t = text.replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX)
  if (!t) return loadNovaMemory(userId)
  const notes = (await loadNovaMemory(userId)).filter(n => n.text.toLowerCase() !== t.toLowerCase())
  const next = [{ id: `n${Date.now().toString(36)}`, text: t, at: new Date().toISOString() }, ...notes].slice(0, NOVA_MEMORY_MAX)
  await save(userId, next)
  return next
}

/** A note's text rewritten by the user (the studio's memory panel, 2026-10-21); unknown ids are ignored. */
export async function updateNovaNote(userId: number, id: string, text: string): Promise<NovaNote[]> {
  const t = text.replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX)
  const notes = await loadNovaMemory(userId)
  if (!t || !notes.some(n => n.id === id)) return notes
  const next = notes.map(n => (n.id === id ? { ...n, text: t, at: new Date().toISOString() } : n))
  await save(userId, next)
  return next
}

export async function removeNovaNote(userId: number, id: string): Promise<NovaNote[]> {
  const next = (await loadNovaMemory(userId)).filter(n => n.id !== id)
  await save(userId, next)
  return next
}
