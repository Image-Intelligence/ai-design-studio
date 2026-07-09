import path from 'path'
import fs from 'fs'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkAuth } from '@/lib/admin-auth'

const TEMPLATES_PATH = path.join(process.cwd(), 'AI', 'export-templates.json')

// Module-level cancel flag — reset at the start of each POST
let _cancelRequested = false


interface ExportRule {
  id: string
  label: string
  sourceField: string
  outputFolder: string
  filenamePattern: string
  required: boolean
}

interface ExportTemplate {
  id: string
  name: string
  rules: ExportRule[]
}

interface GeneratedImageRow {
  id: number
  imageUrl: string
  referenceImageUrls: string[]
  prompt: string
  adminCaption: string | null
  adminTags: string[]
  model: string
  quality: string | null
  aspectRatio: string | null
  createdAt: Date
  markedForTraining: boolean
}

function readTemplates(): ExportTemplate[] {
  try {
    return JSON.parse(fs.readFileSync(TEMPLATES_PATH, 'utf-8'))
  } catch {
    return []
  }
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50)
}

function resolvePattern(pattern: string, img: GeneratedImageRow, index: number): string {
  return pattern
    .replace(/\{n:(\d+)\}/g, (_, w) => String(index).padStart(parseInt(w), '0'))
    .replace(/\{n\}/g, String(index))
    .replace(/\{id\}/g, String(img.id))
    .replace(/\{prompt\}/g, slugify(img.prompt.slice(0, 40)))
    .replace(/\{model\}/g, slugify(img.model))
    .replace(/\{date\}/g, img.createdAt.toISOString().slice(0, 10))
    .replace(/\{tags\}/g, img.adminTags.join('_') || 'none')
    .replace(/\{aspect\}/g, (img.aspectRatio ?? '').replace(':', 'x') || 'unknown')
}

function resolveSourceField(field: string, img: GeneratedImageRow): { value: string | null; isUrl: boolean } {
  if (field === 'imageUrl')      return { value: img.imageUrl, isUrl: true }
  if (field === 'prompt')        return { value: img.prompt, isUrl: false }
  if (field === 'adminCaption')  return { value: img.adminCaption, isUrl: false }
  if (field === 'adminTags')     return { value: img.adminTags.join(', '), isUrl: false }
  if (field === 'model')         return { value: img.model, isUrl: false }
  if (field === 'quality')       return { value: img.quality, isUrl: false }
  if (field === 'aspectRatio')   return { value: img.aspectRatio, isUrl: false }
  if (field === 'createdAt')     return { value: img.createdAt.toISOString(), isUrl: false }
  if (field === 'id')            return { value: String(img.id), isUrl: false }

  const refMatch = field.match(/^referenceImageUrls\[(\d+)\]$/)
  if (refMatch) {
    const url = img.referenceImageUrls[parseInt(refMatch[1])] ?? null
    return { value: url, isUrl: true }
  }

  return { value: null, isUrl: false }
}

async function downloadUrl(url: string): Promise<{ buf: Buffer | null; reason?: string }> {
  // Handle data URIs (base64-encoded images)
  if (url.startsWith('data:')) {
    const [, b64] = url.split(',', 2)
    if (!b64) return { buf: null, reason: 'malformed data URI' }
    return { buf: Buffer.from(b64, 'base64') }
  }

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
    if (!res.ok) return { buf: null, reason: `HTTP ${res.status}` }
    return { buf: Buffer.from(await res.arrayBuffer()) }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'network error'
    return { buf: null, reason: msg }
  }
}

export async function POST(req: Request) {
  if (!checkAuth(req)) {
    return new Response('Unauthorized', { status: 401 })
  }

  _cancelRequested = false

  const {
    templateId,
    bucketId,
    outputPath: rawOutputPath,
    filters = {},
  } = await req.json() as {
    templateId: string
    bucketId: number
    outputPath: string
    filters?: {
      markedOnly?: boolean
      captionedOnly?: boolean
      refsOnly?: boolean
      excludeBlobRefs?: boolean
      model?: string
    }
  }

  const template = readTemplates().find(t => t.id === templateId)
  if (!template) return new Response('Template not found', { status: 404 })
  if (!rawOutputPath?.trim()) return new Response('Output path required', { status: 400 })

  const outputPath = rawOutputPath.trim()

  const rows = await prisma.datasetBucketImage.findMany({
    where: { bucketId },
    select: {
      image: {
        select: {
          id: true, imageUrl: true, referenceImageUrls: true,
          prompt: true, adminCaption: true, adminTags: true,
          model: true, quality: true, aspectRatio: true,
          createdAt: true, markedForTraining: true, isDeleted: true,
        }
      }
    },
    orderBy: { imageId: 'asc' },
  })

  let images = rows
    .map(r => r.image)
    .filter(img => !img.isDeleted)

  if (filters.markedOnly)      images = images.filter(img => img.markedForTraining)
  if (filters.captionedOnly)  images = images.filter(img => !!img.adminCaption)
  if (filters.refsOnly)       images = images.filter(img => img.referenceImageUrls.length > 0)
  if (filters.excludeBlobRefs) images = images.filter(img =>
    !img.referenceImageUrls.some(url => url.includes('blob.vercel-storage.com'))
  )
  if (filters.model)          images = images.filter(img => img.model === filters.model)

  const { readable, writable } = new TransformStream()
  const writer = writable.getWriter()
  const enc = new TextEncoder()

  const send = async (data: object) => {
    try {
      await writer.write(enc.encode(`data: ${JSON.stringify(data)}\n\n`))
    } catch {}
  }

  ;(async () => {
    try {
      await fs.promises.mkdir(outputPath, { recursive: true })
      await send({ type: 'start', total: images.length })

      let exportedCount = 0
      let skippedCount  = 0

      for (const img of images) {
        if (_cancelRequested) {
          await send({ type: 'cancelled' })
          return
        }

        let skipImage = false
        for (const rule of template.rules) {
          if (!rule.required) continue
          const { value } = resolveSourceField(rule.sourceField, img)
          if (!value) { skipImage = true; break }
        }

        if (skipImage) {
          skippedCount++
          await send({ type: 'skip', id: img.id, reason: 'missing required field' })
          continue
        }

        exportedCount++
        const n = exportedCount

        for (const rule of template.rules) {
          if (_cancelRequested) {
            await send({ type: 'cancelled' })
            return
          }

          const { value, isUrl } = resolveSourceField(rule.sourceField, img)
          if (!value) continue

          const filename = resolvePattern(rule.filenamePattern, img, n)
          const dir = rule.outputFolder
            ? path.join(outputPath, rule.outputFolder)
            : outputPath

          await fs.promises.mkdir(dir, { recursive: true })

          const filePath = path.join(dir, filename)
          const displayPath = rule.outputFolder ? `${rule.outputFolder}/${filename}` : filename

          if (isUrl) {
            const { buf, reason } = await downloadUrl(value)
            if (buf) {
              await fs.promises.writeFile(filePath, buf)
              await send({ type: 'file', path: displayPath })
            } else {
              let urlHint = ''
              try { urlHint = ` [${new URL(value).hostname}]` } catch { urlHint = ` [${value.slice(0, 50)}]` }
              await send({ type: 'warn', path: displayPath, reason: (reason ?? 'download failed') + urlHint })
            }
          } else {
            await fs.promises.writeFile(filePath, value, 'utf-8')
            await send({ type: 'file', path: displayPath })
          }
        }

        await send({ type: 'progress', done: exportedCount, total: images.length })
      }

      await send({ type: 'done', exported: exportedCount, skipped: skippedCount })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      await send({ type: 'error', message: msg })
    } finally {
      await writer.close().catch(() => {})
    }
  })()

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  })
}

// Cancel a running export
export async function DELETE(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  _cancelRequested = true
  return NextResponse.json({ ok: true })
}
