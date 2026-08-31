import { Hono } from "hono";
import { enforceFormulaDependencyPolicy } from "./middleware/formula-dependencies";
import { enforcePasswordMutationPolicy } from "./middleware/password-policy";
import { enforceRbacPolicy } from "./middleware/rbac";
import { auditSystemRoutes } from "./routes/audit-system";
import { authRoutes } from "./routes/auth";
import { authWorkflowRoutes } from "./routes/auth-workflows";
import { billingRoutes } from "./routes/billing";
import { dashboardRoutes } from "./routes/dashboard";
import { expenseRoutes } from "./routes/expenses";
import { fundRoutes } from "./routes/funds";
import { kitchenRoutes } from "./routes/kitchen";
import { leaveRoutes } from "./routes/leave";
import { mealConfigRoutes } from "./routes/meals-config";
import { mealOverrideRoutes } from "./routes/meal-overrides";
import { monthlyClosingRoutes } from "./routes/monthly-closing";
import { notificationAnnouncementRoutes } from "./routes/notifications-announcements";
import { paymentRoutes } from "./routes/payments";
import { productPurchaseRoutes } from "./routes/products-purchases";
import { refundAdjustmentRoutes } from "./routes/refunds-adjustments";
import { reportRoutes } from "./routes/reports";
import { runtimeRoutes } from "./routes/runtime";
import { settingsPoliciesHolidaysRoutes } from "./routes/settings-policies-holidays";
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
  "background_tasks",
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
  "units",
  "products",
  "purchases",
  "purchase_items",
  "variables",
  "variable_versions",
  "formulas",
  "formula_versions",
  "announcements",
  "notifications",
  "settings",
  "policies",
  "holidays",
] as const;

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
      Number(baseline?.permission_count ?? 0) < 96 ||
      Number(baseline?.role_count ?? 0) < 4 ||
      Number(baseline?.grant_count ?? 0) < 234
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
// Canonical communication/report/settings/system/procurement routes must precede runtime compatibility placeholders.
app.route("/api", notificationAnnouncementRoutes);
app.route("/api", reportRoutes);
app.route("/api", settingsPoliciesHolidaysRoutes);
app.route("/api", auditSystemRoutes);
app.route("/api", productPurchaseRoutes);
app.route("/api", dashboardRoutes);
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

app.onError((error, c) => {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("meal booking disabled by active holiday")) {
    return c.json(
      { success: false, error: "Meal booking is disabled for this holiday" },
      409,
    );
  }
  console.error("[BoardOps] Unhandled API error", error);
  return c.json({ success: false, error: "Internal server error" }, 500);
});

export default app;