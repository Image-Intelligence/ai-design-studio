import { NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs'
import { checkAuth } from '@/lib/admin-auth'


export async function GET(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Committed copy of OneTrainer training presets (works on Vercel and locally)
  const presetsDir = path.join(process.cwd(), 'data', 'training-presets')

  if (!fs.existsSync(presetsDir)) {
    return NextResponse.json([])
  }

  try {
    const files = fs.readdirSync(presetsDir).filter(f => f.endsWith('.json')).sort()
    const presets = files
      .map(fname => {
        try {
          const config = JSON.parse(fs.readFileSync(path.join(presetsDir, fname), 'utf-8'))
          return { filename: fname, name: fname.replace(/\.json$/, ''), config }
        } catch {
          return null
        }
      })
      .filter(Boolean)
    return NextResponse.json(presets)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
