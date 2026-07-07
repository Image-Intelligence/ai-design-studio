import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'


// GET - Fetch current admin configuration
export async function GET() {
  try {
    const config = await prisma.systemState.findFirst()

    if (!config) {
      // Create default config if none exists with all default values
      const newConfig = await prisma.systemState.create({
        data: {}
      })
      return NextResponse.json(newConfig)
    }

    return NextResponse.json(config)
  } catch (error) {
    console.error('Error fetching config:', error)
    return NextResponse.json(
      { error: 'Failed to fetch config' },
      { status: 500 }
    )
  }
}

// POST - Update admin configuration
export async function POST(request: Request) {
  try {
    const body = await request.json()

    // Find or create the system state
    let config = await prisma.systemState.findFirst()

    // Remove id, createdAt, updatedAt fields from body before updating
    const { id, createdAt, updatedAt, ...updateData } = body

    if (!config) {
      // Create if doesn't exist
      config = await prisma.systemState.create({
        data: updateData
      })
    } else {
      // Update existing - dynamically update all fields from body
      config = await prisma.systemState.update({
        where: { id: config.id },
        data: updateData
      })
    }

    console.log('Config updated:', config)
    return NextResponse.json(config)
  } catch (error) {
    console.error('Error updating config:', error)
    return NextResponse.json(
      { error: 'Failed to update config' },
      { status: 500 }
    )
  }
}
