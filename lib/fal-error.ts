/**
 * fal's own words for a refused request.
 *
 * A validation failure comes back as FastAPI's shape - `detail` holding one
 * entry per problem, each with a `msg` that names the offending file:
 *
 *   {"detail":[{"loc":["body","images_data_url"],
 *               "msg":"Invalid image(s) in input; image 78.jpg has dimensions
 *                      928x1152, but minimum required is 1024x1536.",
 *               "type":"value_error"}]}
 *
 * The fal client cannot parse that and raises "Unexpected status code: 422",
 * which names neither the problem nor the file. Both the webhook and the
 * status poller see the real body; this turns it into a sentence.
 *
 * Returns null when there is nothing useful, so callers keep their fallback.
 */
export function falDetailMessage(body: unknown): string | null {
  if (!body) return null
  if (typeof body === 'string') return body.trim() ? body.slice(0, 1500) : null
  if (typeof body !== 'object') return null

  const detail = (body as { detail?: unknown }).detail
  if (Array.isArray(detail)) {
    const msgs = detail
      .map(d => (d && typeof d === 'object' && 'msg' in d) ? String((d as { msg: unknown }).msg) : '')
      .filter(Boolean)
    if (msgs.length > 0) return msgs.join(' \u00b7 ').slice(0, 1500)
  }
  if (typeof detail === 'string' && detail.trim()) return detail.slice(0, 1500)

  const message = (body as { message?: unknown }).message
  if (typeof message === 'string' && message.trim()) return message.slice(0, 1500)
  return null
}
