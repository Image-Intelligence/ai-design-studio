import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { cookies } from 'next/headers'
import { getUserFromSession, verifyPassword, hashPassword, isValidPassword } from '@/lib/auth'


export async function POST(request: Request) {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('session')?.value
    if (!token) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const user = await getUserFromSession(token)
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const { currentPassword, currentPasswordConfirm, newPassword, newPasswordConfirm } = await request.json()

    if (!currentPassword || !currentPasswordConfirm || !newPassword || !newPasswordConfirm) {
      return NextResponse.json({ error: 'All fields are required' }, { status: 400 })
    }

    if (currentPassword !== currentPasswordConfirm) {
      return NextResponse.json({ error: 'Current passwords do not match' }, { status: 400 })
    }

    if (newPassword !== newPasswordConfirm) {
      return NextResponse.json({ error: 'New passwords do not match' }, { status: 400 })
    }

    if (newPassword === currentPassword) {
      return NextResponse.json({ error: 'New password must be different from current password' }, { status: 400 })
    }

    const passwordCheck = isValidPassword(newPassword)
    if (!passwordCheck.valid) {
      return NextResponse.json({ error: passwordCheck.error }, { status: 400 })
    }

    const isCorrect = await verifyPassword(currentPassword, user.password)
    if (!isCorrect) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 })
    }

    const hashed = await hashPassword(newPassword)
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashed },
    })

    console.log(`[change-password] User ${user.email} changed their password`)

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Change password error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
