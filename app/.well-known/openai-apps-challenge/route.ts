/**
 * OpenAI's domain check for the connector's directory listing: the challenge
 * token OpenAI shows during submission, as plain text and nothing else. Set
 * OPENAI_APPS_CHALLENGE on Vercel to that token; until then this is a 404.
 */
export const dynamic = 'force-dynamic'
export function GET() {
  const token = (process.env.OPENAI_APPS_CHALLENGE ?? '').trim()
  if (!token) return new Response('Not configured', { status: 404, headers: { 'content-type': 'text/plain' } })
  return new Response(token, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } })
}
