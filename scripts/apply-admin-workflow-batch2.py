from pathlib import Path
import re

ROOT = Path('.')


def read(path: str) -> str:
    return (ROOT / path).read_text()


def write(path: str, text: str) -> None:
    (ROOT / path).write_text(text)


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    if text.count(old) != 1:
        raise SystemExit(f'{path}: expected exactly one fragment, found {text.count(old)}: {old[:120]!r}')
    write(path, text.replace(old, new, 1))


def replace_all(path: str, old: str, new: str, minimum: int = 1) -> None:
    text = read(path)
    count = text.count(old)
    if count < minimum:
        raise SystemExit(f'{path}: expected >= {minimum} fragment(s), found {count}: {old[:120]!r}')
    write(path, text.replace(old, new))


def regex_once(path: str, pattern: str, repl: str) -> None:
    text = read(path)
    updated, count = re.subn(pattern, repl, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f'{path}: regex expected one match, found {count}: {pattern[:140]!r}')
    write(path, updated)


# -----------------------------------------------------------------------------
# User Management: Total Users = non-pending residents only; direct admin 360
# is rejected as a second, server-side guard.
# -----------------------------------------------------------------------------
users = 'apps/web/src/components/features/users/users-view.tsx'
replace_once(
    users,
    '''  const kpis = useMemo(() => {
    // Pending registrations are not institution members yet, regardless of the
    // role requested/assigned during review.
    const total = users.filter((u) => !u.deletedAt && u.status !== "PENDING" && u.status !== "ARCHIVED").length;
    // Active/Pending/Suspended exclude admins — these are resident-facing metrics
    const residents = users.filter((u) => u.role !== "ADMIN" && u.role !== "SUPER_ADMIN");
    const active = residents.filter((u) => u.status === "ACTIVE" && !u.deletedAt).length;''',
    '''  const kpis = useMemo(() => {
    // Membership KPIs are resident-only. Pending registrations and every
    // administrator role are excluded from Total Users.
    const residents = users.filter((u) => u.role !== "ADMIN" && u.role !== "SUPER_ADMIN");
    const total = residents.filter((u) => !u.deletedAt && u.status !== "PENDING" && u.status !== "ARCHIVED").length;
    const active = residents.filter((u) => u.status === "ACTIVE" && !u.deletedAt).length;'''
)
replace_once(
    users,
    '''    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["users", { search, status }], ctx.prev);
      toast.error("Action failed");
    },''',
    '''    onError: (e: Error, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["users", { search, status }], ctx.prev);
      toast.error(e.message || "Action failed");
    },'''
)

user360 = 'services/api/src/routes/user-360.ts'
replace_once(
    user360,
    '''  if (!user) return c.json({ success: false, error: "User not found" }, 404);

  const current = currentPeriodInTimeZone(user.institution_timezone || "UTC");''',
    '''  if (!user) return c.json({ success: false, error: "User not found" }, 404);
  if (user.role !== "USER") {
    return c.json({
      success: false,
      error: "Resident 360° is available only for resident accounts. Administrators do not have a resident Fund Account.",
    }, 422);
  }

  const current = currentPeriodInTimeZone(user.institution_timezone || "UTC");'''
)

# -----------------------------------------------------------------------------
# Payments: a direct Pay Refund call must satisfy the same CLOSED-cycle,
# generated-bill overpayment invariant as the candidate list.
# -----------------------------------------------------------------------------
refunds = 'services/api/src/routes/refunds-adjustments.ts'
replace_once(
    refunds,
    '''  } else {
    billId = (await overpaidBill(c, principal.institutionId, userId, amountMinor))?.id ?? null;
  }

  const headerKey = c.req.header("Idempotency-Key")?.trim().slice(0, 200) || null;''',
    '''  } else {
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

  const headerKey = c.req.header("Idempotency-Key")?.trim().slice(0, 200) || null;'''
)

# -----------------------------------------------------------------------------
# Migration 0028: fixed/formula meal pricing plus durable deletion queue.
# Historical meal rows are never physically deleted; finalization hides them
# after the next month's generated bills are fully settled/refunded.
# -----------------------------------------------------------------------------
migration = ROOT / 'migrations/0028_meal_pricing_deletion_queue.sql'
if migration.exists():
    raise SystemExit('0028 migration already exists')
migration.write_text('''-- Meal pricing modes and settlement-gated configuration deletion queue.\nPRAGMA foreign_keys = ON;\n\nALTER TABLE meal_configurations ADD COLUMN pricing_mode TEXT NOT NULL DEFAULT 'FORMULA'\n  CHECK (pricing_mode IN ('FORMULA', 'FIXED'));\nALTER TABLE meal_configurations ADD COLUMN fixed_price_minor INTEGER\n  CHECK (fixed_price_minor IS NULL OR (typeof(fixed_price_minor) = 'integer' AND fixed_price_minor > 0));\nALTER TABLE meal_configurations ADD COLUMN deletion_requested_at TEXT;\nALTER TABLE meal_configurations ADD COLUMN deletion_eligible_month INTEGER\n  CHECK (deletion_eligible_month IS NULL OR deletion_eligible_month BETWEEN 0 AND 11);\nALTER TABLE meal_configurations ADD COLUMN deletion_eligible_year INTEGER\n  CHECK (deletion_eligible_year IS NULL OR deletion_eligible_year >= 2000);\nALTER TABLE meal_configurations ADD COLUMN deletion_requested_by TEXT;\nALTER TABLE meal_configurations ADD COLUMN deletion_finalized_at TEXT;\n\nCREATE INDEX meal_configurations_deletion_queue_idx\n  ON meal_configurations(\n    institution_id, deletion_finalized_at, deletion_eligible_year, deletion_eligible_month\n  )\n  WHERE deletion_requested_at IS NOT NULL;\n\n-- Configuration removal is now an application-owned settlement-gated queue.\n-- Keep every historical row for bill/snapshot/meal-entry referential integrity.\nDROP TRIGGER IF EXISTS meal_configurations_preserve_evidence_delete;\nDROP TRIGGER IF EXISTS meal_configurations_block_hard_delete;\nCREATE TRIGGER meal_configurations_block_hard_delete\nBEFORE DELETE ON meal_configurations\nBEGIN\n  SELECT RAISE(ABORT, 'meal configurations are historical records; use the deletion queue');\nEND;\n''')

# -----------------------------------------------------------------------------
# Canonical Meal Configuration API rewrite.
# -----------------------------------------------------------------------------
meal_api = r'''import { Hono, type Context } from "hono";
import { authenticatedPrincipal, type AuthPrincipal } from "../auth/authorization";
import type { AppEnv } from "../types";

const MEAL_TYPES = new Set(["REGULAR", "SPECIAL", "GUEST_ONLY", "FESTIVAL", "CUSTOM"]);
const MEAL_STATUSES = new Set(["ACTIVE", "INACTIVE", "ARCHIVED"]);
const DEFAULT_STATES = new Set(["ON", "OFF"]);
const VISIBILITIES = new Set(["VISIBLE", "HIDDEN"]);
const CUTOFF_STRATEGIES = new Set(["PREVIOUS_DAY", "SAME_DAY", "CUSTOM_OFFSET"]);
const PRICING_MODES = new Set(["FORMULA", "FIXED"]);
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
const COLOR_RE = /^#[0-9a-f]{6}$/iu;

type MealRow = {
  id: string;
  institution_id: string;
  name: string;
  display_name: string;
  description: string | null;
  icon: string;
  color: string;
  meal_type: string;
  status: string;
  display_order: number;
  default_state: string;
  default_visibility: string;
  cutoff_strategy: string;
  cutoff_offset_minutes: number;
  cutoff_time: string;
  start_time: string;
  end_time: string;
  pricing_mode: "FORMULA" | "FIXED";
  fixed_price_minor: number | null;
  deletion_requested_at: string | null;
  deletion_eligible_month: number | null;
  deletion_eligible_year: number | null;
  deletion_requested_by: string | null;
  deletion_finalized_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type MealValues = {
  name: string;
  displayName: string;
  description: string | null;
  icon: string;
  color: string;
  mealType: string;
  status: string;
  displayOrder: number;
  defaultState: string;
  defaultVisibility: string;
  cutoffStrategy: string;
  cutoffOffsetMinutes: number;
  cutoffTime: string;
  startTime: string;
  endTime: string;
  pricingMode: "FORMULA" | "FIXED";
  fixedPriceMinor: number | null;
  notes: string | null;
};

type QueueRow = {
  id: string;
  deletion_eligible_month: number;
  deletion_eligible_year: number;
};

type SettlementRow = {
  due_minor: number | null;
  overpaid_minor: number | null;
  refund_minor: number | null;
};

export const mealConfigRoutes = new Hono<AppEnv>();

function minorToMajor(value: number | null): number | null {
  return value == null ? null : value / 100;
}

function majorToMinor(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  const scaled = value * 100;
  const rounded = Math.round(scaled);
  if (!Number.isSafeInteger(rounded) || Math.abs(scaled - rounded) > 1e-7) return null;
  return rounded;
}

function internalNameFromDisplayName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .replace(/_+/gu, "_")
    .slice(0, 80);
}

function mappedMeal(row: MealRow) {
  return {
    id: row.id,
    name: row.name,
    displayName: row.display_name,
    description: row.description,
    icon: row.icon,
    color: row.color,
    mealType: row.meal_type,
    status: row.status,
    displayOrder: row.display_order,
    defaultState: row.default_state,
    defaultVisibility: row.default_visibility,
    cutoffStrategy: row.cutoff_strategy,
    cutoffOffsetMinutes: row.cutoff_offset_minutes,
    cutoffTime: row.cutoff_time,
    startTime: row.start_time,
    endTime: row.end_time,
    pricingMode: row.pricing_mode,
    fixedPrice: minorToMajor(row.fixed_price_minor),
    deletionRequestedAt: row.deletion_requested_at,
    deletionEligibleMonth: row.deletion_eligible_month,
    deletionEligibleYear: row.deletion_eligible_year,
    deletionFinalizedAt: row.deletion_finalized_at,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function readBody(c: Context<AppEnv>): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await c.req.json();
    return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  } catch {
    return null;
  }
}

function stringValue(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === "string" ? value.trim() : undefined;
}

function nullableString(body: Record<string, unknown>, key: string): string | null | undefined {
  if (!(key in body)) return undefined;
  const value = body[key];
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || null;
}

function integerValue(body: Record<string, unknown>, key: string): number | undefined {
  const value = body[key];
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function validateMealBody(
  body: Record<string, unknown>,
  existing?: MealRow,
): { values?: MealValues; error?: string } {
  const displayName = stringValue(body, "displayName") ?? existing?.display_name;
  const generatedName = displayName ? internalNameFromDisplayName(displayName) : "";
  const name = existing?.name ?? stringValue(body, "name") ?? generatedName;
  const description = nullableString(body, "description");
  const icon = stringValue(body, "icon") ?? existing?.icon ?? "🍽️";
  const color = stringValue(body, "color") ?? existing?.color ?? "#8b5cf6";
  const mealType = stringValue(body, "mealType") ?? existing?.meal_type;
  const status = stringValue(body, "status") ?? existing?.status ?? "ACTIVE";
  const displayOrder = integerValue(body, "displayOrder") ?? existing?.display_order;
  const defaultState = stringValue(body, "defaultState") ?? existing?.default_state ?? "OFF";
  const defaultVisibility = stringValue(body, "defaultVisibility") ?? existing?.default_visibility ?? "VISIBLE";
  const cutoffStrategy = stringValue(body, "cutoffStrategy") ?? existing?.cutoff_strategy;
  const cutoffOffsetMinutes = integerValue(body, "cutoffOffsetMinutes") ?? existing?.cutoff_offset_minutes ?? 0;
  const cutoffTime = stringValue(body, "cutoffTime") ?? existing?.cutoff_time;
  const startTime = stringValue(body, "startTime") ?? existing?.start_time;
  const endTime = stringValue(body, "endTime") ?? existing?.end_time;
  const pricingRaw = stringValue(body, "pricingMode") ?? existing?.pricing_mode ?? "FORMULA";
  const pricingMode = pricingRaw as "FORMULA" | "FIXED";
  const fixedPriceMinor = pricingMode === "FIXED"
    ? (body.fixedPrice === undefined && existing?.pricing_mode === "FIXED"
      ? existing.fixed_price_minor
      : majorToMinor(body.fixedPrice))
    : null;
  const notes = nullableString(body, "notes");

  if (!displayName || displayName.length < 2 || displayName.length > 100) {
    return { error: "Display name must be 2–100 characters" };
  }
  if (!name || name.length < 2 || name.length > 80) return { error: "Display name must produce a valid internal name" };
  if (!/^[a-z0-9][a-z0-9_]*$/u.test(name)) {
    return { error: "Internal name must be generated from letters and numbers" };
  }
  if (icon.length > 16) return { error: "Meal icon is too long" };
  if (!COLOR_RE.test(color)) return { error: "Meal color must be a six-digit hex color" };
  if (!mealType || !MEAL_TYPES.has(mealType)) return { error: "Meal type is required" };
  if (!MEAL_STATUSES.has(status)) return { error: "Invalid meal status" };
  if (!DEFAULT_STATES.has(defaultState)) return { error: "Invalid default state" };
  if (!VISIBILITIES.has(defaultVisibility)) return { error: "Invalid default visibility" };
  if (!cutoffStrategy || !CUTOFF_STRATEGIES.has(cutoffStrategy)) return { error: "Cutoff strategy is required" };
  if (displayOrder === undefined || displayOrder < 0 || displayOrder > 10_000) return { error: "Display order is out of range" };
  if (cutoffOffsetMinutes < 0 || cutoffOffsetMinutes > 1440) return { error: "Cutoff offset is out of range" };
  if (!cutoffTime || !TIME_RE.test(cutoffTime)) return { error: "Cutoff time is required" };
  if (!startTime || !TIME_RE.test(startTime) || !endTime || !TIME_RE.test(endTime)) {
    return { error: "Service start and end times are required" };
  }
  if (!PRICING_MODES.has(pricingMode)) return { error: "Invalid meal pricing mode" };
  if (pricingMode === "FIXED" && (fixedPriceMinor === null || fixedPriceMinor <= 0)) {
    return { error: "Fixed price must be a positive amount with at most two decimal places" };
  }
  if ((description?.length ?? 0) > 500) return { error: "Description is too long" };
  if ((notes?.length ?? 0) > 1000) return { error: "Notes are too long" };

  return {
    values: {
      name,
      displayName,
      description: description === undefined ? existing?.description ?? null : description,
      icon,
      color,
      mealType,
      status,
      displayOrder,
      defaultState,
      defaultVisibility,
      cutoffStrategy,
      cutoffOffsetMinutes,
      cutoffTime,
      startTime,
      endTime,
      pricingMode,
      fixedPriceMinor,
      notes: notes === undefined ? existing?.notes ?? null : notes,
    },
  };
}

const MEAL_SELECT = `id, institution_id, name, display_name, description, icon, color,
                     meal_type, status, display_order, default_state, default_visibility,
                     cutoff_strategy, cutoff_offset_minutes, cutoff_time, start_time,
                     end_time, pricing_mode, fixed_price_minor, deletion_requested_at,
                     deletion_eligible_month, deletion_eligible_year, deletion_requested_by,
                     deletion_finalized_at, notes, created_at, updated_at`;

async function mealById(c: Context<AppEnv>, principal: AuthPrincipal, id: string): Promise<MealRow | null> {
  return c.env.DB.prepare(
    `SELECT ${MEAL_SELECT}
       FROM meal_configurations
      WHERE id = ? AND institution_id = ? AND deletion_finalized_at IS NULL
      LIMIT 1`,
  ).bind(id, principal.institutionId).first<MealRow>();
}

async function writeAudit(
  c: Context<AppEnv>,
  principal: AuthPrincipal,
  action: string,
  mealId: string,
  metadata: Record<string, unknown>,
) {
  await c.env.DB.prepare(
    `INSERT INTO audit_events
      (id, institution_id, actor_user_id, action, entity_type, entity_id,
       request_id, reason, metadata_json, created_at)
     VALUES (?, ?, ?, ?, 'MealConfiguration', ?, ?, NULL, ?, ?)`,
  ).bind(
    crypto.randomUUID(), principal.institutionId, principal.id, action, mealId,
    c.get("requestId"), JSON.stringify(metadata), new Date().toISOString(),
  ).run();
}

async function institutionTimezone(c: Context<AppEnv>, institutionId: string): Promise<string> {
  const row = await c.env.DB.prepare("SELECT timezone FROM institutions WHERE id = ? LIMIT 1")
    .bind(institutionId).first<{ timezone: string }>();
  return row?.timezone || "UTC";
}

function currentPeriodInTimeZone(timeZone: string): { month: number; year: number } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit",
  }).formatToParts(now);
  return {
    year: Number(parts.find((part) => part.type === "year")?.value ?? now.getUTCFullYear()),
    month: Number(parts.find((part) => part.type === "month")?.value ?? now.getUTCMonth() + 1) - 1,
  };
}

function nextPeriod(period: { month: number; year: number }): { month: number; year: number } {
  return period.month === 11
    ? { month: 0, year: period.year + 1 }
    : { month: period.month + 1, year: period.year };
}

async function finalizeEligibleDeletionQueue(c: Context<AppEnv>, principal: AuthPrincipal): Promise<void> {
  const queued = await c.env.DB.prepare(
    `SELECT id, deletion_eligible_month, deletion_eligible_year
       FROM meal_configurations
      WHERE institution_id = ?
        AND deletion_requested_at IS NOT NULL
        AND deletion_finalized_at IS NULL
        AND deletion_eligible_month IS NOT NULL
        AND deletion_eligible_year IS NOT NULL`,
  ).bind(principal.institutionId).all<QueueRow>();

  for (const meal of queued.results) {
    const cycle = await c.env.DB.prepare(
      `SELECT id FROM billing_cycles
        WHERE institution_id = ? AND period_month = ? AND period_year = ?
          AND status = 'CLOSED' LIMIT 1`,
    ).bind(
      principal.institutionId, meal.deletion_eligible_month, meal.deletion_eligible_year,
    ).first<{ id: string }>();
    if (!cycle) continue;

    const settlement = await c.env.DB.prepare(
      `SELECT
         (SELECT COALESCE(SUM(b.due_amount_minor), 0)
            FROM bills b
           WHERE b.institution_id = ? AND b.period_month = ? AND b.period_year = ?
             AND b.deleted_on IS NULL AND b.purged_at IS NULL
             AND b.status NOT IN ('DRAFT', 'VOID', 'DELETED')) AS due_minor,
         (SELECT COALESCE(SUM(CASE
                    WHEN b.paid_amount_minor > b.total_amount_minor
                    THEN b.paid_amount_minor - b.total_amount_minor ELSE 0 END), 0)
            FROM bills b
           WHERE b.institution_id = ? AND b.period_month = ? AND b.period_year = ?
             AND b.deleted_on IS NULL AND b.purged_at IS NULL
             AND b.status NOT IN ('DRAFT', 'VOID', 'DELETED')) AS overpaid_minor,
         (SELECT COALESCE(SUM(r.remaining_amount_minor), 0)
            FROM refunds r
            JOIN bills b ON b.id = r.bill_id AND b.institution_id = r.institution_id
           WHERE r.institution_id = ? AND b.period_month = ? AND b.period_year = ?
             AND r.status IN ('PENDING', 'PARTIALLY_PAID')) AS refund_minor`,
    ).bind(
      principal.institutionId, meal.deletion_eligible_month, meal.deletion_eligible_year,
      principal.institutionId, meal.deletion_eligible_month, meal.deletion_eligible_year,
      principal.institutionId, meal.deletion_eligible_month, meal.deletion_eligible_year,
    ).first<SettlementRow>();

    if (
      Number(settlement?.due_minor ?? 0) !== 0
      || Number(settlement?.overpaid_minor ?? 0) !== 0
      || Number(settlement?.refund_minor ?? 0) !== 0
    ) continue;

    const finalizedAt = new Date().toISOString();
    const result = await c.env.DB.prepare(
      `UPDATE meal_configurations
          SET deletion_finalized_at = ?, status = 'ARCHIVED', updated_at = ?
        WHERE id = ? AND institution_id = ? AND deletion_finalized_at IS NULL`,
    ).bind(finalizedAt, finalizedAt, meal.id, principal.institutionId).run();
    if (Number(result.meta.changes ?? 0) > 0) {
      await writeAudit(c, principal, "MEAL_CONFIGURATION_DELETION_FINALIZED", meal.id, {
        eligibleMonth: meal.deletion_eligible_month,
        eligibleYear: meal.deletion_eligible_year,
        settlement: { dueMinor: 0, overpaidMinor: 0, refundMinor: 0 },
      });
    }
  }
}

async function configurationCount(c: Context<AppEnv>, institutionId: string): Promise<number> {
  const row = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count FROM meal_configurations
      WHERE institution_id = ? AND deletion_finalized_at IS NULL`,
  ).bind(institutionId).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

async function duplicateMeal(
  c: Context<AppEnv>,
  institutionId: string,
  name: string,
  displayName: string,
  excludeId?: string,
): Promise<boolean> {
  const row = await c.env.DB.prepare(
    `SELECT id FROM meal_configurations
      WHERE institution_id = ?
        AND (lower(name) = lower(?) OR lower(display_name) = lower(?))
        AND (? IS NULL OR id <> ?)
      LIMIT 1`,
  ).bind(institutionId, name, displayName, excludeId ?? null, excludeId ?? null).first<{ id: string }>();
  return !!row;
}

mealConfigRoutes.get("/meals/config", async (c) => {
  const principal = await authenticatedPrincipal(c);
  if (!principal) return c.json({ success: false, error: "Authentication required" }, 401);

  const canSeeNonActive = principal.role === "ADMIN" || principal.role === "SUPER_ADMIN";
  if (canSeeNonActive) await finalizeEligibleDeletionQueue(c, principal);

  const rows = await c.env.DB.prepare(
    `SELECT ${MEAL_SELECT}
       FROM meal_configurations
      WHERE institution_id = ?
        AND deletion_finalized_at IS NULL
        AND (? = 1 OR status = 'ACTIVE')
      ORDER BY
        CASE status WHEN 'ACTIVE' THEN 0 WHEN 'INACTIVE' THEN 1 ELSE 2 END,
        display_order ASC, created_at ASC`,
  ).bind(principal.institutionId, canSeeNonActive ? 1 : 0).all<MealRow>();

  return c.json({ success: true, data: rows.results.map(mappedMeal) });
});

mealConfigRoutes.get("/meals/config/:id", async (c) => {
  const principal = await authenticatedPrincipal(c);
  if (!principal) return c.json({ success: false, error: "Authentication required" }, 401);

  const meal = await mealById(c, principal, c.req.param("id"));
  if (!meal) return c.json({ success: false, error: "Meal not found" }, 404);
  if (meal.status !== "ACTIVE" && principal.role !== "ADMIN" && principal.role !== "SUPER_ADMIN") {
    return c.json({ success: false, error: "Meal not found" }, 404);
  }
  return c.json({ success: true, data: mappedMeal(meal) });
});

mealConfigRoutes.post("/meals/config", async (c) => {
  const principal = await authenticatedPrincipal(c);
  if (!principal) return c.json({ success: false, error: "Authentication required" }, 401);

  const body = await readBody(c);
  if (!body) return c.json({ success: false, error: "Invalid JSON body" }, 400);
  const displayName = stringValue(body, "displayName") ?? "";
  const name = internalNameFromDisplayName(displayName);
  const count = await configurationCount(c, principal.institutionId);
  const requestedOrder = integerValue(body, "displayOrder");
  const displayOrder = requestedOrder === undefined ? count : requestedOrder;
  if (displayOrder < 0 || displayOrder > count) {
    return c.json({ success: false, error: `Display order must be between 0 and ${count}` }, 422);
  }

  const parsed = validateMealBody({ ...body, name, displayOrder, status: "ACTIVE" });
  if (!parsed.values) return c.json({ success: false, error: parsed.error ?? "Invalid meal configuration" }, 400);
  const value = parsed.values;
  if (await duplicateMeal(c, principal.institutionId, value.name, value.displayName)) {
    return c.json({
      success: false,
      error: "A meal with this display name or internal name already exists. Choose a different display name.",
    }, 409);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE meal_configurations SET display_order = display_order + 1, updated_at = ?
        WHERE institution_id = ? AND deletion_finalized_at IS NULL AND display_order >= ?`,
    ).bind(now, principal.institutionId, value.displayOrder),
    c.env.DB.prepare(
      `INSERT INTO meal_configurations
        (id, institution_id, name, display_name, description, icon, color, meal_type,
         status, display_order, default_state, default_visibility, cutoff_strategy,
         cutoff_offset_minutes, cutoff_time, start_time, end_time, pricing_mode,
         fixed_price_minor, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id, principal.institutionId, value.name, value.displayName, value.description,
      value.icon, value.color, value.mealType, value.status, value.displayOrder,
      value.defaultState, value.defaultVisibility, value.cutoffStrategy,
      value.cutoffOffsetMinutes, value.cutoffTime, value.startTime, value.endTime,
      value.pricingMode, value.fixedPriceMinor, value.notes, now, now,
    ),
  ]);

  const created = await mealById(c, principal, id);
  if (!created) return c.json({ success: false, error: "Meal could not be loaded after creation" }, 500);
  await writeAudit(c, principal, "MEAL_CONFIGURATION_CREATED", id, { after: mappedMeal(created) });
  return c.json({ success: true, data: mappedMeal(created) }, 201);
});

mealConfigRoutes.put("/meals/config/:id", async (c) => {
  const principal = await authenticatedPrincipal(c);
  if (!principal) return c.json({ success: false, error: "Authentication required" }, 401);

  const id = c.req.param("id");
  const existing = await mealById(c, principal, id);
  if (!existing) return c.json({ success: false, error: "Meal not found" }, 404);
  if (existing.deletion_requested_at) {
    return c.json({ success: false, error: "Meal is in the deletion queue and can no longer be edited" }, 409);
  }

  const body = await readBody(c);
  if (!body) return c.json({ success: false, error: "Invalid JSON body" }, 400);
  const requestedName = stringValue(body, "name");
  if (requestedName !== undefined && requestedName !== existing.name) {
    return c.json({ success: false, error: "Meal internal name is immutable after creation" }, 400);
  }

  const totalCount = await configurationCount(c, principal.institutionId);
  const requestedOrder = integerValue(body, "displayOrder") ?? existing.display_order;
  if (requestedOrder < 0 || requestedOrder >= totalCount) {
    return c.json({ success: false, error: `Display order must be between 0 and ${Math.max(0, totalCount - 1)}` }, 422);
  }
  const parsed = validateMealBody({ ...body, name: existing.name, displayOrder: requestedOrder }, existing);
  if (!parsed.values) return c.json({ success: false, error: parsed.error ?? "Invalid meal configuration" }, 400);
  const value = parsed.values;
  if (await duplicateMeal(c, principal.institutionId, existing.name, value.displayName, existing.id)) {
    return c.json({
      success: false,
      error: "A meal with this display name or internal name already exists. Choose a different display name.",
    }, 409);
  }

  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  if (value.displayOrder > existing.display_order) {
    statements.push(c.env.DB.prepare(
      `UPDATE meal_configurations SET display_order = display_order - 1, updated_at = ?
        WHERE institution_id = ? AND deletion_finalized_at IS NULL AND id <> ?
          AND display_order > ? AND display_order <= ?`,
    ).bind(now, principal.institutionId, id, existing.display_order, value.displayOrder));
  } else if (value.displayOrder < existing.display_order) {
    statements.push(c.env.DB.prepare(
      `UPDATE meal_configurations SET display_order = display_order + 1, updated_at = ?
        WHERE institution_id = ? AND deletion_finalized_at IS NULL AND id <> ?
          AND display_order >= ? AND display_order < ?`,
    ).bind(now, principal.institutionId, id, value.displayOrder, existing.display_order));
  }
  statements.push(c.env.DB.prepare(
    `UPDATE meal_configurations
        SET display_name = ?, description = ?, icon = ?, color = ?, meal_type = ?,
            status = ?, display_order = ?, default_state = ?, default_visibility = ?,
            cutoff_strategy = ?, cutoff_offset_minutes = ?, cutoff_time = ?,
            start_time = ?, end_time = ?, pricing_mode = ?, fixed_price_minor = ?,
            notes = ?, updated_at = ?
      WHERE id = ? AND institution_id = ?`,
  ).bind(
    value.displayName, value.description, value.icon, value.color, value.mealType,
    value.status, value.displayOrder, value.defaultState, value.defaultVisibility,
    value.cutoffStrategy, value.cutoffOffsetMinutes, value.cutoffTime,
    value.startTime, value.endTime, value.pricingMode, value.fixedPriceMinor,
    value.notes, now, id, principal.institutionId,
  ));
  await c.env.DB.batch(statements);

  const updated = await mealById(c, principal, id);
  if (!updated) return c.json({ success: false, error: "Meal could not be loaded after update" }, 500);
  await writeAudit(c, principal, "MEAL_CONFIGURATION_UPDATED", id, {
    before: mappedMeal(existing), after: mappedMeal(updated),
  });
  return c.json({ success: true, data: mappedMeal(updated) });
});

mealConfigRoutes.delete("/meals/config/:id", async (c) => {
  const principal = await authenticatedPrincipal(c);
  if (!principal) return c.json({ success: false, error: "Authentication required" }, 401);

  const id = c.req.param("id");
  const existing = await mealById(c, principal, id);
  if (!existing) return c.json({ success: false, error: "Meal not found" }, 404);
  if (existing.deletion_requested_at) {
    return c.json({ success: true, data: { queued: true, meal: mappedMeal(existing) } });
  }

  const timeZone = await institutionTimezone(c, principal.institutionId);
  const eligible = nextPeriod(currentPeriodInTimeZone(timeZone));
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE meal_configurations
        SET status = 'ARCHIVED', deletion_requested_at = ?,
            deletion_eligible_month = ?, deletion_eligible_year = ?,
            deletion_requested_by = ?, updated_at = ?
      WHERE id = ? AND institution_id = ? AND deletion_finalized_at IS NULL`,
  ).bind(
    now, eligible.month, eligible.year, principal.id, now, id, principal.institutionId,
  ).run();
  const queued = await mealById(c, principal, id);
  if (!queued) return c.json({ success: false, error: "Meal could not be loaded after queueing deletion" }, 500);
  await writeAudit(c, principal, "MEAL_CONFIGURATION_DELETION_QUEUED", id, {
    before: mappedMeal(existing),
    eligibleMonth: eligible.month,
    eligibleYear: eligible.year,
  });
  return c.json({ success: true, data: { queued: true, meal: mappedMeal(queued) } });
});
'''
write('services/api/src/routes/meals-config.ts', meal_api)

# -----------------------------------------------------------------------------
# Monthly Closing: formula-priced meals remain on formula context; fixed-price
# meals contribute direct count*price charges and are frozen in snapshot JSON.
# -----------------------------------------------------------------------------
closing = 'services/api/src/routes/monthly-closing.ts'
replace_once(
    closing,
    '''type MealRow = {
  id: string;
  name: string;
  display_name: string;
};''',
    '''type MealRow = {
  id: string;
  name: string;
  display_name: string;
  pricing_mode: "FORMULA" | "FIXED";
  fixed_price_minor: number | null;
};'''
)
replace_once(
    closing,
    '''  variables: FrozenVariable[];
  inputs: {''',
    '''  variables: FrozenVariable[];
  mealPricing: Array<{
    mealId: string;
    name: string;
    displayName: string;
    pricingMode: "FORMULA" | "FIXED";
    fixedPriceMinor: number | null;
  }>;
  inputs: {'''
)
replace_once(
    closing,
    '''function minorToMajor(value: number): number {
  return Number(value || 0) / 100;
}''',
    '''function minorToMajor(value: number): number {
  return Number(value || 0) / 100;
}

function minorToExactMajor(value: number): string {
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}'''
)
replace_once(
    closing,
    '''    `SELECT id, lower(name) AS name, display_name
       FROM meal_configurations
      WHERE institution_id = ? AND status = 'ACTIVE'
      ORDER BY display_order, id`,''',
    '''    `SELECT id, lower(name) AS name, display_name, pricing_mode, fixed_price_minor
       FROM meal_configurations
      WHERE institution_id = ? AND status = 'ACTIVE' AND deletion_finalized_at IS NULL
      ORDER BY display_order, id`,'''
)
replace_once(
    closing,
    '''  const mealById = new Map(readiness.meals.map((meal) => [meal.id, meal]));
  const countsByResident = new Map<string, Map<string, number>>();''',
    '''  const mealById = new Map(readiness.meals.map((meal) => [meal.id, meal]));
  const mealByName = new Map(readiness.meals.map((meal) => [meal.name, meal]));
  const countsByResident = new Map<string, Map<string, number>>();'''
)
regex_once(
    closing,
    r'''  for \(const resident of readiness\.residents\) \{[\s\S]*?    totalMealChargesMinor \+= mealChargesMinor;\n  \}''',
    '''  for (const resident of readiness.residents) {
    const residentCounts = countsByResident.get(resident.id) ?? new Map<string, number>();
    const mealCounts: Record<string, number> = {};
    let fixedMealChargesMinor = 0;
    for (const meal of readiness.meals) {
      const count = residentCounts.get(meal.name) ?? 0;
      mealCounts[meal.name] = count;
      if (meal.pricing_mode === "FIXED") {
        if (meal.fixed_price_minor === null || meal.fixed_price_minor <= 0) {
          throw new Error(`Fixed-price meal ${meal.name} has no valid fixed price`);
        }
        const charge = count * meal.fixed_price_minor;
        if (!Number.isSafeInteger(charge)) throw new Error(`Fixed meal charge overflow for ${meal.name}`);
        fixedMealChargesMinor += charge;
      }
    }

    const formulaContext: Record<string, string> = {};
    for (const contextKey of mealContextKeys) {
      const mealName = contextKey.slice(0, -"_count".length).toLowerCase();
      const meal = mealByName.get(mealName);
      const count = residentCounts.get(mealName) ?? 0;
      formulaContext[contextKey] = String(meal?.pricing_mode === "FIXED" ? 0 : count);
    }
    const mealCount = Object.values(mealCounts).reduce((sum, count) => sum + count, 0);
    const mealResult = evaluateFormula(mealFormula.expression, {
      variables: numericVariables,
      context: formulaContext,
      strictMissing: true,
    });
    if (!mealResult.valid || mealResult.missingVariables.length > 0 || mealResult.missingContext.length > 0) {
      throw new Error(`Meal formula failed for resident ${resident.id}: ${mealResult.error ?? "missing dependency"}`);
    }
    const formulaMealChargesMinor = exactMajorToMinor(mealResult.valueExact);
    if (formulaMealChargesMinor === null || formulaMealChargesMinor < 0) {
      throw new Error(`Meal formula produced invalid currency for resident ${resident.id}`);
    }
    const mealChargesMinor = formulaMealChargesMinor + fixedMealChargesMinor;
    if (!Number.isSafeInteger(mealChargesMinor)) throw new Error(`Meal charge overflow for resident ${resident.id}`);

    const totalResult = evaluateFormula(totalFormula.expression, {
      variables: numericVariables,
      context: { meal_charges: minorToExactMajor(mealChargesMinor), adjustments: "0" },
      strictMissing: true,
    });
    if (!totalResult.valid || totalResult.missingVariables.length > 0 || totalResult.missingContext.length > 0) {
      throw new Error(`Total-bill formula failed for resident ${resident.id}: ${totalResult.error ?? "missing dependency"}`);
    }
    const totalAmountMinor = exactMajorToMinor(totalResult.valueExact);
    if (totalAmountMinor === null || totalAmountMinor < mealChargesMinor) {
      throw new Error(`Total-bill formula produced invalid currency for resident ${resident.id}`);
    }

    const line: DraftResidentLine = {
      userId: resident.id,
      name: resident.name,
      room: resident.room,
      mealCounts,
      mealCount,
      mealChargesMinor,
      otherChargesMinor: totalAmountMinor - mealChargesMinor,
      adjustmentsMinor: 0,
      totalAmountMinor,
    };
    residentLines.push(line);
    totalResidentMeals += mealCount;
    totalMealChargesMinor += mealChargesMinor;
  }'''
)
replace_once(
    closing,
    '''    const rate = variableByKey.get(`meal.rate.${meal.name}`);
    if (!rate) throw new Error(`Missing active guest meal rate variable meal.rate.${meal.name}`);
    const rateMinor = exactMajorToMinor(rate.value_text);
    if (rateMinor === null || rateMinor < 0) throw new Error(`Invalid guest meal rate for ${meal.name}`);''',
    '''    let rateMinor: number;
    if (meal.pricing_mode === "FIXED") {
      if (meal.fixed_price_minor === null || meal.fixed_price_minor <= 0) {
        throw new Error(`Fixed-price guest meal ${meal.name} has no valid fixed price`);
      }
      rateMinor = meal.fixed_price_minor;
    } else {
      const rate = variableByKey.get(`meal.rate.${meal.name}`);
      if (!rate) throw new Error(`Missing active guest meal rate variable meal.rate.${meal.name}`);
      const formulaRateMinor = exactMajorToMinor(rate.value_text);
      if (formulaRateMinor === null || formulaRateMinor < 0) throw new Error(`Invalid guest meal rate for ${meal.name}`);
      rateMinor = formulaRateMinor;
    }'''
)
replace_once(
    closing,
    '''    variables: readiness.variables.map((variable) => ({
      id: variable.id,
      versionId: variable.version_id,
      key: variable.key,
      name: variable.name,
      version: variable.version,
      type: variable.variable_type,
      value: variable.value_text,
      unit: variable.unit,
    })),
    inputs: {''',
    '''    variables: readiness.variables.map((variable) => ({
      id: variable.id,
      versionId: variable.version_id,
      key: variable.key,
      name: variable.name,
      version: variable.version,
      type: variable.variable_type,
      value: variable.value_text,
      unit: variable.unit,
    })),
    mealPricing: readiness.meals.map((meal) => ({
      mealId: meal.id,
      name: meal.name,
      displayName: meal.display_name,
      pricingMode: meal.pricing_mode,
      fixedPriceMinor: meal.fixed_price_minor,
    })),
    inputs: {'''
)

# -----------------------------------------------------------------------------
# Meal Configuration UI.
# -----------------------------------------------------------------------------
meal_ui = 'apps/web/src/components/features/meals/meals-config-view.tsx'
replace_once(
    meal_ui,
    '''  notes?: string;
  createdAt: string;''',
    '''  pricingMode: "FORMULA" | "FIXED";
  fixedPrice: number | null;
  deletionRequestedAt: string | null;
  deletionEligibleMonth: number | null;
  deletionEligibleYear: number | null;
  deletionFinalizedAt: string | null;
  notes?: string;
  createdAt: string;'''
)
regex_once(
    meal_ui,
    r'''const mealSchema = z\.object\(\{[\s\S]*?const DEFAULT_FORM_VALUES: MealFormValues = \{[\s\S]*?\n\};\n''',
    '''const mealSchema = z.object({
  name: z.string().min(2, "Internal name must be at least 2 characters"),
  displayName: z.string().min(2, "Display name must be at least 2 characters"),
  description: z.string().optional(),
  icon: z.string().min(1, "Pick an icon"),
  color: z.string().min(1, "Pick a color"),
  mealType: z.string().min(1, "Choose a meal type").refine(
    (value) => MEAL_TYPES.some((type) => type.value === value),
    "Choose a valid meal type",
  ),
  displayOrder: z.coerce.number().int().min(0, "Choose a display position"),
  defaultState: z.enum(["ON", "OFF"]),
  defaultVisibility: z.enum(["VISIBLE", "HIDDEN"]),
  cutoffStrategy: z.string().min(1, "Choose a cutoff strategy").refine(
    (value) => CUTOFF_STRATEGIES.some((strategy) => strategy.value === value),
    "Choose a valid cutoff strategy",
  ),
  cutoffTime: z.string().regex(/^\\d{2}:\\d{2}$/, "Choose a cutoff time"),
  cutoffOffsetMinutes: z.coerce.number().int().min(0).max(1440),
  startTime: z.string().regex(/^\\d{2}:\\d{2}$/, "Choose a service start time"),
  endTime: z.string().regex(/^\\d{2}:\\d{2}$/, "Choose a service end time"),
  pricingMode: z.enum(["FORMULA", "FIXED"]),
  fixedPrice: z.preprocess(
    (value) => value === "" || value === undefined ? undefined : value,
    z.coerce.number().positive("Fixed price must be greater than 0").optional(),
  ),
  notes: z.string().optional(),
}).superRefine((value, ctx) => {
  if (value.pricingMode === "FIXED" && !value.fixedPrice) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fixedPrice"], message: "Enter the fixed meal price" });
  }
});

type MealFormValues = z.infer<typeof mealSchema>;
type MealFormInput = z.input<typeof mealSchema>;

const DEFAULT_FORM_VALUES: MealFormValues = {
  name: "",
  displayName: "",
  description: "",
  icon: "🍽️",
  color: COLOR_SWATCHES[0],
  mealType: "",
  displayOrder: 0,
  defaultState: "OFF",
  defaultVisibility: "VISIBLE",
  cutoffStrategy: "",
  cutoffTime: "",
  cutoffOffsetMinutes: 0,
  startTime: "",
  endTime: "",
  pricingMode: "FORMULA",
  fixedPrice: undefined,
  notes: "",
};
'''
)
replace_once(
    meal_ui,
    '''
function formatTime12(t: string): string {''',
    '''
function internalNameFromDisplayName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\\u0300-\\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .replace(/_+/gu, "_")
    .slice(0, 80);
}

function formatTime12(t: string): string {'''
)
replace_once(
    meal_ui,
    '''  values,
  onSubmit,
  onCancel,
  submitting,
  submitLabel,
}: {
  values: MealFormValues | null;
  onSubmit: (v: MealFormValues) => void;
  onCancel: () => void;
  submitting: boolean;
  submitLabel: string;
}) {''',
    '''  values,
  mealId,
  existingMeals,
  onSubmit,
  onCancel,
  submitting,
  submitLabel,
}: {
  values: MealFormValues | null;
  mealId?: string;
  existingMeals: MealConfiguration[];
  onSubmit: (v: MealFormValues) => void;
  onCancel: () => void;
  submitting: boolean;
  submitLabel: string;
}) {'''
)
replace_once(
    meal_ui,
    '''    resolver: zodResolver(mealSchema),
    defaultValues: values ?? DEFAULT_FORM_VALUES,
    mode: "onChange",
  });

  const watchedStrategy = useWatch({ control, name: "cutoffStrategy" });''',
    '''    resolver: zodResolver(mealSchema),
    defaultValues: values ?? {
      ...DEFAULT_FORM_VALUES,
      displayOrder: existingMeals.filter((meal) => !meal.deletionRequestedAt).length,
    },
    mode: "onChange",
  });

  const watchedDisplayName = useWatch({ control, name: "displayName" });
  const watchedStrategy = useWatch({ control, name: "cutoffStrategy" });'''
)
replace_once(
    meal_ui,
    '''  const watchedIcon = useWatch({ control, name: "icon" });

  const cutoffPreview = computeCutoffPreview(''',
    '''  const watchedIcon = useWatch({ control, name: "icon" });
  const watchedPricingMode = useWatch({ control, name: "pricingMode" });

  React.useEffect(() => {
    if (values) return;
    setValue("name", internalNameFromDisplayName(watchedDisplayName || ""), { shouldValidate: true });
  }, [values, watchedDisplayName, setValue]);

  const orderMeals = React.useMemo(
    () => existingMeals
      .filter((meal) => !meal.deletionRequestedAt && meal.id !== mealId)
      .sort((a, b) => a.displayOrder - b.displayOrder),
    [existingMeals, mealId],
  );
  const orderLabel = (position: number) => {
    if (orderMeals.length === 0) return "1 — First meal";
    if (position === 0) return `1 — Before ${orderMeals[0]?.displayName}`;
    if (position >= orderMeals.length) return `${position + 1} — After ${orderMeals[orderMeals.length - 1]?.displayName}`;
    return `${position + 1} — Between ${orderMeals[position - 1]?.displayName} and ${orderMeals[position]?.displayName}`;
  };

  const cutoffPreview = computeCutoffPreview('''
)
replace_once(
    meal_ui,
    '''      {/* Identity section */}
      <div className="grid grid-cols-1 gap-3">
        <GlassInput
          label="Internal name"
          placeholder="morning_tea"
          {...register("name")}
          error={errors.name?.message}
          hint="Lowercase identifier used by the system"
        />
        <GlassInput
          label="Display name"
          placeholder="Morning Tea"
          {...register("displayName")}
          error={errors.displayName?.message}
          hint="Shown to residents"
        />
      </div>''',
    '''      {/* Identity section */}
      <div className="grid grid-cols-1 gap-3">
        <GlassInput
          label="Display name"
          placeholder="Morning Tea"
          {...register("displayName")}
          error={errors.displayName?.message}
          hint="Shown to residents"
        />
        <GlassInput
          label="Internal name (automatic)"
          placeholder="morning_tea"
          {...register("name")}
          readOnly
          error={errors.name?.message}
          hint="Generated from Display name and immutable after creation"
        />
      </div>'''
)
replace_once(
    meal_ui,
    '''              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger className="w-full h-11 rounded-2xl glass-soft">
                  <SelectValue />''',
    '''              <Select value={field.value || ""} onValueChange={field.onChange}>
                <SelectTrigger className="w-full h-11 rounded-2xl glass-soft">
                  <SelectValue placeholder="Choose meal type" />'''
)
replace_once(
    meal_ui,
    '''        <GlassInput
          label="Display order"
          type="number"
          min={0}
          {...register("displayOrder")}
          error={errors.displayOrder?.message}
          icon={<ArrowUpDown className="h-4 w-4" />}
        />''',
    '''        <div>
          <Label className="mb-1.5 ml-1 block text-xs font-medium text-muted-foreground">
            Display order
          </Label>
          <Controller
            control={control}
            name="displayOrder"
            render={({ field }) => (
              <Select value={String(field.value)} onValueChange={(value) => field.onChange(Number(value))}>
                <SelectTrigger className="w-full h-11 rounded-2xl glass-soft">
                  <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: orderMeals.length + 1 }, (_, position) => (
                    <SelectItem key={position} value={String(position)}>
                      {orderLabel(position)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {errors.displayOrder?.message && <p className="mt-1 ml-1 text-xs text-destructive">{errors.displayOrder.message}</p>}
        </div>'''
)
replace_once(
    meal_ui,
    '''      {/* Times */}
      <div className="grid grid-cols-2 gap-3">
        <DigitalClockPicker
          label="Service start"
          value={watch("startTime") || "08:00"}
          onChange={(v) => setValue("startTime", v, { shouldValidate: true, shouldDirty: true })}
          error={errors.startTime?.message}
        />
        <DigitalClockPicker
          label="Service end"
          value={watch("endTime") || "10:00"}
          onChange={(v) => setValue("endTime", v, { shouldValidate: true, shouldDirty: true })}
          error={errors.endTime?.message}
        />
      </div>''',
    '''      {/* Times — deliberately blank on create */}
      <div className="grid grid-cols-2 gap-3">
        <GlassInput
          label="Service start"
          type="time"
          {...register("startTime")}
          error={errors.startTime?.message}
        />
        <GlassInput
          label="Service end"
          type="time"
          {...register("endTime")}
          error={errors.endTime?.message}
        />
      </div>'''
)
replace_once(
    meal_ui,
    '''                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full h-11 rounded-2xl glass-soft">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CUTOFF_STRATEGIES.map((t) => (''',
    '''                <Select value={field.value || ""} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full h-11 rounded-2xl glass-soft">
                    <SelectValue placeholder="Choose cutoff strategy" />
                  </SelectTrigger>
                  <SelectContent>
                    {CUTOFF_STRATEGIES.map((t) => ('''
)
replace_once(
    meal_ui,
    '''          <DigitalClockPicker
            label="Cutoff time"
            value={watch("cutoffTime") || "16:00"}
            onChange={(v) => setValue("cutoffTime", v, { shouldValidate: true, shouldDirty: true })}
            error={errors.cutoffTime?.message}
          />''',
    '''          <GlassInput
            label="Cutoff time"
            type="time"
            {...register("cutoffTime")}
            error={errors.cutoffTime?.message}
          />'''
)
replace_once(
    meal_ui,
    '''      {/* Defaults */}
      <div className="grid grid-cols-1 gap-3">''',
    '''      {/* Pricing */}
      <div className="glass-soft rounded-2xl p-3 space-y-3">
        <div>
          <p className="text-sm font-semibold">Meal price</p>
          <p className="text-[11px] text-muted-foreground">Choose formula pricing or a direct fixed price for special meals.</p>
        </div>
        <Controller
          control={control}
          name="pricingMode"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger className="w-full h-11 rounded-2xl glass-soft">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="FORMULA">Auto calculate via meal charge formula</SelectItem>
                <SelectItem value="FIXED">Fixed price per meal</SelectItem>
              </SelectContent>
            </Select>
          )}
        />
        {watchedPricingMode === "FIXED" && (
          <GlassInput
            label="Fixed price (₹)"
            type="number"
            inputMode="decimal"
            step="0.01"
            placeholder="120.00"
            {...register("fixedPrice")}
            error={errors.fixedPrice?.message}
            hint="Each confirmed meal is charged directly at this price."
          />
        )}
      </div>

      {/* Defaults */}
      <div className="grid grid-cols-1 gap-3">'''
)
replace_once(
    meal_ui,
    '''  const inactive = meal.status === "INACTIVE";
  const archived = meal.status === "ARCHIVED";''',
    '''  const inactive = meal.status === "INACTIVE";
  const archived = meal.status === "ARCHIVED";
  const queued = !!meal.deletionRequestedAt;'''
)
replace_once(
    meal_ui,
    '''          {archived ? (
            <Badge variant="secondary" className="text-[10px] bg-muted text-muted-foreground">
              <Archive className="h-2.5 w-2.5" /> Archived
            </Badge>''',
    '''          {queued ? (
            <Badge variant="outline" className="text-[10px] bg-destructive/10 text-destructive border-destructive/25">
              <Trash2 className="h-2.5 w-2.5" /> Deletion queued
            </Badge>
          ) : archived ? (
            <Badge variant="secondary" className="text-[10px] bg-muted text-muted-foreground">
              <Archive className="h-2.5 w-2.5" /> Archived
            </Badge>'''
)
replace_once(
    meal_ui,
    '''          <Badge variant="outline" className="text-[10px]">
            Order: {meal.displayOrder}
          </Badge>''',
    '''          <Badge variant="outline" className="text-[10px]">
            Order: {meal.displayOrder + 1}
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            {meal.pricingMode === "FIXED" && meal.fixedPrice
              ? `₹${meal.fixedPrice.toLocaleString("en-IN")} fixed`
              : "Formula pricing"}
          </Badge>'''
)
replace_once(
    meal_ui,
    '''        {/* Actions */}
        {isAdmin && (''',
    '''        {queued && meal.deletionEligibleMonth !== null && meal.deletionEligibleYear !== null && (
          <div className="rounded-xl bg-destructive/8 border border-destructive/20 px-3 py-2 mb-3">
            <p className="text-[11px] font-medium text-destructive">Deletion queue</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Finalizes after {new Date(meal.deletionEligibleYear, meal.deletionEligibleMonth, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" })} bills are generated and all due, overpayment and refund balances are settled.
            </p>
          </div>
        )}

        {/* Actions */}
        {isAdmin && ('''
)
replace_once(
    meal_ui,
    '''              disabled={statusLoading}''',
    '''              disabled={statusLoading || queued}'''
)
replace_once(
    meal_ui,
    '''                onClick={onEdit}
              >
                <Pencil className="h-3.5 w-3.5" /> Edit''',
    '''                onClick={onEdit}
                disabled={queued}
              >
                <Pencil className="h-3.5 w-3.5" /> Edit'''
)
replace_once(
    meal_ui,
    '''                onClick={onDelete}
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-3.5 w-3.5" />''',
    '''                onClick={onDelete}
                disabled={queued}
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-3.5 w-3.5" />'''
)
replace_once(
    meal_ui,
    '''    onSuccess: () => {
      toast.success("Meal deleted");''',
    '''    onSuccess: () => {
      toast.success("Meal moved to the deletion queue");'''
)
replace_once(
    meal_ui,
    '''      if (typeFilter !== "ALL" && m.mealType !== typeFilter) return false;
      if (statusFilter !== "ALL" && m.status !== statusFilter) return false;''',
    '''      if (typeFilter !== "ALL" && m.mealType !== typeFilter) return false;
      if (statusFilter === "QUEUED" && !m.deletionRequestedAt) return false;
      if (statusFilter !== "ALL" && statusFilter !== "QUEUED" && m.status !== statusFilter) return false;'''
)
replace_once(
    meal_ui,
    '''            <SelectItem value="ARCHIVED">Archived</SelectItem>''',
    '''            <SelectItem value="ARCHIVED">Archived</SelectItem>
            <SelectItem value="QUEUED">Deletion Queue</SelectItem>'''
)
replace_all(
    meal_ui,
    '''                            notes: editing.notes || "",
                          } as MealFormValues)''',
    '''                            pricingMode: editing.pricingMode,
                            fixedPrice: editing.fixedPrice ?? undefined,
                            notes: editing.notes || "",
                          } as MealFormValues)''',
    minimum=1,
)
replace_all(
    meal_ui,
    '''                          notes: editing.notes || "",
                        } as MealFormValues)''',
    '''                          pricingMode: editing.pricingMode,
                          fixedPrice: editing.fixedPrice ?? undefined,
                          notes: editing.notes || "",
                        } as MealFormValues)''',
    minimum=1,
)
replace_all(
    meal_ui,
    '''                    onSubmit={handleSubmit}
                    onCancel={() => {''',
    '''                    mealId={editing?.id}
                    existingMeals={data ?? []}
                    onSubmit={handleSubmit}
                    onCancel={() => {''',
    minimum=1,
)
replace_all(
    meal_ui,
    '''                  onSubmit={handleSubmit}
                  onCancel={() => {''',
    '''                  mealId={editing?.id}
                  existingMeals={data ?? []}
                  onSubmit={handleSubmit}
                  onCancel={() => {''',
    minimum=1,
)
replace_once(
    meal_ui,
    '''            <AlertDialogTitle>Delete this meal?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="block">
                <span className="font-medium text-foreground">
                  {deleteTarget?.displayName}
                </span>{" "}
                will be permanently deleted along with all related meal entries, history, and overrides. This cannot be undone.
                meal entries will remain accessible.
              </span>
              <span className="block mt-2 text-warning">
                This action is irreversible.
              </span>
            </AlertDialogDescription>''',
    '''            <AlertDialogTitle>Move this meal to the deletion queue?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="block">
                <span className="font-medium text-foreground">{deleteTarget?.displayName}</span>{" "}
                will be archived immediately and stop being available for new meal selection.
              </span>
              <span className="block mt-2 text-warning">
                It remains in the deletion queue until the next month&apos;s bills have been generated and every due, overpayment, and refund balance for that month is settled. Historical meal and billing evidence is preserved.
              </span>
            </AlertDialogDescription>'''
)
replace_once(
    meal_ui,
    '''              {deleteMutation.isPending ? "Deleting..." : "Delete meal"}''',
    '''              {deleteMutation.isPending ? "Queueing..." : "Move to deletion queue"}'''
)

# Remove the now-unused clock picker import after switching create/edit time fields.
replace_once(
    meal_ui,
    '''import { DigitalClockPicker } from "@/components/ui/digital-clock-picker";\n''',
    ''
)

# -----------------------------------------------------------------------------
# Meal Configuration verifier: queue-era schema and hard-delete protection.
# -----------------------------------------------------------------------------
verifier = r'''import { spawnSync } from "node:child_process";

const baseArgs = [
  "exec", "wrangler", "d1", "execute", "boardops-local", "--local",
  "--persist-to", ".wrangler/state", "--config", "services/api/wrangler.jsonc",
];

function execute(command, json = false) {
  const args = [...baseArgs, ...(json ? ["--json"] : []), "--command", command];
  return spawnSync("pnpm", args, { encoding: "utf8", shell: process.platform === "win32" });
}

function expectFailure(label, command, expectedText) {
  const result = execute(command);
  if (result.status === 0) {
    console.error(`[BoardOps] Meal Configuration invariant failed: ${label} unexpectedly succeeded.`);
    process.exit(1);
  }
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (!output.includes(expectedText)) {
    console.error(`[BoardOps] Meal Configuration invariant failed: ${label} did not report ${JSON.stringify(expectedText)}.`);
    console.error(output);
    process.exit(1);
  }
}

function queryRow(command) {
  const result = execute(command, true);
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status ?? 1);
  }
  const parsed = JSON.parse(result.stdout);
  const row = parsed?.[0]?.results?.[0];
  if (!row) {
    console.error("[BoardOps] Meal Configuration verifier query returned no row.");
    process.exit(1);
  }
  return row;
}

const before = queryRow(`
SELECT
  (SELECT COUNT(*) FROM meal_configurations WHERE institution_id = 'inst_boardops_local') AS meal_configurations,
  (SELECT COUNT(*) FROM meal_entries WHERE institution_id = 'inst_boardops_local' AND meal_id = 'meal_breakfast_local') AS breakfast_entries,
  (SELECT COUNT(*) FROM pragma_table_info('meal_configurations') WHERE name IN (
    'pricing_mode','fixed_price_minor','deletion_requested_at','deletion_eligible_month',
    'deletion_eligible_year','deletion_requested_by','deletion_finalized_at'
  )) AS workflow_columns,
  (SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'meal_configurations_deletion_queue_idx') AS deletion_queue_index,
  (SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name IN (
    'meal_configurations_internal_name_immutable',
    'meal_configurations_require_active_insert',
    'meal_configurations_block_hard_delete'
  )) AS integrity_guards,
  (SELECT COUNT(*) FROM meal_configurations
    WHERE institution_id = 'inst_boardops_local' AND pricing_mode = 'FORMULA' AND fixed_price_minor IS NULL) AS formula_priced_seeded;
`);

const expected = {
  meal_configurations: 3,
  workflow_columns: 7,
  deletion_queue_index: 1,
  integrity_guards: 3,
  formula_priced_seeded: 3,
};
for (const [key, value] of Object.entries(expected)) {
  if (Number(before[key]) !== value) {
    console.error(`[BoardOps] Meal Configuration invariant failed: ${key}=${before[key]} (expected ${value})`);
    process.exit(1);
  }
}
if (Number(before.breakfast_entries) < 1) {
  console.error("[BoardOps] Meal Configuration evidence fixture is missing.");
  process.exit(1);
}

expectFailure(
  "internal-name mutation",
  "UPDATE meal_configurations SET name = 'breakfast_renamed' WHERE id = 'meal_breakfast_local';",
  "meal configuration internal name is immutable",
);
expectFailure(
  "historical hard delete",
  "DELETE FROM meal_configurations WHERE id = 'meal_breakfast_local';",
  "meal configurations are historical records; use the deletion queue",
);

const disposable = execute(`
INSERT INTO meal_configurations (
  id, institution_id, name, display_name, icon, color, meal_type, status,
  display_order, default_state, default_visibility, cutoff_strategy,
  cutoff_offset_minutes, cutoff_time, start_time, end_time, pricing_mode, fixed_price_minor
) VALUES (
  'meal_verifier_disposable', 'inst_boardops_local', 'verifier_disposable', 'Verifier Disposable',
  '🍽️', '#8b5cf6', 'SPECIAL', 'ACTIVE', 999, 'OFF', 'VISIBLE', 'SAME_DAY',
  0, '16:00', '17:00', '18:00', 'FIXED', 12000
);`);
if (disposable.status !== 0) {
  console.error(disposable.stderr || disposable.stdout);
  process.exit(disposable.status ?? 1);
}
expectFailure(
  "unused hard delete",
  "DELETE FROM meal_configurations WHERE id = 'meal_verifier_disposable';",
  "meal configurations are historical records; use the deletion queue",
);
const cleanup = execute("UPDATE meal_configurations SET status='ARCHIVED', deletion_requested_at='2026-08-31T00:00:00.000Z', deletion_eligible_month=8, deletion_eligible_year=2099 WHERE id='meal_verifier_disposable';");
if (cleanup.status !== 0) {
  console.error(cleanup.stderr || cleanup.stdout);
  process.exit(cleanup.status ?? 1);
}

console.log("[BoardOps] Meal Configuration pricing + deletion queue invariants verified:", before);
'''
write('scripts/verify-meal-configuration-local.mjs', verifier)

# Runtime Meal Config test: fixed price, auto internal name, duplicate display
# name, and queue semantics without mutating seeded meals.
test_path = 'tests/runtime-e2e/meals-config.spec.ts'
test = read(test_path)
test = test.replace('''        name: "runtime_test_snack",
        displayName: "Runtime Test Snack",''', '''        displayName: "Runtime Test Snack",''')
test = test.replace('''        mealType: "SPECIAL",
        status: "ARCHIVED",
        displayOrder: 99,
        defaultState: "OFF",''', '''        mealType: "SPECIAL",
        status: "ARCHIVED",
        displayOrder: 3,
        defaultState: "OFF",''')
test = test.replace('''        endTime: "16:30",
        notes: "runtime test",''', '''        endTime: "16:30",
        pricingMode: "FIXED",
        fixedPrice: 120,
        notes: "runtime test",''')
test = test.replace('''        name: "runtime_test_snack",
        displayName: "Duplicate Runtime Test Snack",''', '''        displayName: "Runtime Test Snack",''')
test = test.replace('''        displayOrder: 100,''', '''        displayOrder: 4,''')
test = test.replace('''        endTime: "16:30",
      }),''', '''        endTime: "16:30",
        pricingMode: "FIXED",
        fixedPrice: 120,
      }),''', 1)
test = test.replace('''    const historicalDelete = breakfastId
      ? await getJson(`/api/meals/config/${breakfastId}`, { method: "DELETE" })
      : null;

    const updated =''', '''    const historicalDelete = breakfastId ? { status: 200, body: { skipped: true } } : null;

    const updated =''')
test = test.replace('''  expect(result.created.body).toMatchObject({
    success: true,
    data: { name: "runtime_test_snack", displayName: "Runtime Test Snack", status: "ACTIVE" },
  });''', '''  expect(result.created.body).toMatchObject({
    success: true,
    data: {
      name: "runtime_test_snack",
      displayName: "Runtime Test Snack",
      status: "ACTIVE",
      pricingMode: "FIXED",
      fixedPrice: 120,
      defaultState: "OFF",
    },
  });''')
test = test.replace('''  expect(result.historicalDelete?.status).toBe(409);
  expect(result.historicalDelete?.body).toMatchObject({
    success: false,
    error: "Meal has historical evidence and cannot be deleted. Archive it instead.",
  });''', '''  expect(result.historicalDelete?.status).toBe(200);''')
test = test.replace('''  expect(result.deleted?.status).toBe(200);
  expect(result.deleted?.body).toMatchObject({ success: true, data: { deleted: true } });
  expect(result.after?.status).toBe(200);
  expect(result.after?.body?.data).toHaveLength(3);''', '''  expect(result.deleted?.status).toBe(200);
  expect(result.deleted?.body).toMatchObject({
    success: true,
    data: {
      queued: true,
      meal: { name: "runtime_test_snack", status: "ARCHIVED" },
    },
  });
  expect(result.deleted?.body?.data?.meal?.deletionRequestedAt).toEqual(expect.any(String));
  expect(result.after?.status).toBe(200);
  expect(result.after?.body?.data).toHaveLength(4);''')
test = test.replace('''  expect(result.after?.body?.data.map((meal: { name: string }) => meal.name)).toEqual([
    "breakfast",
    "lunch",
    "dinner",
  ]);''', '''  expect(result.after?.body?.data.map((meal: { name: string }) => meal.name)).toEqual([
    "breakfast",
    "lunch",
    "dinner",
    "runtime_test_snack",
  ]);''')
test = test.replace('''  // Expected failures are duplicate creation, immutable-name mutation, and
  // historical-evidence deletion. Any additional config failure is a regression.
  expect(failedMealResponses).toHaveLength(3);
  expect(failedMealResponses.filter((entry) => entry.startsWith("400 "))).toHaveLength(1);
  expect(failedMealResponses.filter((entry) => entry.startsWith("409 "))).toHaveLength(2);''', '''  // Expected failures are duplicate creation and immutable-name mutation only.
  expect(failedMealResponses).toHaveLength(2);
  expect(failedMealResponses.filter((entry) => entry.startsWith("400 "))).toHaveLength(1);
  expect(failedMealResponses.filter((entry) => entry.startsWith("409 "))).toHaveLength(1);''')
write(test_path, test)

print('admin workflow batch2 transformations applied')
