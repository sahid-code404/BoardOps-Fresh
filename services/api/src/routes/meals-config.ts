import { Hono, type Context } from "hono";
import { authenticatedPrincipal, type AuthPrincipal } from "../auth/authorization";
import type { AppEnv } from "../types";

const MEAL_TYPES = new Set(["REGULAR", "SPECIAL", "GUEST_ONLY", "FESTIVAL", "CUSTOM"]);
const MEAL_STATUSES = new Set(["ACTIVE", "INACTIVE", "ARCHIVED"]);
const DEFAULT_STATES = new Set(["ON", "OFF"]);
const VISIBILITIES = new Set(["VISIBLE", "HIDDEN"]);
const CUTOFF_STRATEGIES = new Set(["PREVIOUS_DAY", "SAME_DAY", "CUSTOM_OFFSET"]);
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
  notes: string | null;
};

type MealEvidenceRow = {
  meal_entries: number;
  guest_meals: number;
  meal_overrides: number;
};

export const mealConfigRoutes = new Hono<AppEnv>();

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
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function readBody(c: Context<AppEnv>): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await c.req.json();
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
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
  const name = stringValue(body, "name") ?? existing?.name;
  const displayName = stringValue(body, "displayName") ?? existing?.display_name;
  const description = nullableString(body, "description");
  const icon = stringValue(body, "icon") ?? existing?.icon ?? "🍽️";
  const color = stringValue(body, "color") ?? existing?.color ?? "#8b5cf6";
  const mealType = stringValue(body, "mealType") ?? existing?.meal_type ?? "REGULAR";
  const status = stringValue(body, "status") ?? existing?.status ?? "ACTIVE";
  const displayOrder = integerValue(body, "displayOrder") ?? existing?.display_order ?? 0;
  const defaultState = stringValue(body, "defaultState") ?? existing?.default_state ?? "ON";
  const defaultVisibility = stringValue(body, "defaultVisibility") ?? existing?.default_visibility ?? "VISIBLE";
  const cutoffStrategy = stringValue(body, "cutoffStrategy") ?? existing?.cutoff_strategy ?? "SAME_DAY";
  const cutoffOffsetMinutes = integerValue(body, "cutoffOffsetMinutes") ?? existing?.cutoff_offset_minutes ?? 0;
  const cutoffTime = stringValue(body, "cutoffTime") ?? existing?.cutoff_time ?? "16:00";
  const startTime = stringValue(body, "startTime") ?? existing?.start_time ?? "08:00";
  const endTime = stringValue(body, "endTime") ?? existing?.end_time ?? "10:00";
  const notes = nullableString(body, "notes");

  if (!name || name.length < 2 || name.length > 80) return { error: "Internal name must be 2–80 characters" };
  if (!/^[a-z0-9][a-z0-9_-]*$/u.test(name)) {
    return { error: "Internal name may use lowercase letters, numbers, hyphens, and underscores" };
  }
  if (!displayName || displayName.length < 2 || displayName.length > 100) {
    return { error: "Display name must be 2–100 characters" };
  }
  if (icon.length > 16) return { error: "Meal icon is too long" };
  if (!COLOR_RE.test(color)) return { error: "Meal color must be a six-digit hex color" };
  if (!MEAL_TYPES.has(mealType)) return { error: "Invalid meal type" };
  if (!MEAL_STATUSES.has(status)) return { error: "Invalid meal status" };
  if (!DEFAULT_STATES.has(defaultState)) return { error: "Invalid default state" };
  if (!VISIBILITIES.has(defaultVisibility)) return { error: "Invalid default visibility" };
  if (!CUTOFF_STRATEGIES.has(cutoffStrategy)) return { error: "Invalid cutoff strategy" };
  if (displayOrder < 0 || displayOrder > 10_000) return { error: "Display order is out of range" };
  if (cutoffOffsetMinutes < 0 || cutoffOffsetMinutes > 1440) return { error: "Cutoff offset is out of range" };
  if (!TIME_RE.test(cutoffTime) || !TIME_RE.test(startTime) || !TIME_RE.test(endTime)) {
    return { error: "Meal times must use HH:mm in 24-hour format" };
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
      notes: notes === undefined ? existing?.notes ?? null : notes,
    },
  };
}

async function mealById(c: Context<AppEnv>, principal: AuthPrincipal, id: string): Promise<MealRow | null> {
  return c.env.DB.prepare(
    `SELECT id, institution_id, name, display_name, description, icon, color,
            meal_type, status, display_order, default_state, default_visibility,
            cutoff_strategy, cutoff_offset_minutes, cutoff_time, start_time,
            end_time, notes, created_at, updated_at
       FROM meal_configurations
      WHERE id = ? AND institution_id = ?
      LIMIT 1`,
  )
    .bind(id, principal.institutionId)
    .first<MealRow>();
}

async function mealEvidence(c: Context<AppEnv>, principal: AuthPrincipal, id: string): Promise<MealEvidenceRow> {
  const row = await c.env.DB.prepare(
    `SELECT
       EXISTS(SELECT 1 FROM meal_entries WHERE institution_id = ? AND meal_id = ? LIMIT 1) AS meal_entries,
       EXISTS(SELECT 1 FROM guest_meals WHERE institution_id = ? AND meal_id = ? LIMIT 1) AS guest_meals,
       EXISTS(SELECT 1 FROM meal_overrides WHERE institution_id = ? AND meal_id = ? LIMIT 1) AS meal_overrides`,
  )
    .bind(
      principal.institutionId,
      id,
      principal.institutionId,
      id,
      principal.institutionId,
      id,
    )
    .first<MealEvidenceRow>();

  return row ?? { meal_entries: 0, guest_meals: 0, meal_overrides: 0 };
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
  )
    .bind(
      crypto.randomUUID(),
      principal.institutionId,
      principal.id,
      action,
      mealId,
      c.get("requestId"),
      JSON.stringify(metadata),
      new Date().toISOString(),
    )
    .run();
}

mealConfigRoutes.get("/meals/config", async (c) => {
  const principal = await authenticatedPrincipal(c);
  if (!principal) return c.json({ success: false, error: "Authentication required" }, 401);

  const canSeeNonActive = principal.role === "ADMIN" || principal.role === "SUPER_ADMIN";
  const rows = await c.env.DB.prepare(
    `SELECT id, institution_id, name, display_name, description, icon, color,
            meal_type, status, display_order, default_state, default_visibility,
            cutoff_strategy, cutoff_offset_minutes, cutoff_time, start_time,
            end_time, notes, created_at, updated_at
       FROM meal_configurations
      WHERE institution_id = ?
        AND (? = 1 OR status = 'ACTIVE')
      ORDER BY
        CASE status WHEN 'ACTIVE' THEN 0 WHEN 'INACTIVE' THEN 1 ELSE 2 END,
        display_order ASC,
        created_at ASC`,
  )
    .bind(principal.institutionId, canSeeNonActive ? 1 : 0)
    .all<MealRow>();

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
  const parsed = validateMealBody({ ...body, status: "ACTIVE" });
  if (!parsed.values) return c.json({ success: false, error: parsed.error ?? "Invalid meal configuration" }, 400);
  const value = parsed.values;

  const duplicate = await c.env.DB.prepare(
    `SELECT id FROM meal_configurations WHERE institution_id = ? AND name = ? LIMIT 1`,
  )
    .bind(principal.institutionId, value.name)
    .first<{ id: string }>();
  if (duplicate) return c.json({ success: false, error: "A meal with this name already exists" }, 409);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO meal_configurations
      (id, institution_id, name, display_name, description, icon, color, meal_type,
       status, display_order, default_state, default_visibility, cutoff_strategy,
       cutoff_offset_minutes, cutoff_time, start_time, end_time, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      principal.institutionId,
      value.name,
      value.displayName,
      value.description,
      value.icon,
      value.color,
      value.mealType,
      value.status,
      value.displayOrder,
      value.defaultState,
      value.defaultVisibility,
      value.cutoffStrategy,
      value.cutoffOffsetMinutes,
      value.cutoffTime,
      value.startTime,
      value.endTime,
      value.notes,
      now,
      now,
    )
    .run();

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
  const requestedName = stringValue(body, "name");
  if (requestedName !== undefined && requestedName !== existing.name) {
    return c.json({ success: false, error: "Meal internal name is immutable after creation" }, 400);
  }
  const parsed = validateMealBody({ ...body, name: existing.name }, existing);
  if (!parsed.values) return c.json({ success: false, error: parsed.error ?? "Invalid meal configuration" }, 400);
  const value = parsed.values;

  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE meal_configurations
        SET name = ?, display_name = ?, description = ?, icon = ?, color = ?,
            meal_type = ?, status = ?, display_order = ?, default_state = ?,
            default_visibility = ?, cutoff_strategy = ?, cutoff_offset_minutes = ?,
            cutoff_time = ?, start_time = ?, end_time = ?, notes = ?, updated_at = ?
      WHERE id = ? AND institution_id = ?`,
  )
    .bind(
      value.name,
      value.displayName,
      value.description,
      value.icon,
      value.color,
      value.mealType,
      value.status,
      value.displayOrder,
      value.defaultState,
      value.defaultVisibility,
      value.cutoffStrategy,
      value.cutoffOffsetMinutes,
      value.cutoffTime,
      value.startTime,
      value.endTime,
      value.notes,
      now,
      id,
      principal.institutionId,
    )
    .run();

  const updated = await mealById(c, principal, id);
  if (!updated) return c.json({ success: false, error: "Meal could not be loaded after update" }, 500);
  await writeAudit(c, principal, "MEAL_CONFIGURATION_UPDATED", id, {
    before: mappedMeal(existing),
    after: mappedMeal(updated),
  });
  return c.json({ success: true, data: mappedMeal(updated) });
});

mealConfigRoutes.delete("/meals/config/:id", async (c) => {
  const principal = await authenticatedPrincipal(c);
  if (!principal) return c.json({ success: false, error: "Authentication required" }, 401);

  const id = c.req.param("id");
  const existing = await mealById(c, principal, id);
  if (!existing) return c.json({ success: false, error: "Meal not found" }, 404);

  const evidence = await mealEvidence(c, principal, id);
  if (evidence.meal_entries || evidence.guest_meals || evidence.meal_overrides) {
    return c.json(
      {
        success: false,
        error: "Meal has historical evidence and cannot be deleted. Archive it instead.",
      },
      409,
    );
  }

  await writeAudit(c, principal, "MEAL_CONFIGURATION_DELETED", id, { before: mappedMeal(existing) });
  await c.env.DB.prepare(
    `DELETE FROM meal_configurations WHERE id = ? AND institution_id = ?`,
  )
    .bind(id, principal.institutionId)
    .run();

  return c.json({ success: true, data: { deleted: true, id } });
});
