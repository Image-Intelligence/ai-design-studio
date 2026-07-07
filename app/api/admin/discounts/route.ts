import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const password = searchParams.get('password')

    if (password !== ADMIN_PASSWORD) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const discounts = await prisma.discountCode.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { usedBy: true }
        }
      }
    })

    return NextResponse.json(discounts)
  } catch (error) {
    console.error('Error fetching discounts:', error)
    return NextResponse.json({ error: 'Failed to fetch discounts' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { password, code, type, value, usageLimit, expiresAt } = await request.json()

    if (password !== ADMIN_PASSWORD) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!code || !type || value === undefined) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Check if code already exists
    const existing = await prisma.discountCode.findUnique({
      where: { code: code.toUpperCase() }
    })

    if (existing) {
      return NextResponse.json({ error: 'Code already exists' }, { status: 400 })
    }

    const discount = await prisma.discountCode.create({
      data: {
        code: code.toUpperCase(),
        type,
        value: parseFloat(value),
        usageLimit: usageLimit ? parseInt(usageLimit) : null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        isActive: true
      }
    })

    return NextResponse.json(discount)
  } catch (error) {
    console.error('Error creating discount:', error)
    return NextResponse.json({ error: 'Failed to create discount' }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const { password, id, isActive } = await request.json()

    if (password !== ADMIN_PASSWORD) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const discount = await prisma.discountCode.update({
      where: { id },
      data: { isActive }
    })

    return NextResponse.json(discount)
  } catch (error) {
    console.error('Error updating discount:', error)
    return NextResponse.json({ error: 'Failed to update discount' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const password = searchParams.get('password')
    const id = parseInt(searchParams.get('id') || '0')

    if (password !== ADMIN_PASSWORD) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    await prisma.discountCode.delete({
      where: { id }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting discount:', error)
    return NextResponse.json({ error: 'Failed to delete discount' }, { status: 500 })
  }
}
