// API route: /api/admin/rate-limits
// Fetches current rate limit usage from database

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { AI_MODELS } from '@/config/ai-models.config'


export async function GET(request: NextRequest) {
  try {
    // Verify admin password
    const password = request.nextUrl.searchParams.get('password')
    if (password !== process.env.ADMIN_PASSWORD) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get today's date range
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    // Query database for today's usage grouped by model
    const usageToday = await prisma.generatedImage.groupBy({
      by: ['model'],
      where: {
        createdAt: {
          gte: today,
          lt: tomorrow
        }
      },
      _count: {
        id: true
      }
    })

    // Create usage map for easy lookup
    const usageMap = new Map(
      usageToday.map(item => [item.model, item._count.id])
    )

    // Define model limits (from ai-models.config.ts)
    const models = AI_MODELS.map(model => ({
      id: model.id,
      name: model.displayName,
      limits: { 
        rpm: model.rateLimit.rpm, 
        rpd: model.rateLimit.rpd 
      },
      ticketCost: model.ticketCost
    }))

    // Merge usage data with model limits
    const modelsWithUsage = models.map(model => ({
      ...model,
      usage: {
        rpm: 0, // We don't track per-minute from DB
        rpd: usageMap.get(model.id) || 0
      }
    }))

    return NextResponse.json({
      models: modelsWithUsage,
      message: 'Usage data from your database. For official Google rate limits, check https://aistudio.google.com/usage',
      lastUpdated: new Date().toISOString()
    })

  } catch (error) {
    console.error('Rate limits fetch error:', error)
    return NextResponse.json({ 
      error: 'Failed to fetch rate limits',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
