import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'


const PAYPAL_API_BASE = process.env.NODE_ENV === 'production'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com'

async function getPayPalAccessToken() {
  const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET

  console.log('PayPal Config Check:', {
    hasClientId: !!clientId,
    hasSecret: !!clientSecret,
    clientIdPrefix: clientId?.substring(0, 10),
    apiBase: PAYPAL_API_BASE
  })

  if (!clientId || !clientSecret) {
    throw new Error('PayPal credentials not configured. Check .env.local file.')
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  console.log('Requesting PayPal access token...')

  const response = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })

  if (!response.ok) {
    const error = await response.text()
    console.error('PayPal auth failed:', error)
    throw new Error(`PayPal authentication failed: ${error}`)
  }

  const data = await response.json()
  console.log('PayPal access token obtained successfully')
  return data.access_token
}

export async function POST(request: Request) {
  try {
    console.log('=== PAYPAL CAPTURE PAYMENT STARTED ===')
    
    const body = await request.json()
    const { orderId, galleryId, userEmail } = body

    console.log('Request data:', { orderId, galleryId, userEmail })

    if (!orderId || !galleryId) {
      console.error('Missing required fields:', { orderId, galleryId })
      return NextResponse.json(
        { error: 'Missing required fields: orderId and galleryId are required' },
        { status: 400 }
      )
    }

    // Get PayPal access token
    console.log('Getting PayPal access token...')
    const accessToken = await getPayPalAccessToken()

    // Capture the payment
    console.log('Capturing payment for order:', orderId)
    const captureResponse = await fetch(
      `${PAYPAL_API_BASE}/v2/checkout/orders/${orderId}/capture`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
      }
    )

    const captureData = await captureResponse.json()
    console.log('PayPal capture response:', JSON.stringify(captureData, null, 2))

    if (!captureResponse.ok) {
      console.error('PayPal capture failed:', captureData)
      return NextResponse.json(
        { 
          error: 'Payment capture failed', 
          details: captureData.message || captureData.error || 'Unknown error',
          debug: captureData
        },
        { status: 500 }
      )
    }

    console.log('Payment captured successfully!')

    // Extract payment details
    const capture = captureData.purchase_units?.[0]?.payments?.captures?.[0]
    if (!capture) {
      console.error('No capture data in response:', captureData)
      return NextResponse.json(
        { error: 'Invalid payment response from PayPal' },
        { status: 500 }
      )
    }

    const amount = parseFloat(capture.amount.value)
    const payerId = captureData.payer.payer_id
    const payerEmail = captureData.payer.email_address || userEmail || 'unknown@example.com'

    console.log('Payment details:', { amount, payerId, payerEmail })

    // Create or get user
    console.log('Finding or creating user...')
    let user = await prisma.user.findUnique({
      where: { email: payerEmail }
    })

    if (!user) {
      console.log('Creating new user...')
      user = await prisma.user.create({
        data: {
          email: payerEmail,
          name: captureData.payer.name?.given_name || 'Anonymous',
        }
      })
      console.log('User created:', user.id)
    } else {
      console.log('User found:', user.id)
    }

    // Create purchase record
    console.log('Creating purchase record...')
    const purchase = await prisma.purchase.create({
      data: {
        userId: user.id,
        itemType: 'gallery',
        itemId: parseInt(galleryId),
        amount: amount,
        currency: 'USD',
        paypalOrderId: orderId,
        paypalPayerId: payerId,
        paymentStatus: 'completed',
      }
    })
    console.log('Purchase record created:', purchase.id)

    // Check if access already exists
    const existingAccess = await prisma.galleryAccess.findUnique({
      where: {
        userId_galleryId: {
          userId: user.id,
          galleryId: parseInt(galleryId)
        }
      }
    })

    if (existingAccess) {
      console.log('User already has access to this gallery')
      return NextResponse.json({
        success: true,
        purchaseId: purchase.id,
        accessGranted: true,
        alreadyHadAccess: true,
        message: 'Payment successful! You already had access to this gallery.',
      })
    }

    // Grant gallery access
    console.log('Granting gallery access...')
    const access = await prisma.galleryAccess.create({
      data: {
        userId: user.id,
        galleryId: parseInt(galleryId),
        expiresAt: null, // Lifetime access
      }
    })
    console.log('Gallery access granted:', access.id)

    console.log('=== PAYPAL CAPTURE COMPLETED SUCCESSFULLY ===')

    return NextResponse.json({
      success: true,
      purchaseId: purchase.id,
      accessId: access.id,
      accessGranted: true,
      message: 'Payment successful! You now have access to this gallery.',
    })

  } catch (error: any) {
    console.error('=== PAYPAL CAPTURE ERROR ===')
    console.error('Error:', error)
    console.error('Stack:', error.stack)
    
    return NextResponse.json(
      { 
        error: 'Internal server error', 
        details: error.message,
        type: error.name
      },
      { status: 500 }
    )
  }
}

