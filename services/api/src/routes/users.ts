import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";
import { hashPassword, tokenDigest } from "../auth/crypto";
import type { AppEnv } from "../types";

const SESSION_COOKIE = "boardops_session";
const REVIEW_FIELDS = new Set(["name", "institutionUserId", "phone", "email", "room", "gender"]);

type AdminViewer = {
  id: string;
  institution_id: string;
  role: "SUPER_ADMIN" | "ADMIN" | "MANAGER" | "USER";
};

type UserRow = {
  id: string;
  institution_id: string;
  name: string;
  email: string;
  phone: string | null;
  role: "SUPER_ADMIN" | "ADMIN" | "MANAGER" | "USER";
  status: "ACTIVE" | "PENDING" | "SUSPENDED" | "ARCHIVED" | "INACTIVE";
  institution_user_id: string | null;
  email_verified: number;
  avatar_url: string | null;
  room: string | null;
  gender: string | null;
  emergency_contact: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  deletion_reason: string | null;
};

type UserListRow = UserRow & {
  institution_name: string;
  review_cycle: number | null;
  review_status: string | null;
  review_reason: string | null;
  correction_fields_json: string | null;
  review_updated_at: string | null;
};

function readSessionToken(c: Context<AppEnv>): string | null {
  const cookie = getCookie(c, SESSION_COOKIE);
  if (cookie) return cookie;
  const authorization = c.req.header("authorization");
  if (!authorization?.toLowerCase().startsWith("bearer ")) return null;
  return authorization.slice(7).trim() || null;
}

async function currentAdmin(c: Context<AppEnv>): Promise<AdminViewer | null> {
  const token = readSessionToken(c);
  if (!token) return null;
  const digest = await tokenDigest(token);
  const row = await c.env.DB.prepare(
    `SELECT u.id, u.institution_id, u.role
     FROM user_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_digest = ?
       AND s.revoked_at IS NULL
       AND s.expires_at > ?
       AND u.status = 'ACTIVE'
       AND u.deleted_at IS NULL
     LIMIT 1`,
  )
    .bind(digest, new Date().toISOString())
    .first<AdminViewer>();
  if (!row || (row.role !== "ADMIN" && row.role !== "SUPER_ADMIN")) return null;
  return row;
}

async function readBody(c: Context<AppEnv>): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await c.req.json();
    return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  } catch {
    return null;
  }
}

function parseStringArray(value: string | null): string[] | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : null;
  } catch {
    return null;
  }
}

function mappedUser(row: UserListRow) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    status: row.status,
    room: row.room,
    gender: row.gender,
    emergencyContact: row.emergency_contact,
    avatarUrl: row.avatar_url,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    deletedAt: row.deleted_at,
    deletionReason: row.deletion_reason,
    emailVerified: row.email_verified === 1,
    institutionName: row.institution_name,
    institutionUserId: row.institution_user_id,
    changesRequested: row.review_status === "CHANGES_REQUESTED" ? row.correction_fields_json : null,
    changesRequestReason: row.review_status === "CHANGES_REQUESTED" ? row.review_reason : null,
    changesRequestedAt: row.review_status === "CHANGES_REQUESTED" ? row.review_updated_at : null,
    rejectionReason: row.review_status === "REJECTED" ? row.review_reason : null,
  };
}

async function targetUser(c: Context<AppEnv>, admin: AdminViewer, id: string): Promise<UserRow | null> {
  return c.env.DB.prepare(
    `SELECT id, institution_id, name, email, phone, role, status, institution_user_id,
            email_verified, avatar_url, room, gender, emergency_contact, last_login_at,
            created_at, updated_at, deleted_at, deletion_reason
     FROM users WHERE id = ? AND institution_id = ? LIMIT 1`,
  )
    .bind(id, admin.institution_id)
    .first<UserRow>();
}

async function audit(
  c: Context<AppEnv>,
  admin: AdminViewer,
  action: string,
  targetId: string,
  metadata: Record<string, unknown>,
  reason: string | null = null,
) {
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO audit_events
      (id, institution_id, actor_user_id, action, entity_type, entity_id,
       request_id, reason, metadata_json, created_at)
     VALUES (?, ?, ?, ?, 'User', ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      admin.institution_id,
      admin.id,
      action,
      targetId,
      c.get("requestId"),
      reason,
      JSON.stringify(metadata),
      now,
    )
    .run();
}

async function latestRegistration(c: Context<AppEnv>, userId: string) {
  return c.env.DB.prepare(
    `SELECT id, cycle, status, reason, fields_needing_correction_json, reviewed_at, created_at
     FROM registration_requests WHERE user_id = ? ORDER BY cycle DESC LIMIT 1`,
  )
    .bind(userId)
    .first<{
      id: string;
      cycle: number;
      status: string;
      reason: string | null;
      fields_needing_correction_json: string | null;
      reviewed_at: string | null;
      created_at: string;
    }>();
}

export const userRoutes = new Hono<AppEnv>();

userRoutes.get("/users", async (c) => {
  const admin = await currentAdmin(c);
  if (!admin) return c.json({ success: false, error: "Administrator access required" }, 403);
  const q = (c.req.query("q") ?? "").trim().toLowerCase().slice(0, 120);
  const like = `%${q}%`;

  const rows = await c.env.DB.prepare(
    `SELECT
       u.id, u.institution_id, u.name, u.email, u.phone, u.role, u.status,
       u.institution_user_id, u.email_verified, u.avatar_url, u.room, u.gender,
       u.emergency_contact, u.last_login_at, u.created_at, u.updated_at,
       u.deleted_at, u.deletion_reason,
       i.name AS institution_name,
       rr.cycle AS review_cycle,
       rr.status AS review_status,
       rr.reason AS review_reason,
       rr.fields_needing_correction_json AS correction_fields_json,
       COALESCE(rr.reviewed_at, rr.updated_at) AS review_updated_at
     FROM users u
     JOIN institutions i ON i.id = u.institution_id
     LEFT JOIN registration_requests rr ON rr.id = (
       SELECT id FROM registration_requests x
       WHERE x.user_id = u.id
       ORDER BY x.cycle DESC
       LIMIT 1
     )
     WHERE u.institution_id = ?
       AND (? = '' OR lower(u.name) LIKE ? OR lower(u.email) LIKE ? OR lower(COALESCE(u.institution_user_id, '')) LIKE ?)
     ORDER BY CASE u.status WHEN 'PENDING' THEN 0 WHEN 'ACTIVE' THEN 1 ELSE 2 END, u.created_at DESC
     LIMIT 250`,
  )
    .bind(admin.institution_id, q, like, like, like)
    .all<UserListRow>();

  return c.json({ success: true, data: rows.results.map(mappedUser) });
});

userRoutes.patch("/users/:id/request-changes", async (c) => {
  const admin = await currentAdmin(c);
  if (!admin) return c.json({ success: false, error: "Administrator access required" }, 403);
  const user = await targetUser(c, admin, c.req.param("id"));
  if (!user) return c.json({ success: false, error: "User not found" }, 404);
  if (user.status !== "PENDING") return c.json({ success: false, error: "Changes can only be requested for pending users" }, 422);

  const body = await readBody(c);
  if (!body) return c.json({ success: false, error: "Invalid JSON body" }, 400);
  const fields = Array.isArray(body.fields) ? body.fields.filter((value): value is string => typeof value === "string") : [];
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (fields.length === 0 || fields.some((field) => !REVIEW_FIELDS.has(field))) {
    return c.json({ success: false, error: "Select at least one valid field to correct" }, 400);
  }
  if (reason.length < 3 || reason.length > 1000) return c.json({ success: false, error: "A reason is required" }, 400);

  const latest = await latestRegistration(c, user.id);
  if (!latest || latest.status !== "PENDING_REVIEW") {
    return c.json({ success: false, error: "Registration is not awaiting review" }, 409);
  }
  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE registration_requests
       SET status = 'CHANGES_REQUESTED', reason = ?, fields_needing_correction_json = ?,
           reviewed_by = ?, reviewed_at = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(reason, JSON.stringify([...new Set(fields)]), admin.id, now, now, latest.id),
    c.env.DB.prepare(
      `INSERT INTO audit_events
        (id, institution_id, actor_user_id, action, entity_type, entity_id,
         request_id, reason, metadata_json, created_at)
       VALUES (?, ?, ?, 'USER_REQUEST_CHANGES', 'User', ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), admin.institution_id, admin.id, user.id, c.get("requestId"), reason,
      JSON.stringify({ fields: [...new Set(fields)], cycle: latest.cycle }), now,
    ),
  ]);

  return c.json({ success: true, data: { id: user.id, status: "PENDING", changesRequested: [...new Set(fields)] } });
});

userRoutes.patch("/users/:id/reject", async (c) => {
  const admin = await currentAdmin(c);
  if (!admin) return c.json({ success: false, error: "Administrator access required" }, 403);
  const user = await targetUser(c, admin, c.req.param("id"));
  if (!user) return c.json({ success: false, error: "User not found" }, 404);
  if (user.status !== "PENDING") return c.json({ success: false, error: "Only pending users can be rejected" }, 422);
  const body = await readBody(c);
  if (!body) return c.json({ success: false, error: "Invalid JSON body" }, 400);
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 3 || reason.length > 1000) return c.json({ success: false, error: "A reason is required" }, 400);

  const latest = await latestRegistration(c, user.id);
  if (!latest) return c.json({ success: false, error: "Registration review record not found" }, 409);
  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE users SET status = 'ARCHIVED', deleted_at = ?, deletion_reason = ?, updated_at = ? WHERE id = ?`,
    ).bind(now, `Rejected: ${reason}`, now, user.id),
    c.env.DB.prepare(
      `UPDATE registration_requests
       SET status = 'REJECTED', reason = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(reason, admin.id, now, now, latest.id),
    c.env.DB.prepare(
      `INSERT INTO audit_events
        (id, institution_id, actor_user_id, action, entity_type, entity_id,
         request_id, reason, metadata_json, created_at)
       VALUES (?, ?, ?, 'USER_REJECTED', 'User', ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), admin.institution_id, admin.id, user.id, c.get("requestId"), reason,
      JSON.stringify({ oldStatus: user.status, newStatus: "ARCHIVED", cycle: latest.cycle }), now,
    ),
  ]);

  return c.json({ success: true, data: { id: user.id, status: "ARCHIVED" } });
});

userRoutes.patch("/users/:id", async (c) => {
  const admin = await currentAdmin(c);
  if (!admin) return c.json({ success: false, error: "Administrator access required" }, 403);
  const user = await targetUser(c, admin, c.req.param("id"));
  if (!user) return c.json({ success: false, error: "User not found" }, 404);
  const body = await readBody(c);
  if (!body) return c.json({ success: false, error: "Invalid JSON body" }, 400);
  const action = typeof body.action === "string" ? body.action : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const validActions = new Set(["APPROVE", "SUSPEND", "ACTIVATE", "DEACTIVATE", "ARCHIVE", "RESTORE", "ASSIGN_ROLE"]);
  if (!validActions.has(action)) return c.json({ success: false, error: "Invalid user action" }, 400);

  let nextStatus = user.status;
  let nextRole = user.role;
  if (action === "APPROVE") {
    if (user.status !== "PENDING") return c.json({ success: false, error: "Only pending users can be approved" }, 422);
    if (user.email_verified !== 1) return c.json({ success: false, error: "Email must be verified before approval" }, 422);
    const approvalReview = await latestRegistration(c, user.id);
    if (!approvalReview || approvalReview.status !== "PENDING_REVIEW") {
      return c.json({ success: false, error: "Registration is not awaiting approval" }, 409);
    }
    nextStatus = "ACTIVE";
  } else if (action === "SUSPEND") {
    if (reason.length < 3) return c.json({ success: false, error: "A reason is required" }, 400);
    nextStatus = "SUSPENDED";
  } else if (action === "ACTIVATE" || action === "RESTORE") {
    nextStatus = "ACTIVE";
  } else if (action === "DEACTIVATE") {
    if (reason.length < 3) return c.json({ success: false, error: "A reason is required" }, 400);
    nextStatus = "INACTIVE";
  } else if (action === "ARCHIVE") {
    if (reason.length < 3) return c.json({ success: false, error: "A reason is required" }, 400);
    nextStatus = "ARCHIVED";
  } else if (action === "ASSIGN_ROLE") {
    const role = typeof body.role === "string" ? body.role : "";
    if (!["SUPER_ADMIN", "ADMIN", "MANAGER", "USER"].includes(role)) return c.json({ success: false, error: "Role is required" }, 400);
    if ((user.role === "ADMIN" || user.role === "SUPER_ADMIN") && role !== "ADMIN" && role !== "SUPER_ADMIN") {
      const count = await c.env.DB.prepare(
        `SELECT COUNT(*) AS count FROM users
         WHERE institution_id = ? AND role IN ('ADMIN', 'SUPER_ADMIN') AND status = 'ACTIVE' AND deleted_at IS NULL`,
      )
        .bind(admin.institution_id)
        .first<{ count: number }>();
      if (Number(count?.count ?? 0) <= 1) {
        return c.json({ success: false, error: "Cannot demote the last active administrator" }, 422);
      }
    }
    nextRole = role as UserRow["role"];
  }

  const latest = await latestRegistration(c, user.id);
  const now = new Date().toISOString();
  const statements = [
    c.env.DB.prepare(
      `UPDATE users
       SET status = ?, role = ?, deleted_at = CASE WHEN ? = 'RESTORE' THEN NULL ELSE deleted_at END,
           deletion_reason = CASE WHEN ? = 'RESTORE' THEN NULL ELSE deletion_reason END,
           updated_at = ?
       WHERE id = ?`,
    ).bind(nextStatus, nextRole, action, action, now, user.id),
    c.env.DB.prepare(
      `INSERT INTO audit_events
        (id, institution_id, actor_user_id, action, entity_type, entity_id,
         request_id, reason, metadata_json, created_at)
       VALUES (?, ?, ?, ?, 'User', ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), admin.institution_id, admin.id, `USER_${action}`, user.id,
      c.get("requestId"), reason || null,
      JSON.stringify({ oldStatus: user.status, newStatus: nextStatus, oldRole: user.role, newRole: nextRole }), now,
    ),
  ];

  if (action === "APPROVE" && latest?.status === "PENDING_REVIEW") {
    statements.push(
      c.env.DB.prepare(
        `UPDATE registration_requests
         SET status = 'APPROVED', reason = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
         WHERE id = ?`,
      ).bind(reason || null, admin.id, now, now, latest.id),
    );
  }
  await c.env.DB.batch(statements);

  return c.json({ success: true, data: { id: user.id, name: user.name, email: user.email, role: nextRole, status: nextStatus } });
});

userRoutes.put("/users/:id", async (c) => {
  const admin = await currentAdmin(c);
  if (!admin) return c.json({ success: false, error: "Administrator access required" }, 403);
  const user = await targetUser(c, admin, c.req.param("id"));
  if (!user) return c.json({ success: false, error: "User not found" }, 404);
  const body = await readBody(c);
  if (!body) return c.json({ success: false, error: "Invalid JSON body" }, 400);

  const assignments: string[] = [];
  const values: unknown[] = [];
  const setField = (column: string, value: unknown) => { assignments.push(`${column} = ?`); values.push(value); };
  if ("name" in body) {
    const value = typeof body.name === "string" ? body.name.trim() : "";
    if (value.length < 2 || value.length > 100) return c.json({ success: false, error: "Name must be 2 to 100 characters" }, 400);
    setField("name", value);
  }
  if ("email" in body) {
    const value = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)) return c.json({ success: false, error: "Invalid email" }, 400);
    const taken = await c.env.DB.prepare(`SELECT id FROM users WHERE lower(email) = ? AND id <> ? LIMIT 1`).bind(value, user.id).first<{ id: string }>();
    if (taken) return c.json({ success: false, error: "This email is already in use" }, 409);
    setField("email", value);
    setField("email_verified", 0);
  }
  if ("phone" in body) {
    const value = body.phone == null || body.phone === "" ? null : String(body.phone).trim();
    if (value && (value.length < 8 || value.length > 32)) return c.json({ success: false, error: "Invalid phone" }, 400);
    if (value) {
      const taken = await c.env.DB.prepare(`SELECT id FROM users WHERE institution_id = ? AND phone = ? AND id <> ? LIMIT 1`).bind(admin.institution_id, value, user.id).first<{ id: string }>();
      if (taken) return c.json({ success: false, error: "This phone number is already in use" }, 409);
    }
    setField("phone", value);
  }
  if ("room" in body) setField("room", body.room == null || body.room === "" ? null : String(body.room).trim().slice(0, 64));
  if ("gender" in body) {
    const value = body.gender == null || body.gender === "" ? null : String(body.gender).toUpperCase();
    if (value && !["MALE", "FEMALE", "OTHER"].includes(value)) return c.json({ success: false, error: "Invalid gender" }, 400);
    setField("gender", value);
  }
  if ("emergencyContact" in body) setField("emergency_contact", body.emergencyContact == null || body.emergencyContact === "" ? null : String(body.emergencyContact).trim().slice(0, 64));
  if (typeof body.password === "string" && body.password) setField("password_hash", await hashPassword(body.password));
  if (assignments.length === 0) return c.json({ success: true, data: { id: user.id } });

  const now = new Date().toISOString();
  assignments.push("updated_at = ?");
  values.push(now, user.id);
  await c.env.DB.prepare(`UPDATE users SET ${assignments.join(", ")} WHERE id = ?`).bind(...values).run();
  await audit(c, admin, "USER_EDIT", user.id, { fields: assignments.map((entry) => entry.split(" = ")[0]) });

  const updated = await targetUser(c, admin, user.id);
  return c.json({
    success: true,
    data: updated ? {
      id: updated.id, name: updated.name, email: updated.email, phone: updated.phone, role: updated.role,
      status: updated.status, room: updated.room, gender: updated.gender, emergencyContact: updated.emergency_contact,
      avatarUrl: updated.avatar_url, createdAt: updated.created_at, lastLoginAt: updated.last_login_at,
    } : { id: user.id },
  });
});

userRoutes.delete("/users/:id", async (c) => {
  const admin = await currentAdmin(c);
  if (!admin) return c.json({ success: false, error: "Administrator access required" }, 403);
  const user = await targetUser(c, admin, c.req.param("id"));
  if (!user) return c.json({ success: false, error: "User not found" }, 404);
  const body = await readBody(c);
  const reason = body && typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 3) return c.json({ success: false, error: "A reason is required for deletion" }, 400);
  if (user.id === admin.id) return c.json({ success: false, error: "You cannot delete your own active account" }, 422);
  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE users SET status = 'ARCHIVED', deleted_at = ?, deletion_reason = ?, updated_at = ? WHERE id = ?`).bind(now, reason, now, user.id),
    c.env.DB.prepare(`UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`).bind(now, user.id),
  ]);
  await audit(c, admin, "USER_DELETE", user.id, { oldStatus: user.status, newStatus: "ARCHIVED" }, reason);
  return c.json({ success: true, data: { id: user.id, status: "ARCHIVED", deletedAt: now, deletionReason: reason } });
});

userRoutes.post("/users/:id/restore", async (c) => {
  const admin = await currentAdmin(c);
  if (!admin) return c.json({ success: false, error: "Administrator access required" }, 403);
  const user = await targetUser(c, admin, c.req.param("id"));
  if (!user) return c.json({ success: false, error: "User not found" }, 404);
  if (!user.deleted_at) return c.json({ success: false, error: "User is not in the deletion queue" }, 422);
  const now = new Date().toISOString();
  await c.env.DB.prepare(`UPDATE users SET status = 'ACTIVE', deleted_at = NULL, deletion_reason = NULL, updated_at = ? WHERE id = ?`)
    .bind(now, user.id).run();
  await audit(c, admin, "USER_RESTORE_DELETED", user.id, { restored: true });
  return c.json({ success: true, data: { id: user.id, status: "ACTIVE", deletedAt: null, deletionReason: null } });
});
