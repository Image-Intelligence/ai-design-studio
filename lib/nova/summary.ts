import { readChatState } from '@/lib/nova/agent-tools'
import type { NovaChatSummary } from '@/lib/nova/config'

/** A Chat row as the studio's chat list shows it. */
export function chatSummary(c: { id: number; title: string; model: string; updatedAt: Date; skills: unknown }): NovaChatSummary {
  const s = readChatState(c.skills)
  return { id: c.id, title: c.title, model: c.model, updatedAt: c.updatedAt.toISOString(), spent: s.spent, folderId: s.folderId, unread: !!s.unread }
}
