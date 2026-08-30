import { Hono } from "hono";
import { authenticatedPrincipal, hasPermission, PERMISSIONS } from "./auth/authorization";
import { enforcePasswordMutationPolicy } from "./middleware/password-policy";
import { enforceRbacPolicy } from "./middleware/rbac";
import { authRoutes } from "./routes/auth";
import { authWorkflowRoutes } from "./routes/auth-workflows";
import { kitchenRoutes } from "./routes/kitchen";
import { leaveRoutes } from "./routes/leave";
import { mealConfigRoutes } from "./routes/meals-config";
import { mealOverrideRoutes } from "./routes/meal-overrides";
import { runtimeRoutes } from "./routes/runtime";
import { userRoutes } from "./routes/users";
import { user360Routes } from "./routes/user-360";
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
  "registration_requests",
  "auth_challenges",
  "roles",
  "permissions",
  "role_permissions",
  "meal_configurations",
  "meal_entries",
  "guest_meals",
  "meal_overrides",
  "leave_applications",
] as const;

type ActivityRow = {
  id: string;
  action: string;
  created_at: string;
  actor_name: string | null;
  actor_email: string | null;
};

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

app.use("/api/*", enforcePasswordMutationPolicy);
app.use("/api/*", enforceRbacPolicy);

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

    const baseline = await c.env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM permissions) AS permission_count,
         (SELECT COUNT(*) FROM roles) AS role_count,
         (SELECT COUNT(*) FROM role_permissions) AS grant_count`,
    ).first<{ permission_count: number; role_count: number; grant_count: number }>();
    if (
      Number(baseline?.permission_count ?? 0) < 29 ||
      Number(baseline?.role_count ?? 0) < 4 ||
      Number(baseline?.grant_count ?? 0) < 1
    ) {
      throw new Error("RBAC baseline is incomplete");
    }

    return c.json({
      status: "ready",
      service: "boardops-api",
      // Phase 05 remains the last formally closed checkpoint; later integration
      // migrations extend that verified core without weakening its readiness label.
      schema: "phase05-rbac",
    });
  } catch {
    return c.json(
      {
        status: "not_ready",
        service: "boardops-api",
        schema: "phase05-rbac",
      },
      503,
    );
  }
});

app.route("/api/auth", authRoutes);
app.route("/api/auth", authWorkflowRoutes);
app.route("/api", runtimeRoutes);
app.route("/api", userRoutes);
app.route("/api", user360Routes);
app.route("/api", mealConfigRoutes);
app.route("/api", kitchenRoutes);
app.route("/api", mealOverrideRoutes);
app.route("/api", leaveRoutes);

app.get("/api/dashboard", async (c) => {
  const viewer = await authenticatedPrincipal(c);
  if (!viewer) return c.json({ success: false, error: "Authentication required" }, 401);

  const summary = await c.env.DB.prepare(
    `SELECT
       SUM(CASE WHEN status = 'ACTIVE' AND deleted_at IS NULL THEN 1 ELSE 0 END) AS active_count,
       SUM(CASE WHEN status = 'PENDING' AND deleted_at IS NULL THEN 1 ELSE 0 END) AS pending_count
     FROM users
     WHERE institution_id = ?`,
  )
    .bind(viewer.institutionId)
    .first<{ active_count: number | null; pending_count: number | null }>();

  const canReadAudit = hasPermission(viewer, PERMISSIONS.AUDIT_READ);
  const activityRows = canReadAudit
    ? await c.env.DB.prepare(
        `SELECT a.id, a.action, a.created_at, u.name AS actor_name, u.email AS actor_email
         FROM audit_events a
         LEFT JOIN users u ON u.id = a.actor_user_id
         WHERE a.institution_id = ?
         ORDER BY a.created_at DESC
         LIMIT 6`,
      )
        .bind(viewer.institutionId)
        .all<ActivityRow>()
    : { results: [] as ActivityRow[] };

  // `isAdmin` remains a compatibility response field for the golden frontend,
  // but its meaning is now permission-derived instead of role-string-derived.
  const isAdmin = hasPermission(viewer, PERMISSIONS.USERS_READ);

  // Kitchen now owns canonical meal-entry state. Dashboard meal aggregation is
  // intentionally kept separate so this integration does not invent a second,
  // inconsistent counting rule; a later dashboard port will reuse the same
  // confirmed-meal semantics as /api/kitchen.
  return c.json({
    success: true,
    data: {
      todayMeals: [],
      kpis: {
        totalUsers: Number(summary?.active_count ?? 0),
        pendingUsers: Number(summary?.pending_count ?? 0),
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
      recentActivity: activityRows.results.map((row) => ({
        id: row.id,
        action: row.action,
        createdAt: row.created_at,
        actor: row.actor_name
          ? { name: row.actor_name, email: row.actor_email ?? undefined }
          : null,
      })),
      isAdmin,
    },
  });
});

export default app;
