import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";
import { tokenDigest } from "../auth/crypto";
import type { AppEnv } from "../types";

const SESSION_COOKIE = "boardops_session";

const DEFAULT_THEME = {
  primary: "#8b5cf6",
  primaryForeground: "#ffffff",
  accent: "#10b981",
  radius: "1.25rem",
  preset: "violet",
  glassMode: "on",
  blurIntensity: "normal",
  transparency: "medium",
} as const;

type Viewer = {
  id: string;
  institution_id: string;
  institution_user_id: string | null;
  name: string;
  email: string;
  phone: string | null;
  role: "SUPER_ADMIN" | "ADMIN" | "MANAGER" | "USER";
  status: "ACTIVE" | "PENDING" | "SUSPENDED" | "ARCHIVED" | "INACTIVE";
  avatar_url: string | null;
  room: string | null;
  gender: string | null;
  emergency_contact: string | null;
  theme: string;
  language: string;
  timezone: string;
  created_at: string;
  last_login_at: string | null;
};

function readSessionToken(c: Context<AppEnv>): string | null {
  return getCookie(c, SESSION_COOKIE)?.trim() || null;
}

async function currentViewer(c: Context<AppEnv>): Promise<Viewer | null> {
  const token = readSessionToken(c);
  if (!token) return null;

  const digest = await tokenDigest(token);
  const now = new Date().toISOString();
  return c.env.DB.prepare(
    `SELECT
       u.id, u.institution_id, u.institution_user_id, u.name, u.email, u.phone,
       u.role, u.status, u.avatar_url, u.room, u.gender, u.emergency_contact,
       u.theme, u.language, u.timezone, u.created_at, u.last_login_at
     FROM user_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_digest = ?
       AND s.revoked_at IS NULL
       AND s.expires_at > ?
       AND u.deleted_at IS NULL
       AND u.status = 'ACTIVE'
     LIMIT 1`,
  )
    .bind(digest, now)
    .first<Viewer>();
}

function safeViewer(user: Viewer) {
  return {
    id: user.id,
    institutionUserId: user.institution_user_id ?? undefined,
    name: user.name,
    email: user.email,
    phone: user.phone ?? undefined,
    role: user.role,
    status: user.status,
    avatarUrl: user.avatar_url ?? undefined,
    room: user.room ?? undefined,
    gender: user.gender,
    emergencyContact: user.emergency_contact,
    theme: user.theme,
    language: user.language,
    timezone: user.timezone,
    twoFactorEnabled: false,
    createdAt: user.created_at,
    lastLoginAt: user.last_login_at,
  };
}

export const runtimeRoutes = new Hono<AppEnv>();

runtimeRoutes.get("/theme", async (c) => {
  const viewer = await currentViewer(c);
  const mode = viewer?.theme === "light" || viewer?.theme === "dark" ? viewer.theme : "system";
  return c.json({ success: true, data: { ...DEFAULT_THEME, mode } });
});

runtimeRoutes.get("/notifications", async (c) => {
  const viewer = await currentViewer(c);
  if (!viewer) return c.json({ success: false, error: "Authentication required" }, 401);

  // Notification persistence belongs to its later domain phase. Returning the
  // canonical empty shape keeps the shell deterministic without fabricating
  // unread counts or triggering repeated 404/retry traffic.
  return c.json({ success: true, data: { notifications: [], unreadCount: 0 } });
});

runtimeRoutes.get("/auth/profile", async (c) => {
  const viewer = await currentViewer(c);
  if (!viewer) return c.json({ success: false, error: "Authentication required" }, 401);
  return c.json({ success: true, data: safeViewer(viewer) });
});

runtimeRoutes.put("/auth/profile", async (c) => {
  const viewer = await currentViewer(c);
  if (!viewer) return c.json({ success: false, error: "Authentication required" }, 401);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const input = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const assignments: string[] = [];
  const values: unknown[] = [];

  const add = (column: string, value: unknown) => {
    assignments.push(`${column} = ?`);
    values.push(value);
  };

  if ("name" in input) {
    const value = typeof input.name === "string" ? input.name.trim() : "";
    if (value.length < 2 || value.length > 100) return c.json({ success: false, error: "Name must be 2 to 100 characters" }, 400);
    add("name", value);
  }

  if ("phone" in input) {
    const value = input.phone == null || input.phone === "" ? null : String(input.phone).trim();
    if (value && value.length > 32) return c.json({ success: false, error: "Phone number is too long" }, 400);
    add("phone", value);
  }

  if ("room" in input) {
    const value = input.room == null || input.room === "" ? null : String(input.room).trim();
    if (value && value.length > 64) return c.json({ success: false, error: "Room value is too long" }, 400);
    add("room", value);
  }

  if ("gender" in input) {
    const value = input.gender == null || input.gender === "" ? null : String(input.gender).toUpperCase();
    if (value && !["MALE", "FEMALE", "OTHER"].includes(value)) {
      return c.json({ success: false, error: "Invalid gender value" }, 400);
    }
    add("gender", value);
  }

  if ("emergencyContact" in input) {
    const value = input.emergencyContact == null || input.emergencyContact === "" ? null : String(input.emergencyContact).trim();
    if (value && value.length > 64) return c.json({ success: false, error: "Emergency contact is too long" }, 400);
    add("emergency_contact", value);
  }

  if ("theme" in input) {
    const value = String(input.theme);
    if (!["light", "dark", "system"].includes(value)) return c.json({ success: false, error: "Invalid theme" }, 400);
    add("theme", value);
  }

  if ("language" in input) {
    const value = String(input.language).trim();
    if (!value || value.length > 16) return c.json({ success: false, error: "Invalid language" }, 400);
    add("language", value);
  }

  if ("timezone" in input) {
    const value = String(input.timezone).trim();
    if (!value || value.length > 64) return c.json({ success: false, error: "Invalid timezone" }, 400);
    add("timezone", value);
  }

  if (assignments.length === 0) return c.json({ success: true, data: safeViewer(viewer) });

  const now = new Date().toISOString();
  assignments.push("updated_at = ?");
  values.push(now, viewer.id);

  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE users SET ${assignments.join(", ")} WHERE id = ?`).bind(...values),
    c.env.DB.prepare(
      `INSERT INTO audit_events
        (id, institution_id, actor_user_id, action, entity_type, entity_id, request_id, reason, metadata_json, created_at)
       VALUES (?, ?, ?, 'PROFILE_UPDATED', 'User', ?, ?, NULL, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      viewer.institution_id,
      viewer.id,
      viewer.id,
      c.get("requestId"),
      JSON.stringify({ fields: assignments.filter((entry) => !entry.startsWith("updated_at")) }),
      now,
    ),
  ]);

  const updated = await currentViewer(c);
  if (!updated) return c.json({ success: false, error: "Authentication required" }, 401);
  return c.json({ success: true, data: safeViewer(updated) });
});
