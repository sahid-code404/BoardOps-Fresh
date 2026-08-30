function envelope<T>(data: T) {
  return { success: true, data };
}

export function visualReportsFixtureResponse<T>(path: string): T | undefined {
  const url = new URL(path, "https://boardops.visual.local");
  const pathname = url.pathname;
  const month = Number(url.searchParams.get("month") ?? new Date().getMonth());
  const year = Number(url.searchParams.get("year") ?? new Date().getFullYear());
  const period = { month, year };

  if (pathname === "/reports/financial") {
    return envelope({
      period,
      summary: {
        totalExpenses: 4500,
        totalPurchases: 0,
        purchaseCount: 0,
        totalDeposits: 5000,
        depositCount: 1,
        totalBills: 18500,
        totalCollected: 5000,
        outstandingDue: 13500,
        refundTotal: 0,
        refundPaid: 0,
        refundCount: 0,
        netPosition: 500,
      },
      expenseByCategory: [
        { category: "GROCERY", amount: 3000 },
        { category: "UTILITIES", amount: 1500 },
      ],
      billStatusBreakdown: { GENERATED: 0, PARTIALLY_PAID: 1, PAID: 0, OVERDUE: 0, VOID: 0 },
      comparison: { prevExpenses: 0, prevDeposits: 0, expenseChange: 4500, depositChange: 5000 },
    }) as T;
  }

  if (pathname === "/reports/meals") {
    return envelope({
      period,
      summary: { totalMeals: 4, totalGuests: 0, totalOverrides: 0, holidayCount: 0, activeMealCount: 3 },
      perMeal: [
        { mealId: "meal-breakfast", mealName: "breakfast", displayName: "Breakfast", on: 2, off: 0, overridden: 0, guests: 0, total: 2, participation: 100 },
        { mealId: "meal-lunch", mealName: "lunch", displayName: "Lunch", on: 1, off: 0, overridden: 0, guests: 0, total: 1, participation: 100 },
        { mealId: "meal-dinner", mealName: "dinner", displayName: "Dinner", on: 1, off: 0, overridden: 0, guests: 0, total: 1, participation: 100 },
      ],
    }) as T;
  }

  if (pathname === "/reports/purchases") {
    return envelope({
      period,
      summary: { totalSpend: 0, purchaseCount: 0, itemCount: 0, avgPurchaseValue: 0 },
      topProducts: [],
      topCategories: [],
      vendorBreakdown: [],
    }) as T;
  }

  if (pathname === "/reports/outstanding") {
    return envelope({
      period,
      summary: {
        totalOutstanding: 13500,
        totalCurrentDue: 13500,
        totalPreviousDue: 0,
        residentCount: 1,
        billCount: 1,
        avgDaysOutstanding: 20,
      },
      rows: [
        {
          userId: "visual-arjun",
          userName: "Arjun Rao",
          userEmail: "arjun@boardops.local",
          room: "A-101",
          billNumber: "bill_arjun_visual",
          period: `${month + 1}/${year}`,
          currentBill: 18500,
          paidAmount: 5000,
          dueAmount: 13500,
          previousDue: 0,
          totalOutstanding: 13500,
          daysOutstanding: 20,
          status: "PARTIALLY_PAID",
          dueDate: "2026-08-10T00:00:00.000Z",
        },
      ],
    }) as T;
  }

  if (pathname === "/reports/residents") {
    return envelope({
      summary: {
        residentCount: 1,
        totalBalance: 0,
        totalDue: 4860,
        totalDeposited: 0,
        totalBilled: 4860,
        healthyCount: 0,
        lowBalanceCount: 0,
        overdueCount: 1,
        restrictedCount: 0,
        exemptedCount: 0,
      },
      rows: [
        {
          userId: "visual-user",
          userName: "Riya Sen",
          userEmail: "resident@boardops.local",
          room: "B-204",
          availableBalance: 0,
          pendingDeposits: 0,
          refundPending: 0,
          outstandingDue: 4860,
          previousDue: 4860,
          totalDeposited: 0,
          totalBilled: 4860,
          totalRefunded: 0,
          financialStatus: "OVERDUE",
        },
      ],
    }) as T;
  }

  return undefined;
}
