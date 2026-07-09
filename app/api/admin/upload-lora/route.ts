import { NextRequest, NextResponse } from 'next/server'
import { getUserFromSession } from '@/lib/auth'
import { presignPutUrl } from '@/lib/r2'

const ADMIN_EMAILS = new Set(['dirtysecretai@gmail.com', 'promptandprotocol@gmail.com'])

async function authOk(req: NextRequest): Promise<boolean> {
  const pass = process.env.ADMIN_PASSWORD
  // Fail closed: a missing ADMIN_PASSWORD must deny, not allow
  if (!pass) return false
  if (req.headers.get('x-admin-password') === pass) return true
  const token = req.cookies.get('session')?.value
  if (token) {
    const user = await getUserFromSession(token)
    if (user && ADMIN_EMAILS.has(user.email.toLowerCase())) return true
  }
  return false
}

// Returns a presigned R2 PUT URL so the browser can upload large LoRA files
// directly to R2 without going through Vercel's 4.5 MB body limit.
export async function POST(req: NextRequest) {
  if (!await authOk(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { filename } = await req.json() as { filename?: string }
    if (!filename) return NextResponse.json({ error: 'filename required' }, { status: 400 })

    const allowed = ['.safetensors', '.bin', '.pt', '.ckpt']
    const lower = filename.toLowerCase()
    if (!allowed.some(ext => lower.endsWith(ext))) {
      return NextResponse.json({ error: 'Only .safetensors, .bin, .pt, .ckpt files are allowed' }, { status: 400 })
    }

    const key = `loras/${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const { uploadUrl, publicUrl } = await presignPutUrl(key, 'application/octet-stream', 3600)

    return NextResponse.json({ uploadUrl, publicUrl })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[upload-lora] presign error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
