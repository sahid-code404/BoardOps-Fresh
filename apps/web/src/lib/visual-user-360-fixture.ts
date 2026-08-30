import { VISUAL_ADMIN, VISUAL_USER } from "@/lib/visual-fixtures";

const USER_360_PATH = /^\/users\/([^/]+)\/360$/u;

export function visualUser360FixtureResponse<T>(path: string): T | undefined {
  const pathname = new URL(path, "https://boardops.visual.local").pathname;
  const match = pathname.match(USER_360_PATH);
  if (!match) return undefined;

  const requestedId = match[1];
  const source = requestedId === VISUAL_ADMIN.id ? VISUAL_ADMIN : VISUAL_USER;
  const institutionUserId = requestedId === VISUAL_ADMIN.id ? "ADM-001" : "RES-204";

  return {
    success: true,
    data: {
      contractVersion: 1,
      profile: {
        id: source.id,
        name: source.name,
        email: source.email,
        phone: source.phone ?? null,
        role: source.role,
        status: source.status,
        avatarUrl: null,
        room: source.room ?? null,
        gender: source.gender ?? null,
        emergencyContact: source.emergencyContact ?? null,
        institutionName: "BoardOps Residence",
        institutionUserId,
        emailVerified: true,
        twoFactorEnabled: Boolean(source.twoFactorEnabled),
        createdAt: source.createdAt,
        lastLoginAt: source.lastLoginAt ?? null,
      },
      fundAccount: null,
      restrictions: null,
      activeRestrictions: [],
      recentBills: [],
      recentPayments: [],
      recentRefunds: [],
      ledger: [],
      mealStats: null,
      loginHistory: [],
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
  } as T;
}
