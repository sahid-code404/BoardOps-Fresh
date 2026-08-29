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

export function preloadView(view: ViewKey): Promise<ViewModule> {
  return VIEW_COMPONENT_LOADERS[view]();
}
