import { Hono } from "hono";
import { authenticatedPrincipal } from "../auth/authorization";
import { computeEditableUntilIso, isBeforeEnrollment, isDateString, isLockedAt } from "../meals/engine";
import type { AppEnv } from "../types";

type MealRow = {
  id: string;
  display_name: string;
  default_state: "ON" | "OFF";
  cutoff_strategy: string;
  cutoff_offset_minutes: number;
  cutoff_time: string;
};

type EntryRow = {
  id: string;
  status: "ON" | "OFF" | "LOCKED";
  original_state: "ON" | "OFF";
  editable_until: string;
  locked: number;
  notes: string | null;
};

const ACTIONS = new Set(["TURN_ON", "TURN_OFF", "LOCK", "UNLOCK"]);

export const mealOverrideRoutes = new Hono<AppEnv>();

mealOverrideRoutes.post("/meals/override", async (c) => {
  const principal = await authenticatedPrincipal(c);
  if (!principal) return c.json({ success: false, error: "Authentication required" }, 401);

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await c.req.json();
    body = typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : {};
  } catch {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const mealId = typeof body.mealId === "string" ? body.mealId.trim() : "";
  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  const serviceDate = typeof body.serviceDate === "string" ? body.serviceDate.trim() : "";
  const action = typeof body.action === "string" ? body.action.trim() : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!mealId || !userId || !isDateString(serviceDate) || !ACTIONS.has(action)) {
    return c.json({ success: false, error: "Valid mealId, userId, serviceDate, and action are required" }, 400);
  }
  if (reason.length < 3 || reason.length > 500) {
    return c.json({ success: false, error: "Override reason must be 3–500 characters" }, 400);
  }

  const [meal, targetUser, institution] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, display_name, default_state, cutoff_strategy, cutoff_offset_minutes, cutoff_time
         FROM meal_configurations
        WHERE id = ? AND institution_id = ? AND status = 'ACTIVE' LIMIT 1`,
    ).bind(mealId, principal.institutionId).first<MealRow>(),
    c.env.DB.prepare(
      `SELECT id, created_at FROM users
        WHERE id = ? AND institution_id = ? AND role = 'USER' AND status = 'ACTIVE' AND deleted_at IS NULL LIMIT 1`,
    ).bind(userId, principal.institutionId).first<{ id: string; created_at: string }>(),
    c.env.DB.prepare(`SELECT timezone FROM institutions WHERE id = ? LIMIT 1`)
      .bind(principal.institutionId)
      .first<{ timezone: string }>(),
  ]);
  if (!meal) return c.json({ success: false, error: "Meal not found or inactive" }, 404);
  if (!targetUser) return c.json({ success: false, error: "User not found or not active" }, 404);

  const timeZone = institution?.timezone || "UTC";
  const editableUntil = computeEditableUntilIso(meal, serviceDate, timeZone);
  const existing = await c.env.DB.prepare(
    `SELECT id, status, original_state, editable_until, locked, notes
       FROM meal_entries
      WHERE institution_id = ? AND user_id = ? AND meal_id = ? AND service_date = ? LIMIT 1`,
  ).bind(principal.institutionId, userId, mealId, serviceDate).first<EntryRow>();

  if (existing) {
    const effectivelyLocked = existing.locked === 1 || existing.status === "LOCKED" || isLockedAt(existing.editable_until);
    if (!effectivelyLocked) {
      return c.json({
        success: false,
        error: "This meal is not locked yet. The resident can still change it before the cutoff.",
      }, 422);
    }
  }

  const entryId = existing?.id ?? crypto.randomUUID();
  const beforeEnrollment = isBeforeEnrollment(serviceDate, targetUser.created_at, meal, timeZone);
  const originalState: "ON" | "OFF" = existing?.original_state ?? (beforeEnrollment ? "OFF" : meal.default_state);
  const previousStatus = existing?.status ?? null;

  // Locking is metadata, not meal state. Historically LOCK wrote the sentinel
  // status "LOCKED", erasing whether the meal was ON or OFF; UNLOCK then guessed
  // ON. Preserve ON/OFF in status and carry lock state only in the dedicated
  // boolean. Legacy sentinel rows are recovered from their immutable
  // original_state rather than guessed.
  const preservedStatus: "ON" | "OFF" = existing?.status === "ON" || existing?.status === "OFF"
    ? existing.status
    : existing?.status === "LOCKED"
      ? existing.original_state
      : originalState;
  const newStatus: "ON" | "OFF" = action === "TURN_ON"
    ? "ON"
    : action === "TURN_OFF"
      ? "OFF"
      : preservedStatus;
  const locked = action === "LOCK" ? 1 : action === "UNLOCK" ? 0 : existing?.locked ?? 0;
  const now = new Date().toISOString();
  const overrideId = crypto.randomUUID();

  const entryStatement = existing
    ? c.env.DB.prepare(
        `UPDATE meal_entries
            SET status = ?, locked = ?, updated_by = ?, updated_at = ?
          WHERE id = ? AND institution_id = ?`,
      ).bind(newStatus, locked, principal.id, now, entryId, principal.institutionId)
    : c.env.DB.prepare(
        `INSERT INTO meal_entries
          (id, institution_id, user_id, meal_id, service_date, status, original_state,
           editable_until, locked, notes, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
      ).bind(
        entryId,
        principal.institutionId,
        userId,
        mealId,
        serviceDate,
        newStatus,
        originalState,
        editableUntil,
        locked,
        principal.id,
        now,
        now,
      );

  await c.env.DB.batch([
    entryStatement,
    c.env.DB.prepare(
      `INSERT INTO meal_overrides
        (id, institution_id, meal_entry_id, meal_id, user_id, service_date, action, reason, admin_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(overrideId, principal.institutionId, entryId, mealId, userId, serviceDate, action, reason, principal.id, now),
    c.env.DB.prepare(
      `INSERT INTO audit_events
        (id, institution_id, actor_user_id, action, entity_type, entity_id,
         request_id, reason, metadata_json, created_at)
       VALUES (?, ?, ?, 'MEAL_OVERRIDE', 'MealEntry', ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      principal.institutionId,
      principal.id,
      entryId,
      c.get("requestId"),
      reason,
      JSON.stringify({ mealId, userId, serviceDate, action, previousStatus, newStatus, originalState, locked }),
      now,
    ),
  ]);

  return c.json({
    success: true,
    data: {
      id: entryId,
      userId,
      mealId,
      serviceDate,
      status: newStatus,
      originalState,
      editableUntil: existing?.editable_until ?? editableUntil,
      locked: locked === 1,
      updatedBy: principal.id,
    },
  });
});
