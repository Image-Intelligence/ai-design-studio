import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getUserFromSession } from '@/lib/auth'
import prisma from '@/lib/prisma'
import fs from 'fs'
import path from 'path'

const FALLBACK_ADMIN_EMAILS = ['promptandprotocol@gmail.com', 'dirtysecretai@gmail.com']

async function isAdmin(): Promise<boolean> {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('session')?.value
    if (!token) return false
    const user = await getUserFromSession(token)
    if (!user) return false
    const count = await prisma.adminAccount.count()
    if (count === 0) return FALLBACK_ADMIN_EMAILS.includes(user.email)
    const account = await prisma.adminAccount.findUnique({ where: { email: user.email } })
    return !!(account?.canAccessAdmin)
  } catch { return false }
}

export async function GET(req: Request) {
  if (!await isAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const dir = new URL(req.url).searchParams.get('dir')
  if (!dir) return NextResponse.json({ error: 'dir required' }, { status: 400 })

  let stat: fs.Stats
  try { stat = fs.statSync(dir) } catch {
    return NextResponse.json({ error: 'Directory not found' }, { status: 404 })
  }
  if (!stat.isDirectory()) return NextResponse.json({ error: 'Not a directory' }, { status: 400 })

  const EXTS = new Set(['.safetensors', '.ckpt', '.pt'])
  try {
    const files = fs.readdirSync(dir)
      .filter(f => EXTS.has(path.extname(f).toLowerCase()))
      .sort()
      .map(f => {
        const fpath = path.join(dir, f)
        const sizeGb = fs.statSync(fpath).size / (1024 ** 3)
        return { name: f, path: fpath.replace(/\\/g, '/'), size_gb: Math.round(sizeGb * 100) / 100 }
      })
    return NextResponse.json(files)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
