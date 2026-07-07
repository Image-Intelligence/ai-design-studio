import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { cookies } from 'next/headers'
import { getUserFromSession } from '@/lib/auth'


export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { code } = body
    
    console.log('Validating discount code:', code)
    
    if (!code) {
      return NextResponse.json({ valid: false, error: 'Code required' })
    }
    
    // Get user session - FIXED: Use correct cookie name
    const cookieStore = await cookies()
    const token = cookieStore.get('session')?.value
    
    if (!token) {
      return NextResponse.json({ valid: false, error: 'Not authenticated' }, { status: 401 })
    }
    
    const user = await getUserFromSession(token)
    if (!user) {
      return NextResponse.json({ valid: false, error: 'Invalid session' }, { status: 401 })
    }
    
    console.log('User authenticated:', user.id)
    
    // Find discount code
    const discount = await prisma.discountCode.findUnique({
      where: { code: code.toUpperCase() },
      include: {
        usedBy: {
          where: { userId: user.id }
        }
      }
    })
    
    if (!discount) {
      console.log('Discount code not found:', code)
      return NextResponse.json({ valid: false, error: 'Invalid code' })
    }
    
    console.log('Discount found:', discount.code, 'Type:', discount.type, 'Value:', discount.value)
    
    // Check if active
    if (!discount.isActive) {
      console.log('Discount is inactive')
      return NextResponse.json({ valid: false, error: 'Code is no longer active' })
    }
    
    // Check if expired
    if (discount.expiresAt && new Date() > discount.expiresAt) {
      console.log('Discount has expired')
      return NextResponse.json({ valid: false, error: 'Code has expired' })
    }
    
    // Check if already used by this user
    if (discount.usedBy.length > 0) {
      console.log('User has already used this code')
      return NextResponse.json({ valid: false, error: 'You have already used this code' })
    }
    
    // Check usage limit
    if (discount.usageLimit !== null && discount.timesUsed >= discount.usageLimit) {
      console.log('Usage limit reached')
      return NextResponse.json({ valid: false, error: 'Code has reached usage limit' })
    }
    
    console.log('Discount code is valid!')
    
    // Return discount info (don't calculate amount here, just return the discount details)
    return NextResponse.json({
      valid: true,
      discount: {
        code: discount.code,
        type: discount.type,
        value: discount.value
      }
    })
    
  } catch (error: any) {
    console.error('Discount validation error:', error)
    console.error('Error stack:', error.stack)
    return NextResponse.json(
      { valid: false, error: 'Validation failed: ' + error.message },
      { status: 500 }
    )
  }
}

