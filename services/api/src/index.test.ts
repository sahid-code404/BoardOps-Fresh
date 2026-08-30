import { describe, expect, it } from "vitest";
import app from "./index";

const CORE_TABLES = [
  "institutions",
  "accounting_periods",
  "users",
  "idempotency_keys",
  "audit_events",
  "outbox_events",
  "user_sessions",
  "login_history",
  "registration_requests",
  "auth_challenges",
  "roles",
  "permissions",
  "role_permissions",
  "meal_configurations",
  "meal_entries",
  "guest_meals",
  "meal_overrides",
  "leave_applications",
  "billing_snapshots",
  "bills",
  "billing_cycles",
  "billing_cycle_events",
  "payments",
  "refunds",
  "refund_transactions",
  "adjustments",
  "financial_reference_sequences",
  "expenses",
  "variables",
  "variable_versions",
  "formulas",
  "formula_versions",
];

function mockDb(tableNames = CORE_TABLES): D1Database {
  return {
    prepare(sql: string) {
      if (sql.includes("SELECT 1 AS ok")) {
        return {
          first: async () => ({ ok: 1 }),
        };
      }

      if (sql.includes("FROM permissions") && sql.includes("FROM roles") && sql.includes("FROM role_permissions")) {
        return {
          first: async () => ({ permission_count: 67, role_count: 4, grant_count: 164 }),
        };
      }

      return {
        bind: (...names: unknown[]) => ({
          all: async () => ({
            results: names
              .filter((name): name is string => typeof name === "string" && tableNames.includes(name))
              .map((name) => ({ name })),
          }),
        }),
      };
    },
  } as unknown as D1Database;
}

describe("health endpoint", () => {
  it("returns an explicit healthy response", async () => {
    const response = await app.request("http://boardops.local/api/health");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok", service: "boardops-api" });
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });
});

describe("readiness endpoint", () => {
  it("requires the complete current RBAC + operational + accounting + formula schema", async () => {
    const response = await app.request(
      "http://boardops.local/api/ready",
      undefined,
      { DB: mockDb(), FILES: {} as R2Bucket, ENVIRONMENT: "local" },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ready",
      service: "boardops-api",
      schema: "phase05-rbac",
    });
  });

  it("fails closed when a required meal-operations table is missing", async () => {
    const response = await app.request(
      "http://boardops.local/api/ready",
      undefined,
      { DB: mockDb(CORE_TABLES.filter((name) => name !== "meal_entries")), FILES: {} as R2Bucket, ENVIRONMENT: "local" },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: "not_ready",
      service: "boardops-api",
      schema: "phase05-rbac",
    });
  });

  it("fails closed when a required billing table is missing", async () => {
    const response = await app.request(
      "http://boardops.local/api/ready",
      undefined,
      { DB: mockDb(CORE_TABLES.filter((name) => name !== "billing_snapshots")), FILES: {} as R2Bucket, ENVIRONMENT: "local" },
    );

    expect(response.status).toBe(503);
  });

  it("fails closed when the monthly-closing cycle table is missing", async () => {
    const response = await app.request(
      "http://boardops.local/api/ready",
      undefined,
      { DB: mockDb(CORE_TABLES.filter((name) => name !== "billing_cycles")), FILES: {} as R2Bucket, ENVIRONMENT: "local" },
    );

    expect(response.status).toBe(503);
  });

  it("fails closed when monthly-closing transition history is missing", async () => {
    const response = await app.request(
      "http://boardops.local/api/ready",
      undefined,
      { DB: mockDb(CORE_TABLES.filter((name) => name !== "billing_cycle_events")), FILES: {} as R2Bucket, ENVIRONMENT: "local" },
    );

    expect(response.status).toBe(503);
  });

  it("fails closed when a required payments table is missing", async () => {
    const response = await app.request(
      "http://boardops.local/api/ready",
      undefined,
      { DB: mockDb(CORE_TABLES.filter((name) => name !== "payments")), FILES: {} as R2Bucket, ENVIRONMENT: "local" },
    );

    expect(response.status).toBe(503);
  });

  it("fails closed when durable refund transaction history is missing", async () => {
    const response = await app.request(
      "http://boardops.local/api/ready",
      undefined,
      { DB: mockDb(CORE_TABLES.filter((name) => name !== "refund_transactions")), FILES: {} as R2Bucket, ENVIRONMENT: "local" },
    );

    expect(response.status).toBe(503);
  });

  it("fails closed when immutable adjustments are missing", async () => {
    const response = await app.request(
      "http://boardops.local/api/ready",
      undefined,
      { DB: mockDb(CORE_TABLES.filter((name) => name !== "adjustments")), FILES: {} as R2Bucket, ENVIRONMENT: "local" },
    );

    expect(response.status).toBe(503);
  });

  it("fails closed when the canonical expenses table is missing", async () => {
    const response = await app.request(
      "http://boardops.local/api/ready",
      undefined,
      { DB: mockDb(CORE_TABLES.filter((name) => name !== "expenses")), FILES: {} as R2Bucket, ENVIRONMENT: "local" },
    );

    expect(response.status).toBe(503);
  });

  it("fails closed when immutable formula versions are missing", async () => {
    const response = await app.request(
      "http://boardops.local/api/ready",
      undefined,
      { DB: mockDb(CORE_TABLES.filter((name) => name !== "formula_versions")), FILES: {} as R2Bucket, ENVIRONMENT: "local" },
    );

    expect(response.status).toBe(503);
  });

  it("fails closed when immutable variable versions are missing", async () => {
    const response = await app.request(
      "http://boardops.local/api/ready",
      undefined,
      { DB: mockDb(CORE_TABLES.filter((name) => name !== "variable_versions")), FILES: {} as R2Bucket, ENVIRONMENT: "local" },
    );

    expect(response.status).toBe(503);
  });
});

describe("password mutation policy", () => {
  it("rejects change-password values that omit the special-character rule", async () => {
    const response = await app.request("http://boardops.local/api/auth/change-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: "Anything@1", newPassword: "NoSpecial123" }),
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: "Password must contain at least one special character",
    });
  });

  it("applies the same strong policy to administrator user-password edits", async () => {
    const response = await app.request("http://boardops.local/api/users/example-user", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "NoSpecial123" }),
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: "Password must contain at least one special character",
    });
  });
});
