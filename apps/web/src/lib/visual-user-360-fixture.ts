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
      contractVersion: 2,
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
      fundAccount: {
        availableBalance: 1200,
        pendingDeposits: 500,
        refundPending: 250,
        outstandingDue: 800,
        previousDue: 300,
        financialStatus: "HEALTHY",
        totalDeposited: 9000,
        totalBilled: 7800,
        totalRefunded: 400,
        ledgerEntryCount: 7,
      },
      restrictions: {
        canBookMeals: true,
        financialStatus: "HEALTHY",
        availableBalance: 1200,
        requiredBalance: 1000,
        graceDaysRemaining: null,
        hasExemption: false,
        restrictionReason: null,
      },
      activeRestrictions: [],
      recentBills: [
        {
          id: "visual-bill-1",
          billNumber: "BILL-2026-08-0204",
          periodMonth: 7,
          periodYear: 2026,
          totalAmount: 3200,
          paidAmount: 2400,
          dueAmount: 800,
          previousDue: 300,
          status: "PARTIALLY_PAID",
          dueDate: "2026-09-10T00:00:00.000Z",
        },
      ],
      recentPayments: [
        {
          id: "visual-payment-1",
          amount: 2400,
          method: "UPI",
          status: "APPROVED",
          reference: "UTR-VISUAL-2400",
          effectiveMonth: 7,
          effectiveYear: 2026,
          createdAt: "2026-08-26T10:00:00.000Z",
        },
      ],
      recentRefunds: [
        {
          id: "visual-refund-1",
          refundNumber: "REF-2026-0204",
          amount: 650,
          paidAmount: 400,
          remainingAmount: 250,
          status: "PARTIALLY_PAID",
          createdAt: "2026-08-27T09:00:00.000Z",
        },
      ],
      ledger: [
        {
          id: "visual-ledger-2",
          type: "DEPOSIT",
          amount: 2400,
          runningBalance: 1200,
          description: "Payment · UPI",
          createdAt: "2026-08-26T10:00:00.000Z",
        },
        {
          id: "visual-ledger-1",
          type: "BILL_SETTLEMENT",
          amount: -3200,
          runningBalance: -1200,
          description: "Bill · 2026-08",
          createdAt: "2026-08-25T10:00:00.000Z",
        },
      ],
      mealStats: { currentMonthON: 18 },
      loginHistory: [],
      dataAvailability: {
        profile: true,
        loginHistory: true,
        fundAccount: true,
        bills: true,
        payments: true,
        refunds: true,
        ledger: true,
        meals: true,
        restrictions: true,
      },
    },
  } as T;
}
