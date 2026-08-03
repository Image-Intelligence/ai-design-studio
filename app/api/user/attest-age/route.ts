import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { getUserFromSession } from '@/lib/auth'

// CCBill compliance: records the 18+ certification for accounts created before
// the signup checkbox was persisted. Called by the one-time portal modal.
export async function POST() {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('session')?.value
    const user = token ? await getUserFromSession(token) : null

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!user.ageAttestedAt) {
      await prisma.user.update({
        where: { id: user.id },
        data: { ageAttestedAt: new Date() },
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Age attestation error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
