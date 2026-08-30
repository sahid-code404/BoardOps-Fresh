type VisualFetchOpts = RequestInit & { params?: Record<string, unknown> };

/**
 * Explicit Funds visual contract.
 *
 * Keep this outside the generic visual fixture switch so the finance screen is
 * exercised with the same composite shape as the real Worker instead of the
 * generic empty-collection fallback used for still-unowned domains.
 */
export function visualFundsFixtureResponse<T>(path: string, opts: VisualFetchOpts = {}): T | undefined {
  const url = new URL(path, "https://boardops.visual.local");
  if (url.pathname !== "/funds") return undefined;

  const month = Number(opts.params?.month ?? url.searchParams.get("month") ?? 7);
  const year = Number(opts.params?.year ?? url.searchParams.get("year") ?? 2026);
  const isAugust2026 = month === 7 && year === 2026;

  const data = isAugust2026
    ? {
        totalDeposit: 5000,
        totalExpenses: 4500,
        remainingFund: 500,
        totalRefunded: 0,
        month,
        year,
        users: [
          {
            userId: "visual-user",
            name: "Riya Sen",
            email: "resident@boardops.local",
            room: "B-204",
            avatarUrl: null,
            billTotal: 0,
            deposit: 0,
            needToPay: 0,
            deficit: 4500,
            hasBills: false,
          },
        ],
      }
    : {
        totalDeposit: 0,
        totalExpenses: 0,
        remainingFund: 0,
        totalRefunded: 0,
        month,
        year,
        users: [],
      };

  return { success: true, data } as T;
}
