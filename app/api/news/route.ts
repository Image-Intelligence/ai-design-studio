import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkAuth } from '@/lib/admin-auth'


// GET /api/news          → active articles (public)
// GET /api/news?all=true → all articles incl. drafts (admin only)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const all = searchParams.get('all') === 'true'

  try {
    if (all) {
      if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      const articles = await prisma.newsArticle.findMany({
        orderBy: { createdAt: 'desc' },
      })
      return NextResponse.json(articles)
    }

    const articles = await prisma.newsArticle.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        slug: true,
        type: true,
        summary: true,
        previewImage: true,
        createdAt: true,
        publishedAt: true,
      },
    })
    return NextResponse.json(articles)
  } catch (err) {
    console.error('GET /api/news error:', err)
    return NextResponse.json({ error: 'Failed to fetch articles' }, { status: 500 })
  }
}

// POST /api/news → create article (admin only)
export async function POST(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const body = await req.json()
    const { title, slug, type, summary, previewImage, content, isActive } = body

    if (!title || !slug) {
      return NextResponse.json({ error: 'title and slug are required' }, { status: 400 })
    }

    const article = await prisma.newsArticle.create({
      data: {
        title,
        slug,
        type: type || 'update',
        summary: summary || '',
        previewImage: previewImage || null,
        content: content || [],
        isActive: isActive ?? false,
        publishedAt: isActive ? new Date() : null,
      },
    })

    return NextResponse.json(article)
  } catch (err: any) {
    console.error('POST /api/news error:', err)
    if (err.code === 'P2002') {
      return NextResponse.json({ error: 'Slug already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Failed to create article' }, { status: 500 })
  }
}

// PUT /api/news → update article (admin only)
export async function PUT(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const body = await req.json()
    const { id, title, slug, type, summary, previewImage, content, isActive } = body

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: any = { updatedAt: new Date() }
    if (title !== undefined) updateData.title = title
    if (slug !== undefined) updateData.slug = slug
    if (type !== undefined) updateData.type = type
    if (summary !== undefined) updateData.summary = summary
    if (previewImage !== undefined) updateData.previewImage = previewImage || null
    if (content !== undefined) updateData.content = content
    if (isActive !== undefined) {
      updateData.isActive = isActive
      if (isActive) {
        const existing = await prisma.newsArticle.findUnique({ where: { id }, select: { publishedAt: true } })
        if (!existing?.publishedAt) updateData.publishedAt = new Date()
      }
    }

    const article = await prisma.newsArticle.update({ where: { id }, data: updateData })
    return NextResponse.json(article)
  } catch (err: any) {
    console.error('PUT /api/news error:', err)
    if (err.code === 'P2002') {
      return NextResponse.json({ error: 'Slug already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Failed to update article' }, { status: 500 })
  }
}

// DELETE /api/news?id=X → delete article (admin only)
export async function DELETE(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const id = parseInt(searchParams.get('id') || '')

  if (isNaN(id)) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  try {
    await prisma.newsArticle.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('DELETE /api/news error:', err)
    return NextResponse.json({ error: 'Failed to delete article' }, { status: 500 })
  }
}
