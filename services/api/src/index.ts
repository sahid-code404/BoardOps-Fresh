import { Hono } from "hono";
import { authenticatedPrincipal, hasPermission, PERMISSIONS } from "./auth/authorization";
import { enforceFormulaDependencyPolicy } from "./middleware/formula-dependencies";
import { enforcePasswordMutationPolicy } from "./middleware/password-policy";
import { enforceRbacPolicy } from "./middleware/rbac";
import { authRoutes } from "./routes/auth";
import { authWorkflowRoutes } from "./routes/auth-workflows";
import { billingRoutes } from "./routes/billing";
import { expenseRoutes } from "./routes/expenses";
import { fundRoutes } from "./routes/funds";
import { kitchenRoutes } from "./routes/kitchen";
import { leaveRoutes } from "./routes/leave";
import { mealConfigRoutes } from "./routes/meals-config";
import { mealOverrideRoutes } from "./routes/meal-overrides";
import { monthlyClosingRoutes } from "./routes/monthly-closing";
import { notificationAnnouncementRoutes } from "./routes/notifications-announcements";
import { paymentRoutes } from "./routes/payments";
import { refundAdjustmentRoutes } from "./routes/refunds-adjustments";
import { reportRoutes } from "./routes/reports";
import { runtimeRoutes } from "./routes/runtime";
import { userRoutes } from "./routes/users";
import { user360Routes } from "./routes/user-360";
import { variableFormulaRoutes } from "./routes/variables-formulas";
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
  "billing_snapshots",
  "bills",
  "billing_cycles",
  "billing_cycle_events",
  "payments",
  "refunds",
  "refund_transactions",
  "adjustments",
  "financial_reference_sequences",
  "expenses",
  "variables",
  "variable_versions",
  "formulas",
  "formula_versions",
  "announcements",
  "notifications",
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
app.use("/api/*", enforceFormulaDependencyPolicy);

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
      Number(baseline?.permission_count ?? 0) < 74 ||
      Number(baseline?.role_count ?? 0) < 4 ||
      Number(baseline?.grant_count ?? 0) < 182
    ) {
      throw new Error("RBAC baseline is incomplete");
    }

    return c.json({
      status: "ready",
      service: "boardops-api",
      // Phase 05 remains the last formally closed numbered checkpoint; later
      // integration migrations extend that verified core without weakening it.
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
// Canonical communication/report routes must precede runtime compatibility placeholders.
app.route("/api", notificationAnnouncementRoutes);
app.route("/api", reportRoutes);
app.route("/api", runtimeRoutes);
app.route("/api", userRoutes);
app.route("/api", user360Routes);
app.route("/api", mealConfigRoutes);
app.route("/api", kitchenRoutes);
app.route("/api", mealOverrideRoutes);
app.route("/api", leaveRoutes);
// Monthly Closing owns /billing-cycles. It is mounted before Billing Core so
// its live-input readiness contract supersedes the older snapshot-required
// generation readiness route while /bills remains owned by Billing Core.
app.route("/api", monthlyClosingRoutes);
app.route("/api", billingRoutes);
// Refund/adjustment routes intentionally precede the legacy Payments router so
// their richer canonical /payments/refund and /refunds contracts own those paths.
app.route("/api", refundAdjustmentRoutes);
app.route("/api", paymentRoutes);
app.route("/api", expenseRoutes);
app.route("/api", fundRoutes);
app.route("/api", variableFormulaRoutes);

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

  const [pendingBillRow, unreadRow] = await Promise.all([
    c.env.DB.prepare(
      `SELECT COUNT(*) AS pending_bills
         FROM bills
        WHERE institution_id = ?
          AND deleted_on IS NULL
          AND purged_at IS NULL
          AND status IN ('GENERATED', 'PARTIALLY_PAID', 'OVERDUE')
          AND due_amount_minor > 0`,
    ).bind(viewer.institutionId).first<{ pending_bills: number | null }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS unread_count
         FROM notifications
        WHERE institution_id = ? AND user_id = ? AND read_at IS NULL`,
    ).bind(viewer.institutionId, viewer.id).first<{ unread_count: number | null }>(),
  ]);

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
        pendingBills: Number(pendingBillRow?.pending_bills ?? 0),
      },
      trend: emptySevenDayTrend(),
      expenseBreakdown: [],
      unreadNotifications: Number(unreadRow?.unread_count ?? 0),
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