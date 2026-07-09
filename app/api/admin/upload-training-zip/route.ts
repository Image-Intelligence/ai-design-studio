import { NextRequest, NextResponse } from 'next/server'
import { presignPutUrl } from '@/lib/r2'

function authOk(req: NextRequest) {
  const pass = process.env.ADMIN_PASSWORD
  // Fail closed: a missing ADMIN_PASSWORD must deny, not allow
  if (!pass) return false
  return req.headers.get('x-admin-password') === pass
}

export async function POST(req: NextRequest) {
  if (!authOk(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let filename: string
  try {
    const body = await req.json() as { filename?: string }
    filename = body.filename?.trim() || 'training.zip'
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const key = `training-zips/${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  const { uploadUrl, publicUrl } = await presignPutUrl(key, 'application/zip', 3600)

  return NextResponse.json({ uploadUrl, publicUrl })
}
