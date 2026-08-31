import { Hono, type Context } from "hono";
import { authenticatedPrincipal, type AuthPrincipal } from "../auth/authorization";
import type { AppEnv } from "../types";

type RefundStatus = "PENDING" | "PARTIALLY_PAID" | "COMPLETED" | "CANCELLED";
type RefundMethod = "UPI" | "CASH" | "BANK_TRANSFER" | "CHEQUE";
type AdjustmentEntityType = "Payment" | "Refund" | "Bill" | "Expense";

type RefundRow = {
  id: string;
  institution_id: string;
  refund_number: string;
  user_id: string;
  bill_id: string | null;
  amount_minor: number;
  paid_amount_minor: number;
  remaining_amount_minor: number;
  status: RefundStatus;
  method: RefundMethod | null;
  reference: string | null;
  reason: string | null;
  notes: string | null;
  processed_by: string | null;
  processed_at: string | null;
  completed_at: string | null;
  idempotency_key: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  user_name: string;
  user_email: string;
  user_room: string | null;
  user_avatar_url: string | null;
  bill_period_month: number | null;
  bill_period_year: number | null;
};

type RefundTransactionRow = {
  id: string;
  refund_id: string;
  amount_minor: number;
  method: RefundMethod | null;
  reference: string | null;
  notes: string | null;
  processed_by: string | null;
  payment_id: string;
  created_at: string;
};

type AdjustmentRow = {
  id: string;
  adjustment_number: string;
  user_id: string | null;
  entity_type: AdjustmentEntityType;
  entity_id: string;
  amount_minor: number;
  reason: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  user_name: string | null;
  user_email: string | null;
  creator_name: string | null;
  creator_email: string | null;
};

type BillRow = {
  id: string;
  user_id: string;
  total_amount_minor: number;
  paid_amount_minor: number;
  due_amount_minor: number;
  status: string;
  due_date: string | null;
  deleted_on: string | null;
  purged_at: string | null;
};

type CreditRow = {
  approved_minor: number | null;
  refunded_minor: number | null;
  billed_minor: number | null;
  reserved_minor: number | null;
};

const REFUND_METHODS = new Set<RefundMethod>(["UPI", "CASH", "BANK_TRANSFER", "CHEQUE"]);
const REFUND_STATUSES = new Set<RefundStatus>(["PENDING", "PARTIALLY_PAID", "COMPLETED", "CANCELLED"]);
const ADJUSTMENT_ENTITY_TYPES = new Set<AdjustmentEntityType>(["Payment", "Refund", "Bill", "Expense"]);

export const refundAdjustmentRoutes = new Hono<AppEnv>();

async function principalFor(c: Context<AppEnv>): Promise<AuthPrincipal | Response> {
  const principal = await authenticatedPrincipal(c);
  return principal ?? c.json({ success: false, error: "Authentication required" }, 401);
}

function minorToMajor(value: number): number {
  return Number(value || 0) / 100;
}

function positiveMajorToMinor(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  const scaled = value * 100;
  const rounded = Math.round(scaled);
  if (!Number.isSafeInteger(rounded) || Math.abs(scaled - rounded) > 1e-7) return null;
  return rounded;
}

function signedMajorToMinor(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value === 0) return null;
  const scaled = value * 100;
  const rounded = Math.round(scaled);
  if (!Number.isSafeInteger(rounded) || Math.abs(scaled - rounded) > 1e-7 || rounded === 0) return null;
  return rounded;
}

function optionalText(value: unknown, maxLength: number): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, maxLength) : null;
}

async function readBody(c: Context<AppEnv>): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await c.req.json();
    return typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  } catch {
    return null;
  }
}

async function audit(
  c: Context<AppEnv>,
  principal: AuthPrincipal,
  action: string,
  entityType: "Payment" | "Refund" | "Adjustment",
  entityId: string,
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

async function nextReference(
  c: Context<AppEnv>,
  institutionId: string,
  kind: "REF" | "ADJ",
): Promise<string> {
  const year = new Date().getUTCFullYear();
  const sequenceKey = `${kind}:${year}`;
  const now = new Date().toISOString();
  const row = await c.env.DB.prepare(
    `INSERT INTO financial_reference_sequences (institution_id, sequence_key, value, updated_at)
     VALUES (?, ?, 1, ?)
     ON CONFLICT(institution_id, sequence_key)
     DO UPDATE SET value = value + 1, updated_at = excluded.updated_at
     RETURNING value`,
  )
    .bind(institutionId, sequenceKey, now)
    .first<{ value: number }>();
  const value = Number(row?.value ?? 0);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Reference allocation failed");
  return `${kind}-${year}-${String(value).padStart(4, "0")}`;
}

async function availableCredit(c: Context<AppEnv>, institutionId: string, userId: string) {
  const row = await c.env.DB.prepare(
    `SELECT
       (SELECT COALESCE(SUM(amount_minor), 0)
          FROM payments
         WHERE institution_id = ? AND user_id = ?
           AND status = 'APPROVED' AND deleted_on IS NULL AND purged_at IS NULL) AS approved_minor,
       (SELECT COALESCE(SUM(amount_minor), 0)
          FROM payments
         WHERE institution_id = ? AND user_id = ?
           AND status = 'REFUNDED' AND deleted_on IS NULL AND purged_at IS NULL) AS refunded_minor,
       (SELECT COALESCE(SUM(total_amount_minor), 0)
          FROM bills
         WHERE institution_id = ? AND user_id = ?
           AND deleted_on IS NULL AND purged_at IS NULL
           AND status IN ('GENERATED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE')) AS billed_minor,
       (SELECT COALESCE(SUM(remaining_amount_minor), 0)
          FROM refunds
         WHERE institution_id = ? AND user_id = ?
           AND status IN ('PENDING', 'PARTIALLY_PAID')) AS reserved_minor`,
  )
    .bind(
      institutionId, userId,
      institutionId, userId,
      institutionId, userId,
      institutionId, userId,
    )
    .first<CreditRow>();

  const totalApprovedMinor = Number(row?.approved_minor ?? 0);
  const totalRefundedMinor = Number(row?.refunded_minor ?? 0);
  const totalBilledMinor = Number(row?.billed_minor ?? 0);
  const reservedMinor = Number(row?.reserved_minor ?? 0);
  const grossCreditMinor = Math.max(0, totalApprovedMinor - totalBilledMinor - totalRefundedMinor);
  return {
    availableMinor: Math.max(0, grossCreditMinor - reservedMinor),
    grossCreditMinor,
    totalApprovedMinor,
    totalBilledMinor,
    totalRefundedMinor,
    reservedMinor,
  };
}

async function activeBill(
  c: Context<AppEnv>,
  institutionId: string,
  userId: string,
  billId: string,
): Promise<BillRow | null> {
  return c.env.DB.prepare(
    `SELECT id, user_id, total_amount_minor, paid_amount_minor, due_amount_minor,
            status, due_date, deleted_on, purged_at
       FROM bills
      WHERE id = ? AND institution_id = ? AND user_id = ?
      LIMIT 1`,
  )
    .bind(billId, institutionId, userId)
    .first<BillRow>();
}

async function overpaidBill(
  c: Context<AppEnv>,
  institutionId: string,
  userId: string,
  amountMinor: number,
): Promise<BillRow | null> {
  return c.env.DB.prepare(
    `SELECT id, user_id, total_amount_minor, paid_amount_minor, due_amount_minor,
            status, due_date, deleted_on, purged_at
       FROM bills
      WHERE institution_id = ? AND user_id = ?
        AND deleted_on IS NULL AND purged_at IS NULL
        AND status IN ('GENERATED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE')
        AND paid_amount_minor - total_amount_minor >= ?
      ORDER BY (paid_amount_minor - total_amount_minor) DESC, created_at DESC
      LIMIT 1`,
  )
    .bind(institutionId, userId, amountMinor)
    .first<BillRow>();
}

async function recomputeBill(c: Context<AppEnv>, institutionId: string, billId: string | null) {
  if (!billId) return;
  const bill = await c.env.DB.prepare(
    `SELECT id, user_id, total_amount_minor, paid_amount_minor, due_amount_minor,
            status, due_date, deleted_on, purged_at
       FROM bills WHERE id = ? AND institution_id = ? LIMIT 1`,
  )
    .bind(billId, institutionId)
    .first<BillRow>();
  if (!bill || bill.purged_at) return;

  const sums = await c.env.DB.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'APPROVED' AND deleted_on IS NULL THEN amount_minor ELSE 0 END), 0) AS approved_minor,
       COALESCE(SUM(CASE WHEN status = 'REFUNDED' AND deleted_on IS NULL THEN amount_minor ELSE 0 END), 0) AS refunded_minor
     FROM payments
     WHERE institution_id = ? AND bill_id = ? AND purged_at IS NULL`,
  )
    .bind(institutionId, billId)
    .first<{ approved_minor: number | null; refunded_minor: number | null }>();

  const paid = Math.max(0, Number(sums?.approved_minor ?? 0) - Number(sums?.refunded_minor ?? 0));
  const due = Math.max(0, bill.total_amount_minor - paid);
  let status = bill.status;
  if (!new Set(["VOID", "DELETED", "DRAFT"]).has(status)) {
    if (due === 0) status = "PAID";
    else if (bill.due_date && bill.due_date < new Date().toISOString()) status = "OVERDUE";
    else if (paid > 0) status = "PARTIALLY_PAID";
    else status = "GENERATED";
  }

  await c.env.DB.prepare(
    `UPDATE bills SET paid_amount_minor = ?, due_amount_minor = ?, status = ?, updated_at = ?
      WHERE id = ? AND institution_id = ?`,
  )
    .bind(paid, due, status, new Date().toISOString(), billId, institutionId)
    .run();
}

async function loadRefund(c: Context<AppEnv>, institutionId: string, refundId: string): Promise<RefundRow | null> {
  return c.env.DB.prepare(
    `SELECT r.*,
            u.name AS user_name, u.email AS user_email, u.room AS user_room, u.avatar_url AS user_avatar_url,
            b.period_month AS bill_period_month, b.period_year AS bill_period_year
       FROM refunds r
       JOIN users u ON u.id = r.user_id AND u.institution_id = r.institution_id
       LEFT JOIN bills b ON b.id = r.bill_id AND b.institution_id = r.institution_id
      WHERE r.id = ? AND r.institution_id = ?
      LIMIT 1`,
  )
    .bind(refundId, institutionId)
    .first<RefundRow>();
}

async function refundTransactions(c: Context<AppEnv>, institutionId: string, refundId: string) {
  const rows = await c.env.DB.prepare(
    `SELECT id, refund_id, amount_minor, method, reference, notes,
            processed_by, payment_id, created_at
       FROM refund_transactions
      WHERE institution_id = ? AND refund_id = ?
      ORDER BY created_at DESC`,
  )
    .bind(institutionId, refundId)
    .all<RefundTransactionRow>();
  return rows.results.map((row) => ({
    id: row.id,
    amount: minorToMajor(row.amount_minor),
    method: row.method,
    reference: row.reference,
    notes: row.notes,
    processedBy: row.processed_by,
    paymentId: row.payment_id,
    createdAt: row.created_at,
  }));
}

async function refundResponse(c: Context<AppEnv>, row: RefundRow) {
  return {
    id: row.id,
    refundNumber: row.refund_number,
    userId: row.user_id,
    billId: row.bill_id,
    amount: minorToMajor(row.amount_minor),
    paidAmount: minorToMajor(row.paid_amount_minor),
    remainingAmount: minorToMajor(row.remaining_amount_minor),
    status: row.status,
    method: row.method,
    reference: row.reference,
    reason: row.reason,
    notes: row.notes,
    processedBy: row.processed_by,
    processedAt: row.processed_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    user: {
      id: row.user_id,
      name: row.user_name,
      email: row.user_email,
      room: row.user_room,
      avatarUrl: row.user_avatar_url,
    },
    bill: row.bill_id ? {
      id: row.bill_id,
      periodMonth: row.bill_period_month,
      periodYear: row.bill_period_year,
    } : null,
    transactions: await refundTransactions(c, row.institution_id, row.id),
  };
}

function adjustmentResponse(row: AdjustmentRow) {
  return {
    id: row.id,
    adjustmentNumber: row.adjustment_number,
    userId: row.user_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    amount: minorToMajor(row.amount_minor),
    reason: row.reason,
    notes: row.notes,
    createdAt: row.created_at,
    user: row.user_id ? { id: row.user_id, name: row.user_name, email: row.user_email } : null,
    creator: row.created_by ? { id: row.created_by, name: row.creator_name, email: row.creator_email } : null,
  };
}

async function loadAdjustment(c: Context<AppEnv>, institutionId: string, adjustmentId: string) {
  return c.env.DB.prepare(
    `SELECT a.*,
            u.name AS user_name, u.email AS user_email,
            creator.name AS creator_name, creator.email AS creator_email
       FROM adjustments a
       LEFT JOIN users u ON u.id = a.user_id AND u.institution_id = a.institution_id
       LEFT JOIN users creator ON creator.id = a.created_by AND creator.institution_id = a.institution_id
      WHERE a.id = ? AND a.institution_id = ? LIMIT 1`,
  )
    .bind(adjustmentId, institutionId)
    .first<AdjustmentRow>();
}

async function entityUserId(
  c: Context<AppEnv>,
  institutionId: string,
  entityType: AdjustmentEntityType,
  entityId: string,
): Promise<{ found: boolean; userId: string | null }> {
  const table = entityType === "Payment" ? "payments"
    : entityType === "Refund" ? "refunds"
      : entityType === "Bill" ? "bills"
        : "expenses";
  const userColumn = entityType === "Expense" ? "NULL" : "user_id";
  const row = await c.env.DB.prepare(
    `SELECT ${userColumn} AS user_id FROM ${table} WHERE id = ? AND institution_id = ? LIMIT 1`,
  )
    .bind(entityId, institutionId)
    .first<{ user_id: string | null }>();
  return row ? { found: true, userId: row.user_id } : { found: false, userId: null };
}

// Golden credit-refund flow. Outstanding durable refund obligations reserve
// credit so a direct payout cannot spend money already promised elsewhere.
refundAdjustmentRoutes.get("/payments/refund", async (c) => {
  const principal = await principalFor(c);
  if (principal instanceof Response) return principal;

  const residents = await c.env.DB.prepare(
    `SELECT id, name, email, room, avatar_url
       FROM users
      WHERE institution_id = ? AND role = 'USER' AND status = 'ACTIVE' AND deleted_at IS NULL
      ORDER BY name ASC`,
  )
    .bind(principal.institutionId)
    .all<{ id: string; name: string; email: string; room: string | null; avatar_url: string | null }>();

  const result = [];
  for (const resident of residents.results) {
    // Refund eligibility is bill-specific. A generic deposit/credit balance is
    // not enough: a completed generated bill must still be net-overpaid.
    const overpaid = await c.env.DB.prepare(
      `SELECT b.id, b.period_month, b.period_year,
              b.paid_amount_minor - b.total_amount_minor AS overpaid_minor
         FROM bills b
        WHERE b.institution_id = ? AND b.user_id = ?
          AND b.deleted_on IS NULL AND b.purged_at IS NULL
          AND b.generated_at IS NOT NULL
          AND b.status IN ('GENERATED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE')
          AND b.paid_amount_minor > b.total_amount_minor
          AND EXISTS (
            SELECT 1 FROM billing_cycles bc
             WHERE bc.institution_id = b.institution_id
               AND bc.period_month = b.period_month
               AND bc.period_year = b.period_year
               AND bc.status = 'CLOSED'
          )
        ORDER BY (b.paid_amount_minor - b.total_amount_minor) DESC,
                 b.period_year DESC, b.period_month DESC, b.created_at DESC
        LIMIT 1`,
    )
      .bind(principal.institutionId, resident.id)
      .first<{ id: string; period_month: number; period_year: number; overpaid_minor: number }>();
    if (!overpaid || Number(overpaid.overpaid_minor) <= 0) continue;

    const reserved = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(remaining_amount_minor), 0) AS total
         FROM refunds
        WHERE institution_id = ? AND user_id = ? AND bill_id = ?
          AND status IN ('PENDING', 'PARTIALLY_PAID')`,
    )
      .bind(principal.institutionId, resident.id, overpaid.id)
      .first<{ total: number }>();
    const refundableMinor = Math.max(0, Number(overpaid.overpaid_minor) - Number(reserved?.total ?? 0));
    if (refundableMinor <= 0) continue;

    result.push({
      userId: resident.id,
      name: resident.name,
      email: resident.email,
      room: resident.room,
      avatarUrl: resident.avatar_url,
      billId: overpaid.id,
      billPeriodMonth: overpaid.period_month,
      billPeriodYear: overpaid.period_year,
      creditAmount: minorToMajor(refundableMinor),
    });
  }
  result.sort((a, b) => b.creditAmount - a.creditAmount);
  return c.json({ success: true, data: result });
});

refundAdjustmentRoutes.post("/payments/refund", async (c) => {
  const principal = await principalFor(c);
  if (principal instanceof Response) return principal;
  const body = await readBody(c);
  if (!body) return c.json({ success: false, error: "Invalid JSON body" }, 400);

  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  const amountMinor = positiveMajorToMinor(body.amount);
  if (!userId || amountMinor === null) {
    return c.json({ success: false, error: "userId and a positive two-decimal amount are required" }, 422);
  }

  const resident = await c.env.DB.prepare(
    `SELECT id, name, email, room, avatar_url FROM users
      WHERE id = ? AND institution_id = ? AND role = 'USER' AND deleted_at IS NULL LIMIT 1`,
  )
    .bind(userId, principal.institutionId)
    .first<{ id: string; name: string; email: string; room: string | null; avatar_url: string | null }>();
  if (!resident) return c.json({ success: false, error: "Resident not found" }, 404);

  const credit = await availableCredit(c, principal.institutionId, userId);
  if (amountMinor > credit.availableMinor) {
    return c.json({ success: false, error: `User only has ₹${minorToMajor(credit.availableMinor)} refundable credit` }, 422);
  }

  let billId: string | null = null;
  if (typeof body.billId === "string" && body.billId.trim()) {
    const bill = await activeBill(c, principal.institutionId, userId, body.billId.trim());
    if (!bill || bill.deleted_on || bill.purged_at || new Set(["VOID", "DELETED", "DRAFT"]).has(bill.status)) {
      return c.json({ success: false, error: "Selected refund bill is unavailable" }, 422);
    }
    if (Math.max(0, bill.paid_amount_minor - bill.total_amount_minor) < amountMinor) {
      return c.json({ success: false, error: "Selected bill does not contain enough overpayment for this refund" }, 422);
    }
    billId = bill.id;
  } else {
    billId = (await overpaidBill(c, principal.institutionId, userId, amountMinor))?.id ?? null;
  }
  if (!billId) {
    return c.json({ success: false, error: "Refunds are available only for overpayment on a generated bill" }, 422);
  }
  const eligibleBill = await c.env.DB.prepare(
    `SELECT b.id, b.paid_amount_minor - b.total_amount_minor AS overpaid_minor
       FROM bills b
       JOIN billing_cycles bc
         ON bc.institution_id = b.institution_id
        AND bc.period_month = b.period_month
        AND bc.period_year = b.period_year
      WHERE b.id = ? AND b.institution_id = ? AND b.user_id = ?
        AND b.generated_at IS NOT NULL
        AND b.deleted_on IS NULL AND b.purged_at IS NULL
        AND b.status IN ('GENERATED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE')
        AND bc.status = 'CLOSED'
      LIMIT 1`,
  )
    .bind(billId, principal.institutionId, userId)
    .first<{ id: string; overpaid_minor: number }>();
  if (!eligibleBill || Number(eligibleBill.overpaid_minor) < amountMinor) {
    return c.json({ success: false, error: "Refund is not backed by unsettled overpayment on a completed generated bill" }, 422);
  }

  const headerKey = c.req.header("Idempotency-Key")?.trim().slice(0, 200) || null;
  if (headerKey) {
    const replay = await c.env.DB.prepare(
      `SELECT id FROM payments
        WHERE institution_id = ? AND user_id = ? AND idempotency_key = ? LIMIT 1`,
    )
      .bind(principal.institutionId, userId, headerKey)
      .first<{ id: string }>();
    if (replay) {
      return c.json({ success: true, data: { id: replay.id, replayed: true } });
    }
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const notes = optionalText(body.notes, 2000) || "Refund of excess resident credit";
  await c.env.DB.prepare(
    `INSERT INTO payments
      (id, institution_id, user_id, bill_id, amount_minor, method, status,
       reference, notes, idempotency_key, approved_by, approved_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'REFUND', 'REFUNDED', 'REFUND', ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, principal.institutionId, userId, billId, amountMinor, notes, headerKey, principal.id, now, now, now)
    .run();
  await recomputeBill(c, principal.institutionId, billId);
  await audit(c, principal, "PAYMENT_REFUND", "Payment", id, null, {
    userId,
    amountMinor,
    billId,
    availableCreditBeforeMinor: credit.availableMinor,
  });

  return c.json({
    success: true,
    data: {
      id,
      amount: minorToMajor(amountMinor),
      method: "REFUND",
      status: "REFUNDED",
      reference: "REFUND",
      notes,
      billId,
      approvedAt: now,
      createdAt: now,
      user: {
        name: resident.name,
        email: resident.email,
        room: resident.room,
        avatarUrl: resident.avatar_url,
      },
    },
  }, 201);
});

refundAdjustmentRoutes.get("/refunds", async (c) => {
  const principal = await principalFor(c);
  if (principal instanceof Response) return principal;
  const clauses = ["r.institution_id = ?"];
  const bindings: unknown[] = [principal.institutionId];
  const status = c.req.query("status");
  if (status) {
    if (!REFUND_STATUSES.has(status as RefundStatus)) {
      return c.json({ success: false, error: "Invalid refund status" }, 400);
    }
    clauses.push("r.status = ?");
    bindings.push(status);
  }
  const userId = c.req.query("userId")?.trim();
  if (userId) {
    clauses.push("r.user_id = ?");
    bindings.push(userId);
  }
  const requestedLimit = Number(c.req.query("limit") ?? 100);
  const limit = Number.isFinite(requestedLimit) ? Math.min(200, Math.max(1, Math.trunc(requestedLimit))) : 100;
  bindings.push(limit);

  const rows = await c.env.DB.prepare(
    `SELECT r.*,
            u.name AS user_name, u.email AS user_email, u.room AS user_room, u.avatar_url AS user_avatar_url,
            b.period_month AS bill_period_month, b.period_year AS bill_period_year
       FROM refunds r
       JOIN users u ON u.id = r.user_id AND u.institution_id = r.institution_id
       LEFT JOIN bills b ON b.id = r.bill_id AND b.institution_id = r.institution_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY r.created_at DESC
      LIMIT ?`,
  )
    .bind(...bindings)
    .all<RefundRow>();
  const data = [];
  for (const row of rows.results) data.push(await refundResponse(c, row));
  return c.json({ success: true, data });
});

refundAdjustmentRoutes.post("/refunds", async (c) => {
  const principal = await principalFor(c);
  if (principal instanceof Response) return principal;
  const idempotencyKey = c.req.header("Idempotency-Key")?.trim();
  if (!idempotencyKey || idempotencyKey.length > 200) {
    return c.json({ success: false, error: "Idempotency-Key header is required" }, 400);
  }

  const replay = await c.env.DB.prepare(
    `SELECT id FROM refunds WHERE institution_id = ? AND idempotency_key = ? LIMIT 1`,
  )
    .bind(principal.institutionId, idempotencyKey)
    .first<{ id: string }>();
  if (replay) {
    const row = await loadRefund(c, principal.institutionId, replay.id);
    return c.json({ success: true, data: row ? await refundResponse(c, row) : null });
  }

  const body = await readBody(c);
  if (!body) return c.json({ success: false, error: "Invalid JSON body" }, 400);
  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  const amountMinor = positiveMajorToMinor(body.amount);
  if (!userId || amountMinor === null) {
    return c.json({ success: false, error: "userId and a positive two-decimal amount are required" }, 422);
  }

  const resident = await c.env.DB.prepare(
    `SELECT id FROM users
      WHERE id = ? AND institution_id = ? AND role = 'USER' AND deleted_at IS NULL LIMIT 1`,
  )
    .bind(userId, principal.institutionId)
    .first<{ id: string }>();
  if (!resident) return c.json({ success: false, error: "Resident not found" }, 404);

  const credit = await availableCredit(c, principal.institutionId, userId);
  if (amountMinor > credit.availableMinor) {
    return c.json({ success: false, error: `User only has ₹${minorToMajor(credit.availableMinor)} unreserved refundable credit` }, 422);
  }

  let billId: string | null = null;
  if (typeof body.billId === "string" && body.billId.trim()) {
    const bill = await activeBill(c, principal.institutionId, userId, body.billId.trim());
    if (!bill || bill.deleted_on || bill.purged_at || new Set(["VOID", "DELETED", "DRAFT"]).has(bill.status)) {
      return c.json({ success: false, error: "Selected refund bill is unavailable" }, 422);
    }
    if (Math.max(0, bill.paid_amount_minor - bill.total_amount_minor) < amountMinor) {
      return c.json({ success: false, error: "Selected bill does not contain enough overpayment for this refund obligation" }, 422);
    }
    billId = bill.id;
  } else {
    billId = (await overpaidBill(c, principal.institutionId, userId, amountMinor))?.id ?? null;
  }

  const methodRaw = optionalText(body.method, 32);
  const method = methodRaw && REFUND_METHODS.has(methodRaw as RefundMethod) ? methodRaw as RefundMethod : null;
  if (methodRaw && !method) return c.json({ success: false, error: "Invalid refund method" }, 422);

  const id = crypto.randomUUID();
  const refundNumber = await nextReference(c, principal.institutionId, "REF");
  const now = new Date().toISOString();
  const reason = optionalText(body.reason, 1000);
  const notes = optionalText(body.notes, 2000);
  const reference = optionalText(body.reference, 200);
  await c.env.DB.prepare(
    `INSERT INTO refunds
      (id, institution_id, refund_number, user_id, bill_id,
       amount_minor, paid_amount_minor, remaining_amount_minor, status,
       method, reference, reason, notes, idempotency_key, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'PENDING', ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id, principal.institutionId, refundNumber, userId, billId,
      amountMinor, amountMinor, method, reference, reason, notes,
      idempotencyKey, principal.id, now, now,
    )
    .run();
  await audit(c, principal, "REFUND_CREATE", "Refund", id, reason, {
    refundNumber,
    userId,
    billId,
    amountMinor,
    reservedCreditAfterMinor: credit.availableMinor - amountMinor,
  });
  const created = await loadRefund(c, principal.institutionId, id);
  return c.json({ success: true, data: created ? await refundResponse(c, created) : null }, 201);
});

refundAdjustmentRoutes.get("/refunds/:id", async (c) => {
  const principal = await principalFor(c);
  if (principal instanceof Response) return principal;
  const row = await loadRefund(c, principal.institutionId, c.req.param("id"));
  if (!row) return c.json({ success: false, error: "Refund not found" }, 404);
  return c.json({ success: true, data: await refundResponse(c, row) });
});

refundAdjustmentRoutes.post("/refunds/:id/partial", async (c) => {
  const principal = await principalFor(c);
  if (principal instanceof Response) return principal;
  const idempotencyKey = c.req.header("Idempotency-Key")?.trim();
  if (!idempotencyKey || idempotencyKey.length > 160) {
    return c.json({ success: false, error: "Idempotency-Key header is required" }, 400);
  }

  const existing = await loadRefund(c, principal.institutionId, c.req.param("id"));
  if (!existing) return c.json({ success: false, error: "Refund not found" }, 404);
  if (existing.status === "COMPLETED") return c.json({ success: false, error: "This refund is already fully completed" }, 422);
  if (existing.status === "CANCELLED") return c.json({ success: false, error: "This refund has been cancelled" }, 422);

  const replay = await c.env.DB.prepare(
    `SELECT id FROM refund_transactions
      WHERE institution_id = ? AND refund_id = ? AND idempotency_key = ? LIMIT 1`,
  )
    .bind(principal.institutionId, existing.id, idempotencyKey)
    .first<{ id: string }>();
  if (replay) {
    const current = await loadRefund(c, principal.institutionId, existing.id);
    return c.json({ success: true, data: current ? await refundResponse(c, current) : null });
  }

  const body = await readBody(c);
  if (!body) return c.json({ success: false, error: "Invalid JSON body" }, 400);
  const amountMinor = positiveMajorToMinor(body.amount);
  if (amountMinor === null) return c.json({ success: false, error: "Partial refund amount must be positive with at most two decimal places" }, 422);
  if (amountMinor > existing.remaining_amount_minor) {
    return c.json({ success: false, error: `Partial amount exceeds remaining refund balance (₹${minorToMajor(existing.remaining_amount_minor)} remaining)` }, 422);
  }

  const methodRaw = optionalText(body.method, 32);
  const method = methodRaw ? methodRaw as RefundMethod : existing.method;
  if (method && !REFUND_METHODS.has(method)) return c.json({ success: false, error: "Invalid refund method" }, 422);
  const reference = optionalText(body.reference, 200) ?? existing.reference;
  const notes = optionalText(body.notes, 2000);
  const newPaid = existing.paid_amount_minor + amountMinor;
  const newRemaining = existing.amount_minor - newPaid;
  const newStatus: RefundStatus = newRemaining === 0 ? "COMPLETED" : "PARTIALLY_PAID";
  const now = new Date().toISOString();
  const transactionId = crypto.randomUUID();
  const paymentId = crypto.randomUUID();
  const paymentIdempotency = `refund-payout:${existing.id}:${idempotencyKey}`.slice(0, 200);

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO payments
        (id, institution_id, user_id, bill_id, amount_minor, method, status,
         reference, notes, idempotency_key, approved_by, approved_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'REFUND', 'REFUNDED', ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      paymentId, principal.institutionId, existing.user_id, existing.bill_id,
      amountMinor, reference || existing.refund_number,
      notes || `Refund payout for ${existing.refund_number}`,
      paymentIdempotency, principal.id, now, now, now,
    ),
    c.env.DB.prepare(
      `INSERT INTO refund_transactions
        (id, institution_id, refund_id, amount_minor, method, reference, notes,
         processed_by, idempotency_key, payment_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      transactionId, principal.institutionId, existing.id, amountMinor, method,
      reference, notes, principal.id, idempotencyKey, paymentId, now,
    ),
    c.env.DB.prepare(
      `UPDATE refunds
          SET paid_amount_minor = ?, remaining_amount_minor = ?, status = ?,
              method = ?, reference = ?, processed_by = ?, processed_at = ?,
              completed_at = ?, updated_at = ?
        WHERE id = ? AND institution_id = ?`,
    ).bind(
      newPaid, newRemaining, newStatus, method, reference, principal.id, now,
      newStatus === "COMPLETED" ? now : null, now, existing.id, principal.institutionId,
    ),
  ]);

  await recomputeBill(c, principal.institutionId, existing.bill_id);
  await audit(
    c,
    principal,
    newStatus === "COMPLETED" ? "REFUND_COMPLETED" : "REFUND_PARTIAL_PAYMENT",
    "Refund",
    existing.id,
    notes,
    { transactionId, paymentId, amountMinor, paidAmountMinor: newPaid, remainingAmountMinor: newRemaining },
  );
  const updated = await loadRefund(c, principal.institutionId, existing.id);
  return c.json({ success: true, data: updated ? await refundResponse(c, updated) : null });
});

refundAdjustmentRoutes.post("/refunds/:id/cancel", async (c) => {
  const principal = await principalFor(c);
  if (principal instanceof Response) return principal;
  const existing = await loadRefund(c, principal.institutionId, c.req.param("id"));
  if (!existing) return c.json({ success: false, error: "Refund not found" }, 404);
  if (existing.status === "CANCELLED") return c.json({ success: true, data: await refundResponse(c, existing) });
  if (existing.status === "COMPLETED") return c.json({ success: false, error: "Completed refunds cannot be cancelled" }, 422);
  if (existing.paid_amount_minor > 0) {
    return c.json({ success: false, error: "Partially paid refunds cannot be cancelled; complete the payout or record an adjustment" }, 422);
  }
  const body = await readBody(c);
  if (!body) return c.json({ success: false, error: "Invalid JSON body" }, 400);
  const reason = optionalText(body.reason, 1000);
  if (!reason || reason.length < 5) return c.json({ success: false, error: "Cancellation reason must be at least 5 characters" }, 422);
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE refunds SET status = 'CANCELLED', reason = ?, updated_at = ?
      WHERE id = ? AND institution_id = ?`,
  )
    .bind(reason, now, existing.id, principal.institutionId)
    .run();
  await audit(c, principal, "REFUND_CANCEL", "Refund", existing.id, reason, {
    amountMinor: existing.amount_minor,
    remainingAmountMinor: existing.remaining_amount_minor,
  });
  const updated = await loadRefund(c, principal.institutionId, existing.id);
  return c.json({ success: true, data: updated ? await refundResponse(c, updated) : null });
});

refundAdjustmentRoutes.get("/adjustments", async (c) => {
  const principal = await principalFor(c);
  if (principal instanceof Response) return principal;
  const clauses = ["a.institution_id = ?"];
  const bindings: unknown[] = [principal.institutionId];
  const userId = c.req.query("userId")?.trim();
  const entityType = c.req.query("entityType")?.trim();
  const entityId = c.req.query("entityId")?.trim();
  if (userId) { clauses.push("a.user_id = ?"); bindings.push(userId); }
  if (entityType) {
    if (!ADJUSTMENT_ENTITY_TYPES.has(entityType as AdjustmentEntityType)) {
      return c.json({ success: false, error: "Invalid adjustment entity type" }, 400);
    }
    clauses.push("a.entity_type = ?"); bindings.push(entityType);
  }
  if (entityId) { clauses.push("a.entity_id = ?"); bindings.push(entityId); }
  const requestedLimit = Number(c.req.query("limit") ?? 50);
  const limit = Number.isFinite(requestedLimit) ? Math.min(200, Math.max(1, Math.trunc(requestedLimit))) : 50;
  bindings.push(limit);
  const rows = await c.env.DB.prepare(
    `SELECT a.*,
            u.name AS user_name, u.email AS user_email,
            creator.name AS creator_name, creator.email AS creator_email
       FROM adjustments a
       LEFT JOIN users u ON u.id = a.user_id AND u.institution_id = a.institution_id
       LEFT JOIN users creator ON creator.id = a.created_by AND creator.institution_id = a.institution_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY a.created_at DESC
      LIMIT ?`,
  )
    .bind(...bindings)
    .all<AdjustmentRow>();
  return c.json({ success: true, data: rows.results.map(adjustmentResponse) });
});

refundAdjustmentRoutes.post("/adjustments", async (c) => {
  const principal = await principalFor(c);
  if (principal instanceof Response) return principal;
  const idempotencyKey = c.req.header("Idempotency-Key")?.trim();
  if (!idempotencyKey || idempotencyKey.length > 200) {
    return c.json({ success: false, error: "Idempotency-Key header is required" }, 400);
  }
  const replay = await c.env.DB.prepare(
    `SELECT id FROM adjustments WHERE institution_id = ? AND idempotency_key = ? LIMIT 1`,
  )
    .bind(principal.institutionId, idempotencyKey)
    .first<{ id: string }>();
  if (replay) {
    const row = await loadAdjustment(c, principal.institutionId, replay.id);
    return c.json({ success: true, data: row ? adjustmentResponse(row) : null });
  }

  const body = await readBody(c);
  if (!body) return c.json({ success: false, error: "Invalid JSON body" }, 400);
  const entityType = typeof body.entityType === "string" ? body.entityType.trim() as AdjustmentEntityType : "" as AdjustmentEntityType;
  const entityId = typeof body.entityId === "string" ? body.entityId.trim() : "";
  const amountMinor = signedMajorToMinor(body.amount);
  const reason = optionalText(body.reason, 1000);
  if (!ADJUSTMENT_ENTITY_TYPES.has(entityType) || !entityId) {
    return c.json({ success: false, error: "A valid entityType and entityId are required" }, 422);
  }
  if (amountMinor === null) return c.json({ success: false, error: "Adjustment amount must be non-zero with at most two decimal places" }, 422);
  if (!reason || reason.length < 5) return c.json({ success: false, error: "Reason must be at least 5 characters" }, 422);

  const entity = await entityUserId(c, principal.institutionId, entityType, entityId);
  if (!entity.found) return c.json({ success: false, error: `${entityType} not found` }, 404);
  const suppliedUserId = typeof body.userId === "string" && body.userId.trim() ? body.userId.trim() : null;
  if (entity.userId && suppliedUserId && entity.userId !== suppliedUserId) {
    return c.json({ success: false, error: "Adjustment resident does not match the referenced financial entity" }, 422);
  }
  let userId = entity.userId ?? suppliedUserId;
  if (userId) {
    const resident = await c.env.DB.prepare(
      `SELECT id FROM users WHERE id = ? AND institution_id = ? AND role = 'USER' LIMIT 1`,
    )
      .bind(userId, principal.institutionId)
      .first<{ id: string }>();
    if (!resident) return c.json({ success: false, error: "Adjustment resident not found" }, 404);
    userId = resident.id;
  }

  const id = crypto.randomUUID();
  const adjustmentNumber = await nextReference(c, principal.institutionId, "ADJ");
  const notes = optionalText(body.notes, 2000);
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO adjustments
      (id, institution_id, adjustment_number, user_id, entity_type, entity_id,
       amount_minor, reason, notes, idempotency_key, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id, principal.institutionId, adjustmentNumber, userId, entityType, entityId,
      amountMinor, reason, notes, idempotencyKey, principal.id, now,
    )
    .run();
  await audit(c, principal, "ADJUSTMENT_CREATE", "Adjustment", id, reason, {
    adjustmentNumber,
    userId,
    entityType,
    entityId,
    amountMinor,
  });
  const created = await loadAdjustment(c, principal.institutionId, id);
  return c.json({ success: true, data: created ? adjustmentResponse(created) : null }, 201);
});
