/**
 * Server startup hooks.
 *
 * The one job here is teaching the server how to read its own private media.
 *
 * When the media bucket was public, ~140 server-side call sites could simply
 * `fetch(row.imageUrl)` — the thumbnailer, the video ref fitter, the ffmpeg
 * assembler, the chat image tools, every re-host path. The moment public
 * access is switched off, every one of those returns 401, and each would have
 * to be found and changed by hand. Missing one means a feature that silently
 * stops working in production.
 *
 * So instead of editing 140 call sites, the rewrite happens once, here. The
 * condition is deliberately as narrow as it can be: a URL is only touched if
 * it points at OUR private bucket, in which case it is signed exactly as it
 * would be for any other reader. Every other fetch in the process — fal,
 * Gemini, LemonSqueezy, R2's own S3 endpoint — is passed through untouched.
 */
export async function register() {
  // The edge runtime has its own module instance and none of these paths.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  /*
   * The wrapper is a CONVENIENCE for ~140 call sites doing fetch(row.imageUrl),
   * not a guarantee. It used to guard itself with a boolean on globalThis, so
   * when Next's dev reloading replaced globalThis.fetch the patch was lost and
   * the flag still claimed it was applied — every server-side media fetch 401d
   * locally while production, a fresh process, stayed fine.
   *
   * ensureMediaFetchPatched marks the function instead, so it can tell whether
   * the current fetch is still its own and re-wrap when it is not. Anything
   * whose correctness actually matters calls fetchMedia() and signs outright.
   */
  const { ensureMediaFetchPatched } = await import('./lib/media-fetch')
  ensureMediaFetchPatched()
}
