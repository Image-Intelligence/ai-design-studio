import { PrismaClient } from '@prisma/client';

// Prisma Client singleton to avoid multiple instances
const globalForPrisma = global as unknown as { prisma: PrismaClient; prismaDirectDb: PrismaClient };

/*
 * Local dev only: at most DEV_QUERY_LIMIT Accelerate queries in flight at once
 * (2026-10-20, owner: "the dev server doesn't even load on my iPad"). Every
 * Accelerate query is an HTTPS request, and a burst opens a fresh connection
 * for each one - a portal page load fires dozens of routes, each checking the
 * session. From this machine, 80 at once stalled every one of them ~6s (the
 * network dropping the burst of new connections and Windows retrying them);
 * past 10s they failed as P5010 "fetch failed", Prisma retried, and the
 * retries piled on. Queued 24 at a time, 200 queries finished in under a
 * second. Production (Vercel -> Accelerate) never saw this, so it is left as is.
 */
const DEV_QUERY_LIMIT = 24;
function devQueryGate(client: PrismaClient) {
  let active = 0;
  const waiting: (() => void)[] = [];
  // $use (query middleware) keeps the client's own type, so nothing that takes a PrismaClient changes
  client.$use(async (params, next) => {
    if (active >= DEV_QUERY_LIMIT) await new Promise<void>(resolve => waiting.push(resolve));
    active++;
    try { return await next(params); } finally { active--; waiting.shift()?.(); }
  });
  return client;
}

export const prisma =
  globalForPrisma.prisma ||
  (() => {
    const client = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    });
    return process.env.NODE_ENV === 'production' ? client : devQueryGate(client);
  })();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

/**
 * Direct database client — bypasses Prisma Accelerate's 5 MB response-size limit.
 * Use this for queries that may return large JSON payloads (e.g. canvas layers
 * containing base64 image data).
 */
export const prismaDirectDb: PrismaClient =
  globalForPrisma.prismaDirectDb ||
  new PrismaClient({
    datasourceUrl: process.env.DATABASE_URL,
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prismaDirectDb = prismaDirectDb;

export default prisma;
