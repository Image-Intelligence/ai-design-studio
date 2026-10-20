/**
 * One way to run a Gemini TEXT model, whichever API it lives on (2026-10-18).
 *
 * Most Gemini models answer `models/{id}:generateContent`. Some newer ones -
 * Gemini Omni 1.1 Flash and Omni Flash Preview - answer ONLY Google's
 * Interactions API (`/v1beta/interactions`; generateContent returns 400 "This
 * model only supports Interactions API"). The callers (Prompt Enhance,
 * Storyboard's Draft with AI and Edit with AI) were written against
 * generateContent, so this takes a generateContent request body and returns a
 * `Response` in generateContent's shape for both - the routes keep reading
 * `candidates[0].content.parts`, `finishReason` and `usageMetadata` as before.
 *
 * Interactions differences handled here (each checked live on 2026-10-18):
 *  - `input` is a list of {type:'text', text} / {type:'image', data, mime_type},
 *    so `parts` with `inlineData` map across one to one;
 *  - generation_config is snake_case (thinking_level, max_output_tokens);
 *  - Omni rejects JSON mode ("JSON mode is not enabled for this model"), so a
 *    JSON request becomes a "reply with JSON only" line - the routes already
 *    strip ``` fences before parsing, and Omni returned clean JSON that way;
 *  - `store: false`, so Google keeps no conversation for a one-shot call;
 *  - the answer is the `model_output` step's text (a `thought` step comes first).
 *
 * `thinkingConfig.thinkingLevel` is a Gemini 3.x field - the 2.5 models answer
 * it with a 400 ("Thinking level is not supported"), so a 400 on a request
 * that carried it is retried once without it. Callers no longer need their
 * own retry for that.
 */
import { INTERACTIONS_MODELS } from '@/lib/prompt-models'

const API = 'https://generativelanguage.googleapis.com/v1beta'

type Part = { text?: string; inlineData?: { mimeType: string; data: string } }
export type GeminiRequest = {
  contents: { role?: string; parts: Part[] }[]
  generationConfig?: {
    temperature?: number
    maxOutputTokens?: number
    responseMimeType?: string
    thinkingConfig?: { thinkingLevel?: string }
  }
}

export async function geminiGenerate(model: string, body: GeminiRequest, opts: { signal?: AbortSignal } = {}): Promise<Response> {
  const key = process.env.GEMINI_API_KEY
  if (!key) return Response.json({ error: { message: 'GEMINI_API_KEY is not configured' } }, { status: 500 })
  const run = INTERACTIONS_MODELS.has(model) ? interactions : generateContent
  const res = await run(model, body, key, opts.signal)
  if (res.status === 400 && body.generationConfig?.thinkingConfig) {
    const { thinkingConfig: _drop, ...rest } = body.generationConfig
    return run(model, { ...body, generationConfig: rest }, key, opts.signal)
  }
  return res
}

function generateContent(model: string, body: GeminiRequest, key: string, signal?: AbortSignal) {
  return fetch(`${API}/models/${model}:generateContent?key=${key}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal, body: JSON.stringify(body),
  })
}

async function interactions(model: string, body: GeminiRequest, key: string, signal?: AbortSignal): Promise<Response> {
  const gc = body.generationConfig ?? {}
  const input: ({ type: 'text'; text: string } | { type: 'image'; data: string; mime_type: string })[] = []
  for (const c of body.contents) for (const p of c.parts) {
    if (p.inlineData) input.push({ type: 'image', data: p.inlineData.data, mime_type: p.inlineData.mimeType })
    else if (p.text) input.push({ type: 'text', text: p.text })
  }
  if (gc.responseMimeType === 'application/json') input.push({ type: 'text', text: 'Reply with the JSON object only - no prose, no code fences.' })
  const res = await fetch(`${API}/interactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    signal,
    body: JSON.stringify({
      model, input, store: false,
      generation_config: {
        ...(gc.temperature !== undefined ? { temperature: gc.temperature } : {}),
        ...(gc.maxOutputTokens ? { max_output_tokens: gc.maxOutputTokens } : {}),
        ...(gc.thinkingConfig?.thinkingLevel ? { thinking_level: gc.thinkingConfig.thinkingLevel } : {}),
      },
    }),
  })
  const j = await res.json().catch(() => ({})) as {
    status?: string
    error?: { message?: string }
    steps?: { type?: string; content?: { type?: string; text?: string }[] }[]
    usage?: { total_input_tokens?: number; total_output_tokens?: number; total_thought_tokens?: number }
  }
  if (!res.ok) return Response.json({ error: { message: j.error?.message ?? `Interactions ${res.status}` } }, { status: res.status })
  const text = (j.steps ?? []).filter(s => s.type === 'model_output')
    .flatMap(s => s.content ?? []).filter(c => c.type === 'text').map(c => c.text ?? '').join('')
  return Response.json({
    candidates: [{ content: { parts: [{ text }] }, finishReason: j.status === 'completed' ? 'STOP' : j.status === 'incomplete' ? 'MAX_TOKENS' : (j.status ?? '').toUpperCase() }],
    usageMetadata: { promptTokenCount: j.usage?.total_input_tokens ?? 0, candidatesTokenCount: j.usage?.total_output_tokens ?? 0, thoughtsTokenCount: j.usage?.total_thought_tokens ?? 0 },
  })
}

/** The answer's text, from a generateContent-shaped body. */
export function geminiText(data: unknown): string {
  const parts = (data as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] } | null)?.candidates?.[0]?.content?.parts ?? []
  return parts.filter(p => !p.thought).map(p => p.text ?? '').join('')
}
