import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { uploadToR2, deleteFromR2 } from '@/lib/r2'

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const password = searchParams.get('password')

    if (password !== ADMIN_PASSWORD) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const carousels = await prisma.carouselImage.findMany({
      orderBy: [{ side: 'asc' }, { position: 'asc' }]
    })

    return NextResponse.json(carousels)
  } catch (error) {
    console.error('Error fetching carousels:', error)
    return NextResponse.json({ error: 'Failed to fetch carousels' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const password = formData.get('password') as string
    const side = formData.get('side') as string
    const position = parseInt(formData.get('position') as string)
    const image = formData.get('image') as File

    if (password !== ADMIN_PASSWORD) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!image || !side) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Upload to R2
    const arrayBuffer = await image.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const url = await uploadToR2(
      `carousel-${side}-${Date.now()}.${image.name.split('.').pop()}`,
      buffer,
      image.type
    )

    // Save to database
    const carousel = await prisma.carouselImage.create({
      data: {
        imageUrl: url,
        side: side,
        position: position || 0,
        isActive: true
      }
    })

    return NextResponse.json(carousel)
  } catch (error) {
    console.error('Error uploading carousel image:', error)
    return NextResponse.json({ error: 'Failed to upload image' }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const { password, id, side, position, isActive } = await request.json()

    if (password !== ADMIN_PASSWORD) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const carousel = await prisma.carouselImage.update({
      where: { id },
      data: {
        ...(side !== undefined && { side }),
        ...(position !== undefined && { position }),
        ...(isActive !== undefined && { isActive })
      }
    })

    return NextResponse.json(carousel)
  } catch (error) {
    console.error('Error updating carousel:', error)
    return NextResponse.json({ error: 'Failed to update carousel' }, { status: 500 })
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

    // Get carousel to delete blob
    const carousel = await prisma.carouselImage.findUnique({
      where: { id }
    })

    if (!carousel) {
      return NextResponse.json({ error: 'Carousel not found' }, { status: 404 })
    }

    // Try to delete blob (may not exist)
    try {
      await deleteFromR2(carousel.imageUrl)
    } catch (err) {
      console.log('Could not delete blob (might not exist):', err)
    }

    // Delete from database
    await prisma.carouselImage.delete({
      where: { id }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting carousel:', error)
    return NextResponse.json({ error: 'Failed to delete carousel' }, { status: 500 })
  }
}



