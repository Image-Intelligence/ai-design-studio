import prisma from '@/lib/prisma'
import { emptyChatState } from '@/lib/nova/agent-tools'
import { DEFAULT_NOVA_MODEL } from '@/lib/nova/config'

/*
 * The account's one Prism chat - made on first open, and always the SAME one.
 *
 * Two first opens can race (the panel asks twice as the page mounts) and each
 * make a chat. Before 2026-10-20 this returned the oldest, which could be the
 * empty twin: the user talked into the other and a reload "cleared" the chat
 * (dirtysecretai@: #179 empty, #180 with the messages). Now every caller
 * settles on one keeper - the oldest chat that has messages, else the oldest -
 * the twins' messages are moved into it, and empty twins are dropped (only
 * while still empty, in the delete itself, so nothing said is ever lost).
 */
export async function prismChat(userId: number) {
  const select = { id: true, title: true, model: true, updatedAt: true, skills: true, memorySummary: true, summaryUpToId: true } as const
  const list = () => prisma.chat.findMany({
    where: { userId, source: 'prism' }, orderBy: { id: 'asc' },
    select: { ...select, _count: { select: { messages: true } } },
  })
  let all = await list()
  if (!all.length) {
    await prisma.chat.create({
      data: { userId, title: 'Prism', model: DEFAULT_NOVA_MODEL, source: 'prism', agentMode: 'approved', titleLocked: true, skills: emptyChatState() as object },
    })
    // A racing first open may have made one too: read them all again and settle below
    all = await list()
  }
  const keeper = all.find(c => c._count.messages > 0) ?? all[0]
  const twins = all.filter(c => c.id !== keeper.id)
  if (twins.length) {
    const said = twins.filter(c => c._count.messages > 0).map(c => c.id)
    if (said.length) {
      await prisma.chatMessage.updateMany({ where: { chatId: { in: said } }, data: { chatId: keeper.id } })
      await prisma.chat.update({ where: { id: keeper.id }, data: { updatedAt: new Date() } })
    }
    await prisma.chat.deleteMany({ where: { id: { in: twins.map(c => c.id) }, userId, source: 'prism', messages: { none: {} } } }).catch(() => {})
  }
  const { _count, ...chat } = keeper
  void _count
  return chat
}
