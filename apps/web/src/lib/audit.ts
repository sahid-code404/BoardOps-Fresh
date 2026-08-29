import { db } from "@/lib/db";
import type { Prisma, PrismaClient } from "@prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

export async function logAudit(input: {
  actorId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
  reason?: string | null;
}, client: DbClient = db) {
  try {
    await client.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        oldValue: input.oldValue ? JSON.stringify(input.oldValue) : null,
        newValue: input.newValue ? JSON.stringify(input.newValue) : null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        reason: input.reason ?? null,
      },
    });
  } catch (e) {
    if (client !== db) throw e;
    console.error("audit log failed:", e);
  }
}
