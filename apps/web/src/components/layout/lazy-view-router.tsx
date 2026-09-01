"use client";

import { lazy, Suspense, useMemo } from "react";
import type { ViewKey } from "@/stores/use-app-store";
import { VIEW_COMPONENT_LOADERS } from "@/lib/view-loaders";
import { ShimmerSkeleton } from "@/components/glass/shimmer-skeleton";
import { DashboardView } from "@/components/features/dashboard/dashboard-view";

const MealsConfigView = lazy(VIEW_COMPONENT_LOADERS.meals);
const UserMealsView = lazy(VIEW_COMPONENT_LOADERS["user-meals"]);
const KitchenView = lazy(VIEW_COMPONENT_LOADERS.kitchen);
const BillingHubView = lazy(VIEW_COMPONENT_LOADERS.billing);
const PaymentsView = lazy(VIEW_COMPONENT_LOADERS.payments);
const ExpensesHubView = lazy(VIEW_COMPONENT_LOADERS.expenses);
const FundsView = lazy(VIEW_COMPONENT_LOADERS.funds);
const MonthlyClosingView = lazy(VIEW_COMPONENT_LOADERS["monthly-closing"]);
const ReportsView = lazy(VIEW_COMPONENT_LOADERS.reports);
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

export function LazyViewRouter({ view }: { view: ViewKey }) {
  const content = useMemo(() => {
    switch (view) {
      case "dashboard": return <DashboardView />;
      case "meals": return <MealsConfigView />;
      case "user-meals": return <UserMealsView />;
      case "kitchen": return <KitchenView />;
      case "billing": return <BillingHubView />;
      case "payments": return <PaymentsView />;
      case "expenses": return <ExpensesHubView />;
      case "funds": return <FundsView />;
      case "monthly-closing": return <MonthlyClosingView />;
      case "reports": return <ReportsView />;
      case "users": return <UsersView />;
      case "notifications": return <NotificationsHubView />;
      case "settings": return <SettingsHubView />;
      case "system": return <SystemHubView />;
      case "profile": return <ProfileView />;
      default: return <DashboardView />;
    }
  }, [view]);

  return <Suspense fallback={<ViewSkeleton />}>{content}</Suspense>;
}
