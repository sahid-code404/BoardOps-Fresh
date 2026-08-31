"use client";

import {
  LayoutDashboard,
  UtensilsCrossed,
  Utensils,
  BarChart3,
  Wallet,
  Receipt,
  Bell,
  Users,
  Settings,
  CreditCard,
  PiggyBank,
  CalendarCheck,
  Sigma,
  ScrollText,
  type LucideIcon,
} from "lucide-react";
import type { ViewKey } from "@/stores/use-app-store";
import type { Role } from "@/stores/use-auth-store";

export type NavItem = {
  view: ViewKey;
  label: string;
  icon: LucideIcon;
  roles: Role[];
  permission: string;
  primary?: boolean;
  primaryRoles?: Role[];
  rail?: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  { view: "dashboard", label: "Home", icon: LayoutDashboard, roles: ["ADMIN", "USER"], permission: "dashboard.read", primary: true, rail: true },
  { view: "meals", label: "Meal Configuration", icon: UtensilsCrossed, roles: ["ADMIN"], permission: "meals.config.read", rail: true },
  { view: "user-meals", label: "Meals", icon: Utensils, roles: ["USER"], permission: "meals.config.read", primaryRoles: ["USER"], rail: true },
  { view: "kitchen", label: "Counts", icon: BarChart3, roles: ["ADMIN"], permission: "kitchen.read", primary: true, rail: true },
  { view: "billing", label: "Billing", icon: Wallet, roles: ["ADMIN", "USER"], permission: "bills.read", primaryRoles: ["USER"], rail: true },
  { view: "payments", label: "Payments", icon: CreditCard, roles: ["ADMIN", "USER"], permission: "payments.read", primary: true, rail: true },
  { view: "expenses", label: "Expenses", icon: Receipt, roles: ["ADMIN"], permission: "expenses.read", rail: true },
  { view: "funds", label: "Funds", icon: PiggyBank, roles: ["ADMIN"], permission: "funds.read", rail: true },
  { view: "monthly-closing", label: "Monthly Closing", icon: CalendarCheck, roles: ["ADMIN"], permission: "billing_cycles.read", rail: true },
  { view: "formula-engine", label: "Formula Engine", icon: Sigma, roles: ["ADMIN"], permission: "formulas.read", rail: true },
  { view: "reports", label: "Reports", icon: BarChart3, roles: ["ADMIN"], permission: "reports.read", rail: true },
  { view: "users", label: "Users", icon: Users, roles: ["ADMIN"], permission: "users.read", primary: true, rail: true },
  { view: "notifications", label: "Notifications", icon: Bell, roles: ["ADMIN", "USER"], permission: "notifications.read_self", rail: true },
  { view: "settings", label: "Settings", icon: Settings, roles: ["ADMIN"], permission: "settings.read", rail: true },
  { view: "system", label: "System", icon: ScrollText, roles: ["ADMIN"], permission: "audit.read", rail: true },
];

export const NAV_LABELS: Record<ViewKey, string> = {
  dashboard: "Dashboard",
  meals: "Meal Configuration",
  "user-meals": "Meals",
  kitchen: "Meal Counts",
  billing: "Billing & Closing",
  payments: "Payments & Wallet",
  expenses: "Expenses",
  funds: "Funds Overview",
  "monthly-closing": "Monthly Closing",
  "formula-engine": "Formula Engine",
  reports: "Reports & Analytics",
  users: "User Management",
  notifications: "Notifications & Announcements",
  settings: "Settings & Policies",
  system: "System (Audit & Tasks)",
  profile: "My Profile",
};

/**
 * The golden source exposes only Admin/Resident navigation shapes. Preserve
 * that recognizable UX while using the Worker-resolved permission set as the
 * actual capability filter. SUPER_ADMIN follows the Admin surface; MANAGER
 * follows the resident-safe surface unless the product later defines a distinct
 * source navigation contract for it.
 */
export function compatibilityNavRole(role: Role): "ADMIN" | "USER" {
  if (role === "SUPER_ADMIN" || role === "ADMIN") return "ADMIN";
  return "USER";
}

function hasResolvedPermission(permissions: readonly string[], permission: string): boolean {
  // Visual fixture mode intentionally has no live Worker principal. Keep that
  // deterministic screenshot-only path role-compatible; normal runtime with an
  // empty grant set fails closed.
  if (import.meta.env.VITE_BOARDOPS_VISUAL_FIXTURES === "1" && permissions.length === 0) return true;
  return permissions.includes(permission);
}

/**
 * Route access and navigation visibility are intentionally distinct.
 * The golden source keeps the resident Meals experience out of Admin navigation,
 * but Admin may still open that route directly (used by parity inspection and
 * support workflows). All other cross-surface routes remain blocked.
 */
export function canAccessView(role: Role, permissions: readonly string[], view: ViewKey): boolean {
  const compatibleRole = compatibilityNavRole(role);
  if (view === "profile") {
    return hasResolvedPermission(permissions, "profile.read_self");
  }
  const item = NAV_ITEMS.find((candidate) => candidate.view === view);
  if (!item) return false;

  const sourceRouteAllowed =
    item.roles.includes(compatibleRole) ||
    (compatibleRole === "ADMIN" && view === "user-meals");
  if (!sourceRouteAllowed) return false;

  return hasResolvedPermission(permissions, item.permission);
}

export function navForRole(role: Role, permissions: readonly string[] = []): NavItem[] {
  const compatibleRole = compatibilityNavRole(role);
  return NAV_ITEMS.filter(
    (item) => item.roles.includes(compatibleRole) && canAccessView(role, permissions, item.view),
  );
}

export function primaryNav(role: Role, permissions: readonly string[] = []): NavItem[] {
  const compatibleRole = compatibilityNavRole(role);
  return NAV_ITEMS.filter((item) => {
    if (!item.roles.includes(compatibleRole) || !canAccessView(role, permissions, item.view)) return false;
    if (item.primary) return true;
    if (item.primaryRoles?.includes(compatibleRole)) return true;
    return false;
  });
}
