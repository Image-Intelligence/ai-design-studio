import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { checkAuth } from '@/lib/admin-auth'
import { jsonPrivate } from '@/lib/api-json'


// GET - Fetch current admin configuration
export async function GET() {
  try {
    const config = await prisma.systemState.findFirst()

    if (!config) {
      // Create default config if none exists with all default values
      const newConfig = await prisma.systemState.create({
        data: {}
      })
      return jsonPrivate(newConfig)
    }

    return jsonPrivate(config)
  } catch (error) {
    console.error('Error fetching config:', error)
    return jsonPrivate(
      { error: 'Failed to fetch config' },
      { status: 500 }
    )
  }
}


// POST - Update admin configuration
// GET stays open (many public pages read maintenance flags), but mutations
// were previously unauthenticated — anyone could flip maintenance/shop state.
export async function POST(request: Request) {
  if (!checkAuth(request)) return jsonPrivate({ error: 'Unauthorized' }, { status: 401 })
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
    return jsonPrivate(config)
  } catch (error) {
    console.error('Error updating config:', error)
    return jsonPrivate(
      { error: 'Failed to update config' },
      { status: 500 }
    )
  }
}
