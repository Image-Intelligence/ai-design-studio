import { NextResponse } from 'next/server'
import { readdirSync } from 'fs'
import path from 'path'
import { checkAuth } from '@/lib/admin-auth'


function guessArch(name: string): string {
  const n = name.toLowerCase()
  if (n.includes('clearreality') || n.includes('span')) return 'SPAN'
  if (n.includes('dat'))                                  return 'DAT'
  if (n.includes('swinir') || n.includes('hat') || n.includes('drct')) return 'Transformer'
  return 'RRDBNet'
}

function guessScale(name: string): number {
  const m = name.match(/^(\d)x/i)
  return m ? parseInt(m[1]) : 4
}

export async function GET(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const weightsDir = path.join(process.cwd(), 'AI', 'Real-ESRGAN', 'weights')
  try {
    const files = readdirSync(weightsDir)
      .filter(f => f.endsWith('.pth'))
      .map(name => ({
        name,
        path: path.join(weightsDir, name).replace(/\\/g, '/'),
        arch:  guessArch(name),
        scale: guessScale(name),
      }))
    return NextResponse.json(files)
  } catch {
    return NextResponse.json([])
  }
}
