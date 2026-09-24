import prisma from '@/lib/prisma'

/**
 * Is the AI Guide switched on, site-wide?
 *
 * SystemState."aiGuideEnabled" was added out of band (BOOLEAN NOT NULL
 * DEFAULT true), so it is read with raw SQL - the generated client predates
 * it. Anything unexpected reads as ON: a failed lookup must not take the
 * guide away from everyone.
 */
export async function getAiGuideEnabled(): Promise<boolean> {
  try {
    const rows = await prisma.$queryRaw<{ on: boolean }[]>`SELECT "aiGuideEnabled" AS "on" FROM "SystemState" LIMIT 1`
    return rows[0]?.on !== false
  } catch {
    return true
  }
}

export async function setAiGuideEnabled(on: boolean): Promise<void> {
  await prisma.$executeRaw`UPDATE "SystemState" SET "aiGuideEnabled" = ${on}`
}
