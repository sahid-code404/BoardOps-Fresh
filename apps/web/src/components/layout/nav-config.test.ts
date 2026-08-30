import { describe, expect, it } from "vitest";
import { canAccessView, navForRole, primaryNav } from "./nav-config";

const adminPermissions = [
  "dashboard.read",
  "meals.config.read",
  "kitchen.read",
  "bills.read",
  "payments.read",
  "expenses.read",
  "funds.read",
  "billing_cycles.read",
  "formulas.read",
  "reports.read",
  "users.read",
  "notifications.read_self",
  "settings.read",
  "audit.read",
  "profile.read_self",
];

const residentPermissions = [
  "dashboard.read",
  "meals.config.read",
  "bills.read",
  "payments.read",
  "notifications.read_self",
  "profile.read_self",
];

describe("permission-aware golden navigation", () => {
  it("fails closed when an Admin compatibility role lacks the required grant", () => {
    expect(canAccessView("ADMIN", adminPermissions, "users")).toBe(true);
    expect(canAccessView("ADMIN", adminPermissions.filter((key) => key !== "users.read"), "users")).toBe(false);
    expect(navForRole("ADMIN", adminPermissions.filter((key) => key !== "users.read")).some((item) => item.view === "users")).toBe(false);
  });

  it("preserves the source role shape even if an unrelated role has a grant", () => {
    expect(canAccessView("USER", [...residentPermissions, "users.read"], "users")).toBe(false);
    expect(canAccessView("MANAGER", residentPermissions, "user-meals")).toBe(true);
  });

  it("filters primary navigation and profile access from resolved permissions", () => {
    expect(primaryNav("USER", residentPermissions).map((item) => item.view)).toEqual([
      "dashboard",
      "user-meals",
      "billing",
      "payments",
    ]);
    expect(canAccessView("USER", residentPermissions, "profile")).toBe(true);
    expect(canAccessView("USER", residentPermissions.filter((key) => key !== "profile.read_self"), "profile")).toBe(false);
  });
});
