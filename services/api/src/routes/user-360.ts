import { Hono } from "hono";
import { authenticatedPrincipal } from "../auth/authorization";
import type { AppEnv } from "../types";

type User360Row = {
  id: string;
  institution_id: string;
  name: string;
  email: string;
  phone: string | null;
  role: "SUPER_ADMIN" | "ADMIN" | "MANAGER" | "USER";
  status: "ACTIVE" | "PENDING" | "SUSPENDED" | "ARCHIVED" | "INACTIVE";
  avatar_url: string | null;
  room: string | null;
  gender: string | null;
  emergency_contact: string | null;
  institution_name: string;
  institution_user_id: string | null;
  email_verified: number;
  created_at: string;
  last_login_at: string | null;
};

type LoginHistoryRow = {
  id: string;
  success: number;
  ip_address: string | null;
  created_at: string;
  reason: string | null;
};

export const user360Routes = new Hono<AppEnv>();

/**
 * GET /api/users/:id/360
 *
 * Phase 05 owns identity/auth/RBAC only. The route therefore exposes every
 * resident value that is backed by canonical D1 tables today and explicitly
 * marks later financial/meal/restriction domains unavailable. It never invents
 * zero balances, meal counts, or booking eligibility to fill missing schemas.
 */
user360Routes.get("/users/:id/360", async (c) => {
  const viewer = await authenticatedPrincipal(c);
  if (!viewer) return c.json({ success: false, error: "Authentication required" }, 401);

  const userId = c.req.param("id");
  const user = await c.env.DB.prepare(
    `SELECT
       u.id, u.institution_id, u.name, u.email, u.phone, u.role, u.status,
       u.avatar_url, u.room, u.gender, u.emergency_contact,
       i.name AS institution_name, u.institution_user_id, u.email_verified,
       u.created_at, u.last_login_at
     FROM users u
     JOIN institutions i ON i.id = u.institution_id
     WHERE u.id = ? AND u.institution_id = ?
     LIMIT 1`,
  )
    .bind(userId, viewer.institutionId)
    .first<User360Row>();

  if (!user) return c.json({ success: false, error: "User not found" }, 404);

  const loginHistory = await c.env.DB.prepare(
    `SELECT id, success, ip_address, created_at, reason
     FROM login_history
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT 3`,
  )
    .bind(user.id)
    .all<LoginHistoryRow>();

  return c.json({
    success: true,
    data: {
      contractVersion: 1,
      profile: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: user.status,
        avatarUrl: user.avatar_url,
        room: user.room,
        gender: user.gender,
        emergencyContact: user.emergency_contact,
        institutionName: user.institution_name,
        institutionUserId: user.institution_user_id,
        emailVerified: user.email_verified === 1,
        twoFactorEnabled: false,
        createdAt: user.created_at,
        lastLoginAt: user.last_login_at,
      },

      // These domains do not exist in canonical Phase-05 D1 yet. Null values
      // are deliberate: absence is not equivalent to a real zero balance,
      // zero meals, or an unrestricted resident.
      fundAccount: null,
      restrictions: null,
      activeRestrictions: [],
      recentBills: [],
      recentPayments: [],
      recentRefunds: [],
      ledger: [],
      mealStats: null,

      loginHistory: loginHistory.results.map((entry) => ({
        id: entry.id,
        success: entry.success === 1,
        ipAddress: entry.ip_address,
        createdAt: entry.created_at,
        reason: entry.reason,
      })),

      dataAvailability: {
        profile: true,
        loginHistory: true,
        fundAccount: false,
        bills: false,
        payments: false,
        refunds: false,
        ledger: false,
        meals: false,
        restrictions: false,
      },
    },
  });
});
