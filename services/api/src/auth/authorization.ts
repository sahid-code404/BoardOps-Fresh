import { getCookie } from "hono/cookie";
import type { Context } from "hono";
import { tokenDigest } from "./crypto";
import type { AppEnv } from "../types";

const SESSION_COOKIE = "boardops_session";

export const PERMISSIONS = {
  DASHBOARD_READ: "dashboard.read",
  AUDIT_READ: "audit.read",
  TASKS_READ: "tasks.read",
  TASKS_CREATE: "tasks.create",
  TASKS_CANCEL: "tasks.cancel",
  TASKS_CLEANUP: "tasks.cleanup",
  SYSTEM_BACKUP: "system.backup",
  NOTIFICATIONS_READ_SELF: "notifications.read_self",
  NOTIFICATIONS_MARK_READ_SELF: "notifications.mark_read_self",
  ANNOUNCEMENTS_READ: "announcements.read",
  ANNOUNCEMENTS_CREATE: "announcements.create",
  ANNOUNCEMENTS_UPDATE: "announcements.update",
  ANNOUNCEMENTS_ARCHIVE: "announcements.archive",
  REPORTS_READ: "reports.read",
  REPORTS_EXPORT: "reports.export",
  SETTINGS_READ: "settings.read",
  SETTINGS_WRITE: "settings.write",
  SETTINGS_DELETE: "settings.delete",
  INSTITUTION_READ: "institution.read",
  INSTITUTION_UPDATE: "institution.update",
  POLICIES_READ: "policies.read",
  POLICIES_UPDATE: "policies.update",
  HOLIDAYS_READ: "holidays.read",
  HOLIDAYS_CREATE: "holidays.create",
  HOLIDAYS_UPDATE: "holidays.update",
  HOLIDAYS_ARCHIVE: "holidays.archive",
  PROFILE_READ_SELF: "profile.read_self",
  PROFILE_UPDATE_SELF: "profile.update_self",
  SESSIONS_READ_SELF: "sessions.read_self",
  SESSIONS_REVOKE_SELF: "sessions.revoke_self",
  PASSWORD_CHANGE_SELF: "password.change_self",
  AVATAR_UPDATE_SELF: "avatar.update_self",
  USERS_READ: "users.read",
  USERS_APPROVE: "users.approve",
  USERS_REQUEST_CHANGES: "users.request_changes",
  USERS_REJECT: "users.reject",
  USERS_STATUS_CHANGE: "users.status_change",
  USERS_ROLE_ASSIGN: "users.role_assign",
  USERS_UPDATE: "users.update",
  USERS_DELETE: "users.delete",
  USERS_RESTORE: "users.restore",
  MEALS_CONFIG_READ: "meals.config.read",
  MEALS_CONFIG_CREATE: "meals.config.create",
  MEALS_CONFIG_UPDATE: "meals.config.update",
  MEALS_CONFIG_DELETE: "meals.config.delete",
  KITCHEN_READ: "kitchen.read",
  KITCHEN_GUEST_CREATE: "kitchen.guest.create",
  KITCHEN_GUEST_DELETE: "kitchen.guest.delete",
  MEALS_OVERRIDE: "meals.override",
  LEAVE_READ: "leave.read",
  LEAVE_CREATE: "leave.create",
  LEAVE_DECIDE: "leave.decide",
  BILLS_READ: "bills.read",
  BILLING_READINESS: "billing.readiness",
  BILLS_GENERATE: "bills.generate",
  BILLS_DELETE: "bills.delete",
  BILLS_RESTORE: "bills.restore",
  BILLS_VOID: "bills.void",
  BILLING_CYCLES_READ: "billing_cycles.read",
  BILLING_CYCLES_CLOSE: "billing_cycles.close",
  BILLING_CYCLES_ROLLBACK: "billing_cycles.rollback",
  PAYMENTS_READ: "payments.read",
  PAYMENTS_CREATE: "payments.create",
  PAYMENTS_DECIDE: "payments.decide",
  PAYMENTS_UPDATE: "payments.update",
  PAYMENTS_VOID: "payments.void",
  PAYMENTS_DELETE: "payments.delete",
  PAYMENTS_RESTORE: "payments.restore",
  PAYMENTS_REFUND: "payments.refund",
  REFUNDS_READ: "refunds.read",
  REFUNDS_CREATE: "refunds.create",
  REFUNDS_PAY: "refunds.pay",
  REFUNDS_CANCEL: "refunds.cancel",
  ADJUSTMENTS_READ: "adjustments.read",
  ADJUSTMENTS_CREATE: "adjustments.create",
  EXPENSES_READ: "expenses.read",
  EXPENSES_CREATE: "expenses.create",
  EXPENSES_REPLACE: "expenses.replace",
  EXPENSES_DELETE: "expenses.delete",
  EXPENSES_RESTORE: "expenses.restore",
  FUNDS_READ: "funds.read",
  VARIABLES_READ: "variables.read",
  VARIABLES_CREATE: "variables.create",
  VARIABLES_UPDATE: "variables.update",
  VARIABLES_ARCHIVE: "variables.archive",
  FORMULAS_READ: "formulas.read",
  FORMULAS_CREATE: "formulas.create",
  FORMULAS_UPDATE: "formulas.update",
  FORMULAS_ARCHIVE: "formulas.archive",
  FORMULAS_TEST: "formulas.test",
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
export type RoleKey = "SUPER_ADMIN" | "ADMIN" | "MANAGER" | "USER";

export type AuthPrincipal = {
  id: string;
  institutionId: string;
  role: RoleKey;
  permissions: PermissionKey[];
};

type PrincipalRow = {
  id: string;
  institution_id: string;
  role: RoleKey;
};

type PermissionRow = {
  permission_key: string;
};

export async function permissionsForRole(
  c: Context<AppEnv>,
  institutionId: string,
  role: RoleKey,
): Promise<PermissionKey[]> {
  const rows = await c.env.DB.prepare(
    `SELECT p.permission_key
     FROM roles r
     JOIN role_permissions rp ON rp.role_id = r.id
     JOIN permissions p ON p.id = rp.permission_id
     WHERE r.institution_id = ? AND r.role_key = ?
     ORDER BY p.permission_key`,
  )
    .bind(institutionId, role)
    .all<PermissionRow>();

  return rows.results
    .map((row) => row.permission_key)
    .filter((key): key is PermissionKey => Object.values(PERMISSIONS).includes(key as PermissionKey));
}

export async function authenticatedPrincipal(c: Context<AppEnv>): Promise<AuthPrincipal | null> {
  // Phase 05 deliberately finishes the browser credential migration from the
  // source audit: protected authorization accepts only the server-managed
  // HttpOnly cookie. Bearer fallback is not part of the canonical RBAC path.
  const token = getCookie(c, SESSION_COOKIE)?.trim();
  if (!token) return null;

  const digest = await tokenDigest(token);
  const row = await c.env.DB.prepare(
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
    .bind(digest, new Date().toISOString())
    .first<PrincipalRow>();

  if (!row) return null;
  return {
    id: row.id,
    institutionId: row.institution_id,
    role: row.role,
    permissions: await permissionsForRole(c, row.institution_id, row.role),
  };
}

export async function requirePermission(
  c: Context<AppEnv>,
  permission: PermissionKey,
): Promise<{ principal: AuthPrincipal } | Response> {
  const principal = await authenticatedPrincipal(c);
  if (!principal) {
    return c.json({ success: false, error: "Authentication required" }, 401);
  }
  if (!principal.permissions.includes(permission)) {
    return c.json(
      {
        success: false,
        error: "Permission denied",
        requiredPermission: permission,
      },
      403,
    );
  }
  return { principal };
}

export function hasPermission(principal: AuthPrincipal, permission: PermissionKey): boolean {
  return principal.permissions.includes(permission);
}
