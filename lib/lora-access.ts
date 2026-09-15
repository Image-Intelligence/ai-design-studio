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
 *  3. The studio's own trained weights: the `loras/…`, `training/loras/…` and
 *     `training/video-loras/…` prefixes, and any URL recorded as the output of
 *     a LoraTrainingJob. Admins only, because training is admin-only.
 *
 *     That last clause is not decoration. fal's trainers return the finished
 *     weights on THEIR host — v3b.fal.media/files/… — so a LoRA trained here
 *     never touches our bucket and matches no prefix we own. Leaving it out
 *     refused every LoRA the studio has ever trained, which is most of them.
 *
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

  // 3. The studio's own weights — by prefix, or by the training job that
  //    produced them, since fal-hosted outputs live under no prefix of ours.
  const ourPrefix = /^training\/(video-)?loras\/|^loras\//.test(path)
  const trained = ourPrefix || await prisma.loraTrainingJob.findFirst({
    where: { loraUrl },
    select: { id: true },
  })
  if (trained) {
    return (await checkIsAdmin(user.email))
      ? { ok: true }
      : { ok: false, reason: 'That LoRA is not available on your account.' }
  }

  // 4. Not ours, not theirs.
  return { ok: false, reason: 'That LoRA is not in your library.' }
}

/**
 * Is there actually a usable file behind this LoRA URL?
 *
 * A browser upload that reads nothing — an iOS file still in iCloud, a stale
 * pick from Files — writes a real object of zero bytes. It exists, it lists,
 * it serves a 200, and the only symptom is that fal fails the job with a bare
 * 422 that mentions neither the LoRA nor its size. Whoever sees that error
 * goes looking at their prompt and their reference images, because that is
 * what the message talks about.
 *
 * Checked here, at the same choke point as access and before any ticket is
 * spent, so the answer names the real problem. Only objects on our own bucket
 * can be measured; a fal- or HuggingFace-hosted URL is somebody else's to
 * serve and is left alone.
 */
export async function loraFileProblem(loraUrl: unknown): Promise<string | null> {
  if (!loraUrl || typeof loraUrl !== 'string') return null

  const { isPrivateMedia, keyFromUrl } = await import('@/lib/media-url')
  if (!isPrivateMedia(loraUrl)) return null

  const { objectSize } = await import('@/lib/r2')
  const size = await objectSize(keyFromUrl(loraUrl))

  if (size === null) return 'That LoRA file is missing from storage. Upload it again.'
  // A real LoRA is megabytes. Anything this small is a failed upload, not a
  // model, and saying so beats letting fal answer with a status code.
  if (size < 1024) return 'That LoRA file is empty — the upload did not send any data. Upload it again.'
  return null
}
