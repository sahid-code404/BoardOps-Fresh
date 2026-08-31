"use client";

import { useEffect, useMemo, useState } from "react";
import { ExpensesView } from "@/components/features/billing/expenses-view";
import { ProductsView } from "@/components/features/billing/products-view";
import { PurchasesView } from "@/components/features/billing/purchases-view";
import { GlassNav } from "@/components/glass/glass-nav";
import {
  StaggerGroup,
  StaggerItem,
} from "@/components/glass/page-transition";
import { VISUAL_FIXTURES_ENABLED } from "@/lib/visual-fixtures";
import { useAuthStore } from "@/stores/use-auth-store";

type Tab = "expenses" | "purchases" | "products";

type ProcurementTab = {
  value: Tab;
  label: string;
  permission: string;
};

const PROCUREMENT_TABS: ProcurementTab[] = [
  { value: "expenses", label: "Expenses", permission: "expenses.read" },
  { value: "purchases", label: "Purchases", permission: "purchases.read" },
  { value: "products", label: "Products", permission: "products.read" },
];

export function ExpensesHubView() {
  const permissions = useAuthStore((state) => state.permissions);
  const visibleTabs = useMemo(
    () => PROCUREMENT_TABS.filter(
      (item) => VISUAL_FIXTURES_ENABLED || permissions.includes(item.permission),
    ),
    [permissions],
  );
  const [tab, setTab] = useState<Tab>("expenses");

  useEffect(() => {
    if (visibleTabs.some((item) => item.value === tab)) return;
    const first = visibleTabs[0]?.value;
    if (first) setTab(first);
  }, [tab, visibleTabs]);

  if (visibleTabs.length === 0) return null;

  return (
    <StaggerGroup className="space-y-5">
      <StaggerItem>
        <GlassNav
          items={visibleTabs.map(({ value, label }) => ({ value, label }))}
          value={tab}
          onChange={(value) => setTab(value as Tab)}
          className="mx-auto"
        />
      </StaggerItem>
      {tab === "expenses" && <ExpensesView />}
      {tab === "purchases" && <PurchasesView />}
      {tab === "products" && <ProductsView />}
    </StaggerGroup>
  );
}
