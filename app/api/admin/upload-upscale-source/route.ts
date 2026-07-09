import { NextRequest, NextResponse } from 'next/server'
import { uploadToR2 } from '@/lib/r2'
import { getUserFromSession } from '@/lib/auth'

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

export async function POST(req: NextRequest) {
  if (!await authOk(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let file: File | null = null
  try {
    const form = await req.formData()
    file = form.get('file') as File | null
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  const buf = Buffer.from(await file.arrayBuffer())
  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
  const key = `upscale-sources/${Date.now()}.${ext}`
  const publicUrl = await uploadToR2(key, buf, file.type || 'image/jpeg')

  return NextResponse.json({ publicUrl })
}
