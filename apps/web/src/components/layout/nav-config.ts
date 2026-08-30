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
  primary?: boolean;
  primaryRoles?: Role[];
  rail?: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  { view: "dashboard", label: "Home", icon: LayoutDashboard, roles: ["ADMIN", "USER"], primary: true, rail: true },
  { view: "meals", label: "Meal Configuration", icon: UtensilsCrossed, roles: ["ADMIN"], rail: true },
  { view: "user-meals", label: "Meals", icon: Utensils, roles: ["USER"], primaryRoles: ["USER"], rail: true },
  { view: "kitchen", label: "Counts", icon: BarChart3, roles: ["ADMIN"], primary: true, rail: true },
  { view: "billing", label: "Billing", icon: Wallet, roles: ["ADMIN", "USER"], primaryRoles: ["USER"], rail: true },
  { view: "payments", label: "Payments", icon: CreditCard, roles: ["ADMIN", "USER"], primary: true, rail: true },
  { view: "expenses", label: "Expenses", icon: Receipt, roles: ["ADMIN"], rail: true },
  { view: "funds", label: "Funds", icon: PiggyBank, roles: ["ADMIN"], rail: true },
  { view: "monthly-closing", label: "Monthly Closing", icon: CalendarCheck, roles: ["ADMIN"], rail: true },
  { view: "formula-engine", label: "Formula Engine", icon: Sigma, roles: ["ADMIN"], rail: true },
  { view: "reports", label: "Reports", icon: BarChart3, roles: ["ADMIN"], rail: true },
  { view: "users", label: "Users", icon: Users, roles: ["ADMIN"], primary: true, rail: true },
  { view: "notifications", label: "Notifications", icon: Bell, roles: ["ADMIN", "USER"], rail: true },
  { view: "settings", label: "Settings", icon: Settings, roles: ["ADMIN"], rail: true },
  { view: "system", label: "System", icon: ScrollText, roles: ["ADMIN"], rail: true },
];

export const NAV_LABELS: Record<ViewKey, string> = {
  dashboard: "Dashboard",
  meals: "Meal Configuration",
  "user-meals": "Meals",
  kitchen: "Meal Counts",
  billing: "Billing & Closing",
  payments: "Payments & Wallet",
  expenses: "Expenses & Procurement",
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
 * Phase 05 will replace this compatibility mapping with canonical backend RBAC.
 * Until then, higher admin roles must not get an empty shell and Manager must
 * retain the resident-safe navigation surface rather than disappearing from
 * navigation entirely.
 */
export function compatibilityNavRole(role: Role): "ADMIN" | "USER" {
  if (role === "SUPER_ADMIN" || role === "ADMIN") return "ADMIN";
  return "USER";
}

export function navForRole(role: Role): NavItem[] {
  const compatibleRole = compatibilityNavRole(role);
  return NAV_ITEMS.filter((item) => item.roles.includes(compatibleRole));
}

export function primaryNav(role: Role): NavItem[] {
  const compatibleRole = compatibilityNavRole(role);
  return NAV_ITEMS.filter((item) => {
    if (!item.roles.includes(compatibleRole)) return false;
    if (item.primary) return true;
    if (item.primaryRoles?.includes(compatibleRole)) return true;
    return false;
  });
}
