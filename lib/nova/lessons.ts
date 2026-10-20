/**
 * Nova Studio - what Nova LEARNS about each model (server only, 2026-10-19).
 *
 * The static notes (lib/nova/model-notes) were written by hand from the
 * productions made on this site. These are learned as Nova works: when the
 * continuity check or the critic flags a failure that looks like a MODEL'S
 * HABIT ("Kling bobs the camera unless told to hold steady", "adds a second
 * board when asked for one") rather than a one-off content slip, the lesson is
 * kept for that model - and Nova can save one itself (learn_about_model) when
 * it notices a pattern. They are shown next to the static notes whenever Nova
 * looks a model up, so the next production avoids the same trap.
 *
 * Per account (in portalPreferences `novaModelLessons`, like Nova's memory):
 * lessons come from the account's own work, so they never carry another
 * user's content. Capped per model and in all.
 */
import prisma from '@/lib/prisma'

export type ModelLesson = { text: string; at: string; from: 'check' | 'critic' | 'nova' }
type Store = Record<string, ModelLesson[]>
const PER_MODEL = 6
const MAX_MODELS = 60
const LESSON_MAX = 200

/** The catalog id a library row's model belongs to ("nano-banana-2.1-edit" -> "nano-banana-2.1", "audio:eleven-v4" -> "eleven-v4"). */
export const lessonKey = (model: string) => model.replace(/^audio:/, '').replace(/^3d:/, '').replace(/-edit$/, '').trim().toLowerCase().slice(0, 80)

export async function loadLessons(userId: number): Promise<Store> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { portalPreferences: true } })
  const raw = ((u?.portalPreferences ?? {}) as Record<string, any>).novaModelLessons
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Store : {}
}

/** Keep a lesson for a model; a near-duplicate refreshes the old one instead. */
export async function addLesson(userId: number, model: string, text: string, from: ModelLesson['from']): Promise<void> {
  const key = lessonKey(model)
  const t = text.replace(/\s+/g, ' ').trim().slice(0, LESSON_MAX)
  if (!key || t.length < 12) return
  const store = await loadLessons(userId)
  const words = (s: string) => new Set(s.toLowerCase().split(/\W+/).filter(w => w.length > 3))
  const tw = words(t)
  const similar = (s: string) => { const sw = words(s); const common = [...tw].filter(w => sw.has(w)).length; return common / Math.max(1, Math.min(tw.size, sw.size)) > 0.6 }
  const list = (store[key] ?? []).filter(l => !similar(l.text))
  store[key] = [{ text: t, at: new Date().toISOString(), from }, ...list].slice(0, PER_MODEL)
  // Oldest models drop out past the cap
  const keys = Object.keys(store).sort((a, b) => (store[b][0]?.at ?? '').localeCompare(store[a][0]?.at ?? '')).slice(0, MAX_MODELS)
  const next: Store = Object.fromEntries(keys.map(k => [k, store[k]]))
  await prisma.$executeRaw`
    UPDATE "User"
    SET "portalPreferences" = COALESCE("portalPreferences"::jsonb, '{}'::jsonb) || jsonb_build_object('novaModelLessons', ${JSON.stringify(next)}::jsonb)
    WHERE id = ${userId}`
}

/**
 * The account's most recently learned lessons, for the turn's instructions
 * (2026-10-20): they used to appear only when Nova looked a model up, so a
 * production often walked into a known trap and the critic sent it round
 * again. Newest models first, a few lessons each - a few hundred tokens.
 */
export function recentLessons(store: Store, maxModels = 8, perModel = 3): string {
  return Object.entries(store)
    .filter(([, l]) => l?.length)
    .sort((a, b) => (b[1][0]?.at ?? '').localeCompare(a[1][0]?.at ?? ''))
    .slice(0, maxModels)
    .map(([id, l]) => `- ${id}: ${l.slice(0, perModel).map(x => x.text).join(' | ')}`)
    .join('\n')
}

/** The learned lessons for some models, as lines for Nova to read. */
export function lessonsFor(store: Store, ids: string[]): string {
  const out: string[] = []
  for (const id of [...new Set(ids.map(lessonKey))]) {
    const l = store[id]
    if (l?.length) out.push(`- ${id} (learned from your past work): ${l.slice(0, 4).map(x => x.text).join(' | ')}`)
  }
  return out.join('\n')
}
