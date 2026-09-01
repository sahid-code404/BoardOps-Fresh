import { Hono, type Context } from "hono";
import { authenticatedPrincipal, type AuthPrincipal } from "../auth/authorization";
import type { AppEnv } from "../types";

type BillStatus =
  | "DRAFT"
  | "GENERATED"
  | "PARTIALLY_PAID"
  | "PAID"
  | "OVERDUE"
  | "VOID"
  | "DELETED";

type BillRow = {
  id: string;
  institution_id: string;
  user_id: string;
  snapshot_id: string | null;
  source: "SNAPSHOT" | "MIGRATED";
  period_month: number;
  period_year: number;
  meal_charges_minor: number;
  other_charges_minor: number;
  adjustments_minor: number;
  total_amount_minor: number;
  paid_amount_minor: number;
  due_amount_minor: number;
  status: BillStatus;
  status_before_delete: Exclude<BillStatus, "DELETED"> | null;
  due_date: string | null;
  generated_at: string | null;
  deleted_on: string | null;
  deletion_scheduled_for: string | null;
  deleted_by: string | null;
  deletion_reason: string | null;
  purged_at: string | null;
  created_at: string;
  updated_at: string;
};

type BillWithUserRow = BillRow & {
  user_name: string;
  user_email: string;
  user_room: string | null;
  user_avatar_url: string | null;
};

type SnapshotRow = {
  id: string;
  institution_id: string;
  period_month: number;
  period_year: number;
  currency_code: string;
  snapshot_version: number;
  resident_count: number;
  total_resident_meals: number;
  total_guest_meals: number;
  total_expenses_minor: number;
  guest_revenue_minor: number;
  per_meal_charge_minor: number;
  snapshot_json: string;
  created_at: string;
};

type SnapshotResidentLine = {
  userId: string;
  mealCount?: number;
  mealChargesMinor: number;
  otherChargesMinor: number;
  adjustmentsMinor: number;
  totalAmountMinor: number;
};

type SnapshotPayload = {
  version?: number;
  currency?: string;
  residents: SnapshotResidentLine[];
  [key: string]: unknown;
};

type ReadinessItem = {
  key: string;
  label: string;
  status: "ready" | "warning" | "error";
  detail: string;
  count?: number;
};

const RESTORABLE_STATUSES = new Set<Exclude<BillStatus, "DELETED">>([
  "DRAFT",
  "GENERATED",
  "PARTIALLY_PAID",
  "PAID",
  "OVERDUE",
  "VOID",
]);

export const billingRoutes = new Hono<AppEnv>();

async function principalFor(c: Context<AppEnv>): Promise<AuthPrincipal | Response> {
  const principal = await authenticatedPrincipal(c);
  return principal ?? c.json({ success: false, error: "Authentication required" }, 401);
}

function periodLabel(month: number, year: number): string {
  const date = new Date(Date.UTC(year, month, 1));
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function isValidPeriod(month: number, year: number): boolean {
  return Number.isInteger(month) && month >= 0 && month <= 11 && Number.isInteger(year) && year >= 2000 && year <= 9999;
}

function periodFromQuery(c: Context<AppEnv>): { month: number; year: number } | Response {
  const now = new Date();
  const rawMonth = c.req.query("month");
  const rawYear = c.req.query("year");
  const month = rawMonth === undefined ? now.getUTCMonth() : Number(rawMonth);
  const year = rawYear === undefined ? now.getUTCFullYear() : Number(rawYear);
  if (!isValidPeriod(month, year)) {
    return c.json({ success: false, error: "month/year must identify a valid billing period" }, 400);
  }
  return { month, year };
}

function isoForDateKey(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return null;
  return parsed.toISOString();
}

function defaultDueDate(month: number, year: number): string {
  return new Date(Date.UTC(year, month + 1, 10, 0, 0, 0, 0)).toISOString();
}

function minorToMajor(value: number): number {
  return Number(value || 0) / 100;
}

function billResponse(row: BillWithUserRow) {
  return {
    id: row.id,
    periodMonth: row.period_month,
    periodYear: row.period_year,
    mealCharges: minorToMajor(row.meal_charges_minor),
    otherCharges: minorToMajor(row.other_charges_minor),
    adjustments: minorToMajor(row.adjustments_minor),
    totalAmount: minorToMajor(row.total_amount_minor),
    paidAmount: minorToMajor(row.paid_amount_minor),
    dueAmount: minorToMajor(row.due_amount_minor),
    status: row.status,
    dueDate: row.due_date,
    generatedAt: row.generated_at,
    createdAt: row.created_at,
    // The legacy golden UI treats `deletedAt` as the end of the seven-day
    // recovery window, not the instant the delete button was pressed.
    deletedAt: row.deletion_scheduled_for,
    deletionReason: row.deletion_reason,
    user: {
      name: row.user_name,
      email: row.user_email,
      room: row.user_room,
      avatarUrl: row.user_avatar_url,
    },
  };
}

async function institutionTimezone(c: Context<AppEnv>, institutionId: string): Promise<string> {
  const row = await c.env.DB.prepare(`SELECT timezone FROM institutions WHERE id = ? LIMIT 1`)
    .bind(institutionId)
    .first<{ timezone: string }>();
  return row?.timezone || "UTC";
}

function currentPeriodInTimeZone(timeZone: string, now = new Date()): { month: number; year: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value ?? now.getUTCFullYear());
  const month = Number(parts.find((part) => part.type === "month")?.value ?? now.getUTCMonth() + 1) - 1;
  return { month, year };
}

function parseSnapshotPayload(snapshot: SnapshotRow): SnapshotPayload | null {
  try {
    const value = JSON.parse(snapshot.snapshot_json) as unknown;
    if (!value || typeof value !== "object" || !Array.isArray((value as { residents?: unknown }).residents)) {
      return null;
    }
    return value as SnapshotPayload;
  } catch {
    return null;
  }
}

function validateSnapshotLine(line: SnapshotResidentLine): string | null {
  if (!line || typeof line !== "object" || typeof line.userId !== "string" || line.userId.trim().length === 0) {
    return "snapshot resident is missing userId";
  }
  const integerFields: Array<[string, number, boolean]> = [
    ["mealChargesMinor", line.mealChargesMinor, false],
    ["otherChargesMinor", line.otherChargesMinor, false],
    ["adjustmentsMinor", line.adjustmentsMinor, true],
    ["totalAmountMinor", line.totalAmountMinor, false],
  ];
  for (const [name, value, allowNegative] of integerFields) {
    if (!Number.isSafeInteger(value) || (!allowNegative && value < 0)) {
      return `${name} must be an integer minor-unit amount`;
    }
  }
  if (line.totalAmountMinor !== line.mealChargesMinor + line.otherChargesMinor + line.adjustmentsMinor) {
    return "snapshot resident total does not match its components";
  }
  return null;
}

async function markExpiredDeletionQueue(c: Context<AppEnv>, institutionId: string, nowIso: string): Promise<void> {
  // "Permanent deletion" removes the bill from operational recovery surfaces,
  // but the financial row remains as an immutable tombstone for auditability.
  await c.env.DB.prepare(
    `UPDATE bills
        SET purged_at = ?, updated_at = ?
      WHERE institution_id = ?
        AND status = 'DELETED'
        AND purged_at IS NULL
        AND deletion_scheduled_for IS NOT NULL
        AND deletion_scheduled_for <= ?`,
  )
    .bind(nowIso, nowIso, institutionId, nowIso)
    .run();
}

async function transitionOverdue(c: Context<AppEnv>, institutionId: string, nowIso: string): Promise<void> {
  await c.env.DB.prepare(
    `UPDATE bills
        SET status = 'OVERDUE', updated_at = ?
      WHERE institution_id = ?
        AND deleted_on IS NULL
        AND status IN ('GENERATED', 'PARTIALLY_PAID')
        AND due_amount_minor > 0
        AND due_date IS NOT NULL
        AND due_date < ?`,
  )
    .bind(nowIso, institutionId, nowIso)
    .run();
}

async function loadBillWithUser(
  c: Context<AppEnv>,
  principal: AuthPrincipal,
  billId: string,
): Promise<BillWithUserRow | null> {
  const residentScope = principal.role === "USER" ? " AND b.user_id = ?" : "";
  const bindings: unknown[] = [billId, principal.institutionId];
  if (principal.role === "USER") bindings.push(principal.id);
  return c.env.DB.prepare(
    `SELECT b.*,
            u.name AS user_name,
            u.email AS user_email,
            u.room AS user_room,
            u.avatar_url AS user_avatar_url
       FROM bills b
       JOIN users u ON u.id = b.user_id
      WHERE b.id = ?
        AND b.institution_id = ?
        AND u.institution_id = b.institution_id
        AND u.role = 'USER'
        ${residentScope}
      LIMIT 1`,
  )
    .bind(...bindings)
    .first<BillWithUserRow>();
}

async function audit(
  c: Context<AppEnv>,
  principal: AuthPrincipal,
  action: string,
  entityType: string,
  entityId: string | null,
  reason: string | null,
  metadata: Record<string, unknown>,
): Promise<void> {
  await c.env.DB.prepare(
    `INSERT INTO audit_events
      (id, institution_id, actor_user_id, action, entity_type, entity_id,
       request_id, reason, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      principal.institutionId,
      principal.id,
      action,
      entityType,
      entityId,
      c.get("requestId"),
      reason,
      JSON.stringify(metadata),
      new Date().toISOString(),
    )
    .run();
}

billingRoutes.get("/bills", async (c) => {
  const auth = await principalFor(c);
  if (auth instanceof Response) return auth;
  const principal = auth;
  const nowIso = new Date().toISOString();
  await markExpiredDeletionQueue(c, principal.institutionId, nowIso);
  await transitionOverdue(c, principal.institutionId, nowIso);

  const clauses = [
    "b.institution_id = ?",
    "u.institution_id = b.institution_id",
    "u.role = 'USER'",
    "b.purged_at IS NULL",
  ];
  const bindings: unknown[] = [principal.institutionId];

  const monthRaw = c.req.query("month");
  const yearRaw = c.req.query("year");
  if ((monthRaw === undefined) !== (yearRaw === undefined)) {
    return c.json({ success: false, error: "month and year must be supplied together" }, 400);
  }
  if (monthRaw !== undefined && yearRaw !== undefined) {
    const month = Number(monthRaw);
    const year = Number(yearRaw);
    if (!isValidPeriod(month, year)) {
      return c.json({ success: false, error: "month/year must identify a valid billing period" }, 400);
    }
    clauses.push("b.period_month = ?", "b.period_year = ?");
    bindings.push(month, year);
  }

  const includeDeleted = c.req.query("includeDeleted") === "true";
  clauses.push(includeDeleted ? "b.deleted_on IS NOT NULL" : "b.deleted_on IS NULL");

  if (principal.role === "USER") {
    clauses.push("b.user_id = ?");
    bindings.push(principal.id);
  }

  if (c.req.query("future") === "false") {
    const timeZone = await institutionTimezone(c, principal.institutionId);
    const current = currentPeriodInTimeZone(timeZone);
    clauses.push("(b.period_year * 12 + b.period_month) <= ?");
    bindings.push(current.year * 12 + current.month);
  }

  const requestedLimit = Number(c.req.query("limit") ?? 200);
  const limit = Number.isFinite(requestedLimit) ? Math.min(500, Math.max(1, Math.trunc(requestedLimit))) : 200;
  bindings.push(limit);

  const rows = await c.env.DB.prepare(
    `SELECT b.*,
            u.name AS user_name,
            u.email AS user_email,
            u.room AS user_room,
            u.avatar_url AS user_avatar_url
       FROM bills b
       JOIN users u ON u.id = b.user_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY b.created_at DESC
      LIMIT ?`,
  )
    .bind(...bindings)
    .all<BillWithUserRow>();

  return c.json({ success: true, data: rows.results.map(billResponse) });
});

billingRoutes.get("/bills/:id", async (c) => {
  const auth = await principalFor(c);
  if (auth instanceof Response) return auth;
  const row = await loadBillWithUser(c, auth, c.req.param("id"));
  if (!row || row.purged_at) return c.json({ success: false, error: "Bill not found" }, 404);
  return c.json({ success: true, data: billResponse(row) });
});

billingRoutes.get("/billing-cycles/readiness", async (c) => {
  const auth = await principalFor(c);
  if (auth instanceof Response) return auth;
  const principal = auth;
  const period = periodFromQuery(c);
  if (period instanceof Response) return period;
  const { month, year } = period;
  const label = periodLabel(month, year);
  const items: ReadinessItem[] = [];

  const timeZone = await institutionTimezone(c, principal.institutionId);
  const current = currentPeriodInTimeZone(timeZone);
  const selectedKey = year * 12 + month;
  const currentKey = current.year * 12 + current.month;
  if (selectedKey >= currentKey) {
    items.push({
      key: "period",
      label: "Billing Period",
      status: "error",
      detail: `Cannot generate bills for ${label} — bills can only be generated for completed past months.`,
    });
  } else {
    items.push({
      key: "period",
      label: "Billing Period",
      status: "ready",
      detail: `${label} is a completed billing period.`,
    });
  }

  const periodKey = `${year}-${String(month + 1).padStart(2, "0")}`;
  const accountingPeriod = await c.env.DB.prepare(
    `SELECT id, status FROM accounting_periods WHERE institution_id = ? AND period_key = ? LIMIT 1`,
  )
    .bind(principal.institutionId, periodKey)
    .first<{ id: string; status: string }>();
  if (accountingPeriod?.status === "CLOSED") {
    items.push({
      key: "cycle",
      label: "Accounting Period",
      status: "error",
      detail: `${label} is already CLOSED. Historical corrections must use adjustments rather than bill regeneration.`,
    });
  } else if (accountingPeriod?.status === "CLOSING") {
    items.push({
      key: "cycle",
      label: "Accounting Period",
      status: "warning",
      detail: `${label} is currently closing. Finish or roll back the closing workflow first.`,
    });
  } else {
    items.push({
      key: "cycle",
      label: "Accounting Period",
      status: "ready",
      detail: accountingPeriod ? `${label} is open for billing.` : "No closed accounting-period lock blocks generation.",
    });
  }

  const snapshot = await c.env.DB.prepare(
    `SELECT * FROM billing_snapshots
      WHERE institution_id = ? AND period_month = ? AND period_year = ?
      LIMIT 1`,
  )
    .bind(principal.institutionId, month, year)
    .first<SnapshotRow>();

  const payload = snapshot ? parseSnapshotPayload(snapshot) : null;
  if (!snapshot) {
    items.push({
      key: "snapshot",
      label: "Immutable Snapshot",
      status: "error",
      detail: `No immutable billing snapshot exists for ${label}. Complete upstream closing inputs first.`,
    });
  } else if (!payload) {
    items.push({
      key: "snapshot",
      label: "Immutable Snapshot",
      status: "error",
      detail: "The stored snapshot is unreadable and generation is blocked fail-closed.",
    });
  } else {
    items.push({
      key: "snapshot",
      label: "Immutable Snapshot",
      status: "ready",
      detail: `Snapshot v${snapshot.snapshot_version} is frozen and will be the only source used for bill amounts.`,
    });
  }

  if (snapshot && payload) {
    const uniqueResidents = new Set(payload.residents.map((resident) => resident.userId));
    const allLinesValid = payload.residents.every((line) => validateSnapshotLine(line) === null);
    const residentCountMatches = snapshot.resident_count === payload.residents.length && uniqueResidents.size === payload.residents.length;
    if (payload.residents.length === 0) {
      items.push({
        key: "residents",
        label: "Snapshot Residents",
        status: "error",
        detail: "The snapshot contains no residents to bill.",
        count: 0,
      });
    } else if (!allLinesValid || !residentCountMatches) {
      items.push({
        key: "residents",
        label: "Snapshot Residents",
        status: "error",
        detail: "Snapshot resident lines failed integrity validation.",
        count: payload.residents.length,
      });
    } else {
      items.push({
        key: "residents",
        label: "Snapshot Residents",
        status: "ready",
        detail: `${payload.residents.length} frozen resident bill line(s) are ready.`,
        count: payload.residents.length,
      });
    }

    items.push({
      key: "inputs",
      label: "Frozen Inputs",
      status: "ready",
      detail: `${snapshot.total_resident_meals} resident meal(s), ${snapshot.total_guest_meals} guest meal(s), expenses ${snapshot.currency_code} ${minorToMajor(snapshot.total_expenses_minor).toFixed(2)}.`,
    });
  }

  const existing = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count
       FROM bills
      WHERE institution_id = ? AND period_month = ? AND period_year = ?
        AND purged_at IS NULL`,
  )
    .bind(principal.institutionId, month, year)
    .first<{ count: number }>();
  items.push({
    key: "bills",
    label: "Existing Bills",
    status: "ready",
    detail: Number(existing?.count ?? 0) > 0
      ? `${Number(existing?.count ?? 0)} bill(s) already exist. Immutable generated bills will be left unchanged.`
      : "No existing bills conflict with this snapshot.",
    count: Number(existing?.count ?? 0),
  });

  return c.json({
    success: true,
    data: {
      month,
      year,
      periodLabel: label,
      items,
      canClose: items.every((item) => item.status === "ready"),
      existingCycle: accountingPeriod ? { id: accountingPeriod.id, status: accountingPeriod.status } : null,
    },
  });
});

billingRoutes.post("/bills", async (c) => {
  const auth = await principalFor(c);
  if (auth instanceof Response) return auth;

  return c.json({
    success: false,
    error: "Bills are generated only through Monthly Closing. Close the billing period to create bills.",
  }, 409);
});

billingRoutes.delete("/bills", async (c) => {
  const auth = await principalFor(c);
  if (auth instanceof Response) return auth;
  const principal = auth;

  let body: Record<string, unknown> = {};
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    // Empty DELETE bodies are valid.
  }
  const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 1000) : null;

  const clauses = ["institution_id = ?", "deleted_on IS NULL", "purged_at IS NULL"];
  const bindings: unknown[] = [principal.institutionId];
  const monthRaw = c.req.query("month");
  const yearRaw = c.req.query("year");
  if ((monthRaw === undefined) !== (yearRaw === undefined)) {
    return c.json({ success: false, error: "month and year must be supplied together" }, 400);
  }
  if (monthRaw !== undefined && yearRaw !== undefined) {
    const month = Number(monthRaw);
    const year = Number(yearRaw);
    if (!isValidPeriod(month, year)) {
      return c.json({ success: false, error: "month/year must identify a valid billing period" }, 400);
    }
    clauses.push("period_month = ?", "period_year = ?");
    bindings.push(month, year);
  }

  const now = new Date();
  const deletedOn = now.toISOString();
  const scheduled = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const result = await c.env.DB.prepare(
    `UPDATE bills
        SET status_before_delete = status,
            status = 'DELETED',
            deleted_on = ?, deletion_scheduled_for = ?, deleted_by = ?,
            deletion_reason = ?, updated_at = ?
      WHERE ${clauses.join(" AND ")}`,
  )
    .bind(deletedOn, scheduled, principal.id, reason, deletedOn, ...bindings)
    .run();

  const deleted = Number(result.meta.changes ?? 0);
  await audit(c, principal, "BILLS_SOFT_DELETED", "Bill", null, reason, {
    deleted,
    permanentDeletion: scheduled,
    month: monthRaw === undefined ? null : Number(monthRaw),
    year: yearRaw === undefined ? null : Number(yearRaw),
  });

  return c.json({ success: true, data: { deleted, permanentDeletion: scheduled } });
});

billingRoutes.delete("/bills/:id", async (c) => {
  const auth = await principalFor(c);
  if (auth instanceof Response) return auth;
  const principal = auth;
  const billId = c.req.param("id");

  let body: Record<string, unknown> = {};
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    // Reason is optional.
  }
  const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 1000) : null;
  const existing = await loadBillWithUser(c, principal, billId);
  if (!existing || existing.purged_at) return c.json({ success: false, error: "Bill not found" }, 404);
  if (existing.deleted_on) return c.json({ success: false, error: "Bill is already scheduled for deletion" }, 422);

  const now = new Date();
  const deletedOn = now.toISOString();
  const scheduled = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await c.env.DB.prepare(
    `UPDATE bills
        SET status_before_delete = status,
            status = 'DELETED',
            deleted_on = ?, deletion_scheduled_for = ?, deleted_by = ?,
            deletion_reason = ?, updated_at = ?
      WHERE id = ? AND institution_id = ?`,
  )
    .bind(deletedOn, scheduled, principal.id, reason, deletedOn, billId, principal.institutionId)
    .run();

  await audit(c, principal, "BILL_SOFT_DELETED", "Bill", billId, reason, {
    previousStatus: existing.status,
    permanentDeletion: scheduled,
  });
  return c.json({ success: true, data: { success: true, permanentDeletion: scheduled } });
});

billingRoutes.post("/bills/:id/restore", async (c) => {
  const auth = await principalFor(c);
  if (auth instanceof Response) return auth;
  const principal = auth;
  const nowIso = new Date().toISOString();
  await markExpiredDeletionQueue(c, principal.institutionId, nowIso);

  const billId = c.req.param("id");
  const existing = await loadBillWithUser(c, principal, billId);
  if (!existing) return c.json({ success: false, error: "Bill not found" }, 404);
  if (existing.purged_at) return c.json({ success: false, error: "Bill recovery window has expired" }, 410);
  if (!existing.deleted_on || existing.status !== "DELETED") {
    return c.json({ success: false, error: "This bill is not in the deletion queue" }, 422);
  }

  let restoredStatus: Exclude<BillStatus, "DELETED"> = "GENERATED";
  if (existing.status_before_delete && RESTORABLE_STATUSES.has(existing.status_before_delete)) {
    restoredStatus = existing.status_before_delete;
  } else if (existing.due_amount_minor === 0 && existing.total_amount_minor > 0) {
    restoredStatus = "PAID";
  } else if (existing.paid_amount_minor > 0) {
    restoredStatus = "PARTIALLY_PAID";
  }

  await c.env.DB.prepare(
    `UPDATE bills
        SET status = ?, status_before_delete = NULL,
            deleted_on = NULL, deletion_scheduled_for = NULL, deleted_by = NULL,
            deletion_reason = NULL, purged_at = NULL, updated_at = ?
      WHERE id = ? AND institution_id = ?`,
  )
    .bind(restoredStatus, nowIso, billId, principal.institutionId)
    .run();

  await audit(c, principal, "BILL_RESTORED", "Bill", billId, null, {
    restoredStatus,
  });
  const restored = await loadBillWithUser(c, principal, billId);
  if (!restored) return c.json({ success: false, error: "Bill not found after restore" }, 500);
  return c.json({ success: true, data: billResponse(restored) });
});

billingRoutes.post("/bills/:id/void", async (c) => {
  const auth = await principalFor(c);
  if (auth instanceof Response) return auth;
  const principal = auth;
  const billId = c.req.param("id");
  const existing = await loadBillWithUser(c, principal, billId);
  if (!existing || existing.purged_at) return c.json({ success: false, error: "Bill not found" }, 404);
  if (existing.deleted_on) return c.json({ success: false, error: "Restore this bill before voiding it" }, 422);
  if (existing.status === "VOID") return c.json({ success: false, error: "Bill is already void" }, 422);
  if (existing.paid_amount_minor > 0) {
    return c.json({ success: false, error: "A bill with approved payment value cannot be voided; use a refund/adjustment" }, 422);
  }

  const nowIso = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE bills
        SET status = 'VOID', due_amount_minor = 0, updated_at = ?
      WHERE id = ? AND institution_id = ?`,
  )
    .bind(nowIso, billId, principal.institutionId)
    .run();
  await audit(c, principal, "BILL_VOIDED", "Bill", billId, null, {
    previousStatus: existing.status,
    totalAmountMinor: existing.total_amount_minor,
  });

  const voided = await loadBillWithUser(c, principal, billId);
  if (!voided) return c.json({ success: false, error: "Bill not found after void" }, 500);
  return c.json({ success: true, data: billResponse(voided) });
});
