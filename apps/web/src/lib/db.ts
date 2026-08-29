import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  __prismaSchemaVersion: string | undefined
}

// Force a fresh PrismaClient if the schema version has changed since the
// singleton was cached (e.g. after `prisma db push` + `prisma generate`
// during dev). Without this, hot-reload keeps the OLD PrismaClient instance
// (with the OLD schema) in memory even though the @prisma/client library
// has been regenerated, which leads to new fields returning `undefined`.
const SCHEMA_VERSION = '2026-08-29-financial-integrity'

const needsFresh =
  !globalForPrisma.prisma || globalForPrisma.__prismaSchemaVersion !== SCHEMA_VERSION

const prisma = needsFresh
  ? new PrismaClient({
    log: ['warn', 'error'],
  })
  : globalForPrisma.prisma!

globalForPrisma.prisma = prisma
globalForPrisma.__prismaSchemaVersion = SCHEMA_VERSION

export const db: PrismaClient = prisma

if (process.env.NODE_ENV !== 'production') {
  // keep reference alive so we can re-use on hot reload
  globalForPrisma.prisma = db
}
