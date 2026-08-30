import { Hono, type Context } from "hono";
import { authenticatedPrincipal, type AuthPrincipal } from "../auth/authorization";
import type { AppEnv } from "../types";

type ExpenseStatus = "APPROVED" | "REVERSED" | "DELETED";

type ExpenseRow = {
  id: string;
  institution_id: string;
  title: string;
  category: string;
  quantity: number;
  unit: string;
  amount_minor: number;
  currency_code: string;
  description: string | null;
  expense_date: string;
  paid_to: string | null;
  idempotency_key: string | null;
  status: ExpenseStatus;
  replaces_expense_id: string | null;
  replaced_by_expense_id: string | null;
  created_by: string;
  status_before_delete: "APPROVED" | null;
  deleted_on: string | null;
  deletion_scheduled_for: string | null;
  deleted_by: string | null;
  deletion_reason: string | null;
  purged_at: string | null;
  created_at: string;
  updated_at: string;
};

type ExpenseWithCreatorRow = ExpenseRow & {
  creator_name: string | null;
};

type ExpenseInput = {
  title: string;
  category: string;
  quantity: number;
  unit: string;
  amountMinor: number;
  description: string | null;
  expenseDate: string;
  paidTo: string | null;
};

export const expenseRoutes = new Hono<AppEnv>();

async function principalFor(c: Context<AppEnv>): Promise<AuthPrincipal | Response> {
  const principal = await authenticatedPrincipal(c);
  return principal ?? c.json({ success: false, error: "Authentication required" }, 401);
}

function minorToMajor(value: number): number {
  return Number(value || 0) / 100;
}

function majorToMinor(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  const scaled = value * 100;
  const rounded = Math.round(scaled);
  if (!Number.isSafeInteger(rounded) || Math.abs(scaled - rounded) > 1e-7) return null;
  return rounded;
}

function expenseResponse(row: ExpenseWithCreatorRow) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    quantity: row.quantity,
    unit: row.unit,
    amount: minorToMajor(row.amount_minor),
    currency: row.currency_code,
    expenseDate: row.expense_date,
    paidTo: row.paid_to,
    status: row.status,
    replacesExpenseId: row.replaces_expense_id,
    replacedByExpenseId: row.replaced_by_expense_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // Golden UI treats deletedAt as the recovery-window deadline.
    deletedAt: row.deletion_scheduled_for,
    deletionReason: row.deletion_reason,
    user: row.creator_name ? { name: row.creator_name } : null,
  };
}

async function readObjectBody(c: Context<AppEnv>): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await c.req.json();
    return typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  } catch {
    return null;
  }
}

function normalizeOptionalText(value: unknown, maxLength: number): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function parseExpenseInput(body: Record<string, unknown>): ExpenseInput | string {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const category = typeof body.category === "string" ? body.category.trim().toUpperCase() : "";
  const quantity = typeof body.quantity === "number" ? body.quantity : 1;
  const unit = typeof body.unit === "string" ? body.unit.trim() : "";
  const amountMinor = majorToMinor(body.amount);
  const expenseDateRaw = typeof body.expenseDate === "string" ? body.expenseDate.trim() : "";
  const parsedDate = new Date(expenseDateRaw);

  if (title.length < 2 || title.length > 160) return "Item name must be 2 to 160 characters";
  if (category.length < 2 || category.length > 64) return "Category must be 2 to 64 characters";
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000) return "Quantity must be positive";
  if (unit.length < 1 || unit.length > 32) return "Unit is required";
  if (amountMinor === null) return "Cost must be positive and have at most two decimal places";
  if (!expenseDateRaw || Number.isNaN(parsedDate.getTime())) return "Expense date is invalid";

  return {
    title,
    category,
    quantity,
    unit,
    amountMinor,
    description: normalizeOptionalText(body.description, 2_000),
    expenseDate: parsedDate.toISOString(),
    paidTo: normalizeOptionalText(body.paidTo, 200),
  };
}

async function institutionContext(
  c: Context<AppEnv>,
  institutionId: string,
): Promise<{ timezone: string; currencyCode: string }> {
  const row = await c.env.DB.prepare(
    `SELECT timezone, currency_code FROM institutions WHERE id = ? LIMIT 1`,
  )
    .bind(institutionId)
    .first<{ timezone: string; currency_code: string }>();
  return { timezone: row?.timezone || "UTC", currencyCode: row?.currency_code || "INR" };
}

function timezoneOffsetMinutes(timeZone: string, instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const part = (name: string) => Number(parts.find((item) => item.type === name)?.value ?? 0);
  const localAsUtc = Date.UTC(
    part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"),
  );
  return Math.round((localAsUtc - instant.getTime()) / 60_000);
}

function localMidnightUtc(year: number, month: number, day: number, timeZone: string): string {
  const wallClockUtc = Date.UTC(year, month, day, 0, 0, 0, 0);
  let candidate = new Date(wallClockUtc);
  let offset = timezoneOffsetMinutes(timeZone, candidate);
  candidate = new Date(wallClockUtc - offset * 60_000);
  const corrected = timezoneOffsetMinutes(timeZone, candidate);
  if (corrected !== offset) candidate = new Date(wallClockUtc - corrected * 60_000);
  return candidate.toISOString();
}

function periodForInstant(iso: string, timeZone: string): { month: number; year: number; key: string } {
  const instant = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(instant);
  const year = Number(parts.find((part) => part.type === "year")?.value ?? instant.getUTCFullYear());
  const monthOneBased = Number(parts.find((part) => part.type === "month")?.value ?? instant.getUTCMonth() + 1);
  return {
    month: monthOneBased - 1,
    year,
    key: `${year}-${String(monthOneBased).padStart(2, "0")}`,
  };
}

function isValidPeriod(month: number, year: number): boolean {
  return Number.isInteger(month) && month >= 0 && month <= 11 && Number.isInteger(year) && year >= 2000 && year <= 9999;
}

async function requireOpenExpensePeriod(
  c: Context<AppEnv>,
  institutionId: string,
  expenseDate: string,
  timeZone: string,
): Promise<Response | null> {
  const period = periodForInstant(expenseDate, timeZone);
  const row = await c.env.DB.prepare(
    `SELECT status FROM accounting_periods WHERE institution_id = ? AND period_key = ? LIMIT 1`,
  )
    .bind(institutionId, period.key)
    .first<{ status: string }>();
  if (row?.status !== "OPEN") {
    return c.json(
      { success: false, error: `Expense period ${period.key} is not open` },
      422,
    );
  }
  return null;
}

async function markExpiredDeletionQueue(c: Context<AppEnv>, institutionId: string, nowIso: string) {
  await c.env.DB.prepare(
    `UPDATE expenses
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

async function loadExpense(
  c: Context<AppEnv>,
  principal: AuthPrincipal,
  expenseId: string,
): Promise<ExpenseWithCreatorRow | null> {
  return c.env.DB.prepare(
    `SELECT e.*, u.name AS creator_name
       FROM expenses e
       LEFT JOIN users u ON u.id = e.created_by
      WHERE e.id = ? AND e.institution_id = ?
      LIMIT 1`,
  )
    .bind(expenseId, principal.institutionId)
    .first<ExpenseWithCreatorRow>();
}

async function loadByIdempotencyKey(
  c: Context<AppEnv>,
  principal: AuthPrincipal,
  key: string,
): Promise<ExpenseWithCreatorRow | null> {
  return c.env.DB.prepare(
    `SELECT e.*, u.name AS creator_name
       FROM expenses e
       LEFT JOIN users u ON u.id = e.created_by
      WHERE e.institution_id = ? AND e.created_by = ? AND e.idempotency_key = ?
      LIMIT 1`,
  )
    .bind(principal.institutionId, principal.id, key)
    .first<ExpenseWithCreatorRow>();
}

async function audit(
  c: Context<AppEnv>,
  principal: AuthPrincipal,
  action: string,
  entityId: string,
  reason: string | null,
  metadata: Record<string, unknown>,
) {
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO audit_events
      (id, institution_id, actor_user_id, action, entity_type, entity_id,
       request_id, reason, metadata_json, created_at)
     VALUES (?, ?, ?, ?, 'Expense', ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(), principal.institutionId, principal.id, action, entityId,
      c.get("requestId"), reason, JSON.stringify(metadata), now,
    )
    .run();
}

expenseRoutes.get("/expenses", async (c) => {
  const principal = await principalFor(c);
  if (principal instanceof Response) return principal;

  const institution = await institutionContext(c, principal.institutionId);
  const now = new Date();
  await markExpiredDeletionQueue(c, principal.institutionId, now.toISOString());

  const url = new URL(c.req.url);
  const monthRaw = url.searchParams.get("month");
  const yearRaw = url.searchParams.get("year");
  const current = periodForInstant(now.toISOString(), institution.timezone);
  const month = monthRaw == null ? current.month : Number(monthRaw);
  const year = yearRaw == null ? current.year : Number(yearRaw);
  if (!isValidPeriod(month, year)) {
    return c.json({ success: false, error: "Invalid month/year" }, 400);
  }

  const requestedLimit = Number(url.searchParams.get("limit") ?? 200);
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 500) : 200;
  const includeDeleted = url.searchParams.get("includeDeleted") === "true";
  const category = url.searchParams.get("category")?.trim().toUpperCase() || null;
  const start = localMidnightUtc(year, month, 1, institution.timezone);
  const next = month === 11
    ? localMidnightUtc(year + 1, 0, 1, institution.timezone)
    : localMidnightUtc(year, month + 1, 1, institution.timezone);

  const clauses = ["e.institution_id = ?", "e.expense_date >= ?", "e.expense_date < ?"];
  const bindings: unknown[] = [principal.institutionId, start, next];
  if (includeDeleted) {
    clauses.push("e.status = 'DELETED'", "e.purged_at IS NULL");
  } else {
    clauses.push("e.status = 'APPROVED'", "e.purged_at IS NULL");
  }
  if (category) {
    clauses.push("e.category = ?");
    bindings.push(category);
  }
  bindings.push(limit);

  const rows = await c.env.DB.prepare(
    `SELECT e.*, u.name AS creator_name
       FROM expenses e
       LEFT JOIN users u ON u.id = e.created_by
      WHERE ${clauses.join(" AND ")}
      ORDER BY e.expense_date DESC, e.created_at DESC
      LIMIT ?`,
  )
    .bind(...bindings)
    .all<ExpenseWithCreatorRow>();

  return c.json({ success: true, data: rows.results.map(expenseResponse) });
});

expenseRoutes.get("/expenses/:id", async (c) => {
  const principal = await principalFor(c);
  if (principal instanceof Response) return principal;
  const row = await loadExpense(c, principal, c.req.param("id"));
  if (!row || row.purged_at) return c.json({ success: false, error: "Expense not found" }, 404);
  if (principal.role === "USER" && row.status !== "APPROVED") {
    return c.json({ success: false, error: "Expense not found" }, 404);
  }
  return c.json({ success: true, data: expenseResponse(row) });
});

expenseRoutes.post("/expenses", async (c) => {
  const principal = await principalFor(c);
  if (principal instanceof Response) return principal;
  const idempotencyKey = c.req.header("Idempotency-Key")?.trim();
  if (!idempotencyKey || idempotencyKey.length > 200) {
    return c.json({ success: false, error: "Idempotency-Key header is required" }, 400);
  }

  const replay = await loadByIdempotencyKey(c, principal, idempotencyKey);
  if (replay) return c.json({ success: true, data: expenseResponse(replay) }, 200);

  const body = await readObjectBody(c);
  if (!body) return c.json({ success: false, error: "Invalid JSON body" }, 400);
  const parsed = parseExpenseInput(body);
  if (typeof parsed === "string") return c.json({ success: false, error: parsed }, 422);

  const institution = await institutionContext(c, principal.institutionId);
  const periodError = await requireOpenExpensePeriod(
    c, principal.institutionId, parsed.expenseDate, institution.timezone,
  );
  if (periodError) return periodError;

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO expenses (
       id, institution_id, title, category, quantity, unit, amount_minor,
       currency_code, description, expense_date, paid_to, idempotency_key,
       status, created_by, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'APPROVED', ?, ?, ?)`,
  )
    .bind(
      id, principal.institutionId, parsed.title, parsed.category, parsed.quantity,
      parsed.unit, parsed.amountMinor, institution.currencyCode, parsed.description,
      parsed.expenseDate, parsed.paidTo, idempotencyKey, principal.id, now, now,
    )
    .run();

  await audit(c, principal, "EXPENSE_CREATE", id, null, {
    amountMinor: parsed.amountMinor,
    category: parsed.category,
    expenseDate: parsed.expenseDate,
  });
  const created = await loadExpense(c, principal, id);
  return c.json({ success: true, data: expenseResponse(created!) }, 201);
});

expenseRoutes.put("/expenses/:id", async (c) => {
  const principal = await principalFor(c);
  if (principal instanceof Response) return principal;
  const idempotencyKey = c.req.header("Idempotency-Key")?.trim();
  if (!idempotencyKey || idempotencyKey.length > 200) {
    return c.json({ success: false, error: "Idempotency-Key header is required" }, 400);
  }

  const replay = await loadByIdempotencyKey(c, principal, idempotencyKey);
  if (replay) return c.json({ success: true, data: expenseResponse(replay) }, 200);

  const existing = await loadExpense(c, principal, c.req.param("id"));
  if (!existing || existing.purged_at) return c.json({ success: false, error: "Expense not found" }, 404);
  if (existing.status === "DELETED") {
    return c.json({ success: false, error: "Expense is scheduled for deletion" }, 422);
  }
  if (existing.status === "REVERSED") {
    return c.json({ success: false, error: "Expense has already been replaced" }, 422);
  }

  const body = await readObjectBody(c);
  if (!body) return c.json({ success: false, error: "Invalid JSON body" }, 400);
  const parsed = parseExpenseInput(body);
  if (typeof parsed === "string") return c.json({ success: false, error: parsed }, 422);

  const institution = await institutionContext(c, principal.institutionId);
  const oldPeriodError = await requireOpenExpensePeriod(
    c, principal.institutionId, existing.expense_date, institution.timezone,
  );
  if (oldPeriodError) return oldPeriodError;
  const newPeriodError = await requireOpenExpensePeriod(
    c, principal.institutionId, parsed.expenseDate, institution.timezone,
  );
  if (newPeriodError) return newPeriodError;

  const replacementId = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO expenses (
         id, institution_id, title, category, quantity, unit, amount_minor,
         currency_code, description, expense_date, paid_to, idempotency_key,
         status, replaces_expense_id, created_by, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'APPROVED', ?, ?, ?, ?)`,
    ).bind(
      replacementId, principal.institutionId, parsed.title, parsed.category,
      parsed.quantity, parsed.unit, parsed.amountMinor, institution.currencyCode,
      parsed.description, parsed.expenseDate, parsed.paidTo, idempotencyKey,
      existing.id, principal.id, now, now,
    ),
    c.env.DB.prepare(
      `UPDATE expenses
          SET status = 'REVERSED', replaced_by_expense_id = ?, updated_at = ?
        WHERE id = ? AND institution_id = ? AND status = 'APPROVED'`,
    ).bind(replacementId, now, existing.id, principal.institutionId),
  ]);

  await audit(c, principal, "EXPENSE_REPLACE", existing.id, null, {
    replacementExpenseId: replacementId,
    oldAmountMinor: existing.amount_minor,
    newAmountMinor: parsed.amountMinor,
  });
  const replacement = await loadExpense(c, principal, replacementId);
  return c.json({ success: true, data: expenseResponse(replacement!) });
});

expenseRoutes.delete("/expenses/:id", async (c) => {
  const principal = await principalFor(c);
  if (principal instanceof Response) return principal;
  const existing = await loadExpense(c, principal, c.req.param("id"));
  if (!existing || existing.purged_at) return c.json({ success: false, error: "Expense not found" }, 404);
  if (existing.status === "REVERSED") {
    return c.json({ success: false, error: "Replaced expense history cannot be deleted" }, 422);
  }
  if (existing.status === "DELETED") {
    return c.json({
      success: true,
      data: { id: existing.id, permanentDeletion: existing.deletion_scheduled_for },
    });
  }

  const institution = await institutionContext(c, principal.institutionId);
  const periodError = await requireOpenExpensePeriod(
    c, principal.institutionId, existing.expense_date, institution.timezone,
  );
  if (periodError) return periodError;

  const body = await readObjectBody(c).catch(() => ({}));
  const reason = body ? normalizeOptionalText(body.reason, 500) : null;
  const deletedOn = new Date();
  const scheduledFor = new Date(deletedOn.getTime() + 7 * 24 * 60 * 60 * 1000);
  const now = deletedOn.toISOString();
  await c.env.DB.prepare(
    `UPDATE expenses
        SET status = 'DELETED', status_before_delete = 'APPROVED', deleted_on = ?,
            deletion_scheduled_for = ?, deleted_by = ?, deletion_reason = ?, updated_at = ?
      WHERE id = ? AND institution_id = ? AND status = 'APPROVED'`,
  )
    .bind(
      now, scheduledFor.toISOString(), principal.id, reason, now,
      existing.id, principal.institutionId,
    )
    .run();
  await audit(c, principal, "EXPENSE_SOFT_DELETE", existing.id, reason, {
    deletionScheduledFor: scheduledFor.toISOString(),
  });
  const deleted = await loadExpense(c, principal, existing.id);
  return c.json({ success: true, data: expenseResponse(deleted!) });
});

expenseRoutes.post("/expenses/:id/restore", async (c) => {
  const principal = await principalFor(c);
  if (principal instanceof Response) return principal;
  const existing = await loadExpense(c, principal, c.req.param("id"));
  if (!existing) return c.json({ success: false, error: "Expense not found" }, 404);
  if (existing.status === "APPROVED" && !existing.purged_at) {
    return c.json({ success: true, data: expenseResponse(existing) });
  }
  if (existing.status !== "DELETED") {
    return c.json({ success: false, error: "Expense is not restorable" }, 422);
  }
  if (existing.purged_at || !existing.deletion_scheduled_for || existing.deletion_scheduled_for <= new Date().toISOString()) {
    return c.json({ success: false, error: "Expense recovery window has expired" }, 410);
  }

  const institution = await institutionContext(c, principal.institutionId);
  const periodError = await requireOpenExpensePeriod(
    c, principal.institutionId, existing.expense_date, institution.timezone,
  );
  if (periodError) return periodError;

  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE expenses
        SET status = 'APPROVED', status_before_delete = NULL, deleted_on = NULL,
            deletion_scheduled_for = NULL, deleted_by = NULL, deletion_reason = NULL,
            updated_at = ?
      WHERE id = ? AND institution_id = ? AND status = 'DELETED' AND purged_at IS NULL`,
  )
    .bind(now, existing.id, principal.institutionId)
    .run();
  await audit(c, principal, "EXPENSE_RESTORE", existing.id, null, {});
  const restored = await loadExpense(c, principal, existing.id);
  return c.json({ success: true, data: expenseResponse(restored!) });
});
