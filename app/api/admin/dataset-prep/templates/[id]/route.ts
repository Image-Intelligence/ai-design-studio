import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { checkAuth } from '@/lib/admin-auth'

const TEMPLATES_PATH = path.join(process.cwd(), 'AI', 'export-templates.json')


function readTemplates(): Record<string, unknown>[] {
  try {
    return JSON.parse(fs.readFileSync(TEMPLATES_PATH, 'utf-8'))
  } catch {
    return []
  }
}

function writeTemplates(templates: unknown[]) {
  fs.mkdirSync(path.dirname(TEMPLATES_PATH), { recursive: true })
  fs.writeFileSync(TEMPLATES_PATH, JSON.stringify(templates, null, 2))
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const body = await req.json()
  const templates = readTemplates()
  const idx = templates.findIndex(t => t.id === id)
  if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  templates[idx] = { ...templates[idx], ...body, id }
  writeTemplates(templates)
  return NextResponse.json(templates[idx])
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const templates = readTemplates()
  const filtered = templates.filter(t => t.id !== id)
  if (filtered.length === templates.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  writeTemplates(filtered)
  return NextResponse.json({ deleted: true })
}
