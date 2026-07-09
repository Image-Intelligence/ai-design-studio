import { NextResponse } from 'next/server'
import { prismaDirectDb } from '@/lib/prisma'
import { checkAuth } from '@/lib/admin-auth'


// ONE-TIME migration route — delete this file after running it once.
export async function POST(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const steps: string[] = []
  try {
    // Rename email → internalEmail if old schema
    await prismaDirectDb.$executeRawUnsafe(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='AuditAccount' AND column_name='email'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='AuditAccount' AND column_name='internalEmail'
        ) THEN
          ALTER TABLE "AuditAccount" RENAME COLUMN "email" TO "internalEmail";
        END IF;
      END $$;
    `)
    steps.push('renamed email → internalEmail (if needed)')

    // Add missing columns as nullable first
    await prismaDirectDb.$executeRawUnsafe(`ALTER TABLE "AuditAccount" ADD COLUMN IF NOT EXISTS "username" TEXT`)
    await prismaDirectDb.$executeRawUnsafe(`ALTER TABLE "AuditAccount" ADD COLUMN IF NOT EXISTS "internalEmail" TEXT`)
    await prismaDirectDb.$executeRawUnsafe(`ALTER TABLE "AuditAccount" ADD COLUMN IF NOT EXISTS "plainPassword" TEXT`)
    await prismaDirectDb.$executeRawUnsafe(`ALTER TABLE "AuditAccount" ADD COLUMN IF NOT EXISTS "userId" INTEGER`)
    await prismaDirectDb.$executeRawUnsafe(`ALTER TABLE "AuditAccount" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`)
    steps.push('added missing columns')

    // Wipe old rows (can't add NOT NULL without valid data)
    await prismaDirectDb.$executeRawUnsafe(`DELETE FROM "AuditAccount"`)
    steps.push('cleared old rows')

    // Drop stale unique constraints
    for (const c of ['AuditAccount_email_key', 'AuditAccount_internalEmail_key', 'AuditAccount_username_key', 'AuditAccount_userId_key']) {
      await prismaDirectDb.$executeRawUnsafe(`ALTER TABLE "AuditAccount" DROP CONSTRAINT IF EXISTS "${c}"`)
    }
    steps.push('dropped old constraints')

    // Set NOT NULL
    await prismaDirectDb.$executeRawUnsafe(`ALTER TABLE "AuditAccount" ALTER COLUMN "username" SET NOT NULL`)
    await prismaDirectDb.$executeRawUnsafe(`ALTER TABLE "AuditAccount" ALTER COLUMN "internalEmail" SET NOT NULL`)
    await prismaDirectDb.$executeRawUnsafe(`ALTER TABLE "AuditAccount" ALTER COLUMN "plainPassword" SET NOT NULL`)
    await prismaDirectDb.$executeRawUnsafe(`ALTER TABLE "AuditAccount" ALTER COLUMN "userId" SET NOT NULL`)
    steps.push('set NOT NULL constraints')

    // Add unique constraints
    await prismaDirectDb.$executeRawUnsafe(`ALTER TABLE "AuditAccount" ADD CONSTRAINT "AuditAccount_username_key" UNIQUE ("username")`)
    await prismaDirectDb.$executeRawUnsafe(`ALTER TABLE "AuditAccount" ADD CONSTRAINT "AuditAccount_internalEmail_key" UNIQUE ("internalEmail")`)
    await prismaDirectDb.$executeRawUnsafe(`ALTER TABLE "AuditAccount" ADD CONSTRAINT "AuditAccount_userId_key" UNIQUE ("userId")`)
    steps.push('added unique constraints')

    // Index (CREATE INDEX only requires table ownership, not schema CREATE)
    await prismaDirectDb.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "AuditAccount_internalEmail_idx" ON "AuditAccount"("internalEmail")`)
    steps.push('created index')

    return NextResponse.json({ ok: true, steps })
  } catch (err: any) {
    return NextResponse.json({ error: err.message, steps }, { status: 500 })
  }
}
