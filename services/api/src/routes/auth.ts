import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { hashPassword, randomToken, tokenDigest, verifyPassword } from "../auth/crypto";
import type { AppEnv } from "../types";

const SESSION_COOKIE = "boardops_session";
const SESSION_DAYS = 30;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_FAILURE_LIMIT = 5;
const MAX_AVATAR_BYTES = 4 * 1024 * 1024;
const AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

type UserRow = {
  id: string;
  institution_id: string;
  name: string;
  email: string;
  phone: string | null;
  password_hash: string | null;
  role: "SUPER_ADMIN" | "ADMIN" | "MANAGER" | "USER";
  status: "ACTIVE" | "PENDING" | "SUSPENDED" | "ARCHIVED" | "INACTIVE";
  institution_user_id: string | null;
  email_verified: number;
  avatar_url: string | null;
  room: string | null;
  gender: string | null;
  emergency_contact: string | null;
  theme: string;
  language: string;
  timezone: string;
  last_login_at: string | null;
  created_at: string;
};

type SessionUserRow = UserRow & { session_id: string; session_expires_at: string };

function safeUser(user: UserRow) {
  return {
    id: user.id,
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

function clientIp(c: Context<AppEnv>): string {
  const cf = c.req.header("cf-connecting-ip");
  if (cf) return cf;
  const forwarded = c.req.header("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "127.0.0.1";
}

function userAgent(c: Context<AppEnv>): string | null {
  return c.req.header("user-agent")?.slice(0, 512) || null;
}

function sessionPresentation(value: string | null) {
  const ua = value ?? "";

  const browser = /Edg\//u.test(ua)
    ? "Edge"
    : /Firefox\//u.test(ua)
      ? "Firefox"
      : /Chrome\//u.test(ua) || /CriOS\//u.test(ua)
        ? "Chrome"
        : /Safari\//u.test(ua)
          ? "Safari"
          : "Browser";

  const os = /Android/u.test(ua)
    ? "Android"
    : /iPhone|iPad|iPod/u.test(ua)
      ? "iOS"
      : /Windows NT/u.test(ua)
        ? "Windows"
        : /Mac OS X|Macintosh/u.test(ua)
          ? "macOS"
          : /Linux/u.test(ua)
            ? "Linux"
            : "Unknown OS";

  const device = /iPad/u.test(ua)
    ? "iPad"
    : /iPhone|iPod/u.test(ua)
      ? "iPhone"
      : /Android/u.test(ua)
        ? "Android"
        : "Computer";

  return { browser, os, device };
}

function readSessionToken(c: Context<AppEnv>): string | null {
  return getCookie(c, SESSION_COOKIE)?.trim() || null;
}

function setSessionCookie(c: Context<AppEnv>, token: string, expiresAt: Date) {
  const secure = c.env.ENVIRONMENT !== "local";
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: "Lax",
    path: "/",
    expires: expiresAt,
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

function clearSessionCookie(c: Context<AppEnv>) {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

async function currentSession(c: Context<AppEnv>): Promise<SessionUserRow | null> {
  const token = readSessionToken(c);
  if (!token) return null;
  const digest = await tokenDigest(token);
  const now = new Date().toISOString();
  return c.env.DB.prepare(
    `SELECT
       s.id AS session_id,
       s.expires_at AS session_expires_at,
       u.id, u.institution_id, u.name, u.email, u.phone, u.password_hash,
       u.role, u.status, u.institution_user_id, u.email_verified, u.avatar_url,
       u.room, u.gender, u.emergency_contact, u.theme, u.language, u.timezone,
       u.last_login_at, u.created_at
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
    .first<SessionUserRow>();
}

async function recordLoginFailure(c: Context<AppEnv>, email: string, userId: string | null, reason: string) {
  await c.env.DB.prepare(
    `INSERT INTO login_history
      (id, user_id, attempted_email, success, ip_address, user_agent, reason, created_at)
     VALUES (?, ?, ?, 0, ?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), userId, email, clientIp(c), userAgent(c), reason, new Date().toISOString())
    .run();
}

export const authRoutes = new Hono<AppEnv>();

authRoutes.post("/login", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const objectBody = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const email = typeof objectBody.email === "string" ? objectBody.email.trim().toLowerCase() : "";
  const password = typeof objectBody.password === "string" ? objectBody.password : "";

  if (!email || email.length > 320 || !email.includes("@") || !password || password.length > 512) {
    return c.json({ success: false, error: "Enter a valid email and password" }, 400);
  }

  const ip = clientIp(c);
  const cutoff = new Date(Date.now() - LOGIN_WINDOW_MS).toISOString();
  const failures = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count
     FROM login_history
     WHERE ip_address = ? AND success = 0 AND created_at >= ?`,
  )
    .bind(ip, cutoff)
    .first<{ count: number }>();

  if (Number(failures?.count ?? 0) >= LOGIN_FAILURE_LIMIT) {
    return c.json({ success: false, error: "Too many login attempts. Please try again later." }, 429);
  }

  const user = await c.env.DB.prepare(
    `SELECT id, institution_id, name, email, phone, password_hash, role, status,
            institution_user_id, email_verified, avatar_url, room, gender,
            emergency_contact, theme, language, timezone, last_login_at, created_at
     FROM users
     WHERE lower(email) = ? AND deleted_at IS NULL
     LIMIT 1`,
  )
    .bind(email)
    .first<UserRow>();

  if (!user) {
    await recordLoginFailure(c, email, null, "UNKNOWN_ACCOUNT");
    return c.json({ success: false, error: "Incorrect email or password" }, 401);
  }

  const passwordOk = await verifyPassword(password, user.password_hash);
  if (!passwordOk) {
    await recordLoginFailure(c, email, user.id, "WRONG_PASSWORD");
    return c.json({ success: false, error: "Incorrect email or password" }, 401);
  }

  if (user.status === "PENDING") {
    return c.json({ success: false, error: "Your account is awaiting admin approval" }, 403);
  }
  if (user.status === "SUSPENDED") {
    return c.json({ success: false, error: "Your account has been suspended. Contact admin." }, 403);
  }
  if (user.status !== "ACTIVE") {
    return c.json({ success: false, error: "Your account is no longer active" }, 403);
  }
  if (user.email_verified !== 1) {
    return c.json({ success: false, error: "Please verify your email address first." }, 403);
  }

  const rawToken = randomToken();
  const digest = await tokenDigest(rawToken);
  const sessionId = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const nowIso = now.toISOString();
  const requestId = c.get("requestId");

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO user_sessions
        (id, user_id, token_digest, user_agent, ip_address, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(sessionId, user.id, digest, userAgent(c), ip, expiresAt.toISOString(), nowIso),
    c.env.DB.prepare(`UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?`).bind(nowIso, nowIso, user.id),
    c.env.DB.prepare(
      `INSERT INTO login_history
        (id, user_id, attempted_email, success, ip_address, user_agent, reason, created_at)
       VALUES (?, ?, ?, 1, ?, ?, NULL, ?)`,
    ).bind(crypto.randomUUID(), user.id, email, ip, userAgent(c), nowIso),
    c.env.DB.prepare(
      `INSERT INTO audit_events
        (id, institution_id, actor_user_id, action, entity_type, entity_id, request_id, reason, metadata_json, created_at)
       VALUES (?, ?, ?, 'LOGIN', 'User', ?, ?, NULL, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      user.institution_id,
      user.id,
      user.id,
      requestId,
      JSON.stringify({ ipAddress: ip, sessionId }),
      nowIso,
    ),
  ]);

  setSessionCookie(c, rawToken, expiresAt);

  return c.json({
    success: true,
    data: {
      // Compatibility hint only. The real credential stays in the HttpOnly cookie.
      token: "cookie-session",
      user: { ...safeUser(user), lastLoginAt: nowIso },
      expiresAt: expiresAt.toISOString(),
    },
  });
});

authRoutes.get("/me", async (c) => {
  const session = await currentSession(c);
  if (!session) {
    clearSessionCookie(c);
    return c.json({ success: false, error: "Authentication required" }, 401);
  }
  return c.json({ success: true, data: safeUser(session) });
});

authRoutes.post("/logout", async (c) => {
  const token = readSessionToken(c);
  if (token) {
    const digest = await tokenDigest(token);
    const session = await c.env.DB.prepare(
      `SELECT s.id, s.user_id, u.institution_id
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_digest = ? AND s.revoked_at IS NULL
       LIMIT 1`,
    )
      .bind(digest)
      .first<{ id: string; user_id: string; institution_id: string }>();

    if (session) {
      const now = new Date().toISOString();
      await c.env.DB.batch([
        c.env.DB.prepare(`UPDATE user_sessions SET revoked_at = ? WHERE id = ?`).bind(now, session.id),
        c.env.DB.prepare(
          `INSERT INTO audit_events
            (id, institution_id, actor_user_id, action, entity_type, entity_id, request_id, reason, metadata_json, created_at)
           VALUES (?, ?, ?, 'LOGOUT', 'UserSession', ?, ?, NULL, ?, ?)`,
        ).bind(
          crypto.randomUUID(),
          session.institution_id,
          session.user_id,
          session.id,
          c.get("requestId"),
          JSON.stringify({ sessionId: session.id }),
          now,
        ),
      ]);
    }
  }

  clearSessionCookie(c);
  return c.json({ success: true, data: { loggedOut: true } });
});

authRoutes.post("/change-password", async (c) => {
  const current = await currentSession(c);
  if (!current) return c.json({ success: false, error: "Authentication required" }, 401);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const objectBody = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const currentPassword = typeof objectBody.currentPassword === "string" ? objectBody.currentPassword : "";
  const newPassword = typeof objectBody.newPassword === "string" ? objectBody.newPassword : "";

  if (!currentPassword || currentPassword.length > 512) {
    return c.json({ success: false, error: "Enter your current password" }, 400);
  }
  if (
    newPassword.length < 8 ||
    newPassword.length > 512 ||
    !/[A-Z]/u.test(newPassword) ||
    !/[a-z]/u.test(newPassword) ||
    !/[0-9]/u.test(newPassword)
  ) {
    return c.json({
      success: false,
      error: "New password must be at least 8 characters and include uppercase, lowercase, and a number",
    }, 400);
  }

  if (!(await verifyPassword(currentPassword, current.password_hash))) {
    return c.json({ success: false, error: "Current password is incorrect" }, 401);
  }
  if (await verifyPassword(newPassword, current.password_hash)) {
    return c.json({ success: false, error: "New password must be different from your current password" }, 400);
  }

  const now = new Date().toISOString();
  const passwordHash = await hashPassword(newPassword);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`).bind(passwordHash, now, current.id),
    c.env.DB.prepare(
      `UPDATE user_sessions
       SET revoked_at = ?
       WHERE user_id = ? AND id <> ? AND revoked_at IS NULL`,
    ).bind(now, current.id, current.session_id),
    c.env.DB.prepare(
      `INSERT INTO audit_events
        (id, institution_id, actor_user_id, action, entity_type, entity_id, request_id, reason, metadata_json, created_at)
       VALUES (?, ?, ?, 'PASSWORD_CHANGED', 'User', ?, ?, NULL, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      current.institution_id,
      current.id,
      current.id,
      c.get("requestId"),
      JSON.stringify({ otherSessionsRevoked: true }),
      now,
    ),
  ]);

  return c.json({ success: true, data: { changed: true, otherSessionsRevoked: true } });
});

authRoutes.post("/avatar", async (c) => {
  const current = await currentSession(c);
  if (!current) return c.json({ success: false, error: "Authentication required" }, 401);

  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json({ success: false, error: "Invalid avatar upload" }, 400);
  }

  const avatar = formData.get("avatar");
  if (!(avatar instanceof File)) {
    return c.json({ success: false, error: "Choose an image to upload" }, 400);
  }
  if (!AVATAR_TYPES.has(avatar.type)) {
    return c.json({ success: false, error: "Avatar must be JPEG, PNG, WebP, or GIF" }, 415);
  }
  if (avatar.size <= 0 || avatar.size > MAX_AVATAR_BYTES) {
    return c.json({ success: false, error: "Avatar must be smaller than 4 MB" }, 413);
  }

  const key = `avatars/${current.institution_id}/${current.id}/current`;
  await c.env.FILES.put(key, await avatar.arrayBuffer(), {
    httpMetadata: {
      contentType: avatar.type,
      cacheControl: "private, max-age=300",
    },
  });

  const version = crypto.randomUUID();
  const avatarUrl = `/api/auth/avatar/image?v=${version}`;
  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE users SET avatar_url = ?, updated_at = ? WHERE id = ?`).bind(avatarUrl, now, current.id),
    c.env.DB.prepare(
      `INSERT INTO audit_events
        (id, institution_id, actor_user_id, action, entity_type, entity_id, request_id, reason, metadata_json, created_at)
       VALUES (?, ?, ?, 'PROFILE_AVATAR_UPDATED', 'User', ?, ?, NULL, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      current.institution_id,
      current.id,
      current.id,
      c.get("requestId"),
      JSON.stringify({ objectKey: key, contentType: avatar.type, size: avatar.size }),
      now,
    ),
  ]);

  return c.json({ success: true, data: { avatarUrl } });
});

authRoutes.get("/avatar/image", async (c) => {
  const current = await currentSession(c);
  if (!current) return c.json({ success: false, error: "Authentication required" }, 401);

  const key = `avatars/${current.institution_id}/${current.id}/current`;
  const avatar = await c.env.FILES.get(key);
  if (!avatar) return c.json({ success: false, error: "Avatar not found" }, 404);

  const headers = new Headers();
  avatar.writeHttpMetadata(headers);
  headers.set("Cache-Control", "private, max-age=300");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(avatar.body, { headers });
});

authRoutes.get("/sessions", async (c) => {
  const current = await currentSession(c);
  if (!current) return c.json({ success: false, error: "Authentication required" }, 401);

  const now = new Date().toISOString();
  const rows = await c.env.DB.prepare(
    `SELECT id, user_agent, ip_address, expires_at, created_at
     FROM user_sessions
     WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
     ORDER BY created_at DESC
     LIMIT 50`,
  )
    .bind(current.id, now)
    .all<{
      id: string;
      user_agent: string | null;
      ip_address: string | null;
      expires_at: string;
      created_at: string;
    }>();

  return c.json({
    success: true,
    data: rows.results.map((row) => ({
      id: row.id,
      ...sessionPresentation(row.user_agent),
      userAgent: row.user_agent,
      ipAddress: row.ip_address ?? "Unknown IP",
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      current: row.id === current.session_id,
    })),
  });
});

authRoutes.delete("/sessions", async (c) => {
  const current = await currentSession(c);
  if (!current) return c.json({ success: false, error: "Authentication required" }, 401);

  const now = new Date().toISOString();
  const result = await c.env.DB.prepare(
    `UPDATE user_sessions
     SET revoked_at = ?
     WHERE user_id = ? AND id <> ? AND revoked_at IS NULL`,
  )
    .bind(now, current.id, current.session_id)
    .run();

  await c.env.DB.prepare(
    `INSERT INTO audit_events
      (id, institution_id, actor_user_id, action, entity_type, entity_id, request_id, reason, metadata_json, created_at)
     VALUES (?, ?, ?, 'OTHER_SESSIONS_REVOKED', 'User', ?, ?, NULL, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      current.institution_id,
      current.id,
      current.id,
      c.get("requestId"),
      JSON.stringify({ revokedCount: Number(result.meta.changes ?? 0) }),
      now,
    )
    .run();

  return c.json({ success: true, data: { revoked: Number(result.meta.changes ?? 0) } });
});

authRoutes.delete("/sessions/:id", async (c) => {
  const current = await currentSession(c);
  if (!current) return c.json({ success: false, error: "Authentication required" }, 401);

  const sessionId = c.req.param("id");
  const target = await c.env.DB.prepare(`SELECT id FROM user_sessions WHERE id = ? AND user_id = ? LIMIT 1`)
    .bind(sessionId, current.id)
    .first<{ id: string }>();
  if (!target) return c.json({ success: false, error: "Session not found" }, 404);

  await c.env.DB.prepare(`UPDATE user_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`)
    .bind(new Date().toISOString(), target.id)
    .run();

  if (target.id === current.session_id) clearSessionCookie(c);
  return c.json({ success: true, data: { revoked: true, current: target.id === current.session_id } });
});
