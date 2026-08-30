import type { ComponentType } from "react";
import type { ViewKey } from "@/lib/view-routes";

type ViewModule = { default: ComponentType };
type ViewLoader = () => Promise<ViewModule>;

function cached(loader: ViewLoader): ViewLoader {
  let promise: Promise<ViewModule> | null = null;
  return () => {
    promise ??= loader();
    return promise;
  };
}

export const VIEW_COMPONENT_LOADERS: Record<ViewKey, ViewLoader> = {
  dashboard: cached(() =>
    import("@/components/features/dashboard/dashboard-view").then((m) => ({ default: m.DashboardView })),
  ),
  meals: cached(() =>
    import("@/components/features/meals/meals-config-view").then((m) => ({ default: m.MealsConfigView })),
  ),
  "user-meals": cached(() =>
    import("@/components/features/meals/user-meals-view").then((m) => ({ default: m.UserMealsView })),
  ),
  kitchen: cached(() =>
    import("@/components/features/kitchen/kitchen-view").then((m) => ({ default: m.KitchenView })),
  ),
  billing: cached(() =>
    import("@/components/features/billing/billing-hub-view").then((m) => ({ default: m.BillingHubView })),
  ),
  payments: cached(() =>
    import("@/components/features/billing/payments-view").then((m) => ({ default: m.PaymentsView })),
  ),
  expenses: cached(() =>
    import("@/components/features/billing/expenses-hub-view").then((m) => ({ default: m.ExpensesHubView })),
  ),
  funds: cached(() =>
    import("@/components/features/billing/funds-view").then((m) => ({ default: m.FundsView })),
  ),
  "monthly-closing": cached(() =>
    import("@/components/features/billing/monthly-closing-view").then((m) => ({ default: m.MonthlyClosingView })),
  ),
  "formula-engine": cached(() =>
    import("@/components/features/variables/formula-engine-view").then((m) => ({ default: m.FormulaEngineView })),
  ),
  reports: cached(() =>
    import("@/components/features/reports/reports-view").then((m) => ({ default: m.ReportsView })),
  ),
  users: cached(() =>
    import("@/components/features/users/users-view").then((m) => ({ default: m.UsersView })),
  ),
  notifications: cached(() =>
    import("@/components/features/notifications/notifications-hub-view").then((m) => ({ default: m.NotificationsHubView })),
  ),
  settings: cached(() =>
    import("@/components/features/settings/settings-hub-view").then((m) => ({ default: m.SettingsHubView })),
  ),
  system: cached(() =>
    import("@/components/features/system/system-hub-view").then((m) => ({ default: m.SystemHubView })),
  ),
  profile: cached(() =>
    import("@/components/features/auth/profile-view").then((m) => ({ default: m.ProfileView })),
  ),
};

const ADMIN_PRIORITY_VIEWS: ViewKey[] = [
  "profile",
  "kitchen",
  "payments",
  "users",
  "notifications",
];

const USER_PRIORITY_VIEWS: ViewKey[] = [
  "profile",
  "user-meals",
  "billing",
  "payments",
  "notifications",
];

export function preloadView(view: ViewKey): Promise<ViewModule> {
  // Defensive runtime boundary. TypeScript knows ViewKey is valid, but values
  // originating from persisted/server data can arrive here after an unsafe
  // cast in older ported code. Return a normal rejection instead of throwing a
  // `loader is not a function` TypeError that can tear down navigation.
  const loader = (VIEW_COMPONENT_LOADERS as Partial<Record<string, ViewLoader>>)[view as string];
  if (!loader) return Promise.reject(new Error(`Unknown BoardOps view: ${String(view)}`));
  return loader();
}

/**
 * Warm the routes a signed-in user is most likely to open next. This starts
 * after the shell paints, so it does not block Dashboard first paint, but it
 * avoids the multi-hundred-millisecond first-click delay caused by compiling a
 * large feature chunk only after the user has already clicked navigation.
 */
export async function preloadPriorityViews(isAdmin: boolean): Promise<void> {
  const views = isAdmin ? ADMIN_PRIORITY_VIEWS : USER_PRIORITY_VIEWS;
  await Promise.allSettled(views.map((view) => VIEW_COMPONENT_LOADERS[view]()));
}

export async function preloadAllViews(): Promise<void> {
  await Promise.allSettled(Object.values(VIEW_COMPONENT_LOADERS).map((loader) => loader()));
}
