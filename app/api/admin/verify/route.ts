import { NextResponse } from "next/server"
import prisma from '@/lib/prisma'
import { cookies } from "next/headers"
import { getUserFromSession } from "@/lib/auth"


// Fallback list used only if the AdminAccount table is empty (initial setup)
const FALLBACK_ADMIN_EMAILS = ["promptandprotocol@gmail.com", "dirtysecretai@gmail.com"]

async function checkIsAdmin(email: string): Promise<boolean> {
  try {
    const count = await prisma.adminAccount.count()
    if (count === 0) return FALLBACK_ADMIN_EMAILS.includes(email)
    const account = await prisma.adminAccount.findUnique({ where: { email } })
    return !!(account?.canAccessAdmin)
  } catch {
    return FALLBACK_ADMIN_EMAILS.includes(email)
  }
}

async function checkIsAuditAccount(email: string): Promise<boolean> {
  try {
    const account = await prisma.auditAccount.findUnique({ where: { internalEmail: email.toLowerCase() } })
    return !!account
  } catch { return false }
}

export async function GET() {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('session')?.value
    if (!token) return NextResponse.json({ email: null, isAdmin: false, isAuditAccount: false })

    const user = await getUserFromSession(token)
    if (!user) return NextResponse.json({ email: null, isAdmin: false, isAuditAccount: false })

    const [isAdmin, isAuditAccount] = await Promise.all([
      checkIsAdmin(user.email),
      checkIsAuditAccount(user.email),
    ])
    return NextResponse.json({ email: user.email, isAdmin, isAuditAccount })
  } catch {
    return NextResponse.json({ email: null, isAdmin: false, isAuditAccount: false })
  }
}

export async function POST(request: Request) {
  try {
    const { password } = await request.json()

    if (password !== process.env.ADMIN_PASSWORD) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 })
    }

    const cookieStore = await cookies()
    const token = cookieStore.get('session')?.value
    if (!token) {
      return NextResponse.json({ error: "You must be signed in with an admin account to access this page." }, { status: 403 })
    }

    const user = await getUserFromSession(token)
    if (!user) {
      return NextResponse.json({ error: "You must be signed in with an admin account to access this page." }, { status: 403 })
    }

    const isAdmin = await checkIsAdmin(user.email)
    if (!isAdmin) {
      return NextResponse.json({ error: "This account is not authorized for admin access." }, { status: 403 })
    }

    return NextResponse.json({ success: true, email: user.email })
  } catch {
    return NextResponse.json({ error: "Verification failed" }, { status: 500 })
  }
}