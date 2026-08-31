import { Hono, type Context } from "hono";
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

    // The requested meal remains service-active through the eligible billing
    // month so every confirmed entry is captured by that month's immutable
    // bill snapshot. Once that billing cycle closes, stop future service even
    // if resident balances/refunds still need time to settle.
    const serviceEndedAt = new Date().toISOString();
    const serviceEnd = await c.env.DB.prepare(
      `UPDATE meal_configurations
          SET status = 'ARCHIVED', updated_at = ?
        WHERE id = ? AND institution_id = ?
          AND deletion_finalized_at IS NULL AND status <> 'ARCHIVED'`,
    ).bind(serviceEndedAt, meal.id, principal.institutionId).run();
    if (Number(serviceEnd.meta.changes ?? 0) > 0) {
      await writeAudit(c, principal, "MEAL_CONFIGURATION_DELETION_SERVICE_ENDED", meal.id, {
        eligibleMonth: meal.deletion_eligible_month,
        eligibleYear: meal.deletion_eligible_year,
      });
    }

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

  const body = await readBody(c);
  if (!body) return c.json({ success: false, error: "Invalid JSON body" }, 400);

  if (existing.deletion_requested_at) {
    if (stringValue(body, "action") !== "REVIVE") {
      return c.json({
        success: false,
        error: "Meal is in the deletion queue. Revive it before making configuration changes.",
      }, 409);
    }

    const revivedAt = new Date().toISOString();
    const result = await c.env.DB.prepare(
      `UPDATE meal_configurations
          SET deletion_requested_at = NULL,
              deletion_eligible_month = NULL, deletion_eligible_year = NULL,
              deletion_requested_by = NULL, deletion_finalized_at = NULL,
              status = 'ACTIVE', updated_at = ?
        WHERE id = ? AND institution_id = ?
          AND deletion_requested_at IS NOT NULL AND deletion_finalized_at IS NULL`,
    ).bind(revivedAt, id, principal.institutionId).run();
    if (Number(result.meta.changes ?? 0) === 0) {
      return c.json({ success: false, error: "Meal can no longer be revived" }, 409);
    }

    const revived = await mealById(c, principal, id);
    if (!revived) return c.json({ success: false, error: "Meal could not be loaded after revival" }, 500);
    await writeAudit(c, principal, "MEAL_CONFIGURATION_DELETION_REVIVED", id, {
      before: mappedMeal(existing),
      after: mappedMeal(revived),
    });
    return c.json({ success: true, data: mappedMeal(revived) });
  }
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
        SET deletion_requested_at = ?,
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
