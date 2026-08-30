import type { Context, Next } from "hono";
import { PERMISSIONS, requirePermission, type PermissionKey } from "../auth/authorization";
import type { AppEnv } from "../types";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type DynamicPolicy = PermissionKey | null | "USER_ACTION" | "PAYMENT_PUT_ACTION";

const PUBLIC_ENDPOINTS = new Set([
  "GET /api/health",
  "GET /api/ready",
  "GET /api/theme",
  "POST /api/auth/login",
  "POST /api/auth/logout",
  "POST /api/auth/register",
  "POST /api/auth/send-verification",
  "POST /api/auth/verify-email",
  "GET /api/auth/registration-status",
  "POST /api/auth/resubmit",
  "POST /api/auth/forgot-password",
  "POST /api/auth/verify-reset-otp",
  "POST /api/auth/reset-password",
]);

const EXACT_POLICIES = new Map<string, PermissionKey>([
  ["GET /api/dashboard", PERMISSIONS.DASHBOARD_READ],
  ["GET /api/audit-logs", PERMISSIONS.AUDIT_READ],
  ["GET /api/tasks", PERMISSIONS.TASKS_READ],
  ["POST /api/tasks", PERMISSIONS.TASKS_CREATE],
  ["POST /api/tasks/cleanup", PERMISSIONS.TASKS_CLEANUP],
  ["POST /api/system/backup", PERMISSIONS.SYSTEM_BACKUP],
  ["GET /api/notifications", PERMISSIONS.NOTIFICATIONS_READ_SELF],
  ["PATCH /api/notifications", PERMISSIONS.NOTIFICATIONS_MARK_READ_SELF],
  ["GET /api/announcements", PERMISSIONS.ANNOUNCEMENTS_READ],
  ["POST /api/announcements", PERMISSIONS.ANNOUNCEMENTS_CREATE],
  ["GET /api/reports/financial", PERMISSIONS.REPORTS_READ],
  ["GET /api/reports/meals", PERMISSIONS.REPORTS_READ],
  ["GET /api/reports/purchases", PERMISSIONS.REPORTS_READ],
  ["GET /api/reports/outstanding", PERMISSIONS.REPORTS_READ],
  ["GET /api/reports/residents", PERMISSIONS.REPORTS_READ],
  ["GET /api/reports/export", PERMISSIONS.REPORTS_EXPORT],
  ["GET /api/settings", PERMISSIONS.SETTINGS_READ],
  ["POST /api/settings", PERMISSIONS.SETTINGS_WRITE],
  ["GET /api/institution", PERMISSIONS.INSTITUTION_READ],
  ["PUT /api/institution", PERMISSIONS.INSTITUTION_UPDATE],
  ["GET /api/policies", PERMISSIONS.POLICIES_READ],
  ["PUT /api/policies", PERMISSIONS.POLICIES_UPDATE],
  ["GET /api/holidays", PERMISSIONS.HOLIDAYS_READ],
  ["POST /api/holidays", PERMISSIONS.HOLIDAYS_CREATE],
  ["GET /api/auth/me", PERMISSIONS.PROFILE_READ_SELF],
  ["GET /api/auth/profile", PERMISSIONS.PROFILE_READ_SELF],
  ["PUT /api/auth/profile", PERMISSIONS.PROFILE_UPDATE_SELF],
  ["POST /api/auth/change-password", PERMISSIONS.PASSWORD_CHANGE_SELF],
  ["POST /api/auth/avatar", PERMISSIONS.AVATAR_UPDATE_SELF],
  ["GET /api/auth/avatar/image", PERMISSIONS.PROFILE_READ_SELF],
  ["GET /api/auth/sessions", PERMISSIONS.SESSIONS_READ_SELF],
  ["DELETE /api/auth/sessions", PERMISSIONS.SESSIONS_REVOKE_SELF],
  ["GET /api/users", PERMISSIONS.USERS_READ],
  ["GET /api/meals/config", PERMISSIONS.MEALS_CONFIG_READ],
  ["POST /api/meals/config", PERMISSIONS.MEALS_CONFIG_CREATE],
  ["POST /api/meals/override", PERMISSIONS.MEALS_OVERRIDE],
  ["GET /api/kitchen", PERMISSIONS.KITCHEN_READ],
  ["POST /api/kitchen", PERMISSIONS.KITCHEN_GUEST_CREATE],
  ["DELETE /api/kitchen", PERMISSIONS.KITCHEN_GUEST_DELETE],
  ["GET /api/leave", PERMISSIONS.LEAVE_READ],
  ["POST /api/leave", PERMISSIONS.LEAVE_CREATE],
  ["GET /api/bills", PERMISSIONS.BILLS_READ],
  ["POST /api/bills", PERMISSIONS.BILLS_GENERATE],
  ["DELETE /api/bills", PERMISSIONS.BILLS_DELETE],
  ["GET /api/billing-cycles/readiness", PERMISSIONS.BILLING_CYCLES_READ],
  ["GET /api/billing-cycles", PERMISSIONS.BILLING_CYCLES_READ],
  ["POST /api/billing-cycles", PERMISSIONS.BILLING_CYCLES_CLOSE],
  ["GET /api/payments", PERMISSIONS.PAYMENTS_READ],
  ["POST /api/payments", PERMISSIONS.PAYMENTS_CREATE],
  ["GET /api/payments/refund", PERMISSIONS.PAYMENTS_REFUND],
  ["POST /api/payments/refund", PERMISSIONS.PAYMENTS_REFUND],
  ["GET /api/refunds", PERMISSIONS.REFUNDS_READ],
  ["POST /api/refunds", PERMISSIONS.REFUNDS_CREATE],
  ["GET /api/adjustments", PERMISSIONS.ADJUSTMENTS_READ],
  ["POST /api/adjustments", PERMISSIONS.ADJUSTMENTS_CREATE],
  ["GET /api/expenses", PERMISSIONS.EXPENSES_READ],
  ["POST /api/expenses", PERMISSIONS.EXPENSES_CREATE],
  ["GET /api/funds", PERMISSIONS.FUNDS_READ],
  ["GET /api/variables", PERMISSIONS.VARIABLES_READ],
  ["POST /api/variables", PERMISSIONS.VARIABLES_CREATE],
  ["GET /api/formulas", PERMISSIONS.FORMULAS_READ],
  ["POST /api/formulas", PERMISSIONS.FORMULAS_CREATE],
  ["POST /api/formulas/test", PERMISSIONS.FORMULAS_TEST],
]);

const USER_ACTION_PERMISSION: Record<string, PermissionKey> = {
  APPROVE: PERMISSIONS.USERS_APPROVE,
  ASSIGN_ROLE: PERMISSIONS.USERS_ROLE_ASSIGN,
  SUSPEND: PERMISSIONS.USERS_STATUS_CHANGE,
  ACTIVATE: PERMISSIONS.USERS_STATUS_CHANGE,
  DEACTIVATE: PERMISSIONS.USERS_STATUS_CHANGE,
  ARCHIVE: PERMISSIONS.USERS_STATUS_CHANGE,
  RESTORE: PERMISSIONS.USERS_STATUS_CHANGE,
};

function dynamicPolicy(method: Method, path: string): DynamicPolicy {
  if (method === "DELETE" && /^\/api\/auth\/sessions\/[^/]+$/u.test(path)) {
    return PERMISSIONS.SESSIONS_REVOKE_SELF;
  }
  if (method === "GET" && /^\/api\/tasks\/[^/]+$/u.test(path)) {
    return PERMISSIONS.TASKS_READ;
  }
  if (method === "POST" && /^\/api\/tasks\/[^/]+\/cancel$/u.test(path)) {
    return PERMISSIONS.TASKS_CANCEL;
  }
  if (method === "PATCH" && /^\/api\/announcements\/[^/]+$/u.test(path)) {
    return PERMISSIONS.ANNOUNCEMENTS_UPDATE;
  }
  if (method === "DELETE" && /^\/api\/announcements\/[^/]+$/u.test(path)) {
    return PERMISSIONS.ANNOUNCEMENTS_ARCHIVE;
  }
  if (method === "DELETE" && /^\/api\/settings\/[^/]+$/u.test(path)) {
    return PERMISSIONS.SETTINGS_DELETE;
  }
  if (method === "PATCH" && /^\/api\/holidays\/[^/]+$/u.test(path)) {
    return PERMISSIONS.HOLIDAYS_UPDATE;
  }
  if (method === "DELETE" && /^\/api\/holidays\/[^/]+$/u.test(path)) {
    return PERMISSIONS.HOLIDAYS_ARCHIVE;
  }
  if (method === "GET" && /^\/api\/users\/[^/]+\/360$/u.test(path)) {
    return PERMISSIONS.USERS_READ;
  }
  if (method === "PATCH" && /^\/api\/users\/[^/]+\/request-changes$/u.test(path)) {
    return PERMISSIONS.USERS_REQUEST_CHANGES;
  }
  if (method === "PATCH" && /^\/api\/users\/[^/]+\/reject$/u.test(path)) {
    return PERMISSIONS.USERS_REJECT;
  }
  if (method === "POST" && /^\/api\/users\/[^/]+\/restore$/u.test(path)) {
    return PERMISSIONS.USERS_RESTORE;
  }
  if (method === "PUT" && /^\/api\/users\/[^/]+$/u.test(path)) {
    return PERMISSIONS.USERS_UPDATE;
  }
  if (method === "DELETE" && /^\/api\/users\/[^/]+$/u.test(path)) {
    return PERMISSIONS.USERS_DELETE;
  }
  if (method === "PATCH" && /^\/api\/users\/[^/]+$/u.test(path)) {
    return "USER_ACTION";
  }
  if (method === "GET" && /^\/api\/meals\/config\/[^/]+$/u.test(path)) {
    return PERMISSIONS.MEALS_CONFIG_READ;
  }
  if (method === "PUT" && /^\/api\/meals\/config\/[^/]+$/u.test(path)) {
    return PERMISSIONS.MEALS_CONFIG_UPDATE;
  }
  if (method === "DELETE" && /^\/api\/meals\/config\/[^/]+$/u.test(path)) {
    return PERMISSIONS.MEALS_CONFIG_DELETE;
  }
  if (method === "PATCH" && /^\/api\/leave\/[^/]+$/u.test(path)) {
    return PERMISSIONS.LEAVE_DECIDE;
  }
  if (method === "GET" && /^\/api\/bills\/[^/]+$/u.test(path)) {
    return PERMISSIONS.BILLS_READ;
  }
  if (method === "DELETE" && /^\/api\/bills\/[^/]+$/u.test(path)) {
    return PERMISSIONS.BILLS_DELETE;
  }
  if (method === "POST" && /^\/api\/bills\/[^/]+\/restore$/u.test(path)) {
    return PERMISSIONS.BILLS_RESTORE;
  }
  if (method === "POST" && /^\/api\/bills\/[^/]+\/void$/u.test(path)) {
    return PERMISSIONS.BILLS_VOID;
  }
  if (method === "POST" && /^\/api\/billing-cycles\/[^/]+\/rollback$/u.test(path)) {
    return PERMISSIONS.BILLING_CYCLES_ROLLBACK;
  }
  if (method === "GET" && /^\/api\/payments\/[^/]+$/u.test(path)) {
    return PERMISSIONS.PAYMENTS_READ;
  }
  if (method === "PATCH" && /^\/api\/payments\/[^/]+$/u.test(path)) {
    return PERMISSIONS.PAYMENTS_DECIDE;
  }
  if (method === "PUT" && /^\/api\/payments\/[^/]+$/u.test(path)) {
    return "PAYMENT_PUT_ACTION";
  }
  if (method === "DELETE" && /^\/api\/payments\/[^/]+$/u.test(path)) {
    return PERMISSIONS.PAYMENTS_DELETE;
  }
  if (method === "POST" && /^\/api\/payments\/[^/]+\/restore$/u.test(path)) {
    return PERMISSIONS.PAYMENTS_RESTORE;
  }
  if (method === "GET" && /^\/api\/refunds\/[^/]+$/u.test(path)) {
    return PERMISSIONS.REFUNDS_READ;
  }
  if (method === "POST" && /^\/api\/refunds\/[^/]+\/partial$/u.test(path)) {
    return PERMISSIONS.REFUNDS_PAY;
  }
  if (method === "POST" && /^\/api\/refunds\/[^/]+\/cancel$/u.test(path)) {
    return PERMISSIONS.REFUNDS_CANCEL;
  }
  if (method === "GET" && /^\/api\/expenses\/[^/]+$/u.test(path)) {
    return PERMISSIONS.EXPENSES_READ;
  }
  if (method === "PUT" && /^\/api\/expenses\/[^/]+$/u.test(path)) {
    return PERMISSIONS.EXPENSES_REPLACE;
  }
  if (method === "DELETE" && /^\/api\/expenses\/[^/]+$/u.test(path)) {
    return PERMISSIONS.EXPENSES_DELETE;
  }
  if (method === "POST" && /^\/api\/expenses\/[^/]+\/restore$/u.test(path)) {
    return PERMISSIONS.EXPENSES_RESTORE;
  }
  if (method === "PUT" && /^\/api\/variables\/[^/]+$/u.test(path)) {
    return PERMISSIONS.VARIABLES_UPDATE;
  }
  if (method === "DELETE" && /^\/api\/variables\/[^/]+$/u.test(path)) {
    return PERMISSIONS.VARIABLES_ARCHIVE;
  }
  if (method === "PATCH" && /^\/api\/formulas\/[^/]+$/u.test(path)) {
    return PERMISSIONS.FORMULAS_UPDATE;
  }
  if (method === "DELETE" && /^\/api\/formulas\/[^/]+$/u.test(path)) {
    return PERMISSIONS.FORMULAS_ARCHIVE;
  }
  return null;
}

async function readAction(c: Context<AppEnv>, missingMessage: string): Promise<string | Response> {
  let body: unknown;
  try {
    body = await c.req.raw.clone().json();
  } catch {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const action = typeof body === "object" && body !== null && "action" in body
    ? String((body as Record<string, unknown>).action ?? "")
    : "";
  if (!action) {
    return c.json({ success: false, error: missingMessage }, 403);
  }
  return action;
}

async function permissionForUserAction(c: Context<AppEnv>): Promise<PermissionKey | Response> {
  const action = await readAction(c, "RBAC policy missing for user action");
  if (action instanceof Response) return action;
  const permission = USER_ACTION_PERMISSION[action];
  if (!permission) {
    return c.json(
      { success: false, error: "RBAC policy missing for user action" },
      403,
    );
  }
  return permission;
}

async function permissionForPaymentPutAction(c: Context<AppEnv>): Promise<PermissionKey | Response> {
  const action = await readAction(c, "RBAC policy missing for payment action");
  if (action instanceof Response) return action;
  if (action === "EDIT") return PERMISSIONS.PAYMENTS_UPDATE;
  if (action === "VOID") return PERMISSIONS.PAYMENTS_VOID;
  return c.json({ success: false, error: "RBAC policy missing for payment action" }, 403);
}

/**
 * Phase 05 authorization boundary.
 *
 * Every non-public /api endpoint must have an explicit permission mapping.
 * Unknown API endpoints fail closed instead of silently inheriting a role check
 * or becoming reachable when a new route is added without an authorization
 * decision. The canonical principal resolver accepts only the HttpOnly session
 * cookie, completing the browser bearer-token migration at the policy boundary.
 */
export async function enforceRbacPolicy(c: Context<AppEnv>, next: Next) {
  if (c.req.method === "OPTIONS") {
    await next();
    return;
  }

  const method = c.req.method.toUpperCase() as Method;
  const path = new URL(c.req.url).pathname;
  const endpoint = `${method} ${path}`;

  if (PUBLIC_ENDPOINTS.has(endpoint)) {
    await next();
    return;
  }

  let permission = EXACT_POLICIES.get(endpoint) ?? dynamicPolicy(method, path);
  if (permission === "USER_ACTION") {
    const resolved = await permissionForUserAction(c);
    if (resolved instanceof Response) return resolved;
    permission = resolved;
  } else if (permission === "PAYMENT_PUT_ACTION") {
    const resolved = await permissionForPaymentPutAction(c);
    if (resolved instanceof Response) return resolved;
    permission = resolved;
  }

  if (!permission) {
    return c.json(
      {
        success: false,
        error: "RBAC policy missing for endpoint",
      },
      403,
    );
  }

  const authorization = await requirePermission(c, permission);
  if (authorization instanceof Response) return authorization;

  await next();
}
