"use client";

import { navForRole, type NavItem } from "./nav-config";
import type { Role } from "@/stores/use-auth-store";

export type NavGroup = { title: string; items: NavItem[] };

/** Group nav items into Workspace / Finance / Administration sections. */
export function groupNavItems(items: NavItem[]): NavGroup[] {
  const groups: NavGroup[] = [
    { title: "Workspace", items: [] },
    { title: "Finance", items: [] },
    { title: "Administration", items: [] },
  ];
  items.forEach((item) => {
    if (["dashboard", "meals", "user-meals", "kitchen"].includes(item.view)) groups[0].items.push(item);
    else if (["billing", "payments", "expenses", "funds", "monthly-closing"].includes(item.view)) groups[1].items.push(item);
    else groups[2].items.push(item);
  });
  return groups.filter((group) => group.items.length > 0);
}

export function groupedNavForRole(role: Role, permissions: readonly string[] = []): NavGroup[] {
  return groupNavItems(navForRole(role, permissions));
}
