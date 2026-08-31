"use client";

import { ExpensesView } from "@/components/features/billing/expenses-view";
import {
  StaggerGroup,
  StaggerItem,
} from "@/components/glass/page-transition";

/**
 * Expenses is the single active procurement/accounting surface. The retired
 * Product/Purchase workflow is intentionally not exposed to operators; legacy
 * database evidence remains untouched for historical integrity.
 */
export function ExpensesHubView() {
  return (
    <StaggerGroup className="space-y-5">
      <StaggerItem>
        <ExpensesView />
      </StaggerItem>
    </StaggerGroup>
  );
}
