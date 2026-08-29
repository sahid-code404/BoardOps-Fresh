import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { randomToken, tokenDigest, verifyPassword } from "../auth/crypto";
import type { AppEnv } from "../types";

const SESSION_COOKIE = "boardops_session";
const SESSION_DAYS = 30;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_FAILURE_LIMIT = 5;

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

function readSessionToken(c: Context<AppEnv>): string | null {
  const cookie = getCookie(c, SESSION_COOKIE);
  if (cookie) return cookie;
  const authorization = c.req.header("authorization");
  if (!authorization?.toLowerCase().startsWith("bearer ")) return null;
  return authorization.slice(7).trim() || null;
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

authRoutes.get("/sessions", async (c) => {
  const current = await currentSession(c);
  if (!current) return c.json({ success: false, error: "Authentication required" }, 401);

  const rows = await c.env.DB.prepare(
    `SELECT id, user_agent, ip_address, expires_at, revoked_at, created_at
     FROM user_sessions
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT 50`,
  )
    .bind(current.id)
    .all<{
      id: string;
      user_agent: string | null;
      ip_address: string | null;
      expires_at: string;
      revoked_at: string | null;
      created_at: string;
    }>();

  return c.json({
    success: true,
    data: rows.results.map((row) => ({
      id: row.id,
      userAgent: row.user_agent,
      ipAddress: row.ip_address,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      createdAt: row.created_at,
      current: row.id === current.session_id,
    })),
  });
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
