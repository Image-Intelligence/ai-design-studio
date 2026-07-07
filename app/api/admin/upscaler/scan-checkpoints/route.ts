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

export async function GET() {
  if (!await isAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const checkpoints: { name: string; path: string; iter: number; experiment: string; arch: string }[] = []

  // 1. Pre-trained / community models — AI/Real-ESRGAN/weights/*.pth
  const weightsDir = path.join(process.cwd(), 'AI', 'Real-ESRGAN', 'weights')
  try {
    const files = fs.readdirSync(weightsDir)
      .filter(f => f.endsWith('.pth') || f.endsWith('.safetensors'))
      .sort()
    for (const file of files) {
      checkpoints.push({
        name:       file,
        path:       path.join(weightsDir, file).replace(/\\/g, '/'),
        iter:       0,
        experiment: 'pretrained',
        arch:       'esrgan',
      })
    }
  } catch { /* weights dir doesn't exist yet */ }

  // 2. Locally trained ESRGAN checkpoints — AI/Real-ESRGAN/experiments/*/models/net_g_*.pth
  const experimentsDir = path.join(process.cwd(), 'AI', 'Real-ESRGAN', 'experiments')
  try {
    const experiments = fs.readdirSync(experimentsDir).sort()
    for (const exp of experiments) {
      if (exp.includes('archived')) continue
      const modelsDir = path.join(experimentsDir, exp, 'models')
      if (!fs.existsSync(modelsDir)) continue

      const files = fs.readdirSync(modelsDir)
        .filter(f => /^net_g_\d+\.pth$/.test(f))
        .sort((a, b) => {
          const n = (s: string) => parseInt(s.match(/\d+/)?.[0] ?? '0')
          return n(a) - n(b)
        })

      for (const file of files) {
        const iter = parseInt(file.match(/\d+/)?.[0] ?? '0')
        checkpoints.push({
          name:       file,
          path:       path.join(experimentsDir, exp, 'models', file).replace(/\\/g, '/'),
          iter,
          experiment: exp,
          arch:       'esrgan',
        })
      }
    }
  } catch { /* experimentsDir doesn't exist yet */ }

  // 3. neosr locally trained checkpoints — AI/neosr/experiments/*/models/net_g_*.pth
  const neosrExpDir = path.join(process.cwd(), 'AI', 'neosr', 'experiments')
  try {
    const experiments = fs.readdirSync(neosrExpDir).sort()
    for (const exp of experiments) {
      if (exp.includes('archived')) continue
      const modelsDir = path.join(neosrExpDir, exp, 'models')
      if (!fs.existsSync(modelsDir)) continue

      const files = fs.readdirSync(modelsDir)
        .filter(f => /^net_g_\d+\.pth$/.test(f))
        .sort((a, b) => {
          const n = (s: string) => parseInt(s.match(/\d+/)?.[0] ?? '0')
          return n(a) - n(b)
        })

      for (const file of files) {
        const iter = parseInt(file.match(/\d+/)?.[0] ?? '0')
        checkpoints.push({
          name:       file,
          path:       path.join(neosrExpDir, exp, 'models', file).replace(/\\/g, '/'),
          iter,
          experiment: exp,
          arch:       'neosr',
        })
      }
    }
  } catch { /* neosr dir doesn't exist yet */ }

  return NextResponse.json(checkpoints)
}
