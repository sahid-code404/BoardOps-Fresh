import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";
import { tokenDigest } from "./auth/crypto";
import { authRoutes } from "./routes/auth";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>();

const REQUIRED_CORE_TABLES = [
  "institutions",
  "accounting_periods",
  "users",
  "idempotency_keys",
  "audit_events",
  "outbox_events",
  "user_sessions",
  "login_history",
] as const;

const SESSION_COOKIE = "boardops_session";

type Viewer = {
  id: string;
  institution_id: string;
  role: "SUPER_ADMIN" | "ADMIN" | "MANAGER" | "USER";
};

type ActivityRow = {
  id: string;
  action: string;
  created_at: string;
  actor_name: string | null;
  actor_email: string | null;
};

function readSessionToken(c: Context<AppEnv>): string | null {
  const cookie = getCookie(c, SESSION_COOKIE);
  if (cookie) return cookie;

  const authorization = c.req.header("authorization");
  if (!authorization?.toLowerCase().startsWith("bearer ")) return null;
  return authorization.slice(7).trim() || null;
}

async function currentViewer(c: Context<AppEnv>): Promise<Viewer | null> {
  const token = readSessionToken(c);
  if (!token) return null;

  const digest = await tokenDigest(token);
  const now = new Date().toISOString();
  return c.env.DB.prepare(
    `SELECT u.id, u.institution_id, u.role
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

function emptySevenDayTrend() {
  const today = new Date();
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (6 - index));
    return { date: date.toISOString().slice(0, 10), on: 0, off: 0 };
  });
}

app.use("*", async (c, next) => {
  const requestId = crypto.randomUUID();
  c.set("requestId", requestId);
  c.header("x-request-id", requestId);
  await next();
});

app.get("/api/health", (c) => c.json({ status: "ok", service: "boardops-api" }));

app.get("/api/ready", async (c) => {
  try {
    const probe = await c.env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
    if (probe?.ok !== 1) throw new Error("D1 readiness probe failed");

    const placeholders = REQUIRED_CORE_TABLES.map(() => "?").join(", ");
    const schema = await c.env.DB
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`)
      .bind(...REQUIRED_CORE_TABLES)
      .all<{ name: string }>();

    const present = new Set(schema.results.map((row) => row.name));
    const missing = REQUIRED_CORE_TABLES.filter((name) => !present.has(name));
    if (missing.length > 0) {
      throw new Error(`Missing database core tables: ${missing.join(", ")}`);
    }

    return c.json({
      status: "ready",
      service: "boardops-api",
      schema: "phase04-auth-core",
    });
  } catch {
    return c.json(
      {
        status: "not_ready",
        service: "boardops-api",
        schema: "phase04-auth-core",
      },
      503,
    );
  }
});

app.route("/api/auth", authRoutes);

app.get("/api/dashboard", async (c) => {
  const viewer = await currentViewer(c);
  if (!viewer) return c.json({ success: false, error: "Authentication required" }, 401);

  const [totalUsersRow, pendingUsersRow, activityRows] = await Promise.all([
    c.env.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM users
       WHERE institution_id = ? AND status = 'ACTIVE' AND deleted_at IS NULL`,
    )
      .bind(viewer.institution_id)
      .first<{ count: number }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM users
       WHERE institution_id = ? AND status = 'PENDING' AND deleted_at IS NULL`,
    )
      .bind(viewer.institution_id)
      .first<{ count: number }>(),
    c.env.DB.prepare(
      `SELECT a.id, a.action, a.created_at, u.name AS actor_name, u.email AS actor_email
       FROM audit_events a
       LEFT JOIN users u ON u.id = a.actor_user_id
       WHERE a.institution_id = ?
       ORDER BY a.created_at DESC
       LIMIT 6`,
    )
      .bind(viewer.institution_id)
      .all<ActivityRow>(),
  ]);

  const isAdmin = viewer.role === "ADMIN" || viewer.role === "SUPER_ADMIN";

  // Phase 04 deliberately exposes only values backed by tables that already
  // exist in D1. Meal, expense, billing and notification totals stay zero until
  // their owning phases introduce canonical schemas; we do not invent fixture
  // money or operational counts in the real runtime.
  return c.json({
    success: true,
    data: {
      todayMeals: [],
      kpis: {
        totalUsers: Number(totalUsersRow?.count ?? 0),
        pendingUsers: Number(pendingUsersRow?.count ?? 0),
        todayOnCount: 0,
        todayOffCount: 0,
        currentMealCharge: 0,
        totalResidentMeals: 0,
        totalExpenses: 0,
        pendingBills: 0,
      },
      trend: emptySevenDayTrend(),
      expenseBreakdown: [],
      unreadNotifications: 0,
      recentActivity: isAdmin
        ? activityRows.results.map((row) => ({
            id: row.id,
            action: row.action,
            createdAt: row.created_at,
            actor: row.actor_name
              ? { name: row.actor_name, email: row.actor_email ?? undefined }
              : null,
          }))
        : [],
      isAdmin,
    },
  });
});

export default app;
