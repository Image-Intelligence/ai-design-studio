import { NextResponse } from 'next/server'
import { presignGetUrl } from '@/lib/r2'
import { checkAuth } from '@/lib/admin-auth'

const PUBLIC_URL = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '')


// GET /api/admin/onetrainer/cloud/download?key=training/loras/foo.safetensors
// Returns a public URL (preferred) or 1-hour presigned URL for any R2 key under training/ or inference/
export async function GET(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const key = searchParams.get('key')

  if (!key) return NextResponse.json({ error: 'Missing key' }, { status: 400 })
  if (!key.startsWith('training/') && !key.startsWith('inference/')) {
    return NextResponse.json({ error: 'Key must be under training/ or inference/' }, { status: 400 })
  }

  // Prefer the permanent public URL so returned URLs never expire
  if (PUBLIC_URL) {
    return NextResponse.json({ url: `${PUBLIC_URL}/${key}` })
  }

  try {
    const url = await presignGetUrl(key, 3600)
    return NextResponse.json({ url })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
