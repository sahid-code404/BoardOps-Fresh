"use client";

import { useState } from "react";
import { ExpensesView } from "@/components/features/billing/expenses-view";
import { ProductsView } from "@/components/features/billing/products-view";
import { PurchasesView } from "@/components/features/billing/purchases-view";
import { GlassNav } from "@/components/glass/glass-nav";
import {
  StaggerGroup,
  StaggerItem,
} from "@/components/glass/page-transition";

type Tab = "expenses" | "purchases" | "products";

const TABS = [
  { value: "expenses", label: "Expenses" },
  { value: "purchases", label: "Purchases" },
  { value: "products", label: "Products" },
];

export function ExpensesHubView() {
  const [tab, setTab] = useState<Tab>("expenses");

  return (
    <StaggerGroup className="space-y-5">
      <StaggerItem>
        <GlassNav
          items={TABS}
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
