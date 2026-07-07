import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'


function checkAuth(req: Request) {
  const pass = process.env.ADMIN_PASSWORD
  if (!pass) return true
  return req.headers.get('x-admin-password') === pass
}

// GET - Fetch notifications
// ?all=true          → all (admin view)
// ?target=main       → main page notifications (target = 'main' or 'all')
// ?target=portal     → portal v2 notifications (target = 'portal' or 'all')
// (no target param)  → backwards compat: main page notifications
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const showAll = searchParams.get('all') === 'true'
    const target = searchParams.get('target')

    if (showAll) {
      if (!checkAuth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      const notifications = await prisma.$queryRaw<any[]>`
        SELECT * FROM "Notification" ORDER BY "createdAt" DESC
      `
      return NextResponse.json(notifications)
    }

    // Filter by target: treat missing target column (old rows) as 'main'
    if (target === 'portal') {
      const notifications = await prisma.$queryRaw<any[]>`
        SELECT * FROM "Notification"
        WHERE "isActive" = true
          AND (target = 'portal' OR target = 'all')
        ORDER BY "createdAt" DESC
      `
      return NextResponse.json(notifications)
    }

    // Default: main page
    const notifications = await prisma.$queryRaw<any[]>`
      SELECT * FROM "Notification"
      WHERE "isActive" = true
        AND (target = 'main' OR target = 'all')
      ORDER BY "createdAt" DESC
    `
    return NextResponse.json(notifications)
  } catch (error) {
    console.error('Error fetching notifications:', error)
    return NextResponse.json({ error: 'Failed to fetch notifications' }, { status: 500 })
  }
}

// POST - Create new notification (admin only)
export async function POST(request: Request) {
  if (!checkAuth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const body = await request.json()
    const { message, type = 'info', target = 'main', isActive = true, locked = false } = body

    if (!message || message.trim().length === 0) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 })
    }

    const result = await prisma.$queryRaw<any[]>`
      INSERT INTO "Notification" (message, type, target, "isActive", locked, "createdAt", "updatedAt")
      VALUES (${message.trim()}, ${type}, ${target}, ${isActive}, ${locked}, NOW(), NOW())
      RETURNING *
    `
    const notification = result[0]
    console.log('Notification created:', notification)
    return NextResponse.json(notification)
  } catch (error) {
    console.error('Error creating notification:', error)
    return NextResponse.json({ error: 'Failed to create notification' }, { status: 500 })
  }
}

// PUT - Update notification (admin only)
export async function PUT(request: Request) {
  if (!checkAuth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const body = await request.json()
    const { id, message, type, target, isActive, locked } = body

    if (!id) {
      return NextResponse.json({ error: 'Notification ID is required' }, { status: 400 })
    }

    // Build SET clauses dynamically
    // Use raw SQL to safely handle the target column regardless of client version.
    const setParts: string[] = []
    const values: any[] = []

    if (message !== undefined) { setParts.push(`message = $${setParts.length + 1}`); values.push(message.trim()) }
    if (type !== undefined)    { setParts.push(`type = $${setParts.length + 1}`);    values.push(type) }
    if (target !== undefined)  { setParts.push(`target = $${setParts.length + 1}`);  values.push(target) }
    if (isActive !== undefined){ setParts.push(`"isActive" = $${setParts.length + 1}`); values.push(isActive) }
    if (locked !== undefined)  { setParts.push(`locked = $${setParts.length + 1}`);  values.push(locked) }
    setParts.push(`"updatedAt" = NOW()`)

    if (values.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    values.push(id)
    const sql = `UPDATE "Notification" SET ${setParts.join(', ')} WHERE id = $${values.length} RETURNING *`

    const result = await prisma.$queryRawUnsafe<any[]>(sql, ...values)
    const notification = result[0]
    console.log('Notification updated:', notification)
    return NextResponse.json(notification)
  } catch (error) {
    console.error('Error updating notification:', error)
    return NextResponse.json({ error: 'Failed to update notification' }, { status: 500 })
  }
}

// DELETE - Delete notification (admin only)
export async function DELETE(request: Request) {
  if (!checkAuth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Notification ID is required' }, { status: 400 })
    }

    await prisma.$executeRaw`DELETE FROM "Notification" WHERE id = ${parseInt(id)}`
    console.log('Notification deleted:', id)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting notification:', error)
    return NextResponse.json({ error: 'Failed to delete notification' }, { status: 500 })
  }
}
