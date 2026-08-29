"use client";

import { lazy, Suspense, useMemo } from "react";
import type { ViewKey } from "@/stores/use-app-store";
import { VIEW_COMPONENT_LOADERS } from "@/lib/view-loaders";
import { ShimmerSkeleton } from "@/components/glass/shimmer-skeleton";

// Route-level code splitting is intentionally preserved. `setView()` preloads
// the target module before committing navigation, so this fallback is now a
// safety net for first-load/network edge cases instead of a routine flash on
// every section change.
const DashboardView = lazy(VIEW_COMPONENT_LOADERS.dashboard);
const MealsConfigView = lazy(VIEW_COMPONENT_LOADERS.meals);
const UserMealsView = lazy(VIEW_COMPONENT_LOADERS["user-meals"]);
const KitchenView = lazy(VIEW_COMPONENT_LOADERS.kitchen);
const BillingHubView = lazy(VIEW_COMPONENT_LOADERS.billing);
const PaymentsView = lazy(VIEW_COMPONENT_LOADERS.payments);
const ExpensesHubView = lazy(VIEW_COMPONENT_LOADERS.expenses);
const FundsView = lazy(VIEW_COMPONENT_LOADERS.funds);
const MonthlyClosingView = lazy(VIEW_COMPONENT_LOADERS["monthly-closing"]);
const FormulaEngineView = lazy(VIEW_COMPONENT_LOADERS["formula-engine"]);
const UsersView = lazy(VIEW_COMPONENT_LOADERS.users);
const NotificationsHubView = lazy(VIEW_COMPONENT_LOADERS.notifications);
const SettingsHubView = lazy(VIEW_COMPONENT_LOADERS.settings);
const SystemHubView = lazy(VIEW_COMPONENT_LOADERS.system);
const ProfileView = lazy(VIEW_COMPONENT_LOADERS.profile);

function ViewSkeleton() {
  return (
    <div className="space-y-4" aria-label="Loading section">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <ShimmerSkeleton className="h-28" />
        <ShimmerSkeleton className="h-28" />
        <ShimmerSkeleton className="h-28" />
      </div>
      <div className="space-y-3">
        <ShimmerSkeleton className="h-16" />
        <ShimmerSkeleton className="h-16" />
        <ShimmerSkeleton className="h-16" />
      </div>
    </div>
  );
}

export function LazyViewRouter({
  view,
  isAdmin,
}: {
  view: ViewKey;
  isAdmin: boolean;
}) {
  const content = useMemo(() => {
    switch (view) {
      case "dashboard": return <DashboardView />;
      case "meals": return isAdmin ? <MealsConfigView /> : null;
      case "user-meals": return <UserMealsView />;
      case "kitchen": return isAdmin ? <KitchenView /> : null;
      case "billing": return <BillingHubView />;
      case "payments": return <PaymentsView />;
      case "expenses": return isAdmin ? <ExpensesHubView /> : null;
      case "funds": return isAdmin ? <FundsView /> : null;
      case "monthly-closing": return isAdmin ? <MonthlyClosingView /> : null;
      case "formula-engine": return isAdmin ? <FormulaEngineView /> : null;
      case "users": return isAdmin ? <UsersView /> : null;
      case "notifications": return <NotificationsHubView />;
      case "settings": return isAdmin ? <SettingsHubView /> : null;
      case "system": return isAdmin ? <SystemHubView /> : null;
      case "profile": return <ProfileView />;
      default: return <DashboardView />;
    }
  }, [view, isAdmin]);

  return <Suspense fallback={<ViewSkeleton />}>{content}</Suspense>;
}
