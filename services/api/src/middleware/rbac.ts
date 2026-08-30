import type { Context, Next } from "hono";
import { PERMISSIONS, requirePermission, type PermissionKey } from "../auth/authorization";
import type { AppEnv } from "../types";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

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
  ["GET /api/notifications", PERMISSIONS.NOTIFICATIONS_READ_SELF],
  ["GET /api/auth/me", PERMISSIONS.PROFILE_READ_SELF],
  ["GET /api/auth/profile", PERMISSIONS.PROFILE_READ_SELF],
  ["PUT /api/auth/profile", PERMISSIONS.PROFILE_UPDATE_SELF],
  ["POST /api/auth/change-password", PERMISSIONS.PASSWORD_CHANGE_SELF],
  ["POST /api/auth/avatar", PERMISSIONS.AVATAR_UPDATE_SELF],
  ["GET /api/auth/avatar/image", PERMISSIONS.PROFILE_READ_SELF],
  ["GET /api/auth/sessions", PERMISSIONS.SESSIONS_READ_SELF],
  ["DELETE /api/auth/sessions", PERMISSIONS.SESSIONS_REVOKE_SELF],
  ["GET /api/users", PERMISSIONS.USERS_READ],
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

function dynamicPolicy(method: Method, path: string): PermissionKey | null | "USER_ACTION" {
  if (method === "DELETE" && /^\/api\/auth\/sessions\/[^/]+$/u.test(path)) {
    return PERMISSIONS.SESSIONS_REVOKE_SELF;
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
  return null;
}

async function permissionForUserAction(c: Context<AppEnv>): Promise<PermissionKey | Response> {
  let body: unknown;
  try {
    body = await c.req.raw.clone().json();
  } catch {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const action = typeof body === "object" && body !== null && "action" in body
    ? String((body as Record<string, unknown>).action ?? "")
    : "";
  const permission = USER_ACTION_PERMISSION[action];
  if (!permission) {
    return c.json(
      { success: false, error: "RBAC policy missing for user action" },
      403,
    );
  }
  return permission;
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
