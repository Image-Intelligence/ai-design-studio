import { isPrivateMedia, isOurMedia, signMediaUrl, FAL_TTL } from './media-url'

/**
 * Fetching our own private media from the server.
 *
 * There are two ways to do it and they are not equivalent.
 *
 * `ensureMediaFetchPatched()` wraps globalThis.fetch so that ~140 existing
 * call sites doing `fetch(row.imageUrl)` keep working. That is a convenience
 * for the long tail, and it is FRAGILE by nature: it depends on a global
 * staying wrapped for the life of the process. Next's dev server reloads
 * modules and replaces globals, and the original guard was a boolean on
 * globalThis — so once the patch was lost the flag still said "patched" and
 * nothing ever put it back. Locally that turned every server-side media fetch
 * into a 401 while production, a fresh process, was fine.
 *
 * `fetchMedia()` signs explicitly and depends on nothing. Anything whose
 * correctness matters should use it rather than trusting the wrapper.
 */

const MARK = '__privateMediaPatched'

/** Sign our own URLs, then fetch. No global state involved. */
export function fetchMedia(input: string, init?: RequestInit): Promise<Response> {
  // isOurMedia, not isPrivateMedia: a stored Worker link with a dead
  // signature is re-signed here too, rather than fetched as-is into a 403.
  return fetch(isOurMedia(input) ? signMediaUrl(input, FAL_TTL) : input, init)
}

/**
 * Wrap globalThis.fetch, and re-wrap it if something has replaced it since.
 *
 * The marker lives on the FUNCTION rather than on globalThis, which is what
 * makes "is the current fetch still ours?" an answerable question. Safe to
 * call as often as you like.
 */
export function ensureMediaFetchPatched(): void {
  if (typeof globalThis === 'undefined' || typeof globalThis.fetch !== 'function') return
  const current = globalThis.fetch as typeof fetch & { [MARK]?: boolean }
  if (current[MARK]) return

  const original = current
  const patched = async function patchedFetch(
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> {
    try {
      if (typeof input === 'string' && isPrivateMedia(input)) {
        input = signMediaUrl(input, FAL_TTL)
      } else if (input instanceof URL && isPrivateMedia(input.href)) {
        input = new URL(signMediaUrl(input.href, FAL_TTL))
      } else if (input instanceof Request && isPrivateMedia(input.url)) {
        input = new Request(signMediaUrl(input.url, FAL_TTL), input)
      }
    } catch {
      // Signing is an optimisation on the way to the same object; never let it
      // be the reason a request does not happen at all.
    }
    return original(input, init)
  } as typeof fetch & { [MARK]?: boolean }

  patched[MARK] = true
  globalThis.fetch = patched
}
