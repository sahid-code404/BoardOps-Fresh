import { Hono, type Context } from "hono";
import { authenticatedPrincipal } from "../auth/authorization";
import { computeEditableUntilIso, enumerateDates, isDateString } from "../meals/engine";
import type { AppEnv } from "../types";

type LeaveRow = {
  id: string;
  institution_id: string;
  user_id: string;
  start_date: string;
  end_date: string;
  reason: string;
  status: string;
  approved_by: string | null;
  meal_type: string;
  meal_ids_json: string | null;
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
  user_name: string;
  user_email: string;
  user_room: string | null;
  user_avatar_url: string | null;
};

type MealRow = {
  id: string;
  default_state: "ON" | "OFF";
  cutoff_strategy: string;
  cutoff_offset_minutes: number;
  cutoff_time: string;
  service_schedule: "DAILY" | "DATE_SPECIFIC";
  service_date: string | null;
};

export const leaveRoutes = new Hono<AppEnv>();

function mappedLeave(row: LeaveRow) {
  return {
    id: row.id,
    startDate: row.start_date,
    endDate: row.end_date,
    reason: row.reason,
    status: row.status,
    mealType: row.meal_type,
    mealIds: row.meal_ids_json,
    adminNotes: row.admin_notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    user: {
      id: row.user_id,
      name: row.user_name,
      email: row.user_email,
      room: row.user_room,
      avatarUrl: row.user_avatar_url,
    },
  };
}

function parseStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.trim())) return null;
  return [...new Set(value.map((item) => item.trim()))];
}

async function leaveById(c: Context<AppEnv>, institutionId: string, id: string): Promise<LeaveRow | null> {
  return c.env.DB.prepare(
    `SELECT l.id, l.institution_id, l.user_id, l.start_date, l.end_date, l.reason,
            l.status, l.approved_by, l.meal_type, l.meal_ids_json, l.admin_notes,
            l.created_at, l.updated_at,
            u.name AS user_name, u.email AS user_email, u.room AS user_room,
            u.avatar_url AS user_avatar_url
       FROM leave_applications l
       JOIN users u ON u.id = l.user_id
      WHERE l.id = ? AND l.institution_id = ? LIMIT 1`,
  ).bind(id, institutionId).first<LeaveRow>();
}

leaveRoutes.get("/leave", async (c) => {
  const principal = await authenticatedPrincipal(c);
  if (!principal) return c.json({ success: false, error: "Authentication required" }, 401);

  const onlySelf = principal.role === "USER";
  const result = await c.env.DB.prepare(
    `SELECT l.id, l.institution_id, l.user_id, l.start_date, l.end_date, l.reason,
            l.status, l.approved_by, l.meal_type, l.meal_ids_json, l.admin_notes,
            l.created_at, l.updated_at,
            u.name AS user_name, u.email AS user_email, u.room AS user_room,
            u.avatar_url AS user_avatar_url
       FROM leave_applications l
       JOIN users u ON u.id = l.user_id
      WHERE l.institution_id = ? AND (? = 0 OR l.user_id = ?)
      ORDER BY l.created_at DESC`,
  ).bind(principal.institutionId, onlySelf ? 1 : 0, principal.id).all<LeaveRow>();

  return c.json({ success: true, data: result.results.map(mappedLeave) });
});

leaveRoutes.post("/leave", async (c) => {
  const principal = await authenticatedPrincipal(c);
  if (!principal) return c.json({ success: false, error: "Authentication required" }, 401);

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await c.req.json();
    body = typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : {};
  } catch {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const startDate = typeof body.startDate === "string" ? body.startDate.trim() : "";
  const endDate = typeof body.endDate === "string" ? body.endDate.trim() : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const mealType = typeof body.mealType === "string" ? body.mealType.trim() : "ALL";
  const mealIds = body.mealIds === undefined ? [] : parseStringArray(body.mealIds);
  if (!isDateString(startDate) || !isDateString(endDate) || endDate < startDate) {
    return c.json({ success: false, error: "Leave dates must be valid and endDate must not precede startDate" }, 400);
  }
  if (!enumerateDates(startDate, endDate, 90)) {
    return c.json({ success: false, error: "A single leave application may cover at most 90 days" }, 400);
  }
  if (reason.length < 3 || reason.length > 500) {
    return c.json({ success: false, error: "Leave reason must be 3–500 characters" }, 400);
  }
  if (mealType !== "ALL" && mealType !== "SPECIFIC") {
    return c.json({ success: false, error: "mealType must be ALL or SPECIFIC" }, 400);
  }
  if (mealIds === null) return c.json({ success: false, error: "mealIds must be an array of meal ids" }, 400);
  if (mealType === "SPECIFIC" && mealIds.length === 0) {
    return c.json({ success: false, error: "Select at least one meal for a specific-meal leave" }, 400);
  }

  const overlapping = await c.env.DB.prepare(
    `SELECT id, status
       FROM leave_applications
      WHERE institution_id = ? AND user_id = ?
        AND status IN ('PENDING','APPROVED')
        AND start_date <= ? AND end_date >= ?
      LIMIT 1`,
  ).bind(principal.institutionId, principal.id, endDate, startDate).first<{ id: string; status: string }>();
  if (overlapping) {
    return c.json(
      { success: false, error: `Leave dates overlap an existing ${overlapping.status.toLowerCase()} application` },
      409,
    );
  }

  if (mealType === "SPECIFIC") {
    const placeholders = mealIds.map(() => "?").join(", ");
    const valid = await c.env.DB.prepare(
      `SELECT id FROM meal_configurations
        WHERE institution_id = ? AND status = 'ACTIVE' AND id IN (${placeholders})`,
    ).bind(principal.institutionId, ...mealIds).all<{ id: string }>();
    if (valid.results.length !== mealIds.length) {
      return c.json({ success: false, error: "One or more selected meals are invalid or inactive" }, 400);
    }
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO leave_applications
        (id, institution_id, user_id, start_date, end_date, reason, status,
         approved_by, meal_type, meal_ids_json, admin_notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'PENDING', NULL, ?, ?, NULL, ?, ?)`,
    ).bind(id, principal.institutionId, principal.id, startDate, endDate, reason, mealType, JSON.stringify(mealIds), now, now),
    c.env.DB.prepare(
      `INSERT INTO audit_events
        (id, institution_id, actor_user_id, action, entity_type, entity_id,
         request_id, reason, metadata_json, created_at)
       VALUES (?, ?, ?, 'LEAVE_APPLICATION_CREATED', 'LeaveApplication', ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), principal.institutionId, principal.id, id, c.get("requestId"), reason,
      JSON.stringify({ startDate, endDate, mealType, mealIds }), now,
    ),
  ]);

  const created = await leaveById(c, principal.institutionId, id);
  return c.json({ success: true, data: created ? mappedLeave(created) : { id, startDate, endDate, reason, status: "PENDING" } }, 201);
});

leaveRoutes.patch("/leave/:id", async (c) => {
  const principal = await authenticatedPrincipal(c);
  if (!principal) return c.json({ success: false, error: "Authentication required" }, 401);

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await c.req.json();
    body = typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : {};
  } catch {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }
  const status = typeof body.status === "string" ? body.status.trim() : "";
  const adminNotes = typeof body.adminNotes === "string" ? body.adminNotes.trim() || null : null;
  if (status !== "APPROVED" && status !== "REJECTED") {
    return c.json({ success: false, error: "status must be APPROVED or REJECTED" }, 400);
  }
  if ((adminNotes?.length ?? 0) > 500) return c.json({ success: false, error: "Admin notes are too long" }, 400);

  const id = c.req.param("id");
  const existing = await leaveById(c, principal.institutionId, id);
  if (!existing) return c.json({ success: false, error: "Leave application not found" }, 404);
  if (existing.status !== "PENDING") {
    return c.json({ success: false, error: `Application already ${existing.status.toLowerCase()}` }, 409);
  }

  if (status === "APPROVED") {
    const lockedPeriod = await c.env.DB.prepare(
      `SELECT period_key, status
         FROM accounting_periods
        WHERE institution_id = ? AND status IN ('CLOSING','CLOSED')
          AND starts_on <= ? AND ends_on >= ?
        ORDER BY starts_on ASC
        LIMIT 1`,
    ).bind(principal.institutionId, existing.end_date, existing.start_date)
      .first<{ period_key: string; status: string }>();
    if (lockedPeriod) {
      return c.json(
        { success: false, error: `Leave cannot change meals in ${lockedPeriod.status.toLowerCase()} accounting period ${lockedPeriod.period_key}` },
        409,
      );
    }
  }

  const now = new Date().toISOString();
  const statements = [
    c.env.DB.prepare(
      `UPDATE leave_applications
          SET status = ?, approved_by = ?, admin_notes = ?, updated_at = ?
        WHERE id = ? AND institution_id = ? AND status = 'PENDING'`,
    ).bind(status, principal.id, adminNotes, now, id, principal.institutionId),
  ];

  if (status === "APPROVED") {
    const dates = enumerateDates(existing.start_date, existing.end_date, 90);
    if (!dates) return c.json({ success: false, error: "Leave period is invalid or exceeds 90 days" }, 400);

    let selectedMealIds: string[] = [];
    if (existing.meal_type === "SPECIFIC") {
      try {
        const parsed: unknown = JSON.parse(existing.meal_ids_json || "[]");
        selectedMealIds = Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
      } catch {
        selectedMealIds = [];
      }
    }

    const mealSql = existing.meal_type === "SPECIFIC" && selectedMealIds.length > 0
      ? `SELECT id, default_state, cutoff_strategy, cutoff_offset_minutes, cutoff_time,
              service_schedule, service_date
       FROM meal_configurations
          WHERE institution_id = ? AND status = 'ACTIVE' AND id IN (${selectedMealIds.map(() => "?").join(", ")})`
      : `SELECT id, default_state, cutoff_strategy, cutoff_offset_minutes, cutoff_time,
              service_schedule, service_date
       FROM meal_configurations
          WHERE institution_id = ? AND status = 'ACTIVE'`;
    const meals = await c.env.DB.prepare(mealSql)
      .bind(principal.institutionId, ...selectedMealIds)
      .all<MealRow>();
    const institution = await c.env.DB.prepare(`SELECT timezone FROM institutions WHERE id = ? LIMIT 1`)
      .bind(principal.institutionId).first<{ timezone: string }>();
    const timeZone = institution?.timezone || "UTC";

    for (const meal of meals.results) {
      for (const serviceDate of dates) {
        if (meal.service_schedule === "DATE_SPECIFIC" && meal.service_date !== serviceDate) continue;
        const editableUntil = computeEditableUntilIso(meal, serviceDate, timeZone);
        const entryId = crypto.randomUUID();
        statements.push(
          c.env.DB.prepare(
            `INSERT INTO meal_entries
              (id, institution_id, user_id, meal_id, service_date, status, original_state,
               editable_until, locked, notes, updated_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'OFF', ?, ?, 1, ?, ?, ?, ?)
             ON CONFLICT(institution_id, user_id, meal_id, service_date) DO UPDATE SET
               status = 'OFF', locked = 1,
               notes = excluded.notes, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
          ).bind(
            entryId,
            principal.institutionId,
            existing.user_id,
            meal.id,
            serviceDate,
            meal.default_state,
            editableUntil,
            `Leave application ${id} approved`,
            principal.id,
            now,
            now,
          ),
        );
      }
    }
  }

  statements.push(
    c.env.DB.prepare(
      `INSERT INTO audit_events
        (id, institution_id, actor_user_id, action, entity_type, entity_id,
         request_id, reason, metadata_json, created_at)
       VALUES (?, ?, ?, ?, 'LeaveApplication', ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      principal.institutionId,
      principal.id,
      status === "APPROVED" ? "LEAVE_APPROVED" : "LEAVE_REJECTED",
      id,
      c.get("requestId"),
      adminNotes,
      JSON.stringify({
        userId: existing.user_id,
        startDate: existing.start_date,
        endDate: existing.end_date,
        mealType: existing.meal_type,
        residentBaselinePreserved: status === "APPROVED",
      }),
      now,
    ),
  );

  await c.env.DB.batch(statements);
  const updated = await leaveById(c, principal.institutionId, id);
  return c.json({ success: true, data: updated ? mappedLeave(updated) : { id, status } });
});
