import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getUserFromSession } from '@/lib/auth'
import { cookies } from 'next/headers'


const PAYPAL_API_BASE = process.env.NODE_ENV === 'production'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com'

async function getPayPalAccessToken() {
  const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error('PayPal credentials not configured')
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  const response = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })

  const data = await response.json()
  return data.access_token
}

export async function POST(request: Request) {
  try {
    console.log('=== TICKET PURCHASE CAPTURE STARTED ===')

    // Check authentication
    const cookieStore = await cookies()
    const token = cookieStore.get('session')?.value

    if (!token) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      )
    }

    const user = await getUserFromSession(token)
    if (!user) {
      return NextResponse.json(
        { error: 'Invalid session' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { orderId, discountCode } = body

    if (!orderId) {
      return NextResponse.json(
        { error: 'Missing orderId' },
        { status: 400 }
      )
    }

    console.log('Capturing payment for order:', orderId)
    if (discountCode) {
      console.log('Discount code used:', discountCode)
    }

    // Get PayPal access token
    const accessToken = await getPayPalAccessToken()

    // Capture the payment
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
          details: captureData.message || captureData.error || 'Unknown error'
        },
        { status: 500 }
      )
    }

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
    const captureId = capture.id // PayPal capture/transaction ID
    const payerId = captureData.payer.payer_id
    const description = captureData.purchase_units[0].description || ''
    const referenceId = captureData.purchase_units[0].reference_id || ''

    // Extract detailed payer information
    const payerEmail = captureData.payer.email_address || null
    const payerName = captureData.payer.name
      ? `${captureData.payer.name.given_name || ''} ${captureData.payer.name.surname || ''}`.trim()
      : null

    // Extract PayPal fees and net amount
    const paypalFee = capture.seller_receivable_breakdown?.paypal_fee?.value
      ? parseFloat(capture.seller_receivable_breakdown.paypal_fee.value)
      : null
    const netAmount = capture.seller_receivable_breakdown?.net_amount?.value
      ? parseFloat(capture.seller_receivable_breakdown.net_amount.value)
      : null

    // Extract billing address
    const billingAddress = captureData.payer.address || captureData.purchase_units[0].shipping?.address || null

    console.log('=== PAYMENT DETAILS ===')
    console.log('Description:', description)
    console.log('Reference ID:', referenceId)
    console.log('Capture ID:', captureId)
    console.log('Amount:', amount)
    console.log('PayPal Fee:', paypalFee)
    console.log('Net Amount:', netAmount)
    console.log('Payer Email:', payerEmail)
    console.log('Payer Name:', payerName)
    console.log('Billing Address:', billingAddress)

    // BEST: Extract ticket count from reference_id (TICKETS_50)
    let ticketsCount = 0

    if (referenceId && referenceId.startsWith('TICKETS_')) {
      const count = parseInt(referenceId.replace('TICKETS_', ''))
      if (!isNaN(count) && count > 0) {
        ticketsCount = count
        console.log(`✓ Got ticket count from reference_id: ${ticketsCount}`)
      }
    }

    // FALLBACK 1: Try to extract from description
    if (ticketsCount === 0) {
      const patterns = [
        /^(\d+)\s+AI Generation Ticket/i,
        /^(\d+)\s+ticket/i,
        /(\d+).*ticket/i,
      ]

      for (const pattern of patterns) {
        const match = description.match(pattern)
        if (match) {
          ticketsCount = parseInt(match[1])
          console.log(`✓ Got ticket count from description: ${ticketsCount}`)
          break
        }
      }
    }

    // FALLBACK 2: Determine from amount (accounting for discounts)
    if (ticketsCount === 0 && amount) {
      // Check against base prices (before discount)
      // With discounts, we need to be more flexible
      if (amount >= 55) {
        ticketsCount = 50  // Could be $79.99 with discount
      } else if (amount >= 27) {
        ticketsCount = 25  // Could be $40 with discount
      } else if (amount >= 13) {
        ticketsCount = 10  // Could be $20 with discount
      } else if (amount >= 6) {
        ticketsCount = 5   // Could be $10 with discount
      } else if (amount >= 2.50) {
        ticketsCount = 2   // Could be $3.99 with discount
      } else {
        ticketsCount = 1   // Could be $2.99 with discount
      }
      console.log(`⚠ Using fallback: ${ticketsCount} tickets based on amount $${amount}`)
    }

    // Safety check
    if (ticketsCount === 0) {
      console.error('Could not determine ticket count!')
      ticketsCount = 1 // Default to 1 to avoid total failure
    }

    console.log('FINAL ticket count:', ticketsCount)

    // Create ticket purchase record with complete details
    console.log('Creating ticket purchase record...')
    const purchase = await prisma.ticketPurchase.create({
      data: {
        userId: user.id,
        ticketsCount,
        amount,
        paypalOrderId: orderId,
        paypalCaptureId: captureId,
        paypalPayerId: payerId,
        payerEmail,
        payerName,
        paymentStatus: 'completed',
        paypalFee,
        netAmount,
        currency: 'USD',
        billingAddress,
        description,
        discountCodeUsed: discountCode || null,
        // Note: originalAmount and discountAmount would need to be passed from frontend
      }
    })
    console.log('Ticket purchase record created:', purchase.id)

    // IMPORTANT: Also create general purchase record for history display
    await prisma.purchase.create({
      data: {
        userId: user.id,
        itemType: 'tickets',
        itemId: purchase.id,
        amount,
        currency: 'USD',
        paypalOrderId: orderId,
        paypalCaptureId: captureId,
        paypalPayerId: payerId,
        payerEmail,
        payerName,
        paymentStatus: 'completed',
        paypalFee,
        netAmount,
        billingAddress,
        description,
        discountCodeUsed: discountCode || null,
      }
    })
    console.log('Purchase history record created')

    // Update user's ticket balance
    console.log('Updating ticket balance...')
    const ticketRecord = await prisma.ticket.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        balance: ticketsCount,
        totalBought: ticketsCount,
        totalUsed: 0,
      },
      update: {
        balance: { increment: ticketsCount },
        totalBought: { increment: ticketsCount },
      },
    })
    console.log('Ticket balance updated:', ticketRecord.balance)

    // NEW: Record discount code usage if applicable
    if (discountCode) {
      try {
        console.log('Recording discount code usage for:', discountCode)
        
        const discount = await prisma.discountCode.findUnique({
          where: { code: discountCode }
        })
        
        if (discount) {
          await prisma.discountUsage.create({
            data: {
              userId: user.id,
              discountCodeId: discount.id
            }
          })
          
          await prisma.discountCode.update({
            where: { id: discount.id },
            data: { timesUsed: { increment: 1 } }
          })
          
          console.log('Discount code usage recorded successfully')
        } else {
          console.warn('Discount code not found in database:', discountCode)
        }
      } catch (discountError: any) {
        console.error('Failed to record discount usage:', discountError)
      }
    }

    console.log('=== TICKET PURCHASE COMPLETED SUCCESSFULLY ===')

    return NextResponse.json({
      success: true,
      purchaseId: purchase.id,
      ticketsAdded: ticketsCount,
      newBalance: ticketRecord.balance,
      message: `Successfully added ${ticketsCount} ticket${ticketsCount > 1 ? 's' : ''} to your account!`,
    })

  } catch (error: any) {
    console.error('=== TICKET PURCHASE CAPTURE ERROR ===')
    console.error('Error:', error)
    console.error('Stack:', error.stack)

    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error.message
      },
      { status: 500 }
    )
  }
}



