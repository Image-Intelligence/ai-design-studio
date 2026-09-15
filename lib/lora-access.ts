import { prisma } from '@/lib/prisma'
import { checkIsAdmin } from '@/lib/admin-check'

/**
 * May this account generate with this LoRA?
 *
 * /api/generate took loraUrl straight off the request body and handed it to
 * fal as `loras[].path`. Listing was already scoped per user; USING was not,
 * so anyone holding another account's LoRA URL could generate with their
 * trained weights. This is the check that closes it.
 *
 * The rules, in this order and for these reasons:
 *
 *  1. `user-loras/<id>/…` is decided by the key alone. Ownership is baked into
 *     the path at upload, so this is authoritative and cheap — and it comes
 *     FIRST so that no database row can be used to claim someone else's
 *     object.
 *  2. A UserLora row for this account allows it. An explicit ownership record
 *     is the strongest evidence there is, and it is what lets a library
 *     carried over from the old browser-local storage keep working.
 *  3. `loras/…` and `training/loras/…` are the studio's own, produced by the
 *     training pipeline and not owned by any user: admins only.
 *  4. Anything else is a URL somebody typed. Refused.
 *
 * Returns a reason rather than a boolean, so the caller can say WHICH rule
 * refused it. "Not allowed" with no explanation is how a legitimate user ends
 * up filing a bug.
 */
export async function loraUsableBy(
  loraUrl: unknown,
  user: { id: number; email: string },
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!loraUrl || typeof loraUrl !== 'string') return { ok: true }

  let path: string
  try {
    path = new URL(loraUrl).pathname.replace(/^\/+/, '')
  } catch {
    path = loraUrl.replace(/^\/+/, '')
  }

  // 1. The key decides, and nothing can override it.
  const owned = path.match(/^user-loras\/(\d+)\//)
  if (owned) {
    return Number(owned[1]) === user.id
      ? { ok: true }
      : { ok: false, reason: 'That LoRA belongs to another account.' }
  }

  // 2. Recorded against this account.
  const row = await prisma.userLora.findFirst({
    where: { userId: user.id, loraUrl },
    select: { id: true },
  })
  if (row) return { ok: true }

  // 3. The studio's own weights.
  if (/^(training\/)?loras\//.test(path)) {
    return (await checkIsAdmin(user.email))
      ? { ok: true }
      : { ok: false, reason: 'That LoRA is not available on your account.' }
  }

  // 4. Not ours, not theirs.
  return { ok: false, reason: 'That LoRA is not in your library.' }
}
