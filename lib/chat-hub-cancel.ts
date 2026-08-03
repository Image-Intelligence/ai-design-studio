// In-memory cancel flags for in-flight chat runs. The Stop button POSTs the
// cancel endpoint → the flag is set → the streaming driver (same process)
// checks it between stream parts and winds the run down gracefully: any tool
// already executing finishes, then the model gets no further rounds.
// NOTE: process-local by design — on serverless this only reaches runs held
// by the same instance (fine for the LAN dev setup; revisit if prod needs it).

const flags = new Map<number, number>()
const TTL_MS = 10 * 60_000

export function requestChatCancel(chatId: number): void {
  flags.set(chatId, Date.now())
}

export function isChatCancelRequested(chatId: number): boolean {
  const t = flags.get(chatId)
  if (!t) return false
  if (Date.now() - t > TTL_MS) {
    flags.delete(chatId)
    return false
  }
  return true
}

export function clearChatCancel(chatId: number): void {
  flags.delete(chatId)
}
