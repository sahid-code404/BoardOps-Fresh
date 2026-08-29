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
];

function mockDb(tableNames = CORE_TABLES): D1Database {
  return {
    prepare(sql: string) {
      if (sql.includes("SELECT 1 AS ok")) {
        return {
          first: async () => ({ ok: 1 }),
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
  it("requires the complete Phase 04 auth workflow D1 schema", async () => {
    const response = await app.request(
      "http://boardops.local/api/ready",
      undefined,
      { DB: mockDb(), FILES: {} as R2Bucket, ENVIRONMENT: "local" },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ready",
      service: "boardops-api",
      schema: "phase04-auth-workflows",
    });
  });

  it("fails closed when a required auth workflow table is missing", async () => {
    const response = await app.request(
      "http://boardops.local/api/ready",
      undefined,
      { DB: mockDb(CORE_TABLES.filter((name) => name !== "auth_challenges")), FILES: {} as R2Bucket, ENVIRONMENT: "local" },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: "not_ready",
      service: "boardops-api",
      schema: "phase04-auth-workflows",
    });
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