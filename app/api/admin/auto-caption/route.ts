import { prisma } from '@/lib/prisma'
import { checkAuth } from '@/lib/admin-auth'

const GEMINI_API_KEY = process.env.GEMINI_API_KEY!

const MODELS = {
  pro:   'gemini-3.1-pro-preview',
  flash: 'gemini-3.1-flash-lite-preview',
}


type ImagePart = { inlineData: { data: string; mimeType: string } }
type TextPart  = { text: string }
type GeminiPart = ImagePart | TextPart

async function fetchImageAsBase64(url: string, timeoutMs = 20_000): Promise<{ data: string; mimeType: string }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`Image fetch failed: ${res.status}`)
  const buffer = await res.arrayBuffer()
  const mimeType = (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim()
  return { data: Buffer.from(buffer).toString('base64'), mimeType }
}

async function fetchImageAsBase64Safe(url: string, timeoutMs = 20_000): Promise<{ data: string; mimeType: string } | null> {
  try { return await fetchImageAsBase64(url, timeoutMs) } catch { return null }
}

async function callGeminiParts(parts: GeminiPart[], modelId: string, maxTokens = 800, timeoutMs = 60_000): Promise<string> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${GEMINI_API_KEY}`
  const body = JSON.stringify({
    contents: [{ parts }],
    generationConfig: { temperature: 0.3, maxOutputTokens: maxTokens },
  })

  // Retry up to 4 times on 503/429 (rate limit / overload) with exponential backoff
  const MAX_RETRIES = 4
  let lastError: Error | null = null
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delayMs = Math.min(2000 * Math.pow(2, attempt - 1), 30_000) // 2s, 4s, 8s, 16s
      await new Promise(r => setTimeout(r, delayMs))
    }

    const res = await fetch(endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    })

    if (res.status === 503 || res.status === 429) {
      const err = await res.text().catch(() => '')
      lastError = new Error(`Gemini ${res.status} (attempt ${attempt + 1}/${MAX_RETRIES + 1}): ${err.slice(0, 200)}`)
      continue // retry
    }

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Gemini ${res.status}: ${err.slice(0, 300)}`)
    }

    const json = await res.json()
    if (json.promptFeedback?.blockReason) throw new Error(`Blocked by safety filter: ${json.promptFeedback.blockReason}`)
    const candidate = json.candidates?.[0]
    if (!candidate) throw new Error('No candidates in Gemini response')
    const finishReason = candidate.finishReason
    if (finishReason === 'SAFETY') throw new Error(`Blocked by output safety filter`)
    const text = candidate.content?.parts?.[0]?.text
    if (!text) throw new Error(`No text returned (finishReason: ${finishReason ?? 'unknown'})`)
    if (finishReason === 'MAX_TOKENS') throw new Error(`Caption truncated — hit token limit (${maxTokens} tokens). Partial: ${text.slice(0, 80)}…`)
    return text.trim()
  }

  throw lastError ?? new Error('Gemini request failed after retries')
}

function cleanTags(raw: string): string[] {
  return raw
    .split(',')
    .map(t => t.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''))
    .filter(t => t.length > 0 && t.length <= 40)
}

// ── Basic mode ─────────────────────────────────────────────────────────────────
function buildBasicInstruction(mode: 'caption' | 'tags', promptSnippet: string, curatorContext: string | null): string {
  const contextLine = curatorContext ? `\nCURATOR CONTEXT (must be included): ${curatorContext}` : ''
  if (mode === 'caption') {
    return `You are an AI training data curator. Analyze this AI-generated image and write a concise training caption (1–3 sentences) that accurately describes the visual content.\n\nFocus on: main subject, style, key visual elements, mood, and composition.\n\nOriginal generation prompt: "${promptSnippet}"${contextLine}\n\nRespond with ONLY the caption text. No preamble, no quotes.`
  }
  return `You are an AI training data curator. Analyze this AI-generated image and generate 5–15 descriptive tags for a training dataset.\n\nTags must be lowercase. Use hyphens for multi-word terms. Cover: subject, style, color palette, mood, composition, visual elements.\n\nOriginal generation prompt: "${promptSnippet}"${contextLine}\n\nRespond with ONLY a comma-separated list. Example: portrait, dark-lighting, fantasy-style, blue-tones, dramatic-pose`
}

// ── Advanced mode ──────────────────────────────────────────────────────────────
function buildAdvancedInstruction(
  mode:           'caption' | 'tags',
  promptSnippet:  string,
  refCount:       number,
  rating:         { score: number; wasAccurate: boolean | null; tags: string[]; feedbackText: string | null } | null,
  curatorContext: string | null,
): string {
  const contextLine = curatorContext ? `\n- CURATOR CONTEXT (must be included): ${curatorContext}` : ''
  const ratingLine = rating
    ? [
        `Rating: ${rating.score}/5 stars`,
        rating.wasAccurate !== null ? `Prompt accuracy: ${rating.wasAccurate ? 'accurate' : 'inaccurate'}` : null,
        rating.tags.length ? `Feedback tags: ${rating.tags.join(', ')}` : null,
        rating.feedbackText ? `User feedback: "${rating.feedbackText}"` : null,
      ].filter(Boolean).join(' · ')
    : 'No user rating'

  const refLine = refCount > 0
    ? `${refCount} reference image(s) provided below (images 2+) — used for face/subject identity consistency`
    : 'No reference images used'

  const qualityHint = !rating ? '' :
    rating.score === 5 ? '\nQUALITY NOTE: 5-star rating — emphasize high quality, correct anatomy, precise details, and accurate prompt adherence.' :
    rating.score === 4 ? '\nQUALITY NOTE: 4-star rating — this is a good quality generation, highlight its strong aspects.' :
    rating.score <= 2  ? '\nQUALITY NOTE: Low rating — note any visible quality issues, inaccuracies, or anatomical problems.' : ''

  const refHint = refCount > 0
    ? '\nIDENTITY NOTE: Reference images were used for face/subject consistency. If the identity appears consistent across images, note this explicitly.'
    : ''

  if (mode === 'caption') {
    return `You are an expert AI training data curator analyzing an AI-generated image with full context.

IMAGE ORDER: Image 1 = the generated result (caption this one). ${refCount > 0 ? `Images 2–${refCount + 1} = reference images used for subject identity.` : ''}

CONTEXT:
- Original prompt: "${promptSnippet}"
- ${refLine}
- ${ratingLine}${contextLine}
${qualityHint}${refHint}

TASK: Write a training caption (2–4 sentences) for the FIRST IMAGE only.
Focus on: subject, visual style, lighting, composition, quality markers, and identity consistency (if references provided).${curatorContext ? '\nIMPORTANT: The curator context above MUST be reflected in your caption.' : ''}

Respond with ONLY the caption. No preamble, no quotes.`
  }

  // tags mode
  const qualityTags = !rating ? '' :
    rating.score === 5 ? '\nMUST INCLUDE quality tags: high-quality, correct-anatomy' :
    rating.score === 4 ? '\nINCLUDE: good-quality' :
    rating.score <= 2  ? '\nINCLUDE: low-quality' : ''

  const refTags = refCount > 0
    ? '\nIf face/identity is consistent with references, INCLUDE: face-consistent, identity-preserved'
    : ''

  const contextTags2 = curatorContext
    ? `\nCURATOR CONTEXT tags (must include as tags): ${curatorContext.toLowerCase().replace(/[^a-z0-9\s,-]/g, '').split(/[\s,]+/).filter(Boolean).join(', ')}`
    : ''

  return `You are an expert AI training data curator generating tags for an AI-generated image with full context.

IMAGE ORDER: Image 1 = the generated result (tag this one). ${refCount > 0 ? `Images 2–${refCount + 1} = reference images for context.` : ''}

CONTEXT:
- Original prompt: "${promptSnippet}"
- ${refLine}
- ${ratingLine}${contextLine}
${qualityHint}${refHint}

TASK: Generate 8–20 descriptive tags for the FIRST IMAGE.
Rules: lowercase, hyphens for multi-word terms.
Cover: subject, style, lighting, colors, composition, mood, quality.
${qualityTags}${refTags}${contextTags2}

Respond with ONLY a comma-separated list.`
}

// ── FLUX LoRA training caption mode ───────────────────────────────────────────
// Produces long, structured natural-language captions optimised for FLUX.1-dev
// LoRA training. FLUX uses T5-XXL (handles up to ~512 tokens) so longer,
// more descriptive captions are strictly better than tag-soup.
function buildFluxInstruction(
  promptSnippet: string,
  refCount:      number,
  rating:        { score: number; wasAccurate: boolean | null; tags: string[]; feedbackText: string | null } | null,
  triggerWord:   string | null,
): string {
  const triggerLine = triggerWord
    ? `TRIGGER WORD: "${triggerWord}" — this exact string MUST appear once, early in the caption. It will become the LoRA activation token.`
    : 'No trigger word set — describe the subject naturally without a special token.'

  const ratingHint = rating
    ? `Quality rating: ${rating.score}/5${rating.feedbackText ? ` — user note: "${rating.feedbackText}"` : ''}`
    : ''

  const refOrderNote = refCount > 0
    ? `IMAGE ORDER: Image 1 = training image (caption this). Images 2–${refCount + 1} = reference images for subject/identity context only — do NOT caption them.`
    : 'Only one image provided — caption it.'

  return `You are a professional AI model trainer writing FLUX.1-dev LoRA training captions. These captions are the sole signal the model uses to learn, so visual precision is critical.

${triggerLine}

${refOrderNote}

═══ CAPTION STRUCTURE (follow this exact order) ═══

1. SUBJECT LINE — trigger word + subject identity + single most distinctive visual element (1 sentence)
2. COSTUME/OUTFIT — every significant clothing piece, material, color, texture visible in the image (1–2 sentences)
3. POSE & ACTION — exact body position, limb placement, gesture, facial expression if visible (1 sentence)
4. BACKGROUND & SETTING — environment, location, colors, depth, atmosphere (1 sentence)
5. LIGHTING — direction, quality, color temperature, shadow behavior (1 sentence)
6. CAMERA & FRAMING — angle (eye-level/low/high), shot type (close-up/medium/wide/full-body), depth of field (1 sentence)
7. QUALITY CLOSE — end with comma-separated quality descriptors (high detail, sharp focus, [render style])

═══ WRITING RULES ═══

✓ Natural descriptive sentences — NOT comma-separated tags
✓ Visually specific: "glossy black full-plate armor" not "dark outfit"
✓ Name exact colors: "deep crimson", "matte obsidian", "ivory white"
✓ Name exact materials: "leather", "polished metal", "sheer fabric", "carbon fiber"
✓ Vary your wording — don't repeat the same descriptors across sentences
✓ Describe ONLY what is visible in Image 1 — not what should be there conceptually
✗ No subjective adjectives: menacing, beautiful, powerful, iconic (unless literally visible)
✗ No story, lore, or context beyond what is visually present
✗ No phrases: "the image shows", "we can see", "depicting", "appears to be"
✗ No duplicate information between sentences

TARGET LENGTH: 120–220 words (long enough for T5-XXL to extract rich signal, short enough to stay focused)

═══ CONTEXT ═══
- Original generation prompt: "${promptSnippet}"${ratingHint ? `\n- ${ratingHint}` : ''}

Respond with ONLY the caption text. No preamble, no section headers, no quotes, no markdown.`
}

// POST — stream SSE progress while auto-filling captions, tags, or FLUX captions
// Body: { ids: number[], mode: 'caption'|'tags'|'flux', model: 'pro'|'flash', overwrite: boolean, advanced: boolean }
export async function POST(req: Request) {
  if (!checkAuth(req)) return new Response('Unauthorized', { status: 401 })

  const { ids, mode, model: modelKey, overwrite = false, advanced = false, preview = false, context, contextTags } = await req.json() as {
    ids:          number[]
    mode:         'caption' | 'tags' | 'flux'
    model:        'pro' | 'flash'
    overwrite:    boolean
    advanced:     boolean
    preview:      boolean
    context?:     string
    contextTags?: string[]
  }

  const curatorContext = [
    ...(contextTags?.length ? [`Subjects/names: ${contextTags.join(', ')}`] : []),
    ...(context ? [context] : []),
  ].join(' — ') || null

  // For FLUX mode, the first context tag is the trigger word
  const triggerWord = mode === 'flux' ? (contextTags?.[0] ?? null) : null

  if (!Array.isArray(ids) || ids.length === 0) return new Response('ids required', { status: 400 })
  if (!['caption', 'tags', 'flux'].includes(mode))  return new Response('invalid mode', { status: 400 })

  const modelId = MODELS[modelKey] ?? MODELS.flash

  const records = await prisma.generatedImage.findMany({
    where:   { id: { in: ids }, isDeleted: false },
    select:  {
      id: true, prompt: true, imageUrl: true, videoMetadata: true,
      adminTags: true, adminCaption: true,
      referenceImageUrls: true,
      imageRating: { select: { score: true, wasAccurate: true, tags: true, feedbackText: true } },
    },
    orderBy: { id: 'asc' },
  })

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: object) {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)) } catch {}
      }

      let processed = 0
      let skipped   = 0
      let failed    = 0

      send({ type: 'start', total: records.length, modelId, advanced, mode })

      for (let i = 0; i < records.length; i++) {
        const record = records[i]

        // Skip if not overwriting and content already exists
        if (!overwrite) {
          if ((mode === 'caption' || mode === 'flux') && record.adminCaption) {
            skipped++; send({ type: 'skip', id: record.id, current: i + 1, total: records.length, reason: 'already captioned' }); continue
          }
          if (mode === 'tags' && record.adminTags.length > 0) {
            skipped++; send({ type: 'skip', id: record.id, current: i + 1, total: records.length, reason: 'already tagged' }); continue
          }
        }

        // Skip videos entirely (image-only feature)
        const isVideo = /\.(mp4|webm|mov)$/i.test(record.imageUrl)
        if (isVideo) {
          skipped++; send({ type: 'skip', id: record.id, current: i + 1, total: records.length, reason: 'video — images only' }); continue
        }

        // Small delay between images to stay under Gemini rate limits
        if (i > 0) await new Promise(r => setTimeout(r, 800))

        send({ type: 'processing', id: record.id, current: i + 1, total: records.length })

        try {
          const promptSnippet = record.prompt.slice(0, 400)
          const rating        = record.imageRating ?? null

          let result: string

          // Fetch main image
          const mainImage = await fetchImageAsBase64(record.imageUrl, 20_000).catch(err => {
            throw new Error(`Image unreachable: ${err.message}`)
          })

          if (mode === 'flux') {
            // ── FLUX LoRA caption mode ─────────────────────────────────────────
            const refUrls   = (record.referenceImageUrls ?? []).slice(0, 3)
            const refImages = (await Promise.all(refUrls.map(url => fetchImageAsBase64Safe(url, 20_000)))).filter(Boolean) as { data: string; mimeType: string }[]

            const instruction = buildFluxInstruction(promptSnippet, refImages.length, rating, triggerWord)

            const parts: GeminiPart[] = [
              { inlineData: mainImage },
              ...refImages.map(img => ({ inlineData: img })),
              { text: instruction },
            ]

            // FLUX captions target 120–220 words; use 1200 tokens to be safe
            result = await callGeminiParts(parts, modelId, 1200, 90_000).catch(err => { throw new Error(err.message) })

            const caption = result.replace(/^["']|["']$/g, '').trim()
            if (!preview) await prisma.generatedImage.update({ where: { id: record.id }, data: { adminCaption: caption } })
            send({ type: 'result', id: record.id, current: i + 1, total: records.length, value: caption })

          } else if (!advanced) {
            // ── Basic mode ─────────────────────────────────────────────────────
            const instruction = buildBasicInstruction(mode, promptSnippet, curatorContext)
            // 800 tokens for captions (~600 words), 400 for tags (shorter)
            const tokenLimit = mode === 'caption' ? 800 : 400
            result = await callGeminiParts(
              [{ inlineData: mainImage }, { text: instruction }],
              modelId,
              tokenLimit,
            ).catch(err => { throw new Error(err.message) })

            if (mode === 'caption') {
              const caption = result.replace(/^["']|["']$/g, '').trim()
              if (!preview) await prisma.generatedImage.update({ where: { id: record.id }, data: { adminCaption: caption } })
              send({ type: 'result', id: record.id, current: i + 1, total: records.length, value: caption })
            } else {
              const tags = cleanTags(result)
              if (!preview) await prisma.generatedImage.update({ where: { id: record.id }, data: { adminTags: tags } })
              send({ type: 'result', id: record.id, current: i + 1, total: records.length, value: tags.join(', '), tags })
            }

          } else {
            // ── Advanced mode ──────────────────────────────────────────────────
            const refUrls   = (record.referenceImageUrls ?? []).slice(0, 3)
            const refImages = (await Promise.all(refUrls.map(url => fetchImageAsBase64Safe(url, 20_000)))).filter(Boolean) as { data: string; mimeType: string }[]

            const instruction = buildAdvancedInstruction(mode, promptSnippet, refImages.length, rating, curatorContext)

            const parts: GeminiPart[] = [
              { inlineData: mainImage },
              ...refImages.map(img => ({ inlineData: img })),
              { text: instruction },
            ]

            // 1000 tokens for captions, 500 for tags
            const tokenLimit = mode === 'caption' ? 1000 : 500
            result = await callGeminiParts(parts, modelId, tokenLimit, 90_000).catch(err => { throw new Error(err.message) })

            if (mode === 'caption') {
              const caption = result.replace(/^["']|["']$/g, '').trim()
              if (!preview) await prisma.generatedImage.update({ where: { id: record.id }, data: { adminCaption: caption } })
              send({ type: 'result', id: record.id, current: i + 1, total: records.length, value: caption })
            } else {
              const tags = cleanTags(result)
              if (!preview) await prisma.generatedImage.update({ where: { id: record.id }, data: { adminTags: tags } })
              send({ type: 'result', id: record.id, current: i + 1, total: records.length, value: tags.join(', '), tags })
            }
          }

          processed++
        } catch (err: any) {
          failed++
          send({ type: 'error', id: record.id, current: i + 1, total: records.length, error: err.message })
        }
      }

      send({ type: 'done', processed, skipped, failed })
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    },
  })
}
