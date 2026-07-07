import { NextResponse } from "next/server"
import prisma from '@/lib/prisma'


const DEFAULT_ADMINS = ["promptandprotocol@gmail.com", "dirtysecretai@gmail.com"]

function verifyPassword(request: Request): boolean {
  const pw = request.headers.get("x-admin-password")
  return !!pw && pw === process.env.ADMIN_PASSWORD
}

// Seed default admins if table is empty
async function maybeSeeedDefaults() {
  const count = await prisma.adminAccount.count()
  if (count === 0) {
    await prisma.adminAccount.createMany({
      data: DEFAULT_ADMINS.map((email) => ({ email, canAccessAdmin: true })),
      skipDuplicates: true,
    })
  }
}

// GET — list all admin accounts
export async function GET(request: Request) {
  if (!verifyPassword(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    await maybeSeeedDefaults()
    const accounts = await prisma.adminAccount.findMany({ orderBy: { addedAt: "asc" } })
    return NextResponse.json(accounts)
  } catch (error) {
    console.error("GET /api/admin/accounts error:", error)
    return NextResponse.json({ error: "Failed to fetch admin accounts" }, { status: 500 })
  }
}

// POST — add a new admin account
export async function POST(request: Request) {
  if (!verifyPassword(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const { email, canAccessAdmin, concurrencyLimit, notes } = await request.json()
    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "Email is required" }, { status: 400 })
    }

    const account = await prisma.adminAccount.create({
      data: {
        email: email.toLowerCase().trim(),
        canAccessAdmin: canAccessAdmin ?? true,
        concurrencyLimit: concurrencyLimit ?? null,
        notes: notes ?? null,
      },
    })
    return NextResponse.json(account)
  } catch (error: any) {
    if (error?.code === "P2002") {
      return NextResponse.json({ error: "That email is already an admin account" }, { status: 409 })
    }
    console.error("POST /api/admin/accounts error:", error)
    return NextResponse.json({ error: "Failed to add admin account" }, { status: 500 })
  }
}

// PUT — update permissions for an existing admin account
export async function PUT(request: Request) {
  if (!verifyPassword(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const { id, canAccessAdmin, concurrencyLimit, notes } = await request.json()
    if (!id) return NextResponse.json({ error: "ID is required" }, { status: 400 })

    const account = await prisma.adminAccount.update({
      where: { id },
      data: {
        ...(canAccessAdmin !== undefined && { canAccessAdmin }),
        ...(concurrencyLimit !== undefined && {
          concurrencyLimit: concurrencyLimit === "" || concurrencyLimit === null ? null : Number(concurrencyLimit) || null,
        }),
        ...(notes !== undefined && { notes: notes || null }),
      },
    })
    return NextResponse.json(account)
  } catch (error) {
    console.error("PUT /api/admin/accounts error:", error)
    return NextResponse.json({ error: "Failed to update admin account" }, { status: 500 })
  }
}

// DELETE — remove an admin account
export async function DELETE(request: Request) {
  if (!verifyPassword(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const { searchParams } = new URL(request.url)
    const id = parseInt(searchParams.get("id") || "")
    if (!id) return NextResponse.json({ error: "ID is required" }, { status: 400 })

    await prisma.adminAccount.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("DELETE /api/admin/accounts error:", error)
    return NextResponse.json({ error: "Failed to delete admin account" }, { status: 500 })
  }
}
