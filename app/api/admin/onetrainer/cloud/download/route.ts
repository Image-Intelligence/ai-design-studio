import { NextResponse } from 'next/server'
import { presignGetUrl } from '@/lib/r2'

function checkAuth(req: Request) {
  const pass = process.env.ADMIN_PASSWORD
  if (!pass) return true
  return req.headers.get('x-admin-password') === pass
}

// GET /api/admin/onetrainer/cloud/download?key=training/loras/foo.safetensors
// Returns a 1-hour presigned download URL for any R2 key under training/
export async function GET(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const key = searchParams.get('key')

  if (!key) return NextResponse.json({ error: 'Missing key' }, { status: 400 })
  if (!key.startsWith('training/') && !key.startsWith('inference/')) {
    return NextResponse.json({ error: 'Key must be under training/ or inference/' }, { status: 400 })
  }

  try {
    const url = await presignGetUrl(key, 3600)
    return NextResponse.json({ url })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
